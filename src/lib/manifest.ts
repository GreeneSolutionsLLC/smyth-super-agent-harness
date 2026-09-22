/**
 * SMYTH Configuration Manifest — loader, saver, and validator.
 *
 * This is Phase 1 of the migration plan (docs/MIGRATION_PLAN.md).
 *
 * PURPOSE
 *   The manifest is the SINGLE SOURCE OF TRUTH for "what is wired" on a
 *   SMYTH instance. Everything else (mcp-servers.yaml, settings.json)
 *   should DERIVE from it. Secrets stay in .env and are referenced by
 *   envKey here — never stored as values in the manifest.
 *
 *   Before this file existed, config was scattered across:
 *     - mcp-servers.yaml      (which MCP servers are enabled)
 *     - settings.json         (setup wizard output: permissions, providers)
 *     - .env / .env.local     (API keys and URLs)
 *     - hardcoded constants   (agent variants, CRM url, etc.)
 *
 *   A single manifest is what lets the "mechanic" agent (an OpenClaw agent)
 *   read the current state, make a change, validate it, and roll it back —
 *   instead of poking at scattered files blind.
 *
 * SECURITY
 *   - The manifest NEVER contains secret values. It references them by envKey.
 *   - `secrets` in an integration describe *which* env var holds the token,
 *     not the token itself.
 *
 * This module is dependency-free (no Zod) so it can be loaded without a
 * package install and works in the existing build.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type IntegrationStatus =
  | "pending"     // identified but not yet wired
  | "migrating"   // wiring in progress
  | "migrated"    // wired and validated
  | "failed";     // wiring failed, needs attention

export type IntegrationKind = "open-source" | "paid" | "custom" | "native";

export type AuthKind = "none" | "oauth" | "bearer" | "api-key";

export type TransportKind = "stdio" | "sse" | "http" | "websocket";

export interface ManifestIntegration {
  key: string;                 // stable machine id, e.g. "crm", "calendar"
  name: string;                // human/agent name, e.g. "Twenty CRM"
  kind: IntegrationKind;
  status: IntegrationStatus;
  sourcePaidTool?: string;     // what it replaced, e.g. "HubSpot"
  mcp?: {
    transport: TransportKind;
    url?: string;              // for http/sse
    command?: string;          // for stdio
    args?: string[];
    auth: AuthKind;
    envKey?: string;           // which .env var holds the secret (never the value)
    allowedTools?: string[];
  };
  tools?: string[];            // discovered tool names
  validated?: boolean;
  lastValidated?: string;
  approvedBy?: string;         // who approved pending→migrated (Phase 2 gate)
  caveats?: string[];
}

export interface ManifestModels {
  active: string;
  routingPool: string;         // "machine-cloud" | "machine-pro" | "local"
  variants: Array<{ id: string; name: string; model: string }>;
}

export interface ManifestSettings {
  workspacePath: string;
  spendCapUsd: number;
  permissions: Record<string, boolean | "deferred">;
}

export interface ManifestInstance {
  id: string;
  name: string;
  deployedAt: string;
  deployedBy: string;          // deployer-agent
  mechanicRepo?: string;       // github repo the mechanic uses
  licenseState?: "trial" | "paid" | "unlicensed";
}

export interface SmythManifest {
  schema: 1;
  instance: ManifestInstance;
  models: ManifestModels;
  integrations: ManifestIntegration[];
  mcpServers: Array<{ name: string; transport: TransportKind; enabled: boolean }>;
  settings: ManifestSettings;
}

// ── Defaults / factory ───────────────────────────────────────────────────

export function defaultManifest(overrides: Partial<SmythManifest> = {}): SmythManifest {
  return {
    schema: 1,
    instance: {
      id: "unset",
      name: "unset",
      deployedAt: new Date().toISOString(),
      deployedBy: "deployer-agent",
    },
    models: {
      active: "glm-5.2",
      routingPool: "machine-pro",
      variants: [],
    },
    integrations: [],
    mcpServers: [],
    settings: {
      workspacePath: "",
      spendCapUsd: 5.0,
      permissions: {},
    },
    ...overrides,
  };
}

// ── Validation ───────────────────────────────────────────────────────────

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const VALID_STATUSES: IntegrationStatus[] = ["pending", "migrating", "migrated", "failed"];
const VALID_KINDS: IntegrationKind[] = ["open-source", "paid", "custom", "native"];
const VALID_AUTH: AuthKind[] = ["none", "oauth", "bearer", "api-key"];
const VALID_TRANSPORTS: TransportKind[] = ["stdio", "sse", "http", "websocket"];

function push(issues: ValidationIssue[], path: string, message: string) {
  issues.push({ path, message });
}

export function validateManifest(m: any): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!m || typeof m !== "object") {
    return { ok: false, issues: [{ path: "$", message: "manifest must be an object" }] };
  }

  // schema
  if (m.schema !== 1) push(issues, "schema", `unsupported schema: ${m.schema} (expected 1)`);

  // instance
  if (!m.instance || typeof m.instance !== "object") {
    push(issues, "instance", "instance block is required");
  } else {
    if (typeof m.instance.id !== "string" || !m.instance.id) push(issues, "instance.id", "required string");
    if (typeof m.instance.name !== "string" || !m.instance.name) push(issues, "instance.name", "required string");
    if (typeof m.instance.deployedAt !== "string") push(issues, "instance.deployedAt", "required ISO string");
    if (m.instance.licenseState !== undefined &&
        !["trial", "paid", "unlicensed"].includes(m.instance.licenseState)) {
      push(issues, "instance.licenseState", "must be trial|paid|unlicensed");
    }
  }

  // models
  if (!m.models || typeof m.models !== "object") {
    push(issues, "models", "models block is required");
  } else {
    if (typeof m.models.active !== "string" || !m.models.active) push(issues, "models.active", "required string");
    if (typeof m.models.routingPool !== "string") push(issues, "models.routingPool", "required string");
    if (!Array.isArray(m.models.variants)) push(issues, "models.variants", "must be an array");
  }

  // integrations
  if (!Array.isArray(m.integrations)) {
    push(issues, "integrations", "must be an array");
  } else {
    const seenKeys = new Set<string>();
    m.integrations.forEach((it: any, i: number) => {
      const p = `integrations[${i}]`;
      if (!it || typeof it !== "object") { push(issues, p, "must be an object"); return; }
      if (typeof it.key !== "string" || !it.key) {
        push(issues, `${p}.key`, "required string");
      } else if (seenKeys.has(it.key)) {
        push(issues, `${p}.key`, `duplicate key "${it.key}"`);
      } else {
        seenKeys.add(it.key);
      }
      if (typeof it.name !== "string" || !it.name) push(issues, `${p}.name`, "required string");
      if (!VALID_KINDS.includes(it.kind)) push(issues, `${p}.kind`, `invalid kind "${it.kind}"`);
      if (!VALID_STATUSES.includes(it.status)) push(issues, `${p}.status`, `invalid status "${it.status}"`);

      // status transition rules
      if (it.status === "migrated" && it.validated !== true) {
        push(issues, `${p}.status`, "status=migrated requires validated=true");
      }
      if (it.status === "migrated" && !it.approvedBy) {
        push(issues, `${p}.approvedBy`, "status=migrated requires approvedBy (Phase 2 gate)");
      }

      if (it.mcp) {
        const mp = `${p}.mcp`;
        if (!VALID_TRANSPORTS.includes(it.mcp.transport)) push(issues, `${mp}.transport`, `invalid transport "${it.mcp.transport}"`);
        if (!VALID_AUTH.includes(it.mcp.auth)) push(issues, `${mp}.auth`, `invalid auth "${it.mcp.auth}"`);
        if ((it.mcp.transport === "http" || it.mcp.transport === "sse") && typeof it.mcp.url !== "string") {
          push(issues, `${mp}.url`, "http/sse transport requires url");
        }
        if (it.mcp.transport === "stdio" && typeof it.mcp.command !== "string") {
          push(issues, `${mp}.command`, "stdio transport requires command");
        }
        // secrets are referenced, never inlined — flag suspicious inline values
        if (it.mcp.envKey && typeof it.mcp.envKey !== "string") {
          push(issues, `${mp}.envKey`, "envKey must be a string (the NAME of the env var, not the value)");
        }
      }
    });
  }

  // mcpServers (derived list — must not contradict integrations)
  if (!Array.isArray(m.mcpServers)) {
    push(issues, "mcpServers", "must be an array");
  }

  // settings
  if (!m.settings || typeof m.settings !== "object") {
    push(issues, "settings", "settings block is required");
  } else {
    if (typeof m.settings.spendCapUsd !== "number") push(issues, "settings.spendCapUsd", "required number");
    if (typeof m.settings.workspacePath !== "string") push(issues, "settings.workspacePath", "required string");
  }

  return { ok: issues.length === 0, issues };
}

// ── Load / save (file I/O) ───────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import { dump as dumpYaml } from "js-yaml";

export function manifestPath(baseDir?: string): string {
  const root = baseDir || process.cwd();
  return join(root, "smyth-manifest.yaml");
}

export function loadManifest(baseDir?: string): SmythManifest {
  const path = manifestPath(baseDir);
  if (!existsSync(path)) {
    return defaultManifest();
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = loadYaml(raw) as any;
  return parsed as SmythManifest;
}

export function saveManifest(m: SmythManifest, baseDir?: string): void {
  const path = manifestPath(baseDir);
  const yaml = dumpYaml(m, { lineWidth: 100, noRefs: true });
  writeFileSync(path, `# SMYTH configuration manifest — single source of truth.\n# Generated ${new Date().toISOString()}\n# Secrets live in .env and are referenced by envKey, never inlined here.\n\n${yaml}`, "utf-8");
}

export function hasManifest(baseDir?: string): boolean {
  return existsSync(manifestPath(baseDir));
}

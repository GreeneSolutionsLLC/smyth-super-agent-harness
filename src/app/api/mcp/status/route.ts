/**
 * GET /api/mcp/status
 *
 * Returns the live status of all configured MCP servers. Combines:
 *   1. Config from mcp-servers.yaml (filesystem, fetch, memory, etc.)
 *   2. OAuth-protected HTTP servers discovered via .mcp-oauth-tokens.json
 *      (canva, twenty)
 *   3. Real connection check: for each HTTP server we do a tools/list
 *      call to verify it's reachable and report the actual tool count.
 *
 * Stdio servers (filesystem, fetch, etc.) are reported as 'configured'
 * (not 'connected') because we don't spawn them here — they're spawned
 * lazily by the chat route's tool loader. Once the chat route has
 * discovered their tools, the registry's status flips to 'connected',
 * but that's per-process and won't be visible from a fresh process.
 *
 * Cache: 5s, so the UI doesn't hammer us.
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";

const TOKEN_FILE = path.join(process.cwd(), ".mcp-oauth-tokens.json");
const MCP_CONFIG_FILE = path.join(process.cwd(), "mcp-servers.yaml");
const AUTO_AUTH_FILE = path.join(process.cwd(), ".mcp-auto-auth.json");

function readAutoAuthMap(): Record<string, { autoAuth: boolean }> {
  try {
    if (fs.existsSync(AUTO_AUTH_FILE)) {
      return JSON.parse(fs.readFileSync(AUTO_AUTH_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

interface ServerStatus {
  name: string;
  description: string;
  transport: "stdio" | "sse" | "http" | "websocket";
  enabled: boolean;
  connected: boolean;
  authRequired: boolean;
  authenticated: boolean;
  toolCount: number;
  lastError?: string;
  lastChecked?: string;
  // 2026-08-22: when false, the http-client never opens OAuth popups on
  // token expiry. UI surfaces a per-server toggle bound to this.
  autoAuth: boolean;
}

interface CacheEntry {
  data: ServerStatus[];
  expiresAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5_000;

interface OAuthToken {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
  scope?: string;
  server_url?: string;
}

function readOAuthTokens(): Record<string, OAuthToken> {
  if (!fs.existsSync(TOKEN_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function isTokenValid(t: OAuthToken): boolean {
  if (!t.access_token) return false;
  if (t.expires_at && Date.now() >= t.expires_at) {
    return !!t.refresh_token;
  }
  return true;
}

interface YamlServerConfig {
  description?: string;
  transport?: "stdio" | "sse" | "http" | "websocket";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  url?: string;
}

interface YamlConfig {
  servers: Record<string, YamlServerConfig>;
}

function readMcpConfig(): YamlConfig {
  if (!fs.existsSync(MCP_CONFIG_FILE)) return { servers: {} };
  try {
    const yaml = require("js-yaml");
    const raw = fs.readFileSync(MCP_CONFIG_FILE, "utf-8");
    return yaml.load(raw) || { servers: {} };
  } catch {
    return { servers: {} };
  }
}

interface ProbeResult {
  connected: boolean;
  toolCount: number;
  error?: string;
}

/**
 * Probe a single HTTP-based MCP server. Sends a tools/list request and
 * returns the actual tool count + connection state.
 */
async function probeHttpServer(url: string, token?: OAuthToken): Promise<ProbeResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (token?.access_token) {
      headers["Authorization"] = `Bearer ${token.access_token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { connected: false, toolCount: 0, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    // Response may be SSE (data: {...}\n\n) or plain JSON
    let body: any = null;
    if (text.startsWith("data:")) {
      const line = text.split("\n").find((l) => l.startsWith("data:"));
      if (line) {
        try { body = JSON.parse(line.slice(5).trim()); } catch {}
      }
    } else {
      try { body = JSON.parse(text); } catch {}
    }
    const tools = body?.result?.tools || [];
    return { connected: true, toolCount: tools.length };
  } catch (err: any) {
    return { connected: false, toolCount: 0, error: err?.message || "unreachable" };
  }
}

export async function GET(_req: NextRequest) {
  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json({ servers: cache.data, cached: true });
  }

  const config = readMcpConfig();
  const tokens = readOAuthTokens();
  const autoAuthMap = readAutoAuthMap();
  const autoAuthEnabled = (name: string) => autoAuthMap[name]?.autoAuth === true;
  const servers: ServerStatus[] = [];
  const now = new Date().toISOString();

  // 1. Configured servers from mcp-servers.yaml
  for (const [name, serverConfig] of Object.entries(config.servers)) {
    const transport = serverConfig.transport || "stdio";
    const enabled = serverConfig.enabled !== false;
    // Only HTTP/SSE servers can be probed from this process. Stdio
    // servers are spawned lazily elsewhere — we report them as
    // 'configured' but not 'connected' until the registry's chat-side
    // status has flipped (per-process, won't show in a fresh process).
    if (enabled && (transport === "http" || transport === "sse")) {
      const url = serverConfig.url || serverConfig.args?.find((a) => a.startsWith("http"));
      if (url) {
        const token = tokens[name];
        const probe = await probeHttpServer(url, token);
        const authRequired = !!token;
        const authenticated = authRequired ? isTokenValid(token) : true;
        servers.push({
          name,
          description: serverConfig.description || "",
          transport,
          enabled,
          connected: probe.connected && authenticated,
          authRequired,
          authenticated,
          toolCount: probe.toolCount,
          lastError: probe.error,
          lastChecked: now,
          autoAuth: autoAuthEnabled(name),
        });
        continue;
      }
    }
    // Stdio or unprobed HTTP: report as configured
    const hasTokenEntry = !!tokens[name];
    servers.push({
      name,
      description: serverConfig.description || "",
      transport,
      enabled,
      connected: false,
      authRequired: hasTokenEntry,
      authenticated: hasTokenEntry ? isTokenValid(tokens[name]) : true,
      toolCount: 0,
      lastChecked: now,
      autoAuth: autoAuthEnabled(name),
    });
  }

  // 2. OAuth servers from .mcp-oauth-tokens.json (not in mcp-servers.yaml)
  // Fallback URLs for known OAuth servers whose server_url wasn't saved
  // with the token. These are public, well-known MCP endpoints.
  const KNOWN_OAUTH_URLS: Record<string, string> = {
    canva: "https://mcp.canva.com/mcp",
    twenty: "http://localhost:4000/mcp",
  };
  for (const [name, token] of Object.entries(tokens)) {
    if (servers.find((s) => s.name === name)) continue;  // already covered above
    const url = token.server_url || KNOWN_OAUTH_URLS[name];
    if (!url) continue;
    const probe = await probeHttpServer(url, token);
    servers.push({
      name,
      description: "OAuth-authenticated MCP server",
      transport: "http",
      enabled: true,
      connected: probe.connected && isTokenValid(token),
      authRequired: true,
      authenticated: isTokenValid(token),
      toolCount: probe.toolCount,
      lastError: probe.error,
      lastChecked: now,
      autoAuth: autoAuthEnabled(name),
    });
  }

  // Sort: connected first, then auth, error, configured, disabled
  const order: Record<string, number> = { connected: 0, auth: 1, error: 2, configured: 3, disabled: 4 };
  const stateOf = (s: ServerStatus) => {
    if (!s.enabled) return "disabled";
    if (s.authRequired && !s.authenticated) return "auth";
    if (s.connected) return "connected";
    if (s.lastError) return "error";
    return "configured";
  };
  servers.sort((a, b) => order[stateOf(a)] - order[stateOf(b)]);

  cache = { data: servers, expiresAt: Date.now() + CACHE_TTL_MS };
  return NextResponse.json({ servers, cached: false });
}

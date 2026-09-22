/**
 * Planning Tool — Multi-step Plan Creation & Tracking
 *
 * Ported from OpenManus app/tool/planning.py
 *
 * Allows Smyth to create, manage, and execute multi-step plans
 * for complex tasks. Transforms the agent from purely reactive
 * to truly agentic — with visibility into what's happening.
 *
 * Steps lifecycle:
 *   not_started → in_progress → completed  |  blocked
 *
 * Plans are stored in-memory for the current session and
 * persisted to plans.json in the workspace for continuity
 * across page reloads.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const PLANS_DIR = join(process.cwd(), "plans");
const PLANS_FILE = join(PLANS_DIR, "plans.json");

export type StepStatus = "not_started" | "in_progress" | "completed" | "blocked";

export interface Plan {
  plan_id: string;
  title: string;
  steps: string[];
  step_statuses: StepStatus[];
  step_notes: string[];
  created_at: string;
  updated_at: string;
}

// In-memory store, synced to disk
const plans = new Map<string, Plan>();
let currentPlanId: string | null = null;
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(PLANS_FILE)) {
      const raw = readFileSync(PLANS_FILE, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.plans)) {
        for (const p of data.plans) {
          plans.set(p.plan_id, p);
        }
      }
      if (data.currentPlanId) {
        currentPlanId = data.currentPlanId;
      }
    }
  } catch {
    // Corrupted file is fine — start fresh
    plans.clear();
    currentPlanId = null;
  }
}

function persist(): void {
  try {
    mkdirSync(PLANS_DIR, { recursive: true });
    writeFileSync(
      PLANS_FILE,
      JSON.stringify(
        {
          currentPlanId,
          plans: Array.from(plans.values()),
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    // Non-critical — in-memory still works for session
  }
}

function formatPlan(plan: Plan): string {
  const completed = plan.step_statuses.filter((s) => s === "completed").length;
  const inProgress = plan.step_statuses.filter((s) => s === "in_progress").length;
  const blocked = plan.step_statuses.filter((s) => s === "blocked").length;
  const total = plan.steps.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  let out = `📋 Plan: "${plan.title}" (${completed}/${total} — ${pct}%)\n`;
  out += `Status: ${completed} ✓ done, ${inProgress} → in progress, ${blocked} ! blocked, ${total - completed - inProgress - blocked} ○ waiting\n\n`;
  out += "Steps:\n";

  for (let i = 0; i < plan.steps.length; i++) {
    const status = plan.step_statuses[i];
    const symbol: Record<string, string> = {
      not_started: "  ○",
      in_progress: "  →",
      completed: "  ✓",
      blocked: "  !",
    };
    out += `${i}. ${symbol[status] || "  ○"} ${plan.steps[i]}\n`;
    if (plan.step_notes[i]) {
      out += `   Notes: ${plan.step_notes[i]}\n`;
    }
  }

  return out;
}

/**
 * Handle a planning tool command.
 *
 * Commands:
 *   create       — Create a new plan (requires plan_id, title, steps)
 *   update       — Update an existing plan (plan_id, optional title/steps)
 *   list         — List all plans
 *   get          — Get a specific plan (defaults to active plan)
 *   set_active   — Set the active plan
 *   mark_step    — Mark a step's status and/or notes
 *   delete       — Delete a plan
 */
export function handlePlanning(args: Record<string, any>): string {
  ensureLoaded();

  const command = args.command as string;
  const plan_id = (args.plan_id as string) || undefined;
  const title = (args.title as string) || undefined;
  const steps = (args.steps as string[]) || undefined;
  const step_index = (args.step_index as number) ?? undefined;
  const step_status = (args.step_status as StepStatus) || undefined;
  const step_notes = (args.step_notes as string) || undefined;

  if (!command) {
    return "Error: 'command' is required. Available: create, update, list, get, set_active, mark_step, delete";
  }

  switch (command) {
    // ── Create ──
    case "create": {
      if (!plan_id) return "Error: plan_id is required for 'create'";
      if (!title) return "Error: title is required for 'create'";
      if (!steps || !Array.isArray(steps) || steps.length === 0) {
        return "Error: steps must be a non-empty array of strings";
      }
      if (plans.has(plan_id)) {
        return `Error: Plan '${plan_id}' already exists. Use 'update' to modify.`;
      }

      const plan: Plan = {
        plan_id,
        title,
        steps: [...steps],
        step_statuses: steps.map(() => "not_started" as StepStatus),
        step_notes: steps.map(() => ""),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      plans.set(plan_id, plan);
      currentPlanId = plan_id;
      persist();

      return `✅ Plan created: "${title}" (${steps.length} steps)\n\n${formatPlan(plan)}`;
    }

    // ── Update ──
    case "update": {
      const up = plans.get(plan_id || "");
      if (!up) return "Error: Plan not found";
      if (title) up.title = title;
      if (steps && Array.isArray(steps)) {
        const oldStatuses = up.step_statuses;
        const oldNotes = up.step_notes;
        up.steps = [...steps];
        up.step_statuses = steps.map((_, i) =>
          i < oldStatuses.length && steps[i] === up.steps[i] ? oldStatuses[i] : "not_started"
        );
        up.step_notes = steps.map((_, i) =>
          i < oldNotes.length && steps[i] === up.steps[i] ? oldNotes[i] : ""
        );
      }
      up.updated_at = new Date().toISOString();
      persist();
      return `✅ Plan updated\n\n${formatPlan(up)}`;
    }

    // ── List ──
    case "list": {
      if (plans.size === 0) return "No plans yet. Create one with: planning(command='create', plan_id='...', title='...', steps=[...])";
      const lines: string[] = ["Available plans:"];
      for (const id of Array.from(plans.keys())) {
        const p = plans.get(id)!;
        const active = id === currentPlanId ? " (active)" : "";
        const done = p.step_statuses.filter((s) => s === "completed").length;
        lines.push(`  • ${id}${active}: "${p.title}" — ${done}/${p.steps.length} steps (${Math.round((done / p.steps.length) * 100)}%)`);
      }
      return lines.join("\n");
    }

    // ── Get ──
    case "get": {
      const gp = plans.get(plan_id || currentPlanId || "");
      if (!gp) return "Error: Plan not found. Use 'list' to see available plans.";
      return formatPlan(gp);
    }

    // ── Set Active ──
    case "set_active": {
      if (!plan_id) return "Error: plan_id is required for 'set_active'";
      if (!plans.has(plan_id)) return `Error: Plan '${plan_id}' not found`;
      currentPlanId = plan_id;
      persist();
      return `✅ Active plan set to: "${plans.get(plan_id)!.title}"`;
    }

    // ── Mark Step ──
    case "mark_step": {
      const mp = plans.get(plan_id || currentPlanId || "");
      if (!mp) return "Error: Plan not found";
      if (step_index === undefined || step_index < 0 || step_index >= mp.steps.length) {
        return `Error: step_index must be 0-${mp.steps.length - 1}`;
      }
      if (step_status) {
        const valid: StepStatus[] = ["not_started", "in_progress", "completed", "blocked"];
        if (!valid.includes(step_status)) {
          return `Error: Invalid status '${step_status}'. Must be: ${valid.join(", ")}`;
        }
        mp.step_statuses[step_index] = step_status;
      }
      if (step_notes !== undefined) {
        mp.step_notes[step_index] = step_notes;
      }
      mp.updated_at = new Date().toISOString();
      persist();
      return `✅ Step ${step_index} updated\n\n${formatPlan(mp)}`;
    }

    // ── Delete ──
    case "delete": {
      if (!plan_id) return "Error: plan_id is required for 'delete'";
      if (!plans.has(plan_id)) return `Error: Plan '${plan_id}' not found`;
      plans.delete(plan_id);
      if (currentPlanId === plan_id) currentPlanId = null;
      persist();
      return `🗑️ Deleted plan: ${plan_id}`;
    }

    default:
      return `Error: Unknown command '${command}'. Available: create, update, list, get, set_active, mark_step, delete`;
  }
}

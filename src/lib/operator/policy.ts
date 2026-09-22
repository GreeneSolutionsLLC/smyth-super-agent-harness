/**
 * Default engagement policy.
 *
 * Conservative defaults. Rob can override any field when starting an engagement.
 * The auto-generated policies use these as the baseline.
 */

import type { EngagementPolicy } from "./types";

export const DEFAULT_POLICY: Omit<EngagementPolicy, "task" | "taskSummary"> = {
  auto_continue: true,
  auto_continue_prompt: "Please continue with the next step of your plan.",
  max_auto_continues: 5,
  auto_answer_permitted: ["yes", "proceed", "use plan as-is", "continue"],
  spend_cap_usd: 5.00,
  notify_user_on: ["task_complete", "error_persisting_2x", "spend_80pct"],
  abort_on: ["spend_100pct", "agent_loops_3x", "user_typing_then_stalled"],
  // Scheduled cadence is the slow heartbeat — most decisions are driven by
  // event-derived immediate ticks (tool error, message complete). The
  // heartbeat catches the "agent went completely silent" case.
  tick_interval_ms: 60_000,
  // Hard cap: even if every tick is deferred, we must run at least this
  // often. Prevents indefinite deferral loops.
  heartbeat_max_gap_ms: 120_000,
  max_engagement_ms: 4 * 60 * 60 * 1000, // 4 hours
};

/**
 * Build a policy from a task description.
 * One-shot LLM call — runs once at engagement start, never during the tick loop.
 */
export function buildPolicy(task: string): EngagementPolicy {
  return {
    ...DEFAULT_POLICY,
    task,
    taskSummary: summarizeTask(task),
  };
}

/**
 * Naive first-line summary. The LLM call below improves this.
 */
function summarizeTask(task: string): string {
  const first = task.split(/[.\n]/)[0].trim();
  if (first.length <= 120) return first;
  return first.slice(0, 117) + "...";
}

/**
 * Engagement store — in-memory cache + disk mirror.
 *
 * Tracks active Warden engagements. One engagement = one watch session on one
 * Smyth chat. Lives in the Next.js process, mirrored to .operator-state/state.json
 * on every mutation. On module (re)load we hydrate from disk, so engagements
 * survive dev hot-reloads, server restarts, and battery deaths.
 *
 * Tick loop: each engagement has a setTimeout chain. Every tick_interval_ms,
 * it runs the Warden (Echo Vision + Operator LLM), executes the decision, and
 * schedules the next tick.
 */

import type { OperatorEngagement, OperatorLlmConfig, WardenDecision } from "./types";
import { cancelPendingInjection } from "./tick";
import { loadEngagements, persistEngagements } from "./fs-state";

// 2026-09-04: OmniRoute (maetryxx) is no longer functional on this IP/device,
// so the Operator now defaults to the machine pool (Ollama Cloud/Pro/etc).
const DEFAULT_LLM: OperatorLlmConfig = {
  model: "kimi-k2.6",
  pool: "machine",
};

// Hydrate from disk on module load (survives dev hot-reloads & restarts).
const engagements = new Map<string, OperatorEngagement>();
{
  const saved = loadEngagements();
  if (saved) {
    for (const [id, raw] of Object.entries(saved)) {
      const e = raw as OperatorEngagement;
      // Only revive engagements that were still running when we died.
      if (e && e.status === "running") {
        engagements.set(id, e);
      }
    }
    if (engagements.size > 0) {
      console.log(`[operator] hydrated ${engagements.size} engagement(s) from disk`);
    }
  }
}

function persistAll(): void {
  persistEngagements(Object.fromEntries(engagements.entries()));
}
const tickTimers = new Map<string, any>();

// Per-engagement immediate-tick coalescing. Multiple "immediate" triggers in
// a short window collapse into a single tick.
const IMMEDIATE_TICK_COOLDOWN_MS = 5_000;       // min gap between immediate ticks
const IMMEDIATE_TICK_DELAY_MS = 2_000;          // delay before firing (lets the event settle)
const lastImmediateTick = new Map<string, number>();
const pendingImmediate = new Set<string>();

export function createEngagement(
  chatSessionId: string | null,
  policy: OperatorEngagement["policy"],
  llm?: Partial<OperatorLlmConfig>,
): OperatorEngagement {
  const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const engagement: OperatorEngagement = {
    sessionId: id,
    chatSessionId,
    startedAt: new Date().toISOString(),
    policy,
    llm: { ...DEFAULT_LLM, ...llm },
    decisions: [],
    spendSoFarUsd: 0,
    autoContinuesUsed: 0,
    status: "running",
  };
  engagements.set(id, engagement);
  persistAll();
  return engagement;
}

export function getEngagement(id: string): OperatorEngagement | null {
  return engagements.get(id) || null;
}

export function listEngagements(): OperatorEngagement[] {
  return Array.from(engagements.values());
}

export function updateEngagement(id: string, patch: Partial<OperatorEngagement>): OperatorEngagement | null {
  const e = engagements.get(id);
  if (!e) return null;
  Object.assign(e, patch);
  persistAll();
  return e;
}

export function recordDecision(id: string, decision: WardenDecision): void {
  const e = engagements.get(id);
  if (!e) return;
  e.decisions.push(decision);
  // Cap decision history at 100 to bound memory
  if (e.decisions.length > 100) e.decisions = e.decisions.slice(-100);

  // Track spend and auto-continues
  if (decision.action === "continue") {
    e.autoContinuesUsed += 1;
    // Estimate cost: rough heuristic, ~$0.005 per continue
    e.spendSoFarUsd += 0.005;
  }
  persistAll();
}

export function setTickTimer(id: string, timer: any): void {
  const existing = tickTimers.get(id);
  if (existing) clearTimeout(existing);
  tickTimers.set(id, timer);
}

export function clearTickTimer(id: string): void {
  const existing = tickTimers.get(id);
  if (existing) clearTimeout(existing);
  tickTimers.delete(id);
  pendingImmediate.delete(id);
  lastImmediateTick.delete(id);
}

/**
 * Request an immediate tick for an engagement. Coalesces: if one fired
 * recently, the request is dropped. Otherwise schedules a tick in 2s and
 * clears any pending scheduled tick (the immediate one supersedes it).
 */
export function requestImmediateTick(id: string, reason: string): boolean {
  const engagement = engagements.get(id);
  if (!engagement || engagement.status !== "running") return false;
  const now = Date.now();
  const last = lastImmediateTick.get(id) || 0;
  if (now - last < IMMEDIATE_TICK_COOLDOWN_MS) {
    return false; // coalesced
  }
  lastImmediateTick.set(id, now);
  pendingImmediate.add(id);

  // Clear any scheduled tick — the immediate one replaces it.
  const existing = tickTimers.get(id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingImmediate.delete(id);
    tickTimers.delete(id);
    // Lazy import to avoid a circular dependency between
    // engagement-store and tick (tick already imports this module).
    import("./tick").then(({ runTick }) => {
      runTick(id, { source: "immediate", reason }).catch((e) => {
        console.error(`[operator] immediate tick error: ${e?.message || e}`);
      });
    });
  }, IMMEDIATE_TICK_DELAY_MS);
  tickTimers.set(id, timer);
  return true;
}

/**
 * Mark that the next scheduled tick should be deferred (pushed out by
 * tick_interval_ms). Used when the agent is making clear progress and we
 * want to avoid wasting LLM calls. A safety net still fires no later than
 * heartbeat_max_gap_ms after the engagement started (or the last real tick).
 *
 * NOTE: this only re-arms the existing scheduled timer. It does NOT
 * independently enforce the heartbeat cap — the caller's own scheduleNextTick
 * already does that. deferNextTick simply says "skip the next scheduled one
 * and re-arm at the normal interval."
 */
export function deferNextTick(id: string): void {
  const engagement = engagements.get(id);
  if (!engagement || engagement.status !== "running") return;
  const existing = tickTimers.get(id);
  if (existing) clearTimeout(existing);
  // Re-arm at the normal interval. If the agent stays healthy for a long
  // time, this also naturally respects heartbeat_max_gap_ms because
  // tick_interval_ms <= heartbeat_max_gap_ms (enforced by the type
  // contract and the default policy).
  const deferMs = engagement.policy.tick_interval_ms;
  const timer = setTimeout(() => {
    tickTimers.delete(id);
    import("./tick").then(({ runTick }) => {
      runTick(id, { source: "scheduled", reason: "deferred-tick" }).catch((e) => {
        console.error(`[operator] scheduled tick error: ${e?.message || e}`);
      });
    });
  }, deferMs);
  tickTimers.set(id, timer);
}

export function stopEngagement(id: string, reason: string): OperatorEngagement | null {
  clearTickTimer(id);
  lastImmediateTick.delete(id);
  pendingImmediate.delete(id);
  // Cancel any pending injection timer so it doesn't fire after stop
  const updated = updateEngagement(id, { status: "stopped", stopReason: reason });
  if (updated) cancelPendingInjection(updated);

  // Fire-and-forget post-engagement review. The review runs asynchronously
  // and writes a markdown file under operator/reviews/. We don't await it
  // so the stop response is fast.
  if (updated) {
    import("./review").then(({ reviewEngagement }) => {
      reviewEngagement(id).catch((e) => {
        console.error(`[operator] review failed: ${e?.message || e}`);
      });
    });
  }

  return updated;
}

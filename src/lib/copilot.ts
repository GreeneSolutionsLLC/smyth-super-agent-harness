// ── Co-pilot — always-on recovery guardrail ──
//
// The seatbelt, not the manager. When the agent hits a rate-limit wall or
// total saturation, the co-pilot waits out the backoff and re-prompts the
// agent with a fixed template so the job keeps moving. The user never sees
// the error — they just see the agent keep working.
//
// Design rules:
//   - RULE-BASED, ZERO LLM: detection is deterministic (governor state,
//     429/503 observed, tool timeouts). Re-prompts are fixed templates.
//     No tokens, no cost, no hallucination risk.
//   - REACTIVE ONLY: fires only on a detected stall, never proactively.
//   - BOUNDED: max N recoveries per session, then it stops and surfaces
//     a quiet note to the user instead of looping forever.
//   - SILENT SUCCESS: when a recovery works, it's invisible. The user
//     just sees the agent keep going.
//
// FEATURE FLAG: ENABLE_COPILOT=true (in .env.local)
//
// Hooks:
//   - reportToolEvent(toolName, error?) — called from middleware post-hook
//   - reportPhase(sessionId, phase) — called from the agent loop
//   - detectSaturation(sessionId) — returns a recovery prompt or null
//   - call() — the main entry: called by the loop after a stall is seen

import { getGovernorState } from "./rate-governor";

const COPILOT_FLAG = process.env.ENABLE_COPILOT === "true";
const MAX_RECOVERIES_PER_SESSION = 3;
const RECOVERY_BACKOFF_MS = 45_000; // wait 45s after a stall before re-prompting
const SATURATION_LOOKBACK_MS = 60_000; // how far back to look for throttle evidence

// ── Per-session recovery state ──
interface RecoveryState {
  recoveriesUsed: number;
  lastRecoveryAt: number;
  lastGoodStep: string | null; // last concrete step before the stall
  notifiedUser: boolean; // we've already surfaced the "giving up" note
}

const sessionState = new Map<string, RecoveryState>();

// Recent throttle events observed in the tool loop (endpoint, timestamp)
const recentThrottleEvents: { tool: string; at: number }[] = [];

export function reportThrottleEvent(tool: string): void {
  if (!COPILOT_FLAG) return;
  recentThrottleEvents.push({ tool, at: Date.now() });
  // Keep the buffer small
  while (recentThrottleEvents.length > 20) recentThrottleEvents.shift();
}

export function reportToolEvent(toolName: string, error?: string): void {
  if (!COPILOT_FLAG) return;
  if (error && /429|503|408|rate\s*limit|too\s*many/i.test(error)) {
    reportThrottleEvent(toolName);
  }
}

export function setLastGoodStep(sessionId: string, step: string): void {
  if (!COPILOT_FLAG) return;
  const s = getState(sessionId);
  if (step && step.length < 300) s.lastGoodStep = step;
}

function getState(sessionId: string): RecoveryState {
  let s = sessionState.get(sessionId);
  if (!s) {
    s = { recoveriesUsed: 0, lastRecoveryAt: 0, lastGoodStep: null, notifiedUser: false };
    sessionState.set(sessionId, s);
  }
  return s;
}

// ── Saturation detection (pure rules, no LLM) ──

/** True if the governor reports all routes saturated / unhealthy. */
function allModelsSaturated(): boolean {
  const state = getGovernorState();
  const routes = Object.values(state) as any[];
  if (routes.length === 0) return false;
  const saturated = routes.filter((r) => (r.tokensLeft ?? 0) <= 0 || (r.callsInWindow ?? 0) >= (r.rpmCap ?? Infinity));
  return saturated.length > 0 && saturated.length >= Math.ceil(routes.length * 0.6);
}

/** True if a throttle event was observed recently. */
function recentThrottle(): boolean {
  const cutoff = Date.now() - SATURATION_LOOKBACK_MS;
  return recentThrottleEvents.some((e) => e.at >= cutoff);
}

/** The main detection: should we re-prompt? */
export function detectSaturation(sessionId: string): { stalled: boolean; reason: string } {
  if (!COPILOT_FLAG) return { stalled: false, reason: "copilot disabled" };
  const s = getState(sessionId);
  if (s.recoveriesUsed >= MAX_RECOVERIES_PER_SESSION) {
    return { stalled: false, reason: "recovery budget exhausted" };
  }
  if (Date.now() - s.lastRecoveryAt < RECOVERY_BACKOFF_MS) {
    return { stalled: false, reason: "still in backoff window" };
  }
  if (recentThrottle()) {
    return { stalled: true, reason: "recent rate-limit events observed" };
  }
  if (allModelsSaturated()) {
    return { stalled: true, reason: "all model routes saturated" };
  }
  return { stalled: false, reason: "no stall detected" };
}

// ── Recovery prompt (fixed template) ──

export function recoveryPrompt(sessionId: string): string | null {
  if (!COPILOT_FLAG) return null;
  const s = getState(sessionId);
  if (s.recoveriesUsed >= MAX_RECOVERIES_PER_SESSION) return null;

  s.recoveriesUsed++;
  s.lastRecoveryAt = Date.now();

  const step = s.lastGoodStep ? ` You were working on: "${s.lastGoodStep}".` : "";
  return `[co-pilot] The backend was briefly rate-limited. It should be clear now. Please continue the job.${step} Keep going with the next step.`;
}

/** Called when the loop detects a stall — returns the recovery prompt to
 *  inject into the agent conversation, or null if we shouldn't. */
export function copilotRecover(sessionId: string, lastGoodStep?: string | null): string | null {
  if (!COPILOT_FLAG) return null;
  if (lastGoodStep) setLastGoodStep(sessionId, lastGoodStep);
  const { stalled } = detectSaturation(sessionId);
  if (!stalled) return null;
  return recoveryPrompt(sessionId);
}

/** Should we surface a note to the user? Only after the recovery budget
 *  is exhausted AND a stall is still happening. */
export function shouldNotifyUser(sessionId: string): boolean {
  if (!COPILOT_FLAG) return false;
  const s = getState(sessionId);
  if (s.notifiedUser) return false;
  if (s.recoveriesUsed >= MAX_RECOVERIES_PER_SESSION && recentThrottle()) {
    s.notifiedUser = true;
    return true;
  }
  return false;
}

export function getCopilotState(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [sid, s] of sessionState) {
    out[sid] = { ...s, recoveriesLeft: MAX_RECOVERIES_PER_SESSION - s.recoveriesUsed };
  }
  return out;
}

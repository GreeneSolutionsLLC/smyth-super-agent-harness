/**
 * Chat state extraction.
 *
 * The Warden doesn't need to screenshot the page. The page already has the chat
 * state in React. We expose a small JSON snapshot that the Operator can read
 * directly. No vision model, no browser control, no OCR.
 *
 * The page POSTs its state here on a timer (every 5s) AND on event boundaries
 * (tool error, message complete, agent stopped). The Warden reads the latest
 * state when it ticks, and the chat-state layer also emits a "trigger" so the
 * engagement-store can request an immediate tick on important events.
 */

import type { DomSnapshot, ErrorContext } from "./types";
import { loadChatState, persistChatState } from "./fs-state";

interface ChatStatePayload {
  lastActivityAt: string;
  lastPhase: string;
  streamOpen: boolean;
  userInputFocused: boolean;
  userInputHasText: boolean;
  lastMessageText: string;       // tail of the latest assistant message (last 1500 chars)
  lastMessageRole: "user" | "assistant" | "tool" | "system" | null;
  recentEvents: string[];         // last 5 events, oldest first
  sessionId: string | null;
  messages: { role: string; content: string }[];  // recent chat messages for injection context
}

let latestState: ChatStatePayload | null = null;
let lastUpdated: number = 0;
const STALE_THRESHOLD_MS = 60_000; // 60s without an update = assume page is gone

// Hydrate from disk on module load (survives dev hot-reloads & restarts).
{
  const saved = loadChatState() as ChatStatePayload | null;
  if (saved && saved.lastActivityAt) {
    latestState = saved;
    // Staleness is judged against the payload's OWN lastActivityAt (the last
    // real user/agent activity), NOT against hydration time — otherwise a
    // server restart re-baselines the clock and the state goes "stale" 60s
    // after boot even when it's perfectly fresh.
    lastUpdated = Math.min(Date.now(), new Date(saved.lastActivityAt).getTime() + 30_000);
    console.log("[operator] hydrated chat state from disk");
  }
}

// Subscribers are notified on every state ingest so the engagement-store can
// react to events (errors, message completion) without polling.
type IngestListener = (state: ChatStatePayload, prevState: ChatStatePayload | null, trigger: IngestTrigger) => void;
const ingestListeners: IngestListener[] = [];

export type IngestTrigger = "none" | "immediate" | "defer";

export function ingestChatState(payload: ChatStatePayload): void {
  const prev = latestState;
  latestState = payload;
  lastUpdated = Date.now();
  persistChatState(payload);
  const trigger = deriveTrigger(payload, prev);
  for (const listener of ingestListeners) {
    try {
      listener(payload, prev, trigger);
    } catch (e) {
      // Don't let one bad listener break the rest
      console.error(`[operator/chat-state] listener error: ${(e as Error).message}`);
    }
  }
}

export function onIngest(listener: IngestListener): () => void {
  ingestListeners.push(listener);
  return () => {
    const idx = ingestListeners.indexOf(listener);
    if (idx >= 0) ingestListeners.splice(idx, 1);
  };
}

/**
 * Decide whether the new state warrants an immediate operator tick, a deferred
 * tick, or nothing.
 *
 *   "immediate" — fire a tick within 2-5s. Used for tool errors, rate-limit
 *                  messages, and the agent finishing a response (catch any
 *                  permission dialogs the agent is waiting on).
 *   "defer"     — the agent is making clear progress; engagement-store may
 *                  push the next scheduled tick out to save LLM calls.
 *   "none"      — nothing notable; respect the normal schedule.
 */
function deriveTrigger(state: ChatStatePayload, prev: ChatStatePayload | null): IngestTrigger {
  // First ingest after engagement started: nothing to compare to.
  if (!prev) return "none";

  // Don't trigger on user input — the operator stays out of the way when the
  // human is at the keyboard. But allow intervention on errors even if the
  // user has focus (they're probably just waiting for the agent to recover).
  const hasError = errorSignature(state.lastMessageText) || rateLimitSignature(state.lastMessageText);
  if (!hasError && (state.userInputFocused || state.userInputHasText)) return "none";

  // Did the latest message text newly show an error signature that wasn't in
  // the previous state? Then we want the operator to look at it now.
  if (errorSignature(state.lastMessageText) && !errorSignature(prev.lastMessageText)) {
    return "immediate";
  }

  // Did the agent just finish a streamed response (streamOpen: true → false)?
  // This is when permission dialogs or "what next?" states appear, and we
  // want the operator ready to inject a continue if the agent goes idle.
  if (prev.streamOpen && !state.streamOpen && state.lastMessageRole === "assistant") {
    return "immediate";
  }

  // Rate-limit keyword appears in the latest text but wasn't there before.
  if (rateLimitSignature(state.lastMessageText) && !rateLimitSignature(prev.lastMessageText)) {
    return "immediate";
  }

  // Agent is making clear, healthy progress — defer the next tick.
  if (state.streamOpen && progressScore(state, prev) > 0.1) {
    return "defer";
  }

  return "none";
}

// ── Signature helpers ──

function errorSignature(text: string): boolean {
  if (!text) return false;
  return /\b(failed to call|tool call failed|error|exception|rate[ _-]?limit|429|500|502|503|504|unhandled|traceback|stack trace|pool.{0,20}exhausted|all model pools|no available models|provider.{0,30}(overloaded|unavailable))\b/i.test(text);
}

function rateLimitSignature(text: string): boolean {
  if (!text) return false;
  return /\b(rate[ _-]?limit(?:ed)?|too many requests|429|try again later|cool[ _-]?down|backoff|throttl)\b/i.test(text);
}

function progressScore(state: ChatStatePayload, prev: ChatStatePayload): number {
  // Cheap proxy: if the latest message text grew, how much of it is new?
  const prevWords = new Set((prev.lastMessageText || "").toLowerCase().split(/\s+/).slice(-200));
  const curWords = (state.lastMessageText || "").toLowerCase().split(/\s+/).slice(-200);
  if (curWords.length === 0) return 0;
  let newCount = 0;
  for (const w of curWords) if (!prevWords.has(w)) newCount++;
  return Math.min(1, newCount / curWords.length);
}

export function getChatState(): ChatStatePayload | null {
  if (!latestState) return null;
  // Staleness baseline = last real activity (or hydration time as a floor),
  // so a hydrated state isn't rejected just because the server restarted.
  const activityMs = new Date(latestState.lastActivityAt).getTime();
  const baseline = Math.max(lastUpdated, Number.isFinite(activityMs) ? activityMs : 0);
  if (Date.now() - baseline > STALE_THRESHOLD_MS) return null;
  return latestState;
}

/**
 * Scan the recent messages for an error pattern and classify it. Used by the
 * tick layer to give the Warden concrete context for recovery prompts.
 *
 * Walks messages newest-first, picks the FIRST (most recent) error match.
 * Then picks the last "good" assistant step *before* that error so the
 * recovery prompt can reference a concrete next action.
 */
export function extractErrorContext(
  messages: { role: string; content: string }[],
  backoffSec: number = 45,
  recoveryAttempts: number = 0
): ErrorContext | null {
  if (!messages || messages.length === 0) return null;

  // Walk newest → oldest, find the most recent assistant/tool message with an error.
  let matchedMsg: { role: string; content: string; index: number } | null = null;
  let classification: { type: ErrorContext["type"]; rawMatch: string } | null = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" && m.role !== "tool" && m.role !== "system") continue;
    const t = m.content || "";
    if (!t) continue;

    // 1. Model pool unavailable — OmniRoute / pool-router 5xx / "all pools unavailable"
    const poolMatch = t.match(/(all model pools are currently unavailable|no available models|pool.{0,20}exhausted|provider.{0,30}(overloaded|unavailable|503)|upstream.{0,20}(failed|unavailable))/i);
    if (poolMatch) {
      matchedMsg = { ...m, index: i };
      classification = { type: "model_pool_unavailable", rawMatch: poolMatch[0] };
      break;
    }

    // 2. Rate limit
    const rlMatch = t.match(/\b(rate[ _-]?limit|too many requests|429|try again later|cool[ -]?down|backoff|throttl)/i);
    if (rlMatch) {
      matchedMsg = { ...m, index: i };
      classification = { type: "rate_limit", rawMatch: rlMatch[0] };
      break;
    }

    // 3. Auth revoked
    const authMatch = t.match(/\b(401|403|unauthori[sz]ed|forbidden|api[ _-]?key.{0,30}(invalid|revoked|missing)|not authorized|authentication failed)\b/i);
    if (authMatch) {
      matchedMsg = { ...m, index: i };
      classification = { type: "auth_revoked", rawMatch: authMatch[0] };
      break;
    }

    // 4. Timeout
    const timeoutMatch = t.match(/\b(timeout|timed out|ETIMEDOUT|ECONNRESET|connection (refused|reset)|fetch failed|network (error|unreachable))\b/i);
    if (timeoutMatch) {
      matchedMsg = { ...m, index: i };
      classification = { type: "timeout", rawMatch: timeoutMatch[0] };
      break;
    }

    // 5. Syntax / parse / unhandled
    const syntaxMatch = t.match(/\b(syntax(error|_error)|unexpected token|parse error|unhandled (promise|rejection)|traceback|stack ?trace|invalid (json|response))\b/i);
    if (syntaxMatch) {
      matchedMsg = { ...m, index: i };
      classification = { type: "syntax", rawMatch: syntaxMatch[0] };
      break;
    }

    // 6. Generic crash — "agent crashed", "process exited", "stream closed unexpectedly"
    const crashMatch = t.match(/\b(crashed|process exited|stream.{0,30}(closed|ended) (unexpectedly|abnormally)|fatal error|panic:|segfault)\b/i);
    if (crashMatch) {
      matchedMsg = { ...m, index: i };
      classification = { type: "crash", rawMatch: crashMatch[0] };
      break;
    }

    // Generic fallback for "failed to call" / "exception:" / "error:" — keep walking
    // unless we find a more specific match above. We only break on the first hit
    // (newest first), so if the latest error message is generic, we still match it
    // and let the prompt classify.
    if (errorSignature(t)) {
      matchedMsg = { ...m, index: i };
      classification = { type: "unknown", rawMatch: t.slice(0, 120) };
      break;
    }
  }

  if (!matchedMsg || !classification) return null;

  // Backoff by error type. Pool/rate-limit errors need longer because the upstream
  // provider is the bottleneck; auth_revoked is permanent (no point waiting);
  // syntax/crash are usually fixed by retrying with a smaller payload.
  const typeBackoff: Record<ErrorContext["type"], number> = {
    rate_limit: 45,
    model_pool_unavailable: 60,
    timeout: 15,
    syntax: 10,
    crash: 20,
    auth_revoked: 0, // no point waiting — model is dead
    unknown: 30,
  };
  const suggestedBackoffSec = classification.type === "auth_revoked"
    ? 0
    : Math.max(backoffSec, typeBackoff[classification.type]);

  // Walk backwards from the error to find the last "good" concrete step the
  // agent was on. We look for tool/job mentions, "running X", "calling X",
  // shell commands, etc. If nothing, fall back to the last non-error assistant
  // message content (truncated).
  let lastGoodStep: string | null = null;
  for (let j = matchedMsg.index - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role !== "assistant") continue;
    const t = (m.content || "").trim();
    if (!t || errorSignature(t)) continue;
    // Prefer the first line that looks like a concrete action
    const concrete = t.match(/(?:^|\n)(?:[-*]\s+|Running\s+|Calling\s+|Using\s+|shell_status|shell_exec|wrote\s+|created\s+|installed\s+|wrote\s+to\s+|started\s+|executing\s+)(.{1,200})/i);
    if (concrete) {
      lastGoodStep = concrete[1].trim();
      break;
    }
    // Fallback: first non-empty line of the message, capped at 160 chars
    const firstLine = t.split(/\n/).find((l) => l.trim().length > 0) || "";
    if (firstLine) {
      lastGoodStep = firstLine.slice(0, 160);
      break;
    }
  }

  return {
    type: classification.type,
    rawMatch: classification.rawMatch,
    matchedMessageRole: matchedMsg.role as ErrorContext["matchedMessageRole"],
    suggestedBackoffSec,
    recoveryAttempts,
    lastGoodStep,
  };
}

export function buildDomSnapshot(state: ChatStatePayload): DomSnapshot {
  return {
    lastActivityAt: state.lastActivityAt,
    lastPhase: state.lastPhase,
    secondsSinceActivity: Math.max(0, Math.floor((Date.now() - new Date(state.lastActivityAt).getTime()) / 1000)),
    streamOpen: state.streamOpen,
    userInputFocused: state.userInputFocused,
    userInputHasText: state.userInputHasText,
    recentEvents: state.recentEvents,
  };
}

/**
 * Build VisionSignals from the chat state. No actual vision model — we treat
 * the latest message text as the "OCR text" since it's the textual content the
 * agent is producing. This works for a chat-watch Warden because the chat
 * content is the only thing the Operator needs to "see."
 */
export function buildVisionSignals(state: ChatStatePayload, previousState: ChatStatePayload | null): {
  ocrText: string;
  ocrTextLen: number;
  hasErrorKeywords: boolean;
  hasPermissionKeywords: boolean;
  hasCompletionKeywords: boolean;
  hasBackgroundJob: boolean;
  lastJobId: string | null;
  frameChangeScore: number;
  brightness: "bright" | "dim" | "dark";
  contrast: "high contrast" | "medium contrast" | "low contrast";
  textRegionCount: number;
} {
  const ocrText = (state.lastMessageText || "").slice(-1500);

  const hasErrorKeywords = /\b(error|failed|timeout|exception|429|500|502|503|504)\b/i.test(ocrText)
    && !/\bno error\b/i.test(ocrText)
    && !/\b0 error/i.test(ocrText);

  const hasPermissionKeywords = /\b(allow|approve|continue\?|proceed\?|may i|shall i|do you want|confirm)\b/i.test(ocrText);

  const hasCompletionKeywords = /\b(done|complete|finished|success|task complete|here is the|here's the|final answer)\b/i.test(ocrText);

  // Background-job token detector. The shell tool returns jobIds in the form
  // "job_<6+ hex>" when background=true. If the chat mentions one, the agent
  // is (probably) waiting on it. Capture the most recent token so the Operator
  // can reference it in the injected prompt.
  const jobIdMatches = ocrText.match(/job_[0-9a-f]{6,}/gi);
  const lastJobId = jobIdMatches && jobIdMatches.length > 0 ? jobIdMatches[jobIdMatches.length - 1] : null;
  const hasBackgroundJob = !!lastJobId;

  // Frame change = how different is this text from the last one we saw
  const frameChangeScore = previousState
    ? textDiffScore(previousState.lastMessageText || "", state.lastMessageText || "")
    : 0.5;

  return {
    ocrText,
    ocrTextLen: ocrText.length,
    hasErrorKeywords,
    hasPermissionKeywords,
    hasCompletionKeywords,
    hasBackgroundJob,
    lastJobId,
    frameChangeScore,
    brightness: "bright", // not measured; placeholder
    contrast: "high contrast",
    textRegionCount: ocrText.split(/\s+/).filter(Boolean).length,
  };
}

function textDiffScore(a: string, b: string): number {
  if (a === b) return 0;
  if (!a || !b) return 1;
  // Simple Jaccard-ish: how many of b's words are new?
  const aWords = new Set(a.toLowerCase().split(/\s+/).slice(-200));
  const bWords = b.toLowerCase().split(/\s+/).slice(-200);
  if (bWords.length === 0) return 0;
  let newCount = 0;
  for (const w of bWords) if (!aWords.has(w)) newCount++;
  return Math.min(1, newCount / bWords.length);
}

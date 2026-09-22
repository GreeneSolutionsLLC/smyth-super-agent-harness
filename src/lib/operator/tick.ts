/**
 * Warden tick.
 *
 * One cycle of: read chat state → build OperatorInput → call Operator LLM →
 * execute decision → schedule next tick.
 *
 * Triggered two ways:
 *   1. Scheduled tick (slow heartbeat, default 60s) — catches the "agent
 *      went completely silent" case.
 *   2. Immediate tick (event-driven, default 2-5s after trigger) — fired when
 *      the chat-state ingest detects a tool error, rate-limit message, or
 *      message completion. Lets the operator react to important events
 *      without waiting for the next heartbeat.
 *
 * Lives in the engagement-store so each engagement has its own tick chain.
 */

import { callOperator } from "./llm";
import { getChatState, buildDomSnapshot, buildVisionSignals, onIngest, extractErrorContext } from "./chat-state";
import { recordDecision, updateEngagement, setTickTimer, getEngagement, requestImmediateTick, deferNextTick } from "./engagement-store";
import { emitEvent } from "./event-bus";
import type { OperatorEngagement, OperatorInput, WardenDecision } from "./types";
import { getJob } from "../jobs";

// Module-level cache of last seen state for diff calculation
const lastSeenState: { text: string; timestamp: number } = { text: "", timestamp: 0 };

let previousChatState: any = null;

// Track which engagements have a chat-session-id-sync listener registered so
// we don't double-register. Per-engagement listener: when ingest fires an
// "immediate" trigger for this engagement's chat session, ask for an
// immediate tick. When it fires "defer", push the next scheduled tick out.
const ingestSubscribed = new Set<string>();

function ensureIngestSubscription(engagementId: string, chatSessionId: string | null) {
  if (ingestSubscribed.has(engagementId)) return;
  ingestSubscribed.add(engagementId);
  onIngest((state, prev, trigger) => {
    if (trigger === "none") return;
    // Only react if the ingest is for the chat this engagement is watching.
    // chatSessionId may be null until the first sync, in which case we
    // accept any ingest (the operator started before the user sent a message).
    if (chatSessionId && state.sessionId !== chatSessionId) return;
    if (trigger === "immediate") {
      requestImmediateTick(engagementId, "event:immediate-trigger");
    } else if (trigger === "defer") {
      deferNextTick(engagementId);
    }
  });
}

export { ensureIngestSubscription };

export type TickSource = "scheduled" | "immediate" | "first" | "manual";

export async function runTick(engagementId: string, opts?: { source?: TickSource; reason?: string }): Promise<void> {
  const engagement = getEngagement(engagementId);
  if (!engagement) {
    console.log(`[operator] tick: engagement ${engagementId} not found, stopping`);
    ingestSubscribed.delete(engagementId);
    return;
  }
  if (engagement.status !== "running") {
    console.log(`[operator] tick: engagement ${engagementId} status=${engagement.status}, stopping`);
    ingestSubscribed.delete(engagementId);
    return;
  }

  // Subscribe this engagement to chat-state ingest events so future events
  // can fire immediate / deferred ticks. Idempotent.
  ensureIngestSubscription(engagementId, engagement.chatSessionId);

  // If we have a pending injection scheduled (e.g. waiting 45s for a rate
  // limit to clear), defer this tick unless it's a manual override. The
  // scheduled injection will fire on its own; we don't need another decision
  // right now. deferNextTick re-arms at tick_interval_ms, which gives the
  // injection time to fire first.
  if (engagement.pendingInjection && opts?.source !== "manual") {
    const remainingMs = engagement.pendingInjection.scheduledFor - Date.now();
    if (remainingMs > 0) {
      console.log(`[operator] tick: pending injection scheduled in ${Math.round(remainingMs / 1000)}s, deferring this tick`);
      deferNextTick(engagementId);
      return;
    }
    // If the scheduled time has passed but the timer hasn't fired yet (rare
    // race), cancel and let this tick proceed normally.
    cancelPendingInjection(engagement);
  }

  const source = opts?.source || "scheduled";
  const reason = opts?.reason || "";

  // Check engagement time cap
  const elapsedMs = Date.now() - new Date(engagement.startedAt).getTime();
  if (elapsedMs > engagement.policy.max_engagement_ms) {
    console.log(`[operator] tick: engagement ${engagementId} exceeded time cap, stopping`);
    updateEngagement(engagementId, { status: "completed", stopReason: "max_engagement_ms reached" });
    ingestSubscribed.delete(engagementId);
    return;
  }

  // 1. Read chat state
  const state = getChatState();
  if (!state) {
    console.log(`[operator] tick: no chat state available, will retry next tick`);
    scheduleNextTick(engagementId);
    return;
  }

  // 1b. Sync the real chat session ID from ingested state.
  if (state.sessionId && state.sessionId !== engagement.chatSessionId) {
    console.log(`[operator] tick: syncing chatSessionId ${engagement.chatSessionId} → ${state.sessionId}`);
    updateEngagement(engagementId, { chatSessionId: state.sessionId });
    engagement.chatSessionId = state.sessionId;
    // Re-register the ingest subscription with the now-known chat session id
    // so subsequent triggers only fire for THIS chat's events.
    ingestSubscribed.delete(engagementId);
    ensureIngestSubscription(engagementId, engagement.chatSessionId);
  }

  // 2. Build Operator input
  const vision = buildVisionSignals(state, previousChatState);
  const dom = buildDomSnapshot(state);
  previousChatState = state;

  // 2a. Extract error context from recent chat messages — pattern-match for
  // rate-limit, auth-revoked, pool-exhaustion, timeout, crash patterns so the
  // Operator can produce a targeted recovery prompt instead of a generic
  // "continue with next step." Recovery attempts count only errors of the
  // SAME type as the latest one — different errors reset the counter.
  const rawMessages = (state.messages || []).slice(-10);
  const recentMessages = rawMessages.map((m: any) => ({
    role: (m.role || "assistant") as "user" | "assistant" | "tool" | "system",
    content: m.content || "",
    timestamp: m.timestamp || undefined,
  }));
  const backoffSec = engagement.policy.error_recovery_backoff_sec ?? 45;
  const maxAttempts = engagement.policy.error_recovery_max_attempts ?? 3;
  // Count recovery attempts: how many prior decisions for THIS engagement were
  // "continue" actions triggered by an error of the same type? Cheap proxy:
  // count prior continue actions that came right after a non-no_op decision.
  const priorErrorContinues = engagement.decisions.filter(
    (d) => d.action === "continue" && (d as any).recoveryForError
  ).length;
  const errorContext = extractErrorContext(recentMessages as any, backoffSec, priorErrorContinues);

  const input: OperatorInput = {
    sessionId: engagement.sessionId,
    taskSummary: engagement.policy.taskSummary,
    vision: {
      ...vision,
      frameTimestamp: new Date().toISOString(),
    },
    dom,
    policy: engagement.policy,
    spendSoFarUsd: engagement.spendSoFarUsd,
    autoContinuesUsed: engagement.autoContinuesUsed,
    recentDecisions: engagement.decisions.slice(-5),
    recentMessages,
    errorContext,
  };

  // 2b. Deterministic background-job path (bypasses LLM pool entirely).
  // If the latest assistant message contains a jobId, check its real status.
  // If it's complete and we haven't already auto-continued for it, inject a
  // continuation so the agent reports the result. This works even when the
  // LLM pool is down.
  const jobId = vision.lastJobId;
  if (jobId && !state.streamOpen && state.userInputFocused === false && state.userInputHasText === false) {
    const job = getJob(jobId);
    if (job && (job.status === "completed" || job.status === "failed") && !engagement.handledJobIds?.includes(jobId)) {
      const handled = engagement.handledJobIds || [];
      handled.push(jobId);
      updateEngagement(engagementId, {
        handledJobIds: handled,
        lastJobContinueAt: new Date().toISOString(),
      });
      const prompt = `The background job ${jobId} has ${job.status === "completed" ? "completed" : "failed"}${job.exitCode !== null && job.exitCode !== undefined ? ` with exit code ${job.exitCode}` : ""}. Call shell_status with jobId="${jobId}" to get the latest log tail and report the result to the user.`;
      console.log(`[operator] deterministic job-continue: ${jobId} ${job.status}`);
      await injectContinuation(engagement, prompt);
      // Treat this as a "continue" decision for budget/cap tracking, then
      // schedule the next tick normally.
      recordDecision(engagementId, {
        action: "continue",
        reason: `Background job ${jobId} ${job.status}; deterministic auto-continue.`,
        confidence: 1.0,
        suggestedPrompt: prompt,
      });
      scheduleNextTick(engagementId);
      return;
    }
  }

  // 3. Call the Operator LLM
  let decision: WardenDecision;
  try {
    decision = await callOperator(input, engagement.llm);
  } catch (e: any) {
    console.error(`[operator] tick: Operator LLM error: ${e.message?.slice(0, 200)}`);
    // On error, defer to next tick (conservative)
    scheduleNextTick(engagementId);
    return;
  }

  // 4. Record the decision
  decision.id = decision.id || `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  recordDecision(engagementId, decision);
  console.log(`[operator] tick ${engagementId} [${source}${reason ? ':' + reason : ''}]: action=${decision.action} conf=${decision.confidence.toFixed(2)} — ${decision.reason}`);

  // 4b. Emit the decision to any SSE subscribers
  emitEvent(engagementId, {
    type: "decision",
    timestamp: new Date().toISOString(),
    data: decision,
  });

  // 5. Execute the decision
  await executeDecision(engagementId, decision, engagement);

  // 6. If we aborted or completed, stop the loop
  if (decision.action === "abort") {
    updateEngagement(engagementId, { status: "aborted", stopReason: decision.abortReason || decision.reason });
    ingestSubscribed.delete(engagementId);
    // Fire-and-forget review
    import("./review").then(({ reviewEngagement }) => {
      reviewEngagement(engagementId).catch((e) => {
        console.error(`[operator] review failed: ${e?.message || e}`);
      });
    });
    return;
  }

  // 7. Schedule next tick (slow heartbeat)
  scheduleNextTick(engagementId);
}

function scheduleNextTick(engagementId: string): void {
  const engagement = getEngagement(engagementId);
  if (!engagement || engagement.status !== "running") return;
  // Use the smaller of tick_interval_ms and (heartbeat_max_gap_ms - elapsed).
  // The heartbeat cap is the absolute safety net: even if every tick is
  // deferred, we fire at least this often since engagement start.
  const elapsedMs = Date.now() - new Date(engagement.startedAt).getTime();
  const capRemaining = Math.max(0, engagement.policy.heartbeat_max_gap_ms - elapsedMs);
  const delayMs = Math.min(engagement.policy.tick_interval_ms, capRemaining || engagement.policy.tick_interval_ms);
  const timer = setTimeout(() => {
    runTick(engagementId, { source: "scheduled", reason: "heartbeat" }).catch((e) => {
      console.error(`[operator] tick error: ${e}`);
    });
  }, delayMs);
  setTickTimer(engagementId, timer);
}

async function executeDecision(engagementId: string, decision: WardenDecision, engagement: OperatorEngagement): Promise<void> {
  switch (decision.action) {
    case "no_op":
      // Nothing to do
      break;

    case "continue":
      if (decision.suggestedPrompt) {
        await injectContinuation(
          engagement,
          decision.suggestedPrompt,
          decision.model,
          decision.delaySec,
          decision.id
        );
      }
      break;

    case "answer_dialog":
      if (decision.dialogResponse) {
        await injectContinuation(
          engagement,
          decision.dialogResponse,
          decision.model,
          decision.delaySec,
          decision.id
        );
      }
      break;

    case "notify_user":
      console.log(`[operator] NOTIFY: ${decision.notifiedMessage || decision.reason}`);
      // v1: log only. Future: email/push.
      break;

    case "abort":
      console.log(`[operator] ABORT: ${decision.abortReason || decision.reason}`);
      break;
  }
}

/**
 * Inject a continuation prompt into the running agent.
 *
 * v2 approach: the Warden emits an SSE event telling the client to inject
 * the prompt.  The client's onInjection callback calls sendPrompt() which
 * triggers the real /api/agent/stream flow with full UI streaming, tool
 * progress, and the existing message history.
 *
 * The Warden does NOT call /api/agent/stream itself — that would produce a
 * separate response outside the chat UI.  The client is the one that drives
 * the agent; the Warden just tells it what to say.
 */
/** Module-scoped map of pending injection timers, keyed by engagement sessionId.
 *  We can't store NodeJS.Timeout in JSON state (it doesn't serialize), so we
 *  keep the handle here and the metadata in engagement.pendingInjection. */
const pendingInjectionTimers = new Map<string, NodeJS.Timeout>();

/** Cancel any pending injection timer for this engagement. Called when the
 *  engagement stops or when a new tick supersedes the previous scheduled
 *  injection (e.g. the user replied, error escalated, etc.). */
export function cancelPendingInjection(engagement: OperatorEngagement): void {
  const timer = pendingInjectionTimers.get(engagement.sessionId);
  if (timer) {
    clearTimeout(timer);
    pendingInjectionTimers.delete(engagement.sessionId);
  }
  engagement.pendingInjection = null;
}

/** Schedule an injection to fire after delaySec. While the timer is pending,
 *  subsequent ticks should see engagement.pendingInjection and defer
 *  (handled in runTick). If the engagement stops first, the timer is
 *  cancelled via cancelPendingInjection. */
async function injectContinuation(
  engagement: OperatorEngagement,
  prompt: string,
  model?: string,
  delaySec?: number,
  decisionId?: string
): Promise<void> {
  if (!engagement.chatSessionId) {
    console.warn(`[operator] no chatSessionId yet for engagement ${engagement.sessionId} — user hasn't started chatting, skipping injection`);
    return;
  }

  // Cancel any prior pending injection — this one supersedes it
  cancelPendingInjection(engagement);

  const delayMs = Math.max(0, Math.min((delaySec || 0) * 1000, 5 * 60 * 1000)); // cap at 5 minutes
  const scheduledFor = Date.now() + delayMs;

  if (delayMs === 0) {
    console.log(`[operator] injecting: "${prompt.slice(0, 80)}"`);
    emitInjection(engagement, prompt, model);
  } else {
    const id = decisionId || `inj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    engagement.pendingInjection = { decisionId: id, prompt, model, scheduledFor };
    console.log(`[operator] scheduling injection in ${delaySec}s: "${prompt.slice(0, 80)}" (id=${id})`);
    const timer = setTimeout(() => {
      pendingInjectionTimers.delete(engagement.sessionId);
      // Re-fetch engagement in case it was stopped/updated during the wait
      const eng = getEngagement(engagement.sessionId);
      if (!eng || eng.status !== "running") {
        console.log(`[operator] pending injection ${id} cancelled — engagement no longer running`);
        return;
      }
      eng.pendingInjection = null;
      console.log(`[operator] firing scheduled injection: "${prompt.slice(0, 80)}" (id=${id})`);
      emitInjection(eng, prompt, model);
    }, delayMs);
    pendingInjectionTimers.set(engagement.sessionId, timer);
    // Emit a "scheduled" event so the UI can show what's queued
    emitEvent(engagement.sessionId, {
      type: "scheduled",
      timestamp: new Date().toISOString(),
      data: {
        decisionId: id,
        prompt,
        model: model || null,
        delaySec,
        scheduledFor: new Date(scheduledFor).toISOString(),
      },
    });
  }
}

function emitInjection(engagement: OperatorEngagement, prompt: string, model?: string): void {
  emitEvent(engagement.sessionId, {
    type: "injection",
    timestamp: new Date().toISOString(),
    data: {
      success: true,
      prompt,
      // No reply — the client will trigger sendPrompt() which streams the
      // agent response directly into the chat UI.
      reply: "",
      model: model || null,
    },
  });
}

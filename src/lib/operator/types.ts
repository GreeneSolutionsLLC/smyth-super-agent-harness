/**
 * Operator (Warden) — types
 *
 * The Operator watches one AI agent's chat UI and decides whether to intervene.
 * "Operator" is the new name for what was "Computer Use" mode in the UI.
 */

// ── Engagement policy (frozen for one session, written at engagement start) ──

export interface EngagementPolicy {
  task: string;
  taskSummary: string;          // one-line description used in Operator prompt
  auto_continue: boolean;
  auto_continue_prompt: string; // templated, e.g. "Please continue with the next step."
  max_auto_continues: number;
  auto_answer_permitted: string[]; // whitelist of dialog responses
  spend_cap_usd: number;
  notify_user_on: string[];     // e.g. ["task_complete", "error_persisting_2x"]
  abort_on: string[];           // e.g. ["spend_100pct", "agent_loops_3x"]
  tick_interval_ms: number;     // scheduled tick cadence (default 60000 — slow heartbeat)
  heartbeat_max_gap_ms: number; // hard cap: tick at least this often even with deferrals (default 120000)
  max_engagement_ms: number;    // hard cap (default 4h)
  // Error recovery — when the agent hits a rate limit / model pool error / crash,
  // how should the Operator recover? Defaults are conservative; tune via policy.
  error_recovery_backoff_sec?: number;   // wait this many seconds before injecting the recovery prompt (default 45)
  error_recovery_max_attempts?: number;  // how many recovery attempts before notifying the user (default 3)
  error_recovery_include_last_step?: boolean; // whether the recovery prompt should quote the last good step (default true)
}

// ── Vision-derived signals (from Echo Vision raw JSON) ──

export interface VisionSignals {
  frameTimestamp: string;       // ISO
  ocrText: string;              // latest OCR'd text from the chat panel (newest last)
  ocrTextLen: number;
  hasErrorKeywords: boolean;    // matches /\b(error|failed|timeout|exception)\b/i
  hasPermissionKeywords: boolean; // matches /\b(allow|approve|continue\?|proceed\?)\b/i
  hasCompletionKeywords: boolean;  // matches /\b(done|complete|finished|success)\b/i
  hasBackgroundJob: boolean;   // matches /job_[0-9a-f]{6,}/i — a background-job token is visible
  lastJobId: string | null;     // the most recent job_xxxxxxxx token found, if any
  frameChangeScore: number;     // 0=identical, 1=totally different (vs last frame)
  brightness: string;           // "bright" | "dim" | "dark"
  contrast: string;
  textRegionCount: number;
}

// ── DOM snapshot (from the page, not the screenshot) ──

export interface DomSnapshot {
  lastActivityAt: string;       // ISO
  lastPhase: string;            // e.g. "running_tool:web_search" | "streaming" | "idle"
  secondsSinceActivity: number;
  streamOpen: boolean;
  userInputFocused: boolean;
  userInputHasText: boolean;
  recentEvents: string[];       // last 5 events, oldest first
}

// ── Operator input (everything the LLM needs) ──

export interface ErrorContext {
  type: "rate_limit" | "auth_revoked" | "model_pool_unavailable" | "timeout" | "crash" | "syntax" | "unknown";
  rawMatch: string;             // the matched line/snippet from the latest assistant message
  matchedMessageRole: "user" | "assistant" | "tool" | "system";
  suggestedBackoffSec: number;  // how long the Warden thinks we should wait before continuing
  recoveryAttempts: number;     // how many times we've already tried to recover from this error type in this engagement
  lastGoodStep: string | null;  // the last concrete step the agent was on before the error (e.g. "running shell_status on job_3a4f")
}

export interface OperatorInput {
  sessionId: string;
  taskSummary: string;
  vision: VisionSignals;
  dom: DomSnapshot;
  policy: EngagementPolicy;
  spendSoFarUsd: number;
  autoContinuesUsed: number;
  recentDecisions: WardenDecision[]; // last 5, oldest first
  recentMessages?: { role: "user" | "assistant" | "tool" | "system"; content: string; timestamp?: string }[]; // last 10, oldest first
  errorContext?: ErrorContext | null;  // computed at the tick layer from recentMessages
}

// ── Operator output ──

export type WardenAction =
  | "no_op"
  | "continue"
  | "answer_dialog"
  | "notify_user"
  | "abort";

export interface WardenDecision {
  id?: string;                  // generated at creation, used to correlate pending injections
  action: WardenAction;
  reason: string;               // 1-2 sentences, citing specific signals
  confidence: number;           // 0-1
  suggestedPrompt?: string;     // required if action === "continue", max 280 chars
  dialogResponse?: string;      // required if action === "answer_dialog", must be from policy.auto_answer_permitted
  notifiedMessage?: string;     // required if action === "notify_user"
  abortReason?: string;         // required if action === "abort"
  delaySec?: number;            // for action === "continue": wait this many seconds before injecting (e.g. 45s for rate limits). 0 = immediate.
  model?: string;               // model ID that produced this decision (for transparency in UI)
}

// ── LLM config (per-engagement) ──

export interface OperatorLlmConfig {
  model?: string;               // model ID, e.g. "auto/pro-coding" or "gpt-4o-mini" — omit to let pool-router pick
  endpoint?: string;            // custom API endpoint (if not using pool-router)
  apiKey?: string;              // custom API key
  pool?: "maetryxx" | "machine" | "custom";  // which pool to use via routeRequest
}

// ── Engagement state (server-side, in-memory) ──

export interface OperatorEngagement {
  sessionId: string;
  chatSessionId: string | null;    // the actual Smyth chat session being watched (null until synced from ingestion)
  startedAt: string;
  policy: EngagementPolicy;
  llm: OperatorLlmConfig;      // which LLM powers the Warden
  decisions: WardenDecision[];
  spendSoFarUsd: number;
  autoContinuesUsed: number;
  status: "running" | "stopped" | "aborted" | "completed";
  stopReason?: string;
  handledJobIds?: string[]; // background jobIds we've already auto-continued for
  lastJobContinueAt?: string; // ISO timestamp of last job continuation injection
  pendingInjection?: { decisionId: string; prompt: string; model?: string; scheduledFor: number } | null;
}

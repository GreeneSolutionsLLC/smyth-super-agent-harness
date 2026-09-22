// ── Smyth Middleware Stack — Pre/post hooks for the agent loop
// Inspired by OpenHuman's tinyagents::harness::middleware.
//
// Provides:
//   - Tool call retries with exponential backoff
//   - Per-tool timeout enforcement (REAL: signal + race, not just a timer)
//   - Circuit breaker (skip failing tools temporarily)
//   - No-progress detection (detect stuck loops)
//   - Tool call telemetry (latency, success rate)
//   - Pre/post hooks around tool execution
//   - Pacing hook: micro-pauses between rapid tool calls (cruise control)
//   - Throttle feedback: 429/503 observed -> pacing floor raised
//
// FEATURE FLAG: Only runs when ENABLE_MIDDLEWARE=true
// Usage: wrap a tool handler with middleware(toolName, handler)

import { pacingSlot, recordThrottled } from "./tool-pacing";

export type ToolHandler = (args: Record<string, any>) => Promise<string>;
export type PreHook = (toolName: string, args: Record<string, any>) => Promise<void> | void;
export type PostHook = (toolName: string, args: Record<string, any>, result: string, latencyMs: number, error?: string) => Promise<void> | void;

interface ToolMetrics {
  calls: number;
  errors: number;
  totalLatency: number;
  avgLatency: number;
  lastError: string | null;
  lastCalled: number;
  consecutiveErrors: number;
}

// ── Circuit breaker state ──
const circuitState = new Map<string, { open: boolean; until: number }>();

// ── Tool metrics ──
const toolMetrics = new Map<string, ToolMetrics>();

// ── No-progress detection ──
const noProgressState = new Map<string, { lastHash: string; repeats: number }>();

// ── Pre/post hook registry ──
const preHooks: PreHook[] = [];
const postHooks: PostHook[] = [];

export function registerPreHook(hook: PreHook): void {
  preHooks.push(hook);
}

export function registerPostHook(hook: PostHook): void {
  postHooks.push(hook);
}

export function clearHooks(): void {
  preHooks.length = 0;
  postHooks.length = 0;
}

// ── Circuit breaker helpers ──
function isCircuitOpen(toolName: string): boolean {
  const state = circuitState.get(toolName);
  if (!state) return false;
  if (state.open && Date.now() < state.until) return true;
  if (state.open && Date.now() >= state.until) {
    state.open = false; // auto-close after cooldown
  }
  return false;
}

function tripCircuit(toolName: string, cooldownMs = 30_000): void {
  circuitState.set(toolName, { open: true, until: Date.now() + cooldownMs });
}

function recordToolMetrics(toolName: string, latencyMs: number, error?: string): void {
  let m = toolMetrics.get(toolName);
  if (!m) {
    m = { calls: 0, errors: 0, totalLatency: 0, avgLatency: 0, lastError: null, lastCalled: 0, consecutiveErrors: 0 };
    toolMetrics.set(toolName, m);
  }
  m.calls++;
  m.totalLatency += latencyMs;
  m.avgLatency = Math.round(m.totalLatency / m.calls);
  m.lastCalled = Date.now();
  if (error) {
    m.errors++;
    m.consecutiveErrors++;
    m.lastError = error;
    if (m.consecutiveErrors >= 3) {
      tripCircuit(toolName, 60_000);
    }
  } else {
    m.consecutiveErrors = 0;
    m.lastError = null;
  }
}

// ── No-progress detection ──
function computeActionHash(phases: { tool: string; status: string }[]): string {
  return phases.map(p => `${p.tool}:${p.status}`).join("|");
}

export function detectNoProgress(sessionId: string, phases: { tool: string; status: string }[]): boolean {
  if (process.env.ENABLE_MIDDLEWARE !== "true") return false;
  const hash = computeActionHash(phases);
  const state = noProgressState.get(sessionId);
  if (!state) {
    noProgressState.set(sessionId, { lastHash: hash, repeats: 1 });
    return false;
  }
  if (state.lastHash === hash) {
    state.repeats++;
    if (state.repeats >= 3) {
      console.log(`[middleware] No-progress detected for ${sessionId}: same action pattern repeated ${state.repeats} times`);
      return true;
    }
  } else {
    state.lastHash = hash;
    state.repeats = 1;
  }
  return false;
}

// ── Per-tool timeout budget table (ms) ──
// deep_research / long-running tools: exempt (hard cap only — see TOOL_TIMEOUT_EXEMPT)
const DEFAULT_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUTS: Record<string, number> = {
  crm_create_person: 20_000,
  crm_update_person: 20_000,
  crm_search_persons: 20_000,
  crm_get_person: 20_000,
  crm_list_persons: 20_000,
  web_search: 25_000,
  web_fetch: 25_000,
  scrape_url: 30_000,
  scrape_urls: 45_000,
  site_scrape: 60_000,
  vision: 60_000,
  replicate: 120_000,
  tts: 30_000,
  default: 30_000,
};

// Tools exempt from per-tool timeout — they legitimately run for minutes
// and are bounded only by the request-level hard cap (maxTotalMs).
const TOOL_TIMEOUT_EXEMPT = new Set(["deep_research"]);

// Tools that never auto-retry — a timeout or failure is handed straight
// to the model so it can pivot. (Auto-retry on these caused the 8x CRM
// chain in production.)
const NO_RETRY_TOOLS = new Set([
  "crm_create_person", "crm_update_person", "crm_search_persons",
  "crm_get_person", "crm_list_persons",
]);

function isThrottleError(msg: string): boolean {
  return /429|503|408|rate\s*limit|too\s*many\s*requests/i.test(msg);
}

// ── Wrap a tool handler with middleware ──
export function withMiddleware(
  toolName: string,
  handler: ToolHandler,
  options: { maxRetries?: number; timeoutMs?: number; retryDelayMs?: number } = {}
): ToolHandler {
  if (process.env.ENABLE_MIDDLEWARE !== "true") return handler;

  const maxRetries = options.maxRetries ?? (NO_RETRY_TOOLS.has(toolName) ? 0 : 2);
  const timeoutMs = options.timeoutMs ?? (TOOL_TIMEOUT_EXEMPT.has(toolName) ? Infinity : (TOOL_TIMEOUTS[toolName] ?? TOOL_TIMEOUTS.default));
  const retryDelayMs = options.retryDelayMs ?? 1000;

  return async (args: Record<string, any>): Promise<string> => {
    // Circuit breaker check
    if (isCircuitOpen(toolName)) {
      return `[MIDDLEWARE] Tool "${toolName}" is temporarily disabled due to repeated failures. Try again in 60s.`;
    }

    // Pacing: micro-pause before the call to stay under the rate limit.
    // Run pre-hooks
    for (const hook of preHooks) {
      try { await hook(toolName, args); } catch {}
    }

    // Pacing happens BEFORE pre-hook latency so the wait is attributed
    // to the throttle, not the tool.
    await pacingSlot(toolName);

    let lastError: string | undefined;
    let result: string = "";
    let latency = 0;
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const start = Date.now();
      timer = null;
      try {
        const controller = new AbortController();
        timer = timeoutMs === Infinity
          ? null
          : setTimeout(() => controller.abort(), timeoutMs);

        // Pass the signal to the handler so fetch-based tools can abort
        // for real, AND race against the deadline for non-abortable
        // handlers (local scripts, exec, etc.).
        const deadline = timeoutMs === Infinity
          ? new Promise<never>(() => {})
          : new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`tool_timeout_after_${timeoutMs}ms`)), timeoutMs);
            });

        const run = Promise.resolve().then(() => (handler as any)(args, { signal: controller.signal }));
        result = await Promise.race([run, deadline]);
        if (timer) clearTimeout(timer);
        latency = Date.now() - start;
        lastError = undefined;
        break;
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        latency = Date.now() - start;
        timedOut = /tool_timeout_after_/i.test(err?.message || "") || err?.name === "AbortError";
        lastError = timedOut
          ? `tool timed out after ${timeoutMs}ms`
          : (err?.message || "unknown error");

        // Never retry after a timeout — the tool is stuck, retrying just
        // re-hangs. Hand it to the model so it can pivot.
        if (!timedOut && attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt); // exponential backoff
          console.log(`[middleware] ${toolName} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError}. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // Throttle feedback: if we saw a rate limit, raise the pacing floor
    if (lastError && isThrottleError(lastError)) {
      recordThrottled(toolName);
    }

    // Record metrics
    recordToolMetrics(toolName, latency, lastError);

    // Run post-hooks
    for (const hook of postHooks) {
      try { await hook(toolName, args, result, latency, lastError); } catch {}
    }

    if (lastError) {
      if (timedOut) {
        return `[TOOL_TIMEOUT] ${toolName} did not respond within ${Math.round(timeoutMs / 1000)}s. The service may be down or overloaded. Do NOT retry this tool right now — pivot: use an alternative approach, or answer with what you know and note the limitation.`;
      }
      return `[MIDDLEWARE] ${toolName} failed after ${maxRetries + 1} attempts: ${lastError}`;
    }
    return result;
  };
}

// ── Apply middleware to an entire handler map ──
export function applyMiddlewareToHandlerMap(
  handlerMap: Map<string, ToolHandler>,
  overrides?: Record<string, { maxRetries?: number; timeoutMs?: number }>
): Map<string, ToolHandler> {
  if (process.env.ENABLE_MIDDLEWARE !== "true") return handlerMap;

  const wrapped = new Map<string, ToolHandler>();
  for (const [name, handler] of handlerMap) {
    const opts = overrides?.[name] || {};
    // Apply the default per-tool timeout budget unless overridden
    if (opts.timeoutMs === undefined && TOOL_TIMEOUTS[name] !== undefined) {
      opts.timeoutMs = TOOL_TIMEOUTS[name];
    }
    wrapped.set(name, withMiddleware(name, handler, opts));
  }
  return wrapped;
}

// ── Get metrics report ──
export function getToolMetrics(): Record<string, ToolMetrics> {
  const result: Record<string, ToolMetrics> = {};
  for (const [name, m] of toolMetrics) {
    result[name] = { ...m };
  }
  return result;
}

// ── Get circuit breaker status ──
export function getCircuitStatus(): Record<string, { open: boolean; until: number }> {
  const result: Record<string, { open: boolean; until: number }> = {};
  for (const [name, s] of circuitState) {
    result[name] = { ...s };
  }
  return result;
}

// ── Built-in hooks ──

// Log every tool call
export const logHook: PostHook = (name, args, result, latency, error) => {
  const status = error ? "ERROR" : "OK";
  console.log(`[tool] ${name} ${status} in ${latency}ms${error ? ` | ${error}` : ""}`);
};

// Alert on very slow tools (>10s)
export const slowToolHook: PostHook = (name, _args, _result, latency) => {
  if (latency > 10_000) {
    console.log(`[middleware] SLOW: ${name} took ${latency}ms`);
  }
};

// Auto-register common hooks when middleware is enabled
if (process.env.ENABLE_MIDDLEWARE === "true" && process.env.MIDDLEWARE_LOG_TOOLS === "true") {
  registerPostHook(logHook);
}
if (process.env.ENABLE_MIDDLEWARE === "true" && process.env.MIDDLEWARE_SLOW_ALERT === "true") {
  registerPostHook(slowToolHook);
}

/**
 * RateGovernor — predictive throttle for Smyth's LLM calls.
 *
 * Replaces the naive per-pool RPM cap with:
 *   - token-bucket budgets per provider/model
 *   - response-header learning (x-ratelimit-*, retry-after)
 *   - rotation-aware checks ("is this route safe? try another")
 *   - jitter + global per-route queues to prevent thundering herd
 *   - env kill switch
 *
 * Phase A implementation: blocking `waitForSlot()` API so it drops into
 * existing call sites without changing the agent loop. Phase B will add
 * `check()/resumeAt` park-and-resume.
 */

export type PoolId = "machine" | "maetryxx" | "ollama-cloud" | "ollama-pro" | "local" | "cloudflare" | "nvidia";

// Accounts/channels within a pool. For machine: cloud/pro/local keys.
// For maetryxx: the upstream provider behind the OmniRoute call.
type AccountKey = string | undefined;

// A budget can be tied to a specific model route OR to a shared account.
// Account-level buckets are checked *in addition* to route-level buckets.
interface RouteBudget {
  rpm: number;          // requests per minute ceiling
  tpm: number;          // tokens per minute ceiling (0 = ignore)
  windowMs: number;     // refill window, usually 60_000
  minSpacingMs: number; // minimum gap between consecutive calls
  burst: number;        // max tokens in the bucket at once (defaults to rpm)
}

interface Bucket {
  routeKey: string;
  budget: RouteBudget;
  tokens: number;       // remaining request tokens in current window
  lastRefill: number;   // timestamp of last refill
  lastUsed: number;     // timestamp of last call (for spacing)
  callsInWindow: number;
  tokensInWindow: number;
  tokensLastDecay: number; // wall-clock baseline for tpm leaky-bucket decay
  learned: boolean;     // true if we've seen real headers and tightened
}

interface RouteHint {
  pool: PoolId;
  modelId: string;
  account?: string;
}

// ── Defaults ──
// These are conservative published/observed limits for the upstream
// services Smyth uses. They are intentionally a little below red-line so
// the governor learns upward from headers, not downward from 429s.
// Format: route key is "pool:modelId" or "pool:account:modelId".
// Account-level keys are "pool:account".
const DEFAULT_BUDGETS: Record<string, RouteBudget> = {
  // Ollama Cloud / Pro accounts — paid Ollama API endpoints.
  // Tool-call bursts fire plan → act → observe → act → observe in rapid
  // succession. The upstream provider enforces ~30 RPM per API key, so we
  // match that exactly: 2000ms spacing (60s/30) and burst=1 to prevent
  // any spike that could trigger a 429.
  "machine:cloud":        { rpm: 30, tpm: 120_000, windowMs: 60_000, minSpacingMs: 2000, burst: 1 },
  "machine:pro":          { rpm: 30, tpm: 200_000, windowMs: 60_000, minSpacingMs: 2000, burst: 1 },
  "machine:local:default":{ rpm: 999, tpm: 0,      windowMs: 60_000, minSpacingMs: 50,   burst: 999 },

  // NVIDIA NIM free tier — 32 concurrent workers, published up to 40 RPM
  // and 10,000 requests/day. The agent loop fires tool-call → execute →
  // follow-up rapidly, which can blow past the 32-worker ceiling and return
  // 503 ResourceExhausted. We target 30 RPM with 2.2s spacing to stay
  // under both the RPM and concurrent-worker limits while gaining a bit
  // more throughput than the old 20 RPM setting.
  // 2026-09-03: raised rpm 20→30 / spacing 2000→2200ms after confirming
  // NVIDIA publishes "up to 40 rpm" on build.nvidia.com.
  "machine:nvidia":       { rpm: 30, tpm: 0,      windowMs: 60_000, minSpacingMs: 2200, burst: 4 },

  // Per-model fallback for machine when no account is specified.
  "machine:default":      { rpm: 50, tpm: 200_000, windowMs: 60_000, minSpacingMs: 500,  burst: 50 },

  // OmniRoute / maetryxx — PAID aggregator (not free-tier fan-out).
  // 2026-08-10: it was throttling to a crawl because the 50K tpm bucket
  // never drained mid-window (estimated 2.5K/call => ~20 calls then
  // permanent ~3.1s sleeps for the rest of the minute). Raised tpm to
  // 2M (effectively unbounded for a local app), rpm 25->200, spacing
  // 1000->150ms, burst 25->200. Real limits are learned from headers.
  "maetryxx:default":     { rpm: 200, tpm: 2_000_000, windowMs: 60_000, minSpacingMs: 150, burst: 200 },
};

// Provider hints we can derive from modelId prefixes/suffixes.
// These only matter for maetryxx because OmniRoute may route to many
// upstreams under one modelId.
const PROVIDER_HINTS: Record<string, Partial<RouteBudget>> = {
  // OpenAI-family models through OmniRoute
  "gpt-4o":               { rpm: 30, tpm: 150_000 },
  "gpt-4o-mini":          { rpm: 60, tpm: 200_000 },
  "o1":                   { rpm: 15, tpm: 60_000 },
  "o3":                   { rpm: 15, tpm: 60_000 },

  // Anthropic
  "claude":               { rpm: 25, tpm: 100_000 },

  // Google
  "gemini":               { rpm: 30, tpm: 120_000 },

  // DeepSeek (free tiers are lower)
  "deepseek":             { rpm: 15, tpm: 30_000 },

  // xAI / Grok
  "grok":                 { rpm: 20, tpm: 60_000 },

  // Mistral
  "mistral":              { rpm: 20, tpm: 60_000 },

  // Cohere
  "command":              { rpm: 20, tpm: 50_000 },

  // Qwen
  "qwen":                 { rpm: 20, tpm: 60_000 },

  // Perplexity / Sonar
  "sonar":                { rpm: 15, tpm: 30_000 },
};

// ── Runtime state ──
const buckets = new Map<string, Bucket>();
const KILL_SWITCH = process.env.DISABLE_RATE_GOVERNOR === "true";

function getDefaultBudget(routeKey: string, modelId: string): RouteBudget {
  // Exact match wins.
  if (DEFAULT_BUDGETS[routeKey]) return { ...DEFAULT_BUDGETS[routeKey] };

  // For machine models, default to account-level bucket if an account is
  // implied by the model tag (e.g., ":cloud" or ":pro").
  if (routeKey.startsWith("machine:")) {
    const account = extractAccountFromRoute(routeKey);
    if (account && DEFAULT_BUDGETS[`machine:${account}`]) {
      return { ...DEFAULT_BUDGETS[`machine:${account}`] };
    }
  }

  // Provider hint by model substring (maetryxx / upstream providers).
  const hint: Partial<RouteBudget> = {};
  for (const [needle, cfg] of Object.entries(PROVIDER_HINTS)) {
    if (modelId.toLowerCase().includes(needle.toLowerCase())) {
      Object.assign(hint, cfg);
      break; // first match
    }
  }

  const baseKey = routeKey.startsWith("machine:local") ? "machine:local:default" : routeKey.startsWith("machine") ? "machine:default" : "maetryxx:default";
  const base = { ...DEFAULT_BUDGETS[baseKey] };
  const merged = { ...base, ...hint };
  merged.burst = merged.rpm;
  return merged;
}

function getBucket(routeKey: string, modelId: string): Bucket {
  let b = buckets.get(routeKey);
  if (!b) {
    const budget = getDefaultBudget(routeKey, modelId);
    b = {
      routeKey,
      budget,
      tokens: budget.rpm,
      lastRefill: Date.now(),
      lastUsed: 0,
      callsInWindow: 0,
      tokensInWindow: 0,
      tokensLastDecay: Date.now(),
      learned: false,
    };
    buckets.set(routeKey, b);
  }
  return b;
}

function routeKey(hint: RouteHint): string {
  // 2026-09-09: Machine-pool models that share the SAME API key should share
  // the SAME governor bucket. A per-model bucket let 4 models each fire 30 RPM
  // on one API key, so the upstream provider saw 120 RPM and returned 429s.
  // Now all machine models on the same account key into one bucket; the account
  // bucket still enforces the per-key aggregate separately.
  if (hint.pool === "machine" && hint.account) {
    if (hint.account === "local") return `machine:local:${hint.modelId}`;
    return `machine:${hint.account}`;
  }
  return `${hint.pool}:${hint.modelId}`;
}

function accountKey(hint: RouteHint): string | undefined {
  if (hint.pool === "machine" && hint.account) {
    return `machine:${hint.account}`;
  }
  // maetryxx doesn't have a stable account; its upstream changes.
  return undefined;
}

function extractAccountFromRoute(routeKey: string): string | undefined {
  // machine:<account>:<modelId> or machine:local:<modelId>
  const parts = routeKey.split(":");
  if (parts.length === 3 && parts[0] === "machine") {
    const acc = parts[1];
    if (DEFAULT_BUDGETS[`machine:${acc}`]) return acc;
  }
  // machine:cloud:<modelId> tag style
  const last = routeKey.split(":").pop();
  if (last === "cloud") return "cloud";
  if (last === "pro") return "pro";
  return undefined;
}

function refill(bucket: Bucket, now: number) {
  const budget = bucket.budget;
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return;

  // Refill proportional to time passed.
  const refillRate = budget.rpm / budget.windowMs; // tokens per ms
  const add = Math.floor(elapsed * refillRate);
  if (add > 0) {
    bucket.tokens = Math.min(budget.burst, bucket.tokens + add);
    bucket.lastRefill = now;
  }

  // Slide the window counters.
  // Note: callsInWindow resets on window boundary; tokensInWindow is
  // handled by the continuous leaky-bucket decay below (wall-clock
  // sliding window — more accurate than a hard reset).
  if (now - bucket.lastRefill >= budget.windowMs) {
    bucket.callsInWindow = 0;
  }

  // 2026-08-10: leaky-bucket decay for tokens — the tpm ceiling is a
  // *rate* (tokens/minute), so tokens older than the window should no
  // longer count. Before this, tokensInWindow only zeroed on a hard 60s
  // boundary, which meant ~20 calls into a minute every later call slept
  // ~3s (the 21-minute-stream bug).
  //
  // IMPORTANT: this decay must use its own wall-clock baseline, NOT
  // lastRefill — lastRefill only advances when the rpm refill adds >=1
  // token (every ~2.5s for rpm 24), so tying decay to it meant the bucket
  // drained ~10x slower than real time and still accumulated to a
  // permanent tpm throttle.
  const windowMs = Math.max(budget.windowMs, 1);
  const decay = (now - bucket.tokensLastDecay) * (budget.tpm / windowMs);
  if (decay > 0) {
    bucket.tokensInWindow = Math.max(0, bucket.tokensInWindow - decay);
    bucket.tokensLastDecay = now;
  }
}

function estimateTokens(hint: RouteHint, messages?: unknown[]): number {
  // Phase A crude estimate.
  let chars = 0;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      const content = (m as any)?.content;
      if (typeof content === "string") chars += content.length;
      else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === "string") chars += part.length;
          else if (part?.text) chars += String(part.text).length;
        }
      }
    }
  }
  // ~4 chars/token input + 2k output allowance.
  // 2026-08-10: floor lowered 2,500 -> 1,000. When callers only pass the
  // pool (stream route), messages is empty and we were charging a flat
  // 2.5K against the tpm bucket for every call — enough to exhaust a
  // 50K bucket in ~20 calls. The estimate is advisory anyway; real usage
  // is corrected via recordHeaders(actualTokensUsed).
  const inputTokens = Math.ceil(chars / 4);
  return Math.max(inputTokens + 2_000, 1_000);
}

function canProceed(b: Bucket, now: number, estimatedTokens: number): { ok: boolean; spacingOk: boolean; rpmOk: boolean; tpmOk: boolean } {
  refill(b, now);
  const budget = b.budget;
  const spacingOk = now - b.lastUsed >= budget.minSpacingMs;
  const rpmOk = b.tokens >= 1;
  const tpmOk = budget.tpm <= 0 || b.tokensInWindow + estimatedTokens <= budget.tpm;
  return { ok: spacingOk && rpmOk && tpmOk, spacingOk, rpmOk, tpmOk };
}

function sleepForBucket(b: Bucket, now: number, estimatedTokens: number): number {
  const budget = b.budget;
  let sleepMs = budget.minSpacingMs - (now - b.lastUsed);
  if (b.tokens < 1) {
    sleepMs = Math.max(sleepMs, Math.ceil(budget.windowMs / budget.rpm) + 10);
  }
  if (budget.tpm > 0 && b.tokensInWindow + estimatedTokens > budget.tpm) {
    const excess = b.tokensInWindow + estimatedTokens - budget.tpm;
    const msPerToken = budget.windowMs / budget.tpm;
    sleepMs = Math.max(sleepMs, Math.ceil(excess * msPerToken) + 10);
  }
  sleepMs += Math.floor(Math.random() * 250);
  return Math.min(sleepMs, 30_000);
}

function consume(b: Bucket, now: number, estimatedTokens: number) {
  b.tokens -= 1;
  b.lastUsed = now;
  b.callsInWindow += 1;
  b.tokensInWindow += estimatedTokens;
}

/**
 * Wait until the route is safe, then record the call.
 * This is the Phase A drop-in replacement for waitForSlot().
 */
export async function waitForSlot(
  pool: PoolId,
  modelId?: string,
  account?: string,
  messages?: unknown[],
): Promise<void> {
  if (KILL_SWITCH) return;

  const hint: RouteHint = { pool, modelId: modelId || "unknown", account };
  const route = getBucket(routeKey(hint), hint.modelId);
  const acctKey = accountKey(hint);
  const acct = acctKey ? getBucket(acctKey, hint.modelId) : undefined;
  const estimatedTokens = estimateTokens(hint, messages);

  let waited = false;
  while (true) {
    const now = Date.now();
    const routeOk = canProceed(route, now, estimatedTokens);
    const acctOk = acct ? canProceed(acct, now, estimatedTokens) : { ok: true, spacingOk: true, rpmOk: true, tpmOk: true };

    if (routeOk.ok && acctOk.ok) {
      consume(route, now, estimatedTokens);
      // 2026-09-09: for machine pool the route key IS the account key, so
      // don't double-consume the same bucket.
      if (acct && acct !== route) consume(acct, now, estimatedTokens);
      if (waited) {
        console.log(`[rate-governor] ${route.routeKey}${acct && acct !== route ? ` + ${acct.routeKey}` : ""} cooled and proceeded`);
      }
      return;
    }

    // Choose the longer wait of the two constraints.
    let sleepMs = sleepForBucket(route, now, estimatedTokens);
    if (acct && acct !== route) sleepMs = Math.max(sleepMs, sleepForBucket(acct, now, estimatedTokens));

    // 2026-08-09: Cap governor sleep so throttling can't burn the request's
    // whole time budget. 20s max per wait; the retry/rotation logic is the
    // backstop for genuinely saturated routes, not an unbounded sleep.
    sleepMs = Math.min(sleepMs, 20_000);

    const reasons: string[] = [];
    if (!routeOk.spacingOk || (acct && !acctOk.spacingOk)) reasons.push("spacing");
    if (!routeOk.rpmOk || (acct && !acctOk.rpmOk)) reasons.push("rpm");
    if (!routeOk.tpmOk || (acct && !acctOk.tpmOk)) reasons.push("tpm");

    console.log(`[rate-governor] ${route.routeKey}${acct ? ` + ${acct.routeKey}` : ""} throttled (${reasons.join(",")}) — sleeping ${sleepMs}ms`);
    waited = true;
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

/**
 * Learn from response headers after a real call.
 * Call this from pool-router recordSuccess/recordFailure.
 */
export function recordHeaders(
  pool: PoolId,
  modelId: string,
  headers: Headers | Record<string, string | string[] | undefined> | null | undefined,
  actualTokensUsed = 0,
  account?: string,
): void {
  if (KILL_SWITCH || !headers) return;

  const key = routeKey({ pool, modelId, account });
  const b = getBucket(key, modelId);

  // Normalize header lookup.
  const get = (name: string): string | undefined => {
    const n = name.toLowerCase();
    if (headers instanceof Headers) {
      const v = headers.get(n);
      return v ?? undefined;
    }
    const raw = (headers as Record<string, string | string[] | undefined>)[n];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  // Common provider header names.
  const remainingRequests =
    get("x-ratelimit-remaining-requests") ??
    get("x-ratelimit-remaining") ??
    get("x-request-limit-remaining");
  const remainingTokens =
    get("x-ratelimit-remaining-tokens") ??
    get("x-ratelimit-tokens-remaining");
  const limitRequests =
    get("x-ratelimit-limit-requests") ??
    get("x-ratelimit-limit");
  const limitTokens =
    get("x-ratelimit-limit-tokens");
  const resetRequests =
    get("x-ratelimit-reset-requests") ??
    get("x-ratelimit-reset") ??
    get("x-ratelimit-resettime");
  const retryAfter = get("retry-after");

  const parseIntSafe = (s: string | undefined) => {
    if (!s) return undefined;
    const n = parseInt(s, 10);
    return isNaN(n) ? undefined : n;
  };

  if (remainingRequests !== undefined || limitRequests !== undefined) {
    const limit = parseIntSafe(limitRequests);
    const remaining = parseIntSafe(remainingRequests);
    if (limit && remaining !== undefined && remaining < limit) {
      // Tighten budget to what the provider actually allows.
      b.budget.rpm = limit;
      b.budget.burst = limit;
      // Reset tokens to observed remaining, but don't give false confidence.
      b.tokens = Math.min(b.tokens, Math.max(1, remaining));
      b.learned = true;
    }
  }

  if (remainingTokens !== undefined || limitTokens !== undefined) {
    const limit = parseIntSafe(limitTokens);
    if (limit) {
      b.budget.tpm = limit;
      b.learned = true;
    }
  }

  // Update actual token usage if available.
  if (actualTokensUsed > 0) {
    // Replace our rough estimate in the current window with actual.
    b.tokensInWindow = Math.max(0, b.tokensInWindow - estimateTokens({ pool, modelId, account }) + actualTokensUsed);
  }

  // If provider tells us when the window resets, align our bucket.
  let resetMs: number | undefined;
  if (retryAfter) {
    const retrySeconds = parseIntSafe(retryAfter);
    if (retrySeconds !== undefined) resetMs = retrySeconds * 1_000;
  } else if (resetRequests) {
    // resetRequests can be epoch seconds, epoch ms, or ISO string.
    const asNum = Number(resetRequests);
    if (!isNaN(asNum)) {
      resetMs = asNum > 1_000_000_000_000 ? asNum - Date.now() : asNum * 1_000 - Date.now();
    } else {
      const d = Date.parse(resetRequests);
      if (!isNaN(d)) resetMs = d - Date.now();
    }
  }
  if (resetMs && resetMs > 0) {
    b.lastRefill = Date.now() - b.budget.windowMs + Math.min(resetMs, b.budget.windowMs);
  }
}

/**
 * Expose current state for health endpoints / logs.
 */
/**
 * Tell the governor a request was rejected with 429. Drains the relevant
 * bucket and pushes lastUsed forward so waitForSlot blocks further calls
 * immediately. This prevents the governor from spending tokens on a route
 * the upstream has already told us is saturated.
 */
export function recordRateLimitHit(
  pool: PoolId,
  modelId: string,
  account?: string,
  retryAfterSeconds?: number,
): void {
  if (KILL_SWITCH) return;
  const hint: RouteHint = { pool, modelId: modelId || "unknown", account };
  const keys = [routeKey(hint)];
  const ak = accountKey(hint);
  if (ak) keys.push(ak);

  for (const key of keys) {
    const b = buckets.get(key);
    if (!b) continue;
    const now = Date.now();
    // Drain the rpm token bucket to force a wait on the next call.
    b.tokens = 0;
    // Push lastUsed forward by the budget spacing, or by retry-after if given.
    const cooldownMs = retryAfterSeconds && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Math.ceil(b.budget.windowMs / b.budget.rpm) + 100;
    b.lastUsed = now + cooldownMs;
    console.log(`[rate-governor] 429 received on ${key} — drained bucket, cooldown ${cooldownMs}ms`);
  }
}

export function getGovernorState() {
  const out: Record<string, any> = {};
  for (const [key, b] of buckets) {
    out[key] = {
      rpmCap: b.budget.rpm,
      tpmCap: b.budget.tpm,
      tokensLeft: b.tokens,
      callsInWindow: b.callsInWindow,
      tokensInWindow: b.tokensInWindow,
      learned: b.learned,
      lastUsed: b.lastUsed,
    };
  }
  return out;
}

/**
 * Configure a route at runtime (e.g., from env or admin panel).
 */
export function configureRoute(
  pool: PoolId,
  modelId: string,
  config: Partial<RouteBudget>,
  account?: string,
): void {
  const key = routeKey({ pool, modelId, account });
  const b = getBucket(key, modelId);
  b.budget = { ...b.budget, ...config, burst: config.rpm ?? b.budget.rpm };
  b.tokens = Math.min(b.tokens, b.budget.burst);
  b.learned = true;
}

/**
 * Phase B placeholder — returns ok/resumeAt without blocking.
 * Not used yet; here for API design preview.
 */
export function check(
  pool: PoolId,
  modelId: string,
  account?: string,
  messages?: unknown[],
): { ok: true } | { ok: false; resumeAt: number; reason: string } {
  if (KILL_SWITCH) return { ok: true };

  const hint: RouteHint = { pool, modelId, account };
  const route = getBucket(routeKey(hint), modelId);
  const acctKey = accountKey(hint);
  const acct = acctKey ? getBucket(acctKey, modelId) : undefined;
  const estimatedTokens = estimateTokens(hint, messages);

  const now = Date.now();
  const routeOk = canProceed(route, now, estimatedTokens);
  const acctOk = acct ? canProceed(acct, now, estimatedTokens) : { ok: true, spacingOk: true, rpmOk: true, tpmOk: true };

  if (routeOk.ok && acctOk.ok) return { ok: true };

  let sleepMs = sleepForBucket(route, now, estimatedTokens);
  if (acct) sleepMs = Math.max(sleepMs, sleepForBucket(acct, now, estimatedTokens));

  const reasons: string[] = [];
  if (!routeOk.spacingOk || (acct && !acctOk.spacingOk)) reasons.push("spacing");
  if (!routeOk.rpmOk || (acct && !acctOk.rpmOk)) reasons.push("rpm");
  if (!routeOk.tpmOk || (acct && !acctOk.tpmOk)) reasons.push("tpm");

  return { ok: false, resumeAt: now + sleepMs, reason: reasons.join(",") };
}

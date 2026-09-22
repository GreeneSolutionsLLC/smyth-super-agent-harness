/**
 * Global RPM-aware rate limiter for all LLM API calls.
 *
 * Tracks requests per pool in a sliding window and enforces a soft RPM cap.
 * Before each LLM call, call `await waitForSlot(pool)` — it will sleep just
 * long enough to keep us under the limit, instead of firing blindly and
 * eating 429s.
 *
 * This is process-global (singleton), so it spans all concurrent streams.
 */

export type PoolId = "machine" | "maetryxx";

interface PoolConfig {
  rpm: number;            // max requests per minute
  windowMs: number;       // sliding window size (default 60s)
  minSpacingMs: number;   // minimum gap between consecutive calls
}

const POOL_CONFIGS: Record<PoolId, PoolConfig> = {
  // Ollama Cloud + Pro: paid plans, generous RPM
  machine:   { rpm: 40, windowMs: 60_000, minSpacingMs: 500 },
  // OmniRoute free tier: more conservative
  maetryxx:  { rpm: 25, windowMs: 60_000, minSpacingMs: 2000 },
};

const timestamps: Record<PoolId, number[]> = {
  machine: [],
  maetryxx: [],
};

let lastCallTime: Record<PoolId, number> = {
  machine: 0,
  maetryxx: 0,
};

/**
 * Wait until it's safe to fire the next request for `pool`.
 * Prunes old timestamps, checks RPM, checks min-spacing, sleeps if needed.
 */
export async function waitForSlot(pool: PoolId): Promise<void> {
  const cfg = POOL_CONFIGS[pool];
  const now = Date.now();

  // Prune entries outside the sliding window
  const poolTimes = timestamps[pool];
  const cutoff = now - cfg.windowMs;
  while (poolTimes.length > 0 && poolTimes[0] < cutoff) {
    poolTimes.shift();
  }

  // Check RPM limit
  if (poolTimes.length >= cfg.rpm) {
    const oldest = poolTimes[0];
    const waitMs = oldest + cfg.windowMs - now + 10; // +10ms buffer
    if (waitMs > 0) {
      console.log(`[rate-limiter] ${pool} RPM cap (${cfg.rpm}) reached — waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  // Enforce minimum spacing between consecutive calls
  const sinceLast = Date.now() - lastCallTime[pool];
  if (sinceLast < cfg.minSpacingMs) {
    const spacingWait = cfg.minSpacingMs - sinceLast;
    await new Promise((r) => setTimeout(r, spacingWait));
  }

  // Record this call
  const finalNow = Date.now();
  timestamps[pool].push(finalNow);
  lastCallTime[pool] = finalNow;
}

/**
 * Get current RPM usage for a pool (for UI / debugging).
 */
export function getPoolRPM(pool: PoolId): { used: number; cap: number; windowMs: number } {
  const cfg = POOL_CONFIGS[pool];
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const poolTimes = timestamps[pool].filter((t) => t >= cutoff);
  return { used: poolTimes.length, cap: cfg.rpm, windowMs: cfg.windowMs };
}

/**
 * Get stats for all pools (for health endpoint).
 */
export function getAllPoolStats() {
  return {
    machine: getPoolRPM("machine"),
    maetryxx: getPoolRPM("maetryxx"),
  };
}

/**
 * Update pool config at runtime (e.g., from env vars or admin panel).
 */
export function configurePool(pool: PoolId, config: Partial<PoolConfig>): void {
  POOL_CONFIGS[pool] = { ...POOL_CONFIGS[pool], ...config };
  console.log(`[rate-limiter] ${pool} reconfigured:`, POOL_CONFIGS[pool]);
}
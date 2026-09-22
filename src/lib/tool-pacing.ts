// ── Tool Pacing — "cruise control" for the tool loop ──
//
// Prevents rate-limit walls during rapid-fire tool calls by inserting
// micro-pauses between calls to the same external endpoint. The pauses are
// tuned to stay just below the provider's rate limit, so the user sees
// continuous "Working..." progress instead of an error wall.
//
// How it works:
//   - Each external endpoint (web search, scrape, crm, vision, ...) has a
//     pacing slot with a minimum interval between calls.
//   - Base intervals are conservative guesses (provider-agnostic).
//   - If a 429/503/408 comes back, we LEARN: the floor for that endpoint is
//     raised so the next burst stays under the limit.
//   - All waits are jittered (+0..250ms) so synchronized bursts don't all
//     land on the same tick.
//
// FEATURE FLAG: ENABLE_TOOL_PACING=true (in .env.local)
//
// Usage: in a tool handler's pre-hook:
//     await pacingSlot("web_search")   // waits if too soon since last call

const PACING_FLAG = process.env.ENABLE_TOOL_PACING === "true";

// ── Per-endpoint min interval (ms) between calls ──
const BASE_INTERVALS: Record<string, number> = {
  web_search: 700,
  web_fetch: 700,
  scrape_url: 900,
  scrape_urls: 900,
  site_scrape: 1200,
  crm: 900,
  vision: 1200,
  replicate: 1000,
  tts: 800,
  default: 500,
};

// ── Learned state: raised floors after observed throttling ──
const learnedFloors = new Map<string, number>(); // endpoint -> min interval
const lastCalledAt = new Map<string, number>(); // endpoint -> timestamp

const MAX_FLOOR_MS = 15_000; // never pace harder than 15s between calls
const LEARN_MULTIPLIER = 1.6; // raise floor by 60% on each observed 429
const LEARN_DECAY_MS = 10 * 60_000; // forget learned floors after 10 min of no errors

function endpointFor(toolName: string): string {
  if (toolName.startsWith("crm_")) return "crm";
  return toolName;
}

function getMinInterval(endpoint: string): number {
  const learned = learnedFloors.get(endpoint);
  if (learned !== undefined) return Math.min(learned, MAX_FLOOR_MS);
  return BASE_INTERVALS[endpoint] ?? BASE_INTERVALS.default;
}

/** Wait until the min interval has elapsed since the last call to this
 *  endpoint. Returns the number of ms actually waited. */
export async function pacingSlot(toolName: string): Promise<number> {
  if (!PACING_FLAG) return 0;
  const endpoint = endpointFor(toolName);
  const minInterval = getMinInterval(endpoint);
  const last = lastCalledAt.get(endpoint) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed >= minInterval) {
    lastCalledAt.set(endpoint, Date.now());
    return 0;
  }
  const wait = minInterval - elapsed + Math.floor(Math.random() * 250);
  await new Promise((r) => setTimeout(r, wait));
  lastCalledAt.set(endpoint, Date.now());
  return wait;
}

/** Call this when a rate-limit / throttle response is observed for a tool.
 *  Raises the floor for that endpoint so subsequent calls space out more. */
export function recordThrottled(toolName: string): void {
  if (!PACING_FLAG) return;
  const endpoint = endpointFor(toolName);
  const current = getMinInterval(endpoint);
  const raised = Math.min(Math.ceil(current * LEARN_MULTIPLIER), MAX_FLOOR_MS);
  learnedFloors.set(endpoint, raised);
  console.log(`[tool-pacing] ${endpoint}: observed throttling, pacing floor raised ${current}ms -> ${raised}ms`);
}

/** Decay learned floors over time so we don't stay over-cautious forever. */
export function decayLearnedFloors(): void {
  if (!PACING_FLAG) return;
  const now = Date.now();
  for (const [endpoint, floor] of learnedFloors) {
    // Simple decay: if we haven't raised it recently, halve it every decay window
    // (kept intentionally simple — a full sliding window is overkill here)
    const lastRaised = lastCalledAt.get(endpoint) ?? 0;
    if (now - lastRaised > LEARN_DECAY_MS && floor > 500) {
      const lowered = Math.floor(floor / 2);
      learnedFloors.set(endpoint, lowered);
      console.log(`[tool-pacing] ${endpoint}: decayed pacing floor ${floor}ms -> ${lowered}ms`);
    }
  }
}

/** Report pacing state (for the admin/debug panel). */
export function getPacingState(): Record<string, { minInterval: number; lastCalled: number; learned: boolean }> {
  const out: Record<string, any> = {};
  const endpoints = new Set([...Object.keys(BASE_INTERVALS), ...learnedFloors.keys()]);
  for (const ep of endpoints) {
    out[ep] = {
      minInterval: getMinInterval(ep),
      lastCalled: lastCalledAt.get(ep) ?? 0,
      learned: learnedFloors.has(ep),
    };
  }
  return out;
}

// Decay check runs on an interval while the server is up
if (PACING_FLAG) {
  setInterval(decayLearnedFloors, LEARN_DECAY_MS);
}

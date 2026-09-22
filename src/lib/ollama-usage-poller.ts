/**
 * Ollama Usage Poller — conditional background poller
 *
 * Per (account, window) pair, tracks a state machine:
 *   idle     → not polling (gauge is not maxed)
 *   watching → polling at interval (gauge is at 100% / maxed)
 *
 * Polling rules (per the design locked with Rob on 2026-08-14):
 *   - Session:   poll every 60 minutes while maxed
 *   - Weekly:    poll every 4 hours while maxed (rolling 7-day window, no fixed reset)
 *   - Not maxed: do not poll. Trust the latest store snapshot.
 *
 * Started lazily on first widget mount. Each gauge pair is independent.
 * The poller writes each fetch to the usage store via the API route's
 * own logic (so we don't double-write).
 *
 * NOTE: This is a thin scheduler. The actual /api/usage fetch happens
 * inside the API route when the widget polls. The poller's job is to
 * decide WHEN to trigger a poll for maxed gauges. It calls the same
 * route handler the widget would call.
 */

import type { Account, Window } from "./ollama-usage-store";

const POLL_INTERVALS_MS: Record<Window, number> = {
  session: 60 * 60 * 1000,   // 60 minutes
  weekly:  4 * 60 * 60 * 1000, // 4 hours
};

type State = "idle" | "watching";

interface WatcherState {
  state: State;
  lastUsage: number;        // last known usage value (0-1)
  lastFetchedAt: number;    // ms timestamp
  intervalHandle: NodeJS.Timeout | null;
}

const watchers: Record<string, WatcherState> = {};

function key(account: Account, window: Window): string {
  return `${account}:${window}`;
}

/**
 * Update a watcher's state after observing a usage value.
 * Called by the API route after each successful fetch.
 * If the gauge is maxed and we weren't watching, start polling.
 * If the gauge dropped below maxed and we were watching, stop polling.
 */
export function observeUsage(
  account: Account,
  window: Window,
  usage: number,
  fetchedAtMs: number
): void {
  const k = key(account, window);
  const w = watchers[k] || { state: "idle", lastUsage: 0, lastFetchedAt: 0, intervalHandle: null };
  w.lastUsage = usage;
  w.lastFetchedAt = fetchedAtMs;

  const isMaxed = usage >= 0.99;
  if (isMaxed && w.state === "idle") {
    startWatching(account, window, w);
  } else if (!isMaxed && w.state === "watching") {
    stopWatching(w);
  }
  watchers[k] = w;
}

function startWatching(account: Account, window: Window, w: WatcherState) {
  w.state = "watching";
  const interval = POLL_INTERVALS_MS[window];
  // Fire one immediate poll, then schedule
  triggerPoll(account, window);
  w.intervalHandle = setInterval(() => triggerPoll(account, window), interval);
  console.log(`[ollama-usage-poller] START watching ${account}/${window} (every ${interval / 1000}s)`);
}

function stopWatching(w: WatcherState) {
  if (w.intervalHandle) {
    clearInterval(w.intervalHandle);
    w.intervalHandle = null;
  }
  w.state = "idle";
  console.log(`[ollama-usage-poller] STOP watching (reset detected)`);
}

async function triggerPoll(account: Account, window: Window) {
  // Construct an internal request to the same API route. This re-uses
  // the cache + store + Ollama-fetch logic and updates history.
  try {
    const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/ollama/usage?account=${account}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[ollama-usage-poller] poll failed for ${account}: ${res.status}`);
      return;
    }
    const data = await res.json();
    const usage = window === "session" ? data.session.usage : data.weekly.usage;
    observeUsage(account, window, usage, Date.now());
  } catch (err: any) {
    console.warn(`[ollama-usage-poller] poll error for ${account}: ${err?.message || err}`);
  }
}

export function getWatcherState(): Record<string, { state: State; lastUsage: number; lastFetchedAt: number }> {
  const out: Record<string, { state: State; lastUsage: number; lastFetchedAt: number }> = {};
  for (const [k, w] of Object.entries(watchers)) {
    out[k] = { state: w.state, lastUsage: w.lastUsage, lastFetchedAt: w.lastFetchedAt };
  }
  return out;
}

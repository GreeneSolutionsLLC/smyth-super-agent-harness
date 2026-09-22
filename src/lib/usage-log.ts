/**
 * Usage Log — append-only record of every successful chat turn
 *
 * One row per chat completion. Captures:
 *   - timestamp, routeMode (auto/machine/custom), provider, model, account
 *   - inputTokens / outputTokens (from the upstream API response)
 *   - latencyMs (request duration)
 *   - costEstimateUsd (computed from pricing data when available)
 *
 * The optimization report generator reads from this log. The OpsPanel
 * Usage tab shows summary stats computed from the same data.
 *
 * Append-only on purpose: never rewrite history. Prune to last 90 days
 * on each write to keep the file small.
 */

import * as fs from "fs";
import * as path from "path";

export type RouteMode = "auto" | "maetryxx" | "machine" | "custom";

export interface UsageEvent {
  id: string;
  timestamp: string;             // ISO
  routeMode: RouteMode;
  provider: string;              // "ollama-cloud" | "ollama-pro" | "openai" | "anthropic" | "openrouter" | "maetryxx" | ...
  model: string;
  account?: string;              // "cloud" | "pro" | "rotate" for Ollama; omitted for custom
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  costEstimateUsd?: number;      // null for Ollama (subscription)
  success: boolean;
  error?: string;
}

interface StoreShape {
  events: UsageEvent[];
}

const DATA_DIR = process.env.USAGE_LOG_DATA_DIR || path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "usage-log.json");
const MAX_EVENTS = 50_000;  // ~90 days at ~500 events/day, plenty of headroom

function ensureDir() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): StoreShape {
  ensureDir();
  if (!fs.existsSync(LOG_FILE)) {
    return { events: [] };
  }
  try {
    const raw = fs.readFileSync(LOG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.events)) {
      return { events: [] };
    }
    return parsed;
  } catch (err) {
    // Corrupt file — back it up
    try {
      const backup = `${LOG_FILE}.corrupt.${Date.now()}`;
      fs.copyFileSync(LOG_FILE, backup);
      console.warn(`[usage-log] corrupt file backed up to ${backup}`);
    } catch {}
    return { events: [] };
  }
}

function writeStore(store: StoreShape) {
  ensureDir();
  if (store.events.length > MAX_EVENTS) {
    // Keep the most recent MAX_EVENTS
    store.events = store.events.slice(-MAX_EVENTS);
  }
  fs.writeFileSync(LOG_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function appendEvent(event: Omit<UsageEvent, "id">): UsageEvent {
  const store = readStore();
  const full: UsageEvent = {
    id: `${event.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    ...event,
  };
  store.events.push(full);
  writeStore(store);
  return full;
}

export function getAllEvents(): UsageEvent[] {
  return readStore().events;
}

export function getEventsSince(isoTimestamp: string): UsageEvent[] {
  const since = new Date(isoTimestamp).getTime();
  return readStore().events.filter((e) => new Date(e.timestamp).getTime() >= since);
}

/**
 * Get events from the last N days.
 */
export function getEventsLastNDays(days: number): UsageEvent[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return readStore().events.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}

/**
 * Count events grouped by a property.
 */
export function countBy<K extends keyof UsageEvent>(
  events: UsageEvent[],
  key: K
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    const k = String(e[key] ?? "unknown");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * Sum numeric fields (inputTokens, outputTokens, costEstimateUsd, latencyMs).
 */
export function sumBy<K extends keyof UsageEvent>(
  events: UsageEvent[],
  key: K
): number {
  let total = 0;
  for (const e of events) {
    const v = e[key];
    if (typeof v === "number") total += v;
  }
  return total;
}

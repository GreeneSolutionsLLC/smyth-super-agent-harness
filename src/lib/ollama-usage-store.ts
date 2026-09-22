/**
 * Ollama Usage Store — JSON-file persistence for usage snapshots
 *
 * Mirrors the pattern in bookings-db.ts. Each successful poll writes
 * one snapshot per (account, window) pair. History is used for:
 *   - Reset detection (find the most recent non-maxed snapshot)
 *   - Future charts and predicted-reset countdowns
 *
 * File: data/ollama-usage-history.json
 * Shape: { snapshots: UsageSnapshot[] }
 *
 * One file, sync writes, capped to last 5,000 snapshots (auto-prune).
 * At 1 snapshot per hour per (account, window), that's ~62 days of history
 * for all 4 (account × window) pairs. Plenty for reset detection.
 */

import fs from "fs";
import path from "path";

export type Account = "cloud" | "pro";
export type Window = "session" | "weekly";

export interface UsageSnapshot {
  id: string;
  account: Account;
  window: Window;
  usage: number;           // 0-1 fraction as Ollama reports
  requestCount: number;    // sum of model request_counts (or 0 if none)
  modelBreakdown: Array<{ name: string; request_count: number }>;
  fetchedAt: string;       // ISO timestamp
}

interface StoreShape {
  snapshots: UsageSnapshot[];
}

const DATA_DIR = process.env.OLLAMA_USAGE_DATA_DIR || path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "ollama-usage-history.json");

const MAX_SNAPSHOTS = 5_000;

function ensureDir() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): StoreShape {
  ensureDir();
  if (!fs.existsSync(STORE_FILE)) {
    return { snapshots: [] };
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.snapshots)) {
      return { snapshots: [] };
    }
    return parsed;
  } catch (err) {
    // Corrupt file — back it up and start fresh rather than crash.
    try {
      const backup = `${STORE_FILE}.corrupt.${Date.now()}`;
      fs.copyFileSync(STORE_FILE, backup);
      console.warn(`[ollama-usage-store] corrupt file backed up to ${backup}`);
    } catch {
      // best-effort
    }
    return { snapshots: [] };
  }
}

function writeStore(store: StoreShape) {
  ensureDir();
  // Prune to keep file small. Keep the most recent MAX_SNAPSHOTS.
  if (store.snapshots.length > MAX_SNAPSHOTS) {
    store.snapshots = store.snapshots.slice(-MAX_SNAPSHOTS);
  }
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function appendSnapshot(snap: UsageSnapshot): void {
  const store = readStore();
  store.snapshots.push(snap);
  writeStore(store);
}

export function getLatestSnapshot(account: Account, window: Window): UsageSnapshot | null {
  const store = readStore();
  for (let i = store.snapshots.length - 1; i >= 0; i--) {
    const s = store.snapshots[i];
    if (s.account === account && s.window === window) return s;
  }
  return null;
}

export function getRecentSnapshots(
  account: Account,
  window: Window,
  limit: number = 50
): UsageSnapshot[] {
  const store = readStore();
  const filtered: UsageSnapshot[] = [];
  for (let i = store.snapshots.length - 1; i >= 0 && filtered.length < limit; i--) {
    const s = store.snapshots[i];
    if (s.account === account && s.window === window) filtered.push(s);
  }
  return filtered.reverse();
}

/**
 * Detect the most recent reset event for a given (account, window).
 * A "reset" is a transition from usage >= 0.99 to usage < 0.99.
 * Returns the timestamp of the snapshot where the drop was observed, or null.
 */
export function detectLastReset(account: Account, window: Window): string | null {
  const recent = getRecentSnapshots(account, window, 200);
  if (recent.length < 2) return null;
  for (let i = recent.length - 1; i > 0; i--) {
    const prev = recent[i - 1];
    const curr = recent[i];
    if (prev.usage >= 0.99 && curr.usage < 0.99) {
      return curr.fetchedAt;
    }
  }
  return null;
}

export function getAllSnapshots(): UsageSnapshot[] {
  return readStore().snapshots;
}

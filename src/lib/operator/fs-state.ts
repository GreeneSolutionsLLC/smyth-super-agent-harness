/**
 * fs-state.ts — disk persistence for operator state.
 *
 * Fixes the "hot-reload wipes everything" bug: Next.js dev recompiles
 * reset module-scope singletons (engagement Map, chat-state), so every
 * engagement evaporated mid-run. Now the store layer keeps a hot in-memory
 * cache AND mirrors every write to a JSON file. On module reload we hydrate
 * from disk, so engagements + chat state survive dev restarts AND full
 * server restarts (and battery deaths).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type PersistedSnapshot = {
  engagements: Record<string, unknown>;
  chatState: unknown;
  updatedAt: string;
};

const STATE_DIR = join(process.cwd(), ".operator-state");
const STATE_FILE = join(STATE_DIR, "state.json");

// ── Generic snapshot read/write (used by both stores) ──

export function writeSnapshot(snapshot: PersistedSnapshot): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (e) {
    console.error(`[operator/fs-state] persist failed: ${(e as Error).message}`);
  }
}

export function readSnapshot(): PersistedSnapshot | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const raw = readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw) as PersistedSnapshot;
  } catch {
    return null; // corrupt or missing — start fresh
  }
}

// ── Engagements slice ──

export function persistEngagements(engagements: Record<string, unknown>): void {
  const current = readSnapshot() || { engagements: {}, chatState: null, updatedAt: "" };
  writeSnapshot({ ...current, engagements, updatedAt: new Date().toISOString() });
}

export function loadEngagements(): Record<string, unknown> | null {
  const snap = readSnapshot();
  return snap?.engagements ?? null;
}

// ── Chat state slice ──

export function persistChatState(chatState: unknown): void {
  const current = readSnapshot() || { engagements: {}, chatState: null, updatedAt: "" };
  writeSnapshot({ ...current, chatState, updatedAt: new Date().toISOString() });
}

export function loadChatState(): unknown {
  const snap = readSnapshot();
  return snap?.chatState ?? null;
}

/** Debug helper: wipe persisted state (used by tests / manual reset). */
export function clearPersistedState(): void {
  try {
    writeSnapshot({ engagements: {}, chatState: null, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error(`[operator/fs-state] clear failed: ${(e as Error).message}`);
  }
}

/** Export the state file path for logging/debugging. */
export function stateFilePath(): string {
  return STATE_FILE;
}

/**
 * Loop checkpointing — "type continue → Smith resumes from the last completed
 * tool result" instead of restarting the whole workflow.
 *
 * The stream route persists loopState + conversation context to disk after
 * every tool turn. If the request hits the time wall (or the client aborts),
 * the state survives. A later "continue" request loads the checkpoint and
 * resumes from the last completed tool result — no re-planning, no re-running
 * completed steps.
 *
 * Checkpoint layout (per chat session):
 *   .checkpoints/<sanitized-sessionId>/latest.json
 *
 * 2026-08-09
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LoopState } from "./agent-loop";

export interface CheckpointMeta {
  savedAt: number;           // epoch ms
  turn: number;
  phase: LoopState["phase"];
  status: "running" | "paused" | "complete" | "failed";
  pausedReason?: string;     // e.g. "timeout", "client_abort", "error"
}

export interface CheckpointData {
  meta: CheckpointMeta;
  loopState: LoopState;
  history: unknown[];        // conversation messages needed to resume
  sessionId: string;
  messageId?: string;        // the message/thread this loop belongs to
}

const CHECKPOINT_DIR = join(process.cwd(), ".checkpoints");
const MAX_CHECKPOINTS_PER_SESSION = 8;

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function sessionDir(sessionId: string): string {
  return join(CHECKPOINT_DIR, sanitize(sessionId));
}

function latestPath(sessionId: string): string {
  return join(sessionDir(sessionId), "latest.json");
}

/** Persist a checkpoint. Writes atomically (tmp + rename) so a crash mid-write
 *  never corrupts the previous checkpoint. */
export function saveCheckpoint(data: CheckpointData): string {
  try {
    const dir = sessionDir(data.sessionId);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `latest.json.tmp-${process.pid}`);
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    const target = latestPath(data.sessionId);
    const renamed = renameSyncSafe(tmp, target);

    // Rotate historical checkpoints (keep a few, drop the rest) so a long
    // workflow doesn't accumulate unbounded files.
    try {
      const files = readdirSync(dir)
        .filter((f) => /^ckpt-\d+\.json$/.test(f))
        .sort();
      while (files.length >= MAX_CHECKPOINTS_PER_SESSION) {
        rmSync(join(dir, files.shift()!), { force: true });
      }
    } catch {
      // rotation is best-effort
    }
    return renamed;
  } catch (e) {
    console.error(`[checkpoint] save failed: ${(e as Error).message}`);
    return "";
  }
}

/** Keep Node's fs.renameSync but tolerate cross-device (EXDEV) by falling back
 *  to copy+unlink. In practice both files are under the same .checkpoints dir,
 *  but this makes the module robust to weird mounts (the volume this repo sits
 *  on is a shared drive — exactly the kind of place EXDEV shows up). */
function renameSyncSafe(from: string, to: string): string {
  try {
    const { renameSync, copyFileSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
    renameSync(from, to);
    return to;
  } catch (e: any) {
    if (e.code === "EXDEV") {
      const { copyFileSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
      copyFileSync(from, to);
      unlinkSync(from);
      return to;
    }
    throw e;
  }
}

/** Load the latest checkpoint for a session. Returns null if none exists. */
export function loadCheckpoint(sessionId: string): CheckpointData | null {
  try {
    const p = latestPath(sessionId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as CheckpointData;
  } catch (e) {
    console.error(`[checkpoint] load failed: ${(e as Error).message}`);
    return null;
  }
}

/** Mark the latest checkpoint as complete (workflow finished) and keep it
 *  around briefly for the UI, but stop treating it as resumable. */
export function markCheckpointComplete(sessionId: string): void {
  try {
    const ck = loadCheckpoint(sessionId);
    if (!ck) return;
    ck.meta.status = "complete";
    saveCheckpoint(ck);
  } catch (e) {
    console.error(`[checkpoint] markComplete failed: ${(e as Error).message}`);
  }
}

/** Delete all checkpoints for a session (user explicitly reset / new task). */
export function clearCheckpoints(sessionId: string): void {
  try {
    rmSync(sessionDir(sessionId), { recursive: true, force: true });
  } catch (e) {
    console.error(`[checkpoint] clear failed: ${(e as Error).message}`);
  }
}

/** A short human-readable summary for UI + Warden injection prompts. */
export function checkpointSummary(ck: CheckpointData): string {
  const ls = ck.loopState;
  const done = ls.completedSteps.length;
  const total = ls.steps.length || ls.completedSteps.length || "?";
  return `paused at turn ${ls.turn} (${ls.phase}) — ${done} of ${total} steps completed${ck.meta.pausedReason ? `; reason: ${ck.meta.pausedReason}` : ""}. Task: ${ls.originalTask.slice(0, 120)}`;
}

/** True if a resumable (paused/running) checkpoint exists for the session. */
export function hasResumableCheckpoint(sessionId: string): boolean {
  const ck = loadCheckpoint(sessionId);
  return !!ck && (ck.meta.status === "paused" || ck.meta.status === "running");
}

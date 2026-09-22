// ── Background Job Registry ──
//
// Lightweight registry of long-running processes started by the shell tool.
// When `background: true` is passed, the shell tool spawns the process
// detached, writes stdout/stderr to a log file, and stores a JobInfo record
// here. The `shell_status` tool reads from this registry to let the agent
// (or the Operator) check on a running job. The registry is persisted to disk
// so it survives dev-server restarts.
//
// Log files persist in /tmp/smyth-jobs/<jobId>.log so job results survive a
// process crash and can be tailed later. The maxBuffer limit is removed for
// background jobs since long-running processes (video gen, model downloads,
// etc.) can produce gigabytes of output.

import { spawn } from "child_process";
import { writeFileSync, appendFileSync, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

import { listEngagements, requestImmediateTick } from "./operator/engagement-store";

const LOG_DIR = "/tmp/smyth-jobs";
const REGISTRY_PATH = join(LOG_DIR, "registry.json");

export type JobStatus = "running" | "completed" | "failed" | "unknown";

export interface JobInfo {
  jobId: string;
  pid: number | null;
  command: string;
  startedAt: number; // epoch ms
  endedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  status: JobStatus;
  logPath: string;
}

// Module-level registry. In-memory only at runtime, persisted to disk every
// 5 seconds so dev-server restarts don't lose jobs.
const jobs = new Map<string, JobInfo>();
let registryDirty = false;

// Keep a handle to the child process so we can check on it / kill it.
// key = jobId
const procs = new Map<string, import("child_process").ChildProcess>();

let hasReconciledRestarts = false;

function loadRegistry(): void {
  try {
    if (!existsSync(REGISTRY_PATH)) return;
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const info of parsed) {
        // On the very first load after this server process starts, any job
        // still marked "running" was orphaned by a previous crash/restart.
        // Mark it failed so callers don't wait forever. On subsequent loads,
        // preserve the running status so normal runtime jobs aren't clobbered.
        if (info.status === "running" && !hasReconciledRestarts) {
          info.status = "failed";
          info.exitCode = null;
          info.signal = "server-restart";
          info.endedAt = info.endedAt || Date.now();
          registryDirty = true;
        }
        jobs.set(info.jobId, info);
      }
      hasReconciledRestarts = true;
    }
  } catch {
    // ignore corrupt registry
  }
}

function saveRegistry(): void {
  if (!registryDirty) return;
  try {
    const payload = JSON.stringify(Array.from(jobs.values()), null, 2);
    writeFileSync(REGISTRY_PATH, payload, "utf-8");
    registryDirty = false;
  } catch {
    // best-effort persistence
  }
}

// Persist every 5 seconds
setInterval(saveRegistry, 5000);

function genJobId(): string {
  return "job_" + randomBytes(6).toString("hex");
}

function ensureLogDir(): void {
  try {
    if (!existsSync(LOG_DIR)) {
      // fs.mkdirSync recursive, but lazy-import to avoid hot-path cost
      const { mkdirSync } = require("fs");
      mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // best-effort; spawn() below will fail with a clear error if it can't write
  }
}

/**
 * Start a background process. Returns the JobInfo immediately.
 * Stdout and stderr are written to <LOG_DIR>/<jobId>.log.
 */
export function startJob(command: string): JobInfo {
  ensureLogDir();
  loadRegistry(); // ensure any previously persisted jobs are loaded
  const jobId = genJobId();
  const logPath = join(LOG_DIR, `${jobId}.log`);

  // Write a header to the log so users can identify the job when tailing.
  const startedAt = Date.now();
  writeFileSync(
    logPath,
    `# jobId: ${jobId}\n# command: ${command}\n# startedAt: ${new Date(startedAt).toISOString()}\n\n`,
    { encoding: "utf-8" }
  );

  const info: JobInfo = {
    jobId,
    pid: null,
    command,
    startedAt,
    status: "running",
    logPath,
  };
  jobs.set(jobId, info);
  registryDirty = true;

  let proc;
  try {
    proc = spawn(command, {
      shell: "/bin/zsh",
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
  } catch (err: any) {
    info.status = "failed";
    info.endedAt = Date.now();
    appendFileSync(logPath, `\n[smyth-jobs] spawn failed: ${err.message}\n`, "utf-8");
    registryDirty = true;
    return info;
  }

  info.pid = proc.pid ?? null;
  procs.set(jobId, proc);

  // Stream stdout/stderr to the log file as the process runs.
  const writeChunk = (stream: NodeJS.WritableStream | null, chunk: Buffer | string) => {
    if (!stream) return;
    try {
      appendFileSync(logPath, chunk.toString(), "utf-8");
    } catch {
      // log write failed (disk full, etc.) — don't kill the job
    }
  };
  proc.stdout?.on("data", (c) => writeChunk(null, c));
  proc.stderr?.on("data", (c) => writeChunk(null, c));

  proc.on("exit", (code, signal) => {
    info.endedAt = Date.now();
    info.exitCode = code;
    info.signal = signal;
    info.status = code === 0 ? "completed" : "failed";
    try {
      appendFileSync(
        logPath,
        `\n# endedAt: ${new Date(info.endedAt).toISOString()}\n# exitCode: ${code}\n# signal: ${signal}\n`,
        "utf-8"
      );
    } catch {}
    procs.delete(jobId);
    registryDirty = true;

    // When a background job finishes, wake up any running Operator
    // engagements so they can inject a continuation immediately. This
    // does not require the LLM pool to be healthy — the tick layer
    // will do a deterministic job-completed check before falling back
    // to the LLM classifier.
    try {
      for (const engagement of listEngagements()) {
        if (engagement.status === "running") {
          requestImmediateTick(engagement.sessionId, "job-completed");
        }
      }
    } catch {
      // best-effort; don't let notification failure kill the job
    }
  });

  proc.on("error", (err) => {
    info.status = "failed";
    info.endedAt = Date.now();
    try {
      appendFileSync(logPath, `\n[smyth-jobs] process error: ${err.message}\n`, "utf-8");
    } catch {}
    procs.delete(jobId);
    registryDirty = true;
  });

  // Detach so the child survives the shell tool's return.
  // The parent no longer needs to wait for it; we use the registry + exit handler
  // above to track completion.
  try {
    proc.unref();
  } catch {}

  return info;
}

/**
 * Get a job's current status. Refreshes the status from the OS if the job
 * is still tracked as "running" — handles the case where the process exited
 * but our exit handler hasn't fired yet (shouldn't happen, but defensive).
 */
export function getJob(jobId: string): JobInfo | null {
  loadRegistry(); // ensure we can see jobs from before a restart
  const info = jobs.get(jobId);
  if (!info) return null;

  if (info.status === "running" && info.pid) {
    try {
      // process.kill(pid, 0) throws ESRCH if the process is gone.
      process.kill(info.pid, 0);
    } catch (err: any) {
      if (err.code === "ESRCH") {
        info.status = "failed";
        info.endedAt = Date.now();
        info.exitCode = null;
        info.signal = "exited";
        registryDirty = true;
      }
    }
  }

  return info;
}

export function listJobs(): JobInfo[] {
  loadRegistry();
  // Refresh statuses for all "running" jobs before returning
  for (const info of jobs.values()) {
    if (info.status === "running" && info.pid) {
      try {
        process.kill(info.pid, 0);
      } catch (err: any) {
        if (err.code === "ESRCH") {
          info.status = "failed";
          info.endedAt = Date.now();
          info.exitCode = null;
          info.signal = "exited";
          registryDirty = true;
        }
      }
    }
  }
  return Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Read the last N bytes of a job's log file. Returns empty string if the
 * log doesn't exist (job never started, or was cleaned up).
 */
export function tailLog(jobId: string, bytes: number = 4000): string {
  const info = jobs.get(jobId);
  if (!info) {
    // Try to tail a stale log file even if the registry lost the entry
    const stalePath = join(LOG_DIR, `${jobId}.log`);
    if (existsSync(stalePath)) return tailFile(stalePath, bytes);
    return "";
  }
  if (!existsSync(info.logPath)) return "";
  return tailFile(info.logPath, bytes);
}

function tailFile(path: string, bytes: number): string {
  try {
    const stat = statSync(path);
    if (stat.size <= bytes) {
      return readFileSync(path, "utf-8");
    }
    // Stream the last N bytes
    const buf = Buffer.alloc(bytes);
    const fd = require("fs").openSync(path, "r");
    try {
      require("fs").readSync(fd, buf, 0, bytes, stat.size - bytes);
    } finally {
      require("fs").closeSync(fd);
    }
    return buf.toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Kill a running job. Returns true if a signal was sent, false if the job
 * was already done or not found.
 */
export function killJob(jobId: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
  loadRegistry();
  const info = jobs.get(jobId);
  if (!info || !info.pid || info.status !== "running") return false;
  try {
    process.kill(info.pid, signal);
    return true;
  } catch {
    return false;
  }
}

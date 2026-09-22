import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const SIGNAL_DIR = path.join(process.env.HOME || "", "unipile-signal");

interface QueueItem {
  type: string;
  name: string;
  status: string;
  scheduledFor?: string;
  doneAt?: string;
  result?: any;
}

interface AccountSnapshot {
  accountId: string;
  name: string;
  queued: number;
  done: number;
  failed: number;
  retries: Record<string, number>;
  recentActions: QueueItem[];
}

interface FleetStatus {
  report: string | null;
  reportDate: string | null;
  accounts: AccountSnapshot[];
  inviteFreezeUntil: string | null;
  recentLogLines: string[];
  batchInfo: {
    running: boolean;
    startedAt: string | null;
  };
}

export async function GET() {
  const result: FleetStatus = {
    report: null,
    reportDate: null,
    accounts: [],
    inviteFreezeUntil: null,
    recentLogLines: [],
    batchInfo: { running: false, startedAt: null },
  };

  // 1. Read latest report
  try {
    const reportPath = path.join(SIGNAL_DIR, "logs", "reports", "latest.md");
    if (fs.existsSync(reportPath)) {
      result.report = fs.readFileSync(reportPath, "utf-8");
      const stat = fs.statSync(reportPath);
      result.reportDate = stat.mtime.toISOString();
    }
  } catch {}

  // 2. Read reporter state for queue snapshots
  try {
    const statePath = path.join(SIGNAL_DIR, "data", "reporter_state.json");
    if (fs.existsSync(statePath)) {
      const raw = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      if (raw.lastSnap) {
        for (const [accountId, snap] of Object.entries(raw.lastSnap) as any[]) {
          result.accounts.push({
            accountId,
            name: snap.name || accountId,
            queued: snap.queued || 0,
            done: snap.done || 0,
            failed: snap.failed || 0,
            retries: snap.retries || {},
            recentActions: [],
          });
        }
      }
      if (raw.batch) {
        result.batchInfo = {
          running: raw.batch !== null,
          startedAt: raw.batch?.startedAt || null,
        };
      }
    }
  } catch {}

  // 3. Read each account's queue.json for recent actions (last 20 per account)
  for (const account of result.accounts) {
    try {
      const queuePath = path.join(SIGNAL_DIR, "data", account.name, "queue.json");
      if (fs.existsSync(queuePath)) {
        const queueData = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
        const items: QueueItem[] = queueData.items || [];
        // Get last 20 items that are done or have results
        const recent = items
          .filter((i: any) => i.status === "done" || i.status === "failed" || i.result)
          .slice(-20)
          .reverse()
          .map((i: any) => ({
            type: i.type,
            name: i.name || "Unknown",
            status: i.status,
            scheduledFor: i.scheduledFor,
            doneAt: i.doneAt,
            result: i.result ? { object: i.result.object } : undefined,
          }));
        account.recentActions = recent;
      }
    } catch {}
  }

  // Also check for britt/robgreen dirs directly if they weren't in reporter_state
  const accountDirs = ["britt", "rebgreen"];
  const existingNames = new Set(result.accounts.map((a) => a.name));
  for (const dir of accountDirs) {
    if (!existingNames.has(dir)) {
      try {
        const queuePath = path.join(SIGNAL_DIR, "data", dir, "queue.json");
        if (fs.existsSync(queuePath)) {
          const queueData = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
          const items: any[] = queueData.items || [];
          const queued = items.filter((i) => i.status === "queued" || i.status === "pending").length;
          const done = items.filter((i) => i.status === "done").length;
          const failed = items.filter((i) => i.status === "failed").length;
          result.accounts.push({
            accountId: dir,
            name: dir,
            queued,
            done,
            failed,
            retries: {},
            recentActions: items
              .filter((i) => i.status === "done" || i.status === "failed" || i.result)
              .slice(-20)
              .reverse()
              .map((i) => ({
                type: i.type,
                name: i.name || "Unknown",
                status: i.status,
                scheduledFor: i.scheduledFor,
                doneAt: i.doneAt,
                result: i.result ? { object: i.result.object } : undefined,
              })),
          });
        }
      } catch {}
    }
  }

  // 4. Read invite freeze status
  try {
    const statusPath = path.join(SIGNAL_DIR, "data", "status.json");
    if (fs.existsSync(statusPath)) {
      const statusData = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
      result.inviteFreezeUntil = statusData.inviteFreezeUntil || null;
    }
  } catch {}

  // 5. Read recent runner log lines (last 40)
  try {
    const logPath = path.join(SIGNAL_DIR, "logs", "runner.log");
    if (fs.existsSync(logPath)) {
      const logs = execSync(`tail -40 "${logPath}" 2>/dev/null`, { timeout: 5000 }).toString();
      result.recentLogLines = logs.split("\n").filter((l) => l.trim());
    }
  } catch {}

  return NextResponse.json(result);
}

import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";
import { readFileSync, existsSync } from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/jobs?jobId=...
 *
 * Lightweight status endpoint for client-side background-job polling.
 * Returns the current status, exit code if finished, duration, and the
 * log tail. Does not require an Operator engagement to be active.
 */
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId query param required" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: `Job ${jobId} not found. Background jobs are tracked in-memory; the server may have restarted.` },
      { status: 404 }
    );
  }

  let tail = "";
  if (existsSync(job.logPath)) {
    try {
      tail = readFileSync(job.logPath, "utf-8");
    } catch {
      tail = "";
    }
  }

  return NextResponse.json({
    jobId: job.jobId,
    pid: job.pid,
    status: job.status,
    command: job.command,
    startedAt: new Date(job.startedAt).toISOString(),
    endedAt: job.endedAt ? new Date(job.endedAt).toISOString() : null,
    durationSec: Math.round(((job.endedAt ?? Date.now()) - job.startedAt) / 1000),
    exitCode: job.exitCode ?? null,
    logPath: job.logPath,
    tail,
  });
}

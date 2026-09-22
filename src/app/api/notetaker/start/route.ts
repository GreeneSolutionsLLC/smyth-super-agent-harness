import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

const NOTETAKER_SCRIPT = process.env.NOTETAKER_SCRIPT || "";

/**
 * POST /api/notetaker/start
 * Start the notetaker bot for a meeting.
 * Body: { roomName, bookingId, displayName? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { roomName, bookingId, displayName } = body;

    if (!roomName) {
      return NextResponse.json({ error: "roomName is required" }, { status: 400 });
    }

    const args = [
      NOTETAKER_SCRIPT,
      "--room", roomName,
      "--name", displayName || "Smyth Notetaker",
      "--duration", "7200",
    ];

    if (bookingId) {
      args.push("--booking-id", bookingId);
    }

    const child = spawn("python3.11", args, {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
      },
    });

    child.unref();

    const pid = child.pid;

    console.log(`[notetaker] Started notetaker for room ${roomName}, PID: ${pid}`);

    return NextResponse.json({
      status: "started",
      roomName,
      bookingId,
      pid,
      message: "Notetaker bot joining meeting",
    });
  } catch (err: any) {
    console.error("[notetaker/start] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
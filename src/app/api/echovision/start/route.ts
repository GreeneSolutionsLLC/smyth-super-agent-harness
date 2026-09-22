import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// Resolve the sidecar with sensible fallbacks so EchoVision works "anywhere
// Smyth runs" — dev checkout or packaged app — without requiring env config.
// Priority: explicit env var → repo/app root (where the python files ship).
const SIDECAR_CANDIDATES = [
  process.env.ECHO_VISION_SIDECAR,
  join(process.cwd(), "echovision-server.py"),              // dev checkout / standalone root
  join(process.cwd(), "..", "echovision-server.py"),        // standalone/server.js cwd
].filter(Boolean) as string[];

const SIDECAR_PATH = SIDECAR_CANDIDATES.find(p => existsSync(p)) || "";
const PORT = process.env.ECHO_VISION_PORT || "18790";

// Track whether we've already spawned (or definitively failed)
let spawned = false;
let permanentlyUnavailable = false;

// EchoVision sidecar is runtime-only; don't attempt discovery during next build.
const sidecarExists =
  process.env.NEXT_PHASE !== "phase-production-build" && SIDECAR_PATH
    ? existsSync(/*turbopackIgnore: true*/ SIDECAR_PATH)
    : false;

async function sidecarAlive(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    return data?.status === "ok";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Trust a live sidecar, not a stale flag — the process may have died.
  if (await sidecarAlive()) {
    spawned = true;
    return NextResponse.json({ status: "ok", message: "Already running" });
  }
  spawned = false; // reset stale flag before spawning a fresh one

  if (!sidecarExists) {
    // Not configured on this machine — tell the client to stop asking.
    permanentlyUnavailable = true;
    return NextResponse.json(
      { status: "unavailable", error: `Sidecar not configured (ECHO_VISION_SIDECAR unset or missing)`, stopPolling: true },
      { status: 200 }
    );
  }

  if (permanentlyUnavailable) {
    return NextResponse.json({ status: "unavailable", stopPolling: true }, { status: 200 });
  }

  try {
    // Prefer a Python that can actually run echovision.py (needs cv2).
    // Under uv-shimmed PATHs, plain "python3" resolves to a bare interpreter;
    // the Homebrew Python usually has the vision deps installed.
    const pythonBin =
      process.env.ECHO_VISION_PYTHON ||
      (process.platform === "darwin" && process.env.HOMEBREW_PREFIX
        ? `${process.env.HOMEBREW_PREFIX}/bin/python3`
        : "python3");
    const env = {
      ...process.env,
      ECHO_VISION_PORT: PORT,
      // Make the Homebrew interpreter + tools discoverable for the sidecar
      PATH: [
        process.env.HOMEBREW_PREFIX ? `${process.env.HOMEBREW_PREFIX}/bin` : "",
        process.env.PATH || "",
      ].filter(Boolean).join(":"),
    };
    const child = spawn(pythonBin, [SIDECAR_PATH], {
      detached: true,
      stdio: "ignore",
      env,
    });

    child.unref();
    spawned = true;

    return NextResponse.json({
      status: "ok",
      pid: child.pid,
      port: PORT,
      python: pythonBin,
    });
  } catch (err: any) {
    return NextResponse.json(
      { status: "error", error: err.message },
      { status: 500 }
    );
  }
}

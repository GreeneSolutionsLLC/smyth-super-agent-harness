import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { join } from "path";

// Optional-services installer for the setup wizard.
//
// GET  /api/setup/docker           -> docker status JSON
// POST /api/setup/docker           -> { action: "install-twenty" } runs the
//                                     bundled installer, streams-ish output.

const REPO_ROOT = process.cwd();
const CHECK_DOCKER = join(REPO_ROOT, "scripts", "check-docker.sh");
const INSTALL_TWENTY = join(REPO_ROOT, "scripts", "install-twenty.sh");

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, out: out + "\n[timeout after " + timeoutMs + "ms]" });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

export async function GET() {
  const { out } = await run("bash", [CHECK_DOCKER], 10_000);
  const trimmed = out.trim();
  try {
    return NextResponse.json({ docker: JSON.parse(trimmed) });
  } catch {
    return NextResponse.json({ docker: { installed: false, running: false, compose: false, version: "" }, raw: trimmed });
  }
}

export async function POST(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* empty body */
  }

  const action = body?.action;
  if (action !== "install-twenty") {
    return NextResponse.json({ error: "Unknown action. Supported: install-twenty" }, { status: 400 });
  }

  // Generous timeout: image pulls + first-boot can exceed 2 minutes.
  const { code, out } = await run("bash", [INSTALL_TWENTY], 5 * 60_000);
  const ok = code === 0;
  return NextResponse.json({ ok, exitCode: code, output: out });
}

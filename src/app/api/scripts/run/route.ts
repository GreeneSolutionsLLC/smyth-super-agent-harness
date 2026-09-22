import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const SCRIPTS_REPO = process.env.PYTHON_SCRIPTS_REPO || "/";
const INDEX_PATH = join(/*turbopackIgnore: true*/ SCRIPTS_REPO, "scripts_index.json");

let _index: any[] | null = null;

function getIndex(): any[] {
  // Runtime-only: don't read the filesystem tree during next build.
  if (process.env.NEXT_PHASE === "phase-production-build") return [];
  if (_index) return _index;
  try {
    const raw = readFileSync(/*turbopackIgnore: true*/ INDEX_PATH, "utf-8");
    _index = JSON.parse(raw);
    return _index!;
  } catch {
    return [];
  }
}

/**
 * POST /api/scripts/run
 * Execute a script by path or search query.
 * Body: { path: "AUTOMATION/Sending-Emails/code.py", args: ["--to", "x@y.com"], timeout: 30 }
 *   OR: { query: "email", args: [...] }
 *
 * Returns: { script, stdout, stderr, exitCode, duration }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: scriptPath, query, args = [], timeout = 30 } = body;

    if (!scriptPath && !query) {
      return NextResponse.json(
        { error: "Provide 'path' or 'query' to identify the script" },
        { status: 400 }
      );
    }

    let resolvedPath: string;

    if (scriptPath) {
      resolvedPath = join(/*turbopackIgnore: true*/ SCRIPTS_REPO, scriptPath);
      if (!resolvedPath.startsWith(SCRIPTS_REPO)) {
        return NextResponse.json(
          { error: "Path traversal blocked" },
          { status: 403 }
        );
      }
    } else {
      const scripts = getIndex();
      const match = scripts.find(
        (s: any) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.path.toLowerCase().includes(query.toLowerCase()) ||
          s.description.toLowerCase().includes(query.toLowerCase())
      );
      if (!match) {
        return NextResponse.json(
          { error: `No script found matching: ${query}` },
          { status: 404 }
        );
      }
      resolvedPath = join(/*turbopackIgnore: true*/ SCRIPTS_REPO, match.path);
    }

    const startTime = Date.now();

    return new Promise<NextResponse>((resolve) => {
      const proc = spawn("python3", [resolvedPath, ...args], {
        cwd: SCRIPTS_REPO,
        timeout: timeout * 1000,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
        if (stdout.length > 100_000) {
          stdout = stdout.slice(0, 100_000) + "\n[...truncated...]";
          proc.kill();
        }
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        if (stderr.length > 100_000) {
          stderr = stderr.slice(0, 100_000) + "\n[...truncated...]";
        }
      });

      proc.on("close", (code) => {
        const duration = Date.now() - startTime;
        resolve(
          NextResponse.json({
            script: resolvedPath.replace(SCRIPTS_REPO + "/", ""),
            exitCode: code,
            duration,
            stdout,
            stderr: stderr || null,
          })
        );
      });

      proc.on("error", (err) => {
        resolve(
          NextResponse.json(
            {
              error: `Failed to execute: ${err.message}`,
              script: resolvedPath.replace(SCRIPTS_REPO + "/", ""),
            },
            { status: 500 }
          )
        );
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
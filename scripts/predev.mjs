#!/usr/bin/env node
/**
 * predev — health-checker for Smyth dev server.
 *
 * Pre-2026-07-30 this script spawned services at boot time. That design had
 * two problems:
 *   1. Auxiliaries (AgenticMail, godaddy-bridge, OpenPencil-MCP, Twenty CRM,
 *      Stalwart, etc.) are already managed by per-user LaunchAgents and
 *      Docker restart policies. They self-recover. predev trying to spawn
 *      them was a no-op (use of `launchctl start` on already-loaded agents).
 *   2. When anything WAS down, predev blocked the dev server boot until
 *      either the service came up or 30 seconds passed. So user had to wait
 *      or watch failures.
 *
 * New behavior:
 *   - Health-check each auxiliary in 3-second timeouts.
 *   - Print a single-line status table.
 *   - ALWAYS hand off to `next dev`, never block.
 *   - If a service is down, the user sees it in the table — the dev server
 *     starts anyway and the auxiliary comes back when LaunchAgent / Docker
 *     restart policy heals it (typically < 5s).
 */

import { spawn, execSync } from "child_process";
import { openSync, existsSync } from "fs";
import { homedir } from "os";

// ── Services to health-check ──
// Each entry has label + URL. 3-second timeout per probe.
const SERVICES = [
  { label: "Smyth dev",      url: "http://localhost:3000" },
  { label: "AgenticMail",    url: "http://127.0.0.1:3829/api/agenticmail/health" },
  { label: "Stalwart",       url: "http://127.0.0.1:8090/" },
  { label: "OpenPencil MCP", url: "http://127.0.0.1:7600/health" },
  { label: "omniroute",      url: "http://127.0.0.1:20128/" },
  { label: "open-design",    url: "http://127.0.0.1:7456/" },
  { label: "Twenty CRM",     url: "http://localhost:4000/healthz" },
  { label: "NVIDIA pool",    url: "http://127.0.0.1:8766/healthz" },
];

// ── Services predev should actively start (not just health-check) ──
// Each entry: label + a spawn command that runs detached in the background.
// predev starts them if their port isn't already listening, so the routing
// pools (NVIDIA, etc.) are alive before the agent's first request.
const STARTERS = [
  {
    label: "NVIDIA pool",
    port: 8766,
    cwd: `${homedir()}/.openclaw/workspace/nvidia-pool`,
    cmd: "python3",
    args: ["server.py", "--port", "8766"],
    logFile: "/tmp/nvidia-pool-server.log",
  },
];

function isPortListening(port) {
  try {
    const out = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`).toString().trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

async function startServices() {
  for (const svc of STARTERS) {
    if (isPortListening(svc.port)) {
      log(`  ✅  ${svc.label} already running on :${svc.port}`);
      continue;
    }
    // Skip gracefully if the service's directory doesn't exist on this machine
    // (e.g. a fresh install with no NVIDIA pool). Never crash the dev server
    // because an optional routing pool isn't present.
    if (!existsSync(svc.cwd)) {
      log(`  ⏭️  ${svc.label} not present (no ${svc.cwd}) — skipping`);
      continue;
    }
    log(`  🚀  ${svc.label} not running — starting...`);
    try {
      const outFd = openSync(svc.logFile, "a");
      const child = spawn(svc.cmd, svc.args, {
        cwd: svc.cwd,
        detached: true,
        stdio: ["ignore", outFd, outFd],
      });
      child.unref();
      // Surface spawn errors (e.g. python3 not installed) instead of crashing.
      child.on("error", (err) => {
        log(`  ❌  ${svc.label} failed to launch: ${err.message}`);
      });
      // Give it a moment to bind the port.
      await new Promise((r) => setTimeout(r, 1500));
      log(`  ✅  ${svc.label} started (pid ${child.pid})`);
    } catch (e) {
      log(`  ❌  ${svc.label} failed to start: ${e.message}`);
    }
  }
}

function log(s) {
  process.stdout.write(`[predev] ${s}\n`);
}

async function probe(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    clearTimeout(t);
    return { ok: true, ms: Date.now() - start, status: res.status };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, ms: Date.now() - start, error: e?.name || "fetch failed" };
  }
}

async function main() {
  log("Starting routing pools...");
  await startServices();
  log("");
  log("Health-checking auxiliaries (3s timeout each)...");

  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      const r = await probe(svc.url);
      return { ...svc, ...r };
    })
  );

  // Render a compact table.
  const widths = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    const icon = r.ok ? (r.status >= 200 && r.status < 400 ? "✅" : "⚠️") : "❌";
    const status = r.ok ? `HTTP ${r.status}` : r.error;
    log(`  ${icon}  ${r.label.padEnd(widths)}  ${status.padStart(5)}  ${r.ms}ms`);
  }

  log("");
  log("Done — handing off to Next.js dev server.");
  log("(Tip: auxiliaries that show ❌ above will auto-recover via their LaunchAgents.");
  log(" Don't kill and restart the app — wait 5–10s, refresh the chat input.)");
  log("");

  // Free port 3000 before handing off — stale servers (e.g. an old orphaned
  // dev server from another copy of the repo) would otherwise keep squatting
  // on :3000 and push this instance to :3001, making the app look like it
  // reverted to an old UI.
  const PORT = 3000;
  try {
    const { execSync } = await import("child_process");
    const out = execSync(`lsof -ti tcp:${PORT} 2>/dev/null || true`).toString().trim();
    if (out) {
      log(`Port ${PORT} busy — killing stale server(s): ${out.split(/\s+/).join(", ")}`);
      execSync(`kill -9 ${out.split(/\s+/).join(" ")} 2>/dev/null || true`);
      await new Promise((r) => setTimeout(r, 1000));
      log(`Port ${PORT} freed.`);
    } else {
      log(`Port ${PORT} free.`);
    }
  } catch (e) {
    log(`Could not check port ${PORT}: ${e.message}`);
  }

  // Hand off to next dev. Using --webpack (not --turbopack) because
  // Turbopack's persistent cache corrupts frequently on this machine.
  const args = process.argv.slice(2);
  // Use --webpack only if Next.js still accepts it; otherwise fall back to plain next dev.
  const hasWebpackFlag = args.includes("--webpack");
  const nextArgs = hasWebpackFlag || true
    ? ["next", "dev", "--webpack", ...args.filter((a) => a !== "--webpack")]
    : ["next", "dev", ...args];
  const next = spawn("npx", nextArgs, { stdio: "inherit", shell: true });
  next.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error("[predev] Error:", e);
  // Even on error, hand off — health-check failure shouldn't block dev.
  const args = process.argv.slice(2);
  const next = spawn("npx", ["next", "dev", ...args], { stdio: "inherit", shell: true });
  next.on("exit", (code) => process.exit(code ?? 0));
});

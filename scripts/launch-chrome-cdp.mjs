#!/usr/bin/env node
/**
 * Chrome CDP Launcher for OpenCut
 * Starts a dedicated Chrome instance with remote debugging on port 18800
 * and navigates it to the OpenCut editor.
 *
 * Usage: node scripts/launch-chrome-cdp.mjs
 */

import { spawn } from "child_process";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CDP_PORT = 18800;
const OPENCUT_URL = "http://127.0.0.1:3001";
const CDP_HTTP = `http://127.0.0.1:${CDP_PORT}`;

// Find Chrome binary
function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/opt/homebrew/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ];
  for (const c of candidates) {
    try {
      import("fs").then(({ accessSync, constants }) => {
        accessSync(c, constants.X_OK);
      });
      return c;
    } catch {}
  }
  return null;
}

async function isCdpUp() {
  try {
    const res = await fetch(`${CDP_HTTP}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(maxSeconds = 15) {
  for (let i = 0; i < maxSeconds; i++) {
    if (await isCdpUp()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function navigateToOpenCut() {
  try {
    const res = await fetch(`${CDP_HTTP}/json`);
    const targets = await res.json();
    const page = targets.find(t => t.type === "page");
    if (!page) return false;

    await fetch(`${CDP_HTTP}/json/activate/${page.id}`, { method: "PUT" });
    await fetch(
      `${CDP_HTTP}/json/new?${encodeURIComponent(OPENCUT_URL)}`,
      { method: "PUT" }
    );
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("[cdp] ❌ Chrome/Chromium not found");
    process.exit(1);
  }

  // Check if CDP already running
  if (await isCdpUp()) {
    console.log("[cdp] ✅ Chrome CDP already running on port", CDP_PORT);
    await navigateToOpenCut();
    return;
  }

  // Create a dedicated user-data dir so we don't interfere with the user's main Chrome
  const userDataDir = join(homedir(), ".smyth-chrome-profile");
  try { mkdirSync(userDataDir, { recursive: true }); } catch {}

  console.log(`[cdp] 🔧 Launching Chrome with remote debugging on port ${CDP_PORT}...`);

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    `--no-first-run`,
    `--no-default-browser-check`,
    `--disable-default-apps`,
    `--disable-background-timer-throttling`,
    `--disable-renderer-backgrounding`,
    `--disable-backgrounding-occluded-windows`,
    OPENCUT_URL,
  ];

  const child = spawn(chrome, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(`[cdp] ⏳ Waiting for CDP to be ready...`);
  const ready = await waitForCdp(15);
  if (!ready) {
    console.error("[cdp] ❌ CDP didn't come up within 15s");
    process.exit(1);
  }

  console.log("[cdp] ✅ CDP ready — navigating to OpenCut...");
  await navigateToOpenCut();
  console.log("[cdp] ✅ OpenCut loaded in Chrome");
}

main().catch(e => {
  console.error("[cdp] Error:", e);
  process.exit(1);
});

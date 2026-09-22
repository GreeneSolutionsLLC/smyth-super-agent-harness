#!/usr/bin/env node
/**
 * postinstall — safe no-op for the web app, real work only for Electron builds.
 *
 * The default `npm install` path (web app + setup wizard) must NOT depend on
 * Electron tooling. `electron-builder install-app-deps` rebuilds native deps
 * against Electron's ABI and can hang or fail on a fresh machine that only
 * needs the web app.
 *
 * So: this script does nothing unless SMYTH_ELECTRON_BUILD=1 is set (used by
 * the Electron packaging workflow in electron/build-scripts/). Electron builds
 * opt in explicitly; everyone else gets a fast, safe install.
 */

if (process.env.SMYTH_ELECTRON_BUILD === "1") {
  const { execSync } = require("child_process");
  console.log("[postinstall] SMYTH_ELECTRON_BUILD=1 — rebuilding native deps for Electron");
  try {
    execSync("npx --no-install electron-builder install-app-deps", { stdio: "inherit" });
  } catch (e) {
    console.error("[postinstall] electron-builder install-app-deps failed:", e.message);
    process.exit(1);
  }
} else {
  console.log("[postinstall] web app install — skipping Electron native rebuild (set SMYTH_ELECTRON_BUILD=1 to opt in)");
}

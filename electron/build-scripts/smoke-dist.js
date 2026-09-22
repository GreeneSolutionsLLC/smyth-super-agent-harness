#!/usr/bin/env node
/**
 * smoke-dist.js — Quick sanity check after `npm run electron:dist`.
 *
 * Verifies the produced .dmg + .app layout:
 *   - dist/Smyth-*.dmg exists
 *   - dist/mac-arm64/Smyth.app/Contents/MacOS/Smyth exists
 *   - Smyth.app/Contents/Resources/app-smyth/server.js exists
 *   - Smyth.app/Contents/Resources/app-omniroute/server.js exists
 *   - Smyth.app/Contents/Resources/legal/ has 5+ files
 *   - Optional: extract .dmg to /tmp and try `open -a` won't be done here.
 *
 * Track B owner. Run via `npm run smoke:dist`.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function ok(label) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label) { console.error(`  \x1b[31m✗\x1b[0m ${label}`); process.exitCode = 1; }
function info(label) { console.log(`  ${label}`); }

function check(label, pred) {
  if (pred) ok(label); else fail(label);
}

function main() {
  console.log('\x1b[36m[smoke-dist]\x1b[0m Smoke-testing dist/');

  if (!exists(DIST)) { fail(`dist/ not found at ${DIST}`); return; }
  info(`Inspecting: ${DIST}`);

  // .dmg
  const dmgs = fs.readdirSync(DIST).filter((n) => n.endsWith('.dmg'));
  check(`At least one .dmg present (${dmgs.join(', ') || 'none'})`, dmgs.length > 0);

  // unpacked mac-arm64 app?
  const appDir = path.join(DIST, 'mac-arm64', 'Smyth.app');
  if (!exists(appDir)) {
    fail(`App bundle missing: ${appDir}`);
  } else {
    const macOsDir = path.join(appDir, 'Contents', 'MacOS');
    check(`Contents/MacOS/ exists`, exists(macOsDir));
    const exe = path.join(macOsDir, 'Smyth');
    check(`Contents/MacOS/Smyth exists`, exists(exe));

    const resources = path.join(appDir, 'Contents', 'Resources');
    check(`Contents/Resources/ exists`, exists(resources));

    const smythServer = path.join(resources, 'app-smyth', 'server.js');
    const smythServerUnpacked = path.join(resources, 'app.asar.unpacked', 'app-smyth', 'server.js');
    check(`Contents/Resources/app-smyth/server.js exists`, exists(smythServer) || exists(smythServerUnpacked));

    const omniServer = path.join(resources, 'app-omniroute', 'server.js');
    const omniServerUnpacked = path.join(resources, 'app.asar.unpacked', 'app-omniroute', 'server.js');
    const omniMarker = path.join(resources, '..', '..', 'installer', '.omniroute-prerequisite.json');
    // OmniRoute is shelled out to global CLI (Track B pivot) — app-omniroute is optional
    if (exists(omniServer) || exists(omniServerUnpacked)) {
      ok(`Contents/Resources/app-omniroute/server.js exists`);
    } else {
      info(`app-omniroute not bundled — using global OmniRoute CLI (Track B pivot) — OK`);
    }

    const legalDir = path.join(resources, 'legal');
    if (exists(legalDir)) {
      const files = fs.readdirSync(legalDir);
      check(`legal/ has 5+ files (${files.length})`, files.length >= 5);
    } else {
      fail(`legal/ missing under Resources/`);
    }

    const chromium = path.join(resources, 'chromium');
    if (exists(chromium)) {
      ok(`chromium/ present`);
    } else {
      info(`chromium/ missing — Playwright fallback only (warning)`);
    }
  }

  // Print sizes.
  if (process.platform === 'darwin') {
    try {
      const out = require('child_process').execSync(`du -sh "${DIST}"/*.dmg 2>/dev/null || true`, { encoding: 'utf8' });
      info(out.trim());
    } catch { /* ignore */ }
  }

  if (process.exitCode) {
    console.error('\x1b[31m[smoke-dist]\x1b[0m FAILED');
  } else {
    console.log('\x1b[32m[smoke-dist]\x1b[0m OK');
  }
}

main();

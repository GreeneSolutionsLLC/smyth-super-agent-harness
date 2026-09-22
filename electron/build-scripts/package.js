#!/usr/bin/env node
/**
 * package.js — Programmatic wrapper around electron-builder.
 *
 * Track B owner. Optional entry point — npm `electron:build` calls the scripts
 * directly. This script orchestrates the full packaging pipeline in one shot:
 *
 *   1. Confirm prerequisites (Track A + Track C + Track D have placed their
 *      files at the expected paths).
 *   2. Run build-smyth.js if electron/dist/app-smyth/server.js is missing.
 *   3. Run build-omniroute.js to verify the OmniRoute CLI prerequisite.
 *   4. Stage the Electron shell from electron/*.js into electron/dist/electron/.
 *   5. Invoke electron-builder with the config in electron-builder.yml.
 *
 * Flags (positional, optional):
 *   --arch arm64|x64  Forward to electron-builder (defaults to arm64).
 *   --target dmg|zip|all
 *   --no-clean        Skip the initial electron/dist cleanup.
 *   --smyth-only      Only run build-smyth (useful for iteration).
 *   --omni-only       Only run the OmniRoute prerequisite check.
 *
 * Environment:
 *   SMYTH_SKIP_SMYTH=1     Skip build-smyth (use existing dist)
 *   SMYTH_SKIP_OMNI=1      Skip the OmniRoute prerequisite check
 *   SMYTH_SKIP_BUILDER=1   Skip electron-builder invocation
 *
 * Exit codes:
 *   0 success
 *   1 prerequisite missing
 *   2 build-smyth failed
 *   3 build-omniroute failed
 *   4 staging failed
 *   5 electron-builder failed
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(__dirname, '..', 'dist');
const ELECTRON_DIR = path.resolve(__dirname, '..');   // electron/* (Track A)

const REQUIRED_ELECTRON_FILES = [
  'main.js',
  'preload.js',
  'server-manager.js',
  'tray.js',
  'menu.js',
  'constants.js',
];

const TAG = '\x1b[32m[package]\x1b[0m';
function log(msg) { console.log(`${TAG} ${msg}`); }
function warn(msg) { console.warn(`${TAG} \x1b[33m${msg}\x1b[0m`); }
function die(code, msg) {
  console.error(`${TAG} \x1b[31mFATAL: ${msg}\x1b[0m`);
  process.exit(code);
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function runNode(script, args = []) {
  log(`→ node ${path.relative(ROOT, script)}${args.length ? ' ' + args.join(' ') : ''}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    cwd: ROOT,
    env: process.env,
  });
  if (r.status !== 0) {
    const codeMap = {
      'build-smyth.js': 2,
      'build-omniroute.js': 3,
    };
    const code = codeMap[path.basename(script)] || 1;
    die(code, `Script failed: ${path.basename(script)} (exit ${r.status})`);
  }
}

function runShell(cmd) {
  log(`$ ${cmd}`);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, cwd: ROOT });
  return r.status;
}

function checkPrerequisites() {
  let ok = true;

  // Track A — Electron shell
  for (const f of REQUIRED_ELECTRON_FILES) {
    const p = path.join(ELECTRON_DIR, f);
    if (!exists(p)) {
      warn(`Missing electron/${f} (Track A deliverable).`);
      ok = false;
    }
  }

  // Track B assets we depend on
  const iconIcns = path.join(ROOT, 'build', 'icon.icns');
  if (!exists(iconIcns)) {
    warn(`Missing build/icon.icns (Track D deliverable: electron/build-assets/icon.icns).`);
    ok = false;
  }
  const entitlements = path.join(ROOT, 'build', 'entitlements.mac.plist');
  if (!exists(entitlements)) {
    warn(`Missing build/entitlements.mac.plist.`);
    ok = false;
  }

  // Track C — src/ must at least exist (we don't build anything from it here).
  if (!exists(path.join(ROOT, 'src'))) {
    warn('Missing src/ (Track C owns — bundling won\'t include it later, but standalone build depends on it).');
    ok = false;
  }

  // Legal — Track D
  const legal = path.join(ROOT, 'resources', 'legal');
  if (!exists(legal)) {
    warn('Missing resources/legal/ (Track D deliverable).');
  }

  // electron-builder
  try {
    const v = execSync('npx --no-install electron-builder --version', { cwd: ROOT, encoding: 'utf8' }).trim();
    log(`electron-builder: ${v}`);
  } catch {
    warn('electron-builder not installed. Run `npm install --save-dev electron-builder`.');
    ok = false;
  }

  if (!ok) {
    die(1, 'Prerequisites not met. Resolve warnings above before packaging.');
  }
}

async function stageElectronShell() {
  // electron-builder with `app: electron/dist` needs electron/main.js at
  // electron/dist/electron/main.js (or whichever layout matches its config).
  // We structured electron-builder.yml assuming Contents/Resources layout, so
  // the Electron shell sources belong under electron/dist/electron/.
  const src = ELECTRON_DIR;
  const dest = path.join(DIST, 'electron');
  await rimraf(dest);
  await fsp.mkdir(dest, { recursive: true });

  for (const f of REQUIRED_ELECTRON_FILES) {
    await fsp.copyFile(path.join(src, f), path.join(dest, f));
  }

  // electron-builder requires a package.json in the app dir (electron/dist).
  // Its `main` field points at the Electron entry so electron-builder knows
  // what to launch. Without this, electron-builder fails with
  // "Cannot find package.json in the .../electron/dist".
  const pkg = {
    name: 'smyth-electron',
    version: '2.0.0',
    description: 'Smyth Super Agent — Electron shell',
    main: 'electron/main.js',
    author: 'Greene Solutions LLC',
    license: 'UNLICENSED',
    private: true,
  };
  await fsp.writeFile(path.join(DIST, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  log(`Wrote package.json → ${path.relative(ROOT, DIST)}/package.json`);

  log(`Staged ${REQUIRED_ELECTRON_FILES.length} Electron shell files → ${path.relative(ROOT, dest)}/`);
}

async function stagePublicAssets() {
  // electron/server-manager.js → SMYTH_CHROMIUM_PATH expects /chromium inside
  // resources. We copy:
  //   electron/dist/public → /Resources/public
  // (Public is also separately packaged via the extraResources block in
  // electron-builder.yml for the Electron shell.)
  const src = path.join(ROOT, 'public');
  const dest = path.join(DIST, 'public');
  if (!exists(src)) {
    warn('public/ not found — skipping copy.');
    return;
  }
  await rimraf(dest);
  await fsp.cp(src, dest, { recursive: true, dereference: true });
  log(`Staged public/ → ${path.relative(ROOT, dest)}/`);
}

async function stageLegal() {
  // electron-builder.yml declares extraResources: from electron/dist/legal/...
  // Track D places files under resources/legal/, so copy them into the
  // staging dir for electron-builder to find.
  const src = path.join(ROOT, 'resources', 'legal');
  const dest = path.join(DIST, 'legal');
  if (!exists(src)) {
    warn('resources/legal/ missing — Track D in progress. Skipping.');
    return;
  }
  await rimraf(dest);
  await fsp.cp(src, dest, { recursive: true, dereference: true });
  log(`Staged legal/ → ${path.relative(ROOT, dest)}/ (${fs.readdirSync(dest).length} files)`);
}

async function rimraf(p) {
  if (!exists(p)) return;
  await fsp.rm(p, { recursive: true, force: true });
}

async function writeReleaseMarker(stageName) {
  // Useful for debugging which stages ran.
  const marker = path.join(DIST, '.stages.log');
  await fsp.appendFile(marker, `${new Date().toISOString()} ${stageName}\n`, { encoding: 'utf8' });
}

function parseArgs(argv) {
  const flags = { arch: 'arm64', target: 'dmg', clean: true, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--arch') flags.arch = argv[++i];
    else if (a === '--target') flags.target = argv[++i];
    else if (a === '--no-clean') flags.clean = false;
    else if (a === '--smyth-only') flags.only = 'smyth';
    else if (a === '--omni-only') flags.only = 'omni';
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  log(`ROOT       = ${ROOT}`);
  log(`DIST       = ${DIST}`);
  log(`arch       = ${flags.arch}`);
  log(`target     = ${flags.target}`);
  log(`buildonly  = ${flags.only || 'none'}`);

  checkPrerequisites();

  // Stage 1: build-smyth
  const smythServer = path.join(DIST, 'app-smyth', 'server.js');
  if (!process.env.SMYTH_SKIP_SMYTH) {
    if (exists(smythServer) && flags.only === null) {
      log(`app-smyth/server.js already exists — skipping build-smyth. (use --smyth-only to force)`);
    } else {
      runNode(path.join(__dirname, 'build-smyth.js'));
      await writeReleaseMarker('build-smyth');
    }
  } else {
    log('SMYTH_SKIP_SMYTH=1 — using existing app-smyth/server.js');
  }

  if (flags.only === 'smyth') {
    log('smyth-only mode → exiting after build-smyth.');
    return;
  }

  // Stage 2: OmniRoute runtime prerequisite check (Track B pivot).
  // The Electron app now shells out to the global `omniroute` CLI on the
  // user's machine instead of bundling a copy. We only verify it exists here.
  if (!process.env.SMYTH_SKIP_OMNI) {
    runNode(path.join(__dirname, 'build-omniroute.js'));
    await writeReleaseMarker('build-omniroute');
  } else {
    log('SMYTH_SKIP_OMNI=1 — skipping OmniRoute prerequisite check.');
  }

  if (flags.only === 'omni') {
    log('omni-only mode → exiting after OmniRoute prerequisite check.');
    return;
  }

  // Stage 3: stage supporting assets
  try {
    await stageElectronShell();
    await stagePublicAssets();
    await stageLegal();
    await writeReleaseMarker('stage-assets');
  } catch (e) {
    die(4, `Staging failed: ${e.message}`);
  }

  if (process.env.SMYTH_SKIP_BUILDER === '1') {
    log('SMYTH_SKIP_BUILDER=1 — skipping electron-builder.');
    return;
  }

  // Stage 4: electron-builder
  log('Running electron-builder…');
  const targets = flags.target === 'all'
    ? 'dmg zip'
    : flags.target;

  const cmd = [
    'npx --no-install electron-builder',
    `--mac --${flags.arch}`,
    `--projectDir "${ROOT}"`,
  ].join(' ');

  const status = runShell(cmd);
  if (status !== 0) die(5, `electron-builder exited with status ${status}`);

  await writeReleaseMarker('electron-builder');
  log('✅ package complete → dist/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

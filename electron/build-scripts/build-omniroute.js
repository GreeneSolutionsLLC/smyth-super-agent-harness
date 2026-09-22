#!/usr/bin/env node
/**
 * build-omniroute.js — Runtime-prerequisite check (Track B pivot).
 *
 * Instead of bundling the whole OmniRoute distribution into the app (which made
 * the packaged app 2.9 GB and duplicated the user's existing install), the
 * Electron shell now shells out to the global `omniroute` CLI at runtime.
 *
 * This script does the build-time checks we still need:
 *   1. Locate the OmniRoute CLI on the build machine.
 *   2. Verify it runs and record its version.
 *   3. Emit a marker so packaging can proceed.
 *
 * Runtime lookup logic lives in electron/constants.js::findOmnirouteCli().
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(__dirname, '..', 'dist');
const MARKER = path.join(DIST, '.omniroute-prerequisite.json');

const CANDIDATE_OMNIROUTE_PATHS = [
  path.join(process.env.HOME || '', '.hermes', 'node', 'bin', 'omniroute'),
  '/opt/homebrew/bin/omniroute',
  '/usr/local/bin/omniroute',
  '/usr/bin/omniroute',
];

const TAG = '\x1b[35m[build-omniroute]\x1b[0m';
function log(msg) { console.log(`${TAG} ${msg}`); }
function die(msg) { console.error(`${TAG} \x1b[31mFATAL: ${msg}\x1b[0m`); process.exit(1); }

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function findOmnirouteCli() {
  if (process.env.OMNIROUTE_CLI && exists(process.env.OMNIROUTE_CLI)) {
    return process.env.OMNIROUTE_CLI;
  }
  try {
    const which = spawnSync('which', ['omniroute'], { encoding: 'utf8', shell: false });
    if (which.status === 0) {
      const found = which.stdout.trim().split('\n')[0];
      if (found && exists(found)) return found;
    }
  } catch {}
  for (const candidate of CANDIDATE_OMNIROUTE_PATHS) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

async function main() {
  log('Pivot: OmniRoute will be resolved at runtime from the local install.');

  const bin = findOmnirouteCli();
  if (!bin) {
    die(
      'OmniRoute CLI not found on this machine. ' +
      'Install it globally (or ensure `omniroute` is in PATH), ' +
      'then re-run packaging.'
    );
  }
  log(`Found OmniRoute at: ${bin}`);

  const version = spawnSync(bin, ['--version'], {
    encoding: 'utf8',
    shell: false,
  });
  if (version.status !== 0) {
    die(`OmniRoute CLI exists but did not run cleanly: ${version.stderr || version.stdout}`);
  }
  const v = version.stdout.trim() || version.stderr.trim();
  log(`OmniRoute version: ${v}`);

  await fsp.mkdir(DIST, { recursive: true });
  await fsp.writeFile(
    MARKER,
    JSON.stringify({ bin, version: v, checkedAt: new Date().toISOString() }, null, 2)
  );
  log(`Wrote prerequisite marker: ${path.relative(ROOT, MARKER)}`);
  log('✅ build-omniroute prerequisite check complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

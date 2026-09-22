#!/usr/bin/env node
/**
 * build-smyth.js — Build Smyth Next.js into electron/dist/app-smyth/.
 *
 * Pipeline:
 *   1. Run `next build` (if .next doesn't exist)
 *   2. Copy .next/standalone/ runtime subset → electron/dist/app-smyth/
 *   3. Overlay electron/server.js to wire up per-user .env loading
 *   4. Copy resources/default.env → electron/dist/app-smyth/default.env
 *   5. Prune dev-only npm packages (electron, etc.)
 *   6. Prune non-arm64 .node prebuilds
 *   7. Strip .map files
 */

'use strict';

const { execSync, spawnSync, exec } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.resolve(__dirname, '..', 'dist');
const APP_SMYTH = path.join(DIST, 'app-smyth');

const TAG = '\x1b[36m[build-smyth]\x1b[0m';
function log(msg) { console.log(`${TAG} ${msg}`); }
function warn(msg) { console.warn(`${TAG} \x1b[33m${msg}\x1b[0m`); }
function die(msg) { console.error(`${TAG} \x1b[31mFATAL: ${msg}\x1b[0m`); process.exit(1); }

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function run(cmd, opts = {}) {
  log(`$ ${cmd}`);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, cwd: ROOT, ...opts });
  if (r.status !== 0) die(`Command failed (exit ${r.status}): ${cmd}`);
}

async function rimraf(p) {
  if (!exists(p)) return;
  log(`rm -rf ${path.relative(ROOT, p)}`);
  await fsp.rm(p, { recursive: true, force: true });
}

// Skip junk files when copying
function skipJunk(src) {
  const rel = path.relative(ROOT, src);
  if (rel.includes('.git/') || rel.includes('.DS_Store') || rel.includes('node_modules/.cache')) return false;
  // Skip broken symlinks in node_modules/.bin
  try { return fs.existsSync(src); } catch { return false; }
}

async function copyDir(src, dest, filter) {
  if (!exists(src)) { warn(`Source missing, skipping: ${path.relative(ROOT, src)}`); return; }
  await fsp.mkdir(dest, { recursive: true });
  await fsp.cp(src, dest, { recursive: true, dereference: true, filter });
  log(`cp -r ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`);
}

async function copyFile(src, dest) {
  if (!exists(src)) { warn(`Source missing, skipping: ${path.relative(ROOT, src)}`); return; }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
  log(`cp ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`);
}

async function pruneOffPlatformNodeBinaries(rootDir) {
  let removed = 0;
  let removedBytes = 0;
  const stack = [rootDir];
  const KEEP_PLATFORM_RE = /(darwin-arm64|darwin-universal)/i;
  const ONNX_PLATFORM_DIR_RE = /^node-(linux-x64|win32-x64|linux-arm64|darwin-x64|freebsd|openbsd|sunos)-/i;

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (full === path.join(rootDir, 'public')) continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;

      if (/\.node$/i.test(ent.name) && !KEEP_PLATFORM_RE.test(full)) {
        try { const st = await fsp.stat(full); await fsp.unlink(full); removed++; removedBytes += st.size; } catch {}
      }
      if (ONNX_PLATFORM_DIR_RE.test(ent.name)) {
        try { const st = await fsp.stat(full); await fsp.rm(full, { recursive: true, force: true }); removed++; removedBytes += st.size; } catch {}
      }
    }
  }
  if (removed > 0) { log(`Pruned ${removed} off-platform binaries (${(removedBytes/1024/1024).toFixed(1)} MB)`); }
  else { log(`No off-platform binaries to prune.`); }
}

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: ROOT }, (err, stdout, stderr) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}

async function main() {
  log(`ROOT  = ${ROOT}`);
  log(`DIST  = ${DIST}`);
  log(`OUT   = ${APP_SMYTH}`);

  // 1. Reset output
  await rimraf(APP_SMYTH);
  await fsp.mkdir(APP_SMYTH, { recursive: true });

  // 2. Run next build if .next doesn't exist
  const nextDir = path.join(ROOT, '.next');
  if (!exists(nextDir) || !exists(path.join(nextDir, 'BUILD_ID'))) {
    log('Running `next build --webpack` (this can take a while)…');
    run('NODE_OPTIONS="--max-old-space-size=2048" npx --no-install next build --webpack', { cwd: ROOT });
  } else {
    log('Found existing .next/ build — skipping next build');
  }

  // 3. Copy only the required subset of .next/standalone/ into app-smyth/.
  // Next.js standalone copies the whole project root, which pulls in unrelated
  // workspace directories (vendor, dist, video_assets, etc.). We select only
  // the runtime pieces and overlay our custom server/env wiring.
  const standaloneDir = path.join(ROOT, '.next', 'standalone');
  if (!exists(standaloneDir)) die('Expected .next/standalone after next build');
  log('Copying .next/standalone runtime subset → app-smyth/');
  await copyDir(path.join(standaloneDir, '.next'), path.join(APP_SMYTH, '.next'), skipJunk);
  await copyDir(path.join(standaloneDir, 'node_modules'), path.join(APP_SMYTH, 'node_modules'), skipJunk);
  await copyDir(path.join(standaloneDir, 'public'), path.join(APP_SMYTH, 'public'), skipJunk);
  await copyFile(path.join(standaloneDir, 'package.json'), path.join(APP_SMYTH, 'package.json'));

  // Next.js standalone output does NOT include .next/static (the compiled
  // JS/CSS chunks). The server needs it to serve the app; without it the
  // server crashes with ENOENT scandir '.next/static'. Copy it from the
  // full .next build output.
  const staticSrc = path.join(ROOT, '.next', 'static');
  if (exists(staticSrc)) {
    await copyDir(staticSrc, path.join(APP_SMYTH, '.next', 'static'), skipJunk);
    log('Copied .next/static → app-smyth/.next/static');
  } else {
    warn('.next/static not found — server may fail to serve assets');
  }

  // Next.js standalone tracing omits most of next/dist/compiled (only ~4.5M
  // of 107M is traced) even though config-utils.js and friends require it at
  // runtime. Without this, server.js crashes with a cascade of
  //   Cannot find module 'next/dist/compiled/...'
  // errors. Copy the ENTIRE compiled dir from the full node_modules install.
  const compiledSrc = path.join(ROOT, 'node_modules', 'next', 'dist', 'compiled');
  const compiledDest = path.join(APP_SMYTH, 'node_modules', 'next', 'dist', 'compiled');
  if (exists(compiledSrc)) {
    await copyDir(compiledSrc, compiledDest, skipJunk);
    log('Copied full next/dist/compiled → app-smyth/');
  } else {
    warn('next/dist/compiled not found in node_modules — server may fail to start');
  }

  // 4. Overlay custom server.js for per-user .env loading
  await copyFile(path.join(ROOT, 'electron', 'server.js'), path.join(APP_SMYTH, 'server.js'));

  // 5. Overlay default.env (keeps baked-in secrets out of the binary)
  await copyFile(path.join(ROOT, 'resources', 'default.env'), path.join(APP_SMYTH, 'default.env'));

  // 5b. Copy MCP server config (needed for discoverStdioTools at runtime)
  await copyFile(path.join(ROOT, 'mcp-servers.yaml'), path.join(APP_SMYTH, 'mcp-servers.yaml'));

  // 5c. Copy macOS-MCP pre-built bundle (282MB Python bundle with launcher)
  const macosMcpBundle = path.join(ROOT, 'vendor', 'macos-mcp', 'bundle');
  if (exists(macosMcpBundle)) {
    await copyDir(macosMcpBundle, path.join(APP_SMYTH, 'vendor', 'macos-mcp', 'bundle'), skipJunk);
  } else {
    warn('macOS-MCP bundle not found at vendor/macos-mcp/bundle — macOS automation will not work');
  }

  // 6. Prune dev-only/runtime-unnecessary packages from the traced node_modules.
  // Electron ships its own binary via the packager; the bundled Smyth server
  // never needs the `electron` npm package and it pulls in a full Electron.app.
  const devOnlyPackages = ['electron', 'electron-builder', 'electron-notarize', 'electron-log', 'app-builder-lib'];
  for (const name of devOnlyPackages) {
    const p = path.join(APP_SMYTH, 'node_modules', name);
    if (exists(p)) {
      log(`Removing dev-only dependency from bundle: node_modules/${name}`);
      await fsp.rm(p, { recursive: true, force: true });
    }
  }
  // Also remove the .bin shim for electron
  const electronBin = path.join(APP_SMYTH, 'node_modules', '.bin', 'electron');
  if (exists(electronBin)) await fsp.rm(electronBin, { force: true });

  // 7. Prune off-platform native binaries
  log('Pruning off-platform native binaries…');
  await pruneOffPlatformNodeBinaries(APP_SMYTH);

  // 8. Strip .map files
  log('Stripping .map files…');
  await execPromise(`find "${APP_SMYTH}" -type f -name '*.map' -delete 2>/dev/null || true`);

  // 9. Verify server.js
  const serverJs = path.join(APP_SMYTH, 'server.js');
  if (!exists(serverJs)) die(`Expected ${path.relative(ROOT, serverJs)} after build but missing.`);

  // 10. Size report
  const out = await execPromise(`du -sh ${JSON.stringify(APP_SMYTH)}`);
  log(`Standalone size: ${out.trim()}`);
  log('✅ build-smyth complete → electron/dist/app-smyth/');
}

main().catch((e) => { console.error(e); process.exit(1); });
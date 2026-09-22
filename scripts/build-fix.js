// Fix for Next.js 16 Turbopack standalone build bugs
// Creates missing manifest files that Turbopack fails to generate
const fs = require('fs');
const path = require('path');

const nextDir = path.join(process.cwd(), '.next');

// 1. Fix _ssgManifest.js in static/<buildId>/
const staticDir = path.join(nextDir, 'static');
if (fs.existsSync(staticDir)) {
  for (const dir of fs.readdirSync(staticDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifestPath = path.join(staticDir, dir.name, '_ssgManifest.js');
    if (!fs.existsSync(manifestPath)) {
      fs.writeFileSync(manifestPath, 'self.__BUILD_MANIFEST_CB=[];self.__BUILD_MANIFEST={};');
      console.log(`[build-fix] Created _ssgManifest.js in ${dir.name}`);
    }
  }
}

// 2. Fix functions-config-manifest.json in server/
const serverDir = path.join(nextDir, 'server');
const fnConfigManifest = path.join(serverDir, 'functions-config-manifest.json');
if (fs.existsSync(serverDir) && !fs.existsSync(fnConfigManifest)) {
  fs.writeFileSync(fnConfigManifest, '{}');
  console.log('[build-fix] Created functions-config-manifest.json');
}

// 3. Ensure standalone server dir exists for copyfile
const standaloneServerDir = path.join(nextDir, 'standalone', '.next', 'server');
if (fs.existsSync(standaloneServerDir) && !fs.existsSync(path.join(standaloneServerDir, 'functions-config-manifest.json'))) {
  fs.writeFileSync(path.join(standaloneServerDir, 'functions-config-manifest.json'), '{}');
  console.log('[build-fix] Created standalone functions-config-manifest.json');
}

console.log('[build-fix] Done');
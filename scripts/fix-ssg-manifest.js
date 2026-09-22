// Fix for Next.js 16 Turbopack bug: _ssgManifest.js missing
// This script creates the file after build completes
const fs = require('fs');
const path = require('path');

const staticDir = path.join(process.cwd(), '.next', 'static');
if (!fs.existsSync(staticDir)) {
  console.log('[fix-ssg-manifest] .next/static not found, skipping');
  process.exit(0);
}

const buildIdDirs = fs.readdirSync(staticDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const dir of buildIdDirs) {
  const manifestPath = path.join(staticDir, dir, '_ssgManifest.js');
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, 'self.__BUILD_MANIFEST_CB=[];self.__BUILD_MANIFEST={};');
    console.log(`[fix-ssg-manifest] Created ${manifestPath}`);
  } else {
    console.log(`[fix-ssg-manifest] Already exists: ${manifestPath}`);
  }
}
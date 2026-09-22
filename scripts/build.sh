#!/bin/bash
# Build wrapper that patches Next.js 16 Turbopack bugs in real-time
set -uo pipefail
cd "$(dirname "$0")/.."

rm -rf .next

# Start next build in background
npx next build &
BUILD_PID=$!

# Watcher: create missing files as build progresses
while kill -0 $BUILD_PID 2>/dev/null; do
  # Fix _ssgManifest.js
  find .next/static -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r dir; do
    if [ ! -f "$dir/_ssgManifest.js" ]; then
      echo 'self.__BUILD_MANIFEST_CB=[];self.__BUILD_MANIFEST={};' > "$dir/_ssgManifest.js" 2>/dev/null
    fi
  done
  
  # Fix functions-config-manifest.json
  if [ -d .next/server ] && [ ! -f .next/server/functions-config-manifest.json ]; then
    echo '{}' > .next/server/functions-config-manifest.json 2>/dev/null
  fi
  
  # Don't pre-create standalone dirs — Next.js manages those itself
  
  sleep 0.2
done

wait $BUILD_PID
EXIT_CODE=$?

# Post-build fix for any remaining issues
node scripts/build-fix.js 2>/dev/null

echo "Build exit code: $EXIT_CODE"
exit $EXIT_CODE
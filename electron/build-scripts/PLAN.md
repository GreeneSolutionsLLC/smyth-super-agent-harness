# Build & Packaging Plan — Smyth.app

Owner: Mini Max M3  
Reviewer: Grok (Electron main), Main / Kimi (integration), Rook (product)  
Scope: v2 full app, macOS arm64 `.dmg`

---

## 1. Build Pipeline Overview

```
1. npm install dependencies
2. Build Smyth Next.js standalone → .next/standalone
3. Copy static assets → .next/standalone
4. Copy .env.example → resources/default.env (no keys)
5. Install/bundle OmniRoute → resources/app-omniroute
6. Bundle legal HTML → resources/legal/
7. Copy electron shell → resources/electron/
8. electron-builder package → dist/mac-arm64/Smyth.app
9. electron-builder dmg → dist/Smyth-x.y.z.dmg
```

---

## 2. Package.json Scripts

Add to root `package.json`:

```json
{
  "scripts": {
    "electron:dev": "concurrently \"next dev\" \"wait-on http://127.0.0.1:3000 && electron electron/main.js\"",
    "electron:build": "node electron/build-scripts/build-smyth.js && node electron/build-scripts/build-omniroute.js && electron-builder",
    "electron:dist": "npm run electron:build && electron-builder --mac --arm64 --publish=never",
    "electron:pack": "electron-builder --dir",
    "postinstall": "electron-builder install-app-deps"
  }
}
```

Dev dependencies to add:
- `electron`
- `electron-builder`
- `concurrently`
- `wait-on`
- `dotenv`

---

## 3. Next.js Standalone Build

### next.config.ts changes
- Ensure `output: 'standalone'` is set.
- Ensure `distDir: '.next'`.
- Add `images.unoptimized: true` if `sharp` causes native module issues in Electron context.
- Add `trailingSlash: false` (or keep current).
- No `export` mode; we need a running server.

### build-smyth.js
1. Run `next build`.
2. Copy `.next/standalone/**/*` to `electron/dist/app-smyth/`.
3. Copy `public/` to `electron/dist/app-smyth/public/`.
4. Copy `resources/default.env` to `electron/dist/app-smyth/`.
5. Copy any required native `.node` modules or generated server files.
6. Ensure `server.js` is executable and starts on `process.env.PORT`.

---

## 4. OmniRoute Bundling

### Option A: Local node_modules bundle (recommended)
- `npm install omniroute --prefix electron/dist/app-omniroute`
- Entry point: `electron/dist/app-omniroute/node_modules/omniroute/dist/server.js` or package-defined `bin`.
- Main process launches via `node <entry> --port <dynamic>`.

### Chromium bundling
- Use `npx playwright install chromium` during build.
- Find installed browser directory with `npx playwright install --dry-run chromium` or via Playwright's registry helpers.
- Copy Chromium `.app` bundle into `resources/chromium/` (path pattern: `resources/chromium/chrome-mac/Chromium.app/Contents/MacOS/Chromium`).
- Set `SMYTH_CHROMIUM_PATH` from Electron main to this executable.
- Do not install `firefox`, `webkit`, or `chrome-beta` unless later needed.

### Mandatory pruning step (critical): after `npm install`, the build script MUST prune non-darwin native prebuilds before packaging:
1. Delete `*.node` files under `node_modules/**` that target non-`darwin-arm64` platforms (e.g. `linux-x64`, `win32-x64`, `linux-arm64` — keep only `darwin-arm64`).
2. Prune `onnxruntime-node` cross-platform binaries: delete non-darwin `.node`/binary payloads (~100MB of the total).
3. Optionally run `npm prune --production` on the prefix and remove `.map` files.
4. Verify: `find <prefix> -name '*.node' | wc -l` should drop from ~80 to ~19 (darwin-arm64 only).

This is mandatory — 61 of 80 native `.node` files are for other platforms and would bloat the DMG by hundreds of MB.

### Option B: Global fallback
- If bundling fails, Electron main can try `npx omniroute serve` but this requires network.
- Avoid for packaged app.

### Configuration
- OmniRoute reads `.env` from `SMYTH_USER_DATA/.env`.
- Pass `PORT` dynamically to avoid conflict.
- Pre-seed `~/.omniroute/storage.sqlite` if needed for first-run stability.

---

## 5. Electron-Builder Config

File: `electron-builder.yml` at repo root.

```yaml
appId: com.greenesolutions.smyth
productName: Smyth
asar: true
directories:
  output: dist
  buildResources: build
files:
  - "electron/main.js"
  - "electron/preload.js"
  - "electron/menu.js"
  - "electron/tray.js"
  - "electron/server-manager.js"
  - "electron/constants.js"
  - "electron/dist/**/*"
  - "resources/**/*"
mac:
  target:
    - dmg
  category: public.app-category.productivity
  artifactName: "Smyth-${version}-${arch}.dmg"
  hardenedRuntime: false
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  icon: build/icon.icns
dmg:
  sign: false
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
  window:
    width: 540
    height: 380
```

### Artwork specs for Rob

| Asset | File | Size | Notes |
|-------|------|------|-------|
| App icon | `build/icon.icns` | 1024×1024 px source, generated `.icns` contains 16/32/64/128/256/512/1024 | macOS app icon. Use a single centered logo on transparent or matching background. |
| DMG background | `build/background.png` | 1200×800 px @ 144 DPI (or 2400×1600 px) | Retina-ready background with "Drag to Applications" arrow. |
| DMG icon app | auto-generated | follows app icon | Electron-builder uses `build/icon.icns`. |
| DMG icon Applications folder | auto-generated | system alias | `type: link` in builder config. |

Recommended colors: use Smyth brand colors from `public/Artwork/` — dark background, accent for arrow/text.

### Assets needed
- `build/icon.icns` (app icon)
- `build/background.png` (DMG background)
- `build/entitlements.mac.plist`:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
    <dict>
      <key>com.apple.security.cs.allow-jit</key><true/>
      <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
      <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
    </dict>
  </plist>
  ```

### Info.plist additions
Electron-builder can merge `extendInfo`:
```yaml
mac:
  extendInfo:
    NSCameraUsageDescription: "Smyth uses the camera for EchoVision analysis and video calls."
    NSMicrophoneUsageDescription: "Smyth uses the microphone for voice input and meetings."
    NSAccessibilityUsageDescription: "Smyth uses accessibility features to assist with UI automation."
```

---

## 6. Size Optimization Target

Goal: under 400 MB installed, under 200 MB `.dmg`. **Note: this target is provisional — see updated estimate below. Rob decision required on whether to accept ~800 MB or defer OmniRoute features.**

### Updated size estimate (post-pruning)
- Electron runtime: ~180 MB
- Smyth Next.js standalone: ~120–180 MB
- OmniRoute bundle (pruned to darwin-arm64 only): ~400–500 MB (835 MB unpruned)
- Static assets + legal: ~5 MB
- **Total installed: ~730–830 MB**
- **Compressed `.dmg`: ~350–450 MB**

If this is unacceptable: defer non-essential OmniRoute features/panels to get back under 400 MB installed. Pruning alone will NOT reach the original target.

### Strategies
1. **Exclude dev dependencies** from both app bundles.
2. **Tree-shake Smyth frontend** — only ship panels included in v2 scope.
3. **Omit Python runtime** — detect/prompt, do not bundle.
4. **Omit large model weights** — no models ship with the app.
5. **Compress assets** with `asar` and `dmg` compression.
6. **Deduplicate Node modules** between Smyth and OmniRoute where safe.
7. **Avoid shipping `.map` files** in production.
8. **Move `crawlee` to devDependencies** — verified: imported nowhere in `src/` (dead dependency, ~tens of MB). `playwright` stays in `dependencies` — `src/lib/perchance.ts:90` launches Chromium at runtime for image generation.
9. **Bundle Chromium for Playwright** — download/extract the darwin-arm64 Chromium revision used by the installed `playwright` version into `resources/chromium/` (e.g. via `npx playwright install chromium` at build time). The bundled copy is the only browser Smyth is allowed to launch at runtime. Do NOT install other Playwright browsers unless required later.
10. **Prune non-darwin native prebuilds** across Smyth and OmniRoute bundles before packaging (cross-platform `.node` files bloat the app by ~100+ MB).

### Likely size estimate (updated)
- Electron runtime: ~180 MB
- Smyth Next.js standalone: ~120–180 MB
- OmniRoute bundle (pruned to darwin-arm64 only): ~400–500 MB (835 MB unpruned)
- Bundled Chromium (Playwright darwin-arm64 only): ~180–250 MB
- Static assets + legal: ~5 MB
- **Total installed: ~900 MB–1.1 GB**
- **Compressed `.dmg`: ~450–650 MB**

Rob has approved the size: functionality first, size secondary. Size optimization remains a post-v2 goal.

If over 400 MB installed, defer non-essential panels from the standalone build.

---

## 7. Files to Create

```
electron/build-scripts/
├── PLAN.md                 # this file
├── build-smyth.js          # Next.js standalone build + copy
├── build-omniroute.js      # bundle OmniRoute
└── package.js              # optional: electron-builder programmatic wrapper

electron-builder.yml        # packaging config
build/
├── icon.icns               # app icon
├── background.png          # DMG background
└── entitlements.mac.plist  # sandbox/entitlements
```

### Modified files
- `package.json` — add scripts and dev deps
- `next.config.ts` — ensure `output: 'standalone'`, image unoptimized option

---

## 8. Open Questions

1. Does OmniRoute distribute a standalone server bundle, or must we install it via npm?  
   → Need to verify by inspecting `node_modules/omniroute` or running `npm pack omniroute`.

2. Are there native Node modules in Smyth that break cross-compilation?  
   → Run `npm install` and `next build` on the target Mac to detect.

3. Should the `.dmg` be signed?  
   → Not for v2 local installs. Add codesigning later for Gatekeeper distribution.

4. Which app icon and DMG background assets exist?  
   → Need to check design assets or create simple placeholder.

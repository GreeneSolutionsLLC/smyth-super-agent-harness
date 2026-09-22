#!/usr/bin/env node
/**
 * server.js — Custom Next.js server entry for Smyth standalone.
 * Used by Electron's server-manager to spawn the Next.js server.
 *
 * Loads the bundled default.env template first, then the per-user .env
 * file (SMYTH_ENV_PATH) so API keys are never baked into the binary.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

function userEnvPath() {
  if (process.env.SMYTH_ENV_PATH) return process.env.SMYTH_ENV_PATH;
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Smyth",
    ".env"
  );
}

function loadEnvSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      // Node 20.6+ native .env loader — avoids a dotenv dependency in the
      // minimal standalone bundle.
      if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(filePath);
      } else {
        // Fallback for older Node/Electron runtimes
        require("dotenv").config({ path: filePath, override: true });
      }
    }
  } catch (err) {
    console.warn(`[smyth] Could not load env file ${filePath}: ${err.message}`);
  }
}

// 1) Default template (empty keys, only defaults + documentation)
loadEnvSafe(path.join(__dirname, "default.env"));
// 2) Per-user secrets and overrides
loadEnvSafe(userEnvPath());

const next = require("next");
const { parse } = require("url");

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
const dir = __dirname;

const app = next({ dir, dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const http = require("http");
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });
  server.listen(PORT, HOST, () => {
    console.log(`[smyth] Server ready on http://${HOST}:${PORT}`);
  });
});

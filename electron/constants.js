const path = require('path');
const { app } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');

const APP_NAME = 'Smyth';
const APP_VERSION = '2.0.0';
const IS_DEBUG = process.env.SMYTH_DEBUG === '1';
const IS_MAC = process.platform === 'darwin';

const PORTS = {
  SMYTH: 3000,
  OMNIROUTE_START: 20128,
};

const HEALTH = {
  SMYTH_URL: `http://127.0.0.1:${PORTS.SMYTH}/api/health`,
  OMNIROUTE_PATH: '/v1/models',
  POLL_INTERVAL_MS: 1000,
  TIMEOUT_MS: 30000,
  RETRY_CYCLES: 3,
  RETRY_BACKOFF_MS: 2000,
};

const SHUTDOWN = {
  GRACEFUL_TIMEOUT_MS: 10000,
};

const WINDOW = {
  MIN_WIDTH: 1024,
  MIN_HEIGHT: 700,
  TITLE: 'Smyth',
};

const CANDIDATE_OMNIROUTE_PATHS = [
  path.join(process.env.HOME || '', '.hermes', 'node', 'bin', 'omniroute'),
  '/opt/homebrew/bin/omniroute',
  '/usr/local/bin/omniroute',
  '/usr/bin/omniroute',
];

function findOmnirouteCli() {
  if (process.env.OMNIROUTE_CLI) {
    if (fs.existsSync(process.env.OMNIROUTE_CLI)) return process.env.OMNIROUTE_CLI;
  }
  try {
    const which = spawnSync('which', ['omniroute'], { encoding: 'utf8', shell: false });
    if (which.status === 0) {
      const found = which.stdout.trim().split('\n')[0];
      if (found && fs.existsSync(found)) return found;
    }
  } catch {}
  for (const candidate of CANDIDATE_OMNIROUTE_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getPaths() {
  const userData = app.getPath('userData');
  const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
  const omnirouteDataDir = path.join(userData, 'omniroute');
  // app-smyth is copied verbatim via extraResources (see electron-builder.yml),
  // so it lands at Contents/Resources/app-smyth/ (not inside app.asar).
  const appSmythDir = path.join(resourcesPath, 'app-smyth');
  return {
    userData,
    logs: path.join(userData, 'logs'),
    envFile: path.join(userData, '.env'),
    smythUserData: path.join(userData, 'smyth'),
    smythServer: path.join(appSmythDir, 'server.js'),
    smythPublic: path.join(appSmythDir, 'public'),
    omnirouteCli: findOmnirouteCli(),
    omnirouteDataDir,
    omnirouteEnvFile: path.join(omnirouteDataDir, '.env'),
    chromium: path.join(resourcesPath, 'chromium'),
    public: path.join(resourcesPath, 'public'),
    legal: path.join(resourcesPath, 'legal'),
  };
}

module.exports = {
  APP_NAME,
  APP_VERSION,
  IS_DEBUG,
  IS_MAC,
  PORTS,
  HEALTH,
  SHUTDOWN,
  WINDOW,
  getPaths,
  findOmnirouteCli,
};

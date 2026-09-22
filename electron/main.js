const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { APP_NAME, APP_VERSION, IS_DEBUG, IS_MAC, WINDOW, getPaths } = require('./constants');
const { startAll, stopAll, getStatus, getOmniroutePort } = require('./server-manager');
const { createTray, destroyTray } = require('./tray');
const { createMenu } = require('./menu');

let mainWindow = null;
let omnirouteWindow = null;
let tray = null;
let serverStatus = { smyth: false, omniroute: false };

// ── Single Instance Lock ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Window Creation ──────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: WINDOW.TITLE,
    width: WINDOW.MIN_WIDTH,
    height: WINDOW.MIN_HEIGHT,
    minWidth: WINDOW.MIN_WIDTH,
    minHeight: WINDOW.MIN_HEIGHT,
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: IS_DEBUG,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load Smyth after servers are healthy
  mainWindow.loadURL(`http://127.0.0.1:3000`);

  // In dev mode, next dev is already serving on port 3000, so the health
  // check for the Smyth child process will be false. That's expected.
  if (process.env.SMYTH_DEV === '1' || process.env.NODE_ENV === 'development') {
    serverStatus.smyth = true;
    broadcastStatus();
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createOmnirouteWindow() {
  if (omnirouteWindow) {
    omnirouteWindow.show();
    omnirouteWindow.focus();
    return;
  }

  const port = getOmniroutePort();
  if (!port) return;

  omnirouteWindow = new BrowserWindow({
    title: 'OmniRoute',
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  omnirouteWindow.loadURL(`http://127.0.0.1:${port}`);
  omnirouteWindow.on('closed', () => {
    omnirouteWindow = null;
  });
}

// ── IPC Handlers ─────────────────────────────────────────────────
function registerIpcHandlers() {
  // Contract channels
  ipcMain.handle('smyth:server-status', () => {
    return getStatus();
  });

  ipcMain.handle('smyth:get-env', () => {
    const paths = getPaths();
    try {
      if (fs.existsSync(paths.envFile)) {
        const content = fs.readFileSync(paths.envFile, 'utf-8');
        const env = {};
        content.split('\n').forEach((line) => {
          const eq = line.indexOf('=');
          if (eq > 0) {
            const key = line.slice(0, eq).trim();
            const value = line.slice(eq + 1).trim();
            if (key) env[key] = value;
          }
        });
        return env;
      }
    } catch {}
    return {};
  });

  ipcMain.handle('smyth:restart-server', async () => {
    await stopAll();
    const result = await startAll();
    serverStatus = { smyth: result.smyth, omniroute: result.omniroute };
    broadcastStatus();
    return serverStatus;
  });

  ipcMain.handle('smyth:open-external', (_event, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
  });

  // Extended channels
  ipcMain.handle('smyth:get-servers', () => {
    const status = getStatus();
    return {
      smythUrl: status.smythUrl,
      omnirouteUrl: status.omnirouteUrl,
    };
  });

  ipcMain.handle('smyth:restart-servers', async () => {
    await stopAll();
    const result = await startAll();
    serverStatus = { smyth: result.smyth, omniroute: result.omniroute };
    broadcastStatus();
    return serverStatus;
  });

  ipcMain.handle('smyth:open-log', () => {
    const paths = getPaths();
    const logDir = paths.logs;
    fs.mkdirSync(logDir, { recursive: true });
    shell.openPath(logDir);
  });

  ipcMain.handle('smyth:show-omniroute', () => {
    createOmnirouteWindow();
  });

  ipcMain.handle('smyth:request-permission', async (_event, type) => {
    if (!IS_MAC) return { granted: true, note: 'not macOS' };
    try {
      if (type === 'camera') {
        const granted = await systemPreferences.askForMediaAccess('camera');
        return { granted };
      }
      if (type === 'microphone') {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        return { granted };
      }
      if (type === 'accessibility' || type === 'screen') {
        // Can't request programmatically — open System Settings
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        return { granted: false, note: 'opened System Settings' };
      }
    } catch (err) {
      return { granted: false, error: err.message };
    }
    return { granted: false, note: `unknown permission type: ${type}` };
  });

  ipcMain.handle('smyth:get-chromium-path', () => {
    const paths = getPaths();
    const chromiumPath = IS_MAC
      ? path.join(paths.chromium, 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      : path.join(paths.chromium, 'chrome');
    return chromiumPath;
  });

  ipcMain.handle('smyth:check-chromium-bundle', () => {
    const paths = getPaths();
    const chromiumPath = IS_MAC
      ? path.join(paths.chromium, 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      : path.join(paths.chromium, 'chrome');
    const ok = fs.existsSync(chromiumPath);
    return { ok, path: chromiumPath, error: ok ? null : 'Chromium bundle not found' };
  });

  ipcMain.handle('smyth:select-folder', async (_event, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0] || null;
  });

  ipcMain.handle('smyth:open-legal', async (_event, file) => {
    const paths = getPaths();
    const legalPath = path.join(paths.legal, file);
    if (fs.existsSync(legalPath)) {
      await shell.openPath(legalPath);
    } else {
      console.warn(`[main] Legal file not found: ${legalPath}`);
    }
  });

  ipcMain.handle('smyth:open-system-settings', async (_event, pane) => {
    if (!IS_MAC) return;
    const paneMap = {
      camera: 'Privacy_Camera',
      microphone: 'Privacy_Microphone',
      accessibility: 'Privacy_Accessibility',
      screen: 'Privacy_ScreenCapture',
    };
    const target = paneMap[pane] || 'Privacy';
    shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${target}`);
  });

  ipcMain.handle('smyth:get-user-data-path', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('smyth:open-user-data', () => {
    shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle('smyth:set-env', async (_event, key, value) => {
    const paths = getPaths();
    let envData = {};
    try {
      if (fs.existsSync(paths.envFile)) {
        const content = fs.readFileSync(paths.envFile, 'utf-8');
        content.split('\n').forEach((line) => {
          const eq = line.indexOf('=');
          if (eq > 0) {
            const k = line.slice(0, eq).trim();
            const v = line.slice(eq + 1).trim();
            if (k) envData[k] = v;
          }
        });
      }
    } catch {}
    envData[key] = value;
    const newContent = Object.entries(envData)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    fs.writeFileSync(paths.envFile, newContent, 'utf-8');
    // Restart Smyth to pick up new env
    await stopAll();
    const result = await startAll();
    serverStatus = { smyth: result.smyth, omniroute: result.omniroute };
    broadcastStatus();
    return { ok: true };
  });
}

// ── Status Broadcasting ──────────────────────────────────────────
function broadcastStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('smyth:server-status', serverStatus);
  }
}

// ── Crash Recovery ────────────────────────────────────────────────
async function attemptRecovery(failedServer) {
  console.error(`[main] ${failedServer} crashed, attempting recovery...`);
  const result = await startAll();
  serverStatus = { smyth: result.smyth, omniroute: result.omniroute };
  broadcastStatus();
  if (!result.smyth || !result.omniroute) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        document.body.dispatchEvent(new CustomEvent('smyth:crash', {
          detail: { message: 'Smyth engine needs to restart', server: '${failedServer}' }
        }));
      `).catch(() => {});
    }
  }
}

// ── App Lifecycle ─────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Start servers
  const result = await startAll();
  serverStatus = { smyth: result.smyth, omniroute: result.omniroute };

  // Create window
  createMainWindow();

  // Register IPC
  registerIpcHandlers();

  // Tray
  tray = createTray(mainWindow, {
    openSettings: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('smyth:open-preferences');
      }
    },
    restartServers: async () => {
      await stopAll();
      const r = await startAll();
      serverStatus = { smyth: r.smyth, omniroute: r.omniroute };
      broadcastStatus();
    },
    openLogs: () => {
      const paths = getPaths();
      fs.mkdirSync(paths.logs, { recursive: true });
      shell.openPath(paths.logs);
    },
    showAbout: () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: `About ${APP_NAME}`,
        message: `${APP_NAME} v${APP_VERSION}`,
        detail: 'AI Super Agent for macOS\nGreene Solutions LLC',
      });
    },
  });

  // Menu
  createMenu({
    openPreferences: () => {
      if (mainWindow) {
        mainWindow.webContents.send('smyth:open-preferences');
      }
    },
    newWindow: () => {
      createMainWindow();
    },
  });

  // Broadcast initial status once window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    broadcastStatus();
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (!IS_MAC) {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createMainWindow();
  }
});

app.on('before-quit', async () => {
  destroyTray();
  await stopAll();
});

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { APP_NAME, IS_MAC, getPaths } = require('./constants');

let tray = null;

function createTray(mainWindow, callbacks = {}) {
  const iconPath = path.join(getPaths().public, 'tray-icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (IS_MAC) {
      icon = icon.resize({ width: 16, height: 16 });
    }
  } catch {
    // fallback: empty 16x16 image
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Smyth',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Advanced',
      submenu: [
        {
          label: 'Open Settings',
          click: () => {
            if (callbacks.openSettings) callbacks.openSettings();
          },
        },
        {
          label: 'Restart Servers',
          click: () => {
            if (callbacks.restartServers) callbacks.restartServers();
          },
        },
        {
          label: 'View Logs',
          click: () => {
            if (callbacks.openLogs) callbacks.openLogs();
          },
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'About',
      click: () => {
        if (callbacks.showAbout) callbacks.showAbout();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray };

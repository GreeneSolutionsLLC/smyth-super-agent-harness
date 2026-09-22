const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smythRuntime', {
  // IPC contract channels
  getServerStatus: () => ipcRenderer.invoke('smyth:server-status'),
  getEnv: () => ipcRenderer.invoke('smyth:get-env'),
  restartServer: () => ipcRenderer.invoke('smyth:restart-server'),
  openExternal: (url) => ipcRenderer.invoke('smyth:open-external', url),

  // Extended channels from PLAN.md
  getServers: () => ipcRenderer.invoke('smyth:get-servers'),
  restartServers: () => ipcRenderer.invoke('smyth:restart-servers'),
  openLog: () => ipcRenderer.invoke('smyth:open-log'),
  showOmniRoute: () => ipcRenderer.invoke('smyth:show-omniroute'),
  requestPermission: (type) => ipcRenderer.invoke('smyth:request-permission', type),
  getChromiumPath: () => ipcRenderer.invoke('smyth:get-chromium-path'),
  checkChromiumBundle: () => ipcRenderer.invoke('smyth:check-chromium-bundle'),
  selectFolder: (title) => ipcRenderer.invoke('smyth:select-folder', title),
  openLegal: (file) => ipcRenderer.invoke('smyth:open-legal', file),
  openSystemSettings: (pane) => ipcRenderer.invoke('smyth:open-system-settings', pane),
  getUserDataPath: () => ipcRenderer.invoke('smyth:get-user-data-path'),
  openUserData: () => ipcRenderer.invoke('smyth:open-user-data'),
  setEnv: (key, value) => ipcRenderer.invoke('smyth:set-env', key, value),

  // Event listener
  onServerStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('smyth:server-status', handler);
    return () => ipcRenderer.removeListener('smyth:server-status', handler);
  },

  onOpenPreferences: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('smyth:open-preferences', handler);
    return () => ipcRenderer.removeListener('smyth:open-preferences', handler);
  },
});

const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig:   () => ipcRenderer.invoke('load-config'),
  saveConfig:   (cfg) => ipcRenderer.invoke('save-config', cfg),
  pickFiles:    () => ipcRenderer.invoke('pick-files'),
  downloadUrl:  ({ url, categoryName, fileName }) =>
    ipcRenderer.invoke('download-url', { url, categoryName, fileName }),
  getSoundsDir: () => ipcRenderer.invoke('get-sounds-dir'),
  pickVoicemeeterPath: () => ipcRenderer.invoke('pick-voicemeeter-path'),
  launchVoicemeeter: (path) => ipcRenderer.invoke('launch-voicemeeter', path),
  vmConnect: () => ipcRenderer.invoke('vm-connect'),
  vmSetStripDevice: ({ stripIndex, deviceName }) =>
    ipcRenderer.invoke('vm-set-strip-device', { stripIndex, deviceName }),
  vmGetStatus: () => ipcRenderer.invoke('vm-get-status'),
  onVmStatus: (cb) => ipcRenderer.on('vm-status', (_, status) => cb(status)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  fetchUrlTitle: (url) => ipcRenderer.invoke('fetch-url-title', url),
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath),
  winMinimize:  () => ipcRenderer.send('win-minimize'),
  winMaximize:  () => ipcRenderer.send('win-maximize'),
  winClose:     () => ipcRenderer.send('win-close'),

  // Global hotkey events from uiohook (works even when app is in background)
  onGlobalKeydown:       (cb) => ipcRenderer.on('global-keydown', (_, combo) => cb(combo)),
  onGlobalMousedown:     (cb) => ipcRenderer.on('global-mousedown', (_, combo) => cb(combo)),
  onGlobalComboUpdate:   (cb) => ipcRenderer.on('global-combo-update', (_, combo) => cb(combo)),
  onGlobalModifierChange:(cb) => ipcRenderer.on('global-modifier-change', (_, combo) => cb(combo)),
  onGlobalModifierRelease:(cb) => ipcRenderer.on('global-modifier-release', (_, combo) => cb(combo)),
});

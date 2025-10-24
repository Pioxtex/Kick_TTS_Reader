const { contextBridge, ipcRenderer } = require('electron');

// API do głównego okna (renderer.html)
contextBridge.exposeInMainWorld('kicktts', {
  start: (channel, options) => ipcRenderer.invoke('bot:start', { channel, options }),
  stop:  () => ipcRenderer.invoke('bot:stop'),
  toggleMute: () => ipcRenderer.invoke('bot:toggleMute'),
  skip: () => ipcRenderer.invoke('bot:skip'),

  onLog:   (cb) => ipcRenderer.on('ui:log',   (_e, msg) => cb?.(msg)),
  onState: (cb) => ipcRenderer.on('ui:state', (_e, s)   => cb?.(s)),
  onMuted: (cb) => ipcRenderer.on('ui:muted', (_e, m)   => cb?.(m)),
});

// API do panelu (panel.html / panel.js)
contextBridge.exposeInMainWorld('api', {
  // eventy panelowe (opcjonalne, żeby pokazywać te same logi co main)
  onLog:   (cb) => ipcRenderer.on('bot:log',   (_e, msg) => cb?.(msg)),
  onState: (cb) => ipcRenderer.on('bot:state', (_e, s)   => cb?.(s)),
  onMuted: (cb) => ipcRenderer.on('bot:muted', (_e, m)   => cb?.(m)),

  // sterowanie botem
  startBot:   (channel, options) => ipcRenderer.invoke('bot:start', { channel, options }),
  stopBot:    () => ipcRenderer.invoke('bot:stop'),
  muteToggle: () => ipcRenderer.invoke('bot:toggleMute'),
  skip:       () => ipcRenderer.invoke('bot:skip'),

  // ustawienia i głosy
  getOptions: () => ipcRenderer.invoke('bot:getOptions'),
  setOption:  (key, value) => ipcRenderer.invoke('bot:setOption', { key, value }),
  setVoice:   (name) => ipcRenderer.invoke('bot:setVoice', name),
  listVoices: () => ipcRenderer.invoke('bot:listVoices'),

  // panel
  openPanel: () => ipcRenderer.invoke('panel:open'),
});

console.log('[preload.cjs] loaded');

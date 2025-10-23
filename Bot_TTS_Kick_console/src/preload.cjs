// CommonJS preload
const { contextBridge, ipcRenderer } = require('electron');
try { console.log('[preload.cjs] loaded'); } catch {}
contextBridge.exposeInMainWorld('kicktts', {
  start: (channel, options) => ipcRenderer.invoke('bot:start', { channel, options }),
  stop: () => ipcRenderer.invoke('bot:stop'),
  toggleMute: () => ipcRenderer.invoke('bot:toggleMute'),
  skip: () => ipcRenderer.invoke('bot:skip'),
  onLog: (cb) => ipcRenderer.on('ui:log', (_e, msg) => cb(msg)),
  onState: (cb) => ipcRenderer.on('ui:state', (_e, state) => cb(state)),
  onMuted: (cb) => ipcRenderer.on('ui:muted', (_e, muted) => cb(muted))
});

// Minimal preload for the boot splash window. Exposes a single read-only channel so
// the splash can render live boot progress pushed from the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashAPI', {
  onProgress: (cb) => ipcRenderer.on('splash:progress', (_e, data) => cb(data))
});

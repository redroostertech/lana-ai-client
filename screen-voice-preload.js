'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('screenVoice', {
  getState: () => ipcRenderer.invoke('screen-voice:get-state'),
  activate: (mode) => ipcRenderer.invoke('screen-voice:activate', { mode }),
  audioComplete: (payload) => ipcRenderer.invoke('screen-voice:audio-complete', payload),
  captureError: (code) => ipcRenderer.invoke('screen-voice:capture-error', { code }),
  cancel: () => ipcRenderer.invoke('screen-voice:cancel'),
  confirm: (sessionId) => ipcRenderer.invoke('screen-voice:confirm', { sessionId }),
  copy: (text) => ipcRenderer.invoke('screen-voice:copy', { text }),
  undo: () => ipcRenderer.invoke('screen-voice:undo'),
  requestPermission: (type) => ipcRenderer.invoke('screen-voice:permission', { type }),
  saveSettings: (settings) => ipcRenderer.invoke('screen-voice:save-settings', settings),
  openSettings: () => ipcRenderer.invoke('screen-voice:open-settings'),
  closeSettings: () => ipcRenderer.invoke('screen-voice:close-settings'),
  dismiss: () => ipcRenderer.invoke('screen-voice:dismiss'),
  onState: (callback) => on('screen-voice:state', callback),
  onStartCapture: (callback) => on('screen-voice:start-capture', callback),
  onStopCapture: (callback) => on('screen-voice:stop-capture', callback),
  onPermissions: (callback) => on('screen-voice:permissions', callback),
  onUndone: (callback) => on('screen-voice:undone', callback),
  onPlayAudio: (callback) => on('screen-voice:play-audio', callback)
});

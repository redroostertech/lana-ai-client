'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('screenVoice', {
  getState: () => ipcRenderer.invoke('screen-voice:get-state'),
  getPermissions: () => ipcRenderer.invoke('screen-voice:get-permissions'),
  activate: (mode) => ipcRenderer.invoke('screen-voice:activate', { mode }),
  captureStart: () => ipcRenderer.invoke('screen-voice:capture-start'),
  captureRelease: () => ipcRenderer.invoke('screen-voice:capture-release'),
  audioComplete: (payload) => ipcRenderer.invoke('screen-voice:audio-complete', payload),
  realtimeEvent: (payload) => ipcRenderer.invoke('screen-voice:realtime-event', payload),
  realtimeDisconnected: (code, reason) => ipcRenderer.invoke('screen-voice:realtime-disconnected', { code, reason }),
  realtimeContext: () => ipcRenderer.invoke('screen-voice:realtime-context'),
  realtimeReconnect: () => ipcRenderer.invoke('screen-voice:realtime-reconnect'),
  captureError: (code) => ipcRenderer.invoke('screen-voice:capture-error', { code }),
  captureStatus: (status, metadata = {}) => ipcRenderer.invoke('screen-voice:capture-status', { status, metadata }),
  cancel: () => ipcRenderer.invoke('screen-voice:cancel'),
  confirm: (sessionId) => ipcRenderer.invoke('screen-voice:confirm', { sessionId }),
  copy: (text) => ipcRenderer.invoke('screen-voice:copy', { text }),
  undo: () => ipcRenderer.invoke('screen-voice:undo'),
  openSettings: () => ipcRenderer.invoke('screen-voice:open-settings'),
  openDetails: () => ipcRenderer.invoke('screen-voice:open-details'),
  closeDetails: () => ipcRenderer.invoke('screen-voice:close-details'),
  setModeMenuOpen: (open) => ipcRenderer.invoke('screen-voice:mode-menu', { open }),
  setOverlayHeight: (height) => ipcRenderer.invoke('screen-voice:resize-overlay', { height }),
  dismiss: () => ipcRenderer.invoke('screen-voice:dismiss'),
  onState: (callback) => on('screen-voice:state', callback),
  onStartCapture: (callback) => on('screen-voice:start-capture', callback),
  onStartRealtime: (callback) => on('screen-voice:start-realtime', callback),
  onStopRealtime: (callback) => on('screen-voice:stop-realtime', callback),
  onRealtimeSend: (callback) => on('screen-voice:realtime-send', callback),
  onStopCapture: (callback) => on('screen-voice:stop-capture', callback),
  onPermissions: (callback) => on('screen-voice:permissions', callback),
  onShowDetails: (callback) => on('screen-voice:show-details', callback),
  onUndone: (callback) => on('screen-voice:undone', callback),
  onPlayAudio: (callback) => on('screen-voice:play-audio', callback)
});

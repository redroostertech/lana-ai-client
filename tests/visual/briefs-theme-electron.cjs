// Isolated renderer check: no application main process, preload, login or database.
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.BRIEFS_VISUAL_PROFILE);
let window;
app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1440, height: 1000, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false } });
  window.loadURL('about:blank');
});

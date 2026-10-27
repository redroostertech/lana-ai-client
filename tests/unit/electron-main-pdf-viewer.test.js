'use strict';

// The file viewer falls back to an <iframe> PDF (opened at #page=N from a chat
// source) when the editor service is down. Chromium's built-in PDF viewer is a
// plugin, off by default in Electron, so that iframe rendered blank. Both
// BrowserWindows that end up showing the app enable it: createWindow, and
// createLoginWindow, whose login page navigates the same window to
// dashboard.html and from there to file-viewer.html.

const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.resolve(__dirname, '../../electron-main.js'), 'utf8');

function webPreferencesOf(functionName) {
  const start = main.indexOf(`function ${functionName}(`);
  expect(start).toBeGreaterThan(-1);
  const ctor = main.indexOf('new BrowserWindow({', start);
  const prefs = main.indexOf('webPreferences: {', ctor);
  const end = main.indexOf('}', prefs);
  expect(ctor).toBeGreaterThan(start);
  return main.slice(prefs, end);
}

test.each(['createWindow', 'createLoginWindow'])('%s enables the built-in PDF viewer without loosening isolation', (name) => {
  const prefs = webPreferencesOf(name);
  expect(prefs).toMatch(/plugins:\s*true/);
  expect(prefs).toMatch(/nodeIntegration:\s*false/);
  expect(prefs).toMatch(/contextIsolation:\s*true/);
  expect(prefs).toMatch(/sandbox:\s*false/);
});

test('the login page navigates its own window into the app (so it renders file-viewer.html)', () => {
  const login = fs.readFileSync(path.resolve(__dirname, '../../src/login.html'), 'utf8');
  expect(login).toContain("window.location.replace('dashboard.html')");
});

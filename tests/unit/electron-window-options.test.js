'use strict';

// Every window keeps web security on and is sandboxed (docs/plans/harden-web.md,
// docs/plans/harden-ipc.md). electron-preload.js requires local modules, so its
// windows load it as one bundled file (electron-preload-path.js clientPreloadPath),
// which a sandboxed preload can run.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The webPreferences object literal of the first `new BrowserWindow({` after `marker`. */
function webPreferencesAfter(source, marker) {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const ctor = source.indexOf('new BrowserWindow({', start);
  const open = source.indexOf('webPreferences: {', ctor);
  let depth = 0;
  for (let i = open + 'webPreferences: '.length; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(open, i + 1); }
  }
  throw new Error('unbalanced webPreferences');
}

const WINDOWS = [
  { name: 'main window', file: 'electron-main.js', marker: 'function createWindow(', preload: 'CLIENT_PRELOAD()', sandbox: true },
  { name: 'login window', file: 'electron-main.js', marker: 'function createLoginWindow(', preload: 'CLIENT_PRELOAD()', sandbox: true },
  { name: 'Briefs capture window', file: 'electron-main.js', marker: 'createCaptureWindow: () => {', preload: 'CLIENT_PRELOAD()', sandbox: true },
  { name: 'update dialog', file: 'electron-updater-custom.js', marker: 'function showUpdateDialog(', preload: 'clientPreloadPath(', sandbox: true },
  { name: 'screen voice overlay', file: 'src/screen-voice/electron-screen-voice.js', marker: 'createOverlay() {', preload: 'screen-voice-preload.js', sandbox: true }
];

describe.each(WINDOWS)('$name', ({ file, marker, preload, sandbox }) => {
  const prefs = webPreferencesAfter(read(file), marker);

  test('web security on, isolation on, no Node in the page', () => {
    expect(prefs).not.toMatch(/webSecurity:\s*false/);
    expect(prefs).toMatch(/contextIsolation:\s*true/);
    expect(prefs).toMatch(/nodeIntegration:\s*false/);
    if (file !== 'src/screen-voice/electron-screen-voice.js') expect(prefs).toMatch(/webSecurity:\s*true/);
  });

  test(`sandbox: ${sandbox}`, () => {
    expect(prefs).toMatch(new RegExp(`sandbox:\\s*${sandbox}`));
    if (preload) expect(prefs).toContain(preload);
    else expect(prefs).not.toMatch(/preload:/);
  });
});

test('the storage migration page is a sandboxed WebContentsView (closing it never quits the app)', () => {
  const main = read('electron-main.js');
  const block = main.slice(main.indexOf('await migrateFileOriginStorage({'), main.indexOf('appOriginUrl:', main.indexOf('await migrateFileOriginStorage({')));
  expect(block).toMatch(/new WebContentsView\(\{\s*webPreferences: \{ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true \}/);
  expect(block).not.toMatch(/new BrowserWindow|preload/);
});

test('no window anywhere turns web security off', () => {
  const files = fs.readdirSync(ROOT).filter((name) => /^electron-.*\.js$/.test(name)).concat(['src/screen-voice/electron-screen-voice.js']);
  for (const name of files) expect({ name, off: /webSecurity:\s*false/.test(read(name)) }).toEqual({ name, off: false });
});

test('the client windows load electron-preload.js bundled, never the source file', () => {
  // The source requires local modules, which a sandboxed preload cannot
  // (tests/unit/electron-preload-sandbox.test.js runs the bundle sandboxed).
  const main = read('electron-main.js');
  expect(main).toMatch(/const CLIENT_PRELOAD = \(\) => clientPreloadPath\(\{ isPackaged: app\.isPackaged, rootDir: __dirname \}\);/);
  for (const name of ['electron-main.js', 'electron-updater-custom.js']) {
    expect({ name, source: /preload:\s*path\.join\(__dirname, 'electron-preload\.js'\)/.test(read(name)) }).toEqual({ name, source: false });
  }
});

test('every app window loads its page from the app protocol, not file://', () => {
  const main = read('electron-main.js');
  expect(main).not.toMatch(/createFileUrl|loadFile\(/);
  expect(main).toMatch(/capture\.loadURL\(appPageUrl\('briefs\/capture\.html'\)\)/);
  expect(read('electron-updater-custom.js')).toMatch(/return appPageUrl\('update-dialog\.html'\)/);
  expect(read('src/screen-voice/electron-screen-voice.js')).toMatch(/this\.overlay\.loadURL\(appPageUrl\(/);
});

test('the app scheme is registered privileged together with the Briefs audio scheme, in one call', () => {
  const main = read('electron-main.js');
  expect(main).toMatch(/registerBriefsSchemes\(protocol, \[\{ scheme: APP_SCHEME, privileges: SCHEME_PRIVILEGES \}\]\);/);
  expect((main.match(/registerSchemesAsPrivileged/g) || []).length).toBe(0);
  expect(main).toMatch(/protocol\.handle\(APP_SCHEME, createAppProtocolHandler\(/);
});

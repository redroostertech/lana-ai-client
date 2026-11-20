/**
 * A dev run (npm run electron:dev / electron:dev:watch) starts Electron from a copy of the stock
 * Electron.app renamed to the product name, so the macOS dock says "LANA AI", not "Electron".
 * Other platforms run the stock binary.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { devElectronPath } = require('../../scripts/dev-electron-bundle');

function fakeElectron(root) {
  const app = path.join(root, 'dist', 'Electron.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Electron'), 'bin');
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'electron.icns'), 'stock-icon');
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), 'plist');
  return path.join(app, 'Contents', 'MacOS', 'Electron');
}

describe('devElectronPath', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bundle-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function setup() {
    const electronPath = fakeElectron(root);
    const iconFile = path.join(root, 'icon.icns');
    fs.writeFileSync(iconFile, 'lana-icon');
    const calls = [];
    // ditto copies the bundle; plutil edits Info.plist. Recorded, and ditto really copies.
    const execFileSync = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'ditto') fs.cpSync(args[0], args[1], { recursive: true });
    };
    return { electronPath, iconFile, calls, execFileSync, cacheDir: path.join(root, 'cache') };
  }

  test('on macOS runs a copy named for the product, with the product name and icon', () => {
    const s = setup();
    const result = devElectronPath({ platform: 'darwin', electronPath: s.electronPath, cacheDir: s.cacheDir,
      appName: 'LANA AI', iconFile: s.iconFile, version: '44.9.1', execFileSync: s.execFileSync });

    const bundle = path.join(s.cacheDir, 'LANA AI.app');
    expect(result).toBe(path.join(bundle, 'Contents', 'MacOS', 'Electron'));
    expect(fs.existsSync(result)).toBe(true);
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    expect(s.calls).toContainEqual(['plutil', '-replace', 'CFBundleName', '-string', 'LANA AI', plist]);
    expect(s.calls).toContainEqual(['plutil', '-replace', 'CFBundleDisplayName', '-string', 'LANA AI', plist]);
    expect(fs.readFileSync(path.join(bundle, 'Contents', 'Resources', 'electron.icns'), 'utf8')).toBe('lana-icon');
  });

  test('reuses the copy while the Electron version and name are unchanged, rebuilds when either changes', () => {
    const s = setup();
    const opts = { platform: 'darwin', electronPath: s.electronPath, cacheDir: s.cacheDir,
      appName: 'LANA AI', iconFile: s.iconFile, version: '44.9.1', execFileSync: s.execFileSync };
    devElectronPath(opts);
    const first = s.calls.length;
    devElectronPath(opts);
    expect(s.calls.length).toBe(first);
    devElectronPath({ ...opts, version: '45.0.0' });
    expect(s.calls.length).toBeGreaterThan(first);
  });

  test('other platforms run the stock Electron binary untouched', () => {
    const s = setup();
    expect(devElectronPath({ platform: 'win32', electronPath: 'C:\\electron.exe', cacheDir: s.cacheDir,
      appName: 'LANA AI', iconFile: s.iconFile, version: '44.9.1', execFileSync: s.execFileSync })).toBe('C:\\electron.exe');
    expect(s.calls).toEqual([]);
  });

  test('if the copy cannot be made, the dev run still starts on the stock binary', () => {
    const s = setup();
    const result = devElectronPath({ platform: 'darwin', electronPath: s.electronPath, cacheDir: s.cacheDir,
      appName: 'LANA AI', iconFile: s.iconFile, version: '44.9.1', execFileSync: () => { throw new Error('no ditto'); },
      log: () => {} });
    expect(result).toBe(s.electronPath);
  });
});

describe('dev launch scripts use the renamed bundle', () => {
  const ROOT = path.join(__dirname, '../..');
  test('electron:dev starts through scripts/electron-dev.js, not npx electron', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['electron:dev']).toMatch(/node scripts\/electron-dev\.js electron-main\.js/);
    expect(pkg.scripts['electron:dev']).not.toMatch(/npx electron/);
  });
  test('electron:dev:watch resolves its binary through devElectronPath', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/electron-dev-watch.js'), 'utf8');
    expect(src).toMatch(/dev-electron-bundle/);
    expect(src).not.toMatch(/const electronPath = require\('electron'\)/);
  });
});

describe('devElectronPath with a folder ending in .app above node_modules', () => {
  test('copies the Electron.app bundle itself, not the outer folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bundle-'));
    try {
      const outer = path.join(root, 'work.app', 'node_modules', 'electron');
      const app = path.join(outer, 'dist', 'Electron.app');
      fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
      fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
      fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Electron'), 'bin');
      const copied = [];
      const result = devElectronPath({ platform: 'darwin', electronPath: path.join(app, 'Contents', 'MacOS', 'Electron'),
        cacheDir: path.join(root, 'cache'), appName: 'LANA AI', version: '1', log: () => {},
        execFileSync: (cmd, args) => { if (cmd === 'ditto') { copied.push(args[0]); fs.cpSync(args[0], args[1], { recursive: true }); } } });
      expect(copied).toEqual([app]);
      expect(result).toBe(path.join(root, 'cache', 'LANA AI.app', 'Contents', 'MacOS', 'Electron'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

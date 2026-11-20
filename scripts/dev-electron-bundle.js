'use strict';

/**
 * The Electron binary a dev run starts. On macOS the dock names an app from its bundle's
 * Info.plist, so the stock node_modules Electron.app shows "Electron" and app.setName cannot
 * change that at run time. A dev run therefore starts from a copy of Electron.app named for the
 * product ("LANA AI.app", CFBundleName/CFBundleDisplayName set, LANA icon), kept in
 * node_modules/.lana-dev and rebuilt when the Electron version or the name changes. Packaged
 * builds are named by electron-builder and never use this. Other platforms run the stock binary.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync: realExecFileSync } = require('child_process');

const MARKER = '.lana-dev-bundle.json';

function devElectronPath({ platform = process.platform, electronPath, cacheDir, appName, iconFile, version,
  execFileSync = realExecFileSync, log = console.warn } = {}) {
  if (platform !== 'darwin') return electronPath;
  const appIndex = electronPath.lastIndexOf('.app' + path.sep);
  if (appIndex < 0) return electronPath;
  const source = electronPath.slice(0, appIndex + 4);
  const bundle = path.join(cacheDir, `${appName}.app`);
  const binary = path.join(bundle, path.relative(source, electronPath));
  const stamp = JSON.stringify({ version, appName });

  try {
    if (fs.existsSync(binary) && readMarker(bundle) === stamp) return binary;
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    execFileSync('ditto', [source, bundle]);
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    execFileSync('plutil', ['-replace', 'CFBundleName', '-string', appName, plist]);
    execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', appName, plist]);
    if (iconFile && fs.existsSync(iconFile)) {
      fs.copyFileSync(iconFile, path.join(bundle, 'Contents', 'Resources', 'electron.icns'));
    }
    fs.writeFileSync(path.join(bundle, MARKER), stamp);
    return binary;
  } catch (error) {
    log(`[dev] could not make the ${appName} dev app, starting stock Electron: ${error.message || error}`);
    return electronPath;
  }
}

function readMarker(bundle) {
  try { return fs.readFileSync(path.join(bundle, MARKER), 'utf8'); } catch (_error) { return null; }
}

/** The binary for this checkout: name from the brand flavor, icon from build/. */
function devElectronPathForRoot(root) {
  const { resolveFlavor, brandFor } = require(path.join(root, 'src/js/brand/lana-brand.js'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const flavor = resolveFlavor({ env: process.env, packageJson, isPackaged: false });
  const electronDir = path.dirname(require.resolve('electron/package.json', { paths: [root] }));
  return devElectronPath({
    electronPath: require(electronDir),
    cacheDir: path.join(root, 'node_modules', '.lana-dev'),
    appName: brandFor(flavor).name,
    iconFile: path.join(root, 'build', flavor === 'lana-one' ? 'icons-lana-one' : 'icons', 'icon.icns'),
    version: require(path.join(electronDir, 'package.json')).version,
  });
}

module.exports = { devElectronPath, devElectronPathForRoot };

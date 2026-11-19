'use strict';

/**
 * Which file the client's windows load as their preload (docs/plans/harden-ipc.md).
 *
 * Those windows are sandboxed, and a sandboxed preload can require only
 * 'electron' and a few built-ins. electron-preload.js requires local modules
 * (src/js/brand/lana-brand.js, src/js/location-permission.model.js and the
 * Briefs bridge in briefs/dist), so it always runs as one bundled file:
 *
 *  - packaged: electron-preload.js at the app root is already the esbuild
 *    bundle (scripts/bundle-electron.js);
 *  - unpackaged: bundled here once per launch into electron-dist/dev-preload/,
 *    with the same options, so a restart picks up edits.
 */

const path = require('path');

const EXTERNAL = ['electron'];

// A computed name keeps the app's own bundler from inlining esbuild into a packaged build,
// where this path is never taken.
const loadDevDependency = (name) => require(name);

function bundleDevPreload(rootDir, outfile) {
  loadDevDependency('esbuild').buildSync({
    entryPoints: [path.join(rootDir, 'electron-preload.js')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: EXTERNAL,
    logLevel: 'error'
  });
}

const built = new Map();

/**
 * @param {{ isPackaged: boolean, rootDir: string, bundle?: Function }} options
 * @returns {string} the preload file for webPreferences.preload
 */
function clientPreloadPath({ isPackaged, rootDir, bundle = bundleDevPreload }) {
  if (isPackaged) return path.join(rootDir, 'electron-preload.js');
  const outfile = path.join(rootDir, 'electron-dist', 'dev-preload', 'electron-preload.js');
  if (!built.has(outfile)) {
    bundle(rootDir, outfile);
    built.set(outfile, true);
  }
  return outfile;
}

module.exports = { clientPreloadPath, bundleDevPreload };

#!/usr/bin/env node
/**
 * Root postinstall: fetch the pinned Electron binary into node_modules/electron/dist.
 *
 * Electron 44 ships no install script of its own, so this runs its bundled
 * install.js (the `install-electron` bin). That script ignores
 * ELECTRON_SKIP_BINARY_DOWNLOAD, so the skip is honored here instead, which
 * lets test-only CI jobs avoid the ~100 MB download. Electron is a
 * devDependency, so `npm install --omit=dev` has no installer to run; that
 * case is a no-op too.
 */

'use strict';

const { spawnSync } = require('child_process');

function skipRequested(value) {
  return Boolean(value) && !['0', 'false', ''].includes(String(value).trim().toLowerCase());
}

if (skipRequested(process.env.ELECTRON_SKIP_BINARY_DOWNLOAD)) {
  console.log('postinstall: ELECTRON_SKIP_BINARY_DOWNLOAD is set, skipping the Electron binary download.');
  process.exit(0);
}

let installer;
try {
  installer = require.resolve('electron/install.js');
} catch {
  console.log('postinstall: electron is not installed (dev dependencies omitted), skipping the Electron binary download.');
  process.exit(0);
}

const result = spawnSync(process.execPath, [installer], { stdio: 'inherit' });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);

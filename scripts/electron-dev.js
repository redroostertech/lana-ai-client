#!/usr/bin/env node
/**
 * `npm run electron:dev`: start Electron in development mode from the product-named dev app
 * (scripts/dev-electron-bundle.js), passing every argument through. Stopping this process stops
 * the app; the app's exit code is this script's.
 */

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { devElectronPathForRoot } = require('./dev-electron-bundle');

const ROOT = path.join(__dirname, '..');
const child = spawn(devElectronPathForRoot(ROOT), process.argv.slice(2), {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' },
});
child.on('error', (error) => {
  console.error(`[dev] could not start Electron: ${error.message || error}`);
  process.exit(1);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code == null ? (signal ? 1 : 0) : code));

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (_) {
    return null;
  }
}

/**
 * Decide whether `npm install` should run in repoRoot.
 *
 * Strategy: compare package.json / package-lock.json mtimes against
 * node_modules/.package-lock.json — npm rewrites that file after every
 * install, so it's a reliable "last install" stamp.
 *
 * Returns { needs: boolean, reason?: string }.
 */
function needsInstall(repoRoot) {
  const nm = path.join(repoRoot, 'node_modules');
  if (!fs.existsSync(nm)) {
    return { needs: true, reason: 'node_modules missing' };
  }

  const stamp = path.join(nm, '.package-lock.json');
  const stampMtime = mtime(stamp);
  if (stampMtime === null) {
    return { needs: true, reason: 'no install stamp (node_modules looks incomplete)' };
  }

  const pkgMtime = mtime(path.join(repoRoot, 'package.json'));
  if (pkgMtime !== null && pkgMtime > stampMtime) {
    return { needs: true, reason: 'package.json newer than last install' };
  }

  const lockMtime = mtime(path.join(repoRoot, 'package-lock.json'));
  if (lockMtime !== null && lockMtime > stampMtime) {
    return { needs: true, reason: 'package-lock.json newer than last install' };
  }

  return { needs: false };
}

function ensureDeps(repoRoot) {
  const { needs, reason } = needsInstall(repoRoot);
  if (!needs) return false;

  console.log(`Dependencies appear out of date (${reason}). Running npm install…`);
  const result = spawnSync('npm', ['install'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`npm install exited with code ${result.status}`);
  }
  return true;
}

module.exports = { needsInstall, ensureDeps };

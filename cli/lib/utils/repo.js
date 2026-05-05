'use strict';

const fs = require('fs');
const path = require('path');

function findRepoRoot(startDir) {
  let dir = startDir || process.cwd();
  while (dir !== path.parse(dir).root) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'lana-ai') return dir;
      } catch (_) {
        // unreadable package.json — keep walking
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

function getRepoRoot() {
  if (process.env.LANA_CLIENT_REPO) return process.env.LANA_CLIENT_REPO;
  const root = findRepoRoot();
  if (!root) {
    throw new Error(
      'Could not locate the lana-ai-client repo. Run lana-client from inside the repo, ' +
        'or set LANA_CLIENT_REPO to the absolute repo path.'
    );
  }
  return root;
}

function loadPackageJson(repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
}

module.exports = { getRepoRoot, loadPackageJson };

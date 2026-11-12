'use strict';

// build-client.sh cleaned on EVERY run (CLEAN=true by default, no way off):
// it deleted dist/, so building one target wiped the installers built just
// before it, and it deleted ~/Library/Application Support/LanaAI,
// ~/Library/Caches/LanaAI and ~/Library/Application Support/Electron on the
// build machine (2026-11-11). A build script must never delete a person's
// app data, and must only clean when asked.

const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '../../scripts/build-client.sh'), 'utf8');

test('cleaning is off unless --clean is given', () => {
  expect(script).toMatch(/^CLEAN=false\b/m);
  expect(script).not.toMatch(/^CLEAN=true\b/m);
});

test('no step deletes anything under ~/Library or $HOME/Library', () => {
  const deletes = script.split('\n').filter((l) => /\brm\s+-[a-z]*r/.test(l) && !l.trim().startsWith('#'));
  for (const line of deletes) {
    expect(line).not.toMatch(/~\/Library|\$HOME\/Library|\$\{HOME\}\/Library/);
  }
});

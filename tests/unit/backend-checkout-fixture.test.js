'use strict';

// The backend contract fixture: with no backend checkout it skips locally
// but fails loudly in CI, so a missing backend never passes as green.

const path = require('path');

function load(env) {
  const saved = { LANA_BACKEND_DIR: process.env.LANA_BACKEND_DIR, CI: process.env.CI };
  process.env.LANA_BACKEND_DIR = path.join(__dirname, 'no-such-backend');
  if (env.CI) { process.env.CI = env.CI; } else { delete process.env.CI; }
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    let found;
    jest.isolateModules(() => { found = require('../fixtures/backend-checkout.js').findBackend(['src/index.js']); });
    return found;
  } finally {
    warn.mockRestore();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; } }
  }
}

test('locally a missing backend skips the suite', () => {
  expect(load({}).describe).toBe(describe.skip);
});

test('in CI a missing backend is a failing suite, not a skip (control: locally it skips)', () => {
  const found = load({ CI: 'true' });
  expect(found.dir).toBeNull();
  expect(found.describe).not.toBe(describe.skip);
  expect(found.describe).not.toBe(describe);
});

test('CI=false and CI=0 count as unset (control: CI=1 counts as set)', () => {
  expect(load({ CI: 'false' }).describe).toBe(describe.skip);
  expect(load({ CI: '0' }).describe).toBe(describe.skip);
  expect(load({ CI: '1' }).describe).not.toBe(describe.skip);
});

test('npm run test:ci sets CI explicitly, on every platform', () => {
  const pkg = require('../../package.json');
  const fs = require('fs');
  expect(pkg.scripts['test:ci']).toBe('node scripts/test-ci.js');
  const runner = fs.readFileSync(path.join(__dirname, '../../scripts/test-ci.js'), 'utf8');
  expect(runner).toMatch(/process\.env\.CI = 'true'/);
});

'use strict';

/**
 * npm run test:ci: jest in CI mode with CI set explicitly, on every platform
 * (no shell env syntax), so suites that must not skip in CI (the backend
 * contract fixture, tests/fixtures/backend-checkout.js) fail loudly instead.
 * Extra arguments pass through to jest.
 */

process.env.CI = 'true';
require('jest').run(['--ci', '--coverage', '--maxWorkers=2', ...process.argv.slice(2)]);

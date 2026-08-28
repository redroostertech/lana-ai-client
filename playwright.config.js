'use strict';

const { defineConfig, devices } = require('@playwright/test');
const { hasAuthConfiguration } = require('./tests/playwright/helpers/agents-harness');

const clientUrl = process.env.LANA_E2E_CLIENT_URL || 'http://127.0.0.1:4177';
const usesLocalClient = !process.env.LANA_E2E_CLIENT_URL;
const hasAuth = hasAuthConfiguration();

module.exports = defineConfig({
  testDir: './tests/playwright',
  timeout: 12 * 60 * 1000,
  expect: { timeout: 15 * 1000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  outputDir: 'test-results/playwright-agents',
  use: {
    baseURL: clientUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
  webServer: usesLocalClient ? {
    command: 'node scripts/serve-agent-studio.js',
    url: clientUrl + '/agents/index.html',
    reuseExistingServer: true,
    timeout: 30 * 1000,
  } : undefined,
});

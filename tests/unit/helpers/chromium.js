/**
 * Chromium for unit tests that need real layout or computed styles (jsdom
 * resolves neither var() nor sizes): Playwright's own browser if installed,
 * else the newest headless shell in Playwright's cache. Throws, never skips.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
      || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches/ms-playwright') : path.join(os.homedir(), '.cache/ms-playwright'));
    const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((name) => /^chromium_headless_shell-\d+$/.test(name)).sort().reverse() : [];
    const candidates = dirs.flatMap((name) => ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']
      .map((build) => path.join(cache, name, build, 'chrome-headless-shell'))).filter((file) => fs.existsSync(file));
    if (!candidates.length) throw new Error('No Chromium for this test: run `npx playwright install chromium`. ' + error.message);
    return chromium.launch({ executablePath: candidates[0] });
  }
}

module.exports = { launchChromium };

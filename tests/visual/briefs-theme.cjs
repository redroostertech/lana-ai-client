// Run: node tests/visual/briefs-theme.cjs
// Loads the real Briefs pages in Electron with network and native services isolated.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const src = path.resolve(__dirname, '../../src');
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'briefs-contrast-'));
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.resolve(src, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(src + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function contrast(page, selector) {
  return page.locator(selector).first().evaluate(el => {
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const lum = color => rgb(color).slice(0, 3).map(v => {
      v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    let background = 'rgb(255, 255, 255)';
    for (let node = el; node; node = node.parentElement) {
      const value = getComputedStyle(node).backgroundColor;
      if (rgb(value)[3] !== 0) { background = value; break; }
    }
    const color = getComputedStyle(el).color;
    const a = lum(color), b = lum(background);
    return { color, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let app;
  const failures = [];
  try {
    app = await _electron.launch({ args: [path.join(__dirname, 'briefs-theme-electron.cjs')],
      env: { ...process.env, BRIEFS_VISUAL_PROFILE: path.join(evidence, 'profile') } });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    // Every other origin is blocked, including any configured real server.
    await page.context().route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(origin + '/')) return route.abort();
      if (url.endsWith('/js/auth-guard.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
      return route.continue();
    });
    await page.addInitScript(() => {
      localStorage.setItem('lana:appearance.theme', 'dark');
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const file of ['index', 'dashboard']) {
      await page.goto(`${origin}/briefs/${file}.html`);
      await page.addStyleTag({ content: '[data-contrast-sample][hidden] { display: none !important; }' });
      await page.locator('#briefs-unavailable .lex-empty__message').waitFor();
      await page.evaluate(() => {
        document.dispatchEvent(new Event('lex-data-loaded'));
        document.querySelector('lex-lana-dock').expand();
        document.querySelector('lex-chat-thread').addMessage('assistant', 'Sarah Reynolds is the key witness. Review the source document for the supporting passage.');
        const sample = document.createElement('span');
        sample.className = 'briefs-tour-card-confirm';
        sample.textContent = 'Confirm';
        sample.dataset.contrastSample = '';
        document.querySelector('#briefs-unavailable').append(sample);
        if (location.pathname.endsWith('dashboard.html')) {
          const count = sample.cloneNode(true);
          count.className = 'briefs-dashboard-count';
          count.textContent = '3';
          sample.after(count);
        }
      });
      for (const theme of ['dark', 'light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
        await page.evaluate(value => window.LexTheme.setPreference(value), theme);
        await page.waitForTimeout(200);
        for (const selector of ['#briefs-unavailable .lex-empty__message', '#briefs-unavailable .lex-empty__description', '.lld-title', '.lex-chat-narrative', '.briefs-tour-card-confirm', ...(file === 'dashboard' ? ['.briefs-dashboard-count'] : [])]) {
          const result = await contrast(page, selector);
          console.log(file, theme, selector, JSON.stringify(result));
          if (result.ratio < 4.5) failures.push(`${file}/${theme} ${selector}: ${result.ratio.toFixed(2)}`);
        }
        if (await page.locator('html').getAttribute('data-lex-theme') !== theme) failures.push(`${file}: root did not follow ${theme}`);
        await page.locator('[data-contrast-sample]').evaluateAll(nodes => nodes.forEach(n => n.hidden = true));
        await page.screenshot({ path: path.join(evidence, `${file}-${theme}.png`) });
        await page.locator('[data-contrast-sample]').evaluateAll(nodes => nodes.forEach(n => n.hidden = false));
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-contrast-sample]').evaluateAll(nodes => nodes.forEach(n => n.hidden = true));
      await page.evaluate(() => { document.querySelector('lex-sidebar').open = false; });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(evidence, `${file}-narrow.png`) });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    assert.deepEqual(failures, [], 'Briefs text must stay readable while switching appearance');
  } finally {
    console.log(`Evidence: ${evidence}`);
    if (app) await app.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

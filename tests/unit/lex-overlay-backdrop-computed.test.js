/**
 * Lex overlay backdrops, as the browser computes them: on a page without
 * lex-tokens.css the drawer and
 * modal backdrops still dim with the light overlay fallback, and with the
 * tokens in dark they use the dark --lex-modal-overlay. jsdom does not resolve
 * var(), so this drives Chromium through the client's Playwright.
 */
const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./helpers/chromium');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const SCRIPTS = ['js/lex/lex.core.js', 'js/lex/components/foundation/lex-modal.js', 'js/lex/components/foundation/lex-drawer.js'].map(read);

let browser;
beforeAll(async () => { browser = await launchChromium(); }, 60000);
afterAll(async () => { if (browser) await browser.close(); });

async function backdrops({ tokens, theme }) {
  const page = await browser.newPage();
  const css = tokens ? `<style>${read('css/lex-tokens.css')}</style>` : '';
  await page.setContent(`<!doctype html><html data-lex-theme="${theme}"><head>${css}</head><body>
    <lex-modal id="m" heading="Dialog"></lex-modal><lex-drawer id="d" heading="Drawer"></lex-drawer></body></html>`);
  for (const code of SCRIPTS) await page.addScriptTag({ content: code });
  await page.evaluate(() => { document.getElementById('m').open = true; document.getElementById('d').open = true; });
  await page.waitForSelector('.lex-modal-backdrop');
  await page.waitForSelector('.lex-drawer-backdrop');
  const result = await page.evaluate(() => ({
    modal: getComputedStyle(document.querySelector('.lex-modal-backdrop')).backgroundColor,
    drawer: getComputedStyle(document.querySelector('.lex-drawer-backdrop')).backgroundColor
  }));
  await page.close();
  return result;
}

test('without lex-tokens.css both backdrops still dim with the light overlay', async () => {
  expect(await backdrops({ tokens: false, theme: 'light' })).toEqual({ modal: 'rgba(13, 8, 7, 0.5)', drawer: 'rgba(13, 8, 7, 0.5)' });
}, 30000);

test('with the tokens in dark both backdrops use the dark overlay', async () => {
  expect(await backdrops({ tokens: true, theme: 'dark' })).toEqual({ modal: 'rgba(0, 0, 0, 0.72)', drawer: 'rgba(0, 0, 0, 0.72)' });
}, 30000);

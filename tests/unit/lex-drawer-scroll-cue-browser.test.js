/**
 * lex-drawer scroll cue in a real drawer (Chromium: jsdom has no layout):
 * set on open when the body overflows, cleared once scrolled to the end, set
 * again on scrolling back, and updated when content is added after opening.
 */
const fs = require('fs');
const path = require('path');
const { launchChromium } = require('./helpers/chromium');

const SRC = path.join(__dirname, '../../src');
const SCRIPTS = ['js/lex/lex.core.js', 'js/lex/components/foundation/lex-drawer.js']
  .map((rel) => fs.readFileSync(path.join(SRC, rel), 'utf8'));

let browser;
let page;
beforeAll(async () => { browser = await launchChromium(); }, 60000);
afterAll(async () => { if (browser) await browser.close(); });

async function mount(blockHeights) {
  page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const blocks = blockHeights.map((h) => `<div class="block" style="height:${h}px">block</div>`).join('');
  await page.setContent(`<!doctype html><html><body><lex-drawer id="d" heading="Drawer" show-footer>${blocks}</lex-drawer></body></html>`);
  for (const code of SCRIPTS) await page.addScriptTag({ content: code });
  await page.evaluate(() => { document.getElementById('d').open = true; });
  await page.waitForSelector('.lex-drawer-body');
}

const cue = () => page.evaluate(() => document.querySelector('.lex-drawer-panel').classList.contains('lex-drawer-panel--more-below'));
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

afterEach(async () => { if (page) await page.close(); });

test('on open and on scroll', async () => {
  await mount([900]);
  await settle();
  expect(await cue()).toBe(true);
  await page.evaluate(() => { const b = document.querySelector('.lex-drawer-body'); b.scrollTop = b.scrollHeight; });
  await settle();
  expect(await cue()).toBe(false);
  await page.evaluate(() => { document.querySelector('.lex-drawer-body').scrollTop = 0; });
  await settle();
  expect(await cue()).toBe(true);
}, 30000);

test('content that fits shows no cue; content added after opening brings it', async () => {
  await mount([100]);
  await settle();
  expect(await cue()).toBe(false);
  await page.evaluate(() => {
    const more = document.createElement('div');
    more.style.height = '900px';
    document.querySelector('.lex-drawer-body slot-content').appendChild(more);
  });
  await settle();
  expect(await cue()).toBe(true);
}, 30000);

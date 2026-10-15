'use strict';

/**
 * One client, two products. Flavor "lana" (the LANA client) leaves every page
 * as written; flavor "lana-one" (the client inside LANA One) gets the LANA One
 * logos, titles, favicon and legacy loader as the page is parsed. The flavor
 * is stamped at build time (package.json lanaFlavor) and LANA_FLAVOR may
 * override it only in an unpackaged app.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const {
  resolveFlavor, readAppPackageJson, brandFor, lanaOneLogo, applyBrandToDocument, FAVICON_HREF,
} = require('../../../src/js/brand/lana-brand');

const ROOT = path.resolve(__dirname, '..', '..', '..');

describe('resolveFlavor', () => {
  test('the build stamp decides; unknown or missing means the LANA client', () => {
    expect(resolveFlavor({ packageJson: { lanaFlavor: 'lana-one' }, isPackaged: true })).toBe('lana-one');
    expect(resolveFlavor({ packageJson: { lanaFlavor: 'lana' }, isPackaged: true })).toBe('lana');
    expect(resolveFlavor({ packageJson: { lanaFlavor: 'acme' }, isPackaged: true })).toBe('lana');
    expect(resolveFlavor({})).toBe('lana');
  });

  test('LANA_FLAVOR overrides the stamp when running unpackaged', () => {
    expect(resolveFlavor({ env: { LANA_FLAVOR: 'LANA-ONE ' }, packageJson: { lanaFlavor: 'lana' }, isPackaged: false })).toBe('lana-one');
    expect(resolveFlavor({ env: { LANA_FLAVOR: 'lana' }, packageJson: { lanaFlavor: 'lana-one' }, isPackaged: false })).toBe('lana');
    expect(resolveFlavor({ env: { LANA_FLAVOR: 'nope' }, packageJson: { lanaFlavor: 'lana-one' }, isPackaged: false })).toBe('lana-one');
  });

  test('a packaged app ignores LANA_FLAVOR', () => {
    expect(resolveFlavor({ env: { LANA_FLAVOR: 'lana-one' }, packageJson: { lanaFlavor: 'lana' }, isPackaged: true })).toBe('lana');
  });

  test('the client itself is stamped "lana"', () => {
    expect(require(path.join(ROOT, 'package.json')).lanaFlavor).toBe('lana');
    expect(brandFor('lana').name).toBe('LANA AI');
    expect(brandFor('lana-one').name).toBe('LANA One');
  });
});

test('lanaOneLogo maps both logos and keeps the relative prefix', () => {
  expect(lanaOneLogo('img/logo-light.png')).toBe('img/lana-one/logo-light.png');
  expect(lanaOneLogo('../img/logo-dark.png?v=2')).toBe('../img/lana-one/logo-dark.png?v=2');
  expect(lanaOneLogo('img/avatar.png')).toBeNull();
  expect(lanaOneLogo(null)).toBeNull();
});

const PAGE = `<!doctype html><html><head>
  <title>Dashboard - LANA AI</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M22 16h8v25h15v7H22z'/%3E%3C/svg%3E">
</head><body>
  <img id="logo" src="../img/logo-light.png" alt="LanaAI">
  <img id="avatar" src="img/avatar.png" alt="me">
  <div id="lana-preloader" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <svg class="preloader-logo" viewBox="0 0 100 100"><circle cx="50" cy="50" r="25"/></svg>
    <div class="preloader-text">Loading LanaAI...</div>
  </div>
  <div class="copy">&copy; 2026 RedRooster Technologies Inc.</div>
</body></html>`;

function flush(dom) {
  return new Promise((resolve) => dom.window.setTimeout(resolve, 0));
}

describe('applyBrandToDocument', () => {
  test('flavor "lana" leaves the page exactly as written', () => {
    const dom = new JSDOM(PAGE);
    const before = dom.serialize();
    expect(applyBrandToDocument(dom.window.document, 'lana')).toBeNull();
    expect(dom.serialize()).toBe(before);
  });

  test('flavor "lana-one" rebrands logos, title, favicon and the legacy loader', () => {
    const dom = new JSDOM(PAGE);
    const doc = dom.window.document;
    applyBrandToDocument(doc, 'lana-one');

    expect(doc.getElementById('logo').getAttribute('src')).toBe('../img/lana-one/logo-light.png');
    expect(doc.getElementById('logo').getAttribute('alt')).toBe('LANA One');
    expect(doc.getElementById('avatar').getAttribute('src')).toBe('img/avatar.png');
    expect(doc.title).toBe('Dashboard - LANA One');
    expect(doc.querySelector('link[rel=icon]').getAttribute('href')).toBe(FAVICON_HREF);
    expect(doc.getElementById('lana-preloader').style.background).toMatch(/#111111|rgb\(17, 17, 17\)/);
    const mark = doc.querySelector('svg.preloader-logo');
    expect(mark.getAttribute('viewBox')).toBe('358 382 539 539');
    expect(mark.querySelectorAll('path')).toHaveLength(3);
    expect(doc.querySelector('.preloader-text').textContent).toBe('Loading LANA One...');
    expect(doc.querySelector('.copy').textContent).toContain('RedRooster Technologies Inc.');
  });

  test('later changes are branded too: a logo a component renders, and a title set by script', async () => {
    const dom = new JSDOM('<!doctype html><html><head><title>x</title></head><body></body></html>');
    const doc = dom.window.document;
    applyBrandToDocument(doc, 'lana-one');

    const img = doc.createElement('img');
    img.setAttribute('src', 'img/logo-dark.png');
    doc.body.appendChild(img);
    doc.title = 'Files - LanaAI';
    await flush(dom);
    expect(img.getAttribute('src')).toBe('img/lana-one/logo-dark.png');
    expect(doc.title).toBe('Files - LANA One');

    img.setAttribute('src', 'img/logo-light.png');
    await flush(dom);
    expect(img.getAttribute('src')).toBe('img/lana-one/logo-light.png');
  });

  test('another app\'s favicon is kept', () => {
    const dom = new JSDOM(`<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3Ccircle/%3E%3C/svg%3E"></head><body></body></html>`);
    applyBrandToDocument(dom.window.document, 'lana-one');
    expect(dom.window.document.querySelector('link').getAttribute('href')).toContain('circle');
  });
});

test('every LANA One asset the flavor points at ships with the client', () => {
  for (const rel of [
    'src/img/lana-one/logo-light.png', 'src/img/lana-one/logo-dark.png',
    'src/screen-voice/overlay/lana-one-mark-light.svg',
    'build/icons-lana-one/icon.icns', 'build/icons-lana-one/icon.ico',
    'build/icons-lana-one/icon-256.png', 'build/icons-lana-one/icon-1024.png',
  ]) {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  }
});

describe('readAppPackageJson', () => {
  // The bundler inlines require('./package.json'), so a packaged LANA One saw
  // the client's stamp. The flavor must come from the running app's file.
  test('reads the package.json of the given app folder at run time', () => {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-brand-app-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'lana-one', lanaFlavor: 'lana-one' }));
      const pkg = readAppPackageJson(dir);
      expect(resolveFlavor({ packageJson: pkg, isPackaged: true })).toBe('lana-one');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an app folder without a readable package.json means the LANA client', () => {
    expect(readAppPackageJson('/nonexistent/app')).toEqual({});
    expect(resolveFlavor({ packageJson: readAppPackageJson('/nonexistent/app'), isPackaged: true })).toBe('lana');
  });

  test('electron-main resolves the flavor from the app folder, not the inlined package.json', () => {
    const main = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');
    expect(main).toMatch(/resolveFlavor\(\{[^}]*packageJson: readAppPackageJson\(app\.getAppPath\(\)\)/);
  });
});

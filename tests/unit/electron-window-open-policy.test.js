'use strict';

// window.open from any frame lands in the main window's setWindowOpenHandler.
// An unsandboxed http(s) preview frame could otherwise open about:blank,
// blob:, data:, javascript: or a local file. Measured in Electron 44.7.0:
// popups already get no preload and webSecurity on by default; the policy
// pins that explicitly (so an Electron change cannot regress it) and denies
// javascript:, data:, unknown schemes and file: outside the app pages.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../..');
const { decideWindowOpen, ISOLATED_POPUP_OPTIONS } = require(path.join(ROOT, 'electron-window-open-policy.js'));

const APP_ROOT = path.join(ROOT, 'public_html');
const appPage = (rel) => pathToFileURL(path.join(APP_ROOT, rel)).href;

describe('decideWindowOpen', () => {
  test('http(s) goes to the system browser as the parsed href', () => {
    expect(decideWindowOpen('https://billing.example/portal?x=1', { appRoot: APP_ROOT })).toEqual({ external: 'https://billing.example/portal?x=1' });
    expect(decideWindowOpen('http://localhost:3000/api/v1/automation/artifacts/1/download', { appRoot: APP_ROOT }))
      .toEqual({ external: 'http://localhost:3000/api/v1/automation/artifacts/1/download' });
    expect(decideWindowOpen('https://user:pw@evil.example/x', { appRoot: APP_ROOT })).toEqual({ external: 'https://evil.example/x' });
  });

  test('mailto: goes to the system mail app', () => {
    expect(decideWindowOpen('mailto:support@lanaai.io?subject=Help', { appRoot: APP_ROOT })).toEqual({ external: 'mailto:support@lanaai.io?subject=Help' });
  });

  test.each(['javascript:top.lanaAuthToken.get()', 'JavaScript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'chrome://settings', 'about:srcdoc', 'not a url'])(
    '%p is denied',
    (url) => {
      expect(decideWindowOpen(url, { appRoot: APP_ROOT })).toEqual({ response: { action: 'deny' } });
    }
  );

  test.each(['', 'about:blank', 'blob:https://minio.example/2b1f'])('%p opens isolated: no preload, web security and sandbox on', (url) => {
    const decision = decideWindowOpen(url, { appRoot: APP_ROOT });
    expect(decision.response.action).toBe('allow');
    expect(decision.response.overrideBrowserWindowOptions).toBe(ISOLATED_POPUP_OPTIONS);
  });

  test('the isolated options strip the preload and keep every protection on', () => {
    const prefs = ISOLATED_POPUP_OPTIONS.webPreferences;
    expect(Object.prototype.hasOwnProperty.call(prefs, 'preload')).toBe(true);
    expect(prefs.preload).toBeUndefined();
    expect(prefs).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, plugins: false });
    expect(Object.isFrozen(ISOLATED_POPUP_OPTIONS)).toBe(true);
    expect(Object.isFrozen(prefs)).toBe(true);
  });

  test('app pages under public_html still open (the app uses window.open for its own pages)', () => {
    ['doc-studio/index.html?id=1&view=doc&embed=1', 'file-viewer.html?id=2', 'integrations/connector-viewer.html'].forEach((rel) => {
      const decision = decideWindowOpen(appPage(rel), { appRoot: APP_ROOT });
      expect(decision.response.action).toBe('allow');
      expect(decision.response.overrideBrowserWindowOptions).toBe(ISOLATED_POPUP_OPTIONS);
    });
  });

  test('file: outside the app pages is denied, including traversal and symlink escapes', () => {
    const outside = [
      pathToFileURL(path.join(os.homedir(), 'Documents', 'x.html')).href,
      'file:///etc/passwd',
      appPage('..') + '/electron-main.js',
      pathToFileURL(APP_ROOT).href + '/../package.json',
      pathToFileURL(APP_ROOT + '-evil/x.html').href
    ];
    outside.forEach((url) => expect(decideWindowOpen(url, { appRoot: APP_ROOT })).toEqual({ response: { action: 'deny' } }));
  });

  test('a missing app root fails closed for file: but not for http(s)', () => {
    expect(decideWindowOpen(appPage('dashboard.html'), {})).toEqual({ response: { action: 'deny' } });
    expect(decideWindowOpen('https://a.example', {})).toEqual({ external: 'https://a.example/' });
  });
});

describe('electron-main wiring', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');

  test('both windows route window.open through the policy', () => {
    const handlers = main.match(/setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*?\n {2}\}\);/g) || [];
    expect(handlers.length).toBe(2);
    handlers.forEach((handler) => {
      expect(handler).toMatch(/decideWindowOpen\(url, \{ appRoot: path\.join\(__dirname, 'public_html'\) \}\)/);
      expect(handler).toMatch(/shell\.openExternal\(decision\.external\)/);
      expect(handler).not.toMatch(/return \{ action: 'allow' \}/);
    });
  });

  test('every window.open target the app itself uses still opens', () => {
    // From the src/ window.open audit: http(s) links, API downloads and app pages.
    const uses = [
      'https://billing.stripe.com/p/session/x',
      'http://localhost:3000/api/v1/automation/artifacts/a/download',
      appPage('doc-studio/index.html?id=1&view=doc&embed=1')
    ];
    uses.forEach((url) => {
      const decision = decideWindowOpen(url, { appRoot: APP_ROOT });
      expect(decision.external || decision.response.action).toBeTruthy();
      if (decision.response) expect(decision.response.action).toBe('allow');
    });
  });
});

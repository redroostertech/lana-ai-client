'use strict';

// Main-frame navigation in any app window (electron-navigation-policy.js).

const path = require('path');
const { pathToFileURL } = require('url');
const { decideNavigation } = require('../../electron-navigation-policy');

const ROOT = path.resolve(__dirname, '../..');
const appRoot = path.join(ROOT, 'public_html');

describe('decideNavigation', () => {
  test('app pages load as they are', () => {
    expect(decideNavigation('lana-app://app/public_html/dashboard.html', { appRoot })).toEqual({ action: 'allow' });
    expect(decideNavigation('lana-app://app/public_html/admin/users.html?tab=1#x', { appRoot })).toEqual({ action: 'allow' });
  });

  test('root-relative app links are rewritten into public_html, query and hash kept', () => {
    expect(decideNavigation('lana-app://app/workspaces.html?status=active#top', { appRoot }))
      .toEqual({ action: 'redirect', url: 'lana-app://app/public_html/workspaces.html?status=active#top' });
    expect(decideNavigation('lana-app://app/admin/roles.html', { appRoot }))
      .toEqual({ action: 'redirect', url: 'lana-app://app/public_html/admin/roles.html' });
    expect(decideNavigation('lana-app://app/', { appRoot }))
      .toEqual({ action: 'redirect', url: 'lana-app://app/public_html/dashboard.html' });
  });

  test('an old file:// link to an app page becomes its app URL; any other file is refused', () => {
    expect(decideNavigation(pathToFileURL(path.join(appRoot, 'login.html')).href + '?next=app', { appRoot }))
      .toEqual({ action: 'redirect', url: 'lana-app://app/public_html/login.html?next=app' });
    expect(decideNavigation('file:///etc/passwd', { appRoot })).toEqual({ action: 'deny' });
    expect(decideNavigation(pathToFileURL(path.join(ROOT, 'electron-main.js')).href, { appRoot })).toEqual({ action: 'deny' });
  });

  test('web and mail links open in the system browser (credentials stripped); the window stays', () => {
    expect(decideNavigation('https://user:pw@www.lanaai.io/terms-of-service', { appRoot }))
      .toEqual({ action: 'external', url: 'https://www.lanaai.io/terms-of-service' });
    expect(decideNavigation('mailto:support@redroostertec.com', { appRoot }))
      .toEqual({ action: 'external', url: 'mailto:support@redroostertec.com' });
  });

  test('everything else is refused', () => {
    ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'blob:lana-app://app/x', 'chrome://settings', 'lana-app://evil/public_html/x.html', 'smb://host/share', 'not a url', '']
      .forEach((url) => expect({ url, d: decideNavigation(url, { appRoot }) }).toEqual({ url, d: { action: 'deny' } }));
  });
});

describe('electron-main wiring', () => {
  const main = require('fs').readFileSync(path.join(ROOT, 'electron-main.js'), 'utf8');
  const created = main.slice(main.indexOf("app.on('web-contents-created'"));

  test('every webContents gets the navigation, redirect and webview guards', () => {
    expect(created).toMatch(/contents\.on\('will-navigate'[\s\S]*?decideNavigation\(navigationUrl, \{ appRoot \}\)/);
    expect(created).toMatch(/contents\.on\('will-redirect'[\s\S]*?decideNavigation\(navigationUrl, \{ appRoot \}\)\.action !== 'allow'/);
    expect(created).toMatch(/contents\.on\('will-attach-webview', \(attachEvent\) => attachEvent\.preventDefault\(\)\)/);
  });
});

// Subframe navigations (will-frame-navigate): web content and app pages load in the frame;
// any other scheme (foo://, ms-settings:, mailto:) is blocked in the frame, and the
// allowed ones (mailto, the vault link) go through the app's opener (electron-external-open.js).
describe('decideFrameNavigation', () => {
  const { decideFrameNavigation } = require('../../electron-navigation-policy');

  test('app pages and web content stay in the frame', () => {
    for (const url of ['lana-app://app/public_html/integrations/connector-viewer.html', 'https://partner.example/app', 'http://127.0.0.1:4710/v1/x', 'blob:lana-app://app/123', 'about:blank', 'about:srcdoc', 'data:text/html,x']) {
      expect({ url, decision: decideFrameNavigation(url) }).toEqual({ url, decision: { action: 'allow' } });
    }
  });

  test('custom schemes are blocked in the frame; allowed ones go to the opener', () => {
    expect(decideFrameNavigation('mailto:a@b.test')).toEqual({ action: 'external', url: 'mailto:a@b.test' });
    expect(decideFrameNavigation('brainchild://vault/a.md')).toEqual({ action: 'external', url: 'brainchild://vault/a.md' });
    for (const url of ['foo://bar', 'ms-settings:privacy', 'x-apple.systempreferences:com.apple', 'file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'not a url']) {
      expect({ url, decision: decideFrameNavigation(url) }).toEqual({ url, decision: { action: 'deny' } });
    }
  });

  test('electron-main.js handles will-frame-navigate on every webContents', () => {
    const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
    const block = main.slice(main.indexOf("contents.on('will-frame-navigate'"), main.indexOf('});', main.indexOf("contents.on('will-frame-navigate'")));
    expect(block).toMatch(/if \(details\.isMainFrame\) return;/);
    expect(block).toMatch(/decideFrameNavigation\(details\.url\)/);
    expect(block).toMatch(/details\.preventDefault\(\)/);
    // Without an initiator the navigation is refused, never judged by the target frame.
    expect(block).not.toMatch(/details\.initiator \|\| details\.frame/);
    expect(block).toMatch(/if \(decision\.action === 'external' && details\.initiator\)/);
    expect(block).toMatch(/externalOpener\.open\(decision\.url, \{ contents, fromFrame: details\.initiator \}\)/);
  });
});

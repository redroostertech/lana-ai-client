'use strict';

/**
 * Opening a URL in the system browser (electron-external-open.js) and the
 * main-process confirmation dialogs (electron-confirm.js). docs/plans/harden-ipc.md.
 */

const { createExternalOpener } = require('../../electron-external-open');
const { confirmAction, CONFIRMATIONS } = require('../../electron-confirm');
const { isAllowedExternalUrl } = require('../../src/electron-external-url');

const APP = 'lana-app://app/public_html/app.html';

function contentsAt(url = APP, focused = null, id = 1) {
  const mainFrame = { url, parent: null };
  return { id, mainFrame, focusedFrame: focused || mainFrame };
}

function setup({ gesture = true, confirmed = false } = {}) {
  let now = 0;
  const shell = { openExternal: jest.fn(async () => {}) };
  const confirm = jest.fn(async () => confirmed);
  const opener = createExternalOpener({
    shell,
    isAllowed: isAllowedExternalUrl,
    gestures: { recent: () => gesture },
    confirm,
    now: () => now,
    log: () => {}
  });
  return { opener, shell, confirm, tick: (ms) => { now += ms; } };
}

describe('createExternalOpener', () => {
  test('the app\'s top frame with a recent gesture opens an allowed URL', async () => {
    const { opener, shell, confirm } = setup();
    await expect(opener.open('https://lanaai.io/help', { contents: contentsAt() })).resolves.toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith('https://lanaai.io/help');
    expect(confirm).not.toHaveBeenCalled();
  });

  test('schemes outside web, mail and the vault link are refused', async () => {
    const { opener, shell } = setup();
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'smb://host/share', 'x-apple.systempreferences:foo', '']) {
      await expect(opener.open(url, { contents: contentsAt() })).resolves.toBe(false);
    }
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('a window not showing an app page, or input focused in a third-party frame, is refused', async () => {
    const { opener, shell } = setup();
    await expect(opener.open('https://evil.example', { contents: contentsAt('https://evil.example/') })).resolves.toBe(false);
    const thirdParty = contentsAt(APP, { url: 'https://preview.example/doc.pdf', parent: {} });
    await expect(opener.open('https://evil.example', { contents: thirdParty, fromWindowOpen: true })).resolves.toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test('without a recent gesture the person is asked first', async () => {
    const declined = setup({ gesture: false, confirmed: false });
    await expect(declined.opener.open('https://lanaai.io', { contents: contentsAt() })).resolves.toBe(false);
    expect(declined.confirm).toHaveBeenCalledWith('openExternal', { url: 'https://lanaai.io' }, expect.anything());
    expect(declined.shell.openExternal).not.toHaveBeenCalled();
    const accepted = setup({ gesture: false, confirmed: true });
    await expect(accepted.opener.open('https://lanaai.io', { contents: contentsAt() })).resolves.toBe(true);
  });

  test('window.open is judged by its opener: the referrer\'s origin, else the focused frame', async () => {
    const { opener, shell } = setup();
    // A third-party frame inside an app page, even with focus on the app.
    await expect(opener.open('https://evil.example', { contents: contentsAt(), fromWindowOpen: true, openerUrl: 'https://preview.example/doc' })).resolves.toBe(false);
    // An app page (the referrer may be just the origin under the default policy).
    await expect(opener.open('https://lanaai.io', { contents: contentsAt(), fromWindowOpen: true, openerUrl: 'lana-app://app/' })).resolves.toBe(true);
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });

  test('window.open with no referrer always asks, even right after a click (a frame can hide its origin)', async () => {
    const declined = setup({ gesture: true, confirmed: false });
    await expect(declined.opener.open('https://lanaai.io/2', { contents: contentsAt(), fromWindowOpen: true, openerUrl: '' })).resolves.toBe(false);
    expect(declined.confirm).toHaveBeenCalledTimes(1);
    expect(declined.shell.openExternal).not.toHaveBeenCalled();
    const accepted = setup({ gesture: true, confirmed: true });
    await expect(accepted.opener.open('https://lanaai.io/2', { contents: contentsAt(), fromWindowOpen: true, openerUrl: '' })).resolves.toBe(true);
    expect(accepted.confirm).toHaveBeenCalledTimes(1);
  });

  test('the app\'s own links keep their referrer, so they open without a question', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|html)$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(__dirname, '..', '..', 'src'));
    expect(files.length).toBeGreaterThan(200);
    const offenders = files.filter((file) => /noreferrer/i.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(path.join(__dirname, '..', '..'), file));
    expect(offenders).toEqual([]);
  });

  test('a frame navigation is judged by the frame that started it', async () => {
    const { opener } = setup();
    await expect(opener.open('mailto:a@b.test', { contents: contentsAt(), fromFrame: { url: 'https://preview.example/x' } })).resolves.toBe(false);
    await expect(opener.open('mailto:a@b.test', { contents: contentsAt(), fromFrame: { url: 'lana-app://app/public_html/drive.html' } })).resolves.toBe(true);
  });

  test('the budget is spent only on opens that happen; Cancel starts a cooldown; one dialog at a time', async () => {
    let now = 0;
    let answer = false;
    let release;
    const shell = { openExternal: jest.fn(async () => {}) };
    const confirm = jest.fn(() => new Promise((resolve) => { release = () => resolve(answer); }));
    let clicked = false;
    const opener = createExternalOpener({ shell, isAllowed: isAllowedExternalUrl, gestures: { recent: () => clicked }, confirm, now: () => now, log: () => {} });
    const contents = contentsAt();
    const first = opener.open('https://lanaai.io/1', { contents });
    // While the dialog is up, another ask from the same window is refused without a second dialog.
    await expect(opener.open('https://lanaai.io/2', { contents })).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toBe(false);
    // After Cancel: no dialog for 10 seconds.
    now += 5000;
    await expect(opener.open('https://lanaai.io/3', { contents })).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    now += 6000;
    answer = true;
    const later = opener.open('https://lanaai.io/4', { contents });
    release();
    await expect(later).resolves.toBe(true);
    // Refused and cancelled asks did not use the budget: with this one open, two more fit.
    clicked = true;
    expect(await opener.open('https://lanaai.io/a', { contents })).toBe(true);
    expect(await opener.open('https://lanaai.io/b', { contents })).toBe(true);
    expect(await opener.open('https://lanaai.io/c', { contents })).toBe(false);
  });

  test('a burst of opens is cut off, and allowed again later', async () => {
    const { opener, shell, tick } = setup();
    const contents = contentsAt();
    const results = [];
    for (let i = 0; i < 8; i += 1) results.push(await opener.open(`https://lanaai.io/${i}`, { contents }));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(shell.openExternal).toHaveBeenCalledTimes(3);
    tick(11000);
    await expect(opener.open('https://lanaai.io/later', { contents })).resolves.toBe(true);
    // Each window has its own budget.
    await expect(opener.open('https://lanaai.io/other', { contents: contentsAt(APP, null, 2) })).resolves.toBe(true);
  });
});

describe('confirmAction', () => {
  test('asks with Cancel as the default and answers true only for the action button', async () => {
    const dialog = { showMessageBox: jest.fn(async () => ({ response: 0 })) };
    await expect(confirmAction(dialog, null, 'installUpdate', {})).resolves.toBe(true);
    const options = dialog.showMessageBox.mock.calls[0][0];
    expect(options).toMatchObject({ type: 'question', defaultId: 1, cancelId: 1, buttons: ['Install and restart', 'Cancel'] });
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    await expect(confirmAction(dialog, null, 'installUpdate', {})).resolves.toBe(false);
  });

  test('the update question names the version, when it is a plain version', () => {
    expect(CONFIRMATIONS.installUpdate({ version: '4.2.0' }).message).toBe('Install LANA 4.2.0 now?');
    expect(CONFIRMATIONS.installUpdate({ version: '4.2.0-beta.1' }).message).toBe('Install LANA 4.2.0-beta.1 now?');
    expect(CONFIRMATIONS.installUpdate({}).message).toBe('Install the LANA update now?');
    expect(CONFIRMATIONS.installUpdate({ version: '4.2.0 <script>' }).message).toBe('Install the LANA update now?');
    const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
    expect(main).toMatch(/confirmFor\('installUpdate', \{ version: \(getLastCheckResult\(\) \|\| \{\}\)\.version \}, event\.sender\)/);
  });

  test('a dialog that fails, or an unknown action, is a no', async () => {
    await expect(confirmAction({ showMessageBox: async () => { throw new Error('x'); } }, null, 'installUpdate', {})).resolves.toBe(false);
    await expect(confirmAction({ showMessageBox: async () => ({ response: 0 }) }, null, 'nope', {})).resolves.toBe(false);
  });

  test('the copy is plain, names what will happen, and never shows page-supplied text as is', () => {
    const always = CONFIRMATIONS.alwaysAllowCompanion({ app: "lana-companion" });
    expect(always.message).toMatch(/Always let/);
    expect(always.detail).toMatch(/Settings > Connected Apps/);
    const odd = CONFIRMATIONS.alwaysAllowCompanion({ app: 'evil"<b>app</b>' });
    expect(odd.message).not.toMatch(/evil|<b>/);
    const reveal = CONFIRMATIONS.revealNote({ file: '/Users/x/Vault/Daily/2026-11-19 notes.md' });
    expect(reveal.detail).toBe('2026-11-19 notes.md');
    const open = CONFIRMATIONS.openExternal({ url: 'https://user:pw@lanaai.io/a?b=c' });
    expect(open.detail).toBe('https://lanaai.io/a?b=c');
    for (const entry of [always, reveal, open, CONFIRMATIONS.installUpdate({})]) {
      expect(entry.message + entry.detail + entry.ok).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe('electron-main.js uses them', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
  const handler = (channel) => main.slice(main.indexOf(`ipc.handle('${channel}'`), main.indexOf('\n});', main.indexOf(`ipc.handle('${channel}'`)));

  test('every browser open goes through the opener (window.open, navigation, the channel)', () => {
    const direct = main.match(/shell\.openExternal\(/g) || [];
    // The one direct call: screen voice's fixed web-search hosts (openScreenVoiceResearchUrl).
    expect(direct).toHaveLength(1);
    expect(main).toMatch(/externalOpener\.open\(decision\.external, \{ contents, fromWindowOpen: true, openerUrl: \(referrer && referrer\.url\) \|\| '' \}\)/);
    expect(main).toMatch(/externalOpener\.open\(decision\.url, \{ contents \}\)/);
    expect(handler('open-external-url')).toMatch(/externalOpener\.open\(url, \{ contents: event\.sender \}\)/);
  });

  test('install-update, always-allow consent and revealNote ask in the app\'s dialog first', () => {
    expect(handler('install-update')).toMatch(/confirmFor\('installUpdate'/);
    expect(handler('companion-bridge:respond-consent')).toMatch(/confirmFor\('alwaysAllowCompanion'/);
    const reveal = handler('brainchild:revealNote');
    expect(reveal.indexOf("confirmFor('revealNote'")).toBeGreaterThan(-1);
    expect(reveal.indexOf("confirmFor('revealNote'")).toBeLessThan(reveal.indexOf('shell.showItemInFolder'));
  });
});

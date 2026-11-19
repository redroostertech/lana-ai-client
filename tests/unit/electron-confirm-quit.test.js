'use strict';

/**
 * A pending main-process question must never block quitting (electron-confirm.js): on
 * before-quit and SIGTERM every open prompt is answered as Cancel and its dialog closed.
 */

const { confirmAction, trackedMessageBox, cancelAllPrompts, pendingPromptCount } = require('../../electron-confirm');

// A dialog that stays open until its AbortSignal fires, as Electron's showMessageBox does.
function abortableDialog() {
  const opened = [];
  return {
    opened,
    showMessageBox: jest.fn((parentOrOptions, maybeOptions) => {
      const options = maybeOptions || parentOrOptions;
      opened.push(options);
      return new Promise((resolve) => {
        options.signal.addEventListener('abort', () => resolve({ response: options.cancelId }));
      });
    })
  };
}

test('cancelAllPrompts answers every pending confirmation as Cancel and closes its dialog', async () => {
  const dialog = abortableDialog();
  const first = confirmAction(dialog, null, 'openExternal', { url: 'https://lanaai.io' });
  const second = confirmAction(dialog, { id: 1 }, 'installUpdate', { version: '4.2.0' });
  const third = trackedMessageBox(dialog, undefined, { type: 'info', message: 'Switch firms?', buttons: ['Switch', 'Cancel'], cancelId: 1 });
  expect(pendingPromptCount()).toBe(3);
  expect(dialog.opened.every((options) => options.signal && !options.signal.aborted)).toBe(true);
  expect(cancelAllPrompts()).toBe(3);
  await expect(first).resolves.toBe(false);
  await expect(second).resolves.toBe(false);
  await expect(third).resolves.toMatchObject({ response: 1 });
  expect(dialog.opened.every((options) => options.signal.aborted)).toBe(true);
  expect(pendingPromptCount()).toBe(0);
});

test('a prompt that was answered is no longer tracked', async () => {
  const dialog = { showMessageBox: jest.fn(async () => ({ response: 0 })) };
  await expect(confirmAction(dialog, null, 'revealNote', { file: '/x/a.md' })).resolves.toBe(true);
  expect(pendingPromptCount()).toBe(0);
  expect(cancelAllPrompts()).toBe(0);
});

test('electron-main.js cancels prompts on before-quit and on SIGTERM, and the app-link dialog is tracked', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'electron-main.js'), 'utf8');
  const beforeQuit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("app.on('before-quit'") + 400);
  expect(beforeQuit).toMatch(/cancelAllPrompts\(\);/);
  expect(main).toMatch(/process\.on\('SIGTERM', \(\) => \{\s*cancelAllPrompts\(\);\s*app\.quit\(\);\s*\}\);/);
  const appLink = main.slice(main.indexOf('async function appLinkMessage'), main.indexOf('\n}', main.indexOf('async function appLinkMessage')));
  expect(appLink).toMatch(/trackedMessageBox\(dialog, parent,/);
});

test('no main-process code calls showMessageBox except through trackedMessageBox', () => {
  const fs = require('fs');
  const path = require('path');
  const { mainProcessFiles } = require('./helpers/script-sink-scan');
  const root = path.join(__dirname, '..', '..');
  const offenders = [];
  for (const file of mainProcessFiles(root)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const calls = [...source.matchAll(/showMessageBox(?:Sync)?\s*\(/g)].length;
    // The helper itself makes the two real calls (with and without a parent window).
    const allowed = file === 'electron-confirm.js' ? 2 : 0;
    if (calls !== allowed) offenders.push(`${file}: ${calls}`);
  }
  expect(offenders).toEqual([]);
});

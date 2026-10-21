'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(read('lex/lex.core.js'));
  window.eval(read('lex/components/foundation/lex-modal.js'));
  return window;
}

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 30));

function click(window, modal, action) {
  const button = modal.querySelector(`[data-action="${action}"]`);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

describe('Lex.Modal promise API', () => {
  test('confirmAsync resolves true on confirm and escapes the message', async () => {
    const window = boot();
    const pending = window.Lex.Modal.confirmAsync('Delete', '<b>Report</b> & notes');
    await tick(window);
    const modal = window.document.querySelector('lex-modal');
    expect(modal.innerHTML).toContain('&lt;b&gt;Report&lt;/b&gt; &amp; notes');
    click(window, modal, 'confirm');
    await expect(pending).resolves.toBe(true);
  });

  test('confirmAsync resolves false on cancel', async () => {
    const window = boot();
    const pending = window.Lex.Modal.confirmAsync('Delete', 'Sure?');
    await tick(window);
    click(window, window.document.querySelector('lex-modal'), 'cancel');
    await expect(pending).resolves.toBe(false);
  });

  test('alertAsync resolves when dismissed', async () => {
    const window = boot();
    const pending = window.Lex.Modal.alertAsync('Saved', 'Done');
    await tick(window);
    click(window, window.document.querySelector('lex-modal'), 'confirm');
    await expect(pending).resolves.toBeUndefined();
  });

  test('prompt resolves the trimmed value, null on cancel, and stays open while required is empty', async () => {
    const window = boot();
    const pending = window.Lex.Modal.prompt('Rename', { label: 'Name', value: '  Draft  ', required: true });
    await tick(window);
    const modal = window.document.querySelector('lex-modal');
    const input = modal.querySelector('[data-lex-prompt-input]');
    input.value = '';
    click(window, modal, 'confirm');
    await tick(window);
    expect(modal.open).toBe(true);
    input.value = '  Final  ';
    click(window, modal, 'confirm');
    await expect(pending).resolves.toBe('Final');

    const cancelled = window.Lex.Modal.prompt('Rename', {});
    await tick(window);
    const second = Array.from(window.document.querySelectorAll('lex-modal')).pop();
    click(window, second, 'cancel');
    await expect(cancelled).resolves.toBeNull();
  });
});

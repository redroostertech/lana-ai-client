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

describe('lex-modal slots and lex-drawer additions', () => {
  function bootWith(extra) {
    const window = boot();
    extra.forEach((rel) => window.eval(read(rel)));
    return window;
  }

  test('data-slot="footer" children replace the built-in buttons; setFooterContent and setHeaderActions work after render; hide-close hides the close button', async () => {
    const window = boot();
    const host = window.document.createElement('div');
    host.innerHTML = '<lex-modal heading="Edit" hide-close><p>Body</p><div data-slot="footer"><button id="save">Save</button></div></lex-modal>';
    window.document.body.appendChild(host);
    const modal = host.querySelector('lex-modal');
    modal.open = true;
    await tick(window);
    const footer = modal.querySelector('.lex-modal-footer');
    expect(footer.querySelector('#save')).not.toBeNull();
    expect(footer.querySelector('[data-action="confirm"]')).toBeNull();
    expect(modal.querySelector('.lex-modal-close').hidden).toBe(true);
    modal.setFooterContent('<button id="done">Done</button>');
    expect(modal.querySelector('.lex-modal-footer #done')).not.toBeNull();
    modal.setHeaderActions('<button id="help">?</button>');
    expect(modal.querySelector('.lex-modal-header-actions #help')).not.toBeNull();
  });

  test('lex-drawer moves data-slot="header-actions", toggles its footer and exposes contentRoot', async () => {
    const window = bootWith(['lex/components/foundation/lex-drawer.js']);
    const host = window.document.createElement('div');
    host.innerHTML = '<lex-drawer heading="Details" show-footer><span data-slot="header-actions" id="refresh">R</span><p id="content">Hi</p></lex-drawer>';
    window.document.body.appendChild(host);
    const drawer = host.querySelector('lex-drawer');
    drawer.open = true;
    await tick(window);
    expect(drawer.querySelector('.lex-drawer-header-actions #refresh')).not.toBeNull();
    expect(drawer.contentRoot.querySelector('#content')).not.toBeNull();
    drawer.setFooterVisible(false);
    expect(drawer.querySelector('.lex-drawer-footer').classList.contains('hidden')).toBe(true);
  });

  test('lex-btn passes form through to its inner button', async () => {
    const window = bootWith(['lex/components/foundation/lex-btn.js']);
    const host = window.document.createElement('div');
    host.innerHTML = '<form id="f1"></form><lex-btn form="f1" type="submit">Save</lex-btn>';
    window.document.body.appendChild(host);
    await tick(window);
    expect(host.querySelector('lex-btn button').getAttribute('form')).toBe('f1');
  });
});

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (w) => new Promise((r) => w.setTimeout(r, 30));

test('Escape closes a mouse-opened menu (focus on body) without closing the modal around it', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  ['lex/lex.core.js', 'lex/lex.icons.js', 'lex/components/foundation/lex-modal.js', 'lex/components/form/lex-dropdown-btn.js']
    .forEach((rel) => { try { w.eval(read(rel)); } catch (e) { if (!rel.includes('icons')) throw e; } });
  const host = w.document.createElement('div');
  host.innerHTML = '<lex-modal id="m" heading="Edit"><lex-dropdown-btn id="dd" button-label="Actions"></lex-dropdown-btn></lex-modal>';
  w.document.body.appendChild(host);
  const modal = host.querySelector('#m');
  modal.open = true;
  await tick(w);
  const dd = host.querySelector('#dd');
  dd.options = [{ value: 'a', label: 'Archive' }];
  await tick(w);
  dd.querySelector('[data-action="toggle"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick(w);
  expect(dd._open).toBe(true);
  w.document.body.focus();
  w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(w);
  expect(dd._open).toBe(false);
  expect(modal.open).toBe(true);
});

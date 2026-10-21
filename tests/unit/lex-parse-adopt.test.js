'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

// Lex loads in <head>, so components in the body upgrade while the parser is
// still at their opening tag, before their children exist.
test('a lex-modal parsed after Lex loaded keeps its children and footer slot', async () => {
  const scripts = ['lex/lex.core.js', 'lex/components/foundation/lex-modal.js', 'lex/components/foundation/lex-btn.js']
    .map((rel) => `<script>${read(rel).replace(/<\/script>/g, '<\\/script>')}</script>`).join('');
  const html = `<!doctype html><html><head>${scripts}</head><body>
    <lex-modal id="m" heading="Create Matter">
      <form id="f"><input id="name"></form>
      <div data-slot="footer"><lex-btn id="save" type="submit" form="f">Save</lex-btn></div>
    </lex-modal></body></html>`;
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
  const modal = dom.window.document.getElementById('m');
  expect(modal.querySelector('.lex-modal-body slot-content #name')).not.toBeNull();
  expect(modal.querySelector('.lex-modal-footer #save')).not.toBeNull();
  expect(Array.from(modal.children).filter((c) => !c.classList.contains('lex-modal-overlay'))).toHaveLength(0);
  expect(modal.querySelectorAll('button button')).toHaveLength(0);
});

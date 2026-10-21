'use strict';

/**
 * The File Editor's caret-anchored template-variable autocomplete runs on
 * Lex.Menu.openAt (js/lex/components/form/lex-dropdown-btn.js). The
 * autocomplete functions are sliced out of js/file-editor.js and run in jsdom
 * against a real contenteditable, with the rest of the page stubbed.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const editorSource = read('js/file-editor.js');

function slice(from, to) {
  const a = editorSource.indexOf(from);
  const b = editorSource.indexOf(to, a);
  if (a === -1 || b === -1) throw new Error('marker not found: ' + from + ' / ' + to);
  return editorSource.slice(a, b);
}

function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="officeDocPage" contenteditable="true"></div><button data-action="insert-template-variable">Insert</button></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/components/form/lex-dropdown-btn.js']
    .forEach((rel) => { try { w.eval(read(rel)); } catch (e) { if (!rel.includes('icons')) throw e; } });
  // jsdom has no layout: give ranges a caret box.
  w.Range.prototype.getBoundingClientRect = () => ({ left: 200, top: 300, right: 210, bottom: 318, width: 10, height: 18 });
  const code = [
    'var templateVariableMenuState = null;',
    'var mentionUserSearchCache = {}; var mentionUserSearchSeq = 0; var officeEditorInstance = null;',
    'var undoSnapshots = 0; var synced = 0;',
    'function el(id) { return document.getElementById(id); }',
    "function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;'); }",
    "function activeFile() { return { id: 'f1', kind: 'doc' }; }",
    'function isServerReviewFile() { return false; }',
    'function pushDocUndoSnapshot() { undoSnapshots += 1; }',
    "function currentCleanDocHtml() { return ''; }",
    'function syncActiveDocContent() { synced += 1; }',
    'function syncDocumentToolbarState() {}',
    'function toast() {}',
    'function requestMentionUsers() {}',
    'function currentUserRecord() { return null; }',
    slice('  function templateVariableEntities() {', '  function normalizeBaseUrl(value) {'),
    slice('  function fallbackDocPage() {', '  function syncActiveDocContent(options) {'),
    'return { state: function () { return templateVariableMenuState; }, update: updateTemplateVariableAutocomplete, keydown: handleTemplateVariableKeydown, hide: hideTemplateVariableMenu, openPicker: openTemplateVariablePicker, counts: function () { return { undoSnapshots: undoSnapshots, synced: synced }; } };'
  ].join('\n');
  const api = new w.Function(code).call(w);
  const page = w.document.getElementById('officeDocPage');
  return { w, api, page };
}

// Put text in the page and the caret at its end, then run the autocomplete
// as the input listener does.
function typeText(w, api, page, text) {
  page.textContent = text;
  const range = w.document.createRange();
  range.setStart(page.firstChild, text.length);
  range.collapse(true);
  const sel = w.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  api.update();
}

const key = (w, k) => new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
const menuEl = (w) => w.document.getElementById('officeTemplateVariableMenu');
const labels = (w) => Array.from(menuEl(w).querySelectorAll('.lex-menu-item-label')).map((n) => n.textContent);

describe('File Editor variable autocomplete on Lex.Menu', () => {
  test('typing #{{ opens a floating menu at the caret listing entities; plain text does not', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, 'Dear ');
    expect(menuEl(w)).toBeNull();
    typeText(w, api, page, 'Dear #{{');
    const el = menuEl(w);
    expect(el).not.toBeNull();
    expect(el.classList.contains('lex-menu')).toBe(true);
    expect(el.parentNode).toBe(w.document.body);
    expect(el.querySelector('.lex-menu-title strong').textContent).toBe('Template variables');
    expect(el.querySelector('.lex-menu-title code').textContent).toBe('#{{entity:property_key}}');
    expect(labels(w)).toContain('Activity');
    expect(el.style.top).toBe((318 + 8) + 'px');      // below the caret, gap 8
    expect(page.getAttribute('aria-expanded')).toBe('true');
    expect(page.getAttribute('aria-activedescendant')).toBe(el.querySelector('.lex-menu-item--active').id);
  });

  test('filters as the user types', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, '#{{cal');
    expect(labels(w)).toEqual(['Calendar event']);
    typeText(w, api, page, '#{{zzzz');
    expect(menuEl(w).querySelector('.lex-menu-empty').textContent).toBe('No matching fields');
    // No matches: Enter falls through to the editor.
    expect(api.keydown(key(w, 'Enter'))).toBe(false);
  });

  test('keyboard from the editor: arrows move, Enter drills into properties, Enter inserts the token', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, 'Hi #{{activ');
    expect(labels(w)).toEqual(['Activity']);
    expect(api.keydown(key(w, 'ArrowDown'))).toBe(true);
    expect(api.keydown(key(w, 'Enter'))).toBe(true);
    expect(api.state().entityKey).toBe('activity');
    api.update();                                     // keyup after Enter: same text, level kept
    expect(api.state().entityKey).toBe('activity');
    expect(menuEl(w).querySelector('.lex-menu-title strong').textContent).toBe('Activity properties');
    expect(menuEl(w).querySelector('[data-lex-menu-back]')).not.toBeNull();
    expect(api.keydown(key(w, 'ArrowDown'))).toBe(true);
    api.update();                                     // keyup after ArrowDown keeps the highlight
    expect(api.state().activeIndex).toBe(1);
    expect(api.keydown(key(w, 'Tab'))).toBe(true);    // Tab picks like Enter
    const token = page.querySelector('[data-template-variable="true"]');
    expect(token).not.toBeNull();
    expect(token.getAttribute('data-entity')).toBe('activity');
    expect(page.querySelectorAll('[data-template-variable="true"]').length).toBe(1);
    expect(page.textContent).toBe('Hi ' + token.textContent + ' ');   // the typed #{{activ was replaced
    expect(menuEl(w)).toBeNull();
    expect(api.state()).toBeNull();
    expect(api.counts()).toEqual({ undoSnapshots: 1, synced: 1 });
  });

  test('typing entity:prop goes straight to the property level; the back button returns to entities', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, '#{{activity:tit');
    expect(labels(w)).toEqual(['Title']);
    menuEl(w).querySelector('[data-lex-menu-back]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(api.state().entityKey).toBe('');
    expect(menuEl(w).querySelector('.lex-menu-title strong').textContent).toBe('Template variables');
  });

  test('clicking an option drills in, keeping focus in the page (mousedown is prevented)', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, '#{{activ');
    const row = menuEl(w).querySelector('.lex-menu-item');
    const down = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(api.state().entityKey).toBe('activity');
  });

  test('the search box filters the current level', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, '#{{activity:');
    const input = menuEl(w).querySelector('.lex-menu-search');
    expect(input.placeholder).toBe('Search properties...');
    input.value = 'stat';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(labels(w)).toEqual(['Status']);
    expect(menuEl(w).querySelector('.lex-menu-search')).toBe(input);
  });

  test('Escape and a click outside dismiss it; the toolbar insert button does not', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, '#{{');
    page.dispatchEvent(key(w, 'Escape'));
    expect(menuEl(w)).toBeNull();
    expect(api.state()).toBeNull();

    typeText(w, api, page, '#{{');
    w.document.querySelector('[data-action="insert-template-variable"]').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    expect(menuEl(w)).not.toBeNull();
    w.document.body.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    expect(menuEl(w)).toBeNull();
    expect(api.state()).toBeNull();
  });

  test('closing the trigger text (}}) hides the menu', () => {
    const { w, api, page } = boot();
    typeText(w, api, page, '#{{');
    expect(menuEl(w)).not.toBeNull();
    typeText(w, api, page, '#{{a}} ');
    expect(menuEl(w)).toBeNull();
  });

  test('the toolbar picker opens at the button rect', () => {
    const { w, api } = boot();
    const button = w.document.querySelector('[data-action="insert-template-variable"]');
    button.getBoundingClientRect = () => ({ left: 40, top: 10, right: 80, bottom: 40, width: 40, height: 30 });
    api.openPicker(button);
    expect(menuEl(w)).not.toBeNull();
    expect(menuEl(w).style.top).toBe('48px');
  });
});

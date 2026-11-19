'use strict';

// A clearable <lex-select> with a value keeps its clear mark and chevron
// inside the trigger. The clear mark was a <button> inside the trigger
// <button>; the HTML parser closes the outer button there, so the parts fell
// out and stacked under the trigger (the calendar coworker picker after the
// first pick).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

function mount(attrs) {
  const dom = new JSDOM('<!doctype html><head></head><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  ['js/lex/lex.core.js', 'js/lex/lex.icons.js', 'js/lex/lex.forms.js', 'js/lex/components/form/lex-select.js'].forEach((rel) => window.eval(read(rel)));
  const host = window.document.createElement('div');
  host.innerHTML = `<lex-select ${attrs} options='[{"value":"a","label":"Alpha"},{"value":"b","label":"Beta"}]'></lex-select>`;
  window.document.body.appendChild(host);
  return { window, select: host.querySelector('lex-select') };
}

const flush = (window) => new Promise((resolve) => window.setTimeout(resolve, 0));

test.each([
  ['multiple', 'multiple clearable', ['a', 'b']],
  ['single', 'clearable', 'a']
])('%s: the clear mark and chevron stay inside the trigger', async (_label, attrs, value) => {
  const { window, select } = mount(attrs);
  select.value = value;
  await flush(window);
  const trigger = select.querySelector('[data-action="toggle"]');
  expect(trigger.querySelector('[data-action="clear"]')).not.toBeNull();
  expect(trigger.querySelector('.lex-select-chevron')).not.toBeNull();
  // Hidden from assistive tech: its label must not join the trigger's name.
  const clear = trigger.querySelector('[data-action="clear"]');
  expect(clear.getAttribute('aria-hidden')).toBe('true');
  expect(clear.hasAttribute('role')).toBe(false);
  expect(clear.hasAttribute('aria-label')).toBe(false);
  // Clearing works and does not open the list.
  clear.click();
  await flush(window);
  expect(select.value).toEqual(Array.isArray(value) ? [] : '');
  const after = select.querySelector('[data-action="toggle"]');
  expect(after.getAttribute('aria-expanded')).toBe('false');
  expect(select.querySelector('.lex-select-dropdown--open')).toBeNull();
  window.close();
});

test.each([
  ['Delete, multiple', 'multiple clearable', ['a', 'b'], 'Delete'],
  ['Backspace, single searchable', 'clearable searchable', 'a', 'Backspace']
])('keyboard: %s on the closed trigger clears it and keeps the list closed', async (_label, attrs, value, key) => {
  const { window, select } = mount(attrs);
  select.value = value;
  await flush(window);
  const changes = [];
  select.addEventListener('lex-change', (e) => changes.push(e.detail.value));
  select.querySelector('[data-action="toggle"]').dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await flush(window);
  expect(select.value).toEqual(Array.isArray(value) ? [] : '');
  expect(changes).toEqual([Array.isArray(value) ? [] : '']);
  expect(select.querySelector('[data-action="toggle"]').getAttribute('aria-expanded')).toBe('false');
  window.close();
});

test('control: Delete on a select that is not clearable changes nothing', async () => {
  const { window, select } = mount('multiple');
  select.value = ['a'];
  await flush(window);
  select.querySelector('[data-action="toggle"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await flush(window);
  expect(select.value).toEqual(['a']);
  window.close();
});

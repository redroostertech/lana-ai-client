'use strict';

// jsdom tests for the wave-3 Lex component gaps: LexElement upgrade
// properties and content capture, lex-select, lex-modal / lex-drawer layout
// options, lex-btn label, lex-form external submit, lex-dropdown-btn menus.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

const FILES = {
  core: 'lex/lex.core.js',
  forms: 'lex/lex.forms.js',
  btn: 'lex/components/foundation/lex-btn.js',
  modal: 'lex/components/foundation/lex-modal.js',
  drawer: 'lex/components/foundation/lex-drawer.js',
  select: 'lex/components/form/lex-select.js',
  form: 'lex/components/form/lex-form.js',
  dropdown: 'lex/components/form/lex-dropdown-btn.js'
};

const windows = [];
afterEach(() => {
  while (windows.length) windows.pop().close();
});

function makeWindow(body) {
  const dom = new JSDOM(`<!doctype html><body>${body || ''}</body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom.window);
  return dom.window;
}

function load(window, names) {
  for (const name of names) window.eval(read(FILES[name]));
  return window;
}

function boot(names, body) {
  return load(makeWindow(body), ['core'].concat(names));
}

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 0));

function click(window, el) {
  return el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function key(window, el, k) {
  return el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

// ── LexElement ────────────────────────────────────────────────────────────

describe('LexElement content capture', () => {
  const footerMarkup = '<p>Body</p><div data-slot="footer"><lex-btn variant="primary">Save</lex-btn></div>';

  test('a lex-btn in a lex-modal footer renders one button when lex-btn.js loads first', async () => {
    const window = makeWindow(`<lex-modal heading="Edit">${footerMarkup}</lex-modal>`);
    load(window, ['core', 'btn', 'modal']);
    await tick(window);
    const doc = window.document;
    expect(doc.querySelectorAll('button button').length).toBe(0);
    const btn = doc.querySelector('.lex-modal-footer lex-btn');
    expect(btn).not.toBeNull();
    expect(btn.querySelectorAll('button').length).toBe(1);
    expect(btn.querySelector('button').textContent.trim()).toBe('Save');
    expect(doc.querySelector('.lex-modal-body').textContent).toContain('Body');
  });

  test('a lex-btn in a lex-drawer footer renders one button when lex-btn.js loads first', async () => {
    const window = makeWindow(`<lex-drawer heading="Edit">${footerMarkup}</lex-drawer>`);
    load(window, ['core', 'btn', 'drawer']);
    await tick(window);
    const doc = window.document;
    expect(doc.querySelectorAll('button button').length).toBe(0);
    const btn = doc.querySelector('.lex-drawer-footer lex-btn');
    expect(btn.querySelectorAll('button').length).toBe(1);
  });

  test('the modal-first load order still works', async () => {
    const window = makeWindow(`<lex-modal heading="Edit">${footerMarkup}</lex-modal>`);
    load(window, ['core', 'modal', 'btn']);
    await tick(window);
    expect(window.document.querySelectorAll('button button').length).toBe(0);
    expect(window.document.querySelector('.lex-modal-footer lex-btn button')).not.toBeNull();
  });

  test('cloneContent copies an upgraded Lex child from its source, not its rendered markup', async () => {
    const window = boot(['btn'], '<lex-btn id="b"><b>Go</b></lex-btn>');
    await tick(window);
    const live = window.document.getElementById('b');
    expect(live.querySelector('button')).not.toBeNull();
    const copy = window.Lex.LexElement.cloneContent(live);
    expect(copy.querySelector('button')).toBeNull();
    expect(copy.innerHTML).toBe('<b>Go</b>');
  });

  test('properties assigned before upgrade are kept, and win over attributes', async () => {
    const window = boot(['forms']);
    const doc = window.document;
    const el = doc.createElement('lex-select');
    el.setAttribute('placeholder', 'Attr');
    el.options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
    el.value = 'b';
    el.placeholder = 'Prop';
    doc.body.appendChild(el);
    load(window, ['select']);
    await tick(window);
    expect(el.options.length).toBe(2);
    expect(el.value).toBe('b');
    expect(el.placeholder).toBe('Prop');
    expect(el.querySelector('.lex-select-display').textContent).toBe('Beta');
  });
});

// ── lex-select ────────────────────────────────────────────────────────────

describe('lex-select', () => {
  function mount(window, attrs, setup) {
    const el = window.document.createElement('lex-select');
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (setup) setup(el);
    window.document.body.appendChild(el);
    return el;
  }
  const bootSelect = (body) => boot(['forms', 'select'], body);

  test('numeric option values are compared as strings', async () => {
    const window = bootSelect();
    const el = mount(window, {}, (s) => { s.options = [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }]; s.value = 2; });
    await tick(window);
    expect(el.querySelector('.lex-select-display').textContent).toBe('Two');
    expect(el.value).toBe('2');
    const events = [];
    el.addEventListener('lex-change', (e) => events.push(e.detail.value));
    click(window, el.querySelector('[data-value="1"]'));
    expect(events).toEqual(['1']);
  });

  test('plain string options work', async () => {
    const window = bootSelect();
    const el = mount(window, {}, (s) => { s.options = ['Red', 'Green']; s.value = 'Green'; });
    await tick(window);
    expect(el.querySelector('.lex-select-display').textContent).toBe('Green');
  });

  test('disabled options and dividers cannot be chosen and are skipped by the keyboard', async () => {
    const window = bootSelect();
    const el = mount(window, {}, (s) => {
      s.options = [
        { value: 'a', label: 'A', disabled: true },
        { value: 'b', label: 'B' },
        { divider: true },
        { value: 'c', label: 'C', disabled: true },
        { value: 'd', label: 'D' }
      ];
    });
    await tick(window);
    expect(el.querySelectorAll('.lex-select-divider[role="separator"]').length).toBe(1);
    const disabled = el.querySelector('[data-value="a"]');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    const events = [];
    el.addEventListener('lex-change', (e) => events.push(e.detail.value));
    click(window, disabled);
    expect(events).toEqual([]);

    // Keyboard: open → first selectable (B, idx 1); down → D (idx 4).
    key(window, el.querySelector('.lex-select-trigger'), 'ArrowDown');
    await tick(window);
    expect(el.querySelector('.lex-select-option--focused').dataset.value).toBe('b');
    expect(window.document.activeElement).toBe(el.querySelector('.lex-select-trigger'));
    key(window, el.querySelector('.lex-select-trigger'), 'ArrowDown');
    await tick(window);
    expect(el.querySelector('.lex-select-option--focused').dataset.value).toBe('d');
    key(window, el.querySelector('.lex-select-trigger'), 'ArrowUp');
    await tick(window);
    expect(el.querySelector('.lex-select-option--focused').dataset.value).toBe('b');
    key(window, el.querySelector('.lex-select-trigger'), 'Enter');
    await tick(window);
    expect(events).toEqual(['b']);
    expect(el.value).toBe('b');
  });

  test('under multiple, value is an array and the setter takes arrays, JSON or comma strings', async () => {
    const window = bootSelect();
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }];
    const el = mount(window, { multiple: 'true' }, (s) => { s.options = opts; });
    await tick(window);
    expect(el.value).toEqual([]);
    el.value = ['a', 'b'];
    await tick(window);
    expect(el.value).toEqual(['a', 'b']);
    expect(el.querySelectorAll('.lex-select-pill').length).toBe(2);
    el.value = 'b, c';
    await tick(window);
    expect(el.value).toEqual(['b', 'c']);
    el.value = '["c"]';
    await tick(window);
    expect(el.value).toEqual(['c']);
    const events = [];
    el.addEventListener('lex-change', (e) => events.push(e.detail.value));
    click(window, el.querySelector('.lex-select-option[data-value="a"]'));
    expect(events).toEqual([['c', 'a']]);
    expect(el.value).toEqual(['c', 'a']);
  });

  test('a multiple value attribute set as JSON still works (existing callers)', async () => {
    const window = bootSelect();
    const el = mount(window, { multiple: 'true', value: '["a"]' }, (s) => { s.options = ['a', 'b']; });
    await tick(window);
    expect(el.value).toEqual(['a']);
  });

  test('option, clear and pill clicks call preventDefault so a wrapping label does not reopen', async () => {
    const window = bootSelect('<label id="l"></label>');
    const label = window.document.getElementById('l');
    const el = window.document.createElement('lex-select');
    el.setAttribute('clearable', 'true');
    el.options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    label.appendChild(el);
    await tick(window);
    click(window, el.querySelector('.lex-select-trigger'));
    await tick(window);
    expect(el.querySelector('.lex-select-dropdown--open')).not.toBeNull();
    const notCanceled = click(window, el.querySelector('[data-value="a"]'));
    expect(notCanceled).toBe(false);
    await tick(window);
    expect(el.querySelector('.lex-select-dropdown--open')).toBeNull();
    expect(el.value).toBe('a');
    expect(click(window, el.querySelector('[data-action="clear"]'))).toBe(false);
    await tick(window);
    expect(el.querySelector('.lex-select-dropdown--open')).toBeNull();
  });

  test('a single value that matches no option shows the placeholder, and is kept for later options', async () => {
    const window = bootSelect();
    const el = mount(window, { placeholder: 'Pick one' }, (s) => { s.options = [{ value: 'a', label: 'A' }]; s.value = 'zzz'; });
    await tick(window);
    const display = el.querySelector('.lex-select-display');
    expect(display.textContent).toBe('Pick one');
    expect(display.classList.contains('lex-select-placeholder')).toBe(true);
    expect(el.value).toBe('zzz');
    el.options = [{ value: 'zzz', label: 'Late' }];
    await tick(window);
    expect(el.querySelector('.lex-select-display').textContent).toBe('Late');
  });

  test('the enclosing form reset restores the initial value; focus() goes to the trigger', async () => {
    const window = bootSelect('<form id="f"></form>');
    const form = window.document.getElementById('f');
    const el = window.document.createElement('lex-select');
    el.setAttribute('value', 'b');
    el.options = ['a', 'b', 'c'];
    form.appendChild(el);
    await tick(window);
    el.value = 'c';
    await tick(window);
    expect(el.value).toBe('c');
    form.reset();
    await tick(window);
    expect(el.value).toBe('b');
    expect(el.querySelector('.lex-select-display').textContent).toBe('b');

    el.focus();
    expect(window.document.activeElement).toBe(el.querySelector('.lex-select-trigger'));
  });

  // Regression: workspace.js does form.reset() then sets status to 'active';
  // the deferred reset used to wipe it, so matters were created with status ''.
  test.each([
    ['a different value', 'c', 'b'],
    ['the value it already has', 'c', 'c'],
  ])('a value set right after form.reset() survives the reset (%s)', async (_label, before, setAfter) => {
    const window = bootSelect('<form id="f"></form>');
    const form = window.document.getElementById('f');
    const el = window.document.createElement('lex-select');
    el.options = ['a', 'b', 'c'];
    form.appendChild(el);
    await tick(window);
    el.value = before;
    await tick(window);
    form.reset();
    el.value = setAfter;
    await tick(window);
    expect(el.value).toBe(setAfter);
  });
});

// ── lex-modal / lex-drawer ────────────────────────────────────────────────

describe('lex-modal layout options', () => {
  test('flush, width, hideClose, closeOnEscape:false and contentRoot via Lex.Modal.open', async () => {
    const window = boot(['modal']);
    const modal = window.Lex.Modal.open({
      heading: 'Pick', content: '<p id="c">Hi</p>', flush: true, width: '720px',
      hideClose: true, closeOnEscape: false
    });
    await tick(window);
    const panel = modal.querySelector('.lex-modal-panel');
    expect(panel.classList.contains('lex-modal-panel--flush')).toBe(true);
    expect(panel.style.maxWidth).toBe('720px');
    expect(modal.querySelector('.lex-modal-close').hidden).toBe(true);
    expect(modal.contentRoot.querySelector('#c')).not.toBeNull();
    key(window, window.document, 'Escape');
    await tick(window);
    expect(modal.open).toBe(true);
  });

  test('close-on-escape defaults to true and the attribute turns it off', async () => {
    const plain = boot(['modal'], '<lex-modal id="a" heading="A" open></lex-modal>');
    await tick(plain);
    key(plain, plain.document, 'Escape');
    await tick(plain);
    expect(plain.document.getElementById('a').open).toBeFalsy();

    // Escape belongs to the topmost overlay: one that ignores Escape also
    // keeps the overlays beneath it open.
    const stacked = boot(['modal'], '<lex-modal id="a" heading="A" open></lex-modal><lex-modal id="b" heading="B" close-on-escape="false" open></lex-modal>');
    await tick(stacked);
    key(stacked, stacked.document, 'Escape');
    await tick(stacked);
    expect(stacked.document.getElementById('b').open).toBe(true);
    expect(stacked.document.getElementById('a').open).toBe(true);
  });

  test('width rejects values that would escape the style attribute', async () => {
    const window = boot(['modal'], '<lex-modal heading="A" width="10px;background:red"></lex-modal>');
    await tick(window);
    expect(window.document.querySelector('.lex-modal-panel').getAttribute('style') || '').not.toContain('background');
  });

  test('palette: top-aligned, no header, flush, default width, no built-in actions, Escape closes', async () => {
    const window = boot(['modal']);
    const modal = window.Lex.Modal.open({ heading: 'Command palette', palette: true, content: '<input id="q">' });
    await tick(window);
    expect(modal.querySelector('.lex-modal-overlay').classList.contains('lex-modal-overlay--palette')).toBe(true);
    const panel = modal.querySelector('.lex-modal-panel');
    expect(panel.classList.contains('lex-modal-panel--palette')).toBe(true);
    expect(panel.classList.contains('lex-modal-panel--flush')).toBe(true);
    expect(panel.getAttribute('aria-label')).toBe('Command palette');
    expect(modal.querySelector('.lex-modal-header')).toBeNull();
    expect(modal.querySelector('[data-action="confirm"]')).toBeNull();
    const css = window.document.getElementById('lex-modal-styles').textContent;
    expect(css).toContain('padding-top: 12vh');
    const closes = [];
    modal.addEventListener('lex-close', () => closes.push(1));
    key(window, window.document, 'Escape');
    expect(closes.length).toBe(1);
  });

  test('default modal markup is unchanged when no new option is used', async () => {
    const window = boot(['modal'], '<lex-modal heading="A"><p>x</p></lex-modal>');
    await tick(window);
    const panel = window.document.querySelector('.lex-modal-panel');
    expect(panel.className).toBe('lex-modal-panel lex-modal-panel--md');
    expect(panel.hasAttribute('style')).toBe(false);
    expect(window.document.querySelector('[data-action="confirm"]')).not.toBeNull();
  });

  test('lex-drawer flush attribute and Lex.Drawer.open({ flush })', async () => {
    const window = boot(['drawer'], '<lex-drawer id="d" heading="D" flush></lex-drawer>');
    await tick(window);
    expect(window.document.querySelector('#d .lex-drawer-panel').classList.contains('lex-drawer-panel--flush')).toBe(true);
    const drawer = window.Lex.Drawer.open({ heading: 'X', content: '<p>y</p>', flush: true });
    await tick(window);
    expect(drawer.querySelector('.lex-drawer-panel').classList.contains('lex-drawer-panel--flush')).toBe(true);
    drawer.flush = false;
    await tick(window);
    expect(drawer.querySelector('.lex-drawer-panel').classList.contains('lex-drawer-panel--flush')).toBe(false);
  });
});

// ── lex-btn / lex-form ────────────────────────────────────────────────────

describe('lex-btn label', () => {
  test('label is the text when there are no children; children win', async () => {
    const window = boot(['btn'], '<lex-btn id="a" label="Save"></lex-btn><lex-btn id="b" label="Ignored">Kept</lex-btn>');
    await tick(window);
    expect(window.document.querySelector('#a button').textContent.trim()).toBe('Save');
    expect(window.document.querySelector('#b button').textContent.trim()).toBe('Kept');
    const a = window.document.getElementById('a');
    a.label = 'Saving';
    await tick(window);
    expect(a.querySelector('button').textContent.trim()).toBe('Saving');
  });

  test('label escapes markup', async () => {
    const window = boot(['btn']);
    const btn = window.document.createElement('lex-btn');
    btn.label = '<img src=x>';
    window.document.body.appendChild(btn);
    await tick(window);
    expect(btn.querySelector('img')).toBeNull();
    expect(btn.querySelector('button').textContent.trim()).toBe('<img src=x>');
  });
});

describe('lex-form submit', () => {
  const markup = '<lex-form id="f"><lex-input name="n"></lex-input><lex-btn id="inside" type="submit">In</lex-btn></lex-form>' +
    '<div><lex-btn id="outside" type="submit" form="f">Out</lex-btn><lex-btn id="other" type="submit" form="g">Other</lex-btn></div>';

  test('an external <lex-btn type="submit" form="id"> submits the lex-form once', async () => {
    const window = boot(['btn', 'form'], markup);
    await tick(window);
    const form = window.document.getElementById('f');
    const submits = [];
    form.addEventListener('lex-submit', (e) => submits.push(e.detail));
    click(window, window.document.querySelector('#outside button'));
    expect(submits.length).toBe(1);
    click(window, window.document.querySelector('#other button'));
    expect(submits.length).toBe(1);
    click(window, window.document.querySelector('#inside button'));
    expect(submits.length).toBe(2);
  });

  test('a disabled external button does not submit', async () => {
    const window = boot(['btn', 'form'], markup);
    await tick(window);
    const form = window.document.getElementById('f');
    const submits = [];
    form.addEventListener('lex-submit', () => submits.push(1));
    const outside = window.document.getElementById('outside');
    outside.disabled = true;
    await tick(window);
    click(window, outside.querySelector('button'));
    expect(submits.length).toBe(0);
  });

  test('requestSubmit() validates and emits lex-submit', async () => {
    const window = boot(['btn', 'form'], markup);
    await tick(window);
    const form = window.document.getElementById('f');
    const submits = [];
    form.addEventListener('lex-submit', (e) => submits.push(e.detail));
    form.requestSubmit();
    expect(submits.length).toBe(1);
    expect(submits[0].valid).toBe(true);
  });

  test('submit handling survives a re-render of the lex-form', async () => {
    const window = boot(['btn', 'form'], markup);
    await tick(window);
    const form = window.document.getElementById('f');
    form.novalidate = true;
    await tick(window);
    const submits = [];
    form.addEventListener('lex-submit', () => submits.push(1));
    click(window, window.document.querySelector('#inside button'));
    expect(submits.length).toBe(1);
  });
});

// ── lex-dropdown-btn ──────────────────────────────────────────────────────

describe('lex-dropdown-btn', () => {
  const items = [
    { label: 'Settings', href: 'settings-v2.html', icon: 'settings' },
    { label: 'Bad', href: 'javascript:alert(1)' },
    { divider: true },
    { value: 'off', label: 'Disabled', disabled: true },
    { value: 'logout', label: 'Log out', variant: 'danger' }
  ];

  function mount(window, attrs) {
    const el = window.document.createElement('lex-dropdown-btn');
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    el.options = items;
    window.document.body.appendChild(el);
    return el;
  }

  test('icon-only trigger, aria-label, end alignment, links, separators, danger and aria roles', async () => {
    const window = boot(['dropdown']);
    const el = mount(window, { 'icon-only': '', 'aria-label': 'Account menu', align: 'end', icon: 'settings' });
    await tick(window);
    const trigger = el.querySelector('[data-action="toggle"]');
    expect(trigger.getAttribute('aria-label')).toBe('Account menu');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.textContent.trim()).toBe('');
    expect(trigger.querySelector('.lex-ddbtn-chevron')).toBeNull();
    const menu = el.querySelector('.lex-ddbtn-dropdown');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.classList.contains('lex-ddbtn-dropdown--end')).toBe(true);
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    const link = el.querySelector('a.lex-ddbtn-item');
    expect(link.getAttribute('href')).toBe('settings-v2.html');
    expect(link.getAttribute('role')).toBe('menuitem');
    expect(el.querySelectorAll('a.lex-ddbtn-item').length).toBe(1);
    expect(el.querySelectorAll('[role="separator"]').length).toBe(1);
    expect(el.querySelector('[data-value="logout"]').classList.contains('lex-ddbtn-item--danger')).toBe(true);
    expect(el.querySelector('[data-value="off"]').getAttribute('aria-disabled')).toBe('true');
  });

  test('keyboard: open on ArrowDown, arrows skip separators and disabled items, Escape closes to the trigger', async () => {
    const window = boot(['dropdown']);
    const el = mount(window);
    await tick(window);
    key(window, el.querySelector('[data-action="toggle"]'), 'ArrowDown');
    await tick(window);
    expect(el.querySelector('.lex-ddbtn-dropdown--open')).not.toBeNull();
    expect(el.querySelector('[data-action="toggle"]').getAttribute('aria-expanded')).toBe('true');
    expect(window.document.activeElement.textContent).toContain('Settings');
    key(window, window.document.activeElement, 'ArrowDown');
    await tick(window);
    expect(window.document.activeElement.textContent).toContain('Bad');
    key(window, window.document.activeElement, 'ArrowDown');
    await tick(window);
    expect(window.document.activeElement.dataset.value).toBe('logout');
    key(window, window.document.activeElement, 'Home');
    await tick(window);
    expect(window.document.activeElement.textContent).toContain('Settings');
    key(window, window.document.activeElement, 'End');
    await tick(window);
    expect(window.document.activeElement.dataset.value).toBe('logout');
    const events = [];
    el.addEventListener('lex-select', (e) => events.push(e.detail));
    key(window, window.document.activeElement, 'Escape');
    await tick(window);
    expect(el.querySelector('.lex-ddbtn-dropdown--open')).toBeNull();
    expect(window.document.activeElement).toBe(el.querySelector('[data-action="toggle"]'));
    expect(events.length).toBe(0);
  });

  test('existing API: clicking an option emits lex-select { value, label, item }; disabled items do nothing', async () => {
    const window = boot(['dropdown'], '<lex-dropdown-btn button-label="Actions" options=\'[{"value":"edit","label":"Edit"},{"value":"del","label":"Delete"}]\'></lex-dropdown-btn>');
    await tick(window);
    const el = window.document.querySelector('lex-dropdown-btn');
    const trigger = el.querySelector('[data-action="toggle"]');
    expect(trigger.textContent.trim()).toBe('Actions');
    expect(trigger.hasAttribute('aria-label')).toBe(false);
    click(window, trigger);
    await tick(window);
    const events = [];
    el.addEventListener('lex-select', (e) => events.push(e.detail));
    click(window, el.querySelector('[data-value="del"]'));
    expect(events.length).toBe(1);
    expect(events[0].value).toBe('del');
    expect(events[0].label).toBe('Delete');
    expect(events[0].item).toEqual({ value: 'del', label: 'Delete' });

    el.options = items;
    await tick(window);
    click(window, el.querySelector('[data-value="off"]'));
    expect(events.length).toBe(1);
  });
});

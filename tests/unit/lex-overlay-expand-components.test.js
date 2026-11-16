'use strict';

/**
 * lex-modal and lex-drawer render an expand toggle directly left of the close
 * button. It toggles the expanded class and aria-pressed; confirm/alert/prompt
 * dialogs and expandable="false" overlays have none; Escape still closes.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');

function boot(html) {
  const dom = new JSDOM(`<!doctype html><body>${html || ''}</body>`, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  // JSDOM has no layout, so offsetParent is always null and FocusTrap finds
  // nothing focusable. Treat every connected element as laid out.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.isConnected ? this.parentNode : null; }
  });
  window.eval(read('lex/lex.core.js'));
  window.eval(read('lex/components/foundation/lex-modal.js'));
  window.eval(read('lex/components/foundation/lex-drawer.js'));
  return window;
}

const tick = (window) => new Promise((resolve) => window.setTimeout(resolve, 20));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

describe('lex-modal expand toggle', () => {
  test('renders left of close and toggles the expanded class', async () => {
    const window = boot();
    const modal = window.Lex.Modal.open({ heading: 'Edit', content: '<p>Body</p>' });
    await tick(window);
    const close = modal.querySelector('.lex-modal-close');
    const expand = modal.querySelector('[data-action="expand"]');
    expect(expand).not.toBeNull();
    expect(close.previousElementSibling).toBe(expand);
    expect(expand.getAttribute('aria-pressed')).toBe('false');
    expect(expand.getAttribute('aria-label')).toBe('Expand');

    const panel = modal.querySelector('.lex-modal-panel');
    click(window, expand);
    expect(panel.classList.contains('lex-modal-panel--expanded')).toBe(true);
    expect(expand.getAttribute('aria-pressed')).toBe('true');
    expect(expand.getAttribute('aria-label')).toBe('Collapse');
    expect(modal.expanded).toBe(true);

    click(window, expand);
    expect(panel.classList.contains('lex-modal-panel--expanded')).toBe(false);
    expect(modal.expanded).toBe(false);
  });

  test('header actions stay left of the toggle', async () => {
    const window = boot();
    const modal = window.Lex.Modal.open({ heading: 'Edit', content: '<p>x</p>' });
    await tick(window);
    modal.setHeaderActions('<button class="mine">A</button>');
    const actions = modal.querySelector('.lex-modal-header-actions');
    expect(actions.nextElementSibling).toBe(modal.querySelector('[data-action="expand"]'));
  });

  test('confirm, alert and prompt dialogs have no toggle', async () => {
    const window = boot();
    window.Lex.Modal.confirm('Delete', 'Sure?', () => {});
    window.Lex.Modal.alert('Saved', 'Done');
    window.Lex.Modal.prompt('Rename', {});
    await tick(window);
    const modals = window.document.querySelectorAll('lex-modal');
    expect(modals).toHaveLength(3);
    modals.forEach((m) => expect(m.querySelector('[data-action="expand"]')).toBeNull());
  });

  test('expandable="false" and Lex.Modal.open({ expandable: false }) opt out', async () => {
    const window = boot('<lex-modal id="m1" heading="Hi" expandable="false"><p>x</p></lex-modal>');
    const opened = window.Lex.Modal.open({ heading: 'No', expandable: false });
    await tick(window);
    expect(window.document.getElementById('m1').querySelector('[data-action="expand"]')).toBeNull();
    expect(opened.querySelector('[data-action="expand"]')).toBeNull();
  });

  test('Escape still closes an expanded modal', async () => {
    const window = boot();
    const modal = window.Lex.Modal.open({ heading: 'Edit', content: '<p>x</p>' });
    await tick(window);
    click(window, modal.querySelector('[data-action="expand"]'));
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.open).toBe(false);
  });

  test('remembers the expanded state per modal id for the session', async () => {
    const window = boot('<lex-modal id="remembered" heading="Hi"><p>x</p></lex-modal>');
    const modal = window.document.getElementById('remembered');
    modal.open = true;
    await tick(window);
    click(window, modal.querySelector('[data-action="expand"]'));
    modal.remove();

    const again = window.document.createElement('lex-modal');
    again.id = 'remembered';
    again.heading = 'Hi';
    window.document.body.appendChild(again);
    again.open = true;
    await tick(window);
    expect(again.expanded).toBe(true);
    expect(again.querySelector('.lex-modal-panel').classList.contains('lex-modal-panel--expanded')).toBe(true);
  });
});

describe('lex-modal expand event, focus and small size', () => {
  test('emits lex-expand-change with detail.expanded', async () => {
    const window = boot();
    const modal = window.Lex.Modal.open({ heading: 'Edit', content: '<p>x</p>' });
    await tick(window);
    const seen = [];
    modal.addEventListener('lex-expand-change', (e) => seen.push(e.detail.expanded));
    click(window, modal.querySelector('[data-action="expand"]'));
    click(window, modal.querySelector('[data-action="expand"]'));
    expect(seen).toEqual([true, false]);
  });

  test('initial focus goes to Close, not Expand', async () => {
    const window = boot();
    const modal = window.Lex.Modal.open({ heading: 'Edit', content: '<p>x</p>' });
    await tick(window);
    expect(window.document.activeElement).toBe(modal.querySelector('.lex-modal-close'));
  });

  test('size sm modals have no toggle', async () => {
    const window = boot('<lex-modal id="small" heading="QR" size="sm" hide-close><p>x</p></lex-modal>');
    const opened = window.Lex.Modal.open({ heading: 'Small', size: 'sm' });
    await tick(window);
    expect(window.document.getElementById('small').querySelector('[data-action="expand"]')).toBeNull();
    expect(opened.querySelector('[data-action="expand"]')).toBeNull();
  });
});

describe('lex-drawer expand toggle', () => {
  test('renders left of close, after header actions, and toggles the expanded class', async () => {
    const window = boot();
    const drawer = window.Lex.Drawer.open({ heading: 'Task', content: '<p>Long description</p>' });
    await tick(window);
    drawer.setHeaderActions([{ html: '<button class="actions">Actions</button>' }]);
    const close = drawer.querySelector('.lex-drawer-close[data-action="close"]');
    const expand = drawer.querySelector('[data-action="expand"]');
    expect(expand).not.toBeNull();
    expect(close.previousElementSibling).toBe(expand);
    expect(expand.previousElementSibling.classList.contains('lex-drawer-header-actions')).toBe(true);

    const panel = drawer.querySelector('.lex-drawer-panel');
    click(window, expand);
    expect(panel.classList.contains('lex-drawer-panel--expanded')).toBe(true);
    expect(expand.getAttribute('aria-pressed')).toBe('true');
    click(window, expand);
    expect(panel.classList.contains('lex-drawer-panel--expanded')).toBe(false);
    expect(expand.getAttribute('aria-pressed')).toBe('false');
  });

  test('expandable="false" and full width drawers have no toggle', async () => {
    const window = boot('<lex-drawer id="d1" heading="Hi" expandable="false" open><p>x</p></lex-drawer>');
    const full = window.Lex.Drawer.open({ heading: 'Full', width: 'full' });
    const optOut = window.Lex.Drawer.open({ heading: 'No', expandable: false });
    await tick(window);
    expect(window.document.getElementById('d1').querySelector('[data-action="expand"]')).toBeNull();
    expect(full.querySelector('[data-action="expand"]')).toBeNull();
    expect(optOut.querySelector('[data-action="expand"]')).toBeNull();
  });

  test('emits lex-expand-change with detail.expanded', async () => {
    const window = boot();
    const drawer = window.Lex.Drawer.open({ heading: 'Task' });
    await tick(window);
    const seen = [];
    drawer.addEventListener('lex-expand-change', (e) => seen.push(e.detail.expanded));
    click(window, drawer.querySelector('[data-action="expand"]'));
    click(window, drawer.querySelector('[data-action="expand"]'));
    expect(seen).toEqual([true, false]);
  });

  test('initial focus goes to Close, not Expand', async () => {
    const window = boot();
    const drawer = window.Lex.Drawer.open({ heading: 'Task', content: '<p>x</p>' });
    await tick(window);
    expect(window.document.activeElement).toBe(drawer.querySelector('[data-action="close"]'));
  });

  test('remembers the expanded state per drawer id for the session', async () => {
    const window = boot('<lex-drawer id="taskDrawer" heading="Task"><p>x</p></lex-drawer>');
    const drawer = window.document.getElementById('taskDrawer');
    drawer.open = true;
    await tick(window);
    click(window, drawer.querySelector('[data-action="expand"]'));
    drawer.remove();

    const again = window.document.createElement('lex-drawer');
    again.id = 'taskDrawer';
    again.heading = 'Task';
    window.document.body.appendChild(again);
    again.open = true;
    await tick(window);
    expect(again.expanded).toBe(true);
    expect(again.querySelector('.lex-drawer-panel').classList.contains('lex-drawer-panel--expanded')).toBe(true);
    expect(again.querySelector('[data-action="expand"]').getAttribute('aria-pressed')).toBe('true');
  });

  test('Escape still closes an expanded drawer', async () => {
    const window = boot();
    const drawer = window.Lex.Drawer.open({ heading: 'Task' });
    await tick(window);
    click(window, drawer.querySelector('[data-action="expand"]'));
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(drawer.isConnected).toBe(false);
  });
});

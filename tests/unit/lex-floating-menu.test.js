'use strict';

/**
 * lex-dropdown-btn `floating` mode, Lex.Floating positioning and the
 * Lex.Menu.openAt caret/rect menu API (docs/TABLE-STANDARD.md section 14).
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (w) => new Promise((r) => w.setTimeout(r, 30));

function makeWindow() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  ['lex/lex.core.js', 'lex/lex.icons.js', 'lex/components/foundation/lex-modal.js', 'lex/components/form/lex-dropdown-btn.js']
    .forEach((rel) => { try { w.eval(read(rel)); } catch (e) { if (!rel.includes('icons')) throw e; } });
  return w;
}

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

// Stub layout: the trigger at triggerRect, every menu box menuSize.
function stubLayout(w, triggerRect, menuSize) {
  const proto = w.HTMLElement.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (this.matches && this.matches('.lex-ddbtn-trigger')) return triggerRect();
    if (this.matches && this.matches('.lex-ddbtn-dropdown, .lex-menu')) return rect(0, 0, menuSize.width, menuSize.height);
    return origRect.call(this);
  };
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return this.matches && this.matches('.lex-ddbtn-dropdown, .lex-menu') ? menuSize.width : 0; } });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() { return this.matches && this.matches('.lex-ddbtn-dropdown, .lex-menu') ? menuSize.height : 0; } });
}

describe('Lex.Floating.compute', () => {
  const w = makeWindow();
  const compute = w.Lex.Floating.compute;
  const vp = { width: 1000, height: 800 };

  test('opens below the anchor, aligned to its start edge', () => {
    expect(compute(rect(100, 100, 40, 30), { width: 200, height: 150 }, vp, {}))
      .toEqual({ top: 134, left: 100, placement: 'bottom', maxHeight: null });
  });

  test('align end lines the right edges up', () => {
    const pos = compute(rect(700, 100, 40, 30), { width: 200, height: 150 }, vp, { align: 'end' });
    expect(pos.left).toBe(540);
  });

  test('align center centres on the anchor', () => {
    expect(compute(rect(400, 100, 100, 20), { width: 200, height: 50 }, vp, { align: 'center' }).left).toBe(350);
  });

  test('flips above when there is no room below', () => {
    const pos = compute(rect(100, 700, 40, 30), { width: 200, height: 150 }, vp, {});
    expect(pos.placement).toBe('top');
    expect(pos.top).toBe(700 - 4 - 150);
    expect(pos.maxHeight).toBeNull();
  });

  test('stays below when neither side fits but below has more room, capping the height', () => {
    const pos = compute(rect(100, 100, 40, 30), { width: 200, height: 900 }, vp, {});
    expect(pos.placement).toBe('bottom');
    expect(pos.maxHeight).toBe(800 - 8 - 134);
  });

  test('clamps inside the viewport horizontally', () => {
    expect(compute(rect(950, 100, 40, 30), { width: 200, height: 50 }, vp, {}).left).toBe(1000 - 200 - 8);
    expect(compute(rect(20, 100, 40, 30), { width: 200, height: 50 }, vp, { align: 'end' }).left).toBe(8);
  });

  test('accepts a caret rect without right/bottom', () => {
    const pos = compute({ left: 300, top: 200, width: 0, height: 18 }, { width: 100, height: 50 }, vp, { gap: 8 });
    expect(pos).toEqual({ top: 226, left: 300, placement: 'bottom', maxHeight: null });
  });
});

describe('lex-dropdown-btn floating', () => {
  async function setup(attrs, triggerAt) {
    const w = makeWindow();
    let trig = triggerAt || rect(100, 100, 32, 32);
    stubLayout(w, () => trig, { width: 180, height: 120 });
    const host = w.document.createElement('div');
    host.style.overflow = 'hidden';
    host.innerHTML = `<lex-dropdown-btn id="dd" icon-only aria-label="Row actions" ${attrs || ''}></lex-dropdown-btn>`;
    w.document.body.appendChild(host);
    const dd = host.querySelector('#dd');
    dd.options = [{ value: 'open', label: 'Open' }, { divider: true }, { value: 'delete', label: 'Delete', danger: true }];
    await tick(w);
    return { w, dd, host, moveTrigger: (r) => { trig = r; } };
  }
  const open = async (w, dd) => {
    dd.querySelector('[data-action="toggle"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await tick(w);
  };

  test('without floating the menu stays inside the element (backward compatible)', async () => {
    const { w, dd } = await setup('');
    await open(w, dd);
    expect(dd.querySelector('.lex-ddbtn-dropdown--open')).not.toBeNull();
    expect(w.document.querySelector('.lex-ddbtn-layer')).toBeNull();
  });

  test('the open menu moves to a body-level layer, below the trigger, and aria-controls points at it', async () => {
    const { w, dd, host } = await setup('floating');
    await open(w, dd);
    const layer = w.document.querySelector('.lex-ddbtn-layer');
    expect(layer).not.toBeNull();
    expect(layer.parentNode).toBe(w.document.body);
    expect(host.contains(layer)).toBe(false);
    const menu = layer.querySelector('.lex-ddbtn-dropdown');
    expect(menu.classList.contains('lex-ddbtn-dropdown--floating')).toBe(true);
    const trigger = dd.querySelector('[data-action="toggle"]');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(w.document.getElementById(trigger.getAttribute('aria-controls'))).toBe(menu);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.style.top).toBe('136px');
    expect(menu.style.left).toBe('100px');
    expect(menu.getAttribute('data-placement')).toBe('bottom');
  });

  test('align="end" and flip above near the bottom of the viewport', async () => {
    const { w, dd } = await setup('floating align="end"', rect(500, 720, 32, 32));
    await open(w, dd);
    const menu = w.document.querySelector('.lex-ddbtn-layer .lex-ddbtn-dropdown');
    expect(menu.style.left).toBe((532 - 180) + 'px');
    expect(menu.getAttribute('data-placement')).toBe('top');
    expect(menu.style.top).toBe((720 - 4 - 120) + 'px');
  });

  test('repositions on a capture-phase scroll of any ancestor', async () => {
    const { w, dd, host, moveTrigger } = await setup('floating');
    await open(w, dd);
    moveTrigger(rect(100, 300, 32, 32));
    host.dispatchEvent(new w.Event('scroll'));   // does not bubble: only a capture listener sees it
    const menu = w.document.querySelector('.lex-ddbtn-layer .lex-ddbtn-dropdown');
    expect(menu.style.top).toBe('336px');
  });

  test('clicking an item emits lex-select on the element and removes the layer', async () => {
    const { w, dd } = await setup('floating');
    const picked = [];
    dd.addEventListener('lex-select', (e) => picked.push(e.detail.value));
    await open(w, dd);
    w.document.querySelector('.lex-ddbtn-layer .lex-ddbtn-item[data-value="delete"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await tick(w);
    expect(picked).toEqual(['delete']);
    expect(dd._open).toBe(false);
    expect(w.document.querySelector('.lex-ddbtn-layer')).toBeNull();
  });

  test('a mousedown inside the floating menu keeps it open; outside closes it', async () => {
    const { w, dd } = await setup('floating');
    await open(w, dd);
    w.document.querySelector('.lex-ddbtn-layer .lex-ddbtn-item').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    await tick(w);
    expect(dd._open).toBe(true);
    w.document.body.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    await tick(w);
    expect(dd._open).toBe(false);
    expect(w.document.querySelector('.lex-ddbtn-layer')).toBeNull();
  });

  test('keyboard: ArrowDown opens and focuses items in the layer, skipping separators; Escape returns focus', async () => {
    const { w, dd } = await setup('floating');
    const trigger = dd.querySelector('[data-action="toggle"]');
    trigger.focus();
    trigger.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick(w);
    let focused = w.document.activeElement;
    expect(focused.dataset.value).toBe('open');
    expect(w.document.querySelector('.lex-ddbtn-layer').contains(focused)).toBe(true);
    focused.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick(w);
    focused = w.document.activeElement;
    expect(focused.dataset.value).toBe('delete');
    focused.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(w);
    expect(dd._open).toBe(false);
    expect(w.document.activeElement).toBe(dd.querySelector('[data-action="toggle"]'));
  });

  test('inside a lex-modal: Escape closes only the floating menu, which stacks above the modal', async () => {
    const w = makeWindow();
    stubLayout(w, () => rect(100, 100, 32, 32), { width: 180, height: 120 });
    const host = w.document.createElement('div');
    host.innerHTML = '<lex-modal id="m" heading="Edit"><lex-dropdown-btn id="dd" floating button-label="Actions"></lex-dropdown-btn></lex-modal>';
    w.document.body.appendChild(host);
    const modal = host.querySelector('#m');
    modal.open = true;
    await tick(w);
    const dd = host.querySelector('#dd');
    dd.options = [{ value: 'a', label: 'Archive' }];
    await tick(w);
    dd.querySelector('[data-action="toggle"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await tick(w);
    const layer = w.document.querySelector('.lex-ddbtn-layer');
    expect(layer).not.toBeNull();
    expect(modal.contains(layer)).toBe(false);
    const css = w.document.getElementById('lex-dropdown-btn-styles').textContent;
    expect(css).toMatch(/\.lex-ddbtn-dropdown--floating[\s\S]*z-index: var\(--lex-z-floating, 2000\)/);
    w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(w);
    expect(dd._open).toBe(false);
    expect(modal.open).toBe(true);
    expect(w.document.querySelector('.lex-ddbtn-layer')).toBeNull();
  });

  test('removing the element while open removes its layer and listeners', async () => {
    const { w, dd, host } = await setup('floating');
    await open(w, dd);
    host.remove();
    expect(w.document.querySelector('.lex-ddbtn-layer')).toBeNull();
    expect(dd._open).toBe(false);
    expect(dd._escapeWatcher).toBeNull();
  });

  test('searchable floating menu filters and Enter picks the highlighted item', async () => {
    const { w, dd } = await setup('floating searchable');
    const picked = [];
    dd.addEventListener('lex-select', (e) => picked.push(e.detail.value));
    await open(w, dd);
    const input = w.document.querySelector('.lex-ddbtn-layer .lex-ddbtn-search input');
    input.value = 'del';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    await tick(w);
    const input2 = w.document.querySelector('.lex-ddbtn-layer .lex-ddbtn-search input');
    expect(w.document.querySelectorAll('.lex-ddbtn-layer .lex-ddbtn-item').length).toBe(1);
    input2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await tick(w);
    w.document.querySelector('.lex-ddbtn-layer .lex-ddbtn-search input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick(w);
    expect(picked).toEqual(['delete']);
  });
});

describe('Lex.Menu.openAt', () => {
  function setup(items, opts) {
    const w = makeWindow();
    stubLayout(w, () => rect(0, 0, 0, 0), { width: 240, height: 160 });
    const editor = w.document.createElement('div');
    editor.contentEditable = 'true';
    w.document.body.appendChild(editor);
    const calls = { selected: [], closed: [], active: [] };
    const menu = w.Lex.Menu.openAt(rect(300, 200, 0, 18), items, Object.assign({
      owner: editor,
      onSelect: (item) => calls.selected.push(item.value),
      onClose: (reason) => calls.closed.push(reason),
      onActiveChange: (i) => calls.active.push(i)
    }, opts || {}));
    return { w, menu, editor, calls };
  }
  const items = [
    { value: 'client', label: 'Client', meta: 'client' },
    { divider: true },
    { value: 'matter', label: 'Matter', meta: 'matter', disabled: true },
    { value: 'date', label: 'Date', meta: 'date' }
  ];
  const key = (w, k) => new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

  test('renders at body level below the rect, with listbox/option roles and the owner wired', () => {
    const { w, menu, editor } = setup(items, { heading: 'Template variables', hint: '#{{entity:property_key}}' });
    const el = menu.element;
    expect(el.parentNode).toBe(w.document.body);
    expect(el.style.top).toBe('222px');
    expect(el.style.left).toBe('300px');
    expect(el.querySelector('.lex-menu-title strong').textContent).toBe('Template variables');
    expect(el.querySelectorAll('[role="option"]').length).toBe(3);
    expect(el.querySelector('[role="listbox"]').id).toBe(editor.getAttribute('aria-controls'));
    expect(editor.getAttribute('aria-expanded')).toBe('true');
    expect(editor.getAttribute('aria-activedescendant')).toBe(el.querySelector('.lex-menu-item--active').id);
    expect(el.querySelector('.lex-menu-item--active .lex-menu-item-meta').textContent).toBe('client');
  });

  test('host-driven keys: arrows skip dividers and disabled items and wrap; Enter selects', () => {
    const { w, menu, calls } = setup(items);
    expect(menu.activeIndex).toBe(0);
    expect(menu.handleKey(key(w, 'ArrowDown'))).toBe(true);
    expect(menu.activeIndex).toBe(3);
    menu.handleKey(key(w, 'ArrowDown'));
    expect(menu.activeIndex).toBe(0);
    menu.handleKey(key(w, 'ArrowUp'));
    expect(menu.activeIndex).toBe(3);
    expect(calls.active).toEqual([3, 0, 3]);
    expect(menu.handleKey(key(w, 'Enter'))).toBe(true);
    expect(calls.selected).toEqual(['date']);
    expect(menu.open).toBe(true);           // the host decides when to close
    expect(menu.handleKey(key(w, 'a'))).toBe(false);
    expect(menu.handleKey(key(w, 'Tab'))).toBe(false);
  });

  test('tabSelects makes Tab pick like Enter; with no matches keys pass through', () => {
    const { w, menu, calls } = setup(items, { tabSelects: true });
    expect(menu.handleKey(key(w, 'Tab'))).toBe(true);
    expect(calls.selected).toEqual(['client']);
    menu.update([], { emptyText: 'No matching fields' });
    expect(menu.element.querySelector('.lex-menu-empty').textContent).toBe('No matching fields');
    expect(menu.handleKey(key(w, 'Enter'))).toBe(false);
    expect(menu.handleKey(key(w, 'ArrowDown'))).toBe(false);
  });

  test('update() filters as the user types and keeps or resets the highlight', () => {
    const { menu } = setup(items);
    menu.setActive(3);
    menu.update(items.filter((i) => !i.divider && i.value !== 'client'));
    expect(menu.items.map((i) => i.value)).toEqual(['matter', 'date']);
    expect(menu.activeIndex).toBe(1);
    menu.update(null, { activeIndex: 0 });
    expect(menu.activeIndex).toBe(1);       // index 0 is disabled: next actionable
  });

  test('clicking an option selects it; mousedown inside keeps focus in the host', () => {
    const { w, menu, calls } = setup(items);
    const row = menu.element.querySelector('[data-idx="3"]');
    const down = new w.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    row.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(calls.selected).toEqual(['date']);
    menu.element.querySelector('[data-idx="2"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(calls.selected).toEqual(['date']); // disabled
  });

  test('Escape (capture phase) and outside mousedown close it, cleaning up', () => {
    const a = setup(items);
    a.editor.dispatchEvent(key(a.w, 'Escape'));
    expect(a.calls.closed).toEqual(['escape']);
    expect(a.menu.open).toBe(false);
    expect(a.w.document.querySelector('.lex-menu')).toBeNull();
    expect(a.editor.getAttribute('aria-expanded')).toBe('false');
    expect(a.editor.hasAttribute('aria-activedescendant')).toBe(false);

    const b = setup(items, { ignoreOutside: (t) => t.classList && t.classList.contains('keep') });
    const keep = b.w.document.createElement('button');
    keep.className = 'keep';
    b.w.document.body.appendChild(keep);
    keep.dispatchEvent(new b.w.MouseEvent('mousedown', { bubbles: true }));
    expect(b.menu.open).toBe(true);
    b.editor.dispatchEvent(new b.w.MouseEvent('mousedown', { bubbles: true }));
    expect(b.calls.closed).toEqual(['outside']);
    b.menu.close();
    expect(b.calls.closed).toEqual(['outside']); // closing twice is a no-op
  });

  test('search box and back button call the host; the input survives updates', () => {
    const typed = [];
    let backs = 0;
    const { w, menu } = setup(items, {
      search: { value: '', placeholder: 'Search entities...', onInput: (v) => typed.push(v) },
      onBack: () => { backs += 1; }
    });
    const input = menu.element.querySelector('.lex-menu-search');
    expect(input.placeholder).toBe('Search entities...');
    input.value = 'da';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(typed).toEqual(['da']);
    menu.update([items[3]], { search: { value: 'da', placeholder: 'Search entities...', onInput: (v) => typed.push(v) } });
    expect(menu.element.querySelector('.lex-menu-search')).toBe(input);
    const down = key(w, 'ArrowDown');
    input.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    menu.element.querySelector('[data-lex-menu-back]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(backs).toBe(1);
  });

  test('an anchor function is re-read on scroll', () => {
    const w = makeWindow();
    stubLayout(w, () => rect(0, 0, 0, 0), { width: 240, height: 160 });
    let at = rect(300, 200, 0, 18);
    const menu = w.Lex.Menu.openAt(() => at, items, {});
    expect(menu.element.style.top).toBe('222px');
    at = rect(300, 100, 0, 18);
    w.document.body.dispatchEvent(new w.Event('scroll'));
    expect(menu.element.style.top).toBe('122px');
    menu.close();
  });
});

describe('menus inside clipping containers use floating', () => {
  const src = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

  test('row/card kebabs, drawer and modal header menus set floating', () => {
    expect(src('js/drive.js')).toMatch(/icon-only variant="ghost" align="end" floating aria-label="Folder actions"/);
    expect(src('js/folder.js')).toMatch(/icon-only variant="ghost" align="end" floating aria-label="Folder actions"/);
    expect(src('js/workspace.js')).toMatch(/class="matter-options-menu[\s\S]{0,200}align="end" floating'/);
    expect(src('js/components/matter-documents-view.js')).toContain('<lex-dropdown-btn class="mdv-kebab-menu" icon="more-vertical" icon-only variant="ghost" align="end" floating');
    const dash = src('js/dashboard/dashboard.js');
    expect(dash).toMatch(/cc-task-status-pill[\s\S]{0,300}variant="ghost" align="end" floating/);
    expect(dash).toContain('data-task-actions-menu button-label="Actions" align="end" floating');
    expect(src('js/pages/my-tasks.js')).toContain('data-task-actions-menu button-label="Actions" align="end" floating');
    const matters = src('matters.html');
    expect(matters).toMatch(/id="drawerOptionsMenu"[^>]*floating/);
    expect(matters).toMatch(/class="matter-card-options"[\s\S]{0,300}floating onclick/);
  });

  test('the drive.css clipping workaround is gone', () => {
    expect(src('css/drive.css')).not.toContain('lex-ddbtn-dropdown--open');
  });

  test('connector-viewer topbar switcher is a floating lex-dropdown-btn that navigates on pick', () => {
    const html = src('integrations/connector-viewer.html');
    expect(html).toContain('<script src="../js/lex/components/form/lex-dropdown-btn.js"></script>');
    expect(html).toMatch(/<lex-dropdown-btn id="connectorSwitcher" class="connector-switcher-menu" floating/);
    expect(html).toContain('menu.buttonLabel = triggerLabel;');
    expect(html).toContain('menu.options = connectorSwitcherItems(selectedKey);');
    expect(html).toContain('window.location.href = buildConnectorViewerUrl(connector);');
    expect(html).not.toContain('connectorSwitcherPanel');
    expect(html).not.toContain('connector-switcher-option');
    const pages = src('js/lex/lex-router.pages.js');
    const block = pages.slice(pages.indexOf("'integrations/connector-viewer.html'"), pages.indexOf("'integrations/connector-crm.html'"));
    expect(block).toContain('js/lex/components/form/lex-dropdown-btn.js');
  });

  test('file editor loads lex-dropdown-btn (Lex.Menu) in both entry paths', () => {
    expect(src('file-editor.html')).toContain('<script src="js/lex/components/form/lex-dropdown-btn.js"></script>');
    const pages = src('js/lex/lex-router.pages.js');
    const block = pages.slice(pages.indexOf("'file-editor.html'"), pages.indexOf("'file-editor.html'") + 800);
    expect(block).toContain('js/lex/components/form/lex-dropdown-btn.js');
  });
});

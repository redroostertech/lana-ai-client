'use strict';

/**
 * Admin Plugins (Installed tab) and Task Plans on the table standard
 * (docs/TABLE-STANDARD.md): raw rows, renderers, header filters, the task
 * plan cursor walk, and the page markup.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });

function loadPage(rel, extra) {
  const win = { localStorage: { getItem: () => STORED_USER }, Intl, Date };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  win.Lex.Nav = { getParams: () => new URLSearchParams(''), go: () => {} };
  win.Lex.Toast = { error: () => {}, success: () => {} };

  const document = {
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null,
    createTextNode: (t) => ({ textContent: String(t) })
  };
  const api = new Proxy({}, { get: () => () => new Promise(() => {}) });
  const context = Object.assign({
    window: win,
    document,
    Lex: win.Lex,
    LanaTime: win.LanaTime,
    api,
    URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout
  }, extra || {});
  win.document = document;
  win.api = context.api;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return win;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

describe('Installed plugins table', () => {
  const win = loadPage('js/admin/admin-plugins.js');
  const t = win.AdminPluginsTable;

  test('rows keep raw values and the record', () => {
    const rec = { id: 7, name: 'docusign', version: '1.2.0', status: 'ACTIVE', created_at: '2026-01-20T20:16:00Z', updated_at: '2026-02-01T10:00:00Z' };
    const row = t.mapPlugin(rec);
    expect(row).toMatchObject({ id: '7', name: 'docusign', version: '1.2.0', status: 'active', created_at: '2026-01-20T20:16:00Z' });
    expect(row._raw).toBe(rec);
  });

  test('renderers: badge status, Created date-time, row actions as buttons', () => {
    const r = t.cellRenderers();
    const row = t.mapPlugin({ id: 'p1', name: 'x', version: '2', status: 'active' });
    expect(r.status('active')).toBe('<lex-badge label="Active" color="green" size="sm"></lex-badge>');
    expect(r.status('disabled')).toContain('label="Disabled"');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.created_at('')).toContain('—');
    expect(r.version('2')).toContain('v2');
    const actions = r.actions('', row);
    expect(actions).toContain('data-plugin-action="stop"');
    expect(actions).not.toContain('data-plugin-action="start"');
    expect(actions).toContain('data-plugin-action="restart"');
    expect(actions).toContain('data-plugin-action="uninstall"');
    expect(r.actions('', Object.assign({}, row, { status: 'disabled' }))).toContain('data-plugin-action="start"');
  });

  test('every column but actions has a filter with capitalised labels', () => {
    const rows = [t.mapPlugin({ id: 1, name: 'a', version: '1.0', status: 'error' })];
    const map = t.filterOptions(rows);
    expect(Object.keys(map).sort()).toEqual(['created_at', 'name', 'status', 'updated_at', 'version']);
    expect(map.name.text).toBe(true);
    expect(plain(map.status.options)).toEqual([
      { value: 'active', label: 'Active' },
      { value: 'installed', label: 'Installed' },
      { value: 'disabled', label: 'Disabled' },
      { value: 'error', label: 'Error' }
    ]);
    expect(plain(map.version.options)).toEqual([{ value: '1.0', label: 'v1.0' }]);
    expect(map.created_at.single).toBe(true);
    expect(map.created_at.match(new Date().toISOString(), ['today'])).toBe(true);
    expect(map.created_at.match('2020-01-01T00:00:00Z', ['today'])).toBe(false);
  });

  test('marketplace cards escape plugin text', () => {
    const html = t.marketplaceCard({ name: '<b>x</b>', description: 'd', version: '1', installed: false });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('data-install-name="&lt;b&gt;x&lt;/b&gt;"');
  });
});

describe('Task plans table', () => {
  const win = loadPage('js/admin/task-plans.js');
  const t = win.TaskPlansTable;

  test('rows keep raw values: status, type, workspace, items, assigned', () => {
    const rec = {
      id: 'tp1', title: 'Onboarding', status: 'Draft', source_type: 'lana_draft', item_count: '4',
      metadata: { source_matter_id: 'm-1', target: { type: 'user', user_id: 'u-9' } },
      created_at: '2026-01-20T20:16:00Z', updated_at: '2026-01-21T20:16:00Z'
    };
    const row = t.mapPlan(rec);
    expect(row).toMatchObject({
      id: 'tp1', title: 'Onboarding', status: 'draft', source_type: 'lana_draft', workspace: 'm-1',
      item_count: 4, assigned: 'u-9', created_at: '2026-01-20T20:16:00Z'
    });
    expect(row._raw).toBe(rec);
    expect(t.mapPlan({ id: 'x', metadata: { target: { type: 'organization' } } }).assigned).toBe('organization');
    expect(t.mapPlan({ id: 'y', items: [{}, {}] })).toMatchObject({ assigned: 'unassigned', item_count: 2, title: 'Untitled plan' });
  });

  test('renderers: status badge, workspace link, Created date-time, labels', () => {
    const r = t.cellRenderers();
    expect(r.status('published')).toBe('<lex-badge label="Published" color="green" size="sm"></lex-badge>');
    expect(r.status('in_review')).toContain('label="In review"');
    expect(r.workspace('m-1')).toContain('data-matter-id="m-1"');
    expect(r.workspace('')).toContain('—');
    expect(r.source_type('lana_draft')).toContain('Lana draft');
    expect(r.source_type('heartbeat_alert')).toContain('Heartbeat alert');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.assigned('organization')).toContain('Entire organization');
    expect(r.assigned('unassigned')).toContain('Unassigned');
  });

  test('every column has a filter; item count ranges match', () => {
    const rows = [t.mapPlan({ id: 'a', status: 'draft', source_type: 'alert', metadata: { source_matter_id: 'm-2' } })];
    const map = t.filterOptions(rows);
    expect(Object.keys(map).sort()).toEqual(['assigned', 'created_at', 'item_count', 'source_type', 'status', 'title', 'updated_at', 'workspace']);
    expect(plain(map.source_type.options)).toEqual([
      { value: 'manual', label: 'Manual' },
      { value: 'lana_draft', label: 'Lana draft' },
      { value: 'alert', label: 'Alert' }
    ]);
    expect(plain(map.status.options).map((o) => o.label)).toEqual(['Draft', 'Published', 'Archived']);
    expect(map.item_count.match(0, ['0'])).toBe(true);
    expect(map.item_count.match(5, ['1-5'])).toBe(true);
    expect(map.item_count.match(6, ['1-5'])).toBe(false);
    expect(map.item_count.match(40, ['21+'])).toBe(true);
    expect(map.updated_at.single).toBe(true);
  });

  test('fetchAllPlans walks the updated_at cursor until hasMore is false (no 50-row cap)', async () => {
    const calls = [];
    const pages = [
      { data: { task_plans: Array.from({ length: 100 }, (_, i) => ({ id: 'p' + i, updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 1000 - i)).toISOString() })), hasMore: true } },
      { data: { task_plans: [{ id: 'p99', updated_at: '2025-12-01T00:00:00.000Z' }, { id: 'last', updated_at: '2025-11-01T00:00:00.000Z' }], hasMore: false } }
    ];
    const api = { getTaskPlans: (params) => { calls.push(Object.assign({}, params)); return Promise.resolve(pages[calls.length - 1]); } };
    const w = loadPage('js/admin/task-plans.js', { api });
    const plans = await w.TaskPlansTable.fetchAllPlans();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ limit: 100 });
    expect(calls[1].limit).toBe(100);
    expect(calls[1].cursor).toBe(pages[0].data.task_plans[99].updated_at);
    expect(plans).toHaveLength(101); // p99 de-duplicated
  });
});

describe('Plugins and Task Plans markup', () => {
  const pages = {
    'admin/plugins.html': 'installedPluginsTable',
    'admin/task-plans.html': 'taskPlansTable'
  };

  test.each(Object.entries(pages))('%s: card table, column filters, toolbar, no native select or hand-built list', (page, id) => {
    const html = read(page);
    const tag = html.slice(html.indexOf('id="' + id + '"'), html.indexOf('</lex-table>', html.indexOf('id="' + id + '"')));
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('limit="20"');
    expect(tag).toContain('created_at');
    expect(tag).not.toMatch(/\bsearchable\b|\bfilterable\b|\bcompact\b/);
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<lex-pagination');
    expect(html).not.toMatch(/Created (At|On|Date)/);
    expect(html).toContain('js/admin/admin-table-kit.js');
    expect(html).toContain('js/shared/library-column-filters.js');
    expect(html).toMatch(/Sort by:/);
  });

  test('no window.confirm/alert/prompt or inline handlers on these pages', () => {
    ['js/admin/admin-plugins.js', 'js/admin/task-plans.js', 'admin/plugins.html', 'admin/task-plans.html'].forEach((file) => {
      const src = read(file);
      expect(src).not.toMatch(/window\.(confirm|alert|prompt)\(/);
      expect(src).not.toMatch(/\bonclick=/);
    });
    expect(read('admin/task-plans.html')).toContain('<lex-drawer id="taskPlanDrawer"');
    expect(read('js/admin/task-plans.js')).not.toContain('limit: 50');
  });
});

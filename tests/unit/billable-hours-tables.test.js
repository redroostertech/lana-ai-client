'use strict';

/**
 * Billable hours lists on the table standard (docs/TABLE-STANDARD.md):
 * admin By attorney / By matter / Approval queue and the workspace Time
 * entries table. Query mapping (whole-set paging), raw rows, renderers and
 * header filters.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York', role_name: 'user' });
const NOW = new Date('2026-10-20T15:30:00.000Z');

function baseWindow() {
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
  win.Lex.Toast = { error: () => {}, success: () => {}, info: () => {}, warning: () => {} };
  return win;
}

function loadScript(rel, apiGet) {
  const win = baseWindow();
  const document = { getElementById: () => null, addEventListener: () => {}, querySelector: () => null };
  const api = { user: null, get: apiGet || (() => new Promise(() => {})), post: () => new Promise(() => {}) };
  const context = {
    window: win, document, Lex: win.Lex, LanaTime: win.LanaTime, api,
    localStorage: win.localStorage, URLSearchParams, console, setTimeout, clearTimeout, Promise,
    encodeURIComponent, isFinite
  };
  win.document = document;
  win.api = api;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return win;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const query = (url) => Object.fromEntries(new URL(url, 'http://x').searchParams);

describe('Admin billable hours tables', () => {
  const win = loadScript('js/admin/billable-hours-reporting.js');
  const T = win.BillableHoursAdminTables;

  test('list URLs send the period and the largest page each API accepts (no limit=50 cap)', () => {
    const period = { from: '2026-10-01', to: '2026-10-20' };
    expect(T.listUrl('attorneys', 1, period).startsWith('/api/v1/billable-hours/admin/by-attorney?')).toBe(true);
    expect(query(T.listUrl('attorneys', 2, period))).toEqual({ page: '2', limit: '100', date_from: '2026-10-01', date_to: '2026-10-20' });
    expect(query(T.listUrl('matters', 1, {}))).toEqual({ page: '1', limit: '100' });
    expect(query(T.listUrl('approvals', 3, period)).limit).toBe('200');
  });

  test('fetchAll walks every page until the total is reached', async () => {
    const urls = [];
    const pages = { 1: 100, 2: 100, 3: 7 };
    const get = (url) => {
      urls.push(url);
      const page = Number(query(url).page);
      return Promise.resolve({ data: Array.from({ length: pages[page] }, (_, i) => ({ user_id: page + '-' + i })), pagination: { total: 207 } });
    };
    const rows = await T.fetchAll('attorneys', { from: '2026-10-01' }, get);
    expect(rows).toHaveLength(207);
    expect(urls.map((u) => query(u).page)).toEqual(['1', '2', '3']);
  });

  test('fetchAll stops after one short page', async () => {
    const get = jest.fn(() => Promise.resolve({ data: [{ id: 'a' }], pagination: { total: 1 } }));
    expect(await T.fetchAll('approvals', {}, get)).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('rows keep raw numbers and timestamps', () => {
    const a = T.attorneyRow({ user_id: 'u1', name: 'Ann Lee', email: 'ann@x.com', total_hours: 12.5, billable_hours: 10, billable_amount: 2500, draft_count: 2, submitted_count: 1, approved_count: 3 });
    expect(a).toMatchObject({ user_id: 'u1', name: 'Ann Lee', total_hours: 12.5, billable_hours: 10, billable_amount: 2500, submitted_count: 1, pending: 'yes', created_at: '' });
    const m = T.matterRow({ matter_id: 'MATT-1', matter_name: 'Smith v. Jones', client_name: 'Smith', attorneys: 2, total_hours: 4, billable_hours: 3, billable_amount: '900.5' });
    expect(m).toMatchObject({ matter_id: 'MATT-1', matter_name: 'Smith v. Jones', billable_amount: 900.5 });
    const q = T.approvalRow({ id: 'e1', first_name: 'Ann', last_name: 'Lee', matter_id: 'MATT-1', matter_name: 'Smith', duration_minutes: 90, activity_type: 'case_management', description: 'Call', start_time: '2026-10-19T14:00:00Z', created_at: '2026-10-19T15:00:00Z' });
    expect(q).toMatchObject({ id: 'e1', attorney: 'Ann Lee', matter_id: 'MATT-1', duration_minutes: 90, activity_type: 'case_management', created_at: '2026-10-19T15:00:00Z' });
  });

  test('renderers format hours, money, badges, matter links and Created', () => {
    const att = T.attorneyRenderers();
    expect(att.billable_hours(10)).toContain('10.0h');
    expect(att.billable_amount(2500)).toContain('$2,500.00');
    expect(att.submitted_count(2)).toContain('<lex-badge label="2"');
    expect(att.created_at('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
    expect(att.created_at('')).toContain('—');

    const mat = T.matterRenderers();
    expect(mat.matter_name('Smith v. Jones', { matter_id: 'MATT-1' })).toContain('data-matter-id="MATT-1"');

    const app = T.approvalRenderers();
    expect(app.duration_minutes(90)).toContain('1.5h');
    expect(app.activity_type('case_management')).toContain('label="Case management"');
    const actions = app.actions('', { id: 'e1' });
    expect(actions).toContain('data-bh-action="edit"');
    expect(actions).toContain('data-bh-action="history"');
    expect(actions).toContain('data-bh-action="approve"');
  });

  test('every column has a header filter; ranges and dates match by predicate', () => {
    expect(Object.keys(T.attorneyFilters()).sort()).toEqual(
      ['approved_count', 'billable_amount', 'billable_hours', 'created_at', 'draft_count', 'email', 'name', 'submitted_count', 'total_hours'].sort());
    expect(Object.keys(T.matterFilters()).sort()).toEqual(
      ['attorneys', 'billable_amount', 'billable_hours', 'client_name', 'created_at', 'matter_name', 'total_hours'].sort());
    const rows = [T.approvalRow({ id: '1', activity_type: 'research' }), T.approvalRow({ id: '2', activity_type: 'case_management' })];
    const f = T.approvalFilters(rows);
    expect(plain(f.activity_type.options)).toEqual([{ value: 'case_management', label: 'Case management' }, { value: 'research', label: 'Research' }]);
    expect(f.duration_minutes.match(45, ['30-120'])).toBe(true);
    expect(f.duration_minutes.match(120, ['30-120'])).toBe(false);
    expect(T.inRange(40, '40-')).toBe(true);
    expect(T.inRange(0, '0-1')).toBe(true);
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    expect(f.created_at.match(recent, ['7d'])).toBe(true);
  });
});

describe('Workspace time entries table', () => {
  const win = loadScript('js/workspace-billable-hours.js');
  const T = win.WorkspaceBillableHoursTable;

  test('drafts URL loads every status for the matter and period, admin scope optional', () => {
    const url = T.draftsUrl('matter-1', 2, { from: '2026-10-01', to: '2026-10-20' }, true);
    expect(url.startsWith('/api/v1/billable-hours/drafts?matter_id=matter-1')).toBe(true);
    expect(query(url)).toEqual({ matter_id: 'matter-1', status: 'all', limit: '200', page: '2', date_from: '2026-10-01', date_to: '2026-10-20', all_users: 'true' });
    expect(query(T.draftsUrl('m', 1, {}, false)).all_users).toBeUndefined();
  });

  test('fetchAllEntries walks the pages', async () => {
    const get = jest.fn((url) => {
      const page = Number(query(url).page);
      const n = page === 1 ? 200 : 3;
      return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: page + '-' + i })), pagination: { total: 203 } });
    });
    expect(await T.fetchAllEntries('m', {}, false, get)).toHaveLength(203);
    expect(get).toHaveBeenCalledTimes(2);
  });

  test('rows are raw; renderers badge status and source and offer draft actions', () => {
    const row = T.entryRow({ id: 'e1', description: 'Drafted motion', duration_minutes: 75, activity_type: 'drafting', source: 'activity', status: 'draft', start_time: '2026-10-19T14:00:00Z', created_at: '2026-01-20T20:16:00Z', has_overlap_with: ['e2'] });
    expect(row).toMatchObject({ id: 'e1', duration_minutes: 75, status: 'draft', source: 'activity', created_at: '2026-01-20T20:16:00Z' });
    const r = T.entryRenderers();
    expect(r.duration_minutes(75)).toContain('1.3h');
    expect(r.status('submitted')).toContain('label="Submitted"');
    expect(r.source('activity')).toContain('label="Auto"');
    expect(r.activity_type('case_management')).toContain('Case management');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('1/20/2026 3:16 PM');
    const actions = r.actions('', row);
    expect(actions).toContain('data-bh-action="approve"');
    expect(actions).toContain('data-bh-action="reject"');
    expect(actions).toContain('data-bh-action="overlap"');
    expect(r.actions('', T.entryRow({ id: 'x', status: 'approved' }))).not.toContain('approve"');
  });

  test('every column filters; bulk actions only touch drafts', () => {
    const rows = [T.entryRow({ id: '1', activity_type: 'review', status: 'draft' }), T.entryRow({ id: '2', activity_type: 'research', status: 'approved' })];
    const f = T.entryFilters(rows);
    expect(Object.keys(f).sort()).toEqual(['activity_type', 'created_at', 'description', 'duration_minutes', 'source', 'start_time', 'status'].sort());
    expect(f.description.text).toBe(true);
    expect(f.duration_minutes.match(20, ['0-30'])).toBe(true);
    expect(plain(f.status.options.map((o) => o.label))).toEqual(['Draft', 'Submitted', 'Approved', 'Invoiced']);
    expect(plain(T.draftIds(rows))).toEqual(['1']);
  });
});

describe('Billable hours markup follows the table standard', () => {
  test('admin page: three card tables with column filters, no banned attributes', () => {
    const html = read('admin/billable-hours.html');
    ['bhAttorneysTable', 'bhMattersTable', 'bhApprovalsTable'].forEach((id) => {
      const tag = html.slice(html.indexOf('id="' + id + '"') - 30, html.indexOf('</lex-table>', html.indexOf('id="' + id + '"')));
      expect(tag).toContain('lex-table--card');
      expect(tag).toContain('column-filters');
      expect(tag).toContain('Created');
      expect(tag).not.toMatch(/\s(searchable|filterable|compact)\b/);
    });
    expect(html).toContain('selectable');
    expect(html).not.toContain('limit=50');
    expect(read('js/admin/billable-hours-reporting.js')).not.toContain('limit=50');
  });

  test('workspace time entries: lex-table replaces the div list and outside pager', () => {
    const html = read('workspace-details.html');
    expect(html).toContain('id="bhEntriesTable"');
    expect(html).not.toContain('id="bhPagination"');
    expect(html).not.toContain('id="bhEntriesList"');
    const js = read('js/workspace-billable-hours.js');
    expect(js).not.toContain('<select');
    expect(js).not.toContain('bhResolveChooser');
  });
});

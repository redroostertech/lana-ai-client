'use strict';

/**
 * Approvals inbox and Recordings lists on the table standard
 * (docs/TABLE-STANDARD.md): query mapping, raw rows, renderers, header
 * filters and page markup.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });
const NOW = new Date('2026-10-20T15:30:00.000Z');

function loadPage(rel) {
  const win = {
    localStorage: { getItem: () => STORED_USER },
    Intl,
    Date,
    location: { pathname: '/' + rel.replace('js/', '').replace('.js', '.html'), search: '', href: '' },
    addEventListener: () => {}
  };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  win.Lex.Nav = { getParams: () => new URLSearchParams(''), go: () => {} };
  win.Lex.Toast = { error: () => {}, success: () => {}, warning: () => {} };

  const document = {
    readyState: 'complete',
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const api = new Proxy({ isAuthenticated: () => true }, { get: (t, k) => t[k] || (() => new Promise(() => {})) });
  const context = {
    window: win,
    document,
    Lex: win.Lex,
    LanaTime: win.LanaTime,
    api,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  win.document = document;
  win.api = api;
  vm.createContext(context);
  vm.runInContext(read(rel), context, { filename: rel });
  return win;
}

const params = (search) => Object.fromEntries(new URLSearchParams(search.toString()));
const plain = (value) => JSON.parse(JSON.stringify(value));

describe('Approvals inbox table', () => {
  const win = loadPage('js/approvals.js');
  const t = win.ApprovalsTable;

  test('maps paging, sort, search and every column filter to /api/v1/approvals', () => {
    const p = t.inboxApiParams({
      page: 3,
      limit: 20,
      sortBy: 'priority',
      sortDir: 'asc',
      filters: {
        title: { operator: 'contains', value: 'NDA' },
        status: { operator: 'in', value: ['pending'] },
        priority: { operator: 'in', value: ['urgent'] },
        source_type: { operator: 'in', value: ['workflow_execution'] },
        requested_by: { operator: 'in', value: ['u-1'] },
        assigned_to: { operator: 'in', value: ['u-2'] },
        matter_id: { operator: 'in', value: ['m-uuid'] },
        expires_at: { operator: 'in', value: ['24h'] },
        created_at: { operator: 'in', value: ['7d'] }
      }
    }, 'lease', NOW);
    expect(params(p)).toEqual({
      limit: '20',
      offset: '40',
      sort_by: 'priority',
      sort_order: 'asc',
      search: 'lease',
      title: 'NDA',
      status: 'pending',
      priority: 'urgent',
      source_type: 'workflow_execution',
      requested_by: 'u-1',
      assigned_to: 'u-2',
      matter_id: 'm-uuid',
      expires_after: '2026-10-20T15:30:00.000Z',
      expires_before: '2026-10-21T15:30:00.000Z',
      created_after: '2026-10-13T15:30:00.000Z'
    });
  });

  test('defaults: newest first, no page param (the API reads limit/offset), unknown sort falls back', () => {
    expect(params(t.inboxApiParams({ page: 1, limit: 20, sortBy: 'title', sortDir: 'desc', filters: {} }, '', NOW)))
      .toEqual({ limit: '20', offset: '0', sort_by: 'created_at', sort_order: 'desc' });
    expect(params(t.inboxApiParams({ page: 1, limit: 500, filters: {} }, '', NOW)).limit).toBe('100');
  });

  test('expires ranges', () => {
    expect(plain(t.expiresRangeBounds('past', NOW))).toEqual({ after: '', before: '2026-10-20T15:30:00.000Z' });
    expect(plain(t.expiresRangeBounds('later', NOW))).toEqual({ after: '2026-10-21T15:30:00.000Z', before: '' });
    expect(plain(t.expiresRangeBounds('', NOW))).toEqual({ after: '', before: '' });
  });

  test('rows keep raw values and the record', () => {
    const raw = { id: 'a1', title: 'Send NDA', priority: 'HIGH', status: 'pending', source_type: 'workflow_execution',
      requested_by: 'u-1', assigned_to: null, matter_id: 'm-uuid', expires_at: '2026-10-21T00:00:00Z', created_at: '2026-01-20T20:16:00Z' };
    const row = t.mapApproval(raw);
    expect(row).toMatchObject({ id: 'a1', title: 'Send NDA', priority: 'high', status: 'pending', source_type: 'workflow_execution',
      assigned_to: '', matter_id: 'm-uuid', created_at: '2026-01-20T20:16:00Z' });
    expect(row._raw).toBe(raw);
  });

  test('renderers: badges, readable source, people, workspace link, Created date-time', () => {
    const r = t.cellRenderers({ 'm-uuid': 'Smith v. Jones' });
    const raw = { requested_by_first_name: 'Ann', requested_by_last_name: 'Lee', assigned_to_email: 'bo@x.com' };
    const row = { status: 'approved', _raw: raw };
    expect(r.priority('urgent')).toBe('<lex-badge label="Urgent" color="red" size="sm"></lex-badge>');
    expect(r.status('approved')).toContain('label="Approved" color="green"');
    expect(r.source_type('workflow_execution')).toContain('>Workflow execution<');
    expect(r.source_type('document_edit_batch_release')).toContain('>Document release<');
    expect(r.requested_by('u-1', row)).toContain('>Ann Lee<');
    expect(r.assigned_to('u-2', row)).toContain('>bo@x.com<');
    expect(r.assigned_to('', { _raw: {} })).toContain('Unassigned');
    expect(r.matter_id('m-uuid')).toContain('data-matter-id="m-uuid"');
    expect(r.matter_id('m-uuid')).toContain('Smith v. Jones');
    expect(r.matter_id('')).toContain('—');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.title('')).toContain('Untitled approval');
  });

  test('every column has a header filter; status/priority/source are single-choice', () => {
    const cols = 'title,source_type,priority,status,requested_by,assigned_to,matter_id,expires_at,created_at'.split(',');
    const map = t.filterOptions([{ value: 'm-uuid', label: 'Smith' }], [{ value: 'u-1', label: 'Ann Lee' }]);
    expect(Object.keys(map).sort()).toEqual(cols.slice().sort());
    expect(map.title.text).toBe(true);
    ['status', 'priority', 'source_type'].forEach((col) => expect(map[col].single).toBe(true));
    map.source_type.options.concat(map.status.options, map.priority.options).forEach((o) => {
      expect(o.label.charAt(0)).toBe(o.label.charAt(0).toUpperCase());
    });
    expect(plain(map.status.options.map((o) => o.value))).toEqual(['pending', 'approved', 'rejected', 'expired', 'cancelled']);
  });
});

describe('Recordings table', () => {
  const win = loadPage('js/recordings.js');
  const t = win.RecordingsTable;

  test('maps paging, search and filters to /api/v1/recordings', () => {
    const p = t.toApiParams({
      page: 2,
      limit: 20,
      sortBy: 'created_at',
      sortDir: 'desc',
      filters: {
        title: { operator: 'contains', value: 'Kickoff' },
        status: { operator: 'in', value: ['ready', 'failed'] },
        visibility: { operator: 'in', value: ['matter'] },
        matter_id: { operator: 'in', value: ['m-uuid'] },
        owner_id: { operator: 'in', value: ['u-1'] },
        duration_ms: { operator: 'in', value: ['5to30'] },
        created_at: { operator: 'in', value: ['older'] }
      }
    }, 'deposition', NOW);
    expect(params(p)).toEqual({
      limit: '20',
      offset: '20',
      sort_by: 'created_at',
      sort_order: 'desc',
      search: 'deposition',
      title: 'Kickoff',
      status: 'ready,failed',
      visibility: 'matter',
      matter_id: 'm-uuid',
      owner_id: 'u-1',
      min_duration_ms: '300000',
      max_duration_ms: '1800000',
      created_before: '2026-09-20T15:30:00.000Z'
    });
    expect(params(t.toApiParams({ page: 1, limit: 20, filters: { duration_ms: { value: ['under5'] } } }, '', NOW)))
      .toEqual({ limit: '20', offset: '0', sort_by: 'created_at', sort_order: 'desc', max_duration_ms: '300000' });
  });

  test('rows keep raw values; renderers format them', () => {
    const raw = { id: 'abcdef1234', status: 'ready', visibility: 'matter', matter_id: 'm-uuid', owner_name: 'Ann Lee',
      duration_ms: 3725000, created_at: '2026-01-20T20:16:00Z', metadata: {} };
    const row = t.mapRecording(raw);
    expect(row).toMatchObject({ id: 'abcdef1234', title: 'Recording abcdef12', status: 'ready', visibility: 'matter',
      duration_ms: 3725000, created_at: '2026-01-20T20:16:00Z' });
    expect(row._raw).toBe(raw);
    expect(t.mapRecording({ id: 'x', duration_ms: 0 }).duration_ms).toBeNull();

    const r = t.cellRenderers({ 'm-uuid': { name: 'Smith v. Jones', matter_id: 'MATT-1' } });
    expect(r.status('ready')).toBe('<lex-badge label="Ready" color="green" size="sm"></lex-badge>');
    expect(r.visibility('organization')).toContain('>Organization<');
    expect(r.matter_id('m-uuid')).toContain('data-matter-id="m-uuid"');
    expect(r.matter_id('m-uuid')).toContain('Smith v. Jones');
    expect(r.owner_id('u', row)).toContain('>Ann Lee<');
    expect(r.duration_ms(3725000)).toContain('>1:02:05<');
    expect(r.duration_ms(null)).toContain('—');
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('>1/20/2026 3:16 PM</time>');
  });

  test('every column has a header filter with capitalised labels', () => {
    const cols = 'title,status,visibility,matter_id,owner_id,duration_ms,created_at'.split(',');
    const map = t.filterOptions([{ value: 'm-uuid', label: 'Smith' }], [{ value: 'u-1', label: 'Ann' }]);
    expect(Object.keys(map).sort()).toEqual(cols.slice().sort());
    map.status.options.concat(map.visibility.options, map.duration_ms.options).forEach((o) => {
      expect(o.label.charAt(0)).toBe(o.label.charAt(0).toUpperCase());
    });
    expect(map.duration_ms.single).toBe(true);
    expect(map.created_at.single).toBe(true);
  });
});

describe('Approvals and Recordings follow the table standard markup', () => {
  const pages = { 'approvals.html': 'aprTable', 'recordings.html': 'recordingsTable' };

  test.each(Object.entries(pages))('%s: toolbar, card table, column filters, server paging, no outside pager', (page, id) => {
    const html = read(page);
    const tag = html.slice(html.indexOf('id="' + id + '"'), html.indexOf('</lex-table>', html.indexOf('id="' + id + '"')));
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('server-paging');
    expect(tag).toContain('limit="20"');
    expect(tag).toContain('Created');
    expect(tag).not.toMatch(/\bsearchable\b|\bfilterable\b|\bcompact\b/);
    expect(html).toContain('role="search"');
    expect(html).not.toContain('<lex-pagination');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<input');
    expect(html).not.toMatch(/Created (At|On|Date)/);
    expect(html).toContain('js/lex/components/data/lex-table.js');
    expect(html).toContain('js/admin/admin-table-kit.js');
    expect(html).toContain('js/shared/library-column-filters.js');
  });

  test('no outside Prev/Next pager or browser dialogs remain', () => {
    expect(read('recordings.html')).not.toContain('recordingsPrev');
    ['js/recordings.js', 'js/approvals.js'].forEach((file) => {
      const js = read(file);
      expect(js).not.toMatch(/(^|[\s;(=!])(window\.)?(alert|confirm|prompt)\(/m);
      expect(js).toContain('setCellRenderers');
      expect(js).toContain('setServerData');
    });
  });
});

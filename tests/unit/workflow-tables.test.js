'use strict';

/**
 * Workflows pages on the table standard (docs/TABLE-STANDARD.md): the
 * workflows list query mapping, raw rows, renderers, header filters, and the
 * page markup for dashboard, execution logs and retargeting.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });
const NOW = new Date('2026-10-20T15:30:00.000Z');

function load() {
  const win = { localStorage: { getItem: () => STORED_USER }, Intl, Date, URLSearchParams };
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/time-utils.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/shared/library-column-filters.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', read('js/admin/admin-table-kit.js'))(win);
  // eslint-disable-next-line no-new-func
  new Function('window', 'module', 'require', read('js/workflows/workflow-tables.js'))(win, undefined, undefined);
  return win;
}

describe('WorkflowTables.workflowsParams (GET /api/v1/workflows)', () => {
  const win = load();
  const WT = win.WorkflowTables;

  test('maps paging and sort to limit/offset/sortBy/sortOrder', () => {
    const p = WT.workflowsParams({ page: 3, limit: 20, sortBy: 'name', sortDir: 'asc', filters: {} }, '');
    expect(p.get('limit')).toBe('20');
    expect(p.get('offset')).toBe('40');
    expect(p.get('sortBy')).toBe('name');
    expect(p.get('sortOrder')).toBe('ASC');
    expect(p.has('search')).toBe(false);
  });

  test('unknown sort columns fall back to updated_at, default DESC', () => {
    const p = WT.workflowsParams({ page: 1, limit: 20, sortBy: 'actions', filters: {} }, '');
    expect(p.get('sortBy')).toBe('updated_at');
    expect(p.get('sortOrder')).toBe('DESC');
  });

  test('maps status and trigger filters to the API names', () => {
    const p = WT.workflowsParams({
      page: 1, limit: 20,
      filters: { status: { operator: 'in', value: ['paused'] }, trigger_type: { operator: 'in', value: ['event'] } }
    }, '');
    expect(p.get('status')).toBe('paused');
    expect(p.get('triggerType')).toBe('event');
  });

  test('toolbar search wins; the name filter is the search when the toolbar is empty', () => {
    const name = { name: { operator: 'contains', value: 'intake' } };
    expect(WT.workflowsParams({ filters: name }, 'welcome').get('search')).toBe('welcome');
    const p = WT.workflowsParams({ filters: name }, '');
    expect(p.get('search')).toBe('intake');
    expect(p.get('name')).toBe('intake');
  });

  test('date range filters become *_after / *_before bounds', () => {
    const p = WT.workflowsParams({
      filters: { created_at: { operator: 'in', value: ['7d'] }, updated_at: { operator: 'in', value: ['older'] } }
    }, '', NOW);
    expect(p.get('created_after')).toBe(new Date(NOW.getTime() - 7 * 86400000).toISOString());
    expect(p.has('created_before')).toBe(false);
    expect(p.get('updated_before')).toBe(new Date(NOW.getTime() - 30 * 86400000).toISOString());
  });
});

describe('row mappers keep raw values', () => {
  const WT = load().WorkflowTables;

  test('mapWorkflow', () => {
    const raw = { id: 'w1', name: 'Intake', description: 'd', status: 'ACTIVE', trigger_type: 'scheduled', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z' };
    const row = WT.mapWorkflow(raw);
    expect(row).toMatchObject({ id: 'w1', name: 'Intake', status: 'active', trigger_type: 'scheduled', created_at: raw.created_at, updated_at: raw.updated_at });
    expect(row._raw).toBe(raw);
  });

  test('mapWorkflow reads demo trigger objects and schedule alias', () => {
    expect(WT.mapWorkflow({ trigger: { type: 'schedule' } }).trigger_type).toBe('scheduled');
  });

  test('mapExecution uses the start time as Created and keeps numbers', () => {
    const row = WT.mapExecution({ id: 'e1', workflowId: 'w1', workflowName: 'Intake', status: 'error', startedAt: '2026-10-20T10:00:00Z', duration: 5000, recordsProcessed: 0, trigger: 'scheduled' });
    expect(row).toMatchObject({ workflow_name: 'Intake', workflow_id: 'w1', status: 'error', trigger: 'scheduled', records_processed: 0, duration_ms: 5000, created_at: '2026-10-20T10:00:00Z' });
  });

  test('mapAudience derives a sync state code', () => {
    expect(WT.mapAudience({ id: 'a', syncEnabled: false }).sync_state).toBe('disabled');
    expect(WT.mapAudience({ id: 'a', syncEnabled: true }).sync_state).toBe('never');
    expect(WT.mapAudience({ id: 'a', syncEnabled: true, lastSync: '2026-10-20T10:00:00Z', size: '12' })).toMatchObject({ sync_state: 'active', size: 12 });
  });

  test('formatDuration', () => {
    expect(WT.formatDuration(500)).toBe('500ms');
    expect(WT.formatDuration(2500)).toBe('2.5s');
    expect(WT.formatDuration(125000)).toBe('2m 5s');
    expect(WT.formatDuration(null)).toBe('');
  });
});

describe('renderers', () => {
  const WT = load().WorkflowTables;

  test('status and trigger render capitalised badges, never raw enums', () => {
    const r = WT.workflowRenderers();
    expect(r.status('paused')).toContain('label="Paused"');
    expect(r.status('paused')).toContain('color="yellow"');
    expect(r.trigger_type('event')).toContain('label="Event"');
    expect(r.status('')).toContain('admin-table-muted');
  });

  test('workflow actions keep pause/activate and run', () => {
    const r = WT.workflowRenderers();
    const active = r.actions('', { id: 'w1', status: 'active' });
    expect(active).toContain('data-action="toggle"');
    expect(active).toContain('title="Pause"');
    expect(active).toContain('data-action="run"');
    expect(r.actions('', { id: 'w2', status: 'paused' })).toContain('title="Activate"');
  });

  test('Created uses formatDateTime; executions show Failed for error', () => {
    const r = WT.executionRenderers();
    expect(r.created_at('2026-01-20T20:16:00Z')).toContain('1/20/2026 3:16 PM');
    expect(r.status('error')).toContain('label="Failed"');
    expect(r.duration_ms(2500)).toContain('2.5s');
    expect(r.records_processed(null)).toContain('—');
    expect(r.actions('', { id: 'e1' })).toContain('data-action="details"');
  });

  test('audience renderers', () => {
    const r = WT.audienceRenderers();
    expect(r.platform('facebook')).toContain('label="Facebook"');
    expect(r.sync_state('never')).toContain('label="Never synced"');
    expect(r.size(1234)).toContain('1,234');
    expect(r.actions('', { id: 'a', sync_state: 'disabled' })).toContain('title="Enable sync"');
  });
});

describe('column filters cover every column', () => {
  const WT = load().WorkflowTables;

  test('server workflows table: text name, single-choice enums and dates', () => {
    const f = WT.workflowFilterOptions();
    expect(Object.keys(f).sort()).toEqual(['created_at', 'name', 'status', 'trigger_type', 'updated_at']);
    expect(f.name.text).toBe(true);
    expect(f.status.single).toBe(true);
    expect(f.created_at.options.map(o => o.value)).toEqual(['today', '7d', '30d', 'older']);
  });

  test('client execution filters use predicates for dates and numbers', () => {
    const f = WT.executionFilterOptions(['B', 'A', 'B']);
    expect(f.workflow_name.options.map(o => o.value)).toEqual(['A', 'B']);
    expect(f.records_processed.match(0, ['0'])).toBe(true);
    expect(f.records_processed.match(5, ['0'])).toBe(false);
    expect(f.duration_ms.match(60000, ['1m+'])).toBe(true);
    expect(f.records_processed.match(null, ['0'])).toBe(false);
    expect(typeof f.created_at.match).toBe('function');
    expect(WT.executionFilterOptions([]).workflow_name.text).toBe(true);
  });

  test('audience filters', () => {
    const f = WT.audienceFilterOptions();
    expect(Object.keys(f).sort()).toEqual(['created_at', 'last_sync', 'name', 'platform', 'size', 'sync_state']);
    expect(f.size.match(10000, ['10000+'])).toBe(true);
    expect(f.sync_state.options.every(o => /^[A-Z]/.test(o.label))).toBe(true);
  });
});

describe('page markup', () => {
  const pages = {
    'workflows/dashboard.html': ['wfTable', 'execTable'],
    'workflows/execution-logs.html': ['logsTable'],
    'workflows/retargeting.html': ['audTable']
  };

  Object.entries(pages).forEach(([rel, ids]) => {
    test(`${rel}: lex-table cards, no hand-built tables, selects or overlays`, () => {
      const html = read(rel);
      expect(html).not.toMatch(/<table[\s>]/);
      expect(html).not.toMatch(/<select[\s>]/);
      expect(html).not.toMatch(/fixed inset-0/);
      expect(html).not.toMatch(/\b(alert|confirm|prompt)\(/);
      expect(html).not.toMatch(/\b(searchable|filterable|compact)\b/);
      ids.forEach((id) => {
        const tag = html.match(new RegExp(`<lex-table[^>]*id="${id}"[^>]*>`));
        expect(tag).not.toBeNull();
        expect(tag[0]).toContain('lex-table--card');
        expect(tag[0]).toContain('column-filters');
        expect(tag[0]).toContain('limit="20"');
        expect(tag[0]).toMatch(/labels="[^"]*Created/);
      });
      expect(html).toContain('../js/workflows/workflow-tables.js');
      expect(html).toContain('../css/workflows/workflow-tables.css');
    });
  });

  test('the workflows table is server-paged against the real list API', () => {
    const html = read('workflows/dashboard.html');
    expect(html).toMatch(/<lex-table[^>]*id="wfTable"[^>]*server-paging/);
    expect(html).toContain("api.get('/api/v1/workflows?'");
    expect(html).not.toContain('slice(0, 5)');
  });
});

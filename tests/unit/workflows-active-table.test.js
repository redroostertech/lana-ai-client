'use strict';

/**
 * Active Workflows on the table standard (docs/TABLE-STANDARD.md): raw rows
 * from both workflow shapes, renderers, header filters (every data column)
 * and the page markup.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const STORED_USER = JSON.stringify({ timezone: 'America/New_York' });
const NOW = new Date('2026-10-20T15:30:00.000Z');

function loadPage() {
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
  const document = { getElementById: () => null, addEventListener: () => {}, querySelector: () => null };
  win.document = document;
  const context = { window: win, document, Lex: win.Lex, URLSearchParams, console, setTimeout, clearTimeout, Promise };
  vm.createContext(context);
  vm.runInContext(read('js/pages/workflows-active.js'), context, { filename: 'workflows-active.js' });
  return win;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

describe('Active Workflows table', () => {
  const win = loadPage();
  const t = win.WorkflowsActiveTable;

  test('maps the demo shape to raw row values', () => {
    const row = t.mapWorkflow({
      id: 'wf-001', name: 'Follow-up', description: 'Cadence', status: 'active',
      trigger: { type: 'schedule' }, lastRun: '2026-10-20T14:30:00Z', successRate: 98.5,
      executionCount: 156, createdAt: '2024-09-15T10:00:00Z', errorMessage: 'x'
    });
    expect(plain(row)).toMatchObject({
      id: 'wf-001', name: 'Follow-up', description: 'Cadence', status: 'active',
      trigger_type: 'scheduled', executions: 156, success_rate: 98.5,
      last_run: '2026-10-20T14:30:00Z', created_at: '2024-09-15T10:00:00Z', error_message: 'x'
    });
    expect(row._raw.id).toBe('wf-001');
  });

  test('maps the chef GET /api/v1/workflows shape; missing stats stay null', () => {
    const row = t.mapWorkflow({ id: 'u1', name: 'Intake', status: 'draft', trigger_type: 'event', created_at: '2026-10-01T12:00:00Z' });
    expect(row.trigger_type).toBe('event');
    expect(row.executions).toBeNull();
    expect(row.success_rate).toBeNull();
    expect(row.last_run).toBe('');
    expect(row.created_at).toBe('2026-10-01T12:00:00Z');
  });

  test('renderers format in cells: badges, labels, Created, empty dashes, actions', () => {
    const r = t.cellRenderers();
    const row = t.mapWorkflow({ id: 'wf-9', name: 'Alert', status: 'active', trigger_type: 'scheduled', created_at: '2026-01-20T20:16:00Z' });
    expect(r.status('paused')).toBe('<lex-badge label="Paused" color="yellow" size="sm"></lex-badge>');
    expect(r.trigger_type('scheduled')).toContain('>Scheduled<');
    expect(r.created_at(row.created_at)).toContain('>1/20/2026 3:16 PM</time>');
    expect(r.executions(null)).toBe('<span class="admin-table-muted">—</span>');
    expect(r.success_rate(92.14)).toContain('92.1%');
    expect(r.last_run('')).toContain('Never');
    const actions = r.actions('', row);
    expect(actions).toContain('data-workflow-action="toggle"');
    expect(actions).toContain('>Pause<');
    expect(actions).toContain('data-workflow-action="run"');
    expect(actions).toContain('data-workflow-action="delete"');
    expect(r.actions('', Object.assign({}, row, { status: 'paused' }))).toContain('>Activate<');
    expect(r.name('A <b>', { description: 'desc' })).toContain('A &lt;b&gt;');
  });

  test('every data column has a header filter with capitalised labels', () => {
    const f = t.filterOptions();
    expect(Object.keys(f).sort()).toEqual(['created_at', 'executions', 'last_run', 'name', 'status', 'success_rate', 'trigger_type']);
    expect(f.name.text).toBe(true);
    expect(plain(f.status.options).map((o) => o.label)).toEqual(['Active', 'Paused', 'Draft', 'Archived', 'Error']);
    expect(plain(f.trigger_type.options).map((o) => o.label)).toEqual(['Manual', 'Scheduled', 'Event']);
    expect(f.executions.match(0, ['none'])).toBe(true);
    expect(f.executions.match(150, ['10-99'])).toBe(false);
    expect(f.executions.match(null, ['none'])).toBe(false);
    expect(f.success_rate.match(95, ['high'])).toBe(true);
    expect(f.success_rate.match(65, ['low'])).toBe(true);
    expect(f.created_at.single).toBe(true);
    expect(f.created_at.match(NOW.toISOString(), ['older'])).toBe(false);
    expect(f.last_run.match('', ['7d'])).toBe(false);
  });

  test('deep-link params: id and a known status', () => {
    expect(plain(t.readParams(new URLSearchParams('id=wf-1&status=Paused')))).toEqual({ id: 'wf-1', status: 'paused' });
    expect(plain(t.readParams(new URLSearchParams('status=bogus')))).toEqual({ id: '', status: '' });
  });
});

describe('workflows/active.html follows the table standard markup', () => {
  const html = read('workflows/active.html');

  test('one card lex-table with column filters, a Created column and an Actions label', () => {
    expect(html).toContain('id="activeWorkflowsTable"');
    expect(html).toMatch(/class="admin-table lex-table--card"/);
    expect(html).toContain('column-filters');
    expect(html).toContain('labels="Workflow,Status,Trigger,Runs,Success rate,Last run,Created,Actions"');
    expect(html).not.toMatch(/<lex-table[^>]*\s(searchable|filterable|compact)[\s>=]/);
  });

  test('no native selects, hand-built overlays or window dialogs remain', () => {
    expect(html).not.toMatch(/<select/);
    expect(html).not.toContain('fixed inset-0');
    expect(html).not.toMatch(/\bconfirm\(|\balert\(|\bprompt\(/);
    expect(html).toContain('"label":"Created"');
  });
});

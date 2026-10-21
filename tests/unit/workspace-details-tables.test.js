const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const tables = require(path.join(SRC, 'js/shared/workspace-details-tables.js'));
const ranges = require(path.join(SRC, 'js/shared/library-column-filters.js'));

describe('workspace-details-tables: connected data modal', () => {
  const contacts = [{ id: 7, first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com', created_at: '2026-10-01T10:00:00Z' }];
  const linkedGroups = {
    time_entry: [{ id: 'cd-1', connector_id: 'clio', connector_name: 'Clio', entity_type: 'time_entry', data: { title: 'Drafting' }, created_at: '2026-10-02T10:00:00Z' }]
  };
  const available = [
    { id: 'cd-1', connector_id: 'clio', entity_type: 'time_entry', data: {} },
    { id: 'cd-2', connector_id: 'clio', connector_name: 'Clio', entity_type: 'invoice', external_id: 'INV-9', data: { description: 'Q3' }, created_at: '2026-10-03T10:00:00Z' }
  ];

  test('rows keep raw codes, timestamps and the record; linked duplicates are dropped', () => {
    const rows = tables.buildConnectedDataRows({ contacts, linkedGroups, available });
    expect(rows.map((r) => r.id)).toEqual(['contact_7', 'cd-1', 'cd-2']);
    expect(rows[0]).toMatchObject({ name: 'Ada Lovelace', type: 'contact', source: 'LANA', detail: 'ada@example.com', status: 'linked', _linkType: 'contact', created_at: '2026-10-01T10:00:00Z' });
    expect(rows[1]).toMatchObject({ name: 'Drafting', type: 'time_entry', source: 'Clio', status: 'linked', _linkType: 'connector' });
    expect(rows[2]).toMatchObject({ name: 'INV-9', type: 'invoice', detail: 'Q3', status: 'available', created_at: '2026-10-03T10:00:00Z' });
    expect(rows[2]._raw).toBe(available[1]);
  });

  test('toolbar search and type apply to contacts and linked records', () => {
    const bySearch = tables.buildConnectedDataRows({ contacts, linkedGroups, available: [], search: 'ada' });
    expect(bySearch.map((r) => r.id)).toEqual(['contact_7']);
    const byType = tables.buildConnectedDataRows({ contacts, linkedGroups, available: [], entityType: 'time_entry' });
    expect(byType.map((r) => r.id)).toEqual(['cd-1']);
  });

  test('renderers humanize types, badge the status and format Created', () => {
    global.Lex = { Utils: {
      humanizeLabel: (v) => { const t = String(v).split('_').join(' '); return t.charAt(0).toUpperCase() + t.slice(1); },
      formatDateTime: () => '10/3/2026 6:00 AM',
      timeAgo: () => '2 weeks ago'
    } };
    try {
      const r = tables.connectedDataRenderers();
      expect(r.type('time_entry')).toContain('Time entry');
      expect(r.status('linked')).toBe('<lex-badge label="Linked" color="green"></lex-badge>');
      expect(r.status('available')).toContain('label="Available"');
      expect(r.created_at('2026-10-03T10:00:00Z')).toContain('10/3/2026 6:00 AM');
      expect(r.created_at('2026-10-03T10:00:00Z')).toContain('title="2 weeks ago"');
      expect(r.detail('')).toContain('—');
      expect(r.name('<b>x</b>')).not.toContain('<b>');
    } finally {
      delete global.Lex;
    }
  });

  test('every column has a filter with readable labels, dates by range', () => {
    const rows = tables.buildConnectedDataRows({ contacts, linkedGroups, available });
    const map = tables.connectedDataFilterOptions(rows, ranges);
    expect(Object.keys(map).sort()).toEqual(['created_at', 'detail', 'name', 'source', 'status', 'type']);
    expect(map.name.text).toBe(true);
    expect(map.detail.text).toBe(true);
    expect(map.type.options).toEqual([
      { value: 'contact', label: 'Contact' },
      { value: 'invoice', label: 'Invoice' },
      { value: 'time_entry', label: 'Time entry' }
    ]);
    expect(map.source.options.map((o) => o.label)).toEqual(['Clio', 'LANA']);
    expect(map.status.options).toEqual(tables.CD_STATUS_OPTIONS);
    expect(map.created_at.single).toBe(true);
    expect(map.created_at.match(new Date().toISOString(), ['7d'])).toBe(true);
    expect(map.created_at.match('2020-01-01T00:00:00Z', ['7d'])).toBe(false);
  });

  test('empty text reflects filtering', () => {
    expect(tables.connectedDataEmptyText(false)).toMatch(/Connect an integration/);
    expect(tables.connectedDataEmptyText(true)).toMatch(/No matching records/);
  });
});

describe('workspace-details-tables: activity drawer', () => {
  test('maps the table query to limit/offset and the answer to a page', () => {
    expect(tables.activityRequest({ page: 3, limit: 20 })).toEqual({ limit: 20, offset: 40 });
    expect(tables.activityRequest({})).toEqual({ limit: 20, offset: 0 });
    expect(tables.activityPagination({ pagination: { total: 45, limit: 20, offset: 40 } }, { page: 3, limit: 20 }, 5))
      .toEqual({ page: 3, limit: 20, total: 45 });
  });

  test('rows hold the raw record and timestamp; renderers format', () => {
    const act = { id: 12, event_type: 'document.opened', resource_type: 'generated_document', display_message: 'Opened a file', created_at: '2026-10-20T09:00:00Z' };
    const row = tables.activityRow(act, 0);
    expect(row).toMatchObject({ id: '12', message: 'Opened a file', type: 'generated_document', created_at: '2026-10-20T09:00:00Z' });
    expect(row._raw).toBe(act);
    expect(row._activity).toBe(act);
    const r = tables.activityRenderers({ describe: () => '<strong>Ada</strong> opened a file' });
    expect(r.message(row.message, row)).toContain('<strong>Ada</strong> opened a file');
    expect(r.type('generated_document')).toContain('Generated document');
    expect(r.type('')).toContain('—');
  });
});

describe('workspace-details page wiring', () => {
  const html = fs.readFileSync(path.join(SRC, 'workspace-details.html'), 'utf8');
  const js = fs.readFileSync(path.join(SRC, 'js/workspace-details.js'), 'utf8');

  test('the connected data table follows the table standard', () => {
    const tag = html.slice(html.indexOf('id="cdModalTable"'), html.indexOf('</lex-table>', html.indexOf('id="cdModalTable"')));
    expect(tag).toContain('lex-table--card');
    expect(tag).toContain('column-filters');
    expect(tag).toContain('labels="Name,Type,Source,Detail,Status,Created"');
    expect(tag).not.toMatch(/\b(searchable|filterable|compact)\b/);
    expect(html.indexOf('js/shared/workspace-details-tables.js')).toBeLessThan(html.indexOf('js/workspace-details.js"'));
  });

  test('the activity drawer is server-paged with a Created column', () => {
    expect(js).toContain('id="activityDrawerTable" class="wd-activity-table lex-table--card" server-paging column-filters');
    expect(js).toContain('labels="Activity,Type,Created"');
    expect(js).not.toContain('when: timeAgo(act.created_at)');
    expect(js).not.toContain('getMatterActivity(matterId, 200, 0)');
  });

  test('bulk link/unlink checks the raw status codes', () => {
    expect(js).toContain("item.status === 'linked'");
    expect(js).toContain("item.status === 'available'");
    expect(js).not.toContain("item.status === 'Linked'");
  });
});

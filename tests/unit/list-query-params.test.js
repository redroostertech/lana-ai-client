'use strict';

const fs = require('fs');
const path = require('path');
const builders = require('../../src/js/shared/list-query-params.js');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const now = new Date('2026-10-20T15:30:00.000Z');
const tableSlice = (html, id) => {
  const start = html.indexOf('id="' + id + '"');
  return html.slice(start, html.indexOf('</lex-table>', start));
};

describe('Workspaces query -> GET /api/v1/matters', () => {
  test('pages, sorts and searches on the server', () => {
    const params = builders.mattersParams(
      { page: 3, limit: 20, sortBy: 'matter_type', sortDir: 'asc', filters: {} },
      { search: 'acme', includeAll: true }
    );
    expect(Object.fromEntries(params)).toEqual({
      page: '3',
      page_size: '20',
      sort_by: 'matter_type',
      sort_order: 'asc',
      exclude_pinned: 'true',
      include_all: 'true',
      search: 'acme'
    });
  });

  test('defaults: newest first, unknown sort columns fall back to created_at', () => {
    const params = builders.mattersParams({ sortBy: 'matter_id', filters: {} });
    expect(params.get('page')).toBe('1');
    expect(params.get('page_size')).toBe('20');
    expect(params.get('sort_by')).toBe('created_at');
    expect(params.get('sort_order')).toBe('desc');
    expect(params.get('include_all')).toBe('false');
    expect(params.has('search')).toBe(false);
  });

  test('every column filter maps to a parameter', () => {
    const params = builders.mattersParams({
      page: 1,
      limit: 20,
      filters: {
        name: { operator: 'contains', value: ' Smith ' },
        matter_id: { operator: 'contains', value: 'MATT-1' },
        status: { operator: 'in', value: ['closed'] },
        matter_type: { operator: 'in', value: ['matter'] },
        created_at: { operator: 'in', value: ['7d'] },
        updated_at: { operator: 'in', value: ['older'] }
      }
    }, { now });
    expect(params.get('name')).toBe('Smith');
    expect(params.get('matter_id_contains')).toBe('MATT-1');
    expect(params.get('status')).toBe('closed');
    expect(params.has('include_archived')).toBe(false);
    expect(params.get('matter_type')).toBe('matter');
    expect(params.get('created_after')).toBe('2026-10-13T15:30:00.000Z');
    expect(params.has('created_before')).toBe(false);
    expect(params.get('updated_before')).toBe('2026-09-20T15:30:00.000Z');
    expect(params.has('updated_after')).toBe(false);
  });

  test('the Archived status asks the API to include archived rows', () => {
    const params = builders.mattersParams({ filters: { status: { operator: 'in', value: ['archived'] } } });
    expect(params.get('status')).toBe('archived');
    expect(params.get('include_archived')).toBe('true');
  });

  test('page size is capped at the API maximum we allow', () => {
    expect(builders.mattersParams({ limit: 5000 }).get('page_size')).toBe('100');
  });

  test('status and type options start with a capital letter', () => {
    builders.MATTER_STATUS_OPTIONS.concat(builders.MATTER_TYPE_OPTIONS).forEach((option) => {
      expect(option.label.charAt(0)).toBe(option.label.charAt(0).toUpperCase());
    });
  });
});

describe('My Tasks query -> GET /api/v1/tasks/my', () => {
  test('a table page is one limit/offset request (no client cap)', () => {
    const params = builders.myTasksParams({ page: 7, limit: 50, sortBy: 'due_date', sortDir: 'asc', filters: {} });
    expect(Object.fromEntries(params)).toEqual({
      limit: '50',
      offset: '300',
      sort_by: 'due_date',
      sort_dir: 'ASC'
    });
  });

  test('limit never exceeds the API cap of 100', () => {
    const params = builders.myTasksParams({ page: 2, limit: 500 });
    expect(params.get('limit')).toBe('100');
    expect(params.get('offset')).toBe('100');
  });

  test('defaults to most recently updated first', () => {
    const params = builders.myTasksParams({});
    expect(params.get('sort_by')).toBe('updated_at');
    expect(params.get('sort_dir')).toBe('DESC');
    expect(params.get('offset')).toBe('0');
  });

  test('search, status, priority, title, workspace, due and created filters', () => {
    const params = builders.myTasksParams({
      page: 1,
      limit: 20,
      filters: {
        title: { operator: 'contains', value: 'intake' },
        status: { operator: 'in', value: ['complete', 'in_progress'] },
        priority: { operator: 'in', value: ['high'] },
        workspace_matter: { operator: 'in', value: ['MATT-1', 'MATT-2'] },
        due_date: { operator: 'in', value: ['overdue'] },
        created_at: { operator: 'in', value: ['30d'] }
      }
    }, { search: 'lease', now });
    expect(params.get('search')).toBe('lease');
    // The legacy "completed" status counts as Complete.
    expect(params.get('statuses')).toBe('complete,completed,in_progress');
    expect(params.get('priorities')).toBe('high');
    expect(params.get('title')).toBe('intake');
    expect(params.get('matter_ids')).toBe('MATT-1,MATT-2');
    expect(params.get('due_before')).toBeTruthy();
    expect(params.has('due_after')).toBe(false);
    expect(params.get('created_after')).toBe('2026-09-20T15:30:00.000Z');
  });

  test('due ranges look forward from the start of today', () => {
    const next7 = builders.myTasksParams({ filters: { due_date: { value: ['next_7d'] } } }, { now });
    const after = new Date(next7.get('due_after')).getTime();
    const before = new Date(next7.get('due_before')).getTime();
    expect(before - after).toBe(7 * 24 * 60 * 60 * 1000);
    expect(after).toBeLessThanOrEqual(now.getTime());
    const none = builders.myTasksParams({ filters: { due_date: { value: ['none'] } } }, { now });
    expect(none.get('no_due_date')).toBe('true');
  });
});

describe('Library search results -> GET /api/v1/storage/library/files', () => {
  test('pages and sorts with the library API names', () => {
    const params = builders.libraryFilesParams({ page: 2, limit: 20, sortBy: 'size', sortDir: 'asc', filters: {} }, { search: 'nda' });
    expect(Object.fromEntries(params)).toEqual({
      page: '2',
      page_size: '20',
      sort_by: 'file_size',
      sort_order: 'asc',
      search: 'nda'
    });
  });

  test('name, workspace, size and created filters', () => {
    const params = builders.libraryFilesParams({
      filters: {
        name: { operator: 'contains', value: 'lease' },
        workspace: { operator: 'in', value: ['MATT-9'] },
        size: { operator: 'in', value: ['100kb_1mb'] },
        created_at: { operator: 'in', value: ['older'] }
      }
    }, { search: 'x', now });
    expect(params.get('name')).toBe('lease');
    expect(params.get('workspaces')).toBe('MATT-9');
    expect(params.get('min_size')).toBe(String(100 * 1024));
    expect(params.get('max_size')).toBe(String(1024 * 1024));
    expect(params.get('created_before')).toBe('2026-09-20T15:30:00.000Z');
  });
});

describe('page wiring follows the table standard', () => {
  test('Workspaces: server-paged card table, every column, no outside pager on the list', () => {
    const html = read('workspaces.html');
    const table = tableSlice(html, 'mattersListView');
    expect(table).toContain('server-paging');
    expect(table).toContain('column-filters');
    expect(table).toContain('lex-table--card');
    expect(table).toContain('columns="name,matter_id,status,matter_type,created_at,updated_at"');
    expect(table).toContain('labels="Name,Matter ID,Status,Type,Created,Last edited"');
    expect(table).toContain('limit="20"');
    expect(table).not.toMatch(/\b(compact|searchable|filterable)\b/);
    expect(html).not.toContain('<lex-pagination id="pagination"');
    expect(html).not.toContain('Created Date');
    expect(html.indexOf('js/shared/list-query-params.js')).toBeLessThan(html.indexOf('src="js/workspace.js"'));
    const js = read(path.join('js', 'workspace.js'));
    expect(js).toContain("queryParams.mattersParams(query");
    expect(js).toContain('table.setServerData(unpinnedMatters.map(mapMatterForTable), lastPagination)');
    expect(js).not.toContain('listEl.setData(');
  });

  test('My Tasks: server-paged, Task filters by text, no fetch cap', () => {
    const html = read('my-tasks.html');
    const table = tableSlice(html, 'myTasksTable');
    expect(table).toContain('server-paging');
    expect(table).toContain('sortable-columns="title,status,priority,due_date,created_at"');
    expect(html).toContain('{"value":"in_progress","label":"In progress"}');
    const js = read(path.join('js', 'pages', 'my-tasks.js'));
    expect(js).not.toContain('TASK_FETCH_MAX');
    expect(js).toContain("title: { text: true, placeholder: 'Task contains...' }");
    expect(js).toContain('builder.myTasksParams(query');
    expect(js).not.toContain('<select');
  });

  test('Library: list and search tables use their own pagers', () => {
    const html = read('drive.html');
    const list = tableSlice(html, 'listView');
    expect(list).toContain('limit="20"');
    const files = tableSlice(html, 'filesListView');
    expect(files).toContain('server-paging');
    expect(files).toContain('column-filters');
    expect(files).toContain('sortable-columns="name,created_at,size"');
    expect(html).not.toContain('Modified Date');
    const js = read(path.join('js', 'drive.js'));
    expect(js).not.toContain('totalPages: 1 })');
    expect(js).toContain('builder.libraryFilesParams(query');
    expect(js).toContain('pageOfRows(filterNoteRows(rows)');
    expect(read('folder.html')).not.toContain('Created Date');
  });
});

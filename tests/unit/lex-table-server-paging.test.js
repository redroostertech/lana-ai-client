'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

// Loads lex.data.js and lex-table.js against a minimal Lex runtime so the
// data source and the table's render() can run without a browser.
function loadLex() {
  const document = {
    createElement() { return { textContent: '' }; },
    head: { appendChild() {} },
    activeElement: null
  };

  class LexElement {
    static get properties() { return {}; }
    constructor() {
      this.events = [];
      this.attrs = {};
      for (const [name, config] of Object.entries(this.constructor.properties)) {
        if (config.default !== undefined) this[name] = config.default;
      }
    }
    connected() {}
    disconnected() {}
    _scheduleUpdate() { this.updates = (this.updates || 0) + 1; }
    emit(name, detail) { this.events.push({ name, detail }); }
    getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; }
    hasAttribute(name) { return this.attrs[name] !== undefined; }
    escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
  }

  const window = { Lex: { LexElement, defineLex(name, ctor) { window[name] = ctor; } } };
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'globalThis', read('js/lex/lex.data.js'))(window, document, window);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', read('js/lex/components/data/lex-table.js'))(window, document);
  return window;
}

function serverTable(window, props = {}) {
  const table = new window['lex-table']();
  Object.assign(table, { serverPaging: true, limit: 20, columns: 'name,workspace,updated_at' }, props);
  table.connected();
  return table;
}

const lastEvent = (table, name) => table.events.filter((e) => e.name === name).pop();

describe('lex-table server paging', () => {
  test('connecting in server mode starts loading and seeds the sort from the attributes', () => {
    const window = loadLex();
    const table = serverTable(window, { sortBy: 'updated_at', sortDir: 'desc' });

    expect(table.dataSource._serverMode).toBe(true);
    expect(table.serverQuery).toEqual({
      page: 1, limit: 20, sortBy: 'updated_at', sortDir: 'desc', search: '', filters: {}
    });

    table.requestServerQuery();
    expect(table.dataSource.loading).toBe(true);
    expect(lastEvent(table, 'lex-query-change').detail.page).toBe(1);
    expect(table.render()).toContain('animate-pulse');
  });

  test('setServerData renders the page and reads snake_case pagination', () => {
    const window = loadLex();
    const table = serverTable(window);
    table.requestServerQuery();
    table.setServerData(
      [{ id: 'a', name: 'Brief.docx', workspace: 'Smith', updated_at: '' }],
      { page: 2, page_size: 20, total: 41, total_pages: 3 }
    );

    expect(table.dataSource.loading).toBe(false);
    expect(table.dataSource.pagination).toMatchObject({ page: 2, limit: 20, total: 41, totalPages: 3 });
    const html = table.render();
    expect(html).toContain('Brief.docx');
    expect(html).toContain('Page 2 of 3 (41 total)');
  });

  test('paging, page size and sort ask the page instead of slicing locally', () => {
    const window = loadLex();
    const table = serverTable(window, { sortBy: 'updated_at', sortDir: 'desc' });
    table.setServerData([{ id: 'a', name: 'A' }], { page: 1, limit: 20, total: 60 });

    table.dataSource.nextPage();
    expect(lastEvent(table, 'lex-query-change').detail).toMatchObject({ page: 2, limit: 20 });

    table.dataSource.setLimit(50);
    expect(lastEvent(table, 'lex-query-change').detail).toMatchObject({ page: 1, limit: 50 });

    table.setServerData([{ id: 'a', name: 'A' }], { page: 1, limit: 50, total: 60 });
    table.dataSource.goToPage(2);
    table.dataSource.setSort('name', 'asc');
    expect(lastEvent(table, 'lex-query-change').detail).toMatchObject({ page: 1, sortBy: 'name', sortDir: 'asc' });
  });

  test('requestServerQuery({ resetPage }) returns to page 1 after an outside filter changes', () => {
    const window = loadLex();
    const table = serverTable(window);
    table.setServerData([{ id: 'a' }], { page: 3, limit: 20, total: 100 });

    table.requestServerQuery({ resetPage: true });
    expect(lastEvent(table, 'lex-query-change').detail.page).toBe(1);
  });

  test('setServerError shows the error state', () => {
    const window = loadLex();
    const table = serverTable(window);
    table.requestServerQuery();
    table.setServerError('Files could not be loaded');

    expect(table.dataSource.loading).toBe(false);
    expect(table.render()).toContain('Files could not be loaded');
  });

  test('column filters stay off in server mode', () => {
    const window = loadLex();
    const table = serverTable(window, { columnFilters: true });
    table.setServerData([{ id: 'a', name: 'A', workspace: 'W', updated_at: '' }], { page: 1, limit: 20, total: 1 });

    expect(table.render()).not.toContain('data-col-filter=');
  });
});

describe('lex-table sortable-columns', () => {
  function clientTable(window, props = {}) {
    const table = new window['lex-table']();
    Object.assign(table, { limit: 20, columns: 'name,workspace,updated_at' }, props);
    table.setData([{ id: 'a', name: 'A', workspace: 'W', updated_at: '' }]);
    return table;
  }

  test('every header sorts when the attribute is absent (existing tables unchanged)', () => {
    const window = loadLex();
    const html = clientTable(window).render();
    expect(html).toContain('data-sort-col="name"');
    expect(html).toContain('data-sort-col="workspace"');
    expect(html).toContain('data-sort-col="updated_at"');
  });

  test('only the listed headers sort when the attribute is set', () => {
    const window = loadLex();
    const html = clientTable(window, { sortableColumns: 'name, updated_at' }).render();
    expect(html).toContain('data-sort-col="name"');
    expect(html).toContain('data-sort-col="updated_at"');
    expect(html).not.toContain('data-sort-col="workspace"');
  });

  test('an empty attribute turns sorting off for every header', () => {
    const window = loadLex();
    const html = clientTable(window, { sortableColumns: '' }).render();
    expect(html).not.toContain('data-sort-col=');
  });

  test('a blank label leaves its header blank instead of showing the column key', () => {
    const window = loadLex();
    const html = clientTable(window, { columns: 'name,actions', labels: 'Name,' }).render();
    expect(html).not.toMatch(/>\s*actions\s*</);
    const auto = clientTable(window, { columns: 'name,workspace', labels: 'Name' }).render();
    expect(auto).toContain('workspace');
  });

    test('client-side tables still page and sort in memory', () => {
    const window = loadLex();
    const table = new window['lex-table']();
    Object.assign(table, { limit: 2, columns: 'name' });
    table.setData([{ id: 1, name: 'c' }, { id: 2, name: 'a' }, { id: 3, name: 'b' }]);

    table.dataSource.setSort('name', 'asc');
    expect(table.dataSource.data.map((r) => r.name)).toEqual(['a', 'b']);
    expect(table.dataSource.pagination).toMatchObject({ page: 1, totalPages: 2, total: 3 });
    expect(table.events.some((e) => e.name === 'lex-query-change')).toBe(false);
  });
});

describe('lex-table page-supplied column filters', () => {
  const OPTIONS = {
    name: { options: [{ value: 'pdf', label: 'PDFs' }, { value: 'spreadsheet', label: 'Spreadsheets' }] },
    updated_at: { single: true, options: [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }] }
  };

  function filteredServerTable(window) {
    const table = serverTable(window, { columnFilters: true });
    table.setColumnFilterOptions(OPTIONS);
    table.setServerData([{ id: 'a', name: 'A.pdf', workspace: 'W', updated_at: '' }], { page: 1, limit: 20, total: 1 });
    return table;
  }

  test('server mode shows a filter only on columns the page supplied values for', () => {
    const window = loadLex();
    const html = filteredServerTable(window).render();
    expect(html).toContain('data-col-filter="name"');
    expect(html).toContain('data-col-filter="updated_at"');
    expect(html).not.toContain('data-col-filter="workspace"');
  });

  test('the dropdown lists the supplied labels, with radios for single-choice columns', () => {
    const window = loadLex();
    const table = filteredServerTable(window);
    expect(table._renderColFilterDropdown('name')).toContain('type="checkbox" name="lex-col-filter-name" data-col-check="pdf"');
    expect(table._renderColFilterDropdown('name')).toContain('PDFs');
    expect(table._renderColFilterDropdown('updated_at')).toContain('type="radio"');
    expect(table._renderColFilterDropdown('updated_at', true)).toContain('lex-th-filter-dropdown--end');
  });

  test('a long list gets a search box', () => {
    const window = loadLex();
    const table = filteredServerTable(window);
    const many = Array.from({ length: 13 }, (_, i) => ({ value: 'w' + i, label: 'Workspace ' + i }));
    table.setColumnFilterOptions({ workspace: { options: many } });
    expect(table._renderColFilterDropdown('workspace')).toContain('data-col-filter-search');
    expect(table._renderColFilterDropdown('name')).not.toContain('data-col-filter-search');
  });

  test('applying a filter asks the page for page 1 with the selection', () => {
    const window = loadLex();
    const table = filteredServerTable(window);
    table.dataSource.setFilter('name', 'in', ['pdf', 'spreadsheet']);
    const query = lastEvent(table, 'lex-query-change').detail;
    expect(query.page).toBe(1);
    expect(query.filters.name).toEqual({ operator: 'in', value: ['pdf', 'spreadsheet'] });
    expect(table._renderColFilterDropdown('name')).toContain('data-col-check="pdf" checked');
  });

  test('a filtered empty table offers Clear filters instead of the create button', () => {
    const window = loadLex();
    const table = filteredServerTable(window);
    table.emptyActionLabel = 'New Document';
    table.dataSource.setFilter('name', 'in', ['pdf']);
    table.setServerData([], { page: 1, limit: 20, total: 0 });
    const html = table.render();
    expect(html).toContain('action-label="Clear filters"');
    expect(html).toContain('data-empty-mode="clear-filters"');
    expect(html).not.toContain('New Document');
  });

  test('a server error while filtered offers Clear filters; unfiltered errors do not', () => {
    const window = loadLex();
    const table = filteredServerTable(window);
    table.setServerError('Validation failed');
    expect(table.render()).not.toContain('clear-col-filters');
    table.dataSource.setFilter('name', 'in', ['pdf', 'spreadsheet']);
    table.setServerError('Validation failed');
    expect(table.render()).toContain('data-action="clear-col-filters"');
    table.dataSource.clearFilters();
    expect(lastEvent(table, 'lex-query-change').detail.filters).toEqual({});
  });

    test('client tables keep deriving filter values from their rows', () => {
    const window = loadLex();
    const table = new window['lex-table']();
    Object.assign(table, { limit: 20, columns: 'status', columnFilters: true });
    table.setData([{ id: 1, status: 'Open' }, { id: 2, status: 'Closed' }]);
    expect(table.render()).toContain('data-col-filter="status"');
    const dropdown = table._renderColFilterDropdown('status');
    expect(dropdown).toContain('data-col-check="Closed"');
    expect(dropdown).toContain('data-col-check="Open"');
  });
});

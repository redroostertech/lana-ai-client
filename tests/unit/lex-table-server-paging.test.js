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

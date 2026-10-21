'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const builders = require('../../src/js/shared/list-query-params.js');

const SOURCE_PATH = path.join(__dirname, '../../src/js/pages/my-tasks.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeTable() {
  const listeners = {};
  const table = {
    query: { page: 1, limit: 20, sortBy: 'updated_at', sortDir: 'desc', search: '', filters: {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setCellRenderers: jest.fn(),
    setColumnFilterOptions: jest.fn(),
    setServerData: jest.fn(),
    setServerError: jest.fn(),
    dataSource: { pagination: { total: 0 } },
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler); },
    requestServerQuery(options) {
      if (options && options.resetPage) table.query.page = 1;
      (listeners['lex-query-change'] || []).forEach((handler) => handler({ target: table, detail: table.query }));
    },
  };
  table.setServerData.mockImplementation((rows, pagination) => { table.dataSource.pagination = pagination; });
  return table;
}

function load(getMyTasks) {
  const table = makeTable();
  const registry = { myTasksTable: table };
  const Lex = {
    Auth: { user: { id: 'u1' } },
    Utils: {
      escapeHtml: (value) => String(value == null ? '' : value),
      formatDate: (value) => String(value || ''),
      formatDateTime: (value) => String(value || ''),
    },
    Toast: { warning: jest.fn(), error: jest.fn(), success: jest.fn() },
    Modal: { confirm: jest.fn() },
    Nav: { go: jest.fn() },
  };
  const api = { getMyTasks: jest.fn(getMyTasks), get: jest.fn().mockResolvedValue({}) };
  const window = { Lex, api, location: { search: '' }, LanaListQueryParams: builders };
  const sandbox = {
    window,
    document: {
      getElementById: (id) => registry[id] || null,
      addEventListener() {},
      createElement: () => ({ setAttribute() {}, classList: { add() {} } }),
      body: { appendChild() {} },
    },
    Lex,
    api,
    LanaTime: { nowMs: () => 0, nowIso: () => '' },
    requestAnimationFrame: (fn) => fn(),
    URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, sandbox, { filename: SOURCE_PATH });
  return { table, api };
}

describe('My Tasks server paging', () => {
  test('each table page is one request with offset; rows keep raw codes', async () => {
    const { table, api } = load(async (params) => ({
      status: 'success',
      data: {
        tasks: [{ id: 't1', title: 'Draft', status: 'completed', priority: 'HIGH', matter_id: 'MATT-1' }],
        total: 230,
        pagination: { total: 230, limit: Number(params.limit), offset: Number(params.offset) },
      },
    }));
    await flush();
    expect(api.getMyTasks).toHaveBeenCalledTimes(1);
    expect(api.getMyTasks.mock.calls[0][0]).toMatchObject({ limit: '20', offset: '0', sort_by: 'updated_at', sort_dir: 'DESC' });
    const [rows, pagination] = table.setServerData.mock.calls[0];
    expect(pagination).toMatchObject({ page: 1, limit: 20, total: 230 });
    expect(rows[0]).toMatchObject({ status: 'complete', priority: 'high', workspace_matter: 'MATT-1' });

    table.query = Object.assign({}, table.query, { page: 12 });
    table.requestServerQuery();
    await flush();
    expect(api.getMyTasks.mock.calls[1][0]).toMatchObject({ limit: '20', offset: '220' });
    expect(table.setServerData.mock.calls[1][1]).toMatchObject({ page: 12, total: 230 });
  });

  test('a server that ignores offset: pages within its 100-row limit come from one larger request', async () => {
    const all = Array.from({ length: 100 }, (_, i) => ({ id: 't' + i, title: 'Task ' + i }));
    const { table, api } = load(async (params) => ({
      data: { tasks: all.slice(0, Number(params.limit)), total: 150, pagination: { total: 150, limit: Number(params.limit), offset: 0 } },
    }));
    await flush();
    table.query = Object.assign({}, table.query, { page: 2 });
    table.requestServerQuery();
    await flush();
    const retry = api.getMyTasks.mock.calls[api.getMyTasks.mock.calls.length - 1][0];
    expect(retry.limit).toBe('40');
    expect(retry.offset).toBeUndefined();
    const [rows, pagination] = table.setServerData.mock.calls[1];
    expect(rows.map((r) => r.id)).toEqual(all.slice(20, 40).map((t) => t.id));
    expect(pagination).toMatchObject({ page: 2, total: 150 });
  });

  test('a server that ignores offset: past 100 rows it says so instead of repeating page 1', async () => {
    const { table } = load(async () => ({
      data: { tasks: [{ id: 't1', title: 'A' }], total: 150, pagination: { total: 150, limit: 20, offset: 0 } },
    }));
    await flush();
    table.query = Object.assign({}, table.query, { page: 6 });
    table.requestServerQuery();
    await flush();
    expect(table.setServerData).toHaveBeenCalledTimes(1);
    expect(table.setServerError).toHaveBeenCalledWith(expect.stringContaining('only show the first 100 tasks'));
  });

  test('a failed load shows the table error state', async () => {
    const { table } = load(async () => { throw new Error('offline'); });
    await flush();
    expect(table.setServerError).toHaveBeenCalledWith(expect.stringContaining('Check your connection'));
  });
});

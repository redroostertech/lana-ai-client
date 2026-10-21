'use strict';

const DrilldownRenderer = require('../../src/js/drilldown-renderer');
const PERIOD = { periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z' };
const CONTEXT = { moduleKey: 'example', metricKey: 'stock', organizationId: 'host-org' };

function element() {
  return { classList: { add: jest.fn(), remove: jest.fn() }, value: '', textContent: '', click: jest.fn() };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('drilldown metadata request contract', () => {
  let renderer;
  let nodes;
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    nodes = new Map();
    global.document = {
      body: { classList: { add: jest.fn(), remove: jest.fn() }, appendChild: jest.fn(), removeChild: jest.fn() },
      getElementById: jest.fn(id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }),
      createElement: jest.fn(() => element())
    };
    global.window = { api: { get: jest.fn(), post: jest.fn().mockResolvedValue({ data: { rows: [], values: [] } }) },
      Lex: { Toast: { error: jest.fn() } },
      URL: { createObjectURL: jest.fn(() => 'blob:mock'), revokeObjectURL: jest.fn() } };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { rows: [], values: [] } }), blob: async () => ({}) });
    global.alert = jest.fn();
    global.LanaTime = { formatUtcDateOnly: () => '2026-10-17' };
    renderer = new DrilldownRenderer();
    renderer.init = jest.fn(() => { renderer.modal = element(); });
    renderer.showLoading = jest.fn();
    renderer.showError = jest.fn();
    renderer.injectCustomCSS = jest.fn();
    renderer.render = jest.fn();
    renderer.getAuthToken = jest.fn(() => 'synthetic-token');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ['window', 'document', 'fetch', 'alert', 'LanaTime']) delete global[key];
  });

  function metadata(mode, extra = {}) {
    const drilldown = { title: 'Example', columns: [], ...extra };
    if (mode !== undefined) drilldown.temporal_mode = mode;
    window.api.get.mockResolvedValue({ drilldown });
  }
  function configure(mode) {
    renderer.currentConfig = { ...CONTEXT, ...PERIOD, extraFilters: {}, ...(mode === undefined ? {} : { temporal_mode: mode }) };
    renderer.filters = { status: ['open'], source: ['source-qualified-key'] };
    renderer.searchQuery = 'Needle';
    renderer.sortBy = 'value';
    renderer.sortDirection = 'desc';
    renderer.currentPage = 3;
  }
  function fetchBody() { return JSON.parse(fetch.mock.calls[0][1].body); }

  test('current snapshot fetches metadata and executes without caller dates', async () => {
    metadata('current_snapshot');
    await renderer.open('example', 'stock', { organizationId: 'host-org' });
    expect(window.api.get).toHaveBeenCalledTimes(1);
    expect(window.api.post).toHaveBeenCalledTimes(1);
    expect(window.api.post.mock.calls[0][1]).not.toHaveProperty('periodStart');
    expect(window.api.post.mock.calls[0][1]).not.toHaveProperty('periodEnd');
    expect(renderer.showError).not.toHaveBeenCalled();
  });
  test.each([undefined, 'report_period'])('legacy mode %s retains dates and selectors', async mode => {
    metadata(mode);
    await renderer.open('example', 'stock', { ...PERIOD, organizationId: 'host-org', pipeline_id: 'pipeline', position: 2 });
    expect(window.api.post.mock.calls[0][1]).toMatchObject({ ...PERIOD, organizationId: 'host-org', pipeline_id: 'pipeline', position: 2 });
  });
  test('actual dated funnel caller preserves empty selectors and position zero across endpoints', async () => {
    metadata(undefined);
    await renderer.open('funnel-analysis-attribution', 'funnel_stage_progression', { ...PERIOD, drill_source: '', pipeline_id: '', position: 0 });
    expect(window.api.post.mock.calls[0][1]).toMatchObject({ ...PERIOD, drill_source: '', pipeline_id: '', position: 0 });
    await renderer.fetchDistinctValues('status');
    expect(window.api.post.mock.calls[1][1]).toMatchObject({ ...PERIOD, drill_source: '', pipeline_id: '', position: 0 });
    await renderer.exportData('csv');
    expect(fetchBody()).toMatchObject({ ...PERIOD, drill_source: '', pipeline_id: '', position: 0 });
  });
  test('acquisition source drilldown retains reporting window and qualified source/currency selectors', async () => {
    const channel = JSON.stringify(['acquisition', 'host-org', 'source', 'integration-a', 'crm', 'Referral']);
    metadata('report_period');
    await renderer.open('funnel-analysis-attribution', 'top_performing_sources', {
      ...PERIOD, organizationId: 'host-org', filters: { channel_key: [channel], currency: ['EUR'] }
    });
    expect(window.api.post.mock.calls[0][1]).toMatchObject({ ...PERIOD, filters: { channel_key: [channel], currency: ['EUR'] } });
    await renderer.exportData('csv');
    expect(fetchBody()).toMatchObject({ ...PERIOD, filters: { channel_key: [channel], currency: ['EUR'] } });
  });
  test('legacy browser execute and distinct preserve date shape', async () => {
    configure(undefined); window.api = null;
    await renderer.fetchData();
    expect(fetchBody()).toMatchObject({ ...PERIOD, page: 3, pageSize: 20 });
    fetch.mockClear();
    await renderer.fetchDistinctValues('status');
    expect(fetchBody()).toMatchObject({ ...PERIOD, search: 'Needle', filters: { source: ['source-qualified-key'] } });
    expect(fetchBody()).not.toHaveProperty('sortBy');
  });
  test('browser metadata fetch reaches current-snapshot execution without dates', async () => {
    window.api = null;
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ drilldown: { temporal_mode: 'current_snapshot', columns: [] } }) });
    await renderer.open('example', 'stock', {});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('periodStart');
  });
  test.each([undefined, 'report_period'])('legacy mode %s visibly refuses missing dates after metadata', async mode => {
    metadata(mode);
    await renderer.open('example', 'stock', {});
    expect(window.api.get).toHaveBeenCalledTimes(1);
    expect(window.api.post).not.toHaveBeenCalled();
    expect(renderer.showError).toHaveBeenCalledWith(expect.stringContaining('periodStart'));
  });
  test.each([null, '', 'current', 7, {}])('unknown temporal metadata %p cannot execute', async mode => {
    metadata(mode);
    await renderer.open('example', 'stock', PERIOD);
    expect(window.api.post).not.toHaveBeenCalled();
    expect(renderer.showError).toHaveBeenCalledWith(expect.stringContaining('temporal_mode'));
  });
  test('initial supported selectors and default-sort precedence survive open', async () => {
    metadata('current_snapshot', { defaultSort: { field: 'value', direction: 'desc' } });
    await renderer.open('example', 'stock', { ...PERIOD, filters: { status: ['active'] }, search: 'Needle', sortBy: 'source', sortDirection: 'asc' });
    expect(window.api.post.mock.calls[0][1]).toMatchObject({ filters: { status: ['active'] }, search: 'Needle', sortBy: 'source', sortDirection: 'asc' });
    expect(window.api.post.mock.calls[0][1]).not.toHaveProperty('periodStart');
  });
  test('metadata default sort remains effective without explicit caller sorting', async () => {
    metadata('current_snapshot', { defaultSort: { field: 'value', direction: 'desc' } });
    await renderer.open('example', 'stock', {});
    expect(window.api.post.mock.calls[0][1]).toMatchObject({ sortBy: 'value', sortDirection: 'desc' });
  });
  test('unknown mode in stored UI state refuses all three endpoints before transport', async () => {
    configure('future_mode');
    await renderer.fetchData();
    expect(renderer.showError).toHaveBeenCalledWith(expect.stringContaining('temporal_mode'));
    expect((await renderer.fetchDistinctValues('status')).error).toContain('temporal_mode');
    await renderer.exportData('csv');
    expect(window.api.post).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  test('new open clears prior view selectors and failed metadata clears stale config', async () => {
    metadata('report_period');
    renderer.currentViewFilter = 'old'; renderer.currentViewType = 'old';
    await renderer.open('example', 'stock', PERIOD);
    expect(window.api.post.mock.calls[0][1]).not.toHaveProperty('viewFilter');
    metadata('not-supported');
    await renderer.open('example', 'stock', PERIOD);
    expect(renderer.currentConfig).toBeNull();
  });
  test.each(['moduleKey', 'metricKey', 'organizationId', 'periodStart', 'extraFilters'])('metadata cannot overwrite caller-owned %s', async key => {
    metadata('current_snapshot', { [key]: 'override' });
    await renderer.open('example', 'stock', PERIOD);
    expect(window.api.post).not.toHaveBeenCalled();
    expect(renderer.showError).toHaveBeenCalled();
  });
  test.each(['api', 'fetch'])('current execute via %s omits inherited dates and preserves pagination', async transport => {
    configure('current_snapshot');
    if (transport === 'fetch') window.api = null;
    await renderer.fetchData();
    const body = transport === 'api' ? window.api.post.mock.calls[0][1] : fetchBody();
    expect(body).not.toHaveProperty('periodStart');
    expect(body).not.toHaveProperty('periodEnd');
    expect(body).toMatchObject({ page: 3, pageSize: 20, filters: renderer.filters, search: 'Needle', sortBy: 'value', sortDirection: 'desc' });
  });
  test.each(['api', 'fetch'])('current distinct via %s omits dates and only its own filter', async transport => {
    configure('current_snapshot');
    if (transport === 'fetch') window.api = null;
    await renderer.fetchDistinctValues('status');
    const body = transport === 'api' ? window.api.post.mock.calls[0][1] : fetchBody();
    expect(body).not.toHaveProperty('periodStart');
    expect(body).not.toHaveProperty('page');
    expect(body).not.toHaveProperty('sortBy');
    expect(body).toMatchObject({ filters: { source: ['source-qualified-key'] }, search: 'Needle' });
    expect(renderer.filters.status).toEqual(['open']);
  });
  test.each([undefined, 'report_period', 'current_snapshot'])('export %s shares selectors and sort, never paging', async mode => {
    configure(mode);
    renderer.currentConfig.extraFilters = { pipeline_id: 'p', position: 2 };
    renderer.currentViewFilter = { status: 'active' }; renderer.currentViewType = 'table';
    await renderer.exportData('csv');
    expect(fetchBody()).toMatchObject({ format: 'csv', filters: renderer.filters, search: 'Needle', sortBy: 'value', sortDirection: 'desc', pipeline_id: 'p', position: 2, viewFilter: { status: 'active' }, viewType: 'table' });
    expect(fetchBody()).not.toHaveProperty('page');
    if (mode === 'current_snapshot') expect(fetchBody()).not.toHaveProperty('periodStart');
    else expect(fetchBody()).toMatchObject(PERIOD);
  });
  test.each(['periodStart', 'period_start', 'periodEnd', 'organizationId', 'organization_id', 'moduleKey', 'metric_key', 'page', 'pageSize', 'limit', 'offset', 'filters', 'sortBy', 'temporal_mode'])('extra selector cannot override reserved %s', async key => {
    configure('current_snapshot'); renderer.currentConfig.extraFilters = { [key]: 'override' };
    await renderer.fetchData();
    expect(window.api.post).not.toHaveBeenCalled();
    expect(renderer.showError).toHaveBeenCalled();
    const distinct = await renderer.fetchDistinctValues('status');
    expect(distinct.error).toBeTruthy();
    expect(window.api.post).not.toHaveBeenCalled();
    await renderer.exportData('csv');
    expect(fetch).not.toHaveBeenCalled();
    expect(window.Lex.Toast.error).toHaveBeenCalled();
  });
  test('reserved browser-transport override refuses without dropping into another request', async () => {
    configure('current_snapshot'); window.api = null;
    renderer.currentConfig.extraFilters = { periodStart: PERIOD.periodStart };
    await renderer.fetchData();
    expect((await renderer.fetchDistinctValues('status')).error).toBeTruthy();
    await renderer.exportData('excel');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('reverse metadata completion cannot replace the newer open context', async () => {
    const first = deferred(); const second = deferred();
    window.api.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldOpen = renderer.open('first-module', 'old-metric', {});
    const newOpen = renderer.open('second-module', 'new-metric', {});
    second.resolve({ drilldown: { temporal_mode: 'current_snapshot', title: 'New', columns: [] } });
    await newOpen;
    first.resolve({ drilldown: { temporal_mode: 'current_snapshot', title: 'Old', columns: [] } });
    await oldOpen;
    expect(renderer.currentConfig.metricKey).toBe('new-metric');
    expect(renderer.modal.heading).toBe('New');
    expect(window.api.post).toHaveBeenCalledTimes(1);
    expect(window.api.post.mock.calls[0][0]).toContain('/second-module/metrics/new-metric/');
  });
  test('old metadata rejection cannot clear a newer successful context', async () => {
    const first = deferred();
    metadata('current_snapshot');
    window.api.get.mockReturnValueOnce(first.promise);
    const oldOpen = renderer.open('example', 'old', {});
    await renderer.open('example', 'new', {});
    first.reject(new Error('Old metadata failed'));
    await oldOpen;
    expect(renderer.currentConfig.metricKey).toBe('new');
    expect(renderer.showError).not.toHaveBeenCalled();
  });
  test.each(['resolve', 'reject'])('old data %s cannot overwrite a newer open success', async settle => {
    configure('current_snapshot');
    const first = deferred();
    window.api.post.mockReturnValueOnce(first.promise);
    const oldData = renderer.fetchData();
    metadata('current_snapshot');
    window.api.post.mockResolvedValueOnce({ data: { rows: [{ label: 'new' }] } });
    await renderer.open('example', 'new', {});
    if (settle === 'resolve') first.resolve({ data: { rows: [{ label: 'old' }] } });
    else first.reject(new Error('Old data failed'));
    await oldData;
    expect(renderer.currentConfig.metricKey).toBe('new');
    expect(renderer.currentData.rows).toEqual([{ label: 'new' }]);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.showError).not.toHaveBeenCalled();
  });
  test('newer pagination request wins within the same open context', async () => {
    configure('current_snapshot');
    const first = deferred();
    window.api.post.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data: { rows: [{ label: 'page4' }] } });
    const oldData = renderer.fetchData();
    renderer.currentPage = 4;
    await renderer.fetchData();
    first.resolve({ data: { rows: [{ label: 'page3' }] } });
    await oldData;
    expect(renderer.currentData.rows).toEqual([{ label: 'page4' }]);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });
  test.each(['resolve', 'reject'])('browser delayed response.json %s cannot replace newer data', async settle => {
    configure('current_snapshot'); window.api = null;
    const body = deferred(); const reading = deferred();
    fetch.mockResolvedValueOnce({ ok: true, json: () => { reading.resolve(); return body.promise; } })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { rows: [{ label: 'new' }] } }) });
    const oldData = renderer.fetchData();
    await reading.promise;
    renderer.currentPage = 4;
    await renderer.fetchData();
    if (settle === 'resolve') body.resolve({ data: { rows: [{ label: 'old' }] } });
    else body.reject(new Error('Old body failed'));
    await oldData;
    expect(renderer.currentData.rows).toEqual([{ label: 'new' }]);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.showError).not.toHaveBeenCalled();
  });
  test('active request failure is still visible, not swallowed by generation checks', async () => {
    configure('current_snapshot');
    window.api.post.mockRejectedValueOnce(new Error('Current data failed'));
    await renderer.fetchData();
    expect(renderer.showError).toHaveBeenCalledWith('Current data failed');
    expect(renderer.render).not.toHaveBeenCalled();
  });
  test.each(['unchanged', 'close', 'new-open'])('delayed export completes with original filename after %s', async change => {
    configure('current_snapshot');
    const pending = deferred(); const reading = deferred();
    fetch.mockResolvedValueOnce({ ok: true, blob: () => { reading.resolve(); return pending.promise; } });
    const exporting = renderer.exportData('csv');
    await reading.promise;
    if (change === 'close') renderer.close();
    if (change === 'new-open') {
      metadata('current_snapshot');
      await renderer.open('other-module', 'other-metric', {});
    }
    LanaTime.formatUtcDateOnly = () => '2026-10-18';
    pending.resolve({ original: true });
    await exporting;
    expect(fetch.mock.calls[0][0]).toContain('/example/metrics/stock/drilldown/export');
    const anchor = document.createElement.mock.results[0].value;
    expect(anchor.download).toBe('stock_2026-10-17.csv');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    expect(alert).not.toHaveBeenCalled();
  });

  function fakeTable() {
    return {
      attrs: {},
      setAttribute: jest.fn(function (name, value) { this.attrs[name] = value; }),
      setCellRenderers: jest.fn(),
      setColumnFilterOptions: jest.fn(),
      restoreQuery: jest.fn(),
      setServerData: jest.fn(),
      hidden: true
    };
  }
  async function flush() { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }

  test.each([false, true, undefined])('column filterable %s controls both the header filter and direct fetch', async filterable => {
    configure('current_snapshot');
    renderer.currentConfig.columns = [{ field: 'value', header: 'Amount', type: 'text', filterable }];
    window.api.post.mockResolvedValue({ data: { values: [{ value: '-9007199254740993.0123456789', count: 1 }] } });
    const table = fakeTable();
    renderer.configureTable(table);
    await flush();
    expect(table.attrs.columns).toBe('value,_actions');
    expect(table.attrs.labels).toBe('Amount,');
    expect(window.api.post).toHaveBeenCalledTimes(filterable === false ? 0 : 1);
    const last = table.setColumnFilterOptions.mock.calls.at(-1)[0];
    if (filterable === false) expect(last).not.toHaveProperty('value');
    else expect(last.value.options).toEqual([{ value: '-9007199254740993.0123456789', label: '-9007199254740993.0123456789' }]);
    const renderers = table.setCellRenderers.mock.calls[0][0];
    expect(renderers.value('-9007199254740993.0123456789')).toContain('-9007199254740993.0123456789');
    expect((await renderer.fetchDistinctValues('value')).error).toBe(filterable === false ? 'Filtering is not supported for this column' : undefined);
  });
  test('facet labels are presentation only: duplicate source labels retain distinct qualified values and null sentinel', async () => {
    configure('current_snapshot');
    renderer.currentConfig.columns = [{ field: 'source', header: 'Source' }];
    renderer.renderActiveFilters = jest.fn();
    const keys = ['["connector","org","a","crm"]', '["connector","org","b","crm"]', 'null'];
    const options = DrilldownRenderer.filterOptionsFor({ field: 'source' }, keys.map((value, index) => ({ value,
      label: index === 2 ? 'Unknown provenance' : 'Same source', count: 1 })));
    expect(options.map(o => o.value)).toEqual(keys);
    expect(options.map(o => o.label)).toEqual(['Same source', 'Same source', 'Unknown provenance']);
    renderer.applyTableQuery({ page: 1, limit: 20, filters: { source: { operator: 'in', value: keys } } });
    await flush();
    expect(renderer.filters.source).toEqual(keys);
    expect(window.api.post.mock.calls[0][1].filters.source).toEqual(keys);
  });
  test.each(['unchanged', 'close', 'new-open'])('distinct filter options are owned by the original context: %s', async change => {
    configure('current_snapshot');
    renderer.currentConfig.columns = [{ field: 'status', header: 'Status' }];
    const pending = deferred();
    window.api.post.mockReturnValueOnce(pending.promise);
    const table = fakeTable();
    renderer.configureTable(table);
    if (change === 'close') renderer.close();
    if (change === 'new-open') { metadata('current_snapshot'); await renderer.open('example', 'new', {}); }
    pending.resolve({ data: { values: [{ value: 'old-status', count: 1 }] } });
    await flush();
    const applied = table.setColumnFilterOptions.mock.calls.slice(1).map(call => call[0]);
    if (change === 'unchanged') expect(applied).toEqual([{ status: { options: [{ value: 'old-status', label: 'old-status' }] } }]);
    else expect(applied).toEqual([]);
  });
  test('a table query maps page, size, sort and column filters, keeping report selectors', async () => {
    configure('current_snapshot');
    renderer.currentConfig.columns = [{ field: 'status', header: 'Status' }, { field: 'value', header: 'Value' }];
    renderer.renderActiveFilters = jest.fn();
    renderer.filters = { status: ['old'], source: ['source-qualified-key'] };
    renderer.applyTableQuery({ page: 2, limit: 50, sortBy: 'value', sortDir: 'desc', filters: { status: { operator: 'in', value: ['open', 'won'] } } });
    await flush();
    expect(window.api.post.mock.calls[0][1]).toMatchObject({ page: 2, pageSize: 50, sortBy: 'value', sortDirection: 'desc',
      filters: { status: ['open', 'won'], source: ['source-qualified-key'] } });
    renderer.applyTableQuery({ page: 1, limit: 50, filters: {} });
    await flush();
    expect(window.api.post.mock.calls[1][1].filters).toEqual({ source: ['source-qualified-key'] });
    expect(window.api.post.mock.calls[1][1].page).toBe(1);
  });
  test('table helpers: attributes, rows with raw values, filter state and badge colours', () => {
    const attrs = DrilldownRenderer.tableAttributes([{ field: 'a', header: 'A, b' }, { field: 'b', header: 'B', sortable: false }, {}]);
    expect(attrs).toEqual({ columns: 'a,b,_actions', labels: 'A  b,B,', sortableColumns: 'a' });
    const rows = DrilldownRenderer.tableRows([{ a: '2026-10-01T00:00:00Z' }], 3, 20);
    expect(rows[0]).toMatchObject({ a: '2026-10-01T00:00:00Z', _row_id: '40', _row_index: 0 });
    expect(rows[0]._raw).toEqual({ a: '2026-10-01T00:00:00Z' });
    expect(DrilldownRenderer.tableFilterState({ a: 'x', b: ['y'], hidden: ['z'] }, ['a', 'b']))
      .toEqual({ a: { operator: 'in', value: ['x'] }, b: { operator: 'in', value: ['y'] } });
    expect(DrilldownRenderer.badgeColor('bg-orange-100 text-orange-800')).toBe('yellow');
    expect(DrilldownRenderer.badgeColor('bg-purple-100')).toBe('indigo');
    expect(DrilldownRenderer.badgeColor('')).toBe('gray');
    expect(DrilldownRenderer.filterOptionsFor({ type: 'badge' }, [{ value: 'in_pipeline', count: 2 }, { value: '', count: 1 }]))
      .toEqual([{ value: 'in_pipeline', label: 'In pipeline' }]);
  });
  test('close invalidates pending metadata without a subsequent data request', async () => {
    const pending = deferred();
    window.api.get.mockReturnValueOnce(pending.promise);
    const opening = renderer.open('example', 'stock', {});
    renderer.close();
    pending.resolve({ drilldown: { temporal_mode: 'current_snapshot', columns: [] } });
    await opening;
    expect(renderer.currentConfig).toBeNull();
    expect(window.api.post).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
  });
  test.each(['resolve', 'reject'])('close invalidates pending data %s', async settle => {
    configure('current_snapshot');
    const pending = deferred();
    window.api.post.mockReturnValueOnce(pending.promise);
    const fetching = renderer.fetchData();
    renderer.close();
    if (settle === 'resolve') pending.resolve({ data: { rows: [{ label: 'old' }] } });
    else pending.reject(new Error('Closed request failed'));
    await fetching;
    expect(renderer.currentData).toBeNull();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.showError).not.toHaveBeenCalled();
  });
});

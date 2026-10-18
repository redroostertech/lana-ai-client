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
  test('legacy browser execute and distinct preserve date shape', async () => {
    configure(undefined); window.api = null;
    await renderer.fetchData();
    expect(fetchBody()).toMatchObject({ ...PERIOD, page: 3, pageSize: 25 });
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
    expect(body).toMatchObject({ page: 3, pageSize: 25, filters: renderer.filters, search: 'Needle', sortBy: 'value', sortDirection: 'desc' });
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
    expect(alert).toHaveBeenCalled();
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
    expect(nodes.get('drilldown-title').textContent).toBe('New');
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

  function popoverFixture() {
    const attached = new Set();
    const subnodes = new Map();
    function interactive() {
      const node = element(); node.handlers = {};
      node.addEventListener = jest.fn((event, handler) => { node.handlers[event] = handler; });
      node.querySelectorAll = () => [];
      node.querySelector = () => null;
      return node;
    }
    const pop = interactive();
    pop.remove = jest.fn(() => attached.delete(pop));
    pop.contains = target => target === pop;
    pop.querySelector = selector => {
      if (!subnodes.has(selector)) subnodes.set(selector, interactive());
      return subnodes.get(selector);
    };
    const baseLookup = document.getElementById;
    document.getElementById = jest.fn(id => id.startsWith('drilldown-col-') ? (attached.has(pop) && pop.id === id ? pop : null) : baseLookup(id));
    document.createElement.mockReturnValue(pop);
    document.body.appendChild.mockImplementation(node => attached.add(node));
    document.body.contains = node => attached.has(node);
    document.addEventListener = jest.fn(); document.removeEventListener = jest.fn();
    renderer._positionPopover = jest.fn();
    renderer.escapeHtml = value => String(value); // Synthetic labels only; not an escaping proof.
    renderer.renderActiveFilters = jest.fn();
    jest.spyOn(global, 'setTimeout').mockImplementation(callback => { callback(); return 0; });
    return { pop, subnodes, attached, anchor: { getBoundingClientRect: () => ({}) } };
  }
  test.each([false, true, undefined])('column filterable %s controls both affordance and direct fetch', async filterable => {
    configure('current_snapshot');
    renderer.currentConfig.columns = [{ field: 'value', header: 'Amount', type: 'text', filterable }];
    renderer.currentData = { rows: [{ value: '-9007199254740993.0123456789' }] };
    const filter = { dataset: { colFilter: 'value' }, addEventListener: jest.fn() };
    document.querySelectorAll = selector => selector === '[data-col-filter]' && filterable !== false ? [filter] : [];
    renderer.openColumnFilterPopover = jest.fn();
    renderer.renderActiveFilters = jest.fn(); renderer.attachTooltipHandlers = jest.fn();
    renderer.renderTable();
    const html = nodes.get('drilldown-table-header').innerHTML;
    expect(html.includes('data-col-filter="value"')).toBe(filterable !== false);
    if (filterable !== false) {
      const event = { stopPropagation: jest.fn() };
      filter.addEventListener.mock.calls[0][1](event);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
      expect(renderer.openColumnFilterPopover).toHaveBeenCalledWith(filter, renderer.currentConfig.columns[0]);
      expect(html).toContain('cursor-pointer');
    }
    expect(nodes.get('drilldown-table-body').innerHTML).toContain('-9007199254740993.0123456789');
    await renderer.fetchDistinctValues('value');
    expect(window.api.post).toHaveBeenCalledTimes(filterable === false ? 0 : 1);
  });
  test('facet labels are presentation only: duplicate source labels retain distinct qualified values and null sentinel', async () => {
    configure('current_snapshot');
    const fixture = popoverFixture();
    const keys = ['["connector","org","a","crm"]', '["connector","org","b","crm"]', 'null'];
    renderer.filters = { source: keys };
    window.api.post.mockResolvedValueOnce({ data: { values: keys.map((value, index) => ({ value,
      label: index === 2 ? 'Unknown provenance' : 'Same source', count: 1 })) } });
    const loading = jest.spyOn(renderer, 'fetchDistinctValues');
    renderer.openColumnFilterPopover(fixture.anchor, { field: 'source', header: 'Source' });
    await loading.mock.results[0].value;
    const html = fixture.subnodes.get('[data-role="body"]').innerHTML;
    expect(html).toContain('Same source'); expect(html).toContain('Unknown provenance');
    fixture.subnodes.get('[data-action="apply"]').handlers.click();
    expect(renderer.filters.source).toEqual(keys);
    expect(window.api.post.mock.calls[1][1].filters.source).toEqual(keys);
  });
  test.each(['unchanged', 'close', 'new-open'])('distinct popover completion is owned by original context: %s', async change => {
    configure('current_snapshot');
    const fixture = popoverFixture();
    const pending = deferred();
    window.api.post.mockReturnValueOnce(pending.promise);
    const loading = jest.spyOn(renderer, 'fetchDistinctValues');
    renderer.openColumnFilterPopover(fixture.anchor, { field: 'status', header: 'Status' });
    if (change === 'close') renderer.close();
    if (change === 'new-open') { metadata('current_snapshot'); await renderer.open('example', 'new', {}); }
    pending.resolve({ data: { values: [{ value: 'old-status', count: 1 }] } });
    await loading.mock.results[0].value;
    if (change === 'unchanged') {
      expect(fixture.subnodes.get('[data-role="body"]').innerHTML).toContain('old-status');
      expect(fixture.attached.has(fixture.pop)).toBe(true);
    } else {
      expect(fixture.attached.has(fixture.pop)).toBe(false);
      expect(fixture.subnodes.get('[data-role="body"]').innerHTML || '').not.toContain('old-status');
    }
  });
  test.each(['apply', 'clear'])('stale popover %s cannot modify newer context while distinct is pending', async action => {
    configure('current_snapshot');
    const fixture = popoverFixture(); const pending = deferred();
    window.api.post.mockReturnValueOnce(pending.promise);
    const loading = jest.spyOn(renderer, 'fetchDistinctValues');
    renderer.openColumnFilterPopover(fixture.anchor, { field: 'status', header: 'Status' });
    metadata('current_snapshot');
    await renderer.open('example', 'new', { filters: { status: ['new-status'] } });
    const calls = window.api.post.mock.calls.length;
    fixture.subnodes.get(`[data-action="${action}"]`).handlers.click();
    expect(renderer.filters).toEqual({ status: ['new-status'] });
    expect(window.api.post).toHaveBeenCalledTimes(calls);
    pending.resolve({ data: { values: [] } });
    await loading.mock.results[0].value;
  });
  test.each(['apply', 'clear'])('active popover %s still updates filters and fetches its own context', async action => {
    configure('current_snapshot');
    const fixture = popoverFixture();
    window.api.post.mockResolvedValueOnce({ data: { values: [{ value: 'open', count: 1 }] } });
    const loading = jest.spyOn(renderer, 'fetchDistinctValues');
    renderer.openColumnFilterPopover(fixture.anchor, { field: 'status', header: 'Status' });
    await loading.mock.results[0].value;
    fixture.subnodes.get(`[data-action="${action}"]`).handlers.click();
    expect(window.api.post).toHaveBeenCalledTimes(2);
    expect(window.api.post.mock.calls[1][0]).toContain('/example/metrics/stock/');
    expect(renderer.currentPage).toBe(1);
    if (action === 'apply') expect(renderer.filters.status).toEqual(['open']);
    else expect(renderer.filters).not.toHaveProperty('status');
    expect(fixture.attached.has(fixture.pop)).toBe(false);
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

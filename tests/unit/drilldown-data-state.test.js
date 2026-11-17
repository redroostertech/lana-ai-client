'use strict';

/**
 * A failed drilldown answers in the backend failure model ({ data_state,
 * data_state_reason }); the drilldown shows the shared DataState block with
 * that reason instead of a raw error message.
 */

const fs = require('fs');
const path = require('path');

const win = {};
new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/shared/data-state.js'), 'utf8'))(win);
global.window = Object.assign(global.window || {}, { DataState: win.DataState });
const DrilldownRenderer = require('../../src/js/drilldown-renderer');

function fakeDocument() {
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || { id, hidden: false, innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {} } });
  return { nodes, getElementById: node };
}

test('a failed request with a data state renders the shared state block', () => {
  global.document = fakeDocument();
  const renderer = Object.create(DrilldownRenderer.prototype);
  const handled = renderer.showFailure({ status: 504, data: { success: false, data_state: 'timeout',
    data_state_reason: 'This took too long to work out. Please try again.' }, message: 'Request failed' });
  expect(handled).toBe(true);
  const state = global.document.nodes['drilldown-state'];
  expect(state.innerHTML).toContain('lex-data-state--timeout');
  expect(state.innerHTML).toContain('took too long');
  expect(state.hidden).toBe(false);
});

test('an error without a data state falls back to the plain error message', () => {
  global.document = fakeDocument();
  const renderer = Object.create(DrilldownRenderer.prototype);
  expect(renderer.showFailure({ message: 'Network error occurred' })).toBe(false);
  expect(global.document.nodes['drilldown-error-message'].textContent).toBe('Network error occurred');
});

test('the drilldown markup has a state container', () => {
  expect(fs.readFileSync(path.join(__dirname, '../../src/js/drilldown-renderer.js'), 'utf8')).toContain('id="drilldown-state"');
});

describe('fetchData', () => {
  function renderer(post) {
    global.document = fakeDocument();
    global.window.api = { post };
    const r = Object.create(DrilldownRenderer.prototype);
    r.currentConfig = { moduleKey: 'm', metricKey: 'k' };
    r.contextGeneration = 1;
    r.dataGeneration = 0;
    r.buildRequestBody = () => ({});
    r.render = jest.fn();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    return r;
  }
  afterEach(() => { delete global.window.api; jest.restoreAllMocks(); });

  test.each(['insufficient_data', 'no_data_source', 'engine_error'])('a 200 with data_state %s shows the state block, not the table', async (state) => {
    const r = renderer(jest.fn().mockResolvedValue({ success: true,
      data: { data_state: state, data_state_reason: 'Plain reason from the backend.', rows: [] } }));
    await r.fetchData();
    expect(r.render).not.toHaveBeenCalled();
    const node = global.document.nodes['drilldown-state'];
    expect(node.innerHTML).toContain('lex-data-state--' + state.replace(/_/g, '-'));
    expect(node.innerHTML).toContain('Plain reason from the backend.');
    expect(node.hidden).toBe(false);
  });

  test('a 200 with data_state ok renders the data', async () => {
    const r = renderer(jest.fn().mockResolvedValue({ success: true, data: { data_state: 'ok', rows: [] } }));
    await r.fetchData();
    expect(r.render).toHaveBeenCalled();
  });

  test('a failed request goes to showFailure', async () => {
    const error = { status: 400, data: { data_state: 'invalid_request', data_state_reason: 'Pick a date range.' }, message: 'Bad Request' };
    const r = renderer(jest.fn().mockRejectedValue(error));
    r.showFailure = jest.fn();
    await r.fetchData();
    expect(r.showFailure).toHaveBeenCalledWith(error);
    expect(r.render).not.toHaveBeenCalled();
  });
});

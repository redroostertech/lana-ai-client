'use strict';

/**
 * DataState.view is the one state model the client renders: the backend
 * failure model plus the goal prompt (goal_input). Dashboards ask for the
 * calm wording; Reports keep theirs.
 */

const fs = require('fs');
const path = require('path');
const sample = require(path.join(__dirname, '../fixtures/dashboard/metric-cards-sample.json'));

function load() {
  const window = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/shared/data-state.js'), 'utf8'))(window);
  return window.DataState;
}

const cards = sample.dashboard_metric_cards_owner_jan_2026.data;
const goalless = cards.find((c) => c.metric_key.endsWith('annual_revenue_target'));
const text = (html) => html.split('<').map((part) => part.slice(part.indexOf('>') + 1)).join(' ').split(/\s+/).join(' ').trim();

test('an ok card has no state', () => {
  expect(load().view(cards[0])).toBe(null);
  expect(load().view(cards[0], { calm: true })).toBe(null);
});

test('a card with goal_input is waiting for a goal and says where to set it', () => {
  const view = load().view(goalless, { calm: true });
  expect(view).toEqual({
    state: 'insufficient_data', title: 'Waiting for a goal', reason: 'Set the Annual Revenue Target goal in the Metric Catalog.',
    waiting: true, action: { label: 'Open the Metric Catalog', href: 'admin/metric-catalog.html?editGoal=legal_firm.finance.annual_revenue_target' },
  });
});

test('a literal no_goal state is treated the same way', () => {
  const view = load().view({ metric_key: 'a.b', data_state: 'no_goal', data_state_reason: 'Set a goal for this number.' }, { calm: true });
  expect(view).toMatchObject({ title: 'Waiting for a goal', reason: 'Set a goal for this number.', waiting: true });
  expect(view.action.href).toBe('admin/metric-catalog.html?editGoal=a.b');
});

test('insufficient data without a goal prompt is calm and keeps the reason', () => {
  const view = load().view({ data_state: 'insufficient_data', data_state_reason: 'There is not enough data in this period to show this number.' }, { calm: true });
  expect(view).toMatchObject({ title: 'Waiting for setup', reason: 'There is not enough data in this period to show this number.', waiting: true, action: null });
});

test('without calm, Reports keep their titles', () => {
  expect(load().view({ data_state: 'insufficient_data' }).title).toBe('Not enough data');
});

test('real failures are not dressed up as waiting', () => {
  expect(load().view({ data_state: 'engine_error', data_state_reason: 'x' }, { calm: true })).toMatchObject({ title: 'Could not work this out', waiting: false });
});

test('the calm render shows the title, reason and catalog link, never $0', () => {
  const html = load().render(goalless, { calm: true });
  expect(html).toContain('lex-data-state--waiting');
  expect(html).toContain('data-data-state-action="admin/metric-catalog.html?editGoal=legal_firm.finance.annual_revenue_target"');
  expect(text(html)).toContain('Waiting for a goal');
  expect(text(html)).toContain('Set the Annual Revenue Target goal in the Metric Catalog.');
  expect(html).not.toContain('$0');
  expect(html).not.toContain('Not enough data');
});

test('the plain render is unchanged for Reports', () => {
  const html = load().render({ data_state: 'insufficient_data', data_state_reason: 'r' });
  expect(html).toBe('<div class="lex-data-state lex-data-state--insufficient-data" role="status"><p class="lex-data-state__title">Not enough data</p><p class="lex-data-state__reason">r</p></div>');
});

test('no data source is its own calm state: connect a data source, with the reason', () => {
  const item = { data_state: 'no_data_source', data_state_reason: 'Connect the app that holds this data to see this number.' };
  expect(load().view(item, { calm: true })).toEqual({ state: 'no_data_source', title: 'Connect a data source',
    reason: 'Connect the app that holds this data to see this number.', waiting: true, action: null });
  const html = load().render(item, { calm: true });
  expect(text(html)).toContain('Connect a data source');
  expect(html).toContain('lex-data-state--waiting');
  expect(load().view(item).title).toBe('No data source');
});

test('not_mapped is a calm waiting state that links to Mappings', () => {
  const item = { data_state: 'not_mapped', data_state_reason: '' };
  expect(load().isProblem(item)).toBe(true);
  expect(load().view(item, { calm: true })).toEqual({ state: 'not_mapped', title: 'Waiting for mappings',
    reason: 'Map your case types to see this number.', waiting: true, action: { label: 'Open Mappings', href: 'settings-v2.html#mappings' } });
  const html = load().render(item, { calm: true });
  expect(html).toContain('data-data-state-action="settings-v2.html#mappings"');
  expect(load().view(item).title).toBe('Not mapped yet');
});

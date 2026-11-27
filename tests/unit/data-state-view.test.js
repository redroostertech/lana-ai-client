'use strict';

/**
 * DataState.view is the one state model the client renders: the backend
 * failure model plus the goal prompt (goal_input). Dashboards ask for the
 * calm wording; Reports keep theirs.
 */

const fs = require('fs');
const path = require('path');
const sample = require(path.join(__dirname, '../fixtures/dashboard/metric-cards-sample.json'));

function load(admin = true) {
  const window = { Lex: { Auth: { isAdmin: () => admin } } };
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

describe('ok with no value (the server now sends null, not 0)', () => {
  test('ok with value null is the calm "No data for these dates" state', () => {
    const view = load().view({ metric_key: 'a.b', data_state: 'ok', value: null }, { calm: true });
    expect(view).toMatchObject({ state: 'no_data', title: 'No data for these dates', waiting: true, action: null });
    expect(view.reason).toBe('Nothing was recorded for these dates.');
    expect(load().isProblem({ data_state: 'ok', value: null })).toBe(true);
  });

  test('a real zero, a list, or a value not sent at all is not touched', () => {
    expect(load().view({ data_state: 'ok', value: 0 }, { calm: true })).toBe(null);
    expect(load().view({ data_state: 'ok', value: [] }, { calm: true })).toBe(null);
    expect(load().view({ data_state: 'ok' }, { calm: true })).toBe(null);
  });

  test('the render never shows 0, $0, NaN or null', () => {
    const html = load().render({ metric_key: 'a.b', data_state: 'ok', value: null, format: 'currency' }, { calm: true });
    expect(text(html)).toBe('No data for these dates Nothing was recorded for these dates.');
    expect(load().render({ data_state: 'ok', value: null })).toContain('No data for these dates');
  });

  test('insufficient_data with value null (an average with no records) stays calm', () => {
    const html = load().render({ metric_key: 'a.avg', data_state: 'insufficient_data', value: null, data_state_reason: 'No records to average for these dates.' }, { calm: true });
    expect(text(html)).toContain('No records to average for these dates.');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('$0');
  });
});

describe('freshness: a calm badge when the data is stale', () => {
  const stale = { stale: true, as_of: '2026-08-10T00:00:00Z', systems: ['ActionStep API'], label: 'Data from ActionStep API as of Aug 10, 2026' };
  test('stale shows the server label as a small badge', () => {
    expect(load().freshnessBadge({ freshness: stale })).toBe(
      '<span class="lex-freshness" title="Data from ActionStep API as of Aug 10, 2026">Data from ActionStep API as of Aug 10, 2026</span>');
  });
  test('nothing when freshness is null, missing or not stale', () => {
    expect(load().freshnessBadge({ freshness: null })).toBe('');
    expect(load().freshnessBadge({})).toBe('');
    expect(load().freshnessBadge(null)).toBe('');
    expect(load().freshnessBadge({ freshness: Object.assign({}, stale, { stale: false }) })).toBe('');
  });
  test('a stale result without a label still says how old it is, in plain words', () => {
    expect(load().freshnessBadge({ freshness: { stale: true, as_of: '2026-08-10T12:00:00Z' } })).toContain('>Data as of Aug 10, 2026<');
    expect(load().freshnessBadge({ freshness: { stale: true } })).toContain('>Data may be out of date<');
  });
  test('the label is escaped', () => {
    expect(load().freshnessBadge({ freshness: { stale: true, label: '<b>x</b>' } })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('comparison_hidden: why there is no comparison', () => {
  test('the server message, in place of a comparison', () => {
    const item = { comparison: null, comparison_hidden: { reason: 'source_stale', message: 'No comparison while ActionStep is behind on syncing.', as_of: '2026-08-10', systems: ['ActionStep API'] } };
    expect(load().comparisonHiddenText(item)).toBe('No comparison while ActionStep is behind on syncing.');
    expect(load().comparisonNote(item)).toBe('<p class="lex-comparison-hidden">No comparison while ActionStep is behind on syncing.</p>');
  });
  test('plain words for each reason when the server sends no message', () => {
    expect(load().comparisonHiddenText({ comparison_hidden: { reason: 'source_stale' } })).toBe('No comparison: the data source has not synced recently.');
    expect(load().comparisonHiddenText({ comparison_hidden: { reason: 'insufficient_history' } })).toBe('No comparison yet: there is not enough history.');
    expect(load().comparisonHiddenText({ comparison_hidden: { reason: 'other' } })).toBe('No comparison for these dates.');
  });
  test('nothing when the comparison is not hidden', () => {
    expect(load().comparisonHiddenText({ comparison: { percent_change: 3 } })).toBe('');
    expect(load().comparisonNote(null)).toBe('');
  });
});

test('not mapped: only admins and org admins get the Open Mappings action', () => {
  const item = { data_state: 'not_mapped', data_state_reason: '' };
  expect(load(false).view(item, { calm: true }).action).toBeNull();
  expect(load(false).render(item, { calm: true })).not.toContain('settings-v2.html#mappings');
  expect(load(true).view(item, { calm: true }).action).toEqual({ label: 'Open Mappings', href: 'settings-v2.html#mappings' });
});

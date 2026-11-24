'use strict';

/**
 * Dashboard layout (pure): the bento order and size of every card, the hero
 * pick, and the greeting. Size comes from the card's shape and order from
 * the server's section and sort order, never from a metric key.
 */

const path = require('path');
const Layout = require(path.join(__dirname, '../../src/js/shared/dashboard-layout.js'));
const sample = require(path.join(__dirname, '../fixtures/dashboard/metric-cards-sample.json'));

const cards = sample.dashboard_metric_cards_owner_jan_2026.data;
const ok = (key, extra) => Object.assign({ metric_key: key, title: key, value: 1, data_state: 'ok' }, extra);
const list = (key, extra) => Object.assign({ metric_key: key, title: key, value: [{ service_label: 'A', value: 1 }], format: 'table', data_state: 'ok' }, extra);
const waiting = (key, extra) => Object.assign({ metric_key: key, title: key, value: null, data_state: 'insufficient_data' }, extra);

describe('cardShape', () => {
  test('a list with rows is a chart, an empty list is not', () => {
    expect(Layout.cardShape(list('a'))).toBe('chart');
    expect(Layout.cardShape(ok('a', { value: [] }))).toBe('state');
  });
  test('a number is a kpi; a measured goal is a goal', () => {
    expect(Layout.cardShape(ok('a'))).toBe('kpi');
    expect(Layout.cardShape(ok('a', { goal: { target_value_resolved: 10, attainment_pct: 50, status: 'yellow' } }))).toBe('goal');
    expect(Layout.cardShape(ok('a', { goal: { status: 'unknown', reason: 'unsupported_goal_type' } }))).toBe('kpi');
  });
  test('a card that is not ok is a state card', () => {
    expect(Layout.cardShape(waiting('a'))).toBe('state');
  });
});

describe('orderCards follows the server order', () => {
  test('section order first, then sort order, then the order received', () => {
    const ordered = Layout.orderCards([
      ok('c', { section: { order: 2000 }, sort_order: 1 }),
      ok('a', { section: { order: 1000 }, sort_order: 5 }),
      ok('b', { section: { order: 1000 }, sort_order: 2 }),
      ok('d'),
      ok('e', { section: { order: 1000 }, sort_order: 2 }),
    ]);
    expect(ordered.map((c) => c.metric_key)).toEqual(['b', 'e', 'a', 'c', 'd']);
  });
});

describe('pickHero', () => {
  test('the first ok single number in order', () => {
    expect(Layout.pickHero([waiting('w'), list('l'), ok('first'), ok('second')]).metric_key).toBe('first');
  });
  test('none when nothing qualifies', () => {
    expect(Layout.pickHero([waiting('w'), list('l')])).toBe(null);
    expect(Layout.pickHero([])).toBe(null);
  });
  test('on the real sample it is the first ok number by section order', () => {
    expect(Layout.pickHero(Layout.orderCards(cards)).metric_key).toBe('legal_firm.finance.average_case_value');
  });
});

describe('buildLayout', () => {
  test('hero band, then wide charts, then supporting cards', () => {
    const items = Layout.buildLayout([
      waiting('w1'), ok('k1'), list('l1'), ok('k2'), ok('k3'), ok('k4'), ok('k5'), ok('k6'), list('l2'),
      ok('g1', { goal: { target_value_resolved: 10, attainment_pct: 50, status: 'yellow' } }),
    ]);
    expect(items.map((i) => [i.card.metric_key, i.role, i.span])).toEqual([
      ['k1', 'hero', 2],
      ['k2', 'kpi', 1], ['k3', 'kpi', 1], ['k4', 'kpi', 1], ['k5', 'kpi', 1],
      ['l1', 'chart', 2], ['l2', 'chart', 2],
      ['k6', 'support', 1], ['g1', 'support', 1], ['w1', 'support', 1],
    ]);
  });

  test('goal cards and numbers can fill the kpi band, state cards never do', () => {
    const items = Layout.buildLayout([ok('k1'), waiting('w1'), ok('g1', { goal: { target_value_resolved: 10, attainment_pct: 50, status: 'red' } })]);
    expect(items.map((i) => [i.card.metric_key, i.role])).toEqual([['k1', 'hero'], ['g1', 'kpi'], ['w1', 'support']]);
  });

  test('no hero when there is no ok number', () => {
    expect(Layout.buildLayout([waiting('w'), list('l')]).map((i) => i.role)).toEqual(['chart', 'support']);
  });

  test('empty in, empty out', () => {
    expect(Layout.buildLayout([])).toEqual([]);
    expect(Layout.buildLayout(null)).toEqual([]);
  });
});

describe('greeting', () => {
  const at = (h) => new Date(2026, 10, 24, h, 0, 0);
  test('names the part of the day and the first name', () => {
    expect(Layout.greeting(at(9), { first_name: 'Ana' }, 'Owner Performance')).toBe('Good morning, Ana');
    expect(Layout.greeting(at(13), { firstName: ' Ben ' }, 'x')).toBe('Good afternoon, Ben');
    expect(Layout.greeting(at(19), { first_name: 'Cy' }, 'x')).toBe('Good evening, Cy');
  });
  test('without a first name it falls back to the dashboard title', () => {
    expect(Layout.greeting(at(9), null, 'Owner Performance')).toBe('Owner Performance');
    expect(Layout.greeting(at(9), { first_name: '  ' }, 'Owner Performance')).toBe('Owner Performance');
    expect(Layout.greeting(at(9), {}, '')).toBe('Dashboard');
  });
});

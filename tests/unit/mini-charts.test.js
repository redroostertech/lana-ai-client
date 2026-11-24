'use strict';

/**
 * Mini charts: the small SVG marks drawn inside dashboard tiles. Sizes are
 * SVG attributes in a 0 to 100 box (CSS sizes the box), never inline styles.
 */

const path = require('path');
const View = require(path.join(__dirname, '../../src/js/shared/metric-card-view.js'));
const Charts = require(path.join(__dirname, '../../src/js/shared/mini-charts.js'));

const fmt = (n) => (n === null ? 'n/a' : String(n));

test('no sparkline model draws nothing', () => {
  expect(Charts.sparklineSvg(null)).toBe('');
});

test('a sparkline is one line and a soft area, coloured by trend', () => {
  const svg = Charts.sparklineSvg(View.sparkline([{ value_numeric: 1, period_start: 'a' }, { value_numeric: 3, period_start: 'b' }], 100, 24));
  expect(svg).toContain('class="mini-spark mini-spark--up"');
  expect(svg).toContain('<polyline class="mini-spark__line" pathLength="100" points="0,22 100,2"');
  expect(svg).toContain('class="mini-spark__area" points="0,22 100,2 100,24 0,24"');
  expect(svg).not.toContain('style=');
});

test('bars carry their width as an SVG attribute and escape labels', () => {
  const html = Charts.barsHtml(View.listBars([{ service_label: '<Estate>', value: 21 }, { service_label: 'Probate', value: 7 }]), fmt);
  expect(html).toContain('&lt;Estate&gt;');
  expect(html).toContain('<rect class="mini-bars__fill" x="0" y="0" width="100" height="6"');
  expect(html).toContain('width="33.3"');
  expect(html).not.toContain('style=');
  expect(html).not.toContain('mini-bars__legend');
});

test('paired bars show both series with a legend', () => {
  const html = Charts.barsHtml(View.listBars([{ service_label: 'Estate Planning', actual: 12, needed: 20 }]), fmt);
  expect(html).toContain('mini-bars--paired');
  expect(html).toContain('Actual');
  expect(html).toContain('Needed');
  expect(html).toContain('mini-bars__fill--second');
  expect(html).toContain('12 of 20');
});

test('hidden rows are counted in plain words', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ label: 'R' + i, value: i }));
  expect(Charts.barsHtml(View.listBars(rows, 8), fmt)).toContain('And 2 more');
});

test('the goal ring fills to attainment and marks the pace', () => {
  const progress = View.goalProgress({ target_value_resolved: 50000, attainment_pct: 64.2, status: 'yellow',
    pacing: { expected_to_date: 38500, pace_status: 'behind' } });
  const html = Charts.ringHtml(progress, { value: '$32,100', target: '$50,000' });
  expect(html).toContain('mini-ring--yellow');
  expect(html).toContain('stroke-dashoffset="35.8"');
  expect(html).toContain('transform="rotate(277.2 18 18)"');
  expect(html).toContain('$32,100');
  expect(html).toContain('of $50,000');
  expect(html).toContain('Behind');
  expect(html).not.toContain('style=');
});

test('an unavailable goal or no goal draws no ring', () => {
  expect(Charts.ringHtml(View.goalProgress({ status: 'unknown', reason: 'unsupported_goal_type' }), {})).toBe('');
  expect(Charts.ringHtml(null, {})).toBe('');
});

describe('countUp', () => {
  function node() { return { textContent: '' }; }

  test('reduced motion sets the final text at once', () => {
    const el = node();
    Charts.countUp(el, '$549,420', { reduceMotion: true, raf: () => { throw new Error('should not animate'); } });
    expect(el.textContent).toBe('$549,420');
  });

  test('text without a number is set at once', () => {
    const el = node();
    Charts.countUp(el, 'View details', { reduceMotion: false, raf: () => { throw new Error('should not animate'); } });
    expect(el.textContent).toBe('View details');
  });

  test('a number counts up and lands exactly on the final text', () => {
    const el = node();
    const frames = [];
    let now = 0;
    Charts.countUp(el, '$1,000', { reduceMotion: false, duration: 600, now: () => now, raf: (fn) => frames.push(fn) });
    expect(el.textContent).toBe('$0');
    now = 300; frames.shift()();
    const mid = Number(el.textContent.slice(1).split(',').join(''));
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(1000);
    now = 700; frames.shift()();
    expect(el.textContent).toBe('$1,000');
    expect(frames).toHaveLength(0);
  });

  test('a new value counts from the value shown before', () => {
    const el = node();
    const frames = [];
    let now = 0;
    Charts.countUp(el, '$2,000', { from: '$1,000', reduceMotion: false, duration: 600, now: () => now, raf: (fn) => frames.push(fn) });
    expect(el.textContent).toBe('$1,000');
    now = 300; frames.shift()();
    const mid = Number(el.textContent.slice(1).split(',').join(''));
    expect(mid).toBeGreaterThan(1500);
    expect(mid).toBeLessThan(2000);
  });

  test('a previous value in another unit is ignored', () => {
    const el = node();
    const frames = [];
    Charts.countUp(el, '$2,000', { from: '45%', reduceMotion: false, now: () => 0, raf: (fn) => frames.push(fn) });
    expect(el.textContent).toBe('$0');
  });
});

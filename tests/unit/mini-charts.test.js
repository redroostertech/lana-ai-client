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
  expect(svg).toContain('points="0,22 100,2 100,24 0,24"');
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
  const html = Charts.barsHtml(View.listBars([{ service_label: 'Estate Planning', actual_count: 12, needed_count: 20 }]), fmt);
  expect(html).toContain('mini-bars--paired');
  expect(html).toContain('Actual');
  expect(html).toContain('Needed');
  expect(html).toContain('mini-bars__fill--second');
  expect(html).toContain('12 of 20');
});

test('a row with no needed count has one bar and no "of null"', () => {
  const html = Charts.barsHtml(View.listBars([{ service_label: 'A', actual_count: 4, needed_count: 8 }, { service_label: 'B', actual_count: 2, needed_count: null }]), fmt);
  expect(html.split('mini-bars__fill--second').length - 1).toBe(1);
  expect(html).not.toContain('of null');
  expect(html).not.toContain('of n/a');
  expect(html).toContain('>2<');
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

describe('breakdownHtml: columns for up to 12 rows, horizontal bars beyond', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ service_label: 'Service ' + (i + 1), value: i + 1 }));

  test('a short list draws rounded columns with value and axis labels', () => {
    const html = Charts.breakdownHtml(View.listBars([{ service_label: 'Estate Planning', value: 6 }, { service_label: 'Guardianship', value: 2 }], 12), fmt);
    expect(html).toContain('class="mini-cols"');
    expect(html.split('class="mini-cols__bar"').length - 1).toBe(2);
    expect(html).toContain('rx="');
    expect(html).toContain('>6</text>');
    expect(html).toContain('<title>Estate Planning: 6</title>');
    expect(html).toContain('mini-cols__grid');
    expect(html).not.toContain('style=');
  });

  test('columns scale to the largest value', () => {
    const html = Charts.breakdownHtml(View.listBars([{ label: 'A', value: 10 }, { label: 'B', value: 5 }], 12), fmt);
    expect(html).toContain('height="86"');
    expect(html).toContain('height="43"');
  });

  test('long labels are shortened to fit, the full label stays in the tooltip', () => {
    const html = Charts.breakdownHtml(View.listBars(rows(12).map((r) => Object.assign(r, { service_label: 'A very long service offering name' })), 12), fmt);
    expect(html).toContain('<title>A very long service offering name: 1</title>');
    expect(html).toContain('...</text>');
  });

  test('more than 12 rows fall back to horizontal bars', () => {
    const html = Charts.breakdownHtml(View.listBars(rows(13), 12), fmt);
    expect(html).not.toContain('mini-cols');
    expect(html).toContain('mini-bars');
  });

  test('paired columns draw actual and needed side by side with a legend; a null needed draws one', () => {
    const html = Charts.breakdownHtml(View.listBars([{ service_label: 'A', actual_count: 4, needed_count: 8 }, { service_label: 'B', actual_count: 2, needed_count: null }], 12), fmt);
    expect(html.split('mini-cols__bar--second').length - 1).toBe(1);
    expect(html).toContain('mini-bars__legend');
    expect(html).toContain('<title>A: 4 of 8</title>');
    expect(html).toContain('<title>B: 2</title>');
  });

  test('an empty model draws nothing', () => {
    expect(Charts.breakdownHtml(View.listBars([], 12), fmt)).toBe('');
    expect(Charts.breakdownHtml(null, fmt)).toBe('');
  });
});

describe('deltaChip', () => {
  test('an up chip with an arrow and the comparison words', () => {
    const html = Charts.deltaChip(View.comparisonArrow({ direction: 'up', percent_change: 14.6 }), 'vs previous period');
    expect(html).toContain('mini-delta mini-delta--up');
    expect(html).toContain('<svg');
    expect(html).toContain('+14.6%');
    expect(html).toContain('vs previous period');
    expect(html).toContain('title="Up 14.6% from the previous period"');
  });
  test('down and flat', () => {
    expect(Charts.deltaChip(View.comparisonArrow({ direction: 'down', percent_change: -85.06 }), 'x')).toContain('mini-delta--down');
    const flat = Charts.deltaChip(View.comparisonArrow({ direction: 'flat', percent_change: 0 }), 'x');
    expect(flat).toContain('mini-delta--flat');
    expect(flat).not.toContain('<svg');
  });
  test('no comparison, no chip', () => {
    expect(Charts.deltaChip(null, 'x')).toBe('');
  });
});

test('the sparkline area fades with its own gradient', () => {
  const line = View.sparkline([{ value_numeric: 1, period_start: 'a' }, { value_numeric: 3, period_start: 'b' }], 100, 24);
  const a = Charts.sparklineSvg(line);
  const b = Charts.sparklineSvg(line);
  const id = a.split('<linearGradient id="')[1].split('"')[0];
  expect(a).toContain('fill="url(#' + id + ')"');
  expect(b).not.toContain('id="' + id + '"');
});

describe('groupHtml: one bar per metric, each opening its own records', () => {
  const rows = [
    { key: 'k.a', label: 'Potential New Clients', value: 120, waiting: false, pct: 100, conversionPct: null },
    { key: 'k.b', label: 'Truth Talks Scheduled', value: 72, waiting: false, pct: 60, conversionPct: 60 },
    { key: 'k.c', label: 'Review <Site>', value: null, waiting: true, pct: 0, conversionPct: null },
  ];
  const opts = (extra) => Object.assign({ format: (r) => String(r.value), href: (key) => 'detail?' + key, waitingLabel: () => 'Waiting' }, extra);

  test('bars: a label button per metric with its own drilldown, escaped', () => {
    const html = Charts.groupHtml(rows, opts());
    expect(html).toContain('data-metric-detail-link="detail?k.a"');
    expect(html).toContain('data-metric-detail-link="detail?k.c"');
    expect(html).toContain('Review &lt;Site&gt;');
    expect(html).toContain('<rect class="mini-group__fill" x="0" y="0" width="60" height="8"');
    expect(html).not.toContain('style=');
  });

  test('a waiting metric keeps its slot with a waiting chip and no bar', () => {
    const html = Charts.groupHtml(rows, opts());
    const third = html.split('<li class="mini-group__row')[3];
    expect(third).toContain('mini-group__waiting');
    expect(third).toContain('Waiting');
    expect(third).not.toContain('mini-group__fill');
  });

  test('funnel: centred steps with the step-to-step conversion between them', () => {
    const html = Charts.groupHtml(rows, opts({ funnel: true }));
    expect(html).toContain('mini-group--funnel');
    expect(html).toContain('<rect class="mini-group__fill" x="20" y="0" width="60" height="8"');
    expect(html).toContain('60% of the step before');
  });

  test('no rows, nothing drawn', () => {
    expect(Charts.groupHtml([], opts())).toBe('');
  });
});

describe('the visual vocabulary drawings', () => {
  const V = require(path.join(__dirname, '../../src/js/shared/card-visuals.js'));
  const href = (key) => 'detail?' + key;
  const noStyle = (html) => expect(html).not.toContain('style=');

  test('gauge: a semicircle and a needle turned to the value', () => {
    const html = Charts.gaugeHtml(V.gaugeModel(75), '75%');
    expect(html).toContain('class="mini-gauge"');
    expect(html).toContain('stroke-dashoffset="25"');
    expect(html).toContain('transform="rotate(45 50 50)"');
    expect(html).toContain('>75%<');
    expect(Charts.gaugeHtml(null, '')).toBe('');
    noStyle(html);
  });

  test('donut: one clickable slice per part, total in the centre, legend with values', () => {
    const model = V.donutModel([{ label: 'Website', value: 9, key: 'k.a' }, { label: 'Referral', value: 3, key: 'k.b' }]);
    const html = Charts.donutHtml(model, { centre: '12', centreLabel: 'Total', format: (v) => String(v), href });
    expect(html.split('class="mini-donut__slice').length - 1).toBe(2);
    expect(html).toContain('stroke-dasharray="75 25"');
    expect(html).toContain('stroke-dashoffset="-75"');
    expect(html).toContain('data-metric-detail-link="detail?k.a"');
    expect(html).toContain('>12<');
    expect(html).toContain('Website');
    noStyle(html);
  });

  test('ranked bars: high to low, value at the end, initials when asked, each row clickable', () => {
    const rows = V.rankedModel([{ label: 'Team member B', value: 35, key: 'k' }, { label: 'Team member A', value: 42, key: 'k' }]);
    const html = Charts.rankedHtml(rows, { format: (r) => r.value + '%', href, initials: true });
    expect(html.indexOf('Team member A')).toBeLessThan(html.indexOf('Team member B'));
    expect(html).toContain('>TA<');
    expect(html).toContain('42%');
    expect(html).toContain('data-metric-detail-link="detail?k"');
    noStyle(html);
  });

  test('stacked bar: parts with percent labels', () => {
    const html = Charts.stackedHtml(V.stackedModel([{ label: 'Fully funded', value: 12, key: 'a' }, { label: 'Not fully funded', value: 4, key: 'b' }]), { href, format: String });
    expect(html).toContain('x="75" y="0" width="25"');
    expect(html).toContain('75%');
    expect(html).toContain('Not fully funded');
    noStyle(html);
  });

  test('bullet: the actual bar, the goal mark and the gap in words', () => {
    const html = Charts.bulletHtml(V.bulletModel(60, 80), { actual: '$60', goal: '$80', gap: '$20' });
    expect(html).toContain('width="75"');
    expect(html).toContain('x1="100"');
    expect(html).toContain('$20 to go');
    expect(Charts.bulletHtml(V.bulletModel(100, 80), { actual: 'a', goal: 'g', gap: '20' })).toContain('Goal met');
    expect(Charts.bulletHtml(null, {})).toBe('');
  });

  test('timeline: 14 days with a dot on each item date', () => {
    const choice = V.chooseRowsVisual('timeline', [{ name: 'Signing', meeting_date: '2026-11-26' }], 'worklist', '2026-11-24');
    const html = Charts.timelineHtml(choice.model, { href: 'detail?x', dayLabel: (i) => 'D' + i });
    expect(html).toContain('class="mini-timeline"');
    expect(html.split('<g class="mini-timeline__dot ').length - 1).toBe(1);
    expect(html).toContain('<title>Signing</title>');
    expect(html).toContain('data-metric-detail-link="detail?x"');
    noStyle(html);
  });

  test('aging: one column per age bucket, labelled', () => {
    const choice = V.chooseRowsVisual('aging', [{ days_in_stage: 10 }, { days_in_stage: 100 }], 'worklist', '2026-11-24');
    const html = Charts.agingHtml(choice.model, { href: 'detail?x' });
    expect(html).toContain('0 to 30 days');
    expect(html).toContain('Over 90 days');
    expect(html).toContain('data-metric-detail-link="detail?x"');
  });

  test('columns can open each row\'s metric', () => {
    const model = View.listBars([{ label: 'A', value: 2 }], 12);
    model.rows[0].key = 'k.a';
    expect(Charts.breakdownHtml(model, fmt, { href })).toContain('data-metric-detail-link="detail?k.a"');
  });
});

test('a muted (Not mapped) column is styled apart and opens its own link', () => {
  const model = View.listBars([{ label: 'A', value: 2 }, { service_key: 'not_mapped', value: 1 }], 12);
  model.rows[1].linkHref = 'settings-v2.html#mappings';
  const html = Charts.breakdownHtml(model, fmt, { href: () => 'detail' });
  expect(html).toContain('mini-cols__group mini-cols__group--muted');
  expect(html).toContain('data-metric-detail-link="settings-v2.html#mappings"');
});

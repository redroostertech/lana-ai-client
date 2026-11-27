'use strict';

const AsOf = require('../../src/js/shared/as-of-cards.js');

describe('as-of date mode', () => {
  test('a dashboard is as-of when its layout (or the dashboard) says period_mode as_of', () => {
    expect(AsOf.isAsOf({ layout: { period_mode: 'as_of' } })).toBe(true);
    expect(AsOf.isAsOf({ period_mode: 'as_of', layout: {} })).toBe(true);
    expect(AsOf.isAsOf({ layout: { period_mode: 'range' } })).toBe(false);
    expect(AsOf.isAsOf({ layout: {} })).toBe(false);
    expect(AsOf.isAsOf(null)).toBe(false);
  });

  test('the as-of day comes from the link when it is a real day, else today', () => {
    expect(AsOf.asOfDay('2026-10-31', '2026-11-27')).toBe('2026-10-31');
    expect(AsOf.asOfDay('', '2026-11-27')).toBe('2026-11-27');
    expect(AsOf.asOfDay('2026-13-40', '2026-11-27')).toBe('2026-11-27');
    expect(AsOf.asOfDay('yesterday', '2026-11-27')).toBe('2026-11-27');
  });

  test('cards are asked for with the end day only', () => {
    expect(AsOf.cardPeriod('2026-11-27')).toEqual({ periodEnd: '2026-11-27' });
  });

  test('the header names the day', () => {
    expect(AsOf.headerLabel('2026-11-27')).toBe('As of Nov 27, 2026');
  });
});

describe('monthly bars (metadata.by_month)', () => {
  const card = (byMonth, extra) => ({ metadata: Object.assign({ by_month: byMonth }, extra) });
  test('"Older" first, then oldest to newest; no rows is null', () => {
    const rows = AsOf.byMonth(card([
      { month: '2026-11', label: 'Nov', count: 3 }, { month: 'older', label: 'Older', count: 20 }, { month: '2026-10', label: 'Oct', count: 12, value: 45000 }]));
    expect(rows.map((r) => r.month)).toEqual(['older', '2026-10', '2026-11']);
    expect(rows[1]).toMatchObject({ label: 'Oct', count: 12, value: 45000 });
    expect(rows[2].value).toBeNull();
    expect(AsOf.byMonth(card([]))).toBeNull();
    expect(AsOf.byMonth({ metadata: {} })).toBeNull();
  });
  test('up to 24 bars, in order: Older plus the newest months', () => {
    const month = (i) => (2024 + Math.floor(i / 12)) + '-' + String((i % 12) + 1).padStart(2, '0');
    const many = Array.from({ length: 30 }, (_, i) => ({ month: month(i), label: 'M' + i, count: i }));
    const rows = AsOf.byMonth(card([{ month: 'older', label: 'Older', count: 1 }].concat(many)));
    expect(rows.length).toBe(24);
    expect(rows[0].month).toBe('older');
    expect(rows[1].month).toBe(month(7));
    expect(rows[23].month).toBe(month(29));
    expect(AsOf.byMonth(card(many)).length).toBe(24);
  });
  test('future months (next billing) are all drawn, from the as-of month on, never cut at 13', () => {
    const month = (i) => (2026 + Math.floor((10 + i) / 12)) + '-' + String(((10 + i) % 12) + 1).padStart(2, '0');
    const forward = Array.from({ length: 18 }, (_, i) => ({ month: month(i), label: 'F' + i, count: 1, value: 100 }));
    const rows = AsOf.byMonth(card(forward.slice().reverse()));
    expect(rows.length).toBe(18);
    expect(rows[0].month).toBe('2026-11');
    expect(rows[17].month).toBe(month(17));
  });
  test('the subtitle names what the months count; anything else shows none', () => {
    const words = (of) => AsOf.monthSubtitle({ metadata: { group_by_month_of: of } });
    expect(words('created')).toBe('By month created');
    expect(words('last_touch')).toBe('By month of last contact');
    expect(words('latest_client_message')).toBe("By month of the client's latest message");
    expect(words('opened')).toBe('By month the matter opened');
    expect(words('detected')).toBe('By month found');
    expect(words('next_billing')).toBe('By next billing month');
    expect(words('due')).toBe('By month due');
    expect(words('something_new')).toBe('');
    expect(AsOf.monthSubtitle({})).toBe('');
  });
  test('the tooltip gives the count and the amount', () => {
    const money = (n) => '$' + n.toLocaleString('en-US');
    expect(AsOf.monthTip({ label: 'Oct', count: 12, value: 45000 }, money, 'deals')).toBe('Oct: 12 deals · $45,000');
    expect(AsOf.monthTip({ label: 'Oct', count: 1, value: null }, money, 'deals')).toBe('Oct: 1 deal');
    expect(AsOf.monthTip({ label: 'Oct', count: 4, value: null }, money, '')).toBe('Oct: 4 records');
  });
  test('a month card: visual month_bars, or by_month with no visual', () => {
    const withMonths = card([{ month: '2026-10', label: 'Oct', count: 1 }]);
    expect(AsOf.isMonthCard('month_bars', {})).toBe(true);
    expect(AsOf.isMonthCard('', withMonths)).toBe(true);
    expect(AsOf.isMonthCard('worklist', withMonths)).toBe(false);
    expect(AsOf.isMonthCard('', {})).toBe(false);
  });
});

describe('link cards (metadata.target)', () => {
  test('the headline and the target report, from metadata.target or metadata.link', () => {
    expect(AsOf.linkOf({ metadata: { headline: 'Everything still open: $7.5M across 4,330 deals.', target: { slug: 'still-open', as_of: '2026-11-27' } } }))
      .toEqual({ headline: 'Everything still open: $7.5M across 4,330 deals.', slug: 'still-open', dashboardId: '' });
    expect(AsOf.linkOf({ metadata: { link: { headline: 'See more', target: { dashboard_id: 'd-9' } } } })).toEqual({ headline: 'See more', slug: '', dashboardId: 'd-9' });
    expect(AsOf.linkOf({ metadata: { headline: 'No target' } })).toBeNull();
    expect(AsOf.linkOf({})).toBeNull();
  });
  test('a card is a link card by visual link, or by a target with no visual', () => {
    expect(AsOf.isLinkCard('link', {})).toBe(true);
    expect(AsOf.isLinkCard('', { metadata: { target: { slug: 'still-open' } } })).toBe(true);
    expect(AsOf.isLinkCard('stat', { metadata: { target: { slug: 'still-open' } } })).toBe(false);
  });
  test('the target opens on the day given', () => {
    expect(AsOf.targetHref('d-9', '2026-11-27')).toBe('admin/dashboard-detail.html?id=d-9&asOf=2026-11-27');
    expect(AsOf.targetHref('d 9', '')).toBe('admin/dashboard-detail.html?id=d%209');
  });
});

describe('the server period label', () => {
  const rule = 'Deals created Oct 29 - Nov 27, 2026, still open on Nov 27, 2026';
  test('a label that says more than a plain range is used, from period, period_label or lineage.period_rule', () => {
    expect(AsOf.periodLabel({ period: rule })).toBe(rule);
    expect(AsOf.periodLabel({ period_label: rule })).toBe(rule);
    expect(AsOf.periodLabel({ lineage: { period_rule: rule } })).toBe(rule);
    expect(AsOf.periodLabel({ period: 'Nov 2026', lineage: { period_rule: rule } })).toBe(rule);
  });
  test('a plain range is not', () => {
    expect(AsOf.periodLabel({ period: 'Oct 29 - Nov 27, 2026' })).toBe('');
    expect(AsOf.periodLabel({ period: 'Nov 2026' })).toBe('');
    expect(AsOf.periodLabel({ period: 'September 1 to September 30, 2026' })).toBe('');
    expect(AsOf.periodLabel({ period: { start: '2026-11-01' } })).toBe('');
    expect(AsOf.periodLabel({})).toBe('');
  });
});

describe('records with no grouping date (metadata.by_month_unplaced)', () => {
  const money = (n) => '$' + n.toLocaleString('en-US');
  test('a muted note: the count, with the amount when there is one', () => {
    const card = (u) => ({ metadata: { by_month_unplaced: u } });
    expect(AsOf.unplacedNote(card({ label: 'No date recorded', count: 3 }), money)).toBe('3 with no date recorded');
    expect(AsOf.unplacedNote(card({ label: 'No date recorded', count: 3, value: 4500 }), money)).toBe('3 with no date recorded ($4,500)');
    expect(AsOf.unplacedNote(card({ count: 1 }), money)).toBe('1 with no date recorded');
    expect(AsOf.unplacedNote(card({ label: 'No date recorded', count: 0 }), money)).toBe('');
    expect(AsOf.unplacedNote({}, money)).toBe('');
  });
  test('the note opens the records with no month (the "(empty)" filter)', () => {
    expect(AsOf.UNPLACED_FILTER).toBe('(empty)');
  });
});

describe('average cards', () => {
  const days = (n) => n + ' days';
  test('an average is known by its aggregation, its format or value_count on the months', () => {
    expect(AsOf.isAverage({ metadata: { aggregation: 'average' } })).toBe(true);
    expect(AsOf.isAverage({ format: 'average_days' })).toBe(true);
    expect(AsOf.isAverage({ metadata: { by_month: [{ month: '2026-10', value: 42, value_count: 18 }] } })).toBe(true);
    expect(AsOf.isAverage({ metadata: { by_month: [{ month: '2026-10', value: 42, count: 18 }] } })).toBe(false);
  });
  test('the tooltip says "Avg 42 days · 18 records"', () => {
    const item = AsOf.byMonth({ metadata: { by_month: [{ month: '2026-10', label: 'Oct', value: 42, value_count: 18 }] } })[0];
    expect(item.valueCount).toBe(18);
    expect(AsOf.monthTip(item, days, 'deals', true)).toBe('Oct: Avg 42 days · 18 records');
    expect(AsOf.monthTip({ label: 'Oct', value: 42, valueCount: 1, count: null }, days, '', true)).toBe('Oct: Avg 42 days · 1 record');
  });
  test('the no-date note gives the average, not a total', () => {
    expect(AsOf.unplacedNote({ metadata: { by_month_unplaced: { label: 'No date recorded', count: 3, value: 30 } } }, days, true)).toBe('3 with no date recorded (avg 30 days)');
  });
});

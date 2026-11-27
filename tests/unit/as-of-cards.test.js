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
  test('at most 13 bars: Older plus the newest 12 months', () => {
    const months = Array.from({ length: 20 }, (_, i) => ({ month: '2025-' + String((i % 12) + 1).padStart(2, '0'), label: 'M' + i, count: i }));
    const many = months.map((m, i) => Object.assign({}, m, { month: (2024 + Math.floor(i / 12)) + '-' + String((i % 12) + 1).padStart(2, '0') }));
    const rows = AsOf.byMonth(card([{ month: 'older', label: 'Older', count: 1 }].concat(many)));
    expect(rows.length).toBe(13);
    expect(rows[0].month).toBe('older');
    expect(rows[12].month).toBe('2025-08');
    expect(AsOf.byMonth(card(many)).length).toBe(13);
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

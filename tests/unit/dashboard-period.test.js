'use strict';

/**
 * Dashboard period: every card request and every metric detail link carries
 * the same plain days the page shows. When nothing is picked, the page's
 * default range is used (and shown), never an empty range.
 */

const path = require('path');
const { resolveRequestPeriod, metricDetailHref } = require(path.join(__dirname, '../../src/js/shared/dashboard-period.js'));

const DEFAULT = { start: '2026-11-18', end: '2026-11-24' };

describe('resolveRequestPeriod', () => {
  test('a picked range is sent as picked', () => {
    expect(resolveRequestPeriod({ start: '2026-01-01', end: '2026-01-31' }, DEFAULT))
      .toEqual({ periodStart: '2026-01-01', periodEnd: '2026-01-31', usedDefault: false });
  });

  test('no range picked sends the default range', () => {
    expect(resolveRequestPeriod({ start: '', end: '' }, DEFAULT))
      .toEqual({ periodStart: '2026-11-18', periodEnd: '2026-11-24', usedDefault: true });
    expect(resolveRequestPeriod(null, DEFAULT).periodStart).toBe('2026-11-18');
  });

  test('half a range falls back to the whole default range', () => {
    expect(resolveRequestPeriod({ start: '2026-01-01', end: '' }, DEFAULT))
      .toEqual({ periodStart: '2026-11-18', periodEnd: '2026-11-24', usedDefault: true });
  });

  test('a start after the end, or a day that is not a real day, uses the default', () => {
    expect(resolveRequestPeriod({ start: '2026-02-01', end: '2026-01-01' }, DEFAULT).usedDefault).toBe(true);
    expect(resolveRequestPeriod({ start: '2026-13-01', end: '2026-12-31' }, DEFAULT).usedDefault).toBe(true);
    expect(resolveRequestPeriod({ start: 'soon', end: '2026-12-31' }, DEFAULT).usedDefault).toBe(true);
  });

  test('the default is only worked out when it is needed', () => {
    const defaults = jest.fn(() => DEFAULT);
    expect(resolveRequestPeriod({ start: '2026-01-01', end: '2026-01-31' }, defaults).usedDefault).toBe(false);
    expect(defaults).not.toHaveBeenCalled();
    expect(resolveRequestPeriod({ start: '', end: '' }, defaults).periodEnd).toBe('2026-11-24');
    expect(defaults).toHaveBeenCalledTimes(1);
  });

  test('a one-day range is fine', () => {
    expect(resolveRequestPeriod({ start: '2026-03-04', end: '2026-03-04' }, DEFAULT).usedDefault).toBe(false);
  });
});

describe('metricDetailHref', () => {
  test('carries the key, both days and the grain', () => {
    const href = metricDetailHref('legal_firm.finance.cash', { periodStart: '2026-01-01', periodEnd: '2026-01-31', compareBy: 'monthly' });
    const [page, query] = href.split('?');
    const qs = new URLSearchParams(query);
    expect(page).toBe('admin/metric_detail.html');
    expect(qs.get('metric_key')).toBe('legal_firm.finance.cash');
    expect([qs.get('periodStart'), qs.get('periodEnd'), qs.get('compareBy')]).toEqual(['2026-01-01', '2026-01-31', 'monthly']);
    expect(qs.get('tab')).toBe(null);
  });

  test('can open straight on the source records', () => {
    const qs = new URLSearchParams(metricDetailHref('a.b', { periodStart: '2026-01-01', periodEnd: '2026-01-31' }, { tab: 'source' }).split('?')[1]);
    expect(qs.get('tab')).toBe('source');
  });
});

describe('quick-select presets (LanaTime.reportPresetDays) on 2026-11-24', () => {
  const fs = require('fs');
  const timeWin = { Date };
  new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(timeWin);
  // Noon on Nov 24 in New York.
  const now = new Date('2026-11-24T17:00:00.000Z');
  const days = (preset) => timeWin.LanaTime.reportPresetDays(preset, 'America/New_York', now);

  test.each([
    ['last7days', '2026-11-18', '2026-11-24'],
    ['last30days', '2026-10-26', '2026-11-24'],
    ['thisMonth', '2026-11-01', '2026-11-24'],
    ['lastMonth', '2026-10-01', '2026-10-31'],
    ['thisQuarter', '2026-10-01', '2026-11-24'],
    ['thisYear', '2026-01-01', '2026-11-24'],
    ['lastYear', '2025-01-01', '2025-12-31'],
  ])('%s runs %s to %s, end included', (preset, start, end) => {
    expect(days(preset)).toEqual({ start, end });
  });
});

describe('matchPreset: the highlighted chip comes from the dates', () => {
  const { matchPreset } = require(path.join(__dirname, '../../src/js/shared/dashboard-period.js'));
  const presets = [
    ['last7days', { start: '2026-11-18', end: '2026-11-24' }],
    ['thisMonth', { start: '2026-11-01', end: '2026-11-24' }],
    ['lastMonth', { start: '2026-10-01', end: '2026-10-31' }],
    ['thisQuarter', { start: '2026-10-01', end: '2026-11-24' }],
  ];

  test('dates that equal a preset light that chip', () => {
    expect(matchPreset({ start: '2026-10-01', end: '2026-10-31' }, presets)).toBe('lastMonth');
    expect(matchPreset({ start: '2026-10-01', end: '2026-11-24' }, presets)).toBe('thisQuarter');
  });

  test('custom dates light no chip', () => {
    expect(matchPreset({ start: '2026-10-02', end: '2026-10-31' }, presets)).toBe(null);
    expect(matchPreset(null, presets)).toBe(null);
  });
});

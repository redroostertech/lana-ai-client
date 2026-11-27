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

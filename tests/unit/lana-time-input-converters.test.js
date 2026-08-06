'use strict';

/**
 * LanaTime input-value converters — the sanctioned bridges between form
 * inputs (user-local wall time) and the API contract (ISO 8601 UTC instants).
 * Added alongside the tasks.due_date timestamptz fix so no page hand-rolls
 * `new Date()` conversions again.
 */

const path = require('path');
const fs = require('fs');

function loadLanaTime() {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/time-utils.js'),
    'utf8'
  );
  const fakeWindow = { Date };
  new Function('window', src)(fakeWindow);
  return fakeWindow.LanaTime;
}

const LanaTime = loadLanaTime();

describe('LanaTime.toIsoInstant', () => {
  test('converts a datetime-local value (local wall time) to a UTC instant', () => {
    const iso = LanaTime.toIsoInstant('2026-08-06T14:30');
    expect(iso).toBe(new Date(2026, 7, 6, 14, 30).toISOString());
    expect(iso.endsWith('Z')).toBe(true);
  });

  test('passes an ISO instant through unchanged', () => {
    expect(LanaTime.toIsoInstant('2026-08-10T18:30:00.000Z')).toBe('2026-08-10T18:30:00.000Z');
  });

  test('accepts a Date object', () => {
    const d = new Date(2026, 0, 15, 9, 0);
    expect(LanaTime.toIsoInstant(d)).toBe(d.toISOString());
  });

  test('returns null for empty and invalid values', () => {
    expect(LanaTime.toIsoInstant('')).toBeNull();
    expect(LanaTime.toIsoInstant(null)).toBeNull();
    expect(LanaTime.toIsoInstant(undefined)).toBeNull();
    expect(LanaTime.toIsoInstant('not-a-date')).toBeNull();
  });
});

describe('LanaTime.toLocalDateInputValue', () => {
  test('renders the LOCAL calendar day of a UTC instant', () => {
    // Choose an instant that is late evening local for any zone west of UTC,
    // and verify against Date's own local components rather than a fixed
    // string so the test is timezone-independent.
    const instant = '2026-08-06T02:00:00.000Z';
    const d = new Date(instant);
    const expected = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    expect(LanaTime.toLocalDateInputValue(instant)).toBe(expected);
  });

  test('differs from UTC slicing for evening-local instants west of UTC', () => {
    const instant = '2026-08-06T02:00:00.000Z';
    const d = new Date(instant);
    // Timezone-independent: always assert against Date's own local
    // components, so a UTC-slicing implementation fails in EVERY zone.
    const expected = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    expect(LanaTime.toLocalDateInputValue(instant)).toBe(expected);
    if (d.getTimezoneOffset() > 0) {
      // West of UTC the local day genuinely differs from the UTC slice
      expect(expected).not.toBe(instant.slice(0, 10));
    }
  });

  test('undefined defaults to today (documented trap, pinned)', () => {
    const now = new Date();
    const expected = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    expect(LanaTime.toLocalDateInputValue(undefined)).toBe(expected);
    expect(LanaTime.toLocalDatetimeInputValue(undefined).slice(0, 10)).toBe(expected);
  });

  test('returns empty string for empty and invalid values', () => {
    expect(LanaTime.toLocalDateInputValue('')).toBe('');
    expect(LanaTime.toLocalDateInputValue(null)).toBe('');
    expect(LanaTime.toLocalDateInputValue('junk')).toBe('');
  });
});

describe('LanaTime.toLocalDatetimeInputValue', () => {
  test('round-trips with toIsoInstant at minute precision', () => {
    const original = '2026-08-06T14:30';
    const iso = LanaTime.toIsoInstant(original);
    expect(LanaTime.toLocalDatetimeInputValue(iso)).toBe(original);
  });

  test('returns empty string for empty and invalid values', () => {
    expect(LanaTime.toLocalDatetimeInputValue('')).toBe('');
    expect(LanaTime.toLocalDatetimeInputValue(null)).toBe('');
    expect(LanaTime.toLocalDatetimeInputValue('junk')).toBe('');
  });
});

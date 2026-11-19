'use strict';

/**
 * The repeat picker and the scope question (calendar part 6): picker values
 * to the API's `repeat` and back, what the picker shows, and one grid key
 * per occurrence. The rule itself is built and worded by the backend.
 */
const fs = require('fs');
const path = require('path');

// LanaTime (js/time-utils.js) as the page loads it: the repeat model reads weekdays through it.
new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(globalThis);
const R = require('../../src/js/calendar/calendar-repeat.model');
const Model = require('../../src/js/calendar/calendar-page.model');

describe('picker values and repeat', () => {
  test.each([
    [{ preset: 'daily', ends: 'never' }, { frequency: 'daily', interval: 1, ends: { type: 'never' } }],
    [{ preset: 'weekdays', ends: 'after', count: 10 }, { frequency: 'weekly', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], ends: { type: 'after', count: 10 } }],
    [{ preset: 'weekly', weekdays: ['TH', 'TU', 'TU'], ends: 'on', until: '2027-03-03' }, { frequency: 'weekly', interval: 1, weekdays: ['TU', 'TH'], ends: { type: 'on', date: '2027-03-03' } }],
    [{ preset: 'monthly', ends: 'never' }, { frequency: 'monthly', interval: 1, ends: { type: 'never' } }],
    [{ preset: 'yearly', ends: 'never' }, { frequency: 'yearly', interval: 1, ends: { type: 'never' } }],
    [{ preset: 'custom', unit: 'weekly', interval: 2, weekdays: ['MO'], ends: 'never' }, { frequency: 'weekly', interval: 2, weekdays: ['MO'], ends: { type: 'never' } }]
  ])('%j becomes %j and reads back the same', (values, repeat) => {
    expect(R.toRepeat(values, '2026-11-17')).toEqual({ repeat });
    const back = R.fromRepeat(repeat, '2026-11-17');
    expect(back.preset).toBe(values.preset);
    expect(R.toRepeat(back, '2026-11-17')).toEqual({ repeat });
  });

  test('does not repeat is null; a rule the picker cannot show is kept (undefined)', () => {
    expect(R.toRepeat({ preset: 'none' })).toEqual({ repeat: null });
    expect(R.toRepeat(R.fromRepeat({ frequency: 'monthly', editable: false }, '2026-11-17'))).toEqual({ repeat: undefined });
    expect(R.fromRepeat(null, '2026-11-17')).toMatchObject({ preset: 'none', weekdays: ['TU'] });
  });

  test.each([
    [{ preset: 'weekly', weekdays: [] }, 'weekdays'],
    [{ preset: 'custom', unit: 'daily', interval: 0 }, 'interval'],
    [{ preset: 'custom', unit: 'daily', interval: 100 }, 'interval'],
    [{ preset: 'daily', ends: 'on', until: '' }, 'until'],
    [{ preset: 'daily', ends: 'on', until: '2026-11-16' }, 'until'],
    [{ preset: 'daily', ends: 'after', count: 0 }, 'count']
  ])('refuses %j (%s)', (values, name) => {
    expect(R.toRepeat(values, '2026-11-17').errors.map((e) => e.name)).toContain(name);
  });

  test('control: the same values with a good end are accepted', () => {
    expect(R.toRepeat({ preset: 'daily', ends: 'on', until: '2026-11-17' }, '2026-11-17').repeat).toBeTruthy();
  });

  test('what the picker shows', () => {
    expect(R.visibleParts({ preset: 'none' })).toEqual({ weekdays: false, interval: false, ends: false, until: false, count: false });
    expect(R.visibleParts({ preset: 'weekly', ends: 'on' })).toMatchObject({ weekdays: true, ends: true, until: true, count: false });
    expect(R.visibleParts({ preset: 'custom', unit: 'monthly', ends: 'after' })).toMatchObject({ weekdays: false, interval: true, count: true });
  });

  test('changed compares what is sent', () => {
    expect(R.changed(null, null)).toBe(false);
    expect(R.changed({ frequency: 'daily', interval: 1, ends: { type: 'never' } }, { frequency: 'daily', interval: 1, ends: { type: 'never' } })).toBe(false);
    expect(R.changed(null, { frequency: 'daily', interval: 1, ends: { type: 'never' } })).toBe(true);
  });
});

describe('occurrences on the grid', () => {
  test('each occurrence has its own key, keeps the event id for the detail, and carries the rule in words; busy blocks carry none', () => {
    const agenda = { people: [{ user_id: 'me' }], events: [
      { id: 'CAL-1', title: 'Weekly', start: '2026-11-17T15:00:00Z', end: '2026-11-17T16:00:00Z', user_ids: ['me'], editable: true,
        recurring: true, series_id: 'CAL-1', occurrence_start: '2026-11-17T15:00:00.000Z', recurrence_text: 'Every Tuesday' },
      { id: 'CAL-1', title: 'Weekly', start: '2026-11-24T15:00:00Z', end: '2026-11-24T16:00:00Z', user_ids: ['me'], editable: true,
        recurring: true, series_id: 'CAL-1', occurrence_start: '2026-11-24T15:00:00.000Z', recurrence_text: 'Every Tuesday' },
      { busy_only: true, id: null, title: null, start: '2026-11-18T15:00:00Z', end: '2026-11-18T16:00:00Z', user_ids: ['ben'] }
    ] };
    const items = Model.toGridItems(agenda, 'me');
    expect(items.map((i) => i.id)).toEqual(['CAL-1@2026-11-17T15:00:00.000Z', 'CAL-1@2026-11-24T15:00:00.000Z', 'busy-2']);
    expect(items[1]).toMatchObject({ eventId: 'CAL-1', occurrenceStart: '2026-11-24T15:00:00.000Z', recurring: true,
      recurrenceText: 'Every Tuesday', readOnly: false });
    expect(items[2]).toMatchObject({ eventId: null, recurring: false, recurrenceText: '', occurrenceStart: null });
  });

  test('the scope question has the three choices and a heading per action', () => {
    expect(R.SCOPE_OPTIONS.map((o) => o.label)).toEqual(['This event', 'This and following events', 'All events']);
    expect(R.scopePrompt('delete').heading).toBe('Delete a repeating event');
    expect(R.scopePrompt('move').heading).toBe('Move a repeating event');
  });
});

describe('weekdays come from the shared time layer (review 4)', () => {
  test('weekdayOf reads the day of the week through LanaTime', () => {
    const saved = globalThis.LanaTime;
    const plainDayOfWeek = jest.fn(() => 2);
    globalThis.LanaTime = { plainDayOfWeek };
    try {
      expect(R.weekdayOf('2026-11-16')).toBe('TU');
      expect(plainDayOfWeek).toHaveBeenCalledWith('2026-11-16');
    } finally {
      globalThis.LanaTime = saved;
    }
  });

  test('control: with the real LanaTime a Monday is MO, and a bad day falls back to MO', () => {
    expect(R.weekdayOf('2026-11-16')).toBe('MO');
    expect(R.weekdayOf('2026-11-22')).toBe('SU');
    expect(R.weekdayOf('not a day')).toBe('MO');
  });
});

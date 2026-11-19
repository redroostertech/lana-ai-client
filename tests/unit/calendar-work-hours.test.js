'use strict';

/**
 * Calendar work hours (js/calendar/calendar-work-hours.js) and the layout
 * pieces they drive (calendar-layout.js viewDays for the work week and
 * complementMinutes for the shading): the firm's hours, in the firm's zone,
 * placed on the viewer's wall clock.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
new Function('window', fs.readFileSync(path.join(SRC, 'js/time-utils.js'), 'utf8'))(globalThis);
const L = require('../../src/js/calendar/calendar-layout.js');
const W = require('../../src/js/calendar/calendar-work-hours.js');

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';

// The API shape (GET /api/v1/firm-handbook/work-hours).
function hours(zone, perDay) {
  const names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return {
    source: 'handbook', time_zone: zone,
    days: names.map((day, i) => ({ day, iso_weekday: i + 1, start: (perDay[day] || [null])[0], end: (perDay[day] || [null, null])[1] }))
  };
}

const TUE_TO_SAT = hours(NY, {
  tuesday: ['09:00', '17:00'], wednesday: ['09:00', '17:00'], thursday: ['09:00', '17:00'],
  friday: ['09:00', '17:00'], saturday: ['10:00', '14:00']
});

describe('work week', () => {
  test('follows the firm\'s working days (Tuesday to Saturday)', () => {
    expect(W.workWeekdays(TUE_TO_SAT)).toEqual([2, 3, 4, 5, 6]);
    expect(L.viewDays('workweek', '2026-11-18', W.workWeekdays(TUE_TO_SAT)))
      .toEqual(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  });

  test('without hours it stays Monday to Friday', () => {
    expect(W.workWeekdays(null)).toBeNull();
    expect(L.viewDays('workweek', '2026-11-18', null))
      .toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  });
});

describe('segments on the viewer\'s wall clock', () => {
  test('same zone: the firm\'s hours as they are; a day off has none', () => {
    const segments = W.segmentsForDays(TUE_TO_SAT, ['2026-11-16', '2026-11-17', '2026-11-21'], NY);
    expect(segments).toEqual([[], [{ top: 540, bottom: 1020 }], [{ top: 600, bottom: 840 }]]);
  });

  test('a viewer three hours behind sees the firm\'s 9 to 5 as 6 to 2', () => {
    expect(W.segmentsForDays(TUE_TO_SAT, ['2026-11-17'], LA)).toEqual([[{ top: 360, bottom: 840 }]]);
  });

  test('hours that cross the viewer\'s midnight are cut at it, and the next day gets the rest', () => {
    const late = hours('Asia/Tokyo', { monday: ['09:00', '17:00'] });
    // Monday 9:00 to 17:00 in Tokyo is Sunday 19:00 to Monday 03:00 in New York.
    expect(W.segmentsForDays(late, ['2026-11-15', '2026-11-16'], NY)).toEqual([
      [{ top: 1140, bottom: 1440 }], [{ top: 0, bottom: 180 }]
    ]);
  });

  test('no working day at all: null, so nothing is shaded', () => {
    expect(W.segmentsForDays(hours(NY, {}), ['2026-11-17'], NY)).toBeNull();
  });

  test('the shading is the rest of the day', () => {
    expect(L.complementMinutes([{ top: 540, bottom: 1020 }])).toEqual([{ top: 0, bottom: 540 }, { top: 1020, bottom: 1440 }]);
    expect(L.complementMinutes([])).toEqual([{ top: 0, bottom: 1440 }]);
    expect(L.complementMinutes([{ top: 0, bottom: 1440 }])).toEqual([]);
  });
});

describe('where the grid opens', () => {
  const days = ['2026-11-17', '2026-11-18'];
  const segments = W.segmentsForDays(TUE_TO_SAT, days, NY);

  test('an hour before now when now is inside today\'s hours', () => {
    expect(W.scrollMinutes(segments, days, NY, new Date('2026-11-18T16:20:00Z'))).toBe(600); // 11:20 New York -> 10:00
  });

  test('otherwise the earliest work start shown (control: no hours gives null, the grid default)', () => {
    expect(W.scrollMinutes(segments, days, NY, new Date('2026-11-18T03:00:00Z'))).toBe(540);
    expect(W.scrollMinutes(null, days, NY)).toBeNull();
  });
});

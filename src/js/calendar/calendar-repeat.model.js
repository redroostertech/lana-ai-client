/**
 * Calendar repeat model (calendar part 6): the event drawer's repeat picker
 * values and the `repeat` object the API takes (and returns on an event's
 * detail), the "This event / This and following events / All events"
 * choices, and the key of one occurrence on the grid. Pure, so it is unit
 * tested. The backend builds the rule, expands occurrences and words the
 * rule ("Every Tuesday until Mar 3"); nothing here decides those.
 *
 * Picker values:
 *   { preset: 'none'|'daily'|'weekdays'|'weekly'|'monthly'|'yearly'|'custom'|'keep',
 *     weekdays: ['MO', ...], interval: 2, unit: 'daily'|'weekly'|'monthly'|'yearly',
 *     ends: 'never'|'on'|'after', until: 'YYYY-MM-DD', count: 10 }
 * 'keep' is a rule the picker cannot show (set elsewhere): it is left as is.
 */
(function (global) {
  'use strict';

  var WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  var WORK_WEEK = ['MO', 'TU', 'WE', 'TH', 'FR'];
  var MAX_INTERVAL = 99;
  var MAX_COUNT = 730;

  var PRESET_OPTIONS = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: 'Every day' },
    { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
    { value: 'weekly', label: 'Every week on chosen days' },
    { value: 'monthly', label: 'Every month' },
    { value: 'yearly', label: 'Every year' },
    { value: 'custom', label: 'Custom' }
  ];
  var WEEKDAY_OPTIONS = [
    { value: 'MO', label: 'Mon' }, { value: 'TU', label: 'Tue' }, { value: 'WE', label: 'Wed' },
    { value: 'TH', label: 'Thu' }, { value: 'FR', label: 'Fri' }, { value: 'SA', label: 'Sat' }, { value: 'SU', label: 'Sun' }
  ];
  var UNIT_OPTIONS = [
    { value: 'daily', label: 'Days' }, { value: 'weekly', label: 'Weeks' },
    { value: 'monthly', label: 'Months' }, { value: 'yearly', label: 'Years' }
  ];
  var ENDS_OPTIONS = [
    { value: 'never', label: 'Never' }, { value: 'on', label: 'On a date' }, { value: 'after', label: 'After' }
  ];
  var SCOPE_OPTIONS = [
    { value: 'this', label: 'This event' },
    { value: 'following', label: 'This and following events' },
    { value: 'all', label: 'All events' }
  ];

  /** The weekday code ('MO'..'SU') of a plain day 'YYYY-MM-DD' (LanaTime), else 'MO'. */
  function weekdayOf(day) {
    var T = global.LanaTime;
    var sundayBased = T && typeof T.plainDayOfWeek === 'function' ? T.plainDayOfWeek(day) : NaN;
    return Number.isInteger(sundayBased) ? WEEKDAYS[(sundayBased + 6) % 7] : 'MO';
  }

  function sortDays(days) {
    return (days || []).filter(function (d, i, all) { return WEEKDAYS.indexOf(d) !== -1 && all.indexOf(d) === i; })
      .sort(function (a, b) { return WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b); });
  }

  /** Picker values for a new event starting on `startDay`: does not repeat. */
  function defaults(startDay) {
    return { preset: 'none', weekdays: [weekdayOf(startDay)], interval: 1, unit: 'weekly', ends: 'never', until: '', count: 10 };
  }

  /** Picker values for an event's `repeat` (GET /calendar-events/:id), or the defaults. */
  function fromRepeat(repeat, startDay) {
    var values = defaults(startDay);
    if (!repeat) return values;
    if (repeat.editable === false) return Object.assign(values, { preset: 'keep' });
    var interval = Number(repeat.interval) || 1;
    var days = sortDays(repeat.weekdays);
    var ends = repeat.ends || { type: 'never' };
    values.ends = ends.type === 'on' || ends.type === 'after' ? ends.type : 'never';
    values.until = ends.type === 'on' ? (ends.date || '') : '';
    values.count = ends.type === 'after' ? Number(ends.count) || 10 : 10;
    if (days.length) values.weekdays = days;
    values.unit = repeat.frequency;
    values.interval = interval;
    if (interval !== 1) {
      values.preset = 'custom';
    } else if (repeat.frequency === 'weekly' && days.join() === WORK_WEEK.join()) {
      values.preset = 'weekdays';
    } else {
      values.preset = repeat.frequency;
    }
    return values;
  }

  /**
   * The `repeat` the API takes for picker values: null for 'none',
   * undefined for 'keep' (leave the rule), or { errors } naming what is wrong.
   * startDay: the event's first day (an end date cannot be before it).
   */
  function toRepeat(values, startDay) {
    var v = values || {};
    if (!v.preset || v.preset === 'none') return { repeat: null };
    if (v.preset === 'keep') return { repeat: undefined };
    var errors = [];
    var repeat;
    if (v.preset === 'weekdays') {
      repeat = { frequency: 'weekly', interval: 1, weekdays: WORK_WEEK.slice() };
    } else if (v.preset === 'custom') {
      var interval = Number(v.interval);
      if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
        errors.push({ name: 'interval', message: 'Repeat every 1 to ' + MAX_INTERVAL + '.' });
      }
      repeat = { frequency: v.unit || 'weekly', interval: interval };
    } else {
      repeat = { frequency: v.preset, interval: 1 };
    }
    if (repeat.frequency === 'weekly' && !repeat.weekdays) {
      var days = sortDays(v.weekdays);
      if (!days.length) errors.push({ name: 'weekdays', message: 'Choose at least one day.' });
      repeat.weekdays = days;
    }
    if (v.ends === 'on') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.until || ''))) errors.push({ name: 'until', message: 'Choose the last day.' });
      else if (startDay && v.until < startDay) errors.push({ name: 'until', message: 'The repeat cannot end before the event starts.' });
      repeat.ends = { type: 'on', date: v.until };
    } else if (v.ends === 'after') {
      var count = Number(v.count);
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) errors.push({ name: 'count', message: 'Choose 1 to ' + MAX_COUNT + ' times.' });
      repeat.ends = { type: 'after', count: count };
    } else {
      repeat.ends = { type: 'never' };
    }
    return errors.length ? { errors: errors } : { repeat: repeat };
  }

  /** Did the picker change the repeat from what the event had? */
  function changed(before, after) {
    return JSON.stringify(before === undefined ? null : before) !== JSON.stringify(after === undefined ? null : after);
  }

  /** Which picker parts show: the day chips, the custom interval, the end fields. */
  function visibleParts(values) {
    var v = values || {};
    var repeats = v.preset && v.preset !== 'none' && v.preset !== 'keep';
    var unit = v.preset === 'custom' ? v.unit : v.preset;
    return {
      weekdays: !!repeats && unit === 'weekly',
      interval: v.preset === 'custom',
      ends: !!repeats,
      until: !!repeats && v.ends === 'on',
      count: !!repeats && v.ends === 'after'
    };
  }

  /** One grid item key per occurrence: the event id and, for a repeating one, its occurrence start. */
  function occurrenceKey(event, index) {
    if (!event || !event.id) return 'busy-' + index;
    return event.occurrence_start ? event.id + '@' + event.occurrence_start : String(event.id);
  }

  /** The scope prompt's heading, by action (its button is always Continue). */
  function scopePrompt(action) {
    if (action === 'delete') return { heading: 'Delete a repeating event' };
    if (action === 'move') return { heading: 'Move a repeating event' };
    return { heading: 'Change a repeating event' };
  }

  var api = {
    WEEKDAYS: WEEKDAYS,
    PRESET_OPTIONS: PRESET_OPTIONS,
    WEEKDAY_OPTIONS: WEEKDAY_OPTIONS,
    UNIT_OPTIONS: UNIT_OPTIONS,
    ENDS_OPTIONS: ENDS_OPTIONS,
    SCOPE_OPTIONS: SCOPE_OPTIONS,
    weekdayOf: weekdayOf,
    defaults: defaults,
    fromRepeat: fromRepeat,
    toRepeat: toRepeat,
    changed: changed,
    visibleParts: visibleParts,
    occurrenceKey: occurrenceKey,
    scopePrompt: scopePrompt
  };
  global.LanaCalendarRepeat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

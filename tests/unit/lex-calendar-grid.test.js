'use strict';

/**
 * lex-calendar-grid draws what calendar-layout.js computes: one column per
 * day, events at their wall-clock rows, overlap columns as widths, all-day
 * bars, escaped titles, and lex-calendar-open when an event is chosen.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = path.join(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const opened = [];
afterEach(() => { opened.splice(0).forEach((w) => w.close()); });

async function mount(props) {
  const dom = new JSDOM('<!doctype html><html><body><lex-calendar-grid id="g"></lex-calendar-grid></body></html>', {
    url: 'http://localhost/calendar.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole()
  });
  const w = dom.window;
  opened.push(w);
  ['js/time-utils.js', 'js/lex/lex.core.js', 'js/calendar/calendar-layout.js', 'js/lex/components/data/lex-calendar-grid.js']
    .forEach((rel) => w.eval(read(rel)));
  const grid = w.document.getElementById('g');
  Object.assign(grid, props);
  await new Promise((resolve) => w.setTimeout(resolve, 0));
  return { w, grid };
}

const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 18, h + 5, m)).toISOString(); // New York wall time (EST)

describe('lex-calendar-grid', () => {
  test('draws a week of columns with events placed and overlaps sharing the width', async () => {
    const { grid } = await mount({
      timeZone: 'America/New_York',
      days: ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'],
      items: [
        { id: 'a', title: 'Call', start: at(9), end: at(10), variant: 'mine', colorSlot: 0, badge: { label: 'LANA', kind: 'lana' } },
        { id: 'b', title: 'Busy', start: at(9, 30), end: at(10, 30), variant: 'busy', colorSlot: 1, busy: true, readOnly: true, badge: null },
        { id: 'c', title: 'Offsite', is_all_day: true, start_date: '2026-11-16', end_date: '2026-11-18', variant: 'mine', badge: null }
      ]
    });
    expect(grid.querySelectorAll('.lex-cal-column')).toHaveLength(7);
    const events = grid.querySelectorAll('.lex-cal-timed');
    expect(events).toHaveLength(2);
    const call = grid.querySelector('.lex-cal-column[data-day="2026-11-18"] .lex-cal-event--mine');
    expect(call.style.getPropertyValue('--cal-top')).toBe((9 * 60 / 1440 * 100) + '%');
    expect(call.style.getPropertyValue('--cal-width')).toBe('50%');
    const busy = grid.querySelector('.lex-cal-event--busy');
    expect(busy.style.getPropertyValue('--cal-left')).toBe('50%');
    expect(busy.querySelector('.lex-cal-badge')).toBeNull();
    const bar = grid.querySelector('.lex-cal-allday-bar');
    expect([bar.style.getPropertyValue('--cal-col-start'), bar.style.getPropertyValue('--cal-col-span')]).toEqual(['2', '2']);
  });

  test('titles are escaped, never parsed as markup', async () => {
    const { grid } = await mount({
      timeZone: 'UTC', days: ['2026-11-18'],
      items: [{ id: 'x', title: '<img src=x onerror=alert(1)>', start: '2026-11-18T10:00:00Z', end: '2026-11-18T11:00:00Z', variant: 'mine' }]
    });
    expect(grid.querySelector('img')).toBeNull();
    expect(grid.querySelector('.lex-cal-event-title').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('a daylight saving day says how long it is', async () => {
    const { grid } = await mount({ timeZone: 'America/New_York', days: ['2026-11-01'], items: [] });
    expect(grid.querySelector('.lex-cal-day-note').textContent).toBe('25 hour day');
  });

  test('choosing an event emits lex-calendar-open with that item', async () => {
    const item = { id: 'a', title: 'Call', start: '2026-11-18T10:00:00Z', end: '2026-11-18T11:00:00Z', variant: 'mine' };
    const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [item] });
    const seen = [];
    grid.addEventListener('lex-calendar-open', (e) => seen.push(e.detail.item.id));
    grid.querySelector('.lex-cal-timed').click();
    expect(seen).toEqual(['a']);
  });
});

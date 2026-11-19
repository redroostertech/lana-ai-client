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
  ['js/time-utils.js', 'js/lex/lex.core.js', 'js/lex/lex.utils.js', 'js/calendar/calendar-layout.js', 'js/lex/components/data/lex-calendar-grid.js']
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

  describe('stage 2: drag, new slots and the month view', () => {
    const pointer = (w, type, target, x, y) => {
      const e = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      (target || w).dispatchEvent(e);
    };
    const stubRect = (node, rect) => { node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 100, bottom: rect.height, width: 100, ...rect }); };

    test('dragging an editable event reports where it lands; the click that ends it does not open it', async () => {
      const item = { id: 'a', title: 'Call', start: '2026-11-18T10:00:00Z', end: '2026-11-18T11:00:00Z', variant: 'mine' };
      const { w, grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [item] });
      stubRect(grid.querySelector('.lex-cal-column'), { height: 1440, left: 0, right: 100 });
      const moved = [];
      const opened = [];
      grid.addEventListener('lex-calendar-move', (e) => moved.push(e.detail));
      grid.addEventListener('lex-calendar-open', (e) => opened.push(e.detail.item.id));
      const node = grid.querySelector('.lex-cal-timed');
      pointer(w, 'pointerdown', node, 50, 600);
      pointer(w, 'pointermove', null, 50, 692); // 92 px of a 1440 px day: 92 minutes, snapped to 90
      pointer(w, 'pointerup', null, 50, 692);
      node.click();
      expect(moved).toEqual([expect.objectContaining({ mode: 'move', start: '2026-11-18T11:30:00.000Z', end: '2026-11-18T12:30:00.000Z' })]);
      expect(opened).toEqual([]);
    });

    test('a read-only or busy event cannot be dragged', async () => {
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [
        { id: 'r', title: 'Leadli', start: '2026-11-18T10:00:00Z', end: '2026-11-18T11:00:00Z', variant: 'mine', readOnly: true },
        { id: 'b', title: 'Busy', start: '2026-11-18T12:00:00Z', end: '2026-11-18T13:00:00Z', variant: 'busy', busy: true, readOnly: true }
      ] });
      expect(grid.querySelectorAll('[data-draggable]')).toHaveLength(0);
      expect(grid.querySelectorAll('[data-cal-resize]')).toHaveLength(0);
    });

    test('a repeating event cannot be dragged until repeating events can be edited (review C5)', async () => {
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [
        { id: 'w', title: 'Weekly', start: '2026-11-18T10:00:00Z', end: '2026-11-18T11:00:00Z', variant: 'mine', recurring: true },
        { id: 'o', title: 'Once', start: '2026-11-18T12:00:00Z', end: '2026-11-18T13:00:00Z', variant: 'mine' }
      ] });
      expect(Array.from(grid.querySelectorAll('[data-draggable]')).map((n) => n.querySelector('.lex-cal-event-title').textContent)).toEqual(['Once']);
    });

    test('clicking an empty slot asks for a new event at that half hour', async () => {
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [] });
      const column = grid.querySelector('.lex-cal-column');
      stubRect(column, { height: 960 });
      const asked = [];
      grid.addEventListener('lex-calendar-create', (e) => asked.push(e.detail));
      column.dispatchEvent(new column.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, clientY: 372 }));
      expect(asked).toEqual([{ day: '2026-11-18', minutes: 9 * 60 + 30, allDay: false }]);
    });

    test('the month view draws six weeks, marks other months, and lists events with a "more" count', async () => {
      // November 2026 starts on a Sunday: six weeks from Nov 1.
      const days = Array.from({ length: 42 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10));
      const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, title: 'Event ' + id, start: `2026-11-18T1${i}:00:00Z`, end: `2026-11-18T1${i}:30:00Z`, variant: 'mine' }));
      const { grid } = await mount({ timeZone: 'UTC', view: 'month', days, items });
      expect(grid.querySelectorAll('.lex-cal-month-week')).toHaveLength(6);
      expect(grid.querySelectorAll('.lex-cal-month-cell--outside').length).toBeGreaterThan(0);
      const cell = grid.querySelector('.lex-cal-month-cell[data-day="2026-11-18"]');
      expect(cell.querySelectorAll('.lex-cal-month-item')).toHaveLength(3);
      const days_ = [];
      grid.addEventListener('lex-calendar-day', (e) => days_.push(e.detail.day));
      cell.querySelector('.lex-cal-month-more').click();
      expect(days_).toEqual(['2026-11-18']);
    });
  });

  describe('review: week view text, widths and where it opens', () => {
    test('a 30 minute event is one line, title first, without a badge; an hour keeps the badge', async () => {
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [
        { id: 's', title: 'Quick call', start: '2026-11-18T09:00:00Z', end: '2026-11-18T09:30:00Z', variant: 'mine', badge: { label: 'LANA', kind: 'lana' } },
        { id: 'l', title: 'Long one', start: '2026-11-18T11:00:00Z', end: '2026-11-18T12:00:00Z', variant: 'mine', badge: { label: 'LANA', kind: 'lana' } }
      ] });
      const [short, long] = grid.querySelectorAll('.lex-cal-timed');
      expect(short.classList.contains('lex-cal-timed--short')).toBe(true);
      expect(short.firstElementChild.classList.contains('lex-cal-event-title')).toBe(true);
      expect(short.querySelector('.lex-cal-badge')).toBeNull();
      expect(long.classList.contains('lex-cal-timed--short')).toBe(false);
      expect(long.querySelector('.lex-cal-badge')).not.toBeNull();
    });

    test('an overlapping event widens into the free column beside it', async () => {
      // a 9-11, b 9-10 and c 9-9:30 need three columns; d 10-11 takes b's column and widens into c's, free after 9:30.
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [
        { id: 'a', title: 'A', start: '2026-11-18T09:00:00Z', end: '2026-11-18T11:00:00Z', variant: 'mine' },
        { id: 'b', title: 'B', start: '2026-11-18T09:00:00Z', end: '2026-11-18T10:00:00Z', variant: 'mine' },
        { id: 'c', title: 'C', start: '2026-11-18T09:00:00Z', end: '2026-11-18T09:30:00Z', variant: 'mine' },
        { id: 'd', title: 'D', start: '2026-11-18T10:00:00Z', end: '2026-11-18T11:00:00Z', variant: 'mine' }
      ] });
      const width = (title) => parseFloat(Array.from(grid.querySelectorAll('.lex-cal-timed'))
        .find((n) => n.querySelector('.lex-cal-event-title').textContent === title).style.getPropertyValue('--cal-width'));
      expect(width('A')).toBeCloseTo(100 / 3);
      expect(width('C')).toBeCloseTo(100 / 3);
      expect(width('D')).toBeCloseTo(200 / 3);
    });

    test('every event has a native tooltip with its full title and time, escaped', async () => {
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [
        { id: 't', title: 'Free consultation: "Harper" <family>', start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z', variant: 'mine' },
        { id: 'a', title: 'CLE: Elder law update', is_all_day: true, start_date: '2026-11-18', end_date: '2026-11-19', variant: 'mine' }
      ] });
      const timed = grid.querySelector('.lex-cal-timed');
      expect(timed.getAttribute('title')).toBe('Free consultation: "Harper" <family>, 2:00 PM to 3:00 PM');
      expect(grid.querySelector('.lex-cal-allday-bar').getAttribute('title')).toBe('CLE: Elder law update, all day');
      expect(timed.getAttribute('aria-label')).toMatch(/^Free consultation: "Harper" <family>, 2:00 PM to 3:00 PM/);
    });

    test('month items carry the tooltip too', async () => {
      const { w, grid } = await mount({ timeZone: 'UTC', days: [] });
      Object.assign(grid, { view: 'month', days: w.LanaCalendarLayout.viewDays('month', '2026-11-18'), items: [
        { id: 'm', title: 'Weekly case review', start: '2026-11-20T15:00:00Z', end: '2026-11-20T16:00:00Z', variant: 'mine' }
      ] });
      await new Promise((resolve) => w.setTimeout(resolve, 0));
      expect(grid.querySelector('.lex-cal-month-item').getAttribute('title')).toBe('Weekly case review, 3:00 PM to 4:00 PM');
    });

    test('an event of 45 minutes or more may wrap its title to two lines; a shorter one stays one line', async () => {
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [
        { id: 's', title: 'Quick call', start: '2026-11-18T09:00:00Z', end: '2026-11-18T09:30:00Z', variant: 'mine' },
        { id: 'h', title: 'Estate plan review: Chen', start: '2026-11-18T11:00:00Z', end: '2026-11-18T12:00:00Z', variant: 'mine' }
      ] });
      const [short, hour] = grid.querySelectorAll('.lex-cal-timed');
      expect(short.classList.contains('lex-cal-timed--wrap')).toBe(false);
      expect(hour.classList.contains('lex-cal-timed--wrap')).toBe(true);
    });

    test('the all-day chip carries no badge (the badge is in its label)', async () => {
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [
        { id: 'c', title: 'CLE: Elder law', is_all_day: true, start_date: '2026-11-18', end_date: '2026-11-19', variant: 'mine', badge: { label: 'Leadli', kind: 'connector' } }
      ] });
      const bar = grid.querySelector('.lex-cal-allday-bar');
      expect(bar.querySelector('.lex-cal-badge')).toBeNull();
      expect(bar.getAttribute('aria-label')).toContain('Leadli');
    });
  });

  describe('grid edges (calendar screenshots, 2026-11-18)', () => {
    const css = read('css/lex-calendar-grid.css').replace(/\/\*[\s\S]*?\*\//g, '');
    // Every rule whose selector list ends with `selector`, joined.
    const rule = (selector) => {
      const out = [];
      for (let at = css.indexOf(selector + ' {'); at !== -1; at = css.indexOf(selector + ' {', at + 1)) {
        out.push(css.slice(at, css.indexOf('}', at)));
      }
      return out.join('\n');
    };

    test('the scrollbar never covers the last column: the body keeps a gutter and the rows above match it', () => {
      expect(rule('.lex-cal-body')).toMatch(/scrollbar-gutter:\s*stable/);
      expect(rule('.lex-cal-head,\n.lex-cal-allday')).toMatch(/scrollbar-gutter:\s*stable/);
      expect(rule('.lex-cal-head,\n.lex-cal-allday,\n.lex-cal-body')).toMatch(/padding-right:\s*var\(--cal-scroll-pad\)/);
    });

    test('hour labels sit inside their hour, so the top one is never cut by the all-day row', async () => {
      expect(rule('.lex-cal-hour span')).not.toMatch(/top:\s*-/);
      const { grid } = await mount({ timeZone: 'UTC', days: ['2026-11-18'], items: [] });
      const labels = [...grid.querySelectorAll('.lex-cal-hour span')].map((n) => n.textContent);
      expect(labels.slice(0, 2)).toEqual(['12 AM', '1 AM']);
      expect(labels[8]).toBe('8 AM');
    });
  });
});

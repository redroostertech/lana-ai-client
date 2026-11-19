/* Lex UI - Calendar Grid (Tier 3: setData-style properties)
   Day, week and work-week time grid (a header row of days, an all-day
   row, an hour gutter and one column per day with events placed on the
   wall clock of `time-zone`), or a month grid (view="month": six weeks of
   day cells). All layout and drag math (day boundaries, daylight saving
   days, midnight crossings, overlap columns, all-day lanes, month cells,
   where a dragged event lands) is in js/calendar/calendar-layout.js; this
   component only draws it and reports what the person did.
   Styles: css/lex-calendar-grid.css.

   Usage:
     <lex-calendar-grid id="grid" time-zone="America/New_York" view="week"></lex-calendar-grid>
     grid.days = ['2026-11-15', ..., '2026-11-21'];
     grid.items = [{ id, start, end, is_all_day, start_date, end_date, title,
                     variant: 'mine'|'coworker'|'busy', colorSlot, badge: { label, kind }|null,
                     readOnly, organizer, status }];

   Events:
     lex-calendar-open { item }    an event is chosen (click, Enter or Space)
     lex-calendar-move { item, mode: 'move'|'resize', start, end }
                                   an editable timed event was dragged (or its
                                   bottom edge, to resize); start/end are ISO
     lex-calendar-create { day, minutes|null, allDay }
                                   an empty time slot (or a month day) was chosen
     lex-calendar-day { day }      "more" in a month cell was chosen
   Requires: js/time-utils.js (LanaTime), js/calendar/calendar-layout.js.
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  function hourLabel(hour) {
    if (hour === 0) return '12 AM';
    if (hour < 12) return hour + ' AM';
    if (hour === 12) return '12 PM';
    return (hour - 12) + ' PM';
  }

  class LexCalendarGrid extends LexElement {
    static get properties() {
      return {
        days: { type: Array, default: [], attribute: false },
        items: { type: Array, default: [], attribute: false },
        timeZone: { type: String, default: 'UTC' },
        view: { type: String, default: 'week' },
        // Month rows that fit in a cell, measured after each render (internal).
        monthCapacity: { type: Number, default: 0, attribute: false },
        // Wall minutes a day or week view opens at; null: LanaCalendarLayout.initialScrollMinutes.
        scrollMinutes: { type: Number, default: null, attribute: false },
        loading: { type: Boolean, default: false, reflect: true },
        emptyText: { type: String, default: '' }
      };
    }

    _layout() {
      const L = window.LanaCalendarLayout;
      return L.layout({ days: this.days || [], timeZone: this.timeZone || 'UTC', events: this.items || [] });
    }

    _dayHeading(day) {
      const T = window.LanaTime;
      const noon = new Date(T.startOfDayInTimeZone(day, this.timeZone).getTime() + 12 * T.MS_PER_HOUR);
      const fmt = (options) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: this.timeZone }, options)).format(noon);
      return { weekday: fmt({ weekday: 'short' }), date: fmt({ day: 'numeric' }), full: fmt({ weekday: 'long', month: 'long', day: 'numeric' }) };
    }

    _timeRange(item) {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: this.timeZone, hour: 'numeric', minute: '2-digit' });
      const start = new Date(item.start);
      const end = new Date(item.end);
      if (!Number.isFinite(start.getTime())) return '';
      return Number.isFinite(end.getTime()) && end > start ? fmt.format(start) + ' to ' + fmt.format(end) : fmt.format(start);
    }

    _eventClasses(item, extra) {
      const classes = ['lex-cal-event', 'lex-cal-event--' + (item.variant || 'mine'), 'lex-cal-person-' + (Number(item.colorSlot) || 0)];
      if (item.readOnly) classes.push('lex-cal-event--readonly');
      if (item.status === 'no_show' || item.status === 'completed') classes.push('lex-cal-event--past-status');
      return classes.concat(extra || []).join(' ');
    }

    _eventLabel(item, when) {
      const parts = [item.title, when];
      if (item.badge) parts.push(item.badge.label);
      if (item.organizer) parts.push('Organizer ' + item.organizer);
      if (item.readOnly && !item.busy) parts.push('read only');
      return parts.filter(Boolean).join(', ');
    }

    _badge(item) {
      if (!item.badge) return '';
      return `<span class="lex-cal-badge lex-cal-badge--${this.escapeHtml(item.badge.kind)}">${this.escapeHtml(item.badge.label)}</span>`;
    }

    _renderMonth(days) {
      const L = window.LanaCalendarLayout;
      const T = window.LanaTime;
      const month = days[Math.min(days.length - 1, 7)];
      const result = L.monthLayout({ days, month, timeZone: this.timeZone || 'UTC', events: this.items || [],
        capacity: this.monthCapacity > 0 ? this.monthCapacity : undefined });
      this._byKey = {};
      const weekdays = days.slice(0, 7).map((day) => `<div class="lex-cal-month-weekday" role="columnheader">${this.escapeHtml(this._dayHeading(day).weekday)}</div>`).join('');
      const today = T.dayInTimeZone(T.nowDate(), this.timeZone || 'UTC');
      const weeks = result.weeks.map((week, w) => {
        const cells = week.map((cell, d) => {
          const items = cell.items.map((entry, i) => {
            const key = 'm' + w + '-' + d + '-' + i;
            this._byKey[key] = entry.event;
            const item = entry.event;
            const when = item.is_all_day ? 'all day' : this._timeRange(item);
            const startLabel = item.is_all_day || entry.continuesBefore ? '' : new Intl.DateTimeFormat('en-US', { timeZone: this.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(item.start));
            return `<button type="button" class="${this._eventClasses(item, ['lex-cal-month-item', item.is_all_day || entry.continuesBefore || entry.continuesAfter ? 'lex-cal-month-item--bar' : ''])}" data-cal-key="${key}"
                aria-label="${this.escapeHtml(this._eventLabel(item, when))}">
              ${startLabel ? `<span class="lex-cal-event-time">${this.escapeHtml(startLabel)}</span>` : ''}
              <span class="lex-cal-event-title">${this.escapeHtml(item.title)}</span>
            </button>`;
          }).join('');
          const more = cell.more ? `<button type="button" class="lex-cal-month-more" data-cal-more="${this.escapeHtml(cell.day)}">${cell.more} more</button>` : '';
          const heading = this._dayHeading(cell.day);
          const classes = ['lex-cal-month-cell'];
          if (cell.outside) classes.push('lex-cal-month-cell--outside');
          if (cell.day === today) classes.push('lex-cal-month-cell--today');
          return `<div class="${classes.join(' ')}" role="gridcell" data-day="${this.escapeHtml(cell.day)}">
            <button type="button" class="lex-cal-month-date" data-cal-new-day="${this.escapeHtml(cell.day)}" aria-label="${this.escapeHtml('New event on ' + heading.full)}">${this.escapeHtml(heading.date)}</button>
            <div class="lex-cal-month-items">${items}${more}</div>
          </div>`;
        }).join('');
        return `<div class="lex-cal-month-week" role="row">${cells}</div>`;
      }).join('');
      const empty = !(this.items || []).length && this.emptyText ? `<p class="lex-cal-empty">${this.escapeHtml(this.emptyText)}</p>` : '';
      return `<div class="lex-cal-grid lex-cal-grid--month" role="grid" aria-busy="${this.loading ? 'true' : 'false'}" data-days="7">
        <div class="lex-cal-month-head" role="row">${weekdays}</div>
        <div class="lex-cal-month-body">${weeks}</div>
        ${empty}
      </div>`;
    }

    render() {
      const days = this.days || [];
      if (!days.length) return '<div class="lex-cal-grid lex-cal-grid--empty"></div>';
      if (this.view === 'month') return this._renderMonth(days);
      const result = this._layout();
      const L = window.LanaCalendarLayout;
      this._byKey = {};

      const heads = days.map((day, index) => {
        const h = this._dayHeading(day);
        const today = L.nowMinutes(day, this.timeZone) !== null;
        const hours = result.days[index].hours;
        const dst = hours !== 24
          ? `<span class="lex-cal-day-note">${hours} hour day</span>` : '';
        return `<div class="lex-cal-day-head${today ? ' lex-cal-day-head--today' : ''}" role="columnheader" aria-label="${this.escapeHtml(h.full)}">
          <span class="lex-cal-day-weekday">${this.escapeHtml(h.weekday)}</span>
          <span class="lex-cal-day-date">${this.escapeHtml(h.date)}</span>${dst}
        </div>`;
      }).join('');

      const allDay = result.allDay.map((bar, i) => {
        const key = 'a' + i;
        this._byKey[key] = bar.event;
        const item = bar.event;
        return `<button type="button" class="${this._eventClasses(item, ['lex-cal-allday-bar'])}" data-cal-key="${key}"
            data-col="${bar.firstColumn}" data-span="${bar.span}" data-lane="${bar.lane}"
            aria-label="${this.escapeHtml(this._eventLabel(item, 'all day'))}">
          ${bar.continuesBefore ? '<span class="lex-cal-continues" aria-hidden="true">&lsaquo;</span>' : ''}
          <span class="lex-cal-event-title">${this.escapeHtml(item.title)}</span>
          ${bar.continuesAfter ? '<span class="lex-cal-continues" aria-hidden="true">&rsaquo;</span>' : ''}
        </button>`;
      }).join('');

      const gutter = L.hourLabels(hourLabel).map((h) =>
        `<div class="lex-cal-hour" data-hour="${h.hour}"><span>${h.hour === 0 ? '' : this.escapeHtml(h.label)}</span></div>`).join('');

      const columns = result.days.map((column, dayIndex) => {
        const events = column.timed.map((seg, i) => {
          const key = 'd' + dayIndex + '-' + i;
          this._byKey[key] = seg.event;
          const item = seg.event;
          const when = this._timeRange(item);
          const draggable = !item.readOnly && !item.busy && !item.recurring;
          // Under 45 minutes there is room for one line: title first, then the time.
          const short = seg.bottom - seg.top < 45;
          const tall = seg.bottom - seg.top >= 75;
          return `<button type="button" class="${this._eventClasses(item, ['lex-cal-timed', short ? 'lex-cal-timed--short' : '', tall ? 'lex-cal-timed--tall' : ''])}" data-cal-key="${key}"
              data-top="${seg.top}" data-bottom="${seg.bottom}" data-column="${seg.column}" data-columns="${seg.columns}" data-span="${seg.span || 1}"
              data-day-index="${dayIndex}"${draggable ? ' data-draggable="true"' : ''}
              aria-label="${this.escapeHtml(this._eventLabel(item, when))}">
            <span class="lex-cal-event-title">${this.escapeHtml(item.title)}</span>
            <span class="lex-cal-event-time">${this.escapeHtml(when)}</span>${short ? '' : this._badge(item)}
            ${draggable && !seg.continuesAfter ? '<span class="lex-cal-resize" data-cal-resize aria-hidden="true"></span>' : ''}
          </button>`;
        }).join('');
        const now = L.nowMinutes(column.day, this.timeZone);
        const nowLine = now === null ? '' : `<div class="lex-cal-now" data-top="${now}" aria-hidden="true"></div>`;
        return `<div class="lex-cal-column" role="gridcell" data-day="${this.escapeHtml(column.day)}">${events}${nowLine}</div>`;
      }).join('');

      const empty = !(this.items || []).length && this.emptyText
        ? `<p class="lex-cal-empty">${this.escapeHtml(this.emptyText)}</p>` : '';

      return `<div class="lex-cal-grid" role="grid" aria-busy="${this.loading ? 'true' : 'false'}" data-days="${days.length}">
        <div class="lex-cal-head" role="row"><div class="lex-cal-corner"></div>${heads}</div>
        <div class="lex-cal-allday" data-lanes="${result.allDayLanes}">
          <div class="lex-cal-allday-label">All day</div>
          <div class="lex-cal-allday-track">${allDay}</div>
        </div>
        <div class="lex-cal-body">
          <div class="lex-cal-gutter" aria-hidden="true">${gutter}</div>
          <div class="lex-cal-columns">${columns}</div>
        </div>
        ${empty}
      </div>`;
    }

    updated() {
      const grid = this.querySelector('.lex-cal-grid');
      if (!grid) return;
      this.delegate('click', '[data-cal-key]', this._onOpen);
      this.delegate('click', '[data-cal-more]', (e, target) => this.emit('lex-calendar-day', { day: target.getAttribute('data-cal-more') }));
      this.delegate('click', '[data-cal-new-day]', (e, target) => this.emit('lex-calendar-create', { day: target.getAttribute('data-cal-new-day'), minutes: null, allDay: false }));
      if (this.view === 'month') {
        this._measureMonth();
        return;
      }
      this.delegate('click', '.lex-cal-column', this._onSlot);
      this.delegate('pointerdown', '[data-draggable]', this._onDragStart);
      const days = Number(grid.getAttribute('data-days')) || 1;
      grid.style.setProperty('--cal-days', String(days));
      const allday = this.querySelector('.lex-cal-allday');
      if (allday) allday.style.setProperty('--cal-lanes', String(Math.max(1, Number(allday.getAttribute('data-lanes')) || 0)));
      const perDay = window.LanaCalendarLayout.MINUTES_PER_DAY;
      this.querySelectorAll('.lex-cal-timed').forEach((node) => {
        const top = Number(node.getAttribute('data-top'));
        const bottom = Number(node.getAttribute('data-bottom'));
        const column = Number(node.getAttribute('data-column'));
        const columns = Math.max(1, Number(node.getAttribute('data-columns')));
        const span = Math.max(1, Number(node.getAttribute('data-span')) || 1);
        node.style.setProperty('--cal-top', (top / perDay * 100) + '%');
        node.style.setProperty('--cal-height', ((bottom - top) / perDay * 100) + '%');
        node.style.setProperty('--cal-left', (column / columns * 100) + '%');
        node.style.setProperty('--cal-width', (span / columns * 100) + '%');
      });
      this.querySelectorAll('.lex-cal-now').forEach((node) => {
        node.style.setProperty('--cal-top', (Number(node.getAttribute('data-top')) / perDay * 100) + '%');
      });
      this.querySelectorAll('.lex-cal-allday-bar').forEach((node) => {
        node.style.setProperty('--cal-col-start', String(Number(node.getAttribute('data-col')) + 1));
        node.style.setProperty('--cal-col-span', String(Number(node.getAttribute('data-span'))));
        node.style.setProperty('--cal-lane', String(Number(node.getAttribute('data-lane')) + 1));
      });
      this._scrollToMorning();
    }

    // How many event rows a month cell really holds; a change draws again so
    // "N more" appears only when the rows do not fit.
    _measureMonth() {
      const cell = this.querySelector('.lex-cal-month-cell');
      if (!cell) return;
      const style = window.getComputedStyle(cell);
      const inner = cell.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      const date = cell.querySelector('.lex-cal-month-date');
      const item = this.querySelector('.lex-cal-month-item');
      const rowGap = parseFloat(window.getComputedStyle(cell.querySelector('.lex-cal-month-items') || cell).rowGap) || 0;
      const rowHeight = item ? item.getBoundingClientRect().height + rowGap : 0;
      const capacity = window.LanaCalendarLayout.monthCapacity(inner, date ? date.getBoundingClientRect().height + rowGap : 0, rowHeight);
      if (rowHeight > 0 && capacity !== this.monthCapacity) this.monthCapacity = capacity;
    }

    // An empty slot in a day column: a new event at that wall time.
    _onSlot(event, column) {
      if (event.target !== column) return;
      const rect = column.getBoundingClientRect();
      const minutes = window.LanaCalendarLayout.minutesAtOffset(event.clientY - rect.top, rect.height, 30);
      this.emit('lex-calendar-create', { day: column.getAttribute('data-day'), minutes, allDay: false });
    }

    // Drag an editable timed event to move it (or its bottom edge to resize).
    // Nothing is saved here: lex-calendar-move reports where it would land.
    _onDragStart(event, node) {
      if (event.button !== undefined && event.button !== 0) return;
      const item = this._byKey && this._byKey[node.getAttribute('data-cal-key')];
      const columns = Array.from(this.querySelectorAll('.lex-cal-column'));
      const column = node.closest('.lex-cal-column');
      if (!item || !column) return;
      const drag = {
        node, item, columns,
        mode: event.target.closest('[data-cal-resize]') ? 'resize' : 'move',
        x: event.clientX, y: event.clientY,
        height: column.getBoundingClientRect().height,
        dayIndex: Number(node.getAttribute('data-day-index')) || 0,
        moved: false, dayDelta: 0, minuteDelta: 0
      };
      const onMove = (e) => {
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dy) < 4 && Math.abs(e.clientX - drag.x) < 4) return;
        drag.moved = true;
        drag.minuteDelta = drag.height > 0 ? dy / drag.height * window.LanaCalendarLayout.MINUTES_PER_DAY : 0;
        const over = drag.mode === 'move'
          ? drag.columns.findIndex((col) => { const r = col.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; })
          : -1;
        drag.dayDelta = over === -1 ? (drag.mode === 'move' ? drag.dayDelta : 0) : over - drag.dayIndex;
        const snapped = window.LanaCalendarLayout.snapMinutes(drag.minuteDelta);
        const px = drag.height > 0 ? snapped / window.LanaCalendarLayout.MINUTES_PER_DAY * drag.height : 0;
        const colWidth = drag.columns[0] ? drag.columns[0].getBoundingClientRect().width : 0;
        node.classList.add(drag.mode === 'resize' ? 'lex-cal-event--resizing' : 'lex-cal-event--dragging');
        node.style.setProperty('--cal-drag-y', (drag.mode === 'move' ? px : 0) + 'px');
        node.style.setProperty('--cal-drag-x', (drag.dayDelta * colWidth) + 'px');
        node.style.setProperty('--cal-drag-grow', (drag.mode === 'resize' ? px : 0) + 'px');
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (!drag.moved) return;
        // The click that ends a drag does not also open the event.
        this._suppressClickUntil = Date.now() + 400;
        node.classList.remove('lex-cal-event--dragging', 'lex-cal-event--resizing');
        const landed = window.LanaCalendarLayout.dragResult(item, { mode: drag.mode, dayDelta: drag.dayDelta, minuteDelta: drag.minuteDelta }, this.timeZone);
        if (!landed || (landed.start === new Date(item.start).toISOString() && landed.end === new Date(item.end).toISOString())) {
          ['--cal-drag-y', '--cal-drag-x', '--cal-drag-grow'].forEach((name) => node.style.removeProperty(name));
          return;
        }
        this.emit('lex-calendar-move', { item, mode: drag.mode, start: landed.start, end: landed.end });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }

    _onOpen(event, target) {
      if (this._suppressClickUntil && Date.now() < this._suppressClickUntil) return;
      const node = target || (event.target && event.target.closest && event.target.closest('[data-cal-key]'));
      const item = node && this._byKey && this._byKey[node.getAttribute('data-cal-key')];
      if (item) this.emit('lex-calendar-open', { item });
    }

    // Open near the working day (LanaCalendarLayout.initialScrollMinutes, or
    // scrollMinutes when the page sets it) the first time; after that every
    // render keeps where the person scrolled, across days and views.
    _scrollToMorning() {
      const body = this.querySelector('.lex-cal-body');
      if (!body) return;
      if (this._savedScrollTop === undefined) {
        const minutes = Number.isFinite(this.scrollMinutes) && this.scrollMinutes !== null
          ? this.scrollMinutes
          : window.LanaCalendarLayout.initialScrollMinutes(this.days || [], this.timeZone);
        body.scrollTop = Math.max(0, body.scrollHeight * (minutes / window.LanaCalendarLayout.MINUTES_PER_DAY));
        // Remember it only once the first agenda has drawn and the body can
        // scroll; until then every render opens at the work day again.
        if (!this.loading && body.scrollHeight > body.clientHeight) this._savedScrollTop = body.scrollTop;
      } else {
        body.scrollTop = this._savedScrollTop;
      }
      // Only the person's own scrolling is remembered: the scroll events our
      // own assignment causes (clamped while a view is still short) are not.
      const ownScrollUntil = Date.now() + 250;
      this.listen(body, 'scroll', () => {
        if (this._savedScrollTop !== undefined && Date.now() > ownScrollUntil && !this.loading) this._savedScrollTop = body.scrollTop;
      });
    }
  }

  defineLex('lex-calendar-grid', LexCalendarGrid);
})();

/* Lex UI - Calendar Grid (Tier 3: setData-style properties)
   Day or week time grid: a header row of days, an all-day row, an hour
   gutter and one column per day with events placed on the wall clock of
   `time-zone`. All layout math (day boundaries, daylight saving days,
   midnight crossings, overlap columns, all-day lanes) is in
   js/calendar/calendar-layout.js; this component only draws it.
   Styles: css/lex-calendar-grid.css.

   Usage:
     <lex-calendar-grid id="grid" time-zone="America/New_York"></lex-calendar-grid>
     grid.days = ['2026-11-15', ..., '2026-11-21'];
     grid.items = [{ id, start, end, is_all_day, start_date, end_date, title,
                     variant: 'mine'|'coworker'|'busy', colorSlot, badge: { label, kind }|null,
                     readOnly, organizer, status }];

   Events: lex-calendar-open { item } when an event is chosen (click, Enter or Space).
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

    render() {
      const days = this.days || [];
      if (!days.length) return '<div class="lex-cal-grid lex-cal-grid--empty"></div>';
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
          <span class="lex-cal-event-title">${this.escapeHtml(item.title)}</span>${this._badge(item)}
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
          return `<button type="button" class="${this._eventClasses(item, ['lex-cal-timed'])}" data-cal-key="${key}"
              data-top="${seg.top}" data-bottom="${seg.bottom}" data-column="${seg.column}" data-columns="${seg.columns}"
              aria-label="${this.escapeHtml(this._eventLabel(item, when))}">
            <span class="lex-cal-event-title">${this.escapeHtml(item.title)}</span>
            <span class="lex-cal-event-time">${this.escapeHtml(when)}</span>${this._badge(item)}
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
        node.style.setProperty('--cal-top', (top / perDay * 100) + '%');
        node.style.setProperty('--cal-height', ((bottom - top) / perDay * 100) + '%');
        node.style.setProperty('--cal-left', (column / columns * 100) + '%');
        node.style.setProperty('--cal-width', (100 / columns) + '%');
      });
      this.querySelectorAll('.lex-cal-now').forEach((node) => {
        node.style.setProperty('--cal-top', (Number(node.getAttribute('data-top')) / perDay * 100) + '%');
      });
      this.querySelectorAll('.lex-cal-allday-bar').forEach((node) => {
        node.style.setProperty('--cal-col-start', String(Number(node.getAttribute('data-col')) + 1));
        node.style.setProperty('--cal-col-span', String(Number(node.getAttribute('data-span'))));
        node.style.setProperty('--cal-lane', String(Number(node.getAttribute('data-lane')) + 1));
      });
      this.delegate('click', '[data-cal-key]', this._onOpen);
      this._scrollToMorning();
    }

    _onOpen(event, target) {
      const node = target || (event.target && event.target.closest && event.target.closest('[data-cal-key]'));
      const item = node && this._byKey && this._byKey[node.getAttribute('data-cal-key')];
      if (item) this.emit('lex-calendar-open', { item });
    }

    // Start the view near the working day once per set of days.
    _scrollToMorning() {
      const body = this.querySelector('.lex-cal-body');
      const signature = (this.days || []).join(',') + '|' + this.timeZone;
      if (!body || this._scrolledFor === signature) return;
      this._scrolledFor = signature;
      body.scrollTop = Math.max(0, body.scrollHeight * (7 / 24));
    }
  }

  defineLex('lex-calendar-grid', LexCalendarGrid);
})();

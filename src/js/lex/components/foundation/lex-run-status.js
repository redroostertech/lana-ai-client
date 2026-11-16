/* Lex UI: Run Status
   One run status mark for the Automations and Agents apps, after LANA
   Orcestr8's live run views: a running run breathes (ring) and can show a
   sliding bar, a run that needs a person shows amber, a finished run a check,
   a failed run a cross. A run that just ended pops once (the `settled`
   attribute, set by the view from LanaRunStatus.trackTransitions).

   Usage:
     <lex-run-status status="in_progress"></lex-run-status>
     <lex-run-status status="failed" time="3h ago"></lex-run-status>
     <lex-run-status status="running" bar></lex-run-status>
     <lex-run-status status="completed" compact></lex-run-status>     (mark only)
     el.lastRun = { run_id, state, status, started_at, finished_at }    (API last_run)

   status takes a raw automation or agent status or a LanaRunStatus state.
   Styles and motion: css/lex-run-status.css (respects reduced motion).
   Needs js/shared/run-status.js loaded first.
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  const MARKS = {
    succeeded: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    failed: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cancelled: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 8h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    waiting: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.5v4M8 11.2v.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  class LexRunStatus extends LexElement {
    static get properties() {
      return {
        status:  { type: String, default: '' },
        label:   { type: String, default: '' },
        time:    { type: String, default: '' },
        compact: { type: Boolean, default: false },
        bar:     { type: Boolean, default: false },
        settled: { type: Boolean, default: false },
        lastRun: { type: Object, attribute: false }
      };
    }

    _summary() {
      const RunStatus = window.LanaRunStatus;
      if (this.lastRun && typeof this.lastRun === 'object' && RunStatus) {
        return RunStatus.lastRunSummary(this.lastRun);
      }
      const state = RunStatus ? RunStatus.stateOf(this.status) : (this.status || 'unknown');
      const known = RunStatus && RunStatus.LABELS[this.status] ? this.status : state;
      return { state: known, label: RunStatus ? RunStatus.labelOf(known) : known, time: '' };
    }

    render() {
      const summary = this._summary();
      const state = summary.state;
      const label = this.label || summary.label;
      const time = this.time || summary.time;
      const live = state === 'running' || state === 'queued';
      const classes = ['lex-run-status', `lex-run-status--${state}`];
      if (this.compact) classes.push('lex-run-status--compact');
      if (this.settled) classes.push('lex-run-status--settled');
      if (this.bar && live) classes.push('lex-run-status--with-bar');
      const spoken = time ? `${label}, ${time}` : label;
      return `<span class="${classes.join(' ')}" role="img" aria-label="${this.escapeHtml(spoken)}" title="${this.escapeHtml(spoken)}">`
        + `<span class="lex-run-status__mark">${MARKS[state] || ''}</span>`
        + (this.compact ? '' : `<span class="lex-run-status__label">${this.escapeHtml(label)}</span>`)
        + (!this.compact && time ? `<span class="lex-run-status__time">${this.escapeHtml(time)}</span>` : '')
        + (this.bar && live ? '<span class="lex-run-status__bar" aria-hidden="true"><span></span></span>' : '')
        + '</span>';
    }
  }

  defineLex('lex-run-status', LexRunStatus);
})();

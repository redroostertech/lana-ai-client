/* Lex UI: Run Trace
   The step-by-step live trace of one run, shared by the Automations and
   Agents apps, after LANA Orcestr8's live run view: the step a live run is on
   pulses, steps that arrive rise in, ended steps show a check or a cross with
   their time, and the list stays pinned to the newest step unless the person
   has scrolled up to read.

   Usage:
     <lex-run-trace live></lex-run-trace>
     trace.steps = run.step_outcomes;   // automation step outcomes or agent steps

   Step shape and the active step come from LanaRunStatus.traceSteps
   (js/shared/run-status.js, load it first). Styles: css/lex-run-status.css.
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  const MARKS = {
    succeeded: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    failed: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${(ms / 60000).toFixed(1)} min`;
  }

  class LexRunTrace extends LexElement {
    static get properties() {
      return {
        live:  { type: Boolean, default: false },
        empty: { type: String, default: 'No steps yet.' },
        steps: { type: Array, attribute: false }
      };
    }

    constructor() {
      super();
      this._seenKeys = null;
      this._pinned = true;
    }

    render() {
      const RunStatus = window.LanaRunStatus;
      const steps = RunStatus ? RunStatus.traceSteps(this.steps || [], { live: this.live }) : [];
      const seen = this._seenKeys;
      this._seenKeys = new Set(steps.map((step) => step.key));
      if (!steps.length) {
        return `<div class="lex-run-trace lex-run-trace--empty">${this.escapeHtml(this.empty)}</div>`;
      }
      const items = steps.map((step) => {
        const classes = ['lex-run-trace__step', `lex-run-trace__step--${step.state}`];
        if (step.active) classes.push('lex-run-trace__step--active');
        if (seen && !seen.has(step.key)) classes.push('lex-run-trace__step--new');
        const duration = formatDuration(step.durationMs);
        return `<li class="${classes.join(' ')}"${step.active ? ' aria-current="step"' : ''}>`
          + `<span class="lex-run-trace__mark" aria-hidden="true">${MARKS[step.state] || ''}</span>`
          + '<span class="lex-run-trace__body">'
          + `<span class="lex-run-trace__label">${this.escapeHtml(step.label)}</span>`
          + (step.detail ? `<span class="lex-run-trace__detail">${this.escapeHtml(step.detail)}</span>` : '')
          + (step.active ? '<span class="lex-run-trace__bar" aria-hidden="true"><span></span></span>' : '')
          + '</span>'
          + `<span class="lex-run-trace__time">${this.escapeHtml(step.active ? 'Working' : duration)}</span>`
          + '</li>';
      }).join('');
      return `<ol class="lex-run-trace${this.live ? ' lex-run-trace--live' : ''}" aria-live="polite">${items}</ol>`;
    }

    updated() {
      const list = this.querySelector('.lex-run-trace');
      if (!list) return;
      this.listen(list, 'scroll', () => {
        this._pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
      });
      if (this._pinned) list.scrollTop = list.scrollHeight;
    }
  }

  defineLex('lex-run-trace', LexRunTrace);
})();

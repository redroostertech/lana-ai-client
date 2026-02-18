/* Lex UI — Metric Component
   KPI display with value, label, change indicator, and status color.
   Features animated left accent bar on hover (LANA card style).

   Usage:
     <lex-metric label="Active Matters" value="42"></lex-metric>
     <lex-metric label="Revenue" value="$12,500" change="8.2" direction="up" status="green"></lex-metric>
     <lex-metric label="Overdue" value="3" change="-2" direction="down" status="red"></lex-metric>

   Status: green | red | yellow | blue | gray
   Direction: up | down | flat
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-metric-styles';
    style.textContent = `
      lex-metric {
        display: block;
      }

      .lex-metric {
        position: relative;
        padding: 12px 16px 12px 20px;
        overflow: hidden;
        transition: background 0.3s ease, transform 0.3s ease;
        cursor: default;
      }

      /* Animated left accent bar */
      .lex-metric::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 0%;
        border-radius: 0 2px 2px 0;
        transition: height 0.3s ease;
      }

      .lex-metric:hover {
        background: var(--lex-bg-secondary, rgba(0,0,0,0.02));
        transform: translateX(4px);
      }

      .lex-metric:hover::before {
        height: 50%;
      }

      /* Accent bar colors */
      .lex-metric--green::before  { background: var(--lex-color-success-500); }
      .lex-metric--red::before    { background: var(--lex-color-danger-500); }
      .lex-metric--yellow::before { background: var(--lex-color-warning-500); }
      .lex-metric--blue::before   { background: var(--lex-color-info-500); }
      .lex-metric--gray::before   { background: var(--lex-text-tertiary); }

      .lex-metric-label {
        color: var(--lex-text-secondary);
        font-weight: var(--lex-weight-medium, 500);
        letter-spacing: 0.01em;
        line-height: 1.4;
      }

      .lex-metric-label--sm { font-size: var(--lex-form-help-size, 0.6875rem); }
      .lex-metric-label--md { font-size: var(--lex-form-font-size, 0.8125rem); }
      .lex-metric-label--lg { font-size: var(--lex-body-sm-size, 0.875rem); }

      .lex-metric-value {
        color: var(--lex-text-primary);
        font-weight: var(--lex-weight-bold, 700);
        line-height: 1.2;
        margin-top: 4px;
      }

      .lex-metric-value--sm { font-size: 1.25rem; }
      .lex-metric-value--md { font-size: 1.5rem; }
      .lex-metric-value--lg { font-size: 1.875rem; }

      .lex-metric-change {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        font-size: var(--lex-body-xs-size, 0.75rem);
        font-weight: var(--lex-weight-medium, 500);
      }

      .lex-metric-change svg {
        width: 14px;
        height: 14px;
      }

      .lex-metric-change--up   { color: var(--lex-color-success-600); }
      .lex-metric-change--down { color: var(--lex-color-danger-600); }
      .lex-metric-change--flat { color: var(--lex-text-secondary); }
    `;
    document.head.appendChild(style);
  }

  const ARROW_UP = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>';
  const ARROW_DOWN = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>';
  const ARROW_FLAT = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14"/></svg>';

  class LexMetric extends LexElement {
    static get properties() {
      return {
        label:     { type: String, default: '' },
        value:     { type: String, default: '' },
        change:    { type: String },
        direction: { type: String, default: 'flat' },
        status:    { type: String, default: 'gray' },
        size:      { type: String, default: 'md' }
      };
    }

    render() {
      injectStyles();

      const sz = this.size || 'md';
      const statusCls = `lex-metric--${this.status || 'gray'}`;

      const icons = { up: ARROW_UP, down: ARROW_DOWN, flat: ARROW_FLAT };
      const dir = this.direction || 'flat';

      let changeHtml = '';
      if (this.change) {
        changeHtml = `
          <div class="lex-metric-change lex-metric-change--${dir}">
            ${icons[dir] || ''}
            <span>${this.escapeHtml(this.change)}%</span>
          </div>
        `;
      }

      return `
        <div class="lex-metric ${statusCls}">
          <div class="lex-metric-label lex-metric-label--${sz}">${this.escapeHtml(this.label)}</div>
          <div class="lex-metric-value lex-metric-value--${sz}">${this.escapeHtml(this.value)}</div>
          ${changeHtml}
        </div>
      `;
    }
  }

  defineLex('lex-metric', LexMetric);
})();

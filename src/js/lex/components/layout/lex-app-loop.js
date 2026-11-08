/* Lex UI: App Loop
   The "how it works" row under an app home's hero: a small label, a heading, and three
   numbered steps (01, 02, 03), each a button that leads somewhere in the app.

   Usage:
     <lex-app-loop kicker="A simple loop" heading="You always know what happens next."
       steps='[{"value":"build","title":"Build","text":"Start with the outcome..."}, ...]'>
     </lex-app-loop>

   Properties: kicker, heading, steps (JSON array of { value, title, text }, up to four).
   Event: lex-app-loop-select { value } when a step is clicked.
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  function injectStyles() {
    if (document.getElementById('lex-app-loop-styles')) return;
    const style = document.createElement('style');
    style.id = 'lex-app-loop-styles';
    style.textContent = `
      lex-app-loop { display: block; container-type: inline-size; }
      .lex-app-loop { display: flex; flex-direction: column; gap: 16px; }
      .lex-app-loop-kicker {
        color: var(--lex-color-success-700, #286950);
        font-size: 0.67rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
      }
      .lex-app-loop-heading {
        margin: 5px 0 0;
        color: var(--lex-text-primary, #171b18);
        font-family: var(--lex-font-sans, system-ui, sans-serif);
        font-size: clamp(1.35rem, 2.4vw, 1.9rem); font-weight: 650; letter-spacing: -0.025em;
      }
      .lex-app-loop-grid {
        display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr);
        overflow: hidden;
        border: 1px solid var(--lex-border-subtle, #e1e5e1);
        border-radius: var(--lex-radius-lg, 16px);
        background: var(--lex-bg-primary, #fff);
      }
      .lex-app-loop-step {
        display: grid; grid-template-columns: 34px minmax(0, 1fr) 20px; gap: 14px; align-items: start;
        min-height: 124px; padding: 22px;
        border: 0; border-right: 1px solid var(--lex-border-subtle, #e1e5e1);
        background: var(--lex-bg-primary, #fff); color: var(--lex-text-primary, #171b18);
        font: inherit; text-align: left; cursor: pointer;
        transition: background 160ms ease;
      }
      .lex-app-loop-step:last-child { border-right: 0; }
      .lex-app-loop-step:hover, .lex-app-loop-step:focus-visible { background: var(--lex-color-success-50, #f3f9f6); }
      .lex-app-loop-number { color: var(--lex-color-success-700, #286950); font-size: 0.68rem; font-weight: 700; }
      .lex-app-loop-step strong, .lex-app-loop-step div span { display: block; }
      .lex-app-loop-step strong { font-size: 0.83rem; }
      .lex-app-loop-step div span { margin-top: 7px; color: var(--lex-text-secondary, #616861); font-size: 0.73rem; line-height: 1.55; }
      .lex-app-loop-arrow { color: var(--lex-text-tertiary, #89908a); transition: transform 160ms ease; }
      .lex-app-loop-step:hover .lex-app-loop-arrow { transform: translateX(3px); }
      @media (prefers-reduced-motion: reduce) { .lex-app-loop-step, .lex-app-loop-arrow { transition: none; } }
      @container (max-width: 640px) {
        .lex-app-loop-grid { grid-auto-flow: row; }
        .lex-app-loop-step { border-right: 0; border-bottom: 1px solid var(--lex-border-subtle, #e1e5e1); min-height: 0; }
        .lex-app-loop-step:last-child { border-bottom: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function parseSteps(value) {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  class LexAppLoop extends LexElement {
    static get properties() {
      return {
        kicker:  { type: String, default: '' },
        heading: { type: String, default: '' },
        steps:   { type: String, default: '[]' }
      };
    }

    render() {
      injectStyles();
      const steps = parseSteps(this.steps).filter((s) => s && s.title).slice(0, 4);
      const headingId = `lex-app-loop-${this._uid || (this._uid = Math.random().toString(36).slice(2, 9))}`;
      return `
        <section class="lex-app-loop" aria-labelledby="${headingId}">
          <div>
            <span class="lex-app-loop-kicker">${this.escapeHtml(this.kicker)}</span>
            <h2 class="lex-app-loop-heading" id="${headingId}">${this.escapeHtml(this.heading)}</h2>
          </div>
          <div class="lex-app-loop-grid">
            ${steps.map((step, index) => `
              <button type="button" class="lex-app-loop-step" data-value="${this.escapeHtml(String(step.value || ''))}">
                <span class="lex-app-loop-number">${String(index + 1).padStart(2, '0')}</span>
                <div><strong>${this.escapeHtml(step.title)}</strong><span>${this.escapeHtml(step.text || '')}</span></div>
                <span class="lex-app-loop-arrow" aria-hidden="true">→</span>
              </button>`).join('')}
          </div>
        </section>`;
    }

    updated() {
      this.querySelectorAll('.lex-app-loop-step').forEach((button) => {
        const onClick = () => this.emit('lex-app-loop-select', { value: button.dataset.value });
        button.addEventListener('click', onClick);
        this._eventCleanups.push(() => button.removeEventListener('click', onClick));
      });
    }
  }

  defineLex('lex-app-loop', LexAppLoop);
})();

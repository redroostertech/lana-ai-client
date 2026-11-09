/* Lex UI: Walkthrough
   A first-run tour over the whole window, one page at a time, with LANA's motion:
   each page pushes in (from the right going on, from the left going back), and its
   picture, eyebrow, headline and text arrive in a staggered fade and rise.

   Usage:
     const tour = document.createElement('lex-walkthrough');
     tour.brand = 'BRIEFS.';
     tour.pages = [{
       id: 'welcome',
       eyebrow: 'Welcome to Briefs',
       title: 'Your meetings, ', accent: 'kept close', trailing: '.',
       detail: 'Record on your phone. Read the notes here.',
       illustration: '<lex-brand-mark animation="idle" size="160"></lex-brand-mark>',
       actions: [{ id: 'pair', label: 'Pair a phone', icon: 'smartphone', variant: 'primary' }]
     }, ...];
     tour.addEventListener('lex-walkthrough-done', (e) => e.detail.action);  // null, 'skip' or an action id
     document.body.appendChild(tour);

   Keys: Right arrow or Return goes on, Left arrow goes back, Escape skips.
   illustration is trusted HTML from the page (never user content); every other field is text.

   A page that asks something (first launch):
     content: trusted HTML under the text that people use (choices, progress); unlike the
       picture it is read out by screen readers. The page fills it after each
       lex-walkthrough-page event ({ id, index }).
     nextLabel: the Next (or Finish) button's words; nextVariant its lex-btn variant (a last
       page that is the only way on can use 'primary'). back: false hides Back.
     next: false hides Next (the page's own content button moves on, calling tour.next()).
     tour.skippable = false: no Skip button and Escape does nothing.
     tour.keyboardNav = false: arrows and Return do not move; only buttons do.
     lex-walkthrough-next ({ id, index }) is cancelable: preventDefault() stays on the page,
       for example while something is saved; set tour.page to move on after it.
   Parts of an illustration can use lex-entrance with lex-entrance-step-N (css/lex-motion.css).
   Needs css/lex-motion.css. --lex-walkthrough-accent colors the dots and the headline accent.
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  function icon(name) {
    const Icons = window.Lex && window.Lex.Icons;
    return Icons && Icons.has(name) ? String(Icons[name].small) : '';
  }

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected || document.getElementById('lex-walkthrough-styles')) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'lex-walkthrough-styles';
    style.textContent = `
      lex-walkthrough {
        --lex-walkthrough-accent: var(--lex-color-brand-500);
        position: fixed;
        inset: 0;
        z-index: var(--lex-z-modal, 1000);
        display: block;
      }
      .lex-walkthrough {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
        padding: 32px;
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        outline: none;
        overflow: auto;
      }
      .lex-walkthrough-header,
      .lex-walkthrough-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
      }
      .lex-walkthrough-footer { max-width: 720px; }
      .lex-walkthrough-brand {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.2em;
      }
      .lex-walkthrough-brand svg { display: block; }
      .lex-walkthrough-stage {
        flex: 1;
        display: flex;
        align-items: center;
        width: 100%;
        max-width: 720px;
        overflow: hidden;
        padding: 24px 0;
      }
      .lex-walkthrough-page {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 32px;
      }
      .lex-walkthrough-illustration {
        min-height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .lex-walkthrough-copy {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        text-align: center;
      }
      .lex-walkthrough-eyebrow {
        margin: 0;
        color: var(--lex-text-secondary);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .lex-walkthrough-headline {
        margin: 0;
        font-size: 40px;
        font-weight: 300;
        line-height: 1.22;
      }
      .lex-walkthrough-headline em {
        color: var(--lex-walkthrough-accent);
        font-family: var(--lex-font-serif);
        font-style: italic;
        font-weight: 400;
      }
      .lex-walkthrough-detail {
        max-width: 520px;
        margin: 0;
        color: var(--lex-text-secondary);
        font-size: 17px;
        line-height: 1.4;
      }
      .lex-walkthrough-content {
        width: 100%;
        max-width: 560px;
        text-align: left;
      }
      .lex-walkthrough-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }
      .lex-walkthrough-dots {
        display: inline-flex;
        gap: 8px;
        align-items: center;
      }
      .lex-walkthrough-dot {
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: var(--lex-border-default);
        transition: width var(--lex-duration-snappy-spring, 240ms) var(--lex-ease-snappy-spring, ease-out), background-color 150ms ease-out;
      }
      .lex-walkthrough-dot.is-current {
        width: 24px;
        background: var(--lex-walkthrough-accent);
      }
      .lex-walkthrough-footer .is-hidden { visibility: hidden; }
      @media (max-width: 560px) {
        .lex-walkthrough { padding: 16px; }
        .lex-walkthrough-headline { font-size: 30px; }
      }
    `;
    document.head.appendChild(style);
  }

  class LexWalkthrough extends LexElement {
    static get properties() {
      return {
        pages: { type: Array, default: [], attribute: false },
        brand: { type: String, default: '' },
        page:  { type: Number, default: 0 },
        // false: no Skip button and Escape does nothing (a tour that must be finished).
        skippable: { type: Boolean, default: true },
        // false: arrows and Return do not move; only the buttons do.
        keyboardNav: { type: Boolean, default: true }
      };
    }

    connected() {
      this._returnFocus = document.activeElement;
      requestAnimationFrame(() => {
        const root = this.querySelector('.lex-walkthrough');
        if (root) root.focus({ preventScroll: true });
      });
    }

    render() {
      injectStyles();
      const pages = Array.isArray(this.pages) ? this.pages : [];
      if (pages.length === 0) return '';
      const index = Math.min(Math.max(0, this.page), pages.length - 1);
      const current = pages[index];
      const isFirst = index === 0;
      const isLast = index === pages.length - 1;
      const noBack = isFirst || current.back === false;
      const esc = (text) => this.escapeHtml(String(text == null ? '' : text));
      // Staggered by step (lex-entrance-step-N in lex-motion.css: N x 80 ms).
      const enter = (step, html, cls = '') => `<div class="lex-entrance lex-entrance-step-${step} ${cls}">${html}</div>`;
      const actions = Array.isArray(current.actions) && current.actions.length > 0
        ? enter(current.content ? 5 : 4, current.actions.map((action) => `<lex-btn variant="${esc(action.variant || 'secondary')}" ${action.icon ? `leading-icon="${esc(action.icon)}"` : ''} data-walkthrough-action="${esc(action.id)}">${esc(action.label)}</lex-btn>`).join(''), 'lex-walkthrough-actions')
        : '';
      const mark = '<svg width="32" height="32" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"><path d="M25,43 L25,25 L43,25"/><path d="M75,57 L75,75 L57,75"/></g></svg>';
      return `
        <div class="lex-walkthrough" tabindex="-1" role="dialog" aria-modal="true" aria-label="${esc(pages[0].eyebrow || 'Walkthrough')}">
          <header class="lex-walkthrough-header">
            <span class="lex-walkthrough-brand">${mark}${esc(this.brand)}</span>
            ${isLast || this.skippable === false ? '<span></span>' : '<lex-btn variant="ghost" size="sm" data-walkthrough="skip" title="Closes the walkthrough">Skip</lex-btn>'}
          </header>
          <div class="lex-walkthrough-stage">
            <section class="lex-walkthrough-page ${this._movedBack ? 'lex-push-back' : 'lex-push'}" aria-live="polite">
              <div class="lex-walkthrough-illustration" aria-hidden="true">${current.illustration || ''}</div>
              <div class="lex-walkthrough-copy">
                ${enter(1, `<p class="lex-walkthrough-eyebrow">${esc(current.eyebrow)}</p>`)}
                ${enter(2, `<h1 class="lex-walkthrough-headline">${esc(current.title)}${current.accent ? `<em>${esc(current.accent)}</em>` : ''}${esc(current.trailing == null ? '.' : current.trailing)}</h1>`)}
                ${enter(3, `<p class="lex-walkthrough-detail">${esc(current.detail)}</p>`)}
              </div>
              ${current.content ? enter(4, current.content, 'lex-walkthrough-content') : ''}
              ${actions}
            </section>
          </div>
          <footer class="lex-walkthrough-footer">
            <lex-btn variant="secondary" size="sm" leading-icon="chevron-left" data-walkthrough="back" class="${noBack ? 'is-hidden' : ''}" ${noBack ? 'disabled' : ''}>Back</lex-btn>
            <span class="lex-walkthrough-dots" role="img" aria-label="Page ${index + 1} of ${pages.length}">${pages.map((_, i) => `<span class="lex-walkthrough-dot${i === index ? ' is-current' : ''}"></span>`).join('')}</span>
            <lex-btn variant="${esc(current.nextVariant || (isLast ? 'secondary' : 'primary'))}" size="sm" data-walkthrough="next" class="${current.next === false ? 'is-hidden' : ''}" ${current.next === false ? 'disabled' : ''}>${current.nextLabel ? esc(current.nextLabel) : (isLast ? 'Finish' : 'Next')}</lex-btn>
          </footer>
        </div>`;
    }

    updated() {
      this.delegate('click', '[data-walkthrough="next"]', () => this.next());
      this.delegate('click', '[data-walkthrough="back"]', () => this.back());
      this.delegate('click', '[data-walkthrough="skip"]', () => this.finish('skip'));
      this.delegate('click', '[data-walkthrough-action]', (event, target) => this.finish(target.dataset.walkthroughAction));
      this.delegate('keydown', '.lex-walkthrough', (event) => {
        if (event.target !== this.querySelector('.lex-walkthrough')) return;
        const keys = this.keyboardNav !== false;
        if (keys && (event.key === 'ArrowRight' || event.key === 'Enter')) { event.preventDefault(); this.next(); }
        else if (keys && event.key === 'ArrowLeft') { event.preventDefault(); this.back(); }
        else if (event.key === 'Escape' && this.skippable !== false) { event.preventDefault(); event.stopPropagation(); this.finish('skip'); }
      });
      const root = this.querySelector('.lex-walkthrough');
      if (root && this.isConnected && this.contains(document.activeElement) === false && this._shown) root.focus({ preventScroll: true });
      this._shown = true;
      const pages = this.pages || [];
      const index = Math.min(Math.max(0, this.page), pages.length - 1);
      if (pages[index]) this.emit('lex-walkthrough-page', { id: pages[index].id, index });
    }

    next() {
      const pages = this.pages || [];
      const last = pages.length - 1;
      const current = pages[this.page];
      const going = new CustomEvent('lex-walkthrough-next', { bubbles: true, cancelable: true, detail: { id: current && current.id, index: this.page } });
      if (!this.dispatchEvent(going)) return;
      if (this.page >= last) return this.finish(null);
      this._movedBack = false;
      this.page = this.page + 1;
    }

    back() {
      const current = (this.pages || [])[this.page];
      if (this.page <= 0 || (current && current.back === false)) return;
      this._movedBack = true;
      this.page = this.page - 1;
    }

    /** Ends the tour: null (Finish), 'skip', or an action id. Removes itself. */
    finish(action) {
      if (this._finished) return;
      this._finished = true;
      this.emit('lex-walkthrough-done', { action });
      const back = this._returnFocus;
      this.remove();
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus({ preventScroll: true });
    }
  }

  defineLex('lex-walkthrough', LexWalkthrough);
})();

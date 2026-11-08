/* Lex UI: Brand Mark
   Plays a LANA brand animation, built from the two-bracket mark.

   Usage:
     <lex-brand-mark animation="idle" size="160"></lex-brand-mark>
     <lex-brand-mark animation="success" size="96" label="Done"></lex-brand-mark>

   Animations: idle (breathes; empty states), sync (phone and computer brackets meet
   and lock; sending), success (brackets snap shut, a check draws in, then holds),
   spinner (loading), and the app banners' orbit (Agents), flow (Automate) and chart
   (Insights). The dark variant plays inside [data-lex-theme="dark"], or always with
   variant="dark" (a dark panel on a light page); variant="light" forces light.
   With Reduce Motion nothing moves: looping animations show their first frame and
   success its finished state. Without a label the mark is decorative (aria-hidden).
   Event: lex-brand-mark-finished (success, once it holds).
   Needs: js/vendor/lottie_light.min.js and js/lex/brand/lex-brand-animations.js.
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;
  const LOOPS = { idle: true, sync: true, spinner: true, success: false, orbit: true, flow: true, chart: true, connect: true, grid: true };

  class LexBrandMark extends LexElement {
    static get properties() {
      return {
        animation: { type: String, default: 'idle' },
        size:      { type: Number, default: 72 },
        label:     { type: String, default: '' },
        variant:   { type: String, default: 'auto' }
      };
    }

    render() {
      const side = Math.max(8, Number(this.size) || 72);
      const a11y = this.label ? `role="img" aria-label="${this.escapeHtml(this.label)}"` : 'aria-hidden="true"';
      return `<span class="lex-brand-mark" ${a11y} data-side="${side}"></span>`;
    }

    updated() {
      const host = this.querySelector('.lex-brand-mark');
      if (!host) return;
      const side = Number(host.dataset.side);
      host.style.setProperty('--lex-brand-mark-size', `${side}px`);
      this._play(host);
    }

    disconnected() {
      this._stop();
    }

    _stop() {
      if (this._item) this._item.destroy();
      this._item = null;
    }

    _play(host) {
      this._stop();
      const files = window.LexBrandAnimations && window.LexBrandAnimations[this.animation];
      const lottie = window.lottie || window.bodymovin;
      if (!files || !lottie) return;
      const dark = this.variant === 'dark'
        || (this.variant !== 'light' && Boolean(this.closest('[data-lex-theme="dark"]')));
      const loops = LOOPS[this.animation] !== false;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const item = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: loops,
        autoplay: !reduce,
        animationData: JSON.parse(JSON.stringify(dark ? files.dark : files.light)),
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false }
      });
      this._item = item;
      if (reduce) {
        item.addEventListener('DOMLoaded', () => {
          item.goToAndStop(loops ? 0 : item.totalFrames - 1, true);
          if (!loops) this.emit('lex-brand-mark-finished');
        });
      } else if (!loops) {
        item.addEventListener('complete', () => this.emit('lex-brand-mark-finished'));
      }
    }
  }

  // Size comes from a custom property set in updated(); the rule lives here so the
  // component works on any page that loads it.
  if (!document.getElementById('lex-brand-mark-styles')) {
    const style = document.createElement('style');
    style.id = 'lex-brand-mark-styles';
    style.textContent = 'lex-brand-mark{display:inline-flex}.lex-brand-mark{display:inline-block;width:var(--lex-brand-mark-size,72px);height:var(--lex-brand-mark-size,72px)}.lex-brand-mark svg{display:block}';
    document.head.appendChild(style);
  }

  defineLex('lex-brand-mark', LexBrandMark);
})();

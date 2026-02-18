/* Lex UI — Loader Component
   Full-screen branded loading experience with animated corners,
   letter-by-letter reveal, breathing ripples, and progress bar.

   Imperative Usage:
     Lex.Loader.show('dark');    // Dark theme
     Lex.Loader.show('light');   // Light theme
     Lex.Loader.hide();          // Fade out and remove

   Click the overlay to dismiss (default behavior).
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  const BRAND_NAME = 'LANA';

  // Singleton reference
  let overlay = null;
  let stylesInjected = false;

  // -----------------------------------------------------------------------
  // Inject keyframe styles once into <head>
  // -----------------------------------------------------------------------

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-loader-styles';
    style.textContent = `
      /* ── Loader overlay ─────────────────────────────────── */

      #lex-loader-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--lex-z-loader, 9999);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
        cursor: pointer;
        overflow: hidden;
        --animation-timing: cubic-bezier(0.65, 0, 0.35, 1);
        --text-timing: cubic-bezier(0.22, 1, 0.36, 1);
      }
      #lex-loader-overlay.lex-loader-visible {
        opacity: 1;
      }

      /* ── Theme: dark ────────────────────────────────────── */

      #lex-loader-overlay.lex-loader-dark {
        background-color: var(--lex-color-gray-900);
        --loader-text-color: var(--lex-color-white);
        --loader-ripple-color: rgba(255, 255, 255, 0.06);
        --loader-progress-bg: rgba(255, 255, 255, 0.1);
      }

      /* ── Theme: light ───────────────────────────────────── */

      #lex-loader-overlay.lex-loader-light {
        background-color: var(--lex-color-white);
        --loader-text-color: var(--lex-color-gray-900);
        --loader-ripple-color: rgba(0, 0, 0, 0.05);
        --loader-progress-bg: rgba(0, 0, 0, 0.1);
      }

      /* ── Breathing ripples ──────────────────────────────── */

      .lex-loader-ripple-container {
        position: absolute;
        inset: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        pointer-events: none;
      }

      .lex-loader-ripple {
        position: absolute;
        border: 1px solid var(--loader-ripple-color);
        border-radius: 50%;
        opacity: 0;
        animation: lex-loader-rippleMove 4s ease-in-out infinite;
      }

      @keyframes lex-loader-rippleMove {
        0%   { transform: scale(0.8); opacity: 0; }
        50%  { opacity: 1; }
        100% { transform: scale(1.2); opacity: 0; }
      }

      /* ── Logo wrapper ───────────────────────────────────── */

      .lex-loader-logo-wrapper {
        position: relative;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 30px 40px;
        z-index: 10;
      }

      /* ── Corner brackets ────────────────────────────────── */

      .lex-loader-corner {
        position: absolute;
        width: clamp(30px, 8vw, 50px);
        height: clamp(30px, 8vw, 50px);
        fill: none;
        stroke: var(--loader-text-color);
        stroke-width: 1.5;
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
      }

      .lex-loader-corner-tl {
        top: 0;
        left: 0;
        animation: lex-loader-drawSlideTL 1.4s var(--animation-timing) forwards;
      }

      .lex-loader-corner-br {
        bottom: 0;
        right: 0;
        animation: lex-loader-drawSlideBR 1.4s var(--animation-timing) forwards;
      }

      @keyframes lex-loader-drawSlideTL {
        0%   { opacity: 0; transform: translate(-20px, -20px); stroke-dashoffset: 100; }
        100% { opacity: 1; transform: translate(0, 0); stroke-dashoffset: 0; }
      }

      @keyframes lex-loader-drawSlideBR {
        0%   { opacity: 0; transform: translate(20px, 20px); stroke-dashoffset: 100; }
        100% { opacity: 1; transform: translate(0, 0); stroke-dashoffset: 0; }
      }

      /* ── Logo text ──────────────────────────────────────── */

      .lex-loader-logo-text {
        display: flex;
        font-family: var(--lex-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        font-size: clamp(24px, 5vw, 42px);
        font-weight: 200;
        letter-spacing: 0.6em;
        padding-left: 0.6em;
        color: var(--loader-text-color);
        white-space: nowrap;
      }

      .lex-loader-letter {
        display: inline-block;
        opacity: 0;
        transform: translateY(10px);
        filter: blur(8px);
        animation: lex-loader-revealLetter 1s var(--text-timing) forwards;
      }

      @keyframes lex-loader-revealLetter {
        to { opacity: 1; transform: translateY(0); filter: blur(0); }
      }

      /* ── Progress bar ───────────────────────────────────── */

      .lex-loader-progress-track {
        margin-top: 40px;
        width: 100px;
        height: 1px;
        background-color: var(--loader-progress-bg);
        overflow: hidden;
        position: relative;
        z-index: 10;
      }

      .lex-loader-progress-fill {
        position: absolute;
        height: 100%;
        width: 100%;
        background-color: var(--loader-text-color);
        animation: lex-loader-progressFill 3s ease-in-out infinite;
      }

      @keyframes lex-loader-progressFill {
        0%        { transform: translateX(-100%); }
        50%, 100% { transform: translateX(100%); }
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // Build the overlay DOM
  // -----------------------------------------------------------------------

  function buildOverlay(theme) {
    const el = document.createElement('div');
    el.id = 'lex-loader-overlay';
    el.className = `lex-loader-${theme}`;

    // Build ripples
    const rippleSizes = [250, 450, 650];
    const ripplesHTML = rippleSizes.map((size, i) =>
      `<div class="lex-loader-ripple" style="width:${size}px;height:${size}px;animation-delay:${i * 0.8}s;"></div>`
    ).join('');

    // Build letters with staggered delay
    const lettersHTML = BRAND_NAME.split('').map((char, i) =>
      `<span class="lex-loader-letter" style="animation-delay:${0.5 + (i * 0.1)}s;">${char}</span>`
    ).join('');

    el.innerHTML = `
      <div class="lex-loader-ripple-container">
        ${ripplesHTML}
      </div>

      <div class="lex-loader-logo-wrapper">
        <svg class="lex-loader-corner lex-loader-corner-tl" viewBox="0 0 50 50"><path d="M 1 50 V 1 H 50" /></svg>
        <div class="lex-loader-logo-text">${lettersHTML}</div>
        <svg class="lex-loader-corner lex-loader-corner-br" viewBox="0 0 50 50"><path d="M 0 49 H 49 V 0" /></svg>
      </div>

      <div class="lex-loader-progress-track">
        <div class="lex-loader-progress-fill"></div>
      </div>
    `;

    // Click to dismiss
    el.addEventListener('click', () => LexLoader.hide());

    return el;
  }

  // -----------------------------------------------------------------------
  // LexLoader component
  // -----------------------------------------------------------------------

  class LexLoader extends LexElement {
    static get properties() {
      return {
        theme: { type: String, default: 'dark' }
      };
    }

    connected() {
      if (this.theme) {
        LexLoader.show(this.theme);
      }
    }

    render() { return ''; }

    // --- Static API ---

    static show(theme = 'dark') {
      injectStyles();

      // Remove existing if present
      if (overlay) {
        overlay.remove();
        overlay = null;
      }

      overlay = buildOverlay(theme);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      // Trigger fade-in on next frame
      requestAnimationFrame(() => {
        overlay.classList.add('lex-loader-visible');
      });

      return overlay;
    }

    static hide() {
      if (!overlay) return;

      overlay.classList.remove('lex-loader-visible');

      // Wait for fade-out transition, then remove
      setTimeout(() => {
        if (overlay) {
          overlay.remove();
          overlay = null;
        }
        document.body.style.overflow = '';
      }, 300);
    }
  }

  defineLex('lex-loader', LexLoader);

  // Expose static API globally
  window.Lex.Loader = LexLoader;
})();

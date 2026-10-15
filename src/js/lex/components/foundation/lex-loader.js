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

  const { LexElement, defineLex, ScrollLock } = window.Lex;

  const BRAND_NAME = 'LANA';

  // LANA One (window.lanaBrand from the preload, src/js/brand/lana-brand.js)
  // shows its mark: top-left bracket, bottom-right bracket, the 1.
  const IS_LANA_ONE = !!(window.lanaBrand && window.lanaBrand.flavor === 'lana-one');
  const MARK_VIEWBOX = '358 382 539 539';
  const MARK_TL = 'M358,384 L731,384 L731,474 L450,474 L450,767 L358,767Z';
  const MARK_BR = 'M897,919 L524,919 L524,829 L805,829 L805,536 L897,536Z';
  const MARK_ONE = 'M550,578 L624,537 L661,537 L661,780 L602,780 L602,600 L550,627Z';

  // Singleton reference
  let overlay = null;
  let hideTimer = null;
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
        pointer-events: none;
        transition: opacity 0.3s ease;
        cursor: pointer;
        overflow: hidden;
        --animation-timing: cubic-bezier(0.65, 0, 0.35, 1);
        --text-timing: cubic-bezier(0.22, 1, 0.36, 1);
      }
      #lex-loader-overlay.lex-loader-visible {
        opacity: 1;
        pointer-events: auto;
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

      /* ── LANA One mark (flavor "lana-one", see lana-brand.js) ── */
      /* The two brackets slide in from opposite corners, then the 1 appears.
         Units inside the SVG are its own (viewBox 539 wide), so 110 there is
         about 20px on screen. Ink follows the theme via --loader-text-color. */

      .lex-loader-logo-wrapper-mark { padding: 0; }

      .lex-loader-mark {
        display: block;
        width: clamp(72px, 14vw, 112px);
        height: clamp(72px, 14vw, 112px);
        fill: var(--loader-text-color);
        overflow: visible;
      }

      .lex-loader-mark-tl {
        opacity: 0;
        animation: lex-loader-markSlideTL 1.4s var(--animation-timing) forwards;
      }

      .lex-loader-mark-br {
        opacity: 0;
        animation: lex-loader-markSlideBR 1.4s var(--animation-timing) forwards;
      }

      .lex-loader-mark-one {
        opacity: 0;
        animation: lex-loader-markRevealOne 1s var(--text-timing) 0.6s forwards;
      }

      @keyframes lex-loader-markSlideTL {
        0%   { opacity: 0; transform: translate(-110px, -110px); }
        100% { opacity: 1; transform: translate(0, 0); }
      }

      @keyframes lex-loader-markSlideBR {
        0%   { opacity: 0; transform: translate(110px, 110px); }
        100% { opacity: 1; transform: translate(0, 0); }
      }

      @keyframes lex-loader-markRevealOne {
        0%   { opacity: 0; transform: translateY(50px); filter: blur(40px); }
        100% { opacity: 1; transform: translateY(0); filter: blur(0); }
      }

      @media (prefers-reduced-motion: reduce) {
        .lex-loader-mark-tl,
        .lex-loader-mark-br,
        .lex-loader-mark-one {
          animation: none;
          opacity: 1;
        }
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
    // Accessibility: announce as a status region so screen readers read the label
    // when the overlay appears without interrupting the user's current task.
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Loading');

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

      <div class="lex-loader-logo-wrapper${IS_LANA_ONE ? ' lex-loader-logo-wrapper-mark' : ''}">
        ${IS_LANA_ONE ? `
        <svg class="lex-loader-mark" viewBox="${MARK_VIEWBOX}" aria-hidden="true" focusable="false">
          <path class="lex-loader-mark-tl" d="${MARK_TL}" />
          <path class="lex-loader-mark-br" d="${MARK_BR}" />
          <path class="lex-loader-mark-one" d="${MARK_ONE}" />
        </svg>` : `
        <svg class="lex-loader-corner lex-loader-corner-tl" viewBox="0 0 50 50"><path d="M 1 50 V 1 H 50" /></svg>
        <div class="lex-loader-logo-text">${lettersHTML}</div>
        <svg class="lex-loader-corner lex-loader-corner-br" viewBox="0 0 50 50"><path d="M 0 49 H 49 V 0" /></svg>`}
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
        theme: { type: String, default: 'light' }
      };
    }

    connected() {
      if (this.theme) {
        LexLoader.show(this.theme);
      }
    }

    render() { return ''; }

    // --- Static API ---

    static show(theme = 'light') {
      injectStyles();

      // Cancel pending hide timer to prevent race condition
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }

      // Remove existing if present (unlock its ScrollLock to avoid count leak)
      if (overlay) {
        overlay.remove();
        overlay = null;
        ScrollLock.unlock();
      }

      overlay = buildOverlay(theme);
      document.body.appendChild(overlay);
      ScrollLock.lock();

      // Trigger fade-in on next frame
      requestAnimationFrame(() => {
        if (overlay) overlay.classList.add('lex-loader-visible');
      });

      return overlay;
    }

    static hide() {
      if (!overlay) return;

      overlay.classList.remove('lex-loader-visible');

      // Wait for fade-out transition, then remove
      hideTimer = setTimeout(() => {
        if (overlay) {
          overlay.remove();
          overlay = null;
        }
        hideTimer = null;
        ScrollLock.unlock();
      }, 300);
    }
  }

  defineLex('lex-loader', LexLoader);

  // Expose static API globally
  window.Lex.Loader = LexLoader;
})();

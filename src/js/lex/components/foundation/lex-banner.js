/* Lex UI — Banner Component
   Hero section header with brand icon, status indicator, corner brackets,
   and an actions area. Designed for page headers, integration dashboards,
   and hero sections.

   Usage:
     <lex-banner
       heading="ActionStep Dashboard"
       subtitle="Legal case management integration // SYNC_STABLE"
       icon="A"
       status="connected">
       <lex-btn>Refresh Sync</lex-btn>
     </lex-banner>

   Properties:
     heading   — Main title text
     subtitle  — Secondary description
     icon      — Single letter or short text for the brand circle
     icon-src  — Image URL for the brand icon (overrides icon letter)
     status    — connected | warning | error | offline | none (default: none)
     variant   — dark (default) | light
     size      — default | compact
     corners   — Show decorative corner brackets (default: true)
     align     — left (default) | center

   Events:
     banner-action — emitted when an action button in the slot is clicked
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-banner-styles';
    style.textContent = `
      lex-banner {
        display: block;
      }

      /* ── Container ──────────────────────────────────── */

      .lex-banner {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--lex-card-padding);
        padding: var(--lex-card-padding) calc(var(--lex-card-padding) * 1.33);
        border-radius: 0 var(--lex-radius-lg) 0 var(--lex-radius-lg);
        transition: background var(--lex-transition-slow);
      }

      .lex-banner--compact {
        padding: calc(var(--lex-card-padding) * 0.67) var(--lex-card-padding);
      }

      .lex-banner--center {
        flex-direction: column;
        text-align: center;
      }

      .lex-banner--center .lex-banner-main {
        align-items: center;
      }

      /* ── Dark variant (default) ─────────────────────── */

      .lex-banner--dark {
        background: var(--lex-color-brand-950);
        color: var(--lex-color-brand-100);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .lex-banner--dark .lex-banner-heading {
        color: var(--lex-color-brand-50);
      }

      .lex-banner--dark .lex-banner-subtitle {
        color: var(--lex-color-brand-400);
      }

      .lex-banner--dark .lex-banner-icon {
        background: var(--lex-color-brand-800);
        color: var(--lex-color-brand-200);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .lex-banner--dark .lex-banner-corner path {
        stroke: rgba(255, 255, 255, 0.3);
      }

      .lex-banner--dark .lex-banner-orb-corner path {
        stroke: rgba(255, 255, 255, 0.35);
      }

      /* ── Light variant ──────────────────────────────── */

      .lex-banner--light {
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        border: 1px solid var(--lex-border-subtle);
      }

      .lex-banner--light .lex-banner-heading {
        color: var(--lex-text-primary);
      }

      .lex-banner--light .lex-banner-subtitle {
        color: var(--lex-text-secondary);
      }

      .lex-banner--light .lex-banner-icon {
        background: var(--lex-bg-accent-soft);
        color: var(--lex-text-accent);
        border: 1px solid var(--lex-border-default);
      }

      .lex-banner--light .lex-banner-corner path {
        stroke: var(--lex-color-gray-400);
      }

      .lex-banner--light .lex-banner-orb-corner path {
        stroke: var(--lex-color-gray-400);
      }

      /* ── Corner brackets ────────────────────────────── */

      .lex-banner-corner {
        position: absolute;
        width: var(--lex-icon-xLarge);
        height: var(--lex-icon-xLarge);
        fill: none;
        stroke-width: 1;
      }

      .lex-banner-corner--tl {
        top: -1px;
        left: -1px;
      }

      .lex-banner-corner--br {
        bottom: -1px;
        right: -1px;
      }

      /* ── Brand icon ─────────────────────────────────── */

      .lex-banner-icon {
        width: var(--lex-icon-xxLarge);
        height: var(--lex-icon-xxLarge);
        border-radius: var(--lex-radius-lg);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: var(--lex-weight-semibold);
        font-size: var(--lex-h4-size);
        letter-spacing: var(--lex-h4-tracking);
        flex-shrink: 0;
        transition: transform var(--lex-transition-slow);
      }

      .lex-banner:hover .lex-banner-icon {
        transform: scale(1.04);
      }

      .lex-banner--compact .lex-banner-icon {
        width: var(--lex-icon-xLarge);
        height: var(--lex-icon-xLarge);
        font-size: var(--lex-body-base-size);
      }

      .lex-banner-icon img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: inherit;
      }

      /* ── Main content area ──────────────────────────── */

      .lex-banner-main {
        display: flex;
        align-items: center;
        gap: var(--lex-card-padding);
        flex: 1;
        min-width: 0;
      }

      .lex-banner-text {
        min-width: 0;
      }

      .lex-banner-title-row {
        display: flex;
        align-items: center;
        gap: var(--lex-radius-xl);
        margin-bottom: 2px;
      }

      .lex-banner--center .lex-banner-title-row {
        justify-content: center;
      }

      .lex-banner-heading {
        font-size: var(--lex-h3-size);
        font-weight: var(--lex-h3-weight);
        letter-spacing: var(--lex-h3-tracking);
        line-height: var(--lex-h3-height);
      }

      .lex-banner--compact .lex-banner-heading {
        font-size: var(--lex-h4-size);
        font-weight: var(--lex-h4-weight);
        letter-spacing: var(--lex-h4-tracking);
        line-height: var(--lex-h4-height);
      }

      .lex-banner-subtitle {
        font-size: var(--lex-body-sm-size);
        font-weight: var(--lex-body-sm-weight);
        line-height: var(--lex-body-sm-height);
        letter-spacing: 0.02em;
      }

      /* ── Status orb ─────────────────────────────────── */

      .lex-banner-status {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: var(--lex-icon-medium);
        height: var(--lex-icon-medium);
        flex-shrink: 0;
      }

      .lex-banner-orb-corner {
        position: absolute;
        width: var(--lex-icon-medium);
        height: var(--lex-icon-medium);
        fill: none;
        stroke-width: 1;
      }

      .lex-banner-orb-corner--tl {
        top: 0;
        left: 0;
      }

      .lex-banner-orb-corner--br {
        bottom: 0;
        right: 0;
      }

      .lex-banner-orb {
        width: var(--lex-icon-xxSmall);
        height: var(--lex-icon-xxSmall);
        border-radius: var(--lex-radius-full);
        flex-shrink: 0;
      }

      .lex-banner-orb--connected { background: var(--lex-color-success-500); }
      .lex-banner-orb--warning   { background: var(--lex-color-warning-500); }
      .lex-banner-orb--error     { background: var(--lex-color-danger-500); }
      .lex-banner-orb--offline   { background: var(--lex-color-gray-400); }

      /* ── Actions area ───────────────────────────────── */

      .lex-banner-actions {
        display: flex;
        align-items: center;
        gap: var(--lex-radius-xl);
        flex-shrink: 0;
      }

      .lex-banner-actions slot-content {
        display: contents;
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // SVG fragments
  // -----------------------------------------------------------------------

  const CORNER_TL = '<svg class="lex-banner-corner lex-banner-corner--tl" viewBox="0 0 40 40"><path d="M 1 40 V 1 H 40" /></svg>';
  const CORNER_BR = '<svg class="lex-banner-corner lex-banner-corner--br" viewBox="0 0 40 40"><path d="M 0 39 H 39 V 0" /></svg>';
  const ORB_TL = '<svg class="lex-banner-orb-corner lex-banner-orb-corner--tl" viewBox="0 0 40 40"><path d="M 1 40 V 1 H 40" /></svg>';
  const ORB_BR = '<svg class="lex-banner-orb-corner lex-banner-orb-corner--br" viewBox="0 0 40 40"><path d="M 0 39 H 39 V 0" /></svg>';

  // -----------------------------------------------------------------------
  // LexBanner
  // -----------------------------------------------------------------------

  class LexBanner extends LexElement {
    static get properties() {
      return {
        heading:  { type: String, default: '' },
        subtitle: { type: String, default: '' },
        icon:     { type: String, default: '' },
        iconSrc:  { type: String, default: '' },
        status:   { type: String, default: 'none' },
        variant:  { type: String, default: 'dark' },
        size:     { type: String, default: 'default' },
        corners:  { type: Boolean, default: true },
        align:    { type: String, default: 'left' }
      };
    }

    render() {
      injectStyles();

      const isDark = this.variant !== 'light';
      const isCompact = this.size === 'compact';
      const isCenter = this.align === 'center';

      // Container classes
      const classes = [
        'lex-banner',
        isDark ? 'lex-banner--dark' : 'lex-banner--light',
        isCompact ? 'lex-banner--compact' : '',
        isCenter ? 'lex-banner--center' : ''
      ].filter(Boolean).join(' ');

      // Corner brackets
      const cornersHtml = this.corners ? `${CORNER_TL}${CORNER_BR}` : '';

      // Brand icon
      let iconHtml = '';
      if (this.iconSrc) {
        iconHtml = `<div class="lex-banner-icon"><img src="${this.escapeHtml(this.iconSrc)}" alt="" /></div>`;
      } else if (this.icon) {
        iconHtml = `<div class="lex-banner-icon">${this.escapeHtml(this.icon)}</div>`;
      }

      // Status orb
      let statusHtml = '';
      if (this.status && this.status !== 'none') {
        statusHtml = `
          <div class="lex-banner-status">
            ${ORB_TL}${ORB_BR}
            <div class="lex-banner-orb lex-banner-orb--${this.escapeHtml(this.status)}"></div>
          </div>
        `;
      }

      // Title row
      const titleRow = `
        <div class="lex-banner-title-row">
          <h1 class="lex-banner-heading">${this.escapeHtml(this.heading)}</h1>
          ${statusHtml}
        </div>
      `;

      // Subtitle
      const subtitleHtml = this.subtitle
        ? `<p class="lex-banner-subtitle">${this.escapeHtml(this.subtitle)}</p>`
        : '';

      return `
        <div class="${classes}">
          ${cornersHtml}
          <div class="lex-banner-main">
            ${iconHtml}
            <div class="lex-banner-text">
              ${titleRow}
              ${subtitleHtml}
            </div>
          </div>
          <div class="lex-banner-actions">
            <slot-content></slot-content>
          </div>
        </div>
      `;
    }
  }

  defineLex('lex-banner', LexBanner);
})();

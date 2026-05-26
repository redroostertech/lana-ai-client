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
     max-actions — Number of visible action elements before overflow menu (-1 = no overflow)

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
        position: relative;
      }

      .lex-banner-actions slot-content {
        display: contents;
      }

      .lex-banner-overflow {
        position: relative;
        display: inline-flex;
      }

      .lex-banner-overflow-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        flex: 0 0 36px;
        border: 0;
        border-radius: var(--lex-radius-lg);
        background: transparent;
        color: var(--lex-text-secondary);
        cursor: pointer;
        padding: 0;
        transition: background var(--lex-transition-fast), color var(--lex-transition-fast);
      }

      .lex-banner-overflow-toggle:hover {
        background: var(--lex-bg-hover);
        color: var(--lex-text-primary);
      }

      .lex-banner-overflow-toggle > svg {
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
      }

      .lex-banner-overflow-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 50;
        /* width sizes to the widest item, with a sensible floor and ceiling
           so a single short item still gives a clickable target and a very
           long label doesn't run off the screen. */
        width: max-content;
        min-width: 200px;
        max-width: 360px;
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-lg);
        background: var(--lex-bg-primary);
        box-shadow: var(--lex-shadow-lg);
        padding: 4px;
      }

      .lex-banner-overflow-menu[hidden] {
        display: none;
      }

      .lex-banner-overflow-menu button,
      .lex-banner-overflow-menu lex-btn {
        width: 100%;
      }

      /* Standard overflow row: a single visual shape used by every consumer.
         [icon?] [label] — icon is optional, but row height, padding, font,
         hover, and danger styling stay identical so an icon-less menu
         (matter-detail) and an icon-bearing menu (file-viewer) look like
         the same component across the app. */
      .lex-banner-overflow-menu button {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 36px;
        border: 0;
        border-radius: var(--lex-radius-md);
        background: transparent;
        color: var(--lex-text-primary);
        cursor: pointer;
        font: inherit;
        font-size: var(--lex-body-sm-size, 0.875rem);
        padding: 8px 12px;
        text-align: left;
        white-space: nowrap;
        justify-content: flex-start;
      }

      .lex-banner-overflow-menu button:hover {
        background: var(--lex-bg-hover);
      }

      .lex-banner-overflow-menu button > svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        color: var(--lex-text-secondary);
      }

      .lex-banner-overflow-menu button[data-variant="danger"] {
        color: var(--lex-status-danger-text, #B42318);
      }

      .lex-banner-overflow-menu button[data-variant="danger"] > svg {
        color: var(--lex-status-danger-text, #B42318);
      }

      .lex-banner-overflow-menu button[data-variant="danger"]:hover {
        background: var(--lex-status-danger-bg, #FEF3F2);
      }

      .lex-banner-overflow-menu hr {
        border: 0;
        border-top: 1px solid var(--lex-border-subtle, var(--lex-border-default));
        margin: 4px 6px;
      }

      /* ── Meta area (slot under subtitle) ─────────────── */

      .lex-banner-meta {
        margin-top: 8px;
      }

      .lex-banner-meta--empty {
        display: none;
      }

      .lex-banner-meta slot-content {
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
        align:    { type: String, default: 'left' },
        maxActions: { type: Number, default: -1 }
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
              <div class="lex-banner-meta">
                <slot-content data-slot="meta"></slot-content>
              </div>
            </div>
          </div>
          <div class="lex-banner-actions">
            <slot-content data-slot="actions"></slot-content>
          </div>
        </div>
      `;
    }

    updated() {
      this.delegate('click', '[data-lex-banner-overflow-toggle]', function (event, toggle) {
        event.stopPropagation();
        const menu = toggle.closest('.lex-banner-overflow')?.querySelector('.lex-banner-overflow-menu');
        if (!menu) return;
        const nextOpen = menu.hasAttribute('hidden');
        menu.toggleAttribute('hidden', !nextOpen);
        toggle.setAttribute('aria-expanded', String(nextOpen));
      });

      this.delegate('click', '.lex-banner-overflow-menu button, .lex-banner-overflow-menu lex-btn', function () {
        const menu = this.querySelector('.lex-banner-overflow-menu');
        const toggle = this.querySelector('[data-lex-banner-overflow-toggle]');
        if (menu) menu.setAttribute('hidden', '');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });

      this.listen(document, 'click', (event) => {
        if (this.contains(event.target)) return;
        const menu = this.querySelector('.lex-banner-overflow-menu');
        const toggle = this.querySelector('[data-lex-banner-overflow-toggle]');
        if (menu) menu.setAttribute('hidden', '');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    }

    // Split original children into meta vs actions slots based on data-banner-meta marker
    _restoreContent() {
      if (!this._originalChildren) return;
      const actionsSlot = this.querySelector('slot-content[data-slot="actions"]');
      const metaSlot = this.querySelector('slot-content[data-slot="meta"]');
      const metaWrap = this.querySelector('.lex-banner-meta');
      if (actionsSlot) actionsSlot.innerHTML = '';
      if (metaSlot) metaSlot.innerHTML = '';
      let hasMeta = false;
      const actionNodes = [];
      for (const node of this._originalChildren) {
        const isMeta = node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-banner-meta');
        if (isMeta) hasMeta = true;
        if (isMeta && metaSlot) {
          metaSlot.appendChild(node.cloneNode(true));
        } else if (node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim())) {
          actionNodes.push(node);
        }
      }
      const maxActions = Number(this.maxActions);
      if (actionsSlot && maxActions >= 0 && actionNodes.length > maxActions) {
        actionNodes.slice(0, maxActions).forEach(node => actionsSlot.appendChild(node.cloneNode(true)));
        const overflow = document.createElement('div');
        overflow.className = 'lex-banner-overflow';
        overflow.innerHTML = `
          <button type="button" class="lex-banner-overflow-toggle" data-lex-banner-overflow-toggle aria-label="More actions" aria-expanded="false">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>
            </svg>
          </button>
          <div class="lex-banner-overflow-menu" hidden></div>
        `;
        const menu = overflow.querySelector('.lex-banner-overflow-menu');
        actionNodes.slice(maxActions).forEach(node => menu.appendChild(node.cloneNode(true)));
        actionsSlot.appendChild(overflow);
      } else if (actionsSlot) {
        actionNodes.forEach(node => actionsSlot.appendChild(node.cloneNode(true)));
      }
      if (metaWrap) metaWrap.classList.toggle('lex-banner-meta--empty', !hasMeta);
    }
  }

  defineLex('lex-banner', LexBanner);
})();

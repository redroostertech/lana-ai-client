/* Lex UI — Drawer Component
   Sliding side panel for detail views, navigation menus, and forms.
   Slides in from the right (default) or left with overlay backdrop.

   Declarative Usage:
     <lex-drawer heading="Document Details" open="false" side="right">
       <p>Detail content here</p>
     </lex-drawer>

   Imperative Usage:
     Lex.Drawer.open({ heading: 'Details', content: '<div>...</div>', width: 'md' });
     Lex.Drawer.open({ heading: 'Menu', content: navHtml, side: 'left', width: 'sm' });

   Sides: left | right (default)
   Widths: sm (320px) | md (420px) | lg (560px) | xl (720px) | full
   Events: lex-close
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-drawer-styles';
    style.textContent = `
      lex-drawer {
        display: contents;
      }

      /* ── Overlay ─────────────────────────────────────── */

      .lex-drawer-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--lex-z-modal, 40);
        display: flex;
      }

      .lex-drawer-overlay--right {
        justify-content: flex-end;
      }

      .lex-drawer-overlay--left {
        justify-content: flex-start;
      }

      .lex-drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        animation: lex-drawer-fade-in 0.2s ease;
      }

      /* ── Panel ───────────────────────────────────────── */

      .lex-drawer-panel {
        position: relative;
        height: 100vh;
        height: 100dvh;
        display: flex;
        flex-direction: column;
        background: var(--lex-bg-primary);
        box-shadow: var(--lex-shadow-xl, 0 20px 60px rgba(0,0,0,0.15));
        overflow: hidden;
        will-change: transform;
      }

      /* Width variants */
      .lex-drawer-panel--sm   { width: 320px; max-width: 100%; }
      .lex-drawer-panel--md   { width: 420px; max-width: 100%; }
      .lex-drawer-panel--lg   { width: 560px; max-width: 100%; }
      .lex-drawer-panel--xl   { width: 720px; max-width: 100%; }
      .lex-drawer-panel--full { width: 100%; }

      /* Slide-in from right */
      .lex-drawer-overlay--right .lex-drawer-panel {
        border-left: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
        animation: lex-drawer-slide-in-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* Slide-in from left */
      .lex-drawer-overlay--left .lex-drawer-panel {
        border-right: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
        animation: lex-drawer-slide-in-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* ── Header ──────────────────────────────────────── */

      .lex-drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
        flex-shrink: 0;
      }

      .lex-drawer-title {
        font-size: var(--lex-body-base-size, 1rem);
        font-weight: var(--lex-weight-semibold, 600);
        color: var(--lex-text-primary);
        line-height: 1.4;
        margin: 0;
      }

      .lex-drawer-subtitle {
        font-size: var(--lex-body-xs-size, 0.75rem);
        color: var(--lex-text-tertiary);
        margin-top: 2px;
        font-weight: var(--lex-weight-regular, 400);
      }

      .lex-drawer-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--lex-text-tertiary);
        border-radius: var(--lex-input-radius);
        transition: background 0.15s ease, color 0.15s ease;
        flex-shrink: 0;
      }

      .lex-drawer-close:hover {
        background: var(--lex-bg-tertiary);
        color: var(--lex-text-primary);
      }

      .lex-drawer-close svg {
        width: 18px;
        height: 18px;
      }

      /* ── Body ────────────────────────────────────────── */

      .lex-drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }

      /* ── Footer ──────────────────────────────────────── */

      .lex-drawer-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px;
        border-top: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
        background: var(--lex-bg-secondary);
        flex-shrink: 0;
      }

      .lex-drawer-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 16px;
        font-family: inherit;
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-medium, 500);
        border: none;
        border-radius: var(--lex-btn-radius-md);
        cursor: pointer;
        transition: background 0.15s ease;
        outline: none;
      }

      .lex-drawer-btn:focus-visible {
        box-shadow: 0 0 0 2px var(--lex-bg-primary), 0 0 0 4px var(--lex-bg-accent);
      }

      .lex-drawer-btn--secondary {
        background: var(--lex-color-gray-200);
        color: var(--lex-text-primary);
      }

      .lex-drawer-btn--secondary:hover {
        background: var(--lex-color-gray-300);
      }

      .lex-drawer-btn--primary {
        background: var(--lex-bg-accent);
        color: var(--lex-text-on-accent);
      }

      .lex-drawer-btn--primary:hover {
        background: var(--lex-bg-accent-hover);
      }

      /* ── Animations ──────────────────────────────────── */

      @keyframes lex-drawer-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      @keyframes lex-drawer-slide-in-right {
        from { transform: translateX(100%); }
        to   { transform: translateX(0); }
      }

      @keyframes lex-drawer-slide-in-left {
        from { transform: translateX(-100%); }
        to   { transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  }

  const CLOSE_SVG = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';

  class LexDrawer extends LexElement {
    static get properties() {
      return {
        heading:    { type: String, default: '' },
        subtitle:   { type: String, default: '' },
        open:       { type: Boolean, default: false, reflect: true },
        side:       { type: String, default: 'right' },    // left | right
        width:      { type: String, default: 'md' },       // sm | md | lg | xl | full
        showFooter: { type: Boolean, default: false },
        confirmText: { type: String, default: 'Save' },
        cancelText:  { type: String, default: 'Cancel' },
        closeOnOverlay: { type: Boolean, default: true }
      };
    }

    connected() {
      // Prevent _restoreContent() from re-cloning children on subsequent
      // updates — preserves live DOM and event listeners bound by page scripts.
      this._originalChildren = null;
    }

    render() {
      injectStyles();

      // After first render, skip innerHTML to preserve live children.
      if (this._rendered) return null;
      this._rendered = true;

      const sideCls = this.side === 'left' ? 'lex-drawer-overlay--left' : 'lex-drawer-overlay--right';
      const widthCls = `lex-drawer-panel--${this.width || 'md'}`;

      // Always render full structure; starts hidden.
      let html = `<div class="lex-drawer-overlay ${sideCls}" style="display:none">`;
      html += `<div class="lex-drawer-backdrop" data-action="overlay"></div>`;
      html += `<div class="lex-drawer-panel ${widthCls}">`;

      // Header
      if (this.heading) {
        html += `<div class="lex-drawer-header">`;
        html += `<div>`;
        html += `<h3 class="lex-drawer-title">${this.escapeHtml(this.heading)}</h3>`;
        if (this.subtitle) {
          html += `<div class="lex-drawer-subtitle">${this.escapeHtml(this.subtitle)}</div>`;
        }
        html += `</div>`;
        html += `<button type="button" class="lex-drawer-close" data-action="close">${CLOSE_SVG}</button>`;
        html += `</div>`;
      }

      // Body
      html += `<div class="lex-drawer-body"><slot-content></slot-content></div>`;

      // Footer
      if (this.showFooter) {
        html += `<div class="lex-drawer-footer">`;
        if (this.cancelText) {
          html += `<button type="button" class="lex-drawer-btn lex-drawer-btn--secondary" data-action="cancel">${this.escapeHtml(this.cancelText)}</button>`;
        }
        html += `<button type="button" class="lex-drawer-btn lex-drawer-btn--primary" data-action="confirm">${this.escapeHtml(this.confirmText)}</button>`;
        html += `</div>`;
      }

      html += `</div></div>`;

      return html;
    }

    updated(changedProps) {
      // Toggle overlay visibility + body scroll lock
      const overlay = this.querySelector('.lex-drawer-overlay');
      if (overlay) {
        overlay.style.display = this.open ? '' : 'none';
      }

      // Sync heading/subtitle without re-render
      if (changedProps && changedProps.has('heading')) {
        const titleEl = this.querySelector('.lex-drawer-title');
        if (titleEl) titleEl.textContent = this.heading;
      }
      if (changedProps && changedProps.has('subtitle')) {
        const subEl = this.querySelector('.lex-drawer-subtitle');
        if (subEl) subEl.textContent = this.subtitle;
      }

      if (!this.open) {
        document.body.style.overflow = '';
        return;
      }
      document.body.style.overflow = 'hidden';

      this.delegate('click', '[data-action="close"]', () => {
        this.emit('lex-close');
        this.open = false;
      });

      this.delegate('click', '[data-action="cancel"]', () => {
        this.emit('lex-cancel');
        this.open = false;
      });

      this.delegate('click', '[data-action="confirm"]', () => {
        this.emit('lex-confirm');
      });

      if (this.closeOnOverlay) {
        this.delegate('click', '[data-action="overlay"]', () => {
          this.emit('lex-close');
          this.open = false;
        });
      }

      // ESC key
      const escHandler = (e) => {
        if (e.key === 'Escape' && this.open) {
          this.emit('lex-close');
          this.open = false;
        }
      };
      document.addEventListener('keydown', escHandler);
      this._eventCleanups.push(() => document.removeEventListener('keydown', escHandler));

      // Unlock body scroll on cleanup
      this._eventCleanups.push(() => {
        document.body.style.overflow = '';
      });
    }

    // --- Static API ---

    /**
     * Open a drawer imperatively.
     *   Lex.Drawer.open({ heading, subtitle, content, side, width, showFooter, ... })
     * Returns the drawer element.
     */
    static open(options = {}) {
      const drawer = document.createElement('lex-drawer');
      drawer.heading = options.heading || '';
      drawer.subtitle = options.subtitle || '';
      drawer.side = options.side || 'right';
      drawer.width = options.width || 'md';
      drawer.showFooter = options.showFooter || false;
      drawer.closeOnOverlay = options.closeOnOverlay !== undefined ? options.closeOnOverlay : true;

      if (options.showFooter) {
        drawer.confirmText = options.confirmText || 'Save';
        drawer.cancelText = options.cancelText || 'Cancel';
      }

      if (options.content) {
        drawer.innerHTML = options.content;
      }

      drawer.open = true;

      drawer.addEventListener('lex-close', () => drawer.remove());
      drawer.addEventListener('lex-cancel', () => drawer.remove());

      if (options.onConfirm) {
        drawer.addEventListener('lex-confirm', () => {
          options.onConfirm(drawer);
        });
      }

      if (options.onClose) {
        drawer.addEventListener('lex-close', () => options.onClose());
      }

      document.body.appendChild(drawer);
      return drawer;
    }
  }

  defineLex('lex-drawer', LexDrawer);

  // Expose static API globally
  window.Lex.Drawer = LexDrawer;
})();

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

  const { LexElement, defineLex, ScrollLock } = window.Lex;

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
        animation: lex-drawer-fade-in var(--lex-duration-fade, 200ms) var(--lex-ease-out, ease);
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
        animation: lex-drawer-slide-in-right var(--lex-duration-slide, 300ms) var(--lex-ease-out, ease);
      }

      /* Slide-in from left */
      .lex-drawer-overlay--left .lex-drawer-panel {
        border-right: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
        animation: lex-drawer-slide-in-left var(--lex-duration-slide, 300ms) var(--lex-ease-out, ease);
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
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

      /* ── Exit animations ─────────────────────────────── */

      @keyframes lex-drawer-fade-out {
        from { opacity: 1; }
        to   { opacity: 0; }
      }

      @keyframes lex-drawer-slide-out-right {
        from { transform: translateX(0); }
        to   { transform: translateX(100%); }
      }

      @keyframes lex-drawer-slide-out-left {
        from { transform: translateX(0); }
        to   { transform: translateX(-100%); }
      }

      .lex-drawer-backdrop--closing {
        animation: lex-drawer-fade-out var(--lex-duration-fade, 200ms) var(--lex-ease-in, ease) forwards;
      }

      .lex-drawer-overlay--right .lex-drawer-panel--closing {
        animation: lex-drawer-slide-out-right var(--lex-duration-slide, 300ms) var(--lex-ease-in, ease) forwards;
      }

      .lex-drawer-overlay--left .lex-drawer-panel--closing {
        animation: lex-drawer-slide-out-left var(--lex-duration-slide, 300ms) var(--lex-ease-in, ease) forwards;
      }
    `;
    document.head.appendChild(style);
  }

  const CLOSE_SVG = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';

  // Monotonically increasing counter to generate unique aria-labelledby IDs.
  let _drawerIdCounter = 0;

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

    constructor() {
      super();
      // Unique ID used for the aria-labelledby / title element pair.
      this._titleId = 'lex-drawer-title-' + (++_drawerIdCounter);
      // Element focused before the drawer opened — restored on close.
      this._previousFocus = null;
      // Cleanup function returned by FocusTrap.activate().
      this._focusTrapCleanup = null;
    }

    connected() {
      // Prevent _restoreContent() from re-cloning children on subsequent
      // updates — preserves live DOM and event listeners bound by page scripts.
      this._originalChildren = null;
      // Tracks whether this instance currently holds the ScrollLock.
      // Prevents double-unlock when the component re-renders while open.
      this._scrollLocked = false;
    }

    render() {
      injectStyles();

      // After first render, skip innerHTML to preserve live children.
      if (this._rendered) return null;
      this._rendered = true;

      const sideCls = this.side === 'left' ? 'lex-drawer-overlay--left' : 'lex-drawer-overlay--right';
      const widthCls = `lex-drawer-panel--${this.width || 'md'}`;

      // aria-labelledby points to the heading element when a heading is provided.
      const labelledBy = this.heading ? ` aria-labelledby="${this._titleId}"` : '';

      // Always render full structure; starts hidden.
      let html = `<div class="lex-drawer-overlay ${sideCls}" style="display:none">`;
      html += `<div class="lex-drawer-backdrop" data-action="overlay"></div>`;
      html += `<div class="lex-drawer-panel ${widthCls}" role="dialog" aria-modal="true"${labelledBy}>`;

      // Header
      if (this.heading) {
        html += `<div class="lex-drawer-header">`;
        html += `<div style="flex:1;min-width:0">`;
        html += `<h3 id="${this._titleId}" class="lex-drawer-title">${this.escapeHtml(this.heading)}</h3>`;
        html += `<div class="lex-drawer-subtitle"${this.subtitle ? '' : ' style="display:none"'}>${this.subtitle ? this.escapeHtml(this.subtitle) : ''}</div>`;
        html += `</div>`;
        html += `<div class="lex-drawer-header-actions" style="display:flex;align-items:center;gap:4px"></div>`;
        html += `<button type="button" class="lex-drawer-close" data-action="close" aria-label="Close drawer">${CLOSE_SVG}</button>`;
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
      const overlay = this.querySelector('.lex-drawer-overlay');

      // Sync heading/subtitle without re-render.
      // Also keep aria-labelledby on the panel in sync when heading changes.
      if (changedProps && changedProps.has('heading')) {
        const titleEl = this.querySelector('.lex-drawer-title');
        if (titleEl) titleEl.textContent = this.heading;
        const panel = this.querySelector('.lex-drawer-panel');
        if (panel) {
          if (this.heading) {
            panel.setAttribute('aria-labelledby', this._titleId);
          } else {
            panel.removeAttribute('aria-labelledby');
          }
        }
      }
      if (changedProps && changedProps.has('subtitle')) {
        const subEl = this.querySelector('.lex-drawer-subtitle');
        if (subEl) {
          subEl.textContent = this.subtitle;
          subEl.style.display = this.subtitle ? '' : 'none';
        }
      }

      if (!this.open) {
        // Deactivate focus trap and restore previously focused element.
        if (this._focusTrapCleanup) {
          this._focusTrapCleanup();
          this._focusTrapCleanup = null;
        }
        if (this._previousFocus && typeof this._previousFocus.focus === 'function') {
          this._previousFocus.focus();
          this._previousFocus = null;
        }

        // Play exit animation, then hide
        if (overlay && overlay.style.display !== 'none') {
          const panel = this.querySelector('.lex-drawer-panel');
          const backdrop = this.querySelector('.lex-drawer-backdrop');
          if (panel && !panel.classList.contains('lex-drawer-panel--closing')) {
            panel.classList.add('lex-drawer-panel--closing');
            if (backdrop) backdrop.classList.add('lex-drawer-backdrop--closing');
            const onEnd = () => {
              panel.removeEventListener('animationend', onEnd);
              overlay.style.display = 'none';
              panel.classList.remove('lex-drawer-panel--closing');
              if (backdrop) backdrop.classList.remove('lex-drawer-backdrop--closing');
              if (this._scrollLocked) {
                ScrollLock.unlock();
                this._scrollLocked = false;
              }
            };
            panel.addEventListener('animationend', onEnd);
            this._animEndCleanup = () => {
              panel.removeEventListener('animationend', onEnd);
              if (this._scrollLocked) {
                ScrollLock.unlock();
                this._scrollLocked = false;
              }
            };
          }
        } else {
          if (this._scrollLocked) {
            ScrollLock.unlock();
            this._scrollLocked = false;
          }
        }
        return;
      }

      // Opening — store previous focus, show overlay, lock scroll, activate trap.
      this._previousFocus = document.activeElement;
      if (overlay) overlay.style.display = '';
      if (!this._scrollLocked) {
        ScrollLock.lock();
        this._scrollLocked = true;
      }

      // Activate focus trap and move initial focus to first focusable element.
      const panel = this.querySelector('.lex-drawer-panel');
      if (panel) {
        const focusable = window.Lex.FocusTrap.getFocusable(panel);
        queueMicrotask(() => {
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            // Fallback: make the panel itself focusable so focus is not lost.
            panel.setAttribute('tabindex', '-1');
            panel.focus();
          }
        });
        this._focusTrapCleanup = window.Lex.FocusTrap.activate(panel);
        this._eventCleanups.push(() => {
          if (this._focusTrapCleanup) {
            this._focusTrapCleanup();
            this._focusTrapCleanup = null;
          }
        });
      }

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

      // Unlock body scroll on cleanup — only if this instance locked it
      this._eventCleanups.push(() => {
        if (this._animEndCleanup) {
          this._animEndCleanup();
          this._animEndCleanup = null;
        } else if (this._scrollLocked) {
          ScrollLock.unlock();
          this._scrollLocked = false;
        }
      });
    }

    // --- Instance API ---

    /**
     * Set action buttons in the drawer header (between title and close button).
     *   drawer.setHeaderActions([
     *     { icon: '<svg>...</svg>', title: 'Refresh', onclick: () => { ... } },
     *     { icon: '<svg>...</svg>', title: 'More',    onclick: (btn) => { ... } }
     *   ]);
     * Each entry renders a small icon button. Pass `html` instead of `icon`
     * to inject arbitrary markup (e.g. a dropdown wrapper).
     */
    setHeaderActions(actions) {
      const slot = this.querySelector('.lex-drawer-header-actions');
      if (!slot) return;
      slot.innerHTML = '';
      if (!actions || !actions.length) return;

      for (const action of actions) {
        if (action.html) {
          // action.html is TRUSTED pre-built markup supplied by internal callers
          // (e.g. icon SVGs, dropdown wrappers). It is never sourced from
          // user-entered data or external content. Do NOT pass raw user strings
          // here — use the icon/title path below for user-supplied text.
          const wrapper = document.createElement('div');
          wrapper.innerHTML = action.html;
          while (wrapper.firstChild) slot.appendChild(wrapper.firstChild);
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'lex-drawer-close';  // reuse same icon-button style
          // action.title is user-provided text — set via textContent, not innerHTML
          btn.title = action.title || '';
          // action.icon is trusted pre-built SVG markup (same as action.html)
          btn.innerHTML = action.icon || '';
          if (action.onclick) btn.addEventListener('click', (e) => action.onclick(btn, e));
          if (action.id) btn.id = action.id;
          slot.appendChild(btn);
        }
      }
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

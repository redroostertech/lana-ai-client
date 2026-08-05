/* Lex UI — Modal Component
   Dialog overlay with header, body, and action buttons.
   Supports standard sizes and fullscreen mode.

   Declarative Usage:
     <lex-modal heading="Confirm Delete" open="false">
       <p>Are you sure you want to delete this matter?</p>
     </lex-modal>

   Imperative Usage:
     Lex.Modal.confirm('Delete Matter', 'Are you sure?', () => { ... });
     Lex.Modal.alert('Success', 'Matter created successfully.');
     Lex.Modal.open({ heading: 'Edit', content: '<form>...</form>', size: 'full' });

   Sizes: sm | md | lg | xl | full
   Variants: default | danger | info | success
   Events: lex-confirm, lex-cancel, lex-close
*/

(function () {
  'use strict';

  const { LexElement, defineLex, ScrollLock } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-modal-styles';
    style.textContent = `
      lex-modal {
        display: contents;
      }

      /* ── Overlay ─────────────────────────────────────── */

      .lex-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--lex-z-modal, 40);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }

      .lex-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        animation: lex-modal-fade-in var(--lex-duration-fade, 200ms) var(--lex-ease-out, ease);
      }

      /* ── Panel ───────────────────────────────────────── */

      .lex-modal-panel {
        position: relative;
        width: 100%;
        max-height: calc(100vh - 32px);
        display: grid;
        grid-template-rows: auto minmax(0, 1fr) auto;
        background: var(--lex-bg-primary);
        border-radius: var(--lex-radius-xl, 12px);
        box-shadow: var(--lex-shadow-xl, 0 20px 60px rgba(0,0,0,0.15));
        overflow: hidden;
      }

      /* Size variants — slide-up entry for standard sizes */
      .lex-modal-panel--sm,
      .lex-modal-panel--md,
      .lex-modal-panel--lg,
      .lex-modal-panel--xl {
        animation: lex-modal-slide-up var(--lex-duration-slide, 300ms) var(--lex-ease-out, ease);
      }

      .lex-modal-panel--sm  { max-width: 380px; }
      .lex-modal-panel--md  { max-width: 480px; }
      .lex-modal-panel--lg  { max-width: 640px; }
      .lex-modal-panel--xl  { max-width: 800px; }

      /* Fullscreen */
      .lex-modal-overlay--full {
        padding: 0;
        justify-content: flex-end;
      }

      .lex-modal-panel--full {
        max-width: 100%;
        max-height: none;
        width: 100%;
        height: 100vh;
        height: 100dvh;
        border-radius: 0;
        box-shadow: none;
        animation: lex-modal-slide-in-right var(--lex-duration-slide, 300ms) var(--lex-ease-out, ease);
      }

      /* ── Header ──────────────────────────────────────── */

      .lex-modal-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        align-items: center;
        gap: 8px;
        padding: 16px 20px;
        border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
        min-width: 0;
      }

      .lex-modal-panel--full .lex-modal-header {
        padding: 16px 24px;
      }

      .lex-modal-title-group {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        gap: 8px;
      }

      .lex-modal-header-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
      }

      .lex-modal-title {
        font-size: var(--lex-body-base-size, 1rem);
        font-weight: var(--lex-weight-semibold, 600);
        color: var(--lex-text-primary);
        line-height: 1.4;
        margin: 0;
        min-width: 0;
      }

      .lex-modal-back,
      .lex-modal-close {
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

      .lex-modal-back[hidden] {
        display: none;
      }

      .lex-modal-back:hover,
      .lex-modal-close:hover {
        background: var(--lex-bg-tertiary);
        color: var(--lex-text-primary);
      }

      .lex-modal-back svg,
      .lex-modal-close svg {
        width: 18px;
        height: 18px;
      }

      /* ── Body ────────────────────────────────────────── */

      .lex-modal-body {
        padding: 20px;
        min-height: 0;
        overflow-y: auto;
      }

      .lex-modal-panel--full .lex-modal-body {
        padding: 24px;
      }

      .lex-modal-body-text {
        font-size: var(--lex-body-sm-size, 0.875rem);
        color: var(--lex-text-secondary);
        line-height: 1.6;
      }

      /* ── Footer / Actions ────────────────────────────── */

      .lex-modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px;
        border-top: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
        background: var(--lex-bg-secondary);
        min-width: 0;
      }

      .lex-modal-panel--full .lex-modal-footer {
        padding: 12px 24px;
      }

      .lex-modal-panel--full:not(:has(.lex-modal-header)) .lex-modal-footer {
        border-radius: 0;
      }

      .lex-modal-btn {
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
        transition: background 0.15s ease, opacity 0.15s ease;
        outline: none;
      }

      .lex-modal-btn:focus-visible {
        box-shadow: 0 0 0 2px var(--lex-bg-primary), 0 0 0 4px var(--lex-bg-accent);
      }

      .lex-modal-btn--cancel {
        background: var(--lex-color-gray-200);
        color: var(--lex-text-primary);
      }

      .lex-modal-btn--cancel:hover {
        background: var(--lex-color-gray-300);
      }

      .lex-modal-btn--confirm {
        background: var(--lex-bg-accent);
        color: var(--lex-text-on-accent);
      }

      .lex-modal-btn--confirm:hover {
        background: var(--lex-bg-accent-hover);
      }

      /* Variant: danger */
      .lex-modal-btn--danger {
        background: var(--lex-color-danger-500);
        color: var(--lex-color-white);
      }

      .lex-modal-btn--danger:hover {
        background: var(--lex-color-danger-600);
      }

      /* Variant: info */
      .lex-modal-btn--info {
        background: var(--lex-color-info-500);
        color: var(--lex-color-white);
      }

      .lex-modal-btn--info:hover {
        background: var(--lex-color-info-600);
      }

      /* Variant: success */
      .lex-modal-btn--success {
        background: var(--lex-color-success-500);
        color: var(--lex-color-white);
      }

      .lex-modal-btn--success:hover {
        background: var(--lex-color-success-600);
      }

      /* ── Animations ──────────────────────────────────── */

      @keyframes lex-modal-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      @keyframes lex-modal-slide-up {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.97);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes lex-modal-slide-in-right {
        from { transform: translateX(100%); }
        to   { transform: translateX(0); }
      }

      /* ── Exit animations ─────────────────────────────── */

      @keyframes lex-modal-fade-out {
        from { opacity: 1; }
        to   { opacity: 0; }
      }

      @keyframes lex-modal-slide-down {
        from {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        to {
          opacity: 0;
          transform: translateY(12px) scale(0.97);
        }
      }

      @keyframes lex-modal-slide-out-right {
        from { transform: translateX(0); }
        to   { transform: translateX(100%); }
      }

      .lex-modal-backdrop--closing {
        animation: lex-modal-fade-out var(--lex-duration-fade, 200ms) var(--lex-ease-in, ease) forwards;
      }

      .lex-modal-panel--closing {
        animation: lex-modal-slide-down var(--lex-duration-slide, 300ms) var(--lex-ease-in, ease) forwards;
      }

      .lex-modal-panel--full.lex-modal-panel--closing {
        animation: lex-modal-slide-out-right var(--lex-duration-slide, 300ms) var(--lex-ease-in, ease) forwards;
      }
    `;
    document.head.appendChild(style);
  }

  const CLOSE_SVG = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
  const BACK_SVG = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 18-6-6 6-6"/></svg>';

  // Monotonically increasing counter to generate unique aria-labelledby IDs.
  let _modalIdCounter = 0;

  class LexModal extends LexElement {
    static get properties() {
      return {
        heading:     { type: String, default: '' },
        open:        { type: Boolean, default: false, reflect: true },
        size:        { type: String, default: 'md' },       // sm | md | lg | xl | full
        confirmText: { type: String, default: 'Confirm' },
        cancelText:  { type: String, default: 'Cancel' },
        variant:     { type: String, default: 'default' },  // default | danger | info | success
        hideActions: { type: Boolean, default: false },
        closeOnOverlay: { type: Boolean, default: true },
        backButton:  { type: Boolean, default: false },
        backLabel:   { type: String, default: 'Back' },
        headerActions: { type: String, default: '' },
        footerContent: { type: String, default: '' }
      };
    }

    constructor() {
      super();
      // Unique ID used for the aria-labelledby / title element pair.
      this._titleId = 'lex-modal-title-' + (++_modalIdCounter);
      // Element focused before the modal opened — restored on close.
      this._previousFocus = null;
      // Cleanup function returned by FocusTrap.activate().
      this._focusTrapCleanup = null;
    }

    connected() {
      // connectedCallback already ran _performUpdate() synchronously,
      // so children have been captured and restored into <slot-content>.
      // Null out _originalChildren to prevent _restoreContent() from
      // re-cloning on subsequent updates — this preserves live DOM nodes
      // and any event listeners bound to them by page scripts.
      this._originalChildren = null;
      // Tracks whether this instance currently holds the ScrollLock.
      // Prevents double-unlock when the component re-renders while open.
      this._scrollLocked = false;
    }

    render() {
      injectStyles();

      // After first render, skip innerHTML replacement to preserve live children.
      // open/close is handled in updated() via CSS visibility.
      if (this._rendered) return null;
      this._rendered = true;

      const isFull = this.size === 'full';
      const overlayCls = `lex-modal-overlay${isFull ? ' lex-modal-overlay--full' : ''}`;
      const panelCls = `lex-modal-panel lex-modal-panel--${this.size || 'md'}`;

      // Confirm button variant class
      const btnVariantMap = {
        default: 'lex-modal-btn--confirm',
        danger:  'lex-modal-btn--danger',
        info:    'lex-modal-btn--info',
        success: 'lex-modal-btn--success'
      };
      const confirmBtnCls = btnVariantMap[this.variant] || btnVariantMap.default;

      // aria-labelledby points to the heading element when a heading is provided.
      const labelledBy = this.heading ? ` aria-labelledby="${this._titleId}"` : '';

      // Always render the full structure; starts hidden.
      let html = `<div class="${overlayCls}" style="display:none">`;
      html += `<div class="lex-modal-backdrop" data-action="overlay"></div>`;
      html += `<div class="${panelCls}" role="dialog" aria-modal="true"${labelledBy}>`;

      // Header
      if (this.heading) {
        html += `<div class="lex-modal-header">`;
        html += `<div class="lex-modal-title-group">`;
        html += `<button type="button" class="lex-modal-back" data-action="back" aria-label="${this.escapeHtml(this.backLabel || 'Back')}"${this.backButton ? '' : ' hidden'}>${BACK_SVG}</button>`;
        html += `<h3 id="${this._titleId}" class="lex-modal-title">${this.escapeHtml(this.heading)}</h3>`;
        html += `</div>`;
        if (this.headerActions) {
          html += `<div class="lex-modal-header-actions">${this.headerActions}</div>`;
        }
        html += `<button type="button" class="lex-modal-close" data-action="close" aria-label="Close dialog">${CLOSE_SVG}</button>`;
        html += `</div>`;
      }

      // Body
      html += `<div class="lex-modal-body"><slot-content></slot-content></div>`;

      // Footer / Actions
      if (this.footerContent) {
        html += `<div class="lex-modal-footer">${this.footerContent}</div>`;
      } else if (!this.hideActions) {
        html += `<div class="lex-modal-footer">`;
        if (this.cancelText) {
          html += `<button type="button" class="lex-modal-btn lex-modal-btn--cancel" data-action="cancel">${this.escapeHtml(this.cancelText)}</button>`;
        }
        html += `<button type="button" class="lex-modal-btn ${confirmBtnCls}" data-action="confirm">${this.escapeHtml(this.confirmText)}</button>`;
        html += `</div>`;
      }

      html += `</div></div>`;

      return html;
    }

    updated(changedProps) {
      const overlay = this.querySelector('.lex-modal-overlay');

      // Sync heading text without re-render.
      // Also keep aria-labelledby on the panel in sync when heading changes.
      if (changedProps && changedProps.has('heading')) {
        const titleEl = this.querySelector('.lex-modal-title');
        if (titleEl) titleEl.textContent = this.heading;
        const panel = this.querySelector('.lex-modal-panel');
        if (panel) {
          if (this.heading) {
            panel.setAttribute('aria-labelledby', this._titleId);
          } else {
            panel.removeAttribute('aria-labelledby');
          }
        }
      }

      if (changedProps && (changedProps.has('backButton') || changedProps.has('backLabel'))) {
        const backBtn = this.querySelector('.lex-modal-back');
        if (backBtn) {
          backBtn.hidden = !this.backButton;
          backBtn.setAttribute('aria-label', this.backLabel || 'Back');
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
          const panel = this.querySelector('.lex-modal-panel');
          const backdrop = this.querySelector('.lex-modal-backdrop');
          if (panel && !panel.classList.contains('lex-modal-panel--closing')) {
            panel.classList.add('lex-modal-panel--closing');
            if (backdrop) backdrop.classList.add('lex-modal-backdrop--closing');
            const onEnd = () => {
              panel.removeEventListener('animationend', onEnd);
              overlay.style.display = 'none';
              panel.classList.remove('lex-modal-panel--closing');
              if (backdrop) backdrop.classList.remove('lex-modal-backdrop--closing');
              if (this._scrollLocked) {
                ScrollLock.unlock();
                this._scrollLocked = false;
              }
            };
            panel.addEventListener('animationend', onEnd);
            // Store for cleanup if disconnected during animation
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
      const panel = this.querySelector('.lex-modal-panel');
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

      this.delegate('click', '[data-action="confirm"]', () => {
        this.emit('lex-confirm');
        this.open = false;
      });

      this.delegate('click', '[data-action="cancel"]', () => {
        this.emit('lex-cancel');
        this.open = false;
      });

      this.delegate('click', '[data-action="back"]', () => {
        this.emit('lex-back');
      });

      this.delegate('click', '[data-action="close"]', () => {
        this.emit('lex-close');
        this.open = false;
      });

      if (this.closeOnOverlay) {
        this.delegate('click', '[data-action="overlay"]', () => {
          this.emit('lex-close');
          this.open = false;
        });
      }

      // ESC key to close
      const escHandler = (e) => {
        if (e.key === 'Escape' && this.open) {
          this.emit('lex-close');
          this.open = false;
        }
      };
      document.addEventListener('keydown', escHandler);
      this._eventCleanups.push(() => document.removeEventListener('keydown', escHandler));

      // Unlock body scroll on close — only if this instance locked it
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

    // --- Static API ---

    static confirm(title, message, onConfirm, options = {}) {
      const modal = document.createElement('lex-modal');
      modal.heading = title;
      modal.variant = options.variant || 'default';
      modal.confirmText = options.confirmText || 'Confirm';
      modal.cancelText = options.cancelText || 'Cancel';
      modal.size = options.size || 'md';
      modal.innerHTML = `<p class="lex-modal-body-text">${message}</p>`;
      modal.open = true;

      modal.addEventListener('lex-confirm', () => {
        if (onConfirm) onConfirm();
        modal.remove();
      });
      modal.addEventListener('lex-cancel', () => modal.remove());
      modal.addEventListener('lex-close', () => modal.remove());

      document.body.appendChild(modal);
      return modal;
    }

    static alert(title, message, options = {}) {
      return LexModal.confirm(title, message, null, {
        ...options,
        confirmText: options.confirmText || 'OK',
        cancelText: null
      });
    }

    /**
     * Open a modal with custom content.
     *   Lex.Modal.open({ heading, content, size, hideActions, ... })
     * Returns the modal element.
     */
    static open(options = {}) {
      const modal = document.createElement('lex-modal');
      modal.heading = options.heading || '';
      modal.variant = options.variant || 'default';
      modal.size = options.size || 'md';
      modal.hideActions = options.hideActions !== undefined ? options.hideActions : true;
      modal.closeOnOverlay = options.closeOnOverlay !== undefined ? options.closeOnOverlay : true;
      modal.backButton = options.backButton === true;
      modal.backLabel = options.backLabel || 'Back';
      modal.headerActions = options.headerActions || '';
      modal.footerContent = options.footerContent || '';

      if (options.content) {
        if (typeof options.content === 'string') {
          modal.innerHTML = options.content;
        } else if (window.Node && options.content instanceof window.Node) {
          modal.appendChild(options.content);
        }
      }
      modal.open = true;

      modal.addEventListener('lex-close', () => modal.remove());
      modal.addEventListener('lex-cancel', () => modal.remove());

      if (options.onConfirm) {
        modal.hideActions = false;
        modal.confirmText = options.confirmText || 'Confirm';
        modal.cancelText = options.cancelText || 'Cancel';
        modal.addEventListener('lex-confirm', () => {
          options.onConfirm();
          modal.remove();
        });
      }

      document.body.appendChild(modal);
      return modal;
    }
  }

  defineLex('lex-modal', LexModal);

  // Expose static API globally
  window.Lex.Modal = LexModal;
})();

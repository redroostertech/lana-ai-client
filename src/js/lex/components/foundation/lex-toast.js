/* Lex UI — Toast Component
   Notification toasts with auto-dismiss, icons, close button, and CTA actions.
   Always anchored to the top-right corner.

   Imperative Usage:
     Lex.Toast.success('Saved successfully');
     Lex.Toast.error('Something went wrong');
     Lex.Toast.info('Processing...', { duration: 5000 });
     Lex.Toast.warning('Rate limit approaching', {
       action: { label: 'Upgrade', onClick: () => navigate('/plans') }
     });

   Options:
     duration   — auto-dismiss in ms (0 = persistent). Default 4000
     action     — { label: String, onClick: Function }
     dismissible — show close button (default true)
     icon       — custom SVG string (overrides default type icon)

   Declarative Usage:
     <lex-toast message="Saved" type="success" duration="3000"></lex-toast>
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  // Global toast container
  let container = null;
  let stylesInjected = false;

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // -----------------------------------------------------------------------
  // Inject styles once
  // -----------------------------------------------------------------------

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-toast-styles';
    style.textContent = `
      #lex-toast-container {
        position: fixed;
        top: 1rem;
        right: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        z-index: var(--lex-z-toast, 50);
        pointer-events: none;
        max-width: 420px;
        width: 100%;
      }

      .lex-toast {
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.875rem 1rem;
        border-radius: var(--lex-radius-lg);
        border-left: 4px solid var(--_toast-accent);
        background: var(--lex-bg-primary);
        box-shadow: 0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
        transform: translateX(calc(100% + 2rem));
        transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease;
        opacity: 1;
        max-width: 100%;
      }

      .lex-toast.lex-toast-visible {
        transform: translateX(0);
      }

      .lex-toast.lex-toast-exit {
        transform: translateX(calc(100% + 2rem));
        opacity: 0;
      }

      .lex-toast-icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--_toast-accent);
        margin-top: 1px;
      }

      .lex-toast-body {
        flex: 1;
        min-width: 0;
      }

      .lex-toast-message {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-medium, 500);
        line-height: 1.4;
        color: var(--lex-text-primary);
      }

      .lex-toast-action {
        display: inline-block;
        margin-top: 0.375rem;
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-semibold, 600);
        color: var(--_toast-accent);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        text-decoration: none;
        transition: opacity 0.15s;
      }
      .lex-toast-action:hover {
        opacity: 0.75;
      }

      .lex-toast-close {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--lex-radius-md);
        border: none;
        background: none;
        color: var(--lex-text-tertiary);
        cursor: pointer;
        padding: 0;
        margin: -2px -4px -2px 0;
        transition: background 0.15s, color 0.15s;
      }
      .lex-toast-close:hover {
        background: var(--lex-bg-tertiary);
        color: var(--lex-text-primary);
      }

      /* Progress bar (auto-dismiss timer) */
      .lex-toast-progress {
        position: absolute;
        bottom: 0;
        left: 4px;
        right: 0;
        height: 2px;
        background: var(--_toast-accent);
        opacity: 0.3;
        transform-origin: left;
        border-radius: 0 0 var(--lex-radius-lg) 0;
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // Ensure container
  // -----------------------------------------------------------------------

  function ensureContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.createElement('div');
      container.id = 'lex-toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  // -----------------------------------------------------------------------
  // Type config
  // -----------------------------------------------------------------------

  const TYPES = {
    success: {
      accent: 'var(--lex-color-success-500)',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>'
    },
    error: {
      accent: 'var(--lex-color-danger-500)',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>'
    },
    warning: {
      accent: 'var(--lex-color-warning-500)',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>'
    },
    info: {
      accent: 'var(--lex-color-info-500)',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'
    }
  };

  // -----------------------------------------------------------------------
  // Close icon SVG
  // -----------------------------------------------------------------------

  const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  // -----------------------------------------------------------------------
  // LexToast component
  // -----------------------------------------------------------------------

  class LexToast extends LexElement {
    static get properties() {
      return {
        message:  { type: String, default: '' },
        type:     { type: String, default: 'info' },
        duration: { type: Number, default: 4000 }
      };
    }

    connected() {
      if (this.message) {
        LexToast.show(this.message, this.type, { duration: this.duration });
      }
    }

    render() { return ''; }

    // --- Static API ---

    /**
     * Show a toast notification.
     * @param {string} message - The text to display
     * @param {string} type - success | error | warning | info
     * @param {object} opts - { duration, action: { label, onClick }, dismissible, icon }
     */
    static show(message, type = 'info', opts = {}) {
      injectStyles();
      const c = ensureContainer();

      // Support legacy call: show(message, type, duration)
      if (typeof opts === 'number') {
        opts = { duration: opts };
      }

      const {
        duration = 4000,
        action = null,
        dismissible = true,
        icon = null
      } = opts;

      const typeConfig = TYPES[type] || TYPES.info;

      // Build icon SVG
      const iconSvg = icon
        ? icon
        : `<svg class="lex-toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">${typeConfig.icon}</svg>`;

      // Build action button
      const actionHtml = action && action.label
        ? `<button class="lex-toast-action">${escapeHtml(action.label)}</button>`
        : '';

      // Build close button
      const closeHtml = dismissible
        ? `<button class="lex-toast-close" aria-label="Dismiss">${CLOSE_ICON}</button>`
        : '';

      // Build progress bar
      const progressHtml = duration > 0
        ? `<div class="lex-toast-progress" style="animation:lex-toast-countdown ${duration}ms linear forwards;"></div>`
        : '';

      // Create toast element
      const toast = document.createElement('div');
      toast.className = 'lex-toast';
      toast.style.setProperty('--_toast-accent', typeConfig.accent);
      toast.style.position = 'relative';
      toast.style.overflow = 'hidden';

      toast.innerHTML = `
        ${iconSvg}
        <div class="lex-toast-body">
          <div class="lex-toast-message">${escapeHtml(message)}</div>
          ${actionHtml}
        </div>
        ${closeHtml}
        ${progressHtml}
      `;

      // Wire up close button
      if (dismissible) {
        const closeBtn = toast.querySelector('.lex-toast-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => dismissToast(toast, timer));
        }
      }

      // Wire up action button
      if (action && action.onClick) {
        const actionBtn = toast.querySelector('.lex-toast-action');
        if (actionBtn) {
          actionBtn.addEventListener('click', () => {
            action.onClick();
            dismissToast(toast, timer);
          });
        }
      }

      c.appendChild(toast);

      // Animate in
      requestAnimationFrame(() => {
        toast.classList.add('lex-toast-visible');
      });

      // Auto dismiss timer
      let timer = null;
      if (duration > 0) {
        timer = setTimeout(() => dismissToast(toast, null), duration);
      }

      // Pause timer on hover
      if (duration > 0) {
        toast.addEventListener('mouseenter', () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          const progress = toast.querySelector('.lex-toast-progress');
          if (progress) progress.style.animationPlayState = 'paused';
        });

        toast.addEventListener('mouseleave', () => {
          timer = setTimeout(() => dismissToast(toast, null), 2000);
          const progress = toast.querySelector('.lex-toast-progress');
          if (progress) {
            progress.style.animation = 'none';
            progress.offsetHeight; // force reflow
            progress.style.animation = `lex-toast-countdown 2000ms linear forwards`;
            progress.style.animationPlayState = 'running';
          }
        });
      }

      return toast;
    }

    static success(message, opts) { return LexToast.show(message, 'success', opts); }
    static error(message, opts)   { return LexToast.show(message, 'error', opts); }
    static warning(message, opts) { return LexToast.show(message, 'warning', opts); }
    static info(message, opts)    { return LexToast.show(message, 'info', opts); }
  }

  // -----------------------------------------------------------------------
  // Dismiss helper
  // -----------------------------------------------------------------------

  function dismissToast(toast, timer) {
    if (timer) clearTimeout(timer);
    toast.classList.remove('lex-toast-visible');
    toast.classList.add('lex-toast-exit');
    setTimeout(() => toast.remove(), 300);
  }

  // -----------------------------------------------------------------------
  // Inject countdown keyframe
  // -----------------------------------------------------------------------

  (function injectCountdownKeyframe() {
    if (document.getElementById('lex-toast-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'lex-toast-keyframes';
    style.textContent = `
      @keyframes lex-toast-countdown {
        from { transform: scaleX(1); }
        to   { transform: scaleX(0); }
      }
    `;
    document.head.appendChild(style);
  })();

  defineLex('lex-toast', LexToast);

  // Expose static API globally
  window.Lex.Toast = LexToast;
})();

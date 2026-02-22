/* Lex UI — Button Component
   Rounded button with variants, sizes, icon support, badge count, and ripple feedback.

   Usage:
     <lex-btn variant="primary">Save</lex-btn>
     <lex-btn variant="primary" leading-icon="plus">Add Item</lex-btn>
     <lex-btn variant="danger" trailing-icon="trash">Delete</lex-btn>
     <lex-btn variant="ghost" leading-icon="settings" icon>settings icon-only</lex-btn>
     <lex-btn variant="danger" loading="true">Deleting...</lex-btn>
     <lex-btn variant="success" icon="true"><svg>...</svg></lex-btn>
     <lex-btn variant="info"><svg>...</svg> Attach File</lex-btn>
     <lex-btn variant="ghost" icon="true" badge="5"><svg>...</svg></lex-btn>

   Icon names: any Lex.Icons name (Lucide icons) — e.g. "plus", "search", "arrow-right"
   Variants: primary | secondary | danger | success | warning | info | ghost
   Sizes: sm | md | lg
   icon="true" for icon-only buttons (square padding)
   badge="N" shows a red notification bubble (0 or empty hides it, >99 shows "99+")
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;
  var Icons = (window.Lex && window.Lex.Icons) || null;

  // Icon size per button size (matches visual weight)
  var ICON_SIZES = { sm: 'small', md: 'small', lg: 'normal' };

  function getIcon(name, btnSize) {
    if (!name) return '';
    if (Icons && Icons.has && Icons.has(name)) {
      var sizeToken = ICON_SIZES[btnSize] || 'small';
      return String(Icons[name][sizeToken]);
    }
    return '';
  }

  // Inject button styles once
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-btn-styles';
    style.textContent = `
      /* ── Button base ─────────────────────────────────── */

      .lex-btn-inner {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font-family: var(--lex-font-sans, inherit);
        font-weight: var(--lex-weight-medium, 500);
        border-radius: var(--_btn-radius);
        border: none;
        cursor: pointer;
        overflow: hidden;
        user-select: none;
        white-space: nowrap;
        transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
        background: var(--_btn-bg);
        color: var(--_btn-text);
        outline: none;
      }

      /* Slot content must be inline-flex so icons + text sit on one line */
      .lex-btn-inner slot-content {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
      .lex-btn-inner slot-content svg {
        flex-shrink: 0;
      }

      .lex-btn-inner:hover:not(:disabled) {
        background: var(--_btn-bg-hover);
      }
      .lex-btn-inner:active:not(:disabled) {
        transform: scale(0.97);
      }
      .lex-btn-inner:focus-visible {
        box-shadow: 0 0 0 2px var(--lex-bg-primary), 0 0 0 4px var(--_btn-ring, var(--_btn-bg));
      }
      .lex-btn-inner:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      /* ── Ripple ──────────────────────────────────────── */

      .lex-btn-ripple {
        position: absolute;
        border-radius: 50%;
        background: var(--_btn-ripple);
        transform: scale(0);
        animation: lex-btn-ripple-anim 0.5s ease-out forwards;
        pointer-events: none;
      }

      @keyframes lex-btn-ripple-anim {
        to { transform: scale(2.5); opacity: 0; }
      }

      /* ── Spinner ─────────────────────────────────────── */

      .lex-btn-spinner {
        flex-shrink: 0;
        animation: lex-btn-spin 0.8s linear infinite;
      }

      @keyframes lex-btn-spin {
        to { transform: rotate(360deg); }
      }

      /* ── Badge ─────────────────────────────────────────── */

      lex-btn {
        position: relative;
        display: inline-block;
      }

      .lex-btn-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        z-index: 2;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--lex-badge-notification-bg, var(--lex-color-danger-500, #F04438));
        color: var(--lex-badge-notification-text, var(--lex-color-white, #FFFFFF));
        font-size: var(--lex-badge-count-size, 0.625rem);
        font-weight: var(--lex-weight-bold, 700);
        border-radius: var(--lex-radius-full, 9999px);
        line-height: 1;
        pointer-events: none;
        z-index: 1;
        box-shadow: 0 0 0 2px var(--lex-bg-primary, #fff);
      }

      .lex-btn-badge--sm {
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        font-size: 9px;
        top: -3px;
        right: -3px;
      }

      .lex-btn-badge--lg {
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        font-size: var(--lex-body-xs-size, 0.75rem);
        top: -5px;
        right: -5px;
      }
    `;
    document.head.appendChild(style);
  }

  class LexBtn extends LexElement {
    static get properties() {
      return {
        variant:      { type: String, default: 'primary' },
        size:         { type: String, default: 'md' },
        disabled:     { type: Boolean, default: false, reflect: true },
        loading:      { type: Boolean, default: false },
        type:         { type: String, default: 'button' },
        icon:         { type: Boolean, default: false },
        badge:        { type: Number, default: 0 },
        leadingIcon:  { type: String, default: '' },
        trailingIcon: { type: String, default: '' }
      };
    }

    render() {
      injectStyles();

      const variants = {
        primary: {
          bg:      'var(--lex-bg-accent)',
          bgHover: 'var(--lex-bg-accent-hover)',
          text:    'var(--lex-text-on-accent)',
          ripple:  'rgba(255,255,255,0.25)'
        },
        secondary: {
          bg:      'var(--lex-color-gray-200)',
          bgHover: 'var(--lex-color-gray-300)',
          text:    'var(--lex-text-primary)',
          ripple:  'rgba(0,0,0,0.08)'
        },
        danger: {
          bg:      'var(--lex-color-danger-500)',
          bgHover: 'var(--lex-color-danger-600)',
          text:    'var(--lex-color-white)',
          ripple:  'rgba(255,255,255,0.25)'
        },
        success: {
          bg:      'var(--lex-color-success-500)',
          bgHover: 'var(--lex-color-success-600)',
          text:    'var(--lex-color-white)',
          ripple:  'rgba(255,255,255,0.25)'
        },
        warning: {
          bg:      'var(--lex-color-warning-500)',
          bgHover: 'var(--lex-color-warning-600)',
          text:    'var(--lex-color-white)',
          ripple:  'rgba(255,255,255,0.25)'
        },
        info: {
          bg:      'var(--lex-color-info-500)',
          bgHover: 'var(--lex-color-info-600)',
          text:    'var(--lex-color-white)',
          ripple:  'rgba(255,255,255,0.25)'
        },
        ghost: {
          bg:      'transparent',
          bgHover: 'var(--lex-color-gray-100)',
          text:    'var(--lex-text-secondary)',
          ripple:  'rgba(0,0,0,0.06)'
        }
      };

      const v = variants[this.variant] || variants.primary;

      // Squircle-like radius: ~30% of rendered height per size
      // sm ≈ 30px tall → 9px,  md ≈ 36px → 11px,  lg ≈ 42px → 13px
      const radii = {
        sm: 'var(--lex-btn-radius-sm, 9px)',
        md: 'var(--lex-btn-radius-md, 11px)',
        lg: 'var(--lex-btn-radius-lg, 13px)'
      };

      const radius = radii[this.size] || radii.md;

      // Sizes — icon-only buttons get square padding, text buttons get horizontal padding.
      // font-size always applied regardless of icon mode.
      const sizes = {
        sm: this.icon
          ? 'padding:0.375rem; font-size:var(--lex-body-xs-size, 0.75rem);'
          : 'padding:0.375rem 0.875rem; font-size:var(--lex-body-xs-size, 0.75rem);',
        md: this.icon
          ? 'padding:0.5rem; font-size:var(--lex-body-sm-size, 0.875rem);'
          : 'padding:0.5rem 1.125rem; font-size:var(--lex-body-sm-size, 0.875rem);',
        lg: this.icon
          ? 'padding:0.625rem; font-size:var(--lex-body-base-size, 1rem);'
          : 'padding:0.625rem 1.5rem; font-size:var(--lex-body-base-size, 1rem);'
      };

      const sizeStyle = sizes[this.size] || sizes.md;

      const cssVars = `--_btn-bg:${v.bg};--_btn-bg-hover:${v.bgHover};--_btn-text:${v.text};--_btn-ripple:${v.ripple};--_btn-ring:${v.bg};--_btn-radius:${radius};`;

      const spinnerSize = this.size === 'sm' ? 14 : this.size === 'lg' ? 18 : 16;
      const spinner = this.loading ? `
        <svg class="lex-btn-spinner" width="${spinnerSize}" height="${spinnerSize}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"></circle>
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
        </svg>
      ` : '';

      const badgeCount = this.badge || 0;
      const badgeSizeCls = this.size === 'sm' ? ' lex-btn-badge--sm' : this.size === 'lg' ? ' lex-btn-badge--lg' : '';
      const badgeHtml = badgeCount > 0
        ? `<span class="lex-btn-badge${badgeSizeCls}">${badgeCount > 99 ? '99+' : badgeCount}</span>`
        : '';

      const leadSvg = this.leadingIcon ? getIcon(this.leadingIcon, this.size) : '';
      const trailSvg = this.trailingIcon ? getIcon(this.trailingIcon, this.size) : '';

      return `${badgeHtml}<button
          type="${this.type}"
          class="lex-btn-inner"
          style="${cssVars}${sizeStyle}"
          ${this.disabled || this.loading ? 'disabled' : ''}
        >${spinner}${leadSvg}<slot-content></slot-content>${trailSvg}</button>`;
    }

    updated() {
      // Auto-generate aria-label for icon-only buttons so screen readers have
      // an accessible name. We check the inner button's visible text content:
      // if it is empty (or only contains SVG content with no text nodes), and
      // a leading icon name is available, derive a human-readable label from it
      // by replacing hyphens with spaces (e.g. "chevron-left" → "chevron left").
      const btn = this.querySelector('button.lex-btn-inner');
      if (btn && !btn.hasAttribute('aria-label')) {
        // Check for visible text in slot-content (ignores SVG child nodes).
        const slotContent = btn.querySelector('slot-content');
        const slotText = slotContent ? slotContent.textContent.trim() : '';
        const isIconOnly = this.icon || slotText === '';

        if (isIconOnly) {
          // Prefer leadingIcon name, then trailingIcon name.
          const iconName = this.leadingIcon || this.trailingIcon;
          if (iconName) {
            // Convert kebab-case to readable words: "chevron-left" → "chevron left"
            const readable = iconName.split('-').join(' ');
            btn.setAttribute('aria-label', readable);
          }
        }
      }

      this.delegate('click', 'button', (e) => {
        if (this.disabled || this.loading) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // Ripple effect
        const clickedBtn = e.target.closest('button');
        if (!clickedBtn) return;
        const rect = clickedBtn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement('span');
        ripple.className = 'lex-btn-ripple';
        ripple.style.width = size + 'px';
        ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        clickedBtn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 500);
      });
    }
  }

  defineLex('lex-btn', LexBtn);
})();

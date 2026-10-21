/* Lex UI — Dropdown Button Component
   Button that opens a searchable dropdown menu. Unlike lex-select,
   the button label stays fixed (it's a command menu, not a form field).

   Usage:
     <lex-dropdown-btn button-label="Actions" variant="primary"
       options='[{"value":"edit","label":"Edit","icon":"edit"},{"value":"delete","label":"Delete","icon":"trash-2"}]'>
     </lex-dropdown-btn>

   Icon-only trigger at the right edge (e.g. a header account menu):
     <lex-dropdown-btn icon="settings" icon-only aria-label="Account menu"
       align="end" variant="ghost"
       options='[{"label":"Settings","href":"settings-v2.html","icon":"settings"},
                 {"divider":true},
                 {"value":"logout","label":"Log out","icon":"log-out","variant":"danger"}]'>
     </lex-dropdown-btn>

   Attributes:
     button-label   trigger text (default "Actions"); the accessible name of an
                    icon-only trigger when there is no aria-label
     icon           Lex.Icons name shown before the label
     icon-only      show only the icon (no label, no chevron); set aria-label
     align          start (default) | end — which trigger edge the menu lines up with
     variant        primary | secondary (default) | ghost
     searchable, disabled

   Items: { value, label, icon?, description?, href?, target?, variant?: 'danger',
            danger?: true, disabled?: true } or { divider: true } separators.
     href renders the item as a link (javascript: URLs are dropped); clicking
     it still emits lex-select and then follows the link.

   Keyboard: ArrowDown/Enter/Space on the trigger opens and focuses the first
   item; ArrowUp/ArrowDown/Home/End move; Enter/Space activates; Escape closes
   and returns focus to the trigger; Tab closes. ARIA: menu / menuitem /
   separator, aria-haspopup, aria-expanded, aria-controls.

   Events: lex-select { value, label, item }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, Icons } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-dropdown-btn-styles';
    style.textContent = `
      lex-dropdown-btn {
        display: inline-block;
        position: relative;
      }

      .lex-ddbtn-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: inherit;
        font-weight: var(--lex-weight-medium, 500);
        border: none;
        cursor: pointer;
        border-radius: var(--lex-btn-radius-md);
        padding: 0.5rem 1rem;
        font-size: var(--lex-form-font-size-lg, 0.875rem);
        transition: background 0.15s ease;
        outline: none;
        background: var(--_ddbtn-bg);
        color: var(--_ddbtn-text);
      }

      .lex-ddbtn-trigger:hover {
        background: var(--_ddbtn-bg-hover);
      }

      .lex-ddbtn-trigger:focus-visible {
        box-shadow: 0 0 0 2px var(--lex-bg-primary), 0 0 0 4px var(--_ddbtn-bg);
      }

      .lex-ddbtn-trigger:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .lex-ddbtn-chevron {
        width: 14px;
        height: 14px;
        transition: transform 0.2s ease;
      }

      .lex-ddbtn-trigger--open .lex-ddbtn-chevron {
        transform: rotate(180deg);
      }

      /* ── Dropdown ──────────────────────────────────────── */

      .lex-ddbtn-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 180px;
        max-height: 280px;
        overflow-y: auto;
        background: var(--lex-select-dropdown-bg, var(--lex-bg-primary));
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-input-radius);
        box-shadow: var(--lex-shadow-lg);
        z-index: var(--lex-z-dropdown, 10);
        display: none;
      }

      .lex-ddbtn-dropdown--open {
        display: block;
      }

      .lex-ddbtn-dropdown--end {
        left: auto;
        right: 0;
      }

      .lex-ddbtn-trigger--icon-only {
        padding: 0.5rem;
      }

      .lex-ddbtn-trigger-icon,
      .lex-ddbtn-trigger-icon svg {
        display: inline-flex;
        width: 16px;
        height: 16px;
      }

      a.lex-ddbtn-item {
        text-decoration: none;
      }

      .lex-ddbtn-item:focus {
        outline: none;
        background: var(--lex-select-option-hover, var(--lex-bg-secondary));
      }

      .lex-ddbtn-item--danger,
      .lex-ddbtn-item--danger .lex-ddbtn-item-icon {
        color: var(--lex-color-danger-600, var(--lex-color-danger-500));
      }

      .lex-ddbtn-item--disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .lex-ddbtn-item--disabled:hover {
        background: transparent;
      }

      .lex-ddbtn-separator {
        height: 1px;
        margin: 4px 0;
        background: var(--lex-border-subtle, rgba(0,0,0,0.06));
      }

      .lex-ddbtn-search {
        position: sticky;
        top: 0;
        padding: 8px;
        background: var(--lex-select-dropdown-bg, var(--lex-bg-primary));
        border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
      }

      .lex-ddbtn-search input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 10px;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        font-family: inherit;
        border: none;
        border-radius: var(--lex-radius-sm);
        outline: none;
        background: var(--lex-color-gray-50);
        color: var(--lex-text-primary);
      }

      .lex-ddbtn-search input:focus {
        background: var(--lex-bg-primary);
        box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500));
      }

      .lex-ddbtn-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-primary);
        transition: background 0.1s ease;
      }

      .lex-ddbtn-item:hover,
      .lex-ddbtn-item--focused {
        background: var(--lex-select-option-hover, var(--lex-bg-secondary));
      }

      .lex-ddbtn-item-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        color: var(--lex-text-tertiary);
      }

      .lex-ddbtn-item-icon svg {
        width: 16px;
        height: 16px;
      }

      .lex-ddbtn-item-desc {
        font-size: var(--lex-form-help-size, 0.6875rem);
        color: var(--lex-text-tertiary);
        margin-top: 1px;
      }

      .lex-ddbtn-empty {
        padding: 12px;
        text-align: center;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        color: var(--lex-text-tertiary);
      }
    `;
    document.head.appendChild(style);
  }

  const CHEVRON_SVG = '<svg class="lex-ddbtn-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  const VARIANTS = {
    primary:   { bg: 'var(--lex-bg-accent)', bgHover: 'var(--lex-bg-accent-hover)', text: 'var(--lex-text-on-accent)' },
    secondary: { bg: 'var(--lex-color-gray-200)', bgHover: 'var(--lex-color-gray-300)', text: 'var(--lex-text-primary)' },
    ghost:     { bg: 'transparent', bgHover: 'var(--lex-color-gray-100)', text: 'var(--lex-text-secondary)' }
  };

  function getIcon(name) {
    if (Icons && Icons.has && Icons.has(name)) {
      return Icons[name].small.toString();
    }
    return '';
  }

  let _ddbtnIdCounter = 0;

  function isDivider(item) {
    return !!item && (item.divider === true || item.separator === true);
  }

  function isActionable(item) {
    return !!item && !isDivider(item) && !item.disabled;
  }

  // href for a link item, or '' when it is missing or a script URL.
  function safeHref(href) {
    const text = String(href == null ? '' : href).trim();
    if (!text) return '';
    const compact = text.toLowerCase().split(' ').join('');
    if (compact.startsWith('javascript:') || compact.startsWith('vbscript:') || compact.startsWith('data:')) return '';
    return text;
  }

  class LexDropdownBtn extends LexElement {
    static get properties() {
      return {
        options:     { type: Array, default: [] },
        searchable:  { type: Boolean, default: false },
        variant:     { type: String, default: 'secondary' },
        buttonLabel: { type: String, default: 'Actions' },
        disabled:    { type: Boolean, default: false },
        icon:        { type: String, default: '' },      // Lex.Icons name on the trigger
        iconOnly:    { type: Boolean, default: false },  // icon-only trigger (set aria-label)
        align:       { type: String, default: 'start' }  // start | end
      };
    }

    constructor() {
      super();
      this._open = false;
      this._searchTerm = '';
      this._focusedIdx = -1;
      // When true, updated() moves DOM focus to the focused item (keyboard use).
      this._focusItems = false;
      this._focusTrigger = false;
      this._menuId = 'lex-ddbtn-menu-' + (++_ddbtnIdCounter);
    }

    render() {
      injectStyles();

      const v = VARIANTS[this.variant] || VARIANTS.secondary;
      const cssVars = `--_ddbtn-bg:${v.bg};--_ddbtn-bg-hover:${v.bgHover};--_ddbtn-text:${v.text};`;
      const openCls = this._open ? ' lex-ddbtn-trigger--open' : '';
      const disabledAttr = this.disabled ? 'disabled' : '';

      const filtered = this._getFiltered();
      const ariaExpanded = this._open ? 'true' : 'false';
      const iconOnly = !!this.iconOnly;
      const hostLabel = this.getAttribute('aria-label');
      const ariaLabel = iconOnly ? (hostLabel || this.buttonLabel || '') : (hostLabel || '');
      const ariaLabelAttr = ariaLabel ? ` aria-label="${this.escapeHtml(ariaLabel)}"` : '';
      const triggerIcon = this.icon ? getIcon(this.icon) : '';
      const iconOnlyCls = iconOnly ? ' lex-ddbtn-trigger--icon-only' : '';

      let html = `<button type="button" class="lex-ddbtn-trigger${openCls}${iconOnlyCls}" style="${cssVars}" ${disabledAttr} data-action="toggle" aria-haspopup="menu" aria-expanded="${ariaExpanded}" aria-controls="${this._menuId}"${ariaLabelAttr}>`;
      if (triggerIcon) html += `<span class="lex-ddbtn-trigger-icon" aria-hidden="true">${triggerIcon}</span>`;
      if (!iconOnly) {
        html += this.escapeHtml(this.buttonLabel);
        html += CHEVRON_SVG;
      }
      html += `</button>`;

      const endCls = this.align === 'end' ? ' lex-ddbtn-dropdown--end' : '';
      html += `<div class="lex-ddbtn-dropdown${this._open ? ' lex-ddbtn-dropdown--open' : ''}${endCls}" role="menu" id="${this._menuId}"${ariaLabel || this.buttonLabel ? ` aria-label="${this.escapeHtml(ariaLabel || this.buttonLabel)}"` : ''}>`;

      if (this.searchable) {
        html += `<div class="lex-ddbtn-search"><input type="text" placeholder="Search..." value="${this.escapeHtml(this._searchTerm)}" /></div>`;
      }

      if (filtered.length === 0) {
        html += `<div class="lex-ddbtn-empty">No items found</div>`;
      } else {
        filtered.forEach((item, idx) => {
          if (isDivider(item)) {
            html += `<div class="lex-ddbtn-separator" role="separator"></div>`;
            return;
          }
          let cls = 'lex-ddbtn-item';
          if (idx === this._focusedIdx) cls += ' lex-ddbtn-item--focused';
          if (item.variant === 'danger' || item.danger === true) cls += ' lex-ddbtn-item--danger';
          if (item.disabled) cls += ' lex-ddbtn-item--disabled';
          const iconHtml = item.icon ? `<span class="lex-ddbtn-item-icon" aria-hidden="true">${getIcon(item.icon)}</span>` : '';
          const value = item.value === null || item.value === undefined ? '' : String(item.value);
          const label = item.label === null || item.label === undefined ? value : item.label;
          const common = `class="${cls}" data-value="${this.escapeHtml(value)}" data-idx="${idx}" role="menuitem" tabindex="-1"${item.disabled ? ' aria-disabled="true" data-disabled="true"' : ''}`;
          const href = item.disabled ? '' : safeHref(item.href);
          if (href) {
            const target = item.target ? ` target="${this.escapeHtml(item.target)}"` : '';
            const rel = item.target === '_blank' ? ' rel="noopener noreferrer"' : '';
            html += `<a ${common} href="${this.escapeHtml(href)}"${target}${rel}>`;
          } else {
            html += `<div ${common}>`;
          }
          html += iconHtml;
          html += `<div><div>${this.escapeHtml(label)}</div>`;
          if (item.description) html += `<div class="lex-ddbtn-item-desc">${this.escapeHtml(item.description)}</div>`;
          html += `</div>`;
          html += href ? `</a>` : `</div>`;
        });
      }

      html += `</div>`;
      return html;
    }

    _getFiltered() {
      const opts = (Array.isArray(this.options) ? this.options : []).filter((o) => o !== null && o !== undefined);
      if (!this._searchTerm) return opts;
      const term = this._searchTerm.toLowerCase();
      return opts.filter(o => !isDivider(o) && String(o.label == null ? '' : o.label).toLowerCase().includes(term));
    }

    // Next actionable index from `from` in direction dir; stays put at the ends.
    _step(opts, from, dir) {
      let idx = from;
      for (let i = 0; i < opts.length; i++) {
        idx += dir;
        if (idx < 0 || idx >= opts.length) return from;
        if (isActionable(opts[idx])) return idx;
      }
      return from;
    }

    _first(opts) { return this._step(opts, -1, 1); }
    _last(opts) { return this._step(opts, opts.length, -1); }

    // While open, Escape anywhere closes just this menu. Capture phase on
    // window runs before an enclosing modal/drawer's document listener, and
    // stopping it there keeps that overlay open. (A mouse-opened menu
    // re-renders, so focus may sit on <body> where no menu listener runs.)
    _watchEscape(on) {
      if (on && !this._escapeWatcher) {
        this._escapeWatcher = (e) => {
          if (e.key !== 'Escape' || !this._open) return;
          e.preventDefault();
          e.stopPropagation();
          this._close(true);
        };
        window.addEventListener('keydown', this._escapeWatcher, true);
      } else if (!on && this._escapeWatcher) {
        window.removeEventListener('keydown', this._escapeWatcher, true);
        this._escapeWatcher = null;
      }
    }

    disconnected() {
      if (super.disconnected) super.disconnected();
      this._watchEscape(false);
    }

    _close(returnFocus) {
      this._watchEscape(false);
      this._open = false;
      this._focusedIdx = -1;
      this._focusItems = false;
      this._focusTrigger = !!returnFocus;
      this._scheduleUpdate();
    }

    _openMenu(focusFirst) {
      this._watchEscape(true);
      this._open = true;
      this._searchTerm = '';
      const opts = this._getFiltered();
      this._focusedIdx = focusFirst ? this._first(opts) : -1;
      this._focusItems = !!focusFirst && !this.searchable;
      this._scheduleUpdate();
      if (this.searchable) {
        queueMicrotask(() => {
          const si = this.querySelector('.lex-ddbtn-search input');
          if (si) si.focus();
        });
      }
    }

    updated() {
      // Keyboard focus follows re-renders (the markup is replaced each update).
      if (this._open && this._focusItems && this._focusedIdx >= 0) {
        const el = this.querySelector(`.lex-ddbtn-item[data-idx="${this._focusedIdx}"]`);
        if (el) el.focus();
      } else if (this._focusTrigger) {
        this._focusTrigger = false;
        const t = this.querySelector('[data-action="toggle"]');
        if (t) t.focus();
      }

      // Toggle
      this.delegate('click', '[data-action="toggle"]', () => {
        if (this.disabled) return;
        if (this._open) this._close(false);
        else this._openMenu(false);
      });

      // Trigger keyboard: open and focus the first item.
      const trigger = this.querySelector('[data-action="toggle"]');
      if (trigger) {
        this.listen(trigger, 'keydown', (e) => {
          if (this.disabled) return;
          if ((e.key === 'Enter' || e.key === ' ') && this._open) {
            e.preventDefault();
            this._close(true);
          } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._openMenu(true);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._openMenu(true);
            this._focusedIdx = this._last(this._getFiltered());
          } else if (e.key === 'Escape' && this._open) {
            // Close only the menu, not an enclosing modal or drawer.
            e.preventDefault();
            e.stopPropagation();
            this._close(true);
          }
        });
      }

      // Menu keyboard (items hold DOM focus).
      const menu = this.querySelector('.lex-ddbtn-dropdown');
      if (menu) {
        this.listen(menu, 'keydown', (e) => {
          if (!e.target || !e.target.classList || !e.target.classList.contains('lex-ddbtn-item')) return;
          const opts = this._getFiltered();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._focusedIdx = this._focusedIdx < 0 ? this._first(opts) : this._step(opts, this._focusedIdx, 1);
            this._focusItems = true;
            this._scheduleUpdate();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._focusedIdx = this._focusedIdx < 0 ? this._last(opts) : this._step(opts, this._focusedIdx, -1);
            this._focusItems = true;
            this._scheduleUpdate();
          } else if (e.key === 'Home') {
            e.preventDefault();
            this._focusedIdx = this._first(opts);
            this._focusItems = true;
            this._scheduleUpdate();
          } else if (e.key === 'End') {
            e.preventDefault();
            this._focusedIdx = this._last(opts);
            this._focusItems = true;
            this._scheduleUpdate();
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.target.click();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this._close(true);
          } else if (e.key === 'Tab') {
            this._close(false);
          }
        });
      }

      // Item click
      this.delegate('click', '.lex-ddbtn-item', (e, target) => {
        if (target.dataset.disabled === 'true') {
          e.preventDefault();
          return;
        }
        const val = target.dataset.value;
        const filtered = this._getFiltered();
        const idx = Number(target.dataset.idx);
        let item = Number.isInteger(idx) ? filtered[idx] : undefined;
        if (!item || isDivider(item)) {
          item = (this.options || []).find(o => o && !isDivider(o) && String(o.value) === val);
        }
        const returnFocus = this._focusItems;
        this._close(returnFocus);
        this.emit('lex-select', { value: val, label: item ? item.label : val, item });
      });

      // Search
      const searchInput = this.querySelector('.lex-ddbtn-search input');
      if (searchInput) {
        this.listen(searchInput, 'input', (e) => {
          this._searchTerm = e.target.value;
          this._focusedIdx = -1;
          this._scheduleUpdate();
          queueMicrotask(() => {
            const si = this.querySelector('.lex-ddbtn-search input');
            if (si) { si.focus(); si.value = this._searchTerm; }
          });
        });

        this.listen(searchInput, 'keydown', (e) => {
          const opts = this._getFiltered();
          if (e.key === 'ArrowDown') { e.preventDefault(); this._focusedIdx = this._focusedIdx < 0 ? this._first(opts) : this._step(opts, this._focusedIdx, 1); this._scheduleUpdate(); queueMicrotask(() => { const si = this.querySelector('.lex-ddbtn-search input'); if (si) si.focus(); }); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); this._focusedIdx = this._focusedIdx < 0 ? this._first(opts) : this._step(opts, this._focusedIdx, -1); this._scheduleUpdate(); queueMicrotask(() => { const si = this.querySelector('.lex-ddbtn-search input'); if (si) si.focus(); }); }
          else if (e.key === 'Enter' && this._focusedIdx >= 0) { e.preventDefault(); const el = this.querySelector(`[data-idx="${this._focusedIdx}"]`); if (el) el.click(); }
          else if (e.key === 'Escape') { e.preventDefault(); this._close(true); }
        });
      }

      // Close on outside click
      if (this._open) {
        let active = true;
        const closeHandler = (e) => {
          if (!this.contains(e.target)) {
            document.removeEventListener('mousedown', closeHandler);
            this._close(false);
          }
        };
        setTimeout(() => { if (active) document.addEventListener('mousedown', closeHandler); }, 0);
        this._eventCleanups.push(() => {
          active = false;
          document.removeEventListener('mousedown', closeHandler);
        });
      }
    }
  }

  defineLex('lex-dropdown-btn', LexDropdownBtn);
})();

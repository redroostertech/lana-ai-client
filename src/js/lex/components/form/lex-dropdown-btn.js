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
     floating       render the open menu in a body-level layer (position: fixed)
                    so a card, table, drawer or modal with overflow hidden/auto
                    cannot clip it. Opens below the trigger, flips above when
                    there is no room, follows scroll/resize, stacks above
                    lex-modal/lex-drawer. Opt-in: without it the menu stays an
                    absolutely positioned child of the element.
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

   Lex.Menu.openAt(anchor, items, opts) (end of this file) opens the same kind
   of floating menu at any DOMRect (a text caret, a toolbar button) with the
   keyboard driven by the host; see LEX-COMPONENT-RULES.md.
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

      /* floating: the open menu lives in a body-level layer */
      .lex-ddbtn-dropdown.lex-ddbtn-dropdown--floating {
        position: fixed;
        top: 0;
        left: 0;
        right: auto;
        z-index: var(--lex-z-floating, 2000);
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
        align:       { type: String, default: 'start' }, // start | end
        floating:    { type: Boolean, default: false }   // body-level menu layer
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
        html += `<span class="lex-ddbtn-label">${this.escapeHtml(this.buttonLabel)}</span>`;
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
      if (this._layer) {
        // A floating menu cannot outlive its trigger.
        this._open = false;
        this._focusedIdx = -1;
        this._removeLayer();
      }
    }

    // Menu parts: inside the element, or in the floating layer while open.
    _q(selector) {
      return this.querySelector(selector) || (this._layer ? this._layer.querySelector(selector) : null);
    }

    _inMenu(node) {
      return !!node && (this.contains(node) || (!!this._layer && this._layer.contains(node)));
    }

    // floating: move the freshly rendered menu into a body-level layer and
    // place it at the trigger; remove the layer once the menu closes.
    _syncFloating() {
      if (!this.floating || !this._open || !this.isConnected) {
        this._removeLayer();
        return;
      }
      const menu = this.querySelector('.lex-ddbtn-dropdown');
      if (!menu) return;
      if (!this._layer) {
        this._layer = document.createElement('div');
        this._layer.className = 'lex-ddbtn-layer';
        this._layer.setAttribute('data-lex-floating', 'lex-dropdown-btn');
        document.body.appendChild(this._layer);
      }
      while (this._layer.firstChild) this._layer.removeChild(this._layer.firstChild);
      menu.classList.add('lex-ddbtn-dropdown--floating');
      this._layer.appendChild(menu);
      this._placeFloating();
      if (!this._stopTracking) {
        // Re-place on scroll (capture: any scrolling ancestor) and resize.
        // Each re-render replaces the menu node, so look it up on every move.
        const onMove = () => this._placeFloating();
        window.addEventListener('scroll', onMove, true);
        window.addEventListener('resize', onMove);
        this._stopTracking = () => {
          window.removeEventListener('scroll', onMove, true);
          window.removeEventListener('resize', onMove);
        };
      }
    }

    _placeFloating() {
      const menu = this._layer && this._layer.querySelector('.lex-ddbtn-dropdown');
      const trigger = this.querySelector('[data-action="toggle"]');
      if (!menu || !trigger) return null;
      return Lex.Floating.place(menu, trigger.getBoundingClientRect(), { align: this.align === 'end' ? 'end' : 'start', gap: 4 });
    }

    _removeLayer() {
      if (this._stopTracking) {
        this._stopTracking();
        this._stopTracking = null;
      }
      if (this._layer) {
        if (this._layer.parentNode) this._layer.parentNode.removeChild(this._layer);
        this._layer = null;
      }
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
          const si = this._q('.lex-ddbtn-search input');
          if (si) si.focus();
        });
      }
    }

    updated() {
      this._syncFloating();

      // Keyboard focus follows re-renders (the markup is replaced each update).
      if (this._open && this._focusItems && this._focusedIdx >= 0) {
        const el = this._q(`.lex-ddbtn-item[data-idx="${this._focusedIdx}"]`);
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
      const menu = this._q('.lex-ddbtn-dropdown');
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
            // A floating menu sits at the end of <body>: continue the tab
            // order from the trigger, not from there.
            if (this._layer) {
              const t = this.querySelector('[data-action="toggle"]');
              if (t) t.focus();
            }
            this._close(false);
          }
        });
      }

      // Item click (listened on the menu, which may sit in the floating layer)
      if (menu) this.listen(menu, 'click', (e) => {
        const target = e.target && e.target.closest ? e.target.closest('.lex-ddbtn-item') : null;
        if (!target || !menu.contains(target)) return;
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
      const searchInput = this._q('.lex-ddbtn-search input');
      if (searchInput) {
        this.listen(searchInput, 'input', (e) => {
          this._searchTerm = e.target.value;
          this._focusedIdx = -1;
          this._scheduleUpdate();
          queueMicrotask(() => {
            const si = this._q('.lex-ddbtn-search input');
            if (si) { si.focus(); si.value = this._searchTerm; }
          });
        });

        this.listen(searchInput, 'keydown', (e) => {
          const opts = this._getFiltered();
          if (e.key === 'ArrowDown') { e.preventDefault(); this._focusedIdx = this._focusedIdx < 0 ? this._first(opts) : this._step(opts, this._focusedIdx, 1); this._scheduleUpdate(); queueMicrotask(() => { const si = this._q('.lex-ddbtn-search input'); if (si) si.focus(); }); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); this._focusedIdx = this._focusedIdx < 0 ? this._first(opts) : this._step(opts, this._focusedIdx, -1); this._scheduleUpdate(); queueMicrotask(() => { const si = this._q('.lex-ddbtn-search input'); if (si) si.focus(); }); }
          else if (e.key === 'Enter' && this._focusedIdx >= 0) { e.preventDefault(); const el = this._q(`.lex-ddbtn-item[data-idx="${this._focusedIdx}"]`); if (el) el.click(); }
          else if (e.key === 'Escape') { e.preventDefault(); this._close(true); }
        });
      }

      // Close on outside click
      if (this._open) {
        let active = true;
        const closeHandler = (e) => {
          if (!this._inMenu(e.target)) {
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

  // =========================================================================
  // Lex.Menu.openAt(anchor, items, opts) — a floating menu at any rect
  // =========================================================================
  //
  // For menus with no trigger button of their own: autocomplete at a text
  // caret, a picker under a toolbar button. The host keeps DOM focus (e.g. a
  // contenteditable) and forwards keys with controller.handleKey(event).
  //
  //   const menu = Lex.Menu.openAt(caretRect, items, {
  //     heading: 'Template variables', hint: '#{{entity:property_key}}',
  //     onSelect(item, index) { ... }, onClose(reason) { ... }
  //   });
  //   editor.addEventListener('keydown', (e) => { if (menu.handleKey(e)) e.preventDefault(); });
  //   menu.update(nextItems);      // filtering as the user types
  //   menu.close();
  //
  // anchor: a DOMRect-like box, or a function returning one (re-read on
  // scroll/resize, so the menu follows a caret inside a scrolling page).
  // items: { value, label, description?, meta?, icon?, avatar?, disabled?,
  //          data? } or { divider: true }. meta renders as a monospace line
  //          under the label; avatar is short text (initials) in a circle.
  // opts: align start | center | end (start), placement bottom | top, gap (4),
  //   margin (8), width (CSS length), id, className, ariaLabel, heading, hint,
  //   onBack() (adds a back button to the header), search: { value,
  //   placeholder, onInput(value) } (adds a search box), emptyText,
  //   activeIndex (0), tabSelects (Tab picks like Enter), owner (element that
  //   gets aria-expanded / aria-controls / aria-activedescendant),
  //   ignoreOutside(target) -> true to keep the menu open for that mousedown,
  //   onSelect(item, index), onActiveChange(index), onClose(reason).
  // The menu closes on Escape (capture phase: an enclosing lex-modal stays
  // open), on a mousedown outside it, or with close(); onClose gets 'escape',
  // 'outside' or 'host'. Selecting does NOT close the menu by itself: the
  // host decides (drill into a submenu with update(), or close after
  // inserting). A mousedown inside the menu (except its search box) keeps
  // focus where it was, so a contenteditable host keeps its caret.

  let menuStylesInjected = false;
  let menuIdCounter = 0;

  function injectMenuStyles() {
    if (menuStylesInjected) return;
    menuStylesInjected = true;
    const style = document.createElement('style');
    style.id = 'lex-menu-styles';
    style.textContent = `
      .lex-menu {
        position: fixed;
        top: 0;
        left: 0;
        z-index: var(--lex-z-floating, 2000);
        display: flex;
        flex-direction: column;
        min-width: 220px;
        max-width: min(360px, calc(100vw - 24px));
        max-height: min(340px, calc(100vh - 24px));
        box-sizing: border-box;
        overflow: hidden;
        background: var(--lex-select-dropdown-bg, var(--lex-bg-primary));
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-input-radius, 8px);
        box-shadow: var(--lex-shadow-lg);
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-primary);
      }
      .lex-menu-head {
        display: grid;
        gap: 8px;
        padding: 10px;
        border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));
      }
      .lex-menu-title { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
      .lex-menu-title > span { display: grid; gap: 4px; min-width: 0; }
      .lex-menu-title strong { font-weight: var(--lex-weight-semibold, 600); line-height: 1.2; }
      .lex-menu code,
      .lex-menu-item-meta {
        font-family: var(--lex-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
        font-size: 11px;
        line-height: 1.3;
        color: var(--lex-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lex-menu-back {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-md, 6px);
        background: var(--lex-bg-secondary, transparent);
        color: var(--lex-text-primary);
        cursor: pointer;
      }
      .lex-menu-back svg { width: 16px; height: 16px; }
      .lex-menu-back:hover,
      .lex-menu-back:focus-visible { background: var(--lex-select-option-hover, var(--lex-bg-secondary)); outline: none; }
      .lex-menu-search {
        width: 100%;
        box-sizing: border-box;
        height: 32px;
        padding: 0 9px;
        font: inherit;
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-sm, 6px);
        background: var(--lex-bg-primary);
        color: var(--lex-text-primary);
        outline: none;
      }
      .lex-menu-search:focus { box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500)); }
      .lex-menu-options { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px; }
      .lex-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 8px;
        border-radius: var(--lex-radius-sm, 6px);
        cursor: pointer;
      }
      .lex-menu-item:hover,
      .lex-menu-item--active { background: var(--lex-select-option-hover, var(--lex-bg-secondary)); }
      .lex-menu-item--disabled { opacity: 0.45; cursor: not-allowed; }
      .lex-menu-item-text { display: grid; gap: 2px; min-width: 0; }
      .lex-menu-item-label { font-weight: var(--lex-weight-medium, 500); }
      .lex-menu-item-desc { font-size: var(--lex-form-help-size, 0.6875rem); color: var(--lex-text-tertiary); }
      .lex-menu-item-icon, .lex-menu-item-icon svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--lex-text-tertiary); }
      .lex-menu-avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        border-radius: 999px;
        background: var(--lex-bg-secondary, #f3f4f6);
        color: var(--lex-text-secondary);
        font-size: 11px;
        font-weight: 700;
      }
      .lex-menu-separator { height: 1px; margin: 4px 0; background: var(--lex-border-subtle, rgba(0,0,0,0.06)); }
      .lex-menu-empty { padding: 10px; color: var(--lex-text-tertiary); }
    `;
    document.head.appendChild(style);
  }

  const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';

  function esc(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function openAt(anchor, items, options) {
    injectMenuStyles();
    let opts = Object.assign({}, options || {});
    let list = Array.isArray(items) ? items.filter((i) => i !== null && i !== undefined) : [];
    let active = -1;
    let isOpen = true;
    const id = opts.id || ('lex-menu-' + (++menuIdCounter));
    const getRect = typeof anchor === 'function' ? anchor : () => anchor;

    const el = document.createElement('div');
    el.className = 'lex-menu' + (opts.className ? ' ' + opts.className : '');
    el.id = id;
    el.setAttribute('data-lex-floating', 'lex-menu');
    const head = document.createElement('div');
    head.className = 'lex-menu-head';
    const title = document.createElement('div');
    title.className = 'lex-menu-title';
    head.appendChild(title);
    let search = null;
    const optionsEl = document.createElement('div');
    optionsEl.className = 'lex-menu-options';
    optionsEl.setAttribute('role', 'listbox');
    optionsEl.id = id + '-list';
    el.appendChild(head);
    el.appendChild(optionsEl);
    document.body.appendChild(el);

    function placementOpts() {
      return { align: opts.align || 'start', placement: opts.placement, gap: typeof opts.gap === 'number' ? opts.gap : 4, margin: opts.margin };
    }

    function place() {
      const rect = getRect();
      if (rect) Lex.Floating.place(el, rect, placementOpts());
    }

    function firstActionable(from, dir) {
      let idx = from;
      for (let n = 0; n < list.length; n++) {
        idx = (idx + dir + list.length) % list.length;
        if (isActionable(list[idx])) return idx;
      }
      return -1;
    }

    function clampActive(idx) {
      if (!list.some(isActionable)) return -1;
      let i = Number.isInteger(idx) ? idx : 0;
      i = Math.max(0, Math.min(i, list.length - 1));
      return isActionable(list[i]) ? i : firstActionable(i, 1);
    }

    function syncOwner() {
      const owner = opts.owner;
      if (!owner || !owner.setAttribute) return;
      if (!isOpen) {
        owner.removeAttribute('aria-activedescendant');
        owner.setAttribute('aria-expanded', 'false');
        return;
      }
      owner.setAttribute('aria-expanded', 'true');
      owner.setAttribute('aria-controls', optionsEl.id);
      if (active >= 0) owner.setAttribute('aria-activedescendant', id + '-opt-' + active);
      else owner.removeAttribute('aria-activedescendant');
    }

    function renderHead() {
      const showTitle = !!(opts.heading || opts.hint || opts.onBack);
      let html = '';
      if (opts.onBack) html += '<button type="button" class="lex-menu-back" data-lex-menu-back aria-label="Back" title="Back">' + BACK_SVG + '</button>';
      if (opts.heading || opts.hint) {
        html += '<span>' + (opts.heading ? '<strong>' + esc(opts.heading) + '</strong>' : '') + (opts.hint ? '<code>' + esc(opts.hint) + '</code>' : '') + '</span>';
      }
      title.innerHTML = html;
      title.style.display = showTitle ? '' : 'none';
      if (opts.search) {
        if (!search) {
          search = document.createElement('input');
          search.type = 'search';
          search.className = 'lex-menu-search';
          search.setAttribute('autocomplete', 'off');
          search.setAttribute('aria-controls', optionsEl.id);
          search.addEventListener('input', () => {
            if (opts.search && typeof opts.search.onInput === 'function') opts.search.onInput(search.value);
          });
          search.addEventListener('keydown', (e) => {
            if (api.handleKey(e)) { e.preventDefault(); e.stopPropagation(); }
          });
          head.appendChild(search);
        }
        search.placeholder = opts.search.placeholder || 'Search...';
        const value = opts.search.value == null ? '' : String(opts.search.value);
        if (search.value !== value) search.value = value;
      } else if (search) {
        search.remove();
        search = null;
      }
      head.style.display = showTitle || opts.search ? '' : 'none';
      el.setAttribute('aria-label', opts.ariaLabel || opts.heading || 'Menu');
      optionsEl.setAttribute('aria-label', opts.ariaLabel || opts.heading || 'Menu');
    }

    function renderItems() {
      if (!list.length) {
        optionsEl.innerHTML = '<div class="lex-menu-empty">' + esc(opts.emptyText || 'No matches') + '</div>';
        return;
      }
      optionsEl.innerHTML = list.map((item, idx) => {
        if (isDivider(item)) return '<div class="lex-menu-separator" role="separator"></div>';
        let cls = 'lex-menu-item';
        if (idx === active) cls += ' lex-menu-item--active';
        if (item.disabled) cls += ' lex-menu-item--disabled';
        const label = item.label == null ? (item.value == null ? '' : item.value) : item.label;
        let html = '<div class="' + cls + '" role="option" id="' + id + '-opt-' + idx + '" data-idx="' + idx + '" aria-selected="' + (idx === active ? 'true' : 'false') + '"' + (item.disabled ? ' aria-disabled="true"' : '') + '>';
        if (item.avatar) html += '<span class="lex-menu-avatar" aria-hidden="true">' + esc(item.avatar) + '</span>';
        else if (item.icon) html += '<span class="lex-menu-item-icon" aria-hidden="true">' + getIcon(item.icon) + '</span>';
        html += '<span class="lex-menu-item-text"><span class="lex-menu-item-label">' + esc(label) + '</span>';
        if (item.meta) html += '<span class="lex-menu-item-meta">' + esc(item.meta) + '</span>';
        if (item.description) html += '<span class="lex-menu-item-desc">' + esc(item.description) + '</span>';
        html += '</span></div>';
        return html;
      }).join('');
    }

    function render() {
      el.style.width = opts.width || '';
      renderHead();
      renderItems();
      syncOwner();
      place();
    }

    function setActive(idx) {
      const next = clampActive(idx);
      if (next === active) return;
      const prev = optionsEl.querySelector('.lex-menu-item--active');
      if (prev) { prev.classList.remove('lex-menu-item--active'); prev.setAttribute('aria-selected', 'false'); }
      active = next;
      const row = active >= 0 ? optionsEl.querySelector('[data-idx="' + active + '"]') : null;
      if (row) {
        row.classList.add('lex-menu-item--active');
        row.setAttribute('aria-selected', 'true');
        if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      }
      syncOwner();
      if (typeof opts.onActiveChange === 'function') opts.onActiveChange(active);
    }

    function select(idx) {
      const i = Number.isInteger(idx) ? idx : active;
      const item = list[i];
      if (!isOpen || !isActionable(item)) return false;
      if (typeof opts.onSelect === 'function') opts.onSelect(item, i);
      return true;
    }

    // Escape anywhere closes the menu first (capture phase on window, as in
    // lex-dropdown-btn), so an enclosing modal or drawer stays open.
    const onEscape = (e) => {
      if (e.key !== 'Escape' || !isOpen) return;
      e.preventDefault();
      e.stopPropagation();
      close('escape');
    };
    const onOutside = (e) => {
      const target = e.target;
      if (el.contains(target)) {
        // Keep focus (and the host's caret) where it is, except for the search box.
        if (target !== search) e.preventDefault();
        return;
      }
      if (typeof opts.ignoreOutside === 'function' && opts.ignoreOutside(target)) return;
      close('outside');
    };
    const onClick = (e) => {
      if (e.target.closest && e.target.closest('[data-lex-menu-back]')) {
        if (typeof opts.onBack === 'function') opts.onBack();
        return;
      }
      const row = e.target.closest ? e.target.closest('.lex-menu-item') : null;
      if (!row || !optionsEl.contains(row)) return;
      const idx = Number(row.dataset.idx);
      if (!isActionable(list[idx])) return;
      active = idx;
      select(idx);
    };
    el.addEventListener('click', onClick);
    window.addEventListener('keydown', onEscape, true);
    document.addEventListener('mousedown', onOutside, true);
    const stopTracking = Lex.Floating.track(el, () => getRect(), placementOpts());

    function close(reason) {
      if (!isOpen) return;
      isOpen = false;
      window.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('mousedown', onOutside, true);
      el.removeEventListener('click', onClick);
      stopTracking();
      syncOwner();
      if (el.parentNode) el.parentNode.removeChild(el);
      if (typeof opts.onClose === 'function') opts.onClose(reason || 'host');
    }

    const api = {
      element: el,
      get open() { return isOpen; },
      get activeIndex() { return active; },
      get items() { return list.slice(); },
      // New items and/or options (merged). activeIndex in opts resets the
      // highlight; otherwise it stays on the same index (clamped).
      update(nextItems, nextOpts) {
        if (!isOpen) return api;
        if (Array.isArray(nextItems)) list = nextItems.filter((i) => i !== null && i !== undefined);
        if (nextOpts) opts = Object.assign({}, opts, nextOpts);
        active = clampActive(nextOpts && Number.isInteger(nextOpts.activeIndex) ? nextOpts.activeIndex : active);
        render();
        return api;
      },
      reposition() { if (isOpen) place(); return api; },
      setActive(idx) { setActive(idx); return api; },
      // Move the highlight by delta (wraps; skips dividers and disabled items).
      move(delta) {
        if (!list.some(isActionable)) return api;
        setActive(active < 0 ? firstActionable(delta > 0 ? -1 : 0, delta > 0 ? 1 : -1) : firstActionable(active, delta > 0 ? 1 : -1));
        return api;
      },
      select,
      // Host keyboard: returns true when the key was used (caller calls
      // preventDefault). ArrowUp/ArrowDown/Home/End move, Enter (and Tab
      // with tabSelects) selects, Escape closes.
      handleKey(e) {
        if (!isOpen || !e) return false;
        if (e.key === 'Escape') { close('escape'); return true; }
        if (!list.some(isActionable)) return false;
        if (e.key === 'ArrowDown') { api.move(1); return true; }
        if (e.key === 'ArrowUp') { api.move(-1); return true; }
        if (e.key === 'Home' && e.target === search) return false;
        if (e.key === 'End' && e.target === search) return false;
        if (e.key === 'Home') { setActive(firstActionable(-1, 1)); return true; }
        if (e.key === 'End') { setActive(firstActionable(0, -1)); return true; }
        if (e.key === 'Enter' || (e.key === 'Tab' && opts.tabSelects)) return select();
        return false;
      },
      focusSearch() { if (search) search.focus(); return api; },
      close
    };

    active = clampActive(Number.isInteger(opts.activeIndex) ? opts.activeIndex : 0);
    render();
    return api;
  }

  window.Lex.Menu = Object.assign(window.Lex.Menu || {}, { openAt });
})();

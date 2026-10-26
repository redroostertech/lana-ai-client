/* Lex UI — Segmented Control Component
   Horizontal segments with animated sliding selection indicator.

   Usage:
     <lex-segmented value="medium"
       options='[{"value":"low","label":"Low"},{"value":"medium","label":"Medium"},{"value":"high","label":"High"}]'>
     </lex-segmented>

     <lex-segmented size="sm"
       options='[{"value":"grid","label":"Grid","icon":"grid"},{"value":"list","label":"List","icon":"list"}]'>
     </lex-segmented>

     <lex-segmented collapsible options='[...]'></lex-segmented>

   Sizes: sm | md | lg
   Events: lex-change { name, value }

   collapsible: when the segments do not fit the element's width, show a
   <lex-select> with the same options instead. The element is sized by its
   layout, not its content, so the page must give it a width (block, or a
   flex item with a basis). Needs lex-select.js on the page; without it the
   segments stay and scroll horizontally.
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField, Icons } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-segmented-styles';
    style.textContent = `
      lex-segmented {
        display: block;
      }

      .lex-seg-container {
        display: inline-flex;
        align-items: center;
        position: relative;
        background: var(--lex-bg-tertiary);
        border-radius: var(--lex-radius-lg);
        padding: 3px;
        gap: 2px;
      }

      /* ── Sliding indicator ─────────────────────────────── */

      .lex-seg-indicator {
        position: absolute;
        top: 3px;
        bottom: 3px;
        left: 0;
        border-radius: calc(var(--lex-radius-lg) - 2px);
        background: var(--lex-bg-primary);
        box-shadow: var(--lex-shadow-sm);
        transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 0;
      }

      /* ── Segments ──────────────────────────────────────── */

      .lex-seg-item {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        cursor: pointer;
        user-select: none;
        font-family: inherit;
        font-weight: var(--lex-weight-regular, 400);
        letter-spacing: 0.01em;
        color: var(--lex-text-secondary);
        border: none;
        background: transparent;
        border-radius: calc(var(--lex-radius-lg) - 2px);
        white-space: nowrap;
        transition: color 0.2s ease;
        outline: none;
      }

      .lex-seg-item:hover {
        color: var(--lex-text-primary);
      }

      .lex-seg-item--selected {
        color: var(--lex-text-primary);
        font-weight: var(--lex-weight-medium, 500);
      }

      .lex-seg-item:focus-visible {
        box-shadow: var(--lex-focus-ring, 0 0 0 3px rgba(89, 82, 70, 0.3));
      }

      .lex-seg-item svg {
        flex-shrink: 0;
      }

      /* ── Size variants ─────────────────────────────────── */

      .lex-seg-container--sm .lex-seg-item { padding: 4px 12px; font-size: var(--lex-form-font-size-sm, 0.75rem); }
      .lex-seg-container--sm .lex-seg-item svg { width: 14px; height: 14px; }

      .lex-seg-container--md .lex-seg-item { padding: 6px 16px; font-size: var(--lex-form-font-size, 0.8125rem); }
      .lex-seg-container--md .lex-seg-item svg { width: 16px; height: 16px; }

      .lex-seg-container--lg .lex-seg-item { padding: 8px 20px; font-size: var(--lex-form-font-size-lg, 0.875rem); }
      .lex-seg-container--lg .lex-seg-item svg { width: 18px; height: 18px; }

      /* ── Dark variant ──────────────────────────────────── */

      .lex-seg-container--dark {
        background: var(--lex-color-gray-800);
      }

      .lex-seg-container--dark .lex-seg-indicator {
        background: var(--lex-color-gray-700);
        box-shadow: none;
      }

      .lex-seg-container--dark .lex-seg-item {
        color: var(--lex-color-gray-400);
      }

      .lex-seg-container--dark .lex-seg-item:hover {
        color: var(--lex-color-gray-200);
      }

      .lex-seg-container--dark .lex-seg-item--selected {
        color: var(--lex-color-white);
      }

      /* ── Collapsible ───────────────────────────────────── */

      lex-segmented[collapsible] {
        container-type: inline-size;
        min-width: 0;
      }

      lex-segmented[collapsible] .lex-seg-container {
        max-width: 100%;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .lex-seg-select,
      lex-segmented[data-compact] .lex-seg-container {
        display: none;
      }

      lex-segmented[data-compact] .lex-seg-select {
        display: block;
      }

      /* The placeholder is a real option here (e.g. "All"), not a prompt */
      .lex-seg-select .lex-select-placeholder {
        color: var(--lex-text-primary);
      }
    `;
    document.head.appendChild(style);
  }

  function getIcon(name) {
    if (Icons && Icons.has && Icons.has(name)) {
      return Icons[name].small.toString();
    }
    return '';
  }

  class LexSegmented extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        options:     { type: Array, default: [] },
        theme:       { type: String, default: 'light' },
        collapsible: { type: Boolean, default: false }
      };
    }

    render() {
      injectStyles();

      const options = this.options || [];
      const sz = this.size || 'md';
      const darkCls = this.theme === 'dark' ? ' lex-seg-container--dark' : '';

      let html = `<div class="lex-seg-container lex-seg-container--${sz}${darkCls}">`;
      html += `<div class="lex-seg-indicator"></div>`;

      options.forEach((opt) => {
        const selectedCls = this.value === opt.value ? ' lex-seg-item--selected' : '';
        const iconHtml = opt.icon ? getIcon(opt.icon) : '';
        html += `<button type="button" class="lex-seg-item${selectedCls}" data-value="${this.escapeHtml(opt.value)}">`;
        if (iconHtml) html += iconHtml;
        html += this.escapeHtml(opt.label);
        html += `</button>`;
      });

      html += `</div>`;

      if (this.collapsible) {
        const selectOptions = options.map(opt => ({ value: opt.value, label: opt.label }));
        // lex-select treats "" as no selection, so an option like
        // {value:"", label:"All"} shows through the placeholder instead
        const emptyOpt = options.find(opt => opt.value === '');
        const placeholder = emptyOpt ? emptyOpt.label : 'Select...';
        html += `<lex-select class="lex-seg-select" variant="outlined" size="${sz === 'lg' ? 'md' : sz}"`
          + ` placeholder="${this.escapeHtml(placeholder)}"`
          + ` options="${this.escapeHtml(JSON.stringify(selectOptions))}"`
          + ` value="${this.escapeHtml(this.value || '')}"></lex-select>`;
      }

      if (this.label || this.error || this.help) {
        return this._renderFieldWrapper(html);
      }
      return html;
    }

    updated() {
      // Position the sliding indicator
      this._positionIndicator();

      // Click handler
      this.delegate('click', '.lex-seg-item', (e, target) => {
        const val = target.dataset.value;
        if (val !== this.value) {
          this._props.value = val;
          this._emitChange(val);
          // Update selected classes without full re-render for smooth animation
          this.querySelectorAll('.lex-seg-item').forEach(el => {
            el.classList.toggle('lex-seg-item--selected', el.dataset.value === val);
          });
          this._positionIndicator();
          const select = this.querySelector('.lex-seg-select');
          if (select) select.value = val;
        }
      });

      if (this.collapsible) {
        const select = this.querySelector('.lex-seg-select');
        if (select) {
          select.addEventListener('lex-change', (e) => {
            // Re-emit from the host so pages only see one lex-change
            e.stopPropagation();
            const val = select.value;
            if (val === this.value) return;
            this._props.value = val;
            this.querySelectorAll('.lex-seg-item').forEach(el => {
              el.classList.toggle('lex-seg-item--selected', el.dataset.value === val);
            });
            this._emitChange(val);
          });
        }
        this._checkFit();
      }
    }

    connected() {
      super.connected();
      if (!this.collapsible || this._resizeObserver) return;
      this._resizeObserver = new ResizeObserver(() => this._checkFit());
      this._resizeObserver.observe(this);
      // lex-select may load after this element; re-check once it exists
      customElements.whenDefined('lex-select').then(() => this._checkFit());
    }

    disconnected() {
      super.disconnected();
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
    }

    /**
     * Collapsible mode: show the dropdown when the segments are wider than
     * the element. The element's width does not depend on its content
     * (inline-size containment), so the segments can be measured in place
     * without a feedback loop. Runs synchronously, so there is no flicker.
     */
    _checkFit() {
      if (!this.collapsible || !customElements.get('lex-select')) return;
      const container = this.querySelector('.lex-seg-container');
      if (!container) return;
      this.removeAttribute('data-compact');
      const fits = container.scrollWidth <= this.clientWidth;
      if (!fits) {
        this.setAttribute('data-compact', '');
      } else {
        this._positionIndicator();
      }
    }

    _positionIndicator() {
      const indicator = this.querySelector('.lex-seg-indicator');
      const selected = this.querySelector('.lex-seg-item--selected');
      if (!indicator || !selected) {
        if (indicator) indicator.style.opacity = '0';
        return;
      }

      const container = this.querySelector('.lex-seg-container');
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();

      indicator.style.opacity = '1';
      indicator.style.left = (selectedRect.left - containerRect.left) + 'px';
      indicator.style.width = selectedRect.width + 'px';
    }
  }

  defineLex('lex-segmented', LexSegmented);
})();

/* Lex UI — Card Component
   Content container with heading, subtitle, action icons, and footer.

   Usage:
     <lex-card heading="Title" subtitle="Description">...content...</lex-card>
     <lex-card variant="elevated" bg="dark">...dark card...</lex-card>

     <!-- With action icons (max 3 visible, overflow menu for more) -->
     <lex-card heading="Matter" actions='[{"icon":"edit","label":"Edit"},{"icon":"delete","label":"Delete"}]'>
       ...body...
     </lex-card>

     <!-- With footer -->
     <lex-card heading="Title">
       <p>Body content here</p>
       <div data-slot="footer">
         <lex-btn size="sm" variant="primary">Save</lex-btn>
         <lex-btn size="sm" variant="ghost">Cancel</lex-btn>
       </div>
     </lex-card>

   Variants: default | elevated | outlined | flat
   Backgrounds: light (default) | dark
   Actions: Array of { icon, label } — emits "card-action" event
   Footer: Child elements with data-slot="footer" render in a separated footer area

   Built-in icons: edit, delete, more, settings, download, share, link,
                   copy, pin, star, close, archive, eye, refresh
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  // -----------------------------------------------------------------------
  // Built-in icon paths (Feather-style, stroke-based, viewBox 0 0 24 24)
  // -----------------------------------------------------------------------

  const ICONS = {
    edit:     '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    delete:   '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
    more:     '<circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    share:    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    link:     '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
    copy:     '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    pin:      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
    star:     '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    close:    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    archive:  '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
    eye:      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    refresh:  '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>'
  };

  // -----------------------------------------------------------------------
  // Inject styles once
  // -----------------------------------------------------------------------

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-card-styles';
    style.textContent = `
      .lex-card-action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--lex-radius-md);
        border: none;
        background: none;
        cursor: pointer;
        padding: 0;
        color: var(--_card-action-color);
        transition: background 0.15s, color 0.15s;
        position: relative;
      }
      .lex-card-action-btn:hover {
        background: var(--_card-action-hover-bg);
        color: var(--_card-action-hover-color);
      }
      .lex-card-action-btn svg {
        width: 16px;
        height: 16px;
      }

      /* Overflow dropdown */
      .lex-card-overflow {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        min-width: 200px;
        border-radius: 0;
        border: 1px solid var(--_card-border-color);
        box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        overflow: hidden;
        z-index: var(--lex-z-dropdown, 10);
        opacity: 0;
        transform: translateY(-4px);
        pointer-events: none;
        transition: opacity 0.15s, transform 0.15s;
      }
      .lex-card-overflow.lex-card-overflow-open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .lex-card-overflow-item {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        width: 100%;
        padding: 0.625rem 0.875rem;
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-regular, 400);
        letter-spacing: 0.02em;
        border: none;
        border-bottom: 1px solid var(--_card-border-color);
        background: var(--_card-overflow-bg);
        color: var(--_card-overflow-color);
        cursor: pointer;
        text-align: left;
        overflow: hidden;
        transition: background 0.3s ease, transform 0.3s ease;
      }
      .lex-card-overflow-item:last-child {
        border-bottom: none;
      }
      .lex-card-overflow-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 2px;
        height: 0%;
        background: var(--_card-action-hover-color);
        transition: height 0.3s ease;
      }
      .lex-card-overflow-item:hover {
        background: var(--_card-overflow-hover);
        transform: translateX(4px);
      }
      .lex-card-overflow-item:hover::before {
        height: 40%;
      }
      .lex-card-overflow-item svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }
      .lex-card-overflow-item .lex-card-item-main {
        flex: 1;
        min-width: 0;
      }
      .lex-card-overflow-item .lex-card-item-label {
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-regular, 400);
        letter-spacing: 0.03em;
      }
      .lex-card-overflow-item .lex-card-item-chevron {
        width: 12px;
        height: 12px;
        opacity: 0.3;
        flex-shrink: 0;
      }

      /* Footer */
      .lex-card-footer {
        display: none;
      }
      .lex-card-footer.lex-card-footer-visible {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding-top: 1rem;
        margin-top: 1rem;
        border-top: 1px solid var(--_card-border-color);
      }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------------------------
  // Helper: build icon SVG
  // -----------------------------------------------------------------------

  function iconSvg(name) {
    const path = ICONS[name];
    if (!path) return '';
    return `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${path}</svg>`;
  }

  // -----------------------------------------------------------------------
  // LexCard
  // -----------------------------------------------------------------------

  class LexCard extends LexElement {
    static get properties() {
      return {
        heading:  { type: String },
        subtitle: { type: String },
        variant:  { type: String, default: 'default' },
        padding:  { type: String, default: 'normal' },
        bg:       { type: String, default: 'light' },
        actions:  { type: Array, default: [] }
      };
    }

    render() {
      injectStyles();

      const isDark = this.bg === 'dark';
      const actions = this.actions || [];

      const variants = {
        default:  `${isDark ? '' : 'border lex-border-subtle'} shadow-sm`,
        elevated: 'shadow-lg',
        outlined: `border-2 ${isDark ? 'border-white/10' : 'lex-border'}`,
        flat:     ''
      };

      const paddings = {
        normal:  'p-6',
        compact: 'p-4',
        none:    ''
      };

      const variantClass = variants[this.variant] || variants.default;
      const paddingClass = paddings[this.padding] || paddings.normal;

      // Theme colors
      const bgStyle = isDark
        ? `background:var(--lex-color-brand-950); color:var(--lex-color-brand-100);`
        : `background:var(--lex-bg-primary); color:var(--lex-text-primary);`;

      const headingColor = isDark ? 'color:var(--lex-color-brand-50);' : '';
      const subtitleColor = isDark ? 'color:var(--lex-color-brand-400);' : '';

      // CSS custom properties for themed action buttons
      const actionColor = isDark ? 'var(--lex-color-brand-400)' : 'var(--lex-text-tertiary)';
      const actionHoverBg = isDark ? 'rgba(255,255,255,0.08)' : 'var(--lex-bg-tertiary)';
      const actionHoverColor = isDark ? 'var(--lex-color-brand-100)' : 'var(--lex-text-primary)';
      const overflowBg = isDark ? 'var(--lex-color-brand-900)' : 'var(--lex-bg-primary)';
      const overflowItemColor = isDark ? 'var(--lex-color-brand-200)' : 'var(--lex-text-primary)';
      const overflowItemHover = isDark ? 'rgba(255,255,255,0.06)' : 'var(--lex-bg-secondary)';
      const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'var(--lex-border-subtle)';

      const cardVars = `--_card-action-color:${actionColor};--_card-action-hover-bg:${actionHoverBg};--_card-action-hover-color:${actionHoverColor};--_card-overflow-bg:${overflowBg};--_card-overflow-color:${overflowItemColor};--_card-overflow-hover:${overflowItemHover};--_card-border-color:${borderColor};`;

      // Build action buttons
      let actionsHtml = '';
      if (actions.length > 0) {
        const maxVisible = 3;
        const visibleActions = actions.length <= maxVisible ? actions : actions.slice(0, maxVisible - 1);
        const overflowActions = actions.length > maxVisible ? actions.slice(maxVisible - 1) : [];

        const actionBtns = visibleActions.map(a =>
          `<button class="lex-card-action-btn" data-action="${this.escapeHtml(a.icon || a.action || '')}" title="${this.escapeHtml(a.label || '')}">${iconSvg(a.icon || 'more')}</button>`
        ).join('');

        let overflowHtml = '';
        if (overflowActions.length > 0) {
          const chevronSvg = '<svg class="lex-card-item-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
          const overflowItems = overflowActions.map(a =>
            `<button class="lex-card-overflow-item" data-action="${this.escapeHtml(a.icon || a.action || '')}">
              <span class="lex-card-item-main">
                <span class="lex-card-item-label">${this.escapeHtml(a.label || a.icon || '')}</span>
              </span>
              ${chevronSvg}
            </button>`
          ).join('');

          overflowHtml = `
            <div style="position:relative;">
              <button class="lex-card-action-btn lex-card-overflow-trigger" title="More actions">${iconSvg('more')}</button>
              <div class="lex-card-overflow" style="background:var(--_card-overflow-bg);border:1px solid var(--_card-border-color);">
                ${overflowItems}
              </div>
            </div>
          `;
        }

        actionsHtml = `<div class="flex items-center gap-0.5" style="margin:-4px -4px 0 0;">${actionBtns}${overflowHtml}</div>`;
      }

      // Header
      const hasHeader = this.heading || actionsHtml;
      let headerHtml = '';
      if (hasHeader) {
        const titleBlock = this.heading ? `
          <div class="min-w-0 flex-1">
            <h3 class="text-lg font-semibold ${isDark ? '' : 'lex-text-primary'}" ${headingColor ? `style="${headingColor}"` : ''}>${this.escapeHtml(this.heading)}</h3>
            ${this.subtitle ? `<p class="text-sm ${isDark ? '' : 'lex-text-secondary'} mt-0.5" ${subtitleColor ? `style="${subtitleColor}"` : ''}>${this.escapeHtml(this.subtitle)}</p>` : ''}
          </div>
        ` : '<div class="flex-1"></div>';

        headerHtml = `<div class="flex items-start justify-between gap-3 mb-4">${titleBlock}${actionsHtml}</div>`;
      }

      return `
        <div class="rounded-xl ${variantClass} ${paddingClass}" style="${bgStyle}${cardVars}">
          ${headerHtml}
          <slot-content></slot-content>
          <div class="lex-card-footer"></div>
        </div>
      `;
    }

    updated() {
      // --- Move data-slot="footer" children to footer area ---
      const slotContent = this.querySelector('slot-content');
      const footerContainer = this.querySelector('.lex-card-footer');

      if (slotContent && footerContainer) {
        const footerChildren = slotContent.querySelectorAll('[data-slot="footer"]');
        if (footerChildren.length > 0) {
          footerContainer.classList.add('lex-card-footer-visible');
          for (const child of footerChildren) {
            child.style.display = '';  // Ensure visible
            footerContainer.appendChild(child);
          }
        }
      }

      // --- Wire up action icon clicks ---
      const actionBtns = this.querySelectorAll('.lex-card-action-btn:not(.lex-card-overflow-trigger)');
      for (const btn of actionBtns) {
        this.listen(btn, 'click', (e) => {
          e.stopPropagation();
          this.emit('card-action', { action: btn.dataset.action, label: btn.title });
        });
      }

      // --- Wire up overflow items ---
      const overflowItems = this.querySelectorAll('.lex-card-overflow-item');
      for (const item of overflowItems) {
        this.listen(item, 'click', (e) => {
          e.stopPropagation();
          // Close the dropdown
          const dropdown = item.closest('.lex-card-overflow');
          if (dropdown) dropdown.classList.remove('lex-card-overflow-open');
          this.emit('card-action', { action: item.dataset.action, label: item.textContent.trim() });
        });
      }

      // --- Wire up overflow trigger ---
      const overflowTrigger = this.querySelector('.lex-card-overflow-trigger');
      if (overflowTrigger) {
        const dropdown = overflowTrigger.nextElementSibling;
        this.listen(overflowTrigger, 'click', (e) => {
          e.stopPropagation();
          dropdown.classList.toggle('lex-card-overflow-open');
        });

        // Close on outside click
        this.listen(document, 'click', () => {
          dropdown.classList.remove('lex-card-overflow-open');
        });
      }
    }
  }

  defineLex('lex-card', LexCard);
})();

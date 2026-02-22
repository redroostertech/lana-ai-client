/* ==========================================================================
   Lex UI — <lex-action-menu>
   Vertical action list with icon + title + description rows.
   Designed for use inside modals (Lex.Modal.open) and action sheets.
   Supports variant colors: default, danger, info, success.

   Usage:
     const menu = document.createElement('lex-action-menu');
     menu.heading = 'Current Name:';
     menu.description = 'Law Firm Product Overview';
     menu.actions = [
       { id: 'rename', icon: 'pencil', label: 'Rename', description: 'Change the title' },
       { id: 'delete', icon: 'trash-2', label: 'Delete', description: 'Remove permanently', variant: 'danger' }
     ];

   Events:
     action-select — { actionId, label }
   ========================================================================== */

(function () {
  'use strict';

  const { LexElement, defineLex, Icons } = window.Lex;

  let stylesInjected = false;

  // Fallback icons when Lex.Icons not available
  const ICON_CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  const FALLBACK_ICONS = {
    pencil: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5z"/><path d="M15 5l4 4"/></svg>',
    folder: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
    'trash-2': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    'file-text': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>'
  };

  function getIcon(name, size) {
    if (Icons && Icons.get) {
      const svg = Icons.get({ name, size: size || 20 });
      if (svg) return svg;
    }
    return FALLBACK_ICONS[name] || FALLBACK_ICONS['file-text'];
  }

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-action-menu-styles';
    style.textContent = `
      lex-action-menu {
        display: block;
      }

      /* Header block */
      .lex-action-menu-header {
        padding: 14px 16px;
        background: var(--lex-bg-secondary, #F5F3F0);
        border-radius: var(--lex-radius-lg, 8px);
        margin-bottom: 16px;
      }

      .lex-action-menu-heading {
        font-size: var(--lex-body-xs-size, 0.75rem);
        font-weight: 500;
        color: var(--lex-text-tertiary, #7A756D);
        margin-bottom: 4px;
      }

      .lex-action-menu-description {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: 500;
        color: var(--lex-text-primary, #26211C);
        line-height: 1.4;
      }

      /* Action list */
      .lex-action-menu-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Individual action item */
      .lex-action-menu-item {
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
        padding: 14px 16px;
        border: 2px solid var(--lex-border-subtle, #E8E5E1);
        border-radius: var(--lex-radius-lg, 8px);
        background: var(--lex-bg-primary, #FFFFFF);
        cursor: pointer;
        text-align: left;
        font-family: var(--lex-font-sans);
        transition: border-color 0.2s ease, background 0.2s ease;
      }

      .lex-action-menu-item:hover {
        border-color: var(--lex-bg-accent, #736B5C);
        background: var(--lex-bg-accent-soft, rgba(115,107,92,0.06));
      }

      /* Variant hover colors */
      .lex-action-menu-item[data-variant="danger"]:hover {
        border-color: var(--lex-color-danger-500, #F04438);
        background: var(--lex-color-danger-50, #FEF3F2);
      }
      .lex-action-menu-item[data-variant="info"]:hover {
        border-color: var(--lex-color-info-500, #2E90FA);
        background: var(--lex-color-info-50, #EFF8FF);
      }
      .lex-action-menu-item[data-variant="success"]:hover {
        border-color: var(--lex-color-success-500, #17B26A);
        background: var(--lex-color-success-50, #ECFDF3);
      }

      /* Icon container */
      .lex-action-menu-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: var(--lex-radius-lg, 8px);
        flex-shrink: 0;
        transition: background 0.2s ease;
      }

      .lex-action-menu-icon--default {
        background: var(--lex-bg-accent-soft, rgba(115,107,92,0.1));
        color: var(--lex-bg-accent, #736B5C);
      }
      .lex-action-menu-item:hover .lex-action-menu-icon--default {
        background: var(--lex-bg-accent, #736B5C);
        color: var(--lex-color-white, #FFFFFF);
      }

      .lex-action-menu-icon--danger {
        background: var(--lex-color-danger-50, #FEF3F2);
        color: var(--lex-color-danger-500, #F04438);
      }
      .lex-action-menu-item:hover .lex-action-menu-icon--danger {
        background: var(--lex-color-danger-100, #FEE4E2);
      }

      .lex-action-menu-icon--info {
        background: var(--lex-color-info-50, #EFF8FF);
        color: var(--lex-color-info-500, #2E90FA);
      }
      .lex-action-menu-item:hover .lex-action-menu-icon--info {
        background: var(--lex-color-info-100, #D1E9FF);
      }

      .lex-action-menu-icon--success {
        background: var(--lex-color-success-50, #ECFDF3);
        color: var(--lex-color-success-500, #17B26A);
      }
      .lex-action-menu-item:hover .lex-action-menu-icon--success {
        background: var(--lex-color-success-100, #D1FADF);
      }

      /* Content */
      .lex-action-menu-content {
        flex: 1;
        min-width: 0;
      }

      .lex-action-menu-label {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: 500;
        color: var(--lex-text-primary, #26211C);
        line-height: 1.3;
        transition: color 0.2s ease;
      }

      .lex-action-menu-item[data-variant="danger"]:hover .lex-action-menu-label {
        color: var(--lex-color-danger-500, #F04438);
      }
      .lex-action-menu-item[data-variant="info"]:hover .lex-action-menu-label {
        color: var(--lex-color-info-500, #2E90FA);
      }
      .lex-action-menu-item[data-variant="success"]:hover .lex-action-menu-label {
        color: var(--lex-color-success-500, #17B26A);
      }

      .lex-action-menu-desc {
        font-size: var(--lex-body-xs-size, 0.75rem);
        color: var(--lex-text-tertiary, #7A756D);
        margin-top: 2px;
        line-height: 1.4;
      }

      /* Chevron */
      .lex-action-menu-chevron {
        flex-shrink: 0;
        color: var(--lex-text-tertiary, #7A756D);
        opacity: 0.5;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }

      .lex-action-menu-item:hover .lex-action-menu-chevron {
        opacity: 1;
        transform: translateX(2px);
      }
    `;
    document.head.appendChild(style);
  }

  class LexActionMenu extends LexElement {

    static get properties() {
      return {
        actions:     { type: Array, default: [] },
        heading:     { type: String, default: '' },
        description: { type: String, default: '' }
      };
    }

    connected() {
      injectStyles();
    }

    render() {
      const actions = this.actions || [];

      // Header
      let headerHtml = '';
      if (this.heading || this.description) {
        headerHtml = `
          <div class="lex-action-menu-header">
            ${this.heading ? `<div class="lex-action-menu-heading">${this._esc(this.heading)}</div>` : ''}
            ${this.description ? `<div class="lex-action-menu-description">${this._esc(this.description)}</div>` : ''}
          </div>`;
      }

      // Action rows
      const rows = actions.map(a => {
        const variant = a.variant || 'default';
        const icon = getIcon(a.icon || 'file-text');
        return `
          <button class="lex-action-menu-item" data-action="${this._esc(a.id)}" data-variant="${variant}" type="button" role="menuitem">
            <div class="lex-action-menu-icon lex-action-menu-icon--${variant}" aria-hidden="true">${icon}</div>
            <div class="lex-action-menu-content">
              <div class="lex-action-menu-label">${this._esc(a.label)}</div>
              ${a.description ? `<div class="lex-action-menu-desc">${this._esc(a.description)}</div>` : ''}
            </div>
            <span class="lex-action-menu-chevron" aria-hidden="true">${ICON_CHEVRON}</span>
          </button>`;
      }).join('');

      return `
        <div class="lex-action-menu">
          ${headerHtml}
          <div class="lex-action-menu-list" role="menu">${rows}</div>
        </div>`;
    }

    updated() {
      this.delegate('click', '[data-action]', (e, target) => {
        const actionId = target.dataset.action;
        const action = (this.actions || []).find(a => a.id === actionId);
        this.emit('action-select', {
          actionId,
          label: action ? action.label : ''
        });
      });
    }

    _esc(str) {
      if (!str) return '';
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }
  }

  defineLex('lex-action-menu', LexActionMenu);

})();

/* ==========================================================================
   Lex UI — <lex-chat-documents>
   Document chat mode banner with document chips.
   Shows active documents, allows removal, and supports exit.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, ChatFormat } = global.Lex;
  if (!LexElement) { console.error('[lex-chat-documents] LexElement not loaded'); return; }

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-documents-styles';
    style.textContent = `
      lex-chat-documents {
        display: block;
      }
      lex-chat-documents[hidden] {
        display: none !important;
      }

      .lex-chat-docs-banner {
        border-bottom: 1px solid var(--lex-chat-accent-soft);
        background: var(--lex-chat-accent-soft);
        padding: 12px 16px;
      }

      .lex-chat-docs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .lex-chat-docs-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .lex-chat-docs-title-icon {
        width: 16px; height: 16px;
        color: var(--lex-chat-accent);
      }

      .lex-chat-docs-title-text {
        font-size: 13px;
        font-weight: 600;
        color: var(--lex-chat-text);
      }

      .lex-chat-docs-count {
        font-size: 11px;
        color: var(--lex-chat-text-muted);
        margin-left: 4px;
      }

      .lex-chat-docs-exit {
        font-size: 11px;
        font-weight: 500;
        color: var(--lex-chat-text-muted);
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--lex-radius-md, 6px);
        transition: background var(--lex-transition-fast, 0.15s), color var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-docs-exit:hover {
        background: var(--lex-chat-bg-elevated);
        color: var(--lex-chat-text);
      }

      .lex-chat-docs-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }

      .lex-chat-doc-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 11px;
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        color: var(--lex-chat-text);
      }

      .lex-chat-doc-chip-icon {
        width: 12px; height: 12px;
        color: var(--lex-chat-accent);
        flex-shrink: 0;
      }

      .lex-chat-doc-chip-name {
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-chat-doc-chip-remove {
        margin-left: 2px;
        width: 12px; height: 12px;
        color: var(--lex-chat-text-dim);
        cursor: pointer;
        background: none; border: none; padding: 0;
        flex-shrink: 0;
        transition: color var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-doc-chip-remove:hover {
        color: var(--lex-color-danger-500, #ef4444);
      }

      .lex-chat-docs-hint {
        font-size: 10px;
        color: var(--lex-chat-text-dim);
        margin-top: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  const DOC_ICON = `<svg class="lex-chat-docs-title-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`;
  const CHIP_DOC_ICON = `<svg class="lex-chat-doc-chip-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`;
  const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;

  class LexChatDocuments extends LexElement {

    static get properties() {
      return {
        documents:    { type: Array, default: [] },
        maxDocuments: { type: Number, default: 3, attribute: 'max-documents' },
        mode:         { type: String, default: 'general' }
      };
    }

    connected() {
      injectStyles();
    }

    render() {
      const docs = this.documents || [];
      if (docs.length === 0 || this.mode !== 'document') {
        this.setAttribute('hidden', '');
        return '';
      }

      this.removeAttribute('hidden');

      const chips = docs.map(doc => {
        const name = ChatFormat ? ChatFormat.escapeHtml(doc.filename || doc.name || 'Document') : (doc.filename || doc.name || 'Document');
        const id = ChatFormat ? ChatFormat.escapeHtml(doc.id) : doc.id;
        return `
          <div class="lex-chat-doc-chip">
            ${CHIP_DOC_ICON}
            <span class="lex-chat-doc-chip-name" title="${name}">${name}</span>
            <button class="lex-chat-doc-chip-remove" data-doc-id="${id}" title="Remove ${name}">${CLOSE_ICON}</button>
          </div>`;
      }).join('');

      return `
        <div class="lex-chat-docs-banner">
          <div class="lex-chat-docs-header">
            <div class="lex-chat-docs-title">
              ${DOC_ICON}
              <span class="lex-chat-docs-title-text">Document Chat Mode</span>
              <span class="lex-chat-docs-count">(${docs.length} of ${this.maxDocuments})</span>
            </div>
            <button class="lex-chat-docs-exit" data-exit>Exit</button>
          </div>
          <div class="lex-chat-docs-chips">${chips}</div>
          <div class="lex-chat-docs-hint">All questions will be answered using these documents</div>
        </div>`;
    }

    updated() {
      this.delegate('click', '.lex-chat-doc-chip-remove', (e, target) => {
        e.preventDefault();
        this.emit('lex-document-remove', { documentId: target.dataset.docId });
      });

      this.delegate('click', '[data-exit]', (e) => {
        e.preventDefault();
        this.emit('lex-document-exit');
      });
    }
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChatDocuments = LexChatDocuments;

})(typeof window !== 'undefined' ? window : globalThis);

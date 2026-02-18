/* Lex UI — Document Reference Block
   AI can reference a document with a preview card.
   Supports variant: "source" for chat source cards with a "View Location" button.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-document-ref-block-styles';
    style.textContent = `
      /* ── Source Card Variant (for chat citations) ─────────── */

      .lex-dr-source {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px;
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        border-radius: var(--lex-radius-lg);
        transition: background var(--lex-transition-fast);
      }

      .lex-dr-source:hover {
        background: var(--lex-chat-bg-elevated);
      }

      .lex-dr-source-icon {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border-radius: var(--lex-radius-lg);
        background: var(--lex-chat-bg-elevated);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .lex-dr-source-icon svg {
        width: 18px;
        height: 18px;
        color: var(--lex-chat-text-muted);
      }

      .lex-dr-source-body {
        flex: 1;
        min-width: 0;
      }

      .lex-dr-source-name {
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-bold);
        color: var(--lex-chat-text);
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-dr-source-page {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 3px;
      }

      .lex-dr-source-excerpt {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 3px;
      }

      .lex-dr-source-actions {
        flex-shrink: 0;
      }

      .lex-dr-view-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-bold);
        color: var(--lex-chat-dark-900, #0a0a0f);
        background: var(--lex-chat-dark-50, #ffffff);
        border: none;
        border-radius: var(--lex-radius-sm);
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        transition: opacity var(--lex-transition-fast);
      }

      .lex-dr-view-btn:hover {
        opacity: 0.85;
      }

      .lex-dr-view-btn svg {
        width: 12px;
        height: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  const DOC_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  const ARROW_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

  SchemaRegistry.register('document_ref', {
    description: 'Display a document reference card with filename, page, and relevance. Use when citing a specific document. Set variant to "source" for chat citation cards.',
    fields: {
      type:      { type: 'string', required: true, description: 'Must be "document_ref"' },
      filename:  { type: 'string', required: true, description: 'Document filename' },
      docId:     { type: 'string', description: 'Document ID for linking' },
      page:      { type: 'number', description: 'Relevant page number' },
      excerpt:   { type: 'string', description: 'Brief excerpt from the document' },
      relevance: { type: 'number', description: 'Relevance score 0-1' },
      variant:   { type: 'string', description: 'Optional: "source" for chat citation card with View Location button' }
    },
    example: {
      type: 'document_ref',
      filename: 'Employment_Contract_2025.pdf',
      docId: 'doc-abc-123',
      page: 12,
      excerpt: 'Section 4.2 states that the termination clause requires 30 days notice...',
      relevance: 0.94
    }
  }, function renderDocumentRef(container, block) {

    // Source card variant for chat citations
    if (block.variant === 'source') {
      injectStyles();

      let html = `
        <div class="lex-dr-source lex-chat-block" data-doc-id="${escapeHtml(block.docId || '')}" data-page="${block.page || 1}">
          <div class="lex-dr-source-icon">${DOC_ICON_SVG}</div>
          <div class="lex-dr-source-body">
            <div class="lex-dr-source-name">${escapeHtml(block.filename)}</div>
            ${block.excerpt ? `<div class="lex-dr-source-excerpt">${escapeHtml(block.excerpt)}</div>` : ''}
          </div>
          <div class="lex-dr-source-actions">
            <button type="button" class="lex-dr-view-btn" data-dr-view>VIEW LOCATION</button>
          </div>
        </div>
      `;

      container.innerHTML = html;

      container.addEventListener('click', (e) => {
        const viewBtn = e.target.closest('[data-dr-view]');
        if (viewBtn) {
          container.dispatchEvent(new CustomEvent('lex-document-open', {
            detail: { docId: block.docId, filename: block.filename, page: block.page || 1 },
            bubbles: true
          }));
          return;
        }
        // Click on card also opens
        const card = e.target.closest('.lex-dr-source');
        if (card) {
          container.dispatchEvent(new CustomEvent('lex-document-open', {
            detail: { docId: block.docId, filename: block.filename, page: block.page || 1 },
            bubbles: true
          }));
        }
      });

      return;
    }

    // Default variant (original)
    const relevancePercent = block.relevance ? Math.round(block.relevance * 100) : null;
    const relevanceBadge = relevancePercent !== null
      ? `<lex-badge label="${relevancePercent}% match" color="${relevancePercent >= 90 ? 'green' : relevancePercent >= 70 ? 'blue' : 'gray'}"></lex-badge>`
      : '';

    container.innerHTML = `
      <div class="flex items-start gap-3 p-4 lex-bg-primary border lex-border rounded-lg hover:shadow-sm transition cursor-pointer" data-doc-id="${escapeHtml(block.docId || '')}" data-page="${block.page || 1}">
        <div class="flex-shrink-0 w-10 h-10 lex-bg-accent-soft rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium lex-text-primary truncate">${escapeHtml(block.filename)}</span>
            ${relevanceBadge}
          </div>
          ${block.page ? `<span class="text-xs lex-text-secondary">Page ${block.page}</span>` : ''}
          ${block.excerpt ? `<p class="text-xs lex-text-secondary mt-1 line-clamp-2">${escapeHtml(block.excerpt)}</p>` : ''}
        </div>
      </div>
    `;

    container.addEventListener('click', () => {
      container.dispatchEvent(new CustomEvent('lex-document-open', {
        detail: { docId: block.docId, filename: block.filename, page: block.page || 1 },
        bubbles: true
      }));
    });
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

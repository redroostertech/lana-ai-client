/* Lex UI — Citation Block
   AI can output a legal citation with source reference.
*/

(function () {
  'use strict';

  const { SchemaRegistry, Icons } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-citation-block-styles';
    style.textContent = `
      .lex-cite-wrapper {
        border-left: 3px solid var(--lex-chat-accent);
        background: var(--lex-chat-bg-surface);
        border-radius: 0 var(--lex-radius-md) var(--lex-radius-md) 0;
        padding: 14px 16px;
      }

      .lex-cite-text {
        font-size: var(--lex-body-sm-size);
        font-style: italic;
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-text);
        line-height: 1.6;
      }

      .lex-cite-source {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
      }

      .lex-cite-source svg {
        flex-shrink: 0;
        color: var(--lex-chat-text-dim);
      }

      .lex-cite-source-text {
        font-size: var(--lex-form-font-size-sm);
        color: var(--lex-chat-text-muted);
      }

      .lex-cite-source-link {
        font-size: var(--lex-form-font-size-sm);
        color: var(--lex-chat-accent);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }

      .lex-cite-source-link:hover {
        opacity: 0.8;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('citation', {
    description: 'Display a legal citation or source reference with quoted text and a left accent border.',
    fields: {
      type:   { type: 'string', required: true, description: 'Must be "citation"' },
      text:   { type: 'string', required: true, description: 'The quoted text or citation content' },
      source: { type: 'string', required: true, description: 'Source reference (case name, statute, document)' },
      page:   { type: 'string', description: 'Page or section reference' },
      docId:  { type: 'string', description: 'Document ID if citing an uploaded document' }
    },
    example: {
      type: 'citation',
      text: 'The employer must provide at least 30 days written notice before termination of the agreement.',
      source: 'Employment_Contract_2025.pdf',
      page: 'Section 4.2, p. 12',
      docId: 'doc-abc-123'
    }
  }, function renderCitation(container, block) {
    injectStyles();

    const hasLink = block.docId;
    const fileIcon = Icons.get({ name: 'file-text', size: 14 });
    const sourceLabel = escapeHtml(block.source) + (block.page ? ' — ' + escapeHtml(block.page) : '');

    container.innerHTML = `
      <div class="lex-cite-wrapper lex-chat-block">
        <div class="lex-cite-text">"${escapeHtml(block.text)}"</div>
        <div class="lex-cite-source">
          ${fileIcon}
          ${hasLink
            ? '<span class="lex-cite-source-link" data-doc-id="' + escapeHtml(block.docId) + '">' + sourceLabel + '</span>'
            : '<span class="lex-cite-source-text">' + sourceLabel + '</span>'
          }
        </div>
      </div>
    `;

    if (hasLink) {
      container.querySelector('[data-doc-id]').addEventListener('click', () => {
        container.dispatchEvent(new CustomEvent('lex-document-open', {
          detail: { docId: block.docId, source: block.source, page: block.page },
          bubbles: true
        }));
      });
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

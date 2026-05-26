/* Lex UI — Document Comment Composer
   Collaboration composer for matter/document comments. This is intentionally
   separate from chat composers so document review UI can evolve independently.

   Usage:
     <lex-document-comment-composer initials="MW"></lex-document-comment-composer>

   Events:
     comment-submit { content, html }
     comment-cancel
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-document-comment-composer-styles';
    style.textContent = `
      lex-document-comment-composer {
        display: block;
      }

      .lex-document-comment-composer {
        border: 1px solid var(--lex-border-subtle);
        border-radius: var(--lex-radius-lg);
        background: var(--lex-bg-primary);
        padding: 14px;
      }

      .lex-document-comment-composer-main {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .lex-document-comment-composer-avatar {
        align-items: center;
        background: var(--lex-bg-tertiary);
        border-radius: var(--lex-radius-full);
        color: var(--lex-text-primary);
        display: inline-flex;
        flex: 0 0 40px;
        font-size: var(--lex-body-sm-size);
        font-weight: var(--lex-weight-semibold);
        height: 40px;
        justify-content: center;
        width: 40px;
      }

      .lex-document-comment-composer-editor-wrap {
        flex: 1;
        min-width: 0;
      }

      .lex-document-comment-composer-editor {
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-lg);
        color: var(--lex-text-primary);
        font: inherit;
        line-height: 1.5;
        min-height: 88px;
        outline: none;
        padding: 12px 14px;
        width: 100%;
      }

      .lex-document-comment-composer-editor:focus {
        border-color: var(--lex-border-focus);
        box-shadow: 0 0 0 3px var(--lex-ring-focus);
      }

      .lex-document-comment-composer-editor:empty::before {
        color: var(--lex-text-tertiary);
        content: attr(data-placeholder);
        pointer-events: none;
      }

      .lex-document-comment-composer-actions {
        align-items: center;
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 12px;
      }

      .lex-document-comment-composer-actions button {
        border: 0;
        border-radius: var(--lex-radius-lg);
        cursor: pointer;
        font: inherit;
        font-weight: var(--lex-weight-medium);
        padding: 9px 14px;
      }

      .lex-document-comment-composer-cancel {
        background: transparent;
        color: var(--lex-text-secondary);
      }

      .lex-document-comment-composer-cancel:hover {
        background: var(--lex-bg-hover);
        color: var(--lex-text-primary);
      }

      .lex-document-comment-composer-submit {
        background: var(--lex-color-brand-800);
        color: var(--lex-color-white);
      }

      .lex-document-comment-composer-submit:hover {
        background: var(--lex-color-brand-900);
      }
    `;
    document.head.appendChild(style);
  }

  class LexDocumentCommentComposer extends LexElement {
    static get properties() {
      return {
        initials: { type: String, default: 'U' },
        placeholder: {
          type: String,
          default: 'Add a comment... (type @ to mention teammates, # to reference documents)'
        },
        submitLabel: { type: String, default: 'Post Comment' },
        cancelLabel: { type: String, default: 'Cancel' }
      };
    }

    get value() {
      return this._editorText();
    }

    set value(nextValue) {
      const editor = this.querySelector('[data-document-comment-editor]');
      if (editor) editor.textContent = nextValue || '';
    }

    render() {
      injectStyles();
      return `
        <div class="lex-document-comment-composer">
          <div class="lex-document-comment-composer-main">
            <div class="lex-document-comment-composer-avatar">${this.escapeHtml(this.initials || 'U')}</div>
            <div class="lex-document-comment-composer-editor-wrap">
              <div
                class="lex-document-comment-composer-editor"
                contenteditable="true"
                data-document-comment-editor
                data-placeholder="${this.escapeHtml(this.placeholder)}"
                role="textbox"
                aria-multiline="true"
                spellcheck="true"
              ></div>
              <div class="lex-document-comment-composer-actions">
                <button type="button" class="lex-document-comment-composer-cancel" data-document-comment-cancel>${this.escapeHtml(this.cancelLabel)}</button>
                <button type="button" class="lex-document-comment-composer-submit" data-document-comment-submit>${this.escapeHtml(this.submitLabel)}</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    updated() {
      this.delegate('click', '[data-document-comment-submit]', () => {
        const content = this._editorText();
        if (!content) return;
        this.emit('comment-submit', {
          content,
          html: this.querySelector('[data-document-comment-editor]')?.innerHTML || ''
        });
      });

      this.delegate('click', '[data-document-comment-cancel]', () => {
        this.clear();
        this.emit('comment-cancel');
      });
    }

    clear() {
      const editor = this.querySelector('[data-document-comment-editor]');
      if (editor) editor.innerHTML = '';
    }

    _editorText() {
      const editor = this.querySelector('[data-document-comment-editor]');
      return (editor?.innerText || editor?.textContent || '').replace(/\u00A0/g, ' ').trim();
    }
  }

  defineLex('lex-document-comment-composer', LexDocumentCommentComposer);
})();

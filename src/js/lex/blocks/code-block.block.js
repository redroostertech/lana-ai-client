/* Lex UI — Code Block
   AI can output code snippets with a filename header and copy button.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // Inject styles once for the code block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-code-block-block-styles';
    style.textContent = `
      .lex-cb-container {
        background: var(--lex-chat-code-bg);
        border: 1px solid var(--lex-chat-code-border);
        border-radius: var(--lex-radius-lg);
        overflow: hidden;
      }

      .lex-cb-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 14px;
        background: var(--lex-chat-code-header-bg);
        border-bottom: 1px solid var(--lex-chat-code-border);
      }

      .lex-cb-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .lex-cb-filename {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-chat-code-header-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .lex-cb-language {
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-text-dim);
        white-space: nowrap;
        flex-shrink: 0;
      }

      .lex-cb-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .lex-cb-copy-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border: none;
        background: transparent;
        color: var(--lex-chat-text-dim);
        border-radius: var(--lex-radius-sm);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-regular);
        line-height: 1;
        transition: color var(--lex-transition-fast), background var(--lex-transition-fast);
      }

      .lex-cb-copy-btn:hover {
        color: var(--lex-chat-text-muted);
      }

      .lex-cb-copy-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }

      .lex-cb-body {
        padding: 14px;
        overflow-x: auto;
      }

      .lex-cb-body pre {
        margin: 0;
      }

      .lex-cb-body code {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-code-text);
        line-height: 1.6;
        white-space: pre;
        word-break: normal;
        overflow-wrap: normal;
      }
    `;
    document.head.appendChild(style);
  }

  const CLIPBOARD_ICON = '<svg class="lex-cb-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

  SchemaRegistry.register('code_block', {
    description: 'Display a code snippet with a filename header and copy button. No syntax highlighting — monospaced font only.',
    fields: {
      type:     { type: 'string', required: true, description: 'Must be "code_block"' },
      filename: { type: 'string', description: 'Filename shown in header' },
      language: { type: 'string', description: 'Programming language for display label' },
      code:     { type: 'string', required: true, description: 'The code content' }
    },
    example: {
      type: 'code_block',
      filename: 'amendment_v1.js',
      language: 'javascript',
      code: 'function applyAmendment(clause) {\n  return clause.modify();\n}'
    }
  }, function renderCodeBlock(container, block) {
    injectStyles();

    const filename = block.filename || '';
    const language = block.language || '';
    const code = block.code || '';

    const headerLeftParts = [];
    if (filename) {
      headerLeftParts.push('<span class="lex-cb-filename">' + escapeHtml(filename) + '</span>');
    }

    const headerRightParts = [];
    if (language) {
      headerRightParts.push('<span class="lex-cb-language">' + escapeHtml(language) + '</span>');
    }
    headerRightParts.push(
      '<button type="button" class="lex-cb-copy-btn" data-cb-copy>' +
        CLIPBOARD_ICON +
        '<span data-cb-copy-label>Copy</span>' +
      '</button>'
    );

    const html = `
      <div class="lex-cb-container lex-chat-block">
        <div class="lex-cb-header">
          <div class="lex-cb-header-left">
            ${headerLeftParts.join('')}
          </div>
          <div class="lex-cb-header-right">
            ${headerRightParts.join('')}
          </div>
        </div>
        <div class="lex-cb-body">
          <pre><code>${escapeHtml(code)}</code></pre>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Copy button behaviour
    const copyBtn = container.querySelector('[data-cb-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(code).then(function () {
          var label = copyBtn.querySelector('[data-cb-copy-label]');
          if (label) {
            label.textContent = 'Copied!';
            setTimeout(function () {
              label.textContent = 'Copy';
            }, 1500);
          }
        });
      });
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

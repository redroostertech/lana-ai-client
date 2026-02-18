/* Lex UI — Redline Block
   AI can output inline text diffs with additions and deletions highlighted.
   Renders segments as flowing inline text with strikethrough deletions
   and underlined additions, useful for contract clause comparisons.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // Inject styles once for the redline block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-redline-block-styles';
    style.textContent = `
      .lex-rl-title {
        display: inline-block;
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-chat-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding-left: 10px;
        border-left: 2px solid var(--lex-chat-accent);
        margin-bottom: 12px;
      }

      .lex-rl-wrapper {
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        border-radius: var(--lex-radius-lg);
        padding: 16px;
      }

      .lex-rl-content {
        font-size: var(--lex-body-sm-size);
        line-height: 1.8;
        color: var(--lex-chat-text);
      }

      .lex-rl-seg-deletion {
        background: var(--lex-chat-diff-del-bg);
        color: var(--lex-chat-diff-del-text);
        text-decoration: line-through;
        border-radius: var(--lex-radius-sm);
        padding: 1px 4px;
      }

      .lex-rl-seg-addition {
        background: var(--lex-chat-diff-add-bg);
        color: var(--lex-chat-diff-add-text);
        text-decoration: underline;
        border-radius: var(--lex-radius-sm);
        padding: 1px 4px;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('redline', {
    description: 'Display inline text diffs with additions and deletions highlighted. Use for showing redline comparisons of contract clauses, legal provisions, or any text where changes need to be visually tracked.',
    fields: {
      type:     { type: 'string', required: true, description: 'Must be "redline"' },
      title:    { type: 'string', description: 'Heading for the redline section' },
      segments: { type: 'array', required: true, description: 'Array of segment objects with text (string) and type ("unchanged"|"deletion"|"addition")' }
    },
    example: {
      type: 'redline',
      title: 'Clause 8.2 Redline',
      segments: [
        { text: 'upon ', type: 'unchanged' },
        { text: 'ninety (90)', type: 'deletion' },
        { text: 'thirty (30)', type: 'addition' },
        { text: ' days written notice.', type: 'unchanged' }
      ]
    }
  }, function renderRedline(container, block) {
    injectStyles();

    const segments = block.segments || [];

    let html = '';

    if (block.title) {
      html += '<div class="lex-rl-title">' + escapeHtml(block.title) + '</div>';
    }

    html += '<div class="lex-rl-wrapper lex-chat-block">';
    html += '<div class="lex-rl-content">';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const text = escapeHtml(seg.text);

      if (seg.type === 'deletion') {
        html += '<span class="lex-rl-seg-deletion">' + text + '</span>';
      } else if (seg.type === 'addition') {
        html += '<span class="lex-rl-seg-addition">' + text + '</span>';
      } else {
        html += '<span>' + text + '</span>';
      }
    }

    html += '</div>';
    html += '</div>';

    container.innerHTML = html;
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

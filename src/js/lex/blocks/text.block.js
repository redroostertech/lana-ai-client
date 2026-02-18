/* Lex UI — Text Block
   Renders markdown-formatted text from AI responses.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  SchemaRegistry.register('text', {
    description: 'Plain or markdown-formatted text content',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "text"' },
      content: { type: 'string', required: true, description: 'Text content, optionally with markdown formatting' }
    },
    example: {
      type: 'text',
      content: 'Here is a summary of the findings from the **Smith v. Jones** matter.'
    }
  }, function renderText(container, block) {
    let html = block.content || '';

    // Basic markdown processing
    html = html
      .replace(/```(\w+)?\n?([\s\S]*?)```/g, '<pre class="lex-bg-secondary rounded-lg p-3 text-xs font-mono overflow-x-auto my-2"><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="lex-bg-tertiary px-1.5 py-0.5 rounded text-xs font-mono">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="lex-text-link underline" target="_blank">$1</a>')
      .replace(/\n/g, '<br>');

    container.innerHTML = `<div class="text-sm lex-text-primary leading-relaxed">${html}</div>`;
  });
})();

/* Lex UI — Suggestion Block
   AI can output clickable suggestion chips for user to select.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  SchemaRegistry.register('suggestion', {
    description: 'Display clickable suggestion chips. Use when offering the user a set of predefined choices or follow-up questions.',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "suggestion"' },
      title:   { type: 'string', description: 'Optional prompt text above suggestions' },
      items:   {
        type: 'array', required: true,
        description: 'Array of suggestion objects with: label (string, required), value (string — what gets sent if clicked), icon (string, optional — "search"|"document"|"question"|"action")'
      }
    },
    example: {
      type: 'suggestion',
      title: 'Would you like to:',
      items: [
        { label: 'Search for related cases', value: 'search related cases', icon: 'search' },
        { label: 'Draft a summary memo', value: 'draft summary memo', icon: 'document' },
        { label: 'Review the timeline', value: 'show case timeline', icon: 'action' }
      ]
    }
  }, function renderSuggestion(container, block) {
    const items = block.items || [];

    const icons = {
      search: `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>`,
      document: `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
      question: `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      action: `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`
    };

    let html = '';
    if (block.title) {
      html += `<p class="text-sm lex-text-secondary mb-3">${escapeHtml(block.title)}</p>`;
    }

    html += `<div class="flex flex-wrap gap-2">`;
    items.forEach((item, idx) => {
      const icon = item.icon && icons[item.icon] ? icons[item.icon] : '';
      html += `
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium lex-text-accent lex-bg-accent-soft border lex-border-accent rounded-full lex-hover-bg-accent transition-colors" data-suggestion-idx="${idx}">
          ${icon}
          ${escapeHtml(item.label)}
        </button>
      `;
    });
    html += `</div>`;

    container.innerHTML = html;

    // Event delegation for suggestion clicks
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-suggestion-idx]');
      if (btn) {
        const idx = parseInt(btn.dataset.suggestionIdx);
        const item = items[idx];
        if (item) {
          container.dispatchEvent(new CustomEvent('lex-suggestion', {
            detail: { value: item.value || item.label, item },
            bubbles: true
          }));
        }
      }
    });
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

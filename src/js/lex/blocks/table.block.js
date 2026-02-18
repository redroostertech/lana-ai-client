/* Lex UI — Table Block
   AI can output tabular data that renders as a styled, sortable table.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  SchemaRegistry.register('table', {
    description: 'Display data in a sortable table. Use for lists of items, comparisons, or structured results.',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "table"' },
      title:   { type: 'string', description: 'Optional table heading' },
      columns: { type: 'array', description: 'Column keys to display (auto-detected from data if omitted)' },
      labels:  { type: 'array', description: 'Column header labels (defaults to column keys if omitted)' },
      rows:    { type: 'array', required: true, description: 'Array of row objects' }
    },
    example: {
      type: 'table',
      title: 'Related Documents',
      columns: ['name', 'relevance', 'pages'],
      labels: ['Document', 'Relevance', 'Pages'],
      rows: [
        { name: 'Contract.pdf', relevance: '94%', pages: 12 },
        { name: 'Amendment.docx', relevance: '87%', pages: 3 }
      ]
    }
  }, function renderTable(container, block) {
    const rows = block.rows || [];
    if (rows.length === 0) {
      container.innerHTML = '<lex-empty message="No data" icon="folder"></lex-empty>';
      return;
    }

    let html = '';
    if (block.title) {
      html += `<h4 class="text-sm font-semibold lex-text-primary mb-3">${escapeHtml(block.title)}</h4>`;
    }

    // Create a lex-table and set data directly
    const table = document.createElement('lex-table');
    if (block.columns) table.setAttribute('columns', block.columns.join(','));
    if (block.labels) table.setAttribute('labels', block.labels.join(','));
    table.setAttribute('compact', 'true');
    table.setAttribute('auto-fetch', 'false');

    container.innerHTML = html;
    container.appendChild(table);

    // Set data after element is in DOM
    requestAnimationFrame(() => {
      if (table.setData) {
        table.setData(rows);
      }
    });
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

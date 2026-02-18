/* Lex UI — Compare Block
   AI can output a data comparison table with old/new highlighting.
   Cells marked as changed get colored text to draw attention
   to differences between document versions, provisions, or data sets.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // Inject styles once for the compare block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-compare-block-styles';
    style.textContent = `
      .lex-cmp-wrapper {
        border-radius: var(--lex-radius-lg);
        overflow: hidden;
        border: 1px solid var(--lex-chat-compare-border);
        background: var(--lex-chat-compare-bg);
      }

      .lex-cmp-title {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-chat-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 10px;
      }

      .lex-cmp-table {
        width: 100%;
        border-collapse: collapse;
      }

      .lex-cmp-table th {
        background: var(--lex-chat-compare-header);
        color: var(--lex-chat-text-muted);
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-medium);
        text-align: left;
        padding: 10px 14px;
        border-bottom: 1px solid var(--lex-chat-compare-border);
      }

      .lex-cmp-table th + th {
        border-left: 1px solid var(--lex-chat-compare-border);
      }

      .lex-cmp-table td {
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-text);
        padding: 10px 14px;
        border-bottom: 1px solid var(--lex-chat-compare-border);
      }

      .lex-cmp-table td + td {
        border-left: 1px solid var(--lex-chat-compare-border);
      }

      .lex-cmp-table tr:last-child td {
        border-bottom: none;
      }

      .lex-cmp-changed {
        color: var(--lex-chat-diff-add-text);
        font-weight: var(--lex-weight-medium);
      }

      .lex-cmp-changed-del {
        color: var(--lex-chat-diff-del-text);
        font-weight: var(--lex-weight-medium);
        text-decoration: line-through;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('compare', {
    description: 'Display a data comparison table with old/new highlighting. Use for comparing document versions, contract provisions, or any side-by-side data where differences should be visually emphasized. Mark cells as changed (green) or deleted (red strikethrough).',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "compare"' },
      title:   { type: 'string', description: 'Table heading' },
      columns: { type: 'array', required: true, description: 'Column header labels' },
      rows:    { type: 'array', required: true, description: 'Array of row objects with cells (array of strings), changed (array of booleans for green highlight), deleted (array of booleans for red strikethrough)' }
    },
    example: {
      type: 'compare',
      title: 'Key Provision Comparison',
      columns: ['Provision', 'Standard V4', 'Vendor Draft'],
      rows: [
        { cells: ['Notice Period', '90 Days', '30 Days'], deleted: [false, true, false], changed: [false, false, true] },
        { cells: ['Liability Cap', '1.5x Fees', '1.0x Fees'], changed: [false, false, true] }
      ]
    }
  }, function renderCompare(container, block) {
    injectStyles();

    const columns = block.columns || [];
    const rows = block.rows || [];

    let html = '';

    if (block.title) {
      html += '<div class="lex-cmp-title">' + escapeHtml(block.title) + '</div>';
    }

    html += '<div class="lex-cmp-wrapper lex-chat-block">';
    html += '<table class="lex-cmp-table">';

    // Header row
    html += '<thead><tr>';
    for (let c = 0; c < columns.length; c++) {
      html += '<th>' + escapeHtml(columns[c]) + '</th>';
    }
    html += '</tr></thead>';

    // Data rows
    html += '<tbody>';
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const cells = row.cells || [];
      const changed = row.changed || [];
      const deleted = row.deleted || [];

      html += '<tr>';
      for (let c = 0; c < columns.length; c++) {
        const isDeleted = deleted[c] === true;
        const isChanged = changed[c] === true;
        var cls = '';
        if (isDeleted) cls = ' class="lex-cmp-changed-del"';
        else if (isChanged) cls = ' class="lex-cmp-changed"';
        html += '<td' + cls + '>' + escapeHtml(cells[c] != null ? String(cells[c]) : '') + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody>';

    html += '</table>';
    html += '</div>';

    container.innerHTML = html;
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

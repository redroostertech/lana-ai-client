/* Lex UI — Layout Block (Compound)
   Multi-column grid layout for side-by-side blocks.
   Enables the AI to compose visual comparisons, dashboards, and
   parallel content views. Uses CSS grid with responsive fallback.
   Children are rendered recursively via BlockRenderer.render().
*/

(function () {
  'use strict';

  const { SchemaRegistry, BlockRenderer } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-layout-block-styles';
    style.textContent = `
      .lex-layout {
        display: grid;
        gap: 12px;
        margin: 8px 0;
      }

      .lex-layout-2 {
        grid-template-columns: repeat(2, 1fr);
      }

      .lex-layout-3 {
        grid-template-columns: repeat(3, 1fr);
      }

      .lex-layout-4 {
        grid-template-columns: repeat(4, 1fr);
      }

      /* Responsive: stack on narrow containers */
      @media (max-width: 500px) {
        .lex-layout-2,
        .lex-layout-3,
        .lex-layout-4 {
          grid-template-columns: 1fr;
        }
      }

      .lex-layout-cell {
        min-width: 0; /* Prevent grid blowout */
      }

      .lex-layout-cell > .lex-block {
        margin-bottom: 0; /* Remove default margin inside grid cells */
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('layout', {
    description: 'Multi-column grid layout for placing blocks side by side. Use for comparisons, dashboards, or any content that benefits from parallel display.',
    fields: {
      type:     { type: 'string', required: true, description: 'Must be "layout"' },
      columns:  { type: 'number', description: 'Number of columns (2-4, default 2)' },
      children: { type: 'array', required: true, description: 'Array of child block objects, distributed across columns' }
    },
    example: {
      type: 'layout',
      columns: 2,
      children: [
        { type: 'metric_card', title: 'Before', value: '$45,000' },
        { type: 'metric_card', title: 'After', value: '$32,000' }
      ]
    }
  }, function renderLayout(container, block, options) {
    injectStyles();

    const children = block.children || [];
    const columns = Math.max(2, Math.min(4, block.columns || 2));

    const grid = document.createElement('div');
    grid.className = 'lex-layout lex-layout-' + columns;

    // Render each child into its own cell
    for (const childBlock of children) {
      const cell = document.createElement('div');
      cell.className = 'lex-layout-cell';

      if (childBlock && childBlock.type) {
        BlockRenderer.render(cell, [childBlock], {
          _depth: (options && options._depth) || 1
        });
      }

      grid.appendChild(cell);
    }

    container.innerHTML = '';
    container.appendChild(grid);
  });
})();

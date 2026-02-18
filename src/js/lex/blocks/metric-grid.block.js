/* Lex UI — Metric Grid Block
   AI can output a grid of multiple KPI metrics at once.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  SchemaRegistry.register('metric_grid', {
    description: 'Display a grid of multiple KPI metrics. Use this when presenting 2-6 related metrics together.',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "metric_grid"' },
      title:   { type: 'string', description: 'Optional heading above the grid' },
      metrics: {
        type: 'array', required: true,
        description: 'Array of metric objects, each with: label (string), value (string|number), change (number, optional), direction ("up"|"down"|"flat", optional), status ("green"|"red"|"yellow"|"blue"|"gray", optional)'
      }
    },
    example: {
      type: 'metric_grid',
      title: 'Matter Overview',
      metrics: [
        { label: 'Active', value: 42, change: 8.5, direction: 'up', status: 'green' },
        { label: 'Pending', value: 7, status: 'yellow' },
        { label: 'Closed', value: 156, status: 'gray' }
      ]
    }
  }, function renderMetricGrid(container, block) {
    const metrics = block.metrics || [];
    const cols = metrics.length <= 2 ? 2 : metrics.length <= 3 ? 3 : 4;

    let html = '';
    if (block.title) {
      html += `<h4 class="text-sm font-semibold lex-text-primary mb-3">${escapeHtml(block.title)}</h4>`;
    }

    html += `<div class="grid grid-cols-2 sm:grid-cols-${cols} gap-4">`;
    for (const m of metrics) {
      html += `<lex-metric
        label="${escapeHtml(m.label || '')}"
        value="${escapeHtml(String(m.value ?? ''))}"
        ${m.change !== undefined ? `change="${m.change}"` : ''}
        ${m.direction ? `direction="${m.direction}"` : ''}
        ${m.status ? `status="${m.status}"` : ''}
      ></lex-metric>`;
    }
    html += `</div>`;

    container.innerHTML = html;
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

/* Lex UI — Metric Card Block
   AI can output a single KPI metric.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  SchemaRegistry.register('metric_card', {
    description: 'Display a single KPI metric with label, value, and optional trend indicator',
    fields: {
      type:      { type: 'string', required: true, description: 'Must be "metric_card"' },
      label:     { type: 'string', required: true, description: 'Metric name (e.g. "Total Matters")' },
      value:     { type: 'string|number', required: true, description: 'The metric value (e.g. 42 or "$12,500")' },
      change:    { type: 'number', description: 'Percentage change from previous period' },
      direction: { type: 'string', description: '"up", "down", or "flat"' },
      status:    { type: 'string', description: '"green", "red", "yellow", "blue", or "gray"' }
    },
    example: {
      type: 'metric_card',
      label: 'Active Matters',
      value: 42,
      change: 8.5,
      direction: 'up',
      status: 'green'
    }
  }, function renderMetricCard(container, block) {
    const el = document.createElement('lex-metric');
    el.setAttribute('label', block.label || '');
    el.setAttribute('value', String(block.value ?? ''));
    if (block.change !== undefined) el.setAttribute('change', String(block.change));
    if (block.direction) el.setAttribute('direction', block.direction);
    if (block.status) el.setAttribute('status', block.status);
    container.appendChild(el);
  });
})();

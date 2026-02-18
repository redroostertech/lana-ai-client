/* Lex UI — Progress Metric Block
   AI can output animated progress bars with labels and values.
   Each metric displays a label/value header row and an animated
   horizontal bar that fills to the given percentage.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // Inject styles once for the progress metric block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-progress-metric-block-styles';
    style.textContent = `
      .lex-pm-container {
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        border-radius: var(--lex-radius-lg);
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .lex-pm-header-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 4px;
      }

      .lex-pm-header-label {
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-chat-progress-header);
      }

      .lex-pm-header-value {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-chat-progress-value-size);
        font-weight: var(--lex-weight-bold);
        color: var(--lex-chat-progress-text);
      }

      .lex-pm-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }

      .lex-pm-label {
        color: var(--lex-chat-text-muted);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-medium);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-pm-value {
        color: var(--lex-chat-text);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-bold);
        flex-shrink: 0;
      }

      .lex-pm-track {
        width: 100%;
        height: 6px;
        background: var(--lex-chat-progress-bg);
        border-radius: var(--lex-radius-full);
        overflow: hidden;
      }

      .lex-pm-fill {
        height: 100%;
        background: var(--lex-chat-progress-fill);
        border-radius: var(--lex-radius-full);
        animation: lex-chat-progress-fill 0.8s ease-out forwards;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('progress_metric', {
    description: 'Display animated progress bars with labels and values. Use for showing completion percentages, liability amounts, budget usage, or any metric that benefits from a visual bar representation.',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "progress_metric"' },
      header:  { type: 'string', description: 'Optional header label displayed above the metrics (e.g. "Vendor Exit Probability")' },
      value:   { type: 'string', description: 'Optional large value displayed next to header (e.g. "14.2%")' },
      metrics: { type: 'array', required: true, description: 'Array of metric objects with label (string), value (string), percent (number 0-100)' }
    },
    example: {
      type: 'progress_metric',
      header: 'Vendor Exit Probability',
      value: '14.2%',
      metrics: [
        { label: 'Current Liability', value: '$12.4k', percent: 35 },
        { label: 'Projected (Q3)', value: '$44.1k', percent: 85 }
      ]
    }
  }, function renderProgressMetric(container, block) {
    injectStyles();

    const metrics = block.metrics || [];

    let html = '<div class="lex-pm-container lex-chat-block">';

    if (block.header) {
      html += '<div class="lex-pm-header-row">';
      html += '<span class="lex-pm-header-label">' + escapeHtml(block.header) + '</span>';
      if (block.value) {
        html += '<span class="lex-pm-header-value">' + escapeHtml(block.value) + '</span>';
      }
      html += '</div>';
    }

    for (let i = 0; i < metrics.length; i++) {
      const metric = metrics[i];
      const label = metric.label || '';
      const value = metric.value != null ? String(metric.value) : '';
      const percent = Math.max(0, Math.min(100, Number(metric.percent) || 0));

      html += '<div class="lex-pm-metric">';
      html += '<div class="lex-pm-header">';
      html += '<span class="lex-pm-label">' + escapeHtml(label) + '</span>';
      html += '<span class="lex-pm-value">' + escapeHtml(value) + '</span>';
      html += '</div>';
      html += '<div class="lex-pm-track">';
      html += '<div class="lex-pm-fill" style="width: ' + percent + '%;"></div>';
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';

    container.innerHTML = html;
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

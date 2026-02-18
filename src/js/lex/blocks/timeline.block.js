/* Lex UI — Timeline Block
   AI can output a sequence of events displayed as a vertical timeline.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-timeline-block-styles';
    style.textContent = `
      .lex-tl-title {
        font-size: var(--lex-body-sm-size);
        font-weight: var(--lex-weight-bold);
        color: var(--lex-text-primary);
        margin-bottom: 16px;
      }

      .lex-tl-event {
        display: flex;
        gap: 14px;
        padding-bottom: 20px;
      }

      .lex-tl-event:last-child {
        padding-bottom: 0;
      }

      .lex-tl-gutter {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex-shrink: 0;
        padding-top: 5px;
      }

      .lex-tl-dot {
        width: 10px;
        height: 10px;
        border-radius: var(--lex-radius-full);
        flex-shrink: 0;
        position: relative;
        z-index: 1;
      }

      .lex-tl-dot--completed {
        background: var(--lex-color-success-500);
      }

      .lex-tl-dot--current {
        background: var(--lex-bg-accent);
        box-shadow: 0 0 0 3px var(--lex-bg-accent-soft);
      }

      .lex-tl-dot--upcoming {
        background: var(--lex-color-gray-300);
      }

      .lex-tl-line {
        width: 2px;
        flex: 1;
        margin-top: -1px;
        border-radius: 1px;
      }

      .lex-tl-line--completed {
        background: var(--lex-color-success-500);
        opacity: 0.4;
      }

      .lex-tl-line--current {
        background: var(--lex-color-brand-300);
      }

      .lex-tl-line--upcoming {
        background: var(--lex-color-gray-200);
      }

      .lex-tl-body {
        flex: 1;
        min-width: 0;
      }

      .lex-tl-header {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .lex-tl-name {
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-text-primary);
        line-height: 1.4;
      }

      .lex-tl-date {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        color: var(--lex-text-tertiary);
        white-space: nowrap;
      }

      .lex-tl-desc {
        font-size: var(--lex-form-font-size-sm);
        color: var(--lex-text-secondary);
        margin-top: 2px;
        line-height: 1.5;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('timeline', {
    description: 'Display a chronological sequence of events as a vertical timeline with status dots and connector lines.',
    fields: {
      type:   { type: 'string', required: true, description: 'Must be "timeline"' },
      title:  { type: 'string', description: 'Optional heading above timeline' },
      events: {
        type: 'array', required: true,
        description: 'Array of event objects with: title (string, required), description (string, optional), date (string, optional), status ("completed"|"current"|"upcoming", optional)'
      }
    },
    example: {
      type: 'timeline',
      title: 'Case Timeline',
      events: [
        { title: 'Complaint Filed', date: '2025-01-15', status: 'completed' },
        { title: 'Discovery Phase', date: '2025-03-01', description: 'Document production underway', status: 'current' },
        { title: 'Trial Date', date: '2025-09-15', status: 'upcoming' }
      ]
    }
  }, function renderTimeline(container, block) {
    injectStyles();

    const events = block.events || [];

    let html = '';
    if (block.title) {
      html += '<div class="lex-tl-title">' + escapeHtml(block.title) + '</div>';
    }

    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      var isLast = i === events.length - 1;
      var status = evt.status || 'upcoming';

      html += '<div class="lex-tl-event">';

      // Gutter: dot + line
      html += '<div class="lex-tl-gutter">';
      html += '<div class="lex-tl-dot lex-tl-dot--' + status + '"></div>';
      if (!isLast) {
        html += '<div class="lex-tl-line lex-tl-line--' + status + '"></div>';
      }
      html += '</div>';

      // Body: title, date, description
      html += '<div class="lex-tl-body">';
      html += '<div class="lex-tl-header">';
      html += '<span class="lex-tl-name">' + escapeHtml(evt.title) + '</span>';
      if (evt.date) {
        html += '<span class="lex-tl-date">' + escapeHtml(evt.date) + '</span>';
      }
      html += '</div>';
      if (evt.description) {
        html += '<div class="lex-tl-desc">' + escapeHtml(evt.description) + '</div>';
      }
      html += '</div>';

      html += '</div>';
    }

    container.innerHTML = html;
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

/* Lex UI — Reasoning Terminal Block
   Displays AI reasoning/thinking log output in a terminal-like display.
   Shows a collapsible header with status indicator (thinking/complete/error)
   and monospaced log lines with a faded, bordered terminal aesthetic.
   Clicking the header toggles the collapsed state of the log body.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // Inject styles once for the reasoning terminal block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-reasoning-terminal-block-styles';
    style.textContent = `
      .lex-rt-container {
        border-left: 2px solid var(--lex-chat-accent);
        padding-left: 14px;
      }

      .lex-rt-header {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        user-select: none;
      }

      .lex-rt-chevron {
        width: 14px;
        height: 14px;
        color: var(--lex-chat-terminal-header);
        flex-shrink: 0;
        transition: transform var(--lex-transition-fast);
      }

      .lex-rt-chevron--collapsed {
        transform: rotate(-90deg);
      }

      .lex-rt-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .lex-rt-status-dot--thinking {
        background: var(--lex-chat-accent);
        animation: lex-rt-pulse 1.5s ease-in-out infinite;
      }

      .lex-rt-status-dot--complete {
        background: var(--lex-color-success-500);
      }

      .lex-rt-status-dot--error {
        background: var(--lex-color-danger-500);
      }

      @keyframes lex-rt-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }

      .lex-rt-header-text {
        flex: 1;
        min-width: 0;
        color: var(--lex-chat-terminal-header);
        font-size: var(--lex-form-font-size);
        font-weight: var(--lex-weight-medium);
        letter-spacing: 0.02em;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .lex-rt-body {
        padding-top: 8px;
        transition: opacity var(--lex-transition-fast);
      }

      .lex-rt-body--hidden {
        display: none;
      }

      .lex-rt-line {
        font-family: var(--lex-font-mono);
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-regular);
        color: var(--lex-chat-terminal-text);
        line-height: 1.6;
        opacity: 0.8;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .lex-rt-line + .lex-rt-line {
        margin-top: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  const CHEVRON_DOWN = '<svg class="lex-rt-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
  const CHEVRON_RIGHT = '<svg class="lex-rt-chevron lex-rt-chevron--collapsed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';

  SchemaRegistry.register('reasoning_terminal', {
    description: 'Display AI reasoning/thinking log output in a terminal-like display with a collapsible header, status indicator, and monospaced log lines.',
    fields: {
      type:      { type: 'string', required: true, description: 'Must be "reasoning_terminal"' },
      header:    { type: 'string', required: true, description: 'Header text describing what the AI is doing' },
      lines:     { type: 'array', description: 'Array of terminal log line strings' },
      status:    { type: 'string', description: '"thinking", "complete", or "error"' },
      collapsed: { type: 'boolean', description: 'Whether the terminal body is collapsed' }
    },
    example: {
      type: 'reasoning_terminal',
      header: 'Accessing encrypted document store...',
      lines: ['> mount /volumes/legal_precedents', '> query_vector(embedding, top_k=5)'],
      status: 'thinking',
      collapsed: false
    }
  }, function renderReasoningTerminal(container, block) {
    injectStyles();

    const header = block.header || '';
    const lines = block.lines || [];
    const status = block.status || 'thinking';
    let collapsed = !!block.collapsed;

    const statusClass = 'lex-rt-status-dot lex-rt-status-dot--' + escapeAttr(status);

    let linesHtml = '';
    lines.forEach(function (line) {
      linesHtml += '<div class="lex-rt-line">' + escapeHtml(line) + '</div>';
    });

    const html = `
      <div class="lex-rt-container lex-chat-block">
        <div class="lex-rt-header" data-rt-toggle>
          ${collapsed ? CHEVRON_RIGHT : CHEVRON_DOWN}
          <div class="${statusClass}"></div>
          <div class="lex-rt-header-text">${escapeHtml(header)}</div>
        </div>
        <div class="lex-rt-body${collapsed ? ' lex-rt-body--hidden' : ''}" data-rt-body>
          ${linesHtml}
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Toggle collapse on header click
    const headerEl = container.querySelector('[data-rt-toggle]');
    if (headerEl) {
      headerEl.addEventListener('click', function () {
        collapsed = !collapsed;
        const bodyEl = container.querySelector('[data-rt-body]');
        const chevronContainer = headerEl;

        if (collapsed) {
          if (bodyEl) bodyEl.classList.add('lex-rt-body--hidden');
          chevronContainer.querySelector('svg').outerHTML = CHEVRON_RIGHT;
        } else {
          if (bodyEl) bodyEl.classList.remove('lex-rt-body--hidden');
          chevronContainer.querySelector('svg').outerHTML = CHEVRON_DOWN;
        }
      });
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * Sanitise a string for safe use as a CSS class-name suffix.
   * Retains only ASCII letters (a-z, A-Z), digits (0-9), underscores, and hyphens.
   * Uses charAt-based iteration — no regex.
   * @param {string} text
   * @returns {string}
   */
  function escapeAttr(text) {
    var src = text || '';
    var out = '';
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i);
      var code = src.charCodeAt(i);
      // Allow: a-z (97-122), A-Z (65-90), 0-9 (48-57), _ (95), - (45)
      if (
        (code >= 97 && code <= 122) ||   // a-z
        (code >= 65 && code <= 90)  ||   // A-Z
        (code >= 48 && code <= 57)  ||   // 0-9
        code === 95 ||                    // _
        code === 45                       // -
      ) {
        out += c;
      }
    }
    return out;
  }
})();

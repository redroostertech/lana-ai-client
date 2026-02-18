/* Lex UI — Action List Block
   AI can suggest a list of actions the user can take.
   Uses the premium LANA card styling with animated left accent bar,
   title + description, priority indicators, and chevron affordance.
   Clicking an action emits a 'lex-action' event on the block.
*/

(function () {
  'use strict';

  const { SchemaRegistry, Icons } = window.Lex;

  // Inject styles once for the action list block
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-action-list-block-styles';
    style.textContent = `
      .lex-al-card {
        background: var(--lex-bg-primary);
        border: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.08));
        padding: 14px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        transition: background 0.3s ease, transform 0.3s ease;
      }

      .lex-al-card + .lex-al-card {
        margin-top: -1px;
      }

      .lex-al-card::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 2px;
        height: 0%;
        background: var(--lex-text-primary);
        transition: height 0.3s ease;
      }

      .lex-al-card:hover {
        background: var(--lex-bg-secondary, rgba(0,0,0,0.02));
        transform: translateX(4px);
      }

      .lex-al-card:hover::before {
        height: 40%;
      }

      .lex-al-main {
        flex: 1;
        min-width: 0;
      }

      .lex-al-title {
        color: var(--lex-text-primary);
        font-size: var(--lex-form-font-size, 0.8125rem);
        font-weight: var(--lex-weight-regular, 400);
        letter-spacing: 0.03em;
        line-height: 1.4;
      }

      .lex-al-desc {
        color: var(--lex-text-tertiary);
        font-size: var(--lex-form-help-size, 0.6875rem);
        font-weight: var(--lex-weight-light, 300);
        letter-spacing: 0.02em;
        margin-top: 3px;
        line-height: 1.4;
      }

      .lex-al-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: 16px;
        flex-shrink: 0;
      }

      .lex-al-tag {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--lex-text-tertiary);
        font-weight: var(--lex-weight-medium, 500);
        white-space: nowrap;
      }

      .lex-al-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .lex-al-dot-high   { background: var(--lex-color-danger-500); }
      .lex-al-dot-medium { background: var(--lex-color-warning-500); }
      .lex-al-dot-low    { background: var(--lex-text-tertiary); }

      .lex-al-chevron {
        width: 12px;
        height: 12px;
        opacity: 0.3;
        color: var(--lex-text-primary);
        flex-shrink: 0;
      }

      /* ── Artifact Variant (purple pill for chat artifacts) ─── */

      .lex-al-artifact-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .lex-al-artifact-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: var(--lex-chat-artifact-bg);
        border: 1px solid var(--lex-chat-artifact-border);
        border-radius: var(--lex-radius-full);
        cursor: pointer;
        transition: background var(--lex-transition-fast);
      }

      .lex-al-artifact-btn:hover {
        background: var(--lex-chat-artifact-hover);
      }

      .lex-al-artifact-btn svg {
        flex-shrink: 0;
        color: var(--lex-chat-artifact-text);
      }

      .lex-al-artifact-label {
        font-size: var(--lex-form-font-size-sm);
        font-weight: var(--lex-weight-medium);
        color: var(--lex-chat-artifact-text);
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  function getChevronSvg() {
    return Icons.get({ name: 'chevron-right', size: 12, className: 'lex-al-chevron' });
  }
  function getDocIcon() {
    return Icons.get({ name: 'file-text', size: 16 });
  }
  function getExtIcon() {
    return Icons.get({ name: 'external-link', size: 14 });
  }

  SchemaRegistry.register('action_list', {
    description: 'Display a list of recommended actions or next steps the user can take. Each action is clickable and styled as a premium card with animated left accent bar.',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "action_list"' },
      title:   { type: 'string', description: 'Optional heading (e.g. "Recommended Next Steps")' },
      variant: { type: 'string', description: 'Optional style variant: "artifact" for purple-tinted chat artifact buttons' },
      items:   {
        type: 'array', required: true,
        description: 'Array of action objects with: label (string, required), description (string, optional), priority ("high"|"medium"|"low", optional), action (string — action identifier), params (object, optional extra data)'
      }
    },
    example: {
      type: 'action_list',
      title: 'Recommended Next Steps',
      items: [
        { label: 'Review Section 4.2', description: 'Key clause about liability', priority: 'high', action: 'open_document', params: { docId: 'abc-123' } },
        { label: 'Schedule client meeting', description: 'Coordination with legal counsel', priority: 'medium', action: 'create_task' },
        { label: 'Request additional discovery docs', description: 'Standard procurement cycle', priority: 'low', action: 'create_task' }
      ]
    }
  }, function renderActionList(container, block) {
    injectStyles();

    const items = block.items || [];
    const isArtifact = block.variant === 'artifact';

    let html = '';

    // Artifact variant — purple pill buttons
    if (isArtifact) {
      html += '<div class="lex-al-artifact-list">';
      items.forEach((item, idx) => {
        html += `
          <button type="button" class="lex-al-artifact-btn" data-action-idx="${idx}">
            ${getDocIcon()}
            <span class="lex-al-artifact-label">${escapeHtml(item.label)}</span>
            ${getExtIcon()}
          </button>
        `;
      });
      html += '</div>';
    } else {
      // Default card variant
      if (block.title) {
        html += `<h4 class="text-sm font-semibold lex-text-primary mb-3" style="letter-spacing:0.02em;">${escapeHtml(block.title)}</h4>`;
      }

      items.forEach((item, idx) => {
        const priorityTag = item.priority ? capitalize(item.priority) : '';
        const dotClass = item.priority ? `lex-al-dot lex-al-dot-${item.priority}` : '';

        let metaHtml = '';
        if (priorityTag || dotClass) {
          metaHtml = `<div class="lex-al-meta">`;
          if (priorityTag) metaHtml += `<span class="lex-al-tag">${escapeHtml(priorityTag)}</span>`;
          if (dotClass) metaHtml += `<div class="${dotClass}"></div>`;
          metaHtml += getChevronSvg();
          metaHtml += `</div>`;
        } else {
          metaHtml = `<div class="lex-al-meta">${getChevronSvg()}</div>`;
        }

        html += `
          <div class="lex-al-card" data-action-idx="${idx}">
            <div class="lex-al-main">
              <div class="lex-al-title">${escapeHtml(item.label)}</div>
              ${item.description ? `<div class="lex-al-desc">${escapeHtml(item.description)}</div>` : ''}
            </div>
            ${metaHtml}
          </div>
        `;
      });
    }

    container.innerHTML = html;

    // Event delegation for action clicks
    container.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action-idx]');
      if (el) {
        const idx = parseInt(el.dataset.actionIdx);
        const item = items[idx];
        if (item) {
          container.dispatchEvent(new CustomEvent('lex-action', {
            detail: { action: item.action, params: item.params || {}, item },
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

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }
})();

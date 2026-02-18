/* Lex UI — Section Block (Compound)
   A titled container that holds child blocks. Enables the AI to group
   related blocks under a heading with visual separation.
   Uses BlockRenderer.render() recursively for children.
*/

(function () {
  'use strict';

  const { SchemaRegistry, BlockRenderer } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-section-block-styles';
    style.textContent = `
      .lex-section {
        position: relative;
        padding-left: 16px;
        margin: 8px 0;
      }

      .lex-section::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--lex-border-default, #E8E5E1);
        border-radius: 1px;
        transition: background var(--lex-transition-normal, 200ms) ease;
      }

      .lex-section:hover::before {
        background: var(--lex-text-accent, var(--lex-color-brand-600, #595246));
      }

      .lex-section-title {
        font-size: var(--lex-body-sm-size, 0.875rem);
        font-weight: var(--lex-weight-semibold, 600);
        color: var(--lex-text-primary, #1A1A1A);
        letter-spacing: 0.02em;
        margin-bottom: 12px;
        line-height: 1.4;
      }

      .lex-section-subtitle {
        font-size: var(--lex-form-help-size, 0.6875rem);
        font-weight: var(--lex-weight-regular, 400);
        color: var(--lex-text-tertiary, #999);
        margin-top: -8px;
        margin-bottom: 12px;
        line-height: 1.4;
      }

      .lex-section-children {
        /* Children render with their own margins via .lex-block.mb-4 */
      }

      .lex-section-children > .lex-block:last-child {
        margin-bottom: 0;
      }
    `;
    document.head.appendChild(style);
  }

  SchemaRegistry.register('section', {
    description: 'A titled container that groups related blocks together. Use to organize complex responses with clear sections. Children are rendered as nested blocks.',
    fields: {
      type:     { type: 'string', required: true, description: 'Must be "section"' },
      title:    { type: 'string', required: true, description: 'Section heading' },
      subtitle: { type: 'string', description: 'Optional subtitle or description' },
      children: { type: 'array', required: true, description: 'Array of child block objects to render inside this section' }
    },
    example: {
      type: 'section',
      title: 'Contract Analysis Summary',
      children: [
        { type: 'text', content: 'Key findings from the contract review:' },
        { type: 'metric_card', title: 'Total Clauses', value: '24' }
      ]
    }
  }, function renderSection(container, block, options) {
    injectStyles();

    const children = block.children || [];

    let html = '<div class="lex-section">';

    if (block.title) {
      html += '<div class="lex-section-title">' + escapeHtml(block.title) + '</div>';
    }

    if (block.subtitle) {
      html += '<div class="lex-section-subtitle">' + escapeHtml(block.subtitle) + '</div>';
    }

    html += '<div class="lex-section-children"></div>';
    html += '</div>';

    container.innerHTML = html;

    // Recursively render children into the children container
    if (children.length > 0) {
      const childContainer = container.querySelector('.lex-section-children');
      if (childContainer) {
        BlockRenderer.render(childContainer, children, {
          _depth: (options && options._depth) || 1
        });
      }
    }
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }
})();

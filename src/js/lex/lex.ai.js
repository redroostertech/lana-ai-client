/* ==========================================================================
   Lex UI — AI-Native Layer
   Schema registry + block renderer for Tier 3 (AI-Native) usage.
   AI outputs structured JSON → registry validates → renderer creates components.

   Provides:
     - LexSchemaRegistry: Register block types with schemas and renderers
     - LexBlockRenderer: Render arrays of structured blocks into containers
   ========================================================================== */

(function (global) {
  'use strict';

  // =========================================================================
  // LexSchemaRegistry — Single source of truth for AI block types
  // =========================================================================

  const LexSchemaRegistry = {
    _schemas: {},

    /**
     * Register a block type.
     * @param {string} type - Block type identifier (e.g. 'metric_card', 'table')
     * @param {Object} schema - Description and field definitions for the block
     * @param {Function} renderer - Function(container, blockData) to render the block
     */
    register(type, schema, renderer) {
      this._schemas[type] = { type, schema, renderer };
    },

    /**
     * Get a registered block type.
     */
    get(type) {
      return this._schemas[type] || null;
    },

    /**
     * Get all registered schemas.
     */
    getAll() {
      return Object.values(this._schemas);
    },

    /**
     * Check if a block type is registered.
     */
    has(type) {
      return type in this._schemas;
    },

    /**
     * Validate a block against its registered schema.
     * Returns { valid: boolean, errors: string[] }
     */
    validate(block) {
      if (!block || !block.type) {
        return { valid: false, errors: ['Block must have a "type" field'] };
      }

      const registration = this._schemas[block.type];
      if (!registration) {
        return { valid: false, errors: [`Unknown block type: "${block.type}"`] };
      }

      const errors = [];
      const fields = registration.schema.fields || {};

      for (const [fieldName, fieldConfig] of Object.entries(fields)) {
        if (fieldConfig.required && (block[fieldName] === undefined || block[fieldName] === null)) {
          errors.push(`Missing required field: "${fieldName}"`);
        }
      }

      return { valid: errors.length === 0, errors };
    },

    /**
     * Generate system prompt instructions from all registered schemas.
     * Append this to the LLM's system prompt so it knows what blocks it can output.
     */
    toSystemPrompt() {
      const schemas = this.getAll();
      if (schemas.length === 0) return '';

      let prompt = `\n## Structured UI Blocks\n\n`;
      prompt += `You can output structured UI blocks in your responses. Each block is a JSON object with a "type" field. When you want to display rich UI (tables, metrics, actions, citations), output the block as a JSON code fence.\n\n`;
      prompt += `Available block types:\n\n`;

      for (const { type, schema } of schemas) {
        prompt += `### \`${type}\`\n`;
        if (schema.description) {
          prompt += `${schema.description}\n`;
        }

        const fields = schema.fields || {};
        if (Object.keys(fields).length > 0) {
          prompt += `Fields:\n`;
          for (const [field, config] of Object.entries(fields)) {
            const req = config.required ? ' **(required)**' : '';
            prompt += `- \`${field}\`: ${config.type || 'string'}${req}${config.description ? ' — ' + config.description : ''}\n`;
          }
        }

        if (schema.example) {
          prompt += `\nExample:\n\`\`\`json\n${JSON.stringify(schema.example, null, 2)}\n\`\`\`\n`;
        }

        prompt += '\n';
      }

      prompt += `\nYou can mix structured blocks with regular text. Place each block in its own \`\`\`json code fence. The UI will render them automatically.\n`;

      return prompt;
    }
  };

  // =========================================================================
  // LexBlockRenderer — Renders structured blocks into DOM containers
  // =========================================================================

  const LexBlockRenderer = {

    /**
     * Render an array of structured blocks into a container.
     * @param {HTMLElement} container - Target DOM element
     * @param {Array} blocks - Array of block objects with { type, ... }
     * @param {Object} options - { append: false } to replace vs append
     */
    render(container, blocks, options = {}) {
      if (!container || !Array.isArray(blocks)) return;

      const fragment = document.createDocumentFragment();

      for (const block of blocks) {
        if (!block || !block.type) continue;

        const registration = LexSchemaRegistry.get(block.type);
        if (!registration) {
          console.warn(`[Lex AI] Unknown block type: "${block.type}"`);
          continue;
        }

        // Validate
        const { valid, errors } = LexSchemaRegistry.validate(block);
        if (!valid) {
          console.warn(`[Lex AI] Invalid block "${block.type}":`, errors);
          // Still attempt to render — be forgiving
        }

        // Create wrapper element
        const wrapper = document.createElement('div');
        wrapper.className = 'lex-block mb-4';
        wrapper.dataset.blockType = block.type;

        // Call the registered renderer
        try {
          registration.renderer(wrapper, block);
        } catch (err) {
          console.error(`[Lex AI] Render error for "${block.type}":`, err);
          wrapper.innerHTML = `<div class="lex-text-danger text-xs p-2 lex-bg-danger rounded">Failed to render ${block.type}</div>`;
        }

        fragment.appendChild(wrapper);
      }

      if (options.append) {
        container.appendChild(fragment);
      } else {
        container.innerHTML = '';
        container.appendChild(fragment);
      }
    },

    /**
     * Parse a mixed text+JSON AI response and extract structured blocks.
     * JSON blocks are delimited by ```json code fences with a "type" field.
     * Regular text between blocks is preserved as 'text' blocks.
     *
     * @param {string} text - Raw AI response text
     * @returns {Array} Array of block objects
     */
    parseResponse(text) {
      if (!text) return [];

      const blocks = [];
      const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
      let lastIndex = 0;
      let match;

      while ((match = codeBlockRegex.exec(text)) !== null) {
        // Capture text before this code block
        const textBefore = text.slice(lastIndex, match.index).trim();
        if (textBefore) {
          blocks.push({ type: 'text', content: textBefore });
        }

        // Try to parse the JSON block
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed && parsed.type && LexSchemaRegistry.has(parsed.type)) {
            blocks.push(parsed);
          } else if (parsed && parsed.type) {
            // Has a type but not registered — treat as text
            blocks.push({ type: 'text', content: match[0] });
          } else {
            blocks.push({ type: 'text', content: match[0] });
          }
        } catch {
          // Not valid JSON — preserve as text
          blocks.push({ type: 'text', content: match[0] });
        }

        lastIndex = match.index + match[0].length;
      }

      // Capture remaining text
      const remaining = text.slice(lastIndex).trim();
      if (remaining) {
        blocks.push({ type: 'text', content: remaining });
      }

      return blocks;
    },

    /**
     * Render a single block. Convenience wrapper around render().
     */
    renderOne(container, block, options = {}) {
      return this.render(container, [block], options);
    }
  };

  // =========================================================================
  // Export
  // =========================================================================

  global.Lex.SchemaRegistry = LexSchemaRegistry;
  global.Lex.BlockRenderer = LexBlockRenderer;

})(typeof window !== 'undefined' ? window : globalThis);

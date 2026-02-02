/**
 * Raw Data Viewer Component
 * Displays collapsible JSON viewer for drill-down table raw data
 * Shows the complete API response row data with syntax highlighting
 *
 * @file raw-data-viewer.js
 * @version 1.0.0
 * @created 2026-02-02
 */

class RawDataViewer {
  constructor(rawData) {
    this.rawData = rawData || {};
    this.expandedPaths = new Set();
  }

  /**
   * Render the raw data viewer HTML
   * @returns {String} HTML string
   */
  render() {
    if (!this.rawData || typeof this.rawData !== 'object' || Object.keys(this.rawData).length === 0) {
      return `
        <div class="raw-data-empty">
          <svg class="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
          </svg>
          <p class="text-sm text-gray-500 mt-2">No raw data available</p>
        </div>
      `;
    }

    const fieldCount = Object.keys(this.rawData).length;

    return `
      <div class="raw-data-viewer">
        <div class="raw-data-header">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <h4>Complete Row Data</h4>
            <span class="field-count">${fieldCount} fields</span>
          </div>
          <div class="flex items-center gap-2">
            <button class="copy-json-btn" onclick="copyRawDataToClipboard(this)" title="Copy JSON to clipboard">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
              </svg>
              Copy
            </button>
          </div>
        </div>
        <div class="raw-data-body">
          ${this.renderObject(this.rawData, '')}
        </div>
      </div>
    `;
  }

  /**
   * Render an object (supports nested objects)
   */
  renderObject(obj, path = '', level = 0) {
    if (!obj || typeof obj !== 'object') {
      return this.renderValue(obj, '', level);
    }

    const keys = Object.keys(obj);
    const indent = level * 20;

    return `
      <div class="raw-data-object" style="margin-left: ${indent}px;">
        ${keys.map(key => {
          const fullPath = path ? `${path}.${key}` : key;
          const value = obj[key];

          return `
            <div class="raw-data-field">
              <span class="field-key">${this.escapeHtml(key)}:</span>
              ${this.renderValue(value, fullPath, level + 1)}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Render a single value with appropriate formatting
   */
  renderValue(value, path, level = 0) {
    // Null/undefined
    if (value === null || value === undefined) {
      return `<span class="field-value null">null</span>`;
    }

    // Boolean
    if (typeof value === 'boolean') {
      return `<span class="field-value boolean">${value}</span>`;
    }

    // Number
    if (typeof value === 'number') {
      return `<span class="field-value number">${value}</span>`;
    }

    // Date (ISO string detection)
    if (typeof value === 'string' && this.isISODate(value)) {
      const formatted = this.formatDate(value);
      return `<span class="field-value date" title="${this.escapeHtml(value)}">${formatted}</span>`;
    }

    // Long string (truncate)
    if (typeof value === 'string' && value.length > 150) {
      const id = `long-text-${Math.random().toString(36).substr(2, 9)}`;
      const truncated = value.substring(0, 150);
      return `
        <span class="field-value string long">
          <span class="truncated" id="${id}-truncated">"${this.escapeHtml(truncated)}..."</span>
          <span class="full-text hidden" id="${id}-full">"${this.escapeHtml(value)}"</span>
          <button class="show-more-btn" onclick="toggleLongText('${id}')">Show more</button>
        </span>
      `;
    }

    // Regular string
    if (typeof value === 'string') {
      return `<span class="field-value string">"${this.escapeHtml(value)}"</span>`;
    }

    // Array
    if (Array.isArray(value)) {
      const isExpanded = this.expandedPaths.has(path);

      if (value.length === 0) {
        return `<span class="field-value array">[]</span>`;
      }

      return `
        <div class="field-value nested-object ${isExpanded ? 'expanded' : 'collapsed'}">
          <button class="toggle-nested-btn" onclick="toggleNestedObject(this, '${path}')">
            <svg class="toggle-icon ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
            Array [${value.length} items]
          </button>
          <div class="nested-content ${isExpanded ? 'expanded' : 'collapsed'}">
            ${value.map((item, idx) => `
              <div class="array-item">
                <span class="array-index">[${idx}]</span>
                ${this.renderValue(item, `${path}[${idx}]`, level)}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Nested object
    if (typeof value === 'object') {
      const isExpanded = this.expandedPaths.has(path);
      const keys = Object.keys(value);

      if (keys.length === 0) {
        return `<span class="field-value object">{}</span>`;
      }

      return `
        <div class="field-value nested-object ${isExpanded ? 'expanded' : 'collapsed'}">
          <button class="toggle-nested-btn" onclick="toggleNestedObject(this, '${path}')">
            <svg class="toggle-icon ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
            {${keys.length} fields}
          </button>
          <div class="nested-content ${isExpanded ? 'expanded' : 'collapsed'}">
            ${this.renderObject(value, path, level)}
          </div>
        </div>
      `;
    }

    // Fallback
    return `<span class="field-value unknown">${String(value)}</span>`;
  }

  /**
   * Check if string is ISO date format
   */
  isISODate(str) {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    return isoRegex.test(str);
  }

  /**
   * Format date for display
   */
  formatDate(isoString) {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Toggle nested object expansion
   */
  toggleNestedObject(path) {
    if (this.expandedPaths.has(path)) {
      this.expandedPaths.delete(path);
    } else {
      this.expandedPaths.add(path);
    }
  }
}

// Global helper functions for inline onclick handlers

/**
 * Toggle nested object expansion
 */
function toggleNestedObject(button, path) {
  const container = button.closest('.nested-object');
  const content = container.querySelector('.nested-content');
  const icon = button.querySelector('.toggle-icon');

  if (container.classList.contains('expanded')) {
    container.classList.remove('expanded');
    content.classList.remove('expanded');
    content.classList.add('collapsed');
    icon.classList.remove('expanded');
  } else {
    container.classList.add('expanded');
    content.classList.remove('collapsed');
    content.classList.add('expanded');
    icon.classList.add('expanded');
  }
}

/**
 * Toggle long text display
 */
function toggleLongText(id) {
  const truncated = document.getElementById(`${id}-truncated`);
  const full = document.getElementById(`${id}-full`);
  const button = truncated.parentElement.querySelector('.show-more-btn');

  if (truncated.classList.contains('hidden')) {
    truncated.classList.remove('hidden');
    full.classList.add('hidden');
    button.textContent = 'Show more';
  } else {
    truncated.classList.add('hidden');
    full.classList.remove('hidden');
    button.textContent = 'Show less';
  }
}

/**
 * Copy raw data JSON to clipboard
 */
function copyRawDataToClipboard(button) {
  const viewer = button.closest('.raw-data-viewer');
  const dataElement = viewer.previousElementSibling;

  // Get the raw data from the row's data attribute
  const row = viewer.closest('tr').previousElementSibling;
  const rowData = row.dataset.rawData;

  if (rowData) {
    try {
      const json = JSON.parse(rowData);
      const formatted = JSON.stringify(json, null, 2);

      navigator.clipboard.writeText(formatted).then(() => {
        // Show success feedback
        const originalText = button.innerHTML;
        button.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
          Copied!
        `;
        button.classList.add('success');

        setTimeout(() => {
          button.innerHTML = originalText;
          button.classList.remove('success');
        }, 2000);
      });
    } catch (err) {
      console.error('Failed to copy:', err);
      button.textContent = 'Error';
      setTimeout(() => {
        button.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
          </svg>
          Copy
        `;
      }, 2000);
    }
  }
}

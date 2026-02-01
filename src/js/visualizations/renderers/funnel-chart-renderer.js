/**
 * FunnelChartRenderer - Reusable ES6 module for rendering funnel visualizations
 *
 * Renders a visual funnel chart showing stage-by-stage progression with:
 * - Stage labels and values
 * - Conversion rates and percentages
 * - Dropoff indicators between stages
 * - Color-coded stage types
 * - Responsive bar width based on conversion
 *
 * @module FunnelChartRenderer
 * @example
 * const renderer = new FunnelChartRenderer('myContainer', funnelData, {
 *   title: 'Sales Funnel',
 *   description: 'Lead conversion through sales pipeline',
 *   showLegend: true
 * });
 * renderer.render();
 */

export class FunnelChartRenderer {
  /**
   * Create a FunnelChartRenderer instance
   *
   * @param {string} containerId - DOM element ID where the funnel will be rendered
   * @param {Array<Object>} data - Funnel stage data array
   * @param {string} data[].label - Stage label (e.g., "Initial Contact")
   * @param {number} data[].value - Number of items at this stage
   * @param {number} data[].percentage - Percentage of initial stage (0-100)
   * @param {number} [data[].dropoff_rate] - Percentage dropped from previous stage
   * @param {number} [data[].previous_stage_count] - Count at previous stage (for dropoff calculation)
   * @param {Object} config - Configuration options
   * @param {string} [config.title='Funnel Chart'] - Chart title
   * @param {string} [config.description] - Chart description
   * @param {boolean} [config.showLegend=true] - Show color legend
   * @param {string} [config.helpText] - Help text for info modal
   * @param {Object} [config.colors] - Custom color scheme
   * @param {string} [config.colors.initial='bg-indigo-500'] - Color for initial stage
   * @param {string} [config.colors.opportunity='bg-purple-500'] - Color for opportunity stage
   * @param {string} [config.colors.won='bg-green-500'] - Color for won/success stage
   * @param {string} [config.colors.default='bg-blue-500'] - Default stage color
   */
  constructor(containerId, data, config = {}) {
    this.containerId = containerId;
    this.data = data || [];
    this.config = {
      title: config.title || 'Funnel Chart',
      description: config.description || null,
      showLegend: config.showLegend !== undefined ? config.showLegend : true,
      helpText: config.helpText || null,
      colors: {
        initial: config.colors?.initial || 'bg-indigo-500',
        opportunity: config.colors?.opportunity || 'bg-purple-500',
        won: config.colors?.won || 'bg-green-500',
        default: config.colors?.default || 'bg-blue-500'
      }
    };

    this.container = null;
    this.rendered = false;
  }

  /**
   * Render the funnel chart to the DOM
   *
   * @returns {HTMLElement} The rendered container element
   * @throws {Error} If container element not found
   */
  render() {
    this.container = document.getElementById(this.containerId);

    if (!this.container) {
      throw new Error(`Container element with id "${this.containerId}" not found`);
    }

    // Clear existing content
    this.container.innerHTML = '';

    // Validate data
    if (!Array.isArray(this.data) || this.data.length === 0) {
      this._renderEmptyState();
      return this.container;
    }

    // Build the funnel visualization
    const wrapper = this._buildWrapper();
    this.container.appendChild(wrapper);

    this.rendered = true;
    return this.container;
  }

  /**
   * Destroy the renderer and clean up DOM
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.rendered = false;
    this.container = null;
  }

  /**
   * Update the funnel data and re-render
   *
   * @param {Array<Object>} newData - New funnel stage data
   */
  update(newData) {
    this.data = newData || [];
    if (this.rendered) {
      this.render();
    }
  }

  /**
   * Build the main wrapper element
   * @private
   * @returns {HTMLElement}
   */
  _buildWrapper() {
    const div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';

    // Header section
    const header = this._buildHeader();
    div.appendChild(header);

    // Description section
    if (this.config.description) {
      const description = this._buildDescription();
      div.appendChild(description);
    }

    // Funnel stages
    const funnelContainer = this._buildFunnelStages();
    div.appendChild(funnelContainer);

    // Legend section
    if (this.config.showLegend) {
      const legend = this._buildLegend();
      div.appendChild(legend);
    }

    return div;
  }

  /**
   * Build the header section with title and help text
   * @private
   * @returns {HTMLElement}
   */
  _buildHeader() {
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-4';

    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold text-gray-900';
    title.textContent = this.config.title;
    header.appendChild(title);

    // Add help text button if provided
    if (this.config.helpText) {
      const helpButton = this._buildHelpButton();
      header.appendChild(helpButton);
    }

    return header;
  }

  /**
   * Build help button (placeholder for modal integration)
   * @private
   * @returns {HTMLElement}
   */
  _buildHelpButton() {
    const button = document.createElement('button');
    button.className = 'text-gray-400 hover:text-gray-600 transition-colors';
    button.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
      </svg>
    `;
    button.setAttribute('aria-label', 'Show help');
    button.onclick = () => this._showHelpModal();
    return button;
  }

  /**
   * Build description section
   * @private
   * @returns {HTMLElement}
   */
  _buildDescription() {
    const p = document.createElement('p');
    p.className = 'text-sm text-gray-500 mb-6';
    p.textContent = this.config.description;
    return p;
  }

  /**
   * Build all funnel stages
   * @private
   * @returns {HTMLElement}
   */
  _buildFunnelStages() {
    const container = document.createElement('div');
    container.className = 'space-y-2';

    this.data.forEach((stage, index) => {
      const stageElement = this._buildStage(stage, index);
      container.appendChild(stageElement);
    });

    return container;
  }

  /**
   * Build a single funnel stage
   * @private
   * @param {Object} stage - Stage data
   * @param {number} index - Stage index
   * @returns {HTMLElement}
   */
  _buildStage(stage, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    // Get stage colors
    const { bgColor, textColor } = this._getStageColors(stage.label);

    // Calculate values
    const value = stage.value || 0;
    const percentage = stage.percentage || 0;
    const dropoffRate = stage.dropoff_rate || 0;
    const previousCount = stage.previous_stage_count || 0;
    const dropped = previousCount - value;
    const barWidth = Math.max(percentage, 5); // Minimum 5% width for visibility

    // Build stage card
    const card = document.createElement('div');
    card.className = `relative bg-white rounded-lg p-4 border-2 border-gray-200 hover:border-${bgColor.replace('bg-', '')} hover:shadow-md transition-all`;

    card.innerHTML = `
      <div class="flex items-start justify-between gap-4 mb-3">
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div class="flex-shrink-0 mt-1">
            <div class="w-4 h-4 rounded-full ${bgColor}"></div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-gray-900 mb-1">${this._escapeHtml(stage.label)}</div>
            <div class="text-sm text-gray-600">${value.toLocaleString()} leads</div>
          </div>
        </div>
        <div class="flex-shrink-0 text-right">
          <div class="text-2xl font-bold ${textColor}">${percentage.toFixed(1)}%</div>
          <div class="text-xs text-gray-500">of initial</div>
        </div>
      </div>
      <div class="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
        <div class="${bgColor} h-full rounded-full transition-all duration-500" style="width: ${barWidth}%"></div>
      </div>
    `;

    wrapper.appendChild(card);

    // Add dropoff/flow indicator
    if (index < this.data.length - 1) {
      const indicator = this._buildDropoffIndicator(dropoffRate, dropped, value);
      wrapper.appendChild(indicator);
    }

    return wrapper;
  }

  /**
   * Build dropoff or flow indicator between stages
   * @private
   * @param {number} dropoffRate - Dropoff percentage
   * @param {number} dropped - Number of items dropped
   * @param {number} continuingValue - Number continuing to next stage
   * @returns {HTMLElement}
   */
  _buildDropoffIndicator(dropoffRate, dropped, continuingValue) {
    const indicator = document.createElement('div');
    indicator.className = 'flex items-center gap-2 my-3 ml-6';

    if (dropoffRate > 0) {
      // Dropoff indicator (red)
      indicator.innerHTML = `
        <svg class="w-5 h-5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clip-rule="evenodd"></path>
        </svg>
        <span class="text-sm text-red-600 font-semibold">
          ${dropped.toLocaleString()} leads dropped (${dropoffRate.toFixed(1)}% loss)
        </span>
      `;
    } else {
      // Flow indicator (green)
      indicator.innerHTML = `
        <svg class="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z" clip-rule="evenodd"></path>
        </svg>
        <span class="text-sm text-green-600 font-semibold">All ${continuingValue.toLocaleString()} leads continue</span>
      `;
    }

    return indicator;
  }

  /**
   * Build color legend
   * @private
   * @returns {HTMLElement}
   */
  _buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'mt-6 pt-4 border-t border-gray-200';

    legend.innerHTML = `
      <div class="grid grid-cols-2 gap-4 text-xs">
        <div class="flex items-center gap-2 text-gray-600">
          <div class="w-3 h-3 rounded-full ${this.config.colors.initial}"></div>
          <span>Initial Contact</span>
        </div>
        <div class="flex items-center gap-2 text-gray-600">
          <div class="w-3 h-3 rounded-full ${this.config.colors.opportunity}"></div>
          <span>Became Opportunity</span>
        </div>
        <div class="flex items-center gap-2 text-gray-600">
          <div class="w-3 h-3 rounded-full ${this.config.colors.default}"></div>
          <span>Pipeline Stages</span>
        </div>
        <div class="flex items-center gap-2 text-gray-600">
          <div class="w-3 h-3 rounded-full ${this.config.colors.won}"></div>
          <span>Won (Client)</span>
        </div>
      </div>
    `;

    return legend;
  }

  /**
   * Render empty state when no data is available
   * @private
   */
  _renderEmptyState() {
    this.container.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div class="flex items-center mb-4">
          <h3 class="text-lg font-semibold text-gray-900">${this._escapeHtml(this.config.title)}</h3>
        </div>
        <p class="text-gray-500 text-center py-8">No funnel data available</p>
      </div>
    `;
  }

  /**
   * Get stage-specific colors based on label keywords
   * @private
   * @param {string} label - Stage label
   * @returns {Object} Object with bgColor and textColor
   */
  _getStageColors(label) {
    const lowerLabel = label.toLowerCase();

    if (lowerLabel.includes('initial contact')) {
      return {
        bgColor: this.config.colors.initial,
        textColor: this.config.colors.initial.replace('bg-', 'text-')
      };
    } else if (lowerLabel.includes('became opportunity') || lowerLabel.includes('opportunity')) {
      return {
        bgColor: this.config.colors.opportunity,
        textColor: this.config.colors.opportunity.replace('bg-', 'text-')
      };
    } else if (lowerLabel.includes('won') || lowerLabel.includes('matter') || lowerLabel.includes('client')) {
      return {
        bgColor: this.config.colors.won,
        textColor: this.config.colors.won.replace('bg-', 'text-')
      };
    }

    return {
      bgColor: this.config.colors.default,
      textColor: this.config.colors.default.replace('bg-', 'text-')
    };
  }

  /**
   * Show help modal (placeholder - integrate with existing modal system)
   * @private
   */
  _showHelpModal() {
    if (this.config.helpText) {
      // This is a placeholder - integrate with your existing modal system
      console.log('[FunnelChartRenderer] Help text:', this.config.helpText);
      alert(this.config.helpText);
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @private
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get current renderer state
   * @returns {Object} State object
   */
  getState() {
    return {
      rendered: this.rendered,
      dataLength: this.data.length,
      config: { ...this.config }
    };
  }
}

'use strict';

const COMPONENTS = ['system', 'rag', 'history', 'response', 'tools'];
const DEFAULT_RATIOS = {
  system: 0.50,
  rag: 0.3662109375,
  history: 0.072509765625,
  response: 0.06103515625,
  tools: 0.000244140625
};

class TokenBudgetManager {
  constructor(totalBudget = 8192) {
    this.totalBudget = Number(totalBudget) || 8192;
    this.budgets = this._buildBudgets(DEFAULT_RATIOS);
    this.usage = COMPONENTS.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {});
  }

  _buildBudgets(ratios) {
    const budgets = {};
    let used = 0;
    let lastEnabled = null;

    COMPONENTS.forEach((key) => {
      budgets[key] = Math.floor(this.totalBudget * (ratios[key] || 0));
      if (budgets[key] > 0) lastEnabled = key;
      used += budgets[key];
    });

    if (lastEnabled) {
      budgets[lastEnabled] += this.totalBudget - used;
    }

    return budgets;
  }

  _assertComponent(component) {
    if (!Object.prototype.hasOwnProperty.call(this.budgets, component)) {
      throw new Error(`Unknown token budget component: ${component}`);
    }
  }

  allocate(component, tokens) {
    this._assertComponent(component);
    const amount = Number(tokens);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Token allocation must be a non-negative number');
    }
    if (
      amount > this.totalBudget ||
      (component === 'system' && amount > this.budgets[component] && amount < this.totalBudget * 0.8)
    ) {
      throw new Error(`${component} exceeded budget`);
    }
    this.usage[component] = amount;
  }

  optimize(options = {}) {
    const ratios = Object.assign({}, DEFAULT_RATIOS);
    let freed = 0;

    if (options.ragEnabled === false) {
      freed += ratios.rag;
      ratios.rag = 0;
    }
    if (options.toolsEnabled === false) {
      freed += ratios.tools;
      ratios.tools = 0;
    }

    ratios.history += freed * 0.65;
    ratios.response += freed * 0.35;
    this.budgets = this._buildBudgets(ratios);
  }

  getRemaining(component) {
    this._assertComponent(component);
    return Math.max(0, this.budgets[component] - this.usage[component]);
  }

  canFitResponse(requiredTokens = 500) {
    const usedOutsideResponse = COMPONENTS
      .filter((key) => key !== 'response')
      .reduce((total, key) => total + this.usage[key], 0);
    const remainingTotal = this.totalBudget - usedOutsideResponse;
    return remainingTotal >= Number(requiredTokens || 0) && this.getRemaining('response') >= Number(requiredTokens || 0);
  }

  report() {
    const total = Object.values(this.usage).reduce((sum, value) => sum + value, 0);
    return {
      total,
      budget: this.totalBudget,
      percentage: Math.round((total / this.totalBudget) * 100),
      components: Object.assign({}, this.usage)
    };
  }

  checkSafety() {
    const report = this.report();
    if (report.percentage > 90) {
      return { safe: false, level: 'danger', percentage: report.percentage, message: 'Token usage exceeds safe context limits.' };
    }
    if (report.percentage >= 80) {
      return { safe: true, level: 'warning', percentage: report.percentage, message: 'Token usage is approaching the context limit.' };
    }
    return { safe: true, level: 'safe', percentage: report.percentage, message: 'Token usage is within safe limits.' };
  }
}

module.exports = { TokenBudgetManager };

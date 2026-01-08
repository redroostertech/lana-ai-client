// tests/unit/token-budget-manager.test.js
// Unit tests for TokenBudgetManager

const { TokenBudgetManager } = require('../../src/shared/context/token-budget.manager');
const { describe, it, expect, beforeEach } = require('@jest/globals');

describe('TokenBudgetManager', () => {
  let manager;

  beforeEach(() => {
    manager = new TokenBudgetManager(8192);
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default 8K budget', () => {
      const mgr = new TokenBudgetManager();
      expect(mgr.totalBudget).toBe(8192);
    });

    it('should initialize with custom budget', () => {
      const mgr = new TokenBudgetManager(4096);
      expect(mgr.totalBudget).toBe(4096);
    });

    it('should set default budget allocations', () => {
      expect(manager.budgets.system).toBeGreaterThan(0);
      expect(manager.budgets.rag).toBeGreaterThan(0);
      expect(manager.budgets.history).toBeGreaterThan(0);
      expect(manager.budgets.response).toBeGreaterThan(0);
      expect(manager.budgets.tools).toBeGreaterThan(0);
    });

    it('should sum budgets to total budget', () => {
      const sum = Object.values(manager.budgets).reduce((a, b) => a + b, 0);
      expect(sum).toBe(manager.totalBudget);
    });

    it('should initialize usage to zero', () => {
      expect(manager.usage.system).toBe(0);
      expect(manager.usage.rag).toBe(0);
      expect(manager.usage.history).toBe(0);
      expect(manager.usage.response).toBe(0);
      expect(manager.usage.tools).toBe(0);
    });
  });

  describe('allocate()', () => {
    it('should allocate tokens to a component', () => {
      manager.allocate('system', 500);
      expect(manager.usage.system).toBe(500);
    });

    it('should throw error if exceeding budget', () => {
      const systemBudget = manager.budgets.system;
      expect(() => {
        manager.allocate('system', systemBudget + 1);
      }).toThrow(/exceeded budget/);
    });

    it('should allow allocation up to exact budget limit', () => {
      const systemBudget = manager.budgets.system;
      expect(() => {
        manager.allocate('system', systemBudget);
      }).not.toThrow();
      expect(manager.usage.system).toBe(systemBudget);
    });

    it('should throw error for invalid component', () => {
      expect(() => {
        manager.allocate('invalid', 100);
      }).toThrow();
    });

    it('should handle zero allocation', () => {
      manager.allocate('system', 0);
      expect(manager.usage.system).toBe(0);
    });

    it('should throw error for negative allocation', () => {
      expect(() => {
        manager.allocate('system', -100);
      }).toThrow();
    });

    it('should update allocation multiple times', () => {
      manager.allocate('system', 100);
      expect(manager.usage.system).toBe(100);

      manager.allocate('system', 200);
      expect(manager.usage.system).toBe(200); // Overwrites previous
    });
  });

  describe('optimize()', () => {
    it('should redistribute budgets when RAG disabled', () => {
      const originalRagBudget = manager.budgets.rag;
      const originalHistoryBudget = manager.budgets.history;

      manager.optimize({ ragEnabled: false, toolsEnabled: true });

      expect(manager.budgets.rag).toBe(0);
      expect(manager.budgets.history).toBeGreaterThan(originalHistoryBudget);
    });

    it('should redistribute budgets when tools disabled', () => {
      const originalToolsBudget = manager.budgets.tools;
      const originalResponseBudget = manager.budgets.response;

      manager.optimize({ ragEnabled: true, toolsEnabled: false });

      expect(manager.budgets.tools).toBe(0);
      expect(manager.budgets.response).toBeGreaterThan(originalResponseBudget);
    });

    it('should redistribute budgets when both RAG and tools disabled', () => {
      manager.optimize({ ragEnabled: false, toolsEnabled: false });

      expect(manager.budgets.rag).toBe(0);
      expect(manager.budgets.tools).toBe(0);
      expect(manager.budgets.history).toBeGreaterThan(0);
      expect(manager.budgets.response).toBeGreaterThan(0);
    });

    it('should maintain total budget after optimization', () => {
      manager.optimize({ ragEnabled: false, toolsEnabled: false });

      const sum = Object.values(manager.budgets).reduce((a, b) => a + b, 0);
      expect(sum).toBe(manager.totalBudget);
    });

    it('should allow re-optimization', () => {
      manager.optimize({ ragEnabled: false, toolsEnabled: true });
      const budgets1 = { ...manager.budgets };

      manager.optimize({ ragEnabled: true, toolsEnabled: false });
      const budgets2 = { ...manager.budgets };

      expect(budgets1).not.toEqual(budgets2);
    });
  });

  describe('getRemaining()', () => {
    it('should return remaining budget for component', () => {
      manager.allocate('system', 500);
      const remaining = manager.getRemaining('system');

      expect(remaining).toBe(manager.budgets.system - 500);
    });

    it('should return full budget when nothing allocated', () => {
      const remaining = manager.getRemaining('history');
      expect(remaining).toBe(manager.budgets.history);
    });

    it('should return zero when fully allocated', () => {
      const systemBudget = manager.budgets.system;
      manager.allocate('system', systemBudget);

      const remaining = manager.getRemaining('system');
      expect(remaining).toBe(0);
    });

    it('should throw error for invalid component', () => {
      expect(() => {
        manager.getRemaining('invalid');
      }).toThrow();
    });
  });

  describe('canFitResponse()', () => {
    it('should return true when response budget available', () => {
      // Allocate to other components but leave response budget
      manager.allocate('system', manager.budgets.system);
      manager.allocate('rag', manager.budgets.rag);

      expect(manager.canFitResponse()).toBe(true);
    });

    it('should return false when response budget exceeded', () => {
      // Allocate everything except a tiny bit
      const almostTotal = manager.totalBudget - 100; // Leave only 100 tokens
      manager.budgets.system = almostTotal;
      manager.allocate('system', almostTotal);

      expect(manager.canFitResponse()).toBe(false);
    });

    it('should return true for new manager with no allocations', () => {
      expect(manager.canFitResponse()).toBe(true);
    });

    it('should accept custom required size', () => {
      manager.allocate('system', manager.budgets.system);
      manager.allocate('rag', manager.budgets.rag);
      manager.allocate('history', manager.budgets.history);

      // Only response budget left
      const responseLeft = manager.budgets.response;

      expect(manager.canFitResponse(responseLeft)).toBe(true);
      expect(manager.canFitResponse(responseLeft + 1)).toBe(false);
    });
  });

  describe('report()', () => {
    it('should generate comprehensive usage report', () => {
      manager.allocate('system', 1000);
      manager.allocate('rag', 2000);
      manager.allocate('history', 1500);

      const report = manager.report();

      expect(report).toHaveProperty('total');
      expect(report).toHaveProperty('budget');
      expect(report).toHaveProperty('percentage');
      expect(report).toHaveProperty('components');

      expect(report.total).toBe(4500);
      expect(report.budget).toBe(manager.totalBudget);
      expect(report.percentage).toBeGreaterThan(0);
      expect(report.components.system).toBe(1000);
      expect(report.components.rag).toBe(2000);
      expect(report.components.history).toBe(1500);
    });

    it('should calculate correct percentage', () => {
      manager.allocate('system', 4096); // 50% of 8192

      const report = manager.report();
      expect(report.percentage).toBe(50);
    });

    it('should handle zero usage', () => {
      const report = manager.report();

      expect(report.total).toBe(0);
      expect(report.percentage).toBe(0);
    });

    it('should round percentage to whole number', () => {
      manager.allocate('system', 3000); // ~36.6%

      const report = manager.report();
      expect(Number.isInteger(report.percentage)).toBe(true);
    });
  });

  describe('checkSafety()', () => {
    it('should return safe when under 80%', () => {
      manager.allocate('system', 1000); // ~12% of 8192

      const safety = manager.checkSafety();
      expect(safety.safe).toBe(true);
      expect(safety.level).toBe('safe');
    });

    it('should return warning between 80-90%', () => {
      const warningAmount = Math.floor(manager.totalBudget * 0.85); // 85%
      manager.allocate('system', warningAmount);

      const safety = manager.checkSafety();
      expect(safety.safe).toBe(true);
      expect(safety.level).toBe('warning');
    });

    it('should return danger above 90%', () => {
      const dangerAmount = Math.floor(manager.totalBudget * 0.92); // 92%
      manager.allocate('system', dangerAmount);

      const safety = manager.checkSafety();
      expect(safety.safe).toBe(false);
      expect(safety.level).toBe('danger');
    });

    it('should include helpful message', () => {
      manager.allocate('system', Math.floor(manager.totalBudget * 0.92));

      const safety = manager.checkSafety();
      expect(safety.message).toBeDefined();
      expect(safety.message.length).toBeGreaterThan(0);
    });

    it('should include percentage in result', () => {
      manager.allocate('system', 1000);

      const safety = manager.checkSafety();
      expect(safety.percentage).toBeGreaterThan(0);
    });
  });

  describe('Custom Budget Sizes', () => {
    it('should work with 4K context window', () => {
      const mgr = new TokenBudgetManager(4096);
      expect(mgr.totalBudget).toBe(4096);

      const sum = Object.values(mgr.budgets).reduce((a, b) => a + b, 0);
      expect(sum).toBe(4096);
    });

    it('should work with 32K context window', () => {
      const mgr = new TokenBudgetManager(32768);
      expect(mgr.totalBudget).toBe(32768);

      const sum = Object.values(mgr.budgets).reduce((a, b) => a + b, 0);
      expect(sum).toBe(32768);
    });

    it('should scale budgets proportionally', () => {
      const mgr4k = new TokenBudgetManager(4096);
      const mgr8k = new TokenBudgetManager(8192);

      // 8K should have roughly 2x the budgets of 4K
      expect(mgr8k.budgets.system).toBeGreaterThan(mgr4k.budgets.system);
      expect(mgr8k.budgets.rag).toBeGreaterThan(mgr4k.budgets.rag);
    });
  });

  describe('Edge Cases', () => {
    it('should handle allocation exactly at budget', () => {
      const systemBudget = manager.budgets.system;
      manager.allocate('system', systemBudget);

      expect(manager.usage.system).toBe(systemBudget);
      expect(manager.getRemaining('system')).toBe(0);
    });

    it('should handle multiple component allocations', () => {
      manager.allocate('system', 1000);
      manager.allocate('rag', 2000);
      manager.allocate('history', 1500);
      manager.allocate('response', 1000);
      manager.allocate('tools', 100);

      const total = Object.values(manager.usage).reduce((a, b) => a + b, 0);
      expect(total).toBe(5600);
    });

    it('should handle rapid allocations', () => {
      for (let i = 0; i < 100; i++) {
        const mgr = new TokenBudgetManager();
        mgr.allocate('system', 100);
        expect(mgr.usage.system).toBe(100);
      }
    });

    it('should maintain budget integrity after optimization', () => {
      manager.allocate('system', 500);
      manager.optimize({ ragEnabled: false, toolsEnabled: false });

      const sum = Object.values(manager.budgets).reduce((a, b) => a + b, 0);
      expect(sum).toBe(manager.totalBudget);
    });

    it('should throw meaningful errors', () => {
      expect(() => {
        manager.allocate('system', 999999);
      }).toThrow(/exceeded budget/);

      expect(() => {
        manager.allocate('invalid', 100);
      }).toThrow();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle typical chat request flow', () => {
      // Typical flow
      manager.allocate('system', 1200); // System context
      manager.allocate('rag', 2500); // Document retrieval
      manager.allocate('history', 2000); // Conversation history

      expect(manager.canFitResponse()).toBe(true);

      const report = manager.report();
      expect(report.percentage).toBeLessThan(90);
    });

    it('should handle conversational query (no RAG)', () => {
      manager.optimize({ ragEnabled: false, toolsEnabled: false });

      manager.allocate('system', 1000);
      manager.allocate('history', 3000);

      expect(manager.canFitResponse()).toBe(true);
      expect(manager.budgets.rag).toBe(0);
    });

    it('should detect context overflow scenario', () => {
      manager.allocate('system', 1200);
      manager.allocate('rag', 3000);
      manager.allocate('history', 3500);

      const safety = manager.checkSafety();
      expect(safety.level).toBe('danger');
      expect(manager.canFitResponse()).toBe(false);
    });

    it('should support budget reallocation mid-request', () => {
      manager.allocate('system', 1000);

      // Discover RAG not needed
      manager.optimize({ ragEnabled: false, toolsEnabled: false });

      // Now more budget available for history
      const historyBudgetAfter = manager.budgets.history;
      expect(historyBudgetAfter).toBeGreaterThan(2500);
    });
  });
});

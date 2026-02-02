/**
 * PerformanceMonitor - Lightweight performance tracking for LANA AI components
 *
 * Provides utilities for measuring render times, memory usage, and identifying
 * performance bottlenecks in visualization components.
 *
 * @module utils/performance-monitor
 *
 * @example
 * import { PerformanceMonitor } from './utils/performance-monitor.js';
 *
 * const monitor = new PerformanceMonitor('TimeSeriesRenderer');
 * monitor.start('render');
 * await renderer.render();
 * monitor.end('render');
 * console.log(monitor.getMetrics());
 */

export class PerformanceMonitor {
  /**
   * Create a PerformanceMonitor instance
   *
   * @param {string} componentName - Name of the component being monitored
   * @param {Object} [options={}] - Configuration options
   * @param {boolean} [options.enabled=true] - Enable/disable monitoring
   * @param {boolean} [options.verbose=false] - Log metrics to console
   * @param {number} [options.warnThreshold=100] - Warn if operation exceeds threshold (ms)
   */
  constructor(componentName, options = {}) {
    this.componentName = componentName;
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.verbose = options.verbose || false;
    this.warnThreshold = options.warnThreshold || 100;

    this.metrics = new Map();
    this.activeTimers = new Map();
  }

  /**
   * Start timing an operation
   *
   * @param {string} operation - Operation name (e.g., 'render', 'update', 'destroy')
   * @param {Object} [metadata={}] - Additional context for this operation
   */
  start(operation, metadata = {}) {
    if (!this.enabled) return;

    this.activeTimers.set(operation, {
      startTime: performance.now(),
      startMemory: performance.memory ? performance.memory.usedJSHeapSize : 0,
      metadata
    });
  }

  /**
   * End timing an operation and record metrics
   *
   * @param {string} operation - Operation name (must match start() call)
   * @returns {Object|null} Metrics for this operation or null if not started
   */
  end(operation) {
    if (!this.enabled) return null;

    const timer = this.activeTimers.get(operation);
    if (!timer) {
      console.warn(`PerformanceMonitor: No active timer for operation "${operation}"`);
      return null;
    }

    const endTime = performance.now();
    const endMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;

    const metrics = {
      operation,
      duration: endTime - timer.startTime,
      memoryDelta: endMemory - timer.startMemory,
      timestamp: new Date().toISOString(),
      metadata: timer.metadata
    };

    // Store metrics
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    this.metrics.get(operation).push(metrics);

    // Cleanup active timer
    this.activeTimers.delete(operation);

    // Log if verbose or exceeds threshold
    if (this.verbose || metrics.duration > this.warnThreshold) {
      this._logMetrics(metrics);
    }

    return metrics;
  }

  /**
   * Measure a synchronous function
   *
   * @param {string} operation - Operation name
   * @param {Function} fn - Function to measure
   * @param {Object} [metadata={}] - Additional context
   * @returns {*} Return value of the function
   */
  measure(operation, fn, metadata = {}) {
    this.start(operation, metadata);
    try {
      return fn();
    } finally {
      this.end(operation);
    }
  }

  /**
   * Measure an asynchronous function
   *
   * @param {string} operation - Operation name
   * @param {Function} fn - Async function to measure
   * @param {Object} [metadata={}] - Additional context
   * @returns {Promise<*>} Return value of the function
   */
  async measureAsync(operation, fn, metadata = {}) {
    this.start(operation, metadata);
    try {
      return await fn();
    } finally {
      this.end(operation);
    }
  }

  /**
   * Get aggregated metrics for all operations
   *
   * @returns {Object} Aggregated performance metrics
   */
  getMetrics() {
    const aggregated = {};

    this.metrics.forEach((records, operation) => {
      const durations = records.map(r => r.duration);
      const memoryDeltas = records.map(r => r.memoryDelta);

      aggregated[operation] = {
        count: records.length,
        totalDuration: this._sum(durations),
        avgDuration: this._avg(durations),
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        p95Duration: this._percentile(durations, 95),
        totalMemory: this._sum(memoryDeltas),
        avgMemory: this._avg(memoryDeltas),
        records: records
      };
    });

    return aggregated;
  }

  /**
   * Get metrics for a specific operation
   *
   * @param {string} operation - Operation name
   * @returns {Object|null} Metrics for the operation or null if not found
   */
  getOperationMetrics(operation) {
    return this.getMetrics()[operation] || null;
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics.clear();
    this.activeTimers.clear();
  }

  /**
   * Generate a performance report
   *
   * @returns {string} Human-readable performance report
   */
  generateReport() {
    const metrics = this.getMetrics();
    const operations = Object.keys(metrics);

    if (operations.length === 0) {
      return `Performance Report: ${this.componentName}\nNo metrics recorded.`;
    }

    let report = `Performance Report: ${this.componentName}\n`;
    report += '─'.repeat(80) + '\n';

    operations.forEach(operation => {
      const m = metrics[operation];
      report += `\n${operation}:\n`;
      report += `  Count:       ${m.count}\n`;
      report += `  Avg:         ${m.avgDuration.toFixed(2)}ms\n`;
      report += `  Min:         ${m.minDuration.toFixed(2)}ms\n`;
      report += `  Max:         ${m.maxDuration.toFixed(2)}ms\n`;
      report += `  P95:         ${m.p95Duration.toFixed(2)}ms\n`;
      report += `  Total:       ${m.totalDuration.toFixed(2)}ms\n`;

      if (performance.memory) {
        report += `  Avg Memory:  ${(m.avgMemory / 1024 / 1024).toFixed(2)} MB\n`;
      }
    });

    report += '\n' + '─'.repeat(80) + '\n';
    return report;
  }

  /**
   * Log metrics to console
   *
   * @private
   * @param {Object} metrics - Metrics object
   */
  _logMetrics(metrics) {
    const prefix = `[${this.componentName}]`;
    const duration = `${metrics.duration.toFixed(2)}ms`;
    const memory = performance.memory
      ? ` | Memory: ${(metrics.memoryDelta / 1024 / 1024).toFixed(2)} MB`
      : '';

    if (metrics.duration > this.warnThreshold) {
      console.warn(`${prefix} ${metrics.operation}: ${duration}${memory} ⚠️  SLOW`);
    } else {
      console.log(`${prefix} ${metrics.operation}: ${duration}${memory}`);
    }
  }

  /**
   * Calculate sum of array
   * @private
   */
  _sum(arr) {
    return arr.reduce((sum, val) => sum + val, 0);
  }

  /**
   * Calculate average of array
   * @private
   */
  _avg(arr) {
    return arr.length > 0 ? this._sum(arr) / arr.length : 0;
  }

  /**
   * Calculate percentile of array
   * @private
   */
  _percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

/**
 * Global performance monitor registry
 * Allows centralized tracking of all component performance
 */
export class GlobalPerformanceMonitor {
  constructor() {
    this.monitors = new Map();
  }

  /**
   * Register a component monitor
   *
   * @param {string} componentName - Component name
   * @param {PerformanceMonitor} monitor - Monitor instance
   */
  register(componentName, monitor) {
    this.monitors.set(componentName, monitor);
  }

  /**
   * Get a component monitor
   *
   * @param {string} componentName - Component name
   * @returns {PerformanceMonitor|null} Monitor instance or null
   */
  get(componentName) {
    return this.monitors.get(componentName) || null;
  }

  /**
   * Generate global performance report
   *
   * @returns {string} Aggregated performance report for all components
   */
  generateGlobalReport() {
    if (this.monitors.size === 0) {
      return 'No components monitored.';
    }

    let report = 'Global Performance Report\n';
    report += '═'.repeat(80) + '\n';

    this.monitors.forEach((monitor, componentName) => {
      report += `\n${monitor.generateReport()}\n`;
    });

    return report;
  }

  /**
   * Reset all monitors
   */
  resetAll() {
    this.monitors.forEach(monitor => monitor.reset());
  }
}

// Singleton instance for global monitoring
export const globalMonitor = new GlobalPerformanceMonitor();

/**
 * Decorator for automatic performance monitoring (for class methods)
 *
 * @example
 * class MyRenderer {
 *   @monitored
 *   async render() {
 *     // Method will be automatically monitored
 *   }
 * }
 */
export function monitored(target, propertyKey, descriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args) {
    if (!this._performanceMonitor) {
      this._performanceMonitor = new PerformanceMonitor(this.constructor.name);
    }

    return await this._performanceMonitor.measureAsync(propertyKey, async () => {
      return await originalMethod.apply(this, args);
    });
  };

  return descriptor;
}

/**
 * Utility function for manual performance tracking
 *
 * @param {string} label - Label for the measurement
 * @param {Function} fn - Function to measure
 * @returns {*} Return value of the function
 */
export function track(label, fn) {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - start;
    console.log(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
  }
}

/**
 * Utility function for async performance tracking
 *
 * @param {string} label - Label for the measurement
 * @param {Function} fn - Async function to measure
 * @returns {Promise<*>} Return value of the function
 */
export async function trackAsync(label, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    console.log(`[Performance] ${label}: ${duration.toFixed(2)}ms`);
  }
}

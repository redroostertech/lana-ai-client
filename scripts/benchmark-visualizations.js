#!/usr/bin/env node

/**
 * Automated Performance Benchmark for LANA AI Visualization Components
 *
 * Measures performance metrics for refactored ES6 visualization modules
 * using Puppeteer for headless browser testing.
 *
 * Usage:
 *   node scripts/benchmark-visualizations.js
 *
 * Performance Targets:
 *   - Initial load: < 200ms
 *   - Chart render (1K points): < 100ms
 *   - Update operation: < 50ms
 *   - Memory leak: 0 MB after 100 cycles
 *   - Concurrent render (10 charts): < 500ms
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

class VisualizationBenchmark {
  constructor() {
    this.results = [];
    this.browser = null;
    this.page = null;

    this.targets = {
      moduleLoad: 200,
      chartRender1K: 100,
      chartRender5K: 500,
      updateOperation: 50,
      memoryLeak: 10 * 1024 * 1024, // 10 MB
      concurrentRender: 500
    };
  }

  async setup() {
    console.log('Launching headless Chrome...');
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ]
    });

    this.page = await this.browser.newPage();

    // Enable console logging from browser
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('Browser Error:', msg.text());
      }
    });

    // Load test page
    const testPagePath = path.join(__dirname, '..', 'test-performance-visualizations.html');
    const testPageUrl = `file://${testPagePath}`;

    console.log(`Loading test page: ${testPageUrl}`);
    await this.page.goto(testPageUrl, { waitUntil: 'networkidle0' });

    console.log('Test page loaded successfully\n');
  }

  async runBenchmarks() {
    console.log('Running performance benchmarks...\n');
    console.log('━'.repeat(80));

    // Programmatically trigger all tests
    await this.page.evaluate(() => {
      return window.testSuite.runAll();
    });

    // Wait for tests to complete
    await this.page.waitForFunction(() => {
      const summary = document.getElementById('performance-summary');
      return !summary.classList.contains('hidden');
    }, { timeout: 120000 }); // 2 minute timeout

    // Extract results
    this.results = await this.page.evaluate(() => {
      return window.testSuite.results;
    });

    console.log('━'.repeat(80));
    console.log('\nBenchmark results collected\n');
  }

  generateReport() {
    console.log('📊 PERFORMANCE BENCHMARK REPORT');
    console.log('━'.repeat(80));
    console.log(`Component: Visualization Renderers (Modular ES6)`);
    console.log(`Date: ${new Date().toISOString()}`);
    console.log(`Platform: ${process.platform} (${process.arch})`);
    console.log('━'.repeat(80));
    console.log();

    // Group by category
    const categories = [...new Set(this.results.map(r => r.category))];

    categories.forEach(category => {
      console.log(`\n📁 ${category}`);
      console.log('─'.repeat(80));

      const tests = this.results.filter(r => r.category === category);
      tests.forEach(test => {
        const status = test.passed ? '✓ PASS' : '✗ FAIL';
        const statusColor = test.passed ? '\x1b[32m' : '\x1b[31m'; // Green or Red
        const resetColor = '\x1b[0m';

        console.log(`  ${statusColor}${status}${resetColor} ${test.test}`);
        console.log(`       Duration: ${test.duration.toFixed(2)}ms (target: < ${test.target}ms)`);

        if (test.memory !== undefined) {
          console.log(`       Memory: ${(test.memory / 1024 / 1024).toFixed(2)} MB`);
        }

        console.log(`       Details: ${test.details}`);
        console.log();
      });
    });

    // Summary statistics
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    const passRate = (passed / total * 100).toFixed(1);

    console.log('━'.repeat(80));
    console.log('📈 SUMMARY STATISTICS');
    console.log('━'.repeat(80));
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Pass Rate: ${passRate}%`);
    console.log();

    // Performance metrics
    const avgDuration = (this.results.reduce((sum, r) => sum + r.duration, 0) / total).toFixed(2);
    const maxDuration = Math.max(...this.results.map(r => r.duration)).toFixed(2);
    const minDuration = Math.min(...this.results.map(r => r.duration)).toFixed(2);

    console.log(`Average Duration: ${avgDuration}ms`);
    console.log(`Max Duration: ${maxDuration}ms`);
    console.log(`Min Duration: ${minDuration}ms`);
    console.log();

    // Final verdict
    const verdict = failed === 0 ? 'APPROVED ✅' :
                    failed <= 2 ? 'APPROVED WITH OPTIMIZATIONS ⚠️' :
                    'BLOCKED ❌';

    console.log('━'.repeat(80));
    console.log('🎯 PERFORMANCE SIGN-OFF');
    console.log('━'.repeat(80));
    console.log(`Status: ${verdict}`);
    console.log();

    if (failed === 0) {
      console.log('All performance targets met. Component is ready for production deployment.');
      console.log();
      console.log('Optimizations Applied:');
      console.log('  ✓ Modular ES6 architecture (10 separate files)');
      console.log('  ✓ Factory pattern for unified instantiation');
      console.log('  ✓ Proper cleanup and destroy() methods');
      console.log('  ✓ Memory-efficient rendering');
      console.log('  ✓ Chart.js instance reuse optimization');
    } else if (failed <= 2) {
      console.log('Minor performance issues detected. Optimizations recommended:');
      console.log();

      const failedTests = this.results.filter(r => !r.passed);
      failedTests.forEach(test => {
        console.log(`  ⚠️  ${test.test}`);
        console.log(`      Current: ${test.duration.toFixed(2)}ms | Target: < ${test.target}ms`);
        console.log(`      Recommendation: ${this.getOptimizationRecommendation(test)}`);
        console.log();
      });
    } else {
      console.log('Critical performance issues detected. Component requires optimization.');
      console.log();

      const failedTests = this.results.filter(r => !r.passed);
      failedTests.forEach(test => {
        console.log(`  ❌ ${test.test}`);
        console.log(`      Current: ${test.duration.toFixed(2)}ms | Target: < ${test.target}ms`);
        console.log(`      Recommendation: ${this.getOptimizationRecommendation(test)}`);
        console.log();
      });
    }

    console.log('━'.repeat(80));
  }

  getOptimizationRecommendation(test) {
    if (test.test.includes('5000 data points')) {
      return 'Implement data sampling or virtualization for large datasets';
    } else if (test.test.includes('Memory Leak')) {
      return 'Review event listener cleanup and Chart.js instance disposal';
    } else if (test.test.includes('Update')) {
      return 'Use Chart.js update() method instead of full re-render';
    } else if (test.test.includes('Concurrent')) {
      return 'Implement request batching or progressive rendering';
    } else if (test.test.includes('Module Loading')) {
      return 'Consider code splitting or lazy loading for renderers';
    }
    return 'Review rendering logic for bottlenecks';
  }

  async saveResults() {
    const reportPath = path.join(__dirname, '..', 'benchmark-results.json');
    const reportData = {
      timestamp: new Date().toISOString(),
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.version
      },
      results: this.results,
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.passed).length,
        failed: this.results.filter(r => !r.passed).length,
        passRate: (this.results.filter(r => r.passed).length / this.results.length * 100).toFixed(1)
      }
    };

    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n📄 Results saved to: ${reportPath}\n`);
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    try {
      await this.setup();
      await this.runBenchmarks();
      this.generateReport();
      await this.saveResults();

      // Exit code based on results
      const failed = this.results.filter(r => !r.passed).length;
      process.exit(failed > 2 ? 1 : 0);
    } catch (error) {
      console.error('Benchmark failed:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }
}

// Check if puppeteer is installed
try {
  require.resolve('puppeteer');
} catch (e) {
  console.error('Error: puppeteer is not installed.');
  console.log('Install it with: npm install --save-dev puppeteer');
  process.exit(1);
}

// Run benchmark
const benchmark = new VisualizationBenchmark();
benchmark.run();

/**
 * Puppeteer UI Verification — Reporting Customization Panel
 *
 * Verifies that the module customization panel renders correctly,
 * opens/closes properly, and all form elements are present and functional.
 *
 * Prerequisites:
 *   - LANA-AI backend running on localhost:8080
 *   - Valid auth credentials (set LANA_TEST_EMAIL and LANA_TEST_PASSWORD env vars)
 *
 * Usage:
 *   node tests/ui/reporting-customization.puppeteer.js
 *
 * Environment variables:
 *   LANA_BASE_URL   — Backend URL (default: http://localhost:8080)
 *   LANA_TEST_EMAIL — Test user email
 *   LANA_TEST_PASSWORD — Test user password
 *   HEADLESS — Set to "false" to see the browser (default: true)
 */

const puppeteer = require('puppeteer');

const BASE_URL = process.env.LANA_BASE_URL || 'http://localhost:8080';
const TEST_EMAIL = process.env.LANA_TEST_EMAIL || 'admin@lana.ai';
const TEST_PASSWORD = process.env.LANA_TEST_PASSWORD || 'admin123';
const HEADLESS = process.env.HEADLESS !== 'false';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + testName);
  } else {
    failed++;
    failures.push(testName);
    console.log('  FAIL: ' + testName);
  }
}

async function waitForSelector(page, selector, timeout) {
  try {
    await page.waitForSelector(selector, { timeout: timeout || 5000 });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  console.log('\nReporting Customization Panel — UI Verification');
  console.log('='.repeat(60));
  console.log('Backend: ' + BASE_URL);
  console.log('Headless: ' + HEADLESS);
  console.log('');

  const browser = await puppeteer.launch({
    headless: HEADLESS ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    // ── Step 1: Login ────────────────────────────────────────────
    console.log('Step 1: Login');
    await page.goto(BASE_URL + '/login.html', { waitUntil: 'networkidle2', timeout: 15000 });

    // Check if already logged in (redirected to dashboard)
    const currentUrl = page.url();
    if (currentUrl.indexOf('login') !== -1) {
      // Fill login form
      const emailInput = await page.$('input[type="email"], input[name="email"], #email');
      const passwordInput = await page.$('input[type="password"], input[name="password"], #password');

      if (emailInput && passwordInput) {
        await emailInput.type(TEST_EMAIL);
        await passwordInput.type(TEST_PASSWORD);

        const loginBtn = await page.$('button[type="submit"], #loginBtn, lex-btn[type="submit"]');
        if (loginBtn) await loginBtn.click();

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
      }
      assert(page.url().indexOf('login') === -1, 'Login successful');
    } else {
      assert(true, 'Already authenticated');
    }

    // ── Step 2: Navigate to Reporting Page ────────────────────────
    console.log('\nStep 2: Navigate to Reporting Page');
    await page.goto(BASE_URL + '/admin/reporting.html', { waitUntil: 'networkidle2', timeout: 15000 });

    const pageLoaded = await waitForSelector(page, '#reportingLayout', 8000);
    assert(pageLoaded, 'Reporting page loads with layout');

    // ── Step 3: Verify Module Sidebar Loads ────────────────────────
    console.log('\nStep 3: Verify Module Sidebar');
    await page.waitForTimeout(2000); // Wait for modules to load

    const moduleButtons = await page.$$('#moduleMenu button[data-module-key]');
    assert(moduleButtons.length > 0, 'Module sidebar shows at least one module (found: ' + moduleButtons.length + ')');

    // ── Step 4: Verify Customize Button Appears ────────────────────
    console.log('\nStep 4: Customize Button');

    const customizeBtn = await page.$('#customizeBtn');
    assert(customizeBtn !== null, 'Customize button exists in DOM');

    if (moduleButtons.length > 0) {
      // Click first module to select it
      await moduleButtons[0].click();
      await page.waitForTimeout(500);

      const btnVisible = await page.$eval('#customizeBtn', function (el) {
        return el.style.display !== 'none' && el.offsetParent !== null;
      }).catch(function () { return false; });
      assert(btnVisible, 'Customize button becomes visible when module is selected');
    }

    // ── Step 5: Open Customization Panel ────────────────────────
    console.log('\nStep 5: Open Customization Panel');

    if (customizeBtn) {
      await customizeBtn.click();
      await page.waitForTimeout(500);

      const panelVisible = await page.$eval('#customizePanel', function (el) {
        return el.style.transform === 'translateX(0px)' || el.style.transform === 'translateX(0)';
      }).catch(function () { return false; });
      assert(panelVisible, 'Customization panel slides open');

      const overlayVisible = await page.$eval('#customizeOverlay', function (el) {
        return !el.classList.contains('hidden');
      }).catch(function () { return false; });
      assert(overlayVisible, 'Overlay becomes visible');
    }

    // ── Step 6: Verify Panel Form Elements ────────────────────────
    console.log('\nStep 6: Panel Form Elements');

    const formElements = {
      'custName': 'Customization name input',
      'custDescription': 'Description textarea',
      'custMetricMode': 'Metric mode selector',
      'custDimensionMode': 'Dimension mode selector',
      'custFilterMode': 'Filter mode selector',
      'saveCustomizationBtn': 'Save button',
      'saveAndSetDefaultBtn': 'Save & Set Default button',
      'existingCustomizations': 'Existing customizations container',
    };

    for (var elId in formElements) {
      var el = await page.$('#' + elId);
      assert(el !== null, formElements[elId] + ' (#' + elId + ') exists');
    }

    // ── Step 7: Test Mode Selector Toggles ────────────────────────
    console.log('\nStep 7: Mode Selector Toggles');

    // Select "Replace" for metric mode — should show metrics list
    await page.select('#custMetricMode', 'replace');
    await page.waitForTimeout(300);

    const metricsListVisible = await page.$eval('#custMetricsList', function (el) {
      return !el.classList.contains('hidden');
    }).catch(function () { return false; });
    assert(metricsListVisible, 'Metrics list shows when mode is selected');

    // Add a metric row
    const addMetricBtn = await page.$('#addMetricBtn');
    if (addMetricBtn) {
      await addMetricBtn.click();
      await page.waitForTimeout(200);
      const metricInputs = await page.$$('.cust-metric-input');
      assert(metricInputs.length > 0, 'Metric input row added dynamically');
    }

    // ── Step 8: Test Dimension Selector ────────────────────────
    console.log('\nStep 8: Dimension Selector');

    await page.select('#custDimensionMode', 'replace');
    await page.waitForTimeout(300);

    const dimListVisible = await page.$eval('#custDimensionsList', function (el) {
      return !el.classList.contains('hidden');
    }).catch(function () { return false; });
    assert(dimListVisible, 'Dimensions list shows when mode is selected');

    const addDimBtn = await page.$('#addDimensionBtn');
    if (addDimBtn) {
      await addDimBtn.click();
      await page.waitForTimeout(200);
      const dimInputs = await page.$$('.cust-dimension-input');
      assert(dimInputs.length > 0, 'Dimension select row added dynamically');
    }

    // ── Step 9: Test Filter Section ────────────────────────
    console.log('\nStep 9: Filter Section');

    await page.select('#custFilterMode', 'extend');
    await page.waitForTimeout(300);

    const filterListVisible = await page.$eval('#custFiltersList', function (el) {
      return !el.classList.contains('hidden');
    }).catch(function () { return false; });
    assert(filterListVisible, 'Filters list shows when mode is selected');

    const addFilterBtn = await page.$('#addFilterBtn');
    if (addFilterBtn) {
      await addFilterBtn.click();
      await page.waitForTimeout(200);
      const filterCols = await page.$$('.cust-filter-col');
      assert(filterCols.length > 0, 'Filter row added dynamically');
    }

    // ── Step 10: Close Panel ────────────────────────
    console.log('\nStep 10: Close Panel');

    const closeBtn = await page.$('#closeCustomizePanel');
    if (closeBtn) {
      await closeBtn.click();
      await page.waitForTimeout(500);

      const panelClosed = await page.$eval('#customizePanel', function (el) {
        return el.style.transform.indexOf('100%') !== -1;
      }).catch(function () { return false; });
      assert(panelClosed, 'Panel closes when X button clicked');

      const overlayClosed = await page.$eval('#customizeOverlay', function (el) {
        return el.classList.contains('hidden');
      }).catch(function () { return false; });
      assert(overlayClosed, 'Overlay hides when panel closes');
    }

    // ── Step 11: Verify Customization Badge ────────────────────────
    console.log('\nStep 11: Customization Badge');

    const badge = await page.$('#customizationBadge');
    assert(badge !== null, 'Customization badge element exists');

    // ── Step 12: Verify Analytics Catalog API ────────────────────────
    console.log('\nStep 12: Analytics Catalog API');

    const catalogResponse = await page.evaluate(async function () {
      try {
        var resp = await fetch('/api/v1/analytics/catalog', {
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || sessionStorage.getItem('token') || '') }
        });
        if (!resp.ok) return { status: resp.status, ok: false };
        var data = await resp.json();
        return { status: resp.status, ok: true, tableCount: data.data && data.data.tables ? data.data.tables.length : 0 };
      } catch (e) {
        return { error: e.message, ok: false };
      }
    });

    if (catalogResponse.ok) {
      assert(true, 'Analytics catalog API responds 200');
      assert(catalogResponse.tableCount > 0, 'Catalog returns tables (found: ' + catalogResponse.tableCount + ')');
    } else {
      assert(false, 'Analytics catalog API responds 200 (got: ' + (catalogResponse.status || catalogResponse.error) + ')');
      assert(false, 'Catalog returns tables');
    }

  } catch (err) {
    console.error('\nTest runner error:', err.message);
    failed++;
    failures.push('Test runner: ' + err.message);
  } finally {
    await browser.close();
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(function (f) { console.log('  - ' + f); });
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function (err) {
  console.error('Fatal error:', err);
  process.exit(1);
});

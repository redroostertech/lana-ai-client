'use strict';

/**
 * Renders the real attribution summary from reporting.js with hostile
 * channel, campaign and page names: they must show as text, never markup.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

function page() {
  let source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { renderAttributionSummary };' + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const document = { addEventListener() {}, getElementById: () => null, createElement: () => ({ innerHTML: '' }) };
  vm.runInNewContext(source, { window, document, console, Intl, URLSearchParams, setTimeout: jest.fn(), clearTimeout: jest.fn() });
  return window.testExports;
}

const HOSTILE = '<img src=x onerror=alert(1)>" onmouseover="alert(2)';

test('hostile channel, campaign and landing page names render as text', () => {
  const viz = { title: HOSTILE, description: HOSTILE, sections: [
    { role: 'first_vs_last_touch', metric: 'attribution_first_vs_last_touch' },
    { role: 'campaigns', metric: 'attribution_campaign_performance' },
    { role: 'landing_pages', metric: 'attribution_landing_pages' }] };
  const data = { metrics: [
    { key: 'attribution_first_vs_last_touch', current: [
      { touch_type: 'first_touch', channel: HOSTILE, value: 3 },
      { touch_type: 'last_touch', channel: HOSTILE, value: 2 }] },
    { key: 'attribution_campaign_performance', current: [{ label: HOSTILE, channel: HOSTILE, value: 1 }] },
    { key: 'attribution_landing_pages', current: [{ label: HOSTILE, full_url: HOSTILE, value: 1 }] }
  ] };
  const html = page().renderAttributionSummary(viz, data, 'u1').innerHTML;
  expect(html).not.toContain('<img');
  expect(html).not.toMatch(/" onmouseover=/);
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot; onmouseover=&quot;alert(2)');
});

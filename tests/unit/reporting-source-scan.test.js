'use strict';

/** Source checks on the Reports page scripts. */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/report.js'), 'utf8');

// One escapeHtml for both Reports pages, in their shared module.
test('the Reports pages share one escapeHtml (no copy, no shadowed copy)', () => {
  const list = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reports-list.js'), 'utf8');
  const model = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reports-list.model.js'), 'utf8');
  expect(model.match(/function escapeHtml\(/g)).toHaveLength(1);
  [source, list].forEach((page) => {
    expect(page).not.toMatch(/function escapeHtml\(/);
    expect(page).toContain('var escapeHtml = ReportsList.escapeHtml;');
  });
});

// Module keys the backend ships (LANA-AI src/modules/core/*.json moduleKey).
// The page keys on what the execute response declares, never on a report.
const MODULE_KEYS = ['client-satisfaction', 'financial-performance', 'funnel-analysis-attribution',
  'growth-intake-performance', 'matter-efficiency', 'missed-follow-ups', 'practice-area-analytics',
  'service-delivery-operations'];

test.each(MODULE_KEYS)('report.js has no %s literal', (key) => {
  expect(source).not.toContain(key);
});

// Attribution metric keys the backend ships. The attribution summary renders
// from the sections its visualization declares, never from these keys.
const ATTRIBUTION_METRIC_KEYS = ['attribution_multi_touch_analysis', 'attribution_lead_journeys',
  'attribution_first_vs_last_touch', 'attribution_campaign_performance', 'attribution_landing_pages',
  'attribution_channel_performance'];

test.each(ATTRIBUTION_METRIC_KEYS)('report.js has no %s literal', (key) => {
  expect(source).not.toContain(key);
});

'use strict';

/** Source checks on the Reports page script. */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../src/js/admin/reporting.js'), 'utf8');

test('reporting.js declares escapeHtml once (no shadowed copy)', () => {
  expect(source.match(/function escapeHtml\(/g)).toHaveLength(1);
});

// Module keys the backend ships (LANA-AI src/modules/core/*.json moduleKey).
// The page keys on what the execute response declares, never on a report.
const MODULE_KEYS = ['client-satisfaction', 'financial-performance', 'funnel-analysis-attribution',
  'growth-intake-performance', 'matter-efficiency', 'missed-follow-ups', 'practice-area-analytics',
  'service-delivery-operations'];

test.each(MODULE_KEYS)('reporting.js has no %s literal', (key) => {
  expect(source).not.toContain(key);
});

// Attribution metric keys the backend ships. The attribution summary renders
// from the sections its visualization declares, never from these keys.
const ATTRIBUTION_METRIC_KEYS = ['attribution_multi_touch_analysis', 'attribution_lead_journeys',
  'attribution_first_vs_last_touch', 'attribution_campaign_performance', 'attribution_landing_pages',
  'attribution_channel_performance'];

test.each(ATTRIBUTION_METRIC_KEYS)('reporting.js has no %s literal', (key) => {
  expect(source).not.toContain(key);
});

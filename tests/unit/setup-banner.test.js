'use strict';

/**
 * The "Finish your setup" banner (js/shared/setup-banner.js): shown when the
 * mappings summary has unmapped records, hidden when there are none or when
 * the API is not there yet (404).
 */

const fs = require('fs');
const path = require('path');
const sample = require(path.join(__dirname, '../fixtures/mappings/mappings-sample.json'));

function load(summaryResult) {
  const node = { hidden: true, innerHTML: '' };
  const window = { api: { getMappingSummary: jest.fn(() => summaryResult) } };
  const document = { getElementById: (id) => (id === 'lanaSetupBanner' ? node : null) };
  for (const rel of ['js/settings-mappings.model.js', 'js/shared/setup-banner.js']) {
    new Function('window', 'document', fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8'))(window, document);
  }
  return { window, node };
}

test('unmapped records: the banner says how many and links to Mappings', async () => {
  const { window, node } = load(Promise.resolve({ data: sample.summary }));
  await window.LanaSetupBanner.mount('lanaSetupBanner');
  expect(node.hidden).toBe(false);
  expect(node.innerHTML).toContain("Finish your setup: 3 case types and 2 appointment types aren&#39;t mapped yet (318 records).");
  expect(node.innerHTML).toContain('data-setup-link="settings-v2.html#mappings"');
});

test('nothing unmapped: hidden', async () => {
  const { window, node } = load(Promise.resolve({ data: { matter_service: { unmapped_values: 0, unmapped_records: 0 } } }));
  await window.LanaSetupBanner.mount('lanaSetupBanner');
  expect(node.hidden).toBe(true);
});

test('the API is not there yet (404): hidden, no error', async () => {
  const { window, node } = load(Promise.reject(Object.assign(new Error('Not found'), { status: 404 })));
  await window.LanaSetupBanner.mount('lanaSetupBanner');
  expect(node.hidden).toBe(true);
});

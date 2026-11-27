'use strict';

/**
 * The "Finish your setup" banner (js/shared/setup-banner.js): shown when the
 * mappings summary has unmapped records, hidden when there are none or when
 * the API is not there yet (404).
 */

const fs = require('fs');
const path = require('path');
const sample = require(path.join(__dirname, '../fixtures/mappings/mappings-sample.json'));

function load(summaryResult, admin = true) {
  const node = { hidden: true, innerHTML: '' };
  const window = { api: { getMappingSummary: jest.fn(() => summaryResult) }, Lex: { Auth: { isAdmin: () => admin } } };
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

describe('feature off or failing: hidden, quiet, one request', () => {
  const failing = (status, code) => Promise.reject(Object.assign(new Error('x'), { status, code, data: { error: { code } } }));
  let warn;
  let error;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); error = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); error.mockRestore(); });

  test.each([[404, null], [422, 'NOT_CONFIGURED']])('%s %s is the feature off: hidden and silent', async (status, code) => {
    const { window, node } = load(failing(status, code));
    expect((await window.LanaSetupBanner.summary()).available).toBe(false);
    await window.LanaSetupBanner.mount('lanaSetupBanner');
    expect(node.hidden).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  test.each([[422, 'VALIDATION_ERROR'], [500, 'INTERNAL']])('%s %s: hidden, logged once, no retry', async (status, code) => {
    const { window, node } = load(failing(status, code));
    await window.LanaSetupBanner.mount('lanaSetupBanner');
    await window.LanaSetupBanner.mount('lanaSetupBanner');
    await window.LanaSetupBanner.summary();
    expect(node.hidden).toBe(true);
    expect(warn.mock.calls.length + error.mock.calls.length).toBe(1);
    expect(window.api.getMappingSummary).toHaveBeenCalledTimes(1);
  });

  test('the summary request asks the API layer to stay quiet for these statuses', async () => {
    const { window } = load(Promise.resolve({ data: sample.summary }));
    await window.LanaSetupBanner.summary();
    expect(window.api.getMappingSummary.mock.calls[0][0].quietStatuses).toEqual(expect.arrayContaining([404, 422, 500]));
  });
});

test('only admins and org admins see the banner; others get no banner and no request', async () => {
  const { window, node } = load(Promise.resolve({ data: sample.summary }), false);
  await window.LanaSetupBanner.mount('lanaSetupBanner');
  expect(node.hidden).toBe(true);
  expect(node.innerHTML).toBe('');
  expect(window.api.getMappingSummary).not.toHaveBeenCalled();
});

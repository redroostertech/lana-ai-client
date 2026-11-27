'use strict';

/**
 * Settings > Mappings (real markup from settings-v2.html, real page script,
 * fixtures for the planned API): rows unmapped first with source, records,
 * a picker and the Suggested tag; Accept all suggestions only fills the
 * pickers; Save sends one PUT with the changed rows and says how many records
 * update; Clear deletes; read-only for non-admins; hidden when the API 404s.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const fixture = require(path.join(__dirname, '../fixtures/mappings/mappings-sample.json'));

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

async function boot({ admin = true, summary = Promise.resolve({ data: fixture.summary }), hash = '' } = {}) {
  const html = read('settings-v2.html');
  const adminOnly = html.slice(html.indexOf('<p id="sv2-mappings-admin-only"'), html.indexOf('</p>', html.indexOf('<p id="sv2-mappings-admin-only"')) + 4);
  const nav = html.slice(html.indexOf('<!-- Mappings: shown by'), html.indexOf('<button type="button" class="sv2-nav-item" role="tab" id="sv2-tab-usage"'));
  const panel = html.slice(html.indexOf('<div class="sv2-panel sv2-hidden" id="sv2-panel-mappings"'), html.indexOf('<!-- /sv2-panel-mappings -->'));
  const dom = new JSDOM('<!doctype html><body><div id="lanaSetupBanner" hidden></div>' + adminOnly + nav + panel + '</div></body>', { runScripts: 'outside-only', url: 'https://lana.test/settings-v2.html' + hash });
  const w = dom.window;
  const api = {
    getMappingSummary: jest.fn(() => summary),
    getVocabulary: jest.fn((v) => Promise.resolve({ data: fixture.vocabularies[v] })),
    getMappings: jest.fn((v) => Promise.resolve({ data: fixture.mappings[v] })),
    saveMappings: jest.fn(() => Promise.resolve({ data: { saved: 1, records_to_update: 212 } })),
    deleteMapping: jest.fn(() => Promise.resolve({})),
  };
  w.api = api;
  w.Lex = { Auth: { isAdmin: () => admin }, Utils: { timeAgo: () => '4 days ago' }, Nav: { go: jest.fn() } };
  w.eval(read('js/settings-mappings.model.js'));
  w.eval(read('js/shared/setup-banner.js'));
  w.eval(read('js/pages/settings-mappings.js'));
  for (let i = 0; i < 6; i += 1) await tick();
  return { w, api, doc: w.document };
}

const rowsOf = (doc) => Array.from(doc.querySelectorAll('.sv2-map-row'));

test('the section shows when the API answers; rows unmapped first, with source, count, picker and Suggested', async () => {
  const { doc } = await boot();
  expect(doc.getElementById('sv2-tab-mappings').classList.contains('sv2-hidden')).toBe(false);
  const rows = rowsOf(doc);
  expect(rows.map((r) => r.querySelector('.sv2-map-value').textContent)).toEqual(['EP - Will', 'Probate Admin', 'Consult only', 'Trust Package', 'Guardianship']);
  expect(rows[0].querySelector('.sv2-map-from').textContent).toBe('from ActionStep Matter type');
  expect(rows[0].querySelector('.sv2-map-count').textContent).toBe('212 matters');
  const select = rows[0].querySelector('[data-mapping-key]');
  expect(select.value).toBe('will_based_plan');
  expect(select.options.find((o) => o.value === 'will_based_plan')).toMatchObject({ group: 'Estate Planning' });
  expect(rows[0].querySelector('.sv2-map-suggested').textContent).toBe('Suggested');
  expect(rows[3].querySelector('.sv2-map-set').textContent).toBe('Set by Avery Admin 4 days ago');
  expect(doc.getElementById('lanaSetupBanner').hidden).toBe(false);
});

test('a suggestion shown is not a save; Accept all suggestions fills the pickers; Save sends one PUT and says how many records update', async () => {
  const { w, doc, api } = await boot();
  expect(doc.getElementById('sv2-mappings-save').disabled).toBe(true);
  doc.getElementById('sv2-mappings-accept').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  expect(doc.getElementById('sv2-mappings-save').disabled).toBe(false);
  expect(api.saveMappings).not.toHaveBeenCalled();
  doc.getElementById('sv2-mappings-save').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 6; i += 1) await tick();
  expect(api.saveMappings).toHaveBeenCalledWith('matter_service', [
    { connector: 'actionstep', source_value: 'EP - Will', canonical_key: 'will_based_plan' },
    { connector: 'actionstep', source_value: 'Probate Admin', canonical_key: 'probate' },
  ]);
  expect(doc.getElementById('sv2-mappings-message').textContent).toBe('Saved. Updating 212 records in the background.');
});

test('a pick in one row, then Save, sends only that row; Clear deletes a mapping', async () => {
  const { w, doc, api } = await boot();
  const select = rowsOf(doc)[2].querySelector('[data-mapping-key]');
  select.dispatchEvent(new w.CustomEvent('lex-change', { bubbles: true, detail: { value: 'not_a_case' } }));
  doc.getElementById('sv2-mappings-save').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 6; i += 1) await tick();
  expect(api.saveMappings).toHaveBeenCalledWith('matter_service', [{ connector: 'actionstep', source_value: 'Consult only', canonical_key: 'not_a_case' }]);
  rowsOf(doc)[3].querySelector('[data-mapping-clear]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await tick();
  expect(api.deleteMapping).toHaveBeenCalledWith('matter_service', 'm4');
});

test('people who are not admins or org admins see no entry and no banner, and nothing is asked for', async () => {
  const { doc, api } = await boot({ admin: false });
  expect(doc.getElementById('sv2-tab-mappings').classList.contains('sv2-hidden')).toBe(true);
  expect(doc.getElementById('sv2-panel-mappings').classList.contains('sv2-hidden')).toBe(true);
  expect(doc.getElementById('lanaSetupBanner').hidden).toBe(true);
  expect(doc.getElementById('sv2-mappings-admin-only').hidden).toBe(true);
  expect(api.getMappingSummary).not.toHaveBeenCalled();
  expect(api.getMappings).not.toHaveBeenCalled();
});

test('a direct link to Mappings for someone who is not an admin says calmly that only admins can manage them', async () => {
  const { doc, w } = await boot({ admin: false, hash: '#mappings' });
  const note = doc.getElementById('sv2-mappings-admin-only');
  expect(note.hidden).toBe(false);
  expect(note.textContent).toBe('Only admins can manage mappings.');
  expect(doc.getElementById('sv2-tab-mappings').classList.contains('sv2-hidden')).toBe(true);
  w.location.hash = '#profile';
  w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  expect(note.hidden).toBe(true);
});

test('admins still see the section and can edit', async () => {
  const { doc } = await boot({ admin: true, hash: '#mappings' });
  expect(doc.getElementById('sv2-tab-mappings').classList.contains('sv2-hidden')).toBe(false);
  expect(doc.getElementById('sv2-mappings-admin-only').hidden).toBe(true);
  expect(doc.getElementById('sv2-mappings-accept').hidden).toBe(false);
});

test('the API is not there yet (404): the section and the banner stay hidden', async () => {
  const { doc, api } = await boot({ summary: Promise.reject(Object.assign(new Error('Not found'), { status: 404 })) });
  expect(doc.getElementById('sv2-tab-mappings').classList.contains('sv2-hidden')).toBe(true);
  expect(doc.getElementById('lanaSetupBanner').hidden).toBe(true);
  expect(api.getMappings).not.toHaveBeenCalled();
});

describe('the mappings API is deployed with its flag off', () => {
  const failing = (status, code) => Promise.reject(Object.assign(new Error('x'), { status, code, data: { error: { code } } }));
  test.each([[404, null], [422, 'NOT_CONFIGURED'], [422, 'VALIDATION_ERROR'], [500, 'INTERNAL']])('%s %s: nav item, section and banner hidden; one summary request', async (status, code) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { doc, api } = await boot({ summary: failing(status, code) });
    expect(doc.getElementById('sv2-tab-mappings').classList.contains('sv2-hidden')).toBe(true);
    expect(doc.getElementById('sv2-panel-mappings').classList.contains('sv2-hidden')).toBe(true);
    expect(doc.getElementById('lanaSetupBanner').hidden).toBe(true);
    expect(api.getMappings).not.toHaveBeenCalled();
    expect(api.getMappingSummary).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(code === 'NOT_CONFIGURED' || status === 404 ? 0 : 1);
    warn.mockRestore();
  });
});

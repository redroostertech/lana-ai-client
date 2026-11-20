'use strict';

/**
 * The Reports pages (the list and one report) have no inline onclick
 * handlers: buttons carry data-reporting-action and one delegated listener
 * per page runs them. Runs the real page scripts (init() removed).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withReportSharedScripts } = require('./helpers/report-shared-scripts');

const SRC = path.join(__dirname, '../../src');
const js = fs.readFileSync(path.join(SRC, 'js/admin/report.js'), 'utf8');
const html = fs.readFileSync(path.join(SRC, 'admin/report.html'), 'utf8');
const listJs = fs.readFileSync(path.join(SRC, 'js/admin/reports-list.js'), 'utf8');
const listHtml = fs.readFileSync(path.join(SRC, 'admin/reports-list.html'), 'utf8');

function el(attrs) {
  const classes = new Set(['hidden']);
  return {
    attrs, removed: false, innerHTML: '', textContent: '', style: {},
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    parentElement: { remove() { this.removed = true; } }
  };
}

function page(apiImpl, script) {
  let source = script || js;
  const end = source.lastIndexOf('  init();');
  source = source.slice(0, end) + '  window.testExports = { onPageAction, renderHelpTextModal: typeof renderHelpTextModal === \'function\' ? renderHelpTextModal : null };' + source.slice(end + '  init();'.length);
  const window = withReportSharedScripts({ addEventListener() {} });
  window.ReportingGoalComparisonMapper = require('../../src/js/shared/reporting-goal-comparison-mapper.js');
  const nodes = {};
  const document = { addEventListener() {}, getElementById: (id) => (nodes[id] = nodes[id] || el({})), createElement: () => el({}) };
  const api = apiImpl || { post: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}), get: jest.fn().mockResolvedValue({ data: [] }) };
  vm.runInNewContext(source, { window, document, console: { log() {}, error() {}, warn() {} }, Intl, URLSearchParams,
    setTimeout: jest.fn(), clearTimeout: jest.fn(), api, Lex: { Modal: { confirmAsync: jest.fn().mockResolvedValue(true) } } });
  return { exports: window.testExports, nodes, api };
}

const click = (target) => ({ target: { closest: (sel) => (sel === '[data-reporting-action]' ? target : null) } });

test('no inline onclick on either Reports page', () => {
  [html, js, listHtml, listJs].forEach(text => expect(text).not.toMatch(/onclick=/i));
});

test.each([
  ['close-module-info', 'moduleInfoModal', js],
  ['close-data-sources', 'dataSourcesModal', js],
  ['close-missing-entities', 'missingEntitiesModal', js],
  ['close-import', 'importReportModal', listJs]
])('%s hides %s', (action, id, script) => {
  const p = page(null, script);
  p.nodes[id] = el({});
  p.nodes[id].classList.remove('hidden');
  p.exports.onPageAction(click(el({ 'data-reporting-action': action })));
  expect(p.nodes[id].classList.contains('hidden')).toBe(true);
});

test.each([['report.html', html, js], ['reports-list.html', listHtml, listJs]])('every data-reporting-action in %s is handled by its script', (_name, pageHtml, pageJs) => {
  const actions = [...new Set([...pageHtml.matchAll(/data-reporting-action="([^"]+)"/g)].map((m) => m[1]))];
  expect(actions.length).toBeGreaterThan(0);
  for (const a of actions) expect(pageJs).toContain("'" + a + "'");
});

test('the chart help button opens and closes its help panel', () => {
  const p = page();
  const out = p.exports.renderHelpTextModal({ title: 'Help <b>', sections: [{ heading: 'H', content: 'c' }] }, 'u1');
  expect(out).toContain('data-reporting-action="show-help"');
  expect(out).not.toContain('<b>');
  const id = 'help-modal-u1';
  p.exports.onPageAction(click(el({ 'data-reporting-action': 'show-help', 'data-help-modal': id })));
  expect(p.nodes[id].classList.contains('hidden')).toBe(false);
  p.exports.onPageAction(click(el({ 'data-reporting-action': 'hide-help', 'data-help-modal': id })));
  expect(p.nodes[id].classList.contains('hidden')).toBe(true);
});

test('customization buttons call the server for that id', async () => {
  const p = page();
  p.exports.onPageAction(click(el({ 'data-reporting-action': 'set-default-customization', 'data-customization-id': 'c7' })));
  expect(p.api.post).toHaveBeenCalledWith('/api/v1/module-customizations/c7/set-default');
  p.exports.onPageAction(click(el({ 'data-reporting-action': 'delete-customization', 'data-customization-id': 'c8' })));
  await new Promise(resolve => setImmediate(resolve));
  expect(p.api.delete).toHaveBeenCalledWith('/api/v1/module-customizations/c8');
});

test('Remove takes out its row', () => {
  const p = page();
  const btn = el({ 'data-reporting-action': 'remove-row' });
  p.exports.onPageAction(click(btn));
  expect(btn.parentElement.removed).toBe(true);
});

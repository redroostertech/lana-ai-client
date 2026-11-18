/**
 * The Metric Catalog page is open to admins and to anyone the backend lets
 * set goals (Lex.Auth.loadMetricGoalPermission). super_admin and the
 * System Administrator roles are not Lex.Auth.isAdmin(), yet the backend lets
 * them set goals: they must reach the page, not be sent to the dashboard.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/js/admin/metric-catalog.js'), 'utf8');

async function openPage({ isAdmin, canEdit }) {
  const go = jest.fn();
  const load = jest.fn(async () => canEdit);
  const window = { Lex: { Auth: { isAdmin: () => isAdmin, loadMetricGoalPermission: load }, Nav: { go } } };
  const document = { readyState: 'complete', getElementById: () => null, addEventListener() {} };
  const api = { get: jest.fn(() => new Promise(() => {})), getMetricCatalog: jest.fn(() => new Promise(() => {})),
    getMetricGoals: jest.fn(() => new Promise(() => {})) };
  vm.runInNewContext(SOURCE, { window, document, Lex: window.Lex, api, console, URLSearchParams,
    location: { search: '' }, setTimeout, clearTimeout });
  await new Promise(resolve => setImmediate(resolve));
  return { go, load };
}

test.each([
  ['a goal admin who is not isAdmin (super_admin)', false, true, false],
  ['an admin who may not set goals', true, false, false],
  ['someone who is neither', false, false, true],
])('%s: sent away %s', async (_label, isAdmin, canEdit, sentAway) => {
  const { go, load } = await openPage({ isAdmin, canEdit });
  expect(load).toHaveBeenCalled();
  expect(go.mock.calls.length > 0).toBe(sentAway);
});

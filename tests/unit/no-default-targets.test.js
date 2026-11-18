/**
 * A target is only a goal set in the Metric Catalog. No client page or
 * script presents a definition default (target.defaultValue, defaultTarget)
 * as a target; the goal editor's suggestion comes from the backend
 * (goal-recommendation), not from the definition here.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : files(full);
    return /\.(js|html)$/.test(entry.name) ? [full] : [];
  });
}

test('no client source reads a definition default as a target', () => {
  const offenders = files(SRC).filter((file) => /defaultTarget|target\??\.defaultValue/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file));
  expect(offenders).toEqual([]);
});

test('a metric grid card with no goal says "No goal set" and has no Override', () => {
  const source = fs.readFileSync(path.join(SRC, 'js/visualizations/renderers/metric-grid-renderer.js'), 'utf8');
  expect(source).toContain("'No goal set'");
  expect(source).not.toMatch(/override/i);
});

test('the data state renderer names the no_goal state', () => {
  global.window = {};
  require('../../src/js/shared/data-state.js');
  expect(global.window.DataState.render({ data_state: 'no_goal', data_state_reason: 'No goal set. An admin can set one in the Metric Catalog.' }))
    .toContain('No goal set');
  delete global.window;
});

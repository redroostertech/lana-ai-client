/**
 * Run alerts (automation_run_* and agent_run_*, in app only): the Lex
 * notification panel opens the run in its app from action_url or, when a
 * row has none, from its resource, and styles successes and failures. Runs
 * the REAL panel source in a vm sandbox (no jsdom, per repo convention).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const RUN = '66666666-6666-4666-8666-666666666666';

function loadPanelClass() {
  const source = fs.readFileSync(path.join(ROOT, 'src/js/lex/components/layout/lex-notification-panel.js'), 'utf8');
  let panelClass = null;
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} },
    window: null,
    Lex: { LexElement: class {}, defineLex: (_name, cls) => { panelClass = cls; }, Icons: {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'lex-notification-panel.js' });
  return panelClass;
}

describe('Lex notification panel: run alerts', () => {
  const Panel = loadPanelClass();
  const resolve = (n) => Panel.prototype._resolveNotificationTarget.call({}, n);

  test.each([
    [{ type: 'automation_run_failed', action_url: `automation/index.html#run/${RUN}`, resource_type: 'automation_run', resource_id: RUN }, `automation/index.html#run/${RUN}`],
    [{ type: 'agent_run_succeeded', action_url: `agents/index.html#run/${RUN}`, resource_type: 'agent_run', resource_id: RUN }, `agents/index.html#run/${RUN}`],
    [{ type: 'automation_run_succeeded', action_url: null, resource_type: 'automation_run', resource_id: RUN }, `automation/index.html#run/${RUN}`],
    [{ type: 'agent_run_failed', action_url: '', resource_type: 'agent_run', resource_id: RUN }, `agents/index.html#run/${RUN}`]
  ])('opens the run: %p', (notification, href) => {
    expect(resolve(notification)).toBe(href);
  });

  test('control: a row with no run and no link still goes nowhere', () => {
    expect(resolve({ type: 'agent_run_failed', action_url: '', resource_type: 'agent_run', resource_id: '' })).toBeNull();
  });

  test('successes use the success style and failures the danger style', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/js/lex/components/layout/lex-notification-panel.js'), 'utf8');
    for (const type of ['automation_run_succeeded', 'agent_run_succeeded']) {
      expect(source).toMatch(new RegExp(`${type}: \\{ bg: 'var\\(--lex-status-success-bg\\)'`));
      expect(source).toMatch(new RegExp(`${type}:'<path `));
    }
    for (const type of ['automation_run_failed', 'agent_run_failed']) {
      expect(source).toMatch(new RegExp(`${type}: \\{ bg: 'var\\(--lex-status-danger-bg\\)'`));
      expect(source).toMatch(new RegExp(`${type}:'<path `));
    }
  });
});

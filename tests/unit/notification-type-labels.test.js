/**
 * Notification type labels and failure styling.
 *
 * The backend sends `approval_resume_failed` when an approved action could
 * not be completed. The client showed the raw identifier (for example in the
 * notifications page type filter, which labels types through
 * LanaDisplay.machineIdentifierToLabel). These tests run the REAL
 * js/notifications.js in a vm sandbox (per repo convention we avoid jsdom).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');

function loadLanaDisplay() {
  const source = fs.readFileSync(path.join(ROOT, 'src/js/notifications.js'), 'utf8');
  const storage = new Map();
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: () => null, addEventListener() {} },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    setTimeout() {},
    clearTimeout() {},
    setInterval() {},
    clearInterval() {},
    Date,
    JSON,
    Promise,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'notifications.js' });
  return sandbox.LanaDisplay;
}

describe('LanaDisplay notification type labels', () => {
  const display = loadLanaDisplay();

  test.each([
    ['approval_requested', 'Approval requested'],
    ['approval_escalated', 'Approval escalated'],
    ['approval_reminder', 'Approval reminder'],
    ['approval_decided', 'Approval decided'],
    ['approval_resume_failed', 'Approval could not be completed'],
  ])('%s is labeled "%s"', (type, label) => {
    expect(display.machineIdentifierToLabel(type)).toBe(label);
    expect(display.formatText(type)).toBe(label);
  });

  test('unknown types still pass through unchanged', () => {
    expect(display.machineIdentifierToLabel('some_future_type')).toBe('some_future_type');
  });
});

describe('approval_resume_failed uses the failure style', () => {
  const DANGER = "{ bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' }";

  test('Lex notification panel maps it to the danger style and failure icon', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'src/js/lex/components/layout/lex-notification-panel.js'),
      'utf8'
    );
    expect(source).toMatch(new RegExp('approval_resume_failed:\\s*' + escapeRegExp(DANGER)));
    expect(source).toMatch(/approval_resume_failed:\s*'<path /);
  });

  test('notifications page maps it to the danger style and error icon', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/js/pages/notifications-page.js'), 'utf8');
    expect(source).toMatch(new RegExp('approval_resume_failed:\\s*' + escapeRegExp(DANGER)));
    expect(source).toMatch(/type === 'approval_resume_failed'[^\n]*key = 'error'/);
  });

  test('legacy notification panel maps it to the red icon and background', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/js/notifications.js'), 'utf8');
    expect(source).toMatch(/'approval_resume_failed': '<svg class="w-5 h-5 text-red-600"/);
    expect(source).toMatch(/'approval_resume_failed': 'bg-red-100'/);
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

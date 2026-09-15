'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function read(rel) {
  return fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
}

function createElementStub() {
  return {
    _bhWired: false,
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    classList: {
      add: jest.fn(),
      remove: jest.fn()
    },
    addEventListener: jest.fn(),
    querySelectorAll: jest.fn(() => [])
  };
}

function executeWithUser(user) {
  const apiCalls = [];
  const elements = {
    bhSummaryCard: createElementStub(),
    bhEntriesLoading: createElementStub(),
    bhEntriesList: createElementStub(),
    bhEntriesEmpty: createElementStub()
  };
  const context = {
    window: {},
    document: {
      getElementById: jest.fn((id) => elements[id] || null)
    },
    localStorage: {
      getItem: jest.fn(() => JSON.stringify(user))
    },
    api: {
      user,
      get: jest.fn((url) => {
        apiCalls.push(url);
        return new Promise(() => {});
      })
    },
    Lex: {
      Nav: null,
      Utils: { escapeHtml: (value) => String(value) }
    },
    Date,
    Promise,
    encodeURIComponent
  };

  vm.createContext(context);
  vm.runInContext(read('src/js/workspace-billable-hours.js'), context);
  context.window.renderBillableHoursTab({ matter_id: 'matter-1' });
  return apiCalls;
}

describe('workspace billable-hours admin scope contract', () => {
  test('admin users request all workspace billable hours for summaries and entries', () => {
    const urls = executeWithUser({ role_name: 'organization_admin' });

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/api/v1/billable-hours/summary?matter_id=matter-1');
    expect(urls[1]).toContain('/api/v1/billable-hours/drafts?matter_id=matter-1');
    expect(urls[0]).toContain('&all_users=true');
    expect(urls[1]).toContain('&all_users=true');
  });

  test('non-admin users keep the default own-user billable-hours scope', () => {
    const urls = executeWithUser({ role_name: 'user' });

    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toContain('all_users=true');
    expect(urls[1]).not.toContain('all_users=true');
  });
});

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createNode(initial = {}) {
  return {
    innerHTML: '',
    value: '',
    attributes: {},
    addEventListener: jest.fn(),
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    ...initial,
  };
}

function loadController(nodes = {}) {
  const context = {
    console,
    window: {},
    document: {
      getElementById(id) {
        return nodes[id] || null;
      },
    },
    api: {
      getCommandCenterWillDesignMeetingsMapping: jest.fn(),
      validateCommandCenterWillDesignMeetingsMapping: jest.fn(),
      saveCommandCenterWillDesignMeetingsMapping: jest.fn(),
      activateCommandCenterWillDesignMeetingsMapping: jest.fn(),
      reconcileCommandCenterWillDesignMeetings: jest.fn(),
    },
  };
  context.window = context;
  context.globalThis = context;
  const code = fs.readFileSync(
    path.join(__dirname, '../../src/js/admin/will-design-meetings-config.js'),
    'utf8'
  );
  vm.runInContext(code, vm.createContext(context));
  return context.window.LanaAdmin.WillDesignMeetingsConfig.__test;
}

describe('will-design-meetings-config admin controller', () => {
  test('compactMapping creates an editable draft without preserving configuration-required sentinel versions', () => {
    const testApi = loadController();

    expect(testApi.compactMapping({
      mapping_version: 'configuration-required',
      status: 'active',
      field_mappings: { meeting_type: 'event.kind' },
      accepted_values: { meeting_type: ['Will Design'] },
    })).toEqual({
      integration_source_id: null,
      mapping_version: 'will-design-meetings-v1',
      status: 'validated',
      effective_start: expect.any(String),
      effective_end: null,
      field_mappings: { meeting_type: 'event.kind' },
      accepted_values: { meeting_type: ['Will Design'] },
      canonical_values: {},
    });
  });

  test('trust card escapes rendered labels and values', () => {
    const testApi = loadController();

    const html = testApi.renderTrustCard('<Definition>', '<certified>', '"v1"', 'good');

    expect(html).toContain('&lt;Definition&gt;');
    expect(html).toContain('&lt;certified&gt;');
    expect(html).toContain('&quot;v1&quot;');
    expect(html).not.toContain('<Definition>');
  });

  test('validation renderer surfaces errors, warnings, and unresolved counts', () => {
    const nodes = {
      willDesignValidationPanel: createNode(),
    };
    const testApi = loadController(nodes);

    testApi.renderValidationResult({
      validation: {
        valid: false,
        errors: ['Required field missing'],
        warnings: ['New source value observed'],
        unresolved: {
          meeting_status: ['Tentative'],
          attorney_identity: ['ext-user-9'],
        },
      },
    });

    expect(nodes.willDesignValidationPanel.innerHTML).toContain('Mapping needs attention');
    expect(nodes.willDesignValidationPanel.innerHTML).toContain('1 errors, 1 warnings, 2 unresolved values');
    expect(nodes.willDesignValidationPanel.innerHTML).toContain('Required field missing');
    expect(nodes.willDesignValidationPanel.innerHTML).toContain('New source value observed');
  });

  test('reconciliation renderer separates pass and variance evidence', () => {
    const nodes = {
      willDesignReconcilePanel: createNode(),
    };
    const testApi = loadController(nodes);

    testApi.setState({
      reconciliation: {
        evidence: {
          pass: true,
          metric_key: 'completed_will_design_meetings',
          period: 'this_month',
          aggregate_value: 12,
          drilldown_count: 12,
          variance: 0,
          mapping_version: 'will-design-meetings-v1',
          metric_definition_version: '2026-07-23',
        },
      },
    });
    testApi.renderReconciliation();

    expect(nodes.willDesignReconcilePanel.innerHTML).toContain('Reconciliation passed');
    expect(nodes.willDesignReconcilePanel.innerHTML).toContain('completed_will_design_meetings');
    expect(nodes.willDesignReconcilePanel.innerHTML).toContain('will-design-meetings-v1');
    expect(nodes.willDesignReconcilePanel.innerHTML).toContain('2026-07-23');
  });
});

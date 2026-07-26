'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDashboardDetail() {
  const context = {
    console,
    URLSearchParams,
    window: {},
    document: {
      body: { classList: { add: jest.fn(), remove: jest.fn() } },
      getElementById() { return null; },
      querySelector() { return null; },
      addEventListener: jest.fn(),
    },
    api: {},
    setInterval: jest.fn(),
  };
  context.window = context;
  context.globalThis = context;
  context.Lex = {
    Auth: { isAdmin: () => true },
    Nav: {
      getParams: () => new URLSearchParams(''),
      go: jest.fn(),
    },
  };

  const code = fs.readFileSync(
    path.join(__dirname, '../../src/js/admin/dashboard-detail.js'),
    'utf8'
  );
  vm.runInContext(code, vm.createContext(context));
  return context.window.LanaAdmin.DashboardDetail.__test;
}

function sampleLane() {
  return {
    section: { title: 'Estate Planning - Will Design Meetings' },
    period: { key: 'this_month', label: 'This month', start: '2026-07-01T04:00:00.000Z', end: '2026-08-01T04:00:00.000Z' },
    source: { state: 'configured', data_health_state: 'healthy', last_successful_sync: '2026-07-23T12:00:00.000Z' },
    certification: {
      definition: { state: 'certified', label: 'Certified', version: 'definition-v1' },
      organization: { state: 'mapping_validated', label: 'Mapping validated' },
    },
    mapping: {
      validation: {
        unresolved: {
          meeting_status: ['Tentative'],
        },
      },
    },
    summary: [
      {
        id: 'completed',
        title: 'Completed',
        value: 7,
        drilldown: {
          module_key: 'legal_operations',
          metric_key: 'completed_will_design_meetings',
          period_start: '2026-07-01T04:00:00.000Z',
          period_end: '2026-08-01T04:00:00.000Z',
          filters: { meeting_status: ['completed'] },
        },
      },
    ],
    comparison: {
      current_period: { label: 'This month', value: 7 },
      comparison_period: { label: 'Last month', value: 5 },
    },
    ytd_trend: [
      {
        label: 'Jul',
        value: 7,
        drilldown: {
          module_key: 'legal_operations',
          metric_key: 'completed_will_design_meetings',
          period_start: '2026-07-01T04:00:00.000Z',
          period_end: '2026-08-01T04:00:00.000Z',
          filters: { month: '2026-07' },
        },
      },
    ],
    attorney_breakdown: [
      {
        attorney_name: 'Jessica Associate',
        total: 7,
        drilldown: {
          module_key: 'legal_operations',
          metric_key: 'completed_will_design_meetings',
          period_start: '2026-07-01T04:00:00.000Z',
          period_end: '2026-08-01T04:00:00.000Z',
          filters: { attorney_id: ['lana-user-1'] },
        },
      },
    ],
  };
}

describe('dashboard-detail Will Design card instance', () => {
  test('detects Will Design reusable card instances', () => {
    const testApi = loadDashboardDetail();

    expect(testApi.isWillDesignCardInstance('dashboard:estate-planning:will-design-meetings')).toBe(true);
    expect(testApi.isWillDesignCardInstance('attorney:will-design-meetings')).toBe(true);
    expect(testApi.isWillDesignCardInstance('dashboard:estate-planning:funding')).toBe(false);
  });

  test('maps dashboard and attorney instances onto the command-center facade contract', () => {
    const testApi = loadDashboardDetail();

    testApi.setState({
      currentCardInstanceId: 'dashboard:estate-planning:will-design-meetings',
      currentDashboardType: 'department',
      currentPeriodPreset: 'thisMonth',
      currentPeriodIsPreset: true,
    });
    expect(testApi.willDesignFacadePeriodParams()).toEqual({
      view: 'owner',
      instance: 'dashboard',
      card_instance: 'dashboard:estate-planning:will-design-meetings',
      period: 'this_month',
    });

    testApi.setState({
      currentCardInstanceId: 'attorney:will-design-meetings',
      currentDashboardType: 'attorney',
      currentPeriodPreset: 'thisYear',
      currentPeriodIsPreset: true,
    });
    expect(testApi.willDesignFacadePeriodParams()).toEqual({
      view: 'attorney',
      instance: 'attorney',
      card_instance: 'attorney:will-design-meetings',
      period: 'ytd',
    });
  });

  test('renders reusable detail lane and registers drilldown contexts', () => {
    const testApi = loadDashboardDetail();
    const html = testApi.renderWillDesignDetail(sampleLane());
    const drilldowns = testApi.getDrilldowns();

    expect(html).toContain('Reusable analytical card');
    expect(html).toContain('Will Design Meetings');
    expect(html).toContain('Completed');
    expect(html).toContain('This period vs prior period');
    expect(html).toContain('YTD trend');
    expect(html).toContain('Attorney breakdown');
    expect(html).toContain('Tentative');
    expect(Object.keys(drilldowns)).toHaveLength(3);
    expect(drilldowns['completed:0'].metric_key).toBe('completed_will_design_meetings');
    expect(drilldowns['attorney:2'].filters).toEqual({ attorney_id: ['lana-user-1'] });
  });
});

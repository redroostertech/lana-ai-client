'use strict';

/**
 * The firm's currency (user.default_currency from GET /api/v1/auth/me,
 * "USD" when unset) is kept on the stored user like the firm time zone.
 * Lex.Utils.getFirmCurrency reads it synchronously, and the shared money
 * formatters on dashboards, metric detail and reports use it.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function loadLexUtils(storedUser) {
  const timeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/time-utils.js'),
    'utf8'
  );
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../src/js/lex/lex.utils.js'),
    'utf8'
  );
  const userJson = storedUser ? JSON.stringify(storedUser) : null;
  const fakeWindow = {
    localStorage: { getItem: (key) => key === 'user' ? userJson : null },
    Intl,
    Date
  };
  const fakeDocument = {
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    }
  };
  const timeSandbox = new Function('window', timeSrc);
  const lexSandbox = new Function('window', 'document', src);
  timeSandbox(fakeWindow);
  lexSandbox(fakeWindow, fakeDocument);
  return fakeWindow;
}

describe('Lex.Utils.getFirmCurrency', () => {
  test('the stored firm currency', () => {
    expect(loadLexUtils({ default_currency: 'EUR' }).Lex.Utils.getFirmCurrency()).toBe('EUR');
    expect(loadLexUtils({ default_currency: 'gbp' }).Lex.Utils.getFirmCurrency()).toBe('GBP');
  });
  test('USD when unset or not a currency code', () => {
    expect(loadLexUtils(null).Lex.Utils.getFirmCurrency()).toBe('USD');
    expect(loadLexUtils({}).Lex.Utils.getFirmCurrency()).toBe('USD');
    ['EU', 'EURO', 123, 'E1R', ''].forEach((bad) => expect(loadLexUtils({ default_currency: bad }).Lex.Utils.getFirmCurrency()).toBe('USD'));
  });
});

describe('the profile keeps default_currency on the stored user', () => {
  test('loadUserProfile maps it like firm_timezone', async () => {
    const store = { user: null };
    const context = {
      console, URLSearchParams, AbortController, FormData: class FormData {}, setTimeout, clearTimeout, setInterval, clearInterval, fetch: jest.fn(),
      localStorage: { getItem: jest.fn((k) => (k === 'user' ? store.user : null)), setItem: jest.fn((k, v) => { if (k === 'user') store.user = v; }), removeItem: jest.fn() },
      document: { addEventListener: jest.fn(), body: {}, getElementById: jest.fn(() => null) },
      location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' },
      LanaConfig: {}, LanaTime: { nowMs: jest.fn(() => 1000), millisecondsSince: jest.fn((s) => 1000 - s), MS_PER_MINUTE: 60000 },
    };
    context.window = context;
    context.globalThis = context;
    vm.runInNewContext(read('js/api.js'), context, { filename: 'api.js' });
    const api = context.window.api;
    api.demoMode = false;
    api.getProfile = jest.fn().mockResolvedValue({ user: { user_id: 'u-1', org_id: 'o-1', firm_timezone: 'America/New_York', default_currency: 'CAD' } });
    const { user } = await api.loadUserProfile();
    expect(user.default_currency).toBe('CAD');
  });
});

describe('shared money formatters use the firm currency', () => {
  const lex = { Utils: { getFirmCurrency: () => 'EUR' } };

  test('metric detail view (summary, cells, change)', () => {
    global.Lex = lex;
    try {
      jest.isolateModules(() => {
        const V = require(path.join(SRC, 'js/shared/metric-detail-view.js'));
        expect(V.formatValue(1200, { format: 'currency' })).toBe('€1,200');
        expect(V.cellText(1200, 'money', 'amount')).toBe('€1,200');
      });
    } finally { delete global.Lex; }
  });

  test('report tiles', () => {
    const win = { Lex: lex };
    for (const rel of ['js/shared/data-state.js', 'js/shared/reporting-goal-comparison-mapper.js', 'js/admin/report-metric-card.js']) {
      new Function('window', read(rel))(win);
    }
    const html = win.ReportMetricCard.render({ key: 'r', name: 'Revenue', type: 'currency', current: 1200, data_state: 'ok' }, {});
    expect(html).toContain('€1,200.00');
    expect(html).not.toContain('$1,200');
  });

  test('without the firm currency everything stays in USD', () => {
    jest.isolateModules(() => {
      const V = require(path.join(SRC, 'js/shared/metric-detail-view.js'));
      expect(V.formatValue(1200, { format: 'currency' })).toBe('$1,200');
    });
  });

  test('no display formatter hard-codes USD any more (payment and config code is left alone)', () => {
    ['js/admin/report-metric-card.js', 'js/admin/dashboard-detail.js', 'js/admin/reporting-tables.js', 'js/admin/metric-detail.js', 'js/admin/report.js',
      'js/shared/metric-detail-view.js', 'js/shared/metric-card-preview.js', 'js/shared/metric-goal-form-mapper.js',
      'js/visualizations/chart-utils.js', 'js/visualizations/renderers/gauge-chart-renderer.js', 'js/visualizations/renderers/metric-grid-renderer.js']
      .forEach((rel) => {
        const src = read(rel);
        expect([rel, src.split("currency: 'USD'").length - 1]).toEqual([rel, 0]);
        expect(src).toContain('getFirmCurrency');
      });
  });
});

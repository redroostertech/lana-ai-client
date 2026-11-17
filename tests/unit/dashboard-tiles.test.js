'use strict';

/**
 * Reports and dashboards connect through the existing dashboard model: a
 * dashboard's tiles are catalog keys in layout.metric_keys. "Add to
 * dashboard" on a report result appends that metric's catalog key; a
 * dashboard reads its tiles by key; a tile from a report opens it.
 */

const fs = require('fs');
const path = require('path');

const win = {};
new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/shared/dashboard-tiles.js'), 'utf8'))(win);
const tiles = win.DashboardTiles;

describe('addTileToDashboard', () => {
  test('asks the server to append the tile (no read-modify-write in the browser)', async () => {
    const api = { addBIDashboardTile: jest.fn(async () => ({ data: { added: true, dashboard: { id: 'd1', name: 'Owner' } } })),
      getBIDashboard: jest.fn(), updateBIDashboard: jest.fn() };
    const result = await tiles.addTileToDashboard(api, 'd1', 'reporting.matter-aging-analysis.days_since_contact');
    expect(api.addBIDashboardTile).toHaveBeenCalledWith('d1', 'reporting.matter-aging-analysis.days_since_contact');
    expect(api.getBIDashboard).not.toHaveBeenCalled();
    expect(api.updateBIDashboard).not.toHaveBeenCalled();
    expect(result).toEqual({ added: true, name: 'Owner' });
  });

  test('a tile already on the dashboard says so', async () => {
    const api = { addBIDashboardTile: jest.fn(async () => ({ added: false, dashboard: { name: 'Owner' } })) };
    expect(await tiles.addTileToDashboard(api, 'd1', 'a')).toEqual({ added: false, name: 'Owner' });
  });
});

describe('card request for a saved dashboard', () => {
  test('a dashboard with tiles asks for exactly those keys', () => {
    expect(tiles.cardRequestKeys({ metric_keys: ['b', 'a'] })).toBe('b,a');
    expect(tiles.cardRequestKeys({})).toBeNull();
  });
});

describe('pages use the shared tile model', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

  test('report result tiles offer Add to dashboard from the backend catalog key', () => {
    const js = read('js/admin/reporting.js');
    // The tile footer itself is render-tested in report-metric-card.render.test.js.
    expect(js).toMatch(/footerEnd: metric\.catalogKey/);
    expect(js).toContain('DashboardTiles.addTileToDashboard(api, dashboardId, metricKey)');
    expect(read('admin/reporting.html')).toContain('js/shared/dashboard-tiles.js');
  });

  test('a dashboard reads its own tiles by key and opens a report only from report_link', () => {
    const js = read('js/admin/dashboard-detail.js');
    expect(js).toContain('DashboardTiles.cardRequestKeys(layout)');
    expect(js).not.toContain("|| 'admin/reporting.html'");
    expect(read('admin/dashboard-detail.html')).toContain('js/shared/dashboard-tiles.js');
    expect(read('js/api.js')).toContain("queryParts.push('metric_keys=' + encodeURIComponent(params.metric_keys))");
    expect(read('js/api.js')).toContain("'/api/v1/business-intelligence/dashboards/' + encodeURIComponent(id) + '/tiles', { metric_key: metricKey }");
  });

  test('the Add to dashboard picker lists only dashboards the user can write', () => {
    expect(read('js/admin/reporting.js')).toMatch(/api\.listBIDashboards\(\{ limit: 100, offset: 0, sort: 'name', order: 'asc', writable: 'true' \}\)/);
  });
});

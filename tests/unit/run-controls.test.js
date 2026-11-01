'use strict';

/**
 * Run controls: the view module (shared/run-controls.js), the API client and
 * the admin page wiring (admin/run-controls.html). The backend shapes are
 * checked in run-controls-backend-contract.test.js.
 */

const fs = require('fs');
const path = require('path');
const V = require('../../src/js/shared/run-controls.js');
const RunControlsAPIClient = require('../../src/js/api/run-controls-api.client.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');

const LIMITS = {
  max_automatic_agent_runs_per_day: 200, max_agent_spend_microdollars_per_day: null, automatic_runs_paused: false,
  paused_by: null, paused_at: null, updated_by: 'u1', updated_at: '2026-10-31T09:30:00.000Z', is_default: false,
};

describe('run limits editor', () => {
  const READ_AT = { expected_updated_at: LIMITS.updated_at };

  test('sends only what changed, with the revision it was read at, and nothing when nothing changed', () => {
    expect(V.draftChange(LIMITS, { dailyLimit: '200', spend: '' })).toEqual({ change: null, errors: {} });
    expect(V.draftChange(LIMITS, { dailyLimit: '150', spend: '' }).change).toEqual({ max_automatic_agent_runs_per_day: 150, ...READ_AT });
    expect(V.draftChange(LIMITS, { dailyLimit: '200', spend: '$1,250.5' }).change).toEqual({ max_agent_spend_microdollars_per_day: 1250500000, ...READ_AT });
    expect(V.draftChange({ ...LIMITS, max_agent_spend_microdollars_per_day: 5000000 }, { spend: ' ' }).change).toEqual({ max_agent_spend_microdollars_per_day: null, ...READ_AT });
    expect(V.draftChange(LIMITS, { paused: true }).change).toEqual({ automatic_runs_paused: true, ...READ_AT });
    expect(V.draftChange(LIMITS, { paused: false }).change).toBeNull();
    // The defaults (no stored row) are read at no revision.
    expect(V.draftChange({ ...LIMITS, is_default: true, updated_at: null }, { paused: true }).change).toEqual({ automatic_runs_paused: true, expected_updated_at: null });
    expect(V.revisionOf({ ...LIMITS, is_default: true })).toBeNull();
    expect(V.revisionOf(LIMITS)).toBe(LIMITS.updated_at);
  });

  test('a change that was not saved reads back in words', () => {
    expect(V.changeSummary({ max_automatic_agent_runs_per_day: 50, max_agent_spend_microdollars_per_day: null, expected_updated_at: 'x' }))
      .toBe('Automatic agent runs per day: 50. Daily spend figure: none.');
    expect(V.changeSummary({ automatic_runs_paused: true })).toBe('Pause automatic runs.');
    expect(V.changeSummary({ automatic_runs_paused: false, max_agent_spend_microdollars_per_day: 12500000 })).toBe('Turn automatic runs back on. Daily spend figure: $12.50.');
  });

  test('text that is not a number cannot be sent; bounds are left to the server', () => {
    expect(V.draftChange(LIMITS, { dailyLimit: '' })).toEqual({ change: null, errors: { max_automatic_agent_runs_per_day: 'Enter a number of runs.' } });
    expect(V.draftChange(LIMITS, { spend: 'ten' }).errors).toEqual({ max_agent_spend_microdollars_per_day: 'Enter an amount in dollars, or leave it empty.' });
    // Out of range or fractional values go to the server, which refuses them on the field.
    expect(V.draftChange(LIMITS, { dailyLimit: '-3' }).change).toEqual({ max_automatic_agent_runs_per_day: -3, expected_updated_at: LIMITS.updated_at });
  });

  test('limits read as running, paused or defaults', () => {
    const when = (value) => 'T(' + value + ')';
    expect(V.limitsView({ ...LIMITS, max_agent_spend_microdollars_per_day: 2500000 }, when)).toMatchObject({ paused: false, statusLabel: 'Running', dailyLimit: '200', spend: '2.5', updatedText: 'Last changed T(2026-10-31T09:30:00.000Z).' });
    expect(V.limitsView({ ...LIMITS, automatic_runs_paused: true, paused_at: '2026-11-01T14:00:00.000Z' }, when))
      .toMatchObject({ paused: true, statusLabel: 'Paused', statusTone: 'yellow', statusText: 'Paused since T(2026-11-01T14:00:00.000Z).' });
    expect(V.limitsView({ ...LIMITS, is_default: true, updated_at: null }, when).updatedText).toBe('These are the defaults. No one has changed them yet.');
  });

  test('who paused and changed them, and how many automatic runs started today', () => {
    const when = (value) => 'T(' + value + ')';
    const named = { ...LIMITS, automatic_runs_paused: true, paused_at: '2026-11-01T14:00:00.000Z', paused_by_name: 'Ana Ruiz', updated_by_name: 'Sam Lee', started_today: 1234 };
    expect(V.limitsView(named, when)).toMatchObject({
      statusText: 'Paused since T(2026-11-01T14:00:00.000Z) by Ana Ruiz.',
      updatedText: 'Last changed T(2026-10-31T09:30:00.000Z) by Sam Lee.',
      usedToday: '1,234 of 200 used today'
    });
    // No name (a deleted user) and no count read without them.
    expect(V.limitsView({ ...named, paused_by_name: null, updated_by_name: '', started_today: undefined }, when))
      .toMatchObject({ statusText: 'Paused since T(2026-11-01T14:00:00.000Z).', updatedText: 'Last changed T(2026-10-31T09:30:00.000Z).', usedToday: '' });
    expect(V.limitsView({ ...LIMITS, started_today: 0 }, when).usedToday).toBe('0 of 200 used today');
  });

  test('refusals: field, forbidden, unavailable and anything else', () => {
    const error = (status, body, message) => Object.assign(new Error(message || 'x'), { status, data: body ? { error: body } : undefined });
    expect(V.errorView(error(400, { code: 'VALIDATION_ERROR', message: 'Validation failed', field: 'max_automatic_agent_runs_per_day',
      details: [{ path: ['max_automatic_agent_runs_per_day'], message: 'Number must be less than or equal to 100000' }] })))
      .toEqual({ kind: 'field', field: 'max_automatic_agent_runs_per_day', title: 'Not saved', text: 'Number must be less than or equal to 100000' });
    expect(V.errorView(error(400, { message: 'Send at least one limit', details: [{ path: [], message: 'Send at least one limit' }] })))
      .toEqual({ kind: 'error', title: 'Not saved', text: 'Send at least one limit' });
    expect(V.errorView(error(403, { message: 'Permission required: agents:run' }))).toMatchObject({ kind: 'forbidden', text: 'Permission required: agents:run' });
    expect(V.errorView(error(404))).toMatchObject({ kind: 'unavailable' });
    const current = { ...LIMITS, max_automatic_agent_runs_per_day: 80, updated_at: '2026-11-01T15:00:00.000Z' };
    expect(V.errorView(error(409, { code: 'RUN_LIMITS_STALE', message: 'changed', details: { limits: current } })))
      .toMatchObject({ kind: 'stale', title: 'Not saved', limits: current });
    expect(V.errorView(error(409, { code: 'RUN_LIMITS_STALE', message: 'changed' })).text).toContain('someone else changed the run limits');
    // Control: another 409 is not read as stale.
    expect(V.errorView(error(409, { code: 'OTHER', message: 'Conflict' }))).toMatchObject({ kind: 'error', text: 'Conflict' });
    expect(V.errorView(error(500, null, 'boom'))).toMatchObject({ kind: 'error', text: 'boom' });
  });
});

describe('usage', () => {
  test('money, counts and periods', () => {
    expect(V.money(null)).toBe('Not priced');
    expect(V.money(0)).toBe('$0.00');
    expect(V.money(10500)).toBe('$0.0105');
    expect(V.money(12345678901)).toBe('$12,345.68');
    expect(V.count(1234567)).toBe('1,234,567');
    expect(V.PERIODS.map((p) => p.value)).toEqual(['7', '30', '90']);
    expect(V.periodWindow('90', new Date('2026-11-01T00:00:00.000Z')).since).toBe('2026-08-03T00:00:00.000Z');
  });

  test('unknown trigger types and rows with no matter still read', () => {
    const shown = V.usageView({ totals: {}, by_agent: [{ agent_definition_id: 'd', agent_slug: 'slug-only', runs: 1 }],
      by_trigger_type: [{ trigger_type: 'alert_fired', runs: 1 }], by_matter: [{ matter_id: null, runs: 1 }] });
    expect(shown.agents[0].agent).toBe('slug-only');
    expect(shown.triggers[0].trigger).toBe('Alert fired');
    expect(shown.matters[0]).toMatchObject({ id: 'none', matter: 'No matter', cost: 'Not priced' });
    const labels = V.usageView({ by_matter: [
      { matter_id: 'm1', matter_code: 'MATT-1', matter_name: 'Fairweather Trust' },
      { matter_id: 'm2', matter_code: 'MATT-2', matter_name: null },
      { matter_id: 'm3', matter_code: null, matter_name: null }
    ] }).matters;
    expect(labels.map((row) => [row.id, row.matter])).toEqual([['m1', 'Fairweather Trust (MATT-1)'], ['m2', 'MATT-2'], ['m3', 'Unnamed matter']]);
    expect(V.usageView(null).tiles.map((t) => t.value)).toEqual(['0', '0', 'Not priced']);
  });

  test('the client sends the documented requests and unwraps the answers', async () => {
    const api = { get: jest.fn(), put: jest.fn() };
    const client = new RunControlsAPIClient(api);
    api.get.mockResolvedValueOnce({ status: 'success', data: { limits: LIMITS } });
    await expect(client.getRunLimits()).resolves.toEqual(LIMITS);
    expect(api.get).toHaveBeenLastCalledWith('/api/v1/admin/run-limits');
    api.put.mockResolvedValueOnce({ status: 'success', data: { limits: { ...LIMITS, automatic_runs_paused: true } } });
    await expect(client.updateRunLimits({ automatic_runs_paused: true })).resolves.toMatchObject({ automatic_runs_paused: true });
    expect(api.put).toHaveBeenLastCalledWith('/api/v1/admin/run-limits', { automatic_runs_paused: true });
    api.get.mockResolvedValueOnce({ usage: { totals: { runs: 2 } } });
    await expect(client.getUsage({ since: 'a', until: 'b' })).resolves.toEqual({ totals: { runs: 2 } });
    expect(api.get).toHaveBeenLastCalledWith('/api/v1/agents/usage?since=a&until=b');
  });
});

describe('admin/run-controls.html wiring', () => {
  const page = read('admin/run-controls.html');
  const controller = read('js/admin/run-controls.js');

  test('the page has its own js and css, and loads modules before the controller and components before lex-page-init', () => {
    expect(page).toContain('href="../css/admin/run-controls.css"');
    const order = ['js/api/run-controls-api.client.js', 'js/shared/run-controls.js', 'js/admin/run-controls.js'].map((file) => page.indexOf(file));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const init = page.indexOf('js/lex/lex-page-init.js');
    ['foundation/lex-metric.js', 'data/lex-table.js', 'form/lex-input.js', 'form/lex-toggle.js', 'form/lex-segmented.js', 'foundation/lex-empty.js']
      .forEach((component) => { expect(page.indexOf(component)).toBeGreaterThan(-1); expect(page.indexOf(component)).toBeLessThan(init); });
    expect(page.slice(page.lastIndexOf('<script src='))).toContain('js/auth-guard.js');
  });

  test('no inline styles in the page content, and no client-side role gate (the server answers 403)', () => {
    const content = page.slice(page.indexOf('<template id="page-content">'), page.indexOf('</template>'));
    expect(content).not.toMatch(/style=|<style/);
    expect(controller).not.toMatch(/hasRole|canView|allowedRoles/);
  });

  test('reachable from the admin hub and the admin switcher', () => {
    expect(read('admin/index.html')).toContain('data-href="admin/run-controls.html"');
    expect(read('js/admin/admin-switcher.js')).toContain("value: 'admin/run-controls.html'");
    expect(read('js/lex/lex-nav.js')).toContain("'admin/run-controls.html'");
  });

  test('the Traces route filter lists Operations', () => {
    const traces = read('js/admin/admin-traces.js');
    expect(traces).toMatch(/var ROUTES = \[[^\]]*'operations'/);
    expect(traces).toContain("operations: 'Operations'");
  });
});

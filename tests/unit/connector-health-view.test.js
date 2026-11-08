'use strict';

// Data Connectors: the "Needs attention" summary, the Google permission
// notices and the Add another form (src/js/shared/connector-health-view.js),
// plus the page wiring in src/js/data_connectors.js and the API wrapper in
// src/js/connectors.js. The backend decides health and re-auth; these tests
// use mocked payloads shaped like the contract.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const H = require(path.join(SRC, 'js/shared/connector-health-view.js'));

const SOURCE_A = '11111111-2222-4333-8444-555555555555';
const SOURCE_B = '22222222-3333-4444-8555-666666666666';

const HEALTH = {
  success: true,
  data: {
    summary: { total: 3, healthy: 1, needs_attention: 2 },
    connections: [
      { id: SOURCE_A, connector_id: 'gmail', name: 'Gmail', scope: 'personal', status: 'needs_attention', reasons: ['auth_expired', 'recent_failures'], auth_status: 'expired', sync_status: 'error', last_successful_sync: null, failed_syncs_24h: 3 },
      { id: SOURCE_B, connector_id: 'clio', name: 'Clio', scope: 'organization', status: 'needs_attention', reasons: ['stale_sync'], auth_status: 'connected', sync_status: 'idle', last_successful_sync: '2026-11-06T10:00:00Z', failed_syncs_24h: 0 },
      { id: '33333333-4444-4555-8666-777777777777', connector_id: 'qb', name: 'QuickBooks', scope: 'organization', status: 'healthy', reasons: [] }
    ],
    checked_at: '2026-11-08T12:00:00Z'
  }
};

const ALL_HEALTHY = {
  success: true,
  data: { summary: { total: 1, healthy: 1, needs_attention: 0 }, connections: [{ id: SOURCE_A, connector_id: 'gmail', name: 'Gmail', status: 'healthy', reasons: [] }] }
};

function memoryStorage() {
  const data = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data
  };
}

describe('connection health summary', () => {
  test('every reason code has short, plain copy', () => {
    expect(H.reasonText('auth_expired')).toBe('Not signed in. Connect to keep syncing.');
    expect(H.reasonText('stale_sync')).toBe('No successful sync in the last day.');
    expect(H.reasonText('inactive')).toBe('This connection is turned off.');
    expect(H.reasonText('sync_disabled')).toBe('Syncing is turned off.');
    expect(H.reasonText('sync_error')).toBe('The last sync failed.');
    expect(H.reasonText('recent_failures')).toBe('Some syncs failed today.');
    expect(H.reasonText('something_new')).toBe('Something needs a look.');
    for (const text of Object.values(H.REASON_COPY)) expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  test('only needs_attention connections become items, with their reasons and action', () => {
    const view = H.healthView(HEALTH);
    expect(view.needsAttention).toBe(2);
    expect(view.items.map((i) => i.id)).toEqual([SOURCE_A, SOURCE_B]);
    expect(view.items[0]).toMatchObject({ name: 'Gmail', connectorId: 'gmail', scope: 'personal', action: 'Reconnect' });
    expect(view.items[0].reasons).toEqual(['Not signed in. Connect to keep syncing.', 'Some syncs failed today.']);
    expect(view.items[1]).toMatchObject({ name: 'Clio', action: 'Open', reasons: ['No successful sync in the last day.'] });
    expect(H.rowNeedsAttention(view, ['clio', SOURCE_B])).toBe(true);
    expect(H.rowNeedsAttention(view, ['33333333-4444-4555-8666-777777777777'])).toBe(false);
  });

  test('the summary lists each affected connection with a Reconnect or Open button', () => {
    const html = H.attentionMarkup(H.healthView(HEALTH));
    expect(html).toContain('<lex-badge label="Needs attention" color="yellow" size="sm"></lex-badge>');
    expect(html).toContain('2 connections need a look.');
    expect(html).toContain('Not signed in. Connect to keep syncing.');
    expect(html).toContain(`data-dc-health-open="${SOURCE_A}" data-dc-health-connector="gmail">Reconnect</lex-btn>`);
    expect(html).toContain(`data-dc-health-open="${SOURCE_B}" data-dc-health-connector="clio">Open</lex-btn>`);
    expect(html).not.toContain('QuickBooks');
  });

  test('all healthy, or no payload: nothing shows', () => {
    expect(H.attentionMarkup(H.healthView(ALL_HEALTHY))).toBe('');
    expect(H.attentionMarkup(null)).toBe('');
    expect(H.healthView(undefined).items).toEqual([]);
  });

  test('names are escaped', () => {
    const html = H.attentionMarkup(H.healthView({ data: { connections: [{ id: 'x', name: '<img onerror=1>', status: 'needs_attention', reasons: ['sync_error'] }] } }));
    expect(html).toContain('&lt;img onerror=1&gt;');
    expect(html).not.toContain('<img');
  });
});

describe('Google write permission notice', () => {
  const row = (needs, capability = 'send_email', id = SOURCE_A) => ({
    id, connector_id: 'gmail', name: 'Gmail',
    write_access: needs === undefined ? null : { needs_reauth: needs, reason: needs ? 'missing_write_scope' : null, capability }
  });

  test('needs_reauth true shows a notice with the capability in plain words', () => {
    const notices = H.reauthNotices([row(true)], []);
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toBe('Gmail needs permission to send email. Automations that do this will fail until you reconnect.');
    expect(H.reauthNotices([row(true, 'create_calendar_events')], [])[0].text).toContain('needs permission to create calendar events.');
    expect(H.reauthNotices([row(true, 'write_sheets')], [])[0].text).toContain('needs permission to edit Sheets.');
    const html = H.reauthMarkup(notices);
    expect(html).toContain(`data-dc-reauth-open="${SOURCE_A}">Reconnect</lex-btn>`);
    expect(html).toContain(`data-dc-reauth-dismiss="${SOURCE_A}:send_email">Dismiss</lex-btn>`);
  });

  test('false, null, a missing write_access and unknown (null) show nothing', () => {
    expect(H.reauthNotices([row(false), row(null), row(undefined), { id: 'x' }], [])).toEqual([]);
    expect(H.reauthMarkup([])).toBe('');
  });

  test('Dismiss is remembered per viewer and hides only that notice', () => {
    const storage = memoryStorage();
    expect(H.readDismissed(storage)).toEqual([]);
    H.rememberDismissed(`${SOURCE_A}:send_email`, storage);
    H.rememberDismissed(`${SOURCE_A}:send_email`, storage);
    expect(JSON.parse(storage.data[H.DISMISS_STORAGE_KEY])).toEqual([`${SOURCE_A}:send_email`]);
    const notices = H.reauthNotices([row(true), row(true, 'write_sheets', SOURCE_B)], H.readDismissed(storage));
    expect(notices.map((n) => n.key)).toEqual([`${SOURCE_B}:write_sheets`]);
  });

  test('blocked or broken storage never throws', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(H.readDismissed(throwing)).toEqual([]);
    expect(H.rememberDismissed('k', throwing)).toEqual(['k']);
    expect(H.readDismissed({ getItem: () => '{not json', setItem() {} })).toEqual([]);
  });
});

describe('Add another (multi-instance)', () => {
  test('the key follows the server rules', () => {
    expect(H.validateInstanceKey('second-office')).toEqual({ ok: true, key: 'second-office', error: '' });
    expect(H.validateInstanceKey('  Acme2  ').key).toBe('Acme2');
    expect(H.validateInstanceKey('a'.repeat(100)).ok).toBe(true);
    expect(H.validateInstanceKey('').error).toBe('Enter a name.');
    expect(H.validateInstanceKey('a'.repeat(101)).error).toBe('Use 100 characters or fewer.');
    expect(H.validateInstanceKey('-office').error).toBe('Start with a letter or number.');
    expect(H.validateInstanceKey('my office').error).toBe('Use only letters, numbers and hyphens.');
    expect(H.validateInstanceKey('acme_2').ok).toBe(false);
    expect(H.validateInstanceKey('Default').error).toBe('That name is saved for the first one. Pick another.');
  });

  test('a valid key calls Connectors.createInstance(slug, key) once', async () => {
    const connectors = { createInstance: jest.fn().mockResolvedValue({ data: { id: 'new' } }) };
    const outcome = await H.submitInstance(connectors, 'quickbooks', ' east-office ');
    expect(connectors.createInstance).toHaveBeenCalledTimes(1);
    expect(connectors.createInstance).toHaveBeenCalledWith('quickbooks', 'east-office');
    expect(outcome).toEqual({ ok: true, key: 'east-office', result: { data: { id: 'new' } } });
  });

  test('an invalid key never calls the server', async () => {
    const connectors = { createInstance: jest.fn() };
    expect(await H.submitInstance(connectors, 'quickbooks', 'default')).toEqual({ ok: false, error: 'That name is saved for the first one. Pick another.' });
    expect(connectors.createInstance).not.toHaveBeenCalled();
  });

  test('server errors become plain sentences', async () => {
    const fail = (status, data, message) => ({ createInstance: () => Promise.reject(Object.assign(new Error(message || 'x'), { status, data })) });
    expect((await H.submitInstance(fail(409, { instance_key: 'east' }), 'qb', 'east')).error).toBe('That name is already used. Pick another.');
    expect((await H.submitInstance(fail(409, { error: 'No existing instance' }), 'qb', 'east')).error).toBe('Connect this tool once first. Then you can add another.');
    expect((await H.submitInstance(fail(400, {}, "Connector 'qb' does not support multiple instances"), 'qb', 'east')).error).toBe("Connector 'qb' does not support multiple instances");
    expect((await H.submitInstance(fail(403, {}), 'qb', 'east')).error).toBe('Only admins can add another one.');
    expect((await H.submitInstance(fail(500, {}), 'qb', 'east')).error).toBe('Could not add it. Try again.');
  });

  test('the form copy comes from the manifest, with plain fallbacks', () => {
    expect(H.instanceForm('QuickBooks', { enabled: true, instance_label: 'Company name', instance_helper_text: 'One per company.', instance_placeholder: 'acme' }))
      .toEqual({ heading: 'Add another QuickBooks', label: 'Company name', help: 'One per company.', placeholder: 'acme' });
    expect(H.instanceForm('Clio', { enabled: true })).toEqual({ heading: 'Add another Clio', label: 'Name', help: 'Use letters, numbers and hyphens. No spaces.', placeholder: 'second-account' });
  });
});

describe('Connectors.getHealth', () => {
  test('GETs the health route', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/src/data-connectors.html', runScripts: 'outside-only' });
    const { window } = dom;
    window.eval(read('js/time-utils.js'));
    const calls = [];
    window.api = { get: (url) => { calls.push(url); return Promise.resolve(HEALTH); }, isDemoMode: () => false };
    window.eval(read('js/connectors.js'));
    await expect(window.Connectors.getHealth()).resolves.toEqual(HEALTH);
    expect(calls).toEqual(['/api/v1/integrations/connectors/health']);
    dom.window.close();
  });
});

describe('Data Connectors page wiring', () => {
  function loadPage({ getHealth, admin } = {}) {
    const win = { localStorage: { getItem: () => null, setItem: () => {} }, Intl, Date, setTimeout, clearTimeout, console: { warn: () => {}, error: () => {}, log: () => {} } };
    // eslint-disable-next-line no-new-func
    new Function('window', read('js/time-utils.js'))(win);
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', read('js/lex/lex.utils.js'))(win, { createTextNode: (t) => ({ textContent: String(t) }) });
    win.LanaConnectorHealthView = H;
    win.ConnectorRegistry = { isConnectorInstalled: () => false };
    win.Lex.Toast = { error: () => {}, warning: () => {} };
    win.Lex.Auth = { isAdmin: () => Boolean(admin) };
    win.addEventListener = () => {};
    const doc = { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} };
    const connectors = { getHealth: getHealth || (() => Promise.resolve(HEALTH)) };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'ConnectorRegistry', 'Connectors', 'api', 'Lex', 'console', read('js/data_connectors.js'))(
      win, doc, win.ConnectorRegistry, connectors, {}, win.Lex, win.console
    );
    return win.DataConnectorsTable;
  }

  const clio = { id: SOURCE_B, connector_id: 'clio', name: 'Clio', status: 'connected' };
  const quickbooks = {
    id: SOURCE_A, connector_id: 'quickbooks', name: 'QuickBooks', status: 'connected',
    multi_instance: { enabled: true, instance_label: 'Company', instance_helper_text: 'One per company.', instance_placeholder: 'acme' }
  };

  test('a row the health check flagged gets needs_attention, and its status stays the same', async () => {
    const page = loadPage();
    expect(page.mapConnectorRow(clio, [clio], []).needs_attention).toBe('no');
    await page.loadConnectorHealth();
    const row = page.mapConnectorRow(clio, [clio], []);
    expect(row.needs_attention).toBe('yes');
    expect(row.status).toBe('connected');
  });

  test('a health error fails quietly and flags nothing', async () => {
    const page = loadPage({ getHealth: () => Promise.reject(new Error('500')) });
    await expect(page.loadConnectorHealth()).resolves.toBeNull();
    expect(page.mapConnectorRow(clio, [clio], []).needs_attention).toBe('no');
  });

  test('the status cell adds a Needs attention badge only for flagged rows', () => {
    const T = require(path.join(SRC, 'js/shared/connector-table.js'));
    const statuses = { connected: { label: 'Connected', color: 'green' } };
    const render = T.cellRenderers({ statuses }).status;
    expect(render('connected', { needs_attention: 'yes' })).toContain('label="Needs attention"');
    expect(render('connected', { needs_attention: 'yes' })).toContain('label="Connected"');
    expect(render('connected', { needs_attention: 'no' })).not.toContain('Needs attention');
  });

  test('Add another shows on multi-instance rows, for admins only', () => {
    const adminPage = loadPage({ admin: true });
    const row = adminPage.mapConnectorRow(quickbooks, [quickbooks], []);
    expect(row.instance_slug).toBe('quickbooks');
    expect(adminPage.connectorActionsCell(row)).toContain(`openAddInstanceModal('${SOURCE_A}', event)`);
    expect(adminPage.connectorActionsCell(row)).toContain('aria-label="Add another QuickBooks"');
    expect(adminPage.connectorActionsCell(adminPage.mapConnectorRow(clio, [clio], []))).not.toContain('openAddInstanceModal');

    const memberPage = loadPage({ admin: false });
    expect(memberPage.connectorActionsCell(memberPage.mapConnectorRow(quickbooks, [quickbooks], []))).not.toContain('openAddInstanceModal');
  });
});

describe('a long attention list', () => {
  test('shows the first five and says how many more are marked below (control: five or fewer show all)', () => {
    const conn = (i) => ({ id: 's' + i, connector_id: 'c' + i, name: 'Tool ' + i, status: 'needs_attention', reasons: ['stale_sync'] });
    const many = H.attentionMarkup(H.healthView({ data: { summary: { needs_attention: 13 }, connections: Array.from({ length: 13 }, (_, i) => conn(i)) } }));
    expect((many.match(/dc-attention-item/g) || []).length).toBe(5);
    expect(many).toContain('13 connections need a look.');
    expect(many).toContain('8 more are marked in the list below.');
    const few = H.attentionMarkup(H.healthView({ data: { summary: { needs_attention: 5 }, connections: Array.from({ length: 5 }, (_, i) => conn(i)) } }));
    expect((few.match(/dc-attention-item/g) || []).length).toBe(5);
    expect(few).not.toContain('more');
  });
});

describe('reason copy', () => {
  test('not signed in hides the no-sync reason it explains; other reasons stay (control: stale sync alone still shows)', () => {
    expect(H.reasonList(['auth_expired', 'sync_disabled', 'stale_sync'])).toEqual(['Not signed in. Connect to keep syncing.', 'Syncing is turned off.']);
    expect(H.reasonList(['stale_sync'])).toEqual(['No successful sync in the last day.']);
  });
});

/**
 * Renderer engine status (src/js/engine-status.js): problem+json 426 and 503
 * handling, engine state to banner state, Settings view model.
 */

const status = require('../../src/js/engine-status');

const CLIENT_TOO_OLD = 'This copy of LANA is older than your organization\'s server supports. Update LANA to keep working.';
const SERVER_TOO_OLD = 'Your organization\'s server is being updated to work with this copy of LANA. Try again shortly.';

function engineStatus(overrides = {}) {
  return {
    configured: true,
    enabled: true,
    inUse: true,
    mode: 'spawn',
    process: 'running',
    port: 47011,
    healthy: true,
    health: {
      status: 'ok',
      chef: { origin: 'https://chef.example.test', status: 'ready', reachable: true, api: '1.0', min_client: '1.0' },
      data_api: { version: '1.0', min_server: '1.0' },
      version: { status: 'ok' }
    },
    ...overrides
  };
}

describe('classifyProblem', () => {
  test('426 DATA_API_VERSION_UNSUPPORTED shows the server\'s detail and is never retried', () => {
    const problem = { type: 'urn:lana:problem:DATA_API_VERSION_UNSUPPORTED', status: 426, code: 'DATA_API_VERSION_UNSUPPORTED', detail: CLIENT_TOO_OLD, direction: 'client_too_old' };
    expect(status.classifyProblem(426, problem)).toEqual({ state: 'version_refused', code: 'DATA_API_VERSION_UNSUPPORTED', message: CLIENT_TOO_OLD, retry: false });
  });

  test('426 the other way round (server too old) uses that detail', () => {
    expect(status.classifyProblem(426, { code: 'DATA_API_VERSION_UNSUPPORTED', detail: SERVER_TOO_OLD }).message).toBe(SERVER_TOO_OLD);
  });

  test('503 CHEF_UNAVAILABLE is the non-blocking retrying state', () => {
    const classified = status.classifyProblem(503, { code: 'CHEF_UNAVAILABLE', detail: 'LANA has not been able to reach your organization\'s server yet.' });
    expect(classified).toMatchObject({ state: 'chef_unavailable', retry: true, message: 'Can\'t reach your organization\'s server, retrying' });
  });

  test('other errors are not engine problems', () => {
    expect(status.classifyProblem(503, { error: { code: 'SERVICE_UNAVAILABLE' } })).toBeNull();
    expect(status.classifyProblem(426, { code: 'SOMETHING_ELSE' })).toBeNull();
    expect(status.classifyProblem(500, null)).toBeNull();
  });
});

describe('describeEngineStatus', () => {
  test('engine not in use: direct, nothing shown', () => {
    expect(status.describeEngineStatus({ inUse: false }).state).toBe('direct');
    expect(status.describeEngineStatus(null).state).toBe('direct');
  });

  test('healthy and connected: ok', () => {
    expect(status.describeEngineStatus(engineStatus()).state).toBe('ok');
  });

  test('engine process down: restarting LANA\'s AI service', () => {
    expect(status.describeEngineStatus(engineStatus({ process: 'restarting', healthy: false, health: null }))).toEqual({ state: 'restarting', message: 'Restarting LANA\'s AI service' });
  });

  test('Chef not reachable yet: retrying', () => {
    const s = engineStatus();
    s.health.chef.status = 'unreachable';
    s.health.chef.reachable = false;
    expect(status.describeEngineStatus(s).state).toBe('chef_unavailable');
  });

  test('version verdict refused: the engine\'s message', () => {
    const s = engineStatus();
    s.health.chef.status = 'version_unsupported';
    s.health.version = { status: 'unsupported', direction: 'client_too_old', detail: CLIENT_TOO_OLD };
    expect(status.describeEngineStatus(s)).toEqual({ state: 'version_refused', message: CLIENT_TOO_OLD });
  });
});

describe('controller', () => {
  function setup() {
    const views = [];
    let clock = 0;
    const controller = status.createController({ render: (view) => views.push(view), now: () => clock });
    return { controller, views, tick: (ms) => { clock += ms; } };
  }

  test('a 426 seen on a request shows the banner and stays through an ok push inside the hold', () => {
    const { controller, views, tick } = setup();
    controller.update(engineStatus());
    expect(views.at(-1).visible).toBe(false);
    controller.reportProblem(426, { code: 'DATA_API_VERSION_UNSUPPORTED', detail: CLIENT_TOO_OLD });
    expect(views.at(-1)).toEqual({ state: 'version_refused', message: CLIENT_TOO_OLD, visible: true });
    tick(status.PROBLEM_HOLD_MS - 1);
    controller.update(engineStatus());
    expect(views.at(-1).state).toBe('version_refused');
    tick(1);
    controller.update(engineStatus());
    expect(views.at(-1)).toMatchObject({ state: 'ok', visible: false });
  });

  test('a 503 shows the retrying state', () => {
    const { controller, views } = setup();
    controller.reportProblem(503, { code: 'CHEF_UNAVAILABLE' });
    expect(views.at(-1)).toMatchObject({ state: 'chef_unavailable', visible: true });
  });

  test('a non-engine error draws nothing', () => {
    const { controller, views } = setup();
    expect(controller.reportProblem(500, { error: 'x' })).toBeNull();
    expect(views).toHaveLength(0);
  });

  test('engine restarting is shown as soon as the main process says so', () => {
    const { controller, views } = setup();
    controller.update(engineStatus({ process: 'restarting', healthy: false }));
    expect(views.at(-1)).toMatchObject({ state: 'restarting', visible: true });
  });
});

describe('settingsView', () => {
  test('running engine: the badge only, no port or version rows', () => {
    const view = status.settingsView(engineStatus());
    expect(view.statusLabel).toBe('Running');
    expect(view.tone).toBe('green');
    expect(view.rows).toEqual([]);
  });

  test('not configured: not installed, no rows', () => {
    expect(status.settingsView({ configured: false })).toMatchObject({ available: false, rows: [] });
  });

  test('configured but off', () => {
    expect(status.settingsView({ configured: true, enabled: false, inUse: false, reason: 'disabled' }).statusLabel).toBe('Off');
  });

  test('shows only the controls that can be used on this computer', () => {
    expect(status.settingsView({ configured: false })).toMatchObject({ statusLabel: 'Not set up', showToggle: false, showBackgroundJobs: false, showRestart: false });
    expect(status.settingsView({ configured: true, enabled: false, inUse: false, reason: 'disabled' })).toMatchObject({ showToggle: true, showBackgroundJobs: false, showRestart: false });
    expect(status.settingsView(engineStatus())).toMatchObject({ showToggle: true, showBackgroundJobs: true, showRestart: true });
  });

  test('a LANA server on this computer is named as such, not as the organization\'s server', () => {
    // Not set up: one sentence, with no server line after it.
    expect(status.settingsView({ configured: false, apiBase: 'http://127.0.0.1:8080' }).note)
      .toBe('The local AI engine is not set up on this computer.');
    expect(status.settingsView({ configured: false, apiBase: 'https://acme.lanaai.io' }).note)
      .toBe('The local AI engine is not set up on this computer.');
    expect(status.settingsView({ configured: true, enabled: false, inUse: false, reason: 'disabled', apiBase: 'http://localhost:8080' }).note)
      .toBe('LANA\'s AI runs on the LANA server on this computer (localhost:8080). Background jobs run there too.');
  });
});

describe('settingsView when the version is refused', () => {
  test('shows the server versions from the verdict', () => {
    const s = engineStatus();
    s.health.chef = { origin: 'x', status: 'version_unsupported', reachable: true, api: null, min_client: null };
    s.health.version = { status: 'unsupported', direction: 'client_too_old', detail: CLIENT_TOO_OLD, chef: '2.0', chef_min_client: '2.0' };
    const view = status.settingsView(s);
    expect(view).toMatchObject({ statusLabel: 'Version not supported', tone: 'red', message: CLIENT_TOO_OLD });
  });
});

test('settingsView while restarting says so on the badge', () => {
  const view = status.settingsView(engineStatus({ process: 'restarting', healthy: false }));
  expect(view).toMatchObject({ statusLabel: 'Restarting', tone: 'blue' });
});

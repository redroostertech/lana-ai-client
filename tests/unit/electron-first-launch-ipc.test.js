/**
 * The first-launch screen's main-process calls (electron-first-launch-ipc.js): only models that
 * fit are saved, Continue does not wait for the downloads, status goes to every window, and the
 * development hardware override is off outside development.
 */

const { CHANNELS, registerFirstLaunchIpc, broadcastFirstLaunchStatus, devHardwareReader, plainServerState, localServerStates } = require('../../electron-first-launch-ipc');

const GB = 1024 ** 3;

function fakeIpc() {
  const handlers = {};
  return { handle: (channel, fn) => { handlers[channel] = fn; }, call: (channel, payload) => handlers[channel]({}, payload), handlers };
}

function fakeFirstLaunch() {
  const status = { phase: 'idle' };
  return {
    plan: jest.fn(async () => ({ chatChoices: [{ id: 'small', fit: 'comfortable' }, { id: 'huge', fit: 'wont_fit' }], plan: {}, download: {} })),
    choose: jest.fn(),
    accept: jest.fn(() => new Promise(() => {})), // a download that never ends
    findExisting: jest.fn(async () => [{ id: 'small', kind: 'chat', name: 'Small', bytes: 5, source: 'Pip' }]),
    start: jest.fn(() => new Promise(() => {})),
    pause: jest.fn(async () => null),
    switchChat: jest.fn(() => new Promise(() => {})), // downloads that never end
    status: () => status
  };
}

test('registers every channel', () => {
  const ipc = fakeIpc();
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch: fakeFirstLaunch() });
  for (const channel of [CHANNELS.plan, CHANNELS.findExisting, CHANNELS.choose, CHANNELS.continue, CHANNELS.pause, CHANNELS.resume, CHANNELS.status, CHANNELS.capabilities, CHANNELS.servers, CHANNELS.switchChat]) {
    expect(ipc.handlers[channel]).toEqual(expect.any(Function));
  }
});

test('choose saves a model that fits and returns the new plan', async () => {
  const ipc = fakeIpc();
  const firstLaunch = fakeFirstLaunch();
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch });
  const result = await ipc.call(CHANNELS.choose, { chatId: 'small' });
  expect(firstLaunch.choose).toHaveBeenCalledWith('small');
  expect(result.success).toBe(true);
  expect(result.plan.chatChoices).toHaveLength(2);
});

test('choose refuses a model too big for this computer, an unknown one, and a non-string', async () => {
  const ipc = fakeIpc();
  const firstLaunch = fakeFirstLaunch();
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch });
  expect((await ipc.call(CHANNELS.choose, { chatId: 'huge' })).success).toBe(false);
  expect((await ipc.call(CHANNELS.choose, { chatId: 'nope' })).success).toBe(false);
  expect((await ipc.call(CHANNELS.choose, { chatId: 42 })).success).toBe(false);
  expect(firstLaunch.choose).not.toHaveBeenCalled();
});

test('choose null goes back to LANA\'s default', async () => {
  const ipc = fakeIpc();
  const firstLaunch = fakeFirstLaunch();
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch });
  expect((await ipc.call(CHANNELS.choose, { chatId: null })).success).toBe(true);
  expect(firstLaunch.choose).toHaveBeenCalledWith(null);
});

test('Continue and resume answer at once while downloads keep going', async () => {
  const ipc = fakeIpc();
  const firstLaunch = fakeFirstLaunch();
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch });
  await expect(ipc.call(CHANNELS.continue)).resolves.toMatchObject({ success: true, status: { phase: 'idle' } });
  expect(firstLaunch.accept).toHaveBeenCalledWith({ useExisting: false });
  await ipc.call(CHANNELS.continue, { useExisting: true });
  expect(firstLaunch.accept).toHaveBeenLastCalledWith({ useExisting: true });
  await ipc.call(CHANNELS.continue, { useExisting: 'yes' });
  expect(firstLaunch.accept).toHaveBeenLastCalledWith({ useExisting: false });
  await expect(ipc.call(CHANNELS.resume)).resolves.toMatchObject({ success: true });
  expect(firstLaunch.start).toHaveBeenCalledTimes(1);
});

test('find-existing returns what was found', async () => {
  const ipc = fakeIpc();
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch: fakeFirstLaunch() });
  await expect(ipc.call(CHANNELS.findExisting)).resolves.toEqual({ success: true, found: [{ id: 'small', kind: 'chat', name: 'Small', bytes: 5, source: 'Pip' }] });
});

test('a plan that cannot be read comes back as an error, not a throw', async () => {
  const ipc = fakeIpc();
  const firstLaunch = fakeFirstLaunch();
  firstLaunch.plan.mockRejectedValueOnce(new Error('catalog broke'));
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch });
  await expect(ipc.call(CHANNELS.plan)).resolves.toEqual({ success: false, error: 'catalog broke' });
});

describe('Settings > Capabilities', () => {
  test('switch-chat saves a model that fits and answers at once while its files download', async () => {
    const ipc = fakeIpc();
    const firstLaunch = fakeFirstLaunch();
    registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch });
    await expect(ipc.call(CHANNELS.switchChat, { chatId: 'small' })).resolves.toMatchObject({ success: true, status: { phase: 'idle' }, plan: { chatChoices: expect.any(Array) } });
    expect(firstLaunch.switchChat).toHaveBeenCalledWith('small');
    await ipc.call(CHANNELS.switchChat, { chatId: null });
    expect(firstLaunch.switchChat).toHaveBeenLastCalledWith(null);
  });

  test('switch-chat refuses a model too big for this computer, an unknown one, and a non-string', async () => {
    const ipc = fakeIpc();
    const firstLaunch = fakeFirstLaunch();
    registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch });
    await expect(ipc.call(CHANNELS.switchChat, { chatId: 'huge' })).resolves.toEqual({ success: false, error: 'That chat model does not fit this computer.' });
    expect((await ipc.call(CHANNELS.switchChat, { chatId: 'nope' })).success).toBe(false);
    expect((await ipc.call(CHANNELS.switchChat, { chatId: 7 })).success).toBe(false);
    expect(firstLaunch.switchChat).not.toHaveBeenCalled();
  });

  test('capabilities returns the plan view and the server states; servers returns the states alone', async () => {
    const ipc = fakeIpc();
    const states = { pipInstalled: true, chat: 'ready', embedding: 'ready', redactor: 'not_installed', docling: 'starting' };
    registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch: fakeFirstLaunch(), servers: async () => states });
    await expect(ipc.call(CHANNELS.capabilities)).resolves.toMatchObject({ success: true, plan: { chatChoices: expect.any(Array) }, servers: states });
    await expect(ipc.call(CHANNELS.servers)).resolves.toEqual({ success: true, servers: states });
  });

  test('a kept process in plain words', () => {
    expect(plainServerState(null)).toBe('not_running');
    expect(plainServerState({ process: 'stopped' })).toBe('not_running');
    expect(plainServerState({ process: 'starting', healthy: false })).toBe('starting');
    expect(plainServerState({ process: 'restarting', healthy: false })).toBe('starting');
    expect(plainServerState({ process: 'running', healthy: true })).toBe('ready');
    expect(plainServerState({ process: 'running', healthy: false })).toBe('starting');
  });

  test('each server on this computer, with no address or path in the answer', async () => {
    const running = { process: 'running', healthy: true, url: 'http://127.0.0.1:8081', port: 8081, pid: 4 };
    const states = await localServerStates({
      pip: { getState: () => ({ installed: true, servers: { chat: running, embedding: { process: 'starting', healthy: false } } }) },
      redactor: { getState: () => ({ installed: false, server: null }) },
      docling: { getState: () => ({ installed: true, external: false, server: running }) }
    });
    expect(states).toEqual({ pipInstalled: true, chat: 'ready', embedding: 'starting', redactor: 'not_installed', docling: 'ready' });
  });

  test('a role the environment names is that server\'s: probed, never Pip\'s', async () => {
    const probe = jest.fn(async (url) => ({ state: url.endsWith('8091') ? 'running' : 'not_running' }));
    const states = await localServerStates({
      pip: { getState: () => ({ installed: false, servers: { chat: null, embedding: null } }) },
      redactor: { getState: () => ({ installed: false, server: null }) },
      docling: { getState: () => ({ installed: true, external: true, server: null }) },
      env: { LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:8091', LANA_ENGINE_EMBEDDING_URL: 'http://127.0.0.1:8092', REDACTOR_URL: 'http://127.0.0.1:9000' },
      probe
    });
    expect(states).toMatchObject({ chat: 'ready', embedding: 'not_running', redactor: 'ready', docling: 'ready' });
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

test('status goes to every open window and skips closed ones', () => {
  const open = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: jest.fn() } };
  const closed = { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: jest.fn() } };
  broadcastFirstLaunchStatus([open, closed], { phase: 'downloading' });
  expect(open.webContents.send).toHaveBeenCalledWith(CHANNELS.statusChanged, { phase: 'downloading' });
  expect(closed.webContents.send).not.toHaveBeenCalled();
});

describe('the development hardware override', () => {
  const real = () => ({ totalMemoryBytes: 24 * GB, freeDiskBytes: 60 * GB, chip: 'Real', accelerator: { backend: 'metal', vramBytes: null } });

  test('changes the computer in development', () => {
    const read = devHardwareReader({ env: { NODE_ENV: 'development', LANA_DEV_HARDWARE: '{"memoryGb":4,"backend":"cpu"}' }, isPackaged: false, read: real });
    expect(read({})).toMatchObject({ totalMemoryBytes: 4 * GB, freeDiskBytes: 60 * GB, chip: 'Real', accelerator: { backend: 'cpu' } });
  });

  test.each([
    ['outside development', { LANA_DEV_HARDWARE: '{"memoryGb":4}' }, false],
    ['in a packaged app', { NODE_ENV: 'development', LANA_DEV_HARDWARE: '{"memoryGb":4}' }, true],
    ['when unset', { NODE_ENV: 'development' }, false],
    ['when not JSON', { NODE_ENV: 'development', LANA_DEV_HARDWARE: 'four' }, false]
  ])('is off %s', (_name, env, isPackaged) => {
    expect(devHardwareReader({ env, isPackaged, read: real })).toBeNull();
  });
});

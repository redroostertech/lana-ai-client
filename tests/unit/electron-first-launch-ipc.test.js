/**
 * The first-launch screen's main-process calls (electron-first-launch-ipc.js): only models that
 * fit are saved, Continue does not wait for the downloads, status goes to every window, and the
 * development hardware override is off outside development.
 */

const { CHANNELS, registerFirstLaunchIpc, broadcastFirstLaunchStatus, devHardwareReader } = require('../../electron-first-launch-ipc');

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
    status: () => status
  };
}

test('registers every channel', () => {
  const ipc = fakeIpc();
  registerFirstLaunchIpc({ ipcMain: ipc, firstLaunch: fakeFirstLaunch() });
  for (const channel of [CHANNELS.plan, CHANNELS.findExisting, CHANNELS.choose, CHANNELS.continue, CHANNELS.pause, CHANNELS.resume, CHANNELS.status]) {
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

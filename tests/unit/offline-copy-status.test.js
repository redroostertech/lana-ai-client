/**
 * Offline copy view models and the offline banner words (phase 10).
 */
const offline = require('../../src/js/offline-copy-status');
const engineStatus = require('../../src/js/engine-status');

const READY = {
  state: 'ready', signed_in: true, as_of: '2026-11-02T15:04:00.000Z', queued: 2, lock_after_days: 14, locked: false,
  counts: { matter: 1, task: 3, note: 1, contact: 1, thread: 1 },
  conflicts: [{ op_id: 'op-1', kind: 'task.update', fields: { title: 'Mine' }, current: { title: 'Theirs' } }],
  refused: [{ op_id: 'op-2', kind: 'note.create', message: 'You no longer have permission to change this, so your offline change was not saved.' }]
};

describe('offline copy settings view', () => {
  test('ready: as of, counts, waiting changes, conflicts and refused changes in plain words', () => {
    const view = offline.settingsView(READY, 'en-US');
    expect(view).toMatchObject({ available: true, badge: 'Ready', tone: 'green' });
    expect(view.rows.find((r) => r.label === 'On this computer').value).toBe('1 matter, 3 tasks, 1 note, 1 contact, 1 chat');
    expect(view.rows.find((r) => r.label === 'Changes waiting to sync').value).toBe('2');
    expect(view.conflicts[0]).toMatchObject({ opId: 'op-1', mine: 'Mine', theirs: 'Theirs' });
    expect(view.refused[0].detail).toMatch(/no longer have permission/);
  });

  test.each([
    [{ state: 'locked', locked_message: 'locked after 14 days' }, 'Locked', 'red', /14 days/],
    [{ state: 'empty' }, 'Not synced yet', 'gray', /next time/],
    [null, 'Off', 'gray', /local AI service/]
  ])('state %j', (status, badge, tone, message) => {
    const view = offline.settingsView(status);
    expect(view.badge).toBe(badge);
    expect(view.tone).toBe(tone);
    expect(view.message).toMatch(message);
  });

  test('the answer label names the copy time', () => {
    expect(offline.asOfLabel('2026-11-02T15:04:00.000Z', 'en-US')).toMatch(/^From your offline copy as of Nov 2/);
    expect(offline.asOfLabel(null)).toBe('From your offline copy');
  });

  test('admin card says what turning it off does', () => {
    expect(offline.adminView({ enabled: false }).description).toMatch(/remove their copies/);
    expect(offline.adminView(null).enabled).toBe(true);
  });
});

describe('offline banner', () => {
  afterEach(() => { offline.lastStatus = null; });

  test('server unreachable with a ready copy: the banner says LANA answers from the copy', () => {
    offline.lastStatus = READY;
    const view = engineStatus.withOfflineCopy({ state: 'chef_unavailable', message: 'x', visible: true });
    expect(view.state).toBe('offline_copy');
    expect(view.message).toMatch(/^You're offline\. LANA answers from your offline copy as of/);
  });

  test('a locked copy says it is locked; no copy keeps the engine banner (control)', () => {
    offline.lastStatus = { state: 'locked' };
    expect(engineStatus.withOfflineCopy({ state: 'chef_unavailable', message: 'x', visible: true }).message).toMatch(/locked/);
    offline.lastStatus = null;
    expect(engineStatus.withOfflineCopy({ state: 'chef_unavailable', message: 'x', visible: true }).state).toBe('chef_unavailable');
    offline.lastStatus = READY;
    expect(engineStatus.withOfflineCopy({ state: 'ok', message: '', visible: false }).state).toBe('ok');
  });
});

describe('server gone after the engine connected', () => {
  const status = (reachableNow) => ({ inUse: true, process: 'running', healthy: true, health: { version: { status: 'ok' }, chef: { status: 'ready', reachable_now: reachableNow } } });
  test('reachable_now false is chef_unavailable; true or absent is ok (control)', () => {
    expect(engineStatus.describeEngineStatus(status(false)).state).toBe('chef_unavailable');
    expect(engineStatus.describeEngineStatus(status(true)).state).toBe('ok');
    expect(engineStatus.describeEngineStatus(status(undefined)).state).toBe('ok');
  });
});

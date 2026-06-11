/*
 * Unit tests for library/brainchild-scope.js
 *
 * The module is fully dependency injected, so we exercise it with mocked
 * bridge / mapper / api / promoteBuilder. No DOM, no real Electron bridge.
 */

'use strict';

const scope = require('../../../src/js/library/brainchild-scope.js');

function makeMapper() {
  return {
    normalizeLibraryItems: jest.fn(function (data) {
      return (data.notes || []).map(function (n) {
        return { filename: n.title, _vaultPath: n.path };
      });
    }),
  };
}

function makeApi(overrides) {
  return Object.assign({ post: jest.fn().mockResolvedValue({}), user: { id: 'u1', organizationId: 'o1' } }, overrides || {});
}

function makePromoteBuilder() {
  return {
    canPromote: jest.fn().mockReturnValue(true),
    buildPromotePayload: jest.fn().mockReturnValue({
      orgId: 'o1',
      userId: 'u1',
      body: { note_id: 'p', note_title: 't', note_content: 'c' },
    }),
  };
}

function apiError(status, message) {
  return Object.assign(new Error(message || 'err'), { status: status });
}

describe('degradedCopy', () => {
  test('maps each known reason and falls back to the connect prompt', () => {
    expect(scope.degradedCopy('install_not_found')).toMatch(/install folder/i);
    expect(scope.degradedCopy('vault_not_found')).toMatch(/vault folder/i);
    expect(scope.degradedCopy('unlinked_by_user')).toMatch(/reconnect/i);
    expect(scope.degradedCopy('unavailable')).toMatch(/unavailable/i);
    expect(scope.degradedCopy('not_linked')).toMatch(/connect brainchild/i);
  });
});

describe('promoteErrorMessage', () => {
  test('maps auth / permission / conflict statuses', () => {
    expect(scope.promoteErrorMessage(apiError(401))).toMatch(/sign in/i);
    expect(scope.promoteErrorMessage(apiError(403))).toMatch(/permission/i);
    expect(scope.promoteErrorMessage(apiError(409))).toMatch(/already promoted/i);
    expect(scope.promoteErrorMessage(apiError(0, 'boom'))).toBe('boom');
  });
});

describe('load (status driven)', () => {
  test('connected: fetches and normalizes notes', async () => {
    const bridge = {
      status: jest.fn().mockResolvedValue({ status: 'linked', source: 'auto', vaultPath: '/v' }),
      listNotes: jest.fn().mockResolvedValue({ success: true, notes: [{ title: 'A', path: '/v/a.md' }] }),
    };
    const mapper = makeMapper();
    const s = scope.create({ bridge: bridge, mapper: mapper, api: makeApi(), promoteBuilder: makePromoteBuilder() });

    const rows = await s.load();

    expect(bridge.status).toHaveBeenCalled();
    expect(bridge.listNotes).toHaveBeenCalled();
    expect(s.isConnected()).toBe(true);
    expect(rows).toEqual([{ filename: 'A', _vaultPath: '/v/a.md' }]);
  });

  test('degraded: does not fetch notes and yields an empty row set', async () => {
    const bridge = {
      status: jest.fn().mockResolvedValue({ status: 'degraded', reason: 'unlinked_by_user' }),
      listNotes: jest.fn(),
    };
    const s = scope.create({ bridge: bridge, mapper: makeMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    const rows = await s.load();

    expect(bridge.listNotes).not.toHaveBeenCalled();
    expect(s.isConnected()).toBe(false);
    expect(rows).toEqual([]);
  });
});

describe('connect', () => {
  test('auto-discovery success links with the discovered paths', async () => {
    const bridge = {
      discover: jest.fn().mockResolvedValue({ installPath: '/i', vaultPath: '/v' }),
      link: jest.fn().mockResolvedValue({ success: true, status: 'linked' }),
      status: jest.fn().mockResolvedValue({ status: 'linked' }),
      listNotes: jest.fn().mockResolvedValue({ success: true, notes: [] }),
    };
    const s = scope.create({ bridge: bridge, mapper: makeMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    await s.connect();

    expect(bridge.discover).toHaveBeenCalled();
    expect(bridge.link).toHaveBeenCalledWith({ installPath: '/i', vaultPath: '/v' });
  });

  test('discovery miss falls back to the folder pickers', async () => {
    const bridge = {
      discover: jest.fn().mockResolvedValue({}),
      pickInstall: jest.fn().mockResolvedValue({ success: true, installPath: '/pi' }),
      pickVault: jest.fn().mockResolvedValue({ success: true, vaultPath: '/pv' }),
      link: jest.fn().mockResolvedValue({ success: true }),
      status: jest.fn().mockResolvedValue({ status: 'linked' }),
      listNotes: jest.fn().mockResolvedValue({ success: true, notes: [] }),
    };
    const s = scope.create({ bridge: bridge, mapper: makeMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    await s.connect();

    expect(bridge.pickInstall).toHaveBeenCalled();
    expect(bridge.pickVault).toHaveBeenCalled();
    expect(bridge.link).toHaveBeenCalledWith({ installPath: '/pi', vaultPath: '/pv' });
  });
});

describe('unlink', () => {
  test('calls the bridge and degrades to unlinked_by_user', async () => {
    const bridge = { unlink: jest.fn().mockResolvedValue({ success: true, status: 'degraded' }) };
    const s = scope.create({ bridge: bridge, mapper: makeMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    await s.unlink();

    expect(bridge.unlink).toHaveBeenCalled();
    expect(s.state.status).toEqual({ status: 'degraded', reason: 'unlinked_by_user' });
    expect(s.isConnected()).toBe(false);
  });
});

describe('promote', () => {
  const row = { filename: 'A', _vaultPath: '/v/a.md' };
  const note = { body: 'c' };

  test('success: posts the built payload to the org endpoint and reports success', async () => {
    const api = makeApi();
    const toasts = [];
    const s = scope.create({
      bridge: {},
      mapper: makeMapper(),
      api: api,
      promoteBuilder: makePromoteBuilder(),
      currentUser: function () { return { id: 'u1', organizationId: 'o1' }; },
      onToast: function (kind, msg) { toasts.push([kind, msg]); },
    });

    const result = await s.promote(row, note);

    expect(api.post).toHaveBeenCalledWith('/api/v1/organizations/o1/promoted-knowledge', { note_id: 'p', note_title: 't', note_content: 'c' });
    expect(result).toEqual({ success: true });
    expect(toasts.some(function (t) { return t[0] === 'success'; })).toBe(true);
  });

  test('409 conflict surfaces the already-promoted copy', async () => {
    const api = makeApi({ post: jest.fn().mockRejectedValue(apiError(409)) });
    const toasts = [];
    const s = scope.create({
      bridge: {},
      mapper: makeMapper(),
      api: api,
      promoteBuilder: makePromoteBuilder(),
      currentUser: function () { return { id: 'u1', organizationId: 'o1' }; },
      onToast: function (kind, msg) { toasts.push([kind, msg]); },
    });

    const result = await s.promote(row, note);

    expect(result.success).toBe(false);
    expect(toasts.some(function (t) { return t[0] === 'error' && /already promoted/i.test(t[1]); })).toBe(true);
  });

  test('no authenticated user: does not POST', async () => {
    const api = makeApi();
    const s = scope.create({
      bridge: {},
      mapper: makeMapper(),
      api: api,
      promoteBuilder: makePromoteBuilder(),
      currentUser: function () { return null; },
    });

    const result = await s.promote(row, note);

    expect(api.post).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  test('guards against a concurrent promote', async () => {
    const api = makeApi();
    const s = scope.create({
      bridge: {},
      mapper: makeMapper(),
      api: api,
      promoteBuilder: makePromoteBuilder(),
      currentUser: function () { return { id: 'u1', organizationId: 'o1' }; },
    });
    s.state.promoteInProgress = true;

    const result = await s.promote(row, note);

    expect(api.post).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, reason: 'in_progress' });
  });
});

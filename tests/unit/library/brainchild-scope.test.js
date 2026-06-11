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

describe('folderView (pure helper)', () => {
  function r(path, name) {
    return { _vaultPath: path, filename: name || path.split('/').pop() };
  }

  test('root level: distinct child folders plus root notes', () => {
    const rows = [
      r('readme.md', 'readme.md'),
      r('Forms/intake.md', 'intake.md'),
      r('Forms/release.md', 'release.md'),
      r('Introduction/welcome.md', 'welcome.md'),
      r('todo.md', 'todo.md'),
    ];

    const view = scope.folderView(rows, '');

    expect(view.folders.map(function (f) { return f.name; })).toEqual(['Forms', 'Introduction']);
    expect(view.folders[0]).toEqual({ name: 'Forms', path: 'Forms', count: 2 });
    expect(view.folders[1]).toEqual({ name: 'Introduction', path: 'Introduction', count: 1 });
    // Root notes only (not the ones inside folders), sorted by filename.
    expect(view.notes.map(function (n) { return n.filename; })).toEqual(['readme.md', 'todo.md']);
  });

  test('drilling into a folder shows that folder\'s direct notes', () => {
    const rows = [
      r('readme.md', 'readme.md'),
      r('Forms/intake.md', 'intake.md'),
      r('Forms/release.md', 'release.md'),
    ];

    const view = scope.folderView(rows, 'Forms');

    expect(view.folders).toEqual([]);
    expect(view.notes.map(function (n) { return n.filename; })).toEqual(['intake.md', 'release.md']);
  });

  test('nested subfolders surface as immediate children with rollup counts', () => {
    const rows = [
      r('Forms/intake.md', 'intake.md'),
      r('Forms/Archived/2024/old.md', 'old.md'),
      r('Forms/Archived/2025/new.md', 'new.md'),
      r('Forms/Templates/blank.md', 'blank.md'),
    ];

    const view = scope.folderView(rows, 'Forms');

    // Immediate children of Forms: Archived (rolls up 2) and Templates (1).
    expect(view.folders.map(function (f) { return f.name; })).toEqual(['Archived', 'Templates']);
    const archived = view.folders.find(function (f) { return f.name === 'Archived'; });
    expect(archived).toEqual({ name: 'Archived', path: 'Forms/Archived', count: 2 });
    const templates = view.folders.find(function (f) { return f.name === 'Templates'; });
    expect(templates).toEqual({ name: 'Templates', path: 'Forms/Templates', count: 1 });
    // Only the direct note in Forms remains.
    expect(view.notes.map(function (n) { return n.filename; })).toEqual(['intake.md']);
  });

  test('count rolls up all notes anywhere beneath a child folder', () => {
    const rows = [
      r('Projects/a/1.md', '1.md'),
      r('Projects/a/2.md', '2.md'),
      r('Projects/b/deep/3.md', '3.md'),
    ];

    const view = scope.folderView(rows, '');

    expect(view.folders).toEqual([{ name: 'Projects', path: 'Projects', count: 3 }]);
    expect(view.notes).toEqual([]);
  });

  test('folders sort case-insensitively and notes sort by filename', () => {
    const rows = [
      r('zebra/z.md', 'z.md'),
      r('Apple/a.md', 'a.md'),
      r('banana/b.md', 'b.md'),
      r('Yak.md', 'Yak.md'),
      r('apex.md', 'apex.md'),
    ];

    const view = scope.folderView(rows, '');

    expect(view.folders.map(function (f) { return f.name; })).toEqual(['Apple', 'banana', 'zebra']);
    expect(view.notes.map(function (n) { return n.filename; })).toEqual(['apex.md', 'Yak.md']);
  });

  test('dotfolders and dotfiles are excluded at every level', () => {
    const rows = [
      r('.obsidian/config.md', 'config.md'),
      r('.hidden.md', '.hidden.md'),
      r('Forms/.trash/old.md', 'old.md'),
      r('Forms/intake.md', 'intake.md'),
      r('visible.md', 'visible.md'),
    ];

    const rootView = scope.folderView(rows, '');
    expect(rootView.folders.map(function (f) { return f.name; })).toEqual(['Forms']);
    expect(rootView.notes.map(function (n) { return n.filename; })).toEqual(['visible.md']);

    const formsView = scope.folderView(rows, 'Forms');
    // .trash dotfolder is excluded, leaving only the direct intake note.
    expect(formsView.folders).toEqual([]);
    expect(formsView.notes.map(function (n) { return n.filename; })).toEqual(['intake.md']);
  });

  test('tolerates empty and missing inputs', () => {
    expect(scope.folderView([], '')).toEqual({ folders: [], notes: [] });
    expect(scope.folderView(undefined, '')).toEqual({ folders: [], notes: [] });
  });
});

describe('folder navigation state (controller)', () => {
  function makeNoteBridge(notes) {
    return {
      status: jest.fn().mockResolvedValue({ status: 'linked', source: 'auto', vaultPath: '/v' }),
      listNotes: jest.fn().mockResolvedValue({ success: true, notes: notes }),
    };
  }

  function pathMapper() {
    return {
      normalizeLibraryItems: jest.fn(function (data) {
        return (data.notes || []).map(function (n) {
          return { filename: n.title, _vaultPath: n.path };
        });
      }),
    };
  }

  test('defaults currentFolder to root and exposes a no-arg folderView()', async () => {
    const bridge = makeNoteBridge([
      { title: 'intake.md', path: 'Forms/intake.md' },
      { title: 'readme.md', path: 'readme.md' },
    ]);
    const s = scope.create({ bridge: bridge, mapper: pathMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    await s.load();

    expect(s.state.currentFolder).toBe('');
    const view = s.folderView();
    expect(view.folders.map(function (f) { return f.name; })).toEqual(['Forms']);
    expect(view.notes.map(function (n) { return n.filename; })).toEqual(['readme.md']);
  });

  test('enterFolder appends to currentFolder and notifies onChange', async () => {
    const bridge = makeNoteBridge([{ title: 'intake.md', path: 'Forms/intake.md' }]);
    const changes = [];
    const s = scope.create({
      bridge: bridge,
      mapper: pathMapper(),
      api: makeApi(),
      promoteBuilder: makePromoteBuilder(),
      onChange: function () { changes.push(true); },
    });

    await s.load();
    const before = changes.length;
    s.enterFolder('Forms');
    expect(s.state.currentFolder).toBe('Forms');
    s.enterFolder('Archived');
    expect(s.state.currentFolder).toBe('Forms/Archived');
    expect(changes.length).toBe(before + 2);
  });

  test('goToFolder sets an absolute path; empty string returns to root', () => {
    const s = scope.create({ bridge: {}, mapper: pathMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    s.goToFolder('Forms/Archived');
    expect(s.state.currentFolder).toBe('Forms/Archived');
    s.goToFolder('');
    expect(s.state.currentFolder).toBe('');
  });

  test('load() resets currentFolder back to root', async () => {
    const bridge = makeNoteBridge([{ title: 'readme.md', path: 'readme.md' }]);
    const s = scope.create({ bridge: bridge, mapper: pathMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    s.goToFolder('Forms');
    expect(s.state.currentFolder).toBe('Forms');
    await s.load();
    expect(s.state.currentFolder).toBe('');
  });

  test('unlink() resets currentFolder back to root', async () => {
    const bridge = { unlink: jest.fn().mockResolvedValue({ success: true }) };
    const s = scope.create({ bridge: bridge, mapper: pathMapper(), api: makeApi(), promoteBuilder: makePromoteBuilder() });

    s.goToFolder('Forms/Archived');
    await s.unlink();
    expect(s.state.currentFolder).toBe('');
  });
});

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

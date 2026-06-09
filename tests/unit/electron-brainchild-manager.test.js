const path = require('path');

const {
  installRootCandidates,
  mcpBinForRoot,
  vaultCandidates,
  degradedReason,
  isAllowedInstallRoot,
  validateLink,
  validateLinkFs
} = require(path.join(__dirname, '../../src/electron-brainchild-manager.js'));

const HOME = '/Users/tester';

describe('electron-brainchild-manager (pure path/discovery helpers)', () => {
  describe('mcpBinForRoot', () => {
    test('appends bin/brainchild-mcp.js to the install root', () => {
      expect(mcpBinForRoot('/opt/brainchild')).toBe(path.join('/opt/brainchild', 'bin', 'brainchild-mcp.js'));
    });
  });

  describe('installRootCandidates', () => {
    test('BRAINCHILD_HOME override is first', () => {
      const out = installRootCandidates({ BRAINCHILD_HOME: '/custom/brain' }, 'darwin', HOME);
      expect(out[0]).toBe('/custom/brain');
    });

    test('always includes the dev checkout sibling (../brainchild)', () => {
      const out = installRootCandidates({}, 'darwin', HOME);
      const expectedSibling = path.resolve(__dirname, '../../..', 'brainchild');
      expect(out).toContain(expectedSibling);
    });

    test('macOS includes the /Applications app bundle resources', () => {
      const out = installRootCandidates({}, 'darwin', HOME);
      expect(out).toContain('/Applications/Brainchild.app/Contents/Resources');
    });

    test('windows uses ProgramFiles + LOCALAPPDATA', () => {
      const out = installRootCandidates(
        { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' },
        'win32',
        'C:\\Users\\t'
      );
      expect(out).toContain(path.join('C:\\Program Files', 'Brainchild'));
      expect(out).toContain(path.join('C:\\Users\\t\\AppData\\Local', 'Brainchild'));
    });

    test('linux includes /opt/brainchild', () => {
      const out = installRootCandidates({}, 'linux', HOME);
      expect(out).toContain('/opt/brainchild');
    });
  });

  describe('vaultCandidates', () => {
    test('LANA_BRAIN_VAULT override is first', () => {
      const out = vaultCandidates({ LANA_BRAIN_VAULT: '/my/vault' }, 'darwin', HOME);
      expect(out[0]).toBe('/my/vault');
    });

    test('macOS dev default is ~/Library/Application Support/Electron/vault', () => {
      const out = vaultCandidates({}, 'darwin', HOME);
      expect(out).toContain(path.join(HOME, 'Library', 'Application Support', 'Electron', 'vault'));
    });

    test('linux default lives under ~/.config', () => {
      const out = vaultCandidates({}, 'linux', HOME);
      expect(out).toContain(path.join(HOME, '.config', 'Electron', 'vault'));
    });

    test('windows default uses APPDATA', () => {
      const out = vaultCandidates({ APPDATA: 'C:\\Users\\t\\AppData\\Roaming' }, 'win32', 'C:\\Users\\t');
      expect(out).toContain(path.join('C:\\Users\\t\\AppData\\Roaming', 'Electron', 'vault'));
    });
  });

  describe('isAllowedInstallRoot', () => {
    const opts = { env: {}, platform: 'darwin', homedir: HOME };

    test('rejects empty / non-string paths', () => {
      expect(isAllowedInstallRoot('', opts)).toBe(false);
      expect(isAllowedInstallRoot(null, opts)).toBe(false);
      expect(isAllowedInstallRoot(undefined, opts)).toBe(false);
    });

    test('accepts a path that is one of the OS-default candidate roots', () => {
      const candidate = '/Applications/Brainchild.app/Contents/Resources';
      expect(isAllowedInstallRoot(candidate, opts)).toBe(true);
    });

    test('rejects an arbitrary renderer-supplied path outside the candidate set', () => {
      expect(isAllowedInstallRoot('/tmp/evil/install', opts)).toBe(false);
      expect(isAllowedInstallRoot('/Users/tester/Downloads/payload', opts)).toBe(false);
    });

    test('honors the BRAINCHILD_HOME override (it is a candidate root)', () => {
      const withHome = { env: { BRAINCHILD_HOME: '/custom/brain' }, platform: 'darwin', homedir: HOME };
      expect(isAllowedInstallRoot('/custom/brain', withHome)).toBe(true);
    });
  });

  describe('validateLink vs validateLinkFs (allowlist boundary)', () => {
    // Real on-disk install: the dev sibling checkout (has bin/brainchild-mcp.js
    // and is on the allowlist) vs the same bin reached via a non-allowlisted
    // path alias. The IPC-boundary validateLink folds in the allowlist; the
    // persisted-link validateLinkFs is filesystem-only.
    const INSTALL = path.resolve(__dirname, '../../..', 'brainchild');

    test('validateLink accepts an allowlisted, on-disk install', () => {
      const checks = validateLink({ installPath: INSTALL, vaultPath: __dirname });
      expect(checks.installAllowed).toBe(true);
      expect(checks.installValid).toBe(true);
    });

    test('validateLink rejects an on-disk install that is NOT on the allowlist', () => {
      // /tmp is readable and could host a bin/brainchild-mcp.js, but it is not a
      // candidate root — validateLink must mark it not-allowed and not-valid.
      const checks = validateLink({ installPath: '/tmp/rogue-brainchild', vaultPath: __dirname });
      expect(checks.installAllowed).toBe(false);
      expect(checks.installValid).toBe(false);
    });

    test('validateLinkFs ignores the allowlist (filesystem only)', () => {
      const checks = validateLinkFs({ installPath: INSTALL, vaultPath: __dirname });
      expect(checks.installValid).toBe(true);
      expect(checks).not.toHaveProperty('installAllowed');
    });
  });

  describe('degradedReason', () => {
    test('install missing wins over vault', () => {
      expect(degradedReason({ installValid: false, vaultValid: false })).toBe('install_not_found');
      expect(degradedReason({ installValid: false, vaultValid: true })).toBe('install_not_found');
    });

    test('vault missing reported when install is valid', () => {
      expect(degradedReason({ installValid: true, vaultValid: false })).toBe('vault_not_found');
    });

    test('null when both valid', () => {
      expect(degradedReason({ installValid: true, vaultValid: true })).toBeNull();
    });

    test('null/undefined checks treated as install missing', () => {
      expect(degradedReason(null)).toBe('install_not_found');
    });
  });
});

describe('BrainchildManager lifecycle (injected spawn)', () => {
  const { BrainchildManager } = require(path.join(__dirname, '../../src/electron-brainchild-manager.js'));
  const { EventEmitter } = require('events');

  function fakeChild() {
    const child = new EventEmitter();
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    const stdin = new EventEmitter();
    stdin.writable = true;
    stdin.write = jest.fn(() => true);
    child.stdin = stdin;
    child.kill = jest.fn(() => { child.killed = true; });
    return child;
  }

  test('getStatus reports not_linked when no link is persisted', () => {
    const mgr = new BrainchildManager({ getLink: () => null });
    expect(mgr.getStatus()).toEqual({ status: 'degraded', reason: 'not_linked' });
  });

  test('getStatus reports degraded when linked paths do not exist on disk', () => {
    const mgr = new BrainchildManager({
      getLink: () => ({ installPath: '/nope/install', vaultPath: '/nope/vault' })
    });
    const status = mgr.getStatus();
    expect(status.status).toBe('degraded');
    expect(status.reason).toBe('install_not_found');
  });

  test('call rejects unsupported (write) tools without spawning', async () => {
    const spawnFn = jest.fn();
    const mgr = new BrainchildManager({
      getLink: () => ({ installPath: '/x', vaultPath: '/y' }),
      spawnFn
    });
    await expect(mgr.call('save_note', {})).rejects.toThrow('Unsupported brainchild tool');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test('stop() is safe to call with no active child', () => {
    const mgr = new BrainchildManager({ getLink: () => null });
    expect(() => mgr.stop()).not.toThrow();
  });

  test('stop() kills the child and disposes the client', () => {
    const child = fakeChild();
    const mgr = new BrainchildManager({ getLink: () => null, spawnFn: () => child });
    // Inject internals to simulate a started state.
    mgr._child = child;
    mgr._client = { dispose: jest.fn() };
    mgr.stop();
    expect(child.kill).toHaveBeenCalled();
    expect(mgr._child).toBeNull();
    expect(mgr._client).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// End-to-end-ish: a fake JSON-RPC child driven through spawn → initialize →
// tools/call → unwrap. Proves list_notes actually flows through the manager and
// StdioMcpClient, not just the pure framing helpers in isolation. Uses the dev
// sibling install root (../brainchild) so validateLink passes on disk.
// ───────────────────────────────────────────────────────────────────────────
describe('BrainchildManager JSON-RPC round-trip (fake child)', () => {
  const { BrainchildManager } = require(path.join(__dirname, '../../src/electron-brainchild-manager.js'));
  const { EventEmitter } = require('events');

  // Install root = dev sibling checkout (has bin/brainchild-mcp.js + is on the
  // allowlist). Vault = this test directory (a real readable dir).
  const INSTALL = path.resolve(__dirname, '../../..', 'brainchild');
  const VAULT = __dirname;
  const LINK = { installPath: INSTALL, vaultPath: VAULT };

  // A fake MCP child that speaks newline-delimited JSON-RPC: it echoes a result
  // for `initialize` and returns a canned `tools/call` payload. `toolResult`
  // lets each test control what list_notes/etc. resolves to.
  function fakeRpcChild(toolResult) {
    const child = new EventEmitter();
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    const stdin = new EventEmitter();
    stdin.writable = true;
    stdin.write = (frame) => {
      // Parse the request the client just wrote and reply asynchronously.
      let msg;
      try { msg = JSON.parse(String(frame).trim()); } catch { return true; }
      if (!Object.prototype.hasOwnProperty.call(msg, 'id')) return true; // notification
      let result;
      if (msg.method === 'initialize') {
        result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake' } };
      } else if (msg.method === 'tools/call') {
        result = {
          content: [{ type: 'text', text: JSON.stringify(toolResult) }],
          structuredContent: toolResult
        };
      } else {
        result = {};
      }
      setImmediate(() => {
        child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
      });
      return true;
    };
    child.stdin = stdin;
    child.kill = jest.fn(() => { child.killed = true; });
    return child;
  }

  test('call("list_notes") spawns, initializes, and resolves the unwrapped payload', async () => {
    const payload = { notes: [{ path: 'A.md', title: 'A' }, { path: 'B.md', title: 'B' }], count: 2 };
    const child = fakeRpcChild(payload);
    const spawnFn = jest.fn(() => child);
    const mgr = new BrainchildManager({ getLink: () => LINK, spawnFn });

    const out = await mgr.call('list_notes', {});
    expect(out).toEqual(payload);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // Spawn must run Node against the install's bin with --vault and --no-seed
    // (read-only contract — never seed the user's vault).
    const args = spawnFn.mock.calls[0][1];
    expect(args).toContain('--vault');
    expect(args).toContain(VAULT);
    expect(args).toContain('--no-seed');
    const opts = spawnFn.mock.calls[0][2];
    expect(opts.env.BRAINCHILD_MCP_NO_SEED).toBe('1');

    mgr.stop();
  });

  test('concurrent _ensureClient calls share a single spawn', async () => {
    const child = fakeRpcChild({ notes: [], count: 0 });
    const spawnFn = jest.fn(() => child);
    const mgr = new BrainchildManager({ getLink: () => LINK, spawnFn });

    const [a, b] = await Promise.all([mgr.call('list_notes', {}), mgr.call('search', { query: 'x' })]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    mgr.stop();
  });

  test('a re-link to a new vault mid-flight tears down and respawns', async () => {
    const childA = fakeRpcChild({ notes: [{ path: 'A.md' }], count: 1 });
    const childB = fakeRpcChild({ notes: [{ path: 'B.md' }], count: 1 });
    const children = [childA, childB];
    const spawnFn = jest.fn(() => children.shift());

    let vault = VAULT;
    const mgr = new BrainchildManager({
      getLink: () => ({ installPath: INSTALL, vaultPath: vault }),
      spawnFn
    });

    // First call binds vault A.
    await mgr.call('list_notes', {});
    expect(mgr._activeVaultPath).toBe(VAULT);

    // Re-link to a different (still valid) vault path: the install root's own
    // bin dir is a real readable directory, so validateLink passes.
    vault = path.join(INSTALL, 'bin');
    await mgr.call('list_notes', {});

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(childA.kill).toHaveBeenCalled(); // old child torn down on vault change
    expect(mgr._activeVaultPath).toBe(vault);
    mgr.stop();
  });

  test('the exit handler clears _child/_client so the next call respawns', async () => {
    const childA = fakeRpcChild({ notes: [], count: 0 });
    const childB = fakeRpcChild({ notes: [], count: 0 });
    const children = [childA, childB];
    const spawnFn = jest.fn(() => children.shift());
    const mgr = new BrainchildManager({ getLink: () => LINK, spawnFn });

    await mgr.call('list_notes', {});
    expect(mgr._child).toBe(childA);

    // Simulate the child crashing/exiting.
    childA.emit('exit', 1, null);
    expect(mgr._child).toBeNull();
    expect(mgr._client).toBeNull();
    expect(mgr._activeVaultPath).toBeNull();

    // Next call must respawn a fresh child.
    await mgr.call('list_notes', {});
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(mgr._child).toBe(childB);
    mgr.stop();
  });

  test('a spawn error rejects the call without leaving a live client', async () => {
    const child = new EventEmitter();
    child.killed = false;
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    const stdin = new EventEmitter();
    stdin.writable = true;
    stdin.write = jest.fn(() => true);
    child.stdin = stdin;
    child.kill = jest.fn(() => { child.killed = true; });
    const spawnFn = jest.fn(() => {
      setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    });
    const mgr = new BrainchildManager({ getLink: () => LINK, spawnFn });

    await expect(mgr.call('list_notes', {})).rejects.toThrow('spawn ENOENT');
  });
});

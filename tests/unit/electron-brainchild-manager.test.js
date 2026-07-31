const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  installRootCandidates,
  mcpBinForRoot,
  vaultCandidates,
  lanaVaultLinkPath,
  readVaultLink,
  degradedReason,
  isAllowedInstallRoot,
  isAllowedVaultRoot,
  validateLink,
  validateLinkFs,
  discover
} = require(path.join(__dirname, '../../src/electron-brainchild-manager.js'));

const HOME = '/Users/tester';
const ORIGINAL_BRAINCHILD_HOME = process.env.BRAINCHILD_HOME;
const TEST_INSTALL = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-brainchild-install-'));
fs.mkdirSync(path.join(TEST_INSTALL, 'bin'), { recursive: true });
fs.writeFileSync(path.join(TEST_INSTALL, 'bin', 'brainchild-mcp.js'), '#!/usr/bin/env node\n');
process.env.BRAINCHILD_HOME = TEST_INSTALL;

afterAll(() => {
  if (ORIGINAL_BRAINCHILD_HOME === undefined) {
    delete process.env.BRAINCHILD_HOME;
  } else {
    process.env.BRAINCHILD_HOME = ORIGINAL_BRAINCHILD_HOME;
  }
});

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

  describe('lanaVaultLinkPath', () => {
    test('macOS uses Application Support/lana-brain', () => {
      expect(lanaVaultLinkPath({}, 'darwin', HOME)).toBe(
        path.join(HOME, 'Library', 'Application Support', 'lana-brain', 'vault-link.json')
      );
    });

    test('linux uses ~/.config/lana-brain', () => {
      expect(lanaVaultLinkPath({}, 'linux', HOME)).toBe(
        path.join(HOME, '.config', 'lana-brain', 'vault-link.json')
      );
    });

    test('windows uses APPDATA/lana-brain', () => {
      expect(lanaVaultLinkPath({ APPDATA: 'C:\\Users\\t\\AppData\\Roaming' }, 'win32', 'C:\\Users\\t')).toBe(
        path.join('C:\\Users\\t\\AppData\\Roaming', 'lana-brain', 'vault-link.json')
      );
    });
  });

  describe('readVaultLink', () => {
    const fsWith = (raw) => ({ readFileSync: () => raw });

    test('parses a valid handshake', () => {
      const raw = JSON.stringify({
        app: 'lana-brain',
        vaultPath: '/data/brainchild/vault',
        installRoot: '/data/brainchild',
        mcpBin: '/data/brainchild/bin/brainchild-mcp.js'
      });
      expect(readVaultLink('/p', fsWith(raw))).toEqual({
        vaultPath: '/data/brainchild/vault',
        installRoot: '/data/brainchild',
        mcpBin: '/data/brainchild/bin/brainchild-mcp.js'
      });
    });

    test('null installRoot/mcpBin are normalized to null', () => {
      const raw = JSON.stringify({ vaultPath: '/v', installRoot: null, mcpBin: null });
      expect(readVaultLink('/p', fsWith(raw))).toEqual({ vaultPath: '/v', installRoot: null, mcpBin: null });
    });

    test('returns null on a missing file', () => {
      const fsLike = { readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } };
      expect(readVaultLink('/p', fsLike)).toBeNull();
    });

    test('returns null on malformed JSON', () => {
      expect(readVaultLink('/p', fsWith('{ not json'))).toBeNull();
    });

    test('returns null when vaultPath is absent', () => {
      expect(readVaultLink('/p', fsWith(JSON.stringify({ app: 'lana-brain' })))).toBeNull();
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

  describe('isAllowedVaultRoot', () => {
    const opts = { env: {}, platform: 'darwin', homedir: HOME };

    test('rejects empty / non-string paths', () => {
      expect(isAllowedVaultRoot('', opts)).toBe(false);
      expect(isAllowedVaultRoot(null, opts)).toBe(false);
      expect(isAllowedVaultRoot(undefined, opts)).toBe(false);
    });

    test('accepts a path that is one of the OS-default vault candidates', () => {
      const candidate = path.join(HOME, 'Library', 'Application Support', 'Brainchild', 'vault');
      expect(isAllowedVaultRoot(candidate, opts)).toBe(true);
    });

    test('rejects an arbitrary renderer-supplied path outside the candidate set', () => {
      expect(isAllowedVaultRoot('/Users/tester/.ssh', opts)).toBe(false);
      expect(isAllowedVaultRoot('/Users/tester/.aws', opts)).toBe(false);
      expect(isAllowedVaultRoot('/Users/tester/Documents', opts)).toBe(false);
    });

    test('honors the LANA_BRAIN_VAULT override (it is a candidate root)', () => {
      const withEnv = { env: { LANA_BRAIN_VAULT: '/my/vault' }, platform: 'darwin', homedir: HOME };
      expect(isAllowedVaultRoot('/my/vault', withEnv)).toBe(true);
    });
  });

  describe('validateLink vs validateLinkFs (allowlist boundary)', () => {
    // Real on-disk install: the dev sibling checkout (has bin/brainchild-mcp.js
    // and is on the allowlist) vs the same bin reached via a non-allowlisted
    // path alias. The IPC-boundary validateLink folds in the allowlist; the
    // persisted-link validateLinkFs is filesystem-only.
    const INSTALL = TEST_INSTALL;

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

describe('discover (handshake-first resolution)', () => {
  const HANDSHAKE = path.join(HOME, 'Library', 'Application Support', 'lana-brain', 'vault-link.json');
  const HANDSHAKE_VAULT = '/data/brainchild/vault';
  const HANDSHAKE_ROOT = '/data/brainchild';
  const HANDSHAKE_BIN = path.join(HANDSHAKE_ROOT, 'bin', 'brainchild-mcp.js');

  // Configure the mocked fs from a set of paths that should "exist". Dirs in
  // `readableDirs` pass dirReadable; files in `existingFiles` pass fileExists;
  // `linkContents` (keyed by handshake path) is returned by readFileSync.
  function mockFs({ readableDirs = [], existingFiles = [], linkContents = {} } = {}) {
    const dirs = new Set(readableDirs);
    const files = new Set(existingFiles);
    jest.spyOn(fs, 'existsSync').mockImplementation((p) => dirs.has(p) || files.has(p) || (p in linkContents));
    jest.spyOn(fs, 'statSync').mockImplementation((p) => ({
      isDirectory: () => dirs.has(p),
      isFile: () => files.has(p)
    }));
    jest.spyOn(fs, 'accessSync').mockImplementation((p) => {
      if (!dirs.has(p)) throw new Error('EACCES');
    });
    jest.spyOn(fs, 'readFileSync').mockImplementation((p) => {
      if (p in linkContents) return linkContents[p];
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  }

  afterEach(() => jest.restoreAllMocks());

  const opts = { env: {}, platform: 'darwin', homedir: HOME };

  test('prefers a valid handshake vaultPath/mcpBin over candidate guesses', () => {
    mockFs({
      readableDirs: [HANDSHAKE_VAULT],
      existingFiles: [HANDSHAKE_BIN],
      linkContents: {
        [HANDSHAKE]: JSON.stringify({
          vaultPath: HANDSHAKE_VAULT,
          installRoot: HANDSHAKE_ROOT,
          mcpBin: HANDSHAKE_BIN
        })
      }
    });
    const out = discover(opts);
    expect(out.vaultPath).toBe(HANDSHAKE_VAULT);
    expect(out.installPath).toBe(HANDSHAKE_ROOT);
    expect(out.mcpBin).toBe(HANDSHAKE_BIN);
  });

  test('falls back to candidate guessing when the handshake is absent', () => {
    const candidateVault = path.join(HOME, 'Library', 'Application Support', 'Electron', 'vault');
    mockFs({ readableDirs: [candidateVault] });
    const out = discover(opts);
    expect(out.vaultPath).toBe(candidateVault);
  });

  test('falls back when the handshake vaultPath is unreadable', () => {
    const candidateVault = path.join(HOME, 'Library', 'Application Support', 'Brainchild', 'vault');
    mockFs({
      readableDirs: [candidateVault], // handshake vault NOT readable
      linkContents: {
        [HANDSHAKE]: JSON.stringify({ vaultPath: HANDSHAKE_VAULT, installRoot: null, mcpBin: null })
      }
    });
    const out = discover(opts);
    expect(out.vaultPath).toBe(candidateVault);
  });

  test('env override wins over the handshake', () => {
    const override = '/env/override/vault';
    mockFs({
      readableDirs: [override, HANDSHAKE_VAULT],
      linkContents: {
        [HANDSHAKE]: JSON.stringify({ vaultPath: HANDSHAKE_VAULT, installRoot: null, mcpBin: null })
      }
    });
    const out = discover({ env: { LANA_BRAIN_VAULT: override }, platform: 'darwin', homedir: HOME });
    expect(out.vaultPath).toBe(override);
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
    // Inject discovery so this stays isolated from the real filesystem (a real
    // brainchild install/vault on the dev machine would otherwise auto-bind).
    const mgr = new BrainchildManager({
      getLink: () => null,
      discoverFn: () => ({ installPath: null, vaultPath: null, mcpBin: null }),
      isAutoBindDisabled: () => false
    });
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
// Auto-bind resolution: _resolveLink priority, status() source/reason codes,
// and _ensureClient suppression. All deps injected (getLink, discoverFn,
// isAutoBindDisabled, spawnFn) so no real filesystem or process is touched.
// validateLinkFs on the resolved link is satisfied by pointing installPath at
// the dev sibling checkout (has bin/brainchild-mcp.js) and vaultPath at a real
// readable dir; that is the only on-disk dependency and it mirrors the existing
// JSON-RPC round-trip tests below.
// ───────────────────────────────────────────────────────────────────────────
describe('BrainchildManager auto-bind (_resolveLink / status / _ensureClient)', () => {
  const { BrainchildManager } = require(path.join(__dirname, '../../src/electron-brainchild-manager.js'));

  // Real on-disk install + vault so validateLinkFs passes for resolved links.
  const INSTALL = TEST_INSTALL;
  const VAULT = __dirname;
  const EXPLICIT = { installPath: INSTALL, vaultPath: VAULT };
  const DISCOVERED = { installPath: INSTALL, vaultPath: VAULT, mcpBin: path.join(INSTALL, 'bin', 'brainchild-mcp.js') };

  describe('_resolveLink priority', () => {
    test('an explicit persisted link wins (source explicit), discovery not consulted', () => {
      const discoverFn = jest.fn(() => DISCOVERED);
      const mgr = new BrainchildManager({
        getLink: () => EXPLICIT,
        discoverFn,
        isAutoBindDisabled: () => false
      });
      const resolved = mgr._resolveLink();
      expect(resolved).toEqual({ installPath: INSTALL, vaultPath: VAULT, source: 'explicit' });
      expect(discoverFn).not.toHaveBeenCalled();
    });

    test('no explicit link + suppressed returns null even though discovery would resolve', () => {
      const discoverFn = jest.fn(() => DISCOVERED);
      const mgr = new BrainchildManager({
        getLink: () => null,
        discoverFn,
        isAutoBindDisabled: () => true
      });
      expect(mgr._resolveLink()).toBeNull();
      expect(discoverFn).not.toHaveBeenCalled();
    });

    test('no explicit link + not suppressed + valid discovery returns source auto', () => {
      const mgr = new BrainchildManager({
        getLink: () => null,
        discoverFn: () => DISCOVERED,
        isAutoBindDisabled: () => false
      });
      expect(mgr._resolveLink()).toEqual({
        installPath: INSTALL,
        vaultPath: VAULT,
        mcpBin: DISCOVERED.mcpBin,
        source: 'auto'
      });
    });

    test('no explicit link + discovery returns nulls -> null', () => {
      const mgr = new BrainchildManager({
        getLink: () => null,
        discoverFn: () => ({ installPath: null, vaultPath: null, mcpBin: null }),
        isAutoBindDisabled: () => false
      });
      expect(mgr._resolveLink()).toBeNull();
    });
  });

  describe('getStatus source + reason codes', () => {
    test('reports source explicit for a persisted link', () => {
      const mgr = new BrainchildManager({
        getLink: () => EXPLICIT,
        discoverFn: () => DISCOVERED,
        isAutoBindDisabled: () => false
      });
      const status = mgr.getStatus();
      expect(status.status).toBe('linked');
      expect(status.source).toBe('explicit');
    });

    test('reports source auto when bound via discovery', () => {
      const mgr = new BrainchildManager({
        getLink: () => null,
        discoverFn: () => DISCOVERED,
        isAutoBindDisabled: () => false
      });
      const status = mgr.getStatus();
      expect(status.status).toBe('linked');
      expect(status.source).toBe('auto');
    });

    test('degraded reason unlinked_by_user when suppressed', () => {
      const mgr = new BrainchildManager({
        getLink: () => null,
        discoverFn: () => DISCOVERED,
        isAutoBindDisabled: () => true
      });
      expect(mgr.getStatus()).toEqual({ status: 'degraded', reason: 'unlinked_by_user' });
    });

    test('degraded reason not_linked when nothing discoverable and not suppressed', () => {
      const mgr = new BrainchildManager({
        getLink: () => null,
        discoverFn: () => ({ installPath: null, vaultPath: null, mcpBin: null }),
        isAutoBindDisabled: () => false
      });
      expect(mgr.getStatus()).toEqual({ status: 'degraded', reason: 'not_linked' });
    });
  });

  describe('_ensureClient respects suppression', () => {
    test('throws unlinked_by_user when suppressed even though discovery would resolve, never spawns', async () => {
      const spawnFn = jest.fn();
      const mgr = new BrainchildManager({
        getLink: () => null,
        discoverFn: () => DISCOVERED,
        isAutoBindDisabled: () => true,
        spawnFn
      });
      await expect(mgr.call('list_notes', {})).rejects.toThrow('unlinked_by_user');
      expect(spawnFn).not.toHaveBeenCalled();
    });
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
  const INSTALL = TEST_INSTALL;
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

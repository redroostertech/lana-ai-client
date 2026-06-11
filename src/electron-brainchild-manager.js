/**
 * electron-brainchild-manager.js
 *
 * Electron-main bridge to the user's local Brainchild vault.
 *
 * Phase B design (B0 resolved): the client reads the vault through the brainchild
 * MCP *stdio* server (brainchild/bin/brainchild-mcp.js), NOT the HTTP API. There
 * is no port discovery. A one-time "Link Brainchild" (install path + vault path)
 * is persisted in client config; thereafter Electron main spawns the MCP server
 * on demand, drives it with the hand-rolled StdioMcpClient, and exposes the read
 * tools (list_notes, search, get_note). This works even when the Brainchild app
 * is closed because the MCP server reads the vault from disk.
 *
 * Responsibilities:
 *   - locate the brainchild install (bin/brainchild-mcp.js) and vault via OS
 *     defaults + env (pure helpers, unit-tested);
 *   - validate a link (install + vault exist / readable);
 *   - spawn + reuse a single MCP child process, lazily on first read;
 *   - tear down cleanly on quit; tolerate broken pipes / crashes.
 *
 * Thin-client rule: ALL node/spawn logic lives here in main, never in the
 * renderer. The renderer talks to this only through IPC.
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const { StdioMcpClient } = require('./electron-mcp-client');

const MCP_BIN_RELATIVE = path.join('bin', 'brainchild-mcp.js');

// ───────────────────────────────────────────────────────────────────────────
// Pure path/discovery helpers (no spawn, no global state) — unit-tested.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Default candidate brainchild install roots per OS. A "root" is a directory
 * that should contain `bin/brainchild-mcp.js`. Pure.
 * @param {Object} env
 * @param {string} platform - process.platform
 * @param {string} homedir
 * @returns {string[]}
 */
function installRootCandidates(env, platform, homedir) {
  const home = homedir || os.homedir();
  const e = env || {};
  const candidates = [];

  // Explicit override always wins.
  if (e.BRAINCHILD_HOME) candidates.push(e.BRAINCHILD_HOME);

  // Dev checkout next to this client repo: ../brainchild
  candidates.push(path.resolve(__dirname, '..', '..', 'brainchild'));

  if (platform === 'darwin') {
    candidates.push('/Applications/Brainchild.app/Contents/Resources');
    candidates.push(path.join(home, 'Applications', 'Brainchild.app', 'Contents', 'Resources'));
  } else if (platform === 'win32') {
    const programFiles = e['ProgramFiles'] || 'C:\\Program Files';
    const localAppData = e['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local');
    candidates.push(path.join(programFiles, 'Brainchild'));
    candidates.push(path.join(localAppData, 'Brainchild'));
  } else {
    candidates.push('/opt/brainchild');
    candidates.push('/usr/local/lib/brainchild');
    candidates.push(path.join(home, '.local', 'share', 'brainchild'));
  }
  return candidates;
}

/**
 * Resolve the MCP bin path for a given install root. Pure (no fs).
 * @param {string} installRoot
 * @returns {string}
 */
function mcpBinForRoot(installRoot) {
  return path.join(installRoot, MCP_BIN_RELATIVE);
}

/**
 * Default vault path candidates per OS. Pure.
 * Dev default per Phase B spec: ~/Library/Application Support/Electron/vault.
 * @param {Object} env
 * @param {string} platform
 * @param {string} homedir
 * @returns {string[]}
 */
function vaultCandidates(env, platform, homedir) {
  const home = homedir || os.homedir();
  const e = env || {};
  const candidates = [];

  if (e.LANA_BRAIN_VAULT) candidates.push(e.LANA_BRAIN_VAULT);

  // The Brainchild Electron app stores its vault at <userData>/vault, where
  // userData = app.getPath('userData') (electron/main.ts startBrain). For a
  // PACKAGED app that is "<Application Support>/Brainchild/vault"; in dev
  // (unpackaged, app name "Electron") it is "<Application Support>/Electron/vault".
  // Prefer the real Brainchild app vault first so discovery binds to the SAME
  // vault the Brainchild app populates — not a stray empty Electron-dev vault
  // that the bridge would otherwise surface boilerplate from.
  if (platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    candidates.push(path.join(appSupport, 'Brainchild', 'vault'));
    candidates.push(path.join(appSupport, 'Electron', 'vault'));
    candidates.push(path.join(appSupport, 'lana-ai-client', 'vault'));
  } else if (platform === 'win32') {
    const appData = e['APPDATA'] || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Brainchild', 'vault'));
    candidates.push(path.join(appData, 'Electron', 'vault'));
    candidates.push(path.join(appData, 'lana-ai-client', 'vault'));
  } else {
    candidates.push(path.join(home, '.config', 'Brainchild', 'vault'));
    candidates.push(path.join(home, '.config', 'Electron', 'vault'));
    candidates.push(path.join(home, '.config', 'lana-ai-client', 'vault'));
  }
  return candidates;
}

/**
 * Given a resolved link config + a child of the link describing what's missing,
 * derive the degraded reason code. Pure.
 * @param {{ installValid: boolean, vaultValid: boolean }} checks
 * @returns {'install_not_found'|'vault_not_found'|null}
 */
function degradedReason(checks) {
  if (!checks || !checks.installValid) return 'install_not_found';
  if (!checks.vaultValid) return 'vault_not_found';
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// FS-backed validation + discovery (thin wrappers over the pure helpers).
// ───────────────────────────────────────────────────────────────────────────

function fileExists(target) {
  try { return Boolean(target) && fs.existsSync(target) && fs.statSync(target).isFile(); }
  catch (_error) { return false; }
}

function dirReadable(target) {
  try {
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) return false;
    fs.accessSync(target, fs.constants.R_OK);
    return true;
  } catch (_error) { return false; }
}

/**
 * Decide whether a renderer-supplied install root is one we are willing to spawn
 * from. We only spawn Node against `bin/brainchild-mcp.js` under a vetted root.
 * The renderer never supplies arbitrary paths today (discover() only ever offers
 * the OS-default candidates), but the IPC contract is broader than the UI, so a
 * compromised/XSS'd renderer could otherwise point installPath at any directory
 * containing bin/brainchild-mcp.js and get arbitrary JS executed under our Node.
 * Constrain to the same installRootCandidates set the discovery flow uses. Pure
 * (path comparison only; existence is checked separately by validateLink).
 *
 * @param {string} installPath
 * @param {Object} [options] - { env, platform, homedir } overridable for tests
 * @returns {boolean}
 */
function isAllowedInstallRoot(installPath, options = {}) {
  if (!installPath || typeof installPath !== 'string') return false;
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const homedir = options.homedir || os.homedir();
  const normalized = path.resolve(installPath);
  return installRootCandidates(env, platform, homedir)
    .some((candidate) => path.resolve(candidate) === normalized);
}

/**
 * Validate a link config against the FILESYSTEM only (does bin/brainchild-mcp.js
 * exist, is the vault readable). This is the check used once a link is already
 * persisted/vetted: the renderer-input allowlist is enforced at link time by the
 * IPC handler, not re-applied on every spawn (a picker-chosen root outside the
 * OS-default candidate set is legitimately persisted and must still spawn).
 * @param {{ installPath?: string, vaultPath?: string }} link
 * @returns {{ installValid: boolean, vaultValid: boolean, mcpBin: string }}
 */
function validateLinkFs(link) {
  const installPath = link && link.installPath ? link.installPath : '';
  const vaultPath = link && link.vaultPath ? link.vaultPath : '';
  const mcpBin = installPath ? mcpBinForRoot(installPath) : '';
  return {
    installValid: fileExists(mcpBin),
    vaultValid: dirReadable(vaultPath),
    mcpBin
  };
}

/**
 * Validate a link config against the filesystem AND the install-root allowlist.
 * `installValid` requires both that bin/brainchild-mcp.js exists and that the
 * install root is on the allowlist, so a renderer-supplied arbitrary path is
 * rejected before any spawn. Use this at the IPC boundary where the path is
 * still untrusted renderer input.
 * @param {{ installPath?: string, vaultPath?: string }} link
 * @returns {{ installValid: boolean, vaultValid: boolean, installAllowed: boolean, mcpBin: string }}
 */
function validateLink(link) {
  const fsChecks = validateLinkFs(link);
  const installAllowed = isAllowedInstallRoot(link && link.installPath);
  return {
    installValid: installAllowed && fsChecks.installValid,
    vaultValid: fsChecks.vaultValid,
    installAllowed,
    mcpBin: fsChecks.mcpBin
  };
}

/**
 * Probe OS-default locations for a usable install + vault. Returns the first
 * pair that validates, or partial discovery for UX.
 * @param {Object} [options]
 * @param {Object} [options.env]
 * @param {string} [options.platform]
 * @param {string} [options.homedir]
 * @returns {{ installPath: string|null, vaultPath: string|null, mcpBin: string|null }}
 */
function discover(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const homedir = options.homedir || os.homedir();

  let installPath = null;
  let mcpBin = null;
  for (const root of installRootCandidates(env, platform, homedir)) {
    const bin = mcpBinForRoot(root);
    if (fileExists(bin)) { installPath = root; mcpBin = bin; break; }
  }

  let vaultPath = null;
  for (const candidate of vaultCandidates(env, platform, homedir)) {
    if (dirReadable(candidate)) { vaultPath = candidate; break; }
  }

  return { installPath, vaultPath, mcpBin };
}

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle manager (single child process, spawned lazily, reused).
// ───────────────────────────────────────────────────────────────────────────

class BrainchildManager {
  /**
   * @param {Object} [deps]
   * @param {() => (Object|null)} [deps.getLink] - reads persisted link config
   * @param {(msg: string, error?: Error) => void} [deps.logInfo]
   * @param {(msg: string, error?: Error) => void} [deps.logError]
   * @param {Function} [deps.spawnFn] - injectable for tests (defaults to child_process.spawn)
   */
  constructor(deps = {}) {
    this._getLink = typeof deps.getLink === 'function' ? deps.getLink : function () { return null; };
    this._logInfo = typeof deps.logInfo === 'function' ? deps.logInfo : function () {};
    this._logError = typeof deps.logError === 'function' ? deps.logError : function () {};
    this._spawn = typeof deps.spawnFn === 'function' ? deps.spawnFn : spawn;

    this._child = null;
    this._client = null;
    this._starting = null; // Promise guarding concurrent starts
    this._startingVaultPath = null; // vault the in-flight start is bound to
    this._activeVaultPath = null;
  }

  /**
   * Current bridge status for the renderer. Does NOT spawn.
   * @returns {{ status: 'connected'|'linked'|'degraded', reason?: string, vaultPath?: string }}
   */
  getStatus() {
    const link = this._getLink();
    if (!link || !link.installPath || !link.vaultPath) {
      return { status: 'degraded', reason: 'not_linked' };
    }
    // Persisted link — filesystem check only (allowlist was enforced at link time).
    const checks = validateLinkFs(link);
    const reason = degradedReason(checks);
    if (reason) return { status: 'degraded', reason, installPath: link.installPath, vaultPath: link.vaultPath };
    if (this._client && this._child && !this._child.killed) {
      return { status: 'connected', vaultPath: link.vaultPath, installPath: link.installPath };
    }
    return { status: 'linked', vaultPath: link.vaultPath, installPath: link.installPath };
  }

  _resolveNodeExec() {
    // Electron's bundled Node is reachable via process.execPath + ELECTRON_RUN_AS_NODE.
    // brainchild-mcp.js is a plain .js file, so we must run it through Node, not
    // as a binary. Using Electron's own Node avoids relying on a system `node`.
    return process.execPath;
  }

  /**
   * Ensure a live MCP client, spawning the child lazily. Reuses an existing one
   * unless the linked vault path changed.
   * @returns {Promise<StdioMcpClient>}
   */
  async _ensureClient() {
    const link = this._getLink();
    if (!link || !link.installPath || !link.vaultPath) {
      throw new Error('not_linked');
    }
    // Persisted link — filesystem check only (allowlist was enforced at link time).
    const checks = validateLinkFs(link);
    const reason = degradedReason(checks);
    if (reason) throw new Error(reason);

    // Reuse a healthy client for the same vault.
    if (this._client && this._child && !this._child.killed && this._activeVaultPath === link.vaultPath) {
      return this._client;
    }
    // Vault changed or process gone — tear down before respawning.
    if (this._child) this.stop();

    // Honor a vault change even while a start is in flight: the in-flight
    // promise is bound to whatever vault was current when it began. If that
    // differs from the link's vault now (a re-link landed mid-start), the
    // in-flight client would resolve against the OLD vault. Stop it first so we
    // respawn for the new vault instead of returning the stale start.
    if (this._starting) {
      if (this._startingVaultPath === link.vaultPath) return this._starting;
      this.stop();
    }

    this._startingVaultPath = link.vaultPath;
    this._starting = new Promise((resolve, reject) => {
      try {
        const env = Object.assign({}, process.env, {
          ELECTRON_RUN_AS_NODE: '1',
          LANA_BRAIN_VAULT: link.vaultPath,
          // The client bridge is strictly read-only. Tell the MCP server not to
          // seed Welcome/Forms/Templates into the user's vault on spawn — reading
          // a vault must never write boilerplate to disk.
          BRAINCHILD_MCP_NO_SEED: '1'
        });
        const child = this._spawn(
          this._resolveNodeExec(),
          [checks.mcpBin, '--vault', link.vaultPath, '--no-seed'],
          { stdio: ['pipe', 'pipe', 'inherit'], env }
        );

        child.on('error', (error) => {
          this._logError('[brainchild] MCP child spawn error', error);
          reject(error);
        });
        child.on('exit', (code, signal) => {
          this._logInfo(`[brainchild] MCP child exited (code=${code}, signal=${signal})`);
          // Drop references so the next read respawns. Do NOT auto-loop here;
          // the renderer surfaces a degraded state and the next call re-spawns.
          if (this._child === child) {
            this._child = null;
            if (this._client) { try { this._client.dispose(); } catch (_e) { /* noop */ } }
            this._client = null;
            this._activeVaultPath = null;
          }
        });

        const client = new StdioMcpClient(child, {
          onError: (msg, error) => this._logError('[brainchild] ' + msg, error)
        });

        this._child = child;
        this._client = client;
        this._activeVaultPath = link.vaultPath;

        client.initialize()
          .then(() => {
            this._logInfo('[brainchild] MCP client initialized for vault ' + link.vaultPath);
            resolve(client);
          })
          .catch((error) => {
            this._logError('[brainchild] MCP initialize failed', error);
            this.stop();
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    }).finally(() => {
      this._starting = null;
      this._startingVaultPath = null;
    });

    return this._starting;
  }

  /**
   * Invoke a read tool. Read-only set is enforced here.
   * @param {string} tool - 'list_notes' | 'search' | 'get_note'
   * @param {Object} [args]
   */
  async call(tool, args) {
    const READ_TOOLS = { list_notes: true, search: true, get_note: true };
    if (!READ_TOOLS[tool]) throw new Error('Unsupported brainchild tool: ' + tool);
    const client = await this._ensureClient();
    return client.callTool(tool, args || {});
  }

  /** Tear down the child + client. Safe to call repeatedly. */
  stop() {
    if (this._client) {
      try { this._client.dispose(); } catch (_error) { /* noop */ }
      this._client = null;
    }
    if (this._child) {
      const child = this._child;
      try { child.kill(); } catch (_error) { /* noop */ }
      // bin/brainchild-mcp.js runs an async SIGTERM shutdown (server.close() +
      // index.close(), where index.watch() holds fs watchers). If that hangs the
      // child can linger past app quit. Force-kill as a fallback so quit is
      // deterministic. The timer is unref'd so it never keeps the loop alive.
      try {
        const timer = setTimeout(() => {
          try { if (!child.killed) child.kill('SIGKILL'); } catch (_e) { /* noop */ }
        }, 2000);
        if (typeof timer.unref === 'function') timer.unref();
      } catch (_error) { /* noop */ }
      this._child = null;
    }
    this._activeVaultPath = null;
  }
}

module.exports = {
  // pure helpers (unit-tested)
  installRootCandidates,
  mcpBinForRoot,
  vaultCandidates,
  degradedReason,
  isAllowedInstallRoot,
  validateLinkFs,
  validateLink,
  // fs-backed
  discover,
  // lifecycle
  BrainchildManager
};

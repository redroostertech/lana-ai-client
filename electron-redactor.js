'use strict';

/**
 * The redactor on this computer (first-launch plan, section 6a). Main process.
 *
 * The engine redacts every turn it sends to the cloud (Forge or the firm's provider) before it
 * leaves this computer, and refuses to send one it cannot redact (backend
 * src/shared/redaction/egress-gate.js). The redactor is lana-redactor (Presidio and spaCy),
 * packaged the way BLOT packages it (blot-framework src/main/embedded-redactor.ts): one program
 * holding Python, the code and the lighter detection layers, which are the pattern rules (SSN,
 * EIN, card, IBAN, case numbers), the health record rules, and spaCy en_core_web_lg for names,
 * organisations and places. The heavier layers (scispaCy health terms, the de-identification
 * transformer) are not included yet.
 *
 * Each launch it gets a free loopback port and a new 32-byte secret, and runs in strict mode,
 * so it refuses to redact without its names layer or without the secret. It is ready when
 * /healthz reports ready and analyzer_ready and one signed test request (fixed text, nothing of
 * the person's) succeeds. Then onAddress gets { url, secret }, which the engine is given as
 * REDACTOR_URL and INTERNAL_SERVICE_SECRET. Restarts keep the same port and secret, so the
 * engine does not need restarting for them.
 *
 * Where the program is, in this order:
 *   LANA_REDACTOR_BIN    a built program (developers)
 *   <resources>/redactor/lana-redactor (lana-redactor.exe on Windows), in an installed app
 *   LANA_REDACTOR_SRC    a lana-redactor checkout, run with the uvicorn of LANA_REDACTOR_VENV
 *                        or ~/.lananode/redactor/venv (development; the checkout comes first on
 *                        PYTHONPATH, so its code is what runs)
 * None: the redactor is not started, and the engine keeps every turn on this computer.
 */

const path = require('path');
const crypto = require('crypto');
const { createKeptProcess, DEFAULTS } = require('./electron-process-keeper');

const HOST = '127.0.0.1';
// The service name the engine's redactor client sends (backend src/shared/redaction/redactor-client.js).
const SERVICE_NAME = 'lana-one';
const READINESS_TEXT = 'LANA redactor readiness check.';

// Only these reach the redactor from the client's environment.
const INHERITED_ENV = [
  'PATH', 'Path', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'TZ',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE'
];

// What the redactor holds in memory, set aside when sizing this computer. Measured on an Apple
// M4 Pro with the lighter layers: 427 MB after the first request, 458 MB at the peak while
// redacting a 54,265-character text three times (about 5 seconds each).
const REDACTOR_MEMORY_BYTES = 0.5 * 1024 ** 3;

const REDACTOR_DEFAULTS = Object.freeze({
  ...DEFAULTS,
  // spaCy's large model loads in a few seconds; a cold disk can take longer.
  startTimeoutMs: 90000,
  healthIntervalStartingMs: 250
});

/**
 * How to start the redactor on this computer, or null when there is none.
 * @returns {{ command: string, args: string[], cwd: string, env: Object }|null}
 */
function resolveRedactorCommand({ env = {}, resourcesPath = null, isPackaged = false, platform = process.platform, home, fileExists }) {
  const listen = (port) => ['--host', HOST, '--port', String(port)];
  if (typeof env.LANA_REDACTOR_BIN === 'string' && env.LANA_REDACTOR_BIN.trim()) {
    const file = path.resolve(env.LANA_REDACTOR_BIN.trim());
    return fileExists(file) ? { command: file, args: listen, cwd: path.dirname(file), env: {} } : null;
  }
  if (isPackaged && resourcesPath) {
    const root = path.join(resourcesPath, 'redactor');
    const file = path.join(root, platform === 'win32' ? 'lana-redactor.exe' : 'lana-redactor');
    if (!fileExists(file)) {return null;}
    const ocr = path.join(root, 'ocr');
    const tesseract = path.join(ocr, 'bin', platform === 'win32' ? 'tesseract.exe' : 'tesseract');
    const tessdata = path.join(ocr, 'tessdata');
    const ocrEnv = fileExists(tesseract) && fileExists(tessdata) ? { LANA_TESSERACT_PATH: tesseract, LANA_TESSDATA_DIR: tessdata } : {};
    return { command: file, args: listen, cwd: root, env: ocrEnv };
  }
  if (isPackaged || typeof env.LANA_REDACTOR_SRC !== 'string' || !env.LANA_REDACTOR_SRC.trim()) {return null;}
  const source = path.resolve(env.LANA_REDACTOR_SRC.trim());
  const venv = env.LANA_REDACTOR_VENV ? path.resolve(env.LANA_REDACTOR_VENV) : (home ? path.join(home, '.lananode', 'redactor', 'venv') : null);
  if (!venv) {return null;}
  const uvicorn = platform === 'win32' ? path.join(venv, 'Scripts', 'uvicorn.exe') : path.join(venv, 'bin', 'uvicorn');
  if (!fileExists(uvicorn) || !fileExists(path.join(source, 'redactor', 'main.py'))) {return null;}
  return { command: uvicorn, args: (port) => ['redactor.main:app', ...listen(port)], cwd: source, env: { PYTHONPATH: source } };
}

/** The redactor's environment: OS basics, the secret, strict mode. Nothing else of the client's. */
function redactorEnv(baseEnv, { secret, extra = {} }) {
  const out = {};
  for (const name of INHERITED_ENV) {
    if (typeof baseEnv[name] === 'string') {out[name] = baseEnv[name];}
  }
  return { ...out, ...extra, INTERNAL_SERVICE_SECRET: secret, REDACTOR_STRICT: '1', PYTHONUNBUFFERED: '1' };
}

/**
 * Ready means /healthz says ready and analyzer_ready (the names layer loaded and the secret
 * set) and, while starting, one signed test request is redacted. A health answer alone only
 * proves something owns the port.
 */
async function checkRedactor(fetch, url, secret, { starting, timeoutMs }) {
  const response = await fetch(`${url}/healthz`, { method: 'GET', timeoutMs });
  if (!response.ok) {return `health answered ${response.status}`;}
  const body = await response.json();
  if (!body || body.ready !== true || body.analyzer_ready !== true) {
    return `not ready (ready ${body && body.ready}, analyzer_ready ${body && body.analyzer_ready})`;
  }
  if (!starting) {return null;}
  const probe = await fetch(`${url}/redact`, {
    method: 'POST',
    timeoutMs: 10000,
    headers: { 'Content-Type': 'application/json', 'X-Lana-Service': SERVICE_NAME, 'X-Lana-Service-Secret': secret },
    body: JSON.stringify({ text: READINESS_TEXT })
  });
  // The body is never read into a log; only the status matters here.
  return probe.ok ? null : `signed test request answered ${probe.status}`;
}

/**
 * @param {Object} deps
 * @param {Object|null} deps.command - resolveRedactorCommand()
 * @param {Function} deps.spawn
 * @param {Function} deps.fetch - (url, { timeoutMs, ... }) => Response
 * @param {Function} deps.pickPort - async (preferred) => a free loopback port
 * @param {Object} [deps.baseEnv]
 * @param {Function} [deps.onAddress] - ({ url, secret } | null) => void
 * @param {Function} [deps.openLog]
 * @param {Function} [deps.makeSecret]
 */
function createRedactor(deps) {
  const {
    command, spawn, fetch, pickPort,
    baseEnv = {},
    onAddress = () => {},
    openLog = () => null,
    makeSecret = () => crypto.randomBytes(32).toString('hex'),
    timers = { setTimeout, clearTimeout },
    now = () => Date.now(),
    log = { info() {}, warn() {}, error() {} },
    options = {}
  } = deps;
  const opts = { ...REDACTOR_DEFAULTS, ...options };
  let keeper = null;
  let secret = null;
  let announced = null;

  function changed(state) {
    const next = state.answeredOnce ? state.url : null;
    if (next === announced) {return;}
    announced = next;
    try { onAddress(next ? { url: next, secret } : null); } catch (_error) { /* listener errors are not ours */ }
  }

  async function start() {
    if (keeper) {return getState();}
    if (!command) {
      log.warn('[redactor] no redactor on this computer; turns stay on this computer instead of going to the cloud');
      return getState();
    }
    const port = await pickPort(null);
    secret = makeSecret();
    keeper = createKeptProcess({ name: 'redactor', label: 'redactor', spawn, timers, now, log, openLog, onChange: changed, options: opts });
    keeper.start({
      command: command.command,
      args: command.args(port),
      cwd: command.cwd,
      env: redactorEnv(baseEnv, { secret, extra: command.env }),
      port,
      check: (url, { starting }) => checkRedactor(fetch, url, secret, { starting, timeoutMs: opts.healthTimeoutMs })
    });
    return getState();
  }

  async function stop() {
    const target = keeper;
    keeper = null;
    if (target) {await target.stop();}
    secret = null;
  }

  function getState() {
    return { installed: Boolean(command), server: keeper ? keeper.getState() : null };
  }

  return { start, stop, getState };
}

/** What the engine is given for the redactor: both settings together, or neither. */
function redactorEndpoints(address) {
  return address ? { REDACTOR_URL: address.url, INTERNAL_SERVICE_SECRET: address.secret } : {};
}

module.exports = { createRedactor, REDACTOR_MEMORY_BYTES, resolveRedactorCommand, redactorEnv, checkRedactor, redactorEndpoints, REDACTOR_DEFAULTS, SERVICE_NAME };

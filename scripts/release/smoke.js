'use strict';

/**
 * Checks that run on a freshly built piece before it is uploaded, the way the
 * app uses it:
 *
 *   engineLoadCheck  the engine's native packages load under the app's own
 *                    Electron (ELECTRON_RUN_AS_NODE=1), then a bcrypt
 *                    hash and compare round trip
 *   redactorSmoke    the redactor on loopback with a random secret and
 *                    REDACTOR_STRICT=1: /healthz ready, a signed /redact hides
 *                    the sample names and SSN, an unsigned request gets 401
 *
 * The Pip embedding match runs LANA-AI's own launcher and match check
 * (deploy/railway/embed/local-pip-embed.js, scripts/embed/embed-match-check.js).
 */

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { resolveRedactorCommand, redactorEnv, SERVICE_NAME } = require('../../electron-redactor');

const SAMPLE = 'Jane Smith met John Carter. Her SSN is 123-45-6789.';
const SAMPLE_SECRETS = ['Jane Smith', 'John Carter', '123-45-6789'];

/** The program that loads every external of an engine folder, then bcrypt. */
function engineLoadScript(engineDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(engineDir, 'engine-manifest.json'), 'utf8'));
  const loads = (manifest.externals || []).map((name) => `require(${JSON.stringify(path.join(engineDir, 'node_modules', name))});`).join('');
  const bcrypt = JSON.stringify(path.join(engineDir, 'node_modules', 'bcrypt'));
  return `${loads}const b=require(${bcrypt});const h=b.hashSync('lana-release-check',4);if(!b.compareSync('lana-release-check',h)){process.exit(3);}`;
}

async function engineLoadCheck({ run, electron, engineDir, env = {} }) {
  const result = await run(electron, ['-e', engineLoadScript(engineDir)], {
    env: { PATH: env.PATH || process.env.PATH, HOME: env.HOME || process.env.HOME, ELECTRON_RUN_AS_NODE: '1' }
  });
  return result.code === 0 ? [] : [`the engine's native packages or bcrypt did not load under the app's Electron (exit ${result.code})`];
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * @param {Object} args
 * @param {string} args.binary - build/redactor/lana-redactor/lana-redactor[.exe]
 * @param {Object} [deps] - { fetch, spawn, freePort, timeoutMs } for tests
 */
async function redactorSmoke({ binary }, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const start = deps.spawn || spawn;
  const port = await (deps.freePort || freePort)();
  const secret = crypto.randomBytes(32).toString('hex');
  const command = resolveRedactorCommand({ env: { LANA_REDACTOR_BIN: binary }, fileExists: fs.existsSync });
  if (!command) {return [`the redactor program is missing: ${binary}`];}
  const child = start(command.command, command.args(port), { cwd: command.cwd, env: redactorEnv(process.env, { secret }), stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const problems = [];
  try {
    const until = Date.now() + (deps.timeoutMs || 90000);
    let ready = false;
    while (!ready && Date.now() < until) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one probe at a time
        const response = await doFetch(`${url}/healthz`);
        // eslint-disable-next-line no-await-in-loop
        const body = response.ok ? await response.json() : null;
        ready = Boolean(body && body.ready === true && body.analyzer_ready === true);
      } catch (_error) { /* not listening yet */ }
      // eslint-disable-next-line no-await-in-loop
      if (!ready) {await sleep(deps.stepMs || 1000);}
    }
    if (!ready) {return ['the redactor did not report ready within 90 s'];}
    const signed = await doFetch(`${url}/redact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lana-Service': SERVICE_NAME, 'X-Lana-Service-Secret': secret },
      body: JSON.stringify({ text: SAMPLE })
    });
    // Only the redacted text: token_map and entities hold the originals on purpose.
    const text = signed.ok ? String((await signed.json()).redacted || '') : '';
    if (signed.ok && !text) {problems.push('a signed /redact returned no redacted text');}
    if (!signed.ok) {problems.push(`a signed /redact answered ${signed.status}`);}
    const leaked = SAMPLE_SECRETS.filter((value) => text.includes(value));
    if (signed.ok && leaked.length) {problems.push(`a signed /redact left ${leaked.length} of ${SAMPLE_SECRETS.length} sample values in place`);}
    const unsigned = await doFetch(`${url}/redact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: SAMPLE }) });
    if (unsigned.status !== 401) {problems.push(`an unsigned /redact answered ${unsigned.status}, not 401`);}
    return problems;
  } finally {
    child.kill();
  }
}

/**
 * Starts the built Pip as an embedder with LANA-AI's own launcher and checks
 * its vectors against the reference (embed-match-check.js). Once on the CPU
 * (gpuLayers 0, required everywhere) and, where the computer has one, once on
 * the GPU.
 *
 * @returns {Promise<string[]>} problems; empty when it matches
 */
async function embedMatch({ run, serverRepo, lqe, modelPath, modelSha, gpuLayers }, deps = {}) {
  const start = deps.spawn || spawn;
  const port = await (deps.freePort || freePort)();
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    PIP_BINARY: lqe, PIP_MODEL_PATH: modelPath, PIP_MODEL_SHA256: modelSha, PIP_ALIAS: 'nomic-embed-text-v1.5',
    PIP_HOST: '127.0.0.1', PIP_PORT: String(port), PIP_PARALLEL: '2', PIP_CTX_PER_SLOT: '2048', PIP_GPU_LAYERS: String(gpuLayers)
  };
  const child = start(process.execPath, [path.join(serverRepo, 'deploy', 'railway', 'embed', 'local-pip-embed.js')], { env, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  const doFetch = deps.fetch || fetch;
  try {
    const until = Date.now() + (deps.timeoutMs || 180000);
    let ready = false;
    while (!ready && Date.now() < until) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await doFetch(`${url}/health`);
        // eslint-disable-next-line no-await-in-loop
        const body = response.ok ? await response.json() : null;
        ready = Boolean(body && body.status === 'ok' && body.role === 'embed' && (!body.model_file || body.model_file.sha256_state === 'ready'));
      } catch (_error) { /* starting */ }
      // eslint-disable-next-line no-await-in-loop
      if (!ready) {await sleep(deps.stepMs || 2000);}
    }
    if (!ready) {return [`Pip (gpu layers ${gpuLayers}) did not answer as an embedder within 180 s`];}
    const result = await run(process.execPath, [
      path.join(serverRepo, 'scripts', 'embed', 'embed-match-check.js'), '--a', url,
      '--reference', path.join(serverRepo, 'deploy', 'railway', 'embed', 'match-reference.json')
    ]);
    if (result.code === 0) {return [];}
    let lowest = 'unknown';
    try { lowest = JSON.parse(result.stdout).min_cosine; } catch (_error) { /* not JSON */ }
    return [`Pip (gpu layers ${gpuLayers}) does not make the reference vectors (lowest cosine ${lowest})`];
  } finally {
    child.kill();
  }
}

module.exports = { embedMatch, SAMPLE, SAMPLE_SECRETS, engineLoadScript, engineLoadCheck, redactorSmoke, freePort };

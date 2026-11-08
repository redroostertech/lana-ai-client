/**
 * Settings > Capabilities > AI models: where LANA's AI can run, read in the main process.
 *
 *   Local   the Pip model server on this computer (chat and embeddings endpoints the
 *           client hands the local AI engine: LANA_ENGINE_CHAT_URL, LANA_ENGINE_EMBEDDING_URL),
 *           the Pip build LANA pins, and which catalog models are downloaded here.
 *   Server  the organization's LANA server (its version is read by the renderer, signed in).
 *   Forge   LANA's cloud AI (discovery's forgeUrl and sovereign flag). The server's AI is Forge.
 *
 * Probes are a GET with a short timeout; an endpoint counts as running when it answers below 500.
 * Nothing here is sent anywhere else.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROBE_TIMEOUT_MS = 1500;

function trimmed(url) {
  return typeof url === 'string' && url.trim() ? url.trim().replace(/\/+$/, '') : null;
}

async function getJson(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (response.status >= 500) return { answered: false, body: null };
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    return { answered: true, ok: response.ok, body };
  } catch (_) {
    return { answered: false, body: null };
  }
}

/**
 * One Pip endpoint: whether it answers, and the model and build it reports (/props, as
 * llama.cpp servers do), when it says.
 */
async function pipEndpoint(rawUrl, fetchImpl) {
  const url = trimmed(rawUrl);
  if (!url) return { url: null, state: 'not_set', model: null, build: null };
  const health = await getJson(`${url}/health`, fetchImpl);
  if (!health.answered) return { url, state: 'not_running', model: null, build: null };
  const props = await getJson(`${url}/props`, fetchImpl);
  const body = props.body && typeof props.body === 'object' ? props.body : {};
  const modelPath = typeof body.model_path === 'string' ? body.model_path : (body.default_generation_settings && body.default_generation_settings.model) || null;
  return {
    url,
    state: 'running',
    model: modelPath ? path.basename(String(modelPath)) : null,
    build: typeof body.build_info === 'string' ? body.build_info : null
  };
}

/** Downloaded means the file is in place at its catalog size (the full sha256 check runs when the engine loads it). */
function catalogModels(catalog, dir, statSync = fs.statSync) {
  return catalog.map((entry) => {
    let downloaded = false;
    try { downloaded = Boolean(dir) && statSync(path.join(dir, entry.filename)).size === entry.sizeBytes; } catch (_) { downloaded = false; }
    return { id: entry.id, name: entry.name, role: entry.role, sizeBytes: entry.sizeBytes, downloaded };
  });
}

/**
 * @param {object} deps
 * @param {NodeJS.ProcessEnv} deps.env
 * @param {object|null} deps.savedServer   electron-storage getSavedServer()
 * @param {Array} deps.catalog             electron-local-models CATALOG
 * @param {string|null} deps.modelsDir
 * @param {Function} [deps.fetchImpl]
 * @param {Function} [deps.statSync]
 */
async function aiTopology({ env, savedServer, catalog, modelsDir, fetchImpl = fetch, statSync = fs.statSync }) {
  const pinned = (catalog.find((entry) => entry.runtime) || {}).runtime || null;
  const forgeUrl = trimmed(savedServer && savedServer.forgeUrl);
  const [chat, embedding, forge] = await Promise.all([
    pipEndpoint(env.LANA_ENGINE_CHAT_URL, fetchImpl),
    pipEndpoint(env.LANA_ENGINE_EMBEDDING_URL, fetchImpl),
    forgeUrl ? getJson(`${forgeUrl}/health`, fetchImpl) : Promise.resolve(null)
  ]);
  return {
    pip: {
      pinned: pinned ? { version: pinned.version, build: pinned.build } : null,
      chat,
      embedding,
      models: catalogModels(catalog, modelsDir, statSync)
    },
    server: { url: trimmed(savedServer && (savedServer.chefUrl || savedServer.url)) },
    forge: {
      url: forgeUrl,
      reachable: forge ? forge.answered : null,
      sovereign: Boolean(savedServer && savedServer.forgeSovereign)
    }
  };
}

function registerAiTopologyIpc(ipcMain, deps) {
  ipcMain.handle('settings:ai-topology', async () => {
    try {
      return { success: true, topology: await aiTopology({ env: deps.env, savedServer: deps.savedServer(), catalog: deps.catalog, modelsDir: deps.modelsDir() }) };
    } catch (error) {
      deps.logError('[settings] Failed to read the AI setup', error);
      return { success: false, error: 'LANA could not read where its AI runs.' };
    }
  });
}

module.exports = { aiTopology, pipEndpoint, catalogModels, registerAiTopologyIpc };

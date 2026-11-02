'use strict';

/**
 * The laptop's local model catalog (main process): every model this app may
 * download for the local AI engine, pinned to our Cloudflare R2 bucket
 * (models.lanaai.io) with its exact size and sha256. Never Hugging Face.
 *
 * The embedding model is the one every firm's embed service serves
 * (LANA-AI deploy/railway/embed/embed-pin.json): same file, same sha256, and
 * the engine checks this computer's Pip build against the organization's
 * identity before it embeds anything. Change it only together with that pin.
 *
 * A download goes to a .part file next to the target, is hashed while it
 * streams, and is renamed into place only when size and sha256 both match;
 * anything else is deleted and reported. A file already in place counts only
 * after the same check.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const R2_LLM = 'https://models.lanaai.io/llm';

const CATALOG = Object.freeze([
  Object.freeze({
    id: 'nomic-embed-text-v1.5-f16',
    role: 'embedding',
    name: 'Nomic Embed Text v1.5 (F16)',
    // The firm's embedding identity (EMBEDDING_MODEL, EMBEDDING_VERSION on Chef).
    modelId: 'nomic-embed-text-v1.5',
    modelVersion: 'f16',
    // The Pip build the identity names (LANA-AI infra/lib/config/lqe.pin.js).
    runtime: Object.freeze({ name: 'pip', version: '3.0.0', build: 'ddedf87af419' }),
    filename: 'nomic-embed-text-v1.5.f16.gguf',
    url: `${R2_LLM}/nomic-embed-text-v1.5.f16.gguf`,
    sizeBytes: 274290560,
    sha256: 'f7af6f66802f4df86eda10fe9bbcfc75c39562bed48ef6ace719a251cf1c2fdb'
  }),
  Object.freeze({
    id: 'qwen3.5-9b-q4km',
    role: 'chat',
    name: 'Qwen3.5 9B (Q4_K_M)',
    filename: 'Qwen3.5-9B-Q4_K_M.gguf',
    url: `${R2_LLM}/Qwen3.5-9B-Q4_K_M.gguf`,
    sizeBytes: 5627044256,
    sha256: 'cd76ec205963b3b33350093e6904d9de16c4e666fd104e1f632d25c7f15f2a13'
  }),
  Object.freeze({
    id: 'qwen3.5-0.8b-q4km',
    role: 'draft',
    name: 'Qwen3.5 0.8B (Q4_K_M)',
    filename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    url: `${R2_LLM}/Qwen3.5-0.8B-Q4_K_M.gguf`,
    sizeBytes: 527502816,
    sha256: 'f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec'
  })
]);

function embeddingModel() {
  return CATALOG.find((entry) => entry.role === 'embedding');
}

/** Where local models live: LANA_MODELS_DIR, else <userData>/models. */
function modelsDir(env, userDataDir) {
  return env.LANA_MODELS_DIR ? path.resolve(env.LANA_MODELS_DIR) : path.join(userDataDir, 'models');
}

async function sha256OfFile(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/** True when the entry's file is in `dir` with its pinned size and sha256. */
async function isInstalled(entry, dir) {
  const file = path.join(dir, entry.filename);
  let stat;
  try { stat = await fs.promises.stat(file); } catch (_error) { return false; }
  if (!stat.isFile() || stat.size !== entry.sizeBytes) {return false;}
  return (await sha256OfFile(file)) === entry.sha256;
}

/**
 * Download one catalog entry into `dir`, verified.
 * @param {Object} entry - a CATALOG entry
 * @param {string} dir
 * @param {Object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {(progress: { received: number, total: number }) => void} [deps.onProgress]
 * @param {Object[]} [deps.catalog] - the allowed entries (tests)
 * @returns {Promise<string>} the installed file path
 */
async function downloadModel(entry, dir, { fetchImpl = (...args) => fetch(...args), onProgress = () => {}, catalog = CATALOG } = {}) {
  if (!catalog.includes(entry)) {throw new Error('Only models in the catalog can be downloaded.');}
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, entry.filename);
  if (await isInstalled(entry, dir)) {return target;}
  const partial = `${target}.part`;
  const response = await fetchImpl(entry.url);
  if (!response.ok || !response.body) {throw new Error(`The model download failed (HTTP ${response.status}).`);}
  const hash = crypto.createHash('sha256');
  let received = 0;
  const counted = Readable.fromWeb(response.body);
  counted.on('data', (chunk) => {
    received += chunk.length;
    hash.update(chunk);
    onProgress({ received, total: entry.sizeBytes });
  });
  try {
    await pipeline(counted, fs.createWriteStream(partial));
    const digest = hash.digest('hex');
    if (received !== entry.sizeBytes || digest !== entry.sha256) {
      throw new Error('The downloaded model did not match its checksum, so it was removed.');
    }
    await fs.promises.rename(partial, target);
    return target;
  } catch (error) {
    await fs.promises.rm(partial, { force: true });
    throw error;
  }
}

/**
 * The engine settings for this computer's embedding model, when the pinned
 * file is installed: the file the engine hashes to verify its identity, and
 * the model id and version that file is. Empty when it is not installed.
 */
async function embeddingEngineEnv(dir) {
  const entry = embeddingModel();
  if (!(await isInstalled(entry, dir))) {return {};}
  return {
    LANA_ENGINE_EMBEDDING_MODEL_FILE: path.join(dir, entry.filename),
    EMBEDDING_MODEL: entry.modelId,
    EMBEDDING_VERSION: entry.modelVersion
  };
}

module.exports = { CATALOG, embeddingModel, modelsDir, isInstalled, downloadModel, embeddingEngineEnv, sha256OfFile };

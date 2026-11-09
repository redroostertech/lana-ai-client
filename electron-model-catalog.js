'use strict';

/**
 * The chat and vision models LANA can offer on this computer (first-launch plan,
 * docs/plans/first-launch-local-ai-plan.md, D3). Main process only.
 *
 * The list is the published Pip catalog (models.lanaai.io/llm/catalog.json, the
 * same one Pip Desktop reads), cut down to the chat models LANA supports and the
 * vision files that pair with them. The last good copy is kept on disk, and a copy
 * built into the app is used when neither the network nor the saved copy is there,
 * so first launch works offline.
 *
 * Only chat and vision come from here. The embedding model is the pinned file in
 * electron-local-models.js (it must equal the firm's embed pin) and speech and
 * voice are Briefs' SPEECH_CATALOG. Nothing published can change those.
 *
 * Why only these chat models: Pip's memory estimate (local-ai-fit.model.js) is
 * measured for the Qwen3 and Qwen3.5 families only. A model of another family is
 * not offered until its numbers are measured.
 */

const fs = require('fs');
const path = require('path');

const PUBLISHED_URL = 'https://models.lanaai.io/llm/catalog.json';
const FETCH_TIMEOUT_MS = 8000;
const MODELS_HOST = 'models.lanaai.io';

/** The chat models LANA offers, largest first, with the name shown to people. */
const LANA_CHAT_MODELS = Object.freeze([
  Object.freeze({ id: 'qwen3.5-35b-a3b-q4km', name: 'Qwen3.5 35B' }),
  Object.freeze({ id: 'qwen3.5-9b-q4', name: 'Qwen3.5 9B' }),
  Object.freeze({ id: 'qwen3.5-4b-q4', name: 'Qwen3.5 4B' }),
  Object.freeze({ id: 'qwen3-1.7b-q4km', name: 'Qwen3 1.7B' }),
  Object.freeze({ id: 'qwen3.5-0.8b-q4', name: 'Qwen3.5 0.8B' })
]);

/**
 * The built-in copy: the published entries for LANA's models as of 2026-11-09, plus the
 * Qwen3.5 4B, which is not on the bucket yet. Its files are lmstudio-community's (the same
 * publisher as our 9B, whose file matches byte for byte), checked on Pip 3.0.0 on 2026-11-09:
 * it answers, reads images, and its conversation memory is 594.2 MiB per conversation at
 * 32768 tokens, which the Qwen3.5 estimate in local-ai-fit.model.js predicts.
 */
const BUILT_IN = Object.freeze({
  schemaVersion: 1,
  models: [
    { id: 'qwen3.5-35b-a3b-q4km', role: 'main', family: 'qwen3.5', filename: 'Qwen3.5-35B-A3B-Q4_K_M.gguf', sizeBytes: 21169116992, contextWindow: 32768, sha256: 'f25d609171b8f80950a60f38696597f74025de4070682d2fb1eeffe306ca7d5d' },
    { id: 'qwen3.5-9b-q4', role: 'main', family: 'qwen3.5', filename: 'Qwen3.5-9B-Q4_K_M.gguf', sizeBytes: 5627044256, contextWindow: 32768, sha256: 'cd76ec205963b3b33350093e6904d9de16c4e666fd104e1f632d25c7f15f2a13' },
    { id: 'qwen3.5-4b-q4', role: 'main', family: 'qwen3.5', filename: 'Qwen3.5-4B-Q4_K_M.gguf', sizeBytes: 2707513696, contextWindow: 32768, sha256: '25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c' },
    { id: 'qwen3-1.7b-q4km', role: 'main', family: 'qwen3', filename: 'Qwen3-1.7B-Q4_K_M.gguf', sizeBytes: 1282439264, contextWindow: 32768, sha256: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5' },
    { id: 'qwen3.5-0.8b-q4', role: 'main', family: 'qwen3.5', filename: 'Qwen3.5-0.8B-Q4_K_M.gguf', sizeBytes: 527502816, contextWindow: 32768, sha256: 'f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec' },
    { id: 'mmproj-qwen3.5-35b-a3b', role: 'projector', family: 'qwen3.5', filename: 'mmproj-Qwen3.5-35B-A3B-BF16.gguf', sizeBytes: 902822592, pairsWith: 'qwen3.5-35b-a3b-q4km', sha256: 'abe81a7212be307a7723ab47a51a87e5c46d0622273ccb04a6a6feba18b21d63' },
    { id: 'mmproj-qwen3.5-9b', role: 'projector', family: 'qwen3.5', filename: 'mmproj-Qwen3.5-9B-BF16.gguf', sizeBytes: 921705024, pairsWith: 'qwen3.5-9b-q4', sha256: '853698ce7aa6c7ba732478bad280240969ddf7b0fcbf93900046f63903a83383' },
    { id: 'mmproj-qwen3.5-4b', role: 'projector', family: 'qwen3.5', filename: 'mmproj-Qwen3.5-4B-BF16.gguf', sizeBytes: 675568768, pairsWith: 'qwen3.5-4b-q4', sha256: 'ae08d9d7eceb8f2d0672d61b5e6aa78b611f2942b55ed71d21414980cc454b91' },
    { id: 'mmproj-qwen3.5-0.8b', role: 'projector', family: 'qwen3.5', filename: 'mmproj-Qwen3.5-0.8B-BF16.gguf', sizeBytes: 207346528, pairsWith: 'qwen3.5-0.8b-q4', sha256: 'd312c4d02fd46eea7a16e4f3bbb58840e6222209322ca1e33ca03247ad8935d6' }
  ]
});

const CHAT_ROLES = new Set(['main', 'text', 'chat']);
const VISION_ROLES = new Set(['projector', 'vision', 'mmproj']);

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function bareGguf(filename) {
  return typeof filename === 'string' && filename === path.basename(filename) && /\.gguf$/i.test(filename);
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function prefix(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.trim()) ? value.trim() : 'llm';
}

/** One published row as a LANA entry, or null when it is not one LANA offers or is malformed. */
function entryFrom(raw, chatIds, names) {
  if (!raw || typeof raw !== 'object') {return null;}
  const role = String(raw.role || '').trim().toLowerCase();
  const kind = CHAT_ROLES.has(role) ? 'chat' : VISION_ROLES.has(role) ? 'vision' : null;
  if (!kind || typeof raw.id !== 'string') {return null;}
  if (kind === 'chat' && !chatIds.has(raw.id)) {return null;}
  if (kind === 'vision' && !chatIds.has(raw.pairsWith)) {return null;}
  const digest = sha256(raw.sha256);
  if (!digest || !bareGguf(raw.filename) || !positive(raw.sizeBytes)) {return null;}
  if (kind === 'chat' && !positive(raw.contextWindow)) {return null;}
  return Object.freeze({
    id: raw.id,
    kind,
    name: kind === 'chat' ? names.get(raw.id) : `Image reading for ${names.get(raw.pairsWith)}`,
    family: String(raw.family || '').trim().toLowerCase(),
    filename: raw.filename,
    // Always our bucket, never wherever a row points.
    url: `https://${MODELS_HOST}/${prefix(raw.prefix)}/${raw.filename}`,
    sizeBytes: raw.sizeBytes,
    sha256: digest,
    contextWindow: kind === 'chat' ? raw.contextWindow : null,
    pairsWith: kind === 'vision' ? raw.pairsWith : null
  });
}

/**
 * The LANA entries in a published catalog document, or null when the document is not
 * a schema 1 catalog with at least one LANA chat model.
 * @returns {{ chat: Object[], vision: Object[] } | null}
 */
function parseCatalog(doc, chatModels = LANA_CHAT_MODELS) {
  if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 1 || !Array.isArray(doc.models)) {return null;}
  const chatIds = new Set(chatModels.map((model) => model.id));
  const names = new Map(chatModels.map((model) => [model.id, model.name]));
  const order = new Map(chatModels.map((model, index) => [model.id, index]));
  const chat = [];
  const vision = [];
  const seen = new Set();
  for (const raw of doc.models) {
    const entry = entryFrom(raw, chatIds, names);
    if (!entry || seen.has(entry.id)) {continue;}
    seen.add(entry.id);
    (entry.kind === 'chat' ? chat : vision).push(entry);
  }
  if (!chat.length) {return null;}
  chat.sort((a, b) => order.get(a.id) - order.get(b.id));
  return { chat, vision: vision.filter((entry) => chat.some((model) => model.id === entry.pairsWith)) };
}

async function fetchPublished(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {throw new Error(`HTTP ${response.status}`);}
  return response.json();
}

/**
 * The catalog to offer: the published one (saved for next time), else the saved copy,
 * else the built-in one.
 * @param {Object} options
 * @param {string} options.cacheFile - where the last good published copy is kept
 * @param {Object} [deps] - { fetchImpl, env, fsImpl } for tests
 * @returns {Promise<{ chat: Object[], vision: Object[], source: 'published'|'saved'|'built_in' }>}
 */
async function loadModelCatalog({ cacheFile }, { fetchImpl = (...args) => fetch(...args), env = process.env, fsImpl = fs } = {}) {
  const url = (env.LANA_MODEL_CATALOG_URL || '').trim() || PUBLISHED_URL;
  try {
    const doc = await fetchPublished(url, fetchImpl);
    const parsed = parseCatalog(doc);
    if (parsed) {
      try {
        await fsImpl.promises.mkdir(path.dirname(cacheFile), { recursive: true });
        await fsImpl.promises.writeFile(cacheFile, JSON.stringify(doc));
      } catch (_error) { /* a copy we cannot save is still a good copy to use now */ }
      return { ...parsed, source: 'published' };
    }
  } catch (_error) { /* offline or refused: fall through */ }
  try {
    const parsed = parseCatalog(JSON.parse(await fsImpl.promises.readFile(cacheFile, 'utf8')));
    if (parsed) {return { ...parsed, source: 'saved' };}
  } catch (_error) { /* no saved copy */ }
  return { ...parseCatalog(BUILT_IN), source: 'built_in' };
}

module.exports = { PUBLISHED_URL, LANA_CHAT_MODELS, BUILT_IN, parseCatalog, loadModelCatalog };

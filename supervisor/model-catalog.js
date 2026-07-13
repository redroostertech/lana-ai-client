/**
 * model-catalog.js
 *
 * Tier -> chat-model download entry, plus the shared embed-model entry, for
 * model-downloader.js. Filenames mirror model-selector.js's TIER_LADDER
 * (which itself mirrors LANA-AI infra/lib/storage/models.js
 * TIER_REQUIRED_MODEL_FILES) -- imported rather than duplicated so the two
 * never drift.
 *
 * url/sha256/sizeBytes are PLACEHOLDERS (marked TODO_REAL_RELEASE below).
 * The url fields point at the same HuggingFace mirrors the deploy-time
 * `LANA-AI/scripts/download-llamacpp-models.sh` bash script already uses, so
 * they are plausible real sources -- but nobody has pinned a sha256 against
 * the exact bytes those mirrors serve today, and mirrors can republish a
 * quantization under the same filename. Shipping with an unverified sha256
 * would silently defeat the whole point of the downloader's integrity check.
 * So sha256 (and sizeBytes) stay as obvious placeholders that
 * validateCatalogEntry() REJECTS, forcing a real release to compute and pin
 * the actual digest before `ensureModel()` will accept the entry. This
 * mirrors the retired lana-gpt catalog's validateManifest() safety net.
 */
'use strict';

const { TIER_LADDER, EMBED_MODEL_FILE } = require('./model-selector');

const TODO_SHA256 = 'TODO_REAL_RELEASE_SHA256'; // not 64 hex chars -> fails validation on purpose
const TODO_SIZE = 0; // not a positive integer -> fails validation on purpose

// HuggingFace resolve URLs, matching LANA-AI/scripts/download-llamacpp-models.sh.
const CHAT_MODEL_SOURCES = Object.freeze({
  demo: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
  edge: 'https://huggingface.co/lmstudio-community/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
  professional: 'https://huggingface.co/lmstudio-community/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf',
  enterprise: 'https://huggingface.co/lmstudio-community/Qwen3.5-122B-A10B-GGUF/resolve/main/Qwen3.5-122B-A10B-Q4_K_M.gguf',
});

const EMBED_MODEL_URL = 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.f16.gguf';

function buildCatalog() {
  const catalog = {};
  for (const entry of TIER_LADDER) {
    catalog[entry.tier] = {
      chatModel: {
        file: entry.chatModelFile,
        url: CHAT_MODEL_SOURCES[entry.tier] || null,
        sha256: TODO_SHA256,
        sizeBytes: TODO_SIZE,
      },
    };
  }
  return catalog;
}

const MODEL_CATALOG = Object.freeze(buildCatalog());

const EMBED_MODEL = Object.freeze({
  file: EMBED_MODEL_FILE,
  url: EMBED_MODEL_URL,
  sha256: TODO_SHA256,
  sizeBytes: TODO_SIZE,
});

/**
 * @param {string} tier
 * @returns {{file: string, url: string|null, sha256: string, sizeBytes: number}}
 */
function resolveChatModel(tier) {
  const entry = MODEL_CATALOG[tier];
  if (!entry) throw new Error(`model-catalog: unknown tier "${tier}"`);
  return entry.chatModel;
}

const HEX64 = /^[a-f0-9]{64}$/i;
const ALL_ZERO_HEX = /^0+$/;

/**
 * Reject a catalog entry that is unsafe to hand to the downloader:
 *   - missing/placeholder sha256 (must be a real, non-all-zero 64-hex digest)
 *   - non-https url (never fetch model weights over plaintext)
 *   - file name containing a path separator or '..' (no path traversal
 *     outside modelsDir via a poisoned filename)
 *   - sizeBytes that isn't a positive integer
 *
 * Throws with a descriptive message; returns true when the entry is safe.
 * A real release must fill in every placeholder before ensureModel() will
 * touch the network for that entry.
 *
 * @param {{file:string, url:string, sha256:string, sizeBytes:number}} entry
 * @returns {true}
 */
function validateCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('model-catalog: entry is required');
  }
  const { file, url, sha256, sizeBytes } = entry;

  if (!file || typeof file !== 'string') {
    throw new Error('model-catalog: entry.file is required');
  }
  if (file.includes('..') || file.includes('/') || file.includes('\\')) {
    throw new Error(`model-catalog: entry.file "${file}" looks like a path (traversal risk), expected a bare filename`);
  }

  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error(`model-catalog: entry.url must be an https:// URL, got "${url}"`);
  }

  if (!sha256 || typeof sha256 !== 'string' || !HEX64.test(sha256) || ALL_ZERO_HEX.test(sha256)) {
    throw new Error(
      `model-catalog: entry.sha256 for "${file}" is a placeholder or invalid (must be a real 64-char hex sha256); `
      + 'fill in the real digest before release',
    );
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`model-catalog: entry.sizeBytes for "${file}" must be a positive integer; fill in the real size before release`);
  }

  return true;
}

module.exports = {
  MODEL_CATALOG,
  EMBED_MODEL,
  resolveChatModel,
  validateCatalogEntry,
};

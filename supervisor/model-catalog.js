/**
 * model-catalog.js
 *
 * Tier -> chat-model download entry, plus the shared embed-model entry, for
 * model-downloader.js. Filenames mirror model-selector.js's TIER_LADDER
 * (which itself mirrors LANA-AI infra/lib/storage/models.js
 * TIER_REQUIRED_MODEL_FILES) -- imported rather than duplicated so the two
 * never drift.
 *
 * sha256 + sizeBytes are PINNED to the exact bytes HuggingFace serves today
 * (fetched via the git-LFS pointer, 2026-07-13). ensureModel() verifies the
 * download against these, so a republished/corrupted file is rejected. The
 * ENTERPRISE tier (Qwen3.5-122B-A10B) is the exception: that file does not
 * exist at the expected HF path, so it stays a TODO placeholder that
 * validateCatalogEntry() REJECTS -> those (vanishingly rare, 256GB) machines
 * route chat to the relay until a real large model is pinned.
 */
'use strict';

const { TIER_LADDER, EMBED_MODEL_FILE } = require('./model-selector');

const TODO_SHA256 = 'TODO_REAL_RELEASE_SHA256'; // not 64 hex chars -> fails validation on purpose
const TODO_SIZE = 0; // not a positive integer -> fails validation on purpose

// Real HuggingFace sources + pinned digests (LFS pointer, 2026-07-13). Filenames
// mirror model-selector.js TIER_LADDER. demo=ggml-org, edge/professional=lmstudio-community.
const CHAT_MODELS = Object.freeze({
  demo: {
    url: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
    sha256: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5',
    sizeBytes: 1282439264,
  },
  edge: {
    url: 'https://huggingface.co/lmstudio-community/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf',
    sha256: 'cd76ec205963b3b33350093e6904d9de16c4e666fd104e1f632d25c7f15f2a13',
    sizeBytes: 5627044256,
  },
  professional: {
    url: 'https://huggingface.co/lmstudio-community/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-Q4_K_M.gguf',
    sha256: 'f25d609171b8f80950a60f38696597f74025de4070682d2fb1eeffe306ca7d5d',
    sizeBytes: 21169116992,
  },
  // TODO(enterprise): Qwen3.5-122B-A10B-Q4_K_M.gguf is not published at the expected
  // HF path. Pin a real large model here (or drop the enterprise tier). Rejects -> relay.
  enterprise: {
    url: 'https://huggingface.co/lmstudio-community/Qwen3.5-122B-A10B-GGUF/resolve/main/Qwen3.5-122B-A10B-Q4_K_M.gguf',
    sha256: TODO_SHA256,
    sizeBytes: TODO_SIZE,
  },
});

// Embedding model — always local, bundled in the dmg. Pinned digest.
const EMBED_MODEL_URL = 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.f16.gguf';
const EMBED_MODEL_SHA256 = 'f7af6f66802f4df86eda10fe9bbcfc75c39562bed48ef6ace719a251cf1c2fdb';
const EMBED_MODEL_SIZE = 274290560;

function buildCatalog() {
  const catalog = {};
  for (const entry of TIER_LADDER) {
    const src = CHAT_MODELS[entry.tier] || { url: null, sha256: TODO_SHA256, sizeBytes: TODO_SIZE };
    catalog[entry.tier] = {
      chatModel: { file: entry.chatModelFile, url: src.url, sha256: src.sha256, sizeBytes: src.sizeBytes },
    };
  }
  return catalog;
}

const MODEL_CATALOG = Object.freeze(buildCatalog());

const EMBED_MODEL = Object.freeze({
  file: EMBED_MODEL_FILE,
  url: EMBED_MODEL_URL,
  sha256: EMBED_MODEL_SHA256,
  sizeBytes: EMBED_MODEL_SIZE,
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

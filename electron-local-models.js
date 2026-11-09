'use strict';

/**
 * The laptop's local model catalog (main process): every model this app may
 * download, pinned to our Cloudflare R2 bucket (models.lanaai.io) with its
 * exact size and sha256. Never Hugging Face. CATALOG holds the local AI
 * engine's models; SPEECH_CATALOG holds LANA Briefs' speech models, which
 * Briefs downloads and checks itself (multi-file packages, resumable).
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

// LANA Briefs' speech models (Briefs integration plan, 1d): voice detection, speech to text,
// the LANA voice and the two speaker models that tell voices apart. Each package is a few
// files, each pinned to its size and sha256 on the same R2 bucket. Briefs downloads them on
// request (Settings), resuming cut-off files, and counts a package installed only after
// every file was checked. The license and notice files ship with each package.
const R2_SPEECH = 'https://models.lanaai.io/briefs/speech';

const SPEECH_CATALOG = Object.freeze([
  Object.freeze({
    id: 'vad',
    role: 'speech',
    name: 'Silero voice detection',
    license: 'MIT',
    // The file, or the folder its files live in, under the speech models folder.
    target: 'silero_vad.onnx',
    files: Object.freeze([
      Object.freeze({ path: 'silero_vad.onnx', url: `${R2_SPEECH}/vad/0378b3d5908a/silero_vad.onnx`, sizeBytes: 643854, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' })
    ]),
    notices: Object.freeze([
      Object.freeze({ path: 'LICENSE', url: `${R2_SPEECH}/vad/0378b3d5908a/LICENSE`, sizeBytes: 1075, sha256: '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b' }),
      Object.freeze({ path: 'NOTICE', url: `${R2_SPEECH}/vad/0378b3d5908a/NOTICE`, sizeBytes: 412, sha256: '93079236dd4df3bac5f20f397d0ebdc61d8b3e24447da9a4388c2f92c0145993' })
    ])
  }),
  Object.freeze({
    id: 'parakeet',
    role: 'speech',
    name: 'Parakeet TDT 0.6B v2 (int8), speech to text',
    license: 'CC-BY-4.0',
    // The file, or the folder its files live in, under the speech models folder.
    target: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    files: Object.freeze([
      Object.freeze({ path: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/encoder.int8.onnx', url: `${R2_SPEECH}/parakeet/dcc86a12d22a/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/encoder.int8.onnx`, sizeBytes: 652184296, sha256: 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab' }),
      Object.freeze({ path: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/decoder.int8.onnx', url: `${R2_SPEECH}/parakeet/dcc86a12d22a/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/decoder.int8.onnx`, sizeBytes: 7257753, sha256: 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e' }),
      Object.freeze({ path: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/joiner.int8.onnx', url: `${R2_SPEECH}/parakeet/dcc86a12d22a/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/joiner.int8.onnx`, sizeBytes: 1739080, sha256: '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2' }),
      Object.freeze({ path: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/tokens.txt', url: `${R2_SPEECH}/parakeet/dcc86a12d22a/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/tokens.txt`, sizeBytes: 9384, sha256: 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d' })
    ]),
    notices: Object.freeze([
      Object.freeze({ path: 'LICENSE', url: `${R2_SPEECH}/parakeet/dcc86a12d22a/LICENSE`, sizeBytes: 18657, sha256: '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411' }),
      Object.freeze({ path: 'NOTICE', url: `${R2_SPEECH}/parakeet/dcc86a12d22a/NOTICE`, sizeBytes: 548, sha256: '8273c0e17474bd035a0d0f18bfd62f82b082a8260e7bbd4574c2372f4afe6b98' })
    ])
  }),
  Object.freeze({
    id: 'kokoro',
    role: 'speech',
    name: 'Kokoro multi-lang v1.0, the LANA voice',
    license: 'Apache-2.0',
    // The file, or the folder its files live in, under the speech models folder.
    target: 'kokoro-multi-lang-v1_0',
    files: Object.freeze([
      Object.freeze({ path: 'kokoro-multi-lang-v1_0/model.onnx', url: `${R2_SPEECH}/kokoro/588191e33c63/kokoro-multi-lang-v1_0/model.onnx`, sizeBytes: 325560556, sha256: 'b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11' }),
      Object.freeze({ path: 'kokoro-multi-lang-v1_0/voices.bin', url: `${R2_SPEECH}/kokoro/588191e33c63/kokoro-multi-lang-v1_0/voices.bin`, sizeBytes: 28200960, sha256: '1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29' }),
      Object.freeze({ path: 'kokoro-multi-lang-v1_0/tokens.txt', url: `${R2_SPEECH}/kokoro/588191e33c63/kokoro-multi-lang-v1_0/tokens.txt`, sizeBytes: 687, sha256: '6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425' }),
      Object.freeze({ path: 'kokoro-multi-lang-v1_0/lexicon-us-en.txt', url: `${R2_SPEECH}/kokoro/588191e33c63/kokoro-multi-lang-v1_0/lexicon-us-en.txt`, sizeBytes: 5956885, sha256: '7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14' })
    ]),
    notices: Object.freeze([
      Object.freeze({ path: 'LICENSE', url: `${R2_SPEECH}/kokoro/588191e33c63/LICENSE`, sizeBytes: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' }),
      Object.freeze({ path: 'NOTICE', url: `${R2_SPEECH}/kokoro/588191e33c63/NOTICE`, sizeBytes: 450, sha256: '6f8f49d388c794ed021d9bc24cba76a7f9fe5da8b4fd3cd07cd461d57947da8a' })
    ])
  }),
  Object.freeze({
    id: 'segmentation',
    role: 'speech',
    name: 'Pyannote segmentation 3.0, who spoke when',
    license: 'MIT',
    // The file, or the folder its files live in, under the speech models folder.
    target: 'sherpa-onnx-pyannote-segmentation-3-0',
    files: Object.freeze([
      Object.freeze({ path: 'sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx', url: `${R2_SPEECH}/segmentation/4950cd3c5fce/sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx`, sizeBytes: 1540506, sha256: 'd582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d' })
    ]),
    notices: Object.freeze([
      Object.freeze({ path: 'LICENSE', url: `${R2_SPEECH}/segmentation/4950cd3c5fce/LICENSE`, sizeBytes: 1061, sha256: '14d7016ad68e7394d6e6b78d96cc2ae431c905287b89674cfdf021e79e62b8ba' }),
      Object.freeze({ path: 'NOTICE', url: `${R2_SPEECH}/segmentation/4950cd3c5fce/NOTICE`, sizeBytes: 475, sha256: '01b3c2e18699e957199f6d4c642594381b60034f2c5ff0905b53715d90bd7d3f' })
    ])
  }),
  Object.freeze({
    id: 'embedding',
    role: 'speech',
    name: 'TitaNet small, telling speakers apart',
    license: 'Apache-2.0',
    // The file, or the folder its files live in, under the speech models folder.
    target: 'nemo_en_titanet_small.onnx',
    files: Object.freeze([
      Object.freeze({ path: 'nemo_en_titanet_small.onnx', url: `${R2_SPEECH}/embedding/f0f4efe722bb/nemo_en_titanet_small.onnx`, sizeBytes: 40257283, sha256: 'ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e' })
    ]),
    notices: Object.freeze([
      Object.freeze({ path: 'LICENSE', url: `${R2_SPEECH}/embedding/f0f4efe722bb/LICENSE`, sizeBytes: 11357, sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4' }),
      Object.freeze({ path: 'NOTICE', url: `${R2_SPEECH}/embedding/f0f4efe722bb/NOTICE`, sizeBytes: 518, sha256: '360be2111a3f85ee82413d238ba09270d966386d1e9649a763a7ff09bb89a238' })
    ])
  })
]);

/** The speech packages in the shape Briefs' speech store takes: paths, URLs, sizes and checksums. */
function speechPackages(catalog = SPEECH_CATALOG) {
  return catalog.map((entry) => ({
    id: entry.id,
    target: entry.target,
    files: entry.files.map((file) => ({ path: file.path, url: file.url, bytes: file.sizeBytes, sha256: file.sha256 }))
  }));
}

// Which packages each Briefs feature needs (briefs/packages/core/src/model/speechModels.ts
// SPEECH_GROUPS): listening for Talk, the voice, and meeting transcription.
const SPEECH_FEATURES = Object.freeze({
  listener: Object.freeze(['vad', 'parakeet']),
  voice: Object.freeze(['kokoro']),
  transcription: Object.freeze(['vad', 'parakeet', 'segmentation', 'embedding'])
});

// Peak memory while Briefs speech runs, measured 2026-11-09 with sherpa-onnx on Apple silicon
// (models loaded and run as Briefs configures them): meeting transcription with speaker labels
// 1.26 GB, Talk listening plus speaking 1.34 GB. Rounded up. Measure again when the engine changes.
const SPEECH_MEMORY_BYTES = Math.round(1.4 * 1024 ** 3);

/** Bytes on disk for each Briefs feature and memory while speech runs, for sizing (src/js/local-ai-fit.model.js). */
function speechSizes(catalog = SPEECH_CATALOG) {
  const bytes = (ids) => catalog
    .filter((entry) => ids.includes(entry.id))
    .reduce((total, entry) => total + entry.files.reduce((sum, file) => sum + file.sizeBytes, 0), 0);
  return {
    listenerBytes: bytes(SPEECH_FEATURES.listener),
    voiceBytes: bytes(SPEECH_FEATURES.voice),
    transcriptionBytes: bytes(SPEECH_FEATURES.transcription),
    memoryBytes: SPEECH_MEMORY_BYTES
  };
}

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

module.exports = { CATALOG, SPEECH_CATALOG, SPEECH_FEATURES, speechPackages, speechSizes, embeddingModel, modelsDir, isInstalled, downloadModel, sha256OfFile };

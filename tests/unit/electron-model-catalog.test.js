/**
 * The chat and vision models LANA offers (electron-model-catalog.js): the published Pip catalog
 * cut down to LANA's models, the last good copy saved for next time, and the built-in copy when
 * there is neither.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { BUILT_IN, LANA_CHAT_MODELS, parseCatalog, loadModelCatalog } = require('../../electron-model-catalog');

const SHA = 'a'.repeat(64);
const row = (over = {}) => ({ id: 'qwen3.5-9b-q4', role: 'main', family: 'qwen3.5', filename: 'Qwen3.5-9B-Q4_K_M.gguf', sizeBytes: 5627044256, contextWindow: 32768, sha256: SHA, ...over });
const doc = (models) => ({ schemaVersion: 1, models });

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-catalog-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('parseCatalog', () => {
  test('the built-in copy has every LANA chat model, largest first, and their vision files', () => {
    const parsed = parseCatalog(BUILT_IN);
    expect(parsed.chat.map((m) => m.id)).toEqual(LANA_CHAT_MODELS.map((m) => m.id));
    expect(parsed.vision.map((v) => v.pairsWith).sort()).toEqual(['qwen3.5-0.8b-q4', 'qwen3.5-35b-a3b-q4km', 'qwen3.5-4b-q4', 'qwen3.5-9b-q4']);
    for (const entry of [...parsed.chat, ...parsed.vision]) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.url).toBe(`https://models.lanaai.io/llm/${entry.filename}`);
    }
  });

  test('only LANA chat models and their vision files are kept: not embedding, speech, drafts or other chat models', () => {
    const parsed = parseCatalog(doc([
      row(),
      row({ id: 'saullm-7b-instruct-q4km', family: 'saullm', filename: 'SaulLM.gguf' }),
      row({ id: 'nomic-embed-text-v1.5', role: 'embedding', filename: 'nomic.gguf' }),
      row({ id: 'qwen3.5-0.8b-draft', role: 'draft', filename: 'draft.gguf' }),
      row({ id: 'qwen3-asr-0.6b', role: 'stt', filename: 'asr.gguf', contextWindow: null }),
      row({ id: 'mmproj-qwen3.5-9b', role: 'projector', filename: 'mmproj-9b.gguf', pairsWith: 'qwen3.5-9b-q4' }),
      row({ id: 'mmproj-qwythos', role: 'projector', filename: 'mmproj-q.gguf', pairsWith: 'qwythos-9b-v2-q4km' })
    ]));
    expect(parsed.chat.map((m) => m.id)).toEqual(['qwen3.5-9b-q4']);
    expect(parsed.vision.map((v) => v.id)).toEqual(['mmproj-qwen3.5-9b']);
    expect(parsed.chat[0].name).toBe('Qwen3.5 9B');
    expect(parsed.vision[0].name).toBe('Image reading for Qwen3.5 9B');
  });

  test.each([
    ['a short checksum', { sha256: 'abc' }],
    ['a path instead of a file name', { filename: '../evil.gguf' }],
    ['a file that is not a model', { filename: 'Qwen.bin' }],
    ['no size', { sizeBytes: 0 }],
    ['no context window', { contextWindow: null }]
  ])('a row with %s is dropped', (_label, over) => {
    expect(parseCatalog(doc([row(over)]))).toBeNull();
  });

  test('downloads always come from our bucket, whatever a row says', () => {
    const parsed = parseCatalog(doc([row({ downloadUrl: 'https://evil.example/x.gguf', prefix: '../x' })]));
    expect(parsed.chat[0].url).toBe('https://models.lanaai.io/llm/Qwen3.5-9B-Q4_K_M.gguf');
  });

  test('a document that is not a schema 1 catalog is refused', () => {
    expect(parseCatalog(null)).toBeNull();
    expect(parseCatalog({ schemaVersion: 2, models: [row()] })).toBeNull();
    expect(parseCatalog(doc([]))).toBeNull();
  });
});

describe('loadModelCatalog', () => {
  const answers = (body) => jest.fn(async () => ({ ok: true, json: async () => body }));
  const offline = () => jest.fn(async () => { throw new Error('ENOTFOUND'); });

  test('uses the published catalog and saves it for next time', async () => {
    const cacheFile = path.join(dir, 'nested', 'catalog.json');
    const fetchImpl = answers(doc([row()]));
    const result = await loadModelCatalog({ cacheFile }, { fetchImpl, env: {} });
    expect(fetchImpl).toHaveBeenCalledWith('https://models.lanaai.io/llm/catalog.json', expect.any(Object));
    expect(result.source).toBe('published');
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toEqual(doc([row()]));
  });

  test('offline: the saved copy, then the built-in copy', async () => {
    const cacheFile = path.join(dir, 'catalog.json');
    expect((await loadModelCatalog({ cacheFile }, { fetchImpl: offline(), env: {} })).source).toBe('built_in');
    fs.writeFileSync(cacheFile, JSON.stringify(doc([row()])));
    const saved = await loadModelCatalog({ cacheFile }, { fetchImpl: offline(), env: {} });
    expect(saved.source).toBe('saved');
    expect(saved.chat.map((m) => m.id)).toEqual(['qwen3.5-9b-q4']);
  });

  test('a published document LANA cannot use falls back and is not saved', async () => {
    const cacheFile = path.join(dir, 'catalog.json');
    const result = await loadModelCatalog({ cacheFile }, { fetchImpl: answers({ schemaVersion: 9 }), env: {} });
    expect(result.source).toBe('built_in');
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  test('LANA_MODEL_CATALOG_URL points it elsewhere (staging)', async () => {
    const fetchImpl = answers(doc([row()]));
    await loadModelCatalog({ cacheFile: path.join(dir, 'c.json') }, { fetchImpl, env: { LANA_MODEL_CATALOG_URL: 'https://staging.example/catalog.json' } });
    expect(fetchImpl).toHaveBeenCalledWith('https://staging.example/catalog.json', expect.any(Object));
  });
});

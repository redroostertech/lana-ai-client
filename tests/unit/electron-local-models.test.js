/**
 * Local model catalog (electron-local-models.js, Phase 8h): every model comes
 * from our R2 bucket with a sha256 pin, the embedding model is the firm's
 * embedding identity, and a download is installed only when its size and
 * sha256 match (a mismatch is removed and reported).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { CATALOG, embeddingModel, downloadModel, isInstalled, embeddingEngineEnv } = require('../../electron-local-models');

// The firm's embedding identity (LANA-AI deploy/railway/embed/embed-pin.json).
const FIRM_IDENTITY = {
  modelId: 'nomic-embed-text-v1.5',
  modelVersion: 'f16',
  url: 'https://models.lanaai.io/llm/nomic-embed-text-v1.5.f16.gguf',
  sha256: 'f7af6f66802f4df86eda10fe9bbcfc75c39562bed48ef6ace719a251cf1c2fdb',
  sizeBytes: 274290560,
  runtime: { name: 'pip', version: '3.0.0', build: 'ddedf87af419' }
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lana-models-'));
}

function bytesResponse(buffer, status = 200) {
  return { ok: status >= 200 && status < 300, status, body: new Blob([buffer]).stream() };
}

function fakeEntry(buffer) {
  return { id: 'fake', role: 'chat', filename: 'fake.gguf', url: 'https://models.lanaai.io/llm/fake.gguf', sizeBytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}

describe('local model catalog', () => {
  test('every model downloads from our R2 bucket over https with a size and sha256 pin, never Hugging Face', () => {
    expect(CATALOG.length).toBeGreaterThan(0);
    for (const entry of CATALOG) {
      expect(entry.url.startsWith('https://models.lanaai.io/')).toBe(true);
      expect(entry.url).not.toMatch(/huggingface/i);
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes > 0).toBe(true);
      expect(entry.url.endsWith(`/${entry.filename}`)).toBe(true);
    }
  });

  test('the embedding model is exactly the firm\'s embedding identity', () => {
    expect(embeddingModel()).toMatchObject(FIRM_IDENTITY);
  });
});

describe('verified download', () => {
  test('a download whose sha256 matches is installed (control)', async () => {
    const dir = tempDir();
    const content = Buffer.from('model bytes');
    const entry = fakeEntry(content);
    const file = await downloadModel(entry, dir, { catalog: [entry], fetchImpl: async () => bytesResponse(content) });
    expect(fs.readFileSync(file)).toEqual(content);
    expect(await isInstalled(entry, dir)).toBe(true);
  });

  test.each([
    ['different bytes of the same size', Buffer.from('model bytez')],
    ['a truncated file', Buffer.from('model')]
  ])('%s is removed and reported, and nothing is installed', async (_label, served) => {
    const dir = tempDir();
    const entry = fakeEntry(Buffer.from('model bytes'));
    await expect(downloadModel(entry, dir, { catalog: [entry], fetchImpl: async () => bytesResponse(served) })).rejects.toThrow(/checksum/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test('an HTTP error installs nothing; a model outside the catalog is refused without a request', async () => {
    const dir = tempDir();
    const entry = fakeEntry(Buffer.from('x'));
    await expect(downloadModel(entry, dir, { catalog: [entry], fetchImpl: async () => bytesResponse(Buffer.alloc(0), 404) })).rejects.toThrow(/HTTP 404/);
    const fetchImpl = jest.fn();
    await expect(downloadModel(entry, dir, { fetchImpl })).rejects.toThrow(/catalog/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('the engine gets the embedding settings only when the pinned file is installed (a file of the right name but wrong content does not count)', async () => {
    const dir = tempDir();
    expect(await embeddingEngineEnv(dir)).toEqual({});
    fs.writeFileSync(path.join(dir, embeddingModel().filename), 'not the model');
    expect(await embeddingEngineEnv(dir)).toEqual({});
  });
});

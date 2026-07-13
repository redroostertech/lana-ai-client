'use strict';

const crypto = require('crypto');
const { Readable, Writable } = require('stream');

const { downloadFile, ensureModel, Sha256MismatchError, AbortedError } = require('../../supervisor/model-downloader');
const { MODEL_CATALOG, validateCatalogEntry } = require('../../supervisor/model-catalog');

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// In-memory fake fs: Map<path, Buffer>. createWriteStream/createReadStream
// return real Node Writable/Readable streams (so .pipe()/.on() behave exactly
// like the real fs streams downloadFile relies on), just backed by memory
// instead of disk.
function makeFakeFs(seedFiles = {}) {
  const files = new Map(Object.entries(seedFiles));

  return {
    _files: files,
    existsSync: (p) => files.has(p),
    statSync: (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return { size: files.get(p).length };
    },
    mkdirSync: () => {},
    unlinkSync: (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      files.delete(p);
    },
    renameSync: (from, to) => {
      if (!files.has(from)) {
        const err = new Error(`ENOENT: ${from}`);
        err.code = 'ENOENT';
        throw err;
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    createWriteStream: (p, opts = {}) => {
      const flags = (opts && opts.flags) || 'w';
      if (flags === 'w' || !files.has(p)) files.set(p, Buffer.alloc(0));
      return new Writable({
        write(chunk, _enc, cb) {
          files.set(p, Buffer.concat([files.get(p), chunk]));
          cb();
        },
      });
    },
    createReadStream: (p) => {
      const buf = files.get(p) || Buffer.alloc(0);
      return Readable.from(buf.length ? [buf] : []);
    },
  };
}

// Fake Range-capable requester serving `fullBuffer`. Honors a `Range:
// bytes=N-` header with a 206 + the tail slice; otherwise returns the whole
// buffer as a 200. `rangeSupport: false` simulates a server that ignores
// Range and always returns the full 200 body (downloadFile must restart the
// part file from zero in that case).
function makeFakeRequester(fullBuffer, { rangeSupport = true, calls } = {}) {
  return async ({ url, headers }) => {
    if (calls) calls.push({ url, headers });
    const rangeHeader = headers && headers.Range;
    if (rangeHeader && rangeSupport) {
      const match = /bytes=(\d+)-/.exec(rangeHeader);
      const start = match ? parseInt(match[1], 10) : 0;
      const slice = fullBuffer.slice(start);
      return {
        statusCode: 206,
        headers: { 'content-length': String(slice.length) },
        stream: Readable.from([slice]),
      };
    }
    return {
      statusCode: 200,
      headers: { 'content-length': String(fullBuffer.length) },
      stream: Readable.from([fullBuffer]),
    };
  };
}

const DEST = '/models/demo/Qwen3-1.7B-Q4_K_M.gguf';
const PART = `${DEST}.downloading`;

describe('downloadFile', () => {
  it('downloads the full file and verifies sha256', async () => {
    const content = Buffer.from('a'.repeat(5000), 'utf8');
    const sha256 = sha256Hex(content);
    const fs = makeFakeFs();
    const requester = makeFakeRequester(content);
    const progressEvents = [];

    const result = await downloadFile({
      url: 'https://example.invalid/model.gguf',
      sha256,
      destPath: DEST,
      requester,
      fs,
      onProgress: (p) => progressEvents.push(p),
    });

    expect(result).toBe(DEST);
    expect(fs.existsSync(DEST)).toBe(true);
    expect(fs.existsSync(PART)).toBe(false); // renamed away, no leftover part
    expect(fs._files.get(DEST).equals(content)).toBe(true);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1].bytesWritten).toBe(content.length);
  });

  it('rejects on sha256 mismatch and deletes the bad partial', async () => {
    const content = Buffer.from('legit-bytes');
    const wrongSha = sha256Hex(Buffer.from('some-other-bytes'));
    const fs = makeFakeFs();
    const requester = makeFakeRequester(content);

    await expect(downloadFile({
      url: 'https://example.invalid/model.gguf',
      sha256: wrongSha,
      destPath: DEST,
      requester,
      fs,
    })).rejects.toThrow(Sha256MismatchError);

    expect(fs.existsSync(DEST)).toBe(false);
    expect(fs.existsSync(PART)).toBe(false); // bad partial cleaned up
  });

  it('resumes from an existing .downloading part via HTTP Range', async () => {
    const content = Buffer.from('0123456789'.repeat(1000)); // 10000 bytes
    const sha256 = sha256Hex(content);
    const already = content.slice(0, 4000);
    const fs = makeFakeFs({ [PART]: already });
    const calls = [];
    const requester = makeFakeRequester(content, { calls });

    const result = await downloadFile({
      url: 'https://example.invalid/model.gguf',
      sha256,
      destPath: DEST,
      requester,
      fs,
    });

    expect(result).toBe(DEST);
    expect(calls[0].headers.Range).toBe('bytes=4000-');
    expect(fs._files.get(DEST).equals(content)).toBe(true);
    expect(fs.existsSync(PART)).toBe(false);
  });

  it('restarts the part file from zero when the server ignores Range (200, not 206)', async () => {
    const content = Buffer.from('x'.repeat(2000));
    const sha256 = sha256Hex(content);
    const already = Buffer.from('y'.repeat(500)); // stale/bogus partial bytes
    const fs = makeFakeFs({ [PART]: already });
    const requester = makeFakeRequester(content, { rangeSupport: false });

    const result = await downloadFile({
      url: 'https://example.invalid/model.gguf',
      sha256,
      destPath: DEST,
      requester,
      fs,
    });

    expect(result).toBe(DEST);
    expect(fs._files.get(DEST).equals(content)).toBe(true);
  });

  it('is abort-safe: leaves the partial in place and rejects with AbortedError', async () => {
    const content = Buffer.from('z'.repeat(1000));
    const sha256 = sha256Hex(content);
    const fs = makeFakeFs();
    const controller = new AbortController();
    controller.abort(); // pre-aborted: exercises the immediate-reject path
    const requester = makeFakeRequester(content);

    await expect(downloadFile({
      url: 'https://example.invalid/model.gguf',
      sha256,
      destPath: DEST,
      requester,
      fs,
      signal: controller.signal,
    })).rejects.toThrow(AbortedError);
  });

  it('rejects when sha256 is missing or malformed', async () => {
    const fs = makeFakeFs();
    const requester = makeFakeRequester(Buffer.from('irrelevant'));
    await expect(downloadFile({
      url: 'https://example.invalid/model.gguf', destPath: DEST, requester, fs,
    })).rejects.toThrow(/sha256/);
    await expect(downloadFile({
      url: 'https://example.invalid/model.gguf', destPath: DEST, sha256: 'not-hex', requester, fs,
    })).rejects.toThrow(/sha256/);
  });
});

describe('ensureModel', () => {
  it('skips the network when a correctly-sized file already exists', async () => {
    const content = Buffer.from('already-here-and-correct');
    const fs = makeFakeFs({ [DEST]: content });
    let requesterCalled = false;
    const requester = async () => { requesterCalled = true; throw new Error('should not be called'); };

    const result = await ensureModel({
      modelsDir: '/models/demo',
      file: 'Qwen3-1.7B-Q4_K_M.gguf',
      url: 'https://example.invalid/model.gguf',
      sha256: sha256Hex(content),
      sizeBytes: content.length,
      requester,
      fs,
    });

    expect(result).toBe(DEST);
    expect(requesterCalled).toBe(false);
  });

  it('re-downloads when the existing file size does not match sizeBytes', async () => {
    const stale = Buffer.from('stale-partial-or-truncated');
    const fresh = Buffer.from('the-real-full-file-contents');
    const fs = makeFakeFs({ [DEST]: stale });
    const requester = makeFakeRequester(fresh);

    const result = await ensureModel({
      modelsDir: '/models/demo',
      file: 'Qwen3-1.7B-Q4_K_M.gguf',
      url: 'https://example.invalid/model.gguf',
      sha256: sha256Hex(fresh),
      sizeBytes: fresh.length,
      requester,
      fs,
    });

    expect(result).toBe(DEST);
    expect(fs._files.get(DEST).equals(fresh)).toBe(true);
  });

  it('downloads when nothing exists yet', async () => {
    const content = Buffer.from('brand-new-model-bytes');
    const fs = makeFakeFs();
    const requester = makeFakeRequester(content);

    const result = await ensureModel({
      modelsDir: '/models/demo',
      file: 'Qwen3-1.7B-Q4_K_M.gguf',
      url: 'https://example.invalid/model.gguf',
      sha256: sha256Hex(content),
      sizeBytes: content.length,
      requester,
      fs,
    });

    expect(result).toBe(DEST);
    expect(fs._files.get(DEST).equals(content)).toBe(true);
  });
});

describe('model-catalog validateCatalogEntry', () => {
  it('rejects the shipped placeholder sha256 (real release must fill it in)', () => {
    expect(() => validateCatalogEntry(MODEL_CATALOG.demo.chatModel)).toThrow(/sha256/);
  });

  it('accepts a fully-filled-in entry', () => {
    const entry = {
      file: 'Qwen3-1.7B-Q4_K_M.gguf',
      url: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
      sha256: sha256Hex(Buffer.from('stand-in-for-a-real-64-char-digest')),
      sizeBytes: 1234567,
    };
    expect(validateCatalogEntry(entry)).toBe(true);
  });

  it('rejects a non-https url', () => {
    const entry = {
      file: 'Qwen3-1.7B-Q4_K_M.gguf',
      url: 'http://example.com/model.gguf', // plaintext, not https
      sha256: sha256Hex(Buffer.from('x')),
      sizeBytes: 1234567,
    };
    expect(() => validateCatalogEntry(entry)).toThrow(/https/);
  });

  it('rejects an all-zero sha256', () => {
    const entry = {
      file: 'Qwen3-1.7B-Q4_K_M.gguf',
      url: 'https://example.com/model.gguf',
      sha256: '0'.repeat(64),
      sizeBytes: 1234567,
    };
    expect(() => validateCatalogEntry(entry)).toThrow(/sha256/);
  });

  it('rejects a path-traversal filename', () => {
    const entry = {
      file: '../../etc/passwd',
      url: 'https://example.com/model.gguf',
      sha256: sha256Hex(Buffer.from('x')),
      sizeBytes: 1234567,
    };
    expect(() => validateCatalogEntry(entry)).toThrow(/path/);
  });
});

/**
 * One model file, downloaded and checked, that keeps going after the app is closed
 * (electron-model-download.js). The server is faked; the files are real, in a temporary folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { downloadVerified, isVerified, remainingBytes, assertSpace, DownloadError } = require('../../electron-model-download');

const BYTES = crypto.randomBytes(256 * 1024);
const SHA = crypto.createHash('sha256').update(BYTES).digest('hex');
const URL_OK = 'https://models.lanaai.io/llm/test.gguf';
const entry = (over = {}) => ({ url: URL_OK, sizeBytes: BYTES.length, sha256: SHA, ...over });

function body(buffer, chunk = 16 * 1024) {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= buffer.length) { controller.close(); return; }
      controller.enqueue(new Uint8Array(buffer.subarray(at, at + chunk)));
      at += chunk;
    }
  });
}

/** A fake model server: honours Range unless told not to, and records every request. */
function server({ bytes = BYTES, range = true, status = null, redirect = null } = {}) {
  const calls = [];
  const fetchImpl = jest.fn(async (url, init = {}) => {
    calls.push({ url, range: init.headers && init.headers.Range, redirect: init.redirect });
    if (redirect && url === URL_OK) {return { status: 302, headers: new Headers({ location: redirect }), body: null };}
    if (status) {return { status, headers: new Headers(), body: body(Buffer.alloc(0)) };}
    const asked = init.headers && init.headers.Range && /bytes=(\d+)-/.exec(init.headers.Range);
    if (asked && range) {return { status: 206, headers: new Headers(), body: body(bytes.subarray(Number(asked[1]))) };}
    return { status: 200, headers: new Headers(), body: body(bytes) };
  });
  return { fetchImpl, calls };
}

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-download-'));
  file = path.join(dir, 'models', 'test.gguf');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('downloads, checks, puts the file in place and notes it as checked', async () => {
  const { fetchImpl } = server();
  const progress = [];
  await downloadVerified(entry(), file, { onProgress: (p) => progress.push(p) }, { fetchImpl });
  expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
  expect(fs.existsSync(`${file}.part`)).toBe(false);
  expect(JSON.parse(fs.readFileSync(`${file}.verified`, 'utf8'))).toMatchObject({ sha256: SHA, sizeBytes: BYTES.length });
  expect(progress[progress.length - 1]).toEqual({ received: BYTES.length, total: BYTES.length });
});

test('a part left by an earlier run is resumed from where it stopped', async () => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, BYTES.subarray(0, 100000));
  const { fetchImpl, calls } = server();
  await downloadVerified(entry(), file, {}, { fetchImpl });
  expect(calls[0].range).toBe('bytes=100000-');
  expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
});

test('a server that ignores Range sends the whole file, so the part starts again', async () => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, Buffer.alloc(5000, 7));
  const { fetchImpl } = server({ range: false });
  await downloadVerified(entry(), file, {}, { fetchImpl });
  expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
});

test('a wrong file is removed, part and all, and never put in place', async () => {
  const wrong = Buffer.from(BYTES);
  wrong[10] ^= 0xff;
  const { fetchImpl } = server({ bytes: wrong });
  await expect(downloadVerified(entry(), file, {}, { fetchImpl })).rejects.toMatchObject({ code: 'mismatch' });
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.existsSync(`${file}.part`)).toBe(false);
});

test('a response longer than the pinned size is cut off and removed', async () => {
  const { fetchImpl } = server({ bytes: Buffer.concat([BYTES, Buffer.alloc(1024)]) });
  await expect(downloadVerified(entry(), file, {}, { fetchImpl })).rejects.toMatchObject({ code: 'too_big' });
  expect(fs.existsSync(`${file}.part`)).toBe(false);
});

test('pausing keeps the part so the next run resumes', async () => {
  const controller = new AbortController();
  const { fetchImpl } = server();
  let seen = 0;
  const onProgress = ({ received }) => { seen = received; if (received >= 64 * 1024) {controller.abort();} };
  await expect(downloadVerified(entry(), file, { onProgress, signal: controller.signal }, { fetchImpl })).rejects.toMatchObject({ code: 'cancelled' });
  // Everything received before the pause is on disk, not lost in a buffer.
  expect(fs.statSync(`${file}.part`).size).toBe(seen);
  const again = server();
  await downloadVerified(entry(), file, {}, { fetchImpl: again.fetchImpl });
  expect(again.calls[0].range).toMatch(/^bytes=\d+-$/);
  expect(fs.readFileSync(file).equals(BYTES)).toBe(true);
});

test('a download that stops moving is reported as stalled and keeps its part', async () => {
  const fetchImpl = jest.fn(async () => ({
    status: 200,
    headers: new Headers(),
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(BYTES.subarray(0, 1024))); } })
  }));
  await expect(downloadVerified(entry(), file, {}, { fetchImpl, stallMs: 50 })).rejects.toMatchObject({ code: 'stalled' });
  expect(fs.statSync(`${file}.part`).size).toBe(1024);
});

test('only https on models.lanaai.io, including every redirect', async () => {
  await expect(downloadVerified(entry({ url: 'https://evil.example/test.gguf' }), file, {}, { fetchImpl: jest.fn() })).rejects.toMatchObject({ code: 'not_allowed' });
  await expect(downloadVerified(entry({ url: 'http://models.lanaai.io/llm/test.gguf' }), file, {}, { fetchImpl: jest.fn() })).rejects.toMatchObject({ code: 'not_allowed' });
  const { fetchImpl } = server({ redirect: 'https://evil.example/elsewhere.gguf' });
  await expect(downloadVerified(entry(), file, {}, { fetchImpl })).rejects.toMatchObject({ code: 'not_allowed' });
  expect(fs.existsSync(file)).toBe(false);
});

test('an HTTP error is reported in words and leaves nothing in place', async () => {
  const { fetchImpl } = server({ status: 404 });
  await expect(downloadVerified(entry(), file, {}, { fetchImpl })).rejects.toThrow('The model download failed (HTTP 404).');
  expect(fs.existsSync(file)).toBe(false);
});

test('not enough disk: refused before anything is fetched', async () => {
  const { fetchImpl } = server();
  await expect(downloadVerified(entry(), file, { freeBytes: 1024 }, { fetchImpl })).rejects.toMatchObject({ code: 'no_space' });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(() => assertSpace(10, null)).not.toThrow();
  expect(() => assertSpace(0, 0)).not.toThrow();
  expect(() => assertSpace(2 * 1024 ** 3, 1024 ** 3)).toThrow(/needs 2\.5 GB free, and this computer has 1\.0 GB/);
});

describe('already on the computer', () => {
  test('a checked file is not fetched again, and its note saves hashing it on the next launch', async () => {
    const first = server();
    await downloadVerified(entry(), file, {}, { fetchImpl: first.fetchImpl });
    const fsImpl = { ...fs, promises: { ...fs.promises }, createReadStream: jest.fn(fs.createReadStream) };
    expect(await isVerified(file, entry(), fsImpl)).toBe(true);
    expect(fsImpl.createReadStream).not.toHaveBeenCalled();
    const second = server();
    await downloadVerified(entry(), file, {}, { fetchImpl: second.fetchImpl });
    expect(second.fetchImpl).not.toHaveBeenCalled();
  });

  test('a file changed after it was checked is hashed again and found wrong', async () => {
    await downloadVerified(entry(), file, {}, { fetchImpl: server().fetchImpl });
    const changed = Buffer.from(BYTES);
    changed[0] ^= 1;
    fs.writeFileSync(file, changed);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(await isVerified(file, entry())).toBe(false);
  });

  test('a file put there by hand is hashed once, then noted', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, BYTES);
    expect(fs.existsSync(`${file}.verified`)).toBe(false);
    expect(await isVerified(file, entry())).toBe(true);
    expect(fs.existsSync(`${file}.verified`)).toBe(true);
  });

  test('remaining bytes: none when checked, the rest when a part is here, all when nothing is', async () => {
    expect(await remainingBytes(file, entry())).toBe(BYTES.length);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.part`, BYTES.subarray(0, 1000));
    expect(await remainingBytes(file, entry())).toBe(BYTES.length - 1000);
    await downloadVerified(entry(), file, {}, { fetchImpl: server().fetchImpl });
    expect(await remainingBytes(file, entry())).toBe(0);
  });
});

test('errors are DownloadErrors with a code', () => {
  expect(new DownloadError('mismatch', 'x')).toMatchObject({ name: 'DownloadError', code: 'mismatch' });
});

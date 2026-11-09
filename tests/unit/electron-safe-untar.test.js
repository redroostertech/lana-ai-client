/**
 * Unpacking the Docling runtime (electron-safe-untar.js): what it writes, and everything it
 * refuses. Archives are built here byte by byte, so the unsafe ones are exactly what an attacker
 * could hand over. Everything happens inside a new temp folder; a sentinel folder beside the
 * target shows that nothing escapes it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { untarGz, UntarError } = require('../../electron-safe-untar');

const { tar } = require('./support/tar-builder');

let tmp;
let dest;
let sentinel;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-untar-'));
  dest = path.join(tmp, 'work', 'runtime-1');
  sentinel = path.join(tmp, 'outside');
  fs.mkdirSync(path.join(tmp, 'work'), { recursive: true });
  fs.mkdirSync(sentinel);
});
afterEach(() => {
  // Only ever the folder this test made.
  if (tmp && tmp.startsWith(os.tmpdir()) && path.basename(tmp).startsWith('lana-untar-')) {fs.rmSync(tmp, { recursive: true, force: true });}
});

function write(buffer, name = 'a.tar.gz') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, zlib.gzipSync(buffer));
  return file;
}

function nothingEscaped() {
  expect(fs.readdirSync(sentinel)).toEqual([]);
  expect(fs.readdirSync(path.join(tmp, 'work')).sort()).toEqual(fs.existsSync(dest) ? ['runtime-1'] : []);
}

test('unpacks files, folders, in-folder links and long pax names, with only 0755 or 0644 modes', async () => {
  const long = `python/lib/${'deep/'.repeat(30)}module.py`;
  const archive = write(tar([
    { name: 'python/', type: '5', mode: 0o777 },
    { name: 'python/bin/python3.11', data: 'binary', mode: 0o4755 },
    { name: 'python/bin/python3', type: '2', linkname: 'python3.11' },
    { name: 'long', data: 'x', pax: { path: long } },
    { name: 'lana-runtime.json', data: '{"entry":["python/bin/python3"]}', mode: 0o666 }
  ]));
  const result = await untarGz(archive, dest, { maxBytes: 1000 });
  expect(result).toEqual({ files: 3, bytes: 6 + 1 + 32 });
  expect(fs.readFileSync(path.join(dest, 'python', 'bin', 'python3'), 'utf8')).toBe('binary');
  expect(fs.readlinkSync(path.join(dest, 'python', 'bin', 'python3'))).toBe('python3.11');
  expect(fs.readFileSync(path.join(dest, ...long.split('/')), 'utf8')).toBe('x');
  expect(fs.statSync(path.join(dest, 'python', 'bin', 'python3.11')).mode & 0o7777).toBe(0o755);
  expect(fs.statSync(path.join(dest, 'lana-runtime.json')).mode & 0o7777).toBe(0o644);
  expect(fs.existsSync(`${dest}.partial`)).toBe(false);
  nothingEscaped();
});

describe('refused, with nothing left behind', () => {
  test.each([
    ['an absolute path', [{ name: '/etc/lana-owned', data: 'x' }]],
    ['a Windows drive path', [{ name: 'C:evil', data: 'x' }]],
    ['a backslash path', [{ name: '..\\..\\outside\\x', data: 'x' }]],
    ['a ".." path', [{ name: '../outside/x', data: 'x' }]],
    ['a ".." inside a path', [{ name: 'python/../../outside/x', data: 'x' }]],
    ['a ".." in a pax path', [{ name: 'safe', data: 'x', pax: { path: '../../outside/x' } }]],
    ['a link to an absolute path', [{ name: 'l', type: '2', linkname: '/etc' }]],
    ['a link that climbs out', [{ name: 'l', type: '2', linkname: '../../outside' }]],
    ['a file written through a link', [{ name: 'd/', type: '5' }, { name: 'l', type: '2', linkname: 'd' }, { name: 'l/x', data: 'x' }]],
    ['a hard link', [{ name: 'a', data: 'x' }, { name: 'b', type: '1', linkname: 'a' }]],
    ['a device', [{ name: 'dev', type: '3' }]],
    ['a FIFO', [{ name: 'fifo', type: '6' }]],
    ['the same path twice', [{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]]
  ])('%s', async (_label, entries) => {
    const archive = write(tar(entries));
    await expect(untarGz(archive, dest)).rejects.toMatchObject({ code: 'unsafe' });
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
    nothingEscaped();
  });

  test('more bytes than the pinned size', async () => {
    const archive = write(tar([{ name: 'a', data: 'x'.repeat(600) }, { name: 'b', data: 'y'.repeat(600) }]));
    await expect(untarGz(archive, dest, { maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_big' });
    expect(fs.existsSync(dest)).toBe(false);
  });

  test('a partial archive: cut in the gzip stream, or a whole gzip whose tar has no end', async () => {
    const whole = zlib.gzipSync(tar([{ name: 'a', data: 'x'.repeat(5000) }, { name: 'b', data: 'y'.repeat(5000) }]));
    const cut = path.join(tmp, 'cut.tar.gz');
    fs.writeFileSync(cut, whole.subarray(0, Math.floor(whole.length / 2)));
    await expect(untarGz(cut, dest)).rejects.toMatchObject({ code: 'truncated' });
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
    const noEnd = write(tar([{ name: 'a', data: 'x'.repeat(5000) }], { end: false }), 'noend.tar.gz');
    await expect(untarGz(noEnd, dest)).rejects.toMatchObject({ code: 'truncated' });
    expect(fs.existsSync(dest)).toBe(false);
  });

  test('a damaged header', async () => {
    const bytes = tar([{ name: 'a', data: 'x' }]);
    bytes[0] = 'b'.charCodeAt(0);
    await expect(untarGz(write(bytes), dest)).rejects.toMatchObject({ code: 'corrupt' });
  });
});

test('a cut-off unpack leaves no folder, and the next run starts clean and finishes', async () => {
  const archive = write(tar([{ name: 'a', data: 'x' }, { name: 'b', data: 'y' }]));
  // Left over from a run that was cut off: a stray file in the partial folder.
  fs.mkdirSync(`${dest}.partial`, { recursive: true });
  fs.writeFileSync(path.join(`${dest}.partial`, 'stray'), 'old');
  await untarGz(archive, dest);
  expect(fs.readdirSync(dest).sort()).toEqual(['a', 'b']);
  // Pausing stops it and keeps nothing.
  const controller = new AbortController();
  controller.abort();
  const again = path.join(tmp, 'work', 'runtime-2');
  await expect(untarGz(archive, again, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  expect(fs.existsSync(again)).toBe(false);
  expect(fs.existsSync(`${again}.partial`)).toBe(false);
});

test('errors are UntarError with a plain message', async () => {
  const archive = write(tar([{ name: '/abs', data: 'x' }]));
  const error = await untarGz(archive, dest).catch((e) => e);
  expect(error).toBeInstanceOf(UntarError);
  expect(error.message).toMatch(/^The archive has an unsafe path/);
});

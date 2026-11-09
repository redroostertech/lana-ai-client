'use strict';

/**
 * Unpack a checked .tar.gz into a new folder, refusing anything that could write outside it.
 * Main process. Used for the Docling runtime (electron-docling-install.js); the archive's
 * sha256 is checked before this runs, and this still trusts nothing in it.
 *
 * Streamed (zlib gunzip, then 512-byte tar blocks), so a 600 MB archive never sits in memory.
 * Reads ustar and pax (the format scripts/docling-runtime-pack.py writes) and GNU long names.
 *
 * Refused, and the folder removed:
 *   an absolute path ("/x", "\\x", "C:x"), any ".." part, a backslash or NUL in a name
 *   a hard link, device, FIFO or any other type that is not a file, folder or symbolic link
 *   a symbolic link whose target is absolute or has a ".." part (so it can only point down,
 *   inside the folder), and any entry that would be written through a link
 *   the same path twice
 *   more bytes than `maxBytes` (the pinned unpacked size), or an archive that ends early
 *
 * Everything goes to `<dest>.partial` first, which is emptied before it starts and renamed to
 * `dest` only when the whole archive was read. A cut-off unpack leaves no `dest`, so the next
 * run unpacks again. Modes are 0755 or 0644 only; owners and times are not copied.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class UntarError extends Error {
  /** @param {'unsafe'|'truncated'|'too_big'|'corrupt'} code */
  constructor(code, message) {
    super(message);
    this.name = 'UntarError';
    this.code = code;
  }
}

const BLOCK = 512;

function cString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function octal(buf, start, length) {
  const text = cString(buf, start, length).trim();
  if (!text) {return 0;}
  if (!/^[0-7]+$/.test(text)) {throw new UntarError('corrupt', 'The archive has a damaged header.');}
  return parseInt(text, 8);
}

function checksumOk(header) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {sum += i >= 148 && i < 156 ? 32 : header[i];}
  return sum === octal(header, 148, 8);
}

/** pax records: "<len> key=value\n" ... */
function parsePax(buf) {
  const out = {};
  let at = 0;
  while (at < buf.length) {
    const space = buf.indexOf(32, at);
    if (space === -1) {break;}
    const len = parseInt(buf.subarray(at, space).toString('utf8'), 10);
    if (!len || at + len > buf.length) {throw new UntarError('corrupt', 'The archive has a damaged header.');}
    const record = buf.subarray(space + 1, at + len - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) {out[record.slice(0, eq)] = record.slice(eq + 1);}
    at += len;
  }
  return out;
}

/** A relative path with only plain parts, or an error. */
function safeRelative(name, what) {
  const unsafe = () => new UntarError('unsafe', `The archive has an unsafe ${what}: ${JSON.stringify(name).slice(0, 200)}`);
  if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\')) {throw unsafe();}
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {throw unsafe();}
  const parts = name.split('/').filter((part) => part !== '' && part !== '.');
  if (!parts.length || parts.some((part) => part === '..')) {throw unsafe();}
  return parts;
}

/**
 * @param {string} archive - a .tar.gz already checked against its pin
 * @param {string} dest - the folder to create; must not exist yet (it is replaced when it does)
 * @param {Object} [options]
 * @param {number} [options.maxBytes] - refuse more file bytes than this
 * @param {(progress: { bytes: number }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @param {Object} [deps] - { fsImpl } for tests
 * @returns {Promise<{ files: number, bytes: number }>}
 */
async function untarGz(archive, dest, { maxBytes = Infinity, onProgress = () => {}, signal } = {}, deps = {}) {
  const fsImpl = deps.fsImpl || fs;
  const root = path.resolve(dest);
  const partial = `${root}.partial`;
  await fsImpl.promises.rm(partial, { recursive: true, force: true });
  await fsImpl.promises.mkdir(partial, { recursive: true });

  const seen = new Set();
  const links = new Set();
  let files = 0;
  let bytes = 0;
  let pending = Buffer.alloc(0);
  let pax = {};
  let longName = null;
  let longLink = null;
  let ended = false;
  let zeroBlocks = 0;
  // The entry whose data is being read.
  let entry = null;

  function target(parts) {
    for (let i = 1; i < parts.length; i++) {
      if (links.has(parts.slice(0, i).join('/'))) {
        throw new UntarError('unsafe', `The archive writes through a link: ${parts.join('/').slice(0, 200)}`);
      }
    }
    const key = parts.join('/');
    if (seen.has(key)) {throw new UntarError('unsafe', `The archive has the same path twice: ${key.slice(0, 200)}`);}
    seen.add(key);
    const full = path.join(partial, ...parts);
    if (full !== partial && !full.startsWith(partial + path.sep)) {throw new UntarError('unsafe', 'The archive has an unsafe path.');}
    return { key, full };
  }

  async function startEntry(header) {
    if (!checksumOk(header)) {throw new UntarError('corrupt', 'The archive has a damaged header.');}
    const type = String.fromCharCode(header[156] || 48);
    const size = octal(header, 124, 12);
    const prefix = cString(header, 345, 155);
    const baseName = cString(header, 0, 100);
    const name = longName != null ? longName : pax.path != null ? pax.path : (prefix ? `${prefix}/${baseName}` : baseName);
    const linkName = longLink != null ? longLink : pax.linkpath != null ? pax.linkpath : cString(header, 157, 100);
    const mode = octal(header, 100, 8);

    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
      if (size > 1024 * 1024) {throw new UntarError('corrupt', 'The archive has a damaged header.');}
      entry = { kind: type, size, left: size, chunks: [] };
      return;
    }
    pax = {};
    longName = null;
    longLink = null;
    if (type === '5') {
      const { full } = target(safeRelative(name, 'path'));
      await fsImpl.promises.mkdir(full, { recursive: true, mode: 0o755 });
      entry = size ? { kind: 'skip', left: size } : null;
      return;
    }
    if (type === '2') {
      const parts = safeRelative(name, 'path');
      safeRelative(linkName, 'link');
      const { key, full } = target(parts);
      await fsImpl.promises.mkdir(path.dirname(full), { recursive: true });
      await fsImpl.promises.symlink(linkName, full);
      links.add(key);
      entry = null;
      return;
    }
    if (type !== '0' && type !== '7') {
      throw new UntarError('unsafe', `The archive has an entry LANA does not unpack (type ${JSON.stringify(type)}): ${String(name).slice(0, 200)}`);
    }
    const { full } = target(safeRelative(name, 'path'));
    if (bytes + size > maxBytes) {throw new UntarError('too_big', 'The archive is larger than expected, so it was stopped.');}
    await fsImpl.promises.mkdir(path.dirname(full), { recursive: true });
    const handle = await fsImpl.promises.open(full, 'wx', (mode & 0o100) ? 0o755 : 0o644);
    files += 1;
    entry = { kind: 'file', handle, left: size };
    if (!size) {await finishEntry();}
  }

  async function finishEntry() {
    const done = entry;
    entry = null;
    if (done.kind === 'file') {await done.handle.close();}
    if (done.kind === 'x') {pax = parsePax(Buffer.concat(done.chunks));}
    if (done.kind === 'L') {longName = cString(Buffer.concat(done.chunks), 0, done.size);}
    if (done.kind === 'K') {longLink = cString(Buffer.concat(done.chunks), 0, done.size);}
  }

  /** Consume whole blocks from `pending`. */
  async function drain() {
    while (!ended) {
      if (entry) {
        // Data blocks: the entry's bytes, padded to a whole block.
        const padded = Math.ceil(entry.left / BLOCK) * BLOCK || 0;
        const take = Math.min(pending.length - (pending.length % BLOCK), padded);
        if (!take) {return;}
        const data = pending.subarray(0, Math.min(take, entry.left));
        if (entry.kind === 'file') {
          await entry.handle.write(data);
          bytes += data.length;
          onProgress({ bytes });
        } else if (entry.kind !== 'skip') {
          entry.chunks.push(Buffer.from(data));
        }
        entry.left -= data.length;
        pending = pending.subarray(take);
        if (entry.left === 0) {await finishEntry();}
        continue;
      }
      if (pending.length < BLOCK) {return;}
      const header = pending.subarray(0, BLOCK);
      pending = pending.subarray(BLOCK);
      if (header.every((b) => b === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) {ended = true;}
        continue;
      }
      zeroBlocks = 0;
      await startEntry(header);
    }
  }

  try {
    const gunzip = zlib.createGunzip();
    const source = fsImpl.createReadStream(archive);
    source.on('error', (error) => gunzip.destroy(error));
    source.pipe(gunzip);
    try {
      for await (const chunk of gunzip) {
        if (signal && signal.aborted) {throw Object.assign(new Error('The setup was paused.'), { code: 'cancelled' });}
        if (ended) {continue;}
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        await drain();
      }
    } catch (error) {
      if (error && (error.code === 'Z_BUF_ERROR' || error.code === 'Z_DATA_ERROR' || error.errno === -5)) {
        throw new UntarError('truncated', 'The archive is incomplete or damaged.');
      }
      throw error;
    } finally {
      source.destroy();
    }
    if (!ended || entry) {throw new UntarError('truncated', 'The archive is incomplete or damaged.');}
    await fsImpl.promises.rm(root, { recursive: true, force: true });
    await fsImpl.promises.rename(partial, root);
    return { files, bytes };
  } catch (error) {
    if (entry && entry.kind === 'file') {await entry.handle.close().catch(() => {});}
    await fsImpl.promises.rm(partial, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { untarGz, UntarError, safeRelative };

'use strict';

/**
 * Download one model file, checked, and keep going after the app is closed (first-launch plan,
 * docs/plans/first-launch-local-ai-plan.md, phase B). Main process only.
 *
 * Adapted from the LANA One client (supervisor/model-downloader.js) and Pip Desktop v2.0.0
 * (src/main/catalog.ts downloadVerifiedFile, assertModelDownloadSpace):
 *
 *   1. Bytes go to `<file>.part`, never to the file itself.
 *   2. A `.part` left by an earlier run is resumed with an HTTP Range request. A server that
 *      answers 200 instead of 206 sent the whole file, so the part starts again from zero.
 *   3. A response that would run past the pinned size is cut off: a wrong file cannot fill the disk.
 *   4. When the bytes are all there, the WHOLE part is hashed (no hash state has to survive a
 *      restart). Size and SHA-256 both match: renamed into place. Either is wrong: the part is
 *      deleted, because resuming from bytes known to be wrong would only make them wrong again.
 *   5. Cancelling leaves the part in place, so the next run resumes. Cancelling is not damage.
 *   6. Before anything is fetched, the disk must hold what is left plus 512 MiB.
 *   7. Only https on models.lanaai.io, redirects included.
 *
 * A checked file gets a small `<file>.verified` note (size, change time, SHA-256), so later
 * launches know it is good without hashing gigabytes again. A file whose size or change time
 * no longer matches its note is hashed again.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ALLOWED_HOSTS = Object.freeze(['models.lanaai.io']);
const DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const STALL_TIMEOUT_MS = 30 * 1000;

class DownloadError extends Error {
  /** @param {'not_allowed'|'no_space'|'http'|'too_big'|'mismatch'|'cancelled'|'stalled'} code */
  constructor(code, message) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

function partPath(file) { return `${file}.part`; }
function notePath(file) { return `${file}.verified`; }

function assertAllowed(url, allowedHosts) {
  let parsed;
  try { parsed = new URL(url); } catch (_error) { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) {
    throw new DownloadError('not_allowed', 'LANA only downloads models from its own model server.');
  }
}

async function sha256OfFile(file, fsImpl = fs) {
  const hash = crypto.createHash('sha256');
  await pipeline(fsImpl.createReadStream(file), hash);
  return hash.digest('hex');
}

async function statOrNull(file, fsImpl) {
  try { return await fsImpl.promises.stat(file); } catch (_error) { return null; }
}

/**
 * True when `file` is the entry's file: its note matches, or a fresh hash does (and a note is written).
 * @param {{ sizeBytes: number, sha256: string }} entry
 */
async function isVerified(file, entry, fsImpl = fs) {
  const stat = await statOrNull(file, fsImpl);
  if (!stat || !stat.isFile() || stat.size !== entry.sizeBytes) {return false;}
  try {
    const note = JSON.parse(await fsImpl.promises.readFile(notePath(file), 'utf8'));
    if (note.sha256 === entry.sha256 && note.sizeBytes === stat.size && note.mtimeMs === stat.mtimeMs) {return true;}
  } catch (_error) { /* no note, or a bad one: hash */ }
  if ((await sha256OfFile(file, fsImpl)) !== entry.sha256) {return false;}
  await writeNote(file, entry, fsImpl);
  return true;
}

async function writeNote(file, entry, fsImpl) {
  const stat = await fsImpl.promises.stat(file);
  await fsImpl.promises.writeFile(notePath(file), JSON.stringify({ sha256: entry.sha256, sizeBytes: stat.size, mtimeMs: stat.mtimeMs }));
}

/** Bytes still to fetch for `file`: none when verified, else the size less any part already here. */
async function remainingBytes(file, entry, fsImpl = fs) {
  if (await isVerified(file, entry, fsImpl)) {return 0;}
  const part = await statOrNull(partPath(file), fsImpl);
  return Math.max(0, entry.sizeBytes - (part && part.size <= entry.sizeBytes ? part.size : 0));
}

/** Refuses when the disk cannot hold `bytes` plus the reserve. Unknown free space does not block. */
function assertSpace(bytes, freeBytes) {
  if (freeBytes == null || bytes <= 0) {return;}
  const needed = bytes + DISK_RESERVE_BYTES;
  if (freeBytes < needed) {
    const gb = (n) => (n / 1024 ** 3).toFixed(1);
    throw new DownloadError('no_space', `This download needs ${gb(needed)} GB free, and this computer has ${gb(Math.max(0, freeBytes))} GB. Free some space and try again.`);
  }
}

/** fetch, following redirects by hand so every hop is checked against the allowed hosts. */
async function fetchAllowed(url, { headers, signal, fetchImpl, allowedHosts }, hops = 5) {
  assertAllowed(url, allowedHosts);
  const response = await fetchImpl(url, { headers, signal, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location') && hops > 0) {
    if (response.body && typeof response.body.cancel === 'function') {await response.body.cancel().catch(() => {});}
    return fetchAllowed(new URL(response.headers.get('location'), url).toString(), { headers, signal, fetchImpl, allowedHosts }, hops - 1);
  }
  return response;
}

/**
 * Download one entry to `file`, resuming and checking it.
 * @param {Object} entry - { url, sizeBytes, sha256 }
 * @param {string} file - the final path
 * @param {Object} [options]
 * @param {(progress: { received: number, total: number }) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @param {number|null} [options.freeBytes] - free disk space, for the space check
 * @param {Object} [deps] - { fetchImpl, fsImpl, allowedHosts, stallMs } for tests
 * @returns {Promise<string>} the file
 */
async function downloadVerified(entry, file, { onProgress = () => {}, signal, freeBytes = null } = {}, deps = {}) {
  const { fetchImpl = (...args) => fetch(...args), fsImpl = fs, allowedHosts = ALLOWED_HOSTS, stallMs = STALL_TIMEOUT_MS } = deps;
  assertAllowed(entry.url, allowedHosts);
  if (await isVerified(file, entry, fsImpl)) {
    onProgress({ received: entry.sizeBytes, total: entry.sizeBytes });
    return file;
  }
  await fsImpl.promises.mkdir(path.dirname(file), { recursive: true });
  const part = partPath(file);
  let have = (await statOrNull(part, fsImpl))?.size || 0;
  if (have > entry.sizeBytes) {
    await fsImpl.promises.rm(part, { force: true });
    have = 0;
  }
  assertSpace(entry.sizeBytes - have, freeBytes);
  if (signal && signal.aborted) {throw new DownloadError('cancelled', 'The download was paused.');}

  // A part that is already whole only needs checking.
  if (have < entry.sizeBytes) {
    // The pause signal reaches fetch only until the server answers. After that, a pause ends the
    // body below by cancelling the reader; real fetch would instead error the read in flight
    // (AbortError) and the pause would look like a failure.
    const request = new AbortController();
    const forward = () => request.abort();
    if (signal) {signal.addEventListener('abort', forward, { once: true });}
    const response = await fetchAllowed(entry.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: request.signal, fetchImpl, allowedHosts })
      .catch((error) => { throw signal && signal.aborted ? new DownloadError('cancelled', 'The download was paused.') : error; })
      .finally(() => { if (signal) {signal.removeEventListener('abort', forward);} });
    if (response.status !== 200 && response.status !== 206) {
      throw new DownloadError('http', `The model download failed (HTTP ${response.status}).`);
    }
    if (!response.body) {throw new DownloadError('http', 'The model server sent nothing.');}
    const resuming = response.status === 206;
    let received = resuming ? have : 0;
    // Pausing and stalling end the stream cleanly instead of tearing it down, so every byte
    // already received reaches the part before this returns and the next run resumes after it.
    const reader = response.body.getReader();
    let stopped = null;
    let stall = null;
    const stop = (why) => {
      if (stopped) {return;}
      stopped = why;
      reader.cancel().catch(() => {});
    };
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => stop('stalled'), stallMs);
    };
    const onAbort = () => stop('cancelled');
    if (signal) {signal.addEventListener('abort', onAbort, { once: true });}
    // Paused while the answer was on its way: the listener above came too late to fire.
    if (signal && signal.aborted) {stop('cancelled');}
    async function* chunks() {
      armStall();
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done || stopped) {return;}
        received += value.length;
        if (received > entry.sizeBytes) {throw new DownloadError('too_big', 'The model download was larger than expected, so it was stopped.');}
        armStall();
        onProgress({ received, total: entry.sizeBytes });
        yield Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      }
    }
    try {
      await pipeline(Readable.from(chunks()), fsImpl.createWriteStream(part, { flags: resuming ? 'a' : 'w' }));
    } catch (error) {
      if (error instanceof DownloadError && error.code === 'too_big') {
        await fsImpl.promises.rm(part, { force: true });
      }
      throw error;
    } finally {
      clearTimeout(stall);
      if (signal) {signal.removeEventListener('abort', onAbort);}
    }
    if (stopped === 'cancelled') {throw new DownloadError('cancelled', 'The download was paused.');}
    if (stopped === 'stalled') {throw new DownloadError('stalled', 'The model download stopped moving. It will pick up where it stopped.');}
  }

  const size = (await fsImpl.promises.stat(part)).size;
  const digest = size === entry.sizeBytes ? await sha256OfFile(part, fsImpl) : null;
  if (digest !== entry.sha256) {
    await fsImpl.promises.rm(part, { force: true });
    throw new DownloadError('mismatch', 'The downloaded model did not match its checksum, so it was removed.');
  }
  await fsImpl.promises.rename(part, file);
  await writeNote(file, entry, fsImpl);
  return file;
}

module.exports = { downloadVerified, isVerified, remainingBytes, assertSpace, sha256OfFile, DownloadError, ALLOWED_HOSTS, DISK_RESERVE_BYTES };

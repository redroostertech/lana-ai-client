/**
 * model-downloader.js
 *
 * The runtime GGUF downloader the packaging plan calls out as missing (§4.2):
 * the deploy-time `scripts/download-llamacpp-models.sh` in LANA-AI has neither
 * checksum verification nor resume, and only runs at deploy time on a server.
 * LANA One needs a runtime, resumable, sha256-verified downloader that can run
 * from the Electron supervisor on a user's Mac (flaky wifi, app can be quit
 * mid-download, must never hand llama-server a truncated/corrupt GGUF).
 *
 * Design (mirrors the retired lana-gpt model/download.ts):
 *   1. Stream to `${destPath}.downloading` (never write directly to destPath).
 *   2. Resumable: if a `.downloading` part already exists, resume via HTTP
 *      Range starting at its current size. A server that ignores the Range
 *      header (200 instead of 206) is handled by restarting the part file.
 *   3. After the stream completes, hash the WHOLE part file (not just the
 *      resumed tail) against the expected sha256 -- this is what makes resume
 *      safe across process restarts, since no partial hash state needs to
 *      survive a relaunch.
 *   4. sha256 match -> atomic rename to destPath (same filesystem, so an
 *      `EXDEV`-free `fs.renameSync`). sha256 mismatch -> delete the bad part
 *      file and reject (never resume from data known to be wrong).
 *   5. Abort-safe: an AbortSignal tears down the response stream and the write
 *      stream; the partial part file is left on disk so the next attempt can
 *      resume (abort is not corruption).
 *
 * `requester` and `fs` are injected so this is unit-testable without any real
 * network or disk I/O (matches the injectable-collaborator style used
 * throughout supervisor/*.js -- see bootstrap.js, secret-manager.js).
 */
'use strict';

const nodePath = require('path');
const nodeCrypto = require('crypto');

/**
 * Default requester: a plain Node http/https GET (with Range support and a
 * bounded number of redirect hops, since HuggingFace resolves through a CDN
 * redirect). Not used in tests -- tests inject a fake.
 *
 * @returns {Promise<{statusCode: number, headers: object, stream: import('stream').Readable}>}
 */
function defaultRequester({ url, headers, signal }, hopsLeft = 5) {
  const { request: httpsRequest } = require('https');
  const { request: httpRequest } = require('http');
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error(`model-downloader: invalid URL "${url}": ${err.message}`));
      return;
    }
    const transport = target.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = transport(target, { headers }, (res) => {
      const { statusCode } = res;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location && hopsLeft > 0) {
        res.resume(); // discard this response body, follow the redirect
        const nextUrl = new URL(res.headers.location, target).toString();
        defaultRequester({ url: nextUrl, headers, signal }, hopsLeft - 1).then(resolve, reject);
        return;
      }
      resolve({ statusCode, headers: res.headers, stream: res });
    });
    req.on('error', reject);
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('aborted'));
        return;
      }
      const onAbort = () => req.destroy(new Error('aborted'));
      if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
    }
    req.end();
  });
}

function sha256File(filePath, fs) {
  return new Promise((resolve, reject) => {
    const hash = nodeCrypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function isAborted(signal) {
  return Boolean(signal && signal.aborted);
}

class AbortedError extends Error {
  constructor(message) {
    super(message || 'download aborted');
    this.name = 'AbortedError';
  }
}

class Sha256MismatchError extends Error {
  constructor(expected, actual) {
    super(`model-downloader: sha256 mismatch (expected ${expected}, got ${actual})`);
    this.name = 'Sha256MismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Download `url` to `destPath`, resuming from `${destPath}.downloading` if
 * present, verifying sha256, then atomically renaming into place.
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.sha256 - expected lowercase hex sha256 (required)
 * @param {string} opts.destPath - final path; the part file is `${destPath}.downloading`
 * @param {(progress: {bytesWritten: number, totalBytes: number|null}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {typeof defaultRequester} [opts.requester]
 * @param {typeof require('fs')} [opts.fs]
 * @returns {Promise<string>} resolves with destPath on success
 */
async function downloadFile(opts) {
  const {
    url, sha256, destPath, onProgress,
    signal, requester = defaultRequester, fs = require('fs'),
  } = opts || {};

  if (!url) throw new Error('model-downloader: url is required');
  if (!destPath) throw new Error('model-downloader: destPath is required');
  if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error('model-downloader: a 64-char hex sha256 is required to verify the download');
  }

  if (isAborted(signal)) throw new AbortedError();

  const partPath = `${destPath}.downloading`;
  fs.mkdirSync(nodePath.dirname(destPath), { recursive: true });

  let existingSize = 0;
  if (fs.existsSync(partPath)) {
    existingSize = fs.statSync(partPath).size;
  }

  const headers = existingSize > 0 ? { Range: `bytes=${existingSize}-` } : {};
  const { statusCode, headers: resHeaders, stream } = await requester({ url, headers, signal });

  if (statusCode !== 200 && statusCode !== 206) {
    // Drain so the socket can be released even on non-OK responses.
    if (stream && typeof stream.resume === 'function') stream.resume();
    throw new Error(`model-downloader: unexpected HTTP status ${statusCode} for ${url}`);
  }

  // Server honored Range with 206 -> append. Anything else (200, ignoring our
  // Range ask) -> the body is the FULL file, so restart the part from zero.
  const resuming = statusCode === 206;
  const writeStart = resuming ? existingSize : 0;
  const contentLength = resHeaders && resHeaders['content-length'] != null
    ? Number(resHeaders['content-length']) : null;
  const totalBytes = contentLength != null ? writeStart + contentLength : null;

  const writeStream = fs.createWriteStream(partPath, { flags: resuming ? 'a' : 'w' });
  let bytesWritten = writeStart;

  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (stream && typeof stream.destroy === 'function') stream.destroy();
      if (typeof writeStream.destroy === 'function') writeStream.destroy();
      reject(err);
    };
    const onAbort = () => fail(new AbortedError());
    if (signal) {
      if (isAborted(signal)) { onAbort(); return; }
      if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
    }

    stream.on('data', (chunk) => {
      bytesWritten += chunk.length;
      if (onProgress) onProgress({ bytesWritten, totalBytes });
    });
    stream.on('error', fail);
    writeStream.on('error', fail);
    writeStream.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    stream.pipe(writeStream);
  });

  const actualSha256 = await sha256File(partPath, fs);
  if (actualSha256.toLowerCase() !== sha256.toLowerCase()) {
    fs.unlinkSync(partPath);
    throw new Sha256MismatchError(sha256.toLowerCase(), actualSha256.toLowerCase());
  }

  fs.renameSync(partPath, destPath);
  return destPath;
}

/**
 * Ensure `${modelsDir}/${file}` exists and is verified, downloading it if not.
 * Cheap path: if destPath exists and its size matches `sizeBytes` (when given),
 * skip without touching the network. `deep: true` forces a full sha256 re-check
 * of an existing file (slow; use sparingly -- e.g. a user-triggered "verify").
 *
 * @param {object} opts
 * @param {string} opts.modelsDir
 * @param {string} opts.file
 * @param {string} opts.url
 * @param {string} opts.sha256
 * @param {number} [opts.sizeBytes]
 * @param {boolean} [opts.deep]
 * @param {(progress: {bytesWritten:number, totalBytes:number|null}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {typeof defaultRequester} [opts.requester]
 * @param {typeof require('fs')} [opts.fs]
 * @returns {Promise<string>} the final, verified path
 */
async function ensureModel(opts) {
  const {
    modelsDir, file, url, sha256, sizeBytes, deep,
    onProgress, signal, requester = defaultRequester, fs = require('fs'),
  } = opts || {};

  if (!modelsDir) throw new Error('model-downloader: modelsDir is required');
  if (!file) throw new Error('model-downloader: file is required');

  fs.mkdirSync(modelsDir, { recursive: true });
  const destPath = nodePath.join(modelsDir, file);

  if (fs.existsSync(destPath)) {
    if (deep) {
      const actual = await sha256File(destPath, fs);
      if (sha256 && actual.toLowerCase() === sha256.toLowerCase()) return destPath;
      // deep check failed -> fall through and re-download over it.
    } else {
      const stat = fs.statSync(destPath);
      if (!sizeBytes || stat.size === sizeBytes) return destPath;
      // size mismatch -> fall through and re-download.
    }
  }

  return downloadFile({ url, sha256, destPath, onProgress, signal, requester, fs });
}

module.exports = {
  downloadFile,
  ensureModel,
  defaultRequester,
  AbortedError,
  Sha256MismatchError,
};

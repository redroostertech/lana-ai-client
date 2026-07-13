/**
 * key-recovery.js
 *
 * Passphrase-wrapped recovery for the ENCRYPTION-CLASS secrets (the ones whose
 * loss is unrecoverable — see secret-manager.js). This is the escape hatch for the
 * P1 data-integrity guard in electron-keychain-store.js: if the OS keychain rotates
 * or the user moves to a new machine, they can restore the exact same encryption
 * keys from a recovery bundle instead of permanently orphaning their encrypted data.
 *
 * Threat model / design:
 *  - The bundle is portable and may be stored anywhere (email, USB, password
 *    manager), so it is encrypted with a user passphrase, never plaintext.
 *  - KDF: scrypt (memory-hard, in Node core — no dependency). Parameters are stored
 *    in the bundle so import is self-describing and future-tunable.
 *  - Cipher: AES-256-GCM (authenticated). A wrong passphrase fails the GCM auth tag,
 *    which we surface as a distinct RecoveryPassphraseError (not a silent mis-decrypt).
 *  - Only encryption-class key VALUES are inside the ciphertext. The plaintext
 *    envelope carries just the key NAMES (for display) + KDF/cipher params — never
 *    a secret value.
 *
 * Bundle format (JSON, version 1):
 * {
 *   "format": "lana-one.key-recovery",
 *   "version": 1,
 *   "createdAt": "<ISO-8601>",
 *   "keyNames": ["FILE_ENCRYPTION_KEY", ...],        // names only, for display
 *   "kdf":    { "algo": "scrypt", "N", "r", "p", "keylen", "salt": "<b64>" },
 *   "cipher": { "algo": "aes-256-gcm", "iv": "<b64>", "authTag": "<b64>",
 *               "ciphertext": "<b64>" }              // encrypts JSON {name: value}
 * }
 *
 * HOW THE APP WIRES THIS (no UI here — clean API only):
 *  Export (Settings → "Create recovery key"):
 *    const secrets = await new SecretManager({ store }).ensureSecrets();
 *    const bundle  = exportRecoveryBundle(secrets, userPassphrase);
 *    fs.writeFileSync(chosenPath, serializeBundle(bundle), { mode: 0o600 });
 *
 *  Restore (after a keychain-loss fault, BEFORE ensureSecrets):
 *    const bundle = parseBundle(fs.readFileSync(chosenPath, 'utf8'));
 *    await restoreInto(store, bundle, userPassphrase);   // writes keys into keychain
 *    // reconstruct the store (fault clears once keys decrypt) then ensureSecrets().
 */
'use strict';

const crypto = require('crypto');

let ENCRYPTION_CLASS_KEYS = [];
try {
  // Single source of truth for which keys belong in a recovery bundle.
  // eslint-disable-next-line global-require
  ENCRYPTION_CLASS_KEYS = require('./secret-manager').ENCRYPTION_CLASS_KEYS || [];
} catch (_) {
  ENCRYPTION_CLASS_KEYS = [];
}

const FORMAT = 'lana-one.key-recovery';
const VERSION = 1;

// scrypt work factor. N=2^16 is comfortably above interactive-login guidance for a
// recovery artifact (opened rarely, offline). maxmem is bumped to allow it.
const KDF_DEFAULTS = Object.freeze({ algo: 'scrypt', N: 1 << 16, r: 8, p: 1, keylen: 32 });
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const MIN_PASSPHRASE_LEN = 8;

// Hostile-bundle hardening. The KDF params live INSIDE the bundle (self-describing),
// so a malicious file could set an enormous N/r/p to force a huge scrypt allocation
// on import (DoS). We CLAMP each to a sane maximum before deriving. A legitimate
// bundle uses the defaults above, so clamping is a no-op for it; a hostile bundle is
// bounded (and, having tampered with the KDF, will simply fail GCM authentication).
// Ceilings are chosen so the clamped params ALWAYS fit under SCRYPT_MAXMEM
// (scrypt needs ~128*N*r bytes): 128 * 2^17 * 8 = 128 MiB < 256 MiB. This keeps a
// hostile bundle's derive both bounded AND completable (so it fails at GCM auth as a
// RecoveryPassphraseError, not a memory error). The defaults (N=2^16, r=8) sit under
// these, so clamping is a no-op for a legitimate bundle.
const KDF_MAX = Object.freeze({ N: 1 << 17, r: 8, p: 2 });
// Exact byte lengths our exporter emits (AES-256-GCM). Validated on import so a
// malformed bundle fails as a RecoveryBundleError up front rather than deep inside
// the crypto primitives.
const KEYLEN = 32;      // AES-256 key
const IV_LEN = 12;      // GCM nonce
const AUTH_TAG_LEN = 16; // GCM tag
const SALT_LEN = 16;    // scrypt salt

/** Clamp a bundle-supplied positive integer to [1, max]; non-integers -> fallback. */
function clampPositiveInt(value, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n > max ? max : n;
}

class RecoveryBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecoveryBundleError';
    this.code = 'RECOVERY_BUNDLE_INVALID';
  }
}

class RecoveryPassphraseError extends Error {
  constructor(message) {
    super(message || 'recovery passphrase is incorrect (bundle authentication failed)');
    this.name = 'RecoveryPassphraseError';
    this.code = 'RECOVERY_PASSPHRASE_INVALID';
  }
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');

function deriveKey(passphrase, kdf) {
  // Clamp bundle-supplied work factors so a hostile bundle cannot force a large
  // allocation. keylen is fixed at 32 (AES-256); assertValidBundle rejects any other.
  const N = clampPositiveInt(kdf.N, KDF_MAX.N, KDF_DEFAULTS.N);
  const r = clampPositiveInt(kdf.r, KDF_MAX.r, KDF_DEFAULTS.r);
  const p = clampPositiveInt(kdf.p, KDF_MAX.p, KDF_DEFAULTS.p);
  return crypto.scryptSync(Buffer.from(passphrase, 'utf8'), unb64(kdf.salt), KEYLEN, {
    N, r, p, maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * Build a passphrase-wrapped recovery bundle from a secret map.
 *
 * @param {Object<string,string>} secrets - full or partial secret map (only the
 *        encryption-class keys present are included).
 * @param {string} passphrase - user passphrase (>= 8 chars).
 * @param {object} [opts]
 * @param {string[]} [opts.keyNames] - override which keys to include (default: the
 *        encryption-class keys present in `secrets`).
 * @returns {object} bundle (also accepted by importRecoveryBundle / serializeBundle)
 */
function exportRecoveryBundle(secrets, passphrase, opts = {}) {
  if (!secrets || typeof secrets !== 'object') {
    throw new RecoveryBundleError('exportRecoveryBundle: secrets map is required');
  }
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LEN) {
    throw new RecoveryBundleError(
      `exportRecoveryBundle: passphrase must be at least ${MIN_PASSPHRASE_LEN} characters`
    );
  }
  const candidates = opts.keyNames || ENCRYPTION_CLASS_KEYS;
  const payload = {};
  for (const name of candidates) {
    const v = secrets[name];
    if (typeof v === 'string' && v.length > 0) payload[name] = v;
  }
  const keyNames = Object.keys(payload);
  if (keyNames.length === 0) {
    throw new RecoveryBundleError(
      'exportRecoveryBundle: no encryption-class secrets to back up'
    );
  }

  const kdf = { ...KDF_DEFAULTS, salt: b64(crypto.randomBytes(16)) };
  const key = deriveKey(passphrase, kdf);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    keyNames,
    kdf,
    cipher: { algo: 'aes-256-gcm', iv: b64(iv), authTag: b64(authTag), ciphertext: b64(ct) },
  };
}

function assertValidBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    throw new RecoveryBundleError('recovery bundle is missing or not an object');
  }
  if (bundle.format !== FORMAT) {
    throw new RecoveryBundleError(`unrecognized bundle format: ${bundle.format}`);
  }
  if (bundle.version !== VERSION) {
    throw new RecoveryBundleError(`unsupported bundle version: ${bundle.version}`);
  }
  const { kdf, cipher } = bundle;
  if (!kdf || kdf.algo !== 'scrypt' || !kdf.salt) {
    throw new RecoveryBundleError('bundle KDF section is malformed');
  }
  if (!cipher || cipher.algo !== 'aes-256-gcm' || !cipher.iv || !cipher.authTag || !cipher.ciphertext) {
    throw new RecoveryBundleError('bundle cipher section is malformed');
  }
  // keylen must be exactly 32 (AES-256). N/r/p are not rejected here — they are
  // CLAMPED at derive time (deriveKey) so a hostile large value is bounded rather
  // than fatal — but a non-32 keylen is a structural mismatch we reject loudly.
  if (kdf.keylen !== KEYLEN) {
    throw new RecoveryBundleError(`bundle KDF keylen must be ${KEYLEN} (got ${kdf.keylen})`);
  }
  // Validate the exact byte lengths so createDecipheriv/setAuthTag never throw a
  // generic Error that would escape the RecoveryBundleError taxonomy.
  const saltLen = safeB64Len(kdf.salt);
  if (saltLen !== SALT_LEN) {
    throw new RecoveryBundleError(`bundle KDF salt must be ${SALT_LEN} bytes (got ${saltLen})`);
  }
  const ivLen = safeB64Len(cipher.iv);
  if (ivLen !== IV_LEN) {
    throw new RecoveryBundleError(`bundle IV must be ${IV_LEN} bytes (got ${ivLen})`);
  }
  const tagLen = safeB64Len(cipher.authTag);
  if (tagLen !== AUTH_TAG_LEN) {
    throw new RecoveryBundleError(`bundle auth tag must be ${AUTH_TAG_LEN} bytes (got ${tagLen})`);
  }
}

/** Decode a base64 field to its byte length; returns -1 if not a decodable string. */
function safeB64Len(s) {
  if (typeof s !== 'string' || s.length === 0) return -1;
  try {
    return unb64(s).length;
  } catch (_) {
    return -1;
  }
}

/**
 * Decrypt a recovery bundle back into a { keyName: value } map.
 *
 * @param {object} bundle
 * @param {string} passphrase
 * @returns {Object<string,string>}
 * @throws {RecoveryBundleError}     malformed bundle
 * @throws {RecoveryPassphraseError} wrong passphrase (GCM auth failure)
 */
function importRecoveryBundle(bundle, passphrase) {
  assertValidBundle(bundle);
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new RecoveryPassphraseError('a passphrase is required to import the bundle');
  }
  // Key derivation + cipher setup are STRUCTURAL: a bad KDF param or a wrong-length
  // iv/tag/key throws a generic Error from the crypto primitives. Keep them inside a
  // try that re-raises as RecoveryBundleError so nothing escapes the taxonomy. Wrong
  // PASSPHRASE is detected separately below (GCM auth failure at final()).
  let decipher;
  try {
    const key = deriveKey(passphrase, bundle.kdf);
    decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(bundle.cipher.iv));
    decipher.setAuthTag(unb64(bundle.cipher.authTag));
  } catch (err) {
    throw new RecoveryBundleError(
      `recovery bundle crypto parameters are malformed: ${err && err.message ? err.message : err}`
    );
  }
  let plain;
  try {
    plain = Buffer.concat([
      decipher.update(unb64(bundle.cipher.ciphertext)),
      decipher.final(), // throws on auth-tag mismatch (wrong passphrase / tampered)
    ]);
  } catch (_) {
    throw new RecoveryPassphraseError();
  }
  let out;
  try {
    out = JSON.parse(plain.toString('utf8'));
  } catch (_) {
    // Authenticated but not our JSON — treat as corruption, not passphrase error.
    throw new RecoveryBundleError('bundle decrypted but payload was not valid JSON');
  }
  if (!out || typeof out !== 'object') {
    throw new RecoveryBundleError('bundle payload was not a key map');
  }
  return out;
}

/**
 * Restore recovered keys into a keychain store (async get/set/delete seam).
 * By default it will NOT clobber a key the store can already return, so a partial
 * migration never overwrites a still-good key. A store that is SEALED on a key
 * (get() throws KeychainEncryptionUnavailableError) is treated as "needs restore"
 * and written.
 *
 * ATOMICITY: a sealed key is restored via a single restore-mode set() rather than
 * delete-then-set. The old delete-first left a crash window in which the key was
 * absent from both memory AND disk — if the process died there, the sealed entry
 * was orphaned. set(name, value, { restore: true }) overwrites the faulted key in
 * place in one persist, so there is never a moment where the key is missing. Stores
 * that don't understand the flag simply ignore the extra argument.
 *
 * @param {{get:function,set:function,delete?:function}} store
 * @param {object} bundle
 * @param {string} passphrase
 * @param {object} [opts]
 * @param {boolean} [opts.overwrite=false] - overwrite existing readable values too.
 * @returns {Promise<{restored:string[], skipped:string[]}>}
 */
async function restoreInto(store, bundle, passphrase, opts = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new RecoveryBundleError('restoreInto: store with async get/set is required');
  }
  const recovered = importRecoveryBundle(bundle, passphrase);
  const overwrite = opts.overwrite === true;
  const restored = [];
  const skipped = [];
  for (const [name, value] of Object.entries(recovered)) {
    let existing = null;
    let sealed = false;
    try {
      // eslint-disable-next-line no-await-in-loop
      existing = await store.get(name);
    } catch (err) {
      // A sealed/faulted key throws — that is exactly what we are here to fix.
      if (err && err.code === 'ENCRYPTION_KEY_UNAVAILABLE') sealed = true;
      else throw err;
    }
    if (!overwrite && !sealed && existing) {
      skipped.push(name);
      continue;
    }
    // Restore-mode write: atomic overwrite of the (possibly faulted/sealed) key with
    // no delete-first window. The real KeychainSecretStore honors { restore: true }
    // to clear its fault guard for this key while writing in a single persist; a
    // plain store just ignores the extra argument.
    // eslint-disable-next-line no-await-in-loop
    await store.set(name, value, { restore: true });
    restored.push(name);
  }
  return { restored, skipped };
}

/** Canonical serialization for writing a bundle to disk. */
function serializeBundle(bundle) {
  return JSON.stringify(bundle, null, 2);
}

/** Parse a serialized bundle (validates shape). */
function parseBundle(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_) {
    throw new RecoveryBundleError('recovery bundle file is not valid JSON');
  }
  assertValidBundle(obj);
  return obj;
}

module.exports = {
  exportRecoveryBundle,
  importRecoveryBundle,
  restoreInto,
  serializeBundle,
  parseBundle,
  RecoveryBundleError,
  RecoveryPassphraseError,
  FORMAT,
  VERSION,
  MIN_PASSPHRASE_LEN,
};

#!/usr/bin/env node
/**
 * scripts/afterpack-sign-resources.js
 *
 * electron-builder `afterSign` hook for LANA One. LANA One bundles a whole
 * native stack under Contents/Resources (a relocated Postgres tree, MinIO,
 * llama-server, an embedding GGUF's loader libs, and docling/unstructured
 * Python 3.11 venvs). Under mac.hardenedRuntime:true, EVERY Mach-O file in
 * that tree -- executable or dylib/.so -- must carry a valid Developer ID
 * signature (with the --options runtime flag) or:
 *   - electron-builder's `notarize:true` submission is rejected by Apple, or
 *   - the app launches but the OS refuses to load an unsigned/invalid dylib
 *     at runtime (Postgres extensions, Python C-extensions).
 *
 * electron-builder's own default signing pass covers the Electron
 * framework/app executable and anything it recognizes as a native Node
 * module; it does NOT know about arbitrary files dropped into
 * Contents/Resources via `extraResources`. This hook fills that gap: it
 * walks Contents/Resources, finds every Mach-O file, and codesigns them
 * itself, INSIDE-OUT (deepest dylibs/.so first, then executables), before
 * electron-builder's notarize step runs. electron-builder still signs and
 * seals the .app bundle itself as the final step of its own pipeline.
 *
 * No-op (logs and returns) when:
 *   - not running on darwin (mac-only concern), or
 *   - no Developer ID signing identity can be resolved from the environment
 *     (so `npm run dist` still works for unsigned local/dev builds).
 *
 * Usage as an electron-builder hook (wired in electron-builder.lana-one.js
 * by another task):
 *   afterSign: 'scripts/afterpack-sign-resources.js'
 *
 * Usage standalone, to enumerate (NOT sign) the Mach-O files under a
 * directory -- useful for verifying the walk/sort logic without certs:
 *   node scripts/afterpack-sign-resources.js --list <path>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Mach-O detection (magic-number sniff, no shelling out to `file` per-entry --
// docling/unstructured venvs can contain thousands of .so files, so this
// needs to be cheap).
//
// Recognized 4-byte magic prefixes (both byte orders, 32/64-bit, and fat/
// universal binaries):
//   FE ED FA CE  MH_MAGIC     (32-bit, big-endian)
//   CE FA ED FE  MH_CIGAM     (32-bit, little-endian)
//   FE ED FA CF  MH_MAGIC_64  (64-bit, big-endian)
//   CF FA ED FE  MH_CIGAM_64  (64-bit, little-endian -- the common case on
//                              Intel/Apple Silicon Macs)
//   CA FE BA BE  FAT_MAGIC    (universal/fat binary)
//   BE BA FE CA  FAT_CIGAM
// ---------------------------------------------------------------------------
const MACHO_MAGICS = [
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  Buffer.from([0xbe, 0xba, 0xfe, 0xca]),
];

function isMachOFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, header, 0, 4, 0);
    if (bytesRead < 4) return false;
    return MACHO_MAGICS.some((magic) => header.equals(magic));
  } catch (err) {
    // Unreadable (permissions, broken symlink target, etc.) -- treat as
    // "not a file we can/should sign" rather than throwing.
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

function isDylibOrSo(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.dylib' || ext === '.so' || /\.so\.\d+/.test(filePath);
}

/**
 * Recursively walk `rootDir` and return every Mach-O file found, in
 * INSIDE-OUT signing order:
 *   1. .dylib / .so files, deepest path first
 *   2. everything else Mach-O (plain executables, e.g. postgres, minio,
 *      llama-server, python3.11), deepest path first
 *
 * Symlinks are not followed (the real file they point at is walked wherever
 * it actually lives in the tree; re-signing through a symlink would just
 * double-sign the same inode).
 */
function findMachOFiles(rootDir) {
  const dylibs = [];
  const binaries = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[sign-resources] skip unreadable dir ${dir}: ${err.message}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!isMachOFile(full)) {
        continue;
      }
      if (isDylibOrSo(full)) {
        dylibs.push(full);
      } else {
        binaries.push(full);
      }
    }
  }

  walk(rootDir);

  const depth = (p) => p.split(path.sep).length;
  const byDepthDesc = (a, b) => depth(b) - depth(a) || a.localeCompare(b);

  dylibs.sort(byDepthDesc);
  binaries.sort(byDepthDesc);

  // dylibs/.so first (deepest first), then binaries (deepest first) --
  // "inside-out": leaf libraries before the executables that dlopen/link
  // against them.
  return dylibs.concat(binaries);
}

// ---------------------------------------------------------------------------
// Signing identity resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Developer ID Application signing identity string suitable for
 * `codesign --sign "<identity>"`, purely from environment variables (the
 * same ones electron-builder itself reads: CSC_NAME, CSC_LINK,
 * CSC_KEY_PASSWORD, plus APPLE_TEAM_ID for disambiguation). Returns null if
 * no identity can be resolved -- callers must treat that as "skip signing".
 *
 * We deliberately do NOT read/print the values of CSC_LINK or
 * CSC_KEY_PASSWORD; they are only checked for presence.
 */
function resolveIdentity(env) {
  if (env.CSC_NAME && env.CSC_NAME.trim()) {
    return env.CSC_NAME.trim();
  }

  // No explicit CSC_NAME. If a CSC_LINK (base64 .p12) + CSC_KEY_PASSWORD are
  // present, electron-builder normally imports that certificate into a
  // temporary keychain as part of its own signing setup. By the time our
  // afterSign hook runs, that identity should already be importable/visible
  // via `security find-identity`. Try to resolve the "Developer ID
  // Application" identity name from the current keychain search list,
  // preferring one that matches APPLE_TEAM_ID if given.
  if (env.CSC_LINK && env.CSC_KEY_PASSWORD) {
    try {
      const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
        encoding: 'utf8',
      });
      const lines = out.split('\n').filter((l) => l.includes('Developer ID Application'));
      const teamId = env.APPLE_TEAM_ID && env.APPLE_TEAM_ID.trim();
      const chosen = (teamId ? lines.find((l) => l.includes(teamId)) : null) || lines[0];
      if (chosen) {
        const match = chosen.match(/"([^"]+)"/);
        if (match) return match[1];
      }
    } catch (err) {
      console.warn(`[sign-resources] could not query keychain for identity: ${err.message}`);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

function signFile(filePath, identity, entitlementsPath) {
  // execFileSync takes an argv array, not a shell string, so paths with
  // spaces (e.g. "LANA One.app") need no manual quoting/escaping.
  const args = [
    '--force',
    '--options',
    'runtime',
    '--timestamp',
    '--entitlements',
    entitlementsPath,
    '--sign',
    identity,
    filePath,
  ];
  execFileSync('codesign', args, { stdio: 'pipe' });
}

async function signResourcesUnderAppOutDir(appOutDir, productName, projectDir, env) {
  if (process.platform !== 'darwin') {
    console.log('[sign-resources] not running on darwin; skipping resource signing (no-op).');
    return;
  }

  const identity = resolveIdentity(env);
  if (!identity) {
    console.log(
      '[sign-resources] no signing identity in env (CSC_NAME / CSC_LINK+CSC_KEY_PASSWORD); ' +
        'skipping resource signing so this build stays a usable unsigned dev build (no-op).'
    );
    return;
  }

  const appDir = findAppBundle(appOutDir, productName);
  if (!appDir) {
    console.warn(`[sign-resources] no .app bundle found under ${appOutDir}; nothing to sign.`);
    return;
  }

  const resourcesDir = path.join(appDir, 'Contents', 'Resources');
  if (!fs.existsSync(resourcesDir)) {
    console.log(`[sign-resources] ${resourcesDir} does not exist; nothing to sign.`);
    return;
  }

  const entitlementsPath = path.join(projectDir, 'build', 'entitlements.mac.plist');
  if (!fs.existsSync(entitlementsPath)) {
    throw new Error(`[sign-resources] entitlements file not found at ${entitlementsPath}`);
  }

  console.log(`[sign-resources] scanning ${resourcesDir} for Mach-O files...`);
  const files = findMachOFiles(resourcesDir);
  console.log(`[sign-resources] found ${files.length} Mach-O file(s) to sign (inside-out order).`);

  let signed = 0;
  let failed = 0;
  const failures = [];

  for (const file of files) {
    try {
      signFile(file, identity, entitlementsPath);
      signed += 1;
    } catch (err) {
      failed += 1;
      failures.push({ file, message: err.message });
      console.error(`[sign-resources] FAILED to sign ${file}: ${err.message}`);
    }
  }

  console.log(
    `[sign-resources] summary: ${signed} signed, ${failed} failed, ${files.length} total ` +
      `(identity="${identity}").`
  );

  if (failed > 0) {
    throw new Error(
      `[sign-resources] ${failed} resource(s) failed to sign; aborting before notarization. ` +
        `First failure: ${failures[0].file} -- ${failures[0].message}`
    );
  }
}

/**
 * Find the packaged .app directory directly inside appOutDir. Prefer the
 * given productName (electron-builder's appInfo.productFilename normally
 * matches productName unless it required sanitizing), but fall back to
 * "whatever single .app is in there" so this doesn't break on sanitized
 * names.
 */
function findAppBundle(appOutDir, productName) {
  let entries;
  try {
    entries = fs.readdirSync(appOutDir, { withFileTypes: true });
  } catch (err) {
    return null;
  }
  const apps = entries.filter((e) => e.isDirectory() && e.name.endsWith('.app'));
  if (apps.length === 0) return null;
  const exact = apps.find((e) => e.name === `${productName}.app`);
  return path.join(appOutDir, (exact || apps[0]).name);
}

// ---------------------------------------------------------------------------
// electron-builder afterSign hook entry point
// ---------------------------------------------------------------------------

module.exports = async function afterSign(context) {
  const { appOutDir, electronPlatformName, packager } = context;

  if (electronPlatformName !== 'darwin') {
    console.log('[sign-resources] electronPlatformName != darwin; skipping (no-op).');
    return;
  }

  const productName =
    (packager && packager.appInfo && (packager.appInfo.productFilename || packager.appInfo.productName)) ||
    'LANA One';
  const projectDir = (packager && packager.projectDir) || path.resolve(__dirname, '..');

  await signResourcesUnderAppOutDir(appOutDir, productName, projectDir, process.env);
};

// ---------------------------------------------------------------------------
// CLI: --list <path>  (enumeration only, no signing, no cert required)
// ---------------------------------------------------------------------------

function runCli(argv) {
  const args = argv.slice(2);

  if (args[0] === '--list') {
    const target = args[1];
    if (!target) {
      console.error('Usage: node scripts/afterpack-sign-resources.js --list <path>');
      process.exitCode = 1;
      return;
    }
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved)) {
      console.error(`[sign-resources] path does not exist: ${resolved}`);
      process.exitCode = 1;
      return;
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      console.error(`[sign-resources] not a directory: ${resolved}`);
      process.exitCode = 1;
      return;
    }

    console.log(`[sign-resources] Mach-O files under ${resolved} (inside-out signing order):`);
    const files = findMachOFiles(resolved);
    for (const file of files) {
      const tag = isDylibOrSo(file) ? 'dylib' : 'bin  ';
      console.log(`  [${tag}] ${file}`);
    }
    console.log(`[sign-resources] total: ${files.length} Mach-O file(s).`);
    return;
  }

  console.log(
    'This module is an electron-builder afterSign hook.\n' +
      'Run it standalone in list-only mode with:\n' +
      '  node scripts/afterpack-sign-resources.js --list <path>'
  );
}

if (require.main === module) {
  runCli(process.argv);
}

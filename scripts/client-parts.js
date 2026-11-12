'use strict';

/**
 * The per-target parts folders that let one computer package every installer.
 *
 * Each native part the installer carries is built on a computer of its own platform. The
 * single-platform folders electron-builder reads (build/pip, build/redactor, build/engine) hold
 * one platform's build at a time, so a computer packaging several targets keeps each target's
 * parts apart:
 *
 *   build/parts/<macos-arm64|macos-x64|windows-x64|linux-x64>/pip       what build/pip holds
 *   build/parts/<target>/redactor                                      what build/redactor holds
 *   build/parts/<target>/engine                                        what build/engine holds
 *
 * scripts/fetch-client-parts.js fills them; the beforePack hook (scripts/parts-before-pack.js)
 * stages the target's folders into the single-platform paths before the pin checks run. Without
 * build/parts nothing is staged, so a one-platform build uses build/pip and the rest as before.
 * The editor (build/lana-editor) is plain JavaScript and the same for every target.
 *
 * Also here: the Mac signing list for one processor (macBinariesFor), and the check that a Mac
 * helper carries both processors (missingMacArchs).
 */

const fs = require('fs');
const path = require('path');
const { platformKey } = require('./local-ai-pins');

const PARTS = Object.freeze(['pip', 'redactor', 'engine']);
const MAC_ARCHS = Object.freeze(['arm64', 'x64']);

function partsRoot(root) {
  return path.join(root, 'build', 'parts');
}

/** The system name electron-builder and the pin checks use for a target key. */
function platformNameOf(key) {
  return { macos: 'darwin', windows: 'win32', linux: 'linux' }[String(key).split('-')[0]] || null;
}

function archNameOf(key) {
  return String(key).split('-')[1] || null;
}

/** Copies a folder, keeping symbolic links exactly as they are and file modes. */
function copyTree(src, dest) {
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
}

/**
 * Puts a finished folder at dest in one rename, replacing what was there. The new folder is
 * built beside dest first, so a failed copy never leaves dest half written.
 */
function swapInto(dest, fill) {
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const tag = `${process.pid}-${Date.now()}`;
  const staging = path.join(parent, `.${path.basename(dest)}.staging-${tag}`);
  const old = path.join(parent, `.${path.basename(dest)}.old-${tag}`);
  try {
    fill(staging);
    if (fs.existsSync(dest)) {fs.renameSync(dest, old);}
    fs.renameSync(staging, dest);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
  }
}

/**
 * Stages build/parts/<target>/<part> into build/<part> for one (platform, arch). Returns
 * { staged: <target key> }, or { staged: null } when there is no build/parts (one-platform
 * layout). Refuses, before changing anything, when the target's folder or one of its parts is
 * missing.
 */
function stageParts({ root, platformName, archName }) {
  const base = partsRoot(root);
  if (!fs.existsSync(base)) {return { staged: null };}
  const key = platformKey(platformName, archName);
  const rel = (file) => path.relative(root, file).split(path.sep).join('/');
  const dir = key && path.join(base, key);
  if (!dir || !fs.existsSync(dir)) {
    throw new Error(`${rel(path.join(base, key || `${platformName}-${archName}`))} is missing, so this build (${platformName} ${archName}) has no parts. Fetch them with node scripts/fetch-client-parts.js, or remove build/parts to package from build/pip, build/redactor and build/engine.`);
  }
  const missing = PARTS.filter((part) => !fs.existsSync(path.join(dir, part)));
  if (missing.length) {
    throw new Error(missing.map((part) => `${rel(path.join(dir, part))} is missing.`).join(' ') + ' Fetch it with node scripts/fetch-client-parts.js.');
  }
  for (const part of PARTS) {
    swapInto(path.join(root, 'build', part), (staging) => copyTree(path.join(dir, part), staging));
  }
  return { staged: key };
}

/**
 * mac.binaries for one processor. The config lists the engine's native files for both Mac
 * processors (.../prebuilds/darwin-arm64/..., .../darwin-x64/...); the signer refuses a listed
 * file that is not in the app, so each build keeps only its own. A universal build keeps all.
 */
function macBinariesFor(binaries, archName) {
  if (!MAC_ARCHS.includes(archName)) {return [...binaries];}
  return binaries.filter((file) => {
    const match = /\/darwin-(arm64|x64)\//.exec(file);
    return !match || match[1] === archName;
  });
}

/** The processors a Mac helper is missing, from `lipo -archs` output; both must be there. */
function missingMacArchs(lipoArchs) {
  const have = new Set(String(lipoArchs).trim().split(/\s+/));
  return ['arm64', 'x86_64'].filter((arch) => !have.has(arch));
}

module.exports = { PARTS, partsRoot, platformNameOf, archNameOf, copyTree, swapInto, stageParts, macBinariesFor, missingMacArchs };

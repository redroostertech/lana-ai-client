'use strict';

/**
 * Checks for the two local AI parts the installer carries, against their pins:
 *
 *   build/pip/lqe (lqe.exe on Windows)  Pip, the LANA.cpp engine, pip/pip-pin.json
 *   build/pip/vulkan-fallback/vulkan-1.dll (Windows), build/pip/vulkan-fallback/libvulkan.so.1 (Linux)
 *                                      the Vulkan loader lqe needs, pip/pip-pin.json vulkanLoader
 *   build/engine/                      the LANA engine folder, engine/engine-pin.json
 *
 * Used by scripts/build-pip.sh and scripts/build-engine.js after they place each part, and by
 * scripts/pip-before-pack.js and scripts/engine-before-pack.js before electron-builder packs it.
 * Each check returns a list of problems in plain words; an empty list means the part matches.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENGINE_MANIFEST = 'engine-manifest.json';
const ENGINE_ENTRY = 'src/engine/index.js';

/** The pin's name for a system and processor: macos-arm64, macos-x64, windows-x64, linux-x64. */
function platformKey(platformName, archName) {
  const os = { darwin: 'macos', mas: 'macos', win32: 'windows', linux: 'linux' }[platformName];
  if (!os || !['arm64', 'x64'].includes(archName)) {return null;}
  return `${os}-${archName}`;
}

/** The engine folder's own names for the system and processor (Node's process.platform and process.arch). */
function nodePlatform(platformName) {
  return platformName === 'mas' ? 'darwin' : platformName;
}

function pipFile(root, platformName) {
  return path.join(root, 'build', 'pip', platformName === 'win32' ? 'lqe.exe' : 'lqe');
}

function engineDir(root) {
  return path.join(root, 'build', 'engine');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {walkFiles(full, base, out);}
    else if (entry.isFile()) {out.push(path.relative(base, full).split(path.sep).join('/'));}
  }
  return out.sort();
}

/**
 * The engine folder's identity, computed the way the backend's build does
 * (LANA-AI scripts/release/build-engine-bundle.js treeDigest): sha256 over one line per file,
 * sorted by path, "<path>\t<bytes>\t<sha256>\n", leaving out engine-manifest.json.
 */
function treeDigest(dir) {
  const hash = crypto.createHash('sha256');
  const files = walkFiles(dir).filter((rel) => rel !== ENGINE_MANIFEST);
  for (const rel of files) {
    const full = path.join(dir, rel);
    hash.update(`${rel}\t${fs.statSync(full).size}\t${sha256File(full)}\n`);
  }
  return { files: files.length, sha256: hash.digest('hex') };
}

/**
 * The Vulkan loader the package carries for this platform (pin.vulkanLoader[key]: Windows, where
 * lqe.exe imports vulkan-1.dll, and Linux, where lqe needs libvulkan.so.1), or null.
 */
function vulkanLoaderFor(pin, key) {
  const loader = pin && pin.vulkanLoader && pin.vulkanLoader[key];
  return loader && typeof loader === 'object' ? loader : null;
}

/**
 * The loader in its fallback folder, and never beside lqe: a copy there would be found before the
 * computer's own loader (Windows searches lqe.exe's folder first; Linux lqe has RUNPATH $ORIGIN).
 */
function checkVulkanLoader(pipDir, loader, show) {
  const file = path.join(pipDir, loader.file);
  const beside = path.join(pipDir, path.basename(loader.file));
  const problems = [];
  if (beside !== file && fs.existsSync(beside)) {
    problems.push(`${show(beside)} is beside lqe, where it would be used instead of the computer's own Vulkan loader; it belongs only in ${show(file)}.`);
  }
  if (!fs.existsSync(file)) {
    problems.push(`The Vulkan loader is missing: ${show(file)}. lqe cannot start without it on a computer with no Vulkan loader of its own; place it with node scripts/fetch-vulkan-loader.js.`);
    return problems;
  }
  const have = sha256File(file);
  if (have !== loader.sha256) {problems.push(`${show(file)} is not the pinned Vulkan loader ${loader.version}: sha256 ${have}, the pin says ${loader.sha256}.`);}
  return problems;
}

function checkPip({ root, platformName, archName, pin }) {
  const key = platformKey(platformName, archName);
  const file = pipFile(root, platformName);
  const rel = path.relative(root, file);
  if (!fs.existsSync(file)) {
    return [`Pip is missing for this build (${key}): ${rel}. Build it with scripts/build-pip.sh on a matching computer first.`];
  }
  const want = pin.builds && pin.builds[key];
  if (!want) {return [`pip/pip-pin.json has no build for ${key}. Build it on a matching computer and record its sha256 there.`];}
  const have = sha256File(file);
  if (have !== want.sha256) {
    return [`${rel} is not the pinned Pip ${pin.version} (${pin.build}) for ${key}: sha256 ${have}, the pin says ${want.sha256}.`];
  }
  const loader = vulkanLoaderFor(pin, key);
  if (loader) {return checkVulkanLoader(path.dirname(file), loader, (where) => path.relative(root, where));}
  return [];
}

/**
 * @param {Object} args
 * @param {string[]} [args.macBinaries] - electron-builder mac.binaries; on macOS every native file
 *   in the folder must be listed so the signed build signs it with the app
 */
function checkEngine({ root, platformName, archName, pin, macBinaries = null }) {
  const key = platformKey(platformName, archName);
  const dir = engineDir(root);
  const rel = path.relative(root, dir);
  if (!fs.existsSync(path.join(dir, ENGINE_ENTRY)) || !fs.existsSync(path.join(dir, ENGINE_MANIFEST))) {
    return [`The engine is missing for this build (${key}): ${rel}. Build it with scripts/build-engine.js on a matching computer first.`];
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, ENGINE_MANIFEST), 'utf8'));
  const problems = [];
  if (manifest.commit !== pin.commit) {problems.push(`${rel} was built from LANA-AI ${manifest.commit}, the pin says ${pin.commit}.`);}
  if (manifest.dirty) {problems.push(`${rel} was built from a LANA-AI checkout with uncommitted changes.`);}
  if (manifest.platform !== nodePlatform(platformName) || manifest.arch !== archName) {
    problems.push(`${rel} is for ${manifest.platform}-${manifest.arch}, this build is ${nodePlatform(platformName)}-${archName}.`);
  }
  const want = pin.builds && pin.builds[key];
  if (!want) {
    problems.push(`engine/engine-pin.json has no build for ${key}. Build it on a matching computer and record its treeSha256 there.`);
  } else {
    const digest = treeDigest(dir);
    if (digest.sha256 !== want.treeSha256 || digest.files !== want.files) {
      problems.push(`${rel} does not match the pin for ${key}: ${digest.files} files, tree sha256 ${digest.sha256}; the pin says ${want.files} files, ${want.treeSha256}.`);
    }
  }
  if (macBinaries && key.startsWith('macos-')) {
    const listed = new Set(macBinaries);
    const unsigned = (manifest.native || []).filter((file) => !listed.has(`Contents/Resources/engine/${file}`));
    if (unsigned.length) {
      problems.push(`electron-builder.client.json mac.binaries does not list these engine files, so the signed app would not sign them: ${unsigned.join(', ')}.`);
    }
  }
  return problems;
}

/**
 * The packed app's copies (<resources>/pip and <resources>/engine) against the pins, so a part the
 * packager left out or changed (it drops a folder's top-level node_modules unless that folder is
 * copied on its own) stops the build instead of shipping.
 */
function checkPackaged({ resourcesDir, platformName, archName, pipPin, enginePin }) {
  const key = platformKey(platformName, archName);
  const problems = [];
  const lqe = path.join(resourcesDir, 'pip', platformName === 'win32' ? 'lqe.exe' : 'lqe');
  const pipWant = pipPin.builds && pipPin.builds[key];
  if (!fs.existsSync(lqe)) {problems.push(`The packed app has no Pip at ${lqe}.`);}
  else if (!pipWant || sha256File(lqe) !== pipWant.sha256) {problems.push(`The packed app's Pip (${lqe}) is not the pinned build for ${key}.`);}
  const loader = vulkanLoaderFor(pipPin, key);
  if (loader) {
    problems.push(...checkVulkanLoader(path.join(resourcesDir, 'pip'), loader, (where) => where).map((problem) => `The packed app: ${problem}`));
  }
  const engine = path.join(resourcesDir, 'engine');
  const engineWant = enginePin.builds && enginePin.builds[key];
  if (!fs.existsSync(path.join(engine, ENGINE_ENTRY))) {problems.push(`The packed app has no engine at ${engine}.`);}
  else if (engineWant) {
    const digest = treeDigest(engine);
    if (digest.sha256 !== engineWant.treeSha256 || digest.files !== engineWant.files) {
      problems.push(`The packed app's engine (${engine}) is not the pinned folder for ${key}: ${digest.files} files, tree sha256 ${digest.sha256}; the pin says ${engineWant.files} files, ${engineWant.treeSha256}.`);
    }
  } else {problems.push(`engine/engine-pin.json has no build for ${key}.`);}
  return problems;
}

module.exports = { ENGINE_MANIFEST, ENGINE_ENTRY, platformKey, nodePlatform, pipFile, engineDir, sha256File, walkFiles, treeDigest, vulkanLoaderFor, checkPip, checkEngine, checkPackaged };

#!/usr/bin/env node
'use strict';

/**
 * Fills build/parts/<target>/<part> (scripts/client-parts.js) from download links, so one
 * computer can package every installer from parts built on the matching computers.
 *
 *   LANA_CLIENT_PARTS_URLS  path to a file of links, one per line:
 *
 *     <target>/<part> <url>            the part's archive (tar.gz)
 *     <target>/<part>.sha256 <url>     optional: its .sha256 file. Without this line the link is
 *                                      the archive's with .sha256 added to its path (the query,
 *                                      such as a SAS token, kept as it is)
 *
 *   <target> is macos-arm64, macos-x64, windows-x64 or linux-x64; <part> is pip, redactor or
 *   engine. Blank lines and lines starting with # are skipped. An archive holds what
 *   build/<part>/ holds, at its root (tar -czf pip.tar.gz -C build/pip .) or in one folder named
 *   after the part (tar -czf pip.tar.gz -C build pip).
 *
 * Each archive must match its .sha256, and what it unpacks to must pass the same check the
 * package step runs (scripts/local-ai-pins.js checkPip and checkEngine, the redactor check), or
 * it is refused and the part already in build/parts stays. The links carry access tokens, so
 * nothing here prints them; messages name the target and part only.
 *
 * Then, for every target in the list, the LANA Briefs speech package that target needs
 * (sherpa-onnx-<os>-<cpu>, scripts/briefs-before-pack.js) is put in node_modules at the version
 * and integrity package-lock.json pins, since npm installs only the computer's own.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFileSync } = require('child_process');
const { Arch } = require('builder-util');
const { checkPip, checkEngine, sha256File } = require('./local-ai-pins');
const { checkRedactor } = require('./redactor-before-pack');
const { requiredPackages } = require('./briefs-before-pack');
const { PARTS, partsRoot, platformNameOf, archNameOf, swapInto, removeLeftover, macBinariesFor } = require('./client-parts');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = Object.freeze(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']);
const LINE = new RegExp(`^(${TARGETS.join('|')})/(${PARTS.join('|')})(\\.sha256)?$`);

function defaultPins(root = ROOT) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  return { pip: read('pip/pip-pin.json'), engine: read('engine/engine-pin.json'), macBinaries: read('electron-builder.client.json').mac.binaries || [] };
}

/** The .sha256 link for an archive link: .sha256 added to the path, the query kept. */
function shaUrlFor(url) {
  const parsed = new URL(url);
  parsed.pathname += '.sha256';
  return parsed.toString();
}

/** [{ key, part, url, shaUrl }] from the list's text. Errors name the line number, never its link. */
function parseUrlList(text) {
  const archives = new Map();
  const shas = new Map();
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {return;}
    const [name, url, ...rest] = line.split(/\s+/);
    const match = LINE.exec(name);
    let valid = Boolean(match && url && rest.length === 0);
    if (valid) {try { new URL(url); } catch (_error) { valid = false; }}
    if (!valid) {
      throw new Error(`The parts list, line ${index + 1}, is not "<target>/<part> <url>" with a target of ${TARGETS.join(', ')} and a part of ${PARTS.join(', ')}.`);
    }
    (match[3] ? shas : archives).set(`${match[1]}/${match[2]}`, url);
  });
  for (const name of shas.keys()) {
    if (!archives.has(name)) {throw new Error(`The parts list has a .sha256 link for ${name} but no archive link.`);}
  }
  return [...archives].map(([name, url]) => {
    const [key, part] = name.split('/');
    return { key, part, url, shaUrl: shas.get(name) || shaUrlFor(url) };
  });
}

/** Saves a link's body to dest. Failures name the label and the status, never the link. */
async function download(url, dest, label = 'a download') {
  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (error) {
    const code = (error && error.cause && error.cause.code) || (error && error.code) || 'a network error';
    throw new Error(`Could not download ${label}: ${code}.`);
  }
  if (!response.ok || !response.body) {throw new Error(`Could not download ${label}: the server answered ${response.status}.`);}
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(dest));
}

/** Problems with an unpacked part (at root/build/<part>) for a target: the package step's checks. */
function checkPart({ root, key, part, pins }) {
  const platformName = platformNameOf(key);
  const archName = archNameOf(key);
  if (part === 'pip') {return checkPip({ root, platformName, archName, pin: pins.pip });}
  if (part === 'engine') {
    const macBinaries = key.startsWith('macos-') ? macBinariesFor(pins.macBinaries || [], archName) : null;
    return checkEngine({ root, platformName, archName, pin: pins.engine, macBinaries });
  }
  return checkRedactor({ root, platformName });
}

function unpack(tarball, dir, part) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
  // An archive of the folder itself (tar -C build pip): use what is inside it.
  const entries = fs.readdirSync(dir);
  if (entries.length === 1 && entries[0] === part && fs.statSync(path.join(dir, part)).isDirectory()) {
    const inner = `${dir}.inner`;
    fs.renameSync(path.join(dir, part), inner);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.renameSync(inner, dir);
  }
}

async function fetchPart({ root, entry, pins, log }) {
  const label = `${entry.key}/${entry.part}`;
  const base = partsRoot(root);
  fs.mkdirSync(base, { recursive: true });
  // Work inside build/parts so the finished folder moves into place with a rename.
  const work = fs.mkdtempSync(path.join(base, '.fetch-'));
  try {
    const tarball = path.join(work, 'part.tar.gz');
    const shaFile = path.join(work, 'part.tar.gz.sha256');
    await download(entry.url, tarball, label);
    await download(entry.shaUrl, shaFile, `${label}.sha256`);
    const want = (/\b[0-9a-f]{64}\b/i.exec(fs.readFileSync(shaFile, 'utf8')) || [])[0];
    if (!want) {throw new Error(`${label}: its .sha256 file holds no sha256.`);}
    const have = sha256File(tarball);
    if (have !== want.toLowerCase()) {throw new Error(`${label}: the archive's sha256 is ${have}, its .sha256 says ${want.toLowerCase()}. Refused.`);}
    const unpackedRoot = path.join(work, 'root');
    const unpacked = path.join(unpackedRoot, 'build', entry.part);
    unpack(tarball, unpacked, entry.part);
    const problems = checkPart({ root: unpackedRoot, key: entry.key, part: entry.part, pins });
    if (problems.length) {throw new Error(`${label}: ${problems.join(' ')} Refused.`);}
    swapInto(path.join(base, entry.key, entry.part), (staging) => fs.renameSync(unpacked, staging));
    log(`Client parts: ${label} downloaded, its sha256 and pin match.`);
  } finally {
    removeLeftover(work);
  }
}

function sriOf(file) {
  return `sha512-${crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')}`;
}

/** The Briefs speech packages the targets need, in order, once each. */
function sherpaPackagesFor(keys) {
  const names = keys.flatMap((key) => requiredPackages(platformNameOf(key), Arch[archNameOf(key)]));
  return [...new Set(names)];
}

/**
 * Puts each target's sherpa-onnx platform package in node_modules at the version package-lock
 * pins, its bytes checked against the lock's integrity. One already there at that version is
 * left as it is.
 */
async function ensureSherpaPackages({ root = ROOT, keys, lock, download: get = download, log = console.log }) {
  for (const name of sherpaPackagesFor(keys)) {
    const pinned = lock.packages && lock.packages[`node_modules/${name}`];
    if (!pinned || !pinned.version || !pinned.resolved || !pinned.integrity) {
      throw new Error(`package-lock.json pins no version of ${name}, so it cannot be installed for this target.`);
    }
    const dest = path.join(root, 'node_modules', name);
    const installed = path.join(dest, 'package.json');
    if (fs.existsSync(installed) && JSON.parse(fs.readFileSync(installed, 'utf8')).version === pinned.version) {continue;}
    const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sherpa-'));
    try {
      const tarball = path.join(work, `${name}.tgz`);
      await get(pinned.resolved, tarball, name);
      const have = sriOf(tarball);
      const wants = String(pinned.integrity).split(/\s+/).filter((sri) => sri.startsWith('sha512-'));
      if (!wants.includes(have)) {throw new Error(`${name} ${pinned.version} does not match package-lock.json's integrity. Refused.`);}
      swapInto(dest, (staging) => {
        fs.mkdirSync(staging, { recursive: true });
        execFileSync('tar', ['-xzf', tarball, '-C', staging, '--strip-components', '1'], { stdio: ['ignore', 'ignore', 'pipe'] });
      });
      log(`Client parts: ${name} ${pinned.version} installed for packaging.`);
    } finally {
      removeLeftover(work);
    }
  }
}

async function fetchClientParts({ root = ROOT, listFile, pins = defaultPins(root), log = console.log, sherpa = true }) {
  if (!listFile) {throw new Error('Set LANA_CLIENT_PARTS_URLS to the file that lists the parts\' links.');}
  if (!fs.existsSync(listFile)) {throw new Error(`The parts list ${listFile} does not exist.`);}
  const entries = parseUrlList(fs.readFileSync(listFile, 'utf8'));
  if (!entries.length) {throw new Error(`The parts list ${listFile} names no parts.`);}
  for (const entry of entries) {await fetchPart({ root, entry, pins, log });}
  if (sherpa) {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    await ensureSherpaPackages({ root, keys: [...new Set(entries.map((entry) => entry.key))], lock, log });
  }
}

if (require.main === module) {
  fetchClientParts({ listFile: process.env.LANA_CLIENT_PARTS_URLS }).catch((error) => {
    console.error(`Client parts: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { TARGETS, shaUrlFor, parseUrlList, download, checkPart, sherpaPackagesFor, ensureSherpaPackages, fetchClientParts };

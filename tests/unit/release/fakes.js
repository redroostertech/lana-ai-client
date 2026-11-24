'use strict';

/**
 * Fakes for the release command's tests: git, R2 and the program runner, so
 * no test touches GitHub, Cloudflare, Heroku, Azure or a real build.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createContext } = require('../../../scripts/release/context');
const { emptyState } = require('../../../scripts/release/state');

const SERVER = 'a'.repeat(40);
const CLIENT_PROD = 'c'.repeat(40);
const CLIENT_DEV = 'd'.repeat(40);
const PIP_COMMIT = '8ee218c47371aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REDACTOR = 'e4ea4861f9fc3528f7fe6bfbcf058c9b4f0ef552';
const EDITOR = '974d0a209109bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const hex = (ch) => ch.repeat(64);

/** Pins with entries for some systems; pass overrides per file. */
function pinsFixture({ pipBuilds, engineBuilds, version = '4.1.0', engineBranch = 'lana-runtime-merge' } = {}) {
  return {
    'pip/pip-pin.json': { tag: 'v3.1.0', version: '3.1.0', build: '8ee218c47371', commit: PIP_COMMIT, builds: pipBuilds || {
      'macos-arm64': { sha256: hex('1'), bytes: 1 }, 'windows-x64': { sha256: hex('2'), bytes: 2 }, 'linux-x64': { sha256: hex('3'), bytes: 3 }
    } },
    'engine/engine-pin.json': { branch: engineBranch, commit: SERVER, builds: engineBuilds || { 'macos-arm64': { files: 10, treeSha256: hex('4') } } },
    'redactor/redactor-pin.json': { commit: REDACTOR },
    'editor/editor.lock.json': { commit: EDITOR },
    'package.json': { version }
  };
}

/** A bucket listing holding archives (with .sha256) for these keys. */
function listingOf(keys) {
  return keys.flatMap((key, index) => [
    { key, size: 100, modified: `2026-11-2${index % 10}T00:00:00Z` },
    { key: `${key}.sha256`, size: 80, modified: `2026-11-2${index % 10}T00:00:00Z` }
  ]);
}

/** Archives named by source commit (LANA.cpp 8ee218c47371, LANA-AI aaaaaaaaaaaa, lana-redactor e4ea4861f9fc): the pinned ones only. */
function readyKeys() {
  return [
    'macos-arm64/pip-8ee218c47371.tar.gz', 'windows-x64/pip-8ee218c47371.tar.gz', 'linux-x64/pip-8ee218c47371.tar.gz',
    'macos-arm64/engine-aaaaaaaaaaaa.tar.gz',
    ...['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'].map((t) => `${t}/redactor-e4ea4861f9fc.tar.gz`)
  ];
}

function fakeGit({ files = {}, devFiles = null, tips = {}, reachable = true, editorServer = EDITOR, head = CLIENT_PROD, clean = true } = {}) {
  const calls = [];
  const read = (ref, file) => {
    const source = ref === 'origin/development' && devFiles ? devFiles : files;
    if (!(file in source)) {throw new Error(`no ${file}`);}
    return JSON.stringify(source[file]);
  };
  return {
    calls,
    tip: jest.fn(async (repo, branch) => (tips[`${repo}:${branch}`] !== undefined ? tips[`${repo}:${branch}`] : repo.endsWith('LANA-AI') ? SERVER : CLIENT_PROD)),
    tagCommit: jest.fn(async () => PIP_COMMIT),
    reachable: jest.fn(async () => reachable),
    remoteFile: jest.fn(async () => JSON.stringify({ commit: editorServer })),
    fetch: jest.fn(async () => {}),
    show: jest.fn(async (_dir, ref, file) => read(ref, file)),
    head: jest.fn(async () => head),
    clean: jest.fn(async () => clean),
    git: jest.fn(async (args) => {
      calls.push(args);
      if (args.includes('rev-parse')) {return args.includes('origin/development') ? CLIENT_DEV : CLIENT_PROD;}
      return '';
    })
  };
}

function fakeR2(listing = [], extra = {}) {
  return {
    list: jest.fn(async (bucket) => (bucket === 'lana-build-parts' ? listing : (extra.releases || []))),
    getText: jest.fn(async () => extra.shaText || ''),
    download: jest.fn(async (_bucket, _key, file) => { if (extra.downloadFrom) {fs.copyFileSync(extra.downloadFrom, file);} }),
    upload: jest.fn(async () => {}),
    presign: jest.fn(async (_bucket, key) => `https://secret.example/${key}?X-Amz-Signature=${'f'.repeat(64)}`)
  };
}

/** A runner that answers by program name; unknown programs succeed quietly. */
function fakeRun(answers = {}) {
  return jest.fn(async (command, args = []) => {
    const answer = answers[command];
    if (typeof answer === 'function') {return answer(args);}
    return answer || { code: 0, stdout: '', stderr: '' };
  });
}

function makeCtx({ mode = 'parts', version = '4.2.0', git, r2, run, state, env = {}, targets, dryRun = false, yes = [], serverRepo = '/srv/LANA-AI', serverVersion } = {}) {
  const home = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'lana-release-'));
  const lines = [];
  const ctx = createContext({ mode, version, targets, dryRun, yes: new Set(yes), clientRoot: '/srv/client', serverRepo, serverVersion }, {
    run: run || fakeRun(), git: git || fakeGit({ files: pinsFixture() }), r2: r2 || fakeR2(), env, home,
    log: (line) => lines.push(line), state: state || emptyState(version)
  });
  ctx.lines = lines;
  return ctx;
}

function allPip() {
  return { 'macos-arm64': { sha256: '1'.repeat(64) }, 'macos-x64': { sha256: '5'.repeat(64) }, 'windows-x64': { sha256: '2'.repeat(64) }, 'linux-x64': { sha256: '3'.repeat(64) } };
}
function allEngine() {
  return Object.fromEntries(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'].map((t, i) => [t, { files: 1, treeSha256: String(6 + i).repeat(64) }]));
}
function allKeys() {
  return [
    ...readyKeys(), 'macos-x64/pip-8ee218c47371.tar.gz',
    'macos-x64/engine-aaaaaaaaaaaa.tar.gz', 'windows-x64/engine-aaaaaaaaaaaa.tar.gz', 'linux-x64/engine-aaaaaaaaaaaa.tar.gz'
  ];
}

module.exports = { allPip, allEngine, allKeys, SERVER, CLIENT_PROD, CLIENT_DEV, PIP_COMMIT, REDACTOR, EDITOR, hex, pinsFixture, listingOf, readyKeys, fakeGit, fakeR2, fakeRun, makeCtx };

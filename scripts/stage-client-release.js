#!/usr/bin/env node
'use strict';

/*
 * stage-client-release.js
 * ---------------------------------------------------------------------------
 * Lays out a finished client build for https://releases.lanaai.io/client/
 * (R2 bucket lana-releases). Nothing is uploaded: the upload is a separate step
 * the owner runs. This script copies files into dist/r2/ in the exact shape the
 * bucket needs and prints the list of objects to upload.
 *
 * Layout (keys under the bucket):
 *   client/latest-mac.yml, client/latest.yml, client/latest-linux.yml
 *       update feeds read by electron-updater (generic provider,
 *       url https://releases.lanaai.io/client/). Their file entries point at
 *       <version>/<file>, which electron-updater resolves against client/.
 *   client/<version>/<installer, zip and .blockmap files>
 *       every file of that version under its built name. Differential updates
 *       find the old version's blockmap by swapping the version in the path, so
 *       the version must appear in both the folder and the file name (it does).
 *   client/latest/<stable name>
 *       a copy of each installer under a name that never changes, for the
 *       download page and emails (for example client/latest/LANA-mac-arm64.dmg).
 *
 * Mac builds made one arch at a time each write latest-mac.yml; build-client.sh
 * keeps each as latest-mac-<arch>.yml and this script merges them into one feed.
 *
 * USAGE:
 *   node scripts/stage-client-release.js [--dist dist] [--version 4.2.0]
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const BUCKET = 'lana-releases';
const PREFIX = 'client';
const PUBLIC_BASE = 'https://releases.lanaai.io/client/';

// Stable download names in client/latest/, matched against built file names.
const STABLE_NAMES = [
  { test: /-arm64\.dmg$/, name: 'LANA-mac-arm64.dmg' },
  { test: /-x64\.dmg$/, name: 'LANA-mac-x64.dmg' },
  { test: /-setup\.exe$/, name: 'LANA-windows-x64-setup.exe' },
  { test: /\.AppImage$/, name: 'LANA-linux-x86_64.AppImage' },
  { test: /\.deb$/, name: 'LANA-linux-amd64.deb' },
  { test: /\.rpm$/, name: 'LANA-linux-x86_64.rpm' }
];

/** Which feed a yml file belongs to: latest-mac-arm64.yml -> latest-mac.yml. */
function feedNameFor(fileName) {
  if (/^latest-mac(-[a-z0-9]+)?\.yml$/.test(fileName)) return 'latest-mac.yml';
  if (/^latest-linux(-[a-z0-9]+)?\.yml$/.test(fileName)) return fileName;
  if (fileName === 'latest.yml') return 'latest.yml';
  return null;
}

/** Point a feed's files at <version>/<file>. Returns a new object. */
function rewriteFeed(feed, version) {
  const prefix = `${version}/`;
  const withPrefix = (p) => (!p || p.startsWith(prefix) || /^https?:/.test(p) ? p : prefix + p);
  const out = Object.assign({}, feed);
  out.files = (feed.files || []).map((f) => Object.assign({}, f, { url: withPrefix(f.url) }));
  if (out.path) out.path = withPrefix(out.path);
  return out;
}

/** Merge feeds of one platform (one per mac arch) into one, files deduplicated by url. */
function mergeFeeds(feeds) {
  if (!feeds.length) return null;
  const versions = new Set(feeds.map((f) => String(f.version)));
  if (versions.size > 1) {
    throw new Error(`Feeds disagree on the version: ${[...versions].join(', ')}`);
  }
  const merged = Object.assign({}, feeds[0]);
  const seen = new Set();
  merged.files = [];
  feeds.forEach((feed) => {
    (feed.files || []).forEach((file) => {
      if (seen.has(file.url)) return;
      seen.add(file.url);
      merged.files.push(file);
    });
  });
  // The newest releaseDate wins; path/sha512 stay those of the first feed (electron-updater reads files[]).
  merged.releaseDate = feeds.map((f) => f.releaseDate).filter(Boolean).sort().pop() || merged.releaseDate;
  return merged;
}

function stableNameFor(fileName) {
  const hit = STABLE_NAMES.find((s) => s.test.test(fileName));
  return hit ? hit.name : null;
}

/** Every file under dir (skipping unpacked app folders and the staging folder). */
function listFiles(dir, skip) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.has(full) || /unpacked$|^mac(-arm64)?$|\.app$/.test(entry.name)) continue;
      out.push(...listFiles(full, skip));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Work out what goes where. Pure apart from reading the dist folder listing and
 * the yml feeds, so it is tested with a temporary folder.
 * @returns {{ version, feeds: Array<{key, body}>, copies: Array<{from, key}> }}
 */
function planRelease(distDir, versionArg) {
  const stageDir = path.join(distDir, 'r2');
  const files = listFiles(distDir, new Set([stageDir]));
  const byName = new Map(files.map((f) => [path.basename(f), f]));

  const groups = new Map();
  files.filter((f) => f.endsWith('.yml')).forEach((f) => {
    const feed = feedNameFor(path.basename(f));
    if (!feed) return;
    if (!groups.has(feed)) groups.set(feed, []);
    groups.get(feed).push(yaml.load(fs.readFileSync(f, 'utf8')));
  });
  if (!groups.size) throw new Error(`No update feeds (latest*.yml) in ${distDir}. Build first.`);

  const feeds = [];
  const copies = [];
  let version = versionArg || null;
  for (const [feedName, list] of groups) {
    const merged = mergeFeeds(list);
    version = version || String(merged.version);
    if (String(merged.version) !== String(version)) {
      throw new Error(`${feedName} is version ${merged.version}, expected ${version}`);
    }
    const names = new Set(merged.files.map((f) => f.url));
    if (merged.path) names.add(merged.path);
    names.forEach((name) => {
      [name, `${name}.blockmap`].forEach((n) => {
        if (byName.has(n)) copies.push({ from: byName.get(n), key: `${PREFIX}/${version}/${n}` });
        else if (n === name) throw new Error(`${feedName} lists ${name} but it is not in ${distDir}`);
      });
    });
    feeds.push({ key: `${PREFIX}/${feedName}`, body: yaml.dump(rewriteFeed(merged, version), { lineWidth: -1 }) });
  }

  // Installers that are not in a feed (deb, rpm) still go under the version folder.
  files.forEach((f) => {
    const name = path.basename(f);
    if (!name.includes(String(version)) || !/\.(dmg|zip|exe|AppImage|deb|rpm)$/.test(name)) return;
    const key = `${PREFIX}/${version}/${name}`;
    if (!copies.some((c) => c.key === key)) copies.push({ from: f, key });
  });

  // Stable names for the download page.
  copies.slice().forEach((c) => {
    const stable = stableNameFor(path.basename(c.from));
    if (stable) copies.push({ from: c.from, key: `${PREFIX}/latest/${stable}` });
  });

  return { version, feeds, copies };
}

function writeStage(distDir, plan) {
  const stageDir = path.join(distDir, 'r2');
  fs.rmSync(stageDir, { recursive: true, force: true });
  plan.copies.forEach((c) => {
    const to = path.join(stageDir, c.key);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(c.from, to);
  });
  plan.feeds.forEach((f) => {
    const to = path.join(stageDir, f.key);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, f.body);
  });
  return stageDir;
}

/** The upload the owner runs later: printed, never executed here. */
function printUploadPlan(stageDir, plan, log = console.log) {
  log('');
  log(`R2 upload (NOT run): stage folder ${stageDir}`);
  log(`Bucket ${BUCKET}, public at ${PUBLIC_BASE}`);
  log('Upload the version folder and latest/ first, then the feeds, so no feed points at a missing file:');
  plan.copies.forEach((c) => log(`  ${c.key}`));
  plan.feeds.forEach((f) => log(`  ${f.key}   (feed, upload last, Cache-Control: no-cache)`));
  log('');
  log('For example, with the bucket credentials in your environment:');
  log(`  aws s3 sync "${path.join(stageDir, PREFIX)}" s3://${BUCKET}/${PREFIX}/ --endpoint-url "$R2_ENDPOINT" --exclude "*.yml"`);
  log(`  aws s3 cp "${path.join(stageDir, PREFIX)}" s3://${BUCKET}/${PREFIX}/ --recursive --exclude "*" --include "*.yml" --cache-control no-cache --endpoint-url "$R2_ENDPOINT"`);
}

function main(argv) {
  const args = { dist: 'dist', version: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') args.dist = argv[++i];
    else if (argv[i] === '--version') args.version = argv[++i];
  }
  const distDir = path.resolve(args.dist);
  const plan = planRelease(distDir, args.version);
  const stageDir = writeStage(distDir, plan);
  printUploadPlan(stageDir, plan);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`stage-client-release: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  BUCKET,
  PUBLIC_BASE,
  feedNameFor,
  rewriteFeed,
  mergeFeeds,
  stableNameFor,
  planRelease,
  writeStage,
  printUploadPlan
};

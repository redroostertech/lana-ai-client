'use strict';

/**
 * Phase 7, publish, and phase 9, verify, on the installer machine.
 *
 * build-client.sh --publish already laid the release out in dist/r2 with
 * stage-client-release.js. Publish uploads it to lana-releases after
 * Michael's yes: every installer, zip and blockmap first, the update feeds
 * (latest*.yml) last, so no app is ever pointed at a file that is not there.
 * Verify asks releases.lanaai.io for every uploaded file and checks that
 * every file a feed names is served.
 */

const fs = require('fs');
const path = require('path');
const { RELEASES_BUCKET } = require('../config');
const { requireYes } = require('../approvals');

const PUBLIC_BASE = 'https://releases.lanaai.io/';
const TYPES = { '.yml': 'text/yaml', '.dmg': 'application/x-apple-diskimage', '.exe': 'application/vnd.microsoft.portable-executable', '.zip': 'application/zip', '.deb': 'application/vnd.debian.binary-package', '.AppImage': 'application/octet-stream', '.blockmap': 'application/octet-stream' };

function listStaged(stageDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {walk(full);} else {out.push(path.relative(stageDir, full).split(path.sep).join('/'));}
    }
  };
  if (fs.existsSync(stageDir)) {walk(stageDir);}
  return out.sort();
}

const isFeed = (key) => /^client\/latest[^/]*\.yml$/.test(key);

/** Upload order: everything else, then the feeds. */
function uploadOrder(keys) {
  return [...keys.filter((key) => !isFeed(key)), ...keys.filter(isFeed)];
}

async function publish(ctx) {
  const stageDir = path.join(ctx.clientRoot, 'dist', 'r2');
  const keys = listStaged(stageDir);
  if (!keys.some((key) => key.startsWith(`client/${ctx.version}/`))) {throw new Error(`Publish: dist/r2 holds nothing for ${ctx.version}. Run the installers phase first.`);}
  if (!keys.some(isFeed)) {throw new Error('Publish: dist/r2 holds no update feeds (latest*.yml).');}
  const order = uploadOrder(keys);
  if (ctx.dryRun) {
    ctx.log(`  [dry run] would upload ${order.length} files to ${RELEASES_BUCKET}, the ${order.filter(isFeed).length} feeds last`);
    return { uploaded: [] };
  }
  requireYes(ctx, 'upload-installers', `${order.length} files to ${RELEASES_BUCKET}`);
  const r2 = await ctx.r2();
  for (const key of order) {
    const ext = Object.keys(TYPES).find((e) => key.endsWith(e));
    // eslint-disable-next-line no-await-in-loop -- in order: the feeds must land last
    await r2.upload(path.join(stageDir, key), RELEASES_BUCKET, key, ext ? TYPES[ext] : undefined);
    ctx.report.uploaded.push(`${RELEASES_BUCKET}/${key}`);
  }
  ctx.state.published = { keys: order, at: new Date().toISOString() };
  ctx.desk('day.uploaded', 'inst.feeds');
  return { uploaded: order };
}

/** Every file a feed names, as a bucket key. */
function feedFiles(feedText) {
  const urls = [];
  for (const line of String(feedText).split('\n')) {
    const match = /^\s*(?:-\s*)?(?:url|path):\s*(\S+)\s*$/.exec(line);
    if (match) {urls.push(match[1]);}
  }
  return [...new Set(urls)].map((url) => `client/${url}`);
}

async function verify(ctx, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const keys = (ctx.state.published && ctx.state.published.keys) || listStaged(path.join(ctx.clientRoot, 'dist', 'r2'));
  if (!keys.length) {throw new Error('Verify: nothing was published by this machine yet.');}
  if (ctx.dryRun) {
    ctx.log(`  [dry run] would check ${keys.length} links on releases.lanaai.io and every file the feeds name`);
    return { problems: [] };
  }
  const problems = [];
  const head = async (key) => {
    const response = await doFetch(`${PUBLIC_BASE}${key}`, { method: 'HEAD' });
    if (response.status !== 200) {problems.push(`${key} answered ${response.status}`);}
  };
  for (const key of keys) {
    // eslint-disable-next-line no-await-in-loop
    await head(key);
  }
  for (const feed of keys.filter(isFeed)) {
    // eslint-disable-next-line no-await-in-loop
    const text = await (await doFetch(`${PUBLIC_BASE}${feed}`)).text();
    for (const key of feedFiles(text)) {
      if (!keys.includes(key)) {
        // eslint-disable-next-line no-await-in-loop
        await head(key);
      }
    }
    if (!text.includes(`version: ${ctx.version}`)) {problems.push(`${feed} does not say version ${ctx.version}`);}
  }
  if (problems.length) {throw new Error(`Verify: ${problems.length} problem(s): ${problems.join('; ')}.`);}
  ctx.desk('day.checked');
  ctx.log(`  All ${keys.length} links answer 200 and every feed points at files that are there.`);
  return { problems };
}

module.exports = { publish, verify, uploadOrder, feedFiles, listStaged, isFeed };

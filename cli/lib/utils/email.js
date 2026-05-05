'use strict';

const fs = require('fs');
const path = require('path');
const { tryGit } = require('./git');
const credsUtil = require('./credentials');

const REPO_OWNER = 'redroostertech';
const REPO_NAME = 'lana-ai-client';

function releaseUrl(tag) {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${tag}`;
}

function assetUrl(tag, fileName) {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}/${encodeURIComponent(
    fileName
  )}`;
}

const PLATFORM_LABELS = {
  'macos-arm64': 'macOS (Apple Silicon)',
  'macos-x64': 'macOS (Intel)',
  windows: 'Windows',
  linux: 'Linux',
};

function changelogSince(prevTag, tag, cwd) {
  if (!prevTag) return '';
  const log = tryGit(
    ['log', `${prevTag}..${tag}`, '--pretty=format:%s', '--no-merges'],
    { cwd }
  );
  if (!log) return '';
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => `  - ${line}`)
    .join('\n');
}

function previousTag(tag, cwd) {
  return tryGit(['describe', '--tags', '--abbrev=0', `${tag}^`], { cwd });
}

/**
 * Write a release email file to dist/.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.tag        — full git tag, e.g. "v4.0.0" or "v4.0.0-pre.abc1234"
 * @param {Array}  opts.artifacts  — { platform, file, sha256, sizeMB }
 * @param {boolean} [opts.preRelease=false]
 * @returns {Promise<string>}      — absolute path of the written email
 */
async function writeReleaseEmail({ repoRoot, tag, artifacts, preRelease = false }) {
  const distDir = path.join(repoRoot, 'dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  const fileName = preRelease
    ? `release-email-${tag}.txt`
    : `release-email-${tag}.txt`;
  const outPath = path.join(distDir, fileName);

  const { values } = credsUtil.load();
  const to = values.RELEASE_EMAIL_TO || '';

  const prev = previousTag(tag, repoRoot);
  const changelog = changelogSince(prev, tag, repoRoot);

  const downloadLines = [];
  for (const [folder, label] of Object.entries(PLATFORM_LABELS)) {
    const items = artifacts.filter((a) => a.platform === folder);
    if (items.length === 0) continue;
    downloadLines.push('');
    downloadLines.push(`${label}:`);
    for (const a of items) {
      downloadLines.push(`  ${assetUrl(tag, a.file)}`);
      downloadLines.push(`    sha256: ${a.sha256}`);
      downloadLines.push(`    size:   ${a.sizeMB} MB`);
    }
  }

  const subject = preRelease
    ? `Lana AI Client ${tag} — pre-release for testing`
    : `Lana AI Client ${tag} is available`;

  const lead = preRelease
    ? `This is a pre-release build of Lana AI Client (${tag}) for testing. ` +
      `Please install one of the builds below and report any issues.`
    : `Lana AI Client ${tag} has been released and is ready for download.`;

  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    '',
    'Hi all,',
    '',
    lead,
    '',
    `Release page: ${releaseUrl(tag)}`,
    '',
    'Downloads:',
    ...downloadLines,
    '',
  ];

  if (changelog) {
    lines.push(preRelease ? 'Changes since the previous tag:' : "What's in this release:");
    lines.push(changelog);
    lines.push('');
  }

  if (preRelease) {
    lines.push(
      'NOTE: This is a pre-release. Do not distribute outside the test group.'
    );
    lines.push('');
  }

  lines.push('— Red Rooster Technologies');
  lines.push('');

  fs.writeFileSync(outPath, lines.join('\n'));
  return outPath;
}

module.exports = { writeReleaseEmail, releaseUrl, assetUrl };

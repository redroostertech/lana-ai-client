'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { getRepoRoot, loadPackageJson } = require('../utils/repo');
const credsUtil = require('../utils/credentials');
const { ensureDeps } = require('../utils/deps');
const { writeReleaseEmail } = require('../utils/email');
const {
  currentBranch,
  workingTreeClean,
  tagsAtHead,
  tagExists,
  git,
  tryGit,
} = require('../utils/git');

const REQUIRED_APPLE_KEYS = ['APPLE_TEAM_ID', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD'];

function ensureCredentials() {
  const { found, values, path: credsPath } = credsUtil.load();
  if (!found) {
    throw new Error(
      `Credentials file not found at ${credsPath}. Run ./install.sh from the repo root, ` +
        'or create the file manually.'
    );
  }
  const missing = REQUIRED_APPLE_KEYS.filter((k) => !values[k]);
  if (missing.length) {
    throw new Error(
      `Missing required credentials in ${credsPath}: ${missing.join(', ')}`
    );
  }
  credsUtil.applyToEnv(values);
  return values;
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

function collectArtifacts(repoRoot) {
  const distDir = path.join(repoRoot, 'dist');
  const platforms = ['macos-arm64', 'macos-x64', 'windows', 'linux'];
  const artifacts = [];
  for (const p of platforms) {
    const dir = path.join(distDir, p);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      if (!/\.(dmg|exe|AppImage|deb|rpm|zip)$/i.test(file)) continue;
      const sha256 = sha256OfFile(full);
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      artifacts.push({
        platform: p,
        file,
        path: full,
        sha256,
        sizeBytes: stat.size,
        sizeMB,
      });
    }
  }
  return artifacts;
}

function commandExists(cmd) {
  const r = spawnSync('which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

function ensureGhAuth() {
  const r = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  if (r.status !== 0) {
    throw new Error('gh CLI is not authenticated. Run: gh auth login');
  }
}

function buildPreReleaseTag(version, shortSha) {
  return `v${version}-pre.${shortSha}`;
}

async function publishPreRelease({ repoRoot, version, artifacts, platform }) {
  ensureGhAuth();

  // Determine sha + tag
  const shortSha = git(['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
  const tag = buildPreReleaseTag(version, shortSha);

  // Refuse if a GH release already exists for this tag — avoids silent double-publish
  const existing = spawnSync('gh', ['release', 'view', tag], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  if (existing.status === 0) {
    throw new Error(
      `A GitHub release already exists for ${tag}. Delete it manually with ` +
        `"gh release delete ${tag} --cleanup-tag" before re-running.`
    );
  }

  // Create local tag if missing
  if (!tagExists(tag, repoRoot)) {
    console.log(`Tagging HEAD as ${tag}…`);
    spawnSync('git', ['tag', '-a', tag, '-m', `Pre-release ${tag}`], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } else {
    console.log(`Tag ${tag} already exists locally; reusing.`);
  }

  // Push tag (only the tag — branch state isn't required)
  console.log(`Pushing tag ${tag} to origin…`);
  const push = spawnSync('git', ['push', 'origin', tag], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (push.status !== 0) {
    throw new Error(`git push origin ${tag} failed`);
  }

  // Compose release notes from commits since previous tag (if any)
  const prevTag = tryGit(['describe', '--tags', '--abbrev=0', `${tag}^`], {
    cwd: repoRoot,
  });
  let notes = `## Pre-release ${tag}\n\nBuilt for testing — please do not redistribute.\n`;
  if (prevTag) {
    const log = tryGit(
      ['log', `${prevTag}..${tag}`, '--pretty=format:- %s (%h)', '--no-merges'],
      { cwd: repoRoot }
    );
    if (log) {
      notes += `\n### Changes since ${prevTag}\n\n${log}\n`;
    }
  }
  if (platform && platform !== 'all') {
    notes += `\nThis pre-release contains \`${platform}\` artifacts only.\n`;
  }

  // Create the GitHub release as prerelease
  console.log(`Creating GitHub pre-release ${tag}…`);
  const create = spawnSync(
    'gh',
    [
      'release',
      'create',
      tag,
      '--title',
      tag,
      '--prerelease',
      '--notes',
      notes,
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  if (create.status !== 0) {
    throw new Error(`gh release create ${tag} failed`);
  }

  // Upload artifacts
  if (artifacts.length === 0) {
    console.warn('No artifacts to upload — pre-release created with no files.');
  } else {
    console.log(`Uploading ${artifacts.length} artifact(s)…`);
    for (const a of artifacts) {
      const r = spawnSync('gh', ['release', 'upload', tag, a.path, '--clobber'], {
        cwd: repoRoot,
        stdio: 'inherit',
      });
      if (r.status !== 0) {
        throw new Error(`gh release upload failed for ${a.file}`);
      }
    }
  }

  // Email
  const emailPath = await writeReleaseEmail({
    repoRoot,
    tag,
    artifacts,
    preRelease: true,
  });

  console.log('');
  console.log(`✓ Pre-release ${tag} published`);
  console.log(`  Page:  https://github.com/redroostertech/lana-ai-client/releases/tag/${tag}`);
  console.log(`  Email: ${emailPath}`);
}

module.exports = async function builds(target, options) {
  if (target !== 'builds') {
    throw new Error(
      `Unknown target "${target}". Did you mean: lana-client generate builds`
    );
  }

  if (options.publish && options.publishPreRelease) {
    throw new Error(
      'Use either --publish or --publish-pre-release, not both.'
    );
  }

  const repoRoot = getRepoRoot();
  const pkg = loadPackageJson(repoRoot);
  const version = pkg.version;
  const tag = `v${version}`;

  // Validation for formal-release publish
  if (options.publish) {
    const branch = currentBranch(repoRoot);
    if (branch !== 'release') {
      throw new Error(
        `--publish requires the "release" branch (currently on "${branch}").`
      );
    }
    const atHead = tagsAtHead(repoRoot);
    if (!atHead.includes(tag)) {
      throw new Error(
        `--publish expected tag ${tag} at HEAD, but HEAD has: ${
          atHead.join(', ') || '(none)'
        }. Run "lana-client prepare release" first.`
      );
    }
    if (!workingTreeClean(repoRoot)) {
      throw new Error('Working tree is not clean. Commit or stash changes first.');
    }

    if (!commandExists('gh')) {
      throw new Error(
        '--publish requires the GitHub CLI (gh). Install with: brew install gh'
      );
    }
  }

  // Validation for pre-release publish (no branch / tag-at-HEAD requirement —
  // we tag whatever HEAD is, so the pre-release is reproducible from sha).
  if (options.publishPreRelease) {
    if (!workingTreeClean(repoRoot)) {
      throw new Error(
        'Working tree is not clean. Commit or stash changes first so the pre-release tag points at a real state.'
      );
    }
    if (!commandExists('gh')) {
      throw new Error(
        '--publish-pre-release requires the GitHub CLI (gh). Install with: brew install gh'
      );
    }
  }

  ensureCredentials();

  // ensureDeps owns the install decision (smart, mtime-based). The bash
  // build script always gets --skip-install so we don't double-install.
  if (!options.skipInstall) {
    ensureDeps(repoRoot);
  }

  // Pre-release path drives publishing from the CLI itself, so we only
  // ask build-client.sh to build locally (no --publish flag passed through).
  const buildArgs = [
    '--auto-discovery',
    '--platform',
    options.platform || 'all',
    '--skip-install',
  ];
  if (options.publish) buildArgs.push('--publish');

  console.log(`Running: scripts/build-client.sh ${buildArgs.join(' ')}`);
  const result = spawnSync(
    'bash',
    [path.join(repoRoot, 'scripts/build-client.sh'), ...buildArgs],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    }
  );
  if (result.status !== 0) {
    throw new Error(`build-client.sh exited with code ${result.status}`);
  }

  const artifacts = collectArtifacts(repoRoot);
  if (artifacts.length === 0) {
    console.warn('No artifacts found under dist/. Check the build output above.');
  } else {
    console.log('');
    console.log('Artifacts:');
    for (const a of artifacts) {
      console.log(
        `  ${a.platform}/${a.file}  ${a.sizeMB} MB  sha256:${a.sha256.slice(0, 16)}…`
      );
    }
  }

  if (options.publish) {
    const emailPath = await writeReleaseEmail({
      repoRoot,
      tag,
      artifacts,
      preRelease: false,
    });
    console.log('');
    console.log(`✓ Release email written to: ${emailPath}`);
  } else if (options.publishPreRelease) {
    await publishPreRelease({
      repoRoot,
      version,
      artifacts,
      platform: options.platform,
    });
  }
};

'use strict';

const { spawnSync } = require('child_process');
const { getRepoRoot } = require('../utils/repo');
const { tryGit, gitInherit, workingTreeClean } = require('../utils/git');

function hasUpstream(branch, cwd) {
  const r = spawnSync(
    'git',
    ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`],
    { cwd, stdio: 'ignore' }
  );
  return r.status === 0;
}

module.exports = async function finish(target) {
  if (target !== 'release') {
    throw new Error(
      `Unknown target "${target}". Did you mean: lana-client finish release`
    );
  }

  const repoRoot = getRepoRoot();

  if (!workingTreeClean(repoRoot)) {
    throw new Error('Working tree is not clean. Commit or stash changes first.');
  }

  // Latest tag on the release branch
  const latestTag = tryGit(['describe', '--tags', '--abbrev=0', 'release'], {
    cwd: repoRoot,
  });
  if (!latestTag) {
    throw new Error('Could not find any tag on the release branch.');
  }
  const tagSha = tryGit(['rev-list', '-n', '1', latestTag], { cwd: repoRoot });
  if (!tagSha) {
    throw new Error(`Could not resolve commit for ${latestTag}.`);
  }

  console.log(
    `Cherry-picking ${latestTag} (${tagSha.slice(0, 8)}) onto development…`
  );

  // Switch to development
  console.log('Switching to development…');
  gitInherit(['checkout', 'development'], { cwd: repoRoot });

  // Pull only if there's a tracked upstream
  if (hasUpstream('development', repoRoot)) {
    console.log('Pulling latest (--ff-only)…');
    const pull = spawnSync('git', ['pull', '--ff-only'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (pull.status !== 0) {
      throw new Error(
        'git pull --ff-only failed. Resolve the divergence manually, then re-run.'
      );
    }
  } else {
    console.log('No upstream set on development; skipping pull.');
  }

  // Already cherry-picked? (commit subject match — soft check)
  const already = tryGit(
    ['log', '--oneline', `-1`, `--grep=chore: bump to ${latestTag}`, 'development'],
    { cwd: repoRoot }
  );
  if (already) {
    console.log(
      `Note: development already has a commit matching "chore: bump to ${latestTag}":`
    );
    console.log(`  ${already}`);
    console.log('Skipping cherry-pick. Nothing to do.');
    return;
  }

  // Cherry-pick
  const cp = spawnSync('git', ['cherry-pick', tagSha], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (cp.status !== 0) {
    console.error('');
    console.error('Cherry-pick failed (likely a conflict). Aborting…');
    spawnSync('git', ['cherry-pick', '--abort'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    throw new Error(
      `Could not cleanly cherry-pick ${latestTag} onto development. Resolve manually.`
    );
  }

  console.log('');
  console.log(`✓ Cherry-picked ${latestTag} onto development.`);
  console.log('');
  console.log('Next: review the new commit and push when ready (e.g., open a PR).');
};

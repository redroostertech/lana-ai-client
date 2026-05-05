'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { getRepoRoot, loadPackageJson } = require('../utils/repo');
const { ensureDeps } = require('../utils/deps');
const {
  currentBranch,
  workingTreeClean,
  tagsAtHead,
  tagExists,
  gitInherit,
  tryGit,
} = require('../utils/git');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function bumpSemver(current, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!m) throw new Error(`Cannot parse current version "${current}"`);
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (kind === 'patch') patch += 1;
  else if (kind === 'minor') {
    minor += 1;
    patch = 0;
  } else if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  }
  return `${major}.${minor}.${patch}`;
}

module.exports = async function prepare(target) {
  if (target !== 'release') {
    throw new Error(
      `Unknown target "${target}". Did you mean: lana-client prepare release`
    );
  }

  const repoRoot = getRepoRoot();

  // Ensure deps are current before we do anything that depends on them
  // (e.g. generate-version.js below). Done first so that if npm install
  // bumps package-lock.json, the working-tree check below catches it.
  ensureDeps(repoRoot);

  // 1. Branch + tree checks
  const branch = currentBranch(repoRoot);
  if (branch !== 'release') {
    throw new Error(
      `Must be on the "release" branch (currently on "${branch}"). Switch with: git checkout release`
    );
  }

  if (!workingTreeClean(repoRoot)) {
    throw new Error('Working tree is not clean. Commit or stash changes first.');
  }

  const existing = tagsAtHead(repoRoot);
  if (existing.length > 0) {
    throw new Error(
      `HEAD already has tag(s): ${existing.join(', ')}. Nothing to release at this commit.`
    );
  }

  // 2. Read current version, prompt for new
  const pkg = loadPackageJson(repoRoot);
  const current = pkg.version;

  console.log('');
  console.log(`Current version: ${current}`);
  console.log('');
  console.log('Choose new version:');
  console.log(`  1) patch   ${bumpSemver(current, 'patch')}`);
  console.log(`  2) minor   ${bumpSemver(current, 'minor')}`);
  console.log(`  3) major   ${bumpSemver(current, 'major')}`);
  console.log('  4) custom');
  console.log('');

  const choice = await ask('Choice [1-4]: ');
  let newVersion;
  if (choice === '1') newVersion = bumpSemver(current, 'patch');
  else if (choice === '2') newVersion = bumpSemver(current, 'minor');
  else if (choice === '3') newVersion = bumpSemver(current, 'major');
  else if (choice === '4') {
    newVersion = await ask('Enter custom version (X.Y.Z): ');
    if (!/^\d+\.\d+\.\d+/.test(newVersion)) {
      throw new Error(`Invalid version "${newVersion}". Expected X.Y.Z.`);
    }
  } else {
    throw new Error(`Invalid choice "${choice}".`);
  }

  if (tagExists(`v${newVersion}`, repoRoot)) {
    throw new Error(
      `Tag v${newVersion} already exists. Pick a different version or delete the existing tag first.`
    );
  }

  const releaseTypeAnswer = await ask(
    `Release type [stable / beta / rc / alpha / dev] (default stable): `
  );
  const releaseType = releaseTypeAnswer || 'stable';
  const buildNumberAnswer = await ask('Build number [1]: ');
  const buildNumber = buildNumberAnswer || '1';

  // 3. Show changelog from previous tag
  const prevTag = tryGit(['describe', '--tags', '--abbrev=0'], { cwd: repoRoot });
  if (prevTag) {
    console.log('');
    console.log(`Commits since ${prevTag}:`);
    const log = tryGit(
      ['log', `${prevTag}..HEAD`, '--oneline', '--no-merges'],
      { cwd: repoRoot }
    );
    console.log(log || '  (none)');
  }

  console.log('');
  console.log('About to:');
  console.log(`  • bump package.json from ${current} → ${newVersion}`);
  console.log(`  • set releaseType=${releaseType}, buildNumber=${buildNumber}`);
  console.log('  • run scripts/generate-version.js');
  console.log('  • commit "chore: bump to v' + newVersion + '"');
  console.log(`  • create local tag v${newVersion}`);
  console.log('');

  const confirm = await ask('Proceed? [y/N]: ');
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log('Aborted.');
    return;
  }

  // 4. Bump package.json
  pkg.version = newVersion;
  pkg.releaseType = releaseType;
  pkg.buildNumber = buildNumber;
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );

  // 5. Run generate-version
  console.log('Running scripts/generate-version.js…');
  execFileSync('node', ['scripts/generate-version.js'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  // 6. Stage tracked version files (.env is gitignored, intentionally skipped)
  gitInherit(
    ['add', 'package.json', 'src/version.js', 'public_html/js/version.js'],
    { cwd: repoRoot }
  );
  gitInherit(['commit', '-m', `chore: bump to v${newVersion}`], { cwd: repoRoot });
  gitInherit(['tag', '-a', `v${newVersion}`, '-m', `Release v${newVersion}`], {
    cwd: repoRoot,
  });

  console.log('');
  console.log(`✓ Bumped to v${newVersion} on release (commit + tag created locally).`);
  console.log('');
  console.log('Next:');
  console.log('  lana-client generate builds           # build all platforms locally');
  console.log('  lana-client generate builds --publish # build, push, GH release, email');
};

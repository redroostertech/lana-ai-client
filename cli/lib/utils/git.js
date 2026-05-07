'use strict';

const { execFileSync, spawnSync } = require('child_process');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .toString()
    .trim();
}

function gitInherit(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: opts.cwd,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${r.status})`);
  }
}

function tryGit(args, opts = {}) {
  try {
    return git(args, opts);
  } catch (_) {
    return null;
  }
}

function tagsAtHead(cwd) {
  const out = tryGit(['tag', '--points-at', 'HEAD'], { cwd });
  if (!out) return [];
  return out.split('\n').filter(Boolean);
}

function workingTreeClean(cwd) {
  const status = tryGit(['status', '--porcelain'], { cwd });
  return status === '' || status === null;
}

function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
}

function tagExists(tag, cwd) {
  const r = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    cwd,
    stdio: 'ignore',
  });
  return r.status === 0;
}

module.exports = {
  git,
  gitInherit,
  tryGit,
  tagsAtHead,
  workingTreeClean,
  currentBranch,
  tagExists,
};

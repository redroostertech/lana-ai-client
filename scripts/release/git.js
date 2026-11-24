'use strict';

/**
 * Reading branch tips, tags and pinned files. Remote reads use git ls-remote
 * and the gh command with the person's own login; nothing here writes.
 */

const { scrub } = require('./exec');

function githubUrl(repo) {
  return `https://github.com/${repo}.git`;
}

function createGit({ run }) {
  async function git(args, what, options = {}) {
    const result = await run('git', args, options);
    if (result.code !== 0) {throw new Error(`git: could not ${what} (${scrub(result.stderr)}).`);}
    return result.stdout.trim();
  }

  return {
    /** The commit a branch points at on GitHub, or null when the branch does not exist. */
    async tip(repo, branch) {
      const out = await git(['ls-remote', githubUrl(repo), `refs/heads/${branch}`], `read ${repo} ${branch}`);
      return out ? out.split(/\s+/)[0] : null;
    },
    /** The commit a tag names (an annotated tag is followed to its commit), or null. */
    async tagCommit(repo, tag) {
      const out = await git(['ls-remote', githubUrl(repo), `refs/tags/${tag}`, `refs/tags/${tag}^{}`], `read ${repo} tag ${tag}`);
      const lines = out.split('\n').filter(Boolean).map((line) => line.split(/\s+/));
      const peeled = lines.find(([, ref]) => ref.endsWith('^{}'));
      return (peeled || lines[0] || [null])[0];
    },
    /**
     * True when commit is on branch (GitHub compare: the branch is the same as
     * the commit or ahead of it).
     */
    async reachable(repo, commit, branch) {
      const result = await run('gh', ['api', `repos/${repo}/compare/${commit}...${branch}`, '--jq', '.status']);
      if (result.code !== 0) {throw new Error(`gh: could not compare ${repo} ${commit.slice(0, 12)} with ${branch} (${scrub(result.stderr)}).`);}
      return ['ahead', 'identical'].includes(result.stdout.trim());
    },
    /** A file's text at a ref on GitHub, read with the person's gh login. */
    async remoteFile(repo, ref, file) {
      const result = await run('gh', ['api', `repos/${repo}/contents/${file}?ref=${ref}`, '-H', 'Accept: application/vnd.github.raw']);
      if (result.code !== 0) {throw new Error(`gh: could not read ${repo} ${file} at ${ref} (${scrub(result.stderr)}).`);}
      return result.stdout;
    },
    async fetch(dir, refs) {
      await git(['-C', dir, 'fetch', '--quiet', 'origin', ...refs], `fetch ${refs.join(' ')} in ${dir}`);
    },
    /** A file's text at a ref in a local checkout. */
    async show(dir, ref, file) {
      return git(['-C', dir, 'show', `${ref}:${file}`], `read ${file} at ${ref}`);
    },
    async head(dir) {
      return git(['-C', dir, 'rev-parse', 'HEAD'], `read HEAD in ${dir}`);
    },
    async clean(dir) {
      return (await git(['-C', dir, 'status', '--porcelain', '--untracked-files=no'], `read the status of ${dir}`)) === '';
    },
    git
  };
}

module.exports = { githubUrl, createGit };

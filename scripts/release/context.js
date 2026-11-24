'use strict';

/**
 * Everything one run needs, in one object the phases share. Tests build it
 * with fake deps (run, git, r2, log) and an in-memory state.
 */

const path = require('path');
const { TARGETS, REPOS } = require('./config');
const { createGit } = require('./git');
const { createR2, readR2Keys } = require('./r2');
const { run: realRun } = require('./exec');
const { loadState, releaseDir } = require('./state');

const PIN_FILES = Object.freeze({
  pip: 'pip/pip-pin.json',
  engine: 'engine/engine-pin.json',
  redactor: 'redactor/redactor-pin.json',
  editor: 'editor/editor.lock.json'
});

/**
 * @param {Object} options - parsed command line
 * @param {Object} [deps] - { run, git, r2, log, env, home } for tests
 */
function createContext(options, deps = {}) {
  const run = deps.run || realRun;
  const env = deps.env || process.env;
  const log = deps.log || ((line) => process.stdout.write(`${line}\n`));
  const git = deps.git || createGit({ run });
  let r2 = deps.r2 || null;

  const ctx = {
    version: options.version,
    serverVersion: options.serverVersion || null,
    mode: options.mode,
    phase: options.phase || null,
    targets: options.targets && options.targets.length ? options.targets : [...TARGETS],
    dryRun: Boolean(options.dryRun),
    yes: options.yes || new Set(),
    clientRoot: path.resolve(options.clientRoot || path.join(__dirname, '..', '..')),
    serverRepo: options.serverRepo ? path.resolve(options.serverRepo) : null,
    home: deps.home,
    workDir: options.workDir || env.LANA_RELEASE_HOME || null,
    dir: releaseDir(options.version, deps.home, options.workDir || env.LANA_RELEASE_HOME || null),
    state: deps.state || loadState(options.version, deps.home, options.workDir || env.LANA_RELEASE_HOME || null),
    run, env, log, git,
    // What this run did, for the summary.
    report: { built: [], uploaded: [], desk: [], waiting: [], notes: [], problems: [] },
    async r2() {
      if (!r2) {r2 = createR2({ run, keys: await readR2Keys(run, env), env });}
      return r2;
    },
    /** The client's pins at a ref of the client checkout (origin/production by default). */
    async pinsAt(ref = 'origin/production') {
      const read = async (file) => JSON.parse(await git.show(ctx.clientRoot, ref, file));
      return { pip: await read(PIN_FILES.pip), engine: await read(PIN_FILES.engine), redactor: await read(PIN_FILES.redactor), editor: await read(PIN_FILES.editor) };
    },
    async packageVersionAt(ref = 'origin/production') {
      return JSON.parse(await git.show(ctx.clientRoot, ref, 'package.json')).version;
    },
    desk(...keys) {
      for (const key of keys) {if (!ctx.report.desk.includes(key)) {ctx.report.desk.push(key);}}
    },
    repos: REPOS
  };
  return ctx;
}

module.exports = { PIN_FILES, createContext };

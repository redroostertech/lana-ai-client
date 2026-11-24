#!/usr/bin/env node
'use strict';

/**
 * The LANA AI release, one command per machine.
 *
 *   npm run release -- <mode> --version <x.y.z> [options]
 *
 * Modes:
 *   status       either machine: what is done (R2, pins, branch tips); changes nothing
 *   parts        the parts Mac: preflight, pieces, pins and version, production gate
 *   server       the parts Mac: classifiers, Railway images, signed server update, stamp
 *   installers   the installer machine: preflight, links file, all four installers
 *   publish      the installer machine: upload (feeds last), then check every link
 *   firms        the parts Mac: what to check and do for each firm before promoting
 *
 * Options:
 *   --phase <name>        run one phase of the mode only
 *   --target <system>     macos-arm64, macos-x64, windows-x64 or linux-x64 (repeatable)
 *   --dry-run             read and plan only: build, upload and push nothing
 *   --yes <step>          Michael said yes to this step (repeatable or comma list):
 *                         azure-vms, production, server-release, railway-images,
 *                         upload-installers, firm-update, promote
 *   --server-repo <path>  a LANA-AI checkout (parts and server modes)
 *   --server-version <v>  the server release number (server mode)
 *   --railway-redactor-commit <sha>, --registry-password-file <file>,
 *   --signing-key-file <file>, --signing-key-id <id>   (server mode)
 *   --server-published    the staged server release was finished by hand (attestation)
 *
 * Exit codes: 0 done, 1 failed, 10 waiting on Michael's yes or review.
 *   --work-dir <dir>      where the release folder lives (default ~/.lana-release;
 *                         also LANA_RELEASE_HOME): sources, builds, archives, state
 *
 * State: <work dir>/<version>/state.json. A rerun picks up where it stopped.
 */

const { MODES, PHASES, TARGETS } = require('./release/config');
const { parseYes, WAITING_EXIT } = require('./release/approvals');
const { createContext } = require('./release/context');
const { saveState, markPhase } = require('./release/state');
const { summary } = require('./release/summary');

const PHASE_RUNNERS = {
  preflight: (ctx) => require('./release/phases/preflight').preflight(ctx),
  pieces: (ctx) => require('./release/phases/pieces').pieces(ctx),
  pins: (ctx) => require('./release/phases/pins').pins(ctx),
  gate: (ctx) => require('./release/phases/gate').gate(ctx),
  server: (ctx, options) => require('./release/phases/server').server(ctx, options),
  installers: (ctx) => require('./release/phases/installers').installers(ctx),
  publish: (ctx) => require('./release/phases/publish').publish(ctx),
  verify: (ctx) => require('./release/phases/publish').verify(ctx),
  firms: (ctx) => require('./release/phases/firms').firms(ctx)
};

const VALUE_FLAGS = {
  '--version': 'version', '--phase': 'phase', '--server-repo': 'serverRepo', '--server-version': 'serverVersion',
  '--railway-redactor-commit': 'railwayRedactorCommit', '--registry-password-file': 'registryPasswordFile',
  '--signing-key-file': 'signingKeyFile', '--signing-key-id': 'signingKeyId', '--client-root': 'clientRoot',
  '--work-dir': 'workDir'
};

function parseArgs(argv) {
  const options = { targets: [], yesValues: [] };
  const args = [...argv];
  options.mode = args.shift();
  while (args.length) {
    const flag = args.shift();
    if (flag === '--dry-run') {options.dryRun = true;}
    else if (flag === '--server-published') {options.serverPublished = true;}
    else if (flag === '--target') {options.targets.push(args.shift());}
    else if (flag === '--yes') {options.yesValues.push(args.shift());}
    else if (VALUE_FLAGS[flag]) {options[VALUE_FLAGS[flag]] = args.shift();}
    else {throw new Error(`Unknown option ${flag}. See the top of scripts/release.js.`);}
  }
  if (!MODES[options.mode]) {throw new Error(`The first word must be a mode: ${Object.keys(MODES).join(', ')}.`);}
  if (!options.version) {throw new Error('Pass --version <x.y.z>, for example --version 4.2.0.');}
  for (const target of options.targets) {
    if (!TARGETS.includes(target)) {throw new Error(`--target ${target} is not one of ${TARGETS.join(', ')}.`);}
  }
  if (options.phase) {
    if (!PHASES.includes(options.phase)) {throw new Error(`--phase ${options.phase} is not one of ${PHASES.join(', ')}.`);}
    if (!MODES[options.mode].phases.includes(options.phase)) {
      throw new Error(`The ${options.phase} phase belongs to another mode; ${options.mode} runs ${MODES[options.mode].phases.join(', ') || 'no phases'}.`);
    }
  }
  options.yes = parseYes(options.yesValues);
  return options;
}

/**
 * Runs the mode's phases in order (or one with --phase). A phase finished on
 * an earlier run is run again: each one checks what is already done, so a
 * rerun is safe and cheap. A phase that stops for review or a yes ends the run.
 */
async function main(argv, deps = {}) {
  const options = parseArgs(argv);
  const ctx = createContext(options, deps);
  const phases = options.mode === 'status' ? ['status'] : options.phase ? [options.phase] : MODES[options.mode].phases;
  let outcome = 'done';
  let code = 0;
  try {
    for (const phase of phases) {
      ctx.log(`== ${phase}`);
      // eslint-disable-next-line no-await-in-loop -- phases run in order
      const result = phase === 'status' ? await require('./release/phases/status').status(ctx) : await PHASE_RUNNERS[phase](ctx, options);
      if (!ctx.dryRun && phase !== 'status') {markPhase(ctx.state, phase, ctx.report.desk);}
      if (result && result.stop) {
        outcome = `stopped after ${phase}, waiting for review`;
        code = WAITING_EXIT;
        break;
      }
    }
  } catch (error) {
    if (error.code === 'APPROVAL_NEEDED') {
      ctx.report.waiting.push(error.message);
      outcome = `stopped: ${error.message}`;
      code = WAITING_EXIT;
    } else {
      ctx.report.problems.push(error.message);
      outcome = `failed: ${error.message}`;
      code = 1;
    }
  } finally {
    if (!ctx.dryRun) {saveState(ctx.state, ctx.home, ctx.workDir);}
  }
  ctx.log(summary(ctx, outcome));
  return code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`release: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs, PHASE_RUNNERS };

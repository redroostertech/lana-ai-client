#!/usr/bin/env node

'use strict';

const path = require('path');
const { Command } = require('commander');

const pkg = require(path.join(__dirname, 'package.json'));

const program = new Command();

program
  .name('lana-client')
  .description('Lana AI Client CLI — run, release, and build the Electron client')
  .version(pkg.version, '-V, --version', 'Output the current version');

program
  .command('run <env>')
  .description('Launch the Electron client (env: dev | prod)')
  .action(async (env) => {
    try {
      const run = require('./lib/commands/run');
      await run(env);
    } catch (err) {
      console.error(`run failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('prepare <target>')
  .description('Prepare a release on the release branch (target: release)')
  .action(async (target) => {
    try {
      const prepare = require('./lib/commands/prepare');
      await prepare(target);
    } catch (err) {
      console.error(`prepare failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('generate <target>')
  .description('Generate builds (target: builds). All platforms by default.')
  .option('--publish', 'Push tag, create GitHub release, write release email', false)
  .option(
    '--publish-pre-release',
    'Build, push pre-release tag, create GitHub pre-release (for testers)',
    false
  )
  .option('--platform <platform>', 'Override platform (mac|windows|linux|all)', 'all')
  .option('--skip-install', 'Skip dependency check + npm install (assume node_modules is current)', false)
  .action(async (target, options) => {
    try {
      const builds = require('./lib/commands/builds');
      await builds(target, options);
    } catch (err) {
      console.error(`generate failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('finish <target>')
  .description('Finish a release: cherry-pick latest tag back to development (target: release)')
  .action(async (target) => {
    try {
      const finish = require('./lib/commands/finish');
      await finish(target);
    } catch (err) {
      console.error(`finish failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});

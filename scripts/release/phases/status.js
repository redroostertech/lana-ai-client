'use strict';

/**
 * status: what is done, from R2, the pins and the branch tips, so neither
 * agent guesses. It changes nothing.
 */

const { PARTS_BUCKET, RELEASES_BUCKET, TARGETS, PARTS, REPOS, DESK_SYSTEM, deskKey } = require('../config');
const { allPieces } = require('../pieces');

async function status(ctx) {
  const { git } = ctx;
  await git.fetch(ctx.clientRoot, ['production', 'development']);
  const tips = {
    server: await git.tip(REPOS.server, 'production'),
    clientProd: await git.git(['-C', ctx.clientRoot, 'rev-parse', 'origin/production'], 'read production'),
    clientDev: await git.git(['-C', ctx.clientRoot, 'rev-parse', 'origin/development'], 'read development')
  };
  const pins = await ctx.pinsAt('origin/production');
  const version = await ctx.packageVersionAt('origin/production');
  const r2 = await ctx.r2();
  const listing = await r2.list(PARTS_BUCKET, '');
  const pieces = allPieces({ listing, pins, targets: TARGETS });
  const published = await r2.list(RELEASES_BUCKET, `client/${ctx.version}/`);

  ctx.log(`LANA AI ${ctx.version}`);
  ctx.log(`  Server production ${tips.server.slice(0, 9)}; the engine pin says ${String(pins.engine.commit).slice(0, 9)}${pins.engine.commit === tips.server ? ' (same)' : ' (DIFFERENT)'}`);
  ctx.log(`  Client production ${tips.clientProd.slice(0, 9)}, development ${tips.clientDev.slice(0, 9)}; production says version ${version}${version === ctx.version ? '' : ` (not ${ctx.version} yet)`}`);
  ctx.log('');
  ctx.log(`  ${'System'.padEnd(13)}${PARTS.map((p) => p.padEnd(12)).join('')}`);
  const label = { ready: 'READY', unpinned: 'NO PIN', missing: 'MISSING' };
  for (const target of TARGETS) {
    const row = PARTS.map((part) => label[pieces.find((p) => p.target === target && p.part === part).state].padEnd(12)).join('');
    ctx.log(`  ${target.padEnd(13)}${row}`);
  }
  ctx.log('  READY = in R2 and pinned on production; NO PIN = in R2, its pin entry not on production yet; MISSING = not built.');
  ctx.log('');
  ctx.log(`  Installers in lana-releases for ${ctx.version}: ${published.length ? `${published.length} files` : 'none yet'}`);
  const done = Object.keys(ctx.state.phases).filter((p) => ctx.state.phases[p].done);
  ctx.log(`  Phases this machine finished: ${done.length ? done.join(', ') : 'none'}`);

  for (const p of pieces) {if (p.state !== 'missing') {ctx.desk(deskKey(p.target, p.part));}}
  if (pins.engine.commit === tips.server) {ctx.desk('gate.servercode');}
  if (version === ctx.version) {ctx.desk('gate.version');}
  if (published.length) {ctx.desk('day.uploaded');}
  return { tips, pieces, version, published: published.length, systems: DESK_SYSTEM };
}

module.exports = { status };

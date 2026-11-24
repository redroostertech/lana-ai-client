'use strict';

/**
 * Phase 2, pieces: build what the bucket does not already hold, for every
 * system at once, and upload it.
 *
 * A piece is skipped when its archive and .sha256 are in lana-build-parts:
 * either the one the pin points at, or (when the pin has no entry yet) one
 * built earlier, whose entry the pins phase records from the archive itself.
 * Windows and Linux need Azure VMs, which need Michael's yes once per run.
 */

const { PARTS_BUCKET, BUILT_ON, deskKey } = require('../config');
const { allPieces } = require('../pieces');
const { requireYes } = require('../approvals');
const builders = require('../builders');

function planPieces(statuses) {
  const byTarget = {};
  for (const status of statuses) {
    if (status.state === 'missing') {(byTarget[status.target] = byTarget[status.target] || []).push(status.part);}
  }
  return byTarget;
}

async function pieces(ctx, deps = {}) {
  const build = { mac: deps.buildMac || builders.buildMac, azure: deps.buildAzure || builders.buildAzure };
  const r2 = await ctx.r2();
  // Every system builds from this one client production commit.
  await ctx.git.fetch(ctx.clientRoot, ['production']);
  ctx.clientCommit = await ctx.git.git(['-C', ctx.clientRoot, 'rev-parse', 'origin/production'], 'read client production');
  const pins = await ctx.pinsAt(ctx.clientCommit);
  const listing = await r2.list(PARTS_BUCKET, '');
  const statuses = allPieces({ listing, pins, targets: ctx.targets });

  for (const s of statuses) {
    const why = s.state === 'ready' ? 'in R2, pinned' : s.state === 'unpinned' ? 'in R2, pin entry not recorded yet' : `to build: ${s.reason}`;
    ctx.log(`  ${s.target}/${s.part}: ${why}`);
    if (s.state !== 'missing') {ctx.desk(deskKey(s.target, s.part));}
  }
  const plan = planPieces(statuses);
  const targets = Object.keys(plan);
  if (!targets.length) {
    ctx.log('  Every piece is in the bucket. Nothing to build.');
    return { built: [] };
  }
  if (ctx.dryRun) {
    for (const target of targets) {ctx.log(`  [dry run] would build ${plan[target].join(', ')} for ${target} (${BUILT_ON[target]})`);}
    return { built: [] };
  }
  if (targets.some((t) => BUILT_ON[t] === 'azure')) {requireYes(ctx, 'azure-vms', targets.filter((t) => BUILT_ON[t] === 'azure').join(', '));}

  // Every system at once; one failing does not stop the others.
  const results = await Promise.allSettled(targets.map((target) => (BUILT_ON[target] === 'azure' ? build.azure : build.mac)(ctx, target, plan[target], pins)
    .then((done) => ({ target, done }))));
  const failed = [];
  results.forEach((result, index) => {
    const target = targets[index];
    if (result.status === 'rejected') {
      failed.push(`${target}: ${result.reason.message}`);
      return;
    }
    for (const piece of result.value.done) {
      ctx.report.built.push(`${target}/${piece.part}`);
      ctx.desk(deskKey(target, piece.part));
      if (piece.newEntry) {ctx.state.newEntries[`${target}/${piece.part}`] = piece.newEntry;}
      ctx.state.pieces[`${target}/${piece.part}`] = { key: piece.key, at: new Date().toISOString() };
    }
  });
  if (failed.length) {
    const error = new Error(`Pieces: ${failed.length} system(s) failed. ${failed.join(' ')}`);
    error.partial = true;
    throw error;
  }
  return { built: ctx.report.built };
}

module.exports = { pieces, planPieces };

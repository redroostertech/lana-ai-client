'use strict';

/**
 * Phase 4, production gate. After the pins branch is reviewed and merged to
 * development, and with Michael's yes, client production moves to
 * development (fast-forward only). Then the parts machine prints the handoff
 * for the installer agent.
 */

const { REPOS, PARTS_BUCKET, TARGETS } = require('../config');
const { allPieces } = require('../pieces');
const { requireYes } = require('../approvals');

function handoffText({ version, commit }) {
  return [
    `LANA AI ${version}: ready for the installer build.`,
    '',
    `1. Check out lana-ai-client production at ${commit} in a clean clone (it carries every pin entry and the version ${version}).`,
    '2. npm ci',
    '3. Read the R2 keys from Heroku yourself (heroku login). Nothing secret is in this message.',
    `4. npm run release -- installers --version ${version}`,
    '   It checks the 12 pieces and the signing setup, makes its own fresh links file, and builds all four installers in one session.',
    `5. npm run release -- publish --version ${version}`,
    '   It stops before uploading and waits for Michael\'s yes (--yes upload-installers).'
  ].join('\n');
}

async function gate(ctx) {
  const { git } = ctx;
  await git.fetch(ctx.clientRoot, ['development', 'production']);
  const dev = await git.git(['-C', ctx.clientRoot, 'rev-parse', 'origin/development'], 'read development');
  const prod = await git.git(['-C', ctx.clientRoot, 'rev-parse', 'origin/production'], 'read production');

  // Development must already carry every pin entry and the version.
  const pins = await ctx.pinsAt('origin/development');
  const version = await ctx.packageVersionAt('origin/development');
  const r2 = await ctx.r2();
  const notReady = allPieces({ listing: await r2.list(PARTS_BUCKET, ''), pins, targets: TARGETS }).filter((p) => p.state !== 'ready');
  const problems = [];
  if (version !== ctx.version) {problems.push(`development says version ${version}, not ${ctx.version}`);}
  if (notReady.length) {problems.push(`not ready on development: ${notReady.map((p) => `${p.target}/${p.part} (${p.state})`).join(', ')}`);}
  if (problems.length) {throw new Error(`Gate: ${problems.join('; ')}. Merge the reviewed pins branch to development first.`);}

  if (dev === prod) {
    ctx.log(`  Client production is already development (${prod.slice(0, 9)}).`);
  } else {
    const isAncestor = await ctx.run('git', ['-C', ctx.clientRoot, 'merge-base', '--is-ancestor', prod, dev]);
    if (isAncestor.code !== 0) {throw new Error('Gate: client production is not behind development, so it cannot simply move forward. Ask Michael.');}
    if (ctx.dryRun) {
      ctx.log(`  [dry run] would move client production ${prod.slice(0, 9)} to development ${dev.slice(0, 9)} after Michael's yes`);
      return { handoff: null };
    }
    requireYes(ctx, 'production', `${REPOS.client} production ${prod.slice(0, 9)} to ${dev.slice(0, 9)}`);
    await git.git(['-C', ctx.clientRoot, 'push', 'origin', `${dev}:refs/heads/production`], 'move client production');
    ctx.log(`  Client production moved to ${dev.slice(0, 9)}.`);
  }
  const handoff = handoffText({ version: ctx.version, commit: dev });
  ctx.state.handoff = { commit: dev, at: new Date().toISOString() };
  ctx.log('');
  ctx.log('---- Copy this to the installer agent ----');
  ctx.log(handoff);
  ctx.log('------------------------------------------');
  return { handoff };
}

module.exports = { gate, handoffText };

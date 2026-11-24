'use strict';

/**
 * Phase 8, firms and promote.
 *
 * Firms first applies to promotion: the app's engine refuses a server below
 * its data API minimum, so a firm gets the new app only once its server runs
 * the engine commit or newer (Norton first).
 *
 * The portal has no API a script can read firm server versions from (its
 * fleet list is an admin web page), and its Promote step still reads GitHub
 * releases. So this phase prints, for each kind of firm, exactly what to
 * check and do by hand, and stops before promoting.
 */

const { REPOS } = require('../config');

async function firms(ctx) {
  const commit = await ctx.git.tip(REPOS.server, 'production');
  const serverVersion = ctx.serverVersion || (ctx.state.serverReleased && ctx.state.serverReleased.version) || '<the server release from the server phase>';
  const chef = ctx.state.imagesPushed && ctx.state.imagesPushed.vars && ctx.state.imagesPushed.vars.RAILWAY_IMAGE_CHEF;
  const lines = [
    'No portal API lists each firm\'s server version for a script. Check by hand at https://redroostertec.com/admin/deployments:',
    `  Hardware boxes (on-prem): the box's server version must be ${serverVersion} or newer (built from LANA-AI ${commit.slice(0, 9)}). Update a box with lana update on that box (Norton first), then check its version.`,
    `  Cloud firms (Railway): the chef service must run ${chef ? 'the new chef image (RAILWAY_IMAGE_CHEF, by digest)' : 'the chef image from the server phase'}. Use the portal's backend Update for that firm.`,
    'Then promote the app to that firm only. The portal\'s Client releases page still reads GitHub releases; until it is fixed, promotion is a manual step (client docs/RELEASE-RUNBOOK.md section 5).'
  ];
  for (const line of lines) {ctx.log(`  ${line}`);}
  ctx.report.waiting.push('Update each firm\'s server (Norton first) and check its version by hand; then promote the app to that firm. Tick server.firms and day.promoted when done.');
  return { stop: true };
}

module.exports = { firms };

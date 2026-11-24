'use strict';

/** The short plain-English summary every run ends with. */

function summary(ctx, outcome) {
  const r = ctx.report;
  const lines = ['', `Summary for LANA AI ${ctx.version} (${ctx.mode}${ctx.dryRun ? ', dry run' : ''})`];
  lines.push(`  Result: ${outcome}`);
  lines.push(`  Built: ${r.built.length ? r.built.join(', ') : 'nothing'}`);
  lines.push(`  Uploaded: ${r.uploaded.length ? r.uploaded.join(', ') : 'nothing'}`);
  lines.push(`  Release Desk boxes to tick: ${r.desk.length ? r.desk.join(', ') : 'none'}`);
  if (r.notes.length) {for (const note of r.notes) {lines.push(`  Note: ${note}`);}}
  lines.push(`  Waiting on Michael: ${r.waiting.length ? '' : 'nothing'}`);
  for (const item of r.waiting) {lines.push(`    - ${item}`);}
  return lines.join('\n');
}

module.exports = { summary };

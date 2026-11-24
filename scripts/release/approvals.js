'use strict';

/**
 * Stop and ask. An agent runs this command, so it cannot answer a prompt in
 * the middle of a run. At a step that needs Michael's yes the run stops with
 * exit code 10 and says what it is waiting for. After the yes, the agent runs
 * the same command again with --yes <step>.
 */

const { APPROVALS } = require('./config');

const WAITING_EXIT = 10;

class ApprovalNeeded extends Error {
  constructor(step, detail) {
    super(`Waiting on Michael: ${APPROVALS[step] || step}${detail ? ` (${detail})` : ''}. After his yes, run again with --yes ${step}.`);
    this.step = step;
    this.code = 'APPROVAL_NEEDED';
  }
}

/** Throws ApprovalNeeded unless --yes named this step. */
function requireYes(ctx, step, detail) {
  if (!APPROVALS[step]) {throw new Error(`Unknown approval step "${step}".`);}
  if (ctx.yes.has(step)) {return true;}
  throw new ApprovalNeeded(step, detail);
}

function parseYes(values) {
  const steps = new Set();
  for (const value of values) {
    for (const step of String(value).split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!APPROVALS[step]) {
        throw new Error(`--yes ${step} is not a step that needs a yes. Steps: ${Object.keys(APPROVALS).join(', ')}.`);
      }
      steps.add(step);
    }
  }
  return steps;
}

module.exports = { WAITING_EXIT, ApprovalNeeded, requireYes, parseYes };

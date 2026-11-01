'use strict';

/**
 * The agent run view's artifact card: a work proposal whose apply stopped
 * part way (failed_to_apply) offers "Apply again"; the answer of an apply
 * (200 { artifact } or 409 { error, artifact }) sets the card's status.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

function boot(post) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  window.console.error = () => {};
  window.Lex = { Toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() }, Utils: { escapeHtml: (v) => String(v == null ? '' : v) } };
  window.api = { post: jest.fn(post) };
  ['src/js/shared/note-labels.js', 'src/js/shared/entity-links.js', 'src/js/shared/proposal-outline.js', 'src/agents/js/views/agent-run.js']
    .forEach((rel) => window.eval(read(rel)));
  return window;
}

const proposal = { title: 'Follow-ups', tasks: [{ title: 'Get the IRA letter', priority: 'high', about: [], resolves: [] }] };
const artifact = (status) => ({ id: 'art-1', kind: 'any_kind', status, title: 'Follow-ups', matter_id: 'MATT-1', payload: proposal });
const state = (art) => ({ runId: 'run-1', artifacts: [art], artifactStates: {}, _unbindFns: [] });
const applyLabel = (card) => card.querySelector('[data-art-action="apply"]').textContent;

test('failed_to_apply offers "Apply again" with the reason line; control: approved reads "Apply"', () => {
  const window = boot();
  const { buildArtifactCard } = window.LanaAgentsApp.Views.agentRun.__test;
  const failed = buildArtifactCard(state(artifact('failed_to_apply')), artifact('failed_to_apply'));
  expect(applyLabel(failed)).toBe('Apply again');
  expect(failed.querySelector('.proposal-outline__state').textContent).toContain('Apply it again');
  const approved = buildArtifactCard(state(artifact('approved')), artifact('approved'));
  expect(applyLabel(approved)).toBe('Apply');
  expect(approved.querySelector('.proposal-outline__state')).toBeNull();
});

test('a refused apply that left failed_to_apply turns the card to "Apply again"; pressing it again and succeeding reads applied', async () => {
  const refused = Object.assign(new Error('artifact not in approved state'), { status: 409, data: { error: 'artifact not in approved state', artifact: { id: 'art-1', status: 'failed_to_apply' } } });
  const window = boot(async () => { throw refused; });
  const { buildArtifactCard, applyArtifact } = window.LanaAgentsApp.Views.agentRun.__test;
  const s = state(artifact('approved'));
  await applyArtifact(s, 'art-1');
  expect(window.api.post).toHaveBeenCalledWith('/api/v1/agent-runs/run-1/artifacts/art-1/apply', {});
  expect(s.artifactStates['art-1']).toBe('failed_to_apply');
  expect(applyLabel(buildArtifactCard(s, s.artifacts[0]))).toBe('Apply again');
  window.api.post.mockImplementation(async () => ({ artifact: { id: 'art-1', status: 'applied' } }));
  await applyArtifact(s, 'art-1');
  expect(s.artifactStates['art-1']).toBe('applied');
  expect(window.Lex.Toast.success).toHaveBeenCalled();
});

'use strict';

const H = require('../../src/js/shared/run-history.js');

const OUTCOMES = [
  'started', 'deferred', 'coalesced', 'skipped_self_cause', 'skipped_depth_limit', 'skipped_paused',
  'skipped_cap', 'skipped_inactive', 'skipped_no_responsible_user', 'refused_write_tools', 'queued', 'skipped_active_run', 'followup_expired', 'followup_failed',
];

describe('run history outcomes', () => {
  test('every outcome in design section 14 has its own plain-language text', () => {
    const details = OUTCOMES.map((key) => H.outcomeView(key).detail);
    expect(new Set(details).size).toBe(OUTCOMES.length);
    details.forEach((text) => {
      expect(text.endsWith('.')).toBe(true);
      expect(text.includes('_')).toBe(false);
    });
  });

  test('labels and tones: started green, queued and combined blue, refusals warn', () => {
    expect(H.outcomeView('started')).toMatchObject({ label: 'Started', tone: 'green' });
    expect(H.outcomeView('queued')).toMatchObject({ label: 'Queued', tone: 'blue' });
    expect(H.outcomeView('deferred')).toMatchObject({ label: 'Follow-up queued', tone: 'blue' });
    expect(H.outcomeView('coalesced')).toMatchObject({ label: 'Combined', tone: 'blue' });
    expect(H.outcomeView('skipped_paused')).toMatchObject({ label: 'Skipped', tone: 'yellow' });
    expect(H.outcomeView('skipped_paused').detail).toContain('paused');
    expect(H.outcomeView('refused_write_tools')).toMatchObject({ label: 'Refused', tone: 'red' });
  });

  test('a missing outcome reads as started; an unknown one is worded from its key', () => {
    expect(H.outcomeView(undefined).key).toBe('started');
    expect(H.outcomeView('skipped_new_reason')).toEqual({ key: 'skipped_new_reason', label: 'Skipped', tone: 'yellow', detail: 'Skipped new reason.' });
    expect(H.outcomeView('rerouted')).toEqual({ key: 'rerouted', label: 'Rerouted', tone: 'gray', detail: 'Rerouted.' });
  });
});

describe('origin and actor', () => {
  test('origins name the event type when there is one', () => {
    expect(H.originText('event', 'task.created')).toBe('An event (task.created)');
    expect(H.originText('task')).toBe('A task action');
    expect(H.originText('schedule')).toBe('A schedule');
    expect(H.originText('mcp')).toBe('An MCP tool');
    expect(H.originText('webhook_relay')).toBe('Webhook relay');
    expect(H.originText(null)).toBe('Unknown');
  });

  test('actor and acting user', () => {
    expect(H.actorText({ actor: { kind: 'user', user_id: 'u1' }, actor_name: 'Ana Ruiz', acting_user_id: 'u1' })).toBe('Started by Ana Ruiz');
    expect(H.actorText({ actor: { kind: 'system', user_id: null }, acting_user_id: 'u2', acting_user_name: 'Sam Lee' })).toBe('Started by the system, acting as Sam Lee');
    expect(H.actorText({ actor: { kind: 'system', user_id: null }, acting_user_id: 'u2' })).toBe('Started by the system, acting as the responsible person');
    expect(H.actorText({ actor: { kind: 'user', user_id: 'u1' } })).toBe('Started by a team member');
    expect(H.actorText(null)).toBe('');
  });
});

describe('run rows', () => {
  const names = { 'matter-review': 'Matter review' };
  const row = {
    id: 'c1', run_kind: 'agent_run', run: { kind: 'agent_run', id: 'r1' }, runnable_key: 'matter-review', outcome: 'started',
    origin: 'event', origin_event: { type: 'note.created', id: 'e1' }, actor: { kind: 'system', user_id: null }, acting_user_id: 'u2',
    acting_user_name: 'Sam Lee', created_at: '2026-10-31T10:00:00Z',
  };

  test('maps one causation row to a list entry', () => {
    expect(H.runRowView(row, names)).toEqual({
      key: 'c1', runKind: 'agent_run', runId: 'r1', title: 'Matter review', kindLabel: 'Agent run',
      outcome: H.outcomeView('started'), state: null, finishedAt: '', executionTraceId: '', origin: 'An event (note.created)',
      actor: 'Started by the system, acting as Sam Lee', when: '2026-10-31T10:00:00Z', explainable: true, source: row,
    });
  });

  test('unknown runnable falls back to its key, then to the run kind; a refused start (run null) is explained from its row', () => {
    expect(H.runRowView({ run_kind: 'automation_execution', runnable_key: 'nightly-sweep' }, names).title).toBe('nightly-sweep');
    // An automation keyed by its id (made outside the makeup) reads as its kind, never as the uuid.
    expect(H.runRowView({ run_kind: 'automation_execution', runnable_key: '6629b711-0ab2-475d-be8a-6e60d95c50d8' }, names).title).toBe('Skill run');
    const refused = H.runRowView({ ...row, run: null, outcome: 'skipped_cap' }, names);
    expect(refused).toMatchObject({ runId: '', explainable: true, outcome: { key: 'skipped_cap' } });
    expect(H.runRowView({}, names).explainable).toBe(false);
  });

  test('a started run shows where it is now: state chip, the owner status as detail, finish time and its trace', () => {
    const done = H.runRowView({ ...row, run: { kind: 'agent_run', id: 'r1', status: 'completed_with_warnings', state: 'completed',
      finished_at: '2026-10-31T10:05:00Z', execution_trace_id: 'tr-1' } }, names);
    expect(done).toMatchObject({ state: { key: 'completed', label: 'Completed', tone: 'green', detail: 'Status: Completed with warnings.' },
      finishedAt: '2026-10-31T10:05:00Z', executionTraceId: 'tr-1', outcome: { key: 'started' } });
    expect(H.RUN_STATE_KEYS).toEqual(['active', 'completed', 'failed', 'cancelled']);
    expect(H.runStateView({ state: 'active', status: 'running' })).toMatchObject({ label: 'Running', tone: 'blue', detail: 'Status: Running.' });
    expect(H.runStateView({ state: 'failed', status: null })).toMatchObject({ label: 'Failed', tone: 'red', detail: 'Failed.' });
    expect(H.runStateView({ state: 'cancelled', status: 'stopped' })).toMatchObject({ label: 'Cancelled', tone: 'gray' });
    // Unknown (the owner did not answer) or no run: the outcome alone.
    expect(H.runStateView({ state: null, status: null })).toBeNull();
    expect(H.runStateView({ state: 'mystery' })).toBeNull();
    expect(H.runRowView({ ...row, run: null, outcome: 'skipped_cap' }, names)).toMatchObject({ state: null, finishedAt: '', executionTraceId: '' });
  });

  test('runRows reads the { status, data: { runs, next_cursor } } envelope only', () => {
    expect(H.runRows({ status: 'success', data: { runs: [row], next_cursor: 'n2' } }, names)).toMatchObject({ nextCursor: 'n2', rows: [{ key: 'c1' }] });
    expect(H.runRows({ status: 'success', data: { runs: [], next_cursor: null } }, names)).toEqual({ rows: [], nextCursor: null });
    expect(H.runRows(null, names)).toEqual({ rows: [], nextCursor: null });
  });
});

describe('chain model', () => {
  const causation = {
    id: 'c3', run_kind: 'agent_run', run: { kind: 'agent_run', id: 'r3' }, runnable_key: 'matter-review', outcome: 'started', origin: 'event',
    origin_event: { type: 'task.created', id: 'e9' }, actor: { kind: 'system', user_id: null }, depth: 2, trace_id: 't-9',
    chain: [
      { kind: 'task_action', id: 'a1', runnable_key: null },
      { kind: 'automation_execution', id: 'e2', runnable_key: 'nightly-sweep' },
    ],
  };

  test('steps go from the root to this run, which is the leaf', () => {
    const model = H.chainModel({ status: 'success', data: { causation, root: [] } }, { 'matter-review': 'Matter review' });
    expect(model.steps.map((s) => [s.kind, s.id, s.label, s.isRoot, s.isLeaf])).toEqual([
      ['task_action', 'a1', 'Task action', true, false],
      ['automation_execution', 'e2', 'nightly-sweep', false, false],
      ['agent_run', 'r3', 'Matter review', false, true],
    ]);
    expect(model).toMatchObject({ origin: 'An event (task.created)', depth: 2, traceId: 't-9', actor: 'Started by the system' });
  });

  test('root lists the other attempts under the same first cause, not this run', () => {
    const sibling = { ...causation, id: 'c4', run: null, runnable_key: 'nightly-sweep', run_kind: 'automation_execution', outcome: 'skipped_self_cause' };
    const model = H.chainModel({ status: 'success', data: { causation, root: [causation, sibling] } }, {});
    expect(model.related.map((row) => [row.key, row.outcome.key])).toEqual([['c4', 'skipped_self_cause']]);
  });

  test('a refused row is read on its own; a root run has one step; bad entries are dropped', () => {
    const refused = H.chainModel({ ...causation, run: null, outcome: 'skipped_depth_limit' }, {});
    expect(refused.steps[2]).toMatchObject({ kind: 'agent_run', id: '', isLeaf: true });
    expect(refused.related).toEqual([]);
    const root = H.chainModel({ data: { causation: { run_kind: 'agent_run', run: { kind: 'agent_run', id: 'r1' }, chain: [null, { kind: 'x' }] }, root: [] } }, {});
    expect(root.steps).toEqual([{ kind: 'agent_run', id: 'r1', label: 'Agent run', kindLabel: 'Agent run', isRoot: true, isLeaf: true }]);
    expect(root.depth).toBe(0);
  });
});

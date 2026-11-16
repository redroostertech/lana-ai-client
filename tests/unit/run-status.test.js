const path = require('path');

const RunStatus = require(path.join(__dirname, '../../src/js/shared/run-status.js'));

const NOW = new Date('2026-11-15T12:00:00.000Z');

describe('run status (shared by the automations and agents apps)', () => {
  test.each([
    // automation execution statuses
    ['in_progress', 'running'], ['pending', 'queued'], ['awaiting_approval', 'waiting'],
    ['completed', 'succeeded'], ['failed', 'failed'], ['cancelled', 'cancelled'],
    // agent run statuses
    ['running', 'running'], ['compiling_context', 'running'], ['approved', 'running'], ['queued', 'queued'],
    ['awaiting_input', 'waiting'], ['rejected', 'cancelled'],
    // unknown or empty
    ['something_new', 'unknown'], ['', 'none'], [null, 'none']
  ])('status %p is %p', (status, state) => {
    expect(RunStatus.stateOf(status)).toBe(state);
  });

  test('a last_run from the API reads by its status first, then its shared state', () => {
    expect(RunStatus.stateOf({ run_id: 'r', state: 'active', status: 'awaiting_input' })).toBe('waiting');
    expect(RunStatus.stateOf({ run_id: 'r', state: 'completed', status: 'oddity' })).toBe('succeeded');
    expect(RunStatus.stateOf({ run_id: 'r', state: 'active', status: null })).toBe('running');
    expect(RunStatus.stateOf(null)).toBe('none');
  });

  test('only running and queued runs are live', () => {
    expect(['running', 'queued', 'waiting', 'succeeded', 'failed', 'cancelled', 'none'].filter(RunStatus.isLive)).toEqual(['running', 'queued']);
  });

  test.each([
    ['2026-11-15T11:59:40.000Z', 'just now'],
    ['2026-11-15T11:55:00.000Z', '5m ago'],
    ['2026-11-15T09:00:00.000Z', '3h ago'],
    ['2026-11-13T12:00:00.000Z', '2d ago'],
    ['not a date', ''],
    [null, '']
  ])('short time %p reads %p', (iso, text) => {
    expect(RunStatus.shortAgo(iso, NOW)).toBe(text);
  });

  test('a last-run summary names the state and when: start time while running, end time once ended', () => {
    expect(RunStatus.lastRunSummary({ run_id: 'r', state: 'active', status: 'running', started_at: '2026-11-15T11:55:00.000Z', finished_at: null }, NOW))
      .toEqual({ state: 'running', label: 'Running', time: 'started 5m ago', runId: 'r' });
    expect(RunStatus.lastRunSummary({ run_id: 'r', state: 'failed', status: 'failed', started_at: '2026-11-15T08:00:00.000Z', finished_at: '2026-11-15T09:00:00.000Z' }, NOW))
      .toEqual({ state: 'failed', label: 'Failed', time: '3h ago', runId: 'r' });
    expect(RunStatus.lastRunSummary(null, NOW)).toEqual({ state: 'none', label: 'Never run', time: '', runId: '' });
  });

  test('transitions: a run that went from live to an end is reported once, as finished or failed', () => {
    let seen = RunStatus.trackTransitions(null, [{ id: 'a', state: 'running' }, { id: 'b', state: 'running' }, { id: 'c', state: 'succeeded' }]);
    expect(seen.ended).toEqual([]);
    seen = RunStatus.trackTransitions(seen.next, [{ id: 'a', state: 'succeeded' }, { id: 'b', state: 'failed' }, { id: 'c', state: 'succeeded' }, { id: 'd', state: 'running' }]);
    expect(seen.ended).toEqual([{ id: 'a', state: 'succeeded' }, { id: 'b', state: 'failed' }]);
    expect(seen.started).toEqual(['d']);
    seen = RunStatus.trackTransitions(seen.next, [{ id: 'a', state: 'succeeded' }, { id: 'b', state: 'failed' }]);
    expect(seen.ended).toEqual([]);
  });

  test('trace steps: automation step outcomes and agent steps become one shape; the live step is marked', () => {
    const automation = RunStatus.traceSteps([
      { step_id: 'fetch_docs', step_index: 1, step_type: 'connector.read', status: 'completed', duration_ms: 1200 },
      { step_id: 'draft-summary', step_index: 2, step_type: 'ai.generate', status: 'running' },
      { step_index: 3, step_type: 'notification.send', status: 'pending' }
    ], { live: true });
    expect(automation).toEqual([
      { key: 'fetch_docs', label: 'Fetch docs', state: 'succeeded', detail: 'connector.read', durationMs: 1200, active: false },
      { key: 'draft-summary', label: 'Draft summary', state: 'running', detail: 'ai.generate', durationMs: null, active: true },
      { key: 'step-3', label: 'Step 3', state: 'queued', detail: 'notification.send', durationMs: null, active: false }
    ]);
    const agent = RunStatus.traceSteps([
      { id: 's1', step_id: 'gather_context', status: 'completed', started_at: '2026-11-15T11:00:00.000Z', completed_at: '2026-11-15T11:00:02.500Z' },
      { id: 's2', step_id: 'review', status: 'errored', message: 'tool failed' }
    ], { live: false });
    expect(agent).toEqual([
      { key: 's1', label: 'Gather context', state: 'succeeded', detail: '', durationMs: 2500, active: false },
      { key: 's2', label: 'Review', state: 'failed', detail: 'tool failed', durationMs: null, active: false }
    ]);
  });

  test('the agent run stream steps (active, complete, error) read the same way; a title is kept as written', () => {
    expect(RunStatus.traceSteps([
      { number: 1, title: 'Read the matter file', status: 'complete' },
      { number: 2, title: 'Draft e-mail_v2', status: 'active' },
      { number: 3, title: 'Check', status: 'error' }
    ], { live: true }).map((step) => [step.key, step.label, step.state, step.active])).toEqual([
      ['step-1', 'Read the matter file', 'succeeded', false],
      ['step-2', 'Draft e-mail_v2', 'running', true],
      ['step-3', 'Check', 'failed', false]
    ]);
  });

  test('a live run with no running step marks the first step not yet ended; an ended run marks none', () => {
    const steps = [{ step_id: 'a', status: 'completed' }, { step_id: 'b', status: 'pending' }];
    expect(RunStatus.traceSteps(steps, { live: true }).map((step) => step.active)).toEqual([false, true]);
    expect(RunStatus.traceSteps(steps, { live: false }).map((step) => step.active)).toEqual([false, false]);
    expect(RunStatus.traceSteps(null)).toEqual([]);
  });
});

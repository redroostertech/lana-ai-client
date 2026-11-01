'use strict';

const TaskActions = require('../../src/js/shared/task-actions.js');

const task = {
  id: 't1',
  actions: [
    { id: 'a1', kind: 'start_agent', label: 'Run review', status: 'available', last_run: null },
    { id: 'a2', kind: 'start_automation', label: 'Refresh', status: 'running', last_run: { started_at: '2026-10-31T10:00:00Z' } },
    { id: 'a3', kind: 'form', label: 'Decision needed', status: 'done' },
    { id: 'a4', kind: 'form', label: 'Old', status: 'withdrawn' },
    { id: 'a5', kind: 'teleport', label: 'Unknown', status: 'available' },
    { id: 'a6', kind: 'start_agent', label: 'Retry', status: 'failed' },
  ],
};

// POST .../start as the backend answers it (task-actions.service startAction).
function answer(outcome, status = 'running') {
  return { outcome, action: { id: 'a1', kind: 'start_agent', label: 'Run review', status, last_run: null }, run: outcome === 'queued' ? null : { kind: 'agent_run', id: 'run-1' } };
}

describe('task-actions', () => {
  beforeEach(() => TaskActions._resetSessions());

  test('actionViews shows known, non-withdrawn actions with status and last run', () => {
    const views = TaskActions.actionViews(task);
    expect(views.map((v) => v.id)).toEqual(['a1', 'a2', 'a3', 'a6']);
    expect(views.map((v) => v.pressable)).toEqual([true, false, false, true]);
    expect(views[1].statusLabel).toBe('Running');
    expect(views[3].statusLabel).toBe('Failed');
    expect(views[0].lastRun).toBe('');
    expect(TaskActions.lastRunText({ started_at: 'then' }, () => '2 hours ago')).toBe('Last run 2 hours ago');
    expect(TaskActions.actionViews({ id: 'x' })).toEqual([]);
  });

  test('start sends POST start with a request id and reuses it after a dropped connection', async () => {
    let n = 0;
    const client = { startTaskAction: jest.fn() };
    const deps = { client, makeId: () => 'req-' + (++n), scope: () => null };
    client.startTaskAction.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    await expect(TaskActions.startAction(task, task.actions[0], deps)).rejects.toMatchObject({ submitOutcome: 'retryable' });
    client.startTaskAction.mockResolvedValueOnce(answer('replayed'));
    await expect(TaskActions.startAction(task, task.actions[0], deps)).resolves.toMatchObject({ response: { outcome: 'replayed', run: { id: 'run-1' } } });
    expect(client.startTaskAction.mock.calls).toEqual([['t1', 'a1', 'req-1'], ['t1', 'a1', 'req-1']]);

    client.startTaskAction.mockResolvedValueOnce(answer('started'));
    await TaskActions.startAction(task, task.actions[0], deps);
    expect(client.startTaskAction.mock.calls[2]).toEqual(['t1', 'a1', 'req-2']);
  });

  test('an answer without a start outcome is not a confirmation: the request is kept (control arm)', async () => {
    const client = { startTaskAction: jest.fn(async () => ({ ok: true })) };
    const deps = { client, makeId: () => 'req-1', scope: () => null };
    await expect(TaskActions.startAction(task, task.actions[0], deps)).rejects.toMatchObject({ submitOutcome: 'retryable' });
    client.startTaskAction.mockResolvedValueOnce(answer('started'));
    await TaskActions.startAction(task, task.actions[0], deps);
    expect(client.startTaskAction.mock.calls.map((c) => c[2])).toEqual(['req-1', 'req-1']);
  });

  test('answer and error views', () => {
    expect(TaskActions.startAnswerView(answer('started'), 'Run review')).toMatchObject({ kind: 'success', text: 'Run review started', action: { status: 'running' } });
    expect(TaskActions.startAnswerView(answer('queued'), 'Refresh').text).toBe('Refresh will start shortly');
    expect(TaskActions.startAnswerView(answer('replayed'), 'Run review')).toMatchObject({ kind: 'info', text: 'Run review was already started' });
    const err = (code, extra) => Object.assign(new Error('Server said ' + code), { status: 409, code, data: { error: Object.assign({ code }, extra) } });
    expect(TaskActions.startErrorView(err('ACTIVE_RUN_EXISTS', { details: { active_run_id: 'r9' } }))).toEqual({ kind: 'info', text: 'This agent is already running on this matter.' });
    expect(TaskActions.startErrorView(err('TASK_ACTION_START_FAILED'), 'Run review')).toEqual({ kind: 'error', text: 'Run review failed. Press it again to retry.' });
    expect(TaskActions.startErrorView(err('skipped_paused', { details: { outcome: 'skipped_paused', replayed: true } }))).toMatchObject({ kind: 'warning', text: expect.stringContaining('paused') });
    expect(TaskActions.startErrorView(err('TASK_ACTION_NOT_STARTABLE'))).toEqual({ kind: 'error', text: 'Server said TASK_ACTION_NOT_STARTABLE' });
    expect(TaskActions.startErrorView(Object.assign(new Error('offline'), { submitOutcome: 'retryable' })).text).toBe('offline Press it again to retry the same request.');
  });

  test('a refused start is not retried with the same request id (control arm)', async () => {
    let n = 0;
    const client = { startTaskAction: jest.fn() };
    const deps = { client, makeId: () => 'req-' + (++n), scope: () => null };
    client.startTaskAction.mockRejectedValueOnce(Object.assign(new Error('Already running'), { status: 409 }));
    await expect(TaskActions.startAction(task, task.actions[5], deps)).rejects.toMatchObject({ submitOutcome: 'refused' });
    client.startTaskAction.mockResolvedValueOnce(answer('queued'));
    await TaskActions.startAction(task, task.actions[5], deps);
    expect(client.startTaskAction.mock.calls.map((c) => c[2])).toEqual(['req-1', 'req-2']);
  });
});

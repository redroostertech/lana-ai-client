/**
 * "Sync now" and "Sync all" after the backend queues syncs instead of running
 * them inline: the response carries a job id, not a record count, and a
 * connection that is already syncing answers 409.
 */
const model = require('../../src/js/connector-sync-queue.model');

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

describe('connector sync queue model', () => {
  test.each([
    [{ message: 'Sync started', job_id: 'job-1', sync_status: 'queued' }, 'Sync started. New records show up when it finishes.'],
    [{}, 'Sync started. New records show up when it finishes.'],
    [undefined, 'Sync started. New records show up when it finishes.'],
    [{ records_synced: 12 }, 'Synced 12 records']
  ])('startedMessage(%j)', (result, expected) => {
    expect(model.startedMessage(result)).toBe(expected);
    expect(model.startedMessage(result)).not.toContain('undefined');
  });

  test('a 409 is "already syncing", any other error is not', () => {
    expect(model.isAlreadySyncing(apiError(409, 'Sync already in progress'))).toBe(true);
    expect(model.isAlreadySyncing(apiError(500, 'boom'))).toBe(false);
    expect(model.isAlreadySyncing(null)).toBe(false);
  });

  test('syncAll keeps going past a connection that is already syncing or fails', async () => {
    const calls = [];
    const trigger = async (id) => {
      calls.push(id);
      if (id === 'b') { throw apiError(409, 'Sync already in progress'); }
      if (id === 'c') { throw apiError(500, 'Server error'); }
      return { job_id: `job-${id}` };
    };

    const summary = await model.syncAll(['a', 'b', 'c', 'd'], trigger);

    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    expect(summary).toEqual({ started: 2, alreadySyncing: 1, failed: [{ id: 'c', message: 'Server error' }] });
  });

  test.each([
    [{ started: 3, alreadySyncing: 0, failed: [] }, 'success', 'Started 3 syncs.'],
    [{ started: 1, alreadySyncing: 2, failed: [] }, 'success', 'Started 1 sync. 2 were already syncing.'],
    [{ started: 0, alreadySyncing: 2, failed: [] }, 'info', 'All 2 were already syncing.'],
    [{ started: 2, alreadySyncing: 1, failed: [] }, 'success', 'Started 2 syncs. 1 was already syncing.'],
    [{ started: 1, alreadySyncing: 0, failed: [{ id: 'c', message: 'x' }] }, 'warning', 'Started 1 sync. 1 could not start.']
  ])('summaryToast(%j)', (summary, level, message) => {
    expect(model.summaryToast(summary)).toEqual({ level, message });
  });
});

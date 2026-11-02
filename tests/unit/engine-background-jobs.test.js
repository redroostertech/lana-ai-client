/**
 * Background jobs status in Settings (src/js/engine-background-jobs.js,
 * phase 8d): every state the card can show, and "This run moved to the
 * cloud" wherever a run left this computer.
 */

const view = require('../../src/js/engine-background-jobs');

const ENGINE = 'engine-abc12345';
const on = { configured: true, inUse: true, backgroundJobs: { enabled: true, setting: null } };

function history(overrides) {
  return { job_id: 'j1', kind: 'agent_run', run_id: 'r1', status: 'completed', placement_state: 'finished', where: 'ended', engine_id: null, moved_to_cloud: false, created_at: '', completed_at: '', attempts: [], ...overrides };
}

describe('background jobs view', () => {
  test('engine off: off, with a note that jobs run in the cloud', () => {
    expect(view.jobsView(null, { configured: true, inUse: false })).toMatchObject({ state: 'off', rows: [] });
  });

  test('engine on but not readable: unavailable', () => {
    expect(view.jobsView(null, on)).toMatchObject({ state: 'unavailable' });
  });

  test('a run on this computer right now', () => {
    const out = view.jobsView({ engine_id: ENGINE, running: [{ job_id: 'j9', kind: 'document_embedding' }], recent: [], history: [history({ job_id: 'j9', kind: 'document_embedding', status: 'claimed', where: 'computer', engine_id: ENGINE })] }, on);
    expect(out).toMatchObject({ state: 'running', summary: '1 running here', tone: 'green' });
    expect(out.rows).toEqual([{ id: 'j9', title: 'Document indexing', detail: 'Running on this computer.', badge: 'Running here', tone: 'green', movedToCloud: false }]);
  });

  test.each([
    ['handed off and finished there', history({ moved_to_cloud: true, engine_id: ENGINE }), 'This run moved to the cloud and finished there.'],
    ['handed off and still running there', history({ moved_to_cloud: true, engine_id: ENGINE, status: 'claimed', where: 'cloud' }), 'This run moved to the cloud and is still running there.']
  ])('moved to the cloud: %s', (_label, job, detail) => {
    const out = view.jobsView({ engine_id: ENGINE, running: [], recent: [], history: [job] }, on);
    expect(out.rows[0]).toMatchObject({ detail, movedToCloud: true, badge: 'Moved to the cloud' });
    expect(out.rows[0].detail.startsWith(view.MOVED_TO_CLOUD)).toBe(true);
  });

  test('a lease lost offline is shown as moved even before the server lists the cloud attempt', () => {
    const out = view.jobsView({ engine_id: ENGINE, running: [], recent: [{ job_id: 'j1', outcome: 'moved_to_cloud' }], history: [history({ status: 'claimed', where: 'cloud', engine_id: ENGINE })] }, on);
    expect(out.rows[0].movedToCloud).toBe(true);
  });

  test.each([
    ['finished here', history({ engine_id: ENGINE }), 'Finished on this computer.', 'Done'],
    ['finished on another computer of mine', history({ engine_id: 'engine-other' }), 'Finished on your other computer.', 'Done'],
    ['ran in the cloud', history({}), 'Finished in your organization\'s cloud.', 'Done'],
    ['failed', history({ status: 'failed' }), 'Did not finish in your organization\'s cloud.', 'Failed'],
    ['waiting', history({ status: 'queued', where: 'waiting' }), 'Waiting to start.', 'Waiting']
  ])('history: %s', (_label, job, detail, badge) => {
    expect(view.jobsView({ engine_id: ENGINE, running: [], recent: [], history: [job] }, on).rows[0]).toMatchObject({ detail, badge });
  });

  test('a declined offer says why it went to the cloud', () => {
    const out = view.jobsView({ engine_id: ENGINE, running: [], recent: [{ job_id: 'j1', outcome: 'declined', reason: 'embedding_model_mismatch' }], history: [history({ kind: 'document_embedding' })] }, on);
    expect(out.rows[0].detail).toBe('Finished in your organization\'s cloud. It went to the cloud because this computer has a different indexing model.');
  });

  test('empty and server unreachable', () => {
    expect(view.jobsView({ engine_id: ENGINE, running: [], recent: [], history: [] }, on)).toMatchObject({ state: 'idle', summary: 'Ready', empty: 'No background jobs yet.' });
    expect(view.jobsView({ engine_id: ENGINE, running: [], recent: [], history: null, history_error: 'CHEF_UNREACHABLE' }, on).empty).toMatch(/could not be reached/);
  });

  test('turned off on this computer', () => {
    expect(view.jobsView({ engine_id: ENGINE, running: [], recent: [], history: [] }, { ...on, backgroundJobs: { enabled: false, setting: false } })).toMatchObject({ state: 'disabled', summary: 'Off on this computer' });
  });

  test('toggle: checked follows the setting; disabled while the engine is off', () => {
    expect(view.toggleView(on)).toEqual({ checked: true, disabled: false, note: '' });
    expect(view.toggleView({ configured: true, inUse: false, backgroundJobs: { enabled: false } })).toMatchObject({ checked: false, disabled: true });
    expect(view.toggleView(null)).toMatchObject({ checked: false, disabled: true });
  });
});

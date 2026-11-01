'use strict';

/**
 * Run history and causation against the backend's own contract and models.
 *
 * Loads src/shared/contracts/run-causation.contract.js and the runs route
 * models from a LANA-AI checkout, and checks that the client words every
 * outcome, kind and origin, that its request paths pass the route models, and
 * that its parsers read the documented answers (and the service's own row
 * shape when the service exports toCausationPayload). The backend is
 * LANA_BACKEND_DIR when set, else the sibling worktree .runtime/lana-estate-rulebook,
 * else a sibling LANA-AI/. When none has the contract the suite is skipped
 * with a message saying where it looked.
 */

const { findBackend } = require('../fixtures/backend-checkout.js');
global.LanaRunHistory = require('../../src/js/shared/run-history.js');
const H = global.LanaRunHistory;
const R = require('../../src/js/shared/matter-runnables.js');
const MatterMakeupAPIClient = require('../../src/js/api/matter-makeup-api.client.js');

const CONTRACT = 'src/shared/contracts/run-causation.contract.js';
const RUN_MODELS = 'src/services/processor/runs/runs.models.js';
const SERVICE = 'src/services/runs/run-causation.service.js';

const checkout = findBackend([CONTRACT, RUN_MODELS]);
const backend = checkout.require;
const describeBackend = checkout.describe;

const RUN_ID = '9b7e1d22-4c3f-4e8a-b6d1-0f5a2c8e9d47';
const ROOT_ID = '3f2a9c41-8d0e-4b7a-a1f5-6c2d9e7b0a13';
const MATTER = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

// A run_causation row as the repository reads it (actor names joined).
function dbRow(overrides) {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001', organization_id: 'org-1', run_kind: 'agent_run', run_id: RUN_ID,
    runnable_key: 'maintenance-check', outcome: 'started', matter_id: MATTER, origin: 'event',
    origin_event_type: 'note.created', origin_event_id: 'evt-1', trigger_type: 'event', root_id: ROOT_ID,
    parent_kind: 'agent_run', parent_id: ROOT_ID, depth: 1,
    chain: [{ kind: 'agent_run', id: ROOT_ID, runnable_key: 'funding-review' }],
    actor_kind: 'system', actor_user_id: null, actor_name: null, acting_user_id: 'u-1', acting_user_name: 'Avery Quill',
    trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', detail: {}, created_at: '2026-10-31T10:00:00.000Z',
    ...overrides,
  };
}

// The documented API row (api/matter-makeup-api.client.js header).
function apiRow(overrides) {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001', run_kind: 'agent_run',
    run: { kind: 'agent_run', id: RUN_ID, status: null, state: null, finished_at: null, execution_trace_id: null },
    runnable_key: 'maintenance-check', outcome: 'started', matter_id: MATTER, origin: 'event',
    origin_event: { type: 'note.created', id: 'evt-1' }, trigger_type: 'event', root_id: ROOT_ID,
    parent: { kind: 'agent_run', id: ROOT_ID }, depth: 1,
    chain: [{ kind: 'agent_run', id: ROOT_ID, runnable_key: 'funding-review' }],
    actor: { kind: 'system', user_id: null }, actor_name: null, acting_user_id: 'u-1', acting_user_name: 'Avery Quill',
    trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', detail: {}, created_at: '2026-10-31T10:00:00.000Z',
    ...overrides,
  };
}

describeBackend('run history against the backend run-causation contract', () => {
  let contract;
  let models;

  beforeAll(() => {
    contract = backend(CONTRACT);
    models = backend(RUN_MODELS);
  });

  test('every contract outcome has its own wording, and refusal codes read as their outcome', () => {
    const missing = contract.RUN_OUTCOMES.filter((key) => H.OUTCOME_KEYS.indexOf(key) === -1);
    expect(missing).toEqual([]);
    const details = contract.RUN_OUTCOMES.map((key) => H.outcomeView(key).detail);
    expect(new Set(details).size).toBe(contract.RUN_OUTCOMES.length);
    // skipped_active_run reads as "Running now" (asserted below with ACTIVE_RUN_EXISTS).
    contract.RUN_OUTCOMES.filter((key) => ['started', 'deferred', 'coalesced', 'skipped_active_run'].indexOf(key) === -1).forEach((key) => {
      const view = R.startErrorView({ status: 409, code: key, data: { error: { code: key }, outcome: key } });
      expect(view).toMatchObject({ kind: 'warning', text: H.outcomeView(key).detail });
    });
  });

  test('every run kind, origin and run state has a label of its own', () => {
    expect([...H.RUN_KINDS].sort()).toEqual([...contract.RUN_KINDS].sort());
    expect([...H.RUN_STATE_KEYS].sort()).toEqual([...contract.RUN_STATES].sort());
    expect(new Set(contract.RUN_STATES.map((state) => H.runStateView({ state }).label)).size).toBe(contract.RUN_STATES.length);
    expect(contract.RUN_ORIGINS.filter((origin) => H.ORIGIN_KEYS.indexOf(origin) === -1)).toEqual([]);
  });

  test('client request paths pass the route models', () => {
    contract.RUN_KINDS.forEach((kind) => {
      const req = MatterMakeupAPIClient.requests.causation(kind, RUN_ID);
      const match = req.path.match(/^\/api\/v1\/runs\/([^/]+)\/([^/]+)\/causation$/);
      expect(match).not.toBeNull();
      expect(models.getRunCausationSchema.params.safeParse({ run_kind: match[1], run_id: match[2] }).success).toBe(true);
    });
    const page = MatterMakeupAPIClient.requests.runs('MATT-02417', 'eyJjIjoiMjAyNi0xMC0zMSJ9');
    const url = new URL('http://x' + page.path);
    expect(url.pathname).toBe('/api/v1/matters/MATT-02417/activity/runs');
    expect(models.listMatterRunsSchema.params.safeParse({ matter_id: 'MATT-02417' }).success).toBe(true);
    expect(models.listMatterRunsSchema.query.safeParse(Object.fromEntries(url.searchParams)).success).toBe(true);
  });

  test('parsers read the documented list and causation answers', () => {
    const refused = apiRow({ id: 'a1b2c3d4-0000-4000-8000-000000000002', run: null, outcome: 'skipped_depth_limit', depth: 3 });
    const page = H.runRows({ status: 'success', data: { runs: [apiRow(), refused], next_cursor: 'n2' } }, { 'maintenance-check': 'Maintenance check' });
    expect(page.nextCursor).toBe('n2');
    expect(page.rows[0]).toMatchObject({ runKind: 'agent_run', runId: RUN_ID, title: 'Maintenance check', origin: 'An event (note.created)', actor: 'Started by the system, acting as Avery Quill', explainable: true });
    expect(page.rows[1]).toMatchObject({ runId: '', outcome: { key: 'skipped_depth_limit' }, explainable: true });

    const root = apiRow({ id: 'a1b2c3d4-0000-4000-8000-000000000003', run: { kind: 'agent_run', id: ROOT_ID }, runnable_key: 'funding-review', depth: 0, chain: [], parent: null });
    const model = H.chainModel({ status: 'success', data: { causation: apiRow(), root: [root, apiRow()] } }, { 'funding-review': 'Funding review' });
    expect(model.steps.map((step) => [step.kind, step.id, step.isLeaf])).toEqual([['agent_run', ROOT_ID, false], ['agent_run', RUN_ID, true]]);
    expect(model.related.map((row) => row.title)).toEqual(['Funding review']);
    expect(model.depth).toBe(1);
  });

  test('the service row shape reads the same (when the service exports toCausationPayload)', () => {
    jest.resetModules();
    const mocked = (relative, factory) => jest.doMock(checkout.path(relative), factory);
    mocked('src/repositories/run-causation.repository', () => ({}));
    mocked('src/repositories/matters.repository', () => ({}));
    mocked('src/shared/permissions/matter-access.utils', () => ({ validateMatterAccess: jest.fn() }));
    mocked('src/shared/logging/logger', () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn(), logDebug: jest.fn() }));
    const service = backend(SERVICE);
    if (typeof service.toCausationPayload !== 'function') {
      console.warn('[backend contract] ' + SERVICE + ' does not export toCausationPayload; documented shapes only.');
      return;
    }
    const payload = service.toCausationPayload(dbRow());
    const documented = apiRow();
    expect(Object.keys(payload).sort()).toEqual(Object.keys(documented).sort());
    expect(H.runRowView(payload, {})).toEqual(H.runRowView(documented, {}));
    const refused = service.toCausationPayload(dbRow({ run_id: null, outcome: 'skipped_paused' }));
    expect(H.runRowView(refused, {}).runId).toBe('');
    expect(H.runRowView(refused, {}).state).toBeNull();

    // Where the run is now, as its kind's status reader answered it.
    const key = 'agent_run:' + RUN_ID;
    const statuses = new Map([[key, { status: 'failed', state: 'failed', finished_at: '2026-10-31T10:05:00.000Z', execution_trace_id: 'trace-run-1' }]]);
    const now = H.runRowView(service.toCausationPayload(dbRow(), statuses), {});
    expect(now).toMatchObject({ state: { key: 'failed', label: 'Failed', detail: 'Status: Failed.' }, finishedAt: '2026-10-31T10:05:00.000Z', executionTraceId: 'trace-run-1' });
    // A state outside the contract reads as unknown: the outcome alone.
    const odd = service.toCausationPayload(dbRow(), new Map([[key, { status: 'weird', state: 'weird', finished_at: null }]]));
    expect(H.runRowView(odd, {})).toMatchObject({ state: null, executionTraceId: '' });
  });
});

describe('agent start answers (agents app startRun controller)', () => {
  test('202 started, queued, deferred and coalesced', () => {
    // The controller's run is queued for the worker: the card shows it going, Start off.
    expect(R.startResultView({ outcome: 'started', run: { id: 'r1', status: 'queued' }, queue: {} }, 'Funding review')).toEqual({ kind: 'success', label: 'Queued', tone: 'blue', text: 'Funding review started', toast: true, activeRunId: 'r1', running: true });
    expect(R.startResultView({ outcome: 'queued', run: null }, 'X')).toMatchObject({ kind: 'info', label: 'Queued', activeRunId: null });
    expect(R.startResultView({ outcome: 'deferred', run: null, active_run_id: RUN_ID }, 'X')).toMatchObject({ kind: 'info', label: 'Follow-up queued', activeRunId: RUN_ID });
    expect(R.startResultView({ outcome: 'coalesced', run: null, active_run_id: null }, 'X')).toMatchObject({ kind: 'info', label: 'Combined', activeRunId: null });
  });

  test('409 ACTIVE_RUN_EXISTS names the run already going, error.details.active_run_id first', () => {
    const error = { status: 409, code: 'ACTIVE_RUN_EXISTS', data: { error: { code: 'ACTIVE_RUN_EXISTS', message: 'x', active_run_id: RUN_ID } } };
    expect(R.startErrorView(error)).toMatchObject({ kind: 'info', label: 'Running now', activeRunId: RUN_ID, running: true, toast: false });
    const both = { status: 409, code: 'ACTIVE_RUN_EXISTS', data: { error: { code: 'ACTIVE_RUN_EXISTS', active_run_id: 'top', details: { active_run_id: RUN_ID } }, active_run_id: 'top' } };
    expect(R.startErrorView(both).activeRunId).toBe(RUN_ID);
    expect(R.startErrorView({ status: 409, code: 'ACTIVE_RUN_EXISTS', data: { active_run_id: RUN_ID } }).activeRunId).toBe(RUN_ID);
    expect(R.startErrorView({ status: 409, code: 'ACTIVE_RUN_EXISTS', data: {} }).activeRunId).toBeNull();
    expect(R.startErrorView({ status: 409, code: 'skipped_active_run', data: { error: { code: 'skipped_active_run', details: { active_run_id: RUN_ID } } } })).toMatchObject({ label: 'Running now', activeRunId: RUN_ID });
  });
});

'use strict';

/**
 * The admin Run controls page against the backend's own run limits and usage
 * code: the PUT body the editor builds passes the route model, the real
 * run limits service's answers (defaults and a stored row) fill the editor,
 * the real validator and error handler refusals land on the right field or
 * zone, a stale save (the real repository on an in-memory client) answers
 * 409 RUN_LIMITS_STALE with the current limits and the change saved again on
 * them goes through, and the real agents usage service's answer
 * (repositories mocked) renders tiles and breakdowns with matter labels. The backend is LANA_BACKEND_DIR when set,
 * else the sibling worktree .runtime/lana-estate-rulebook, else a sibling
 * LANA-AI/ (tests/fixtures/backend-checkout.js).
 */

const { findBackend, answerOf } = require('../fixtures/backend-checkout.js');
const V = require('../../src/js/shared/run-controls.js');
const RunControlsAPIClient = require('../../src/js/api/run-controls-api.client.js');

const RUN_MODELS = 'src/services/processor/runs/runs.models.js';
const LIMITS_SERVICE = 'src/services/runs/run-limits.service.js';
const LIMITS_REPOSITORY = 'src/repositories/org-run-limits.repository.js';
const CONTRACT = 'src/shared/contracts/run-causation.contract.js';
const ERROR_HANDLER = 'src/shared/errors/error-handler.js';
const APP_ERRORS = 'src/shared/errors/app.error.js';
const VALIDATION = 'src/shared/utils/validation.utils.js';
const USAGE_SERVICE = '@agents/src/services/agent-stats.service.js';
const MATTER_IDENTITY = '@agents/src/repositories/matter-identity.repository.js';
const USAGE_MODELS = '@agents/src/routes/agents-request.contract.js';

const checkout = findBackend([RUN_MODELS, LIMITS_SERVICE, LIMITS_REPOSITORY, ERROR_HANDLER, VALIDATION, USAGE_SERVICE, MATTER_IDENTITY, USAGE_MODELS]);
const backend = checkout.require;
const describeBackend = checkout.describe;
const mocked = (relative, factory) => jest.doMock(checkout.path(relative), factory);
const quietLogger = () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn(), logDebug: jest.fn() });

const ORG = '0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c';
const ADMIN = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

// A stored org_run_limits row as the repository returns it (bigint as text).
function storedRow(overrides) {
  return {
    organization_id: ORG, max_automatic_agent_runs_per_day: 200, max_agent_spend_microdollars_per_day: null,
    automatic_runs_paused: false, paused_by: null, paused_by_name: null, paused_at: null, updated_by: ADMIN, updated_by_name: 'Avery Quill',
    created_at: '2026-10-30T12:00:00.000Z', updated_at: '2026-10-31T09:30:00.000Z',
    ...overrides,
  };
}

describeBackend('run limits against the backend route model, service and error handler', () => {
  let models;
  let service;
  let repository;
  let handler;
  let validateRequest;

  beforeAll(() => {
    jest.resetModules();
    repository = { findByOrganization: jest.fn(), updateLocked: jest.fn(), withAutomaticStartLock: jest.fn() };
    mocked('src/repositories/org-run-limits.repository', () => repository);
    mocked('src/services/runs/run-causation.service', () => ({ countAutomaticAgentStartsToday: jest.fn(async () => 37) }));
    mocked('src/shared/audit/audit-logger', () => ({ logAuditEvent: jest.fn() }));
    mocked('src/shared/logging/logger', quietLogger);
    models = backend(RUN_MODELS);
    service = backend(LIMITS_SERVICE);
    handler = backend(ERROR_HANDLER);
    validateRequest = backend(VALIDATION).validateRequest;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => { console.error.mockRestore(); jest.resetModules(); });

  // The answer the client would get for a PUT body (the route's validator, then the handler).
  function putAnswer(body) {
    let failure = null;
    validateRequest(models.updateRunLimitsSchema)({ body, path: '/', method: 'PUT' }, {}, (error) => { failure = error || null; });
    return failure ? answerOf(handler, failure) : null;
  }

  test('the editable fields are the service fields, and every editor body passes the route model', () => {
    expect([...V.LIMIT_FIELDS].sort()).toEqual([...service.LIMIT_FIELDS].sort());
    const limits = service.toLimitsPayload(storedRow());
    const bodies = [
      V.draftChange(limits, { paused: true }).change,
      V.draftChange(limits, { dailyLimit: '50', spend: '' }).change,
      V.draftChange(limits, { dailyLimit: '200', spend: '12.50' }).change,
      V.draftChange(service.toLimitsPayload(storedRow({ max_agent_spend_microdollars_per_day: '12500000' })), { dailyLimit: '200', spend: '' }).change,
    ];
    const readAt = { expected_updated_at: '2026-10-31T09:30:00.000Z' };
    expect(bodies).toEqual([
      { automatic_runs_paused: true, ...readAt },
      { max_automatic_agent_runs_per_day: 50, ...readAt },
      { max_agent_spend_microdollars_per_day: 12500000, ...readAt },
      { max_agent_spend_microdollars_per_day: null, ...readAt },
    ]);
    bodies.forEach((body) => expect(putAnswer(body)).toBeNull());
    // Defaults are read at no revision; that body passes too.
    const fromDefaults = V.draftChange(service.toLimitsPayload(null), { paused: true }).change;
    expect(fromDefaults).toEqual({ automatic_runs_paused: true, expected_updated_at: null });
    expect(putAnswer(fromDefaults)).toBeNull();
    // Control: the route model requires the revision.
    expect(putAnswer({ automatic_runs_paused: true })).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    const request = RunControlsAPIClient.requests.updateRunLimits(bodies[0]);
    expect(request).toEqual({ method: 'PUT', path: '/api/v1/admin/run-limits', body: { automatic_runs_paused: true, expected_updated_at: '2026-10-31T09:30:00.000Z' } });
  });

  test('defaults and a stored paused row from the real service fill the editor', async () => {
    const { DEFAULT_RUN_LIMITS } = backend(CONTRACT);
    repository.findByOrganization.mockResolvedValueOnce(null);
    const defaults = await service.getLimits({ organizationId: ORG });
    expect(V.limitsView(defaults, () => 'when')).toEqual({
      paused: false, statusText: 'Automatic runs start as their events and schedules ask.', statusTone: 'green', statusLabel: 'Running',
      dailyLimit: String(DEFAULT_RUN_LIMITS.max_automatic_agent_runs_per_day), spend: '',
      updatedText: 'These are the defaults. No one has changed them yet.',
      usedToday: '37 of ' + DEFAULT_RUN_LIMITS.max_automatic_agent_runs_per_day + ' used today',
    });

    repository.updateLocked.mockResolvedValueOnce({
      previous: storedRow(),
      row: storedRow({ automatic_runs_paused: true, paused_by: ADMIN, paused_by_name: 'Avery Quill', paused_at: '2026-11-01T14:00:00.000Z', max_agent_spend_microdollars_per_day: '25000000' }),
    });
    const saved = await service.updateLimits({ actor: { userId: ADMIN, organizationId: ORG }, input: { automatic_runs_paused: true, expected_updated_at: '2026-10-31T09:30:00.000Z' } });
    const shown = V.limitsView(saved, (value) => 'at ' + value);
    expect(shown).toMatchObject({ paused: true, statusLabel: 'Paused', statusTone: 'yellow', spend: '25', dailyLimit: '200', usedToday: '37 of 200 used today' });
    expect(shown.statusText).toBe('Paused since at 2026-11-01T14:00:00.000Z by Avery Quill.');
    expect(shown.updatedText).toBe('Last changed at 2026-10-31T09:30:00.000Z by Avery Quill.');
    // Unchanged editor text sends nothing.
    expect(V.draftChange(saved, { dailyLimit: shown.dailyLimit, spend: shown.spend }).change).toBeNull();
  });

  test('a value the route model refuses lands on its field with the model message; an accepted control saves', () => {
    const tooMany = putAnswer({ max_automatic_agent_runs_per_day: 100001, expected_updated_at: null });
    expect(tooMany).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    const refusal = V.errorView(tooMany);
    expect(refusal).toMatchObject({ kind: 'field', field: 'max_automatic_agent_runs_per_day' });
    expect(refusal.text).not.toBe('Validation failed');
    expect(refusal.text.length).toBeGreaterThan(0);

    const fraction = V.errorView(putAnswer(V.draftChange(service.toLimitsPayload(storedRow()), { dailyLimit: '2.5' }).change));
    expect(fraction).toMatchObject({ kind: 'field', field: 'max_automatic_agent_runs_per_day' });
    const negativeSpend = V.errorView(putAnswer(V.draftChange(service.toLimitsPayload(storedRow()), { spend: '-1' }).change));
    expect(negativeSpend).toMatchObject({ kind: 'field', field: 'max_agent_spend_microdollars_per_day' });

    expect(putAnswer({ max_automatic_agent_runs_per_day: 100000, expected_updated_at: null })).toBeNull();
  });

  test('a refused admin read shows the server message in place of the zone', () => {
    const { AuthorizationError } = backend(APP_ERRORS);
    const answer = answerOf(handler, new AuthorizationError('Permission required: admin:manage_organization'));
    expect(answer.status).toBe(403);
    expect(V.errorView(answer)).toEqual({ kind: 'forbidden', title: 'Not permitted', text: 'Permission required: admin:manage_organization' });
  });
});

// org_run_limits as the repository's transaction sees it: one row (or none),
// pg Dates for the timestamps, the names its named read joins.
function inMemoryRunLimits(initial) {
  const NAMES = { [ADMIN]: 'Avery Quill', [OTHER_ADMIN]: 'Sam Lee' };
  const state = { row: initial ? { ...initial } : null, writes: 0, clock: Date.parse('2026-11-01T15:00:00.123Z') };
  const named = () => (state.row ? [{ ...state.row, paused_by_name: NAMES[state.row.paused_by] || null, updated_by_name: NAMES[state.row.updated_by] || null }] : []);
  const query = async (sql, params = []) => {
    const text = String(sql).trim();
    if (text === 'BEGIN') { state.before = state.row; return { rows: [] }; }
    if (text === 'ROLLBACK') { state.row = state.before; return { rows: [] }; }
    if (text === 'COMMIT') return { rows: [] };
    if (text.startsWith('INSERT INTO org_run_limits')) {
      if (state.row) return { rowCount: 0, rows: [] };
      state.row = { organization_id: params[0], max_automatic_agent_runs_per_day: 200, max_agent_spend_microdollars_per_day: null, automatic_runs_paused: false,
        paused_by: null, paused_at: null, updated_by: null, created_at: new Date(state.clock), updated_at: new Date(state.clock) };
      return { rowCount: 1, rows: [] };
    }
    if (text.includes('FOR UPDATE')) return { rows: state.row ? [{ ...state.row }] : [] };
    if (text.startsWith('UPDATE org_run_limits')) {
      const [, hasDaily, daily, hasSpend, spend, hasPaused, paused, by] = params;
      const next = { ...state.row };
      if (hasDaily) next.max_automatic_agent_runs_per_day = daily;
      if (hasSpend) next.max_agent_spend_microdollars_per_day = spend === null ? null : String(spend);
      if (hasPaused) next.automatic_runs_paused = paused;
      state.clock += 1000;
      Object.assign(next, { updated_by: by, updated_at: new Date(state.clock) });
      state.row = next;
      state.writes += 1;
      return { rows: [{ ...next }] };
    }
    if (text.startsWith('SELECT l.organization_id')) return { rows: named() };
    throw new Error('Unexpected SQL in the run limits fake: ' + text.slice(0, 60));
  };
  return { state, postgres: { query, getClient: async () => ({ query, release: () => {} }) } };
}

const OTHER_ADMIN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

describeBackend('a stale save against the real repository, service and error handler', () => {
  let service;
  let handler;
  let db;

  beforeAll(() => {
    jest.resetModules();
    db = inMemoryRunLimits({ organization_id: ORG, max_automatic_agent_runs_per_day: 200, max_agent_spend_microdollars_per_day: null, automatic_runs_paused: false,
      paused_by: null, paused_at: null, updated_by: ADMIN, created_at: new Date('2026-10-30T12:00:00.000Z'), updated_at: new Date('2026-10-31T09:30:00.456Z') });
    // The real repository this time (the suite above mocked it).
    jest.dontMock(checkout.path('src/repositories/org-run-limits.repository'));
    mocked('src/shared/database/postgres.client', () => db.postgres);
    mocked('src/services/runs/run-causation.service', () => ({ countAutomaticAgentStartsToday: jest.fn(async () => 12) }));
    mocked('src/shared/audit/audit-logger', () => ({ logAuditEvent: jest.fn() }));
    mocked('src/shared/logging/logger', quietLogger);
    service = backend(LIMITS_SERVICE);
    handler = backend(ERROR_HANDLER);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => { console.error.mockRestore(); jest.resetModules(); });

  // What the client holds: the JSON the server sent.
  const wire = (value) => JSON.parse(JSON.stringify(value));
  const save = (actor, body) => service.updateLimits({ actor: { userId: actor, organizationId: ORG }, input: body });

  test('the editor read is stale after another admin saved: 409 with the current limits, nothing written; saved again on them it goes through', async () => {
    const mine = wire(await service.getLimits({ organizationId: ORG }));
    const theirs = wire(await service.getLimits({ organizationId: ORG }));
    // Control: the revision the client sends from what it read is accepted.
    await save(OTHER_ADMIN, V.draftChange(theirs, { dailyLimit: '80' }).change);
    expect(db.state.writes).toBe(1);

    const change = V.draftChange(mine, { dailyLimit: '50', spend: '12.5' }).change;
    const refused = await save(ADMIN, change).then(() => null, (error) => error);
    expect(refused).toMatchObject({ statusCode: 409, code: 'RUN_LIMITS_STALE' });
    expect(db.state.writes).toBe(1);
    const answer = answerOf(handler, refused);
    answer.data = wire(answer.data);
    expect(answer.status).toBe(409);
    const view = V.errorView(answer);
    expect(view).toMatchObject({ kind: 'stale', title: 'Not saved' });
    expect(V.limitsView(view.limits, () => 'when')).toMatchObject({ dailyLimit: '80', updatedText: 'Last changed when by Sam Lee.', usedToday: '12 of 80 used today' });
    expect(V.changeSummary(change)).toBe('Automatic agent runs per day: 50. Daily spend figure: $12.50.');

    // Saved again on the current limits (the page's re-apply).
    const again = { max_automatic_agent_runs_per_day: 50, max_agent_spend_microdollars_per_day: 12500000, expected_updated_at: V.revisionOf(view.limits) };
    const saved = wire(await save(ADMIN, again));
    expect(db.state.writes).toBe(2);
    expect(V.limitsView(saved, () => 'when')).toMatchObject({ dailyLimit: '50', spend: '12.5', updatedText: 'Last changed when by Avery Quill.' });
  });

  test('a first save from the defaults (no row) sends no revision; a revision when there is no row is stale', async () => {
    db.state.row = null;
    const defaults = wire(await service.getLimits({ organizationId: ORG }));
    expect(defaults.is_default).toBe(true);
    const stale = await save(ADMIN, { automatic_runs_paused: true, expected_updated_at: '2026-10-31T09:30:00.000Z' }).then(() => null, (error) => error);
    expect(stale).toMatchObject({ code: 'RUN_LIMITS_STALE' });
    const saved = wire(await save(ADMIN, V.draftChange(defaults, { paused: true }).change));
    expect(saved).toMatchObject({ automatic_runs_paused: true, is_default: false });
  });
});

describeBackend('agent usage against the real agents usage service', () => {
  let service;
  const stats = { fetchOrgUsage: jest.fn() };
  const pricing = { findCurrent: jest.fn() };
  const access = { canAccessDefinition: jest.fn() };
  const matterAccess = { validateMatterAccess: jest.fn() };
  const identity = { matterLabelsByUuid: jest.fn() };

  beforeAll(() => {
    jest.resetModules();
    class AgentValidationError extends Error {
      constructor(message, status) { super(message); this.name = 'AgentValidationError'; this.status = status; }
    }
    mocked('@agents/src/repositories/agent-stats.repository', () => stats);
    mocked('@agents/src/repositories/model-pricing.repository', () => pricing);
    mocked('@agents/src/repositories/agents.repository', () => ({}));
    mocked('@agents/src/repositories/llm-inference-events.repository', () => ({}));
    mocked('@agents/src/services/agent-definition-access.service', () => access);
    mocked('@agents/src/services/agents.service', () => ({ AgentValidationError }));
    mocked('src/services/document-studio/document-studio.facade', () => matterAccess);
    mocked('@agents/src/repositories/matter-identity.repository', () => identity);
    mocked('src/shared/logging/logger', quietLogger);
    service = backend(USAGE_SERVICE);
  });
  afterAll(() => jest.resetModules());

  test('totals, agents, triggers and matters render; unpriced models read as not priced; hidden rows stay hidden', async () => {
    const definition = { definition_organization_id: ORG, definition_template_slug: null, definition_visibility: 'organization', definition_created_by: ADMIN, definition_matter_id: null };
    stats.fetchOrgUsage.mockResolvedValueOnce({
      runs: [
        { agent_definition_id: 'def-review', agent_slug: 'funding-review', agent_name: 'Funding review', trigger_type: 'event', matter_id: 'matter-a', runs: 3, ...definition },
        { agent_definition_id: 'def-review', agent_slug: 'funding-review', agent_name: 'Funding review', trigger_type: 'manual', matter_id: 'matter-a', runs: 1, ...definition },
        { agent_definition_id: 'def-private', agent_slug: 'private-helper', agent_name: 'Private helper', trigger_type: 'manual', matter_id: 'matter-hidden', runs: 2, ...definition },
        { agent_definition_id: 'def-review', agent_slug: 'funding-review', agent_name: 'Funding review', trigger_type: 'schedule', matter_id: 'matter-unnamed', runs: 1, ...definition },
        { agent_definition_id: 'def-review', agent_slug: 'funding-review', agent_name: 'Funding review', trigger_type: 'schedule', matter_id: null, runs: 1, ...definition },
      ],
      tokens: [
        { agent_definition_id: 'def-review', trigger_type: 'event', matter_id: 'matter-a', model_name: 'priced-model', input_tokens: '1000', output_tokens: '500', total_tokens: '1500' },
        { agent_definition_id: 'def-review', trigger_type: 'manual', matter_id: 'matter-a', model_name: 'unpriced-model', input_tokens: '10', output_tokens: '5', total_tokens: '15' },
      ],
    });
    pricing.findCurrent.mockImplementation(async ({ modelName }) => (modelName === 'priced-model'
      ? { input_token_microdollars: 3, output_token_microdollars: 15, currency: 'USD' } : null));
    access.canAccessDefinition.mockImplementation(async (def) => def.id !== 'def-private');
    matterAccess.validateMatterAccess.mockImplementation(async (matterId) => { if (matterId === 'matter-hidden') throw new Error('no'); });
    identity.matterLabelsByUuid.mockResolvedValueOnce(new Map([['matter-a', { matter_code: 'MATT-02417', matter_name: 'Fairweather Revocable Trust' }]]));

    const window = V.periodWindow('7', new Date('2026-11-01T12:00:00.000Z'));
    expect(window).toEqual({ since: '2026-10-25T12:00:00.000Z', until: '2026-11-01T12:00:00.000Z' });
    expect(RunControlsAPIClient.requests.usage(window).path)
      .toBe('/api/v1/agents/usage?since=2026-10-25T12%3A00%3A00.000Z&until=2026-11-01T12%3A00%3A00.000Z');
    const usage = await service.getOrgUsage({ organizationId: ORG, viewer: { userId: ADMIN }, since: window.since, until: window.until });
    expect(usage.window).toEqual(window);

    const shown = V.usageView(usage);
    expect(shown.tiles).toEqual([
      { key: 'runs', label: 'Agent runs', value: '8' },
      { key: 'tokens', label: 'Tokens', value: '1,515', detail: '1,010 in, 505 out' },
      { key: 'cost', label: 'Estimated cost', value: '$0.0105' },
    ]);
    expect(shown.agents).toEqual([{ id: 'def-review', agent: 'Funding review', runs: '6', tokens: '1,515', cost: '$0.0105' }]);
    expect(shown.triggers).toEqual([
      { id: 'event', trigger: 'An event', runs: '3', tokens: '1,500', cost: '$0.0105' },
      { id: 'manual', trigger: 'A person', runs: '3', tokens: '15', cost: 'Not priced' },
      { id: 'schedule', trigger: 'A schedule', runs: '2', tokens: '0', cost: 'Not priced' },
    ]);
    // Matter labels come from the identity lookup, asked only for the matters the viewer may read;
    // a matter it could not name reads generically, never as its id.
    expect(identity.matterLabelsByUuid).toHaveBeenCalledWith({ organizationId: ORG, matterUuids: expect.arrayContaining(['matter-a', 'matter-unnamed']) });
    expect(identity.matterLabelsByUuid.mock.calls[0][0].matterUuids).not.toContain('matter-hidden');
    expect(shown.matters.map((row) => [row.id, row.matter, row.runs])).toEqual([
      ['matter-a', 'Fairweather Revocable Trust (MATT-02417)', '4'],
      ['matter-unnamed', 'Unnamed matter', '1'],
      ['none', 'No matter', '1'],
    ]);
  });
});

describeBackend('the usage window against the backend usage route model', () => {
  // The route refuses a since/until that is not an ISO date-time (400 VALIDATION_ERROR).
  test('every period the page offers sends a window the route accepts; control: a malformed one is refused', () => {
    const { getOrgUsageSchema } = backend(USAGE_MODELS);
    V.PERIODS.forEach((period) => {
      const window = V.periodWindow(period.value, new Date('2026-11-01T12:00:00.000Z'));
      expect(getOrgUsageSchema.query.safeParse(window).success).toBe(true);
    });
    expect(getOrgUsageSchema.query.safeParse({}).success).toBe(true);
    expect(getOrgUsageSchema.query.safeParse({ since: 'last week' }).success).toBe(false);
  });
});

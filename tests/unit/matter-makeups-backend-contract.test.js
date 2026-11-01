'use strict';

/**
 * Matter makeups, tabs and the switch against the backend's own code.
 *
 * Loads the standard makeup JSON, the makeups contract, schema and route
 * models, and runs the real makeups service and controller (repositories and
 * the apps' repositories mocked; the @automation and @agents runnable
 * providers are the real ones) to check that:
 *   - the client's fallback tabs are exactly the server's standard makeup,
 *     and its built-in and generic kinds are the contract's;
 *   - the view model the server answers drives the tab bar and the drawer
 *     (trigger_summary under the skill name, readiness null or nothing to
 *     check asks nothing, the readiness summary words the collapsed line);
 *   - the readiness route's checks (real readiness service and the catalog
 *     agent's real needs; its repositories mocked) drive the checklist:
 *     labels, counts, fixes to a tab, unknown last, an unavailable reason,
 *     and the rulebook check's reason when no deployment jurisdiction is set;
 *   - tab content answers (content, unavailable, built_in) read as intended;
 *   - the switch body passes the route model, the PUT answer (effects.status)
 *     is worded, and the 403, 404, 409 MAKEUP_SWITCH_IN_PROGRESS and 503
 *     MAKEUP_SWITCH_INCOMPLETE the error handler sends are classified as the
 *     client expects.
 * Where the backend is looked for: tests/fixtures/backend-checkout.js.
 */

const { findBackend, answerOf, hermeticTracing } = require('../fixtures/backend-checkout.js');
global.LanaRunHistory = require('../../src/js/shared/run-history.js');
const Registry = require('../../src/js/shared/matter-tab-registry.js');
const NoteLabels = require('../../src/js/shared/note-labels.js');
const Runnables = require('../../src/js/shared/matter-runnables.js');
const Switch = require('../../src/js/shared/makeup-switch.js');
const MatterMakeupAPIClient = require('../../src/js/api/matter-makeup-api.client.js');

const STANDARD = 'src/domains/platform/makeups/standard.makeup.json';
const CONTRACT = 'src/shared/contracts/matter-makeups.contract.js';
const SCHEMA = 'src/services/matter-makeups/makeup.schema.js';
const SERVICE = 'src/services/matter-makeups/matter-makeups.service.js';
const CONTROLLER = 'src/services/processor/matter-makeups/matter-makeups.controller.js';
const ROUTE_MODELS = 'src/services/processor/matter-makeups/matter-makeups.models.js';
const TAB_CONTENT = 'src/services/matter-makeups/tab-content.models.js';
const ERROR_HANDLER = 'src/shared/errors/error-handler.js';
const SKILLS = '@automation/src/automations/services/makeup-runnables.service.js';
const AGENTS = '@agents/src/services/makeup-runnables.service.js';

const checkout = findBackend([STANDARD, CONTRACT, SERVICE, CONTROLLER, ROUTE_MODELS]);
const backend = checkout.require;
const describeBackend = checkout.describe;

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OWNER = '00000000-0000-4000-8000-0000000000b1';
const MATTER = { uuid: '00000000-0000-4000-8000-000000000001', code: 'MATT-1' };
const AUTOMATION_ID = '00000000-0000-4000-8000-0000000000c1';
const DEFINITION_ID = '00000000-0000-4000-8000-0000000000d1';

const tabShape = (tab) => {
  const out = { id: tab.id, kind: tab.kind, label: tab.label };
  if (tab.hidden) out.hidden = true;
  return out;
};

describeBackend('client fallback and kinds equal the server standard makeup', () => {
  let standard;
  let contract;
  beforeAll(() => {
    standard = backend(STANDARD);
    contract = backend(CONTRACT);
  });

  test('STANDARD_TABS is the standard makeup tab list, in order, with the same labels and hidden flags', () => {
    expect(Registry.STANDARD_TABS.map(tabShape)).toEqual(standard.tabs.map(tabShape));
    expect(standard.key).toBe(contract.DEFAULT_MAKEUP_KEY);
  });

  test('the standard makeup is a valid makeup by the server schema', () => {
    expect(backend(SCHEMA).makeupDefinitionSchema.safeParse(standard).success).toBe(true);
  });

  test('the fallback note labels are the standard makeup fact labels', () => {
    expect(NoteLabels.PLATFORM_FACT_LABELS.map((l) => ({ key: l.key, label: l.label }))).toEqual(standard.fact_labels);
  });

  test('built-in kinds and their labels are the contract built-in kinds; generic kinds have a renderer', () => {
    const builtIn = {};
    Object.keys(Registry.BUILT_IN_KINDS).forEach((kind) => { builtIn[kind] = Registry.BUILT_IN_KINDS[kind].label; });
    expect(builtIn).toEqual({ ...contract.BUILT_IN_TAB_KINDS });
    global.LanaMatterTabRegistry = Registry.createRegistry();
    jest.isolateModules(() => require('../../src/js/shared/matter-generic-tabs.js'));
    Object.keys(contract.GENERIC_TAB_KINDS).forEach((kind) => expect(global.LanaMatterTabRegistry.isKnownKind(kind)).toBe(true));
    delete global.LanaMatterTabRegistry;
  });
});

describeBackend('the real makeups service and controller drive the page', () => {
  const repo = {
    listAssignable: jest.fn(), findAssignableVersion: jest.fn(), findMatterMakeup: jest.fn(),
    findLatestAssignment: jest.fn(), assignVersion: jest.fn(),
    // The switch's transaction and lock (repository); here it only runs the steps.
    withMatterMakeupLock: jest.fn(async (_scope, fn) => fn()),
  };
  const automations = { findUsableByKeys: jest.fn() };
  const bindings = { findMatterBindings: jest.fn(), enableForMakeup: jest.fn(), disableOwnedByMakeup: jest.fn() };
  const agents = { findBySlug: jest.fn() };
  // The agent's runs already going on the matter (one read for the makeup's agents).
  const agentRuns = { listActiveForMatter: jest.fn(), TERMINAL_STATUSES: new Set(['completed', 'failed', 'rejected', 'cancelled']) };
  const tasks = { findBySource: jest.fn() };
  const tasksService = { createTaskAs: jest.fn() };
  const readinessCounts = { countMatterEntities: jest.fn(), countMatterFacts: jest.fn() };
  // The @agents org kill switch read (no rule: enabled).
  const agentRules = { findModuleAccessRule: jest.fn() };
  const permissions = { hasPermission: jest.fn() };
  // The assurance service as it answers on a box with no deployment context:
  // the real rulebook-context reason, no modules (the rulebook check is unknown).
  const assurance = { adoptedRulebookModules: jest.fn(), matterRecordCounts: jest.fn() };
  let controller;
  let tracer;
  let models;
  let handler;
  let runnableRegistry;
  let tabProviders;
  let standard;
  let special;

  beforeAll(() => {
    const mocked = (relative, factory) => jest.doMock(checkout.path(relative), factory);
    mocked('src/repositories/matter-makeups.repository', () => repo);
    mocked('src/services/processor/tasks/tasks.repository', () => tasks);
    mocked('src/services/processor/tasks/tasks.service', () => tasksService);
    mocked('src/services/task-actions/task-actions.service', () => ({ createTaskAction: jest.fn() }));
    mocked('src/shared/permissions/matter-access.utils', () => ({
      validateMatterAccess: jest.fn(async () => true), gatedMatterIdentity: (req) => req.matter,
    }));
    mocked('src/shared/permissions/permission.utils', () => permissions);
    mocked('src/shared/audit/audit-logger', () => ({ logAuditEvent: jest.fn() }));
    mocked('src/shared/events/platform-event-dispatch.service', () => ({ publishPlatformEvent: jest.fn() }));
    mocked('src/shared/logging/logger', () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn(), logDebug: jest.fn() }));
    mocked('@automation/src/automations/repositories/automation.repository', () => automations);
    mocked('@automation/src/automations/repositories/matter-automation.repository', () => bindings);
    mocked('@agents/src/repositories/agents.repository', () => agents);
    mocked('@agents/src/repositories/agent-runs.repository', () => agentRuns);
    // The run access rule (agent-run-access.service) is the real one; its
    // matter check and reviewer lookup are its seams.
    mocked('src/services/document-studio/document-studio.facade', () => ({ validateMatterAccess: jest.fn(async () => true) }));
    mocked('@agents/src/repositories/agent-run-access.repository', () => ({ isAssignedArtifactApprover: jest.fn(async () => false) }));
    mocked('src/repositories/makeup-readiness.repository', () => readinessCounts);
    mocked('@agents/src/repositories/agent-execution.repository', () => agentRules);
    mocked('src/services/implementation-assurance/assurance.service', () => ({ getImplementationAssuranceService: () => assurance }));

    // Hermetic: the tracer is in memory (its own tests' seam), never chat_traces.
    tracer = hermeticTracing(checkout.path);
    controller = backend(CONTROLLER);
    models = backend(ROUTE_MODELS);
    handler = backend(ERROR_HANDLER);
    runnableRegistry = backend('src/shared/runnables/runnable-registry.js');
    tabProviders = backend('src/services/matter-makeups/tab-provider-registry.js');
    runnableRegistry.registerRunnableProvider('skill', backend(SKILLS));
    runnableRegistry.registerRunnableProvider('agent', backend(AGENTS));
    tabProviders.registerTabProvider({
      key: 'contract.assets', kinds: ['records'],
      availability: async () => ({ available: true }),
      load: async () => ({ columns: [{ key: 'name', label: 'Name' }], rows: [{ id: 'r1', cells: { name: 'House' } }], next_cursor: null }),
    });
    tabProviders.registerTabProvider({
      key: 'contract.ledger', kinds: ['ledger'],
      availability: async () => ({ available: false, reason: 'The ledger is turned off for this organization.' }),
      load: async () => ({}),
    });
    standard = backend(STANDARD);
    special = {
      ...standard,
      key: 'special',
      name: 'Special',
      version: 2,
      tabs: [...standard.tabs, { id: 'assets', kind: 'records', label: 'Assets', provider: 'contract.assets' },
        { id: 'log', kind: 'ledger', label: 'Log', provider: 'contract.ledger' }],
      skills: [{ automation_key: 'nightly-review', default_enabled: true }],
      agents: [{ template_slug: 'matter-reviewer' }],
    };
  });

  afterAll(() => {
    expect(tracer.recorded).toEqual([]);
    runnableRegistry.unregisterRunnableProvider('skill');
    runnableRegistry.unregisterRunnableProvider('agent');
    tabProviders.unregisterTabProvider('contract.assets');
    tabProviders.unregisterTabProvider('contract.ledger');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repo.withMatterMakeupLock.mockImplementation(async (_scope, fn) => fn());
    repo.findMatterMakeup.mockResolvedValue({
      matter_uuid: MATTER.uuid, matter_code: MATTER.code, matter_created_by: OWNER, version_id: 'v-special-2',
      version: 2, definition: special, makeup_key: 'special', makeup_name: 'Special', makeup_description: null, latest_version: 3,
    });
    automations.findUsableByKeys.mockResolvedValue([{
      automation_key: 'nightly-review', automation_id: AUTOMATION_ID, automation_name: 'Nightly review', is_enabled: true,
      automation_config: { schedule: { frequency: 'daily', time: '09:00' } }, trigger_event_type: 'schedule',
    }]);
    bindings.findMatterBindings.mockResolvedValue([{ automation_id: AUTOMATION_ID, is_enabled: true }]);
    agents.findBySlug.mockResolvedValue({ id: DEFINITION_ID, name: 'Matter reviewer', description: 'Reads the file.' });
    agentRuns.listActiveForMatter.mockResolvedValue([]);
    readinessCounts.countMatterEntities.mockResolvedValue([]);
    readinessCounts.countMatterFacts.mockResolvedValue(new Map());
    agentRules.findModuleAccessRule.mockResolvedValue(null);
    permissions.hasPermission.mockResolvedValue(false);
    const { jurisdictionFrom } = backend('src/services/implementation-assurance/rulebook-context.js');
    assurance.adoptedRulebookModules.mockImplementation(async () => ({ ...jurisdictionFrom(null), modules: null }));
  });

  // Runs a controller handler as Express would: the bare body, or the error handler's answer.
  async function call(name, { params = {}, query = {}, body } = {}) {
    const req = { user: { id: OWNER, organizationId: ORG, roleId: 'r1' }, matter: MATTER, params, query, body, headers: {} };
    let answer = null;
    let failure = null;
    const res = { json: (value) => { answer = value; return res; } };
    await controller[name](req, res, (error) => { failure = error; });
    if (failure) throw answerOf(handler, failure);
    return answer;
  }

  test('GET makeup: the view drives the tab bar, labels and drawer; nothing to check asks nothing', async () => {
    // The owner may start agents (agents:run); the arm below is a person who may not.
    permissions.hasPermission.mockImplementation(async (_user, permission) => permission === 'agents:run');
    const view = await call('getMatterMakeup');
    const client = new MatterMakeupAPIClient({ get: jest.fn(async () => view) });
    expect(await client.getMakeup('MATT-1')).toBe(view);

    const tabs = Registry.buildTabs(view.tabs);
    expect(tabs.map((t) => t.id)).toEqual(special.tabs.map((t) => t.id));
    expect(Registry.barTabs(tabs).map((t) => t.label)).toEqual(['Summary', 'Notes', 'Board', 'Discussions', 'Documents', 'Billable Hours', 'Assets', 'Log']);
    expect(tabs.find((t) => t.id === 'log')).toMatchObject({ available: false, reason: 'The ledger is turned off for this organization.' });
    expect(NoteLabels.factLabels(view.fact_labels)).toEqual(view.fact_labels);

    const [agent, skill] = Runnables.runnableViews(view);
    // An agent outside the catalog declares no needs: ready with nothing to check, no line.
    expect(view.runnables[0].readiness).toEqual({ status: 'ready', total: 0, ready: 0, missing: 0, unknown: 0 });
    expect(agent).toMatchObject({ kind: 'agent', name: 'Matter reviewer', definitionId: DEFINITION_ID, startable: true, hasReadiness: false });
    expect(skill).toMatchObject({ kind: 'skill', name: 'Nightly review', automationId: AUTOMATION_ID, enabled: true, toggleable: true });
    expect(skill.triggerSummary).toMatch(/\S/);
    expect(skill.triggerSummary).toBe(view.runnables[1].trigger_summary);
    expect(Switch.currentMakeup(view)).toEqual({ key: 'special', name: 'Special', version: 2, latestVersion: 3 });
    expect(Switch.upgradeOffer(Switch.currentMakeup(view)).version).toBe(3);
    expect(Switch.canConfigure(view)).toBe(true);
  });

  test('GET makeup: a person without agents:run is offered no Start (control above: a holder is)', async () => {
    const view = await call('getMatterMakeup');
    expect(view.runnables[0]).toMatchObject({ kind: 'agent', available: true, can_start: false, start_blocked_reason: 'permission' });
    const [agent] = Runnables.runnableViews(view);
    expect(agent).toMatchObject({ kind: 'agent', available: true, startable: false });
  });

  test('GET makeup: an agent already running on the matter shows Start turned off with its run (control: none running is offered)', async () => {
    permissions.hasPermission.mockImplementation(async (_user, permission) => permission === 'agents:run');
    // A row as listActiveForMatter returns it: what the run access check reads too.
    const activeRow = (overrides) => ({
      id: 'run-1', agent_definition_id: DEFINITION_ID, status: 'running', organization_id: ORG, matter_id: MATTER.uuid,
      visibility: 'shared', created_by: 'someone-else', parent_run_id: null, ...overrides,
    });
    agentRuns.listActiveForMatter.mockResolvedValue([activeRow()]);
    const view = await call('getMatterMakeup');
    expect(agentRuns.listActiveForMatter).toHaveBeenCalledWith({ organizationId: ORG, matterId: MATTER.uuid, agentDefinitionIds: [DEFINITION_ID] });
    expect(view.runnables[0]).toMatchObject({
      kind: 'agent', can_start: false, start_blocked_reason: 'active_run', active_run: { id: 'run-1', status: 'running', state: 'active' },
    });
    const [agent] = Runnables.runnableViews(view);
    expect(agent).toMatchObject({ startable: false, running: { label: 'Running now', activeRunId: 'run-1', running: true } });

    // Another person's private run: the view says a run goes but not which; no View run link.
    agentRuns.listActiveForMatter.mockResolvedValue([activeRow({ visibility: 'private' })]);
    const hidden = await call('getMatterMakeup');
    expect(hidden.runnables[0]).toMatchObject({ can_start: false, start_blocked_reason: 'active_run', active_run: { status: 'running', state: 'active' } });
    expect(hidden.runnables[0].active_run).not.toHaveProperty('id');
    expect(Runnables.runnableViews(hidden)[0]).toMatchObject({ startable: false, running: { label: 'Running now', activeRunId: null, running: true } });

    agentRuns.listActiveForMatter.mockResolvedValue([]);
    const offered = await call('getMatterMakeup');
    expect(offered.runnables[0]).toMatchObject({ can_start: true, start_blocked_reason: null, active_run: null });
    expect(Runnables.runnableViews(offered)[0]).toMatchObject({ startable: true, running: null });
  });

  test('GET tabs: content, unavailable and built_in answers read as the renderer acts on them', async () => {
    expect(models.getMatterTabSchema.query.safeParse({ cursor: 'c2' }).success).toBe(true);
    const content = MatterMakeupAPIClient.tabPage(await call('getMatterTab', { params: { tab_id: 'assets' } }));
    expect(content.state).toBe('content');
    expect(backend(TAB_CONTENT).tabContentSchema.strict().safeParse(content.content).success).toBe(true);
    expect(content.content.rows[0].cells.name).toBe('House');
    expect(MatterMakeupAPIClient.tabPage(await call('getMatterTab', { params: { tab_id: 'log' } })))
      .toEqual({ state: 'unavailable', reason: 'The ledger is turned off for this organization.' });
    expect(MatterMakeupAPIClient.tabPage(await call('getMatterTab', { params: { tab_id: 'notes' } }))).toEqual({ state: 'built_in' });
    // Control arm: a tab the makeup does not have is a 404, not content.
    await expect(call('getMatterTab', { params: { tab_id: 'nope' } })).rejects.toMatchObject({ status: 404 });
  });

  test('GET makeups: the list maps to the switch options', async () => {
    repo.listAssignable.mockResolvedValue([
      { key: 'standard', name: 'Standard', description: 'Every matter', latest_version: 1, organization_id: null },
      { key: 'special', name: 'Special', description: null, latest_version: 3, organization_id: ORG },
    ]);
    expect(Switch.makeupList(await call('listMakeups'))).toEqual([
      { key: 'standard', name: 'Standard', description: 'Every matter', latestVersion: 1, scope: 'system' },
      { key: 'special', name: 'Special', description: '', latestVersion: 3, scope: 'organization' },
    ]);
  });

  test('PUT makeup: the client body parses, the answer is worded; 403, 404 and 503 classify as expected', async () => {
    const view = await call('getMatterMakeup');
    const plan = Switch.switchPlan(Switch.currentMakeup(view), 'standard', [{ key: 'standard', name: 'Standard', latestVersion: 1 }]);
    const { body } = Switch.switchBody(plan, 'Back to the standard tabs');
    expect(models.switchMatterMakeupSchema.body.parse(body)).toEqual(body);
    expect(MatterMakeupAPIClient.requests.switchMakeup('MATT-1', body).method).toBe('PUT');

    repo.findAssignableVersion.mockResolvedValue({ version_id: 'v-standard-1', version: 1, definition: standard, makeup_key: 'standard' });
    repo.assignVersion.mockResolvedValue({ outcome: 'switched', assignment: { id: 'as-1', from_version_id: 'v-special-2', to_version_id: 'v-standard-1' } });
    bindings.disableOwnedByMakeup.mockResolvedValue(1);
    const answer = await call('switchMatterMakeup', { body });
    expect(answer).toMatchObject({ outcome: 'switched', effects: { skills_disabled: 1, starter_tasks_created: 0 }, tabs: expect.any(Array) });
    expect(answer.effects.status).toBe('complete');
    expect(Switch.switchResultView(answer, plan)).toEqual({ kind: 'success', text: 'Makeup changed, setup complete (1 skill turned off)', incomplete: false });

    // A resend after a 503: same version, unchanged, setup finished.
    repo.assignVersion.mockResolvedValue({ outcome: 'unchanged' });
    repo.findLatestAssignment.mockResolvedValue({ id: 'as-1', from_version_id: 'v-special-2', to_version_id: 'v-standard-1' });
    bindings.disableOwnedByMakeup.mockResolvedValue(0);
    const resent = await call('switchMatterMakeup', { body });
    expect(resent.outcome).toBe('unchanged');
    expect(Switch.switchResultView(resent, plan).text).toBe('The makeup setup is complete');

    bindings.disableOwnedByMakeup.mockRejectedValueOnce(new Error('pool exhausted'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const incomplete = await call('switchMatterMakeup', { body }).catch((error) => error);
    expect(incomplete).toMatchObject({ status: 503, code: 'MAKEUP_SWITCH_INCOMPLETE' });
    expect(Switch.isIncomplete(incomplete)).toBe(true);
    expect(Switch.switchErrorMessage(incomplete)).toContain('Finish setup');

    // Another switch holds the matter's lock: 409 retryable, resent unchanged.
    repo.withMatterMakeupLock.mockRejectedValueOnce(Object.assign(new Error('lock timeout'), { code: '55P03' }));
    const busy = await call('switchMatterMakeup', { body }).catch((error) => error);
    expect(busy).toMatchObject({ status: 409, code: 'MAKEUP_SWITCH_IN_PROGRESS', data: { error: { retryable: true } } });
    expect(Switch.isInProgress(busy)).toBe(true);
    expect(Switch.needsFinish(busy)).toBe(true);
    const sent = [];
    const resent2 = await Switch.sendSwitch(async (b) => { sent.push(b); return call('switchMatterMakeup', { body: b }); }, body, { delays: [1], wait: async () => {} });
    expect(resent2.outcome).toBe('unchanged');
    expect(sent).toEqual([body]);

    repo.findAssignableVersion.mockResolvedValueOnce(null);
    const missing = await call('switchMatterMakeup', { body }).catch((error) => error);
    expect(missing.status).toBe(404);
    expect(Switch.isIncomplete(missing)).toBe(false);
    expect(Switch.isInProgress(missing)).toBe(false);
    expect(Switch.switchErrorMessage(missing)).toContain('not available');

    repo.findMatterMakeup.mockResolvedValue({
      matter_uuid: MATTER.uuid, matter_code: MATTER.code, matter_created_by: 'someone-else', version_id: 'v-special-2',
      version: 2, definition: special, makeup_key: 'special', makeup_name: 'Special', latest_version: 3,
    });
    const forbidden = await call('switchMatterMakeup', { body }).catch((error) => error);
    expect(forbidden).toMatchObject({ status: 403, code: 'MAKEUP_CONFIGURE_FORBIDDEN' });
    expect(Switch.switchErrorMessage(forbidden)).toContain('permission');
    expect(Switch.canConfigure(await call('getMatterMakeup'))).toBe(false);
    console.error.mockRestore();
  });

  describe('readiness: the view summary and the route checks', () => {
    const ESTATE = 'estate-implementation-assurance';
    beforeEach(() => {
      repo.findMatterMakeup.mockResolvedValue({
        matter_uuid: MATTER.uuid, matter_code: MATTER.code, matter_created_by: OWNER, version_id: 'v-special-2',
        version: 2, definition: { ...special, agents: [{ template_slug: ESTATE }, { template_slug: 'not-set-up' }] },
        makeup_key: 'special', makeup_name: 'Special', makeup_description: null, latest_version: 3,
      });
      agents.findBySlug.mockImplementation(async ({ slug }) => (slug === ESTATE ? { id: DEFINITION_ID, name: 'Estate implementation assurance' } : null));
      // Needs, in declaration order: assets, contacts, documents; client instructions.
      readinessCounts.countMatterEntities.mockResolvedValue([2, 0, 3]);
      readinessCounts.countMatterFacts.mockResolvedValue(new Map([['client_instruction', { total: 0, supported: 0 }]]));
      // The viewer may read assurance; no deployment jurisdiction is set, so the rulebook check is unknown.
      permissions.hasPermission.mockImplementation(async (_user, permission) => permission === 'estate-assurance:read');
    });

    test('the view summary words the collapsed line; an unavailable agent has none', async () => {
      const view = await call('getMatterMakeup');
      const estate = view.runnables.find((r) => r.key === ESTATE);
      expect(estate.readiness).toEqual({ status: 'incomplete', total: 6, ready: 3, missing: 2, unknown: 1 });
      expect(estate).not.toHaveProperty('needs');
      const [estateView, offView] = Runnables.runnableViews(view);
      expect(estateView).toMatchObject({ hasReadiness: true, readiness: { status: 'incomplete', label: '3 of 6 ready', tone: 'yellow', total: 6, ready: 3, missing: 2, unknown: 1 } });
      expect(offView).toMatchObject({ available: false, hasReadiness: false, readiness: null });
    });

    test('the route answer drives the checklist: labels, counts, fixes, unknown last', async () => {
      const view = await call('getMatterMakeup');
      const [estateView] = Runnables.runnableViews(view);
      const request = MatterMakeupAPIClient.requests.readiness('MATT-1', estateView.ref);
      const url = new URL(request.path, 'http://localhost');
      expect(url.pathname).toBe('/api/v1/matters/MATT-1/makeup/readiness');
      const query = models.getRunnableReadinessSchema.query.parse(Object.fromEntries(url.searchParams));
      const answer = await call('getRunnableReadiness', { query });
      expect(answer).toMatchObject({ runnable: { kind: 'agent', key: ESTATE }, status: 'incomplete', total: 6, ready: 3, missing: 2, unknown: 1 });

      const model = Runnables.readinessModel(answer, Registry.buildTabs(view.tabs));
      expect(model).toMatchObject({ status: 'incomplete', readyCount: 3, total: 6, progressLabel: '3 of 6 ready', progress: 50 });
      expect(model.checks.map((c) => [c.code, c.status, c.counts])).toEqual([
        ['entities.contact', 'missing', '0 of 1'],
        ['facts.client_instruction', 'missing', '0 of 1'],
        ['apps.agents', 'ready', '1'],
        ['entities.matter_asset', 'ready', '2'],
        ['entities.document', 'ready', '3'],
        ['rulebook.estate', 'unknown', ''],
      ]);
      // The server's labels are shown as given.
      expect(model.checks.map((c) => c.text)).toEqual(answer.checks
        .slice().sort((a, b) => ['missing', 'ready', 'unknown'].indexOf(a.status) - ['missing', 'ready', 'unknown'].indexOf(b.status))
        .map((c) => c.label));
      // The notes fix resolves to the makeup's notes tab; a check with no fix offers none.
      expect(model.checks[1].fixes).toEqual([{ type: 'tab', tab: 'notes', label: 'Add in Notes', title: 'Opens Notes', iconOnly: false }]);
      expect(model.checks[0].fixes).toEqual([]);
      expect(model.checks[5].fixes).toEqual([]);
      // The rulebook check says why it was not checked; checks that were read carry no reason.
      expect(model.checks[5].reason).toMatch(/deployment jurisdiction/);
      expect(model.checks[5].reason).toBe(answer.checks.find((c) => c.code === 'rulebook.estate').reason);
      expect(model.checks.slice(0, 5).map((c) => c.reason)).toEqual(['', '', '', '', '']);
    });

    test('control: without estate-assurance:read the rulebook check is unknown with no reason', async () => {
      permissions.hasPermission.mockResolvedValue(false);
      const answer = await call('getRunnableReadiness', { query: models.getRunnableReadinessSchema.query.parse({ runnable: 'agent:' + ESTATE }) });
      const rulebook = Runnables.readinessModel(answer, []).checks.find((c) => c.code === 'rulebook.estate');
      expect(rulebook).toMatchObject({ status: 'unknown', reason: '' });
      expect(assurance.adoptedRulebookModules).not.toHaveBeenCalled();
    });

    test('an unavailable agent answers unknown with its reason; a runnable outside the makeup is a 404', async () => {
      const off = await call('getRunnableReadiness', { query: models.getRunnableReadinessSchema.query.parse({ runnable: 'agent:not-set-up' }) });
      expect(off).toMatchObject({ status: 'unknown', total: 0, checks: [] });
      expect(Runnables.readinessModel(off, [])).toMatchObject({ status: 'unknown', label: 'Not checked', checks: [], reason: off.reason });
      expect(off.reason).toMatch(/\S/);
      jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(call('getRunnableReadiness', { query: { runnable: { kind: 'agent', key: 'elsewhere' } } })).rejects.toMatchObject({ status: 404 });
      console.error.mockRestore();
      // Control arm: the client's ref for a skill parses as well; a bad one does not.
      expect(models.getRunnableReadinessSchema.query.safeParse({ runnable: 'skill:nightly-review' }).success).toBe(true);
      expect(models.getRunnableReadinessSchema.query.safeParse({ runnable: 'workflow:x' }).success).toBe(false);
    });
  });

  test('a matter with no LANA record answers 404, which is the standard-tabs fallback; 503 MAKEUPS_NOT_SEEDED is not', async () => {
    const noRecord = await (async () => {
      const req = { user: { id: OWNER, organizationId: ORG, roleId: 'r1' }, matter: { uuid: null, code: 'PROV-1' }, params: {}, query: {}, headers: {} };
      let failure = null;
      await controller.getMatterMakeup(req, { json: () => {} }, (error) => { failure = error; });
      return answerOf(handler, failure);
    })();
    expect(noRecord.status).toBe(404);
    const client = (error) => new MatterMakeupAPIClient({ get: jest.fn(async () => { throw error; }) });
    await expect(client(noRecord).getMakeup('PROV-1')).resolves.toBeNull();

    repo.findMatterMakeup.mockResolvedValueOnce({ matter_uuid: MATTER.uuid, matter_code: MATTER.code, version_id: null });
    repo.findAssignableVersion.mockResolvedValueOnce(null);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const unseeded = await call('getMatterMakeup').catch((error) => error);
    console.error.mockRestore();
    expect(unseeded).toMatchObject({ status: 503, code: 'MAKEUPS_NOT_SEEDED' });
    await expect(client(unseeded).getMakeup('MATT-1')).rejects.toBe(unseeded);
  });
});

if (!checkout.dir) {
  test.skip('backend not found (see the warning above)', () => {});
}

'use strict';

const R = require('../../src/js/shared/matter-runnables.js');

const makeup = {
  makeup: { key: 'standard', version: 1 },
  tabs: [],
  runnables: [
    { kind: 'agent', key: 'matter-review', name: 'Matter review', available: true, can_start: true, definition_id: 'd1', readiness: { status: 'incomplete', total: 6, ready: 3, missing: 2, unknown: 1 } },
    { kind: 'agent', key: 'closeout-check', available: false, reason: 'The agents app is not installed.' },
    { kind: 'skill', key: 'nightly-sweep-v1', name: 'Nightly sweep', enabled: false, available: true, automation_id: 'auto-1' },
    { kind: 'skill', key: 'no-id-skill', name: 'No id', enabled: true, available: true },
    { kind: 'workflow', key: 'ignored' },
    null,
  ],
};

describe('runnable views', () => {
  test('agents and skills only, with availability, readiness and controls', () => {
    const views = R.runnableViews(makeup);
    expect(views.map((v) => v.ref)).toEqual(['agent:matter-review', 'agent:closeout-check', 'skill:nightly-sweep-v1', 'skill:no-id-skill']);
    expect(views[0]).toMatchObject({
      name: 'Matter review', available: true, startable: true, definitionId: 'd1', hasReadiness: true,
      readiness: { status: 'incomplete', label: '3 of 6 ready', tone: 'yellow', total: 6, ready: 3, missing: 2, unknown: 1 },
    });
    expect(views[1]).toMatchObject({ name: 'Closeout check', available: false, startable: false, unavailableText: 'The agents app is not installed.' });
    expect(views[2]).toMatchObject({ kind: 'skill', enabled: false, toggleable: true, automationId: 'auto-1', readiness: null, startable: false });
    expect(views[3]).toMatchObject({ enabled: true, toggleable: false });
  });

  test('groups: agents then skills, with what cannot run set apart', () => {
    const groups = R.runnableGroups(R.runnableViews(makeup));
    expect(groups.map((g) => [g.kind, g.title, g.count])).toEqual([['agent', 'Agents', 2], ['skill', 'Skills', 2]]);
    expect(groups[0].views.map((v) => v.key)).toEqual(['matter-review']);
    expect(groups[0].unavailable.map((v) => v.key)).toEqual(['closeout-check']);
    expect(groups[1].unavailable).toEqual([]);
    expect(R.runnableGroups(R.runnableViews({ runnables: [{ kind: 'skill', key: 's' }] })).map((g) => g.kind)).toEqual(['skill']);
    expect(R.runnableGroups([])).toEqual([]);
  });

  test('missing information does not stop an agent from being startable', () => {
    const [view] = R.runnableViews({ runnables: [{ kind: 'agent', key: 'a', can_start: true, readiness: { status: 'incomplete', missing: 5 } }] });
    expect(view.startable).toBe(true);
  });

  test('an agent is startable only when the server offers the start (can_start)', () => {
    const views = R.runnableViews({ runnables: [
      { kind: 'agent', key: 'a', available: true, can_start: false },
      { kind: 'agent', key: 'b', available: true },
      { kind: 'agent', key: 'c', available: true, can_start: true }
    ] });
    expect(views.map((view) => [view.key, view.available, view.startable])).toEqual([['a', true, false], ['b', true, false], ['c', true, true]]);
  });

  test('an agent whose run goes is shown running, not startable (control: offered, or refused for permission, is not running)', () => {
    const views = R.runnableViews({ runnables: [
      { kind: 'agent', key: 'a', available: true, can_start: false, start_blocked_reason: 'active_run', active_run: { id: 'r9', status: 'running', state: 'active' } },
      { kind: 'agent', key: 'b', available: true, can_start: false, start_blocked_reason: 'active_run', active_run: { id: 'r8', status: 'queued', state: 'active' } },
      { kind: 'agent', key: 'c', available: true, can_start: true, start_blocked_reason: null, active_run: null },
      { kind: 'agent', key: 'd', available: true, can_start: false, start_blocked_reason: 'permission', active_run: null },
    ] });
    expect(views[0]).toMatchObject({ startable: false, running: { label: 'Running now', tone: 'blue', activeRunId: 'r9', running: true, toast: false } });
    expect(views[0].running.text).toContain('already running on this matter');
    expect(views[1].running).toMatchObject({ label: 'Queued', activeRunId: 'r8' });
    expect(views.slice(2).map((view) => [view.key, view.startable, view.running])).toEqual([['c', true, null], ['d', false, null]]);
    expect(R.activeRunView(null)).toBeNull();
  });

  test('an unavailable skill cannot be toggled even with an id', () => {
    const [view] = R.runnableViews({ runnables: [{ kind: 'skill', key: 's', available: false, automation_id: 'x' }] });
    expect(view.toggleable).toBe(false);
    expect(view.unavailableText).toBe('Not available for this organization.');
  });

  test('no makeup means no runnables; names map keys for run history', () => {
    expect(R.runnableViews(null)).toEqual([]);
    expect(R.runnableNames(makeup)).toMatchObject({ 'matter-review': 'Matter review', 'nightly-sweep-v1': 'Nightly sweep' });
  });

  test('readiness summary wording from { status, total, ready, missing, unknown }', () => {
    expect(R.readinessSummary({ status: 'ready', total: 3, ready: 3, missing: 0, unknown: 0 }))
      .toEqual({ status: 'ready', label: '3 of 3 ready', tone: 'green', total: 3, ready: 3, missing: 0, unknown: 0 });
    expect(R.readinessSummary({ status: 'incomplete', total: 6, ready: 3, missing: 2, unknown: 1 })).toMatchObject({ label: '3 of 6 ready', tone: 'yellow' });
    // The ready count is the server's, never total minus missing.
    expect(R.readinessSummary({ status: 'unknown', total: 4, ready: 3, missing: 0, unknown: 1 })).toMatchObject({ label: '3 of 4 ready', tone: 'gray' });
    expect(R.readinessSummary({ status: 'unknown', total: 0, ready: 0, missing: 0, unknown: 0 })).toMatchObject({ label: 'Not checked', tone: 'gray' });
    expect(R.readinessSummary({ status: 'incomplete', total: 2 })).toMatchObject({ label: '0 of 2 ready', ready: 0, missing: 0, unknown: 0 });
    expect(R.readinessSummary(null)).toBeNull();
  });

  test('a readiness line shows only when there is something to check (total above 0)', () => {
    const views = R.runnableViews({ runnables: [
      { kind: 'agent', key: 'a', readiness: { status: 'ready', total: 0, ready: 0, missing: 0, unknown: 0 } },
      { kind: 'agent', key: 'b', readiness: { status: 'unknown', total: 0, ready: 0, missing: 0, unknown: 0 } },
      { kind: 'agent', key: 'c', readiness: { status: 'ready', total: 2, ready: 2, missing: 0, unknown: 0 } },
      { kind: 'agent', key: 'd', readiness: null },
    ] });
    expect(views.map((v) => v.hasReadiness)).toEqual([false, false, true, false]);
  });
});

describe('readiness model', () => {
  const tabs = [
    { key: 'notes', id: 'notes', label: 'Notes' },
    { key: 'assets', id: 'assets', label: 'Assets' },
    { key: 'gone', id: 'gone', label: 'Gone', hidden: true },
    { key: 'off', id: 'off', label: 'Off', available: false, reason: 'Turned off.' },
  ];
  // GET /makeup/readiness as the readiness service answers it (bare body).
  const result = {
    runnable: { kind: 'agent', key: 'matter-review' },
    status: 'incomplete',
    total: 5,
    ready: 1,
    missing: 3,
    unknown: 1,
    checks: [
      { code: 'entities.matter_asset', label: 'Assets', status: 'missing', need: 1, found: 0, fix: { tab: 'assets', form: 'records.create_asset' } },
      { code: 'facts.client_instruction', label: 'Notes labeled Client instruction', status: 'ready', need: 1, found: 2 },
      { code: 'records.plan.accepted', label: 'Accepted plan', status: 'missing', need: 1, found: 0, fix: { tab: 'gone', form: 'records.accept_plan' } },
      { code: 'rulebook.estate', label: 'Adopted estate rulebook', status: 'unknown', need: 1, found: null, reason: 'No deployment jurisdiction is set up, so which rulebook applies could not be checked.' },
      { code: 'entities.document', label: 'Documents', status: 'missing', need: 1, found: 0, fix: { tab: 'off' } },
    ],
  };

  test('checks carry text, status, icon, short counts and fixes; summary counts what is ready', () => {
    const model = R.readinessModel(result, tabs);
    expect(model).toMatchObject({ status: 'incomplete', label: '1 of 5 ready', tone: 'yellow', readyCount: 1, total: 5, progressLabel: '1 of 5 ready', progress: 20, reason: '' });
    expect(model.note).toContain('still start');
    expect(model.checks[0]).toEqual({
      code: 'entities.matter_asset', text: 'Assets', status: 'missing', statusLabel: 'Missing', tone: 'yellow', icon: 'alert-circle',
      counts: '0 of 1',
      reason: '',
      fixes: [
        { type: 'form', form: 'records.create_asset', subject: null, label: 'Add it now' },
        { type: 'tab', tab: 'assets', label: 'Open Assets', title: 'Opens Assets', iconOnly: true },
      ],
    });
  });

  test('missing first, then ready, then not checked, each in server order', () => {
    expect(R.readinessModel(result, tabs).checks.map((c) => [c.code, c.status])).toEqual([
      ['entities.matter_asset', 'missing'], ['records.plan.accepted', 'missing'], ['entities.document', 'missing'],
      ['facts.client_instruction', 'ready'], ['rulebook.estate', 'unknown'],
    ]);
  });

  test('a ready check offers no fix and shows how many; a hidden or unavailable tab is not offered', () => {
    const [, plan, documents, ready] = R.readinessModel(result, tabs).checks;
    expect(ready).toMatchObject({ text: 'Notes labeled Client instruction', counts: '2', fixes: [], icon: 'check-circle-2' });
    expect(plan).toMatchObject({ text: 'Accepted plan', counts: '0 of 1' });
    expect(plan.fixes).toEqual([{ type: 'form', form: 'records.accept_plan', subject: null, label: 'Add it now' }]);
    expect(documents.fixes).toEqual([]);
  });

  test('a check without a server label falls back to its code', () => {
    expect(R.readinessModel({ checks: [{ code: 'entities.matter_asset', status: 'missing', need: 1, found: 0 }] }, tabs).checks[0].text)
      .toBe('Records: Matter asset');
  });

  test('a fix that only names a tab carries its words: the server label, or Add in <tab>', () => {
    const model = R.readinessModel({ checks: [
      { code: 'a', status: 'missing', fix: { tab: 'notes' } },
      { code: 'b', status: 'missing', fix: { tab: 'notes', label: 'Add a contact' } },
    ] }, tabs);
    expect(model.checks[0].fixes).toEqual([{ type: 'tab', tab: 'notes', label: 'Add in Notes', title: 'Opens Notes', iconOnly: false }]);
    expect(model.checks[1].fixes[0]).toMatchObject({ label: 'Add a contact', iconOnly: false });
  });

  test('an unknown check reads as not checked, with no count and its reason; an unexpected status is unknown too', () => {
    const check = R.readinessModel(result, tabs).checks[4];
    expect(check).toMatchObject({
      text: 'Adopted estate rulebook', status: 'unknown', statusLabel: 'Not checked', tone: 'gray', icon: 'circle', counts: '',
      reason: 'No deployment jurisdiction is set up, so which rulebook applies could not be checked.',
    });
    expect(R.readinessModel({ checks: [{ code: 'apps', status: 'surprise' }] }, tabs).checks[0]).toMatchObject({ text: 'Apps', status: 'unknown' });
  });

  test('all ready, an unavailable runnable with its reason, and an empty answer', () => {
    expect(R.readinessModel({ status: 'ready', total: 1, missing: 0, checks: [{ code: 'apps.agents', label: 'Agents app', status: 'ready', need: 1, found: 1 }] }, tabs))
      .toMatchObject({ status: 'ready', label: '1 of 1 ready', note: '' });
    expect(R.readinessModel({ status: 'unknown', total: 0, missing: 0, checks: [], reason: 'This agent is not installed here.' }, tabs))
      .toMatchObject({ status: 'unknown', label: 'Not checked', checks: [], reason: 'This agent is not installed here.' });
    // Unknown checks with no status from the server: not checked, not ready.
    expect(R.readinessModel({ checks: [{ code: 'rulebook.estate', status: 'unknown' }] }, tabs)).toMatchObject({ status: 'unknown', label: '0 of 1 ready' });
    expect(R.readinessModel(null, tabs)).toMatchObject({ status: 'ready', checks: [], total: 0, progressLabel: '', progress: 0 });
  });
});

describe('start and toggle messages', () => {
  test('start answers: started, queued, combined, and a recorded refusal', () => {
    // A started run is the agent's run going: Start turns off with it.
    expect(R.startResultView({ outcome: 'started', run: { id: 'r1', status: 'queued' } }, 'Matter review')).toEqual({
      kind: 'success', label: 'Queued', tone: 'blue', text: 'Matter review started', toast: true, activeRunId: 'r1', running: true,
    });
    expect(R.startResultView({ outcome: 'started', run: { id: 'r1', status: 'running' } }, 'X')).toMatchObject({ label: 'Running now', running: true });
    expect(R.startResultView({ outcome: 'queued', run: null }, 'X')).toMatchObject({ kind: 'info', label: 'Queued', tone: 'blue', toast: true });
    expect(R.startResultView({ outcome: 'deferred', run: null, active_run_id: 'r0' }, 'X')).toMatchObject({ kind: 'info', activeRunId: 'r0' });
    expect(R.startResultView({ outcome: 'coalesced', run: null }, 'X').kind).toBe('info');
  });

  test('start errors', () => {
    expect(R.startErrorView({ status: 403 }).text).toContain('permission');
    expect(R.startErrorView({ status: 404 }).text).toContain('not installed');
    expect(R.startErrorView({ status: 409, code: 'skipped_cap', data: { error: { code: 'skipped_cap' }, outcome: 'skipped_cap' } })).toMatchObject({ kind: 'warning', label: 'Skipped' });
    expect(R.startErrorView({ status: 409, code: 'skipped_cap' }).text).toContain('daily limit');
    // Already running is shown once, on the card, with a link to that run: no toast.
    expect(R.startErrorView({ status: 409, code: 'ACTIVE_RUN_EXISTS', data: { error: { code: 'ACTIVE_RUN_EXISTS', active_run_id: 'r7' } } })).toEqual({
      kind: 'info', label: 'Running now', tone: 'blue', toast: false, activeRunId: 'r7', running: true,
      text: 'This agent is already running on this matter. Start it again once that run finishes.',
    });
    expect(R.startErrorView({ status: 403 })).toMatchObject({ kind: 'error', label: 'Not started', tone: 'red', toast: true });
    expect(R.startErrorView({ status: 409, code: 'SKIPPED_CAP' }).text).toContain('could not start');
    expect(R.startErrorView({ status: 400, message: 'input must be a plain object' }).text).toBe('input must be a plain object');
    expect(R.startErrorView({ status: 400, message: 'Validation failed' }).text).toContain('could not start');
    expect(R.startErrorView(new TypeError('Failed to fetch')).text).toContain('could not start');
  });

  test('toggle errors', () => {
    expect(R.toggleErrorMessage({ status: 403 })).toContain('permission');
    expect(R.toggleErrorMessage({ status: 404 })).toContain('not installed');
    expect(R.toggleErrorMessage({ status: 500 })).toContain('Try again');
  });
});

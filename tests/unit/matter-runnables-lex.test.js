/**
 * The "Agents and skills" drawer, run history, "Why did this run?" and the
 * makeup switch dialog on the real Lex components in jsdom.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (window, ms = 40) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const SCRIPTS = [
  'time-utils.js', 'lex/lex.core.js', 'lex/lex.icons.js', 'lex/lex.data.js', 'lex/lex.forms.js', 'lex/lex.utils.js',
  'lex/components/foundation/lex-btn.js', 'lex/components/foundation/lex-modal.js', 'lex/components/foundation/lex-drawer.js',
  'lex/components/foundation/lex-tabs.js', 'lex/components/foundation/lex-empty.js', 'lex/components/foundation/lex-spinner.js',
  'lex/components/foundation/lex-badge.js', 'lex/components/foundation/lex-progress-bar.js', 'lex/components/form/lex-select.js', 'lex/components/form/lex-textarea.js',
  'lex/components/form/lex-toggle.js',
  'shared/run-history.js', 'shared/matter-runnables.js', 'shared/pending-submit.js', 'shared/makeup-switch.js',
  'shared/matter-runnables-panel.js', 'shared/makeup-switch-dialog.js',
];

const windows = [];
afterEach(() => { windows.splice(0).forEach((window) => window.close()); });

function boot() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  window.console.log = () => {};
  window.console.warn = () => {};
  SCRIPTS.forEach((rel) => window.eval(read(rel)));
  windows.push(window);
  return window;
}

const MAKEUP = {
  makeup: { key: 'standard', name: 'Standard', version: 1, latest_version: 2 },
  tabs: [{ id: 'notes', kind: 'notes' }],
  runnables: [
    { kind: 'agent', key: 'matter-review', name: 'Matter review', available: true, can_start: true, definition_id: 'd1', readiness: { status: 'incomplete', total: 2, ready: 0, missing: 1, unknown: 1 } },
    { kind: 'agent', key: 'off-agent', name: 'Off agent', available: false, reason: 'Not installed.' },
    { kind: 'skill', key: 'nightly-sweep-v1', name: 'Nightly sweep', available: true, enabled: false, automation_id: 'auto-1' },
  ],
};

// Rows as GET /activity/runs answers them: a refused start has run null.
const REFUSED = {
  id: 'c1', run_kind: 'agent_run', run: null, runnable_key: 'matter-review', outcome: 'skipped_self_cause', origin: 'event',
  origin_event: { type: 'note.created', id: 'ev-1' }, actor: { kind: 'system', user_id: null }, depth: 1, trace_id: 't-1',
  chain: [{ kind: 'automation_execution', id: 'e1', runnable_key: 'nightly-sweep-v1' }],
};
const STARTED = {
  id: 'c2', run_kind: 'automation_execution', run: { kind: 'automation_execution', id: 'e1', status: null, state: null, finished_at: null, execution_trace_id: null },
  runnable_key: 'nightly-sweep-v1', outcome: 'started',
  origin: 'schedule', origin_event: null, actor: { kind: 'system', user_id: null }, depth: 0, trace_id: 't-2', chain: [],
};

function client(overrides = {}) {
  return {
    // GET /makeup/readiness (bare body); unknown arrives first and is shown last.
    getReadiness: jest.fn(async () => ({
      runnable: { kind: 'agent', key: 'matter-review' }, status: 'incomplete', total: 2, ready: 0, missing: 1, unknown: 1,
      checks: [
        { code: 'rulebook.estate', label: 'Adopted estate rulebook', status: 'unknown', need: 1, found: null, reason: 'No deployment jurisdiction is set up, so which rulebook applies could not be checked.' },
        { code: 'facts.client_instruction', label: 'Notes labeled Client instruction', status: 'missing', need: 1, found: 0, fix: { tab: 'notes', form: 'notes.add' } },
      ],
    })),
    startAgent: jest.fn(async () => ({ outcome: 'deferred' })),
    setSkillEnabled: jest.fn(async () => ({})),
    getRuns: jest.fn(async (matterId, cursor) => ({ status: 'success', data: cursor
      ? { runs: [{ id: 'c3', run_kind: 'agent_run', run: { kind: 'agent_run', id: 'r3' }, outcome: 'started', origin: 'task', actor: { kind: 'user', user_id: 'u1' } }], next_cursor: null }
      : { runs: [REFUSED, STARTED], next_cursor: 'n2' } })),
    getCausation: jest.fn(async () => ({ status: 'success', data: { causation: STARTED, root: [STARTED, REFUSED] } })),
    listMakeups: jest.fn(async () => ({ makeups: [{ key: 'standard', name: 'Standard', latest_version: 2 }, { key: 'probate', name: 'Probate', latest_version: 1 }] })),
    switchMakeup: jest.fn(async () => ({ outcome: 'switched', assignment: { id: 'as-1' }, effects: { status: 'complete', skills_disabled: 0, starter_tasks_created: 0 }, ...MAKEUP })),
    ...overrides,
  };
}

function deps(window, c, extra = {}) {
  const notes = [];
  return {
    notes,
    deps: {
      client: c, matterId: 'M-1', matterRef: 'uuid-1', makeup: MAKEUP,
      tabs: [{ key: 'notes', id: 'notes', label: 'Notes' }],
      goToTab: jest.fn(), openForm: jest.fn(), onChanged: jest.fn(),
      notify: (kind, text) => notes.push([kind, text]),
      ...extra,
    },
  };
}

describe('Agents and skills drawer', () => {
  test('an agent the server offers no start shows no Start (control: the offered one does)', async () => {
    const window = boot();
    const makeup = { ...MAKEUP, runnables: [MAKEUP.runnables[0], { ...MAKEUP.runnables[0], key: 'no-start', name: 'No start', can_start: false }] };
    const { deps: d } = deps(window, client(), { makeup });
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    expect(drawer.querySelector('[data-runnable="agent:no-start"]')).not.toBeNull();
    expect(drawer.querySelector('[data-runnable="agent:no-start"] [data-runnable-start]')).toBeNull();
    expect(drawer.querySelector('[data-runnable="agent:matter-review"] [data-runnable-start]')).not.toBeNull();
  });

  test('lists agents and skills with availability and readiness; Start uses matter scope', async () => {
    const window = boot();
    const c = client();
    const { deps: d, notes } = deps(window, c);
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    expect(drawer.tagName).toBe('LEX-DRAWER');
    const items = [...drawer.querySelectorAll('[data-runnable]')].map((el) => el.getAttribute('data-runnable'));
    expect(items).toEqual(['agent:matter-review', 'agent:off-agent', 'skill:nightly-sweep-v1']);
    // Agents and skills sit in their own sections, headed with how many can run.
    const groups = [...drawer.querySelectorAll('[data-runnables-group]')];
    expect(groups.map((g) => g.getAttribute('data-runnables-group'))).toEqual(['agent', 'skill']);
    expect(groups.map((g) => g.querySelector('.matter-runnables__group-head').textContent)).toEqual(['Agents1', 'Skills1']);
    const review = drawer.querySelector('[data-runnable="agent:matter-review"]');
    // No per-card kind or readiness badge: readiness is the summary line.
    expect(review.querySelectorAll('lex-badge')).toHaveLength(0);
    expect(review.querySelector('[data-readiness-toggle]').textContent.trim()).toBe('0 of 2 ready');
    // What cannot run: collapsed under the agents, its reason shown on open, no button.
    const off = drawer.querySelector('[data-runnable="agent:off-agent"]');
    expect(off.querySelector('[data-runnable-start]')).toBeNull();
    expect(off.querySelector('lex-btn')).toBeNull();
    const offList = off.closest('.matter-runnables__unavailable-list');
    expect(offList.hidden).toBe(true);
    const offToggle = drawer.querySelector('[data-unavailable-toggle]');
    expect(offToggle.textContent.trim()).toBe('Not available (1)');
    click(window, offToggle);
    expect(offList.hidden).toBe(false);
    expect(offToggle.getAttribute('aria-expanded')).toBe('true');
    expect(off.textContent).toContain('Not installed.');

    click(window, review.querySelector('[data-runnable-start]'));
    await tick(window);
    expect(c.startAgent).toHaveBeenCalledWith('matter-review', 'uuid-1', { title: 'Matter review', definitionId: 'd1' });
    expect(notes.pop()[0]).toBe('info');
    expect(review.querySelector('[data-start-status] lex-badge').getAttribute('label')).toBe('Follow-up queued');
    expect(review.querySelectorAll('lex-badge')).toHaveLength(1);
  });

  test('Start shows Queued for a debounced start, and Already running with the running run for ACTIVE_RUN_EXISTS', async () => {
    const window = boot();
    const active = Object.assign(new Error('busy'), { status: 409, code: 'ACTIVE_RUN_EXISTS', data: { error: { code: 'ACTIVE_RUN_EXISTS', message: 'busy', active_run_id: 'r9' } } });
    const c = client({ startAgent: jest.fn().mockResolvedValueOnce({ outcome: 'queued', run: null }).mockRejectedValueOnce(active) });
    const { deps: d, notes } = deps(window, c);
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    const review = drawer.querySelector('[data-runnable="agent:matter-review"]');
    const status = review.querySelector('[data-start-status]');
    expect(status.hidden).toBe(true);
    click(window, review.querySelector('[data-runnable-start]'));
    await tick(window);
    expect(status.hidden).toBe(false);
    expect(status.querySelector('lex-badge').getAttribute('label')).toBe('Queued');
    expect(status.querySelector('[data-active-run]')).toBeNull();

    expect(notes).toHaveLength(1);
    click(window, review.querySelector('[data-runnable-start]'));
    await tick(window);
    // Said once, on the card: Running now and a link to that run, no toast.
    expect(status.querySelector('lex-badge').getAttribute('label')).toBe('Running now');
    expect(status.getAttribute('title')).toContain('already running on this matter');
    expect(review.querySelectorAll('lex-badge')).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect(status.querySelector('[data-active-run="r9"]').textContent.trim()).toBe('View run');
    click(window, status.querySelector('[data-active-run="r9"]'));
    await tick(window);
    expect(c.getCausation).toHaveBeenCalledWith('agent_run', 'r9');
  });

  // The makeup view with the review agent's run going (the server's start offer).
  const runningMakeup = (status = 'running') => ({ ...MAKEUP, runnables: [
    { ...MAKEUP.runnables[0], can_start: false, start_blocked_reason: 'active_run', active_run: { id: 'r9', status, state: 'active' } },
    ...MAKEUP.runnables.slice(1),
  ] });

  test('an agent whose run goes shows Start turned off with the reason and that run (control: offered, Start is on)', async () => {
    const window = boot();
    const { deps: d } = deps(window, client(), { makeup: runningMakeup('queued') });
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    const review = drawer.querySelector('[data-runnable="agent:matter-review"]');
    const start = review.querySelector('[data-runnable-start]');
    expect(start.disabled).toBe(true);
    expect(start.getAttribute('title')).toContain('already running on this matter');
    expect(review.querySelector('[data-start-status] lex-badge').getAttribute('label')).toBe('Queued');
    expect(review.querySelector('[data-active-run="r9"]')).not.toBeNull();
    click(window, start);
    await tick(window);
    expect(d.client.startAgent).not.toHaveBeenCalled();

    const offered = window.LanaMatterRunnablesPanel.open(deps(window, client()).deps);
    await tick(window);
    expect(offered.querySelector('[data-runnable-start="matter-review"]').disabled).toBeFalsy();
    expect(offered.querySelector('[data-start-status="matter-review"]').hidden).toBe(true);
  });

  test('after a 202 the card shows the run going and Start off; the drawer reads the view again, and Start is back once the server says the run ended', async () => {
    const window = boot();
    const getMakeup = jest.fn()
      .mockResolvedValueOnce(MAKEUP)
      .mockResolvedValueOnce(runningMakeup('running'))
      .mockResolvedValueOnce(MAKEUP);
    const c = client({ getMakeup, startAgent: jest.fn().mockResolvedValue({ outcome: 'started', run: { id: 'r9', status: 'queued' } }) });
    const onMakeup = jest.fn();
    const { deps: d, notes } = deps(window, c, { onMakeup });
    let drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    expect(getMakeup).toHaveBeenCalledWith('M-1');
    let review = drawer.querySelector('[data-runnable="agent:matter-review"]');
    const start = review.querySelector('[data-runnable-start]');
    expect(start.disabled).toBeFalsy();
    click(window, start);
    await tick(window);
    expect(notes).toEqual([['success', 'Matter review started']]);
    // The refreshed view names the run going: Start stays off, the card says so.
    expect(getMakeup).toHaveBeenCalledTimes(2);
    expect(onMakeup).toHaveBeenLastCalledWith(runningMakeup('running'));
    expect(start.disabled).toBe(true);
    expect(review.querySelector('[data-start-status] lex-badge').getAttribute('label')).toBe('Running now');
    expect(review.querySelector('[data-active-run="r9"]')).not.toBeNull();
    click(window, start);
    await tick(window);
    expect(c.startAgent).toHaveBeenCalledTimes(1);

    // Opened again: the server says the run ended, so Start is back.
    drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    review = drawer.querySelector('[data-runnable="agent:matter-review"]');
    expect(review.querySelector('[data-runnable-start]').disabled).toBeFalsy();
    expect(review.querySelector('[data-start-status]').hidden).toBe(true);
  });

  test('a 409 ACTIVE_RUN_EXISTS turns Start off, and the refreshed view keeps it so; the server view saying nothing runs turns it on (control)', async () => {
    const window = boot();
    const active = Object.assign(new Error('busy'), { status: 409, code: 'ACTIVE_RUN_EXISTS', data: { error: { code: 'ACTIVE_RUN_EXISTS', active_run_id: 'r9' } } });
    const getMakeup = jest.fn().mockResolvedValueOnce(MAKEUP).mockResolvedValueOnce(runningMakeup()).mockResolvedValueOnce(MAKEUP).mockResolvedValueOnce(MAKEUP);
    const c = client({ getMakeup, startAgent: jest.fn().mockRejectedValue(active) });
    const { deps: d } = deps(window, c);
    let drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    let start = drawer.querySelector('[data-runnable-start="matter-review"]');
    click(window, start);
    await tick(window);
    expect(getMakeup).toHaveBeenCalledTimes(2);
    expect(start.disabled).toBe(true);
    expect(drawer.querySelector('[data-start-status="matter-review"] lex-badge').getAttribute('label')).toBe('Running now');

    // Control: the run ended before the view was read again.
    drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    start = drawer.querySelector('[data-runnable-start="matter-review"]');
    click(window, start);
    await tick(window);
    expect(getMakeup).toHaveBeenCalledTimes(4);
    expect(start.disabled).toBeFalsy();
    expect(drawer.querySelector('[data-start-status="matter-review"]').hidden).toBe(true);
  });

  test('a run going that the viewer may not read (no id) turns Start off without View run (control: with its id, View run shows)', async () => {
    const window = boot();
    const hidden = { ...MAKEUP, runnables: [
      { ...MAKEUP.runnables[0], can_start: false, start_blocked_reason: 'active_run', active_run: { status: 'running', state: 'active' } },
      ...MAKEUP.runnables.slice(1),
    ] };
    const drawer = window.LanaMatterRunnablesPanel.open(deps(window, client(), { makeup: hidden }).deps);
    await tick(window);
    const review = drawer.querySelector('[data-runnable="agent:matter-review"]');
    expect(review.querySelector('[data-runnable-start]').disabled).toBe(true);
    expect(review.querySelector('[data-start-status] lex-badge').getAttribute('label')).toBe('Running now');
    expect(review.querySelector('[data-active-run]')).toBeNull();

    const named = window.LanaMatterRunnablesPanel.open(deps(window, client(), { makeup: runningMakeup() }).deps);
    await tick(window);
    expect(named.querySelector('[data-runnable="agent:matter-review"] [data-active-run="r9"]')).not.toBeNull();
  });

  test('a stale open-time read answering after a 202 does not turn Start back on (control: with no press, the open-time read applies)', async () => {
    const window = boot();
    let answerOpenRead;
    const getMakeup = jest.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { answerOpenRead = resolve; }))
      .mockResolvedValueOnce(runningMakeup('queued'));
    const c = client({ getMakeup, startAgent: jest.fn().mockResolvedValue({ outcome: 'started', run: { id: 'r9', status: 'queued' } }) });
    const drawer = window.LanaMatterRunnablesPanel.open(deps(window, c).deps);
    await tick(window);
    const start = drawer.querySelector('[data-runnable-start="matter-review"]');
    click(window, start);
    await tick(window);
    expect(getMakeup).toHaveBeenCalledTimes(2);
    expect(start.disabled).toBe(true);
    answerOpenRead(MAKEUP);
    await tick(window);
    expect(start.disabled).toBe(true);
    expect(drawer.querySelector('[data-start-status="matter-review"] lex-badge').getAttribute('label')).toBe('Queued');

    // Control: the only read answers late and still applies.
    let answerOnly;
    const lone = client({ getMakeup: jest.fn(() => new Promise((resolve) => { answerOnly = resolve; })) });
    const other = window.LanaMatterRunnablesPanel.open(deps(window, lone).deps);
    await tick(window);
    expect(other.querySelector('[data-runnable-start="matter-review"]').disabled).toBeFalsy();
    answerOnly(runningMakeup());
    await tick(window);
    expect(other.querySelector('[data-runnable-start="matter-review"]').disabled).toBe(true);
  });

  test('Running now with no run id still turns Start off for this load only (control arm: other answers leave it on)', async () => {
    const window = boot();
    const c = client({ startAgent: jest.fn()
      .mockResolvedValueOnce({ outcome: 'queued', run: null })
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 409, code: 'ACTIVE_RUN_EXISTS', data: { error: { code: 'ACTIVE_RUN_EXISTS' } } })) });
    const { deps: d } = deps(window, c);
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    const start = drawer.querySelector('[data-runnable-start="matter-review"]');
    click(window, start);
    await tick(window);
    expect(start.disabled).toBeFalsy();
    click(window, start);
    await tick(window);
    expect(start.disabled).toBe(true);
    const again = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    expect(again.querySelector('[data-runnable-start="matter-review"]').disabled).toBeFalsy();
  });

  test('expanding readiness loads the checks; fix hints go to a tab or open a form', async () => {
    const window = boot();
    const c = client();
    const { deps: d } = deps(window, c);
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    const review = drawer.querySelector('[data-runnable="agent:matter-review"]');
    const more = review.querySelector('[data-readiness-toggle="matter-review"]');
    const readiness = review.querySelector('.matter-runnables__readiness');
    expect(readiness.hidden).toBe(true);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    click(window, more);
    await tick(window);
    expect(c.getReadiness).toHaveBeenCalledWith('M-1', 'agent:matter-review');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(readiness.hidden).toBe(false);
    expect(readiness.querySelector('.matter-runnables__progress-label').textContent).toBe('0 of 2 ready');
    // Missing first, the check that could not be read last (muted, no count, no fix).
    expect([...readiness.querySelectorAll('.matter-runnables__check')].map((li) => li.getAttribute('data-check')))
      .toEqual(['facts.client_instruction', 'rulebook.estate']);
    const unknown = readiness.querySelector('.matter-runnables__check--unknown');
    expect(unknown.querySelector('.matter-runnables__check-text').textContent).toBe('Adopted estate rulebook');
    // Why it was not checked, muted under its label; a check without one shows none.
    expect(unknown.querySelector('.matter-runnables__check-label .matter-runnables__check-reason').textContent).toBe('No deployment jurisdiction is set up, so which rulebook applies could not be checked.');
    expect(unknown.querySelector('.matter-runnables__check-count').textContent).toBe('');
    expect(unknown.querySelectorAll('.matter-runnables__fixes lex-btn')).toHaveLength(0);
    // One line per check: icon, label, count, fixes.
    const line = readiness.querySelector('.matter-runnables__check--missing');
    expect(line.querySelector('.matter-runnables__check-text').textContent).toBe('Notes labeled Client instruction');
    expect(line.querySelector('.matter-runnables__check-reason')).toBeNull();
    expect(line.querySelector('.matter-runnables__check-count').textContent).toBe('0 of 1');
    expect(line.querySelector('.matter-runnables__check-icon svg')).not.toBeNull();
    const fixes = [...line.querySelectorAll('.matter-runnables__fixes lex-btn')];
    expect(fixes.map((b) => b.getAttribute('data-fix'))).toEqual(['form', 'tab']);
    expect(fixes[0].textContent.trim()).toBe('Add it now');
    expect(fixes[1].getAttribute('aria-label')).toBe('Open Notes');
    click(window, fixes[0]);
    expect(d.openForm).toHaveBeenCalledWith({ form: 'notes.add', subject: null }, expect.any(Function));
    click(window, fixes[1]);
    expect(d.goToTab).toHaveBeenCalledWith('notes');

    click(window, more);
    click(window, more);
    expect(c.getReadiness).toHaveBeenCalledTimes(1);
  });

  test('the skill toggle turns the skill on; a refusal puts the toggle back', async () => {
    const window = boot();
    const c = client();
    const { deps: d, notes } = deps(window, c);
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    const toggle = drawer.querySelector('[data-runnable-toggle="nightly-sweep-v1"]');
    toggle.checked = true;
    toggle.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value: true } }));
    await tick(window);
    expect(c.setSkillEnabled).toHaveBeenCalledWith('M-1', 'auto-1', true);
    expect(d.onChanged).toHaveBeenCalled();
    expect(notes.pop()).toEqual(['success', 'Nightly sweep turned on']);

    c.setSkillEnabled.mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403 }));
    toggle.checked = false;
    toggle.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value: false } }));
    await tick(window);
    expect(toggle.checked).toBe(true);
    expect(notes.pop()[1]).toContain('permission');
  });

  test('run history lists outcomes, pages, and opens the chain root to leaf', async () => {
    const window = boot();
    const c = client();
    const { deps: d } = deps(window, c);
    const drawer = window.LanaMatterRunnablesPanel.open({ ...d, initialTab: 'history' });
    await tick(window);
    expect(c.getRuns).toHaveBeenCalledWith('M-1', undefined);
    const runs = [...drawer.querySelectorAll('.matter-runnables__run')];
    expect(runs).toHaveLength(2);
    expect(runs[0].querySelector('.matter-runnables__name').textContent).toBe('Matter review');
    // One status per row, its reason on hover; origin muted below the name.
    expect(runs[0].querySelectorAll('lex-badge')).toHaveLength(1);
    expect(runs[0].querySelector('lex-badge').getAttribute('label')).toBe('Skipped');
    expect(runs[0].querySelector('lex-badge').getAttribute('title')).toContain('its own earlier output');
    expect(runs[0].querySelector('.matter-runnables__desc').textContent).toContain('An event (note.created)');
    expect(runs[1].querySelector('.matter-runnables__name').textContent).toBe('Nightly sweep');

    click(window, drawer.querySelector('[data-runs-more]'));
    await tick(window);
    expect(c.getRuns).toHaveBeenLastCalledWith('M-1', 'n2');
    expect(drawer.querySelectorAll('.matter-runnables__run')).toHaveLength(3);
    expect(drawer.querySelector('[data-runs-more]')).toBeNull();

    // A refused start has no run: its row is the explanation, no fetch.
    expect(runs[0].querySelector('[data-run-why]').textContent.trim()).toBe('Details');
    expect(runs[0].querySelector('[data-run-why]').getAttribute('aria-label')).toBe('Why not started?');
    click(window, runs[0].querySelector('[data-run-why]'));
    await tick(window);
    expect(c.getCausation).not.toHaveBeenCalled();
    let modal = [...window.document.querySelectorAll('lex-modal')].pop();
    const steps = [...modal.querySelectorAll('.matter-runnables__step')].map((s) => s.querySelector('.matter-runnables__name').textContent);
    expect(steps).toEqual(['Nightly sweep', 'Matter review']);
    expect(modal.querySelector('.matter-runnables__step--leaf').textContent).toContain('this run');
    expect(modal.textContent).toContain('t-1');

    // A started run reads { causation, root }; root rows show as related.
    click(window, runs[1].querySelector('[data-run-why="automation_execution:e1"]'));
    await tick(window);
    expect(c.getCausation).toHaveBeenCalledWith('automation_execution', 'e1');
    modal = [...window.document.querySelectorAll('lex-modal')].pop();
    expect(modal.textContent).toContain('Also from the same first cause');
    expect(modal.textContent).toContain('t-2');
    const lists = modal.querySelectorAll('.matter-runnables__chain');
    expect(lists).toHaveLength(2);
    expect(lists[1].querySelector('.matter-runnables__name').textContent).toBe('Matter review');
  });

  test('a started run shows its state chip, finish time and, for a viewer who can open traces, a link to its trace', async () => {
    const window = boot();
    const FAILED = { ...STARTED, id: 'c4', run_kind: 'agent_run', runnable_key: 'matter-review', created_at: '2026-10-31T10:00:00Z',
      run: { kind: 'agent_run', id: 'r4', status: 'failed', state: 'failed', finished_at: '2026-10-31T10:05:00Z', execution_trace_id: 'tr-4' } };
    const c = client({
      getRuns: jest.fn(async () => ({ status: 'success', data: { runs: [FAILED, STARTED, REFUSED], next_cursor: null } })),
      getCausation: jest.fn(async () => ({ status: 'success', data: { causation: FAILED, root: [FAILED] } })),
    });
    const openTrace = jest.fn();
    const { deps: d } = deps(window, c, { openTrace });
    const drawer = window.LanaMatterRunnablesPanel.open({ ...d, initialTab: 'history' });
    await tick(window);
    const runs = [...drawer.querySelectorAll('.matter-runnables__run')];
    const chip = (run) => run.querySelector('lex-badge[data-run-status]');
    expect(chip(runs[0]).getAttribute('label')).toBe('Failed');
    expect(chip(runs[0]).getAttribute('color')).toBe('red');
    expect(chip(runs[0]).getAttribute('title')).toBe('Status: Failed.');
    expect(runs[0].querySelector('.matter-runnables__desc').textContent).toContain('finished');
    click(window, runs[0].querySelector('[data-run-trace="tr-4"]'));
    expect(openTrace).toHaveBeenCalledWith('tr-4');
    // No state from the owner, or no run: the start outcome, and no trace link.
    expect(chip(runs[1]).getAttribute('label')).toBe('Started');
    expect(chip(runs[2]).getAttribute('label')).toBe('Skipped');
    expect(runs[1].querySelector('[data-run-trace]')).toBeNull();
    expect(runs[1].querySelector('.matter-runnables__desc').textContent).not.toContain('finished');

    click(window, runs[0].querySelector('[data-run-why]'));
    await tick(window);
    const modal = [...window.document.querySelectorAll('lex-modal')].pop();
    expect(modal.textContent).toContain('Failed. Status: Failed.');
    click(window, modal.querySelector('[data-run-trace="tr-4"]'));
    expect(openTrace).toHaveBeenCalledTimes(2);
  });

  test('without a way to open traces (not an admin) a run shows no trace link', async () => {
    const window = boot();
    const WITH_TRACE = { ...STARTED, run: { ...STARTED.run, state: 'completed', status: 'completed', execution_trace_id: 'tr-9' } };
    const c = client({ getRuns: jest.fn(async () => ({ status: 'success', data: { runs: [WITH_TRACE], next_cursor: null } })) });
    const { deps: d } = deps(window, c);
    const drawer = window.LanaMatterRunnablesPanel.open({ ...d, initialTab: 'history' });
    await tick(window);
    expect(drawer.querySelector('lex-badge[data-run-status]').getAttribute('label')).toBe('Completed');
    expect(drawer.querySelector('[data-run-trace]')).toBeNull();
  });

  test('a run with no causation record says so', async () => {
    const window = boot();
    const c = client({ getCausation: jest.fn(async () => { throw Object.assign(new Error('nf'), { status: 404 }); }) });
    const { deps: d } = deps(window, c);
    const modal = window.LanaMatterRunnablesPanel.openCausation(d, 'agent_run', 'old');
    await tick(window);
    expect(modal.textContent).toContain('No record of how this run started');
  });

  test('a skill shows its trigger summary under its name; readiness null shows nothing and never asks', async () => {
    const window = boot();
    const c = client();
    const makeup = { ...MAKEUP, runnables: [
      { kind: 'agent', key: 'matter-review', name: 'Matter review', description: 'Reads the file.', available: true, can_start: true, definition_id: 'd1', readiness: null },
      { kind: 'skill', key: 'nightly-sweep-v1', name: 'Nightly sweep', description: 'Checks deadlines.', available: true, enabled: true, automation_id: 'auto-1', trigger_summary: 'Runs daily at 09:00', readiness: null },
    ] };
    const { deps: d } = deps(window, c, { makeup });
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    const skill = drawer.querySelector('[data-runnable="skill:nightly-sweep-v1"]');
    const text = skill.querySelector('.matter-runnables__item-text');
    expect([...text.children].map((el) => el.className)).toEqual(['matter-runnables__name', 'matter-runnables__trigger', 'matter-runnables__desc']);
    expect(text.querySelector('.matter-runnables__trigger').textContent).toBe('Runs daily at 09:00');
    const agent = drawer.querySelector('[data-runnable="agent:matter-review"]');
    expect(agent.querySelector('.matter-runnables__trigger')).toBeNull();
    expect(agent.querySelector('[data-readiness-toggle]')).toBeNull();
    expect(drawer.textContent).not.toMatch(/error|could not/i);
    expect(c.getReadiness).not.toHaveBeenCalled();
  });

  test('no runnables shows an empty state', async () => {
    const window = boot();
    const { deps: d } = deps(window, client(), { makeup: { ...MAKEUP, runnables: [] } });
    const drawer = window.LanaMatterRunnablesPanel.open(d);
    await tick(window);
    expect(drawer.querySelector('lex-empty').getAttribute('message')).toBe('No agents or skills');
  });
});

describe('Makeup switch dialog', () => {
  test('explains, offers the upgrade, requires a reason, then sends PUT and reloads', async () => {
    const window = boot();
    const c = client();
    const { deps: d, notes } = deps(window, c, { onSwitched: jest.fn() });
    const modal = window.LanaMakeupSwitchDialog.open(d);
    await tick(window);
    expect(modal.textContent).toContain('This matter uses Standard, version 1.');
    expect(modal.textContent).toContain('Nothing is deleted');
    expect(modal.querySelector('[data-makeup-upgrade]').hidden).toBe(false);
    const select = modal.querySelector('[data-makeup-select]');
    expect(select.options.map((o) => o.value)).toEqual(['standard', 'probate']);
    const save = modal.querySelector('[data-makeup-action="save"]');

    click(window, modal.querySelector('[data-makeup-action="upgrade"]'));
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(modal.querySelector('[data-makeup-plan]').textContent).toBe('Upgrade Standard to version 2.');
    expect(save.querySelector('button')).not.toBeNull();
    expect(save.querySelector('button').textContent).toContain('Upgrade');

    click(window, save);
    await tick(window);
    expect(c.switchMakeup).not.toHaveBeenCalled();
    expect(notes.pop()[1]).toContain('reason');

    modal.querySelector('[data-makeup-reason]').value = 'Newer checks';
    click(window, save);
    await tick(window);
    expect(c.switchMakeup).toHaveBeenCalledWith('M-1', { makeup_key: 'standard', reason: 'Newer checks', version: 2 });
    expect(d.onSwitched).toHaveBeenCalled();
    await tick(window, 400);
    expect(modal.isConnected).toBe(false);
  });

  test('switching to another makeup; a refusal keeps the dialog open', async () => {
    const window = boot();
    const c = client({ switchMakeup: jest.fn(async () => { throw Object.assign(new Error('no'), { status: 403 }); }) });
    const { deps: d, notes } = deps(window, c, { onSwitched: jest.fn() });
    const modal = window.LanaMakeupSwitchDialog.open(d);
    await tick(window);
    const select = modal.querySelector('[data-makeup-select]');
    select.value = 'probate';
    select.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value: 'probate' } }));
    expect(modal.querySelector('[data-makeup-plan]').textContent).toBe('Switch this matter to Probate, version 1.');
    modal.querySelector('[data-makeup-reason]').value = 'Scope changed';
    click(window, modal.querySelector('[data-makeup-action="save"]'));
    await tick(window);
    expect(c.switchMakeup).toHaveBeenCalledWith('M-1', { makeup_key: 'probate', reason: 'Scope changed', version: 1 });
    expect(notes.pop()[1]).toContain('permission');
    expect(d.onSwitched).not.toHaveBeenCalled();
    expect(modal.isConnected).toBe(true);
  });

  test('503 MAKEUP_SWITCH_INCOMPLETE keeps the dialog with Finish setup, which resends the same body', async () => {
    const window = boot();
    const incomplete = Object.assign(new Error('setup'), { status: 503, code: 'MAKEUP_SWITCH_INCOMPLETE' });
    const switchMakeup = jest.fn()
      .mockRejectedValueOnce(incomplete)
      .mockResolvedValueOnce({ outcome: 'unchanged', assignment: { id: 'as-1' }, effects: { status: 'complete', skills_disabled: 1, starter_tasks_created: 0 }, ...MAKEUP });
    const { deps: d, notes } = deps(window, client({ switchMakeup }), { onSwitched: jest.fn() });
    const modal = window.LanaMakeupSwitchDialog.open(d);
    await tick(window);
    const select = modal.querySelector('[data-makeup-select]');
    select.value = 'probate';
    select.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value: 'probate' } }));
    modal.querySelector('[data-makeup-reason]').value = 'Scope changed';
    const save = modal.querySelector('[data-makeup-action="save"]');
    click(window, save);
    await tick(window);
    expect(modal.isConnected).toBe(true);
    expect(save.querySelector('button').textContent).toContain('Finish setup');
    expect(select.disabled).toBe(true);
    expect(notes.pop()[1]).toContain('Finish setup');
    // The reason box changing now does not change what is resent.
    modal.querySelector('[data-makeup-reason]').value = 'Something else';
    click(window, save);
    await tick(window);
    expect(switchMakeup.mock.calls[1][1]).toEqual(switchMakeup.mock.calls[0][1]);
    expect(notes.pop()).toEqual(['success', 'The makeup setup is complete (1 skill turned off)']);
    expect(d.onSwitched).toHaveBeenCalledTimes(1);
  });

  const NO_WAIT = { delays: [5, 5], wait: async () => {} };
  const busy = () => Object.assign(new Error('busy'), {
    status: 409, code: 'MAKEUP_SWITCH_IN_PROGRESS', data: { error: { code: 'MAKEUP_SWITCH_IN_PROGRESS', retryable: true } },
  });

  async function saveProbate(window, switchMakeup) {
    const { deps: d, notes } = deps(window, client({ switchMakeup }), { onSwitched: jest.fn(), retry: NO_WAIT });
    const modal = window.LanaMakeupSwitchDialog.open(d);
    await tick(window);
    const select = modal.querySelector('[data-makeup-select]');
    select.value = 'probate';
    select.dispatchEvent(new window.CustomEvent('lex-change', { bubbles: true, detail: { value: 'probate' } }));
    modal.querySelector('[data-makeup-reason]').value = 'Scope changed';
    const save = modal.querySelector('[data-makeup-action="save"]');
    click(window, save);
    await tick(window);
    return { d, notes, modal, save };
  }

  test('409 MAKEUP_SWITCH_IN_PROGRESS is resent with the same body until it goes through', async () => {
    const window = boot();
    const switchMakeup = jest.fn()
      .mockRejectedValueOnce(busy())
      .mockResolvedValueOnce({ outcome: 'switched', assignment: { id: 'as-2' }, effects: { status: 'complete', skills_disabled: 0, starter_tasks_created: 1 }, ...MAKEUP });
    const { d, notes, modal } = await saveProbate(window, switchMakeup);
    expect(switchMakeup).toHaveBeenCalledTimes(2);
    expect(switchMakeup.mock.calls[1][1]).toBe(switchMakeup.mock.calls[0][1]);
    expect(notes.pop()).toEqual(['success', 'Makeup changed, setup complete (1 starter task added)']);
    expect(d.onSwitched).toHaveBeenCalledTimes(1);
    await tick(window, 400);
    expect(modal.isConnected).toBe(false);
  });

  test('still in progress after the resends: Finish setup, which sends the same body again', async () => {
    const window = boot();
    const switchMakeup = jest.fn()
      .mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy())
      .mockResolvedValueOnce({ outcome: 'switched', assignment: { id: 'as-2' }, effects: { status: 'complete', skills_disabled: 0, starter_tasks_created: 0 }, ...MAKEUP });
    const { d, notes, modal, save } = await saveProbate(window, switchMakeup);
    expect(switchMakeup).toHaveBeenCalledTimes(3);
    expect(modal.isConnected).toBe(true);
    expect(save.querySelector('button').textContent).toContain('Finish setup');
    expect(notes.pop()[1]).toContain('still in progress');
    click(window, save);
    await tick(window);
    expect(switchMakeup).toHaveBeenCalledTimes(4);
    expect(switchMakeup.mock.calls[3][1]).toEqual(switchMakeup.mock.calls[0][1]);
    expect(notes.pop()[0]).toBe('success');
    expect(d.onSwitched).toHaveBeenCalledTimes(1);
  });

  test('an answer with effects.status incomplete is not reported as done: Finish setup', async () => {
    const window = boot();
    const switchMakeup = jest.fn()
      .mockResolvedValueOnce({ outcome: 'switched', assignment: { id: 'as-2' }, effects: { status: 'incomplete' }, ...MAKEUP })
      .mockResolvedValueOnce({ outcome: 'unchanged', assignment: { id: 'as-2' }, effects: { status: 'complete', skills_disabled: 0, starter_tasks_created: 1 }, ...MAKEUP });
    const { d, notes, modal, save } = await saveProbate(window, switchMakeup);
    expect(modal.isConnected).toBe(true);
    expect(notes.pop()[0]).toBe('warning');
    expect(save.querySelector('button').textContent).toContain('Finish setup');
    expect(d.onSwitched).not.toHaveBeenCalled();
    click(window, save);
    await tick(window);
    expect(switchMakeup.mock.calls[1][1]).toEqual(switchMakeup.mock.calls[0][1]);
    expect(notes.pop()).toEqual(['success', 'The makeup setup is complete (1 starter task added)']);
  });

  test('no newer version: no upgrade offer and the current makeup cannot be saved', async () => {
    const window = boot();
    const { deps: d } = deps(window, client(), { makeup: { ...MAKEUP, makeup: { key: 'standard', name: 'Standard', version: 2, latest_version: 2 } } });
    const modal = window.LanaMakeupSwitchDialog.open(d);
    await tick(window);
    expect(modal.querySelector('[data-makeup-upgrade]').hidden).toBe(true);
    expect(modal.querySelector('[data-makeup-action="save"]').hasAttribute('disabled')).toBe(true);
  });
});

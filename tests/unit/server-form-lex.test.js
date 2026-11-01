/**
 * Server form runner, generic makeup tabs and task action buttons on the
 * real Lex components in jsdom.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (window, ms = 30) => new Promise((resolve) => window.setTimeout(resolve, ms));
// Polls until the condition holds (or fails after `limit` ms), so a test
// never depends on how many timers the machine fits into a fixed sleep.
async function waitFor(window, condition, limit = 2000) {
  const start = Date.now();
  const holds = () => { try { return Boolean(condition()); } catch (_e) { return false; } };
  while (!holds()) {
    if (Date.now() - start > limit) throw new Error('waitFor: condition not met within ' + limit + ' ms');
    // eslint-disable-next-line no-await-in-loop
    await tick(window, 5);
  }
}
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const SCRIPTS = [
  'time-utils.js', 'lex/lex.core.js', 'lex/lex.icons.js', 'lex/lex.data.js', 'lex/lex.forms.js', 'lex/lex.utils.js',
  'lex/components/foundation/lex-btn.js', 'lex/components/foundation/lex-modal.js', 'lex/components/foundation/lex-empty.js',
  'lex/components/foundation/lex-spinner.js', 'lex/components/foundation/lex-badge.js',
  'lex/components/form/lex-input.js', 'lex/components/form/lex-textarea.js', 'lex/components/form/lex-select.js',
  'lex/components/form/lex-checkbox.js', 'lex/components/data/lex-table.js',
  'shared/form-values.js', 'shared/pending-submit.js', 'shared/server-form-fields.js', 'shared/server-form.js',
  'api/matter-makeup-api.client.js',
  'shared/matter-tab-registry.js', 'shared/matter-generic-tabs.js', 'shared/task-actions.js', 'shared/run-history.js',
];

function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="panels"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  window.console.log = () => {};
  window.console.warn = () => {};
  SCRIPTS.forEach((rel) => window.eval(read(rel)));
  return window;
}

const versions = [{ value: 'v1', label: 'Will v1', reference: { kind: 'document_release', id: 'd1', version: 1 } }];
const ALL_KINDS_FORM = {
  schema_version: 1,
  form_key: 'provider.example',
  title: 'Record decision',
  description: 'Review first.',
  context: [{ label: 'Plan', value: 'Plan v3' }],
  fields: [
    { id: 'text', kind: 'text', label: 'Text' },
    { id: 'textarea', kind: 'textarea', label: 'Textarea', required: true },
    { id: 'number', kind: 'number', label: 'Number' },
    { id: 'money', kind: 'money', label: 'Money', currency: 'USD' },
    { id: 'date', kind: 'date', label: 'Date' },
    { id: 'datetime', kind: 'datetime', label: 'Datetime' },
    { id: 'select', kind: 'select', label: 'Select', required: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { id: 'multiselect', kind: 'multiselect', label: 'Multi', options: [{ value: 'a', label: 'A' }] },
    { id: 'reference', kind: 'reference', label: 'Ref', reference_kind: 'contact', options: [{ value: 'c1', label: 'C1' }] },
    { id: 'reference_set', kind: 'reference_set', label: 'Refs', reference_kind: 'contact', options: [{ value: 'c1', label: 'C1' }] },
    { id: 'allocation', kind: 'allocation', label: 'Shares', reference_kind: 'contact', options: [{ value: 'c1', label: 'C1' }] },
    { id: 'document_versions', kind: 'document_versions', label: 'Versions', options: versions },
    { id: 'evidence_sources', kind: 'evidence_sources', label: 'Sources', options: versions, evidence_classes: [], coverage_options: [] },
    { id: 'confirm', kind: 'confirm', label: 'I reviewed this exact version.' },
  ],
  submit_label: 'Record decision',
  binding: { subject: 'record:1', version: 4, sha256: 'abc' },
};

function field(modal, id) { return modal.querySelector('[data-field-id="' + id + '"]'); }
function submitBtn(modal) { return modal.querySelector('[data-server-form-action="submit"]'); }
function noticeText(modal) { return modal.querySelector('[data-server-form-notice]').textContent; }

const SCOPE = ['http://s', 'org', 'user', 'M-1', 'form:provider.example:record:1'];

describe('LanaServerForm on Lex', () => {
  test('renders one Lex control per field kind', async () => {
    const window = boot();
    expect(Object.keys(window.LanaServerForm.RENDERERS)).toEqual(window.LanaServerFormFields.FIELD_KINDS);
    const modal = window.LanaServerForm.open({ load: async () => ALL_KINDS_FORM, submit: jest.fn() });
    await tick(window);
    expect(modal.heading).toBe('Record decision');
    const tags = ALL_KINDS_FORM.fields.map((f) => field(modal, f.id).tagName.toLowerCase());
    expect(tags).toEqual(['lex-input', 'lex-textarea', 'lex-input', 'lex-input', 'lex-input', 'lex-input', 'lex-select', 'lex-select',
      'lex-select', 'lex-select', 'div', 'lex-select', 'div', 'lex-checkbox']);
    expect(field(modal, 'datetime').type).toBe('datetime-local');
    expect(field(modal, 'multiselect').multiple).toBe(true);
    expect(modal.querySelector('.server-form__context dd').textContent).toBe('Plan v3');
  });

  test('validation errors stay in the form and nothing is sent', async () => {
    const window = boot();
    const submit = jest.fn();
    const modal = window.LanaServerForm.open({ load: async () => ALL_KINDS_FORM, submit });
    await tick(window);
    click(window, submitBtn(modal));
    await tick(window);
    expect(submit).not.toHaveBeenCalled();
    expect(field(modal, 'textarea').error).toContain('required');
    expect(field(modal, 'confirm').error).toContain('Confirm');
    expect(noticeText(modal)).toBe('Check the highlighted fields.');
  });

  // The descriptor as GET .../forms/:form_key answers it: the bare body, binding { subject, version?, sha256 }.
  function simpleForm(binding) {
    return {
      schema_version: 1, form_key: 'provider.example', title: 'Decide', submit_label: 'Submit',
      binding: Object.assign({ subject: 'record:1', sha256: 'a'.repeat(64) }, binding),
      fields: [{ id: 'reason', kind: 'textarea', label: 'Reason', required: true }, { id: 'ok', kind: 'confirm', label: 'Confirm' }],
    };
  }

  test('a dropped submit is kept in sessionStorage and replayed with the same request id', async () => {
    const window = boot();
    const offline = Object.assign(new Error('Network down.'), { status: 0 });
    const submit = jest.fn().mockRejectedValueOnce(offline);
    const modal = window.LanaServerForm.open({ load: async () => simpleForm({ subject: 'record:1', version: 4 }), submit, scope: SCOPE });
    await tick(window);
    field(modal, 'reason').value = 'Because';
    field(modal, 'ok').checked = true;
    click(window, submitBtn(modal));
    await tick(window);
    const body = submit.mock.calls[0][0];
    expect(body).toMatchObject({ subject: 'record:1', binding: { subject: 'record:1', version: 4 }, values: { reason: 'Because', ok: true } });
    expect(typeof body.request_id).toBe('string');
    expect(noticeText(modal)).toContain('Your entries are saved');
    expect(window.sessionStorage.length).toBe(1);
    modal.removeAfterClose();

    // Reopened later: the saved change is shown read-only and sent again as is.
    const onRecorded = jest.fn();
    const replay = jest.fn(async () => ({ status: 'replayed', message: 'Decision recorded.' }));
    const again = window.LanaServerForm.open({ load: async () => simpleForm({ subject: 'record:1', version: 4 }), submit: replay, scope: SCOPE, onRecorded });
    await tick(window);
    expect(noticeText(again)).toContain('did not get an answer');
    expect(field(again, 'reason').value).toBe('Because');
    expect(field(again, 'reason').disabled).toBe(true);
    click(window, submitBtn(again));
    await tick(window);
    expect(replay.mock.calls[0][0].request_id).toBe(body.request_id);
    expect(noticeText(again)).toBe('This change was already recorded. Showing the saved result. Decision recorded.');
    expect(onRecorded).toHaveBeenCalledWith(expect.objectContaining({ replayed: true }));
    expect(window.sessionStorage.length).toBe(0);
  });

  test('409 FORM_STALE reloads the descriptor with a clear message', async () => {
    const window = boot();
    const load = jest.fn().mockResolvedValueOnce(simpleForm({ version: 4 })).mockResolvedValueOnce(simpleForm({ version: 5 }));
    const stale = Object.assign(new Error('Changed'), { status: 409, code: 'FORM_STALE' });
    const modal = window.LanaServerForm.open({ load, submit: jest.fn().mockRejectedValueOnce(stale), scope: SCOPE });
    await tick(window);
    field(modal, 'reason').value = 'Because';
    field(modal, 'ok').checked = true;
    click(window, submitBtn(modal));
    await tick(window);
    expect(load).toHaveBeenCalledTimes(2);
    expect(noticeText(modal)).toContain('This record changed while the form was open');
    expect(field(modal, 'reason').value).toBe('');
    expect(window.sessionStorage.length).toBe(0);
  });

  test('FORM_IN_PROGRESS resends the same request, then keeps it with a clear message', async () => {
    const window = boot();
    const busy = () => Object.assign(new Error('This change is still being recorded; try again shortly'), {
      status: 409, code: 'FORM_IN_PROGRESS', data: { error: { code: 'FORM_IN_PROGRESS', retryable: true } },
    });
    const submit = jest.fn(async () => { throw busy(); });
    // The backoff waits resolve at once, and the test waits for the final
    // state rather than a fixed sleep: under load the 1 ms delays used to
    // land after the sleep (the flake).
    const waits = [];
    const wait = async (ms) => { waits.push(ms); };
    const modal = window.LanaServerForm.open({ load: async () => simpleForm({}), submit, scope: SCOPE, retryDelays: [1, 2], wait });
    await waitFor(window, () => field(modal, 'reason'));
    field(modal, 'reason').value = 'Because';
    field(modal, 'ok').checked = true;
    click(window, submitBtn(modal));
    await waitFor(window, () => submitBtn(modal).textContent.includes('Send again') && noticeText(modal).includes('still being recorded'));
    expect(waits).toEqual([1, 2]);
    expect(submit).toHaveBeenCalledTimes(3);
    expect(new Set(submit.mock.calls.map((call) => call[0].request_id)).size).toBe(1);
    expect(noticeText(modal)).toContain('still being recorded');
    expect(window.sessionStorage.length).toBe(1);
    expect(submitBtn(modal).textContent).toContain('Send again');

    submit.mockResolvedValueOnce({ status: 'recorded', record_ref: { kind: 'record', id: '1' }, message: 'Decision recorded.' });
    click(window, submitBtn(modal));
    await waitFor(window, () => noticeText(modal) === 'Decision recorded.');
    expect(submit.mock.calls[3][0].request_id).toBe(submit.mock.calls[0][0].request_id);
    expect(noticeText(modal)).toBe('Decision recorded.');
    expect(window.sessionStorage.length).toBe(0);
  });

  test('REQUEST_ID_REUSED drops the saved change and lets the person submit again; a 400 names its field', async () => {
    const window = boot();
    const reused = Object.assign(new Error('This request id was already used for a different change'), { status: 409, code: 'REQUEST_ID_REUSED' });
    const invalid = Object.assign(new Error('Too long'), { status: 400, code: 'VALIDATION_ERROR', data: { error: { code: 'VALIDATION_ERROR', field: 'reason' } } });
    const submit = jest.fn().mockRejectedValueOnce(reused).mockRejectedValueOnce(invalid);
    const modal = window.LanaServerForm.open({ load: async () => simpleForm({}), submit, scope: SCOPE });
    await tick(window);
    field(modal, 'reason').value = 'Because';
    field(modal, 'ok').checked = true;
    click(window, submitBtn(modal));
    await tick(window);
    expect(noticeText(modal)).toContain('nothing was recorded');
    expect(window.sessionStorage.length).toBe(0);
    expect(field(modal, 'reason').disabled).toBeFalsy();
    click(window, submitBtn(modal));
    await tick(window);
    expect(submit.mock.calls[1][0].request_id).not.toBe(submit.mock.calls[0][0].request_id);
    expect(field(modal, 'reason').error).toBe('Too long');
  });

  test('a descriptor with an unknown field kind needs a newer app version', async () => {
    const window = boot();
    const modal = window.LanaServerForm.open({ load: async () => ({ schema_version: 1, fields: [{ id: 's', kind: 'signature' }] }), submit: jest.fn() });
    await tick(window);
    expect(modal.querySelector('lex-empty').getAttribute('message')).toBe('This form needs a newer app version.');
  });
});

describe('generic makeup tabs on Lex', () => {
  test('a records tab loads server rows into a lex-table and row actions open forms', async () => {
    const window = boot();
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const [tab] = registry.buildTabs([{ id: 'assets', kind: 'records', label: 'Assets' }]);
    registry.ensurePanels(doc.getElementById('panels'), [tab]);
    const client = { getTab: jest.fn(async () => ({
      tab: { id: 'assets', kind: 'records', label: 'Assets', available: true },
      available: true,
      columns: [{ key: 'name', label: 'Name' }],
      rows: [{ id: 'r1', cells: { name: 'House' }, actions: [{ id: 'edit', label: 'Edit', form: 'provider.update', subject: 'record:r1' }] }],
      actions: [{ id: 'add', label: 'Add', form: 'provider.create' }],
    })) };
    const openForm = jest.fn();
    registry.render(tab, { document: doc, matterId: 'M-1', client, openForm });
    await tick(window, 60);
    expect(client.getTab).toHaveBeenCalledWith('M-1', 'assets', null);
    const panel = doc.getElementById('matterTabPanel-assets');
    expect(panel.querySelector('lex-table')).not.toBeNull();
    expect(panel.textContent).toContain('House');
    click(window, panel.querySelector('lex-btn[data-tab-row="0"]'));
    expect(openForm.mock.calls[0][0]).toMatchObject({ form: 'provider.update', subject: 'record:r1' });
    click(window, panel.querySelector('lex-btn[data-tab-action]:not([data-tab-row])'));
    expect(openForm.mock.calls[1][0]).toMatchObject({ form: 'provider.create' });
  });

  test('a rulebook tab renders groups, badges and safe citations; a ledger lists entries', async () => {
    const window = boot();
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const tabs = registry.buildTabs([{ id: 'rules', kind: 'rulebook' }, { id: 'log', kind: 'ledger' }]);
    registry.ensurePanels(doc.getElementById('panels'), tabs);
    const client = { getTab: jest.fn(async (m, id) => (id === 'rules'
      ? { tab: { id: 'rules', kind: 'rulebook', label: 'Rulebook', available: true }, available: true, groups: [{ id: 'g', title: 'Group one', rows: [{ id: 'x.y.z', title: 'Rule', badges: [{ label: 'Blocking', tone: 'danger' }],
        citations: [{ label: 'Source', url: 'https://example.com' }, { label: 'Bad', url: 'javascript:alert(1)' }] }] }] }
      : { tab: { id: 'log', kind: 'ledger', label: 'Ledger', available: true }, available: true, rows: [{ id: 'd1', title: 'Decision', recorded_by: 'A. Person', references: [{ label: 'Plan v3' }] }] })) };
    tabs.forEach((tab) => registry.render(tab, { document: doc, matterId: 'M-1', client, openForm: jest.fn() }));
    await tick(window, 60);
    const rules = doc.getElementById('matterTabPanel-rules');
    expect(rules.querySelector('h3').textContent).toBe('Group one');
    expect(rules.querySelector('lex-badge').getAttribute('color')).toBe('red');
    expect(rules.querySelectorAll('a').length).toBe(1);
    expect(rules.textContent).toContain('Bad');
    const log = doc.getElementById('matterTabPanel-log');
    expect(log.textContent).toContain('A. Person');
    expect(log.querySelector('.matter-generic-tab__ref').textContent).toBe('Plan v3');
  });
});

describe('tab content answers that are not content', () => {
  test('available false shows the server reason; built_in hands the tab to the built-in renderer', async () => {
    const window = boot();
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const tabs = registry.buildTabs([{ id: 'assets', kind: 'records', label: 'Assets' }, { id: 'rules', kind: 'rulebook' }]);
    registry.ensurePanels(doc.getElementById('panels'), tabs);
    const client = { getTab: jest.fn(async (m, id) => (id === 'assets'
      ? { tab: { id: 'assets', kind: 'records', label: 'Assets', available: false, reason: 'Records are off here.' }, available: false, reason: 'Records are off here.' }
      : { tab: { id: 'rules', kind: 'rulebook', label: 'Rulebook', available: true }, available: true, built_in: true })) };
    tabs.forEach((tab) => registry.render(tab, { document: doc, matterId: 'M-1', client, openForm: jest.fn() }));
    await tick(window, 60);
    const assets = doc.getElementById('matterTabPanel-assets');
    expect(assets.querySelector('lex-empty').getAttribute('message')).toBe('This section is not available');
    expect(assets.querySelector('lex-empty').getAttribute('description')).toBe('Records are off here.');
    expect(assets.querySelector('lex-table')).toBeNull();
    // rulebook is not a built-in kind, so built_in has no renderer: the newer-version state, not a broken table.
    expect(doc.getElementById('matterTabPanel-rules').querySelector('lex-empty').getAttribute('message')).toBe(registry.NEWER_VERSION);
  });
});

describe('task action buttons on Lex', () => {
  test('start actions call POST start; form actions open the form; presses do not reach the card', async () => {
    const window = boot();
    const doc = window.document;
    const card = doc.createElement('div');
    const cardClick = jest.fn();
    card.addEventListener('click', cardClick);
    const host = doc.createElement('div');
    card.appendChild(host);
    doc.body.appendChild(card);
    const task = { id: 't1', actions: [
      { id: 'a1', kind: 'start_agent', label: 'Run review', status: 'available' },
      { id: 'a2', kind: 'form', label: 'Decision needed', status: 'available' },
      { id: 'a3', kind: 'start_automation', label: 'Refresh', status: 'running', last_run: { started_at: new Date().toISOString() } },
    ] };
    // POST .../start as the backend answers it: 202 { outcome, action, run }.
    const answer = { outcome: 'started', action: { id: 'a1', kind: 'start_agent', label: 'Run review', status: 'running', last_run: { kind: 'agent_run', id: 'r1', started_at: new Date().toISOString(), finished_at: null } }, run: { kind: 'agent_run', id: 'r1' } };
    const deps = { client: { startTaskAction: jest.fn(async () => answer) }, openForm: jest.fn(), onChanged: jest.fn(), notify: jest.fn(), scope: () => null };
    window.LanaTaskActions.mount(host, task, deps);
    await tick(window);
    const buttons = host.querySelectorAll('lex-btn');
    expect(buttons.length).toBe(3);
    expect(buttons[2].hasAttribute('disabled')).toBe(true);
    expect(host.textContent).toContain('Running');
    expect(host.textContent).toContain('Last run');
    click(window, buttons[0]);
    await tick(window);
    expect(deps.client.startTaskAction).toHaveBeenCalledWith('t1', 'a1', expect.any(String));
    expect(deps.onChanged).toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith('success', 'Run review started');
    // The answer's action status drives the button: now running, not pressable.
    const after = host.querySelectorAll('lex-btn');
    expect(after[0].hasAttribute('disabled')).toBe(true);
    expect(host.querySelector('[data-task-action-id="a1"]').parentElement.textContent).toContain('Running');
    click(window, after[1]);
    expect(deps.openForm).toHaveBeenCalledWith(task, task.actions[1]);
    expect(cardClick).not.toHaveBeenCalled();
  });

  test('a resent failed press shows the failure; an agent already running reads as such; both ask the server for the status', async () => {
    const window = boot();
    const host = window.document.createElement('div');
    window.document.body.appendChild(host);
    const task = { id: 't1', actions: [{ id: 'a6', kind: 'start_agent', label: 'Retry review', status: 'failed' }] };
    const failed = Object.assign(new Error('This start failed. Press the action again to retry.'), {
      status: 409, code: 'TASK_ACTION_START_FAILED', data: { error: { code: 'TASK_ACTION_START_FAILED', details: { start_id: 's1' } } },
    });
    const active = Object.assign(new Error('This agent is already running on this matter.'), {
      status: 409, code: 'ACTIVE_RUN_EXISTS', data: { error: { code: 'ACTIVE_RUN_EXISTS', details: { active_run_id: 'r9', outcome: 'skipped_active_run' } } },
    });
    const deps = { client: { startTaskAction: jest.fn().mockRejectedValueOnce(failed).mockRejectedValueOnce(active) }, openForm: jest.fn(), onChanged: jest.fn(), notify: jest.fn(), scope: () => null };
    window.LanaTaskActions.mount(host, task, deps);
    click(window, host.querySelector('lex-btn'));
    await tick(window);
    expect(deps.notify).toHaveBeenLastCalledWith('error', 'Retry review failed. Press it again to retry.');
    click(window, host.querySelector('lex-btn'));
    await tick(window);
    expect(deps.notify).toHaveBeenLastCalledWith('info', 'This agent is already running on this matter.');
    expect(deps.onChanged).toHaveBeenCalledTimes(2);
    // A refusal spends the request id: the second press was a new request.
    const ids = deps.client.startTaskAction.mock.calls.map((call) => call[2]);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('server form shapes from the matter makeup forms (backend phase 7a)', () => {
  const formOf = (fields, extra) => Object.assign({
    schema_version: 1, form_key: 'provider.check', title: 'Check evidence', submit_label: 'Check evidence',
    description: 'Check the recorded evidence now.', binding: { subject: 'record:t1', version: 1, sha256: 'a'.repeat(64) }, fields,
  }, extra);

  test('a form with no fields shows its text and submits empty values', async () => {
    const window = boot();
    const submit = jest.fn(async () => ({ status: 'recorded', record_ref: { kind: 'assurance_record', id: 'as1' }, message: 'Checked: evidence supports a match.' }));
    const modal = window.LanaServerForm.open({ load: async () => formOf([], { context: [{ label: 'Target', value: 'rule.a, version 1' }] }), submit });
    await tick(window);
    expect(modal.querySelector('.server-form__fields')).toBeNull();
    expect(modal.querySelector('.server-form__context dd').textContent).toBe('rule.a, version 1');
    expect(submitBtn(modal).disabled).toBeFalsy();
    click(window, submitBtn(modal));
    await tick(window);
    expect(submit.mock.calls[0][0]).toMatchObject({ subject: 'record:t1', values: {} });
    expect(noticeText(modal)).toBe('Checked: evidence supports a match.');
  });

  test('control: a form with fields still renders its field list', async () => {
    const window = boot();
    const modal = window.LanaServerForm.open({ load: async () => formOf([{ id: 'reason', kind: 'textarea', label: 'Reason' }]), submit: jest.fn() });
    await tick(window);
    expect(modal.querySelector('.server-form__fields')).not.toBeNull();
  });

  test('a recorded decision (record_ref kind assurance_decision) is shown like any other record', async () => {
    const window = boot();
    const onRecorded = jest.fn();
    const submit = jest.fn(async () => ({ status: 'recorded', record_ref: { kind: 'assurance_decision', id: 'd1' }, message: 'Finding rejected.' }));
    const modal = window.LanaServerForm.open({ load: async () => formOf([]), submit, onRecorded });
    await tick(window);
    click(window, submitBtn(modal));
    await tick(window);
    expect(onRecorded).toHaveBeenCalledWith(expect.objectContaining({ record_ref: { kind: 'assurance_decision', id: 'd1' } }));
    expect(noticeText(modal)).toBe('Finding rejected.');
  });

  test('403 on open shows "Not permitted" with the server message; control: another failure is "Form unavailable"', async () => {
    const window = boot();
    const forbidden = Object.assign(new Error('Recording evidence needs the estate assurance write permission.'), { status: 403, code: 'ASSURANCE_OPERATION_FORBIDDEN' });
    const modal = window.LanaServerForm.open({ load: async () => { throw forbidden; }, submit: jest.fn() });
    await tick(window);
    expect(modal.heading).toBe('Not permitted');
    expect(modal.querySelector('lex-empty').getAttribute('message')).toBe(forbidden.message);
    expect(submitBtn(modal).disabled).toBe(true);
    const other = window.LanaServerForm.open({ load: async () => { throw Object.assign(new Error('Busy'), { status: 500 }); }, submit: jest.fn() });
    await tick(window);
    expect(other.heading).toBe('Form unavailable');
  });

  test('a refusal with a choice lets the person pick the subject, then the form loads for it and submits it', async () => {
    const window = boot();
    const ambiguous = Object.assign(new Error('This note is about 2 targets.'), { status: 422, code: 'ASSURANCE_NOTE_TARGET_AMBIGUOUS' });
    const load = jest.fn(async (subject) => {
      if (subject === 'matter_note:n1') throw ambiguous;
      return formOf([{ id: 'reason', kind: 'textarea', label: 'Reason', required: true }], { binding: { subject, sha256: 'a'.repeat(64) } });
    });
    const chooseSubject = jest.fn(async () => ({ heading: 'Choose a target', message: 'Pick one.', label: 'Target',
      choices: [{ value: 'matter_note:n1:t1', label: 'House: rule.a' }, { value: 'matter_note:n1:t2', label: 'House: rule.b' }] }));
    const submit = jest.fn(async () => ({ status: 'recorded', record_ref: { kind: 'assurance_record', id: 'o1' }, message: 'Evidence recorded.' }));
    const modal = window.LanaServerForm.open({ load, submit, subject: 'matter_note:n1', chooseSubject });
    await tick(window);
    expect(chooseSubject).toHaveBeenCalledWith(ambiguous);
    expect(modal.heading).toBe('Choose a target');
    expect(submitBtn(modal).textContent).toContain('Continue');
    click(window, submitBtn(modal));
    await tick(window);
    expect(noticeText(modal)).toBe('Choose one to continue.');
    expect(load).toHaveBeenCalledTimes(1);
    modal.querySelector('[data-server-form-choice]').value = 'matter_note:n1:t2';
    click(window, submitBtn(modal));
    await tick(window);
    expect(load).toHaveBeenLastCalledWith('matter_note:n1:t2');
    expect(modal.heading).toBe('Check evidence');
    field(modal, 'reason').value = 'From the bank letter.';
    click(window, submitBtn(modal));
    await tick(window);
    expect(submit.mock.calls[0][0]).toMatchObject({ subject: 'matter_note:n1:t2', binding: { subject: 'matter_note:n1:t2' } });
  });

  test('the choice is offered once; control: without a choice the refusal is shown', async () => {
    const window = boot();
    const ambiguous = Object.assign(new Error('This note is about 2 targets.'), { status: 422, code: 'ASSURANCE_NOTE_TARGET_AMBIGUOUS' });
    const load = jest.fn(async () => { throw ambiguous; });
    const chooseSubject = jest.fn(async () => ({ message: 'Pick one.', choices: [{ value: 'matter_note:n1:t1', label: 'One' }] }));
    const modal = window.LanaServerForm.open({ load, submit: jest.fn(), subject: 'matter_note:n1', chooseSubject });
    await tick(window);
    modal.querySelector('[data-server-form-choice]').value = 'matter_note:n1:t1';
    click(window, submitBtn(modal));
    await tick(window);
    expect(chooseSubject).toHaveBeenCalledTimes(1);
    expect(modal.heading).toBe('Form unavailable');
    expect(modal.querySelector('lex-empty').getAttribute('message')).toBe(ambiguous.message);
    const plain = window.LanaServerForm.open({ load, submit: jest.fn(), subject: 'matter_note:n1', chooseSubject: async () => null });
    await tick(window);
    expect(plain.querySelector('[data-server-form-choice]')).toBeNull();
    expect(plain.querySelector('lex-empty').getAttribute('message')).toBe(ambiguous.message);
  });
});

describe('ledger downloads', () => {
  function ledger(window, client) {
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const [tab] = registry.buildTabs([{ id: 'decisions', kind: 'ledger', label: 'Decisions' }]);
    registry.ensurePanels(doc.getElementById('panels'), [tab]);
    registry.render(tab, { document: doc, matterId: 'M-1', client, openForm: jest.fn() });
    return doc.getElementById('matterTabPanel-decisions');
  }
  const content = { tab: { id: 'decisions', kind: 'ledger' }, available: true,
    rows: [{ id: 'd1', title: 'Closeout accepted', downloads: [{ id: 'closeout:c1', label: 'Download closeout' }] }, { id: 'd2', title: 'Plan accepted' }] };

  const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });

  test('a refused download reads on its row: 403 TAB_UNAVAILABLE with the server reason, 404 CLOSEOUT_NOT_ACCEPTED with the server message', async () => {
    const window = boot();
    const client = { getTab: jest.fn(async () => content),
      downloadTabFile: jest.fn(async () => { throw refusal(403, 'TAB_UNAVAILABLE', 'Decisions need estate assurance access.'); }) };
    const panel = ledger(window, client);
    await tick(window, 60);
    const buttons = panel.querySelectorAll('[data-tab-download]');
    expect(buttons.length).toBe(1);
    click(window, buttons[0]);
    await tick(window);
    expect(client.downloadTabFile).toHaveBeenCalledWith('M-1', 'decisions', 'closeout:c1');
    expect(panel.querySelector('[data-tab-download-notice]').textContent).toBe('Decisions need estate assurance access.');
    client.downloadTabFile.mockImplementation(async () => { throw refusal(404, 'CLOSEOUT_NOT_ACCEPTED', 'Only accepted closeouts can be downloaded. Accept this closeout first.'); });
    click(window, buttons[0]);
    await tick(window);
    expect(panel.querySelector('[data-tab-download-notice]').textContent).toBe('Only accepted closeouts can be downloaded. Accept this closeout first.');
    // A plain 404 on the same row reads as gone (the server names an unaccepted closeout itself, 8c item 7).
    client.downloadTabFile.mockImplementation(async () => { throw refusal(404, 'NOT_FOUND', 'Not found'); });
    click(window, buttons[0]);
    await tick(window);
    expect(panel.querySelector('[data-tab-download-notice]').textContent).toBe('This file is no longer here. Reload the tab to see what can be downloaded.');
  });

  test('control: a 404 on a download of another kind reads "no longer here"', async () => {
    const window = boot();
    const other = { ...content, rows: [{ id: 'd1', title: 'Report', downloads: [{ id: 'report:r1', label: 'Download report' }] }] };
    const client = { getTab: jest.fn(async () => other), downloadTabFile: jest.fn(async () => { throw refusal(404, 'NOT_FOUND', 'Download not found'); }) };
    const panel = ledger(window, client);
    await tick(window, 60);
    click(window, panel.querySelector('[data-tab-download]'));
    await tick(window);
    expect(panel.querySelector('[data-tab-download-notice]').textContent).toBe(window.LanaMatterGenericTabs.DOWNLOAD_MESSAGES.notFound);
  });

  test('control: a download that answers is saved under the server file name, with no notice', async () => {
    const window = boot();
    window.URL.createObjectURL = jest.fn(() => 'blob:x');
    window.URL.revokeObjectURL = jest.fn();
    const clicked = jest.fn();
    window.HTMLAnchorElement.prototype.click = function () { clicked(this.download); };
    const blob = new window.Blob(['{}'], { type: 'application/json' });
    const client = { getTab: jest.fn(async () => content), downloadTabFile: jest.fn(async () => ({ blob, filename: 'closeout-c1.json' })) };
    const panel = ledger(window, client);
    await tick(window, 60);
    click(window, panel.querySelector('[data-tab-download]'));
    await tick(window);
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toHaveBeenCalledWith('closeout-c1.json');
    expect(panel.querySelector('[data-tab-download-notice]')).toBeNull();
  });

  test('downloadTabFile fetches with the session headers and reads the attachment name; a refusal carries status and code', async () => {
    const MatterMakeupAPIClient = require('../../src/js/api/matter-makeup-api.client.js');
    const fetchMock = jest.fn(async () => ({ ok: true, blob: async () => 'BLOB', headers: { get: () => 'attachment; filename="closeout-c1.json"' } }));
    const previous = global.fetch;
    global.fetch = fetchMock;
    try {
      const api = { baseUrl: 'http://s/', getHeaders: () => ({ Authorization: 'Bearer t' }) };
      const client = new MatterMakeupAPIClient(api);
      expect(await client.downloadTabFile('M-1', 'decisions', 'closeout:c1')).toEqual({ blob: 'BLOB', filename: 'closeout-c1.json' });
      expect(fetchMock).toHaveBeenCalledWith('http://s/api/v1/matters/M-1/tabs/decisions/downloads/closeout%3Ac1', expect.objectContaining({ headers: { Authorization: 'Bearer t' } }));
      fetchMock.mockImplementation(async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { code: 'TAB_UNAVAILABLE', message: 'Not for you.' } }) }));
      await expect(client.downloadTabFile('M-1', 'decisions', 'closeout:c1')).rejects.toMatchObject({ status: 403, code: 'TAB_UNAVAILABLE', message: 'Not for you.' });
    } finally {
      global.fetch = previous;
    }
  });
});

describe('rulebook paging', () => {
  test('a later page continues its group where it sits; control: a new group is appended', async () => {
    const window = boot();
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const [tab] = registry.buildTabs([{ id: 'rules', kind: 'rulebook', label: 'Rulebook' }]);
    registry.ensurePanels(doc.getElementById('panels'), [tab]);
    const first = { tab, available: true, groups: [
      { id: 'targets', title: 'Targets on this matter', subtitle: 'More targets follow.', rows: [{ id: 't1', title: 'Target one' }] },
      { id: 'module:a', title: 'Module A', rows: [{ id: 'a.rule', title: 'Rule' }] }], next_cursor: 'c1' };
    const second = { tab, available: true, groups: [{ id: 'targets:after:c1', title: 'Targets on this matter', rows: [{ id: 't2', title: 'Target two' }] },
      { id: 'other', title: 'Other', rows: [{ id: 'o1', title: 'Other row' }] }], next_cursor: null };
    const client = { getTab: jest.fn(async (m, id, cursor) => (cursor ? second : first)) };
    registry.render(tab, { document: doc, matterId: 'M-1', client, openForm: jest.fn() });
    await tick(window, 60);
    const panel = doc.getElementById('matterTabPanel-rules');
    click(window, panel.querySelector('[data-tab-more]'));
    await tick(window, 60);
    expect(client.getTab).toHaveBeenLastCalledWith('M-1', 'rules', 'c1');
    const sections = [...panel.querySelectorAll('.matter-generic-tab__group')];
    expect(sections.map((el) => el.querySelector('h3').textContent)).toEqual(['Targets on this matter', 'Module A', 'Other']);
    expect([...sections[0].querySelectorAll('.matter-generic-tab__row-title')].map((el) => el.textContent)).toEqual(['Target one', 'Target two']);
    expect(sections[0].textContent).not.toContain('More targets follow.');
    expect(panel.querySelector('[data-tab-more]')).toBeNull();
  });
});

describe('choice fields', () => {
  const adopt = (options) => ({ schema_version: 1, form_key: 'provider.adopt', title: 'Adopt a firm rulebook', submit_label: 'Adopt rulebook',
    description: options.length ? 'Adopt a starter.' : 'Every supported state is adopted.',
    fields: [{ id: 'jurisdiction', kind: 'select', label: 'State', required: true, options }, { id: 'rationale', kind: 'textarea', label: 'Basis', required: true }],
    binding: { subject: 'matter:1', revision: '2026-10-29 12:00:00.000001+00', sha256: 'a'.repeat(64) } });

  test('an option with a pinned starter shows it under the option; the binding goes back unchanged, revision included', async () => {
    const window = boot();
    const submit = jest.fn(async () => ({ status: 'recorded', record_ref: { kind: 'assurance_record', id: 'r1' }, message: 'Rulebook adopted.' }));
    const descriptor = adopt([{ value: 'US-IN', label: 'Indiana (US-IN)', starter: { id: 'estate-us-in', version: 3, sha256: 'b'.repeat(64) } }]);
    const modal = window.LanaServerForm.open({ load: async () => descriptor, submit });
    await tick(window);
    expect(field(modal, 'jurisdiction').options[0].description).toBe('Starter estate-us-in, version 3');
    field(modal, 'jurisdiction').value = 'US-IN';
    field(modal, 'rationale').value = 'Firm standard.';
    click(window, submitBtn(modal));
    await tick(window);
    expect(submit.mock.calls[0][0].binding).toEqual(descriptor.binding);
  });

  test('a document-sized textarea (max_length 400000) is tall, monospace and counted, and takes text past the default limit; control: a plain one is not', async () => {
    const window = boot();
    const submit = jest.fn(async () => ({ status: 'recorded', record_ref: { kind: 'assurance_record', id: 'r1' }, message: 'Rulebook published.' }));
    const descriptor = { schema_version: 1, form_key: 'provider.publish', title: 'Publish a firm rulebook', submit_label: 'Publish rulebook',
      fields: [
        { id: 'rulebook', kind: 'select', label: 'Rulebook', required: true, value: 'new', options: [{ value: 'new', label: 'A new rulebook' }, { value: 'rb-1', label: 'New version of the firm rulebook at version 2' }] },
        { id: 'definition', kind: 'textarea', label: 'Rulebook definition (JSON)', required: true, max_length: 400000 },
        { id: 'note', kind: 'textarea', label: 'Note' },
        { id: 'confirm', kind: 'confirm', label: 'I reviewed this rulebook and publish it for the firm.', required: true }
      ],
      binding: { subject: 'matter:1', sha256: 'a'.repeat(64) } };
    const modal = window.LanaServerForm.open({ load: async () => descriptor, submit });
    await tick(window);
    const definition = field(modal, 'definition');
    expect(definition.classList.contains('server-form__field--document')).toBe(true);
    expect(definition.rows).toBe(14);
    expect(definition.showCount).toBe(true);
    expect(definition.maxlength).toBe(400000);
    expect(field(modal, 'note').classList.contains('server-form__field--document')).toBe(false);
    expect(field(modal, 'note').rows).toBe(4);
    expect(field(modal, 'rulebook').value).toBe('new');
    const json = JSON.stringify({ effective_from: '2026-11-01', rules: [{ id: 'firm.a.b', text: 'x'.repeat(30000) }], advisory: [] });
    field(modal, 'rulebook').value = 'rb-1';
    definition.value = json;
    field(modal, 'confirm').checked = true;
    click(window, submitBtn(modal));
    await tick(window);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].values).toEqual({ rulebook: 'rb-1', definition: json, confirm: true });
  });

  test('a required choice with no options shows a clear empty state and cannot be sent; control: with options it can', async () => {
    const window = boot();
    const modal = window.LanaServerForm.open({ load: async () => adopt([]), submit: jest.fn() });
    await tick(window);
    expect(modal.querySelector('.server-form__description').textContent).toBe('Every supported state is adopted.');
    expect(modal.querySelector('lex-empty').getAttribute('message')).toBe('Nothing left to choose');
    // Reads for a plural label too ("Plan documents", found live): no "There is no ... documents".
    expect(modal.querySelector('lex-empty').getAttribute('description')).toBe('No state to choose right now.');
    expect(modal.querySelector('[data-field-id]')).toBeNull();
    expect(submitBtn(modal).hidden).toBe(true);
    expect(modal.querySelector('[data-server-form-action="close"]').textContent).toContain('Close');
    const open = window.LanaServerForm.open({ load: async () => adopt([{ value: 'US-GA', label: 'Georgia (US-GA)' }]), submit: jest.fn() });
    await tick(window);
    expect(open.querySelector('[data-field-id="jurisdiction"]')).not.toBeNull();
    expect(submitBtn(open).hidden).toBeFalsy();
  });
});

test('a context instant reads as a local date and time; control: other values stay as sent', async () => {
  const window = boot();
  const descriptor = { schema_version: 1, form_key: 'provider.decide', title: 'Decide', submit_label: 'Record', fields: [],
    binding: { subject: 'record:1', sha256: 'a'.repeat(64) },
    context: [{ label: 'Checked at', value: '2026-10-29T12:00:00-04:00' }, { label: 'Rulebook', value: 'Version 3' }, { label: 'Code', value: '2026-10-29' }] };
  const modal = window.LanaServerForm.open({ load: async () => descriptor, submit: jest.fn() });
  await tick(window);
  const values = [...modal.querySelectorAll('.server-form__context dd')].map((el) => el.textContent);
  expect(values[0]).toBe(window.Lex.Utils.formatDateTime('2026-10-29T12:00:00-04:00'));
  expect(values[0]).not.toContain('T12:00');
  expect(values.slice(1)).toEqual(['Version 3', '2026-10-29']);
});

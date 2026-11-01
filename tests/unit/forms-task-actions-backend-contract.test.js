'use strict';

/**
 * Server forms and task actions against the backend's own models.
 *
 * Loads the forms models (src/services/forms/server-form.models.js), the form
 * and task action route models, the task actions contract and view, and the
 * error handler from a LANA-AI checkout, and checks that:
 *   - the client renders exactly the backend's field kinds, and for every
 *     kind the value the client sends passes the backend's value schema (and
 *     reads back to the same raw input);
 *   - the client's request builders produce paths and bodies the route models
 *     accept (matter forms, task action start and form);
 *   - the task action payload the backend builds drives the client buttons,
 *     with the backend's startable statuses;
 *   - FORM_IN_PROGRESS, REQUEST_ID_REUSED and FORM_STALE as the real service
 *     and error handler answer them are classified as the client expects.
 * The backend is LANA_BACKEND_DIR when set, else the sibling worktree
 * .runtime/lana-estate-rulebook, else a sibling LANA-AI/. When none has the
 * models the suite is skipped with a message saying where it looked.
 */

const { findBackend, answerOf, hermeticTracing } = require('../fixtures/backend-checkout.js');
const F = require('../../src/js/shared/server-form-fields.js');
const P = require('../../src/js/shared/pending-submit.js');
global.LanaRunHistory = require('../../src/js/shared/run-history.js');
const TaskActions = require('../../src/js/shared/task-actions.js');
const MatterMakeupAPIClient = require('../../src/js/api/matter-makeup-api.client.js');

const FORM_MODELS = 'src/services/forms/server-form.models.js';
const FORM_ROUTE_MODELS = 'src/services/processor/forms/forms.models.js';
const TASK_ACTION_ROUTE_MODELS = 'src/services/processor/task-actions/task-actions.models.js';
const TASK_ACTION_CONTRACT = 'src/shared/contracts/task-actions.contract.js';
const TASK_ACTION_VIEWS = 'src/services/task-actions/task-action-views.js';
const FORMS_SERVICE = 'src/services/forms/server-forms.service.js';
const FORM_SUBMISSIONS_REPOSITORY = 'src/repositories/form-submissions.repository.js';
const TASK_ACTIONS_REPOSITORY = 'src/repositories/task-actions.repository.js';
const ERROR_HANDLER = 'src/shared/errors/error-handler.js';

const checkout = findBackend([FORM_MODELS, FORM_ROUTE_MODELS, TASK_ACTION_ROUTE_MODELS, TASK_ACTION_CONTRACT]);
const backendPath = checkout.path;
const backend = checkout.require;
const describeBackend = checkout.describe;

const TASK_ID = '0d4c1f7e-2b3a-4c5d-9e8f-a1b2c3d4e5f6';
const ACTION_ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const REQUEST_ID = '5f0c2b1a-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
const SUBJECT = 'task:' + TASK_ID;

const docRef = (id) => ({ kind: 'document_release', id, version: 1 });
const choices = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'Off', disabled: true }];
const records = [{ value: 'r1', label: 'Record 1' }, { value: 'r2', label: 'Record 2' }];
const versions = [{ value: 'v1', label: 'Will v1', reference: docRef('d1') }, { value: 'v2', label: 'Codicil v1', reference: docRef('d2') }];

// One field per kind, and the raw input a person would enter in its control.
const CASES = {
  text: [{ max_length: 40 }, 'Short answer'],
  textarea: [{}, 'A longer note.'],
  number: [{ min: 0, max: 10, integer: true }, '7'],
  money: [{ currency: 'USD' }, '1234.50'],
  date: [{}, '2026-10-31'],
  datetime: [{}, '2026-10-31T10:30'],
  select: [{ options: choices }, 'b'],
  multiselect: [{ options: choices }, ['a', 'b']],
  reference: [{ options: records, reference_kind: 'record' }, 'r2'],
  reference_set: [{ options: records, reference_kind: 'record' }, ['r1', 'r2']],
  allocation: [{ options: records, reference_kind: 'record' }, [{ ref: 'r1', percent: '60' }, { ref: 'r2', percent: '40' }]],
  document_versions: [{ options: versions }, ['v2']],
  evidence_sources: [{
    options: versions,
    evidence_classes: [{ value: 'identity', label: 'Identity' }],
    coverage_options: [{ value: 'full', label: 'Full' }],
  }, [{ source: 'v1', evidence_class: 'identity', coverage: 'full', observed_at: '2026-10-30T09:00', page: '2', quote: 'Signed' }]],
  confirm: [{}, true],
};

function fieldOf(kind) {
  return Object.assign({ id: kind + '_field', kind, label: kind.replace('_', ' '), required: true }, CASES[kind][0]);
}

function descriptorOf(fields) {
  return {
    schema_version: 1, form_key: 'task.complete_with_note', title: 'Complete task', description: 'Close it out.',
    context: [{ label: 'Task', value: 'Review the will', ref: { kind: 'task', id: TASK_ID } }],
    fields, submit_label: 'Complete', binding: { subject: SUBJECT, sha256: 'a'.repeat(64) },
  };
}

// Path parameters of a client request, by the route's own pattern.
function paramsOf(pattern, requestPath) {
  const [pathname, search] = requestPath.split('?');
  const names = [];
  const regex = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, (m, name) => { names.push(name); return '([^/]+)'; }) + '$');
  const match = pathname.match(regex);
  if (!match) return null;
  const params = {};
  names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
  const query = {};
  new URLSearchParams(search || '').forEach((value, key) => { query[key] = value; });
  return { params, query };
}

// The response the client's api.js turns into an ApiError: { status, code, data }.

describeBackend('server form field kinds against the backend form models', () => {
  let models;
  beforeAll(() => { models = backend(FORM_MODELS); });

  test('the client renders exactly the backend field kinds', () => {
    expect([...F.FIELD_KINDS].sort()).toEqual([...models.FIELD_KINDS].sort());
    expect(Object.keys(CASES).sort()).toEqual([...models.FIELD_KINDS].sort());
    expect(F.SCHEMA_VERSION).toBe(models.SCHEMA_VERSION);
  });

  test.each(Object.keys(CASES))('%s: the descriptor parses, the client value passes the backend schema and reads back', (kind) => {
    const field = fieldOf(kind);
    const descriptor = descriptorOf([field]);
    expect(models.descriptorSchema.safeParse(descriptor).success).toBe(true);
    expect(F.normalizeDescriptor(descriptor).ok).toBe(true);
    const wire = F.toWire(field, CASES[kind][1]);
    const parsed = models.valueSchemaFor(field).safeParse(wire);
    if (!parsed.success) throw new Error(kind + ': ' + JSON.stringify(parsed.error.issues));
    expect(F.toWire(field, F.fromWire(field, wire))).toEqual(wire);
  });

  test('allocation: shares positive and totalling exactly, 100% or the descriptor total_basis_points', () => {
    const part = { ...fieldOf('allocation'), total_basis_points: 5000 };
    expect(models.descriptorSchema.safeParse(descriptorOf([part])).success).toBe(true);
    const accept = (field, raw) => {
      const wire = F.toWire(field, raw);
      expect(models.valueSchemaFor(field).safeParse(wire).success).toBe(true);
      return wire;
    };
    expect(accept(part, [{ ref: 'r1', percent: '30' }, { ref: 'r2', percent: '20' }]).map((row) => row.share_basis_points)).toEqual([3000, 2000]);
    accept(fieldOf('allocation'), [{ ref: 'r1', percent: '33.33' }, { ref: 'r2', percent: '66.67' }]);
    // Refused by both: a total that is not exact, and a zero share.
    const refusedByBoth = (field, raw, wire, message) => {
      expect(() => F.toWire(field, raw)).toThrow(message);
      expect(models.valueSchemaFor(field).safeParse(wire).success).toBe(false);
    };
    refusedByBoth(part, [{ ref: 'r1', percent: '30' }, { ref: 'r2', percent: '30' }],
      [{ ref: { kind: 'record', id: 'r1' }, share_basis_points: 3000 }, { ref: { kind: 'record', id: 'r2' }, share_basis_points: 3000 }], 'add up to 50.00%');
    refusedByBoth(fieldOf('allocation'), [{ ref: 'r1', percent: '100' }, { ref: 'r2', percent: '0' }],
      [{ ref: { kind: 'record', id: 'r1' }, share_basis_points: 10000 }, { ref: { kind: 'record', id: 'r2' }, share_basis_points: 0 }], 'more than 0%');
  });

  test('a whole form: collect() values pass valuesSchemaFor, and the submit body passes submitBodySchema', async () => {
    const fields = Object.keys(CASES).map(fieldOf);
    const descriptor = descriptorOf(fields);
    const raws = {};
    fields.forEach((field) => { raws[field.id] = CASES[field.kind][1]; });
    const collected = F.collect(fields, raws);
    expect(collected.errors).toEqual({});
    const values = models.valuesSchemaFor(descriptor).safeParse(collected.values);
    if (!values.success) throw new Error(JSON.stringify(values.error.issues));

    // The body the pending-submit session sends (server-form.js submit).
    let sent = null;
    const session = P.createSubmitSession({ store: null, makeId: () => REQUEST_ID });
    await session.submit({ subject: SUBJECT, binding: descriptor.binding, values: collected.values }, async (body) => {
      sent = body;
      return { status: 'recorded', record_ref: { kind: 'task', id: TASK_ID }, message: 'Task completed.' };
    });
    expect(models.submitBodySchema.safeParse(sent).success).toBe(true);
    expect(models.isSame(sent.binding, descriptor.binding)).toBe(true);
  });

  test('a choice the client refuses is refused by the backend too (control arm: the listed one passes)', () => {
    const field = fieldOf('select');
    expect(() => F.toWire(field, 'c')).toThrow();
    expect(models.valueSchemaFor(field).safeParse('c').success).toBe(false);
    expect(models.valueSchemaFor(field).safeParse(F.toWire(field, 'a')).success).toBe(true);
    expect(() => F.toWire(fieldOf('confirm'), false)).toThrow();
    expect(models.valueSchemaFor(fieldOf('confirm')).safeParse(false).success).toBe(false);
  });
});

describeBackend('client request builders against the form and task action route models', () => {
  const requests = MatterMakeupAPIClient.requests;
  let forms;
  let taskActions;
  beforeAll(() => {
    forms = backend(FORM_ROUTE_MODELS);
    taskActions = backend(TASK_ACTION_ROUTE_MODELS);
  });

  test('matter form describe and submit', () => {
    const get = requests.form('M-1', 'task.complete_with_note', SUBJECT);
    const getParts = paramsOf('/api/v1/matters/:matter_id/forms/:form_key', get.path);
    expect(forms.getMatterFormSchema.params.safeParse(getParts.params).success).toBe(true);
    expect(forms.getMatterFormSchema.query.safeParse(getParts.query).success).toBe(true);
    const body = { request_id: REQUEST_ID, subject: SUBJECT, binding: { subject: SUBJECT, sha256: 'a'.repeat(64) }, values: {} };
    const post = requests.submitForm('M-1', 'task.complete_with_note', body);
    expect(post.method).toBe('POST');
    expect(forms.submitMatterFormSchema.params.safeParse(paramsOf('/api/v1/matters/:matter_id/forms/:form_key', post.path).params).success).toBe(true);
    expect(forms.submitMatterFormSchema.body.safeParse(post.body).success).toBe(true);
  });

  test('task action start, form and form submit', () => {
    const pattern = (suffix) => '/api/v1/tasks/:task_id/actions/:action_id/' + suffix;
    const start = requests.startTaskAction(TASK_ID, ACTION_ID, REQUEST_ID);
    expect(start.method).toBe('POST');
    expect(taskActions.startTaskActionSchema.params.safeParse(paramsOf(pattern('start'), start.path).params).success).toBe(true);
    expect(taskActions.startTaskActionSchema.body.safeParse(start.body).success).toBe(true);
    // The route refuses anything else in the body (control arm).
    expect(taskActions.startTaskActionSchema.body.safeParse(Object.assign({ extra: 1 }, start.body)).success).toBe(false);

    const form = requests.taskActionForm(TASK_ID, ACTION_ID);
    expect(form.method).toBe('GET');
    expect(taskActions.getTaskActionFormSchema.params.safeParse(paramsOf(pattern('form'), form.path).params).success).toBe(true);
    const submit = requests.submitTaskActionForm(TASK_ID, ACTION_ID, { request_id: REQUEST_ID, binding: { subject: SUBJECT, sha256: 'b'.repeat(64) }, values: { note: 'Done' } });
    expect(taskActions.submitTaskActionFormSchema.params.safeParse(paramsOf(pattern('form'), submit.path).params).success).toBe(true);
    expect(taskActions.submitTaskActionFormSchema.body.safeParse(submit.body).success).toBe(true);
  });
});

describeBackend('task action payloads against the backend contract and view', () => {
  let contract;
  let views;
  beforeAll(() => {
    contract = backend(TASK_ACTION_CONTRACT);
    jest.doMock(backendPath(TASK_ACTIONS_REPOSITORY), () => ({ listForTasks: async () => [] }));
    views = backend(TASK_ACTION_VIEWS);
  });

  test('the client knows every kind and enables exactly the startable statuses', () => {
    expect([...TaskActions.START_KINDS].sort()).toEqual([...contract.START_KINDS].sort());
    const task = { id: TASK_ID, actions: contract.TASK_ACTION_STATUSES.map((status, i) => ({ id: 'a' + i, kind: 'start_agent', label: status, status })) };
    const shown = TaskActions.actionViews(task);
    // A withdrawn action is not shown; every other status is.
    expect(shown.map((view) => view.status)).toEqual(contract.TASK_ACTION_STATUSES.filter((status) => status !== 'withdrawn'));
    expect(shown.filter((view) => view.pressable).map((view) => view.status).sort()).toEqual([...contract.STARTABLE_STATUSES].sort());
    contract.TASK_ACTION_KINDS.forEach((kind) => {
      expect(TaskActions.actionViews({ id: 't', actions: [{ id: 'x', kind, label: 'L', status: 'available' }] })).toHaveLength(1);
    });
  });

  test('toActionView output drives a button, and a start answer carrying it is confirmed', async () => {
    const row = {
      id: ACTION_ID, task_id: TASK_ID, kind: 'start_agent', label: 'Run review', status: 'running',
      last_start_id: 's1', last_run_kind: 'agent_run', last_run_id: 'r1', last_started_at: new Date('2026-10-31T10:00:00Z'), last_finished_at: null,
    };
    const action = views.toActionView(row);
    const [view] = TaskActions.actionViews({ id: TASK_ID, actions: [action] });
    expect(view).toMatchObject({ id: ACTION_ID, status: 'running', pressable: false, statusLabel: 'Running' });
    expect(view.lastRun).toMatch(/^Last run /);

    // POST .../start answers { outcome, action, run } (task-actions.service startAction).
    const client = { startTaskAction: jest.fn(async () => ({ outcome: 'started', action, run: { kind: 'agent_run', id: 'r1' } })) };
    TaskActions._resetSessions();
    const result = await TaskActions.startAction({ id: TASK_ID }, { id: ACTION_ID }, { client, scope: () => null, makeId: () => REQUEST_ID });
    expect(TaskActions.startAnswerView(result.response, 'Run review')).toMatchObject({ kind: 'success', action: { status: 'running' } });
  });
});

describeBackend('form refusals as the real service and error handler answer them', () => {
  const formsRepo = { claim: jest.fn(), record: jest.fn(), release: jest.fn() };
  let service;
  let tracer;
  let handler;
  let AppError;
  beforeAll(() => {
    jest.doMock(backendPath(FORM_SUBMISSIONS_REPOSITORY), () => formsRepo);
    // Hermetic: the tracer is in memory (its own tests' seam), never chat_traces.
    tracer = hermeticTracing(backendPath);
    service = backend(FORMS_SERVICE);
    handler = backend(ERROR_HANDLER);
    AppError = backend('src/shared/errors/app.error').AppError;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => { console.error.mockRestore(); expect(tracer.recorded).toEqual([]); });

  const viewer = { userId: 'u1', organizationId: 'o1', roleId: null, matter: { uuid: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', code: 'M-1' } };
  const body = { request_id: REQUEST_ID, subject: SUBJECT, binding: { subject: SUBJECT, sha256: 'a'.repeat(64) }, values: { note: 'Done' } };
  const sha = () => service._test.requestSha256({
    formKey: 'task.complete_with_note', subject: SUBJECT, matterUuid: viewer.matter.uuid, binding: body.binding, values: body.values,
  });

  async function refusalOf(storedRow) {
    formsRepo.claim.mockResolvedValueOnce({ claimed: false, row: storedRow });
    try {
      await service.submitForm({ formKey: 'task.complete_with_note', viewer, body });
    } catch (error) {
      return answerOf(handler, error);
    }
    throw new Error('The service did not refuse');
  }

  test('FORM_IN_PROGRESS carries error.retryable and keeps the request (resent with the same id)', async () => {
    const answer = await refusalOf({ request_sha256: sha(), form_key: 'task.complete_with_note', status: 'pending' });
    expect(answer).toMatchObject({ status: 409, code: 'FORM_IN_PROGRESS', data: { error: { retryable: true } } });
    expect(P.classifyError(answer)).toBe('in_progress');
    const session = P.createSubmitSession({ store: null, makeId: () => REQUEST_ID, retryDelays: [1], wait: async () => {} });
    const send = jest.fn(async () => { throw answer; });
    await expect(session.submit({ values: {} }, send)).rejects.toMatchObject({ submitOutcome: 'in_progress' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(session.pending().request_id).toBe(REQUEST_ID);
  });

  test('REQUEST_ID_REUSED is reused and drops the saved change (control arm: a recorded one replays)', async () => {
    const answer = await refusalOf({ request_sha256: 'f'.repeat(64), form_key: 'task.complete_with_note', status: 'recorded' });
    expect(answer).toMatchObject({ status: 409, code: 'REQUEST_ID_REUSED' });
    expect(answer.data.error.retryable).toBeUndefined();
    expect(P.classifyError(answer)).toBe('reused');

    formsRepo.claim.mockResolvedValueOnce({ claimed: false, row: { request_sha256: sha(), form_key: 'task.complete_with_note', status: 'recorded', record_ref: { kind: 'task', id: TASK_ID }, message: 'Task completed.' } });
    const replay = await service.submitForm({ formKey: 'task.complete_with_note', viewer, body });
    expect(P.RESULT_STATUSES).toContain(replay.status);
    expect(replay.status).toBe('replayed');
  });

  test('FORM_STALE is stale; a validation error names its field', () => {
    const stale = answerOf(handler, new AppError('This record changed since the form was opened.', 409, 'FORM_STALE'));
    expect(P.classifyError(stale)).toBe('stale');
    const { ValidationError } = backend('src/shared/errors/app.error');
    const invalid = answerOf(handler, new ValidationError('Too long', 'note'));
    expect(P.classifyError(invalid)).toBe('refused');
    expect(invalid.data.error.field).toBe('note');
  });

  test('ACTIVE_RUN_EXISTS from a task action carries details.active_run_id', () => {
    const error = new AppError('This agent is already running on this matter.', 409, 'ACTIVE_RUN_EXISTS');
    error.details = { active_run_id: 'r9', outcome: 'skipped_active_run' };
    const answer = answerOf(handler, error);
    expect(answer.data.error.details.active_run_id).toBe('r9');
    expect(TaskActions.startErrorView(answer).kind).toBe('info');
    expect(P.classifyError(answer)).toBe('refused');
  });
});

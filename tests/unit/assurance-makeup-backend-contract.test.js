'use strict';

/**
 * The folded Implementation Assurance page (design 8) against the backend's
 * own phase 7a and 7b code.
 *
 * Loads the estate makeup definition, the assurance tab providers
 * (assurance-makeup.providers.js) and form providers
 * (assurance-makeup.forms.js) from a LANA-AI checkout, runs them over the
 * real assurance service with the backend's in-memory repository double
 * (its tests/unit/services/implementation-assurance fixtures; every other
 * repository is mocked), and checks that:
 *   - every tab kind the makeup declares has a client renderer;
 *   - the Rulebook, Assets and Decisions content renders through the generic
 *     renderers with every row and action reachable, and nothing reads as an
 *     unknown kind;
 *   - every one of the 11 forms parses, renders one control per field, and
 *     every prefilled `value` reads back to a value the backend schema takes;
 *     a target with an allocation and a decision submit through the real
 *     server forms service from what the client sends;
 *   - 403 ASSURANCE_OPERATION_FORBIDDEN on open reads "Not permitted";
 *   - the Rulebook provider's note actions (the makeup view's note_actions)
 *     apply to a fact note about an asset, and 422
 *     ASSURANCE_NOTE_TARGET_AMBIGUOUS offers only error.details.candidates,
 *     each of which then opens;
 *   - an accepted closeout's Decisions row download is the provider's file,
 *     saved under its name;
 *   - an agent work proposal the backend schema accepts lists every task,
 *     note and reference;
 *   - the screenshot harness fixtures (tests/browser/matter-makeups.fixture.cjs)
 *     have the same shapes as the real content and descriptors.
 * The backend is found as in the other *-backend-contract suites
 * (tests/fixtures/backend-checkout.js); without one the suite is skipped.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { findBackend, answerOf, hermeticTracing } = require('../fixtures/backend-checkout.js');
const F = require('../../src/js/shared/server-form-fields.js');
const NoteActions = require('../../src/js/shared/note-actions.js');
const G = require('../../src/js/shared/matter-generic-tabs.js');
const ProposalOutline = require('../../src/js/shared/proposal-outline.js');
const MatterMakeupAPIClient = require('../../src/js/api/matter-makeup-api.client.js');
const { createFixtureApi } = require('../browser/matter-makeups.fixture.cjs');

const PROVIDERS = 'src/services/implementation-assurance/assurance-makeup.providers.js';
const FORMS = 'src/services/implementation-assurance/assurance-makeup.forms.js';
const MAKEUP = 'src/domains/legal/makeups/estate.makeup.json';
const FIXTURES = 'tests/unit/services/implementation-assurance/assurance-test-fixtures.js';
const MAKEUP_FIXTURES = 'tests/unit/services/implementation-assurance/assurance-makeup-fixtures.js';
const WORK_PROPOSAL = 'src/services/processor/task-plans/work-proposal.models.js';
const ARTIFACT_SERVICE = '@agents/src/services/agent-artifact.service.js';

const checkout = findBackend([PROVIDERS, FORMS, MAKEUP, FIXTURES, MAKEUP_FIXTURES, WORK_PROPOSAL, ARTIFACT_SERVICE]);
const backend = checkout.require;

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', rel), 'utf8');
const tick = (window, ms = 40) => new Promise((resolve) => window.setTimeout(resolve, ms));
const click = (window, el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const SCRIPTS = [
  'time-utils.js', 'lex/lex.core.js', 'lex/lex.icons.js', 'lex/lex.data.js', 'lex/lex.forms.js', 'lex/lex.utils.js',
  'lex/components/foundation/lex-btn.js', 'lex/components/foundation/lex-modal.js', 'lex/components/foundation/lex-empty.js',
  'lex/components/foundation/lex-spinner.js', 'lex/components/foundation/lex-badge.js',
  'lex/components/form/lex-input.js', 'lex/components/form/lex-textarea.js', 'lex/components/form/lex-select.js',
  'lex/components/form/lex-checkbox.js', 'lex/components/data/lex-table.js',
  'shared/form-values.js', 'shared/pending-submit.js', 'shared/server-form-fields.js', 'shared/server-form.js',
  'api/matter-makeup-api.client.js', 'shared/matter-tab-registry.js', 'shared/matter-generic-tabs.js',
];

function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="panels"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  window.console.log = () => {};
  window.console.warn = () => {};
  SCRIPTS.forEach((rel) => window.eval(read(rel)));
  return window;
}

// The shape of a value: keys and kinds, not the words (fixtures are fictional).
function shapeOf(value) {
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]));
  return typeof value;
}
const fieldShape = (descriptor) => descriptor.fields.map((field) => [field.id, field.kind]);

checkout.describe('the folded assurance page against backend phase 7b (with the applied-rulebook fixes)', () => {
  const notes = { findInMatter: jest.fn() };
  const links = { listLinks: jest.fn(), createLink: jest.fn(async () => ({ link: {} })) };
  const tasks = { getTask: jest.fn() };
  const submissions = { claim: jest.fn(), find: jest.fn(), record: jest.fn(), release: jest.fn() };
  let fx;
  let f;
  let service;
  let assets;
  let tabs;
  let forms;
  let models;
  let tabModels;
  let handler;
  let tracer;
  let viewer;
  let seeded;
  let requests = 9000;
  // The firm rulebooks the deployment pins: the rulebook the matter applies.
  let pinned;
  const nextRequest = () => fx.id(requests++);

  beforeAll(() => {
    const mocked = (relative, factory) => jest.doMock(checkout.path(relative), factory);
    mocked('src/repositories/form-submissions.repository', () => submissions);
    mocked('src/services/forms/providers', () => ({}));
    mocked('src/repositories/matter-notes.repository', () => notes);
    mocked('src/services/processor/matter-links/matter-links.service', () => links);
    mocked('src/services/processor/tasks/tasks.service', () => tasks);
    mocked('src/services/implementation-assurance/assurance.service', () => ({ getAssuranceServiceWithEngineTasks: jest.fn() }));
    mocked('src/services/processor/matter-assets/matter-assets.service', () => ({ createMatterAssetsService: jest.fn() }));
    mocked('src/shared/permissions/permission.utils', () => ({ hasPermission: jest.fn(async () => true) }));
    mocked('src/shared/logging/logger', () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn(), logDebug: jest.fn() }));
    tracer = hermeticTracing(checkout.path);
    fx = backend(FIXTURES);
    models = backend('src/services/forms/server-form.models.js');
    tabModels = backend('src/services/matter-makeups/tab-content.models.js');
    handler = backend('src/shared/errors/error-handler.js');
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => { expect(tracer.recorded).toEqual([]); console.error.mockRestore(); });

  // A matter with a pinned firm rulebook (owner and shares rules), a plan, two
  // targets on one asset, reviewed evidence for the first, an assessment and
  // its decision, and an unreviewed observation.
  beforeEach(async () => {
    jest.clearAllMocks();
    submissions.claim.mockResolvedValue({ claimed: true, row: { claim_token: 'token' } });
    submissions.record.mockResolvedValue({ status: 'recorded' });
    links.listLinks.mockResolvedValue([]);
    tasks.getTask.mockResolvedValue({ id: fx.id(800), title: 'Accept the estate plan' });
    f = backend(MAKEUP_FIXTURES).extendRepository(fx.fixture());
    const { actor, matterId, artifact, subject, value, definition } = fx;
    viewer = { userId: actor.userId, organizationId: actor.organizationId, roleId: actor.roleId, matter: { uuid: matterId, code: 'MATT-1' } };
    const shares = { ...definition.rules[0], id: 'firm.asset.shares', predicate: 'shares', value_kind: 'allocations' };
    const rulebook = await f.service.publishRulebook({ actor, expectedVersion: 0, definition: { ...definition, rules: [definition.rules[0], shares] } });
    const plan = await f.service.savePlan({ actor, matterId, expectedVersion: 0, releases: [artifact], rationale: 'Approved legal plan.' });
    const owner = await f.service.saveTarget({ actor, matterId, expectedVersion: 0, planRef: plan.reference, rulebookRef: rulebook.reference,
      ruleId: 'firm.asset.owner', subject, predicate: 'owner', value, rationale: 'Owner per plan.' });
    const shared = await f.service.saveTarget({ actor, matterId, expectedVersion: 0, planRef: plan.reference, rulebookRef: rulebook.reference,
      ruleId: 'firm.asset.shares', subject, predicate: 'shares',
      value: { kind: 'allocations', value: [{ beneficiary: { kind: 'contact', id: fx.id(7) }, share_basis_points: 10000 }] }, rationale: 'Shares per plan.' });
    const evidence = [{ artifact, evidence_class: 'authoritative_record', observed_at: '2026-10-15T12:00:00Z', coverage: 'complete' }];
    const observed = await f.service.recordObservation({ actor, matterId, expectedVersion: 0, subject, predicate: 'owner', value, evidence, validFrom: '2026-10-15T12:00:00Z', validUntil: null });
    await f.service.reviewObservation({ actor, matterId, id: observed.record.id, expectedVersion: 1, rationale: 'Reviewed.' });
    const assessment = await f.service.assess({ actor, matterId, targetId: owner.record.id, requestId: nextRequest() });
    await f.service.decide({ actor, matterId, targetId: owner.record.id, requestId: nextRequest(), expectedBinding: assessment.record.evaluation.binding,
      decision: 'accept_conclusion', rationale: 'Match confirmed.' });
    const fresh = await f.service.assess({ actor, matterId, targetId: owner.record.id, requestId: nextRequest() });
    const pending = await f.service.recordObservation({ actor, matterId, expectedVersion: 0, subject, predicate: 'shares',
      value: { kind: 'allocations', value: [{ beneficiary: { kind: 'contact', id: fx.id(7) }, share_basis_points: 10000 }] }, evidence, validFrom: '2026-10-15T12:00:00Z', validUntil: null });
    const closeout = await f.service.prepareCloseout({ actor, matterId, planId: plan.record.id, requestId: nextRequest() });
    seeded = { rulebook, plan, owner, shared, observed, assessment: fresh, pending, closeout };

    const { createImplementationAssuranceService } = backend('src/services/implementation-assurance/implementation-assurance.service.js');
    pinned = { jurisdictions: [], firm_rulebooks: [rulebook.reference] };
    service = createImplementationAssuranceService({ ...f.ports, resolveDeploymentContext: async () => pinned });
    const asset = { id: subject.id, description: 'Checking account', asset_classification: 'bank_account', asset_value: '1200.50',
      currency: 'USD', account_number_mask: '****1234', revision: '2026-10-29 12:00:00.000001+00' };
    assets = {
      list: jest.fn(async () => ({ assets: [asset], next_cursor: null })), get: jest.fn(async () => ({ ...asset })),
      create: jest.fn(), update: jest.fn(async () => ({ ...asset })), findCommand: jest.fn(async () => null),
    };
    const owners = { getService: () => service, getAssets: () => assets };
    const { createAssuranceTabs } = backend(PROVIDERS);
    tabs = Object.fromEntries(createAssuranceTabs({ ...owners, canRead: async () => true, enabled: () => true }).map((provider) => [provider.key.split('.')[1], provider]));
    const registry = backend('src/services/forms/form-provider-registry.js');
    backend(FORMS).createAssuranceForms(owners).forEach(registry.registerFormProvider);
    forms = backend('src/services/forms/server-forms.service.js');
  });

  const loadTab = async (name) => {
    const content = await tabs[name].load({ viewer, tab: { id: name }, cursor: null });
    expect(tabModels.tabContentSchema.safeParse(content).success).toBe(true);
    return content;
  };
  const describeForm = (name, subject) => forms.describeForm({ formKey: 'implementation_assurance.' + name, subject, viewer });
  const submitForm = (name, subject, body) => forms.submitForm({ formKey: 'implementation_assurance.' + name, viewer, body: { request_id: nextRequest(), subject, ...body } });

  test('every tab kind the makeup declares has a client renderer; its starter task opens a registered form', () => {
    const makeup = JSON.parse(fs.readFileSync(checkout.path(MAKEUP), 'utf8'));
    const window = boot();
    const registry = window.LanaMatterTabRegistry;
    // Built-in kinds are registered by workspace-details.js; the generic ones by matter-generic-tabs.js.
    const known = (kind) => registry.isKnownKind(kind) || Object.prototype.hasOwnProperty.call(registry.BUILT_IN_KINDS, kind);
    expect(makeup.tabs.filter((tab) => !known(tab.kind))).toEqual([]);
    expect(makeup.tabs.filter((tab) => tab.provider).map((tab) => tab.kind)).toEqual(['rulebook', 'records', 'ledger']);
    const keys = backend('src/services/forms/form-provider-registry.js').listFormProviderKeys();
    makeup.starter_tasks.flatMap((task) => task.actions).forEach((action) => expect(keys).toContain(action.form));
  });

  async function rendered(kind, content) {
    const window = boot();
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const [tab] = registry.buildTabs([{ id: kind, kind, label: kind }]);
    registry.ensurePanels(doc.getElementById('panels'), [tab]);
    const openForm = jest.fn();
    const client = { getTab: jest.fn(async () => ({ tab, available: true, ...content })) };
    registry.render(tab, { document: doc, matterId: 'MATT-1', client, openForm });
    await tick(window, 80);
    const panel = doc.getElementById('matterTabPanel-' + kind);
    const empty = panel.querySelector('lex-empty');
    expect(empty ? empty.getAttribute('message') : null).not.toBe(registry.NEWER_VERSION);
    return { window, panel, openForm };
  }

  // Every action button opens exactly the backend's action.
  function pressAll(window, panel, openForm, expected) {
    const buttons = [...panel.querySelectorAll('lex-btn[data-tab-action]')];
    buttons.forEach((button) => click(window, button));
    expect(openForm.mock.calls.map((call) => call[0])).toEqual(expected);
  }

  test('Rulebook: targets and rule groups render with badges and citations; every action opens its form', async () => {
    const content = await loadTab('rulebook');
    expect(content.groups[0].id).toBe('targets');
    expect(content.groups.slice(1).every((group) => group.id.startsWith('module:'))).toBe(true);
    const { window, panel, openForm } = await rendered('rulebook', content);
    expect([...panel.querySelectorAll('.matter-generic-tab__group-title')].map((el) => el.textContent)).toEqual(content.groups.map((group) => group.title));
    expect(panel.querySelectorAll('.matter-generic-tab__row')).toHaveLength(content.groups.reduce((sum, group) => sum + group.rows.length, 0));
    expect(panel.querySelectorAll('lex-badge').length).toBe(content.groups.flatMap((group) => group.rows).reduce((sum, row) => sum + (row.badges || []).length, 0));
    const expected = [...content.actions, ...content.groups.flatMap((group) => group.rows.flatMap((row) => row.actions || []))];
    // Header actions come first in the DOM, then rows in order.
    pressAll(window, panel, openForm, expected);
    expect(expected.map((action) => action.id)).toEqual(expect.arrayContaining(['adopt_rulebook', 'record_evidence', 'check_evidence', 'change_target', 'set_target']));
  });

  test('Assets: a lex-table of the server columns with Change and Add asset', async () => {
    const content = await loadTab('assets');
    const { window, panel, openForm } = await rendered('records', content);
    const table = panel.querySelector('lex-table');
    expect(table.getAttribute('columns')).toBe('description,type,value,account,actions');
    expect(panel.textContent).toContain('Checking account');
    pressAll(window, panel, openForm, [...content.actions, ...content.rows.flatMap((row) => row.actions)]);
  });

  test('Decisions: ledger entries with outcome, references and reviewer; Accept plan and Prepare closeout', async () => {
    const content = await loadTab('decisions');
    expect(content.rows.map((row) => row.title)).toEqual(['Finding accepted', 'Evidence reviewed', 'Target accepted', 'Target accepted', 'Plan accepted']);
    const { window, panel, openForm } = await rendered('ledger', content);
    expect(panel.querySelectorAll('.matter-generic-tab__row')).toHaveLength(content.rows.length);
    expect(panel.querySelectorAll('.matter-generic-tab__ref')).toHaveLength(content.rows.reduce((sum, row) => sum + row.references.length, 0));
    expect(panel.textContent).toContain('Pat Reviewer');
    pressAll(window, panel, openForm, content.actions);
    expect(content.actions.map((action) => action.id)).toEqual(['accept_plan', 'prepare_closeout']);
  });

  // Every form, with a subject it takes.
  const SUBJECTS = () => ({
    create_asset: 'matter:' + fx.matterId,
    update_asset: 'matter_asset:' + fx.subject.id,
    accept_plan: 'assurance_record:' + seeded.plan.record.id,
    adopt_rulebook: 'matter:' + fx.matterId,
    accept_target: 'assurance_record:' + seeded.shared.record.id,
    record_observation: 'assurance_record:' + seeded.observed.record.id,
    review_observation: 'assurance_record:' + seeded.pending.record.id,
    assess: 'assurance_record:' + seeded.owner.record.id,
    decide: 'assurance_record:' + seeded.assessment.record.id,
    prepare_closeout: 'matter:' + fx.matterId,
    accept_closeout: 'assurance_record:' + seeded.closeout.record.id,
    // The firm's own rulebook form (coordinator decision after 7b), once the backend registers it.
    ...(backend('src/services/forms/form-provider-registry.js').listFormProviderKeys().includes('implementation_assurance.publish_rulebook')
      ? { publish_rulebook: 'matter:' + fx.matterId } : {}),
  });

  test('every form parses, renders one control per field, and every prefill reads back to a value the backend takes', async () => {
    const window = boot();
    const subjects = SUBJECTS();
    expect(Object.keys(subjects).sort()).toEqual(backend('src/services/forms/form-provider-registry.js').listFormProviderKeys()
      .filter((key) => key.startsWith('implementation_assurance.')).map((key) => key.split('.')[1]).sort());
    const prefilled = [];
    for (const [name, subject] of Object.entries(subjects)) {
      // eslint-disable-next-line no-await-in-loop
      const descriptor = await describeForm(name, subject);
      expect(F.normalizeDescriptor(descriptor)).toMatchObject({ ok: true });
      const host = window.document.createElement('div');
      window.LanaServerForm.renderForm(host, descriptor, null);
      expect(host.querySelectorAll('[data-field-id]')).toHaveLength(descriptor.fields.length);
      descriptor.fields.filter((field) => field.value !== undefined).forEach((field) => {
        const wire = F.toWire(field, F.fromWire(field, field.value));
        expect(models.valueSchemaFor(field).safeParse(wire).success).toBe(true);
        prefilled.push(name + '.' + field.id);
      });
    }
    // The revision prefills: plan documents, target plan, asset and shares, evidence sources and dates.
    expect(prefilled).toEqual(expect.arrayContaining(['update_asset.asset_value', 'accept_plan.releases', 'accept_target.plan', 'accept_target.asset',
      'accept_target.value', 'record_observation.value', 'record_observation.evidence', 'record_observation.valid_from', 'prepare_closeout.plan']));
    expect((await describeForm('assess', subjects.assess)).fields).toEqual([]);
  });

  test('a target with an allocation and a decision submit from what the client sends', async () => {
    const target = await describeForm('accept_target', 'rulebook_rule:' + seeded.rulebook.record.id + ':firm.asset.shares');
    const value = target.fields.find((field) => field.id === 'value');
    expect(value).toMatchObject({ kind: 'allocation', item_label: 'Beneficiary', reference_kind: 'contact' });
    const raws = { plan: seeded.plan.record.id, asset: fx.subject.id, value: [{ ref: fx.id(7), percent: '100' }], rationale: 'Shares per plan.', confirm: true };
    const sent = F.collect(target.fields, raws);
    expect(sent.errors).toEqual({});
    expect(sent.values.value).toEqual([{ ref: { kind: 'contact', id: fx.id(7) }, share_basis_points: 10000 }]);
    const subject = 'rulebook_rule:' + seeded.rulebook.record.id + ':firm.asset.shares';
    expect(await submitForm('accept_target', subject, { binding: target.binding, values: sent.values })).toMatchObject({ status: 'recorded', record_ref: { kind: 'assurance_record' } });

    const decide = await describeForm('decide', 'assurance_record:' + seeded.assessment.record.id);
    const decision = F.collect(decide.fields, { decision: 'accept_conclusion', rationale: 'Checked the record.', confirm: true });
    expect(decision.errors).toEqual({});
    expect(await submitForm('decide', 'assurance_record:' + seeded.assessment.record.id, { binding: decide.binding, values: decision.values }))
      .toMatchObject({ status: 'recorded', record_ref: { kind: 'assurance_decision' } });
  });

  test('403 ASSURANCE_OPERATION_FORBIDDEN on open reads "Not permitted" with the server message', async () => {
    f.ports.authorizeProfessional.mockResolvedValue(false);
    const refusal = await describeForm('decide', 'assurance_record:' + seeded.assessment.record.id).catch((error) => error);
    expect(refusal).toMatchObject({ statusCode: 403, code: 'ASSURANCE_OPERATION_FORBIDDEN' });
    const answered = answerOf(handler, refusal);
    const window = boot();
    const modal = window.LanaServerForm.open({ load: async () => { throw answered; }, submit: jest.fn() });
    await tick(window);
    expect(modal.heading).toBe('Not permitted');
    expect(modal.querySelector('lex-empty').getAttribute('message')).toBe('Recording a decision needs the professional review permission.');
  });

  test('a fact note about an asset with two targets: the note action applies, 422 offers only the candidates, each opens with its sources', async () => {
    const noteId = fx.id(600);
    notes.findInMatter.mockResolvedValue({ id: noteId, title: 'Bank letter', label: 'fact' });
    const noteLinks = [
      { id: 'l1', link_type: 'about', source: { kind: 'matter_note', id: noteId }, target: { kind: 'matter_asset', id: fx.subject.id } },
      { id: 'l2', link_type: 'cites', source: { kind: 'matter_note', id: noteId }, target: { kind: 'document', id: fx.id(20), release_id: fx.artifact.id, version: 1 } },
    ];
    links.listLinks.mockResolvedValue(noteLinks);
    const note = { note_id: noteId, label: 'fact', links: noteLinks };
    const noteActions = await tabs.rulebook.noteActions(viewer);
    expect(tabModels.noteActionSchema.array().safeParse(noteActions).success).toBe(true);
    const [action] = NoteActions.actionsFor(note, noteActions);
    expect(action).toMatchObject({ id: 'record_evidence', form: 'implementation_assurance.record_observation' });
    // Control: an open question about the same asset gets no action.
    expect(NoteActions.actionsFor({ ...note, label: 'open_question' }, noteActions)).toEqual([]);

    const refusal = await describeForm('record_observation', NoteActions.subjectFor(action, noteId)).catch((error) => error);
    expect(refusal).toMatchObject({ statusCode: 422, code: 'ASSURANCE_NOTE_TARGET_AMBIGUOUS' });
    const choice = NoteActions.candidateChoice(answerOf(handler, refusal));
    expect(choice.choices.map((option) => option.value).sort()).toEqual(
      [seeded.owner.record.id, seeded.shared.record.id].map((id) => 'matter_note:' + noteId + ':' + id).sort());
    expect(choice.choices.every((option) => option.label.startsWith('Checking account: '))).toBe(true);
    for (const option of choice.choices) {
      // eslint-disable-next-line no-await-in-loop
      const descriptor = await describeForm('record_observation', option.value);
      expect(descriptor.binding.subject).toBe(option.value);
      const sources = descriptor.fields.find((field) => field.id === 'evidence');
      expect(F.fromWire(sources, sources.value).map((row) => row.source)).toEqual([fx.artifact.id]);
    }
    // Control: a note not about a target gets no choice.
    links.listLinks.mockResolvedValue([]);
    const notAbout = await describeForm('record_observation', NoteActions.subjectFor(action, noteId)).catch((error) => error);
    expect(notAbout.code).toBe('ASSURANCE_NOTE_NOT_ABOUT_TARGET');
    expect(NoteActions.candidateChoice(answerOf(handler, notAbout))).toBeNull();
    // A viewer without write is offered no note action.
    service = { ...service, actionPermissions: async () => ({ read: true, write: false, review: false, publishRulebook: false }) };
    expect(NoteActions.actionsFor(note, await tabs.rulebook.noteActions(viewer))).toEqual([]);
  });

  test('an accepted closeout offers its package on the Decisions row; the client saves the provider file under its name', async () => {
    // Every in-scope target needs a decision first: the shares target takes an exception.
    const { actor, matterId } = fx;
    const shares = await f.service.assess({ actor, matterId, targetId: seeded.shared.record.id, requestId: nextRequest() });
    await f.service.decide({ actor, matterId, targetId: seeded.shared.record.id, requestId: nextRequest(), expectedBinding: shares.record.evaluation.binding,
      decision: 'accept_exception', rationale: 'Shares confirmed by phone; letter to follow.' });
    const closeout = await f.service.prepareCloseout({ actor, matterId, planId: seeded.plan.record.id, requestId: nextRequest() });
    const closeoutSubject = 'assurance_record:' + closeout.record.id;
    const accept = await describeForm('accept_closeout', closeoutSubject);
    const sent = F.collect(accept.fields, { rationale: 'Plan targets reviewed.', confirm: true });
    expect(sent.errors).toEqual({});
    expect(await submitForm('accept_closeout', closeoutSubject, { binding: accept.binding, values: sent.values })).toMatchObject({ status: 'recorded' });
    const content = await loadTab('decisions');
    const row = content.rows.find((item) => (item.downloads || []).length);
    const download = row.downloads[0];
    expect(row.downloads).toEqual([{ id: 'closeout:' + closeout.record.id, label: expect.any(String) }]);
    expect(tabModels.DOWNLOAD_REF.test(download.id)).toBe(true);

    const window = boot();
    window.URL.createObjectURL = jest.fn(() => 'blob:x');
    window.URL.revokeObjectURL = jest.fn();
    const saved = [];
    window.HTMLAnchorElement.prototype.click = function () { saved.push(this.download); };
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const [tab] = registry.buildTabs([{ id: 'decisions', kind: 'ledger', label: 'Decisions' }]);
    registry.ensurePanels(doc.getElementById('panels'), [tab]);
    let body = null;
    const downloadTabFile = jest.fn(async (matterId, tabId, ref) => {
      const file = await tabs.decisions.download({ viewer, tab: { id: tabId }, ref });
      body = file.body;
      return { blob: new window.Blob([JSON.stringify(file.body)], { type: 'application/json' }), filename: file.filename };
    });
    registry.render(tab, { document: doc, matterId: 'MATT-1', client: { getTab: jest.fn(async () => ({ tab, available: true, ...content })), downloadTabFile }, openForm: jest.fn() });
    await tick(window, 80);
    click(window, doc.querySelector('[data-tab-download]'));
    await tick(window, 80);
    expect(downloadTabFile).toHaveBeenCalledWith('MATT-1', 'decisions', download.id);
    expect(body.record.id).toBe(closeout.record.id);
    expect(saved).toEqual(['closeout-' + closeout.record.id + '.json']);
    expect(doc.querySelector('[data-tab-download-notice]')).toBeNull();
    // Control: a ref of another kind is not a file.
    expect(await tabs.decisions.download({ viewer, tab: { id: 'decisions' }, ref: 'plan:' + seeded.plan.record.id })).toBeNull();
  });

  test('a work proposal the backend accepts lists every task, note and reference; the approval payload carries what the page reads', () => {
    const { workProposalSchema } = backend(WORK_PROPOSAL);
    const proposal = workProposalSchema.parse(createFixtureApi(Date.parse('2026-10-31T12:00:00Z')).data.workProposal);
    const view = ProposalOutline.outline(proposal);
    expect(view.tasks).toHaveLength(proposal.tasks.length);
    expect(view.notes.items).toHaveLength(proposal.summary.items.length);
    expect(view.tasks.map((task) => task.chips.length)).toEqual(proposal.tasks.map((task) => task.about.length + task.resolves.length));
    expect(view.notes.items.map((item) => item.chips.length)).toEqual(proposal.summary.items.map((item) => item.about.length));
    expect(view.notes.items.map((item) => item.labelText)).toEqual(['Fact', 'Open question']);
    // The Core approval for an agent artifact (agent-artifact.service createApproval payload).
    const source = fs.readFileSync(checkout.path(ARTIFACT_SERVICE), 'utf8');
    const create = source.indexOf('approvalsService.createApproval(');
    const payload = source.slice(create, source.indexOf('legal_approval: {', create));
    ['artifact_id: artifact.id', 'run_id: input.runId'].forEach((key) => expect(payload).toContain(key));
    // `content` is the normalized (parsed) proposal, so the page reads payload.content directly.
    expect(payload).toMatch(/\n\s*content,\n/);
    expect(source.slice(source.lastIndexOf('const content', create), create)).toMatch(/^const content = normalizeAgentArtifactContent\(input\.kind, /);
    expect(ProposalOutline.outline(proposal).tasks).toHaveLength(proposal.tasks.length);
    const contracts = backend('@agents/src/templates/output-contracts.js');
    const kinds = Object.values(contracts.CONTRACTS || contracts).filter((entry) => entry && entry.artifacts && entry.artifacts.estate_work_proposal);
    kinds.forEach((entry) => expect(entry.artifacts.estate_work_proposal.application).toMatchObject({ apply_target_type: 'matter.work_proposal', approval: 'batch' }));
  });

  // A form opened and sent through the real server forms service, as the client runs it.
  function openThroughService(window, name, subject) {
    const load = () => describeForm(name, subject).catch((error) => { throw answerOf(handler, error); });
    const submit = (body) => forms.submitForm({ formKey: 'implementation_assurance.' + name, viewer, body }).catch((error) => { throw answerOf(handler, error); });
    return window.LanaServerForm.open({ load, submit, subject });
  }

  test('422 ASSURANCE_RULEBOOK_NOT_APPLIED shows the server message on submit and on open; control: applied, the same form records', async () => {
    const window = boot();
    const subject = 'rulebook_rule:' + seeded.rulebook.record.id + ':firm.asset.owner';
    const fill = (modal) => {
      const field = (id) => modal.querySelector('[data-field-id="' + id + '"]');
      field('plan').value = seeded.plan.record.id;
      field('asset').value = fx.subject.id;
      field('value').value = fx.id(7);
      field('rationale').value = 'Owner per plan.';
      field('confirm').checked = true;
      modal.querySelector('[data-server-form-action="submit"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    };
    const modal = openThroughService(window, 'accept_target', subject);
    await tick(window, 80);
    expect(modal.heading).not.toBe('Form unavailable');
    const applied = pinned;
    pinned = { jurisdictions: [], firm_rulebooks: [] };
    const refusal = await describeForm('accept_target', subject).catch((error) => error);
    expect(refusal).toMatchObject({ statusCode: 422, code: 'ASSURANCE_RULEBOOK_NOT_APPLIED' });
    fill(modal);
    await tick(window, 120);
    const notice = modal.querySelector('[data-server-form-notice]');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(refusal.message);
    const reopened = openThroughService(window, 'accept_target', subject);
    await tick(window, 80);
    expect(reopened.heading).toBe('Form unavailable');
    expect(reopened.querySelector('lex-empty').getAttribute('message')).toBe(refusal.message);
    // Control: once the deployment pins it again, the same subject opens and records.
    pinned = applied;
    const again = openThroughService(window, 'accept_target', subject);
    await tick(window, 80);
    fill(again);
    await tick(window, 120);
    expect(again.querySelector('[data-server-form-notice]').textContent).toBe('Target accepted.');
  });

  test('target rows without Change target (their rulebook no longer applied) render, and every action they still offer opens; control: applied, they offer it', async () => {
    const targetActions = (content) => content.groups[0].rows.flatMap((row) => (row.actions || []).map((action) => action.id));
    expect(targetActions(await loadTab('rulebook'))).toContain('change_target');
    pinned = { jurisdictions: [], firm_rulebooks: [] };
    const content = await loadTab('rulebook');
    expect(content.groups[0].id).toBe('targets');
    expect(targetActions(content)).not.toContain('change_target');
    expect(targetActions(content).length).toBeGreaterThan(0);
    const { window, panel, openForm } = await rendered('rulebook', content);
    expect(panel.querySelectorAll('.matter-generic-tab__row')).toHaveLength(content.groups.reduce((sum, group) => sum + group.rows.length, 0));
    pressAll(window, panel, openForm, [...(content.actions || []), ...content.groups.flatMap((group) => group.rows.flatMap((row) => row.actions || []))]);
  });

  test('publish_rulebook: select new or the firm rulebook, a document-sized JSON field, confirm; what the client sends publishes', async () => {
    const window = boot();
    const descriptor = await describeForm('publish_rulebook', 'matter:' + fx.matterId);
    expect(fieldShape(descriptor)).toEqual([['rulebook', 'select'], ['definition', 'textarea'], ['confirm', 'confirm']]);
    const host = window.document.createElement('div');
    window.LanaServerForm.renderForm(host, descriptor, null);
    const definition = host.querySelector('[data-field-id="definition"]');
    expect(definition.classList.contains('server-form__field--document')).toBe(true);
    expect(definition.maxlength).toBe(400000);
    expect(definition.showCount).toBe(true);
    const select = descriptor.fields[0];
    expect(select.value).toBe('new');
    expect(select.options.map((option) => option.value)).toEqual(['new', seeded.rulebook.record.id]);
    const json = JSON.stringify({ ...fx.definition, rules: [{ ...fx.definition.rules[0], id: 'firm.asset.owner' }] }, null, 2);
    const sent = F.collect(descriptor.fields, { rulebook: seeded.rulebook.record.id, definition: json, confirm: true });
    expect(sent.errors).toEqual({});
    expect(await submitForm('publish_rulebook', 'matter:' + fx.matterId, { binding: descriptor.binding, values: sent.values })).toMatchObject({ status: 'recorded' });
    // Control: text past the field's own max_length is caught before it is sent.
    expect(F.collect(descriptor.fields, { rulebook: 'new', definition: 'x'.repeat(400001), confirm: true }).errors).toHaveProperty('definition');
  });

  test('a closeout that was prepared but not accepted is not a file: the row shows the server 404 CLOSEOUT_NOT_ACCEPTED message', async () => {
    const ref = 'closeout:' + seeded.closeout.record.id;
    const refused = await tabs.decisions.download({ viewer, tab: { id: 'decisions' }, ref }).then(() => null, (error) => error);
    expect(refused).toMatchObject({ statusCode: 404, code: 'CLOSEOUT_NOT_ACCEPTED' });
    const answered = answerOf(handler, refused);
    expect(answered.status).toBe(404);
    expect(G.downloadMessage(answered)).toBe(refused.message);
    // Control: any other 404 reads as gone, not as the closeout wording.
    const { NotFoundError } = backend('src/shared/errors/app.error.js');
    expect(G.downloadMessage(answerOf(handler, new NotFoundError('Download')))).toBe(G.DOWNLOAD_MESSAGES.notFound);
    const window = boot();
    const registry = window.LanaMatterTabRegistry;
    const doc = window.document;
    const [tab] = registry.buildTabs([{ id: 'decisions', kind: 'ledger', label: 'Decisions' }]);
    registry.ensurePanels(doc.getElementById('panels'), [tab]);
    // A row read before the closeout lost its offer (or any stale ref) still names the ref.
    const content = { rows: [{ id: 'd1', title: 'Closeout', downloads: [{ id: ref, label: 'Download closeout package' }] }] };
    const downloadTabFile = jest.fn(async () => { throw answered; });
    registry.render(tab, { document: doc, matterId: 'MATT-1', client: { getTab: jest.fn(async () => ({ tab, available: true, ...content })), downloadTabFile }, openForm: jest.fn() });
    await tick(window, 80);
    click(window, doc.querySelector('[data-tab-download]'));
    await tick(window, 80);
    expect(doc.querySelector('[data-tab-download-notice]').textContent).toBe(refused.message);
  });

  test('the screenshot harness fixtures have the real shapes', async () => {
    const harness = createFixtureApi(Date.parse('2026-10-31T12:00:00Z')).data;
    const real = { rulebook: await loadTab('rulebook'), assets: await loadTab('assets'), decisions: await loadTab('decisions') };
    const rowsOf = (content) => [...(content.rows || []), ...(content.groups || []).flatMap((group) => group.rows)];
    // Keys the provider adds only for a record this seed has not made (an accepted closeout's scope details).
    const NOT_SEEDED = { decisions: ['details', 'downloads'] };
    Object.keys(real).forEach((name) => {
      const fixture = harness.tabContent[name];
      expect(tabModels.tabContentSchema.safeParse(fixture).success).toBe(true);
      expect(Object.keys(fixture).sort()).toEqual(Object.keys(real[name]).sort());
      const realKeys = new Set(rowsOf(real[name]).flatMap(Object.keys));
      expect(rowsOf(fixture).flatMap(Object.keys).filter((key) => !realKeys.has(key) && !(NOT_SEEDED[name] || []).includes(key))).toEqual([]);
      const realActions = new Set([...(real[name].actions || []), ...rowsOf(real[name]).flatMap((row) => row.actions || [])].map((action) => action.id + '>' + action.form));
      [...(fixture.actions || []), ...rowsOf(fixture).flatMap((row) => row.actions || [])].forEach((action) => expect(realActions).toContain(action.id + '>' + action.form));
    });
    expect(real.assets.columns).toEqual(harness.tabContent.assets.columns);
    expect(harness.makeup.note_actions).toEqual(await tabs.rulebook.noteActions(viewer));
    expect(shapeOf(harness.tabContent.rulebook.groups[0].rows[0])).toEqual(shapeOf(real.rulebook.groups[0].rows[0]));
    const subjects = SUBJECTS();
    notes.findInMatter.mockResolvedValue({ id: fx.id(600), title: 'Bank letter', label: 'fact' });
    // The note names a target it is about (through its asset), as the server now checks.
    links.listLinks.mockResolvedValue([{ id: 'l1', link_type: 'about', source: { kind: 'matter_note', id: fx.id(600) }, target: { kind: 'matter_asset', id: fx.subject.id } }]);
    for (const name of ['accept_plan', 'accept_target', 'record_observation', 'decide', 'publish_rulebook']) {
      const subject = {
        accept_target: 'rulebook_rule:' + seeded.rulebook.record.id + ':firm.asset.shares',
        record_observation: 'matter_note:' + fx.id(600) + ':' + seeded.owner.record.id,
      }[name] || subjects[name];
      // eslint-disable-next-line no-await-in-loop
      const descriptor = await describeForm(name, subject);
      const fixture = harness.forms['implementation_assurance.' + name];
      expect(models.descriptorSchema.safeParse(fixture).success).toBe(true);
      expect(fieldShape(fixture)).toEqual(fieldShape(descriptor));
    }
  });
});

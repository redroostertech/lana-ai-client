// Synthetic API for the matter makeups client (design 4.1 to 4.4, 7). Shapes follow
// src/js/api/matter-makeup-api.client.js, matter-links-api.client.js and
// matter-notes-api.client.js. Every name, account and document is fictional.
// This proves the page renders the documented contracts; it does not prove the backend.
'use strict';

const MATTER_ID = 'MATT-02417';
const MATTER_UUID = '7e1c5f0e-7d2b-4c1a-9e3f-2b7d1c0e4a17';
const ORG_ID = 'org-fixture-1';
const USER = { id: 'user-avery', first_name: 'Avery', last_name: 'Quill', email: 'avery.quill@example.test', organization_id: ORG_ID, roles: ['org_admin'] };
const RULEBOOK_ID = 'rb-firm-4c2e';
const CLOSEOUT_ID = 'e0c1d2e3-4444-4ddd-8eee-000000000021';
// LANA's shipped Indiana starter (rulebook-starter.repository starterReference):
// rule links made while the matter applied it pin it (link-kinds.contract rulePinTarget).
const STARTER = { id: 'estate-starter-us-in', version: '0.2.0-draft', sha256: 'c2b12a3cff531ecf2556e055a5195ab1deb22300d332f09fa5c4f038d1cfc54b' };
const starterRule = (id, outdated) => ({ kind: 'rulebook_rule', id, rulebook_basis: 'starter', starter_id: STARTER.id, starter_version: STARTER.version,
  starter_sha256: STARTER.sha256, jurisdiction: 'US-IN', pin_outdated: outdated });

function createFixtureApi(now = Date.now()) {
  const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
  const ahead = (days) => new Date(now + days * 86400000).toISOString().slice(0, 10);
  const calls = [];
  const unhandled = [];

  const contacts = [
    { id: 'contact-juniper', display_name: 'Juniper Fairweather', first_name: 'Juniper', last_name: 'Fairweather', email: 'juniper@example.test', role: 'Grantor' },
    { id: 'contact-rowan', display_name: 'Rowan Fairweather', first_name: 'Rowan', last_name: 'Fairweather', email: 'rowan@example.test', role: 'Successor trustee' },
    { id: 'contact-sample-bank', display_name: 'Sample Savings Bank, trust desk', email: 'trustdesk@example.test', role: 'Institution' }
  ];

  const matter = {
    id: MATTER_UUID,
    matter_id: MATTER_ID,
    name: 'Fairweather Revocable Trust funding',
    matter_name: 'Fairweather Revocable Trust funding',
    client_name: 'Juniper Fairweather',
    status: 'active',
    practice_area: 'Trusts and estates',
    matter_type: 'Trust funding',
    description: 'Fund the Juniper Fairweather Revocable Trust (Indianapolis): retitle the Marion County residence, update IRA and life insurance beneficiary designations, retitle the joint checking account.',
    responsible_attorney: 'Avery Quill',
    open_date: ago(60 * 24 * 21),
    created_at: ago(60 * 24 * 21),
    updated_at: ago(45),
    contacts,
    notes: []
  };

  const documents = [
    { id: 'doc-trust', title: 'Fairweather Revocable Trust Agreement (signed).pdf', original_filename: 'Fairweather Revocable Trust Agreement (signed).pdf', file_type: 'pdf', mime_type: 'application/pdf', file_size: 412311, created_at: ago(60 * 24 * 20), updated_at: ago(60 * 24 * 20), status: 'processed', processing_status: 'completed' },
    { id: 'doc-deed', title: 'Transfer on death deed, Marion County (recorded).pdf', original_filename: 'Transfer on death deed, Marion County (recorded).pdf', file_type: 'pdf', mime_type: 'application/pdf', file_size: 188020, created_at: ago(60 * 24 * 9), updated_at: ago(60 * 24 * 9), status: 'processed', processing_status: 'completed' },
    { id: 'doc-ira-bene', title: 'IRA beneficiary confirmation, Example Brokerage.pdf', original_filename: 'IRA beneficiary confirmation, Example Brokerage.pdf', file_type: 'pdf', mime_type: 'application/pdf', file_size: 90551, created_at: ago(60 * 24 * 4), updated_at: ago(60 * 24 * 4), status: 'processed', processing_status: 'completed' },
    { id: 'doc-policy', title: 'Sample Mutual Life policy statement.pdf', original_filename: 'Sample Mutual Life policy statement.pdf', file_type: 'pdf', mime_type: 'application/pdf', file_size: 120400, created_at: ago(60 * 24 * 3), updated_at: ago(60 * 24 * 3), status: 'processed', processing_status: 'completed' }
  ];

  const releases = [
    { id: 'rel-trust-1', label: 'Executed trust agreement', reference: { id: 'rel-trust-1', version: 1 }, sourceDocumentId: 'doc-trust', releasedDocumentId: 'doc-trust', retained: true },
    { id: 'rel-deed-1', label: 'Recorded deed, instrument 2026-118204', reference: { id: 'rel-deed-1', version: 1 }, sourceDocumentId: 'doc-deed', releasedDocumentId: 'doc-deed', retained: true },
    { id: 'rel-deed-2', label: 'Recorded deed with county stamp page', reference: { id: 'rel-deed-2', version: 2 }, sourceDocumentId: 'doc-deed', releasedDocumentId: 'doc-deed', retained: true },
    { id: 'rel-ira-1', label: 'Brokerage confirmation letter', reference: { id: 'rel-ira-1', version: 1 }, sourceDocumentId: 'doc-ira-bene', releasedDocumentId: 'doc-ira-bene', retained: true }
  ];

  const assets = [
    { id: 'asset-house', description: 'Residence, 1400 block of Example Ave, Indianapolis (Marion County)', asset_classification: 'real_property', asset_value: 41500000, currency: 'USD' },
    { id: 'asset-ira-1', description: 'Traditional IRA, Example Brokerage ****4417', asset_classification: 'retirement_account', asset_value: 28640000, currency: 'USD' },
    { id: 'asset-ira-2', description: 'Roth IRA, Example Brokerage ****0932', asset_classification: 'retirement_account', asset_value: 9120000, currency: 'USD' },
    { id: 'asset-checking', description: 'Joint checking, Sample Savings Bank ****2210', asset_classification: 'bank_account', asset_value: 3875000, currency: 'USD' },
    { id: 'asset-life', description: 'Term life policy, Sample Mutual Life ****7781', asset_classification: 'life_insurance', asset_value: 50000000, currency: 'USD' }
  ];

  const rulebooks = [{
    id: RULEBOOK_ID, label: 'Firm rulebook, Indiana trust funding', reference: { id: RULEBOOK_ID, version: 3 },
    rules: [
      { id: 'funding.real-property.deed-recorded', label: 'Deed to trust or TOD deed is recorded' },
      { id: 'funding.retirement.beneficiary-confirmed', label: 'Beneficiary designation confirmed in writing' },
      { id: 'funding.bank.retitled', label: 'Account retitled to the trustee' }
    ],
    reviewRules: []
  }];

  const linkTargets = {
    matter_asset: assets.map((asset) => ({ kind: 'matter_asset', id: asset.id, label: asset.description, description: asset.asset_classification, target: { kind: 'matter_asset', id: asset.id } })),
    contact: contacts.map((contact) => ({ kind: 'contact', id: contact.id, label: contact.display_name, target: { kind: 'contact', id: contact.id } })),
    document: documents.map((doc) => ({
      kind: 'document', id: doc.id, label: doc.original_filename, target: { kind: 'document', id: doc.id },
      releases: releases.filter((rel) => rel.retained && (rel.sourceDocumentId === doc.id || rel.releasedDocumentId === doc.id)).map((rel) => ({
        release_id: rel.id, release_number: rel.reference.version, label: 'Release ' + rel.reference.version + ': ' + rel.label,
        target: { kind: 'document', id: doc.id, release_id: rel.id }
      }))
    })),
    rulebook_rule: rulebooks.flatMap((book) => book.rules.map((rule) => ({
      kind: 'rulebook_rule', id: rule.id, label: rule.label, description: 'Rulebook version ' + book.reference.version,
      target: { kind: 'rulebook_rule', id: rule.id, record_id: book.id, version: book.reference.version }
    })))
  };

  const link = (id, type, target, extra = {}) => ({ id, link_type: type, source: { kind: 'matter_note', id: extra.noteId }, target, created_by: USER.id, created_at: ago(extra.minutes || 600), relationship_source: type === 'produced_by' ? 'system' : 'user' });

  const notes = [
    { id: 'note-deed', title: 'Deed recorded with the Marion County Recorder', label: 'fact', evidence_status: 'supported', ai_generated: false,
      content: '<p>The transfer on death deed naming Rowan Fairweather, as successor trustee, was recorded on October 22. Instrument number 2026-118204.</p>', created_at: ago(60 * 26), updated_at: ago(60 * 26),
      links: [
        link('lk-1', 'cites', { kind: 'document', id: 'doc-deed', release_id: 'rel-deed-1', version: 1 }, { noteId: 'note-deed' }),
        link('lk-2', 'about', { kind: 'matter_asset', id: 'asset-house' }, { noteId: 'note-deed' }),
        link('lk-3', 'about', { kind: 'rulebook_rule', id: 'funding.real-property.deed-recorded', record_id: RULEBOOK_ID, version: 3 }, { noteId: 'note-deed' }),
        link('lk-3s', 'about', starterRule('estate.title.deed-to-trustee', true), { noteId: 'note-deed', minutes: 60 * 24 * 9 })
      ] },
    { id: 'note-ira', title: 'Traditional IRA beneficiary is the trust', label: 'fact', evidence_status: 'supported', ai_generated: true,
      content: '<p>The Example Brokerage confirmation letter dated October 27 names the trust as primary beneficiary of the Traditional IRA ****4417.</p>', created_at: ago(60 * 5), updated_at: ago(60 * 4),
      links: [
        link('lk-4', 'about', { kind: 'matter_asset', id: 'asset-ira-1' }, { noteId: 'note-ira' }),
        link('lk-4c', 'cites', { kind: 'document', id: 'doc-ira-bene', release_id: 'rel-ira-1', version: 1 }, { noteId: 'note-ira' }),
        link('lk-5', 'produced_by', { kind: 'agent_run', id: '3f2a9c41-8d0e-4b7a-a1f5-6c2d9e7b0a13' }, { noteId: 'note-ira' })
      ] },
    { id: 'note-question', title: 'Does the joint checking account need to move before closing?', label: 'open_question', evidence_status: null,
      content: '<p>Rowan is a joint owner. Confirm whether the account stays joint with survivorship or is retitled to the trustee.</p>', created_at: ago(60 * 30), updated_at: ago(60 * 30),
      links: [
        link('lk-6', 'about', { kind: 'matter_asset', id: 'asset-checking' }, { noteId: 'note-question' }),
        link('lk-7', 'about', { kind: 'contact', id: 'contact-rowan' }, { noteId: 'note-question' })
      ] },
    { id: 'note-instruction', title: 'Keep life insurance owned individually', label: 'client_instruction', evidence_status: null,
      content: '<p>Client instruction: keep the Sample Mutual Life policy owned by Juniper. Change only the beneficiary to the trust.</p>', created_at: ago(60 * 50), updated_at: ago(60 * 50),
      links: [link('lk-8', 'about', { kind: 'matter_asset', id: 'asset-life' }, { noteId: 'note-instruction' })] },
    { id: 'note-evidence', title: 'Roth IRA beneficiary form signed', label: 'evidence', evidence_status: 'unlinked',
      content: '<p>Signed beneficiary change form for the Roth IRA was emailed to the brokerage. Waiting on their confirmation letter.</p>', created_at: ago(60 * 74), updated_at: ago(60 * 74), links: [] }
  ];

  const tasks = [
    { id: 'task-deed', title: 'Confirm the deed to trust is recorded', status: 'complete', priority: 'high', source: 'lana', assigned_to: 'Avery Quill', due_date: ahead(-6), completed_at: ago(60 * 26), created_at: ago(60 * 24 * 14), updated_at: ago(60 * 26),
      description: 'Recorded October 22.', actions: [],
      links: [{ id: 'tl-1', link_type: 'about', source: { kind: 'task', id: 'task-deed' }, target: { kind: 'rulebook_rule', id: 'funding.real-property.deed-recorded', record_id: RULEBOOK_ID, version: 3 }, created_at: ago(60 * 300) }] },
    { id: 'task-ira', title: 'Get written IRA beneficiary confirmations', status: 'in_progress', priority: 'high', source: 'lana', assigned_to: 'Avery Quill', due_date: ahead(3), created_at: ago(60 * 24 * 10), updated_at: ago(60 * 3),
      description: 'Both Example Brokerage IRAs need a confirmation letter naming the trust.',
      actions: [{ id: 'act-review', kind: 'start_agent', label: 'Start agent', status: 'available', last_run: { started_at: ago(60 * 5) } }],
      links: [
        { id: 'tl-2', link_type: 'about', source: { kind: 'task', id: 'task-ira' }, target: starterRule('estate.beneficiary.trust-primary', false), created_at: ago(60 * 200) },
        { id: 'tl-3', link_type: 'produced_by', source: { kind: 'task', id: 'task-ira' }, target: { kind: 'agent_run', id: '3f2a9c41-8d0e-4b7a-a1f5-6c2d9e7b0a13' }, created_at: ago(60 * 5) }
      ] },
    { id: 'task-checking', title: 'Decide how to hold the joint checking account', status: 'in_review', priority: 'medium', source: 'lana', assigned_to: 'Avery Quill', due_date: ahead(5), created_at: ago(60 * 24 * 2), updated_at: ago(60 * 2),
      description: 'Joint with survivorship or retitle to the trustee.',
      actions: [{ id: 'act-decide', kind: 'form', label: 'Decision needed', status: 'available', last_run: null }],
      links: [
        { id: 'tl-4', link_type: 'about', source: { kind: 'task', id: 'task-checking' }, target: starterRule('estate.bank.pod-review', true), created_at: ago(60 * 100) },
        { id: 'tl-5', link_type: 'produced_by', source: { kind: 'task', id: 'task-checking' }, target: { kind: 'agent_run', id: '9b7e1d22-4c3f-4e8a-b6d1-0f5a2c8e9d47' }, created_at: ago(60 * 2) }
      ] },
    { id: 'task-life', title: 'Send beneficiary change to Sample Mutual Life', status: 'pending', priority: 'medium', source: 'lana', assigned_to: 'Rowan Fairweather', due_date: ahead(9), created_at: ago(60 * 24), updated_at: ago(60 * 24),
      description: 'Owner stays Juniper; beneficiary becomes the trust.', actions: [{ id: 'act-life-run', kind: 'start_agent', label: 'Start agent', status: 'running', last_run: { started_at: ago(12) } }], links: [] },
    { id: 'task-inventory', title: 'Confirm the asset inventory with the client', status: 'pending', priority: 'low', source: 'lana', assigned_to: null, due_date: ahead(12), created_at: ago(60 * 24 * 3), updated_at: ago(60 * 24 * 3), description: '', actions: [], links: [] }
  ];

  // GET /matters/:id/makeup as the makeups service answers it (bare body).
  // Runnables carry readiness { status, total, ready, missing, unknown } (null when unavailable).
  const makeup = {
    makeup: { key: 'estate-administration', name: 'Trust and estate administration', description: 'Funding, rulebook, assets and professional decisions.', version: 1, latest_version: 2, version_id: 'mv-estate-1' },
    tabs: [
      { id: 'summary', kind: 'summary', label: 'Summary', available: true },
      { id: 'notes', kind: 'notes', label: 'Notes', available: true },
      { id: 'tasks', kind: 'tasks', label: 'Board', available: true },
      { id: 'comments', kind: 'comments', label: 'Discussions', available: true },
      { id: 'documents', kind: 'documents', label: 'Documents', available: true },
      { id: 'rulebook', kind: 'rulebook', label: 'Rulebook', available: true },
      { id: 'assets', kind: 'records', label: 'Assets', available: true },
      { id: 'decisions', kind: 'ledger', label: 'Decisions', available: true }
    ],
    fact_labels: [
      { key: 'fact', label: 'Fact' },
      { key: 'client_instruction', label: 'Client instruction' },
      { key: 'open_question', label: 'Open question' },
      { key: 'evidence', label: 'Evidence' }
    ],
    // Note actions the providers declare (backend tab-content.models.js noteActionSchema).
    note_actions: [{
      id: 'record_evidence', label: 'Record as evidence', form: 'implementation_assurance.record_observation', subject: 'matter_note:{note_id}',
      applies_to: { labels: ['fact'], about_kinds: ['matter_asset', 'assurance_record'] }
    }],
    rulebook: { module: 'trust-funding' },
    runnables: [
      { kind: 'agent', key: 'funding-review', name: 'Funding review', definition_id: 'def-funding-1', available: true, can_start: true, start_blocked_reason: null, active_run: null, description: 'Reads the plan, the inventory and the rulebook, and drafts the next funding steps.', readiness: { status: 'incomplete', total: 6, ready: 3, missing: 2, unknown: 1 } },
      { kind: 'agent', key: 'maintenance-check', name: 'Maintenance check', definition_id: 'def-maint-1', available: true, can_start: true, start_blocked_reason: null, active_run: null, description: 'Looks for assets whose title or beneficiary no longer matches the plan.', readiness: { status: 'ready', total: 3, ready: 3, missing: 0, unknown: 0 } },
      { kind: 'agent', key: 'tax-basis-review', name: 'Tax basis review', description: null, available: false, reason: 'This agent is not set up for your organization.', readiness: null },
      { kind: 'skill', key: 'assurance-maintenance-v1', name: 'Nightly assurance check', automation_id: 'auto-881', enabled: true, available: true, description: 'Re-checks every recorded target each night and opens a task when one stops matching.', trigger_summary: 'Runs daily at 02:00', readiness: { status: 'ready', total: 2, ready: 2, missing: 0, unknown: 0 } },
      { kind: 'skill', key: 'deadline-reminders', name: 'Deadline reminders', automation_id: 'auto-882', enabled: false, available: true, description: null, trigger_summary: 'When a task due date is near', readiness: { status: 'ready', total: 0, ready: 0, missing: 0, unknown: 0 } }
    ],
    can_configure_makeup: true
  };

  // GET /makeup/readiness?runnable= as the readiness service answers it (bare
  // body): checks in declaration order, labels from the server, fixes
  // resolved to a tab this makeup shows or a registered form.
  const readiness = {
    'agent:funding-review': {
      runnable: { kind: 'agent', key: 'funding-review' }, status: 'incomplete', total: 6, ready: 3, missing: 2, unknown: 1,
      checks: [
        { code: 'apps.agents', status: 'ready', label: 'Agents app', need: 1, found: 1 },
        { code: 'entities.matter_asset', status: 'ready', label: 'Assets', need: 1, found: 5 },
        { code: 'entities.document', status: 'ready', label: 'Documents', need: 1, found: 4 },
        { code: 'facts.evidence.supported', status: 'missing', label: 'Notes labeled Evidence that cite a retained document release', need: 1, found: 0, fix: { tab: 'notes' } },
        // No deployment context on this box: unknown, with the server's reason.
        { code: 'rulebook.estate', status: 'unknown', label: 'Adopted estate rulebook', need: 1, found: null, reason: 'No deployment jurisdiction is set up, so which rulebook applies could not be checked.' },
        { code: 'records.plan.accepted', status: 'missing', label: 'Accepted plan', need: 1, found: 0, fix: { form: 'implementation_assurance.accept_plan' } }
      ]
    },
    'agent:maintenance-check': {
      runnable: { kind: 'agent', key: 'maintenance-check' }, status: 'ready', total: 3, ready: 3, missing: 0, unknown: 0,
      checks: [
        { code: 'apps.agents', status: 'ready', label: 'Agents app', need: 1, found: 1 },
        { code: 'entities.matter_asset', status: 'ready', label: 'Assets', need: 1, found: 5 },
        { code: 'entities.document', status: 'ready', label: 'Documents', need: 1, found: 4 }
      ]
    }
  };

  // Run limits as the service answers a stored row (design 13 decision 5).
  // Names joined from users; started_today is the cap check's count.
  const runLimits = { max_automatic_agent_runs_per_day: 200, max_agent_spend_microdollars_per_day: 25000000, automatic_runs_paused: false,
    paused_by: null, paused_by_name: null, paused_at: null, updated_by: USER.id, updated_by_name: 'Avery Quill', updated_at: ago(60 * 26),
    is_default: false, started_today: 37 };
  const OTHER_ADMIN = { id: 'user-sam', name: 'Sam Lee' };
  // Another admin saves while this page is open (the next PUT from the page is then stale).
  function otherAdminSaves(change) {
    Object.assign(runLimits, change, { updated_by: OTHER_ADMIN.id, updated_by_name: OTHER_ADMIN.name, updated_at: new Date(now - 60 * 1000).toISOString() });
  }
  // Usage in the agent-stats.service shape; a shorter window has fewer runs.
  const bucket = (runs, input, output, cost) => ({ runs, input_tokens: input, output_tokens: output, total_tokens: input + output, estimated_cost_microdollars: cost });
  function usageFor(days, since, until) {
    const f = days <= 7 ? 0.3 : (days >= 90 ? 2.4 : 1);
    const n = (value) => Math.round(value * f);
    return {
      window: { since, until },
      totals: bucket(n(64), n(412000), n(96500), n(2683500)),
      by_agent: [
        { agent_definition_id: 'def-funding-review', agent_slug: 'funding-review', agent_name: 'Funding review', ...bucket(n(38), n(296000), n(71000), n(1953000)) },
        { agent_definition_id: 'def-maintenance', agent_slug: 'maintenance-check', agent_name: 'Maintenance check', ...bucket(n(22), n(108000), n(23500), n(676500)) },
        { agent_definition_id: 'def-intake', agent_slug: 'intake-summary', agent_name: 'Intake summary', ...bucket(n(4), n(8000), n(2000), null) },
      ],
      by_trigger_type: [
        { trigger_type: 'event', ...bucket(n(41), n(250000), n(60000), n(1650000)) },
        { trigger_type: 'manual', ...bucket(n(15), n(120000), n(27500), n(780000)) },
        { trigger_type: 'schedule', ...bucket(n(8), n(42000), n(9000), n(253500)) },
      ],
      by_matter: [
        { matter_id: MATTER_UUID, matter_code: matter.matter_id, matter_name: matter.name, ...bucket(n(29), n(204000), n(48000), n(1332000)) },
        { matter_id: '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c', matter_code: null, matter_name: null, ...bucket(n(3), n(12000), n(2500), n(61000)) },
        { matter_id: null, matter_code: null, matter_name: null, ...bucket(n(9), n(30000), n(7000), n(190500)) },
      ],
    };
  }

  // Rows as GET /activity/runs answers them (backend toCausationPayload):
  // run is null unless the start went ahead; chain holds the runs before it.
  const RUN_A = '3f2a9c41-8d0e-4b7a-a1f5-6c2d9e7b0a13';
  const RUN_B = '9b7e1d22-4c3f-4e8a-b6d1-0f5a2c8e9d47';
  const RUN_C = 'b7c8d9e0-2222-4bbb-8ccc-000000000007';
  // Each started run's execution trace (agent runs record theirs).
  const TRACE_A = 'e2a1c3b4-5d6e-4f70-8a9b-0c1d2e3f4a5b';
  const TRACE_B = 'f3b2d4c5-6e7f-4a81-9bac-1d2e3f4a5b6c';
  // run as toCausationPayload answers it with its kind's status reader.
  const started = (kind, id, status, state, finishedAt, traceId) => ({ kind, id, status, state, finished_at: finishedAt, execution_trace_id: traceId });
  const ROOT = 'a0c1e2f3-1111-4aaa-8bbb-000000000005';
  const runRow = (row) => ({
    run_kind: 'agent_run', run: null, matter_id: matter.id, origin_event: null, trigger_type: row.origin, root_id: ROOT, parent: null,
    depth: 0, chain: [], actor: { kind: 'system', user_id: null }, actor_name: null, acting_user_id: null, acting_user_name: null, detail: {}, ...row
  });
  const runs = [
    runRow({ id: 'a0c1e2f3-1111-4aaa-8bbb-000000000003', run_kind: 'automation_execution', runnable_key: 'assurance-maintenance-v1', outcome: 'skipped_self_cause', origin: 'event', origin_event: { type: 'note.created', id: 'evt-311' }, depth: 2, parent: { kind: 'agent_run', id: RUN_B }, acting_user_id: USER.id, acting_user_name: 'Avery Quill', trace_id: '7d3efb1b173fecfa2c4b6b8b0a1e9c11', created_at: ago(115),
      chain: [{ kind: 'agent_run', id: RUN_A, runnable_key: 'funding-review' }, { kind: 'agent_run', id: RUN_B, runnable_key: 'maintenance-check' }] }),
    runRow({ id: 'a0c1e2f3-1111-4aaa-8bbb-000000000002', runnable_key: 'maintenance-check', outcome: 'deferred', origin: 'event', origin_event: { type: 'task.updated', id: 'evt-309' }, acting_user_id: USER.id, acting_user_name: 'Avery Quill', depth: 1, parent: { kind: 'agent_run', id: RUN_A }, trace_id: '0af7651916cd43dd8448eb211c80319c', created_at: ago(118),
      chain: [{ kind: 'agent_run', id: RUN_A, runnable_key: 'funding-review' }], detail: { reason: 'active_run', active_run_id: RUN_B } }),
    runRow({ id: 'a0c1e2f3-1111-4aaa-8bbb-000000000001', run: started('agent_run', RUN_B, 'running', 'active', null, TRACE_B), runnable_key: 'maintenance-check', outcome: 'started', origin: 'event', origin_event: { type: 'note.created', id: 'evt-301' }, acting_user_id: USER.id, acting_user_name: 'Avery Quill', depth: 1, parent: { kind: 'agent_run', id: RUN_A }, trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', created_at: ago(120),
      chain: [{ kind: 'agent_run', id: RUN_A, runnable_key: 'funding-review' }] }),
    runRow({ id: 'a0c1e2f3-1111-4aaa-8bbb-000000000006', run_kind: 'automation_execution', run: started('automation_execution', RUN_C, 'failed', 'failed', ago(60 * 2 + 58), null),
      runnable_key: 'deadline-reminders', outcome: 'started', origin: 'schedule', root_id: 'a0c1e2f3-1111-4aaa-8bbb-000000000006', trace_id: 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9', created_at: ago(60 * 2 + 59) }),
    runRow({ id: 'a0c1e2f3-1111-4aaa-8bbb-000000000004', run_kind: 'automation_execution', runnable_key: 'deadline-reminders', outcome: 'skipped_paused', origin: 'schedule', root_id: 'a0c1e2f3-1111-4aaa-8bbb-000000000004', trace_id: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6', created_at: ago(60 * 3) }),
    runRow({ id: ROOT, run: started('agent_run', RUN_A, 'completed', 'completed', ago(60 * 5 - 4), TRACE_A), runnable_key: 'funding-review', outcome: 'started', origin: 'task', trigger_type: 'task_action', actor: { kind: 'user', user_id: USER.id }, actor_name: 'Avery Quill', acting_user_id: USER.id, acting_user_name: 'Avery Quill', trace_id: '5b8aa5a2d2c872e8321cf37308d69df2', created_at: ago(60 * 5) })
  ];

  // Tab content and form descriptors in the shapes the backend phase 7a
  // providers answer (assurance-makeup.providers.js, assurance-makeup.forms.js;
  // tests/unit/assurance-makeup-backend-contract.test.js holds them equal).
  const MATTER_SUBJECT = 'matter:' + matter.id;
  const PLAN = 'ar-plan-0002';
  const T_DEED = 'ar-target-0011';
  const T_PRIMARY = 'ar-target-0012';
  const T_SHARES = 'ar-target-0013';
  const formAction = (id, label, form, subject) => ({ id, label, form: 'implementation_assurance.' + form, subject });
  // A target held to a rulebook the matter no longer applies offers no Change target.
  const targetRow = (id, title, kind, changeable = true) => ({
    id, title, summary: 'Expects a ' + kind + ' value. Accepted target, version 1.', badges: [{ label: 'Version 1', tone: 'neutral' }], recorded_at: ago(60 * 24 * 5),
    actions: [formAction('record_evidence', 'Record evidence', 'record_observation', 'assurance_record:' + id),
      formAction('check_evidence', 'Check evidence', 'assess', 'assurance_record:' + id),
      ...(changeable ? [formAction('change_target', 'Change target', 'accept_target', 'assurance_record:' + id)] : [])]
  });
  const ruleRow = (id, title, summary, badges, citations, targets) => ({
    id, title: id + ': ' + title, summary, badges, ...(targets ? { details: [targets + ' target' + (targets === 1 ? '' : 's') + ' on this matter'] } : {}), citations,
    actions: [formAction('set_target', 'Set target', 'accept_target', 'rulebook_rule:' + RULEBOOK_ID + ':' + id)]
  });
  const ENGINE = { label: 'Checked by the engine', tone: 'success' };
  const tabContent = {
    rulebook: {
      description: 'This is the firm\'s adopted rulebook for US-IN. Rules marked needs_review are attorney review items, not automated checks.',
      groups: [
        { id: 'targets', title: 'Targets on this matter', rows: [
          targetRow(T_DEED, 'Residence, 1400 block of Example Ave: estate.title.deed-to-trustee', 'reference'),
          targetRow(T_PRIMARY, 'Traditional IRA, Example Brokerage ****4417: estate.beneficiary.trust-primary', 'reference'),
          targetRow(T_SHARES, 'Traditional IRA, Example Brokerage ****4417: estate.beneficiary.contingent-shares', 'allocations', false)
        ] },
        { id: 'module:estate', title: 'Estate', subtitle: '4 rules', rows: [
          ruleRow('estate.title.deed-to-trustee', 'Real property is titled to the trustee', 'A deed to the trustee, or a transfer on death deed naming the trustee, is recorded in the county where the property sits.',
            [{ label: 'Law', tone: 'info' }, { label: 'Official source', tone: 'success' }, { label: 'Blocking', tone: 'danger' }, ENGINE],
            [{ label: 'Ind. Code 32-17-14 (Official source)', url: 'https://iga.in.gov/laws/2026/ic/titles/32' }], 1),
          ruleRow('estate.beneficiary.trust-primary', 'The trust is the primary beneficiary', 'Each retirement account names the trust as primary beneficiary, confirmed in writing by the custodian.',
            [{ label: 'Firm practice', tone: 'neutral' }, { label: 'Secondary source: review flag', tone: 'warning' }, { label: 'Blocking', tone: 'danger' }, ENGINE],
            [{ label: 'Firm funding checklist, section 4 (Secondary source: review flag)' }], 1),
          ruleRow('estate.beneficiary.contingent-shares', 'Contingent beneficiary shares match the plan', 'Contingent beneficiaries and their shares on each account match the accepted plan.',
            [{ label: 'Firm practice', tone: 'neutral' }, { label: 'Unverified: review flag', tone: 'danger' }, { label: 'Warning', tone: 'warning' }, ENGINE], [], 1),
          { id: 'estate.bank.pod-review', title: 'estate.bank.pod-review: Payable on death designations are reviewed', summary: 'An attorney reviews any payable on death designation against the plan.',
            badges: [{ label: 'Firm practice', tone: 'neutral' }, { label: 'Cited, not re-checked: review flag', tone: 'warning' }, { label: 'Attorney review', tone: 'neutral' }],
            citations: [{ label: 'Ind. Code 32-17-11 (Cited, not re-checked: review flag)', url: 'https://iga.in.gov/laws/2026/ic/titles/32' }] }
        ] }
      ],
      actions: [formAction('adopt_rulebook', 'Adopt rulebook', 'adopt_rulebook', MATTER_SUBJECT), formAction('publish_rulebook', 'Publish firm rulebook', 'publish_rulebook', MATTER_SUBJECT)],
      next_cursor: null
    },
    assets: {
      description: 'Reported assets of this matter. Reporting an asset does not establish that it is funded.',
      columns: [{ key: 'description', label: 'Asset' }, { key: 'type', label: 'Type' }, { key: 'value', label: 'Reported value' }, { key: 'account', label: 'Account' }],
      rows: [
        ['asset-house', 'Residence, 1400 block of Example Ave, Indianapolis (Marion County)', 'Real estate', 'USD 415000.00', ''],
        ['asset-ira-1', 'Traditional IRA, Example Brokerage', 'Retirement', 'USD 286400.00', '****4417'],
        ['asset-ira-2', 'Roth IRA, Example Brokerage', 'Retirement', 'USD 91200.00', '****0932'],
        ['asset-checking', 'Joint checking, Sample Savings Bank', 'Bank account', 'USD 38750.00', '****2210'],
        ['asset-life', 'Term life policy, Sample Mutual Life', 'Life insurance', 'Not reported', '****7781']
      ].map(([id, description, type, value, account]) => ({ id, cells: { description, type, value, account },
        actions: [formAction('change_asset', 'Change', 'update_asset', 'matter_asset:' + id)] })),
      actions: [formAction('add_asset', 'Add asset', 'create_asset', MATTER_SUBJECT)],
      next_cursor: null
    },
    decisions: {
      description: 'Professional decisions recorded on this matter, newest first. A recorded decision never changes.',
      rows: [
        { id: 'dec-0005', title: 'Closeout accepted', summary: 'Residence target matches the plan; the IRA targets are still open and outside this closeout.', details: ['Covers the recorded plan targets only.'],
          references: [{ label: 'Closeout, version 1' }], recorded_at: ago(60 * 3), recorded_by: 'Avery Quill',
          downloads: [{ id: 'closeout:' + CLOSEOUT_ID, label: 'Download closeout package' }] },
        { id: 'dec-0004', title: 'Finding accepted', summary: 'Recorded TOD deed names the successor trustee. Matches the accepted plan.', badges: [{ label: 'Match', tone: 'success' }],
          references: [{ label: 'Assessment, version 1' }, { label: 'Assessment checked October 30, 2026 at 2:00 PM UTC' }], recorded_at: ago(60 * 25), recorded_by: 'Avery Quill' },
        { id: 'dec-0003', title: 'Evidence reviewed', summary: 'Checked the recorded deed against the county record.',
          references: [{ label: 'Observation, version 1' }], recorded_at: ago(60 * 26), recorded_by: 'Avery Quill' },
        { id: 'dec-0002', title: 'Target accepted', summary: 'Plan section 3.1: the residence goes to the trust by TOD deed.',
          references: [{ label: 'Target, version 1' }], recorded_at: ago(60 * 24 * 5), recorded_by: 'Avery Quill' },
        { id: 'dec-0001', title: 'Plan accepted', summary: 'Executed trust agreement and the amended funding schedule, as released after review.',
          references: [{ label: 'Plan, version 2' }], recorded_at: ago(60 * 24 * 6), recorded_by: 'Avery Quill' }
      ],
      actions: [formAction('accept_plan', 'Accept plan', 'accept_plan', MATTER_SUBJECT), formAction('prepare_closeout', 'Prepare closeout', 'prepare_closeout', MATTER_SUBJECT)],
      next_cursor: null
    }
  };

  const sha = (letter) => letter.repeat(64);
  const releaseOptions = releases.map((rel) => ({ value: rel.id, label: rel.label + ' (release ' + rel.reference.version + ')', reference: { id: rel.id, version: rel.reference.version, sha256: sha('a') }, retained: true }));
  const contactOptions = contacts.slice(0, 2).map((contact) => ({ value: contact.id, label: contact.display_name, kind: 'contact' }));
  const rationale = (label) => ({ id: 'rationale', kind: 'textarea', label, required: true, max_length: 4000 });
  const confirm = (label) => ({ id: 'confirm', kind: 'confirm', label, required: true });
  const descriptor = (key, body) => ({ schema_version: 1, form_key: 'implementation_assurance.' + key, ...body });
  const forms = {
    'implementation_assurance.accept_plan': descriptor('accept_plan', {
      title: 'Accept the estate plan',
      description: 'Choose the retained document versions that make up the plan. Upload the original through Documents and release the reviewed version through Document Review first: a file upload alone is not retained evidence.',
      fields: [
        { id: 'releases', kind: 'document_versions', label: 'Plan documents', required: true, options: releaseOptions },
        rationale('Reason for accepting this plan'),
        confirm('I reviewed these exact document versions and accept them as the plan.')
      ],
      submit_label: 'Accept plan', binding: { subject: MATTER_SUBJECT, sha256: sha('b') }
    }),
    'implementation_assurance.accept_target': descriptor('accept_target', {
      title: 'Set a target',
      description: 'Say what this rule should find for one asset of this matter. The target is held to the rule as published in the firm rulebook.',
      context: [
        { label: 'Rule', value: 'estate.beneficiary.contingent-shares: Contingent beneficiary shares match the plan' },
        { label: 'Compares', value: 'Allocations' },
        { label: 'Evidence it accepts', value: 'Institution acknowledgement, Authoritative record' },
        { label: 'Review', value: 'Professional evidence review is required.' },
        { label: 'Rulebook', value: 'Version 3' }
      ],
      fields: [
        { id: 'plan', kind: 'reference', label: 'Accepted plan', required: true, reference_kind: 'assurance_record', options: [{ value: PLAN, label: 'Accepted plan, version 2 (2 documents)', kind: 'assurance_record' }] },
        { id: 'asset', kind: 'reference', label: 'Asset', required: true, reference_kind: 'matter_asset', options: assets.map((asset) => ({ value: asset.id, label: asset.description, kind: 'matter_asset' })) },
        { id: 'value', kind: 'allocation', label: 'Expected beneficiaries and shares', required: true, reference_kind: 'contact', item_label: 'Beneficiary', options: contactOptions },
        rationale('Reason for this target'),
        confirm('I reviewed this rule and accept this target for the asset.')
      ],
      submit_label: 'Set target', binding: { subject: 'rulebook_rule:' + RULEBOOK_ID + ':estate.beneficiary.contingent-shares', sha256: sha('c') }
    }),
    'implementation_assurance.record_observation': descriptor('record_observation', {
      title: 'Record evidence',
      description: 'Record what the sources show for this target. A professional reviews it before it counts.',
      context: [
        { label: 'Target', value: 'estate.beneficiary.trust-primary, version 1', ref: { kind: 'assurance_record', id: T_PRIMARY } },
        { label: 'Expected', value: 'Rowan Fairweather' },
        { label: 'From note', value: 'Traditional IRA beneficiary is the trust', ref: { kind: 'matter_note', id: 'note-ira' } }
      ],
      fields: [
        { id: 'value', kind: 'reference', label: 'Observed contact', required: true, reference_kind: 'contact', options: contactOptions },
        { id: 'evidence', kind: 'evidence_sources', label: 'Sources', required: true, options: releaseOptions,
          evidence_classes: [{ value: 'client_statement', label: 'Client statement' }, { value: 'institution_acknowledgement', label: 'Institution acknowledgement' }, { value: 'authoritative_record', label: 'Authoritative record' }],
          coverage_options: [{ value: 'complete', label: 'Complete' }, { value: 'partial', label: 'Partial' }, { value: 'unknown', label: 'Not established' }],
          value: [{ artifact: { id: 'rel-ira-1', version: 1, sha256: sha('a') } }] },
        { id: 'valid_from', kind: 'datetime', label: 'True from', required: true },
        { id: 'valid_until', kind: 'datetime', label: 'True until (optional)' },
        { id: 'supersedes', kind: 'multiselect', label: 'Replaces these observations', options: [{ value: 'ar-obs-0031', label: 'Observation version 1, pending review' }] }
      ],
      submit_label: 'Record evidence', binding: { subject: 'matter_note:note-ira:' + T_PRIMARY, sha256: sha('d') }
    }),
    'implementation_assurance.decide': descriptor('decide', {
      title: 'Record professional decision',
      description: 'Review the bound plan and source records first.',
      context: [
        { label: 'Finding', value: 'Evidence supports a difference' },
        { label: 'Why', value: 'Observed value differs' },
        { label: 'Target', value: 'Version 1', ref: { kind: 'assurance_record', id: 'ar-target-0014' } },
        { label: 'Accepted plan', value: 'Version 2', ref: { kind: 'assurance_record', id: PLAN } },
        { label: 'Rulebook', value: 'Version 3' },
        { label: 'Observations checked', value: '1' },
        { label: 'Checked at', value: ago(60 * 2) }
      ],
      fields: [
        { id: 'decision', kind: 'select', label: 'Your decision', required: true, options: [
          { value: 'accept_exception', label: 'Accept an exception (this does not establish a match)' },
          { value: 'reject', label: 'Reject this finding' }
        ] },
        rationale('Reason for your decision'),
        confirm('I reviewed this exact assessment version.')
      ],
      submit_label: 'Record decision', binding: { subject: 'assurance_record:ar-assess-0041', version: 1, sha256: sha('e') }
    })
  };
  forms['implementation_assurance.publish_rulebook'] = descriptor('publish_rulebook', {
    title: 'Publish a firm rulebook',
    description: 'Publish the firm\'s own rulebook, or a new version of one, for every matter that applies it. The definition is the rulebook as JSON: effective_from, effective_to, rules and advisory.',
    context: [{ label: 'Firm rulebook ' + RULEBOOK_ID, value: 'Version 3, effective 2026-09-01, 3 rules' }],
    fields: [
      { id: 'rulebook', kind: 'select', label: 'Rulebook', required: true, value: 'new',
        options: [{ value: 'new', label: 'A new rulebook' }, { value: RULEBOOK_ID, label: 'New version of the firm rulebook at version 3 (effective 2026-09-01)' }] },
      { id: 'definition', kind: 'textarea', label: 'Rulebook definition (JSON)', required: true, max_length: 400000 },
      confirm('I reviewed this rulebook and publish it for the firm.')
    ],
    submit_label: 'Publish rulebook', binding: { subject: MATTER_SUBJECT, sha256: sha('f') }
  });
  // The decision task on the Board opens the same descriptor through its action.
  const decideForm = forms['implementation_assurance.decide'];

  // An estate agent's work proposal (backend work-proposal.models.js) and the
  // Core approval the agents app opened for it (agent-artifact.service payload).
  const PROPOSAL_RUN = 'c4d5e6f7-2222-4bbb-8ccc-000000000101';
  const ARTIFACT_ID = 'c4d5e6f7-2222-4bbb-8ccc-000000000102';
  const rule = (id) => ({ kind: 'rulebook_rule', id });
  const workProposal = {
    title: 'Retirement account follow-ups',
    tasks: [
      { title: 'Get the written beneficiary confirmation for the Traditional IRA', priority: 'high',
        description: 'Example Brokerage has not confirmed the trust as primary beneficiary in writing. Ask for the confirmation letter.',
        about: [{ kind: 'matter_asset', id: 'b1a2c3d4-1111-4aaa-8bbb-00000000a001' }], resolves: [rule('estate.beneficiary.trust-primary')] },
      { title: 'Check contingent shares against plan section 4.2', priority: 'medium',
        description: 'The custodian lists Rowan at 50%. The plan says 60%.',
        about: [rule('estate.beneficiary.contingent-shares')], resolves: [{ kind: 'assurance_record', id: 'b1a2c3d4-1111-4aaa-8bbb-00000000b013' }] }
    ],
    summary: { title: 'What the agent found', items: [
      { label: 'fact', title: 'Residence deed is recorded', text: 'The TOD deed naming the successor trustee was recorded October 22.', about: [rule('estate.title.deed-to-trustee')] },
      { label: 'open_question', title: 'Does the joint checking account move before closing?', text: 'Rowan is a joint owner. The plan does not say whether the account is retitled.', about: [] }
    ] }
  };
  const proposalArtifact = { id: ARTIFACT_ID, run_id: PROPOSAL_RUN, matter_id: matter.id, kind: 'estate_work_proposal', status: 'proposed',
    title: workProposal.title, apply_target_type: 'matter.work_proposal', apply_target_id: null, payload: workProposal, created_at: ago(40) };
  const APPROVAL_ID = 'apr-fixture-0042';
  const proposalApproval = {
    id: APPROVAL_ID, title: workProposal.title, description: null, status: 'pending', priority: 'normal', source_type: 'agent_artifact', source_id: ARTIFACT_ID,
    matter_id: matter.id, requester_name: 'Avery Quill', assigned_to_name: 'Avery Quill', created_at: ago(40), expires_at: new Date(now + 47 * 3600000).toISOString(),
    payload: { artifact_id: ARTIFACT_ID, run_id: PROPOSAL_RUN, kind: 'estate_work_proposal', title: workProposal.title, content: workProposal,
      apply_target_type: 'matter.work_proposal', policy_mode: 'human_required_bulk', batch_approval_enforced: true }
  };

  // The same kind of proposal whose apply stopped part way (failed_to_apply):
  // its approval offers "Apply again", and the apply answers the artifact.
  const FAILED_RUN = 'c4d5e6f7-2222-4bbb-8ccc-000000000201';
  const FAILED_ARTIFACT_ID = 'c4d5e6f7-2222-4bbb-8ccc-000000000202';
  const failedArtifact = { ...proposalArtifact, id: FAILED_ARTIFACT_ID, run_id: FAILED_RUN, status: 'failed_to_apply' };
  const FAILED_APPROVAL_ID = 'apr-fixture-0043';
  const failedApproval = { ...proposalApproval, id: FAILED_APPROVAL_ID, status: 'approved', source_id: FAILED_ARTIFACT_ID,
    payload: { ...proposalApproval.payload, artifact_id: FAILED_ARTIFACT_ID, run_id: FAILED_RUN } };
  // Download refs the server answers 404 for (a closeout that is not, or no longer, accepted).
  const refusedDownloads = new Set();

  const makeups = { makeups: [
    { key: 'estate-administration', name: 'Trust and estate administration', description: 'Funding, rulebook, assets and professional decisions.', latest_version: 2, scope: 'organization' },
    { key: 'general-litigation', name: 'General litigation', description: 'Pleadings, discovery, deadlines.', latest_version: 1, scope: 'organization' },
    { key: 'business-formation', name: 'Business formation', description: 'Entity setup, filings, ownership records.', latest_version: 3, scope: 'organization' },
    { key: 'standard', name: 'Standard', description: 'The matter tabs every matter has today: summary, notes, board, discussions, documents and billable hours.', latest_version: 1, scope: 'system' }
  ] };

  const ok = (body, status = 200) => ({ status, body });
  const notFound = () => ({ status: 404, body: { success: false, error: { message: 'Not found' } } });
  const noteOut = (note) => ({ ...note });
  const evidenceStatus = (note) => {
    if (!note.links.length) return 'unlinked';
    return note.links.some((item) => item.link_type === 'cites' && item.target.release_id) ? 'supported' : 'linked';
  };

  // Agent runs going on the matter, by slug ({ id, status }): the makeup view
  // answers them as each agent runnable's start offer (matter-makeups.service
  // startOffer). maintenance-check was started elsewhere after the page
  // loaded: the page's view still offers it, a press is refused 409 and the
  // view read after that names the run.
  const activeRuns = {};
  const startedElsewhere = { 'maintenance-check': { id: RUN_B, status: 'running' } };
  const makeupView = () => ({ ...makeup, runnables: makeup.runnables.map((item) => {
    if (item.kind !== 'agent' || !item.available) return item;
    const run = activeRuns[item.key];
    return run
      ? { ...item, can_start: false, start_blocked_reason: 'active_run', active_run: { ...run, state: 'active' } }
      : { ...item, can_start: true, start_blocked_reason: null, active_run: null };
  }) });
  // The harness ends a run (the worker finished it): the next view offers Start again.
  const endRun = (slug) => { delete activeRuns[slug]; };

  function handle(method, pathname, search, body) {
    const q = new URLSearchParams(search || '');
    calls.push({ method, path: pathname + (search || ''), body });
    const m = (re) => pathname.match(re);
    const M = MATTER_ID;
    let r;
    if (method === 'GET' && pathname === `/api/v1/matters/${M}`) return ok({ success: true, matter });
    if (pathname === `/api/v1/matters/${M}/permissions`) return ok({ permissions: ['read', 'write', 'admin'] });
    if (pathname === `/api/v1/activity/matter/${M}`) return ok({ activities: [
      { id: 'act-1', action: 'note_created', description: 'Avery Quill added a note: Deed recorded with the Marion County Recorder', created_at: ago(60 * 26), user_name: 'Avery Quill' },
      { id: 'act-2', action: 'task_completed', description: 'Avery Quill completed: Confirm the deed to trust is recorded', created_at: ago(60 * 26), user_name: 'Avery Quill' },
      { id: 'act-3', action: 'document_uploaded', description: 'IRA beneficiary confirmation, Example Brokerage.pdf uploaded', created_at: ago(60 * 24 * 4), user_name: 'Avery Quill' }
    ], pagination: { total: 3 } });
    if (pathname === '/api/v1/storage/files') return ok({ files: documents, pagination: { total_count: documents.length, page: 1, page_size: 500 } });
    if (pathname === `/api/v1/files/orphaned/${M}`) return ok({ orphaned_files: [], total_count: 0 });
    if (pathname === `/api/v1/matters/${M}/tasks`) return ok({ tasks, total_count: tasks.length });
    if (pathname === `/api/v1/matters/${M}/comments`) return ok({ data: [], pagination: { total: 2 } });
    if (pathname === `/api/v1/matters/${M}/workspace-state`) return ok({ workspace_state: null });
    if (pathname === '/api/v1/documents' && q.get('client_matter') === M) return ok({ documents, pagination: { total: documents.length } });

    // Makeups (design 4.1)
    if (method === 'GET' && pathname === `/api/v1/matters/${M}/makeup`) return ok(makeupView());
    if (method === 'PUT' && pathname === `/api/v1/matters/${M}/makeup`) {
      return ok({ outcome: 'switched', assignment: { id: 'as-2', from_version_id: 'mv-estate-1', to_version_id: 'mv-estate-2', reason: body && body.reason }, effects: { status: 'complete', skills_disabled: 0, starter_tasks_created: 1 }, ...makeup });
    }
    if (pathname === '/api/v1/matter-makeups') return ok(makeups);
    if (method === 'GET' && pathname === `/api/v1/matters/${M}/makeup/readiness`) {
      const answer = readiness[q.get('runnable')];
      return answer ? ok(answer) : notFound();
    }
    // GET /tabs/:tab_id: { tab, available, ...content }; a built-in tab says built_in.
    if ((r = m(new RegExp(`^/api/v1/matters/${M}/tabs/([^/]+)$`)))) {
      const tab = makeup.tabs.find((item) => item.id === r[1]);
      if (!tab) return notFound();
      return ok(tabContent[tab.id] ? { tab, available: true, ...tabContent[tab.id] } : { tab, available: true, built_in: true });
    }
    // Ledger downloads (matter-makeups controller getMatterTabDownload): the record as an attachment.
    if ((r = m(new RegExp(`^/api/v1/matters/${M}/tabs/([^/]+)/downloads/([^/]+)$`)))) {
      const ref = decodeURIComponent(r[2]);
      // A closeout no longer accepted: the provider's 404 CLOSEOUT_NOT_ACCEPTED.
      if (refusedDownloads.has(ref)) return { status: 404, body: { success: false, error: { code: 'CLOSEOUT_NOT_ACCEPTED', message: 'Only accepted closeouts can be downloaded. Accept this closeout first.' } } };
      if (r[1] !== 'decisions' || ref !== 'closeout:' + CLOSEOUT_ID) return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'Download not found' } } };
      return { status: 200, headers: { 'Content-Disposition': `attachment; filename="closeout-${CLOSEOUT_ID}.json"`, 'Cache-Control': 'no-store' },
        body: { record: { id: CLOSEOUT_ID, kind: 'closeout', version: 1, state: 'accepted' } } };
    }
    if ((r = m(new RegExp(`^/api/v1/matters/${M}/forms/([^/]+)$`)))) {
      // Bare bodies (forms.controller): the descriptor, then 201 recorded.
      const key = decodeURIComponent(r[1]);
      const subject = q.get('subject') || '';
      if (method === 'GET') {
        // A fact note about an asset with two targets must name one (assurance-makeup.forms noteContext).
        if (key === 'implementation_assurance.record_observation' && /^matter_note:[^:]+$/.test(subject)) {
          const noteId = subject.split(':')[1];
          return ok({ success: false, error: { code: 'ASSURANCE_NOTE_TARGET_AMBIGUOUS', message: 'This note is about 2 targets. Choose the one this evidence is for.',
            details: { candidates: [
              { subject: `matter_note:${noteId}:${T_PRIMARY}`, label: 'Traditional IRA, Example Brokerage: estate.beneficiary.trust-primary, version 1' },
              { subject: `matter_note:${noteId}:${T_SHARES}`, label: 'Traditional IRA, Example Brokerage: estate.beneficiary.contingent-shares, version 1' }
            ] } } }, 422);
        }
        const form = forms[key];
        if (!form) return notFound();
        return ok(subject ? { ...form, binding: { ...form.binding, subject } } : form);
      }
      const decision = key === 'implementation_assurance.decide';
      return ok({ status: 'recorded', record_ref: decision ? { kind: 'assurance_decision', id: 'dec-0006' } : { kind: 'assurance_record', id: 'ar-new-0001' }, message: decision ? 'Exception accepted.' : 'Recorded.' }, 201);
    }
    // Task actions (design 4.3)
    if ((r = m(/^\/api\/v1\/tasks\/([^/]+)\/actions\/([^/]+)\/form$/))) {
      if (method === 'GET') return ok(decideForm);
      return ok({ status: 'recorded', record_ref: { kind: 'assurance_decision', id: 'dec-0006' }, message: 'Exception accepted.' }, 201);
    }
    // POST .../start (task-actions.service startAction): 202 { outcome, action, run };
    // the task list read after it shows the action running.
    if ((r = m(/^\/api\/v1\/tasks\/([^/]+)\/actions\/([^/]+)\/start$/))) {
      const task = tasks.find((item) => item.id === r[1]);
      const index = task ? task.actions.findIndex((item) => item.id === r[2]) : -1;
      if (index === -1) return notFound();
      const action = { ...task.actions[index], status: 'running', last_run: { kind: 'agent_run', id: 'run-new-1', started_at: new Date(now).toISOString(), finished_at: null } };
      task.actions[index] = action;
      return ok({ outcome: 'started', action, run: { kind: 'agent_run', id: 'run-new-1' } }, 202);
    }
    // Approvals (approvals routes): an agent work proposal awaiting a person, and its run.
    if (method === 'GET' && pathname === `/api/v1/approvals/${APPROVAL_ID}`) return ok({ success: true, data: proposalApproval });
    if (method === 'GET' && pathname === `/api/v1/approvals/${APPROVAL_ID}/history`) return ok({ success: true, data: [
      { action: 'created', actor_name: 'Funding review agent', created_at: ago(40) }] });
    if (method === 'GET' && pathname === `/api/v1/approvals/${FAILED_APPROVAL_ID}`) return ok({ success: true, data: failedApproval });
    if (method === 'GET' && pathname === `/api/v1/approvals/${FAILED_APPROVAL_ID}/history`) return ok({ success: true, data: [
      { action: 'created', actor_name: 'Funding review agent', created_at: ago(90) }, { action: 'approved', actor_name: 'Avery Quill', created_at: ago(60) }] });
    if (method === 'GET' && pathname === `/api/v1/agent-runs/${FAILED_RUN}`) {
      return ok({ run: { id: FAILED_RUN, status: failedArtifact.status === 'applied' ? 'completed' : 'failed', matter_id: matter.id }, steps: [], artifacts: [failedArtifact], child_runs: [], outcome: null });
    }
    // POST apply (agent-runs.controller applyArtifact): a re-apply from failed_to_apply finishes it.
    if (method === 'POST' && pathname === `/api/v1/agent-runs/${FAILED_RUN}/artifacts/${FAILED_ARTIFACT_ID}/apply`) {
      failedArtifact.status = 'applied';
      return ok({ artifact: failedArtifact });
    }
    if (method === 'GET' && pathname === `/api/v1/agent-runs/${PROPOSAL_RUN}`) {
      return ok({ run: { id: PROPOSAL_RUN, status: 'awaiting_approval', matter_id: matter.id }, steps: [], artifacts: [proposalArtifact], child_runs: [], outcome: null });
    }
    // The agents app run detail: the run already going is still running.
    if ((r = m(/^\/api\/v1\/agent-runs\/([^/]+)$/))) return ok({ run: { id: r[1], status: 'running' }, steps: [], artifacts: [], child_runs: [], outcome: null });
    // Run limits (runs.routes runLimitsRoutes; run-limits.service toLimitsPayload). A daily
    // limit over 100000 is refused the way validateRequest and the error handler answer it.
    if (method === 'GET' && pathname === '/api/v1/admin/run-limits') return ok({ status: 'success', data: { limits: runLimits } });
    if (method === 'PUT' && pathname === '/api/v1/admin/run-limits') {
      if (body && body.max_automatic_agent_runs_per_day > 100000) {
        return ok({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', field: 'max_automatic_agent_runs_per_day',
          details: [{ code: 'too_big', path: ['max_automatic_agent_runs_per_day'], message: 'Number must be less than or equal to 100000' }] } }, 400);
      }
      // expected_updated_at is required; a stale one is 409 RUN_LIMITS_STALE with the current limits, nothing written.
      if (!body || !Object.prototype.hasOwnProperty.call(body, 'expected_updated_at')) {
        return ok({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', field: 'expected_updated_at',
          details: [{ code: 'invalid_type', path: ['expected_updated_at'], message: 'Required' }] } }, 400);
      }
      const current = runLimits.is_default ? null : runLimits.updated_at;
      if (body.expected_updated_at !== current) {
        return ok({ success: false, error: { code: 'RUN_LIMITS_STALE', message: 'The run limits changed since you loaded them. Review the current values and save again.',
          details: { limits: runLimits } } }, 409);
      }
      const { expected_updated_at: ignored, ...change } = body;
      now += 1000;
      const stamp = new Date(now).toISOString();
      if (Object.prototype.hasOwnProperty.call(change, 'automatic_runs_paused') && change.automatic_runs_paused !== runLimits.automatic_runs_paused) {
        runLimits.paused_by = change.automatic_runs_paused ? USER.id : null;
        runLimits.paused_by_name = change.automatic_runs_paused ? 'Avery Quill' : null;
        runLimits.paused_at = change.automatic_runs_paused ? stamp : null;
      }
      Object.assign(runLimits, change, { updated_by: USER.id, updated_by_name: 'Avery Quill', updated_at: stamp, is_default: false });
      return ok({ status: 'success', data: { limits: runLimits } });
    }
    // Org-wide agent usage (agent-stats.service getOrgUsage), bare body.
    if (method === 'GET' && pathname === '/api/v1/agents/usage') {
      const since = q.get('since');
      const until = q.get('until');
      const days = Math.round((Date.parse(until) - Date.parse(since)) / 86400000);
      return ok({ usage: usageFor(days, since, until) });
    }
    // Traces (traces.routes): a run's own execution trace, opened from run history.
    if ((r = m(/^\/api\/v1\/traces\/([0-9a-f-]{36})$/))) {
      const traceRun = runs.find((row) => row.run && row.run.execution_trace_id === r[1]);
      if (!traceRun) return notFound();
      return ok({ status: 'success', data: {
        trace: { trace_id: r[1], status: traceRun.run.state === 'active' ? 'pending' : 'completed', chat_mode: 'agentic', total_duration_ms: 241000,
          llm_call_count: 6, rag_retrieval_count: 2, user_message: 'Agent run: ' + traceRun.runnable_key, created_at: traceRun.created_at },
        llmCalls: [], ragRetrievals: [],
        sseEvents: [{ id: 'sse-1', event_type: 'operation.caused_by', event_data: JSON.stringify({ caused_by_trace_id: traceRun.trace_id }), time_since_request_ms: 3, created_at: traceRun.created_at }]
      } });
    }
    if (method === 'GET' && (pathname === '/api/v1/traces' || pathname === '/api/v1/traces/facets')) {
      return ok({ status: 'success', data: { traces: [], total: 0, status: [], chat_mode: [] } });
    }
    // Runs (design 4.4, 14)
    if (pathname === `/api/v1/matters/${M}/activity/runs`) return ok({ status: 'success', data: { runs, next_cursor: null } });
    if ((r = m(/^\/api\/v1\/runs\/([^/]+)\/([^/]+)\/causation$/))) {
      const row = runs.find((item) => item.run && item.run.kind === r[1] && item.run.id === r[2]);
      return row ? ok({ status: 'success', data: { causation: row, root: runs.filter((item) => item.root_id === row.root_id) } }) : notFound();
    }
    // Agents start (agents controller startRun): an agent already running on
    // this matter is refused 409 ACTIVE_RUN_EXISTS with its run's id.
    if ((r = m(/^\/api\/v1\/agents\/([^/]+)\/runs$/))) {
      if (startedElsewhere[r[1]]) { activeRuns[r[1]] = startedElsewhere[r[1]]; delete startedElsewhere[r[1]]; }
      const going = activeRuns[r[1]];
      if (going) {
        return ok({ error: { code: 'ACTIVE_RUN_EXISTS', message: 'This agent is already running on this matter.', active_run_id: going.id, details: { active_run_id: going.id } }, outcome: 'skipped_active_run', active_run_id: going.id }, 409);
      }
      activeRuns[r[1]] = { id: 'run-new-1', status: 'queued' };
      return ok({ outcome: 'started', run: { id: 'run-new-1', status: 'queued' }, queue: { name: 'agent.execute', job_id: 'job-1' } }, 202);
    }

    // Notes and links (design 4.2)
    if (method === 'GET' && pathname === `/api/v1/matters/${M}/notes`) {
      let list = notes;
      if (q.get('label')) list = list.filter((note) => note.label === q.get('label'));
      if (q.get('unlinked') === 'true') list = list.filter((note) => !note.links.length);
      return ok({ status: 'success', data: { notes: list.map(noteOut), total: list.length, hasMore: false } });
    }
    if ((r = m(new RegExp(`^/api/v1/matters/${M}/notes/([^/]+)$`))) && method === 'GET') {
      const note = notes.find((item) => item.id === r[1]);
      return note ? ok({ status: 'success', data: { note: noteOut(note) } }) : notFound();
    }
    // Create and update return the saved note; evidence_status is derived from
    // links the way the server does, so a new unlinked fact reads Not supported.
    if (method === 'POST' && pathname === `/api/v1/matters/${M}/notes`) {
      const stamp = new Date(now).toISOString();
      const note = { id: 'note-new-' + (notes.length + 1), title: body.title, content: body.content, label: body.label || null, ai_generated: false, links: [], created_at: stamp, updated_at: stamp };
      note.evidence_status = evidenceStatus(note);
      notes.unshift(note);
      return ok({ status: 'success', data: { note: noteOut(note) } }, 201);
    }
    if ((r = m(new RegExp(`^/api/v1/matters/${M}/notes/([^/]+)$`))) && method === 'PUT') {
      const note = notes.find((item) => item.id === r[1]);
      if (!note) return notFound();
      ['title', 'content', 'label'].forEach((key) => { if (body && Object.prototype.hasOwnProperty.call(body, key)) note[key] = body[key]; });
      note.updated_at = new Date(now).toISOString();
      note.evidence_status = evidenceStatus(note);
      return ok({ status: 'success', data: { note: noteOut(note) } });
    }
    if (method === 'POST' && pathname === `/api/v1/matters/${M}/links`) return ok({ data: { link: { id: 'lk-new', ...body } } }, 201);
    // Core link target lookup (matter-link-targets.service): each target is the POST target.
    if (method === 'GET' && pathname === `/api/v1/matters/${M}/links/targets`) {
      const targets = linkTargets[q.get('kind')];
      return targets ? ok({ status: 'success', data: { kind: q.get('kind'), targets, next_cursor: null, available: true } }) : notFound();
    }

    // App shell and summary widgets the page loads around the matter.
    if (pathname === '/api/v1/auth/refresh') return ok({ success: true });
    if (pathname === '/api/v1/notifications/unread-count') return ok({ count: 0, unread_count: 0 });
    if (pathname === '/api/v1/tasks/my') return ok({ tasks: [], total_count: 0 });
    if (pathname === '/api/v1/matters/pinned') return ok({ matters: [], pagination: { total: 0 } });
    if (pathname === '/api/v1/matters') return ok({ matters: [{ ...matter, contacts: undefined }], pagination: { total: 1, page: 1, page_size: 25 } });
    if (pathname === '/api/v1/conversations') return ok({ sessions: [], pagination: { total: 0 } });
    if (pathname === `/api/v1/matters/${M}/connector-data`) return ok({ data: [] });
    if (pathname.startsWith(`/api/v1/matters/${M}/growth-engine/`) || pathname.startsWith(`/api/v1/matters/${M}/imports/`)) return ok({ recent: [], promoted: [], signals: [] });
    if (pathname === '/api/health/discovery') return ok({ status: 'ok' });

    unhandled.push(method + ' ' + pathname + (search || ''));
    return null;
  }

  return { handle, calls, unhandled, endRun, data: { runLimits, otherAdminSaves, traceIds: { TRACE_A, TRACE_B }, matter, notes, tasks, makeup, runs, tabContent, forms, workProposal, proposalApproval, failedApproval, linkTargets, refusedDownloads } };
}

module.exports = { createFixtureApi, MATTER_ID, MATTER_UUID, USER, ORG_ID };

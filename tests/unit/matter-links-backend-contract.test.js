'use strict';

/**
 * Client request builders against the backend's own Zod models.
 *
 * Loads the matter links and matter notes models from a LANA-AI checkout and
 * parses the bodies the client builds. Runs the real link target lookup
 * (matter-link-targets.service.js, its repositories mocked), maps its answer
 * as the picker does and parses the POST body built from each target. The backend is LANA_BACKEND_DIR when
 * set, else the sibling worktree .runtime/lana-estate-rulebook, else a sibling
 * LANA-AI/. When none has the models the suite is skipped
 * with a message saying where it looked.
 */

const fs = require('fs');
const path = require('path');

const { findBackend } = require('../fixtures/backend-checkout.js');
const EntityLinks = require('../../src/js/shared/entity-links.js');
const NoteLabels = require('../../src/js/shared/note-labels.js');

const LINK_MODELS = 'src/services/processor/matter-links/matter-links.models.js';
const checkout = findBackend([LINK_MODELS]);
const backendDir = checkout.dir;
const backend = checkout.require;
const describeBackend = checkout.describe;

const NOTE = { kind: 'matter_note', id: '0b3f1a52-5a7e-4c59-9d4e-2f6f0c2b7a11' };
const UUID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const RELEASE = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const RECORD = '9e8d7c6b-5a49-4382-a716-151413121110';

// A realistic pick for each kind the person can link, as toLinkCandidates
// (and the release select) hand it to createLinkRequest.
const PICKS = {
  matter_asset: { id: UUID },
  contact: { id: UUID },
  rulebook_rule: { kind: 'rulebook_rule', id: 'mod.inventory.filed', record_id: RECORD, version: 2 },
  document: { id: UUID },
};

describeBackend('client builders against the backend models', () => {
  let links;
  let kinds;
  let notes;
  let labels;

  beforeAll(() => {
    links = backend(LINK_MODELS);
    kinds = backend('src/shared/contracts/link-kinds.contract.js');
    notes = backend('src/services/processor/matter-notes/matter-notes.validators.js');
    labels = backend('src/shared/contracts/note-labels.contract.js');
  });

  const body = (kind, pick) => EntityLinks.createLinkRequest('MATT-1', NOTE, kind, pick).body;

  test('every pickable kind is a backend link kind with a resolver-backed pick', () => {
    expect(Object.keys(PICKS).sort()).toEqual([...EntityLinks.PICKABLE_KINDS].sort());
    EntityLinks.PICKABLE_KINDS.forEach((kind) => {
      expect(kinds.isLinkEntityKind(kind)).toBe(true);
    });
  });

  test.each(Object.keys(PICKS))('%s: the body parses and its link type joins a note to it', (kind) => {
    const built = body(kind, PICKS[kind]);
    const parsed = links.createMatterLinkSchema.body.safeParse(built);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual(built);
    expect(kinds.linkTypeAllows(built.link_type, 'matter_note', kind)).toBe(true);
  });

  test('a rule link carries the record_id and version the backend pins', () => {
    const { target } = body('rulebook_rule', { kind: 'rulebook_rule', id: 'mod.inventory.filed', record_id: RECORD, version: 2 });
    expect(links.createMatterLinkSchema.body.shape.target.parse(target))
      .toEqual({ kind: 'rulebook_rule', id: 'mod.inventory.filed', record_id: RECORD, version: 2 });
  });

  test('a document link with a retained release parses, and so does one without', () => {
    const supported = body('document', { id: UUID, release_id: RELEASE });
    expect(links.createMatterLinkSchema.body.safeParse(supported).success).toBe(true);
    expect(supported.target.release_id).toBe(RELEASE);
    expect(links.createMatterLinkSchema.body.safeParse(body('document', { id: UUID })).success).toBe(true);
  });

  test('control: the models refuse a body the client must never send', () => {
    const schema = links.createMatterLinkSchema.body;
    const good = body('rulebook_rule', PICKS.rulebook_rule);
    expect(schema.safeParse(good).success).toBe(true);
    expect(schema.safeParse({ ...good, target: { ...good.target, version: '2' } }).success).toBe(false);
    expect(schema.safeParse({ ...good, target: { ...good.target, pinned: true } }).success).toBe(false);
    expect(schema.safeParse({ ...good, link_type: 'relates_to' }).success).toBe(false);
  });

  test('produced_by targets are not offered to a person', () => {
    kinds.LINK_TYPE_ENDS.produced_by.targets.forEach((kind) => {
      expect(EntityLinks.PICKABLE_KINDS).not.toContain(kind);
    });
    EntityLinks.PICKABLE_KINDS.forEach((kind) => {
      expect(EntityLinks.defaultLinkType(kind)).not.toBe('produced_by');
    });
  });

  test('the refusal codes the client words are the ones the backend sends', () => {
    const service = fs.readFileSync(path.join(backendDir, 'src/services/processor/matter-links/matter-links.service.js'), 'utf8');
    expect(service).toContain("'LINK_KIND_NOT_LINKABLE'");
    expect(service).toContain("'LINK_CONFLICT'");
    expect(EntityLinks.linkErrorMessage({ status: 422, code: 'LINK_KIND_NOT_LINKABLE' }, 'agent_run', 'add'))
      .toContain('linked by the server');
  });

  test('link removal ids are the uuids the remove route takes', () => {
    const request = EntityLinks.removeLinkRequest('MATT-1', UUID);
    const linkId = decodeURIComponent(request.path.split('/').pop());
    expect(links.removeMatterLinkSchema.params.safeParse({ matter_id: 'MATT-1', link_id: linkId }).success).toBe(true);
  });

  describe('note labels', () => {
    test('the client label list is the backend platform list', () => {
      expect(NoteLabels.PLATFORM_FACT_LABELS.map((l) => ({ key: l.key, label: l.label })))
        .toEqual(labels.PLATFORM_NOTE_LABELS.map((l) => ({ key: l.key, label: l.label })));
    });

    test('the client flags exactly the evidence-bearing labels', () => {
      const flagged = labels.PLATFORM_NOTE_LABELS.map((l) => l.key)
        .filter((key) => NoteLabels.evidenceFlag({ label: key, evidence_status: 'unlinked' }));
      expect(flagged.sort()).toEqual([...labels.EVIDENCE_BEARING_NOTE_LABELS].sort());
    });

    // The focus editor sends { title, content, ai_generated: false } plus labelChange.
    const write = (selected, previous) => ({
      title: 'Call with bank', content: '<p>Balance</p>', ai_generated: false,
      ...NoteLabels.labelChange(selected, previous),
    });

    test('create with a label parses', () => {
      const parsed = notes.createNoteSchema.body.safeParse(write('fact', null));
      expect(parsed.error).toBeUndefined();
      expect(parsed.data.label).toBe('fact');
    });

    test('update sets, clears and leaves a label unchanged', () => {
      const schema = notes.updateNoteSchema.body;
      expect(schema.parse(write('evidence', 'fact')).label).toBe('evidence');
      expect(schema.parse(write('', 'fact')).label).toBeNull();
      expect(schema.parse(write('fact', 'fact'))).not.toHaveProperty('label');
      expect(schema.safeParse(NoteLabels.labelChange('', 'fact')).success).toBe(true);
    });

    test('control: a label that is not a key shape is refused', () => {
      expect(notes.createNoteSchema.body.safeParse(write('Fact label', null)).success).toBe(false);
    });

    test('list filters parse to the label and unlinked the service reads', () => {
      const query = notes.listNotesSchema.query.parse(NoteLabels.listFilterParams({ label: 'fact', unlinked: true }));
      expect(query.label).toBe('fact');
      expect(query.unlinked).toBe(true);
      expect(notes.listNotesSchema.query.parse(NoteLabels.listFilterParams({ label: '', unlinked: false })))
        .not.toHaveProperty('label');
    });
  });
});

describeBackend('the Core link target lookup drives the picker', () => {
  const mockAssets = { list: jest.fn() };
  const mockContacts = { contactChoices: jest.fn() };
  const mockDocs = { listReadableMatterDocuments: jest.fn() };
  const mockReleases = { listRetainedReleasesForDocuments: jest.fn() };
  const mockRules = { rulebookView: jest.fn() };
  let lookup;
  let links;
  const actor = { userId: 'u1', organizationId: 'o1', roleId: 'r1' };
  const matter = { uuid: UUID, code: 'MATT-1' };
  const backendPath = checkout.path;

  beforeAll(() => {
    jest.doMock(backendPath('src/repositories/matter-assets.repository'), () => ({ createMatterAssetsRepository: () => mockAssets }));
    jest.doMock(backendPath('src/services/implementation-assurance/assurance.repository'), () => ({ createAssuranceRepository: () => mockContacts }));
    jest.doMock(backendPath('src/repositories/document-access.repository'), () => mockDocs);
    jest.doMock(backendPath('src/services/processor/document-edit-batches/document-edit-batches.repository'), () => jest.fn(() => mockReleases));
    jest.doMock(backendPath('src/services/implementation-assurance/assurance.service'), () => ({ getImplementationAssuranceService: () => mockRules }));
    jest.doMock(backendPath('src/shared/database'), () => ({ postgres: {} }));
    lookup = backend('src/services/processor/matter-links/matter-link-targets.service.js');
    links = backend(LINK_MODELS);
  });

  // The controller answers { status: 'success', data } (matter-links.controller listLinkTargets).
  async function answer(kind, query = {}) {
    const request = EntityLinks.targetsRequest('MATT-1', kind, query.cursor);
    const params = Object.fromEntries(new URL('http://x' + request.path).searchParams);
    const parsed = links.listLinkTargetsSchema.query.parse(params);
    expect(links.listLinkTargetsSchema.params.safeParse({ matter_id: request.path.split('/')[4] }).success).toBe(true);
    return { status: 'success', data: await lookup.listLinkTargets({ actor, matter, query: parsed }) };
  }

  const posted = (kind, target) => {
    const built = EntityLinks.createLinkRequest('MATT-1', NOTE, kind, target).body;
    const parsed = links.createMatterLinkSchema.body.safeParse(built);
    expect(parsed.error).toBeUndefined();
    return parsed.data.target;
  };

  test('the client asks for exactly the lookup kinds it can link', () => {
    expect([...EntityLinks.PICKABLE_KINDS].sort()).toEqual([...links.LINK_TARGET_KINDS].sort());
    expect([...lookup.LINK_TARGET_KINDS].sort()).toEqual([...links.LINK_TARGET_KINDS].sort());
  });

  test('assets and contacts: each candidate target posts as is', async () => {
    mockAssets.list.mockResolvedValue({ assets: [{ id: UUID, description: 'House', asset_classification: 'real_property' }], next_cursor: null });
    mockContacts.contactChoices.mockResolvedValue({ rows: [{ id: RECORD, label: 'Ann' }], hasMore: false });
    const [asset] = EntityLinks.toLinkCandidates('matter_asset', await answer('matter_asset'));
    expect(asset.label).toBe('House');
    expect(posted('matter_asset', asset.target)).toEqual({ kind: 'matter_asset', id: UUID });
    const [contact] = EntityLinks.toLinkCandidates('contact', await answer('contact'));
    expect(posted('contact', contact.target)).toEqual({ kind: 'contact', id: RECORD });
  });

  test('documents carry releases; the document and each release target post as is', async () => {
    mockDocs.listReadableMatterDocuments.mockResolvedValue({ rows: [{ id: UUID, filename: 'Will.pdf' }], hasMore: false });
    mockReleases.listRetainedReleasesForDocuments.mockResolvedValue([
      { id: RELEASE, release_number: 2, source_document_id: UUID, released_document_id: RECORD, released_document_filename: 'Will v2.pdf' },
    ]);
    const [doc] = EntityLinks.toLinkCandidates('document', await answer('document'));
    expect(doc.label).toBe('Will.pdf');
    expect(doc.releases.map((r) => r.label)).toEqual(['Release 2: Will v2.pdf']);
    expect(posted('document', doc.target)).toEqual({ kind: 'document', id: UUID });
    expect(posted('document', doc.releases[0].target)).toEqual({ kind: 'document', id: UUID, release_id: RELEASE });
  });

  // The rulebook the matter applies (rulebook-context resolveRulebook view);
  // the lookup derives each rule's pin from it with the real appliedRulePins.
  const entries = (count) => Array.from({ length: count }, (_, i) => ({ id: 'mod.area.rule' + i, rule: { meta: { title: 'Rule ' + i } } }));
  const firmView = (count) => ({ header: { basis: 'firm_adopted', reference: { id: RECORD, version: 3, sha256: 'b'.repeat(64) } }, entries: entries(count) });
  const STARTER = { id: 'estate-starter-us-in', version: '0.2.0-draft', sha256: 'c'.repeat(64) };
  const starterView = (jurisdiction) => ({ header: { basis: jurisdiction ? 'starter' : 'foundation_only', jurisdiction, starter: STARTER }, entries: entries(2) });

  test('firm rules are pinned to record and version, paged by next_cursor; feature off is unavailable with a reason', async () => {
    mockRules.rulebookView.mockResolvedValue(firmView(51));
    const first = EntityLinks.targetsPage('rulebook_rule', await answer('rulebook_rule'));
    expect(mockRules.rulebookView).toHaveBeenCalledWith({ actor, matterId: UUID });
    expect(first.candidates).toHaveLength(50);
    expect(first.candidates[0].label).toBe('mod.area.rule0: Rule 0 (Firm rule v3)');
    expect(first.candidates[0].description).toBe('Rulebook version 3');
    expect(posted('rulebook_rule', first.candidates[0].target)).toEqual({ kind: 'rulebook_rule', id: 'mod.area.rule0', record_id: RECORD, version: 3 });
    const second = EntityLinks.targetsPage('rulebook_rule', await answer('rulebook_rule', { cursor: first.nextCursor }));
    expect(second.candidates.map((c) => c.target.id)).toEqual(['mod.area.rule50']);
    expect(second.nextCursor).toBeNull();

    mockRules.rulebookView.mockRejectedValueOnce(Object.assign(new Error('off'), { code: 'ASSURANCE_DISABLED' }));
    const off = EntityLinks.targetsPage('rulebook_rule', await answer('rulebook_rule'));
    expect(off).toMatchObject({ available: false, candidates: [] });
    expect(off.reason).toMatch(/\S/);
  });

  test('starter rules: the lookup target is posted exactly, the models take it, and the chip reads Starter rule with its version', async () => {
    for (const jurisdiction of ['US-IN', null]) {
      mockRules.rulebookView.mockResolvedValue(starterView(jurisdiction));
      // eslint-disable-next-line no-await-in-loop
      const [rule] = EntityLinks.targetsPage('rulebook_rule', await answer('rulebook_rule')).candidates;
      const expected = { kind: 'rulebook_rule', id: 'mod.area.rule0', rulebook_basis: 'starter', starter_id: STARTER.id,
        starter_version: STARTER.version, starter_sha256: STARTER.sha256, jurisdiction };
      expect(rule.target).toEqual(expected);
      expect(rule.label).toBe('mod.area.rule0: Rule 0 (Starter rule v0.2.0-draft)');
      expect(rule.description).toBe('LANA starter rulebook 0.2.0-draft (' + (jurisdiction || 'foundation') + ')');
      expect(EntityLinks.createLinkRequest('MATT-1', NOTE, 'rulebook_rule', rule.target).body.target).toEqual(expected);
      expect(posted('rulebook_rule', rule.target)).toEqual(expected);
    }
    // The read payload (matter-links.service toLinkPayload) of a starter link, as the chip shows it.
    const kinds = backend('src/shared/contracts/link-kinds.contract.js');
    const read = { ...kinds.rulePinTarget('mod.area.rule0', { rulebook_basis: 'starter', starter_id: STARTER.id, starter_version: STARTER.version,
      starter_sha256: STARTER.sha256, jurisdiction: 'US-IN' }), pin_outdated: true };
    const [chip] = EntityLinks.ruleChips([{ id: 'l1', link_type: 'about', source: { kind: 'task', id: 't1' }, target: read }], { kind: 'task', id: 't1' });
    expect(chip).toMatchObject({ kindText: 'Starter rule', text: 'mod.area.rule0 (v0.2.0-draft)', outdated: true });
    const [firm] = EntityLinks.ruleChips([{ id: 'l2', link_type: 'about', source: { kind: 'task', id: 't1' },
      target: kinds.rulePinTarget('mod.area.rule0', { rulebook_record_id: RECORD, rulebook_version: 3, rulebook_sha256: 'b'.repeat(64) }) }], { kind: 'task', id: 't1' });
    expect(firm).toMatchObject({ kindText: 'Firm rule', text: 'mod.area.rule0 (v3)', outdated: false });
  });

  test('control: a starter target the client must never send (no sha256, a record id beside the starter) is refused by the models', () => {
    const good = { kind: 'rulebook_rule', id: 'mod.area.rule0', rulebook_basis: 'starter', starter_id: STARTER.id, starter_version: STARTER.version, starter_sha256: STARTER.sha256, jurisdiction: 'US-IN' };
    expect(links.createMatterLinkSchema.body.safeParse(EntityLinks.createLinkRequest('MATT-1', NOTE, 'rulebook_rule', good).body).success).toBe(true);
    expect(links.createMatterLinkSchema.body.safeParse(EntityLinks.createLinkRequest('MATT-1', NOTE, 'rulebook_rule', { ...good, starter_sha256: 'short' }).body).success).toBe(false);
    expect(links.createMatterLinkSchema.body.safeParse(EntityLinks.createLinkRequest('MATT-1', NOTE, 'rulebook_rule', { ...good, extra: 1 }).body).success).toBe(false);
  });

  test('control: the lookup query model refuses a kind the client must never ask for', () => {
    expect(links.listLinkTargetsSchema.query.safeParse({ kind: 'agent_run' }).success).toBe(false);
    expect(links.listLinkTargetsSchema.query.safeParse({ kind: 'contact', limit: '51' }).success).toBe(false);
  });
});

if (!backendDir) {
  test.skip('backend models not found (see the warning above)', () => {});
}

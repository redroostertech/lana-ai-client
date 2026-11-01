'use strict';

const EntityLinks = require('../../src/js/shared/entity-links.js');

const NOTE = { kind: 'matter_note', id: 'note-1' };

function link(id, target, source = NOTE, linkType = 'about') {
  return { id, link_type: linkType, source, target, created_by: 'u1', relationship_source: 'user' };
}

describe('entity-links', () => {
  test('picker offers asset, contact, document and rule; tasks and runs are not note targets', () => {
    expect(EntityLinks.pickerKindOptions()).toEqual([
      { value: 'matter_asset', label: 'Asset' },
      { value: 'contact', label: 'Contact' },
      { value: 'document', label: 'Document' },
      { value: 'rulebook_rule', label: 'Rule' },
    ]);
    expect(EntityLinks.PICKABLE_KINDS).not.toContain('agent_run');
    expect(EntityLinks.PICKABLE_KINDS).not.toContain('task');
  });

  test('documents are cited, everything a person picks is about', () => {
    expect(EntityLinks.defaultLinkType('document')).toBe('cites');
    expect(EntityLinks.defaultLinkType('contact')).toBe('about');
    expect(EntityLinks.defaultLinkType('rulebook_rule')).toBe('about');
    expect(EntityLinks.defaultLinkType('task')).toBe('about');
  });

  test('otherEnd returns the end that is not the note', () => {
    const contact = { kind: 'contact', id: 'c1' };
    expect(EntityLinks.otherEnd(link('l1', contact), NOTE)).toBe(contact);
    const task = { kind: 'task', id: 't1' };
    expect(EntityLinks.otherEnd(link('l2', NOTE, task), NOTE)).toBe(task);
  });

  describe('link target lookup pages', () => {
    const page = (kind, targets, extra = {}) => ({ status: 'success', data: { kind, targets, next_cursor: null, available: true, ...extra } });

    test('targetsRequest asks the Core lookup for one kind and page', () => {
      expect(EntityLinks.targetsRequest('MATT 1', 'contact')).toEqual({
        method: 'GET', path: '/api/v1/matters/MATT%201/links/targets?kind=contact&limit=50', body: null,
      });
      expect(EntityLinks.targetsRequest('M1', 'document', 'c/2').path).toBe('/api/v1/matters/M1/links/targets?kind=document&limit=50&cursor=c%2F2');
    });

    test('candidates keep the server target as is, with the server label', () => {
      expect(EntityLinks.toLinkCandidates('matter_asset', page('matter_asset', [
        { kind: 'matter_asset', id: 'a1', label: 'Checking account', description: 'bank_account', target: { kind: 'matter_asset', id: 'a1' } },
      ]))).toEqual([{ id: 'a1', label: 'Checking account', target: { kind: 'matter_asset', id: 'a1' } }]);
      expect(EntityLinks.toLinkCandidates('contact', page('contact', [
        { kind: 'contact', id: 'c1', label: 'Ada Lovelace', target: { kind: 'contact', id: 'c1' } },
        { kind: 'contact', id: 'c2', label: '', target: { kind: 'contact', id: '0123456789abcdef' } },
      ])).map((c) => c.label)).toEqual(['Ada Lovelace', 'Contact 01234567']);
    });

    test('rules are pinned to record and version, one candidate per pin', () => {
      const rule = (version) => ({
        kind: 'rulebook_rule', id: 'mod.area.slug', label: 'Inventory filed', description: 'Rulebook version ' + version,
        target: { kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-' + version, version },
      });
      expect(EntityLinks.toLinkCandidates('rulebook_rule', page('rulebook_rule', [rule(2), rule(3)]))).toEqual([
        { id: 'mod.area.slug@rb-2:2', label: 'mod.area.slug: Inventory filed (Firm rule v2)', description: 'Rulebook version 2', target: rule(2).target },
        { id: 'mod.area.slug@rb-3:3', label: 'mod.area.slug: Inventory filed (Firm rule v3)', description: 'Rulebook version 3', target: rule(3).target },
      ]);
    });

    test('a starter rule is its own candidate, labeled as the starter with its version, its target kept verbatim', () => {
      const target = { kind: 'rulebook_rule', id: 'mod.area.slug', rulebook_basis: 'starter', starter_id: 'starter-us-in',
        starter_version: '0.2.0-draft', starter_sha256: 'a'.repeat(64), jurisdiction: 'US-IN' };
      const firm = { kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-2', version: 2 };
      const [starter, record] = EntityLinks.toLinkCandidates('rulebook_rule', page('rulebook_rule', [
        { kind: 'rulebook_rule', id: 'mod.area.slug', label: 'Inventory filed', description: 'LANA starter rulebook 0.2.0-draft (US-IN)', target },
        { kind: 'rulebook_rule', id: 'mod.area.slug', label: 'Inventory filed', target: firm },
      ]));
      expect(starter).toEqual({ id: 'mod.area.slug@starter:starter-us-in:0.2.0-draft:' + 'a'.repeat(64),
        label: 'mod.area.slug: Inventory filed (Starter rule v0.2.0-draft)', description: 'LANA starter rulebook 0.2.0-draft (US-IN)', target });
      expect(record.id).not.toBe(starter.id);
      expect(EntityLinks.createLinkRequest('M1', NOTE, 'rulebook_rule', starter.target).body.target).toEqual(target);
    });

    test('documents carry their retained releases, each with its own target', () => {
      const target = { kind: 'document', id: 'd1', release_id: 'rel-1' };
      const [doc] = EntityLinks.toLinkCandidates('document', page('document', [{
        kind: 'document', id: 'd1', label: 'will.pdf', target: { kind: 'document', id: 'd1' },
        releases: [{ release_id: 'rel-1', release_number: 3, label: 'Release 3: will-signed.pdf', target }, { release_id: null }],
      }]));
      expect(doc).toEqual({
        id: 'd1', label: 'will.pdf', target: { kind: 'document', id: 'd1' },
        releases: [{ id: 'rel-1', label: 'Release 3: will-signed.pdf', target }],
      });
    });

    test('an unavailable kind keeps the reason; a later page has a cursor; bad rows and other kinds are dropped', () => {
      expect(EntityLinks.targetsPage('rulebook_rule', page('rulebook_rule', [], { available: false, reason: 'Rulebooks are off.' })))
        .toEqual({ candidates: [], nextCursor: null, available: false, reason: 'Rulebooks are off.' });
      expect(EntityLinks.targetsPage('contact', page('contact', [], { next_cursor: 'c9' })).nextCursor).toBe('c9');
      expect(EntityLinks.toLinkCandidates('contact', page('contact', [null, { id: 'x' }, { target: { kind: 'document', id: 'd1' } }]))).toEqual([]);
      expect(EntityLinks.toLinkCandidates('contact', null)).toEqual([]);
    });
  });

  describe('labels for link ends', () => {
    const index = EntityLinks.indexCandidates({}, 'contact', [{ id: 'c1', label: 'Ada Lovelace' }]);

    test('uses the loaded record name, then the kind and a short id', () => {
      expect(EntityLinks.endLabel({ kind: 'contact', id: 'c1' }, index)).toBe('Ada Lovelace');
      expect(EntityLinks.endLabel({ kind: 'contact', id: 'abcdef0123456789' }, index)).toBe('Contact abcdef01');
      expect(EntityLinks.endLabel({ kind: 'automation_execution', id: 'e1' }, index)).toBe('Automation run e1');
    });

    test('shows a rule by its id and names the pin a target carries', () => {
      expect(EntityLinks.endLabel({ kind: 'rulebook_rule', id: 'mod.area.slug' }, index)).toBe('mod.area.slug');
      expect(EntityLinks.endLabel({ kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-1', version: 2 }, index))
        .toBe('mod.area.slug (v2)');
      expect(EntityLinks.endLabel({ kind: 'rulebook_rule', id: 'mod.area.slug', rulebook_basis: 'starter', starter_version: '0.2.0' }, index))
        .toBe('mod.area.slug (v0.2.0)');
      expect(EntityLinks.endLabel({ kind: 'document', id: 'd1', release_id: 'rel-1', version: 3 }, { 'document:d1': 'will.pdf' }))
        .toBe('will.pdf (release 3)');
      expect(EntityLinks.endLabel({ kind: 'document', id: 'd1' }, { 'document:d1': 'will.pdf' })).toBe('will.pdf');
    });

    test('linkChips gives one chip per link with its kind and readable text', () => {
      const chips = EntityLinks.linkChips([
        link('l1', { kind: 'contact', id: 'c1' }),
        link('l2', { kind: 'rulebook_rule', id: 'mod.area.slug' }),
        { id: 'l3' },
      ], NOTE, index);
      expect(chips).toEqual([
        { id: 'l1', kind: 'contact', kindText: 'Contact', text: 'Ada Lovelace', title: 'Contact: Ada Lovelace', removable: true, outdated: false },
        { id: 'l2', kind: 'rulebook_rule', kindText: 'Rule', text: 'mod.area.slug', title: 'Rule: mod.area.slug', removable: true, outdated: false },
      ]);
      expect(EntityLinks.linkChips(undefined, NOTE, index)).toEqual([]);
    });

    test('ruleChips keeps only linked rules, with their pinned rulebook version (Board cards)', () => {
      const TASK = { kind: 'task', id: 't1' };
      const taskLink = (id, target, type) => ({ id, link_type: type || 'about', source: TASK, target });
      const chips = EntityLinks.ruleChips([
        taskLink('l1', { kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-1', version: 3 }),
        taskLink('l2', { kind: 'contact', id: 'c1' }),
        taskLink('l3', { kind: 'agent_run', id: 'run-1' }, 'produced_by'),
      ], TASK);
      expect(chips.map((chip) => chip.text)).toEqual(['mod.area.slug (v3)']);
      expect(chips[0]).toMatchObject({ kindText: 'Firm rule', title: 'Firm rule: mod.area.slug (v3)', outdated: false });
      expect(EntityLinks.ruleChips(undefined, TASK)).toEqual([]);
    });

    test('starter rule chips say Starter rule with the version, and flag pin_outdated (control: a current pin is not flagged)', () => {
      const TASK = { kind: 'task', id: 't1' };
      const starter = (outdated) => ({ id: outdated ? 'old' : 'now', link_type: 'about', source: TASK,
        target: { kind: 'rulebook_rule', id: 'mod.area.slug', rulebook_basis: 'starter', starter_id: 's', starter_version: '0.2.0-draft',
          starter_sha256: 'a'.repeat(64), jurisdiction: null, pin_outdated: outdated } });
      const [old, now] = EntityLinks.ruleChips([starter(true), starter(false)], TASK);
      expect(old).toMatchObject({ kindText: 'Starter rule', text: 'mod.area.slug (v0.2.0-draft)', outdated: true });
      expect(old.title).toBe('Starter rule: mod.area.slug (v0.2.0-draft). Rulebook text changed since this link was made');
      expect(now).toMatchObject({ kindText: 'Starter rule', outdated: false, title: 'Starter rule: mod.area.slug (v0.2.0-draft)' });
      expect(EntityLinks.PIN_OUTDATED_TEXT).toBe('Rulebook text changed');
    });

    test('server-written produced_by links are shown but not removable', () => {
      const [chip] = EntityLinks.linkChips([
        link('l9', { kind: 'agent_run', id: 'abcdef0123456789' }, NOTE, 'produced_by'),
      ], NOTE, index);
      expect(chip).toEqual({ id: 'l9', kind: 'agent_run', kindText: 'Agent run', text: 'abcdef01', title: 'Agent run: abcdef01', removable: false, outdated: false, run: { kind: 'agent_run', id: 'abcdef0123456789' } });
    });

    test('kindsNeedingLookup lists only fetchable kinds the notes point at', () => {
      const notes = [
        { note_id: 'note-1', links: [link('l1', { kind: 'contact', id: 'c1' }), link('l2', { kind: 'rulebook_rule', id: 'r' })] },
        { note_id: 'note-2', links: [link('l3', { kind: 'document', id: 'd1' }, { kind: 'matter_note', id: 'note-2' })] },
        { note_id: 'note-3' },
      ];
      expect(EntityLinks.kindsNeedingLookup(notes, 'matter_note')).toEqual(['contact', 'document']);
    });
  });

  describe('requests', () => {
    test('createLinkRequest posts the link type, source and the target exactly as picked', () => {
      expect(EntityLinks.createLinkRequest('MATT 1', NOTE, 'document', { id: 'd1' })).toEqual({
        method: 'POST',
        path: '/api/v1/matters/MATT%201/links',
        body: { link_type: 'cites', source: { kind: 'matter_note', id: 'note-1' }, target: { kind: 'document', id: 'd1' } },
      });
    });

    test('a document citation pins the retained release when one is chosen', () => {
      expect(EntityLinks.createLinkRequest('M1', NOTE, 'document', { id: 'd1', release_id: 'rel-1' }).body.target)
        .toEqual({ kind: 'document', id: 'd1', release_id: 'rel-1' });
    });

    test('the lookup target is sent as is (rule pin, release); the kind is the one picked', () => {
      expect(EntityLinks.createLinkRequest('M1', NOTE, 'rulebook_rule', { kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-1', version: 2 }).body).toEqual({
        link_type: 'about', source: { kind: 'matter_note', id: 'note-1' },
        target: { kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-1', version: 2 },
      });
      expect(EntityLinks.createLinkRequest('M1', NOTE, 'contact', { id: 'c1' }).body.target).toEqual({ kind: 'contact', id: 'c1' });
    });

    test('removeLinkRequest deletes the link by id', () => {
      expect(EntityLinks.removeLinkRequest('M1', 'link/1')).toEqual({
        method: 'DELETE', path: '/api/v1/matters/M1/links/link%2F1', body: null,
      });
    });
  });

  describe('linkErrorMessage', () => {
    const err = (status, code, message = 'x') => ({ status, code, message });

    test('words the refusals a person can act on', () => {
      expect(EntityLinks.linkErrorMessage(err(404, 'NOT_FOUND'), 'contact', 'add'))
        .toBe('That contact is not on this matter, or you cannot see it.');
      expect(EntityLinks.linkErrorMessage(err(404, 'NOT_FOUND'), 'rulebook_rule', 'add'))
        .toBe('That rule is not in the rulebook this matter applies, or its text has changed. Pick it again from the list.');
      expect(EntityLinks.linkErrorMessage(err(404, 'NOT_FOUND'), 'document', 'add'))
        .toBe('That document or release is not on this matter, or you cannot open it.');
      expect(EntityLinks.linkErrorMessage(err(422, 'LINK_KIND_NOT_LINKABLE'), 'agent_run', 'add'))
        .toBe('Agent run records are linked by the server when they produce a note, not by hand.');
      expect(EntityLinks.linkErrorMessage(err(403, 'AUTHORIZATION_ERROR'), 'task', 'add'))
        .toBe('You do not have permission to change links on this matter.');
      expect(EntityLinks.linkErrorMessage(err(409, 'LINK_CONFLICT'), 'task', 'add')).toBe('The link could not be saved. Try again.');
    });

    test('403 PRIVILEGE_DISCLOSURE_BLOCKED says the document is restricted (control arm: another 403 is permission)', () => {
      const blocked = 'This document is restricted and cannot be cited here.';
      expect(EntityLinks.linkErrorMessage(err(403, 'PRIVILEGE_DISCLOSURE_BLOCKED'), 'document', 'add')).toBe(blocked);
      expect(EntityLinks.linkErrorMessage({ status: 403, data: { error: { code: 'PRIVILEGE_DISCLOSURE_BLOCKED' } } }, 'document', 'add')).toBe(blocked);
      expect(EntityLinks.linkErrorMessage(err(403, 'MATTER_ACCESS_DENIED'), 'document', 'add'))
        .toBe('You do not have permission to change links on this matter.');
    });

    test('a specific 400 message passes through; the generic one does not', () => {
      expect(EntityLinks.linkErrorMessage(err(400, 'VALIDATION_ERROR', 'A contact link cannot join a task to a contact'), 'contact', 'add'))
        .toBe('A contact link cannot join a task to a contact');
      expect(EntityLinks.linkErrorMessage(err(400, 'VALIDATION_ERROR', 'Validation failed'), 'contact', 'add'))
        .toBe('The link could not be added. Try again.');
      expect(EntityLinks.linkErrorMessage(new Error('Network error occurred'), 'contact', 'add'))
        .toBe('The link could not be added. Try again.');
    });

    test('remove refusals', () => {
      expect(EntityLinks.linkErrorMessage(err(404, 'NOT_FOUND'), null, 'remove')).toBe('That link was already removed.');
      expect(EntityLinks.linkErrorMessage(err(500, 'INTERNAL_ERROR'), null, 'remove')).toBe('The link could not be removed. Try again.');
    });
  });

  test('a document citation chip can be re-pinned; other chips cannot', () => {
    const self = { kind: 'matter_note', id: 'n1' };
    const chips = EntityLinks.linkChips([
      { id: 'l1', link_type: 'cites', source: self, target: { kind: 'document', id: 'd1', release_id: 'rel-2', version: 2 } },
      { id: 'l2', link_type: 'cites', source: self, target: { kind: 'document', id: 'd2' } },
      { id: 'l3', link_type: 'about', source: self, target: { kind: 'contact', id: 'c1' } },
    ], self, {});
    expect(chips[0].repin).toEqual({ documentId: 'd1', releaseId: 'rel-2' });
    expect(chips[1].repin).toEqual({ documentId: 'd2', releaseId: '' });
    expect(chips[2].repin).toBeUndefined();
  });

  test('produced_by chips name the run for "Why did this run?"; ids and kinds only', () => {
    const self = { kind: 'task', id: 't1' };
    const chips = EntityLinks.linkChips([
      { id: 'l1', link_type: 'produced_by', source: self, target: { kind: 'agent_run', id: 'r1' } },
      { id: 'l2', link_type: 'produced_by', source: self, target: { kind: 'automation_execution', id: 'e1' } },
      { id: 'l3', link_type: 'about', source: self, target: { kind: 'agent_run', id: 'r2' } },
      { id: 'l4', link_type: 'produced_by', source: self, target: { kind: 'matter_note', id: 'n9' } },
    ], self, {});
    expect(chips.map((c) => c.run || null)).toEqual([
      { kind: 'agent_run', id: 'r1' }, { kind: 'automation_execution', id: 'e1' }, null, null,
    ]);
    expect(chips[0].removable).toBe(false);
  });

  test('repinMessage names the pin the server now holds', () => {
    const answer = (target) => ({ status: 'success', data: { link: { id: 'l1', target } } });
    expect(EntityLinks.repinMessage('rel-1', answer({ kind: 'document', id: 'd1', release_id: 'rel-2', version: 3 }))).toBe('Now cites release 3');
    expect(EntityLinks.repinMessage('', answer({ kind: 'document', id: 'd1', release_id: 'rel-2' }))).toBe('Now cites release rel-2');
    expect(EntityLinks.repinMessage('rel-1', answer({ kind: 'document', id: 'd1' }))).toBe('The note no longer cites a retained release');
    expect(EntityLinks.repinMessage('rel-1', answer({ kind: 'document', id: 'd1', release_id: 'rel-1', version: 1 }))).toBe('Citation unchanged');
    expect(EntityLinks.repinMessage('rel-1', null)).toBe('Citation saved');
  });
});


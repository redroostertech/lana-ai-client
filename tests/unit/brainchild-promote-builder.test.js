const path = require('path');

const builder = require(path.join(
  __dirname,
  '../../src/js/shared/brainchild-promote-builder.js'
));

function makeRow(overrides) {
  return Object.assign({
    id: 'brainchild:Notes/idea.md',
    filename: 'Big Idea',
    file_type: 'Note',
    _kind: 'brainchild',
    _scope: 'my',
    _vaultPath: 'Notes/idea.md'
  }, overrides || {});
}

function makeNote(overrides) {
  return Object.assign({
    body: 'The full note body that should be promoted.',
    frontmatter: { type: 'idea', date: '2026-06-09' },
    created_at: '2026-01-01T00:00:00.000Z',
    modified: '2026-06-01T00:00:00.000Z'
  }, overrides || {});
}

function makeUser(overrides) {
  return Object.assign({
    id: '11111111-1111-1111-1111-111111111111',
    email: 'analyst@firm.test',
    organizationId: '22222222-2222-2222-2222-222222222222'
  }, overrides || {});
}

describe('brainchild-promote-builder', () => {
  describe('resolveOrgId', () => {
    test('reads loadUserProfile shape (organizationId)', () => {
      expect(builder.resolveOrgId({ organizationId: 'org-a' })).toBe('org-a');
    });

    test('reads raw API DTO shapes (org_id / organization_id)', () => {
      expect(builder.resolveOrgId({ org_id: 'org-b' })).toBe('org-b');
      expect(builder.resolveOrgId({ organization_id: 'org-c' })).toBe('org-c');
    });

    test('trims surrounding whitespace', () => {
      expect(builder.resolveOrgId({ organizationId: '  org-d  ' })).toBe('org-d');
    });

    test('throws when user is missing', () => {
      expect(() => builder.resolveOrgId(null)).toThrow('Missing user');
    });

    test('throws when org is absent (org-isolation precondition)', () => {
      expect(() => builder.resolveOrgId({ id: 'u1' })).toThrow('not in an organization');
    });
  });

  describe('canPromote (enabled-when-authenticated gate)', () => {
    const bridge = {};
    const user = makeUser();

    test('enabled only when authenticated AND bridged AND in an org', () => {
      expect(builder.canPromote({ authenticated: true, user, bridge })).toBe(true);
    });

    test('disabled when not authenticated', () => {
      expect(builder.canPromote({ authenticated: false, user, bridge })).toBe(false);
      expect(builder.canPromote({ authenticated: undefined, user, bridge })).toBe(false);
    });

    test('disabled when the brainchild bridge is unavailable (browser context)', () => {
      expect(builder.canPromote({ authenticated: true, user, bridge: null })).toBe(false);
    });

    test('disabled when the user has no organization', () => {
      expect(builder.canPromote({ authenticated: true, user: { id: 'u1' }, bridge })).toBe(false);
    });

    test('disabled on empty / missing context', () => {
      expect(builder.canPromote()).toBe(false);
      expect(builder.canPromote({})).toBe(false);
    });

    test('is NON-AUTHORITATIVE: a forged client context flips the gate, proving it is not a security boundary (the LANA-AI backend re-derives org from the JWT and enforces knowledge:promote)', () => {
      // The gate reads only client-supplied values, so an attacker can trivially
      // make it return true. This is acceptable BECAUSE the server is the sole
      // authority. This test documents that contract so no future change starts
      // treating canPromote as access control.
      const forged = { authenticated: true, user: makeUser(), bridge: {} };
      expect(builder.canPromote(forged)).toBe(true);
    });
  });

  describe('buildPromotePayload', () => {
    test('happy path produces backend-shaped { orgId, userId, body }', () => {
      const out = builder.buildPromotePayload(makeRow(), makeNote(), makeUser());
      expect(out.orgId).toBe('22222222-2222-2222-2222-222222222222');
      expect(out.userId).toBe('11111111-1111-1111-1111-111111111111');
      expect(out.body).toEqual({
        note_id: 'Notes/idea.md',
        note_title: 'Big Idea',
        note_content: 'The full note body that should be promoted.',
        vault: 'Notes/idea.md'
      });
    });

    test('result is JSON-serializable (flat DTO)', () => {
      const out = builder.buildPromotePayload(makeRow(), makeNote(), makeUser());
      expect(() => JSON.stringify(out.body)).not.toThrow();
    });

    test('org isolation: throws when user has no organization', () => {
      expect(() =>
        builder.buildPromotePayload(makeRow(), makeNote(), { id: 'u1' })
      ).toThrow('not in an organization');
    });

    test('throws on missing row / note / user', () => {
      expect(() => builder.buildPromotePayload(null, makeNote(), makeUser())).toThrow('Missing note row');
      expect(() => builder.buildPromotePayload(makeRow(), null, makeUser())).toThrow('Missing note body');
      expect(() => builder.buildPromotePayload(makeRow(), makeNote(), null)).toThrow('Missing user');
    });

    test('throws when the note body is empty (matches backend reject)', () => {
      expect(() =>
        builder.buildPromotePayload(makeRow(), makeNote({ body: '   ' }), makeUser())
      ).toThrow('no content');
      expect(() =>
        builder.buildPromotePayload(makeRow(), makeNote({ body: '' }), makeUser())
      ).toThrow('no content');
    });

    test('defaults a blank title to "Untitled Note"', () => {
      const out = builder.buildPromotePayload(makeRow({ filename: '   ' }), makeNote(), makeUser());
      expect(out.body.note_title).toBe('Untitled Note');
    });

    test('falls back note_id to the title when no vault path is present', () => {
      const row = makeRow({ _vaultPath: '' });
      const out = builder.buildPromotePayload(row, makeNote(), makeUser());
      expect(out.body.note_id).toBe('Big Idea');
      expect(out.body).not.toHaveProperty('vault');
    });

    test('preserves special characters in title and content (no escaping in the builder)', () => {
      const row = makeRow({ filename: 'M&A <Strategy> "Q3"' });
      const note = makeNote({ body: 'Clause: a < b && c > d — "quote"' });
      const out = builder.buildPromotePayload(row, note, makeUser());
      expect(out.body.note_title).toBe('M&A <Strategy> "Q3"');
      expect(out.body.note_content).toBe('Clause: a < b && c > d — "quote"');
    });

    test('content exactly at the backend max is allowed (no throw, no truncation)', () => {
      const exact = 'x'.repeat(builder.LIMITS.NOTE_CONTENT_MAX);
      const out = builder.buildPromotePayload(makeRow(), makeNote({ body: exact }), makeUser());
      expect(out.body.note_content.length).toBe(builder.LIMITS.NOTE_CONTENT_MAX);
    });

    test('throws on over-long content instead of silently truncating (no partial promote)', () => {
      const huge = 'x'.repeat(builder.LIMITS.NOTE_CONTENT_MAX + 1);
      expect(() =>
        builder.buildPromotePayload(makeRow(), makeNote({ body: huge }), makeUser())
      ).toThrow('too long to promote');
    });

    test('clamps over-long title and note_id to their backend maxima', () => {
      const longTitle = 'T'.repeat(builder.LIMITS.NOTE_TITLE_MAX + 50);
      const longPath = 'p/'.repeat(builder.LIMITS.NOTE_ID_MAX); // well over 255
      const out = builder.buildPromotePayload(
        makeRow({ filename: longTitle, _vaultPath: longPath }),
        makeNote(),
        makeUser()
      );
      expect(out.body.note_title.length).toBe(builder.LIMITS.NOTE_TITLE_MAX);
      expect(out.body.note_id.length).toBe(builder.LIMITS.NOTE_ID_MAX);
      expect(out.body.vault.length).toBe(builder.LIMITS.VAULT_MAX);
    });
  });
});

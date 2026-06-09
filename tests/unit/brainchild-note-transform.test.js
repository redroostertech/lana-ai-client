/**
 * Phase B note→row transform: the brainchild MCP `list_notes` tool returns
 * note DTOs shaped { path, title, tags, ... } (no timestamps — see
 * brainchild/src/index-builder.js#list()). The renderer feeds those straight
 * into the shared mapper. This test pins that the mapper shapes them into
 * library rows identically and de-duplicates by vault path, with no client-side
 * dedup required in fetchBrainchildNotes (per renderer spec pitfall).
 */

const path = require('path');

const mapper = require(path.join(__dirname, '../../src/js/shared/document-library-mapper.js'));

describe('brainchild note → library row transform (MCP list_notes shape)', () => {
  test('shapes a list_notes DTO with no timestamps into a brainchild row', () => {
    const dto = { path: 'Daily/2026-06-09.md', title: 'Tuesday, June 9, 2026', tags: ['daily'] };
    const row = mapper.normalizeBrainchildRow(dto, 'my');

    expect(row).toMatchObject({
      id: 'brainchild:Daily/2026-06-09.md',
      filename: 'Tuesday, June 9, 2026',
      file_type: 'Note',
      matter: 'Personal',
      is_template: 'No',
      _kind: 'brainchild',
      _scope: 'my',
      _vaultPath: 'Daily/2026-06-09.md'
    });
    // No timestamps in list_notes — mapper degrades to empty strings, not crash.
    expect(row.created_at).toBe('');
    expect(row.updated_at).toBe('');
  });

  test('normalizeLibraryItems de-duplicates notes by vault path', () => {
    const notes = [
      { path: 'A.md', title: 'A' },
      { path: 'B.md', title: 'B' },
      { path: 'A.md', title: 'A duplicate' } // same vault path → dropped
    ];
    const rows = mapper.normalizeLibraryItems({ notes }, 'my');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r._vaultPath).sort()).toEqual(['A.md', 'B.md']);
  });

  test('brainchild note ids never collide with numeric storage ids', () => {
    const rows = mapper.normalizeLibraryItems({
      documents: [{ id: 42, filename: 'doc.pdf' }],
      notes: [{ path: '42', title: 'note named 42' }]
    }, 'org');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('storage:42');
    expect(ids).toContain('brainchild:42');
    // Distinct key spaces — both survive.
    expect(rows).toHaveLength(2);
  });

  test('uses updated_at/modified fallback when present', () => {
    const row = mapper.normalizeBrainchildRow(
      { path: 'X.md', title: 'X', modified: '2026-06-01T00:00:00Z' },
      'my'
    );
    expect(row.updated_at).toBe('2026-06-01T00:00:00Z');
  });
});

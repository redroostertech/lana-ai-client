const path = require('path');

const mapper = require(path.join(
  __dirname,
  '../../src/js/shared/document-library-mapper.js'
));

describe('document-library-mapper', () => {
  describe('fileExtension', () => {
    test('returns uppercase extension', () => {
      expect(mapper.fileExtension('Report.final.pdf')).toBe('PDF');
      expect(mapper.fileExtension('notes.MD')).toBe('MD');
    });

    test('strips query strings and handles missing extension', () => {
      expect(mapper.fileExtension('deck.pptx?token=abc')).toBe('PPTX');
      expect(mapper.fileExtension('README')).toBe('');
      expect(mapper.fileExtension('')).toBe('');
      expect(mapper.fileExtension(null)).toBe('');
    });
  });

  describe('humanFileType', () => {
    test('maps known mime types to friendly labels', () => {
      expect(mapper.humanFileType({ content_type: 'application/pdf' })).toBe('PDF');
      expect(mapper.humanFileType({ file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('DOCX');
      expect(mapper.humanFileType({ file_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe('PPTX');
      expect(mapper.humanFileType({ content_type: 'text/html' })).toBe('HTML');
    });

    test('title-cases snake-case document types', () => {
      expect(mapper.humanFileType({ document_type: 'settlement_agreement' })).toBe('Settlement Agreement');
    });

    test('falls back to filename extension then Document', () => {
      expect(mapper.humanFileType({ filename: 'brief.docx' })).toBe('DOCX');
      expect(mapper.humanFileType({})).toBe('Document');
    });

    test('maps legacy msword mime to DOCX', () => {
      expect(mapper.humanFileType({ content_type: 'application/msword' })).toBe('DOCX');
    });

    test('upper-cases the subtype for unknown slash mime types', () => {
      expect(mapper.humanFileType({ file_type: 'image/png' })).toBe('PNG');
    });
  });

  describe('titleToFilename', () => {
    test('slugifies title and applies extension', () => {
      expect(mapper.titleToFilename('Quarterly Board Update', 'pdf')).toBe('quarterly-board-update.pdf');
    });

    test('collapses non-alphanumerics and trims edges', () => {
      expect(mapper.titleToFilename('  Hello -- World!! ', 'html')).toBe('hello-world.html');
    });

    test('defaults extension and empty title', () => {
      expect(mapper.titleToFilename('', undefined)).toBe('untitled.txt');
    });
  });

  describe('normalizeStorageRow scope dimension', () => {
    const doc = {
      id: 42,
      filename: 'msa.pdf',
      content_type: 'application/pdf',
      matter_name: 'Acme v. Globex',
      is_template: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z'
    };

    test('stamps the provided scope and tags _kind storage', () => {
      const row = mapper.normalizeStorageRow(doc, 'org');
      expect(row._kind).toBe('storage');
      expect(row._scope).toBe('org');
      expect(row.id).toBe('storage:42');
      expect(row.file_type).toBe('PDF');
      expect(row.matter).toBe('Acme v. Globex');
      expect(row.is_template).toBe('Yes');
      expect(row._fileId).toBe(42);
    });

    test('defaults scope to org when omitted', () => {
      expect(mapper.normalizeStorageRow(doc)._scope).toBe('org');
    });
  });

  describe('normalizePresentationRow', () => {
    test('labels deck-backed presentations as Doc Studio Draft', () => {
      const row = mapper.normalizePresentationRow({
        id: 7,
        title: 'Pitch',
        deck: { document: { metadata: { matter_name: 'Internal' } } }
      }, 'org');
      expect(row._kind).toBe('deck');
      expect(row._scope).toBe('org');
      expect(row.file_type).toBe('Doc Studio Draft');
      expect(row.matter).toBe('Internal');
      expect(row.filename).toBe('pitch.pdf');
    });

    test('labels deckless presentations as Presentation', () => {
      const row = mapper.normalizePresentationRow({ id: 8, title: 'Roadmap' }, 'org');
      expect(row.file_type).toBe('Presentation');
      expect(row.filename).toBe('roadmap.html');
      expect(row.matter).toBe('Doc Studio');
    });

    test('filename precedence: explicit p.filename wins over everything', () => {
      const row = mapper.normalizePresentationRow({
        id: 9,
        title: 'Slug Title',
        filename: 'explicit-name.pdf',
        deck: { document: { file_name: 'deck-name.pdf', metadata: { filename: 'meta-name.pdf' } } }
      }, 'org');
      expect(row.filename).toBe('explicit-name.pdf');
    });

    test('filename precedence: deck.document.file_name wins over metadata + slug', () => {
      const row = mapper.normalizePresentationRow({
        id: 10,
        title: 'Slug Title',
        deck: { document: { file_name: 'deck-name.pdf', metadata: { filename: 'meta-name.pdf' } } }
      }, 'org');
      expect(row.filename).toBe('deck-name.pdf');
    });

    test('filename precedence: deck.document.metadata.filename wins over slug fallback', () => {
      const row = mapper.normalizePresentationRow({
        id: 11,
        title: 'Slug Title',
        deck: { document: { metadata: { filename: 'meta-name.pdf' } } }
      }, 'org');
      expect(row.filename).toBe('meta-name.pdf');
    });
  });

  describe('normalizeBrainchildRow scope dimension', () => {
    test('maps a vault note with my scope and path key', () => {
      const row = mapper.normalizeBrainchildRow({
        title: 'Trial Strategy',
        path: 'matters/acme/strategy.md',
        modified: '2026-03-01T00:00:00Z'
      });
      expect(row._kind).toBe('brainchild');
      expect(row._scope).toBe('my');
      expect(row.id).toBe('brainchild:matters/acme/strategy.md');
      expect(row.file_type).toBe('Note');
      expect(row.matter).toBe('Personal');
      expect(row._vaultPath).toBe('matters/acme/strategy.md');
      expect(row.updated_at).toBe('2026-03-01T00:00:00Z');
    });
  });

  describe('normalizeLibraryItems', () => {
    test('merges storage + presentations and de-duplicates by file id', () => {
      const rows = mapper.normalizeLibraryItems({
        documents: [{ id: 100, filename: 'a.pdf', content_type: 'application/pdf' }],
        presentations: [
          { id: 1, title: 'Dup', deck: { document: { metadata: { file_id: 100 } } } },
          { id: 2, title: 'Unique' }
        ]
      }, 'org');

      // storage row + the one non-duplicate presentation
      expect(rows).toHaveLength(2);
      expect(rows[0]._kind).toBe('storage');
      expect(rows[1]._kind).toBe('deck');
      expect(rows[1]._source.title).toBe('Unique');
      rows.forEach((row) => expect(row._scope).toBe('org'));
    });

    test('dedup drops only the file-id collision and keeps presentations with no file id', () => {
      const rows = mapper.normalizeLibraryItems({
        documents: [{ id: 100, filename: 'a.pdf', content_type: 'application/pdf' }],
        presentations: [
          // collides with storage file id 100 -> dropped
          { id: 1, title: 'Dup', deck: { document: { metadata: { file_id: 100 } } } },
          // no file id -> kept even though a storage row exists
          { id: 2, title: 'No File Id' }
        ]
      }, 'org');

      const deckRows = rows.filter((r) => r._kind === 'deck');
      expect(deckRows).toHaveLength(1);
      expect(deckRows[0]._source.title).toBe('No File Id');
      expect(rows.some((r) => r._kind === 'deck' && r._source.title === 'Dup')).toBe(false);
    });

    test('brainchild notes de-duplicate by vault path, not file id', () => {
      const rows = mapper.normalizeLibraryItems({
        documents: [{ id: 5, filename: 'doc.pdf' }],
        notes: [
          { title: 'Note A', path: 'a.md' },
          { title: 'Note A again', path: 'a.md' },
          { title: 'Note B', path: 'b.md' }
        ]
      }, 'my');

      const noteRows = rows.filter((r) => r._kind === 'brainchild');
      expect(noteRows).toHaveLength(2);
      expect(noteRows.map((r) => r._vaultPath).sort()).toEqual(['a.md', 'b.md']);
      // storage id 5 must not suppress note rows (different key space)
      expect(rows.some((r) => r._kind === 'storage' && r._fileId === 5)).toBe(true);
      rows.forEach((row) => expect(row._scope).toBe('my'));
    });

    test('handles empty / missing payload without throwing', () => {
      expect(mapper.normalizeLibraryItems(null, 'org')).toEqual([]);
      expect(mapper.normalizeLibraryItems({}, 'my')).toEqual([]);
    });

    test('defaults scope to org', () => {
      const rows = mapper.normalizeLibraryItems({
        documents: [{ id: 1, filename: 'x.pdf' }]
      });
      expect(rows[0]._scope).toBe('org');
    });
  });
});

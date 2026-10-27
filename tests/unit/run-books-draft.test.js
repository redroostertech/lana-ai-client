'use strict';

/**
 * run-books-draft.js, the pure half of the Run Books admin page.
 *
 * A run book is org-wide, curated evidence: an assertion that THIS IS HOW WE
 * OPERATE. The rules these tests pin are the ones that keep that true in the
 * UI: nothing is silently dropped, no title is invented, and a refusal always
 * carries the backend's own reason rather than "unsupported file type".
 *
 * The reference implementation is lana-ai-chef:
 *   src/services/run-books/run-book-format-policy.js
 *   src/services/run-books/run-book-segmentation.js
 */

const { JSDOM } = require('jsdom');

const RunBookDraft = require('../../src/js/admin/run-books-draft');

// Shaped exactly like GET /api/v1/admin/run-books/formats, trimmed to the
// groups these tests need. Reasons and notes are the backend's sentences.
const FORMATS = {
  supported: [
    {
      kind: 'md',
      label: 'Markdown',
      extensions: ['.md', '.markdown'],
      structure: 'authored',
      splits_into_entries: true,
      note: 'Headings are real boundaries a person chose. One heading becomes one run book entry.'
    },
    {
      kind: 'txt',
      label: 'Plain text',
      extensions: ['.txt'],
      structure: 'none',
      splits_into_entries: false,
      note: 'No structure to read, so the whole file becomes one entry and an admin titles it.'
    },
    {
      kind: 'docx',
      label: 'Word document',
      extensions: ['.docx'],
      structure: 'declared',
      splits_into_entries: true,
      note: 'Heading styles exist but authors apply them inconsistently. Boundaries are proposed, never assumed.'
    },
    {
      kind: 'pdf',
      label: 'PDF',
      extensions: ['.pdf'],
      structure: 'none',
      splits_into_entries: false,
      note: 'Extraction reflows lines and preserves no semantic boundaries. One PDF is always one entry.'
    }
  ],
  refused: [
    {
      extensions: ['.csv', '.xls', '.xlsx'],
      reason: 'A spreadsheet is a grid of values, not a procedure. Export the part that describes how you work as Markdown.'
    },
    {
      extensions: ['.ppt', '.pptx'],
      reason: 'Slides are fragments. Bullet points without sentences cannot support a claim, so they make poor evidence.'
    }
  ],
  extensions: ['.docx', '.markdown', '.md', '.pdf', '.txt'],
  limits: {
    max_upload_bytes: 26214400,
    min_entry_chars: 120,
    max_entry_chars: 200000,
    max_entries_per_upload: 500
  }
};

const INDEX = RunBookDraft.buildFormatIndex(FORMATS);

function htmlParser() {
  return new (new JSDOM('').window.DOMParser)();
}

describe('what may become a run book', () => {
  test.each([
    ['.md', 'onboarding.md', 'authored', true],
    ['.markdown', 'onboarding.markdown', 'authored', true],
    ['.docx', 'handbook.docx', 'declared', true],
    ['.pdf', 'policy.pdf', 'none', false],
    ['.txt', 'notes.txt', 'none', false]
  ])('accepts %s and reports the structure the backend declared', (_ext, filename, structure, splits) => {
    const verdict = RunBookDraft.classifyFile({ filename, sizeBytes: 4096 }, INDEX);

    expect(verdict.accepted).toBe(true);
    expect(verdict.structure).toBe(structure);
    expect(verdict.splitsIntoEntries).toBe(splits);
    // The note is the sentence the review screen uses to explain why a PDF
    // became one entry. It must come back untouched.
    expect(verdict.note).toBe(
      FORMATS.supported.find((spec) => spec.extensions.includes(_ext)).note
    );
  });

  test('refuses a spreadsheet with the server\'s own sentence, not "unsupported file type"', () => {
    const verdict = RunBookDraft.classifyFile({ filename: 'rates.xlsx', sizeBytes: 900 }, INDEX);

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(FORMATS.refused[0].reason);
  });

  test('every refused extension in the payload is refused, each with its group reason', () => {
    for (const group of FORMATS.refused) {
      for (const extension of group.extensions) {
        const verdict = RunBookDraft.classifyFile(
          { filename: 'file' + extension, sizeBytes: 10 },
          INDEX
        );
        expect(verdict.accepted).toBe(false);
        expect(verdict.reason).toBe(group.reason);
      }
    }
  });

  test('refuses a file with no extension', () => {
    const verdict = RunBookDraft.classifyFile({ filename: 'README', sizeBytes: 10 }, INDEX);

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(
      'The file has no extension, so there is no way to tell what it is.'
    );
  });

  test('refuses an extension nobody listed, and names what is supported', () => {
    const verdict = RunBookDraft.classifyFile({ filename: 'notes.odt', sizeBytes: 10 }, INDEX);

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(
      '.odt is not a run book format. Supported: .docx, .markdown, .md, .pdf, .txt.'
    );
  });

  test('refuses a file over the upload ceiling, and says the ceiling in MB', () => {
    const verdict = RunBookDraft.classifyFile(
      { filename: 'handbook.pdf', sizeBytes: FORMATS.limits.max_upload_bytes + 1 },
      INDEX
    );

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(
      'The file is larger than 25 MB. A run book entry is a procedure, not an archive.'
    );
  });

  test('a file exactly at the ceiling is accepted', () => {
    // Control arm for the size check: without this, "refuses everything" and
    // "refuses what is too big" look identical.
    const verdict = RunBookDraft.classifyFile(
      { filename: 'handbook.pdf', sizeBytes: FORMATS.limits.max_upload_bytes },
      INDEX
    );

    expect(verdict.accepted).toBe(true);
  });

  test('refuses a scanned PDF, because we will not attest to text we guessed at', () => {
    const verdict = RunBookDraft.classifyFile(
      { filename: 'scan.pdf', sizeBytes: 900, hasTextLayer: false },
      INDEX
    );

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe(
      'This PDF has no text layer, so it is a scan. We will not put text we guessed at into your run book. Provide the source document.'
    );
  });

  test('the scanned-PDF check is skipped until extraction has answered it', () => {
    // hasTextLayer is only known after the renderer has read the file, so the
    // first pass must not refuse a PDF for a question nobody has asked yet.
    expect(RunBookDraft.classifyFile({ filename: 'policy.pdf', sizeBytes: 900 }, INDEX).accepted)
      .toBe(true);
    expect(
      RunBookDraft.classifyFile(
        { filename: 'policy.pdf', sizeBytes: 900, hasTextLayer: true },
        INDEX
      ).accepted
    ).toBe(true);
  });

  test('extension reading is case-insensitive and ignores dots inside the name', () => {
    expect(RunBookDraft.extensionOf('Employee Handbook.DOCX')).toBe('.docx');
    expect(RunBookDraft.extensionOf('v1.2.final.md')).toBe('.md');
    expect(RunBookDraft.extensionOf('.gitignore')).toBe('');
    expect(RunBookDraft.extensionOf('')).toBe('');
    expect(RunBookDraft.extensionOf(null)).toBe('');
  });

  test('the file picker offers exactly the extensions the server listed', () => {
    expect(RunBookDraft.acceptAttribute(INDEX)).toBe('.docx,.markdown,.md,.pdf,.txt');
  });
});

describe('reading a Word document without inventing structure', () => {
  test('heading styles survive as markdown headings, so the backend can split on them', () => {
    // A .docx heading style is a boundary the author declared. If extraction
    // flattened it, the whole handbook would collapse into one entry.
    const text = RunBookDraft.htmlToRunBookText(
      '<h1>Intake</h1><p>Call the client within one business day.</p>' +
      '<h2>Conflicts</h2><p>Run the conflict check before opening a matter.</p>',
      htmlParser()
    );

    expect(text).toBe(
      '# Intake\n\nCall the client within one business day.\n\n## Conflicts\n\n' +
      'Run the conflict check before opening a matter.'
    );
  });

  test('list items, tables and nested wrappers each keep their own line', () => {
    const text = RunBookDraft.htmlToRunBookText(
      '<div><ul><li>Open the file</li><li>Assign a partner</li></ul>' +
      '<table><tr><td>Step</td><td>Owner</td></tr></table></div>',
      htmlParser()
    );

    expect(text).toBe('Open the file\nAssign a partner\nStep\nOwner');
  });

  test('runs of whitespace collapse without losing words', () => {
    const text = RunBookDraft.htmlToRunBookText(
      '<p>Call   the\n\tclient today.</p>',
      htmlParser()
    );

    expect(text).toBe('Call the client today.');
  });

  test('an empty heading contributes nothing rather than a bare hash', () => {
    const text = RunBookDraft.htmlToRunBookText(
      '<h1>  </h1><p>Body text.</p>',
      htmlParser()
    );

    expect(text).toBe('Body text.');
  });

  test('returns empty string when there is nothing to parse', () => {
    expect(RunBookDraft.htmlToRunBookText('', htmlParser())).toBe('');
    expect(RunBookDraft.htmlToRunBookText(null, htmlParser())).toBe('');
    expect(RunBookDraft.htmlToRunBookText('<p>text</p>', null)).toBe('');
  });
});

describe('a title is proposed, never invented', () => {
  const entry = {
    id: 'rb-1',
    title: 'intake.pdf',
    source_reference: 'intake.pdf',
    needs_title: true
  };

  test('typing a real title is the person saying so, and that is what check reads', () => {
    expect(RunBookDraft.applyTitleEdit(entry, '  Client intake procedure  ')).toEqual({
      title: 'Client intake procedure',
      title_confirmed: true
    });
  });

  test('leaving the filename in place does not count as naming it', () => {
    expect(RunBookDraft.applyTitleEdit(entry, 'intake.pdf')).toEqual({
      title: 'intake.pdf',
      title_confirmed: false
    });
  });

  test('clearing the title does not count as naming it either', () => {
    expect(RunBookDraft.applyTitleEdit(entry, '   ')).toEqual({
      title: '',
      title_confirmed: false
    });
  });
});

describe('what the review screen flags on a row', () => {
  const scope = { type: 'department', values: ['intake', 'litigation'] };

  test('an entry still carrying its filename needs a title', () => {
    const issues = RunBookDraft.entryIssues(
      { title: 'intake.pdf', source_reference: 'intake.pdf', needs_title: true, scope_values: ['intake'] },
      scope
    );

    expect(issues.map((issue) => issue.code)).toEqual(['filename_title']);
  });

  test('a confirmed title clears the flag', () => {
    const issues = RunBookDraft.entryIssues(
      {
        title: 'Client intake procedure',
        source_reference: 'intake.pdf',
        needs_title: true,
        title_confirmed: true,
        scope_values: ['intake']
      },
      scope
    );

    expect(issues).toEqual([]);
  });

  test('an empty title is a different problem from a filename title', () => {
    const issues = RunBookDraft.entryIssues(
      { title: '   ', source_reference: 'intake.pdf', needs_title: true, scope_values: ['intake'] },
      scope
    );

    expect(issues.map((issue) => issue.code)).toEqual(['missing_title']);
  });

  test('an unscoped entry says which scope type it is missing', () => {
    const issues = RunBookDraft.entryIssues(
      { title: 'Client intake procedure', scope_values: [] },
      scope
    );

    expect(issues).toEqual([
      {
        code: 'unscoped',
        label: 'Not scoped',
        detail: 'Say which department this applies to.'
      }
    ]);
  });

  test('a scope value the run book never declared is named', () => {
    const issues = RunBookDraft.entryIssues(
      { title: 'Client intake procedure', scope_values: ['intake', 'probate'] },
      scope
    );

    expect(issues.map((issue) => issue.code)).toEqual(['undeclared_scope']);
    expect(issues[0].detail).toBe('This run book does not declare probate.');
  });

  test('every problem on one entry is reported, not the first', () => {
    const issues = RunBookDraft.entryIssues(
      { title: 'intake.pdf', source_reference: 'intake.pdf', needs_title: true, scope_values: [] },
      scope
    );

    expect(issues.map((issue) => issue.code)).toEqual(['filename_title', 'unscoped']);
  });

  test('scope options offer only the values the run book declared', () => {
    expect(RunBookDraft.scopeOptions(scope)).toEqual([
      { value: 'intake', label: 'intake' },
      { value: 'litigation', label: 'litigation' }
    ]);
  });
});

describe('payloads sent back to the draft endpoints', () => {
  test('propose sends the extracted text plus what the file was', () => {
    const payload = RunBookDraft.buildProposePayload(
      [{ filename: 'handbook.md', text: '# Intake', size_bytes: 12, has_text_layer: true }],
      { type: 'department', values: ['intake'] }
    );

    expect(payload).toEqual({
      documents: [{
        filename: 'handbook.md',
        text: '# Intake',
        size_bytes: 12,
        has_text_layer: true
      }],
      scope: { type: 'department', values: ['intake'] }
    });
  });

  test('check sends the edited entries and the declared scope', () => {
    const entries = [{ id: 'rb-1', title: 'Client intake procedure', scope_values: ['intake'] }];

    expect(RunBookDraft.buildCheckPayload(entries, { type: ' department ', values: ['intake'] }))
      .toEqual({
        entries,
        scope: { type: 'department', values: ['intake'] }
      });
  });

  test('missing scope becomes an empty declaration rather than undefined', () => {
    expect(RunBookDraft.buildCheckPayload(null, null)).toEqual({
      entries: [],
      scope: { type: '', values: [] }
    });
  });

  test('entries flatten across source files in the order they were proposed', () => {
    const entries = RunBookDraft.flattenEntries([
      { filename: 'a.md', entries: [{ id: 'rb-1' }, { id: 'rb-2' }] },
      { filename: 'b.pdf', entries: [{ id: 'rb-3' }] },
      { filename: 'c.txt', entries: [] }
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(['rb-1', 'rb-2', 'rb-3']);
  });
});

describe('labels for what the backend reported', () => {
  test.each([
    ['authored', 'Boundaries the author marked'],
    ['declared', 'Boundaries proposed from heading styles'],
    ['none', 'No boundaries to read'],
    ['something-new', 'Structure unknown']
  ])('structure %s reads as "%s"', (structure, label) => {
    expect(RunBookDraft.structureLabel(structure)).toBe(label);
  });

  test.each([
    ['whole_document', 'The whole file'],
    ['heading_depth_1', 'Heading level 1'],
    ['heading_depth_2', 'Heading level 2'],
    ['', 'Source not recorded']
  ])('proposed_from %s reads as "%s"', (proposedFrom, label) => {
    expect(RunBookDraft.proposedFromLabel(proposedFrom)).toBe(label);
  });

  test.each([
    ['empty', 'Nothing was under this heading'],
    ['too_short', 'Too short to stand on its own'],
    ['too_long', 'Too long to be one entry'],
    ['unknown_reason', 'Not usable as an entry']
  ])('dropped reason %s reads as "%s"', (reason, label) => {
    expect(RunBookDraft.droppedReasonLabel(reason)).toBe(label);
  });
});

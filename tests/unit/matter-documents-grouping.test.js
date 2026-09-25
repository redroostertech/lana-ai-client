'use strict';

const fs = require('fs');
const path = require('path');

const grouping = require(path.join(__dirname, '../../src/js/components/matter-documents-grouping.js'));
const SRC = path.join(__dirname, '../../src');

// Owner, 2026-09-25: a converted copy listed beside its PDF made users ask
// where the second document came from. The copy's metadata names its source;
// the list folds it under that source.
describe('matter documents grouping', () => {
  const pdf = { id: 'pdf-1', filename: 'Statement.pdf', metadata: {} };
  const copy = { id: 'copy-1', filename: 'Statement - editable.docx', metadata: { source: 'document_format_conversion', original_document_id: 'pdf-1' } };
  const other = { id: 'doc-2', filename: 'Brief.docx', metadata: { source: 'upload' } };

  test('folds an editable copy under its PDF and keeps the source order', () => {
    const result = grouping.groupDerivedDocuments([copy, other, pdf]);
    expect(result.derivedCount).toBe(1);
    expect(result.groups.map((g) => g.file.id)).toEqual(['doc-2', 'pdf-1']);
    expect(result.groups[1].children.map((c) => c.id)).toEqual(['copy-1']);
    expect(grouping.derivedRoleLabel(copy)).toBe('Editable copy');
    expect(grouping.derivedRoleLabel(pdf)).toBe('');
  });

  test('a copy whose source is not in the list stays visible on its own', () => {
    const result = grouping.groupDerivedDocuments([copy, other]);
    expect(result.derivedCount).toBe(0);
    expect(result.groups.map((g) => g.file.id)).toEqual(['copy-1', 'doc-2']);
  });

  test('control arm: files without a conversion link are never nested, whatever their metadata says', () => {
    const lookalike = { id: 'x', filename: 'x.docx', metadata: { original_document_id: 'pdf-1', source: 'upload' } };
    const self = { id: 'pdf-1', filename: 'loop.pdf', metadata: { source: 'document_format_conversion', original_document_id: 'pdf-1' } };
    const result = grouping.groupDerivedDocuments([pdf, lookalike, self]);
    expect(result.derivedCount).toBe(0);
    expect(grouping.derivedParentId(lookalike)).toBeNull();
    expect(grouping.groupDerivedDocuments([]).groups).toEqual([]);
    expect(grouping.groupDerivedDocuments(null).groups).toEqual([]);
  });
});

describe('nested row cap', () => {
  const copies = (n) => Array.from({ length: n }, (_, i) => ({ id: 'c' + i }));

  test('shows at most five copies and counts the rest', () => {
    expect(grouping.MAX_NESTED_ROWS).toBe(5);
    expect(grouping.visibleChildren(copies(7))).toEqual({ shown: copies(5), hiddenCount: 2 });
    expect(grouping.visibleChildren(copies(5))).toEqual({ shown: copies(5), hiddenCount: 0 });
    expect(grouping.visibleChildren([])).toEqual({ shown: [], hiddenCount: 0 });
    expect(grouping.visibleChildren(copies(3), 2)).toEqual({ shown: copies(2), hiddenCount: 1 });
  });
});

describe('matter documents view wiring', () => {
  const component = fs.readFileSync(path.join(SRC, 'js/components/matter-documents-view.js'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'css/components/matter-documents-view.css'), 'utf8');

  test('the list renders copies as nested rows with a role badge and counts them as part of their document', () => {
    expect(component).toContain("documentGrouping().groupDerivedDocuments(files).groups");
    expect(component).toContain("rows.push(fileRow(nested.shown[i], { nested: true }))");
    expect(component).toContain("mdv-file-row--derived");
    expect(component).toContain('function derivedRoleBadgeHtml(file)');
    expect(component).toContain('var documentCount = state.files.length - templateCount - derivedCount;');
    expect(css).toContain('.mdv-file-row--derived');
    expect(css).toContain('.mdv-role-badge');
  });

  test('past five copies the list offers Show more, which opens the source document', () => {
    expect(component).toContain('if (nested.hiddenCount > 0) rows.push(showMoreRow(item.file, nested.hiddenCount));');
    expect(component).toContain('class="mdv-file-row mdv-file-row--derived mdv-file-row--more" data-action="open" data-doc-id="\' + esc(sourceFile.id) + \'"');
    expect(component).toContain("nestedChildren(item).shown.forEach(function (child) { pageSelectable.push(fileSelectKey(child.id)); });");
    expect(css).toContain('.mdv-file-row--more');
  });

  test('every page that mounts the list loads the grouping module first', () => {
    for (const page of ['workspace-details.html', 'folder.html']) {
      const html = fs.readFileSync(path.join(SRC, page), 'utf8');
      const groupingAt = html.indexOf('js/components/matter-documents-grouping.js');
      const viewAt = html.indexOf('js/components/matter-documents-view.js');
      expect(groupingAt).toBeGreaterThan(-1);
      expect(groupingAt).toBeLessThan(viewAt);
    }
  });
});

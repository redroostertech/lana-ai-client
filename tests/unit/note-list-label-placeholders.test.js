/**
 * Regression: lex-select shows its placeholder ("Select...") whenever the
 * value is empty, so the empty "All labels" filter option and the empty
 * "No label" picker option never showed their text. The component now uses
 * the empty option's label as the placeholder.
 */
const path = require('path');

const NoteListComponent = require(path.join(__dirname, '../../src/js/components/note-list.component.js'));
const NoteLabels = require(path.join(__dirname, '../../src/js/shared/note-labels.js'));

function withDocument(elementsById, fn) {
  const had = 'document' in global;
  const previous = global.document;
  global.document = { getElementById: (id) => elementsById[id] || null };
  try { return fn(); } finally { if (had) global.document = previous; else delete global.document; }
}

function fakeSelect() {
  return { options: [], value: undefined, placeholder: 'Select...', addEventListener: jest.fn() };
}

function fakeThis() {
  return { filters: { label: '', unlinked: false }, labels: () => NoteLabels, factLabels: () => NoteLabels.PLATFORM_FACT_LABELS, loadNotes: jest.fn() };
}

describe('NoteListComponent label selects show the empty option text', () => {
  test('the label filter reads "All labels" when no label is chosen', () => {
    const filter = fakeSelect();
    withDocument({ notesLabelFilter: filter }, () => NoteListComponent.prototype.initFilters.call(fakeThis()));
    expect(filter.value).toBe('');
    expect(filter.placeholder).toBe('All labels');
    expect(filter.options[0]).toEqual({ value: '', label: 'All labels' });
  });

  test('the focus label picker reads "No label" for an unlabeled note', () => {
    const picker = fakeSelect();
    withDocument({ notesFocusLabelSelect: picker }, () => NoteListComponent.prototype.setFocusLabel.call(fakeThis(), null));
    expect(picker.value).toBe('');
    expect(picker.placeholder).toBe('No label');
  });

  test('a labeled note keeps its label selected (control)', () => {
    const picker = fakeSelect();
    withDocument({ notesFocusLabelSelect: picker }, () => NoteListComponent.prototype.setFocusLabel.call(fakeThis(), 'fact'));
    expect(picker.value).toBe('fact');
    expect(picker.options.some((option) => option.value === 'fact')).toBe(true);
  });
});

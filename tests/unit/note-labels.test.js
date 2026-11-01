'use strict';

const NoteLabels = require('../../src/js/shared/note-labels.js');

describe('note-labels', () => {
  test('the platform labels are the four from the design, in order', () => {
    expect(NoteLabels.PLATFORM_FACT_LABELS.map((item) => item.key)).toEqual([
      'fact', 'client_instruction', 'open_question', 'evidence',
    ]);
  });

  test('factLabels uses the makeup list when given and the platform list otherwise', () => {
    expect(NoteLabels.factLabels()).toBe(NoteLabels.PLATFORM_FACT_LABELS);
    expect(NoteLabels.factLabels([])).toBe(NoteLabels.PLATFORM_FACT_LABELS);
    const fromMakeup = [{ key: 'fact', label: 'Fact' }, { key: 'valuation', label: 'Valuation' }, { label: 'no key' }];
    expect(NoteLabels.factLabels(fromMakeup)).toEqual([
      { key: 'fact', label: 'Fact' },
      { key: 'valuation', label: 'Valuation' },
    ]);
  });

  test('labelText names known labels and humanizes unknown keys', () => {
    expect(NoteLabels.labelText('client_instruction')).toBe('Client instruction');
    expect(NoteLabels.labelText('beneficiary_note')).toBe('Beneficiary note');
    expect(NoteLabels.labelText('')).toBe('');
  });

  test('labelOptions starts with No label and keeps a label the makeup no longer offers', () => {
    const options = NoteLabels.labelOptions(NoteLabels.PLATFORM_FACT_LABELS, 'retired_label');
    expect(options[0]).toEqual({ value: '', label: 'No label' });
    expect(options.slice(1, 5).map((o) => o.value)).toEqual(['fact', 'client_instruction', 'open_question', 'evidence']);
    expect(options[5]).toEqual({ value: 'retired_label', label: 'Retired label', group: 'Other labels' });
  });

  test('labelOptions adds no Other labels entry for a known or empty label', () => {
    expect(NoteLabels.labelOptions(undefined, 'fact')).toHaveLength(5);
    expect(NoteLabels.labelOptions(undefined, '')).toHaveLength(5);
  });

  test('labelFilterOptions starts with All labels', () => {
    const options = NoteLabels.labelFilterOptions();
    expect(options[0]).toEqual({ value: '', label: 'All labels' });
    expect(options).toHaveLength(5);
  });

  test('labelChange omits an unchanged or empty label and sends null only to clear', () => {
    expect(NoteLabels.labelChange('', null)).toEqual({});
    expect(NoteLabels.labelChange('fact', 'fact')).toEqual({});
    expect(NoteLabels.labelChange('fact', null)).toEqual({ label: 'fact' });
    expect(NoteLabels.labelChange('evidence', 'fact')).toEqual({ label: 'evidence' });
    expect(NoteLabels.labelChange('', 'fact')).toEqual({ label: null });
  });

  test('listFilterParams maps the filters to ?label= and ?unlinked=true', () => {
    expect(NoteLabels.listFilterParams()).toEqual({});
    expect(NoteLabels.listFilterParams({ label: '', unlinked: false })).toEqual({});
    expect(NoteLabels.listFilterParams({ label: 'fact', unlinked: true })).toEqual({ label: 'fact', unlinked: 'true' });
    expect(NoteLabels.listFilterParams({ unlinked: 'yes' })).toEqual({});
    expect(NoteLabels.hasActiveFilters({ label: '', unlinked: true })).toBe(true);
    expect(NoteLabels.hasActiveFilters({ label: '', unlinked: false })).toBe(false);
  });

  describe('evidenceFlag', () => {
    test('flags labeled notes that are linked or unlinked', () => {
      expect(NoteLabels.evidenceFlag({ label: 'fact', evidence_status: 'unlinked' })).toEqual({
        text: 'Not supported', detail: 'Not linked to any record or document.',
      });
      expect(NoteLabels.evidenceFlag({ label: 'fact', evidence_status: 'linked' }).detail)
        .toBe('Linked, but it does not cite a retained document.');
    });

    test('does not flag supported facts, plain notes, or notes without a status', () => {
      expect(NoteLabels.evidenceFlag({ label: 'fact', evidence_status: 'supported' })).toBeNull();
      expect(NoteLabels.evidenceFlag({ label: null, evidence_status: 'unlinked' })).toBeNull();
      expect(NoteLabels.evidenceFlag({ label: 'fact' })).toBeNull();
      expect(NoteLabels.evidenceFlag(null)).toBeNull();
    });

    test('flags only the evidence-bearing labels, fact and evidence', () => {
      expect(NoteLabels.evidenceFlag({ label: 'evidence', evidence_status: 'unlinked' }).text).toBe('Not supported');
      ['open_question', 'client_instruction', 'valuation'].forEach((label) => {
        expect(NoteLabels.evidenceFlag({ label, evidence_status: 'unlinked' })).toBeNull();
        expect(NoteLabels.evidenceFlag({ label, evidence_status: 'linked' })).toBeNull();
      });
    });
  });
});

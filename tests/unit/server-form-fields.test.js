'use strict';

const F = require('../../src/js/shared/server-form-fields.js');

const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'off', label: 'Off', disabled: true }];
const refs = [{ value: 'c1', label: 'First' }, { value: 'c2', label: 'Second', kind: 'organization' }];
const versions = [
  { value: 'v1', label: 'Will v1', reference: { kind: 'document_release', id: 'd1', version: 1, sha256: 'h1' } },
  { value: 'v2', label: 'Will v2', reference: { kind: 'document_release', id: 'd1', version: 2, sha256: 'h2' }, retained: false },
];

const FIELDS = {
  text: { id: 'text', kind: 'text', label: 'Name', max_length: 5 },
  textarea: { id: 'textarea', kind: 'textarea', label: 'Reason' },
  number: { id: 'number', kind: 'number', label: 'Count', min: 0, max: 10, integer: true },
  money: { id: 'money', kind: 'money', label: 'Value', currency: 'USD' },
  date: { id: 'date', kind: 'date', label: 'Date' },
  datetime: { id: 'datetime', kind: 'datetime', label: 'When' },
  select: { id: 'select', kind: 'select', label: 'Pick', options: opts },
  multiselect: { id: 'multiselect', kind: 'multiselect', label: 'Pick many', options: opts },
  reference: { id: 'reference', kind: 'reference', label: 'Contact', reference_kind: 'contact', options: refs },
  reference_set: { id: 'reference_set', kind: 'reference_set', label: 'Contacts', reference_kind: 'contact', options: refs },
  allocation: { id: 'allocation', kind: 'allocation', label: 'Shares', reference_kind: 'contact', options: refs },
  document_versions: { id: 'document_versions', kind: 'document_versions', label: 'Versions', options: versions },
  evidence_sources: {
    id: 'evidence_sources', kind: 'evidence_sources', label: 'Sources', options: versions,
    evidence_classes: [{ value: 'statement', label: 'Statement' }],
    coverage_options: [{ value: 'complete', label: 'Complete' }, { value: 'partial', label: 'Partial' }],
  },
  confirm: { id: 'confirm', kind: 'confirm', label: 'I reviewed this.' },
};

describe('server-form-fields', () => {
  test('the closed set of field kinds from the design', () => {
    expect(F.FIELD_KINDS).toEqual(Object.keys(FIELDS));
  });

  describe('normalizeDescriptor', () => {
    test('accepts schema version 1 with known kinds', () => {
      expect(F.normalizeDescriptor({ schema_version: 1, fields: Object.values(FIELDS) }).ok).toBe(true);
    });
    test('an unknown kind or schema version needs a newer app version', () => {
      expect(F.normalizeDescriptor({ schema_version: 1, fields: [{ id: 'x', kind: 'signature' }] })).toMatchObject({ ok: false, reason: 'unsupported' });
      expect(F.normalizeDescriptor({ schema_version: 2, fields: [] })).toMatchObject({ ok: false, reason: 'unsupported', message: 'This form needs a newer app version.' });
    });
    test('missing fields, unnamed or repeated ids are invalid', () => {
      expect(F.normalizeDescriptor(null).reason).toBe('invalid');
      expect(F.normalizeDescriptor({ schema_version: 1 }).reason).toBe('invalid');
      expect(F.normalizeDescriptor({ schema_version: 1, fields: [{ kind: 'text' }] }).reason).toBe('invalid');
      expect(F.normalizeDescriptor({ schema_version: 1, fields: [FIELDS.text, FIELDS.text] }).reason).toBe('invalid');
    });
  });

  // [kind, valid raw, wire, invalid raw, error fragment]
  const cases = [
    ['text', '  Ann ', 'Ann', 'Annabel', 'at most 5'],
    ['textarea', ' Because. ', 'Because.', null, null],
    ['number', '7', 7, '11', 'at most 10'],
    ['money', '1250.5', { amount_minor: 125050, currency: 'USD' }, '12.345', 'two decimal'],
    ['date', '2026-10-31', '2026-10-31', '2026-02-30', 'valid date'],
    ['select', 'b', 'b', 'off', 'listed options'],
    ['multiselect', ['a', 'b'], ['a', 'b'], ['a', 'zzz'], 'listed options'],
    ['reference', 'c2', { kind: 'organization', id: 'c2' }, 'invented', 'from the list'],
    ['reference_set', ['c1', 'c2'], [{ kind: 'contact', id: 'c1' }, { kind: 'organization', id: 'c2' }], ['c9'], 'from the list'],
    ['allocation', [{ ref: 'c1', percent: '33.33' }, { ref: 'c2', percent: '66.67' }],
      [{ ref: { kind: 'contact', id: 'c1' }, share_basis_points: 3333 }, { ref: { kind: 'organization', id: 'c2' }, share_basis_points: 6667 }],
      [{ ref: 'c1', percent: '1.234' }], 'two decimal places'],
    ['document_versions', ['v1'], [versions[0].reference], ['v2'], 'available document version'],
    ['confirm', true, true, false, 'Confirm this'],
  ];

  test.each(cases)('%s maps valid input to its wire value and refuses invalid input', (kind, raw, wire, bad, fragment) => {
    expect(F.toWire(FIELDS[kind], raw)).toEqual(wire);
    if (bad !== null) expect(() => F.toWire(FIELDS[kind], bad)).toThrow(fragment);
  });

  test.each(cases.filter(([kind]) => kind !== 'text' && kind !== 'textarea'))('%s round-trips from its wire value', (kind, raw, wire) => {
    expect(F.toWire(FIELDS[kind], F.fromWire(FIELDS[kind], wire))).toEqual(wire);
  });

  test('number refuses words, exponents and fractions for whole numbers', () => {
    ['ten', '1e3', '2.5', '1.', '-'].forEach((raw) => expect(() => F.toWire(FIELDS.number, raw)).toThrow());
    expect(F.toWire({ id: 'n', kind: 'number', label: 'N' }, '-2.5')).toBe(-2.5);
  });

  test('allocation shares are positive and total exactly 100%, or the descriptor total_basis_points', () => {
    const shares = (...percents) => percents.map((percent, i) => ({ ref: i ? 'c2' : 'c1', percent }));
    expect(() => F.toWire(FIELDS.allocation, shares('50', '49.99'))).toThrow('Shares shares must add up to 100.00%.');
    expect(() => F.toWire(FIELDS.allocation, shares('100', '0'))).toThrow('more than 0%');
    const part = { ...FIELDS.allocation, total_basis_points: 2500 };
    expect(F.toWire(part, shares('20', '5')).map((row) => row.share_basis_points)).toEqual([2000, 500]);
    expect(() => F.toWire(part, shares('50', '50'))).toThrow('add up to 25.00%');
  });

  test('money without a currency in the descriptor is refused', () => {
    expect(() => F.toWire({ id: 'm', kind: 'money', label: 'M' }, '1')).toThrow('currency');
  });

  test('datetime sends an ISO instant and round-trips to the local input', () => {
    const wire = F.toWire(FIELDS.datetime, '2026-10-30T09:30');
    expect(wire).toBe(new Date('2026-10-30T09:30').toISOString());
    expect(F.fromWire(FIELDS.datetime, wire)).toBe('2026-10-30T09:30');
    expect(() => F.toWire(FIELDS.datetime, '2026-10-30')).toThrow();
  });

  test('evidence_sources captures the reference, class, coverage, instant and optional locator', () => {
    const row = { source: 'v1', evidence_class: 'statement', coverage: 'partial', observed_at: '2026-10-30T09:30', page: '2', quote: ' Exact. ' };
    const [result] = F.toWire(FIELDS.evidence_sources, [row]);
    expect(result).toEqual({
      artifact: versions[0].reference, evidence_class: 'statement', coverage: 'partial',
      observed_at: new Date('2026-10-30T09:30').toISOString(), locator: { page: 2, quote: 'Exact.' },
    });
    expect(F.toWire(FIELDS.evidence_sources, [{ ...row, page: '', quote: '' }])[0].locator).toBeUndefined();
    expect(() => F.toWire(FIELDS.evidence_sources, [{ ...row, source: 'v2' }])).toThrow('available document version');
    expect(() => F.toWire(FIELDS.evidence_sources, [{ ...row, page: '0' }])).toThrow('positive whole');
    expect(() => F.toWire(FIELDS.evidence_sources, [{ ...row, coverage: 'most' }])).toThrow('how much');
    expect(F.fromWire(FIELDS.evidence_sources, [result])).toEqual([{ ...row, quote: 'Exact.' }]);
  });

  test('required empty fields are refused; optional empty fields are left out', () => {
    expect(() => F.toWire({ ...FIELDS.text, required: true }, '  ')).toThrow('Name is required');
    expect(() => F.toWire({ ...FIELDS.multiselect, required: true }, [])).toThrow('required');
    expect(F.toWire(FIELDS.text, '')).toBeUndefined();
    expect(F.toWire(FIELDS.reference_set, [])).toBeUndefined();
    expect(() => F.toWire(FIELDS.confirm, false)).toThrow('Confirm');
  });

  test('collect returns values and per-field errors', () => {
    const fields = [{ ...FIELDS.select, required: true }, FIELDS.textarea, FIELDS.confirm];
    expect(F.collect(fields, { select: 'a', textarea: ' why ', confirm: true })).toEqual({ values: { select: 'a', textarea: 'why', confirm: true }, errors: {} });
    const bad = F.collect(fields, { select: '', textarea: '', confirm: false });
    expect(bad.values).toEqual({});
    expect(Object.keys(bad.errors)).toEqual(['select', 'confirm']);
  });

  test('emptyRaw and fromWire defaults', () => {
    expect(F.emptyRaw(FIELDS.confirm)).toBe(false);
    expect(F.emptyRaw(FIELDS.allocation)).toEqual([]);
    expect(F.emptyRaw(FIELDS.text)).toBe('');
    expect(F.fromWire(FIELDS.select, undefined)).toBe('');
  });
});

describe('stored references match their option whatever the key order', () => {
  const F = require('../../src/js/shared/server-form-fields.js');
  const field = { id: 'releases', kind: 'document_versions', label: 'Plan documents', options: [
    { value: 'r1', label: 'Plan (release 1)', reference: { id: 'r1', version: 1, sha256: 'a'.repeat(64) }, retained: true },
    { value: 'r2', label: 'Codicil (release 2)', reference: { id: 'r2', version: 2, sha256: 'b'.repeat(64) }, retained: true },
  ] };
  test('a plan revision prefill in another key order selects its options', () => {
    expect(F.fromWire(field, [{ sha256: 'b'.repeat(64), version: 2, id: 'r2' }])).toEqual(['r2']);
  });
  test('control: a reference no option holds selects nothing', () => {
    expect(F.fromWire(field, [{ id: 'r2', version: 3, sha256: 'b'.repeat(64) }])).toEqual(['']);
  });
});

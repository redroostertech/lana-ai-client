'use strict';
const { instant, localInput, evidenceFromFields } = require('../../../src/js/services/assurance-evidence-controls');
const release = { id: 'release', retained: true, reference: { id: 'release', version: 2, sha256: 'hash' } };
const row = { releaseId: 'release', evidenceClass: 'institution_acceptance', observedAt: '2026-10-30T09:30:00-04:00', coverage: 'partial', page: '2', quote: ' Exact passage. ' };
test('captures the selected immutable reference, explicit coverage and source locator', () => {
  expect(evidenceFromFields([row], [release])).toEqual([{ artifact: release.reference, evidence_class: 'institution_acceptance', observed_at: '2026-10-30T13:30:00.000Z', coverage: 'partial', locator: { page: 2, quote: 'Exact passage.' } }]);
});
test('unavailable or unretained documents cannot silently substitute another source', () => {
  expect(() => evidenceFromFields([row], [])).toThrow('available retained');
  expect(() => evidenceFromFields([row], [{ ...release, retained: false }])).toThrow('available retained');
});
test.each(['0', '-1', '1.5', 'word'])('invalid source page %s is not coerced into a locator', page => {
  expect(() => evidenceFromFields([{ ...row, page }], [release])).toThrow('positive whole');
});
test('optional locator stays absent, dates require an explicit valid input', () => {
  const result = evidenceFromFields([{ ...row, page: '', quote: '' }], [release])[0];
  expect(result.locator).toBeUndefined(); expect(() => instant('')).toThrow(); expect(() => instant('invalid')).toThrow();
  expect(localInput('2026-10-30T13:30:00Z')).toContain('2026-10-30T');
});

test('an invalid calendar date cannot silently roll forward into another month', () => { expect(() => instant('2026-02-30T09:30:00Z')).toThrow('valid date'); });

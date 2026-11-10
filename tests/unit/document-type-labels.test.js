/**
 * Every documents.document_type value the backend writes has a readable label,
 * and an unknown value falls back to readable words, never the raw key.
 */
const { LABELS, documentTypeLabel } = require('../../src/js/shared/document-type-labels');

// LANA-AI src/services/processor/document-enrichment/document-enrichment.schemas.js
// DOCUMENT_TYPES (entity graph, estate planning and administration included).
const BACKEND_DOCUMENT_TYPES = [
  'contract', 'invoice', 'receipt', 'correspondence', 'court_filing', 'financial_statement',
  'settlement_statement', 'disclosure', 'report', 'form', 'memo', 'policy', 'identification',
  'deposition', 'police_report', 'medical_record', 'email', 'expert_report', 'pleading',
  'will', 'pour_over_will', 'codicil', 'trust_instrument', 'trust_amendment', 'restatement',
  'power_of_attorney', 'healthcare_directive', 'deed', 'assignment', 'funding_letter',
  'certification_of_trust', 'beneficiary_designation_form', 'letters_testamentary',
  'death_certificate', 'estate_inventory', 'other'
];

describe('document type labels', () => {
  test.each(BACKEND_DOCUMENT_TYPES)('%s has its own readable label', (type) => {
    expect(Object.prototype.hasOwnProperty.call(LABELS, type)).toBe(true);
    const label = documentTypeLabel(type);
    expect(label).not.toContain('_');
    expect(label).toMatch(/^[A-Z]/);
  });

  test.each([
    ['trust_instrument', 'Trust instrument'],
    ['pour_over_will', 'Pour-over will'],
    ['power_of_attorney', 'Power of attorney'],
    ['letters_testamentary', 'Letters testamentary'],
    ['medical_record', 'Medical record']
  ])('%s reads as "%s"', (type, label) => {
    expect(documentTypeLabel(type)).toBe(label);
  });

  test('an unknown value becomes readable words, not the raw key', () => {
    expect(documentTypeLabel('lease_extension_rider')).toBe('Lease extension rider');
    expect(documentTypeLabel('NEW-KIND')).toBe('New kind');
  });

  test.each([null, undefined, '', '   '])('no type (%p) is null', (value) => {
    expect(documentTypeLabel(value)).toBeNull();
  });
});

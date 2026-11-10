// src/js/shared/document-type-labels.js
// One readable label for every documents.document_type value the backend
// writes (LANA-AI document-enrichment.schemas.js DOCUMENT_TYPES, including the
// estate planning and administration types), plus older values still stored on
// existing documents. Unknown values fall back to readable words, never the raw key.
(function (root) {
  'use strict';

  var LABELS = Object.freeze({
    // General (DOCUMENT_TYPES)
    contract: 'Contract',
    invoice: 'Invoice',
    receipt: 'Receipt',
    correspondence: 'Correspondence',
    court_filing: 'Court filing',
    financial_statement: 'Financial statement',
    settlement_statement: 'Settlement statement',
    disclosure: 'Disclosure',
    report: 'Report',
    form: 'Form',
    memo: 'Memo',
    policy: 'Policy',
    identification: 'Identification',
    deposition: 'Deposition',
    police_report: 'Police report',
    medical_record: 'Medical record',
    email: 'Email',
    expert_report: 'Expert report',
    pleading: 'Pleading',
    other: 'Other',
    // Estate planning and administration (DOCUMENT_TYPES)
    will: 'Will',
    pour_over_will: 'Pour-over will',
    codicil: 'Codicil',
    trust_instrument: 'Trust instrument',
    trust_amendment: 'Trust amendment',
    restatement: 'Trust restatement',
    power_of_attorney: 'Power of attorney',
    healthcare_directive: 'Healthcare directive',
    deed: 'Deed',
    assignment: 'Assignment',
    funding_letter: 'Funding letter',
    certification_of_trust: 'Certification of trust',
    beneficiary_designation_form: 'Beneficiary designation form',
    letters_testamentary: 'Letters testamentary',
    death_certificate: 'Death certificate',
    estate_inventory: 'Estate inventory',
    // Older values still stored on existing documents
    motion: 'Motion',
    brief: 'Brief',
    order: 'Court order',
    court_order: 'Court order',
    transcript: 'Transcript',
    letter: 'Letter',
    agreement: 'Agreement',
    settlement_agreement: 'Settlement agreement',
    affidavit: 'Affidavit',
    declaration: 'Declaration',
    petition: 'Petition',
    notice: 'Notice',
    certificate: 'Certificate',
    spreadsheet: 'Spreadsheet',
    presentation: 'Presentation'
  });

  /**
   * Readable label for a stored document_type value.
   * @param {string|null|undefined} type
   * @returns {string|null} null when there is no type
   */
  function documentTypeLabel(type) {
    if (type === null || type === undefined) return null;
    var key = String(type).trim();
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(LABELS, key)) return LABELS[key];
    var words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
  }

  var api = { LABELS: LABELS, documentTypeLabel: documentTypeLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LanaDocumentTypes = api;
})(typeof window !== 'undefined' ? window : null);

'use strict';

const path = require('path');

const enrichment = require(path.join(__dirname, '../../src/js/services/document-enrichment.service.js'));

function makeApi() {
  const calls = [];
  const handler = (method) => jest.fn(async (endpoint, payload) => {
    calls.push({ method, endpoint, payload });
    return { data: { ok: true, endpoint } };
  });
  return { get: handler('GET'), post: handler('POST'), calls };
}

const PAYLOAD = {
  enabled: true,
  enrichment: {
    id: 'enr-1', status: 'partial', text_truncated: true, completed_at: '2026-09-25T20:00:00Z',
    classification: { document_type: 'settlement_statement', confidence: 0.91, purpose: 'Closing of a sale.', abstained: false },
    summary: 'A settlement statement.\n\nTwo parties.',
    entities: [
      { kind: 'person', text: 'Auritela Burgos', normalized: 'Auritela Burgos', role: 'buyer', evidence: { quote: 'Buyer: Auritela Burgos' }, confidence: 0.9 },
      { kind: 'amount', text: '$885,000.00', normalized: '885000', evidence: { quote: 'Sale Price $885,000.00' }, confidence: 0.9 },
      { kind: 'email', text: 'a@b.co', normalized: 'a@b.co', evidence: { quote: 'a@b.co' }, confidence: 0.9 }
    ],
    callouts: [
      { kind: 'deadline', title: 'Deposit due', detail: 'By September 5.', when: '2025-09-05', evidence: { quote: 'Deposit due no later than 2025-09-05.' }, confidence: 0.8 },
      { kind: 'amount_due', title: 'Sale price', detail: '', amount: { value: 885000, currency: 'USD' }, evidence: { quote: 'Sale Price $885,000.00' }, confidence: 0.6 }
    ],
    dropped: [{ kind: 'person', text: 'Nobody', reason: 'evidence_not_found' }],
    sections: { classify: { status: 'completed' }, entities: { status: 'completed' }, digest: { status: 'abstained' } }
  },
  suggestions: [
    { id: 'sug-1', target_kind: 'contact', status: 'suggested', proposed: { firstName: 'Auritela', lastName: 'Burgos', displayName: 'Auritela Burgos', title: 'buyer' }, evidence: { quote: 'Buyer: Auritela Burgos' }, source: { confidence: 0.9 } },
    { id: 'sug-2', target_kind: 'party', status: 'suggested', proposed: { party_name: 'United Wholesale Mortgage, LLC', party_role: 'lender', party_type: 'other' }, evidence: { quote: 'Lender: United Wholesale Mortgage, LLC' }, source: { confidence: 0.85 } },
    { id: 'sug-3', target_kind: 'deadline', status: 'suggested', proposed: { title: 'Deposit due', start_time: '2025-09-05T00:00:00.000Z', description: 'By September 5.' }, evidence: { quote: 'Deposit due' }, source: { confidence: 0.4 } },
    { id: 'sug-4', target_kind: 'contact', status: 'dismissed', dismiss_reason: 'Already a contact', proposed: { lastName: 'Old' }, evidence: null, source: {} }
  ]
};

describe('document enrichment view model', () => {
  test('arranges the server payload into type, summary, grouped callouts and entities, and open versus decided suggestions', () => {
    const vm = enrichment.viewModel(PAYLOAD);
    expect(vm.available).toBe(true);
    expect(vm.statusLabel).toBe('Partly complete');
    expect(vm.truncated).toBe(true);
    expect(vm.classification).toEqual({ label: 'Settlement statement', abstained: false, confidence: 'High confidence', purpose: 'Closing of a sale.' });
    expect(vm.summary).toContain('\n\n');
    expect(vm.callouts.map((g) => [g.label, g.items.length])).toEqual([['Deadlines', 1], ['Amounts due', 1]]);
    expect(vm.callouts[0].items[0]).toMatchObject({ title: 'Deposit due', when: '2025-09-05', evidence: 'Deposit due no later than 2025-09-05.', confidence: 'High confidence' });
    expect(vm.callouts[1].items[0].amount).toBe('$885,000.00');
    expect(vm.entities.map((g) => g.label)).toEqual(['People', 'Amounts', 'Emails']);
    expect(vm.entities[0].items[0]).toEqual({ text: 'Auritela Burgos', role: 'buyer', evidence: 'Buyer: Auritela Burgos' });
    expect(vm.suggestions.open.map((s) => [s.targetLabel, s.title, s.verb, s.confidence])).toEqual([
      ['Contact', 'Auritela Burgos', 'Add contact', 'High confidence'],
      ['Party', 'United Wholesale Mortgage, LLC (lender)', 'Add party', 'High confidence'],
      ['Deadline', 'Deposit due, 2025-09-05', 'Add deadline', 'Low confidence']
    ]);
    expect(vm.suggestions.decided).toEqual([expect.objectContaining({ id: 'sug-4', status: 'dismissed', dismissReason: 'Already a contact', title: 'Old' })]);
    expect(vm.dropped).toBe(1);
  });

  test('an abstained classification reads as not determined; no enrichment reads as unavailable; a disabled lane reads as off', () => {
    const abstained = enrichment.viewModel({ enabled: true, enrichment: { id: 'e', status: 'completed', classification: { document_type: 'unknown', confidence: 0.2, abstained: true }, entities: [], callouts: [] }, suggestions: [] });
    expect(abstained.classification.label).toBe('Type not determined');
    expect(abstained.classification.abstained).toBe(true);
    expect(enrichment.viewModel({ enabled: true, enrichment: null, suggestions: [] })).toMatchObject({ available: false, suggestions: { open: [], decided: [] } });
    expect(enrichment.viewModel({ enabled: false, enrichment: null }).enabled).toBe(false);
  });
});

describe('document enrichment panel html', () => {
  test('renders every section with escaped text and action buttons carrying the suggestion id', () => {
    const html = enrichment.renderPanelHtml(enrichment.viewModel(PAYLOAD));
    expect(html).toContain('Settlement statement');
    expect(html).toContain('data-enrichment-action="accept" data-suggestion-id="sug-1"');
    expect(html).toContain('data-enrichment-action="dismiss" data-suggestion-id="sug-3"');
    expect(html).toContain('data-enrichment-action="rerun"');
    expect(html).toContain('Deposit due no later than 2025-09-05.');
    expect(html).toContain('Dismissed: Already a contact');
    expect(html).toContain('first part of a long document');
    expect((html.match(/data-enrichment-action="accept"/g) || []).length).toBe(3);
  });

  test('escapes model text so a hostile summary cannot inject markup, and renders the empty and off states', () => {
    const hostile = enrichment.viewModel({ enabled: true, enrichment: { id: 'e', status: 'completed', summary: '<img src=x onerror="alert(1)"> & "quotes"', entities: [], callouts: [] }, suggestions: [] });
    const html = enrichment.renderPanelHtml(hostile);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;quotes&quot;');
    expect(enrichment.renderPanelHtml(enrichment.viewModel({ enabled: true, enrichment: null }))).toContain('No insights yet');
    expect(enrichment.renderPanelHtml(enrichment.viewModel({ enabled: false }))).toContain('Insights are off');
  });
});

describe('document enrichment api wrappers', () => {
  test('call the matter-scoped enrichment endpoints and unwrap the data envelope', async () => {
    const api = makeApi();
    const doc = '2f1c4f5e-8a4a-4d3b-9d0c-1a2b3c4d5e6f';
    expect(await enrichment.load(api, 'MATT-54051', doc)).toMatchObject({ ok: true });
    await enrichment.accept(api, 'MATT-54051', doc, 'sug-1', { email: 'a@b.co' });
    await enrichment.dismiss(api, 'MATT-54051', doc, 'sug-2', 'Already there');
    await enrichment.rerun(api, null, doc);
    expect(api.calls.map((c) => [c.method, c.endpoint, c.payload])).toEqual([
      ['GET', '/api/v1/matters/MATT-54051/documents/' + doc + '/enrichment', undefined],
      ['POST', '/api/v1/matters/MATT-54051/documents/' + doc + '/enrichment/suggestions/sug-1/accept', { overrides: { email: 'a@b.co' } }],
      ['POST', '/api/v1/matters/MATT-54051/documents/' + doc + '/enrichment/suggestions/sug-2/dismiss', { reason: 'Already there' }],
      ['POST', '/api/v1/matters/unassigned/documents/' + doc + '/enrichment/rerun', {}]
    ]);
  });
});

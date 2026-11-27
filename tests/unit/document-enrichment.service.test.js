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

  test('escapeHtml delegates to Lex.Utils.escapeHtml when it is loaded, and keeps its own fallback otherwise', () => {
    expect(enrichment.escapeHtml('<b>')).toBe('&lt;b&gt;');
    global.Lex = { Utils: { escapeHtml: (value) => 'STUB(' + value + ')' } };
    try {
      expect(enrichment.escapeHtml('<b>')).toBe('STUB(<b>)');
    } finally {
      delete global.Lex;
    }
    // Control arm: back to the local fallback once Lex is gone again.
    expect(enrichment.escapeHtml('<b>')).toBe('&lt;b&gt;');
  });

  test('renders Insights badges, buttons and empty states as Lex elements', () => {
    const html = enrichment.renderPanelHtml(enrichment.viewModel(PAYLOAD));
    expect(html).toContain('<lex-badge label="Contact" color="indigo" size="sm"></lex-badge>');
    expect(html).toContain('<lex-btn type="button" variant="primary" size="sm" data-enrichment-action="accept" data-suggestion-id="sug-1">');
    expect(html).toContain('<lex-btn type="button" variant="secondary" size="sm" data-enrichment-action="dismiss" data-suggestion-id="sug-1">Dismiss</lex-btn>');
    expect(html).not.toContain('class="file-viewer-insights__badge"');
    expect(html).not.toContain('class="file-viewer-review-action');
    // Control arm for the assertion below: the accept/dismiss toolbar under a
    // suggestion is a plain, left-aligned "file-viewer-insights__actions" div,
    // not the centered empty-state modifier.
    expect(html).toContain('<div class="file-viewer-insights__actions">');
    expect(html).not.toContain('file-viewer-insights__actions--center');
    const off = enrichment.renderPanelHtml(enrichment.viewModel({ enabled: false }));
    expect(off).toContain('<lex-empty size="compact" message="Insights are off"');
    expect(off).not.toContain('file-viewer-review-empty');
    const unavailable = enrichment.renderPanelHtml(enrichment.viewModel({ enabled: true, enrichment: null }));
    expect(unavailable).toContain('<lex-empty size="compact" message="No insights yet"');
    expect(unavailable).toContain('<lex-btn type="button" variant="secondary" size="sm" data-enrichment-action="rerun">Read this document</lex-btn>');
    // Reported 2026-09-26: the empty-state's own button rendered flush-left
    // against the centered icon/heading/description above it. It needs the
    // centering modifier; the accept/dismiss toolbar under a suggestion's
    // text (below) reuses the same base class but must stay left-aligned, so
    // it must NOT carry this modifier.
    expect(unavailable).toContain('class="file-viewer-insights__actions file-viewer-insights__actions--center"');
    const nothing = enrichment.renderPanelHtml(enrichment.viewModel({ enabled: true, enrichment: { id: 'e', status: 'completed', entities: [], callouts: [] }, suggestions: [] }));
    expect(nothing).toContain('<lex-empty size="compact" message="Nothing to report"');
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

describe('signed engagement letter: fees, payment steps and signing', () => {
  const base = { enabled: true, enrichment: { id: 'enr-9', status: 'completed', classification: { document_type: 'signed_engagement_letter', confidence: 0.9 } } };
  const sug = (id, kind, proposed, source, extra) => Object.assign({ id, target_kind: kind, status: 'suggested', proposed, evidence: { quote: 'Total fee: $4,500.' }, source }, extra);
  const payload = Object.assign({}, base, { suggestions: [
    sug('f1', 'fee', { field: 'total_fee', value: 4500, format: 'currency' }, { kind: 'read_from_document', confidence: 0.92 }),
    sug('f2', 'fee', { field: 'initial_maintenance_year', value: 2027, format: 'number' }, { kind: 'matches_draft', confidence: 0.9 }),
    sug('f3', 'fee', { field: 'plan_type', value: 'Revocable trust', format: 'text' }, { kind: 'from_draft_not_read', confidence: 0.4 }),
    sug('p1', 'payment', { payment_type: 'deposit', amount: 1500, due_date: '2026-12-01', due_date_basis: 'on_signing', estimated: false }, { kind: 'read_from_document', confidence: 0.8 }),
    sug('p2', 'payment', { payment_type: 'final', amount: 1000, due_date: null, due_date_basis: 'when_the_plan_is_signed', estimated: true }, { kind: 'matches_draft' }),
    sug('s1', 'engagement_signed', { signed_on: '2026-11-20' }, { kind: 'read_from_document', confidence: 0.95 }),
    sug('c1', 'contact', { displayName: 'Avery Stone' }, { confidence: 0.9 }),
  ] });

  test('the view model labels each field, step and signing in plain words, with the source', () => {
    const vm = enrichment.viewModel(payload);
    const byId = Object.fromEntries(vm.suggestions.open.map((r) => [r.id, r]));
    expect(byId.f1).toMatchObject({ reviewGroup: 'fee', title: 'Total fee', detail: '$4,500.00', verb: 'Save fee', sourceNote: '', evidence: 'Total fee: $4,500.', confidence: 'High confidence' });
    expect(byId.f2).toMatchObject({ title: 'First maintenance year', detail: '2027', sourceNote: 'Matches the draft letter', evidence: '' });
    expect(byId.f3).toMatchObject({ title: 'Plan type', detail: 'Revocable trust', sourceNote: 'From the draft; not found in the signed copy', sourceWarning: true });
    expect(byId.p1).toMatchObject({ reviewGroup: 'payment', title: 'Deposit', detail: '$1,500.00 · Due Dec 1, 2026', verb: 'Save payment step' });
    expect(byId.p2).toMatchObject({ title: 'Final payment', detail: '$1,000.00 · Due when the plan is signed · Estimated' });
    expect(byId.s1).toMatchObject({ reviewGroup: 'engagement_signed', title: 'Engagement signed', detail: 'Signed Nov 20, 2026', verb: 'Mark signed' });
    expect(byId.f1.editors).toEqual([{ name: 'value', label: 'Total fee', format: 'currency', value: '4500' }]);
    expect(byId.p1.editors).toEqual([{ name: 'amount', label: 'Amount', format: 'currency', value: '1500' }, { name: 'due_date', label: 'Due date', format: 'date', value: '2026-12-01' }]);
    expect(byId.s1.editors).toEqual([{ name: 'signed_on', label: 'Signed on', format: 'date', value: '2026-11-20' }]);
    expect(byId.c1.reviewGroup).toBe('');
  });

  test('the panel shows Fees, Payment steps and Engagement signed, each editable before saving; the draft-only warning stands out', () => {
    const html = enrichment.renderPanelHtml(enrichment.viewModel(payload));
    expect(html.indexOf('>Fees<')).toBeGreaterThan(-1);
    expect(html.indexOf('>Payment steps<')).toBeGreaterThan(-1);
    expect(html).toContain('>Engagement signed<');
    expect(html).toContain('data-enrichment-override="value" data-override-format="currency"');
    expect(html).toContain('type="number"');
    expect(html).toContain('data-enrichment-override="due_date" data-override-format="date"');
    expect(html).toContain('type="date"');
    expect(html).toContain('data-target-kind="payment"');
    expect(html).toContain('>Save fee</lex-btn>');
    expect(html).toContain('>Mark signed</lex-btn>');
    expect(html).toContain('class="file-viewer-insights__source file-viewer-insights__source--warning" role="note">From the draft; not found in the signed copy');
    expect(html).toContain('Matches the draft letter');
    // The contact stays in the general Suggestions list.
    expect(html).toContain('>Suggestions <');
  });

  test('edited values become the accept overrides: numbers for money, a day or null for dates, text as typed', () => {
    expect(enrichment.readOverrides([{ name: 'value', format: 'currency', value: '$4,750.50' }])).toEqual({ value: 4750.5 });
    expect(enrichment.readOverrides([{ name: 'amount', format: 'currency', value: '1500' }, { name: 'due_date', format: 'date', value: '' }])).toEqual({ amount: 1500, due_date: null });
    expect(enrichment.readOverrides([{ name: 'value', format: 'text', value: ' Revocable trust ' }])).toEqual({ value: 'Revocable trust' });
    expect(enrichment.readOverrides([{ name: 'value', format: 'number', value: 'abc' }])).toEqual({ value: null });
  });

  test('the edited inputs of one item are read from the page', () => {
    const inputs = [{ attrs: { 'data-enrichment-override': 'amount', 'data-override-format': 'currency' }, value: '2000' },
      { attrs: { 'data-enrichment-override': 'due_date', 'data-override-format': 'date' }, value: '2027-01-15' }];
    inputs.forEach((i) => { i.getAttribute = (k) => i.attrs[k]; });
    const item = { querySelectorAll: (sel) => (sel === '[data-enrichment-override]' ? inputs : []) };
    expect(enrichment.collectOverrides(item)).toEqual({ amount: 2000, due_date: '2027-01-15' });
    expect(enrichment.collectOverrides(null)).toEqual({});
  });

  test('accept sends overrides, and overwrite: true when the person chose to replace', async () => {
    const api = makeApi();
    await enrichment.accept(api, 'M-1', 'D-1', 'f1', { value: 4500 }, { overwrite: true });
    expect(api.calls[0].payload).toEqual({ overrides: { value: 4500 }, overwrite: true });
  });

  test('a 409 gives both values in plain words; anything else is not a conflict', () => {
    const vm = enrichment.viewModel(payload);
    const fee = vm.suggestions.open.find((r) => r.id === 'f1');
    const step = vm.suggestions.open.find((r) => r.id === 'p1');
    const err = (data) => Object.assign(new Error('Conflict'), { status: 409, data });
    expect(enrichment.conflictOf(err({ error: { code: 'CONFLICT', current_value: 5000, proposed_value: 4500 } }), fee)).toEqual({ current: '$5,000.00', proposed: '$4,500.00' });
    expect(enrichment.conflictOf(err({ existing: { amount: 1200, due_date: '2026-11-30' }, incoming: { amount: 1500, due_date: '2026-12-01' } }), step))
      .toEqual({ current: '$1,200.00 · Due Nov 30, 2026', proposed: '$1,500.00 · Due Dec 1, 2026' });
    expect(enrichment.conflictOf(Object.assign(new Error('x'), { status: 500 }), fee)).toBeNull();
  });

  test('a conflict shows both values with "Replace with this" and "Keep the current value"', () => {
    const vm = enrichment.viewModel(payload);
    const html = enrichment.renderPanelHtml(vm, { conflicts: { f1: { current: '$5,000.00', proposed: '$4,500.00' } } });
    const item = html.split('data-suggestion-id="f1"').slice(1).join('data-suggestion-id="f1"').split('</li>')[0];
    expect(item).toContain('Already saved: $5,000.00');
    expect(item).toContain('This letter: $4,500.00');
    expect(item).toContain('data-enrichment-action="overwrite"');
    expect(item).toContain('>Replace with this</lex-btn>');
    expect(item).toContain('data-enrichment-action="keep"');
    expect(item).toContain('>Keep the current value</lex-btn>');
  });

  test('the page saves notes per kind and wires the conflict actions', () => {
    const notes = enrichment.acceptedNote;
    expect(notes('fee')).toBe('Fee saved.');
    expect(notes('payment')).toBe('Payment step saved.');
    expect(notes('engagement_signed')).toBe('Marked signed.');
    expect(notes('contact', 'contact')).toBe('Contact added.');
    expect(notes('deadline', 'calendar_event')).toBe('Deadline added to the calendar.');
    expect(notes('other', '')).toBe('Suggestion accepted.');
  });
});

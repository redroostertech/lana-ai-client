'use strict';

// Matter AI policy card (src/js/matter-ai-policy.model.js and the card markup
// in src/js/matter-ai-policy.js): the three options with their one-line
// explanations, editable only when the backend says this person may change
// it (matter admin or organization admin), a read-only badge otherwise, and
// an unknown value shown as the strictest choice, never as "Any".

const path = require('path');

const M = require(path.join(__dirname, '..', '..', 'src', 'js', 'matter-ai-policy.model.js'));
global.MatterAiPolicyModel = M;
const Card = require(path.join(__dirname, '..', '..', 'src', 'js', 'matter-ai-policy.js'));

const OPTIONS = [
  { value: 'any', label: 'Any', description: 'LANA uses the model on your computer first and may use Forge, the hosted model, when it needs to.' },
  { value: 'local_only', label: 'Local AI only', description: 'This matter is only ever sent to the model on the person\'s own computer, never to Forge.' },
  { value: 'never_leave_firm', label: 'Never leave the firm', description: 'Local AI only, and background work for this matter runs only on its owner\'s computer, never in the cloud.' }
];

const answer = (aiPolicy, canChange) => ({ matter_id: 'MATT-1', ai_policy: aiPolicy, can_change: canChange, options: OPTIONS });

describe('view model', () => {
  test.each([
    ['any', 'Any', 'gray'],
    ['local_only', 'Local AI only', 'yellow'],
    ['never_leave_firm', 'Never leave the firm', 'red']
  ])('%s shows %s with a %s badge and its explanation', (value, label, color) => {
    const model = M.viewModel(answer(value, false));
    expect(model).toMatchObject({ value, label, badgeColor: color, known: true });
    expect(model.description).toBe(OPTIONS.find((o) => o.value === value).description);
  });

  test('only someone the backend allows to change it gets the choice; everyone else is read only with a note (control: can_change true)', () => {
    expect(M.viewModel(answer('local_only', false))).toMatchObject({ editable: false, note: M.READ_ONLY_NOTE });
    expect(M.viewModel({ ...answer('local_only', undefined) })).toMatchObject({ editable: false });
    expect(M.viewModel({ ...answer('local_only', 'true') })).toMatchObject({ editable: false });
    expect(M.viewModel(answer('local_only', true))).toMatchObject({ editable: true, note: null });
    expect(M.viewModel(answer('local_only', true)).options.map((o) => o.value)).toEqual(['any', 'local_only', 'never_leave_firm']);
  });

  test.each([['cloud'], [null], [undefined], ['']])('an unknown value (%p) is shown as the strictest choice, never as Any', (value) => {
    const model = M.viewModel(answer(value, false));
    expect(model.value).toBe('never_leave_firm');
    expect(model.known).toBe(false);
    expect(M.viewModel(null).value).toBe('never_leave_firm');
  });

  test('a change is sent only for an offered value that differs, and only when editable', () => {
    const editable = M.viewModel(answer('any', true));
    expect(M.changeBody(editable, 'local_only')).toEqual({ ai_policy: 'local_only' });
    expect(M.changeBody(editable, 'any')).toBeNull();
    expect(M.changeBody(editable, 'cloud')).toBeNull();
    expect(M.changeBody(M.viewModel(answer('any', false)), 'local_only')).toBeNull();
  });
});

describe('card markup', () => {
  test('editable: a Lex radio group with the three options and no inline styles', () => {
    const html = Card.cardHtml(M.viewModel(answer('local_only', true)));
    expect(html).toContain('<lex-card id="aiPolicyCard" heading="AI policy"');
    expect(html).toContain('<lex-radio id="aiPolicyChoice"');
    expect(html).toContain('value="local_only"');
    expect(html).toContain('Never leave the firm');
    expect(html).not.toContain('matter-ai-policy-note');
    expect(html).not.toMatch(/style=/);
  });

  test('read only: a badge, the explanation and the note, no radio group', () => {
    const html = Card.cardHtml(M.viewModel(answer('never_leave_firm', false)));
    expect(html).toContain('<lex-badge label="Never leave the firm" color="red"');
    expect(html).not.toContain('<lex-radio');
    expect(html).toContain('Only a matter admin or an organization admin can change this.');
  });

  test('dark theme: the card uses its dark surface (control: light has none)', () => {
    expect(Card.cardHtml(M.viewModel(answer('any', true)), { dark: true })).toContain('bg="dark"');
    expect(Card.cardHtml(M.viewModel(answer('any', true)))).not.toContain('bg="dark"');
  });

  test('text from the server is escaped', () => {
    const html = Card.cardHtml(M.viewModel({ ai_policy: 'any', can_change: false, options: [{ value: 'any', label: '<img src=x onerror=1>', description: '"quoted"' }] }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

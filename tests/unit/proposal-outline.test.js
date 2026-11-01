'use strict';

const P = require('../../src/js/shared/proposal-outline.js');

const esc = (value) => String(value).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');

// A work proposal as backend phase 7b validates it (work-proposal.models.js).
const proposal = {
  title: 'Funding follow-ups',
  tasks: [
    { title: 'Get the IRA letter', description: 'Ask the custodian <in writing>.', priority: 'high',
      about: [{ kind: 'matter_asset', id: 'a1b2c3d4-0000-4000-8000-000000000001' }], resolves: [{ kind: 'rulebook_rule', id: 'x.beneficiary.trust_primary' }] },
    { title: 'Check the deed', about: [], resolves: [{ kind: 'assurance_record', id: 'f00dbabe-0000-4000-8000-000000000002' }] },
  ],
  summary: { title: 'What we found', items: [
    { label: 'fact', title: 'Deed recorded', text: 'Recorded October 22.', about: [{ kind: 'rulebook_rule', id: 'x.title.deed' }] },
    { label: 'open_question', title: 'Is the account joint?', text: 'Confirm with the bank.', about: [] },
  ] },
};

test('outline reads tasks with about and resolves chips and summary items with label text', () => {
  const view = P.outline(proposal);
  expect(view.title).toBe('Funding follow-ups');
  expect(view.tasks.map((task) => task.chips.map((chip) => chip.text))).toEqual([
    ['Asset a1b2c3d4', 'Resolves x.beneficiary.trust_primary'], ['Resolves Assurance record f00dbabe']]);
  expect(view.notes.title).toBe('What we found');
  expect(view.notes.items.map((item) => [item.labelText, item.title])).toEqual([['Fact', 'Deed recorded'], ['Open question', 'Is the account joint?']]);
});

test('control: content without tasks or summary items has no outline', () => {
  expect(P.outline({ title: 'x', sections: [] })).toBeNull();
  expect(P.outline({ tasks: [{ description: 'no title' }] })).toBeNull();
  expect(P.outline(null)).toBeNull();
  expect(P.outline([proposal])).toBeNull();
  expect(P.outline({ summary: { items: [{ label: 'fact', title: 'Only a note' }] } }).tasks).toEqual([]);
});

test('html escapes model text and shows both sections', () => {
  const html = P.html(P.outline(proposal), esc);
  expect(html).toContain('Ask the custodian &lt;in writing&gt;.');
  expect(html).not.toContain('<in writing>');
  expect(html).toContain('Proposed tasks <span>2</span>');
  expect(html).toContain('What we found <span>2</span>');
  expect(html).toContain('label="High"');
});

test('stateLine and tasksHref', () => {
  expect(P.stateLine({ status: 'applied' }).state).toBe('applied');
  expect(P.stateLine({ status: 'approved' }).text).toContain('Apply it from the agent run');
  expect(P.stateLine({ status: 'proposed' })).toEqual({ state: 'pending', text: '' });
  expect(P.stateLine(null).state).toBe('pending');
  expect(P.stateLine({ status: 'rejected' }).state).toBe('other');
  expect(P.stateLine({ status: 'failed_to_apply' })).toEqual({ state: 'failed', text: expect.stringContaining('Apply it again') });
  expect(P.APPLY_AGAIN).toBe('Apply again');
  expect(P.tasksHref('MATT 1', '../')).toBe('../workspace-details.html?id=MATT%201&tab=tasks');
  expect(P.tasksHref(null)).toBe('');
});

'use strict';
const view = require('../../../src/js/services/assurance-rulebook-view');
const starter = () => ({ id: 'starter', title: 'Georgia starter', version: '2026.1', jurisdiction: 'US-GA',
  modules: [{ id: 'title', title: 'Title' }, { id: 'tax', title: 'Tax' }, { id: 'empty', title: 'Empty' }],
  rules: [
    { id: 'GA-2', module: 'tax', title: 'Tax filing', kind: 'LAW', verification: 'S', severity: 'warning', citations: [] },
    { id: 'GA-1', module: 'title', title: 'Deed recorded', kind: 'LAW', verification: 'O', severity: 'blocking', citations: [] },
    { id: 'GA-3', module: 'title', title: 'Practice check', kind: 'PRACTICE', verification: 'U', severity: 'info', citations: [] },
    { id: 'GA-4', module: 'unknown', title: 'Loose rule', kind: 'PRACTICE', verification: 'C', severity: 'info', citations: [] }],
  counts: { rules: 4 } });

test('groups rules in server module order, drops empty modules, and keeps unlisted modules visible', () => {
  const groups = view.groupRules(starter());
  expect(groups.map(group => group.module.title)).toEqual(['Title', 'Tax', 'Other rules']);
  expect(groups[0].rules.map(rule => rule.id)).toEqual(['GA-1', 'GA-3']);
  expect(groups[2].rules.map(rule => rule.id)).toEqual(['GA-4']);
  expect(view.groupRules(null)).toEqual([]);
  expect(view.summary(starter())).toBe('4 rules in 3 modules · 3 review flags');
});
test('verification, severity and kind badges map every contract value; U, S and C are review flags', () => {
  expect(['O', 'O-2025', 'S', 'C', 'U'].map(code => view.verificationBadge(code).reviewFlag)).toEqual([false, false, true, true, true]);
  expect(view.verificationBadge('O').color).toBe('green');
  expect(view.verificationBadge('U')).toMatchObject({ color: 'red', label: expect.stringContaining('Unverified') });
  expect(view.verificationBadge('X')).toMatchObject({ reviewFlag: true, color: 'red' });
  expect(view.severityBadge('blocking').color).toBe('red'); expect(view.severityBadge('warning').color).toBe('yellow'); expect(view.severityBadge('info').color).toBe('blue');
  expect(view.severityBadge('other').color).toBe('gray');
  expect(view.kindLabel('LAW')).toBe('Law'); expect(view.kindLabel('PRACTICE')).toBe('Firm practice');
  expect(view.reviewFlagNotice).toContain('not legal conclusions');
});
test('permission gating: adopted rulebook wins; only publishRulebook may adopt; others get a read-only explanation', () => {
  expect(view.viewMode({ id: 'rb' }, { publishRulebook: true })).toBe('adopted');
  expect(view.viewMode(null, { publishRulebook: true })).toBe('adopt');
  expect(view.viewMode(null, { publishRulebook: false })).toBe('preview');
  expect(view.viewMode(null, null)).toBe('preview');
  expect(view.accessExplanation('preview')).toContain('requires the rulebook publishing permission');
});
test('adopt command state requires adopt mode, an idle mailbox and a matching previewed starter', () => {
  const ready = { mode: 'adopt', pending: null, busy: false, canPersist: true, jurisdiction: 'US-GA', starter: starter() };
  expect(view.adoptState(ready)).toEqual({ enabled: true, reason: '' });
  expect(view.adoptState({ ...ready, mode: 'preview' }).enabled).toBe(false);
  expect(view.adoptState({ ...ready, pending: { operation: 'adoptRulebook' } }).reason).toContain('Recover the pending');
  expect(view.adoptState({ ...ready, busy: true }).enabled).toBe(false);
  expect(view.adoptState({ ...ready, canPersist: false }).reason).toContain('read-only');
  expect(view.adoptState({ ...ready, jurisdiction: '' }).reason).toContain('Choose a jurisdiction');
  expect(view.adoptState({ ...ready, jurisdiction: 'US-FL' }).reason).toContain('Preview the starter');
});
test('adopt command carries only jurisdiction, expected version and trimmed rationale', () => {
  expect(view.adoptCommand({ adopted: null, jurisdiction: 'US-GA', starter: starter(), rationale: '  Reviewed flags. ' })).toEqual({ jurisdiction: 'US-GA', expectedVersion: 0, rationale: 'Reviewed flags.' });
  expect(() => view.adoptCommand({ adopted: null, jurisdiction: 'US-GA', starter: starter(), rationale: ' ' })).toThrow('Explain');
  expect(() => view.adoptCommand({ adopted: { id: 'rb' }, jurisdiction: 'US-GA', starter: starter(), rationale: 'x' })).toThrow('already');
  expect(() => view.adoptCommand({ adopted: null, jurisdiction: 'US-IN', starter: starter(), rationale: 'x' })).toThrow('Preview the starter');
  expect(view.adoptErrorMessage({ status: 409 })).toContain('changed');
  expect(view.adoptErrorMessage({ status: 403 })).toContain('permission');
  expect(view.adoptErrorMessage({ status: 0 })).toBeNull();
});
test('starter envelope is unwrapped and checked against the requested jurisdiction', () => {
  expect(view.unwrapStarter({ record: starter() }, 'US-GA').id).toBe('starter');
  expect(view.unwrapStarter(starter(), 'US-GA').id).toBe('starter');
  expect(() => view.unwrapStarter({ record: starter() }, 'US-IN')).toThrow('different jurisdiction');
  expect(() => view.unwrapStarter({ items: [] })).toThrow('did not return');
});
test('targets resolve their rulebook rule and show the rule id and title', () => {
  const rulebooks = [{ id: 'rb', rules: [{ id: 'GA-1', title: 'Deed recorded', predicate: 'owner' }, { id: 'GA-9', title: 'Other', predicate: 'other' }] }];
  const rule = view.ruleForTarget(rulebooks, { rulebook_ref: { id: 'rb' }, predicate: 'owner' });
  expect(view.ruleLabel(rule)).toBe('GA-1 · Deed recorded');
  expect(view.ruleForTarget(rulebooks, { rulebook_ref: { id: 'rb' }, rule_id: 'GA-9', predicate: 'owner' }).id).toBe('GA-9');
  expect(view.ruleForTarget(rulebooks, { rulebook_ref: { id: 'missing' }, predicate: 'owner' })).toBeNull();
  expect(view.ruleLabel({ predicate: 'owner', label: 'Registered owner' })).toBe('Registered owner');
});
test('citations open only web URLs', () => {
  expect(view.citationUrl('https://law.example/a')).toBe('https://law.example/a');
  expect(view.citationUrl('javascript:alert(1)')).toBeNull();
  expect(view.citationUrl('not a url')).toBeNull();
});

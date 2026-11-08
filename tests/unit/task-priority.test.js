/**
 * One priority look for the task drawer, My Tasks and Board cards.
 */
const P = require('../../src/js/shared/task-priority.js');

describe('task priority badge', () => {
  test.each([
    ['high', 'High', 'red'], ['urgent', 'Urgent', 'red'], ['HIGH', 'High', 'red'],
    ['medium', 'Medium', 'yellow'], ['normal', 'Normal', 'yellow'], ['low', 'Low', 'gray'],
    [null, 'Normal', 'yellow'], ['', 'Normal', 'yellow']
  ])('%s reads as %s in %s', (priority, label, color) => {
    expect(P.label(priority)).toBe(label);
    expect(P.color(priority)).toBe(color);
    expect(P.badgeHtml(priority)).toBe('<lex-badge label="' + label + '" color="' + color + '"></lex-badge>');
  });

  test('a strange value cannot break out of the attribute', () => {
    expect(P.badgeHtml('a"><x')).toBe('<lex-badge label="A&quot;&gt;&lt;x" color="gray"></lex-badge>');
  });
});

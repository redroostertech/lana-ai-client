/**
 * Matter Board cards: each task, and each subtask as its own card linked to
 * its task, in the column for its status. Subtasks have no review step.
 */
const B = require('../../src/js/shared/board-work-items.js');

const task = {
  id: 't1', item_key: 'M17-3', title: 'Review Employee Benefit Statement', status: 'pending', source: 'lana',
  subtasks: [
    { id: 's1', item_key: 'M17-4', title: 'Verify the statement', status: 'pending', order_index: 0 },
    { id: 's2', item_key: 'M17-5', title: 'Identify discrepancies', status: 'completed', order_index: 1 },
    { id: 's3', item_key: 'M17-6', title: 'Ask the client', status: 'in_progress', order_index: 2 }
  ]
};

describe('boardItems', () => {
  test('a task is followed by one card per subtask, linked to it', () => {
    const items = B.boardItems([task]);
    expect(items.map((i) => i.item_key)).toEqual(['M17-3', 'M17-4', 'M17-5', 'M17-6']);
    expect(items[1]).toEqual(expect.objectContaining({
      kind: 'subtask', id: 's1', title: 'Verify the statement', parent_id: 't1', parent_key: 'M17-3', parent_title: 'Review Employee Benefit Statement'
    }));
  });

  test.each([
    ['no subtasks field (external task)', { id: 'x', status: 'Pending', source: 'connector' }],
    ['an empty list', { id: 'y', status: 'pending', subtasks: [] }]
  ])('%s adds no subtask cards', (_label, t) => {
    expect(B.boardItems([t])).toEqual([t]);
  });
});

describe('columns', () => {
  test.each([
    ['pending', 'pending'], ['completed', 'complete'], ['complete', 'complete'], ['in_progress', 'in_progress'],
    ['In Progress', 'in_progress'], ['Pending', 'pending'], ['in_review', 'in_review'], ['cancelled', 'cancelled']
  ])('status %s sits in column %s', (status, column) => {
    expect(B.columnFor({ status })).toBe(column);
  });

  test.each([
    ['pending', 'pending'], ['in_progress', 'in_progress'], ['complete', 'completed'], ['cancelled', 'cancelled'], ['in_review', null]
  ])('dropping a subtask in %s sets %s', (column, status) => {
    expect(B.subtaskStatusForColumn(column)).toBe(status);
  });
});

describe('card title', () => {
  test('a short title is shown whole', () => {
    expect(B.cardTitle('  Review Employee Benefit Statement ')).toBe('Review Employee Benefit Statement');
  });

  test('a long title is cut on a word, under the limit, with "..."', () => {
    const long = 'Verify the benefit statement against the client employment contract and note every coverage amount that differs';
    const shown = B.cardTitle(long);
    expect(shown.endsWith('...')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(B.CARD_TITLE_MAX + 3);
    expect(long.startsWith(shown.slice(0, -3))).toBe(true);
    expect(long.charAt(shown.length - 3)).toBe(' ');
  });

  test('a subtask card carries its priority', () => {
    const cards = B.boardItems([{ id: 't1', title: 'T', subtasks: [{ id: 's1', title: 'S', priority: 'high' }] }]);
    expect(cards[1].priority).toBe('high');
  });
});

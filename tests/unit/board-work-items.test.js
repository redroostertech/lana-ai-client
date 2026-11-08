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

describe('task card menu', () => {
  const values = (items) => items.map((i) => (i.divider ? '-' : i.value));

  test.each([
    ['pending', ['complete', 'close', '-', 'lana']],
    ['in_review', ['complete', 'close', '-', 'lana']],
    ['complete', ['close', '-', 'lana']],
    ['cancelled', ['complete', '-', 'lana']]
  ])('a %s task offers %j', (status, expected) => {
    expect(values(B.taskMenuItems({ id: 't1', status }))).toEqual(expected);
  });

  test('Ask LANA is the LANA pill with an action label', () => {
    const lana = B.taskMenuItems({ status: 'pending' }).find((i) => i.value === 'lana');
    expect(lana).toEqual({ value: 'lana', label: 'Ask LANA about this task', variant: 'lana' });
  });

  test('complete sets complete and close sets cancelled; anything else sets nothing', () => {
    expect([B.taskCloseoutStatus('complete'), B.taskCloseoutStatus('close'), B.taskCloseoutStatus('lana'), B.taskCloseoutStatus('')])
      .toEqual(['complete', 'cancelled', null, null]);
  });
});

describe('Ask LANA about a task', () => {
  const matter = { matter_id: 'MATT-00017', matter_name: 'Estate planning intake: Jordan Ellis', matter_type: 'estate' };

  test('attaches the task, its key, matter and subtasks as a ui_card the dock already reads', () => {
    const context = B.taskChatContext(task, matter);
    expect(context).toEqual(expect.objectContaining({
      type: 'ui_card', ui_label: 'M17-3 Review Employee Benefit Statement', source: 'workspace_details_board', card_key: 'task:t1'
    }));
    expect(context.page).toEqual({ route: 'workspace-details', tab: 'tasks', matter_id: 'MATT-00017', matter_name: 'Estate planning intake: Jordan Ellis', matter_type: 'estate' });
    expect(context.details).toEqual(expect.objectContaining({ task_id: 't1', item_key: 'M17-3', title: 'Review Employee Benefit Statement', status: 'pending' }));
    expect(context.details.subtasks.map((s) => s.item_key)).toEqual(task.subtasks.map((s) => s.item_key));
    expect(B.taskChatPrompt(task)).toBe('Help me with M17-3 Review Employee Benefit Statement.');
  });

  test('a task with no key or description still reads cleanly', () => {
    const context = B.taskChatContext({ id: 't9', title: 'Call the bank', description: 'null' }, {});
    expect(context.ui_label).toBe('Call the bank');
    expect(context.details.description).toBeNull();
    expect(context.details.subtasks).toEqual([]);
    expect(B.taskChatPrompt({ title: 'Call the bank' })).toBe('Help me with Call the bank.');
  });
});

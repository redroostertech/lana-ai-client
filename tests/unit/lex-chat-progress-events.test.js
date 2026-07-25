'use strict';

const progressEvents = require('../../src/js/lex/chat/lex-chat-progress-events');

describe('Lex chat progress event coalescing', () => {
  test('deduplicates consecutive heartbeat updates for the same task step and phase', () => {
    const heartbeat = {
      type: 'agentic_progress',
      task_id: 'task-1',
      currentStep: 2,
      phase: 'execution',
      status: 'still_working',
      message: 'Still working on step 2 of 3',
      heartbeat: true
    };
    const key = progressEvents.getProgressEventKey(heartbeat);

    expect(key).toBe('agentic_progress|task-1|2|execution|still_working|heartbeat');
    expect(progressEvents.shouldReplaceConsecutive(key, {
      ...heartbeat,
      message: 'Still working on the reviewed draft'
    })).toBe(true);
  });

  test('preserves phase and terminal-status transitions as separate rows', () => {
    const activeKey = progressEvents.getProgressEventKey({
      type: 'agentic_progress', taskId: 'task-1', stepId: 'step-2', phase: 'reviewing', status: 'in_progress'
    });

    expect(progressEvents.shouldReplaceConsecutive(activeKey, {
      type: 'agentic_progress', taskId: 'task-1', stepId: 'step-2', phase: 'saving', status: 'in_progress'
    })).toBe(false);
    expect(progressEvents.shouldReplaceConsecutive(activeKey, {
      type: 'agentic_progress', taskId: 'task-1', stepId: 'step-2', phase: 'reviewing', status: 'completed'
    })).toBe(false);
  });

  test('does not coalesce ordinary reasoning entries without progress identity', () => {
    expect(progressEvents.getProgressEventKey({ type: 'reasoning', message: 'First observation' })).toBe('');
    expect(progressEvents.shouldReplaceConsecutive('', {
      type: 'reasoning', message: 'Second observation'
    })).toBe(false);
  });

  test('preserves distinct non-heartbeat milestones within the same phase', () => {
    const firstKey = progressEvents.getProgressEventKey({
      type: 'agentic_progress', taskId: 'task-1', currentStep: 2,
      phase: 'execution', status: 'in_progress', message: 'Generating draft'
    });

    expect(progressEvents.shouldReplaceConsecutive(firstKey, {
      type: 'agentic_progress', taskId: 'task-1', currentStep: 2,
      phase: 'execution', status: 'in_progress', message: 'Reviewing draft'
    })).toBe(false);
  });
});

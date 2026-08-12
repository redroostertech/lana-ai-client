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

    expect(key).toBe('agentic_progress|task-1|2||execution|still_working|heartbeat');
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

  test('coalesces tool progress heartbeats but preserves retrieval milestones', () => {
    const heartbeat = {
      type: 'tool_progress',
      toolName: 'document_retrieval',
      phase: 'retrieval',
      status: 'searching',
      message: 'Searching the attached document embeddings for relevant evidence...',
      heartbeat: true
    };
    const key = progressEvents.getProgressEventKey(heartbeat);

    expect(key).toBe('tool_progress|||document_retrieval|retrieval|searching|heartbeat');
    expect(progressEvents.shouldReplaceConsecutive(key, {
      ...heartbeat,
      message: 'Still searching attached document embeddings...'
    })).toBe(true);

    expect(progressEvents.shouldReplaceConsecutive(progressEvents.getProgressEventKey({
      type: 'tool_progress',
      toolName: 'document_retrieval',
      phase: 'retrieval',
      message: 'Scanning the attached document content directly for relevant sections...'
    }), {
      type: 'tool_progress',
      toolName: 'document_retrieval',
      phase: 'retrieval',
      message: 'Searching the attached document embeddings for relevant evidence...'
    })).toBe(false);

    expect(progressEvents.shouldReplaceConsecutive(key, {
      ...heartbeat,
      toolName: 'query_analytics_data'
    })).toBe(false);
  });

  test('gives retrieval completion and context compaction stable progress identities', () => {
    expect(progressEvents.getProgressEventKey({
      type: 'rag_complete',
      phase: 'retrieval',
      status: 'completed',
      message: 'Found 4 relevant excerpts across 2 documents.'
    })).toBe('rag_complete||||retrieval|completed|Found 4 relevant excerpts across 2 documents.');

    expect(progressEvents.getProgressEventKey({
      type: 'conversation_compaction',
      phase: 'context',
      status: 'applied',
      message: 'Context compacted to keep this conversation within budget.'
    })).toBe('conversation_compaction||||context|applied|Context compacted to keep this conversation within budget.');
  });
});

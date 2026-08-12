/* ===========================================================================
   Lex Chat — consecutive progress event coalescing

   Liveness heartbeats are a transport contract, not separate reasoning
   milestones. This helper gives progress-like events a stable identity so
   the activity drawer can update the latest row in place while preserving
   actual phase and terminal-status transitions.
   ========================================================================== */

(function (global) {
  'use strict';

  function stringPart(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function stepPart(event) {
    var value = event.stepId ?? event.step_id ?? event.currentStep ?? event.current_step;
    if (value === undefined || value === null) {
      value = (typeof event.step === 'string' || typeof event.step === 'number') ? event.step : '';
    }
    return stringPart(value);
  }

  function getProgressEventKey(event) {
    if (!event || typeof event !== 'object') return '';

    var type = stringPart(event.type);
    var phase = stringPart(event.phase || event.category);
    var status = stringPart(event.status);
    var step = stepPart(event);
    var task = stringPart(event.taskId ?? event.task_id);
    var tool = stringPart(event.toolName || event.tool_name || event.tool);
    var isProgressLike = type === 'agentic_progress'
      || type === 'progress'
      || type === 'document_progress'
      || type === 'tool_progress'
      || type === 'rag_complete'
      || type === 'conversation_compaction'
      || event.heartbeat === true
      || Boolean(phase || status || step || task);

    if (!isProgressLike) return '';
    // Heartbeat copy can evolve while the same operation remains alive, so
    // its structural identity is sufficient. For ordinary progress, include
    // the message so two meaningful milestones in one phase stay separate.
    var copyIdentity = event.heartbeat === true
      ? 'heartbeat'
      : stringPart(event.message || event.content).trim().replace(/\s+/g, ' ');
    return [type || 'progress', task, step, tool, phase, status, copyIdentity].join('|');
  }

  function shouldReplaceConsecutive(previousKey, event) {
    var nextKey = getProgressEventKey(event);
    return Boolean(nextKey && previousKey && nextKey === previousKey);
  }

  var api = {
    getProgressEventKey: getProgressEventKey,
    shouldReplaceConsecutive: shouldReplaceConsecutive
  };

  global.Lex = global.Lex || {};
  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.ProgressEvents = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

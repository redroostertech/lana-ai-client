/**
 * LANA Briefs: Find more notes on the meeting page. Plain functions over the FindMoreView the
 * Briefs bridge returns (findMore.state, findMore events); no DOM. The page
 * (src/briefs/app.js) renders with them; tests/unit/briefs/briefs-find-more.test.js covers them.
 */
(function (global) {
  'use strict';

  const KIND_LABEL = { summary: 'Key point', decision: 'Decision', openQuestion: 'Question', task: 'Task' };

  /** The pill shows on a meeting with a transcript, never while notes are written or a run is going. */
  function canFindMore(view, meeting) {
    if (!meeting.hasTranscript || meeting.writingNotes) return false;
    return !view || view.status !== 'running';
  }

  function pillLabel(view) {
    return view && view.lastRun ? 'Find more notes again' : 'Find more notes';
  }

  function progressText(view) {
    if (!view || view.status !== 'running') return null;
    return view.of > 0 ? `Finding more notes, part ${view.part} of ${view.of}` : 'Finding more notes';
  }

  /** The line above the suggestions, or the result when there are none; null when there is nothing to say. */
  function resultHeading(view) {
    if (!view) return null;
    if (view.status === 'failed') return 'LANA could not finish reading this meeting. Try again.';
    if (view.status === 'unavailable') return 'The LANA model is needed to find more notes. Get it in Settings, Ask.';
    if (view.suggestions.length > 0) return `LANA found ${view.suggestions.length} more`;
    if (view.status === 'ready' && view.lastRun && view.lastRun.found === 0) return 'LANA did not find anything new.';
    return null;
  }

  function kindLabel(kind) {
    return KIND_LABEL[kind] || 'Key point';
  }

  /** A task's owner and when, as one line. */
  function taskFacts(suggestion) {
    if (suggestion.kind !== 'task') return '';
    const when = suggestion.dueText || (suggestion.dueDate ? `Due ${suggestion.dueDate}` : '');
    return [suggestion.owner, when].filter(Boolean).join(', ');
  }

  /** The in-app notice when a run finishes: { kind, text }, or null while it runs. */
  function doneNotice(view, title) {
    if (!view || view.status === 'running' || view.status === 'idle') return null;
    const name = String(title || '').trim() || 'this meeting';
    if (view.status === 'failed') return { kind: 'error', text: 'LANA could not finish finding more notes for this meeting.' };
    if (view.status === 'unavailable') return { kind: 'error', text: 'The LANA model is needed to find more notes. Get it in Settings, Ask.' };
    const found = view.lastRun ? view.lastRun.found : 0;
    if (found === 0) return { kind: 'info', text: `LANA did not find anything new in ${name}.` };
    return { kind: 'success', text: `LANA found ${found} more ${found === 1 ? 'note' : 'notes'} for ${name}.` };
  }

  /** True when the earlier view was a run going and the new one is not. */
  function justFinished(before, after) {
    return Boolean(before && before.status === 'running' && after && after.status !== 'running');
  }

  const api = { canFindMore, pillLabel, progressText, resultHeading, kindLabel, taskFacts, doneNotice, justFinished };
  global.BriefsFindMore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

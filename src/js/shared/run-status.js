/**
 * run-status.js
 * Pure, DOM-free run status helpers shared by the Automations and Agents
 * apps (one vocabulary for both, after LANA Orcestr8's run views):
 *
 *   running | queued | waiting | succeeded | failed | cancelled | unknown | none
 *
 * Maps automation execution statuses, agent run statuses and the API's
 * last_run object ({ run_id, state, status, started_at, finished_at }) onto
 * that vocabulary, writes short relative times ("5m ago"), tracks which runs
 * just ended (so a view can mark the moment), and turns step lists from
 * either app into one live trace shape.
 *
 * Classic script (window.LanaRunStatus) so Jest can require it and both the
 * ES-module automation views and the IIFE agents views can read it.
 */
(function (global) {
  'use strict';

  var STATE_BY_STATUS = {
    in_progress: 'running',
    running: 'running',
    active: 'running',
    compiling_context: 'running',
    approved: 'running',
    pending: 'queued',
    queued: 'queued',
    awaiting_approval: 'waiting',
    awaiting_input: 'waiting',
    paused: 'waiting',
    completed: 'succeeded',
    succeeded: 'succeeded',
    complete: 'succeeded',
    skipped: 'succeeded',
    failed: 'failed',
    errored: 'failed',
    error: 'failed',
    cancelled: 'cancelled',
    rejected: 'cancelled'
  };

  // The API's shared run states (last-run.contract) onto this vocabulary.
  var STATE_BY_SHARED_STATE = {
    active: 'running',
    completed: 'succeeded',
    failed: 'failed',
    cancelled: 'cancelled'
  };

  var LABELS = {
    running: 'Running',
    queued: 'Queued',
    waiting: 'Needs you',
    succeeded: 'Succeeded',
    failed: 'Failed',
    cancelled: 'Cancelled',
    unknown: 'Unknown',
    none: 'Never run'
  };

  function stateOf(value) {
    if (value && typeof value === 'object') {
      var byStatus = value.status ? STATE_BY_STATUS[String(value.status).toLowerCase()] : null;
      if (byStatus) return byStatus;
      return STATE_BY_SHARED_STATE[value.state] || (value.run_id ? 'unknown' : 'none');
    }
    if (value === null || value === undefined || value === '') return 'none';
    return STATE_BY_STATUS[String(value).toLowerCase()] || 'unknown';
  }

  function labelOf(state) {
    return LABELS[state] || LABELS.unknown;
  }

  function isLive(state) {
    return state === 'running' || state === 'queued';
  }

  function isEnded(state) {
    return state === 'succeeded' || state === 'failed' || state === 'cancelled';
  }

  function shortAgo(value, now) {
    if (!value) return '';
    var time = new Date(value).getTime();
    if (!Number.isFinite(time)) return '';
    var seconds = Math.max(0, Math.round(((now ? new Date(now).getTime() : Date.now()) - time) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  }

  function lastRunSummary(lastRun, now) {
    var state = stateOf(lastRun);
    if (state === 'none') return { state: state, label: LABELS.none, time: '', runId: '' };
    var live = isLive(state) || state === 'waiting';
    var when = live ? lastRun.started_at : (lastRun.finished_at || lastRun.started_at);
    var ago = shortAgo(when, now);
    return {
      state: state,
      label: labelOf(state),
      time: ago ? (live ? 'started ' + ago : ago) : '',
      runId: String(lastRun.run_id || '')
    };
  }

  /**
   * Which runs moved since the last look: `ended` holds runs that were live
   * (or waiting) before and have now ended, once each; `started` holds runs
   * first seen live. Pass `next` back in on the following call.
   */
  function trackTransitions(previous, rows) {
    var before = previous || null;
    var next = {};
    var ended = [];
    var started = [];
    (rows || []).forEach(function (row) {
      if (!row || !row.id) return;
      var id = String(row.id);
      var state = row.state;
      next[id] = state;
      if (!before) return;
      var was = before[id];
      if ((isLive(was) || was === 'waiting') && isEnded(state)) ended.push({ id: id, state: state });
      if (was === undefined && isLive(state)) started.push(id);
    });
    return { next: next, ended: ended, started: started };
  }

  function humanizeStep(value) {
    var text = String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function durationOf(step) {
    var ms = Number(step.duration_ms);
    if (Number.isFinite(ms) && ms > 0) return ms;
    if (step.started_at && step.completed_at) {
      var span = new Date(step.completed_at).getTime() - new Date(step.started_at).getTime();
      if (Number.isFinite(span) && span >= 0) return span;
    }
    return null;
  }

  /**
   * Steps from either app as one trace: { key, label, state, detail,
   * durationMs, active }. While the run is live, the running step (or else
   * the first step that has not ended) is the active one.
   */
  function traceSteps(steps, options) {
    var live = Boolean(options && options.live);
    var list = (Array.isArray(steps) ? steps : []).map(function (step, index) {
      var number = step.step_index || index + 1;
      return {
        key: String(step.id || step.step_id || ('step-' + number)),
        // A label or title is already words; only a machine step id is humanized.
        label: String(step.label || step.title || '').trim() || humanizeStep(step.step_id) || ('Step ' + number),
        state: stateOf(step.status),
        detail: String(step.message || step.error || step.step_type || ''),
        durationMs: durationOf(step),
        active: false
      };
    });
    if (live) {
      var activeIndex = list.findIndex(function (step) { return step.state === 'running'; });
      if (activeIndex === -1) activeIndex = list.findIndex(function (step) { return !isEnded(step.state); });
      if (activeIndex !== -1) list[activeIndex].active = true;
    }
    return list;
  }

  var moduleApi = {
    LABELS: LABELS,
    stateOf: stateOf,
    labelOf: labelOf,
    isLive: isLive,
    isEnded: isEnded,
    shortAgo: shortAgo,
    lastRunSummary: lastRunSummary,
    trackTransitions: trackTransitions,
    traceSteps: traceSteps
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaRunStatus = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);

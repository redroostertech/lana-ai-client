/**
 * run-history.js
 * View mapping for a matter's run history and "Why did this run?" (design 14).
 *
 * Rows come from GET /api/v1/matters/:matter_id/activity/runs and one chain
 * from GET /api/v1/runs/:run_kind/:run_id/causation (shapes documented in
 * api/matter-makeup-api.client.js). Every started run and every refused start
 * is a row, so the outcome text below covers both: the keys are the backend
 * contract's RUN_OUTCOMES (src/shared/contracts/run-causation.contract.js,
 * checked by tests/unit/run-causation-backend-contract.test.js), plus `queued`,
 * which a debounced start answers before its job records the final outcome.
 * A refused start has no run, so its "why" is read from the row itself.
 * A started run also says where it is now: `run.state` (the contract's
 * RUN_STATES) as its status chip, the owner's own `run.status` as the chip's
 * detail, when it finished, and its own trace when it has one.
 * Unknown outcomes and origins still render, in words built from their key.
 * Provenance chips on tasks and notes come from produced_by links
 * (entity-links.js linkChips `run`).
 *
 * Public API (window.LanaRunHistory, or module.exports in Node):
 *   - RUN_KINDS                              -> kinds a causation row can name
 *   - OUTCOME_KEYS, ORIGIN_KEYS              -> outcomes and origins worded here
 *   - RUN_STATE_KEYS                         -> run states worded here
 *   - outcomeView(outcome)                   -> { key, label, tone, detail }
 *   - runStateView(run)                      -> { key, label, tone, detail } or null (no run, or no state)
 *   - originText(origin, eventType)          -> 'An event (task.created)'
 *   - actorText(row)                         -> 'Started by Ana Ruiz, acting as Sam Lee'
 *   - runKindLabel(kind)                     -> 'Agent run'
 *   - runRowView(row, names)                 -> one list entry
 *   - runRows(response, names)               -> { rows, nextCursor }
 *   - chainModel(result, names)              -> { origin, actor, steps[] root to leaf, related[] }
 *     result: the causation answer { causation, root } or one row
 */

(function (global) {
  'use strict';

  var RUN_KIND_LABELS = {
    agent_run: 'Agent run',
    automation_execution: 'Skill run',
    task_action: 'Task action'
  };
  var RUN_KINDS = Object.freeze(Object.keys(RUN_KIND_LABELS));

  // Decision 4 (deferred, coalesced), the refusal reasons in design 14, and
  // `queued` (a debounced start, not a recorded outcome).
  var OUTCOMES = {
    started: { label: 'Started', tone: 'green', detail: 'The run started.' },
    queued: { label: 'Queued', tone: 'blue', detail: 'The start was received. It runs in a moment, once related changes on this matter are gathered.' },
    deferred: { label: 'Follow-up queued', tone: 'blue', detail: 'Another run of this agent was already going on this matter, so one follow-up run was queued to start after it.' },
    coalesced: { label: 'Combined', tone: 'blue', detail: 'A follow-up run was already queued, so this request was folded into it.' },
    skipped_self_cause: { label: 'Skipped', tone: 'yellow', detail: 'Not run: it would have been started by its own earlier output.' },
    skipped_depth_limit: { label: 'Skipped', tone: 'yellow', detail: 'Not run: too many runs in a row were started by other runs.' },
    skipped_paused: { label: 'Skipped', tone: 'yellow', detail: 'Not run: automatic runs are paused for this organization.' },
    skipped_cap: { label: 'Skipped', tone: 'yellow', detail: 'Not run: the daily limit of automatic runs was reached.' },
    skipped_inactive: { label: 'Skipped', tone: 'yellow', detail: 'This is turned off.' },
    skipped_no_responsible_user: { label: 'Skipped', tone: 'yellow', detail: 'Not run: the matter has no responsible person for the run to act as.' },
    skipped_active_run: { label: 'Already running', tone: 'yellow', detail: 'Not run: this agent was already running on this matter.' },
    refused_write_tools: { label: 'Refused', tone: 'red', detail: 'Not run: this agent can change records, and automatic runs may only read.' },
    refused_permission: { label: 'Refused', tone: 'red', detail: 'Not run: the person it would act as may not start agents.' },
    followup_expired: { label: 'Skipped', tone: 'yellow', detail: 'Not run: the follow-up waited too long for the earlier run to finish.' },
    followup_failed: { label: 'Failed', tone: 'red', detail: 'Not run: the follow-up could not be started after the earlier run.' },
    skipped_unavailable: { label: 'Not available', tone: 'yellow', detail: 'Not run: what this action starts is not installed or not available on this matter.' }
  };
  var OUTCOME_KEYS = Object.freeze(Object.keys(OUTCOMES));

  // run-causation.contract RUN_STATES: where a started run is now.
  var RUN_STATES = {
    active: { label: 'Running', tone: 'blue' },
    completed: { label: 'Completed', tone: 'green' },
    failed: { label: 'Failed', tone: 'red' },
    cancelled: { label: 'Cancelled', tone: 'gray' }
  };
  var RUN_STATE_KEYS = Object.freeze(Object.keys(RUN_STATES));

  var ORIGINS = {
    event: 'An event',
    task: 'A task action',
    schedule: 'A schedule',
    chat: 'Chat',
    api: 'The API',
    mcp: 'An MCP tool'
  };
  var ORIGIN_KEYS = Object.freeze(Object.keys(ORIGINS));

  function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function humanize(key) {
    var words = text(key).split('_').filter(Boolean).join(' ');
    return words ? words.charAt(0).toUpperCase() + words.substring(1) : '';
  }

  function outcomeView(outcome) {
    var key = text(outcome) || 'started';
    var known = OUTCOMES[key];
    if (known) return { key: key, label: known.label, tone: known.tone, detail: known.detail };
    var refused = key.indexOf('skipped_') === 0 || key.indexOf('refused_') === 0;
    return { key: key, label: refused ? 'Skipped' : humanize(key), tone: refused ? 'yellow' : 'gray', detail: humanize(key) + '.' };
  }

  // The started run's state chip; null when there is no run or its owner
  // did not say (the row then shows its start outcome).
  function runStateView(run) {
    var key = run ? text(run.state) : '';
    var known = RUN_STATES[key];
    if (!known) return null;
    var status = text(run.status);
    return { key: key, label: known.label, tone: known.tone, detail: status ? 'Status: ' + humanize(status) + '.' : known.label + '.' };
  }

  function runFact(row, field) {
    return row && row.run ? text(row.run[field]) : '';
  }

  function originText(origin, eventType) {
    var key = text(origin);
    var base = ORIGINS[key] || (key ? humanize(key) : 'Unknown');
    var event = text(eventType);
    return event ? base + ' (' + event + ')' : base;
  }

  function runKindLabel(kind) {
    return RUN_KIND_LABELS[kind] || humanize(kind) || 'Run';
  }

  // Who started it, and who it acted as when that is someone else
  // (design 9: task starts act as the presser, event starts as the person
  // whose action caused the event). Names are the server's; ids alone read
  // generically. row.actor is { kind, user_id }.
  function actorText(row) {
    if (!row) return '';
    var actor = row.actor || {};
    var who = actor.kind === 'system' ? 'the system' : (text(row.actor_name) || 'a team member');
    var out = 'Started by ' + who;
    var acting = text(row.acting_user_id);
    if (acting && acting !== text(actor.user_id)) {
      out += ', acting as ' + (text(row.acting_user_name) || 'the responsible person');
    }
    return out;
  }

  function eventTypeOf(row) {
    return row && row.origin_event ? row.origin_event.type : null;
  }

  function runIdOf(row) {
    return row && row.run ? text(row.run.id) : '';
  }

  // A key the page cannot name reads as itself, except an id (an automation
  // made outside the makeup is keyed by its uuid), which reads as its kind.
  var ID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function nameFor(kind, key, names) {
    var known = key && names && names[key];
    if (known) return known;
    return (key && !ID_KEY.test(key) ? text(key) : '') || runKindLabel(kind);
  }

  // A started run is explained by fetching its causation; a refused start
  // has no run, so the row it came in already holds its chain.
  function runRowView(row, names) {
    var source = row || {};
    var kind = text(source.run_kind);
    return {
      key: text(source.id) || kind + ':' + runIdOf(source),
      runKind: kind,
      runId: runIdOf(source),
      title: nameFor(kind, text(source.runnable_key), names),
      kindLabel: runKindLabel(kind),
      outcome: outcomeView(source.outcome),
      state: runStateView(source.run),
      finishedAt: runFact(source, 'finished_at'),
      executionTraceId: runFact(source, 'execution_trace_id'),
      origin: originText(source.origin, eventTypeOf(source)),
      actor: actorText(source),
      when: text(source.created_at),
      explainable: Boolean(kind),
      source: source
    };
  }

  // GET /activity/runs answers { status, data: { runs, next_cursor } }.
  function runRows(response, names) {
    var payload = (response && response.data) || {};
    var rows = Array.isArray(payload.runs) ? payload.runs : [];
    return {
      rows: rows.map(function (row) { return runRowView(row, names); }),
      nextCursor: payload.next_cursor || null
    };
  }

  function stepView(item, index, count, names) {
    var kind = text(item.kind);
    return {
      kind: kind,
      id: text(item.id),
      label: nameFor(kind, text(item.runnable_key), names),
      kindLabel: runKindLabel(kind),
      isRoot: index === 0,
      isLeaf: index === count - 1
    };
  }

  /**
   * Steps from the first cause to this run. `chain` lists the runs before
   * this one (root to parent); the row itself is the leaf. `related` is every
   * other recorded attempt under the same root (the causation answer's
   * `root`), so a reader sees what else that first cause set off.
   */
  function chainModel(result, names) {
    var payload = (result && result.data) || result || {};
    var source = payload.causation || payload;
    var chain = (Array.isArray(source.chain) ? source.chain : []).filter(function (item) { return item && item.kind && item.id; });
    var leaf = { kind: text(source.run_kind), id: runIdOf(source), runnable_key: text(source.runnable_key) };
    var all = chain.concat([leaf]);
    var steps = all.map(function (item, index) { return stepView(item, index, all.length, names); });
    var related = (Array.isArray(payload.root) ? payload.root : []).filter(function (row) {
      return row && text(row.id) !== text(source.id);
    }).map(function (row) { return runRowView(row, names); });
    return {
      origin: originText(source.origin, eventTypeOf(source)),
      actor: actorText(source),
      outcome: outcomeView(source.outcome),
      state: runStateView(source.run),
      finishedAt: runFact(source, 'finished_at'),
      executionTraceId: runFact(source, 'execution_trace_id'),
      depth: typeof source.depth === 'number' ? source.depth : chain.length,
      traceId: text(source.trace_id),
      when: text(source.created_at),
      steps: steps,
      related: related
    };
  }

  var moduleApi = {
    RUN_KINDS: RUN_KINDS,
    OUTCOME_KEYS: OUTCOME_KEYS,
    ORIGIN_KEYS: ORIGIN_KEYS,
    RUN_STATE_KEYS: RUN_STATE_KEYS,
    outcomeView: outcomeView,
    runStateView: runStateView,
    originText: originText,
    actorText: actorText,
    runKindLabel: runKindLabel,
    runRowView: runRowView,
    runRows: runRows,
    chainModel: chainModel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaRunHistory = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);

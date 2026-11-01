/**
 * run-controls.js
 * View mapping for the admin Run controls page (admin/run-controls.html):
 * the organization's run limits and agent usage (design 13 decision 5,
 * design 14 "Cost"). Shapes are documented in api/run-controls-api.client.js.
 *
 * The server owns every rule: what the limits mean, their bounds, who may
 * read or change them. This module only words the answers, turns the
 * editor's text into the wire body (only the fields that changed) and reads
 * the server's refusals back onto the editor.
 *
 * Public API (window.LanaRunControls, or module.exports in Node):
 *   - LIMIT_FIELDS                          -> the editable wire fields
 *   - PERIODS, periodWindow(days, now)      -> usage period choices, { since, until }
 *   - money(microdollars)                   -> '$1.23' ('Not priced' for null)
 *   - count(n)                              -> '12,345'
 *   - limitsView(limits, formatTime?)       -> what the editor shows
 *   - draftChange(limits, draft)            -> { change, errors } (change null when nothing changed;
 *                                              it carries expected_updated_at, the revision it was read at)
 *   - revisionOf(limits)                    -> expected_updated_at for limits as read
 *   - changeSummary(change)                 -> the admin's change in words (shown when it was not saved)
 *   - errorView(error)                      -> { kind: 'forbidden'|'unavailable'|'field'|'stale'|'error', field?, title, text,
 *                                              limits? (stale: the current limits) }
 *   - usageView(usage)                      -> { tiles, agents, triggers, matters }
 */

(function (global) {
  'use strict';

  var LIMIT_FIELDS = Object.freeze(['max_automatic_agent_runs_per_day', 'max_agent_spend_microdollars_per_day', 'automatic_runs_paused']);
  var MICRO = 1000000;
  var DAY_MS = 24 * 60 * 60 * 1000;

  var PERIODS = Object.freeze([
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' }
  ]);

  // Who or what started the runs, as the agents app records trigger_type.
  // Unknown keys still read, in words built from the key.
  var TRIGGER_LABELS = {
    manual: 'A person',
    event: 'An event',
    schedule: 'A schedule',
    automation: 'A skill',
    task_action: 'A task action',
    api: 'The API',
    mcp: 'An MCP tool',
    delegation: 'Another agent',
    unknown: 'Not recorded'
  };

  function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function humanize(key) {
    var words = text(key).split('_').filter(Boolean).join(' ');
    return words ? words.charAt(0).toUpperCase() + words.substring(1) : '';
  }

  function count(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function money(microdollars) {
    if (microdollars === null || microdollars === undefined) return 'Not priced';
    var dollars = Number(microdollars) / MICRO;
    var digits = dollars !== 0 && Math.abs(dollars) < 1 ? 4 : 2;
    return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function periodWindow(days, now) {
    var until = now instanceof Date ? now : new Date(now || Date.now());
    var span = Number(days) > 0 ? Number(days) : 30;
    return { since: new Date(until.getTime() - span * DAY_MS).toISOString(), until: until.toISOString() };
  }

  function defaultTime(value) {
    var date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  // Spend is stored in microdollars and edited in dollars; null is "none".
  function spendDollars(microdollars) {
    if (microdollars === null || microdollars === undefined) return '';
    return String(Number(microdollars) / MICRO);
  }

  // ' by Ana Ruiz' when the server named the person, else nothing.
  function byName(name) {
    return text(name) ? ' by ' + text(name) : '';
  }

  function limitsView(limits, formatTime) {
    var source = limits || {};
    var when = formatTime || defaultTime;
    var paused = source.automatic_runs_paused === true;
    var status;
    if (paused) status = (source.paused_at ? 'Paused since ' + when(source.paused_at) : 'Paused') + byName(source.paused_by_name) + '.';
    else status = 'Automatic runs start as their events and schedules ask.';
    var cap = source.max_automatic_agent_runs_per_day;
    var started = source.started_today;
    return {
      paused: paused,
      statusText: status,
      statusTone: paused ? 'yellow' : 'green',
      statusLabel: paused ? 'Paused' : 'Running',
      dailyLimit: source.max_automatic_agent_runs_per_day === undefined || source.max_automatic_agent_runs_per_day === null
        ? '' : String(source.max_automatic_agent_runs_per_day),
      spend: spendDollars(source.max_agent_spend_microdollars_per_day),
      updatedText: source.is_default === true
        ? 'These are the defaults. No one has changed them yet.'
        : (source.updated_at ? 'Last changed ' + when(source.updated_at) + byName(source.updated_by_name) + '.' : ''),
      usedToday: started === undefined || started === null || cap === undefined || cap === null
        ? '' : count(started) + ' of ' + count(cap) + ' used today'
    };
  }

  /**
   * The PUT body for what the admin changed, or null when nothing changed.
   * Text that is not a number at all cannot be sent, so it is answered here;
   * every bound (whole number, range) is the server's to refuse.
   *
   * @param {Object} limits - the limits the editor was filled from
   * @param {{ dailyLimit?: string, spend?: string, paused?: boolean }} draft
   * @returns {{ change: Object|null, errors: Object }}
   */
  function draftChange(limits, draft) {
    var source = limits || {};
    var input = draft || {};
    var change = {};
    var errors = {};
    if (input.dailyLimit !== undefined) {
      var daily = text(input.dailyLimit);
      var dailyNumber = Number(daily);
      if (!daily || !Number.isFinite(dailyNumber)) errors.max_automatic_agent_runs_per_day = 'Enter a number of runs.';
      else if (dailyNumber !== source.max_automatic_agent_runs_per_day) change.max_automatic_agent_runs_per_day = dailyNumber;
    }
    if (input.spend !== undefined) {
      var spend = text(input.spend);
      if (spend.charAt(0) === '$') spend = spend.substring(1);
      spend = spend.split(',').join('');
      var micro = spend === '' ? null : Math.round(Number(spend) * MICRO);
      if (spend !== '' && !Number.isFinite(Number(spend))) errors.max_agent_spend_microdollars_per_day = 'Enter an amount in dollars, or leave it empty.';
      else if (micro !== (source.max_agent_spend_microdollars_per_day === undefined ? null : source.max_agent_spend_microdollars_per_day)) {
        change.max_agent_spend_microdollars_per_day = micro;
      }
    }
    if (input.paused !== undefined && input.paused !== (source.automatic_runs_paused === true)) {
      change.automatic_runs_paused = input.paused === true;
    }
    if (Object.keys(errors).length || !Object.keys(change).length) return { change: null, errors: errors };
    // The revision the editor was filled from; the server refuses the save
    // (409 RUN_LIMITS_STALE) when the limits changed since.
    change.expected_updated_at = revisionOf(source);
    return { change: change, errors: errors };
  }

  /** The revision limits were read at, as expected_updated_at: their updated_at, null for the defaults. */
  function revisionOf(limits) {
    var source = limits || {};
    return source.is_default === true ? null : (text(source.updated_at) || null);
  }

  /** The admin's change in words, e.g. 'Automatic agent runs per day: 50. Daily spend figure: none.' */
  function changeSummary(change) {
    var source = change || {};
    var parts = [];
    var has = function (field) { return Object.prototype.hasOwnProperty.call(source, field); };
    if (has('automatic_runs_paused')) parts.push(source.automatic_runs_paused ? 'Pause automatic runs.' : 'Turn automatic runs back on.');
    if (has('max_automatic_agent_runs_per_day')) parts.push('Automatic agent runs per day: ' + count(source.max_automatic_agent_runs_per_day) + '.');
    if (has('max_agent_spend_microdollars_per_day')) {
      parts.push('Daily spend figure: ' + (source.max_agent_spend_microdollars_per_day === null ? 'none' : money(source.max_agent_spend_microdollars_per_day)) + '.');
    }
    return parts.join(' ');
  }

  function errorBody(error) {
    return (error && error.data && error.data.error && typeof error.data.error === 'object') ? error.data.error : {};
  }

  /**
   * A refused read or save as the page shows it. A validation refusal names
   * its field (the error handler's `field`, the first zod issue's path) and
   * carries the issue's own message.
   */
  function errorView(error) {
    var status = error && error.status;
    var body = errorBody(error);
    var message = text(body.message) || text(error && error.message);
    if (status === 403) return { kind: 'forbidden', title: 'Not permitted', text: message || 'You do not have permission to see this.' };
    if (status === 404) return { kind: 'unavailable', title: 'Not available', text: 'This server does not offer it.' };
    if (status === 409 && (body.code === 'RUN_LIMITS_STALE' || (error && error.code === 'RUN_LIMITS_STALE'))) {
      var details = body.details && typeof body.details === 'object' ? body.details : {};
      return {
        kind: 'stale', title: 'Not saved',
        text: 'Your change was not saved because someone else changed the run limits after you opened this page. The current values are shown.',
        limits: details.limits || null
      };
    }
    if (status === 400) {
      var issues = Array.isArray(body.details) ? body.details : [];
      var issue = issues[0] || {};
      var field = text(body.field) || (Array.isArray(issue.path) ? text(issue.path[0]) : '');
      var detail = text(issue.message) || message || 'The server did not accept this value.';
      if (field && LIMIT_FIELDS.indexOf(field) !== -1) return { kind: 'field', field: field, title: 'Not saved', text: detail };
      return { kind: 'error', title: 'Not saved', text: detail };
    }
    return { kind: 'error', title: 'Something went wrong', text: message || 'The server could not answer. Try again.' };
  }

  function bucketCells(bucket) {
    var source = bucket || {};
    return {
      runs: count(source.runs),
      tokens: count(source.total_tokens),
      cost: money(source.estimated_cost_microdollars)
    };
  }

  // 'Fairweather Trust (MATT-02417)'; a matter the server could not name
  // reads generically, never as its uuid.
  function matterLabel(row) {
    if (!text(row.matter_id)) return 'No matter';
    var code = text(row.matter_code);
    var name = text(row.matter_name);
    if (name && code) return name + ' (' + code + ')';
    return name || code || 'Unnamed matter';
  }

  function usageView(usage) {
    var source = usage || {};
    var totals = source.totals || {};
    var list = function (rows) { return Array.isArray(rows) ? rows : []; };
    return {
      tiles: [
        { key: 'runs', label: 'Agent runs', value: count(totals.runs) },
        { key: 'tokens', label: 'Tokens', value: count(totals.total_tokens),
          detail: count(totals.input_tokens) + ' in, ' + count(totals.output_tokens) + ' out' },
        { key: 'cost', label: 'Estimated cost', value: money(totals.estimated_cost_microdollars) }
      ],
      agents: list(source.by_agent).map(function (row) {
        return Object.assign({ id: text(row.agent_definition_id), agent: text(row.agent_name) || text(row.agent_slug) || 'Agent' }, bucketCells(row));
      }),
      triggers: list(source.by_trigger_type).map(function (row) {
        var key = text(row.trigger_type) || 'unknown';
        return Object.assign({ id: key, trigger: TRIGGER_LABELS[key] || humanize(key) }, bucketCells(row));
      }),
      matters: list(source.by_matter).map(function (row) {
        var matter = text(row.matter_id);
        return Object.assign({ id: matter || 'none', matter: matterLabel(row) }, bucketCells(row));
      })
    };
  }

  var moduleApi = {
    LIMIT_FIELDS: LIMIT_FIELDS,
    PERIODS: PERIODS,
    periodWindow: periodWindow,
    money: money,
    count: count,
    limitsView: limitsView,
    draftChange: draftChange,
    changeSummary: changeSummary,
    revisionOf: revisionOf,
    errorView: errorView,
    usageView: usageView
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaRunControls = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);

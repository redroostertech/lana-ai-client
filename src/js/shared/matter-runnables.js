/**
 * matter-runnables.js
 * View mapping for the agents and skills a matter's makeup enables
 * (design 4.1 `runnables`, 6.3 readiness).
 *
 * The server decides availability and readiness; this module only words
 * them. Missing information never blocks a start (design 6.3): an agent with
 * gaps can still be started, and the run labels what it could not review.
 *
 * Public API (window.LanaMatterRunnables, or module.exports in Node):
 *   - runnableRef(runnable)                  -> 'agent:<key>' | 'skill:<key>'
 *   - runnableViews(makeup)                  -> [view] for the panel
 *   - runnableGroups(views)                  -> [{ kind, title, views, unavailable }]
 *   - runnableNames(makeup)                  -> { key: name } for run history
 *   - readinessSummary(readiness)            -> { status, label, tone, total, ready, missing, unknown } | null
 *   - readinessModel(result, tabs)           -> { status, label, tone, note, reason, readyCount, total, progress, checks[] }
 *   - activeRunView(activeRun)               -> the card status for the agent's run already going
 *                                               (the view's active_run), `running` true; null without one
 *   - startResultView(response, name)        -> { kind, label, tone, text, toast, activeRunId, running } for a 202 answer
 *   - startErrorView(error)                  -> the same for a refused start; `running` is true
 *                                               while the agent is already running ("Running now")
 *   - toggleErrorMessage(error)              -> text for a refused skill toggle
 */

(function (global) {
  'use strict';

  var inNode = typeof module !== 'undefined' && module.exports;

  function runHistory() { return global.LanaRunHistory || (inNode && require('./run-history.js')); }

  function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function humanize(key) {
    var words = text(key).split('_').filter(Boolean).join(' ');
    return words ? words.charAt(0).toUpperCase() + words.substring(1) : '';
  }

  function runnableRef(runnable) {
    return (runnable && runnable.kind) + ':' + (runnable && runnable.key);
  }

  var SUMMARY = {
    ready: { label: 'Ready', tone: 'green' },
    incomplete: { label: 'Some things missing', tone: 'yellow' },
    unknown: { label: 'Not checked', tone: 'gray' }
  };

  function count(value) {
    return typeof value === 'number' && value >= 0 ? value : 0;
  }

  // The view model's { status, total, ready, missing, unknown } (null when
  // the server could not check). The collapsed line says how much is ready;
  // the tone says whether anything is missing or was not checked.
  function readinessSummary(readiness) {
    if (!readiness || !readiness.status) return null;
    var known = SUMMARY[readiness.status] || { label: humanize(readiness.status), tone: 'gray' };
    var total = count(readiness.total);
    var ready = count(readiness.ready);
    return {
      status: readiness.status,
      label: total ? ready + ' of ' + total + ' ready' : known.label,
      tone: known.tone,
      total: total,
      ready: ready,
      missing: count(readiness.missing),
      unknown: count(readiness.unknown)
    };
  }

  // Nothing to check (total 0) shows no line and never calls the route.
  function hasChecks(summary) {
    return Boolean(summary) && summary.total > 0;
  }

  function runnableViews(makeup) {
    var list = makeup && Array.isArray(makeup.runnables) ? makeup.runnables : [];
    return list.filter(function (item) {
      return item && (item.kind === 'agent' || item.kind === 'skill') && text(item.key);
    }).map(function (item) {
      var available = item.available !== false;
      var isAgent = item.kind === 'agent';
      var automationId = text(item.automation_id);
      return {
        ref: runnableRef(item),
        kind: item.kind,
        key: text(item.key),
        name: text(item.name) || humanize(String(item.key).split('-').join('_')),
        description: text(item.description),
        // Skills only: when the skill runs ("Runs daily at 09:00").
        triggerSummary: isAgent ? '' : text(item.trigger_summary),
        available: available,
        unavailableText: available ? '' : (text(item.reason) || 'Not available for this organization.'),
        // readiness null (the server could not check) or nothing to check
        // (total 0) shows no line, and the readiness route is not called.
        readiness: isAgent ? readinessSummary(item.readiness) : null,
        hasReadiness: isAgent && hasChecks(readinessSummary(item.readiness)),
        // The server offers a start (can_start) only to a person who may
        // start agents; without it the card shows no Start. An agent already
        // running on this matter (start_blocked_reason active_run) shows
        // Start turned off, with that run.
        startable: isAgent && available && item.can_start === true,
        running: isAgent && available && item.start_blocked_reason === 'active_run' ? activeRunView(item.active_run || {}) : null,
        definitionId: text(item.definition_id),
        enabled: item.enabled === true,
        automationId: automationId,
        // The skill toggle names the automation row; without its id the
        // server has not offered a way to change it here.
        toggleable: !isAgent && available && Boolean(automationId)
      };
    });
  }

  // Agents, then skills. What the organization cannot run is set apart so it
  // never reads as a card with a dead button.
  function runnableGroups(views) {
    var list = Array.isArray(views) ? views : [];
    return [
      { kind: 'agent', title: 'Agents' },
      { kind: 'skill', title: 'Skills' }
    ].map(function (group) {
      var mine = list.filter(function (view) { return view.kind === group.kind; });
      return {
        kind: group.kind,
        title: group.title,
        count: mine.length,
        views: mine.filter(function (view) { return view.available; }),
        unavailable: mine.filter(function (view) { return !view.available; })
      };
    }).filter(function (group) { return group.count; });
  }

  function runnableNames(makeup) {
    return runnableViews(makeup).reduce(function (out, view) {
      out[view.key] = view.name;
      return out;
    }, {});
  }

  // Missing first (what to act on), then ready, then what was not checked.
  var CHECK_STATUS = {
    missing: { label: 'Missing', tone: 'yellow', icon: 'alert-circle', order: 0 },
    ready: { label: 'Ready', tone: 'green', icon: 'check-circle-2', order: 1 },
    unknown: { label: 'Not checked', tone: 'gray', icon: 'circle', order: 2 }
  };

  var CHECK_GROUPS = {
    entities: 'Records',
    facts: 'Notes',
    rulebook: 'Rulebook',
    records: 'Records',
    apps: 'Apps'
  };

  // 'entities.matter_asset' -> 'Records: Matter asset'. The server's own
  // label wins when it sends one.
  function checkText(check) {
    if (text(check.label)) return text(check.label);
    var code = text(check.code);
    var dot = code.indexOf('.');
    var group = dot === -1 ? code : code.substring(0, dot);
    var rest = dot === -1 ? '' : code.substring(dot + 1);
    var head = CHECK_GROUPS[group] || humanize(group) || 'Check';
    return rest ? head + ': ' + humanize(rest.split('.').join('_')) : head;
  }

  // '0 of 2' while short; once met, how many there are. A check that could
  // not be read (found null) shows no count.
  function countText(check) {
    if (typeof check.need !== 'number' || typeof check.found !== 'number') return '';
    return check.status === 'ready' ? String(check.found) : check.found + ' of ' + check.need;
  }

  function tabLabel(tabs, tabId) {
    var list = Array.isArray(tabs) ? tabs : [];
    for (var i = 0; i < list.length; i++) {
      var tab = list[i];
      if (!tab || tab.hidden || tab.available === false) continue;
      if (tab.id === tabId || tab.key === tabId) return tab.label || humanize(tabId);
    }
    return '';
  }

  // A fix names a tab to visit, a form to fill, or both. A tab this matter
  // does not show, or shows as unavailable, is left out rather than offered
  // as a dead button. The
  // form is the direct fix, so it comes first; the tab is where to look.
  function fixesFor(check, tabs) {
    var fix = check && check.fix;
    if (!fix || check.status === 'ready') return [];
    var out = [];
    var tabId = text(fix.tab);
    var tab = tabId ? tabLabel(tabs, tabId) : '';
    var form = text(fix.form);
    if (form) out.push({ type: 'form', form: form, subject: text(fix.subject) || null, label: text(fix.label) || 'Add it now' });
    // Beside a form the tab is a small icon; alone it carries the words.
    if (tab) out.push({ type: 'tab', tab: tabId, label: form ? 'Open ' + tab : (text(fix.label) || 'Add in ' + tab), title: 'Opens ' + tab, iconOnly: Boolean(form) });
    return out;
  }

  // GET /makeup/readiness (bare body): { status, total, ready, missing, unknown,
  // checks: [{ ..., reason? }], reason? }. Counts follow the checks shown.
  function readinessModel(result, tabs) {
    var source = result || {};
    var checks = (Array.isArray(source.checks) ? source.checks : []).filter(Boolean).map(function (check, index) {
      var known = CHECK_STATUS[check.status] ? check.status : 'unknown';
      var status = CHECK_STATUS[known];
      return {
        code: text(check.code),
        text: checkText(check),
        status: known,
        statusLabel: status.label,
        tone: status.tone,
        icon: status.icon,
        counts: countText(Object.assign({}, check, { status: known })),
        // Why the server could not check it ("No deployment jurisdiction ...").
        reason: text(check.reason),
        fixes: fixesFor(check, tabs),
        _order: status.order * 1000 + index
      };
    }).sort(function (a, b) { return a._order - b._order; }).map(function (check) {
      delete check._order;
      return check;
    });
    var missing = checks.filter(function (check) { return check.status === 'missing'; }).length;
    var readyCount = checks.filter(function (check) { return check.status === 'ready'; }).length;
    var total = checks.length;
    var unknown = total - missing - readyCount;
    var status = source.status || (missing ? 'incomplete' : (unknown ? 'unknown' : 'ready'));
    var summary = readinessSummary({ status: status, total: total, ready: readyCount, missing: missing, unknown: unknown });
    return {
      status: summary.status,
      label: summary.label,
      tone: summary.tone,
      note: missing ? 'You can still start it. The agent notes what it could not review.' : '',
      reason: text(source.reason),
      readyCount: readyCount,
      total: total,
      progressLabel: total ? readyCount + ' of ' + total + ' ready' : '',
      progress: total ? Math.round((readyCount / total) * 100) : 0,
      checks: checks
    };
  }

  // The agents start answers (api/matter-makeup-api.client.js): 202 with
  // outcome started, queued (debounced), deferred or coalesced (the latter two
  // name the run already going); 409 with error.code equal to the refusing
  // outcome, or ACTIVE_RUN_EXISTS when a person starts an agent that already
  // runs on this matter. `label` is the one status shown on the card; `toast`
  // is false when that status already says everything (the card shows it).
  var KIND_TONE = { success: 'green', info: 'blue', warning: 'yellow', error: 'red' };

  function resultView(kind, label, message, activeRunId, toast, running) {
    return { kind: kind, label: label, tone: KIND_TONE[kind], text: message, toast: toast !== false, activeRunId: activeRunId || null, running: running === true };
  }

  var RUNNING_TEXT = 'This agent is already running on this matter. Start it again once that run finishes.';

  // The agents app run status queued reads Queued; any other active status
  // Running now. The card says it, so no toast repeats it.
  function activeRunView(activeRun) {
    if (!activeRun) return null;
    var label = text(activeRun.status) === 'queued' ? 'Queued' : 'Running now';
    return resultView('info', label, RUNNING_TEXT, text(activeRun.id) || null, false, true);
  }

  function startResultView(response, name) {
    var outcome = text(response && response.outcome) || 'started';
    var activeRunId = text(response && response.active_run_id) || null;
    // A started run is now this agent's run on the matter: the card shows it
    // going, and the toast says it started.
    if (outcome === 'started') {
      var run = (response && response.run) || {};
      var going = activeRunView({ id: run.id, status: run.status || 'queued' });
      // The toast is a success; the card's badge reads like any run going.
      return Object.assign(resultView('success', going.label, name + ' started', going.activeRunId, true, true), { tone: going.tone });
    }
    var view = runHistory().outcomeView(outcome);
    var waiting = outcome === 'queued' || outcome === 'deferred' || outcome === 'coalesced';
    return resultView(waiting ? 'info' : 'warning', view.label, view.detail, activeRunId);
  }

  function startErrorView(error) {
    var status = error && error.status;
    var body = (error && error.data) || {};
    var code = text((error && error.code) || (body.error && body.error.code));
    var refusal = function (message) { return resultView('error', 'Not started', message); };
    // ACTIVE_RUN_EXISTS is the HTTP code; skipped_active_run the recorded outcome.
    if (code === 'ACTIVE_RUN_EXISTS' || code === 'skipped_active_run') {
      var activeRunId = text(body.error && body.error.details && body.error.details.active_run_id)
        || text(body.error && body.error.active_run_id) || text(body.active_run_id) || null;
      // Not a failure: the agent is busy. The card says "Running now" with a
      // link to that run, so no toast repeats it.
      return resultView('info', 'Running now', RUNNING_TEXT, activeRunId, false, true);
    }
    if (code && runHistory().OUTCOME_KEYS.indexOf(code) !== -1) {
      var view = runHistory().outcomeView(code);
      return resultView('warning', view.label, view.detail);
    }
    if (status === 403) return refusal('You do not have permission to run this agent.');
    if (status === 404) return refusal('This agent is not installed for your organization.');
    if (status === 400 && error.message && error.message !== 'Validation failed') return refusal(error.message);
    return refusal('LANA could not start this agent. Try again.');
  }

  function toggleErrorMessage(error) {
    var status = error && error.status;
    if (status === 403) return 'You do not have permission to change skills on this matter.';
    if (status === 404) return 'This skill is not installed for your organization.';
    return 'The skill could not be changed. Try again.';
  }

  var moduleApi = {
    runnableRef: runnableRef,
    runnableViews: runnableViews,
    runnableGroups: runnableGroups,
    runnableNames: runnableNames,
    readinessSummary: readinessSummary,
    readinessModel: readinessModel,
    startResultView: startResultView,
    startErrorView: startErrorView,
    activeRunView: activeRunView,
    toggleErrorMessage: toggleErrorMessage
  };

  if (inNode) module.exports = moduleApi;
  if (global) global.LanaMatterRunnables = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);

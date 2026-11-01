/**
 * makeup-switch.js
 * View mapping and request body for switching a matter's makeup
 * (design 4.1 PUT /matters/:matter_id/makeup, decisions 6 and 7).
 *
 * Switching hides tabs and labels; it never deletes notes, tasks, links or
 * records (design 9). Version upgrades are opt-in: a matter keeps its
 * version until a person picks the newer one. The server enforces the
 * `matters:configure_makeup` permission; the client only hides the menu
 * item when the view model says the user lacks it.
 *
 * Public API (window.LanaMakeupSwitch, or module.exports in Node):
 *   - EXPLANATION                            -> what a switch does and does not do
 *   - canConfigure(view)                     -> false only when the server says no
 *   - currentMakeup(view)                    -> { key, name, version, latestVersion } | null
 *   - upgradeOffer(current)                  -> { version, text } | null
 *   - makeupList(response)                   -> [{ key, name, description, latestVersion, scope }]
 *   - makeupOptions(list, current)           -> lex-select options
 *   - switchPlan(current, selectedKey, list) -> { kind: 'none'|'upgrade'|'switch', makeupKey, version, text }
 *   - switchBody(plan, reason)               -> { ok, body } | { ok: false, error }
 *   - switchResultView(response, plan)       -> { kind, text, incomplete } for a PUT answer
 *   - sendSwitch(send, body, options)        -> send(body), resent unchanged while the server
 *                                               answers 409 MAKEUP_SWITCH_IN_PROGRESS (retryable)
 *   - isIncomplete(error)                    -> true for 503 MAKEUP_SWITCH_INCOMPLETE (resend the same body)
 *   - isInProgress(error)                    -> true for an answer marked retryable (resend the same body)
 *   - needsFinish(error)                     -> either of the two: the dialog offers "Finish setup"
 *   - switchErrorMessage(error)              -> text for a refused switch
 */

(function (global) {
  'use strict';

  var inNode = typeof module !== 'undefined' && module.exports;

  function pendingSubmit() { return global.LanaPendingSubmit || (inNode && require('./pending-submit.js')); }

  var EXPLANATION = 'Switching changes which tabs, note labels, agents and skills this matter shows. ' +
    'Nothing is deleted: notes, tasks, links and records stay, and tabs the new makeup leaves out are only hidden.';

  function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function num(value) {
    var n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  // The view model may carry `can_configure_makeup`; absent means the
  // server did not say, and the server still refuses a switch it forbids.
  function canConfigure(view) {
    if (!view || !view.makeup) return false;
    return view.can_configure_makeup !== false;
  }

  function currentMakeup(view) {
    var makeup = view && view.makeup;
    if (!makeup || !text(makeup.key)) return null;
    var version = num(makeup.version);
    return {
      key: text(makeup.key),
      name: text(makeup.name) || text(makeup.key),
      version: version,
      latestVersion: num(makeup.latest_version) || version
    };
  }

  function upgradeOffer(current) {
    if (!current || !current.version || !current.latestVersion || current.latestVersion <= current.version) return null;
    return {
      version: current.latestVersion,
      text: 'Version ' + current.latestVersion + ' of ' + current.name + ' is available. This matter uses version ' + current.version + '.'
    };
  }

  // GET /matter-makeups answers { makeups: [{ key, name, description, latest_version, scope }] }.
  function makeupList(response) {
    var rows = response && Array.isArray(response.makeups) ? response.makeups : [];
    return rows.filter(function (row) { return row && text(row.key); }).map(function (row) {
      return {
        key: text(row.key),
        name: text(row.name) || text(row.key),
        description: text(row.description),
        latestVersion: num(row.latest_version),
        scope: row.scope === 'organization' ? 'organization' : 'system'
      };
    });
  }

  function makeupOptions(list, current) {
    return (list || []).map(function (item) {
      var isCurrent = current && item.key === current.key;
      return {
        value: item.key,
        label: item.name + (isCurrent ? ' (current)' : ''),
        description: item.description || undefined
      };
    });
  }

  function findMakeup(list, key) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].key === key) return list[i];
    return null;
  }

  function switchPlan(current, selectedKey, list) {
    var key = text(selectedKey);
    if (!key) return { kind: 'none', text: 'Choose a makeup.' };
    var target = findMakeup(list, key);
    var name = target ? target.name : key;
    if (current && key === current.key) {
      var offer = upgradeOffer(current);
      if (!offer) return { kind: 'none', text: 'This matter already uses ' + current.name + ', version ' + current.version + '.' };
      return { kind: 'upgrade', makeupKey: key, version: offer.version, text: 'Upgrade ' + name + ' to version ' + offer.version + '.' };
    }
    var version = target && target.latestVersion;
    return {
      kind: 'switch',
      makeupKey: key,
      version: version || null,
      text: 'Switch this matter to ' + name + (version ? ', version ' + version : '') + '.'
    };
  }

  function switchBody(plan, reason) {
    if (!plan || plan.kind === 'none') return { ok: false, error: (plan && plan.text) || 'Choose a makeup.' };
    var why = text(reason);
    if (!why) return { ok: false, error: 'Give a reason for the change. It is kept in the matter history.' };
    var body = { makeup_key: plan.makeupKey, reason: why };
    if (plan.version) body.version = plan.version;
    return { ok: true, body: body };
  }

  function plural(count, one, many) { return count + ' ' + (count === 1 ? one : many); }

  var INCOMPLETE_TEXT = 'The makeup was changed, but some of its setup did not finish. Press Finish setup to complete it.';

  // PUT answers { outcome: 'switched'|'unchanged', assignment,
  // effects: { status: 'complete'|'incomplete', skills_disabled, starter_tasks_created }, ...view }.
  // `unchanged` is a resend to the version the matter already uses: the
  // server reran the setup steps, so a broken switch is now finished.
  function switchResultView(response, plan) {
    var outcome = text(response && response.outcome);
    var effects = (response && response.effects) || {};
    if (effects.status === 'incomplete') return { kind: 'warning', text: INCOMPLETE_TEXT, incomplete: true };
    var parts = [];
    if (effects.skills_disabled > 0) parts.push(plural(effects.skills_disabled, 'skill turned off', 'skills turned off'));
    if (effects.starter_tasks_created > 0) parts.push(plural(effects.starter_tasks_created, 'starter task added', 'starter tasks added'));
    var detail = parts.length ? ' (' + parts.join(', ') + ')' : '';
    if (outcome === 'unchanged') return { kind: 'success', text: 'The makeup setup is complete' + detail, incomplete: false };
    var done = (plan && plan.kind === 'upgrade' ? 'Makeup upgraded' : 'Makeup changed') + ', setup complete';
    return { kind: 'success', text: done + detail, incomplete: false };
  }

  function errorCode(error) {
    var body = (error && error.data) || {};
    return text((error && error.code) || (body.error && body.error.code));
  }

  function isIncomplete(error) {
    return Boolean(error) && error.status === 503 && errorCode(error) === 'MAKEUP_SWITCH_INCOMPLETE';
  }

  // 409 MAKEUP_SWITCH_IN_PROGRESS: another switch holds the matter's lock.
  // Nothing was recorded; the same body is worth sending again.
  function isInProgress(error) {
    if (!error || !error.status) return false;
    return (error.status === 409 && errorCode(error) === 'MAKEUP_SWITCH_IN_PROGRESS') || pendingSubmit().classifyError(error) === 'in_progress';
  }

  function needsFinish(error) {
    return isIncomplete(error) || isInProgress(error);
  }

  // Sends the body, and again unchanged after each wait while the server
  // says another switch is in progress; the last refusal is thrown.
  async function sendSwitch(send, body, options) {
    var opts = options || {};
    var delays = Array.isArray(opts.delays) ? opts.delays : pendingSubmit().IN_PROGRESS_RETRY_DELAYS;
    var wait = opts.wait || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    for (var attempt = 0; ; attempt++) {
      try {
        return await send(body);
      } catch (error) {
        if (!isInProgress(error) || attempt >= delays.length) throw error;
        await wait(delays[attempt]);
      }
    }
  }

  function switchErrorMessage(error) {
    var status = error && error.status;
    if (isIncomplete(error)) return INCOMPLETE_TEXT;
    if (isInProgress(error)) return 'Another change to this matter\'s makeup is still in progress. Press Finish setup to try again.';
    if (status === 403) return 'You do not have permission to change this matter\'s makeup.';
    if (status === 404) return 'That makeup or version is not available to your organization.';
    if (status === 400 && error.message && error.message !== 'Validation failed') return error.message;
    return 'The makeup could not be changed. Try again.';
  }

  var moduleApi = {
    EXPLANATION: EXPLANATION,
    canConfigure: canConfigure,
    currentMakeup: currentMakeup,
    upgradeOffer: upgradeOffer,
    makeupList: makeupList,
    makeupOptions: makeupOptions,
    switchPlan: switchPlan,
    switchBody: switchBody,
    switchResultView: switchResultView,
    sendSwitch: sendSwitch,
    isIncomplete: isIncomplete,
    isInProgress: isInProgress,
    needsFinish: needsFinish,
    switchErrorMessage: switchErrorMessage
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaMakeupSwitch = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);

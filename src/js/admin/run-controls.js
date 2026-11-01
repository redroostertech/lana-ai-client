/* Run Controls: Page Controller (standalone page, admin/run-controls.html)

   Zones:
     A  Automatic runs  the organization's run limits: pause switch, daily
                        limit of automatic agent runs, daily spend figure
     B  Agent usage     runs, tokens and estimated cost for a period, by
                        agent, by what started them and by matter

   The server decides who may read or change each zone (a 403 shows its
   message in place of the zone) and every bound on the values (a 400 shows
   on its field). Every save carries the revision it was read at; when the
   limits changed since (409 RUN_LIMITS_STALE) the page shows the current
   limits, says the change was not saved and offers to save it again.
   Wording and wire mapping: shared/run-controls.js.
*/

(function () {
  'use strict';

  var view = window.LanaRunControls;
  var client = new window.RunControlsAPIClient(window.api);

  var _limits = null;
  var _saving = false;
  var _refused = null;   // the change a stale save refused, until re-applied or dropped
  var _usageGen = 0;
  var _period = '30';

  function el(id) { return document.getElementById(id); }

  function formatTime(value) {
    return Lex.Utils.formatDateTime ? Lex.Utils.formatDateTime(value) : Lex.Utils.formatDate(value);
  }

  function setHidden(id, hidden) {
    var node = el(id);
    if (node) node.hidden = hidden;
  }

  function showRefused(zone, error) {
    var refusal = view.errorView(error);
    var empty = el(zone + 'RefusedEmpty');
    if (empty) {
      empty.message = refusal.title;
      empty.description = refusal.text;
    }
    setHidden(zone + 'Body', true);
    setHidden(zone + 'Refused', false);
  }

  // -------------------------------------------------------------------------
  // Zone A: automatic runs
  // -------------------------------------------------------------------------

  function notice(message, isError) {
    var node = el('runLimitsNotice');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('run-controls__notice--error', Boolean(isError));
  }

  function clearFieldErrors() {
    el('runLimitsDaily').error = '';
    el('runLimitsSpend').error = '';
  }

  function showFieldErrors(errors) {
    if (errors.max_automatic_agent_runs_per_day) el('runLimitsDaily').error = errors.max_automatic_agent_runs_per_day;
    if (errors.max_agent_spend_microdollars_per_day) el('runLimitsSpend').error = errors.max_agent_spend_microdollars_per_day;
  }

  function renderLimits(limits) {
    _limits = limits;
    var shown = view.limitsView(limits, formatTime);
    el('runLimitsPaused').checked = shown.paused;
    var status = el('runLimitsStatus');
    status.setAttribute('label', shown.statusLabel);
    status.setAttribute('color', shown.statusTone);
    el('runLimitsStatusText').textContent = shown.statusText;
    el('runLimitsDaily').value = shown.dailyLimit;
    el('runLimitsSpend').value = shown.spend;
    el('runLimitsUpdated').textContent = shown.updatedText;
    el('runLimitsUsedToday').textContent = shown.usedToday;
  }

  // The limits changed since they were read: show the current ones, and the
  // change that was not saved, which the admin can save again on them.
  function showStale(refusal, change) {
    if (refusal.limits) renderLimits(refusal.limits);
    _refused = {};
    Object.keys(change).forEach(function (field) { if (field !== 'expected_updated_at') _refused[field] = change[field]; });
    el('runLimitsStaleText').textContent = refusal.text;
    el('runLimitsStaleMine').textContent = 'Your change: ' + view.changeSummary(_refused);
    setHidden('runLimitsStale', false);
    if (!refusal.limits) loadLimits();
  }

  function clearStale() {
    _refused = null;
    setHidden('runLimitsStale', true);
  }

  async function saveChange(change, doneText) {
    _saving = true;
    var save = el('runLimitsSave');
    save.loading = true;
    clearFieldErrors();
    notice('');
    clearStale();
    try {
      renderLimits(await client.updateRunLimits(change));
      Lex.Toast.success(doneText);
    } catch (error) {
      var refusal = view.errorView(error);
      if (refusal.kind === 'forbidden') { showRefused('runLimits', error); return; }
      if (refusal.kind === 'stale') { showStale(refusal, change); return; }
      // A refused switch goes back to the stored state; refused typed values
      // stay as typed, so the person can correct them.
      if (Object.prototype.hasOwnProperty.call(change, 'automatic_runs_paused')) renderLimits(_limits);
      if (refusal.kind === 'field') {
        var errors = {};
        errors[refusal.field] = refusal.text;
        if (refusal.field === 'automatic_runs_paused') notice(refusal.text, true);
        else showFieldErrors(errors);
      } else {
        notice(refusal.title + ': ' + refusal.text, true);
      }
    } finally {
      _saving = false;
      save.loading = false;
    }
  }

  function onPauseChange(event) {
    if (_saving || !_limits) return;
    var paused = Boolean(event.detail && event.detail.value);
    var drafted = view.draftChange(_limits, { paused: paused });
    if (!drafted.change) return;
    saveChange(drafted.change, paused ? 'Automatic runs are paused.' : 'Automatic runs are back on.');
  }

  function onSave() {
    if (_saving || !_limits) return;
    clearFieldErrors();
    notice('');
    var drafted = view.draftChange(_limits, { dailyLimit: el('runLimitsDaily').value, spend: el('runLimitsSpend').value });
    if (Object.keys(drafted.errors).length) { showFieldErrors(drafted.errors); return; }
    if (!drafted.change) { notice('Nothing changed.'); return; }
    saveChange(drafted.change, 'Run limits saved.');
  }

  // Save the refused change again, on the limits now shown.
  function onReapply() {
    if (_saving || !_limits || !_refused) return;
    saveChange(Object.assign({}, _refused, { expected_updated_at: view.revisionOf(_limits) }), 'Run limits saved.');
  }

  async function loadLimits() {
    try {
      renderLimits(await client.getRunLimits());
    } catch (error) {
      showRefused('runLimits', error);
    }
  }

  // -------------------------------------------------------------------------
  // Zone B: agent usage
  // -------------------------------------------------------------------------

  function renderUsage(usage) {
    var shown = view.usageView(usage);
    shown.tiles.forEach(function (tile) {
      var id = { runs: 'runUsageRuns', tokens: 'runUsageTokens', cost: 'runUsageCost' }[tile.key];
      if (el(id)) el(id).value = tile.value;
      if (tile.key === 'tokens') el('runUsageTokensDetail').textContent = tile.detail;
    });
    var range = (usage && usage.window) || {};
    el('runUsageWindow').textContent = range.since && range.until
      ? Lex.Utils.formatDate(range.since) + ' to ' + Lex.Utils.formatDate(range.until) : '';
    el('runUsageByAgent').setData(shown.agents);
    el('runUsageByTrigger').setData(shown.triggers);
    el('runUsageByMatter').setData(shown.matters);
  }

  async function loadUsage() {
    var gen = ++_usageGen;
    try {
      var usage = await client.getUsage(view.periodWindow(_period, new Date()));
      if (gen !== _usageGen) return;
      setHidden('runUsageBody', false);
      setHidden('runUsageRefused', true);
      renderUsage(usage);
    } catch (error) {
      if (gen !== _usageGen) return;
      showRefused('runUsage', error);
    }
  }

  function onMatterRow(event) {
    var row = event.detail && event.detail.row;
    if (!row || row.id === 'none') return;
    Lex.Nav.go('workspace-details.html', { params: { id: row.id } });
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  function init() {
    el('runLimitsPaused').addEventListener('lex-change', onPauseChange);
    el('runLimitsSave').addEventListener('click', onSave);
    el('runLimitsReapply').addEventListener('click', onReapply);
    el('runLimitsKeep').addEventListener('click', clearStale);
    var period = el('runUsagePeriod');
    period.options = view.PERIODS;
    period.value = _period;
    period.addEventListener('lex-change', function (event) {
      var next = event.detail && event.detail.value;
      if (!next || next === _period) return;
      _period = String(next);
      loadUsage();
    });
    loadLimits();
    customElements.whenDefined('lex-table').then(function () {
      el('runUsageByMatter').addEventListener('row-click', onMatterRow);
      loadUsage();
    });
  }

  init();

})();

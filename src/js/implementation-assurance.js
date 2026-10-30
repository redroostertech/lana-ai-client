(function () {
  'use strict';
  var sequence = 0;
  function init() {
    var root = document.getElementById('assurancePage');
    if (!root || root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    var generation = ++sequence;
    var params = Lex.Nav.getParams();
    var matterId = params.get('matter_id');
    var authenticatedUser = (Lex.state && Lex.state.user) || window.api.user;
    var store = null;
    try { store = ImplementationAssuranceClient.scopedDecisionStore(window.sessionStorage, window.api.baseUrl, authenticatedUser, matterId); } catch (error) { /* Read-only if session persistence is unavailable. */ }
    var session = ImplementationAssuranceClient.createReviewSession(window.api, matterId, null, store);
    var assets = [];
    var targets = [];
    var assetCursor = null;
    var targetCursor = null;
    var available = false;
    var loading = false;
    var selected = '';
    var esc = Lex.Utils.escapeHtml;
    function el(id) { return root.querySelector('#' + id); }
    function alive() { return generation === sequence && root.isConnected; }
    function notice(message) { el('assuranceNotice').textContent = message; }
    function setDisabled(id, value) { el(id).disabled = Boolean(value); }
    function controls() {
      var waiting = loading || session.busy();
      var pending = session.pendingDecision();
      setDisabled('assuranceRefresh', waiting || pending);
      setDisabled('assuranceMore', waiting || pending);
      setDisabled('assuranceTarget', waiting || pending || !available || !targets.length);
      setDisabled('assuranceAssess', waiting || pending || !available || !selected);
      setDisabled('assuranceDecision', waiting || pending);
      setDisabled('assuranceRationale', waiting || pending);
      setDisabled('assuranceSave', waiting || !available || !session.canPersist() || (!session.assessment() && !pending));
      el('assuranceSave').label = pending ? 'Retry the same decision' : 'Record professional decision';
    }
    function assetName(id) {
      var asset = assets.find(function (item) { return item.id === id; });
      return asset ? asset.description : 'Asset outside the loaded inventory';
    }
    function reference(label, ref) {
      return '<dt>' + esc(label) + '</dt><dd class="assurance-references">' + esc(ref.id) + ' · version ' + esc(String(ref.version)) + '<br>SHA-256 ' + esc(ref.sha256) + '</dd>';
    }
    function expectedValue(value) {
      if (!value) return 'Unavailable';
      if (value.kind === 'reference') return value.value.kind + ': ' + value.value.id;
      if (value.kind === 'reference_set') return value.value.map(function (item) { return item.kind + ': ' + item.id; }).join('; ');
      if (value.kind === 'allocations') return value.value.map(function (item) { return item.beneficiary.kind + ': ' + item.beneficiary.id + ' — ' + (item.share_basis_points / 100) + '%'; }).join('; ');
      return typeof value.value === 'object' ? 'See accepted plan for this value' : String(value.value);
    }
    function renderTargets() {
      var select = el('assuranceTarget');
      select.options = targets.map(function (entry) { return { value: entry.record.id,
        label: assetName(entry.record.subject.id) + ' · ' + entry.record.predicate.split('.').join(' ') + ' · v' + entry.record.version }; });
      select.value = selected;
    }
    function showTarget() {
      var target = targets.find(function (entry) { return entry.record.id === selected; });
      el('assuranceAssessment').hidden = true;
      el('assuranceDecisionForm').hidden = true;
      el('assuranceTargetDetails').textContent = target ? 'Expected value: ' + expectedValue(target.record.value) : '';
      controls();
    }
    function renderInventory() {
      el('assuranceAssets').innerHTML = assets.length ? assets.map(function (item) {
        return '<li><strong>' + esc(item.description) + '</strong><span class="assurance-muted">' + esc(item.asset_classification.split('_').join(' ')) +
          (item.account_number_mask ? ' · ' + esc(item.account_number_mask) : '') + '</span><span>' +
          (item.asset_value === null || item.asset_value === undefined ? 'Value not reported' : esc(item.currency || '') + ' ' + esc(String(item.asset_value))) + '</span></li>';
      }).join('') : '<li class="assurance-muted">No reported assets in the loaded inventory.</li>';
      el('assuranceMore').hidden = !assetCursor && !targetCursor;
      renderTargets();
    }
    async function load(append) {
      if (loading || session.pendingDecision()) return;
      loading = true; available = false; controls();
      try {
        el('assuranceAssessment').hidden = true; el('assuranceDecisionForm').hidden = true;
        var pages = await session.load(append ? assetCursor : null, append ? targetCursor : null,
          append ? { assets: Boolean(assetCursor), targets: Boolean(targetCursor) } : undefined);
        if (!alive()) return;
        // Merge by record identity so paging never duplicates displayed rows.
        assets = Array.from(new Map((append ? assets : []).concat(pages.assets.assets || []).map(function (item) { return [item.id, item]; })).values());
        targets = Array.from(new Map((append ? targets : []).concat(pages.targets.items || []).map(function (item) { return [item.record.id, item]; })).values());
        assetCursor = pages.assets.next_cursor; targetCursor = pages.targets.nextCursor;
        available = true;
        renderInventory();
        notice(targets.length ? 'Select a target and assess its current evidence. A system finding is not a professional decision.'
          : 'No accepted targets are available. An authorized professional must set up and approve the plan and its targets before this review can begin.');
      } catch (error) { if (alive()) notice(ImplementationAssuranceClient.errorMessage(error)); }
      finally { loading = false; if (alive()) controls(); }
    }
    function renderAssessment(response) {
      var finding = response.record.evaluation;
      var labels = { match: 'Evidence supports a match', mismatch: 'Evidence supports a difference', conflict: 'Evidence conflicts', unknown: 'Not established by the available evidence' };
      var target = el('assuranceAssessment');
      target.hidden = false;
      target.innerHTML = '<div class="assurance-status" data-outcome="' + esc(finding.outcome) + '"><strong>' + esc(labels[finding.outcome] || 'Assessment unavailable') + '</strong><p>' + esc(finding.reason.split('_').join(' ')) + '</p>' + (finding.inventory && finding.inventory.reason ? '<p>' + esc(finding.inventory.reason) + '</p>' : '') + '</div>' +
        '<dl class="assurance-facts">' + reference('Accepted plan', finding.plan) + reference('Protocol', finding.protocol) + reference('Target', finding.target) +
        '<dt>Observations checked</dt><dd>' + esc(String(finding.observations.length)) + '</dd><dt>Assessed at</dt><dd>' + esc(finding.as_of) + '</dd></dl>';
      el('assuranceDecisionForm').hidden = false;
      var supported = finding.outcome === 'match';
      el('assuranceDecision').options = [
        { value: supported ? 'accept_conclusion' : 'accept_exception', label: supported ? 'Accept this finding' : 'Accept an exception (does not establish a match)' },
        { value: 'reject', label: 'Reject this finding' }
      ];
      el('assuranceDecision').value = '';
      el('assuranceRationale').value = '';
    }
    async function assess() {
      if (!selected || session.busy()) return;
      loading = true; controls();
      el('assuranceAssessment').hidden = true; el('assuranceDecisionForm').hidden = true;
      notice('Checking the current accepted target and available evidence…');
      try {
        var response = await session.assess(selected);
        if (!alive()) return;
        renderAssessment(response);
        notice('Assessment ready. Review the bound plan and source records before recording your decision.');
      } catch (error) { if (alive()) notice(ImplementationAssuranceClient.errorMessage(error)); }
      finally { loading = false; if (alive()) controls(); }
    }
    async function save() {
      var pending = session.pendingDecision();
      var decision = pending ? pending.decision : el('assuranceDecision').value;
      var rationale = pending ? pending.rationale : el('assuranceRationale').value;
      if (!decision) { notice('Choose your decision before recording it.'); return; }
      loading = true; controls();
      try {
        var result = await session.decide(decision, rationale);
        if (!alive()) return;
        var labels = { accept_conclusion: 'Finding accepted', accept_exception: 'Exception accepted', reject: 'Finding rejected' };
        notice((labels[result.record.decision] || 'Decision recorded') + '. ' + (result.replayed ? 'Recovered the previously saved decision.' : 'Saved by the server.') + ' Reference: ' + result.record.id);
        el('assuranceDecisionForm').hidden = true;
      } catch (error) {
        if (!alive()) return;
        notice(ImplementationAssuranceClient.errorMessage(error) + (session.pendingDecision() ? ' The outcome is not confirmed. Retry the same decision to recover its recorded result; do not submit a different one. This request is retained for refresh recovery in this tab.' : ''));
        if (!session.assessment() && !session.pendingDecision()) { el('assuranceDecisionForm').hidden = true; el('assuranceAssessment').hidden = true; }
      } finally { loading = false; if (alive()) controls(); }
    }
    root.addEventListener('click', function (event) {
      var button = event.target.closest('lex-btn');
      if (!button || button.disabled) return;
      if ((button.id === 'assuranceBack' || button.id === 'assuranceDocuments') && session.pendingDecision()) { notice('Recover the pending decision before leaving this review.'); return; }
      if (button.id === 'assuranceBack') Lex.Nav.go('workspace-details.html', { params: { id: matterId } });
      if (button.id === 'assuranceDocuments') Lex.Nav.go('workspace-details.html', { params: { id: matterId, tab: 'documents' } });
      if (button.id === 'assuranceRefresh') load(false);
      if (button.id === 'assuranceMore') load(true);
      if (button.id === 'assuranceAssess') assess();
      if (button.id === 'assuranceSave') save();
    });
    root.addEventListener('lex-change', function (event) {
      if (event.target.id === 'assuranceTarget') { selected = event.detail.value; showTarget(); }
    });
    el('assuranceMatter').textContent = params.get('matter_name') || 'Current matter';
    if (!matterId) { notice('Open implementation assurance from a matter to review its records.'); controls(); return; }
    var recovery = session.pendingDecision();
    if (recovery) {
      selected = recovery.targetId; available = true;
      el('assuranceDecisionForm').hidden = false;
      el('assuranceDecision').options = [{ value: recovery.decision, label: 'Recover the previously submitted decision' }];
      el('assuranceDecision').value = recovery.decision;
      el('assuranceRationale').value = recovery.rationale;
      notice('A prior decision has an unconfirmed delivery outcome. Retry the same request to recover its result before continuing this review.');
      controls();
    } else if (session.recoveryError()) { notice(session.recoveryError()); controls(); }
    else load(false);
  }
  if (window.LexRouter) LexRouter.registerPageInit('implementation-assurance.html', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

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
    var commands = AssuranceOnboardingClient.createCommandSession(window.api, matterId, store);
    var session = ImplementationAssuranceClient.createReviewSession(window.api, matterId, null, store, commands);
    var onboarding;
    var assets = [];
    var targets = [];
    var available = false;
    var loading = false;
    var selected = '';
    var esc = Lex.Utils.escapeHtml;
    function el(id) { return root.querySelector('#' + id); }
    function alive() { return generation === sequence && root.isConnected; }
    function notice(message) { el('assuranceNotice').textContent = message; }
    function setDisabled(id, value) { el(id).disabled = Boolean(value); }
    function controls() {
      var waiting = loading || session.busy() || (onboarding && onboarding.busy());
      var pending = commands.pending();
      setDisabled('assuranceRefresh', waiting || pending);
      setDisabled('assuranceMore', waiting || pending);
      setDisabled('assuranceTarget', waiting || pending || !available || !targets.length);
      setDisabled('assuranceAssess', waiting || pending || !available || !selected || !onboarding || !onboarding.actionAllowed('read'));
      setDisabled('assuranceDecision', waiting || pending);
      setDisabled('assuranceRationale', waiting || pending);
      setDisabled('assuranceSave', waiting || pending || !available || !session.canPersist() || !session.assessment() || !onboarding || !onboarding.actionAllowed('review'));
      el('assuranceSave').label = 'Record professional decision';
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
      function name(reference) { var contact = onboarding && onboarding.data().contacts.find(function (entry) { return entry.id === reference.id; }); return contact ? contact.label : 'Contact outside loaded lookup'; }
      if (value.kind === 'reference') return name(value.value);
      if (value.kind === 'reference_set') return value.value.map(name).join('; ');
      if (value.kind === 'allocations') return value.value.map(function (item) { return name(item.beneficiary) + ' — ' + (item.share_basis_points / 100) + '%'; }).join('; ');
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
    async function load(append) {
      if (loading || commands.pending() || !onboarding) return;
      loading = true; available = false; controls();
      el('assuranceAssessment').hidden = true; el('assuranceDecisionForm').hidden = true;
      try { await onboarding.refresh(append); }
      catch (error) { if (alive()) notice(ImplementationAssuranceClient.errorMessage(error)); }
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
      if ((button.id === 'assuranceBack' || button.id === 'assuranceDocuments') && commands.pending()) { notice('Recover the pending decision before leaving this review.'); return; }
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
    onboarding = AssuranceOnboarding.mount(root, { api: window.api, matterId: matterId, commands: commands,
      notice: notice, onState: controls, onRecords: function (records) {
        assets = records.assets; available = true; session.invalidateAssessment();
        el('assuranceAssessment').hidden = true; el('assuranceDecisionForm').hidden = true;
        renderTargetsFromRecords(records.targets); controls();
      } });
    function renderTargetsFromRecords(records) { targets = records; renderTargets(); }
    if (!matterId) { notice('Open implementation assurance from a matter to review its records.'); controls(); return; }
    if (commands.pending()) { notice('Recover the previously submitted change before continuing.'); onboarding.controls(); }
    else if (commands.recoveryError()) { notice(commands.recoveryError()); controls(); }
    else load(false);
  }
  if (window.LexRouter) LexRouter.registerPageInit('implementation-assurance.html', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

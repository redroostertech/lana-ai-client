/* Matter onboarding presentation. The application service owns every saved transition. */
(function (global) {
  'use strict';
  function mount(root, options) {
    var api = options.api;
    var commands = options.commands;
    var client = AssuranceOnboardingClient.createOnboardingClient(api, options.matterId);
    var base = '/api/v1/implementation-assurance/matters/' + encodeURIComponent(options.matterId);
    var data = { assets: [], plans: [], targets: [], observations: [], closeouts: [], contacts: [], releases: [], rulebooks: [] };
    var cursors = {};
    var status = null;
    var loading = false;
    var currentStep = 'inventory';
    var targetValue;
    var observedValue;
    var evidenceEditor;
    var closeout = null;
    var closeoutRequest = 0;
    var starter = null;
    var starterRequest = 0;
    var Rulebook = AssuranceRulebookView;
    var esc = Lex.Utils.escapeHtml;
    var operationLabels = { createAsset: 'reported asset', updateAsset: 'asset changes', savePlan: 'plan acceptance', saveTarget: 'target acceptance', recordObservation: 'observation pending review', reviewObservation: 'professional evidence review', decide: 'professional decision', prepareCloseout: 'closeout of recorded requirements', acceptCloseout: 'closeout acceptance', adoptRulebook: 'firm rulebook adoption', publishRulebook: 'firm rulebook publication' };
    var decisionLabels = { accept_conclusion: 'Finding accepted', accept_exception: 'Exception accepted', reject: 'Finding rejected' };
    var steps = [
      ['inventory', '1 · Inventory'], ['plan', '2 · Plan'], ['rulebook', '3 · Rulebook'], ['targets', '4 · Targets'],
      ['observations', '5 · Evidence'], ['evidence-review', '6 · Evidence review'], ['review', '7 · Decisions'], ['closeout', '8 · Closeout']
    ];
    function el(id) { return root.querySelector('#' + id); }
    function alive() { return root.isConnected; }
    function notify(message) { if (alive()) options.notice(message); }
    function item(items, id) { return items.find(function (entry) { return (entry.record ? entry.record.id : entry.id) === id; }); }
    function record(items, id) { var entry = item(items, id); return entry && entry.record; }
    function ref(items, id) { var entry = item(items, id); if (!entry || !entry.reference) throw new Error('Choose an available saved version. Refresh if the record has changed.'); return Object.assign({}, entry.reference); }
    function labelAsset(id) { var asset = item(data.assets, id); return asset ? asset.description : 'Asset outside the loaded inventory'; }
    function labelTarget(entry) { var rule = Rulebook.ruleForTarget(data.rulebooks, entry.record); return labelAsset(entry.record.subject.id) + ' · ' + (rule ? Rulebook.ruleLabel(rule) : entry.record.predicate.split('_').join(' ')) + ' · v' + entry.record.version; }
    function labelObservation(entry) { return labelAsset(entry.record.subject.id) + ' · ' + entry.record.predicate + ' · v' + entry.record.version + (entry.record.review_ref ? ' · reviewed' : ' · pending review'); }
    function select(id, values, initial) {
      var control = el(id); var previous = initial === undefined ? control.value : initial;
      control.options = values;
      control.value = values.some(function (value) { return value.value === previous; }) ? previous : '';
    }
    function plansOptions() { return data.plans.map(function (entry) { return { value: entry.record.id, label: 'Accepted plan · version ' + entry.record.version + ' · ' + entry.record.releases.length + ' document(s)' }; }); }
    function actionAllowed(action) { return Boolean(status && status.actions && status.actions[action]); }
    function controls() {
      if (!alive()) return;
      var pending = commands.pending();
      var disabled = loading || commands.busy() || Boolean(pending) || !commands.canPersist();
      root.querySelectorAll('[data-assurance-permission]').forEach(function (button) { button.disabled = disabled || !actionAllowed(button.dataset.assurancePermission); });
      el('assuranceRecover').disabled = commands.busy() || !pending || !commands.canPersist();
      el('assuranceRecovery').hidden = !pending && !commands.recoveryError();
      el('assuranceRecoveryText').textContent = commands.recoveryError() || (pending ? 'A prior ' + (operationLabels[pending.operation] || 'change') + ' request has an unconfirmed delivery outcome. Recover that exact change before submitting another.' : '');
      el('assuranceCloseoutAccept').disabled = disabled || !actionAllowed('acceptCloseout') || !closeout || closeout.current !== true || closeout.accepted === true;
      el('assuranceCloseoutDownload').disabled = loading || commands.busy() || !closeout;
      var adopt = Rulebook.adoptState({ mode: rulebookMode(), pending: pending, busy: loading || commands.busy(), canPersist: commands.canPersist(), jurisdiction: el('assuranceRulebookJurisdiction').value, starter: starter });
      el('assuranceRulebookAdopt').disabled = disabled || !adopt.enabled;
      el('assuranceRulebookJurisdiction').disabled = loading || Boolean(adoptedRulebook());
      if (options.onState) options.onState();
    }
    function showStep(step) {
      if (!steps.some(function (entry) { return entry[0] === step; })) return;
      currentStep = step; el('assuranceStep').value = step;
      root.querySelectorAll('[data-assurance-step]').forEach(function (panel) { panel.hidden = panel.dataset.assuranceStep !== step; });
      var index = steps.findIndex(function (entry) { return entry[0] === step; });
      el('assurancePrevious').disabled = index === 0; el('assuranceNext').disabled = index === steps.length - 1;
      el('assuranceNext').label = index < steps.length - 1 ? 'Continue to ' + steps[index + 1][1].split(' · ')[1] : 'End of recorded workflow';
    }
    function openSource(release, locator) {
      if (commands.pending()) { notify('Recover the pending change before opening another page.'); return; }
      if (!release || !release.releasedDocumentId) { notify('This retained source is not in the current authorized lookup. Refresh the records.'); return; }
      Lex.Nav.go('file-viewer.html', { params: { id: release.releasedDocumentId, matter_id: options.matterId, page: locator && locator.page || '', quote: locator && locator.quote || '' } });
    }
    function sourceList(host, evidence) {
      host.replaceChildren();
      evidence.forEach(function (entry) {
        var reference = entry.artifact || entry;
        var release = item(data.releases, reference.id);
        var row = document.createElement('div'); row.className = 'assurance-record';
        var detail = document.createElement('p');
        detail.textContent = (release ? release.label : 'Retained source outside loaded lookup') + ' · version ' + reference.version + (entry.evidence_class ? ' · ' + entry.evidence_class.split('_').join(' ') + ' · ' + entry.coverage : '');
        row.appendChild(detail);
        if (entry.locator && entry.locator.quote) { var quote = document.createElement('blockquote'); quote.textContent = entry.locator.quote; row.appendChild(quote); }
        var open = document.createElement('lex-btn'); open.variant = 'secondary'; open.label = 'Open exact source' + (entry.locator && entry.locator.page ? ' · page ' + entry.locator.page : ''); open.disabled = !release;
        open.addEventListener('click', function () { openSource(release, entry.locator); }); row.appendChild(open); host.appendChild(row);
      });
    }
    function renderReadiness() {
      var checks = status && status.readiness && status.readiness.checks || [];
      el('assuranceReadiness').innerHTML = '<ul class="assurance-readiness">' + checks.map(function (check) { return '<li><strong>' + esc(check.status) + '</strong> · ' + esc(check.detail || check.code) + '</li>'; }).join('') + '</ul>';
      if (!data.rulebooks.length) el('assuranceReadiness').appendChild(document.createTextNode(' No effective adopted rulebook is available in the loaded choices. A firm administrator must adopt a rulebook in the Rulebook section before targets can be accepted.'));
      if (!actionAllowed('review')) el('assuranceReadiness').appendChild(document.createTextNode(' Professional acceptance requires an explicit firm grant. Contact your administrator if this is your role.'));
    }
    function renderAssets() {
      el('assuranceAssets').innerHTML = data.assets.length ? data.assets.map(function (asset) { return '<li><strong>' + esc(asset.description) + '</strong><span class="assurance-muted">' + esc(asset.asset_classification.split('_').join(' ')) + (asset.account_number_mask ? ' · ' + esc(asset.account_number_mask) : '') + '</span><span>' + (asset.asset_value == null ? 'Value not reported' : esc(asset.currency) + ' ' + esc(asset.asset_value)) + '</span></li>'; }).join('') : '<li>No reported assets in this inventory page.</li>';
      select('assuranceAssetEdit', [{ value: 'new', label: 'Add a new asset' }].concat(data.assets.map(function (asset) { return { value: asset.id, label: asset.description }; })));
      select('assuranceTargetAsset', data.assets.map(function (asset) { return { value: asset.id, label: asset.description }; }));
    }
    function renderPlans() {
      el('assurancePlans').innerHTML = data.plans.length ? data.plans.map(function (entry) { return '<article class="assurance-record"><strong>Accepted plan · version ' + esc(String(entry.record.version)) + '</strong><p>' + esc(String(entry.record.releases.length)) + ' retained document(s)</p><p class="assurance-references">' + esc(entry.record.id) + '</p></article>'; }).join('') : '<p>No accepted plan has been recorded.</p>';
      var choices = plansOptions(); select('assurancePlanEdit', [{ value: 'new', label: 'Accept a new plan' }].concat(choices)); select('assuranceTargetPlan', choices); select('assuranceCloseoutPlan', choices);
      el('assurancePlanReleases').options = data.releases.map(function (release) { return { value: release.id, label: release.label + ' · version ' + release.reference.version }; });
      sourceList(el('assurancePlanSources'), (el('assurancePlanReleases').value || []).map(function (id) { return ref(data.releases, id); }));
    }
    function adoptedRulebook() { return data.rulebooks[0] || null; }
    function rulebookMode() { return Rulebook.viewMode(adoptedRulebook(), status && status.actions); }
    function renderRulebook() {
      var adopted = adoptedRulebook(); var mode = rulebookMode(); var shown = adopted || starter;
      el('assuranceRulebookAccess').textContent = Rulebook.accessExplanation(mode);
      el('assuranceRulebookFlags').textContent = Rulebook.reviewFlagNotice;
      el('assuranceRulebookForm').hidden = mode !== 'adopt';
      el('assuranceRulebookSummary').textContent = adopted ? 'Adopted: ' + adopted.label + (adopted.effectiveFrom ? ' · effective ' + adopted.effectiveFrom : '') + ' · ' + Rulebook.summary(adopted)
        : starter ? 'Starter preview, not adopted: ' + starter.title + ' · ' + Rulebook.jurisdictionLabel(starter.jurisdiction) + ' · version ' + starter.version + ' · ' + Rulebook.summary(starter)
          : 'No firm rulebook is adopted. Choose a jurisdiction to preview its starter rulebook.';
      if (shown) Rulebook.renderRules(el('assuranceRulebookRules'), shown); else el('assuranceRulebookRules').replaceChildren();
    }
    async function previewStarter() {
      var jurisdiction = el('assuranceRulebookJurisdiction').value; var request = ++starterRequest;
      starter = null; el('assuranceRulebookConfirm').checked = false; renderRulebook(); controls();
      if (!Rulebook.isJurisdiction(jurisdiction)) return;
      try {
        var result = Rulebook.unwrapStarter(await client.starter(jurisdiction), jurisdiction);
        if (!alive() || request !== starterRequest) return;
        starter = result; renderRulebook();
      } catch (error) { if (request === starterRequest) notify(error.status ? ImplementationAssuranceClient.errorMessage(error) : error.message); }
      finally { if (alive()) controls(); }
    }
    function targetRulebook() { return item(data.rulebooks, el('assuranceTargetRulebook').value); }
    // Rules are chosen by rule id: several rulebook rules can check the same predicate.
    function ruleKey(rule) { return rule.id || rule.predicate; }
    // An observation of a text target chooses from the same rule's allowed values.
    function targetAllowedValues(target) {
      var id = target.rule_id || target.ruleId; var match = null;
      (data.rulebooks || []).forEach(function (rulebook) { (rulebook.rules || []).forEach(function (rule) { if (!match && id && rule.id === id) match = rule; }); });
      return match && match.allowedValues || [];
    }
    function targetRule() { var rulebook = targetRulebook(); return rulebook && rulebook.rules.find(function (rule) { return ruleKey(rule) === el('assuranceTargetRule').value; }); }
    function renderRule(initialValue) {
      var rule = targetRule();
      el('assuranceTargetRuleDetails').textContent = rule ? 'Rule ' + Rulebook.ruleLabel(rule) + ' · evidence classes: ' + rule.evidenceClasses.join(', ').split('_').join(' ') + (rule.requireReviewedObservation ? '. Professional evidence review is required.' : '.') : 'Choose a rulebook and one of its rules.';
      targetValue = rule ? AssuranceValueControls.createValueEditor(el('assuranceTargetValue'), { kind: rule.valueKind, allowedValues: rule.allowedValues, contacts: data.contacts, value: initialValue }) : null;
      if (!rule) el('assuranceTargetValue').replaceChildren();
    }
    function renderRulebookRules(initialValue) {
      var rulebook = targetRulebook(); select('assuranceTargetRule', rulebook ? rulebook.rules.map(function (rule) { return { value: ruleKey(rule), label: Rulebook.ruleLabel(rule) }; }) : []); renderRule(initialValue);
    }
    function renderTargets() {
      el('assuranceTargetsList').innerHTML = data.targets.length ? data.targets.map(function (entry) { return '<article class="assurance-record"><strong>' + esc(labelTarget(entry)) + '</strong><p>Expected: ' + esc(describeValue(entry.record.value)) + '</p></article>'; }).join('') : '<p>No implementation targets have been accepted.</p>';
      var choices = data.targets.map(function (entry) { return { value: entry.record.id, label: labelTarget(entry) }; });
      select('assuranceTargetEdit', [{ value: 'new', label: 'Create a new target' }].concat(choices));
      select('assuranceObservationTarget', choices);
      select('assuranceTargetRulebook', data.rulebooks.map(function (rulebook) { return { value: rulebook.id, label: rulebook.label + ' · effective ' + rulebook.effectiveFrom }; }));
      renderRulebookRules();
    }
    function describeValue(value) {
      function name(reference) { var contact = item(data.contacts, reference.id); return contact ? contact.label : 'Contact outside loaded lookup'; }
      if (value.kind === 'reference') return name(value.value);
      if (value.kind === 'reference_set') return value.value.map(name).join(', ');
      if (value.kind === 'allocations') return value.value.map(function (entry) { return name(entry.beneficiary) + ' ' + (entry.share_basis_points / 100).toFixed(2) + '%'; }).join('; ');
      return 'Unsupported value; consult the accepted record.';
    }
    function observationsFor(target) { return data.observations.filter(function (entry) { return target && entry.record.subject.id === target.subject.id && entry.record.predicate === target.predicate; }); }
    function renderObservationEditor() {
      var target = record(data.targets, el('assuranceObservationTarget').value);
      var candidates = observationsFor(target);
      select('assuranceObservationEdit', [{ value: 'new', label: 'Record a new observation' }].concat(candidates.map(function (entry) { return { value: entry.record.id, label: labelObservation(entry) }; })));
      var previous = record(candidates, el('assuranceObservationEdit').value);
      select('assuranceObservationSupersedes', candidates.filter(function (entry) { return !previous || entry.record.id !== previous.id; }).map(function (entry) { return { value: entry.record.id, label: labelObservation(entry) }; }));
      el('assuranceObservationSupersedes').value = previous ? previous.supersedes.map(function (entry) { return entry.id; }) : [];
      el('assuranceObservationFrom').value = previous ? AssuranceEvidenceControls.localInput(previous.valid_from) : '';
      el('assuranceObservationUntil').value = previous ? AssuranceEvidenceControls.localInput(previous.valid_until) : '';
      observedValue = target ? AssuranceValueControls.createValueEditor(el('assuranceObservationValue'), { kind: target.value.kind, allowedValues: targetAllowedValues(target), contacts: data.contacts, value: previous && previous.value, observed: true }) : null;
      if (!target) el('assuranceObservationValue').textContent = 'Choose an accepted target before recording its evidence.';
      evidenceEditor = AssuranceEvidenceControls.createEvidenceEditor(el('assuranceObservationEvidence'), { releases: data.releases, evidenceClasses: status && status.supported && status.supported.evidenceClasses || [], value: previous && previous.evidence, openSource: openSource });
    }
    function renderObservationReview() {
      el('assuranceObservationReviewConfirm').checked = false;
      var observation = record(data.observations, el('assuranceObservationReview').value);
      var host = el('assuranceObservationDetails'); host.replaceChildren();
      if (!observation) return;
      var summary = document.createElement('p'); summary.textContent = describeValue(observation.value) + ' · version ' + observation.version + (observation.review_ref ? ' · professionally reviewed' : ' · pending professional review'); host.appendChild(summary);
      var dates = document.createElement('p'); dates.className = 'assurance-muted'; dates.textContent = 'Valid from ' + observation.valid_from + (observation.valid_until ? ' until ' + observation.valid_until : ' · no end date recorded'); host.appendChild(dates);
      var sources = document.createElement('div'); sources.className = 'assurance-source-list'; sourceList(sources, observation.evidence); host.appendChild(sources);
    }
    function renderObservations() {
      select('assuranceObservationReview', data.observations.map(function (entry) { return { value: entry.record.id, label: labelObservation(entry) }; }));
      renderObservationEditor(); renderObservationReview();
    }
    async function renderCloseout() {
      el('assuranceCloseoutConfirm').checked = false;
      var id = el('assuranceCloseoutSelect').value; var request = ++closeoutRequest;
      closeout = null; el('assuranceCloseoutDetails').replaceChildren(); controls();
      if (!id) return;
      try {
        var result = await client.closeout(id);
        if (!alive() || request !== closeoutRequest) return;
        closeout = result;
        var manifest = result.record;
        el('assuranceCloseoutDetails').innerHTML = '<div class="assurance-status"><strong>' + (result.current ? 'Current pinned record' : 'Records changed since preparation') + '</strong><p>' + (result.accepted ? 'Professionally accepted' : result.acceptanceReference ? 'Previously accepted; requires renewed review' : 'Not professionally accepted') + '</p><p>Coverage: ' + esc(manifest.coverage.complete ? 'Complete' : manifest.coverage.reason || 'Incomplete') + '</p></div><ul class="assurance-list">' + manifest.targets.map(function (entry) { var target = item(data.targets, entry.target_ref.id); return '<li><strong>' + esc(target && target.reference.version === entry.target_ref.version && target.reference.sha256 === entry.target_ref.sha256 ? labelTarget(target) : 'Recorded target · version ' + entry.target_ref.version) + '</strong><span>' + esc(entry.evaluation.outcome) + '</span><span>' + esc(entry.evaluation.reason.split('_').join(' ')) + '</span><span>Decision: ' + esc(decisionLabels[entry.decision] || 'Not recorded') + '</span></li>'; }).join('') + '</ul>';
      } catch (error) { notify(ImplementationAssuranceClient.errorMessage(error)); }
      finally { if (alive()) controls(); }
    }
    function render() {
      renderReadiness(); renderAssets(); renderPlans(); renderRulebook(); renderTargets(); renderObservations();
      select('assuranceCloseoutSelect', data.closeouts.map(function (entry) { return { value: entry.record.id, label: 'Closeout · ' + entry.record.recorded_at }; }));
      el('assuranceMore').hidden = !Object.values(cursors).some(Boolean);
      showStep(currentStep); controls();
      if (options.onRecords) options.onRecords(data);
    }
    var loaders = {
      contacts: function (cursor) { return client.lookup('contacts', cursor); }, releases: function (cursor) { return client.lookup('releases', cursor); }, rulebooks: function (cursor) { return client.lookup('rulebooks', cursor); },
      plans: function (cursor) { return client.records('plan', cursor); }, targets: function (cursor) { return client.records('target', cursor); }, observations: function (cursor) { return client.records('observation', cursor); }, closeouts: function (cursor) { return client.records('closeout', cursor); },
      assets: function (cursor) { return api.request('GET', base + '/assets?limit=50' + (cursor ? '&after_id=' + encodeURIComponent(cursor) : ''), null).then(function (page) { return { items: page.assets, nextCursor: page.next_cursor, complete: !page.next_cursor }; }); }
    };
    async function refresh(append) {
      if (loading || commands.pending()) { controls(); return data; }
      loading = true; controls();
      try {
        var nextStatus = await client.status();
        if (!alive()) return data;
        if (!nextStatus.scope || nextStatus.scope.matter_id !== options.matterId) throw new Error('The server returned onboarding for a different matter.');
        status = nextStatus;
        var keys = Object.keys(loaders).filter(function (key) { return !append || cursors[key]; });
        var pages = await Promise.all(keys.map(function (key) { return loaders[key](append ? cursors[key] : null); }));
        if (!alive()) return data;
        keys.forEach(function (key, index) {
          var page = pages[index];
          data[key] = Array.from(new Map((append ? data[key] : []).concat(page.items || []).map(function (entry) { return [entry.record ? entry.record.id : entry.id, entry]; })).values());
          cursors[key] = page.nextCursor || null;
        });
        closeout = null; el('assuranceCloseoutDetails').replaceChildren(); render();
        if (el('assuranceCloseoutSelect').value) await renderCloseout();
        notify('Records loaded. Choose a section to continue; only server-confirmed actions change this matter.');
      } catch (error) { status = null; notify(ImplementationAssuranceClient.errorMessage(error)); throw error; }
      finally { loading = false; controls(); }
      return data;
    }
    async function mutate(operation, payload) {
      if (!commands.canPersist()) throw new Error('Scoped recovery is unavailable. Changes are read-only.');
      var promise = commands.execute(operation, payload); controls();
      try {
        var response = await promise;
        if (!alive()) return response;
        try { await refresh(false); }
        catch (error) { notify('The change was saved. Reference: ' + response.record.id + '. Records could not be refreshed: ' + ImplementationAssuranceClient.errorMessage(error)); return response; }
        notify((response.replayed ? 'Recovered saved ' : 'Saved ') + (operationLabels[operation] || 'change') + '. Reference: ' + response.record.id);
        if (operation === 'prepareCloseout') { el('assuranceCloseoutSelect').value = response.record.id; await renderCloseout(); }
        return response;
      } finally { controls(); }
    }
    function identity(items, selected) { var previous = record(items, selected); return previous ? { id: previous.id, expectedVersion: previous.version } : { expectedVersion: 0 }; }
    function confirmed(id) { if (!el(id).checked) throw new Error('Confirm your professional review before recording this acceptance.'); }
    function selectedRefs(id, items) { return (el(id).value || []).map(function (value) { return ref(items, value); }); }
    function editAsset() {
      var asset = item(data.assets, el('assuranceAssetEdit').value);
      el('assuranceAssetClass').value = asset ? asset.asset_classification : '';
      el('assuranceAssetDescription').value = asset ? asset.description : '';
      el('assuranceAssetLastFour').value = ''; // A mask is never submitted as a full account value.
      el('assuranceAssetLastFour').label = asset ? 'New account last four (leave blank to keep existing)' : 'Account last four (optional)';
      el('assuranceAssetValue').value = asset && asset.asset_value != null ? asset.asset_value : '';
      el('assuranceAssetCurrency').value = asset ? asset.currency : 'USD';
    }
    function editPlan() {
      var plan = record(data.plans, el('assurancePlanEdit').value);
      el('assurancePlanReleases').value = plan ? plan.releases.map(function (release) { return release.id; }) : [];
      el('assurancePlanConfirm').checked = false;
      sourceList(el('assurancePlanSources'), plan ? plan.releases : []);
    }
    function editTarget() {
      var target = record(data.targets, el('assuranceTargetEdit').value);
      if (!target) { el('assuranceTargetConfirm').checked = false; renderRule(); return; }
      el('assuranceTargetPlan').value = target.plan_ref.id; el('assuranceTargetRulebook').value = target.rulebook_ref.id;
      renderRulebookRules(); el('assuranceTargetRule').value = target.rule_id || target.ruleId || target.predicate; el('assuranceTargetAsset').value = target.subject.id;
      el('assuranceTargetConfirm').checked = false; renderRule(target.value);
    }
    async function submit(formId) {
      if (formId === 'assuranceAssetForm') {
        var asset = item(data.assets, el('assuranceAssetEdit').value);
        var amount = el('assuranceAssetValue').value.trim();
        if (amount && !amount.includes('.')) amount += '.00';
        else if (amount && amount.split('.').length === 2 && amount.split('.')[1].length === 1) amount += '0';
        var fields = { asset_classification: el('assuranceAssetClass').value, description: el('assuranceAssetDescription').value.trim(), asset_value: amount || null, currency: el('assuranceAssetCurrency').value.trim().toUpperCase() };
        var lastFour = el('assuranceAssetLastFour').value.trim();
        if (!asset || lastFour) fields.account_last_four = lastFour || null;
        return mutate(asset ? 'updateAsset' : 'createAsset', asset ? { assetId: asset.id, expected_revision: asset.revision, fields: fields } : fields);
      }
      if (formId === 'assurancePlanForm') {
        confirmed('assurancePlanConfirm');
        return mutate('savePlan', Object.assign(identity(data.plans, el('assurancePlanEdit').value), { releases: selectedRefs('assurancePlanReleases', data.releases), rationale: el('assurancePlanRationale').value.trim() }));
      }
      if (formId === 'assuranceTargetForm') {
        confirmed('assuranceTargetConfirm'); var rule = targetRule();
        if (!rule || !targetValue) throw new Error('Choose a rule from the adopted firm rulebook.');
        return mutate('saveTarget', Object.assign(identity(data.targets, el('assuranceTargetEdit').value), { planRef: ref(data.plans, el('assuranceTargetPlan').value), rulebookRef: ref(data.rulebooks, el('assuranceTargetRulebook').value), subject: { kind: 'matter_asset', id: el('assuranceTargetAsset').value }, ruleId: ruleKey(rule), predicate: rule.predicate, value: targetValue.value(), rationale: el('assuranceTargetRationale').value.trim() }));
      }
      if (formId === 'assuranceObservationForm') {
        var target = record(data.targets, el('assuranceObservationTarget').value);
        if (!target || !observedValue || !evidenceEditor) throw new Error('Choose the accepted target this evidence concerns.');
        return mutate('recordObservation', Object.assign(identity(data.observations, el('assuranceObservationEdit').value), { subject: target.subject, predicate: target.predicate, value: observedValue.value(), evidence: evidenceEditor.value(), validFrom: AssuranceEvidenceControls.instant(el('assuranceObservationFrom').value), validUntil: el('assuranceObservationUntil').value ? AssuranceEvidenceControls.instant(el('assuranceObservationUntil').value) : null, supersedes: selectedRefs('assuranceObservationSupersedes', data.observations) }));
      }
      if (formId === 'assuranceObservationReviewForm') {
        confirmed('assuranceObservationReviewConfirm'); var observation = record(data.observations, el('assuranceObservationReview').value);
        if (!observation) throw new Error('Choose the exact observation to review.');
        return mutate('reviewObservation', { id: observation.id, expectedVersion: observation.version, rationale: el('assuranceObservationReviewRationale').value.trim() });
      }
      if (formId === 'assuranceRulebookForm') {
        confirmed('assuranceRulebookConfirm');
        var command = Rulebook.adoptCommand({ adopted: adoptedRulebook(), jurisdiction: el('assuranceRulebookJurisdiction').value, starter: starter, rationale: el('assuranceRulebookRationale').value });
        return mutate('adoptRulebook', command).then(function (response) { starter = null; el('assuranceRulebookRationale').value = ''; el('assuranceRulebookConfirm').checked = false; renderRulebook(); return response; }, function (error) {
          var message = Rulebook.adoptErrorMessage(error); if (!message) throw error;
          notify(message + (commands.pending() ? ' Recover the same pending change before continuing.' : '')); controls();
        });
      }
      if (formId === 'assuranceCloseoutForm') {
        confirmed('assuranceCloseoutConfirm');
        if (!closeout || closeout.current !== true) throw new Error('Prepare and review a current closeout record before accepting.');
        return mutate('acceptCloseout', { closeoutId: closeout.record.id, expectedBinding: closeout.record.binding, scopeAcknowledgement: 'recorded_plan_targets', rationale: el('assuranceCloseoutRationale').value.trim() });
      }
    }
    function handleError(error) { notify(ImplementationAssuranceClient.errorMessage(error) + (commands.pending() ? ' Recover the same pending change before continuing.' : '')); controls(); }
    root.addEventListener('lex-submit', function (event) {
      if (!event.target.id.startsWith('assurance') || !event.detail.valid) return;
      event.stopPropagation(); submit(event.target.id).catch(handleError);
    });
    root.addEventListener('lex-change', function (event) {
      var id = event.target.id;
      if (event.target.closest('#assuranceTargetForm') && id !== 'assuranceTargetConfirm') el('assuranceTargetConfirm').checked = false;
      if (id === 'assurancePlanReleases') el('assurancePlanConfirm').checked = false;
      if (id === 'assuranceObservationReview') { el('assuranceObservationReviewConfirm').checked = false; el('assuranceObservationReviewRationale').value = ''; }
      if (id === 'assuranceCloseoutSelect') { el('assuranceCloseoutConfirm').checked = false; el('assuranceCloseoutRationale').value = ''; }
      if (id === 'assuranceStep') showStep(event.detail.value);
      if (id === 'assuranceAssetEdit') editAsset();
      if (id === 'assurancePlanEdit') editPlan();
      if (id === 'assurancePlanReleases') { try { sourceList(el('assurancePlanSources'), selectedRefs(id, data.releases)); } catch (error) { handleError(error); } }
      if (id === 'assuranceTargetEdit') editTarget();
      if (id === 'assuranceTargetRulebook') renderRulebookRules();
      if (id === 'assuranceRulebookJurisdiction') previewStarter();
      if (id === 'assuranceTargetRule') renderRule();
      if (id === 'assuranceObservationTarget' || id === 'assuranceObservationEdit') renderObservationEditor();
      if (id === 'assuranceObservationReview') renderObservationReview();
      if (id === 'assuranceCloseoutSelect') renderCloseout();
    });
    root.addEventListener('click', function (event) {
      var button = event.target.closest('lex-btn'); if (!button || button.disabled) return;
      if (button.id === 'assurancePrevious' || button.id === 'assuranceNext') { var index = steps.findIndex(function (entry) { return entry[0] === currentStep; }); showStep(steps[index + (button.id === 'assuranceNext' ? 1 : -1)][0]); }
      if (button.id === 'assuranceRecover') {
        var promise = commands.retry(); controls();
        promise.then(function (response) { return refresh(false).then(function () { notify('Recovered the saved change. Reference: ' + response.record.id); }, function (error) { notify('Recovered saved change ' + response.record.id + '. Refresh failed: ' + ImplementationAssuranceClient.errorMessage(error)); }); }).catch(handleError).finally(controls);
      }
      if (button.id === 'assuranceCloseoutPrepare') mutate('prepareCloseout', { planId: el('assuranceCloseoutPlan').value }).catch(handleError);
      if (button.id === 'assuranceCloseoutDownload' && closeout) {
        client.downloadCloseout(closeout.record.id).then(function (result) {
          var blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob); var anchor = document.createElement('a'); anchor.href = url; anchor.download = 'implementation-closeout-' + closeout.record.id + '.json'; anchor.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }).catch(handleError);
      }
    });
    el('assuranceStep').options = steps.map(function (step) { return { value: step[0], label: step[1] }; });
    el('assuranceAssetClass').options = ['annuity', 'bank_account', 'life_insurance', 'retirement', 'real_estate', 'brokerage', 'business_interest', 'personal_property', 'other'].map(function (value) { return { value: value, label: value.split('_').join(' ') }; });
    el('assuranceRulebookJurisdiction').options = Rulebook.jurisdictions.map(function (entry) { return { value: entry.value, label: Rulebook.jurisdictionLabel(entry.value) }; });
    el('assuranceObservationFrom').type = 'datetime-local'; el('assuranceObservationUntil').type = 'datetime-local';
    showStep(currentStep); controls();
    return { refresh: refresh, controls: controls, showStep: showStep, actionAllowed: actionAllowed, data: function () { return data; }, busy: function () { return loading; } };
  }
  global.AssuranceOnboarding = { mount: mount };
})(window);

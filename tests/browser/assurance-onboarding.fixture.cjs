// Exercises actual Lex/page code with a synthetic API. This does not prove backend authorization or legal correctness.
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createPageServer } = require('./assurance-page.harness.cjs');
function fixtureApi() {
  const matter = '33333333-3333-4333-8333-333333333333';
  const ref = id => ({ id, version: 1, sha256: 'a'.repeat(64) });
  const initial = { assets: [], plan: [], target: [], observation: [], closeout: [], requests: {}, adopted: false, calls: [], decisions: [], reviewed: false, current: true, accepted: false };
  const state = window.fixtureState = JSON.parse(sessionStorage.getItem('assurance-fixture-state') || 'null') || initial;
  const save = () => sessionStorage.setItem('assurance-fixture-state', JSON.stringify(state));
  window.fixtureMode = 'ok';
  window.electronAPI = { openExternal: url => { window.fixtureExternal = url; } };
  window.Lex = window.Lex || {};
  window.Lex.Nav = { getParams: () => new URLSearchParams('matter_id=' + matter + '&matter_name=Estate%20onboarding%20fixture'), go: (page, options) => { window.fixtureNavigation = { page, options }; } };
  const contact = { id: 'contact', label: 'Family Trust', reference: { kind: 'contact', id: 'contact' } };
  const release = { id: 'release', label: 'Reviewed estate plan.pdf', reference: ref('release'), sourceDocumentId: 'source-document', releasedDocumentId: 'released-document', retained: true };
  const rulebook = { id: 'rulebook', label: 'Firm rulebook version 1', reference: ref('rulebook'), effectiveFrom: '2026-01-01', effectiveTo: null,
    rules: [{ id: 'IN-OWN-1', title: 'Registered owner matches plan', module: 'ownership', predicate: 'owner', label: 'Registered owner', valueKind: 'reference', evidenceClasses: ['institution_acceptance'], requireReviewedObservation: true, requireCompleteCoverage: true, maxAgeDays: null }] };
  const starter = { id: 'starter-in', title: 'Indiana estate implementation starter', version: '2026.1', jurisdiction: 'US-IN', modules: [{ id: 'ownership', title: 'Asset ownership', version: '1', status: 'published' }],
    rules: [
      { id: 'IN-OWN-1', module: 'ownership', title: 'Registered owner matches plan', summary: 'Confirm the institution records the planned owner.', kind: 'LAW', verification: 'O', severity: 'blocking', citations: [{ cite: 'Ind. Code 30-4-2.1', url: 'https://iga.in.gov/laws', verification: 'O' }], firm_override: null },
      { id: 'IN-OWN-2', module: 'ownership', title: 'Beneficiary designation retained', summary: 'Retain the beneficiary designation confirmation.', kind: 'PRACTICE', verification: 'U', severity: 'warning', citations: [], firm_override: null }],
    counts: { modules: 1, rules: 2 } };
  const evaluation = () => ({ schema_version: 1, scope: { organization_id: 'org', matter_id: matter }, target: ref('target'), plan: ref('plan'), rulebook: ref('rulebook'), outcome: window.fixtureMode === 'mismatch' ? 'mismatch' : state.reviewed ? 'match' : 'unknown', reason: state.reviewed ? 'supported_match' : 'insufficient_evidence', inventory: { complete: true, reason: null }, observations: state.observation.map(entry => entry.reference), eligible_observations: [], excluded_observations: [], resource_dependencies: [], binding: 'b'.repeat(64), snapshot_sha256: 'c'.repeat(64), as_of: '2026-10-30T13:00:00.000Z' });
  const receipt = (operation, body, record) => ({ record, reference: ref(record.id), replayed: false, command: { operation, requestId: body.requestId || body.request_id, sha256: 'd'.repeat(64) } });
  window.api = { baseUrl: 'http://fixture', user: { id: 'reviewer', organizationId: 'org' }, request: async (method, url, body) => {
    state.calls.push({ method, url, body }); save();
    if (window.fixtureMode === 'unavailable') throw { status: 503 };
    if (url.endsWith('/onboarding')) return { schemaVersion: 1, scope: { matter_id: matter, organization_id: 'org' }, actions: { read: true, write: true, review: true, prepareCloseout: true, acceptCloseout: true, publishRulebook: true }, supported: { subjectKinds: ['matter_asset'], valueKinds: ['reference', 'reference_set', 'allocations'], evidenceClasses: ['institution_acceptance', 'client_statement'] }, readiness: { status: 'incomplete', checks: [{ code: 'rulebook', status: 'ready', detail: 'Approved firm rulebook available' }] } };
    if (method === 'GET' && url.includes('/lookups/')) { const kind = url.split('/lookups/')[1].split('?')[0]; return { items: { contacts: [contact], releases: [release], rulebooks: state.adopted ? [rulebook] : [] }[kind], nextCursor: null, complete: true }; }
    if (method === 'GET' && url.includes('/rulebooks/starter?')) return { record: url.endsWith('US-IN') ? starter : { ...starter, jurisdiction: url.split('jurisdiction=')[1] } };
    if (method === 'GET' && url.includes('/assets?')) return { assets: state.assets, next_cursor: null };
    if (method === 'GET' && url.includes('/records/')) {
      const parts = url.split('/records/')[1].split('?')[0].split('/');
      if (parts[1]) return { ...state[parts[0]].find(entry => entry.record.id === parts[1]), current: state.current, accepted: state.current && state.accepted, acceptanceReference: state.accepted ? ref('closeout-decision') : null };
      return { items: state[parts[0]] || [], nextCursor: null, complete: true };
    }
    if (url.endsWith('/assessments')) return { record: { id: 'assessment', evaluation: evaluation() }, reference: ref('assessment') };
    const requestId = body && (body.requestId || body.request_id);
    if (requestId && state.requests[requestId]) return { ...state.requests[requestId], replayed: true };
    let response;
    if (url.endsWith('/assets') && method === 'POST') {
      const asset = { id: 'asset', revision: 'revision-1', description: body.description, asset_classification: body.asset_classification, asset_value: body.asset_value, currency: body.currency, account_number_mask: body.account_last_four ? '****' + body.account_last_four : null };
      state.assets.push(asset); response = { asset, replayed: false, command: receipt('createAsset', body, asset).command };
    } else if (url.includes('/assets/') && method === 'PATCH') {
      Object.assign(state.assets[0], body.fields, { revision: 'revision-2' }); response = { ...state.assets[0], replayed: false, command: receipt('updateAsset', body, state.assets[0]).command };
    } else if (url.endsWith('/rulebooks/adopt')) {
      if (body.jurisdiction !== 'US-IN' || !body.rationale || body.expectedVersion !== 0) throw { status: 422, message: 'Unexpected adopt body' };
      state.adopted = true; response = receipt('adoptRulebook', body, { id: 'rulebook', version: 1 });
    } else if (url.endsWith('/plans')) {
      const record = { id: 'plan', version: 1, releases: body.releases, acceptance_ref: ref('plan-acceptance') }; state.plan = [{ record, reference: ref('plan') }]; response = receipt('savePlan', body, record);
    } else if (url.endsWith('/targets')) {
      const record = { id: 'target', version: 1, subject: body.subject, predicate: body.predicate, value: body.value, plan_ref: body.planRef, rulebook_ref: body.rulebookRef }; state.target = [{ record, reference: ref('target') }]; response = receipt('saveTarget', body, record);
    } else if (url.endsWith('/observations/review')) {
      state.reviewed = true; const record = state.observation[0].record; record.version += 1; record.review_ref = ref('review'); state.observation[0].reference.version = record.version; response = receipt('reviewObservation', body, record); response.reference.version = record.version;
    } else if (url.endsWith('/observations')) {
      const record = { id: 'observation', version: 1, subject: body.subject, predicate: body.predicate, value: body.value, evidence: body.evidence, valid_from: body.validFrom, valid_until: body.validUntil, supersedes: [], review_ref: null }; state.observation = [{ record, reference: ref('observation') }]; response = receipt('recordObservation', body, record);
    } else if (url.endsWith('/decisions')) {
      if (window.fixtureMode === 'stale') throw { status: 409 };
      const record = { id: 'decision', decision: body.decision, subject_id: body.targetId, payload_sha256: body.expectedBinding }; state.decisions.push(record); response = receipt('decide', body, record);
    } else if (url.endsWith('/closeouts/accept')) {
      if (body.scopeAcknowledgement !== 'recorded_plan_targets') throw { status: 422, message: 'Explicit closeout scope acknowledgement required' };
      state.accepted = true; response = receipt('acceptCloseout', body, { id: 'closeout-decision', decision: 'accept_closeout', subject_id: body.closeoutId, payload_sha256: body.expectedBinding });
    } else if (url.endsWith('/closeouts')) {
      const record = { id: 'closeout', version: 1, scope: { matter_id: matter, organization_id: 'org' }, plan_ref: ref('plan'), targets: [{ target_ref: ref('target'), evaluation: evaluation(), decision_ref: ref('decision'), decision: 'accept_conclusion' }], coverage: { complete: true, reason: null, basis: 'recorded_plan_targets' }, binding: 'e'.repeat(64), status: 'prepared', recorded_at: '2026-10-30T13:30:00Z' }; state.closeout = [{ record, reference: ref('closeout') }]; response = receipt('prepareCloseout', body, record);
    } else throw new Error('Fixture has no route ' + method + ' ' + url);
    state.requests[requestId] = response; save();
    if (window.fixtureMode === 'timeout') throw { status: 408 };
    return response;
  } };
}
const server = createPageServer('(' + fixtureApi.toString() + ')()');
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    async function value(id, value, change = false) { await page.evaluate(({ id, value, change }) => { const element = document.getElementById(id); element.value = value; if (change) element.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value } })); }, { id, value, change }); }
    async function check(id) { await page.evaluate(id => { document.getElementById(id).checked = true; }, id); }
    async function step(value) { await page.evaluate(value => { const element = document.getElementById('assuranceStep'); element.value = value; element.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value } })); }, value); }
    async function saved(operation) { const labels = { adoptRulebook: 'firm rulebook adoption', savePlan: 'plan acceptance', saveTarget: 'target acceptance', recordObservation: 'observation pending review', reviewObservation: 'professional evidence review', prepareCloseout: 'closeout of recorded requirements', acceptCloseout: 'closeout acceptance' }; await page.waitForFunction(label => document.getElementById('assuranceNotice').textContent.includes('Saved ' + label), labels[operation]); }
    async function submit(id) { await page.evaluate(id => document.getElementById(id).requestSubmit(), id); }
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('Records loaded'));
    await value('assuranceAssetClass', 'bank_account'); await value('assuranceAssetDescription', 'Family savings account'); await value('assuranceAssetLastFour', '1234'); await value('assuranceAssetValue', '45000');
    await page.evaluate(() => { window.fixtureMode = 'timeout'; }); await submit('assuranceAssetForm');
    await page.waitForFunction(() => !document.getElementById('assuranceRecovery').hidden);
    await page.reload(); await page.waitForFunction(() => !document.getElementById('assuranceRecovery').hidden);
    await page.locator('#assuranceRecover button').click(); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('Recovered the saved change'));
    assert.equal(await page.evaluate(() => window.fixtureState.assets.length), 1);
    await step('plan'); await value('assurancePlanReleases', ['release'], true); await value('assurancePlanRationale', 'Reviewed the retained approved plan.'); await check('assurancePlanConfirm'); await submit('assurancePlanForm'); await saved('savePlan');
    await step('rulebook'); assert.match(await page.locator('#assuranceRulebookSummary').innerText(), /No firm rulebook is adopted/);
    assert.equal(await page.locator('#assuranceRulebookAdopt').evaluate(element => element.disabled), true);
    await value('assuranceRulebookJurisdiction', 'US-IN', true); await page.waitForFunction(() => document.getElementById('assuranceRulebookSummary').textContent.includes('Starter preview'));
    assert.equal(await page.locator('#assuranceRulebookRules lex-badge').count(), 6); assert.match(await page.locator('#assuranceRulebookRules').innerText(), /IN-OWN-2/);
    assert.match(await page.locator('#assuranceRulebookFlags').innerText(), /not legal conclusions/);
    await page.locator('#assuranceRulebookRules a.assurance-source-link').click(); assert.equal(await page.evaluate(() => window.fixtureExternal), 'https://iga.in.gov/laws');
    await value('assuranceRulebookRationale', 'Reviewed the Indiana starter and its flags.'); await check('assuranceRulebookConfirm'); await submit('assuranceRulebookForm'); await saved('adoptRulebook');
    await page.waitForFunction(() => document.getElementById('assuranceRulebookSummary').textContent.includes('Adopted'));
    assert.equal(await page.locator('#assuranceRulebookForm').evaluate(element => element.hidden), true);
    await step('targets'); await value('assuranceTargetPlan', 'plan'); await value('assuranceTargetRulebook', 'rulebook', true); await value('assuranceTargetRule', 'owner', true); await value('assuranceTargetAsset', 'asset');
    await page.locator('#assuranceTargetValue lex-select').evaluate(element => { element.value = 'contact'; }); await value('assuranceTargetRationale', 'The accepted plan identifies the trust as intended owner.'); await check('assuranceTargetConfirm'); await submit('assuranceTargetForm'); await saved('saveTarget');
    await step('observations'); await value('assuranceObservationTarget', 'target', true); await page.locator('#assuranceObservationValue lex-select').evaluate(element => { element.value = 'contact'; }); await value('assuranceObservationFrom', '2026-10-30T09:00');
    await page.locator('#assuranceObservationEvidence').evaluate(host => { const selects = host.querySelectorAll('lex-select'); selects[0].value = 'release'; selects[1].value = 'institution_acceptance'; selects[2].value = 'complete'; const inputs = host.querySelectorAll('lex-input'); inputs[0].value = '2026-10-30T09:00'; inputs[1].value = '1'; host.querySelector('lex-textarea').value = 'The institution confirms the registered owner.'; });
    await submit('assuranceObservationForm'); await saved('recordObservation');
    await step('review'); await value('assuranceTarget', 'target', true); await page.locator('#assuranceAssess button').click(); await page.waitForFunction(() => !document.getElementById('assuranceDecisionForm').hidden);
    assert.equal(await page.locator('#assuranceAssessment [data-outcome]').getAttribute('data-outcome'), 'unknown');
    assert.equal(await page.locator('#assuranceDecision').evaluate(element => element.options.some(option => option.value === 'accept_conclusion')), false);
    await step('evidence-review'); await value('assuranceObservationReview', 'observation', true); await value('assuranceObservationReviewRationale', 'Inspected the exact retained source and locator.'); await check('assuranceObservationReviewConfirm'); await submit('assuranceObservationReviewForm'); await saved('reviewObservation');
    assert.equal(await page.locator('#assuranceObservationReviewConfirm').evaluate(element => Boolean(element.checked)), false);
    await step('review'); await value('assuranceTarget', 'target', true); await page.locator('#assuranceAssess button').click(); await page.waitForFunction(() => !document.getElementById('assuranceDecisionForm').hidden);
    assert.equal(await page.locator('#assuranceAssessment [data-outcome]').getAttribute('data-outcome'), 'match');
    await value('assuranceDecision', 'accept_conclusion'); await value('assuranceRationale', 'Reviewed target, source and current supported finding.'); await page.locator('#assuranceSave button').click(); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('Finding accepted'));
    await step('closeout'); await value('assuranceCloseoutPlan', 'plan'); await page.locator('#assuranceCloseoutPrepare button').click(); await saved('prepareCloseout'); await page.waitForFunction(() => document.getElementById('assuranceCloseoutDetails').textContent.includes('Current pinned record'));
    await value('assuranceCloseoutRationale', 'Reviewed the full pinned target and decision manifest.'); await check('assuranceCloseoutConfirm'); await submit('assuranceCloseoutForm'); await saved('acceptCloseout'); await page.waitForFunction(() => document.getElementById('assuranceCloseoutDetails').textContent.includes('Professionally accepted'));
    await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/lana-estate-onboarding-wide.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 1000 }); await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/lana-estate-onboarding-narrow.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.match(await page.locator('#assuranceStep').innerText(), /Closeout/);
    assert.equal(await page.evaluate(() => window.fixtureState.calls.filter(call => call.url.endsWith('/decisions')).length), 1);
    await check('assuranceCloseoutConfirm');
    await page.evaluate(() => { window.fixtureState.current = false; window.fixtureState.target[0].record.version = 2; window.fixtureState.target[0].reference.version = 2; }); await page.locator('#assuranceRefresh button').click(); await page.waitForFunction(() => document.getElementById('assuranceCloseoutDetails').textContent.includes('Records changed'));
    assert.equal(await page.locator('#assuranceCloseoutAccept').evaluate(element => element.disabled), true);
    assert.match(await page.locator('#assuranceCloseoutDetails').innerText(), /Previously accepted; requires renewed review/);
    assert.match(await page.locator('#assuranceCloseoutDetails').innerText(), /Recorded target · version 1/);
    assert.equal(await page.locator('#assuranceCloseoutConfirm').evaluate(element => Boolean(element.checked)), false);
    await step('review'); await value('assuranceTarget', 'target', true); await page.evaluate(() => { window.fixtureMode = 'mismatch'; }); await page.locator('#assuranceAssess button').click(); await page.waitForFunction(() => !document.getElementById('assuranceDecisionForm').hidden);
    assert.equal(await page.locator('#assuranceDecision').evaluate(element => element.options.some(option => option.value === 'accept_conclusion')), false);
    await value('assuranceDecision', 'accept_exception'); await value('assuranceRationale', 'Reviewed the mismatch and stated exception.'); await page.evaluate(() => { window.fixtureMode = 'stale'; }); await page.locator('#assuranceSave button').click(); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('records changed'));
    assert.equal(await page.locator('#assuranceDecisionForm').evaluate(element => element.hidden), true);
    await page.evaluate(() => { window.fixtureMode = 'unavailable'; }); await page.locator('#assuranceRefresh button').click(); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('not available'));
    assert.equal(await page.locator('#assuranceAssess').evaluate(element => element.disabled), true); assert.equal(await page.locator('#assuranceAssetSave').evaluate(element => element.disabled), true);

    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ completed: ['asset-create-unknown-refresh-recovery', 'plan-acceptance', 'rulebook-starter-preview-and-adoption', 'target-acceptance', 'observation-recording', 'unknown-before-review', 'professional-observation-review', 'assessment', 'professional-decision', 'closeout-prepare', 'closeout-acceptance', 'changed-closeout-refused', 'mismatch-excludes-conclusion', 'stale-decision-refused', 'unavailable-read-only'], pageErrors: errors, screenshots: ['/tmp/lana-estate-onboarding-wide.png', '/tmp/lana-estate-onboarding-narrow.png'] }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

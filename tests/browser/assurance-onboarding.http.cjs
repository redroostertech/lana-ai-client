// Actual Lex + production router/Core/PostgreSQL. Fixture identity and document bytes remain synthetic.
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createPageServer } = require('./assurance-page.harness.cjs');
const config = JSON.parse(fs.readFileSync(process.env.ASSURANCE_FIXTURE_CONFIG || '/tmp/lana-estate-browser-fixture.json', 'utf8'));
function bootstrap(config) {
  window.Lex = window.Lex || {};
  window.Lex.Nav = { getParams: () => new URLSearchParams({ matter_id: config.matterId, matter_name: 'Synthetic estate integration' }), go: () => {} };
  window.api = { baseUrl: config.baseUrl, user: { id: config.actor.userId, organizationId: config.actor.organizationId }, request: async (method, url, body) => {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message || result.error?.message || 'Request failed'), { status: response.status });
    return result;
  } };
}
const publicConfig = { baseUrl: config.baseUrl, matterId: config.matterId, actor: config.actor };
const server = createPageServer('(' + bootstrap.toString() + ')(' + JSON.stringify(publicConfig) + ')');
(async () => {
  const headers = { Authorization: 'Bearer ' + config.token };
  const base = config.baseUrl + '/api/v1/implementation-assurance/matters/' + config.matterId;
  const invalid = await fetch(base + '/onboarding', { headers: { Authorization: 'Bearer invalid' } }); assert.equal(invalid.status, 401);
  const forged = await fetch(base.replace(config.matterId, '00000000-0000-4000-8000-000000000001') + '/onboarding', { headers }); assert.ok([403, 404].includes(forged.status));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, timezoneId: 'UTC' });
    const errors = [], calls = [], receipts = {};
    let dropFirstAsset = true;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/implementation-assurance/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      const response = await route.fetch({ url: config.baseUrl + url.pathname + url.search, headers: { ...request.headers(), ...headers } });
      const result = await response.json(); calls.push({ method: request.method(), path: url.pathname, status: response.status(), body: request.postDataJSON() });
      if (result.command) receipts[result.command.operation] = result;
      if (dropFirstAsset && request.method() === 'POST' && url.pathname.endsWith('/assets') && response.ok()) { dropFirstAsset = false; await route.abort(); return; }
      await route.fulfill({ response });
    });
    async function value(id, value, change = false) { await page.evaluate(({ id, value, change }) => { const el = document.getElementById(id); el.value = value; if (change) el.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value } })); }, { id, value, change }); }
    async function check(id) { await page.evaluate(id => { document.getElementById(id).checked = true; }, id); }
    async function step(selected) { await value('assuranceStep', selected, true); }
    async function submit(id) { await page.evaluate(id => document.getElementById(id).requestSubmit(), id); }
    async function saved(label) { await page.waitForFunction(label => document.getElementById('assuranceNotice').textContent.includes('Saved ' + label), label); }
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('Records loaded'));
    let assetId, planId, targetId, observationId, closeoutId;
    if (!process.env.ASSURANCE_RESUME_AMENDMENTS) {
    await value('assuranceAssetClass', 'bank_account'); await value('assuranceAssetDescription', 'Synthetic integration savings'); await value('assuranceAssetLastFour', '9876'); await value('assuranceAssetValue', '45000'); await submit('assuranceAssetForm');
    await page.waitForFunction(() => !document.getElementById('assuranceRecovery').hidden); await page.reload(); await page.waitForFunction(() => !document.getElementById('assuranceRecovery').hidden); await page.locator('#assuranceRecover button').click(); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('Recovered the saved change'));
    const assetCalls = calls.filter(call => call.method === 'POST' && call.path.endsWith('/assets')); assert.equal(assetCalls.length, 2); assert.equal(assetCalls[0].body.request_id, assetCalls[1].body.request_id); assert.equal(receipts.createAsset.replayed, true);
    const assets = await (await fetch(base + '/assets', { headers })).json(); assert.equal(assets.assets.length, 1); assetId = assets.assets[0].id;
    const rulebooks = await (await fetch(base + '/lookups/rulebooks', { headers })).json(); const evidenceClass = rulebooks.items.find(item => item.id === config.rulebookRef.id).rules[0].evidenceClasses[0];
    await step('plan'); await value('assurancePlanReleases', [config.releaseRef.id], true); await value('assurancePlanRationale', 'Synthetic reviewer inspected the retained approved plan.'); await check('assurancePlanConfirm'); await submit('assurancePlanForm'); await saved('plan acceptance'); planId = receipts.savePlan.record.id;
    await step('targets'); await value('assuranceTargetPlan', planId); await value('assuranceTargetRulebook', config.rulebookRef.id, true); await value('assuranceTargetRule', 'firm.asset.owner', true); await value('assuranceTargetAsset', assetId); await page.locator('#assuranceTargetValue lex-select').evaluate((el, id) => { el.value = id; }, config.contactId); await value('assuranceTargetRationale', 'Synthetic accepted plan names the selected contact.'); await check('assuranceTargetConfirm'); await submit('assuranceTargetForm'); await saved('target acceptance'); targetId = receipts.saveTarget.record.id;
    const localDate = new Date(Date.now() - 60000).toISOString().slice(0,16);
    await step('observations'); await value('assuranceObservationTarget', targetId, true); await page.locator('#assuranceObservationValue lex-select').evaluate((el,id) => { el.value = id; }, config.contactId); await value('assuranceObservationFrom', localDate);
    await page.locator('#assuranceObservationEvidence').evaluate((host, data) => { const selects = host.querySelectorAll('lex-select'); selects[0].value = data.releaseId; selects[1].value = data.evidenceClass; selects[2].value = 'complete'; const inputs = host.querySelectorAll('lex-input'); inputs[0].value = data.date; inputs[1].value = '1'; host.querySelector('lex-textarea').value = 'Jordan Fixture'; }, { releaseId: config.releaseRef.id, date: localDate, evidenceClass }); await submit('assuranceObservationForm'); await saved('observation pending review'); observationId = receipts.recordObservation.record.id;
    await step('review'); await value('assuranceTarget', targetId, true); await page.locator('#assuranceAssess button').click(); await page.waitForFunction(() => !document.getElementById('assuranceDecisionForm').hidden); assert.equal(await page.locator('#assuranceAssessment [data-outcome]').getAttribute('data-outcome'), 'unknown');
    await step('evidence-review'); await value('assuranceObservationReview', observationId, true); await value('assuranceObservationReviewRationale', 'Synthetic professional inspected exact release bytes and source locator.'); await check('assuranceObservationReviewConfirm'); await submit('assuranceObservationReviewForm'); await saved('professional evidence review');
    await step('review'); await value('assuranceTarget', targetId, true); await page.locator('#assuranceAssess button').click(); await page.waitForFunction(() => !document.getElementById('assuranceDecisionForm').hidden); assert.equal(await page.locator('#assuranceAssessment [data-outcome]').getAttribute('data-outcome'), 'match');
    await value('assuranceDecision', 'accept_conclusion'); await value('assuranceRationale', 'Synthetic professional reviewed the supported finding.'); await page.locator('#assuranceSave button').click(); await page.waitForFunction(() => document.getElementById('assuranceNotice').textContent.includes('Finding accepted'));
    await step('closeout'); await value('assuranceCloseoutPlan', planId); await page.locator('#assuranceCloseoutPrepare button').click(); await saved('closeout of recorded requirements'); await page.waitForFunction(() => document.getElementById('assuranceCloseoutDetails').textContent.includes('Current pinned record'));
    await value('assuranceCloseoutRationale', 'Synthetic professional accepts only the recorded requirements.'); await check('assuranceCloseoutConfirm'); await submit('assuranceCloseoutForm'); await saved('closeout acceptance'); await page.waitForFunction(() => document.getElementById('assuranceCloseoutDetails').textContent.includes('Professionally accepted'));
    closeoutId = receipts.prepareCloseout.record.id; const closeout = await (await fetch(base + '/records/closeout/' + closeoutId, { headers })).json(); assert.equal(closeout.current, true); assert.equal(closeout.accepted, true); assert.equal(closeout.record.targets.length, 1); assert.equal(closeout.record.coverage.basis, 'recorded_plan_targets');
    await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/lana-estate-onboarding-http-wide.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 1000 }); await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/lana-estate-onboarding-http-narrow.png', fullPage: true }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await step('inventory'); await value('assuranceAssetEdit', assetId, true); await value('assuranceAssetDescription', 'Synthetic revised inventory'); await submit('assuranceAssetForm'); await saved('asset changes');
    await step('closeout'); await value('assuranceCloseoutSelect', closeoutId, true); await page.waitForFunction(() => document.getElementById('assuranceCloseoutDetails').textContent.includes('Records changed')); assert.equal(await page.locator('#assuranceCloseoutAccept').evaluate(el => el.disabled), true); assert.match(await page.locator('#assuranceCloseoutDetails').innerText(), /Previously accepted; requires renewed review/);
    const changed = await (await fetch(base + '/records/closeout/' + closeoutId, { headers })).json(); assert.equal(changed.current, false);
    } else {
      const list = async kind => (await (await fetch(base + '/records/' + kind, { headers })).json()).items;
      planId = (await list('plan'))[0].record.id; targetId = (await list('target'))[0].record.id; observationId = (await list('observation'))[0].record.id; closeoutId = (await list('closeout'))[0].record.id;
    }
    await step('plan'); await value('assurancePlanEdit', planId, true); await value('assurancePlanRationale', 'Synthetic amendment explicitly retains the reviewed source.'); await check('assurancePlanConfirm'); await submit('assurancePlanForm'); await saved('plan acceptance'); assert.equal(receipts.savePlan.record.id, planId); assert.equal(receipts.savePlan.record.version, 2);
    const historic = await (await fetch(base + '/records/closeout/' + closeoutId, { headers })).json(); assert.equal(historic.current, false); assert.equal(historic.record.plan_ref.version, 1);
    await step('targets'); await value('assuranceTargetEdit', targetId, true); await value('assuranceTargetRationale', 'Synthetic professional explicitly rebinds the target to amended plan version 2.'); await check('assuranceTargetConfirm'); await submit('assuranceTargetForm'); await saved('target acceptance'); assert.equal(receipts.saveTarget.record.id, targetId); assert.equal(receipts.saveTarget.record.version, 2); assert.equal(receipts.saveTarget.record.plan_ref.version, 2);
    await step('closeout'); await value('assuranceCloseoutSelect', closeoutId, true); await page.waitForFunction(() => document.getElementById('assuranceCloseoutDetails').textContent.includes('Recorded target · version 1'));
    await check('assuranceCloseoutConfirm'); await value('assuranceCloseoutSelect', closeoutId, true); await page.waitForFunction(() => !document.getElementById('assuranceCloseoutConfirm').checked);
    await step('observations'); await value('assuranceObservationTarget', targetId, true); await value('assuranceObservationEdit', observationId, true); await page.locator('#assuranceObservationEvidence lex-textarea').evaluate(el => { el.value = 'Jordan Fixture is the stated owner.'; }); await submit('assuranceObservationForm'); await saved('observation pending review'); assert.equal(receipts.recordObservation.record.id, observationId); assert.equal(receipts.recordObservation.record.review_ref, null); assert.equal(receipts.recordObservation.record.version, 3);
    await step('review'); await value('assuranceTarget', targetId, true); await page.locator('#assuranceAssess button').click(); await page.waitForFunction(() => !document.getElementById('assuranceDecisionForm').hidden); assert.equal(await page.locator('#assuranceAssessment [data-outcome]').getAttribute('data-outcome'), 'unknown');
    await step('evidence-review'); await value('assuranceObservationReview', observationId, true); await value('assuranceObservationReviewRationale', 'Synthetic professional reviewed revised observation version 3.'); await check('assuranceObservationReviewConfirm'); await submit('assuranceObservationReviewForm'); await saved('professional evidence review'); assert.equal(receipts.reviewObservation.record.version, 4); assert.equal(await page.locator('#assuranceObservationReviewConfirm').evaluate(el => Boolean(el.checked)), false);
    await step('review'); await value('assuranceTarget', targetId, true); await page.locator('#assuranceAssess button').click(); await page.waitForFunction(() => !document.getElementById('assuranceDecisionForm').hidden); assert.equal(await page.locator('#assuranceAssessment [data-outcome]').getAttribute('data-outcome'), 'match');
    for (const kind of ['plan', 'target', 'observation']) { const records = await (await fetch(base + '/records/' + kind, { headers })).json(); assert.equal(records.items.length, 1); }
    assert.deepEqual(errors, []); console.log(JSON.stringify({ completed: (process.env.ASSURANCE_RESUME_AMENDMENTS ? ['invalid-bearer-refused','forged-matter-refused','plan-amendment-preserves-history','explicit-target-rebind','observation-revision-clears-review','revision-re-review','no-duplicate-amended-records'] : ['invalid-bearer-refused','forged-matter-refused','actual-write-lost-response-refresh-exact-replay','single-saved-asset','plan','target','observation','unreviewed-unknown','professional-review','supported-match','professional-decision','closeout-prepare','scoped-closeout-acceptance','changed-asset-invalidates-closeout','plan-amendment-preserves-history','explicit-target-rebind','observation-revision-clears-review','revision-re-review','no-duplicate-amended-records']), resumedAmendmentsOnly: Boolean(process.env.ASSURANCE_RESUME_AMENDMENTS), httpRequests: calls.length, pageErrors: errors, fixtureBoundary: 'production router/Core/SQL; synthetic bearer, retained bytes and professional grants' }));
  } catch (error) { console.error(error); throw error; } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error.message); server.close(); process.exitCode = 1; });

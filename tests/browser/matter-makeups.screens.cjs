// Serves the real workspace-details page with the synthetic matter makeups API
// (matter-makeups.fixture.cjs) and captures screenshots of each surface.
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   SCREENS_DIR=/path/to/out node tests/browser/matter-makeups.screens.cjs
// Exercises actual Lex/page code with a synthetic API. It does not prove backend behavior.
// With LIVE_API_URL set it runs the live flows instead (matter-makeups.live.cjs):
// the same renderer against a real backend, nothing mocked.
'use strict';
if (process.env.LIVE_API_URL) { require('./matter-makeups.live.cjs'); return; }
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { createFixtureApi, MATTER_ID, USER } = require('./matter-makeups.fixture.cjs');

const { rendererServer } = require('./renderer-server.cjs');

const outDir = process.env.SCREENS_DIR || path.join(require('node:os').tmpdir(), 'matter-makeups-screens');

function fakeJwt() {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: USER.id, organization_id: USER.organization_id, exp: 4102444800 }) + '.fixture';
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = rendererServer({ outDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const api = createFixtureApi();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'America/Indiana/Indianapolis' });
    await context.addInitScript(({ token, user, origin }) => {
      try {
        // The app's preload provides this; the browser harness stands in for it.
        window.lanaAuthToken = (() => { let held = token; return { get: () => held, set: (t) => { held = t; }, clear: () => { held = null; } }; })();
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('lana_saved_server', JSON.stringify({ url: origin, name: 'Fixture' }));
        localStorage.setItem('lex-theme', 'light');
      } catch (error) { /* storage unavailable */ }
    }, { token: fakeJwt(), user: USER, origin });
    // Third-party CDN assets are not needed for these surfaces.
    await context.route(/^https:\/\/cdn\.jsdelivr\.net\//, (route) => route.fulfill({ status: 200, contentType: route.request().url().endsWith('.css') ? 'text/css' : 'application/javascript', body: '' }));
    await context.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let body = null;
      try { body = request.postDataJSON(); } catch (error) { body = request.postData(); }
      const answer = api.handle(request.method(), url.pathname, url.search, body) || { status: 200, body: { success: true, data: [] } };
      await route.fulfill({ status: answer.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', ...(answer.headers || {}) }, body: JSON.stringify(answer.body) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));

    const settle = (ms = 600) => page.waitForTimeout(ms);
    const shot = async (name) => { await settle(); await page.screenshot({ path: path.join(outDir, name) }); console.log('captured', name); };
    const tab = async (id) => { await page.evaluate((id) => { document.getElementById('tabBar').setAttribute('active', id); document.getElementById('tabBar').dispatchEvent(new CustomEvent('tab-change', { bubbles: true, detail: { tab: id } })); }, id); await settle(900); };
    // Lex toasts are .lex-toast (they leave 300 ms after their 4 s); older hosts are body > div.fixed.
    const waitToastGone = () => page.waitForFunction(() => !document.querySelector('.lex-toast')
      && !Array.from(document.querySelectorAll('body > div.fixed')).some((el) => el.textContent.trim()), null, { timeout: 10000 });
    const closeOverlays = async () => { await page.keyboard.press('Escape'); await settle(300); await page.evaluate(() => document.querySelectorAll('lex-modal[open], lex-drawer[open]').forEach((el) => { el.open = false; })); await settle(300); };

    await page.goto(origin + '/workspace-details.html?id=' + MATTER_ID);
    await page.waitForFunction(() => window.currentMatterData && document.getElementById('tabBar') && document.getElementById('tabBar').tabs && document.getElementById('tabBar').tabs.length > 0, null, { timeout: 20000 });
    await settle(1500);
    await shot('01-matter-summary-makeup-tabs.png');

    await tab('notes');
    await page.waitForSelector('#notesList [data-note-id]', { timeout: 10000 });
    await shot('02a-notes-labels-links-filter.png');
    await page.evaluate(() => { const last = document.querySelector('#notesList [data-note-id="note-evidence"]'); if (last) last.scrollIntoView({ block: 'end' }); });
    await shot('02b-notes-instruction-and-evidence.png');
    await page.evaluate(() => document.querySelector('#notesList [data-note-id="note-deed"]').scrollIntoView({ block: 'center' }));

    await page.click('#notesList [data-note-id="note-deed"]');
    await page.waitForFunction(() => document.getElementById('notesViewModal') && document.getElementById('notesViewModal').open);
    await settle();
    await shot('03a-note-view-link-chips.png');
    await page.evaluate(() => { const menu = document.getElementById('notesViewAddLink'); const trigger = menu && (menu.querySelector('button') || menu); trigger.click(); });
    await shot('03b-note-view-add-link-menu.png');
    await page.click('.lex-ddbtn-item[data-value="document"]');
    await page.waitForFunction(() => { const s = document.querySelector('[data-link-picker-value]'); return s && s.options && s.options.length > 0; }, null, { timeout: 8000 });
    await page.evaluate(() => { const s = document.querySelector('[data-link-picker-value]'); s.value = 'doc-deed'; s.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: 'doc-deed' } })); });
    await page.waitForFunction(() => { const s = document.querySelector('[data-link-picker-release]'); return s && !s.disabled; }, null, { timeout: 8000 });
    await page.evaluate(() => { document.querySelector('[data-link-picker-release]').value = 'rel-deed-2'; });
    await shot('03c-add-link-document-retained-release.png');
    await closeOverlays();
    // A rule link: the picker lists the applied rulebook's rules (firm or starter, with the version) and posts the lookup's target exactly.
    const outdatedChips = await page.evaluate(() => Array.from(document.querySelectorAll('#notesViewLinks .note-link-chip__outdated')).map((el) => el.textContent));
    if (outdatedChips.join('|') !== 'Rulebook text changed') throw new Error('Outdated starter chips: ' + outdatedChips.join('|'));
    await page.click('#notesList [data-note-id="note-deed"]');
    await page.waitForFunction(() => document.getElementById('notesViewModal') && document.getElementById('notesViewModal').open);
    await page.evaluate(() => { const menu = document.getElementById('notesViewAddLink'); const trigger = menu && (menu.querySelector('button') || menu); trigger.click(); });
    await page.click('.lex-ddbtn-item[data-value="rulebook_rule"]');
    await page.waitForFunction(() => { const s = document.querySelector('[data-link-picker-value]'); return s && s.options && s.options.length > 0; }, null, { timeout: 8000 });
    const ruleChoice = await page.evaluate(() => { const s = document.querySelector('[data-link-picker-value]'); s.value = s.options[1].value; return s.options[1]; });
    if (!/\(Firm rule v3\)$/.test(ruleChoice.label)) throw new Error('Rule option: ' + JSON.stringify(ruleChoice));
    await shot('03d-add-link-rule-firm-or-starter.png');
    await page.evaluate(() => { const modal = document.querySelector('[data-link-picker-value]').closest('lex-modal'); modal.querySelector('[data-action="save-link"]').click(); });
    await page.waitForFunction(() => !document.querySelector('[data-link-picker-value]'), null, { timeout: 8000 });
    const rulePost = api.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/links')).pop();
    if (JSON.stringify(rulePost.body.target) !== JSON.stringify(api.data.linkTargets.rulebook_rule[1].target)) throw new Error('Rule link target: ' + JSON.stringify(rulePost.body.target));
    await closeOverlays();
    await waitToastGone();

    await tab('tasks');
    await page.waitForSelector('[data-task-actions-for]:not([hidden])', { timeout: 10000 });
    const boardRules = await page.evaluate(() => ({ labels: Array.from(document.querySelectorAll('.task-rule-chips lex-badge')).map((el) => el.getAttribute('label')),
      outdated: document.querySelectorAll('.task-rule-chips__outdated').length }));
    if (!boardRules.labels.includes('Starter rule estate.bank.pod-review (v0.2.0-draft)') || !boardRules.labels.includes('Firm rule funding.real-property.deed-recorded (v3)') || boardRules.outdated !== 1) {
      throw new Error('Board rule chips: ' + JSON.stringify(boardRules));
    }
    await shot('04-board-task-actions-provenance.png');
    // Pressing a start action: the answer's action status turns the button off.
    await page.click('[data-task-actions-for="task-ira"] [data-task-action-id="act-review"]');
    await page.waitForSelector('[data-task-actions-for="task-ira"] [data-task-action-id="act-review"][disabled]', { timeout: 8000 });
    await shot('04b-board-task-action-started-running.png');

    // The decide form (backend 7a shape) from the Board's "Decision needed" action.
    const openModal = () => page.evaluateHandle(() => Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop());
    const fill = (values) => page.evaluate((values) => {
      const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop();
      Object.keys(values).forEach((id) => {
        const el = modal.querySelector('[data-field-id="' + id + '"]');
        if (el.tagName === 'LEX-CHECKBOX') el.checked = values[id]; else el.value = values[id];
      });
    }, values);
    // The start toast from 04b times out before the decision form is shown.
    await page.waitForFunction(() => !document.querySelector('.lex-toast'), null, { timeout: 10000 });
    await page.click('[data-task-actions-for="task-checking"] [data-task-action-id="act-decide"]');
    await page.waitForSelector('.server-form__context', { timeout: 8000 });
    await fill({ decision: 'accept_exception', rationale: 'The account stays joint with Rowan by client instruction; the plan amendment follows at the next meeting.', confirm: true });
    await shot('13h-decide-form.png');
    await closeOverlays();

    await tab('rulebook');
    await page.waitForSelector('.matter-generic-tab--rulebook', { timeout: 8000 });
    await shot('13a-rulebook-tab.png');
    // Publish firm rulebook: select new or the firm rulebook, the JSON definition in a document-sized field, confirm.
    await page.click('.matter-generic-tab--rulebook .matter-generic-tab__header [data-tab-action="1"]');
    await page.waitForSelector('[data-field-id="definition"].server-form__field--document', { timeout: 8000 });
    await fill({ rulebook: 'rb-firm-4c2e', definition: JSON.stringify({ effective_from: '2026-11-01', effective_to: null, rules: [{ id: 'estate.title.deed-to-trustee', predicate: 'owner', value_kind: 'reference', meta: { title: 'Real property is titled to the trustee' } }], advisory: [] }, null, 2), confirm: true });
    await shot('13i-publish-firm-rulebook-form.png');
    await closeOverlays();
    // Set target on the shares rule: accept_target with an allocation.
    await page.evaluate(() => { const row = Array.from(document.querySelectorAll('.matter-generic-tab__row')).find((el) => el.textContent.includes('estate.beneficiary.contingent-shares: ')); row.scrollIntoView({ block: 'center' }); row.querySelector('[data-tab-action]').click(); });
    await page.waitForSelector('[data-field-id="value"] .server-form__row', { timeout: 8000 });
    await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop();
      modal.querySelector('[data-field-id="plan"]').value = 'ar-plan-0002';
      modal.querySelector('[data-field-id="asset"]').value = 'asset-ira-1';
      const group = modal.querySelector('[data-field-id="value"]');
      group.querySelector('.server-form__rows lex-btn, [data-field-id="value"] > lex-btn');
      const add = Array.from(group.children).find((el) => el.tagName === 'LEX-BTN');
      add.click();
      const rows = group.querySelectorAll('.server-form__row');
      [['contact-rowan', '60'], ['contact-juniper', '40']].forEach(([ref, percent], index) => {
        const [select, share] = rows[index].querySelectorAll('lex-select, lex-input');
        select.value = ref; share.value = percent;
      });
      modal.querySelector('[data-field-id="rationale"]').value = 'Plan section 4.2: contingent beneficiaries Rowan 60%, Juniper\'s estate 40%.';
      modal.querySelector('[data-field-id="confirm"]').checked = true;
    });
    await shot('13e-accept-target-allocation.png');
    await closeOverlays();

    await tab('assets');
    await page.waitForSelector('.matter-generic-tab--records', { timeout: 8000 });
    await shot('13b-assets-tab.png');
    await tab('decisions');
    await page.waitForSelector('.matter-generic-tab--ledger', { timeout: 8000 });
    await shot('13c-decisions-tab.png');
    // The closeout download: an authenticated fetch saved under the server's file name, no notice on the row.
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('[data-tab-download]')]);
    if (download.suggestedFilename() !== 'closeout-e0c1d2e3-4444-4ddd-8eee-000000000021.json') throw new Error('Download name: ' + download.suggestedFilename());
    const downloadCall = api.calls.find((call) => call.path.includes('/tabs/decisions/downloads/'));
    if (!downloadCall) throw new Error('The download route was not asked');
    if (await page.$('[data-tab-download-notice]')) throw new Error('A successful download left a notice');
    await page.evaluate(() => document.querySelector('[data-tab-download]').closest('.matter-generic-tab__row').scrollIntoView({ block: 'center' }));
    await shot('14b-decisions-download.png');
    // The same closeout, no longer accepted: the server answers 404 and the row says why.
    api.data.refusedDownloads.add('closeout:e0c1d2e3-4444-4ddd-8eee-000000000021');
    await page.click('[data-tab-download]');
    await page.waitForSelector('[data-tab-download-notice]', { timeout: 8000 });
    const refusedText = await page.evaluate(() => document.querySelector('[data-tab-download-notice]').textContent);
    // The row shows the server's own 404 CLOSEOUT_NOT_ACCEPTED message.
    if (refusedText !== 'Only accepted closeouts can be downloaded. Accept this closeout first.') throw new Error('Refused download notice: ' + refusedText);
    await shot('14c-decisions-download-not-accepted.png');
    await shot('65-closeout-not-accepted-server-message.png');
    await page.click('.matter-generic-tab--ledger .matter-generic-tab__header [data-tab-action="0"]');
    await page.waitForSelector('[data-field-id="releases"]', { timeout: 8000 });
    await fill({ releases: ['rel-trust-1', 'rel-deed-2'], rationale: 'Executed trust agreement and the recorded deed with the county stamp page, both released after review.', confirm: true });
    await shot('13d-accept-plan-form.png');
    const pills = await page.evaluate(() => Array.from(document.querySelectorAll('[data-field-id="releases"] .lex-select-pill')).map((pill) => ({
      title: pill.getAttribute('title'), clipped: pill.querySelector('.lex-select-pill-label').scrollWidth > pill.querySelector('.lex-select-pill-label').clientWidth,
      remove: pill.querySelector('.lex-select-pill-x').getBoundingClientRect().width > 0 })));
    if (pills.length !== 2 || pills.some((pill) => pill.clipped || !pill.remove)) throw new Error('Multiselect pills: ' + JSON.stringify(pills));
    await shot('55-multiselect-chips-full-labels.png');
    await closeOverlays();

    // Record as evidence from a fact note about an asset with two targets: the server asks which one.
    await tab('notes');
    await page.waitForSelector('#notesList [data-note-id="note-ira"]', { timeout: 10000 });
    await page.click('#notesList [data-note-id="note-ira"]');
    await page.waitForSelector('#notesViewLinks .note-links__action[data-note-action="record_evidence"]', { timeout: 8000 });
    await page.click('#notesViewLinks .note-links__action[data-note-action="record_evidence"]');
    await page.waitForSelector('[data-server-form-choice]', { timeout: 8000 });
    await page.evaluate(() => { document.querySelector('[data-server-form-choice]').value = 'matter_note:note-ira:ar-target-0012'; });
    await shot('13f-record-evidence-choose-target.png');
    await page.evaluate(() => { const modal = document.querySelector('[data-server-form-choice]').closest('lex-modal'); modal.querySelector('[data-server-form-action="submit"]').click(); });
    await page.waitForSelector('[data-field-id="evidence"] .server-form__row', { timeout: 8000 });
    await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop();
      modal.querySelector('[data-field-id="value"]').value = 'contact-rowan';
      const row = modal.querySelector('[data-field-id="evidence"] .server-form__row');
      const [, evidenceClass, coverage] = row.querySelectorAll('lex-select');
      evidenceClass.value = 'institution_acknowledgement'; coverage.value = 'complete';
      row.querySelector('lex-input').value = '2026-10-27T10:00';
      modal.querySelector('[data-field-id="valid_from"]').value = '2026-10-27T10:00';
    });
    await shot('13g-record-observation-from-note.png');
    await closeOverlays();

    await page.evaluate(() => document.getElementById('headerOptionsRunnables').click());
    await page.waitForSelector('[data-runnable="agent:funding-review"]', { timeout: 8000 });
    await shot('12a-agents-skills-drawer-collapsed.png');
    // Collapsed readiness lines come from the view summary; the route is asked only on expand.
    const readinessUi = await page.evaluate(() => ({
      toggles: Array.from(document.querySelectorAll('[data-readiness-toggle]')).map((el) => el.getAttribute('data-readiness-toggle') + '=' + el.textContent.trim()),
      triggers: Array.from(document.querySelectorAll('.matter-runnables__trigger')).map((el) => el.textContent)
    }));
    if (readinessUi.toggles.join('|') !== 'funding-review=3 of 6 ready|maintenance-check=3 of 3 ready') throw new Error('Readiness lines: ' + readinessUi.toggles.join('|'));
    if (readinessUi.triggers.join('|') !== 'Runs daily at 02:00|When a task due date is near') throw new Error('Skill trigger summaries missing: ' + readinessUi.triggers.join('|'));
    if (api.calls.some((call) => call.path.includes('/makeup/readiness'))) throw new Error('Readiness was asked before a line was opened');
    await page.click('[data-readiness-toggle="funding-review"]');
    await page.waitForSelector('[data-runnable="agent:funding-review"] .matter-runnables__check', { timeout: 8000 });
    const checklist = await page.evaluate(() => ({
      progress: document.querySelector('[data-runnable="agent:funding-review"] .matter-runnables__progress-label').textContent,
      checks: Array.from(document.querySelectorAll('[data-runnable="agent:funding-review"] .matter-runnables__check')).map((el) => el.getAttribute('data-check')),
      reasons: Array.from(document.querySelectorAll('[data-runnable="agent:funding-review"] .matter-runnables__check-reason')).map((el) => el.closest('[data-check]').getAttribute('data-check') + '=' + el.textContent)
    }));
    if (checklist.progress !== '3 of 6 ready') throw new Error('Readiness progress: ' + checklist.progress);
    if (checklist.checks[checklist.checks.length - 1] !== 'rulebook.estate') throw new Error('Not checked is not last: ' + checklist.checks.join('|'));
    if (checklist.reasons.join('|') !== 'rulebook.estate=No deployment jurisdiction is set up, so which rulebook applies could not be checked.') throw new Error('Check reasons: ' + checklist.reasons.join('|'));
    await shot('08-agents-skills-readiness.png');
    await shot('12b-agent-readiness-expanded.png');
    await page.click('[data-readiness-toggle="funding-review"]');
    // A person's start while the agent already runs: 409 ACTIVE_RUN_EXISTS.
    await page.evaluate(() => document.querySelector('[data-runnable-start="maintenance-check"]').click());
    await page.waitForSelector('[data-start-status="maintenance-check"] [data-active-run]', { timeout: 8000 });
    await page.waitForSelector('[data-runnable-start="maintenance-check"][disabled]', { timeout: 8000 });
    await page.click('[data-unavailable-toggle]');
    await shot('12c-agent-running-now-and-not-available.png');
    await page.evaluate(() => document.querySelector('[data-runnables-group="skill"]').scrollIntoView({ block: 'end' }));
    await shot('08b-agents-skills-already-running-and-skill-toggles.png');

    // Start follows the server's start offer (start_blocked_reason, active_run).
    const makeupReads = () => api.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/makeup')).length;
    const startState = () => page.evaluate(() => Array.from(document.querySelectorAll('lex-drawer [data-runnable^="agent:"]')).map((row) => {
      const start = row.querySelector('[data-runnable-start]');
      const badge = row.querySelector('[data-start-status] lex-badge');
      return row.getAttribute('data-runnable') + '=' + (start ? (start.disabled ? 'off' : 'on') : 'none') + ':' + (badge ? badge.getAttribute('label') : '');
    }).join('|'));
    const reopenDrawer = async () => {
      await page.evaluate(() => document.querySelectorAll('lex-drawer').forEach((el) => el.dispatchEvent(new CustomEvent('lex-close', { bubbles: true }))));
      await settle(400);
      await page.evaluate(() => document.getElementById('headerOptionsRunnables').click());
      await page.waitForSelector('lex-drawer [data-runnable="agent:funding-review"]', { timeout: 8000 });
      await settle(800);
    };
    await page.evaluate(() => document.querySelector('[data-runnables-group="agent"]').scrollIntoView({ block: 'start' }));
    const readsBeforeStart = makeupReads();
    await page.evaluate(() => document.querySelector('[data-runnable-start="funding-review"]').click());
    await page.waitForSelector('[data-runnable-start="funding-review"][disabled]', { timeout: 8000 });
    await settle(800);
    if (makeupReads() <= readsBeforeStart) throw new Error('The view was not read again after a 202');
    let states = await startState();
    if (states !== 'agent:funding-review=off:Queued|agent:maintenance-check=off:Running now|agent:tax-basis-review=none:') throw new Error('After a 202: ' + states);
    await shot('70-agent-started-queued-start-off.png');
    const posts = () => api.calls.filter((call) => call.method === 'POST' && /\/api\/v1\/agents\/[^/]+\/runs$/.test(call.path)).length;
    const postsBefore = posts();
    await page.evaluate(() => document.querySelector('[data-runnable-start="funding-review"]').click());
    await settle(400);
    if (posts() !== postsBefore) throw new Error('A turned-off Start sent a start');
    await page.hover('[data-runnable-start="maintenance-check"]', { force: true });
    await shot('71-agent-409-running-now-start-off-reason.png');
    // Opened again: the server's view says both runs go, with no press.
    await reopenDrawer();
    states = await startState();
    if (states !== 'agent:funding-review=off:Queued|agent:maintenance-check=off:Running now|agent:tax-basis-review=none:') throw new Error('Reopened: ' + states);
    await shot('72-reopened-server-view-runs-going.png');
    // The funding review run finished: the next view offers Start again (control arm).
    api.endRun('funding-review');
    await reopenDrawer();
    states = await startState();
    if (states !== 'agent:funding-review=on:|agent:maintenance-check=off:Running now|agent:tax-basis-review=none:') throw new Error('After the run ended: ' + states);
    await shot('73-run-ended-start-offered-again.png');

    await page.evaluate(() => { const tabs = document.querySelector('.matter-runnables__tabs'); tabs.active = 'history'; tabs.dispatchEvent(new CustomEvent('tab-change', { bubbles: true, detail: { tab: 'history' } })); });
    await page.waitForSelector('.matter-runnables__run', { timeout: 8000 });
    await shot('09a-run-history-outcomes.png');
    await shot('12d-run-history-tab.png');
    // A started run shows where it is now (state chip, owner status as its detail), when it finished, and its trace for an admin.
    const runUi = await page.evaluate(() => Array.from(document.querySelectorAll('.matter-runnables__run')).map((row) => {
      const chip = row.querySelector('lex-badge[data-run-status]');
      return { name: row.querySelector('.matter-runnables__name').textContent, chip: chip.getAttribute('label'), detail: chip.getAttribute('title'),
        finished: row.querySelector('.matter-runnables__desc').textContent.includes('finished'), trace: (row.querySelector('[data-run-trace]') || { getAttribute: () => null }).getAttribute('data-run-trace') };
    }));
    const runSummary = runUi.map((row) => [row.chip, row.finished ? 'finished' : '-', row.trace ? 'trace' : '-'].join('/')).join('|');
    if (runSummary !== 'Skipped/-/-|Follow-up queued/-/-|Running/-/trace|Failed/finished/-|Skipped/-/-|Completed/finished/trace') throw new Error('Run history rows: ' + JSON.stringify(runUi));
    if (runUi[2].detail !== 'Status: Running.' || runUi[3].detail !== 'Status: Failed.') throw new Error('Run status details: ' + JSON.stringify(runUi));
    await shot('60-run-history-states-and-trace-link.png');
    await page.click('[data-run-why="agent_run:9b7e1d22-4c3f-4e8a-b6d1-0f5a2c8e9d47"]');
    await page.waitForSelector('.matter-runnables__chain', { timeout: 8000 });
    await shot('09b-why-did-this-run-chain.png');
    await page.evaluate(() => { const modal = Array.from(document.querySelectorAll('lex-modal')).pop(); if (modal) modal.removeAfterClose(); });
    await page.waitForFunction(() => !document.querySelector('.matter-runnables__chain'), null, { timeout: 8000 });
    await page.click('[data-run-why="a0c1e2f3-1111-4aaa-8bbb-000000000003"]');
    await page.waitForSelector('.matter-runnables__chain', { timeout: 8000 });
    await shot('09c-why-not-started-refused-row.png');
    await closeOverlays();

    await page.evaluate(() => document.getElementById('headerOptionsMakeup').click());
    await page.waitForFunction(() => { const s = document.querySelector('[data-makeup-select]'); return s && !s.disabled; }, null, { timeout: 8000 });
    await page.evaluate(() => {
      const select = document.querySelector('[data-makeup-select]');
      select.value = 'general-litigation';
      select.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: 'general-litigation' } }));
      document.querySelector('[data-makeup-reason]').value = 'Matter converted to a trust contest after the October 28 meeting.';
    });
    await shot('10-makeup-switch-dialog.png');
    await page.evaluate(() => document.querySelector('[data-makeup-action="save"]').click());
    await page.waitForFunction(() => !document.querySelector('[data-makeup-select]'), null, { timeout: 8000 });
    await page.waitForSelector('#tabBar', { timeout: 8000 });
    await settle(900);
    await shot('10b-makeup-switched-toast.png');
    await closeOverlays();

    // Notes create and edit through the real focus editor (POST and PUT go to the fixture).
    const focusOpen = () => page.waitForFunction(() => document.getElementById('notesFocusModal').open, null, { timeout: 8000 });
    const focusClosed = () => page.waitForFunction(() => !document.getElementById('notesFocusModal').open, null, { timeout: 8000 });
    const pickLabel = async (text) => {
      await page.click('#notesFocusLabelSelect [data-action="toggle"]');
      await page.click(`#notesFocusLabelSelect .lex-select-option:has-text("${text}")`);
    };
    await tab('notes');
    await page.waitForSelector('#notesList [data-note-id]', { timeout: 10000 });
    await page.click('#notesNewBtn');
    await focusOpen();
    await shot('11a-new-note-empty-editor.png');
    await page.click('#notesFocusLabelSelect [data-action="toggle"]');
    await page.waitForSelector('#notesFocusLabelSelect .lex-select-dropdown--open', { timeout: 5000 });
    await shot('11b-new-note-label-picker-open.png');
    await page.click('#notesFocusLabelSelect .lex-select-option:has-text("Fact")');
    await page.fill('#notesFocusTitleInput', 'Roth IRA confirmation letter received');
    await page.click('#notesFocusEditorContainer');
    await page.keyboard.type('Example Brokerage mailed the confirmation letter naming the trust as primary beneficiary of the Roth IRA ****0932. Upload it and cite the retained release.');
    await shot('11c-new-note-filled-before-save.png');
    await page.click('#notesFocusSaveBtn');
    await focusClosed();
    await page.waitForSelector('#notesList [data-note-id^="note-new-"]', { timeout: 8000 });
    await page.evaluate(() => document.getElementById('notesList').scrollTo(0, 0));
    await page.waitForTimeout(200);
    await shot('11d-new-note-saved-in-list.png');
    await waitToastGone();

    await page.click('#notesList [data-note-id="note-question"]');
    await page.waitForFunction(() => document.getElementById('notesViewModal').open);
    await page.click('#notesViewEditBtn');
    await focusOpen();
    await shot('11e-edit-existing-note-with-label-and-links.png');
    await pickLabel('Fact');
    await shot('11f1-edit-label-changed-to-fact.png');
    await page.click('#notesFocusSaveBtn');
    await focusClosed();
    await page.evaluate(() => document.querySelector('#notesList [data-note-id="note-question"]').scrollIntoView({ block: 'center' }));
    await shot('11f2-edit-label-fact-saved.png');
    await waitToastGone();

    await page.click('#notesList [data-note-id="note-question"]');
    await page.waitForFunction(() => document.getElementById('notesViewModal').open);
    await page.click('#notesViewEditBtn');
    await focusOpen();
    await pickLabel('No label');
    await page.click('#notesFocusSaveBtn');
    await focusClosed();
    await page.evaluate(() => document.querySelector('#notesList [data-note-id="note-question"]').scrollIntoView({ block: 'center' }));
    await shot('11g-edit-label-cleared-saved.png');
    const noteWrites = api.calls.filter((call) => call.path.includes('/notes') && (call.method === 'POST' || call.method === 'PUT')).map((call) => ({ method: call.method, path: call.path, body: { ...call.body, content: undefined } }));
    console.log(JSON.stringify({ noteWrites }, null, 2));

    // An agent work proposal on the Approvals detail page: proposed tasks with rule and record chips, labeled summary notes.
    await page.goto(origin + '/approval-detail.html?id=' + api.data.proposalApproval.id);
    await page.waitForSelector('#apdPayloadContent .proposal-outline', { timeout: 20000 });
    // The page loader fades out once the shell is ready.
    await page.waitForFunction(() => !document.querySelector('.lex-loader-visible'), null, { timeout: 15000 });
    await settle(900);
    const proposalUi = await page.evaluate(() => ({
      tasks: document.querySelectorAll('#apdPayloadContent ol.proposal-outline__list > li').length,
      notes: document.querySelectorAll('#apdPayloadContent ul.proposal-outline__list > li').length,
      chips: Array.from(document.querySelectorAll('#apdPayloadContent .proposal-outline__chips lex-badge')).map((el) => el.getAttribute('label'))
    }));
    if (proposalUi.tasks !== 2 || proposalUi.notes !== 2) throw new Error('Proposal outline: ' + JSON.stringify(proposalUi));
    if (!proposalUi.chips.includes('Resolves estate.beneficiary.trust-primary')) throw new Error('Proposal chips: ' + proposalUi.chips.join('|'));
    await page.evaluate(() => document.getElementById('apdPayloadCard').scrollIntoView({ block: 'start' }));
    await shot('14a-approval-detail-work-proposal.png');

    // A proposal whose apply stopped part way: "Apply again", then applied with a link to the tasks.
    await page.goto(origin + '/approval-detail.html?id=' + api.data.failedApproval.id);
    await page.waitForSelector('#apdPayloadContent [data-proposal-apply]', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.lex-loader-visible'), null, { timeout: 15000 });
    await page.evaluate(() => document.getElementById('apdPayloadCard').scrollIntoView({ block: 'start' }));
    await shot('14d-approval-detail-apply-again.png');
    await page.click('#apdPayloadContent [data-proposal-apply]');
    await page.waitForSelector('#apdPayloadContent .proposal-outline__link', { timeout: 8000 });
    const reapply = api.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/artifacts/' + api.data.failedApproval.payload.artifact_id + '/apply'));
    if (reapply.length !== 1) throw new Error('Apply again calls: ' + reapply.length);
    await page.evaluate(() => document.getElementById('apdPayloadCard').scrollIntoView({ block: 'start' }));
    await shot('14e-approval-detail-applied-after-retry.png');

    // Admin Run controls: limits (GET/PUT /api/v1/admin/run-limits) and agent usage (GET /api/v1/agents/usage).
    await page.goto(origin + '/admin/run-controls.html');
    await page.waitForFunction(() => document.getElementById('runLimitsDaily') && document.getElementById('runLimitsDaily').value === '200', null, { timeout: 20000 });
    await page.waitForFunction(() => { const t = document.getElementById('runUsageByAgent'); return t && t.querySelectorAll('tbody tr').length === 3; }, null, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.lex-loader-visible'), null, { timeout: 15000 });
    const limitsUi = await page.evaluate(() => ({ spend: document.getElementById('runLimitsSpend').value, status: document.getElementById('runLimitsStatus').getAttribute('label'),
      cost: document.getElementById('runUsageCost').value, used: document.getElementById('runLimitsUsedToday').textContent, updated: document.getElementById('runLimitsUpdated').textContent }));
    limitsUi.readAt = api.data.runLimits.updated_at;
    if (limitsUi.spend !== '25' || limitsUi.status !== 'Running' || limitsUi.cost !== '$2.68' || limitsUi.used !== '37 of 200 used today' || !limitsUi.updated.endsWith(' by Avery Quill.')) {
      throw new Error('Run controls: ' + JSON.stringify(limitsUi));
    }
    await shot('50-admin-run-controls-limits-and-usage.png');
    await shot('62-admin-run-controls-names-and-used-today.png');
    await page.evaluate(() => document.getElementById('runUsageCard').scrollIntoView({ block: 'start' }));
    const matterLabels = await page.evaluate(() => Array.from(document.querySelectorAll('#runUsageByMatter tbody tr td:first-child')).map((td) => td.textContent.trim()));
    if (matterLabels.join('|') !== 'Fairweather Revocable Trust funding (' + api.data.matter.matter_id + ')|Unnamed matter|No matter') throw new Error('Usage matter labels: ' + matterLabels.join('|'));
    await shot('51-admin-run-controls-usage-breakdowns.png');
    await page.evaluate(() => document.querySelector('#runUsageByMatter').scrollIntoView({ block: 'center' }));
    await shot('66-admin-run-controls-usage-by-matter-labels.png');
    await page.evaluate(() => window.scrollTo(0, 0));
    // Pause: one PUT with only the switch, then the paused state from the answer.
    await page.click('#runLimitsPaused .lex-toggle-track');
    await page.waitForFunction(() => document.getElementById('runLimitsStatus').getAttribute('label') === 'Paused', null, { timeout: 8000 });
    const pausePut = api.calls.filter((call) => call.method === 'PUT' && call.path === '/api/v1/admin/run-limits');
    if (pausePut.length !== 1 || JSON.stringify(pausePut[0].body) !== JSON.stringify({ automatic_runs_paused: true, expected_updated_at: limitsUi.readAt })) throw new Error('Pause PUT: ' + JSON.stringify(pausePut));
    const pausedText = await page.evaluate(() => document.getElementById('runLimitsStatusText').textContent);
    if (!pausedText.endsWith(' by Avery Quill.')) throw new Error('Paused by: ' + pausedText);
    await shot('52-admin-run-controls-paused.png');
    await waitToastGone();
    // A daily limit the server refuses: the model message shows on that field.
    await page.evaluate(() => { document.getElementById('runLimitsDaily').value = '250000'; });
    await page.click('#runLimitsSave');
    await page.waitForFunction(() => document.getElementById('runLimitsDaily').error, null, { timeout: 8000 });
    const fieldError = await page.evaluate(() => document.getElementById('runLimitsDaily').error);
    if (fieldError !== 'Number must be less than or equal to 100000') throw new Error('Daily limit refusal: ' + fieldError);
    if (await page.evaluate(() => document.getElementById('runLimitsDaily').value) !== '250000') throw new Error('The refused value was not kept as typed');
    await shot('53-admin-run-controls-limit-refused-on-field.png');
    // Another admin saves while this page is open: the next save is 409 RUN_LIMITS_STALE. The page shows the current
    // limits, says the change was not saved and what it was, and saves it again on the current limits when asked.
    api.data.otherAdminSaves({ max_automatic_agent_runs_per_day: 80 });
    await page.evaluate(() => { document.getElementById('runLimitsDaily').value = '150'; });
    await page.click('#runLimitsSave');
    await page.waitForSelector('#runLimitsStale:not([hidden])', { timeout: 8000 });
    const staleUi = await page.evaluate(() => ({ daily: document.getElementById('runLimitsDaily').value, mine: document.getElementById('runLimitsStaleMine').textContent,
      text: document.getElementById('runLimitsStaleText').textContent, updated: document.getElementById('runLimitsUpdated').textContent, used: document.getElementById('runLimitsUsedToday').textContent }));
    if (staleUi.daily !== '80' || staleUi.mine !== 'Your change: Automatic agent runs per day: 150.' || !staleUi.text.includes('someone else changed the run limits')
      || !staleUi.updated.endsWith(' by Sam Lee.') || staleUi.used !== '37 of 80 used today') throw new Error('Stale save: ' + JSON.stringify(staleUi));
    await shot('63-admin-run-controls-stale-not-saved.png');
    await page.click('#runLimitsReapply');
    await page.waitForSelector('#runLimitsStale[hidden]', { state: 'attached', timeout: 8000 });
    await page.waitForFunction(() => document.getElementById('runLimitsDaily').value === '150', null, { timeout: 8000 });
    const limitPuts = api.calls.filter((call) => call.method === 'PUT' && call.path === '/api/v1/admin/run-limits').slice(-2).map((call) => call.body);
    if (limitPuts[0].expected_updated_at === limitPuts[1].expected_updated_at || limitPuts[1].max_automatic_agent_runs_per_day !== 150) throw new Error('Re-apply PUTs: ' + JSON.stringify(limitPuts));
    await shot('64-admin-run-controls-change-saved-again.png');
    await waitToastGone();
    // Period: last 7 days asks for that window.
    await page.evaluate(() => { const s = document.getElementById('runUsagePeriod'); s.value = '7'; s.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: '7' } })); });
    await page.waitForFunction(() => document.getElementById('runUsageRuns').value === '19', null, { timeout: 8000 });
    const usageCalls = api.calls.filter((call) => call.path.startsWith('/api/v1/agents/usage'));
    if (usageCalls.length !== 2 || !/since=.+&until=.+/.test(usageCalls[1].path)) throw new Error('Usage calls: ' + usageCalls.map((call) => call.path).join(', '));
    await page.evaluate(() => document.getElementById('runUsageCard').scrollIntoView({ block: 'start' }));
    await shot('54-admin-run-controls-last-7-days.png');

    // A run's trace from run history opens on the Traces page (admin/traces.html?trace_id=).
    await page.goto(origin + '/workspace-details.html?id=' + MATTER_ID);
    await page.waitForFunction(() => window.currentMatterData && document.getElementById('headerOptionsRunnables'), null, { timeout: 20000 });
    await settle(900);
    await page.evaluate(() => document.getElementById('headerOptionsRunnables').click());
    await page.waitForSelector('.matter-runnables__tabs', { timeout: 8000 });
    await page.evaluate(() => { const tabs = document.querySelector('.matter-runnables__tabs'); tabs.active = 'history'; tabs.dispatchEvent(new CustomEvent('tab-change', { bubbles: true, detail: { tab: 'history' } })); });
    await page.waitForSelector('[data-run-trace="' + api.data.traceIds.TRACE_A + '"]', { timeout: 8000 });
    await Promise.all([page.waitForURL((url) => url.pathname.endsWith('/admin/traces.html'), { timeout: 15000 }), page.click('[data-run-trace="' + api.data.traceIds.TRACE_A + '"]')]);
    await page.waitForFunction((id) => { const el = document.getElementById('traceIdDisplay'); return el && el.textContent === 'Trace ID: ' + id; }, api.data.traceIds.TRACE_A, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.lex-loader-visible'), null, { timeout: 15000 });
    const traceView = await page.evaluate(() => ({ detailHidden: document.getElementById('traceDetailView').classList.contains('hidden'), url: location.search }));
    if (traceView.detailHidden || !traceView.url.includes('trace_id=' + api.data.traceIds.TRACE_A)) throw new Error('Trace deep link: ' + JSON.stringify(traceView));
    await shot('61-traces-page-run-trace-deep-link.png');

    const asked = api.calls.filter((call) => call.path.includes('/makeup/readiness')).map((call) => call.path);
    if (asked.length !== 1 || !asked[0].endsWith('?runnable=agent%3Afunding-review')) throw new Error('Readiness calls: ' + asked.join(', '));
    const evidenceOpens = api.calls.filter((call) => call.path.includes('/forms/implementation_assurance.record_observation')).map((call) => decodeURIComponent(call.path.split('subject=')[1] || ''));
    if (evidenceOpens.join('|') !== 'matter_note:note-ira|matter_note:note-ira:ar-target-0012') throw new Error('Evidence form opens: ' + evidenceOpens.join('|'));
    const forbidden = api.calls.filter((call) => call.path.includes('/implementation-assurance/'));
    if (forbidden.length) throw new Error('Calls that must not happen: ' + forbidden.map((call) => call.path).join(', '));
    console.log(JSON.stringify({ outDir, pageErrors: errors, unhandled: Array.from(new Set(api.unhandled)), requests: api.calls.length }, null, 2));
  } catch (error) {
    console.error(error);
    console.log(JSON.stringify({ pageErrors: errors, unhandled: Array.from(new Set(api.unhandled)) }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();

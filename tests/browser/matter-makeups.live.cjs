// Live mode of matter-makeups.screens.cjs: the real renderer against a real,
// isolated LANA backend. Nothing is mocked except the hosted org discovery
// service the login page asks (it answers with this renderer's own origin,
// whose /api is proxied to LIVE_API_URL); every other off-box request is
// blocked and reported.
//   LIVE_API_URL=http://127.0.0.1:59479 LIVE_CREDENTIALS=/path/users.json \
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   SCREENS_DIR=/path/to/out node tests/browser/matter-makeups.screens.cjs
// LIVE_CREDENTIALS: { "admin": { email, password }, "second": { email, password } } for two
// org admins of one organization; keep it outside the repository. LIVE_MATTER is the matter
// code (default MATT-00001). The run writes L*.png and live-results.json to SCREENS_DIR.
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { rendererServer } = require('./renderer-server.cjs');

const API = process.env.LIVE_API_URL.replace(/\/$/, '');
const USERS = JSON.parse(fs.readFileSync(process.env.LIVE_CREDENTIALS, 'utf8'));
const MATTER = process.env.LIVE_MATTER || 'MATT-00001';
const outDir = process.env.SCREENS_DIR || path.join(require('node:os').tmpdir(), 'matter-makeups-live');

// A second session outside the browser (another admin, or the same one elsewhere).
async function apiCall(token, method, pathname, body) {
  const response = await fetch(API + pathname, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (error) { json = text; }
  return { status: response.status, body: json };
}
const dataOf = (body) => (body && body.data) || body;
async function loginToken(user) {
  const answer = await apiCall(null, 'POST', '/api/v1/auth/login', { email: user.email, password: user.password });
  if (answer.status !== 200 || !answer.body.token) throw new Error('login ' + user.email + ': ' + answer.status);
  return answer.body.token;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const server = rendererServer({ outDir, proxyTo: API, withTiptap: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const flows = [];
  const events = [];
  let current = 'setup';
  // Answers a flow causes on purpose (a refusal it drives) are listed with it.
  let expected = [];
  const expect = (status, pattern) => expected.push({ status, pattern });
  const isExpected = (status, url) => expected.some((e) => e.status === status && e.pattern.test(url));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'America/Indiana/Indianapolis' });
    await context.addInitScript(({ origin }) => {
      try {
        if (!localStorage.getItem('lana_saved_server')) localStorage.setItem('lana_saved_server', JSON.stringify({ url: origin, name: 'Live' }));
        localStorage.setItem('lex-theme', 'light');
      } catch (error) { /* storage unavailable */ }
    }, { origin });
    const port = Number(new URL(origin).port);
    await context.route((url) => !/^(127\.0\.0\.1|localhost)$/.test(url.hostname), (route) => {
      const url = route.request().url();
      if (/\/lana-ai\/v1\/discovery$/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'healthy', domain: 'live.test', discovery: { static_ip: '127.0.0.1', port, is_secure_ssl: false },
          server: { org_id: 'live', org_name: 'Live isolated backend', version: 'live', api_version: 'v1' }, enabled_apps: [] }) });
      }
      // Third-party CDN assets are not needed for these surfaces (as in the mocked mode).
      if (/^https:\/\/cdn\.jsdelivr\.net\//.test(url)) return route.fulfill({ status: 200, contentType: url.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
      events.push({ flow: current, kind: 'blocked', url });
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => events.push({ flow: current, kind: 'pageerror', text: error.message }));
    // A refusal a flow drives logs its status to the console too ("status of 409", "status: 409").
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text().slice(0, 400);
      events.push({ flow: current, kind: 'console', text, expected: expected.some((e) => new RegExp('status(?: of|:) ' + e.status + '\\b').test(text)) });
    });
    page.on('response', (response) => {
      const status = response.status();
      if (status >= 400) events.push({ flow: current, kind: 'http', status, method: response.request().method(), url: response.url().replace(origin, ''), expected: isExpected(status, response.url()) });
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure() && request.failure().errorText;
      // A navigation cancels the previous page's in-flight reads; that is not a failed call.
      if (failure !== 'net::ERR_ABORTED') events.push({ flow: current, kind: 'requestfailed', url: request.url().replace(origin, ''), text: failure });
    });

    const settle = (ms = 700) => page.waitForTimeout(ms);
    let shotNo = 0;
    const shot = async (name) => { await settle(); shotNo += 1; const file = 'L' + String(shotNo).padStart(2, '0') + '-' + name + '.png'; await page.screenshot({ path: path.join(outDir, file) }); flows[flows.length - 1].shots.push(file); return file; };
    const flow = async (name, fn) => {
      current = name; expected = [];
      const entry = { name, ok: false, shots: [], notes: [] };
      flows.push(entry);
      try { await fn(entry); entry.ok = true; } catch (error) { entry.error = String(error && error.message || error).slice(0, 600); try { await shot('failed'); } catch (e) { /* page gone */ } }
      entry.expectedCalls = expected.map((e) => e.status + ' ' + e.pattern);
      console.log((entry.ok ? 'PASS ' : 'FAIL ') + name + (entry.error ? ': ' + entry.error : ''));
    };
    const tab = async (id) => { await page.evaluate((id) => { const bar = document.getElementById('tabBar'); bar.setAttribute('active', id); bar.dispatchEvent(new CustomEvent('tab-change', { bubbles: true, detail: { tab: id } })); }, id); await settle(1500); };
    const openModal = () => page.waitForFunction(() => Array.from(document.querySelectorAll('lex-modal')).some((el) => el.open), null, { timeout: 10000 });
    const closeOverlays = async () => { await page.keyboard.press('Escape'); await settle(300); await page.evaluate(() => document.querySelectorAll('lex-modal[open], lex-drawer[open]').forEach((el) => { el.open = false; })); await settle(300); };
    const waitToastGone = () => page.waitForFunction(() => !document.querySelector('.lex-toast'), null, { timeout: 12000 }).catch(() => {});
    const openMatter = async () => {
      await page.goto(origin + '/workspace-details.html?id=' + encodeURIComponent(MATTER));
      await page.waitForFunction(() => window.currentMatterData && document.getElementById('tabBar') && document.getElementById('tabBar').tabs && document.getElementById('tabBar').tabs.length > 0, null, { timeout: 30000 });
      await settle(1500);
    };
    const tabIds = () => page.evaluate(() => document.getElementById('tabBar').tabs.map((t) => t.id));
    const openRunnables = async () => {
      await page.evaluate(() => document.getElementById('headerOptionsRunnables').click());
      await page.waitForSelector('.matter-runnables__tabs', { timeout: 10000 });
      await settle(1200);
    };
    const fillModal = (values) => page.evaluate((values) => {
      const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop();
      Object.keys(values).forEach((id) => {
        const el = modal.querySelector('[data-field-id="' + id + '"]');
        if (!el) throw new Error('no field ' + id);
        if (el.tagName === 'LEX-CHECKBOX') el.checked = values[id]; else el.value = values[id];
      });
    }, values);
    const modalText = () => page.evaluate(() => { const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop(); return modal ? modal.textContent.replace(/\s+/g, ' ').trim() : ''; });
    const pressModalButton = (label) => page.evaluate((label) => {
      const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop();
      const button = Array.from(modal.querySelectorAll('lex-btn')).find((el) => el.textContent.trim() === label);
      if (!button) throw new Error('no button ' + label + ' in ' + Array.from(modal.querySelectorAll('lex-btn')).map((el) => el.textContent.trim()).join('|'));
      button.click();
    }, label);

    const adminToken = await loginToken(USERS.admin);
    const secondToken = await loginToken(USERS.second);

    await flow('login through the real login page', async () => {
      await page.goto(origin + '/login.html');
      await page.fill('#orgId', 'live');
      await page.click('#connectBtn');
      await page.waitForSelector('#step2:not(.hidden)', { timeout: 15000 });
      await page.fill('#email', USERS.admin.email);
      await page.fill('#password', '************');
      await shot('login');
      await page.fill('#password', USERS.admin.password);
      await Promise.all([page.waitForURL((url) => !url.pathname.endsWith('/login.html'), { timeout: 30000 }), page.click('#submitBtn')]);
      // The landing page loads the profile (roles) into the stored user; admin pages and admin links read it.
      await page.waitForFunction(() => { try { const u = JSON.parse(localStorage.getItem('user') || 'null'); return u && Array.isArray(u.roles) && u.roles.length > 0; } catch (e) { return false; } }, null, { timeout: 30000 });
    });

    await flow('matter details with makeup tabs', async (entry) => {
      await openMatter();
      const ids = await tabIds();
      entry.notes.push('tabs: ' + ids.join(', '));
      ['notes', 'tasks', 'rulebook', 'assets', 'decisions'].forEach((id) => { if (!ids.includes(id)) throw new Error('missing tab ' + id); });
      await shot('matter-summary-makeup-tabs');
    });

    await flow('readiness for an agent', async (entry) => {
      await openRunnables();
      const toggle = await page.evaluate(() => { const el = document.querySelector('[data-readiness-toggle]'); return el && el.getAttribute('data-readiness-toggle'); });
      if (!toggle) throw new Error('no readiness line');
      await page.click('[data-readiness-toggle="' + toggle + '"]');
      await page.waitForSelector('[data-runnable="agent:' + toggle + '"] .matter-runnables__check', { timeout: 10000 });
      const checks = await page.evaluate((key) => Array.from(document.querySelectorAll('[data-runnable="agent:' + key + '"] .matter-runnables__check')).map((el) => el.getAttribute('data-check')), toggle);
      entry.notes.push(toggle + ': ' + checks.join(', '));
      await shot('agent-readiness-expanded');
      await closeOverlays();
    });

    await flow('switching a makeup and back', async (entry) => {
      const before = await tabIds();
      const pick = async (reason, choose) => {
        await page.evaluate(() => document.getElementById('headerOptionsMakeup').click());
        await page.waitForFunction(() => { const s = document.querySelector('[data-makeup-select]'); return s && !s.disabled && s.options && s.options.length > 0; }, null, { timeout: 10000 });
        const chosen = await page.evaluate(({ reason, choose }) => {
          const select = document.querySelector('[data-makeup-select]');
          const options = select.options.filter((o) => !o.disabled);
          const option = choose === 'other' ? options.find((o) => o.value !== select.value) : options.find((o) => o.value === choose);
          select.value = option.value;
          select.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: option.value } }));
          document.querySelector('[data-makeup-reason]').value = reason;
          return { from: document.querySelector('[data-makeup-current]').textContent, to: option.value, options: options.map((o) => o.value) };
        }, { reason, choose });
        return chosen;
      };
      const there = await pick('Live harness: the matter became general work for the afternoon.', 'other');
      entry.notes.push('switch to ' + there.to + ' (' + there.options.join(', ') + '); ' + there.from);
      await shot('makeup-switch-dialog');
      await page.evaluate(() => document.querySelector('[data-makeup-action="save"]').click());
      await page.waitForFunction(() => !document.querySelector('[data-makeup-select]'), null, { timeout: 10000 });
      await settle(1500);
      const after = await tabIds();
      entry.notes.push('tabs after: ' + after.join(', '));
      if (after.join() === before.join()) throw new Error('tabs did not change');
      await shot('makeup-switched');
      await waitToastGone();
      // Back to the estate makeup for the flows that follow.
      const current = await page.evaluate(() => window.currentMatterData && window.currentMatterData.makeup);
      void current;
      const back = await pick('Live harness: back to estate work.', 'other');
      entry.notes.push('switch back to ' + back.to);
      await page.evaluate(() => document.querySelector('[data-makeup-action="save"]').click());
      await page.waitForFunction(() => !document.querySelector('[data-makeup-select]'), null, { timeout: 10000 });
      await settle(1500);
      if ((await tabIds()).join() !== before.join()) throw new Error('tabs not restored: ' + (await tabIds()).join(', '));
      await waitToastGone();
    });

    const NOTE_TITLE = 'Live harness: brokerage letter received ' + Date.now();
    await flow('notes create and edit with fact labels', async (entry) => {
      const focusOpen = () => page.waitForFunction(() => document.getElementById('notesFocusModal').open, null, { timeout: 10000 });
      const focusClosed = () => page.waitForFunction(() => !document.getElementById('notesFocusModal').open, null, { timeout: 10000 });
      await tab('notes');
      await page.click('#notesNewBtn');
      await focusOpen();
      await page.click('#notesFocusLabelSelect [data-action="toggle"]');
      await page.waitForSelector('#notesFocusLabelSelect .lex-select-dropdown--open', { timeout: 5000 });
      entry.notes.push('labels: ' + (await page.evaluate(() => Array.from(document.querySelectorAll('#notesFocusLabelSelect .lex-select-option')).map((el) => el.textContent.trim()).join(', '))));
      await page.click('#notesFocusLabelSelect .lex-select-option:has-text("Open question")');
      await page.fill('#notesFocusTitleInput', NOTE_TITLE);
      await page.click('#notesFocusEditorContainer');
      await page.keyboard.type('The brokerage says the confirmation letter names the trust as primary beneficiary. Waiting on the copy.');
      await shot('note-new-filled');
      await page.click('#notesFocusSaveBtn');
      await focusClosed();
      await page.waitForFunction((title) => Array.from(document.querySelectorAll('#notesList [data-note-id]')).some((el) => el.textContent.includes(title)), NOTE_TITLE, { timeout: 10000 });
      await shot('note-saved-in-list');
      await waitToastGone();
      const noteId = await page.evaluate((title) => Array.from(document.querySelectorAll('#notesList [data-note-id]')).find((el) => el.textContent.includes(title)).getAttribute('data-note-id'), NOTE_TITLE);
      entry.notes.push('note ' + noteId);
      await page.click('#notesList [data-note-id="' + noteId + '"]');
      await page.waitForFunction(() => document.getElementById('notesViewModal').open, null, { timeout: 10000 });
      await page.click('#notesViewEditBtn');
      await focusOpen();
      await page.click('#notesFocusLabelSelect [data-action="toggle"]');
      await page.click('#notesFocusLabelSelect .lex-select-option:has-text("Fact")');
      await shot('note-edit-label-fact');
      await page.click('#notesFocusSaveBtn');
      await focusClosed();
      await settle(1200);
      const saved = await apiCall(adminToken, 'GET', '/api/v1/matters/' + encodeURIComponent(MATTER) + '/notes/' + noteId);
      const note = dataOf(saved.body) || {};
      const label = (note.note || note).label;
      entry.notes.push('server label after edit: ' + label + ' (' + saved.status + ')');
      if (label !== 'fact') throw new Error('label not saved as fact: ' + JSON.stringify(saved.body).slice(0, 300));
      await page.evaluate((id) => document.querySelector('#notesList [data-note-id="' + id + '"]').scrollIntoView({ block: 'center' }), noteId);
      await shot('note-fact-saved');
      await waitToastGone();
      entry.noteId = noteId;
    });

    await flow('a link with a starter rule pin', async (entry) => {
      const noteId = flows.find((f) => f.noteId) && flows.find((f) => f.noteId).noteId;
      if (!noteId) throw new Error('no note from the notes flow');
      await page.click('#notesList [data-note-id="' + noteId + '"]');
      await page.waitForFunction(() => document.getElementById('notesViewModal').open, null, { timeout: 10000 });
      await page.evaluate(() => { const menu = document.getElementById('notesViewAddLink'); (menu.querySelector('button') || menu).click(); });
      await page.click('.lex-ddbtn-item[data-value="rulebook_rule"]');
      await page.waitForFunction(() => { const s = document.querySelector('[data-link-picker-value]'); return s && s.options && s.options.length > 1; }, null, { timeout: 15000 });
      const choice = await page.evaluate(() => { const s = document.querySelector('[data-link-picker-value]'); const o = s.options.find((x) => x.value) || s.options[1]; s.value = o.value; s.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: o.value } })); return o.label; });
      entry.notes.push('rule: ' + choice);
      await shot('link-rule-picker');
      await page.evaluate(() => { const modal = document.querySelector('[data-link-picker-value]').closest('lex-modal'); modal.querySelector('[data-action="save-link"]').click(); });
      await page.waitForFunction(() => !document.querySelector('[data-link-picker-value]'), null, { timeout: 10000 });
      await settle(1200);
      const links = await apiCall(adminToken, 'GET', '/api/v1/matters/' + encodeURIComponent(MATTER) + '/links?source=matter_note:' + noteId);
      const rows = (dataOf(links.body) || {}).links || [];
      const rule = Array.isArray(rows) ? rows.find((l) => l.target && l.target.kind === 'rulebook_rule') : null;
      entry.notes.push('server target: ' + JSON.stringify(rule && rule.target));
      if (!rule || rule.target.rulebook_basis !== 'starter' || !rule.target.starter_sha256) throw new Error('no starter pin: ' + JSON.stringify(links.body).slice(0, 400));
      await page.click('#notesList [data-note-id="' + noteId + '"]').catch(() => {});
      await page.waitForFunction(() => document.getElementById('notesViewModal').open, null, { timeout: 10000 }).catch(() => {});
      await shot('note-with-rule-link');
      await closeOverlays();
      await waitToastGone();
    });

    await flow('server form (adoption) submit and its FORM_STALE path', async (entry) => {
      await tab('rulebook');
      const openAdopt = async () => {
        await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.matter-generic-tab--rulebook lex-btn')).find((el) => el.textContent.trim() === 'Adopt rulebook'); if (!b) throw new Error('no Adopt rulebook'); b.click(); });
        await page.waitForSelector('.server-form__context, [data-field-id]', { timeout: 10000 });
        await settle(800);
      };
      const choose = () => page.evaluate(() => {
        const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop();
        const select = modal.querySelector('[data-field-id="jurisdiction"]');
        const options = (select.options || []).filter((o) => o.value && !o.disabled);
        if (!options.length) throw new Error('no state left to adopt');
        select.value = options[0].value;
        select.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: options[0].value } }));
        return options.map((o) => o.value);
      });
      await openAdopt();
      const states = await choose();
      entry.notes.push('open states: ' + states.slice(0, 6).join(', ') + (states.length > 6 ? ' ...' : ''));
      await fillModal({ rationale: 'Live harness: the firm adopts the starter for this state as its standard.', confirm: true });
      await shot('adopt-form-filled');
      // Another session adopts a different state while this form is open: the binding moves.
      const form = '/api/v1/matters/' + encodeURIComponent(MATTER) + '/forms/implementation_assurance.adopt_rulebook';
      const subject = 'matter:' + (await page.evaluate(() => window.currentMatterData.matter.matter_id));
      const described = { body: dataOf((await apiCall(adminToken, 'GET', form + '?subject=' + encodeURIComponent(subject))).body) };
      const other = described.body.fields[0].options.filter((o) => o.value && !o.disabled).map((o) => o.value).find((v) => v !== states[0]);
      const concurrent = await apiCall(adminToken, 'POST', form, { request_id: require('node:crypto').randomUUID(), subject, binding: described.body.binding,
        values: { jurisdiction: other, rationale: 'Live harness: another session adopts first.', confirm: true } });
      entry.notes.push('concurrent adoption of ' + other + ': ' + concurrent.status);
      if (concurrent.status !== 201) throw new Error('concurrent adoption: ' + JSON.stringify(concurrent.body).slice(0, 300));
      expect(409, /\/forms\/implementation_assurance\.adopt_rulebook$/);
      await pressModalButton(await page.evaluate(() => { const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop(); return Array.from(modal.querySelectorAll('lex-btn[data-slot="footer"], [data-slot="footer"] lex-btn')).map((el) => el.textContent.trim()).filter((t) => t && t !== 'Cancel').pop(); }));
      await page.waitForFunction(() => { const n = document.querySelector('[data-server-form-notice]'); return n && !n.hidden && n.textContent.trim(); }, null, { timeout: 10000 });
      entry.notes.push('stale notice: ' + (await page.evaluate(() => document.querySelector('[data-server-form-notice]').textContent.trim())));
      await shot('adopt-form-stale');
      entry.notes.push('stale modal: ' + (await modalText()).slice(0, 300));
      await closeOverlays();
      await settle(1000);
      // Opened again on the current record: submits and records.
      await openAdopt();
      const again = await choose();
      if (again.includes(other)) throw new Error('the concurrently adopted state is still offered');
      await fillModal({ rationale: 'Live harness: the firm adopts the starter for this state as its standard.', confirm: true });
      await pressModalButton(await page.evaluate(() => { const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop(); return Array.from(modal.querySelectorAll('lex-btn[data-slot="footer"], [data-slot="footer"] lex-btn')).map((el) => el.textContent.trim()).filter((t) => t && t !== 'Cancel').pop(); }));
      await page.waitForFunction(() => { const n = document.querySelector('[data-server-form-notice]'); return n && !n.hidden && /adopted/i.test(n.textContent); }, null, { timeout: 15000 });
      entry.notes.push('recorded notice: ' + (await page.evaluate(() => document.querySelector('[data-server-form-notice]').textContent.trim())));
      await shot('adopt-recorded');
      await closeOverlays();
      await waitToastGone();
    });

    await flow('a task with a form action', async (entry) => {
      await tab('tasks');
      await page.waitForSelector('[data-task-actions-for]:not([hidden])', { timeout: 15000 });
      const actions = await page.evaluate(() => Array.from(document.querySelectorAll('[data-task-actions-for] [data-task-action-id]')).map((el) => el.closest('[data-task-actions-for]').getAttribute('data-task-actions-for') + ':' + el.textContent.trim()));
      entry.notes.push('actions: ' + actions.join(', '));
      await shot('board-task-actions');
      await page.click('[data-task-actions-for] [data-task-action-id]');
      await openModal();
      // Fields, or the empty state a required choice with nothing to choose shows (no retained plan versions here).
      await page.waitForFunction(() => { const modal = Array.from(document.querySelectorAll('lex-modal')).filter((el) => el.open).pop(); return modal && modal.querySelector('[data-field-id], lex-empty'); }, null, { timeout: 10000 });
      entry.notes.push('form: ' + (await modalText()).slice(0, 200));
      await shot('task-action-form');
      await closeOverlays();
    });

    let startedRun = null;
    let history = [];
    await flow('agents for this matter: start an agent (stops at the queue)', async (entry) => {
      await openRunnables();
      const starts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-runnable-start]')).map((el) => el.getAttribute('data-runnable-start') + (el.hasAttribute('disabled') ? '(disabled)' : '')));
      entry.notes.push('start buttons: ' + starts.join(', '));
      // An agent with no run waiting on this matter (the smoke leaves one queued).
      history = dataOf((await apiCall(adminToken, 'GET', '/api/v1/matters/' + encodeURIComponent(MATTER) + '/activity/runs?limit=100')).body).runs || [];
      const active = new Set(history.filter((r) => r.run && r.run.state === 'active').map((r) => r.runnable_key));
      entry.notes.push('agents with a run waiting: ' + Array.from(active).join(', '));
      const target = starts.filter((s) => !s.endsWith('(disabled)')).find((s) => !active.has(s));
      if (!target) throw new Error('no agent free to start');
      await page.evaluate((key) => document.querySelector('[data-runnable-start="' + key + '"]').click(), target);
      await page.waitForSelector('[data-start-status="' + target + '"]', { timeout: 15000 });
      await settle(1200);
      entry.notes.push('status: ' + (await page.evaluate((key) => document.querySelector('[data-start-status="' + key + '"]').textContent.trim(), target)));
      await shot('agent-started-queued');
      const rows = dataOf((await apiCall(adminToken, 'GET', '/api/v1/matters/' + encodeURIComponent(MATTER) + '/activity/runs?limit=5')).body).runs || [];
      startedRun = rows.find((r) => r.runnable_key === target) || null;
      entry.notes.push('latest row: ' + JSON.stringify(startedRun && { outcome: startedRun.outcome, run: startedRun.run, trace_id: startedRun.trace_id }));
      if (!startedRun || startedRun.outcome !== 'started' || !startedRun.run || startedRun.run.state !== 'active') throw new Error('the start did not record an active run');
      // While the run waits the server's view names it (start_blocked_reason
      // active_run): Start is turned off, so a second press sends nothing.
      const again = await page.evaluate((key) => { const el = document.querySelector('[data-runnable-start="' + key + '"]'); if (el.hasAttribute('disabled')) return 'disabled'; el.click(); return 'pressed'; }, target);
      await settle(1500);
      entry.notes.push('second press: ' + again + '; ' + (await page.evaluate((key) => (document.querySelector('[data-start-status="' + key + '"]') || {}).textContent || '', target)).trim());
      if (again !== 'disabled') throw new Error('Start stayed pressable while the run waits');
      await shot('agent-already-active');
    });

    await flow('run history rows with state and the trace link', async (entry) => {
      await page.evaluate(() => { const tabs = document.querySelector('.matter-runnables__tabs'); tabs.active = 'history'; tabs.dispatchEvent(new CustomEvent('tab-change', { bubbles: true, detail: { tab: 'history' } })); });
      await page.waitForSelector('.matter-runnables__run', { timeout: 10000 });
      await settle(1000);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.matter-runnables__run')).slice(0, 8).map((row) => {
        const chip = row.querySelector('lex-badge[data-run-status]') || row.querySelector('lex-badge');
        return (row.querySelector('.matter-runnables__name') || row).textContent.trim().slice(0, 40) + ' [' + (chip ? chip.getAttribute('label') : '-') + ']' + (row.querySelector('[data-run-trace]') ? ' trace' : '');
      }));
      entry.notes.push('rows: ' + rows.join(' | '));
      await shot('run-history');
      let trace = await page.evaluate(() => { const el = document.querySelector('[data-run-trace]'); return el && el.getAttribute('data-run-trace'); });
      if (trace) {
        await Promise.all([page.waitForURL((url) => url.pathname.endsWith('/admin/traces.html'), { timeout: 15000 }), page.click('[data-run-trace="' + trace + '"]')]);
      } else {
        // A row links its run's own trace (execution_trace_id), which only an executed run has; with
        // AGENTS_WORKER_EMBEDDED=false no run executes. Open the start's request trace by the same deep link.
        history = dataOf((await apiCall(adminToken, 'GET', '/api/v1/matters/' + encodeURIComponent(MATTER) + '/activity/runs?limit=100')).body).runs || [];
        const withTrace = history.find((r) => r.run && r.run.execution_trace_id);
        if (withTrace) throw new Error('a run has an execution trace but its row shows no link');
        trace = startedRun && startedRun.trace_id;
        if (!trace) throw new Error('no trace to open');
        entry.notes.push('no row has an execution trace (no run executed); opened the start request trace ' + trace + ' by ?trace_id=');
        entry.partial = 'run history trace link not reachable: no run executes in this env';
        await page.goto(origin + '/admin/traces.html?trace_id=' + trace);
      }
      await page.waitForFunction((id) => { const el = document.getElementById('traceIdDisplay'); return el && el.textContent === 'Trace ID: ' + id; }, trace, { timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('.lex-loader-visible'), null, { timeout: 15000 });
      entry.notes.push('trace ' + trace + ' route ' + (await page.evaluate(() => document.getElementById('detailChatMode').textContent)));
      await shot('traces-page-run-trace');
    });

    await flow('Operations filter on the Traces page shows the write traces', async (entry) => {
      await page.goto(origin + '/admin/traces.html');
      await page.waitForFunction(() => { const t = document.getElementById('tracesTable'); return t && t.dataSource; }, null, { timeout: 20000 });
      await page.waitForFunction(() => !document.querySelector('.lex-loader-visible'), null, { timeout: 15000 });
      await page.evaluate(() => document.getElementById('tracesTable').addFilter('chat_mode', 'in', ['operations']));
      await settle(2500);
      const routes = await page.evaluate(() => Array.from(document.querySelectorAll('#tracesTable tbody tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)));
      entry.notes.push(routes.length + ' rows; first: ' + routes.slice(0, 3).join(' | '));
      if (!routes.length || !routes.every((r) => r.includes('Operations'))) throw new Error('rows are not operations traces');
      await shot('traces-operations-filter');
    });

    await flow('admin Run controls: pause, limit save, stale save, usage by matter', async (entry) => {
      await page.goto(origin + '/admin/run-controls.html');
      await page.waitForFunction(() => { const d = document.getElementById('runLimitsDaily'); return d && d.value !== '' && !document.querySelector('.lex-loader-visible'); }, null, { timeout: 20000 });
      await settle(1500);
      const state = () => page.evaluate(() => ({ daily: document.getElementById('runLimitsDaily').value, status: document.getElementById('runLimitsStatus').getAttribute('label'),
        statusText: document.getElementById('runLimitsStatusText').textContent, used: document.getElementById('runLimitsUsedToday').textContent, updated: document.getElementById('runLimitsUpdated').textContent }));
      entry.notes.push('loaded: ' + JSON.stringify(await state()));
      await shot('run-controls-loaded');
      const wasPaused = (await state()).status === 'Paused';
      await page.click('#runLimitsPaused .lex-toggle-track');
      await page.waitForFunction((was) => document.getElementById('runLimitsStatus').getAttribute('label') === (was ? 'Running' : 'Paused'), wasPaused, { timeout: 10000 });
      if (wasPaused) { await waitToastGone(); await page.click('#runLimitsPaused .lex-toggle-track'); await page.waitForFunction(() => document.getElementById('runLimitsStatus').getAttribute('label') === 'Paused', null, { timeout: 10000 }); }
      entry.notes.push('paused: ' + (await state()).statusText);
      await shot('run-controls-paused');
      await waitToastGone();
      const daily = String(Number((await state()).daily) + 7);
      await page.evaluate((v) => { document.getElementById('runLimitsDaily').value = v; }, daily);
      await page.click('#runLimitsSave');
      await page.waitForFunction((v) => document.querySelector('.lex-toast') && document.getElementById('runLimitsDaily').value === v, daily, { timeout: 10000 });
      const limits = dataOf((await apiCall(secondToken, 'GET', '/api/v1/admin/run-limits')).body).limits;
      entry.notes.push('saved daily ' + daily + '; server ' + limits.max_automatic_agent_runs_per_day);
      if (String(limits.max_automatic_agent_runs_per_day) !== daily) throw new Error('limit not stored');
      await shot('run-controls-limit-saved');
      await waitToastGone();
      // The second admin saves from another session while this page is open.
      const other = await apiCall(secondToken, 'PUT', '/api/v1/admin/run-limits', { max_automatic_agent_runs_per_day: 42, expected_updated_at: limits.updated_at });
      entry.notes.push('second session PUT: ' + other.status);
      if (other.status !== 200) throw new Error('second session save: ' + JSON.stringify(other.body).slice(0, 300));
      expect(409, /\/api\/v1\/admin\/run-limits$/);
      await page.evaluate(() => { document.getElementById('runLimitsDaily').value = '150'; });
      await page.click('#runLimitsSave');
      await page.waitForSelector('#runLimitsStale:not([hidden])', { timeout: 10000 });
      const stale = await page.evaluate(() => ({ daily: document.getElementById('runLimitsDaily').value, mine: document.getElementById('runLimitsStaleMine').textContent, updated: document.getElementById('runLimitsUpdated').textContent }));
      entry.notes.push('stale: ' + JSON.stringify(stale));
      if (stale.daily !== '42') throw new Error('stale did not redraw the current limits');
      await shot('run-controls-stale-not-saved');
      await page.click('#runLimitsReapply');
      await page.waitForSelector('#runLimitsStale[hidden]', { state: 'attached', timeout: 10000 });
      await page.waitForFunction(() => document.getElementById('runLimitsDaily').value === '150', null, { timeout: 10000 });
      await shot('run-controls-saved-again');
      await waitToastGone();
      await page.evaluate(() => document.getElementById('runUsageCard').scrollIntoView({ block: 'start' }));
      await settle(800);
      const matters = await page.evaluate(() => Array.from(document.querySelectorAll('#runUsageByMatter tbody tr td:first-child')).map((td) => td.textContent.trim()));
      const agents = await page.evaluate(() => Array.from(document.querySelectorAll('#runUsageByAgent tbody tr td:first-child')).map((td) => td.textContent.trim()));
      entry.notes.push('usage by matter: ' + matters.join(' | ') + '; by agent: ' + agents.join(' | '));
      if (!matters.some((label) => /\([A-Z]+-\d+\)$/.test(label))) throw new Error('no matter label with a code');
      await shot('run-controls-usage-by-matter');
      // Leave the runs running for whoever uses this backend next.
      const n = dataOf((await apiCall(adminToken, 'GET', '/api/v1/admin/run-limits')).body).limits;
      if (n.automatic_runs_paused) await apiCall(adminToken, 'PUT', '/api/v1/admin/run-limits', { automatic_runs_paused: false, expected_updated_at: n.updated_at });
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    const unexpected = events.filter((e) => !e.expected);
    fs.writeFileSync(path.join(outDir, 'live-results.json'), JSON.stringify({ api: API, matter: MATTER, flows, events, unexpected }, null, 2));
    console.log(JSON.stringify({ outDir, passed: flows.filter((f) => f.ok).length, failed: flows.filter((f) => !f.ok).map((f) => f.name), unexpected: unexpected.length }, null, 2));
    if (flows.some((f) => !f.ok)) process.exitCode = 1;
    await browser.close();
    server.close();
  }
})();

'use strict';

// Matters list escaping click-through (src/workspaces.html, src/js/workspace.js).
//
// Seeds one matter whose names, ids and text carry quotes, apostrophes, <b>,
// & and an <img onerror> payload, then clicks through the matters list (table
// row, row menu, pin and the pinned card), the grid card (select, bulk bar,
// pin), opening the matter on workspace-details.html, an old matters.html link
// and the two search modals. Every step must show the payload as literal text:
// no rendered tags, no double-escaped entities such as &amp;quot; on screen,
// no console errors, no handler failures, and window.__pwned never set.
//
// Handlers: markup built by the matters scripts names actions through
// js/shared/dom-actions.js (data-on-click plus JSON arguments), never inline
// on*="" attributes, which the desktop app's CSP blocks. Every check below
// also fails on an inline handler in the rendered DOM, on an action that is
// not registered, and on a CSP violation when the client is served with the
// app's policy.
//
// Run it only against a disposable backend and organization. It creates
// matters, comments, tasks, contacts and links, and pins and unpins a matter.
//
// Setup:
//   1. A scratch Chef backend with an empty test organization and an org admin.
//   2. The client src/ served over HTTP, with /api proxied to that backend on
//      the same origin (Electron loads ../src/ paths, so map /src/* to src/*),
//      and built css/tailwind-output.css and js/tiptap-bundle-built.js.
//   3. Environment:
//        LANA_E2E_CLIENT_URL=http://127.0.0.1:<client port>
//        LANA_E2E_USE_CLIENT_PROXY=1
//        LANA_E2E_API_URL=http://127.0.0.1:<backend port>
//        LANA_E2E_EMAIL=... LANA_E2E_PASSWORD=...   (or LANA_E2E_TOKEN)
//      Optional:
//        LANA_E2E_ESCAPE_MATTER_ID  use a matter already seeded with the
//                                   PAYLOAD values below instead of seeding
//        LANA_E2E_ESCAPE_SHOTS      folder for light-mode screenshots
//        LANA_E2E_CHROMIUM_PATH     Chromium executable for this run
//   4. npx playwright test tests/playwright/matters-escaping.spec.js --reporter=list
//
// The old matters.html (and its matter drawer) is retired. The matter's own
// tabs (documents, comments, tasks, contacts, activity) live on
// workspace-details.html.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { authenticate, apiJson, installBrowserAuth, API_BASE_URL } = require('./helpers/agents-harness');

// Contact emails are unique per organization, so a seeding run tags them.
const RUN_TAG = process.env.LANA_E2E_ESCAPE_MATTER_ID ? '' : `.${Date.now().toString(36)}`;

const PAYLOAD = Object.freeze({
  matterName: `O'Brien "Trust" <b>& Co</b>`,
  clientName: `Siobhan O'Brien "Shiv" <i>&</i>`,
  description: `Desc with "quotes", it's <b>bold</b> & <img src=x onerror="window.__pwned=1">`,
  linkedMatterName: `Rivera "Estate" & Sons' <i>Plan</i>`,
  workspaceName: `Harbor "Intake" & O'Neil's <b>WS</b>`,
  docName: `O'Brien "draft" <1>.docx`,
  comment1: `say "hi" & <b>bold</b> it's <img src=x onerror="window.__pwned=1">`,
  task1: `Draft "pour-over" will for O'Brien <b>now</b>`,
  task1Description: `Check the <i>trust</i> & "schedule A", it's due`,
  task2: `Review O'Brien's "funding" memo & <script>window.__pwned=1</script>`,
  contactFirst: `Siobhan "Shiv"`,
  contactLast: `O'Brien <b>&</b>`,
  contactCompany: `O'Brien "Holdings" & Co`,
  contactEmail: `shiv.o'brien${RUN_TAG}@harbor.test`,
  contactPhone: `+1 (555) 010-'22' "x"`,
  otherContactFirst: `Tom "Tiger"`,
  otherContactLast: `O'Toole <b>&</b>`,
  otherContactEmail: `tom.o'toole${RUN_TAG}@harbor.test`,
  conversationTitle: `Talk about O'Brien's "trust" <b>terms</b> & taxes`,
});

// Text of b/i/u/script elements a payload would create if it rendered as HTML.
const INJECTED_TAG_TEXTS = ['& Co', 'bold', '&', 'now', 'trust', 'ready', 'Plan', 'terms', 'related', 'WS'];
const DOUBLE_ESCAPED = /&(amp|quot|lt|gt|apos|#0*39|#x0*27);/i;

const SHOTS = process.env.LANA_E2E_ESCAPE_SHOTS || '';
if (process.env.LANA_E2E_CHROMIUM_PATH) {
  test.use({ launchOptions: { executablePath: process.env.LANA_E2E_CHROMIUM_PATH } });
}
test.use({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light', actionTimeout: 15000 });

async function seed(request, auth) {
  const post = (p, body) => apiJson(request, auth, 'POST', p, body);
  const created = await post('/api/v1/matters', {
    name: PAYLOAD.matterName, client_name: PAYLOAD.clientName, description: PAYLOAD.description,
    matter_type: 'matter', visibility: 'organization',
  });
  const matterId = created.matter.matter_id;
  const other = await post('/api/v1/matters', {
    name: PAYLOAD.linkedMatterName, client_name: 'Ana Rivera', description: 'Linked matter', matter_type: 'matter', visibility: 'organization',
  });
  await post('/api/v1/entity-links', { source_matter_id: matterId, target_matter_id: other.matter.matter_id, link_type: 'related_to' });
  // The drawer lists workspace, parent and child links (related links are hidden).
  const workspace = await post('/api/v1/matters', { name: PAYLOAD.workspaceName, description: 'Workspace for link', matter_type: 'workspace', visibility: 'organization' });
  await post('/api/v1/entity-links', { source_matter_id: workspace.matter.matter_id, target_matter_id: matterId, link_type: 'workspace_matter' });
  // Upload the document when storage is available; the test copes without it.
  await request.post(API_BASE_URL + '/api/v1/storage/files/upload', {
    headers: { Authorization: 'Bearer ' + auth.token },
    multipart: { matter_id: matterId, files: { name: PAYLOAD.docName, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('draft') } },
  }).catch(() => null);
  const files = await apiJson(request, auth, 'GET', `/api/v1/storage/files?matter_id=${encodeURIComponent(created.matter.id)}`);
  const doc = (files.files || []).find((f) => f.filename === PAYLOAD.docName);
  const users = await apiJson(request, auth, 'GET', `/api/v1/matters/${matterId}/mentionable-users`);
  const mentionee = (users.data || [])[0];
  await post(`/api/v1/matters/${matterId}/comments`, { content: PAYLOAD.comment1, mentioned_user_ids: [], referenced_document_ids: [] });
  const mention = mentionee ? `@[${mentionee.name}](${mentionee.id}) ` : '';
  const docRef = doc ? `#[${doc.filename}](${doc.id}) ` : '';
  await post(`/api/v1/matters/${matterId}/comments`, {
    content: `Ping ${mention}about ${docRef}& it's <i>ready</i>`,
    mentioned_user_ids: mentionee ? [mentionee.id] : [], referenced_document_ids: doc ? [doc.id] : [],
  });
  await post(`/api/v1/matters/${matterId}/tasks`, { title: PAYLOAD.task1, description: PAYLOAD.task1Description, status: 'pending', priority: 'high', assigned_to_user_id: mentionee ? mentionee.id : null });
  await post(`/api/v1/matters/${matterId}/tasks`, { title: PAYLOAD.task2, description: `Notes: "a" & 'b' <u>c</u>`, status: 'in_progress', priority: 'normal' });
  await post(`/api/v1/matters/${matterId}/contacts`, {
    first_name: PAYLOAD.contactFirst, last_name: PAYLOAD.contactLast, company_name: PAYLOAD.contactCompany,
    title: 'Trustee "primary"', email: PAYLOAD.contactEmail, phone_mobile: PAYLOAD.contactPhone, phone_work: '555 "0199"', contact_type: 'contact:participant',
  });
  await post(`/api/v1/matters/${other.matter.matter_id}/contacts`, {
    first_name: PAYLOAD.otherContactFirst, last_name: PAYLOAD.otherContactLast, email: PAYLOAD.otherContactEmail, contact_type: 'contact:participant',
  });
  await post('/api/v1/conversations', { title: PAYLOAD.conversationTitle, matter_id: matterId });
  return matterId;
}

function watch(page) {
  const problems = [];
  page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
    });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && /\[LanaDomActions\]/.test(msg.text())) {
      problems.push(`action not registered: ${msg.text().slice(0, 200)}`);
      return;
    }
    if (msg.type() !== 'error') return;
    const where = (msg.location() && msg.location().url) || '';
    if (/favicon\.ico$/.test(where)) return; // Electron never asks for one.
    // A scratch Chef without seeded matter makeups answers 503 on workspace details.
    if (/\/makeup(\?|$)/.test(where) || /MAKEUPS_NOT_SEEDED|Matter makeups are not set up/.test(msg.text())) return;
    problems.push(`console error: ${msg.text().slice(0, 400)}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message.slice(0, 400)}`));
  page.on('dialog', async (dialog) => {
    problems.push(`unexpected ${dialog.type()} dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  return problems;
}

async function inspect(page, scope) {
  return page.evaluate(async ({ scope, tagTexts, doubleSource }) => {
    const root = scope ? document.querySelector(scope) : document.body;
    const text = root ? root.innerText : '';
    const injected = Array.from((root || document).querySelectorAll('b, i, u, script'))
      .filter((el) => tagTexts.includes(el.textContent.trim()) || /__pwned/.test(el.textContent))
      .map((el) => el.outerHTML.slice(0, 120));
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => img.getAttribute('src') === 'x').length;
    const dbl = [];
    const re = new RegExp(doubleSource, 'gi');
    let m;
    while ((m = re.exec(text))) dbl.push(text.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, ' '));
    // Inline handlers written in the page's own HTML file are allowed (the CSP
    // hashes them); any other on* attribute was built by script.
    const handlerValues = (doc) => Array.from(doc.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.attributes).filter((a) => /^on[a-z]+$/i.test(a.name)).map((a) => a.value));
    const source = new DOMParser().parseFromString(await (await fetch(location.href)).text(), 'text/html');
    const staticHandlers = new Set(handlerValues(source));
    const inlineHandlers = Array.from(document.querySelectorAll('body *'))
      .filter((el) => Array.from(el.attributes).some((a) => /^on[a-z]+$/i.test(a.name) && !staticHandlers.has(a.value)))
      .map((el) => el.outerHTML.slice(0, 120));
    return { text, injected, imgs, inlineHandlers, doubleEscaped: dbl, pwned: window.__pwned !== undefined };
  }, { scope, tagTexts: INJECTED_TAG_TEXTS, doubleSource: DOUBLE_ESCAPED.source });
}

async function expectClean(page, problems, area, { scope = null, mustShow = [] } = {}) {
  const r = await inspect(page, scope);
  expect.soft(r.pwned, `${area}: window.__pwned set`).toBe(false);
  expect.soft(r.imgs, `${area}: payload <img> rendered`).toBe(0);
  expect.soft(r.injected, `${area}: payload tags rendered as HTML`).toEqual([]);
  expect.soft(r.inlineHandlers, `${area}: inline on* handlers in the DOM`).toEqual([]);
  expect.soft(r.doubleEscaped, `${area}: entities shown literally`).toEqual([]);
  for (const s of mustShow) expect.soft(r.text.includes(s), `${area}: shows ${JSON.stringify(s)} literally`).toBe(true);
  expect.soft(problems.splice(0), `${area}: console errors, page errors or dialogs`).toEqual([]);
}

async function shot(page, name, locator) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

test.describe('matters list escaping', () => {
  test('payload text renders literally across the matters list', async ({ page, request }) => {
    const auth = await authenticate(request);
    const matterId = process.env.LANA_E2E_ESCAPE_MATTER_ID || await seed(request, auth);

    await installBrowserAuth(page, auth);
    const problems = watch(page);
    await page.addInitScript(() => {
      try { localStorage.setItem('lana.matters.viewMode', 'list'); } catch (e) { /* ignore */ }
    });
    await page.goto('/workspaces.html');

    await test.step('matter list: row text, row menu and pin', async () => {
      // A pinned matter shows in the pinned cards above the table, not in it.
      const row = page.getByText(PAYLOAD.clientName).locator('visible=true').first();
      await expect(row).toBeVisible({ timeout: 30000 });
      await expectClean(page, problems, 'list', { mustShow: [PAYLOAD.clientName, matterId] });
      // The row menu carries the raw matter id.
      const menu = page.locator('#mattersListView lex-dropdown-btn.matter-options-menu').first();
      await expect(menu).toBeAttached();
      const pinFor = page.locator(`#mattersListView .matters-list-pin[data-matter-id="${matterId}"]`);
      if (await pinFor.count()) {
        expect.soft(await pinFor.getAttribute('data-matter-id'), 'pin button data-matter-id').toBe(matterId);
        await pinFor.click();
        await page.waitForTimeout(1500);
        const pinned = page.locator(`#listPinnedCards .pin-button[data-matter-id="${matterId}"]`);
        await expect.soft(pinned).toBeVisible({ timeout: 15000 });
        await expectClean(page, problems, 'pinned card', { mustShow: [PAYLOAD.matterName] });
        if (await pinned.count()) {
          await pinned.click();
          await page.waitForTimeout(1500);
        }
      } else {
        test.info().annotations.push({ type: 'pin', description: 'matter already pinned; list pin skipped' });
      }
      await expectClean(page, problems, 'list pin');
    });

    await test.step('matter card: grid, select, bulk bar, pin', async () => {
      await page.locator('#gridViewBtn').click();
      const card = page.locator(`.matter-card[data-matter-id="${matterId}"]:visible`).first();
      await expect(card).toBeVisible({ timeout: 15000 });
      await expectClean(page, problems, 'card', { mustShow: [PAYLOAD.matterName, PAYLOAD.clientName, PAYLOAD.description] });
      await expect(page.locator('#gridSelectionControls')).toBeVisible();
      await card.locator('.matter-checkbox').check();
      await expect(card).toHaveClass(/ring-2/);
      await expect(page.locator('#bulkActions')).toBeVisible();
      await expect(page.locator('#selectedCount')).toHaveText('1 selected');
      await card.locator('.matter-checkbox').uncheck();
      await expect(page.locator('#bulkActions')).toBeHidden();
      await card.locator('.pin-button').click();
      await page.waitForTimeout(1500);
      await page.locator(`.matter-card[data-matter-id="${matterId}"]:visible .pin-button`).first().click();
      await page.waitForTimeout(1500);
      await expectClean(page, problems, 'card select and pin');
      await page.locator(`.matter-card[data-matter-id="${matterId}"]:visible`).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(3500); // let the pin toasts fade
      await shot(page, '01-matter-card');
    });

    await test.step('open matter: card click opens workspace details', async () => {
      await page.locator(`.matter-card[data-matter-id="${matterId}"]:visible .cursor-pointer`).first().click();
      await page.waitForURL(/workspace-details\.html/, { timeout: 20000 });
      await expect(page.getByText(PAYLOAD.matterName).first()).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(2000);
      await expectClean(page, problems, 'workspace details (opened from card)', { mustShow: [PAYLOAD.matterName] });
      await shot(page, '02-workspace-details');
    });

    await test.step('old matters.html link opens the matter page', async () => {
      await page.goto('/workspaces.html');
      await expect(page.locator('#mattersListView')).toBeAttached({ timeout: 20000 });
      await page.evaluate((id) => Lex.Nav.go('matters.html', { params: { matter_id: id } }), matterId);
      await page.waitForURL(/workspace-details\.html\?id=/, { timeout: 20000 });
      expect(new URL(page.url()).searchParams.get('id')).toBe(matterId);
      await page.goto('/workspaces.html');
      await expect(page.locator('#mattersListView')).toBeAttached({ timeout: 20000 });
      problems.splice(0);
    });

    await test.step('contact search: highlight "to", "\'t" and a quoted word', async () => {
      await page.evaluate((id) => ContactSearchModal.open(id), matterId);
      const input = page.locator('#contactSearchInput');
      await expect(input).toBeVisible({ timeout: 10000 });
      // The contact search API needs two characters, so "t" goes in as "to" and "'t".
      for (const q of ['to', "'t", `"tiger"`]) {
        await input.fill(q);
        await page.waitForTimeout(1500);
        await expect(page.locator('#contactSearchResults').getByText('Tiger', { exact: false }).first()).toBeVisible({ timeout: 10000 });
        await expectClean(page, problems, `contact search ${q}`, { scope: '#contactSearchResults', mustShow: [PAYLOAD.otherContactEmail] });
        const marks = await page.locator('#contactSearchResults mark').allInnerTexts();
        expect.soft(marks.length > 0 && marks.every((m) => m.toLowerCase() === q.toLowerCase()), `contact search ${q}: marks are the query`).toBe(true);
        if (q === 'to') await shot(page, '03-contact-search-t');
        if (q === "'t") await shot(page, '03-contact-search-apostrophe');
      }
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const m = document.getElementById('contactSearchModal'); if (m) m.open = false; });
    });

    await test.step('conversation search: highlight "ta", "\'s" and a quote', async () => {
      await page.evaluate(() => window.openConversationSearchModal());
      const input = page.locator('#conversationSearchInput');
      await expect(input).toBeVisible({ timeout: 10000 });
      // Search needs two characters: "ta", an apostrophe pair and a quote pair.
      for (const q of ['ta', "'s", '"t']) {
        await input.fill(q);
        await page.waitForTimeout(1500);
        await expect(page.locator('#conversationSearchResults mark').first()).toBeVisible({ timeout: 10000 });
        await expectClean(page, problems, `conversation search ${q}`, { scope: '#conversationSearchResults', mustShow: [PAYLOAD.conversationTitle] });
        const marks = await page.locator('#conversationSearchResults mark').allInnerTexts();
        expect.soft(marks.every((m) => m.toLowerCase() === q.toLowerCase()), `conversation search ${q}: marks are the query`).toBe(true);
        if (q !== '"t') await shot(page, q === 'ta' ? '04-conversation-search-t' : '04-conversation-search-apostrophe');
      }
    });

    expect(await page.evaluate(() => window.__pwned), 'window.__pwned').toBeUndefined();
  });
});

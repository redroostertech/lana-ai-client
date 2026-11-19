'use strict';

// Matters page escaping click-through (src/matters.html).
//
// Seeds one matter whose names, ids and text carry quotes, apostrophes, <b>,
// & and an <img onerror> payload, then clicks through the matter list and
// card, documents, comments, tasks (kanban drag), contacts, links, activity,
// connected data and the two search modals. Every step must show the payload
// as literal text: no rendered tags, no double-escaped entities such as
// &amp;quot; on screen, no console errors, no handler failures, and
// window.__pwned never set.
//
// Run it only against a disposable backend and organization. It creates
// matters, comments, tasks, contacts and links, pins a matter and moves a task.
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
// Opening a matter now navigates to workspace-details.html, and nothing in
// matters.html opens its matter drawer any more. The test checks the
// workspace details page it lands on, then loads the drawer through a test
// hook (added to the served page only) so the drawer renderers in
// matters.html still get exercised.
//
// Documents need file storage to upload. Without storage the test still runs,
// and the document checks are skipped unless the seeded matter already holds
// a document named PAYLOAD.docName (for example a documents row added by SQL).

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
  page.on('console', (msg) => {
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
  return page.evaluate(({ scope, tagTexts, doubleSource }) => {
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
    return { text, injected, imgs, doubleEscaped: dbl, pwned: window.__pwned !== undefined };
  }, { scope, tagTexts: INJECTED_TAG_TEXTS, doubleSource: DOUBLE_ESCAPED.source });
}

async function expectClean(page, problems, area, { scope = null, mustShow = [] } = {}) {
  const r = await inspect(page, scope);
  expect.soft(r.pwned, `${area}: window.__pwned set`).toBe(false);
  expect.soft(r.imgs, `${area}: payload <img> rendered`).toBe(0);
  expect.soft(r.injected, `${area}: payload tags rendered as HTML`).toEqual([]);
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

async function openTab(page, tab) {
  await page.locator(`#tab${tab}`).click();
  await expect(page.locator(`#tabContent${tab}`)).toBeVisible();
  await page.waitForTimeout(800);
}

test.describe('matters page escaping', () => {
  test('payload text renders literally across the matters page', async ({ page, request }) => {
    const auth = await authenticate(request);
    const matterId = process.env.LANA_E2E_ESCAPE_MATTER_ID || await seed(request, auth);
    const tasksBefore = await apiJson(request, auth, 'GET', `/api/v1/matters/${matterId}/tasks`);
    const taskList = tasksBefore.tasks || tasksBefore.data || [];
    const pendingTask = taskList.find((t) => t.title === PAYLOAD.task1);
    expect(pendingTask, 'seeded pending task').toBeTruthy();

    await installBrowserAuth(page, auth);
    const problems = watch(page);
    await page.addInitScript(() => {
      try { localStorage.setItem('lana.matters.viewMode', 'list'); } catch (e) { /* ignore */ }
    });
    await page.goto('/matters.html');

    await test.step('matter list: row text and pin', async () => {
      // A pinned matter shows in the pinned section, not the table.
      const row = page.getByText(PAYLOAD.clientName).locator('visible=true').first();
      await expect(row).toBeVisible({ timeout: 30000 });
      await expectClean(page, problems, 'list', { mustShow: [PAYLOAD.clientName, matterId] });
      const pin = page.locator(`.matters-list-action[data-action="pin"][data-row-matter-id="${matterId}"]`);
      if (await pin.count()) {
        await pin.click();
        await page.waitForTimeout(1500);
      }
      await expectClean(page, problems, 'list pin');
    });

    await test.step('matter card: grid, select, pin', async () => {
      await page.locator('#gridViewBtn').click();
      const card = page.locator(`.matter-card[data-matter-id="${matterId}"]:visible`).first();
      await expect(card).toBeVisible({ timeout: 15000 });
      await expectClean(page, problems, 'card', { mustShow: [PAYLOAD.matterName, PAYLOAD.clientName, PAYLOAD.description] });
      await card.locator('.matter-checkbox').check();
      await expect(card).toHaveClass(/ring-indigo-500/);
      await card.locator('.matter-checkbox').uncheck();
      await card.locator('.pin-button').click();
      await page.waitForTimeout(1500);
      await card.locator('.pin-button').click();
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
      await shot(page, '02a-workspace-details');
      await page.goto('/matters.html');
      await expect(page.locator(`.matter-card[data-matter-id="${matterId}"]:visible`).first()).toBeVisible({ timeout: 20000 });
      problems.splice(0);
    });

    await test.step('matter drawer: details and links', async () => {
      // viewMatter now navigates to workspace-details.html, so nothing in the
      // page assigns currentMatterData or opens #matterDrawer any more. Load
      // the drawer the way the retired viewMatter did, so the drawer renderers
      // in matters.html still get exercised with the payload.
      // The page script runs inside a function scope, so a test hook placed
      // next to the binding is the only way to hand the drawer its data.
      await page.route('**/matters.html', async (route) => {
        const response = await route.fetch();
        const html = await response.text();
        const marker = 'let currentMatterData = null;';
        if (!html.includes(marker)) throw new Error('matters.html no longer declares currentMatterData');
        await route.fulfill({ response, body: html.replace(marker, marker + ' window.__setCurrentMatterData = (d) => { currentMatterData = d; };') });
      });
      await page.reload();
      await expect(page.locator(`.matter-card[data-matter-id="${matterId}"]:visible`).first()).toBeVisible({ timeout: 20000 });
      await page.evaluate(async (id) => {
        const [m, perms, act, chats, docs, tasks] = await Promise.all([
          api.getMatter(id),
          api.getMatterPermissions(id).catch(() => ({ permissions: [] })),
          api.getMatterActivity(id, 20, 0).catch(() => ({ activities: [] })),
          api.getMatterConversations(id, 25, 0).catch(() => ({ sessions: [] })),
          api.getMatterFiles(id).catch(() => ({ files: [] })),
          api.getMatterTasks(id).catch(() => ({ tasks: [] })),
        ]);
        const matter = m.matter;
        window.__setCurrentMatterData({
          matter, permissions: perms.permissions || [], activities: act.activities || [],
          activityPagination: act.pagination || { total: 0, limit: 20, offset: 0 },
          chats: chats.sessions || [], chatsPagination: chats.pagination || { total: 0, limit: 25, offset: 0 },
          documents: docs.files || [], documentsPagination: docs.pagination || { total_count: 0 }, orphanedFiles: [],
          tasks: tasks.tasks || [], contacts: matter.contacts || [], notes: matter.notes || [],
        });
        document.getElementById('matterDrawer').open = true;
        window.switchMatterTab('details');
      }, matterId);
      await expect(page.locator('#tabDetails')).toBeVisible({ timeout: 20000 });
      await expect.soft(page.locator('#tabContentDetails')).toContainText(PAYLOAD.workspaceName, { timeout: 15000 });
      await page.locator('#tabContentDetails').getByText('Linked Matters').first().scrollIntoViewIfNeeded().catch(() => {});
      await expectClean(page, problems, 'details and links', { scope: '#tabContentDetails', mustShow: [PAYLOAD.workspaceName] });
      await shot(page, '02-details-links');
    });

    let hasDoc = false;
    await test.step('documents: list, view and download handlers', async () => {
      await openTab(page, 'Documents');
      hasDoc = await page.locator('#tabContentDocuments').getByText(PAYLOAD.docName).count() > 0;
      test.info().annotations.push({ type: 'documents', description: hasDoc ? 'seeded document present' : 'no document (no storage); document checks skipped' });
      await expectClean(page, problems, 'documents', { scope: '#tabContentDocuments', mustShow: hasDoc ? [PAYLOAD.docName] : [] });
      if (!hasDoc) return;
      const title = await page.locator('#tabContentDocuments h6').first().getAttribute('title');
      expect.soft(title, 'document title attribute').toBe(PAYLOAD.docName);
      // Record what the inline handlers pass instead of leaving the page or
      // reaching file storage: the escaping question is whether the quoted
      // file name survives the onclick attribute intact.
      await page.evaluate(() => {
        window.__calls = [];
        window.navToFileViewer = (...a) => window.__calls.push(['view', ...a]);
        window.downloadDocument = async (...a) => { window.__calls.push(['download', ...a]); };
      });
      const actions = page.locator('#tabContentDocuments [data-doc-actions]').first();
      await actions.getByRole('button', { name: 'View' }).click();
      await actions.getByRole('button', { name: 'Download' }).click();
      const calls = await page.evaluate(() => window.__calls);
      expect.soft(calls.map((c) => c[0]), 'view and download handlers ran').toEqual(['view', 'download']);
      expect.soft(calls[1] && calls[1][3], 'download handler received the raw file name').toBe(PAYLOAD.docName);
      await expectClean(page, problems, 'document handlers');
      await shot(page, '03-documents', page.locator('#tabContentDocuments'));
    });

    await test.step('comments: render, dropdowns, post, edit', async () => {
      await openTab(page, 'Comments');
      const list = page.locator('#commentsList');
      await expect(list.getByText('say "hi"', { exact: false })).toBeVisible({ timeout: 15000 });
      await expectClean(page, problems, 'comments', { scope: '#commentsList', mustShow: [PAYLOAD.comment1, `& it's <i>ready</i>`].concat(hasDoc ? [PAYLOAD.docName] : []) });

      const input = page.locator('#commentInput');
      await input.click();
      await page.keyboard.type('@');
      await page.waitForTimeout(400);
      await expectClean(page, problems, 'mention dropdown', { scope: '#mentionDropdown' });
      await input.fill('');
      if (hasDoc) {
        await input.click();
        await page.keyboard.type('#O');
        const item = page.locator('.document-item').first();
        await expect(item).toBeVisible();
        expect.soft(await item.getAttribute('data-doc-name'), 'doc dropdown data-doc-name').toBe(PAYLOAD.docName);
        await expectClean(page, problems, 'document dropdown', { mustShow: [PAYLOAD.docName] });
        await shot(page, '04a-comment-doc-dropdown');
        await item.click();
        await page.keyboard.type(` it's "new" <b>x</b> & y`);
        await page.locator('#postComment').click();
        await expect(list.getByText(`it's "new" <b>x</b> & y`).first()).toBeVisible({ timeout: 15000 });
        const comments = await apiJson(request, auth, 'GET', `/api/v1/matters/${matterId}/comments`);
        const posted = (comments.data || comments.comments || [])
          .filter((c) => /it's "new"/.test(c.content))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        expect.soft(posted && posted.content, 'posted comment stored raw').toContain(`#[${PAYLOAD.docName}](`);
        expect.soft(posted && posted.content, 'posted comment stored raw').toContain(`it's "new" <b>x</b> & y`);
      }

      const before = await apiJson(request, auth, 'GET', `/api/v1/matters/${matterId}/comments`);
      const original = (before.data || before.comments || []).find((c) => c.content.startsWith('say "hi"'));
      const thread = list.locator(`[data-comment-id="${original.id}"]`).first();
      await thread.locator('.edit-comment-btn').first().click();
      const textarea = thread.locator('.edit-comment-textarea');
      await expect(textarea).toHaveValue(original.content);
      const editedText = `${PAYLOAD.comment1} (edited "ok" ${Date.now()})`;
      await textarea.fill(editedText);
      await thread.locator('.save-edit-btn').click();
      await expect(list.getByText(editedText)).toBeVisible({ timeout: 15000 });
      const after = await apiJson(request, auth, 'GET', `/api/v1/matters/${matterId}/comments`);
      const edited = (after.data || after.comments || []).find((c) => c.id === original.id);
      expect.soft(edited && edited.content, 'edited comment stored raw').toBe(editedText);
      await expectClean(page, problems, 'comments after edit', { scope: '#commentsList' });
      await page.locator(`[data-comment-id="${original.id}"]`).first().scrollIntoViewIfNeeded();
      await shot(page, '04-comments');
    });

    await test.step('tasks: kanban and drag between columns', async () => {
      await openTab(page, 'Tasks');
      const card = page.locator(`#tabContentTasks [data-task-id="${pendingTask.id}"]`);
      await expect(card).toBeVisible({ timeout: 15000 });
      await expectClean(page, problems, 'tasks', { scope: '#tabContentTasks', mustShow: [PAYLOAD.task1, PAYLOAD.task2] });
      // Move to a column the task is not in, so the test can run again.
      const target = pendingTask.status === 'in_review' ? 'pending' : 'in_review';
      await card.dragTo(page.locator(`#tabContentTasks [data-status="${target}"]`));
      await page.waitForTimeout(2000);
      const tasks = await apiJson(request, auth, 'GET', `/api/v1/matters/${matterId}/tasks`);
      const moved = (tasks.tasks || tasks.data || []).find((t) => t.id === pendingTask.id);
      expect.soft(moved && moved.status, 'dragged task persisted').toBe(target);
      await expect.soft(page.locator(`#tabContentTasks [data-status="${target}"] [data-task-id="${pendingTask.id}"]`)).toBeVisible();
      await expectClean(page, problems, 'tasks after drag', { scope: '#tabContentTasks', mustShow: [PAYLOAD.task1] });
      await shot(page, '05-tasks-kanban', page.locator('#tabContentTasks'));
      // Clicking a card opens the edit form, which must hold the raw values.
      await page.locator(`#tabContentTasks [data-task-id="${pendingTask.id}"]`).click();
      await expect(page.locator('#taskTitle')).toBeVisible();
      await expect.soft(page.locator('#taskTitle')).toHaveValue(PAYLOAD.task1);
      await expect.soft(page.locator('#taskDescription')).toHaveValue(PAYLOAD.task1Description);
      await expectClean(page, problems, 'task edit form');
      await shot(page, '05a-task-edit-form');
      await page.evaluate(() => { document.getElementById('taskModal').open = false; });
      await page.waitForTimeout(500);
    });

    await test.step('contacts: card, detail, mailto and tel', async () => {
      await openTab(page, 'Contacts');
      const cardText = `${PAYLOAD.contactFirst}`;
      await expect(page.locator('#tabContentContacts').getByText(cardText).first()).toBeVisible({ timeout: 15000 });
      await expectClean(page, problems, 'contact card', { scope: '#tabContentContacts', mustShow: [PAYLOAD.contactEmail] });
      const mail = page.locator('#tabContentContacts a[href^="mailto:"]').first();
      expect.soft(await mail.getAttribute('href'), 'card mailto').toBe('mailto:' + PAYLOAD.contactEmail);
      const tel = page.locator('#tabContentContacts a[href^="tel:"]').first();
      expect.soft(await tel.getAttribute('href'), 'card tel').toBe('tel:' + PAYLOAD.contactPhone);
      await page.locator('#tabContentContacts [onclick^="openContactDetail"]').first().click();
      const detail = page.locator('#contactDetailContent');
      await expect(detail.getByText(PAYLOAD.contactEmail)).toBeVisible({ timeout: 15000 });
      await expectClean(page, problems, 'contact detail', { scope: '#contactDetailContent', mustShow: [PAYLOAD.contactCompany, PAYLOAD.contactPhone] });
      expect.soft(await detail.locator('a[href^="mailto:"]').first().getAttribute('href'), 'detail mailto').toBe('mailto:' + PAYLOAD.contactEmail);
      expect.soft(await detail.locator('a[href^="tel:"]').first().getAttribute('href'), 'detail tel').toBe('tel:' + PAYLOAD.contactPhone);
      await shot(page, '06-contact-detail');
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const m = document.getElementById('contactDetailModal'); if (m) m.open = false; });
      await page.waitForTimeout(500);
    });

    await test.step('contact search: highlight "to", "\'t" and a quoted word', async () => {
      await page.locator('#tabContentContacts button[onclick^="ContactSearchModal.open"]').first().click();
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
        if (q === 'to') await shot(page, '07-contact-search-t');
        if (q === "'t") await shot(page, '07-contact-search-apostrophe');
      }
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const m = document.getElementById('contactSearchModal'); if (m) m.open = false; });
    });

    await test.step('activity and connected data', async () => {
      await openTab(page, 'Activity');
      await expectClean(page, problems, 'activity', { scope: '#tabContentActivity', mustShow: ['<b>now</b>'] });
      await shot(page, '08-activity', page.locator('#tabContentActivity'));
      if (await page.locator('#tabConnectedData').isVisible()) {
        await openTab(page, 'ConnectedData');
        await page.waitForTimeout(1000);
        await expectClean(page, problems, 'connected data', { scope: '#tabContentConnectedData' });
      }
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
        if (q !== '"t') await shot(page, q === 'ta' ? '09-conversation-search-t' : '09-conversation-search-apostrophe');
      }
    });

    expect(await page.evaluate(() => window.__pwned), 'window.__pwned').toBeUndefined();
  });
});

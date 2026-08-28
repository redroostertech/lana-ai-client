'use strict';

const { test, expect } = require('@playwright/test');

const WORKSPACE_ID = 'growth-closeout-workspace';
const TASK_ID = '11111111-2222-4333-8444-555555555555';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installMockSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'closeout-token');
    localStorage.setItem('user', JSON.stringify({
      id: 'user-closeout',
      organization_id: 'org-closeout',
      role: 'member',
    }));
    const style = document.createElement('style');
    style.textContent = 'lex-loader { display: none !important; }';
    document.documentElement.appendChild(style);
  });
  await page.route('**/js/config.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body + '\nwindow.LanaConfig.API_BASE_URL = "";\n' });
  });
}

function matter() {
  return {
    id: 'matter-row-closeout',
    matter_id: WORKSPACE_ID,
    name: 'Growth Closeout Workspace',
    matter_name: 'Growth Closeout Workspace',
    client_name: 'Sheridan Benefits',
    description: 'Prospecting and nurture workspace',
    status: 'active',
    matter_type: 'workspace',
    visibility: 'organization',
    metadata: {},
    created_at: '2026-08-25T12:00:00.000Z',
    updated_at: '2026-08-25T12:00:00.000Z',
  };
}

function task() {
  return {
    id: TASK_ID,
    matter_id: WORKSPACE_ID,
    title: 'Follow up with event lead',
    description: 'Call Avery and qualify the account.',
    notes: '',
    status: 'pending',
    priority: 'normal',
    due_date: null,
    assigned_to_user_id: null,
    created_at: '2026-08-25T12:00:00.000Z',
    updated_at: '2026-08-25T12:00:00.000Z',
  };
}

async function installWorkspaceApiStubs(page, calls) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.toLowerCase();
    const method = request.method();

    if (method === 'GET' && pathname === '/api/v1/auth/me') {
      return json(route, { user: { id: 'user-closeout', organization_id: 'org-closeout', role: 'member' } });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}`) {
      return json(route, { success: true, matter: matter(), tasks: [task()], notes: [], contacts: [] });
    }

    if (method === 'GET' && pathname === `/api/v1/matters/${WORKSPACE_ID}/tasks`) {
      return json(route, { tasks: [task()], total_count: 1 });
    }

    if (method === 'GET' && pathname === '/api/v1/tasks/my') {
      return json(route, { tasks: [task()], total_count: 1, pagination: { has_more: false } });
    }

    if (method === 'PUT' && pathname === `/api/v1/matters/${WORKSPACE_ID}`) {
      calls.updateMatter = await request.postDataJSON();
      return json(route, { matter: { ...matter(), status: calls.updateMatter.status, metadata: { closeout_commentary: calls.updateMatter.closeout_commentary } } });
    }

    if (method === 'POST' && pathname === `/api/v1/matters/${WORKSPACE_ID}/archive`) {
      calls.archiveMatter = await request.postDataJSON();
      return json(route, { matter: { ...matter(), status: 'archived', metadata: { closeout_commentary: calls.archiveMatter.closeout_commentary } } });
    }

    if (method === 'PATCH' && pathname === `/api/v1/matters/tasks/${TASK_ID}`) {
      calls.updateTask = await request.postDataJSON();
      return json(route, { status: 'success', data: { ...task(), ...calls.updateTask } });
    }

    if (method === 'PATCH' && pathname === `/api/v1/matters/tasks/${TASK_ID}/complete`) {
      calls.completeTask = await request.postDataJSON();
      return json(route, { status: 'success', data: { ...task(), status: 'complete', metadata: { closeout_commentary: calls.completeTask.closeout_commentary } } });
    }

    if (method === 'GET' && pathname.includes('/permissions')) {
      return json(route, { permissions: [] });
    }
    if (method === 'GET' && pathname.includes('/activity')) {
      return json(route, { activities: [], pagination: {} });
    }
    if (method === 'GET' && pathname.includes('/conversations')) {
      return json(route, { sessions: [], conversations: [], data: [], pagination: {} });
    }
    if (method === 'GET' && pathname.includes('/storage/files')) {
      return json(route, { files: [], pagination: { total_count: 0 } });
    }
    if (method === 'GET' && pathname.includes('/files/orphaned')) {
      return json(route, { orphaned_files: [], total_count: 0 });
    }
    if (method === 'GET' && pathname.includes('/comments')) {
      return json(route, { data: [], pagination: { total: 0 } });
    }
    if (method === 'GET' && pathname.includes('/pinned')) {
      return json(route, { sessions: [] });
    }
    if (method === 'GET' && pathname.includes('/workspace-state')) {
      return json(route, { data: { summary: {}, tasks: [] } });
    }
    if (method === 'GET' && pathname.includes('/users')) {
      return json(route, { users: [] });
    }
    if (method === 'POST' && pathname.includes('/feature')) {
      return json(route, { success: true });
    }

    return json(route, {});
  });
}

async function setLexValue(page, selector, value) {
  await page.locator(selector).evaluate((node, nextValue) => {
    node.value = nextValue;
    node.setAttribute('value', nextValue);
    node.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: nextValue } }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function expectVisiblePanelScreenshot(page, selector, name) {
  const panel = page.locator(selector);
  await expect(panel).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[lex-redacted]'));
  await page.locator('lex-loader, #lex-loader-overlay').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-results/playwright-agents/${name}.png`, fullPage: false });
}

test.describe('workspace closeout commentary', () => {
  test('captures optional workspace closeout commentary when closing a workspace', async ({ page }) => {
    const calls = {};
    await installMockSession(page);
    await installWorkspaceApiStubs(page, calls);

    await page.goto(`/workspace-details.html?id=${WORKSPACE_ID}`);
    await expect(page.getByText('Growth Closeout Workspace').first()).toBeVisible();
    await page.waitForFunction(() => !document.querySelector('[lex-redacted]'));

    await page.evaluate(() => window.openStatusChangeModal({ status: 'active' }));
    await setLexValue(page, '#statusChangeSelect', 'closed');
    await expectVisiblePanelScreenshot(page, '#workspaceCloseoutCommentary', 'workspace-closeout-desktop');

    await setLexValue(page, '#workspaceCloseoutReason', 'Lead became a qualified opportunity');
    await setLexValue(page, '#workspaceCloseoutWentWell', 'Event data was clean');
    await setLexValue(page, '#workspaceCloseoutCouldImprove', 'Capture renewal month at check-in');
    await setLexValue(page, '#workspaceCloseoutActionItems', 'Create proposal\nSchedule kickoff');
    await page.getByText('Update Status').click();

    await expect.poll(() => calls.updateMatter && calls.updateMatter.status).toBe('closed');
    expect(calls.updateMatter.closeout_commentary).toMatchObject({
      reason: 'Lead became a qualified opportunity',
      went_well: 'Event data was clean',
      could_be_better: 'Capture renewal month at check-in',
      action_items: 'Create proposal\nSchedule kickoff',
    });
  });

  test('captures optional task completion commentary from workspace task modal', async ({ page }) => {
    const calls = {};
    await installMockSession(page);
    await installWorkspaceApiStubs(page, calls);

    await page.goto(`/workspace-details.html?id=${WORKSPACE_ID}&tab=tasks`);
    await expect(page.getByText('Follow up with event lead').first()).toBeVisible();
    await page.waitForFunction(() => !document.querySelector('[lex-redacted]'));

    await page.evaluate((taskId) => window.editTask(taskId), TASK_ID);
    await expect(page.locator('#taskModal')).toHaveAttribute('open', '');
    await setLexValue(page, '#taskStatus', 'complete');
    await expectVisiblePanelScreenshot(page, '#taskCloseoutCommentary', 'task-closeout-desktop');

    await setLexValue(page, '#taskCloseoutReason', 'Lead qualified and moved to opportunity');
    await setLexValue(page, '#taskCloseoutActionItems', 'Draft proposal');
    await page.locator('#taskSubmitBtn').click();

    await expect.poll(() => calls.updateTask && calls.updateTask.status).toBe('complete');
    expect(calls.updateTask.closeout_commentary).toMatchObject({
      reason: 'Lead qualified and moved to opportunity',
      action_items: 'Draft proposal',
    });
  });

  test('captures optional completion commentary from My Tasks', async ({ page }) => {
    const calls = {};
    await installMockSession(page);
    await installWorkspaceApiStubs(page, calls);

    await page.goto('/my-tasks.html');
    await expect(page.getByText('Follow up with event lead').first()).toBeVisible();

    await page.getByText('Follow up with event lead').first().click();
    await page.locator('[data-task-actions-toggle]').click();
    await page.locator('[data-task-action="complete"]').click();
    await expectVisiblePanelScreenshot(page, '#myTaskCloseoutModal .p-5', 'my-tasks-closeout-desktop');

    await setLexValue(page, '#myTaskCloseoutReason', 'Call completed and next step is ready');
    await page.locator('#myTaskCloseoutSaveBtn').click();

    await expect.poll(() => calls.completeTask && calls.completeTask.closeout_commentary && calls.completeTask.closeout_commentary.reason)
      .toBe('Call completed and next step is ready');
  });

  test('renders workspace closeout fields cleanly on mobile', async ({ page }) => {
    const calls = {};
    await page.setViewportSize({ width: 390, height: 844 });
    await installMockSession(page);
    await installWorkspaceApiStubs(page, calls);

    await page.goto(`/workspace-details.html?id=${WORKSPACE_ID}`);
    await expect(page.getByText('Growth Closeout Workspace').first()).toBeVisible();
    await page.waitForFunction(() => !document.querySelector('[lex-redacted]'));
    await page.evaluate(() => window.openStatusChangeModal({ status: 'active' }));
    await setLexValue(page, '#statusChangeSelect', 'closed');
    await expectVisiblePanelScreenshot(page, '#workspaceCloseoutCommentary', 'workspace-closeout-mobile');
  });
});

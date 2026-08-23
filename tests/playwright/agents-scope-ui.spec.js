'use strict';

const { test, expect } = require('@playwright/test');

async function installMockSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'scope-ui-token');
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', organization_id: 'org-1', role: 'member' }));
  });
  await page.route('**/js/config.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: body + '\nwindow.LanaConfig.API_BASE_URL = "";\n' });
  });
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test.describe('Agent Studio exposure and run-log UX', () => {
  test('creates a workspace agent with access separate from chat discoverability', async ({ page }) => {
    await installMockSession(page);
    let createPayload = null;

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/agents') {
        return json(route, { agents: [{
          id: 'system-template-1', slug: 'connector-triage', name: 'Connector Triage',
          description: 'Diagnose connector health.', kind: 'system', organization_id: null,
          allowed_tools: [], context_providers: []
        }] });
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/matters') {
        return json(route, { matters: [{ id: 'matter-7', name: 'Northwind launch' }] });
      }
      if (request.method() === 'POST' && url.pathname === '/api/v1/agents') {
        createPayload = request.postDataJSON();
        return json(route, { agent: { id: 'agent-1', slug: 'northwind-helper', ...createPayload } }, 201);
      }
      return json(route, {});
    });

    await page.goto('/agents/index.html#create');
    await page.locator('[data-template-slug="connector-triage"]').click();
    await page.locator('#agentBuilderNextBtn').click();
    await page.locator('#agentCreateName').evaluate((node) => {
      node.value = 'Northwind helper';
      node.dispatchEvent(new CustomEvent('lex-input', { bubbles: true, detail: { value: node.value } }));
    });
    await page.locator('#agentCreateDescription').evaluate((node) => {
      node.value = 'Prepare a grounded weekly update for this workspace.';
      node.dispatchEvent(new CustomEvent('lex-input', { bubbles: true, detail: { value: node.value } }));
    });
    await page.locator('#agentBuilderNextBtn').click();
    await page.locator('#agentBuilderNextBtn').click();

    await expect(page.getByText('Who can use this agent?')).toBeVisible();
    await page.locator('[data-exposure-choice="workspace"]').click();
    await expect(page.locator('#agentCreateVisibilityWorkspaceField')).toBeVisible();
    await page.locator('#agentCreateVisibilityMatter').evaluate((node) => {
      node.value = 'matter-7';
      node.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: 'matter-7' } }));
    });
    await expect(page.getByText('This does not grant anyone access.')).toBeVisible();
    await page.locator('#agentCreateSaveBtn').click();

    await expect.poll(() => createPayload).not.toBeNull();
    expect(createPayload).toMatchObject({
      template_slug: 'connector-triage',
      visibility: 'workspace',
      matter_id: 'matter-7',
      discoverable: false,
    });
  });

  test('separates my runs from shared runs and opens the authorized run activity', async ({ page }) => {
    await installMockSession(page);
    const audiences = [];
    const mine = {
      id: 'run-mine', name: 'My weekly update', description: 'Prepared for review.',
      execution_status: 'completed', created_at: '2026-08-23T12:00:00.000Z',
      is_mine: true, visibility: 'private'
    };
    const shared = {
      id: 'run-shared', name: 'Workspace handoff', description: 'Shared deliverable.',
      execution_status: 'completed', created_at: '2026-08-23T13:00:00.000Z',
      matter_id: 'matter-7', visibility: 'workspace', triggered_by_name: 'Jordan Lee'
    };

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/agentic-tasks') {
        const audience = url.searchParams.get('audience') || 'mine';
        audiences.push(audience);
        const data = audience === 'shared' ? [shared] : [mine];
        return json(route, { data, pagination: { total: data.length } });
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/agentic-tasks/run-shared') {
        return json(route, { data: {
          ...shared,
          status: 'completed',
          events: [{ id: 'event-1', event_type: 'status', content: { message: 'Run completed' }, created_at: shared.created_at }],
          artifacts: [], approvals: [], steps: []
        } });
      }
      return json(route, {});
    });

    await page.goto('/agents/index.html#activity');
    await expect(page.getByText('My weekly update')).toBeVisible();
    await expect(page.getByText('Only me · Started by you')).toBeVisible();
    expect(audiences).toContain('mine');

    await page.locator('#atAudienceFilter').evaluate((node) => {
      node.value = 'shared';
      node.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { value: 'shared' } }));
    });
    await expect(page.getByText('Workspace handoff')).toBeVisible();
    await expect(page.getByText('Workspace · Started by Jordan Lee')).toBeVisible();
    expect(audiences).toContain('shared');

    await page.locator('[data-task-log-id="run-shared"]').click();
    await expect(page.locator('#atdExecutionTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Run completed')).toBeVisible();
  });

  test('keeps duplicate-slug agents pinned to the selected definition', async ({ page }) => {
    await installMockSession(page);
    const detailSelectors = [];
    let runPayload = null;

    const privateAgent = {
      id: 'agent-private', slug: 'weekly-review', name: 'My Weekly Review',
      description: 'A personal review.', kind: 'custom', visibility: 'private',
      allowed_tools: [], context_providers: [], is_active: true
    };
    const workspaceAgent = {
      id: 'agent-workspace', slug: 'weekly-review', name: 'Workspace Review',
      description: 'A shared workspace review.', kind: 'custom', visibility: 'workspace',
      matter_id: 'matter-7', allowed_tools: [], context_providers: [], is_active: true
    };

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/v1/agents') {
        return json(route, { agents: [privateAgent, workspaceAgent] });
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/agentic-tasks') {
        return json(route, { data: [], pagination: { total: 0 } });
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/agents/weekly-review') {
        const definitionId = url.searchParams.get('definition_id');
        detailSelectors.push(definitionId);
        return json(route, { agent: definitionId === 'agent-workspace' ? workspaceAgent : privateAgent });
      }
      if (request.method() === 'GET' && url.pathname === '/api/v1/agents/weekly-review/workflows') {
        detailSelectors.push(url.searchParams.get('definition_id'));
        return json(route, { workflow: null });
      }
      if (request.method() === 'POST' && url.pathname === '/api/v1/agents/weekly-review/runs') {
        runPayload = request.postDataJSON();
        return json(route, { run: { id: 'run-pinned' } }, 201);
      }
      return json(route, {});
    });

    await page.goto('/agents/index.html#catalog');
    const workspaceCard = page.locator('.agents-card--deployed').filter({ hasText: 'Workspace Review' });
    await expect(workspaceCard.getByText('Workspace', { exact: true })).toBeVisible();
    await workspaceCard.getByText('Open', { exact: true }).click();

    await expect(page).toHaveURL(/#agent\/weekly-review\?definition_id=agent-workspace$/);
    await expect(page.locator('#agentDetailBanner .lex-banner-heading')).toHaveText('Workspace Review');
    expect(detailSelectors).toContain('agent-workspace');

    await page.locator('#agentDetailRunBtn').click();
    await page.locator('#agentDetailRunInput').evaluate((node) => {
      node.value = 'Prepare this week’s review';
      node.dispatchEvent(new CustomEvent('lex-input', { bubbles: true, detail: { value: node.value } }));
    });
    await page.locator('#agentDetailRunModal').dispatchEvent('lex-confirm');
    await expect.poll(() => runPayload).not.toBeNull();
    expect(runPayload.definition_id).toBe('agent-workspace');
  });
});

'use strict';

const { test, expect } = require('@playwright/test');
const {
  CATALOG_AGENTS,
  hasAuthConfiguration,
  authenticate,
  listCatalogAgents,
  installBrowserAuth,
} = require('./helpers/agents-harness');

test.describe('Agent Studio catalog UI', () => {
  test.skip(!hasAuthConfiguration(), 'Live Agent Studio UI checks require LANA_E2E_TOKEN or LANA_E2E_EMAIL/LANA_E2E_PASSWORD.');

  test('shows every runnable catalog agent and its declared run scope', async ({ page, request }) => {
    const auth = await authenticate(request);
    const agents = await listCatalogAgents(request, auth);
    const slugs = agents.map((agent) => agent.template_slug || agent.slug);

    expect(new Set(slugs)).toEqual(new Set(CATALOG_AGENTS));
    await installBrowserAuth(page, auth);

    for (const agent of agents) {
      const slug = agent.slug;
      await test.step(slug, async () => {
        await page.goto('/agents/index.html#agent/' + encodeURIComponent(slug));
        await expect(page.locator('#agentDetailBanner')).toHaveAttribute('heading', agent.name || slug);
        await page.locator('#agentDetailRunBtn').click();
        await expect(page.locator('#agentDetailRunModal')).toBeVisible();
        const options = await page.locator('#agentDetailRunScope').evaluate((node) => node.options || []);
        expect(options.map((option) => option.value)).toEqual(agent.run_scopes);
        await page.locator('#agentDetailRunModal').evaluate((node) => { node.open = false; });
      });
    }
  });
});

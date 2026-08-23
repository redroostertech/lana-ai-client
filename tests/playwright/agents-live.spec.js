'use strict';

const { test, expect } = require('@playwright/test');
const {
  CATALOG_AGENTS,
  REQUIRED_ARTIFACT_KINDS,
  WORKSPACE_ONLY,
  hasAuthConfiguration,
  authenticate,
  apiJson,
  listCatalogAgents,
  findWorkspace,
  runInputFor,
  shouldSkipAgent,
  pollRun,
  installBrowserAuth,
} = require('./helpers/agents-harness');

test.describe.serial('live native catalog-agent behavior', () => {
  test.skip(process.env.LANA_E2E_LIVE_AGENTS !== '1', 'Set LANA_E2E_LIVE_AGENTS=1 to create real agent runs.');
  test.skip(!hasAuthConfiguration(), 'Live runs require LANA_E2E_TOKEN or LANA_E2E_EMAIL/LANA_E2E_PASSWORD.');

  let auth;
  let definitions;
  let workspaceId;

  test.beforeAll(async ({ request }) => {
    auth = await authenticate(request);
    const rows = await listCatalogAgents(request, auth);
    definitions = new Map(rows.map((agent) => [agent.template_slug || agent.slug, agent]));
    workspaceId = await findWorkspace(request, auth);
  });

  for (const slug of CATALOG_AGENTS) {
    test(slug + ' produces a valid native-runtime outcome', async ({ request, page }, testInfo) => {
      const skipReason = shouldSkipAgent(slug);
      test.skip(Boolean(skipReason), skipReason);
      const definition = definitions.get(slug);
      expect(definition, `Missing live catalog definition for ${slug}`).toBeTruthy();

      const supportedScopes = definition.run_scopes || [];
      const scope = WORKSPACE_ONLY.has(slug) ? 'workspace' : (supportedScopes.includes('system') ? 'system' : 'workspace');
      if (scope === 'workspace') {
        test.skip(!workspaceId, 'No active workspace is available; set LANA_E2E_MATTER_ID or create one.');
      }

      const payload = {
        input: runInputFor(slug),
        title: 'Playwright behavior check: ' + slug,
        scope,
      };
      if (scope === 'workspace') payload.matter_id = workspaceId;

      const started = await apiJson(
        request,
        auth,
        'POST',
        '/api/v1/agents/' + encodeURIComponent(definition.slug) + '/runs',
        payload
      );
      const runId = started && started.run && started.run.id;
      expect(runId).toBeTruthy();
      expect(started.run.run_scope).toBe(scope);

      let envelope = await pollRun(request, auth, runId, Number(process.env.LANA_E2E_RUN_TIMEOUT_MS || 10 * 60 * 1000));
      let status = envelope.run.status || envelope.run.execution_status;
      expect(status).not.toBe('failed');
      expect(status).not.toBe('cancelled');
      expect(status).not.toBe('rejected');

      const artifactKinds = envelope.artifacts.map((artifact) => artifact.kind);
      for (const requiredKind of REQUIRED_ARTIFACT_KINDS[slug] || []) {
        expect(artifactKinds, `${slug} did not produce ${requiredKind}`).toContain(requiredKind);
      }
      for (const artifact of envelope.artifacts) {
        expect(artifact.kind).toBeTruthy();
        expect(artifact.status).toBeTruthy();
        expect(artifact.content_jsonb || artifact.content || artifact.payload).toBeTruthy();
      }

      if (process.env.LANA_E2E_ALLOW_APPLY === '1' && status === 'awaiting_approval') {
        const maxDecisions = Math.max(1, envelope.artifacts.length + 1);
        for (let decision = 0; decision < maxDecisions && status === 'awaiting_approval'; decision += 1) {
          await apiJson(request, auth, 'POST', '/api/v1/agentic-tasks/' + encodeURIComponent(runId) + '/approve', {});
          envelope = await pollRun(request, auth, runId, Number(process.env.LANA_E2E_RUN_TIMEOUT_MS || 10 * 60 * 1000));
          status = envelope.run.status || envelope.run.execution_status;
        }
        expect(status).not.toBe('failed');
      }

      await testInfo.attach(slug + '-run.json', {
        body: Buffer.from(JSON.stringify({ run: envelope.run, artifacts: envelope.artifacts }, null, 2)),
        contentType: 'application/json',
      });

      await installBrowserAuth(page, auth);
      await page.goto('/agents/index.html#activity/' + encodeURIComponent(runId));
      await expect(page.locator('#atdJourney')).toBeVisible();
      if (result.status === 'awaiting_input') {
        await expect(page.locator('#atdInputArea')).toBeVisible();
      } else {
        await expect(page.locator('#atdRunSummary')).not.toHaveClass(/hidden/);
      }
      await page.screenshot({ path: testInfo.outputPath(slug + '-outcome.png'), fullPage: true });
    });
  }
});

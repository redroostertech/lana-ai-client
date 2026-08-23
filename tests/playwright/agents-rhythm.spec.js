'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  API_BASE_URL,
  CATALOG_AGENTS,
  hasAuthConfiguration,
  authenticate,
  authHeaders,
  apiJson,
  installBrowserAuth,
} = require('./helpers/agents-harness');

const EVIDENCE_DIR = path.resolve(__dirname, '../../qa-evidence/agent-studio-rhythm');
const SCREENSHOTS_DIR = path.join(EVIDENCE_DIR, 'screenshots');

function rows(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.agents)) return body.agents;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

function runRows(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.runs)) return body.runs;
  if (body && body.data && Array.isArray(body.data.runs)) return body.data.runs;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

function isSystem(agent) {
  return !agent.organization_id || agent.is_system === true || agent.kind === 'system';
}

async function setLexValue(page, selector, value, eventName = 'lex-change') {
  await page.locator(selector).evaluate((node, args) => {
    node.value = args.value;
    node.setAttribute('value', args.value);
    node.dispatchEvent(new CustomEvent(args.eventName, {
      bubbles: true,
      detail: { value: args.value },
    }));
  }, { value, eventName });
}

async function setLexToggle(page, selector, checked) {
  await page.locator(selector).evaluate((node, value) => {
    node.checked = value;
    node.dispatchEvent(new CustomEvent('lex-change', {
      bubbles: true,
      detail: { value },
    }));
  }, checked);
}

test.describe('Agent Studio rhythm scheduling', () => {
  test.skip(!hasAuthConfiguration(), 'Live rhythm checks require the configured LANA test credentials.');

  test('deploys, presents, pauses, resumes, edits, validates, and cleans up a disposable rhythm', async ({ page, request }, testInfo) => {
    test.setTimeout(3 * 60 * 1000);
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    const auth = await authenticate(request);
    const beforeBody = await apiJson(request, auth, 'GET', '/api/v1/agents?include_system=true&active_only=false');
    const before = rows(beforeBody);
    const systems = before.filter((agent) => isSystem(agent) && CATALOG_AGENTS.includes(agent.template_slug || agent.slug));
    const reusable = before.find((agent) => !isSystem(agent)
      && agent.is_active === false
      && agent.visibility === 'private'
      && String(agent.created_by || '') === String(auth.user && auth.user.id || '')
      && String(agent.name || '').startsWith('Rhythm QA ')
      && CATALOG_AGENTS.includes(agent.template_slug || agent.slug));
    const ownedSlugs = new Set(before
      .filter((agent) => !isSystem(agent)
        && agent.is_active !== false
        && agent.visibility === 'private'
        && String(agent.created_by || '') === String(auth.user && auth.user.id || ''))
      .map((agent) => agent.template_slug || agent.slug));
    const template = reusable
      ? systems.find((agent) => (agent.template_slug || agent.slug) === (reusable.template_slug || reusable.slug))
      : systems.find((agent) => !ownedSlugs.has(agent.template_slug || agent.slug));
    expect(template, 'A canonical template with a safe disposable private copy is required for the rhythm test').toBeTruthy();

    const templateSlug = template.template_slug || template.slug;
    const uniqueName = `Rhythm QA ${Date.now()}`;
    const priorRuns = reusable
      ? runRows(await apiJson(
        request,
        auth,
        'GET',
        `/api/v1/agent-runs?agent_definition_id=${encodeURIComponent(reusable.id)}&limit=100`
      ))
      : [];
    let createdAgent = null;
    let cleanup = { attempted: false, complete: false };
    const record = {
      test_user_id: auth.user && auth.user.id || null,
      organization_id: auth.user && auth.user.organization_id || null,
      template_slug: templateSlug,
      name: uniqueName,
      reused_disposable_definition_id: reusable && reusable.id || null,
      deploy_payload: null,
      created_definition_id: null,
      active_schedule: null,
      paused_schedule: null,
      resumed_schedule: null,
      invalid_update_status: null,
      run_count_before: priorRuns.length,
      run_count_after: null,
      cleanup,
    };

    try {
      await installBrowserAuth(page, auth);
      await page.goto('/agents/index.html#create');
      await expect(page.locator('.agent-create-page-container')).toBeVisible();
      await expect(page.locator(`[data-template-slug="${templateSlug}"]`)).toBeVisible();
      await page.locator(`[data-template-slug="${templateSlug}"]`).click();
      await page.locator('#agentBuilderNextBtn').click();

      await setLexValue(page, '#agentCreateName', uniqueName, 'lex-input');
      await setLexValue(page, '#agentCreateDescription', 'Prepare a small, read-only operating review on a predictable weekday rhythm.', 'lex-input');
      await page.locator('#agentBuilderNextBtn').click();
      await page.locator('#agentBuilderNextBtn').click();

      await expect(page.locator('#agentBuilderStep4')).toBeVisible();
      await page.locator('[data-run-choice="weekday_morning"]').click();
      await setLexValue(page, '#agentCreateSchedulePreset', 'weekday_morning');
      await setLexValue(page, '#agentCreateScheduleTimezone', 'America/New_York');
      await expect(page.locator('#agentCreateScheduleFields')).toBeVisible();
      await expect(page.locator('#agentCreateVisibility')).toHaveValue('private');

      const responsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && response.url().includes('/api/v1/agents')
      ));
      await page.locator('#agentCreateSaveBtn').click();
      const deployResponse = await responsePromise;
      expect(deployResponse.status()).toBe(201);
      record.deploy_payload = deployResponse.request().postDataJSON();
      expect(record.deploy_payload).toMatchObject({
        template_slug: templateSlug,
        name: uniqueName,
        visibility: 'private',
        discoverable: false,
        schedule: {
          enabled: true,
          cron: '0 9 * * 1-5',
          timezone: 'America/New_York',
        },
      });
      const deployBody = await deployResponse.json();
      createdAgent = deployBody.agent || deployBody.data || deployBody;
      record.created_definition_id = createdAgent.id;
      expect(createdAgent).toMatchObject({
        id: expect.any(String),
        organization_id: auth.user.organization_id,
        created_by: auth.user.id,
        visibility: 'private',
        name: uniqueName,
      });
      if (reusable) expect(createdAgent.id).toBe(reusable.id);
      expect(createdAgent.schedule).toMatchObject({
        enabled: true,
        cron: '0 9 * * 1-5',
        timezone: 'America/New_York',
      });
      expect(createdAgent.schedule.next_run_at).toEqual(expect.any(String));
      record.active_schedule = createdAgent.schedule;

      await expect(page.locator('#agentBuilderSuccess')).toBeVisible();
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-deploy-success.png'), fullPage: true });

      const detailHash = '#agent/' + encodeURIComponent(templateSlug)
        + '?definition_id=' + encodeURIComponent(createdAgent.id);
      await page.goto('/agents/index.html' + detailHash);
      await expect(page.locator('#agentDetailBanner .lex-banner-heading')).toHaveText(uniqueName);
      await expect(page.locator('#agentDetailScheduleSummary')).toHaveAttribute('data-state', 'active');
      await expect(page.locator('#agentDetailScheduleLabel')).toHaveText('On a rhythm');
      await expect(page.locator('#agentDetailScheduleCadence')).toContainText('Weekdays at 9:00 AM · America/New_York');
      await expect(page.locator('#agentDetailScheduleNext')).toContainText('Next run ·');
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-active-next-run.png'), fullPage: true });

      await page.locator('#agentDetailConfigBtn').click();
      await expect(page.locator('#agentDetailConfigDrawer')).toBeVisible();
      expect(await page.locator('#agentDetailEditScheduleEnabled').evaluate((node) => node.checked)).toBe(true);
      await setLexToggle(page, '#agentDetailEditScheduleEnabled', false);
      const pauseResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'PUT'
        && response.url().includes('/api/v1/agents/' + templateSlug)
      ));
      await page.locator('#agentDetailConfigDrawer').evaluate((node) => {
        node.dispatchEvent(new CustomEvent('lex-confirm', { bubbles: true }));
      });
      expect((await pauseResponsePromise).status()).toBe(200);
      await expect(page.locator('#agentDetailConfigDrawer')).not.toBeVisible();
      await expect(page.locator('#agentDetailScheduleSummary')).toHaveAttribute('data-state', 'paused');
      await expect(page.locator('#agentDetailScheduleNext')).toContainText('No scheduled runs will start while paused.');
      const paused = await apiJson(request, auth, 'GET', `/api/v1/agents/${encodeURIComponent(templateSlug)}?definition_id=${encodeURIComponent(createdAgent.id)}`);
      record.paused_schedule = paused.agent.schedule;
      expect(record.paused_schedule).toMatchObject({ enabled: false, cron: '0 9 * * 1-5', timezone: 'America/New_York', next_run_at: null });
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-paused.png'), fullPage: true });

      await page.locator('#agentDetailConfigBtn').click();
      await expect(page.locator('#agentDetailConfigDrawer')).toBeVisible();
      await setLexToggle(page, '#agentDetailEditScheduleEnabled', true);
      await setLexValue(page, '#agentDetailEditScheduleCron', '0 9 * * 1', 'lex-input');
      await setLexValue(page, '#agentDetailEditScheduleTimezone', 'UTC');
      const resumeResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'PUT'
        && response.url().includes('/api/v1/agents/' + templateSlug)
      ));
      await page.locator('#agentDetailConfigDrawer').evaluate((node) => {
        node.dispatchEvent(new CustomEvent('lex-confirm', { bubbles: true }));
      });
      expect((await resumeResponsePromise).status()).toBe(200);
      await expect(page.locator('#agentDetailConfigDrawer')).not.toBeVisible();
      await expect(page.locator('#agentDetailScheduleSummary')).toHaveAttribute('data-state', 'active');
      await expect(page.locator('#agentDetailScheduleCadence')).toContainText('Mondays at 9:00 AM · UTC');
      const resumed = await apiJson(request, auth, 'GET', `/api/v1/agents/${encodeURIComponent(templateSlug)}?definition_id=${encodeURIComponent(createdAgent.id)}`);
      record.resumed_schedule = resumed.agent.schedule;
      expect(record.resumed_schedule).toMatchObject({ enabled: true, cron: '0 9 * * 1', timezone: 'UTC' });
      expect(record.resumed_schedule.next_run_at).toEqual(expect.any(String));
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-resumed-edited.png'), fullPage: true });

      const invalidResponse = await request.put(
        API_BASE_URL + `/api/v1/agents/${encodeURIComponent(templateSlug)}?definition_id=${encodeURIComponent(createdAgent.id)}`,
        {
          headers: authHeaders(auth),
          data: { schedule: { enabled: true, cron: '0 25 * * *', timezone: 'UTC' } },
        }
      );
      record.invalid_update_status = invalidResponse.status();
      expect(invalidResponse.status()).toBe(400);
      const unchanged = await apiJson(request, auth, 'GET', `/api/v1/agents/${encodeURIComponent(templateSlug)}?definition_id=${encodeURIComponent(createdAgent.id)}`);
      expect(unchanged.agent.schedule).toMatchObject({ enabled: true, cron: '0 9 * * 1', timezone: 'UTC' });
      const afterRuns = runRows(await apiJson(
        request,
        auth,
        'GET',
        `/api/v1/agent-runs?agent_definition_id=${encodeURIComponent(createdAgent.id)}&limit=100`
      ));
      record.run_count_after = afterRuns.length;
      expect(record.run_count_after).toBe(record.run_count_before);
    } finally {
      if (createdAgent && createdAgent.id) {
        expect(createdAgent.name).toBe(uniqueName);
        expect(createdAgent.organization_id).toBe(auth.user.organization_id);
        expect(createdAgent.created_by).toBe(auth.user.id);
        cleanup.attempted = true;
        const deleteResponse = await request.delete(
          API_BASE_URL + `/api/v1/agents/${encodeURIComponent(templateSlug)}?definition_id=${encodeURIComponent(createdAgent.id)}`,
          { headers: authHeaders(auth) }
        );
        cleanup.status = deleteResponse.status();
        if (deleteResponse.ok()) {
          const deleteBody = await deleteResponse.json();
          const deleted = deleteBody.agent || deleteBody.data || deleteBody;
          cleanup.complete = deleted.id === createdAgent.id && deleted.is_active === false;
          cleanup.definition_id = deleted.id;
          cleanup.is_active = deleted.is_active;
        }
      }
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'rhythm-result.json'), JSON.stringify(record, null, 2));
    }

    expect(cleanup).toMatchObject({ attempted: true, complete: true, status: 200, is_active: false });
    await testInfo.attach('rhythm-result', {
      path: path.join(EVIDENCE_DIR, 'rhythm-result.json'),
      contentType: 'application/json',
    });
  });
});

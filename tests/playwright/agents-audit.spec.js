'use strict';

const { test, expect } = require('@playwright/test');
const {
  API_BASE_URL,
  CATALOG_AGENTS,
  REQUIRED_ARTIFACT_KINDS,
  hasAuthConfiguration,
  authenticate,
  apiJson,
  readRunEnvelope,
} = require('./helpers/agents-harness');

const REJECTED_RUN_STATUSES = new Set(['failed', 'cancelled', 'rejected']);
const SETTLED_AUDIT_STATUSES = new Set(['awaiting_approval', 'awaiting_input', 'completed']);
const APPROVAL_SAFE_ARTIFACT_STATUSES = new Set(['awaiting_approval']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function contentForArtifact(artifact) {
  return asObject(artifact && (artifact.content_jsonb || artifact.content || artifact.payload));
}

function approvalKinds(definition) {
  return Object.keys(asObject(asObject(definition && definition.approval_policy).artifact_kinds));
}

function collectScopedValues(value, targetKeys, values = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectScopedValues(item, targetKeys, values));
    return values;
  }
  if (!value || typeof value !== 'object') return values;
  Object.entries(value).forEach(([key, child]) => {
    if (targetKeys.has(key) && child !== null && child !== undefined && child !== '') {
      values.push(String(child));
    }
    collectScopedValues(child, targetKeys, values);
  });
  return values;
}

function assertNonEmptyString(value, label) {
  expect(typeof value === 'string' && value.trim().length > 0, label).toBe(true);
}

function assertArtifactSemantics(slug, artifact, envelope) {
  const content = contentForArtifact(artifact);
  const serialized = JSON.stringify(content);
  expect(Object.keys(content).length, `${slug}/${artifact.kind} content is empty`).toBeGreaterThan(0);
  expect(serialized, `${slug}/${artifact.kind} leaked a presentation coercion`).not.toContain('[object Object]');
  expect(serialized, `${slug}/${artifact.kind} contains an undefined placeholder`).not.toMatch(/\bundefined\b/i);

  switch (artifact.kind) {
    case 'matter_plan':
      assertNonEmptyString(content.summary, 'matter_plan.summary is required');
      expect(Array.isArray(content.workstreams)).toBe(true);
      break;
    case 'automation_rule':
      expect(content.enabled, 'new automation rules must remain disabled').toBe(false);
      expect(Array.isArray(content.actions) && content.actions.length > 0).toBe(true);
      expect(Object.keys(asObject(content.trigger)).length).toBeGreaterThan(0);
      break;
    case 'matter_review_summary':
      assertNonEmptyString(content.executive_summary, 'matter review needs an executive summary');
      expect(Array.isArray(content.key_risks)).toBe(true);
      break;
    case 'missing_document_report':
      expect(Array.isArray(content.gaps)).toBe(true);
      expect(Array.isArray(content.missing)).toBe(true);
      expect(Array.isArray(content.proposed_tasks)).toBe(true);
      break;
    case 'workspace_timeline_risk_report':
      expect(Array.isArray(content.risk_register) && content.risk_register.length > 0).toBe(true);
      expect(Array.isArray(content.limitations) && content.limitations.length > 0).toBe(true);
      {
        const generatedAt = Date.parse(content.generated_at);
        const runCreatedAt = Date.parse(envelope.run.created_at);
        expect(Number.isFinite(generatedAt), 'timeline report needs a valid server timestamp').toBe(true);
        expect(Number.isFinite(runCreatedAt), 'timeline run needs a valid creation timestamp').toBe(true);
        expect(generatedAt, 'timeline timestamp predates its run').toBeGreaterThanOrEqual(runCreatedAt - 60_000);
        expect(generatedAt, 'timeline timestamp is implausibly in the future').toBeLessThanOrEqual(Date.now() + 60_000);
      }
      break;
    case 'remediation_proposal':
      expect(content.auto_apply, 'connector remediation must not auto-apply').toBe(false);
      assertNonEmptyString(content.rollback, 'connector remediation needs rollback guidance');
      expect(Array.isArray(asObject(content.remediation).steps)).toBe(true);
      break;
    case 'narrative_report': {
      assertNonEmptyString(content.executive_summary, 'narrative report needs an executive summary');
      expect(Array.isArray(content.sections) && content.sections.length > 0).toBe(true);
      expect(Array.isArray(content.metric_provenance) && content.metric_provenance.length > 0).toBe(true);
      const analyticsStep = envelope.steps.find((step) => (
        step.tool_name === 'query_analytics_data' && step.tool_output && step.tool_output.success === true
      ));
      expect(analyticsStep, 'insights must be grounded in a successful governed analytics step').toBeTruthy();
      const auditId = analyticsStep.tool_output.data && analyticsStep.tool_output.data.audit_log_id;
      expect(auditId, 'successful analytics must return an audit reference').toBeTruthy();
      expect(content.metric_provenance.some((metric) => metric.audit_log_id === auditId)).toBe(true);
      break;
    }
    case 'cash_application_batch':
      expect(Array.isArray(content.matches)).toBe(true);
      expect(asObject(content.summary)).toBeTruthy();
      if (content.matches.length === 0) {
        const disclosure = JSON.stringify([content.review_notes, content.open_questions]);
        expect(disclosure).toMatch(/unavailable|could not|failed|missing|gap|authorize/i);
        expect(Number(content.summary.matched_amount || 0)).toBe(0);
      }
      break;
    case 'meeting_summary':
      expect(Array.isArray(content.tldr) && content.tldr.length > 0).toBe(true);
      expect(Array.isArray(content.topics)).toBe(true);
      expect(Number.isInteger(content.action_items_count)).toBe(true);
      expect(Number.isInteger(content.open_questions_count)).toBe(true);
      break;
    case 'requirement_set':
      expect(Array.isArray(content.deliverables)).toBe(true);
      expect(Array.isArray(content.open_questions)).toBe(true);
      break;
    case 'workstream_set':
      expect(Array.isArray(content.workstreams) && content.workstreams.length > 0).toBe(true);
      break;
    case 'task_batch':
      expect(Array.isArray(content.tasks) && content.tasks.length > 0).toBe(true);
      break;
    case 'dashboard_widget_batch':
      expect(Array.isArray(content.widgets) && content.widgets.length > 0).toBe(true);
      break;
    default:
      // The server-side schema validator is authoritative for additional
      // catalog artifact kinds; the general non-empty and validation checks
      // above still apply.
      break;
  }
}

test.describe('persisted catalog-agent permission and output audit', () => {
  test.skip(process.env.LANA_E2E_AGENT_AUDIT !== '1', 'Set LANA_E2E_AGENT_AUDIT=1 to audit persisted live agent runs.');
  test.skip(!hasAuthConfiguration(), 'Agent audit requires the test credentials file or explicit LANA_E2E credentials.');

  let auth;
  let definitionsBySlug;
  let definitionsById;
  let latestRunsBySlug;
  let matterAliasesById;

  test.beforeAll(async ({ request }) => {
    auth = await authenticate(request);
    const [allDefinitionsBody, runsBody, mattersBody] = await Promise.all([
      apiJson(request, auth, 'GET', '/api/v1/agents?include_system=true&active_only=true'),
      apiJson(request, auth, 'GET', '/api/v1/agent-runs?limit=200'),
      apiJson(request, auth, 'GET', '/api/v1/matters?page=1&limit=100'),
    ]);
    const allDefinitions = allDefinitionsBody.agents || [];
    definitionsBySlug = new Map();
    for (const slug of CATALOG_AGENTS) {
      const candidates = allDefinitions.filter((definition) => (
        (definition.template_slug || definition.slug) === slug
      ));
      const deployed = candidates.filter((definition) => (
        String(definition.organization_id || '') === String(auth.user.organization_id || '')
      ));
      const pool = deployed.length > 0 ? deployed : candidates.filter((definition) => !definition.organization_id);
      pool.sort((a, b) => {
        const versionDelta = Number(b.version || 0) - Number(a.version || 0);
        if (versionDelta !== 0) return versionDelta;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });
      if (pool[0]) definitionsBySlug.set(slug, pool[0]);
    }
    definitionsById = new Map(
      allDefinitions.map((definition) => [String(definition.id), definition])
    );
    matterAliasesById = new Map();
    const matters = Array.isArray(mattersBody)
      ? mattersBody
      : (mattersBody.matters || mattersBody.data || mattersBody.items || []);
    for (const matter of matters) {
      const canonicalId = String(matter.id || matter.matter_id || '');
      if (!canonicalId) continue;
      const aliases = new Set([canonicalId]);
      ['matter_id', 'matterId', 'matter_number', 'matterNumber', 'number'].forEach((key) => {
        if (matter[key] !== null && matter[key] !== undefined && matter[key] !== '') {
          aliases.add(String(matter[key]));
        }
      });
      matterAliasesById.set(canonicalId, aliases);
    }
    latestRunsBySlug = new Map();
    for (const run of runsBody.runs || []) {
      const definition = definitionsById.get(String(run.agent_definition_id));
      const slug = definition && (definition.template_slug || definition.slug);
      if (!CATALOG_AGENTS.includes(slug)) continue;
      if (String(run.created_by || '') !== String(auth.user && auth.user.id || '')) continue;
      if (REJECTED_RUN_STATUSES.has(String(run.status || '').toLowerCase())) continue;
      if (!SETTLED_AUDIT_STATUSES.has(String(run.status || '').toLowerCase())) continue;
      const canonical = definitionsBySlug.get(slug);
      if (!canonical || String(canonical.id) !== String(run.agent_definition_id)) continue;
      if (!latestRunsBySlug.has(slug)) latestRunsBySlug.set(slug, run);
    }
  });

  test('run details reject unauthenticated access', async ({ request }) => {
    const response = await request.get(API_BASE_URL + '/api/v1/agent-runs?limit=1');
    expect([401, 403]).toContain(response.status());
  });

  for (const slug of CATALOG_AGENTS) {
    test(slug + ' has appropriate persisted scope, steps, approvals, and output', async ({ request }, testInfo) => {
      const definition = definitionsBySlug.get(slug);
      expect(definition, `missing canonical ${slug} definition`).toBeTruthy();
      const selected = latestRunsBySlug.get(slug);
      expect(selected, `no successful ${slug} run by the configured test user`).toBeTruthy();

      const body = await apiJson(
        request,
        auth,
        'GET',
        '/api/v1/agent-runs/' + encodeURIComponent(selected.id)
      );
      const envelope = readRunEnvelope(body);
      const run = envelope.run;
      const organizationId = String(run.organization_id || '');
      const userOrganizationId = String(auth.user && auth.user.organization_id || '');
      const supportedScopes = definition.run_scopes || [];

      expect(run.id).toBe(selected.id);
      expect(run.created_by).toBe(auth.user.id);
      expect(userOrganizationId, 'authenticated test user must expose an organization scope').toBeTruthy();
      expect(organizationId).toBe(userOrganizationId);
      expect(supportedScopes).toContain(run.run_scope);
      if (run.run_scope === 'workspace') {
        expect(run.matter_id).toBeTruthy();
      } else {
        expect(run.run_scope).toBe('system');
        expect(run.matter_id).toBeNull();
      }

      const runtime = asObject(asObject(run.output_jsonb).__runtime);
      expect(runtime.runtime_type).toBe('lana_native');
      expect(runtime.runtime_mode).toBe('native');
      expect(runtime.hermes_run_id).toBeNull();
      expect(runtime.hermes_runtime_run_id).toBeNull();

      const manifestWrapper = envelope.legalHarnessManifest;
      expect(manifestWrapper, `${slug} is missing its legal harness manifest`).toBeTruthy();
      expect(manifestWrapper.status).toBe('completed');
      expect(manifestWrapper.state).toBe('enabled');
      const manifest = asObject(manifestWrapper.manifest);
      expect(manifest.schema_version).toBe('agent_run_legal_manifest.v1');
      expect(manifest.feature_flag_enabled).toBe(true);
      expect(manifest.run).toMatchObject({
        id: run.id,
        organization_id: run.organization_id,
        matter_id: run.matter_id,
        created_by: run.created_by,
      });
      expect(manifest.runtime).toMatchObject({ runtime_type: 'lana_native', runtime_mode: 'native' });
      for (const toolName of manifest.agent_definition.allowed_tools || []) {
        expect(definition.allowed_tools || [], `${slug} historical manifest contains a tool no longer permitted`)
          .toContain(toolName);
      }
      for (const artifactKind of manifest.agent_definition.artifact_kinds || []) {
        expect(approvalKinds(definition), `${slug} historical manifest contains an undeclared artifact kind`)
          .toContain(artifactKind);
      }
      expect(manifest.active_policy).toMatchObject({
        allow_reads: true,
        allow_artifact_proposals: true,
        allow_writes: false,
        allow_cross_matter: false,
        allow_disclosure: false,
        allow_external_communication: false,
        allow_automation_execution: false,
        fail_closed_unknown: true,
        errors: [],
      });

      const sourceRuns = new Map([[String(run.id), run]]);
      envelope.childRuns.forEach((child) => sourceRuns.set(String(child.id), child));
      const indicesByRun = new Map();
      const failedToolSteps = [];
      for (const step of envelope.steps) {
        expect(step.organization_id).toBe(run.organization_id);
        const sourceRunId = String(step.source_run_id || step.run_id || run.id);
        const sourceRun = sourceRuns.get(sourceRunId);
        expect(sourceRun, `${slug} step points at an unknown source run`).toBeTruthy();
        if (!indicesByRun.has(sourceRunId)) indicesByRun.set(sourceRunId, []);
        indicesByRun.get(sourceRunId).push(step.step_index);

        if (step.tool_name) {
          const sourceDefinition = definitionsById.get(String(sourceRun.agent_definition_id));
          expect(sourceDefinition, `${slug} step definition is unavailable`).toBeTruthy();
          expect(sourceDefinition.allowed_tools || [], `${slug} called undeclared tool ${step.tool_name}`)
            .toContain(step.tool_name);
          if (step.status === 'error' || step.status === 'errored' || (step.tool_output && step.tool_output.success === false)) {
            failedToolSteps.push(step);
          }
        }

        const directMatterValues = ['matter_id', 'matterId']
          .filter((key) => step.tool_input && Object.prototype.hasOwnProperty.call(step.tool_input, key))
          .map((key) => String(step.tool_input[key]));
        const allowedMatterAliases = matterAliasesById.get(String(run.matter_id))
          || new Set([String(run.matter_id)]);
        if (run.run_scope === 'workspace') {
          directMatterValues.forEach((value) => expect(allowedMatterAliases.has(value)).toBe(true));
        } else {
          expect(directMatterValues, `${slug} system run leaked into a workspace`).toEqual([]);
        }
        const organizationValues = collectScopedValues(
          [step.tool_input, step.tool_output],
          new Set(['organization_id', 'organizationId'])
        );
        organizationValues.forEach((value) => expect(value).toBe(organizationId));
      }
      for (const indices of indicesByRun.values()) {
        const numeric = indices.map(Number);
        expect(new Set(numeric).size, `${slug} has duplicate step indices`).toBe(numeric.length);
        expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
      }

      const badRuntimeEvent = envelope.runtimeEvents.find((event) => (
        event.runtime_type && event.runtime_type !== 'lana_native'
      ));
      expect(badRuntimeEvent, `${slug} contains a non-native runtime event`).toBeUndefined();

      const artifactKinds = envelope.artifacts.map((artifact) => artifact.kind);
      for (const kind of REQUIRED_ARTIFACT_KINDS[slug] || []) {
        expect(artifactKinds, `${slug} is missing required ${kind}`).toContain(kind);
      }
      expect(envelope.artifacts.length, `${slug} produced no reviewable output`).toBeGreaterThan(0);
      expect(run.status, `${slug} must remain parked for approval`).toBe('awaiting_approval');
      expect(asObject(run.output_jsonb).awaiting_approval).toBe(true);
      expect(envelope.outcome, 'awaiting-approval runs must not claim a terminal outcome').toBeNull();

      for (const artifact of envelope.artifacts) {
        expect(artifact.organization_id).toBe(run.organization_id);
        expect(APPROVAL_SAFE_ARTIFACT_STATUSES).toContain(String(artifact.status || '').toLowerCase());
        expect(artifact.approval_id, `${slug}/${artifact.kind} is missing its approval request`).toBeTruthy();
        expect(artifact.applied_at).toBeNull();
        expect(artifact.apply_receipt_jsonb || null).toBeNull();
        const approvalHistory = artifact.approval_decisions || [];
        expect(approvalHistory.length, `${slug}/${artifact.kind} has no approval request history`).toBeGreaterThan(0);
        const currentApprovalHistory = approvalHistory.filter((entry) => entry.approval_id === artifact.approval_id);
        expect(
          currentApprovalHistory.length,
          `${slug}/${artifact.kind} current approval is absent from its history`
        ).toBeGreaterThan(0);
        for (const entry of currentApprovalHistory) {
          expect(entry.approval_status).toBe('pending');
        }
        expect(currentApprovalHistory.some((entry) => entry.to_status === 'pending')).toBe(true);
        expect(artifact.application_gate_failure || null).toBeNull();
        expect(artifact.validation, `${slug}/${artifact.kind} has no validation row`).toBeTruthy();
        expect(artifact.validation.status).toBe('valid');
        expect(artifact.validation.errors_jsonb || null).toBeNull();

        const sourceRun = sourceRuns.get(String(artifact.source_run_id || artifact.run_id || run.id));
        const sourceDefinition = definitionsById.get(String(sourceRun && sourceRun.agent_definition_id));
        expect(sourceDefinition, `${slug}/${artifact.kind} source definition is unavailable`).toBeTruthy();
        expect(approvalKinds(sourceDefinition), `${slug} proposed undeclared artifact ${artifact.kind}`)
          .toContain(artifact.kind);

        if (run.run_scope === 'workspace') {
          expect(artifact.matter_id).toBe(run.matter_id);
        } else {
          expect(artifact.matter_id).toBeNull();
        }
        const matterValues = collectScopedValues(contentForArtifact(artifact), new Set(['matter_id', 'matterId']));
        const allowedMatterAliases = matterAliasesById.get(String(run.matter_id))
          || new Set([String(run.matter_id)]);
        matterValues.forEach((value) => expect(allowedMatterAliases.has(value)).toBe(true));
        assertArtifactSemantics(slug, artifact, envelope);
      }

      const erroredRunSteps = envelope.runSteps.filter((step) => step.status === 'errored');
      if (failedToolSteps.length > 0 || erroredRunSteps.length > 0) {
        // A read failure is appropriate only when the final artifact clearly
        // discloses the access/data gap and remains unapplied for review.
        expect(
          [...failedToolSteps, ...erroredRunSteps].every((step) => (
            String(step.tool_name || step.step_id || '').includes('query_analytics_data')
          )),
          `${slug} contains an undisclosed/non-analytics errored step`
        ).toBe(true);
        const disclosure = JSON.stringify(envelope.artifacts.map(contentForArtifact));
        expect(disclosure).toMatch(/unavailable|could not|failed|missing|gap|authorize/i);
      }

      const auditSummary = {
        agent: slug,
        run_id: run.id,
        status: run.status,
        run_scope: run.run_scope,
        organization_id: run.organization_id,
        matter_id: run.matter_id,
        runtime_type: runtime.runtime_type,
        legal_policy: manifest.active_policy,
        tool_steps: envelope.steps.filter((step) => step.tool_name).map((step) => ({
          index: step.step_index,
          tool: step.tool_name,
          status: step.status,
          success: step.tool_output ? step.tool_output.success !== false : null,
        })),
        artifacts: envelope.artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.kind,
          status: artifact.status,
          validation_status: artifact.validation && artifact.validation.status,
          approval_id: artifact.approval_id,
          applied_at: artifact.applied_at,
        })),
      };
      await testInfo.attach(slug + '-audit.json', {
        body: Buffer.from(JSON.stringify(auditSummary, null, 2)),
        contentType: 'application/json',
      });
    });
  }
});

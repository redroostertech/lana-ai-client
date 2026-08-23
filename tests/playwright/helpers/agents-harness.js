'use strict';

const fs = require('fs');
const path = require('path');

const API_BASE_URL = String(process.env.LANA_E2E_API_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const DEFAULT_CREDENTIALS_FILE = path.resolve(
  __dirname,
  '../../../../lana-ai-chef/scripts/dev/.credentials'
);

const CATALOG_AGENTS = Object.freeze([
  'matter-architect',
  'automation-drafter',
  'document-reviewer',
  'ai-paralegal',
  'timeline-risk-analyst',
  'connector-triage',
  'insights-reporter',
  'cash-application-specialist',
  'roadmap-architect',
  'brief-decomposer',
  'workstream-planner',
  'task-generator',
  'onboarding-navigator',
]);

const REQUIRED_ARTIFACT_KINDS = Object.freeze({
  'matter-architect': ['matter_plan'],
  'automation-drafter': ['automation_rule'],
  'document-reviewer': ['matter_review_summary'],
  'ai-paralegal': [],
  'timeline-risk-analyst': ['workspace_timeline_risk_report'],
  'connector-triage': [],
  'insights-reporter': ['narrative_report'],
  'cash-application-specialist': ['cash_application_batch'],
  // The stateful Roadmap Architect always emits a meeting summary. A PRD is
  // intentionally skipped for short/tactical recordings and when transcript
  // scope is unavailable, so it cannot be an unconditional live assertion.
  'roadmap-architect': ['meeting_summary'],
  'brief-decomposer': ['requirement_set'],
  'workstream-planner': ['workstream_set'],
  'task-generator': ['task_batch'],
  'onboarding-navigator': ['dashboard_widget_batch', 'task_batch'],
});

const WORKSPACE_ONLY = new Set([
  'matter-architect',
  'document-reviewer',
  'ai-paralegal',
  'timeline-risk-analyst',
  'brief-decomposer',
  'workstream-planner',
  'task-generator',
  'onboarding-navigator',
]);

function readCredentialsFile() {
  const credentialsPath = process.env.LANA_E2E_CREDENTIALS_FILE || DEFAULT_CREDENTIALS_FILE;
  if (!credentialsPath || !fs.existsSync(credentialsPath)) return {};
  const values = {};
  fs.readFileSync(credentialsPath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/);
    if (match) values[match[1]] = match[2].trim();
  });
  return values;
}

function resolveAuthConfiguration() {
  const file = readCredentialsFile();
  return {
    token: process.env.LANA_E2E_TOKEN || '',
    email: process.env.LANA_E2E_EMAIL || file.LANA_E2E_EMAIL || file.EMAIL || '',
    password: process.env.LANA_E2E_PASSWORD || file.LANA_E2E_PASSWORD || file.PASSWORD || '',
    userId: process.env.LANA_E2E_USER_ID || '',
    organizationId: process.env.LANA_E2E_ORG_ID || '',
  };
}

function hasAuthConfiguration() {
  const config = resolveAuthConfiguration();
  return Boolean(config.token || (config.email && config.password));
}

function isTransientTransportError(error) {
  const message = String(error && error.message || error || '');
  return /ECONNREFUSED|ECONNRESET|socket hang up|fetch failed|Target page, context or browser has been closed/i.test(message);
}

async function retryTransientTransport(operation, attempts = 8, delayMs = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientTransportError(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function authenticate(request) {
  const config = resolveAuthConfiguration();
  if (config.token) {
    return {
      token: config.token,
      user: { id: config.userId, organization_id: config.organizationId },
    };
  }
  if (!hasAuthConfiguration()) {
    throw new Error('Set LANA_E2E_TOKEN or both LANA_E2E_EMAIL and LANA_E2E_PASSWORD.');
  }
  const response = await retryTransientTransport(() => request.post(API_BASE_URL + '/api/v1/auth/login', {
    data: {
      email: config.email,
      password: config.password,
    },
  }));
  if (!response.ok()) {
    throw new Error(`LANA login failed (${response.status()}): ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.token) throw new Error('LANA login response did not include a token.');
  let user = body.user || {};
  // The login response is intentionally compact in some Chef builds. Enrich
  // it from the authenticated session endpoint so live audits can verify the
  // persisted run tenant against the actual test user without trusting an
  // environment-supplied organization id.
  try {
    const me = await retryTransientTransport(() => request.get(API_BASE_URL + '/api/v1/auth/me', {
      headers: { Authorization: 'Bearer ' + body.token },
    }));
    if (me.ok()) {
      const meBody = await me.json();
      user = { ...user, ...(meBody && meBody.user || {}) };
    }
  } catch (_error) {
    // The run envelope remains authoritative if a legacy build lacks /me.
  }
  return { token: body.token, user };
}

function authHeaders(auth) {
  return { Authorization: 'Bearer ' + auth.token };
}

async function apiJson(request, auth, method, pathname, data) {
  const execute = () => request.fetch(API_BASE_URL + pathname, {
    method,
    headers: authHeaders(auth),
    data,
  });
  // Retrying read-only polling is safe across a brief local API restart.
  // Mutating requests remain single-attempt to avoid duplicate agent runs or
  // duplicate approval decisions when a response is lost after persistence.
  const response = String(method).toUpperCase() === 'GET'
    ? await retryTransientTransport(execute)
    : await execute();
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_err) { body = { raw: text }; }
  if (!response.ok()) {
    throw new Error(`${method} ${pathname} failed (${response.status()}): ${text.slice(0, 1000)}`);
  }
  return body;
}

async function listCatalogAgents(request, auth) {
  const body = await apiJson(request, auth, 'GET', '/api/v1/agents?include_system=true&active_only=true');
  const catalog = new Map();
  const preferDeployed = process.env.LANA_E2E_PREFER_DEPLOYED === '1';
  (body && body.agents || []).forEach((agent) => {
    if (!agent) return;
    const slug = agent.template_slug || agent.slug;
    if (!CATALOG_AGENTS.includes(slug)) return;

    // `discoverable` controls whether an agent can be found from LANA chat;
    // it does not hide templates or deployed agents from Agent Studio. The
    // canonical sweep exercises system templates. Set LANA_E2E_PREFER_DEPLOYED
    // to validate an organization's installed copy as an additional pass.
    const existing = catalog.get(slug);
    const agentIsDeployed = Boolean(agent.organization_id);
    const existingIsDeployed = Boolean(existing && existing.organization_id);
    if (!existing || (preferDeployed ? (!existingIsDeployed && agentIsDeployed) : (existingIsDeployed && !agentIsDeployed))) {
      catalog.set(slug, agent);
    }
  });
  return CATALOG_AGENTS.map((slug) => catalog.get(slug)).filter(Boolean);
}

async function findWorkspace(request, auth) {
  const body = await apiJson(request, auth, 'GET', '/api/v1/matters?page=1&limit=100&status=active');
  const rows = Array.isArray(body)
    ? body
    : (body && (body.matters || body.data || body.items) || []);
  const requested = process.env.LANA_E2E_MATTER_ID;
  const workspace = requested
    ? rows.find((row) => [row.id, row.matter_id].filter(Boolean).map(String).includes(requested))
    : rows[0];
  return workspace ? String(workspace.id || workspace.matter_id) : null;
}

function runInputFor(slug) {
  const sharedGoal = `Playwright behavior check for ${slug}. Produce the smallest grounded, reviewable outcome supported by the available data.`;
  const inputs = {
    'automation-drafter': {
      goal: 'Draft a disabled weekly automation that summarizes overdue work for internal review. Do not enable or execute it.',
    },
    'ai-paralegal': {
      goal: 'Review the workspace for missing onboarding documents and produce the smallest grounded paralegal work product.',
      work_type: 'missing_document_report',
    },
    'insights-reporter': {
      goal: 'Create a concise seven-day operating report from permitted Chef and connector-ingested analytics. Cite every metric.',
      report_window: 'last_7_days',
    },
    'cash-application-specialist': {
      goal: 'Review the smallest available sample of incoming payments and open invoices. Propose matches or clearly report the data gap.',
    },
    'roadmap-architect': {
      goal: 'Extract a concise meeting summary, PRD draft, action items, and open questions from the supplied recording.',
      recording_id: process.env.LANA_E2E_RECORDING_ID || '',
    },
    'workstream-planner': {
      goal: 'Turn this validated requirement set into a minimal grounded workstream plan.',
      requirement_set: {
        title: 'Playwright validation requirement',
        requirements: [{ id: 'REQ-1', text: 'Review the available workspace context and produce a verified deliverable.', priority: 'high' }],
      },
    },
    'task-generator': {
      goal: 'Create a small task batch for this workstream without duplicating existing workspace tasks.',
      workstream: { name: 'Playwright validation', scope: 'Produce and verify one grounded deliverable.' },
    },
  };
  return inputs[slug] || { goal: sharedGoal };
}

function shouldSkipAgent(slug) {
  if (slug === 'roadmap-architect' && !process.env.LANA_E2E_RECORDING_ID) {
    return 'Set LANA_E2E_RECORDING_ID to exercise the transcript-backed Roadmap Architect.';
  }
  const filter = String(process.env.LANA_E2E_AGENTS || process.env.LANA_E2E_AGENT || '').trim();
  const selected = filter.split(',').map((value) => value.trim()).filter(Boolean);
  if (selected.length > 0 && !selected.includes(slug)) {
    return `Filtered by LANA_E2E_AGENTS=${selected.join(',')}`;
  }
  return '';
}

function readRunEnvelope(body) {
  const data = body && body.data || body || {};
  const run = data.run || body && body.run || data;
  const artifacts = data.artifacts || body && body.artifacts || run.artifacts || [];
  const outcome = data.outcome || body && body.outcome || run.outcome || null;
  return {
    run,
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    outcome,
    steps: Array.isArray(data.steps) ? data.steps : [],
    runSteps: Array.isArray(data.run_steps) ? data.run_steps : [],
    runtimeEvents: Array.isArray(data.runtime_events) ? data.runtime_events : [],
    legalHarnessManifest: data.legal_harness_manifest || null,
    childRuns: Array.isArray(data.child_runs) ? data.child_runs : [],
  };
}

async function pollRun(request, auth, runId, timeoutMs) {
  const startedAt = Date.now();
  const settled = new Set(['awaiting_approval', 'awaiting_input', 'completed', 'failed', 'rejected', 'cancelled']);
  let envelope = null;
  while (Date.now() - startedAt < timeoutMs) {
    const body = await apiJson(request, auth, 'GET', '/api/v1/agent-runs/' + encodeURIComponent(runId));
    envelope = readRunEnvelope(body);
    if (settled.has(envelope.run.status || envelope.run.execution_status)) return envelope;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Run ${runId} did not settle within ${timeoutMs}ms. Last status: ${envelope && (envelope.run.status || envelope.run.execution_status)}`);
}

async function installBrowserAuth(page, auth) {
  // The local static harness proxies /api to Chef, matching the production
  // same-origin path and avoiding a test-only CORS exception in the backend.
  const useSameOriginProxy = process.env.LANA_E2E_USE_CLIENT_PROXY === '1'
    || !process.env.LANA_E2E_CLIENT_URL;
  const apiUrl = useSameOriginProxy ? '' : API_BASE_URL;
  await page.route('**/js/config.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: body + `\nwindow.LanaConfig.API_BASE_URL = ${JSON.stringify(apiUrl)};\n`,
    });
  });
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user || {}));
  }, auth);
}

module.exports = {
  API_BASE_URL,
  CATALOG_AGENTS,
  REQUIRED_ARTIFACT_KINDS,
  WORKSPACE_ONLY,
  hasAuthConfiguration,
  authenticate,
  authHeaders,
  apiJson,
  listCatalogAgents,
  findWorkspace,
  runInputFor,
  shouldSkipAgent,
  readRunEnvelope,
  pollRun,
  installBrowserAuth,
};

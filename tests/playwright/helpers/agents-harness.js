'use strict';

const API_BASE_URL = String(process.env.LANA_E2E_API_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

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
  'roadmap-architect': ['meeting_summary', 'prd_draft'],
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

function hasAuthConfiguration() {
  return Boolean(
    process.env.LANA_E2E_TOKEN
    || (process.env.LANA_E2E_EMAIL && process.env.LANA_E2E_PASSWORD)
  );
}

async function authenticate(request) {
  if (process.env.LANA_E2E_TOKEN) {
    return {
      token: process.env.LANA_E2E_TOKEN,
      user: { id: process.env.LANA_E2E_USER_ID || '', organization_id: process.env.LANA_E2E_ORG_ID || '' },
    };
  }
  if (!hasAuthConfiguration()) {
    throw new Error('Set LANA_E2E_TOKEN or both LANA_E2E_EMAIL and LANA_E2E_PASSWORD.');
  }
  const response = await request.post(API_BASE_URL + '/api/v1/auth/login', {
    data: {
      email: process.env.LANA_E2E_EMAIL,
      password: process.env.LANA_E2E_PASSWORD,
    },
  });
  if (!response.ok()) {
    throw new Error(`LANA login failed (${response.status()}): ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.token) throw new Error('LANA login response did not include a token.');
  return { token: body.token, user: body.user || {} };
}

function authHeaders(auth) {
  return { Authorization: 'Bearer ' + auth.token };
}

async function apiJson(request, auth, method, pathname, data) {
  const response = await request.fetch(API_BASE_URL + pathname, {
    method,
    headers: authHeaders(auth),
    data,
  });
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
  return (body && body.agents || []).filter((agent) => (
    agent
    && CATALOG_AGENTS.includes(agent.template_slug || agent.slug)
    && agent.discoverable !== false
  ));
}

async function findWorkspace(request, auth) {
  const body = await apiJson(request, auth, 'GET', '/api/v1/matters?page=1&limit=100&status=active');
  const rows = Array.isArray(body)
    ? body
    : (body && (body.matters || body.data || body.items) || []);
  const requested = process.env.LANA_E2E_MATTER_ID;
  const workspace = requested
    ? rows.find((row) => String(row.matter_id || row.id) === requested)
    : rows[0];
  return workspace ? String(workspace.matter_id || workspace.id) : null;
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
  const filter = String(process.env.LANA_E2E_AGENT || '').trim();
  if (filter && filter !== slug) return `Filtered by LANA_E2E_AGENT=${filter}`;
  return '';
}

function readRunEnvelope(body) {
  const data = body && body.data || body || {};
  const run = data.run || body && body.run || data;
  const artifacts = data.artifacts || body && body.artifacts || run.artifacts || [];
  return { run, artifacts: Array.isArray(artifacts) ? artifacts : [] };
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
  const apiUrl = API_BASE_URL;
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

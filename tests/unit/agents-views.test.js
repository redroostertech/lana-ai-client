/**
 * Unit tests for Agent Studio view helpers.
 *
 * The view modules are IIFEs that attach to `window.LanaAgentsApp.Views`
 * and expose pure helpers via `__test` for unit testing. We load each
 * file into a sandboxed VM context and exercise the `__test` surface.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createContext() {
  const ctx = {
    console: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    setTimeout,
    clearTimeout,
    document: {
      createElement: () => ({ textContent: '', innerHTML: '' }),
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null
    },
    sessionStorage: {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

function loadView(relPath, context) {
  const abs = path.join(__dirname, '..', '..', relPath);
  const code = fs.readFileSync(abs, 'utf8');
  vm.runInContext(code, context);
}

// ---------------------------------------------------------------------------
// agent-create.js
// ---------------------------------------------------------------------------

describe('agent-create view: pure helpers', () => {
  let testApi;

  beforeAll(() => {
    const ctx = createContext();
    loadView('src/agents/js/views/agent-create.js', ctx);
    testApi = ctx.window.LanaAgentsApp.Views.create.__test;
  });

  test('exposes the test surface', () => {
    expect(testApi).toBeTruthy();
    expect(typeof testApi.buildCreateBody).toBe('function');
    expect(typeof testApi.formatMissingConnectorsMessage).toBe('function');
    expect(typeof testApi.computeFallbackRecentTools).toBe('function');
    expect(typeof testApi.parseClaudeSource).toBe('function');
    expect(typeof testApi.mapClaudeImport).toBe('function');
    expect(typeof testApi.recommendTemplateForGoal).toBe('function');
    expect(typeof testApi.templateNeedsWorkspace).toBe('function');
    expect(typeof testApi.buildFirstRunBody).toBe('function');
    expect(typeof testApi.runModeToSchedule).toBe('function');
  });

  describe('buildCreateBody', () => {
    test('returns null when no template is selected', () => {
      const out = testApi.buildCreateBody({ selectedTpl: null }, { name: 'X', selectedTools: [] });
      expect(out).toBeNull();
    });

    test('builds the canonical POST body for a happy path', () => {
      const state = { selectedTpl: { slug: 'connector-triage', name: 'Connector Triage' } };
      const out = testApi.buildCreateBody(state, {
        name: '  My Agent  ',
        description: '  helpful  ',
        modelSlot: 'agentic',
        selectedTools: ['search_documents', 'clone_matter'],
        scheduleEnabled: false,
        discoverable: true
      });
      expect(out).toEqual({
        template_slug: 'connector-triage',
        name: 'My Agent',
        description: 'helpful',
        allowed_tools: ['search_documents', 'clone_matter'],
        discoverable: true,
        model_slot: 'agentic'
      });
    });

    test('falls back to template name when display name is empty', () => {
      const state = { selectedTpl: { slug: 'a', name: 'Agent A' } };
      const out = testApi.buildCreateBody(state, { name: '', selectedTools: [], discoverable: false });
      expect(out.name).toBe('Agent A');
    });

    test('embeds schedule block when scheduleEnabled is true', () => {
      const state = { selectedTpl: { slug: 'a', name: 'Agent A' } };
      const out = testApi.buildCreateBody(state, {
        name: 'X',
        selectedTools: [],
        discoverable: false,
        scheduleEnabled: true,
        scheduleCron: '0 9 * * 1-5',
        scheduleTimezone: 'America/Chicago'
      });
      expect(out.schedule).toEqual({ enabled: true, cron: '0 9 * * 1-5', timezone: 'America/Chicago' });
    });

    test('omits model_slot when not provided', () => {
      const state = { selectedTpl: { slug: 'a', name: 'A' } };
      const out = testApi.buildCreateBody(state, { name: 'X', selectedTools: [], discoverable: false });
      expect(Object.prototype.hasOwnProperty.call(out, 'model_slot')).toBe(false);
    });

    test('keeps migration metadata and the optional first task out of the definition payload', () => {
      const state = { selectedTpl: { slug: 'a', name: 'A' } };
      const out = testApi.buildCreateBody(state, {
        name: 'Imported helper',
        description: 'Creates a weekly summary.',
        selectedTools: ['search_documents'],
        discoverable: false,
        sourceText: 'private CLAUDE.md instructions',
        firstTask: 'Create the first summary'
      });

      expect(out).not.toHaveProperty('sourceText');
      expect(out).not.toHaveProperty('firstTask');
      expect(out).toEqual({
        template_slug: 'a',
        name: 'Imported helper',
        description: 'Creates a weekly summary.',
        allowed_tools: ['search_documents'],
        discoverable: false
      });
    });
  });

  describe('formatMissingConnectorsMessage', () => {
    test('lists all missing connector ids', () => {
      const msg = testApi.formatMissingConnectorsMessage(['gmail', 'salesforce']);
      expect(msg).toContain('gmail');
      expect(msg).toContain('salesforce');
    });

    test('falls back to a generic message when given garbage', () => {
      expect(testApi.formatMissingConnectorsMessage(null)).toContain('not yet connected');
      expect(testApi.formatMissingConnectorsMessage([])).toContain('not yet connected');
    });
  });

  describe('computeFallbackRecentTools', () => {
    test('returns alphabetical first 10 across all template tools (deduped)', () => {
      const state = {
        templates: [
          { allowed_tools: ['search_documents', 'clone_matter', 'send_email'] },
          { allowed_tools: ['archive_matter', 'search_documents'] }
        ]
      };
      const out = testApi.computeFallbackRecentTools(state);
      expect(out).toEqual(['archive_matter', 'clone_matter', 'search_documents', 'send_email']);
    });

    test('caps the list at 10 entries', () => {
      const tools = [];
      for (let i = 0; i < 30; i += 1) {
        tools.push('tool_' + (i < 10 ? '0' + i : i));
      }
      const state = { templates: [{ allowed_tools: tools }] };
      const out = testApi.computeFallbackRecentTools(state);
      expect(out.length).toBe(10);
    });
  });

  describe('Claude migration mapping', () => {
    test('extracts a Markdown heading and first useful paragraph locally', () => {
      const parsed = testApi.parseClaudeSource([
        '# Client Follow-up Agent',
        '',
        'Reviews client messages and prepares a prioritized follow-up list.',
        '',
        '## Instructions',
        '- Use the search_documents tool.'
      ].join('\n'), 'CLAUDE.md');

      expect(parsed.name).toBe('Client Follow-up Agent');
      expect(parsed.description).toContain('Reviews client messages');
      expect(parsed.sourceKind).toBe('Claude Markdown');
    });

    test('extracts Claude JSON identity and MCP/tool hints', () => {
      const parsed = testApi.parseClaudeSource(JSON.stringify({
        name: 'Research Helper',
        description: 'Find the right documents.',
        tools: [{ name: 'search_documents' }],
        mcpServers: { notion: { command: 'npx' } }
      }), 'agent.json');

      expect(parsed.name).toBe('Research Helper');
      expect(parsed.requestedTools).toEqual(['search_documents', 'notion']);
      expect(parsed.sourceKind).toBe('Claude JSON');
    });

    test('maps imported intent to the closest governed template and allowed tools', () => {
      const imported = testApi.parseClaudeSource(
        '# Document Reviewer\nReview agreements with search_documents and summarize risks.',
        'CLAUDE.md'
      );
      const mapping = testApi.mapClaudeImport(imported, [
        { slug: 'connector-triage', name: 'Connector Triage', description: 'Diagnose integrations', allowed_tools: ['connector_health'] },
        { slug: 'document-reviewer', name: 'Document Reviewer', description: 'Review documents and agreements', allowed_tools: ['search_documents'] }
      ]);

      expect(mapping.template.slug).toBe('document-reviewer');
      expect(mapping.mappedTools).toEqual(['search_documents']);
    });
  });

  describe('guided recommendation and pilot context', () => {
    const templates = [
      { slug: 'connector-triage', name: 'Connector Triage', description: 'Diagnose broken integrations', allowed_tools: ['connector_health'], context_providers: [{ slug: 'connector', scope: 'org' }] },
      { slug: 'document-reviewer', name: 'Document Reviewer', description: 'Review documents and agreements', allowed_tools: ['search_documents'], context_providers: [{ slug: 'core', scope: 'matter' }] }
    ];

    test('recommends a governed starting point from a plain-language job', () => {
      const mapping = testApi.recommendTemplateForGoal('Review client agreements and summarize document risks.', templates);
      expect(mapping.template.slug).toBe('document-reviewer');
    });

    test('detects when a starting point needs a selected workspace', () => {
      expect(testApi.templateNeedsWorkspace(templates[1])).toBe(true);
      expect(testApi.templateNeedsWorkspace(templates[0])).toBe(false);
    });

    test('includes workspace context in the real first run but not the definition', () => {
      expect(testApi.buildFirstRunBody('  Review this workspace  ', 'matter-123')).toEqual({
        input: 'Review this workspace',
        title: 'Review this workspace',
        matter_id: 'matter-123'
      });
    });
  });

  describe('plain-language schedules', () => {
    test('keeps on-demand agents unscheduled', () => {
      expect(testApi.runModeToSchedule('on_demand', 'UTC', '')).toBeNull();
    });

    test('maps weekday mornings to the backend schedule contract', () => {
      expect(testApi.runModeToSchedule('weekday_morning', 'America/New_York', '')).toEqual({
        enabled: true,
        cron: '0 9 * * 1-5',
        timezone: 'America/New_York'
      });
    });

    test('passes through an advanced schedule only when supplied', () => {
      expect(testApi.runModeToSchedule('advanced', 'UTC', '')).toBeNull();
      expect(testApi.runModeToSchedule('advanced', 'UTC', '15 8 * * 2')).toEqual({
        enabled: true,
        cron: '15 8 * * 2',
        timezone: 'UTC'
      });
    });
  });
});

// ---------------------------------------------------------------------------
// catalog.js
// ---------------------------------------------------------------------------

describe('agent catalog view: run context helpers', () => {
  let testApi;

  beforeAll(() => {
    const ctx = createContext();
    loadView('src/agents/js/views/catalog.js', ctx);
    testApi = ctx.window.LanaAgentsApp.Views.catalog.__test;
  });

  test('requires a workspace only for matter-scoped agents', () => {
    expect(testApi.agentNeedsWorkspace({ context_providers: [{ slug: 'core', scope: 'matter' }] })).toBe(true);
    expect(testApi.agentNeedsWorkspace({ context_providers: [{ slug: 'connector', scope: 'org' }] })).toBe(false);
  });

  test('builds the Chef run payload with the selected workspace', () => {
    expect(testApi.buildRunPayload('  Prepare the weekly review  ', 'matter-42')).toEqual({
      input: 'Prepare the weekly review',
      title: 'Prepare the weekly review',
      matter_id: 'matter-42'
    });
  });
});

// ---------------------------------------------------------------------------
// agent-detail.js
// ---------------------------------------------------------------------------

describe('agent-detail view: editing and teaching helpers', () => {
  let testApi;

  beforeAll(() => {
    const ctx = createContext();
    loadView('src/agents/js/views/agent-detail.js', ctx);
    testApi = ctx.window.LanaAgentsApp.Views.agentDetail.__test;
  });

  test('humanizes technical tool ids for non-technical users', () => {
    expect(testApi.humanizeToolName('search_documents')).toBe('Search documents');
    expect(testApi.humanizeToolName('lana-clone-matter')).toBe('Clone matter');
  });

  test('summarizes governed approval policies without replacing their object shape', () => {
    expect(testApi.approvalPolicySummary({ required: true, required_for: 'all' }))
      .toBe('A teammate must approve every proposed action.');
    expect(testApi.approvalPolicySummary({ required: true, artifact_kinds: ['proposed_change'] }))
      .toContain('sensitive actions');
    expect(testApi.approvalPolicySummary(null)).toContain('No approval');
  });

  test('builds a reviewable teaching example and rejects blank messages', () => {
    expect(testApi.buildTeachingExample('   ', '2026-01-01T00:00:00.000Z')).toBeNull();
    expect(testApi.buildTeachingExample('  Put the recommendation first.  ', '2026-01-01T00:00:00.000Z'))
      .toEqual({
        instruction: 'Put the recommendation first.',
        created_at: '2026-01-01T00:00:00.000Z',
        review_status: 'draft'
      });
  });

  test('shows working context in plain language and carries it into runs', () => {
    expect(testApi.contextProviderLabel({ slug: 'custom-fields', scope: 'matter' })).toBe('Business fields');
    expect(testApi.agentNeedsWorkspace({ context_providers: [{ slug: 'tasks', scope: 'matter' }] })).toBe(true);
    expect(testApi.buildRunPayload('  Draft the update  ', 'matter-7')).toEqual({
      input: 'Draft the update',
      title: 'Draft the update',
      matter_id: 'matter-7'
    });
  });
});

// ---------------------------------------------------------------------------
// activity-detail.js
// ---------------------------------------------------------------------------

describe('activity-detail view: verification and deliverable helpers', () => {
  let testApi;

  beforeAll(() => {
    const ctx = createContext();
    loadView('src/agents/js/views/activity-detail.js', ctx);
    testApi = ctx.window.LanaAgentsApp.Views.activityDetail.__test;
  });

  test('keeps proposed artifacts visible while a run awaits approval', () => {
    const artifacts = [
      { id: 'a1', status: 'proposed' },
      { id: 'a2', status: 'approved' }
    ];
    expect(testApi.collectDeliverables({ execution_status: 'awaiting_approval', artifacts }))
      .toHaveLength(2);
  });

  test('reports runtime, deliverable, validation, and human checks separately', () => {
    const verification = testApi.buildVerificationState({
      execution_status: 'awaiting_approval',
      artifacts: [{ id: 'a1', status: 'proposed', validation_status: 'passed' }],
      events: [{ event_type: 'approval_request', content: { summary: 'Review this' } }]
    });

    expect(verification.overall).toBe('Ready for your review');
    expect(verification.deliverable_count).toBe(1);
    expect(verification.checks).toHaveLength(4);
    expect(verification.checks.map((check) => check.state)).toEqual(['pass', 'pass', 'pass', 'pending']);
  });

  test('does not claim automatic validation passed when the runtime omitted evidence', () => {
    const verification = testApi.buildVerificationState({
      execution_status: 'completed',
      artifacts: [{ id: 'a1', status: 'applied' }],
      events: []
    });
    expect(verification.checks[2].state).toBe('unreported');
    expect(verification.checks[2].detail).toContain('not been reported');
  });

  test('surfaces invalid artifact evidence as an outcome needing attention', () => {
    const verification = testApi.buildVerificationState({
      execution_status: 'completed',
      artifacts: [{ id: 'a1', status: 'completed', validation: { valid: false } }],
      events: []
    });
    expect(verification.overall).toBe('Needs attention');
    expect(verification.checks[2].state).toBe('attention');
  });

  test('turns runtime statuses into a plain-language four-stage journey', () => {
    expect(testApi.buildRunJourneyState('running', 0)).toMatchObject({
      current: 1,
      tone: 'working',
      title: 'Your agent is working'
    });
    expect(testApi.buildRunJourneyState('awaiting_approval', 2)).toMatchObject({
      current: 2,
      tone: 'review',
      title: 'Work is ready for review'
    });
    expect(testApi.buildRunJourneyState('completed', 3)).toMatchObject({
      current: 3,
      tone: 'complete',
      title: 'Your outcome is ready'
    });
    expect(testApi.buildRunJourneyState('failed', 0)).toMatchObject({
      current: 1,
      tone: 'attention'
    });
  });

  test('groups Chef artifact kinds into outcome types people can understand', () => {
    expect(testApi.artifactPresentation({ kind: 'matter_plan' }).group).toBe('plan');
    expect(testApi.artifactPresentation({ kind: 'redline' }).group).toBe('document');
    expect(testApi.artifactPresentation({ kind: 'workspace_timeline_risk_report' }).group).toBe('analysis');
    expect(testApi.artifactPresentation({ kind: 'automation_rule' }).group).toBe('action');
    expect(testApi.artifactPresentation({ kind: 'custom_output', content_jsonb: { tasks: [{ title: 'Follow up' }] } }).group).toBe('plan');
  });

  test('counts a mixed run without hiding unfamiliar deliverables', () => {
    const counts = testApi.outcomeGroupCounts([
      { kind: 'task_batch' },
      { kind: 'narrative_report' },
      { kind: 'case_chronology' },
      { kind: 'automation_rule' },
      { kind: 'custom_output' }
    ]);
    expect(counts).toMatchObject({ all: 5, plan: 1, document: 1, analysis: 1, action: 1, other: 1 });
  });

  test('shows the newest explicit input request while a run is paused', () => {
    expect(testApi.findInputPrompt({
      events: [
        { event_type: 'agent_message', content: { message: 'Earlier note' } },
        { event_type: 'input_request', content: { question: 'Which customer segment should I prioritize?' } }
      ]
    })).toBe('Which customer segment should I prioritize?');
  });

  test('turns runtime action identifiers into readable labels', () => {
    expect(testApi.humanizeValue('schedule.weekly')).toBe('Schedule weekly');
    expect(testApi.humanizeValue('text.prepareOverdueReminders')).toBe('Text prepare Overdue Reminders');
  });
});

// ---------------------------------------------------------------------------
// tools-browser.js
// ---------------------------------------------------------------------------

describe('tools-browser view: pure helpers', () => {
  let testApi;

  beforeAll(() => {
    const ctx = createContext();
    loadView('src/agents/js/views/tools-browser.js', ctx);
    testApi = ctx.window.LanaAgentsApp.Views.toolsBrowse.__test;
  });

  test('exposes the test surface', () => {
    expect(testApi).toBeTruthy();
    expect(typeof testApi.filterTools).toBe('function');
    expect(typeof testApi.matchesQuery).toBe('function');
    expect(typeof testApi.buildExampleInvocation).toBe('function');
  });

  describe('matchesQuery', () => {
    test('empty query matches everything', () => {
      expect(testApi.matchesQuery({ name: 'foo', description: 'bar' }, '')).toBe(true);
    });
    test('matches against name and description (case-insensitive)', () => {
      expect(testApi.matchesQuery({ name: 'search_documents', description: 'X' }, 'DOCUMENT')).toBe(true);
      expect(testApi.matchesQuery({ name: 'foo', description: 'helpful clone tool' }, 'CLONE')).toBe(true);
      expect(testApi.matchesQuery({ name: 'foo', description: 'bar' }, 'baz')).toBe(false);
    });
  });

  describe('filterTools', () => {
    const cats = [
      { id: 'matters',   label: 'Matters',   tools: [{ name: 'clone_matter', description: 'clone' }] },
      { id: 'documents', label: 'Documents', tools: [{ name: 'search_documents', description: 'search' }] }
    ];

    test('returns all categories when no filters', () => {
      const out = testApi.filterTools(cats, '', '');
      expect(out.map((c) => c.id)).toEqual(['matters', 'documents']);
    });

    test('filters by activeCategoryId', () => {
      const out = testApi.filterTools(cats, 'matters', '');
      expect(out.length).toBe(1);
      expect(out[0].id).toBe('matters');
    });

    test('filters by query and drops empty groups', () => {
      const out = testApi.filterTools(cats, '', 'search');
      expect(out.length).toBe(1);
      expect(out[0].id).toBe('documents');
    });

    test('combines category + query', () => {
      const out = testApi.filterTools(cats, 'matters', 'search');
      expect(out).toEqual([]);
    });
  });

  describe('buildExampleInvocation', () => {
    test('produces JSON with required keys filled', () => {
      const tool = {
        name: 'clone_matter',
        parameters: {
          type: 'object',
          properties: {
            matter_id: { type: 'string' },
            new_name:  { type: 'string' }
          },
          required: ['matter_id', 'new_name']
        }
      };
      const out = testApi.buildExampleInvocation(tool);
      const parsed = JSON.parse(out);
      expect(parsed.tool).toBe('clone_matter');
      expect(parsed.params).toHaveProperty('matter_id');
      expect(parsed.params).toHaveProperty('new_name');
    });

    test('handles missing parameters gracefully', () => {
      const tool = { name: 'mystery' };
      const out = testApi.buildExampleInvocation(tool);
      const parsed = JSON.parse(out);
      expect(parsed.tool).toBe('mystery');
      expect(parsed.params).toEqual({});
    });
  });
});

/**
 * Unit tests for src/agents/js/views/{agent-create,tools-browser}.js
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

'use strict';

const path = require('path');

const helperPath = path.resolve(__dirname, '../../src/js/lex/chat/lex-chat.composer-slash.js');

describe('Lex composer slash command helpers', () => {
  let slash;

  beforeEach(() => {
    jest.resetModules();
    slash = require(helperPath);
    slash.resetCatalog();
  });

  function sampleCatalog() {
    return slash.normalizeCatalog({
      data: {
        agents: [
          { slug: 'intake-triage', name: 'Intake Triage', description: 'Review new intake', enabled: true }
        ],
        automations: [
          { id: 'auto-1', name: 'Send Intake Email', description: 'Sends an email', enabled: true }
        ],
        capabilities: {
          agents_available: true,
          automations_available: true
        }
      }
    });
  }

  test('normalizes the backend command catalog envelope', () => {
    const catalog = sampleCatalog();
    expect(catalog.capabilities).toEqual({
      agents_available: true,
      automations_available: true
    });
    expect(catalog.agents[0]).toEqual(expect.objectContaining({
      namespace: 'agents',
      type: 'agent',
      value: 'intake-triage',
      label: 'Intake Triage'
    }));
    expect(catalog.automations[0]).toEqual(expect.objectContaining({
      namespace: 'automations',
      type: 'automation',
      value: 'auto-1',
      label: 'Send Intake Email'
    }));
  });

  test('returns namespace and item suggestions for autocomplete', () => {
    const catalog = sampleCatalog();
    expect(slash.suggestionsForInput(catalog, '/', 1).map((item) => item.label)).toEqual([
      '/agents:',
      '/automations:'
    ]);
    expect(slash.suggestionsForInput(catalog, '/agents:int', 11)).toEqual([
      expect.objectContaining({ label: 'Intake Triage', value: 'intake-triage' })
    ]);
    expect(slash.suggestionsForInput(catalog, '/automations:email', 18)).toEqual([
      expect.objectContaining({ label: 'Send Intake Email', value: 'auto-1' })
    ]);
  });

  test('distinguishes autocomplete triggers from dispatchable commands', () => {
    expect(slash.detectSlashTrigger('/ag', 3)).toEqual(expect.objectContaining({
      mode: 'namespace'
    }));
    expect(slash.isDispatchCommand('/ag')).toBe(false);
    expect(slash.isDispatchCommand('/agents:Intake Triage')).toBe(true);
    expect(slash.isDispatchCommand('/automations:Send Intake Email')).toBe(true);
  });

  test('parses command references by slug/name and preserves trailing input', () => {
    const catalog = sampleCatalog();
    expect(slash.parseCommand('/agents:Intake Triage summarize lead', catalog)).toEqual(expect.objectContaining({
      valid: true,
      type: 'agent',
      ref: 'intake-triage',
      label: 'Intake Triage',
      inputText: 'summarize lead'
    }));
    expect(slash.parseCommand('/automations:Send Intake Email', catalog)).toEqual(expect.objectContaining({
      valid: true,
      type: 'automation',
      ref: 'auto-1',
      label: 'Send Intake Email'
    }));
  });

  test('builds dispatch payloads and strips spoofable identity fields from JSON input', () => {
    const catalog = sampleCatalog();
    const command = slash.parseCommand('/automations:Send Intake Email {"document_id":"doc-1","user_id":"spoof","organizationId":"spoof","matter_id":"spoof"}', catalog);
    const body = slash.buildDispatchBody(command, {
      conversationId: 'thread-1',
      matterId: 'matter-1',
      attachments: { files: [{ file_id: 'file-1', name: 'Agreement.pdf' }] }
    });

    expect(body).toEqual({
      type: 'automation',
      ref: 'auto-1',
      input: {
        document_id: 'doc-1',
        conversation_id: 'thread-1',
        matter_id: 'matter-1',
        attachments: { files: [{ file_id: 'file-1', name: 'Agreement.pdf' }] }
      }
    });
    expect(body.input.user_id).toBeUndefined();
    expect(body.input.organizationId).toBeUndefined();
  });

  test('dispatches through the canonical composer endpoint', async () => {
    const api = { post: jest.fn().mockResolvedValue({ data: { type: 'agent', slug: 'intake-triage', run_id: 'run-1' } }) };
    const command = { type: 'agent', ref: 'intake-triage', inputText: 'go' };
    const result = await slash.dispatchCommand(api, command, { conversationId: 'thread-1' });

    expect(api.post).toHaveBeenCalledWith('/api/v1/composer/dispatch', {
      type: 'agent',
      ref: 'intake-triage',
      input: { text: 'go', conversation_id: 'thread-1' }
    });
    expect(result).toEqual({ type: 'agent', slug: 'intake-triage', run_id: 'run-1' });
  });

  test('formats backend error states for chat UX', () => {
    expect(slash.formatDispatchError({
      code: 'NOT_FOUND',
      message: 'No agent found',
      data: { error: { code: 'NOT_FOUND', message: 'No agent found', available: ['A', 'B'] } }
    })).toContain('Did you mean: `A`, `B`');

    expect(slash.formatDispatchError({
      code: 'RATE_LIMITED',
      message: 'Rate limited',
      data: { error: { code: 'RATE_LIMITED', message: 'Rate limited', retryAfterSeconds: 42 } }
    })).toContain('42 seconds');
  });
});

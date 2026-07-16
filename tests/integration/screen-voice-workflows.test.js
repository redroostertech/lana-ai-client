const { VoiceSessionController } = require('../../src/screen-voice/voice-session-controller');
const { parseAgentDecision } = require('../../src/screen-voice/contracts');
const { actionText } = require('../../src/screen-voice/action-normalizer');

describe('screen voice vertical workflows', () => {
  test('final literal transcript bypasses agent and inserts once', async () => {
    const controller = new VoiceSessionController();
    const adapter = { insert: jest.fn(async () => ({ ok: true })) };
    const agent = jest.fn();
    controller.start('dictation');
    controller.transition('transcribing');
    controller.session.transcript = 'Please send the revised contract Friday.';
    controller.transition('executing');
    if (controller.claimExecution(`${controller.session.id}:dictation`)) {
      await adapter.insert(controller.session.transcript, { processId: 1 });
    }
    expect(adapter.insert).toHaveBeenCalledTimes(1);
    expect(agent).not.toHaveBeenCalled();
  });

  test('selected rewrite validates and replaces only the selection', async () => {
    const replaceSelection = jest.fn(async () => ({ ok: true }));
    const decision = parseAgentDecision({ intent: 'rewrite', spokenResponse: '', displayResponse: 'Concise text.',
      proposedActions: [{ type: 'replace_selection', arguments: { text: 'Concise text.' },
        targetFingerprint: { platform: 'darwin', processId: 1, bundleId: 'x', processName: 'Editor',
          windowTitle: 'Doc', role: 'AXTextArea', name: 'Body', bounds: null, selectionHash: 'abc' },
        requiresConfirmation: true }], confidence: 0.95, contextUsed: ['selected_text'] });
    await replaceSelection(actionText(decision.proposedActions[0]), decision.proposedActions[0].targetFingerprint);
    expect(replaceSelection).toHaveBeenCalledWith('Concise text.', expect.objectContaining({ selectionHash: 'abc' }));
  });

  test('screen summary returns display content without a mutation', () => {
    const decision = parseAgentDecision({ intent: 'summarize', spokenResponse: 'Summary', displayResponse: 'Summary',
      proposedActions: [], confidence: 0.9, contextUsed: ['document_text'] });
    expect(decision.proposedActions).toEqual([]);
  });

  test.each(['listening', 'transcribing', 'gathering_context', 'thinking', 'previewing'])('cancel during %s aborts the session', (phase) => {
    const controller = new VoiceSessionController();
    controller.start('agent');
    const route = ['listening', 'transcribing', 'gathering_context', 'thinking', 'previewing'];
    route.slice(1, route.indexOf(phase) + 1).forEach((state) => controller.transition(state));
    const signal = controller.signal;
    controller.cancel();
    expect(signal.aborted).toBe(true);
  });
});

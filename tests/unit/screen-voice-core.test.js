const { VoiceSessionController } = require('../../src/screen-voice/voice-session-controller');
const { parseAgentDecision, parseSettings, DEFAULT_SETTINGS } = require('../../src/screen-voice/contracts');
const { sanitizeContext, truncateText } = require('../../src/screen-voice/context-sanitizer');
const { createFingerprint, fingerprintsMatch } = require('../../src/screen-voice/target-fingerprint');
const { actionRequiresConfirmation } = require('../../src/screen-voice/confirmation-policy');
const { matrixToTsv, normalizeText } = require('../../src/screen-voice/action-normalizer');

function context(overrides = {}) {
  return {
    platform: 'darwin', processId: 12, bundleId: 'com.test.Editor', activeApplication: 'Editor',
    processName: 'Editor', windowTitle: 'Document', selectedText: '', surroundingText: '',
    accessibleDocumentText: '', nearbyControls: [], screenshotReference: null,
    focusedElement: { role: 'AXTextArea', name: 'Body', value: '', isEditable: true, isPassword: false,
      bounds: { x: 1, y: 2, width: 300, height: 100 } },
    ...overrides
  };
}

describe('screen voice session controller', () => {
  test('enforces transitions and prevents overlapping sessions', () => {
    const controller = new VoiceSessionController({ clock: () => 100 });
    controller.start('agent');
    expect(controller.state).toBe('listening');
    expect(() => controller.start('agent')).toThrow(expect.objectContaining({ code: 'SESSION_OVERLAP' }));
    controller.transition('transcribing');
    controller.transition('executing');
    controller.transition('idle');
    expect(controller.state).toBe('idle');
  });

  test('cancellation aborts in-flight work and can recover', () => {
    const controller = new VoiceSessionController();
    controller.start('agent');
    const signal = controller.signal;
    controller.cancel();
    expect(signal.aborted).toBe(true);
    expect(controller.state).toBe('canceled');
    expect(() => controller.start('agent')).not.toThrow();
  });

  test('cancellation is safe from an error state during application shutdown', () => {
    const controller = new VoiceSessionController();
    controller.start('agent');
    controller.fail('TRANSCRIPTION_FAILED', 'Could not transcribe');
    expect(() => controller.cancel('app_quit')).not.toThrow();
    expect(controller.state).toBe('canceled');
  });

  test('execution tokens are idempotent', () => {
    const controller = new VoiceSessionController();
    expect(controller.claimExecution('a')).toBe(true);
    expect(controller.claimExecution('a')).toBe(false);
  });
});

describe('screen voice contracts and safety helpers', () => {
  test('rejects arbitrary actions and malformed model output', () => {
    expect(() => parseAgentDecision({ intent: 'insert', spokenResponse: '', displayResponse: '',
      proposedActions: [{ type: 'run_script', arguments: { text: 'x' }, targetFingerprint: null,
        requiresConfirmation: false }], confidence: 1, contextUsed: [] })).toThrow();
  });

  test('merges validated defaults for settings', () => {
    expect(parseSettings({ screenContextEnabled: false })).toEqual({ ...DEFAULT_SETTINGS, screenContextEnabled: false });
    expect(parseSettings({}).openAtLogin).toBe(false);
    expect(parseSettings({ defaultMode: 'dictation' }).defaultMode).toBe('agent');
  });

  test('migrates the Electron-incompatible legacy agent accelerator', () => {
    expect(parseSettings({ agentShortcut: 'CommandOrControl+Shift+Period' }).agentShortcut)
      .toBe('CommandOrControl+Shift+A');
  });

  test('removes all content from password fields', () => {
    const value = sanitizeContext(context({ selectedText: 'secret', surroundingText: 'private',
      accessibleDocumentText: 'document', focusedElement: { ...context().focusedElement,
        name: 'Account password', isPassword: true, value: 'secret' } }));
    expect(value.selectedText).toBe('');
    expect(value.accessibleDocumentText).toBe('');
    expect(value.focusedElement.value).toBe('');
  });

  test('bounds context without losing both ends', () => {
    const result = truncateText(`START${'x'.repeat(200)}END`, 50);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('START');
    expect(result.text).toContain('END');
  });

  test('detects target changes and optional selection changes', () => {
    const first = createFingerprint(context({ selectedText: 'one' }));
    const same = createFingerprint(context({ selectedText: 'one' }));
    const changed = createFingerprint(context({ windowTitle: 'Other', selectedText: 'two' }));
    expect(fingerprintsMatch(first, same, { requireSelection: true })).toBe(true);
    expect(fingerprintsMatch(first, changed)).toBe(false);
  });

  test('allows a dynamic window title only when app identity and nearby bounds remain stable', () => {
    const first = createFingerprint(context());
    const retitled = createFingerprint(context({ windowTitle: 'Document — Saved' }));
    const moved = createFingerprint(context({ windowTitle: 'Document — Saved', focusedElement: {
      ...context().focusedElement, bounds: { x: 200, y: 200, width: 300, height: 100 }
    } }));
    expect(fingerprintsMatch(first, retitled, { allowDynamicWindowTitle: true, boundsTolerance: 24 })).toBe(true);
    expect(fingerprintsMatch(first, moved, { allowDynamicWindowTitle: true, boundsTolerance: 24 })).toBe(false);
  });

  test('risk policy confirms multi-cell changes and allows explicit selection replacement', () => {
    expect(actionRequiresConfirmation({ type: 'insert_table', requiresConfirmation: false }, context(),
      { confirmationPolicy: 'risk_based' })).toBe(true);
    expect(actionRequiresConfirmation({ type: 'replace_selection', requiresConfirmation: false },
      context({ selectedText: 'chosen' }), { confirmationPolicy: 'risk_based' })).toBe(false);
  });

  test('browser and client navigation always require confirmation', () => {
    expect(actionRequiresConfirmation({ type: 'open_url', requiresConfirmation: false }, context(),
      { confirmationPolicy: 'never_safe_only' })).toBe(true);
    expect(actionRequiresConfirmation({ type: 'navigate_client', requiresConfirmation: false }, context(),
      { confirmationPolicy: 'never_safe_only' })).toBe(true);
  });

  test('normalizes Unicode/newlines and produces deterministic tabular insertion', () => {
    expect(normalizeText('e\u0301\r\nnext')).toBe('é\nnext');
    expect(matrixToTsv([['January', 'February'], ['1\n2', '3']])).toBe('January\tFebruary\n1 2\t3');
  });
});

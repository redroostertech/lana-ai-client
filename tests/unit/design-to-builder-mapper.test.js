const path = require('path');

const { mapDesignToBuilderState } = require(path.join(
  __dirname,
  '../../src/automation/js/shared/design-to-builder.mapper.js'
));

describe('design-to-builder.mapper', () => {
  describe('mapDesignToBuilderState', () => {
    test('maps an event-trigger config', () => {
      const automationConfig = {
        trigger: {
          event_type: 'document.uploaded',
          conditions: [{ field: 'doc_type', op: 'eq', value: 'invoice' }]
        },
        actions: [
          { action_id: 'a1', action_type: 'send_message', config: { body: 'hi' } }
        ],
        settings: {},
        scope: { type: 'matter' }
      };
      const meta = { automationName: 'Invoice Watcher', description: 'Watch invoices' };

      const result = mapDesignToBuilderState(automationConfig, meta);

      expect(result.name).toBe('Invoice Watcher');
      expect(result.description).toBe('Watch invoices');
      expect(result.triggerEvent).toBe('document.uploaded');
      expect(result.triggerMode).toBe('event');
      expect(result.scopeType).toBe('matter');
      // Schedule fields are not set for event triggers.
      expect(result.scheduleTime).toBeUndefined();
      expect(result.dayOfWeek).toBeUndefined();
    });

    test('maps a schedule-trigger config with triggerMode, scheduleTime, dayOfWeek', () => {
      const automationConfig = {
        trigger: {
          event_type: 'schedule.weekly',
          schedule: { every_n_days: 7, time: '14:30', day_of_week: 3 }
        },
        actions: [],
        scope: { type: 'organization' }
      };
      const meta = { automationName: 'Weekly Digest', description: 'Send weekly digest' };

      const result = mapDesignToBuilderState(automationConfig, meta);

      expect(result.triggerEvent).toBe('schedule.weekly');
      expect(result.triggerMode).toBe('scheduled');
      expect(result.scheduleTime).toBe('14:30');
      // day_of_week is coerced to a string to match the builder's field type.
      expect(result.dayOfWeek).toBe('3');
      expect(result.scopeType).toBe('organization');
    });

    test('uses schedule defaults when scheduled trigger omits time/day_of_week', () => {
      const result = mapDesignToBuilderState(
        { trigger: { event_type: 'schedule.daily' } },
        {}
      );

      expect(result.triggerMode).toBe('scheduled');
      expect(result.scheduleTime).toBe('09:00');
      expect(result.dayOfWeek).toBe('1');
    });

    test('does not throw on missing / partial / null input and returns sensible defaults', () => {
      expect(() => mapDesignToBuilderState()).not.toThrow();
      expect(() => mapDesignToBuilderState(null, null)).not.toThrow();

      const result = mapDesignToBuilderState(null, null);
      expect(result.name).toBe('');
      expect(result.description).toBe('');
      expect(result.triggerEvent).toBe('document.uploaded');
      expect(result.triggerMode).toBe('event');
      expect(result.scopeType).toBe('matter');
      expect(typeof result.customJson).toBe('string');

      // Partial config: trigger present but no schedule/scope.
      const partial = mapDesignToBuilderState({ trigger: { event_type: 'schedule.daily' } });
      expect(partial.scheduleTime).toBe('09:00');
      expect(partial.dayOfWeek).toBe('1');
      expect(partial.scopeType).toBe('matter');
    });

    test('customJson is a pretty-printed valid JSON serialization of the config', () => {
      const automationConfig = {
        trigger: { event_type: 'document.uploaded' },
        actions: [{ action_id: 'a1', action_type: 'tag', config: {} }],
        settings: { retries: 2 },
        scope: { type: 'matter' }
      };

      const result = mapDesignToBuilderState(automationConfig, {});

      // Valid JSON that round-trips back to the original config.
      expect(() => JSON.parse(result.customJson)).not.toThrow();
      expect(JSON.parse(result.customJson)).toEqual(automationConfig);
      // Pretty-printed (2-space indent).
      expect(result.customJson).toContain('\n  ');
    });

    test('maps meta name and description', () => {
      const result = mapDesignToBuilderState(
        { trigger: { event_type: 'document.uploaded' } },
        { automationName: 'My Flow', description: 'Does a thing' }
      );

      expect(result.name).toBe('My Flow');
      expect(result.description).toBe('Does a thing');
    });

    // Regression (adversarial review): message must carry the generated AI
    // prompt so a later unrelated field edit (which broadcasts state.builder
    // .message over every ai.generateText action) does not clobber it with a
    // stale template default.
    test('derives message from the primary ai.* action prompt', () => {
      const result = mapDesignToBuilderState(
        {
          trigger: { event_type: 'document.uploaded' },
          actions: [
            { action_id: 's1', action_type: 'document.tag', config: {} },
            { action_id: 's2', action_type: 'ai.generateText', config: { prompt: 'Summarize the document and list action items.' } }
          ]
        },
        { automationName: 'X', description: 'fallback desc' }
      );
      expect(result.message).toBe('Summarize the document and list action items.');
    });

    test('falls back to the description for message when there is no ai action', () => {
      const result = mapDesignToBuilderState(
        { trigger: { event_type: 'document.uploaded' }, actions: [{ action_id: 'a', action_type: 'notification.send', config: {} }] },
        { automationName: 'X', description: 'notify the team' }
      );
      expect(result.message).toBe('notify the team');
    });

    test('message never throws on missing actions and defaults to empty', () => {
      const result = mapDesignToBuilderState(null, null);
      expect(result.message).toBe('');
    });
  });
});

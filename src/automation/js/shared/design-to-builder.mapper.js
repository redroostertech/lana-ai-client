/**
 * design-to-builder.mapper.js
 *
 * Pure, DOM-free mapper that converts the backend "Build with Lana" design
 * response (POST /api/v1/automations/design) into a PARTIAL automation-builder
 * state object. The output uses the exact field names from the builder state
 * (see createBuilderState in src/automation/js/views/builder.js) so the panel
 * can merge it into state.builder and populate the form from a generated draft.
 *
 * No DOM, no network, no side effects.
 */

(function () {
  'use strict';

  // Builder defaults mirrored from createBuilderState / normalizeTemplate
  // so a partial design response still yields a faithful, renderable form.
  var DEFAULT_TRIGGER_EVENT = 'document.uploaded';
  var DEFAULT_SCHEDULE_TIME = '09:00';
  var DEFAULT_DAY_OF_WEEK = '1';
  var DEFAULT_SCOPE_TYPE = 'matter';

  function isScheduledTriggerEvent(eventType) {
    return String(eventType || '').startsWith('schedule.');
  }

  // The builder has a single `message` field that hydrateRuntimeConfig
  // broadcasts to every ai.generateText action's config.prompt on the user's
  // next edit. If we leave `message` as the stale template default, an unrelated
  // edit silently overwrites Lana's generated prompts. Derive it from the
  // primary generated AI prompt (falling back to the description) so a later
  // edit re-applies the intended text rather than clobbering it.
  function derivePrimaryMessage(config, safeMeta) {
    var actions = Array.isArray(config.actions) ? config.actions : [];
    for (var i = 0; i < actions.length; i++) {
      var action = (actions[i] && typeof actions[i] === 'object') ? actions[i] : {};
      var type = String(action.action_type || '');
      var actionConfig = (action.config && typeof action.config === 'object') ? action.config : {};
      if (type.indexOf('ai.') === 0 && actionConfig.prompt) {
        return String(actionConfig.prompt);
      }
    }
    return safeMeta.description || '';
  }

  /**
   * Convert a backend automation design into a partial builder-state object.
   *
   * @param {Object} automationConfig - data.automationConfig from the design
   *   response: { trigger: { event_type, conditions, schedule: { every_n_days?,
   *   time?, day_of_week? } }, actions: [...], settings, scope: { type } }.
   * @param {Object} [meta] - top-level design fields: { automationName, description }.
   * @returns {Object} Partial builder state using the exact builder field names:
   *   name, description, triggerEvent, triggerMode, scheduleTime, dayOfWeek,
   *   scopeType, message, customJson.
   */
  function mapDesignToBuilderState(automationConfig, meta) {
    var config = (automationConfig && typeof automationConfig === 'object') ? automationConfig : {};
    var safeMeta = (meta && typeof meta === 'object') ? meta : {};

    var trigger = (config.trigger && typeof config.trigger === 'object') ? config.trigger : {};
    var schedule = (trigger.schedule && typeof trigger.schedule === 'object') ? trigger.schedule : {};
    var scope = (config.scope && typeof config.scope === 'object') ? config.scope : {};

    var triggerEvent = trigger.event_type || DEFAULT_TRIGGER_EVENT;
    var scheduled = isScheduledTriggerEvent(triggerEvent);

    var result = {
      name: safeMeta.automationName || '',
      description: safeMeta.description || '',
      triggerEvent: triggerEvent,
      triggerMode: scheduled ? 'scheduled' : 'event',
      scopeType: scope.type || DEFAULT_SCOPE_TYPE,
      // Keep the builder's single AI message in sync with the generated draft so
      // a later unrelated edit re-applies the intended prompt, not a stale one.
      message: derivePrimaryMessage(config, safeMeta),
      // The builder's raw-config editor reads customJson; serialize the full
      // (non-empty) config so the JSON editor reflects the generated draft.
      customJson: JSON.stringify(config, null, 2)
    };

    // Schedule fields only apply when the trigger is a scheduled trigger.
    if (scheduled) {
      result.scheduleTime = schedule.time || DEFAULT_SCHEDULE_TIME;
      result.dayOfWeek = (schedule.day_of_week !== undefined && schedule.day_of_week !== null)
        ? String(schedule.day_of_week)
        : DEFAULT_DAY_OF_WEEK;
    }

    return result;
  }

  var DesignToBuilderMapper = {
    mapDesignToBuilderState: mapDesignToBuilderState
  };

  if (typeof window !== 'undefined') {
    window.DesignToBuilderMapper = DesignToBuilderMapper;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DesignToBuilderMapper;
  }
})();

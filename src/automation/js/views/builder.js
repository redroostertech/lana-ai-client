import {
  DAY_OPTIONS,
  OVERDUE_INVOICE_REMINDER_TEMPLATE_ID,
  TEMPLATE_LIBRARY,
  TRIGGER_OPTIONS
} from '../constants.js';
import { badge, emptyState, metaGrid, surface } from '../shared/ui.js';
import { escapeAttribute, escapeHtml, normalizeText } from '../shared/utils.js';
import { connectorCompact, connectorDisplayName, countReadyConnectors } from './connectors.js';

const SCHEDULED_TRIGGER_OPTIONS = TRIGGER_OPTIONS.filter((eventType) => eventType.startsWith('schedule.'));
const SYSTEM_TRIGGER_OPTIONS = TRIGGER_OPTIONS.filter((eventType) => !eventType.startsWith('schedule.'));
const OVERDUE_BUCKET_KEYS = ['slightly_overdue', 'moderately_overdue', 'severely_overdue'];
const OVERDUE_STAGE_KEYS = ['follow_up_1', 'follow_up_2', 'follow_up_3'];
const TEMPLATE_TOKEN_PATTERN = /\{\{([a-zA-Z0-9_.-]+)\}\}/g;

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeScopeType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'organization' || normalized === 'org' || normalized === 'org_wide' || normalized === 'organization-wide') {
    return 'organization';
  }
  if (normalized === 'matter' || normalized === 'matter_scoped' || normalized === 'specific_matter') {
    return 'matter';
  }
  return '';
}

function buildAutomationScope(form) {
  const scopeType = normalizeScopeType(form.scopeType) || 'matter';
  if (scopeType === 'organization') {
    return { type: 'organization' };
  }

  const matterId = String(form.matterId || '').trim();
  return matterId
    ? { type: 'matter', matter_id: matterId }
    : { type: 'matter' };
}

function applyScopeToConfig(baseConfig, form) {
  const config = baseConfig && typeof baseConfig === 'object' && !Array.isArray(baseConfig)
    ? deepClone(baseConfig)
    : {};
  config.scope = buildAutomationScope(form);
  return config;
}

function resolveAutomationScope(automation, automationConfig) {
  const configScope = automationConfig?.scope && typeof automationConfig.scope === 'object'
    ? automationConfig.scope
    : { type: automationConfig?.scope };
  const scopeType = normalizeScopeType(
    configScope.type
    || configScope.scope_type
    || automation.scope_type
    || automation.scopeType
    || ((configScope.matter_id || configScope.matterId || automation.matter_id) ? 'matter' : 'organization')
  ) || 'organization';
  const scopedMatterId = configScope.matter_id
    || configScope.matterId
    || (configScope.resource_type === 'matter' ? configScope.resource_id : '')
    || automation.matter_id
    || automation.client_matter_id
    || '';

  return {
    scopeType,
    matterId: scopeType === 'matter' ? scopedMatterId : ''
  };
}

function buildTriggerConfig(form) {
  const trigger = { event_type: form.triggerEvent };
  if (form.triggerConnectorId) {
    trigger.connector_id = form.triggerConnectorId;
  }

  if (form.triggerEvent === 'schedule.weekly') {
    trigger.schedule = {
      day_of_week: parseInt(form.dayOfWeek, 10),
      time: form.scheduleTime
    };
  } else if (form.triggerEvent === 'schedule.daily') {
    trigger.schedule = {
      every_n_days: 1,
      time: form.scheduleTime
    };
  }

  return trigger;
}

function renderTriggerEventSummary(eventType) {
  if (window.LanaEventBrowser && typeof window.LanaEventBrowser.renderSummaryHtml === 'function') {
    return window.LanaEventBrowser.renderSummaryHtml(eventType);
  }

  return `
    <div class="surface-note">
      Selected event: <strong>${escapeHtml(eventType || 'Not set')}</strong>
    </div>
  `;
}

function defaultOverdueBuckets() {
  return [
    {
      key: 'slightly_overdue',
      label: 'Slightly overdue',
      minDays: 1,
      maxDays: 7,
      description: '1-7 days overdue',
      tone: 'gentle'
    },
    {
      key: 'moderately_overdue',
      label: 'Moderately overdue',
      minDays: 8,
      maxDays: 30,
      description: '8-30 days overdue',
      tone: 'firm'
    },
    {
      key: 'severely_overdue',
      label: 'Severely overdue',
      minDays: 31,
      maxDays: null,
      description: '31+ days overdue',
      tone: 'urgent'
    }
  ];
}

function defaultOverdueStages() {
  return [
    {
      key: 'follow_up_1',
      label: 'Follow-up 1',
      description: 'Initial reminder',
      tone: 'gentle'
    },
    {
      key: 'follow_up_2',
      label: 'Follow-up 2',
      description: 'Escalated reminder',
      tone: 'firm'
    },
    {
      key: 'follow_up_3',
      label: 'Follow-up 3',
      description: 'Final reminder',
      tone: 'urgent'
    }
  ];
}

function defaultOverdueTemplateCell(bucket, stage) {
  const bucketTone = bucket.tone || 'neutral';
  const stageTone = stage.tone || 'neutral';
  const toneLabel = `${bucket.label} · ${stage.label}`;
  const bucketRange = bucket.maxDays === null
    ? `${bucket.minDays}+ days`
    : `${bucket.minDays}-${bucket.maxDays} days`;
  const bodyByStage = {
    follow_up_1: 'Keep the tone warm and direct. Ask for a payment plan or confirmation of when the invoice will be settled.',
    follow_up_2: 'State that the invoice is now overdue and request a concrete payment date or response.',
    follow_up_3: 'Use a firmer tone, note that this is the final reminder, and route to escalation if needed.'
  };
  return {
    subject: `${toneLabel} - invoice {{invoice.number}}`,
    body: `Hi {{invoice.client_name}},\n\nInvoice {{invoice.number}} is ${bucketRange} overdue. ${bodyByStage[stage.key] || 'Please review and follow up.'}\n\nAmount due: {{invoice.amount_due}}\nDue date: {{invoice.due_date}}\nDays overdue: {{invoice.days_overdue}}\n\nThank you,`,
    task_title: `${stage.label}: review {{invoice.number}}`,
    internal_note: `${bucket.label} / ${stage.label} (${bucketTone} / ${stageTone})`,
    cta_label: 'Review invoice'
  };
}

function defaultOverdueTemplates() {
  const buckets = defaultOverdueBuckets();
  const stages = defaultOverdueStages();
  return buckets.reduce((matrix, bucket) => {
    matrix[bucket.key] = stages.reduce((row, stage) => {
      row[stage.key] = defaultOverdueTemplateCell(bucket, stage);
      return row;
    }, {});
    return matrix;
  }, {});
}

function normalizeOverdueBucketSeed(bucket, index) {
  const defaults = defaultOverdueBuckets()[index] || defaultOverdueBuckets()[0];
  if (!bucket || typeof bucket !== 'object') return { ...defaults };
  return {
    ...defaults,
    ...bucket,
    minDays: bucket.minDays ?? bucket.min_days_overdue ?? defaults.minDays,
    maxDays: bucket.maxDays ?? bucket.max_days_overdue ?? defaults.maxDays
  };
}

function normalizeOverdueStageSeed(stage, index) {
  const defaults = defaultOverdueStages()[index] || defaultOverdueStages()[0];
  if (!stage || typeof stage !== 'object') return { ...defaults };
  return {
    ...defaults,
    ...stage
  };
}

function createDefaultOverdueReminderState(seed = {}) {
  const buckets = Array.isArray(seed.buckets) && seed.buckets.length
    ? seed.buckets.map((bucket, index) => normalizeOverdueBucketSeed(bucket, index))
    : defaultOverdueBuckets();
  const stages = Array.isArray(seed.stages) && seed.stages.length
    ? seed.stages.map((stage, index) => normalizeOverdueStageSeed(stage, index))
    : defaultOverdueStages();
  const templates = seed.templates && typeof seed.templates === 'object'
    ? deepClone(seed.templates)
    : defaultOverdueTemplates();

  return {
    buckets,
    stages,
    templates,
    selectedBucketKey: seed.selectedBucketKey || buckets[0]?.key || OVERDUE_BUCKET_KEYS[0],
    selectedStageKey: seed.selectedStageKey || stages[0]?.key || OVERDUE_STAGE_KEYS[0]
  };
}

function isOverdueInvoiceReminderConfig(config) {
  const kind = config?.rules?.kind || config?.ui?.kind || config?.metadata?.kind;
  return kind === 'overdue_invoice_reminder';
}

function isOverdueInvoiceReminderTemplate(template) {
  return String(template?.id || '') === OVERDUE_INVOICE_REMINDER_TEMPLATE_ID;
}

function parseOptionalInteger(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOverdueReminderState(overdueReminder) {
  return createDefaultOverdueReminderState(overdueReminder || {});
}

export function selectOverdueReminderCell(context, bucketKey, stageKey) {
  const reminder = normalizeOverdueReminderState(context.state.builder.overdueReminder);
  if (bucketKey && reminder.buckets.some((bucket) => bucket.key === bucketKey)) {
    reminder.selectedBucketKey = bucketKey;
  }
  if (stageKey && reminder.stages.some((stage) => stage.key === stageKey)) {
    reminder.selectedStageKey = stageKey;
  }
  context.state.builder.overdueReminder = reminder;
  syncBuilderJson(context);
}

export function resetOverdueReminderMatrix(context) {
  context.state.builder.overdueReminder = createDefaultOverdueReminderState();
  syncBuilderJson(context);
}

export function updateOverdueReminderField(context, input) {
  if (!input) return;

  const reminder = normalizeOverdueReminderState(context.state.builder.overdueReminder);
  const field = input.dataset.overdueField;
  const value = input.value;
  const bucketIndex = Number.parseInt(input.dataset.overdueBucketIndex, 10);
  const bucketKey = input.dataset.overdueBucketKey;
  const stageKey = input.dataset.overdueStageKey;
  const templateField = input.dataset.overdueTemplateField;

  if ((field === 'bucket_label' || field === 'bucket_min_days' || field === 'bucket_max_days') && Number.isFinite(bucketIndex) && reminder.buckets[bucketIndex]) {
    const bucket = { ...reminder.buckets[bucketIndex] };
    if (field === 'bucket_label') {
      bucket.label = value;
    } else if (field === 'bucket_min_days') {
      bucket.minDays = parseOptionalInteger(value) ?? 0;
    } else if (field === 'bucket_max_days') {
      bucket.maxDays = parseOptionalInteger(value);
    }
    reminder.buckets[bucketIndex] = bucket;
  }

  if (templateField && bucketKey && stageKey) {
    const row = {
      ...(reminder.templates[bucketKey] || {})
    };
    const cell = {
      ...(row[stageKey] || defaultOverdueTemplateCell(
        reminder.buckets.find((bucket) => bucket.key === bucketKey) || defaultOverdueBuckets()[0],
        reminder.stages.find((stage) => stage.key === stageKey) || defaultOverdueStages()[0]
      ))
    };
    cell[templateField] = value;
    row[stageKey] = cell;
    reminder.templates[bucketKey] = row;
    reminder.selectedBucketKey = bucketKey;
    reminder.selectedStageKey = stageKey;
  }

  context.state.builder.overdueReminder = reminder;
  syncBuilderJson(context);
}

function getOverdueTemplateCell(builder, bucketKey, stageKey) {
  const state = normalizeOverdueReminderState(builder.overdueReminder);
  const bucket = state.buckets.find((entry) => entry.key === bucketKey) || state.buckets[0];
  const stage = state.stages.find((entry) => entry.key === stageKey) || state.stages[0];
  const matrixRow = state.templates[bucket?.key];
  const cell = matrixRow?.[stage?.key];
  return {
    state,
    bucket,
    stage,
    cell: cell || defaultOverdueTemplateCell(bucket || defaultOverdueBuckets()[0], stage || defaultOverdueStages()[0])
  };
}

function buildOverdueReminderMapping(state) {
  const mapping = [];
  for (const bucket of state.buckets) {
    for (const stage of state.stages) {
      mapping.push({
        bucket: bucket.key,
        stage: stage.key,
        template_key: `${bucket.key}.${stage.key}`
      });
    }
  }
  return mapping;
}

function compileOverdueReminderConfig(form, selectedTemplate) {
  const trigger = buildTriggerConfig(form);
  const reminderState = normalizeOverdueReminderState(form.overdueReminder);
  const mapping = buildOverdueReminderMapping(reminderState);

  return {
    trigger,
    rules: {
      kind: 'overdue_invoice_reminder',
      template_id: selectedTemplate?.id || OVERDUE_INVOICE_REMINDER_TEMPLATE_ID,
      buckets: reminderState.buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        min_days_overdue: parseOptionalInteger(bucket.minDays),
        max_days_overdue: parseOptionalInteger(bucket.maxDays),
        description: bucket.description || ''
      })),
      follow_up_stages: reminderState.stages.map((stage, index) => ({
        key: stage.key,
        label: stage.label,
        order: index + 1,
        description: stage.description || ''
      })),
      mapping,
      message_templates: reminderState.templates
    },
    ui: {
      kind: 'overdue_invoice_reminder',
      selected_bucket: reminderState.selectedBucketKey,
      selected_stage: reminderState.selectedStageKey
    },
    actions: [
      {
        action_id: 'prepare_overdue_invoice_matrix',
        action_type: 'data.transform',
        config: {
          mode: 'overdue_invoice_reminder',
          buckets: reminderState.buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            minDays: parseOptionalInteger(bucket.minDays),
            maxDays: parseOptionalInteger(bucket.maxDays)
          })),
          follow_up_stages: reminderState.stages.map((stage, index) => ({
            key: stage.key,
            label: stage.label,
            order: index + 1
          })),
          mapping,
          message_templates: reminderState.templates
        }
      },
      {
        action_id: 'log_overdue_invoice_reminder_matrix',
        action_type: 'notification.logActivity',
        config: {
          event_type: 'invoice_overdue_check',
          resource_type: 'matter',
          resource_id: '{{matter.id}}',
          resource_name: 'Matter {{matter.id}}',
          details: {
            note: 'Deterministic overdue invoice reminder matrix configured.',
            template_id: selectedTemplate?.id || OVERDUE_INVOICE_REMINDER_TEMPLATE_ID,
            bucket_count: reminderState.buckets.length,
            stage_count: reminderState.stages.length
          }
        }
      }
    ],
    settings: {
      timeout: 90,
      retryLimit: 1,
      priority: 40
    }
  };
}

export function createBuilderState(template, matters = []) {
  const selectedTemplate = template || TEMPLATE_LIBRARY[0];
  const overdueReminder = isOverdueInvoiceReminderTemplate(selectedTemplate)
    ? createDefaultOverdueReminderState()
    : null;

  return {
    templateId: selectedTemplate.id,
    name: selectedTemplate.defaults.name,
    description: selectedTemplate.defaults.description,
    category: selectedTemplate.defaults.category || selectedTemplate.category,
    triggerEvent: selectedTemplate.defaults.triggerEvent,
    triggerMode: triggerModeFromEvent(selectedTemplate.defaults.triggerEvent),
    triggerConnectorId: '',
    message: selectedTemplate.defaults.message,
    scheduleTime: selectedTemplate.defaults.scheduleTime,
    dayOfWeek: selectedTemplate.defaults.dayOfWeek,
    customJson: '',
    overdueReminder,
    scopeType: selectedTemplate.defaults.scopeType || (selectedTemplate.id === 'connector-sync-watch' ? 'organization' : 'matter'),
    matterId: matters.length ? matterRef(matters[0]) : '',
    matterSearch: '',
    publishMode: selectedTemplate.defaults.publishMode || 'enabled',
    publishModalOpen: false,
    selectedActionIndex: null,
    editMode: {
      isEdit: false,
      automationId: null,
      originalAutomation: null,
      loading: false
    }
  };
}

export function clampBuilderStep(step, max) {
  return Math.max(1, Math.min(Number.isFinite(step) ? step : 1, max));
}

export function normalizeTemplate(template) {
  if (!template) return null;

  const defaults = template.builder_defaults || template.defaults || {};

  return {
    id: template.template_key || template.id,
    templateId: template.template_id || null,
    name: template.name,
    category: template.category || defaults.category || 'Automation',
    trigger: template.trigger_event_type || defaults.triggerEvent || 'document.uploaded',
    description: template.description || '',
    bestFor: template.best_for || template.bestFor || '',
    connectorHints: template.connector_hints || template.connectorHints || [],
    scopeHint: template.scope_hint || template.scopeHint || '',
    workflowSteps: template.workflow_steps || template.workflowSteps || defaults.workflowSteps || [],
    automationConfig: template.automation_config || null,
    defaults: {
      name: defaults.name || template.name,
      description: defaults.description || template.description || '',
      category: defaults.category || template.category || 'Automation',
      triggerEvent: defaults.triggerEvent || template.trigger_event_type || 'document.uploaded',
      message: defaults.message || '',
      scheduleTime: defaults.scheduleTime || '09:00',
      dayOfWeek: defaults.dayOfWeek || '1',
      scopeType: defaults.scopeType || 'matter',
      publishMode: defaults.publishMode || 'enabled'
    }
  };
}

export function getSelectedTemplate(context) {
  const templates = context.getTemplateLibrary();
  return templates.find((template) => template.id === context.state.builder.templateId) || templates[0];
}

export function applyTemplate(context, template) {
  if (!template) return;
  context.state.builder = createBuilderState(template, context.state.matters);
  syncBuilderJson(context);
  context.scheduleOnboardingSave();
}

export function mergeBuilderDraft(context, draft) {
  if (!draft || typeof draft !== 'object') return;

  // Preserve live editMode — onboarding drafts should never clobber an active
  // edit session that was set before or after the draft was saved.
  const liveEditMode = context.state.builder.editMode;

  const merged = {
    ...context.state.builder,
    ...draft,
    editMode: liveEditMode
  };

  if (merged.templateId && !context.getTemplateLibrary().some((template) => template.id === merged.templateId)) {
    merged.templateId = context.getTemplateLibrary()[0].id;
  }

  merged.triggerMode = merged.triggerMode || triggerModeFromEvent(merged.triggerEvent);
  merged.triggerConnectorId = merged.triggerConnectorId || '';
  if (!merged.triggerConnectorId && merged.customJson) {
    const parsed = parseBuilderConfig(merged.customJson);
    merged.triggerConnectorId = parsed?.trigger?.connector_id || '';
  }
  if (!Number.isInteger(merged.selectedActionIndex)) {
    merged.selectedActionIndex = null;
  }
  if (typeof merged.publishModalOpen !== 'boolean') {
    merged.publishModalOpen = false;
  }
  if (merged.templateId === OVERDUE_INVOICE_REMINDER_TEMPLATE_ID || isOverdueInvoiceReminderConfig(parseBuilderConfig(merged.customJson))) {
    merged.overdueReminder = normalizeOverdueReminderState(merged.overdueReminder || {});
  }

  context.state.builder = merged;

  if (!context.state.builder.customJson) {
    syncBuilderJson(context);
  }
}

export function configIsValid(builder) {
  try {
    JSON.parse(builder.customJson || '{}');
    return true;
  } catch (error) {
    return false;
  }
}

export function syncBuilderJson(context) {
  const selectedTemplate = getSelectedTemplate(context);
  const existingConfig = parseBuilderConfig(context.state.builder.customJson);
  const useOverdueReminder = isOverdueInvoiceReminderTemplate(selectedTemplate) || isOverdueInvoiceReminderConfig(existingConfig);
  const compiled = useOverdueReminder
    ? compileOverdueReminderConfig(context.state.builder, selectedTemplate)
    : (
      existingConfig
        ? hydrateRuntimeConfig(existingConfig, context.state.builder)
        : (selectedTemplate.automationConfig
          ? hydrateTemplateConfig(selectedTemplate.automationConfig, context.state.builder)
          : compileTemplate(selectedTemplate, context.state.builder))
    );

  context.state.builder.customJson = JSON.stringify(applyScopeToConfig(compiled, context.state.builder), null, 2);
}

export function addBuilderAction(context, actionType) {
  const baseConfig = parseBuilderConfig(context.state.builder.customJson) || compileTemplate(getSelectedTemplate(context), context.state.builder);
  const nextConfig = hydrateRuntimeConfig(baseConfig, context.state.builder);
  nextConfig.actions = Array.isArray(nextConfig.actions) ? nextConfig.actions : [];
  nextConfig.actions.push(createActionTemplate(actionType, nextConfig.actions.length + 1, context.state.builder.message));
  context.state.builder.customJson = JSON.stringify(nextConfig, null, 2);
  context.state.builder.selectedActionIndex = nextConfig.actions.length - 1;
  context.scheduleOnboardingSave();
}

export function removeBuilderAction(context, actionIndex) {
  const parsedIndex = Number.parseInt(actionIndex, 10);
  if (!Number.isFinite(parsedIndex) || parsedIndex < 0) return;
  const config = parseBuilderConfig(context.state.builder.customJson);
  if (!config || !Array.isArray(config.actions)) return;
  config.actions.splice(parsedIndex, 1);
  context.state.builder.customJson = JSON.stringify(hydrateRuntimeConfig(config, context.state.builder), null, 2);
  if (context.state.builder.selectedActionIndex === parsedIndex) {
    context.state.builder.selectedActionIndex = null;
  } else if (Number.isInteger(context.state.builder.selectedActionIndex) && context.state.builder.selectedActionIndex > parsedIndex) {
    context.state.builder.selectedActionIndex -= 1;
  }
  context.scheduleOnboardingSave();
}

export function selectBuilderAction(context, actionIndex) {
  const parsedIndex = Number.parseInt(actionIndex, 10);
  if (!Number.isFinite(parsedIndex) || parsedIndex < 0) {
    context.state.builder.selectedActionIndex = null;
    return;
  }
  context.state.builder.selectedActionIndex = parsedIndex;
}

export function updateBuilderAction(context, actionIndex, field, value) {
  const parsedIndex = Number.parseInt(actionIndex, 10);
  if (!Number.isFinite(parsedIndex) || parsedIndex < 0) {
    return { ok: false, error: 'Invalid step selected.' };
  }

  const config = parseBuilderConfig(context.state.builder.customJson);
  if (!config || !Array.isArray(config.actions) || !config.actions[parsedIndex]) {
    return { ok: false, error: 'Workflow step not found.' };
  }

  const nextAction = {
    ...config.actions[parsedIndex],
    config: { ...(config.actions[parsedIndex].config || {}) }
  };

  if (field === 'action_id') {
    nextAction.action_id = String(value || '').trim() || nextAction.action_id;
  } else if (field === 'action_type') {
    nextAction.action_type = String(value || '').trim() || nextAction.action_type;
  } else if (field === 'prompt') {
    nextAction.config.prompt = String(value || '');
  } else if (field === 'prompt_mode') {
    nextAction.config.prompt_mode = String(value || '').trim() === 'custom' ? 'custom' : 'default';
  } else if (field === 'system_prompt') {
    const nextValue = String(value || '');
    if (nextValue.trim()) {
      nextAction.config.system_prompt = nextValue;
    } else {
      delete nextAction.config.system_prompt;
    }
  } else if (field === 'connector_id') {
    if (String(value || '').trim()) {
      nextAction.config.connector_id = String(value).trim();
    } else {
      delete nextAction.config.connector_id;
    }
  } else if (field === 'config_json') {
    try {
      const parsedConfig = JSON.parse(value || '{}');
      if (!parsedConfig || typeof parsedConfig !== 'object' || Array.isArray(parsedConfig)) {
        return { ok: false, error: 'Step config must be a JSON object.' };
      }
      nextAction.config = parsedConfig;
    } catch (error) {
      return { ok: false, error: 'Step config JSON is invalid.' };
    }
  } else if (field === 'when_json') {
    // Empty string or whitespace → remove the when clause entirely.
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      delete nextAction.when;
    } else {
      try {
        const parsedWhen = JSON.parse(trimmed);
        if (!parsedWhen || typeof parsedWhen !== 'object' || Array.isArray(parsedWhen)) {
          return { ok: false, error: 'Condition clause must be a JSON object.' };
        }
        nextAction.when = parsedWhen;
      } catch (error) {
        return { ok: false, error: 'Condition clause JSON is invalid.' };
      }
    }
  }

  config.actions[parsedIndex] = nextAction;
  context.state.builder.customJson = JSON.stringify(hydrateRuntimeConfig(config, context.state.builder), null, 2);
  context.scheduleOnboardingSave();
  return { ok: true };
}

export function validateBuilder(context) {
  if (!configIsValid(context.state.builder)) {
    context.flash('Automation config JSON is not valid JSON yet.', true);
    return;
  }

  context.flash('Builder config is valid and ready for publish checks.');
}

export function builderPreflight(context) {
  const triggerMode = context.state.builder.triggerMode || triggerModeFromEvent(context.state.builder.triggerEvent);
  const triggerConfigured = triggerMode === 'scheduled'
    ? Boolean(isScheduledTriggerEvent(context.state.builder.triggerEvent) && context.state.builder.scheduleTime)
    : Boolean(context.state.builder.triggerEvent && !isScheduledTriggerEvent(context.state.builder.triggerEvent));
  return [
    {
      title: 'Intent defined',
      description: 'Automation intent should include a clear name and outcome description.',
      done: Boolean(context.state.builder.name.trim() && context.state.builder.description.trim())
    },
    {
      title: 'Trigger configured',
      description: 'Trigger event and timing should reflect how the workflow starts.',
      done: triggerConfigured
    },
    {
      title: 'Action logic provided',
      description: 'At least one workflow step/action should be configured.',
      done: countConfiguredActions(context.state.builder.customJson) > 0
    },
    {
      title: 'Scope selected',
      description: 'Matter scope requires a selected matter; organization scope does not.',
      done: context.state.builder.scopeType === 'organization' || Boolean(context.state.builder.matterId)
    },
    {
      title: 'Config compiles',
      description: 'The JSON preview should parse successfully before publish.',
      done: configIsValid(context.state.builder)
    }
  ];
}

function getBuilderSteps(context, preflight, recommendedConnectors) {
  const connectorStepReady = recommendedConnectors.length > 0 || countReadyConnectors(context) > 0;
  const statuses = [
    {
      number: '1',
      label: 'Define intent',
      done: Boolean(context.state.builder.name.trim() && context.state.builder.description.trim())
    },
    {
      number: '2',
      label: 'Configure trigger',
      done: Boolean(context.state.builder.triggerEvent && context.state.builder.scheduleTime && connectorStepReady)
    },
    {
      number: '3',
      label: 'Build actions',
      done: Boolean(context.state.builder.message.trim() && configIsValid(context.state.builder))
    },
    {
      number: '4',
      label: 'Set scope',
      done: context.state.builder.scopeType === 'organization' || Boolean(context.state.builder.matterId)
    },
    {
      number: '5',
      label: 'Preflight and publish',
      done: preflight.every((item) => item.done)
    }
  ];

  const firstPendingIndex = statuses.findIndex((step) => !step.done);

  return statuses.map((step, index) => {
    let stateClass = 'upcoming';
    let statusLabel = 'Up next';

    if (step.done) {
      stateClass = 'done';
      statusLabel = 'Complete';
    } else if (index === firstPendingIndex || firstPendingIndex === -1) {
      stateClass = 'active';
      statusLabel = 'Current';
    }

    return {
      ...step,
      stateClass,
      statusLabel
    };
  });
}

/**
 * Returns true when the builder is in edit mode and the JSON has diverged from
 * the original saved config.  Delegates to context.builderIsDirty() when
 * available (app.js provides it); falls back to false.
 *
 * @param {Object} context
 * @returns {boolean}
 */
function builderIsDirty(context) {
  if (typeof context.builderIsDirty === 'function') return context.builderIsDirty();
  if (!context.state.builder.editMode?.isEdit) return false;
  const original = context.state.builder.editMode.originalAutomation;
  if (!original) return false;
  try {
    const originalJson = JSON.stringify(original.automation_config || original.config || {}, null, 2);
    return context.state.builder.customJson !== originalJson;
  } catch (_err) {
    return false;
  }
}

function renderOverdueReminderMatrix(context) {
  const reminder = normalizeOverdueReminderState(context.state.builder.overdueReminder);
  const selectedBucket = reminder.buckets.find((bucket) => bucket.key === reminder.selectedBucketKey) || reminder.buckets[0];
  const selectedStage = reminder.stages.find((stage) => stage.key === reminder.selectedStageKey) || reminder.stages[0];
  const selectedCell = getOverdueTemplateCell(context.state.builder, selectedBucket?.key, selectedStage?.key);

  const bucketCards = reminder.buckets.map((bucket, index) => `
    <article class="overdue-bucket-card${bucket.key === reminder.selectedBucketKey ? ' overdue-bucket-card--selected' : ''}">
      <div class="overdue-bucket-card__header">
        <strong>Bucket ${index + 1}</strong>
        <span class="overdue-range-pill">${escapeHtml(bucket.maxDays === null ? `${bucket.minDays}+` : `${bucket.minDays}-${bucket.maxDays}`)} days</span>
      </div>
      <label>
        <span>Label</span>
        <input
          class="automation-builder-input"
          data-overdue-field="bucket_label"
          data-overdue-bucket-index="${index}"
          value="${escapeAttribute(bucket.label || '')}"
        >
      </label>
      <div class="overdue-bucket-grid">
        <label>
          <span>Min days</span>
          <input
            class="automation-builder-input"
            data-overdue-field="bucket_min_days"
            data-overdue-bucket-index="${index}"
            type="number"
            min="0"
            value="${escapeAttribute(bucket.minDays ?? '')}"
          >
        </label>
        <label>
          <span>Max days</span>
          <input
            class="automation-builder-input"
            data-overdue-field="bucket_max_days"
            data-overdue-bucket-index="${index}"
            type="number"
            min="0"
            placeholder="31+"
            value="${escapeAttribute(bucket.maxDays ?? '')}"
          >
        </label>
      </div>
    </article>
  `).join('');

  const matrixHead = reminder.stages.map((stage) => `
    <span class="overdue-matrix-head__cell">
      <strong>${escapeHtml(stage.label)}</strong>
      <small>${escapeHtml(stage.description || '')}</small>
    </span>
  `).join('');

  const matrixRows = reminder.buckets.map((bucket) => {
    const cells = reminder.stages.map((stage) => {
      const template = reminder.templates?.[bucket.key]?.[stage.key] || defaultOverdueTemplateCell(bucket, stage);
      const isSelected = bucket.key === reminder.selectedBucketKey && stage.key === reminder.selectedStageKey;
      return `
        <button
          type="button"
          class="overdue-matrix-cell${isSelected ? ' overdue-matrix-cell--selected' : ''}"
          data-overdue-select-cell="${escapeAttribute(`${bucket.key}:${stage.key}`)}"
          data-overdue-bucket-key="${escapeAttribute(bucket.key)}"
          data-overdue-stage-key="${escapeAttribute(stage.key)}"
        >
          <span class="overdue-matrix-cell__stage">${escapeHtml(stage.label)}</span>
          <strong>${escapeHtml(template.subject || 'Untitled template')}</strong>
          <span class="overdue-matrix-cell__body">${escapeHtml(truncateTemplatePreview(template.body || ''))}</span>
        </button>
      `;
    }).join('');

    return `
      <div class="overdue-matrix-row">
        <div class="overdue-matrix-row__label">
          <strong>${escapeHtml(bucket.label)}</strong>
          <span>${escapeHtml(bucket.maxDays === null ? `${bucket.minDays}+ days` : `${bucket.minDays}-${bucket.maxDays} days`)}</span>
        </div>
        <div class="overdue-matrix-row__cells">
          ${cells}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="overdue-reminder-panel">
      <div class="badge-row overdue-reminder-badges">
        ${badge('Deterministic', 'success')}
        ${badge('AI-free')}
        ${badge('Template matrix')}
        ${badge('Audit-friendly')}
      </div>
      <div class="surface-note overdue-reminder-note">
        Define the overdue ranges once, then map each bucket to a follow-up stage template. The matrix below compiles into a single rule set.
      </div>
      <div class="overdue-reminder-layout">
        <section class="overdue-reminder-list">
          <div class="overdue-section-heading">
            <strong>Buckets</strong>
            <span>Explicit overdue ranges</span>
          </div>
          <div class="overdue-bucket-list">
            ${bucketCards}
          </div>
        </section>
        <section class="overdue-reminder-matrix">
          <div class="overdue-section-heading">
            <strong>Template Matrix</strong>
            <span>3 buckets x 3 follow-up stages</span>
          </div>
          <div class="overdue-matrix-head">
            <span></span>
            ${matrixHead}
          </div>
          <div class="overdue-matrix-grid">
            ${matrixRows}
          </div>
        </section>
        <aside class="overdue-reminder-editor">
          <div class="overdue-section-heading">
            <strong>Selected Template</strong>
            <span>${escapeHtml(selectedBucket?.label || 'Bucket')} / ${escapeHtml(selectedStage?.label || 'Stage')}</span>
          </div>
          <div class="overdue-editor-card">
            <div class="badge-row">
              ${badge(selectedBucket?.label || 'Bucket')}
              ${badge(selectedStage?.label || 'Stage')}
            </div>
            <label>
              <span>Subject</span>
              <input
                class="automation-builder-input"
                data-overdue-field="template_subject"
                data-overdue-bucket-key="${escapeAttribute(selectedBucket?.key || '')}"
                data-overdue-stage-key="${escapeAttribute(selectedStage?.key || '')}"
                data-overdue-template-field="subject"
                value="${escapeAttribute(selectedCell.cell.subject || '')}"
              >
            </label>
            <label>
              <span>Email body</span>
              <textarea
                class="automation-builder-input"
                rows="7"
                data-overdue-field="template_body"
                data-overdue-bucket-key="${escapeAttribute(selectedBucket?.key || '')}"
                data-overdue-stage-key="${escapeAttribute(selectedStage?.key || '')}"
                data-overdue-template-field="body"
              >${escapeHtml(selectedCell.cell.body || '')}</textarea>
            </label>
            <div class="overdue-bucket-grid">
              <label>
                <span>Task title</span>
                <input
                  class="automation-builder-input"
                  data-overdue-field="template_task_title"
                  data-overdue-bucket-key="${escapeAttribute(selectedBucket?.key || '')}"
                  data-overdue-stage-key="${escapeAttribute(selectedStage?.key || '')}"
                  data-overdue-template-field="task_title"
                  value="${escapeAttribute(selectedCell.cell.task_title || '')}"
                >
              </label>
              <label>
                <span>Internal note</span>
                <input
                  class="automation-builder-input"
                  data-overdue-field="template_internal_note"
                  data-overdue-bucket-key="${escapeAttribute(selectedBucket?.key || '')}"
                  data-overdue-stage-key="${escapeAttribute(selectedStage?.key || '')}"
                  data-overdue-template-field="internal_note"
                  value="${escapeAttribute(selectedCell.cell.internal_note || '')}"
                >
              </label>
            </div>
            <label>
              <span>Call to action</span>
              <input
                class="automation-builder-input"
                data-overdue-field="template_cta_label"
                data-overdue-bucket-key="${escapeAttribute(selectedBucket?.key || '')}"
                data-overdue-stage-key="${escapeAttribute(selectedStage?.key || '')}"
                data-overdue-template-field="cta_label"
                value="${escapeAttribute(selectedCell.cell.cta_label || '')}"
              >
            </label>
            <div class="overdue-template-preview">
              <strong>Preview</strong>
              <p>${escapeHtml(selectedCell.cell.subject || '')}</p>
              <p class="muted">${escapeHtml(truncateTemplatePreview(selectedCell.cell.body || ''))}</p>
            </div>
            <div class="overdue-variable-panel">
              <strong>Available tokens</strong>
              <div class="badge-row">
                ${['{{invoice.number}}', '{{invoice.client_name}}', '{{invoice.amount_due}}', '{{invoice.due_date}}', '{{invoice.days_overdue}}'].map((token) => badge(token)).join('')}
              </div>
            </div>
            <div class="row-actions">
              <lex-btn variant="secondary" size="sm" data-overdue-reset-defaults>Reset Matrix</lex-btn>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;
}

function truncateTemplatePreview(value, maxLen = 110) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function renderActionInsights(insights) {
  if (!insights) return '';

  const renderEntryList = (entries, emptyCopy) => entries.length
    ? `
      <div class="action-contract-list">
        ${entries.map((entry) => `
          <article class="action-contract-item">
            <div class="action-contract-item__head">
              <strong>${escapeHtml(entry.label)}</strong>
              ${entry.code ? `<code>${escapeHtml(entry.code)}</code>` : ''}
            </div>
            <p>${escapeHtml(entry.detail)}</p>
          </article>
        `).join('')}
      </div>
    `
    : `<div class="surface-note">${escapeHtml(emptyCopy)}</div>`;

  return `
    <section class="action-contract-panel">
      <div class="action-contract-overview">
        <strong>What this step does</strong>
        <p>${escapeHtml(insights.purpose)}</p>
      </div>
      ${insights.renameWarning ? `<div class="surface-note action-contract-warning">${escapeHtml(insights.renameWarning)}</div>` : ''}
      ${insights.localTemplateHelp ? `<div class="surface-note action-contract-tip">${escapeHtml(insights.localTemplateHelp)}</div>` : ''}
      <div class="action-contract-grid">
        <section class="action-contract-card">
          <h4>This step uses</h4>
          ${renderEntryList(insights.inputs, 'This step does not rely on any earlier step outputs yet.')}
        </section>
        <section class="action-contract-card">
          <h4>This step produces</h4>
          ${renderEntryList(insights.outputs, 'This step mainly performs a side effect instead of returning reusable fields.')}
        </section>
        <section class="action-contract-card">
          <h4>Used by later steps</h4>
          ${renderEntryList(insights.downstream, 'No later step depends on this one yet.')}
        </section>
      </div>
      <div class="surface-note action-contract-swap">
        <strong>Safe to swap:</strong> ${escapeHtml(insights.swapGuidance)}
      </div>
    </section>
  `;
}

export function renderBuilder(context) {
  const mount = context.els.viewContent;
  const selectedTemplate = getSelectedTemplate(context);
  const triggerMode = context.state.builder.triggerMode || triggerModeFromEvent(context.state.builder.triggerEvent);
  const triggerOptions = triggerMode === 'scheduled' ? SCHEDULED_TRIGGER_OPTIONS : SYSTEM_TRIGGER_OPTIONS;
  const preflight = builderPreflight(context);
  const diagnostics = computeBuilderDiagnostics(context, preflight);
  const actionSteps = getActionSteps(context.state.builder.customJson);
  const connectorOptions = getConnectorOptions(context.state.connectors || []);
  const selectedActionIndex = Number.isInteger(context.state.builder.selectedActionIndex)
    ? context.state.builder.selectedActionIndex
    : null;
  const selectedAction = selectedActionIndex !== null ? actionSteps[selectedActionIndex] : null;
  const selectedActionInsights = selectedAction ? buildActionInsights(selectedAction, actionSteps, selectedActionIndex) : null;
  const selectedComponentInfo = selectedAction ? getStepComponentInfo(selectedAction.type) : null;
  const selectedActionIsAi = String(selectedAction?.type || '').startsWith('ai.');
  const selectedActionPromptMode = selectedAction?.config?.prompt_mode === 'custom' ? 'custom' : 'default';
  const selectedActionSystemPrompt = String(selectedAction?.config?.system_prompt || '');
  const selectedActionPrompt = String(
    selectedAction?.config?.prompt
      || selectedAction?.config?.message
      || selectedAction?.config?.text
      || ''
  );
  const recommendedConnectors = context.state.connectors.filter((connector) =>
    selectedTemplate.connectorHints.some((hint) =>
      normalizeText(connectorDisplayName(connector)).includes(normalizeText(hint)) ||
      normalizeText(connector.metadata?.description).includes(normalizeText(hint))
    )
  );
  const paletteItems = getStepPaletteItems();
  const overdueReminderMode = isOverdueInvoiceReminderTemplate(selectedTemplate) || isOverdueInvoiceReminderConfig(parseBuilderConfig(context.state.builder.customJson));

  const isEdit = Boolean(context.state.builder.editMode?.isEdit);
  const editAutomationName = isEdit ? (context.state.builder.name || 'Automation') : '';
  const dirty = isEdit && builderIsDirty(context);

  if (context.state.builder.editMode?.loading) {
    mount.innerHTML = `
      <section class="automations-builder-shell">
        <div class="surface-note" style="padding:2rem;text-align:center;">Loading automation&hellip;</div>
      </section>
    `;
    return;
  }

  const editAutomationId = context.state.builder.editMode?.automationId || '';
  const breadcrumbItems = isEdit
    ? [
        { label: 'Library', href: '#library' },
        { label: editAutomationName, href: `#library-detail:${editAutomationId}` },
        { label: 'Edit' }
      ]
    : [
        { label: 'Library', href: '#library' },
        { label: 'New Automation' }
      ];
  const breadcrumb = `<lex-breadcrumb class="automations-builder-breadcrumb" items="${escapeAttribute(JSON.stringify(breadcrumbItems))}"></lex-breadcrumb>`;

  const editIsEnabled = isEdit
    ? Boolean(context.state.builder.editMode?.originalAutomation?.is_enabled)
    : false;
  const bannerHeading = isEdit
    ? `Edit Automation: ${editAutomationName}`
    : overdueReminderMode
      ? 'Configure overdue invoice reminder rules'
      : 'Create a multi-step automated automation';
  const bannerSubtitle = isEdit
    ? 'Edit the automation config below, then save your changes.'
    : overdueReminderMode
      ? 'Use explicit buckets and follow-up templates to keep billing reminders deterministic.'
      : 'Start with your trigger, then add and tune steps.';
  const bannerStatus = isEdit ? (editIsEnabled ? 'connected' : 'offline') : 'none';

  mount.innerHTML = `
    <section class="automations-builder-shell">
      <lex-banner
        class="automations-builder-banner"
        variant="light"
        size="compact"
        heading="${escapeAttribute(bannerHeading)}"
        subtitle="${escapeAttribute(bannerSubtitle)}"
        status="${bannerStatus}"
        icon="A">
        <div class="badge-row automations-builder-banner-badges" data-banner-meta>
          ${badge(`${actionSteps.length} step${actionSteps.length === 1 ? '' : 's'}`)}
          ${badge(triggerMode === 'scheduled' ? 'Scheduled (pg-boss)' : 'System Event')}
          ${overdueReminderMode ? badge('Deterministic rules', 'success') : ''}
          ${isEdit ? badge(editIsEnabled ? 'Active' : 'Inactive', editIsEnabled ? 'success' : '') : ''}
          ${dirty ? '<span class="builder-dirty-pill" aria-live="polite">Unsaved changes</span>' : ''}
        </div>
        ${isEdit ? `
          <lex-btn variant="ghost" size="sm" data-builder-toggle-active data-edit-automation-id="${escapeAttribute(editAutomationId)}" data-current-enabled="${editIsEnabled ? 'true' : 'false'}">
            ${editIsEnabled ? 'Deactivate' : 'Activate'}
          </lex-btn>
          <lex-btn variant="danger" size="sm" data-builder-delete data-edit-automation-id="${escapeAttribute(editAutomationId)}" data-edit-automation-name="${escapeAttribute(editAutomationName)}">Delete</lex-btn>
        ` : ''}
        <lex-btn variant="primary" size="sm" data-open-publish-modal>${isEdit ? (dirty ? 'Save Changes \u2022' : 'Save Changes') : 'Publish'}</lex-btn>
      </lex-banner>
      ${breadcrumb}

      <div class="automations-builder-body">
        <div class="automations-builder-main">
          <article class="automations-intent-card">
            <div class="automations-intent-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
            </div>
            <div class="automations-intent-fields">
              <label>
                <span>Automation Intent</span>
                <input
                  class="automation-builder-input"
                  id="builder-name"
                  data-builder-field="name"
                  value="${escapeAttribute(context.state.builder.name)}"
                  placeholder="e.g., Auto-triage new litigation documents"
                >
              </label>
              <label>
                <span>Outcome Description</span>
                <textarea
                  class="automation-builder-input"
                  id="builder-description"
                  data-builder-field="description"
                  rows="2"
                  placeholder="Describe the business outcome this automation achieves..."
                >${escapeHtml(context.state.builder.description)}</textarea>
              </label>
            </div>
          </article>

          ${surface({
            title: 'Trigger',
            subtitle: 'Choose what starts this automation.',
            body: `
              <div class="form-grid">
                <label>
                  <span>Trigger Type</span>
                  <select class="automation-builder-input" data-builder-field="triggerMode">
                    <option value="event" ${triggerMode === 'event' ? 'selected' : ''}>System Event (captured in app)</option>
                    <option value="scheduled" ${triggerMode === 'scheduled' ? 'selected' : ''}>Scheduled (pg-boss worker)</option>
                  </select>
                </label>
                <label>
                  <span>Trigger</span>
                  <div class="stack-sm">
                    <div class="flex items-center gap-2">
                      <select class="automation-builder-input flex-1" id="builder-trigger" data-builder-field="triggerEvent">
                        ${triggerOptions.map((eventType) => `
                          <option value="${eventType}" ${context.state.builder.triggerEvent === eventType ? 'selected' : ''}>${eventType}</option>
                        `).join('')}
                      </select>
                      <lex-btn
                        variant="secondary"
                        size="sm"
                        data-open-event-browser
                        data-event-browser-current="${escapeAttribute(context.state.builder.triggerEvent || '')}"
                      >
                        Browse Events
                      </lex-btn>
                    </div>
                    <div class="builder-event-summary">
                      ${renderTriggerEventSummary(context.state.builder.triggerEvent || triggerOptions[0] || '')}
                    </div>
                  </div>
                </label>
                <label>
                  <span>Connector Data Source Filter</span>
                  <select class="automation-builder-input" data-builder-field="triggerConnectorId">
                    <option value="">All connector sources</option>
                    ${connectorOptions.map((option) => `
                      <option value="${escapeAttribute(option.id)}" ${context.state.builder.triggerConnectorId === option.id ? 'selected' : ''}>
                        ${escapeHtml(option.label)}
                      </option>
                    `).join('')}
                  </select>
                </label>
                ${triggerMode === 'scheduled' ? `
                  <label>
                    <span>Schedule Time</span>
                    <input class="automation-builder-input" id="builder-time" data-builder-field="scheduleTime" type="time" value="${escapeAttribute(context.state.builder.scheduleTime)}">
                  </label>
                  <label>
                    <span>Day of Week</span>
                    <select class="automation-builder-input" id="builder-day" data-builder-field="dayOfWeek">
                      ${DAY_OPTIONS.map(([value, label]) => `
                        <option value="${value}" ${context.state.builder.dayOfWeek === value ? 'selected' : ''}>${label}</option>
                      `).join('')}
                    </select>
                  </label>
                ` : ''}
              </div>
              <div class="surface-note">
                ${triggerMode === 'scheduled'
                  ? 'Scheduled workflows run from pg-boss workers using the selected cadence.'
                  : 'System-event workflows run when matching events are captured in the application.'}
              </div>
              <div class="badge-row">
                ${selectedTemplate.connectorHints.map((hint) => badge(hint)).join('')}
              </div>
              ${recommendedConnectors.length
                ? `<div class="stack-md">${recommendedConnectors.map((connector) => connectorCompact(context, connector)).join('')}</div>`
                : ''}
            `
          })}

          ${surface({
            title: overdueReminderMode ? 'Overdue Invoice Rules' : 'Workflow Steps',
            subtitle: overdueReminderMode
              ? 'The rule matrix compiles to deterministic actions below. The visual editor is the primary setup surface.'
              : 'Add steps in order and remove what you do not need.',
            body: `
              ${overdueReminderMode ? renderOverdueReminderMatrix(context) : ''}
              ${overdueReminderMode ? '<div class="surface-divider overdue-reminder-divider" style="margin:18px 0;"></div>' : ''}
              <div id="workflow-steps-container" class="automations-sequencer">
                ${actionSteps.length ? '<div class="automations-sequencer-rail"></div>' : ''}
                ${actionSteps.length
                  ? actionSteps.map((step, index) => `
                    <article class="automation-step-card ${selectedActionIndex === index ? 'active' : ''}" data-configure-action-index="${index}">
                      <span class="automation-step-badge">${escapeHtml(String(index + 1))}</span>
                      <span class="automation-step-copy">
                        <strong>${escapeHtml(step.label)}</strong>
                        <small><code>${escapeHtml(step.type)}</code></small>
                        <small class="automation-step-summary">${escapeHtml(step.summary)}</small>
                      </span>
                      <lex-btn
                        variant="secondary"
                        size="sm"
                        data-configure-action-index="${index}"
                        class="automation-step-configure"
                      >
                        Configure
                      </lex-btn>
                      <lex-btn
                        variant="ghost"
                        size="sm"
                        data-remove-action-index="${index}"
                        class="automation-step-remove"
                      >
                        Remove
                      </lex-btn>
                    </article>
                  `).join('')
                  : '<div class="surface-note">No steps yet. Add your first step below.</div>'}
              </div>
              <div class="automations-components-label">STEP COMPONENTS</div>
              <div class="automations-add-actions">
                ${paletteItems.map((item) => `
                  <span
                    class="step-component-item"
                    data-tooltip="${escapeAttribute(`${item.label}: ${item.copy}`)}"
                  >
                    <lex-btn variant="secondary" size="sm" data-add-action-type="${escapeAttribute(item.actionType)}">+ ${escapeHtml(item.label)}</lex-btn>
                  </span>
                `).join('')}
              </div>
            `
          })}

        </div>

        <aside class="automations-builder-side">
          ${selectedAction ? `
            <section class="action-config-drawer">
              <div class="action-config-head">
                <h3>Configure Step ${selectedActionIndex + 1}</h3>
                <lex-btn variant="ghost" size="sm" data-close-action-config>Close</lex-btn>
              </div>
              ${selectedComponentInfo ? `
                <div class="action-component-info ${escapeAttribute(selectedComponentInfo.toneClass)}">
                  <div class="automations-palette-head">
                    <strong>${escapeHtml(selectedComponentInfo.label)}</strong>
                    <code>${escapeHtml(selectedComponentInfo.token)}</code>
                  </div>
                  <p>${escapeHtml(selectedComponentInfo.copy)}</p>
                  <div class="automations-palette-tags">
                    ${selectedComponentInfo.examples.map((example) => `<code>${escapeHtml(example)}</code>`).join('')}
                  </div>
                </div>
              ` : ''}
              ${renderActionInsights(selectedActionInsights)}
              <div class="stack-md">
                ${selectedActionIsAi ? `
                  <label>
                    <span>AI Instructions Mode</span>
                    <select
                      class="automation-builder-input"
                      data-action-index="${selectedActionIndex}"
                      data-action-field="prompt_mode"
                    >
                      <option value="default" ${selectedActionPromptMode === 'default' ? 'selected' : ''}>Use Default AI Instructions</option>
                      <option value="custom" ${selectedActionPromptMode === 'custom' ? 'selected' : ''}>Use Custom System Prompt</option>
                    </select>
                  </label>
                  ${selectedActionPromptMode === 'custom' ? `
                    <label>
                      <span>System Prompt</span>
                      <textarea
                        class="automation-builder-input"
                        data-action-index="${selectedActionIndex}"
                        data-action-field="system_prompt"
                        rows="4"
                      >${escapeHtml(selectedActionSystemPrompt)}</textarea>
                    </label>
                  ` : `
                    <div class="surface-note">
                      This step uses the platform default system prompt for <code>${escapeHtml(selectedAction.type)}</code>. Switch to custom if you need migrated or domain-specific instructions.
                    </div>
                  `}
                  <label>
                    <span>AI Prompt</span>
                    <textarea
                      class="automation-builder-input"
                      data-action-index="${selectedActionIndex}"
                      data-action-field="prompt"
                      rows="5"
                    >${escapeHtml(selectedActionPrompt)}</textarea>
                  </label>
                ` : ''}
                <label>
                  <span>Action ID</span>
                  <input
                    class="automation-builder-input"
                    data-action-index="${selectedActionIndex}"
                    data-action-field="action_id"
                    value="${escapeAttribute(selectedAction.label)}"
                  >
                </label>
                <label>
                  <span>Action Type</span>
                  <input
                    class="automation-builder-input"
                    data-action-index="${selectedActionIndex}"
                    data-action-field="action_type"
                    value="${escapeAttribute(selectedAction.type)}"
                  >
                </label>
                <label>
                  <span>Connector Data Source Filter</span>
                  <select
                    class="automation-builder-input"
                    data-action-index="${selectedActionIndex}"
                    data-action-field="connector_id"
                  >
                    <option value="">All connector sources</option>
                    ${connectorOptions.map((option) => `
                      <option value="${escapeAttribute(option.id)}" ${selectedAction.connectorId === option.id ? 'selected' : ''}>
                        ${escapeHtml(option.label)}
                      </option>
                    `).join('')}
                  </select>
                </label>
                <label>
                  <span>Step Config JSON</span>
                  <textarea
                    class="automation-builder-input"
                    data-action-index="${selectedActionIndex}"
                    data-action-field="config_json"
                    rows="8"
                  >${escapeHtml(JSON.stringify(selectedAction.config || {}, null, 2))}</textarea>
                </label>
                <details class="advanced-panel action-conditions-panel ${selectedAction.when ? 'action-conditions-panel--active' : ''}" ${selectedAction.when ? 'open' : ''}>
                  <summary class="action-conditions-summary">
                    Conditions
                    ${selectedAction.when ? '<span class="action-conditions-badge">Active</span>' : '<span class="action-conditions-badge action-conditions-badge--none">None</span>'}
                  </summary>
                  <div class="stack-md action-conditions-body">
                    <p class="surface-note">
                      Optional. If set, this step only runs when all conditions pass.
                      Leave blank to always run. Paths use dot-notation:
                      <code>action.&lt;id&gt;.&lt;field&gt;</code>,
                      <code>trigger.email.subject</code>, etc.
                      Valid ops: <code>equals</code>, <code>not_equals</code>,
                      <code>exists</code>, <code>not_exists</code>,
                      <code>gt</code>, <code>lt</code>,
                      <code>contains</code>, <code>matches</code>.
                    </p>
                    <p class="surface-note">
                      Example &mdash; run only when a prior step returned
                      <code>is_fallback: false</code>:
                    </p>
                    <pre class="action-conditions-example">{"all": [{"path": "action.find-slot.is_fallback", "op": "equals", "value": false}]}</pre>
                    <label>
                      <span>Condition Clause JSON</span>
                      <textarea
                        class="automation-builder-input"
                        data-action-index="${selectedActionIndex}"
                        data-action-field="when_json"
                        rows="6"
                        placeholder='{"all": [{"path": "action.<id>.<field>", "op": "equals", "value": true}]}'
                      >${escapeHtml(selectedAction.when ? JSON.stringify(selectedAction.when, null, 2) : '')}</textarea>
                    </label>
                    <div class="surface-note action-conditions-hint">
                      Clear this field and save to remove the condition.
                    </div>
                  </div>
                </details>
              </div>
            </section>
          ` : ''}

          <div class="automations-sidebar-section-title">Diagnostics</div>
          <section class="automations-diag-panel">
            <div class="automations-side-title-row">
              <h3>MX Health</h3>
              <span class="automations-ready-pill">Ready</span>
            </div>
            <div class="automations-metric-block">
              <div class="automations-metric-head">
                <span>Parseability Index</span>
                <strong id="mx-parseability-score">${escapeHtml(`${diagnostics.parseability}%`)}</strong>
              </div>
              <div class="automations-progress-track">
                <div id="mx-parseability-bar" class="automations-progress-bar" style="width:${escapeAttribute(String(diagnostics.parseability))}%"></div>
              </div>
              <p>How clearly this workflow can be interpreted and executed.</p>
            </div>
            <div class="automations-metric-block">
              <div class="automations-metric-head">
                <span>Intent Clarity</span>
                <strong id="mx-intent-score">${escapeHtml(diagnostics.intentClarity)}</strong>
              </div>
              <p>${escapeHtml(diagnostics.intentHint)}</p>
            </div>
            <div class="automations-metric-block">
              <div class="automations-metric-head">
                <span>Step Health</span>
                <strong id="mx-step-count">${escapeHtml(diagnostics.stepSummary)}</strong>
              </div>
              <div class="automations-step-health">
                <span>Triggers: <b id="mx-trigger-count">${escapeHtml(String(diagnostics.triggerCount))}</b></span>
                <span>Logic: <b id="mx-condition-count">${escapeHtml(String(diagnostics.conditionCount))}</b></span>
                <span>Actions: <b id="mx-action-count">${escapeHtml(String(diagnostics.actionCount))}</b></span>
              </div>
            </div>
          </section>

          ${isEdit ? `
            <div class="automations-sidebar-section-title">Settings</div>
            <section class="automations-settings-panel">
              <p class="automations-settings-help">Configure scope, publish state, and visibility. Changes save with the automation.</p>
              <label>
                <span>Scope</span>
                <select class="automation-builder-input" data-builder-field="scopeType">
                  <option value="matter" ${context.state.builder.scopeType === 'matter' ? 'selected' : ''}>Specific matter</option>
                  <option value="organization" ${context.state.builder.scopeType === 'organization' ? 'selected' : ''}>Organization-wide</option>
                </select>
              </label>
              ${context.state.builder.scopeType === 'matter' ? (() => {
                const matterQuery = (context.state.builder.matterSearch || '').toLowerCase();
                const allMatters = context.state.matters;
                const filteredMatters = matterQuery
                  ? allMatters.filter((matter) =>
                      String(matter.name || '').toLowerCase().includes(matterQuery) ||
                      String(matterRef(matter) || '').toLowerCase().includes(matterQuery))
                  : allMatters;
                const selectedRef = context.state.builder.matterId;
                const selectedMatter = allMatters.find((m) => matterRef(m) === selectedRef);
                const optionMatters = selectedMatter && !filteredMatters.includes(selectedMatter)
                  ? [selectedMatter, ...filteredMatters]
                  : filteredMatters;
                return `
                  <label>
                    <span>Matter</span>
                    <input
                      type="search"
                      class="automation-builder-input automation-builder-matter-search"
                      data-builder-field="matterSearch"
                      placeholder="Search matters by name or ID${allMatters.length ? ` (${allMatters.length} total)` : ''}…"
                      value="${escapeAttribute(context.state.builder.matterSearch || '')}"
                      autocomplete="off">
                    <select class="automation-builder-input" data-builder-field="matterId" size="${Math.min(Math.max(optionMatters.length, 3), 8)}">
                      ${optionMatters.length === 0
                        ? '<option disabled>No matters match your search</option>'
                        : optionMatters.map((matter) => `
                          <option value="${escapeAttribute(matterRef(matter))}" ${selectedRef === matterRef(matter) ? 'selected' : ''}>
                            ${escapeHtml(matter.name || matterRef(matter))}
                          </option>
                        `).join('')}
                    </select>
                  </label>
                `;
              })() : ''}
              <label>
                <span>Publish state</span>
                <select class="automation-builder-input" data-builder-field="publishMode">
                  <option value="enabled" ${context.state.builder.publishMode === 'enabled' ? 'selected' : ''}>Active</option>
                  <option value="disabled" ${context.state.builder.publishMode === 'disabled' ? 'selected' : ''}>Inactive</option>
                </select>
              </label>
              <label>
                <span>Visibility</span>
                <select class="automation-builder-input" data-builder-visibility data-edit-automation-id="${escapeAttribute(editAutomationId)}">
                  <option value="private" ${(context.state.builder.editMode?.originalAutomation?.visibility || 'private') === 'private' ? 'selected' : ''}>Private</option>
                  <option value="org_wide" ${context.state.builder.editMode?.originalAutomation?.visibility === 'org_wide' ? 'selected' : ''}>Organization-Wide</option>
                </select>
              </label>
            </section>
          ` : ''}

          <div class="automations-sidebar-section-title">Reference</div>
          <section class="automations-vars-panel">
            <h3>Shared Data You Can Use</h3>
            <p class="automations-vars-panel__copy">When a step needs data, start with trigger, matter, user, or a previous step output. The step drawer now shows the safest references for the step you are editing.</p>
            <code>{{trigger.document_id}}</code>
            <code>{{matter.name}}</code>
            <code>{{user.id}}</code>
            <code>{{actions.step_id.output_field}}</code>
          </section>

          <div class="automations-sidebar-section-title">Advanced</div>
          <section class="automations-json-panel">
            <details class="advanced-panel">
              <summary>Advanced Automation Config JSON</summary>
              <div class="stack-md">
                <label class="full">
                  <span>Automation Config JSON</span>
                  <textarea class="automation-builder-input side-json-textarea" id="builder-json" data-builder-field="customJson">${escapeHtml(context.state.builder.customJson)}</textarea>
                </label>
                <div class="row-actions">
                  <lex-btn id="reset-builder-btn" variant="secondary" size="sm">Reset To Quick Start</lex-btn>
                  <lex-btn variant="ghost" size="sm" data-app-action="validate-builder">Validate Config</lex-btn>
                </div>
              </div>
            </details>
          </section>
        </aside>
      </div>

      <footer class="automations-builder-footer">
        <div class="automations-footer-meta"><span id="workflow-step-count">${escapeHtml(diagnostics.stepSummary)}</span> configured</div>
        <div class="row-actions row-actions-spread">
          <div class="row-actions">
            ${isEdit
              ? `<lex-btn variant="secondary" size="sm" data-builder-cancel-edit data-edit-automation-id="${escapeAttribute(context.state.builder.editMode?.automationId || '')}">Cancel</lex-btn>`
              : '<lex-btn variant="secondary" size="sm" data-open-view="library">Cancel</lex-btn>'}
          </div>
          <div class="row-actions">
            <lex-btn variant="primary" size="sm" data-open-publish-modal ${preflight.every((item) => item.done) ? '' : 'disabled'}>${isEdit ? 'Save Changes' : 'Publish'}</lex-btn>
          </div>
        </div>
      </footer>

      <div class="builder-publish-modal ${context.state.builder.publishModalOpen ? '' : 'hidden'}" role="dialog" aria-modal="true" aria-labelledby="builder-publish-title">
        <div class="builder-publish-overlay" data-close-publish-modal></div>
        <div class="builder-publish-panel">
          <div class="builder-publish-header">
            <h3 id="builder-publish-title">Publish Automation</h3>
            <lex-btn variant="ghost" size="sm" data-close-publish-modal>Close</lex-btn>
          </div>
          <div class="builder-publish-body">
            <div class="form-grid">
              <label>
                <span>Scope</span>
                <select class="automation-builder-input" data-builder-field="scopeType">
                  <option value="matter" ${context.state.builder.scopeType === 'matter' ? 'selected' : ''}>Specific matter</option>
                  <option value="organization" ${context.state.builder.scopeType === 'organization' ? 'selected' : ''}>Organization-wide</option>
                </select>
              </label>
              <label>
                <span>Publish state</span>
                <select class="automation-builder-input" data-builder-field="publishMode">
                  <option value="enabled" ${context.state.builder.publishMode === 'enabled' ? 'selected' : ''}>Publish live</option>
                  <option value="disabled" ${context.state.builder.publishMode === 'disabled' ? 'selected' : ''}>Create disabled</option>
                </select>
              </label>
              ${context.state.builder.scopeType === 'matter' ? `
                <label class="full">
                  <span>Matter</span>
                  <select class="automation-builder-input" data-builder-field="matterId">
                    ${context.state.matters.map((matter) => `
                      <option value="${escapeAttribute(matterRef(matter))}" ${context.state.builder.matterId === matterRef(matter) ? 'selected' : ''}>
                        ${escapeHtml(matter.name || matterRef(matter))}
                      </option>
                    `).join('')}
                  </select>
                </label>
              ` : ''}
            </div>
            ${metaGrid([
              { label: 'Quick Start', value: selectedTemplate.name },
              { label: 'Trigger', value: context.state.builder.triggerEvent },
              { label: 'Scope', value: context.state.builder.scopeType === 'matter' ? `Matter: ${selectedMatterName(context)}` : 'Organization-wide' },
              { label: 'Publish', value: context.state.builder.publishMode === 'enabled' ? 'Live' : 'Disabled' }
            ])}
            ${(() => {
              const failing = preflight.filter((item) => !item.done);
              if (failing.length === 0) return '';
              return `
                <div class="builder-publish-blockers" role="alert">
                  <strong>Resolve before ${isEdit ? 'saving' : 'publishing'}:</strong>
                  <ul>
                    ${failing.map((item) => `<li><strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(item.description)}</li>`).join('')}
                  </ul>
                </div>
              `;
            })()}
          </div>
          <div class="builder-publish-footer">
            <lex-btn variant="secondary" size="sm" data-close-publish-modal>Cancel</lex-btn>
            <lex-btn id="create-automation-btn" variant="primary" size="sm" ${preflight.every((item) => item.done) ? '' : 'disabled'}>${isEdit ? 'Save Changes' : 'Publish Automation'}</lex-btn>
          </div>
        </div>
      </div>
    </section>
  `;
}

function computeBuilderDiagnostics(context, preflight) {
  const doneCount = preflight.filter((item) => item.done).length;
  const parseability = Math.round((doneCount / preflight.length) * 100);
  const intentLength = (context.state.builder.name || '').trim().length + (context.state.builder.description || '').trim().length;
  const intentClarity = intentLength >= 90 ? 'Strong' : intentLength >= 45 ? 'Medium' : 'Needs detail';
  const intentHint = intentLength >= 45
    ? 'Intent is clear enough to continue refining workflow logic.'
    : 'Add more context in the intent fields to improve parseability.';
  const actionCount = countConfiguredActions(context.state.builder.customJson);
  const triggerCount = context.state.builder.triggerEvent ? 1 : 0;
  const conditionCount = context.state.builder.scopeType === 'matter' ? 1 : 0;

  return {
    parseability,
    intentClarity,
    intentHint,
    actionCount,
    triggerCount,
    conditionCount,
    stepSummary: `${Math.max(1, actionCount + triggerCount + conditionCount)} steps`
  };
}

function countConfiguredActions(configJson) {
  try {
    const parsed = JSON.parse(configJson || '{}');
    return Array.isArray(parsed.actions) ? parsed.actions.length : 0;
  } catch (error) {
    return 0;
  }
}

function getActionSteps(configJson) {
  const parsed = parseBuilderConfig(configJson);
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
  return actions.map((action, index) => ({
    index,
    type: action.action_type || 'custom.action',
    label: action.action_id || `step_${index + 1}`,
    config: action.config || {},
    connectorId: action.config?.connector_id || '',
    dependsOn: Array.isArray(action.dependsOn) ? action.dependsOn : [],
    // Carry the when-clause so the config drawer can display and edit it.
    when: action.when || null,
    summary: summarizeActionStep(action)
  }));
}

function summarizeActionStep(action) {
  const type = String(action?.action_type || '').toLowerCase();

  if (type === 'database.query') return 'Finds matching records';
  if (type === 'database.insert') return 'Creates a new record';
  if (type === 'database.update') return 'Updates existing records';
  if (type === 'database.delete') return 'Removes matching records';
  if (type === 'text.preparepromptcontext') return 'Compacts records into a clean summary';
  if (type === 'text.generate') return 'Renders final text from named fields';
  if (type === 'text.prepareoverduereminders') return 'Builds reminder drafts from rules';
  if (type === 'ai.generatejson') return 'Creates structured fields for later steps';
  if (type === 'ai.generatetext') return 'Writes a text response';
  if (type === 'ai.analyze') return 'Analyzes the input and returns findings';
  if (type === 'artifact.create') return 'Saves an artifact for later review';
  if (type === 'artifact.store') return 'Stores a file artifact';
  if (type === 'notification.createtask') return 'Creates a follow-up task';
  if (type === 'notification.logactivity') return 'Writes an activity entry';
  if (type === 'notification.sendemail') return 'Sends an email message';
  if (type === 'notification.send') return 'Sends an in-app notification';
  if (type === 'iterate.foreach') return 'Repeats a step for each item';
  if (type === 'schedule.findfreeslot') return 'Finds the next available time slot';

  return 'Runs a workflow step';
}

function toTitleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function collectTemplateTokens(value, tokens = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(TEMPLATE_TOKEN_PATTERN)) {
      tokens.add(match[1]);
    }
    return tokens;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTemplateTokens(item, tokens));
    return tokens;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectTemplateTokens(entry, tokens));
  }

  return tokens;
}

function collectConditionPaths(value, paths = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectConditionPaths(entry, paths));
    return paths;
  }

  if (!value || typeof value !== 'object') {
    return paths;
  }

  Object.entries(value).forEach(([key, entry]) => {
    if (key === 'path' && typeof entry === 'string') {
      paths.push(entry);
      return;
    }
    collectConditionPaths(entry, paths);
  });

  return paths;
}

function createActionIndex(actionSteps) {
  return actionSteps.reduce((map, step) => {
    map[step.label] = step;
    return map;
  }, {});
}

function describeToken(token, actionIndex) {
  const parts = String(token || '').split('.');
  const root = parts[0];

  if (root === 'actions' || root === 'action') {
    const actionId = parts[1];
    const sourceStep = actionIndex[actionId];
    const remainder = parts.slice(2).join('.');
    const fieldLabel = remainder ? toTitleCase(remainder.split('.').slice(-1)[0]) : 'Result';
    return {
      kind: 'step',
      label: sourceStep ? `${fieldLabel} from Step ${sourceStep.index + 1}` : `${fieldLabel} from ${actionId}`,
      detail: sourceStep
        ? `Uses output from "${sourceStep.label}" (${sourceStep.summary}).`
        : `Uses output from the earlier step "${actionId}".`,
      code: `{{${token}}}`,
      sourceActionId: actionId
    };
  }

  if (root === 'trigger') {
    return {
      kind: 'trigger',
      label: `${toTitleCase(parts.slice(1).join(' ') || 'Trigger Data')}`,
      detail: 'Comes from the event that starts this automation.',
      code: `{{${token}}}`
    };
  }

  if (root === 'matter') {
    return {
      kind: 'matter',
      label: `${toTitleCase(parts.slice(1).join(' ') || 'Matter Data')}`,
      detail: 'Comes from the current matter context.',
      code: `{{${token}}}`
    };
  }

  if (root === 'user') {
    return {
      kind: 'user',
      label: `${toTitleCase(parts.slice(1).join(' ') || 'User Data')}`,
      detail: 'Comes from the current user context.',
      code: `{{${token}}}`
    };
  }

  if (root === 'execution') {
    return {
      kind: 'execution',
      label: `${toTitleCase(parts.slice(1).join(' ') || 'Execution Data')}`,
      detail: 'Comes from the live execution metadata.',
      code: `{{${token}}}`
    };
  }

  return {
    kind: 'local',
    label: toTitleCase(token),
    detail: 'Filled by this step locally before rendering.',
    code: `{{${token}}}`
  };
}

function buildOutputEntries(action, actionSteps) {
  const actionRef = `actions.${action.label}`;
  const type = String(action.type || '').toLowerCase();
  const outputs = [];

  if (type === 'database.query') {
    outputs.push(
      {
        label: 'Matching records',
        detail: 'A list of records that matched the query filters.',
        code: `{{${actionRef}.rows}}`
      },
      {
        label: 'Record count',
        detail: 'How many records were returned.',
        code: `{{${actionRef}.rowCount}}`
      }
    );
  } else if (type === 'database.insert' || type === 'database.update' || type === 'database.delete') {
    outputs.push({
      label: 'Rows affected',
      detail: 'How many records this step changed.',
      code: `{{${actionRef}.rowCount}}`
    });
  } else if (type === 'text.preparepromptcontext') {
    outputs.push(
      {
        label: 'Compact summary text',
        detail: 'A short, cleaned summary ready for AI or templates.',
        code: `{{${actionRef}.text}}`
      },
      {
        label: 'Included item count',
        detail: 'How many records were kept after cleanup or exclusions.',
        code: `{{${actionRef}.included_count}}`
      }
    );
  } else if (type === 'text.generate') {
    outputs.push({
      label: 'Rendered text',
      detail: 'The final text or HTML produced from the template.',
      code: `{{${actionRef}.text}}`
    });
  } else if (type === 'text.prepareoverduereminders') {
    outputs.push(
      {
        label: 'Prepared reminders',
        detail: 'The reminder records ready for follow-up or notification steps.',
        code: `{{${actionRef}.reminders}}`
      },
      {
        label: 'Overdue count',
        detail: 'How many overdue invoices were found.',
        code: `{{${actionRef}.overdue_count}}`
      }
    );
  } else if (type === 'ai.generatejson') {
    const fields = Array.isArray(action.config?.schema?.required)
      ? action.config.schema.required
      : [];
    if (fields.length) {
      fields.forEach((field) => {
        outputs.push({
          label: toTitleCase(field),
          detail: 'A structured field returned by the AI step.',
          code: `{{${actionRef}.data.${field}}}`
        });
      });
    }
    outputs.push({
      label: 'Raw JSON',
      detail: 'The full structured response from the AI step.',
      code: `{{${actionRef}.json}}`
    });
  } else if (type === 'ai.generatetext' || type === 'ai.analyze' || type === 'ai.chat') {
    outputs.push({
      label: 'Generated text',
      detail: 'The text returned by the AI step.',
      code: `{{${actionRef}.text}}`
    });
  } else if (type === 'artifact.create' || type === 'artifact.store') {
    outputs.push({
      label: 'Artifact ID',
      detail: 'The saved artifact record for later review or download.',
      code: `{{${actionRef}.artifact_id}}`
    });
  } else if (type === 'notification.createtask') {
    outputs.push({
      label: 'Task ID',
      detail: 'The created follow-up task.',
      code: `{{${actionRef}.task_id}}`
    });
  } else if (type === 'notification.logactivity') {
    outputs.push({
      label: 'Activity ID',
      detail: 'The activity feed entry created by this step.',
      code: `{{${actionRef}.activity_id}}`
    });
  } else if (type === 'notification.sendemail') {
    outputs.push({
      label: 'Message ID',
      detail: 'The email send result, if the connector returns one.',
      code: `{{${actionRef}.message_id}}`
    });
  } else if (type === 'notification.send') {
    outputs.push({
      label: 'Notification count',
      detail: 'How many recipients were notified.',
      code: `{{${actionRef}.count}}`
    });
  } else if (type === 'iterate.foreach') {
    outputs.push({
      label: 'Iteration results',
      detail: 'The collection of results returned from each repeated run.',
      code: `{{${actionRef}.results}}`
    });
  } else {
    outputs.push({
      label: 'Step result',
      detail: 'This step returns a result object that later steps can reference if needed.',
      code: `{{${actionRef}}}`
    });
  }

  return outputs;
}

function buildInputEntries(action, actionSteps) {
  const actionIndex = createActionIndex(actionSteps);
  const seen = new Set();
  const inputs = [];
  const localVariableKeys = action.type === 'text.generate' && action.config?.variables && typeof action.config.variables === 'object'
    ? Object.keys(action.config.variables)
    : [];

  const addInput = (entry) => {
    const key = `${entry.kind}:${entry.code || entry.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    inputs.push(entry);
  };

  if (Array.isArray(action.dependsOn)) {
    action.dependsOn.forEach((dependency) => {
      const sourceStep = actionIndex[dependency];
      addInput({
        kind: 'dependency',
        label: sourceStep ? `"${sourceStep.label}" must finish first` : `"${dependency}" must finish first`,
        detail: sourceStep
          ? `This step waits for Step ${sourceStep.index + 1} because it likely needs that output or side effect.`
          : 'This step explicitly depends on an earlier step.',
        code: sourceStep ? `Step ${sourceStep.index + 1}` : dependency
      });
    });
  }

  const tokens = Array.from(collectTemplateTokens(action.config || {}))
    .filter((token) => !(localVariableKeys.includes(token)));
  tokens.forEach((token) => addInput(describeToken(token, actionIndex)));
  collectConditionPaths(action.when || {}).forEach((path) => addInput(describeToken(path, actionIndex)));

  if (action.type === 'text.generate' && action.config?.variables && typeof action.config.variables === 'object') {
    Object.entries(action.config.variables).forEach(([key, value]) => {
      const sourceTokens = Array.from(collectTemplateTokens(value));
      const sourceDescriptions = sourceTokens.map((token) => describeToken(token, actionIndex).label);
      addInput({
        kind: 'local',
        label: `${toTitleCase(key)} field`,
        detail: sourceDescriptions.length
          ? `Filled from ${sourceDescriptions.join(', ')} before the template is rendered.`
          : 'Filled directly inside this step before the template is rendered.',
        code: `{{${key}}}`
      });
    });
  }

  return inputs;
}

function buildDownstreamEntries(action, actionSteps, selectedIndex) {
  const results = [];
  const actionPrefixes = [`actions.${action.label}.`, `action.${action.label}.`];

  for (const laterStep of actionSteps.slice(selectedIndex + 1)) {
    const tokens = Array.from(collectTemplateTokens(laterStep.config || {}));
    const conditionPaths = collectConditionPaths(laterStep.when || {});
    const referencesOutput = tokens.some((token) => actionPrefixes.some((prefix) => token.startsWith(prefix)))
      || conditionPaths.some((path) => actionPrefixes.some((prefix) => path.startsWith(prefix)));
    const dependsOnStep = Array.isArray(laterStep.dependsOn) && laterStep.dependsOn.includes(action.label);

    if (!referencesOutput && !dependsOnStep) continue;

    results.push({
      stepIndex: laterStep.index,
      label: laterStep.label,
      detail: referencesOutput
        ? `Step ${laterStep.index + 1} reads output from this step.`
        : `Step ${laterStep.index + 1} waits for this step to finish first.`
    });
  }

  return results;
}

function buildActionInsights(action, actionSteps, selectedIndex) {
  const outputs = buildOutputEntries(action, actionSteps);
  const inputs = buildInputEntries(action, actionSteps);
  const downstream = buildDownstreamEntries(action, actionSteps, selectedIndex);
  const canSwapSafely = outputs.length > 0;
  const swapGuidance = downstream.length
    ? `If you replace or rename this step, keep these outputs available or update ${downstream.length} later step${downstream.length === 1 ? '' : 's'} that depend on it.`
    : 'This step is not referenced by a later step right now, so it is safer to replace as long as the side effect still matches your goal.';

  return {
    purpose: summarizeActionStep({ action_type: action.type }),
    inputs,
    outputs,
    downstream,
    swapGuidance,
    renameWarning: downstream.length
      ? `Changing this Action ID will break later steps until their references are updated.`
      : null,
    localTemplateHelp: action.type === 'text.generate'
      ? 'Inside this template, use the local field names shown under “This step uses”. You do not need trigger or action prefixes in the template body itself.'
      : null,
    canSwapSafely
  };
}

function getConnectorOptions(connectors) {
  return connectors
    .map((connector) => ({
      id: connector.id || connector.connector_id || '',
      label: connectorDisplayName(connector)
    }))
    .filter((option) => option.id)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getStepComponentInfo(actionType) {
  const normalized = String(actionType || '').toLowerCase();
  const byType = {
    'action.run': { label: 'Action', token: 'action.*', copy: 'Runs a standard non-AI workflow action.', examples: ['set_status', 'assign_owner'], toneClass: 'tone-action' },
    'ai.generatetext': { label: 'AI Action', token: 'ai.*', copy: 'Uses AI for generation and extraction.', examples: ['summarize', 'extract'], toneClass: 'tone-ai' },
    'notification.logactivity': { label: 'Notification', token: 'notify.*', copy: 'Sends tasks, alerts, and audit logs.', examples: ['task', 'notify', 'log'], toneClass: 'tone-notify' },
    'data.transform': { label: 'Transform', token: 'data.*', copy: 'Maps and reshapes data between steps.', examples: ['map', 'filter'], toneClass: 'tone-transform' },
    'integration.webhook': { label: 'Integration', token: 'ext.*', copy: 'Connects to external connector systems.', examples: ['crm', 'webhook'], toneClass: 'tone-integration' }
  };
  return byType[normalized] || {
    label: 'Custom Step',
    token: 'custom.*',
    copy: 'Custom workflow step configured in JSON.',
    examples: ['custom'],
    toneClass: 'tone-database'
  };
}

function triggerModeFromEvent(eventType) {
  return isScheduledTriggerEvent(eventType) ? 'scheduled' : 'event';
}

function isScheduledTriggerEvent(eventType) {
  return String(eventType || '').startsWith('schedule.');
}

function getStepPaletteItems() {
  return [
    { label: 'Action', actionType: 'action.run', token: 'action.*', copy: 'Runs a standard non-AI workflow action.', examples: ['set_status', 'assign_owner'], toneClass: 'tone-action' },
    { label: 'AI Action', actionType: 'ai.generateText', token: 'ai.*', copy: 'Uses AI for generation and extraction.', examples: ['summarize', 'extract'], toneClass: 'tone-ai' },
    { label: 'Notification', actionType: 'notification.logActivity', token: 'notify.*', copy: 'Sends tasks, alerts, and audit logs.', examples: ['task', 'notify', 'log'], toneClass: 'tone-notify' },
    { label: 'Database', actionType: 'data.transform', token: 'db.*', copy: 'Insert, query, and update records.', examples: ['insert', 'query'], toneClass: 'tone-database' },
    { label: 'Integration', actionType: 'integration.webhook', token: 'ext.*', copy: 'Connects to external connector systems.', examples: ['crm', 'webhook'], toneClass: 'tone-integration' },
    { label: 'Transform', actionType: 'data.transform', token: 'data.*', copy: 'Maps and reshapes data between steps.', examples: ['map', 'filter'], toneClass: 'tone-transform' }
  ];
}

function renderBuilderStepBody(context, currentStep, selectedTemplate, recommendedConnectors, preflight) {
  if (currentStep === 1) {
    return `
      <div class="stack-md">
        <div class="surface-note">
          Start by defining the intent and business outcome. Quick starts can prefill defaults when launched from a template.
        </div>
        ${metaGrid([
          { label: 'Automation intent', value: context.state.builder.name || 'Not set' },
          { label: 'Outcome', value: context.state.builder.description || 'Not set' },
          { label: 'Trigger', value: context.state.builder.triggerEvent || 'Not set' },
          { label: 'Scope', value: context.state.builder.scopeType === 'matter' ? `Matter: ${selectedMatterName(context)}` : 'Organization-wide' }
        ])}
        <div class="surface-note">
          Quick start in use: <strong>${escapeHtml(selectedTemplate.name)}</strong>
        </div>
      </div>
    `;
  }

  if (currentStep === 2) {
    return `
      <div class="stack-md">
        <div class="surface-note">
          Configure trigger timing and confirm connector readiness before building actions.
        </div>
        <div class="form-grid">
          <label>
            <span>Category</span>
            <input class="automation-builder-input" id="builder-category" data-builder-field="category" value="${escapeAttribute(context.state.builder.category)}">
          </label>
          <label>
            <span>Trigger</span>
            <div class="stack-sm">
              <div class="flex items-center gap-2">
                <select class="automation-builder-input flex-1" id="builder-trigger" data-builder-field="triggerEvent">
                  ${TRIGGER_OPTIONS.map((eventType) => `
                    <option value="${eventType}" ${context.state.builder.triggerEvent === eventType ? 'selected' : ''}>${eventType}</option>
                  `).join('')}
                </select>
                <lex-btn
                  variant="secondary"
                  size="sm"
                  data-open-event-browser
                  data-event-browser-current="${escapeAttribute(context.state.builder.triggerEvent || '')}"
                >
                  Browse Events
                </lex-btn>
              </div>
              <div class="builder-event-summary">
                ${renderTriggerEventSummary(context.state.builder.triggerEvent || TRIGGER_OPTIONS[0] || '')}
              </div>
            </div>
          </label>
          <label>
            <span>Schedule Time</span>
            <input class="automation-builder-input" id="builder-time" data-builder-field="scheduleTime" type="time" value="${escapeAttribute(context.state.builder.scheduleTime)}">
          </label>
          <label>
            <span>Day of Week</span>
            <select class="automation-builder-input" id="builder-day" data-builder-field="dayOfWeek">
              ${DAY_OPTIONS.map(([value, label]) => `
                <option value="${value}" ${context.state.builder.dayOfWeek === value ? 'selected' : ''}>${label}</option>
              `).join('')}
            </select>
          </label>
        </div>
        <div class="badge-row">
          ${selectedTemplate.connectorHints.map((hint) => badge(hint)).join('')}
        </div>
        ${selectedTemplate.connectorHints.length ? `
          <div class="checklist">
            ${selectedTemplate.connectorHints.map((hint) => {
              const matched = recommendedConnectors.some((connector) =>
                normalizeText(connectorDisplayName(connector)).includes(normalizeText(hint)) ||
                normalizeText(connector.metadata?.description).includes(normalizeText(hint))
              );
              return `
                <article class="check-item">
                  <span class="check-state ${matched ? 'done' : ''}">${matched ? 'Matched' : 'Review'}</span>
                  <strong>${escapeHtml(hint)}</strong>
                  <p>${matched ? 'A visible connector matches this data dependency.' : 'No obvious connector match yet. Review the catalog if this workflow depends on it.'}</p>
                </article>
              `;
            }).join('')}
          </div>
        ` : ''}
        ${recommendedConnectors.length
          ? `<div class="stack-md">${recommendedConnectors.map((connector) => connectorCompact(context, connector)).join('')}</div>`
          : emptyState('No connector matched the template hints directly. Review the connector catalog before publishing.')}
      </div>
    `;
  }

  if (currentStep === 3) {
    return `
      <div class="stack-md">
        <div class="surface-note">
          Build action logic and optionally fine-tune compiled config.
        </div>
        <div class="form-grid">
          <label class="full">
            <span>Message / Prompt</span>
            <textarea class="automation-builder-input" id="builder-message" data-builder-field="message">${escapeHtml(context.state.builder.message)}</textarea>
          </label>
        </div>
        <details class="advanced-panel">
          <summary>Advanced automation config JSON</summary>
          <div class="stack-md">
            <label class="full">
              <span>Automation Config JSON</span>
              <textarea class="automation-builder-input" id="builder-json" data-builder-field="customJson">${escapeHtml(context.state.builder.customJson)}</textarea>
            </label>
            <div class="row-actions">
              <lex-btn id="reset-builder-btn" variant="secondary" size="sm">Reset To Template</lex-btn>
              <lex-btn variant="ghost" size="sm" data-app-action="validate-builder">Validate Config</lex-btn>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  if (currentStep === 4) {
    return `
      <div class="stack-md">
        <div class="surface-note">
          Decide where this automation should run first. Matter scope is the safer default for initial rollout.
        </div>
        <div class="form-grid">
          <label>
            <span>Scope</span>
            <select class="automation-builder-input" data-builder-field="scopeType">
              <option value="matter" ${context.state.builder.scopeType === 'matter' ? 'selected' : ''}>Specific matter</option>
              <option value="organization" ${context.state.builder.scopeType === 'organization' ? 'selected' : ''}>Organization-wide</option>
            </select>
          </label>
          <label>
            <span>Publish state</span>
            <select class="automation-builder-input" data-builder-field="publishMode">
              <option value="enabled" ${context.state.builder.publishMode === 'enabled' ? 'selected' : ''}>Publish live</option>
              <option value="disabled" ${context.state.builder.publishMode === 'disabled' ? 'selected' : ''}>Create disabled</option>
            </select>
          </label>
          ${context.state.builder.scopeType === 'matter' ? `
            <label class="full">
              <span>Matter</span>
              <select class="automation-builder-input" data-builder-field="matterId">
                ${context.state.matters.map((matter) => `
                  <option value="${escapeAttribute(matterRef(matter))}" ${context.state.builder.matterId === matterRef(matter) ? 'selected' : ''}>
                    ${escapeHtml(matter.name || matterRef(matter))}
                  </option>
                `).join('')}
              </select>
            </label>
          ` : `
            <div class="check-item full-width">
              <strong>Organization-wide rollout</strong>
              <p>This automation will be created as a shared automation definition instead of being attached to a single matter first.</p>
            </div>
          `}
        </div>
        ${metaGrid([
          { label: 'Quick Start', value: selectedTemplate.name },
          { label: 'Trigger', value: context.state.builder.triggerEvent },
          { label: 'Scope', value: context.state.builder.scopeType === 'matter' ? `Matter: ${selectedMatterName(context)}` : 'Organization-wide' },
          { label: 'Publish', value: context.state.builder.publishMode === 'enabled' ? 'Live' : 'Disabled' }
        ])}
      </div>
    `;
  }

  return `
    <div class="stack-md">
      <div class="surface-note">
        This is the final review before the automation is written into LANA.
      </div>
      ${metaGrid([
        { label: 'Quick Start', value: selectedTemplate.name },
        { label: 'Trigger', value: context.state.builder.triggerEvent },
        { label: 'Scope', value: context.state.builder.scopeType === 'matter' ? `Matter: ${selectedMatterName(context)}` : 'Organization-wide' },
        { label: 'Publish', value: context.state.builder.publishMode === 'enabled' ? 'Live' : 'Disabled' }
      ])}
      <div class="checklist">
        ${preflight.map((item) => `
          <article class="check-item">
            <span class="check-state ${item.done ? 'done' : ''}">${item.done ? 'Ready' : 'Fix'}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.description)}</p>
          </article>
        `).join('')}
      </div>
      <details class="advanced-panel">
        <summary>Review compiled config</summary>
        <pre class="code-preview">${escapeHtml(context.state.builder.customJson)}</pre>
      </details>
    </div>
  `;
}

function renderBuilderStepFooter(currentStep, preflight) {
  const isFirstStep = currentStep === 1;
  const isFinalStep = currentStep === 5;

  return `
    <div class="row-actions row-actions-spread">
      <div class="row-actions">
        ${isFirstStep ? '<lex-btn variant="secondary" size="sm" data-open-view="library">Cancel</lex-btn>' : `<lex-btn variant="secondary" size="sm" data-builder-step="${currentStep - 1}">Previous</lex-btn>`}
        ${currentStep === 2 ? '<lex-btn variant="ghost" size="sm" data-open-view="connectors">Open Connectors</lex-btn>' : ''}
      </div>
      <div class="row-actions">
        ${isFinalStep
          ? `<lex-btn id="create-automation-btn" variant="primary" size="sm" ${preflight.every((item) => item.done) ? '' : 'disabled'}>Save Automation</lex-btn>`
          : `<lex-btn variant="primary" size="sm" data-builder-step="${currentStep + 1}">Continue</lex-btn>`}
      </div>
    </div>
  `;
}

function builderStepSubtitle(currentStep) {
  return {
    1: 'Set clear intent first; templates are optional quick starts.',
    2: 'Define trigger cadence and verify connector readiness.',
    3: 'Set action behavior and keep advanced config optional.',
    4: 'Choose where this should run and how it should launch.',
    5: 'Run the final preflight before publishing.'
  }[currentStep] || '';
}

function selectedMatterName(context) {
  if (!context.state.builder.matterId) return 'Not selected';
  const matter = context.state.matters.find((entry) => matterRef(entry) === context.state.builder.matterId);
  return matter ? (matter.name || matterRef(matter)) : context.state.builder.matterId;
}

/**
 * Load an existing automation into the builder for editing.
 * Fetches the automation from the API, populates builder state, and sets editMode.
 * Renders a loading shimmer while the fetch is in flight.
 *
 * @param {object} context - App context object
 * @param {string} automationId  - UUID of the automation to load
 */
export async function loadAutomationForEdit(context, automationId) {
  if (!automationId) return;

  // Show loading state immediately
  context.state.builder.editMode = { isEdit: false, automationId, originalAutomation: null, loading: true };
  context.renderCurrentView();

  try {
    // Use /api/v1/ path — the automation server's /api/* catch-all forwards
    // verbatim to the LANA backend, which exposes automation detail at /api/v1/automations/:id.
    const payload = await context.fetchJson(`/api/v1/automations/${encodeURIComponent(automationId)}`, {
      headers: context.authHeaders()
    });

    const automation = payload.automation || payload;
    if (!automation || !automation.automation_id) {
      throw new Error('Automation not found');
    }

    const automationConfig = automation.automation_config || automation.config || {};
    const trigger = automationConfig.trigger || {};
    const overdueReminderConfig = isOverdueInvoiceReminderConfig(automationConfig) ? automationConfig.rules || automationConfig : null;

    const base = createBuilderState(null, context.state.matters);
    const overdueReminder = overdueReminderConfig
      ? createDefaultOverdueReminderState({
        buckets: overdueReminderConfig.buckets || overdueReminderConfig.overdue_buckets || [],
        stages: overdueReminderConfig.follow_up_stages || overdueReminderConfig.stages || [],
        templates: overdueReminderConfig.message_templates || overdueReminderConfig.templates || {},
        selectedBucketKey: automationConfig.ui?.selected_bucket || overdueReminderConfig.selected_bucket || 'slightly_overdue',
        selectedStageKey: automationConfig.ui?.selected_stage || overdueReminderConfig.selected_stage || 'follow_up_1'
      })
      : base.overdueReminder;

    // Derive schedule fields from the trigger config
    const scheduleTime = trigger.schedule?.time || base.scheduleTime;
    const dayOfWeek = trigger.schedule?.day_of_week !== undefined
      ? String(trigger.schedule.day_of_week)
      : base.dayOfWeek;

    // Determine scope from automation_config.scope first, then legacy fields.
    const resolvedScope = resolveAutomationScope(automation, automationConfig);
    const scopeType = resolvedScope.scopeType;
    const matterId = resolvedScope.matterId
      || (scopeType === 'matter' && context.state.matters.length ? matterRef(context.state.matters[0]) : '');
    const scopedAutomationConfig = applyScopeToConfig(automationConfig, { scopeType, matterId });

    const triggerEvent = trigger.event_type || base.triggerEvent;

    // Extract a human-readable message from the first AI action prompt or note
    let message = base.message;
    if (Array.isArray(automationConfig.actions)) {
      const firstAi = automationConfig.actions.find(
        (a) => a.action_type === 'ai.generateText' && a.config?.prompt
      );
      const firstNote = automationConfig.actions.find(
        (a) => a.config?.note
      );
      if (firstAi) message = firstAi.config.prompt;
      else if (firstNote) message = firstNote.config.note;
    }

    context.state.builder = {
      ...base,
      templateId: overdueReminderConfig ? OVERDUE_INVOICE_REMINDER_TEMPLATE_ID : base.templateId,
      name: automation.automation_name || automation.name || '',
      description: automation.automation_description || automation.description || '',
      category: automation.category || base.category,
      triggerEvent,
      triggerMode: triggerModeFromEvent(triggerEvent),
      triggerConnectorId: trigger.connector_id || '',
      scheduleTime,
      dayOfWeek,
      message,
      scopeType,
      matterId,
      publishMode: automation.is_enabled ? 'enabled' : 'disabled',
      customJson: JSON.stringify(scopedAutomationConfig, null, 2),
      overdueReminder,
      publishModalOpen: false,
      selectedActionIndex: null,
      editMode: {
        isEdit: true,
        automationId: automation.automation_id,
        originalAutomation: automation,
        loading: false
      }
    };
  } catch (error) {
    // On failure fall back to clean create state, clear loading
    context.state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
    context.flash(error.message || 'Failed to load automation for editing.', true);
  }

  context.renderCurrentView();
}

export async function createAutomation(context) {
  const isEdit = Boolean(context.state.builder.editMode?.isEdit);
  const editAutomationId = context.state.builder.editMode?.automationId || null;

  try {
    const config = applyScopeToConfig(JSON.parse(document.getElementById('builder-json').value), context.state.builder);
    context.state.builder.customJson = JSON.stringify(config, null, 2);
    const payload = {
      automation_name: context.state.builder.name.trim(),
      automation_type: 'automation',
      category: context.state.builder.category.trim() || 'Automation',
      description: context.state.builder.description.trim(),
      config,
      is_enabled: context.state.builder.publishMode === 'enabled'
    };

    if (isEdit && editAutomationId) {
      // PUT to update existing automation
      await context.fetchJson(`/api/automations/${editAutomationId}`, {
        method: 'PUT',
        headers: context.authHeaders(),
        body: JSON.stringify(payload)
      });

      // Re-apply enabled state after update in case backend doesn't honour is_enabled on PUT
      if (context.state.builder.publishMode === 'enabled') {
        await context.fetchJson(`/api/automations/${editAutomationId}/activate`, {
          method: 'POST',
          headers: context.authHeaders()
        }).catch(() => {});
      }

      await context.loadAutomations();
      // Reset editMode before navigating so the builder starts clean next time
      context.state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
      context.setView('library');
      context.renderCurrentView();
      context.flash('Automation updated.');
      return;
    }

    // CREATE flow (POST)
    const created = await context.fetchJson('/api/automations', {
      method: 'POST',
      headers: context.authHeaders(),
      body: JSON.stringify(payload)
    });

    let automationId = created.automation?.automation_id || created.automation_id || null;

    if (!automationId) {
      await context.loadAutomations();
      const fallback = context.state.automations.find((automation) => automation.automation_name === payload.automation_name);
      automationId = fallback ? fallback.automation_id : null;
    }

    if (automationId && context.state.builder.publishMode === 'enabled') {
      await context.fetchJson(`/api/automations/${automationId}/activate`, {
        method: 'POST',
        headers: context.authHeaders()
      });
    }

    if (automationId && context.state.builder.scopeType === 'matter' && context.state.builder.matterId) {
      await context.fetchJson(`/api/matters/${encodeURIComponent(context.state.builder.matterId)}/automations`, {
        method: 'POST',
        headers: context.authHeaders(),
        body: JSON.stringify({ automation_id: automationId, config_overrides: {} })
      });
    }

    await context.loadAutomations();
    await context.saveOnboardingState();
    context.setView('library');
    context.renderCurrentView();
    context.flash('Automation saved.');
  } catch (error) {
    context.flash(error.message || (isEdit ? 'Failed to update automation.' : 'Failed to create automation.'), true);
  }
}

function parseBuilderConfig(json) {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function hydrateRuntimeConfig(baseConfig, form) {
  const config = JSON.parse(JSON.stringify(baseConfig || {}));
  config.trigger = config.trigger || {};
  config.trigger.event_type = form.triggerEvent;
  if (form.triggerConnectorId) {
    config.trigger.connector_id = form.triggerConnectorId;
  } else {
    delete config.trigger.connector_id;
  }

  if (form.triggerEvent === 'schedule.weekly') {
    config.trigger.schedule = {
      day_of_week: parseInt(form.dayOfWeek, 10),
      time: form.scheduleTime
    };
  } else if (form.triggerEvent === 'schedule.daily') {
    config.trigger.schedule = {
      every_n_days: 1,
      time: form.scheduleTime
    };
  } else {
    delete config.trigger.schedule;
  }

  if (Array.isArray(config.actions)) {
    config.actions = config.actions.map((action) => {
      const nextAction = { ...action, config: { ...(action.config || {}) } };
      if (nextAction.action_type === 'ai.generateText' && nextAction.config.prompt !== undefined) {
        nextAction.config.prompt = form.message;
      }
      if (nextAction.config.note !== undefined) {
        nextAction.config.note = form.message;
      }
      if (nextAction.config.details && typeof nextAction.config.details === 'object' && nextAction.config.details.note !== undefined) {
        nextAction.config.details = {
          ...nextAction.config.details,
          note: form.message
        };
      }
      return nextAction;
    });
  } else {
    config.actions = [];
  }

  config.settings = config.settings || {
    timeout: 90,
    retryLimit: 1,
    priority: 40
  };

  return config;
}

function createActionTemplate(actionType, stepIndex, message) {
  if (actionType === 'action.run') {
    return {
      action_id: `step_${stepIndex}_action`,
      action_type: 'action.run',
      config: {
        operation: 'set_status',
        params: {
          status: 'in_progress',
          note: message || 'Run standard action.'
        }
      }
    };
  }

  if (actionType === 'notification.logActivity') {
    return {
      action_id: `step_${stepIndex}_notify`,
      action_type: 'notification.logActivity',
      config: {
        event_type: 'automation.custom_event',
        resource_type: 'matter',
        resource_id: '{{matter.id}}',
        resource_name: 'Matter {{matter.id}}',
        details: {
          note: message || 'Notify stakeholders.'
        }
      }
    };
  }

  if (actionType === 'data.transform') {
    return {
      action_id: `step_${stepIndex}_transform`,
      action_type: 'data.transform',
      config: {
        mapping: {
          summary: '{{trigger.data}}'
        }
      }
    };
  }

  if (actionType === 'integration.webhook') {
    return {
      action_id: `step_${stepIndex}_webhook`,
      action_type: 'integration.webhook',
      config: {
        url: 'https://example.com/webhook',
        method: 'POST',
        body: {
          note: message || 'Webhook payload.'
        }
      }
    };
  }

  return {
    action_id: `step_${stepIndex}_ai`,
    action_type: 'ai.generateText',
    config: {
      prompt: message || 'Summarize the trigger data for this workflow.'
    }
  };
}

function compileTemplate(template, form) {
  const trigger = { event_type: form.triggerEvent };
  if (form.triggerConnectorId) {
    trigger.connector_id = form.triggerConnectorId;
  }

  if (form.triggerEvent === 'schedule.weekly') {
    trigger.schedule = {
      day_of_week: parseInt(form.dayOfWeek, 10),
      time: form.scheduleTime
    };
  }

  if (form.triggerEvent === 'schedule.daily') {
    trigger.schedule = {
      every_n_days: 1,
      time: form.scheduleTime
    };
  }

  if (template.id === 'weekly-status-draft') {
    return {
      trigger,
      actions: [
        {
          action_id: 'generate_draft',
          action_type: 'ai.generateText',
          config: {
            prompt: form.message
          }
        },
        {
          action_id: 'log_weekly_draft',
          action_type: 'notification.logActivity',
          config: {
            event_type: 'automation.weekly_status_draft',
            resource_type: 'matter',
            resource_id: '{{matter.id}}',
            resource_name: 'Matter {{matter.id}}',
            details: {
              summary: '{{action.generate_draft.text}}'
            }
          }
        }
      ],
      settings: {
        timeout: 120,
        retryLimit: 1,
        priority: 50
      }
    };
  }

  if (template.id === 'connector-sync-watch') {
    return {
      trigger,
      actions: [
        {
          action_id: 'log_connector_sync',
          action_type: 'notification.logActivity',
          config: {
            event_type: 'automation.connector_sync_watch',
            resource_type: 'matter',
            resource_id: '{{matter.id}}',
            resource_name: 'Matter {{matter.id}}',
            details: {
              note: form.message,
              connector_id: '{{trigger.connector_id}}',
              status: '{{trigger.status}}'
            }
          }
        }
      ],
      settings: {
        timeout: 90,
        retryLimit: 1,
        priority: 40
      }
    };
  }

  return {
    trigger,
    actions: [
      {
        action_id: 'log_document_intake',
        action_type: 'notification.logActivity',
        config: {
          event_type: 'automation.document_intake_audit',
          resource_type: 'matter',
          resource_id: '{{matter.id}}',
          resource_name: 'Matter {{matter.id}}',
          details: {
            note: form.message,
            document_id: '{{trigger.document.id}}',
            filename: '{{trigger.document.filename}}'
          }
        }
      }
    ],
    settings: {
      timeout: 90,
      retryLimit: 1,
      priority: 40
    }
  };
}

function hydrateTemplateConfig(baseConfig, form) {
  const config = JSON.parse(JSON.stringify(baseConfig || {}));
  config.trigger = config.trigger || {};
  config.trigger.event_type = form.triggerEvent;
  if (form.triggerConnectorId) {
    config.trigger.connector_id = form.triggerConnectorId;
  } else {
    delete config.trigger.connector_id;
  }

  if (form.triggerEvent === 'schedule.weekly') {
    config.trigger.schedule = {
      day_of_week: parseInt(form.dayOfWeek, 10),
      time: form.scheduleTime
    };
  } else if (form.triggerEvent === 'schedule.daily') {
    config.trigger.schedule = {
      every_n_days: 1,
      time: form.scheduleTime
    };
  } else {
    delete config.trigger.schedule;
  }

  if (Array.isArray(config.actions)) {
    config.actions = config.actions.map((action) => {
      const nextAction = { ...action, config: { ...(action.config || {}) } };

      if (nextAction.config.prompt !== undefined) {
        nextAction.config.prompt = form.message;
      }

      if (nextAction.config.note !== undefined) {
        nextAction.config.note = form.message;
      }

      if (nextAction.config.details && typeof nextAction.config.details === 'object') {
        nextAction.config.details = { ...nextAction.config.details };
        if (nextAction.config.details.note !== undefined) {
          nextAction.config.details.note = form.message;
        }
      }

      return nextAction;
    });
  }

  return config;
}

function matterRef(matter) {
  return matter.matter_id || matter.id;
}

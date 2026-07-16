'use strict';

const { z } = require('zod');

const MAX_INSTRUCTION_CHARS = 4000;
const MAX_CONTEXT_CHARS = 12000;
const MAX_ACTION_TEXT_CHARS = 24000;
const LEGACY_AGENT_SHORTCUT = 'CommandOrControl+Shift+Period';
const LEGACY_CAPTURE_SHORTCUT = 'Z+X';

const boundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative()
}).strict();

const targetFingerprintSchema = z.object({
  platform: z.string().min(1).max(24),
  processId: z.number().int().positive().nullable(),
  bundleId: z.string().max(300).nullable(),
  processName: z.string().max(300),
  windowTitle: z.string().max(1000),
  role: z.string().max(120),
  name: z.string().max(500),
  bounds: boundsSchema.nullable(),
  selectionHash: z.string().max(128).nullable()
}).strict();

const focusedElementSchema = z.object({
  role: z.string().max(120),
  name: z.string().max(500),
  value: z.string().max(MAX_CONTEXT_CHARS),
  isEditable: z.boolean(),
  isPassword: z.boolean(),
  bounds: boundsSchema.nullable()
}).strict();

const screenContextSchema = z.object({
  platform: z.string().min(1).max(24),
  activeApplication: z.string().max(300),
  processName: z.string().max(300),
  windowTitle: z.string().max(1000),
  browserUrlOrDomainWhenSafelyAvailable: z.string().max(1000).nullable().default(null),
  focusedElement: focusedElementSchema,
  selectedText: z.string().max(MAX_CONTEXT_CHARS),
  surroundingText: z.string().max(MAX_CONTEXT_CHARS),
  accessibleDocumentText: z.string().max(MAX_CONTEXT_CHARS),
  spreadsheetContext: z.object({
    row: z.number().int().nullable(),
    column: z.number().int().nullable(),
    selection: z.string().max(500).nullable()
  }).strict().nullable(),
  nearbyControls: z.array(z.object({
    role: z.string().max(120),
    name: z.string().max(300)
  }).strict()).max(20),
  screenshotReference: z.null(),
  collectionMethod: z.enum(['accessibility', 'focused-control', 'unavailable']),
  truncationMetadata: z.object({
    truncated: z.boolean(),
    originalCharacters: z.number().int().nonnegative(),
    retainedCharacters: z.number().int().nonnegative()
  }).strict(),
  targetFingerprint: targetFingerprintSchema
}).strict();

const actionTypes = ['insert_text', 'replace_selection', 'insert_table', 'copy', 'open_url', 'navigate_client'];
const proposedActionSchema = z.object({
  type: z.enum(actionTypes),
  arguments: z.object({
    text: z.string().max(MAX_ACTION_TEXT_CHARS).optional(),
    matrix: z.array(z.array(z.string().max(4000)).max(100)).max(100).optional(),
    url: z.string().url().max(2048).optional(),
    route: z.string().max(240).optional(),
    matterId: z.string().max(240).optional()
  }).strict(),
  targetFingerprint: targetFingerprintSchema.nullable(),
  requiresConfirmation: z.boolean()
}).strict().superRefine((action, ctx) => {
  if (action.type === 'insert_table' && !action.arguments.matrix) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['arguments', 'matrix'], message: 'matrix is required' });
  }
  if (action.type !== 'insert_table' && typeof action.arguments.text !== 'string') {
    if (action.type === 'open_url' && action.arguments.url) return;
    if (action.type === 'navigate_client' && action.arguments.route) return;
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['arguments', 'text'], message: 'text is required' });
  }
});

const agentDecisionSchema = z.object({
  intent: z.enum([
    'answer', 'insert', 'replace_selection', 'rewrite', 'summarize',
    'insert_table', 'navigate_focus', 'clarify', 'refuse'
  ]),
  spokenResponse: z.string().max(4000),
  displayResponse: z.string().max(MAX_ACTION_TEXT_CHARS),
  proposedActions: z.array(proposedActionSchema).max(3),
  confidence: z.number().min(0).max(1),
  contextUsed: z.array(z.enum([
    'active_application', 'window_title', 'focused_element', 'selected_text',
    'surrounding_text', 'document_text', 'spreadsheet_context'
  ])).max(7)
}).strict();

const voiceSettingsSchema = z.object({
  enabled: z.boolean(),
  openAtLogin: z.boolean(),
  dictationShortcut: z.string().min(1).max(80),
  captureShortcut: z.string().min(1).max(80),
  agentShortcut: z.string().min(1).max(80),
  defaultMode: z.enum(['dictation', 'agent']),
  screenContextEnabled: z.boolean(),
  voiceOutputEnabled: z.boolean(),
  confirmationPolicy: z.enum(['risk_based', 'always', 'never_safe_only']),
  language: z.string().min(2).max(20)
}).strict();

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  openAtLogin: false,
  dictationShortcut: 'CommandOrControl+Shift+Space',
  captureShortcut: 'Control+Option',
  agentShortcut: 'CommandOrControl+Shift+A',
  defaultMode: 'agent',
  screenContextEnabled: true,
  voiceOutputEnabled: false,
  confirmationPolicy: 'risk_based',
  language: 'en'
});

function parseAgentDecision(value) {
  return agentDecisionSchema.parse(value);
}

function parseSettings(value) {
  const migrated = { ...DEFAULT_SETTINGS, ...(value || {}) };
  // Electron accelerator syntax accepts letter keys consistently across the
  // supported packaged targets. Older builds persisted the word "Period",
  // which Electron 32 rejects during native argument conversion.
  if (migrated.agentShortcut === LEGACY_AGENT_SHORTCUT) {
    migrated.agentShortcut = DEFAULT_SETTINGS.agentShortcut;
  }
  if (migrated.captureShortcut === LEGACY_CAPTURE_SHORTCUT) {
    migrated.captureShortcut = DEFAULT_SETTINGS.captureShortcut;
  }
  migrated.defaultMode = 'agent';
  return voiceSettingsSchema.parse(migrated);
}

module.exports = {
  MAX_INSTRUCTION_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_ACTION_TEXT_CHARS,
  LEGACY_AGENT_SHORTCUT,
  LEGACY_CAPTURE_SHORTCUT,
  DEFAULT_SETTINGS,
  actionTypes,
  targetFingerprintSchema,
  screenContextSchema,
  agentDecisionSchema,
  voiceSettingsSchema,
  parseAgentDecision,
  parseSettings
};

'use strict';

const { z } = require('zod');

const DESKTOP_VOICE_PROTOCOL_VERSION = 'desktop-voice.v1';
const DESKTOP_VOICE_EVENT_TYPES = Object.freeze([
  'transcript.partial', 'transcript.final',
  'assistant.response.delta', 'assistant.response.completed',
  'run.started', 'run.progress', 'run.status', 'run.completed', 'run.failed',
  'clarification.requested', 'approval.requested', 'approval.resolved',
  'desktop.context.requested', 'desktop.context.provided',
  'desktop.action.proposed', 'desktop.action.result',
  'artifact.created', 'speech.started', 'speech.audio', 'speech.stopped',
  'interruption.detected', 'error'
]);

const MAX_INSTRUCTION_CHARS = 4000;
const MAX_CONTEXT_CHARS = 12000;
const MAX_ACTION_TEXT_CHARS = 24000;
const MAX_REALTIME_EVENT_PAYLOAD_BYTES = 12 * 1024 * 1024;
const LEGACY_AGENT_SHORTCUT = 'CommandOrControl+Shift+Period';
const LEGACY_CAPTURE_SHORTCUT = 'Z+X';

const httpsUrlSchema = z.string().url().max(2048).refine((value) => {
  try { return new URL(value).protocol === 'https:'; }
  catch (_) { return false; }
}, 'Only HTTPS URLs are supported');

function jsonSize(value) {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  catch (_) { return Number.POSITIVE_INFINITY; }
}

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
  processId: z.number().int().positive().nullable().optional(),
  bundleId: z.string().max(300).nullable().optional(),
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
    url: httpsUrlSchema.optional(),
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
  voiceOutputEnabled: true,
  confirmationPolicy: 'risk_based',
  language: 'en'
});

const desktopProposalSchema = z.object({
  proposal_id: z.string().uuid(),
  action_type: z.enum(actionTypes),
  payload: z.object({
    text: z.string().max(MAX_ACTION_TEXT_CHARS).optional(),
    matrix: z.array(z.array(z.string().max(4000)).max(100)).max(100).optional(),
    url: httpsUrlSchema.optional(),
    route: z.string().max(240).optional(),
    matter_id: z.string().max(240).optional()
  }).strict(),
  summary: z.string().min(1).max(1000),
  target_fingerprint: targetFingerprintSchema.nullable(),
  context_snapshot_id: z.string().uuid().nullable().optional(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  confirmation_class: z.enum(['client_policy', 'always', 'selection_explicit']),
  idempotency_key: z.string().min(1).max(200),
  conversation_id: z.string().uuid(),
  voice_session_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  run_id: z.string().uuid()
}).strict().superRefine((proposal, ctx) => {
  const payload = proposal.payload;
  if (['insert_text', 'replace_selection', 'copy'].includes(proposal.action_type)
      && typeof payload.text !== 'string') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'text'], message: 'text is required' });
  }
  if (proposal.action_type === 'insert_table' && !payload.matrix) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'matrix'], message: 'matrix is required' });
  }
  if (proposal.action_type === 'open_url' && !payload.url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'url'], message: 'url is required' });
  }
  if (proposal.action_type === 'navigate_client' && !payload.route) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'route'], message: 'route is required' });
  }
});

const desktopEventSchema = z.object({
  protocol_version: z.literal(DESKTOP_VOICE_PROTOCOL_VERSION),
  event_id: z.string().uuid(),
  event_type: z.enum(DESKTOP_VOICE_EVENT_TYPES),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  conversation_id: z.string().uuid(),
  voice_session_id: z.string().uuid(),
  turn_id: z.string().uuid().nullable().optional(),
  run_id: z.string().uuid().nullable().optional(),
  payload: z.record(z.any())
}).strict().superRefine((event, ctx) => {
  if (jsonSize(event.payload) > MAX_REALTIME_EVENT_PAYLOAD_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload'], message: 'event payload is too large' });
  }
  if (event.event_type === 'speech.audio') {
    const audio = event.payload && event.payload.audio;
    if (!audio || typeof audio.base64 !== 'string' || !audio.base64) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'audio'], message: 'speech audio is required' });
    }
  }
});

function contextForRealtime(context, contextSnapshotId) {
  const sanitized = screenContextSchema.parse(context);
  return {
    context_snapshot_id: contextSnapshotId,
    captured_at: new Date().toISOString(),
    active_application: sanitized.activeApplication,
    process_name: sanitized.processName,
    window_title: sanitized.windowTitle,
    focused_element: {
      role: sanitized.focusedElement.role,
      name: sanitized.focusedElement.name,
      is_editable: sanitized.focusedElement.isEditable,
      is_password: sanitized.focusedElement.isPassword,
      bounds: sanitized.focusedElement.bounds
    },
    selected_text: sanitized.selectedText,
    surrounding_text: sanitized.surroundingText,
    accessible_document_text: sanitized.accessibleDocumentText,
    target_fingerprint: sanitized.targetFingerprint,
    collection_method: sanitized.collectionMethod,
    untrusted: true
  };
}

function proposalToDecision(proposal) {
  const parsed = desktopProposalSchema.parse(proposal);
  return {
    intent: parsed.action_type === 'replace_selection' ? 'replace_selection' : 'insert',
    spokenResponse: '',
    displayResponse: parsed.summary,
    proposedActions: [{
      type: parsed.action_type,
      arguments: {
        ...parsed.payload,
        matterId: parsed.payload.matter_id
      },
      targetFingerprint: parsed.target_fingerprint,
      requiresConfirmation: parsed.confirmation_class === 'always'
    }],
    confidence: 1,
    contextUsed: [],
    proposal: parsed
  };
}

function parseAgentDecision(value) {
  return agentDecisionSchema.parse(value);
}

function parseSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const migrated = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => (
    [key, Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback]
  )));
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
  MAX_REALTIME_EVENT_PAYLOAD_BYTES,
  LEGACY_AGENT_SHORTCUT,
  LEGACY_CAPTURE_SHORTCUT,
  DEFAULT_SETTINGS,
  actionTypes,
  targetFingerprintSchema,
  screenContextSchema,
  agentDecisionSchema,
  voiceSettingsSchema,
  parseAgentDecision,
  parseSettings,
  DESKTOP_VOICE_PROTOCOL_VERSION,
  DESKTOP_VOICE_EVENT_TYPES,
  desktopProposalSchema,
  desktopEventSchema,
  contextForRealtime,
  proposalToDecision
};

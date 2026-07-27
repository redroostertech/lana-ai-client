export const STORAGE_KEYS = {
  token: 'token',
  user: 'user',
  connectorsChecklistHidden: 'lana_automation_connectors_checklist_hidden',
  selectedConnectorId: 'lana_automation_selected_connector_id',
  pinnedConnectors: 'lana_automation_pinned_connectors'
};

export const ADMIN_ROLE_NAMES = [
  'admin',
  'super_admin',
  'system_admin',
  'org_admin',
  'organization_admin'
];

/**
 * System-level connectors that ship as built-ins. The detail view uses this
 * list to seed the readiness catalog so legacy connectors (Leadly, ActionStep,
 * GoHighLevel) are always visible even before they're converted to ZIP-style
 * imports with their own `ui/index.html` entry points.
 *
 * Each entry's `match` block describes how to recognize this connector in a
 * raw backend record. `ids` match against `connector_type` / `connector_id` /
 * `id` / `source_type` / `type` (case-insensitive). `names` match against
 * `name` / `connector_name` / `source_name` / `metadata.name`.
 *
 * The detail view itself does not contain any per-connector layout — it
 * iframes whatever `ui_entry_point` URL the backend returns. For connectors
 * that don't yet have a `ui_entry_point` (the three legacy entries below), the
 * detail view shows a minimal info card until they're ZIP-converted.
 */
export const SYSTEM_CONNECTORS = [
  {
    id: 'actionstep',
    connector_type: 'actionstep',
    name: 'ActionStep',
    vendor: 'ActionStep',
    category: 'case_management',
    auth_type: 'api_key',
    description: 'Sync matters, contacts, documents, and billing from ActionStep legal practice management.',
    capabilities: ['matter_sync', 'contact_sync', 'document_sync', 'billing_integration', 'task_management'],
    tags: ['legal', 'practice management', 'case management', 'billing'],
    documentation_url: 'https://www.actionstep.com/api-documentation',
    allowDelete: false,
    match: {
      ids: ['actionstep', 'case-actionstep', 'action-step', 'action_step'],
      names: ['actionstep', 'action step']
    }
  },
  {
    id: 'leadly',
    connector_type: 'leadly',
    name: 'Leadly CRM',
    vendor: 'Leadly',
    category: 'crm',
    auth_type: 'api_key',
    description: 'Connect with Leadly CRM to sync leads, contacts, and opportunities.',
    capabilities: ['lead_sync', 'contact_sync', 'opportunity_tracking', 'pipeline_management'],
    tags: ['crm', 'sales', 'lead management'],
    documentation_url: null,
    allowDelete: false,
    match: {
      ids: ['leadly', 'crm-leadly', 'leadly-crm', 'leadly_crm', 'crm_leadly'],
      names: ['leadly', 'leadly crm']
    }
  },
  {
    id: 'gohighlevel',
    connector_type: 'gohighlevel',
    name: 'GoHighLevel',
    vendor: 'GoHighLevel',
    category: 'crm',
    auth_type: 'oauth2',
    description: 'Two-way sync of contacts, opportunities, and pipelines with GoHighLevel.',
    capabilities: ['lead_sync', 'contact_sync', 'pipeline_management', 'appointment_sync'],
    tags: ['crm', 'marketing automation'],
    documentation_url: null,
    allowDelete: false,
    match: {
      ids: ['gohighlevel', 'crm-gohighlevel', 'go-high-level', 'ghl', 'highlevel', 'high-level'],
      names: ['gohighlevel', 'go high level', 'highlevel', 'ghl']
    }
  }
];


export const VIEW_DEFINITIONS = {
  home: {
    kicker: '',
    title: 'Home',
    summary: ''
  },
  connectors: {
    kicker: 'Connectors',
    title: 'Connectors',
    summary: 'Review installed connectors, check auth shape, and confirm which data sources your automations will depend on.'
  },
  'connector-detail': {
    kicker: 'Connector',
    title: 'Connector',
    summary: 'Configure, monitor, and manage a connector installed for your organization.'
  },
  library: {
    kicker: 'Library',
    title: 'Library',
    summary: 'Pick a template built for a common workflow, then move into the builder with the right defaults already loaded.'
  },
  'library-detail': {
    kicker: 'Library',
    title: 'Automation',
    summary: 'View steps, run history, artifacts, and settings for this automation.'
  },
  builder: {
    kicker: 'Builder',
    title: 'Builder',
    summary: 'Start with a trigger, add workflow steps, configure scope, and save.'
  },
  runs: {
    kicker: 'History',
    title: 'Run History',
    summary: 'Review all triggered runs, statuses, outcomes, and generated artifacts.'
  },
  approvals: {
    kicker: 'Approvals',
    title: 'Approvals',
    summary: 'Keep sensitive workflows explicit and easy to action when approvals are required.'
  }
};

export const SIDEBAR_NAV_ITEMS = [
  { id: 'library', label: 'Library', icon: 'book-open' },
  { id: 'runs', label: 'Run History', icon: 'history' },
  { id: 'approvals', label: 'Approvals', icon: 'check-circle' }
];

export const TRIGGER_OPTIONS = [
  'document.uploaded',
  'connector.synced',
  'schedule.daily',
  'schedule.weekly'
];

export const DAY_OPTIONS = [
  ['0', 'Sunday'],
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday']
];

export const OVERDUE_INVOICE_REMINDER_TEMPLATE_ID = 'invoice-overdue-reminder';

export const TEMPLATE_LIBRARY = [
  {
    id: 'document-intake-audit',
    name: 'Document Intake Audit',
    category: 'Intake',
    trigger: 'document.uploaded',
    description: 'Log a consistent activity event every time a document is uploaded into a matter.',
    bestFor: 'Teams that want a visible audit trail for new matter documents.',
    connectorHints: ['Document repository', 'Matter document feed'],
    scopeHint: 'Usually enabled per matter.',
    defaults: {
      name: 'Document Intake Audit',
      description: 'Logs document-ingest activity for a matter.',
      triggerEvent: 'document.uploaded',
      message: 'A new document arrived and the matter was marked for follow-up review.',
      scheduleTime: '09:00',
      dayOfWeek: '1'
    }
  },
  {
    id: OVERDUE_INVOICE_REMINDER_TEMPLATE_ID,
    name: 'Overdue Invoice Reminder',
    category: 'Billing',
    trigger: 'schedule.daily',
    description: 'Configure deterministic overdue buckets and follow-up templates without relying on AI copy generation.',
    bestFor: 'Billing teams that want rule-driven reminders with clear stage-by-stage templates.',
    connectorHints: ['Accounting connector', 'Invoice source', 'Billing system'],
    scopeHint: 'Usually enabled organization-wide or per billing matter.',
    workflowSteps: [
      'Check invoice records once per day.',
      'Classify overdue invoices into the 1-7, 8-30, and 31+ day buckets.',
      'Apply the matching follow-up 1, 2, or 3 template for the selected bucket.',
      'Create a review task and log the overdue-check audit trail.'
    ],
    defaults: {
      name: 'Overdue Invoice Reminder Rules',
      description: 'Deterministic overdue invoice buckets, follow-up stages, and message templates.',
      triggerEvent: 'schedule.daily',
      message: 'Configure the reminder matrix so billing follow-up stays deterministic and audit-friendly.',
      scheduleTime: '08:00',
      dayOfWeek: '1'
    }
  },
  {
    id: 'connector-sync-watch',
    name: 'Connector Sync Watch',
    category: 'Connectors',
    trigger: 'connector.synced',
    description: 'Create a visible activity trail every time a connected datasource completes a sync.',
    bestFor: 'Ops teams verifying that incoming data is fresh and connector jobs are completing.',
    connectorHints: ['CRM connector', 'Document management connector', 'Practice management connector'],
    scopeHint: 'Can be organization-wide or targeted to a matter.',
    defaults: {
      name: 'Connector Sync Watch',
      description: 'Tracks connector sync completions in matter activity.',
      triggerEvent: 'connector.synced',
      message: 'Connector sync completed and automation logged the event for operator visibility.',
      scheduleTime: '09:00',
      dayOfWeek: '1'
    }
  },
  {
    id: 'weekly-status-draft',
    name: 'Weekly Status Draft',
    category: 'Reporting',
    trigger: 'schedule.weekly',
    description: 'Generate a short weekly status draft and push the output into the activity stream.',
    bestFor: 'Teams producing a recurring matter summary for review.',
    connectorHints: ['Matter data source', 'Document or activity source'],
    scopeHint: 'Usually enabled per matter, then reviewed by staff.',
    defaults: {
      name: 'Weekly Status Draft',
      description: 'Generates a weekly automation draft for the matter.',
      triggerEvent: 'schedule.weekly',
      message: 'Write a concise weekly status draft for the matter, including next actions and risks.',
      scheduleTime: '09:00',
      dayOfWeek: '1'
    }
  }
];

export const FILTER_DEFAULTS = {
  connectors: {
    query: '',
    state: 'all',
    category: 'all',
    auth: 'all',
    version: 'all',
    sortBy: 'name',
    sortDir: 'asc',
    page: 1,
    perPage: 25
  },
  library: { query: '', state: 'all', sortBy: 'updated_at', sortDir: 'desc', page: 1, perPage: 25 },
  runs: { query: '', state: 'all', sortBy: 'created_at', sortDir: 'desc', page: 1, perPage: 25 },
  approvals: { query: '', state: 'all' }
};

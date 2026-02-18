#!/usr/bin/env node

/**
 * LANA AI - API Documentation Generator
 *
 * Reads all database schema files from the LANA-AI backend repo and generates
 * a comprehensive HTML API documentation page.
 *
 * Usage: node scripts/generate-api-docs.js
 * Output: public_html/docs/api-documentation.html
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LANA_AI_ROOT = path.resolve(__dirname, '../../LANA-AI');
const SCHEMAS_DIR = path.join(LANA_AI_ROOT, 'src/database/schemas');
const OUTPUT_FILE = path.join(__dirname, '../public_html/docs/api-documentation.html');

// Entity categorization - maps schema table names to categories
const CATEGORIES = {
  'User Management': {
    icon: 'user',
    description: 'User accounts, authentication, roles, preferences, and session management.',
    tables: [
      'users', 'user_roles', 'roles', 'user_preferences', 'user_devices',
      'user_security_settings', 'user_activations', 'sessions', 'api_tokens',
      'user_favorites', 'user_created_entities'
    ]
  },
  'Organization & Access': {
    icon: 'building',
    description: 'Organizations, departments, groups, permissions, and access control.',
    tables: [
      'organizations', 'organization_identity', 'organization_invitations',
      'departments', 'groups', 'group_members', 'accounts',
      'file_permissions', 'matter_access_permissions', 'matter_group_access',
      'module_access_control', 'rate_limits', 'organization_flavor_overrides'
    ]
  },
  'Matter Management': {
    icon: 'briefcase',
    description: 'Legal matters/cases, participants, contacts, activity tracking, and notes.',
    tables: [
      'client_matters', 'matter_contacts', 'matter_parties', 'matter_pins',
      'custom_field_definitions', 'notes', 'activity_feed',
      'activity_feed_backup_legacy'
    ]
  },
  'Contacts & CRM': {
    icon: 'address-book',
    description: 'Contact records, roles, and cross-entity relationships.',
    tables: [
      'contacts', 'contact_roles', 'entity_links'
    ]
  },
  'Documents & Storage': {
    icon: 'file',
    description: 'Document management, versioning, templates, annotations, sharing, and processing.',
    tables: [
      'documents', 'document_chunks', 'chunk_metadata_edges',
      'document_metadata_nodes', 'document_insights', 'doc_insights',
      'document_access_log', 'document_ownership', 'document_templates',
      'generated_documents', 'document_automation_rules', 'file_versions',
      'file_activity', 'file_shares', 'share_links', 'resource_shares',
      'upload_sessions', 'batch_uploads', 'ingestion_jobs', 'annotations'
    ]
  },
  'Conversations & AI Chat': {
    icon: 'comments',
    description: 'Chat conversations, memory management, session state, and AI response tracking.',
    tables: [
      'conversations', 'chat_sessions', 'conversation_memory',
      'conversation_memory_events', 'conversation_summaries', 'memories',
      'memory_corrections', 'session_activated_docs', 'session_services',
      'session_states', 'streaming_connections', 'retrieval_traces',
      'response_feedback', 'citations'
    ]
  },
  'Financial Management': {
    icon: 'dollar-sign',
    description: 'Time tracking, invoicing, payments, disbursements, expenses, budgets, and trust accounting.',
    tables: [
      'time_entries'
    ]
  },
  'Work Management': {
    icon: 'tasks',
    description: 'Tasks, workflows, comments, and project tracking.',
    tables: [
      'tasks', 'workflows', 'comments', 'comment_reads'
    ]
  },
  'Connectors & Integrations': {
    icon: 'plug',
    description: 'Integration sources, connector configuration, data syncing, and OAuth management.',
    tables: [
      'integration_sources', 'installed_connectors', 'connector_types',
      'connectors', 'connector_data', 'connector_schemas',
      'connector_sync_logs', 'connector_ai_ingestion_logs',
      'connector_failed_records', 'connector_pagination_state',
      'organization_connectors'
    ]
  },
  'Analytics & Reporting': {
    icon: 'chart-bar',
    description: 'Modules, dashboards, reports, metrics, audit logs, and notifications.',
    tables: [
      'module_definitions', 'module_executions', 'module_snapshots',
      'module_targets', 'module_data_overrides', 'module_marketing_spend',
      'report_definitions', 'report_instances', 'report_schedules',
      'report_alerts', 'report_cache', 'report_comments', 'report_sharing',
      'custom_reports', 'management_boards', 'board_assignments',
      'board_metrics', 'metric_submissions', 'audit_logs', 'audit_archives',
      'alert_log', 'notifications', 'notification_preferences',
      'user_activity_daily', 'user_audit_logs'
    ]
  },
  'AI & ML Pipeline': {
    icon: 'brain',
    description: 'LLM inference tracking, RAG metrics, ML feedback, token analytics, and search analytics.',
    tables: [
      'llm_inference_events', 'rag_metrics', 'ml_feedback',
      'token_usage_analytics', 'query_analytics', 'query_logs',
      'query_relevance_labels', 'search_analytics'
    ]
  },
  'System & Configuration': {
    icon: 'cog',
    description: 'Plugins, AI flavor configs, caching, client updates, system health, and webhooks.',
    tables: [
      'plugins', 'flavor_configs', 'flavor_versions', 'cache_entries',
      'client_update_policy', 'schema_migrations', 'system_metrics',
      'energy_metrics', 'energy_summary', 'maintenance_logs',
      'mv_refresh_log', 'batch_jobs', 'webhooks',
      'mcp_audit_logs', 'mcp_view_metadata', 'e2e_test_metrics'
    ]
  },
  'Quality & Self-Repair': {
    icon: 'shield',
    description: 'Internal defect detection, analysis, fix planning, and regression tracking.',
    tables: [
      'defects', 'defect_analyses', 'defect_regressions',
      'fix_plans', 'fix_approvals', 'fix_implementations'
    ]
  }
};

// API endpoints for entities that have routes (method, path, description)
const API_ENDPOINTS = {
  users: [
    { method: 'GET', path: '/api/v1/admin/users', desc: 'List all users (admin, paginated)' },
    { method: 'POST', path: '/api/v1/admin/users', desc: 'Create a new user (admin)' },
    { method: 'GET', path: '/api/v1/admin/users/:id', desc: 'Get user by ID (admin)' },
    { method: 'PUT', path: '/api/v1/admin/users/:id', desc: 'Update user (admin)' },
    { method: 'DELETE', path: '/api/v1/admin/users/:id', desc: 'Delete user (admin)' },
    { method: 'GET', path: '/api/v1/user/profile', desc: 'Get current user profile' },
    { method: 'PUT', path: '/api/v1/user/profile', desc: 'Update current user profile' },
    { method: 'GET', path: '/api/v1/user-management/users', desc: 'List org users (paginated)' },
    { method: 'POST', path: '/api/v1/user-management/users', desc: 'Create org user' },
    { method: 'PATCH', path: '/api/v1/user-management/users/:id', desc: 'Update org user' },
    { method: 'DELETE', path: '/api/v1/user-management/users/:id', desc: 'Remove org user' },
  ],
  user_preferences: [
    { method: 'GET', path: '/api/v1/user/preferences', desc: 'Get user preferences' },
    { method: 'PUT', path: '/api/v1/user/preferences', desc: 'Update user preferences' },
    { method: 'DELETE', path: '/api/v1/user/preferences/:key', desc: 'Delete a preference' },
  ],
  user_devices: [
    { method: 'POST', path: '/api/v1/mobile/devices', desc: 'Register a device' },
    { method: 'GET', path: '/api/v1/mobile/devices', desc: 'List registered devices' },
    { method: 'DELETE', path: '/api/v1/mobile/devices/:id', desc: 'Remove a device' },
  ],
  user_security_settings: [
    { method: 'POST', path: '/api/v1/mfa/setup', desc: 'Initialize MFA setup' },
    { method: 'POST', path: '/api/v1/mfa/verify', desc: 'Verify MFA code' },
  ],
  sessions: [
    { method: 'POST', path: '/api/v1/auth/login', desc: 'Login (create session)' },
    { method: 'POST', path: '/api/v1/auth/logout', desc: 'Logout (destroy session)' },
    { method: 'GET', path: '/api/v1/auth/sessions', desc: 'List active sessions' },
    { method: 'DELETE', path: '/api/v1/auth/sessions/:id', desc: 'Revoke a session' },
    { method: 'GET', path: '/api/v1/admin/sessions', desc: 'List all sessions (admin)' },
    { method: 'DELETE', path: '/api/v1/admin/sessions/:id', desc: 'Kill session (admin)' },
  ],
  api_tokens: [
    { method: 'POST', path: '/api/v1/api-tokens', desc: 'Create API token' },
    { method: 'GET', path: '/api/v1/api-tokens', desc: 'List API tokens' },
    { method: 'DELETE', path: '/api/v1/api-tokens/:id', desc: 'Revoke API token' },
  ],
  roles: [
    { method: 'GET', path: '/api/v1/rbac/roles', desc: 'List all roles' },
    { method: 'POST', path: '/api/v1/rbac/roles', desc: 'Create a role' },
    { method: 'PUT', path: '/api/v1/rbac/roles/:id', desc: 'Update a role' },
    { method: 'DELETE', path: '/api/v1/rbac/roles/:id', desc: 'Delete a role' },
  ],
  user_roles: [
    { method: 'GET', path: '/api/v1/rbac/user-roles', desc: 'List user role assignments' },
    { method: 'POST', path: '/api/v1/rbac/user-roles', desc: 'Assign role to user' },
    { method: 'DELETE', path: '/api/v1/rbac/user-roles/:id', desc: 'Remove role from user' },
  ],
  organizations: [
    { method: 'GET', path: '/api/v1/organizations', desc: 'List organizations' },
    { method: 'POST', path: '/api/v1/organizations', desc: 'Create organization' },
    { method: 'GET', path: '/api/v1/organizations/:id', desc: 'Get organization' },
    { method: 'PUT', path: '/api/v1/organizations/:id', desc: 'Update organization' },
    { method: 'DELETE', path: '/api/v1/organizations/:id', desc: 'Delete organization' },
  ],
  groups: [
    { method: 'GET', path: '/api/v1/groups', desc: 'List groups' },
    { method: 'POST', path: '/api/v1/groups', desc: 'Create group' },
    { method: 'GET', path: '/api/v1/groups/:id', desc: 'Get group' },
    { method: 'PUT', path: '/api/v1/groups/:id', desc: 'Update group' },
    { method: 'DELETE', path: '/api/v1/groups/:id', desc: 'Delete group' },
  ],
  group_members: [
    { method: 'GET', path: '/api/v1/groups/:groupId/members', desc: 'List group members' },
    { method: 'POST', path: '/api/v1/groups/:groupId/members', desc: 'Add member to group' },
    { method: 'DELETE', path: '/api/v1/groups/:groupId/members/:userId', desc: 'Remove member' },
  ],
  client_matters: [
    { method: 'GET', path: '/api/v1/matters', desc: 'List matters (paginated)' },
    { method: 'POST', path: '/api/v1/matters', desc: 'Create a matter' },
    { method: 'GET', path: '/api/v1/matters/search', desc: 'Search matters' },
    { method: 'GET', path: '/api/v1/matters/recent', desc: 'Get recent matters' },
    { method: 'GET', path: '/api/v1/matters/pinned', desc: 'Get pinned matters' },
    { method: 'GET', path: '/api/v1/matters/:matter_id', desc: 'Get matter by ID' },
    { method: 'PUT', path: '/api/v1/matters/:matter_id', desc: 'Update matter' },
    { method: 'DELETE', path: '/api/v1/matters/:matter_id', desc: 'Delete matter' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/archive', desc: 'Archive matter' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/unarchive', desc: 'Unarchive matter' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/clone', desc: 'Clone matter' },
    { method: 'POST', path: '/api/v1/matters/bulk-delete', desc: 'Bulk delete matters' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/profile', desc: 'Get matter profile' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/settings', desc: 'Get matter settings' },
    { method: 'PUT', path: '/api/v1/matters/:matter_id/settings', desc: 'Update matter settings' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/merge-fields', desc: 'Get merge fields' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/pin', desc: 'Pin matter' },
    { method: 'DELETE', path: '/api/v1/matters/:matter_id/pin', desc: 'Unpin matter' },
  ],
  matter_access_permissions: [
    { method: 'GET', path: '/api/v1/matter-access/:matter_id', desc: 'List matter access' },
    { method: 'POST', path: '/api/v1/matter-access/:matter_id', desc: 'Grant access' },
    { method: 'DELETE', path: '/api/v1/matter-access/:matter_id/:user_id', desc: 'Revoke access' },
  ],
  contacts: [
    { method: 'GET', path: '/api/v1/contacts', desc: 'List contacts' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/contacts', desc: 'List matter contacts' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/contacts', desc: 'Add contact to matter' },
    { method: 'PUT', path: '/api/v1/matters/:matter_id/contacts/:id', desc: 'Update matter contact' },
    { method: 'DELETE', path: '/api/v1/matters/:matter_id/contacts/:id', desc: 'Remove contact' },
  ],
  entity_links: [
    { method: 'GET', path: '/api/v1/entity-links', desc: 'List entity links' },
    { method: 'POST', path: '/api/v1/entity-links', desc: 'Create entity link' },
    { method: 'DELETE', path: '/api/v1/entity-links/:id', desc: 'Delete entity link' },
  ],
  documents: [
    { method: 'GET', path: '/api/v1/storage/files', desc: 'List documents (paginated)' },
    { method: 'POST', path: '/api/v1/storage/upload', desc: 'Upload document' },
    { method: 'GET', path: '/api/v1/storage/files/:id', desc: 'Get document metadata' },
    { method: 'GET', path: '/api/v1/storage/files/:id/download', desc: 'Download document' },
    { method: 'PUT', path: '/api/v1/storage/files/:id', desc: 'Update document metadata' },
    { method: 'DELETE', path: '/api/v1/storage/files/:id', desc: 'Delete document' },
    { method: 'POST', path: '/api/v1/storage/files/:id/process', desc: 'Trigger processing' },
    { method: 'GET', path: '/api/v1/storage/files/:id/progress', desc: 'Get processing progress' },
  ],
  document_metadata_nodes: [
    { method: 'GET', path: '/api/v1/document-metadata/:docId', desc: 'Get document metadata' },
    { method: 'POST', path: '/api/v1/document-metadata', desc: 'Create metadata node' },
    { method: 'PUT', path: '/api/v1/document-metadata/:id', desc: 'Update metadata node' },
  ],
  document_templates: [
    { method: 'GET', path: '/api/v1/document-templates', desc: 'List templates' },
    { method: 'POST', path: '/api/v1/document-templates', desc: 'Create template' },
    { method: 'GET', path: '/api/v1/document-templates/:id', desc: 'Get template' },
    { method: 'PUT', path: '/api/v1/document-templates/:id', desc: 'Update template' },
    { method: 'DELETE', path: '/api/v1/document-templates/:id', desc: 'Delete template' },
  ],
  generated_documents: [
    { method: 'GET', path: '/api/v1/generated-documents', desc: 'List generated documents' },
    { method: 'POST', path: '/api/v1/generated-documents', desc: 'Generate document' },
    { method: 'GET', path: '/api/v1/generated-documents/:id', desc: 'Get generated document' },
    { method: 'DELETE', path: '/api/v1/generated-documents/:id', desc: 'Delete generated document' },
  ],
  document_automation_rules: [
    { method: 'GET', path: '/api/v1/document-automation', desc: 'List automation rules' },
    { method: 'POST', path: '/api/v1/document-automation', desc: 'Create rule' },
    { method: 'PUT', path: '/api/v1/document-automation/:id', desc: 'Update rule' },
    { method: 'DELETE', path: '/api/v1/document-automation/:id', desc: 'Delete rule' },
  ],
  file_versions: [
    { method: 'GET', path: '/api/v1/documents/:docId/versions', desc: 'List versions' },
    { method: 'POST', path: '/api/v1/documents/:docId/versions', desc: 'Create version' },
    { method: 'GET', path: '/api/v1/documents/:docId/versions/:id', desc: 'Get version' },
    { method: 'DELETE', path: '/api/v1/documents/:docId/versions/:id', desc: 'Delete version' },
  ],
  file_shares: [
    { method: 'GET', path: '/api/v1/sharing', desc: 'List shares' },
    { method: 'POST', path: '/api/v1/sharing', desc: 'Create share' },
    { method: 'DELETE', path: '/api/v1/sharing/:id', desc: 'Revoke share' },
  ],
  annotations: [
    { method: 'GET', path: '/api/v1/annotations', desc: 'List annotations' },
    { method: 'POST', path: '/api/v1/annotations', desc: 'Create annotation' },
    { method: 'GET', path: '/api/v1/annotations/:id', desc: 'Get annotation' },
    { method: 'PUT', path: '/api/v1/annotations/:id', desc: 'Update annotation' },
    { method: 'DELETE', path: '/api/v1/annotations/:id', desc: 'Delete annotation' },
  ],
  conversations: [
    { method: 'GET', path: '/api/v1/conversations', desc: 'List conversations' },
    { method: 'POST', path: '/api/v1/conversations', desc: 'Create conversation' },
    { method: 'GET', path: '/api/v1/conversations/:threadId', desc: 'Get conversation thread' },
    { method: 'PUT', path: '/api/v1/conversations/:threadId', desc: 'Update conversation' },
    { method: 'DELETE', path: '/api/v1/conversations/:threadId', desc: 'Delete conversation' },
  ],
  chat_sessions: [
    { method: 'GET', path: '/api/v1/chat/state', desc: 'Get chat state' },
    { method: 'PUT', path: '/api/v1/chat/state', desc: 'Update chat state' },
    { method: 'POST', path: '/api/v1/chat/send', desc: 'Send chat message' },
    { method: 'POST', path: '/api/v1/chat/stream', desc: 'Stream chat response' },
  ],
  conversation_memory: [
    { method: 'GET', path: '/api/v1/memory', desc: 'Get memory entries' },
    { method: 'POST', path: '/api/v1/memory', desc: 'Create memory entry' },
    { method: 'PUT', path: '/api/v1/memory/:id', desc: 'Update memory' },
    { method: 'DELETE', path: '/api/v1/memory/:id', desc: 'Delete memory' },
  ],
  session_states: [
    { method: 'GET', path: '/api/v1/session-state', desc: 'Get session state' },
    { method: 'POST', path: '/api/v1/session-state', desc: 'Create session state' },
    { method: 'PUT', path: '/api/v1/session-state/:id', desc: 'Update session state' },
    { method: 'DELETE', path: '/api/v1/session-state/:id', desc: 'Delete session state' },
  ],
  response_feedback: [
    { method: 'GET', path: '/api/v1/feedback', desc: 'List feedback entries' },
    { method: 'POST', path: '/api/v1/feedback', desc: 'Submit feedback' },
  ],
  retrieval_traces: [
    { method: 'GET', path: '/api/v1/traces', desc: 'List retrieval traces' },
    { method: 'DELETE', path: '/api/v1/traces/:id', desc: 'Delete trace' },
  ],
  time_entries: [
    { method: 'GET', path: '/api/v1/matters/:matter_id/time-entries', desc: 'List time entries' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/time-entries', desc: 'Create time entry' },
    { method: 'GET', path: '/api/v1/time-entries/:id', desc: 'Get time entry' },
    { method: 'PUT', path: '/api/v1/time-entries/:id', desc: 'Update time entry' },
    { method: 'DELETE', path: '/api/v1/time-entries/:id', desc: 'Delete time entry' },
  ],
  tasks: [
    { method: 'GET', path: '/api/v1/matters/:matter_id/tasks', desc: 'List tasks' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/tasks', desc: 'Create task' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/tasks/statistics', desc: 'Task statistics' },
    { method: 'GET', path: '/api/v1/tasks/:id', desc: 'Get task' },
    { method: 'PATCH', path: '/api/v1/tasks/:id', desc: 'Update task' },
    { method: 'PATCH', path: '/api/v1/tasks/:id/complete', desc: 'Complete task' },
    { method: 'DELETE', path: '/api/v1/tasks/:id', desc: 'Delete task' },
  ],
  workflows: [
    { method: 'GET', path: '/api/v1/workflows', desc: 'List workflows' },
    { method: 'POST', path: '/api/v1/workflows', desc: 'Create workflow' },
    { method: 'GET', path: '/api/v1/workflows/:id', desc: 'Get workflow' },
    { method: 'PUT', path: '/api/v1/workflows/:id', desc: 'Update workflow' },
    { method: 'DELETE', path: '/api/v1/workflows/:id', desc: 'Delete workflow' },
  ],
  comments: [
    { method: 'GET', path: '/api/v1/comments', desc: 'List comments' },
    { method: 'POST', path: '/api/v1/comments', desc: 'Create comment' },
    { method: 'PUT', path: '/api/v1/comments/:id', desc: 'Update comment' },
    { method: 'DELETE', path: '/api/v1/comments/:id', desc: 'Delete comment' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/comments', desc: 'List matter comments' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/comments', desc: 'Add matter comment' },
  ],
  notes: [
    { method: 'GET', path: '/api/v1/matters/:matter_id/notes', desc: 'List matter notes' },
    { method: 'POST', path: '/api/v1/matters/:matter_id/notes', desc: 'Create note' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/notes/:id', desc: 'Get note' },
    { method: 'PUT', path: '/api/v1/matters/:matter_id/notes/:id', desc: 'Update note' },
    { method: 'DELETE', path: '/api/v1/matters/:matter_id/notes/:id', desc: 'Delete note' },
  ],
  integration_sources: [
    { method: 'GET', path: '/api/v1/integrations', desc: 'List integrations' },
    { method: 'POST', path: '/api/v1/integrations', desc: 'Create integration' },
    { method: 'GET', path: '/api/v1/integrations/:id', desc: 'Get integration' },
    { method: 'PUT', path: '/api/v1/integrations/:id', desc: 'Update integration' },
    { method: 'DELETE', path: '/api/v1/integrations/:id', desc: 'Delete integration' },
    { method: 'POST', path: '/api/v1/integrations/:id/sync', desc: 'Trigger sync' },
    { method: 'GET', path: '/api/v1/integrations/:id/sync-logs', desc: 'Get sync logs' },
  ],
  installed_connectors: [
    { method: 'GET', path: '/api/v1/connector-registry', desc: 'List available connectors' },
    { method: 'POST', path: '/api/v1/connector-registry/install', desc: 'Install connector' },
  ],
  connectors: [
    { method: 'GET', path: '/api/v1/generic-connectors', desc: 'List connectors' },
    { method: 'POST', path: '/api/v1/generic-connectors', desc: 'Create connector' },
    { method: 'GET', path: '/api/v1/generic-connectors/:id', desc: 'Get connector' },
    { method: 'PUT', path: '/api/v1/generic-connectors/:id', desc: 'Update connector' },
    { method: 'DELETE', path: '/api/v1/generic-connectors/:id', desc: 'Delete connector' },
  ],
  connector_schemas: [
    { method: 'GET', path: '/api/v1/connectors/schemas', desc: 'List connector schemas' },
    { method: 'POST', path: '/api/v1/connectors/schemas', desc: 'Create schema' },
    { method: 'GET', path: '/api/v1/connectors/schemas/:id', desc: 'Get schema' },
    { method: 'PUT', path: '/api/v1/connectors/schemas/:id', desc: 'Update schema' },
    { method: 'DELETE', path: '/api/v1/connectors/schemas/:id', desc: 'Delete schema' },
  ],
  module_definitions: [
    { method: 'GET', path: '/api/v1/modules', desc: 'List modules' },
    { method: 'POST', path: '/api/v1/modules', desc: 'Create module' },
    { method: 'GET', path: '/api/v1/modules/:id', desc: 'Get module' },
    { method: 'PUT', path: '/api/v1/modules/:id', desc: 'Update module' },
    { method: 'DELETE', path: '/api/v1/modules/:id', desc: 'Delete module' },
  ],
  management_boards: [
    { method: 'GET', path: '/api/v1/management-boards', desc: 'List boards' },
    { method: 'POST', path: '/api/v1/management-boards', desc: 'Create board' },
    { method: 'GET', path: '/api/v1/management-boards/:id', desc: 'Get board' },
    { method: 'PUT', path: '/api/v1/management-boards/:id', desc: 'Update board' },
    { method: 'DELETE', path: '/api/v1/management-boards/:id', desc: 'Delete board' },
  ],
  metric_submissions: [
    { method: 'GET', path: '/api/v1/metric-submissions', desc: 'List submissions' },
    { method: 'POST', path: '/api/v1/metric-submissions', desc: 'Submit metric' },
    { method: 'PUT', path: '/api/v1/metric-submissions/:id', desc: 'Update submission' },
    { method: 'DELETE', path: '/api/v1/metric-submissions/:id', desc: 'Delete submission' },
  ],
  audit_logs: [
    { method: 'GET', path: '/api/v1/audit', desc: 'List audit logs (paginated)' },
    { method: 'GET', path: '/api/v1/audit/:id', desc: 'Get audit log entry' },
  ],
  activity_feed: [
    { method: 'GET', path: '/api/v1/activity', desc: 'Get activity feed' },
    { method: 'GET', path: '/api/v1/matters/:matter_id/activity', desc: 'Get matter activity' },
  ],
  notifications: [
    { method: 'GET', path: '/api/v1/notifications', desc: 'List notifications' },
    { method: 'POST', path: '/api/v1/notifications', desc: 'Create notification' },
    { method: 'PUT', path: '/api/v1/notifications/:id/read', desc: 'Mark as read' },
    { method: 'DELETE', path: '/api/v1/notifications/:id', desc: 'Delete notification' },
  ],
  plugins: [
    { method: 'GET', path: '/api/v1/plugins', desc: 'List plugins' },
    { method: 'POST', path: '/api/v1/plugins', desc: 'Install plugin' },
    { method: 'PUT', path: '/api/v1/plugins/:id', desc: 'Update plugin' },
    { method: 'DELETE', path: '/api/v1/plugins/:id', desc: 'Delete plugin' },
  ],
  flavor_configs: [
    { method: 'GET', path: '/api/v1/flavors', desc: 'List AI flavors' },
    { method: 'POST', path: '/api/v1/flavors', desc: 'Create flavor' },
    { method: 'GET', path: '/api/v1/flavors/:id', desc: 'Get flavor' },
    { method: 'PUT', path: '/api/v1/flavors/:id', desc: 'Update flavor' },
    { method: 'DELETE', path: '/api/v1/flavors/:id', desc: 'Delete flavor' },
  ],
  cache_entries: [
    { method: 'GET', path: '/api/v1/cache', desc: 'List cache entries' },
    { method: 'POST', path: '/api/v1/cache', desc: 'Create cache entry' },
    { method: 'DELETE', path: '/api/v1/cache/:key', desc: 'Invalidate cache entry' },
  ],
  webhooks: [
    { method: 'GET', path: '/api/v1/webhooks', desc: 'List webhooks' },
    { method: 'POST', path: '/api/v1/webhooks', desc: 'Create webhook' },
    { method: 'PUT', path: '/api/v1/webhooks/:id', desc: 'Update webhook' },
    { method: 'DELETE', path: '/api/v1/webhooks/:id', desc: 'Delete webhook' },
  ],
};

// Entities with routes but no schema file (virtual/CRM entities stored in connector_data)
const VIRTUAL_ENTITIES = [
  {
    name: 'Leads',
    tableName: 'leads',
    category: 'Contacts & CRM',
    description: 'Sales leads and prospects. Data stored via connector_data or native LANA tables.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/leads', desc: 'List leads' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/leads', desc: 'Create lead' },
      { method: 'GET', path: '/api/v1/leads/:id', desc: 'Get lead' },
      { method: 'PATCH', path: '/api/v1/leads/:id', desc: 'Update lead' },
      { method: 'DELETE', path: '/api/v1/leads/:id', desc: 'Delete lead' },
    ]
  },
  {
    name: 'Opportunities',
    tableName: 'opportunities',
    category: 'Contacts & CRM',
    description: 'Business opportunities and deals.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/opportunities', desc: 'List opportunities' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/opportunities', desc: 'Create opportunity' },
      { method: 'GET', path: '/api/v1/opportunities/:id', desc: 'Get opportunity' },
      { method: 'PATCH', path: '/api/v1/opportunities/:id', desc: 'Update opportunity' },
      { method: 'DELETE', path: '/api/v1/opportunities/:id', desc: 'Delete opportunity' },
    ]
  },
  {
    name: 'Campaigns',
    tableName: 'campaigns',
    category: 'Contacts & CRM',
    description: 'Marketing campaigns and outreach tracking.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/campaigns', desc: 'List campaigns' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/campaigns', desc: 'Create campaign' },
      { method: 'GET', path: '/api/v1/campaigns/:id', desc: 'Get campaign' },
      { method: 'PATCH', path: '/api/v1/campaigns/:id', desc: 'Update campaign' },
      { method: 'DELETE', path: '/api/v1/campaigns/:id', desc: 'Delete campaign' },
    ]
  },
  {
    name: 'Pipelines',
    tableName: 'pipelines',
    category: 'Contacts & CRM',
    description: 'Sales pipeline stages and tracking.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/pipelines', desc: 'List pipelines' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/pipelines', desc: 'Create pipeline' },
      { method: 'GET', path: '/api/v1/pipelines/:id', desc: 'Get pipeline' },
      { method: 'PATCH', path: '/api/v1/pipelines/:id', desc: 'Update pipeline' },
      { method: 'DELETE', path: '/api/v1/pipelines/:id', desc: 'Delete pipeline' },
    ]
  },
  {
    name: 'Invoices',
    tableName: 'invoices',
    category: 'Financial Management',
    description: 'Client invoices and billing records.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/invoices', desc: 'List invoices' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/invoices', desc: 'Create invoice' },
      { method: 'GET', path: '/api/v1/invoices/:id', desc: 'Get invoice' },
      { method: 'PATCH', path: '/api/v1/invoices/:id', desc: 'Update invoice' },
      { method: 'DELETE', path: '/api/v1/invoices/:id', desc: 'Delete invoice' },
    ]
  },
  {
    name: 'Payments',
    tableName: 'payments',
    category: 'Financial Management',
    description: 'Payment records against invoices.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/payments', desc: 'List payments' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/payments', desc: 'Record payment' },
      { method: 'GET', path: '/api/v1/payments/:id', desc: 'Get payment' },
      { method: 'PATCH', path: '/api/v1/payments/:id', desc: 'Update payment' },
      { method: 'DELETE', path: '/api/v1/payments/:id', desc: 'Delete payment' },
    ]
  },
  {
    name: 'Disbursements',
    tableName: 'disbursements',
    category: 'Financial Management',
    description: 'Disbursements and expense reimbursements.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/disbursements', desc: 'List disbursements' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/disbursements', desc: 'Create disbursement' },
      { method: 'GET', path: '/api/v1/disbursements/:id', desc: 'Get disbursement' },
      { method: 'PATCH', path: '/api/v1/disbursements/:id', desc: 'Update disbursement' },
      { method: 'DELETE', path: '/api/v1/disbursements/:id', desc: 'Delete disbursement' },
    ]
  },
  {
    name: 'Trust Entries',
    tableName: 'trust_entries',
    category: 'Financial Management',
    description: 'Trust account deposits, withdrawals, and transfers.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/trust-entries', desc: 'List trust entries' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/trust-entries', desc: 'Create trust entry' },
      { method: 'GET', path: '/api/v1/trust-entries/:id', desc: 'Get trust entry' },
      { method: 'PATCH', path: '/api/v1/trust-entries/:id', desc: 'Update trust entry' },
    ]
  },
  {
    name: 'Expenses',
    tableName: 'expenses',
    category: 'Financial Management',
    description: 'Matter-related expense tracking.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/expenses', desc: 'List expenses' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/expenses', desc: 'Create expense' },
      { method: 'GET', path: '/api/v1/expenses/:id', desc: 'Get expense' },
      { method: 'PATCH', path: '/api/v1/expenses/:id', desc: 'Update expense' },
      { method: 'DELETE', path: '/api/v1/expenses/:id', desc: 'Delete expense' },
    ]
  },
  {
    name: 'Estimates',
    tableName: 'estimates',
    category: 'Financial Management',
    description: 'Cost estimates and fee quotes.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/estimates', desc: 'List estimates' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/estimates', desc: 'Create estimate' },
      { method: 'GET', path: '/api/v1/estimates/:id', desc: 'Get estimate' },
      { method: 'PATCH', path: '/api/v1/estimates/:id', desc: 'Update estimate' },
      { method: 'DELETE', path: '/api/v1/estimates/:id', desc: 'Delete estimate' },
    ]
  },
  {
    name: 'Budgets',
    tableName: 'budgets',
    category: 'Financial Management',
    description: 'Matter budget management and tracking.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/budgets', desc: 'List budgets' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/budgets', desc: 'Create budget' },
      { method: 'GET', path: '/api/v1/budgets/:id', desc: 'Get budget' },
      { method: 'PATCH', path: '/api/v1/budgets/:id', desc: 'Update budget' },
      { method: 'DELETE', path: '/api/v1/budgets/:id', desc: 'Delete budget' },
    ]
  },
  {
    name: 'Subtasks',
    tableName: 'subtasks',
    category: 'Work Management',
    description: 'Sub-tasks nested under parent tasks.',
    endpoints: [
      { method: 'GET', path: '/api/v1/tasks/:task_id/subtasks', desc: 'List subtasks' },
      { method: 'POST', path: '/api/v1/tasks/:task_id/subtasks', desc: 'Create subtask' },
      { method: 'GET', path: '/api/v1/subtasks/:id', desc: 'Get subtask' },
      { method: 'PATCH', path: '/api/v1/subtasks/:id', desc: 'Update subtask' },
      { method: 'DELETE', path: '/api/v1/subtasks/:id', desc: 'Delete subtask' },
    ]
  },
  {
    name: 'Milestones',
    tableName: 'milestones',
    category: 'Work Management',
    description: 'Project milestones and deadlines.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/milestones', desc: 'List milestones' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/milestones', desc: 'Create milestone' },
      { method: 'GET', path: '/api/v1/milestones/:id', desc: 'Get milestone' },
      { method: 'PATCH', path: '/api/v1/milestones/:id', desc: 'Update milestone' },
      { method: 'DELETE', path: '/api/v1/milestones/:id', desc: 'Delete milestone' },
    ]
  },
  {
    name: 'Projects',
    tableName: 'projects',
    category: 'Work Management',
    description: 'Project management within matters.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/projects', desc: 'List projects' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/projects', desc: 'Create project' },
      { method: 'GET', path: '/api/v1/projects/:id', desc: 'Get project' },
      { method: 'PATCH', path: '/api/v1/projects/:id', desc: 'Update project' },
      { method: 'DELETE', path: '/api/v1/projects/:id', desc: 'Delete project' },
    ]
  },
  {
    name: 'Checklists',
    tableName: 'checklists',
    category: 'Work Management',
    description: 'Checklist templates and instances.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/checklists', desc: 'List checklists' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/checklists', desc: 'Create checklist' },
      { method: 'GET', path: '/api/v1/checklists/:id', desc: 'Get checklist' },
      { method: 'PATCH', path: '/api/v1/checklists/:id', desc: 'Update checklist' },
      { method: 'DELETE', path: '/api/v1/checklists/:id', desc: 'Delete checklist' },
    ]
  },
  {
    name: 'Checklist Items',
    tableName: 'checklist_items',
    category: 'Work Management',
    description: 'Individual items within checklists.',
    endpoints: [
      { method: 'GET', path: '/api/v1/checklists/:checklist_id/items', desc: 'List items' },
      { method: 'POST', path: '/api/v1/checklists/:checklist_id/items', desc: 'Create item' },
      { method: 'PATCH', path: '/api/v1/checklist-items/:id', desc: 'Update item' },
      { method: 'DELETE', path: '/api/v1/checklist-items/:id', desc: 'Delete item' },
    ]
  },
  {
    name: 'Emails',
    tableName: 'emails',
    category: 'Work Management',
    description: 'Email records associated with matters.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/emails', desc: 'List emails' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/emails', desc: 'Create email record' },
      { method: 'GET', path: '/api/v1/emails/:id', desc: 'Get email' },
      { method: 'PATCH', path: '/api/v1/emails/:id', desc: 'Update email' },
      { method: 'DELETE', path: '/api/v1/emails/:id', desc: 'Delete email' },
    ]
  },
  {
    name: 'Calls',
    tableName: 'calls',
    category: 'Work Management',
    description: 'Phone call records and notes.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/calls', desc: 'List calls' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/calls', desc: 'Record call' },
      { method: 'GET', path: '/api/v1/calls/:id', desc: 'Get call' },
      { method: 'PATCH', path: '/api/v1/calls/:id', desc: 'Update call' },
      { method: 'DELETE', path: '/api/v1/calls/:id', desc: 'Delete call' },
    ]
  },
  {
    name: 'Calendar Events',
    tableName: 'calendar_events',
    category: 'Work Management',
    description: 'Calendar events and appointments.',
    endpoints: [
      { method: 'GET', path: '/api/v1/matters/:matter_id/calendar-events', desc: 'List events' },
      { method: 'POST', path: '/api/v1/matters/:matter_id/calendar-events', desc: 'Create event' },
      { method: 'GET', path: '/api/v1/calendar-events/:id', desc: 'Get event' },
      { method: 'PATCH', path: '/api/v1/calendar-events/:id', desc: 'Update event' },
      { method: 'DELETE', path: '/api/v1/calendar-events/:id', desc: 'Delete event' },
    ]
  },
  {
    name: 'Folders',
    tableName: 'folders',
    category: 'Documents & Storage',
    description: 'Virtual folder structure for document organization.',
    endpoints: [
      { method: 'GET', path: '/api/v1/folders', desc: 'List folders' },
      { method: 'POST', path: '/api/v1/folders', desc: 'Create folder' },
      { method: 'GET', path: '/api/v1/folders/:id', desc: 'Get folder' },
      { method: 'PUT', path: '/api/v1/folders/:id', desc: 'Update folder' },
      { method: 'DELETE', path: '/api/v1/folders/:id', desc: 'Delete folder' },
    ]
  },
  {
    name: 'Trash',
    tableName: 'trash',
    category: 'Documents & Storage',
    description: 'Soft-deleted items pending permanent removal.',
    endpoints: [
      { method: 'GET', path: '/api/v1/trash', desc: 'List trashed items' },
      { method: 'POST', path: '/api/v1/trash/:id/restore', desc: 'Restore item' },
      { method: 'DELETE', path: '/api/v1/trash/:id', desc: 'Permanently delete' },
    ]
  },
];

// ---------------------------------------------------------------------------
// Schema Reader
// ---------------------------------------------------------------------------

function readSchemas() {
  const schemas = {};

  if (!fs.existsSync(SCHEMAS_DIR)) {
    console.error(`Schema directory not found: ${SCHEMAS_DIR}`);
    console.error('Make sure LANA-AI repo is at the expected path.');
    process.exit(1);
  }

  const files = fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.schema.js'));

  for (const file of files) {
    const filePath = path.join(SCHEMAS_DIR, file);
    try {
      // Clear require cache to get fresh data
      delete require.cache[require.resolve(filePath)];
      const schema = require(filePath);
      if (schema && schema.tableName) {
        schemas[schema.tableName] = {
          ...schema,
          fileName: file
        };
      }
    } catch (err) {
      console.warn(`Warning: Could not load ${file}: ${err.message}`);
    }
  }

  return schemas;
}

// ---------------------------------------------------------------------------
// HTML Generator
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function formatTableName(tableName) {
  return tableName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getMethodColor(method) {
  const colors = {
    GET: '#22c55e',
    POST: '#3b82f6',
    PUT: '#f59e0b',
    PATCH: '#f97316',
    DELETE: '#ef4444',
  };
  return colors[method] || '#6b7280';
}

function getMethodBg(method) {
  const colors = {
    GET: 'rgba(34,197,94,0.1)',
    POST: 'rgba(59,130,246,0.1)',
    PUT: 'rgba(245,158,11,0.1)',
    PATCH: 'rgba(249,115,22,0.1)',
    DELETE: 'rgba(239,68,68,0.1)',
  };
  return colors[method] || 'rgba(107,114,128,0.1)';
}

function getTypeLabel(type) {
  if (!type) return 'UNKNOWN';
  const t = type.toUpperCase();
  if (t.startsWith('VARCHAR')) return t;
  if (t === 'TIMESTAMPTZ' || t === 'TIMESTAMP') return 'TIMESTAMP';
  if (t === 'TSVECTOR') return 'TSVECTOR';
  if (t === 'VECTOR') return 'VECTOR';
  return t;
}

function getTypeBadgeColor(type) {
  if (!type) return '#6b7280';
  const t = type.toUpperCase();
  if (t === 'UUID') return '#8b5cf6';
  if (t.startsWith('VARCHAR') || t === 'TEXT') return '#22c55e';
  if (t === 'INTEGER' || t === 'BIGINT' || t === 'NUMERIC') return '#3b82f6';
  if (t === 'BOOLEAN') return '#f59e0b';
  if (t === 'JSONB' || t === 'JSON') return '#ec4899';
  if (t.includes('TIMESTAMP') || t === 'DATE') return '#06b6d4';
  if (t === 'TSVECTOR') return '#6366f1';
  if (t === 'VECTOR') return '#a855f7';
  return '#6b7280';
}

function getCrudBadge(tableName) {
  const endpoints = API_ENDPOINTS[tableName];
  if (!endpoints) return '';

  const methods = new Set(endpoints.map(e => e.method));
  const ops = [];
  if (methods.has('POST')) ops.push('C');
  if (methods.has('GET')) ops.push('R');
  if (methods.has('PUT') || methods.has('PATCH')) ops.push('U');
  if (methods.has('DELETE')) ops.push('D');
  return ops.join('');
}

function generateEntityHtml(tableName, schema, endpoints, isVirtual) {
  const displayName = formatTableName(tableName);
  const crud = endpoints ? (() => {
    const methods = new Set(endpoints.map(e => e.method));
    const ops = [];
    if (methods.has('POST')) ops.push('C');
    if (methods.has('GET')) ops.push('R');
    if (methods.has('PUT') || methods.has('PATCH')) ops.push('U');
    if (methods.has('DELETE')) ops.push('D');
    return ops.join('');
  })() : '';

  let html = `
    <div class="entity-card" id="entity-${tableName}">
      <div class="entity-header">
        <div class="entity-title-row">
          <h3 class="entity-name">${escapeHtml(displayName)}</h3>
          <div class="entity-badges">
            ${crud ? `<span class="badge badge-crud">${crud}</span>` : '<span class="badge badge-internal">Internal</span>'}
            ${isVirtual ? '<span class="badge badge-virtual">No Schema File</span>' : `<span class="badge badge-table">${escapeHtml(tableName)}</span>`}
          </div>
        </div>
        ${schema && schema.comment ? `<p class="entity-comment">${escapeHtml(schema.comment)}</p>` : ''}
      </div>`;

  // Endpoints section
  if (endpoints && endpoints.length > 0) {
    html += `
      <div class="entity-section">
        <h4 class="section-title">API Endpoints</h4>
        <div class="endpoints-list">`;

    for (const ep of endpoints) {
      html += `
          <div class="endpoint-row" style="border-left: 3px solid ${getMethodColor(ep.method)};">
            <span class="method-badge" style="background:${getMethodBg(ep.method)}; color:${getMethodColor(ep.method)};">${ep.method}</span>
            <code class="endpoint-path">${escapeHtml(ep.path)}</code>
            <span class="endpoint-desc">${escapeHtml(ep.desc)}</span>
          </div>`;
    }

    html += `
        </div>
      </div>`;
  }

  // Schema section
  if (schema && schema.columns) {
    const columns = Object.entries(schema.columns);
    html += `
      <div class="entity-section">
        <h4 class="section-title">Schema <span class="column-count">${columns.length} columns</span></h4>
        <div class="schema-table-wrapper">
          <table class="schema-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>`;

    for (const [colName, col] of columns) {
      const typeColor = getTypeBadgeColor(col.type);
      html += `
              <tr>
                <td class="col-name"><code>${escapeHtml(colName)}</code></td>
                <td><span class="type-badge" style="color:${typeColor}; background:${typeColor}15;">${escapeHtml(getTypeLabel(col.type))}</span></td>
                <td>${col.notNull ? '<span class="required-badge">Required</span>' : '<span class="nullable-text">Yes</span>'}</td>
                <td class="col-default">${col.default ? `<code>${escapeHtml(String(col.default))}</code>` : '<span class="null-text">-</span>'}</td>
                <td class="col-comment">${col.comment ? escapeHtml(col.comment) : ''}</td>
              </tr>`;
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>`;

    // Indexes section
    if (schema.indexes && schema.indexes.length > 0) {
      html += `
      <details class="indexes-section">
        <summary class="indexes-toggle">Indexes (${schema.indexes.length})</summary>
        <div class="indexes-list">`;

      for (const idx of schema.indexes) {
        html += `
          <div class="index-item">
            <code class="index-name">${escapeHtml(idx.name)}</code>
            <span class="index-meta">
              ${idx.unique ? '<span class="badge badge-unique">UNIQUE</span>' : ''}
              ${idx.using ? `<span class="badge badge-using">${escapeHtml(idx.using.toUpperCase())}</span>` : ''}
              <span class="index-cols">(${escapeHtml(idx.columns.join(', '))})</span>
            </span>
          </div>`;
      }

      html += `
        </div>
      </details>`;
    }
  }

  html += `
    </div>`;

  return html;
}

function generateHtml(schemas) {
  const now = new Date().toISOString().split('T')[0];

  // Build sidebar and content for each category
  let sidebarHtml = '';
  let contentHtml = '';
  let entityCount = 0;
  let schemaCount = Object.keys(schemas).length;

  for (const [catName, catConfig] of Object.entries(CATEGORIES)) {
    const catId = catName.toLowerCase().split(/[^a-z0-9]+/).join('-');

    // Get schemas in this category
    const catEntities = [];
    for (const tableName of catConfig.tables) {
      if (schemas[tableName]) {
        catEntities.push({ tableName, schema: schemas[tableName], endpoints: API_ENDPOINTS[tableName] || null, isVirtual: false });
      }
    }

    // Add virtual entities for this category
    for (const ve of VIRTUAL_ENTITIES) {
      if (ve.category === catName) {
        catEntities.push({ tableName: ve.tableName, schema: null, endpoints: ve.endpoints, isVirtual: true, description: ve.description });
      }
    }

    entityCount += catEntities.length;

    // Sidebar
    sidebarHtml += `
      <div class="sidebar-category">
        <a href="#cat-${catId}" class="sidebar-cat-link">${escapeHtml(catName)} <span class="sidebar-count">${catEntities.length}</span></a>
        <div class="sidebar-entities">`;

    for (const ent of catEntities) {
      const name = formatTableName(ent.tableName);
      const hasApi = ent.endpoints && ent.endpoints.length > 0;
      sidebarHtml += `
          <a href="#entity-${ent.tableName}" class="sidebar-entity-link${hasApi ? '' : ' internal'}">${escapeHtml(name)}</a>`;
    }

    sidebarHtml += `
        </div>
      </div>`;

    // Content
    contentHtml += `
    <section class="category-section" id="cat-${catId}">
      <div class="category-header">
        <h2 class="category-title">${escapeHtml(catName)}</h2>
        <p class="category-desc">${escapeHtml(catConfig.description)}</p>
        <span class="category-count">${catEntities.length} entities</span>
      </div>`;

    for (const ent of catEntities) {
      const schema = ent.schema || (ent.description ? { comment: ent.description } : null);
      contentHtml += generateEntityHtml(ent.tableName, schema, ent.endpoints, ent.isVirtual);
    }

    contentHtml += `
    </section>`;
  }

  // Count uncategorized schemas
  const categorizedTables = new Set();
  for (const catConfig of Object.values(CATEGORIES)) {
    for (const t of catConfig.tables) categorizedTables.add(t);
  }
  const uncategorized = Object.keys(schemas).filter(t => !categorizedTables.has(t));
  if (uncategorized.length > 0) {
    entityCount += uncategorized.length;
    sidebarHtml += `
      <div class="sidebar-category">
        <a href="#cat-uncategorized" class="sidebar-cat-link">Uncategorized <span class="sidebar-count">${uncategorized.length}</span></a>
        <div class="sidebar-entities">`;
    for (const tableName of uncategorized) {
      sidebarHtml += `
          <a href="#entity-${tableName}" class="sidebar-entity-link internal">${escapeHtml(formatTableName(tableName))}</a>`;
    }
    sidebarHtml += `
        </div>
      </div>`;

    contentHtml += `
    <section class="category-section" id="cat-uncategorized">
      <div class="category-header">
        <h2 class="category-title">Uncategorized</h2>
        <p class="category-desc">Schema files not yet assigned to a category.</p>
        <span class="category-count">${uncategorized.length} entities</span>
      </div>`;
    for (const tableName of uncategorized) {
      contentHtml += generateEntityHtml(tableName, schemas[tableName], API_ENDPOINTS[tableName] || null, false);
    }
    contentHtml += `
    </section>`;
  }

  const routeCount = Object.keys(API_ENDPOINTS).length + VIRTUAL_ENTITIES.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LANA AI - API & Schema Documentation</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #1e293b;
      --bg-hover: #334155;
      --bg-code: #0f172a;
      --border: #334155;
      --border-light: #475569;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --sidebar-width: 280px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    html { scroll-behavior: smooth; scroll-padding-top: 80px; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
    }

    /* Top Bar */
    .topbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      height: 64px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; padding: 0 24px;
      backdrop-filter: blur(12px);
    }
    .topbar-logo {
      font-size: 20px; font-weight: 700; color: var(--accent);
      letter-spacing: -0.5px;
    }
    .topbar-logo span { color: var(--text-primary); font-weight: 400; }
    .topbar-meta {
      margin-left: auto; display: flex; gap: 16px; align-items: center;
      font-size: 13px; color: var(--text-muted);
    }
    .topbar-search {
      margin-left: 32px; flex: 1; max-width: 400px;
    }
    .topbar-search input {
      width: 100%; padding: 8px 16px; border-radius: 8px;
      border: 1px solid var(--border); background: var(--bg-primary);
      color: var(--text-primary); font-size: 14px; outline: none;
    }
    .topbar-search input:focus { border-color: var(--accent); }
    .topbar-search input::placeholder { color: var(--text-muted); }

    /* Sidebar */
    .sidebar {
      position: fixed; top: 64px; left: 0; bottom: 0;
      width: var(--sidebar-width); overflow-y: auto;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      padding: 16px 0;
    }
    .sidebar::-webkit-scrollbar { width: 4px; }
    .sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    .sidebar-stats {
      padding: 12px 20px 16px; border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }
    .sidebar-stats h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 8px; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-item { text-align: center; }
    .stat-value { font-size: 22px; font-weight: 700; color: var(--accent); }
    .stat-label { font-size: 11px; color: var(--text-muted); }

    .sidebar-category { margin-bottom: 4px; }
    .sidebar-cat-link {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 20px; color: var(--text-secondary); font-size: 13px;
      font-weight: 600; text-decoration: none;
      transition: background 0.15s;
    }
    .sidebar-cat-link:hover { background: var(--bg-hover); color: var(--text-primary); }
    .sidebar-count {
      background: var(--bg-primary); color: var(--text-muted);
      font-size: 11px; padding: 2px 8px; border-radius: 10px;
      font-weight: 500;
    }
    .sidebar-entities { display: none; }
    .sidebar-category:hover .sidebar-entities,
    .sidebar-category.open .sidebar-entities { display: block; }
    .sidebar-entity-link {
      display: block; padding: 4px 20px 4px 36px;
      color: var(--text-muted); font-size: 12px;
      text-decoration: none; transition: all 0.15s;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sidebar-entity-link:hover { color: var(--accent); background: var(--bg-hover); }
    .sidebar-entity-link.internal { color: var(--text-muted); opacity: 0.6; }
    .sidebar-entity-link.internal:hover { opacity: 1; }

    /* Main Content */
    .main {
      margin-left: var(--sidebar-width); margin-top: 64px;
      padding: 32px; max-width: 1100px;
    }

    /* Hero */
    .hero {
      padding: 40px 0 32px; border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
    }
    .hero h1 { font-size: 32px; font-weight: 700; margin-bottom: 8px; }
    .hero p { color: var(--text-secondary); font-size: 16px; max-width: 600px; }
    .hero-badges { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .hero-badge {
      padding: 6px 14px; border-radius: 20px; font-size: 13px;
      background: var(--bg-secondary); border: 1px solid var(--border);
      color: var(--text-secondary);
    }
    .hero-badge strong { color: var(--accent); }

    /* Category */
    .category-section { margin-bottom: 48px; }
    .category-header {
      padding: 20px 0 16px; border-bottom: 1px solid var(--border);
      margin-bottom: 24px; position: relative;
    }
    .category-title { font-size: 24px; font-weight: 700; }
    .category-desc { color: var(--text-secondary); font-size: 14px; margin-top: 4px; }
    .category-count {
      position: absolute; top: 20px; right: 0;
      font-size: 12px; color: var(--text-muted);
      background: var(--bg-secondary); padding: 4px 12px; border-radius: 12px;
      border: 1px solid var(--border);
    }

    /* Entity Card */
    .entity-card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 12px; margin-bottom: 20px; overflow: hidden;
      transition: border-color 0.2s;
    }
    .entity-card:hover { border-color: var(--border-light); }
    .entity-card:target { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

    .entity-header { padding: 20px 24px 16px; }
    .entity-title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .entity-name { font-size: 18px; font-weight: 600; }
    .entity-badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .entity-comment { color: var(--text-secondary); font-size: 13px; margin-top: 8px; }

    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 6px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
    }
    .badge-crud { background: rgba(34,197,94,0.15); color: #22c55e; }
    .badge-table { background: var(--bg-primary); color: var(--text-muted); font-family: monospace; font-weight: 400; }
    .badge-internal { background: rgba(100,116,139,0.2); color: #94a3b8; }
    .badge-virtual { background: rgba(249,115,22,0.15); color: #f97316; }
    .badge-unique { background: rgba(139,92,246,0.15); color: #a78bfa; }
    .badge-using { background: rgba(6,182,212,0.15); color: #22d3ee; }

    /* Entity Sections */
    .entity-section { padding: 0 24px 20px; }
    .section-title {
      font-size: 13px; font-weight: 600; color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;
      display: flex; align-items: center; gap: 8px;
    }
    .column-count {
      font-size: 11px; color: var(--text-muted); font-weight: 400;
      text-transform: none; letter-spacing: 0;
    }

    /* Endpoints */
    .endpoints-list { display: flex; flex-direction: column; gap: 6px; }
    .endpoint-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: var(--bg-primary);
      border-radius: 6px; font-size: 13px;
    }
    .method-badge {
      font-size: 11px; font-weight: 700; padding: 2px 8px;
      border-radius: 4px; min-width: 52px; text-align: center;
      font-family: monospace;
    }
    .endpoint-path {
      font-size: 13px; color: var(--text-primary);
      background: none; white-space: nowrap;
    }
    .endpoint-desc {
      color: var(--text-muted); font-size: 12px;
      margin-left: auto; white-space: nowrap;
    }

    /* Schema Table */
    .schema-table-wrapper { overflow-x: auto; }
    .schema-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
    }
    .schema-table th {
      text-align: left; padding: 8px 12px; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--text-muted); border-bottom: 1px solid var(--border);
      font-weight: 600; background: var(--bg-primary);
    }
    .schema-table td {
      padding: 8px 12px; border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .schema-table tr:last-child td { border-bottom: none; }
    .schema-table tr:hover td { background: rgba(59,130,246,0.03); }

    .col-name code {
      font-size: 13px; color: var(--text-primary);
      background: var(--bg-primary); padding: 2px 6px; border-radius: 4px;
    }
    .type-badge {
      font-size: 11px; font-weight: 600; padding: 2px 8px;
      border-radius: 4px; font-family: monospace;
      white-space: nowrap;
    }
    .required-badge {
      font-size: 10px; color: #ef4444; background: rgba(239,68,68,0.1);
      padding: 1px 6px; border-radius: 4px;
    }
    .nullable-text { color: var(--text-muted); font-size: 12px; }
    .col-default code {
      font-size: 11px; color: var(--text-muted);
      background: var(--bg-primary); padding: 1px 4px; border-radius: 3px;
      word-break: break-all;
    }
    .col-comment { color: var(--text-secondary); font-size: 12px; max-width: 300px; }
    .null-text { color: var(--text-muted); }

    /* Indexes */
    .indexes-section { padding: 0 24px 20px; }
    .indexes-toggle {
      font-size: 12px; color: var(--text-muted); cursor: pointer;
      padding: 8px 0; user-select: none;
    }
    .indexes-toggle:hover { color: var(--text-secondary); }
    .indexes-list { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
    .index-item {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 4px 8px; background: var(--bg-primary); border-radius: 4px;
      font-size: 12px;
    }
    .index-name { color: var(--text-secondary); font-size: 11px; }
    .index-meta { display: flex; align-items: center; gap: 6px; }
    .index-cols { color: var(--text-muted); font-size: 11px; }

    /* Search highlight */
    .hidden { display: none !important; }

    /* Responsive */
    @media (max-width: 900px) {
      .sidebar { display: none; }
      .main { margin-left: 0; }
    }

    /* Print */
    @media print {
      .topbar, .sidebar { display: none; }
      .main { margin-left: 0; margin-top: 0; }
      .entity-card { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <!-- Top Bar -->
  <header class="topbar">
    <div class="topbar-logo">LANA<span> AI</span></div>
    <div class="topbar-search">
      <input type="text" id="searchInput" placeholder="Search entities, tables, columns..." autocomplete="off" />
    </div>
    <div class="topbar-meta">
      <span>v2.0.0</span>
      <span>Generated: ${now}</span>
    </div>
  </header>

  <!-- Sidebar -->
  <nav class="sidebar">
    <div class="sidebar-stats">
      <h3>Platform Overview</h3>
      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-value">${entityCount}</div>
          <div class="stat-label">Total Entities</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${schemaCount}</div>
          <div class="stat-label">DB Tables</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${routeCount}</div>
          <div class="stat-label">With API</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${Object.keys(CATEGORIES).length}</div>
          <div class="stat-label">Categories</div>
        </div>
      </div>
    </div>
    ${sidebarHtml}
  </nav>

  <!-- Main Content -->
  <main class="main">
    <div class="hero">
      <h1>API & Schema Documentation</h1>
      <p>Complete reference for all ${entityCount} data entities in the LANA AI platform, including database schemas, API endpoints, and field definitions.</p>
      <div class="hero-badges">
        <span class="hero-badge"><strong>${schemaCount}</strong> Database Tables</span>
        <span class="hero-badge"><strong>${routeCount}</strong> API Entities</span>
        <span class="hero-badge">PostgreSQL + pgvector</span>
        <span class="hero-badge">JWT Authentication</span>
        <span class="hero-badge">Matter-Scoped Isolation</span>
      </div>
    </div>

    ${contentHtml}
  </main>

  <script>
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    const entityCards = document.querySelectorAll('.entity-card');
    const categorySections = document.querySelectorAll('.category-section');

    searchInput.addEventListener('input', function() {
      const query = this.value.toLowerCase().trim();

      if (!query) {
        entityCards.forEach(card => card.classList.remove('hidden'));
        categorySections.forEach(section => section.classList.remove('hidden'));
        return;
      }

      entityCards.forEach(card => {
        const text = card.textContent.toLowerCase();
        const id = card.id.toLowerCase();
        const match = text.indexOf(query) !== -1 || id.indexOf(query) !== -1;
        card.classList.toggle('hidden', !match);
      });

      // Hide empty categories
      categorySections.forEach(section => {
        const visibleCards = section.querySelectorAll('.entity-card:not(.hidden)');
        section.classList.toggle('hidden', visibleCards.length === 0);
      });
    });

    // Sidebar category toggle
    document.querySelectorAll('.sidebar-cat-link').forEach(link => {
      link.addEventListener('click', function(e) {
        const cat = this.closest('.sidebar-category');
        cat.classList.toggle('open');
      });
    });

    // Keyboard shortcut: Ctrl+K or / to focus search
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && document.activeElement !== searchInput)) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      if (e.key === 'Escape') {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        searchInput.blur();
      }
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('LANA AI - API Documentation Generator');
console.log('=====================================\n');

console.log(`Reading schemas from: ${SCHEMAS_DIR}`);
const schemas = readSchemas();
console.log(`Loaded ${Object.keys(schemas).length} schema files.\n`);

console.log('Generating HTML documentation...');
const html = generateHtml(schemas);

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_FILE, html, 'utf-8');
console.log(`\nDocumentation written to: ${OUTPUT_FILE}`);
console.log(`File size: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
console.log('\nDone!');

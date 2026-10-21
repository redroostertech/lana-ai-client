/**
 * Data Visualization — Admin page controller.
 *
 * Displays MCP view data in one server-paged lex-table
 * (docs/TABLE-STANDARD.md): a View select, toolbar search and Sort by,
 * header filters on every column and a record drawer with connected data.
 *
 * @requires api.js          - window.api
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-toast.js    - Lex.Toast.error
 * @requires lex-table.js    - server paging (setServerData)
 * @requires admin-table-kit.js - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range filter bounds
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // Lex aliases
  // ═══════════════════════════════════════════════════════════════

  var fmtDateTime = Lex.Utils.formatDateTime;

  // ═══════════════════════════════════════════════════════════════
  // View configuration (columns, labels, sort defaults per MCP view)
  // ═══════════════════════════════════════════════════════════════

  var VIEW_CONFIG = {
    // ── Original 9 views ──
    mcp_client_matters: {
      columns: 'matter_name,status,client_name,matter_type,case_number,matter_age_days,is_active_matter,created_at',
      labels:  'Name,Status,Client,Type,Case #,Age (Days),Active,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', status: 'pill', is_active_matter: 'bool' }
    },
    mcp_documents: {
      columns: 'filename,document_type,file_size_mb,status,document_size_category,document_age_days,is_processed,has_chunks,created_at',
      labels:  'Filename,Type,Size (MB),Status,Size Cat,Age (Days),Processed,Has Chunks,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', status: 'pill', is_processed: 'bool', has_chunks: 'bool' }
    },
    mcp_document_chunks: {
      columns: 'document_id,chunk_index,chunk_type,chunk_length,word_count,page_number,created_at',
      labels:  'Document ID,Chunk #,Type,Length,Words,Page,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime' }
    },
    mcp_tasks: {
      columns: 'title,status,priority,is_overdue,due_date,assigned_to_name,task_type,created_at',
      labels:  'Title,Status,Priority,Overdue,Due Date,Assigned To,Type,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', due_date: 'date', is_overdue: 'bool', status: 'pill', priority: 'pill' }
    },
    mcp_conversations: {
      columns: 'title,context_type,thread_type,message_count,page_scope,is_archived,last_activity',
      labels:  'Title,Context,Type,Messages,Page Scope,Archived,Last Activity',
      sortBy:  'last_activity',
      format:  { last_activity: 'datetime', is_archived: 'bool' }
    },
    mcp_messages: {
      columns: 'thread_id,role,content,is_user_message,is_assistant_message,created_at',
      labels:  'Thread,Role,Content,User Msg,AI Msg,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', is_user_message: 'bool', is_assistant_message: 'bool' }
    },
    mcp_connector_data: {
      columns: 'entity_type,external_id,client_name,practice_area,status,monetary_value,days_since_sync,synced_at',
      labels:  'Entity Type,External ID,Client,Practice Area,Status,Value,Days Since Sync,Synced',
      sortBy:  'synced_at',
      format:  { synced_at: 'datetime', status: 'pill' }
    },
    mcp_integration_sources: {
      columns: 'source_name,connector_name,connector_category,sync_status,auth_status,is_active,total_records_synced,last_sync_at',
      labels:  'Source,Connector,Category,Sync,Auth,Active,Records,Last Sync',
      sortBy:  'created_at',
      format:  { last_sync_at: 'datetime', sync_status: 'pill', auth_status: 'pill', is_active: 'bool' }
    },
    mcp_connector_sync_logs: {
      columns: 'connector_id,sync_type,sync_status,records_processed,records_created,records_failed,duration_seconds,started_at',
      labels:  'Connector,Type,Status,Processed,Created,Failed,Duration (s),Started',
      sortBy:  'started_at',
      format:  { started_at: 'datetime', sync_status: 'pill' }
    },
    // ── Cat 1: User Management ──
    mcp_users: {
      columns: 'display_name,email,is_active,last_login,account_age_days,is_recently_active,created_at',
      labels:  'Name,Email,Active,Last Login,Age (Days),Recent,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', last_login: 'datetime', is_active: 'bool', is_recently_active: 'bool' }
    },
    mcp_user_roles: {
      columns: 'user_id,role_id,granted_by,granted_at',
      labels:  'User,Role,Granted By,Granted',
      sortBy:  'granted_at',
      format:  { granted_at: 'datetime' }
    },
    mcp_sessions: {
      columns: 'user_id,is_active,is_valid,expires_at,hours_until_expiry,created_at',
      labels:  'User,Active,Valid,Expires,Hours Left,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', expires_at: 'datetime', is_active: 'bool', is_valid: 'bool' }
    },
    mcp_api_tokens: {
      columns: 'token_name,user_id,scopes,is_active,is_expired,last_used_at,expires_at,created_at',
      labels:  'Name,User,Scopes,Active,Expired,Last Used,Expires,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', expires_at: 'datetime', last_used_at: 'datetime', is_active: 'bool', is_expired: 'bool' }
    },
    // ── Cat 2: Organization & Access ──
    mcp_organizations: {
      columns: 'name,active_user_count,matter_count,created_at,updated_at',
      labels:  'Name,Active Users,Matters,Created,Updated',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', updated_at: 'datetime' }
    },
    mcp_roles: {
      columns: 'name,display_name,description,level,can_access_all_matters,is_active,created_at',
      labels:  'Name,Display Name,Description,Level,All Matters,Active,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', can_access_all_matters: 'bool', is_active: 'bool' }
    },
    mcp_groups: {
      columns: 'name,description,member_count,is_active,created_by,created_at',
      labels:  'Name,Description,Members,Active,Created By,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', is_active: 'bool' }
    },
    mcp_group_members: {
      columns: 'group_id,user_id,role,added_by,added_at',
      labels:  'Group,User,Role,Added By,Added',
      sortBy:  'added_at',
      format:  { added_at: 'datetime' }
    },
    mcp_organization_invitations: {
      columns: 'email,first_name,last_name,role_name,status,is_expired,invited_by,created_at,expires_at',
      labels:  'Email,First,Last,Role,Status,Expired,Invited By,Created,Expires',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', expires_at: 'datetime', status: 'pill', is_expired: 'bool' }
    },
    // ── Cat 3: Matter Management ──
    mcp_matter_access_permissions: {
      columns: 'user_id,matter_id,permissions,granted_by,granted_at,is_active',
      labels:  'User,Matter,Permissions,Granted By,Granted,Active',
      sortBy:  'granted_at',
      format:  { granted_at: 'datetime', is_active: 'bool' }
    },
    mcp_comments: {
      columns: 'content,comment_type,object_type,object_id,author_id,thread_depth,is_pinned,is_edited,content_length,created_at',
      labels:  'Content,Type,Object Type,Object,Author,Depth,Pinned,Edited,Length,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', comment_type: 'pill', is_pinned: 'bool', is_edited: 'bool' }
    },
    mcp_notes: {
      columns: 'note_text,note_type,created_by_name,is_private,source,note_length,created_at',
      labels:  'Note,Type,Author,Private,Source,Length,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', note_type: 'pill', is_private: 'bool' }
    },
    mcp_activity_feed: {
      columns: 'event_type,event_category,resource_type,resource_name,display_message,activity_date,is_visible_in_feed,created_at',
      labels:  'Event,Category,Resource Type,Resource,Message,Activity Date,Visible,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', activity_date: 'date', event_type: 'pill', event_category: 'pill', is_visible_in_feed: 'bool' }
    },
    // ── Cat 4: Contacts & CRM ──
    mcp_contacts: {
      columns: 'display_name,first_name,last_name,company_name,occupation,source,is_active,contact_age_days,created_at',
      labels:  'Name,First,Last,Company,Occupation,Source,Active,Age (Days),Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', is_active: 'bool', source: 'pill' }
    },
    mcp_matter_contacts: {
      columns: 'matter_id,contact_id,role,is_primary,is_active,notes,added_at',
      labels:  'Matter,Contact,Role,Primary,Active,Notes,Added',
      sortBy:  'added_at',
      format:  { added_at: 'datetime', is_primary: 'bool', is_active: 'bool' }
    },
    mcp_entity_links: {
      columns: 'source_entity_type,source_entity_id,target_entity_type,target_entity_id,link_type,created_by,created_at',
      labels:  'Source Type,Source ID,Target Type,Target ID,Link Type,Created By,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime' }
    },
    mcp_opportunities: {
      columns: 'name,status,stage,amount,currency,probability,expected_close_date,is_closed,opportunity_age_days,created_at',
      labels:  'Name,Status,Stage,Amount,Currency,Probability,Expected Close,Closed,Age (Days),Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', expected_close_date: 'date', status: 'pill', stage: 'pill', is_closed: 'bool' }
    },
    mcp_matter_participants: {
      columns: 'matter_id,contact_id,participant_type,role,is_primary,is_active,start_date,end_date,created_at',
      labels:  'Matter,Contact,Type,Role,Primary,Active,Start,End,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', start_date: 'date', end_date: 'date', is_primary: 'bool', is_active: 'bool', participant_type: 'pill' }
    },
    // ── Cat 5: Documents ──
    mcp_generated_documents: {
      columns: 'title,document_type,content_length,conversation_id,template_id,user_id,created_at',
      labels:  'Title,Type,Length,Conversation,Template,User,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', document_type: 'pill' }
    },
    // ── Cat 6: Conversations & AI ──
    mcp_chat_sessions: {
      columns: 'thread_id,created_by,matter_id,scope_locked,created_at,updated_at',
      labels:  'Thread,Created By,Matter,Scope Locked,Created,Updated',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', updated_at: 'datetime', scope_locked: 'bool' }
    },
    mcp_conversation_memory: {
      columns: 'conversation_id,matter_id,memory_type,content,confidence,is_correction,use_count,is_active,extracted_at,last_used_at',
      labels:  'Conversation,Matter,Type,Content,Confidence,Correction,Uses,Active,Extracted,Last Used',
      sortBy:  'extracted_at',
      format:  { extracted_at: 'datetime', last_used_at: 'datetime', memory_type: 'pill', is_correction: 'bool', is_active: 'bool' }
    },
    mcp_response_feedback: {
      columns: 'conversation_id,message_id,rating,feedback_text,rag_used,rag_chunks_used,triggered_memory_update,created_at',
      labels:  'Conversation,Message,Rating,Feedback,RAG Used,RAG Chunks,Memory Update,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', rating: 'pill', rag_used: 'bool', triggered_memory_update: 'bool' }
    },
    // ── Cat 7: Financial ──
    mcp_time_entries: {
      columns: 'time_entry_id,matter_id,duration_minutes,duration_hours,is_billable,source,created_by,created_at',
      labels:  'Entry ID,Matter,Minutes,Hours,Billable,Source,Created By,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', is_billable: 'bool', source: 'pill' }
    },
    mcp_invoices: {
      columns: 'invoice_number,matter_id,total_amount,paid_amount,balance_due,status,is_overdue,due_date,created_at',
      labels:  'Invoice #,Matter,Total,Paid,Balance Due,Status,Overdue,Due Date,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', due_date: 'date', status: 'pill', is_overdue: 'bool' }
    },
    mcp_payments: {
      columns: 'payment_id,matter_id,invoice_id,amount,payment_method,payment_date,reference_number,created_at',
      labels:  'Payment ID,Matter,Invoice,Amount,Method,Date,Reference,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', payment_date: 'date', payment_method: 'pill' }
    },
    mcp_expense_records: {
      columns: 'expense_type,matter_id,amount,currency,description,billable,billed,expense_date,created_at',
      labels:  'Type,Matter,Amount,Currency,Description,Billable,Billed,Date,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', expense_date: 'date', billable: 'bool', billed: 'bool', expense_type: 'pill' }
    },
    // ── Cat 8: Work Management ──
    mcp_workflows: {
      columns: 'name,description,trigger_type,status,created_by_id,created_at,updated_at',
      labels:  'Name,Description,Trigger,Status,Created By,Created,Updated',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', updated_at: 'datetime', trigger_type: 'pill', status: 'pill' }
    },
    mcp_calendar_events: {
      columns: 'title,event_type,start_time,end_time,duration_minutes,is_all_day,location,status,is_past,is_upcoming_week,created_at',
      labels:  'Title,Type,Start,End,Duration (min),All Day,Location,Status,Past,Upcoming,Created',
      sortBy:  'start_time',
      format:  { created_at: 'datetime', start_time: 'datetime', end_time: 'datetime', is_all_day: 'bool', is_past: 'bool', is_upcoming_week: 'bool', status: 'pill', event_type: 'pill' }
    },
    mcp_emails: {
      columns: 'subject,from_address,from_name,has_attachments,attachment_count,is_read,is_starred,thread_id,sent_date,received_date,source,created_at',
      labels:  'Subject,From,Name,Attachments,Att. Count,Read,Starred,Thread,Sent,Received,Source,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', sent_date: 'datetime', received_date: 'datetime', has_attachments: 'bool', is_read: 'bool', is_starred: 'bool', source: 'pill' }
    },
    // ── Cat 9: Connectors ──
    mcp_connector_schemas: {
      columns: 'name,connector_id,description,version,category,is_active,is_custom,created_at',
      labels:  'Name,Connector ID,Description,Version,Category,Active,Custom,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', is_active: 'bool', is_custom: 'bool', category: 'pill' }
    },
    // ── Cat 10: Analytics ──
    mcp_module_definitions: {
      columns: 'name,module_key,category,tier,is_template,is_active,version,created_at',
      labels:  'Name,Key,Category,Tier,Template,Active,Version,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', is_template: 'bool', is_active: 'bool', tier: 'pill', category: 'pill' }
    },
    mcp_module_targets: {
      columns: 'metric_key,target_value,target_type,target_period,green_threshold,yellow_threshold,red_threshold,set_at',
      labels:  'Metric,Target,Type,Period,Green,Yellow,Red,Set At',
      sortBy:  'set_at',
      format:  { set_at: 'datetime', target_type: 'pill', target_period: 'pill' }
    },
    mcp_query_audit_logs: {
      columns: 'natural_language_query,status,tier,operation_type,execution_time_ms,result_count,validation_passed,scope_injected,created_at',
      labels:  'Query,Status,Tier,Operation,Time (ms),Results,Validated,Scoped,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', status: 'pill', tier: 'pill', validation_passed: 'bool', scope_injected: 'bool' }
    },
    // ── Cat 11: System ──
    mcp_audit_logs: {
      columns: 'event_type,action,resource_type,resource_id,user_id,created_at',
      labels:  'Event,Action,Resource Type,Resource,User,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', event_type: 'pill', action: 'pill' }
    },
    mcp_notifications: {
      columns: 'title,type,message,priority,resource_type,is_read,user_id,created_at',
      labels:  'Title,Type,Message,Priority,Resource,Read,User,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', type: 'pill', priority: 'pill', is_read: 'bool' }
    },
    mcp_heartbeat_runs: {
      columns: 'triggered_by,status,duration_ms,llm_skipped,started_at,completed_at,created_at',
      labels:  'Trigger,Status,Duration (ms),LLM Skipped,Started,Completed,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', started_at: 'datetime', completed_at: 'datetime', status: 'pill', llm_skipped: 'bool' }
    },
    mcp_alert_rules: {
      columns: 'name,data_source,entity_type,severity,is_active,check_interval_minutes,last_triggered_at,created_at',
      labels:  'Name,Data Source,Entity,Severity,Active,Interval (min),Last Triggered,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', last_triggered_at: 'datetime', severity: 'pill', is_active: 'bool' }
    },
    mcp_alert_instances: {
      columns: 'title,severity,status,message,acknowledged_by,acknowledged_at,resolved_at,created_at',
      labels:  'Title,Severity,Status,Message,Ack By,Ack At,Resolved,Created',
      sortBy:  'created_at',
      format:  { created_at: 'datetime', acknowledged_at: 'datetime', resolved_at: 'datetime', severity: 'pill', status: 'pill' }
    }
  };

  /**
   * Tab → viewName mapping. Organized by category.
   * Sub-views are handled by segmented toggle.
   */
  var TAB_VIEW_MAP = {
    // Core
    matters:       'mcp_client_matters',
    documents:     'mcp_documents',
    tasks:         'mcp_tasks',
    conversations: 'mcp_conversations',
    // User & Org
    users:         'mcp_users',
    roles:         'mcp_roles',
    groups:        'mcp_groups',
    organizations: 'mcp_organizations',
    invitations:   'mcp_organization_invitations',
    // Matter Management
    comments:      'mcp_comments',
    notes:         'mcp_notes',
    activity:      'mcp_activity_feed',
    permissions:   'mcp_matter_access_permissions',
    // Contacts & CRM
    contacts:      'mcp_contacts',
    opportunities: 'mcp_opportunities',
    participants:  'mcp_matter_participants',
    // Financial
    time_entries:  'mcp_time_entries',
    invoices:      'mcp_invoices',
    payments:      'mcp_payments',
    expenses:      'mcp_expense_records',
    // Work Management
    workflows:     'mcp_workflows',
    calendar:      'mcp_calendar_events',
    emails:        'mcp_emails',
    gen_docs:      'mcp_generated_documents',
    // Connectors
    connectors:    'mcp_connector_data',
    integrations:  'mcp_integration_sources',
    sync_logs:     'mcp_connector_sync_logs',
    schemas:       'mcp_connector_schemas',
    // Analytics
    modules:       'mcp_module_definitions',
    targets:       'mcp_module_targets',
    query_audit:   'mcp_query_audit_logs',
    // System
    audit_logs:    'mcp_audit_logs',
    notifications: 'mcp_notifications',
    heartbeat:     'mcp_heartbeat_runs',
    alerts:        'mcp_alert_rules',
    // AI
    chat_sessions: 'mcp_chat_sessions',
    memory:        'mcp_conversation_memory',
    feedback:      'mcp_response_feedback'
  };

  /** Sub-view mapping for tabs with a toggle. */
  var SUB_VIEW_MAP = {
    documents:     { primary: 'mcp_documents', detail: 'mcp_document_chunks', primaryLabel: 'Documents', detailLabel: 'Chunks' },
    conversations: { primary: 'mcp_conversations', detail: 'mcp_messages', primaryLabel: 'Conversations', detailLabel: 'Messages' },
    users:         { primary: 'mcp_users', detail: 'mcp_user_roles', primaryLabel: 'Users', detailLabel: 'User Roles' },
    groups:        { primary: 'mcp_groups', detail: 'mcp_group_members', primaryLabel: 'Groups', detailLabel: 'Members' },
    contacts:      { primary: 'mcp_contacts', detail: 'mcp_matter_contacts', primaryLabel: 'Contacts', detailLabel: 'Matter Contacts' },
    connectors:    { primary: 'mcp_connector_data', detail: 'mcp_entity_links', primaryLabel: 'Connector Data', detailLabel: 'Entity Links' },
    integrations:  { primary: 'mcp_integration_sources', detail: 'mcp_connector_sync_logs', primaryLabel: 'Integrations', detailLabel: 'Sync Logs' },
    alerts:        { primary: 'mcp_alert_rules', detail: 'mcp_alert_instances', primaryLabel: 'Alert Rules', detailLabel: 'Alert Instances' },
    modules:       { primary: 'mcp_module_definitions', detail: 'mcp_module_targets', primaryLabel: 'Modules', detailLabel: 'Targets' }
  };

  // ═══════════════════════════════════════════════════════════════
  // Module-level state
  // ═══════════════════════════════════════════════════════════════

  var _gen         = 0;
  var _currentTab  = 'matters';
  var _subViewMode = 'primary'; // 'primary' or 'detail'
  var _availableViews = [];     // populated from /api/v1/mcp-data/views
  var _searchTerm  = '';
  var _toolbar     = null;
  var _tabLabels   = {};        // tab id -> label, for the section heading
  var _connectedRows = {};      // connected data rows keyed by view name
  // _chatEl / _threadsEl removed — managed by the global LANA dock.

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function el(id) { return document.getElementById(id); }

  /**
   * Get the effective viewName for the current tab + sub-view state.
   */
  function _getEffectiveView() {
    var sub = SUB_VIEW_MAP[_currentTab];
    if (sub && _subViewMode === 'detail') {
      return sub.detail;
    }
    return TAB_VIEW_MAP[_currentTab] || 'mcp_client_matters';
  }

  /**
   * Check if a viewName is available (tier-allowed).
   */
  function _isViewAvailable(viewName) {
    for (var i = 0; i < _availableViews.length; i++) {
      if (_availableViews[i].name === viewName) return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // Entry point
  // ═══════════════════════════════════════════════════════════════

  function init() {
    _fetchAvailableViews();
  }

  // ═══════════════════════════════════════════════════════════════
  // Fetch available views (tier-based), then build UI
  // ═══════════════════════════════════════════════════════════════

  function _fetchAvailableViews() {
    api.get('/api/v1/mcp-data/views')
      .then(function (result) {
        _availableViews = (result && result.data) || [];
        _setupTabs();
        _wireTable();
        _wireRefresh();
        _applyView();
      })
      .catch(function (err) {
        console.error('[DataViz] Failed to fetch views:', err);
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          Lex.Toast.error('Failed to load data views');
        }
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // View selector (grouped dropdown)
  // ═══════════════════════════════════════════════════════════════

  function _setupTabs() {
    var select = el('dataVizViewSelect');
    if (!select) return;

    // Define all views grouped by category
    var viewDefs = [
      // Core
      { id: 'matters',       label: 'Matters',         group: 'Core' },
      { id: 'documents',     label: 'Documents',       group: 'Core' },
      { id: 'tasks',         label: 'Tasks',           group: 'Core' },
      { id: 'conversations', label: 'Conversations',   group: 'Core' },
      // User & Org
      { id: 'users',         label: 'Users',           group: 'Users & Organization' },
      { id: 'roles',         label: 'Roles',           group: 'Users & Organization' },
      { id: 'groups',        label: 'Groups',          group: 'Users & Organization' },
      { id: 'organizations', label: 'Organizations',   group: 'Users & Organization' },
      { id: 'invitations',   label: 'Invitations',     group: 'Users & Organization' },
      // Matter Management
      { id: 'comments',      label: 'Comments',        group: 'Matter Management' },
      { id: 'notes',         label: 'Notes',           group: 'Matter Management' },
      { id: 'activity',      label: 'Activity Feed',   group: 'Matter Management' },
      { id: 'permissions',   label: 'Access Permissions', group: 'Matter Management' },
      // Contacts & CRM
      { id: 'contacts',      label: 'Contacts',        group: 'Contacts & CRM' },
      { id: 'opportunities', label: 'Opportunities',   group: 'Contacts & CRM' },
      { id: 'participants',  label: 'Participants',    group: 'Contacts & CRM' },
      // Financial
      { id: 'time_entries',  label: 'Time Entries',    group: 'Financial' },
      { id: 'invoices',      label: 'Invoices',        group: 'Financial' },
      { id: 'payments',      label: 'Payments',        group: 'Financial' },
      { id: 'expenses',      label: 'Expenses',        group: 'Financial' },
      // Work Management
      { id: 'workflows',     label: 'Workflows',       group: 'Work Management' },
      { id: 'calendar',      label: 'Calendar Events', group: 'Work Management' },
      { id: 'emails',        label: 'Emails',          group: 'Work Management' },
      { id: 'gen_docs',      label: 'Generated Docs',  group: 'Work Management' },
      // Connectors
      { id: 'connectors',    label: 'Connector Data',  group: 'Connectors' },
      { id: 'integrations',  label: 'Integrations',    group: 'Connectors' },
      { id: 'schemas',       label: 'Connector Schemas', group: 'Connectors' },
      // Analytics
      { id: 'modules',       label: 'Module Definitions', group: 'Analytics' },
      { id: 'query_audit',   label: 'Query Audit Logs',   group: 'Analytics' },
      // System
      { id: 'audit_logs',    label: 'Audit Logs',      group: 'System' },
      { id: 'notifications', label: 'Notifications',   group: 'System' },
      { id: 'heartbeat',     label: 'Heartbeat Runs',  group: 'System' },
      { id: 'alerts',        label: 'Alert Rules',     group: 'System' },
      // AI
      { id: 'chat_sessions', label: 'Chat Sessions',   group: 'Conversations & AI' },
      { id: 'memory',        label: 'Conversation Memory', group: 'Conversations & AI' },
      { id: 'feedback',      label: 'Response Feedback',   group: 'Conversations & AI' }
    ];

    // Filter to only tier-available views, build lex-select options
    var options = [];
    for (var i = 0; i < viewDefs.length; i++) {
      var def = viewDefs[i];
      var viewName = TAB_VIEW_MAP[def.id];
      if (_isViewAvailable(viewName)) {
        _tabLabels[def.id] = def.label;
        options.push({ value: def.id, label: def.label, group: def.group });
      }
    }

    if (options.length === 0) {
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.error('No data views available for current tier');
      }
      return;
    }

    // Set default
    _currentTab = options[0].value;
    select.setAttribute('options', JSON.stringify(options));
    select.setAttribute('value', _currentTab);

    // Listen for selection change
    select.addEventListener('lex-change', function (e) {
      var val = e.detail && e.detail.value;
      if (val && val !== _currentTab) {
        _currentTab = val;
        _subViewMode = 'primary';
        _updateSubViewToggle();
        _applyView();
      }
    });

    _updateSubViewToggle();
  }

  /**
   * Show/hide the sub-view segmented toggle based on current tab.
   */
  function _updateSubViewToggle() {
    var toggleWrap = el('subViewToggle');
    var segmented = el('subViewSegmented');
    if (!toggleWrap || !segmented) return;

    var sub = SUB_VIEW_MAP[_currentTab];
    if (!sub) {
      toggleWrap.style.display = 'none';
      return;
    }

    // Only show if both views are available
    if (!_isViewAvailable(sub.primary) || !_isViewAvailable(sub.detail)) {
      toggleWrap.style.display = 'none';
      return;
    }

    toggleWrap.style.display = 'block';

    var options = [
      { value: 'primary', label: sub.primaryLabel },
      { value: 'detail',  label: sub.detailLabel }
    ];

    if (typeof segmented.setOptions === 'function') {
      segmented.setOptions(options);
    } else {
      segmented.setAttribute('options', JSON.stringify(options));
    }

    if (typeof segmented.setValue === 'function') {
      segmented.setValue(_subViewMode);
    } else {
      segmented.setAttribute('value', _subViewMode);
    }

    // Wire change (only once)
    if (!segmented._dataVizWired) {
      segmented._dataVizWired = true;
      segmented.addEventListener('lex-change', function (e) {
        var val = e.detail && (e.detail.value || e.detail);
        if (typeof val === 'string' && val !== _subViewMode) {
          _subViewMode = val;
          _applyView();
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Table (server-paged; the view decides the columns)
  // ═══════════════════════════════════════════════════════════════

  var PILL_COLORS = {
    active: 'green', completed: 'green', success: 'green', paid: 'green', open: 'green', resolved: 'green', synced: 'green', connected: 'green', won: 'green', accepted: 'green',
    failed: 'red', error: 'red', overdue: 'red', critical: 'red', high: 'red', urgent: 'red', expired: 'red', lost: 'red',
    pending: 'yellow', in_progress: 'yellow', running: 'yellow', medium: 'yellow', warning: 'yellow', queued: 'yellow', syncing: 'yellow', draft: 'yellow',
    low: 'blue', info: 'blue'
  };

  function _columnsOf(config) {
    return String(config.columns || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean);
  }

  function _labelsOf(config) {
    return String(config.labels || '').split(',').map(function (c) { return c.trim(); });
  }

  /** Date-range parameter base: created_at -> created, due_date -> due_date. */
  function rangeBase(col) {
    return col.length > 3 && col.slice(-3) === '_at' ? col.slice(0, -3) : col;
  }

  /**
   * The mcp-data query for a lex-table server query. Value filters use the
   * API's exact filter_<column>; date ranges go as <base>_after/_before for
   * the API to read once it supports them.
   * @param {Object} query - { page, limit, sortBy, sortDir, filters }
   * @param {Object} config - VIEW_CONFIG entry
   * @param {string} search
   * @param {Date} [now]
   * @returns {URLSearchParams}
   */
  function toApiParams(query, config, search, now) {
    var kit = window.AdminTableKit;
    var q = query || {};
    var filters = q.filters || {};
    var formats = config.format || {};
    var columns = _columnsOf(config);
    var params = new URLSearchParams();
    params.set('page', String(q.page || 1));
    params.set('limit', String(q.limit || 20));
    params.set('sort_by', columns.indexOf(q.sortBy) !== -1 ? q.sortBy : config.sortBy);
    params.set('sort_dir', q.sortDir === 'asc' ? 'asc' : 'desc');
    if (search) params.set('search', search);
    Object.keys(filters).forEach(function (col) {
      if (columns.indexOf(col) === -1) return;
      var fmt = formats[col];
      if (fmt === 'datetime' || fmt === 'date') {
        var base = rangeBase(col);
        kit.setRange(params, filters, col, base + '_after', base + '_before', now);
        return;
      }
      var value = kit.firstFilterValue(filters, col);
      if (value) params.set('filter_' + col, value);
    });
    return params;
  }

  function mapRow(row, index) {
    var out = { _key: String(row.id != null ? row.id : 'row-' + index), _raw: row };
    Object.keys(row).forEach(function (key) {
      if (key !== '_key' && key !== '_raw') out[key] = row[key];
    });
    return out;
  }

  function _isTrue(val) {
    return val === true || val === 't' || val === 'true';
  }

  function _textCell(val) {
    var kit = window.AdminTableKit;
    if (val === null || val === undefined || val === '') return kit.muted('');
    var str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return '<span class="admin-table-text" title="' + kit.esc(str.length > 500 ? str.slice(0, 500) + '…' : str) + '">' + kit.esc(str.length > 160 ? str.slice(0, 160) + '…' : str) + '</span>';
  }

  /**
   * Renderers for a view's columns: dates through Lex.Utils, booleans as
   * Yes/No, enums as badges, workspaces as links, the first column as the
   * name. Rows keep raw values.
   */
  function cellRenderers(config) {
    var kit = window.AdminTableKit;
    var formats = config.format || {};
    var columns = _columnsOf(config);
    var renderers = {};
    columns.forEach(function (col, idx) {
      var fmt = formats[col];
      if (col === 'matter_name') {
        renderers[col] = function (val, row) { return row.matter_id ? kit.matterLink(row.matter_id, val) : kit.nameCell(val); };
      } else if (col === 'matter_id') {
        renderers[col] = function (val) { return val ? kit.matterLink(val, val) : kit.muted(''); };
      } else if (fmt === 'datetime') {
        renderers[col] = function (val) { return kit.timeCell(val); };
      } else if (fmt === 'date') {
        renderers[col] = function (val) { return kit.dateCell(val); };
      } else if (fmt === 'bool') {
        renderers[col] = function (val) {
          if (val === null || val === undefined) return kit.muted('');
          return '<span class="admin-table-text">' + (_isTrue(val) ? 'Yes' : 'No') + '</span>';
        };
      } else if (fmt === 'pill') {
        renderers[col] = function (val) {
          if (val === null || val === undefined || val === '') return kit.muted('');
          var key = String(val).toLowerCase();
          return kit.badge(Lex.Utils.humanizeLabel(val), PILL_COLORS[key] || 'gray');
        };
      } else if (idx === 0) {
        renderers[col] = function (val) {
          return val === null || val === undefined || val === '' ? kit.muted('') : kit.nameCell(String(val).length > 200 ? String(val).slice(0, 200) + '…' : String(val));
        };
      } else {
        renderers[col] = _textCell;
      }
    });
    return renderers;
  }

  /**
   * A header filter for every column: date ranges, Yes/No for booleans and a
   * value box (exact match, the API's filter_<column>) for the rest.
   */
  function filterOptions(config) {
    var kit = window.AdminTableKit;
    var formats = config.format || {};
    var labels = _labelsOf(config);
    var map = {};
    _columnsOf(config).forEach(function (col, idx) {
      var fmt = formats[col];
      if (fmt === 'datetime' || fmt === 'date') {
        map[col] = kit.dateRangeFilter();
      } else if (fmt === 'bool') {
        map[col] = { single: true, options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] };
      } else {
        map[col] = { text: true, placeholder: (labels[idx] || Lex.Utils.humanizeLabel(col)) + ' is...' };
      }
    });
    return map;
  }

  function _sortOptions(config) {
    var labels = _labelsOf(config);
    return _columnsOf(config).map(function (col, idx) {
      return { value: col, label: labels[idx] || Lex.Utils.humanizeLabel(col) };
    });
  }

  function _wireTable() {
    var table = el('dataVizTable');
    if (!table || table._dataVizWired) return;
    table._dataVizWired = true;
    _toolbar = window.AdminTableKit.bindToolbar({
      table: table,
      searchId: 'dataVizSearch',
      sortId: 'dataVizSort',
      orderId: 'dataVizSortOrder',
      countIds: ['dataVizCount', 'dataVizSectionCount'],
      noun: ['record', 'records'],
      onSearch: function (term) {
        _searchTerm = term;
        table.requestServerQuery({ resetPage: true });
      }
    });
    table.addEventListener('lex-query-change', function (e) {
      if (e.target === table) _loadData(e.detail);
    });
    table.addEventListener('row-click', function (e) {
      var row = e.detail && e.detail.row;
      if (row && row._raw) _openDetailDrawer(row._raw, _getEffectiveView());
    });
  }

  /**
   * Point the table at the current view: columns, labels, sort, renderers
   * and filters, then load page 1 with no filters.
   */
  function _applyView() {
    var table = el('dataVizTable');
    if (!table) return;
    var config = VIEW_CONFIG[_getEffectiveView()];
    if (!config) return;
    window.AdminTableKit.whenTableReady().then(function () {
      table.setAttribute('columns', config.columns);
      table.setAttribute('labels', config.labels);
      table.setAttribute('sortable-columns', config.columns);
      table.setAttribute('sort-by', config.sortBy);
      table.setAttribute('sort-dir', 'desc');
      table.sortBy = config.sortBy;
      table.sortDir = 'desc';
      // A new view starts unfiltered and sorted by its default column.
      var source = table.dataSource;
      if (source) {
        source._sortBy = config.sortBy;
        source._sortDir = 'desc';
        if (source._filters && typeof source._filters.clear === 'function') source._filters.clear();
      }
      table.setCellRenderers(cellRenderers(config));
      table.setColumnFilterOptions(filterOptions(config));

      var sort = el('dataVizSort');
      if (sort) {
        sort.setAttribute('options', JSON.stringify(_sortOptions(config)));
        sort.setAttribute('value', config.sortBy);
        sort.value = config.sortBy;
      }
      var order = el('dataVizSortOrder');
      if (order) order.dataset.order = 'desc';
      var heading = el('dataVizHeading');
      if (heading) {
        var sub = SUB_VIEW_MAP[_currentTab];
        heading.textContent = sub && _subViewMode === 'detail' ? sub.detailLabel : (sub ? sub.primaryLabel : (_tabLabels[_currentTab] || 'Records'));
      }
      table.requestServerQuery({ resetPage: true });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Refresh
  // ═══════════════════════════════════════════════════════════════

  function _wireRefresh() {
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      var table = el('dataVizTable');
      if (table && typeof table.requestServerQuery === 'function') table.requestServerQuery();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Data loading (answers the table's lex-query-change)
  // ═══════════════════════════════════════════════════════════════

  function _loadData(query) {
    var gen = ++_gen;
    var table = el('dataVizTable');
    if (!table) return;

    var viewName = _getEffectiveView();
    var config = VIEW_CONFIG[viewName];
    if (!config) return;
    query = query || table.serverQuery;
    var filtered = Boolean(_searchTerm || Object.keys(query.filters || {}).length);

    api.get('/api/v1/mcp-data/' + viewName + '?' + toApiParams(query, config, _searchTerm).toString())
      .then(function (result) {
        if (gen !== _gen) return; // stale response guard
        var rows = (result && result.data) || [];
        var pagination = (result && result.pagination) || {};
        table.emptyText = window.AdminTableKit.emptyText(filtered, 'records');
        table.setServerData(rows.map(mapRow), {
          page: pagination.page || query.page,
          limit: pagination.limit || query.limit,
          total: pagination.total !== undefined ? pagination.total : rows.length,
          totalPages: pagination.totalPages
        });
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        console.error('[DataViz] Load failed:', err);
        if (_toolbar) _toolbar.setCount(null);
        table.setServerError('This view could not be loaded. Check your connection and try again.');
      });
  }

  // _setupChat() removed — managed by the global LANA dock.

  // ═══════════════════════════════════════════════════════════════
  // Row detail drawer
  // ═══════════════════════════════════════════════════════════════

  // Defines what connected data to fetch per entity type.
  // Each entry: { view, filterField, label, columns, labels }
  // Note: some views use UUID for matter_id (connector_data, generated_documents,
  // conversation_memory), while others use the string matter_id (documents, tasks,
  // conversations, notes). Use filterSource 'id' for UUID views, 'matter_id' for varchar.
  var CONNECTED_DATA_MAP = {
    // ── Matters: the central hub ──
    mcp_client_matters: [
      { view: 'mcp_documents', filterField: 'matter_id', filterSource: 'matter_id', label: 'Documents', columns: 'filename,document_type,status,file_size_mb,created_at', labels: 'Filename,Type,Status,Size (MB),Created' },
      { view: 'mcp_tasks', filterField: 'matter_id', filterSource: 'matter_id', label: 'Tasks', columns: 'title,status,priority,due_date,assigned_to_name', labels: 'Title,Status,Priority,Due Date,Assigned To' },
      { view: 'mcp_conversations', filterField: 'matter_id', filterSource: 'matter_id', label: 'Conversations', columns: 'title,context_type,message_count,last_activity', labels: 'Title,Context,Messages,Last Activity' },
      { view: 'mcp_notes', filterField: 'matter_id', filterSource: 'matter_id', label: 'Notes', columns: 'note_text,note_type,created_by_name,created_at', labels: 'Note,Type,Created By,Created' },
      { view: 'mcp_matter_contacts', filterField: 'matter_id', filterSource: 'matter_id', label: 'Contacts', columns: 'contact_id,role,is_primary,created_at', labels: 'Contact ID,Role,Primary,Added' },
      { view: 'mcp_connector_data', filterField: 'matter_id', filterSource: 'id', label: 'Connector Data', columns: 'entity_type,external_id,status,synced_at', labels: 'Entity Type,External ID,Status,Synced' },
      { view: 'mcp_time_entries', filterField: 'matter_id', filterSource: 'matter_id', label: 'Time Entries', columns: 'description,hours,rate,status,created_at', labels: 'Description,Hours,Rate,Status,Created' },
      { view: 'mcp_invoices', filterField: 'matter_id', filterSource: 'matter_id', label: 'Invoices', columns: 'invoice_number,total_amount,status,due_date,created_at', labels: 'Invoice #,Amount,Status,Due Date,Created' },
      { view: 'mcp_calendar_events', filterField: 'matter_id', filterSource: 'matter_id', label: 'Calendar Events', columns: 'title,start_time,end_time,location', labels: 'Title,Start,End,Location' },
      { view: 'mcp_emails', filterField: 'matter_id', filterSource: 'matter_id', label: 'Emails', columns: 'subject,from_address,to_address,created_at', labels: 'Subject,From,To,Date' }
    ],
    // ── Documents ──
    mcp_documents: [
      { view: 'mcp_document_chunks', filterField: 'document_id', filterSource: 'id', label: 'Chunks', columns: 'chunk_index,chunk_type,chunk_length,word_count,page_number', labels: 'Chunk #,Type,Length,Words,Page' }
    ],
    // ── Tasks ──
    mcp_tasks: [
      { view: 'mcp_comments', filterField: 'object_id', filterSource: 'id', label: 'Comments', columns: 'content,comment_type,created_at', labels: 'Content,Type,Created' }
    ],
    // ── Contacts ──
    mcp_contacts: [
      { view: 'mcp_matter_contacts', filterField: 'contact_id', filterSource: 'id', label: 'Matter Associations', columns: 'matter_id,role,is_primary,created_at', labels: 'Matter ID,Role,Primary,Added' }
    ],
    // ── Notes ──
    mcp_notes: [
      { view: 'mcp_comments', filterField: 'object_id', filterSource: 'id', label: 'Comments', columns: 'content,comment_type,created_at', labels: 'Content,Type,Created' }
    ],
    // ── Conversations ──
    mcp_conversations: [
      { view: 'mcp_messages', filterField: 'thread_id', filterSource: 'thread_id', label: 'Messages', columns: 'role,content,created_at', labels: 'Role,Content,Created' }
    ],
    // ── Connector Data ──
    mcp_connector_data: [
      { view: 'mcp_connector_data', filterField: 'integration_source_id', filterSource: 'integration_source_id', label: 'Related Records (Same Source)', columns: 'entity_type,external_id,status,synced_at', labels: 'Entity Type,External ID,Status,Synced' }
    ],
    // ── Integration Sources ──
    mcp_integration_sources: [
      { view: 'mcp_connector_sync_logs', filterField: 'integration_source_id', filterSource: 'id', label: 'Sync Logs', columns: 'sync_type,sync_status,records_processed,records_created,records_failed,duration_seconds,started_at', labels: 'Type,Status,Processed,Created,Failed,Duration (s),Started' },
      { view: 'mcp_connector_data', filterField: 'integration_source_id', filterSource: 'id', label: 'Records', columns: 'entity_type,external_id,client_name,status,synced_at', labels: 'Entity Type,External ID,Client,Status,Synced' }
    ],
    // ── Users ──
    mcp_users: [
      { view: 'mcp_tasks', filterField: 'assigned_to', filterSource: 'id', label: 'Assigned Tasks', columns: 'title,status,priority,due_date,matter_id', labels: 'Title,Status,Priority,Due Date,Matter' },
      { view: 'mcp_conversations', filterField: 'user_id', filterSource: 'id', label: 'Conversations', columns: 'title,context_type,message_count,last_activity', labels: 'Title,Context,Messages,Last Activity' }
    ],
    // ── Emails ──
    mcp_emails: [
      { view: 'mcp_connector_data', filterField: 'external_id', filterSource: 'email_id', label: 'Source Record', columns: 'entity_type,integration_source_id,status,synced_at', labels: 'Entity Type,Source,Status,Synced' }
    ],
    // ── Comments ──
    mcp_comments: [
      { view: 'mcp_comments', filterField: 'parent_comment_id', filterSource: 'id', label: 'Replies', columns: 'content,comment_type,created_at', labels: 'Content,Type,Created' }
    ]
  };

  /**
   * Get action buttons for a record based on its view type.
   */
  function _getRecordActions(viewName, row) {
    var actions = [];

    // Documents: View File button → opens file-viewer.html
    if (viewName === 'mcp_documents' && row.id) {
      actions.push({
        label: 'View File',
        href: '../file-viewer.html?id=' + encodeURIComponent(row.id)
      });
    }

    // Matters: View Workspace → opens workspace-details.html
    if (viewName === 'mcp_client_matters' && row.matter_id) {
      actions.push({
        label: 'View Workspace',
        href: '../workspace-details.html?id=' + encodeURIComponent(row.matter_id)
      });
    }

    // Conversations: View Chat opens the global LANA dock with the thread.
    if (viewName === 'mcp_conversations' && row.thread_id) {
      actions.push({
        label: 'View Chat',
        action: 'open-chat',
        threadId: row.thread_id,
        matterId: row.matter_id || ''
      });
    }

    return actions;
  }

  function _openDetailDrawer(row, explicitViewName) {
    var viewName = explicitViewName || _getEffectiveView();
    var title = row.matter_name || row.filename || row.title || row.source_name
      || row.skill_name || row.name || row.entity_type || 'Record Details';

    // Build record detail section
    var html = '<div id="drawerDetailContent">';

    // Action buttons based on entity type
    var actions = _getRecordActions(viewName, row);
    if (actions.length > 0) {
      html += '<div style="display:flex;gap:0.5rem;margin-bottom:1rem;">';
      for (var ai = 0; ai < actions.length; ai++) {
        var act = actions[ai];
        if (act.action === 'open-chat') {
          html += '<button type="button" data-open-chat-thread="' + Lex.Utils.escapeHtml(act.threadId) + '" data-open-chat-matter="' + Lex.Utils.escapeHtml(act.matterId || '') + '" style="display:inline-flex;align-items:center;gap:0.375rem;padding:0.375rem 0.75rem;font-size:0.8rem;font-weight:500;background:var(--lex-bg-accent,#4f46e5);color:#fff;border:0;border-radius:0.375rem;text-decoration:none;cursor:pointer;">' +
            Lex.Utils.escapeHtml(act.label) + '</button>';
        } else {
          html += '<a href="' + Lex.Utils.escapeHtml(act.href) + '" style="display:inline-flex;align-items:center;gap:0.375rem;padding:0.375rem 0.75rem;font-size:0.8rem;font-weight:500;background:var(--lex-bg-accent,#4f46e5);color:#fff;border-radius:0.375rem;text-decoration:none;cursor:pointer;">' +
            Lex.Utils.escapeHtml(act.label) + '</a>';
        }
      }
      html += '</div>';
    }

    html += _buildRecordFields(row);

    // Connected data sections (load async) for the record's own view
    var connections = CONNECTED_DATA_MAP[viewName] || [];
    if (connections.length > 0) {
      html += '<div style="margin-top:1.5rem;border-top:2px solid var(--lex-border-default,#e5e7eb);padding-top:1rem;">';
      html += '<div style="font-size:0.8rem;font-weight:700;color:var(--lex-text-primary,#111827);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.75rem;">Connected Data</div>';
      for (var ci = 0; ci < connections.length; ci++) {
        html += connectedSectionHtml(connections[ci]);
      }
      html += '</div>';
    }

    html += '</div>';

    // Reset connected rows cache for this drawer session
    _connectedRows = {};

    Lex.Drawer.open({
      heading: Lex.Utils.escapeHtml(String(title)),
      content: html,
      width: 'lg'
    });

    // Wire navigation links via delegation on the drawer content
    _wireDrawerNavLinks();

    // Each connected section is a server-paged lex-table filtered to this record.
    for (var fi = 0; fi < connections.length; fi++) {
      _wireConnectedTable(connections[fi], row);
    }
  }

  function _buildRecordFields(row) {
    var html = '<div style="display:flex;flex-direction:column;gap:0.75rem;">';
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = row[key];
      if (key === 'embedding' || key === 'search_vector' || key === 'search_vector_weighted') continue;

      var label = key.split('_').map(function (w) {
        return w.charAt(0).toUpperCase() + w.substring(1);
      }).join(' ');

      html += '<div style="border-bottom:1px solid var(--lex-border-default,#e5e7eb);padding-bottom:0.5rem;">';
      html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted,#6b7280);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.15rem;">' + Lex.Utils.escapeHtml(label) + '</div>';
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary,#111827);word-break:break-word;">' + _formatDetailValue(key, val) + '</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ─── Connected data tables (docs/TABLE-STANDARD.md) ───────────────
  // Tables inside the record drawer: no toolbar, a heading with the count,
  // and the same paging, sort, filters and renderers as the main table.

  /**
   * The VIEW_CONFIG-shaped config of a connected section: its columns, plus
   * the view's Created column when the view has one, and the view's formats
   * (timestamps found by name when the view has no config).
   */
  function connectedConfig(conn) {
    var base = VIEW_CONFIG[conn.view] || {};
    var columns = _columnsOf(conn);
    var labels = _labelsOf(conn);
    if (columns.indexOf('created_at') === -1 && _columnsOf(base).indexOf('created_at') !== -1) {
      columns.push('created_at');
      labels.push('Created');
    }
    var format = {};
    var baseFormat = base.format || {};
    columns.forEach(function (col) {
      if (baseFormat[col]) format[col] = baseFormat[col];
      else if (col.slice(-3) === '_at' || col === 'last_activity' || col.slice(-5) === '_time') format[col] = 'datetime';
      else if (col.slice(-5) === '_date') format[col] = 'date';
      else if (col === 'status' || col.slice(-7) === '_status' || col === 'priority') format[col] = 'pill';
    });
    var sortBy = columns.indexOf('created_at') !== -1 ? 'created_at'
      : (columns.indexOf(base.sortBy) !== -1 ? base.sortBy
        : (columns.filter(function (c) { return format[c] === 'datetime'; })[0] || columns[0]));
    return { columns: columns.join(','), labels: labels.join(','), sortBy: sortBy, format: format };
  }

  /** mcp-data params for a connected table: the table's query plus the parent filter. */
  function connectedParams(query, conn, parentRow, now) {
    var params = toApiParams(query, connectedConfig(conn), '', now);
    params.set('filter_' + conn.filterField, String(parentRow[conn.filterSource]));
    return params;
  }

  function connectedSectionHtml(conn) {
    var config = connectedConfig(conn);
    var esc = Lex.Utils.escapeHtml;
    return '<section id="connected-' + esc(conn.view) + '" class="dataviz-connected" aria-label="' + esc(conn.label) + '">' +
      '<div class="dataviz-connected-head"><h4 class="dataviz-connected-title">' + esc(conn.label) + '</h4>' +
      '<span class="dataviz-connected-count" id="connected-' + esc(conn.view) + '-count" aria-live="polite"></span></div>' +
      '<lex-table id="connected-' + esc(conn.view) + '-table" class="admin-table lex-table--card dataviz-connected-table"' +
      ' column-filters server-paging columns="' + esc(config.columns) + '" labels="' + esc(config.labels) + '"' +
      ' sortable-columns="' + esc(config.columns) + '" sort-by="' + esc(config.sortBy) + '" sort-dir="desc"' +
      ' limit="20" id-key="_key" empty-text="None found" aria-label="' + esc(conn.label) + '"></lex-table>' +
      '</section>';
  }

  function _wireConnectedTable(conn, parentRow) {
    // The drawer renders its content on open; wait a tick for it.
    setTimeout(function () {
      var table = document.getElementById('connected-' + conn.view + '-table');
      var countEl = document.getElementById('connected-' + conn.view + '-count');
      if (!table) return;
      var config = connectedConfig(conn);
      var gen = 0;
      if (!parentRow[conn.filterSource]) {
        window.AdminTableKit.whenTableReady().then(function () {
          table.setCellRenderers(cellRenderers(config));
          table.setServerData([], { page: 1, limit: 20, total: 0 });
        });
        return;
      }
      window.AdminTableKit.whenTableReady().then(function () {
        table.setCellRenderers(cellRenderers(config));
        table.setColumnFilterOptions(filterOptions(config));
        table.addEventListener('lex-query-change', function (e) {
          if (e.target !== table) return;
          var query = e.detail;
          var seq = ++gen;
          var filtered = Object.keys(query.filters || {}).length > 0;
          api.get('/api/v1/mcp-data/' + conn.view + '?' + connectedParams(query, conn, parentRow).toString())
            .then(function (result) {
              if (seq !== gen) return;
              var rows = (result && result.data) || [];
              var pagination = (result && result.pagination) || {};
              var total = pagination.total !== undefined ? Number(pagination.total) : rows.length;
              _connectedRows[conn.view] = rows;
              table.emptyText = filtered ? 'No matching records. Clear the filters to see all.' : 'None found';
              table.setServerData(rows.map(mapRow), { page: query.page, limit: query.limit, total: total });
              if (countEl) countEl.textContent = window.AdminTableKit.countText(total, 'record', 'records');
            })
            .catch(function () {
              if (seq !== gen) return;
              if (countEl) countEl.textContent = '';
              table.setServerError(conn.label + ' could not be loaded.');
            });
        });
        // A row opens that record's own drawer; workspace links open the workspace.
        table.addEventListener('row-click', function (e) {
          var row = e.detail && e.detail.row;
          if (row && row._raw) _navigateToRecord(conn.view, row._raw);
        });
        table.addEventListener('click', function (e) {
          var link = e.target && e.target.closest ? e.target.closest('[data-matter-id]') : null;
          if (!link) return;
          e.stopPropagation();
          window.AdminTableKit.openWorkspace(link.getAttribute('data-matter-id'));
        });
        table.requestServerQuery({ resetPage: true });
      });
    }, 0);
  }

  function _formatDetailValue(key, val) {
    if (val == null) return '<span style="color:var(--lex-text-muted,#9ca3af);">-</span>';

    var str = String(val);

    // Format timestamps
    if (key.indexOf('_at') !== -1 || key.indexOf('date') !== -1 || key === 'last_activity') {
      var formatted = fmtDateTime(val);
      if (formatted) return Lex.Utils.escapeHtml(formatted);
    }

    // Format booleans
    if (val === true || val === 'true' || val === 't') return '<span style="color:var(--lex-color-green-600,#16a34a);font-weight:500;">Yes</span>';
    if (val === false || val === 'false' || val === 'f') return '<span style="color:var(--lex-text-muted,#9ca3af);">No</span>';

    // Format JSON objects
    if (typeof val === 'object') {
      var jsonStr = JSON.stringify(val, null, 2);
      if (jsonStr.length > 500) jsonStr = jsonStr.substring(0, 497) + '...';
      return '<pre style="font-size:0.75rem;background:var(--lex-bg-muted,#f9fafb);padding:0.5rem;border-radius:0.375rem;overflow-x:auto;margin:0;white-space:pre-wrap;">' + Lex.Utils.escapeHtml(jsonStr) + '</pre>';
    }

    // Format UUIDs — make navigable if the field maps to a known view
    if (str.length === 36 && str.charAt(8) === '-' && str.charAt(13) === '-') {
      if (ID_TO_VIEW_MAP[key]) {
        return '<a href="#" class="drawer-nav-link" data-nav-field="' + Lex.Utils.escapeHtml(key) + '" data-nav-id="' + Lex.Utils.escapeHtml(str) + '" style="font-size:0.75rem;font-family:monospace;background:var(--lex-bg-muted,#f9fafb);padding:0.125rem 0.375rem;border-radius:0.25rem;color:var(--lex-color-blue-600,#2563eb);text-decoration:none;cursor:pointer;">' + Lex.Utils.escapeHtml(str) + '</a>';
      }
      return '<code style="font-size:0.75rem;background:var(--lex-bg-muted,#f9fafb);padding:0.125rem 0.375rem;border-radius:0.25rem;">' + Lex.Utils.escapeHtml(str) + '</code>';
    }

    // Also handle non-UUID IDs (e.g., matter_id = "MATT-XXXXX")
    if (ID_TO_VIEW_MAP[key] && str.length > 0 && str !== '-') {
      return '<a href="#" class="drawer-nav-link" data-nav-field="' + Lex.Utils.escapeHtml(key) + '" data-nav-id="' + Lex.Utils.escapeHtml(str) + '" style="font-size:0.875rem;color:var(--lex-color-blue-600,#2563eb);text-decoration:none;cursor:pointer;">' + Lex.Utils.escapeHtml(str) + '</a>';
    }

    // Long text — show with wrap
    if (str.length > 200) {
      return '<div style="max-height:120px;overflow-y:auto;font-size:0.8125rem;line-height:1.4;">' + Lex.Utils.escapeHtml(str) + '</div>';
    }

    return Lex.Utils.escapeHtml(str);
  }

  // ═══════════════════════════════════════════════════════════════
  // Drawer navigation (clickable IDs)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Maps an ID field name to the MCP view it references.
   * Used to resolve where to fetch a record when an ID is clicked.
   */
  var ID_TO_VIEW_MAP = {
    matter_id:             'mcp_client_matters',
    document_id:           'mcp_documents',
    thread_id:             'mcp_conversations',
    user_id:               'mcp_users',
    contact_id:            'mcp_contacts',
    integration_source_id: 'mcp_integration_sources',
    connector_id:          'mcp_integration_sources',
    group_id:              'mcp_groups'
  };

  function _wireDrawerNavLinks() {
    // The drawer DOM is created async by Lex.Drawer.open().
    // Wait a tick for it to render, then attach handler to the drawer body.
    setTimeout(function () {
      var body = document.querySelector('.lex-drawer-body');
      if (body) _attachNavHandler(body);
    }, 50);
  }

  function _attachNavHandler(container) {
    // Delegated click handler for nav links and clickable rows inside the drawer
    container.addEventListener('click', function (e) {
      // Check for ID field links first
      var link = e.target.closest('.drawer-nav-link');
      if (link) {
        e.preventDefault();
        var navId = link.getAttribute('data-nav-id');
        var navField = link.getAttribute('data-nav-field');
        if (navId && navField) {
          _navigateToRecordById(navField, navId);
          return;
        }
      }

      var chatBtn = e.target.closest('[data-open-chat-thread]');
      if (chatBtn) {
        e.preventDefault();
        var threadId = chatBtn.getAttribute('data-open-chat-thread');
        var matterId = chatBtn.getAttribute('data-open-chat-matter') || '';
        if (window.NavigationHelpers && typeof window.NavigationHelpers.navigateToConversation === 'function') {
          window.NavigationHelpers.navigateToConversation(threadId, matterId);
        } else if (window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go('../dashboard.html');
        }
        return;
      }

    });
  }

  /**
   * Navigate to a record by opening its detail drawer with connected data.
   */
  function _navigateToRecord(viewName, row) {
    _openDetailDrawer(row, viewName);
  }

  /**
   * Navigate to a record by fetching it from its view by ID.
   */
  function _navigateToRecordById(fieldName, idValue) {
    var targetView = ID_TO_VIEW_MAP[fieldName];
    if (!targetView) return;

    var filterField = fieldName === 'matter_id' ? 'matter_id' : 'id';
    var url = '/api/v1/mcp-data/' + targetView +
      '?filter_' + filterField + '=' + encodeURIComponent(idValue) +
      '&limit=1';

    api.get(url)
      .then(function (result) {
        var rows = (result && result.data) || [];
        if (rows.length > 0) {
          _navigateToRecord(targetView, rows[0]);
        }
      })
      .catch(function () {
        // Silent — couldn't fetch the linked record
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Start
  // ═══════════════════════════════════════════════════════════════

  // Pure table logic, exposed for unit tests.
  window.DataVizTable = {
    VIEW_CONFIG: VIEW_CONFIG,
    toApiParams: toApiParams,
    mapRow: mapRow,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    rangeBase: rangeBase,
    getRecordActions: _getRecordActions,
    CONNECTED_DATA_MAP: CONNECTED_DATA_MAP,
    connectedConfig: connectedConfig,
    connectedParams: connectedParams
  };

  init();

})();

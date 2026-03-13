/**
 * Data Visualization — Admin page controller.
 *
 * Displays MCP view data in tabbed lex-tables with an embedded
 * insights_chat panel for natural language querying.
 *
 * @requires api.js          - window.api
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-toast.js    - Lex.Toast.error
 * @requires lex-table.js    - table.setData()
 * @requires lex-tabs.js     - lex-tabs component
 * @requires lex-chat.js     - lex-chat component
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
  var _currentPage = 1;
  var _pageSize    = 50;
  var _availableViews = [];     // populated from /api/v1/mcp-data/views
  // _chatEl / _threadsEl removed — managed by lex-lana-panel

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
        _wirePagination();
        _wireRefresh();
        _initLanaPanel();
        _loadData();
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
        _currentPage = 1;
        _updateSubViewToggle();
        _loadData();
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
      segmented.addEventListener('change', function (e) {
        var val = e.detail && (e.detail.value || e.detail);
        if (typeof val === 'string' && val !== _subViewMode) {
          _subViewMode = val;
          _currentPage = 1;
          _loadData();
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Pagination
  // ═══════════════════════════════════════════════════════════════

  function _wirePagination() {
    var pager = el('dataVizPagination');
    if (!pager || pager._dataVizWired) return;
    pager._dataVizWired = true;
    pager.addEventListener('page-change', function (e) {
      var page = e.detail && e.detail.page;
      if (page && page !== _currentPage) {
        _currentPage = page;
        _loadData();
      }
    });
  }

  function _updatePagination(total) {
    var pager = el('dataVizPagination');
    if (!pager) return;
    var totalPages = Math.max(1, Math.ceil(total / _pageSize));
    pager.page       = _currentPage;
    pager.totalPages = totalPages;
    pager.total      = total;
    pager.limit      = _pageSize;
  }

  // ═══════════════════════════════════════════════════════════════
  // Refresh
  // ═══════════════════════════════════════════════════════════════

  function _wireRefresh() {
    document.addEventListener('lex-refresh', function (e) {
      e.preventDefault();
      _currentPage = 1;
      _loadData();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Ask LANA panel integration (lex-lana-panel)
  // ═══════════════════════════════════════════════════════════════

  function _initLanaPanel() {
    var panel = document.getElementById('dataVizLana');
    if (!panel) return;

    // Inject active view as attachment on every send
    panel.addEventListener('lex-lana-before-send', function (e) {
      var opts = e.detail.opts;
      var viewName = _getEffectiveView();
      var config = VIEW_CONFIG[viewName];
      if (!viewName || !config) return;

      var label = viewName.substring(4); // strip 'mcp_'
      label = label.split('_').map(function (w) {
        return w.charAt(0).toUpperCase() + w.substring(1);
      }).join(' ');

      opts.attachments = opts.attachments || {};
      opts.attachments.views = [{
        view_name: viewName,
        label: label,
        columns: config.columns ? config.columns.split(',') : []
      }];
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Data loading
  // ═══════════════════════════════════════════════════════════════

  function _loadData() {
    var gen = ++_gen;
    var table = el('dataVizTable');
    if (!table) return;

    var viewName = _getEffectiveView();
    var config = VIEW_CONFIG[viewName];
    if (!config) return;

    // Reconfigure table columns/labels for this view
    table.setAttribute('columns', config.columns);
    table.setAttribute('labels', config.labels);
    table.setAttribute('sort-by', config.sortBy);

    // Shimmer loading
    Lex.Redact.on(table);

    var url = '/api/v1/mcp-data/' + viewName +
      '?page=' + _currentPage +
      '&limit=' + _pageSize +
      '&sort_by=' + encodeURIComponent(config.sortBy) +
      '&sort_dir=desc';

    api.get(url)
      .then(function (result) {
        if (gen !== _gen) return; // stale response guard

        var rows = (result && result.data) || [];
        var pagination = (result && result.pagination) || {};
        var total = pagination.total || rows.length;

        // Format rows for display
        var formatted = rows.map(function (row) {
          return _formatRow(row, config);
        });

        Lex.Redact.off(table);
        table.setData(formatted);
        _updatePagination(total);
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        Lex.Redact.off(table);
        console.error('[DataViz] Load failed:', err);
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          Lex.Toast.error('Failed to load data');
        }
      });
  }

  /**
   * Format a row for display — plain text values only.
   * lex-table escapes all HTML, so we must NOT return HTML strings.
   * lex-table auto-detects status badges for: active, inactive, pending,
   * completed, failed, error, success, open, closed, draft, archived.
   */
  function _formatRow(row, config) {
    var out = {};
    var formatMap = config.format || {};

    for (var key in row) {
      if (!row.hasOwnProperty(key)) continue;
      var val = row[key];
      var fmt = formatMap[key];

      if (val == null) {
        out[key] = '-';
      } else if (fmt === 'datetime') {
        out[key] = fmtDateTime(val) || String(val);
      } else if (fmt === 'date') {
        out[key] = fmtDateTime(val, { dateOnly: true }) || String(val);
      } else if (fmt === 'bool') {
        out[key] = (val === true || val === 't' || val === 'true') ? 'Yes' : 'No';
      } else if (fmt === 'pill') {
        // Pass raw string — lex-table auto-styles known status values
        out[key] = String(val);
      } else {
        var str = String(val);
        if (str.length > 120) {
          str = str.substring(0, 117) + '...';
        }
        out[key] = str;
      }
    }

    return out;
  }

  // _setupChat() removed — managed by lex-lana-panel component

  // ═══════════════════════════════════════════════════════════════
  // Start
  // ═══════════════════════════════════════════════════════════════

  init();

})();

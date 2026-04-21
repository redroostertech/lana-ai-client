(function () {
  'use strict';

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function toFriendlyName(eventType) {
    return String(eventType || '')
      .replace(/[._-]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function withDefaultArrays(value, fallback) {
    return Array.isArray(value) && value.length ? value.slice() : fallback.slice();
  }

  const EVENT_GROUPS = [
    {
      key: 'document',
      label: 'Document Events',
      description: 'Use these when a file is uploaded, parsed, indexed, summarized, or versioned.',
      when: 'These events fire as documents move through the document lifecycle.',
      data: ['document_id', 'matter_id', 'file_name', 'status', 'processing_status', 'summary'],
      useCases: ['Start redlining when a new revision arrives', 'Create a summary after ingestion', 'Kick off document review tasks'],
      examples: ['Auto-redline a new upload', 'Generate a digest after indexing', 'Flag a document for legal review'],
      events: ['document.created', 'document.updated', 'document.deleted', 'document.uploaded', 'document.parsed', 'document.indexed', 'document.ready', 'document.summarized', 'document.processed', 'document.shared', 'document.downloaded', 'document_version.created', 'document_version.restored']
    },
    {
      key: 'matter',
      label: 'Matter Events',
      description: 'Use these when matters change, close, reopen, or get linked to related records.',
      when: 'These events fire when a matter record changes or its relationships change.',
      data: ['matter_id', 'matter_name', 'matter_type', 'status', 'assigned_user_id'],
      useCases: ['Create intake tasks', 'Escalate a closing checklist', 'Notify the team when a matter is reassigned'],
      examples: ['Matter closed compliance review', 'Matter assignment notification', 'Matter linked to a workspace'],
      events: ['matter.created', 'matter.updated', 'matter.closed', 'matter.reopened', 'matter.archived', 'matter.assigned', 'matter.linked_to_workspace', 'matter.linked_to_matter', 'matter.unlinked']
    },
    {
      key: 'workspace',
      label: 'Workspace Events',
      description: 'Use these when a workspace relationship changes.',
      when: 'These events fire when a workspace gets linked to or detached from a matter.',
      data: ['workspace_id', 'matter_id', 'workspace_name'],
      useCases: ['Keep the workspace index up to date', 'Notify a team when a workspace is linked'],
      examples: ['Workspace linked to matter automation'],
      events: ['workspace.linked_to_matter']
    },
    {
      key: 'entity_link',
      label: 'Entity Link Events',
      description: 'Use these when the system creates or removes relationships between records.',
      when: 'These events fire when a relation between two records is added or removed.',
      data: ['source_type', 'source_id', 'target_type', 'target_id', 'link_type'],
      useCases: ['Track related records', 'Sync linked data to a workspace', 'Maintain relationship graphs'],
      examples: ['Link a contact to a matter', 'Remove a stale record relationship'],
      events: ['entity_link.created', 'entity_link.deleted']
    },
    {
      key: 'contact',
      label: 'Contact Events',
      description: 'Use these when contacts are created, updated, linked, or synced.',
      when: 'These events fire when a contact changes or is attached to a matter.',
      data: ['contact_id', 'contact_name', 'email', 'phone', 'matter_id', 'source'],
      useCases: ['Kick off onboarding', 'Notify when a contact is linked to a matter', 'Enrich matter records'],
      examples: ['Contact linked to matter', 'Contact synced from connector'],
      events: ['contact.created', 'contact.updated', 'contact.deleted', 'contact.linked_to_matter', 'contact.unlinked_from_matter', 'contact.synced_from_connector']
    },
    {
      key: 'lead',
      label: 'Lead Events',
      description: 'Use these when a new lead arrives or moves through qualification.',
      when: 'These events fire as lead records are created, updated, converted, or removed.',
      data: ['lead_id', 'lead_name', 'source', 'status', 'assigned_user_id'],
      useCases: ['Start intake follow-up', 'Route qualified leads', 'Notify the intake team'],
      examples: ['Lead intake processor', 'Welcome email sequence'],
      events: ['lead.created', 'lead.updated', 'lead.deleted', 'lead.converted']
    },
    {
      key: 'opportunity',
      label: 'Opportunity Events',
      description: 'Use these when pipeline items are created, updated, won, or lost.',
      when: 'These events fire as an opportunity moves through a pipeline or closes.',
      data: ['opportunity_id', 'stage', 'status', 'amount', 'owner_id'],
      useCases: ['Follow up on stale opportunities', 'Notify when a deal closes', 'Measure pipeline health'],
      examples: ['Opportunity aged alert', 'Closed-won notification'],
      events: ['opportunity.created', 'opportunity.updated', 'opportunity.closed_won', 'opportunity.closed_lost']
    },
    {
      key: 'project',
      label: 'Project Events',
      description: 'Use these when project state changes or a project is completed.',
      when: 'These events fire when a project is created, updated, completed, or archived.',
      data: ['project_id', 'project_name', 'status', 'owner_id'],
      useCases: ['Track project progress', 'Notify a team when a project closes'],
      examples: ['Project completed handoff', 'Project archived cleanup'],
      events: ['project.created', 'project.updated', 'project.completed', 'project.archived']
    },
    {
      key: 'task',
      label: 'Task Events',
      description: 'Use these when tasks are created, assigned, completed, or overdue.',
      when: 'These events fire when a task changes status or becomes overdue.',
      data: ['task_id', 'task_title', 'status', 'assignee_id', 'due_date'],
      useCases: ['Escalate missed tasks', 'Create follow-up reminders', 'Keep task dashboards in sync'],
      examples: ['Task overdue escalation', 'Task completed activity log'],
      events: ['task.created', 'task.updated', 'task.completed', 'task.deleted', 'task.assigned', 'task.overdue']
    },
    {
      key: 'checklist',
      label: 'Checklist Events',
      description: 'Use these when a checklist is created, completed, or removed.',
      when: 'These events fire when a checklist changes lifecycle state.',
      data: ['checklist_id', 'checklist_name', 'status', 'matter_id'],
      useCases: ['Track completion on matter closeout', 'Audit checklist completion'],
      examples: ['Closeout checklist completed'],
      events: ['checklist.created', 'checklist.completed', 'checklist.deleted']
    },
    {
      key: 'checklist_item',
      label: 'Checklist Item Events',
      description: 'Use these when a checklist item is added, completed, or deleted.',
      when: 'These events fire when individual checklist items change state.',
      data: ['checklist_item_id', 'checklist_id', 'title', 'status'],
      useCases: ['Notify when a critical checklist item is done', 'Keep checklist progress accurate'],
      examples: ['Checklist item completed follow-up'],
      events: ['checklist_item.created', 'checklist_item.completed', 'checklist_item.deleted']
    },
    {
      key: 'email',
      label: 'Email Events',
      description: 'Use these when email is received, sent, opened, or bounced.',
      when: 'These events fire around email delivery and engagement.',
      data: ['email_id', 'thread_id', 'from', 'to', 'subject', 'received_at'],
      useCases: ['Triage inbound email', 'Notify on important replies', 'Track engagement'],
      examples: ['Email triage', 'Inbox digest', 'Welcome email sequence'],
      events: ['email.received', 'email.sent', 'email.opened', 'email.bounced']
    },
    {
      key: 'call',
      label: 'Call Events',
      description: 'Use these when calls or meetings are logged or completed.',
      when: 'These events fire when a call record or meeting record is captured.',
      data: ['call_id', 'contact_id', 'matter_id', 'duration', 'outcome'],
      useCases: ['Track outreach', 'Schedule follow-up', 'Log consults'],
      examples: ['Call logged follow-up', 'Consultation completed'],
      events: ['call.logged', 'call.completed']
    },
    {
      key: 'conversation',
      label: 'Conversation & Message Events',
      description: 'Use these when conversations, messages, or meetings are created or updated.',
      when: 'These events fire when a conversation thread or related message changes.',
      data: ['conversation_id', 'message_id', 'participants', 'channel', 'matter_id'],
      useCases: ['Start a matter discussion', 'Capture a message thread in the workspace'],
      examples: ['Conversation created note', 'Message received triage'],
      events: ['conversation.created', 'conversation.updated', 'message.sent', 'message.received', 'meeting.scheduled', 'meeting.completed']
    },
    {
      key: 'calendar_event',
      label: 'Calendar Events',
      description: 'Use these when calendar events are created, updated, deleted, or responded to.',
      when: 'These events fire as calendar records change or an RSVP is submitted.',
      data: ['event_id', 'start_time', 'end_time', 'attendees', 'status'],
      useCases: ['Prepare for hearings or meetings', 'Send reminders', 'Track RSVPs'],
      examples: ['Meeting prep pack', 'Calendar RSVP notification'],
      events: ['calendar_event.created', 'calendar_event.updated', 'calendar_event.deleted', 'calendar_event.rsvp']
    },
    {
      key: 'campaign',
      label: 'Campaign Events',
      description: 'Use these when campaigns are created, sent, or opened.',
      when: 'These events fire when a campaign moves through send and engagement milestones.',
      data: ['campaign_id', 'subject', 'recipient_count', 'open_count'],
      useCases: ['Measure campaign engagement', 'Trigger follow-up steps'],
      examples: ['Campaign sent notification'],
      events: ['campaign.created', 'campaign.sent', 'campaign.opened']
    },
    {
      key: 'milestone',
      label: 'Milestone Events',
      description: 'Use these when milestones are created, completed, or missed.',
      when: 'These events fire when a milestone is added or its deadline changes outcome.',
      data: ['milestone_id', 'matter_id', 'due_date', 'status'],
      useCases: ['Escalate missed milestones', 'Keep teams on schedule'],
      examples: ['Milestone missed escalation'],
      events: ['milestone.created', 'milestone.completed', 'milestone.missed']
    },
    {
      key: 'note',
      label: 'Note Events',
      description: 'Use these when notes are created, updated, or deleted.',
      when: 'These events fire when a note is added to or removed from a record.',
      data: ['note_id', 'matter_id', 'title', 'body'],
      useCases: ['Watch for team updates', 'Add note-based reminders'],
      examples: ['Matter note created activity'],
      events: ['note.created', 'note.updated', 'note.deleted']
    },
    {
      key: 'workflow',
      label: 'Workflow Events',
      description: 'Use these to react to workflow lifecycle changes.',
      when: 'These events fire when a workflow starts, completes, or fails.',
      data: ['workflow_id', 'execution_id', 'status', 'started_at', 'completed_at'],
      useCases: ['Monitor workflow health', 'Log execution outcomes'],
      examples: ['Workflow completed activity', 'Workflow failure alert'],
      events: ['workflow.started', 'workflow.completed', 'workflow.failed']
    },
    {
      key: 'custom_skill',
      label: 'Custom Skill Events',
      description: 'Use these when a custom skill is created, updated, or published.',
      when: 'These events fire when a skill definition changes.',
      data: ['skill_id', 'skill_key', 'skill_name', 'version'],
      useCases: ['Track skill publishing', 'Notify editors when a skill changes'],
      examples: ['Custom skill published'],
      events: ['custom_skill.created', 'custom_skill.updated', 'custom_skill.deleted', 'custom_skill.published']
    },
    {
      key: 'matter_skill',
      label: 'Matter Skill Events',
      description: 'Use these when a skill is enabled, disabled, executed, or fails on a matter.',
      when: 'These events fire around matter-scoped skill lifecycle changes.',
      data: ['matter_skill_id', 'matter_id', 'skill_id', 'execution_id', 'status'],
      useCases: ['Audit matter automations', 'Track execution failures', 'Notify on skill runs'],
      examples: ['Matter skill executed notification'],
      events: ['matter_skill.enabled', 'matter_skill.disabled', 'matter_skill.executed', 'matter_skill.failed']
    },
    {
      key: 'integration',
      label: 'Integration Events',
      description: 'Use these when external connectors sync data or hit errors.',
      when: 'These events fire when a connector sync completes, fails, or receives external data.',
      data: ['connector_id', 'integration_source_id', 'record_count', 'entity_type'],
      useCases: ['Review sync health', 'Trigger downstream triage', 'Alert on connector errors'],
      examples: ['Connector sync reporter', 'Email triage from connector data'],
      events: ['connector.synced', 'connector.error', 'integration.data_received']
    },
    {
      key: 'user',
      label: 'User Events',
      description: 'Use these when users log in, log out, or update accounts.',
      when: 'These events fire when a user session or profile changes.',
      data: ['user_id', 'email', 'role', 'organization_id'],
      useCases: ['Track logins', 'Audit profile changes'],
      examples: ['User login activity'],
      events: ['user.login', 'user.logout', 'user.created', 'user.updated']
    },
    {
      key: 'invoice',
      label: 'Invoice Events',
      description: 'Use these when invoices are created, sent, paid, or voided.',
      when: 'These events fire when an invoice changes lifecycle state.',
      data: ['invoice_id', 'invoice_number', 'amount_due', 'due_date', 'client_name', 'days_overdue'],
      useCases: ['Start billing reminders', 'Track collections', 'Trigger invoice review workflows'],
      examples: ['Invoice overdue checker', 'Weekly AR reminder sequence'],
      events: ['invoice.created', 'invoice.sent', 'invoice.paid', 'invoice.voided']
    },
    {
      key: 'expense',
      label: 'Expense Events',
      description: 'Use these when expenses are created, approved, rejected, or paid.',
      when: 'These events fire when an expense request changes lifecycle state.',
      data: ['expense_id', 'amount', 'status', 'submitted_by'],
      useCases: ['Approve reimbursements', 'Track spend'],
      examples: ['Expense approval workflow'],
      events: ['expense.created', 'expense.approved', 'expense.rejected', 'expense.paid']
    },
    {
      key: 'disbursement',
      label: 'Disbursement Events',
      description: 'Use these when disbursements are created, approved, or paid.',
      when: 'These events fire as disbursement records progress.',
      data: ['disbursement_id', 'amount', 'matter_id', 'status'],
      useCases: ['Review disbursement requests', 'Track outgoing payments'],
      examples: ['Disbursement approval flow'],
      events: ['disbursement.created', 'disbursement.approved', 'disbursement.paid']
    },
    {
      key: 'payment',
      label: 'Payment Events',
      description: 'Use these when payments are received or refunded.',
      when: 'These events fire when a payment is recorded or reversed.',
      data: ['payment_id', 'amount', 'client_name', 'status'],
      useCases: ['Confirm receipt', 'Update invoice status'],
      examples: ['Payment received activity'],
      events: ['payment.received', 'payment.refunded']
    },
    {
      key: 'estimate',
      label: 'Estimate Events',
      description: 'Use these when estimates are created, sent, or approved.',
      when: 'These events fire around estimate and quote lifecycle changes.',
      data: ['estimate_id', 'amount', 'client_name', 'status'],
      useCases: ['Request approval', 'Track quote acceptance'],
      examples: ['Estimate approved notification'],
      events: ['estimate.created', 'estimate.sent', 'estimate.approved']
    },
    {
      key: 'budget',
      label: 'Budget Events',
      description: 'Use these when budgets are created, updated, or exceeded.',
      when: 'These events fire when a budget threshold changes or is exceeded.',
      data: ['budget_id', 'matter_id', 'amount', 'status'],
      useCases: ['Alert on budget overages', 'Track matter spend'],
      examples: ['Budget exceeded alert'],
      events: ['budget.created', 'budget.updated', 'budget.exceeded']
    },
    {
      key: 'time_entry',
      label: 'Time Entry Events',
      description: 'Use these when time entries are created, updated, or deleted.',
      when: 'These events fire when a billable time record changes.',
      data: ['time_entry_id', 'matter_id', 'minutes', 'billable'],
      useCases: ['Track time capture', 'Notify on missing billable entries'],
      examples: ['Time entry review workflow'],
      events: ['time_entry.created', 'time_entry.updated', 'time_entry.deleted']
    },
    {
      key: 'trust_entry',
      label: 'Trust Entry Events',
      description: 'Use these when trust account entries are created or reconciled.',
      when: 'These events fire when trust bookkeeping changes.',
      data: ['trust_entry_id', 'matter_id', 'amount', 'status'],
      useCases: ['Monitor reconciliation', 'Audit trust activity'],
      examples: ['Trust entry reconciled notification'],
      events: ['trust_entry.created', 'trust_entry.reconciled']
    },
    {
      key: 'notification',
      label: 'Notification Events',
      description: 'Use these when notifications, reminders, or alerts are sent.',
      when: 'These events fire after the system sends a user-facing notification.',
      data: ['notification_id', 'recipient_id', 'message', 'severity'],
      useCases: ['Track reminders', 'Audit alerts', 'Trigger downstream follow-up'],
      examples: ['Reminder triggered', 'System alert created'],
      events: ['notification.sent', 'reminder.triggered', 'alert.created']
    },
    {
      key: 'folder',
      label: 'Folder Events',
      description: 'Use these when folders are created, renamed, or deleted.',
      when: 'These events fire when a folder structure changes.',
      data: ['folder_id', 'folder_name', 'workspace_id'],
      useCases: ['Keep file trees in sync', 'Audit structure changes'],
      examples: ['Folder created event'],
      events: ['folder.created', 'folder.renamed', 'folder.deleted']
    },
    {
      key: 'generated_document',
      label: 'Generated Document Events',
      description: 'Use these when a document is generated from a template.',
      when: 'These events fire after document generation succeeds or fails.',
      data: ['document_id', 'template_id', 'status', 'matter_id'],
      useCases: ['Track template generation', 'Alert when document generation fails'],
      examples: ['Generated document created'],
      events: ['generated_document.created', 'generated_document.failed']
    },
    {
      key: 'pipeline',
      label: 'Pipeline Events',
      description: 'Use these when a pipeline or stage changes.',
      when: 'These events fire when a pipeline is created, updated, or an item moves stages.',
      data: ['pipeline_id', 'stage_id', 'item_id', 'status'],
      useCases: ['Track pipeline transitions', 'Notify when work moves stages'],
      examples: ['Pipeline stage changed'],
      events: ['pipeline.created', 'pipeline.updated', 'pipeline.stage_changed']
    },
    {
      key: 'ai',
      label: 'AI Events',
      description: 'Use these when AI processing completes for analysis, summaries, or extraction.',
      when: 'These events fire after an AI task finishes processing content.',
      data: ['job_id', 'model', 'status', 'token_usage'],
      useCases: ['Watch model completion', 'Start follow-up tasks after AI review'],
      examples: ['AI summary generated', 'AI analysis completed'],
      events: ['ai.analysis_completed', 'ai.summary_generated', 'ai.extraction_completed']
    },
    {
      key: 'schedule',
      label: 'Schedule Events',
      description: 'Use these when a timer or cadence should start a workflow.',
      when: 'These events fire on a recurring schedule configured by the workflow.',
      data: ['schedule', 'timezone', 'next_run_at', 'triggered_at'],
      useCases: ['Run daily checks', 'Generate weekly digests', 'Kick off monthly reports'],
      examples: ['Daily deadline monitor', 'Weekly matter digest'],
      events: ['schedule.minutes', 'schedule.hourly', 'schedule.daily', 'schedule.weekly', 'schedule.monthly']
    }
  ];

  const EVENT_OVERRIDES = {
    'document.uploaded': {
      friendly_name: 'Document Uploaded',
      description: 'Fires immediately when a new file is accepted into the platform.',
      when: 'Right after storage receives the document and creates the file record.',
      data: ['document_id', 'matter_id', 'file_name', 'uploaded_by', 'storage_key'],
      useCases: ['Start parsing', 'Kick off a redline workflow', 'Create an intake note'],
      examples: ['Auto-redline a new upload', 'Trigger OCR and indexing', 'Create a review task on upload']
    },
    'document.parsed': {
      friendly_name: 'Document Parsed',
      description: 'Fires when text extraction and layout parsing complete.',
      when: 'After the parser finishes extracting text and structure from the file.',
      data: ['document_id', 'parsed_text', 'layout', 'parser_provenance', 'page_count'],
      useCases: ['Start summarization', 'Prepare a comparison view', 'Feed downstream AI or search'],
      examples: ['Document summary after parse', 'Layout-aware redline review']
    },
    'document.indexed': {
      friendly_name: 'Document Indexed',
      description: 'Fires when the document is chunked and indexed for search.',
      when: 'After chunking and vector indexing succeed.',
      data: ['document_id', 'chunk_count', 'vector_count', 'indexed_at', 'ai_searchable_content'],
      useCases: ['Enable search', 'Notify that the document is ready for lookup'],
      examples: ['Searchable document notification']
    },
    'document.ready': {
      friendly_name: 'Document Ready',
      description: 'Fires when the document is available for normal use in the platform.',
      when: 'After parsing and indexing finish and the document is ready to work with.',
      data: ['document_id', 'status', 'processing_status', 'summary_status'],
      useCases: ['Trigger follow-up automations', 'Notify the user the file is ready', 'Launch review workflows'],
      examples: ['Ready-for-review notification', 'Matter workflow after ingest completes']
    },
    'document.summarized': {
      friendly_name: 'Document Summarized',
      description: 'Fires when the AI summary for a document finishes.',
      when: 'After the summary worker writes the summary back to the document record.',
      data: ['document_id', 'summary', 'summary_generated_at', 'summary_method'],
      useCases: ['Build dashboards', 'Create note summaries', 'Trigger digest workflows'],
      examples: ['Summary-based matter note', 'Document summary activity']
    },
    'document.processed': {
      friendly_name: 'Document Processed',
      description: 'Fires when document processing completes in the legacy pipeline.',
      when: 'After the older document processing worker finishes its processing stage.',
      data: ['document_id', 'matter_id', 'status', 'processing_status'],
      useCases: ['Support legacy automations', 'Bridge older file intake flows'],
      examples: ['Legacy intake automation']
    },
    'contact.linked_to_matter': {
      friendly_name: 'Contact Linked to Matter',
      description: 'Fires when a contact is attached to a matter.',
      when: 'When a user or system links a contact to a matter record.',
      data: ['contact_id', 'matter_id', 'linked_by', 'link_type'],
      useCases: ['Start welcome messages', 'Assign intake tasks', 'Update matter contacts'],
      examples: ['Welcome email sequence', 'Matter contact sync']
    },
    'connector.synced': {
      friendly_name: 'Connector Synced',
      description: 'Fires when an external connector sync completes.',
      when: 'After a connector batch finishes syncing records into the platform.',
      data: ['connector_id', 'integration_source_id', 'record_count', 'entity_type'],
      useCases: ['Analyze sync health', 'Trigger follow-up review', 'Log sync activity'],
      examples: ['Connector sync reporter', 'Post-sync audit task']
    },
    'lead.created': {
      friendly_name: 'Lead Created',
      description: 'Fires when a new lead record is created.',
      when: 'As soon as a lead enters the system.',
      data: ['lead_id', 'lead_name', 'source', 'assigned_user_id'],
      useCases: ['Begin intake follow-up', 'Route leads to an owner'],
      examples: ['Lead intake processor', 'Welcome email workflow']
    },
    'invoice.sent': {
      friendly_name: 'Invoice Sent',
      description: 'Fires when an invoice is issued to a client.',
      when: 'After a sent invoice is recorded in the billing system.',
      data: ['invoice_id', 'invoice_number', 'amount_due', 'due_date', 'days_overdue'],
      useCases: ['Start payment reminders', 'Track collections work'],
      examples: ['Overdue invoice reminder']
    },
    'schedule.daily': {
      friendly_name: 'Schedule Daily',
      description: 'Runs once per day at a configured time.',
      when: 'On the daily cadence you configure in the workflow.',
      data: ['schedule', 'timezone', 'triggered_at'],
      useCases: ['Run daily audits', 'Generate daily reminders', 'Refresh reports'],
      examples: ['Daily deadline monitor', 'Daily digest']
    },
    'schedule.weekly': {
      friendly_name: 'Schedule Weekly',
      description: 'Runs once per week on the configured day and time.',
      when: 'On the weekly cadence you configure in the workflow.',
      data: ['schedule', 'timezone', 'triggered_at'],
      useCases: ['Generate weekly summaries', 'Review weekly progress'],
      examples: ['Weekly matter digest', 'Weekly status sheet']
    }
  };

  function buildEventMeta(group, eventType) {
    const friendlyName = EVENT_OVERRIDES[eventType]?.friendly_name || toFriendlyName(eventType);
    const defaultData = withDefaultArrays(group.data, ['record_id', 'matter_id', 'status']);
    const defaultUseCases = withDefaultArrays(group.useCases, ['Review the event and route follow-up work', 'Capture the event in a workflow']);
    const defaultExamples = withDefaultArrays(group.examples, ['Automate a follow-up task', 'Log the event for the team']);
    const override = EVENT_OVERRIDES[eventType] || {};

    return {
      event_type: eventType,
      friendly_name: friendlyName,
      category_key: group.key,
      category_label: group.label,
      description: override.description || `Fires when ${friendlyName.toLowerCase()} occurs.`,
      when: override.when || group.when || 'When this record changes state in the platform.',
      data_available: withDefaultArrays(override.data, defaultData),
      common_use_cases: withDefaultArrays(override.useCases, defaultUseCases),
      example_workflows: withDefaultArrays(override.examples, defaultExamples),
      category_description: group.description
    };
  }

  function getCategoryForEvent(eventType) {
    const normalized = normalizeText(eventType);
    return EVENT_GROUPS.find((group) => group.events.some((key) => normalizeText(key) === normalized)) || null;
  }

  function getEventMeta(eventType) {
    if (!eventType) {
      return null;
    }

    const group = getCategoryForEvent(eventType);
    if (!group) {
      const friendly = toFriendlyName(eventType);
      return {
        event_type: eventType,
        friendly_name: friendly,
        category_key: 'general',
        category_label: 'General Events',
        description: `Fires when ${friendly.toLowerCase()} occurs.`,
        when: 'When this event is emitted by the platform.',
        data_available: ['record_id', 'matter_id', 'status'],
        common_use_cases: ['Start a workflow', 'Notify the team', 'Log an activity'],
        example_workflows: ['Build a follow-up task', 'Send a notification'],
        category_description: 'General platform events'
      };
    }

    return buildEventMeta(group, eventType);
  }

  function buildSelectOptions() {
    return EVENT_GROUPS.map((group) => {
      const options = group.events.map((eventType) => {
        const meta = getEventMeta(eventType);
        return `<option value="${eventType}">${meta.friendly_name}</option>`;
      }).join('');
      return `<optgroup label="${group.label}">${options}</optgroup>`;
    }).join('');
  }

  function getGroupedEvents(query) {
    const term = normalizeText(query);
    const groups = [];

    EVENT_GROUPS.forEach((group) => {
      const events = group.events.map((eventType) => getEventMeta(eventType));
      const filtered = term
        ? events.filter((event) => {
            const haystack = [
              event.event_type,
              event.friendly_name,
              event.category_label,
              event.description,
              event.when,
              event.common_use_cases.join(' '),
              event.example_workflows.join(' ')
            ].join(' ');
            return normalizeText(haystack).includes(term);
          })
        : events;

      if (filtered.length) {
        groups.push({
          ...group,
          events: filtered
        });
      }
    });

    return groups;
  }

  function searchEvents(query) {
    const term = normalizeText(query);
    const matches = [];
    EVENT_GROUPS.forEach((group) => {
      group.events.forEach((eventType) => {
        const meta = getEventMeta(eventType);
        const haystack = [
          meta.event_type,
          meta.friendly_name,
          meta.category_label,
          meta.description,
          meta.when,
          meta.data_available.join(' '),
          meta.common_use_cases.join(' '),
          meta.example_workflows.join(' ')
        ].join(' ');
        if (!term || normalizeText(haystack).includes(term)) {
          matches.push(meta);
        }
      });
    });
    return matches;
  }

  window.LanaEventCatalog = {
    categories: EVENT_GROUPS,
    getEventMeta,
    getCategoryForEvent,
    getGroupedEvents,
    searchEvents,
    buildSelectOptions
  };
})();

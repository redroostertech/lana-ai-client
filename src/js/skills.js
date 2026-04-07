/**
 * Skills - Browse, import, and manage skills
 * @module skills
 */

(function() {
  'use strict';

  // State
  var allSkills = [];
  var filteredSkills = [];
  var searchTerm = '';
  var selectedCategory = 'all';
  var viewMode = 'list'; // 'list' or 'grid' — default to list
  var selectedSkill = null;
  var selectedMatters = [];

  // Matter context (for breadcrumb navigation)
  var _matterId = '';
  var _matterName = '';

  // Pagination state (grid view)
  var gridPage = 1;
  var gridLimit = 20;
  var gridTotal = 0;

  // Import skill state
  var skillImportState = {
    selectedFile: null,
    isImporting: false
  };

  // Skills Designer — managed by lex-lana-panel

  // Debounce timer for MX diagnostics (FE-1: avoid firing on every keystroke)
  var _mxDebounceTimer = null;
  function debouncedUpdateMXDiagnostics() {
    if (_mxDebounceTimer) clearTimeout(_mxDebounceTimer);
    _mxDebounceTimer = setTimeout(function() {
      updateMXDiagnostics();
    }, 250);
  }

  // Skill Builder state
  var skillSteps = [];
  var editingSkillId = null;
  var mxDiagnostics = {
    parseability: 0,
    intentClarity: 'Unknown',
    triggerCount: 0,
    conditionCount: 0,
    actionCount: 0
  };

  // DOM Elements
  var searchInput, categoryFilter, gridViewBtn, listViewBtn;
  var loadingState, skillsGridContainer, gridEmptyState, filterChips;
  var gridViewContainer, skillsListView, gridPagination, listPagination;
  var skillDetailsModal, matterSelectorModal;

  /**
   * Get URL query parameter
   * @param {string} name - Parameter name
   * @returns {string} Parameter value or empty string
   */
  function _getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  /**
   * Fetch matter details and update breadcrumb
   */
  function _fetchMatterForBreadcrumb() {
    if (!_matterId) return;

    api.get('/api/v1/matters/' + encodeURIComponent(_matterId))
      .then(function(result) {
        var matter = (result && result.data) || result || {};
        _matterName = matter.matter_name || matter.name || _matterId;

        var breadcrumb = document.getElementById('skillsBreadcrumb');
        if (breadcrumb) {
          breadcrumb.setAttribute('items', JSON.stringify([
            { label: 'Workspaces', href: 'workspaces.html' },
            { label: _matterName, href: 'workspace-details.html?id=' + encodeURIComponent(_matterId) },
            { label: 'Skills' }
          ]));
        }
      })
      .catch(function(err) {
        console.warn('[skills] Failed to fetch matter for breadcrumb:', err);
      });
  }

  /**
   * Initialize the skills page
   */
  function init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAfterDOM);
    } else {
      initAfterDOM();
    }
  }

  function initAfterDOM() {
    // Initialize menu
    if (typeof window.initializeMenu === 'function') {
      window.initializeMenu();
    }

    // Get DOM elements
    searchInput = document.getElementById('search-input');
    categoryFilter = document.getElementById('category-filter');
    gridViewBtn = document.getElementById('grid-view-btn');
    listViewBtn = document.getElementById('list-view-btn');
    loadingState = document.getElementById('loading-state');
    skillsGridContainer = document.getElementById('skills-grid-container');
    gridEmptyState = document.getElementById('grid-empty-state');
    filterChips = document.getElementById('filter-chips');
    gridViewContainer = document.getElementById('grid-view-container');
    skillsListView = document.getElementById('skillsListView');
    gridPagination = document.getElementById('grid-pagination');
    listPagination = document.getElementById('list-pagination');
    skillDetailsModal = document.getElementById('skill-details-modal');
    matterSelectorModal = document.getElementById('matter-selector-modal');

    // Check for matter context from URL (for breadcrumb navigation)
    _matterId = _getQueryParam('id');
    if (_matterId) {
      _fetchMatterForBreadcrumb();
    }

    // Attach event listeners
    attachEventListeners();

    // Wire lex-ask-lana-btn → Skills Designer panel
    _initLanaPanel();

    // Set initial view (list is default)
    setViewMode('list');
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Search (grid view)
    if (searchInput) {
      searchInput.addEventListener('input', debounce(handleSearch, 300));
    }

    // Category filter (lex-select — fires lex-change)
    if (categoryFilter) {
      categoryFilter.addEventListener('lex-change', handleCategoryChange);
    }

    // View toggle (lex-btn components)
    if (gridViewBtn) {
      gridViewBtn.addEventListener('click', function() { setViewMode('grid'); });
    }
    if (listViewBtn) {
      listViewBtn.addEventListener('click', function() { setViewMode('list'); });
    }

    // Create Skill button — opens builder modal
    var createSkillBtn = document.getElementById('create-skill-btn');
    if (createSkillBtn) {
      createSkillBtn.addEventListener('click', function() {
        openSkillBuilder();
      });
    }

    // Learn More button — opens info modal
    var learnMoreBtn = document.getElementById('learnMoreBtn');
    if (learnMoreBtn) {
      learnMoreBtn.addEventListener('click', openLearnMoreModal);
    }

    // Learn More modal close
    var learnMoreCloseBtn = document.getElementById('learn-more-close-btn');
    if (learnMoreCloseBtn) {
      learnMoreCloseBtn.addEventListener('click', function() {
        var modal = document.getElementById('learn-more-modal');
        if (modal) modal.classList.add('hidden');
      });
    }

    // Import skill button
    var importSkillBtn = document.getElementById('import-skill-btn');
    if (importSkillBtn) {
      importSkillBtn.addEventListener('click', openSkillImportModal);
    }

    // Modal close buttons — covers all modals including import modal
    var modalCloseButtons = document.querySelectorAll('.modal-close');
    modalCloseButtons.forEach(function(btn) {
      btn.addEventListener('click', closeAllModals);
    });

    // Modal overlay clicks
    var modalOverlays = document.querySelectorAll('.modal-overlay');
    modalOverlays.forEach(function(overlay) {
      overlay.addEventListener('click', closeAllModals);
    });

    // Modal action buttons
    var modalCancelBtn = document.getElementById('modal-cancel-btn');
    if (modalCancelBtn) {
      modalCancelBtn.addEventListener('click', closeAllModals);
    }

    var modalInstallBtn = document.getElementById('modal-install-btn');
    if (modalInstallBtn) {
      modalInstallBtn.addEventListener('click', openMatterSelector);
    }

    var matterModalCancelBtn = document.getElementById('matter-modal-cancel-btn');
    if (matterModalCancelBtn) {
      matterModalCancelBtn.addEventListener('click', closeAllModals);
    }

    var matterModalInstallBtn = document.getElementById('matter-modal-install-btn');
    if (matterModalInstallBtn) {
      matterModalInstallBtn.addEventListener('click', installSkillToMatters);
    }

    // Matter search
    var matterSearchInput = document.getElementById('matter-search-input');
    if (matterSearchInput) {
      matterSearchInput.addEventListener('input', debounce(handleMatterSearch, 300));
    }

    // Skill import modal wiring
    var skillFileClearBtn = document.getElementById('skill-file-clear-btn');
    if (skillFileClearBtn) {
      skillFileClearBtn.addEventListener('click', clearSkillImportFile);
    }

    var skillImportCancelBtn = document.getElementById('skill-import-cancel-btn');
    if (skillImportCancelBtn) {
      skillImportCancelBtn.addEventListener('click', closeSkillImportModal);
    }

    var skillImportConfirmBtn = document.getElementById('skill-import-confirm-btn');
    if (skillImportConfirmBtn) {
      skillImportConfirmBtn.addEventListener('click', executeSkillImport);
    }

    var skillFileInput = document.getElementById('skill-file-input');
    if (skillFileInput) {
      skillFileInput.addEventListener('change', handleSkillFileSelect);
    }

    setupSkillImportDropZone();

    // Grid pagination
    if (gridPagination) {
      gridPagination.addEventListener('page-change', function(e) {
        gridPage = e.detail && e.detail.page ? e.detail.page : 1;
        renderGridView();
      });
    }

    // List view row-click — open skill in builder modal
    if (skillsListView) {
      skillsListView.addEventListener('row-click', function(e) {
        var row = e.detail && e.detail.row;
        if (row && row.skill_id) {
          openSkillBuilder(row.skill_id);
        }
      });
    }

    // Skill Builder modal buttons
    var closeSkillBuilderBtn = document.getElementById('closeSkillBuilderBtn');
    if (closeSkillBuilderBtn) {
      closeSkillBuilderBtn.addEventListener('click', closeSkillBuilder);
    }
    var cancelSkillBuilderBtn = document.getElementById('cancelSkillBuilderBtn');
    if (cancelSkillBuilderBtn) {
      cancelSkillBuilderBtn.addEventListener('click', closeSkillBuilder);
    }
    var saveSkillBtn = document.getElementById('saveSkillBtn');
    if (saveSkillBtn) {
      saveSkillBtn.addEventListener('click', saveSkill);
    }
    var addStepBtn = document.getElementById('addStepBtn');
    if (addStepBtn) {
      addStepBtn.addEventListener('click', addWorkflowStep);
    }

    // MX diagnostics live updates from skill name/description inputs
    var skillNameInput = document.getElementById('skill_name');
    if (skillNameInput) {
      skillNameInput.addEventListener('input', updateMXDiagnostics);
    }
    var skillDescInput = document.getElementById('skill_description');
    if (skillDescInput) {
      skillDescInput.addEventListener('input', updateMXDiagnostics);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Ask LANA panel integration (lex-lana-panel)
  // ═══════════════════════════════════════════════════════════════

  function _initLanaPanel() {
    // Panel is in the HTML template — nothing to inject
  }

  // ═══════════════════════════════════════════════════════════════
  // Learn More Modal
  // ═══════════════════════════════════════════════════════════════

  function openLearnMoreModal() {
    var modal = document.getElementById('learn-more-modal');
    if (modal) modal.classList.remove('hidden');
  }

  // ═══════════════════════════════════════════════════════════════
  // Skill Builder Modal
  // ═══════════════════════════════════════════════════════════════

  // Event definitions with descriptions (100+ events)
  var EVENT_DEFINITIONS = {
    'document.created': 'Triggered when a new document is created in the system',
    'document.updated': 'Triggered when document metadata or content is modified',
    'document.deleted': 'Triggered when a document is deleted',
    'document.uploaded': 'Triggered when a file is uploaded to the system',
    'document.processed': 'Triggered when document processing (OCR, parsing) completes',
    'document.indexed': 'Triggered when document is indexed for search',
    'document.shared': 'Triggered when a document is shared with users or external parties',
    'document.downloaded': 'Triggered when a document is downloaded',
    'document_version.created': 'Triggered when a new document version is created',
    'document_version.restored': 'Triggered when a previous document version is restored as current',
    'matter.created': 'Triggered when a new matter/case is created',
    'matter.updated': 'Triggered when matter details are modified',
    'matter.closed': 'Triggered when a matter is marked as closed',
    'matter.reopened': 'Triggered when a closed matter is reopened',
    'matter.archived': 'Triggered when a matter is archived',
    'matter.assigned': 'Triggered when a matter is assigned to a user or team',
    'matter.linked_to_workspace': 'Triggered when a matter is linked to a workspace',
    'matter.linked_to_matter': 'Triggered when a matter is linked to another matter',
    'matter.unlinked': 'Triggered when a matter is unlinked from a related entity',
    'workspace.linked_to_matter': 'Triggered when a workspace is linked to a matter',
    'entity_link.created': 'Triggered when an entity link is created between resources',
    'entity_link.deleted': 'Triggered when an entity link is deleted',
    'contact.created': 'Triggered when a new contact is added',
    'contact.updated': 'Triggered when contact information is modified',
    'contact.deleted': 'Triggered when a contact is deleted',
    'contact.linked_to_matter': 'Triggered when a contact is linked to a matter',
    'contact.unlinked_from_matter': 'Triggered when a contact is unlinked from a matter',
    'contact.synced_from_connector': 'Triggered when a contact is synced from an external connector',
    'lead.created': 'Triggered when a new lead is created',
    'lead.updated': 'Triggered when lead information is updated',
    'lead.deleted': 'Triggered when a lead is deleted',
    'lead.converted': 'Triggered when a lead is converted to an opportunity or matter',
    'opportunity.created': 'Triggered when a new opportunity is created',
    'opportunity.updated': 'Triggered when opportunity information is updated',
    'opportunity.closed_won': 'Triggered when an opportunity is closed as won',
    'opportunity.closed_lost': 'Triggered when an opportunity is closed as lost',
    'project.created': 'Triggered when a new project is created',
    'project.updated': 'Triggered when project information is updated',
    'project.completed': 'Triggered when a project is marked as completed',
    'project.archived': 'Triggered when a project is archived',
    'task.created': 'Triggered when a new task is created',
    'task.updated': 'Triggered when task details are modified',
    'task.completed': 'Triggered when a task is marked as complete',
    'task.deleted': 'Triggered when a task is deleted',
    'task.assigned': 'Triggered when a task is assigned to a user',
    'task.overdue': 'Triggered when a task becomes overdue',
    'checklist.created': 'Triggered when a new checklist is created',
    'checklist.completed': 'Triggered when all items in a checklist are completed',
    'checklist.deleted': 'Triggered when a checklist is deleted',
    'checklist_item.created': 'Triggered when a new checklist item is created',
    'checklist_item.completed': 'Triggered when a checklist item is marked as complete',
    'checklist_item.deleted': 'Triggered when a checklist item is deleted',
    'email.received': 'Triggered when an email is received',
    'email.sent': 'Triggered when an email is sent',
    'email.opened': 'Triggered when a sent email is opened by recipient',
    'email.bounced': 'Triggered when an email bounces (delivery failed)',
    'call.logged': 'Triggered when a phone call or meeting is logged',
    'call.completed': 'Triggered when a scheduled call is marked as completed',
    'conversation.created': 'Triggered when a new conversation thread is started',
    'conversation.updated': 'Triggered when a conversation is updated',
    'message.sent': 'Triggered when a message is sent',
    'message.received': 'Triggered when a message is received',
    'meeting.scheduled': 'Triggered when a meeting is scheduled',
    'meeting.completed': 'Triggered when a meeting ends',
    'calendar_event.created': 'Triggered when a calendar event is created',
    'calendar_event.updated': 'Triggered when a calendar event is updated',
    'calendar_event.deleted': 'Triggered when a calendar event is deleted',
    'calendar_event.rsvp': 'Triggered when a user responds to a calendar event invitation',
    'campaign.created': 'Triggered when a new campaign is created',
    'campaign.sent': 'Triggered when a campaign is sent to recipients',
    'campaign.opened': 'Triggered when a campaign email is opened',
    'milestone.created': 'Triggered when a new milestone is created',
    'milestone.completed': 'Triggered when a milestone is marked as completed',
    'milestone.missed': 'Triggered when a milestone deadline is missed',
    'note.created': 'Triggered when a new note is created',
    'note.updated': 'Triggered when a note is updated',
    'note.deleted': 'Triggered when a note is deleted',
    'workflow.started': 'Triggered when a workflow execution begins',
    'workflow.completed': 'Triggered when a workflow completes successfully',
    'workflow.failed': 'Triggered when a workflow fails',
    'custom_skill.created': 'Triggered when a new custom skill is created',
    'custom_skill.updated': 'Triggered when a custom skill is updated',
    'custom_skill.deleted': 'Triggered when a custom skill is deleted',
    'custom_skill.published': 'Triggered when a custom skill is published',
    'matter_skill.enabled': 'Triggered when a skill is enabled for a matter',
    'matter_skill.disabled': 'Triggered when a skill is disabled for a matter',
    'matter_skill.executed': 'Triggered when a skill executes successfully',
    'matter_skill.failed': 'Triggered when a skill execution fails',
    'connector.synced': 'Triggered when an integration sync completes',
    'connector.error': 'Triggered when an integration encounters an error',
    'integration.data_received': 'Triggered when data is received from external system',
    'user.login': 'Triggered when a user logs in',
    'user.logout': 'Triggered when a user logs out',
    'user.created': 'Triggered when a new user account is created',
    'user.updated': 'Triggered when user profile is updated',
    'invoice.created': 'Triggered when a new invoice is created',
    'invoice.sent': 'Triggered when an invoice is sent to client',
    'invoice.paid': 'Triggered when an invoice payment is received',
    'invoice.voided': 'Triggered when an invoice is voided',
    'expense.created': 'Triggered when a new expense is created',
    'expense.approved': 'Triggered when an expense is approved',
    'expense.rejected': 'Triggered when an expense is rejected',
    'expense.paid': 'Triggered when an expense is marked as paid',
    'disbursement.created': 'Triggered when a disbursement is created for a matter',
    'disbursement.approved': 'Triggered when a disbursement is approved',
    'disbursement.paid': 'Triggered when a disbursement payment is processed',
    'payment.received': 'Triggered when a payment is received from a client',
    'payment.refunded': 'Triggered when a payment is refunded to a client',
    'estimate.created': 'Triggered when a cost estimate is created for a matter',
    'estimate.sent': 'Triggered when an estimate is sent to client for review',
    'estimate.approved': 'Triggered when an estimate is approved by client',
    'budget.created': 'Triggered when a budget is created for a matter',
    'budget.updated': 'Triggered when budget parameters are updated',
    'budget.exceeded': 'Triggered when a budget threshold is exceeded',
    'time_entry.created': 'Triggered when a billable time entry is created',
    'time_entry.updated': 'Triggered when time entry details are updated',
    'time_entry.deleted': 'Triggered when a time entry is deleted',
    'trust_entry.created': 'Triggered when a trust account entry is created',
    'trust_entry.reconciled': 'Triggered when a trust entry is reconciled with bank statement',
    'notification.sent': 'Triggered when a notification is sent to a user',
    'reminder.triggered': 'Triggered when a scheduled reminder fires',
    'alert.created': 'Triggered when a system alert is created',
    'folder.created': 'Triggered when a new folder is created',
    'folder.renamed': 'Triggered when a folder is renamed',
    'folder.deleted': 'Triggered when a folder is deleted',
    'generated_document.created': 'Triggered when a document is generated from a template',
    'generated_document.failed': 'Triggered when document generation fails',
    'pipeline.created': 'Triggered when a new pipeline is created',
    'pipeline.updated': 'Triggered when pipeline configuration is updated',
    'pipeline.stage_changed': 'Triggered when an item moves to a different pipeline stage',
    'ai.analysis_completed': 'Triggered when AI analysis of content completes',
    'ai.summary_generated': 'Triggered when AI generates a summary',
    'ai.extraction_completed': 'Triggered when AI data extraction completes',
    'schedule.minutes': 'Runs on a recurring interval (every 30 minutes). Configure schedule in skill settings.',
    'schedule.hourly': 'Runs every N hours. Configure interval in skill settings.',
    'schedule.daily': 'Runs once per day at a configured time. Ideal for daily checks, reports, and maintenance tasks.',
    'schedule.weekly': 'Runs once per week on a configured day and time. Ideal for weekly digests and summaries.',
    'schedule.monthly': 'Runs once per month on a configured day. Ideal for monthly reports and billing cycles.'
  };

  /**
   * Build event type <option> groups for the trigger select
   */
  function buildEventOptions() {
    var groups = {
      'Document Events': ['document.created','document.updated','document.deleted','document.uploaded','document.processed','document.indexed','document.shared','document.downloaded','document_version.created','document_version.restored'],
      'Matter Events': ['matter.created','matter.updated','matter.closed','matter.reopened','matter.archived','matter.assigned','matter.linked_to_workspace','matter.linked_to_matter','matter.unlinked'],
      'Workspace Events': ['workspace.linked_to_matter'],
      'Entity Link Events': ['entity_link.created','entity_link.deleted'],
      'Contact Events': ['contact.created','contact.updated','contact.deleted','contact.linked_to_matter','contact.unlinked_from_matter','contact.synced_from_connector'],
      'Lead Events': ['lead.created','lead.updated','lead.deleted','lead.converted'],
      'Opportunity Events': ['opportunity.created','opportunity.updated','opportunity.closed_won','opportunity.closed_lost'],
      'Project Events': ['project.created','project.updated','project.completed','project.archived'],
      'Task Events': ['task.created','task.updated','task.completed','task.deleted','task.assigned','task.overdue'],
      'Checklist Events': ['checklist.created','checklist.completed','checklist.deleted'],
      'Checklist Item Events': ['checklist_item.created','checklist_item.completed','checklist_item.deleted'],
      'Email Events': ['email.received','email.sent','email.opened','email.bounced'],
      'Call Events': ['call.logged','call.completed'],
      'Communication Events': ['conversation.created','conversation.updated','message.sent','message.received','meeting.scheduled','meeting.completed'],
      'Calendar Events': ['calendar_event.created','calendar_event.updated','calendar_event.deleted','calendar_event.rsvp'],
      'Campaign Events': ['campaign.created','campaign.sent','campaign.opened'],
      'Milestone Events': ['milestone.created','milestone.completed','milestone.missed'],
      'Note Events': ['note.created','note.updated','note.deleted'],
      'Workflow Events': ['workflow.started','workflow.completed','workflow.failed'],
      'Custom Skill Events': ['custom_skill.created','custom_skill.updated','custom_skill.deleted','custom_skill.published'],
      'Matter Skill Events': ['matter_skill.enabled','matter_skill.disabled','matter_skill.executed','matter_skill.failed'],
      'Integration Events': ['connector.synced','connector.error','integration.data_received'],
      'User Events': ['user.login','user.logout','user.created','user.updated'],
      'Invoice Events': ['invoice.created','invoice.sent','invoice.paid','invoice.voided'],
      'Expense Events': ['expense.created','expense.approved','expense.rejected','expense.paid'],
      'Disbursement Events': ['disbursement.created','disbursement.approved','disbursement.paid'],
      'Payment Events': ['payment.received','payment.refunded'],
      'Estimate Events': ['estimate.created','estimate.sent','estimate.approved'],
      'Budget Events': ['budget.created','budget.updated','budget.exceeded'],
      'Time Entry Events': ['time_entry.created','time_entry.updated','time_entry.deleted'],
      'Trust Entry Events': ['trust_entry.created','trust_entry.reconciled'],
      'Notification Events': ['notification.sent','reminder.triggered','alert.created'],
      'Folder Events': ['folder.created','folder.renamed','folder.deleted'],
      'Generated Document Events': ['generated_document.created','generated_document.failed'],
      'Pipeline Events': ['pipeline.created','pipeline.updated','pipeline.stage_changed'],
      'AI Events': ['ai.analysis_completed','ai.summary_generated','ai.extraction_completed'],
      'Schedule Events': ['schedule.minutes','schedule.hourly','schedule.daily','schedule.weekly','schedule.monthly']
    };

    var html = '';
    var groupNames = Object.keys(groups);
    for (var g = 0; g < groupNames.length; g++) {
      var groupName = groupNames[g];
      var events = groups[groupName];
      html += '<optgroup label="' + groupName + '">';
      for (var i = 0; i < events.length; i++) {
        html += '<option value="' + events[i] + '">' + events[i] + '</option>';
      }
      html += '</optgroup>';
    }
    return html;
  }

  /**
   * Open the skill builder modal. Optionally load an existing skill.
   * @param {string} [skillId] - Skill ID to load for editing.
   */
  function openSkillBuilder(skillId) {
    var modal = document.getElementById('createSkillModal');
    if (!modal) return;

    // Reset builder state
    skillSteps = [];
    editingSkillId = skillId || null;
    mxDiagnostics = { parseability: 0, intentClarity: 'Unknown', triggerCount: 0, conditionCount: 0, actionCount: 0 };

    // Clear form
    var nameInput = document.getElementById('skill_name');
    var descInput = document.getElementById('skill_description');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';

    // Clear steps container
    var stepsContainer = document.getElementById('workflow-steps-container');
    if (stepsContainer) {
      // Remove all step elements but keep the connector rail
      var stepEls = stepsContainer.querySelectorAll('.workflow-step');
      for (var i = 0; i < stepEls.length; i++) {
        stepEls[i].remove();
      }
    }

    // Reset MX diagnostics display
    updateMXDiagnostics();

    // Update step count
    var stepCountEl = document.getElementById('workflow-step-count');
    if (stepCountEl) stepCountEl.textContent = '0';

    // Reset version display
    var versionDisplay = document.getElementById('skill-version-display');
    if (versionDisplay) {
      versionDisplay.textContent = '';
      versionDisplay.classList.add('hidden');
    }

    // If editing, load skill data
    if (skillId) {
      loadSkillIntoBuilder(skillId);
    }

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  /**
   * Load an existing skill into the builder for editing
   */
  function loadSkillIntoBuilder(skillId) {
    var baseUrl = window.api && window.api.baseUrl ? window.api.baseUrl : (window.LanaConfig && window.LanaConfig.API_BASE_URL ? window.LanaConfig.API_BASE_URL : '');
    fetch(baseUrl + '/api/v1/skills/' + encodeURIComponent(skillId), {
      headers: {
        'Authorization': 'Bearer ' + getAuthToken(),
        'Content-Type': 'application/json'
      }
    }).then(function(response) {
      if (!response.ok) throw new Error('Failed to fetch skill');
      return response.json();
    }).then(function(data) {
      var skill = data.skill || data.data || data;

      // Populate name and description
      var nameInput = document.getElementById('skill_name');
      var descInput = document.getElementById('skill_description');
      if (nameInput) nameInput.value = skill.skill_name || '';
      if (descInput) descInput.value = skill.skill_description || skill.description || '';

      // Load steps from skill_config
      var config = skill.skill_config || skill.config || {};
      var steps = config.steps || [];

      // If no steps array but has trigger/actions, build steps from legacy format
      if (steps.length === 0) {
        if (config.trigger) {
          addWorkflowStep();
          var lastStep = skillSteps[skillSteps.length - 1];
          if (lastStep) {
            lastStep.type = 'trigger';
            lastStep.config = config.trigger;
            var selectEl = document.getElementById('event-type-select-' + lastStep.id);
            if (selectEl && config.trigger.event_type) {
              selectEl.value = config.trigger.event_type;
              updateEventDescription(lastStep.id);
              updateStepStatus(lastStep.id, true);
            }
          }
        }
        if (config.actions && config.actions.length > 0) {
          for (var a = 0; a < config.actions.length; a++) {
            addWorkflowStep();
            var actionStep = skillSteps[skillSteps.length - 1];
            if (actionStep) {
              var actionType = config.actions[a].action_type || 'ai-action';
              var rawActionType = config.actions[a].action_type || '';
              if (actionType.indexOf('ai') === 0) actionType = 'ai-action';
              else if (actionType.indexOf('database') === 0) actionType = 'database';
              else if (actionType.indexOf('notification') === 0) actionType = 'notification';
              else if (actionType.indexOf('connector') === 0 || actionType.indexOf('integration') === 0) actionType = 'integration';
              else if (actionType.indexOf('text') === 0 || actionType.indexOf('artifact') === 0 || actionType.indexOf('document') === 0) actionType = 'transform';
              else actionType = 'ai-action';
              updateStepType(actionStep.id, actionType);
              var typeSelector = document.querySelector('[data-step-id="' + actionStep.id + '"] .step-type-selector');
              if (typeSelector) typeSelector.value = actionType;
              // Populate action config from saved data
              if (config.actions[a].config) {
                var populateConfig = config.actions[a].config;
                // For database steps, derive operation from backend action_type
                if (actionType === 'database' && !populateConfig.operation) {
                  if (rawActionType.indexOf('insert') !== -1) populateConfig.operation = 'insert';
                  else if (rawActionType.indexOf('update') !== -1) populateConfig.operation = 'update';
                  else populateConfig.operation = 'query';
                }
                // For transform steps, derive operation from backend action_type
                if (actionType === 'transform' && !populateConfig.operation) {
                  if (rawActionType.indexOf('diff') !== -1) populateConfig.operation = 'map';
                  else if (rawActionType.indexOf('merge') !== -1 || rawActionType.indexOf('Merge') !== -1) populateConfig.operation = 'merge';
                  else if (rawActionType.indexOf('filter') !== -1) populateConfig.operation = 'filter';
                  else if (rawActionType.indexOf('split') !== -1) populateConfig.operation = 'split';
                  else populateConfig.operation = 'map';
                }
                // For AI action steps, derive task from backend action_type and normalize prompt field
                if (actionType === 'ai-action') {
                  if (!populateConfig.task) {
                    if (rawActionType.indexOf('extract') !== -1) populateConfig.task = 'extract';
                    else if (rawActionType.indexOf('classify') !== -1 || rawActionType.indexOf('chat') !== -1) populateConfig.task = 'classify';
                    else if (rawActionType.indexOf('generate') !== -1 || rawActionType.indexOf('Generate') !== -1) populateConfig.task = 'generate';
                    else if (rawActionType.indexOf('analyze') !== -1 || rawActionType.indexOf('Analyze') !== -1) populateConfig.task = 'summarize';
                    else populateConfig.task = 'summarize';
                  }
                  if (!populateConfig.prompt_template && populateConfig.prompt) {
                    populateConfig.prompt_template = populateConfig.prompt;
                  }
                }
                // For notification steps, derive notification_type from backend action_type
                if (actionType === 'notification' && !populateConfig.notification_type) {
                  if (rawActionType.indexOf('createTask') !== -1) populateConfig.notification_type = 'create_task';
                  else if (rawActionType.indexOf('logActivity') !== -1) populateConfig.notification_type = 'log_activity';
                  else populateConfig.notification_type = 'send_notification';
                }
                populateStepConfigFromData(actionStep.id, actionType, populateConfig);
                actionStep.config = populateConfig;
              }
              // Load step description if present
              var stepDesc = config.actions[a].description || '';
              if (stepDesc) {
                actionStep.description = stepDesc;
                // Also populate inferred intent from description if no explicit intent
                if (!actionStep.inferred_intent) {
                  actionStep.inferred_intent = stepDesc;
                  var intentEl = document.querySelector('[data-step-id="' + actionStep.id + '"] input[placeholder]');
                  if (intentEl) intentEl.value = stepDesc;
                }
                var descContainer = document.getElementById('desc-' + actionStep.id);
                if (descContainer) {
                  descContainer.classList.remove('hidden');
                  var descText = descContainer.querySelector('.step-description-text');
                  if (descText) descText.textContent = stepDesc;
                }
              }
            }
          }
        }
      } else {
        // Load steps from steps array
        for (var s = 0; s < steps.length; s++) {
          addWorkflowStep();
          var step = skillSteps[skillSteps.length - 1];
          if (step && steps[s].type) {
            updateStepType(step.id, steps[s].type);
            var selector = document.querySelector('[data-step-id="' + step.id + '"] .step-type-selector');
            if (selector) selector.value = steps[s].type;
            if (steps[s].inferred_intent) {
              step.inferred_intent = steps[s].inferred_intent;
              var intentInput = document.querySelector('[data-step-id="' + step.id + '"] input[placeholder]');
              if (intentInput) intentInput.value = steps[s].inferred_intent;
            }
            // Populate step config from saved data
            if (steps[s].config) {
              populateStepConfigFromData(step.id, steps[s].type, steps[s].config);
              step.config = steps[s].config;
            }
            // Load step description if present
            if (steps[s].description) {
              step.description = steps[s].description;
              var descCont = document.getElementById('desc-' + step.id);
              if (descCont) {
                descCont.classList.remove('hidden');
                var descTxt = descCont.querySelector('.step-description-text');
                if (descTxt) descTxt.textContent = steps[s].description;
              }
            }
          }
        }
      }

      // Show version badge if editing
      var versionDisplay = document.getElementById('skill-version-display');
      if (versionDisplay && skill.skill_version) {
        versionDisplay.textContent = 'v' + skill.skill_version;
        versionDisplay.classList.remove('hidden');
      }

      updateMXDiagnostics();
    }).catch(function(err) {
      console.error('[Skills Builder] Failed to load skill:', err);
      showToast('Failed to load skill for editing', 'error');
    });
  }

  /**
   * Close the skill builder modal
   */
  function closeSkillBuilder() {
    var modal = document.getElementById('createSkillModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    // Reset state
    skillSteps = [];
    editingSkillId = null;
    mxDiagnostics = { parseability: 0, intentClarity: 'Unknown', triggerCount: 0, conditionCount: 0, actionCount: 0 };
  }

  /**
   * Add a new workflow step to the builder
   */
  function addWorkflowStep() {
    var container = document.getElementById('workflow-steps-container');
    if (!container) return;

    var stepIndex = skillSteps.length;
    var stepId = 'step-' + Date.now() + '-' + stepIndex;

    var stepData = {
      id: stepId,
      type: 'trigger',
      config: {},
      inferred_intent: ''
    };

    skillSteps.push(stepData);

    var stepHtml = '<div class="workflow-step relative" data-step-id="' + stepId + '">'
      + '<div class="absolute left-6 top-8 w-4 h-4 rounded-full bg-purple-500 ring-4 ring-purple-100 z-10"></div>'
      + '<div class="ml-14 bg-white rounded-lg border border-gray-200 p-5 hover:border-purple-300 hover:shadow-md transition-all group">'
      + '<div class="flex items-start justify-between mb-4">'
      + '<div class="flex items-center gap-3">'
      + '<div class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center step-icon-wrapper">'
      + '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>'
      + '</div>'
      + '<div class="flex-1">'
      + '<select class="step-type-selector bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-gray-900 text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500" data-step-id="' + stepId + '">'
      + '<option value="trigger">Trigger</option>'
      + '<option value="condition">Condition</option>'
      + '<option value="ai-action">AI Action</option>'
      + '<option value="database">Database</option>'
      + '<option value="notification">Notification</option>'
      + '<option value="integration">Integration</option>'
      + '<option value="transform">Transform</option>'
      + '</select>'
      + '<code class="block mt-1 text-xs font-mono text-gray-500">step_' + (stepIndex + 1) + '.*</code>'
      + '</div></div>'
      + '<button class="remove-step-btn text-gray-400 hover:text-red-600 transition-colors" data-step-id="' + stepId + '">'
      + '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>'
      + '</button></div>'
      + '<div class="mb-4">'
      + '<label class="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Inferred Intent</label>'
      + '<input type="text" class="step-intent-input w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm" placeholder="e.g., Detect when new litigation document is uploaded" data-step-id="' + stepId + '">'
      + '</div>'
      + '<div class="step-description-container mb-4 hidden" id="desc-' + stepId + '">'
      + '<p class="text-xs text-gray-600 italic bg-gray-50 rounded-md px-3 py-2 border border-gray-100 step-description-text"></p>'
      + '</div>'
      + '<div class="step-config-container" id="config-' + stepId + '"></div>'
      + '<div class="mt-4 flex items-center gap-2 text-xs">'
      + '<div id="status-needs-' + stepId + '" class="step-status-needs flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200">'
      + '<div class="w-1.5 h-1.5 rounded-full bg-amber-500"></div>'
      + '<span class="text-amber-700 font-medium">Needs Configuration</span>'
      + '</div>'
      + '<div id="status-ready-' + stepId + '" class="step-status-ready flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 border border-green-200 hidden">'
      + '<div class="w-1.5 h-1.5 rounded-full bg-green-500"></div>'
      + '<span class="text-green-700 font-medium">Configured</span>'
      + '</div>'
      + '<code class="ml-auto text-gray-500 font-mono">{{step_' + (stepIndex + 1) + '.output}}</code>'
      + '</div></div></div>';

    container.insertAdjacentHTML('beforeend', stepHtml);

    // Attach event listeners for this step
    var stepEl = container.querySelector('[data-step-id="' + stepId + '"]');
    if (stepEl) {
      var typeSelect = stepEl.querySelector('.step-type-selector');
      if (typeSelect) {
        typeSelect.addEventListener('change', function() {
          updateStepType(stepId, this.value);
        });
      }
      var removeBtn = stepEl.querySelector('.remove-step-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', function() {
          removeWorkflowStep(stepId);
        });
      }
      var intentInput = stepEl.querySelector('.step-intent-input');
      if (intentInput) {
        intentInput.addEventListener('change', function() {
          updateStepIntent(stepId, this.value);
        });
      }
    }

    // Initialize step configuration UI
    updateStepConfigUI(stepId, 'trigger');

    // Update MX diagnostics
    mxDiagnostics.triggerCount++;
    updateMXDiagnostics();

    // Update step count display
    var stepCountEl = document.getElementById('workflow-step-count');
    if (stepCountEl) stepCountEl.textContent = String(skillSteps.length);
  }

  /**
   * Update step type and refresh configuration UI
   */
  function updateStepType(stepId, type) {
    var step = null;
    for (var i = 0; i < skillSteps.length; i++) {
      if (skillSteps[i].id === stepId) { step = skillSteps[i]; break; }
    }
    if (!step) return;

    // Update step counts
    if (step.type === 'trigger') mxDiagnostics.triggerCount--;
    else if (step.type === 'condition') mxDiagnostics.conditionCount--;
    else mxDiagnostics.actionCount--;

    step.type = type;
    step.config = {};

    if (type === 'trigger') mxDiagnostics.triggerCount++;
    else if (type === 'condition') mxDiagnostics.conditionCount++;
    else mxDiagnostics.actionCount++;

    // Update icon color and SVG
    var stepEl = document.querySelector('[data-step-id="' + stepId + '"]');
    if (stepEl) {
      var iconWrapper = stepEl.querySelector('.step-icon-wrapper');
      if (iconWrapper) {
        var colorMap = {
          'trigger': 'bg-blue-600',
          'condition': 'bg-amber-600',
          'ai-action': 'bg-green-600',
          'database': 'bg-indigo-600',
          'notification': 'bg-rose-600',
          'integration': 'bg-purple-600',
          'transform': 'bg-cyan-600'
        };
        iconWrapper.className = 'w-10 h-10 rounded-lg flex items-center justify-center step-icon-wrapper ' + (colorMap[type] || 'bg-blue-600');

        var iconSvgMap = {
          'trigger': '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
          'condition': '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
          'ai-action': '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path></svg>',
          'database': '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path></svg>',
          'notification': '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>',
          'integration': '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>',
          'transform': '<svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>'
        };
        var iconEl = iconWrapper.querySelector('.step-icon');
        if (iconEl) {
          iconWrapper.innerHTML = iconSvgMap[type] || iconSvgMap['trigger'];
        }
      }
    }

    updateStepConfigUI(stepId, type);
    updateMXDiagnostics();
  }

  /**
   * Update step configuration UI based on type
   */
  function updateStepConfigUI(stepId, type) {
    var configContainer = document.getElementById('config-' + stepId);
    if (!configContainer) return;

    var configHtml = '';

    if (type === 'trigger') {
      configHtml = '<div class="space-y-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Event Type</label>'
        + '<select id="event-type-select-' + stepId + '" class="event-type-select w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500" data-step-id="' + stepId + '">'
        + buildEventOptions()
        + '</select>'
        + '<div id="event-description-' + stepId + '" class="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">'
        + '<p class="text-xs text-blue-800"><strong>Description:</strong> ' + EVENT_DEFINITIONS['document.created'] + '</p>'
        + '</div></div></div>';
    } else if (type === 'condition') {
      configHtml = '<div class="space-y-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Field to Check</label>'
        + '<input type="text" placeholder="e.g., trigger.data.fileType" class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '</div><div class="grid grid-cols-2 gap-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Operator</label>'
        + '<select class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '<option value="equals">equals</option>'
        + '<option value="contains">contains</option>'
        + '<option value="greater_than">greater than</option>'
        + '<option value="less_than">less than</option>'
        + '</select></div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Value</label>'
        + '<input type="text" placeholder="e.g., .pdf" class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '</div></div></div>';
    } else if (type === 'ai-action') {
      configHtml = '<div class="space-y-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">AI Task</label>'
        + '<select class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '<option value="summarize">Summarize Document</option>'
        + '<option value="extract">Extract Key Information</option>'
        + '<option value="classify">Classify Content</option>'
        + '<option value="generate">Generate Text</option>'
        + '</select></div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Prompt Template</label>'
        + '<textarea rows="3" placeholder="Summarize the key points from {{trigger.data.document}}..." class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"></textarea>'
        + '</div></div>';
    } else if (type === 'database') {
      configHtml = '<div class="space-y-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Operation</label>'
        + '<select class="db-operation-select w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '<option value="insert">Insert Record</option>'
        + '<option value="query">Query Records</option>'
        + '<option value="update">Update Record</option>'
        + '</select></div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Table</label>'
        + '<select class="db-table-select w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '<optgroup label="Document Tables">'
        + '<option value="documents">Documents</option>'
        + '<option value="document_chunks">Document Chunks</option>'
        + '<option value="document_metadata">Document Metadata</option>'
        + '</optgroup>'
        + '<optgroup label="Matter Tables">'
        + '<option value="client_matters">Client Matters</option>'
        + '<option value="matter_contacts">Matter Contacts</option>'
        + '<option value="matter_documents">Matter Documents</option>'
        + '<option value="matter_notes">Matter Notes</option>'
        + '</optgroup>'
        + '<optgroup label="Workflow Tables">'
        + '<option value="workflows">Workflows</option>'
        + '<option value="workflow_executions">Workflow Executions</option>'
        + '<option value="workflow_steps">Workflow Steps</option>'
        + '</optgroup>'
        + '<optgroup label="Integration Tables">'
        + '<option value="connector_data">Connector Data</option>'
        + '<option value="integration_sources">Integration Sources</option>'
        + '</optgroup>'
        + '<optgroup label="Skill Tables">'
        + '<option value="custom_skills">Custom Skills</option>'
        + '<option value="skill_executions">Skill Executions</option>'
        + '<option value="skill_artifacts">Skill Artifacts</option>'
        + '</optgroup>'
        + '</select></div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Data (JSON)</label>'
        + '<textarea rows="4" class="db-data-input w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm font-mono resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500" placeholder=\'{"title": "Example", "content": "{{trigger.data.value}}"}\'></textarea>'
        + '<p class="mt-1 text-xs text-gray-500">Use <code>{{trigger.*}}</code> template variables for dynamic values. Fields like organization_id, matter_id, and created_by are auto-injected.</p>'
        + '</div></div>';
    } else if (type === 'notification') {
      configHtml = '<div class="space-y-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Notification Type</label>'
        + '<select class="notification-type-select w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '<option value="create_task">Create Task</option>'
        + '<option value="send_notification">Send In-App Notification</option>'
        + '<option value="log_activity">Log Activity</option>'
        + '</select></div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Title / Subject</label>'
        + '<input type="text" class="notification-title-input w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500" placeholder="e.g., Review overdue invoices">'
        + '</div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Message</label>'
        + '<textarea rows="3" class="notification-message-input w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500" placeholder="Use {{actions.*.result}} for dynamic content"></textarea>'
        + '<p class="mt-1 text-xs text-gray-500">Recipients are auto-resolved from the matter\'s assigned users.</p>'
        + '</div></div>';
    } else if (type === 'integration') {
      configHtml = '<div class="space-y-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Action Type</label>'
        + '<select class="integration-action-select w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '<option value="update_crm">Update CRM</option>'
        + '<option value="webhook">Webhook</option>'
        + '<option value="connector_execute">Connector Action</option>'
        + '</select></div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Configuration</label>'
        + '<textarea rows="3" class="integration-data-input w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm font-mono resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500" placeholder=\'{"endpoint": "/api/v1/...", "data": {}}\'></textarea>'
        + '<p class="mt-1 text-xs text-gray-500">JSON config for connector parameters. Supports <code>{{variable}}</code> syntax.</p>'
        + '</div></div>';
    } else if (type === 'transform') {
      configHtml = '<div class="space-y-3"><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Operation</label>'
        + '<select class="transform-operation-select w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">'
        + '<option value="map">Map Fields</option>'
        + '<option value="filter">Filter Data</option>'
        + '<option value="merge">Merge Objects</option>'
        + '<option value="split">Split String</option>'
        + '</select></div><div>'
        + '<label class="block text-xs font-medium text-gray-700 mb-1.5">Configuration</label>'
        + '<textarea rows="3" class="transform-data-input w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm font-mono resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500" placeholder=\'{"field": "{{trigger.data.value}}"}\'></textarea>'
        + '<p class="mt-1 text-xs text-gray-500">JSON config for this operation. Supports <code>{{variable}}</code> syntax.</p>'
        + '</div></div>';
    }

    configContainer.innerHTML = configHtml;

    // Attach event listener to event type select (trigger type)
    if (type === 'trigger') {
      var eventSelect = document.getElementById('event-type-select-' + stepId);
      if (eventSelect) {
        eventSelect.addEventListener('change', function() {
          updateEventDescription(stepId);
        });
      }
    }

    // Attach live-sync listeners for all form elements in this step
    var allSelects = configContainer.querySelectorAll('select');
    var allInputs = configContainer.querySelectorAll('input');
    var allTextareas = configContainer.querySelectorAll('textarea');

    var syncHandler = function() {
      for (var s = 0; s < skillSteps.length; s++) {
        if (skillSteps[s].id === stepId) {
          skillSteps[s].config = collectStepConfig(stepId, type);
          break;
        }
      }
      updateStepStatus(stepId, true);
      debouncedUpdateMXDiagnostics();
    };

    for (var si = 0; si < allSelects.length; si++) {
      allSelects[si].addEventListener('change', syncHandler);
    }
    for (var ii = 0; ii < allInputs.length; ii++) {
      allInputs[ii].addEventListener('input', syncHandler);
    }
    for (var ti = 0; ti < allTextareas.length; ti++) {
      allTextareas[ti].addEventListener('input', syncHandler);
    }
  }

  /**
   * Update step inferred intent
   */
  function updateStepIntent(stepId, intent) {
    for (var i = 0; i < skillSteps.length; i++) {
      if (skillSteps[i].id === stepId) {
        skillSteps[i].inferred_intent = intent;
        break;
      }
    }
    updateMXDiagnostics();
  }

  /**
   * Update event description when user selects a different event type
   */
  function updateEventDescription(stepId) {
    var selectEl = document.getElementById('event-type-select-' + stepId);
    var descEl = document.getElementById('event-description-' + stepId);
    if (selectEl && descEl) {
      var selectedEvent = selectEl.value;
      var description = EVENT_DEFINITIONS[selectedEvent] || 'No description available';
      descEl.innerHTML = '<p class="text-xs text-blue-800"><strong>Description:</strong> ' + escapeHtml(description) + '</p>';
    }
  }

  /**
   * Remove a workflow step
   */
  function removeWorkflowStep(stepId) {
    var stepEl = document.querySelector('[data-step-id="' + stepId + '"]');
    if (stepEl) stepEl.remove();

    var stepIndex = -1;
    for (var i = 0; i < skillSteps.length; i++) {
      if (skillSteps[i].id === stepId) { stepIndex = i; break; }
    }
    if (stepIndex !== -1) {
      var step = skillSteps[stepIndex];
      if (step.type === 'trigger') mxDiagnostics.triggerCount--;
      else if (step.type === 'condition') mxDiagnostics.conditionCount--;
      else mxDiagnostics.actionCount--;

      skillSteps.splice(stepIndex, 1);
      updateMXDiagnostics();
    }

    var stepCountEl = document.getElementById('workflow-step-count');
    if (stepCountEl) stepCountEl.textContent = String(skillSteps.length);
  }

  /**
   * Update MX diagnostics panel
   */
  function updateMXDiagnostics() {
    var parseabilityScore = 0;

    var skillName = '';
    var nameInput = document.getElementById('skill_name');
    if (nameInput) skillName = nameInput.value || '';
    if (skillName.length > 0) parseabilityScore += 20;

    var skillDesc = '';
    var descInput = document.getElementById('skill_description');
    if (descInput) skillDesc = descInput.value || '';
    if (skillDesc.length > 20) parseabilityScore += 20;

    if (mxDiagnostics.triggerCount > 0) parseabilityScore += 20;
    if (skillSteps.length >= 2) parseabilityScore += 20;
    if (mxDiagnostics.actionCount > 0) parseabilityScore += 20;

    mxDiagnostics.parseability = parseabilityScore;

    if (skillDesc.length > 50) {
      mxDiagnostics.intentClarity = 'High';
    } else if (skillDesc.length > 20) {
      mxDiagnostics.intentClarity = 'Medium';
    } else if (skillDesc.length > 0) {
      mxDiagnostics.intentClarity = 'Low';
    } else {
      mxDiagnostics.intentClarity = 'Unknown';
    }

    // Update UI
    var parseabilityScoreEl = document.getElementById('mx-parseability-score');
    var parseabilityBarEl = document.getElementById('mx-parseability-bar');
    var intentScoreEl = document.getElementById('mx-intent-score');
    var stepCountEl = document.getElementById('mx-step-count');
    var triggerCountEl = document.getElementById('mx-trigger-count');
    var conditionCountEl = document.getElementById('mx-condition-count');
    var actionCountEl = document.getElementById('mx-action-count');

    if (parseabilityScoreEl) parseabilityScoreEl.textContent = parseabilityScore + '%';
    if (parseabilityBarEl) parseabilityBarEl.style.width = parseabilityScore + '%';
    if (intentScoreEl) {
      intentScoreEl.textContent = mxDiagnostics.intentClarity;
      var clarityClass = 'text-gray-600';
      if (mxDiagnostics.intentClarity === 'High') clarityClass = 'text-emerald-600';
      else if (mxDiagnostics.intentClarity === 'Medium') clarityClass = 'text-purple-600';
      else if (mxDiagnostics.intentClarity === 'Low') clarityClass = 'text-amber-600';
      intentScoreEl.className = 'text-sm font-bold font-mono ' + clarityClass;
    }
    if (stepCountEl) stepCountEl.textContent = skillSteps.length + ' step' + (skillSteps.length !== 1 ? 's' : '');
    if (triggerCountEl) triggerCountEl.textContent = String(mxDiagnostics.triggerCount);
    if (conditionCountEl) conditionCountEl.textContent = String(mxDiagnostics.conditionCount);
    if (actionCountEl) actionCountEl.textContent = String(mxDiagnostics.actionCount);
  }

  /**
   * Collect config values from the DOM for a given step.
   * Each step type has different form fields inside #config-{stepId}.
   *
   * @param {string} stepId - The step DOM id
   * @param {string} stepType - One of: trigger, condition, ai-action, integration, transform
   * @returns {Object} Config object for this step
   */
  function collectStepConfig(stepId, stepType) {
    var container = document.getElementById('config-' + stepId);
    if (!container) return {};

    var config = {};

    if (stepType === 'trigger') {
      var eventSelect = document.getElementById('event-type-select-' + stepId);
      if (eventSelect) {
        config.event_type = eventSelect.value;
      }
    } else if (stepType === 'condition') {
      var inputs = container.querySelectorAll('input[type="text"]');
      var selects = container.querySelectorAll('select');
      if (inputs.length >= 1) config.field = inputs[0].value;
      if (selects.length >= 1) config.operator = selects[0].value;
      if (inputs.length >= 2) config.value = inputs[1].value;
    } else if (stepType === 'ai-action') {
      var aiSelects = container.querySelectorAll('select');
      var textareas = container.querySelectorAll('textarea');
      if (aiSelects.length >= 1) config.task = aiSelects[0].value;
      if (textareas.length >= 1) config.prompt_template = textareas[0].value;
    } else if (stepType === 'database') {
      var dbOpSelect = container.querySelector('.db-operation-select');
      var dbTableSelect = container.querySelector('.db-table-select');
      var dbDataInput = container.querySelector('.db-data-input');
      if (dbOpSelect) config.operation = dbOpSelect.value;
      if (dbTableSelect) config.table = dbTableSelect.value;
      if (dbDataInput && dbDataInput.value.trim()) {
        try {
          config.data = JSON.parse(dbDataInput.value.trim());
        } catch (e) {
          config.data_raw = dbDataInput.value.trim();
        }
      }
    } else if (stepType === 'notification') {
      var notifTypeSelect = container.querySelector('.notification-type-select');
      var notifTitleInput = container.querySelector('.notification-title-input');
      var notifMsgInput = container.querySelector('.notification-message-input');
      if (notifTypeSelect) config.notification_type = notifTypeSelect.value;
      if (notifTitleInput) config.title = notifTitleInput.value;
      if (notifMsgInput) config.message = notifMsgInput.value;
    } else if (stepType === 'integration') {
      var intActionSelect = container.querySelector('.integration-action-select');
      var intDataInput = container.querySelector('.integration-data-input');
      if (intActionSelect) config.action_type = intActionSelect.value;
      if (intDataInput && intDataInput.value.trim()) {
        try {
          var intParsed = JSON.parse(intDataInput.value.trim());
          var intParsedKeys = Object.keys(intParsed);
          for (var ipk = 0; ipk < intParsedKeys.length; ipk++) {
            config[intParsedKeys[ipk]] = intParsed[intParsedKeys[ipk]];
          }
        } catch (e) {
          config.data_raw = intDataInput.value.trim();
        }
      }
    } else if (stepType === 'transform') {
      var txOpSelect = container.querySelector('.transform-operation-select');
      var txDataInput = container.querySelector('.transform-data-input');
      if (txOpSelect) config.operation = txOpSelect.value;
      if (txDataInput && txDataInput.value.trim()) {
        try {
          var txParsed = JSON.parse(txDataInput.value.trim());
          var txParsedKeys = Object.keys(txParsed);
          for (var tpk = 0; tpk < txParsedKeys.length; tpk++) {
            config[txParsedKeys[tpk]] = txParsed[txParsedKeys[tpk]];
          }
        } catch (e) {
          config.data_raw = txDataInput.value.trim();
        }
      }
    }

    return config;
  }

  /**
   * Map a frontend step type + config to a backend action_type string.
   * @param {string} stepType - 'ai-action', 'integration', or 'transform'
   * @param {Object} stepCfg - Collected config from the DOM
   * @returns {string} Backend action_type
   */
  function mapStepToActionType(stepType, stepCfg) {
    if (stepType === 'ai-action') {
      var aiTask = stepCfg.task || 'summarize';
      if (aiTask === 'extract') return 'ai.extractEntities';
      if (aiTask === 'classify') return 'ai.chat';
      if (aiTask === 'generate') return 'ai.generateText';
      return 'ai.generate';
    }
    if (stepType === 'database') {
      var op = stepCfg.operation || 'insert';
      if (op === 'query') return 'database.query';
      if (op === 'update') return 'database.update';
      return 'database.insert';
    }
    if (stepType === 'notification') {
      var nt = stepCfg.notification_type || '';
      if (nt === 'create_task') return 'notification.createTask';
      if (nt === 'log_activity') return 'notification.logActivity';
      return 'notification.send';
    }
    if (stepType === 'integration') {
      var at = stepCfg.action_type || '';
      if (at === 'webhook') return 'connector.webhook';
      return 'connector.execute';
    }
    if (stepType === 'transform') {
      return 'text.template';
    }
    return 'ai.generate';
  }

  /**
   * Build the action config object for the backend from frontend step config.
   * @param {string} stepType - 'ai-action', 'integration', or 'transform'
   * @param {Object} stepCfg - Collected config from the DOM
   * @returns {Object} Backend-compatible action config
   */
  function buildActionConfig(stepType, stepCfg) {
    if (stepType === 'ai-action') {
      return {
        task: stepCfg.task || 'summarize',
        prompt_template: stepCfg.prompt_template || '',
        prompt: stepCfg.prompt_template || ''
      };
    }
    if (stepType === 'database') {
      var dbConfig = {
        table: stepCfg.table || 'matter_notes'
      };
      if (stepCfg.data) dbConfig.data = stepCfg.data;
      else if (stepCfg.data_raw) dbConfig.data_raw = stepCfg.data_raw;
      return dbConfig;
    }
    if (stepType === 'notification') {
      return {
        notification_type: stepCfg.notification_type || 'create_task',
        title: stepCfg.title || '',
        message: stepCfg.message || ''
      };
    }
    if (stepType === 'integration') {
      var intConfig = { action_type: stepCfg.action_type || 'connector_execute' };
      var intExtraKeys = Object.keys(stepCfg);
      for (var ixi = 0; ixi < intExtraKeys.length; ixi++) {
        if (intExtraKeys[ixi] !== 'action_type') {
          intConfig[intExtraKeys[ixi]] = stepCfg[intExtraKeys[ixi]];
        }
      }
      return intConfig;
    }
    if (stepType === 'transform') {
      var txConfig = { operation: stepCfg.operation || 'map' };
      // Merge any additional config fields from the textarea
      var txExtraKeys = Object.keys(stepCfg);
      for (var txi = 0; txi < txExtraKeys.length; txi++) {
        if (txExtraKeys[txi] !== 'operation') {
          txConfig[txExtraKeys[txi]] = stepCfg[txExtraKeys[txi]];
        }
      }
      return txConfig;
    }
    return {};
  }

  /**
   * Populate step config form fields from saved data (for round-trip editing).
   * @param {string} stepId - The step DOM id
   * @param {string} stepType - Step type
   * @param {Object} configData - Saved config data to restore
   */
  function populateStepConfigFromData(stepId, stepType, configData) {
    if (!configData) return;
    var container = document.getElementById('config-' + stepId);
    if (!container) return;

    if (stepType === 'trigger') {
      var eventSelect = document.getElementById('event-type-select-' + stepId);
      if (eventSelect && configData.event_type) {
        eventSelect.value = configData.event_type;
        updateEventDescription(stepId);
      }
    } else if (stepType === 'condition') {
      var inputs = container.querySelectorAll('input[type="text"]');
      var selects = container.querySelectorAll('select');
      if (inputs.length >= 1 && configData.field !== undefined) inputs[0].value = configData.field;
      if (selects.length >= 1 && configData.operator) selects[0].value = configData.operator;
      if (inputs.length >= 2 && configData.value !== undefined) inputs[1].value = configData.value;
    } else if (stepType === 'ai-action') {
      var aiSelects = container.querySelectorAll('select');
      var textareas = container.querySelectorAll('textarea');
      var taskVal = configData.task || '';
      var promptVal = configData.prompt_template || configData.prompt || '';
      if (aiSelects.length >= 1 && taskVal) aiSelects[0].value = taskVal;
      if (textareas.length >= 1 && promptVal) textareas[0].value = promptVal;
    } else if (stepType === 'database') {
      var dbOpSelect = container.querySelector('.db-operation-select');
      var dbTableSelect = container.querySelector('.db-table-select');
      var dbDataInput = container.querySelector('.db-data-input');
      if (dbOpSelect && configData.operation) dbOpSelect.value = configData.operation;
      if (dbTableSelect && configData.table) dbTableSelect.value = configData.table;
      // Populate data textarea from data, where, or full config
      var dbDataVal = configData.data || configData.where || null;
      if (!dbDataVal) {
        // Show remaining config fields as JSON (exclude operation/table already in form)
        var remainingCfg = {};
        var dbKeys = Object.keys(configData);
        for (var dk = 0; dk < dbKeys.length; dk++) {
          if (dbKeys[dk] !== 'operation' && dbKeys[dk] !== 'table') {
            remainingCfg[dbKeys[dk]] = configData[dbKeys[dk]];
          }
        }
        if (Object.keys(remainingCfg).length > 0) dbDataVal = remainingCfg;
      }
      if (dbDataInput && dbDataVal) {
        dbDataInput.value = JSON.stringify(dbDataVal, null, 2);
      }
    } else if (stepType === 'notification') {
      var notifTypeSelect = container.querySelector('.notification-type-select');
      var notifTitleInput = container.querySelector('.notification-title-input');
      var notifMsgInput = container.querySelector('.notification-message-input');
      if (notifTypeSelect && configData.notification_type) notifTypeSelect.value = configData.notification_type;
      var titleVal = configData.title || configData.subject || configData.event_type || '';
      var msgVal = configData.message || configData.body || '';
      // For log_activity type, build message from resource fields if no message
      if (!msgVal && configData.resource_type) {
        msgVal = configData.resource_type + (configData.resource_id ? ': ' + configData.resource_id : '')
          + (configData.resource_name ? ' (' + configData.resource_name + ')' : '');
      }
      if (notifTitleInput && titleVal) notifTitleInput.value = titleVal;
      if (notifMsgInput && msgVal) notifMsgInput.value = msgVal;
    } else if (stepType === 'integration') {
      var intActionSelect = container.querySelector('.integration-action-select');
      var intDataInput = container.querySelector('.integration-data-input');
      if (intActionSelect && configData.action_type) intActionSelect.value = configData.action_type;
      if (intDataInput) {
        var intRemaining = {};
        var intKeys = Object.keys(configData);
        for (var ik = 0; ik < intKeys.length; ik++) {
          if (intKeys[ik] !== 'action_type') {
            intRemaining[intKeys[ik]] = configData[intKeys[ik]];
          }
        }
        if (Object.keys(intRemaining).length > 0) {
          intDataInput.value = JSON.stringify(intRemaining, null, 2);
        }
      }
    } else if (stepType === 'transform') {
      var txOpSelect = container.querySelector('.transform-operation-select');
      var txDataInput = container.querySelector('.transform-data-input');
      if (txOpSelect && configData.operation) txOpSelect.value = configData.operation;
      // Populate data textarea with remaining config fields
      if (txDataInput) {
        var txRemaining = {};
        var txKeys = Object.keys(configData);
        for (var tk = 0; tk < txKeys.length; tk++) {
          if (txKeys[tk] !== 'operation') {
            txRemaining[txKeys[tk]] = configData[txKeys[tk]];
          }
        }
        if (Object.keys(txRemaining).length > 0) {
          txDataInput.value = JSON.stringify(txRemaining, null, 2);
        }
      }
    }

    // Mark step as configured
    updateStepStatus(stepId, true);
  }

  /**
   * Update the configuration status badge for a step.
   * @param {string} stepId - The step DOM id
   * @param {boolean} isConfigured - Whether the step has valid configuration
   */
  function updateStepStatus(stepId, isConfigured) {
    var needsEl = document.getElementById('status-needs-' + stepId);
    var readyEl = document.getElementById('status-ready-' + stepId);
    if (!needsEl || !readyEl) return;

    if (isConfigured) {
      needsEl.classList.add('hidden');
      readyEl.classList.remove('hidden');
    } else {
      needsEl.classList.remove('hidden');
      readyEl.classList.add('hidden');
    }
  }

  /**
   * Save the skill with all configured steps
   */
  function saveSkill() {
    var nameInput = document.getElementById('skill_name');
    var descInput = document.getElementById('skill_description');

    var skillName = nameInput ? nameInput.value.trim() : '';
    var skillDescription = descInput ? descInput.value.trim() : '';

    if (!skillName) {
      showToast('Please enter a skill name', 'error');
      return;
    }

    if (skillSteps.length === 0) {
      showToast('Please add at least one step to your skill', 'error');
      return;
    }

    // Collect step configs from the DOM and build backend-expected structures
    var stepsConfig = [];
    var triggerConfig = null;
    var conditionsArray = [];
    var actionsArray = [];
    var actionIndex = 0;

    for (var i = 0; i < skillSteps.length; i++) {
      var step = skillSteps[i];
      var stepCfg = collectStepConfig(step.id, step.type);

      // Builder round-trip format (preserves step sequence for reload)
      stepsConfig.push({
        type: step.type,
        inferred_intent: step.inferred_intent || '',
        config: stepCfg
      });

      if (step.type === 'trigger') {
        triggerConfig = {
          event_type: stepCfg.event_type || '',
          conditions: conditionsArray
        };
      } else if (step.type === 'condition') {
        conditionsArray.push({
          field: stepCfg.field || '',
          operator: stepCfg.operator || 'equals',
          value: stepCfg.value || ''
        });
      } else {
        // ai-action, integration, transform → mapped to actions
        actionIndex++;
        var actionId = 'action_' + actionIndex;
        var actionEntry = {
          action_id: actionId,
          action_type: mapStepToActionType(step.type, stepCfg),
          config: buildActionConfig(step.type, stepCfg),
          dependsOn: actionIndex > 1 ? ['action_' + (actionIndex - 1)] : null
        };
        if (step.description) actionEntry.description = step.description;
        actionsArray.push(actionEntry);
      }
    }

    // BUG-004 FIX: Validate that at least one action step was provided.
    // A skill with only a trigger (and optional conditions) but no actions is non-functional.
    if (actionsArray.length === 0) {
      showToast('Please add at least one action step (AI Action, Integration, or Transform)', 'error');
      return;
    }

    // Attach conditions to trigger
    if (triggerConfig) {
      triggerConfig.conditions = conditionsArray;
    } else {
      triggerConfig = { event_type: 'document.created', conditions: conditionsArray };
    }

    var skillData = {
      skill_name: skillName,
      description: skillDescription,
      skill_type: 'custom',
      is_built_in: false,
      config: {
        trigger: triggerConfig,
        actions: actionsArray,
        settings: { timeout: 60, priority: 10, retryLimit: 3 }
      },
      skill_config: {
        steps: stepsConfig,
        trigger: triggerConfig
      }
    };

    var baseUrl = window.api && window.api.baseUrl ? window.api.baseUrl : (window.LanaConfig && window.LanaConfig.API_BASE_URL ? window.LanaConfig.API_BASE_URL : '');
    var method = editingSkillId ? 'PUT' : 'POST';
    var url = editingSkillId
      ? baseUrl + '/api/v1/skills/' + encodeURIComponent(editingSkillId)
      : baseUrl + '/api/v1/skills';

    fetch(url, {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + getAuthToken(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(skillData)
    }).then(function(response) {
      // BUG-021 FIX: Read the response body before throwing so that server-side
      // validation errors (400 with { message } or { error }) are surfaced to
      // the user rather than showing a generic "Failed to save skill" message.
      if (!response.ok) {
        return response.json().then(function(errData) {
          var msg = (errData && (errData.message || errData.error)) || 'Failed to save skill';
          throw new Error(msg);
        }).catch(function(parseErr) {
          // If the body is not JSON (e.g. 500 HTML page), fall back gracefully.
          if (parseErr instanceof SyntaxError) {
            throw new Error('Failed to save skill (server error ' + response.status + ')');
          }
          throw parseErr;
        });
      }
      return response.json();
    }).then(function() {
      showToast(editingSkillId ? 'Skill updated successfully' : 'Skill created successfully', 'success');
      closeSkillBuilder();
      loadSkills();
    }).catch(function(err) {
      console.error('[Skills] Save failed:', err);
      showToast(err.message || 'Failed to save skill', 'error');
    });
  }

  // openSkillsDesigner — removed, handled by lex-lana-panel in HTML

  // ═══════════════════════════════════════════════════════════════
  // Skills Loading & Rendering
  // ═══════════════════════════════════════════════════════════════

  /**
   * Load skills from API
   */
  function loadSkills() {
    showLoading();

    var baseUrl = window.api && window.api.baseUrl ? window.api.baseUrl : (window.LanaConfig && window.LanaConfig.API_BASE_URL ? window.LanaConfig.API_BASE_URL : '');
    fetch(baseUrl + '/api/v1/skills', {
      headers: {
        'Authorization': 'Bearer ' + getAuthToken(),
        'Content-Type': 'application/json'
      }
    }).then(function(response) {
      if (!response.ok) {
        throw new Error('Failed to fetch skills');
      }
      return response.json();
    }).then(function(data) {
      allSkills = data.skills || data.data || [];

      // Flatten and normalize fields for lex-table compatibility
      allSkills = allSkills.map(function(skill) {
        var meta = skill.metadata || {};
        var config = skill.skill_config || {};
        return Object.assign({}, skill, {
          description: skill.skill_description || skill.description || config.description || meta.description || '',
          category: skill.category || config.category || meta.category || 'automation',
          skill_type: skill.skill_type || config.skill_type || meta.skill_type || '',
          version: skill.skill_version || skill.version || config.version || meta.version || '1.0.0',
          installation_count: skill.installation_count || skill.total_executions || 0,
          tags: meta.tags || []
        });
      });

      filteredSkills = allSkills.slice();

      // Format rows for lex-table display
      var formattedSkills = allSkills.map(function(skill) {
        var out = Object.assign({}, skill);

        // Truncate long descriptions
        if (out.description && out.description.length > 100) {
          out.description = out.description.substring(0, 97) + '...';
        }

        // Format category: replace hyphens/underscores with spaces, title-case
        if (out.category) {
          out.category = out.category.split(/[-_]/).map(function(w) {
            return w.charAt(0).toUpperCase() + w.substring(1);
          }).join(' ');
        }

        // Format skill_type similarly
        if (out.skill_type) {
          out.skill_type = out.skill_type.split(/[-_]/).map(function(w) {
            return w.charAt(0).toUpperCase() + w.substring(1);
          }).join(' ');
        }

        // Format created_at to readable date
        if (out.created_at) {
          try {
            var d = new Date(out.created_at);
            if (!isNaN(d.getTime())) {
              out.created_at = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
          } catch (e) { /* keep raw value */ }
        }

        return out;
      });

      // Populate lex-table for list view
      if (skillsListView && typeof skillsListView.setData === 'function') {
        skillsListView.setData(formattedSkills);
      }

      // Update grid if in grid view
      if (viewMode === 'grid') {
        renderGridView();
      }

      hideLoading();
    }).catch(function(error) {
      console.error('Error loading skills:', error);
      showToast('Failed to load skills. Please try again.', 'error');
      hideLoading();
      showGridEmpty();
    });
  }

  /**
   * Render grid view cards with pagination
   */
  function renderGridView() {
    if (!skillsGridContainer) return;

    if (filteredSkills.length === 0) {
      showGridEmpty();
      return;
    }

    // Paginate
    gridTotal = filteredSkills.length;
    var totalPages = Math.ceil(gridTotal / gridLimit);
    if (gridPage > totalPages) gridPage = totalPages;
    var startIdx = (gridPage - 1) * gridLimit;
    var pageSkills = filteredSkills.slice(startIdx, startIdx + gridLimit);

    skillsGridContainer.className = 'skills-grid p-4';
    skillsGridContainer.classList.remove('hidden');
    if (gridEmptyState) gridEmptyState.classList.add('hidden');

    skillsGridContainer.innerHTML = pageSkills.map(function(skill) {
      return renderSkillCard(skill);
    }).join('');

    // Update pagination
    if (gridPagination) {
      gridPagination.setAttribute('page', gridPage);
      gridPagination.setAttribute('total-pages', totalPages);
      gridPagination.setAttribute('total', gridTotal);
      gridPagination.setAttribute('limit', gridLimit);
    }

    // Attach click listeners to skill cards — open in builder
    var skillElements = skillsGridContainer.querySelectorAll('[data-skill-id]');
    skillElements.forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.closest('.install-btn')) return;
        var skillId = el.dataset.skillId;
        if (skillId) openSkillBuilder(skillId);
      });
    });

    // Attach install button listeners
    var installButtons = skillsGridContainer.querySelectorAll('.install-btn');
    installButtons.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var skillId = btn.dataset.skillId;
        var skill = findSkillById(skillId);
        if (skill) {
          selectedSkill = skill;
          openMatterSelector();
        }
      });
    });
  }

  function findSkillById(skillId) {
    for (var i = 0; i < allSkills.length; i++) {
      if (allSkills[i].skill_id === skillId) return allSkills[i];
    }
    return null;
  }

  /**
   * Render skill card (grid view)
   */
  function renderSkillCard(skill) {
    var icon = getCategoryIcon(skill.category);
    var isInstalled = skill.installation_count > 0;
    var version = skill.version || '1.0.0';
    var category = skill.category || 'automation';
    var tags = skill.tags || [];

    return '<div class="skill-card" data-skill-id="' + skill.skill_id + '">'
      + '<div class="skill-card-header">'
      + '<div class="skill-icon">' + icon + '</div>'
      + '<span class="skill-status-badge ' + (isInstalled ? 'skill-status-installed' : 'skill-status-not-installed') + '">'
      + (isInstalled ? 'Installed (' + skill.installation_count + ')' : 'Not Installed')
      + '</span>'
      + '</div>'
      + '<h3 class="skill-name">' + escapeHtml(skill.skill_name) + '</h3>'
      + '<p class="skill-version">v' + escapeHtml(version) + '</p>'
      + '<p class="skill-description">' + escapeHtml(skill.description || 'No description available') + '</p>'
      + '<div class="skill-meta">'
      + '<span class="category-badge category-' + category + '">' + formatCategory(category) + '</span>'
      + (skill.skill_type === 'custom' ? '<span class="text-gray-500">Custom</span>' : '<span class="text-indigo-600">Built-in</span>')
      + '</div>'
      + '<div class="skill-tags">'
      + tags.slice(0, 3).map(function(tag) { return '<span class="skill-tag">' + escapeHtml(tag) + '</span>'; }).join('')
      + '</div>'
      + '<div class="skill-footer">'
      + '<button class="install-btn" data-skill-id="' + skill.skill_id + '">'
      + '<svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
      + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>'
      + '</svg>Install</button>'
      + '<button class="text-sm text-indigo-600 hover:text-indigo-700">Edit Skill</button>'
      + '</div></div>';
  }

  /**
   * Open skill details modal
   */
  function openSkillDetails(skill) {
    selectedSkill = skill;
    var modal = document.getElementById('skill-details-modal');
    var body = document.getElementById('skill-details-body');

    if (!modal || !body) return;

    var category = skill.category || 'automation';
    var version = skill.version || '1.0.0';
    var tags = skill.tags || [];

    var html = '<div class="skill-detail-section">'
      + '<div class="flex items-start gap-4 mb-4">'
      + '<div class="skill-list-icon">' + getCategoryIcon(category) + '</div>'
      + '<div class="flex-1">'
      + '<h2 class="text-2xl font-bold text-gray-900 mb-1">' + escapeHtml(skill.skill_name) + '</h2>'
      + '<p class="text-gray-600">v' + escapeHtml(version) + ' &bull; ' + (skill.skill_type === 'custom' ? 'Custom Skill' : 'Built-in Skill') + '</p>'
      + '</div></div>'
      + '<p class="text-gray-700">' + escapeHtml(skill.description || 'No description available') + '</p>'
      + '</div>'
      + '<div class="skill-detail-section">'
      + '<h4 class="skill-detail-section-title">Details</h4>'
      + '<div class="skill-detail-info">'
      + '<div class="skill-detail-info-item"><p class="skill-detail-info-label">Category</p>'
      + '<p class="skill-detail-info-value"><span class="category-badge category-' + category + '">' + formatCategory(category) + '</span></p></div>'
      + '<div class="skill-detail-info-item"><p class="skill-detail-info-label">Installations</p>'
      + '<p class="skill-detail-info-value">' + skill.installation_count + ' matters</p></div>'
      + '<div class="skill-detail-info-item"><p class="skill-detail-info-label">Created</p>'
      + '<p class="skill-detail-info-value">' + formatDate(skill.created_at) + '</p></div>'
      + '<div class="skill-detail-info-item"><p class="skill-detail-info-label">Last Updated</p>'
      + '<p class="skill-detail-info-value">' + formatDate(skill.updated_at) + '</p></div>'
      + '</div></div>';

    if (tags.length > 0) {
      html += '<div class="skill-detail-section">'
        + '<h4 class="skill-detail-section-title">Tags</h4>'
        + '<div class="skill-tags">'
        + tags.map(function(tag) { return '<span class="skill-tag">' + escapeHtml(tag) + '</span>'; }).join('')
        + '</div></div>';
    }

    if (skill.trigger_event) {
      html += '<div class="skill-detail-section">'
        + '<h4 class="skill-detail-section-title">Trigger Event</h4>'
        + '<p class="text-sm text-gray-700"><code class="skill-detail-code">' + escapeHtml(skill.trigger_event) + '</code></p>'
        + '</div>';
    }

    if (skill.trigger_conditions && Object.keys(skill.trigger_conditions).length > 0) {
      html += '<div class="skill-detail-section">'
        + '<h4 class="skill-detail-section-title">Trigger Conditions</h4>'
        + '<pre class="skill-detail-code">' + JSON.stringify(skill.trigger_conditions, null, 2) + '</pre>'
        + '</div>';
    }

    if (skill.actions && skill.actions.length > 0) {
      html += '<div class="skill-detail-section">'
        + '<h4 class="skill-detail-section-title">Actions (' + skill.actions.length + ')</h4>'
        + '<ul class="skill-detail-list">'
        + skill.actions.map(function(action) { return '<li>' + escapeHtml(action.action_type) + '</li>'; }).join('')
        + '</ul></div>';
    }

    body.innerHTML = html;
    modal.classList.remove('hidden');
  }

  /**
   * Open matter selector modal
   */
  function openMatterSelector() {
    if (!selectedSkill) return;

    var modal = document.getElementById('matter-selector-modal');
    var mattersList = document.getElementById('matters-list');

    if (!modal || !mattersList) return;

    // Close skill details modal
    if (skillDetailsModal) skillDetailsModal.classList.add('hidden');

    var baseUrl = window.api && window.api.baseUrl ? window.api.baseUrl : (window.LanaConfig && window.LanaConfig.API_BASE_URL ? window.LanaConfig.API_BASE_URL : '');
    fetch(baseUrl + '/api/v1/matters', {
      headers: {
        'Authorization': 'Bearer ' + getAuthToken(),
        'Content-Type': 'application/json'
      }
    }).then(function(response) {
      if (!response.ok) {
        throw new Error('Failed to fetch matters');
      }
      return response.json();
    }).then(function(data) {
      var matters = data.matters || [];

      mattersList.innerHTML = matters.map(function(matter) {
        return '<div class="matter-item" data-matter-id="' + matter.matter_id + '">'
          + '<div class="matter-item-content">'
          + '<input type="checkbox" class="matter-item-checkbox" id="matter-' + matter.matter_id + '" />'
          + '<label for="matter-' + matter.matter_id + '" class="flex-1 cursor-pointer">'
          + '<p class="matter-item-name">' + escapeHtml(matter.matter_name) + '</p>'
          + '<p class="matter-item-meta">' + escapeHtml(matter.client_name || 'No client') + ' &bull; ' + (matter.matter_number || 'No number') + '</p>'
          + '</label></div></div>';
      }).join('');

      // Attach checkbox listeners
      var checkboxes = mattersList.querySelectorAll('.matter-item-checkbox');
      checkboxes.forEach(function(cb) {
        cb.addEventListener('change', function(e) {
          var matterId = e.target.closest('[data-matter-id]').dataset.matterId;
          if (e.target.checked) {
            selectedMatters.push(matterId);
            e.target.closest('.matter-item').classList.add('selected');
          } else {
            selectedMatters = selectedMatters.filter(function(id) { return id !== matterId; });
            e.target.closest('.matter-item').classList.remove('selected');
          }
        });
      });

      modal.classList.remove('hidden');
    }).catch(function(error) {
      console.error('Error loading matters:', error);
      showToast('Failed to load matters. Please try again.', 'error');
    });
  }

  /**
   * Install skill to selected matters
   */
  function installSkillToMatters() {
    if (!selectedSkill || selectedMatters.length === 0) {
      showToast('Please select at least one matter', 'warning');
      return;
    }

    var installButton = document.getElementById('matter-modal-install-btn');
    if (installButton) {
      installButton.disabled = true;
      installButton.textContent = 'Installing...';
    }

    var baseUrl = window.api && window.api.baseUrl ? window.api.baseUrl : (window.LanaConfig && window.LanaConfig.API_BASE_URL ? window.LanaConfig.API_BASE_URL : '');
    var successCount = 0;
    var errorCount = 0;
    var pending = selectedMatters.length;

    selectedMatters.forEach(function(matterId) {
      fetch(baseUrl + '/api/v1/matters/' + matterId + '/skills', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + getAuthToken(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          skill_id: selectedSkill.skill_id
        })
      }).then(function(response) {
        if (response.ok) {
          successCount++;
        } else {
          errorCount++;
        }
      }).catch(function() {
        errorCount++;
      }).finally(function() {
        pending--;
        if (pending <= 0) {
          closeAllModals();
          if (successCount > 0) {
            showToast('Successfully installed skill to ' + successCount + ' matter(s)', 'success');
            loadSkills();
          }
          if (errorCount > 0) {
            showToast('Failed to install to ' + errorCount + ' matter(s)', 'error');
          }
          if (installButton) {
            installButton.disabled = false;
            installButton.textContent = 'Install';
          }
          selectedMatters = [];
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Search & Filters
  // ═══════════════════════════════════════════════════════════════

  function handleSearch(e) {
    searchTerm = e.target.value.toLowerCase();
    filterSkills();
  }

  function handleCategoryChange(e) {
    var detail = e.detail || {};
    selectedCategory = detail.value || 'all';
    filterSkills();
  }

  function handleMatterSearch(e) {
    var term = e.target.value.toLowerCase();
    var mattersList = document.getElementById('matters-list');
    var matterItems = mattersList.querySelectorAll('.matter-item');

    matterItems.forEach(function(item) {
      var name = item.querySelector('.matter-item-name').textContent.toLowerCase();
      var meta = item.querySelector('.matter-item-meta').textContent.toLowerCase();

      if (name.indexOf(term) !== -1 || meta.indexOf(term) !== -1) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }

  function filterSkills() {
    filteredSkills = allSkills.filter(function(skill) {
      // Search filter
      if (searchTerm) {
        var nameMatch = skill.skill_name.toLowerCase().indexOf(searchTerm) !== -1;
        var descMatch = (skill.description || '').toLowerCase().indexOf(searchTerm) !== -1;
        var tags = skill.tags || [];
        var tagsMatch = false;
        for (var i = 0; i < tags.length; i++) {
          if (tags[i].toLowerCase().indexOf(searchTerm) !== -1) {
            tagsMatch = true;
            break;
          }
        }

        if (!nameMatch && !descMatch && !tagsMatch) {
          return false;
        }
      }

      // Category filter
      if (selectedCategory !== 'all') {
        var category = skill.category || 'automation';
        if (category !== selectedCategory) {
          return false;
        }
      }

      return true;
    });

    gridPage = 1; // Reset to first page
    renderGridView();
    updateFilterChips();
  }

  function updateFilterChips() {
    if (!filterChips) return;

    var chips = [];

    if (searchTerm) {
      chips.push('<span class="filter-chip">Search: "' + escapeHtml(searchTerm) + '"'
        + '<button class="filter-chip-remove" data-filter="search">&times;</button></span>');
    }

    if (selectedCategory !== 'all') {
      chips.push('<span class="filter-chip">Category: ' + formatCategory(selectedCategory)
        + '<button class="filter-chip-remove" data-filter="category">&times;</button></span>');
    }

    filterChips.innerHTML = chips.join('');

    // Attach remove listeners
    var removeButtons = filterChips.querySelectorAll('.filter-chip-remove');
    removeButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var filterType = btn.dataset.filter;
        if (filterType === 'search') {
          searchInput.value = '';
          searchTerm = '';
        } else if (filterType === 'category') {
          if (categoryFilter && typeof categoryFilter.setValue === 'function') {
            categoryFilter.setValue('all');
          }
          selectedCategory = 'all';
        }
        filterSkills();
      });
    });
  }

  function setViewMode(mode) {
    viewMode = mode;

    // Toggle lex-btn variant: active = primary, inactive = ghost
    if (mode === 'grid') {
      if (gridViewBtn) gridViewBtn.setAttribute('variant', 'primary');
      if (listViewBtn) listViewBtn.setAttribute('variant', 'ghost');
      // Show grid, hide list
      if (gridViewContainer) gridViewContainer.classList.remove('hidden');
      if (skillsListView) skillsListView.style.display = 'none';
      if (listPagination) listPagination.style.display = 'none';
      // Load data for grid if needed
      if (allSkills.length === 0) {
        loadSkills();
      } else {
        renderGridView();
      }
    } else {
      if (listViewBtn) listViewBtn.setAttribute('variant', 'primary');
      if (gridViewBtn) gridViewBtn.setAttribute('variant', 'ghost');
      // Show list, hide grid
      if (gridViewContainer) gridViewContainer.classList.add('hidden');
      if (skillsListView) skillsListView.style.display = '';
      if (listPagination) listPagination.style.display = '';
      // Load data for list if needed
      if (allSkills.length === 0) {
        loadSkills();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Modals
  // ═══════════════════════════════════════════════════════════════

  function closeAllModals() {
    if (skillDetailsModal) skillDetailsModal.classList.add('hidden');
    if (matterSelectorModal) matterSelectorModal.classList.add('hidden');
    var learnMoreModal = document.getElementById('learn-more-modal');
    if (learnMoreModal) learnMoreModal.classList.add('hidden');
    selectedSkill = null;
    selectedMatters = [];
    closeSkillImportModal();
    // BUG-009 FIX: Do NOT call closeSkillBuilder() here.
    // closeAllModals() is triggered by generic .modal-close buttons and overlay clicks.
    // If the builder modal is open, those generic handlers would destroy unsaved builder state
    // (skillSteps, editingSkillId, mxDiagnostics) even when the user is still working.
    // The builder has its own dedicated close/cancel buttons wired to closeSkillBuilder().
  }

  // ═══════════════════════════════════════════════════════════════
  // Skill Import
  // ═══════════════════════════════════════════════════════════════

  function openSkillImportModal() {
    clearSkillImportFile();
    var resultEl = document.getElementById('skill-import-result');
    if (resultEl) {
      resultEl.classList.add('hidden');
      resultEl.innerHTML = '';
    }
    var modal = document.getElementById('skill-import-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function closeSkillImportModal() {
    var modal = document.getElementById('skill-import-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    clearSkillImportFile();
    skillImportState.isImporting = false;
  }

  function setupSkillImportDropZone() {
    var zone = document.getElementById('skill-drop-zone');
    if (!zone) return;

    zone.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = '#6366f1';
      zone.style.background = '#eef2ff';
    });

    zone.addEventListener('dragleave', function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = '#d1d5db';
      zone.style.background = '';
    });

    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      e.stopPropagation();
      zone.style.borderColor = '#d1d5db';
      zone.style.background = '';
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        processSkillImportFile(files[0]);
      }
    });
  }

  function handleSkillFileSelect(e) {
    var files = e.target && e.target.files;
    if (files && files.length > 0) {
      processSkillImportFile(files[0]);
    }
  }

  function processSkillImportFile(file) {
    var name = file.name || '';
    var lower = name.toLowerCase();

    // Check extension using string methods only
    var dotZip = '.zip';
    var endsWithZip = lower.length >= dotZip.length &&
      lower.substring(lower.length - dotZip.length) === dotZip;

    if (!endsWithZip) {
      showToast('Please select a .zip file', 'error');
      return;
    }

    var maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast('File size exceeds the 5MB limit', 'error');
      return;
    }

    skillImportState.selectedFile = file;

    var infoEl = document.getElementById('skill-file-info');
    var nameEl = document.getElementById('skill-file-name');
    var sizeEl = document.getElementById('skill-file-size');

    if (nameEl) nameEl.textContent = name;
    if (sizeEl) {
      var sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      sizeEl.textContent = sizeMB + ' MB';
    }
    if (infoEl) infoEl.classList.remove('hidden');

    var confirmBtn = document.getElementById('skill-import-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = false;

    var resultEl = document.getElementById('skill-import-result');
    if (resultEl) {
      resultEl.classList.add('hidden');
      resultEl.innerHTML = '';
    }
  }

  function clearSkillImportFile() {
    skillImportState.selectedFile = null;

    var infoEl = document.getElementById('skill-file-info');
    if (infoEl) infoEl.classList.add('hidden');

    var confirmBtn = document.getElementById('skill-import-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    var fileInput = document.getElementById('skill-file-input');
    if (fileInput) fileInput.value = '';
  }

  function executeSkillImport() {
    if (!skillImportState.selectedFile || skillImportState.isImporting) return;

    skillImportState.isImporting = true;

    var confirmBtn = document.getElementById('skill-import-confirm-btn');
    var originalBtnText = confirmBtn ? confirmBtn.innerHTML : 'Import Skill';

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML =
        '<svg class="w-4 h-4 inline-block mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>' +
        '</svg>Importing...';
    }

    var resultEl = document.getElementById('skill-import-result');

    var formData = new FormData();
    formData.append('skill_zip', skillImportState.selectedFile);

    var token = (window.api && window.api.token) ? window.api.token : getAuthToken();
    var baseUrl = (window.api && window.api.baseUrl) ? window.api.baseUrl : (window.LanaConfig && window.LanaConfig.API_BASE_URL ? window.LanaConfig.API_BASE_URL : '');

    fetch(baseUrl + '/api/v1/skills/import', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      },
      body: formData
    }).then(function(response) {
      return response.json().then(function(data) {
        return { ok: response.ok, status: response.status, data: data };
      });
    }).then(function(result) {
      if (!result.ok) {
        var errMsg = (result.data && (result.data.error || result.data.message)) || 'Import failed';
        if (result.status === 401 || result.status === 403) {
          errMsg = 'You do not have permission to import skills.';
        } else if (result.status === 413) {
          errMsg = 'File too large. Maximum size is 5MB.';
        } else if (result.status === 400) {
          errMsg = (result.data && result.data.error) || 'Invalid skill package. Check the ZIP structure.';
        } else if (result.status === 404) {
          errMsg = 'Import endpoint not available. Contact your administrator.';
        }
        throw new Error(errMsg);
      }

      var skill = (result.data && result.data.data) ? result.data.data : {};
      var skillName = skill.skill_name || (skillImportState.selectedFile ? skillImportState.selectedFile.name : 'Skill');
      var skillVersion = (skill.skill_metadata && skill.skill_metadata.version) ? skill.skill_metadata.version : null;

      if (resultEl) {
        resultEl.classList.remove('hidden');
        resultEl.innerHTML =
          '<div class="rounded-lg p-3 flex gap-2 items-start" style="background:#f0fdf4;border:1px solid #bbf7d0">' +
            '<svg class="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>' +
            '</svg>' +
            '<p class="text-sm text-green-700"><strong>' + escapeHtml(skillName) + '</strong> imported successfully' +
              (skillVersion ? ' (v' + escapeHtml(skillVersion) + ')' : '') +
            '.</p>' +
          '</div>';
      }

      showToast('Skill "' + skillName + '" imported successfully', 'success');

      if (confirmBtn) {
        confirmBtn.innerHTML = 'Imported!';
      }

      loadSkills();

      setTimeout(function() {
        closeSkillImportModal();
      }, 2000);

    }).catch(function(error) {
      var errMsg = (error && error.message) ? error.message : 'Failed to import skill';

      if (resultEl) {
        resultEl.classList.remove('hidden');
        resultEl.innerHTML =
          '<div class="rounded-lg p-3 flex gap-2 items-start" style="background:#fef2f2;border:1px solid #fecaca">' +
            '<svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' +
            '</svg>' +
            '<p class="text-sm text-red-700">' + escapeHtml(errMsg) + '</p>' +
          '</div>';
      }

      showToast(errMsg, 'error');

      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalBtnText;
      }

    }).finally(function() {
      skillImportState.isImporting = false;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // UI State Helpers
  // ═══════════════════════════════════════════════════════════════

  function showLoading() {
    if (loadingState) loadingState.classList.remove('hidden');
    if (skillsGridContainer) skillsGridContainer.classList.add('hidden');
    if (gridEmptyState) gridEmptyState.classList.add('hidden');
  }

  function hideLoading() {
    if (loadingState) loadingState.classList.add('hidden');
  }

  function showGridEmpty() {
    if (skillsGridContainer) skillsGridContainer.classList.add('hidden');
    if (gridEmptyState) gridEmptyState.classList.remove('hidden');
  }

  function showToast(message, type) {
    type = type || 'success';
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;

    var iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>';
    } else {
      iconSvg = '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>';
    }

    toast.innerHTML = '<div class="toast-content">'
      + '<div class="toast-icon ' + type + '">' + iconSvg + '</div>'
      + '<p class="toast-message">' + escapeHtml(message) + '</p>'
      + '<button class="toast-close">&times;</button>'
      + '</div>';

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    }, 5000);

    // Manual close
    var closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 300);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════

  function getCategoryIcon(category) {
    var icons = {
      'document-intelligence': '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
      'ai-assistance': '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
      'automation': '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 002 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg>',
      'workflow': '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15 6a9 9 0 00-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/></svg>',
      'integration': '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 01-4 4h-4a4 4 0 01-4-4V8z"/></svg>'
    };
    var fallback = '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/></svg>';
    return icons[category] || fallback;
  }

  function formatCategory(category) {
    return category.split('-').map(function(word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  function formatDate(dateString) {
    if (!dateString) return 'N/A';
    var date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getAuthToken() {
    if (window.api && window.api.token) return window.api.token;
    return localStorage.getItem('token') || '';
  }

  function debounce(func, wait) {
    var timeout;
    return function() {
      var args = arguments;
      var context = this;
      clearTimeout(timeout);
      timeout = setTimeout(function() {
        func.apply(context, args);
      }, wait);
    };
  }

  // SPA: register with router so init runs on every navigation.
  // Non-SPA: init runs immediately.
  if (window.LexRouter) {
    LexRouter.registerPageInit('skills.html', init);
  } else {
    init();
  }
})();

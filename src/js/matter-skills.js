/**
 * Matter Skills Tab
 * Handles skill management for matters including:
 * - Rendering skills list
 * - Creating new skills
 * - Importing skills from JSON
 * - Toggling skill enabled/disabled status
 * - Executing skills
 */

// =============================================================================
// SKILLS TAB RENDERING
// =============================================================================

async function renderSkillsTab(matter) {
  const content = document.getElementById('tabContentSkills');

  // Show loading state
  content.innerHTML = `
    <div class="flex items-center justify-center py-12">
      <div class="text-center">
        <div class="animate-spin w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-4"></div>
        <p class="text-gray-500">Loading skills...</p>
      </div>
    </div>
  `;

  try {
    // Fetch matter skills using the correct route
    const response = await api.get(`/api/v1/matters/${matter.matter_id}/skills`);
    const matterSkills = response?.data || [];

    // Render skills UI
    content.innerHTML = `
      <div class="max-w-6xl mx-auto">
        <!-- Header -->
        <div class="mb-6 flex justify-between items-center">
          <div>
            <h3 class="text-lg font-semibold text-gray-900">Skills for ${matter.matter_name || 'This Matter'}</h3>
            <p class="text-sm text-gray-500 mt-1">Automate workflows and enhance productivity with AI-powered skills</p>
          </div>
          <div class="flex gap-2">
            <lex-btn variant="primary" size="sm" onclick="createNewSkill('${matter.matter_id}')">+ Create Skill</lex-btn>
            <lex-btn variant="outline" size="sm" onclick="importSkill('${matter.matter_id}')">Import</lex-btn>
          </div>
        </div>

        <!-- Enabled Skills -->
        <div class="space-y-4">
          ${matterSkills.length === 0 ? `
            <div class="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
              <div class="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style="background:var(--lex-bg-accent-subtle,#eff6ff);">
                <svg class="w-8 h-8" style="color:var(--lex-color-blue-600,#2563eb);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"></path>
                </svg>
              </div>
              <h3 class="text-lg font-semibold text-gray-900 mb-2">No Skills Enabled Yet</h3>
              <p class="text-gray-500 mb-6">Create a new skill or import an existing one to automate tasks and workflows for this matter.</p>
              <div class="flex gap-3 justify-center">
                <lex-btn variant="primary" onclick="createNewSkill('${matter.matter_id}')">+ Create Skill</lex-btn>
                <lex-btn variant="outline" onclick="importSkill('${matter.matter_id}')">Import Skill</lex-btn>
              </div>
            </div>
          ` : matterSkills.map(ms => `
            <div class="bg-white border border-gray-200 rounded-xl p-6 hover:border-blue-300 transition-colors">
              <div class="flex justify-between items-start">
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-2">
                    <h4 class="text-lg font-semibold text-gray-900">${ms.skill_name}</h4>
                    <span class="px-2 py-1 text-xs font-medium rounded-full ${ms.is_enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}">
                      ${ms.is_enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    ${ms.is_built_in ? '<span class="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Built-in</span>' : ''}
                  </div>
                  <p class="text-sm text-gray-600 mb-4">${ms.skill_description || 'No description available'}</p>

                  <!-- Trigger Info -->
                  <div class="flex items-center gap-2 text-sm text-gray-500">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                    </svg>
                    <span>Trigger: <strong>${ms.skill_config?.trigger?.event_type || 'Manual'}</strong></span>
                  </div>
                </div>

                <!-- Actions -->
                <div class="flex items-center gap-2">
                  <button onclick="toggleMatterSkill('${matter.matter_id}', '${ms.skill_id}', ${!ms.is_enabled})"
                          class="px-3 py-1.5 text-sm font-medium rounded-lg ${ms.is_enabled ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'} transition-colors">
                    ${ms.is_enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onclick="executeMatterSkill('${matter.matter_id}', '${ms.skill_id}')"
                          class="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors ${ms.is_enabled ? '' : 'opacity-50 cursor-not-allowed'}"
                          ${ms.is_enabled ? '' : 'disabled'}>
                    Execute
                  </button>
                  <button onclick="editMatterSkill('${ms.matter_skill_id}')"
                          class="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                    Configure
                  </button>
                  <button onclick="viewSkillExecutions('${ms.matter_skill_id}')"
                          class="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                    View Logs
                  </button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

  } catch (error) {
    console.error('[Skills Tab] Error:', error);
    content.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p class="text-red-800">Failed to load skills. Please try again.</p>
        <button onclick="switchMatterTab('skills')" class="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
          Retry
        </button>
      </div>
    `;
  }
}

// =============================================================================
// SKILL ACTION FUNCTIONS
// =============================================================================

// Helper functions for Skills tab (attached to window for onclick handlers)
window.createNewSkill = function(matterId) {
  // Navigate to the Skills page with matter context for breadcrumb
  var href = matterId ? 'skills.html?id=' + encodeURIComponent(matterId) : 'skills.html';
  if (window.Lex && window.Lex.Nav) {
    Lex.Nav.go(href);
  } else {
    window.location.href = href;
  }
};

window.importSkill = function(matterId) {
  // Navigate to the Skills page with matter context for breadcrumb
  var href = matterId ? 'skills.html?id=' + encodeURIComponent(matterId) : 'skills.html';
  if (window.Lex && window.Lex.Nav) {
    Lex.Nav.go(href);
  } else {
    window.location.href = href;
  }
};

window.toggleMatterSkill = async function(matterId, skillId, enabled) {
  try {
    // Use api helper for PATCH request to toggle skill
    await api.patch(`/api/v1/matters/${matterId}/skills/${skillId}/toggle`, { is_enabled: enabled });

    // Refresh the skills tab
    const currentMatter = currentMatterData?.matter;
    if (currentMatter) {
      renderSkillsTab(currentMatter);
    }

    showNotification(enabled ? 'Skill enabled successfully' : 'Skill disabled successfully', 'success');
  } catch (error) {
    console.error('[Toggle Skill] Error:', error);
    showNotification('Failed to toggle skill', 'error');
  }
};

window.editMatterSkill = function(matterSkillId) {
  // Open skill configuration modal
  window.location.href = `matter-skills.html?matterSkillId=${matterSkillId}`;
};

window.viewSkillExecutions = function(matterSkillId) {
  // Open execution logs modal or page
  window.location.href = `matter-skills.html?matterSkillId=${matterSkillId}&tab=executions`;
};

window.executeMatterSkill = async function(matterId, skillId) {
  try {
    showNotification('Queuing skill for execution...', 'info');

    var response = await api.post(
      '/api/v1/matters/' + matterId + '/skills/' + skillId + '/execute',
      { input_data: {}, priority: 'normal' }
    );

    // Handle 202 Accepted (queued for background execution)
    if (response && response.job_id) {
      showNotification('Skill queued for execution', 'success');
    } else if (response && response.success) {
      showNotification('Skill executed successfully', 'success');
    } else {
      showNotification('Skill execution initiated', 'success');
    }
  } catch (error) {
    console.error('[executeMatterSkill] Error:', error);
    showNotification(error.message || 'Failed to execute skill', 'error');
  }
};

// =============================================================================
// CREATE SKILL MODAL
// =============================================================================

function closeCreateSkillModal() {
  const modal = document.getElementById('createSkillModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  // Clear individual inputs (no form element exists)
  var nameEl = document.getElementById('skill_name');
  var descEl = document.getElementById('skill_description');
  if (nameEl) nameEl.value = '';
  if (descEl) descEl.value = '';
  // Reset skill steps
  skillSteps = [];
  var stepsContainer = document.getElementById('workflow-steps-container');
  if (stepsContainer) {
    var steps = stepsContainer.querySelectorAll('.workflow-step-card');
    steps.forEach(function(s) { s.remove(); });
  }
}

// =============================================================================
// IMPORT SKILL MODAL
// =============================================================================

let selectedSkillFile = null;
let importSkillData = null;

function closeImportSkillModal() {
  const modal = document.getElementById('importSkillModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  clearSkillFile();
}

function clearSkillFile() {
  selectedSkillFile = null;
  importSkillData = null;
  const fileInput = document.getElementById('skill-file-input');
  if (fileInput) fileInput.value = '';
  document.getElementById('skill-upload-prompt').classList.remove('hidden');
  document.getElementById('skill-file-info').classList.add('hidden');
  document.getElementById('skill-preview').classList.add('hidden');
  document.getElementById('import-skill-btn').disabled = true;
}

function handleSkillFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  selectedSkillFile = file;

  // Show file info
  document.getElementById('skill-upload-prompt').classList.add('hidden');
  document.getElementById('skill-file-info').classList.remove('hidden');
  document.getElementById('skill-file-name').textContent = file.name;
  document.getElementById('skill-file-size').textContent = formatFileSize(file.size);

  // Read and parse JSON
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      importSkillData = JSON.parse(e.target.result);
      showSkillPreview(importSkillData);
      document.getElementById('import-skill-btn').disabled = false;
    } catch (error) {
      showNotification('Invalid JSON file', 'error');
      clearSkillFile();
    }
  };
  reader.readAsText(file);
}

function showSkillPreview(data) {
  document.getElementById('skill-preview').classList.remove('hidden');
  document.getElementById('skill-preview-name').textContent = data.skill_name || 'Unknown';
  document.getElementById('skill-preview-category').textContent = data.category || 'Unknown';
  document.getElementById('skill-preview-type').textContent = data.skill_type || 'custom';
  document.getElementById('skill-preview-description').textContent = data.description || 'No description';
}

async function submitImportSkill() {
  if (!importSkillData) {
    showNotification('No skill data to import', 'error');
    return;
  }

  try {
    // Create the skill
    const response = await api.post('/api/v1/skills', importSkillData);

    if (response.success) {
      showNotification('Skill imported successfully', 'success');

      // If matterId is provided, enable the skill for that matter
      const matterId = window.currentSkillMatterId;
      if (matterId) {
        try {
          await api.post(`/api/v1/matters/${matterId}/skills`, {
            skill_id: response.skill.skill_id,
            config_overrides: {}
          });
          showNotification('Skill enabled for matter', 'success');
        } catch (error) {
          console.error('Failed to enable skill for matter:', error);
        }
      }

      // Close modal and refresh skills tab
      closeImportSkillModal();
      const currentMatter = currentMatterData?.matter;
      if (currentMatter) {
        renderSkillsTab(currentMatter);
      }
    }
  } catch (error) {
    console.error('Failed to import skill:', error);
    showNotification(error.message || 'Failed to import skill', 'error');
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// Initialize import modal file input handlers
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('skill-file-input');
  const dropZone = document.getElementById('skill-drop-zone');

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', handleSkillFileSelect);

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-purple-500', 'bg-purple-50');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-purple-500', 'bg-purple-50');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-purple-500', 'bg-purple-50');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        handleSkillFileSelect({ target: fileInput });
      }
    });
  }
});

// =============================================================================
// WORKFLOW BUILDER MODE SWITCHING
// =============================================================================

let workflowBuilder = null;

/**
 * Switch between simple and visual workflow builder modes
 * @param {string} mode - 'simple' or 'visual'
 */
function switchWorkflowMode(mode) {
  const simpleMode = document.getElementById('simple-workflow-mode');
  const visualMode = document.getElementById('visual-workflow-mode');
  const simpleModeBtn = document.getElementById('simple-mode-btn');
  const visualModeBtn = document.getElementById('visual-mode-btn');

  if (mode === 'simple') {
    // Show simple mode
    simpleMode.classList.remove('hidden');
    simpleMode.classList.add('flex');
    visualMode.classList.remove('flex', 'flex-col');
    visualMode.classList.add('hidden');

    // Update button styles
    simpleModeBtn.classList.add('bg-white', 'text-purple-700', 'shadow-sm');
    simpleModeBtn.classList.remove('text-gray-600', 'hover:text-gray-900');
    visualModeBtn.classList.remove('bg-white', 'text-purple-700', 'shadow-sm');
    visualModeBtn.classList.add('text-gray-600', 'hover:text-gray-900');
  } else if (mode === 'visual') {
    // Show visual mode
    visualMode.classList.remove('hidden');
    visualMode.classList.add('flex', 'flex-col');
    simpleMode.classList.remove('flex');
    simpleMode.classList.add('hidden');

    // Update button styles
    visualModeBtn.classList.add('bg-white', 'text-purple-700', 'shadow-sm');
    visualModeBtn.classList.remove('text-gray-600', 'hover:text-gray-900');
    simpleModeBtn.classList.remove('bg-white', 'text-purple-700', 'shadow-sm');
    simpleModeBtn.classList.add('text-gray-600', 'hover:text-gray-900');

    // Initialize Drawflow if not already initialized
    if (!workflowBuilder) {
      initializeDrawflow();
    }
  }
}

/**
 * Initialize Drawflow visual workflow builder
 */
function initializeDrawflow() {
  // Check if WorkflowBuilder class is available
  if (typeof WorkflowBuilder === 'undefined') {
    console.error('WorkflowBuilder class not found. Make sure workflow-builder.js is loaded.');
    showNotification('Failed to initialize visual builder. Please reload the page.', 'error');
    return;
  }

  try {
    // Initialize the WorkflowBuilder
    workflowBuilder = new WorkflowBuilder('drawflow-canvas');
    workflowBuilder.init();

    // Get current skill name and description if editing
    const skillNameInput = document.getElementById('skill_name');
    const skillDescInput = document.getElementById('skill_description');

    if (skillNameInput && skillNameInput.value) {
      workflowBuilder.workflowName = skillNameInput.value;
    }
    if (skillDescInput && skillDescInput.value) {
      workflowBuilder.workflowDescription = skillDescInput.value;
    }

    console.log('Drawflow workflow builder initialized successfully');
  } catch (error) {
    console.error('Error initializing Drawflow:', error);
    showNotification('Failed to initialize visual builder: ' + error.message, 'error');
  }
}

/**
 * Close node configuration panel in visual mode
 */
function closeNodeConfigPanel() {
  const panel = document.getElementById('nodeConfigPanel');
  if (panel) {
    panel.classList.add('hidden');
  }
}

/**
 * Delete selected node in visual mode
 */
function deleteSelectedNode() {
  if (workflowBuilder && workflowBuilder.selectedNode) {
    const nodeId = workflowBuilder.selectedNode;
    workflowBuilder.editor.removeNodeId('node-' + nodeId);
    workflowBuilder.selectedNode = null;
    closeNodeConfigPanel();
  }
}

/**
 * Save node configuration in visual mode
 */
function saveNodeConfig() {
  if (workflowBuilder && workflowBuilder.selectedNode) {
    // The WorkflowBuilder class handles this internally
    // Just close the panel
    closeNodeConfigPanel();
    showNotification('Node configuration saved', 'success');
  }
}

// =============================================================================
// EVENT DEFINITIONS WITH DESCRIPTIONS
// =============================================================================

const EVENT_DEFINITIONS = {
  // Document Events
  'document.created': 'Triggered when a new document is created in the system',
  'document.updated': 'Triggered when document metadata or content is modified',
  'document.deleted': 'Triggered when a document is deleted',
  'document.uploaded': 'Triggered when a file is uploaded to the system',
  'document.parsed': 'Triggered when document text and layout parsing completes',
  'document.indexed': 'Triggered when document content is indexed for search',
  'document.ready': 'Triggered when a document is ready for use in the platform',
  'document.summarized': 'Triggered when document summarization completes',
  'document.processed': 'Triggered when document processing (OCR, parsing) completes',
  'document.shared': 'Triggered when a document is shared with users or external parties',
  'document.downloaded': 'Triggered when a document is downloaded',
  'document_version.created': 'Triggered when a new document version is created',
  'document_version.restored': 'Triggered when a previous document version is restored as current',

  // Matter Events
  'matter.created': 'Triggered when a new matter/case is created',
  'matter.updated': 'Triggered when matter details are modified',
  'matter.closed': 'Triggered when a matter is marked as closed',
  'matter.reopened': 'Triggered when a closed matter is reopened',
  'matter.archived': 'Triggered when a matter is archived',
  'matter.assigned': 'Triggered when a matter is assigned to a user or team',
  'matter.linked_to_workspace': 'Triggered when a matter is linked to a workspace',
  'matter.linked_to_matter': 'Triggered when a matter is linked to another matter (related case)',
  'matter.unlinked': 'Triggered when a matter is unlinked from a related entity',

  // Workspace Events
  'workspace.linked_to_matter': 'Triggered when a workspace is linked to a matter',

  // Entity Link Events
  'entity_link.created': 'Triggered when an entity link is created between resources',
  'entity_link.deleted': 'Triggered when an entity link is deleted',

  // Contact Events
  'contact.created': 'Triggered when a new contact is added',
  'contact.updated': 'Triggered when contact information is modified',
  'contact.deleted': 'Triggered when a contact is deleted',
  'contact.linked_to_matter': 'Triggered when a contact is linked to a matter',
  'contact.unlinked_from_matter': 'Triggered when a contact is unlinked from a matter',
  'contact.synced_from_connector': 'Triggered when a contact is synced from an external connector',

  // Lead Events
  'lead.created': 'Triggered when a new lead is created',
  'lead.updated': 'Triggered when lead information is updated',
  'lead.deleted': 'Triggered when a lead is deleted',
  'lead.converted': 'Triggered when a lead is converted to an opportunity or matter',

  // Opportunity Events
  'opportunity.created': 'Triggered when a new opportunity is created',
  'opportunity.updated': 'Triggered when opportunity information is updated',
  'opportunity.closed_won': 'Triggered when an opportunity is closed as won',
  'opportunity.closed_lost': 'Triggered when an opportunity is closed as lost',

  // Project Events
  'project.created': 'Triggered when a new project is created',
  'project.updated': 'Triggered when project information is updated',
  'project.completed': 'Triggered when a project is marked as completed',
  'project.archived': 'Triggered when a project is archived',

  // Task Events
  'task.created': 'Triggered when a new task is created',
  'task.updated': 'Triggered when task details are modified',
  'task.completed': 'Triggered when a task is marked as complete',
  'task.deleted': 'Triggered when a task is deleted',
  'task.assigned': 'Triggered when a task is assigned to a user',
  'task.overdue': 'Triggered when a task becomes overdue',

  // Checklist Events
  'checklist.created': 'Triggered when a new checklist is created',
  'checklist.completed': 'Triggered when all items in a checklist are completed',
  'checklist.deleted': 'Triggered when a checklist is deleted',

  // Checklist Item Events
  'checklist_item.created': 'Triggered when a new checklist item is created',
  'checklist_item.completed': 'Triggered when a checklist item is marked as complete',
  'checklist_item.deleted': 'Triggered when a checklist item is deleted',

  // Email Events
  'email.received': 'Triggered when an email is received',
  'email.sent': 'Triggered when an email is sent',
  'email.opened': 'Triggered when a sent email is opened by recipient',
  'email.bounced': 'Triggered when an email bounces (delivery failed)',

  // Call Events
  'call.logged': 'Triggered when a phone call or meeting is logged',
  'call.completed': 'Triggered when a scheduled call is marked as completed',

  // Communication Events
  'conversation.created': 'Triggered when a new conversation thread is started',
  'conversation.updated': 'Triggered when a conversation is updated',
  'message.sent': 'Triggered when a message is sent',
  'message.received': 'Triggered when a message is received',
  'meeting.scheduled': 'Triggered when a meeting is scheduled',
  'meeting.completed': 'Triggered when a meeting ends',

  // Calendar Events
  'calendar_event.created': 'Triggered when a calendar event is created',
  'calendar_event.updated': 'Triggered when a calendar event is updated',
  'calendar_event.deleted': 'Triggered when a calendar event is deleted',
  'calendar_event.rsvp': 'Triggered when a user responds to a calendar event invitation',

  // Campaign Events
  'campaign.created': 'Triggered when a new campaign is created',
  'campaign.sent': 'Triggered when a campaign is sent to recipients',
  'campaign.opened': 'Triggered when a campaign email is opened',

  // Milestone Events
  'milestone.created': 'Triggered when a new milestone is created',
  'milestone.completed': 'Triggered when a milestone is marked as completed',
  'milestone.missed': 'Triggered when a milestone deadline is missed',

  // Note Events
  'note.created': 'Triggered when a new note is created',
  'note.updated': 'Triggered when a note is updated',
  'note.deleted': 'Triggered when a note is deleted',

  // Workflow Events
  'workflow.started': 'Triggered when a workflow execution begins',
  'workflow.completed': 'Triggered when a workflow completes successfully',
  'workflow.failed': 'Triggered when a workflow fails',

  // Custom Skill Events
  'custom_skill.created': 'Triggered when a new custom skill is created',
  'custom_skill.updated': 'Triggered when a custom skill is updated',
  'custom_skill.deleted': 'Triggered when a custom skill is deleted',
  'custom_skill.published': 'Triggered when a custom skill is published to the marketplace',

  // Matter Skill Events
  'matter_skill.enabled': 'Triggered when a skill is enabled for a matter',
  'matter_skill.disabled': 'Triggered when a skill is disabled for a matter',
  'matter_skill.executed': 'Triggered when a skill executes successfully',
  'matter_skill.failed': 'Triggered when a skill execution fails',

  // Integration Events
  'connector.synced': 'Triggered when an integration sync completes',
  'connector.error': 'Triggered when an integration encounters an error',
  'integration.data_received': 'Triggered when data is received from external system',

  // User Events
  'user.login': 'Triggered when a user logs in',
  'user.logout': 'Triggered when a user logs out',
  'user.created': 'Triggered when a new user account is created',
  'user.updated': 'Triggered when user profile is updated',

  // Invoice Events
  'invoice.created': 'Triggered when a new invoice is created',
  'invoice.sent': 'Triggered when an invoice is sent to client',
  'invoice.paid': 'Triggered when an invoice payment is received',
  'invoice.voided': 'Triggered when an invoice is voided',

  // Expense Events
  'expense.created': 'Triggered when a new expense is created',
  'expense.approved': 'Triggered when an expense is approved',
  'expense.rejected': 'Triggered when an expense is rejected',
  'expense.paid': 'Triggered when an expense is marked as paid',

  // Disbursement Events
  'disbursement.created': 'Triggered when a disbursement is created for a matter',
  'disbursement.approved': 'Triggered when a disbursement is approved',
  'disbursement.paid': 'Triggered when a disbursement payment is processed',

  // Payment Events
  'payment.received': 'Triggered when a payment is received from a client',
  'payment.refunded': 'Triggered when a payment is refunded to a client',

  // Estimate Events
  'estimate.created': 'Triggered when a cost estimate is created for a matter',
  'estimate.sent': 'Triggered when an estimate is sent to client for review',
  'estimate.approved': 'Triggered when an estimate is approved by client',

  // Budget Events
  'budget.created': 'Triggered when a budget is created for a matter',
  'budget.updated': 'Triggered when budget parameters are updated',
  'budget.exceeded': 'Triggered when a budget threshold is exceeded (alert event)',

  // Time Entry Events
  'time_entry.created': 'Triggered when a billable time entry is created',
  'time_entry.updated': 'Triggered when time entry details are updated',
  'time_entry.deleted': 'Triggered when a time entry is deleted',

  // Trust Entry Events
  'trust_entry.created': 'Triggered when a trust account entry is created',
  'trust_entry.reconciled': 'Triggered when a trust entry is reconciled with bank statement',

  // Notification Events
  'notification.sent': 'Triggered when a notification is sent to a user',
  'reminder.triggered': 'Triggered when a scheduled reminder fires',
  'alert.created': 'Triggered when a system alert is created',

  // Folder Events
  'folder.created': 'Triggered when a new folder is created',
  'folder.renamed': 'Triggered when a folder is renamed',
  'folder.deleted': 'Triggered when a folder is deleted',

  // Generated Document Events
  'generated_document.created': 'Triggered when a document is successfully generated from a template',
  'generated_document.failed': 'Triggered when document generation fails',

  // Pipeline Events
  'pipeline.created': 'Triggered when a new pipeline is created',
  'pipeline.updated': 'Triggered when pipeline configuration is updated',
  'pipeline.stage_changed': 'Triggered when an item moves to a different pipeline stage',

  // AI Events
  'ai.analysis_completed': 'Triggered when AI analysis of content completes',
  'ai.summary_generated': 'Triggered when AI generates a summary',
  'ai.extraction_completed': 'Triggered when AI data extraction completes'
};

// =============================================================================
// MX DIAGNOSTICS (Machine Experience Health Monitoring)
// =============================================================================

let skillSteps = [];
let mxDiagnostics = {
  parseability: 0,
  intentClarity: 'Unknown',
  triggerCount: 0,
  conditionCount: 0,
  actionCount: 0
};

/**
 * Update MX diagnostics panel with current skill health
 */
function updateMXDiagnostics() {
  // Calculate parseability index (0-100%)
  let parseabilityScore = 0;

  // Has skill name (+20%)
  const skillName = document.getElementById('skill_name')?.value || '';
  if (skillName.length > 0) parseabilityScore += 20;

  // Has description (+20%)
  const skillDesc = document.getElementById('skill_description')?.value || '';
  if (skillDesc.length > 20) parseabilityScore += 20;

  // Has at least one trigger (+20%)
  if (mxDiagnostics.triggerCount > 0) parseabilityScore += 20;

  // Has logical steps (+20%)
  if (skillSteps.length >= 2) parseabilityScore += 20;

  // Has actions (+20%)
  if (mxDiagnostics.actionCount > 0) parseabilityScore += 20;

  mxDiagnostics.parseability = parseabilityScore;

  // Calculate intent clarity
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
  const parseabilityScoreEl = document.getElementById('mx-parseability-score');
  const parseabilityBarEl = document.getElementById('mx-parseability-bar');
  const intentScoreEl = document.getElementById('mx-intent-score');
  const stepCountEl = document.getElementById('mx-step-count');
  const triggerCountEl = document.getElementById('mx-trigger-count');
  const conditionCountEl = document.getElementById('mx-condition-count');
  const actionCountEl = document.getElementById('mx-action-count');

  if (parseabilityScoreEl) parseabilityScoreEl.textContent = `${parseabilityScore}%`;
  if (parseabilityBarEl) parseabilityBarEl.style.width = `${parseabilityScore}%`;
  if (intentScoreEl) {
    intentScoreEl.textContent = mxDiagnostics.intentClarity;
    intentScoreEl.className = `text-sm font-bold font-mono ${
      mxDiagnostics.intentClarity === 'High' ? 'text-emerald-600' :
      mxDiagnostics.intentClarity === 'Medium' ? 'text-purple-600' :
      mxDiagnostics.intentClarity === 'Low' ? 'text-amber-600' :
      'text-gray-600'
    }`;
  }
  if (stepCountEl) stepCountEl.textContent = `${skillSteps.length} step${skillSteps.length !== 1 ? 's' : ''}`;
  if (triggerCountEl) triggerCountEl.textContent = mxDiagnostics.triggerCount;
  if (conditionCountEl) conditionCountEl.textContent = mxDiagnostics.conditionCount;
  if (actionCountEl) actionCountEl.textContent = mxDiagnostics.actionCount;
}

function renderMatterEventSummaryHtml(selectedEvent) {
  if (window.LanaEventBrowser && typeof window.LanaEventBrowser.renderSummaryHtml === 'function') {
    return window.LanaEventBrowser.renderSummaryHtml(selectedEvent);
  }

  const description = EVENT_DEFINITIONS[selectedEvent] || 'No description available';
  return `
    <p class="text-xs text-blue-800">
      <strong>Description:</strong> ${description}
    </p>
  `;
}

/**
 * Add a new skill step
 */
function addWorkflowStep() {
  const container = document.getElementById('workflow-steps-container');
  if (!container) return;

  const stepIndex = skillSteps.length;
  const stepId = `step-${LanaTime.nowMs()}-${stepIndex}`;

  // Create step data
  const stepData = {
    id: stepId,
    type: 'trigger', // Default to trigger
    config: {},
    inferred_intent: ''
  };

  skillSteps.push(stepData);

  // Create step HTML
  const stepHtml = `
    <div class="workflow-step relative" data-step-id="${stepId}">
      <!-- Connector Node -->
      <div class="absolute left-6 top-8 w-4 h-4 rounded-full bg-purple-500 ring-4 ring-purple-100 z-10"></div>

      <!-- Step Card -->
      <div class="ml-14 bg-white rounded-lg border border-gray-200 p-5 hover:border-purple-300 hover:shadow-md transition-all group">

        <!-- Step Header -->
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <svg class="w-5 h-5 text-white step-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
            </div>
            <div class="flex-1">
              <select class="step-type-selector bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-gray-900 text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:border-purple-500" onchange="updateStepType('${stepId}', this.value)">
                <option value="trigger">Trigger</option>
                <option value="condition">Condition</option>
                <option value="ai-action">AI Action</option>
                <option value="integration">Integration</option>
                <option value="transform">Transform</option>
              </select>
              <code class="block mt-1 text-xs font-mono text-gray-500">step_${stepIndex + 1}.*</code>
            </div>
          </div>
          <button onclick="removeWorkflowStep('${stepId}')" class="text-gray-400 hover:text-red-600 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>

        <!-- Inferred Intent Field -->
        <div class="mb-4">
          <label class="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Inferred Intent</label>
          <input type="text"
                 class="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                 placeholder="e.g., Detect when new litigation document is uploaded"
                 onchange="updateStepIntent('${stepId}', this.value)">
        </div>

        <!-- Step Configuration (Dynamic based on type) -->
        <div class="step-config-container" id="config-${stepId}">
          <!-- Configuration fields will be inserted here based on step type -->
        </div>

        <!-- Status Indicator -->
        <div class="mt-4 flex items-center gap-2 text-xs">
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200">
            <div class="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
            <span class="text-amber-700 font-medium">Needs Configuration</span>
          </div>
          <code class="ml-auto text-gray-500 font-mono">{{step_${stepIndex + 1}.output}}</code>
        </div>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', stepHtml);

  // Initialize step configuration UI
  updateStepConfigUI(stepId, 'trigger');

  // Update MX diagnostics
  mxDiagnostics.triggerCount++;
  updateMXDiagnostics();
}

/**
 * Update step type and refresh configuration UI
 */
function updateStepType(stepId, type) {
  const step = skillSteps.find(s => s.id === stepId);
  if (!step) return;

  // Update step counts for MX diagnostics
  if (step.type === 'trigger') mxDiagnostics.triggerCount--;
  else if (step.type === 'condition') mxDiagnostics.conditionCount--;
  else if (step.type === 'ai-action' || step.type === 'integration' || step.type === 'transform') mxDiagnostics.actionCount--;

  step.type = type;
  step.config = {};

  if (type === 'trigger') mxDiagnostics.triggerCount++;
  else if (type === 'condition') mxDiagnostics.conditionCount++;
  else if (type === 'ai-action' || type === 'integration' || type === 'transform') mxDiagnostics.actionCount++;

  updateStepConfigUI(stepId, type);
  updateMXDiagnostics();
}

/**
 * Update step configuration UI based on type
 */
function updateStepConfigUI(stepId, type) {
  const configContainer = document.getElementById(`config-${stepId}`);
  if (!configContainer) return;

  let configHtml = '';

  switch (type) {
    case 'trigger':
      configHtml = `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Event Type</label>
            <div class="flex flex-wrap items-center gap-2">
              <select id="event-type-select-${stepId}" onchange="updateEventDescription('${stepId}')" class="flex-1 min-w-[220px] px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                ${window.LanaEventCatalog && typeof window.LanaEventCatalog.buildSelectOptions === 'function'
                  ? window.LanaEventCatalog.buildSelectOptions()
                  : `
                    <optgroup label="Document Events">
                      <option value="document.created">document.created</option>
                      <option value="document.updated">document.updated</option>
                      <option value="document.deleted">document.deleted</option>
                      <option value="document.uploaded">document.uploaded</option>
                      <option value="document.parsed">document.parsed</option>
                      <option value="document.indexed">document.indexed</option>
                      <option value="document.ready">document.ready</option>
                      <option value="document.summarized">document.summarized</option>
                      <option value="document.processed">document.processed</option>
                      <option value="document.shared">document.shared</option>
                      <option value="document.downloaded">document.downloaded</option>
                      <option value="document_version.created">document_version.created</option>
                      <option value="document_version.restored">document_version.restored</option>
                    </optgroup>
                  `}
              </select>
              <button type="button" class="px-3 py-2 text-xs font-semibold rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100" data-event-browser-open-step="${stepId}">Browse Events</button>
            </div>
            <div id="event-description-${stepId}" class="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              ${renderMatterEventSummaryHtml('document.created')}
            </div>
          </div>
        </div>
      `;
      break;

    case 'condition':
      configHtml = `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Field to Check</label>
            <input type="text" placeholder="e.g., trigger.data.fileType"
                   class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1.5">Operator</label>
              <select class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
                <option value="equals">equals</option>
                <option value="contains">contains</option>
                <option value="greater_than">greater than</option>
                <option value="less_than">less than</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1.5">Value</label>
              <input type="text" placeholder="e.g., .pdf"
                     class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
            </div>
          </div>
        </div>
      `;
      break;

    case 'ai-action':
      configHtml = `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">AI Task</label>
            <select class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
              <option value="summarize">Summarize Document</option>
              <option value="extract">Extract Key Information</option>
              <option value="classify">Classify Content</option>
              <option value="generate">Generate Text</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">AI Instructions Mode</label>
            <select class="ai-prompt-mode-select w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
              <option value="default">Use Default AI Instructions</option>
              <option value="custom">Use Custom System Prompt</option>
            </select>
          </div>
          <div class="ai-system-prompt-field hidden">
            <label class="block text-xs font-medium text-gray-700 mb-1.5">System Prompt</label>
            <textarea rows="3" placeholder="You are a concise estate deadline specialist..."
                      class="ai-system-prompt-input w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"></textarea>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Prompt Template</label>
            <textarea rows="3" placeholder="Summarize the key points from {{trigger.data.document}}..."
                      class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"></textarea>
          </div>
        </div>
      `;
      break;

    case 'integration':
      configHtml = `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Action Type</label>
            <select class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
              <option value="send_email">Send Email</option>
              <option value="create_task">Create Task</option>
              <option value="update_crm">Update CRM</option>
              <option value="post_slack">Post to Slack</option>
            </select>
          </div>
        </div>
      `;
      break;

    case 'transform':
      configHtml = `
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Operation</label>
            <select class="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500">
              <option value="map">Map Fields</option>
              <option value="filter">Filter Data</option>
              <option value="merge">Merge Objects</option>
              <option value="split">Split String</option>
            </select>
          </div>
        </div>
      `;
      break;
  }

  configContainer.innerHTML = configHtml;

  if (type === 'trigger') {
    const browseButton = configContainer.querySelector('[data-event-browser-open-step]');
    if (browseButton) {
      browseButton.addEventListener('click', function() {
        openMatterEventBrowserForStep(stepId);
      });
    }
  }

  var step = skillSteps.find(s => s.id === stepId);
  var syncStepConfig = function() {
    if (!step) return;

    if (type === 'trigger') {
      var eventSelect = configContainer.querySelector('select');
      step.config = { event_type: eventSelect ? eventSelect.value : 'manual' };
      return;
    }

    if (type === 'condition') {
      var conditionInputs = configContainer.querySelectorAll('input');
      var conditionSelect = configContainer.querySelector('select');
      step.config = {
        field: conditionInputs[0] ? conditionInputs[0].value : '',
        operator: conditionSelect ? conditionSelect.value : 'equals',
        value: conditionInputs[1] ? conditionInputs[1].value : ''
      };
      return;
    }

    if (type === 'ai-action') {
      var aiSelects = configContainer.querySelectorAll('select');
      var aiTextareas = configContainer.querySelectorAll('textarea');
      step.config = {
        task: aiSelects[0] ? aiSelects[0].value : 'summarize',
        prompt_mode: aiSelects[1] ? aiSelects[1].value : 'default',
        system_prompt: aiSelects[1] && aiSelects[1].value === 'custom' && aiTextareas[0] ? aiTextareas[0].value : '',
        prompt_template: aiTextareas[1] ? aiTextareas[1].value : ''
      };
      return;
    }

    if (type === 'integration') {
      var integrationSelect = configContainer.querySelector('select');
      step.config = { action_type: integrationSelect ? integrationSelect.value : 'send_email' };
      return;
    }

    if (type === 'transform') {
      var transformSelect = configContainer.querySelector('select');
      step.config = { operation: transformSelect ? transformSelect.value : 'map' };
    }
  };

  var promptModeSelect = configContainer.querySelector('.ai-prompt-mode-select');
  var systemPromptField = configContainer.querySelector('.ai-system-prompt-field');
  if (promptModeSelect && systemPromptField) {
    var updateAiPromptModeVisibility = function() {
      systemPromptField.classList.toggle('hidden', promptModeSelect.value !== 'custom');
    };
    updateAiPromptModeVisibility();
    promptModeSelect.addEventListener('change', updateAiPromptModeVisibility);
  }

  var formFields = configContainer.querySelectorAll('select, input, textarea');
  formFields.forEach(function(field) {
    field.addEventListener('change', syncStepConfig);
    field.addEventListener('input', syncStepConfig);
  });
  syncStepConfig();
}

/**
 * Update step inferred intent
 */
function updateStepIntent(stepId, intent) {
  const step = skillSteps.find(s => s.id === stepId);
  if (step) {
    step.inferred_intent = intent;
    updateMXDiagnostics();
  }
}

/**
 * Update event description when user selects a different event type
 */
function updateEventDescription(stepId) {
  const selectEl = document.getElementById(`event-type-select-${stepId}`);
  const descEl = document.getElementById(`event-description-${stepId}`);

  if (selectEl && descEl) {
    const selectedEvent = selectEl.value;
    descEl.innerHTML = renderMatterEventSummaryHtml(selectedEvent);
  }
}

function openMatterEventBrowserForStep(stepId) {
  const selectEl = document.getElementById(`event-type-select-${stepId}`);
  const descEl = document.getElementById(`event-description-${stepId}`);
  if (!selectEl || !window.LanaEventBrowser) return;

  window.LanaEventBrowser.open({
    currentValue: selectEl.value,
    onSelect: function(eventType) {
      selectEl.value = eventType;
      if (descEl) {
        descEl.innerHTML = renderMatterEventSummaryHtml(eventType);
      }
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

/**
 * Remove a skill step
 */
function removeWorkflowStep(stepId) {
  const stepEl = document.querySelector(`[data-step-id="${stepId}"]`);
  if (stepEl) {
    stepEl.remove();
  }

  const stepIndex = skillSteps.findIndex(s => s.id === stepId);
  if (stepIndex !== -1) {
    const step = skillSteps[stepIndex];

    // Update MX diagnostics
    if (step.type === 'trigger') mxDiagnostics.triggerCount--;
    else if (step.type === 'condition') mxDiagnostics.conditionCount--;
    else if (step.type === 'ai-action' || step.type === 'integration' || step.type === 'transform') mxDiagnostics.actionCount--;

    skillSteps.splice(stepIndex, 1);
    updateMXDiagnostics();
  }
}

/**
 * Save the skill with all configured steps.
 *
 * Builds a skill_config from the skillSteps array, creates the skill via API,
 * then associates it with the current matter.
 */
async function saveSkill() {
  const skillName = document.getElementById('skill_name')?.value?.trim();
  const skillDescription = document.getElementById('skill_description')?.value?.trim();

  if (!skillName) {
    showNotification('Please enter a skill name', 'error');
    return;
  }

  if (skillSteps.length === 0) {
    showNotification('Please add at least one step to your skill', 'error');
    return;
  }

  // Build skill_config from skillSteps
  var triggerStep = skillSteps.find(function(s) { return s.type === 'trigger'; });
  var actionSteps = skillSteps.filter(function(s) {
    return s.type === 'ai-action' || s.type === 'integration' || s.type === 'transform';
  });
  var conditionSteps = skillSteps.filter(function(s) { return s.type === 'condition'; });

  // Map step types to action config
  var actions = actionSteps.map(function(step) {
    var actionType = 'ai_prompt';
    if (step.type === 'integration') actionType = 'integration';
    else if (step.type === 'transform') actionType = 'data_transform';
    return {
      type: actionType,
      label: step.label || step.type,
      config: Object.assign({}, step.config || {}, {
        prompt: step.config?.prompt_template || step.config?.prompt || ''
      })
    };
  });

  var conditions = conditionSteps.map(function(step) {
    return {
      field: step.config?.field || '',
      operator: step.config?.operator || 'equals',
      value: step.config?.value || ''
    };
  });

  var skillConfig = {
    trigger: {
      event_type: triggerStep?.config?.event_type || 'manual'
    },
    actions: actions,
    conditions: conditions
  };

  var skillData = {
    skill_name: skillName,
    description: skillDescription || '',
    category: 'custom',
    skill_type: 'custom',
    is_built_in: false,
    config: skillConfig
  };

  try {
    // Step 1: Create the skill definition
    var response = await api.post('/api/v1/skills', skillData);

    if (!response || !response.success) {
      showNotification('Failed to create skill', 'error');
      return;
    }

    var skillId = response.skill?.skill_id || response.data?.skill_id;
    if (!skillId) {
      showNotification('Skill created but no ID returned', 'error');
      return;
    }

    // Step 2: Associate skill with the current matter
    var matterId = window.currentSkillMatterId;
    if (matterId) {
      try {
        await api.post('/api/v1/matters/' + matterId + '/skills', {
          skill_id: skillId,
          config_overrides: {}
        });
      } catch (assocError) {
        console.error('[saveSkill] Failed to associate skill with matter:', assocError);
        showNotification('Skill created but failed to enable for matter', 'warning');
      }
    }

    showNotification('Skill created successfully', 'success');

    // Close modal and refresh skills tab
    closeCreateSkillModal();
    var currentMatter = currentMatterData?.matter;
    if (currentMatter) {
      renderSkillsTab(currentMatter);
    }
  } catch (error) {
    console.error('[saveSkill] Error:', error);
    showNotification(error.message || 'Failed to create skill', 'error');
  }
}

// Listen for changes to skill name and description to update MX diagnostics
document.addEventListener('DOMContentLoaded', () => {
  const skillNameInput = document.getElementById('skill_name');
  const skillDescInput = document.getElementById('skill_description');

  if (skillNameInput) {
    skillNameInput.addEventListener('input', updateMXDiagnostics);
  }

  if (skillDescInput) {
    skillDescInput.addEventListener('input', updateMXDiagnostics);
  }
});

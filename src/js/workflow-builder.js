/**
 * Workflow Builder Module
 * Visual drag-and-drop workflow editor using Drawflow
 */

// Node type definitions
const WorkflowNodeTypes = {
  triggers: [
    {
      type: 'trigger-schedule',
      name: 'Schedule',
      description: 'Trigger at specified times',
      icon: 'clock',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      config: {
        cron: '0 9 * * *',
        timezone: 'America/New_York'
      }
    },
    {
      type: 'trigger-event',
      name: 'Event',
      description: 'Trigger on specific events',
      icon: 'bolt',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      config: {
        event: 'lead.created',
        filters: []
      }
    },
    {
      type: 'trigger-manual',
      name: 'Manual',
      description: 'Manual execution trigger',
      icon: 'hand',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      config: {}
    }
  ],
  conditions: [
    {
      type: 'condition-age',
      name: 'Check Age',
      description: 'Check record age in days',
      icon: 'calendar',
      color: 'yellow',
      inputs: 1,
      outputs: 2,
      config: {
        field: 'created_at',
        operator: 'greater_than',
        value: 7
      }
    },
    {
      type: 'condition-status',
      name: 'Check Status',
      description: 'Check record status',
      icon: 'flag',
      color: 'yellow',
      inputs: 1,
      outputs: 2,
      config: {
        field: 'status',
        operator: 'equals',
        value: 'open'
      }
    },
    {
      type: 'condition-field',
      name: 'Check Field',
      description: 'Check any field value',
      icon: 'filter',
      color: 'yellow',
      inputs: 1,
      outputs: 2,
      config: {
        field: '',
        operator: 'equals',
        value: ''
      }
    }
  ],
  actions: [
    {
      type: 'action-email',
      name: 'Send Email',
      description: 'Send an email',
      icon: 'envelope',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      config: {
        to: '{{contact.email}}',
        subject: '',
        template: ''
      }
    },
    {
      type: 'action-sms',
      name: 'Send SMS',
      description: 'Send an SMS message',
      icon: 'chat',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      config: {
        to: '{{contact.phone}}',
        message: ''
      }
    },
    {
      type: 'action-task',
      name: 'Create Task',
      description: 'Create a follow-up task',
      icon: 'clipboard',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      config: {
        title: '',
        assignee: 'assigned_rep',
        dueIn: 1,
        priority: 'normal'
      }
    },
    {
      type: 'action-update',
      name: 'Update Record',
      description: 'Update CRM record',
      icon: 'pencil',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      config: {
        field: '',
        value: ''
      }
    },
    {
      type: 'action-notify',
      name: 'Notify',
      description: 'Send internal notification',
      icon: 'bell',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      config: {
        recipient: 'assigned_rep',
        message: ''
      }
    },
    {
      type: 'action-escalate',
      name: 'Escalate',
      description: 'Escalate to manager',
      icon: 'arrow-up',
      color: 'red',
      inputs: 1,
      outputs: 1,
      config: {
        escalateTo: 'manager',
        reason: ''
      }
    },
    {
      type: 'action-document',
      name: 'Generate Document',
      description: 'Generate document from template',
      icon: 'document',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      config: {
        templateId: '',
        savePath: '/documents/'
      }
    },
    {
      type: 'action-retarget',
      name: 'Add to Audience',
      description: 'Add to retargeting audience',
      icon: 'users',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      config: {
        audienceId: '',
        platform: 'facebook'
      }
    }
  ]
};

// Event type options
const EventTypes = [
  { value: 'lead.created', label: 'New Lead Created' },
  { value: 'lead.updated', label: 'Lead Updated' },
  { value: 'opportunity.created', label: 'New Opportunity' },
  { value: 'opportunity.aged', label: 'Opportunity Aged' },
  { value: 'appointment.scheduled', label: 'Appointment Scheduled' },
  { value: 'appointment.no_show', label: 'Appointment No-Show' },
  { value: 'appointment.completed', label: 'Appointment Completed' },
  { value: 'client.signed', label: 'Client Signed' },
  { value: 'document.signed', label: 'Document Signed' },
  { value: 'payment.received', label: 'Payment Received' },
  { value: 'followup.missed', label: 'Follow-up Missed' }
];

// Dropdowns are lex-select (UI standard section 11). Values are strings. An
// unknown value falls back to the first option, as a native select would,
// unless the list starts with an empty "Select ..." option.
function workflowEscapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function workflowConfigSelect(id, options, value) {
  const opts = options.map((option) => ({ value: String(option.value), label: String(option.label) }));
  const current = value === undefined || value === null ? '' : String(value);
  const emptyOption = opts.find((option) => option.value === '');
  let selected = current;
  if (!opts.some((option) => option.value === current)) {
    selected = emptyOption ? '' : (opts[0] ? opts[0].value : '');
  }
  const placeholder = emptyOption ? emptyOption.label : 'Select...';
  return `<lex-select id="${workflowEscapeAttr(id)}" options="${workflowEscapeAttr(JSON.stringify(opts))}" value="${workflowEscapeAttr(selected)}" placeholder="${workflowEscapeAttr(placeholder)}"></lex-select>`;
}

function getWorkflowEventSummaryHtml(eventType) {
  if (window.LanaEventBrowser && typeof window.LanaEventBrowser.renderSummaryHtml === 'function') {
    return window.LanaEventBrowser.renderSummaryHtml(eventType);
  }

  const label = EventTypes.find((entry) => entry.value === eventType)?.label || eventType;
  return `
    <div class="rounded-xl border border-gray-200 bg-blue-50 p-3">
      <p class="text-xs text-blue-800"><strong>Description:</strong> ${label}</p>
    </div>
  `;
}

function openWorkflowEventBrowser() {
  const selectEl = document.getElementById('config-event');
  const descEl = document.getElementById('workflow-event-description');
  if (!selectEl || !window.LanaEventBrowser) return;

  window.LanaEventBrowser.open({
    currentValue: selectEl.value,
    onSelect: function(eventType) {
      selectEl.value = eventType;
      if (descEl) {
        descEl.innerHTML = getWorkflowEventSummaryHtml(eventType);
      }
      selectEl.dispatchEvent(new CustomEvent('lex-change', { bubbles: true, detail: { name: selectEl.name || '', value: eventType } }));
    }
  });
}

// SVG Icons for nodes
const NodeIcons = {
  clock: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
  bolt: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>',
  hand: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"></path></svg>',
  calendar: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>',
  flag: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"></path></svg>',
  filter: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>',
  envelope: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>',
  chat: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>',
  clipboard: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>',
  pencil: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>',
  bell: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>',
  'arrow-up': '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>',
  document: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
  users: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>'
};

// Color classes
const NodeColors = {
  purple: { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-700', icon: 'text-purple-600' },
  yellow: { bg: 'bg-yellow-100', border: 'border-yellow-300', text: 'text-yellow-700', icon: 'text-yellow-600' },
  blue: { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700', icon: 'text-blue-600' },
  red: { bg: 'bg-red-100', border: 'border-red-300', text: 'text-red-700', icon: 'text-red-600' },
  green: { bg: 'bg-green-100', border: 'border-green-300', text: 'text-green-700', icon: 'text-green-600' }
};

// Workflow Builder Class
class WorkflowBuilder {
  constructor(containerId) {
    this.containerId = containerId;
    this.editor = null;
    this.selectedNode = null;
    this.workflowId = null;
    this.workflowName = 'New Workflow';
    this.workflowDescription = '';
    this.isDirty = false;
    this.nodeConfigs = {}; // Store node configurations by node ID
  }

  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error('Container not found:', this.containerId);
      return;
    }

    this.editor = new Drawflow(container);
    this.editor.reroute = true;
    this.editor.reroute_fix_curvature = true;
    this.editor.force_first_input = false;

    // Register custom node HTML
    this.registerNodeTypes();

    // Start the editor
    this.editor.start();

    // Event listeners
    this.setupEventListeners();

    return this;
  }

  registerNodeTypes() {
    // Register all node types with Drawflow
    const allNodes = [
      ...WorkflowNodeTypes.triggers,
      ...WorkflowNodeTypes.conditions,
      ...WorkflowNodeTypes.actions
    ];

    allNodes.forEach(node => {
      this.editor.registerNode(node.type, this.createNodeHTML(node), {}, {});
    });
  }

  createNodeHTML(nodeDef) {
    const colors = NodeColors[nodeDef.color] || NodeColors.blue;
    const icon = NodeIcons[nodeDef.icon] || NodeIcons.document;

    return `
      <div class="workflow-node ${colors.bg} ${colors.border} border-2 rounded-lg p-3 min-w-[160px] shadow-sm">
        <div class="flex items-center gap-2 mb-1">
          <div class="${colors.icon}">${icon}</div>
          <span class="font-medium ${colors.text} text-sm">${nodeDef.name}</span>
        </div>
        <div class="text-xs text-gray-500">${nodeDef.description}</div>
      </div>
    `;
  }

  setupEventListeners() {
    // Node selected
    this.editor.on('nodeSelected', (nodeId) => {
      this.selectedNode = nodeId;
      this.showNodeConfig(nodeId);
    });

    // Node unselected
    this.editor.on('nodeUnselected', () => {
      this.selectedNode = null;
      this.hideNodeConfig();
    });

    // Node created
    this.editor.on('nodeCreated', (nodeId) => {
      this.isDirty = true;
    });

    // Node removed
    this.editor.on('nodeRemoved', (nodeId) => {
      this.isDirty = true;
      delete this.nodeConfigs[nodeId];
      if (this.selectedNode === nodeId) {
        this.hideNodeConfig();
      }
    });

    // Connection created
    this.editor.on('connectionCreated', (connection) => {
      this.isDirty = true;
    });

    // Connection removed
    this.editor.on('connectionRemoved', (connection) => {
      this.isDirty = true;
    });

    // Node moved
    this.editor.on('nodeMoved', (nodeId) => {
      this.isDirty = true;
    });
  }

  addNode(nodeType, posX = 100, posY = 100) {
    const nodeDef = this.findNodeDef(nodeType);
    if (!nodeDef) {
      console.error('Unknown node type:', nodeType);
      return null;
    }

    const html = this.createNodeHTML(nodeDef);
    const nodeId = this.editor.addNode(
      nodeDef.type,
      nodeDef.inputs,
      nodeDef.outputs,
      posX,
      posY,
      nodeDef.type,
      { type: nodeDef.type },
      html
    );

    // Store default config
    this.nodeConfigs[nodeId] = { ...nodeDef.config };
    this.isDirty = true;

    return nodeId;
  }

  findNodeDef(nodeType) {
    const allNodes = [
      ...WorkflowNodeTypes.triggers,
      ...WorkflowNodeTypes.conditions,
      ...WorkflowNodeTypes.actions
    ];
    return allNodes.find(n => n.type === nodeType);
  }

  showNodeConfig(nodeId) {
    const node = this.editor.getNodeFromId(nodeId);
    if (!node) return;

    const nodeDef = this.findNodeDef(node.class);
    if (!nodeDef) return;

    const config = this.nodeConfigs[nodeId] || { ...nodeDef.config };
    const configPanel = document.getElementById('nodeConfigPanel');
    if (!configPanel) return;

    configPanel.innerHTML = this.renderConfigForm(nodeDef, config, nodeId);
    configPanel.classList.remove('hidden');

    const eventSelect = document.getElementById('config-event');
    if (eventSelect) {
      eventSelect.addEventListener('lex-change', (event) => {
        const descEl = document.getElementById('workflow-event-description');
        if (descEl) descEl.innerHTML = getWorkflowEventSummaryHtml(event.detail.value);
      });
    }
  }

  hideNodeConfig() {
    const configPanel = document.getElementById('nodeConfigPanel');
    if (configPanel) {
      configPanel.classList.add('hidden');
    }
  }

  renderConfigForm(nodeDef, config, nodeId) {
    const colors = NodeColors[nodeDef.color] || NodeColors.blue;
    let formFields = '';

    switch (nodeDef.type) {
      case 'trigger-schedule':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Schedule (Cron Expression)</label>
              <input type="text" id="config-cron" value="${config.cron || '0 9 * * *'}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="0 9 * * * (9 AM daily)">
              <p class="mt-1 text-xs text-gray-500">Examples: 0 9 * * * (daily at 9AM), 0 */6 * * * (every 6 hours)</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              ${workflowConfigSelect('config-timezone', [{ value: 'America/New_York', label: 'Eastern Time' }, { value: 'America/Chicago', label: 'Central Time' }, { value: 'America/Denver', label: 'Mountain Time' }, { value: 'America/Los_Angeles', label: 'Pacific Time' }], config.timezone)}
            </div>
          </div>
        `;
        break;

      case 'trigger-event':
        formFields = `
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
            <div class="flex flex-wrap items-center gap-2">
              <div class="flex-1 min-w-[220px]">${workflowConfigSelect('config-event', EventTypes, config.event)}</div>
              <button type="button" class="px-3 py-2 text-xs font-semibold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100" onclick="openWorkflowEventBrowser()">Browse Events</button>
            </div>
            <div id="workflow-event-description" class="mt-2">
              ${getWorkflowEventSummaryHtml(config.event || EventTypes[0].value)}
            </div>
          </div>
        `;
        break;

      case 'condition-age':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Operator</label>
              ${workflowConfigSelect('config-operator', [{ value: 'greater_than', label: 'Greater than' }, { value: 'less_than', label: 'Less than' }, { value: 'equals', label: 'Equals' }], config.operator)}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Days</label>
              <input type="number" id="config-value" value="${config.value || 7}" min="0"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            </div>
          </div>
        `;
        break;

      case 'condition-status':
      case 'condition-field':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Field</label>
              <input type="text" id="config-field" value="${config.field || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., status, stage, source">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Operator</label>
              ${workflowConfigSelect('config-operator', [{ value: 'equals', label: 'Equals' }, { value: 'not_equals', label: 'Not Equals' }, { value: 'contains', label: 'Contains' }], config.operator)}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Value</label>
              <input type="text" id="config-value" value="${config.value || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            </div>
          </div>
        `;
        break;

      case 'action-email':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input type="text" id="config-to" value="${config.to || '{{contact.email}}'}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input type="text" id="config-subject" value="${config.subject || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Template</label>
              ${workflowConfigSelect('config-template', [{ value: '', label: 'Select template...' }, { value: 'initial_followup', label: 'Initial Follow-up' }, { value: 'second_followup', label: 'Second Follow-up' }, { value: 'urgent_followup', label: 'Urgent Follow-up' }, { value: 'welcome', label: 'Welcome Email' }], config.template)}
            </div>
          </div>
        `;
        break;

      case 'action-sms':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input type="text" id="config-to" value="${config.to || '{{contact.phone}}'}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea id="config-message" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">${config.message || ''}</textarea>
            </div>
          </div>
        `;
        break;

      case 'action-task':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Task Title</label>
              <input type="text" id="config-title" value="${config.title || ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="Follow up with {{contact.name}}">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
              ${workflowConfigSelect('config-assignee', [{ value: 'assigned_rep', label: 'Assigned Rep' }, { value: 'manager', label: 'Manager' }, { value: 'intake', label: 'Intake Team' }], config.assignee)}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Due In (Days)</label>
              <input type="number" id="config-dueIn" value="${config.dueIn || 1}" min="0"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              ${workflowConfigSelect('config-priority', [{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }], config.priority)}
            </div>
          </div>
        `;
        break;

      case 'action-notify':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Notify</label>
              ${workflowConfigSelect('config-recipient', [{ value: 'assigned_rep', label: 'Assigned Rep' }, { value: 'manager', label: 'Manager' }, { value: 'all', label: 'All Team' }], config.recipient)}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea id="config-message" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">${config.message || ''}</textarea>
            </div>
          </div>
        `;
        break;

      case 'action-escalate':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Escalate To</label>
              ${workflowConfigSelect('config-escalateTo', [{ value: 'manager', label: 'Manager' }, { value: 'senior_partner', label: 'Senior Partner' }, { value: 'admin', label: 'Admin' }], config.escalateTo)}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <textarea id="config-reason" rows="2"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">${config.reason || ''}</textarea>
            </div>
          </div>
        `;
        break;

      case 'action-document':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Document Template</label>
              ${workflowConfigSelect('config-templateId', [{ value: '', label: 'Select template...' }, { value: 'engagement_letter', label: 'Engagement Letter' }, { value: 'fee_agreement', label: 'Fee Agreement' }, { value: 'retainer', label: 'Retainer Agreement' }], config.templateId)}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Save Path</label>
              <input type="text" id="config-savePath" value="${config.savePath || '/documents/'}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            </div>
          </div>
        `;
        break;

      case 'action-retarget':
        formFields = `
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Audience</label>
              ${workflowConfigSelect('config-audienceId', [{ value: '', label: 'Select audience...' }, { value: 'no_shows', label: 'No-Shows' }, { value: 'stale_leads', label: 'Stale Leads' }, { value: 'lost_opportunities', label: 'Lost Opportunities' }], config.audienceId)}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Platform</label>
              ${workflowConfigSelect('config-platform', [{ value: 'facebook', label: 'Facebook' }, { value: 'google', label: 'Google Ads' }], config.platform)}
            </div>
          </div>
        `;
        break;

      default:
        formFields = '<p class="text-sm text-gray-500">No configuration options available.</p>';
    }

    return `
      <div class="p-4">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <div class="${colors.icon}">${NodeIcons[nodeDef.icon] || NodeIcons.document}</div>
            <h3 class="font-semibold text-gray-900">${nodeDef.name}</h3>
          </div>
          <button onclick="workflowBuilder.deleteSelectedNode()" class="text-red-500 hover:text-red-700" title="Delete node">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
        ${formFields}
        <div class="mt-4 pt-4 border-t border-gray-200">
          <button onclick="workflowBuilder.saveNodeConfig(${nodeId})" class="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Apply Changes
          </button>
        </div>
      </div>
    `;
  }

  saveNodeConfig(nodeId) {
    const node = this.editor.getNodeFromId(nodeId);
    if (!node) return;

    const nodeDef = this.findNodeDef(node.class);
    if (!nodeDef) return;

    const config = {};

    // Collect all config values from form
    Object.keys(nodeDef.config).forEach(key => {
      const el = document.getElementById(`config-${key}`);
      if (el) {
        config[key] = el.type === 'number' ? parseInt(el.value, 10) : el.value;
      }
    });

    this.nodeConfigs[nodeId] = config;
    this.isDirty = true;

    if (typeof Toast !== 'undefined') {
      Toast.success('Node configuration saved');
    }
  }

  deleteSelectedNode() {
    if (this.selectedNode) {
      this.editor.removeNodeId(`node-${this.selectedNode}`);
      this.selectedNode = null;
      this.hideNodeConfig();
    }
  }

  // Export workflow to JSON format
  exportWorkflow() {
    const data = this.editor.export();
    const nodes = [];

    // Convert Drawflow format to our format
    if (data.drawflow && data.drawflow.Home && data.drawflow.Home.data) {
      Object.entries(data.drawflow.Home.data).forEach(([id, node]) => {
        nodes.push({
          id: id,
          type: node.class,
          position: { x: node.pos_x, y: node.pos_y },
          config: this.nodeConfigs[id] || {},
          inputs: node.inputs,
          outputs: node.outputs
        });
      });
    }

    return {
      id: this.workflowId,
      name: this.workflowName,
      description: this.workflowDescription,
      nodes: nodes,
      drawflowData: data,
      createdAt: LanaTime.nowIso()
    };
  }

  // Import workflow from JSON
  importWorkflow(workflowData) {
    if (workflowData.drawflowData) {
      this.editor.import(workflowData.drawflowData);
    }

    this.workflowId = workflowData.id;
    this.workflowName = workflowData.name || 'Imported Workflow';
    this.workflowDescription = workflowData.description || '';

    // Restore node configs
    if (workflowData.nodes) {
      workflowData.nodes.forEach(node => {
        this.nodeConfigs[node.id] = node.config || {};
      });
    }

    this.isDirty = false;
  }

  // Clear the canvas
  clear() {
    this.editor.clear();
    this.nodeConfigs = {};
    this.selectedNode = null;
    this.hideNodeConfig();
    this.isDirty = true;
  }

  // Validate workflow
  validate() {
    const data = this.editor.export();
    const errors = [];

    if (!data.drawflow || !data.drawflow.Home || !data.drawflow.Home.data) {
      errors.push('Workflow is empty');
      return { valid: false, errors };
    }

    const nodes = Object.values(data.drawflow.Home.data);

    // Check for at least one trigger
    const hasTrigger = nodes.some(n => n.class.startsWith('trigger-'));
    if (!hasTrigger) {
      errors.push('Workflow must have at least one trigger node');
    }

    // Check for at least one action
    const hasAction = nodes.some(n => n.class.startsWith('action-'));
    if (!hasAction) {
      errors.push('Workflow must have at least one action node');
    }

    // Check for orphaned nodes (no connections)
    nodes.forEach(node => {
      const hasInputs = Object.values(node.inputs).some(inp => inp.connections.length > 0);
      const hasOutputs = Object.values(node.outputs).some(out => out.connections.length > 0);

      if (!node.class.startsWith('trigger-') && !hasInputs) {
        errors.push(`Node "${this.findNodeDef(node.class)?.name || node.class}" has no input connections`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  // Zoom controls
  zoomIn() {
    this.editor.zoom_in();
  }

  zoomOut() {
    this.editor.zoom_out();
  }

  zoomReset() {
    this.editor.zoom_reset();
  }
}

// Export for use
window.WorkflowBuilder = WorkflowBuilder;
window.WorkflowNodeTypes = WorkflowNodeTypes;
window.NodeIcons = NodeIcons;
window.NodeColors = NodeColors;
window.EventTypes = EventTypes;

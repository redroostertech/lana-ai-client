/**
 * Skill Builder Module
 * Visual drag-and-drop skill editor using Drawflow.
 * Produces a valid skill_config JSON: { trigger, actions[], settings }
 */

// ═══════════════════════════════════════════════════════════════
// Node Type Definitions — maps to skill_config schema
// ═══════════════════════════════════════════════════════════════

var SkillNodeTypes = {
  triggers: [
    {
      type: 'trigger-document-uploaded',
      name: 'Document Uploaded',
      description: 'Fires when a document is uploaded',
      icon: 'upload',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      eventType: 'document.uploaded',
      config: {}
    },
    {
      type: 'trigger-document-updated',
      name: 'Document Updated',
      description: 'Fires when a document is modified',
      icon: 'document',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      eventType: 'document.updated',
      config: {}
    },
    {
      type: 'trigger-matter-created',
      name: 'Matter Created',
      description: 'Fires when a new matter is created',
      icon: 'folder',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      eventType: 'matter.created',
      config: {}
    },
    {
      type: 'trigger-matter-updated',
      name: 'Matter Updated',
      description: 'Fires when a matter is updated',
      icon: 'pencil',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      eventType: 'matter.updated',
      config: {}
    },
    {
      type: 'trigger-contact-created',
      name: 'Contact Created',
      description: 'Fires when a contact is created',
      icon: 'user',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      eventType: 'contact.created',
      config: {}
    },
    {
      type: 'trigger-contact-linked',
      name: 'Contact Linked',
      description: 'Fires when a contact is linked to a matter',
      icon: 'link',
      color: 'purple',
      inputs: 0,
      outputs: 1,
      eventType: 'contact.linked_to_matter',
      config: {}
    }
  ],

  conditions: [
    {
      type: 'condition-field',
      name: 'Check Field',
      description: 'Evaluate a field value',
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
    // ── AI ──
    {
      type: 'action-ai-analyze',
      name: 'AI Analysis',
      description: 'Analyze documents or text using LLM',
      icon: 'sparkle',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      actionType: 'ai.analyze',
      config: { prompt: '' }
    },
    {
      type: 'action-ai-generate',
      name: 'AI Generate Text',
      description: 'Generate text with a prompt',
      icon: 'sparkle',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      actionType: 'ai.generateText',
      config: { prompt: '' }
    },
    {
      type: 'action-ai-extract',
      name: 'Extract Entities',
      description: 'Extract named entities from text',
      icon: 'sparkle',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      actionType: 'ai.extractEntities',
      config: { text: '' }
    },
    // ── Text ──
    {
      type: 'action-text-diff',
      name: 'Text Diff',
      description: 'Compare two text strings',
      icon: 'document',
      color: 'green',
      inputs: 1,
      outputs: 1,
      actionType: 'text.diff',
      config: { original: '', modified: '' }
    },
    {
      type: 'action-text-template',
      name: 'Text Template',
      description: 'Generate text from template',
      icon: 'document',
      color: 'green',
      inputs: 1,
      outputs: 1,
      actionType: 'text.generate',
      config: { template: '', variables: '' }
    },
    // ── Database ──
    {
      type: 'action-db-query',
      name: 'Database Query',
      description: 'Query data with matter-scoped access',
      icon: 'database',
      color: 'cyan',
      inputs: 1,
      outputs: 1,
      actionType: 'database.query',
      config: { table: '', where: '' }
    },
    {
      type: 'action-db-insert',
      name: 'Database Insert',
      description: 'Insert a record',
      icon: 'database',
      color: 'cyan',
      inputs: 1,
      outputs: 1,
      actionType: 'database.insert',
      config: { table: '', data: '' }
    },
    // ── Document ──
    {
      type: 'action-doc-redline',
      name: 'Generate Redline',
      description: 'Compare two documents and generate redline',
      icon: 'document',
      color: 'red',
      inputs: 1,
      outputs: 1,
      actionType: 'document.generateRedline',
      config: { originalDocumentId: '', newDocumentId: '' }
    },
    {
      type: 'action-doc-convert',
      name: 'Convert Document',
      description: 'Convert document format',
      icon: 'document',
      color: 'red',
      inputs: 1,
      outputs: 1,
      actionType: 'document.convert',
      config: { documentId: '', output_format: 'pdf' }
    },
    {
      type: 'action-doc-merge',
      name: 'Merge Documents',
      description: 'Merge multiple documents',
      icon: 'document',
      color: 'red',
      inputs: 1,
      outputs: 1,
      actionType: 'document.merge',
      config: { documentIds: '' }
    },
    // ── Notification ──
    {
      type: 'action-notify',
      name: 'Send Notification',
      description: 'Send in-app notification',
      icon: 'bell',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      actionType: 'notification.send',
      config: { message: '', recipients: '' }
    },
    {
      type: 'action-email',
      name: 'Send Email',
      description: 'Send email via connector',
      icon: 'envelope',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      actionType: 'notification.sendEmail',
      config: { recipients: '', subject: '', body: '' }
    },
    {
      type: 'action-log-activity',
      name: 'Log Activity',
      description: 'Log to the activity feed',
      icon: 'clipboard',
      color: 'blue',
      inputs: 1,
      outputs: 1,
      actionType: 'notification.logActivity',
      config: { event_type: '', resource_type: '', resource_id: '', resource_name: '' }
    },
    // ── Artifact ──
    {
      type: 'action-artifact-store',
      name: 'Store Artifact',
      description: 'Store file in MinIO and create artifact',
      icon: 'archive',
      color: 'green',
      inputs: 1,
      outputs: 1,
      actionType: 'artifact.store',
      config: { artifact_type: '', artifact_name: '', file_path: '' }
    },
    // ── Connector ──
    {
      type: 'action-connector-push',
      name: 'Push to Connector',
      description: 'Push data to external API',
      icon: 'link',
      color: 'pink',
      inputs: 1,
      outputs: 1,
      actionType: 'connector.push',
      config: { connector_id: '', endpoint: '', data: '' }
    }
  ]
};

// Condition operators
var ConditionOperators = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does Not Contain' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
  { value: 'in', label: 'In List' },
  { value: 'not_in', label: 'Not In List' }
];

// SVG Icons for skill nodes
var SkillNodeIcons = {
  upload: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>',
  document: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
  folder: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>',
  pencil: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>',
  user: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>',
  link: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>',
  filter: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>',
  sparkle: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>',
  bell: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>',
  envelope: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>',
  clipboard: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>',
  database: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>',
  archive: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>',
  pink: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101"/></svg>'
};

// Color classes
var SkillNodeColors = {
  purple: { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-700', icon: 'text-purple-600' },
  yellow: { bg: 'bg-yellow-100', border: 'border-yellow-300', text: 'text-yellow-700', icon: 'text-yellow-600' },
  blue:   { bg: 'bg-blue-100',   border: 'border-blue-300',   text: 'text-blue-700',   icon: 'text-blue-600' },
  green:  { bg: 'bg-green-100',  border: 'border-green-300',  text: 'text-green-700',  icon: 'text-green-600' },
  red:    { bg: 'bg-red-100',    border: 'border-red-300',    text: 'text-red-700',    icon: 'text-red-600' },
  cyan:   { bg: 'bg-cyan-100',   border: 'border-cyan-300',   text: 'text-cyan-700',   icon: 'text-cyan-600' },
  pink:   { bg: 'bg-pink-100',   border: 'border-pink-300',   text: 'text-pink-700',   icon: 'text-pink-600' }
};


// ═══════════════════════════════════════════════════════════════
// SkillBuilder Class
// ═══════════════════════════════════════════════════════════════

function SkillBuilder(containerId) {
  this.containerId = containerId;
  this.editor = null;
  this.selectedNode = null;
  this.skillId = null;
  this.skillName = 'New Skill';
  this.skillDescription = '';
  this.skillVersion = '1.0.0';
  this.isDirty = false;
  this.nodeConfigs = {};
  this._actionIdCounter = 0;
  this._nodeActionIds = {}; // maps drawflow nodeId -> action_id string
}

SkillBuilder.prototype.init = function () {
  var container = document.getElementById(this.containerId);
  if (!container) {
    console.error('Container not found:', this.containerId);
    return;
  }

  this.editor = new Drawflow(container);
  this.editor.reroute = true;
  this.editor.reroute_fix_curvature = true;
  this.editor.force_first_input = false;

  this.registerNodeTypes();
  this.editor.start();
  this.setupEventListeners();

  return this;
};

SkillBuilder.prototype.registerNodeTypes = function () {
  var allNodes = SkillNodeTypes.triggers
    .concat(SkillNodeTypes.conditions)
    .concat(SkillNodeTypes.actions);

  var self = this;
  allNodes.forEach(function (node) {
    self.editor.registerNode(node.type, self.createNodeHTML(node), {}, {});
  });
};

SkillBuilder.prototype.createNodeHTML = function (nodeDef) {
  var colors = SkillNodeColors[nodeDef.color] || SkillNodeColors.blue;
  var icon = SkillNodeIcons[nodeDef.icon] || SkillNodeIcons.document;

  return '<div class="workflow-node ' + colors.bg + ' ' + colors.border + ' border-2 rounded-lg p-3 min-w-[160px] shadow-sm">'
    + '<div class="flex items-center gap-2 mb-1">'
    + '<div class="' + colors.icon + '">' + icon + '</div>'
    + '<span class="font-medium ' + colors.text + ' text-sm">' + nodeDef.name + '</span>'
    + '</div>'
    + '<div class="text-xs text-gray-500">' + nodeDef.description + '</div>'
    + '</div>';
};

SkillBuilder.prototype.setupEventListeners = function () {
  var self = this;

  this.editor.on('nodeSelected', function (nodeId) {
    self.selectedNode = nodeId;
    self.showNodeConfig(nodeId);
  });

  this.editor.on('nodeUnselected', function () {
    self.selectedNode = null;
    self.hideNodeConfig();
  });

  this.editor.on('nodeCreated', function () {
    self.isDirty = true;
  });

  this.editor.on('nodeRemoved', function (nodeId) {
    self.isDirty = true;
    delete self.nodeConfigs[nodeId];
    delete self._nodeActionIds[nodeId];
    if (self.selectedNode === nodeId) {
      self.hideNodeConfig();
    }
  });

  this.editor.on('connectionCreated', function () {
    self.isDirty = true;
  });

  this.editor.on('connectionRemoved', function () {
    self.isDirty = true;
  });

  this.editor.on('nodeMoved', function () {
    self.isDirty = true;
  });
};

SkillBuilder.prototype.addNode = function (nodeType, posX, posY) {
  posX = posX || 100;
  posY = posY || 100;

  var nodeDef = this.findNodeDef(nodeType);
  if (!nodeDef) {
    console.error('Unknown node type:', nodeType);
    return null;
  }

  var html = this.createNodeHTML(nodeDef);
  var nodeId = this.editor.addNode(
    nodeDef.type,
    nodeDef.inputs,
    nodeDef.outputs,
    posX, posY,
    nodeDef.type,
    { type: nodeDef.type },
    html
  );

  // Store default config
  var configCopy = {};
  var keys = Object.keys(nodeDef.config);
  for (var i = 0; i < keys.length; i++) {
    configCopy[keys[i]] = nodeDef.config[keys[i]];
  }
  this.nodeConfigs[nodeId] = configCopy;

  // Generate an action_id for action nodes
  if (nodeDef.actionType) {
    this._actionIdCounter++;
    this._nodeActionIds[nodeId] = nodeDef.actionType.split('.').join('-') + '-' + this._actionIdCounter;
  }

  this.isDirty = true;
  return nodeId;
};

SkillBuilder.prototype.findNodeDef = function (nodeType) {
  var allNodes = SkillNodeTypes.triggers
    .concat(SkillNodeTypes.conditions)
    .concat(SkillNodeTypes.actions);
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].type === nodeType) return allNodes[i];
  }
  return null;
};

SkillBuilder.prototype.showNodeConfig = function (nodeId) {
  var node = this.editor.getNodeFromId(nodeId);
  if (!node) return;

  var nodeDef = this.findNodeDef(node.class);
  if (!nodeDef) return;

  var config = this.nodeConfigs[nodeId] || {};
  var configPanel = document.getElementById('nodeConfigPanel');
  if (!configPanel) return;

  configPanel.innerHTML = this.renderConfigForm(nodeDef, config, nodeId);
  configPanel.classList.remove('hidden');
};

SkillBuilder.prototype.hideNodeConfig = function () {
  var configPanel = document.getElementById('nodeConfigPanel');
  if (configPanel) configPanel.classList.add('hidden');
};

SkillBuilder.prototype.renderConfigForm = function (nodeDef, config, nodeId) {
  var colors = SkillNodeColors[nodeDef.color] || SkillNodeColors.blue;
  var icon = SkillNodeIcons[nodeDef.icon] || SkillNodeIcons.document;
  var formFields = '';
  var actionId = this._nodeActionIds[nodeId] || '';

  // Action ID field for action nodes
  var actionIdField = '';
  if (nodeDef.actionType) {
    actionIdField = '<div>'
      + '<label class="block text-sm font-medium text-gray-700 mb-1">Action ID</label>'
      + '<input type="text" id="config-action-id" value="' + escapeAttr(actionId) + '"'
      + ' class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"'
      + ' placeholder="unique-action-id">'
      + '<p class="mt-1 text-xs text-gray-500">Unique identifier for referencing this action\'s output</p>'
      + '</div>';
  }

  // Build config form based on node type
  if (nodeDef.type === 'condition-field') {
    var operatorOptions = ConditionOperators.map(function (op) {
      var sel = config.operator === op.value ? ' selected' : '';
      return '<option value="' + op.value + '"' + sel + '>' + op.label + '</option>';
    }).join('');

    formFields = '<div class="space-y-4">'
      + '<div>'
      + '<label class="block text-sm font-medium text-gray-700 mb-1">Field</label>'
      + '<input type="text" id="config-field" value="' + escapeAttr(config.field || '') + '"'
      + ' class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"'
      + ' placeholder="e.g., document.fileExtension">'
      + '</div>'
      + '<div>'
      + '<label class="block text-sm font-medium text-gray-700 mb-1">Operator</label>'
      + '<select id="config-operator" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">'
      + operatorOptions
      + '</select>'
      + '</div>'
      + '<div>'
      + '<label class="block text-sm font-medium text-gray-700 mb-1">Value</label>'
      + '<input type="text" id="config-value" value="' + escapeAttr(config.value || '') + '"'
      + ' class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"'
      + ' placeholder="Value to compare against">'
      + '<p class="mt-1 text-xs text-gray-500">For "in" / "not_in", use comma-separated values</p>'
      + '</div>'
      + '</div>';
  } else if (nodeDef.actionType) {
    // Generic config fields for action nodes
    var configKeys = Object.keys(nodeDef.config);
    var fields = configKeys.map(function (key) {
      var val = config[key] !== undefined ? config[key] : '';
      var isLong = key === 'prompt' || key === 'body' || key === 'message' || key === 'template' || key === 'data' || key === 'text';
      if (isLong) {
        return '<div>'
          + '<label class="block text-sm font-medium text-gray-700 mb-1">' + formatLabel(key) + '</label>'
          + '<textarea id="config-' + key + '" rows="3"'
          + ' class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"'
          + ' placeholder="Supports {{variable}} syntax">' + escapeHtml(String(val)) + '</textarea>'
          + '</div>';
      }
      return '<div>'
        + '<label class="block text-sm font-medium text-gray-700 mb-1">' + formatLabel(key) + '</label>'
        + '<input type="text" id="config-' + key + '" value="' + escapeAttr(String(val)) + '"'
        + ' class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"'
        + ' placeholder="Supports {{variable}} syntax">'
        + '</div>';
    }).join('');

    formFields = '<div class="space-y-4">' + actionIdField + fields + '</div>';
  } else {
    // Trigger nodes — no additional config
    formFields = '<p class="text-sm text-gray-500">This trigger fires on <strong>' + (nodeDef.eventType || nodeDef.type) + '</strong> events. No additional configuration needed.</p>';
  }

  return '<div class="p-4">'
    + '<div class="flex items-center justify-between mb-4">'
    + '<div class="flex items-center gap-2">'
    + '<div class="' + colors.icon + '">' + icon + '</div>'
    + '<h3 class="font-semibold text-gray-900">' + nodeDef.name + '</h3>'
    + '</div>'
    + '<button onclick="window._skillBuilder.deleteSelectedNode()" class="text-red-500 hover:text-red-700" title="Delete node">'
    + '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
    + '</button>'
    + '</div>'
    + (nodeDef.actionType ? '<p class="text-xs text-gray-400 mb-3">Type: <code>' + nodeDef.actionType + '</code></p>' : '')
    + formFields
    + '<div class="mt-4 pt-4 border-t border-gray-200">'
    + '<button onclick="window._skillBuilder.saveNodeConfig(' + nodeId + ')" class="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">'
    + 'Apply Changes</button>'
    + '</div></div>';
};

SkillBuilder.prototype.saveNodeConfig = function (nodeId) {
  var node = this.editor.getNodeFromId(nodeId);
  if (!node) return;

  var nodeDef = this.findNodeDef(node.class);
  if (!nodeDef) return;

  var config = {};
  var keys = Object.keys(nodeDef.config);
  for (var i = 0; i < keys.length; i++) {
    var el = document.getElementById('config-' + keys[i]);
    if (el) {
      config[keys[i]] = el.type === 'number' ? parseInt(el.value, 10) : el.value;
    }
  }

  this.nodeConfigs[nodeId] = config;

  // Save action_id if present
  var actionIdEl = document.getElementById('config-action-id');
  if (actionIdEl) {
    this._nodeActionIds[nodeId] = actionIdEl.value;
  }

  this.isDirty = true;
};

SkillBuilder.prototype.deleteSelectedNode = function () {
  if (this.selectedNode) {
    this.editor.removeNodeId('node-' + this.selectedNode);
    this.selectedNode = null;
    this.hideNodeConfig();
  }
};

// ═══════════════════════════════════════════════════════════════
// Export to skill_config JSON
// ═══════════════════════════════════════════════════════════════

SkillBuilder.prototype.exportSkillConfig = function () {
  var data = this.editor.export();
  if (!data.drawflow || !data.drawflow.Home || !data.drawflow.Home.data) {
    return null;
  }

  var nodes = data.drawflow.Home.data;
  var nodeEntries = Object.keys(nodes).map(function (id) { return { id: id, node: nodes[id] }; });

  // Find trigger node
  var triggerEntry = null;
  var conditionEntries = [];
  var actionEntries = [];
  var self = this;

  nodeEntries.forEach(function (entry) {
    var nodeClass = entry.node.class;
    if (nodeClass.indexOf('trigger-') === 0) {
      triggerEntry = entry;
    } else if (nodeClass.indexOf('condition-') === 0) {
      conditionEntries.push(entry);
    } else if (nodeClass.indexOf('action-') === 0) {
      actionEntries.push(entry);
    }
  });

  // Build trigger
  var trigger = { event_type: 'document.uploaded', conditions: [] };
  if (triggerEntry) {
    var triggerDef = this.findNodeDef(triggerEntry.node.class);
    if (triggerDef && triggerDef.eventType) {
      trigger.event_type = triggerDef.eventType;
    }
  }

  // Build conditions from condition nodes
  conditionEntries.forEach(function (entry) {
    var cfg = self.nodeConfigs[entry.id] || {};
    if (cfg.field) {
      var val = cfg.value || '';
      // Parse comma-separated values for 'in' and 'not_in' operators
      if ((cfg.operator === 'in' || cfg.operator === 'not_in') && val.indexOf(',') !== -1) {
        val = val.split(',').map(function (s) { return s.trim(); });
      }
      trigger.conditions.push({
        field: cfg.field,
        operator: cfg.operator || 'equals',
        value: val
      });
    }
  });

  // Build actions — resolve dependsOn from connections
  var actions = [];
  actionEntries.forEach(function (entry) {
    var nodeDef = self.findNodeDef(entry.node.class);
    var actionId = self._nodeActionIds[entry.id] || ('action-' + entry.id);
    var cfg = self.nodeConfigs[entry.id] || {};

    // Find upstream nodes connected to this node's inputs
    var dependsOn = [];
    var inputs = entry.node.inputs || {};
    Object.keys(inputs).forEach(function (inputKey) {
      var conns = inputs[inputKey].connections || [];
      conns.forEach(function (conn) {
        var upstreamId = conn.node;
        var upstreamActionId = self._nodeActionIds[upstreamId];
        if (upstreamActionId) {
          dependsOn.push(upstreamActionId);
        }
      });
    });

    actions.push({
      action_id: actionId,
      action_type: nodeDef ? nodeDef.actionType : entry.node.class,
      config: cfg,
      dependsOn: dependsOn.length > 0 ? dependsOn : null
    });
  });

  return {
    skill_key: this.skillName.toLowerCase().split(' ').join('-') + '-v1',
    skill_name: this.skillName,
    skill_type: 'workflow_automation',
    category: 'automation',
    description: this.skillDescription,
    version: this.skillVersion,
    trigger: trigger,
    actions: actions,
    settings: {
      timeout: 60,
      priority: 50,
      retryLimit: 1
    }
  };
};

// ═══════════════════════════════════════════════════════════════
// Import from skill data
// ═══════════════════════════════════════════════════════════════

SkillBuilder.prototype.loadSkill = function (skill) {
  this.editor.clear();
  this.nodeConfigs = {};
  this._nodeActionIds = {};
  this._actionIdCounter = 0;

  this.skillId = skill.skill_id || null;
  this.skillName = skill.skill_name || 'Loaded Skill';
  this.skillDescription = skill.description || skill.skill_description || '';
  this.skillVersion = (skill.metadata && skill.metadata.version) || skill.skill_version || '1.0.0';

  var config = skill.skill_config || skill;
  var trigger = config.trigger || {};
  var actions = config.actions || [];
  var conditions = trigger.conditions || [];

  // Update name input
  var nameInput = document.getElementById('skillName');
  if (nameInput) nameInput.value = this.skillName;

  // Place trigger node
  var triggerEventType = trigger.event_type || 'document.uploaded';
  var triggerNodeType = this._eventTypeToNodeType(triggerEventType);
  var triggerId = this.addNode(triggerNodeType, 80, 200);

  // Place condition nodes
  var condY = 100;
  var lastCondId = triggerId;
  var self = this;

  conditions.forEach(function (cond, idx) {
    var condId = self.addNode('condition-field', 350, condY + idx * 150);
    self.nodeConfigs[condId] = {
      field: cond.field || '',
      operator: cond.operator || 'equals',
      value: Array.isArray(cond.value) ? cond.value.join(', ') : String(cond.value || '')
    };
    // Connect from trigger or previous condition
    if (lastCondId) {
      self.editor.addConnection(lastCondId, condId, 'output_1', 'input_1');
    }
    lastCondId = condId;
  });

  // Place action nodes
  var actionNodeIds = {}; // action_id -> drawflow nodeId
  var prevNodeId = lastCondId;

  actions.forEach(function (action, idx) {
    var actionNodeType = self._actionTypeToNodeType(action.action_type);
    var nodeId = self.addNode(actionNodeType, 620, 100 + idx * 150);
    self._nodeActionIds[nodeId] = action.action_id;

    // Copy config
    var cfgCopy = {};
    if (action.config) {
      var cfgKeys = Object.keys(action.config);
      for (var k = 0; k < cfgKeys.length; k++) {
        cfgCopy[cfgKeys[k]] = action.config[cfgKeys[k]];
      }
    }
    self.nodeConfigs[nodeId] = cfgCopy;

    actionNodeIds[action.action_id] = nodeId;
  });

  // Wire action connections based on dependsOn
  actions.forEach(function (action) {
    var targetNodeId = actionNodeIds[action.action_id];
    if (!targetNodeId) return;

    if (action.dependsOn && action.dependsOn.length > 0) {
      action.dependsOn.forEach(function (depId) {
        var sourceNodeId = actionNodeIds[depId];
        if (sourceNodeId) {
          self.editor.addConnection(sourceNodeId, targetNodeId, 'output_1', 'input_1');
        }
      });
    } else {
      // Connect first action to last condition/trigger
      if (prevNodeId) {
        self.editor.addConnection(prevNodeId, targetNodeId, 'output_1', 'input_1');
        prevNodeId = null; // only connect first orphan
      }
    }
  });

  this.isDirty = false;

  // Hide drop hint
  var dropHint = document.getElementById('dropHint');
  if (dropHint) dropHint.classList.add('hidden');
};

SkillBuilder.prototype._eventTypeToNodeType = function (eventType) {
  var map = {
    'document.uploaded': 'trigger-document-uploaded',
    'document.updated': 'trigger-document-updated',
    'matter.created': 'trigger-matter-created',
    'matter.updated': 'trigger-matter-updated',
    'contact.created': 'trigger-contact-created',
    'contact.linked_to_matter': 'trigger-contact-linked'
  };
  return map[eventType] || 'trigger-document-uploaded';
};

SkillBuilder.prototype._actionTypeToNodeType = function (actionType) {
  var allActions = SkillNodeTypes.actions;
  for (var i = 0; i < allActions.length; i++) {
    if (allActions[i].actionType === actionType) return allActions[i].type;
  }
  // Fallback: return the first action node
  return 'action-ai-analyze';
};

// ═══════════════════════════════════════════════════════════════
// Validate
// ═══════════════════════════════════════════════════════════════

SkillBuilder.prototype.validate = function () {
  var data = this.editor.export();
  var errors = [];

  if (!data.drawflow || !data.drawflow.Home || !data.drawflow.Home.data) {
    errors.push('Skill canvas is empty');
    return { valid: false, errors: errors };
  }

  var nodeValues = [];
  var nodeData = data.drawflow.Home.data;
  var nodeKeys = Object.keys(nodeData);
  for (var i = 0; i < nodeKeys.length; i++) {
    nodeValues.push(nodeData[nodeKeys[i]]);
  }

  var hasTrigger = false;
  var hasAction = false;
  for (var j = 0; j < nodeValues.length; j++) {
    if (nodeValues[j].class.indexOf('trigger-') === 0) hasTrigger = true;
    if (nodeValues[j].class.indexOf('action-') === 0) hasAction = true;
  }

  if (!hasTrigger) errors.push('Skill must have at least one trigger node');
  if (!hasAction) errors.push('Skill must have at least one action node');

  return { valid: errors.length === 0, errors: errors };
};

// Zoom controls
SkillBuilder.prototype.zoomIn = function () { this.editor.zoom_in(); };
SkillBuilder.prototype.zoomOut = function () { this.editor.zoom_out(); };
SkillBuilder.prototype.zoomReset = function () { this.editor.zoom_reset(); };
SkillBuilder.prototype.clear = function () {
  this.editor.clear();
  this.nodeConfigs = {};
  this._nodeActionIds = {};
  this.selectedNode = null;
  this.hideNodeConfig();
  this.isDirty = true;
};

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text).split('&').join('&amp;').split('"').join('&quot;').split('<').join('&lt;').split('>').join('&gt;');
}

function formatLabel(key) {
  return key.split('_').map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

// Export
window.SkillBuilder = SkillBuilder;
window.SkillNodeTypes = SkillNodeTypes;
window.SkillNodeIcons = SkillNodeIcons;
window.SkillNodeColors = SkillNodeColors;

/**
 * Workflows Module - Automation Engine Management
 * Handles workflow creation, templates, execution, and monitoring
 */

// Mock data for workflows
const WorkflowsMockData = {
  workflows: [
    {
      id: 'wf-001',
      name: 'Follow-up Cadence - Green Zone',
      description: 'Automated follow-up sequence for opportunities 0-7 days old',
      status: 'active',
      trigger: { type: 'schedule', config: { cron: '0 9 * * *' } },
      lastRun: new Date(Date.now() - 3600000).toISOString(),
      nextRun: new Date(Date.now() + 82800000).toISOString(),
      successRate: 98.5,
      executionCount: 156,
      createdAt: '2024-09-15T10:00:00Z'
    },
    {
      id: 'wf-002',
      name: 'No-Show Rescheduling',
      description: 'Automatically reschedule and notify when appointment is marked as no-show',
      status: 'active',
      trigger: { type: 'event', config: { event: 'appointment.no_show' } },
      lastRun: new Date(Date.now() - 7200000).toISOString(),
      nextRun: null,
      successRate: 95.2,
      executionCount: 43,
      createdAt: '2024-10-01T14:00:00Z'
    },
    {
      id: 'wf-003',
      name: 'New Client Folder Creation',
      description: 'Create folder structure when new client is signed',
      status: 'active',
      trigger: { type: 'event', config: { event: 'client.signed' } },
      lastRun: new Date(Date.now() - 86400000).toISOString(),
      nextRun: null,
      successRate: 100,
      executionCount: 28,
      createdAt: '2024-08-20T09:00:00Z'
    },
    {
      id: 'wf-004',
      name: 'AR Reminder Sequence',
      description: 'Automated payment reminders for aging invoices',
      status: 'paused',
      trigger: { type: 'schedule', config: { cron: '0 8 * * 1' } },
      lastRun: new Date(Date.now() - 604800000).toISOString(),
      nextRun: null,
      successRate: 92.1,
      executionCount: 89,
      createdAt: '2024-07-10T11:00:00Z'
    },
    {
      id: 'wf-005',
      name: 'Welcome Email Sequence',
      description: 'Send welcome emails to new leads',
      status: 'active',
      trigger: { type: 'event', config: { event: 'lead.created' } },
      lastRun: new Date(Date.now() - 1800000).toISOString(),
      nextRun: null,
      successRate: 99.1,
      executionCount: 234,
      createdAt: '2024-06-05T10:00:00Z'
    },
    {
      id: 'wf-006',
      name: 'Red Zone Alert',
      description: 'Escalate opportunities that have been idle for 15+ days',
      status: 'error',
      trigger: { type: 'schedule', config: { cron: '0 10 * * *' } },
      lastRun: new Date(Date.now() - 172800000).toISOString(),
      nextRun: null,
      successRate: 78.5,
      executionCount: 67,
      errorMessage: 'Email service connection failed',
      createdAt: '2024-09-20T15:00:00Z'
    }
  ],

  templates: [
    {
      id: 'tmpl-001',
      name: 'Follow-up Cadence',
      description: 'Automated follow-up sequence based on opportunity age (green/yellow/red zones)',
      category: 'Lead Management',
      popularity: 95,
      nodes: 8,
      icon: 'clock'
    },
    {
      id: 'tmpl-002',
      name: 'Consultation to Engagement',
      description: 'Track and automate the path from consultation to signed engagement letter',
      category: 'Client Intake',
      popularity: 88,
      nodes: 12,
      icon: 'document'
    },
    {
      id: 'tmpl-003',
      name: 'No-Show Recovery',
      description: 'Automatically handle appointment no-shows with rescheduling and reminders',
      category: 'Appointments',
      popularity: 82,
      nodes: 6,
      icon: 'calendar'
    },
    {
      id: 'tmpl-004',
      name: 'AR Reminder Sequence',
      description: 'Automated payment reminders at 30, 60, and 90 days past due',
      category: 'Billing',
      popularity: 75,
      nodes: 5,
      icon: 'currency'
    },
    {
      id: 'tmpl-005',
      name: 'New Client Onboarding',
      description: 'Welcome sequence, folder creation, and initial setup for new clients',
      category: 'Client Intake',
      popularity: 91,
      nodes: 10,
      icon: 'user-plus'
    },
    {
      id: 'tmpl-006',
      name: 'Review Request',
      description: 'Request Google/Yelp reviews from satisfied clients',
      category: 'Marketing',
      popularity: 68,
      nodes: 4,
      icon: 'star'
    },
    {
      id: 'tmpl-007',
      name: 'Retargeting Sync',
      description: 'Sync cold leads to Facebook/Google retargeting audiences',
      category: 'Marketing',
      popularity: 72,
      nodes: 5,
      icon: 'refresh'
    },
    {
      id: 'tmpl-008',
      name: 'Document Generation',
      description: 'Auto-generate engagement letters and contracts from templates',
      category: 'Documents',
      popularity: 85,
      nodes: 7,
      icon: 'document-text'
    }
  ],

  executionLogs: [
    { id: 'exec-001', workflowId: 'wf-001', workflowName: 'Follow-up Cadence - Green Zone', status: 'success', startedAt: new Date(Date.now() - 3600000).toISOString(), completedAt: new Date(Date.now() - 3595000).toISOString(), duration: 5000, recordsProcessed: 12, trigger: 'scheduled' },
    { id: 'exec-002', workflowId: 'wf-005', workflowName: 'Welcome Email Sequence', status: 'success', startedAt: new Date(Date.now() - 1800000).toISOString(), completedAt: new Date(Date.now() - 1798000).toISOString(), duration: 2000, recordsProcessed: 1, trigger: 'event' },
    { id: 'exec-003', workflowId: 'wf-002', workflowName: 'No-Show Rescheduling', status: 'success', startedAt: new Date(Date.now() - 7200000).toISOString(), completedAt: new Date(Date.now() - 7195000).toISOString(), duration: 5000, recordsProcessed: 2, trigger: 'event' },
    { id: 'exec-004', workflowId: 'wf-006', workflowName: 'Red Zone Alert', status: 'error', startedAt: new Date(Date.now() - 172800000).toISOString(), completedAt: new Date(Date.now() - 172795000).toISOString(), duration: 5000, recordsProcessed: 0, trigger: 'scheduled', error: 'Email service connection failed' },
    { id: 'exec-005', workflowId: 'wf-003', workflowName: 'New Client Folder Creation', status: 'success', startedAt: new Date(Date.now() - 86400000).toISOString(), completedAt: new Date(Date.now() - 86397000).toISOString(), duration: 3000, recordsProcessed: 1, trigger: 'event' },
    { id: 'exec-006', workflowId: 'wf-001', workflowName: 'Follow-up Cadence - Green Zone', status: 'success', startedAt: new Date(Date.now() - 90000000).toISOString(), completedAt: new Date(Date.now() - 89995000).toISOString(), duration: 5000, recordsProcessed: 15, trigger: 'scheduled' },
    { id: 'exec-007', workflowId: 'wf-005', workflowName: 'Welcome Email Sequence', status: 'success', startedAt: new Date(Date.now() - 108000000).toISOString(), completedAt: new Date(Date.now() - 107998000).toISOString(), duration: 2000, recordsProcessed: 3, trigger: 'event' }
  ],

  cadenceConfig: {
    greenZone: {
      dayRange: [0, 7],
      actions: [
        { type: 'internal_notification', enabled: true, config: { notify: 'assigned_rep' } },
        { type: 'email', enabled: false, config: { template: 'initial_followup' } }
      ]
    },
    yellowZone: {
      dayRange: [8, 14],
      actions: [
        { type: 'internal_notification', enabled: true, config: { notify: 'assigned_rep', urgency: 'high' } },
        { type: 'email', enabled: true, config: { template: 'second_followup' } },
        { type: 'sms', enabled: false, config: { template: 'reminder_sms' } }
      ]
    },
    redZone: {
      dayRange: [15, null],
      actions: [
        { type: 'escalate', enabled: true, config: { escalateTo: 'manager' } },
        { type: 'email', enabled: true, config: { template: 'urgent_followup' } },
        { type: 'retargeting', enabled: true, config: { audience: 'stale_leads' } }
      ]
    }
  },

  retargetingConfig: {
    audiences: [
      { id: 'aud-001', name: 'No-Shows', platform: 'facebook', syncEnabled: true, size: 234, lastSync: new Date(Date.now() - 3600000).toISOString() },
      { id: 'aud-002', name: 'Stale Leads (15+ days)', platform: 'facebook', syncEnabled: true, size: 567, lastSync: new Date(Date.now() - 7200000).toISOString() },
      { id: 'aud-003', name: 'Lost Opportunities', platform: 'google', syncEnabled: false, size: 189, lastSync: null },
      { id: 'aud-004', name: 'Past Clients', platform: 'facebook', syncEnabled: true, size: 892, lastSync: new Date(Date.now() - 86400000).toISOString() }
    ],
    platforms: {
      facebook: { connected: true, accountId: 'act_123456789' },
      google: { connected: false, accountId: null }
    }
  },

  // Workflow graph data (for visual builder)
  workflowGraphs: {},

  // Document templates
  documentTemplates: [
    {
      id: 'doc-001',
      name: 'Engagement Letter',
      description: 'Standard client engagement letter for new matters',
      category: 'Client Intake',
      content: '<p>{{date.today}}</p><p><br></p><p>{{client.name}}<br>{{client.address}}</p><p><br></p><p>RE: {{matter.name}}</p><p><br></p><p>Dear {{client.name}},</p><p><br></p><p>Thank you for choosing {{firm.name}} to represent you in the above-referenced matter.</p>',
      mergeFields: ['client.name', 'client.address', 'matter.name', 'firm.name', 'date.today'],
      lastModified: '2024-11-15T10:00:00Z',
      autoGenerate: { enabled: true, trigger: 'verbal_yes' }
    },
    {
      id: 'doc-002',
      name: 'Fee Agreement',
      description: 'Detailed fee agreement with payment terms',
      category: 'Billing',
      content: '<p><strong>FEE AGREEMENT</strong></p><p><br></p><p>This Fee Agreement is entered into between {{firm.name}} and {{client.name}}.</p>',
      mergeFields: ['client.name', 'firm.name', 'fee.amount', 'fee.retainer', 'date.today'],
      lastModified: '2024-11-10T14:30:00Z',
      autoGenerate: { enabled: false }
    },
    {
      id: 'doc-003',
      name: 'Welcome Packet',
      description: 'Welcome information for new clients',
      category: 'Client Intake',
      content: '<p><strong>Welcome to {{firm.name}}</strong></p><p><br></p><p>Dear {{client.name}},</p><p><br></p><p>Welcome! Your matter number is {{matter.number}}.</p>',
      mergeFields: ['client.name', 'firm.name', 'matter.number', 'attorney.name'],
      lastModified: '2024-11-05T09:15:00Z',
      autoGenerate: { enabled: true, trigger: 'engagement_signed' }
    }
  ],

  // Document automation rules
  documentAutomationRules: [
    {
      id: 'rule-001',
      templateId: 'doc-001',
      trigger: 'verbal_yes',
      triggerLabel: 'Client gives verbal yes',
      outputPath: '/matters/{{matter.number}}/documents/',
      namingPattern: '{{client.name}}_Engagement_{{date.today}}',
      autoSend: true,
      enabled: true
    },
    {
      id: 'rule-002',
      templateId: 'doc-003',
      trigger: 'engagement_signed',
      triggerLabel: 'Engagement letter signed',
      outputPath: '/matters/{{matter.number}}/documents/',
      namingPattern: '{{client.name}}_Welcome_{{date.today}}',
      autoSend: true,
      enabled: true
    }
  ]
};

// Empty state data (shown when no real data is available)
const WorkflowsEmptyState = {
  workflows: { workflows: [] },
  executionLogs: { logs: [] },
  templates: { templates: [] },
  stats: { activeCount: 0, pausedCount: 0, errorCount: 0, executionsToday: 0, totalExecutions: 0, avgSuccessRate: 0 },
  cadenceConfig: { greenZone: { dayRange: [0, 7], actions: [] }, yellowZone: { dayRange: [8, 14], actions: [] }, redZone: { dayRange: [15, null], actions: [] } },
  retargetingConfig: { audiences: [], platforms: { facebook: { connected: false }, google: { connected: false } } },
  documentTemplates: { templates: [] },
  documentAutomationRules: { rules: [] }
};

// Workflows API
const Workflows = {
  /**
   * Get all workflows
   */
  async getAll() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   return { workflows: WorkflowsMockData.workflows };
    // }
    // return api.get('/api/v1/workflows');

    // Empty state - no data available yet
    return WorkflowsEmptyState.workflows;
  },

  /**
   * Get a specific workflow
   */
  async get(workflowId) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      const workflow = WorkflowsMockData.workflows.find(w => w.id === workflowId);
      return { workflow };
    }
    return api.get(`/api/v1/workflows/${workflowId}`);
  },

  /**
   * Create a new workflow
   */
  async create(config) {
    let result;
    if (api.isDemoMode()) {
      await MockData.delay(500);
      const newWorkflow = {
        id: `wf-${Date.now()}`,
        ...config,
        status: 'active',
        lastRun: null,
        nextRun: null,
        successRate: 100,
        executionCount: 0,
        createdAt: new Date().toISOString()
      };
      WorkflowsMockData.workflows.push(newWorkflow);
      result = { success: true, workflow: newWorkflow };
    } else {
      result = await api.post('/api/v1/workflows', config);
    }

    // Track workflow creation
    if (result.success && window.FeatureTracker) {
      try {
        await window.FeatureTracker.trackFeature(window.Features.WORKFLOW_CREATED, {
          workflow_type: config.trigger?.type || 'unknown'
        });
      } catch (trackError) {
        console.error('[FeatureTracker] Failed to track workflow creation:', trackError);
      }
    }

    return result;
  },

  /**
   * Update a workflow
   */
  async update(workflowId, config) {
    if (api.isDemoMode()) {
      await MockData.delay(400);
      const idx = WorkflowsMockData.workflows.findIndex(w => w.id === workflowId);
      if (idx !== -1) {
        WorkflowsMockData.workflows[idx] = { ...WorkflowsMockData.workflows[idx], ...config };
      }
      return { success: true };
    }
    return api.put(`/api/v1/workflows/${workflowId}`, config);
  },

  /**
   * Delete a workflow
   */
  async delete(workflowId) {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      const idx = WorkflowsMockData.workflows.findIndex(w => w.id === workflowId);
      if (idx !== -1) {
        WorkflowsMockData.workflows.splice(idx, 1);
      }
      return { success: true };
    }
    return api.delete(`/api/v1/workflows/${workflowId}`);
  },

  /**
   * Toggle workflow status
   */
  async toggle(workflowId, enabled) {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      const workflow = WorkflowsMockData.workflows.find(w => w.id === workflowId);
      if (workflow) {
        workflow.status = enabled ? 'active' : 'paused';
      }
      return { success: true };
    }
    return api.post(`/api/v1/workflows/${workflowId}/toggle`, { enabled });
  },

  /**
   * Execute workflow manually
   */
  async execute(workflowId) {
    let result;
    if (api.isDemoMode()) {
      await MockData.delay(2000);
      const workflow = WorkflowsMockData.workflows.find(w => w.id === workflowId);
      if (workflow) {
        workflow.lastRun = new Date().toISOString();
        workflow.executionCount++;
      }
      result = { success: true, recordsProcessed: Math.floor(Math.random() * 10) + 1 };
    } else {
      result = await api.post(`/api/v1/workflows/${workflowId}/execute`);
    }

    // Track workflow execution
    if (result.success && window.FeatureTracker) {
      try {
        await window.FeatureTracker.trackFeature(window.Features.WORKFLOW_EXECUTED, {
          workflow_id: workflowId
        });
      } catch (trackError) {
        console.error('[FeatureTracker] Failed to track workflow execution:', trackError);
      }
    }

    return result;
  },

  /**
   * Get execution logs
   */
  async getExecutionLogs(workflowId = null, limit = 50) {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   let logs = [...WorkflowsMockData.executionLogs];
    //   if (workflowId) {
    //     logs = logs.filter(l => l.workflowId === workflowId);
    //   }
    //   return { logs: logs.slice(0, limit) };
    // }
    // const params = new URLSearchParams({ limit });
    // if (workflowId) params.set('workflow_id', workflowId);
    // return api.get(`/api/v1/workflows/execution-logs?${params}`);

    // Empty state - no data available yet
    return WorkflowsEmptyState.executionLogs;
  },

  /**
   * Get workflow templates
   */
  async getTemplates() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   return { templates: WorkflowsMockData.templates };
    // }
    // return api.get('/api/v1/workflows/templates');

    // Empty state - no data available yet
    return WorkflowsEmptyState.templates;
  },

  /**
   * Install template
   */
  async installTemplate(templateId) {
    if (api.isDemoMode()) {
      await MockData.delay(1000);
      const template = WorkflowsMockData.templates.find(t => t.id === templateId);
      if (template) {
        const newWorkflow = {
          id: `wf-${Date.now()}`,
          name: template.name,
          description: template.description,
          status: 'active',
          trigger: { type: 'event', config: {} },
          lastRun: null,
          nextRun: null,
          successRate: 100,
          executionCount: 0,
          createdAt: new Date().toISOString()
        };
        WorkflowsMockData.workflows.push(newWorkflow);
        return { success: true, workflow: newWorkflow };
      }
      return { success: false, error: 'Template not found' };
    }
    return api.post(`/api/v1/workflows/templates/${templateId}/install`);
  },

  /**
   * Get cadence configuration
   */
  async getCadenceConfig() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(200);
    //   return WorkflowsMockData.cadenceConfig;
    // }
    // return api.get('/api/v1/workflows/cadence-config');

    // Empty state - no data available yet
    return WorkflowsEmptyState.cadenceConfig;
  },

  /**
   * Update cadence configuration
   */
  async updateCadenceConfig(config) {
    if (api.isDemoMode()) {
      await MockData.delay(400);
      Object.assign(WorkflowsMockData.cadenceConfig, config);
      return { success: true };
    }
    return api.put('/api/v1/workflows/cadence-config', config);
  },

  /**
   * Get retargeting configuration
   */
  async getRetargetingConfig() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(200);
    //   return WorkflowsMockData.retargetingConfig;
    // }
    // return api.get('/api/v1/workflows/retargeting-config');

    // Empty state - no data available yet
    return WorkflowsEmptyState.retargetingConfig;
  },

  /**
   * Update retargeting audience
   */
  async updateRetargetingAudience(audienceId, config) {
    if (api.isDemoMode()) {
      await MockData.delay(400);
      const audience = WorkflowsMockData.retargetingConfig.audiences.find(a => a.id === audienceId);
      if (audience) {
        Object.assign(audience, config);
      }
      return { success: true };
    }
    return api.put(`/api/v1/workflows/retargeting/${audienceId}`, config);
  },

  /**
   * Sync retargeting audience
   */
  async syncRetargetingAudience(audienceId) {
    if (api.isDemoMode()) {
      await MockData.delay(2000);
      const audience = WorkflowsMockData.retargetingConfig.audiences.find(a => a.id === audienceId);
      if (audience) {
        audience.lastSync = new Date().toISOString();
        audience.size += Math.floor(Math.random() * 20);
      }
      return { success: true };
    }
    return api.post(`/api/v1/workflows/retargeting/${audienceId}/sync`);
  },

  /**
   * Get workflow stats
   */
  async getStats() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(200);
    //   const workflows = WorkflowsMockData.workflows;
    //   const today = new Date().toDateString();
    //   const executionsToday = WorkflowsMockData.executionLogs.filter(l => {
    //     return new Date(l.startedAt).toDateString() === today;
    //   }).length;
    //
    //   return {
    //     activeCount: workflows.filter(w => w.status === 'active').length,
    //     pausedCount: workflows.filter(w => w.status === 'paused').length,
    //     errorCount: workflows.filter(w => w.status === 'error').length,
    //     executionsToday,
    //     totalExecutions: workflows.reduce((sum, w) => sum + w.executionCount, 0),
    //     avgSuccessRate: workflows.reduce((sum, w) => sum + w.successRate, 0) / workflows.length
    //   };
    // }
    // return api.get('/api/v1/workflows/stats');

    // Empty state - no data available yet
    return WorkflowsEmptyState.stats;
  },

  // ==========================================
  // Visual Builder Functions
  // ==========================================

  /**
   * Save workflow graph data
   */
  async saveWorkflowGraph(workflowId, graphData) {
    if (api.isDemoMode()) {
      await MockData.delay(400);
      WorkflowsMockData.workflowGraphs[workflowId] = graphData;
      return { success: true };
    }
    return api.put(`/api/v1/workflows/${workflowId}/graph`, { graphData });
  },

  /**
   * Get workflow graph data
   */
  async getWorkflowGraph(workflowId) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      return { graphData: WorkflowsMockData.workflowGraphs[workflowId] || null };
    }
    return api.get(`/api/v1/workflows/${workflowId}/graph`);
  },

  // ==========================================
  // Document Generation Functions
  // ==========================================

  /**
   * Get all document templates
   */
  async getDocumentTemplates() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(300);
    //   return { templates: WorkflowsMockData.documentTemplates };
    // }
    // return api.get('/api/v1/documents/templates');

    // Empty state - no data available yet
    return WorkflowsEmptyState.documentTemplates;
  },

  /**
   * Get a single document template
   */
  async getDocumentTemplate(templateId) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      const template = WorkflowsMockData.documentTemplates.find(t => t.id === templateId);
      return { template };
    }
    return api.get(`/api/v1/documents/templates/${templateId}`);
  },

  /**
   * Create a document template
   */
  async createDocumentTemplate(templateData) {
    if (api.isDemoMode()) {
      await MockData.delay(500);
      const newTemplate = {
        id: `doc-${Date.now()}`,
        ...templateData,
        lastModified: new Date().toISOString()
      };
      WorkflowsMockData.documentTemplates.push(newTemplate);
      return { success: true, template: newTemplate };
    }
    return api.post('/api/v1/documents/templates', templateData);
  },

  /**
   * Update a document template
   */
  async updateDocumentTemplate(templateId, templateData) {
    if (api.isDemoMode()) {
      await MockData.delay(400);
      const idx = WorkflowsMockData.documentTemplates.findIndex(t => t.id === templateId);
      if (idx !== -1) {
        WorkflowsMockData.documentTemplates[idx] = {
          ...WorkflowsMockData.documentTemplates[idx],
          ...templateData,
          lastModified: new Date().toISOString()
        };
      }
      return { success: true };
    }
    return api.put(`/api/v1/documents/templates/${templateId}`, templateData);
  },

  /**
   * Delete a document template
   */
  async deleteDocumentTemplate(templateId) {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      const idx = WorkflowsMockData.documentTemplates.findIndex(t => t.id === templateId);
      if (idx !== -1) {
        WorkflowsMockData.documentTemplates.splice(idx, 1);
      }
      // Also remove any automation rules using this template
      WorkflowsMockData.documentAutomationRules = WorkflowsMockData.documentAutomationRules.filter(
        r => r.templateId !== templateId
      );
      return { success: true };
    }
    return api.delete(`/api/v1/documents/templates/${templateId}`);
  },

  /**
   * Preview document template with sample data
   */
  async previewDocumentTemplate(templateId, sampleData) {
    if (api.isDemoMode()) {
      await MockData.delay(500);
      const template = WorkflowsMockData.documentTemplates.find(t => t.id === templateId);
      if (!template) {
        return { success: false, error: 'Template not found' };
      }

      // Replace merge fields with sample data
      let preview = template.content;
      Object.entries(sampleData).forEach(([key, value]) => {
        const regex = new RegExp(`\\{\\{${key.replace('.', '\\.')}\\}\\}`, 'g');
        preview = preview.replace(regex, value);
      });

      return { success: true, preview };
    }
    return api.post(`/api/v1/documents/templates/${templateId}/preview`, { sampleData });
  },

  /**
   * Get document automation rules
   */
  async getDocumentAutomationRules() {
    // DEMO MODE - Uncomment to show mock data
    // if (api.isDemoMode()) {
    //   await MockData.delay(200);
    //   return { rules: WorkflowsMockData.documentAutomationRules };
    // }
    // return api.get('/api/v1/documents/automation-rules');

    // Empty state - no data available yet
    return WorkflowsEmptyState.documentAutomationRules;
  },

  /**
   * Create document automation rule
   */
  async createDocumentAutomationRule(ruleData) {
    if (api.isDemoMode()) {
      await MockData.delay(400);
      const newRule = {
        id: `rule-${Date.now()}`,
        ...ruleData,
        enabled: true
      };
      WorkflowsMockData.documentAutomationRules.push(newRule);
      return { success: true, rule: newRule };
    }
    return api.post('/api/v1/documents/automation-rules', ruleData);
  },

  /**
   * Update document automation rule
   */
  async updateDocumentAutomationRule(ruleId, ruleData) {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      const idx = WorkflowsMockData.documentAutomationRules.findIndex(r => r.id === ruleId);
      if (idx !== -1) {
        WorkflowsMockData.documentAutomationRules[idx] = {
          ...WorkflowsMockData.documentAutomationRules[idx],
          ...ruleData
        };
      }
      return { success: true };
    }
    return api.put(`/api/v1/documents/automation-rules/${ruleId}`, ruleData);
  },

  /**
   * Delete document automation rule
   */
  async deleteDocumentAutomationRule(ruleId) {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      const idx = WorkflowsMockData.documentAutomationRules.findIndex(r => r.id === ruleId);
      if (idx !== -1) {
        WorkflowsMockData.documentAutomationRules.splice(idx, 1);
      }
      return { success: true };
    }
    return api.delete(`/api/v1/documents/automation-rules/${ruleId}`);
  },

  /**
   * Toggle document automation rule
   */
  async toggleDocumentAutomationRule(ruleId, enabled) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      const rule = WorkflowsMockData.documentAutomationRules.find(r => r.id === ruleId);
      if (rule) {
        rule.enabled = enabled;
      }
      return { success: true };
    }
    return api.post(`/api/v1/documents/automation-rules/${ruleId}/toggle`, { enabled });
  }
};

// Export for use in other modules
window.Workflows = Workflows;
window.WorkflowsMockData = WorkflowsMockData;

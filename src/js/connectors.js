/**
 * Connectors Module - Data Integration Management
 * Handles CRM, Case Management, Financial, Communications, and Document connectors
 */

// Mock data for connectors
const ConnectorsMockData = {
  connectors: [
    // CRM Connectors
    {
      id: 'crm-leadly',
      name: 'Leadly',
      category: 'crm',
      description: 'Lead management and tracking platform',
      status: 'connected',
      records: 2847,
      lastSync: new Date(Date.now() - 1800000).toISOString(),
      config: { api_key: '***hidden***', sync_frequency: 'hourly' }
    },
    {
      id: 'crm-hubspot',
      name: 'HubSpot',
      category: 'crm',
      description: 'Inbound marketing and CRM platform',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'crm-salesforce',
      name: 'Salesforce',
      category: 'crm',
      description: 'Enterprise CRM solution',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'crm-zoho',
      name: 'Zoho CRM',
      category: 'crm',
      description: 'Small business CRM',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'crm-gohighlevel',
      name: 'GoHighLevel',
      category: 'crm',
      description: 'All-in-one marketing and CRM platform',
      status: 'connected',
      records: 1654,
      lastSync: new Date(Date.now() - 2400000).toISOString(),
      config: { api_key: '***hidden***', sync_frequency: 'hourly' }
    },
    {
      id: 'doc-googlesheets',
      name: 'Google Sheets',
      category: 'documents',
      description: 'Spreadsheet data and collaboration',
      status: 'connected',
      records: 847,
      lastSync: new Date(Date.now() - 1500000).toISOString(),
      config: { oauth_connected: true, spreadsheets: ['Lead Tracker', 'Client Database'] }
    },

    // Case Management Connectors
    {
      id: 'case-actionstep',
      name: 'ActionStep',
      category: 'case',
      description: 'Legal practice management software',
      status: 'connected',
      records: 1523,
      lastSync: new Date(Date.now() - 3600000).toISOString(),
      config: { api_key: '***hidden***', sync_frequency: 'realtime' }
    },
    {
      id: 'case-clio',
      name: 'Clio',
      category: 'case',
      description: 'Cloud-based legal practice management',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'case-filevine',
      name: 'Filevine',
      category: 'case',
      description: 'Legal case management platform',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'case-mycase',
      name: 'MyCase',
      category: 'case',
      description: 'Law practice management software',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },

    // Financial Connectors
    {
      id: 'fin-quickbooks',
      name: 'QuickBooks',
      category: 'financial',
      description: 'Accounting and invoicing software',
      status: 'connected',
      records: 4521,
      lastSync: new Date(Date.now() - 7200000).toISOString(),
      config: { oauth_connected: true, sync_frequency: 'daily' }
    },
    {
      id: 'fin-spreadsheet',
      name: 'Spreadsheet Import',
      category: 'financial',
      description: 'Import CSV/Excel financial data',
      status: 'connected',
      records: 892,
      lastSync: new Date(Date.now() - 86400000).toISOString(),
      config: { last_file: 'AR_Report_Nov2024.xlsx' }
    },
    {
      id: 'fin-stripe',
      name: 'Stripe',
      category: 'financial',
      description: 'Online payment processing',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'fin-xero',
      name: 'Xero',
      category: 'financial',
      description: 'Cloud accounting platform',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },

    // Communications Connectors
    {
      id: 'comm-gcal',
      name: 'Google Calendar',
      category: 'communications',
      description: 'Calendar and scheduling',
      status: 'connected',
      records: 1847,
      lastSync: new Date(Date.now() - 900000).toISOString(),
      config: { oauth_connected: true, calendars: ['primary', 'consultations'] }
    },
    {
      id: 'comm-outlook',
      name: 'Outlook Calendar',
      category: 'communications',
      description: 'Microsoft calendar integration',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'comm-twilio',
      name: 'Twilio SMS',
      category: 'communications',
      description: 'SMS and voice communications',
      status: 'connected',
      records: 5234,
      lastSync: new Date(Date.now() - 600000).toISOString(),
      config: { account_sid: '***hidden***', sync_frequency: 'realtime' }
    },
    {
      id: 'comm-callrail',
      name: 'CallRail',
      category: 'communications',
      description: 'Call tracking and analytics',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },

    // Document Connectors
    {
      id: 'doc-gdrive',
      name: 'Google Drive',
      category: 'documents',
      description: 'Cloud document storage',
      status: 'connected',
      records: 3456,
      lastSync: new Date(Date.now() - 1200000).toISOString(),
      config: { oauth_connected: true, folders: ['Legal Documents', 'Client Files'] }
    },
    {
      id: 'doc-dropbox',
      name: 'Dropbox',
      category: 'documents',
      description: 'File hosting and sync',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'doc-onedrive',
      name: 'OneDrive',
      category: 'documents',
      description: 'Microsoft cloud storage',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    },
    {
      id: 'doc-sharepoint',
      name: 'SharePoint',
      category: 'documents',
      description: 'Enterprise document management',
      status: 'disconnected',
      records: 0,
      lastSync: null,
      config: {}
    }
  ],

  syncHistory: [
    { id: 'sync-001', connector_id: 'crm-leadly', connector_name: 'Leadly', status: 'success', records_synced: 47, started_at: new Date(Date.now() - 1800000).toISOString(), completed_at: new Date(Date.now() - 1795000).toISOString(), duration_ms: 5000 },
    { id: 'sync-002', connector_id: 'case-actionstep', connector_name: 'ActionStep', status: 'success', records_synced: 23, started_at: new Date(Date.now() - 3600000).toISOString(), completed_at: new Date(Date.now() - 3595000).toISOString(), duration_ms: 5000 },
    { id: 'sync-003', connector_id: 'fin-quickbooks', connector_name: 'QuickBooks', status: 'success', records_synced: 156, started_at: new Date(Date.now() - 7200000).toISOString(), completed_at: new Date(Date.now() - 7185000).toISOString(), duration_ms: 15000 },
    { id: 'sync-004', connector_id: 'comm-gcal', connector_name: 'Google Calendar', status: 'success', records_synced: 12, started_at: new Date(Date.now() - 900000).toISOString(), completed_at: new Date(Date.now() - 898000).toISOString(), duration_ms: 2000 },
    { id: 'sync-005', connector_id: 'comm-twilio', connector_name: 'Twilio SMS', status: 'success', records_synced: 89, started_at: new Date(Date.now() - 600000).toISOString(), completed_at: new Date(Date.now() - 597000).toISOString(), duration_ms: 3000 },
    { id: 'sync-006', connector_id: 'doc-gdrive', connector_name: 'Google Drive', status: 'success', records_synced: 34, started_at: new Date(Date.now() - 1200000).toISOString(), completed_at: new Date(Date.now() - 1192000).toISOString(), duration_ms: 8000 },
    { id: 'sync-007', connector_id: 'crm-leadly', connector_name: 'Leadly', status: 'error', records_synced: 0, error_message: 'API rate limit exceeded', started_at: new Date(Date.now() - 86400000).toISOString(), completed_at: new Date(Date.now() - 86399000).toISOString(), duration_ms: 1000 }
  ],

  fieldMappings: {
    'crm-leadly': [
      { source: 'lead_name', target: 'client_name', enabled: true },
      { source: 'email', target: 'email', enabled: true },
      { source: 'phone', target: 'phone', enabled: true },
      { source: 'source', target: 'marketing_channel', enabled: true },
      { source: 'created_date', target: 'lead_date', enabled: true },
      { source: 'status', target: 'lead_status', enabled: true },
      { source: 'assigned_to', target: 'assigned_rep', enabled: true },
      { source: 'notes', target: 'notes', enabled: false }
    ],
    'case-actionstep': [
      { source: 'matter_name', target: 'matter_name', enabled: true },
      { source: 'matter_number', target: 'matter_number', enabled: true },
      { source: 'client', target: 'client_name', enabled: true },
      { source: 'practice_area', target: 'practice_area', enabled: true },
      { source: 'status', target: 'matter_status', enabled: true },
      { source: 'open_date', target: 'created_at', enabled: true },
      { source: 'responsible_attorney', target: 'assigned_to', enabled: true }
    ]
  }
};

// Connectors API
const Connectors = {
  /**
   * Get all connectors
   */
  async getAll() {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      return { connectors: ConnectorsMockData.connectors };
    }
    return api.get('/api/v1/integrations/connectors');
  },

  /**
   * Get a specific connector
   */
  async get(connectorId) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      const connector = ConnectorsMockData.connectors.find(c => c.id === connectorId);
      return { connector };
    }
    return api.get(`/api/v1/integrations/connectors/${connectorId}`);
  },

  /**
   * Get connectors by category
   */
  async getByCategory(category) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      return { connectors: ConnectorsMockData.connectors.filter(c => c.category === category) };
    }
    return api.get(`/api/v1/integrations/connectors?category=${category}`);
  },

  /**
   * Configure a connector
   */
  async configure(connectorId, config) {
    if (api.isDemoMode()) {
      await MockData.delay(500);
      const connector = ConnectorsMockData.connectors.find(c => c.id === connectorId);
      if (connector) {
        connector.config = { ...connector.config, ...config };
        connector.status = 'connected';
        connector.lastSync = new Date().toISOString();
      }
      return { success: true, connector };
    }
    return api.post(`/api/v1/integrations/connectors/${connectorId}/configure`, config);
  },

  /**
   * Disconnect a connector
   */
  async disconnect(connectorId) {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      const connector = ConnectorsMockData.connectors.find(c => c.id === connectorId);
      if (connector) {
        connector.status = 'disconnected';
        connector.records = 0;
        connector.config = {};
      }
      return { success: true };
    }
    return api.post(`/api/v1/integrations/connectors/${connectorId}/disconnect`);
  },

  /**
   * Test connector connection
   */
  async testConnection(connectorId, config) {
    if (api.isDemoMode()) {
      await MockData.delay(1000);
      return { success: true, message: 'Connection successful' };
    }
    return api.post(`/api/v1/integrations/connectors/${connectorId}/test`, config);
  },

  /**
   * Trigger manual sync
   */
  async triggerSync(connectorId) {
    if (api.isDemoMode()) {
      await MockData.delay(2000);
      const connector = ConnectorsMockData.connectors.find(c => c.id === connectorId);
      if (connector) {
        connector.lastSync = new Date().toISOString();
        connector.records += Math.floor(Math.random() * 50);
      }
      return { success: true, records_synced: Math.floor(Math.random() * 100) };
    }
    return api.post(`/api/v1/integrations/connectors/${connectorId}/sync`);
  },

  /**
   * Get sync history
   */
  async getSyncHistory(connectorId = null, limit = 50) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      let history = ConnectorsMockData.syncHistory;
      if (connectorId) {
        history = history.filter(h => h.connector_id === connectorId);
      }
      return { history: history.slice(0, limit) };
    }
    const params = new URLSearchParams({ limit });
    if (connectorId) params.set('connector_id', connectorId);
    return api.get(`/api/v1/integrations/sync-history?${params}`);
  },

  /**
   * Get field mappings for a connector
   */
  async getFieldMappings(connectorId) {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      return { mappings: ConnectorsMockData.fieldMappings[connectorId] || [] };
    }
    return api.get(`/api/v1/integrations/connectors/${connectorId}/field-mappings`);
  },

  /**
   * Update field mappings
   */
  async updateFieldMappings(connectorId, mappings) {
    if (api.isDemoMode()) {
      await MockData.delay(300);
      ConnectorsMockData.fieldMappings[connectorId] = mappings;
      return { success: true };
    }
    return api.put(`/api/v1/integrations/connectors/${connectorId}/field-mappings`, { mappings });
  },

  /**
   * Get sync statistics
   */
  async getSyncStats() {
    if (api.isDemoMode()) {
      await MockData.delay(200);
      const connected = ConnectorsMockData.connectors.filter(c => c.status === 'connected');
      const totalRecords = connected.reduce((sum, c) => sum + (c.records || 0), 0);
      const errors = ConnectorsMockData.syncHistory.filter(h => h.status === 'error').length;
      const lastSync = connected.filter(c => c.lastSync).sort((a, b) => new Date(b.lastSync) - new Date(a.lastSync))[0];

      return {
        connected_count: connected.length,
        total_records: totalRecords,
        sync_errors: errors,
        last_sync: lastSync?.lastSync || null,
        syncs_today: ConnectorsMockData.syncHistory.filter(h => {
          const syncDate = new Date(h.started_at);
          const today = new Date();
          return syncDate.toDateString() === today.toDateString();
        }).length
      };
    }
    return api.get('/api/v1/integrations/stats');
  },

  /**
   * OAuth authorization URL
   */
  getOAuthUrl(connectorId, redirectUri) {
    const baseUrls = {
      'crm-hubspot': 'https://app.hubspot.com/oauth/authorize',
      'crm-salesforce': 'https://login.salesforce.com/services/oauth2/authorize',
      'fin-quickbooks': 'https://appcenter.intuit.com/connect/oauth2',
      'comm-gcal': 'https://accounts.google.com/o/oauth2/v2/auth',
      'doc-gdrive': 'https://accounts.google.com/o/oauth2/v2/auth',
      'doc-dropbox': 'https://www.dropbox.com/oauth2/authorize'
    };

    if (api.isDemoMode()) {
      return '#demo-oauth';
    }

    return `${api.baseUrl}/api/v1/integrations/oauth/${connectorId}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
};

/**
 * ConnectorRegistry - Fetch available connectors from the connector registry
 * Registry URL can be configured via window.config.connectorRegistryUrl
 */
const ConnectorRegistry = {
  /**
   * Get connector registry URL from config or use default
   */
  getRegistryUrl() {
    // Production: https://www.redroostertec.com
    return window.LanaConfig?.CONNECTOR_REGISTRY_URL || 'http://localhost:3001';
  },

  /**
   * Fetch the connector catalog from the registry API
   * Returns list of all available connectors
   * API: GET /lana-ai/v1/catalog/connectors
   */
  async getCatalog() {
    try {
      const baseUrl = this.getRegistryUrl();
      const response = await fetch(`${baseUrl}/lana-ai/v1/catalog/connectors`);

      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        connectors: data.connectors || [],
        registry_version: data.version,
        updated_at: data.last_updated
      };
    } catch (error) {
      console.error('Failed to fetch connector catalog from registry:', error);

      // If registry is unavailable in demo mode, return empty catalog
      if (api.isDemoMode()) {
        return { connectors: [], registry_version: '1.0.0', updated_at: new Date().toISOString() };
      }

      throw error;
    }
  },

  /**
   * Fetch a specific connector configuration from the registry API
   * API: GET /lana-ai/v1/catalog/connectors/:connector_id
   * @param {string} connectorId - The connector ID (e.g., 'hubspot-crm', 'google-drive')
   */
  async getConnectorConfig(connectorId) {
    try {
      const baseUrl = this.getRegistryUrl();
      const response = await fetch(`${baseUrl}/lana-ai/v1/catalog/connectors/${connectorId}`);

      if (!response.ok) {
        throw new Error(`Connector ${connectorId} not found in registry`);
      }

      const data = await response.json();
      return data.connector;
    } catch (error) {
      console.error(`Failed to fetch connector config for ${connectorId}:`, error);
      throw error;
    }
  },

  /**
   * Install a connector from the registry
   * This sends the connector configuration to the backend to create an integration_source
   * @param {string} connectorId - The connector ID from the registry
   */
  async installConnector(connectorId) {
    try {
      // 1. Fetch connector config from registry API
      const connectorConfig = await this.getConnectorConfig(connectorId);

      // 2. Send to backend to create integration source
      if (api.isDemoMode()) {
        await MockData.delay(500);
        // In demo mode, just add to the connectors list
        const newConnector = {
          id: `doc-${connectorId}`,
          name: connectorConfig.name,
          category: connectorConfig.category,
          description: connectorConfig.description,
          status: 'disconnected',
          records: 0,
          lastSync: null,
          config: {},
          connector_id: connectorId,
          authType: connectorConfig.auth_type
        };
        ConnectorsMockData.connectors.push(newConnector);
        return { success: true, connector: newConnector };
      }

      // Production: Send to backend API
      return api.post('/api/v1/integrations/registry/install', {
        connector_id: connectorId,
        connector_config: connectorConfig
      });
    } catch (error) {
      console.error(`Failed to install connector ${connectorId}:`, error);
      throw error;
    }
  },

  /**
   * Check if a connector from the registry is already installed
   * @param {string} connectorId - The registry connector ID
   * @param {Array} installedConnectors - List of connectors from backend API
   */
  isConnectorInstalled(connectorId, installedConnectors) {
    return installedConnectors.some(c => {
      // Check exact match on connector_id field (if backend stores it)
      if (c.connector_id === connectorId) {
        return true;
      }

      // Check if the ID ends with the connector ID (e.g., "doc-sharepoint" ends with "sharepoint")
      if (c.id && c.id.endsWith(connectorId)) {
        return true;
      }

      // Check if ID ends with connector ID after removing category prefix
      // e.g., "doc-sharepoint" matches "sharepoint"
      const idParts = c.id ? c.id.split('-') : [];
      if (idParts.length > 1 && idParts[idParts.length - 1] === connectorId) {
        return true;
      }

      return false;
    });
  }
};

// Export for use in other modules
window.Connectors = Connectors;
window.ConnectorsMockData = ConnectorsMockData;
window.ConnectorRegistry = ConnectorRegistry;

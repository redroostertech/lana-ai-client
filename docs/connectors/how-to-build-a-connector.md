# How to Build a Connector - Developer Tutorial

**Date:** 2025-12-21
**Version:** 2.0
**Audience:** Backend Developers

---

## Table of Contents

1. [Overview](#overview)
2. [Connector Architecture](#connector-architecture)
3. [Tutorial: Building Google Sheets Connector](#tutorial-building-google-sheets-connector)
4. [Tutorial: Building HubSpot CRM Connector](#tutorial-building-hubspot-crm-connector)
5. [OAuth Implementation](#oauth-implementation)
6. [Sync Strategies](#sync-strategies)
7. [Testing Your Connector](#testing-your-connector)
8. [Deployment Checklist](#deployment-checklist)

---

## Overview

A **connector** in Lana AI is a service that:
1. **Connects** to an external system (via OAuth, API key, etc.)
2. **Imports** data from that system
3. **Stores** it in our database (documents or connector_data)
4. **Syncs** periodically to keep data fresh
5. **Enables** AI chat and retrieval of that data

### Connector Types

| Type | Examples | Storage | Complexity |
|------|----------|---------|------------|
| **Document-based** | Google Sheets, Drive, Dropbox | `documents` table | Simple |
| **Structured data** | HubSpot, Salesforce, Calendar | `connector_data` table | Medium |
| **Hybrid** | Clio, MyCase (tasks + files) | Both tables | Complex |

---

## Connector Architecture

```
┌──────────────────────────────────────────────────────────┐
│  1. Connector Service (Your Code)                        │
│     src/services/connectors/{connector-name}/            │
│                                                           │
│     ├── oauth.service.js     - OAuth flow                │
│     ├── api.client.js        - API wrapper               │
│     ├── sync.service.js      - Sync logic                │
│     └── index.js             - Main export               │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│  2. Connector Routes (HTTP API)                          │
│     src/services/processor/routes/connectors.routes.js   │
│                                                           │
│     POST   /api/v1/connectors/connect                    │
│     POST   /api/v1/connectors/:id/sync                   │
│     GET    /api/v1/connectors/:id/status                 │
│     DELETE /api/v1/connectors/:id                        │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│  3. Database Storage                                     │
│                                                           │
│     integration_sources - Config, tokens, status         │
│     connector_sync_logs - Sync history                   │
│     connector_data      - Imported data (structured)     │
│     documents           - Imported files (documents)     │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│  4. Background Jobs (PM2)                                │
│     src/workers/connector-sync.worker.js                 │
│                                                           │
│     Runs every N minutes, syncs all active connectors    │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│  5. AI Integration                                       │
│                                                           │
│     User: "Show me my Google Sheets data"                │
│     → RAG retrieval from documents/connector_data        │
│     → AI chat with imported data                         │
└──────────────────────────────────────────────────────────┘
```

---

## Tutorial: Building Google Sheets Connector

Let's build a **document-based connector** that imports Google Sheets as CSV files.

### Step 1: Create Connector Service Directory

```bash
mkdir -p src/services/connectors/google-sheets
cd src/services/connectors/google-sheets
```

### Step 2: Implement OAuth Service

**File:** `src/services/connectors/google-sheets/oauth.service.js`

```javascript
const { google } = require('googleapis');
const { logInfo, logError } = require('../../../shared/logging/logger');

/**
 * Google Sheets OAuth Service
 * Handles OAuth 2.0 authentication flow
 */
class GoogleSheetsOAuthService {
  constructor() {
    // OAuth credentials from environment
    this.clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    this.redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      'http://localhost:8080/api/v1/connectors/google-sheets/callback';

    // Scopes needed for Google Sheets
    this.scopes = [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly'
    ];

    // Initialize OAuth2 client
    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );
  }

  /**
   * Generate authorization URL for user to visit
   *
   * @param {string} organizationId - Organization ID
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(organizationId) {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline', // Get refresh token
      scope: this.scopes,
      state: organizationId, // Pass org ID through state
      prompt: 'consent' // Force consent screen to get refresh token
    });

    logInfo('Generated Google Sheets auth URL', { organizationId });
    return authUrl;
  }

  /**
   * Exchange authorization code for tokens
   *
   * @param {string} code - Authorization code from OAuth callback
   * @returns {Promise<Object>} Tokens object
   */
  async getTokensFromCode(code) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      logInfo('Retrieved Google OAuth tokens', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date
      });

      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(tokens.expiry_date).toISOString(),
        token_type: tokens.token_type,
        scope: tokens.scope
      };
    } catch (error) {
      logError('Failed to exchange code for tokens', {
        error: error.message,
        code: code.substring(0, 10) + '...'
      });
      throw new Error('OAuth token exchange failed');
    }
  }

  /**
   * Refresh access token using refresh token
   *
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} New tokens
   */
  async refreshAccessToken(refreshToken) {
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      logInfo('Refreshed Google OAuth access token');

      return {
        access_token: credentials.access_token,
        expires_at: new Date(credentials.expiry_date).toISOString()
      };
    } catch (error) {
      logError('Failed to refresh access token', {
        error: error.message
      });
      throw new Error('Token refresh failed');
    }
  }

  /**
   * Get authenticated Google Sheets API client
   *
   * @param {Object} tokens - OAuth tokens
   * @returns {Object} Google Sheets API client
   */
  getAuthenticatedClient(tokens) {
    this.oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    return google.sheets({ version: 'v4', auth: this.oauth2Client });
  }
}

module.exports = GoogleSheetsOAuthService;
```

### Step 3: Implement API Client

**File:** `src/services/connectors/google-sheets/api.client.js`

```javascript
const { logInfo, logError } = require('../../../shared/logging/logger');

/**
 * Google Sheets API Client
 * Wrapper for Google Sheets API operations
 */
class GoogleSheetsAPIClient {
  constructor(oauthService, tokens) {
    this.oauthService = oauthService;
    this.tokens = tokens;
    this.sheetsClient = oauthService.getAuthenticatedClient(tokens);
  }

  /**
   * Get spreadsheet metadata
   *
   * @param {string} spreadsheetId - Spreadsheet ID
   * @returns {Promise<Object>} Spreadsheet metadata
   */
  async getSpreadsheetMetadata(spreadsheetId) {
    try {
      const response = await this.sheetsClient.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId,properties,sheets'
      });

      logInfo('Retrieved spreadsheet metadata', {
        spreadsheetId,
        title: response.data.properties.title,
        sheetCount: response.data.sheets.length
      });

      return response.data;
    } catch (error) {
      logError('Failed to get spreadsheet metadata', {
        spreadsheetId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get sheet data as 2D array
   *
   * @param {string} spreadsheetId - Spreadsheet ID
   * @param {string} sheetName - Sheet name
   * @param {string} range - A1 notation range (e.g., "A1:Z1000")
   * @returns {Promise<Array>} 2D array of cell values
   */
  async getSheetData(spreadsheetId, sheetName, range = null) {
    try {
      const rangeQuery = range || `${sheetName}!A1:ZZ10000`;

      const response = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: rangeQuery,
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });

      const rows = response.data.values || [];

      logInfo('Retrieved sheet data', {
        spreadsheetId,
        sheetName,
        rowCount: rows.length,
        columnCount: rows[0]?.length || 0
      });

      return rows;
    } catch (error) {
      logError('Failed to get sheet data', {
        spreadsheetId,
        sheetName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Convert sheet data to CSV string
   *
   * @param {Array} rows - 2D array of cell values
   * @returns {string} CSV string
   */
  convertToCSV(rows) {
    return rows.map(row => {
      return row.map(cell => {
        // Escape cells containing commas, quotes, or newlines
        const cellStr = String(cell || '');
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',');
    }).join('\n');
  }
}

module.exports = GoogleSheetsAPIClient;
```

### Step 4: Implement Sync Service

**File:** `src/services/connectors/google-sheets/sync.service.js`

```javascript
const GoogleSheetsOAuthService = require('./oauth.service');
const GoogleSheetsAPIClient = require('./api.client');
const { logInfo, logError } = require('../../../shared/logging/logger');
const { uploadToMinio } = require('../../../shared/storage/minio.client');
const postgres = require('../../../shared/database/postgres');

/**
 * Google Sheets Sync Service
 * Handles syncing spreadsheet data to Lana AI
 */
class GoogleSheetsSyncService {
  constructor() {
    this.oauthService = new GoogleSheetsOAuthService();
  }

  /**
   * Sync a Google Sheets connector
   *
   * @param {Object} integrationSource - Integration source from database
   * @returns {Promise<Object>} Sync result
   */
  async sync(integrationSource) {
    const syncStartTime = Date.now();
    let syncLog;

    try {
      // 1. Create sync log entry
      syncLog = await this.createSyncLog(integrationSource, 'started');

      // 2. Update integration source status
      await this.updateIntegrationSourceStatus(
        integrationSource.id,
        'syncing',
        null
      );

      // 3. Get tokens (refresh if needed)
      const tokens = await this.getValidTokens(integrationSource.config);

      // 4. Create API client
      const apiClient = new GoogleSheetsAPIClient(this.oauthService, tokens);

      // 5. Get spreadsheet data
      const { spreadsheetId, sheetName, headerRow = 1, dataStartRow = 2 } =
        integrationSource.config;

      const rows = await apiClient.getSheetData(spreadsheetId, sheetName);

      // 6. Convert to CSV
      const csvData = apiClient.convertToCSV(rows);

      // 7. Upload to MinIO
      const filename = `${sheetName}.csv`;
      const storageKey = `${integrationSource.organization_id}/google-sheets/${integrationSource.id}/${filename}`;

      await uploadToMinio({
        bucket: 'lana-documents-prod',
        key: storageKey,
        data: Buffer.from(csvData, 'utf-8'),
        contentType: 'text/csv'
      });

      // 8. Create document record
      const documentId = await this.createDocumentRecord({
        integrationSourceId: integrationSource.id,
        organizationId: integrationSource.organization_id,
        connectorId: 'google-sheets',
        externalId: `${spreadsheetId}-${sheetName}`,
        externalUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        filename,
        fileSize: Buffer.byteLength(csvData, 'utf-8'),
        storageKey,
        metadata: {
          spreadsheetId,
          sheetName,
          rowCount: rows.length,
          lastSyncedRow: rows.length
        }
      });

      // 9. Queue document for processing (chunking, embeddings)
      await this.queueDocumentForProcessing(documentId);

      // 10. Update sync log (completed)
      await this.updateSyncLog(syncLog.id, {
        status: 'completed',
        recordsProcessed: 1,
        recordsCreated: 1,
        durationSeconds: Math.floor((Date.now() - syncStartTime) / 1000)
      });

      // 11. Update integration source (completed)
      await this.updateIntegrationSourceStatus(
        integrationSource.id,
        'completed',
        null,
        1 // recordsSynced
      );

      logInfo('Google Sheets sync completed', {
        integrationSourceId: integrationSource.id,
        rowCount: rows.length,
        durationSeconds: Math.floor((Date.now() - syncStartTime) / 1000)
      });

      return {
        success: true,
        processed: 1,
        created: 1,
        updated: 0,
        failed: 0
      };

    } catch (error) {
      logError('Google Sheets sync failed', {
        integrationSourceId: integrationSource.id,
        error: error.message,
        stack: error.stack
      });

      // Update sync log (failed)
      if (syncLog) {
        await this.updateSyncLog(syncLog.id, {
          status: 'failed',
          errorMessage: error.message,
          errorDetails: { stack: error.stack },
          durationSeconds: Math.floor((Date.now() - syncStartTime) / 1000)
        });
      }

      // Update integration source (error)
      await this.updateIntegrationSourceStatus(
        integrationSource.id,
        'error',
        error.message
      );

      throw error;
    }
  }

  /**
   * Get valid OAuth tokens (refresh if expired)
   */
  async getValidTokens(config) {
    const { oauth_tokens } = config;
    const expiresAt = new Date(oauth_tokens.expires_at);
    const now = new Date();

    // If token expires in < 5 minutes, refresh it
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      logInfo('Refreshing expired Google OAuth token');
      const newTokens = await this.oauthService.refreshAccessToken(
        oauth_tokens.refresh_token
      );

      // Merge new tokens with existing
      return {
        ...oauth_tokens,
        ...newTokens
      };
    }

    return oauth_tokens;
  }

  /**
   * Create sync log entry
   */
  async createSyncLog(integrationSource, status) {
    const result = await postgres.query(
      `INSERT INTO connector_sync_logs
       (integration_source_id, organization_id, connector_id, sync_type,
        sync_status, triggered_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        integrationSource.id,
        integrationSource.organization_id,
        'google-sheets',
        'incremental',
        status,
        'schedule'
      ]
    );
    return result.rows[0];
  }

  /**
   * Update sync log
   */
  async updateSyncLog(syncLogId, updates) {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    });

    setClauses.push(`completed_at = NOW()`);

    await postgres.query(
      `UPDATE connector_sync_logs
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}`,
      [...values, syncLogId]
    );
  }

  /**
   * Update integration source status
   */
  async updateIntegrationSourceStatus(
    integrationSourceId,
    status,
    errorMessage,
    recordsSynced = 0
  ) {
    const updates = {
      sync_status: status,
      last_sync_at: 'NOW()'
    };

    if (status === 'completed') {
      updates.last_successful_sync_at = 'NOW()';
      updates.total_records_synced = `total_records_synced + ${recordsSynced}`;
    }

    if (errorMessage) {
      updates.sync_error_message = errorMessage;
    }

    const setClauses = Object.entries(updates).map(([key, value], index) => {
      if (key === 'total_records_synced') {
        return `${key} = ${value}`;
      }
      return `${key} = $${index + 1}`;
    });

    const values = Object.entries(updates)
      .filter(([key]) => key !== 'total_records_synced')
      .map(([, value]) => value === 'NOW()' ? null : value);

    await postgres.query(
      `UPDATE integration_sources
       SET ${setClauses.join(', ')},
           last_sync_at = NOW()
           ${status === 'completed' ? ', last_successful_sync_at = NOW()' : ''}
       WHERE id = $${values.length + 1}`,
      [...values, integrationSourceId]
    );
  }

  /**
   * Create document record
   */
  async createDocumentRecord(data) {
    const result = await postgres.query(
      `INSERT INTO documents
       (integration_source_id, organization_id, connector_id, external_id,
        external_url, filename, file_size, content_type, client_matter,
        storage_bucket, storage_key, status, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (integration_source_id, external_id)
       DO UPDATE SET
         file_size = EXCLUDED.file_size,
         storage_key = EXCLUDED.storage_key,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING id`,
      [
        data.integrationSourceId,
        data.organizationId,
        data.connectorId,
        data.externalId,
        data.externalUrl,
        data.filename,
        data.fileSize,
        'text/csv',
        'Google Sheets Import',
        'lana-documents-prod',
        data.storageKey,
        'pending',
        JSON.stringify(data.metadata),
        data.organizationId // Use org as created_by for connector imports
      ]
    );
    return result.rows[0].id;
  }

  /**
   * Queue document for processing
   */
  async queueDocumentForProcessing(documentId) {
    // This would trigger your existing document processing pipeline
    // that chunks the CSV and creates embeddings
    logInfo('Document queued for processing', { documentId });

    // Implementation depends on your existing document processor
    // For now, just log it
  }
}

module.exports = GoogleSheetsSyncService;
```

### Step 5: Create Main Export

**File:** `src/services/connectors/google-sheets/index.js`

```javascript
const GoogleSheetsOAuthService = require('./oauth.service');
const GoogleSheetsSyncService = require('./sync.service');

module.exports = {
  oauthService: new GoogleSheetsOAuthService(),
  syncService: new GoogleSheetsSyncService(),

  // Connector metadata
  metadata: {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'documents',
    requiresOAuth: true,
    supportsWebhooks: false,
    syncIntervalMinutes: 30
  }
};
```

### Step 6: Add Routes

**File:** `src/services/processor/routes/connectors.routes.js` (create new or extend existing)

```javascript
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { validateRequest } = require('../../../shared/utils/validation.utils');
const { authenticateJWT } = require('../../../shared/middleware/auth.middleware');
const googleSheets = require('../../connectors/google-sheets');
const postgres = require('../../../shared/database/postgres');

/**
 * POST /api/v1/connectors/google-sheets/authorize
 * Get OAuth authorization URL
 */
router.post(
  '/google-sheets/authorize',
  authenticateJWT,
  async (req, res, next) => {
    try {
      const authUrl = googleSheets.oauthService.getAuthorizationUrl(
        req.user.organization_id
      );

      res.json({
        authorization_url: authUrl,
        message: 'Visit this URL to authorize Google Sheets access'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/connectors/google-sheets/callback
 * OAuth callback handler
 */
router.get(
  '/google-sheets/callback',
  async (req, res, next) => {
    try {
      const { code, state: organizationId } = req.query;

      if (!code) {
        return res.status(400).json({ error: 'Missing authorization code' });
      }

      // Exchange code for tokens
      const tokens = await googleSheets.oauthService.getTokensFromCode(code);

      // Redirect to frontend with success message
      // Frontend will then call /connect endpoint with spreadsheet details
      res.redirect(
        `http://localhost:3000/connectors/google-sheets/configure?auth=success&org=${organizationId}`
      );
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/connectors/google-sheets/connect
 * Connect a Google Sheets spreadsheet
 */
const connectSchema = {
  body: z.object({
    source_name: z.string().min(1).max(255),
    spreadsheet_id: z.string().min(1),
    sheet_name: z.string().min(1),
    header_row: z.number().int().positive().default(1),
    data_start_row: z.number().int().positive().default(2),
    sync_interval_minutes: z.number().int().positive().default(30),
    oauth_code: z.string().min(1)
  })
};

router.post(
  '/google-sheets/connect',
  authenticateJWT,
  validateRequest(connectSchema),
  async (req, res, next) => {
    try {
      const { oauth_code, ...config } = req.body;

      // Exchange code for tokens
      const tokens = await googleSheets.oauthService.getTokensFromCode(oauth_code);

      // Create integration source
      const result = await postgres.query(
        `INSERT INTO integration_sources
         (organization_id, connector_id, connector_name, connector_category,
          source_name, config, sync_interval_minutes, auth_status, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          req.user.organization_id,
          'google-sheets',
          'Google Sheets',
          'documents',
          config.source_name,
          JSON.stringify({ ...config, oauth_tokens: tokens }),
          config.sync_interval_minutes,
          'connected',
          true
        ]
      );

      const integrationSource = result.rows[0];

      // Trigger initial sync
      await googleSheets.syncService.sync(integrationSource);

      res.status(201).json({
        integration_source: integrationSource,
        message: 'Google Sheets connector created and initial sync started'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/connectors/:id/sync
 * Manually trigger sync
 */
router.post(
  '/:id/sync',
  authenticateJWT,
  async (req, res, next) => {
    try {
      // Get integration source
      const result = await postgres.query(
        `SELECT * FROM integration_sources
         WHERE id = $1 AND organization_id = $2`,
        [req.params.id, req.user.organization_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Connector not found' });
      }

      const integrationSource = result.rows[0];

      // Get connector sync service
      const connectorId = integrationSource.connector_id;
      const connector = require(`../../connectors/${connectorId}`);

      // Trigger sync
      const syncResult = await connector.syncService.sync(integrationSource);

      res.json({
        message: 'Sync completed',
        result: syncResult
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
```

### Step 7: Register Routes

**File:** `src/services/processor/index.js` (add to existing routes)

```javascript
const connectorsRoutes = require('./routes/connectors.routes');

// ... existing code ...

app.use('/api/v1/connectors', connectorsRoutes);
```

### Step 8: Test Your Connector

```bash
# 1. Start the backend
npm start

# 2. Get authorization URL
curl -X POST http://localhost:8080/api/v1/connectors/google-sheets/authorize \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 3. Visit the authorization URL in browser
# Complete OAuth flow

# 4. Connect a spreadsheet
curl -X POST http://localhost:8080/api/v1/connectors/google-sheets/connect \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source_name": "Client Intake Sheet",
    "spreadsheet_id": "1abc...xyz",
    "sheet_name": "Clients",
    "header_row": 1,
    "data_start_row": 2,
    "sync_interval_minutes": 30,
    "oauth_code": "code_from_callback"
  }'

# 5. Check sync status
curl -X GET http://localhost:8080/api/v1/connectors/{id}/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 6. Manually trigger sync
curl -X POST http://localhost:8080/api/v1/connectors/{id}/sync \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Tutorial: Building HubSpot CRM Connector

Now let's build a **structured data connector** for HubSpot CRM.

### Key Differences from Document Connector

| Aspect | Google Sheets | HubSpot CRM |
|--------|---------------|-------------|
| **Storage** | `documents` table | `connector_data` table |
| **Data format** | CSV file in MinIO | JSONB in PostgreSQL |
| **Sync strategy** | Replace entire file | Incremental (changed records only) |
| **Entity types** | 1 (document) | Multiple (contact, deal, company) |

### Step 1: Create Connector Directory

```bash
mkdir -p src/services/connectors/hubspot-crm
cd src/services/connectors/hubspot-crm
```

### Step 2: Implement API Client

**File:** `src/services/connectors/hubspot-crm/api.client.js`

```javascript
const axios = require('axios');
const { logInfo, logError } = require('../../../shared/logging/logger');

/**
 * HubSpot CRM API Client
 */
class HubSpotAPIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.hubapi.com';

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Get all contacts (with pagination)
   *
   * @param {string} after - Pagination cursor
   * @returns {Promise<Object>} Contacts response
   */
  async getContacts(after = null) {
    try {
      const params = {
        limit: 100,
        properties: [
          'email',
          'firstname',
          'lastname',
          'phone',
          'company',
          'lifecyclestage',
          'hs_lead_status',
          'createdate',
          'lastmodifieddate'
        ]
      };

      if (after) {
        params.after = after;
      }

      const response = await this.client.get('/crm/v3/objects/contacts', { params });

      logInfo('Retrieved HubSpot contacts', {
        count: response.data.results.length,
        hasMore: !!response.data.paging?.next
      });

      return {
        contacts: response.data.results,
        hasMore: !!response.data.paging?.next,
        nextCursor: response.data.paging?.next?.after
      };
    } catch (error) {
      logError('Failed to get HubSpot contacts', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Get recently modified contacts (incremental sync)
   *
   * @param {Date} since - Get contacts modified since this date
   * @returns {Promise<Array>} Modified contacts
   */
  async getRecentlyModifiedContacts(since) {
    try {
      const sinceTimestamp = since.getTime();

      const response = await this.client.post(
        '/crm/v3/objects/contacts/search',
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'lastmodifieddate',
                  operator: 'GTE',
                  value: sinceTimestamp
                }
              ]
            }
          ],
          sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
          properties: [
            'email',
            'firstname',
            'lastname',
            'phone',
            'company',
            'lifecyclestage',
            'hs_lead_status',
            'createdate',
            'lastmodifieddate'
          ],
          limit: 100
        }
      );

      logInfo('Retrieved recently modified contacts', {
        count: response.data.results.length,
        since: since.toISOString()
      });

      return response.data.results;
    } catch (error) {
      logError('Failed to get recently modified contacts', {
        error: error.message,
        since: since.toISOString()
      });
      throw error;
    }
  }

  /**
   * Get all deals
   */
  async getDeals(after = null) {
    try {
      const params = {
        limit: 100,
        properties: [
          'dealname',
          'amount',
          'closedate',
          'dealstage',
          'pipeline',
          'probability',
          'createdate',
          'hs_lastmodifieddate'
        ]
      };

      if (after) {
        params.after = after;
      }

      const response = await this.client.get('/crm/v3/objects/deals', { params });

      return {
        deals: response.data.results,
        hasMore: !!response.data.paging?.next,
        nextCursor: response.data.paging?.next?.after
      };
    } catch (error) {
      logError('Failed to get HubSpot deals', { error: error.message });
      throw error;
    }
  }
}

module.exports = HubSpotAPIClient;
```

### Step 3: Implement Sync Service

**File:** `src/services/connectors/hubspot-crm/sync.service.js`

```javascript
const HubSpotAPIClient = require('./api.client');
const { logInfo, logError } = require('../../../shared/logging/logger');
const postgres = require('../../../shared/database/postgres');

/**
 * HubSpot CRM Sync Service
 */
class HubSpotSyncService {
  /**
   * Sync HubSpot CRM data
   */
  async sync(integrationSource) {
    const syncStartTime = Date.now();
    let syncLog;

    try {
      // 1. Create sync log
      syncLog = await this.createSyncLog(integrationSource, 'started');

      // 2. Update integration source status
      await this.updateIntegrationSourceStatus(
        integrationSource.id,
        'syncing',
        null
      );

      // 3. Create API client
      const apiClient = new HubSpotAPIClient(integrationSource.config.api_key);

      // 4. Determine sync type (full or incremental)
      const isFullSync = !integrationSource.last_successful_sync_at;
      const syncType = isFullSync ? 'full' : 'incremental';

      logInfo(`Starting ${syncType} sync for HubSpot`, {
        integrationSourceId: integrationSource.id
      });

      let totalProcessed = 0;
      let totalCreated = 0;
      let totalUpdated = 0;

      if (isFullSync) {
        // Full sync: Get all contacts
        const result = await this.syncAllContacts(
          apiClient,
          integrationSource
        );
        totalProcessed += result.processed;
        totalCreated += result.created;
        totalUpdated += result.updated;
      } else {
        // Incremental sync: Only recently modified
        const since = new Date(integrationSource.last_successful_sync_at);
        const result = await this.syncRecentlyModifiedContacts(
          apiClient,
          integrationSource,
          since
        );
        totalProcessed += result.processed;
        totalCreated += result.created;
        totalUpdated += result.updated;
      }

      // 5. Update sync log (completed)
      await this.updateSyncLog(syncLog.id, {
        status: 'completed',
        recordsProcessed: totalProcessed,
        recordsCreated: totalCreated,
        recordsUpdated: totalUpdated,
        durationSeconds: Math.floor((Date.now() - syncStartTime) / 1000)
      });

      // 6. Update integration source
      await this.updateIntegrationSourceStatus(
        integrationSource.id,
        'completed',
        null,
        totalCreated + totalUpdated
      );

      logInfo('HubSpot sync completed', {
        integrationSourceId: integrationSource.id,
        syncType,
        processed: totalProcessed,
        created: totalCreated,
        updated: totalUpdated
      });

      return {
        success: true,
        processed: totalProcessed,
        created: totalCreated,
        updated: totalUpdated,
        failed: 0
      };

    } catch (error) {
      logError('HubSpot sync failed', {
        integrationSourceId: integrationSource.id,
        error: error.message,
        stack: error.stack
      });

      if (syncLog) {
        await this.updateSyncLog(syncLog.id, {
          status: 'failed',
          errorMessage: error.message,
          errorDetails: { stack: error.stack },
          durationSeconds: Math.floor((Date.now() - syncStartTime) / 1000)
        });
      }

      await this.updateIntegrationSourceStatus(
        integrationSource.id,
        'error',
        error.message
      );

      throw error;
    }
  }

  /**
   * Sync all contacts (full sync)
   */
  async syncAllContacts(apiClient, integrationSource) {
    let processed = 0;
    let created = 0;
    let updated = 0;
    let hasMore = true;
    let cursor = null;

    while (hasMore) {
      const { contacts, hasMore: more, nextCursor } =
        await apiClient.getContacts(cursor);

      for (const contact of contacts) {
        const result = await this.upsertContact(contact, integrationSource);
        processed++;
        if (result === 'created') created++;
        if (result === 'updated') updated++;
      }

      hasMore = more;
      cursor = nextCursor;
    }

    return { processed, created, updated };
  }

  /**
   * Sync recently modified contacts (incremental sync)
   */
  async syncRecentlyModifiedContacts(apiClient, integrationSource, since) {
    const contacts = await apiClient.getRecentlyModifiedContacts(since);

    let processed = 0;
    let created = 0;
    let updated = 0;

    for (const contact of contacts) {
      const result = await this.upsertContact(contact, integrationSource);
      processed++;
      if (result === 'created') created++;
      if (result === 'updated') updated++;
    }

    return { processed, created, updated };
  }

  /**
   * Upsert contact to connector_data table
   */
  async upsertContact(contact, integrationSource) {
    const result = await postgres.query(
      `INSERT INTO connector_data
       (integration_source_id, organization_id, connector_id, entity_type,
        external_id, external_url, data, source_created_at, source_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (integration_source_id, entity_type, external_id)
       DO UPDATE SET
         data = EXCLUDED.data,
         source_updated_at = EXCLUDED.source_updated_at,
         synced_at = NOW(),
         updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        integrationSource.id,
        integrationSource.organization_id,
        'hubspot-crm',
        'contact',
        contact.id,
        `https://app.hubspot.com/contacts/${integrationSource.config.portal_id}/contact/${contact.id}`,
        JSON.stringify(contact.properties),
        contact.createdAt ? new Date(contact.createdAt) : null,
        contact.updatedAt ? new Date(contact.updatedAt) : null
      ]
    );

    return result.rows[0].inserted ? 'created' : 'updated';
  }

  // ... (same helper methods as Google Sheets: createSyncLog, updateSyncLog, etc.)
}

module.exports = HubSpotSyncService;
```

---

## OAuth Implementation

### OAuth Flow Diagram

```
1. User clicks "Connect HubSpot" in UI
   ↓
2. Backend generates authorization URL
   GET /api/v1/connectors/hubspot-crm/authorize
   → Returns: https://app.hubspot.com/oauth/authorize?client_id=...
   ↓
3. User visits URL, grants permissions
   ↓
4. HubSpot redirects to callback URL
   GET /api/v1/connectors/hubspot-crm/callback?code=abc123
   ↓
5. Backend exchanges code for tokens
   POST https://api.hubspot.com/oauth/v1/token
   ← Returns: { access_token, refresh_token, expires_in }
   ↓
6. Frontend calls connect endpoint with config
   POST /api/v1/connectors/hubspot-crm/connect
   Body: { source_name, oauth_code, ... }
   ↓
7. Backend creates integration_sources record
   ↓
8. Initial sync triggered
```

### Environment Variables Required

Add to `.env`:

```bash
# Google Sheets OAuth
GOOGLE_OAUTH_CLIENT_ID=your_client_id
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8080/api/v1/connectors/google-sheets/callback

# HubSpot OAuth (if using OAuth instead of API key)
HUBSPOT_OAUTH_CLIENT_ID=your_client_id
HUBSPOT_OAUTH_CLIENT_SECRET=your_client_secret
HUBSPOT_OAUTH_REDIRECT_URI=http://localhost:8080/api/v1/connectors/hubspot-crm/callback
```

---

## Sync Strategies

### Full Sync vs. Incremental Sync

| Strategy | When to Use | Pros | Cons |
|----------|-------------|------|------|
| **Full Sync** | First sync, or connector doesn't support incremental | Complete data refresh | Slow, high API usage |
| **Incremental Sync** | Subsequent syncs, connector supports "modified since" | Fast, efficient | Requires API support |

### Implementing Incremental Sync

```javascript
async sync(integrationSource) {
  // Check if this is first sync
  const isFirstSync = !integrationSource.last_successful_sync_at;

  if (isFirstSync) {
    // Full sync
    await this.fullSync(integrationSource);
  } else {
    // Incremental sync: Only fetch records modified since last sync
    const since = new Date(integrationSource.last_successful_sync_at);
    await this.incrementalSync(integrationSource, since);
  }
}
```

### Handling Pagination

```javascript
async fetchAllContacts(apiClient) {
  const allContacts = [];
  let hasMore = true;
  let cursor = null;

  while (hasMore) {
    const { results, paging } = await apiClient.getContacts({ after: cursor });

    allContacts.push(...results);

    hasMore = !!paging?.next;
    cursor = paging?.next?.after;

    // Optional: Add delay to respect rate limits
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return allContacts;
}
```

### Handling Rate Limits

```javascript
class APIClient {
  async makeRequest(url, options) {
    try {
      const response = await axios.get(url, options);
      return response.data;
    } catch (error) {
      // Check for rate limit error
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || 60;

        logWarn('Rate limit hit, waiting before retry', {
          retryAfter,
          url
        });

        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return this.makeRequest(url, options);
      }

      throw error;
    }
  }
}
```

---

## Testing Your Connector

### Unit Tests

**File:** `tests/unit/connectors/google-sheets.test.js`

```javascript
const GoogleSheetsAPIClient = require('../../../src/services/connectors/google-sheets/api.client');

describe('GoogleSheetsAPIClient', () => {
  let apiClient;
  let mockOAuthService;
  let mockTokens;

  beforeEach(() => {
    mockOAuthService = {
      getAuthenticatedClient: jest.fn()
    };
    mockTokens = {
      access_token: 'test_token',
      refresh_token: 'test_refresh'
    };
    apiClient = new GoogleSheetsAPIClient(mockOAuthService, mockTokens);
  });

  describe('convertToCSV', () => {
    test('converts simple 2D array to CSV', () => {
      const rows = [
        ['Name', 'Email', 'Phone'],
        ['John Doe', 'john@example.com', '555-1234'],
        ['Jane Smith', 'jane@example.com', '555-5678']
      ];

      const csv = apiClient.convertToCSV(rows);

      expect(csv).toBe(
        'Name,Email,Phone\n' +
        'John Doe,john@example.com,555-1234\n' +
        'Jane Smith,jane@example.com,555-5678'
      );
    });

    test('escapes cells with commas', () => {
      const rows = [
        ['Name', 'Address'],
        ['John Doe', '123 Main St, Springfield, IL']
      ];

      const csv = apiClient.convertToCSV(rows);

      expect(csv).toBe(
        'Name,Address\n' +
        'John Doe,"123 Main St, Springfield, IL"'
      );
    });

    test('escapes cells with quotes', () => {
      const rows = [
        ['Name', 'Note'],
        ['John', 'Said "hello" to me']
      ];

      const csv = apiClient.convertToCSV(rows);

      expect(csv).toBe(
        'Name,Note\n' +
        'John,"Said ""hello"" to me"'
      );
    });
  });
});
```

### Integration Tests

**File:** `tests/integration/connectors/google-sheets.test.js`

```javascript
const GoogleSheetsSyncService = require('../../../src/services/connectors/google-sheets/sync.service');
const postgres = require('../../../src/shared/database/postgres');

describe('GoogleSheetsSyncService Integration', () => {
  let syncService;
  let testOrgId;
  let testIntegrationSource;

  beforeAll(async () => {
    syncService = new GoogleSheetsSyncService();

    // Create test organization
    const orgResult = await postgres.query(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
      ['Test Org - Google Sheets']
    );
    testOrgId = orgResult.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup
    await postgres.query(
      `DELETE FROM organizations WHERE id = $1`,
      [testOrgId]
    );
  });

  test('creates sync log on sync start', async () => {
    // Create test integration source
    const sourceResult = await postgres.query(
      `INSERT INTO integration_sources
       (organization_id, connector_id, config)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        testOrgId,
        'google-sheets',
        JSON.stringify({
          spreadsheet_id: 'test_id',
          sheet_name: 'Test',
          oauth_tokens: {
            access_token: 'test',
            refresh_token: 'test',
            expires_at: new Date(Date.now() + 3600000).toISOString()
          }
        })
      ]
    );

    testIntegrationSource = sourceResult.rows[0];

    // Trigger sync (will fail without real tokens, but should create log)
    try {
      await syncService.sync(testIntegrationSource);
    } catch (error) {
      // Expected to fail
    }

    // Check sync log was created
    const logResult = await postgres.query(
      `SELECT * FROM connector_sync_logs
       WHERE integration_source_id = $1`,
      [testIntegrationSource.id]
    );

    expect(logResult.rows.length).toBeGreaterThan(0);
    expect(logResult.rows[0].connector_id).toBe('google-sheets');
  });
});
```

---

## Deployment Checklist

Before deploying your connector to production:

### 1. Code Quality ✅

- [ ] All functions have JSDoc comments
- [ ] Error handling implemented (try/catch)
- [ ] Logging added (info, error, debug)
- [ ] Input validation with Zod schemas
- [ ] No hardcoded credentials (use environment variables)

### 2. Testing ✅

- [ ] Unit tests written (≥90% coverage)
- [ ] Integration tests written
- [ ] Tested OAuth flow end-to-end
- [ ] Tested sync with real API
- [ ] Tested error scenarios (API down, bad tokens, rate limits)
- [ ] Tested incremental sync
- [ ] Tested with large datasets

### 3. Database ✅

- [ ] Migration script tested
- [ ] Indexes created for performance
- [ ] Foreign keys and constraints in place
- [ ] Tested on copy of production database

### 4. API ✅

- [ ] Endpoints added to Postman collection
- [ ] Request validation implemented
- [ ] Authentication required (JWT)
- [ ] Rate limiting considered
- [ ] Error responses consistent

### 5. Documentation ✅

- [ ] Connector added to catalog (discovery server)
- [ ] README updated with connector info
- [ ] Environment variables documented
- [ ] API endpoints documented in Postman
- [ ] User guide created (if needed)

### 6. Security ✅

- [ ] OAuth tokens encrypted at rest
- [ ] API keys stored securely
- [ ] Organization-scoped access enforced
- [ ] No sensitive data in logs
- [ ] HTTPS required for OAuth callbacks

### 7. Monitoring ✅

- [ ] Sync logs being created
- [ ] Errors being logged
- [ ] Success metrics tracked
- [ ] Alerts configured for failures

### 8. Production Deployment ✅

```bash
# 1. Merge to main branch
git checkout main
git merge feature/connector-name

# 2. Run migration on production database
psql -d lana_chef_prod -f src/migrations/20251221_connector_architecture_schema.sql

# 3. Deploy code
./deploy-prod-mac.sh

# 4. Test connector in production
curl -X POST https://api.lanaai.com/api/v1/connectors/google-sheets/authorize \
  -H "Authorization: Bearer PROD_TOKEN"

# 5. Monitor logs
pm2 logs lana-api

# 6. Check first sync
psql -d lana_chef_prod -c "SELECT * FROM connector_sync_logs ORDER BY created_at DESC LIMIT 5;"
```

---

## Summary

You've learned how to:

1. ✅ Build a **document-based connector** (Google Sheets)
2. ✅ Build a **structured data connector** (HubSpot CRM)
3. ✅ Implement **OAuth authentication**
4. ✅ Implement **sync strategies** (full and incremental)
5. ✅ Handle **pagination and rate limits**
6. ✅ Store data in **flexible database schema**
7. ✅ Test connectors **thoroughly**
8. ✅ Deploy to **production safely**

### Next Steps

- Build more connectors using these patterns
- Implement webhook support for real-time sync
- Add connector UI in Electron app
- Implement background sync worker
- Add connector analytics and monitoring

---

**Happy coding! 🚀**

**Questions?** Check the [database architecture docs](./database-architecture.md) or [API spec](../api/connector-catalog-api-spec-v2.md).

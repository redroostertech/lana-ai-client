# Connector Database Architecture

**Date:** 2025-12-21
**Version:** 2.0
**Migration:** `20251221_connector_architecture_schema.sql`

---

## Overview

The connector database architecture supports the **simplified data ingestion model** where connectors:
1. Import data from external systems
2. Store it for AI chat and retrieval
3. Enable future workflow automations

This architecture **does NOT** require complex matter association or bidirectional sync (unlike ActionStep/Leadly).

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    Discovery Server (External)                │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Connector Catalog Database                          │   │
│  │  - 18 connectors (metadata)                          │   │
│  │  - Read-only API                                     │   │
│  │  - Source of truth for connector definitions         │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────────────┬─────────────────────────────┘
                                 │
                                 │ API calls (catalog lookup)
                                 │
┌────────────────────────────────▼─────────────────────────────┐
│              Lana AI Backend Database (lana_chef)             │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  1. Connector Instances (User Configurations)           │ │
│  │     Table: integration_sources                          │ │
│  │     - Which connectors user has configured              │ │
│  │     - OAuth tokens, API keys, settings                  │ │
│  │     - Sync status, auth status                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  2. Sync Operations (History & Tracking)               │ │
│  │     Table: connector_sync_logs                          │ │
│  │     - When syncs happened                               │ │
│  │     - Success/failure status                            │ │
│  │     - Records processed, errors                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  3. Imported Data Storage                              │ │
│  │                                                          │ │
│  │  A. Document-Based Connectors:                         │ │
│  │     Table: documents                                    │ │
│  │     - Google Sheets (CSV export)                        │ │
│  │     - Google Drive, Dropbox, Box, OneDrive              │ │
│  │     - SharePoint                                        │ │
│  │     Uses existing ingestion pipeline + vector search   │ │
│  │                                                          │ │
│  │  B. Structured Data Connectors:                        │ │
│  │     Table: connector_data                               │ │
│  │     - Contacts (HubSpot, Salesforce, Zoho)             │ │
│  │     - Calendar events (Google Calendar, Outlook)        │ │
│  │     - Tasks (Clio, MyCase, Filevine)                   │ │
│  │     - Deals/Opportunities (CRM connectors)             │ │
│  │     JSONB storage for flexible schema                  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  4. AI Integration                                     │ │
│  │     - Vector embeddings (Qdrant)                       │ │
│  │     - Full-text search (PostgreSQL tsvector)           │ │
│  │     - Chat context compilation                         │ │
│  └─────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

---

## Database Tables

### 1. `integration_sources` (Connector Instances)

**Purpose:** Stores user-configured connector instances (OAuth connections, API keys, settings)

**Schema:**
```sql
CREATE TABLE public.integration_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),

  -- Connector identity
  connector_id VARCHAR(255),           -- e.g., "google-sheets", "hubspot-crm"
  connector_name VARCHAR(255),         -- User-friendly name from catalog
  connector_category VARCHAR(50),      -- "crm", "documents", "communications"
  source_type VARCHAR(50) NOT NULL,    -- Legacy field (kept for compatibility)
  source_name VARCHAR(255) NOT NULL,   -- User-assigned name

  -- Configuration
  config JSONB NOT NULL,               -- OAuth tokens, API keys, connector settings
  is_active BOOLEAN DEFAULT TRUE,

  -- Sync status
  sync_status VARCHAR(50) DEFAULT 'idle',  -- idle, syncing, error, completed
  sync_error_message TEXT,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_successful_sync_at TIMESTAMP WITH TIME ZONE,
  sync_interval_minutes INTEGER DEFAULT 60,
  total_records_synced BIGINT DEFAULT 0,

  -- Authentication status
  auth_status VARCHAR(50) DEFAULT 'disconnected',  -- connected, disconnected, expired, error

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Example Record:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "organization_id": "org-123-456",
  "connector_id": "google-sheets",
  "connector_name": "Google Sheets",
  "connector_category": "documents",
  "source_name": "Client Intake Sheet",
  "config": {
    "spreadsheet_id": "1abc...xyz",
    "sheet_name": "Clients",
    "header_row": 1,
    "data_start_row": 2,
    "oauth_tokens": {
      "access_token": "ya29...",
      "refresh_token": "1//...",
      "expires_at": "2025-12-21T15:00:00Z"
    }
  },
  "is_active": true,
  "sync_status": "completed",
  "last_successful_sync_at": "2025-12-21T14:30:00Z",
  "sync_interval_minutes": 30,
  "total_records_synced": 450,
  "auth_status": "connected"
}
```

---

### 2. `connector_sync_logs` (Sync History)

**Purpose:** Track all sync operations (success, failures, metrics)

**Schema:**
```sql
CREATE TABLE public.connector_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_source_id UUID NOT NULL REFERENCES integration_sources(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  connector_id VARCHAR(255) NOT NULL,

  -- Sync details
  sync_type VARCHAR(50) NOT NULL,      -- full, incremental, manual, scheduled
  sync_status VARCHAR(50) NOT NULL,    -- started, in_progress, completed, failed, cancelled

  -- Metrics
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,

  -- Timing
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,

  -- Error handling
  error_message TEXT,
  error_details JSONB,

  -- Audit
  triggered_by VARCHAR(50),            -- user, schedule, webhook, manual
  triggered_by_user_id UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}'
);
```

**Example Record:**
```json
{
  "id": "sync-log-abc-123",
  "integration_source_id": "550e8400-e29b-41d4-a716-446655440001",
  "organization_id": "org-123-456",
  "connector_id": "google-sheets",
  "sync_type": "incremental",
  "sync_status": "completed",
  "records_processed": 15,
  "records_created": 5,
  "records_updated": 10,
  "records_failed": 0,
  "started_at": "2025-12-21T14:30:00Z",
  "completed_at": "2025-12-21T14:31:23Z",
  "duration_seconds": 83,
  "triggered_by": "schedule",
  "metadata": {
    "api_version": "v4",
    "sheet_range": "A1:Z1000",
    "rate_limit_remaining": 450
  }
}
```

---

### 3. `connector_data` (Structured Data)

**Purpose:** Store non-document data (contacts, calendar events, tasks, deals, etc.)

**Schema:**
```sql
CREATE TABLE public.connector_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_source_id UUID NOT NULL REFERENCES integration_sources(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  connector_id VARCHAR(255) NOT NULL,

  -- Data classification
  entity_type VARCHAR(100) NOT NULL,   -- "contact", "calendar_event", "task", "deal"
  external_id VARCHAR(500) NOT NULL,   -- ID from source system
  external_url TEXT,                   -- Link back to source

  -- Data storage
  data JSONB NOT NULL,                 -- Raw data from connector

  -- Matter association (optional, for future)
  matter_id UUID REFERENCES client_matters(id),

  -- Search
  search_vector tsvector,              -- Full-text search
  tags TEXT[],                         -- User tags

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source_created_at TIMESTAMP WITH TIME ZONE,
  source_updated_at TIMESTAMP WITH TIME ZONE,

  UNIQUE(integration_source_id, entity_type, external_id)
);
```

**Example Records:**

**Contact from HubSpot:**
```json
{
  "id": "contact-uuid-1",
  "integration_source_id": "hubspot-source-uuid",
  "organization_id": "org-123-456",
  "connector_id": "hubspot-crm",
  "entity_type": "contact",
  "external_id": "hubspot-contact-12345",
  "external_url": "https://app.hubspot.com/contacts/12345",
  "data": {
    "email": "john.doe@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "phone": "+1-555-123-4567",
    "company": "Example Corp",
    "lifecycleStage": "lead",
    "dealValue": 50000,
    "customFields": {
      "practice_area": "Personal Injury",
      "referral_source": "Google Ads"
    }
  },
  "tags": ["lead", "personal-injury"],
  "source_created_at": "2025-11-01T10:00:00Z",
  "source_updated_at": "2025-12-15T14:30:00Z"
}
```

**Calendar Event from Google Calendar:**
```json
{
  "id": "event-uuid-1",
  "integration_source_id": "gcal-source-uuid",
  "organization_id": "org-123-456",
  "connector_id": "google-calendar",
  "entity_type": "calendar_event",
  "external_id": "google-event-xyz789",
  "external_url": "https://calendar.google.com/event?eid=xyz789",
  "data": {
    "summary": "Client Consultation - Jane Smith",
    "description": "Initial consultation for estate planning",
    "start": "2025-12-22T14:00:00Z",
    "end": "2025-12-22T15:00:00Z",
    "location": "Conference Room A",
    "attendees": [
      {"email": "attorney@firm.com", "responseStatus": "accepted"},
      {"email": "jane.smith@example.com", "responseStatus": "accepted"}
    ],
    "reminders": {
      "useDefault": false,
      "overrides": [{"method": "email", "minutes": 1440}]
    }
  },
  "matter_id": "matter-uuid-456",
  "tags": ["consultation", "estate-planning"]
}
```

---

### 4. `documents` (Document Storage)

**Purpose:** Store documents from document-based connectors (reuses existing table)

**Extended Fields:**
```sql
ALTER TABLE public.documents
ADD COLUMN integration_source_id UUID REFERENCES integration_sources(id),
ADD COLUMN connector_id VARCHAR(255),
ADD COLUMN external_id VARCHAR(500),
ADD COLUMN external_url TEXT;
```

**Example Record:**
```json
{
  "id": "doc-uuid-1",
  "organization_id": "org-123-456",
  "integration_source_id": "gdrive-source-uuid",
  "connector_id": "google-drive",
  "external_id": "google-drive-file-abc123",
  "external_url": "https://drive.google.com/file/d/abc123",
  "filename": "Estate Planning Checklist.pdf",
  "file_size": 1024567,
  "content_type": "application/pdf",
  "client_matter": "Smith, Jane - Estate Planning",
  "storage_bucket": "lana-documents-prod",
  "storage_key": "org-123-456/matter-456/estate-checklist.pdf",
  "status": "processed",
  "chunk_count": 15,
  "vector_count": 15,
  "metadata": {
    "drive_folder": "/Shared Drives/Legal/Estate Planning",
    "owner": "attorney@firm.com",
    "last_modified_by": "paralegal@firm.com"
  }
}
```

---

## Data Flow Examples

### Example 1: Google Sheets Connector (Document-Based)

```
1. User configures Google Sheets connector in UI
   ↓
2. Backend creates integration_sources record
   {
     connector_id: "google-sheets",
     config: { spreadsheet_id, sheet_name, oauth_tokens }
   }
   ↓
3. Scheduled sync runs every 30 minutes
   ↓
4. Create sync log entry (status: started)
   ↓
5. Connector service:
   - Fetches sheet data via Google Sheets API
   - Converts to CSV
   - Uploads to MinIO storage
   ↓
6. Creates document record:
   {
     integration_source_id: [uuid],
     connector_id: "google-sheets",
     filename: "Client Intake Sheet.csv",
     external_id: "spreadsheet-abc123-sheet-0"
   }
   ↓
7. Document processing pipeline:
   - Chunks CSV rows
   - Creates embeddings
   - Stores in Qdrant for vector search
   ↓
8. Update sync log (status: completed, records_created: 1)
   ↓
9. User can now chat with spreadsheet data via AI
```

### Example 2: HubSpot CRM Connector (Structured Data)

```
1. User configures HubSpot connector in UI
   ↓
2. Backend creates integration_sources record
   {
     connector_id: "hubspot-crm",
     config: { api_key, portal_id }
   }
   ↓
3. Scheduled sync runs every 60 minutes
   ↓
4. Create sync log entry (status: started)
   ↓
5. Connector service:
   - Fetches contacts via HubSpot API
   - Fetches deals via HubSpot API
   ↓
6. For each contact, insert/update connector_data:
   {
     entity_type: "contact",
     external_id: "hubspot-contact-12345",
     data: { email, firstName, lastName, ... }
   }
   ↓
7. Full-text search vector auto-updated via trigger
   ↓
8. Update sync log (status: completed, records_created: 25, records_updated: 10)
   ↓
9. User can:
   - Chat with AI about contacts ("Who are our leads from last month?")
   - Search contacts ("Find all contacts at Example Corp")
   - Build workflows (future: "Send email to all leads")
```

---

## Common Operations

### Creating a Connector Instance

```javascript
// User clicks "Connect Google Sheets" in UI
const connectionData = {
  organization_id: req.user.organization_id,
  connector_id: 'google-sheets',
  connector_name: 'Google Sheets',
  connector_category: 'documents',
  source_name: 'Client Intake Sheet',  // User-provided name
  config: {
    spreadsheet_id: '1abc...xyz',
    sheet_name: 'Clients',
    header_row: 1,
    data_start_row: 2,
    oauth_tokens: {
      access_token: oauthResult.access_token,
      refresh_token: oauthResult.refresh_token,
      expires_at: new Date(Date.now() + 3600000)
    }
  },
  sync_interval_minutes: 30,
  auth_status: 'connected'
};

const integrationSource = await postgres.query(
  `INSERT INTO integration_sources
   (organization_id, connector_id, connector_name, connector_category,
    source_name, config, sync_interval_minutes, auth_status)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   RETURNING *`,
  [
    connectionData.organization_id,
    connectionData.connector_id,
    connectionData.connector_name,
    connectionData.connector_category,
    connectionData.source_name,
    JSON.stringify(connectionData.config),
    connectionData.sync_interval_minutes,
    connectionData.auth_status
  ]
);
```

### Running a Sync Operation

```javascript
async function syncConnector(integrationSourceId) {
  // 1. Get integration source
  const source = await postgres.query(
    'SELECT * FROM integration_sources WHERE id = $1',
    [integrationSourceId]
  );

  // 2. Create sync log
  const syncLog = await postgres.query(
    `INSERT INTO connector_sync_logs
     (integration_source_id, organization_id, connector_id, sync_type,
      sync_status, triggered_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      source.id,
      source.organization_id,
      source.connector_id,
      'incremental',  // or 'full'
      'started',
      'schedule'
    ]
  );

  try {
    // 3. Update integration_sources sync_status
    await postgres.query(
      'UPDATE integration_sources SET sync_status = $1 WHERE id = $2',
      ['syncing', integrationSourceId]
    );

    // 4. Call connector-specific sync logic
    const syncResult = await connectorRegistry[source.connector_id].sync(source);

    // 5. Update sync log with success
    await postgres.query(
      `UPDATE connector_sync_logs
       SET sync_status = 'completed',
           completed_at = NOW(),
           duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER,
           records_processed = $1,
           records_created = $2,
           records_updated = $3
       WHERE id = $4`,
      [
        syncResult.processed,
        syncResult.created,
        syncResult.updated,
        syncLog.id
      ]
    );

    // 6. Update integration_sources
    await postgres.query(
      `UPDATE integration_sources
       SET sync_status = 'completed',
           last_sync_at = NOW(),
           last_successful_sync_at = NOW(),
           total_records_synced = total_records_synced + $1
       WHERE id = $2`,
      [syncResult.created + syncResult.updated, integrationSourceId]
    );

  } catch (error) {
    // Handle errors
    await postgres.query(
      `UPDATE connector_sync_logs
       SET sync_status = 'failed',
           completed_at = NOW(),
           error_message = $1,
           error_details = $2
       WHERE id = $3`,
      [error.message, JSON.stringify({ stack: error.stack }), syncLog.id]
    );

    await postgres.query(
      `UPDATE integration_sources
       SET sync_status = 'error',
           sync_error_message = $1
       WHERE id = $2`,
      [error.message, integrationSourceId]
    );
  }
}
```

### Querying Connector Data

```javascript
// Search for contacts in HubSpot
async function searchContacts(organizationId, searchTerm) {
  const results = await postgres.query(
    `SELECT * FROM connector_data
     WHERE organization_id = $1
     AND connector_id = 'hubspot-crm'
     AND entity_type = 'contact'
     AND search_vector @@ to_tsquery('english', $2)
     ORDER BY source_updated_at DESC
     LIMIT 50`,
    [organizationId, searchTerm]
  );

  return results.rows.map(row => ({
    id: row.id,
    name: `${row.data.firstName} ${row.data.lastName}`,
    email: row.data.email,
    company: row.data.company,
    sourceUrl: row.external_url,
    lastUpdated: row.source_updated_at
  }));
}

// Get all calendar events for a matter
async function getMatterEvents(matterId) {
  const results = await postgres.query(
    `SELECT * FROM connector_data
     WHERE matter_id = $1
     AND entity_type = 'calendar_event'
     ORDER BY (data->>'start')::timestamp DESC`,
    [matterId]
  );

  return results.rows.map(row => ({
    id: row.id,
    summary: row.data.summary,
    start: row.data.start,
    end: row.data.end,
    attendees: row.data.attendees,
    sourceUrl: row.external_url
  }));
}
```

---

## Migration Guide

### For New Deployments

```bash
# Run migration
psql -d lana_chef -f src/migrations/20251221_connector_architecture_schema.sql

# Verify tables created
psql -d lana_chef -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'connector%';"
```

### For Existing Deployments

The migration is **backward compatible**:
- All new columns are nullable or have defaults
- Existing `integration_sources` data unchanged
- Existing `documents` table unchanged
- ActionStep and Leadly schemas unaffected

**Steps:**
1. Backup database
2. Run migration
3. No code changes required immediately
4. Update connector implementation code to use new fields

---

## Comparison: ActionStep vs. Generic Connectors

| Feature | ActionStep (Tier 1) | Generic Connectors (Tier 2/3) |
|---------|---------------------|-------------------------------|
| **Schema** | Dedicated schema (`actionstep.*`) | Generic tables (`connector_data`) |
| **Tables** | 12 tables (matters, participants, file_notes, tasks, etc.) | 1 table (JSONB storage) |
| **Data Model** | Normalized SQL tables | Flexible JSONB |
| **Sync Logic** | Dedicated service with complex workflows | Generic sync framework |
| **Matter Integration** | Deep integration with matter lifecycle | Optional association (future) |
| **Use Case** | Full practice management integration | Data ingestion for AI |
| **Development Effort** | High (custom schema, services) | Low (reuse generic framework) |

**When to use dedicated schema (like ActionStep):**
- Tier 1 built-in connector
- Complex workflows requiring relational data
- Extensive UI for managing integration data

**When to use generic connector_data:**
- Tier 2/3 connectors
- Simple data ingestion for AI chat
- Minimal UI (just sync status, search)

---

## Next Steps

1. ✅ **Database schema ready** - Migration complete
2. ⏳ **Implement connector services** - Build Google Sheets sync logic
3. ⏳ **Create connector API endpoints** - CRUD for integration_sources
4. ⏳ **Build UI for connector management** - Connect/disconnect, sync status
5. ⏳ **Implement OAuth flows** - Google, Microsoft, HubSpot, etc.
6. ⏳ **Add AI integration** - Chat with connector data
7. ⏳ **Build workflows** (future) - Automate actions based on connector data

---

**Status:** Production-Ready
**Last Updated:** 2025-12-21
**Maintained by:** Red Rooster Technologies

# Database Changes for Connector Implementation - Summary

**Date:** 2025-12-21
**Question:** "Do we need to make any changes to the database and tables and etc to support how we are going to implementing the connectors?"

**Answer:** ✅ **Yes, but minimal changes needed. The migration is complete and backward compatible.**

---

## What Changed

### ✅ Migration Complete: `20251221_connector_architecture_schema.sql`

**Status:** Successfully applied to `lana_chef` database

---

## Summary of Changes

### 1. Extended Existing Table ✅

**Table:** `public.integration_sources` (already existed)

**Added 9 new columns:**
- `connector_id` - Links to catalog connector (e.g., "google-sheets")
- `connector_name` - User-friendly name from catalog
- `connector_category` - Category (crm, documents, communications)
- `sync_status` - Current sync state (idle, syncing, error, completed)
- `sync_error_message` - Last error if sync failed
- `last_successful_sync_at` - Last successful sync timestamp
- `sync_interval_minutes` - Auto-sync frequency (default: 60)
- `total_records_synced` - Lifetime counter
- `auth_status` - OAuth/API auth state (connected, disconnected, expired)

**Impact:** ✅ Backward compatible - all columns nullable or have defaults

---

### 2. Created New Tables ✅

#### A. `connector_sync_logs`
**Purpose:** Track all sync operations (history, metrics, errors)

**Key Fields:**
- Sync type (full, incremental, manual, scheduled)
- Sync status (started, in_progress, completed, failed)
- Metrics (records processed/created/updated/failed)
- Timing (started_at, completed_at, duration)
- Error details (message, stack trace)
- Triggered by (user, schedule, webhook)

**Why Needed:** Replaces dedicated sync_logs in ActionStep/Leadly schemas, provides unified sync tracking across all connectors.

#### B. `connector_data`
**Purpose:** Store non-document data (contacts, calendar events, tasks, deals)

**Key Fields:**
- `entity_type` - Type of data (contact, calendar_event, task, deal)
- `data` (JSONB) - Raw data from connector
- `external_id` - ID in source system (for deduplication)
- `external_url` - Link back to source
- `search_vector` (tsvector) - Full-text search
- `matter_id` (optional) - Future matter association

**Why Needed:** Document-based connectors (Google Sheets, Drive) use existing `documents` table. Structured data connectors (HubSpot, Salesforce, Google Calendar) need flexible JSONB storage.

---

### 3. Extended Documents Table ✅

**Table:** `public.documents` (already existed)

**Added 4 new columns:**
- `integration_source_id` - References connector instance
- `connector_id` - Connector that imported the document
- `external_id` - Document ID in source system
- `external_url` - Link to document in source

**Why Needed:** Track which documents came from connectors (vs. manual uploads), enable re-sync and deduplication.

---

## Data Flow Architecture

### Before Migration ❌

```
Connectors → ??? (No clear storage strategy)
            ↓
         Ad-hoc implementations
```

### After Migration ✅

```
┌──────────────────────────────────────────────────────┐
│  Discovery Server (External)                          │
│  - Connector catalog (18 connectors)                  │
│  - Read-only API                                      │
└────────────────┬─────────────────────────────────────┘
                 │
                 ↓ API calls (catalog metadata)
┌────────────────────────────────────────────────────────┐
│  Lana AI Backend Database (lana_chef)                  │
│                                                         │
│  1. integration_sources                                │
│     - User's configured connectors                     │
│     - OAuth tokens, API keys                           │
│     - Sync status                                      │
│                                                         │
│  2. connector_sync_logs                                │
│     - Sync history and metrics                         │
│     - Error tracking                                   │
│                                                         │
│  3. Data Storage (two paths):                          │
│                                                         │
│     A. Document-Based Connectors:                      │
│        → documents table                               │
│        (Google Sheets, Drive, Dropbox, etc.)           │
│                                                         │
│     B. Structured Data Connectors:                     │
│        → connector_data table                          │
│        (HubSpot, Salesforce, Calendar, etc.)           │
│                                                         │
│  4. AI Integration:                                    │
│     - Vector embeddings (Qdrant)                       │
│     - Full-text search (tsvector)                      │
└────────────────────────────────────────────────────────┘
```

---

## Connector Type → Storage Mapping

| Connector | Type | Storage Table | Data Format |
|-----------|------|---------------|-------------|
| **Google Sheets** | Document | `documents` | CSV exported to MinIO |
| **Google Drive** | Document | `documents` | Files in MinIO |
| **Dropbox** | Document | `documents` | Files in MinIO |
| **Box** | Document | `documents` | Files in MinIO |
| **OneDrive** | Document | `documents` | Files in MinIO |
| **SharePoint** | Document | `documents` | Files in MinIO |
| **HubSpot CRM** | Structured | `connector_data` | JSONB (contacts, deals) |
| **Salesforce** | Structured | `connector_data` | JSONB (accounts, opportunities) |
| **Zoho CRM** | Structured | `connector_data` | JSONB (leads, contacts) |
| **Google Calendar** | Structured | `connector_data` | JSONB (events) |
| **Outlook Calendar** | Structured | `connector_data` | JSONB (events) |
| **Twilio** | Structured | `connector_data` | JSONB (messages, calls) |
| **CallRail** | Structured | `connector_data` | JSONB (calls, texts) |
| **QuickBooks** | Structured | `connector_data` | JSONB (invoices, clients) |
| **Clio** | Structured | `connector_data` | JSONB (matters, tasks) |
| **MyCase** | Structured | `connector_data` | JSONB (cases, tasks) |
| **Filevine** | Structured | `connector_data` | JSONB (projects, tasks) |
| **Amazon S3** | Document | `documents` | Files in MinIO |

---

## Why This Approach?

### Reuse Existing Infrastructure ✅

1. **Documents Table:**
   - Already has ingestion pipeline
   - Already integrated with MinIO
   - Already has vector search (Qdrant)
   - Already supports AI chat
   - **Why reinvent?** Use it for document-based connectors.

2. **Integration Sources Table:**
   - Already stores connector configs
   - Already handles OAuth tokens
   - **Just extended it** with connector-specific fields.

### Generic Storage for Flexibility ✅

3. **Connector Data Table (JSONB):**
   - Different connectors = different schemas
   - **Example:** HubSpot contact has 50+ fields, Salesforce has 60+ fields
   - JSONB allows flexible schema without migrations
   - Full-text search via `tsvector` (auto-updated trigger)
   - Can query specific fields: `data->>'email'`, `data->>'company'`

### Avoid Schema Sprawl ❌

**Alternative (rejected):** Create dedicated schema for each connector
```sql
-- ❌ NOT DOING THIS:
CREATE SCHEMA hubspot;
CREATE TABLE hubspot.contacts (...50 columns...);
CREATE TABLE hubspot.deals (...40 columns...);
CREATE TABLE hubspot.companies (...30 columns...);

CREATE SCHEMA salesforce;
CREATE TABLE salesforce.accounts (...60 columns...);
CREATE TABLE salesforce.opportunities (...45 columns...);
-- ... and so on for 18 connectors
```

**Why rejected:**
- 18 connectors × 3-5 tables each = 54-90 tables
- Every connector schema change requires migration
- Harder to maintain
- Overkill for data ingestion use case

**We only use dedicated schemas for Tier 1 built-in connectors:**
- ActionStep (complex practice management workflows)
- Leadly/GoHighLevel (complex CRM workflows)

---

## Backward Compatibility

### Existing Data Unchanged ✅

- ActionStep schema (`actionstep.*`) - Not touched
- Leadly schema (`leadly.*`) - Not touched
- Documents table - Extended with nullable columns
- Integration sources - Extended with nullable columns
- **No breaking changes**

### Migration is Idempotent ✅

Safe to run multiple times:
```sql
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
```

---

## What's Next?

### Immediate (Database Complete ✅)

1. ✅ Migration script created
2. ✅ Migration tested and applied
3. ✅ Tables verified
4. ✅ Indexes created
5. ✅ Documentation complete

### Next Steps (Implementation)

6. ⏳ **Build connector services** - Implement Google Sheets sync logic
7. ⏳ **Create API endpoints** - CRUD for `integration_sources`
8. ⏳ **Implement OAuth flows** - Google, Microsoft, HubSpot
9. ⏳ **Build UI** - Connector management interface
10. ⏳ **AI integration** - Enable chat with connector data

---

## Migration Instructions

### For Production Deployment

```bash
# 1. Backup database
pg_dump lana_chef > lana_chef_backup_20251221.sql

# 2. Run migration
psql -d lana_chef -f src/migrations/20251221_connector_architecture_schema.sql

# 3. Verify
psql -d lana_chef -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'connector%';"

# Expected output:
#  table_name
# ---------------------
#  connector_data
#  connector_sync_logs
# (2 rows)

# 4. Verify integration_sources columns
psql -d lana_chef -c "\d public.integration_sources" | grep connector

# Expected output includes:
#  connector_id            | character varying(255)
#  connector_name          | character varying(255)
#  connector_category      | character varying(50)
#  sync_status             | character varying(50)
#  ... (and other new columns)
```

### Rollback Plan (if needed)

The migration is **additive only** (no DROP statements), so rollback is safe:

```bash
# Restore from backup
psql -d lana_chef < lana_chef_backup_20251221.sql
```

---

## Summary

### ✅ Question Answered

**Q:** "Do we need to make any changes to the database and tables and etc to support how we are going to implementing the connectors?"

**A:** **Yes - changes completed successfully:**

1. ✅ **Extended** `integration_sources` (9 new columns)
2. ✅ **Created** `connector_sync_logs` table
3. ✅ **Created** `connector_data` table
4. ✅ **Extended** `documents` table (4 new columns)
5. ✅ **Backward compatible** - no breaking changes
6. ✅ **Production ready** - tested and deployed

### Architecture Benefits

- ✅ **Reuses existing infrastructure** (documents table, ingestion pipeline)
- ✅ **Flexible storage** (JSONB for varying connector schemas)
- ✅ **Scalable** (generic framework for 18 connectors)
- ✅ **Maintainable** (avoids schema sprawl)
- ✅ **AI-ready** (full-text search, vector embeddings)

---

**Database schema is now ready for connector implementation!**

**Next:** Build connector services and API endpoints.

---

**Migration File:** `/src/migrations/20251221_connector_architecture_schema.sql`
**Documentation:** `/docs/connectors/database-architecture.md`
**Status:** ✅ Complete
**Last Updated:** 2025-12-21

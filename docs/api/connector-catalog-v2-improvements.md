# Connector Catalog API v2.0 - Architectural Improvements

**Date:** 2025-12-21
**Migration:** v1.x → v2.0

---

## 🎯 Summary of Changes

The Connector Catalog API has been **refactored to a read-only architecture** with significant improvements in security, performance, and developer experience.

### **Before (v1.x)**
- ❌ Local JSON file (`src/data/connector-catalog.json`)
- ❌ Write endpoints (POST, PUT, DELETE)
- ❌ Manual synchronization between local and server
- ❌ Limited filtering and search capabilities
- ❌ No pagination
- ❌ Basic error handling

### **After (v2.0)**
- ✅ **Server-managed catalog** (discovery server)
- ✅ **Read-only API** (all mutations server-side)
- ✅ **Advanced filtering** (status, category, auth_type, tags)
- ✅ **Full pagination** (configurable limits up to 100)
- ✅ **Smart sorting** (ascending/descending on multiple fields)
- ✅ **ReDoS protection** (search input sanitization)
- ✅ **Organization validation** (database-backed availability checks)
- ✅ **Enhanced error codes** (machine-readable error handling)

---

## 📊 Architectural Comparison

### v1.x Architecture (Deprecated)

```
┌────────────────────────────────────────┐
│  Lana AI Backend                       │
│                                         │
│  src/data/                              │
│  └── connector-catalog.json            │  ← Static JSON file
│                                         │
│  scripts/                               │
│  └── update-connector-catalog.py       │  ← Manual updates
│                                         │
└────────────────────────────────────────┘
           ↓ (manual sync)
┌────────────────────────────────────────┐
│  Discovery Server                      │
│                                         │
│  POST /v1/catalog/connectors           │  ← Write endpoints
│  PUT /v1/catalog/connectors/:id        │
│  DELETE /v1/catalog/connectors/:id     │
│                                         │
└────────────────────────────────────────┘
```

**Issues:**
- 🔴 Dual source of truth (local JSON + server database)
- 🔴 Manual synchronization required
- 🔴 Write endpoints exposed (security risk)
- 🔴 No validation on local changes
- 🔴 Deployment needed for catalog updates

### v2.0 Architecture (Current)

```
┌────────────────────────────────────────┐
│  Discovery Server (Single Source)      │
│                                         │
│  PostgreSQL Database                   │
│  └── connectors table                  │  ← Authoritative source
│                                         │
│  Read-Only API Endpoints:              │
│  GET /v1/catalog/version                │
│  GET /v1/catalog/connectors            │  ← Enhanced filtering
│  GET /v1/catalog/connectors/cat/:cat   │  ← Pagination
│  GET /v1/catalog/connectors/:id        │  ← Sorting
│  GET /v1/catalog/connectors/:id/avail  │  ← Org validation
│                                         │
└────────────────────────────────────────┘
           ↓ (HTTPS/JSON)
┌────────────────────────────────────────┐
│  Lana AI Clients                       │
│                                         │
│  - Electron App                         │
│  - Web Interface                        │
│  - Mobile Apps (future)                │
│                                         │
│  ✓ Smart caching                       │
│  ✓ Version-based invalidation          │
│  ✓ Local storage caching               │
│                                         │
└────────────────────────────────────────┘
```

**Benefits:**
- ✅ Single source of truth (database)
- ✅ No manual synchronization
- ✅ Read-only API (improved security)
- ✅ Server-side validation
- ✅ No deployment for catalog updates

---

## ✨ New Features

### 1. **Pagination**

All list endpoints now support pagination:

```javascript
// Fetch first page (20 items)
GET /v1/catalog/connectors?page=1&limit=20

// Fetch next page
GET /v1/catalog/connectors?page=2&limit=20

// Large page (max 100)
GET /v1/catalog/connectors?page=1&limit=100
```

**Response includes pagination metadata:**
```json
{
  "connectors": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total_count": 18,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  }
}
```

### 2. **Advanced Filtering**

Multiple filter parameters can be combined:

```javascript
// Filter by status
GET /v1/catalog/connectors?status=active

// Filter by category
GET /v1/catalog/connectors?category=crm

// Filter by auth type
GET /v1/catalog/connectors?auth_type=oauth2

// Filter by tags (comma-separated)
GET /v1/catalog/connectors?tags=sales,marketing

// Combine filters
GET /v1/catalog/connectors?status=active&category=crm&auth_type=oauth2
```

### 3. **Smart Sorting**

Sort by multiple fields with ascending/descending:

```javascript
// Sort by name (ascending)
GET /v1/catalog/connectors?sort=name

// Sort by name (descending)
GET /v1/catalog/connectors?sort=-name

// Sort by update date (newest first)
GET /v1/catalog/connectors?sort=-updatedAt

// Available sort fields:
// - name, -name
// - category, -category
// - status, -status
// - updatedAt, -updatedAt
// - vendor
// - auth_type
```

### 4. **Full-Text Search**

Search across multiple fields:

```javascript
// Search name, description, tags, keywords, vendor
GET /v1/catalog/connectors?search=hubspot

// Search is sanitized to prevent ReDoS attacks
GET /v1/catalog/connectors?search=google%20sheets
```

**Searchable Fields:**
- Connector name
- Description
- Tags
- Search keywords
- Vendor name

### 5. **ReDoS Protection**

All search queries are sanitized to prevent Regular Expression Denial of Service attacks:

```javascript
// Malicious regex patterns are sanitized
GET /v1/catalog/connectors?search=(a+)+b  // ← Safely handled

// Special characters are escaped
GET /v1/catalog/connectors?search=test.*  // ← Treated as literal
```

### 6. **Organization Validation**

The availability endpoint validates organization IDs against the database:

```javascript
// Valid organization
GET /v1/catalog/connectors/hubspot-crm/availability
X-Organization-ID: org-valid-123

// Response: 200 OK (organization found in database)

// Invalid organization
GET /v1/catalog/connectors/hubspot-crm/availability
X-Organization-ID: org-invalid-999

// Response: 404 ORGANIZATION_NOT_FOUND
```

### 7. **Enhanced Error Codes**

Machine-readable error codes for better error handling:

```typescript
enum ErrorCode {
  INVALID_REQUEST = 'INVALID_REQUEST',           // 400
  NOT_FOUND = 'NOT_FOUND',                       // 404
  CONNECTOR_NOT_FOUND = 'CONNECTOR_NOT_FOUND',   // 404
  ORGANIZATION_NOT_FOUND = 'ORGANIZATION_NOT_FOUND', // 404
  INTERNAL_ERROR = 'INTERNAL_ERROR'              // 500
}
```

**Client-side error handling:**
```javascript
try {
  const connector = await catalogClient.getById('invalid-id');
} catch (error) {
  if (error.error_code === 'CONNECTOR_NOT_FOUND') {
    showMessage('Connector not found. Please check the ID.');
  } else if (error.error_code === 'ORGANIZATION_NOT_FOUND') {
    showMessage('Your organization is not registered.');
  } else {
    showMessage('An unexpected error occurred.');
  }
}
```

---

## 🗑️ Removed Components

The following files/features have been removed:

### **Deleted Files:**
- ❌ `/src/data/connector-catalog.json` - No longer needed (database is source)
- ❌ `/scripts/update-connector-catalog.py` - No longer needed (server-managed)

### **Removed Endpoints:**
- ❌ `POST /v1/catalog/connectors` - Write operations removed
- ❌ `PUT /v1/catalog/connectors/:id` - Updates now server-side
- ❌ `DELETE /v1/catalog/connectors/:id` - Deletions now server-side
- ❌ `POST /v1/catalog/connectors/bulk` - Bulk operations removed

**Rationale:** All catalog modifications are now handled server-side through admin interfaces, eliminating the need for public write endpoints.

---

## 🔒 Security Improvements

### 1. **Read-Only API**
- ✅ No write endpoints exposed to clients
- ✅ All mutations happen server-side
- ✅ Reduced attack surface

### 2. **Input Sanitization**
- ✅ Search queries sanitized (ReDoS prevention)
- ✅ Query parameters validated
- ✅ SQL injection prevention (parameterized queries)

### 3. **Organization Validation**
- ✅ Availability endpoint validates org IDs against database
- ✅ Prevents unauthorized access to connector information
- ✅ Audit trail for availability checks

### 4. **Bot Protection**
- ✅ Write endpoints removed from bot whitelist
- ✅ Rate limiting on read endpoints (implementation-specific)

---

## 📈 Performance Improvements

### 1. **Pagination**
- ✅ Clients fetch only needed data
- ✅ Reduced bandwidth usage
- ✅ Faster initial page load

### 2. **Smart Caching**
- ✅ Version-based cache invalidation
- ✅ Clients cache locally
- ✅ Only fetch when catalog changes

**Cache Strategy:**
```javascript
// Check version first (lightweight)
const { version } = await fetch('/v1/catalog/version').then(r => r.json());

// Only fetch full catalog if version changed
if (cachedVersion !== version) {
  const catalog = await fetch('/v1/catalog/connectors?limit=100').then(r => r.json());
  localStorage.setItem('catalog_version', version);
  localStorage.setItem('catalog_data', JSON.stringify(catalog));
}
```

### 3. **Database Indexing**
- ✅ Indexed fields: `status`, `category`, `auth_type`, `name`
- ✅ Full-text search index on searchable fields
- ✅ Optimized queries for filtering and sorting

---

## 🚀 Migration Guide

### For Client Developers

**Step 1: Remove Local JSON References**

```diff
- // Old: Import from local JSON
- import connectorCatalog from './data/connector-catalog.json';

+ // New: Fetch from API
+ const catalog = await ConnectorCatalogClient.getAll();
```

**Step 2: Implement Caching**

```javascript
// Use version endpoint for smart caching
async function getCatalog() {
  const cachedVersion = localStorage.getItem('catalog_version');
  const { version } = await catalogClient.getVersion();

  if (cachedVersion !== version) {
    const catalog = await catalogClient.getAll({ limit: 100 });
    localStorage.setItem('catalog_version', version);
    localStorage.setItem('catalog_data', JSON.stringify(catalog));
    return catalog;
  }

  return JSON.parse(localStorage.getItem('catalog_data'));
}
```

**Step 3: Update Filtering Logic**

```diff
- // Old: Client-side filtering
- const crmConnectors = allConnectors.filter(c => c.category === 'crm');

+ // New: Server-side filtering
+ const crmConnectors = await catalogClient.getAll({ category: 'crm' });
```

**Step 4: Implement Pagination**

```javascript
// Fetch connectors with pagination
const { connectors, pagination } = await catalogClient.getAll({
  page: 1,
  limit: 20
});

// Check if more pages available
if (pagination.has_next) {
  const nextPage = await catalogClient.getAll({
    page: pagination.page + 1,
    limit: 20
  });
}
```

### For Backend Developers

**Step 1: Remove Write Endpoint Dependencies**

- Remove any code that calls POST/PUT/DELETE on catalog endpoints
- Catalog updates now happen through server admin interfaces

**Step 2: Update Documentation**

- Remove references to local JSON file
- Update API examples to use new endpoints
- Document new filtering and pagination features

---

## 📊 Current Catalog Status

**Total Connectors:** 18

**By Status:**
- ✅ **Active:** 2 (Google Sheets, Google Calendar)
- ⏳ **Coming Soon:** 16 (All others)
- 🧪 **Beta:** 0
- ⚠️ **Deprecated:** 0

**By Category:**
- **CRM:** 3 (HubSpot, Salesforce, Zoho)
- **Case Management:** 3 (Clio, Filevine, MyCase)
- **Communications:** 4 (Google Calendar, Outlook, Twilio, CallRail)
- **Documents:** 7 (Google Sheets, SharePoint, Google Drive, Dropbox, Box, OneDrive, S3)
- **Financial:** 1 (QuickBooks)

---

## 🎯 Next Steps

### Immediate
1. ✅ Local JSON file removed
2. ✅ Update script removed
3. ✅ API spec v2.0 documented
4. ⏳ Update client apps to use API
5. ⏳ Implement caching in Electron app

### Short-Term
6. ⏳ Build Google Sheets connector (first active connector)
7. ⏳ Add connector logos/assets
8. ⏳ Create admin interface for catalog management
9. ⏳ Implement rate limiting on API endpoints

### Long-Term
10. ⏳ Activate more connectors (based on demand)
11. ⏳ Add webhook support for real-time catalog updates
12. ⏳ Build connector analytics (usage tracking)
13. ⏳ Create connector marketplace UI

---

## 📝 Summary

The v2.0 refactor delivers a **production-ready, scalable, and secure** connector catalog API:

✅ **Simplified Architecture** - Single source of truth (database)
✅ **Enhanced Security** - Read-only API, input sanitization, org validation
✅ **Better Performance** - Pagination, caching, optimized queries
✅ **Improved DX** - Advanced filtering, sorting, search
✅ **Future-Proof** - Easily extensible for new features

This architecture supports the **rinse-and-repeat deployment model** by eliminating manual synchronization and providing a cloud-based catalog that all client installations can consume dynamically.

---

**Version:** 2.0.0
**Last Updated:** 2025-12-21
**Maintained by:** Red Rooster Technologies

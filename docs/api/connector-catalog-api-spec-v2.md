# Connector Catalog API Specification v2.0

**Version:** 2.0.0 (Read-Only API)
**Last Updated:** 2025-12-21
**Base URL:** `https://your-domain.com/lana-ai/v1/catalog`

---

## Overview

The Connector Catalog API provides **read-only access** to available data connectors for the Lana AI platform. This API enables:

- **Dynamic Connector Discovery** - Client apps fetch available connectors without hardcoding
- **Smart Caching** - Version-based cache invalidation
- **Advanced Filtering** - Search, sort, and filter by multiple criteria
- **Organization-Specific Access** - Check connector availability per organization
- **Pagination** - Efficiently handle large connector lists

**Key Features:**
- ✅ Read-only (all mutations handled server-side)
- ✅ Pagination with configurable limits (max 100)
- ✅ Multi-field filtering (status, category, auth_type, tags)
- ✅ Sorting with ascending/descending support
- ✅ Full-text search with ReDoS protection
- ✅ Organization validation against database

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Discovery Server                        │
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  Connector Catalog API                      │        │
│  │  /lana-ai/v1/catalog/*                      │        │
│  │                                               │        │
│  │  - Read-only endpoints                      │        │
│  │  - Database-backed (PostgreSQL)             │        │
│  │  - Auto-managed by server                   │        │
│  └─────────────────────────────────────────────┘        │
│                                                           │
└─────────────────────────────────────────────────────────┘
                          ↓
                    HTTPS / JSON
                          ↓
┌─────────────────────────────────────────────────────────┐
│              Lana AI Client Applications                 │
│                                                           │
│  - Electron Desktop App                                  │
│  - Web Interface                                          │
│  - Mobile Apps (future)                                   │
└─────────────────────────────────────────────────────────┘
```

---

## Endpoints

### 1. GET /version

Get catalog metadata for cache invalidation.

**Endpoint:** `GET /lana-ai/v1/catalog/version`

**Authentication:** Public (no auth required)

**Response (200 OK):**
```json
{
  "version": "1.1.0",
  "last_updated": "2025-12-21T15:30:00.000Z",
  "total_connectors": 18,
  "active_connectors": 2,
  "coming_soon_connectors": 16,
  "beta_connectors": 0,
  "deprecated_connectors": 0,
  "categories": ["crm", "case", "communications", "documents", "financial"],
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

**Use Case - Client-Side Caching:**
```javascript
async function checkCatalogUpdate() {
  const cachedVersion = localStorage.getItem('catalog_version');
  const { version } = await fetch('/lana-ai/v1/catalog/version').then(r => r.json());

  if (cachedVersion !== version) {
    // Catalog updated - refresh
    const catalog = await fetchCatalog();
    localStorage.setItem('catalog_version', version);
    localStorage.setItem('catalog_data', JSON.stringify(catalog));
    return catalog;
  }

  // Use cached data
  return JSON.parse(localStorage.getItem('catalog_data'));
}
```

---

### 2. GET /connectors

Get all connectors with filtering, search, sorting, and pagination.

**Endpoint:** `GET /lana-ai/v1/catalog/connectors`

**Authentication:** Public (no auth required)

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `all` | Filter: `active`, `coming_soon`, `beta`, `deprecated`, `all` |
| `category` | string | `all` | Filter: `crm`, `case`, `communications`, `documents`, `financial`, `all` |
| `auth_type` | string | - | Filter: `oauth2`, `api_key`, `basic`, `custom` |
| `tags` | string | - | Comma-separated tags: `sales,marketing` |
| `search` | string | - | Search name, description, tags, keywords, vendor |
| `sort` | string | `name` | Sort field. Prefix with `-` for descending:<br>• `name`, `-name`<br>• `category`, `-category`<br>• `status`, `-status`<br>• `updatedAt`, `-updatedAt`<br>• `vendor`, `auth_type` |
| `page` | number | `1` | Page number (1-indexed) |
| `limit` | number | `20` | Items per page (max: 100) |

**Example Request:**
```bash
curl "https://your-domain.com/lana-ai/v1/catalog/connectors?status=active&category=crm&search=hub&sort=-name&page=1&limit=20"
```

**Response (200 OK):**
```json
{
  "version": "1.1.0",
  "last_updated": "2025-12-21T15:30:00.000Z",
  "connectors": [
    {
      "id": "hubspot-crm",
      "name": "HubSpot",
      "category": "crm",
      "status": "coming_soon",
      "description": "Sync contacts, companies, deals...",
      "logo_url": "/images/connectors/hubspot.svg",
      "vendor": "HubSpot",
      "documentation_url": "https://developers.hubspot.com/",
      "auth_type": "oauth2",
      "capabilities": ["contacts", "companies", "deals", "activities"],
      "tags": ["sales", "marketing", "enterprise"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total_count": 18,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

---

### 3. GET /connectors/category/:category

Get connectors by category with pagination.

**Endpoint:** `GET /lana-ai/v1/catalog/connectors/category/:category`

**Authentication:** Public (no auth required)

**Path Parameters:**

| Parameter | Required | Values |
|-----------|----------|--------|
| `category` | Yes | `crm`, `case`, `communications`, `documents`, `financial` |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sort` | string | `name` | Sort: `name`, `-name`, `status`, `-status`, `updatedAt`, `-updatedAt`, `vendor` |
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Items per page (max: 100) |

**Example Request:**
```bash
curl "https://your-domain.com/lana-ai/v1/catalog/connectors/category/crm?sort=name&page=1&limit=20"
```

**Response (200 OK):**
```json
{
  "category": "crm",
  "connectors": [
    {
      "id": "hubspot-crm",
      "name": "HubSpot",
      "status": "coming_soon",
      "description": "Sync contacts, companies, deals...",
      "logo_url": "/images/connectors/hubspot.svg",
      "vendor": "HubSpot",
      "auth_type": "oauth2",
      "tags": ["sales", "marketing"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total_count": 5,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

**Error (400 Bad Request):**
```json
{
  "error": "Invalid category",
  "error_code": "INVALID_REQUEST",
  "valid_categories": ["crm", "case", "communications", "documents", "financial"],
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

---

### 4. GET /connectors/:connector_id

Get detailed connector information.

**Endpoint:** `GET /lana-ai/v1/catalog/connectors/:connector_id`

**Authentication:** Public (no auth required)

**Path Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `connector_id` | Yes | Unique connector identifier (e.g., `hubspot-crm`) |

**Example Request:**
```bash
curl "https://your-domain.com/lana-ai/v1/catalog/connectors/hubspot-crm"
```

**Response (200 OK):**
```json
{
  "connector": {
    "id": "hubspot-crm",
    "name": "HubSpot",
    "category": "crm",
    "status": "coming_soon",
    "description": "Sync contacts, companies, deals, and activities from HubSpot CRM.",
    "logo_url": "/images/connectors/hubspot.svg",
    "vendor": "HubSpot",
    "documentation_url": "https://developers.hubspot.com/",
    "auth_type": "oauth2",
    "oauth_config": {
      "authorize_url": "https://app.hubspot.com/oauth/authorize",
      "token_url": "https://api.hubapi.com/oauth/v1/token",
      "scopes": ["crm.objects.contacts.read", "crm.objects.companies.read"],
      "requires_client_credentials": true
    },
    "capabilities": ["contacts", "companies", "deals", "activities"],
    "sync_frequency": {
      "options": ["realtime", "hourly", "daily"],
      "default": "hourly"
    },
    "configuration_schema": {
      "type": "object",
      "properties": {
        "portal_id": { "type": "string", "title": "Portal ID" },
        "sync_contacts": { "type": "boolean", "default": true }
      },
      "required": ["portal_id"]
    },
    "field_mappings": {
      "contacts": { "email": "email", "first_name": "firstname" }
    },
    "tags": ["sales", "marketing", "enterprise"],
    "search_keywords": ["hubspot", "crm", "contacts", "deals"],
    "rate_limits": {
      "requests_per_minute": 100,
      "requests_per_day": 250000
    },
    "prerequisites": ["HubSpot account", "API access enabled"],
    "webhook_config": {
      "supported_events": ["contact.created", "deal.updated"],
      "registration_required": true
    }
  },
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

**Error (404 Not Found):**
```json
{
  "error": "Connector not found",
  "error_code": "NOT_FOUND",
  "connector_id": "invalid-connector",
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

---

### 5. GET /connectors/:connector_id/availability

Check if a connector is available for an organization.

**Endpoint:** `GET /lana-ai/v1/catalog/connectors/:connector_id/availability`

**Authentication:** Requires `X-Organization-ID` header

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `X-Organization-ID` | Yes | Organization identifier (validated against database) |

**Path Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `connector_id` | Yes | Unique connector identifier |

**Example Request:**
```bash
curl "https://your-domain.com/lana-ai/v1/catalog/connectors/hubspot-crm/availability" \
  -H "X-Organization-ID: org-123"
```

**Response (200 OK - Available):**
```json
{
  "connector_id": "hubspot-crm",
  "connector_name": "HubSpot",
  "organization_id": "org-123",
  "organization_name": "Acme Corp",
  "available": true,
  "status": "active",
  "enabled_features": ["contacts", "companies", "deals"],
  "restrictions": [],
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

**Response (200 OK - Not Available):**
```json
{
  "connector_id": "hubspot-crm",
  "connector_name": "HubSpot",
  "organization_id": "org-123",
  "organization_name": "Acme Corp",
  "available": false,
  "status": "coming_soon",
  "enabled_features": ["contacts", "companies", "deals"],
  "restrictions": ["Connector is not yet available"],
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

**Error (400 Bad Request - Missing Header):**
```json
{
  "error": "X-Organization-ID header is required",
  "error_code": "INVALID_REQUEST",
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

**Error (404 Not Found - Organization):**
```json
{
  "error": "Organization not found",
  "error_code": "ORGANIZATION_NOT_FOUND",
  "organization_id": "invalid-org",
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

**Error (404 Not Found - Connector):**
```json
{
  "error": "Connector not found",
  "error_code": "CONNECTOR_NOT_FOUND",
  "connector_id": "invalid-connector",
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

---

## Error Response Format

All endpoints return errors in this consistent format:

```json
{
  "error": "Human-readable error message",
  "error_code": "MACHINE_READABLE_CODE",
  "metadata": {
    "timestamp": "2025-12-21T15:30:00.000Z",
    "request_id": "req_abc123"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_REQUEST` | 400 | Bad request parameters or malformed input |
| `NOT_FOUND` | 404 | Generic resource not found |
| `CONNECTOR_NOT_FOUND` | 404 | Specific connector not found |
| `ORGANIZATION_NOT_FOUND` | 404 | Organization ID doesn't exist in database |
| `INTERNAL_ERROR` | 500 | Server error (logged and monitored) |

---

## Data Models

### Enums

**Status:**
```typescript
type ConnectorStatus = 'active' | 'coming_soon' | 'beta' | 'deprecated';
```

**Category:**
```typescript
type ConnectorCategory = 'crm' | 'case' | 'communications' | 'documents' | 'financial';
```

**Auth Type:**
```typescript
type AuthType = 'oauth2' | 'api_key' | 'basic' | 'custom';
```

### Connector Object

```typescript
interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  description: string;
  logo_url: string;
  vendor: string;
  documentation_url: string;
  auth_type: AuthType;
  oauth_config?: OAuthConfig;
  capabilities: string[];
  sync_frequency: SyncFrequency;
  configuration_schema: JSONSchema;
  field_mappings: FieldMappings;
  tags: string[];
  search_keywords: string[];
  rate_limits: RateLimits;
  prerequisites: string[];
  webhook_config?: WebhookConfig;
}
```

---

## Security Features

### ReDoS Protection
All search queries are sanitized to prevent Regular Expression Denial of Service attacks.

### Organization Validation
The availability endpoint validates organization IDs against the database to ensure only legitimate organizations can check connector availability.

### Rate Limiting
*(Implementation-specific - document your rate limits here)*

---

## Client Implementation Example

```javascript
class ConnectorCatalogClient {
  constructor(baseUrl = 'https://your-domain.com/lana-ai/v1/catalog') {
    this.baseUrl = baseUrl;
  }

  async getVersion() {
    const response = await fetch(`${this.baseUrl}/version`);
    return response.json();
  }

  async getAll({ status, category, authType, tags, search, sort, page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (category) params.append('category', category);
    if (authType) params.append('auth_type', authType);
    if (tags) params.append('tags', tags);
    if (search) params.append('search', search);
    if (sort) params.append('sort', sort);
    params.append('page', page);
    params.append('limit', limit);

    const response = await fetch(`${this.baseUrl}/connectors?${params}`);
    return response.json();
  }

  async getById(connectorId) {
    const response = await fetch(`${this.baseUrl}/connectors/${connectorId}`);
    return response.json();
  }

  async getByCategory(category, { sort, page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams();
    if (sort) params.append('sort', sort);
    params.append('page', page);
    params.append('limit', limit);

    const response = await fetch(`${this.baseUrl}/connectors/category/${category}?${params}`);
    return response.json();
  }

  async checkAvailability(connectorId, organizationId) {
    const response = await fetch(
      `${this.baseUrl}/connectors/${connectorId}/availability`,
      {
        headers: {
          'X-Organization-ID': organizationId
        }
      }
    );
    return response.json();
  }

  // Smart caching example
  async getCachedCatalog() {
    const cachedVersion = localStorage.getItem('catalog_version');
    const { version } = await this.getVersion();

    if (cachedVersion !== version) {
      const catalog = await this.getAll({ limit: 100 });
      localStorage.setItem('catalog_version', version);
      localStorage.setItem('catalog_data', JSON.stringify(catalog));
      return catalog;
    }

    return JSON.parse(localStorage.getItem('catalog_data'));
  }
}
```

---

## Migration Notes

### From v1.x to v2.0

**Breaking Changes:**
- ❌ Removed all write endpoints (POST, PUT, DELETE)
- ❌ Catalog is now read-only (managed server-side)
- ❌ Local JSON file no longer used

**New Features:**
- ✅ Added pagination to all list endpoints
- ✅ Added advanced filtering (auth_type, tags)
- ✅ Added sorting with ascending/descending
- ✅ Enhanced search with ReDoS protection
- ✅ Organization validation in availability endpoint

**Migration Steps:**
1. Remove local catalog JSON file
2. Update client code to use API endpoints
3. Implement caching using `/version` endpoint
4. Update any hardcoded connector lists

---

**Last Updated:** 2025-12-21
**Version:** 2.0.0
**Maintained by:** Red Rooster Technologies

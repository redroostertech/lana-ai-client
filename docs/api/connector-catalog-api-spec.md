# Connector Catalog API Specification

**Version:** 1.1.0
**Last Updated:** 2025-12-19
**Base URL:** `https://api.lanaai.com` (same as login discovery endpoint)

---

## Overview

The Connector Catalog API provides cloud-based discovery and metadata for data connectors available in the Lana AI platform. This allows client applications to dynamically discover connectors without requiring app redeployment.

**Key Features:**
- Cloud-hosted connector metadata
- Dynamic connector discovery
- Version-controlled catalog
- Organization-specific connector availability
- OAuth configuration details

---

## Authentication

All endpoints require authentication via JWT token obtained during login.

```
Authorization: Bearer <jwt_token>
```

**Exceptions:**
- `/catalog/connectors/public` - Public connector listing (no auth required)

---

## Endpoints

### 1. Get All Connectors

Retrieve the complete connector catalog.

```
GET /api/v1/catalog/connectors
```

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `status` | string | No | all | Filter by status: `active`, `coming_soon`, `deprecated`, `all` |
| `category` | string | No | all | Filter by category: `crm`, `case`, `communications`, `documents`, `financial`, `all` |
| `search` | string | No | - | Search connectors by name or description |

**Example Request:**
```bash
curl -X GET "https://api.lanaai.com/api/v1/catalog/connectors?status=coming_soon&category=crm" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200 OK):**
```json
{
  "version": "1.1.0",
  "last_updated": "2025-12-19T10:30:00Z",
  "total_count": 18,
  "connectors": [
    {
      "id": "hubspot-crm",
      "name": "HubSpot",
      "category": "crm",
      "status": "coming_soon",
      "description": "Connect HubSpot CRM to sync contacts, deals, companies...",
      "logo_url": "/assets/connectors/hubspot-logo.png",
      "vendor": "HubSpot, Inc.",
      "documentation_url": "https://docs.lanaai.com/connectors/hubspot",
      "auth_type": "oauth2",
      "capabilities": [
        "contacts_sync",
        "companies_sync",
        "deals_sync",
        "bidirectional_sync",
        "real_time_webhooks"
      ],
      "tags": ["crm", "sales", "marketing", "contacts", "deals"],
      "search_keywords": ["hubspot", "crm", "contact management", "deal tracking", "pipeline"],
      "rate_limits": {
        "requests_per_minute": 100,
        "requests_per_day": 250000,
        "note": "Varies by HubSpot subscription tier"
      },
      "prerequisites": [
        "Active HubSpot account (Professional or Enterprise tier recommended)",
        "HubSpot Super Admin access for OAuth app setup",
        "OAuth app registered in HubSpot Developer Portal"
      ]
    }
  ],
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc123"
  }
}
```

---

### 2. Get Connector by ID

Retrieve detailed information for a specific connector.

```
GET /api/v1/catalog/connectors/:connector_id
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `connector_id` | string | Yes | Unique connector identifier (e.g., `hubspot-crm`) |

**Example Request:**
```bash
curl -X GET "https://api.lanaai.com/api/v1/catalog/connectors/hubspot-crm" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200 OK):**
```json
{
  "connector": {
    "id": "hubspot-crm",
    "name": "HubSpot",
    "category": "crm",
    "status": "coming_soon",
    "description": "Connect HubSpot CRM to sync contacts, deals, companies, and communication history with your legal practice management system.",
    "logo_url": "/assets/connectors/hubspot-logo.png",
    "vendor": "HubSpot, Inc.",
    "documentation_url": "https://docs.lanaai.com/connectors/hubspot",
    "auth_type": "oauth2",
    "oauth_config": {
      "authorize_url": "https://app.hubspot.com/oauth/authorize",
      "token_url": "https://api.hubapi.com/oauth/v1/token",
      "scopes": [
        "crm.objects.contacts.read",
        "crm.objects.contacts.write",
        "crm.objects.companies.read",
        "crm.objects.deals.read"
      ],
      "requires_client_credentials": true
    },
    "capabilities": [
      "contacts_sync",
      "companies_sync",
      "deals_sync",
      "bidirectional_sync",
      "real_time_webhooks"
    ],
    "sync_frequency": {
      "options": ["manual", "hourly", "daily", "real_time"],
      "default": "hourly"
    },
    "configuration_schema": {
      "type": "object",
      "required": ["client_id", "client_secret", "portal_id"],
      "properties": {
        "client_id": {
          "type": "string",
          "label": "HubSpot Client ID",
          "description": "OAuth Client ID from HubSpot app settings"
        },
        "client_secret": {
          "type": "string",
          "label": "HubSpot Client Secret",
          "description": "OAuth Client Secret from HubSpot app settings",
          "secret": true
        },
        "portal_id": {
          "type": "string",
          "label": "Portal ID",
          "description": "Your HubSpot Portal ID (Hub ID)"
        }
      }
    },
    "field_mappings": {
      "contacts": {
        "hubspot_id": "external_id",
        "email": "email",
        "firstname": "first_name",
        "lastname": "last_name",
        "phone": "phone",
        "company": "company_name"
      }
    },
    "tags": ["crm", "sales", "marketing", "contacts", "deals"],
    "search_keywords": ["hubspot", "crm", "contact management", "deal tracking", "pipeline", "sales automation"],
    "rate_limits": {
      "requests_per_minute": 100,
      "requests_per_day": 250000,
      "note": "Varies by HubSpot subscription tier"
    },
    "prerequisites": [
      "Active HubSpot account (Professional or Enterprise tier recommended)",
      "HubSpot Super Admin access for OAuth app setup",
      "OAuth app registered in HubSpot Developer Portal"
    ],
    "webhook_config": {
      "supported_events": [
        "contact.created",
        "contact.updated",
        "contact.deleted",
        "deal.created",
        "deal.updated",
        "deal.deleted",
        "company.created",
        "company.updated"
      ],
      "registration_required": true,
      "webhook_url_template": "https://{backend-url}/api/v1/webhooks/hubspot/{organization_id}"
    }
  },
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc124"
  }
}
```

**Response (404 Not Found):**
```json
{
  "error": "Connector not found",
  "connector_id": "invalid-connector",
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc125"
  }
}
```

---

### 3. Get Connectors by Category

Retrieve all connectors in a specific category.

```
GET /api/v1/catalog/connectors/category/:category
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | Yes | Category: `crm`, `case`, `communications`, `documents`, `financial` |

**Example Request:**
```bash
curl -X GET "https://api.lanaai.com/api/v1/catalog/connectors/category/crm" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200 OK):**
```json
{
  "category": "crm",
  "total_count": 3,
  "connectors": [
    {
      "id": "hubspot-crm",
      "name": "HubSpot",
      "status": "coming_soon",
      "description": "Connect HubSpot CRM to sync contacts...",
      "logo_url": "/assets/connectors/hubspot-logo.png"
    },
    {
      "id": "salesforce-crm",
      "name": "Salesforce",
      "status": "coming_soon",
      "description": "Integrate Salesforce CRM to manage leads...",
      "logo_url": "/assets/connectors/salesforce-logo.png"
    },
    {
      "id": "zoho-crm",
      "name": "Zoho CRM",
      "status": "coming_soon",
      "description": "Connect Zoho CRM to synchronize leads...",
      "logo_url": "/assets/connectors/zoho-logo.png"
    }
  ],
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc126"
  }
}
```

---

### 4. Check Connector Availability

Check if a connector is available for a specific organization.

```
GET /api/v1/catalog/connectors/:connector_id/availability
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `connector_id` | string | Yes | Unique connector identifier |

**Headers:**
```
Authorization: Bearer <jwt_token>
X-Organization-ID: <organization_uuid>
```

**Example Request:**
```bash
curl -X GET "https://api.lanaai.com/api/v1/catalog/connectors/hubspot-crm/availability" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "X-Organization-ID: org-123-456-789"
```

**Response (200 OK):**
```json
{
  "connector_id": "hubspot-crm",
  "organization_id": "org-123-456-789",
  "available": true,
  "status": "coming_soon",
  "enabled_features": [
    "contacts_sync",
    "companies_sync",
    "deals_sync"
  ],
  "restrictions": [],
  "pricing_tier": "enterprise",
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc127"
  }
}
```

**Response (403 Forbidden):**
```json
{
  "error": "Connector not available for organization",
  "connector_id": "hubspot-crm",
  "organization_id": "org-123-456-789",
  "reason": "Requires enterprise tier subscription",
  "upgrade_url": "https://lanaai.com/pricing",
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc128"
  }
}
```

---

### 5. Get Catalog Version

Retrieve the current catalog version for cache invalidation.

```
GET /api/v1/catalog/version
```

**No authentication required** - Public endpoint

**Example Request:**
```bash
curl -X GET "https://api.lanaai.com/api/v1/catalog/version"
```

**Response (200 OK):**
```json
{
  "version": "1.0.0",
  "last_updated": "2025-12-19T10:30:00Z",
  "total_connectors": 19,
  "active_connectors": 2,
  "coming_soon_connectors": 17,
  "deprecated_connectors": 0,
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc129"
  }
}
```

---

## Data Models

### Connector Object

```typescript
interface Connector {
  id: string;                           // Unique identifier (e.g., "hubspot-crm")
  name: string;                         // Display name (e.g., "HubSpot")
  category: ConnectorCategory;          // Category classification
  status: ConnectorStatus;              // Current availability status
  description: string;                  // Detailed description
  logo_url: string;                     // Path to connector logo
  vendor: string;                       // Vendor/provider name
  documentation_url: string;            // Link to documentation
  auth_type: AuthType;                  // Authentication method
  oauth_config?: OAuthConfig;           // OAuth configuration (if oauth2)
  capabilities: string[];               // List of capabilities
  sync_frequency: SyncFrequency;        // Sync options
  configuration_schema: JSONSchema;     // Configuration form schema
  field_mappings: FieldMappings;        // Data field mappings
  tags: string[];                       // Category/feature tags for filtering
  search_keywords: string[];            // Keywords for marketplace search
  rate_limits: RateLimits;              // API rate limiting information
  prerequisites: string[];              // Setup requirements
  webhook_config?: WebhookConfig;       // Webhook configuration (if supported)
}

interface RateLimits {
  requests_per_minute: number;          // Requests allowed per minute
  requests_per_day: number;             // Requests allowed per day
  note?: string;                        // Additional rate limit context
}

interface WebhookConfig {
  supported_events: string[];           // List of webhook event types
  registration_required: boolean;       // Whether webhook registration is required
  webhook_url_template: string;         // URL template for webhook endpoint
  note?: string;                        // Additional webhook context
}

enum ConnectorCategory {
  CRM = "crm",
  CASE = "case",
  COMMUNICATIONS = "communications",
  DOCUMENTS = "documents",
  FINANCIAL = "financial"
}

enum ConnectorStatus {
  ACTIVE = "active",
  COMING_SOON = "coming_soon",
  BETA = "beta",
  DEPRECATED = "deprecated"
}

enum AuthType {
  OAUTH2 = "oauth2",
  API_KEY = "api_key",
  BASIC = "basic",
  CUSTOM = "custom"
}

interface OAuthConfig {
  authorize_url: string;
  token_url: string;
  scopes: string[];
  requires_client_credentials: boolean;
}

interface SyncFrequency {
  options: string[];                    // Available sync intervals
  default: string;                      // Default interval
}

interface FieldMappings {
  [entity: string]: {                   // Entity type (e.g., "contacts")
    [external_field: string]: string;   // External field → internal field
  };
}

// Configuration Schema Property Types
interface ConfigProperty {
  type: 'string' | 'boolean' | 'number' | 'select';
  label: string;                        // Display label
  description: string;                  // Help text
  secret?: boolean;                     // Hide value (passwords, tokens)
  default?: any;                        // Default value
  placeholder?: string;                 // Placeholder text for inputs
  readonly?: boolean;                   // Read-only field (auto-generated)
  options?: string[];                   // For type: 'select' - dropdown options
}
```

### Configuration Schema Extensions

The configuration schema supports the following field types:

| Type | Description | Example Use Case |
|------|-------------|------------------|
| `string` | Text input | API keys, URLs, names |
| `boolean` | Checkbox | Feature toggles (e.g., "Sync Documents") |
| `number` | Numeric input | Row numbers, timeouts, limits |
| `select` | Dropdown menu | Regions, environments, data centers |

**Additional Properties:**

- `secret: true` - Hides input value (for passwords, tokens)
- `readonly: true` - Field is auto-generated and cannot be edited
- `placeholder` - Hint text shown in empty input fields
- `default` - Pre-populated value
- `options` - Array of choices for `type: "select"`

**Example - Select Field:**
```json
{
  "data_center": {
    "type": "select",
    "label": "Data Center",
    "description": "Select your Zoho data center region",
    "options": ["US", "EU", "IN", "AU", "JP"],
    "default": "US"
  }
}
```

**Example - Number Field:**
```json
{
  "header_row": {
    "type": "number",
    "label": "Header Row Number",
    "description": "Row number containing column headers",
    "default": 1
  }
}
```

**Example - Read-only Field:**
```json
{
  "webhook_url": {
    "type": "string",
    "label": "Webhook URL",
    "description": "URL for receiving webhooks (auto-configured)",
    "readonly": true
  }
}
```

---

## Error Responses

### Standard Error Format

All error responses follow this structure:

```json
{
  "error": "Error message",
  "error_code": "ERROR_CODE",
  "details": {
    "field": "Additional context"
  },
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc130"
  }
}
```

### Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `INVALID_REQUEST` | Malformed request or invalid parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT token |
| 403 | `FORBIDDEN` | Connector not available for organization |
| 404 | `NOT_FOUND` | Connector or resource not found |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |
| 503 | `SERVICE_UNAVAILABLE` | Catalog service temporarily unavailable |

---

## Rate Limiting

- **Rate Limit:** 100 requests per minute per organization
- **Burst Limit:** 10 requests per second

**Response Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

**Rate Limit Exceeded Response (429):**
```json
{
  "error": "Rate limit exceeded",
  "error_code": "RATE_LIMIT_EXCEEDED",
  "retry_after": 60,
  "metadata": {
    "timestamp": "2025-12-19T10:35:00Z",
    "request_id": "req_abc131"
  }
}
```

---

## Caching

### Client-Side Caching

Clients should implement caching with the following strategy:

1. **Cache Duration:** 1 hour for full catalog
2. **Cache Key:** `catalog_version` from `/api/v1/catalog/version`
3. **Cache Invalidation:** Check version endpoint every 15 minutes
4. **Conditional Requests:** Use `If-None-Match` with version as ETag

**Example with ETag:**
```bash
curl -X GET "https://api.lanaai.com/api/v1/catalog/connectors" \
  -H "Authorization: Bearer <token>" \
  -H "If-None-Match: \"1.0.0\""
```

**Response (304 Not Modified):**
```
HTTP/1.1 304 Not Modified
ETag: "1.0.0"
Cache-Control: max-age=3600
```

---

## Webhooks (Future Enhancement)

Planned webhook events for catalog updates:

- `connector.created` - New connector added
- `connector.updated` - Connector metadata changed
- `connector.status_changed` - Status changed (e.g., coming_soon → active)
- `connector.deprecated` - Connector marked as deprecated

---

## Example Integration Flow

### Step 1: Client App Initialization

```javascript
// On app launch, fetch catalog version
const catalogVersion = await fetch('https://api.lanaai.com/api/v1/catalog/version');

// Check local cache
const cachedVersion = localStorage.getItem('catalog_version');
if (cachedVersion !== catalogVersion.version) {
  // Fetch fresh catalog
  const catalog = await fetch('https://api.lanaai.com/api/v1/catalog/connectors', {
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    }
  });

  // Update local cache
  localStorage.setItem('catalog_version', catalogVersion.version);
  localStorage.setItem('catalog_data', JSON.stringify(catalog));
}
```

### Step 2: Display Connectors in UI

```javascript
// Load from cache
const catalog = JSON.parse(localStorage.getItem('catalog_data'));

// Filter by category
const crmConnectors = catalog.connectors.filter(c => c.category === 'crm');

// Render in UI
renderConnectorCards(crmConnectors);
```

### Step 3: Connector Configuration

```javascript
// User clicks "Configure" on HubSpot connector
const connectorId = 'hubspot-crm';

// Fetch detailed configuration schema
const connector = await fetch(
  `https://api.lanaai.com/api/v1/catalog/connectors/${connectorId}`,
  {
    headers: { 'Authorization': `Bearer ${jwtToken}` }
  }
);

// Check availability for organization
const availability = await fetch(
  `https://api.lanaai.com/api/v1/catalog/connectors/${connectorId}/availability`,
  {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'X-Organization-ID': organizationId
    }
  }
);

if (availability.available) {
  // Render configuration form using connector.configuration_schema
  renderConfigurationForm(connector.configuration_schema);
} else {
  // Show upgrade prompt
  showUpgradePrompt(availability.upgrade_url);
}
```

---

## Security Considerations

### 1. Sensitive Data Handling

- **Never expose** full connector credentials in API responses
- Fields marked with `"secret": true` should be write-only
- Use separate endpoint for credential storage: `/api/v1/integrations/connectors/:id/credentials`

### 2. Organization Isolation

- All authenticated requests must validate organization ownership
- Prevent cross-organization connector configuration access
- Audit log all connector configuration changes

### 3. OAuth Security

- Validate OAuth redirect URIs
- Use PKCE (Proof Key for Code Exchange) for OAuth flows
- Store OAuth tokens encrypted in database
- Implement token rotation and refresh

---

## Deployment Notes

### Database Seeding

Use the provided `connector-catalog.json` to seed the database:

```bash
# Load connector catalog into database
node scripts/seed-connector-catalog.js \
  --file src/data/connector-catalog.json \
  --environment production
```

### Cloud Deployment

1. Deploy catalog API to cloud infrastructure (AWS Lambda, Cloudflare Workers, etc.)
2. Configure CDN for static assets (connector logos)
3. Set up database replication for high availability
4. Enable CloudWatch/monitoring for API endpoints

### Version Management

- Semantic versioning for catalog: `MAJOR.MINOR.PATCH`
- Breaking changes increment MAJOR version
- New connectors increment MINOR version
- Bug fixes increment PATCH version

---

## Support

For API issues or questions:
- **Documentation:** https://docs.lanaai.com/api/connector-catalog
- **Support Email:** support@redroostertec.com
- **Developer Portal:** https://developers.lanaai.com

---

**End of Specification**

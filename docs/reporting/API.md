# Reporting API Endpoints (Client Reference)

**Status:** Active | **Version:** 2.0.0 | **Updated:** 2026-03-05

API endpoints consumed by the reporting frontend. All require JWT authentication.
For full backend API documentation, see: `LANA-AI/docs/reporting/API.md`

---

## Module Listing & Execution

### List Modules
```
GET /api/v1/modules
```
Returns all modules for the sidebar. Response includes `module_key`, `name`, `description`, `category`, `icon`, `tier`, `status`, `version`, `metric_count`.

### Get Module Definition
```
GET /api/v1/modules/:moduleKey
```
Full module config (used for module info modal).

### Execute Module
```
POST /api/v1/modules/:moduleKey/execute
```

**Note:** `organizationId` is resolved automatically from the authenticated user's JWT — it is NOT passed in the request body.

**Request:**
```json
{
  "periodType": "monthly",
  "periodStart": "2026-01-01T00:00:00.000Z",
  "periodEnd": "2026-01-31T23:59:59.999Z",
  "compareBy": "weekly",
  "useCache": true,
  "cacheTtlSeconds": 900
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `periodType` | string | `monthly` | `daily`, `weekly`, `monthly`, `quarterly`, `yearly` |
| `periodStart` | ISO 8601 | Current period | Period start date |
| `periodEnd` | ISO 8601 | Calculated | Period end date |
| `compareBy` | string | -- | Time-series granularity |
| `useCache` | boolean | `true` | Whether to use cached results |
| `cacheTtlSeconds` | number | `900` | Cache TTL in seconds |

**Response contains:** `metrics[]`, `visualizations[]`, `insights[]`, `timeSeries[]`, `dataSources[]`, `period`, `priorPeriod`, `executedAt`

---

## Targets & Overrides

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/modules/:moduleKey/targets` | Get targets |
| PUT | `/api/v1/modules/:moduleKey/targets` | Update targets (admin) |
| GET | `/api/v1/modules/:moduleKey/data-overrides` | List overrides |
| POST | `/api/v1/modules/:moduleKey/data-overrides` | Create override |
| DELETE | `/api/v1/modules/:moduleKey/data-overrides/:id` | Delete override |

### Create Override Request
```json
{
  "metricKey": "qualified_leads",
  "value": 55,
  "notes": "Adjusted for incomplete sync",
  "periodStart": "2026-01-01T00:00:00.000Z",
  "periodEnd": "2026-01-31T23:59:59.999Z",
  "periodType": "monthly"
}
```

---

## Drilldown

### Get Config
```
GET /api/v1/modules/:moduleKey/metrics/:metricKey/drilldown
```
Returns column definitions, title, pagination config.

### Execute Drilldown
```
POST /api/v1/modules/:moduleKey/metrics/:metricKey/drilldown/execute
```
**Request:**
```json
{
  "periodStart": "2026-01-01T00:00:00.000Z",
  "periodEnd": "2026-01-31T23:59:59.999Z",
  "page": 1,
  "pageSize": 25,
  "sortBy": "created_date",
  "sortDirection": "desc",
  "filters": {},
  "search": "",
  "viewFilter": "qualified",
  "viewType": "contacts"
}
```
**Response contains:** `rows[]`, `summary`, `insights[]`, `pagination`, `executionTime`

---

## Marketing Spend

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/modules/:moduleKey/marketing-spend` | List entries |
| POST | `/api/v1/modules/:moduleKey/marketing-spend` | Add entry |
| DELETE | `/api/v1/modules/:moduleKey/marketing-spend/:id` | Delete entry |

---

**Created:** 2026-03-05 | **Author:** Red Rooster Technologies

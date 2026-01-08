# Configurable Assistant Identity

**Date:** December 16, 2024
**Status:** Implemented

---

## Summary

Implemented a centralized configuration system for the AI assistant's identity, making the system flexible for multiple industries instead of being hardcoded for law/legal only. Identity configuration is exposed via the discovery endpoint and used throughout all system prompts.

---

## Problem

The system was heavily skewed towards law with hardcoded references to:
- "Lana" as the assistant name
- "legal AI assistant" as the role
- "legal professionals" as the audience
- Law-specific terminology throughout prompts

This made the system unsuitable for:
- White-label deployments
- Multi-industry use cases
- Custom branding requirements
- Different professional domains

---

## Solution

### Central Configuration via Environment Variables

Added five new environment variables in `.env`:

```bash
# =============================================================================
# ASSISTANT IDENTITY CONFIGURATION
# =============================================================================
# Customize the AI assistant's identity and role
# Defaults to legal/law industry if not set

# Assistant name (default: "Lana")
ASSISTANT_NAME=Lana

# Assistant role/title (default: "legal AI assistant")
ASSISTANT_ROLE=legal AI assistant

# Industry/domain (default: "legal")
ASSISTANT_INDUSTRY=legal

# Short description of capabilities
ASSISTANT_DESCRIPTION=I help legal professionals with document analysis, research, case management, and general legal questions.

# Optional: Organization/firm name to include in context
ORGANIZATION_NAME=
```

### Discovery Endpoint Integration

The `/health/discovery` endpoint now returns assistant identity config:

**Response:**
```json
{
  "status": "healthy",
  "server": {
    "version": "1.0.0",
    "api_version": "v1"
  },
  "assistant": {
    "name": "Lana",
    "role": "legal AI assistant",
    "industry": "legal",
    "description": "I help legal professionals with...",
    "organization": null
  },
  "discovery": {
    "static_ip": "192.168.1.100",
    "port": 8080,
    ...
  },
  "timestamp": "2024-12-16T..."
}
```

### Dynamic System Prompts

All system prompts now use environment variables instead of hardcoded values:

**Before:**
```javascript
const BASE_SYSTEM_PROMPT = `You are Lana, an intelligent legal AI assistant...`;
```

**After:**
```javascript
function getBaseSystemPrompt() {
  const assistantName = process.env.ASSISTANT_NAME || 'Lana';
  const assistantRole = process.env.ASSISTANT_ROLE || 'legal AI assistant';
  const assistantIndustry = process.env.ASSISTANT_INDUSTRY || 'legal';
  const assistantDescription = process.env.ASSISTANT_DESCRIPTION || '...';

  return `You are ${assistantName}, an intelligent ${assistantRole}. ${assistantDescription}`;
}
```

---

## Files Modified

### Configuration

**`.env` (lines 119-138)**
- Added ASSISTANT_NAME
- Added ASSISTANT_ROLE
- Added ASSISTANT_INDUSTRY
- Added ASSISTANT_DESCRIPTION
- Added ORGANIZATION_NAME

### Discovery Endpoint

**`src/services/health/routes/health.routes.js` (lines 273-279)**
- Added `assistant` object to discovery response
- Exposes all identity config to clients
- Defaults applied if env vars not set

### System Prompts

**`src/services/processor/routes/streaming.routes.js` (lines 130-180)**
- Created `getBaseSystemPrompt()` function
- Uses environment variables for identity
- Caches prompt in `BASE_SYSTEM_PROMPT`
- Dynamic assistant name in communication style examples

**`src/services/processor/routes/smart-query.routes.js` (lines 15-40)**
- Created `getSmartQuerySystemPrompt()` function
- Uses environment variables for identity
- Caches prompt in `SMART_QUERY_SYSTEM_PROMPT`

**`src/shared/context/system-context.service.js` (lines 348-366)**
- Updated `getMinimalContext()` to use env vars
- Dynamic context header with assistant name
- Industry-specific fallback messages

**`src/shared/context/cached-system-context.service.js` (lines 194-214)**
- Updated `buildMinimalContext()` to use env vars
- Consistent with main context service

---

## Usage Examples

### Example 1: Legal Firm (Default)

**`.env`:**
```bash
ASSISTANT_NAME=Lana
ASSISTANT_ROLE=legal AI assistant
ASSISTANT_INDUSTRY=legal
ASSISTANT_DESCRIPTION=I help legal professionals with document analysis, research, case management, and general legal questions.
```

**Result:**
- "You are Lana, an intelligent legal AI assistant..."
- Integrated with firm's case management system
- Law-focused language and examples

### Example 2: Medical Practice

**`.env`:**
```bash
ASSISTANT_NAME=MediBot
ASSISTANT_ROLE=medical AI assistant
ASSISTANT_INDUSTRY=medical
ASSISTANT_DESCRIPTION=I help medical professionals with patient records, clinical documentation, scheduling, and general medical administrative tasks.
ORGANIZATION_NAME=St. Mary's Hospital
```

**Result:**
- "You are MediBot, an intelligent medical AI assistant..."
- Integrated with organization's management system
- Medical-focused language and examples

### Example 3: Business Consulting

**`.env`:**
```bash
ASSISTANT_NAME=ConsultPro
ASSISTANT_ROLE=business AI consultant
ASSISTANT_INDUSTRY=consulting
ASSISTANT_DESCRIPTION=I help consultants with client analysis, project management, proposal drafting, and business intelligence.
ORGANIZATION_NAME=Acme Consulting Group
```

**Result:**
- "You are ConsultPro, an intelligent business AI consultant..."
- Business-focused language
- Consulting-specific context

### Example 4: Real Estate

**`.env`:**
```bash
ASSISTANT_NAME=PropAssist
ASSISTANT_ROLE=real estate AI assistant
ASSISTANT_INDUSTRY=real estate
ASSISTANT_DESCRIPTION=I help real estate professionals with property listings, client management, market analysis, and transaction documentation.
```

**Result:**
- "You are PropAssist, an intelligent real estate AI assistant..."
- Real estate-focused language
- Property-specific context

---

## Industry-Specific Adaptations

### Integration Message

The system prompt automatically adapts based on industry:

**Legal/Law:**
```
You're integrated with the firm's case management system.
```

**Other Industries:**
```
You're integrated with the organization's management system.
```

### Default Descriptions

If `ASSISTANT_DESCRIPTION` is not set, a generic description is generated:

```javascript
`I help ${assistantIndustry} professionals with document analysis, research, case management, and general questions.`
```

---

## Accessing Identity Configuration

### Frontend (via Discovery)

```javascript
// Call discovery endpoint
const response = await fetch('/health/discovery');
const data = await response.json();

// Access assistant identity
console.log(data.assistant.name);         // "Lana"
console.log(data.assistant.role);         // "legal AI assistant"
console.log(data.assistant.industry);     // "legal"
console.log(data.assistant.description);  // "I help legal professionals..."
console.log(data.assistant.organization); // null or "Firm Name"
```

### Backend (via Environment)

```javascript
const assistantName = process.env.ASSISTANT_NAME || 'Lana';
const assistantRole = process.env.ASSISTANT_ROLE || 'legal AI assistant';
const assistantIndustry = process.env.ASSISTANT_INDUSTRY || 'legal';
const assistantDescription = process.env.ASSISTANT_DESCRIPTION || '...';
const organizationName = process.env.ORGANIZATION_NAME || null;
```

---

## Defaults

All fields have sensible defaults if not configured:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ASSISTANT_NAME` | `"Lana"` | Name of the AI assistant |
| `ASSISTANT_ROLE` | `"legal AI assistant"` | Role/title of the assistant |
| `ASSISTANT_INDUSTRY` | `"legal"` | Industry/domain focus |
| `ASSISTANT_DESCRIPTION` | (generated) | Capabilities description |
| `ORGANIZATION_NAME` | `null` | Optional org/firm name |

This ensures backward compatibility - existing deployments continue working without any .env changes.

---

## Benefits

1. **White-Label Ready**
   - Easy rebranding for different clients
   - Customizable identity per deployment
   - No code changes required

2. **Multi-Industry Support**
   - Legal, medical, consulting, real estate, etc.
   - Industry-appropriate language
   - Domain-specific context

3. **Centralized Management**
   - Single source of truth (.env file)
   - Changes propagate everywhere
   - Discoverable via API

4. **Backward Compatible**
   - Defaults to current law behavior
   - No breaking changes
   - Existing deployments unaffected

5. **Client-Side Access**
   - Discovery endpoint provides config
   - Frontend can adapt UI/branding
   - Dynamic welcome messages

---

## Future Enhancements

### 1. Database-Stored Configuration

Move configuration from .env to database for runtime changes:

```sql
CREATE TABLE assistant_configuration (
  id UUID PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id),
  assistant_name VARCHAR(100),
  assistant_role VARCHAR(200),
  assistant_industry VARCHAR(100),
  assistant_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Multi-Tenant Identity

Different identity per organization:

```javascript
async function getAssistantIdentity(organizationId) {
  const config = await db.query(
    'SELECT * FROM assistant_configuration WHERE organization_id = $1',
    [organizationId]
  );

  return config || getDefaultIdentity();
}
```

### 3. Admin UI for Configuration

Web interface to manage assistant identity:
- Name/role configuration
- Industry selection dropdown
- Description editor
- Live preview

### 4. Industry Templates

Pre-configured templates for common industries:
- Legal/Law
- Medical/Healthcare
- Real Estate
- Consulting
- Financial Services
- Education
- etc.

---

## Testing

### Test Default Configuration

```bash
# Use default .env values
curl http://localhost:8080/health/discovery | jq .assistant
```

**Expected:**
```json
{
  "name": "Lana",
  "role": "legal AI assistant",
  "industry": "legal",
  "description": "I help legal professionals with...",
  "organization": null
}
```

### Test Custom Configuration

```bash
# Update .env
ASSISTANT_NAME=MediBot
ASSISTANT_ROLE=medical AI assistant
ASSISTANT_INDUSTRY=medical
ASSISTANT_DESCRIPTION=I help medical professionals...

# Restart server
pm2 restart all

# Test discovery
curl http://localhost:8080/health/discovery | jq .assistant
```

**Expected:**
```json
{
  "name": "MediBot",
  "role": "medical AI assistant",
  "industry": "medical",
  "description": "I help medical professionals...",
  "organization": null
}
```

---

## Migration Guide

### For Existing Deployments

No action required! The system defaults to current behavior.

### For New Deployments

1. Copy `.env.example` to `.env`
2. Update assistant identity section:
   ```bash
   ASSISTANT_NAME=YourAssistantName
   ASSISTANT_ROLE=your role description
   ASSISTANT_INDUSTRY=your industry
   ASSISTANT_DESCRIPTION=Your description
   ORGANIZATION_NAME=Your Organization
   ```
3. Restart server: `pm2 restart all`
4. Verify via discovery endpoint

---

## Key Takeaways

1. **Flexibility:** System now supports any industry, not just law
2. **Central Config:** Single location (.env) controls all identity
3. **Discoverable:** Clients can fetch identity via /health/discovery
4. **Backward Compatible:** Defaults maintain current behavior
5. **Scalable:** Ready for multi-tenant, database-backed config

---

**Status:** Implemented and ready for production. Defaults to law/legal behavior for backward compatibility. Can be customized via environment variables for any industry.

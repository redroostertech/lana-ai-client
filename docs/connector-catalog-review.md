# Connector Catalog JSON Review

**Date:** 2025-12-19
**Reviewer:** AI Assistant
**File:** `/src/data/connector-catalog.json`

---

## ✅ Strengths

### 1. **Comprehensive Coverage**
- All 17 inactive connectors are present
- Well-distributed across categories:
  - CRM: 3 connectors
  - Case Management: 3 connectors
  - Communications: 4 connectors
  - Documents: 6 connectors
  - Financial: 1 connector

### 2. **Consistent Structure**
- Every connector has all required fields
- OAuth configurations are complete for OAuth2 connectors
- Configuration schemas follow JSON Schema standard
- Field mappings provided for all major entities

### 3. **Production-Ready Details**
- Accurate OAuth URLs for all providers
- Correct API scopes
- Realistic sync frequency options
- Proper authentication types (OAuth2, API Key)

### 4. **Legal Industry Focus**
- Case management connectors (Clio, Filevine, MyCase)
- Matter-to-external-system mappings
- Document-centric connectors for legal workflows

---

## ⚠️ Critical Gaps Identified

### 1. **MISSING: Google Sheets Connector**

**Issue:** You mentioned Google Sheets would be the first custom connector after refactor, but it's not in the catalog.

**Recommendation:** Add Google Sheets connector:

```json
{
  "id": "google-sheets",
  "name": "Google Sheets",
  "category": "documents",
  "status": "coming_soon",
  "description": "Integrate Google Sheets for custom data imports, client lists, and structured data synchronization.",
  "logo_url": "/assets/connectors/google-sheets-logo.png",
  "vendor": "Google LLC",
  "documentation_url": "https://docs.lanaai.com/connectors/google-sheets",
  "auth_type": "oauth2",
  "oauth_config": {
    "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_url": "https://oauth2.googleapis.com/token",
    "scopes": [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly"
    ],
    "requires_client_credentials": true
  },
  "capabilities": [
    "spreadsheet_import",
    "structured_data_sync",
    "custom_field_mapping",
    "scheduled_sync"
  ],
  "sync_frequency": {
    "options": ["manual", "hourly", "daily"],
    "default": "daily"
  },
  "configuration_schema": {
    "type": "object",
    "required": ["client_id", "client_secret", "spreadsheet_id"],
    "properties": {
      "client_id": {
        "type": "string",
        "label": "Google Client ID",
        "description": "OAuth 2.0 Client ID from Google Cloud Console"
      },
      "client_secret": {
        "type": "string",
        "label": "Google Client Secret",
        "description": "OAuth 2.0 Client Secret from Google Cloud Console",
        "secret": true
      },
      "spreadsheet_id": {
        "type": "string",
        "label": "Spreadsheet ID",
        "description": "Google Sheets ID (from URL)",
        "placeholder": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
      },
      "sheet_name": {
        "type": "string",
        "label": "Sheet Name",
        "description": "Specific sheet/tab to sync (leave blank for first sheet)",
        "placeholder": "Sheet1"
      },
      "header_row": {
        "type": "number",
        "label": "Header Row Number",
        "description": "Row number containing column headers",
        "default": 1
      },
      "data_start_row": {
        "type": "number",
        "label": "Data Start Row",
        "description": "Row number where data begins",
        "default": 2
      }
    }
  },
  "field_mappings": {
    "rows": {
      "A": "column_a",
      "B": "column_b"
    }
  }
}
```

---

## 🔧 Enhancement Recommendations

### 2. **Missing: Webhook Configuration**

**Issue:** Connectors with `real_time_webhooks` capability don't specify what events they support.

**Recommendation:** Add `webhook_config` to connectors like HubSpot, Salesforce, Google Calendar:

```json
"webhook_config": {
  "supported_events": [
    "contact.created",
    "contact.updated",
    "contact.deleted",
    "deal.created",
    "deal.updated"
  ],
  "registration_required": true,
  "webhook_url_template": "https://{customer-backend}/webhooks/hubspot/{organization_id}"
}
```

### 3. **Missing: Rate Limiting Information**

**Issue:** External APIs have rate limits that should be documented.

**Recommendation:** Add `rate_limits` to each connector:

```json
"rate_limits": {
  "requests_per_minute": 100,
  "requests_per_day": 10000,
  "burst_limit": 10,
  "retry_after_429": true
}
```

### 4. **Missing: Matter Association Strategy**

**Issue:** CRM connectors (HubSpot, Salesforce, Zoho) don't show how they link to legal matters.

**Recommendation:** Add `matter_mapping_strategy` to CRM connectors:

```json
"matter_mapping_strategy": {
  "supported": true,
  "methods": [
    {
      "type": "custom_field",
      "description": "Map HubSpot deal custom field to Lana matter ID",
      "field_name": "lana_matter_id"
    },
    {
      "type": "tag_based",
      "description": "Use HubSpot tags to associate with matters",
      "tag_prefix": "matter:"
    }
  ]
}
```

### 5. **Missing: Search/Discovery Metadata**

**Issue:** No tags, keywords, or categories for enhanced searchability.

**Recommendation:** Add to each connector:

```json
"tags": ["crm", "contacts", "sales", "legal-tech"],
"search_keywords": ["hubspot", "contact management", "deal tracking", "pipeline"],
"popularity_score": 85,
"featured": false
```

### 6. **Missing: Prerequisites & Requirements**

**Issue:** Users don't know what they need before configuring a connector.

**Recommendation:** Add `prerequisites`:

```json
"prerequisites": [
  "Active HubSpot account (Professional or Enterprise tier)",
  "HubSpot Super Admin access",
  "OAuth app registered in HubSpot Developer Portal"
],
"minimum_plan_required": "hubspot_professional"
```

### 7. **Missing: Connector Version & Compatibility**

**Issue:** No version tracking for connector definitions.

**Recommendation:** Add version metadata:

```json
"connector_version": "1.0.0",
"api_version": "v3",
"last_updated": "2025-12-19",
"deprecation_date": null,
"compatibility": {
  "lana_min_version": "2.0.0",
  "lana_max_version": null
}
```

### 8. **Missing: Pricing/Tier Information**

**Issue:** Some connectors might require specific Lana AI subscription tiers.

**Recommendation:** Add pricing tier requirements:

```json
"tier_requirements": {
  "minimum_tier": "professional",
  "included_in_tiers": ["professional", "enterprise"],
  "additional_cost": false,
  "trial_available": true,
  "trial_duration_days": 14
}
```

### 9. **Missing: Support & Help Resources**

**Issue:** No support contacts or help resources specific to each connector.

**Recommendation:** Add support information:

```json
"support": {
  "documentation_url": "https://docs.lanaai.com/connectors/hubspot",
  "video_tutorial_url": "https://www.youtube.com/watch?v=...",
  "support_email": "connectors@redroostertec.com",
  "community_forum_url": "https://community.lanaai.com/c/integrations/hubspot",
  "known_issues_url": "https://status.lanaai.com/connectors/hubspot"
}
```

### 10. **Missing: Data Retention & Compliance**

**Issue:** GDPR/compliance requires documenting data retention policies.

**Recommendation:** Add compliance information:

```json
"compliance": {
  "data_retention_days": 90,
  "gdpr_compliant": true,
  "hipaa_compliant": false,
  "soc2_compliant": true,
  "data_residency": ["US", "EU"],
  "encryption_at_rest": true,
  "encryption_in_transit": true
}
```

### 11. **Missing: Screenshots & Visual Previews**

**Issue:** Users can't preview what the connector looks like before configuring.

**Recommendation:** Add visual assets:

```json
"media": {
  "logo_url": "/assets/connectors/hubspot-logo.png",
  "banner_url": "/assets/connectors/hubspot-banner.png",
  "screenshots": [
    "/assets/connectors/hubspot-screenshot-1.png",
    "/assets/connectors/hubspot-screenshot-2.png"
  ],
  "demo_video_url": "https://www.youtube.com/watch?v=..."
}
```

### 12. **Missing: Installation/Setup Complexity**

**Issue:** Users don't know how complex the setup will be.

**Recommendation:** Add difficulty rating:

```json
"setup_complexity": {
  "level": "intermediate",
  "estimated_time_minutes": 15,
  "steps_count": 5,
  "requires_external_admin": true,
  "requires_developer": false
}
```

---

## 📊 Data Quality Issues

### 13. **Inconsistent Field Mappings**

**Issue:** Some connectors have comprehensive field mappings (HubSpot, Salesforce), others are minimal (Zoho CRM only has contacts, missing deals/accounts).

**Recommendation:** Ensure all connectors with similar capabilities have equivalent field mappings.

**Example:** Zoho CRM should have mappings for:
- contacts ✓ (present)
- deals ❌ (missing)
- accounts ❌ (missing)
- leads ❌ (missing)

### 14. **Missing Default Values**

**Issue:** Some configuration properties lack default values, making UX unclear.

**Recommendation:** Add defaults where applicable:

```json
"sync_documents": {
  "type": "boolean",
  "label": "Sync Documents",
  "description": "Import documents from Clio matters",
  "default": true  // ✓ Good
}
```

vs.

```json
"folder_id": {
  "type": "string",
  "label": "Folder ID (Optional)",
  "description": "Specific folder to sync (leave blank for all files)"
  // ❌ Missing default: ""
}
```

---

## 🎯 Actionable Items

### High Priority (Should Fix Before Database Seeding)

1. **Add Google Sheets connector** (your first validation connector)
2. **Add webhook_config** for real-time connectors
3. **Add matter_mapping_strategy** for CRM connectors
4. **Add complete field_mappings** for all connectors (Zoho deals/accounts/leads)
5. **Add tags and search_keywords** for marketplace discoverability

### Medium Priority (Can Add Post-Seeding)

6. Add rate_limits for API management
7. Add prerequisites for better UX
8. Add connector_version for change tracking
9. Add tier_requirements for monetization
10. Add support resources

### Low Priority (Nice to Have)

11. Add media/screenshots
12. Add setup_complexity ratings
13. Add compliance information
14. Add deprecation tracking

---

## 🔍 Validation Checklist

Before seeding database, verify:

- [ ] Google Sheets connector added
- [ ] All 18 connectors present (17 original + Google Sheets)
- [ ] All OAuth2 connectors have complete oauth_config
- [ ] All connectors have at least one field_mapping entity
- [ ] All sync_frequency options are valid
- [ ] All auth_type values are consistent
- [ ] All status values are "coming_soon" (not "active" yet)
- [ ] No duplicate connector IDs
- [ ] All URLs are properly formatted (https://)
- [ ] All required fields are marked in configuration_schema

---

## 💡 Recommended Next Steps

1. **Immediate:**
   - Add Google Sheets connector to catalog
   - Add webhook_config to real-time connectors
   - Complete field_mappings for Zoho CRM

2. **Before First Implementation (Google Sheets):**
   - Add matter_mapping_strategy (critical for legal workflows)
   - Add tags/keywords for search
   - Add prerequisites section

3. **Before Public Release:**
   - Add all enhancement recommendations
   - Create visual assets (logos, screenshots)
   - Write documentation for each connector

---

## Summary

**Overall Assessment:** The catalog is **well-structured and production-ready** for initial seeding, but needs the following critical additions before deployment:

### Must-Have Before Seeding:
1. Google Sheets connector
2. Webhook configurations
3. Complete field mappings
4. Matter association strategies

### Should-Have for Better UX:
5. Search metadata (tags, keywords)
6. Prerequisites
7. Rate limiting info

### Nice-to-Have for Full Production:
8. Visual assets
9. Compliance info
10. Support resources

**Recommendation:** Add items 1-4 immediately, then seed database. Add items 5-7 within first sprint. Add items 8-10 as ongoing improvements.


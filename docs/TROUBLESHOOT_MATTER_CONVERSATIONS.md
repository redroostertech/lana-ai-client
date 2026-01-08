# Troubleshooting: Conversations Not Showing in Matter Details

## Problem
Conversations created in the Chat page under a project/matter are not appearing in the Matter Details "Conversations" tab.

## Likely Cause
The conversation's `matter_id` was saved in a different format than expected:
- **Expected**: MATT-XXXXX format (e.g., `MATT-00001`)
- **Possibly saved as**: UUID format (e.g., `a1b2c3d4-e5f6-...`)

## Diagnosis Steps

### 1. Check Browser Console
Open the browser developer tools (F12) and look at the console logs:

**In Chat page:**
```
[loadConversations] Loaded conversations: {
  total: X,
  withMatterId: Y,
  matterIds: [{ thread_id: "abc...", matter_id: "MATT-00001", ... }]
}
```

Look at the `matter_id` values - are they in MATT-XXXXX format or UUID format?

**In Matters page:**
```
[viewMatter] Loading matter details: { matterId: "MATT-00001", format: "MATT-XXXXX" }
[viewMatter] Conversations loaded: { matterId: "MATT-00001", conversationCount: 0, ... }
```

### 2. Check Database Directly
Run this SQL query to find conversations with non-standard matter_id formats:

```sql
-- Find conversations where matter_id looks like a UUID (36 chars with dashes)
SELECT DISTINCT 
    c.thread_id,
    c.matter_id,
    c.metadata->>'title' as title,
    c.created_at,
    m.name as matter_name,
    m.matter_id as correct_matter_id
FROM conversations c
LEFT JOIN client_matters m ON 
    c.matter_id = m.id::text  -- UUID match
    OR c.matter_id = m.matter_id  -- MATT-XXXXX match
WHERE c.matter_id IS NOT NULL
ORDER BY c.created_at DESC
LIMIT 50;
```

### 3. Fix Existing Conversations
If you find conversations with UUID matter_id, you can fix them:

```sql
-- First, preview what would be updated
SELECT 
    c.thread_id,
    c.matter_id as current_matter_id,
    m.matter_id as correct_matter_id
FROM conversations c
JOIN client_matters m ON c.matter_id = m.id::text
WHERE c.matter_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Then, update to correct format
UPDATE conversations c
SET matter_id = m.matter_id
FROM client_matters m
WHERE c.matter_id = m.id::text
AND c.matter_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

## Prevention (Code Changes Made)

1. **chat.html - renderMatters()**: Now only uses `matter.matter_id`, not UUID fallback
2. **chat.html - createProjectChat()**: Validates matter_id is in MATT-XXXXX format
3. **chat.routes.js**: Updated query to match both formats for backwards compatibility
4. **matters.html**: Added detailed logging to diagnose issues

## Quick Test

1. Create a new project conversation from Chat
2. Check browser console for: `Creating project chat with matter: { matterId: "MATT-XXXXX", ... }`
3. Go to Matters, click on the matter
4. Check console for conversation count
5. Click "Conversations" tab - it should show the new conversation

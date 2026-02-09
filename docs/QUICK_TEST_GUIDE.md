# Quick Test Guide - Session Tracker Fixes

## Fast Verification (5 minutes)

### Step 1: Start the Client
```bash
cd /Users/redroostertechnologies/Desktop/lana-client
npm run electron:dev
```

### Step 2: Login
- Open the Electron app
- Login with any test user

### Step 3: Check Console (Cmd+Option+I)
Look for these messages:
```
[SessionTracker] Session started
[SessionTracker] Heartbeat sent  (every 30 seconds)
```

### Step 4: Check Database (in separate terminal)
```bash
psql -d lana_chef

-- Quick count check (should show results)
SELECT event_type, COUNT(*)
FROM activity_feed
WHERE event_type IN ('session.started', 'session.heartbeat', 'session.ended')
  AND activity_timestamp > NOW() - INTERVAL '1 hour'
GROUP BY event_type;
```

**Expected Output:**
```
event_type         | count
-------------------+-------
session.started    | 1
session.heartbeat  | 3-5 (depends on how long you waited)
```

### Step 5: Verify Metadata
```sql
SELECT
  metadata->>'session_id' as session_id,
  metadata->>'client_type' as client_type,
  metadata->>'client_version' as version
FROM activity_feed
WHERE event_type = 'session.started'
  AND activity_timestamp > NOW() - INTERVAL '10 minutes'
LIMIT 1;
```

**Expected Output:**
```
session_id                           | client_type | version
-------------------------------------+-------------+---------
550e8400-e29b-41d4-a716-446655440000 | desktop     | 3.0.0
```

---

## What Changed?

### Before (BROKEN) ❌
```javascript
// No session_id generated
// Wrong parameter names
{
  platform: 'electron',     // ❌ Wrong
  version: '3.0.0',         // ❌ Wrong
  matter_id: 'matter_001'   // ❌ Not accepted
}
```

### After (FIXED) ✅
```javascript
// Client generates session_id
const sessionId = uuidv4();

// Correct parameter names
{
  session_id: sessionId,        // ✅ Client-generated UUID
  client_type: 'desktop',       // ✅ Correct
  client_version: '3.0.0'       // ✅ Correct
}
```

---

## Common Issues

### Issue: No events in database
**Check:**
1. Is backend running? `lsof -i :8080`
2. Is client authenticated? Check JWT token in localStorage
3. Check Electron console for errors

### Issue: Heartbeat not sent
**Check:**
1. Session started successfully? (check console)
2. Timer running? (should send every 30 seconds)
3. Rate limit errors? (max 2 per 30 seconds)

### Issue: Validation errors in backend
**Check backend logs:**
```bash
cd /Users/redroostertechnologies/Desktop/LANA-AI
pm2 logs lana-api
```

Look for Zod validation errors - should be ZERO after fix.

---

## Full Test Suite

For comprehensive testing, use:
```bash
psql -d lana_chef -f /Users/redroostertechnologies/Desktop/lana-client/test-session-tracker-fix.sql
```

This runs 5 verification queries to check:
1. Event counts
2. Detailed metadata
3. Session lifecycle
4. Validation errors (should be empty)
5. Parameter format

---

## Success Criteria

✅ **session.started** event created with session_id
✅ **session.heartbeat** events sent every 30 seconds
✅ **session.ended** event created on logout
✅ All events have correct metadata (session_id, client_type, client_version)
✅ No validation errors in backend logs
✅ No parameter mismatch errors

---

**Test Duration:** 5 minutes
**Expected Result:** All session events visible in database

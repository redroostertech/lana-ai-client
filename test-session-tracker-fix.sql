-- Verification Query for Session Tracking Bug Fixes
-- Run this query AFTER testing the fixed client to verify events are being created

-- Query 1: Check for recent session events (should show results after fix)
SELECT
  event_type,
  COUNT(*) as event_count,
  MAX(activity_timestamp) as latest_event
FROM activity_feed
WHERE event_type IN ('session.started', 'session.heartbeat', 'session.ended')
  AND activity_timestamp > NOW() - INTERVAL '1 hour'
GROUP BY event_type
ORDER BY event_type;

-- Query 2: View detailed session events with user info
SELECT
  af.event_id,
  af.event_type,
  af.user_id,
  u.email,
  u.first_name,
  u.last_name,
  af.metadata->>'session_id' as session_id,
  af.metadata->>'client_type' as client_type,
  af.metadata->>'client_version' as client_version,
  af.activity_timestamp
FROM activity_feed af
LEFT JOIN users u ON af.user_id = u.user_id
WHERE af.event_type IN ('session.started', 'session.heartbeat', 'session.ended')
  AND af.activity_timestamp > NOW() - INTERVAL '1 hour'
ORDER BY af.activity_timestamp DESC
LIMIT 20;

-- Query 3: Verify session lifecycle (start -> heartbeats -> end)
SELECT
  metadata->>'session_id' as session_id,
  MIN(CASE WHEN event_type = 'session.started' THEN activity_timestamp END) as started_at,
  COUNT(CASE WHEN event_type = 'session.heartbeat' THEN 1 END) as heartbeat_count,
  MAX(CASE WHEN event_type = 'session.ended' THEN activity_timestamp END) as ended_at
FROM activity_feed
WHERE event_type IN ('session.started', 'session.heartbeat', 'session.ended')
  AND activity_timestamp > NOW() - INTERVAL '2 hours'
GROUP BY metadata->>'session_id'
ORDER BY started_at DESC
LIMIT 10;

-- Query 4: Check for any validation errors (should be empty after fix)
SELECT
  event_id,
  event_type,
  metadata,
  activity_timestamp,
  error_message
FROM activity_feed
WHERE event_type LIKE 'session.%'
  AND activity_timestamp > NOW() - INTERVAL '1 hour'
  AND (metadata IS NULL OR metadata->>'session_id' IS NULL);

-- Query 5: Verify correct parameter format in metadata
SELECT
  event_type,
  COUNT(*) as count,
  COUNT(DISTINCT metadata->>'session_id') as unique_sessions,
  jsonb_object_keys(metadata) as metadata_keys
FROM activity_feed
WHERE event_type IN ('session.started', 'session.heartbeat', 'session.ended')
  AND activity_timestamp > NOW() - INTERVAL '1 hour'
GROUP BY event_type, metadata
ORDER BY event_type
LIMIT 50;

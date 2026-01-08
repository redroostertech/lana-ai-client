# Threading Architecture

## Overview

LanaAI uses a **conversation-based threading model** that separates two key concepts:

1. **Conversation/Thread** (`conversationId`) - Groups related messages together
2. **Message/Session** (`sessionId`) - Unique identifier for each request/response pair

This architecture enables:
- ✅ Multiple messages in one conversation
- ✅ Conversation branching (like Claude's threading)
- ✅ Message-level retrieval tracing
- ✅ Efficient FK constraint management

## Key IDs

### conversationId (thread_id)
- **Purpose**: Groups messages in a conversation
- **Lifetime**: Persistent across many messages
- **Example**: `CONV-123` contains messages 1, 2, 3, etc.
- **Used in**:
  - `conversations.thread_id`
  - `chat_sessions.thread_id`
  - SSE `thread_id` field

### sessionId
- **Purpose**: Unique identifier for THIS specific message/request
- **Lifetime**: Single request/response cycle
- **Example**: Message 1 = `SESS-001`, Message 2 = `SESS-002`
- **Used in**:
  - `chat_sessions.id`
  - `retrieval_traces.session_id`
  - SSE `session_id` field

## Database Schema

### conversations
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID NOT NULL,  -- conversationId (groups messages)
  matter_id VARCHAR,
  role VARCHAR,
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMP
);
```

### chat_sessions
```sql
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY,        -- sessionId (THIS message)
  org_id UUID NOT NULL,
  thread_id UUID NOT NULL,    -- conversationId (groups in thread)
  created_by UUID,
  active_matter_id VARCHAR,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(org_id, thread_id)
);
```

### retrieval_traces
```sql
CREATE TABLE retrieval_traces (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL,   -- sessionId (traces for THIS message)
  org_id UUID,
  message_id UUID,
  user_id UUID,
  -- ... other columns
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);
```

## Request Flow

### New Conversation
```javascript
POST /api/v1/streaming/chat
{
  "message": "Hello",
  "matter_id": "MATT-001"
  // No conversation_id or session_id
}

// Backend generates:
conversationId = generateThreadId();  // "CONV-abc123"
sessionId = generateThreadId();       // "SESS-xyz789"

// Response:
{
  "thread_id": "CONV-abc123",   // Use this for subsequent messages
  "session_id": "SESS-xyz789"   // Unique to this message
}
```

### Continue Conversation
```javascript
POST /api/v1/streaming/chat
{
  "message": "Tell me more",
  "conversation_id": "CONV-abc123",  // Continue this conversation
  "matter_id": "MATT-001"
}

// Backend:
conversationId = "CONV-abc123";      // From request
sessionId = generateThreadId();       // New session for new message = "SESS-def456"

// Response:
{
  "thread_id": "CONV-abc123",   // Same conversation
  "session_id": "SESS-def456"   // New message
}
```

### Resume with Session ID
```javascript
POST /api/v1/streaming/chat
{
  "message": "Continue",
  "session_id": "SESS-xyz789",       // Resume from specific message
  "conversation_id": "CONV-abc123"
}

// Backend:
conversationId = "CONV-abc123";      // Thread
sessionId = "SESS-xyz789";            // Provided session

// Note: If only session_id provided, conversationId falls back to generating new
```

## FK Constraint Resolution

### The Problem (Before)
```javascript
// Old code:
threadId = session_id || conversation_id || generate();
sessionId = threadId; // Always same!

// When frontend sends BOTH:
session_id = "SESS-123"
conversation_id = "CONV-456"

// Result:
threadId = "SESS-123" (from priority)
chat_sessions.id = "SESS-123"
retrieval_traces.session_id = "SESS-123" OR "CONV-456"

// FK VIOLATION! 🔥
```

### The Solution (After)
```javascript
// New code:
conversationId = conversation_id || generate();  // Thread
sessionId = session_id || generate();            // Message

// chat_sessions:
INSERT INTO chat_sessions (id, thread_id, ...)
VALUES (sessionId, conversationId, ...);

// retrieval_traces always uses sessionId:
INSERT INTO retrieval_traces (session_id, ...)
VALUES (sessionId, ...);

// FK SATISFIED! ✅
```

## Future: Conversation Branching

To implement full threading (branching from any message):

### 1. Add Database Columns
```sql
ALTER TABLE chat_sessions ADD COLUMN parent_message_id UUID;
ALTER TABLE chat_sessions ADD COLUMN branch_point INTEGER;
ALTER TABLE chat_sessions ADD COLUMN branch_name VARCHAR(255);
```

### 2. Update Frontend Request
```javascript
POST /api/v1/streaming/chat
{
  "message": "What if we tried a different approach?",
  "conversation_id": "CONV-abc123",
  "parent_message_id": "SESS-002",  // Branch from Message 2
  "branch_point": 2                  // Optional: UI display ordering
}
```

### 3. Backend Handles Branching
```javascript
const conversationId = conversation_id;  // Same thread
const sessionId = generateThreadId();    // New message
const parentMessageId = parent_message_id || null;

// Insert with branch info:
INSERT INTO chat_sessions (id, thread_id, parent_message_id, ...)
VALUES (sessionId, conversationId, parentMessageId, ...);
```

### 4. Tree Structure
```
CONV-abc123
├─ SESS-001: "Hello"
├─ SESS-002: "Tell me about X"
│   ├─ Branch A:
│   │   └─ SESS-003: "What if we tried Y?"
│   └─ Branch B:
│       └─ SESS-004: "What about Z instead?"
└─ SESS-005: "Thanks!" (continues main branch)
```

## Stop/Status Endpoints

### Backward Compatibility
```javascript
// Endpoints check BOTH IDs:
GET /api/v1/streaming/sessions/:sessionId/status
POST /api/v1/streaming/sessions/:sessionId/stop

// Implementation:
const match = connections.find(conn =>
  (conn.sessionId === sessionId || conn.threadId === sessionId) &&
  conn.userId === req.user.id
);

// Works with:
- /sessions/SESS-123/stop (sessionId)
- /sessions/CONV-456/stop (conversationId)
```

## Migration Path

### Phase 1: Current (✅ Complete)
- Separate conversationId from sessionId
- FK constraints working
- Backward compatible stop/status endpoints

### Phase 2: UI Support
- Frontend tracks both thread_id and session_id
- Display conversation history
- Show which message is active

### Phase 3: Branching
- Add parent_message_id support
- UI for "branch from here"
- Tree visualization of conversation branches

### Phase 4: Advanced Features
- Branch naming/labeling
- Branch comparison
- Merge branches
- Export conversation trees

## Testing Scenarios

### Test 1: New Conversation
```bash
curl -X POST /api/v1/streaming/chat \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Hello","matter_id":"MATT-001"}'

# Expect:
# - New conversationId generated
# - New sessionId generated
# - chat_sessions record created
# - No FK violations
```

### Test 2: Continue Conversation
```bash
curl -X POST /api/v1/streaming/chat \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message":"Continue",
    "conversation_id":"CONV-existing",
    "matter_id":"MATT-001"
  }'

# Expect:
# - conversationId = CONV-existing
# - New sessionId generated
# - chat_sessions record created with both IDs
# - conversations.thread_id = CONV-existing
```

### Test 3: Stop Request
```bash
# Can stop by sessionId:
curl -X POST /api/v1/streaming/sessions/SESS-123/stop

# Or by conversationId (backward compatible):
curl -X POST /api/v1/streaming/sessions/CONV-456/stop

# Both should work!
```

## Benefits

✅ **Clean Separation**: Conversation grouping separate from message identity
✅ **FK Integrity**: chat_sessions.id matches retrieval_traces.session_id
✅ **Threading Ready**: Easy to add branching support later
✅ **Backward Compatible**: Existing code continues to work
✅ **Scalable**: Efficient queries for conversation history and branches
✅ **Auditable**: Each message has unique trace in retrieval_traces

## Related Files

- `/src/services/processor/routes/streaming.routes.js` - Main implementation
- `/src/shared/retrieval/retrieval.service.js` - Uses sessionId for tracing
- `/src/services/chat/routes/file-drawer.routes.js` - Also uses chat_sessions

## Questions?

- **Q: When should I use session_id vs conversation_id?**
  - A: Use `conversation_id` to continue a thread. Use `session_id` to reference a specific message.

- **Q: Can I omit both IDs?**
  - A: Yes! Backend generates both for new conversations.

- **Q: What if I only provide session_id?**
  - A: Backend generates a new conversationId (starts new thread).

- **Q: How do I implement branching?**
  - A: Send `conversation_id` + `parent_message_id`. Backend creates new branch in same thread.

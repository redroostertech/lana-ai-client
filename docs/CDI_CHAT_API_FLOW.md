# CDI Chat Flow - API Endpoint Documentation

**Last Updated:** December 15, 2025
**Status:** Current Architecture

## Overview
This document describes the complete API flow for the CDI (Conversational Document Intelligence) chat feature, including all endpoints used for conversation management, file uploads, and document retrieval.

**Important:** As of December 2025, RAG retrieval is built into the `/chat/stream` endpoint. The separate `/rag/stream` endpoint has been removed.

---

## Complete Flow Diagram

```
1. Authentication
   └─> POST /api/v1/auth/login
       └─> Returns: JWT token, user info, session

2. Fetch Matters
   └─> GET /api/v1/matters
       └─> Returns: List of available matters/cases

3. Create Chat Session
   └─> POST /api/v1/chat/sessions
       └─> Returns: thread_id for conversation

4. Upload Documents
   └─> POST /api/v1/chat/sessions/:thread_id/files
       └─> Returns: file_id, job_id, status

5. Poll Job Status (Optional)
   └─> GET /api/v1/jobs/:job_id
       └─> Returns: Job processing status

6. Send Messages (with automatic RAG)
   └─> POST /api/v1/streaming/chat/stream (SSE)
       └─> Returns: Streaming response with automatic retrieval + generation
       └─> RAG performed automatically when documents are active
```

---

## 1. Authentication

### Endpoint
```
POST /api/v1/auth/login
```

### Purpose
Authenticate user and obtain JWT token for subsequent API calls.

### Request Body
```json
{
  "email": "user@example.com",
  "password": "your_password"
}
```

### Response (200 OK)
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "aed92090-b669-4ef8-a21c-5b4a021d4952",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "organizationId": "55eb3b99-b6c0-4f35-9a35-0c2dc5e034f2"
  },
  "session": {
    "id": "b50e8f4a-4ce9-4696-b42a-3a16043b7ff8",
    "createdAt": "2025-12-15T00:17:52.411Z",
    "expiresAt": "2025-12-16T00:17:52.411Z"
  }
}
```

### Error Response (401 Unauthorized)
```json
{
  "error": {
    "message": "Invalid email or password",
    "code": "AUTHENTICATION_ERROR"
  }
}
```

### Usage Notes
- Token must be included in `Authorization: Bearer <token>` header for all subsequent requests
- Token expires in 24 hours (as indicated by `expiresAt`)

---

## 2. Fetch Available Matters

### Endpoint
```
GET /api/v1/matters
```

### Purpose
Retrieve list of matters (cases/projects) available to the authenticated user.

### Headers
```
Authorization: Bearer <token>
```

### Response (200 OK)
```json
{
  "matters": [
    {
      "matter_id": "MATT-00045",
      "matter_name": "Estate Planning - Smith Family Trust",
      "client_name": "John Smith",
      "status": "active",
      "created_at": "2025-12-14T10:30:00Z",
      "updated_at": "2025-12-14T15:20:00Z"
    },
    {
      "matter_id": "MATT-00046",
      "matter_name": "Contract Review - Tech Startup",
      "client_name": "Tech Innovations Inc",
      "status": "active",
      "created_at": "2025-12-13T09:00:00Z",
      "updated_at": "2025-12-14T11:45:00Z"
    }
  ]
}
```

### Usage Notes
- Matter IDs use format `MATT-XXXXX`
- Matter ID is required for creating conversations and uploading files
- Provides context for matter-scoped document retrieval (WARM tier in CDI)

---

## 3. Create Chat Session

### Endpoint
```
POST /api/v1/chat/sessions
```

### Purpose
Create a new conversation thread associated with a specific matter.

### Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

### Request Body
```json
{
  "matter_id": "MATT-00045",
  "title": "Estate Planning Discussion",
  "context": {
    "matter_name": "Estate Planning - Smith Family Trust",
    "matter_id": "MATT-00045"
  }
}
```

### Response (201 Created)
```json
{
  "session": {
    "id": "b8c7e4d2-9f1a-4b3c-8e5f-2d9a7c6b4e8f",
    "thread_id": "9aaf4ffb-0cf6-4586-85b5-62a397f6c33f",
    "matter_id": "MATT-00045",
    "title": "Estate Planning Discussion",
    "created_at": "2025-12-15T00:20:00Z",
    "updated_at": "2025-12-15T00:20:00Z"
  }
}
```

### Usage Notes
- `thread_id` is used for all subsequent operations in this conversation
- Each conversation maintains its own CDI session state (HOT tier documents)
- Multiple conversations can exist per matter

---

## 4. Upload Documents to Chat

### Endpoint
```
POST /api/v1/chat/sessions/:thread_id/files
```

### Purpose
Upload documents to a conversation for CDI retrieval. Files are automatically:
1. Ingested and chunked
2. Vectorized for semantic search
3. Activated in the HOT tier for this session
4. Made available for RAG queries

### Headers
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

### Request Parameters
- `thread_id` (path): UUID of the conversation thread
- `matter_id` (form field): Matter ID (e.g., "MATT-00045")
- `files` (form field): File to upload

### Example using curl
```bash
curl -X POST "https://localhost:8080/api/v1/chat/sessions/{thread_id}/files" \
  -H "Authorization: Bearer <token>" \
  -F "matter_id=MATT-00045" \
  -F "files=@/path/to/document.pdf"
```

### Response (200 OK)
```json
{
  "message": "1 file(s) uploaded successfully",
  "session_id": "9aaf4ffb-0cf6-4586-85b5-62a397f6c33f",
  "matter_id": "MATT-00045",
  "total": 1,
  "uploaded": 1,
  "failed": 0,
  "files": [
    {
      "filename": "estate_plan_draft.pdf",
      "file_id": "6adeff45-f307-4880-b88f-7c77afe5e569",
      "job_id": "f0d78e81-b1a6-45dd-b1aa-99137206c74b",
      "status": "queued",
      "size": 245680
    }
  ]
}
```

### File Processing States
- `queued`: File uploaded, waiting for processing
- `processing`: Currently being chunked and vectorized
- `completed`: Ready for retrieval
- `failed`: Processing error occurred

### Usage Notes
- Files are automatically activated for CDI HOT tier retrieval
- Maximum file size: 50MB
- Maximum files per upload: 10
- Supported formats: PDF, DOCX, TXT, MD, and more
- Job ID can be used to poll processing status

---

## 5. Poll Job Status (Optional)

### Endpoint
```
GET /api/v1/jobs/:job_id
```

### Purpose
Check the processing status of an uploaded document.

### Headers
```
Authorization: Bearer <token>
```

### Response (200 OK)
```json
{
  "id": "f0d78e81-b1a6-45dd-b1aa-99137206c74b",
  "status": "completed",
  "state": "completed",
  "data": {
    "file_id": "6adeff45-f307-4880-b88f-7c77afe5e569",
    "chunks_created": 42,
    "processing_time_ms": 3500
  },
  "created_at": "2025-12-15T00:25:00Z",
  "completed_at": "2025-12-15T00:25:03.5Z"
}
```

### Error Response (404 Not Found)
```json
{
  "error": {
    "message": "Job not found",
    "code": "NOT_FOUND"
  }
}
```

### Polling Strategy
The frontend implements exponential backoff:
- Start: 2 seconds
- Max delay: 30 seconds
- Max attempts: 60
- Formula: `delay = Math.min(delay * 1.5, 30000)`

### Usage Notes
- Job status endpoint may return "not found" if job completed very quickly
- Frontend automatically polls until `completed` or `failed` status
- Visual status updates shown in chat UI during polling

---

## 6. Send Messages (with Automatic RAG)

### Endpoint
```
POST /api/v1/streaming/chat/stream
```

### Purpose
Send a message and receive streaming response. **RAG retrieval is performed automatically** when documents are active in the session.

### Headers
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
```

### Request Body
```json
{
  "message": "What are the key provisions in the estate plan?",
  "conversation_id": "9aaf4ffb-0cf6-4586-85b5-62a397f6c33f",
  "session_id": "9aaf4ffb-0cf6-4586-85b5-62a397f6c33f",
  "matter_id": "MATT-00045",
  "model": "llama3.1",
  "temperature": 0.7,
  "enable_tools": false
}
```

### Request Parameters
- `message` (required): User's question/message (changed from `query`)
- `conversation_id` (optional): UUID for conversation history
- `session_id` (optional): UUID for CDI session tracking (for RAG)
- `matter_id` (optional): Matter ID for context and WARM tier retrieval
- `model` (optional): LLM model to use (default: llama3.1)
- `temperature` (optional): Generation temperature (default: 0.7)
- `enable_tools` (optional): Enable tool calling (default: false)

### RAG Behavior
RAG is **automatically triggered** when:
- Session has documents with `is_active_in_chat = true`
- OR files are explicitly attached in request
- Retrieval uses CDI's three-tier architecture (HOT/WARM/COLD)

### Server-Sent Events (SSE) Response

The endpoint streams multiple event types:

#### 1. Phase Event
```
event: phase
data: {"phase":"retrieving","message":"Searching documents in session and matter..."}

event: phase
data: {"phase":"generating","message":"Generating response..."}
```

#### 2. Retrieval Metrics Event
```
event: retrieval_metrics
data: {
  "scope_used": "matter",
  "hot_chunks": 5,
  "warm_chunks": 8,
  "cold_chunks": 0,
  "total_chunks": 13,
  "confidence": 0.89,
  "trace_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "retrieval_ms": 145
}
```

#### 3. Sources Event
```
event: sources
data: {
  "sources": [
    {
      "doc_id": "6adeff45-f307-4880-b88f-7c77afe5e569",
      "filename": "estate_plan_draft.pdf",
      "score": 0.92,
      "tier": "hot"
    },
    {
      "doc_id": "8b9c7d6e-5f4a-3b2c-1d0e-9f8e7d6c5b4a",
      "filename": "trust_agreement.pdf",
      "score": 0.85,
      "tier": "warm"
    }
  ]
}
```

#### 4. Citations Event
```
event: citations
data: {
  "citations": [
    {
      "chunk_id": 145,
      "doc_id": "6adeff45-f307-4880-b88f-7c77afe5e569",
      "filename": "estate_plan_draft.pdf",
      "page": 3,
      "text": "The grantor retains the right to modify or revoke the trust...",
      "score": 0.92
    }
  ]
}
```

#### 5. Content Event (Streaming)
```
event: content
data: {"content":"The"}

event: content
data: {"content":" estate"}

event: content
data: {"content":" plan"}
```

#### 6. Done Event
```
event: done
data: {"message":"complete"}
```

### CDI Retrieval Tiers

The RAG endpoint uses a three-tier retrieval architecture:

1. **HOT Tier** (Session-activated documents)
   - Documents uploaded in current conversation
   - Full-text search only (<50ms)
   - Always searched first

2. **WARM Tier** (Matter-scoped documents)
   - All documents in the current matter
   - Vector similarity search with doc prefilter (<200ms)
   - Searched if `matter_id` provided

3. **COLD Tier** (Organization-wide documents)
   - All accessible documents in organization
   - Vector similarity with strict filtering (<2s)
   - Searched if scope is `org`

### Usage Notes
- Response is streamed using Server-Sent Events (SSE)
- Frontend uses EventSource API to receive streaming data
- Multiple event types for rich UI feedback
- Automatic fusion of results from multiple tiers
- Retrieval traces logged for audit purposes

---

## Frontend Implementation Reference

### Chat Flow in `chat.html`

The frontend implements this flow as follows:

```javascript
// 1. User selects matter
createProjectChat(matterId, matterName)
  └─> POST /api/v1/chat/sessions
      └─> Sets currentConversationId = thread_id

// 2. User uploads files
uploadPendingFilesToChat()
  └─> POST /api/v1/chat/sessions/:thread_id/files
      └─> Calls pollJobStatus(job_id, filename)
          └─> GET /api/v1/jobs/:job_id (polling)

// 3. User sends message
sendMessage()
  └─> POST /api/v1/streaming/chat/stream  (UPDATED: was /rag/stream)
      └─> EventSource handles streaming events
          ├─> phase event → update thinking message
          ├─> retrieval event → RAG metrics (automatic if docs active)
          ├─> citations → document sources
          ├─> content → stream to chat UI
          └─> done → finalize message with metadata
```

### Key Changes (December 2025)
- **Endpoint:** Changed from `/rag/stream` to `/chat/stream`
- **Parameter:** Changed from `query` to `message`
- **RAG Behavior:** Automatic based on active documents (no manual triggering)
- **New Events:** `retrieval`, `citations` (replacing `retrieval_metrics`, `sources`)

### Document Status Polling

```javascript
async function pollJobStatus(jobId, filename, maxAttempts = 60) {
  let attempts = 0;
  let delay = 2000; // Start with 2 second polling
  const maxDelay = 30000; // Max 30 seconds

  // Show initial status in chat
  addDocumentStatusMessage(jobId, filename, 'queued');

  const poll = async () => {
    const response = await fetch(`${baseUrl}/api/v1/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const job = await response.json();
    const status = job.status || job.state;

    // Update UI with current status
    addDocumentStatusMessage(jobId, filename, status);

    if (status === 'completed' || status === 'failed') {
      return; // Stop polling
    }

    attempts++;
    delay = Math.min(delay * 1.5, maxDelay);
    setTimeout(poll, delay);
  };

  poll();
}
```

---

## Error Handling

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| AUTHENTICATION_ERROR | 401 | Invalid credentials or expired token |
| NOT_FOUND | 404 | Resource not found (conversation, job, file) |
| VALIDATION_ERROR | 400 | Invalid request parameters |
| PERMISSION_DENIED | 403 | User lacks permission for operation |
| SERVER_ERROR | 500 | Internal server error |

### Example Error Response
```json
{
  "error": {
    "message": "Matter not found or access denied",
    "code": "NOT_FOUND",
    "details": {
      "matter_id": "MATT-00045"
    }
  }
}
```

---

## Security Considerations

1. **Authentication**: JWT tokens required for all API calls
2. **Authorization**: Matter access permissions enforced at all tiers
3. **File Permissions**: Document-level access control in WARM/COLD tiers
4. **Session Isolation**: HOT tier documents scoped to conversation
5. **Audit Trail**: All retrievals logged in `retrieval_traces` table

---

## Performance Characteristics

| Endpoint | Typical Latency | Notes |
|----------|-----------------|-------|
| POST /auth/login | 100-300ms | Includes password hashing |
| GET /matters | 50-150ms | Cached, permission-filtered |
| POST /chat/sessions | 50-100ms | Database insert + CDI session creation |
| POST /chat/sessions/:id/files | 500-2000ms | File upload + ingestion trigger |
| GET /jobs/:id | 10-50ms | Direct database lookup |
| POST /streaming/rag/stream | 200-3000ms | Retrieval: 100-500ms, Generation: variable |

### CDI Retrieval Performance Targets
- HOT tier: < 50ms (FTS only)
- WARM tier: < 200ms (vector + prefilter)
- COLD tier: < 2s (vector + strict filter)

---

## Database Schema References

### Tables Used in Chat Flow

1. `conversations` - Chat session metadata
2. `messages` - Individual messages
3. `documents` - Uploaded files
4. `document_chunks` - Chunked text with embeddings
5. `chat_sessions` - CDI session state
6. `session_activated_docs` - HOT tier membership
7. `retrieval_traces` - Audit logs

---

## Testing Summary

Based on testing performed on 2025-12-14 and updated 2025-12-15:

| Endpoint | Status | Notes |
|----------|--------|-------|
| POST /api/v1/auth/login | ✓ Working | Returns valid JWT token |
| GET /api/v1/matters | ✓ Working | Returns matters list |
| POST /api/v1/chat/sessions | ✓ Working | Creates conversation with thread_id |
| POST /api/v1/chat/sessions/:id/files | ✓ Working | Uploads file, returns job_id |
| GET /api/v1/jobs/:id | ⚠ Issue | Returns 404 (may be processed too quickly) |
| POST /api/v1/streaming/chat/stream | ✓ Working | **UNIFIED ENDPOINT** - Includes automatic RAG |
| ~~POST /api/v1/streaming/rag/stream~~ | ❌ Removed | **DEPRECATED** - Removed December 2025 |

---

## Revision History

- **Version 2.0** (2025-12-15): Unified endpoint architecture
  - **BREAKING CHANGE:** Removed `/rag/stream` endpoint
  - RAG now built into `/chat/stream` automatically
  - Updated request parameters (`query` → `message`)
  - Updated SSE event types
  - Documented automatic RAG triggering behavior

- **Version 1.0** (2025-12-14): Initial documentation
  - Documented complete chat flow
  - Added CDI tier architecture
  - Included frontend polling implementation
  - Added error handling and performance notes

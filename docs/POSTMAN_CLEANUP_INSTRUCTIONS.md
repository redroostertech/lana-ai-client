# Postman Collection Cleanup Instructions

## Remove /rag/stream Endpoints

The `/rag/stream` endpoint has been removed from the codebase. RAG functionality is now fully integrated into `/chat/stream`.

### Items to Remove from Postman Collection

The following requests should be **deleted** from the Postman collection:

1. **"RAG Stream"** request (line ~15618)
   - URL: `{{url}}:{{port}}/api/v1/rag/stream`
   - Replaced by: Use `/chat/stream` instead

2. **"RAG Concierge Stream"** (line ~15774)
   - URL: `{{url}}:{{port}}/api/v1/rag/concierge/stream`
   - If this exists, also remove

3. **"Streaming RAG Stream"** (line ~17487)
   - URL: `{{url}}:{{port}}/api/v1/streaming/rag/stream`
   - This is the old/duplicate streaming RAG endpoint

### How to Remove in Postman

**Option 1: Manual Removal in Postman UI**
1. Open Postman
2. Load "LANA-AI-API" collection
3. Search for "RAG Stream"
4. Delete each found request
5. Export the updated collection
6. Replace the file at `postman/LANA-AI-API.postman_collection.json`

**Option 2: Edit JSON Directly** (Advanced)
1. **Backup first:** `cp postman/LANA-AI-API.postman_collection.json postman/LANA-AI-API.postman_collection.json.backup`
2. Open `postman/LANA-AI-API.postman_collection.json` in a text editor
3. Search for `"RAG Stream"` and remove the entire request object (from opening `{` to closing `}`)
4. Ensure JSON remains valid (no trailing commas, brackets balanced)
5. Test by importing into Postman

### Update Documentation in Postman

Also update the description on line ~15515:
- **Old:** "For LLM-generated answers, use /rag/stream"
- **New:** "For LLM-generated answers, use /chat/stream (RAG is automatically integrated)"

---

## New Behavior: RAG in /chat/stream

**How RAG Works Now:**

1. **Automatic:** RAG is automatically performed when:
   - There are active documents in the session
   - User has attached files via `@` mentions

2. **Smart:** RAG is skipped for conversational queries like:
   - "Hello, how are you?"
   - "Thanks!"
   - "What can you help me with?"

3. **Same API:** Use `/chat/stream` for everything
   - Pass `session_id` to link to documents
   - Use `attachments.files` to mention specific documents
   - RAG happens automatically when needed

### Example Request

```json
POST /api/v1/streaming/chat/stream

{
  "message": "What does the contract say about termination?",
  "session_id": "uuid-of-session-with-documents",
  "conversation_id": "uuid-of-conversation",
  "matter_id": "MATT-00001"
}
```

**Response includes:**
- `retrieval` event: RAG metrics
- `citations` event: Document sources
- `message` event: AI response with citations
- `done` event: Completion with token usage

---

## Testing After Cleanup

1. Delete the RAG Stream requests from Postman
2. Test `/chat/stream` with a session that has documents
3. Verify RAG retrieval occurs (check `retrieval` and `citations` events in response)
4. Verify conversational queries skip RAG (check logs)

---

## Files Already Updated

✅ `src/services/processor/routes/streaming.routes.js` - /rag/stream endpoint removed
⏳ `postman/LANA-AI-API.postman_collection.json` - Needs manual cleanup (follow instructions above)
⏳ Documentation files - Will be updated next

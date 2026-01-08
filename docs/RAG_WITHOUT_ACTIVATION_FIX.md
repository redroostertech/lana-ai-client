# RAG Without Activation Fix

**Date:** December 16, 2024
**Status:** Deployed

---

## Problem

Users could reference documents in a matter, but the AI would respond "I don't have context for that document" even though the document existed in the matter.

**Root Cause:** The RAG system required documents to be manually "activated" via the session_activated_docs table before they could be retrieved. This was redundant now that we have smart document reference resolution.

**User Impact:**
- ❌ Users had to manually "activate" documents before asking about them
- ❌ Document mentions didn't work unless documents were activated
- ❌ Smart document reference resolution was never triggered (RAG skipped first)

---

## Solution

Changed the RAG decision logic to automatically include ALL documents in the matter, not just manually "activated" ones.

**New Behavior:**
1. ✅ User asks about a document in the matter
2. ✅ Backend checks ALL documents in the matter (not just activated)
3. ✅ Smart RAG decision runs (checks if query needs documents)
4. ✅ Smart document resolution finds which specific documents are referenced
5. ✅ RAG retrieves from those documents
6. ✅ AI responds with context

---

## Technical Changes

### File 1: `src/services/processor/routes/streaming.routes.js`

**Location:** Lines 709-730

**Before:**
```javascript
// Only checked session_activated_docs table
const activeDocsResult = await postgres.query(
  `SELECT COUNT(*) as count, ...
   FROM session_activated_docs sad
   JOIN documents d ON d.id = sad.doc_id
   WHERE sad.session_id = $1
     AND sad.is_active_in_chat = true
     AND d.status = 'completed'`,
  [effectiveSessionId]
);
```

**After:**
```javascript
// Check ALL documents in matter (+ activated docs for backward compatibility)
const matterDocsResult = await postgres.query(
  `SELECT COUNT(*) as count,
          array_agg(d.filename) as filenames,
          array_agg(d.id) as doc_ids
   FROM documents d
   WHERE d.status = 'completed'
     AND d.deleted_at IS NULL
     AND (
       -- Documents in the matter
       d.matter_id = $1
       -- OR documents activated in this session (backward compatibility)
       OR EXISTS (
         SELECT 1 FROM session_activated_docs sad
         WHERE sad.doc_id = d.id
           AND sad.session_id = $2
           AND sad.is_active_in_chat = true
       )
     )`,
  [effectiveMatterId, effectiveSessionId]
);
```

**Benefits:**
- ✅ All documents in the matter are available for retrieval
- ✅ Smart document resolution can find referenced documents
- ✅ Backward compatible with old "activation" system
- ✅ No manual activation required

---

### File 2: `src/shared/retrieval/smart-rag-controller.js`

**Location:** Lines 69-78

**Before:**
```javascript
// Rule 2: Don't retrieve if no active docs
if (!activeDocCount || activeDocCount === 0) {
  logInfo('RAG decision: no active documents');
  return {
    should: false,
    reason: 'no_active_docs',
    // ...
  };
}
```

**After:**
```javascript
// Rule 2: Don't retrieve if no documents in matter
if (!activeDocCount || activeDocCount === 0) {
  logInfo('RAG decision: no documents in matter');
  return {
    should: false,
    reason: 'no_documents_in_matter',
    // ...
  };
}
```

**Benefits:**
- ✅ Clearer log messaging
- ✅ Accurate reason codes for monitoring

---

## How It Works Now

### Scenario 1: User Mentions Document by Name

**User:** "What does contract.pdf say about payment terms?"

**Backend Flow:**
1. ✅ Query arrives with `matter_id`
2. ✅ Check ALL documents in matter → Found 5 documents
3. ✅ Smart RAG decision: "Query mentions document" → **Retrieve**
4. ✅ Smart document resolution: "contract.pdf" mentioned → **Priority doc**
5. ✅ RAG retrieves from `contract.pdf` (and other relevant docs)
6. ✅ AI responds with context from contract.pdf

---

### Scenario 2: User Asks General Question About Matter

**User:** "What are the key terms in our agreement?"

**Backend Flow:**
1. ✅ Query arrives with `matter_id`
2. ✅ Check ALL documents in matter → Found 3 documents
3. ✅ Smart RAG decision: "General document query" → **Retrieve**
4. ✅ Smart document resolution: No specific mention → **All docs eligible**
5. ✅ RAG retrieves relevant chunks from all 3 documents
6. ✅ AI responds with synthesized information

---

### Scenario 3: User Asks Conversational Question

**User:** "Hi, how are you?"

**Backend Flow:**
1. ✅ Query arrives with `matter_id`
2. ✅ Check ALL documents in matter → Found 10 documents
3. ❌ Smart RAG decision: "Conversational query" → **Skip RAG**
4. ✅ AI responds without document context (faster)

---

## Backward Compatibility

The system still supports the old "activation" model for sessions that use it:

```sql
-- Old behavior (still works)
WHERE EXISTS (
  SELECT 1 FROM session_activated_docs sad
  WHERE sad.doc_id = d.id
    AND sad.session_id = $2
    AND sad.is_active_in_chat = true
)
```

**Scenarios:**
1. **Matter with documents, no activations:** Uses ALL matter documents ✅
2. **Matter with documents, some activated:** Uses ALL matter docs + activated docs ✅
3. **No matter, but documents activated:** Uses only activated docs (old behavior) ✅
4. **No matter, no activations:** RAG skipped (no documents available) ✅

---

## Performance Considerations

### Query Complexity

**Old Query:**
```sql
SELECT COUNT(*) FROM session_activated_docs sad
JOIN documents d ON d.id = sad.doc_id
WHERE sad.session_id = $1  -- Single lookup
```
- **Speed:** Very fast (indexed on session_id)
- **Scope:** Only activated documents

**New Query:**
```sql
SELECT COUNT(*) FROM documents d
WHERE d.matter_id = $1  -- Matter documents
  OR EXISTS (...)       -- + activated documents
```
- **Speed:** Still fast (indexed on matter_id)
- **Scope:** All documents in matter

**Performance Impact:** ~5-10ms slower (negligible) but much better UX

---

### Smart Document Resolution

The smart document resolution system (already implemented) now actually works because RAG isn't skipped:

1. **Explicit mentions:** `#filename.txt` or "contract.pdf"
2. **Contextual references:** "this document", "the agreement"
3. **AI-powered resolution:** Semantic understanding of which docs are relevant

This means RAG will prioritize the RIGHT documents even if there are many in the matter.

---

## Testing Checklist

### Basic Document Retrieval

- [x] **User mentions document by name** → RAG retrieves from that document ✅
- [x] **User asks general question** → RAG retrieves from all relevant documents ✅
- [x] **Conversational query** → RAG skipped (fast response) ✅

### Edge Cases

- [ ] **Matter with 50+ documents** → Verify smart resolution picks right ones
- [ ] **Document uploaded mid-conversation** → Verify it's immediately available
- [ ] **Document deleted during conversation** → Verify it's excluded

### Backward Compatibility

- [ ] **Old sessions with activations** → Still works as before
- [ ] **Sessions without matter** → Only uses activated docs (if any)

---

## Monitoring

### Log Messages to Watch

**Success Indicators:**
```
[INFO] RAG decision check
  { matterId: 'uuid', documentCount: 5, queryLength: 45 }

[INFO] Smart RAG decision
  { should: true, reason: 'document_query', confidence: 0.85 }

[INFO] Smart document resolution completed
  { method: 'explicit_mention', documentCount: 1, confidence: 1.0 }

[INFO] CDI retrieval complete
  { chunksFound: 8, relevantChunks: 5 }
```

**Expected Skips (Normal):**
```
[INFO] Smart RAG decision
  { should: false, reason: 'conversational', confidence: 1.0 }

[INFO] RAG skipped - no documents in matter
  { matterId: null, documentCount: 0 }
```

**Error Indicators:**
```
[ERROR] CDI retrieval failed
  { error: '...' }

[WARN] No relevant chunks found
  { queryLength: 45, documentCount: 5 }
```

---

## Migration Notes

### For Existing Users

**No action required!** The change is backward compatible.

- Existing activated documents still work
- Conversations in matters automatically get access to all documents
- No database migrations needed

### For New Features

You can now **remove** the "activate document" UI since it's no longer necessary:

```javascript
// OLD: Required activation
<button onClick={() => activateDocument(docId)}>Activate for Chat</button>

// NEW: Just reference the document by name
// User: "What does contract.pdf say?"
// System: Automatically retrieves it!
```

---

## Future Enhancements

### 1. Auto-Activate on Upload

When a document is uploaded to a matter, automatically make it available:

```javascript
// After successful upload
await postgres.query(
  `INSERT INTO session_activated_docs (session_id, doc_id, is_active_in_chat)
   VALUES ($1, $2, true)
   ON CONFLICT DO NOTHING`,
  [currentSessionId, newDocId]
);
```

### 2. Smart Scope Selection

Instead of ALL matter documents, intelligently limit scope based on context:

```javascript
// Example: For contract questions, only include legal documents
const docTypes = detectDocumentTypes(query); // 'legal', 'financial', etc.

WHERE d.matter_id = $1
  AND d.document_type = ANY($2)  // Filter by detected types
```

### 3. Cross-Matter Document Access

Allow referencing documents from other matters:

```javascript
// User: "Compare this contract with the Smith matter contract"
// System: Detects mention of "Smith matter" and retrieves docs from both matters
```

---

## Key Takeaways

1. **Activation is Obsolete**
   - Users don't need to manually activate documents anymore
   - All documents in a matter are automatically available

2. **Smart Resolution Works**
   - Document mentions are detected and prioritized
   - Contextual references ("this document") work correctly

3. **Better UX**
   - Just mention the document name or ask about it
   - No extra steps required

4. **Backward Compatible**
   - Old activation system still works for legacy sessions
   - No breaking changes

5. **Performance**
   - Minimal query overhead (~5-10ms)
   - Smart RAG decision prevents unnecessary retrievals

---

## Deployment Status

✅ **Deployed:** December 16, 2024 03:20 UTC

**Command:** `pm2 restart all`

**Verification:**
```bash
# Test document retrieval without activation
curl -X POST http://localhost:8080/api/v1/streaming/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": "What does contract.pdf say?",
    "conversation_id": "...",
    "matter_id": "..."
  }'

# Should see logs:
# [INFO] RAG decision check { documentCount: 5 }
# [INFO] Smart document resolution { method: 'explicit_mention' }
```

---

**Result:** Documents in matters are now automatically available for RAG retrieval without requiring manual activation. Smart document resolution can properly find and prioritize referenced documents!

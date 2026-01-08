# Full Document Retrieval Implementation - Critical Review

**Date:** 2025-12-16
**Reviewer:** Claude Code
**Files Reviewed:**
- `src/services/processor/routes/streaming.routes.js` (lines 708-1086)
- `src/shared/retrieval/retrieval.service.js` (line 514)

---

## ✅ STRENGTHS

### 1. **SQL Injection Prevention**
- ✅ All queries use parameterized placeholders (`$1`, `$2`, etc.)
- ✅ No string concatenation in SQL
- ✅ Type casting for safety (`::uuid[]`)
- ✅ Matches security standards from RAG retrieval

### 2. **Authorization & Privilege Checks**
- ✅ Matter access verification via `matter_access_permissions`
- ✅ Privilege status checks (`d.privilege_status`)
- ✅ Per-file permissions for privileged documents
- ✅ Identical security model to RAG retrieval (consistent)

### 3. **Architecture**
- ✅ Clean separation of concerns (size check, full load, RAG fallback)
- ✅ Intent-based routing (summary vs. search)
- ✅ Progressive enhancement (full → enhanced RAG → standard RAG)
- ✅ Proper logging at each decision point

### 4. **Error Handling**
- ✅ Try-catch blocks in all async functions
- ✅ Graceful degradation (returns empty arrays on error)
- ✅ Error messages preserved for debugging
- ✅ SSE notifications on errors

---

## 🚨 CRITICAL ISSUES

### **ISSUE #1: Enhanced RAG Budget Not Applied**
**Severity:** HIGH
**Location:** `streaming.routes.js:1035-1044`

```javascript
// Enhanced budget is created but NEVER USED
const enhancedTokenBudget = {
  ...tokenBudget,
  maxChunks: Math.min(100, tokenBudget?.maxChunks * 2 || 60)
};

// Falls through to standard RAG retrieval WITHOUT passing enhancedTokenBudget
const retrievalResult = await retrievalService.retrieve({
  orgId,
  sessionId,
  userId,
  messageId: crypto.randomUUID(),
  queryText: message,
  activeMatterId: matterId,
  prioritizeDocIds: documentResolution.documentIds
  // ❌ MISSING: budgetsOverride parameter
});
```

**Impact:**
- Large document summaries use standard chunk budget (30 chunks)
- Enhanced RAG provides no benefit over regular RAG
- User gets incomplete summaries despite the code claiming "enhanced RAG"

**Fix Required:**
```javascript
const retrievalResult = await retrievalService.retrieve({
  orgId,
  sessionId,
  userId,
  messageId: crypto.randomUUID(),
  queryText: message,
  activeMatterId: matterId,
  prioritizeDocIds: documentResolution.documentIds,
  budgetsOverride: {
    warmChunkBudget: enhancedTokenBudget.maxChunks  // ✅ Pass enhanced budget
  }
});
```

---

### **ISSUE #2: Context Window Overflow Risk**
**Severity:** HIGH
**Location:** `streaming.routes.js:995`

```javascript
const useFullDocument = sizeInfo.totalChunks <= 100 ||
                       (sizeInfo.avgChunksPerDoc <= 50 && sizeInfo.documentCount <= 3);
```

**Problem:** No consideration for actual context window limits or existing context usage.

**Token Math:**
- 100 chunks × 500 words/chunk × 1.3 tokens/word ≈ **65,000 tokens**
- Ollama models: qwen2.5-14b has **32k context window**
- This EXCEEDS the context window before accounting for:
  - System prompt (~1,000 tokens)
  - Conversation history (~2,000-10,000 tokens)
  - User message (~100-500 tokens)
  - Response buffer (~2,000 tokens)

**Real Available Space:** 32k - 5k overhead = **~27k tokens for documents**
**Safe Chunk Limit:** 27k ÷ 650 tokens/chunk ≈ **~40 chunks max**

**Impact:**
- LLM truncates context silently
- User gets incomplete summaries without warning
- Potential inference errors or crashes

**Fix Required:**
```javascript
// Account for conversation context
const contextOverhead = 5000; // System + history + message + response buffer
const availableTokens = (session.tokenBudget?.contextWindow || 32000) - contextOverhead;
const tokensPerChunk = 650; // Conservative estimate
const maxSafeChunks = Math.floor(availableTokens / tokensPerChunk);

const useFullDocument = sizeInfo.totalChunks <= maxSafeChunks ||
                       (sizeInfo.avgChunksPerDoc <= (maxSafeChunks / 2) &&
                        sizeInfo.documentCount <= 3);
```

---

### **ISSUE #3: No LIMIT Clause in Full Document Query**
**Severity:** MEDIUM
**Location:** `streaming.routes.js:721-762`

```javascript
const result = await dbQuery(`
  SELECT ...
  FROM documents d
  INNER JOIN document_chunks c ON c.document_id = d.id
  WHERE d.id = ANY($1::uuid[])
  ...
  ORDER BY d.id, c.chunk_index ASC
  -- ❌ NO LIMIT CLAUSE
`, [documentIds, orgId, matterId, userId]);
```

**Problem:** Query can return unlimited rows.

**Scenarios:**
- Malicious user passes 100 document IDs
- Each document has 500 chunks
- Query returns **50,000 rows** → OOM crash

**Impact:**
- Memory exhaustion
- Slow queries (10+ seconds)
- Database connection timeout
- Denial of service vector

**Fix Required:**
```javascript
// Add safety limit AFTER the size check passes
const MAX_CHUNKS_ABSOLUTE = 150; // Hard limit regardless of size check

const result = await dbQuery(`
  SELECT ...
  FROM documents d
  INNER JOIN document_chunks c ON c.document_id = d.id
  WHERE d.id = ANY($1::uuid[])
  ...
  ORDER BY d.id, c.chunk_index ASC
  LIMIT $5  -- ✅ Hard safety limit
`, [documentIds, orgId, matterId, userId, MAX_CHUNKS_ABSOLUTE]);
```

---

### **ISSUE #4: Missing Index for Performance**
**Severity:** MEDIUM
**Location:** `streaming.routes.js:761`

```javascript
ORDER BY d.id, c.chunk_index ASC
```

**Problem:** No composite index on `(document_id, chunk_index)` confirmed.

**Impact:**
- Slow sorts for large documents (100+ chunks)
- Filesort on disk instead of index scan
- 200-500ms query time vs. 5-20ms with index

**Verification Needed:**
```sql
-- Check if index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'document_chunks'
  AND indexdef LIKE '%chunk_index%';
```

**Fix Required (Migration):**
```sql
-- Create composite index for ordered chunk retrieval
CREATE INDEX CONCURRENTLY idx_document_chunks_ordered
ON document_chunks (document_id, chunk_index);
```

---

## ⚠️ MODERATE ISSUES

### **ISSUE #5: No Token Counting**
**Severity:** MEDIUM
**Location:** `streaming.routes.js:848-853`

**Problem:** Returns chunks without calculating actual token count.

```javascript
return {
  chunks: allChunks,
  citations,
  retrievalMethod: 'full_document',
  traceId: crypto.randomUUID()
  // ❌ No token count metadata
};
```

**Impact:**
- Downstream code can't verify context window fit
- No metrics for token budget tracking
- Silent truncation if context exceeded

**Fix Required:**
```javascript
// Calculate total tokens
const totalTokens = allChunks.reduce((sum, chunk) => {
  return sum + estimateTokenCount(chunk.content);
}, 0);

return {
  chunks: allChunks,
  citations,
  retrievalMethod: 'full_document',
  traceId: crypto.randomUUID(),
  metrics: {
    totalChunks: allChunks.length,
    totalTokens,
    estimatedContextUsage: totalTokens + 5000 // Include overhead
  }
};
```

---

### **ISSUE #6: Race Condition on Document Size Check**
**Severity:** LOW
**Location:** `streaming.routes.js:982` + `streaming.routes.js:1006`

**Problem:** Size check and full load are separate queries.

**Scenario:**
1. Size check: 80 chunks → "safe to load"
2. **[Document processor adds 50 chunks]**
3. Full load: Returns 130 chunks → context overflow

**Likelihood:** Low (processing usually slower than retrieval)

**Fix:** Could use transaction or single query, but overhead may not be worth it.

---

## 📋 RECOMMENDATIONS

### **Priority 1: FIX IMMEDIATELY** (Before Production)

1. ✅ **Fix Enhanced RAG Budget** - Pass `budgetsOverride` to retrieval service
2. ✅ **Fix Context Window Limits** - Use actual token budget, not hardcoded thresholds
3. ✅ **Add LIMIT Clause** - Prevent unbounded queries

### **Priority 2: FIX SOON** (Before Heavy Usage)

4. ⚠️ **Add Database Index** - Improve query performance
5. ⚠️ **Add Token Counting** - Track context usage accurately

### **Priority 3: NICE TO HAVE**

6. 📝 **Add Monitoring** - Log when documents exceed safe size
7. 📝 **Add User Warnings** - Notify when falling back to RAG for large docs
8. 📝 **Add Rate Limiting** - Prevent abuse of full document loading

---

## 🎯 TESTING CHECKLIST

Before deploying, test:

- [ ] Small document (5 chunks) → Full text loaded
- [ ] Medium document (60 chunks) → Full text or enhanced RAG
- [ ] Large document (200 chunks) → Enhanced RAG used
- [ ] Multiple documents (3 × 30 chunks) → Strategy chosen correctly
- [ ] Malicious input (100 doc IDs) → Fails gracefully with LIMIT
- [ ] Context overflow → Doesn't crash LLM
- [ ] Privileged document → Access denied without permission
- [ ] Enhanced RAG → Actually returns more chunks than standard

---

## 📊 SECURITY SUMMARY

| Category | Status | Notes |
|----------|--------|-------|
| **SQL Injection** | ✅ SAFE | Parameterized queries throughout |
| **Authorization** | ✅ SAFE | Privilege checks match RAG retrieval |
| **DoS/Resource** | 🚨 AT RISK | No LIMIT clause, context overflow possible |
| **Data Integrity** | ✅ SAFE | Error handling prevents corruption |
| **Token Budget** | 🚨 AT RISK | Not respecting context window limits |

---

## 💡 ADDITIONAL NOTES

### Redis for Caching
User confirmed **no Redis in use**. For map-reduce caching (future), use:
- PostgreSQL temporary tables
- In-memory Map with TTL
- File-based cache (dev only)

### Map-Reduce Implementation
When implementing map-reduce for large docs:
- Use actual token budget from session
- Batch size should respect context window
- Cache batch summaries in PostgreSQL (metadata table)
- Stream progress via SSE to frontend

---

**Status:** Implementation has architectural soundness but requires critical fixes before production use.

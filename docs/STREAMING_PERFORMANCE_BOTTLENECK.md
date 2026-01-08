# Streaming Performance Bottleneck Analysis

**Date:** December 16, 2024
**Status:** Identified - Needs Optimization

---

## Problem

Streaming responses are taking too long to start (nearly 2 minutes reported for simple queries). The SSE stream appears to "hang" before any content is sent to the client.

---

## Root Cause

The streaming endpoint performs extensive **blocking operations** between establishing the SSE connection and calling Ollama. The client sees a "thinking" indicator but receives no actual stream data during this time.

### Blocking Operations Timeline

From `/api/v1/streaming/chat/stream` (`src/services/processor/routes/streaming.routes.js`):

| Line | Operation | Type | Impact |
|------|-----------|------|--------|
| 401-405 | Set SSE headers, flush | Setup | ✅ Fast |
| 447 | Send 'connected' event | SSE | ✅ Fast |
| 485-532 | Build system context | DB + Cache | ⚠️ ~4ms (cached), ~50-100ms (uncached) |
| **545-551** | **Fetch ALL conversation history** | **DB Query** | **⚠️ Scales with conversation length** |
| **553-572** | **Loop through ALL messages** | **Synchronous .map()** | **🔴 BLOCKING - scales with message count** |
| 558-562 | Backfill token counts | DB Updates (async) | ⚠️ Fired but not awaited |
| 588-592 | Smart summarization | CPU + logic | ⚠️ Scales with history size |
| 621-645 | Save user message | DB Insert | ⚠️ ~10-20ms |
| 661-777 | RAG operations | DB Queries + Vector Search | ⚠️ ~50-200ms (if enabled) |
| 1055 | Log "Starting Ollama chat stream" | Logging | ✅ Fast |
| 1123 | **Call Ollama** | **AI Generation** | **Finally starts streaming!** |

---

## Critical Bottleneck: Message History Loop

**Location:** `streaming.routes.js:553-572`

```javascript
const allMessages = historyResult.rows.map(row => {
  // BLOCKING: Calculate token count for EVERY message
  const tokenCount = row.token_count || TokenCounter.count(row.content);

  // Fire off UPDATE queries for missing token counts
  if (!row.token_count) {
    postgres.query(
      `UPDATE conversations SET token_count = $1 WHERE id = $2`,
      [tokenCount, row.id]
    ).catch(err => console.warn('Failed to backfill token count:', err.message));
  }

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    token_count: tokenCount
  };
});
```

**Why This is Problematic:**

1. **Synchronous Loop:** `.map()` is a synchronous operation - blocks the entire event loop
2. **Token Calculation:** `TokenCounter.count(row.content)` runs for EVERY message missing a token count
3. **Scales Linearly:** 100 messages = 100 iterations, 500 messages = 500 iterations
4. **No Early Exit:** Processes ALL messages even if summarization will only use 10

**Example Impact:**
- 50 messages × 2ms/token calculation = **100ms blocked**
- 200 messages × 2ms/token calculation = **400ms blocked**
- 500 messages × 2ms/token calculation = **1000ms (1 second) blocked**

---

## Secondary Bottlenecks

### 1. Conversation History Query (Line 545-551)

```javascript
const historyResult = await postgres.query(
  `SELECT id, role, content, matter_id, token_count, created_at
   FROM conversations
   WHERE thread_id = $1 AND user_id = $2 AND role != 'system'
   ORDER BY created_at ASC`,
  [conversation_id, req.user.id]
);
```

**Issue:**
- Fetches ALL messages in conversation (no LIMIT)
- Long conversations = larger result set = slower query
- No pagination or lazy loading

**Impact:**
- 50 messages: ~10-20ms
- 200 messages: ~30-50ms
- 1000 messages: ~100-200ms

### 2. Smart Summarization (Line 588-592)

```javascript
const summaryResult = await ConversationSummarizer.smartSelect(
  allMessages,
  message,
  tokenBudget.budgets.history
);
```

**Issue:**
- Processes ALL messages to select relevant ones
- Token counting for all messages
- Relevance scoring

**Impact:** Scales with message count (needs profiling)

### 3. RAG Operations (Line 661-777)

**Only if RAG is enabled (skipped for conversational queries)**

```javascript
// Check active documents
const activeDocsResult = await postgres.query(...);

// Resolve document references
documentResolution = await smartDocumentReferenceService.resolveDocumentReferences(...);

// Perform RAG retrieval
const retrievalResult = await retrievalService.retrieve(...);
```

**Impact:**
- Document check: ~10ms
- Reference resolution: ~20-50ms
- Vector retrieval: ~50-200ms
- **Total: ~80-260ms** (when enabled)

---

## Measured Performance

From PM2 logs for "Nope you were correct" message:

```
System context built with caching
  userId: aed92090-b669-4ef8-a21c-5b4a021d4952
  tokens: 1030
  cached: true
  truncated: false
  durationMs: 4  ← System context: 4ms (excellent!)
```

```
Smart RAG decision
  should: false
  reason: Conversational query - no retrieval needed  ← RAG skipped (good!)
```

```
Agentic loop iteration
  iteration: 1
  messageCount: 8  ← Only 8 messages in history
```

**Analysis:**
- System context: **4ms** (cached) ✅
- RAG: **Skipped** (conversational query) ✅
- Message count: **8** (small conversation) ✅

**Conclusion:** The backend processing is actually **FAST** for this case. The slowness is likely:
1. **Ollama generation itself** (model running at 88% CPU/12% GPU)
2. **Network latency** between backend and Ollama
3. **Model context size** causing slower token generation

---

## Solutions

### Solution 1: Send "Thinking" Event Immediately (Quick Fix)

Send a visible "thinking" event **before** any blocking operations:

```javascript
// RIGHT AFTER setting SSE headers (line 405)
res.flushHeaders();

// Send thinking event BEFORE any DB queries
sendSSE(res, 'thinking', {
  message: 'Preparing response...',
  phase: 'initializing'
});

// THEN do blocking operations
const systemContext = await buildSystemContext(...);
```

**Benefit:** User sees immediate feedback, even if backend is processing

---

### Solution 2: Optimize Message Loop (Medium Priority)

**Option A: Pre-calculate Token Counts in Background Worker**

Don't calculate tokens during request - do it asynchronously:

```javascript
// Remove token calculation from request path
const allMessages = historyResult.rows.map(row => ({
  id: row.id,
  role: row.role,
  content: row.content,
  created_at: row.created_at,
  token_count: row.token_count || 0 // Use 0 if missing, estimate later
}));

// Queue background job to backfill missing tokens
if (historyResult.rows.some(r => !r.token_count)) {
  queueTokenBackfillJob(conversation_id);
}
```

**Option B: Limit History Query**

Only fetch recent messages + important older messages:

```javascript
// Fetch only last 100 messages instead of ALL
const historyResult = await postgres.query(
  `SELECT id, role, content, matter_id, token_count, created_at
   FROM conversations
   WHERE thread_id = $1 AND user_id = $2 AND role != 'system'
   ORDER BY created_at DESC
   LIMIT 100`,
  [conversation_id, req.user.id]
);
```

**Option C: Use Async Iterator Instead of .map()**

Process messages incrementally:

```javascript
const allMessages = [];
for (const row of historyResult.rows) {
  const tokenCount = row.token_count || estimateTokenCount(row.content);
  allMessages.push({ ...row, token_count: tokenCount });

  // Yield to event loop every 10 messages
  if (allMessages.length % 10 === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
}
```

---

### Solution 3: Parallelize Independent Operations (High Performance)

Run independent operations in parallel:

```javascript
// Current: Sequential (slow)
const systemContext = await buildSystemContext();
const historyResult = await fetchHistory();
const ragDecision = await checkRAG();

// Optimized: Parallel (fast)
const [systemContext, historyResult, ragDecision] = await Promise.all([
  buildSystemContext(),
  fetchHistory(),
  checkRAG()
]);
```

**Caution:** Some operations depend on others (e.g., summarization needs history first)

---

### Solution 4: Investigate Ollama Performance (Current Issue)

The logs show backend is fast, but user experiences slow streaming. Likely causes:

1. **Ollama Model Speed:**
   - `llama3.1:8b-32k` running at 88% CPU/12% GPU
   - Context window: 8192 (not using full 32K capacity?)
   - Check if model is CPU-bound

2. **Check Ollama Logs:**
   ```bash
   journalctl -u ollama -f  # If systemd service
   # or
   docker logs -f ollama    # If Docker
   # or
   ollama logs              # If standalone
   ```

3. **Test Ollama Directly:**
   ```bash
   time curl http://localhost:11434/api/generate -d '{
     "model": "llama3.1:8b-32k",
     "prompt": "Nope you were correct",
     "stream": true
   }'
   ```

4. **Check Context Size:**
   - Verify Ollama is receiving reasonable context size
   - Check if 32K context window is actually being used
   - Large context = slower generation

---

## Recommendations

### Immediate (Today):

1. ✅ **Send thinking event before blocking operations** (Solution 1)
2. ✅ **Test Ollama directly** to isolate bottleneck (Solution 4)
3. ✅ **Check Ollama logs** for generation timing

### Short-term (This Week):

1. **Limit history query to 100 messages** (Solution 2, Option B)
2. **Remove token calculation from request path** (Solution 2, Option A)
3. **Profile ConversationSummarizer.smartSelect()** to measure impact

### Long-term (Next Sprint):

1. **Parallelize independent operations** (Solution 3)
2. **Implement streaming optimizations** (lazy load history as needed)
3. **Consider model upgrade** (if Ollama is bottleneck)

---

## Testing Plan

### 1. Isolate Ollama Performance

```bash
# Test Ollama generation speed directly
time curl -X POST http://localhost:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b-32k",
    "prompt": "Nope you were correct",
    "stream": true
  }'
```

**Expected:** Should stream tokens immediately if Ollama is healthy

### 2. Test With Different Conversation Lengths

- Empty conversation (0 messages)
- Short conversation (10 messages)
- Medium conversation (100 messages)
- Long conversation (500+ messages)

**Measure:** Time from request to first token

### 3. Profile Token Calculation

```javascript
// Add timing to message loop
const startLoop = Date.now();
const allMessages = historyResult.rows.map(row => {
  const tokenCount = row.token_count || TokenCounter.count(row.content);
  return { ...row, token_count };
});
const loopDuration = Date.now() - startLoop;
console.log(`Message loop took ${loopDuration}ms for ${allMessages.length} messages`);
```

---

## Key Metrics to Monitor

1. **Time to First Token (TTFT):** Time from request to first SSE chunk
2. **Backend Processing Time:** Time from request to Ollama call (line 1123)
3. **Ollama Generation Time:** Time Ollama takes to generate response
4. **Total Response Time:** Time from request to final message saved

**Target:**
- TTFT: < 200ms
- Backend Processing: < 100ms
- Ollama Generation: Depends on model (baseline needed)

---

## Current Status

**Identified Issues:**
- ✅ Blocking message loop scales with conversation length
- ✅ No immediate feedback to user during processing
- ⚠️ Ollama generation speed unknown (needs testing)

**Next Steps:**
1. Test Ollama directly to measure generation speed
2. Implement immediate thinking event
3. Profile message loop with various conversation lengths

---

**Status:** Investigation in progress. Backend appears optimized, suspect Ollama model performance or network latency.

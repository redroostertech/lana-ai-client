# Actual Token Tracking from Ollama

**Date:** 2024-12-16
**Status:** ✅ IMPLEMENTED
**Impact:** Accurate token usage tracking instead of estimates

---

## Problem Statement

### Before (Using Estimates)

```javascript
// Using GPT-3 encoder to estimate tokens
const TokenCounter = require('./token-counter.util');
const estimatedTokens = TokenCounter.count(prompt); // ~10% variance

// Problems:
// ❌ Estimates, not actual counts
// ❌ ~10% variance from actual Llama tokenization
// ❌ Falls back to "4 chars = 1 token" heuristic
// ❌ No visibility into actual usage
```

**Issues:**
- Inaccurate billing/analytics
- Can't optimize based on actual usage
- No ground truth for tuning
- Estimates can compound over session

---

## Solution: Capture Actual Counts from Ollama

### What Ollama Provides

Every Ollama response includes **actual token counts**:

```json
{
  "message": {
    "content": "The response text..."
  },
  "done": true,
  "prompt_eval_count": 156,        // ← ACTUAL INPUT TOKENS
  "eval_count": 298,                // ← ACTUAL OUTPUT TOKENS
  "total_duration": 5589157584,
  "load_duration": 3013701,
  "prompt_eval_duration": 130079000,
  "eval_duration": 5455806000
}
```

**Key Fields:**
- `prompt_eval_count` - Actual tokens in the prompt (input)
- `eval_count` - Actual tokens generated (output)
- Durations for performance analysis

---

## Implementation

### 1. ✅ ActualTokenTracker Service

**File:** `src/shared/context/actual-token-tracker.js`

**Purpose:** Track actual token usage from Ollama responses

**Features:**
- Session-level tracking
- Per-request granularity
- Aggregate statistics
- Comparison with estimates
- Automatic cleanup

**Usage:**
```javascript
const { getActualTokenTracker } = require('../context/actual-token-tracker');
const tracker = getActualTokenTracker();

// Initialize session
tracker.initSession(sessionId, {
  organizationId: 'org-123',
  userId: 'user-456',
  matterId: 'matter-789'
});

// Record usage after Ollama response
const result = await ollamaService.generateChatWithTools(...);
tracker.recordUsage(sessionId, result.metadata, {
  model: 'llama3.1:8b-32k',
  operation: 'chat',
  intentType: 'document_query'
});

// Get stats
const stats = tracker.getSessionStats(sessionId);
console.log(`Total tokens used: ${stats.totalTokens}`);
console.log(`Requests: ${stats.requestCount}`);
console.log(`Avg per request: ${stats.averageTotalPerRequest}`);

// End session
await tracker.endSession(sessionId);
```

---

### 2. ✅ Modified Ollama Service

**File:** `src/shared/services/ollama.service.js`

**Changes:**
- Captures token metadata from Ollama responses
- Returns metadata with content and tool_calls
- Works for both streaming and non-streaming

**Response Format:**
```javascript
{
  content: "The response text...",
  tool_calls: [...],
  metadata: {
    prompt_eval_count: 156,  // Actual input tokens
    eval_count: 298,          // Actual output tokens
    total_duration: 5589157584,
    prompt_eval_duration: 130079000,
    eval_duration: 5455806000
  }
}
```

**Example:**
```javascript
const result = await ollamaService.generateChatWithTools(
  messages,
  { model: 'llama3.1:8b-32k' },
  tools,
  (chunk) => console.log(chunk)
);

console.log(`Input tokens: ${result.metadata.prompt_eval_count}`);
console.log(`Output tokens: ${result.metadata.eval_count}`);
console.log(`Total: ${result.metadata.prompt_eval_count + result.metadata.eval_count}`);
```

---

## Integration Example

### Streaming Routes Integration

**File:** `src/services/processor/routes/streaming.routes.js`

```javascript
const { getActualTokenTracker } = require('../../shared/context/actual-token-tracker');

async function handleChatStream(req, res) {
  const sessionId = req.sessionId;
  const tracker = getActualTokenTracker();

  // Initialize tracking
  tracker.initSession(sessionId, {
    organizationId: req.user.organizationId,
    userId: req.user.id,
    matterId: req.body.matter_id
  });

  // ... chat logic ...

  // Call Ollama
  const result = await ollamaService.generateChatWithTools(
    messages,
    { model: 'llama3.1:8b-32k' },
    tools,
    (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`);
    }
  );

  // Record actual usage
  tracker.recordUsage(sessionId, result.metadata, {
    model: 'llama3.1:8b-32k',
    operation: 'chat_streaming',
    intentType: intent.type,
    hasDocuments: documentCount > 0,
    toolsUsed: result.tool_calls?.map(tc => tc.function?.name) || []
  });

  // Get session stats
  const stats = tracker.getSessionStats(sessionId);

  // Send final event with usage
  res.write(`data: ${JSON.stringify({
    type: 'complete',
    usage: {
      inputTokens: result.metadata.prompt_eval_count,
      outputTokens: result.metadata.eval_count,
      totalTokens: result.metadata.prompt_eval_count + result.metadata.eval_count,
      sessionTotal: stats.totalTokens,
      requestCount: stats.requestCount
    }
  })}\n\n`);

  res.end();

  // Clean up (optional - tracker auto-cleans after 1 hour)
  // await tracker.endSession(sessionId);
}
```

---

## Comparison: Estimates vs Actual

### Test the Accuracy

```javascript
const { TokenCounter } = require('../utils/token-counter.util');
const { getActualTokenTracker } = require('../context/actual-token-tracker');

// Before calling Ollama
const estimatedInput = TokenCounter.count(prompt);
const estimatedOutput = 500; // Rough guess

// Call Ollama
const result = await ollamaService.generateChatWithTools(...);

// Compare
const tracker = getActualTokenTracker();
const comparison = tracker.compareWithEstimate(sessionId, {
  input: estimatedInput,
  output: estimatedOutput,
  total: estimatedInput + estimatedOutput
}, result.metadata);

console.log('Comparison:', comparison);
/*
{
  estimated: { input: 150, output: 500, total: 650 },
  actual: { input: 156, output: 298, total: 454 },
  variance: {
    input: 6,
    output: -202,
    total: -196,
    percentTotal: -30
  },
  accurate: false // More than 15% variance
}
*/
```

---

## Session Statistics

### Get Detailed Stats

```javascript
const stats = tracker.getSessionStats(sessionId);

console.log(stats);
/*
{
  sessionId: "session-abc123",
  organizationId: "org-456",
  userId: "user-789",
  matterId: "matter-123",
  startedAt: 1702752000000,
  durationMs: 125456,
  requestCount: 8,
  totalInputTokens: 1248,
  totalOutputTokens: 2384,
  totalTokens: 3632,
  averageInputPerRequest: 156,
  averageOutputPerRequest: 298,
  averageTotalPerRequest: 454
}
*/
```

### Request History

```javascript
const history = tracker.getRequestHistory(sessionId, 5); // Last 5 requests

console.log(history);
/*
[
  {
    timestamp: 1702752100000,
    inputTokens: 156,
    outputTokens: 298,
    totalTokens: 454,
    model: "llama3.1:8b-32k",
    operation: "chat",
    duration: {
      total: 5589157584,
      promptEval: 130079000,
      eval: 5455806000
    },
    metadata: {
      matterId: "matter-123",
      intentType: "document_query",
      hasDocuments: true
    }
  },
  // ... more requests
]
*/
```

---

## Aggregate Stats (All Sessions)

```javascript
const aggregate = tracker.getAggregateStats();

console.log(aggregate);
/*
{
  activeSessions: 12,
  totalRequests: 87,
  totalInputTokens: 13584,
  totalOutputTokens: 26192,
  totalTokens: 39776
}
*/
```

---

## Analytics Use Cases

### 1. Cost Tracking

```javascript
const COST_PER_1K_INPUT = 0.0015;  // $0.0015 per 1K input tokens
const COST_PER_1K_OUTPUT = 0.002;  // $0.002 per 1K output tokens

const stats = tracker.getSessionStats(sessionId);
const costInput = (stats.totalInputTokens / 1000) * COST_PER_1K_INPUT;
const costOutput = (stats.totalOutputTokens / 1000) * COST_PER_1K_OUTPUT;
const totalCost = costInput + costOutput;

console.log(`Session cost: $${totalCost.toFixed(4)}`);
```

### 2. Performance Analysis

```javascript
const history = tracker.getRequestHistory(sessionId);

// Find slowest request
const slowest = history.reduce((max, req) =>
  req.duration.total > max.duration.total ? req : max
);

console.log(`Slowest request: ${slowest.operation}`);
console.log(`Tokens: ${slowest.totalTokens}`);
console.log(`Duration: ${slowest.duration.total / 1000000}ms`);
```

### 3. Optimization Insights

```javascript
const stats = tracker.getSessionStats(sessionId);

// High input/output ratio = verbose prompts?
const ratio = stats.totalInputTokens / stats.totalOutputTokens;
if (ratio > 1.5) {
  console.warn('Prompts are verbose - consider optimization');
}

// High average per request = complex queries
if (stats.averageTotalPerRequest > 1000) {
  console.log('Complex queries - consider map-reduce');
}
```

---

## Database Persistence (Future)

### Schema Design

```sql
CREATE TABLE token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  matter_id TEXT,

  request_timestamp TIMESTAMPTZ NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,

  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,

  duration_total_ns BIGINT,
  duration_prompt_eval_ns BIGINT,
  duration_eval_ns BIGINT,

  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_token_usage_org (organization_id, created_at DESC),
  INDEX idx_token_usage_user (user_id, created_at DESC),
  INDEX idx_token_usage_matter (matter_id, created_at DESC),
  INDEX idx_token_usage_session (session_id)
);

CREATE TABLE token_usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  matter_id TEXT,

  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,

  total_requests INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_sessions_org (organization_id, started_at DESC),
  INDEX idx_sessions_user (user_id, started_at DESC)
);
```

### Persistence Implementation (TODO)

```javascript
async function persistSessionStats(stats) {
  await db.query(`
    INSERT INTO token_usage_sessions (
      session_id, organization_id, user_id, matter_id,
      started_at, ended_at, duration_ms,
      total_requests, total_input_tokens, total_output_tokens, total_tokens
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (session_id) DO UPDATE SET
      ended_at = EXCLUDED.ended_at,
      duration_ms = EXCLUDED.duration_ms,
      total_requests = EXCLUDED.total_requests,
      total_input_tokens = EXCLUDED.total_input_tokens,
      total_output_tokens = EXCLUDED.total_output_tokens,
      total_tokens = EXCLUDED.total_tokens,
      updated_at = NOW()
  `, [
    stats.sessionId,
    stats.organizationId,
    stats.userId,
    stats.matterId,
    new Date(stats.startedAt),
    new Date(),
    stats.durationMs,
    stats.requestCount,
    stats.totalInputTokens,
    stats.totalOutputTokens,
    stats.totalTokens
  ]);
}
```

---

## Migration Path

### Phase 1: Dual Tracking (Current)
- Keep estimates for pre-flight checks
- Add actual tracking from Ollama
- Compare and validate

### Phase 2: Primary Actual (Next)
- Use actual counts for analytics
- Use actual counts for billing
- Keep estimates only for budgeting

### Phase 3: Full Replacement (Future)
- Remove estimate-based tracking
- Use only actual counts everywhere
- Improve tokenizer accuracy for pre-flight

---

## Benefits

### ✅ Accurate Usage Tracking
- Real token counts from Ollama
- No estimation variance
- Ground truth for analytics

### ✅ Better Cost Management
- Precise billing calculations
- Identify cost outliers
- Optimize expensive queries

### ✅ Performance Insights
- Correlate tokens with latency
- Identify bottlenecks
- Optimize prompt sizes

### ✅ Quality Metrics
- Track input/output ratios
- Identify verbose prompts
- Measure response efficiency

---

## Testing

### Unit Tests

```javascript
describe('ActualTokenTracker', () => {
  it('should track session usage accurately', () => {
    const tracker = new ActualTokenTracker();
    tracker.initSession('test-session');

    tracker.recordUsage('test-session', {
      prompt_eval_count: 100,
      eval_count: 200
    });

    const stats = tracker.getSessionStats('test-session');
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(200);
    expect(stats.totalTokens).toBe(300);
  });
});
```

### Integration Tests

```javascript
it('should capture metadata from Ollama', async () => {
  const result = await ollamaService.generateChatWithTools(
    [{ role: 'user', content: 'Hello' }]
  );

  expect(result.metadata).toBeDefined();
  expect(result.metadata.prompt_eval_count).toBeGreaterThan(0);
  expect(result.metadata.eval_count).toBeGreaterThan(0);
});
```

---

## Conclusion

**Actual token tracking** provides ground truth for usage, cost, and performance analysis.

**Key Improvements:**
1. ✅ Accurate counts (not estimates)
2. ✅ Per-request granularity
3. ✅ Session-level aggregation
4. ✅ Easy integration
5. ✅ Analytics ready

**Next Steps:**
1. Integrate into streaming routes
2. Add database persistence
3. Build analytics dashboard
4. Use for cost optimization

---

**Author:** Claude (Sonnet 4.5)
**Implemented:** 2024-12-16
**Files:**
- `src/shared/context/actual-token-tracker.js`
- `src/shared/services/ollama.service.js` (modified)

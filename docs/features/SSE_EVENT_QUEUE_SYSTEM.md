# SSE Event Queue Manager System

## Overview

The SSE (Server-Sent Events) Event Queue Manager provides intelligent status broadcasting to keep users informed during AI request processing. It replaces scattered `sendSSE()` calls with a centralized system that manages event queuing, timer-based status updates, and automatic cleanup when content streaming begins.

**Key Benefits:**
- **User Visibility**: Users see exactly what the system is doing at each step
- **Automatic Timers**: Rotating "thinking words" keep UI engaging during waits
- **Smart Cleanup**: All timers stop automatically when content streaming starts
- **Event Queuing**: Events are sent immediately and logged for debugging
- **Metadata Rich**: Each phase includes detailed metadata about processing state

## Problem Solved

### Before: Manual SSE Management

```javascript
// Scattered sendSSE calls throughout codebase
sendSSE(res, 'thinking', { message: 'Preparing response...' });

// Manual timer management
const timer = setInterval(() => {
  if (!firstChunkReceived) {
    sendSSE(res, 'thinking', { message: 'Still thinking...' });
  }
}, 2500);

// Easy to forget cleanup
if (firstChunkReceived) {
  clearInterval(timer); // Might be forgotten!
}
```

**Issues:**
- Inconsistent event formats across codebase
- Manual timer cleanup prone to bugs
- No centralized way to stop all timers
- Missing metadata about processing steps
- Poor user visibility into long operations

### After: Event Queue Manager

```javascript
// Create event queue for session
const eventQueue = new SSEEventQueueManager(res, sessionId);

// Start a phase with automatic timer-based updates
eventQueue.startPhase('retrieval', 'Searching documents...', {
  updateIntervalMs: 2500,
  showThinkingWords: true,
  metadata: { documentCount: 50 }
});

// Automatic cleanup when content starts
eventQueue.startContentStreaming(); // Stops ALL timers, clears queue

// Phase automatically ended
eventQueue.endPhase('retrieval', { documentsFound: 10 });
```

**Benefits:**
- Consistent event structure
- Automatic timer management
- Centralized cleanup
- Rich metadata in every event
- Clear phase lifecycle

## Architecture

### Class: SSEEventQueueManager

**File:** `src/shared/utils/sse-event-queue.manager.js`

```javascript
class SSEEventQueueManager {
  constructor(res, sessionId)

  // Core Methods
  sendEvent(event, data)              // Send SSE event immediately
  queueEvent(event, data)             // Queue + send event

  // Phase Management
  startPhase(phase, message, options) // Start processing phase with timers
  updatePhase(message, metadata)      // Update current phase status
  endPhase(phase, metadata)           // End phase and stop its timer

  // Timer Management
  stopTimer(phase)                    // Stop specific phase timer
  stopAllTimers()                     // Stop all active timers

  // Content Streaming
  startContentStreaming(metadata)     // Mark streaming started, cleanup all

  // Utilities
  sendProgress(operation, current, total, message)  // Progress bar updates
  sendError(error, metadata)                        // Error events
  sendDevLog(level, message, metadata)              // Development logs
  getStats()                                         // Queue statistics
  cleanup()                                          // Full cleanup
}
```

### Event Flow

```
User Request
     ↓
[Event Queue Created]
     ↓
Phase 1: initialization
  - Timer starts (rotating thinking words every 3s)
  - Events: phase, thinking, thinking, ...
     ↓
[Phase 1 Ends]
     ↓
Phase 2: fast_pass (if enabled)
  - Timer starts (rotating thinking words every 2s)
  - Events: phase, thinking, fast_pass_result
     ↓
[Phase 2 Ends] → requiresAdditionalInfo?
     │
     ├─ NO  → startContentStreaming()
     │         - Stops all timers
     │         - Sends content_start
     │         - Streams content chunks
     │
     └─ YES → Continue to Intent Analysis
               ↓
          Phase 3: intent_analysis
               - Timer starts
               - Events: phase, thinking, intent
               ↓
          [Phase 3 Ends]
               ↓
          Phase 4: loading_history (conditional)
               - Only if conversation history query
               - Timer starts
               - Events: phase, thinking
               ↓
          Phase 5: retrieval (conditional)
               - Only if documents needed
               - Timer starts
               - Events: phase, thinking, progress (optional)
               ↓
          Phase 6: generation
               - Timer starts
               - Events: phase, thinking
               ↓
          startContentStreaming()
               - Stops all timers
               - Sends content_start
               - Streams content chunks
               - Sends content_end
```

## Integration Points

### 1. Session Initialization

**File:** `src/services/processor/routes/streaming.routes.js`
**Location:** Lines 2419-2433

```javascript
// Initialize Event Queue Manager for this session
const eventQueue = new SSEEventQueueManager(res, sessionId);

// Send initial event
eventQueue.sendEvent('connected', {
  client_id: clientId,
  thread_id: conversationId,
  session_id: sessionId
});

// Start initialization phase with status updates
eventQueue.startPhase('initialization', 'Preparing response...', {
  updateIntervalMs: 3000,
  showThinkingWords: true
});
```

### 2. Fast-Pass Check

**Location:** Lines 1658-1666, 1800-1829

```javascript
// Start fast-pass phase
eventQueue.startPhase('fast_pass', 'Checking if question can be answered...', {
  updateIntervalMs: 2000,
  showThinkingWords: true,
  metadata: {
    messageLength: message.length,
    historyLength: conversationHistory.length
  }
});

// ... LLM evaluation ...

// End fast-pass phase based on result
if (fastPassResult.requiresAdditionalInfo) {
  eventQueue.endPhase('fast_pass', {
    result: 'requires_additional_info',
    reasoning: fastPassResult.reasoning
  });
} else {
  eventQueue.endPhase('fast_pass', {
    result: 'success',
    reasoning: fastPassResult.reasoning
  });
}
```

### 3. Intent Analysis

**Location:** Lines 1858-1897

```javascript
// Start intent analysis phase
eventQueue.startPhase('intent_analysis', 'Analyzing your question...', {
  updateIntervalMs: 2000,
  showThinkingWords: true,
  metadata: {
    hasMatter: !!matterId,
    hasDocuments: documentCount > 0
  }
});

// ... Intent classification ...

// Send intent result and end phase
eventQueue.sendEvent('intent', {
  type: intent.type,
  confidence: intent.confidence,
  reasoning: intent.reasoning
});

eventQueue.endPhase('intent_analysis', {
  intentType: intent.type,
  confidence: intent.confidence,
  needsDocuments: intent.needsDocuments,
  needsTools: intent.needsTools
});
```

### 4. Conversation History Loading

**Location:** Lines 1920-1939

```javascript
// Start history loading phase
eventQueue.startPhase('loading_history', 'Loading full conversation history...', {
  updateIntervalMs: 2500,
  showThinkingWords: true,
  metadata: {
    currentMessages: session.conversationHistory.length
  }
});

// ... Load history from database ...

// End history loading phase
eventQueue.endPhase('loading_history', {
  totalMessages: fullHistory.length,
  loadedAdditional: fullHistory.length - session.conversationHistory.length
});
```

### 5. Document Retrieval

**Location:** Lines 1965-1996

```javascript
const retrievalMessage = intent.attachedFileIds?.length > 0
  ? `Analyzing ${intent.attachedFileIds.length} attached file(s)...`
  : `Searching ${documentCount} documents...`;

// Start retrieval phase with status updates
eventQueue.startPhase('retrieval', retrievalMessage, {
  updateIntervalMs: 2500,
  showThinkingWords: true,
  metadata: {
    documentCount,
    matterId,
    intentType: intent.type,
    directAttachments: hasAttachedFiles,
    attachedFileCount: intent.attachedFileIds?.length || 0
  }
});

// ... Retrieve documents in background ...

// Note: Phase is ended when documents are retrieved and processed
```

### 6. Content Streaming Start

**Location:** Lines 3052-3070

```javascript
// Start generation phase
eventQueue.startPhase('generation', 'Generating response...', {
  updateIntervalMs: 1500,
  showThinkingWords: false
});

// Mark content streaming as started - this stops all timers and clears queue
eventQueue.startContentStreaming({
  strategy: 'fast_pass',
  reasoning: fastPassResult.reasoning
});

// Stream content chunks
for (const chunk of responseChunks) {
  eventQueue.sendEvent('content', { delta: chunk + ' ' });
}

eventQueue.sendEvent('content_end', {});
```

## Event Types

### Standard Events

| Event | Data | Purpose |
|-------|------|---------|
| `connected` | `{ client_id, thread_id, session_id }` | Initial connection established |
| `phase` | `{ phase, message, status, timestamp, ...metadata }` | Phase started/completed |
| `thinking` | `{ message, phase, elapsed, ...metadata }` | Rotating thinking words during processing |
| `phase_update` | `{ phase, message, status, elapsed, ...metadata }` | Update to current phase |
| `intent` | `{ type, confidence, reasoning }` | Intent classification result |
| `fast_pass_result` | `{ requiresAdditionalInfo, reasoning }` | Fast-pass evaluation result |
| `content_start` | `{ timestamp, ...metadata }` | Content streaming beginning |
| `content` | `{ delta }` | Content chunk |
| `content_end` | `{}` | Content streaming complete |
| `progress` | `{ operation, current, total, percentage, message }` | Progress bar updates |
| `error` | `{ error, phase, timestamp, ...metadata }` | Error occurred |
| `log` | `{ level, message, timestamp, phase, ...metadata }` | Development logs (dev mode only) |
| `done` | `{ session_id, conversation_id, strategy }` | Request complete |

### Phase Identifiers

| Phase | Description | Average Duration |
|-------|-------------|------------------|
| `initialization` | Loading context, history, documents count | 100-500ms |
| `fast_pass` | Evaluating if answer exists in current context | 200-800ms |
| `intent_analysis` | Classifying user intent | 50-200ms |
| `loading_history` | Loading full conversation history (conditional) | 100-300ms |
| `retrieval` | Searching/retrieving document chunks | 500-2000ms |
| `generation` | Generating LLM response | 1000-5000ms |

## Frontend Integration

### SSE Event Listener

```javascript
const eventSource = new EventSource('/api/v1/streaming/chat/stream', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});

// Track active phase
let currentPhase = null;
let phaseStartTime = null;

// Listen for phase events
eventSource.addEventListener('phase', (e) => {
  const data = JSON.parse(e.data);

  if (data.status === 'started') {
    currentPhase = data.phase;
    phaseStartTime = Date.now();

    // Show phase in UI
    updateStatusUI(data.message);
  } else if (data.status === 'completed') {
    const elapsed = data.elapsed || (Date.now() - phaseStartTime);
    console.log(`Phase ${data.phase} completed in ${elapsed}ms`);

    currentPhase = null;
  }
});

// Listen for thinking words
eventSource.addEventListener('thinking', (e) => {
  const data = JSON.parse(e.data);

  // Update status with rotating thinking word
  updateStatusUI(data.message);  // "Analyzing...", "Processing...", etc.
});

// Listen for content start (all timers stopped)
eventSource.addEventListener('content_start', (e) => {
  // Clear status UI, prepare for content
  clearStatusUI();
  showContentArea();
});

// Listen for content chunks
eventSource.addEventListener('content', (e) => {
  const data = JSON.parse(e.data);
  appendContentChunk(data.delta);
});

// Listen for errors
eventSource.addEventListener('error', (e) => {
  const data = JSON.parse(e.data);
  showError(`Error in ${data.phase}: ${data.error}`);
});
```

### Example UI Update

```javascript
function updateStatusUI(message) {
  const statusElement = document.getElementById('ai-status');

  // Show animated status
  statusElement.innerHTML = `
    <div class="flex items-center space-x-2">
      <div class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
      <span class="text-gray-600">${message}</span>
    </div>
  `;

  statusElement.classList.remove('hidden');
}

function clearStatusUI() {
  const statusElement = document.getElementById('ai-status');
  statusElement.classList.add('hidden');
}
```

## Configuration

### Phase Configuration Options

```javascript
eventQueue.startPhase(phase, message, {
  // How often to send thinking word updates (ms)
  updateIntervalMs: 2500,

  // Whether to show rotating thinking words
  showThinkingWords: true,

  // Additional metadata to include in all events
  metadata: {
    documentCount: 50,
    matterId: 'abc-123',
    // ... any other context
  }
});
```

### Recommended Intervals

| Phase | Recommended Interval | Rationale |
|-------|---------------------|-----------|
| initialization | 3000ms | Slow, steady updates during setup |
| fast_pass | 2000ms | Quick evaluation, frequent updates |
| intent_analysis | 2000ms | Fast operation, moderate updates |
| loading_history | 2500ms | Database I/O, moderate updates |
| retrieval | 2500ms | Vector search, moderate updates |
| generation | 1500ms | LLM generation, faster updates for engagement |

## Performance Impact

### Event Overhead

| Metric | Value | Notes |
|--------|-------|-------|
| Event size | 150-300 bytes | Depends on metadata |
| Thinking word rotation | Every 1.5-3s | Configurable per phase |
| Queue memory | ~1KB per session | Cleared on content start |
| Timer overhead | Negligible | Native `setInterval` |

### Network Impact

**Typical Request (5s total):**
- Initial events: ~500 bytes
- Phase events (3 phases): ~1KB
- Thinking words (6 updates): ~1.2KB
- Content streaming: Variable (response size)
- **Total overhead: ~2.7KB** (excluding actual content)

This is acceptable overhead for the improved user experience.

## Error Handling

### Automatic Error Handling

```javascript
try {
  // Phase starts
  eventQueue.startPhase('retrieval', 'Searching documents...');

  // Some operation that might fail
  const docs = await searchDocuments();

  // Phase ends successfully
  eventQueue.endPhase('retrieval', { found: docs.length });

} catch (error) {
  // Automatically send error event and stop timers
  eventQueue.sendError(error, {
    phase: 'retrieval',
    documentsSearched: 0
  });

  // End phase with error metadata
  eventQueue.endPhase('retrieval', {
    result: 'error',
    error: error.message
  });
}
```

### Graceful Degradation

If SSE connection is lost:
- Backend continues processing
- Events are logged but not sent
- Response is still saved to database
- User can refresh to see final result

## Testing

### Manual Testing

```bash
# Test 1: Simple query (should show multiple phases)
curl -N http://localhost:8080/api/v1/streaming/chat/stream \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "message": "What time is it?",
    "session_id": "test-123"
  }'

# Expected events:
# - connected
# - phase (initialization) + thinking words
# - phase (initialization completed)
# - phase (fast_pass) + thinking words
# - fast_pass_result
# - phase (fast_pass completed)
# - phase (generation)
# - content_start
# - content chunks
# - content_end
# - done

# Test 2: Document query (should show retrieval phase)
curl -N http://localhost:8080/api/v1/streaming/chat/stream \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "message": "Summarize the contract",
    "matter_id": "MATTER_ID",
    "session_id": "test-456"
  }'

# Expected additional events:
# - phase (intent_analysis) + thinking words
# - intent
# - phase (retrieval) + thinking words
# - phase (retrieval completed)
# - phase (generation) + thinking words
# - content_start (all timers stop here)
```

### Automated Tests

```javascript
describe('SSEEventQueueManager', () => {
  it('should start and end phases correctly', () => {
    const mockRes = createMockResponse();
    const queue = new SSEEventQueueManager(mockRes, 'test-session');

    queue.startPhase('test', 'Testing...');
    expect(queue.currentPhase).toBe('test');
    expect(queue.activeTimers.size).toBe(1);

    queue.endPhase('test');
    expect(queue.currentPhase).toBeNull();
    expect(queue.activeTimers.size).toBe(0);
  });

  it('should stop all timers on content streaming', () => {
    const mockRes = createMockResponse();
    const queue = new SSEEventQueueManager(mockRes, 'test-session');

    queue.startPhase('phase1', 'Test 1');
    queue.startPhase('phase2', 'Test 2');
    expect(queue.activeTimers.size).toBe(1); // Only one active at a time

    queue.startContentStreaming();
    expect(queue.activeTimers.size).toBe(0);
    expect(queue.contentStreamingStarted).toBe(true);
  });
});
```

## Logging and Monitoring

### Server Logs

```javascript
// Automatic logging in event queue
logInfo('[SSE Queue] Starting phase', {
  phase: 'retrieval',
  sessionId: 'abc-123',
  showThinkingWords: true
});

logInfo('[SSE Queue] Phase completed', {
  phase: 'retrieval',
  elapsed: 1234,
  sessionId: 'abc-123'
});

logInfo('[SSE Queue] Content streaming started - clearing queue', {
  sessionId: 'abc-123',
  queueSize: 15,
  activeTimers: 2,
  currentPhase: 'generation'
});
```

### Monitoring Queries

```sql
-- Track average phase durations
SELECT
  metadata->>'phase' AS phase,
  AVG(CAST(metadata->>'elapsed' AS INTEGER)) AS avg_elapsed_ms
FROM logs
WHERE message LIKE '%Phase completed%'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY metadata->>'phase';

-- Identify stuck phases (> 10s)
SELECT
  session_id,
  metadata->>'phase' AS phase,
  CAST(metadata->>'elapsed' AS INTEGER) AS elapsed_ms
FROM logs
WHERE message LIKE '%Phase completed%'
  AND CAST(metadata->>'elapsed' AS INTEGER) > 10000
ORDER BY elapsed_ms DESC;
```

## Future Enhancements

1. **Progress Bars**: Add granular progress tracking for long operations
2. **Phase Cancellation**: Allow users to cancel in-progress phases
3. **Event Replay**: Store events for debugging/replay
4. **Adaptive Timing**: Adjust thinking word interval based on phase duration
5. **Event Compression**: Batch multiple thinking words to reduce network overhead
6. **WebSocket Support**: Alternative to SSE for bidirectional communication

## Related Documentation

- [Fast-Pass Optimization](./FAST_PASS_OPTIMIZATION.md)
- [Two-Phase Conversation History Loading](./TWO_PHASE_CONVERSATION_HISTORY_LOADING.md)
- [Intelligent Chat Flow](./INTELLIGENT_CHAT_FLOW.md)

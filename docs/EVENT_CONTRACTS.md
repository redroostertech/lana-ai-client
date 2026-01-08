# Standard Event Contracts

**Last Updated:** 2025-12-19
**Version:** 1.0
**Purpose:** Define standard event structures for SSE communication between backend and frontend

---

## Overview

This document defines the standard event contracts used across all agent flows (Normal Chat, Document Chat, etc.) to ensure consistent event structures and reliable frontend rendering.

### Event Routing Architecture

```
Agent → Event Router → EventQueue → trackedSendSSE → Frontend
```

All events (except streaming content) are routed through `SSEEventQueueManager` for consistent phase management and event tracking.

---

## Core Event Types

### 1. Reasoning Event

**Event Type:** `reasoning`
**Purpose:** Communicate agent reasoning steps, complexity analysis, and coordination messages
**Display:** Reasoning drawer (text)

#### Standard Structure

```typescript
interface ReasoningEvent {
  type: 'reasoning';                      // REQUIRED - Event type identifier
  message: string;                        // REQUIRED - Human-readable message
  complexity: 'simple' | 'medium' | 'complex';  // REQUIRED - Task complexity
  iterations: number;                     // REQUIRED - Number of iterations/workers
  metadata?: {                            // OPTIONAL - Flow-specific data
    requires_tools?: boolean;             // Normal chat - indicates tool usage
    phase?: string;                       // Document chat - processing phase
    timestamp?: number;                   // Timestamp in milliseconds
    [key: string]: any;                   // Extensible for future needs
  };
}
```

#### Examples

**Normal Chat - Complexity Analysis:**
```json
{
  "type": "reasoning",
  "message": "Analyzing query complexity...",
  "complexity": "medium",
  "iterations": 2,
  "metadata": {
    "requires_tools": true,
    "timestamp": 1734567890000
  }
}
```

**Document Chat - Worker Coordination:**
```json
{
  "type": "reasoning",
  "message": "Worker 1 completed (1/3 workers done)",
  "complexity": "complex",
  "iterations": 3,
  "metadata": {
    "phase": "processing",
    "timestamp": 1734567890000
  }
}
```

#### Validation Rules

- ✅ `type` must be exactly `'reasoning'`
- ✅ `message` must be non-empty string
- ✅ `complexity` must be one of: `'simple'`, `'medium'`, `'complex'`
- ✅ `iterations` must be positive integer (≥ 1)
- ✅ `metadata` is optional but recommended for flow-specific data

---

### 2. Progress Event (Unified)

**Event Type:** `progress`
**Purpose:** Track progress for any multi-step operation (document processing, tool execution, etc.)
**Display:** Progress bar in reasoning drawer or iterations tab

#### Standard Structure

```typescript
interface ProgressEvent {
  type: 'progress';                       // REQUIRED - Event type identifier
  category: 'document_analysis' | 'tool_execution' | 'data_fetching';  // REQUIRED - Operation category
  stage: string;                          // REQUIRED - Human-readable stage name
  current: number;                        // REQUIRED - Current step number
  total: number;                          // REQUIRED - Total number of steps
  percent: number;                        // REQUIRED - Progress percentage (0-100)
  message: string;                        // REQUIRED - Status message
  metadata?: {                            // OPTIONAL - Category-specific data
    documents?: string[];                 // document_analysis - Document names
    toolsUsed?: string[];                 // tool_execution - Tools invoked
    failureCount?: number;                // tool_execution - Failed attempts
    stage_name?: string;                  // document_analysis - Technical stage name
    [key: string]: any;                   // Extensible for future needs
  };
}
```

**Replaces:** `document_progress` and `iteration_summary` events

#### Category: `document_analysis`

Document processing stages (7 total stages):

| Stage | Current/Total | Percent | Description |
|-------|---------------|---------|-------------|
| Loading metadata | 1/7 | 0-15% | Loading document metadata |
| Metadata loaded | 2/7 | 15-30% | Metadata complete |
| Searching content | 3/7 | 30-45% | RAG semantic search |
| Content retrieved | 4/7 | 45-60% | Chunks retrieved |
| Analyzing content | 5/7 | 60-85% | Worker coordination & analysis |
| Finalizing answer | 6/7 | 85-95% | Answer synthesis |
| Complete | 7/7 | 100% | Processing finished |

#### Category: `tool_execution`

Tool iteration stages (dynamic based on maxIterations):

| Stage | Current/Total | Percent | Description |
|-------|---------------|---------|-------------|
| Iteration 1 | 1/3 | 33% | First tool execution |
| Iteration 2 | 2/3 | 67% | Second tool execution |
| Iteration 3 | 3/3 | 100% | Final iteration |

#### Examples

**Document Analysis - Metadata Loading:**
```json
{
  "type": "progress",
  "category": "document_analysis",
  "stage": "Loading metadata",
  "current": 1,
  "total": 7,
  "percent": 0,
  "message": "Loading document information...",
  "metadata": {
    "documents": ["contract-a.pdf", "report-b.pdf"],
    "stage_name": "metadata"
  }
}
```

**Document Analysis - Worker Processing:**
```json
{
  "type": "progress",
  "category": "document_analysis",
  "stage": "Analyzing content",
  "current": 5,
  "total": 7,
  "percent": 75,
  "message": "Processing: 2/3 workers complete",
  "metadata": {
    "documents": ["contract-a.pdf"],
    "stage_name": "processing"
  }
}
```

**Tool Execution - Iteration Progress:**
```json
{
  "type": "progress",
  "category": "tool_execution",
  "stage": "Iteration 2",
  "current": 2,
  "total": 3,
  "percent": 67,
  "message": "Executing tools: search_documents, calculate",
  "metadata": {
    "toolsUsed": ["search_documents", "calculate"],
    "failureCount": 0
  }
}
```

#### Validation Rules

- ✅ `type` must be exactly `'progress'`
- ✅ `category` must be one of: `'document_analysis'`, `'tool_execution'`, `'data_fetching'`
- ✅ `stage` must be non-empty string
- ✅ `current` must be positive integer (≥ 1)
- ✅ `total` must be ≥ `current`
- ✅ `percent` must be number between 0 and 100
- ✅ `message` must be non-empty string
- ✅ `metadata` is optional but recommended for category-specific data

---

### 3. Citation Event

**Event Type:** `citations`
**Purpose:** Provide source references for document-based answers
**Display:** Citations list below message

#### Standard Structure

```typescript
interface Citation {
  id?: string;                            // OPTIONAL - Citation ID
  document_id: string;                    // REQUIRED - Source document ID
  filename: string;                       // REQUIRED - Document filename
  page_number?: number;                   // RECOMMENDED - Page number
  page_range?: string;                    // OPTIONAL - Page range (e.g., "5-7")
  bates_number?: string;                  // OPTIONAL - Bates numbering
  exhibit_label?: string;                 // OPTIONAL - Exhibit label
  relevance?: number;                     // OPTIONAL - Relevance score (0-1)
  excerpt?: string;                       // OPTIONAL - Text excerpt
}

interface CitationEvent {
  citations: Citation[];                  // REQUIRED - Array of citations
}
```

#### Example

```json
{
  "citations": [
    {
      "id": "cite-1",
      "document_id": "doc-uuid-123",
      "filename": "Employment_Contract_2024.pdf",
      "page_number": 5,
      "relevance": 0.95,
      "excerpt": "The employee shall receive compensation of..."
    },
    {
      "id": "cite-2",
      "document_id": "doc-uuid-456",
      "filename": "NDA_Agreement.pdf",
      "page_range": "2-3",
      "bates_number": "ACME-0042",
      "relevance": 0.87
    }
  ]
}
```

#### Validation Rules

- ✅ `citations` must be array (can be empty)
- ✅ Each citation must have `document_id` and `filename`
- ✅ `page_number` recommended for better UX
- ✅ `relevance` should be between 0 and 1

---

### 4. Iteration Summary Event

**Event Type:** `iteration_summary`
**Purpose:** Track tool execution iterations in normal chat
**Display:** Iterations tab (progress tracker)

#### Standard Structure

```typescript
interface IterationSummaryEvent {
  iteration: number;                      // REQUIRED - Current iteration number
  maxIterations: number;                  // REQUIRED - Maximum iterations allowed
  message: string;                        // REQUIRED - Status message
  toolsUsed?: string[];                   // OPTIONAL - Tools invoked
  failureCount?: number;                  // OPTIONAL - Failed tool count
  metadata?: {                            // OPTIONAL - Additional context
    [key: string]: any;
  };
}
```

#### Example

```json
{
  "iteration": 2,
  "maxIterations": 3,
  "message": "Executing tools: search, calculate",
  "toolsUsed": ["search_documents", "calculate"],
  "failureCount": 0
}
```

#### Validation Rules

- ✅ `iteration` must be positive integer (≥ 1)
- ✅ `maxIterations` must be ≥ `iteration`
- ✅ `message` must be non-empty string
- ✅ `toolsUsed` is optional array of tool names

---

### 5. Thinking Event

**Event Type:** `thinking`
**Purpose:** Show dynamic thinking indicators during processing
**Display:** Thinking indicator with rotating words

#### Standard Structure

```typescript
interface ThinkingEvent {
  message: string;                        // REQUIRED - Status message
  phase?: string;                         // OPTIONAL - Current phase
}
```

#### Example

```json
{
  "message": "Analyzing...",
  "phase": "complexity_analysis"
}
```

**Note:** Thinking events are **not stored** in metadata - they're transient UI indicators only.

---

## Event Flow Patterns

### Normal Chat Flow

```
PerformantAgent.execute()
    ↓
emitEvent(callback, 'reasoning', {...})
    ↓
Event Router (in executePerformantAgenticFlow)
    ↓
eventQueue.sendEvent('reasoning', {...})
    ↓
trackedSendSSE(res, 'reasoning', {...})
    ↓
Frontend: Reasoning Drawer
```

### Document Chat Flow

```
DocumentAgent.execute()
    ↓
emitEvent(callback, 'document_progress', {...})
    ↓
Event Queue Wrapper (in streaming.routes.js)
    ↓
eventQueue.sendEvent('document_progress', {...})
    ↓
trackedSendSSE(res, 'document_progress', {...})
    ↓
Frontend: Reasoning Drawer (Progress Bar)
```

**Key Principle:** Both flows route through `SSEEventQueueManager` for consistent event handling.

---

## Frontend Rendering Rules

### Type-Based Rendering

The frontend uses the `type` field to determine rendering:

```javascript
reasoningEvents.forEach(event => {
  if (event.type === 'document_progress') {
    // Render as progress bar
    renderProgressBar(event.stage, event.progress, event.message);
  } else if (event.type === 'reasoning') {
    // Render as text message
    renderTextMessage(event.message, event.complexity);
  }
});
```

### Display Locations

| Event Type | Display Location | Rendering |
|------------|------------------|-----------|
| `reasoning` | Reasoning drawer | Text message |
| `document_progress` | Reasoning drawer | Progress bar |
| `iteration_summary` | Iterations tab | Progress tracker |
| `citations` | Below message | Citation list |
| `thinking` | Thinking indicator | Rotating words (transient) |

---

## Metadata Storage

### Tracked Events

Events are stored in message metadata for persistence:

```typescript
interface MessageMetadata {
  reasoning_events: Array<ReasoningEvent | DocumentProgressEvent>;
  iteration_summaries?: IterationSummaryEvent[];
  citations?: Citation[];
}
```

### Storage Rules

- ✅ `reasoning` events → `reasoning_events[]`
- ✅ `document_progress` events → `reasoning_events[]` (same array!)
- ✅ `iteration_summary` events → `iteration_summaries[]`
- ✅ `citations` events → `citations[]`
- ❌ `thinking` events → **NOT STORED** (transient only)

**Why same array?** Both `reasoning` and `document_progress` are rendered in the reasoning drawer and need chronological ordering.

---

## Best Practices

### For Backend Developers

1. **Always include required fields:**
   ```javascript
   ✅ emitEvent('reasoning', {
        type: 'reasoning',
        message: '...',
        complexity: 'medium',
        iterations: 2
      })

   ❌ emitEvent('reasoning', { message: '...' })  // Missing required fields
   ```

2. **Use eventQueue for routing:**
   ```javascript
   ✅ eventQueue.sendEvent('reasoning', {...})
   ❌ sendSSE(res, 'reasoning', {...})  // Bypass eventQueue
   ```

3. **Consistent event naming:**
   ```javascript
   ✅ 'reasoning', 'document_progress', 'citations'
   ❌ 'think', 'doc_prog', 'sources'  // Inconsistent
   ```

### For Frontend Developers

1. **Always check type field:**
   ```javascript
   ✅ if (event.type === 'document_progress') { ... }
   ❌ if (event.stage) { ... }  // Assumes type based on fields
   ```

2. **Graceful degradation:**
   ```javascript
   ✅ const message = event.message || 'Processing...';
      const complexity = event.complexity || 'medium';
   ❌ const message = event.message;  // May be undefined
   ```

3. **Type-safe handling:**
   ```typescript
   ✅ reasoningEvents.forEach((event: ReasoningEvent | DocumentProgressEvent) => {
        if (event.type === 'document_progress') {
          // TypeScript knows event has 'progress' field
        }
      })
   ```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-19 | Initial documentation with standardized contracts |

---

## See Also

- `/Users/redroostertechnologies/Desktop/LANA-AI/EVENT_FLOW_CONSISTENCY_ANALYSIS.md` - Detailed flow analysis
- `/Users/redroostertechnologies/Desktop/LANA-AI/src/services/processor/routes/streaming.routes.js` - Event routing implementation
- `/Users/redroostertechnologies/Desktop/LANA-AI/src/shared/agents/document-coordinator-agent.js` - Multi-agent coordinator
- `/Users/redroostertechnologies/Desktop/LANA-AI/public_html/js/chat.js` - Frontend event handling

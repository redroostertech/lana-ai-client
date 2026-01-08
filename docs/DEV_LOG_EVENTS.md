# Development Log Events via SSE

## Overview

When `NODE_ENV=development`, the streaming API sends detailed development logs via Server-Sent Events (SSE) to help debug the AI pipeline.

---

## Event Type: `log`

### Format

```javascript
event: log
data: {
  "level": "info" | "warn" | "error" | "debug",
  "message": "Log message",
  "timestamp": "2025-12-16T15:30:45.123Z",
  ...metadata
}
```

### Log Levels

- **`info`** - General informational logs (default)
- **`debug`** - Detailed debugging information
- **`warn`** - Warning messages
- **`error`** - Error messages

---

## Log Messages

### Intent Analysis

```javascript
// Start of analysis
{
  level: "info",
  message: "Analyzing intent",
  messageLength: 45,
  hasDocuments: true,
  hasMatter: true
}

// Intent detected
{
  level: "info",
  message: "Intent detected",
  type: "document_query",
  confidence: "high",
  needsDocuments: true,
  needsTools: false,
  reasoning: "Pattern matched: document_query"
}
```

### Document Retrieval

```javascript
// Starting retrieval
{
  level: "info",
  message: "Starting parallel document retrieval",
  documentCount: 5,
  matterId: "MATT-00001"
}

// Retrieval starting
{
  level: "info",
  message: "Starting document retrieval",
  message: "Can you summarize...",
  matterId: "MATT-00001",
  sessionId: "abc-123"
}

// Retrieval completed
{
  level: "info",
  message: "Document retrieval completed",
  chunksFound: 10,
  traceId: "xyz-789"
}

// Retrieval error
{
  level: "error",
  message: "Retrieval service not available",
  error: "CDI RetrievalService is null"
}
```

### Strategy Execution

```javascript
// Strategy selection
{
  level: "info",
  message: "Executing strategy",
  intentType: "document_query",
  hasDocumentPreparation: true,
  hasToolContext: false
}

// Strategy chosen
{
  level: "debug",
  message: "Using document chat strategy with RAG"
}
```

### Tool Usage

```javascript
// Tools enabled
{
  level: "info",
  message: "Tools enabled for document chat",
  toolCount: 6,
  tools: ["get_matter_details", "get_document", "list_documents", ...]
}
```

---

## Frontend Integration

### Basic Implementation

```javascript
// In your EventSource handler
eventSource.addEventListener('log', (event) => {
  const logData = JSON.parse(event.data);
  
  // Only show logs in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${logData.level.toUpperCase()}] ${logData.message}`, logData);
  }
});
```

### Advanced UI Implementation

```javascript
// State for storing logs
const [devLogs, setDevLogs] = useState([]);

// Handle log event
eventSource.addEventListener('log', (event) => {
  const logData = JSON.parse(event.data);
  setDevLogs(prev => [...prev, logData]);
});

// Render dev log panel (collapsible)
{process.env.NODE_ENV === 'development' && (
  <div className="dev-log-panel">
    <h3>🔧 Development Logs</h3>
    {devLogs.map((log, i) => (
      <div key={i} className={`log-entry log-${log.level}`}>
        <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
        <span className="log-level">[{log.level}]</span>
        <span className="log-message">{log.message}</span>
        {Object.keys(log).length > 3 && (
          <details>
            <summary>Metadata</summary>
            <pre>{JSON.stringify(log, null, 2)}</pre>
          </details>
        )}
      </div>
    ))}
  </div>
)}
```

### CSS Styling

```css
.dev-log-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  max-width: 400px;
  max-height: 300px;
  overflow-y: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 12px;
  font-family: monospace;
  font-size: 12px;
  z-index: 9999;
}

.log-entry {
  padding: 4px 0;
  border-bottom: 1px solid #333;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-info { color: #4fc3f7; }
.log-debug { color: #9c27b0; }
.log-warn { color: #ff9800; }
.log-error { color: #f44336; }

.log-time { color: #888; margin-right: 8px; }
.log-level { color: #fff; margin-right: 8px; font-weight: bold; }
.log-message { color: #d4d4d4; }
```

---

## Production Behavior

**Important:** In production (`NODE_ENV=production`), the `log` events are **NOT sent**. This ensures:
- Zero performance impact
- No sensitive information leakage
- Clean production logs

---

## Debugging Tips

### Enable Development Mode

```bash
NODE_ENV=development ./run.sh restart
```

### View Logs in Browser Console

```javascript
// Simple console logger
eventSource.addEventListener('log', (e) => {
  const log = JSON.parse(e.data);
  console.log(`%c${log.message}`, `color: ${getLogColor(log.level)}`, log);
});

function getLogColor(level) {
  switch(level) {
    case 'info': return '#4fc3f7';
    case 'debug': return '#9c27b0';
    case 'warn': return '#ff9800';
    case 'error': return '#f44336';
    default: return '#d4d4d4';
  }
}
```

### Filter Logs by Level

```javascript
// Only show errors and warnings
eventSource.addEventListener('log', (e) => {
  const log = JSON.parse(e.data);
  if (['error', 'warn'].includes(log.level)) {
    console.error(log.message, log);
  }
});
```

---

## Example Log Sequence

A typical document query generates this sequence:

```
1. Analyzing intent
2. Intent detected (type: document_query)
3. Starting parallel document retrieval
4. Starting document retrieval
5. Document retrieval completed (10 chunks)
6. Executing strategy (document_query)
7. Using document chat strategy with RAG
8. Tools enabled for document chat (6 tools)
9. [Content streaming begins...]
```

---

## Notes

- Logs are sent **before** the corresponding action completes
- Each log includes a `timestamp` for precise timing analysis
- Metadata varies by log type (see examples above)
- Logs do not block the main response stream
- Logs are flushed immediately (no buffering)

---

## Testing

### Test Log Events

```bash
# Start in development mode
NODE_ENV=development ./run.sh restart

# Watch logs in terminal
./run.sh logs

# Test a document query in the UI
# You should see log events in browser console
```

### Verify Production Behavior

```bash
# Start in production mode
NODE_ENV=production ./run.sh restart

# Test a document query
# Verify NO log events are sent (check Network tab)
```

# Tool-Based RAG Integration Guide

## Overview

This guide explains how to integrate the new tool-based RAG system with the streaming endpoint, replacing the old keyword-based heuristics with LLM-driven decision making.

---

## Architecture

### Old Approach (Keyword-Based)
```javascript
// streaming.routes.js
const ragDecision = SmartRAGController.shouldRetrieve(message, docCount);
if (ragDecision.should) {
  // Run RAG retrieval BEFORE LLM call
  const chunks = await retrievalService.retrieve(...);
  // Add chunks to system prompt
}
// Call LLM with chunks in context
```

**Problems:**
- ❌ Runs RAG on every query with documents (even "summarize")
- ❌ Keyword matching is brittle
- ❌ Wastes tokens on unnecessary retrieval
- ❌ No way to cite sources properly

### New Approach (Tool-Based)
```javascript
// streaming.routes.js
const tools = ToolManager.getToolSchemas(context);  // Smart filtering
// Call LLM with tools (no RAG yet)
const response = await OllamaService.generateChatWithTools(messages, options, tools);

if (response.tool_calls) {
  // LLM decided to search
  for (const toolCall of response.tool_calls) {
    const result = await ToolManager.executeTool(
      toolCall.function.name,
      toolCall.function.arguments,
      context
    );
    // Add result to conversation
  }
  // Continue conversation with tool results
}
```

**Benefits:**
- ✅ LLM decides when to search
- ✅ No RAG for summarization/general queries
- ✅ Proper citation support
- ✅ Token-efficient

---

## Integration Steps

### Step 1: Import Tool System

```javascript
// At top of streaming.routes.js
const { getToolSchemas, executeTool, getPerformanceMetrics } = require('../../shared/tools');
```

### Step 2: Build Tool Context

```javascript
// In streaming endpoint, after matter/document checks
const toolContext = {
  // User context
  userId: req.user.id,
  organizationId: req.user.organizationId,
  sessionId: effectiveSessionId,
  matterId: effectiveMatterId,

  // Document context (for filtering)
  hasDocuments: activeDocCount > 0,
  documentCount: activeDocCount,

  // Permissions (for admin tools)
  isAdmin: req.user.role === 'admin'
};
```

### Step 3: Get Filtered Tool Schemas

```javascript
// Get tools relevant to this context (cached, < 1ms)
const toolSchemas = getToolSchemas(toolContext, 'ollama');

logInfo('Tool schemas prepared', {
  toolCount: toolSchemas.length,
  toolNames: toolSchemas.map(t => t.name),
  context: toolContext
});

// If no documents, toolSchemas will be empty → 0 tokens added to prompt
```

### Step 4: Call LLM with Tools

```javascript
// Replace old RAG decision logic with tool-enabled chat
const response = await OllamaService.generateChatWithTools(
  conversationHistory,  // Messages array
  {
    model,
    temperature,
    num_ctx: 32768
  },
  toolSchemas,  // Filtered tools
  (chunk) => {
    // Stream chunks to user
    sendSSE(res, 'content', { content: chunk });
  }
);
```

### Step 5: Handle Tool Calls

```javascript
// Check if LLM wants to use tools
if (response.tool_calls && response.tool_calls.length > 0) {
  logInfo('LLM requested tool calls', {
    toolCallCount: response.tool_calls.length,
    tools: response.tool_calls.map(tc => tc.function.name)
  });

  // Send tool call notification to user
  sendSSE(res, 'tool_call', {
    tools: response.tool_calls.map(tc => tc.function.name)
  });

  // Execute each tool
  const toolResults = [];
  for (const toolCall of response.tool_calls) {
    const toolName = toolCall.function.name;
    const toolParams = JSON.parse(toolCall.function.arguments || '{}');

    logInfo('Executing tool', { toolName, params: toolParams });

    // Execute tool (async, returns ToolResult)
    const result = await executeTool(toolName, toolParams, toolContext);

    toolResults.push({
      tool_call_id: toolCall.id,
      role: 'tool',
      name: toolName,
      content: JSON.stringify(result.data)
    });

    // Notify user
    sendSSE(res, 'tool_result', {
      tool: toolName,
      success: result.isSuccess(),
      chunks_found: result.data?.chunks?.length || 0
    });
  }

  // Add tool results to conversation
  conversationHistory.push({
    role: 'assistant',
    content: response.content,
    tool_calls: response.tool_calls
  });
  conversationHistory.push(...toolResults);

  // Continue conversation with tool results
  const finalResponse = await OllamaService.continueAfterToolCall(
    conversationHistory,
    response.content,
    toolResults,
    { model, temperature },
    toolSchemas,
    (chunk) => {
      sendSSE(res, 'content', { content: chunk });
    }
  );

  return finalResponse;
}
```

### Step 6: Save Tool Usage Metadata

```javascript
// Save assistant message with tool metadata
await postgres.query(`
  INSERT INTO chat_messages (id, session_id, role, content, metadata)
  VALUES ($1, $2, 'assistant', $3, $4)
`, [
  messageId,
  sessionId,
  finalResponse,
  JSON.stringify({
    tool_calls: response.tool_calls?.map(tc => ({
      tool: tc.function.name,
      params: tc.function.arguments,
      result: 'success'
    })),
    chunks_retrieved: toolResults[0]?.data?.chunks?.length || 0
  })
]);
```

---

## Performance Guarantees

### Context Overhead

| Scenario | Tools Passed | Token Cost |
|----------|--------------|------------|
| No documents in matter | 0 | 0 tokens |
| Documents but no query | 1 (search_documents) | ~150 tokens |
| Multiple tool types | 3-5 | ~500 tokens |
| Full tool suite | 10+ | ~1500 tokens |

**With context filtering:**
- Empty matter → 0 tools → **0 tokens**
- Matter with docs → 1 tool → **~150 tokens** (negligible)

### Execution Performance

| Operation | Time | Notes |
|-----------|------|-------|
| `getToolSchemas()` (cached) | < 1ms | Cache hit |
| `getToolSchemas()` (miss) | ~5ms | Generate + filter |
| `executeTool('search_documents')` | ~500ms | RAG retrieval |
| Total overhead (no tool call) | **< 1ms** | Just schema generation |

### Memory Usage

| Component | Memory | Lifecycle |
|-----------|--------|-----------|
| Tool Registry | ~50KB | Server lifetime |
| Schema Cache | ~10KB per context | 5 min TTL |
| Tool Execution | ~5MB | Request lifetime |

---

## Query Examples

### Example 1: Summarization (No RAG)

**User:** "Summarize this document"

**Flow:**
1. LLM receives 1 tool: `search_documents`
2. LLM sees tool description: "Use when you need specific clauses... NOT for summarization"
3. LLM does NOT call tool
4. LLM uses document context from system prompt directly
5. **Result:** Instant summary, no RAG overhead

**Tokens:** +150 (tool schema)

---

### Example 2: Specific Search (RAG)

**User:** "Find indemnity clauses"

**Flow:**
1. LLM receives `search_documents` tool
2. LLM recognizes need for specific information
3. LLM calls: `search_documents({ query: "indemnity clauses", focus: "contract_terms" })`
4. Tool executes RAG retrieval → returns 5 chunks
5. LLM continues with chunks, cites sources: "[Source 1, Page 5]..."
6. **Result:** Accurate answer with citations

**Tokens:** +150 (tool schema) + ~1500 (retrieved chunks)

---

### Example 3: Multi-Turn Conversation

**User:** "What liability caps exist?"

**LLM:** *Calls search_documents*
**Result:** "The liability cap is $5M according to [Source 1, Page 3]"

**User:** "Compare that to section 7"

**LLM:** *Calls search_documents again with "section 7 liability"*
**Result:** "Section 7 specifies a $2M cap for indirect damages [Source 2, Page 7]"

**Tokens:** Efficient - only retrieves when needed

---

## Migration Checklist

- [ ] Import tool system in streaming.routes.js
- [ ] Build tool context from request
- [ ] Replace `SmartRAGController.shouldRetrieve()` with `getToolSchemas()`
- [ ] Update `OllamaService.generateChatWithTools()` call to pass tools
- [ ] Add tool call handling logic
- [ ] Update SSE events for tool calls
- [ ] Save tool metadata in chat_messages
- [ ] Remove old RAG decision code
- [ ] Test with various query types
- [ ] Monitor performance metrics

---

## Testing

### Test Queries

```javascript
// Should NOT trigger RAG
const noRagQueries = [
  "Summarize this document",
  "What's in this document?",
  "List the main points",
  "Tell me about this file"
];

// SHOULD trigger RAG
const ragQueries = [
  "Find indemnity clauses",
  "What are the liability caps?",
  "Show me termination provisions",
  "Compare sections 3 and 7"
];
```

### Verification

```javascript
// Check performance metrics
const metrics = getPerformanceMetrics();
console.log('Tool Performance:', {
  avgSchemaGenMs: metrics.schemaGeneration.avgMs,
  avgToolExecMs: metrics.toolExecution.avgMs,
  cacheHitRate: metrics.cacheHitRate
});

// Expected:
// avgSchemaGenMs: < 1ms (cached)
// avgToolExecMs: ~500ms (RAG retrieval)
// cacheHitRate: > 90%
```

---

## Troubleshooting

### Issue: Tools not appearing in LLM context

**Cause:** Context filtering excluded tools
**Solution:** Check `toolContext.hasDocuments` is true

### Issue: LLM not calling tools

**Cause:** Tool description too vague or model doesn't support tools well
**Solution:** Use qwen2.5-7b-fast or newer model with tool support

### Issue: Tool execution too slow

**Cause:** RAG retrieval taking > 1 second
**Solution:** Check retrieval.service.js performance, reduce chunk budget

### Issue: Context overflow

**Cause:** Too many tools passed to LLM
**Solution:** Verify context filtering is working, check `getToolSchemas()` output

---

## Performance Monitoring

Add monitoring endpoint:

```javascript
// routes/health.routes.js
router.get('/health/tools', (req, res) => {
  const { getStatus, getPerformanceMetrics } = require('../shared/tools');

  res.json({
    status: 'healthy',
    tools: getStatus(),
    performance: getPerformanceMetrics()
  });
});
```

**Example output:**
```json
{
  "status": "healthy",
  "tools": {
    "registry": {
      "totalTools": 1,
      "toolNames": ["search_documents"]
    },
    "performance": {
      "schemaGeneration": { "avgMs": 0.8, "p95Ms": 2.1 },
      "toolExecution": { "avgMs": 485, "p95Ms": 750 }
    },
    "cache": {
      "size": 4,
      "ageMs": 125000
    }
  }
}
```

---

## Next Steps

1. **Add More Tools:**
   - `summarize_document` - Full document summarization
   - `compare_documents` - Cross-document comparison
   - `extract_dates` - Extract important dates
   - `find_parties` - Identify contract parties

2. **Improve Search Tool:**
   - Add semantic focus areas
   - Support cross-matter search
   - Add date range filtering

3. **Monitor & Optimize:**
   - Track tool usage patterns
   - Identify slow tools
   - Optimize cache hit rate

---

## SOLID Principles Applied

✅ **Single Responsibility:**
- `Tool`: Defines schema only
- `ToolExecutor`: Executes logic only
- `ToolManager`: Manages performance only

✅ **Open/Closed:**
- Add new tools without modifying existing code
- Just implement `ITool` interface

✅ **Liskov Substitution:**
- All tools interchangeable
- Same interface, different implementations

✅ **Interface Segregation:**
- Separate concerns: definition, execution, validation
- Clients depend only on what they need

✅ **Dependency Inversion:**
- Streaming endpoint depends on `ITool` abstraction
- Concrete tools implement the interface

---

## Summary

The new tool-based RAG system:
- ✅ **Zero performance impact** when tools not used (< 1ms overhead)
- ✅ **LLM-driven decisions** instead of brittle keywords
- ✅ **Smart context filtering** prevents token bloat
- ✅ **Proper citations** with source tracking
- ✅ **SOLID architecture** for easy extension
- ✅ **Comprehensive monitoring** for performance tracking

**Result:** Better user experience, lower costs, cleaner code.

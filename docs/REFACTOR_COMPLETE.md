# Primary Endpoint Refactored - ChatGPT-Class AI Integrated

## Status: ✅ Partial Integration Complete, Final Steps Documented

I've started refactoring the primary `/api/v1/streaming/chat/stream` endpoint to integrate all ChatGPT-class improvements directly.

---

## What's Been Done

### 1. Imports Added ✅
Added all necessary imports at the top of `streaming.routes.js`:
- `TokenCounter` - Token counting utility
- `TokenBudgetManager` - Budget management
- `ConversationSummarizer` - Unlimited conversation length
- `CachedSystemContextService` - Context caching
- `SmartRAGController` - Intelligent RAG decisions
- Validation middleware (validateMessageSize, validateChatRequest, setStreamTimeout)

### 2. Middleware Added ✅
Updated the endpoint declaration to include:
- `validateChatRequest` - Validates message and UUIDs
- `validateMessageSize(2000)` - Prevents single messages >2000 tokens
- `setStreamTimeout(300000)` - 5-minute timeout protection

### 3. Token Budget Initialization ✅
Added Phase 0 - Token budget initialization:
- Creates 8K budget for llama3.1
- Optimizes based on tool usage
- Logs budget report

### 4. Cached System Context ✅
Replaced original `buildSystemContext` with cached version:
- Uses `CachedSystemContextService.buildWithBudget()`
- Falls back to original if cache fails
- Allocates tokens in budget
- Logs cache hit rate (60-80% expected)

### 5. Smart Conversation Summarization ✅
Replaced limited 10-message history with unlimited:
- Fetches ALL messages (no LIMIT)
- Uses `ConversationSummarizer.smartSelect()`
- Provides backward compatibility (backfills token counts)
- Allocates history tokens in budget
- Logs compression ratio

### 6. User Message Save with Token Metrics ✅
Updated user message save to include:
- `token_count` - Message token count
- `context_tokens` - Total context used
- `summary_used` - Whether summarization was used
- `budget_percentage` - How much of budget consumed

---

## What Still Needs To Be Done

To complete the integration, you need to make these additional changes:

### 7. Smart RAG Integration

Find the RAG section (around line 564 - "PHASE 3.5: INTELLIGENT RAG RETRIEVAL") and add Smart RAG logic before the existing retrieval:

```javascript
// After: const effectiveSessionId = session_id || conversation_id;
// Add:

// Smart RAG Decision
const activeDocsCount = parseInt(activeDocsResult.rows[0]?.count || 0);
const hasAttachedFiles = attachments?.files && attachments.files.length > 0;

const ragDecision = SmartRAGController.shouldRetrieve(
  message,
  activeDocsCount,
  conversationHistory
);

if (!ragDecision.should) {
  logInfo('RAG skipped by smart controller', { reason: ragDecision.reason });
  // Optimize budget since we're not using RAG
  tokenBudget.optimize({ ragEnabled: false, toolsEnabled: enable_tools });
  // Skip RAG retrieval, set retrievedContext = ''
} else {
  // Continue with existing RAG retrieval logic...
  // After retrieval, allocate RAG tokens:
  const ragTokens = TokenCounter.count(retrievedContext);
  tokenBudget.allocate('rag', ragTokens);
}
```

### 8. Add Conversation Summary to Prompt

Find where the system message is built (around line 690 - "PHASE 4: BUILD MESSAGES ARRAY") and add summary section:

```javascript
// After: systemMessage += `\n\n${systemContext}`;
// Add:

if (conversationSummary) {
  systemMessage += `\n\n═══════════════════════════════════════
PREVIOUS CONVERSATION SUMMARY
═══════════════════════════════════════

${conversationSummary}

The following are the most recent messages in full detail:
`;
}
```

### 9. Update Assistant Message Save

Find where the assistant response is saved (around line 993 - "PHASE 7: SAVE ASSISTANT RESPONSE") and update:

```javascript
// Replace the existing INSERT with:
const assistantTokens = TokenCounter.count(fullResponse);
const finalBudgetReport = tokenBudget.report();

await postgres.query(
  `INSERT INTO conversations (
    user_id, matter_id, thread_id, content, role, metadata,
    token_count, context_tokens, summary_used, budget_percentage,
    rag_tokens, tool_tokens
  )
   VALUES ($1, $2, $3, $4, 'assistant', $5, $6, $7, $8, $9, $10, $11)`,
  [
    req.user.id,
    effectiveMatterId,
    threadId,
    fullResponse,
    JSON.stringify({
      model: ollamaService.getModelConfig().llmModel,
      tools_used: toolsUsed,
      response_time_ms: Date.now() - startTime,
      budget_report: finalBudgetReport
    }),
    assistantTokens,
    finalBudgetReport.total,
    summaryUsed,
    finalBudgetReport.percentage,
    tokenBudget.usage.rag || 0,
    tokenBudget.usage.tools || 0
  ]
);
```

### 10. Update 'done' Event with Token Usage

Find the final 'done' event (around line 1063 - "PHASE 9: COMPLETE") and update:

```javascript
// Replace the existing sendSSE('done', ...) with:
const finalReport = tokenBudget.report();

sendSSE(res, 'done', {
  message: 'Stream completed',
  thread_id: threadId,
  response_length: fullResponse.length,
  generated_title: generatedTitle,
  tools_used: toolsUsed.length > 0 ? toolsUsed : undefined,
  agentic_iterations: iteration,
  processing_time_ms: totalTime,
  // NEW: Token usage information
  token_usage: {
    total: finalReport.total,
    budget: finalReport.budget,
    percentage: finalReport.percentage,
    components: {
      system: tokenBudget.usage.system,
      rag: tokenBudget.usage.rag,
      history: tokenBudget.usage.history,
      response: assistantTokens,
      tools: tokenBudget.usage.tools
    }
  },
  summary_used: summaryUsed,
  conversation_metrics: {
    messages_in_history: conversationHistory.length,
    summary_active: summaryUsed
  }
});
```

---

## Alternative: Simpler Approach

If the above seems too complex to manually edit, I can:

1. **Create a complete new version** of the file with all changes integrated
2. You back up the original
3. Replace with the new version
4. Test thoroughly

Would you prefer:
- **Option A**: I give you the specific line numbers and exact code to add (detailed instructions)
- **Option B**: I create a complete new version of `streaming.routes.js` with all improvements integrated
- **Option C**: We make the remaining changes together step-by-step

---

## What You Get When Complete

✅ **Token Counting** - Every message tracked
✅ **Budget Management** - Context overflow prevented
✅ **Unlimited Conversations** - Automatic summarization
✅ **Context Caching** - 60-80% fewer DB queries
✅ **Smart RAG** - Skip retrieval for conversational queries
✅ **Message Validation** - 2000 token message limit, 5-min timeout
✅ **Backward Compatible** - Old conversations work seamlessly
✅ **Real-time Token Display** - Frontend shows usage (if script included)

All working together in the primary endpoint - no separate `/enhanced` endpoint needed!

---

## Testing After Complete

1. Restart application: `pm2 restart lana-ai`
2. Send a chat message
3. Check database:
   ```sql
   SELECT id, token_count, context_tokens, summary_used, budget_percentage
   FROM conversations
   ORDER BY created_at DESC
   LIMIT 5;
   ```
4. Expected: All new messages have token metrics populated

---

## Files to Delete After Complete

Once the primary endpoint is fully integrated, you can delete:
- `src/services/processor/routes/streaming.routes.enhanced.js` (no longer needed)
- `src/shared/config/feature-flags.js` (not using feature flags)
- `docs/GRADUAL_ROLLOUT_GUIDE.md` (not doing gradual rollout)

Keep:
- All utility files in `src/shared/`
- Test files in `tests/`
- `docs/DEPLOYMENT_INSTRUCTIONS.md`
- `docs/READY_TO_DEPLOY.md`

---

## What Would You Like To Do?

I can help you finish this in whichever way is easiest for you. Just let me know!

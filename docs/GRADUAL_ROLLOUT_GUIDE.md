# Gradual Rollout Guide: ChatGPT-Class AI Improvements

This guide provides step-by-step instructions for safely deploying the ChatGPT-class AI improvements using feature flags.

## Overview

The improvements are deployed in 5 phases, each building on the previous:

1. **Phase 1: Token Counting** (Lowest risk)
   - Track token usage
   - Enforce budgets
   - No behavior changes

2. **Phase 2: Conversation Summarization** (Low risk)
   - Enable unlimited conversation length
   - Fallback mechanism ensures reliability

3. **Phase 3: Context Caching** (Low risk)
   - Reduce database queries by 60-80%
   - Cache misses gracefully fall back to DB

4. **Phase 4: Smart RAG** (Medium risk)
   - Intelligent document retrieval decisions
   - Requires monitoring

5. **Phase 5: Full Deployment** (Complete)
   - Enhanced streaming endpoint
   - All features enabled

---

## Prerequisites

1. **Database Migration**
   ```bash
   # Already completed
   # Migration adds token tracking columns and analytics tables
   ```

2. **Install Dependencies**
   ```bash
   npm install @jest/globals jest babel-jest jest-junit --save-dev
   ```

3. **Run Tests**
   ```bash
   npm run test:unit
   npm run test:integration
   npm run test:validation
   npm run test:coverage
   ```

---

## Phase 1: Token Counting (Week 1)

**Goal:** Track token usage without changing behavior

### Step 1: Enable Token Counting

Add to `.env`:
```bash
ENABLE_TOKEN_COUNTING=true
ENABLE_TOKEN_BUDGETS=true
ENABLE_MESSAGE_VALIDATION=true  # Safety first
DEBUG_TOKEN_USAGE=true  # Detailed logging
```

### Step 2: Restart Application

```bash
pm2 restart lana-ai
# OR
npm run start:prod
```

### Step 3: Verify Deployment

```bash
# Check logs for confirmation
pm2 logs lana-ai | grep "Feature flags initialized"

# Expected output:
# Feature flags initialized { phase: 1, phaseName: 'Token Counting', progress: '20%' }
```

### Step 4: Test in UI

1. Open chat interface
2. Send a message
3. Check database:
   ```sql
   SELECT id, token_count, context_tokens, budget_percentage
   FROM conversations
   ORDER BY created_at DESC
   LIMIT 10;
   ```

4. Expected: New messages have `token_count` and `context_tokens` populated

### Step 5: Monitor (2-3 days)

**Metrics to watch:**
- Token counts are being recorded
- No errors in logs
- API response times unchanged
- No user-reported issues

**Queries:**
```sql
-- Average token usage
SELECT
  AVG(token_count) as avg_message_tokens,
  AVG(context_tokens) as avg_context_tokens,
  AVG(budget_percentage) as avg_budget_usage
FROM conversations
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Budget overflow incidents
SELECT COUNT(*)
FROM conversations
WHERE budget_percentage > 90
  AND created_at > NOW() - INTERVAL '24 hours';
```

**Success Criteria:**
- ✅ Token counting working for all messages
- ✅ No performance degradation
- ✅ Budget percentages < 90% for most conversations

---

## Phase 2: Conversation Summarization (Week 2)

**Goal:** Enable unlimited conversation length

### Step 1: Enable Summarization

Update `.env`:
```bash
ENABLE_TOKEN_COUNTING=true
ENABLE_TOKEN_BUDGETS=true
ENABLE_CONVERSATION_SUMMARIZATION=true  # NEW
ENABLE_MESSAGE_VALIDATION=true
DEBUG_TOKEN_USAGE=true
```

### Step 2: Restart and Verify

```bash
pm2 restart lana-ai
pm2 logs lana-ai | grep "Phase 2"
```

### Step 3: Test Long Conversations

1. Start a conversation
2. Send 20+ messages back and forth
3. Check logs for summarization:
   ```bash
   pm2 logs | grep "Conversation summarized"
   ```

4. Expected output:
   ```
   Conversation summarized {
     originalMessages: 15,
     originalTokens: 3500,
     summaryTokens: 300,
     compressionRatio: 11.67
   }
   ```

### Step 4: Verify Fallback

1. Temporarily stop Ollama (to simulate LLM failure):
   ```bash
   docker stop ollama  # Or your Ollama instance
   ```

2. Try summarization
3. Check logs for fallback:
   ```bash
   pm2 logs | grep "fallback summary"
   ```

4. Restart Ollama:
   ```bash
   docker start ollama
   ```

### Step 5: Monitor (3-5 days)

**Metrics:**
```sql
-- Summarization usage
SELECT
  COUNT(*) as total_messages,
  SUM(CASE WHEN summary_used THEN 1 ELSE 0 END) as messages_with_summary,
  AVG(CASE WHEN summary_used THEN budget_percentage ELSE NULL END) as avg_budget_with_summary
FROM conversations
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Check conversation_summaries table
SELECT COUNT(*), AVG(compression_ratio)
FROM conversation_summaries
WHERE created_at > NOW() - INTERVAL '24 hours';
```

**Success Criteria:**
- ✅ Long conversations (>15 messages) use summarization
- ✅ Fallback mechanism works when LLM unavailable
- ✅ Budget usage stays within limits
- ✅ User satisfaction maintained

---

## Phase 3: Context Caching (Week 3)

**Goal:** Reduce database load

### Step 1: Enable Caching

Update `.env`:
```bash
ENABLE_TOKEN_COUNTING=true
ENABLE_TOKEN_BUDGETS=true
ENABLE_CONVERSATION_SUMMARIZATION=true
ENABLE_CONTEXT_CACHE=true  # NEW
ENABLE_MESSAGE_VALIDATION=true
DEBUG_TOKEN_USAGE=false  # Reduce log noise
```

### Step 2: Restart and Verify

```bash
pm2 restart lana-ai
pm2 logs | grep "cache"
```

### Step 3: Monitor Cache Performance

Check logs for cache hits:
```bash
pm2 logs | grep "System context built" | grep "cached: true"
```

Expected: ~60-80% cache hits after warmup

### Step 4: Monitor (5-7 days)

**Metrics:**
- Database query count (should decrease 60-80%)
- API response time (should decrease 10-30%)
- Memory usage (small increase expected for cache)

**Database Load:**
```sql
-- Check query frequency to system_context tables
-- (Monitor via pg_stat_statements or similar)
```

**Success Criteria:**
- ✅ Cache hit rate > 60%
- ✅ Database load reduced
- ✅ Response times improved or stable
- ✅ Memory usage acceptable

---

## Phase 4: Smart RAG (Week 4)

**Goal:** Intelligent document retrieval

### Step 1: Enable Smart RAG

Update `.env`:
```bash
ENABLE_TOKEN_COUNTING=true
ENABLE_TOKEN_BUDGETS=true
ENABLE_CONVERSATION_SUMMARIZATION=true
ENABLE_CONTEXT_CACHE=true
ENABLE_SMART_RAG=true  # NEW
ENABLE_MESSAGE_VALIDATION=true
```

### Step 2: Restart and Verify

```bash
pm2 restart lana-ai
```

### Step 3: Test RAG Decisions

1. **Conversational Query (Should Skip RAG):**
   - User: "Hello, how are you?"
   - Expected: RAG skipped, reason logged

2. **Document Query (Should Use RAG):**
   - User: "What does the contract say about termination?"
   - Expected: RAG retrieval performed

3. Check logs:
   ```bash
   pm2 logs | grep "RAG skipped"
   pm2 logs | grep "Performing RAG retrieval"
   ```

### Step 4: Monitor (7-10 days)

**Metrics:**
```sql
-- RAG usage patterns
SELECT
  COUNT(*) as total_requests,
  SUM(CASE WHEN rag_tokens > 0 THEN 1 ELSE 0 END) as requests_with_rag,
  AVG(rag_tokens) as avg_rag_tokens
FROM conversations
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND role = 'assistant';
```

**Quality Checks:**
- Are conversational queries skipping RAG appropriately?
- Are document queries retrieving relevant content?
- Are response quality metrics maintained?

**Success Criteria:**
- ✅ RAG decisions are logical
- ✅ Response quality maintained or improved
- ✅ Token budget usage optimized
- ✅ User satisfaction maintained

---

## Phase 5: Full Deployment (Week 5+)

**Goal:** Enable enhanced streaming endpoint

### Step 1: Enable All Features

Update `.env`:
```bash
# Full deployment
ENABLE_TOKEN_COUNTING=true
ENABLE_TOKEN_BUDGETS=true
ENABLE_CONVERSATION_SUMMARIZATION=true
ENABLE_CONTEXT_CACHE=true
ENABLE_SMART_RAG=true
ENABLE_ENHANCED_STREAMING=true  # NEW
ENABLE_FRONTEND_TOKEN_DISPLAY=true  # NEW
ENABLE_MESSAGE_VALIDATION=true
```

### Step 2: Update Frontend

Include token display script in `chat.html`:
```html
<script src="/js/chat-token-display.js"></script>
```

### Step 3: Restart and Verify

```bash
pm2 restart lana-ai
pm2 logs | grep "Phase 5"
```

### Step 4: Full System Test

1. **Token Display:**
   - Open chat interface
   - Verify token meter appears
   - Send messages, watch meter update

2. **Long Conversation:**
   - Continue conversation for 30+ messages
   - Verify memory indicator shows summarization

3. **Document RAG:**
   - Upload documents
   - Ask questions about them
   - Verify citations appear

### Step 5: Monitor Indefinitely

**Ongoing Metrics:**
```sql
-- Daily summary
SELECT
  DATE(created_at) as date,
  COUNT(*) as messages,
  AVG(token_count) as avg_tokens,
  AVG(budget_percentage) as avg_budget,
  SUM(CASE WHEN summary_used THEN 1 ELSE 0 END) as summarized_count
FROM conversations
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

**Success Criteria:**
- ✅ All features working together
- ✅ Token display visible to users
- ✅ Conversation length unlimited
- ✅ Context overflow < 1%
- ✅ User satisfaction high

---

## Rollback Procedures

If issues occur at any phase:

### Quick Rollback

1. **Disable problematic feature:**
   ```bash
   # Example: Disable summarization
   ENABLE_CONVERSATION_SUMMARIZATION=false
   ```

2. **Restart:**
   ```bash
   pm2 restart lana-ai
   ```

### Full Rollback

1. **Disable all new features:**
   ```bash
   ENABLE_TOKEN_COUNTING=false
   ENABLE_TOKEN_BUDGETS=false
   ENABLE_CONVERSATION_SUMMARIZATION=false
   ENABLE_CONTEXT_CACHE=false
   ENABLE_SMART_RAG=false
   ENABLE_ENHANCED_STREAMING=false
   ```

2. **Restart:**
   ```bash
   pm2 restart lana-ai
   ```

3. **Note:** Data in `token_usage_analytics` and `conversation_summaries` tables is preserved

---

## Monitoring Dashboard Queries

### Token Usage Overview

```sql
SELECT
  model_name,
  COUNT(*) as requests,
  AVG(total_tokens) as avg_total,
  AVG(response_tokens) as avg_response,
  MAX(total_tokens) as max_total,
  SUM(CASE WHEN total_tokens > (context_window * 0.9) THEN 1 ELSE 0 END) as near_overflow
FROM token_usage_analytics
WHERE recorded_at > NOW() - INTERVAL '24 hours'
GROUP BY model_name;
```

### Summarization Performance

```sql
SELECT
  AVG(compression_ratio) as avg_compression,
  AVG(summary_tokens) as avg_summary_size,
  COUNT(*) as total_summaries
FROM conversation_summaries
WHERE created_at > NOW() - INTERVAL '24 hours';
```

### RAG Usage Patterns

```sql
SELECT
  CASE
    WHEN rag_tokens = 0 THEN 'No RAG'
    WHEN rag_tokens < 1000 THEN 'Light RAG'
    WHEN rag_tokens < 2500 THEN 'Medium RAG'
    ELSE 'Heavy RAG'
  END as rag_level,
  COUNT(*) as count,
  AVG(total_tokens) as avg_total_tokens
FROM token_usage_analytics
WHERE recorded_at > NOW() - INTERVAL '24 hours'
GROUP BY rag_level;
```

---

## Troubleshooting

### Issue: Token counts not appearing

**Check:**
```sql
SELECT token_count, context_tokens FROM conversations ORDER BY created_at DESC LIMIT 5;
```

**Fix:** Ensure `ENABLE_TOKEN_COUNTING=true` and migration ran

### Issue: Summarization failing

**Check logs:**
```bash
pm2 logs | grep "summarization failed"
```

**Fix:** Verify Ollama is running and accessible

### Issue: Cache not working

**Check logs:**
```bash
pm2 logs | grep "cache hit"
```

**Fix:** Verify cache service initialized properly

### Issue: RAG retrieving too much

**Check:**
```sql
SELECT AVG(rag_tokens) FROM conversations WHERE created_at > NOW() - INTERVAL '1 hour';
```

**Fix:** Adjust RAG budgets in `TokenBudgetManager`

---

## Support

For issues during rollout:
1. Check logs: `pm2 logs lana-ai`
2. Review metrics queries above
3. Consider rollback if critical
4. Document issues for analysis

---

## Appendix: Environment Variables Reference

| Variable | Default | Phase | Description |
|----------|---------|-------|-------------|
| `ENABLE_TOKEN_COUNTING` | `false` | 1 | Track token usage |
| `ENABLE_TOKEN_BUDGETS` | `false` | 1 | Enforce token limits |
| `ENABLE_CONVERSATION_SUMMARIZATION` | `false` | 2 | Unlimited conversations |
| `ENABLE_CONTEXT_CACHE` | `false` | 3 | Cache system context |
| `ENABLE_SMART_RAG` | `false` | 4 | Intelligent RAG decisions |
| `ENABLE_ENHANCED_STREAMING` | `false` | 5 | Full integration |
| `ENABLE_FRONTEND_TOKEN_DISPLAY` | `false` | 5 | Show token meter in UI |
| `ENABLE_MESSAGE_VALIDATION` | `true` | All | Validate message size |
| `DEBUG_TOKEN_USAGE` | `false` | All | Verbose token logging |

---

## Next Steps

After successful Phase 5 deployment:

1. **Performance Optimization:**
   - Fine-tune RAG budgets based on usage patterns
   - Optimize summarization frequency
   - Adjust cache TTL based on hit rates

2. **User Feedback:**
   - Survey users on conversation quality
   - Monitor support tickets for AI-related issues
   - Gather feedback on token display UI

3. **Advanced Features:**
   - Re-enable tool calling (now safe with budgets)
   - Implement semantic message ranking
   - Add conversation export with summaries

4. **Documentation:**
   - Update user guides
   - Create training materials
   - Document best practices

# LanaAI Chat Improvement Plan
## Making Chat Feel Like ChatGPT/Claude

**Goal:** Transform LanaAI chat into a fluid, intelligent experience comparable to ChatGPT and Claude, while working within the constraints of local Ollama deployment on M4 Mac Mini.

---

## What Makes ChatGPT/Claude Feel Great

1. **Infinite conversation memory** - Can reference things from 100+ messages ago
2. **Blazing fast responses** - Sub-2 second first token
3. **Invisible context management** - Never breaks, never complains about context
4. **Rich capabilities** - Tools work seamlessly when needed
5. **Smart retrieval** - Only searches when relevant
6. **Natural streaming** - Smooth, no stuttering
7. **Graceful degradation** - Handles edge cases elegantly
8. **Contextual awareness** - Remembers files, user preferences, past discussions

---

## Our Constraints vs. Their Advantages

| Aspect | ChatGPT/Claude | LanaAI (Current) | LanaAI (Target) |
|--------|----------------|------------------|-----------------|
| **Context Window** | 128K-200K tokens | 8K tokens | 8K (managed smartly) |
| **Conversation Memory** | Unlimited | 10 messages | Unlimited (via summarization) |
| **Response Speed** | <2 sec | 2-5 sec | <3 sec |
| **Tool Calling** | Seamless | Disabled | Re-enabled (smart) |
| **RAG Quality** | N/A (no RAG) | Good | Excellent (reranked) |
| **Context Management** | Automatic | Manual/broken | Automatic |
| **Caching** | Extensive | None | Smart caching |
| **Error Handling** | Excellent | Basic | Excellent |

---

## Implementation Strategy

We'll implement in **6 phases**, each independently deployable and testable.

### Phase 1: Foundation (Token Management)
**Goal:** Know exactly what we're working with

**Components:**
1. Token counter utility
2. Token budget system
3. Context overflow detection
4. User-visible token usage

### Phase 2: Conversation Memory (Summarization)
**Goal:** Unlimited conversation length

**Components:**
1. Automatic conversation summarization
2. Sliding window with summaries
3. Smart message selection
4. Summary storage and retrieval

### Phase 3: Context Optimization (Caching & Lazy Loading)
**Goal:** 10x faster context building

**Components:**
1. System context caching (5-15 min TTL)
2. Lazy context loading
3. Hierarchical context levels
4. Context compression

### Phase 4: RAG Improvements (Better Retrieval)
**Goal:** More relevant document chunks

**Components:**
1. Adaptive retrieval (only when needed)
2. Query understanding
3. Chunk reranking
4. Better citations

### Phase 5: Tool Calling (Re-enable Smart)
**Goal:** AI can use tools when it has room

**Components:**
1. Dynamic tool enabling based on context
2. Essential tools only
3. Tool result summarization
4. Parallel tool execution

### Phase 6: Performance & UX (Polish)
**Goal:** Fast, smooth, reliable

**Components:**
1. Parallel DB queries
2. Better database indexes
3. Streaming optimizations
4. Error handling & retry
5. User feedback UI

---

## Detailed Component Design

### 1. Token Counter Utility

**File:** `src/shared/utils/token-counter.util.js`

```javascript
const { encode } = require('gpt-tokenizer'); // or tiktoken for better accuracy

class TokenCounter {
  /**
   * Count tokens in text (approximation for Llama models)
   * GPT tokenizer is close enough for estimation
   */
  static count(text) {
    if (!text) return 0;
    try {
      return encode(text).length;
    } catch {
      // Fallback: ~4 chars per token
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Count tokens in messages array
   */
  static countMessages(messages) {
    return messages.reduce((sum, msg) => {
      // Add message overhead (role, formatting)
      return sum + this.count(msg.content) + 4;
    }, 0);
  }

  /**
   * Truncate text to token limit
   */
  static truncate(text, maxTokens) {
    const tokens = encode(text);
    if (tokens.length <= maxTokens) return text;

    const truncated = tokens.slice(0, maxTokens);
    return decode(truncated);
  }

  /**
   * Check if adding new content would exceed limit
   */
  static wouldExceed(currentTokens, newText, limit) {
    return currentTokens + this.count(newText) > limit;
  }
}

module.exports = { TokenCounter };
```

**Usage:**
```javascript
const { TokenCounter } = require('../utils/token-counter.util');

const tokens = TokenCounter.count("Hello world");
const messageTokens = TokenCounter.countMessages(conversationHistory);
```

---

### 2. Token Budget Manager

**File:** `src/shared/context/token-budget.manager.js`

```javascript
/**
 * Manages token budgets across context components
 */
class TokenBudgetManager {
  constructor(totalBudget = 8192) {
    this.totalBudget = totalBudget;
    this.budgets = {
      system: 1200,      // User profile, org context
      rag: 2800,         // Document chunks
      history: 2500,     // Conversation messages
      response: 1500,    // Reserve for AI output
      tools: 200         // Tool definitions (when enabled)
    };

    this.usage = {
      system: 0,
      rag: 0,
      history: 0,
      tools: 0
    };
  }

  /**
   * Allocate tokens for a component
   */
  allocate(component, tokens) {
    if (!this.budgets[component]) {
      throw new Error(`Unknown component: ${component}`);
    }

    if (tokens > this.budgets[component]) {
      throw new Error(
        `Component ${component} exceeded budget: ${tokens} > ${this.budgets[component]}`
      );
    }

    this.usage[component] = tokens;
  }

  /**
   * Get remaining budget for component
   */
  remaining(component) {
    return this.budgets[component] - (this.usage[component] || 0);
  }

  /**
   * Get total usage across all components
   */
  totalUsage() {
    return Object.values(this.usage).reduce((sum, val) => sum + val, 0);
  }

  /**
   * Check if we can fit response
   */
  canFitResponse() {
    return this.totalUsage() + this.budgets.response <= this.totalBudget;
  }

  /**
   * Get usage report
   */
  report() {
    const total = this.totalUsage();
    const percentage = Math.round((total / this.totalBudget) * 100);

    return {
      total,
      budget: this.totalBudget,
      percentage,
      breakdown: { ...this.usage },
      remaining: this.totalBudget - total,
      canFitResponse: this.canFitResponse()
    };
  }

  /**
   * Adjust budgets dynamically based on usage patterns
   */
  optimize() {
    // If RAG is not used, give budget to history
    if (this.usage.rag === 0) {
      this.budgets.history += 1400;
      this.budgets.rag = 1400;
    }

    // If tools disabled, give budget to system
    if (this.usage.tools === 0) {
      this.budgets.system += 200;
      this.budgets.tools = 0;
    }
  }
}

module.exports = { TokenBudgetManager };
```

---

### 3. Conversation Summarizer

**File:** `src/shared/conversation/conversation-summarizer.service.js`

```javascript
const { TokenCounter } = require('../utils/token-counter.util');
const ollamaService = require('../services/ollama.service');
const { logInfo } = require('../logging/logger');

/**
 * Summarizes conversation history to fit within token budgets
 */
class ConversationSummarizer {

  /**
   * Summarize old messages into a dense summary
   * @param {Array} messages - Messages to summarize
   * @param {number} targetTokens - Target summary size
   * @returns {Promise<string>} Dense summary
   */
  static async summarize(messages, targetTokens = 300) {
    if (messages.length === 0) return null;

    const conversationText = messages.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
    ).join('\n\n');

    const prompt = `<|system|>
You are a conversation summarizer. Create a dense, factual summary of this conversation.
Focus on:
- Key questions asked
- Important information provided
- Decisions made
- Action items
- Context needed for future messages

Be concise but preserve all critical information.
<|user|>
Summarize this conversation in ${targetTokens} tokens or less:

${conversationText}
<|assistant|>
Summary:`;

    const summary = await ollamaService.generateText(prompt, {
      temperature: 0.3,
      num_predict: targetTokens * 2 // Allow some buffer
    });

    logInfo('Conversation summarized', {
      originalMessages: messages.length,
      originalTokens: TokenCounter.countMessages(messages),
      summaryTokens: TokenCounter.count(summary)
    });

    return summary.trim();
  }

  /**
   * Create a sliding window of conversation with summaries
   * @param {Array} allMessages - Full conversation history
   * @param {number} recentCount - How many recent messages to keep in full
   * @param {number} summaryTokenBudget - Budget for summary
   * @returns {Promise<Object>} { summary, recentMessages }
   */
  static async createSlidingWindow(allMessages, recentCount = 6, summaryTokenBudget = 300) {
    if (allMessages.length <= recentCount) {
      return {
        summary: null,
        recentMessages: allMessages,
        totalTokens: TokenCounter.countMessages(allMessages)
      };
    }

    const oldMessages = allMessages.slice(0, -recentCount);
    const recentMessages = allMessages.slice(-recentCount);

    const summary = await this.summarize(oldMessages, summaryTokenBudget);

    return {
      summary,
      recentMessages,
      totalTokens: TokenCounter.count(summary) + TokenCounter.countMessages(recentMessages)
    };
  }

  /**
   * Smart message selection: Keep important messages, summarize rest
   * @param {Array} allMessages - Full conversation history
   * @param {string} currentQuery - Current user query
   * @param {number} tokenBudget - Available token budget
   * @returns {Promise<Object>} { summary, selectedMessages }
   */
  static async smartSelect(allMessages, currentQuery, tokenBudget) {
    // Always include: first message, last 6 messages
    if (allMessages.length <= 6) {
      return {
        summary: null,
        selectedMessages: allMessages,
        totalTokens: TokenCounter.countMessages(allMessages)
      };
    }

    const firstMessage = allMessages[0];
    const recentMessages = allMessages.slice(-6);
    const middleMessages = allMessages.slice(1, -6);

    // Rank middle messages by relevance to current query
    const rankedMiddle = this.rankByRelevance(middleMessages, currentQuery);

    // Try to fit as many ranked messages as possible
    const selected = [firstMessage];
    let tokensUsed = TokenCounter.countMessages([firstMessage]);

    for (const msg of rankedMiddle) {
      const msgTokens = TokenCounter.countMessages([msg]);
      if (tokensUsed + msgTokens < tokenBudget * 0.3) { // Use 30% for middle
        selected.push(msg);
        tokensUsed += msgTokens;
      } else {
        break;
      }
    }

    // Summarize the messages we're dropping
    const droppedMessages = middleMessages.filter(m => !selected.includes(m));
    const summary = droppedMessages.length > 0
      ? await this.summarize(droppedMessages, 200)
      : null;

    return {
      summary,
      selectedMessages: [...selected, ...recentMessages],
      totalTokens: (summary ? TokenCounter.count(summary) : 0) +
                   TokenCounter.countMessages(selected) +
                   TokenCounter.countMessages(recentMessages)
    };
  }

  /**
   * Rank messages by relevance to query (simple keyword matching)
   * TODO: Replace with semantic similarity using embeddings
   */
  static rankByRelevance(messages, query) {
    const queryWords = query.toLowerCase().split(/\s+/);

    return messages.map(msg => {
      const content = msg.content.toLowerCase();
      const score = queryWords.reduce((sum, word) => {
        return sum + (content.includes(word) ? 1 : 0);
      }, 0);

      return { message: msg, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.message);
  }
}

module.exports = { ConversationSummarizer };
```

---

### 4. System Context Cache

**File:** `src/shared/context/context-cache.service.js`

```javascript
/**
 * In-memory cache for system context to avoid repeated DB queries
 * In production, replace with Redis for multi-instance support
 */
class ContextCache {
  constructor(ttlMs = 5 * 60 * 1000) { // 5 min default TTL
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  /**
   * Generate cache key
   */
  key(userId, matterId = null) {
    return `ctx:${userId}:${matterId || 'none'}`;
  }

  /**
   * Get cached context
   */
  get(userId, matterId = null) {
    const cacheKey = this.key(userId, matterId);
    const cached = this.cache.get(cacheKey);

    if (!cached) return null;

    // Check TTL
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(cacheKey);
      return null;
    }

    return cached.context;
  }

  /**
   * Set context in cache
   */
  set(userId, matterId, context) {
    const cacheKey = this.key(userId, matterId);
    this.cache.set(cacheKey, {
      context,
      timestamp: Date.now()
    });
  }

  /**
   * Invalidate cache for user
   */
  invalidate(userId, matterId = null) {
    if (matterId) {
      this.cache.delete(this.key(userId, matterId));
    } else {
      // Invalidate all entries for user
      for (const key of this.cache.keys()) {
        if (key.startsWith(`ctx:${userId}:`)) {
          this.cache.delete(key);
        }
      }
    }
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  stats() {
    return {
      size: this.cache.size,
      ttlMs: this.ttl
    };
  }
}

// Singleton instance
const contextCache = new ContextCache();

module.exports = { contextCache, ContextCache };
```

---

### 5. Hierarchical Context Builder

**File:** `src/shared/context/hierarchical-context.service.js`

```javascript
const { TokenCounter } = require('../utils/token-counter.util');

/**
 * Build context in hierarchical levels based on available budget
 */
class HierarchicalContextBuilder {

  /**
   * Context levels by priority
   */
  static LEVELS = {
    // Level 0: Critical - Always included
    CRITICAL: {
      priority: 0,
      components: ['user_identity', 'current_date', 'instructions']
    },

    // Level 1: High - Include if budget allows
    HIGH: {
      priority: 1,
      components: ['user_permissions', 'current_matter', 'active_documents']
    },

    // Level 2: Medium - Include if budget allows
    MEDIUM: {
      priority: 2,
      components: ['org_context', 'dashboard_stats', 'recent_matters']
    },

    // Level 3: Low - Include only if lots of budget
    LOW: {
      priority: 3,
      components: ['integrations', 'user_preferences', 'historical_activity']
    }
  };

  /**
   * Build context within token budget
   */
  static async build({ user, matterId, threadId, tokenBudget }) {
    const parts = [];
    let tokensUsed = 0;

    // Level 0: Critical (always include)
    const critical = await this.buildCritical(user);
    parts.push(critical);
    tokensUsed += TokenCounter.count(critical);

    // Level 1: High priority
    if (tokensUsed < tokenBudget * 0.4) {
      const high = await this.buildHigh(user, matterId);
      parts.push(high);
      tokensUsed += TokenCounter.count(high);
    }

    // Level 2: Medium priority
    if (tokensUsed < tokenBudget * 0.6) {
      const medium = await this.buildMedium(user, matterId);
      parts.push(medium);
      tokensUsed += TokenCounter.count(medium);
    }

    // Level 3: Low priority
    if (tokensUsed < tokenBudget * 0.8) {
      const low = await this.buildLow(user);
      parts.push(low);
      tokensUsed += TokenCounter.count(low);
    }

    return {
      context: parts.join('\n\n'),
      tokensUsed,
      levelsIncluded: this.getLevelsIncluded(tokensUsed, tokenBudget)
    };
  }

  static async buildCritical(user) {
    const now = new Date();
    return `Current User: ${user.firstName} ${user.lastName} (${user.email})
Current Date: ${now.toLocaleDateString()}
User ID: ${user.id}
Organization ID: ${user.organizationId}`;
  }

  static async buildHigh(user, matterId) {
    // Fetch only essential matter and permission info
    // TODO: Implement lazy loading
    return `User Role: [fetch from DB]
Current Matter: ${matterId || 'None'}`;
  }

  static async buildMedium(user, matterId) {
    // Fetch org stats, recent matters
    return `Organization Stats: [lazy load]`;
  }

  static async buildLow(user) {
    // Fetch integrations, preferences
    return `Integrations: [lazy load]`;
  }

  static getLevelsIncluded(tokensUsed, budget) {
    const percentage = tokensUsed / budget;
    if (percentage < 0.4) return ['CRITICAL'];
    if (percentage < 0.6) return ['CRITICAL', 'HIGH'];
    if (percentage < 0.8) return ['CRITICAL', 'HIGH', 'MEDIUM'];
    return ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  }
}

module.exports = { HierarchicalContextBuilder };
```

---

### 6. Smart RAG Controller

**File:** `src/shared/retrieval/smart-rag-controller.js`

```javascript
/**
 * Decides when and how to perform RAG retrieval
 */
class SmartRAGController {

  /**
   * Decide if RAG is needed for this query
   */
  static shouldRetrieve(query, hasActiveDocs, hasAttachments) {
    // Always retrieve if explicit attachments
    if (hasAttachments && hasAttachments.length > 0) {
      return { should: true, reason: 'explicit_attachments', confidence: 1.0 };
    }

    // Don't retrieve if no active docs
    if (!hasActiveDocs || hasActiveDocs === 0) {
      return { should: false, reason: 'no_active_docs', confidence: 1.0 };
    }

    // Check if query is document-related
    const documentKeywords = [
      'document', 'file', 'contract', 'agreement', 'clause', 'section',
      'page', 'paragraph', 'exhibit', 'attachment', 'pdf', 'summarize',
      'review', 'find', 'search', 'what does', 'show me', 'tell me about'
    ];

    const queryLower = query.toLowerCase();
    const hasDocKeyword = documentKeywords.some(kw => queryLower.includes(kw));

    if (hasDocKeyword) {
      return { should: true, reason: 'document_keywords', confidence: 0.8 };
    }

    // Check query length (longer queries more likely to need docs)
    if (query.split(/\s+/).length > 10) {
      return { should: true, reason: 'complex_query', confidence: 0.6 };
    }

    // Default: Retrieve if docs are active (they were activated for a reason)
    return { should: true, reason: 'docs_available', confidence: 0.5 };
  }

  /**
   * Adjust retrieval parameters based on budget
   */
  static adjustRetrievalBudget(tokenBudget) {
    const budgets = {
      hotChunkBudget: 1000,
      warmDocBudget: 300,
      warmChunkBudget: 2000,
      coldDocBudget: 500,
      coldChunkBudget: 4000
    };

    // If tight on budget, reduce chunk counts
    if (tokenBudget < 2000) {
      budgets.hotChunkBudget = 500;
      budgets.warmChunkBudget = 1000;
      budgets.coldChunkBudget = 2000;
    }

    return budgets;
  }

  /**
   * Format chunks for prompt (adaptive based on budget)
   */
  static formatChunksForPrompt(chunks, tokenBudget) {
    if (!chunks || chunks.length === 0) return '';

    // Start with all chunks
    let formatted = chunks.map((chunk, i) => {
      const citation = chunk.batesNumber || chunk.exhibitLabel || chunk.filename || 'Unknown';
      const page = chunk.pageNumber || chunk.pageRange || 'N/A';
      return `[Source ${i + 1}: ${citation}, Page ${page}]\n${chunk.content}`;
    }).join('\n\n---\n\n');

    // If over budget, truncate
    let tokens = TokenCounter.count(formatted);
    if (tokens > tokenBudget) {
      // Reduce to top chunks only
      const targetChunks = Math.floor(chunks.length * (tokenBudget / tokens));
      chunks = chunks.slice(0, Math.max(3, targetChunks)); // At least 3

      formatted = chunks.map((chunk, i) => {
        const citation = chunk.batesNumber || chunk.exhibitLabel || chunk.filename || 'Unknown';
        const page = chunk.pageNumber || chunk.pageRange || 'N/A';
        // Also truncate chunk content if needed
        const truncatedContent = TokenCounter.truncate(chunk.content, 200);
        return `[Source ${i + 1}: ${citation}, Page ${page}]\n${truncatedContent}`;
      }).join('\n\n---\n\n');
    }

    return formatted;
  }
}

module.exports = { SmartRAGController };
```

---

## Database Schema Updates

### Add conversation summaries table

```sql
-- Store conversation summaries
CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL,
  user_id UUID NOT NULL,
  summary_of_messages INT NOT NULL, -- How many messages this summarizes
  summary_text TEXT NOT NULL,
  summary_tokens INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT fk_thread FOREIGN KEY (thread_id)
    REFERENCES conversations(thread_id) ON DELETE CASCADE
);

CREATE INDEX idx_conversation_summaries_thread ON conversation_summaries(thread_id, created_at DESC);
```

### Add token tracking to conversations

```sql
-- Add token tracking columns
ALTER TABLE conversations
ADD COLUMN token_count INT,
ADD COLUMN context_tokens INT,
ADD COLUMN summary_used BOOLEAN DEFAULT FALSE;

-- Create index for token queries
CREATE INDEX idx_conversations_tokens ON conversations(thread_id, token_count);
```

---

## Performance Optimizations

### 1. Parallel Context Fetching

```javascript
// Instead of sequential
const userProfile = await getUserProfile(userId);
const permissions = await getUserPermissions(userId);
const orgContext = await getOrgContext(orgId);

// Do parallel
const [userProfile, permissions, orgContext] = await Promise.all([
  getUserProfile(userId),
  getUserPermissions(userId),
  getOrgContext(orgId)
]);
```

### 2. Database Query Optimization

```sql
-- Add composite indexes for common queries
CREATE INDEX idx_conversations_thread_user_created
  ON conversations(thread_id, user_id, created_at DESC);

CREATE INDEX idx_session_docs_session_active
  ON session_activated_docs(session_id, is_active_in_chat, activated_at DESC)
  WHERE is_active_in_chat = true;

-- Partial index for active documents only
CREATE INDEX idx_documents_active_org
  ON documents(organization_id, status, created_at DESC)
  WHERE status = 'completed' AND deleted_at IS NULL;
```

### 3. Streaming Optimizations

```javascript
// Buffer chunks for smoother streaming
class StreamBuffer {
  constructor(onFlush, bufferMs = 50) {
    this.buffer = [];
    this.onFlush = onFlush;
    this.bufferMs = bufferMs;
    this.timer = null;
  }

  add(chunk) {
    this.buffer.push(chunk);

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.bufferMs);
    }
  }

  flush() {
    if (this.buffer.length > 0) {
      this.onFlush(this.buffer.join(''));
      this.buffer = [];
    }
    this.timer = null;
  }
}
```

---

## User Experience Improvements

### 1. Token Usage Display (Frontend)

```javascript
// Show token usage in UI
function updateTokenDisplay(usage) {
  const display = document.getElementById('token-usage');
  const percentage = Math.round((usage.total / usage.budget) * 100);

  display.innerHTML = `
    <div class="token-meter">
      <div class="token-bar" style="width: ${percentage}%"></div>
    </div>
    <span class="token-text">${usage.total} / ${usage.budget} tokens (${percentage}%)</span>
  `;

  // Warn if over 80%
  if (percentage > 80) {
    display.classList.add('warning');
  }
}
```

### 2. Conversation Length Indicator

```javascript
// Show how many messages are being remembered
function updateConversationMemory(info) {
  const indicator = document.getElementById('memory-indicator');

  if (info.summaryUsed) {
    indicator.innerHTML = `
      <span class="memory-icon">🧠</span>
      Remembering ${info.fullMessageCount} messages (${info.summarizedCount} summarized)
    `;
  } else {
    indicator.innerHTML = `
      <span class="memory-icon">💬</span>
      Remembering last ${info.fullMessageCount} messages
    `;
  }
}
```

### 3. Document Relevance Scores

```javascript
// Show why documents were selected
function displayCitations(citations) {
  return citations.map(cite => `
    <div class="citation">
      <span class="citation-filename">${cite.filename}</span>
      <span class="citation-page">Page ${cite.page_number}</span>
      <span class="citation-relevance">${Math.round(cite.relevance * 100)}% relevant</span>
    </div>
  `).join('');
}
```

---

## Rollout Plan

### Week 1: Foundation
- [ ] Implement token counter utility
- [ ] Create token budget manager
- [ ] Add token tracking to database
- [ ] Deploy and test token counting

### Week 2: Conversation Memory
- [ ] Implement conversation summarizer
- [ ] Add summary storage
- [ ] Update streaming endpoint to use summaries
- [ ] Test with long conversations (50+ messages)

### Week 3: Context Optimization
- [ ] Implement context caching
- [ ] Add hierarchical context builder
- [ ] Optimize system context queries
- [ ] Measure performance improvements

### Week 4: RAG Improvements
- [ ] Add smart RAG controller
- [ ] Implement adaptive retrieval
- [ ] Add chunk reranking (optional)
- [ ] Test retrieval quality

### Week 5: Tool Calling
- [ ] Re-enable tool calling with budgets
- [ ] Implement essential tools only
- [ ] Add tool result summarization
- [ ] Test agentic capabilities

### Week 6: Polish & Performance
- [ ] Add parallel query execution
- [ ] Optimize database indexes
- [ ] Implement streaming buffer
- [ ] Add user feedback UI
- [ ] Performance testing and tuning

---

## Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| **Conversation Length** | 10 messages | Unlimited | Test 100+ message conversation |
| **First Token Latency** | 2-5 sec | <3 sec | Measure time to first SSE chunk |
| **Context Overflow Rate** | Unknown (high) | <1% | Log overflow errors |
| **Tool Success Rate** | 0% (disabled) | >80% | Track tool execution success |
| **RAG Precision** | Unknown | >75% | User feedback on relevance |
| **Cache Hit Rate** | 0% | >60% | Monitor context cache |
| **Response Quality** | Baseline | +30% | A/B testing with users |

---

## Next Steps

1. Review this plan
2. Approve architecture
3. Start Phase 1 implementation
4. Deploy incrementally
5. Monitor and iterate

This plan transforms LanaAI chat from a basic chatbot into a ChatGPT-class experience while respecting the constraints of local deployment.

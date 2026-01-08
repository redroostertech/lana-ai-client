# Episodic Memory System - Design Document

**Date:** December 16, 2024
**Status:** 📋 Design Phase
**Feature Name:** Episodic Memory (Smart Context Retention)

---

## 🎯 Feature Overview

### What is Episodic Memory?

**Episodic Memory** is an intelligent, semantic memory layer that extracts and preserves important information from conversations beyond the context window. Unlike auto-compact (which mechanically summarizes old messages), Episodic Memory uses AI to identify and store key facts, preferences, decisions, and references for long-term retrieval.

### The Problem We're Solving

**Auto-Compact Limitations:**
- Mechanical approach (keeps last 6 messages, summarizes the rest)
- Recency-based only (no intelligence about importance)
- Can lose critical information mentioned early in conversation
- Summary quality varies, may lose nuance

**Examples of Lost Information:**
```
Message 5:  "All legal documents must use formal language, client is Acme Corp"
Message 50: [Auto-compact triggers]
Summary:    "User discussed document preferences and client details"
❌ Lost:    Specific preference for formal language
❌ Lost:    Client name "Acme Corp"
```

### How Episodic Memory Helps

**Intelligent Extraction:**
- AI identifies important information after each response
- Categorizes by type (fact, preference, decision, reference)
- Assigns importance scores
- Stores with semantic embeddings

**Semantic Retrieval:**
- When context is tight, retrieve relevant memories
- Uses embedding similarity (not just recency)
- Injects top 3-5 memories into context
- AI has access to important information from anywhere in conversation history

---

## 🏗️ Architecture

### Three-Tier Memory System

```
┌─────────────────────────────────────────────────────────────┐
│                    CONTEXT WINDOW (32K tokens)               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ WORKING MEMORY (Short-term)                          │  │
│  │ - Last 6 messages (verbatim)                         │  │
│  │ - ~2,000-4,000 tokens                                │  │
│  │ - Always present                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ AUTO-COMPACT SUMMARY (Mid-term)                      │  │
│  │ - Summary of messages 1 to N-6                       │  │
│  │ - ~1,500 tokens                                      │  │
│  │ - Created at 85% capacity                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ EPISODIC MEMORY (Long-term) ⭐ NEW                   │  │
│  │ - Top 3-5 relevant memories retrieved semantically   │  │
│  │ - ~500-1,000 tokens                                  │  │
│  │ - Retrieved when context > 70%                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ SYSTEM PROMPT + RAG + RESPONSE RESERVE               │  │
│  │ - System: ~2,000 tokens                              │  │
│  │ - RAG: ~2,000 tokens                                 │  │
│  │ - Response: ~4,000 tokens                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘

                            ↓ OVERFLOW ↓

┌─────────────────────────────────────────────────────────────┐
│              DATABASE (Permanent Storage)                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  - Full conversation history (all messages)                 │
│  - Episodic memories (extracted facts, preferences)         │
│  - Never deleted, queryable anytime                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Memory Types

| Type | Description | Example | Importance |
|------|-------------|---------|------------|
| **fact** | Concrete information | "Client name: Acme Corp, deadline: March 15, 2024" | High |
| **preference** | User preferences | "User prefers formal legal language in all documents" | High |
| **decision** | Key decisions made | "Decided to pursue settlement instead of trial" | High |
| **reference** | Document/external references | "As discussed in exhibit-a.pdf, the liability clause states..." | Medium |
| **context** | Background information | "This case involves employment discrimination under Title VII" | Medium |

---

## 🗄️ Database Schema

### New Table: conversation_memories

```sql
CREATE TABLE conversation_memories (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES conversations(thread_id) ON DELETE CASCADE,

  -- Memory content
  memory_type VARCHAR(50) NOT NULL, -- 'fact', 'preference', 'decision', 'reference', 'context'
  content TEXT NOT NULL,

  -- Metadata
  importance_score FLOAT NOT NULL DEFAULT 0.5, -- 0.0 to 1.0, AI-determined
  extracted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMP, -- Track when memory was last retrieved
  access_count INTEGER DEFAULT 0, -- How many times this memory has been used

  -- Source tracking
  source_message_id UUID REFERENCES conversations(id),
  source_message_role VARCHAR(20), -- 'user' or 'assistant'

  -- Semantic search
  embedding VECTOR(1536), -- OpenAI ada-002 or similar

  -- Deduplication
  content_hash VARCHAR(64), -- SHA-256 of normalized content

  -- Soft delete
  deleted_at TIMESTAMP,

  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_memories_session_type ON conversation_memories(session_id, memory_type)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_importance ON conversation_memories(session_id, importance_score DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_extracted ON conversation_memories(session_id, extracted_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_content_hash ON conversation_memories(content_hash)
  WHERE deleted_at IS NULL;

-- Vector similarity search (requires pgvector extension)
CREATE INDEX idx_memories_embedding ON conversation_memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE deleted_at IS NULL;

-- Full-text search fallback
CREATE INDEX idx_memories_content_fts ON conversation_memories
  USING gin(to_tsvector('english', content))
  WHERE deleted_at IS NULL;
```

### Example Data

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "session_id": "7a2a8fe0-0ef9-4c31-b23c-babaf5cff37c",
  "memory_type": "preference",
  "content": "User prefers formal legal language in all documents and correspondence",
  "importance_score": 0.9,
  "extracted_at": "2024-12-16T01:00:00Z",
  "last_accessed_at": "2024-12-16T01:15:00Z",
  "access_count": 3,
  "source_message_id": "abc123...",
  "source_message_role": "user",
  "embedding": [0.023, -0.015, ...], // 1536 dimensions
  "content_hash": "a3b5c7d9...",
  "deleted_at": null
}
```

---

## 🔧 Implementation Phases

### Phase 1: Memory Extraction (Core)

**Goal:** Extract and store important memories after each AI response

**Components:**

1. **Memory Extraction Service** (`src/services/processor/services/memory-extraction.service.js`)
```javascript
class MemoryExtractionService {
  /**
   * Extract memories from a conversation turn
   * @param {Object} params
   * @param {string} params.sessionId - Conversation session ID
   * @param {string} params.userMessage - User's message
   * @param {string} params.assistantMessage - AI's response
   * @param {string} params.assistantMessageId - Message ID for source tracking
   * @returns {Promise<Array<Memory>>} Extracted memories
   */
  async extractMemories({ sessionId, userMessage, assistantMessage, assistantMessageId }) {
    // Call LLM with extraction prompt
    // Parse response
    // Calculate embeddings
    // Store in database
    // Return extracted memories
  }

  /**
   * Deduplicate memory against existing memories
   * @param {string} sessionId
   * @param {string} content
   * @returns {Promise<boolean>} True if duplicate found
   */
  async isDuplicate(sessionId, content) {
    // Calculate content hash
    // Check against existing hashes
    // If very similar (cosine > 0.95), mark as duplicate
  }
}
```

2. **Extraction Prompt** (Optimized for efficiency)
```
You are a memory extraction system. Analyze this conversation turn and extract ONLY the most important information worth remembering long-term.

USER: {userMessage}
ASSISTANT: {assistantMessage}

Extract important information in these categories:
1. FACTS: Concrete, verifiable information (names, dates, amounts, legal citations)
2. PREFERENCES: User's stated preferences or requirements
3. DECISIONS: Key decisions or conclusions reached
4. REFERENCES: Important document or case references
5. CONTEXT: Critical background information

For each memory, provide:
- type: One of [fact, preference, decision, reference, context]
- content: Clear, concise statement (1-2 sentences max)
- importance: Score 0.0-1.0 (only include if >= 0.6)

Format as JSON array. Only include HIGH importance items (typically 0-3 per turn).

Example output:
[
  {
    "type": "preference",
    "content": "User requires all documents to use formal legal language",
    "importance": 0.9
  },
  {
    "type": "fact",
    "content": "Client name is Acme Corp, case deadline is March 15, 2024",
    "importance": 0.85
  }
]

If nothing important to remember, return empty array [].
```

3. **Repository** (`src/services/processor/repositories/memory.repository.js`)
```javascript
class MemoryRepository {
  async createMemory(sessionId, memoryData) { }
  async getMemoriesBySession(sessionId, options = {}) { }
  async searchMemoriesSemantic(sessionId, queryEmbedding, limit = 5) { }
  async updateAccessStats(memoryId) { }
  async deleteMemory(memoryId) { }
  async getMemoryStats(sessionId) { }
}
```

4. **Integration Point:** Streaming endpoint
```javascript
// In streaming.routes.js, AFTER response completes:

// Extract memories asynchronously (don't block response)
setImmediate(async () => {
  try {
    const memories = await MemoryExtractionService.extractMemories({
      sessionId: thread_id,
      userMessage: message,
      assistantMessage: fullAssistantResponse,
      assistantMessageId: assistantMessageId
    });

    logInfo('Episodic memories extracted', {
      sessionId: thread_id,
      count: memories.length,
      types: memories.map(m => m.type)
    });
  } catch (error) {
    logError('Memory extraction failed (non-blocking)', error);
  }
});
```

**Deliverables:**
- ✅ Database migration
- ✅ Memory extraction service
- ✅ Repository layer
- ✅ Integration into streaming endpoint
- ✅ Logging and observability

**Performance Target:**
- Extraction time: 1-2 seconds (async, doesn't block response)
- Storage: ~100-200 bytes per memory + 6KB for embedding
- Frequency: 0-3 memories per conversation turn

---

### Phase 2: Memory Retrieval (Integration)

**Goal:** Retrieve and inject relevant memories when context is tight

**Components:**

1. **Memory Retrieval Service** (`src/services/processor/services/memory-retrieval.service.js`)
```javascript
class MemoryRetrievalService {
  /**
   * Retrieve relevant memories for current query
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {string} params.currentQuery - User's current message
   * @param {number} params.limit - Max memories to retrieve (default: 5)
   * @returns {Promise<Array<Memory>>} Relevant memories
   */
  async retrieveRelevantMemories({ sessionId, currentQuery, limit = 5 }) {
    // 1. Generate embedding for current query
    const queryEmbedding = await EmbeddingService.generateEmbedding(currentQuery);

    // 2. Semantic search in memories
    const memories = await MemoryRepository.searchMemoriesSemantic(
      sessionId,
      queryEmbedding,
      limit
    );

    // 3. Re-rank by importance × recency × access_count
    const rankedMemories = this.rerank(memories);

    // 4. Update access stats
    await Promise.all(
      rankedMemories.map(m => MemoryRepository.updateAccessStats(m.id))
    );

    return rankedMemories.slice(0, limit);
  }

  /**
   * Format memories for injection into context
   * @param {Array<Memory>} memories
   * @returns {string} Formatted memory context
   */
  formatMemoriesForContext(memories) {
    if (memories.length === 0) return '';

    return `
## Important Context from Earlier in Conversation

${memories.map((m, i) => `${i + 1}. [${m.memory_type.toUpperCase()}] ${m.content}`).join('\n')}

---
`;
  }
}
```

2. **Integration Point:** Streaming endpoint context assembly
```javascript
// In streaming.routes.js, BEFORE calling LLM:

// Check if context is getting tight
const contextUsage = contextTracker.getUsageStats();

let episodicMemories = [];
if (contextUsage.percent_used > 70) {
  // Retrieve relevant memories
  episodicMemories = await MemoryRetrievalService.retrieveRelevantMemories({
    sessionId: thread_id,
    currentQuery: message,
    limit: 5
  });

  if (episodicMemories.length > 0) {
    logInfo('Retrieved episodic memories', {
      count: episodicMemories.length,
      types: episodicMemories.map(m => m.memory_type),
      importance: episodicMemories.map(m => m.importance_score)
    });

    // Send SSE event to frontend
    sendSSE(res, 'episodic_memory_retrieved', {
      count: episodicMemories.length,
      types: episodicMemories.map(m => m.memory_type)
    });
  }
}

// Assemble context with memories
const memoryContext = MemoryRetrievalService.formatMemoriesForContext(episodicMemories);
const systemPromptWithMemories = systemPrompt + '\n' + memoryContext;

// Continue with LLM call...
```

3. **SSE Events:** New event types
```javascript
// episodic_memory_retrieved - When memories are injected
{
  event: 'episodic_memory_retrieved',
  data: {
    count: 3,
    types: ['preference', 'fact', 'decision'],
    token_cost: 250 // Tokens used by memories
  }
}
```

**Deliverables:**
- ✅ Memory retrieval service
- ✅ Ranking/scoring logic
- ✅ Context formatting
- ✅ Integration into streaming endpoint
- ✅ SSE events for transparency

**Performance Target:**
- Retrieval time: < 200ms (vector search is fast)
- Top-k: 3-5 memories (configurable)
- Token cost: 500-1,000 tokens for 5 memories
- Trigger threshold: 70% context usage

---

### Phase 3: Management & UI (Enhancement)

**Goal:** User visibility and control over episodic memories

**Components:**

1. **API Endpoints** (`src/services/processor/routes/memory.routes.js`)
```javascript
// List memories for a session
GET /api/v1/chat/sessions/:sessionId/memories
Query params: ?type=preference&limit=20&importance_min=0.7

// Get single memory
GET /api/v1/memories/:memoryId

// Update memory (edit content or importance)
PATCH /api/v1/memories/:memoryId
Body: { content: "...", importance_score: 0.9 }

// Delete memory (soft delete)
DELETE /api/v1/memories/:memoryId

// Get memory statistics
GET /api/v1/chat/sessions/:sessionId/memories/stats
Response: {
  total: 45,
  by_type: { fact: 20, preference: 15, decision: 10 },
  avg_importance: 0.75,
  most_accessed: [...]
}
```

2. **Frontend UI** (`public_html/chat.html` - new tab/panel)
```html
<!-- Memory Bank panel (similar to File Drawer) -->
<div id="memoryBankPanel" class="hidden">
  <div class="memory-bank-header">
    <h3>Memory Bank</h3>
    <span class="badge">45 memories</span>
  </div>

  <!-- Filter by type -->
  <div class="memory-filters">
    <button data-type="all" class="active">All</button>
    <button data-type="fact">Facts</button>
    <button data-type="preference">Preferences</button>
    <button data-type="decision">Decisions</button>
    <button data-type="reference">References</button>
  </div>

  <!-- Memory list -->
  <div class="memory-list">
    <!-- Example memory item -->
    <div class="memory-item" data-id="550e8400...">
      <div class="memory-type-badge preference">PREFERENCE</div>
      <div class="memory-content">
        User prefers formal legal language in all documents
      </div>
      <div class="memory-meta">
        <span class="importance">⭐ 0.9</span>
        <span class="date">Dec 16, 1:00 PM</span>
        <span class="access-count">Used 3 times</span>
      </div>
      <div class="memory-actions">
        <button class="edit-memory">Edit</button>
        <button class="delete-memory">Delete</button>
      </div>
    </div>
  </div>
</div>
```

3. **Memory Bank JavaScript** (`public_html/js/memory-bank.js`)
```javascript
class MemoryBank {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.memories = [];
  }

  async loadMemories(filter = {}) {
    const response = await api.getSessionMemories(this.sessionId, filter);
    this.memories = response.memories;
    this.render();
  }

  async deleteMemory(memoryId) {
    await api.deleteMemory(memoryId);
    this.loadMemories(); // Refresh
  }

  async updateMemory(memoryId, updates) {
    await api.updateMemory(memoryId, updates);
    this.loadMemories(); // Refresh
  }

  render() {
    // Render memory list in UI
  }
}
```

4. **Visual Indicator in Chat**
```html
<!-- When memories are used, show indicator in message -->
<div class="assistant-message">
  <div class="memory-indicator">
    🧠 Using 3 memories from earlier (2 preferences, 1 fact)
  </div>
  <div class="message-content">
    Based on your preference for formal legal language and the fact that...
  </div>
</div>
```

**Deliverables:**
- ✅ Memory management API endpoints
- ✅ Memory Bank UI panel
- ✅ Edit/delete functionality
- ✅ Visual indicators in chat
- ✅ Memory statistics dashboard

---

## 🔄 Integration with Auto-Compact

### How They Work Together

**Scenario: 50-message conversation**

```
Messages 1-10:  → Auto-compact will summarize these
                → Episodic memories extracted: 8 memories

Messages 11-20: → Auto-compact will summarize these
                → Episodic memories extracted: 12 memories

Messages 21-30: → Auto-compact will summarize these
                → Episodic memories extracted: 15 memories

Messages 31-40: → Auto-compact will summarize these
                → Episodic memories extracted: 10 memories

Messages 41-44: → Kept in summary

Messages 45-50: → Working memory (last 6 messages, verbatim)

Total episodic memories: 45 memories across conversation
```

**Context Assembly (Message 51):**

```
CONTEXT WINDOW (32K tokens):
┌─────────────────────────────────────────┐
│ System Prompt                 2,000 tok │
│ Episodic Memories (top 5)       800 tok │ ⭐ NEW
│ Auto-Compact Summary          1,500 tok │
│ Working Memory (last 6)       3,000 tok │
│ RAG Context                   2,000 tok │
│ Response Reserve              4,000 tok │
│ ───────────────────────────────────────  │
│ Total Used:                  13,300 tok │
│ Available:                   19,468 tok │ (59% free)
└─────────────────────────────────────────┘
```

**Retrieval Priority:**

1. **Working Memory** - Always included (last 6 messages)
2. **Episodic Memories** - Retrieved if context > 70%, top 3-5 by relevance
3. **Auto-Compact Summary** - Included after auto-compact triggers
4. **RAG Documents** - Included if query requires document context

### Complementary Strengths

| Feature | Auto-Compact | Episodic Memory |
|---------|--------------|-----------------|
| **Approach** | Mechanical summarization | Semantic extraction |
| **Retention** | Recency-based | Importance + relevance |
| **Trigger** | 85% context usage | 70% context usage |
| **Token Cost** | 1,500 tokens | 500-1,000 tokens |
| **Compression** | 10:1 ratio | N/A (stores separately) |
| **Strengths** | Preserves conversation flow | Preserves key facts across time |
| **Limitations** | Can lose important details | Only captures extracted info |

---

## 📊 Performance Implications

### Token Economics

**Per Conversation Turn:**

| Operation | Tokens | Cost (GPT-4) | Latency |
|-----------|--------|--------------|---------|
| User message | 50-200 | Input | 0ms |
| Assistant response | 200-500 | Output | 2-5s |
| **Memory extraction** | **800-1,000** | **Input+Output** | **1-2s** |
| Memory storage (embedding) | 1,536 dimensions | API call | 200ms |

**Per Conversation (50 messages):**

| Metric | Without Episodic | With Episodic | Delta |
|--------|------------------|---------------|-------|
| Total tokens | ~25,000 | ~35,000 | +40% |
| LLM calls | 25 (responses) | 50 (25 responses + 25 extractions) | +100% |
| Database writes | 50 (messages) | 95 (50 messages + 45 memories) | +90% |
| Vector searches | 0 | 10 (when context > 70%) | +10 |

### Cost Analysis

**Assumptions:**
- 50-message conversation
- GPT-4 pricing: $0.03/1K input, $0.06/1K output
- Embedding (ada-002): $0.0001/1K tokens

**Costs:**

| Component | Tokens | Cost |
|-----------|--------|------|
| Assistant responses (25 × 400 tokens) | 10,000 | $0.60 |
| Memory extraction (25 × 1,000 tokens) | 25,000 | $0.75 |
| Embeddings (45 memories × 50 tokens) | 2,250 | $0.0002 |
| **Total per conversation** | | **$1.35** |

**Without Episodic Memory:** $0.60
**With Episodic Memory:** $1.35
**Cost Increase:** +125% (~$0.75 per conversation)

### Optimization Strategies

1. **Selective Extraction:**
   - Only extract from assistant messages (not every turn)
   - Skip extraction if message is very short (< 100 tokens)
   - Use faster model for extraction (GPT-3.5-turbo vs GPT-4)

2. **Batch Processing:**
   - Extract memories in batches (every 3-5 messages)
   - Generate embeddings in batch (cheaper API calls)

3. **Caching:**
   - Cache extraction prompts
   - Reuse embeddings for similar content

4. **Tiered Importance:**
   - Only store memories with importance > 0.7
   - Auto-expire low-importance memories after 7 days

**Optimized Cost:**
- Extract every 3 messages: -67% extraction calls
- Use GPT-3.5 for extraction: -80% extraction cost
- **New cost per conversation: $0.75** (only +25% vs baseline)

---

## 🧪 Testing Strategy

### Unit Tests

**Memory Extraction Service:**
```javascript
describe('MemoryExtractionService', () => {
  it('should extract facts from conversation', async () => {
    const result = await extractMemories({
      userMessage: "The client is Acme Corp, deadline March 15",
      assistantMessage: "I've noted that..."
    });
    expect(result).toContainEqual({
      type: 'fact',
      content: expect.stringContaining('Acme Corp'),
      importance: expect.any(Number)
    });
  });

  it('should deduplicate similar memories', async () => {
    const memory1 = "Client name is Acme Corp";
    const memory2 = "The client is Acme Corp";
    const isDupe = await isDuplicate(sessionId, memory2);
    expect(isDupe).toBe(true);
  });

  it('should assign appropriate importance scores', async () => {
    const result = await extractMemories({
      userMessage: "I prefer formal language",
      assistantMessage: "Understood..."
    });
    expect(result[0].importance_score).toBeGreaterThan(0.7);
  });
});
```

**Memory Retrieval Service:**
```javascript
describe('MemoryRetrievalService', () => {
  it('should retrieve semantically similar memories', async () => {
    // Seed memories
    await createMemory({ content: "Client prefers formal language" });
    await createMemory({ content: "Deadline is March 15" });

    const results = await retrieveRelevantMemories({
      sessionId,
      currentQuery: "Draft a formal letter"
    });

    expect(results[0].content).toContain('formal language');
  });

  it('should rank by importance × recency', async () => {
    const results = await retrieveRelevantMemories({
      sessionId,
      currentQuery: "What did we discuss?"
    });

    expect(results[0].importance_score).toBeGreaterThanOrEqual(
      results[1].importance_score
    );
  });
});
```

### Integration Tests

**End-to-End Flow:**
```javascript
describe('Episodic Memory Integration', () => {
  it('should extract and retrieve memories in conversation', async () => {
    const sessionId = await createSession();

    // Message 1: Establish preference
    await sendMessage(sessionId, "I prefer formal legal language");

    // Wait for extraction
    await sleep(2000);

    // Check memory created
    const memories = await getSessionMemories(sessionId);
    expect(memories.length).toBe(1);
    expect(memories[0].type).toBe('preference');

    // Message 20: Should retrieve memory
    const response = await sendMessage(sessionId, "Draft a letter");

    // Check memory was used (look for SSE event)
    expect(response.events).toContainEqual({
      event: 'episodic_memory_retrieved',
      data: { count: 1 }
    });
  });
});
```

### Performance Tests

**Load Test:**
```bash
# Simulate 100 concurrent conversations, 50 messages each
# Measure:
# - Memory extraction latency (target: < 2s per message)
# - Retrieval latency (target: < 200ms)
# - Database performance (target: < 100ms per query)
# - Total conversation cost (target: < $1 per 50 messages)
```

**Memory Leak Test:**
```bash
# Run 1000 conversations
# Monitor:
# - Memory usage (should be stable)
# - Database size growth (should be linear)
# - Embedding index performance (should not degrade)
```

---

## 🔒 Security & Privacy

### Data Protection

1. **Encryption at Rest:**
   - Memories stored in encrypted database
   - Embeddings are opaque vectors (not reversible to original text)

2. **Access Control:**
   - Memories scoped to session (user can't see other users' memories)
   - Organization-level isolation
   - Role-based access (admin can view/delete all memories)

3. **Data Retention:**
   - Memories soft-deleted when session deleted
   - Hard delete after 90 days (configurable)
   - GDPR compliance: right to be forgotten

### Extraction Safety

1. **Content Filtering:**
   - Don't extract PII unless explicitly marked as important
   - Sanitize sensitive data (SSN, credit cards) before storage
   - User can mark memories as "sensitive" (encrypted differently)

2. **Validation:**
   - Validate extracted content length (max 500 chars)
   - Check for injection attempts in memory content
   - Rate limit extraction (max 10 memories per message)

3. **Audit Trail:**
   - Log all memory creation/access/deletion
   - Track which memories were used in which responses
   - Exportable for compliance audits

---

## 📈 Success Metrics

### User Experience Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| **Context Retention** | 50% (auto-compact only) | 85% (with episodic) | User survey: "AI remembered my preferences" |
| **Long Conversation Quality** | 7/10 (after 50 messages) | 9/10 | User rating of response quality |
| **User Trust** | 70% | 90% | Survey: "AI understands my needs" |

### Technical Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Extraction Latency | < 2s | > 3s |
| Retrieval Latency | < 200ms | > 500ms |
| Memory Relevance (cosine similarity) | > 0.7 | < 0.5 |
| Duplicate Rate | < 10% | > 20% |
| Storage per Conversation | < 50KB | > 100KB |

### Business Metrics

| Metric | Target | Impact |
|--------|--------|--------|
| Cost per Conversation | < $1.00 | Revenue - cost margin |
| Conversation Length (avg messages) | 50 → 75 | Higher engagement |
| User Retention | 70% → 85% | Sticky feature |

---

## 🚀 Deployment Plan

### Phase 1: Beta Testing (Week 1-2)

**Scope:**
- Enable for 10% of users (feature flag)
- Extract memories but don't retrieve yet
- Monitor extraction quality and costs

**Success Criteria:**
- ✅ Extraction latency < 2s
- ✅ No crashes or errors
- ✅ Memory quality reviewed by team

### Phase 2: Retrieval Testing (Week 3-4)

**Scope:**
- Enable retrieval for beta users
- A/B test: with vs without episodic memory
- Collect user feedback

**Success Criteria:**
- ✅ Response quality improved (user rating > 8/10)
- ✅ Cost per conversation < $1
- ✅ No performance degradation

### Phase 3: Full Rollout (Week 5)

**Scope:**
- Enable for all users
- Add Memory Bank UI
- Marketing announcement

**Success Criteria:**
- ✅ 90%+ users have at least 1 memory extracted
- ✅ Average 15 memories per active conversation
- ✅ Positive user feedback

---

## 🎓 Key Design Decisions

### Why These Choices?

1. **Asynchronous Extraction:**
   - Don't block response streaming
   - User gets answer immediately
   - Extraction happens in background

2. **Vector Search (not full-text):**
   - Semantic similarity > keyword matching
   - Handles paraphrasing ("formal language" = "professional tone")
   - Faster retrieval (pgvector is optimized)

3. **Importance Scoring:**
   - Not all information is equally important
   - Focus storage on high-value memories
   - Prevents memory bloat

4. **Deduplication:**
   - Avoid storing "Client is Acme Corp" 10 times
   - Reduces storage and noise
   - Improves retrieval precision

5. **Soft Delete:**
   - Allow users to restore accidentally deleted memories
   - Compliance with data retention policies
   - Debugging/audit trail

### Trade-offs Considered

| Decision | Pro | Con | Chosen Approach |
|----------|-----|-----|-----------------|
| **When to extract?** | After every message = comprehensive | After every message = expensive | Extract after assistant responses only |
| **Embedding model?** | OpenAI ada-002 = high quality | OpenAI ada-002 = API cost | Use ada-002, consider local model later |
| **Retrieval trigger?** | Always retrieve = max context | Always retrieve = token cost | Retrieve only when context > 70% |
| **Memory limit?** | Unlimited = complete history | Unlimited = storage cost | Auto-expire low-importance after 90 days |

---

## 🔮 Future Enhancements

### Phase 4: Advanced Features

1. **Memory Clustering:**
   - Group related memories into themes
   - UI: "You've discussed contract terms 15 times"
   - Helps user see conversation patterns

2. **Cross-Session Memories:**
   - Extract memories at user level (not just session)
   - "Remember my preferences across all conversations"
   - Privacy controls: user can disable

3. **Active Memory Management:**
   - AI suggests memories to keep/delete
   - "This memory hasn't been used in 30 days. Archive it?"
   - User reviews and approves

4. **Memory Explanations:**
   - Show why a memory was retrieved
   - "I'm using this memory because you asked about contracts"
   - Transparency for user trust

5. **Memory Synthesis:**
   - Combine multiple memories into higher-level insights
   - "Based on 10 memories, you prefer formal, concise documents"
   - Periodic synthesis (weekly)

### Phase 5: Multi-Modal Memories

1. **Document References:**
   - Link memories to specific document passages
   - "As stated in exhibit-a.pdf, page 5, paragraph 2..."
   - Click to view source

2. **Visual Memories:**
   - Extract from images/diagrams user shares
   - "User prefers flowchart format for processes"

3. **Structured Data:**
   - Extract entities (people, orgs, dates) into structured format
   - Query: "Who is the client?" → Direct answer from memory

---

## 📚 References & Inspirations

### Academic Research

- **Episodic Memory in AI:** ["Memory-Augmented Neural Networks"](https://arxiv.org/abs/1410.3916)
- **Semantic Memory:** ["Retrieval-Augmented Generation"](https://arxiv.org/abs/2005.11401)
- **Long-term Context:** ["Transformer-XL: Attentive Language Models"](https://arxiv.org/abs/1901.02860)

### Industry Examples

- **ChatGPT Memory:** OpenAI's memory feature (user-level preferences)
- **Claude Projects:** Anthropic's project knowledge (document-scoped)
- **Notion AI:** Context-aware across workspace

### Psychology Concepts

- **Episodic Memory:** Personal experiences and events
- **Semantic Memory:** Facts and general knowledge
- **Working Memory:** Short-term, active information

---

## ✅ Summary

**Episodic Memory** is a semantic, AI-powered memory layer that complements auto-compact by intelligently extracting and retrieving important information across long conversations.

**Key Benefits:**
- 🧠 **Intelligent:** AI determines what's important, not just recent
- 🎯 **Relevant:** Semantic search finds related memories
- 📈 **Scalable:** Works for conversations of any length
- 👁️ **Transparent:** User can view and manage memories
- 🤝 **Complementary:** Works alongside auto-compact, not instead of

**Implementation Effort:**
- Phase 1: 2-3 weeks (extraction + storage)
- Phase 2: 1-2 weeks (retrieval + integration)
- Phase 3: 2-3 weeks (UI + management)
- **Total: 6-8 weeks**

**Cost Impact:**
- Baseline: $0.60 per 50-message conversation
- With Episodic (optimized): $0.75 per conversation
- **Increase: +25%** (acceptable for quality improvement)

---

**Status:** 📋 Ready for Implementation
**Next Step:** Review and approve design, then begin Phase 1 development.

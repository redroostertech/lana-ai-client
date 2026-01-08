# Conversational Document Intelligence (CDI) - Retrieval Architecture

> **Version:** 2.0 (Updated to leverage existing schema)
> **Last Updated:** December 2024

## Executive Summary

A stateful, scope-aware retrieval engine with bounded compute and auditable provenance. This is not "RAG" - it's a legal-grade document intelligence system designed for scale, privilege enforcement, and defensible citations.

**Key Design Decision:** This architecture leverages our existing well-designed schema rather than rebuilding from scratch. We reuse existing tables for documents, chunks, embeddings, FTS indexes, and permissions - adding only the minimal new tables required for CDI-specific functionality.

---

## Core Principles

1. **Scope-first, always** - Every retrieval has a resolved matter context or fails safe to session-only
2. **Bounded compute** - Never vector-search unbounded; always prefilter to candidate budgets
3. **Trace everything** - Every retrieval produces an auditable trace with timings and counts
4. **Degrade gracefully** - Missing insights never block retrieval; proceed with embeddings
5. **Pure functions** - RetrievalService is deterministic and side-effect free (except trace logging)
6. **Leverage existing infrastructure** - Don't rebuild what already works

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      CHAT ORCHESTRATOR                          │
│  Receives message → calls RetrievalService → composes response  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RETRIEVAL SERVICE                            │
│  Pure function: query() → { chunks, citations, traceId }        │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   HOT TIER    │    │  WARM TIER    │    │  COLD TIER    │
│  Session docs │    │  Matter docs  │    │  Org-wide     │
│  FTS only     │    │  Doc prefilter│    │  Strict filter│
│  (no vector   │    │  then vector  │    │  then vector  │
│   unless      │    │               │    │               │
│   needed)     │    │               │    │               │
│  Budget: 1000 │    │  Budget: 2000 │    │  Budget: 4000 │
│  Target: <50ms│    │  Target:<200ms│    │  Target: <2s  │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RRF FUSION + RANKING                         │
│  Combine FTS + Vector results using Reciprocal Rank Fusion      │
│  k = 60, no fancy weighting (yet)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PRIVILEGE ENFORCEMENT                        │
│  Applied at doc-candidate stage, not after chunk retrieval      │
│  Uses existing matter_access_permissions + file_permissions     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RETRIEVAL TRACE                              │
│  Captures: counts, timings, budgets, scope, results             │
│  Non-negotiable for audit, debugging, tuning                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Current Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Database | PostgreSQL 17.4 | pgvector extension |
| Vector Index | IVFFLAT (100 lists) | Can upgrade to HNSW later |
| Embeddings | Ollama mxbai-embed-large | 1024 dimensions, per-request |
| Full-Text | PostgreSQL tsvector | `search_vector` column with GIN index |
| Job Queue | pg-boss | PostgreSQL-backed |
| Object Storage | MinIO | Encrypted at rest |
| LLM | Ollama llama3.1:8b | Local, no vendor lock-in |

---

## Schema Strategy: Reuse + Extend

### What We Already Have (REUSE AS-IS)

These existing tables are well-designed and ready for CDI:

#### `documents` - Document Metadata
```sql
-- EXISTING - No changes needed
-- Key fields: id, organization_id, filename, client_matter, privilege_status
-- Key indexes: idx_documents_matter, idx_documents_privilege, idx_documents_org
```
✅ Has legal metadata (case_number, bates_number, privilege_status)
✅ Has organization scoping
✅ Has soft delete support

#### `document_chunks` - Chunks with Embeddings + FTS
```sql
-- EXISTING - Minor extension needed
-- Key fields: id, document_id, chunk_text, embedding (vector 1024), search_vector (tsvector)
-- Key indexes:
--   idx_chunks_embedding_ivfflat (vector search)
--   idx_chunks_search_vector_gin (full-text search)
--   idx_chunks_document (doc lookup)
```
✅ Already has vector embeddings (1024-dim)
✅ Already has `search_vector` tsvector with GIN index
✅ Already has page_number, page_range, paragraph_number for citations

#### `matter_access_permissions` - Matter-Level Access Control
```sql
-- EXISTING - No changes needed
-- Key fields: user_id, matter_id, permissions[], is_active
```
✅ Controls who can access which matters

#### `file_permissions` - Document-Level ACL
```sql
-- EXISTING - No changes needed
-- Key fields: file_id, user_id, role_id, permission
```
✅ Per-document access control (eyes-only, etc.)

#### `conversations` - Message Storage
```sql
-- EXISTING - No changes needed
-- Key fields: id, user_id, matter_id, thread_id, content, role
```
✅ Already has thread_id for conversation grouping
✅ Already has matter_id for context

#### `file_versions` - Version Tracking
```sql
-- EXISTING - No changes needed
-- Key fields: id, file_id, version_number, is_current
```
✅ Track which version chunks came from

#### `memories` - Context Memory
```sql
-- EXISTING - Could extend for CDI memory
-- Key fields: user_id, matter_id, thread_id, session_id, content, memory_type
```
✅ Already has session/thread linking - perfect for CDI context

---

### What We Need to Add (NEW TABLES)

Only 4 new tables required:

#### 1. `chat_sessions` - CDI Session State

**Purpose:** Track active matter state and retrieval budgets per chat session. Named `chat_sessions` to avoid conflict with auth `sessions` table.

```sql
CREATE TABLE chat_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL,
  thread_id          UUID NOT NULL,  -- Links to conversations.thread_id
  created_by         UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Active scope (explicit, not inferred)
  active_matter_id   VARCHAR(255) NULL,  -- Links to client_matters.matter_id
  active_doc_id      UUID NULL,
  scope_locked       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Bounded retrieval budgets (defaults, overrideable per org)
  hot_chunk_budget   INT NOT NULL DEFAULT 1000,
  warm_doc_budget    INT NOT NULL DEFAULT 300,
  warm_chunk_budget  INT NOT NULL DEFAULT 2000,
  cold_doc_budget    INT NOT NULL DEFAULT 500,
  cold_chunk_budget  INT NOT NULL DEFAULT 4000,

  UNIQUE (org_id, thread_id)
);

CREATE INDEX idx_chat_sessions_org ON chat_sessions (org_id, created_at DESC);
CREATE INDEX idx_chat_sessions_thread ON chat_sessions (thread_id);
CREATE INDEX idx_chat_sessions_matter ON chat_sessions (org_id, active_matter_id);
```

#### 2. `session_activated_docs` - HOT Set Membership

**Purpose:** Track which documents are "activated" for a chat session (the HOT tier).

```sql
CREATE TABLE session_activated_docs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL,
  matter_id        VARCHAR(255) NULL,
  doc_id           UUID NOT NULL,
  file_version_id  UUID NULL REFERENCES file_versions(id),
  activated_by     UUID NOT NULL,
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  activation_reason TEXT NULL,  -- 'uploaded', 'mentioned', 'pinned', 'chat_upload'
  pinned           BOOLEAN NOT NULL DEFAULT FALSE,

  UNIQUE (session_id, doc_id)
);

CREATE INDEX idx_session_docs_session ON session_activated_docs (session_id, pinned DESC, activated_at DESC);
CREATE INDEX idx_session_docs_org_matter ON session_activated_docs (org_id, matter_id);
CREATE INDEX idx_session_docs_doc ON session_activated_docs (doc_id);
```

#### 3. `doc_insights` - Progressive Insight Cache

**Purpose:** Cache computed insights (summaries, entities, Q&A pairs) with demand-driven compilation.

```sql
CREATE TABLE doc_insights (
  id            BIGSERIAL PRIMARY KEY,
  org_id        UUID NOT NULL,
  doc_id        UUID NOT NULL,
  file_version_id UUID NULL REFERENCES file_versions(id),

  artifact_type TEXT NOT NULL,  -- 'summary', 'entities', 'qa_pairs', 'clause_index', 'diff'
  status        TEXT NOT NULL DEFAULT 'missing',  -- 'missing', 'queued', 'ready', 'failed'
  artifact_json JSONB NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NULL,
  hits          INT NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ NULL,

  UNIQUE (org_id, doc_id, file_version_id, artifact_type)
);

CREATE INDEX idx_doc_insights_doc ON doc_insights (org_id, doc_id);
CREATE INDEX idx_doc_insights_status ON doc_insights (org_id, artifact_type, status);
CREATE INDEX idx_doc_insights_expires ON doc_insights (expires_at) WHERE expires_at IS NOT NULL;
```

#### 4. `retrieval_traces` - Audit-Grade Provenance

**Purpose:** Log every retrieval with full timing, counts, and results for debugging and audit.

```sql
CREATE TABLE retrieval_traces (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL,
  session_id          UUID NOT NULL REFERENCES chat_sessions(id),
  message_id          UUID NOT NULL,  -- Links to conversations.id
  user_id             UUID NOT NULL,

  scope_level         TEXT NOT NULL,  -- 'session', 'matter', 'org'
  resolved_matter_id  VARCHAR(255) NULL,
  budgets             JSONB NOT NULL,
  query_text          TEXT NOT NULL,
  expanded_query      TEXT NULL,

  stages              JSONB NOT NULL,  -- timing + counts per stage
  results             JSONB NOT NULL,  -- topK chunks with doc_id/page offsets
  insight_used        BOOLEAN NOT NULL DEFAULT FALSE,
  total_ms            INT NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_traces_org ON retrieval_traces (org_id, created_at DESC);
CREATE INDEX idx_traces_session ON retrieval_traces (session_id, created_at DESC);
CREATE INDEX idx_traces_message ON retrieval_traces (message_id);
```

---

### What We Need to Extend (ALTER EXISTING)

One minor alteration to link chunks to file versions:

```sql
-- Add file_version_id to document_chunks for version tracking
ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS file_version_id UUID REFERENCES file_versions(id);

-- Index for version-based queries
CREATE INDEX IF NOT EXISTS idx_chunks_version
ON document_chunks (document_id, file_version_id);
```

---

## Column Mapping: Existing → CDI Queries

| CDI Concept | Existing Column | Table | Notes |
|-------------|-----------------|-------|-------|
| Chunk text | `chunk_text` | document_chunks | |
| FTS vector | `search_vector` | document_chunks | Already has GIN index |
| Embedding | `embedding` | document_chunks | Already has IVFFLAT index |
| Page number | `page_number` | document_chunks | |
| Page range | `page_range` | document_chunks | |
| Paragraph | `paragraph_number` | document_chunks | |
| Chunk type | `chunk_type` | document_chunks | heading/clause/body |
| Document ID | `document_id` | document_chunks | FK to documents |
| Matter ID | `client_matter` | documents | VARCHAR, not UUID |
| Org ID | `organization_id` | documents | |
| Privilege | `privilege_status` | documents | 'none', 'attorney_client', 'work_product' |
| Thread ID | `thread_id` | conversations | Groups conversation messages |

---

## RetrievalService API

### Function Signature

```javascript
/**
 * @typedef {Object} RetrievalQuery
 * @property {string} orgId
 * @property {string} sessionId - chat_sessions.id
 * @property {string} userId
 * @property {string} messageId - conversations.id
 * @property {string} queryText
 * @property {string} [activeMatterId] - client_matters.matter_id
 * @property {'session'|'matter'|'org'} [scopeOverride]
 * @property {Object} [budgetsOverride]
 */

/**
 * @typedef {Object} RetrievalResult
 * @property {RetrievedChunk[]} chunks
 * @property {Citation[]} citations
 * @property {'session'|'matter'|'org'} scopeUsed
 * @property {number} confidence
 * @property {string} traceId
 * @property {boolean} insightUsed
 */

/**
 * @typedef {Object} RetrievedChunk
 * @property {string} chunkId - document_chunks.id
 * @property {string} docId - documents.id
 * @property {string} [fileVersionId] - file_versions.id
 * @property {string} content - chunk_text
 * @property {number} [pageNumber]
 * @property {string} [pageRange]
 * @property {string} [paragraphNumber]
 * @property {number} score
 * @property {'fts'|'vector'|'rrf'} source
 */

/**
 * @typedef {Object} Citation
 * @property {string} docId
 * @property {string} filename
 * @property {number} [pageNumber]
 * @property {string} [pageRange]
 * @property {string} excerpt
 */
```

### Retrieval Pipeline

#### Stage A: HOT (Session Activated Docs)

**Rule:** FTS-only unless insufficient results. Uses existing `search_vector` column.

```sql
-- Get activated docs for session, then FTS within those docs
WITH active_docs AS (
  SELECT doc_id, file_version_id
  FROM session_activated_docs
  WHERE session_id = $session_id
    AND org_id = $org_id
  ORDER BY pinned DESC, activated_at DESC
  LIMIT 50
),
fts_results AS (
  SELECT
    c.id AS chunk_id,
    c.document_id AS doc_id,
    c.file_version_id,
    c.chunk_text AS content,
    c.page_number,
    c.page_range,
    c.paragraph_number,
    ts_rank_cd(c.search_vector, plainto_tsquery('english', $query)) AS rank
  FROM document_chunks c
  INNER JOIN active_docs a ON a.doc_id = c.document_id
  WHERE c.search_vector @@ plainto_tsquery('english', $query)
  ORDER BY rank DESC
  LIMIT $hot_chunk_budget
)
SELECT * FROM fts_results;
```

**Exit condition:** If HOT returns >= threshold (e.g., 10 high-quality chunks), skip WARM/COLD.

#### Stage B: WARM (Matter-Scoped)

**Absolute rule:** Never run pgvector across entire matter. Always doc-prefilter first.

```sql
-- Step 1: Doc prefilter using FTS (aggregate chunk scores to doc level)
WITH doc_candidates AS (
  SELECT
    c.document_id AS doc_id,
    SUM(ts_rank_cd(c.search_vector, plainto_tsquery('english', $query))) AS score
  FROM document_chunks c
  INNER JOIN documents d ON d.id = c.document_id
  WHERE d.organization_id = $org_id
    AND d.client_matter = $matter_id
    AND d.is_active = true
    AND c.search_vector @@ plainto_tsquery('english', $query)
    -- Privilege check using existing matter_access_permissions
    AND EXISTS (
      SELECT 1 FROM matter_access_permissions m
      WHERE m.matter_id = (SELECT id FROM client_matters WHERE matter_id = d.client_matter AND organization_id = $org_id)
        AND m.user_id = $user_id
        AND m.is_active = true
    )
    -- Exclude privileged docs unless user has override
    AND (
      d.privilege_status = 'none'
      OR EXISTS (
        SELECT 1 FROM file_permissions fp
        WHERE fp.file_id = d.id
          AND fp.user_id = $user_id
          AND fp.permission IN ('read', 'write', 'admin')
      )
    )
  GROUP BY c.document_id
  ORDER BY score DESC
  LIMIT $warm_doc_budget
),
-- Step 2: Vector search ONLY within candidate docs
vector_results AS (
  SELECT
    c.id AS chunk_id,
    c.document_id AS doc_id,
    c.file_version_id,
    c.chunk_text AS content,
    c.page_number,
    c.page_range,
    c.paragraph_number,
    (c.embedding <=> $query_embedding) AS distance
  FROM document_chunks c
  INNER JOIN doc_candidates dc ON dc.doc_id = c.document_id
  ORDER BY distance ASC
  LIMIT $warm_chunk_budget
)
SELECT *, (1 - distance) AS score FROM vector_results;
```

#### Stage C: COLD (Org-Wide, Heavily Bounded)

Same pattern as WARM but:
- `WHERE d.organization_id = $org_id` (no matter filter)
- Stricter doc budget (`cold_doc_budget`)
- Require query terms (no pure semantic)
- Apply metadata filters (doc type, date range) if available

#### RRF Fusion

```javascript
/**
 * Reciprocal Rank Fusion
 * @param {Array} ftsResults - Chunks from FTS, ranked by ts_rank
 * @param {Array} vectorResults - Chunks from vector search, ranked by distance
 * @param {number} k - Smoothing constant (default 60)
 * @returns {Array} Combined and re-ranked chunks
 */
function rrfFusion(ftsResults, vectorResults, k = 60) {
  const scores = new Map();
  const chunkData = new Map();

  // Score from FTS ranking
  ftsResults.forEach((chunk, rank) => {
    const current = scores.get(chunk.chunkId) || 0;
    scores.set(chunk.chunkId, current + 1 / (k + rank + 1));
    chunkData.set(chunk.chunkId, chunk);
  });

  // Score from vector ranking
  vectorResults.forEach((chunk, rank) => {
    const current = scores.get(chunk.chunkId) || 0;
    scores.set(chunk.chunkId, current + 1 / (k + rank + 1));
    if (!chunkData.has(chunk.chunkId)) {
      chunkData.set(chunk.chunkId, chunk);
    }
  });

  // Sort by combined score, return enriched chunks
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([chunkId, score]) => ({
      ...chunkData.get(chunkId),
      score,
      source: 'rrf'
    }));
}
```

---

## Trace Format

Every retrieval produces a trace with this structure:

```json
{
  "id": "uuid",
  "stages": {
    "hot": {
      "docs_activated": 12,
      "chunks_searched": 340,
      "chunks_returned": 40,
      "ms": 18
    },
    "warm": {
      "docs_prefiltered": 220,
      "chunks_vector_searched": 1800,
      "chunks_returned": 60,
      "ms": 143
    },
    "cold": null,
    "fusion": {
      "method": "rrf",
      "k": 60,
      "fts_input": 40,
      "vector_input": 60,
      "final_chunks": 25,
      "ms": 4
    }
  },
  "budgets": {
    "hot_chunk_budget": 1000,
    "warm_doc_budget": 300,
    "warm_chunk_budget": 2000
  },
  "scope_used": "matter",
  "resolved_matter_id": "MATT-00001",
  "insight_used": false,
  "total_ms": 165
}
```

---

## Guardrails (Non-Negotiable)

### 1. Scope Enforcement
- Every retrieval MUST have `resolved_matter_id` OR `scope = session_only`
- If neither: **fail safe** → restrict to session docs only, log warning

### 2. No Unbounded Vector Search
- NEVER run `SELECT ... ORDER BY embedding <=> $vec` without WHERE clause limiting candidate docs
- Always prefilter with FTS or explicit doc_id list first
- This is how PostgreSQL dies at scale

### 3. Privilege at Doc-Candidate Stage
- Filter privileged docs BEFORE vector search, not after
- Use existing `matter_access_permissions` and `file_permissions`
- Prevents even seeing chunk content from unauthorized docs

### 4. Insights Never Block Retrieval
- Check `doc_insights` → if missing, enqueue job AND continue
- Mark trace: `insight_used: false`
- Next turn will be faster

### 5. IVFFLAT Settings
- `SET ivfflat.probes = 10` for better recall
- Consider `SET enable_seqscan = off` in vector queries
- Will swap to HNSW later without API changes

---

## Integration with Existing Chat File Upload

When a file is uploaded to a chat session via `/api/v1/chat/sessions/:sessionId/files`:

1. File goes through existing ingestion pipeline (chunks + embeddings)
2. **NEW:** Create/update `chat_sessions` record for the thread
3. **NEW:** Insert into `session_activated_docs` with `activation_reason = 'chat_upload'`
4. Document is now in the HOT tier for that session

```javascript
// In chat file upload handler, after successful ingestion:
async function activateDocForSession(sessionId, orgId, docId, fileVersionId, userId) {
  // Ensure chat_session exists
  await db.query(`
    INSERT INTO chat_sessions (id, org_id, thread_id, created_by)
    SELECT $1, $2, thread_id, $3
    FROM conversations WHERE thread_id = (
      SELECT thread_id FROM conversations WHERE id IN (
        SELECT message_id FROM ... -- get thread from session context
      )
    )
    ON CONFLICT (org_id, thread_id) DO NOTHING
  `, [sessionId, orgId, userId]);

  // Activate the document
  await db.query(`
    INSERT INTO session_activated_docs
      (session_id, org_id, doc_id, file_version_id, activated_by, activation_reason)
    VALUES ($1, $2, $3, $4, $5, 'chat_upload')
    ON CONFLICT (session_id, doc_id) DO UPDATE SET
      file_version_id = EXCLUDED.file_version_id,
      activated_at = NOW()
  `, [sessionId, orgId, docId, fileVersionId, userId]);
}
```

---

## Implementation Order

### Phase 1: Schema Migration (Day 1-2)

```sql
-- Migration: 20241214_cdi_retrieval_schema.sql

-- 1. Create chat_sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (...);

-- 2. Create session_activated_docs table
CREATE TABLE IF NOT EXISTS session_activated_docs (...);

-- 3. Create doc_insights table
CREATE TABLE IF NOT EXISTS doc_insights (...);

-- 4. Create retrieval_traces table
CREATE TABLE IF NOT EXISTS retrieval_traces (...);

-- 5. Extend document_chunks with version link
ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS file_version_id UUID REFERENCES file_versions(id);
```

### Phase 2: RetrievalService Core (Day 3-4)

- [ ] `RetrievalService.query()` main function
- [ ] HOT tier: FTS on session-activated docs
- [ ] WARM tier: doc prefilter + vector search
- [ ] RRF fusion implementation
- [ ] Trace logging to `retrieval_traces`

### Phase 3: Integration (Day 5)

- [ ] Wire RetrievalService into chat streaming endpoint
- [ ] Return citations in response
- [ ] Auto-activate docs on chat file upload

### Phase 4: Polish (Week 2)

- [ ] Insight service (pg-boss jobs for summary/entities)
- [ ] Progressive insight compilation
- [ ] COLD tier implementation
- [ ] Privilege enforcement edge case testing

---

## Success Metrics

Track from day one:

| Metric | Target | Why |
|--------|--------|-----|
| Pinpoint Cite Accuracy | >95% | Legal-grade requirement |
| Cross-Matter Leakage | 0% | Privilege enforcement |
| P95 HOT Latency | <50ms | User experience |
| P95 WARM Latency | <200ms | Acceptable for complex queries |
| % Answers from HOT | >60% | Proves session activation value |
| Cost per Answer | Track | Optimization baseline |

---

## Future Enhancements (Not Now)

- [ ] Roaring bitmaps for privilege (when join-based slows down)
- [ ] HNSW index upgrade (when IVFFLAT recall insufficient)
- [ ] LLM reranking (when precision needs boost)
- [ ] Query embedding caching (when same queries repeat)
- [ ] Clause-first retrieval (after clause extraction pipeline)
- [ ] Entity graph traversal (after entity extraction pipeline)

---

## File Locations

```
src/
├── shared/
│   └── retrieval/
│       ├── retrieval.service.js      # Core RetrievalService
│       ├── retrieval.types.js        # JSDoc type definitions
│       ├── rrf.utils.js              # RRF fusion logic
│       └── trace.utils.js            # Trace formatting
├── services/
│   └── processor/
│       └── routes/
│           └── retrieval.routes.js   # Debug/test endpoints (optional)
migrations/
└── 20241214_cdi_retrieval_schema.sql # Schema migration
```

---

## Appendix: Existing Schema Summary

### Tables We Reuse (No Changes)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `documents` | Document metadata | id, organization_id, client_matter, privilege_status |
| `document_chunks` | Chunks + embeddings | id, document_id, chunk_text, embedding, search_vector |
| `matter_access_permissions` | Matter ACL | user_id, matter_id, permissions, is_active |
| `file_permissions` | Document ACL | file_id, user_id, permission |
| `file_versions` | Version tracking | id, file_id, version_number, is_current |
| `conversations` | Message storage | id, thread_id, matter_id, content, role |
| `client_matters` | Matter definitions | id, matter_id, organization_id |

### Tables We Create (New)

| Table | Purpose |
|-------|---------|
| `chat_sessions` | CDI session state + budgets |
| `session_activated_docs` | HOT tier membership |
| `doc_insights` | Progressive insight cache |
| `retrieval_traces` | Audit trail |

### Columns We Add (Extend)

| Table | Column | Purpose |
|-------|--------|---------|
| `document_chunks` | `file_version_id` | Link chunk to file version |

---

*This document is the source of truth for CDI Retrieval Architecture. All implementation decisions should reference this.*

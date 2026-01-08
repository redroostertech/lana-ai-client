# Async Document Summarization - Job Queue Architecture

**Date:** 2025-12-16
**Status:** Design Phase
**Priority:** High
**Estimated Effort:** 2-3 weeks

---

## Overview

### Problem Statement

The current map-reduce summarization system processes documents **synchronously**:
- Users wait 30-120 seconds for large document summaries
- Documents >2,000 chunks cause system instability
- No support for 10,000+ page documents
- Multiple concurrent large document requests can crash the system

**Real-World Scenario:**
- 10 users uploading 10 documents/day × 1,000 pages each
- 100 large summarization jobs/day
- 8+ hours of processing time needed
- Current system: crashes or times out
- **Solution needed:** Async job queue with background processing

### Goals

1. **User Experience:** Instant response for any document size
2. **System Stability:** Never crash regardless of load
3. **Scalability:** Support unlimited concurrent users
4. **Predictability:** Guaranteed processing (eventual consistency)
5. **Transparency:** Real-time progress updates and notifications

### Key Metrics

| Metric | Current | Target (Async Queue) |
|--------|---------|---------------------|
| **Response Time (UI)** | 30-120s | <1s (instant job ID) |
| **Max Document Size** | 2,000 chunks | 50,000 chunks |
| **Concurrent Users** | 5-10 | Unlimited |
| **System Stability** | Crashes under load | 100% stable |
| **User Perception** | "Waiting..." | "Processing in background" |

---

## Architecture Design

### Size-Based Processing Strategy

Documents are routed to different processing strategies based on size:

```javascript
const PROCESSING_STRATEGY = {
  SYNCHRONOUS_MAX: 500,      // Process immediately (≤500 chunks)
  ASYNC_THRESHOLD: 2000,      // Queue if >2000 chunks
  ABSOLUTE_MAX: 50000         // Hard limit (reject if exceeded)
};
```

**Processing Flow:**

```
User Request
  ↓
Check Document Size
  ↓
  ├─ ≤500 chunks → IMMEDIATE (synchronous, current behavior)
  │   └─ Return results via SSE in 5-20 seconds
  │
  ├─ 501-2,000 chunks → DEFERRED (user choice - optional)
  │   ├─ Process now → Synchronous with progress bar
  │   └─ Process later → Queue job, return immediately
  │
  ├─ 2,001-50,000 chunks → QUEUED (forced async)
  │   └─ Queue job, return job ID, poll for status
  │
  └─ >50,000 chunks → REJECTED
      └─ Error: "Document too large, please split"
```

### System Components

#### 1. **Job Queue (pg-boss)**

Uses existing pg-boss installation (already used for document ingestion).

**Queue Configuration:**
```javascript
await boss.work(
  'summarize-large-document',
  {
    teamSize: 2,           // Max 2 concurrent workers
    teamConcurrency: 1,    // 1 job per worker at a time
    batchSize: 1           // Process jobs one at a time
  },
  async (job) => processSummarization(job)
);
```

**Benefits:**
- Guaranteed processing (jobs persisted in PostgreSQL)
- Automatic retries on failure
- Priority queue support
- Job expiration handling

#### 2. **Summarization Worker**

New background worker service that processes queued jobs.

**Location:** `src/services/processor/workers/summarization.worker.js`

**Responsibilities:**
- Pull jobs from pg-boss queue
- Execute map-reduce summarization
- Track progress in database
- Store results
- Notify users on completion/failure

**Worker Lifecycle:**
```
Worker Start
  ↓
Register with pg-boss
  ↓
Wait for Job
  ↓
Job Received
  ↓
Update status: "processing"
  ↓
Execute Map-Reduce
  ├─ Update progress every batch
  └─ Stream progress to database
  ↓
Store Results
  ↓
Update status: "completed"
  ↓
Notify User
  ↓
Wait for Next Job
```

#### 3. **Database Schema**

##### **summarization_jobs table**

Tracks job lifecycle and metadata.

```sql
CREATE TABLE summarization_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  user_id UUID NOT NULL REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  matter_id UUID REFERENCES matters(id),
  session_id UUID REFERENCES chat_sessions(id),

  -- Job Details
  document_ids UUID[] NOT NULL,  -- Which documents to summarize
  query_text TEXT NOT NULL,       -- User's original question

  -- Status Tracking
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
    -- 'queued', 'processing', 'completed', 'failed', 'cancelled'

  priority INT DEFAULT 5,         -- 1 (highest) to 10 (lowest)

  -- Estimates
  estimated_chunks INT,           -- Size estimate
  estimated_duration_seconds INT, -- Time estimate

  -- Integration
  pg_boss_job_id TEXT,            -- Link to pg-boss job

  -- Progress & Errors
  metadata JSONB DEFAULT '{}',    -- { progress: 45, currentBatch: 9, totalBatches: 20, error: null }

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_summarization_jobs_user ON summarization_jobs (user_id, created_at DESC);
CREATE INDEX idx_summarization_jobs_status ON summarization_jobs (status, created_at);
CREATE INDEX idx_summarization_jobs_matter ON summarization_jobs (matter_id, created_at DESC);
```

##### **summarization_results table**

Stores completed summaries (separate from jobs to avoid bloat).

```sql
CREATE TABLE summarization_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES summarization_jobs(id) ON DELETE CASCADE,

  -- Results
  summary_text TEXT NOT NULL,
  chunks_processed INT NOT NULL,
  retrieval_method VARCHAR(50),

  -- Metadata
  citations JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_summarization_results_job ON summarization_results (job_id);
```

#### 4. **API Endpoints**

##### **POST /api/v1/streaming/chat** (Modified)

Existing streaming endpoint modified to support async jobs.

**Synchronous Response (small documents):**
```json
// SSE events (current behavior)
event: chunk
data: {"content": "Here is the summary..."}

event: complete
data: {"done": true}
```

**Async Response (large documents):**
```json
// Single SSE event then close connection
event: job_queued
data: {
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "estimatedChunks": 4000,
  "estimatedDuration": 240,
  "message": "Document too large for immediate processing. Your summary is queued.",
  "pollUrl": "/api/v1/streaming/jobs/550e8400-e29b-41d4-a716-446655440000/status"
}
```

##### **GET /api/v1/streaming/jobs/:jobId/status** (New)

Poll job status and retrieve results when complete.

**Request:**
```
GET /api/v1/streaming/jobs/550e8400-e29b-41d4-a716-446655440000/status
```

**Response (in progress):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "progress": 45,
  "currentBatch": 9,
  "totalBatches": 20,
  "estimatedDuration": 240,
  "createdAt": "2025-12-16T12:00:00Z",
  "startedAt": "2025-12-16T12:00:05Z",
  "completedAt": null,
  "result": null,
  "error": null
}
```

**Response (completed):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "progress": 100,
  "completedAt": "2025-12-16T12:04:00Z",
  "result": {
    "summary": "This document discusses...",
    "citations": [
      {
        "doc_id": "...",
        "filename": "contract.pdf",
        "page": 1
      }
    ]
  }
}
```

##### **GET /api/v1/streaming/jobs** (New - Optional)

List user's recent jobs.

**Request:**
```
GET /api/v1/streaming/jobs?status=processing&limit=10
```

**Response:**
```json
{
  "jobs": [
    {
      "jobId": "...",
      "status": "processing",
      "documentIds": ["..."],
      "matterId": "MATT-00001",
      "createdAt": "2025-12-16T12:00:00Z",
      "progress": 45
    }
  ],
  "total": 1
}
```

##### **DELETE /api/v1/streaming/jobs/:jobId** (New - Optional)

Cancel a queued or running job.

---

## Implementation Details

### Worker Implementation

**File:** `src/services/processor/workers/summarization.worker.js`

```javascript
const PgBoss = require('pg-boss');
const { dbQuery } = require('../database/db');
const { summarizeLargeDocument } = require('../routes/streaming.routes');

class SummarizationWorker {
  constructor(connectionString) {
    this.boss = new PgBoss(connectionString);
    this.isRunning = false;
  }

  async start() {
    await this.boss.start();
    this.isRunning = true;

    // Register worker
    await this.boss.work(
      'summarize-large-document',
      {
        teamSize: 2,           // Max 2 concurrent workers
        teamConcurrency: 1,    // 1 job per worker
        batchSize: 1
      },
      async (job) => this.processSummarization(job)
    );

    console.log('[SummarizationWorker] Started with teamSize=2');
  }

  async processSummarization(job) {
    const startTime = Date.now();
    const {
      jobId,
      documentIds,
      message,
      sessionId,
      userId,
      orgId,
      matterId
    } = job.data;

    console.log(`[SummarizationWorker] Processing job ${jobId}`);

    try {
      // Update status: queued → processing
      await this.updateJobStatus(jobId, 'processing', {
        startedAt: new Date(),
        progress: 0
      });

      // Execute map-reduce with progress callbacks
      const result = await summarizeLargeDocument({
        documentIds,
        message,
        sessionId,
        userId,
        orgId,
        matterId,
        onProgress: async (progressData) => {
          // Update progress in database
          const percentage = Math.round(
            (progressData.batchNumber / progressData.totalBatches) * 100
          );

          await this.updateJobStatus(jobId, 'processing', {
            progress: percentage,
            currentBatch: progressData.batchNumber,
            totalBatches: progressData.totalBatches
          });
        }
      });

      // Store result
      await this.storeSummaryResult(jobId, result);

      // Update status: processing → completed
      const duration = Math.round((Date.now() - startTime) / 1000);
      await this.updateJobStatus(jobId, 'completed', {
        completedAt: new Date(),
        duration,
        chunksProcessed: result.chunks?.length || 0
      });

      console.log(`[SummarizationWorker] Completed job ${jobId} in ${duration}s`);

      // Notify user (future enhancement)
      await this.notifyUser(userId, {
        type: 'summary_ready',
        jobId,
        matterId
      });

      return { success: true, jobId };

    } catch (error) {
      console.error(`[SummarizationWorker] Job ${jobId} failed:`, error);

      await this.updateJobStatus(jobId, 'failed', {
        error: error.message,
        failedAt: new Date()
      });

      // Notify user of failure
      await this.notifyUser(userId, {
        type: 'summary_failed',
        jobId,
        error: error.message
      });

      throw error; // pg-boss will retry based on retryLimit
    }
  }

  async updateJobStatus(jobId, status, metadata) {
    await dbQuery(`
      UPDATE summarization_jobs
      SET
        status = $1,
        metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
        updated_at = NOW()
      WHERE id = $3
    `, [status, JSON.stringify(metadata), jobId]);
  }

  async storeSummaryResult(jobId, result) {
    await dbQuery(`
      INSERT INTO summarization_results (
        job_id,
        summary_text,
        chunks_processed,
        retrieval_method,
        citations,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      jobId,
      result.consolidatedSummary || result.summary || '',
      result.chunks?.length || 0,
      result.retrievalMethod || 'map_reduce',
      JSON.stringify(result.citations || []),
      JSON.stringify({
        batchCount: result.batchCount,
        processingTime: result.processingTime
      })
    ]);
  }

  async notifyUser(userId, notification) {
    // Future: WebSocket, email, or in-app notification
    console.log(`[SummarizationWorker] Notify user ${userId}:`, notification);
  }

  async stop() {
    if (this.isRunning) {
      await this.boss.stop();
      this.isRunning = false;
      console.log('[SummarizationWorker] Stopped');
    }
  }
}

module.exports = SummarizationWorker;
```

### Streaming Route Modifications

**File:** `src/services/processor/routes/streaming.routes.js`

```javascript
// Add at top
const PROCESSING_STRATEGY = {
  SYNCHRONOUS_MAX: 500,
  ASYNC_THRESHOLD: 2000,
  ABSOLUTE_MAX: 50000
};

function determineProcessingStrategy(totalChunks) {
  if (totalChunks <= PROCESSING_STRATEGY.SYNCHRONOUS_MAX) {
    return 'immediate';
  } else if (totalChunks <= PROCESSING_STRATEGY.ASYNC_THRESHOLD) {
    return 'deferred';  // Optional: offer user choice
  } else if (totalChunks <= PROCESSING_STRATEGY.ABSOLUTE_MAX) {
    return 'queued';
  } else {
    return 'rejected';
  }
}

// Modify existing retrieveDocumentsInBackground function
async function retrieveDocumentsInBackground(req, res, documentResolution, ...) {
  // ... existing code ...

  // NEW: Check processing strategy
  const sizeInfo = await checkDocumentSize(
    documentResolution.documentIds,
    orgId,
    matterId,
    userId
  );

  const strategy = determineProcessingStrategy(sizeInfo.totalChunks);

  if (strategy === 'rejected') {
    sendSSE(res, 'error', {
      error: `Document too large (${sizeInfo.totalChunks} chunks). Maximum: ${PROCESSING_STRATEGY.ABSOLUTE_MAX} chunks.`,
      maxSupported: PROCESSING_STRATEGY.ABSOLUTE_MAX
    });
    return res.end();
  }

  if (strategy === 'queued') {
    // Queue async job
    const jobId = await queueSummarizationJob({
      userId,
      orgId,
      matterId,
      sessionId,
      documentIds: documentResolution.documentIds,
      message,
      sizeInfo
    });

    sendSSE(res, 'job_queued', {
      jobId,
      status: 'queued',
      estimatedChunks: sizeInfo.totalChunks,
      estimatedDuration: Math.ceil(sizeInfo.totalChunks / 5 * 3), // ~3s per batch, 5 concurrent
      message: 'Document is large and will be processed in the background. You will be notified when complete.',
      pollUrl: `/api/v1/streaming/jobs/${jobId}/status`
    });

    return res.end();
  }

  // strategy === 'immediate' or 'deferred'
  // Continue with existing synchronous flow
  // ... existing code ...
}

async function queueSummarizationJob(jobData) {
  const { userId, orgId, matterId, sessionId, documentIds, message, sizeInfo } = jobData;

  // 1. Create job record
  const result = await dbQuery(`
    INSERT INTO summarization_jobs (
      user_id, org_id, matter_id, session_id,
      document_ids, query_text,
      status, estimated_chunks, estimated_duration_seconds
    ) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8)
    RETURNING id
  `, [
    userId, orgId, matterId, sessionId,
    documentIds, message,
    sizeInfo.totalChunks,
    Math.ceil(sizeInfo.totalChunks / 5 * 3)
  ]);

  const jobId = result.rows[0].id;

  // 2. Queue in pg-boss
  const boss = require('../../index').getPgBoss(); // Or inject via req.app.get('pgBoss')
  const pgBossJobId = await boss.send('summarize-large-document', {
    jobId,
    documentIds,
    message,
    sessionId,
    userId,
    orgId,
    matterId
  }, {
    priority: 10,        // Lower priority for background jobs
    retryLimit: 2,       // Retry twice on failure
    retryDelay: 60,      // Wait 60s before retry
    expireInHours: 24    // Expire after 24h
  });

  // 3. Update with pg-boss job ID
  await dbQuery(`
    UPDATE summarization_jobs
    SET pg_boss_job_id = $1
    WHERE id = $2
  `, [pgBossJobId, jobId]);

  return jobId;
}

// Export for worker
module.exports = {
  // ... existing exports
  summarizeLargeDocument, // Make this available to worker
  queueSummarizationJob
};
```

### Job Status Endpoint

**File:** `src/services/processor/routes/streaming.routes.js` (add new endpoint)

```javascript
router.get('/jobs/:jobId/status', async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    const result = await dbQuery(`
      SELECT
        j.id,
        j.status,
        j.metadata,
        j.estimated_duration_seconds,
        j.created_at,
        j.started_at,
        j.completed_at,
        j.document_ids,
        j.matter_id,
        r.summary_text,
        r.citations,
        r.chunks_processed
      FROM summarization_jobs j
      LEFT JOIN summarization_results r ON r.job_id = j.id
      WHERE j.id = $1 AND j.user_id = $2
    `, [jobId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.metadata?.progress || 0,
      currentBatch: job.metadata?.currentBatch,
      totalBatches: job.metadata?.totalBatches,
      estimatedDuration: job.estimated_duration_seconds,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      matterId: job.matter_id,
      documentIds: job.document_ids,
      result: job.status === 'completed' ? {
        summary: job.summary_text,
        citations: job.citations,
        chunksProcessed: job.chunks_processed
      } : null,
      error: job.metadata?.error || null
    });

  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
});
```

### Frontend Integration

**File:** `public_html/js/chat.js`

```javascript
// Modify handleStreamingMessage to detect job_queued events
function handleStreamingMessage(event, data) {
  switch (event) {
    case 'job_queued':
      handleJobQueued(data);
      break;

    case 'chunk':
      // Existing sync handling
      appendMessageChunk(data);
      break;

    // ... other cases
  }
}

function handleJobQueued(data) {
  const { jobId, estimatedDuration, message, pollUrl } = data;

  // Show "processing in background" message
  appendSystemMessage(
    `📋 ${message}\n\nEstimated time: ${Math.round(estimatedDuration / 60)} minutes`,
    'info'
  );

  // Add "View Status" button
  const statusButton = createJobStatusButton(jobId);
  appendToChat(statusButton);

  // Start polling for job status
  startJobPolling(jobId);
}

async function startJobPolling(jobId) {
  const maxPolls = 120;      // 10 minutes max
  const pollInterval = 5000; // 5 seconds
  let pollCount = 0;

  const pollTimer = setInterval(async () => {
    try {
      const response = await fetch(`/api/v1/streaming/jobs/${jobId}/status`);
      const status = await response.json();

      // Update progress UI
      updateJobProgressUI(jobId, status);

      if (status.status === 'completed') {
        clearInterval(pollTimer);
        displayJobResult(jobId, status.result);
        showNotification('✅ Summary is ready!', 'success');
        playNotificationSound();
      } else if (status.status === 'failed') {
        clearInterval(pollTimer);
        displayJobError(jobId, status.error);
        showNotification('❌ Summary failed', 'error');
      }

      pollCount++;
      if (pollCount >= maxPolls) {
        clearInterval(pollTimer);
        displayJobTimeout(jobId);
      }

    } catch (error) {
      console.error('Job polling error:', error);
    }
  }, pollInterval);

  // Store timer so user can cancel if they navigate away
  window.activeJobPolls = window.activeJobPolls || {};
  window.activeJobPolls[jobId] = pollTimer;
}

function updateJobProgressUI(jobId, status) {
  const progressElement = document.getElementById(`job-progress-${jobId}`);
  if (!progressElement) return;

  const { progress, currentBatch, totalBatches } = status;

  progressElement.innerHTML = `
    <div class="job-progress-card">
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="progress-text">
        ${progress}% - Processing batch ${currentBatch} of ${totalBatches}
      </div>
    </div>
  `;
}

function displayJobResult(jobId, result) {
  const { summary, citations } = result;

  // Replace progress UI with actual summary
  const progressElement = document.getElementById(`job-progress-${jobId}`);
  if (progressElement) {
    progressElement.remove();
  }

  // Display summary as a normal assistant message
  appendAssistantMessage(summary, citations);
}
```

---

## Performance Analysis

### Throughput Calculations

**Scenario:** 100 documents/day × 1,000 pages each (4,000 chunks per document)

**Current System (Synchronous):**
- First document: 240 seconds (4 minutes)
- Second document: System crash or 240s wait
- **Result:** Can't handle 100 documents/day

**With Async Queue + Current Hardware:**
- 4,000 chunks ÷ 50 chunks/batch = 80 batches
- 80 batches ÷ 5 concurrent = 16 rounds
- 16 rounds × 3s/batch = **240 seconds (4 minutes) per document**
- 100 documents × 4 min = 400 minutes
- With 2 workers: **400 min ÷ 2 = 200 minutes (3.3 hours) to clear queue**

**With Async Queue + GPU (RTX 4090):**
- Batch processing: 3s → 0.3s (10x faster)
- Per document: 240s → 24s
- 100 documents × 24s = 2,400 seconds
- With 2 workers: **2,400s ÷ 2 = 1,200s (20 minutes) to clear queue**

**With Async Queue + GPU + Hierarchical:**
- Hierarchical reduces batches by ~90%
- 80 batches → 8-10 batches
- Per document: 24s → 2.4s
- 100 documents × 2.4s = 240 seconds
- With 2 workers: **240s ÷ 2 = 120s (2 minutes) to clear queue**

### Scaling Workers

**Worker Count vs. Queue Clear Time:**

| Workers | Time to Clear 100 Docs | Hardware Required |
|---------|------------------------|-------------------|
| 1 worker | 6.6 hours | 1 server, 1 GPU |
| 2 workers | 3.3 hours | 1 server, 1 GPU |
| 4 workers | 1.6 hours | 2 servers, 2 GPUs |
| 8 workers | 50 minutes | 4 servers, 4 GPUs |

**Recommendation:** Start with 2 workers on 1 server. Scale horizontally if queue backlogs persist.

---

## Implementation Roadmap

### Phase 1: Basic Async Queue (1 week)

**Goal:** Get async job processing working for large documents

**Tasks:**
- [ ] Create database migration for `summarization_jobs` and `summarization_results` tables
- [ ] Implement `SummarizationWorker` class
- [ ] Modify `streaming.routes.js` to support job queueing
- [ ] Add `/jobs/:jobId/status` endpoint
- [ ] Update `summarizeLargeDocument()` to accept `onProgress` callback
- [ ] Test with 2,000+ chunk document

**Deliverables:**
- Working async job system
- Users can queue large document summaries
- Status polling works

**Success Criteria:**
- 5,000 chunk document processes successfully in background
- No system crashes under load
- User can poll status and retrieve results

### Phase 2: Frontend UX (3 days)

**Goal:** Polished user experience for async jobs

**Tasks:**
- [ ] Update `chat.js` to handle `job_queued` events
- [ ] Add progress bar UI component
- [ ] Implement job status polling with auto-refresh
- [ ] Add notifications when jobs complete
- [ ] Add "View Active Jobs" button in UI
- [ ] Create job history page (optional)

**Deliverables:**
- Smooth UX for background jobs
- Real-time progress updates
- Desktop notifications

**Success Criteria:**
- Users understand their job is processing
- Clear progress indication
- Notification when complete

### Phase 3: Optimizations (1 week)

**Goal:** Improve processing speed and efficiency

**Tasks:**
- [ ] Implement hierarchical summarization
- [ ] Add PostgreSQL batch caching
- [ ] GPU acceleration setup (if hardware available)
- [ ] Add job priority queue management
- [ ] WebSocket notifications (instead of polling)

**Deliverables:**
- 10x faster processing
- Reduced redundant work via caching
- Better notification system

**Success Criteria:**
- 10,000 chunk document processes in <10 minutes
- Cache hit rate >50% for repeat queries
- Real-time notifications via WebSocket

### Phase 4: Production Hardening (3 days)

**Goal:** Production-ready monitoring and resilience

**Tasks:**
- [ ] Add Prometheus metrics (job queue length, processing time, failures)
- [ ] Implement job timeout handling
- [ ] Add dead letter queue for failed jobs
- [ ] Create admin dashboard for job monitoring
- [ ] Load testing (100 concurrent large documents)
- [ ] Documentation and runbooks

**Deliverables:**
- Production monitoring
- Ops dashboard
- Failure recovery procedures

**Success Criteria:**
- System remains stable under 100 concurrent large documents
- Failed jobs can be retried manually
- Ops team can monitor queue health

---

## Configuration

### Environment Variables

```bash
# Worker Configuration
SUMMARIZATION_WORKER_ENABLED=true
SUMMARIZATION_WORKER_TEAM_SIZE=2
SUMMARIZATION_WORKER_CONCURRENCY=1

# Job Limits
SUMMARIZATION_MAX_CHUNKS=50000
SUMMARIZATION_SYNC_MAX_CHUNKS=500
SUMMARIZATION_TIMEOUT_MS=3600000  # 1 hour max per job

# Queue Configuration
SUMMARIZATION_JOB_RETRY_LIMIT=2
SUMMARIZATION_JOB_RETRY_DELAY=60
SUMMARIZATION_JOB_EXPIRE_HOURS=24
```

### Database Configuration

**Indexes for Performance:**
```sql
-- Job lookups by user
CREATE INDEX idx_summarization_jobs_user ON summarization_jobs (user_id, created_at DESC);

-- Active job monitoring
CREATE INDEX idx_summarization_jobs_status ON summarization_jobs (status, created_at);

-- Matter-specific job history
CREATE INDEX idx_summarization_jobs_matter ON summarization_jobs (matter_id, created_at DESC);

-- Result retrieval
CREATE INDEX idx_summarization_results_job ON summarization_results (job_id);
```

---

## Testing Strategy

### Unit Tests

- [ ] `SummarizationWorker.processSummarization()` - successful job
- [ ] `SummarizationWorker.processSummarization()` - failed job with retry
- [ ] `queueSummarizationJob()` - job creation and queueing
- [ ] `determineProcessingStrategy()` - size-based routing logic

### Integration Tests

- [ ] Queue job → worker processes → status updates correctly
- [ ] Multiple concurrent jobs don't interfere
- [ ] Failed jobs retry correctly
- [ ] Job results persist and can be retrieved

### Load Tests

- [ ] 10 concurrent large document jobs (4,000 chunks each)
- [ ] 100 jobs queued simultaneously
- [ ] Worker crash recovery (jobs resume correctly)
- [ ] Database connection pool under heavy load

### User Acceptance Tests

- [ ] User queues large document, receives job ID
- [ ] User polls status, sees progress updates
- [ ] User receives notification when complete
- [ ] User can retrieve summary from completed job
- [ ] User sees clear error message on failure

---

## Monitoring & Observability

### Key Metrics

**Job Queue Health:**
- `summarization_jobs_queued` - Number of jobs in queue
- `summarization_jobs_processing` - Number actively processing
- `summarization_jobs_completed_per_hour` - Throughput
- `summarization_jobs_failed_per_hour` - Error rate
- `summarization_job_duration_seconds` - Processing time histogram

**Worker Health:**
- `summarization_worker_active_count` - Number of active workers
- `summarization_worker_busy_count` - Workers currently processing
- `summarization_worker_idle_time_seconds` - Time workers spend idle

**System Resources:**
- `summarization_memory_usage_bytes` - Worker memory consumption
- `summarization_cpu_usage_percent` - Worker CPU utilization
- `summarization_llm_calls_per_minute` - Ollama request rate

### Alerts

**Critical:**
- Job queue length >50 (queue backlog building)
- All workers crashed (no jobs processing)
- Job failure rate >10% (systematic issue)

**Warning:**
- Job queue length >20 (consider scaling)
- Average job duration >2x estimate (performance degradation)
- Worker memory usage >80% (potential OOM)

---

## Future Enhancements

### Short-term (Next 3 Months)

1. **WebSocket Notifications**
   - Replace polling with real-time push updates
   - Reduces server load
   - Better UX

2. **Job Priority System**
   - Premium users get higher priority
   - Small jobs prioritized over large jobs
   - Manual priority override for urgent requests

3. **Smart Job Batching**
   - Group similar documents in same job
   - "Summarize all contracts in this matter"
   - Reduces overhead

### Long-term (6+ Months)

1. **Distributed Workers**
   - Workers on multiple servers
   - Auto-scaling based on queue depth
   - Cloud integration (AWS Lambda, Kubernetes)

2. **Incremental Summarization**
   - Store intermediate results
   - Resume interrupted jobs
   - Progressive summary refinement

3. **Multi-Document Intelligence**
   - Cross-document insights
   - "Compare these 10 contracts"
   - Detect patterns across document set

---

## Cost-Benefit Analysis

### Development Cost

| Phase | Time | Cost (@ $150/hr) |
|-------|------|-----------------|
| Phase 1: Basic Async | 1 week | $6,000 |
| Phase 2: Frontend UX | 3 days | $3,600 |
| Phase 3: Optimizations | 1 week | $6,000 |
| Phase 4: Production | 3 days | $3,600 |
| **Total** | **~3 weeks** | **$19,200** |

### Operational Cost

**Without GPU:**
- Hardware: $0 (use existing server)
- Processing: Slow but free (CPU-based Ollama)
- Limitation: 3-6 hours to clear 100-doc queue

**With GPU (RTX 4090):**
- Hardware: $1,800 one-time
- Processing: 10x faster
- Result: 20-40 minutes to clear 100-doc queue

### Business Value

**Quantified Benefits:**
- **User Experience:** Instant response vs. 2-minute wait = ⭐⭐⭐⭐⭐
- **System Stability:** Zero crashes vs. frequent crashes = Priceless
- **Scalability:** Unlimited users vs. 5-10 users = 10-20x capacity
- **Document Size:** 50,000 chunks vs. 2,000 chunks = 25x larger documents

**ROI:**
- Development: $19,200
- Hardware: $1,800
- **Total: $21,000**
- Result: System that scales to thousands of users and handles enterprise documents
- **Payback:** If system supports 100 paying users @ $50/mo = $5,000/mo → **4-month payback**

---

## Risks & Mitigations

### Risk 1: Worker Crashes

**Risk:** Worker process crashes, jobs stuck in "processing" state

**Mitigation:**
- Implement worker health checks
- pg-boss automatically retries failed jobs
- Add dead letter queue for persistent failures
- Monitor worker uptime, auto-restart on crash

### Risk 2: Queue Backlog

**Risk:** Jobs accumulate faster than workers can process

**Mitigation:**
- Monitor queue length with alerts
- Horizontal scaling (add more workers)
- Smart job prioritization
- User notifications of estimated wait time

### Risk 3: Database Bloat

**Risk:** `summarization_jobs` table grows unbounded

**Mitigation:**
- Archive completed jobs >30 days old
- Delete failed jobs >7 days old
- Implement retention policy
- Separate results table keeps jobs table small

### Risk 4: User Confusion

**Risk:** Users don't understand async processing

**Mitigation:**
- Clear UI messaging ("Processing in background...")
- Estimated time display
- Progress updates every 5 seconds
- Notification when complete
- Help documentation

---

## Conclusion

**Async job queue architecture solves critical scalability bottlenecks:**
- ✅ Supports unlimited concurrent users
- ✅ Handles 50,000+ chunk documents
- ✅ Guarantees system stability
- ✅ Provides great user experience

**Next Steps:**
1. Review and approve architecture
2. Create database migration
3. Implement Phase 1 (1 week)
4. Test with production-sized documents
5. Deploy to staging
6. Monitor and iterate

**Total Implementation Time:** 2-3 weeks
**Total Cost:** $21,000 (dev + hardware)
**Expected ROI:** 4 months

---

**Status:** Ready for implementation
**Dependencies:** None (pg-boss already installed)
**Blockers:** None

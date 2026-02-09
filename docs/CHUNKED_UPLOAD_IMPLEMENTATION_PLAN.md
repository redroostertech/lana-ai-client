# Chunked Upload Implementation Plan
**Date:** 2025-12-23
**Purpose:** Add support for large file uploads (5-10 GB) with progress tracking, resume capability, and reusable infrastructure

---

## Table of Contents
1. [Overview](#overview)
2. [Reusable Infrastructure](#reusable-infrastructure)
3. [Backend Implementation](#backend-implementation)
4. [Frontend Implementation](#frontend-implementation)
5. [ActionStep Integration](#actionstep-integration)
6. [Testing Strategy](#testing-strategy)
7. [Deployment Checklist](#deployment-checklist)

---

## Overview

### Goals
- ✅ Support uploads up to 10 GB (configurable)
- ✅ Chunked upload with resume capability
- ✅ Real-time progress tracking
- ✅ Reusable across all file upload scenarios
- ✅ Minimal changes to existing code
- ✅ Error handling and cleanup

### Architecture
```
Frontend                Backend                     Storage
┌────────────┐         ┌─────────────────┐        ┌─────────┐
│ File Split │────────>│ Chunk Receiver  │───────>│  Temp   │
│ (Chunks)   │  HTTP   │ (storage-v2)    │  Write │  Disk   │
└────────────┘         └─────────────────┘        └─────────┘
      │                         │                        │
      │                         ▼                        │
      │                ┌─────────────────┐              │
      │                │ Upload Manager  │              │
      │                │ - Track progress│              │
      │                │ - Store metadata│              │
      │                └─────────────────┘              │
      │                         │                        │
      ▼                         ▼                        ▼
┌────────────┐         ┌─────────────────┐        ┌─────────┐
│  Progress  │<────SSE─│   Complete      │───────>│ Final   │
│   Bar      │         │   - Assemble    │  Move  │ Location│
└────────────┘         │   - Extract ZIP │        └─────────┘
                       │   - Process     │
                       └─────────────────┘
```

---

## Reusable Infrastructure

### 1. Upload Tracking Service
**File:** `LANA-AI/src/services/processor/services/upload-manager.service.js`

**Purpose:** Track multi-chunk uploads across any use case

**Features:**
- Store upload metadata (uploadId, filename, totalChunks, receivedChunks)
- Track chunk completion
- Provide progress calculation
- Cleanup on completion/failure

**Database Table:**
```sql
CREATE TABLE upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  content_type TEXT,
  total_chunks INTEGER NOT NULL,
  received_chunks INTEGER DEFAULT 0,
  chunk_size INTEGER NOT NULL,
  temp_directory TEXT NOT NULL,
  final_destination TEXT,
  metadata JSONB,
  status TEXT DEFAULT 'pending', -- pending, uploading, assembling, completed, failed, cancelled
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX idx_upload_sessions_org_user ON upload_sessions(organization_id, user_id);
CREATE INDEX idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX idx_upload_sessions_expires ON upload_sessions(expires_at);
```

**Service Methods:**
```javascript
class UploadManagerService {
  // Initialize upload session
  async initializeUpload({ organizationId, userId, filename, fileSize, totalChunks, chunkSize, metadata })

  // Record chunk receipt
  async recordChunk({ uploadId, chunkIndex })

  // Get upload status
  async getStatus(uploadId, organizationId)

  // Mark as complete
  async markComplete(uploadId, finalDestination)

  // Mark as failed
  async markFailed(uploadId, errorMessage)

  // Cancel upload
  async cancelUpload(uploadId, organizationId)

  // Cleanup expired uploads (background worker)
  async cleanupExpired()

  // Get upload progress (0-100%)
  async getProgress(uploadId)
}
```

---

### 2. Chunk Upload Routes
**File:** `LANA-AI/src/services/processor/routes/storage-v2.routes.js`

**Add to existing file (not a new file):**

```javascript
// ============================================================================
// CHUNKED UPLOAD ENDPOINTS
// ============================================================================

const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const UploadManagerService = require('../services/upload-manager.service');
const uploadManager = new UploadManagerService();

// Configure multer for chunked uploads (disk storage, not memory)
const chunkStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.env.UPLOAD_TEMP_DIR || '/tmp/uploads', req.body.upload_id);
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const chunkIndex = req.body.chunk_index;
    cb(null, `chunk_${chunkIndex.toString().padStart(6, '0')}`);
  }
});

const uploadChunk = multer({
  storage: chunkStorage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB per chunk
  }
});

/**
 * POST /api/v1/storage/upload/start
 * Initialize a chunked upload session
 */
router.post('/upload/start',
  authenticate,
  requirePermission('documents:upload'),
  validateRequest({
    body: z.object({
      filename: z.string().min(1),
      file_size: z.number().int().positive(),
      content_type: z.string().optional(),
      chunk_size: z.number().int().positive().default(50 * 1024 * 1024), // 50MB default
      metadata: z.record(z.string(), z.any()).optional()
    })
  }),
  async (req, res, next) => {
    try {
      const { filename, file_size, content_type, chunk_size, metadata } = req.body;

      // Calculate total chunks needed
      const totalChunks = Math.ceil(file_size / chunk_size);

      // Validate file size limits (configurable per tier)
      const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
      if (file_size > MAX_FILE_SIZE) {
        return res.status(400).json({
          detail: `File size ${file_size} exceeds maximum allowed ${MAX_FILE_SIZE}`
        });
      }

      // Initialize upload session
      const session = await uploadManager.initializeUpload({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        filename,
        fileSize: file_size,
        contentType: content_type,
        totalChunks,
        chunkSize: chunk_size,
        metadata: metadata || {}
      });

      logInfo('storage_api.chunked_upload_started', {
        upload_id: session.id,
        filename,
        file_size,
        total_chunks: totalChunks,
        user_id: req.user.id
      });

      res.status(201).json({
        upload_id: session.id,
        filename: session.filename,
        file_size: session.file_size,
        total_chunks: session.total_chunks,
        chunk_size: session.chunk_size,
        status: session.status,
        created_at: session.created_at
      });
    } catch (error) {
      logError('storage_api.chunked_upload_start_failed', { error: error.message });
      next(error);
    }
  }
);

/**
 * POST /api/v1/storage/upload/chunk
 * Upload a single chunk
 */
router.post('/upload/chunk',
  authenticate,
  requirePermission('documents:upload'),
  uploadChunk.single('chunk'),
  async (req, res, next) => {
    try {
      const { upload_id, chunk_index } = req.body;

      if (!req.file) {
        return res.status(400).json({ detail: 'Chunk file is required' });
      }

      if (!upload_id || chunk_index === undefined) {
        return res.status(400).json({ detail: 'upload_id and chunk_index are required' });
      }

      // Verify upload session exists and belongs to user
      const session = await uploadManager.getStatus(upload_id, req.user.organizationId);

      if (!session) {
        // Clean up uploaded chunk
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(404).json({ detail: 'Upload session not found' });
      }

      if (session.status === 'completed') {
        return res.status(400).json({ detail: 'Upload already completed' });
      }

      if (session.status === 'failed' || session.status === 'cancelled') {
        // Clean up uploaded chunk
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ detail: `Upload is ${session.status}` });
      }

      // Record chunk receipt
      await uploadManager.recordChunk({
        uploadId: upload_id,
        chunkIndex: parseInt(chunk_index, 10)
      });

      // Get updated progress
      const progress = await uploadManager.getProgress(upload_id);

      logInfo('storage_api.chunk_received', {
        upload_id,
        chunk_index,
        progress,
        user_id: req.user.id
      });

      res.json({
        upload_id,
        chunk_index: parseInt(chunk_index, 10),
        received: true,
        progress,
        status: session.status
      });
    } catch (error) {
      logError('storage_api.chunk_upload_failed', { error: error.message });
      next(error);
    }
  }
);

/**
 * POST /api/v1/storage/upload/complete
 * Finalize upload - assemble chunks
 */
router.post('/upload/complete',
  authenticate,
  requirePermission('documents:upload'),
  validateRequest({
    body: z.object({
      upload_id: z.string().uuid(),
      final_destination: z.string().optional(), // Optional: where to move final file
      extract_zip: z.boolean().optional().default(false), // Extract if ZIP
      process_contents: z.boolean().optional().default(false) // Queue processing jobs
    })
  }),
  async (req, res, next) => {
    try {
      const { upload_id, final_destination, extract_zip, process_contents } = req.body;

      // Get upload session
      const session = await uploadManager.getStatus(upload_id, req.user.organizationId);

      if (!session) {
        return res.status(404).json({ detail: 'Upload session not found' });
      }

      if (session.received_chunks !== session.total_chunks) {
        return res.status(400).json({
          detail: 'Not all chunks received',
          received: session.received_chunks,
          total: session.total_chunks
        });
      }

      if (session.status === 'completed') {
        return res.json({
          upload_id,
          status: 'completed',
          message: 'Upload already completed',
          final_path: session.final_destination
        });
      }

      // Update status to assembling
      await uploadManager.updateStatus(upload_id, 'assembling');

      // Assemble chunks
      const tempDir = session.temp_directory;
      const assembledPath = path.join(tempDir, session.filename);
      const writeStream = require('fs').createWriteStream(assembledPath);

      for (let i = 0; i < session.total_chunks; i++) {
        const chunkPath = path.join(tempDir, `chunk_${i.toString().padStart(6, '0')}`);
        const chunkBuffer = await fs.readFile(chunkPath);
        writeStream.write(chunkBuffer);
      }

      await new Promise((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });

      logInfo('storage_api.chunks_assembled', {
        upload_id,
        filename: session.filename,
        user_id: req.user.id
      });

      // Extract ZIP if requested
      let extractedPath = assembledPath;
      if (extract_zip && session.filename.toLowerCase().endsWith('.zip')) {
        const extractDir = final_destination || path.join(tempDir, 'extracted');
        await fs.mkdir(extractDir, { recursive: true });

        const zip = new AdmZip(assembledPath);
        zip.extractAllTo(extractDir, true);

        extractedPath = extractDir;

        logInfo('storage_api.zip_extracted', {
          upload_id,
          extract_dir: extractDir,
          user_id: req.user.id
        });
      }

      // Move to final destination if specified
      if (final_destination && !extract_zip) {
        await fs.mkdir(path.dirname(final_destination), { recursive: true });
        await fs.rename(assembledPath, final_destination);
        extractedPath = final_destination;
      }

      // Mark as complete
      await uploadManager.markComplete(upload_id, extractedPath);

      // Clean up temp chunks
      for (let i = 0; i < session.total_chunks; i++) {
        const chunkPath = path.join(tempDir, `chunk_${i.toString().padStart(6, '0')}`);
        await fs.unlink(chunkPath).catch(() => {});
      }

      logInfo('storage_api.chunked_upload_completed', {
        upload_id,
        filename: session.filename,
        final_path: extractedPath,
        user_id: req.user.id
      });

      res.json({
        upload_id,
        status: 'completed',
        filename: session.filename,
        file_size: session.file_size,
        final_path: extractedPath,
        extracted: extract_zip,
        completed_at: new Date().toISOString()
      });
    } catch (error) {
      // Mark as failed
      await uploadManager.markFailed(upload_id, error.message).catch(() => {});

      logError('storage_api.chunked_upload_complete_failed', { error: error.message });
      next(error);
    }
  }
);

/**
 * GET /api/v1/storage/upload/status/:upload_id
 * Get upload status and progress
 */
router.get('/upload/status/:upload_id',
  authenticate,
  requirePermission('documents:read'),
  async (req, res, next) => {
    try {
      const { upload_id } = req.params;

      const session = await uploadManager.getStatus(upload_id, req.user.organizationId);

      if (!session) {
        return res.status(404).json({ detail: 'Upload session not found' });
      }

      const progress = await uploadManager.getProgress(upload_id);

      res.json({
        upload_id: session.id,
        filename: session.filename,
        file_size: session.file_size,
        total_chunks: session.total_chunks,
        received_chunks: session.received_chunks,
        progress,
        status: session.status,
        error_message: session.error_message,
        created_at: session.created_at,
        updated_at: session.updated_at,
        completed_at: session.completed_at
      });
    } catch (error) {
      logError('storage_api.upload_status_failed', { error: error.message });
      next(error);
    }
  }
);

/**
 * DELETE /api/v1/storage/upload/:upload_id
 * Cancel upload and cleanup
 */
router.delete('/upload/:upload_id',
  authenticate,
  requirePermission('documents:upload'),
  async (req, res, next) => {
    try {
      const { upload_id } = req.params;

      const session = await uploadManager.getStatus(upload_id, req.user.organizationId);

      if (!session) {
        return res.status(404).json({ detail: 'Upload session not found' });
      }

      // Cancel upload
      await uploadManager.cancelUpload(upload_id, req.user.organizationId);

      // Clean up temp files
      const tempDir = session.temp_directory;
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

      logInfo('storage_api.upload_cancelled', {
        upload_id,
        user_id: req.user.id
      });

      res.json({
        upload_id,
        status: 'cancelled',
        message: 'Upload cancelled and files cleaned up'
      });
    } catch (error) {
      logError('storage_api.upload_cancel_failed', { error: error.message });
      next(error);
    }
  }
);
```

---

## Frontend Implementation

### 1. Reusable Upload Component
**File:** `lana-client/src/js/chunked-upload.js`

**Purpose:** Handle chunked upload from any frontend page

**Features:**
- File slicing
- Parallel chunk uploads (configurable)
- Progress tracking
- Error handling and retry
- Resume capability

**API:**
```javascript
class ChunkedUploader {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 50 * 1024 * 1024; // 50MB
    this.maxParallelUploads = options.maxParallelUploads || 3;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  async upload(file, options = {}) {
    // Start upload session
    const session = await this.startUpload(file, options);

    // Split file into chunks
    const chunks = this.splitFile(file);

    // Upload chunks with retry
    await this.uploadChunks(session.upload_id, chunks);

    // Complete upload
    const result = await this.completeUpload(session.upload_id, options);

    return result;
  }

  async startUpload(file, options) {
    const response = await api.post('/api/v1/storage/upload/start', {
      filename: file.name,
      file_size: file.size,
      content_type: file.type,
      chunk_size: this.chunkSize,
      metadata: options.metadata || {}
    });

    return response;
  }

  splitFile(file) {
    const chunks = [];
    let offset = 0;
    let chunkIndex = 0;

    while (offset < file.size) {
      const end = Math.min(offset + this.chunkSize, file.size);
      chunks.push({
        index: chunkIndex,
        blob: file.slice(offset, end),
        start: offset,
        end: end
      });
      offset = end;
      chunkIndex++;
    }

    return chunks;
  }

  async uploadChunks(uploadId, chunks) {
    const queue = [...chunks];
    const inProgress = new Set();
    const completed = new Set();
    let errors = [];

    const uploadNext = async () => {
      if (queue.length === 0) return;

      const chunk = queue.shift();
      inProgress.add(chunk.index);

      try {
        await this.uploadChunk(uploadId, chunk);
        completed.add(chunk.index);
        inProgress.delete(chunk.index);

        // Update progress
        const progress = (completed.size / chunks.length) * 100;
        this.onProgress({
          uploadId,
          progress,
          uploadedChunks: completed.size,
          totalChunks: chunks.length,
          uploadedBytes: chunk.end,
          totalBytes: chunks[chunks.length - 1].end
        });

        // Upload next chunk
        if (queue.length > 0) {
          await uploadNext();
        }
      } catch (error) {
        inProgress.delete(chunk.index);
        errors.push({ chunk: chunk.index, error: error.message });

        // Retry logic (up to 3 times)
        if (chunk.retries === undefined) chunk.retries = 0;
        if (chunk.retries < 3) {
          chunk.retries++;
          queue.push(chunk);
          await uploadNext();
        } else {
          this.onError({ uploadId, chunk: chunk.index, error: error.message });
        }
      }
    };

    // Start parallel uploads
    const parallelUploads = Math.min(this.maxParallelUploads, chunks.length);
    await Promise.all(
      Array(parallelUploads).fill(null).map(() => uploadNext())
    );

    if (errors.length > 0) {
      throw new Error(`Failed to upload ${errors.length} chunks`);
    }
  }

  async uploadChunk(uploadId, chunk) {
    const formData = new FormData();
    formData.append('chunk', chunk.blob);
    formData.append('upload_id', uploadId);
    formData.append('chunk_index', chunk.index);

    await api.post('/api/v1/storage/upload/chunk', formData);
  }

  async completeUpload(uploadId, options) {
    const response = await api.post('/api/v1/storage/upload/complete', {
      upload_id: uploadId,
      final_destination: options.finalDestination,
      extract_zip: options.extractZip || false,
      process_contents: options.processContents || false
    });

    this.onComplete(response);
    return response;
  }

  async getStatus(uploadId) {
    return await api.get(`/api/v1/storage/upload/status/${uploadId}`);
  }

  async cancel(uploadId) {
    return await api.delete(`/api/v1/storage/upload/${uploadId}`);
  }
}
```

---

## ActionStep Integration

### 1. ActionStep-Specific Endpoints
**File:** `LANA-AI/src/services/processor/routes/actionstep.routes.js`

**Add new upload endpoint that uses reusable infrastructure:**

```javascript
// POST /api/v1/actionstep/upload/complete
// ActionStep-specific completion handler
router.post('/upload/complete',
  authenticate,
  validateRequest({
    body: z.object({
      upload_id: z.string().uuid()
    })
  }),
  async (req, res, next) => {
    try {
      const { upload_id } = req.body;

      // Get configured import directory for this organization
      const configResult = await postgres.query(
        `SELECT import_directory FROM actionstep.config WHERE organization_id = $1`,
        [req.user.organizationId]
      );

      if (configResult.rows.length === 0 || !configResult.rows[0].import_directory) {
        return res.status(400).json({
          error: 'ActionStep import directory not configured'
        });
      }

      const importDir = configResult.rows[0].import_directory;

      // Complete upload with extraction to import directory
      const uploadService = new StorageService();
      const result = await uploadService.completeChunkedUpload({
        uploadId: upload_id,
        organizationId: req.user.organizationId,
        finalDestination: importDir,
        extractZip: true
      });

      // Automatically trigger import after upload completes
      const service = new ActionStepCSVService(req.user.organizationId);
      const importResult = await service.runFullImport(importDir);

      logInfo('ActionStep upload and import completed', {
        uploadId: upload_id,
        importDir,
        importResult
      });

      res.json({
        upload_id,
        status: 'completed',
        extracted_to: importDir,
        import_result: importResult
      });
    } catch (error) {
      logError('ActionStep upload completion failed', error);
      next(error);
    }
  }
);
```

### 2. Frontend Updates - ActionStep Page
**File:** `lana-client/src/integrations/actionstep.html`

**Changes needed:**

1. **Tab Consolidation** - Combine Matters, Participants, Tasks, File Notes into single "Output" tab
2. **Add Upload Tab** - New tab with drag-and-drop interface
3. **Permission Checks** - Hide Configuration tab for non-admins

**New Tab Structure:**
```
- Overview
- Configuration (admin only)
- Upload (all users)
- Output (consolidated data view)
- Execution Logs
- Documentation
- Workflows
```

**Upload Tab HTML:**
```html
<!-- Upload Tab Content -->
<div id="upload-tab-content" class="hidden">
  <div class="max-w-4xl mx-auto">
    <h3 class="text-lg font-semibold text-gray-900 mb-4">Upload ActionStep Data Export</h3>

    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div class="flex gap-3">
        <svg class="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div>
          <p class="font-medium text-blue-900">Instructions</p>
          <p class="text-sm text-blue-800 mt-1">
            Export your ActionStep data as a ZIP file and upload it here. The system will automatically extract and import the data.
          </p>
        </div>
      </div>
    </div>

    <!-- Drop Zone -->
    <div id="dropZone" class="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-indigo-400 transition-colors cursor-pointer">
      <svg class="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
      </svg>
      <p class="text-lg font-medium text-gray-900 mb-2">Drop ActionStep ZIP file here</p>
      <p class="text-sm text-gray-500 mb-4">or click to browse (up to 10 GB)</p>
      <input type="file" id="fileInput" accept=".zip" class="hidden">
      <button onclick="document.getElementById('fileInput').click()" class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
        Browse Files
      </button>
    </div>

    <!-- Upload Progress -->
    <div id="uploadProgress" class="hidden mt-6">
      <div class="bg-white border border-gray-200 rounded-lg p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <p class="font-medium text-gray-900" id="uploadFilename">filename.zip</p>
            <p class="text-sm text-gray-500" id="uploadSize">0 MB / 0 MB</p>
          </div>
          <button onclick="cancelUpload()" class="text-red-600 hover:text-red-700 text-sm font-medium">
            Cancel
          </button>
        </div>

        <div class="w-full bg-gray-200 rounded-full h-3 mb-2">
          <div id="progressBar" class="bg-indigo-600 h-3 rounded-full transition-all" style="width: 0%"></div>
        </div>

        <div class="flex items-center justify-between text-sm">
          <span id="uploadStatus" class="text-gray-600">Uploading...</span>
          <span id="uploadPercentage" class="font-medium text-gray-900">0%</span>
        </div>

        <div class="mt-4 text-sm text-gray-500">
          <p id="uploadEta">Estimated time remaining: calculating...</p>
        </div>
      </div>
    </div>

    <!-- Upload Complete -->
    <div id="uploadComplete" class="hidden mt-6">
      <div class="bg-green-50 border border-green-200 rounded-lg p-6">
        <div class="flex gap-3">
          <svg class="w-6 h-6 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <div>
            <p class="font-medium text-green-900">Upload Complete</p>
            <p class="text-sm text-green-800 mt-1" id="uploadCompleteMessage">
              Your ActionStep data has been uploaded and is being processed.
            </p>
            <button onclick="switchTab('execution-logs')" class="mt-3 text-sm font-medium text-green-600 hover:text-green-700">
              View Processing Logs →
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**Upload JavaScript:**
```javascript
let currentUploader = null;
let currentUploadId = null;

// Initialize drag-and-drop
function initializeUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-500', 'bg-indigo-50');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500', 'bg-indigo-50');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });
}

async function handleFileSelected(file) {
  // Validate file
  if (!file.name.toLowerCase().endsWith('.zip')) {
    alert('Please select a ZIP file');
    return;
  }

  const maxSize = 10 * 1024 * 1024 * 1024; // 10GB
  if (file.size > maxSize) {
    alert('File size exceeds 10 GB limit');
    return;
  }

  // Show progress UI
  document.getElementById('dropZone').classList.add('hidden');
  document.getElementById('uploadProgress').classList.remove('hidden');
  document.getElementById('uploadFilename').textContent = file.name;
  document.getElementById('uploadSize').textContent = `0 MB / ${(file.size / 1024 / 1024).toFixed(2)} MB`;

  // Initialize uploader
  currentUploader = new ChunkedUploader({
    chunkSize: 50 * 1024 * 1024, // 50MB chunks
    maxParallelUploads: 3,
    onProgress: (progress) => {
      updateProgress(progress);
    },
    onComplete: (result) => {
      handleUploadComplete(result);
    },
    onError: (error) => {
      handleUploadError(error);
    }
  });

  try {
    // Start upload
    const result = await currentUploader.upload(file, {
      extractZip: true,
      metadata: {
        source: 'actionstep',
        organization_id: api.user.organizationId
      }
    });

    currentUploadId = result.upload_id;

    // Trigger ActionStep-specific completion
    await api.post('/api/v1/actionstep/upload/complete', {
      upload_id: result.upload_id
    });
  } catch (error) {
    handleUploadError(error);
  }
}

function updateProgress(progress) {
  const percentage = Math.round(progress.progress);
  document.getElementById('progressBar').style.width = `${percentage}%`;
  document.getElementById('uploadPercentage').textContent = `${percentage}%`;

  const uploadedMB = (progress.uploadedBytes / 1024 / 1024).toFixed(2);
  const totalMB = (progress.totalBytes / 1024 / 1024).toFixed(2);
  document.getElementById('uploadSize').textContent = `${uploadedMB} MB / ${totalMB} MB`;

  // Calculate ETA
  if (progress.uploadedBytes > 0) {
    const elapsed = (Date.now() - uploadStartTime) / 1000;
    const rate = progress.uploadedBytes / elapsed;
    const remaining = (progress.totalBytes - progress.uploadedBytes) / rate;

    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    document.getElementById('uploadEta').textContent = `Estimated time remaining: ${minutes}m ${seconds}s`;
  }
}

function handleUploadComplete(result) {
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('uploadComplete').classList.remove('hidden');
  document.getElementById('uploadCompleteMessage').textContent =
    `Your ActionStep data (${result.filename}) has been uploaded and is being processed.`;
}

function handleUploadError(error) {
  alert(`Upload failed: ${error.message}`);
  document.getElementById('uploadProgress').classList.add('hidden');
  document.getElementById('dropZone').classList.remove('hidden');
}

async function cancelUpload() {
  if (currentUploadId && confirm('Are you sure you want to cancel this upload?')) {
    await currentUploader.cancel(currentUploadId);
    document.getElementById('uploadProgress').classList.add('hidden');
    document.getElementById('dropZone').classList.remove('hidden');
  }
}
```

**Output Tab (Consolidated):**
```html
<div id="output-tab-content" class="hidden">
  <div class="flex gap-6">
    <!-- Left Sidebar - Data Type Selector -->
    <div class="w-64 flex-shrink-0">
      <nav class="space-y-1">
        <button onclick="loadOutputData('matters')" id="output-matters" class="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-50 text-indigo-700">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          Matters
        </button>
        <button onclick="loadOutputData('participants')" id="output-participants" class="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-100">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
          Participants
        </button>
        <button onclick="loadOutputData('tasks')" id="output-tasks" class="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-100">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
          Tasks
        </button>
        <button onclick="loadOutputData('file-notes')" id="output-file-notes" class="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-100">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
          File Notes
        </button>
        <button onclick="loadOutputData('documents')" id="output-documents" class="w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-100">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
          Documents
        </button>
      </nav>
    </div>

    <!-- Right Panel - Data Table -->
    <div class="flex-1">
      <div class="bg-white rounded-lg border border-gray-200">
        <!-- Table Controls -->
        <div class="p-4 border-b border-gray-200 flex items-center justify-between">
          <div class="flex items-center gap-4">
            <input type="text" id="outputSearch" placeholder="Search..." class="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <select id="outputFilter" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="exportData()" class="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              Export CSV
            </button>
          </div>
        </div>

        <!-- Data Table -->
        <div id="outputTable" class="overflow-x-auto">
          <!-- Table will be dynamically rendered -->
        </div>

        <!-- Pagination -->
        <div class="p-4 border-t border-gray-200 flex items-center justify-between">
          <p class="text-sm text-gray-500" id="outputPaginationInfo">Showing 1-25 of 250</p>
          <div class="flex gap-2">
            <button onclick="previousPage()" class="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Previous</button>
            <button onclick="nextPage()" class="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

---

## Testing Strategy

### Unit Tests
```javascript
// Test upload manager service
describe('UploadManagerService', () => {
  test('should initialize upload session', async () => {
    const result = await uploadManager.initializeUpload({...});
    expect(result.id).toBeDefined();
    expect(result.total_chunks).toBe(expected);
  });

  test('should track chunk progress', async () => {
    await uploadManager.recordChunk({...});
    const progress = await uploadManager.getProgress(uploadId);
    expect(progress).toBe(expectedProgress);
  });

  test('should cleanup expired uploads', async () => {
    await uploadManager.cleanupExpired();
    // Verify old uploads are deleted
  });
});
```

### Integration Tests
```javascript
// Test chunked upload flow
describe('Chunked Upload E2E', () => {
  test('should upload large file successfully', async () => {
    // Create test file
    const file = createTestFile(100 * 1024 * 1024); // 100MB

    // Start upload
    const session = await api.post('/api/v1/storage/upload/start', {...});

    // Upload chunks
    const chunks = splitFile(file, 10 * 1024 * 1024); // 10MB chunks
    for (const chunk of chunks) {
      await api.post('/api/v1/storage/upload/chunk', {...});
    }

    // Complete
    const result = await api.post('/api/v1/storage/upload/complete', {...});
    expect(result.status).toBe('completed');
  });
});
```

---

## Deployment Checklist

### Backend
- [ ] Create upload_sessions table migration
- [ ] Implement UploadManagerService
- [ ] Add chunked upload routes to storage-v2.routes.js
- [ ] Add ActionStep-specific completion endpoint
- [ ] Create cleanup worker for expired uploads
- [ ] Add environment variable: `UPLOAD_TEMP_DIR`
- [ ] Update permissions for upload directory
- [ ] Add monitoring for upload failures

### Frontend
- [ ] Create chunked-upload.js component
- [ ] Update actionstep.html with new tabs
- [ ] Implement Upload tab UI
- [ ] Consolidate Output tab with sidebar
- [ ] Add permission checks (hide Configuration for non-admins)
- [ ] Test drag-and-drop functionality
- [ ] Add error handling and user feedback

### Database
```sql
-- Migration script
CREATE TABLE upload_sessions (...);
CREATE INDEX idx_upload_sessions_org_user ON upload_sessions(organization_id, user_id);
CREATE INDEX idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX idx_upload_sessions_expires ON upload_sessions(expires_at);
```

### Monitoring
- [ ] Add metrics for upload success/failure rates
- [ ] Monitor disk usage in temp directory
- [ ] Alert on upload session buildup
- [ ] Track average upload times

### Documentation
- [ ] Update API documentation with chunked upload endpoints
- [ ] Add user guide for ActionStep data upload
- [ ] Document cleanup procedures for admins

---

## Summary

This plan provides:
1. ✅ **Reusable infrastructure** - Chunked upload works for any file, any size
2. ✅ **ActionStep integration** - Specific implementation using reusable components
3. ✅ **User-friendly UI** - Drag-and-drop with progress tracking
4. ✅ **Scalable** - Handles 10 GB files without memory issues
5. ✅ **Maintainable** - Clean separation of concerns, well-documented

**Next Steps:**
1. Review and approve plan
2. Implement backend infrastructure (UploadManagerService + routes)
3. Implement frontend component (ChunkedUploader)
4. Integrate with ActionStep
5. Test with real data
6. Deploy to production

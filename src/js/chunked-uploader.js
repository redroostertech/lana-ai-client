/**
 * Chunked File Uploader
 *
 * Handles large file uploads (5-10GB+) using chunked transfer
 * - Splits files into manageable chunks (default 50MB)
 * - Parallel uploads with configurable concurrency
 * - Automatic retry with exponential backoff
 * - Progress tracking and callbacks
 * - Pause/resume support
 * - Cancellation support
 *
 * Usage:
 *   const uploader = new ChunkedUploader({
 *     chunkSize: 50 * 1024 * 1024,  // 50MB
 *     maxParallelUploads: 3,
 *     onProgress: (progress) => console.log(progress)
 *   });
 *
 *   const result = await uploader.upload(file, {
 *     matter_id: '123',
 *     metadata: { connector_type: 'actionstep' }
 *   });
 */

class ChunkedUploader {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 50 * 1024 * 1024; // 50MB default
    this.maxParallelUploads = options.maxParallelUploads || 3;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000; // 1 second base delay
    this.onProgress = options.onProgress || null;
    this.onChunkComplete = options.onChunkComplete || null;
    this.onError = options.onError || null;

    this.apiBaseUrl = options.apiBaseUrl || '/api/v1/storage';
    this.uploadSession = null;
    this.isPaused = false;
    this.isCancelled = false;
    this.uploadedChunks = new Set();
  }

  // ============================================================================
  // Main Upload Method
  // ============================================================================

  /**
   * Upload a file using chunked transfer
   * @param {File} file - File object to upload
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async upload(file, options = {}) {
    this.isPaused = false;
    this.isCancelled = false;
    this.uploadedChunks.clear();

    const {
      matter_id,
      destination,
      extract_zip = false,
      extract_to,
      trigger_processing = false,
      metadata = {}
    } = options;

    try {
      // Step 1: Start upload session
      this.uploadSession = await this.startUploadSession(file, metadata);

      // Step 2: Split file into chunks
      const chunks = this.splitFile(file);

      // Step 3: Upload chunks (with parallel processing)
      await this.uploadChunks(chunks);

      // Check if upload was cancelled
      if (this.isCancelled) {
        throw new Error('Upload cancelled by user');
      }

      // Step 4: Complete upload (assemble, extract, process)
      const result = await this.completeUpload({
        destination,
        extract_zip,
        extract_to,
        matter_id,
        trigger_processing
      });

      return result;

    } catch (error) {
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
  }

  /**
   * Pause the upload
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume the upload
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Cancel the upload
   */
  async cancel() {
    this.isCancelled = true;

    if (this.uploadSession) {
      try {
        const response = await fetch(
          `${this.apiBaseUrl}/upload/${this.uploadSession.upload_id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${this.getAuthToken()}`
            }
          }
        );

        if (!response.ok) {
          console.error('Failed to cancel upload session');
        }
      } catch (error) {
        console.error('Error cancelling upload:', error);
      }
    }
  }

  // ============================================================================
  // Upload Steps
  // ============================================================================

  /**
   * Start upload session
   * @param {File} file - File to upload
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Session details
   */
  async startUploadSession(file, metadata = {}) {
    const totalChunks = Math.ceil(file.size / this.chunkSize);

    const response = await fetch(`${this.apiBaseUrl}/upload/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getAuthToken()}`
      },
      body: JSON.stringify({
        filename: file.name,
        file_size: file.size,
        total_chunks: totalChunks,
        chunk_size: this.chunkSize,
        content_type: file.type,
        metadata
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to start upload session');
    }

    const session = await response.json();

    // Initial progress callback
    if (this.onProgress) {
      this.onProgress({
        percentage: 0,
        uploadedChunks: 0,
        totalChunks,
        uploadedBytes: 0,
        totalBytes: file.size,
        status: 'uploading'
      });
    }

    return session;
  }

  /**
   * Split file into chunks
   * @param {File} file - File to split
   * @returns {Array<Object>} Array of chunk objects
   */
  splitFile(file) {
    const chunks = [];
    let offset = 0;
    let chunkIndex = 0;

    while (offset < file.size) {
      const end = Math.min(offset + this.chunkSize, file.size);
      chunks.push({
        index: chunkIndex,
        start: offset,
        end: end,
        size: end - offset,
        blob: file.slice(offset, end)
      });
      offset = end;
      chunkIndex++;
    }

    return chunks;
  }

  /**
   * Upload all chunks with parallel processing
   * @param {Array<Object>} chunks - Chunks to upload
   */
  async uploadChunks(chunks) {
    const totalChunks = chunks.length;
    let uploadedCount = 0;
    let uploadedBytes = 0;

    // Create upload queue
    const queue = [...chunks];
    const activeUploads = [];

    while (queue.length > 0 || activeUploads.length > 0) {
      // Check if paused
      while (this.isPaused && !this.isCancelled) {
        await this.sleep(100);
      }

      // Check if cancelled
      if (this.isCancelled) {
        throw new Error('Upload cancelled');
      }

      // Start new uploads if below concurrency limit
      while (queue.length > 0 && activeUploads.length < this.maxParallelUploads) {
        const chunk = queue.shift();
        const uploadPromise = this.uploadChunkWithRetry(chunk)
          .then(() => {
            uploadedCount++;
            uploadedBytes += chunk.size;
            this.uploadedChunks.add(chunk.index);

            // Progress callback
            if (this.onProgress) {
              this.onProgress({
                percentage: Math.round((uploadedCount / totalChunks) * 100),
                uploadedChunks: uploadedCount,
                totalChunks,
                uploadedBytes,
                totalBytes: this.uploadSession.file_size,
                status: 'uploading'
              });
            }

            // Chunk complete callback
            if (this.onChunkComplete) {
              this.onChunkComplete({
                chunkIndex: chunk.index,
                uploadedChunks: uploadedCount,
                totalChunks
              });
            }

            // Remove from active uploads
            const index = activeUploads.indexOf(uploadPromise);
            if (index > -1) {
              activeUploads.splice(index, 1);
            }
          })
          .catch(error => {
            // Remove from active uploads
            const index = activeUploads.indexOf(uploadPromise);
            if (index > -1) {
              activeUploads.splice(index, 1);
            }
            throw error;
          });

        activeUploads.push(uploadPromise);
      }

      // Wait for at least one upload to complete
      if (activeUploads.length > 0) {
        await Promise.race(activeUploads);
      }
    }
  }

  /**
   * Upload a single chunk with retry logic
   * @param {Object} chunk - Chunk to upload
   * @returns {Promise<Object>} Upload result
   */
  async uploadChunkWithRetry(chunk) {
    let retries = 0;

    while (retries <= this.maxRetries) {
      try {
        return await this.uploadChunk(chunk);
      } catch (error) {
        retries++;

        if (retries > this.maxRetries) {
          throw new Error(`Failed to upload chunk ${chunk.index} after ${this.maxRetries} retries: ${error.message}`);
        }

        // Exponential backoff
        const delay = this.retryDelay * Math.pow(2, retries - 1);
        console.warn(`Chunk ${chunk.index} upload failed, retrying in ${delay}ms (attempt ${retries}/${this.maxRetries})`);
        await this.sleep(delay);
      }
    }
  }

  /**
   * Upload a single chunk
   * @param {Object} chunk - Chunk to upload
   * @returns {Promise<Object>} Upload result
   */
  async uploadChunk(chunk) {
    const formData = new FormData();
    formData.append('upload_id', this.uploadSession.upload_id);
    formData.append('chunk_index', chunk.index);
    formData.append('chunk', chunk.blob, `chunk_${chunk.index}`);

    const response = await fetch(`${this.apiBaseUrl}/upload/chunk`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.getAuthToken()}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || `Failed to upload chunk ${chunk.index}`);
    }

    return await response.json();
  }

  /**
   * Complete the upload
   * @param {Object} options - Completion options
   * @returns {Promise<Object>} Completion result
   */
  async completeUpload(options) {
    // Update progress to assembling
    if (this.onProgress) {
      this.onProgress({
        percentage: 100,
        uploadedChunks: this.uploadSession.total_chunks,
        totalChunks: this.uploadSession.total_chunks,
        uploadedBytes: this.uploadSession.file_size,
        totalBytes: this.uploadSession.file_size,
        status: 'assembling'
      });
    }

    const response = await fetch(`${this.apiBaseUrl}/upload/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getAuthToken()}`
      },
      body: JSON.stringify({
        upload_id: this.uploadSession.upload_id,
        destination: options.destination,
        extract_zip: options.extract_zip,
        extract_to: options.extract_to,
        matter_id: options.matter_id,
        trigger_processing: options.trigger_processing
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to complete upload');
    }

    const result = await response.json();

    // Update progress to completed
    if (this.onProgress) {
      this.onProgress({
        percentage: 100,
        uploadedChunks: this.uploadSession.total_chunks,
        totalChunks: this.uploadSession.total_chunks,
        uploadedBytes: this.uploadSession.file_size,
        totalBytes: this.uploadSession.file_size,
        status: 'completed'
      });
    }

    return result;
  }

  /**
   * Get upload status
   * @returns {Promise<Object>} Current status
   */
  async getStatus() {
    if (!this.uploadSession) {
      throw new Error('No active upload session');
    }

    const response = await fetch(
      `${this.apiBaseUrl}/upload/status/${this.uploadSession.upload_id}`,
      {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to get upload status');
    }

    return await response.json();
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get authentication token from localStorage
   * @returns {string} Auth token
   */
  getAuthToken() {
    // Try to get token from localStorage (adjust based on your auth implementation)
    const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('No authentication token found');
    }
    return token;
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format bytes to human readable string
   * @param {number} bytes - Byte count
   * @returns {string} Formatted string
   */
  static formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Calculate estimated time remaining
   * @param {number} uploadedBytes - Bytes uploaded so far
   * @param {number} totalBytes - Total bytes to upload
   * @param {number} startTime - Upload start timestamp
   * @returns {string} Formatted time remaining
   */
  static calculateTimeRemaining(uploadedBytes, totalBytes, startTime) {
    const elapsedTime = Lex.Utils.millisecondsSince(startTime);
    const uploadSpeed = uploadedBytes / (elapsedTime / 1000); // bytes per second
    const remainingBytes = totalBytes - uploadedBytes;
    const remainingSeconds = Math.round(remainingBytes / uploadSpeed);

    if (remainingSeconds < 60) {
      return `${remainingSeconds} seconds`;
    } else if (remainingSeconds < 3600) {
      return `${Math.round(remainingSeconds / 60)} minutes`;
    } else {
      return `${Math.round(remainingSeconds / 3600)} hours`;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkedUploader;
}

// src/js/services/metadata-service.js
// Service for fetching and caching document metadata

class MetadataService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 3600000; // 1 hour in milliseconds
    this.maxCacheSize = 100; // Maximum number of cached documents (LRU eviction)
    this.pendingRequests = new Map(); // Prevent duplicate in-flight requests
  }

  /**
   * Generate cache key for document
   * @param {string} documentId - Document UUID
   * @returns {string} - Cache key
   */
  getCacheKey(documentId) {
    return `metadata:${documentId}`;
  }

  /**
   * Get cached metadata if available and not expired
   * @param {string} documentId - Document UUID
   * @returns {object|null} - Cached metadata or null
   */
  getCached(documentId) {
    const key = this.getCacheKey(documentId);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // Check if cache entry is expired
    const now = LanaTime.nowMs();
    if (now - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    // Update access time for LRU
    cached.lastAccess = now;

    // Move to end of Map (most recently used) for LRU
    this.cache.delete(key);
    this.cache.set(key, cached);

    console.log('[MetadataService] Cache HIT:', documentId);
    return cached.data;
  }

  /**
   * Store metadata in cache
   * @param {string} documentId - Document UUID
   * @param {object} metadata - Metadata object
   */
  setCached(documentId, metadata) {
    const key = this.getCacheKey(documentId);
    const now = LanaTime.nowMs();

    // LRU eviction: if cache is at capacity and this is a new entry, evict oldest
    if (this.cache.size >= this.maxCacheSize && !this.cache.has(key)) {
      // First entry in Map is the oldest (least recently used)
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      console.log('[MetadataService] LRU eviction:', oldestKey);
    }

    this.cache.set(key, {
      data: metadata,
      timestamp: now,
      lastAccess: now
    });
    console.log('[MetadataService] Cached:', documentId, `(${this.cache.size}/${this.maxCacheSize})`);
  }

  /**
   * Invalidate cached metadata for a document
   * @param {string} documentId - Document UUID
   */
  invalidate(documentId) {
    const key = this.getCacheKey(documentId);
    this.cache.delete(key);
    console.log('[MetadataService] Invalidated:', documentId);
  }

  /**
   * Clear entire cache
   */
  clearCache() {
    this.cache.clear();
    console.log('[MetadataService] Cache cleared');
  }

  /**
   * Fetch document metadata from backend API
   * @param {string} documentId - Document UUID
   * @param {boolean} forceRefresh - Skip cache and fetch fresh data
   * @returns {Promise<object>} - Document metadata
   */
  async fetchMetadata(documentId, forceRefresh = false) {
    if (!documentId) {
      throw new Error('Document ID is required');
    }

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.getCached(documentId);
      if (cached) {
        return cached;
      }
    }

    // Check if request is already in-flight (prevent duplicate requests)
    const pendingKey = `pending:${documentId}`;
    if (this.pendingRequests.has(pendingKey)) {
      console.log('[MetadataService] Waiting for in-flight request:', documentId);
      return this.pendingRequests.get(pendingKey);
    }

    // Make API request
    console.log('[MetadataService] Fetching from API:', documentId);
    const requestPromise = this.fetchFromAPI(documentId);

    // Store pending request
    this.pendingRequests.set(pendingKey, requestPromise);

    try {
      const metadata = await requestPromise;

      // Cache the result
      this.setCached(documentId, metadata);

      return metadata;
    } catch (error) {
      console.error('[MetadataService] Fetch failed:', error);
      throw error;
    } finally {
      // Remove pending request
      this.pendingRequests.delete(pendingKey);
    }
  }

  /**
   * Fetch document metadata from backend API
   * @param {string} documentId - Document UUID
   * @returns {Promise<object>} - Document metadata
   */
  async fetchFromAPI(documentId) {
    const apiUrl = window.electronAPI && window.electronAPI.config
      ? await window.electronAPI.config.getBackendUrl()
      : 'http://localhost:8080';

    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Authentication token not found. Please log in.');
    }

    const response = await fetch(`${apiUrl}/api/v1/documents/${documentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Document not found');
      } else if (response.status === 403) {
        throw new Error('You do not have permission to access this document');
      } else if (response.status === 401) {
        throw new Error('Authentication failed. Please log in again.');
      } else {
        const errorText = await response.text();
        throw new Error(`Failed to fetch document metadata: ${response.status} ${errorText}`);
      }
    }

    const data = await response.json();

    if (!data.document) {
      throw new Error('Invalid response from server: missing document data');
    }

    return data.document;
  }

  /**
   * Update document metadata
   * @param {string} documentId - Document UUID
   * @param {object} metadataUpdates - Fields to update
   * @returns {Promise<object>} - Updated document metadata
   */
  async updateMetadata(documentId, metadataUpdates) {
    if (!documentId) {
      throw new Error('Document ID is required');
    }

    const apiUrl = window.electronAPI && window.electronAPI.config
      ? await window.electronAPI.config.getBackendUrl()
      : 'http://localhost:8080';

    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Authentication token not found. Please log in.');
    }

    const response = await fetch(`${apiUrl}/api/v1/documents/${documentId}/metadata`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(metadataUpdates)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update document metadata: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Invalidate cache for this document
    this.invalidate(documentId);

    return data.document;
  }

  /**
   * Trigger document re-indexing
   * @param {string} documentId - Document UUID
   * @returns {Promise<object>} - Re-index job details
   */
  async reindexDocument(documentId) {
    if (!documentId) {
      throw new Error('Document ID is required');
    }

    const apiUrl = window.electronAPI && window.electronAPI.config
      ? await window.electronAPI.config.getBackendUrl()
      : 'http://localhost:8080';

    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Authentication token not found. Please log in.');
    }

    const response = await fetch(`${apiUrl}/api/v1/documents/${documentId}/reindex`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to reindex document: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Invalidate cache for this document
    this.invalidate(documentId);

    return data;
  }

  /**
   * Get cache statistics
   * @returns {object} - Cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      utilizationPercent: Math.round((this.cache.size / this.maxCacheSize) * 100),
      ttl: this.cacheTTL,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
window.metadataService = new MetadataService();

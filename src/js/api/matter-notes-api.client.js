/**
 * Matter Notes API Client
 *
 * Provides methods for all Matter Notes endpoints:
 * - List notes (with cursor pagination)
 * - Create note
 * - Get note by ID
 * - Update note
 * - Delete note
 * - Search notes
 * - Get statistics
 * - AI generation
 *
 * @requires api.js (global api instance)
 */

class MatterNotesAPIClient {
  constructor(apiClient) {
    this.api = apiClient;
  }

  /**
   * Wrap request with timeout
   * @param {Promise} promise - API request promise
   * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
   * @returns {Promise} Request with timeout
   */
  async requestWithTimeout(promise, timeoutMs = 30000) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Wrap request with authentication error handling
   * @param {Function} requestFn - Request function to execute
   * @returns {Promise} Request with auth handling
   */
  async makeAuthenticatedRequest(requestFn) {
    try {
      return await requestFn();
    } catch (error) {
      if (error.status === 401 || error.message?.includes('401')) {
        // Token expired, trigger re-auth
        if (window.handleAuthenticationError) {
          window.handleAuthenticationError();
        }
        throw new Error('Session expired. Please log in again.');
      }
      throw error;
    }
  }

  /**
   * List notes for a matter with cursor pagination
   * @param {string} matterId - Matter ID (e.g., MATT-00001)
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of notes per page (default: 50)
   * @param {string} options.cursor - Pagination cursor from previous response
   * @param {string} options.sort_by - Sort field (created_at, updated_at, title)
   * @param {string} options.sort_order - Sort order (asc, desc)
   * @returns {Promise<Object>} { notes: Note[], pagination: { next_cursor, has_more, total } }
   */
  async listNotes(matterId, options = {}) {
    return this.makeAuthenticatedRequest(async () => {
      const params = new URLSearchParams();

      if (options.limit) params.append('limit', options.limit);
      if (options.cursor) params.append('cursor', options.cursor);
      if (options.sort_by) params.append('sort_by', options.sort_by);
      if (options.sort_order) params.append('sort_order', options.sort_order);

      const queryString = params.toString();
      const endpoint = `/api/v1/matters/${matterId}/notes${queryString ? '?' + queryString : ''}`;

      return this.requestWithTimeout(this.api.get(endpoint), 30000);
    });
  }

  /**
   * Create a new note for a matter
   * @param {string} matterId - Matter ID
   * @param {Object} noteData - Note data
   * @param {string} noteData.title - Note title (required)
   * @param {string} noteData.content - Note content (HTML format)
   * @returns {Promise<Object>} { note: Note }
   */
  async createNote(matterId, noteData) {
    return this.makeAuthenticatedRequest(async () => {
      const endpoint = `/api/v1/matters/${matterId}/notes`;
      return this.requestWithTimeout(this.api.post(endpoint, noteData), 30000);
    });
  }

  /**
   * Get a specific note by ID
   * @param {string} matterId - Matter ID
   * @param {string} noteId - Note ID (UUID)
   * @returns {Promise<Object>} { note: Note }
   */
  async getNote(matterId, noteId) {
    return this.makeAuthenticatedRequest(async () => {
      const endpoint = `/api/v1/matters/${matterId}/notes/${noteId}`;
      return this.requestWithTimeout(this.api.get(endpoint), 30000);
    });
  }

  /**
   * Update an existing note
   * @param {string} matterId - Matter ID
   * @param {string} noteId - Note ID
   * @param {Object} updates - Fields to update
   * @param {string} updates.title - Updated title
   * @param {string} updates.content - Updated content (HTML)
   * @returns {Promise<Object>} { note: Note }
   */
  async updateNote(matterId, noteId, updates) {
    return this.makeAuthenticatedRequest(async () => {
      const endpoint = `/api/v1/matters/${matterId}/notes/${noteId}`;
      return this.requestWithTimeout(this.api.put(endpoint, updates), 30000);
    });
  }

  /**
   * Delete a note (soft delete)
   * @param {string} matterId - Matter ID
   * @param {string} noteId - Note ID
   * @returns {Promise<Object>} { success: true, message: string }
   */
  async deleteNote(matterId, noteId) {
    return this.makeAuthenticatedRequest(async () => {
      const endpoint = `/api/v1/matters/${matterId}/notes/${noteId}`;
      return this.requestWithTimeout(this.api.delete(endpoint), 30000);
    });
  }

  /**
   * Search notes within a matter
   * @param {string} matterId - Matter ID
   * @param {string} query - Search query (min 3 characters)
   * @param {Object} options - Search options
   * @param {number} options.limit - Max results (default: 20)
   * @returns {Promise<Object>} { results: Note[], total: number, query: string }
   */
  async searchNotes(matterId, query, options = {}) {
    return this.makeAuthenticatedRequest(async () => {
      const params = new URLSearchParams();
      params.append('q', query);

      if (options.limit) params.append('limit', options.limit);

      const endpoint = `/api/v1/matters/${matterId}/notes/search?${params.toString()}`;
      return this.requestWithTimeout(this.api.get(endpoint), 30000);
    });
  }

  /**
   * Get notes statistics for a matter
   * @param {string} matterId - Matter ID
   * @returns {Promise<Object>} { total_notes, avg_length, last_created_at, last_updated_at }
   */
  async getStatistics(matterId) {
    return this.makeAuthenticatedRequest(async () => {
      const endpoint = `/api/v1/matters/${matterId}/notes/statistics`;
      return this.requestWithTimeout(this.api.get(endpoint), 30000);
    });
  }

  /**
   * Generate note content using AI
   * @param {string} matterId - Matter ID
   * @param {Object} params - Generation parameters
   * @param {string} params.prompt - AI prompt/instruction
   * @param {string} params.context - Optional context (matter data, existing notes, etc.)
   * @returns {Promise<Object>} { generated_content: string, tokens_used: number }
   */
  async generateNoteContent(matterId, params) {
    return this.makeAuthenticatedRequest(async () => {
      const endpoint = `/api/v1/matters/${matterId}/notes/generate`;
      return this.requestWithTimeout(this.api.post(endpoint, params), 60000); // Longer timeout for AI
    });
  }

  /**
   * Load all notes for a matter (handles pagination automatically)
   * Useful for initial load or refresh
   * @param {string} matterId - Matter ID
   * @param {Object} options - Load options
   * @param {number} options.limit - Notes per request (default: 100)
   * @param {number} options.maxNotes - Max total notes to load (default: 1000)
   * @param {Function} options.onProgress - Progress callback (loaded, total)
   * @returns {Promise<Array<Note>>} All notes for the matter
   */
  async loadAllNotes(matterId, options = {}) {
    const limit = options.limit || 100;
    const maxNotes = options.maxNotes || 1000;
    const onProgress = options.onProgress;

    const allNotes = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore && allNotes.length < maxNotes) {
      const response = await this.listNotes(matterId, {
        limit,
        cursor,
        sort_by: options.sort_by || 'updated_at',
        sort_order: options.sort_order || 'desc'
      });

      if (response.notes && response.notes.length > 0) {
        allNotes.push(...response.notes);
      }

      if (onProgress) {
        onProgress(allNotes.length, response.pagination?.total || allNotes.length);
      }

      cursor = response.pagination?.next_cursor;
      hasMore = response.pagination?.has_more || false;

      // Safety check
      if (!cursor || !hasMore) break;
    }

    return allNotes;
  }

  /**
   * Format note preview text (strip HTML, truncate)
   * @param {string} htmlContent - HTML content
   * @param {number} maxLength - Max preview length (default: 200)
   * @returns {string} Plain text preview
   */
  formatPreview(htmlContent, maxLength = 200) {
    if (!htmlContent) return '';

    // Strip HTML tags
    const div = document.createElement('div');
    div.innerHTML = htmlContent;
    const text = div.textContent || div.innerText || '';

    // Truncate
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  /**
   * Format relative date (e.g., "2 hours ago", "Yesterday")
   * @param {string} dateString - ISO date string
   * @returns {string} Relative date string
   */
  formatRelativeDate(dateString) {
    if (!dateString) return '';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      // Format as "Jan 15, 2025"
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
  }

  /**
   * Validate note data before submission
   * @param {Object} noteData - Note data to validate
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validateNoteData(noteData) {
    const errors = [];

    if (!noteData.title || noteData.title.trim().length === 0) {
      errors.push('Title is required');
    }

    if (noteData.title && noteData.title.length > 500) {
      errors.push('Title must be 500 characters or less');
    }

    if (noteData.content && noteData.content.length > 50000) {
      errors.push('Content must be 50,000 characters or less');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Debounce helper for auto-save
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @returns {Function} Debounced function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MatterNotesAPIClient;
}

// Make available globally for browser use
if (typeof window !== 'undefined') {
  window.MatterNotesAPIClient = MatterNotesAPIClient;
}

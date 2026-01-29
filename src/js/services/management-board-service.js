/**
 * Management Board API Service
 * Wrapper for all management board API calls
 *
 * @description Provides a centralized API interface for management board operations
 * @requires api.js - Base API client must be loaded first
 */

const ManagementBoardService = {
  baseUrl: '/api/v1/admin/management-boards',

  /**
   * Get all boards accessible to current user
   * @returns {Promise<{boards: Array}>} Array of boards user can access
   */
  async getMyBoards() {
    try {
      const response = await api.get(this.baseUrl);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error fetching my boards:', error);
      throw error;
    }
  },

  /**
   * Get all boards in organization (admin only)
   * @param {Object} filters - Optional filters (type, search, etc.)
   * @returns {Promise<{boards: Array}>} Array of all boards in organization
   */
  async getAllBoards(filters = {}) {
    try {
      const params = new URLSearchParams(filters);
      const response = await api.get(`${this.baseUrl}?${params}`);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error fetching all boards:', error);
      throw error;
    }
  },

  /**
   * Get board detail with metrics
   * @param {string} boardId - Board UUID
   * @returns {Promise<Object>} Board details including metrics
   */
  async getBoardDetail(boardId) {
    try {
      const response = await api.get(`${this.baseUrl}/${boardId}`);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error fetching board detail:', error);
      throw error;
    }
  },

  /**
   * Create new board
   * @param {Object} boardData - Board configuration
   * @param {string} boardData.name - Board name
   * @param {string} boardData.board_type - Board type (intake/caseload/revenue/custom)
   * @param {string} boardData.description - Optional description
   * @returns {Promise<Object>} Created board
   */
  async createBoard(boardData) {
    try {
      const response = await api.post(this.baseUrl, boardData);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error creating board:', error);
      throw error;
    }
  },

  /**
   * Update board
   * @param {string} boardId - Board UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated board
   */
  async updateBoard(boardId, updates) {
    try {
      const response = await api.put(`${this.baseUrl}/${boardId}`, updates);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error updating board:', error);
      throw error;
    }
  },

  /**
   * Delete board
   * @param {string} boardId - Board UUID
   * @returns {Promise<Object>} Deletion confirmation
   */
  async deleteBoard(boardId) {
    try {
      const response = await api.delete(`${this.baseUrl}/${boardId}`);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error deleting board:', error);
      throw error;
    }
  },

  /**
   * Create metric
   * @param {string} boardId - Board UUID
   * @param {Object} metricData - Metric configuration
   * @param {string} metricData.metric_label - Metric name
   * @param {string} metricData.metric_type - Type (number/percentage/currency/boolean)
   * @param {string} metricData.frequency - Frequency (daily/weekly/monthly/quarterly/annual)
   * @param {Array<string>} metricData.assigned_users - User IDs who submit this metric
   * @returns {Promise<Object>} Created metric
   */
  async createMetric(boardId, metricData) {
    try {
      const response = await api.post(`${this.baseUrl}/${boardId}/metrics`, metricData);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error creating metric:', error);
      throw error;
    }
  },

  /**
   * Submit metric value
   * @param {string} boardId - Board UUID
   * @param {string} metricId - Metric UUID
   * @param {Object} submissionData - Submission details
   * @param {number} submissionData.value - Metric value
   * @param {string} submissionData.submission_date - Date (YYYY-MM-DD)
   * @param {string} submissionData.notes - Optional notes
   * @returns {Promise<Object>} Submission record
   */
  async submitMetric(boardId, metricId, submissionData) {
    try {
      const response = await api.post(`${this.baseUrl}/${boardId}/metrics/${metricId}/submit`, submissionData);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error submitting metric:', error);
      throw error;
    }
  },

  /**
   * Get submissions for board
   * @param {string} boardId - Board UUID
   * @param {Object} filters - Optional filters (metric_id, date_from, date_to, etc.)
   * @returns {Promise<{submissions: Array}>} Array of submissions
   */
  async getSubmissions(boardId, filters = {}) {
    try {
      const params = new URLSearchParams(filters);
      const response = await api.get(`${this.baseUrl}/${boardId}/submissions?${params}`);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error fetching submissions:', error);
      throw error;
    }
  },

  /**
   * Get user's pending metrics (need submission)
   * @returns {Promise<Array>} Array of metrics awaiting user submission
   */
  async getPendingMetrics() {
    try {
      // Get all boards user can access
      const { boards } = await this.getMyBoards();
      const pending = [];

      for (const board of boards || []) {
        const detail = await this.getBoardDetail(board.id);

        // Filter metrics that need submission by current user
        if (detail.metrics) {
          detail.metrics.forEach(metric => {
            // Check if metric needs submission (this logic may vary based on backend)
            if (metric.needsSubmission || metric.status === 'pending') {
              pending.push({
                boardId: board.id,
                boardName: board.name,
                ...metric
              });
            }
          });
        }
      }

      return pending;
    } catch (error) {
      console.error('[ManagementBoardService] Error fetching pending metrics:', error);
      throw error;
    }
  },

  /**
   * Get recent submissions (last 20)
   * Note: This fetches submissions from all boards the user has access to
   * @returns {Promise<Array>} Recent submissions across all boards
   */
  async getRecentSubmissions() {
    try {
      // First, get all boards the user has access to
      const boardsResponse = await api.get(`${this.baseUrl}`);
      const boards = boardsResponse.boards || [];

      if (boards.length === 0) {
        return [];
      }

      // Fetch submissions from each board (limited to first 3 boards to avoid too many requests)
      const submissionPromises = boards.slice(0, 3).map(board =>
        api.get(`${this.baseUrl}/${board.id}/submissions?page_size=10`)
          .catch(err => {
            console.warn(`Failed to fetch submissions for board ${board.id}:`, err);
            return { submissions: [] };
          })
      );

      const results = await Promise.all(submissionPromises);

      // Combine and sort all submissions by submitted_at
      const allSubmissions = results.flatMap(r => r.submissions || []);
      allSubmissions.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

      // Return last 20
      return allSubmissions.slice(0, 20);
    } catch (error) {
      console.error('[ManagementBoardService] Error fetching recent submissions:', error);
      throw error;
    }
  },

  /**
   * Approve submission (admin only)
   * @param {string} boardId - Board UUID
   * @param {string} submissionId - Submission UUID
   * @returns {Promise<Object>} Approved submission
   */
  async approveSubmission(boardId, submissionId) {
    try {
      const response = await api.post(`${this.baseUrl}/${boardId}/submissions/${submissionId}/approve`);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error approving submission:', error);
      throw error;
    }
  },

  /**
   * Get user assignments for a board
   * @param {string} boardId - Board UUID
   * @returns {Promise<Array>} Array of user assignments
   */
  async getAssignments(boardId) {
    try {
      const response = await api.get(`${this.baseUrl}/${boardId}/assignments`);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error fetching assignments:', error);
      throw error;
    }
  },

  /**
   * Assign a user to a board
   * @param {string} boardId - Board UUID
   * @param {Object} assignmentData - Assignment details
   * @param {string} assignmentData.user_id - User UUID
   * @param {string} assignmentData.access_level - Access level (admin/editor/viewer)
   * @returns {Promise<Object>} Created assignment
   */
  async assignUser(boardId, assignmentData) {
    try {
      const response = await api.post(`${this.baseUrl}/${boardId}/assignments`, assignmentData);
      return response;
    } catch (error) {
      console.error('[ManagementBoardService] Error assigning user:', error);
      throw error;
    }
  },

  /**
   * Remove a user assignment from a board
   * @param {string} boardId - Board UUID
   * @param {string} userId - User UUID to remove
   * @returns {Promise<void>}
   */
  async removeAssignment(boardId, userId) {
    try {
      await api.delete(`${this.baseUrl}/${boardId}/assignments/${userId}`);
    } catch (error) {
      console.error('[ManagementBoardService] Error removing assignment:', error);
      throw error;
    }
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ManagementBoardService;
}

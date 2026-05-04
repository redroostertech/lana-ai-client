/**
 * Utility Functions
 * Security and helper functions for the frontend
 */

const Utils = {
  /**
   * Escape HTML to prevent XSS attacks
   * Use this when displaying user-generated content in HTML
   *
   * @param {string} text - Text to escape
   * @returns {string} - HTML-escaped text
   *
   * @example
   * // Safe: Prevents XSS
   * element.innerHTML = Utils.escapeHtml(userInput);
   *
   * // Also safe: textContent automatically escapes
   * element.textContent = userInput;
   */
  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
      '/': '&#x2F;'
    };
    return String(text).replace(/[&<>"'\/]/g, char => map[char]);
  },

  /**
   * Sanitize a tag for display
   * Removes potentially dangerous characters
   *
   * @param {string} tag - Tag to sanitize
   * @returns {string} - Sanitized tag
   */
  sanitizeTag(tag) {
    if (!tag) return '';
    // Remove any HTML-like characters and trim
    return String(tag)
      .replace(/[<>'"&]/g, '')
      .trim()
      .substring(0, 50); // Max 50 chars per tag
  },

  /**
   * Sanitize an array of tags
   *
   * @param {string[]} tags - Array of tags
   * @returns {string[]} - Sanitized tags
   */
  sanitizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags
      .map(tag => this.sanitizeTag(tag))
      .filter(tag => tag.length > 0)
      .slice(0, 10); // Max 10 tags
  },

  /**
   * Truncate text to a maximum length
   *
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @param {string} suffix - Suffix to add if truncated (default: '...')
   * @returns {string} - Truncated text
   */
  truncate(text, maxLength, suffix = '...') {
    if (!text || text.length <= maxLength) return text || '';
    return text.substring(0, maxLength - suffix.length) + suffix;
  },

  /**
   * Format file size in human-readable format
   *
   * @param {number} bytes - Size in bytes
   * @returns {string} - Formatted size (e.g., "1.5 MB")
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  /**
   * Format an integer count for compact display in pills, badges, and metrics.
   *
   * Examples:
   *   0          → "0"
   *   42         → "42"
   *   1000       → "1k"
   *   1234       → "1.2k"
   *   12345      → "12.3k"
   *   123456     → "123k"
   *   1500000    → "1.5m"
   *   2000000000 → "2b"
   *
   * One decimal is shown only when it adds information (1.0k → "1k", not "1.0k").
   * Returns "-" for null/undefined/non-finite/negative inputs so callers can
   * use the result directly as a placeholder when stats haven't loaded yet.
   *
   * @param {number|string|null|undefined} value
   * @returns {string}
   */
  formatCompactCount(value) {
    if (value === null || value === undefined) return '-';
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '-';
    const format = (scaled, suffix) => {
      const rounded = Math.round(scaled * 10) / 10;
      const str = (rounded % 1 === 0) ? String(Math.trunc(rounded)) : rounded.toFixed(1);
      return str + suffix;
    };
    if (n >= 1e9) return format(n / 1e9, 'b');
    if (n >= 1e6) return format(n / 1e6, 'm');
    if (n >= 1e3) return format(n / 1e3, 'k');
    return String(Math.trunc(n));
  },

  /**
   * Validate document type against allowed types
   *
   * @param {string} docType - Document type to validate
   * @returns {boolean} - True if valid
   */
  isValidDocumentType(docType) {
    const allowedTypes = [
      'contract', 'pleading', 'deposition', 'medical_record',
      'police_report', 'email', 'expert_report', 'correspondence', 'document'
    ];
    return allowedTypes.includes(docType);
  },

  /**
   * Validate and sanitize notes field
   *
   * @param {string} notes - Notes text
   * @param {number} maxLength - Maximum length (default: 2000)
   * @returns {string} - Sanitized notes
   */
  sanitizeNotes(notes, maxLength = 2000) {
    if (!notes) return '';
    // Trim and limit length
    return String(notes).trim().substring(0, maxLength);
  },

  /**
   * Parse tags from comma-separated string
   *
   * @param {string} tagsString - Comma-separated tags
   * @returns {string[]} - Array of sanitized tags
   */
  parseTagsString(tagsString) {
    if (!tagsString || typeof tagsString !== 'string') return [];
    return this.sanitizeTags(
      tagsString.split(',').map(t => t.trim())
    );
  },

  /**
   * Display tags as HTML badges (safely)
   *
   * @param {string[]} tags - Array of tags
   * @returns {string} - HTML string with tag badges
   */
  renderTagBadges(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
      return '<span class="text-xs text-gray-400">No tags</span>';
    }

    return this.sanitizeTags(tags)
      .map(tag => {
        const escapedTag = this.escapeHtml(tag);
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800 mr-1 mb-1">${escapedTag}</span>`;
      })
      .join('');
  }
};

// Make Utils available globally
if (typeof window !== 'undefined') {
  window.Utils = Utils;
}

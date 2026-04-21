// src/js/utils/metadata-formatter.js
// Utility functions for formatting document metadata for display

/**
 * Format document type for display
 * @param {string|null} documentType - Raw document type from database
 * @returns {string} - Formatted document type
 */
function formatDocumentType(documentType) {
  if (!documentType) return '—';

  const typeMap = {
    'contract': 'Contract',
    'deposition': 'Deposition',
    'police_report': 'Police Report',
    'medical_record': 'Medical Record',
    'expert_report': 'Expert Report',
    'email': 'Email',
    'correspondence': 'Correspondence',
    'pleading': 'Pleading',
    'motion': 'Motion',
    'brief': 'Brief',
    'order': 'Court Order',
    'transcript': 'Transcript',
    'invoice': 'Invoice',
    'receipt': 'Receipt',
    'report': 'Report',
    'memo': 'Memorandum',
    'letter': 'Letter',
    'agreement': 'Agreement',
    'affidavit': 'Affidavit',
    'declaration': 'Declaration'
  };

  return typeMap[documentType] || documentType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Format privilege status for display
 * @param {string|null} privilegeStatus - Raw privilege status from database
 * @returns {object} - { text, icon, className }
 */
function formatPrivilegeStatus(privilegeStatus) {
  if (!privilegeStatus || privilegeStatus === 'none') {
    return { text: null, icon: null, className: null };
  }

  const statusMap = {
    'attorney_client': {
      text: 'Attorney-Client Privileged',
      icon: 'lock',
      className: 'text-red-600 bg-red-50 border-red-200'
    },
    'work_product': {
      text: 'Work Product',
      icon: 'shield',
      className: 'text-amber-600 bg-amber-50 border-amber-200'
    }
  };

  return statusMap[privilegeStatus] || {
    text: privilegeStatus.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    icon: 'info',
    className: 'text-gray-600 bg-gray-50 border-gray-200'
  };
}

/**
 * Format processing status for display
 * @param {string|null} status - Raw processing status from database
 * @returns {object} - { text, icon, className, showSpinner }
 */
function formatProcessingStatus(status) {
  if (!status) {
    return { text: 'Unknown', icon: 'question', className: 'text-gray-500', showSpinner: false };
  }

  const statusMap = {
    'uploaded': {
      text: 'Uploaded',
      icon: 'upload',
      className: 'text-blue-600 bg-blue-50 border-blue-200',
      showSpinner: false
    },
    'parsed': {
      text: 'Parsed',
      icon: 'file-text',
      className: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      showSpinner: false
    },
    'indexed': {
      text: 'Indexed',
      icon: 'database',
      className: 'text-amber-600 bg-amber-50 border-amber-200',
      showSpinner: false
    },
    'ready': {
      text: 'Ready',
      icon: 'check-circle',
      className: 'text-green-600 bg-green-50 border-green-200',
      showSpinner: false
    },
    'pending': {
      text: 'Pending',
      icon: 'clock',
      className: 'text-yellow-600 bg-yellow-50 border-yellow-200',
      showSpinner: false
    },
    'processing': {
      text: 'Processing...',
      icon: 'sync',
      className: 'text-blue-600 bg-blue-50 border-blue-200',
      showSpinner: true
    },
    'completed': {
      text: 'Completed',
      icon: 'check-circle',
      className: 'text-green-600 bg-green-50 border-green-200',
      showSpinner: false
    },
    'failed': {
      text: 'Failed',
      icon: 'x-circle',
      className: 'text-red-600 bg-red-50 border-red-200',
      showSpinner: false
    }
  };

  return statusMap[status] || {
    text: status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    icon: 'info',
    className: 'text-gray-600 bg-gray-50 border-gray-200',
    showSpinner: false
  };
}

/**
 * Format document lifecycle state for display
 * @param {object} documentData - Document object
 * @returns {object} - Lifecycle display data
 */
function formatDocumentLifecycle(documentData) {
  if (window.documentLifecycle && typeof window.documentLifecycle.getDocumentLifecycleDisplay === 'function') {
    return window.documentLifecycle.getDocumentLifecycleDisplay(documentData);
  }

  const processingStatus = documentData && documentData.processing_status ? documentData.processing_status : null;
  const status = formatProcessingStatus(processingStatus);
  return {
    state: processingStatus || 'unknown',
    summaryState: documentData && documentData.summary ? 'summarized' : 'unavailable',
    label: status.text,
    badgeClass: status.className,
    progressLabel: status.text,
    secondaryLabel: null,
    isReady: processingStatus === 'completed',
    isTerminal: processingStatus === 'completed' || processingStatus === 'failed',
    isInProgress: processingStatus === 'processing',
    isActionableInChat: processingStatus === 'completed'
  };
}

/**
 * Format summary state for display
 * @param {object} documentData - Document object
 * @returns {object} - Summary display data
 */
function formatSummaryState(documentData) {
  if (window.documentLifecycle && typeof window.documentLifecycle.getDocumentSummaryState === 'function') {
    const summaryState = window.documentLifecycle.getDocumentSummaryState(documentData);
    if (summaryState === 'summarized') {
      return { state: 'summarized', text: 'Summarized', className: 'text-green-700 bg-green-50 border-green-200' };
    }
    if (summaryState === 'pending') {
      return { state: 'pending', text: 'Summary pending', className: 'text-amber-700 bg-amber-50 border-amber-200' };
    }
    return { state: 'unavailable', text: 'Summary unavailable', className: 'text-gray-600 bg-gray-50 border-gray-200' };
  }

  if (documentData && documentData.summary) {
    return { state: 'summarized', text: 'Summarized', className: 'text-green-700 bg-green-50 border-green-200' };
  }
  return { state: 'unavailable', text: 'Summary unavailable', className: 'text-gray-600 bg-gray-50 border-gray-200' };
}

/**
 * Format date for display
 * @param {string|null} dateString - ISO date string or date from database
 * @returns {string} - Formatted date
 */
function formatDate(dateString) {
  if (!dateString) return '—';

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return '—';
  }
}

/**
 * Format timestamp as relative or absolute time
 * @param {string|null} timestampString - ISO timestamp from database
 * @returns {string} - Formatted time (relative if recent, absolute if old)
 */
function formatTimestamp(timestampString) {
  if (!timestampString) return '—';

  try {
    const timestamp = new Date(timestampString);
    if (isNaN(timestamp.getTime())) return '—';

    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Relative time for recent timestamps
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

    // Absolute time for older timestamps
    return timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return '—';
  }
}

/**
 * Get full timestamp for hover tooltip
 * @param {string|null} timestampString - ISO timestamp from database
 * @returns {string} - Full formatted timestamp
 */
function formatTimestampFull(timestampString) {
  if (!timestampString) return null;

  try {
    const timestamp = new Date(timestampString);
    if (isNaN(timestamp.getTime())) return null;

    return timestamp.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
  } catch (error) {
    console.error('Error formatting full timestamp:', error);
    return null;
  }
}

/**
 * Calculate duration between two timestamps
 * @param {string|null} startTimestamp - Start timestamp
 * @param {string|null} endTimestamp - End timestamp
 * @returns {string} - Formatted duration
 */
function formatDuration(startTimestamp, endTimestamp) {
  if (!startTimestamp || !endTimestamp) return '—';

  try {
    const start = new Date(startTimestamp);
    const end = new Date(endTimestamp);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '—';

    const diffMs = end.getTime() - start.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffSeconds < 60) return `${diffSeconds} second${diffSeconds === 1 ? '' : 's'}`;
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;
    return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;
  } catch (error) {
    console.error('Error calculating duration:', error);
    return '—';
  }
}

/**
 * Format file size for display
 * @param {number|null} bytes - File size in bytes
 * @returns {string} - Formatted file size
 */
function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Format processing trigger source
 * @param {string|null} triggeredBy - Raw triggered_by value from database
 * @returns {string} - Formatted trigger source
 */
function formatProcessingTrigger(triggeredBy) {
  if (!triggeredBy) return '—';

  const triggerMap = {
    'upload-user': 'User Upload',
    'upload-connector': 'Connector Sync',
    'view': 'Document Opened',
    'chat-mention': 'Mentioned in Chat',
    'manual-reindex': 'Manual Re-index',
    'bulk-reindex': 'Bulk Re-index',
    'metadata-update': 'Metadata Updated'
  };

  return triggerMap[triggeredBy] || triggeredBy.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Format summary method for display
 * @param {string|null} summaryMethod - Raw summary_method from database
 * @returns {string} - Formatted summary method
 */
function formatSummaryMethod(summaryMethod) {
  if (!summaryMethod) return '—';

  const methodMap = {
    'ollama-llama3.1:8b': 'Generated by Ollama (Llama 3.1 8B)',
    'ollama-llama3:8b': 'Generated by Ollama (Llama 3 8B)',
    'ollama-qwen3-vl': 'Generated by Ollama (Qwen 3 Vision)',
    'gpt-4': 'Generated by GPT-4',
    'gpt-3.5-turbo': 'Generated by GPT-3.5 Turbo',
    'rule-based': 'Rule-Based Extraction'
  };

  return methodMap[summaryMethod] || `Generated by ${summaryMethod}`;
}

/**
 * Truncate long text with ellipsis
 * @param {string|null} text - Text to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @returns {object} - { text, isTruncated }
 */
function truncateText(text, maxLength = 300) {
  if (!text) return { text: '', isTruncated: false };

  if (text.length <= maxLength) {
    return { text, isTruncated: false };
  }

  const truncated = text.substring(0, maxLength).trim() + '...';
  return { text: truncated, isTruncated: true };
}

/**
 * Format extracted entities for display
 * @param {object|null} extractedEntities - JSONB extracted_entities from database
 * @returns {object} - Formatted entities with arrays
 */
function formatExtractedEntities(extractedEntities) {
  if (!extractedEntities || typeof extractedEntities !== 'object') {
    return {
      caseNumbers: [],
      organizations: [],
      people: [],
      dates: [],
      locations: [],
      matterIds: []
    };
  }

  return {
    caseNumbers: Array.isArray(extractedEntities.case_numbers) ? extractedEntities.case_numbers : [],
    organizations: Array.isArray(extractedEntities.organizations) ? extractedEntities.organizations : [],
    people: Array.isArray(extractedEntities.people) ? extractedEntities.people : [],
    dates: Array.isArray(extractedEntities.dates) ? extractedEntities.dates.map(d => formatDate(d)) : [],
    locations: Array.isArray(extractedEntities.locations) ? extractedEntities.locations : [],
    matterIds: Array.isArray(extractedEntities.matter_ids) ? extractedEntities.matter_ids : []
  };
}

/**
 * Check if metadata section has any populated fields
 * @param {object} metadata - Metadata object
 * @param {array} fieldNames - Field names to check
 * @returns {boolean} - True if any field is populated
 */
function hasAnyPopulatedFields(metadata, fieldNames) {
  return fieldNames.some(fieldName => {
    const value = metadata[fieldName];
    return value !== null && value !== undefined && value !== '';
  });
}

// Export all formatting functions
window.metadataFormatter = {
  formatDocumentType,
  formatPrivilegeStatus,
  formatProcessingStatus,
  formatDocumentLifecycle,
  formatSummaryState,
  formatDate,
  formatTimestamp,
  formatTimestampFull,
  formatDuration,
  formatFileSize,
  formatProcessingTrigger,
  formatSummaryMethod,
  truncateText,
  formatExtractedEntities,
  hasAnyPopulatedFields
};

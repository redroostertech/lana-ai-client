/**
 * File Viewer with Metadata Panel
 *
 * Handles file preview and metadata editing for storage system
 */

// ============================================================
// FILE VIEWER STATE
// ============================================================
const viewerState = {
  currentFile: null,
  originalMetadata: {},
  metadataChanged: false,
  metadataMode: 'view' // 'view' or 'edit'
};

// ============================================================
// OPEN FILE VIEWER
// ============================================================
async function openFileViewer(fileId) {
  console.log('[FileViewer] Opening file:', fileId);

  const modal = document.getElementById('documentViewerModal');
  if (!modal) {
    console.error('[FileViewer] Modal not found');
    return;
  }

  // Show modal
  modal.classList.remove('hidden');

  // Show loading state
  showViewerLoading();

  try {
    // Fetch file details
    const response = await api.get(`/api/v1/storage/files/${fileId}`);

    if (!response || !response.id) {
      throw new Error('File not found');
    }

    viewerState.currentFile = response;
    viewerState.originalMetadata = {
      document_type: response.metadata?.document_type || '',
      tags: response.metadata?.tags || '',
      notes: response.metadata?.notes || ''
    };
    viewerState.metadataChanged = false;

    // Update header
    document.getElementById('viewerFileName').textContent = response.filename;
    document.getElementById('viewerFileInfo').textContent = `${formatFileSize(response.file_size)} • ${new Date(response.created_at).toLocaleDateString()}`;

    // Set download link
    const downloadBtn = document.getElementById('viewerDownloadBtn');
    downloadBtn.href = `${api.baseUrl}/api/v1/storage/files/${fileId}/download`;
    downloadBtn.download = response.filename;

    // Load file content
    await loadFileContent(response);

    // Load metadata
    loadMetadata(response);

  } catch (error) {
    console.error('[FileViewer] Failed to load file:', error);
    showViewerError('Failed to load file: ' + error.message);
  }
}

// ============================================================
// LOAD FILE CONTENT
// ============================================================
async function loadFileContent(file) {
  // Hide all viewers
  hideAllViewers();

  const mimeType = file.content_type || '';
  const ext = file.filename.split('.').pop().toLowerCase();

  console.log('[FileViewer] Loading content:', { mimeType, ext });

  try {
    // PDF files
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      await loadPDF(file);
    }
    // Images
    else if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      await loadImage(file);
    }
    // Text files
    else if (mimeType.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'csv', 'log'].includes(ext)) {
      await loadText(file);
    }
    // Unsupported
    else {
      showViewerError(`Preview not available for ${ext.toUpperCase()} files`);
    }
  } catch (error) {
    console.error('[FileViewer] Content load error:', error);
    showViewerError('Failed to load preview: ' + error.message);
  }
}

// ============================================================
// FILE TYPE LOADERS
// ============================================================
async function loadPDF(file) {
  const iframe = document.getElementById('viewerIframe');
  const url = `${api.baseUrl}/api/v1/storage/files/${file.id}/download`;

  iframe.src = url;
  iframe.classList.remove('hidden');

  hideViewerLoading();
}

async function loadImage(file) {
  const img = document.getElementById('viewerImage');
  const url = `${api.baseUrl}/api/v1/storage/files/${file.id}/download`;

  img.src = url;
  img.onload = () => {
    img.classList.remove('hidden');
    hideViewerLoading();
  };
  img.onerror = () => {
    showViewerError('Failed to load image');
  };
}

async function loadText(file) {
  try {
    const response = await fetch(`${api.baseUrl}/api/v1/storage/files/${file.id}/download`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      }
    });

    if (!response.ok) throw new Error('Failed to fetch file');

    const text = await response.text();
    const pre = document.getElementById('viewerText');

    pre.textContent = text;
    pre.classList.remove('hidden');

    hideViewerLoading();
  } catch (error) {
    showViewerError('Failed to load text file');
  }
}

// ============================================================
// METADATA HANDLING
// ============================================================
function loadMetadata(file) {
  // File info (read-only)
  document.getElementById('metaFileSize').textContent = formatFileSize(file.file_size);
  document.getElementById('metaFileType').textContent = formatMimeType(file.content_type);
  document.getElementById('metaUploadedAt').textContent = new Date(file.created_at).toLocaleDateString();

  const metadata = file.metadata || {};

  // Populate View Mode (readonly)
  document.getElementById('metaDocTypeView').textContent = formatDocumentType(metadata.document_type) || 'Not specified';
  document.getElementById('metaTagsView').textContent = metadata.tags || 'No tags';
  document.getElementById('metaNotesView').textContent = metadata.notes || 'No notes';

  // Populate Edit Mode (editable fields)
  document.getElementById('metaDocType').value = metadata.document_type || '';
  document.getElementById('metaTags').value = metadata.tags || '';
  document.getElementById('metaNotes').value = metadata.notes || '';

  // Update character count
  updateNotesCount();

  // Track changes
  trackMetadataChanges();

  // Initialize in view mode
  setMetadataMode('view');
}

function formatDocumentType(type) {
  if (!type) return null;

  const typeMap = {
    'contract': 'Contract',
    'pleading': 'Pleading',
    'deposition': 'Deposition',
    'medical_record': 'Medical Record',
    'police_report': 'Police Report',
    'email': 'Email',
    'correspondence': 'Correspondence',
    'other': 'Other'
  };

  return typeMap[type] || type;
}

function setMetadataMode(mode) {
  viewerState.metadataMode = mode;

  const viewModeBtn = document.getElementById('viewModeBtn');
  const editModeBtn = document.getElementById('editModeBtn');
  const viewModePanel = document.getElementById('metaViewMode');
  const editModePanel = document.getElementById('metaEditMode');
  const actionsFooter = document.getElementById('metaActionsFooter');

  if (mode === 'view') {
    // Update button states
    viewModeBtn.classList.add('bg-indigo-100', 'text-indigo-700');
    viewModeBtn.classList.remove('text-gray-600', 'hover:bg-gray-100');
    editModeBtn.classList.remove('bg-indigo-100', 'text-indigo-700');
    editModeBtn.classList.add('text-gray-600', 'hover:bg-gray-100');

    // Show view mode, hide edit mode
    viewModePanel.classList.remove('hidden');
    editModePanel.classList.add('hidden');
    actionsFooter.classList.add('hidden');
  } else {
    // Update button states
    editModeBtn.classList.add('bg-indigo-100', 'text-indigo-700');
    editModeBtn.classList.remove('text-gray-600', 'hover:bg-gray-100');
    viewModeBtn.classList.remove('bg-indigo-100', 'text-indigo-700');
    viewModeBtn.classList.add('text-gray-600', 'hover:bg-gray-100');

    // Show edit mode, hide view mode
    viewModePanel.classList.add('hidden');
    editModePanel.classList.remove('hidden');
    actionsFooter.classList.remove('hidden');
  }
}

function trackMetadataChanges() {
  const docType = document.getElementById('metaDocType');
  const tags = document.getElementById('metaTags');
  const notes = document.getElementById('metaNotes');

  [docType, tags, notes].forEach(el => {
    el.addEventListener('input', () => {
      viewerState.metadataChanged = true;
    });
  });

  // Character count for notes
  notes.addEventListener('input', updateNotesCount);
}

function updateNotesCount() {
  const notes = document.getElementById('metaNotes');
  const count = document.getElementById('metaNotesCount');
  count.textContent = notes.value.length;
}

async function saveMetadata() {
  if (!viewerState.currentFile) return;

  const saveBtn = document.getElementById('metaSaveBtn');
  const originalText = saveBtn.textContent;

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const metadata = {
      document_type: document.getElementById('metaDocType').value,
      tags: document.getElementById('metaTags').value,
      notes: document.getElementById('metaNotes').value
    };

    const response = await api.patch(
      `/api/v1/storage/files/${viewerState.currentFile.id}/metadata`,
      metadata
    );

    if (response.success || response.status === 'success') {
      viewerState.originalMetadata = metadata;
      viewerState.metadataChanged = false;

      // Update view mode fields
      document.getElementById('metaDocTypeView').textContent = formatDocumentType(metadata.document_type) || 'Not specified';
      document.getElementById('metaTagsView').textContent = metadata.tags || 'No tags';
      document.getElementById('metaNotesView').textContent = metadata.notes || 'No notes';

      showSuccessNotification('Metadata saved successfully');

      // Switch back to view mode
      setMetadataMode('view');
    } else {
      throw new Error(response.error || 'Failed to save metadata');
    }
  } catch (error) {
    console.error('[FileViewer] Save metadata error:', error);
    showErrorNotification('Failed to save metadata: ' + error.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

function cancelMetadataChanges() {
  // Restore original values
  document.getElementById('metaDocType').value = viewerState.originalMetadata.document_type;
  document.getElementById('metaTags').value = viewerState.originalMetadata.tags;
  document.getElementById('metaNotes').value = viewerState.originalMetadata.notes;

  viewerState.metadataChanged = false;
  updateNotesCount();

  // Switch back to view mode
  setMetadataMode('view');
}

// ============================================================
// UI HELPERS
// ============================================================
function showViewerLoading() {
  hideAllViewers();
  document.getElementById('viewerLoading').classList.remove('hidden');
}

function hideViewerLoading() {
  document.getElementById('viewerLoading').classList.add('hidden');
}

function showViewerError(message) {
  hideAllViewers();
  const errorDiv = document.getElementById('viewerError');
  const errorMsg = document.getElementById('viewerErrorMsg');
  const errorDownload = document.getElementById('viewerErrorDownload');

  errorMsg.textContent = message;
  errorDiv.classList.remove('hidden');

  if (viewerState.currentFile) {
    errorDownload.href = `/api/v1/storage/files/${viewerState.currentFile.id}/download`;
    errorDownload.download = viewerState.currentFile.filename;
  }

  hideViewerLoading();
}

function hideAllViewers() {
  document.getElementById('viewerLoading').classList.add('hidden');
  document.getElementById('viewerError').classList.add('hidden');
  document.getElementById('viewerIframe').classList.add('hidden');
  document.getElementById('viewerText').classList.add('hidden');
  document.getElementById('viewerImage').classList.add('hidden');
}

function closeFileViewer() {
  // Check if metadata changed
  if (viewerState.metadataChanged) {
    if (!confirm('You have unsaved changes. Close anyway?')) {
      return;
    }
  }

  const modal = document.getElementById('documentViewerModal');
  modal.classList.add('hidden');

  // Reset state
  viewerState.currentFile = null;
  viewerState.originalMetadata = {};
  viewerState.metadataChanged = false;

  // Clear content
  hideAllViewers();
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatMimeType(mimeType) {
  if (!mimeType) return 'Unknown';

  // Common MIME types map
  const mimeTypeMap = {
    // Documents
    'application/pdf': 'PDF Document',
    'application/msword': 'Word Document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Document',
    'application/vnd.ms-excel': 'Excel Spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Spreadsheet',
    'application/vnd.ms-powerpoint': 'PowerPoint Presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint Presentation',

    // Text files
    'text/plain': 'Text File',
    'text/html': 'HTML Document',
    'text/css': 'CSS File',
    'text/javascript': 'JavaScript File',
    'application/json': 'JSON File',
    'text/csv': 'CSV File',
    'text/xml': 'XML File',
    'application/xml': 'XML File',

    // Images
    'image/jpeg': 'JPEG Image',
    'image/png': 'PNG Image',
    'image/gif': 'GIF Image',
    'image/svg+xml': 'SVG Image',
    'image/webp': 'WebP Image',
    'image/bmp': 'Bitmap Image',
    'image/tiff': 'TIFF Image',

    // Archives
    'application/zip': 'ZIP Archive',
    'application/x-rar-compressed': 'RAR Archive',
    'application/x-7z-compressed': '7-Zip Archive',
    'application/gzip': 'GZIP Archive',

    // Other
    'application/octet-stream': 'Binary File',
    'video/mp4': 'MP4 Video',
    'audio/mpeg': 'MP3 Audio',
  };

  // Check exact match
  if (mimeTypeMap[mimeType]) {
    return mimeTypeMap[mimeType];
  }

  // Try generic patterns
  if (mimeType.startsWith('image/')) {
    return 'Image File';
  }
  if (mimeType.startsWith('video/')) {
    return 'Video File';
  }
  if (mimeType.startsWith('audio/')) {
    return 'Audio File';
  }
  if (mimeType.startsWith('text/')) {
    return 'Text File';
  }

  // Return original MIME type if no match found
  return mimeType;
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Close button
  document.getElementById('closeDocumentViewer')?.addEventListener('click', closeFileViewer);

  // View/Edit mode toggle
  document.getElementById('viewModeBtn')?.addEventListener('click', () => setMetadataMode('view'));
  document.getElementById('editModeBtn')?.addEventListener('click', () => setMetadataMode('edit'));

  // Save metadata
  document.getElementById('metaSaveBtn')?.addEventListener('click', saveMetadata);

  // Cancel metadata changes
  document.getElementById('metaCancelBtn')?.addEventListener('click', cancelMetadataChanges);

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('documentViewerModal');
      if (!modal.classList.contains('hidden')) {
        closeFileViewer();
      }
    }
  });
});

// Export for global access
window.openFileViewer = openFileViewer;
window.closeFileViewer = closeFileViewer;

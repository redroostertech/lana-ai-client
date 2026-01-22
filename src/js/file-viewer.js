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
  metadataChanged: false
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
    downloadBtn.href = `/api/v1/storage/files/${fileId}/download`;
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
  const url = `/api/v1/storage/files/${file.id}/download`;

  iframe.src = url;
  iframe.classList.remove('hidden');

  hideViewerLoading();
}

async function loadImage(file) {
  const img = document.getElementById('viewerImage');
  const url = `/api/v1/storage/files/${file.id}/download`;

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
    const response = await fetch(`/api/v1/storage/files/${file.id}/download`, {
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
  document.getElementById('metaFileType').textContent = file.content_type || 'Unknown';
  document.getElementById('metaUploadedAt').textContent = new Date(file.created_at).toLocaleDateString();

  // Editable fields
  const metadata = file.metadata || {};
  document.getElementById('metaDocType').value = metadata.document_type || '';
  document.getElementById('metaTags').value = metadata.tags || '';
  document.getElementById('metaNotes').value = metadata.notes || '';

  // Update character count
  updateNotesCount();

  // Track changes
  trackMetadataChanges();
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
      showSuccessNotification('Metadata saved successfully');
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

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Close button
  document.getElementById('closeDocumentViewer')?.addEventListener('click', closeFileViewer);

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

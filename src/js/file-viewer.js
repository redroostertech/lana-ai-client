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
  metadataMode: 'view', // 'view' or 'edit'
  documentMetadataViewer: null
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function escapeHtml(text) {
  if (!text) return '';
  var str = String(text);
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&#039;';
    else out += ch;
  }
  return out;
}

function _viewerNotify(message, type) {
  if (typeof Lex !== 'undefined' && Lex.Toast && typeof Lex.Toast[type] === 'function') {
    Lex.Toast[type](message);
  } else if (type === 'success' && typeof showSuccessNotification === 'function') {
    showSuccessNotification(message);
  } else if (type === 'error' && typeof showErrorNotification === 'function') {
    showErrorNotification(message);
  }
}

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
  modal.open = true;

  // Show loading state
  showViewerLoading();

  try {
    // Fetch file details
    const response = await api.get(`/api/v1/storage/files/${fileId}`);

    if (!response || !response.id) {
      throw new Error('File not found');
    }

    // Log file activity for recents tracking (non-blocking)
    api.post(`/api/v1/storage/files/${fileId}/activity`, { event_type: 'opened' })
      .catch(err => console.log('[FileViewer] Activity tracking failed (non-critical):', err));

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

    // Set download button handler
    const downloadBtn = document.getElementById('viewerDownloadBtn');
    downloadBtn.onclick = () => downloadFile(fileId, response.filename);

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
    // Word documents (DOCX, DOC)
    else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword' ||
      ['docx', 'doc'].includes(ext)
    ) {
      await loadDOCX(file);
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
  try {
    const response = await fetch(`${api.baseUrl}/api/v1/storage/files/${file.id}/download`, {
      headers: {
        'Authorization': `Bearer ${api.token}`
      }
    });

    if (!response.ok) throw new Error('Failed to fetch PDF');

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    const iframe = document.getElementById('viewerIframe');
    iframe.src = objectUrl;
    iframe.classList.remove('hidden');

    hideViewerLoading();
  } catch (error) {
    console.error('[FileViewer] PDF load error:', error);
    showViewerError('Failed to load PDF: ' + error.message);
  }
}

async function loadImage(file) {
  try {
    const response = await fetch(`${api.baseUrl}/api/v1/storage/files/${file.id}/download`, {
      headers: {
        'Authorization': `Bearer ${api.token}`
      }
    });

    if (!response.ok) throw new Error('Failed to fetch image');

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    const img = document.getElementById('viewerImage');
    img.src = objectUrl;
    img.onload = () => {
      img.classList.remove('hidden');
      hideViewerLoading();
    };
    img.onerror = () => {
      showViewerError('Failed to load image');
    };
  } catch (error) {
    console.error('[FileViewer] Image load error:', error);
    showViewerError('Failed to load image: ' + error.message);
  }
}

async function loadText(file) {
  try {
    const response = await fetch(`${api.baseUrl}/api/v1/storage/files/${file.id}/download`, {
      headers: {
        'Authorization': `Bearer ${api.token}`
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

async function loadDOCX(file) {
  try {
    // Check if mammoth is available
    if (typeof mammoth === 'undefined') {
      throw new Error('Mammoth library not loaded');
    }

    const response = await fetch(`${api.baseUrl}/api/v1/storage/files/${file.id}/download`, {
      headers: {
        'Authorization': `Bearer ${api.token}`
      }
    });

    if (!response.ok) throw new Error('Failed to fetch file');

    const arrayBuffer = await response.arrayBuffer();
    const container = document.getElementById('viewerDocx');

    // Convert DOCX to HTML using Mammoth with style mapping
    const result = await mammoth.convertToHtml({
      arrayBuffer: arrayBuffer,
      convertImage: mammoth.images.imgElement(function(image) {
        return image.read("base64").then(function(imageBuffer) {
          return {
            src: "data:" + image.contentType + ";base64," + imageBuffer
          };
        });
      }),
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Title'] => h1.document-title:fresh",
        "r[style-name='Strong'] => strong",
        "r[style-name='Emphasis'] => em",
        "table => table.docx-table"
      ]
    });

    container.innerHTML = result.value;
    container.classList.remove('hidden');

    // Log any warnings from mammoth
    if (result.messages && result.messages.length > 0) {
      console.log('[FileViewer] DOCX conversion warnings:', result.messages);
    }

    hideViewerLoading();
  } catch (error) {
    console.error('[FileViewer] DOCX load error:', error);
    showViewerError('Failed to load Word document: ' + error.message);
  }
}

// ============================================================
// FILE DOWNLOAD
// ============================================================
async function downloadFile(fileId, filename) {
  try {
    const response = await fetch(`${api.baseUrl}/api/v1/storage/files/${fileId}/download`, {
      headers: {
        'Authorization': `Bearer ${api.token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    // Create temporary download link
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    _viewerNotify('Download started', 'success');
  } catch (error) {
    console.error('[FileViewer] Download error:', error);
    _viewerNotify(error.message || 'Failed to download file', 'error');
  }
}

// ============================================================
// METADATA HANDLING
// ============================================================
function loadMetadata(file) {
  // File info (read-only)
  document.getElementById('metaFileSize').textContent = formatFileSize(file.file_size);
  document.getElementById('metaUploadedAt').textContent = new Date(file.created_at).toLocaleDateString();
  document.getElementById('metaChunkCount').textContent = file.chunk_count !== undefined ? file.chunk_count.toLocaleString() : '0';

  const metadata = file.metadata || {};

  // Populate View Mode (readonly) — fall back to MIME type when no manual document type
  document.getElementById('metaDocTypeView').textContent = formatDocumentType(metadata.document_type) || formatMimeType(file.content_type) || 'Not specified';

  // Render tags as capsules
  const tagsView = document.getElementById('metaTagsView');
  if (metadata.tags && metadata.tags.trim()) {
    const tags = metadata.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
    if (tags.length > 0) {
      tagsView.innerHTML = tags.map(tag =>
        `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium lex-bg-accent-muted lex-text-accent mr-1 mb-1">${escapeHtml(tag)}</span>`
      ).join('');
    } else {
      tagsView.textContent = 'No tags';
    }
  } else {
    tagsView.textContent = 'No tags';
  }

  document.getElementById('metaNotesView').textContent = metadata.notes || 'No notes';

  // Populate Edit Mode (editable fields)
  document.getElementById('metaDocType').value = metadata.document_type || '';
  document.getElementById('metaTags').value = metadata.tags || '';
  document.getElementById('metaNotes').value = metadata.notes || '';

  // Track changes
  trackMetadataChanges();

  // Initialize in view mode
  setMetadataMode('view');

  // Reposition segmented indicator after modal is visible (getBoundingClientRect
  // returns zeros while the element is hidden, so defer until next paint)
  var toggle = document.getElementById('metaModeToggle');
  if (toggle && typeof toggle._positionIndicator === 'function') {
    requestAnimationFrame(function () { toggle._positionIndicator(); });
  }
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

  const toggle = document.getElementById('metaModeToggle');
  const viewModePanel = document.getElementById('metaViewMode');
  const editModePanel = document.getElementById('metaEditMode');
  const actionsFooter = document.getElementById('metaActionsFooter');

  // Keep segmented control in sync (e.g. when called from cancelMetadataChanges)
  if (toggle && toggle.value !== mode) {
    toggle.value = mode;
  }

  if (mode === 'view') {
    viewModePanel.classList.remove('hidden');
    editModePanel.classList.add('hidden');
    actionsFooter.classList.add('hidden');
  } else {
    viewModePanel.classList.add('hidden');
    editModePanel.classList.remove('hidden');
    actionsFooter.classList.remove('hidden');
  }
}

function trackMetadataChanges() {
  var docType = document.getElementById('metaDocType');
  var tags = document.getElementById('metaTags');
  var notes = document.getElementById('metaNotes');

  // Lex form components fire 'lex-change'; fall back to 'input' for plain elements
  [docType, tags, notes].forEach(function (el) {
    if (!el) return;
    var evt = (el.tagName && el.tagName.indexOf('LEX-') === 0) ? 'lex-change' : 'input';
    el.addEventListener(evt, function () {
      viewerState.metadataChanged = true;
    });
  });
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

      // Render tags as capsules
      const tagsView = document.getElementById('metaTagsView');
      if (metadata.tags && metadata.tags.trim()) {
        const tags = metadata.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
        if (tags.length > 0) {
          tagsView.innerHTML = tags.map(tag =>
            `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium lex-bg-accent-muted lex-text-accent mr-1 mb-1">${escapeHtml(tag)}</span>`
          ).join('');
        } else {
          tagsView.textContent = 'No tags';
        }
      } else {
        tagsView.textContent = 'No tags';
      }

      document.getElementById('metaNotesView').textContent = metadata.notes || 'No notes';

      _viewerNotify('Metadata saved successfully', 'success');

      // Switch back to view mode
      setMetadataMode('view');
    } else {
      throw new Error(response.error || 'Failed to save metadata');
    }
  } catch (error) {
    console.error('[FileViewer] Save metadata error:', error);
    _viewerNotify('Failed to save metadata: ' + error.message, 'error');
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
    errorDownload.onclick = () => downloadFile(viewerState.currentFile.id, viewerState.currentFile.filename);
  }

  hideViewerLoading();
}

function hideAllViewers() {
  document.getElementById('viewerLoading').classList.add('hidden');
  document.getElementById('viewerError').classList.add('hidden');
  document.getElementById('viewerIframe').classList.add('hidden');
  document.getElementById('viewerText').classList.add('hidden');
  document.getElementById('viewerImage').classList.add('hidden');
  document.getElementById('viewerDocx').classList.add('hidden');
  var tableEl = document.getElementById('viewerTable');
  if (tableEl) tableEl.classList.add('hidden');
}

function closeFileViewer() {
  // Check if metadata changed
  if (viewerState.metadataChanged) {
    if (!confirm('You have unsaved changes. Close anyway?')) {
      return;
    }
  }

  const modal = document.getElementById('documentViewerModal');
  modal.open = false;

  // Destroy DocumentMetadataViewer instance
  if (viewerState.documentMetadataViewer) {
    viewerState.documentMetadataViewer.destroy();
    viewerState.documentMetadataViewer = null;
  }

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

  // View/Edit mode toggle (lex-segmented)
  document.getElementById('metaModeToggle')?.addEventListener('lex-change', (e) => setMetadataMode(e.detail.value));

  // Save metadata
  document.getElementById('metaSaveBtn')?.addEventListener('click', saveMetadata);

  // Cancel metadata changes
  document.getElementById('metaCancelBtn')?.addEventListener('click', cancelMetadataChanges);

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('documentViewerModal');
      if (modal && modal.open) {
        closeFileViewer();
      }
    }
  });
});

// Export for global access
window.openFileViewer = openFileViewer;
window.closeFileViewer = closeFileViewer;

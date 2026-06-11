/**
 * folder.js - Folder view page script (SPA lifecycle).
 * Handles viewing files and subfolders inside a matter.
 * Extracted from drive.js - matter-view branch only, no root/matter branching.
 *
 * Dependencies (loaded via page descriptor before this file):
 *   - lex.utils.js   (escapeHtml, formatFileSize, formatRelativeDate, getFileType)
 *   - lex.icons.js   (getFileIcon, getFileIconSmall, getFileIconSVG)
 *   - lex-nav.js     (Lex.Nav.go - navigates to file-viewer.html)
 */
(function () {
  'use strict';

  // ── Lifecycle tracking ──────────────────────────────────────────────

  var _intervals = [];
  var _timeouts = [];
  var _globalFns = [];
  var _documentListeners = [];

  /**
   * Register a window global and track it for cleanup on onLeave.
   * @param {string} name
   * @param {Function} fn
   */
  function exposeGlobal(name, fn) {
    window[name] = fn;
    _globalFns.push(name);
  }

  /**
   * Add a document-level event listener and track it for cleanup on onLeave.
   * @param {string} event
   * @param {Function} handler
   */
  function trackDocListener(event, handler) {
    document.addEventListener(event, handler);
    _documentListeners.push({ event: event, handler: handler });
  }

  // ── Page state ──────────────────────────────────────────────────────

  var folderState = {
    currentMatterId: null,
    currentMatterName: null,
    currentFolderId: null,
    currentFolderPath: [],
    viewMode: 'list',
    folders: [],
    files: [],
    loadingContent: false,
    searchQuery: '',
    sortBy: 'name',
    sortOrder: 'asc'
  };

  // Temporary state for pending file upload
  var pendingUploadFiles = null;

  // Mounted MatterDocumentsView instance (renders the current folder's FILES).
  // folder.js keeps subfolder rendering/navigation; the component owns files.
  var documentsView = null;

  // ── State reset ─────────────────────────────────────────────────────

  /**
   * Reset folderState to its default values.
   * Called on each onEnter to ensure a clean slate.
   */
  function resetState() {
    folderState = {
      currentMatterId: null,
      currentMatterName: null,
      currentFolderId: null,
      currentFolderPath: [],
      viewMode: 'list',
      folders: [],
      files: [],
      loadingContent: false,
      searchQuery: '',
      sortBy: 'name',
      sortOrder: 'asc'
    };
  }

  // ── Navigation ──────────────────────────────────────────────────────

  /**
   * Navigate to the root drive page via SPA navigation.
   * Used when the Home breadcrumb link is clicked.
   */
  function navigateToRoot() {
    Lex.Nav.go('drive.html');
  }

  /**
   * Navigate into a subfolder within the current matter.
   * Uses history.pushState to stay on folder.html without a full reload.
   * @param {string} folderId
   * @param {string} folderName
   */
  function navigateToFolder(folderId, folderName) {
    console.log('[Folder] Navigating to folder:', folderId, folderName);

    if (!folderState.currentMatterId) {
      console.error('[Folder] Cannot navigate to folder without matter_id');
      Lex.Toast.error('Cannot navigate to folder. Please select a matter first.');
      return;
    }

    var urlParams = new URLSearchParams();
    urlParams.set('matter_id', folderState.currentMatterId);
    if (folderState.currentMatterName) {
      urlParams.set('matter_name', folderState.currentMatterName);
    }
    if (folderId && folderId !== 'root') {
      urlParams.set('folder_id', folderId);
    }

    history.pushState({}, '', 'folder.html?' + urlParams.toString());

    folderState.currentFolderId = folderId === 'root' ? null : folderId;

    buildFolderPath();
    loadFolderContents();
  }

  /**
   * Navigate to a matter's root from a breadcrumb click (clears folder context).
   * Stays on folder.html via pushState rather than navigating to drive.html.
   * @param {string} matterId
   * @param {string} matterName
   */
  function navigateToMatterBreadcrumb(matterId, matterName) {
    folderState.currentMatterId = matterId;
    folderState.currentMatterName = matterName;
    folderState.currentFolderId = null;
    folderState.currentFolderPath = [];

    var params = new URLSearchParams({
      matter_id: matterId,
      matter_name: matterName
    });
    history.pushState({}, '', 'folder.html?' + params.toString());

    renderBreadcrumbs();
    loadFolderContents();
  }

  /**
   * Build the breadcrumb folder path array from folderState.folders.
   * Populates folderState.currentFolderPath then calls renderBreadcrumbs().
   */
  function buildFolderPath() {
    folderState.currentFolderPath = [];

    if (folderState.currentFolderId) {
      var currentId = folderState.currentFolderId;
      while (currentId) {
        var folder = null;
        for (var i = 0; i < folderState.folders.length; i++) {
          if (folderState.folders[i].id === currentId) {
            folder = folderState.folders[i];
            break;
          }
        }
        if (folder) {
          folderState.currentFolderPath.unshift({
            id: folder.id,
            name: folder.name
          });
          currentId = folder.parent_folder_id;
        } else {
          break;
        }
      }
    }

    renderBreadcrumbs();
  }

  /**
   * Render the breadcrumb navigation bar.
   * Home links use navigateToRoot(). Matter links use navigateToMatterBreadcrumb().
   * Folder links use navigateToFolder().
   */
  function renderBreadcrumbs() {
    var breadcrumbsEl = document.getElementById('breadcrumbs');
    if (!breadcrumbsEl) return;

    breadcrumbsEl.classList.remove('hidden');

    var matterName = folderState.currentMatterName || folderState.currentMatterId;

    var html = '<a href="#" onclick="navigateToRoot(); return false;" class="cursor-pointer" style="color: var(--lex-text-secondary)">Home</a>';

    html += '<span class="breadcrumb-separator">/</span>';
    if (!folderState.currentFolderId) {
      html += '<span class="font-medium" style="color: var(--lex-text-primary)">' + escapeHtml(matterName) + '</span>';
    } else {
      html += '<a href="#" onclick="navigateToMatterBreadcrumb(' + JSON.stringify(folderState.currentMatterId) + ', ' + JSON.stringify(matterName) + '); return false;" class="cursor-pointer" style="color: var(--lex-text-secondary)">' + escapeHtml(matterName) + '</a>';
    }

    folderState.currentFolderPath.forEach(function (folder, index) {
      html += '<span class="breadcrumb-separator">/</span>';
      if (index === folderState.currentFolderPath.length - 1) {
        html += '<span class="font-medium" style="color: var(--lex-text-primary)">' + escapeHtml(folder.name) + '</span>';
      } else {
        html += '<a href="#" style="color: var(--lex-text-secondary)" onclick="navigateToFolder(' + JSON.stringify(folder.id) + ', ' + JSON.stringify(folder.name) + '); return false;">' + escapeHtml(folder.name) + '</a>';
      }
    });

    breadcrumbsEl.innerHTML = html;
  }

  /**
   * Handle a subfolder card click using data attributes.
   * Only handles subfolders on this page (no matter-level branching needed).
   * @param {HTMLElement} element - The clicked element with data attributes
   */
  function handleFolderClick(element) {
    console.log('[Folder] handleFolderClick called', {
      dataset: element.dataset,
      folderId: element.dataset.folderId,
      name: element.dataset.name,
      currentMatterId: folderState.currentMatterId,
      currentFolderId: folderState.currentFolderId
    });

    var folderId = element.dataset.folderId;
    var name = element.dataset.name;

    if (!folderId) {
      console.error('[Folder] No folder ID found in dataset');
      Lex.Toast.error('Cannot navigate: missing folder ID');
      return;
    }

    console.log('[Folder] Navigating to folder:', folderId, name);
    navigateToFolder(folderId, name);
  }

  // ── Content loading ─────────────────────────────────────────────────

  /**
   * Update the results count text element based on current state.
   * Only shows the matter-view branch: folder count + file count.
   */
  function updateResultsCount() {
    var resultsCountEl = document.getElementById('resultsCount');
    if (!resultsCountEl) return;

    var folderCount = folderState.folders.filter(function (f) {
      if (!folderState.currentFolderId) {
        return !f.parent_folder_id;
      }
      return f.parent_folder_id === folderState.currentFolderId;
    }).length;
    var fileCount = folderState.files.length;
    var total = folderCount + fileCount;

    if (total === 0) {
      resultsCountEl.textContent = 'Empty folder';
    } else {
      var parts = [];
      if (fileCount > 0) parts.push(fileCount + ' file' + (fileCount !== 1 ? 's' : ''));
      if (folderCount > 0) parts.push(folderCount + ' folder' + (folderCount !== 1 ? 's' : ''));
      resultsCountEl.textContent = parts.join(' \u2022 ');
    }
  }

  /**
   * Load all folder/file contents for the current matter-scoped state.
   * Matter-view branch only: fetches folders from storage/folders and
   * files from storage/files. Supports { silent: true } to skip loading spinner.
   * @param {Object} [opts]
   * @param {boolean} [opts.silent]
   */
  async function loadFolderContents(opts) {
    var silent = opts && opts.silent;
    console.log('[Folder] Loading folder contents:', folderState.currentFolderId, silent ? '(silent)' : '');
    folderState.loadingContent = true;

    var loadingEl = document.getElementById('contentLoading');
    var contentsEl = document.getElementById('folderContents');
    var emptyEl = document.getElementById('contentEmpty');

    if (!silent) {
      loadingEl && loadingEl.classList.remove('hidden');
      contentsEl && contentsEl.classList.add('hidden');
      emptyEl && emptyEl.classList.add('hidden');
    }

    try {
      // Fetch all folders for this matter (used for tree + breadcrumb building)
      var foldersResponse = await api.get('/api/v1/storage/folders?matter_id=' + folderState.currentMatterId);

      if (foldersResponse.status === 'success' || foldersResponse.data || foldersResponse.folders) {
        folderState.folders = (foldersResponse.data && foldersResponse.data.folders) || foldersResponse.folders || [];
      } else {
        console.warn('[Folder] Failed to load folders:', foldersResponse.error);
        folderState.folders = [];
      }

      // Build file query params
      var fileParams = new URLSearchParams({
        matter_id: folderState.currentMatterId
      });

      if (folderState.currentFolderId) {
        fileParams.append('folder_id', folderState.currentFolderId);
      }

      if (folderState.searchQuery) {
        fileParams.append('search', folderState.searchQuery);
      }

      var filesResponse = await api.get('/api/v1/storage/files?' + fileParams.toString());

      if (filesResponse.files || filesResponse.data || filesResponse.status === 'success') {
        folderState.files = (filesResponse.data && filesResponse.data.files) || filesResponse.files || [];
        buildFolderPath();
        updateResultsCount();
        renderFolderContents();
      } else {
        throw new Error(filesResponse.error || 'Failed to load folder contents');
      }
    } catch (error) {
      console.error('[Folder] Failed to load folder contents:', error);
      Lex.Toast.error('Failed to load files. Please try again.');

      loadingEl && loadingEl.classList.add('hidden');
      emptyEl && emptyEl.classList.remove('hidden');
    } finally {
      folderState.loadingContent = false;
    }
  }

  // ── Rendering (grid + list) ─────────────────────────────────────────

  /**
   * Render folder/file contents based on folderState.viewMode.
   * Filters folders to only show items at the current depth.
   *
   * Folders and files share ONE region (#folderContents): subfolder cards/rows
   * render first into #folderItems, then the MatterDocumentsView component
   * renders the file cards/rows into #matterDocumentsViewHost directly below.
   * The lf-view-grid / lf-view-list modifier on #folderContents makes both
   * sections form one continuous grid (grid mode) or table (list mode); the
   * grid/list toggle switches that modifier so it affects folders + files at
   * once (instance.setViewMode keeps the file section in sync).
   */
  function renderFolderContents() {
    var loadingEl = document.getElementById('contentLoading');
    var contentsEl = document.getElementById('folderContents');
    var emptyEl = document.getElementById('contentEmpty');

    loadingEl && loadingEl.classList.add('hidden');

    // Filter subfolders at current depth only
    var foldersToShow = folderState.folders.filter(function (f) {
      if (!folderState.currentFolderId) {
        return !f.parent_folder_id;
      }
      return f.parent_folder_id === folderState.currentFolderId;
    });

    var totalItems = foldersToShow.length + folderState.files.length;

    // Apply the active view-mode modifier so folders + files share one layout.
    applyViewModeClass();

    if (totalItems === 0) {
      emptyEl && emptyEl.classList.remove('hidden');
      contentsEl && contentsEl.classList.add('hidden');
      // Keep the component mounted/in-sync even when empty so a later refresh
      // works. Clear any stale folder items from the shared region.
      renderFolderItems([]);
      ensureDocumentsView();
      if (documentsView) {
        documentsView.refresh(folderState.files);
      }
      return;
    }

    emptyEl && emptyEl.classList.add('hidden');
    contentsEl && contentsEl.classList.remove('hidden');

    var sortedFolders = foldersToShow.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    // Folders render first (top of the shared region) ...
    renderFolderItems(sortedFolders);

    // ... then the component renders the file cards/rows below them, in the
    // same view mode. setViewMode + refresh re-render the file section.
    ensureDocumentsView();
    if (documentsView) {
      documentsView.setViewMode(folderState.viewMode);
      documentsView.refresh(folderState.files);
    }
  }

  /**
   * Toggle the lf-view-grid / lf-view-list modifier on the shared region so
   * folders and files share one grid (grid mode) or table (list mode).
   */
  function applyViewModeClass() {
    var contentsEl = document.getElementById('folderContents');
    if (!contentsEl) return;
    var grid = folderState.viewMode === 'grid';
    contentsEl.classList.toggle('lf-view-grid', grid);
    contentsEl.classList.toggle('lf-view-list', !grid);
  }

  /**
   * Mount the MatterDocumentsView component once. The component OWNS the file
   * list rendering and every per-file action (Open / Download / Rename /
   * Delete), and re-fetches via the api after each mutation. Files render into
   * #matterDocumentsViewHost, directly below the folder cards/rows.
   */
  function ensureDocumentsView() {
    var docsHostEl = document.getElementById('matterDocumentsViewHost');
    if (!docsHostEl || !window.MatterDocumentsView) return;

    if (!documentsView) {
      documentsView = window.MatterDocumentsView.mount(docsHostEl, {
        api: window.api,
        matterId: folderState.currentMatterId,
        matterDisplayId: folderState.currentMatterName || folderState.currentMatterId,
        files: folderState.files,
        viewMode: folderState.viewMode,
        pageSize: 12,
        onFileOpen: function (fileId) { _navToFileViewer(fileId); },
        onCreateDocStudio: function () {
          if (folderState.currentMatterId) {
            Lex.Nav.go('doc-studio/index.html', {
              params: { matter_id: folderState.currentMatterId }
            });
          } else {
            Lex.Nav.go('doc-studio/index.html');
          }
        },
        // Library defaults: rename on; advanced matter-only features off.
        enableRename: true,
        enableTemplates: false,
        enableOrphans: false,
        enableWorkflow: false,
        enableBatch: false,
        enableTemplateToggle: false,
        enableRetry: false,
        enableReplace: false
      });
    }
  }

  /**
   * Render the subfolder cards (grid mode) or rows (list mode) into the shared
   * #folderItems container. Files are rendered separately by the
   * MatterDocumentsView component, directly below these folders.
   * @param {Array} folders
   */
  function renderFolderItems(folders) {
    var folderItemsEl = document.getElementById('folderItems');
    if (!folderItemsEl) return;

    if (folderState.viewMode === 'grid') {
      folderItemsEl.className = 'lf-grid';
      folderItemsEl.innerHTML = folders.map(folderCardHtml).join('');
    } else {
      folderItemsEl.className = 'lf-list';
      folderItemsEl.innerHTML = folders.map(folderRowHtml).join('');
    }
  }

  /**
   * Subfolder grid card markup (grid mode).
   * @param {Object} folder
   */
  function folderCardHtml(folder) {
    return [
      '<div class="lf-card" data-folder-id="' + escapeHtml(folder.id) + '" data-name="' + escapeHtml(folder.name) + '" onclick="handleFolderClick(this)">',
      '  <button class="lf-card-menu" onclick="event.stopPropagation(); showFolderMenu(' + JSON.stringify(folder.id) + ', event)" title="Folder actions">',
      '    <svg class="lf-icon-sm" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
      '  </button>',
      '  <div class="lf-card-body">',
      '    <svg class="lf-card-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
      '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
      '    </svg>',
      '    <h3 class="lf-card-name">' + escapeHtml(folder.name) + '</h3>',
      '    <p class="lf-card-sub">' + (folder.document_count || 0) + ' files</p>',
      '  </div>',
      '</div>'
    ].join('');
  }

  /**
   * Subfolder list row markup (list mode). Mirrors the shared table columns.
   * @param {Object} folder
   */
  function folderRowHtml(folder) {
    return [
      '<div class="lf-row" data-folder-id="' + escapeHtml(folder.id) + '" data-name="' + escapeHtml(folder.name) + '" onclick="handleFolderClick(this)">',
      '  <div class="lf-row-name">',
      '    <svg class="lf-row-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
      '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
      '    </svg>',
      '    <span class="lf-row-label">' + escapeHtml(folder.name) + '</span>',
      '  </div>',
      '  <div class="lf-row-cell">-</div>',
      '  <div class="lf-row-cell">' + formatRelativeDate(folder.created_at) + '</div>',
      '  <div class="lf-row-cell">' + (folder.document_count || 0) + ' items</div>',
      '  <div class="lf-row-cell lf-row-actions">',
      '    <button class="lf-row-menu" onclick="event.stopPropagation(); showFolderMenu(' + JSON.stringify(folder.id) + ', event)" title="Folder actions">',
      '      <svg class="lf-icon-sm" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
      '    </button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // ── View toggle ─────────────────────────────────────────────────────

  /**
   * Switch between grid and list view modes.
   * @param {string} mode - 'grid' or 'list'
   */
  function switchView(mode) {
    folderState.viewMode = mode;

    var gridBtn = document.getElementById('gridViewBtn');
    var listBtn = document.getElementById('listViewBtn');

    // lex-btn: switch variant to indicate active view (primary = active, ghost = inactive)
    if (mode === 'grid') {
      gridBtn && (gridBtn.variant = 'primary');
      listBtn && (listBtn.variant = 'ghost');
    } else {
      listBtn && (listBtn.variant = 'primary');
      gridBtn && (gridBtn.variant = 'ghost');
    }

    renderFolderContents();
  }

  // ── New folder modal ─────────────────────────────────────────────────

  /**
   * Show the new folder creation modal and focus the name input.
   */
  function showNewFolderModal() {
    var modal = document.getElementById('newFolderModal');
    if (modal) modal.open = true;
    // Focus the lex-input's inner input after modal opens
    setTimeout(function () {
      var lexInput = document.getElementById('folderNameInput');
      var inner = lexInput && lexInput.querySelector('input');
      inner && inner.focus();
    }, 100);
  }

  /**
   * Hide the new folder creation modal and clear its input.
   */
  function hideNewFolderModal() {
    var modal = document.getElementById('newFolderModal');
    if (modal) modal.open = false;
    var lexInput = document.getElementById('folderNameInput');
    if (lexInput) lexInput.value = '';
  }

  /**
   * Handle new folder form submission. Creates a subfolder within the current matter.
   * @param {Event} event
   */
  async function handleCreateFolder(event) {
    event.preventDefault();

    var lexInput = document.getElementById('folderNameInput');
    var folderName = lexInput ? (lexInput.value || '').trim() : '';

    if (!folderName) {
      Lex.Toast.error('Please enter a folder name');
      return;
    }

    if (folderName.length > 255) {
      Lex.Toast.error('Folder name must be 255 characters or less');
      return;
    }

    try {
      var response = await api.post('/api/v1/storage/folders', {
        name: folderName,
        matter_id: folderState.currentMatterId,
        parent_folder_id: folderState.currentFolderId || null
      });

      if (response.status === 'success') {
        Lex.Toast.success('Folder created successfully');
        hideNewFolderModal();
        await loadFolderContents();
      } else {
        console.error('[Folder] API returned error:', response);
        throw new Error(response.error || 'Failed to create folder');
      }
    } catch (error) {
      console.error('[Folder] Failed to create folder:', error);
      Lex.Toast.error('Failed to create folder. Please try again.');
    }
  }

  // ── File upload with hints ───────────────────────────────────────────

  /**
   * Handle file input change event. Routes to single or bulk upload modal.
   * @param {Event} event
   */
  function handleFileSelection(event) {
    var files = event.target.files;
    if (!files || files.length === 0) return;

    pendingUploadFiles = Array.from(files);
    console.log('[Folder] Files selected:', pendingUploadFiles.length);

    if (pendingUploadFiles.length === 1) {
      showSingleUploadModal(pendingUploadFiles[0]);
    } else {
      showBulkUploadModal(pendingUploadFiles);
    }
  }

  /**
   * Show the single file upload modal and populate file details.
   * @param {File} file
   */
  function showSingleUploadModal(file) {
    var modal = document.getElementById('uploadSingleFileModal');
    var fileNameEl = document.getElementById('singleFileName');
    var fileSizeEl = document.getElementById('singleFileSize');
    var signaturesCheckbox = document.getElementById('singleHasSignatures');
    var formsCheckbox = document.getElementById('singleHasForms');

    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) fileSizeEl.textContent = formatFileSize(file.size);

    // lex-checkbox: reset via the .checked property on the component element
    if (signaturesCheckbox) signaturesCheckbox.checked = false;
    if (formsCheckbox) formsCheckbox.checked = false;

    if (modal) modal.open = true;
  }

  /**
   * Hide and reset the single file upload modal.
   */
  function hideSingleUploadModal() {
    var modal = document.getElementById('uploadSingleFileModal');
    if (modal) modal.open = false;

    pendingUploadFiles = null;
    var fileInput = document.getElementById('fileUploadInput');
    if (fileInput) fileInput.value = '';
  }

  /**
   * Execute single file upload with user-specified processing hints.
   */
  async function handleSingleFileUploadWithHints() {
    if (!pendingUploadFiles || pendingUploadFiles.length !== 1) {
      Lex.Toast.error('No file selected');
      return;
    }

    var file = pendingUploadFiles[0];
    var signaturesCheckbox = document.getElementById('singleHasSignatures');
    var formsCheckbox = document.getElementById('singleHasForms');
    var hasSignatures = signaturesCheckbox ? signaturesCheckbox.checked : false;
    var hasForms = formsCheckbox ? formsCheckbox.checked : false;

    console.log('[Folder] Uploading file with hints:', {
      filename: file.name,
      hasSignatures: hasSignatures,
      hasForms: hasForms
    });

    hideSingleUploadModal();
    Lex.Toast.info('Uploading file...');

    try {
      await api._readyPromise;

      var formData = new FormData();
      formData.append('file', file);
      formData.append('matter_id', folderState.currentMatterId);
      if (folderState.currentFolderId) {
        formData.append('folder_id', folderState.currentFolderId);
      }

      if (hasSignatures || hasForms) {
        var hints = {};
        if (hasSignatures) hints.hasSignatures = true;
        if (hasForms) hints.hasForms = true;
        formData.append('hints', JSON.stringify(hints));
      }

      var response = await fetch(api.baseUrl + '/api/v1/storage/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + api.token
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed: ' + response.status);
      }

      var result = await response.json();
      console.log('[Folder] Upload successful:', result);

      Lex.Toast.success('File uploaded successfully');

      if (window.FeatureTracker) {
        try {
          await window.FeatureTracker.trackFeature(window.Features.DOCUMENT_UPLOADED, {
            file_type: file.type || 'unknown',
            file_size: file.size,
            matter_id: folderState.currentMatterId,
            folder_id: folderState.currentFolderId || null,
            has_hints: !!(hasSignatures || hasForms)
          });
        } catch (trackError) {
          console.error('[FeatureTracker] Failed to track upload:', trackError);
        }
      }

      await loadFolderContents();
    } catch (error) {
      console.error('[Folder] Failed to upload file:', error);
      Lex.Toast.error('Failed to upload file. Please try again.');
    }
  }

  /**
   * Show the bulk upload modal with a grid of file rows.
   * @param {File[]} files
   */
  function showBulkUploadModal(files) {
    var modal = document.getElementById('bulkUploadModal');
    var gridBodyEl = document.getElementById('bulkUploadGridBody');

    var rows = files.map(function (file, index) {
      return [
        '<tr>',
        '  <td class="px-4 py-3 text-sm" style="color: var(--lex-text-primary)">' + escapeHtml(file.name) + '</td>',
        '  <td class="px-4 py-3 text-sm" style="color: var(--lex-text-secondary)">' + formatFileSize(file.size) + '</td>',
        '  <td class="px-4 py-3 text-sm bulk-doc-type" style="color: var(--lex-text-secondary)" data-index="' + index + '">' + getFileType(file) + '</td>',
        '  <td class="px-4 py-3 text-center"><lex-checkbox class="bulk-signatures-checkbox" data-index="' + index + '"></lex-checkbox></td>',
        '  <td class="px-4 py-3 text-center"><lex-checkbox class="bulk-forms-checkbox" data-index="' + index + '"></lex-checkbox></td>',
        '</tr>'
      ].join('');
    }).join('');

    if (gridBodyEl) gridBodyEl.innerHTML = rows;

    var fileCountEl = document.getElementById('bulkFileCount');
    if (fileCountEl) fileCountEl.textContent = files.length;

    if (modal) modal.open = true;
  }

  /**
   * Hide and reset the bulk upload modal.
   */
  function hideBulkUploadModal() {
    var modal = document.getElementById('bulkUploadModal');
    if (modal) modal.open = false;

    pendingUploadFiles = null;
    var fileInput = document.getElementById('fileUploadInput');
    if (fileInput) fileInput.value = '';
  }

  /**
   * Apply the selected document type from the bulk dropdown to all rows.
   */
  function applyDocTypeToAll() {
    var lexSelect = document.getElementById('bulkApplyDocType');
    var selectedType = lexSelect ? lexSelect.value : '';
    if (!selectedType) {
      Lex.Toast.warning('Please select a document type first');
      return;
    }
    // Find the label from the options attribute
    var label = selectedType;
    try {
      var opts = JSON.parse(lexSelect.getAttribute('options') || '[]');
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === selectedType) { label = opts[i].label; break; }
      }
    } catch (e) { /* use selectedType as fallback */ }
    document.querySelectorAll('.bulk-doc-type').forEach(function (cell) {
      cell.textContent = label;
      cell.dataset.docType = selectedType;
    });
    Lex.Toast.success('Document type applied to all files');
  }

  /**
   * Check all signature hint checkboxes in the bulk upload grid.
   */
  function applySignaturesToAll() {
    document.querySelectorAll('.bulk-signatures-checkbox').forEach(function (checkbox) {
      checkbox.checked = true;
    });
    Lex.Toast.success('Signatures hint checked for all files');
  }

  /**
   * Check all forms hint checkboxes in the bulk upload grid.
   */
  function applyFormsToAll() {
    document.querySelectorAll('.bulk-forms-checkbox').forEach(function (checkbox) {
      checkbox.checked = true;
    });
    Lex.Toast.success('Forms hint checked for all files');
  }

  /**
   * Clear all hint checkboxes and reset doc types in the bulk upload grid.
   */
  function clearAllHints() {
    document.querySelectorAll('.bulk-signatures-checkbox').forEach(function (checkbox) {
      checkbox.checked = false;
    });
    document.querySelectorAll('.bulk-forms-checkbox').forEach(function (checkbox) {
      checkbox.checked = false;
    });
    var select = document.getElementById('bulkApplyDocType');
    if (select) select.value = '';
    Lex.Toast.info('All hints cleared');
  }

  /**
   * Execute bulk upload with per-file processing hints.
   */
  async function handleBulkUploadWithHints() {
    if (!pendingUploadFiles || pendingUploadFiles.length === 0) {
      Lex.Toast.error('No files selected');
      return;
    }

    var filesWithHints = pendingUploadFiles.map(function (file, index) {
      var sigEl = document.querySelector('.bulk-signatures-checkbox[data-index="' + index + '"]');
      var formsEl = document.querySelector('.bulk-forms-checkbox[data-index="' + index + '"]');
      var hasSignatures = sigEl ? sigEl.checked : false;
      var hasForms = formsEl ? formsEl.checked : false;

      var hints = {};
      if (hasSignatures) hints.hasSignatures = true;
      if (hasForms) hints.hasForms = true;

      return {
        file: file,
        hints: Object.keys(hints).length > 0 ? hints : null
      };
    });

    console.log('[Folder] Uploading', filesWithHints.length, 'files with hints');

    hideBulkUploadModal();
    Lex.Toast.info('Uploading ' + filesWithHints.length + ' file(s)...');

    try {
      await api._readyPromise;

      var uploadPromises = filesWithHints.map(function (item) {
        var formData = new FormData();
        formData.append('file', item.file);
        formData.append('matter_id', folderState.currentMatterId);
        if (folderState.currentFolderId) {
          formData.append('folder_id', folderState.currentFolderId);
        }
        if (item.hints) {
          formData.append('hints', JSON.stringify(item.hints));
        }

        return fetch(api.baseUrl + '/api/v1/storage/upload', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + api.token
          },
          body: formData
        });
      });

      var responses = await Promise.all(uploadPromises);
      var failedUploads = responses.filter(function (r) { return !r.ok; });

      if (failedUploads.length > 0) {
        throw new Error(failedUploads.length + ' file(s) failed to upload');
      }

      var results = await Promise.all(responses.map(function (r) { return r.json(); }));
      console.log('[Folder] Bulk upload successful:', results);

      Lex.Toast.success('Successfully uploaded ' + filesWithHints.length + ' file(s)');

      if (window.FeatureTracker) {
        for (var i = 0; i < filesWithHints.length; i++) {
          var item = filesWithHints[i];
          try {
            await window.FeatureTracker.trackFeature(window.Features.DOCUMENT_UPLOADED, {
              file_type: item.file.type || 'unknown',
              file_size: item.file.size,
              matter_id: folderState.currentMatterId,
              folder_id: folderState.currentFolderId || null,
              is_bulk_upload: true
            });
          } catch (trackError) {
            console.error('[FeatureTracker] Failed to track bulk upload:', trackError);
          }
        }
      }

      await loadFolderContents();
    } catch (error) {
      console.error('[Folder] Failed to upload files:', error);
      Lex.Toast.error('Failed to upload files. Please try again.');
    }
  }

  // -- File operations --------------------------------------------------
  //
  // Per-file actions (Open / Download / Rename / Delete) are OWNED by the
  // MatterDocumentsView component (its own kebab menu + component-owned Lex
  // rename modal + injected confirm dialogs). folder.js no longer renders any
  // per-file download/rename/delete wiring or modals.

  // -- Context menu -----------------------------------------------------
  //
  // Per-file actions (Open/Download/Rename/Delete) are owned by the
  // MatterDocumentsView component's own kebab menu. folder.js keeps only the
  // subfolder context menu below.

  /**
   * Show the context menu for a subfolder item.
   * No isMatter pin option - subfolders only.
   * @param {string|Object} folderOrId - Folder object or folder ID string
   * @param {Event} event
   */
  function showFolderMenu(folderOrId, event) {
    console.log('[Folder] Show folder menu:', folderOrId);
    if (event && event.stopPropagation) {
      event.stopPropagation();
    }

    var folder;
    if (typeof folderOrId === 'object') {
      folder = folderOrId;
    } else {
      folder = null;
      for (var i = 0; i < folderState.folders.length; i++) {
        if (folderState.folders[i].id === folderOrId) {
          folder = folderState.folders[i];
          break;
        }
      }
    }

    if (!folder) return;

    var menuItems = [
      {
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
        label: 'Open',
        action: function () {
          hideContextMenu();
          navigateToFolder(folder.id, folder.name);
        }
      },
      {
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>',
        label: 'Rename',
        action: function () {
          hideContextMenu();
          Lex.Toast.info('Rename feature coming soon!');
        }
      },
      { divider: true },
      {
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>',
        label: 'Delete',
        className: 'text-red-600 hover:bg-red-50',
        action: function () {
          hideContextMenu();
          Lex.Toast.info('Delete feature coming soon!');
        }
      }
    ];

    showContextMenu(menuItems, event);
  }

  /**
   * Build and position a generic context menu from an array of menu item descriptors.
   * Actions are stored as temporary window globals (contextMenuAction_N) to support
   * inline onclick handlers.
   * @param {Array} menuItems
   * @param {Event} event
   */
  function showContextMenu(menuItems, event) {
    var menu = document.getElementById('contextMenu');
    if (!menu) return;

    var menuHTML = menuItems.map(function (item, index) {
      if (item.divider) {
        return '<div class="my-1" style="border-top: 1px solid var(--lex-border-default)"></div>';
      }

      // Danger items keep their semantic color; default items use Lex tokens
      var isDanger = item.className && item.className.indexOf('red') !== -1;
      var itemStyle = isDanger
        ? 'color: var(--lex-status-danger-text)'
        : 'color: var(--lex-text-primary)';
      var hoverClass = isDanger ? 'context-menu-item--danger' : 'context-menu-item';
      return [
        '<button class="w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors ' + hoverClass + '" style="' + itemStyle + '" onclick="window.contextMenuAction_' + index + '()">',
        '  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + item.icon + '</svg>',
        '  ' + item.label,
        '</button>'
      ].join('');
    }).join('');

    menu.innerHTML = menuHTML;

    menuItems.forEach(function (item, index) {
      if (!item.divider) {
        window['contextMenuAction_' + index] = item.action;
      }
    });

    menu.style.visibility = 'hidden';
    menu.classList.remove('hidden');

    var target = (event && event.currentTarget) || (event && event.target);
    console.log('[Folder] Context menu - event:', event);
    console.log('[Folder] Context menu - target:', target);

    var rect = target ? target.getBoundingClientRect() : null;
    console.log('[Folder] Context menu - rect:', rect);

    if (rect) {
      requestAnimationFrame(function () {
        var menuWidth = menu.offsetWidth || 200;
        var menuHeight = menu.offsetHeight || 100;

        var left = rect.left - menuWidth - 10;
        var top = rect.top;

        if (left < 10) {
          left = rect.right + 10;
        }
        if (top + menuHeight > window.innerHeight - 10) {
          top = window.innerHeight - menuHeight - 10;
        }

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.transform = 'none';
        menu.style.visibility = 'visible';
      });
    } else {
      menu.style.left = '50%';
      menu.style.top = '50%';
      menu.style.transform = 'translate(-50%, -50%)';
      menu.style.visibility = 'visible';
    }

    setTimeout(function () {
      document.addEventListener('click', hideContextMenu);
    }, 0);
  }

  /**
   * Hide the context menu and remove its document click listener.
   */
  function hideContextMenu() {
    var menu = document.getElementById('contextMenu');
    if (menu) {
      menu.classList.add('hidden');
    }
    document.removeEventListener('click', hideContextMenu);
  }

  // File icons are owned by the MatterDocumentsView component (files) and the
  // inline folder SVG in folderCardHtml / folderRowHtml (folders), so folder.js
  // no longer maintains a local getFileIconSVG fallback.

  // -- Event listeners --------------------------------------------------

  /**
   * Wire up all DOM event listeners for the folder page.
   * Uses trackDocListener for document-level events so they are removed on onLeave.
   * No source filter - folder.html only shows matter-scoped content.
   */
  function setupEventListeners() {
    // New Folder button (lex-btn fires native click events)
    var newFolderBtn = document.getElementById('newFolderBtn');
    newFolderBtn && newFolderBtn.addEventListener('click', showNewFolderModal);

    // Empty state upload button - lex-empty fires 'action' event
    var contentEmptyWidget = document.getElementById('contentEmptyWidget');
    contentEmptyWidget && contentEmptyWidget.addEventListener('action', function () {
      var input = document.getElementById('fileUploadInput');
      input && input.click();
    });

    // Empty state Upload action - reuses the existing file picker / upload flow
    var emptyUploadBtn = document.getElementById('emptyUploadBtn');
    emptyUploadBtn && emptyUploadBtn.addEventListener('click', function () {
      var input = document.getElementById('fileUploadInput');
      input && input.click();
    });

    // Empty state Create using Doc Studio action - navigates to Doc Studio,
    // scoped to the current matter when a matter id is available.
    var emptyDocStudioBtn = document.getElementById('emptyDocStudioBtn');
    emptyDocStudioBtn && emptyDocStudioBtn.addEventListener('click', function () {
      if (folderState.currentMatterId) {
        Lex.Nav.go('doc-studio/index.html', {
          params: { matter_id: folderState.currentMatterId }
        });
      } else {
        Lex.Nav.go('doc-studio/index.html');
      }
    });

    var cancelNewFolderBtn = document.getElementById('cancelNewFolderBtn');
    cancelNewFolderBtn && cancelNewFolderBtn.addEventListener('click', hideNewFolderModal);

    var newFolderForm = document.getElementById('newFolderForm');
    newFolderForm && newFolderForm.addEventListener('submit', handleCreateFolder);

    // Per-file Rename and Delete (and their modals/confirm dialogs) are owned by
    // the MatterDocumentsView component, so no per-file modal wiring lives here.

    // Upload button triggers file picker (lex-btn fires native click)
    var uploadBtn = document.getElementById('uploadBtn');
    uploadBtn && uploadBtn.addEventListener('click', function () {
      var input = document.getElementById('fileUploadInput');
      input && input.click();
    });

    // File selection triggers hints modal
    var fileUploadInput = document.getElementById('fileUploadInput');
    fileUploadInput && fileUploadInput.addEventListener('change', handleFileSelection);

    // Single file upload modal (lex-btn fires native click)
    var cancelSingleUploadBtnFooter = document.getElementById('cancelSingleUploadBtnFooter');
    cancelSingleUploadBtnFooter && cancelSingleUploadBtnFooter.addEventListener('click', hideSingleUploadModal);

    var confirmSingleUploadBtn = document.getElementById('confirmSingleUploadBtn');
    confirmSingleUploadBtn && confirmSingleUploadBtn.addEventListener('click', handleSingleFileUploadWithHints);

    // Bulk upload modal (lex-btn fires native click)
    var cancelBulkUploadBtn = document.getElementById('cancelBulkUploadBtn');
    cancelBulkUploadBtn && cancelBulkUploadBtn.addEventListener('click', hideBulkUploadModal);

    var confirmBulkUploadBtn = document.getElementById('confirmBulkUploadBtn');
    confirmBulkUploadBtn && confirmBulkUploadBtn.addEventListener('click', handleBulkUploadWithHints);

    // Bulk upload hint apply buttons (lex-btn fires native click)
    var applyDocTypeBtn = document.getElementById('applyDocTypeBtn');
    applyDocTypeBtn && applyDocTypeBtn.addEventListener('click', applyDocTypeToAll);

    var applySignaturesBtn = document.getElementById('applySignaturesBtn');
    applySignaturesBtn && applySignaturesBtn.addEventListener('click', applySignaturesToAll);

    var applyFormsBtn = document.getElementById('applyFormsBtn');
    applyFormsBtn && applyFormsBtn.addEventListener('click', applyFormsToAll);

    var clearAllHintsBtn = document.getElementById('clearAllHintsBtn');
    clearAllHintsBtn && clearAllHintsBtn.addEventListener('click', clearAllHints);

    // View toggle (lex-btn fires native click)
    var gridViewBtn = document.getElementById('gridViewBtn');
    gridViewBtn && gridViewBtn.addEventListener('click', function () { switchView('grid'); });

    var listViewBtn = document.getElementById('listViewBtn');
    listViewBtn && listViewBtn.addEventListener('click', function () { switchView('list'); });

    // Search with debounce - lex-input fires 'lex-input' event
    var searchLexInput = document.getElementById('searchInput');
    var searchTimeout;

    if (searchLexInput) {
      searchLexInput.addEventListener('lex-input', function (e) {
        var query = e.detail.value || '';
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function () {
          folderState.searchQuery = query;
          loadFolderContents({ silent: true });
        }, 500);
      });

      // lex-change fires on clear
      searchLexInput.addEventListener('lex-change', function (e) {
        var query = e.detail.value || '';
        folderState.searchQuery = query;
        loadFolderContents({ silent: true });
      });
    }

    // Sort by dropdown - lex-select fires 'lex-change'
    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('lex-change', function (e) {
        folderState.sortBy = e.detail.value || 'name';
        loadFolderContents({ silent: true });
      });
    }

    // Sort order toggle (plain button)
    var sortOrderBtn = document.getElementById('sortOrderBtn');
    if (sortOrderBtn) {
      sortOrderBtn.addEventListener('click', function () {
        var currentOrder = sortOrderBtn.dataset.order;
        var newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
        sortOrderBtn.dataset.order = newOrder;
        folderState.sortOrder = newOrder;

        var icon = document.getElementById('sortOrderIcon');
        if (icon) {
          if (newOrder === 'asc') {
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path>';
            sortOrderBtn.title = 'Sort ascending';
          } else {
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h6m3 0h9m-9 4h13m-5 8l-4 4m0 0l-4-4m4 4V8"></path>';
            sortOrderBtn.title = 'Sort descending';
          }
        }

        loadFolderContents({ silent: true });
      });
    }
  }

  // ── Lifecycle hooks ──────────────────────────────────────────────────

  /**
   * Navigate to the dedicated file viewer page.
   * Builds a referrer URL from the current folder context so the viewer
   * can navigate back to this exact folder.
   * @param {string} fileId
   */
  function _navToFileViewer(fileId) {
    var referrerParts = ['folder.html?matter_id=' + encodeURIComponent(folderState.currentMatterId || '')];
    if (folderState.currentMatterName) {
      referrerParts.push('&matter_name=' + encodeURIComponent(folderState.currentMatterName));
    }
    if (folderState.currentFolderId) {
      referrerParts.push('&folder_id=' + encodeURIComponent(folderState.currentFolderId));
    }
    Lex.Nav.go('file-viewer.html', {
      params: { id: fileId },
      context: { referrer: referrerParts.join('') }
    });
  }

  /**
   * Called by LexRouter when navigating to the folder page.
   * Initializes state, parses URL params, redirects if no matter_id,
   * exposes globals, wires events, and loads initial content.
   */
  function onEnter() {
    resetState();

    var urlParams = new URLSearchParams(window.location.search);
    folderState.currentMatterId = urlParams.get('matter_id') || null;
    folderState.currentMatterName = urlParams.get('matter_name') || null;
    folderState.currentFolderId = urlParams.get('folder_id') || null;
    var openFileId = urlParams.get('open_file') || null;

    console.log('[Folder] onEnter - state:', {
      matterId: folderState.currentMatterId,
      matterName: folderState.currentMatterName,
      folderId: folderState.currentFolderId,
      openFileId: openFileId
    });

    // If no matter_id, redirect to drive.html
    if (!folderState.currentMatterId) {
      Lex.Nav.go('drive.html');
      return;
    }

    // Update banner heading
    var banner = document.getElementById('folderBanner');
    if (banner) {
      banner.heading = folderState.currentMatterName || folderState.currentMatterId;
      banner.subtitle = 'Matter: ' + (folderState.currentMatterId || '');
    }

    // Expose all globals needed by inline onclick handlers
    exposeGlobal('handleFolderClick', handleFolderClick);
    exposeGlobal('navigateToFolder', navigateToFolder);
    exposeGlobal('navigateToRoot', navigateToRoot);
    exposeGlobal('navigateToMatterBreadcrumb', navigateToMatterBreadcrumb);
    exposeGlobal('showFolderMenu', showFolderMenu);
    exposeGlobal('_navToFileViewer', _navToFileViewer);

    setupEventListeners();
    renderBreadcrumbs();
    loadFolderContents();

    // Auto-open file viewer if open_file param present
    if (openFileId) {
      setTimeout(function () { _navToFileViewer(openFileId); }, 100);
    }
  }

  /**
   * Called by LexRouter when navigating away from the folder page.
   * Clears all intervals, timeouts, window globals, document listeners,
   * and dynamic contextMenuAction_* globals.
   */
  function onLeave() {
    // Tear down the reusable file-list component (removes its listeners/timers).
    if (documentsView) {
      try { documentsView.destroy(); } catch (e) { /* ignore */ }
      documentsView = null;
    }

    // Reset all module state
    resetState();

    // Clear intervals and timeouts
    _intervals.forEach(clearInterval);
    _timeouts.forEach(clearTimeout);
    _intervals = [];
    _timeouts = [];

    // Remove window globals exposed by this module
    _globalFns.forEach(function (name) {
      window[name] = undefined;
    });
    _globalFns = [];

    // Remove document-level listeners
    _documentListeners.forEach(function (entry) {
      document.removeEventListener(entry.event, entry.handler);
    });
    _documentListeners = [];

    // Reset module-level state
    pendingUploadFiles = null;

    // Ensure context menu listener is removed (not tracked via trackDocListener)
    hideContextMenu();

    // Clean up dynamic contextMenuAction_* globals
    var keysToDelete = [];
    for (var key in window) {
      if (key.indexOf('contextMenuAction_') === 0) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(function (key) {
      delete window[key];
    });

    // Clear search input so it doesn't persist on re-navigation
    var searchEl = document.getElementById('searchInput');
    if (searchEl) searchEl.value = '';
  }

  // ── Register with router ─────────────────────────────────────────────
  // registerPageInit ensures onEnter() is called on every navigation
  // (first load + re-navigation from cached scripts).
  // registerView only carries onLeave for cleanup - onEnter is handled
  // by registerPageInit to avoid double-init.
  if (window.LexRouter) {
    LexRouter.registerPageInit('folder.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      onEnter();
    });
  } else {
    onEnter();
  }

})();

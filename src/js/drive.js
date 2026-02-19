/**
 * drive.js — My Drive page script (SPA lifecycle).
 * Migrated from storage.js.
 * Uses LexRouter.registerView() for onEnter/onLeave lifecycle.
 *
 * Dependencies (loaded via page descriptor before this file):
 *   - lex.utils.js   (escapeHtml, formatFileSize, formatRelativeDate, getFileType)
 *   - lex.icons.js   (getFileIcon, getFileIconSmall, getFileIconSVG)
 *   - file-viewer.js (openFileViewer)
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
  var storageState = {};

  // Temporary state for pending file upload
  var pendingUploadFiles = null;

  // Currently selected matter for the actions modal
  var selectedMatter = null;

  // Conversation actions modal state
  var selectedConversationId = null;
  var selectedConversationTitle = null;
  var selectedConversationIsProject = false;
  var selectedConversationMatterId = null;

  // ── State reset ─────────────────────────────────────────────────────

  /**
   * Reset the storageState object to its default values.
   * Called on each onEnter to ensure a clean slate.
   */
  function resetState() {
    storageState = {
      currentMatterId: null,
      currentMatterName: null,
      currentFolderId: null,
      currentFolderPath: [],
      viewMode: 'grid',
      folders: [],
      files: [],
      loadingFolders: false,
      loadingContent: false,
      searchQuery: '',
      sortBy: 'name',
      sortOrder: 'asc',
      sourceFilter: 'all',
      totalResults: 0,
      currentPage: 1,
      totalPages: 0
    };
  }

  // ── View management ─────────────────────────────────────────────────

  /**
   * Update button visibility based on current view (root vs matter).
   * At root: show New Folder only (creates matters).
   * Inside a matter: show Upload only.
   */
  function updateViewButtons() {
    var uploadBtn = document.getElementById('uploadBtn');
    var newFolderBtn = document.getElementById('newFolderBtn');

    if (storageState.currentMatterId) {
      uploadBtn && uploadBtn.classList.remove('hidden');
      newFolderBtn && newFolderBtn.classList.add('hidden');
    } else {
      uploadBtn && uploadBtn.classList.add('hidden');
      newFolderBtn && newFolderBtn.classList.remove('hidden');
    }
  }

  // ── Event listeners ─────────────────────────────────────────────────

  /**
   * Wire up all DOM event listeners for the drive page.
   * Uses trackDocListener for document-level events so they are removed on onLeave.
   */
  function setupEventListeners() {
    // New Folder buttons
    var newFolderBtn = document.getElementById('newFolderBtn');
    newFolderBtn && newFolderBtn.addEventListener('click', showNewFolderModal);

    var emptyStateNewFolderBtn = document.getElementById('emptyStateNewFolderBtn');
    emptyStateNewFolderBtn && emptyStateNewFolderBtn.addEventListener('click', showNewFolderModal);

    var cancelNewFolderBtn = document.getElementById('cancelNewFolderBtn');
    cancelNewFolderBtn && cancelNewFolderBtn.addEventListener('click', hideNewFolderModal);

    var newFolderForm = document.getElementById('newFolderForm');
    newFolderForm && newFolderForm.addEventListener('submit', handleCreateFolder);

    // Upload button triggers file picker
    var uploadBtn = document.getElementById('uploadBtn');
    uploadBtn && uploadBtn.addEventListener('click', function () {
      var input = document.getElementById('fileUploadInput');
      input && input.click();
    });

    // File selection triggers hints modal
    var fileUploadInput = document.getElementById('fileUploadInput');
    fileUploadInput && fileUploadInput.addEventListener('change', handleFileSelection);

    // Single file upload modal
    var cancelSingleUploadBtn = document.getElementById('cancelSingleUploadBtn');
    cancelSingleUploadBtn && cancelSingleUploadBtn.addEventListener('click', hideSingleUploadModal);

    var confirmSingleUploadBtn = document.getElementById('confirmSingleUploadBtn');
    confirmSingleUploadBtn && confirmSingleUploadBtn.addEventListener('click', handleSingleFileUploadWithHints);

    // Bulk upload modal
    var cancelBulkUploadBtn = document.getElementById('cancelBulkUploadBtn');
    cancelBulkUploadBtn && cancelBulkUploadBtn.addEventListener('click', hideBulkUploadModal);

    var confirmBulkUploadBtn = document.getElementById('confirmBulkUploadBtn');
    confirmBulkUploadBtn && confirmBulkUploadBtn.addEventListener('click', handleBulkUploadWithHints);

    var applyToAllBtn = document.getElementById('applyToAllBtn');
    applyToAllBtn && applyToAllBtn.addEventListener('click', applyHintsToAll);

    // View toggle
    var gridViewBtn = document.getElementById('gridViewBtn');
    gridViewBtn && gridViewBtn.addEventListener('click', function () { switchView('grid'); });

    var listViewBtn = document.getElementById('listViewBtn');
    listViewBtn && listViewBtn.addEventListener('click', function () { switchView('list'); });

    // Search with debounce
    var searchInput = document.getElementById('searchInput');
    var clearSearchBtn = document.getElementById('clearSearchBtn');
    var searchTimeout;

    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        var query = e.target.value;
        clearSearchBtn && clearSearchBtn.classList.toggle('hidden', !query);

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function () {
          storageState.searchQuery = query;
          storageState.currentPage = 1;
          loadFolderContents();
        }, 500);
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', function () {
        if (searchInput) searchInput.value = '';
        storageState.searchQuery = '';
        storageState.currentPage = 1;
        clearSearchBtn.classList.add('hidden');
        loadFolderContents();
      });
    }

    // Sort by dropdown
    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', function (e) {
        storageState.sortBy = e.target.value;
        storageState.currentPage = 1;
        loadFolderContents();
      });
    }

    // Sort order toggle
    var sortOrderBtn = document.getElementById('sortOrderBtn');
    if (sortOrderBtn) {
      sortOrderBtn.addEventListener('click', function () {
        var currentOrder = sortOrderBtn.dataset.order;
        var newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
        sortOrderBtn.dataset.order = newOrder;
        storageState.sortOrder = newOrder;
        storageState.currentPage = 1;

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

        loadFolderContents();
      });
    }

    // Source filter
    var sourceFilter = document.getElementById('sourceFilter');
    if (sourceFilter) {
      sourceFilter.addEventListener('change', function (e) {
        storageState.sourceFilter = e.target.value;
        storageState.currentPage = 1;
        loadFolderContents();
      });
    }
  }

  // ── Folder tree navigation ───────────────────────────────────────────

  /**
   * Load folder tree sidebar (for matter view).
   * Shows all matters at root, or subfolders when inside a matter.
   */
  async function loadFolderTree() {
    console.log('[Drive] Loading folder tree for matter:', storageState.currentMatterId);
    storageState.loadingFolders = true;

    var loadingEl = document.getElementById('folderTreeLoading');
    var treeEl = document.getElementById('folderTree');
    var emptyEl = document.getElementById('folderTreeEmpty');

    loadingEl && loadingEl.classList.remove('hidden');
    treeEl && treeEl.classList.add('hidden');
    emptyEl && emptyEl.classList.add('hidden');

    try {
      if (!storageState.currentMatterId) {
        var response = await api.get('/api/v1/matters?status=active&limit=100');

        if (response.matters) {
          storageState.folders = response.matters.map(function (matter) {
            return {
              id: matter.id,
              name: matter.name || matter.matter_id,
              matter_id: matter.matter_id,
              isMatter: true,
              document_count: 0,
              child_folder_count: 0
            };
          });
          renderFolderTree();
        } else {
          throw new Error(response.error || 'Failed to load matters');
        }
      } else {
        var response = await api.get('/api/v1/storage/folders?matter_id=' + storageState.currentMatterId);

        if (response.status === 'success' || response.data) {
          storageState.folders = (response.data && response.data.folders) || response.folders || [];
          renderFolderTree();
        } else {
          throw new Error(response.error || 'Failed to load folders');
        }
      }
    } catch (error) {
      console.error('[Drive] Failed to load folder tree:', error);
      Lex.Toast.error('Failed to load folders. Please try again.');

      loadingEl && loadingEl.classList.add('hidden');
      emptyEl && emptyEl.classList.remove('hidden');
    } finally {
      storageState.loadingFolders = false;
    }
  }

  /**
   * Render the folder tree sidebar from storageState.folders.
   */
  function renderFolderTree() {
    var treeEl = document.getElementById('folderTree');
    var loadingEl = document.getElementById('folderTreeLoading');
    var emptyEl = document.getElementById('folderTreeEmpty');

    loadingEl && loadingEl.classList.add('hidden');

    if (!storageState.folders || storageState.folders.length === 0) {
      emptyEl && emptyEl.classList.remove('hidden');
      treeEl && treeEl.classList.add('hidden');
      return;
    }

    emptyEl && emptyEl.classList.add('hidden');
    treeEl && treeEl.classList.remove('hidden');

    var rootFolders = storageState.folders.filter(function (f) { return !f.parent_folder_id; });

    if (treeEl) {
      treeEl.innerHTML = rootFolders.map(function (folder) {
        return renderFolderTreeItem(folder, 0);
      }).join('');
    }
  }

  /**
   * Render a single item in the folder tree sidebar.
   * @param {Object} folder
   * @param {number} depth - Indentation depth
   * @returns {string} HTML string
   */
  function renderFolderTreeItem(folder, depth) {
    var isActive = folder.id === storageState.currentFolderId;
    var hasChildren = folder.child_folder_count > 0;
    var indent = depth * 16;

    var childFolders = storageState.folders.filter(function (f) {
      return f.parent_folder_id === folder.id;
    });

    var onclickHandler = folder.isMatter
      ? 'navigateToMatter(' + JSON.stringify(folder.matter_id) + ', ' + JSON.stringify(folder.name) + ')'
      : 'navigateToFolder(' + JSON.stringify(folder.id) + ', ' + JSON.stringify(folder.name) + ')';

    return [
      '<div class="folder-item-container">',
      '  <div',
      '    class="folder-item flex items-center py-2 px-3 rounded ' + (isActive ? 'active' : '') + '"',
      '    data-folder-id="' + escapeHtml(folder.id) + '"',
      '    data-folder-name="' + escapeHtml(folder.name) + '"',
      '    onclick="' + onclickHandler + '"',
      '    style="padding-left: ' + (indent + 12) + 'px"',
      '  >',
      hasChildren
        ? '<button class="folder-toggle mr-1 text-gray-400 hover:text-gray-600" onclick="event.stopPropagation(); toggleFolder(' + JSON.stringify(folder.id) + ')"><svg class="w-4 h-4 transform transition-transform" data-folder-id="' + escapeHtml(folder.id) + '-arrow"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"></path></svg></button>'
        : '<span class="w-5"></span>',
      '    <svg class="w-4 h-4 mr-2 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
      '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
      '    </svg>',
      '    <span class="text-sm font-medium text-gray-700 truncate">' + escapeHtml(folder.name) + '</span>',
      folder.document_count > 0 ? '<span class="ml-auto text-xs text-gray-500">' + folder.document_count + '</span>' : '',
      '  </div>',
      hasChildren
        ? '<div class="folder-children" data-folder-id="' + escapeHtml(folder.id) + '-children">' + childFolders.map(function (child) { return renderFolderTreeItem(child, depth + 1); }).join('') + '</div>'
        : '',
      '</div>'
    ].join('');
  }

  /**
   * Toggle expand/collapse of a folder's children in the sidebar.
   * @param {string} folderId
   */
  function toggleFolder(folderId) {
    var childrenEl = document.querySelector('[data-folder-id="' + folderId + '-children"]');
    var arrowEl = document.querySelector('[data-folder-id="' + folderId + '-arrow"]');

    if (childrenEl && arrowEl) {
      childrenEl.classList.toggle('expanded');
      arrowEl.classList.toggle('rotate-180');
    }
  }

  /**
   * Navigate into a subfolder within the current matter (SPA-compatible).
   * Updates URL with pushState instead of full reload.
   * @param {string} folderId
   * @param {string} folderName
   */
  function navigateToFolder(folderId, folderName) {
    console.log('[Drive] Navigating to folder:', folderId, folderName);

    if (!storageState.currentMatterId) {
      console.error('[Drive] Cannot navigate to folder without matter_id');
      Lex.Toast.error('Cannot navigate to folder. Please select a matter first.');
      return;
    }

    var urlParams = new URLSearchParams();
    urlParams.set('matter_id', storageState.currentMatterId);
    if (storageState.currentMatterName) {
      urlParams.set('matter_name', storageState.currentMatterName);
    }
    if (folderId && folderId !== 'root') {
      urlParams.set('folder_id', folderId);
    }

    history.pushState({}, '', 'drive.html?' + urlParams.toString());

    storageState.currentFolderId = folderId === 'root' ? null : folderId;

    buildFolderPath();
    loadFolderContents();
  }

  /**
   * Navigate into a matter from the root grid (SPA-compatible).
   * Updates state and URL without a full page reload.
   * @param {string} matterId
   * @param {string} matterName
   */
  function navigateToMatter(matterId, matterName) {
    console.log('[Drive] Navigating to matter:', matterId, matterName);

    storageState.currentMatterId = matterId;
    storageState.currentMatterName = matterName;
    storageState.currentFolderId = null;

    var params = new URLSearchParams({
      matter_id: matterId,
      matter_name: matterName
    });
    history.pushState({}, '', 'drive.html?' + params.toString());

    updateViewButtons();
    loadFolderContents();
  }

  /**
   * Navigate to the root view (clear matter + folder context).
   * Resets state and reloads pinned/recent sections.
   */
  function navigateToRoot() {
    storageState.currentMatterId = null;
    storageState.currentFolderId = null;
    storageState.currentMatterName = null;
    storageState.currentFolderPath = [];

    history.pushState({}, '', 'drive.html');

    updateViewButtons();
    loadFolderContents();
    Promise.all([loadRecentMatters(), loadPinnedMatters()]).catch(function (err) {
      console.error('[Drive] Failed to reload recents/pinned after navigateToRoot:', err);
    });
  }

  /**
   * Navigate to a matter's root from a breadcrumb click (clears folder context).
   * @param {string} matterId
   * @param {string} matterName
   */
  function navigateToMatterBreadcrumb(matterId, matterName) {
    storageState.currentMatterId = matterId;
    storageState.currentMatterName = matterName;
    storageState.currentFolderId = null;
    storageState.currentFolderPath = [];

    var params = new URLSearchParams({
      matter_id: matterId,
      matter_name: matterName
    });
    history.pushState({}, '', 'drive.html?' + params.toString());

    updateViewButtons();
    loadFolderContents();
  }

  /**
   * Build the breadcrumb folder path array from storageState.folders.
   * Populates storageState.currentFolderPath and then calls renderBreadcrumbs().
   */
  function buildFolderPath() {
    storageState.currentFolderPath = [];

    if (storageState.currentFolderId) {
      var currentId = storageState.currentFolderId;
      while (currentId) {
        var folder = null;
        for (var i = 0; i < storageState.folders.length; i++) {
          if (storageState.folders[i].id === currentId) {
            folder = storageState.folders[i];
            break;
          }
        }
        if (folder) {
          storageState.currentFolderPath.unshift({
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
   * Home links use navigateToRoot(); matter links use navigateToMatterBreadcrumb().
   */
  function renderBreadcrumbs() {
    var breadcrumbsEl = document.getElementById('breadcrumbs');
    if (!breadcrumbsEl) return;

    var html = '<a href="#" onclick="navigateToRoot(); return false;" class="hover:text-indigo-600 cursor-pointer">Home</a>';

    if (storageState.currentMatterId) {
      var matterName = storageState.currentMatterName || storageState.currentMatterId;

      html += '<span class="breadcrumb-separator">/</span>';
      if (!storageState.currentFolderId) {
        html += '<span class="text-gray-900 font-medium">' + escapeHtml(matterName) + '</span>';
      } else {
        html += '<a href="#" onclick="navigateToMatterBreadcrumb(' + JSON.stringify(storageState.currentMatterId) + ', ' + JSON.stringify(matterName) + '); return false;" class="hover:text-indigo-600 cursor-pointer">' + escapeHtml(matterName) + '</a>';
      }
    }

    storageState.currentFolderPath.forEach(function (folder, index) {
      html += '<span class="breadcrumb-separator">/</span>';
      if (index === storageState.currentFolderPath.length - 1) {
        html += '<span class="text-gray-900 font-medium">' + escapeHtml(folder.name) + '</span>';
      } else {
        html += '<a href="#" class="hover:text-indigo-600" onclick="navigateToFolder(' + JSON.stringify(folder.id) + ', ' + JSON.stringify(folder.name) + '); return false;">' + escapeHtml(folder.name) + '</a>';
      }
    });

    breadcrumbsEl.innerHTML = html;
  }

  // ── Folder contents (files + subfolders) ────────────────────────────

  /**
   * Handle a folder/matter card click using data attributes.
   * Delegates to navigateToMatter or navigateToFolder based on card type.
   * @param {HTMLElement} element - The clicked element with data attributes
   */
  function handleFolderClick(element) {
    console.log('[Drive] handleFolderClick called', {
      dataset: element.dataset,
      isMatter: element.dataset.isMatter,
      matterId: element.dataset.matterId,
      folderId: element.dataset.folderId,
      name: element.dataset.name,
      currentMatterId: storageState.currentMatterId,
      currentFolderId: storageState.currentFolderId
    });

    var isMatter = element.dataset.isMatter === 'true';
    var name = element.dataset.name;

    if (isMatter) {
      var matterId = element.dataset.matterId;
      if (!matterId) {
        console.error('[Drive] No matter ID found in dataset');
        Lex.Toast.error('Cannot navigate: missing matter ID');
        return;
      }
      console.log('[Drive] Navigating to matter:', matterId, name);
      navigateToMatter(matterId, name);
    } else {
      var folderId = element.dataset.folderId;
      if (!folderId) {
        console.error('[Drive] No folder ID found in dataset');
        Lex.Toast.error('Cannot navigate: missing folder ID');
        return;
      }
      console.log('[Drive] Navigating to folder:', folderId, name);
      navigateToFolder(folderId, name);
    }
  }

  /**
   * Update the results count text element based on current state.
   */
  function updateResultsCount() {
    var resultsCountEl = document.getElementById('resultsCount');
    if (!resultsCountEl) return;

    if (!storageState.currentMatterId) {
      var start = storageState.totalResults > 0 ? (storageState.currentPage - 1) * 100 + 1 : 0;
      var end = Math.min(storageState.currentPage * 100, storageState.totalResults);

      if (storageState.totalResults === 0) {
        resultsCountEl.textContent = 'No results found';
      } else if (storageState.searchQuery || storageState.sourceFilter !== 'all') {
        resultsCountEl.textContent = 'Showing ' + start + '-' + end + ' of ' + storageState.totalResults + ' results';
      } else {
        resultsCountEl.textContent = storageState.totalResults + ' matter' + (storageState.totalResults !== 1 ? 's' : '');
      }
    } else {
      var folderCount = storageState.folders.length;
      var fileCount = storageState.files.length;
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
  }

  /**
   * Load all folder/file contents for the current state.
   * Handles both root view (all matters) and matter view (subfolders + files).
   */
  async function loadFolderContents() {
    console.log('[Drive] Loading folder contents:', storageState.currentFolderId);
    storageState.loadingContent = true;

    var loadingEl = document.getElementById('contentLoading');
    var gridViewEl = document.getElementById('gridView');
    var listViewEl = document.getElementById('listView');
    var emptyEl = document.getElementById('contentEmpty');

    loadingEl && loadingEl.classList.remove('hidden');
    gridViewEl && gridViewEl.classList.add('hidden');
    listViewEl && listViewEl.classList.add('hidden');
    emptyEl && emptyEl.classList.add('hidden');

    try {
      // ROOT VIEW: Load all matters as folders from /api/v1/storage/root
      if (!storageState.currentMatterId) {
        var params = new URLSearchParams({
          page: storageState.currentPage,
          limit: 100,
          sort: storageState.sortBy,
          order: storageState.sortOrder
        });

        if (storageState.searchQuery) {
          params.append('search', storageState.searchQuery);
        }

        if (storageState.sourceFilter !== 'all') {
          params.append('source', storageState.sourceFilter);
        }

        var response = await api.get('/api/v1/storage/root?' + params.toString());

        if (response.success && response.matters) {
          storageState.folders = response.matters.map(function (matter) {
            return {
              id: matter.id,
              name: matter.name || matter.matter_id,
              matter_id: matter.matter_id,
              isMatter: true,
              is_pinned: matter.is_pinned || false,
              document_count: matter.document_count || 0,
              child_folder_count: matter.folder_count || 0,
              source: matter.source,
              connector_id: matter.connector_id,
              created_at: matter.created_at,
              updated_at: matter.updated_at
            };
          });
          storageState.files = [];

          if (response.pagination) {
            storageState.totalResults = response.pagination.total;
            storageState.totalPages = response.pagination.total_pages;
          }

          updateResultsCount();
          renderFolderContents();
        } else {
          throw new Error(response.error || 'Failed to load matters');
        }
        return;
      }

      // MATTER VIEW: Fetch folders and files from API (matter-scoped)
      var foldersResponse = await api.get('/api/v1/storage/folders?matter_id=' + storageState.currentMatterId);

      if (foldersResponse.status === 'success' || foldersResponse.data || foldersResponse.folders) {
        storageState.folders = (foldersResponse.data && foldersResponse.data.folders) || foldersResponse.folders || [];
      } else {
        console.warn('[Drive] Failed to load folders:', foldersResponse.error);
        storageState.folders = [];
      }

      var fileParams = new URLSearchParams({
        matter_id: storageState.currentMatterId
      });

      if (storageState.currentFolderId) {
        fileParams.append('folder_id', storageState.currentFolderId);
      }

      if (storageState.searchQuery) {
        fileParams.append('search', storageState.searchQuery);
      }

      if (storageState.sourceFilter !== 'all') {
        fileParams.append('source', storageState.sourceFilter);
      }

      var filesResponse = await api.get('/api/v1/storage/files?' + fileParams.toString());

      if (filesResponse.files || filesResponse.data || filesResponse.status === 'success') {
        storageState.files = (filesResponse.data && filesResponse.data.files) || filesResponse.files || [];
        buildFolderPath();
        updateResultsCount();
        renderFolderContents();

        if (storageState.searchQuery && window.FeatureTracker) {
          try {
            await window.FeatureTracker.trackFeature(window.Features.SEARCH_PERFORMED, {
              query_length: storageState.searchQuery.length,
              result_count: storageState.files.length,
              matter_id: storageState.currentMatterId,
              source_filter: storageState.sourceFilter
            });
          } catch (trackError) {
            console.error('[FeatureTracker] Failed to track search:', trackError);
          }
        }
      } else {
        throw new Error(filesResponse.error || 'Failed to load folder contents');
      }
    } catch (error) {
      console.error('[Drive] Failed to load folder contents:', error);
      Lex.Toast.error('Failed to load files. Please try again.');

      loadingEl && loadingEl.classList.add('hidden');
      emptyEl && emptyEl.classList.remove('hidden');
    } finally {
      storageState.loadingContent = false;
    }
  }

  /**
   * Render folder/file contents into grid or list view based on storageState.viewMode.
   */
  function renderFolderContents() {
    var loadingEl = document.getElementById('contentLoading');
    var gridViewEl = document.getElementById('gridView');
    var listViewEl = document.getElementById('listView');
    var emptyEl = document.getElementById('contentEmpty');

    loadingEl && loadingEl.classList.add('hidden');

    var foldersToShow = [];
    if (!storageState.currentMatterId) {
      foldersToShow = storageState.folders.filter(function (f) { return f.isMatter; });
    } else {
      foldersToShow = storageState.folders.filter(function (f) {
        if (!storageState.currentFolderId) {
          return !f.parent_folder_id;
        }
        return f.parent_folder_id === storageState.currentFolderId;
      });
    }

    var totalItems = foldersToShow.length + storageState.files.length;

    if (totalItems === 0) {
      emptyEl && emptyEl.classList.remove('hidden');
      gridViewEl && gridViewEl.classList.add('hidden');
      listViewEl && listViewEl.classList.add('hidden');
      updatePaginationUI();
      return;
    }

    emptyEl && emptyEl.classList.add('hidden');

    var sortedFolders = foldersToShow.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    var sortedFiles = storageState.files.slice().sort(function (a, b) {
      return new Date(b.updated_at) - new Date(a.updated_at);
    });

    if (storageState.viewMode === 'grid') {
      renderGridView(sortedFolders, sortedFiles);
      gridViewEl && gridViewEl.classList.remove('hidden');
      listViewEl && listViewEl.classList.add('hidden');
    } else {
      renderListView(sortedFolders, sortedFiles);
      listViewEl && listViewEl.classList.remove('hidden');
      gridViewEl && gridViewEl.classList.add('hidden');
    }

    updatePaginationUI();
  }

  // ── Rendering (grid + list) ──────────────────────────────────────────

  /**
   * Render the grid view with folder cards and file cards.
   * @param {Array} folders
   * @param {Array} files
   */
  function renderGridView(folders, files) {
    var gridViewEl = document.getElementById('gridView');
    if (!gridViewEl) return;

    var folderCards = folders.map(function (folder) {
      var displayHtml = folder.isMatter
        ? [
            '<h3 class="text-sm font-medium text-gray-900 text-center truncate w-full">' + escapeHtml(folder.name) + '</h3>',
            '<p class="text-xs text-gray-600 font-mono text-center truncate w-full" title="' + escapeHtml(folder.matter_id) + '">' + escapeHtml(folder.matter_id) + '</p>',
            '<p class="text-xs text-gray-500 text-center mt-1">' + (folder.document_count || 0) + ' files \u2022 ' + (folder.child_folder_count || 0) + ' folders</p>'
          ].join('')
        : [
            '<h3 class="text-sm font-medium text-gray-900 text-center truncate w-full">' + escapeHtml(folder.name) + '</h3>',
            '<p class="text-xs text-gray-500 text-center mt-1">' + (folder.document_count || 0) + ' files</p>'
          ].join('');

      var dataAttrs = folder.isMatter
        ? 'data-is-matter="true" data-matter-id="' + escapeHtml(folder.matter_id) + '" data-name="' + escapeHtml(folder.name) + '"'
        : 'data-is-matter="false" data-folder-id="' + escapeHtml(folder.id) + '" data-name="' + escapeHtml(folder.name) + '"';

      var menuButtonAttrs = folder.isMatter
        ? 'data-matter-id="' + escapeHtml(folder.matter_id) + '" data-matter-name="' + escapeHtml(folder.name) + '" data-is-pinned="' + (folder.is_pinned || false) + '" data-source="' + escapeHtml(folder.source || 'lana') + '" onclick="event.stopPropagation(); showMatterActionsModal(event)"'
        : 'onclick="event.stopPropagation(); showFolderMenu(' + JSON.stringify(folder.id) + ', event)"';

      return [
        '<div class="grid-item bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow relative group" ' + dataAttrs + ' onclick="handleFolderClick(this)">',
        '  <button class="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity" ' + menuButtonAttrs + ' style="opacity: 1">',
        '    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
        '  </button>',
        '  <div class="flex flex-col items-center">',
        '    <svg class="w-16 h-16 text-indigo-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
        '    </svg>',
        '    ' + displayHtml,
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    var fileCards = files.map(function (file) {
      return [
        '<div class="grid-item bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow relative" onclick="openFileViewer(' + JSON.stringify(file.id) + ')">',
        '  <button class="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); showFileMenu(' + JSON.stringify(file.id) + ', event)" style="opacity: 1">',
        '    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
        '  </button>',
        '  <div class="flex flex-col items-center">',
        '    ' + getFileIcon(file.filename),
        '    <h3 class="text-sm font-medium text-gray-900 text-center truncate w-full mt-2">' + escapeHtml(file.filename) + '</h3>',
        '    <p class="text-xs text-gray-500 mt-1">' + formatFileSize(file.file_size) + '</p>',
        '    <p class="text-xs text-gray-400">' + formatRelativeDate(file.updated_at) + '</p>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    gridViewEl.innerHTML = folderCards + fileCards;
  }

  /**
   * Render the list/table view with folder rows and file rows.
   * @param {Array} folders
   * @param {Array} files
   */
  function renderListView(folders, files) {
    var listViewBodyEl = document.getElementById('listViewBody');
    if (!listViewBodyEl) return;

    var folderRows = folders.map(function (folder) {
      var dataAttrs = folder.isMatter
        ? 'data-is-matter="true" data-matter-id="' + escapeHtml(folder.matter_id) + '" data-name="' + escapeHtml(folder.name) + '"'
        : 'data-is-matter="false" data-folder-id="' + escapeHtml(folder.id) + '" data-name="' + escapeHtml(folder.name) + '"';

      var displayHtml = folder.isMatter
        ? [
            '<div class="flex items-center">',
            '  <svg class="w-5 h-5 text-indigo-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
            '    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
            '  </svg>',
            '  <div class="min-w-0 flex-1">',
            '    <div class="text-sm font-medium text-gray-900 truncate">' + escapeHtml(folder.name) + '</div>',
            '    <div class="text-xs text-gray-600 font-mono truncate" title="' + escapeHtml(folder.matter_id) + '">' + escapeHtml(folder.matter_id) + '</div>',
            '  </div>',
            '</div>'
          ].join('')
        : [
            '<div class="flex items-center">',
            '  <svg class="w-5 h-5 text-indigo-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
            '    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
            '  </svg>',
            '  <span class="text-sm font-medium text-gray-900">' + escapeHtml(folder.name) + '</span>',
            '</div>'
          ].join('');

      var sizeDisplay = folder.isMatter
        ? ((folder.document_count || 0) + ' files \u2022 ' + (folder.child_folder_count || 0) + ' folders')
        : ((folder.document_count || 0) + ' items');

      var menuButtonAttrs = folder.isMatter
        ? 'data-matter-id="' + escapeHtml(folder.matter_id) + '" data-matter-name="' + escapeHtml(folder.name) + '" data-is-pinned="' + (folder.is_pinned || false) + '" data-source="' + escapeHtml(folder.source || 'lana') + '" onclick="event.stopPropagation(); showMatterActionsModal(event)"'
        : 'onclick="event.stopPropagation(); showFolderMenu(' + JSON.stringify(folder.id) + ', event)"';

      return [
        '<tr class="hover:bg-gray-50 cursor-pointer" ' + dataAttrs + ' onclick="handleFolderClick(this)">',
        '  <td class="px-6 py-4"><input type="checkbox" class="rounded text-indigo-600" onclick="event.stopPropagation()"></td>',
        '  <td class="px-6 py-4">' + displayHtml + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\u2014</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + formatRelativeDate(folder.created_at) + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + sizeDisplay + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">',
        '    <button class="text-gray-400 hover:text-gray-600" ' + menuButtonAttrs + '>',
        '      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
        '    </button>',
        '  </td>',
        '</tr>'
      ].join('');
    }).join('');

    var fileRows = files.map(function (file) {
      return [
        '<tr class="hover:bg-gray-50 cursor-pointer" onclick="openFileViewer(' + JSON.stringify(file.id) + ')">',
        '  <td class="px-6 py-4"><input type="checkbox" class="rounded text-indigo-600" onclick="event.stopPropagation()"></td>',
        '  <td class="px-6 py-4 whitespace-nowrap">',
        '    <div class="flex items-center">',
        '      ' + getFileIconSmall(file.filename),
        '      <span class="text-sm font-medium text-gray-900">' + escapeHtml(file.filename) + '</span>',
        '    </div>',
        '  </td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + escapeHtml(file.created_by_username || 'Unknown') + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + formatRelativeDate(file.created_at) + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + formatFileSize(file.file_size) + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">',
        '    <button class="text-gray-400 hover:text-gray-600" onclick="event.stopPropagation(); showFileMenu(' + JSON.stringify(file.id) + ', event)">',
        '      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
        '    </button>',
        '  </td>',
        '</tr>'
      ].join('');
    }).join('');

    listViewBodyEl.innerHTML = folderRows + fileRows;
  }

  // ── View toggle ──────────────────────────────────────────────────────

  /**
   * Switch between grid and list view modes.
   * @param {string} mode - 'grid' or 'list'
   */
  function switchView(mode) {
    storageState.viewMode = mode;

    var gridBtn = document.getElementById('gridViewBtn');
    var listBtn = document.getElementById('listViewBtn');

    if (mode === 'grid') {
      gridBtn && gridBtn.classList.add('text-indigo-600');
      gridBtn && gridBtn.classList.remove('text-gray-400');
      listBtn && listBtn.classList.add('text-gray-400');
      listBtn && listBtn.classList.remove('text-indigo-600');
    } else {
      listBtn && listBtn.classList.add('text-indigo-600');
      listBtn && listBtn.classList.remove('text-gray-400');
      gridBtn && gridBtn.classList.add('text-gray-400');
      gridBtn && gridBtn.classList.remove('text-indigo-600');
    }

    renderFolderContents();
  }

  // ── New folder modal ─────────────────────────────────────────────────

  /**
   * Show the new folder creation modal.
   */
  function showNewFolderModal() {
    var modal = document.getElementById('newFolderModal');
    modal && modal.classList.remove('hidden');
    var input = document.getElementById('folderNameInput');
    input && input.focus();
  }

  /**
   * Hide the new folder creation modal and clear its input.
   */
  function hideNewFolderModal() {
    var modal = document.getElementById('newFolderModal');
    modal && modal.classList.add('hidden');
    var input = document.getElementById('folderNameInput');
    if (input) input.value = '';
  }

  /**
   * Handle new folder form submission. Creates a folder via API.
   * @param {Event} event
   */
  async function handleCreateFolder(event) {
    event.preventDefault();

    var folderNameInput = document.getElementById('folderNameInput');
    var folderName = folderNameInput ? folderNameInput.value.trim() : '';

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
        matter_id: storageState.currentMatterId,
        parent_folder_id: storageState.currentFolderId || null
      });

      if (response.status === 'success') {
        Lex.Toast.success('Folder created successfully');
        hideNewFolderModal();
        await loadFolderContents();
      } else {
        console.error('[Drive] API returned error:', response);
        throw new Error(response.error || 'Failed to create folder');
      }
    } catch (error) {
      console.error('[Drive] Failed to create folder:', error);
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
    console.log('[Drive] Files selected:', pendingUploadFiles.length);

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

    if (signaturesCheckbox) signaturesCheckbox.checked = false;
    if (formsCheckbox) formsCheckbox.checked = false;

    modal && modal.classList.remove('hidden');
    modal && modal.classList.add('flex');
  }

  /**
   * Hide and reset the single file upload modal.
   */
  function hideSingleUploadModal() {
    var modal = document.getElementById('uploadSingleFileModal');
    modal && modal.classList.add('hidden');
    modal && modal.classList.remove('flex');

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

    console.log('[Drive] Uploading file with hints:', {
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
      formData.append('matter_id', storageState.currentMatterId);
      if (storageState.currentFolderId) {
        formData.append('folder_id', storageState.currentFolderId);
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
      console.log('[Drive] Upload successful:', result);

      Lex.Toast.success('File uploaded successfully');

      if (window.FeatureTracker) {
        try {
          await window.FeatureTracker.trackFeature(window.Features.DOCUMENT_UPLOADED, {
            file_type: file.type || 'unknown',
            file_size: file.size,
            matter_id: storageState.currentMatterId,
            folder_id: storageState.currentFolderId || null,
            has_hints: !!(hasSignatures || hasForms)
          });
        } catch (trackError) {
          console.error('[FeatureTracker] Failed to track upload:', trackError);
        }
      }

      await loadFolderContents();
    } catch (error) {
      console.error('[Drive] Failed to upload file:', error);
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
        '  <td class="px-4 py-3 text-sm text-gray-700">' + escapeHtml(file.name) + '</td>',
        '  <td class="px-4 py-3 text-sm text-gray-500">' + formatFileSize(file.size) + '</td>',
        '  <td class="px-4 py-3 text-sm text-gray-500 bulk-doc-type" data-index="' + index + '">' + getFileType(file) + '</td>',
        '  <td class="px-4 py-3 text-center"><input type="checkbox" class="bulk-signatures-checkbox rounded text-indigo-600" data-index="' + index + '"></td>',
        '  <td class="px-4 py-3 text-center"><input type="checkbox" class="bulk-forms-checkbox rounded text-indigo-600" data-index="' + index + '"></td>',
        '</tr>'
      ].join('');
    }).join('');

    if (gridBodyEl) gridBodyEl.innerHTML = rows;

    modal && modal.classList.remove('hidden');
    modal && modal.classList.add('flex');
  }

  /**
   * Hide and reset the bulk upload modal.
   */
  function hideBulkUploadModal() {
    var modal = document.getElementById('bulkUploadModal');
    modal && modal.classList.add('hidden');
    modal && modal.classList.remove('flex');

    pendingUploadFiles = null;
    var fileInput = document.getElementById('fileUploadInput');
    if (fileInput) fileInput.value = '';
  }

  /**
   * Apply the first file's hint checkboxes to all files in the bulk grid.
   */
  function applyHintsToAll() {
    var firstSignatures = document.querySelector('.bulk-signatures-checkbox[data-index="0"]');
    var firstForms = document.querySelector('.bulk-forms-checkbox[data-index="0"]');
    var sigChecked = firstSignatures ? firstSignatures.checked : false;
    var formsChecked = firstForms ? firstForms.checked : false;

    document.querySelectorAll('.bulk-signatures-checkbox').forEach(function (checkbox) {
      checkbox.checked = sigChecked;
    });
    document.querySelectorAll('.bulk-forms-checkbox').forEach(function (checkbox) {
      checkbox.checked = formsChecked;
    });

    Lex.Toast.success('Hints applied to all files');
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

    console.log('[Drive] Uploading', filesWithHints.length, 'files with hints');

    hideBulkUploadModal();
    Lex.Toast.info('Uploading ' + filesWithHints.length + ' file(s)...');

    try {
      await api._readyPromise;

      var uploadPromises = filesWithHints.map(function (item) {
        var formData = new FormData();
        formData.append('file', item.file);
        formData.append('matter_id', storageState.currentMatterId);
        if (storageState.currentFolderId) {
          formData.append('folder_id', storageState.currentFolderId);
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
      console.log('[Drive] Bulk upload successful:', results);

      Lex.Toast.success('Successfully uploaded ' + filesWithHints.length + ' file(s)');

      if (window.FeatureTracker) {
        for (var i = 0; i < filesWithHints.length; i++) {
          var item = filesWithHints[i];
          try {
            await window.FeatureTracker.trackFeature(window.Features.DOCUMENT_UPLOADED, {
              file_type: item.file.type || 'unknown',
              file_size: item.file.size,
              matter_id: storageState.currentMatterId,
              folder_id: storageState.currentFolderId || null,
              is_bulk_upload: true
            });
          } catch (trackError) {
            console.error('[FeatureTracker] Failed to track bulk upload:', trackError);
          }
        }
      }

      await loadFolderContents();
    } catch (error) {
      console.error('[Drive] Failed to upload files:', error);
      Lex.Toast.error('Failed to upload files. Please try again.');
    }
  }

  // ── File operations ──────────────────────────────────────────────────

  /**
   * Download a file by ID using blob approach (prevents navigation/white screen).
   * @param {string} fileId
   */
  async function downloadFile(fileId) {
    console.log('[Drive] Downloading file:', fileId);

    try {
      var fileMetadata = await api.get('/api/v1/storage/files/' + fileId);
      if (!fileMetadata || !fileMetadata.filename) {
        throw new Error('Failed to retrieve file metadata');
      }

      var filename = fileMetadata.filename;

      var response = await fetch(api.baseUrl + '/api/v1/storage/files/' + fileId + '/download', {
        headers: {
          'Authorization': 'Bearer ' + api.token
        }
      });

      if (!response.ok) {
        throw new Error('Download failed: ' + response.status);
      }

      var blob = await response.blob();
      var url = URL.createObjectURL(blob);

      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[Drive] Download started:', filename);
    } catch (error) {
      console.error('[Drive] Failed to download file:', error);
      Lex.Toast.error('Failed to download file. Please try again.');
    }
  }

  // ── Context menu ─────────────────────────────────────────────────────

  /**
   * Show the context menu for a file item.
   * @param {string} fileId
   * @param {Event} event
   */
  function showFileMenu(fileId, event) {
    console.log('[Drive] Show file menu:', fileId);
    event && event.stopPropagation();

    var file = null;
    for (var i = 0; i < storageState.files.length; i++) {
      if (storageState.files[i].id === fileId) {
        file = storageState.files[i];
        break;
      }
    }
    if (!file) return;

    var menuItems = [
      {
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>',
        label: 'Download',
        action: function () { downloadFile(fileId); }
      },
      {
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>',
        label: 'Preview',
        action: function () {
          hideContextMenu();
          Lex.Toast.info('Preview feature coming soon!');
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
   * Show the context menu for a folder item.
   * @param {string|Object} folderOrId - Folder object or folder ID string
   * @param {Event} event
   */
  function showFolderMenu(folderOrId, event) {
    console.log('[Drive] Show folder menu:', folderOrId);
    if (event && event.stopPropagation) {
      event.stopPropagation();
    }

    var folder;
    if (typeof folderOrId === 'object') {
      folder = folderOrId;
    } else {
      folder = null;
      for (var i = 0; i < storageState.folders.length; i++) {
        if (storageState.folders[i].id === folderOrId) {
          folder = storageState.folders[i];
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
          if (folder.isMatter) {
            navigateToMatter(folder.matter_id, folder.name);
          } else {
            navigateToFolder(folder.id, folder.name);
          }
        }
      },
      {
        icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>',
        label: 'Rename',
        action: function () {
          hideContextMenu();
          Lex.Toast.info('Rename feature coming soon!');
        }
      }
    ];

    console.log('[Drive] Pin check:', {
      isMatter: folder.isMatter,
      currentMatterId: storageState.currentMatterId,
      shouldShowPin: folder.isMatter && !storageState.currentMatterId,
      folder: folder
    });

    if (folder.isMatter && !storageState.currentMatterId) {
      (function (f) {
        menuItems.push({
          icon: '<path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/>',
          label: f.is_pinned ? 'Unpin' : 'Pin',
          action: async function () {
            hideContextMenu();
            await togglePin(f.matter_id, f.source || 'lana', f.is_pinned || false);
          }
        });
      }(folder));
    }

    menuItems.push(
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
    );

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
        return '<div class="border-t border-gray-200 my-1"></div>';
      }

      var className = item.className || 'text-gray-700 hover:bg-gray-100';
      return [
        '<button class="w-full text-left px-4 py-2 text-sm ' + className + ' flex items-center gap-3 transition-colors" onclick="window.contextMenuAction_' + index + '()">',
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
    console.log('[Drive] Context menu - event:', event);
    console.log('[Drive] Context menu - target:', target);

    var rect = target ? target.getBoundingClientRect() : null;
    console.log('[Drive] Context menu - rect:', rect);

    if (rect) {
      requestAnimationFrame(function () {
        var menuWidth = menu.offsetWidth || 200;
        var menuHeight = menu.offsetHeight || 100;
        console.log('[Drive] Context menu - dimensions:', { menuWidth: menuWidth, menuHeight: menuHeight });

        var left = rect.left - menuWidth - 10;
        var top = rect.top;

        if (left < 10) {
          left = rect.right + 10;
        }
        if (top + menuHeight > window.innerHeight - 10) {
          top = window.innerHeight - menuHeight - 10;
        }

        console.log('[Drive] Context menu - final position:', { left: left, top: top });
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.transform = 'none';
        menu.style.visibility = 'visible';
      });
    } else {
      console.log('[Drive] Context menu - NO RECT, using center fallback');
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

  // ── Matter actions modal ─────────────────────────────────────────────

  /**
   * Show the matter actions modal (open, pin, delete) for a matter card.
   * Reads matter data from the triggering button's dataset attributes.
   * @param {Event} event
   */
  function showMatterActionsModal(event) {
    console.log('[Drive] Show matter actions modal');

    var button = event.currentTarget;
    var matterId = button.dataset.matterId;
    var matterName = button.dataset.matterName;
    var isPinned = button.dataset.isPinned === 'true';
    var source = button.dataset.source || 'lana';

    console.log('[Drive] Matter data:', { matterId: matterId, matterName: matterName, isPinned: isPinned, source: source });

    selectedMatter = {
      matterId: matterId,
      matterName: matterName,
      isPinned: isPinned,
      source: source
    };

    var nameEl = document.getElementById('modalMatterName');
    var idEl = document.getElementById('modalMatterId');
    if (nameEl) nameEl.textContent = matterName;
    if (idEl) idEl.textContent = matterId;

    var pinLabel = document.getElementById('pinBtnLabel');
    var pinDesc = document.getElementById('pinBtnDesc');
    if (isPinned) {
      if (pinLabel) pinLabel.textContent = 'Unpin Folder';
      if (pinDesc) pinDesc.textContent = 'Remove from pinned folders';
    } else {
      if (pinLabel) pinLabel.textContent = 'Pin Folder';
      if (pinDesc) pinDesc.textContent = 'Add to pinned folders';
    }

    var modal = document.getElementById('matterActionsModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  /**
   * Close the matter actions modal and clear selectedMatter.
   */
  function closeMatterActionsModal() {
    var modal = document.getElementById('matterActionsModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    selectedMatter = null;
  }

  /**
   * Open the selected matter (navigate into it) from the actions modal.
   */
  function openMatterFromModal() {
    if (!selectedMatter) return;

    var matterId = selectedMatter.matterId;
    var matterName = selectedMatter.matterName;

    closeMatterActionsModal();
    navigateToMatter(matterId, matterName);
  }

  /**
   * Toggle the pin state of the selected matter from the actions modal.
   */
  async function togglePinFromModal() {
    if (!selectedMatter) return;

    var matterId = selectedMatter.matterId;
    var source = selectedMatter.source;
    var isPinned = selectedMatter.isPinned;

    closeMatterActionsModal();
    await togglePin(matterId, source, isPinned);
  }

  /**
   * Initiate matter deletion from the actions modal.
   * Transitions to a separate delete confirmation modal.
   */
  function deleteMatterFromModal() {
    if (!selectedMatter) return;

    var nameEl = document.getElementById('deleteConfirmMatterName');
    if (nameEl) nameEl.textContent = selectedMatter.matterName;

    var btn = document.getElementById('confirmDeleteMatterBtn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Delete Folder';
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    var optionsModal = document.getElementById('matterActionsModal');
    if (optionsModal) {
      optionsModal.classList.add('hidden');
      optionsModal.classList.remove('flex');
    }

    var confirmModal = document.getElementById('deleteMatterConfirmModal');
    if (confirmModal) {
      confirmModal.classList.remove('hidden');
      confirmModal.classList.add('flex');
    }
  }

  // ── Delete matter confirmation ────────────────────────────────────────

  /**
   * Close the delete matter confirmation modal and clear selectedMatter.
   */
  function closeDeleteMatterConfirmModal() {
    var modal = document.getElementById('deleteMatterConfirmModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    selectedMatter = null;
  }

  /**
   * Confirm and execute matter deletion via API.
   * Reloads pinned, recent, and main content sections on success.
   */
  async function confirmDeleteMatter() {
    if (!selectedMatter) return;

    var matterId = selectedMatter.matterId;
    var matterName = selectedMatter.matterName;

    var btn = document.getElementById('confirmDeleteMatterBtn');
    var originalText = btn ? btn.textContent : 'Delete Folder';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      btn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    try {
      await api.deleteMatter(matterId);
      closeDeleteMatterConfirmModal();
      Lex.Toast.success('Folder "' + matterName + '" deleted successfully');

      await Promise.all([
        loadPinnedMatters(),
        loadRecentMatters(),
        loadFolderContents()
      ]);
    } catch (error) {
      console.error('[Drive] Failed to delete matter:', error);
      Lex.Toast.error(error.message || 'Failed to delete folder');
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }
  }

  // ── Pagination ────────────────────────────────────────────────────────

  /**
   * Update pagination UI elements (page numbers, button states).
   * Pagination is only shown in root view.
   */
  function updatePaginationUI() {
    var paginationControls = document.getElementById('paginationControls');

    if (!storageState.currentMatterId) {
      paginationControls && paginationControls.classList.remove('hidden');

      var limit = 100;
      var start = (storageState.currentPage - 1) * limit + 1;
      var end = Math.min(storageState.currentPage * limit, storageState.totalResults);

      var startEl = document.getElementById('paginationStart');
      var endEl = document.getElementById('paginationEnd');
      var totalEl = document.getElementById('paginationTotal');
      var currentPageEl = document.getElementById('currentPageNum');
      var totalPagesEl = document.getElementById('totalPagesNum');

      if (startEl) startEl.textContent = start;
      if (endEl) endEl.textContent = end;
      if (totalEl) totalEl.textContent = storageState.totalResults;
      if (currentPageEl) currentPageEl.textContent = storageState.currentPage;
      if (totalPagesEl) totalPagesEl.textContent = storageState.totalPages || 1;

      var isFirstPage = storageState.currentPage === 1;
      var isLastPage = storageState.currentPage >= storageState.totalPages;

      var prevBtn = document.getElementById('prevPage');
      var nextBtn = document.getElementById('nextPage');
      if (prevBtn) {
        prevBtn.disabled = isFirstPage;
        prevBtn.classList.toggle('opacity-50', isFirstPage);
        prevBtn.classList.toggle('cursor-not-allowed', isFirstPage);
      }
      if (nextBtn) {
        nextBtn.disabled = isLastPage;
        nextBtn.classList.toggle('opacity-50', isLastPage);
        nextBtn.classList.toggle('cursor-not-allowed', isLastPage);
      }

      var prevBtnMobile = document.getElementById('prevPageMobile');
      var nextBtnMobile = document.getElementById('nextPageMobile');
      if (prevBtnMobile) {
        prevBtnMobile.disabled = isFirstPage;
        prevBtnMobile.classList.toggle('opacity-50', isFirstPage);
        prevBtnMobile.classList.toggle('cursor-not-allowed', isFirstPage);
      }
      if (nextBtnMobile) {
        nextBtnMobile.disabled = isLastPage;
        nextBtnMobile.classList.toggle('opacity-50', isLastPage);
        nextBtnMobile.classList.toggle('cursor-not-allowed', isLastPage);
      }
    } else {
      paginationControls && paginationControls.classList.add('hidden');
    }
  }

  /**
   * Navigate to the previous page of results.
   */
  async function goToPreviousPage() {
    if (storageState.currentPage > 1) {
      storageState.currentPage--;
      await loadFolderContents();
    }
  }

  /**
   * Navigate to the next page of results.
   */
  async function goToNextPage() {
    if (storageState.currentPage < storageState.totalPages) {
      storageState.currentPage++;
      await loadFolderContents();
    }
  }

  /**
   * Refresh all sections: pinned, recent, and main folder contents.
   */
  async function refreshPage() {
    console.log('[Drive] Refreshing page...');

    var loadingEl = document.getElementById('contentLoading');
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
    }

    await Promise.all([
      loadPinnedMatters(),
      loadRecentMatters(),
      loadFolderContents()
    ]);

    console.log('[Drive] Page refreshed successfully');
  }

  // ── Recents and pinned ───────────────────────────────────────────────

  /**
   * Load recently accessed files and matters, merge and render them.
   * Silently fails since recents are non-critical.
   */
  async function loadRecentMatters() {
    try {
      var results = await Promise.all([
        api.get('/api/v1/storage/recent?limit=8'),
        api.get('/api/v1/matters?limit=20&page=1')
      ]);
      var filesResponse = results[0];
      var mattersResponse = results[1];

      var recentItems = [];

      if (filesResponse && filesResponse.files && filesResponse.files.length > 0) {
        var recentFiles = filesResponse.files.map(function (file) {
          return {
            type: 'file',
            data: file,
            timestamp: new Date(file.last_accessed_at || file.created_at)
          };
        });
        recentItems = recentItems.concat(recentFiles);
      }

      if (mattersResponse && mattersResponse.matters && mattersResponse.matters.length > 0) {
        var recentMatters = mattersResponse.matters
          .slice()
          .sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); })
          .slice(0, 8)
          .map(function (matter) {
            return {
              type: 'matter',
              data: matter,
              timestamp: new Date(matter.updated_at)
            };
          });
        recentItems = recentItems.concat(recentMatters);
      }

      var sortedItems = recentItems
        .slice()
        .sort(function (a, b) { return b.timestamp - a.timestamp; })
        .slice(0, 8);

      if (sortedItems.length > 0) {
        var recentsSection = document.getElementById('recentsSection');
        var recentFilesEl = document.getElementById('recentFiles');
        var recentsCount = document.getElementById('recentsCount');

        if (recentFilesEl) {
          recentFilesEl.innerHTML = sortedItems.map(function (item) {
            if (item.type === 'matter') {
              return renderMatterCard(item.data, false);
            }
            return renderFileCardInRecents(item.data);
          }).join('');
        }

        if (recentsCount) {
          recentsCount.textContent = sortedItems.length + ' ' + (sortedItems.length === 1 ? 'item' : 'items');
        }
        if (recentsSection) recentsSection.classList.remove('hidden');
      }
    } catch (error) {
      console.error('[Drive] Failed to load recent items:', error);
      // Silently fail - recents are not critical
    }
  }

  /**
   * Render a file card for the recents section.
   * @param {Object} file
   * @returns {string} HTML string
   */
  function renderFileCardInRecents(file) {
    var fileName = escapeHtml(file.filename || file.name);
    var fileSize = formatFileSize(file.file_size || 0);
    var fileIcon = getFileIconSVG(file.content_type);
    var lastAccessed = file.last_accessed_at ? new Date(file.last_accessed_at).toLocaleDateString() : '';

    return [
      '<div class="file-card bg-white rounded-lg shadow-sm border border-gray-200 p-4 cursor-pointer relative group hover:shadow-md transition-shadow"',
      '     onclick="openRecentFile(' + JSON.stringify(file.id) + ', ' + JSON.stringify(file.client_matter || '') + ')">',
      '  <div class="flex flex-col items-center text-center">',
      '    <div class="w-12 h-12 mb-3 flex items-center justify-center">' + fileIcon + '</div>',
      '    <p class="text-sm font-medium text-gray-900 truncate w-full mb-1" title="' + fileName + '">' + fileName + '</p>',
      '    <p class="text-xs text-gray-500">' + fileSize + '</p>',
      lastAccessed ? '    <p class="text-xs text-gray-400 mt-1">' + lastAccessed + '</p>' : '',
      '  </div>',
      '</div>'
    ].join('');
  }

  /**
   * Open a recently accessed file using the global file viewer.
   * @param {string} fileId
   * @param {string} clientMatter
   */
  function openRecentFile(fileId, clientMatter) {
    if (window.openFileViewer) {
      window.openFileViewer(fileId);
    } else {
      console.error('[Drive] openFileViewer not available');
    }
  }

  /**
   * Load pinned matters and render them in the pinned section.
   * Silently fails since pinned are not critical.
   */
  async function loadPinnedMatters() {
    try {
      console.log('[Drive] loadPinnedMatters() called');

      var response = await api.get('/api/v1/matters?limit=100&page=1');
      console.log('[Drive] Matters API response:', response);

      if (response && response.matters && response.matters.length > 0) {
        console.log('[Drive] Total matters:', response.matters.length);

        var pinnedMatters = response.matters.filter(function (m) { return m.is_pinned; });
        console.log('[Drive] Pinned matters found:', pinnedMatters.length, pinnedMatters);

        if (pinnedMatters.length > 0) {
          pinnedMatters.sort(function (a, b) {
            var aTime = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
            var bTime = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
            return bTime - aTime;
          });

          var pinnedSection = document.getElementById('pinnedSection');
          var pinnedFiles = document.getElementById('pinnedFiles');
          var pinnedCount = document.getElementById('pinnedCount');

          console.log('[Drive] Pinned section elements:', { pinnedSection: pinnedSection, pinnedFiles: pinnedFiles, pinnedCount: pinnedCount });

          if (pinnedSection && pinnedFiles && pinnedCount) {
            pinnedFiles.innerHTML = pinnedMatters.map(function (matter) {
              return renderMatterCard(matter, true);
            }).join('');
            pinnedCount.textContent = pinnedMatters.length + ' ' + (pinnedMatters.length === 1 ? 'item' : 'items');
            pinnedSection.classList.remove('hidden');
            console.log('[Drive] Pinned section displayed successfully');
          } else {
            console.error('[Drive] Pinned section DOM elements not found!');
          }
        } else {
          console.log('[Drive] No pinned matters to display');
        }
      } else {
        console.log('[Drive] No matters in response');
      }
    } catch (error) {
      console.error('[Drive] Failed to load pinned matters:', error);
      // Silently fail - pinned are not critical
    }
  }

  /**
   * Render a matter card for use in pinned or recents sections.
   * Uses data attributes on the menu button to avoid JS string escaping issues.
   * @param {Object} matter
   * @param {boolean} isPinned
   * @returns {string} HTML string
   */
  function renderMatterCard(matter, isPinned) {
    var matterName = escapeHtml(matter.name || matter.matter_id);
    var matterNumber = escapeHtml(matter.matter_id || '');
    var docCount = matter.document_count || 0;
    var folderCount = matter.folder_count || matter.child_folder_count || 0;
    var lastModified = matter.updated_at ? new Date(matter.updated_at).toLocaleDateString() : '';

    return [
      '<div class="file-card bg-white rounded-lg shadow-sm border border-gray-200 p-4 cursor-pointer relative group hover:shadow-md transition-shadow"',
      '     onclick="navigateToMatter(' + JSON.stringify(matter.matter_id) + ', ' + JSON.stringify(matter.name || matter.matter_id) + ')">',
      isPinned
        ? '<div class="absolute top-2 right-8 p-1 rounded-full bg-yellow-50 border border-yellow-200" title="Pinned"><svg class="w-3 h-3 text-yellow-600" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg></div>'
        : '',
      '<button class="matter-menu-btn absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"',
      '        data-matter-id="' + matterNumber + '"',
      '        data-matter-name="' + matterName + '"',
      '        data-is-pinned="' + (matter.is_pinned || isPinned) + '"',
      '        data-source="' + escapeHtml(matter.source || 'lana') + '"',
      '        onclick="event.stopPropagation(); showMatterActionsModal(event)"',
      '        title="More options">',
      '  <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
      '    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>',
      '  </svg>',
      '</button>',
      '<div class="flex flex-col items-center text-center">',
      '  <div class="w-12 h-12 mb-3 flex items-center justify-center">',
      '    <svg class="w-12 h-12 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
      '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
      '    </svg>',
      '  </div>',
      '  <p class="text-sm font-medium text-gray-900 text-center truncate w-full mb-1" title="' + matterName + '">' + matterName + '</p>',
      matterNumber ? '  <p class="text-xs text-gray-500 font-mono text-center truncate w-full mb-1" title="' + matterNumber + '">' + matterNumber + '</p>' : '',
      '  <div class="flex items-center gap-2 text-xs text-gray-500">',
      '    <span>' + docCount + ' ' + (docCount === 1 ? 'file' : 'files') + '</span>',
      '    <span>\u2022</span>',
      '    <span>' + folderCount + ' ' + (folderCount === 1 ? 'folder' : 'folders') + '</span>',
      '  </div>',
      lastModified ? '  <p class="text-xs text-gray-400 mt-1">' + lastModified + '</p>' : '',
      '</div>',
      '</div>'
    ].join('');
  }

  /**
   * Toggle the pinned state of a matter.
   * Reloads pinned, recent, and main content sections on success.
   * @param {string} matterId
   * @param {string} matterSource
   * @param {boolean} isPinned
   */
  async function togglePin(matterId, matterSource, isPinned) {
    try {
      if (isPinned) {
        await api.unpinMatter(matterId, matterSource);
        Lex.Toast.success('Matter unpinned');
      } else {
        await api.pinMatter(matterId, matterSource);
        Lex.Toast.success('Matter pinned');
      }

      await Promise.all([
        loadPinnedMatters(),
        loadRecentMatters(),
        loadFolderContents()
      ]);
    } catch (error) {
      console.error('[Drive] Failed to toggle pin:', error);
      Lex.Toast.error(error.message || 'Failed to update pin status');
    }
  }

  /**
   * Return the SVG icon string for a given MIME content type.
   * Delegates to the global getFileIconSVG from lex.icons.js.
   * @param {string} contentType
   * @returns {string} SVG HTML string
   */
  function getFileIconSVG(contentType) {
    if (window.getFileIconSVG) {
      return window.getFileIconSVG(contentType);
    }

    // Fallback if lex.icons.js not yet loaded
    if (!contentType) {
      return '<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
    }

    if (contentType.indexOf('pdf') !== -1) {
      return '<svg class="w-10 h-10 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8.5 13.5v3h1v-1h.5a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1.5zm1 1h.5v1h-.5v-1zm2.5-1v3h1.5a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H12zm1 1h.5v1H13v-1zm2.5-1v3h1v-1.5h.5v-1h-.5v-.5h1v-1h-2z"/></svg>';
    }
    if (contentType.indexOf('word') !== -1 || contentType.indexOf('document') !== -1) {
      return '<svg class="w-10 h-10 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM9 13l1.5 6 1.5-4 1.5 4 1.5-6h-1l-.75 3-1.25-3.5h-.5L10.25 16 9.5 13H9z"/></svg>';
    }
    if (contentType.indexOf('csv') !== -1 || contentType.indexOf('sheet') !== -1 || contentType.indexOf('excel') !== -1) {
      return '<svg class="w-10 h-10 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 13h2v2H8v-2zm0 3h2v2H8v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2z"/></svg>';
    }
    if (contentType.indexOf('image') !== -1) {
      return '<svg class="w-10 h-10 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
    }
    if (contentType.indexOf('presentation') !== -1 || contentType.indexOf('powerpoint') !== -1) {
      return '<svg class="w-10 h-10 text-orange-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM9 13v6h1.5v-2h1a1.5 1.5 0 0 0 1.5-1.5v-1a1.5 1.5 0 0 0-1.5-1.5H9zm1.5 1.5h1v1h-1v-1z"/></svg>';
    }
    if (contentType.indexOf('video') !== -1) {
      return '<svg class="w-10 h-10 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>';
    }
    if (contentType.indexOf('audio') !== -1) {
      return '<svg class="w-10 h-10 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>';
    }
    if (contentType.indexOf('zip') !== -1 || contentType.indexOf('archive') !== -1 || contentType.indexOf('compressed') !== -1) {
      return '<svg class="w-10 h-10 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"></path></svg>';
    }
    if (contentType.indexOf('text') !== -1) {
      return '<svg class="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>';
    }

    return '<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
  }

  // ── Conversation actions (from inline script) ────────────────────────

  /**
   * Open the conversation actions modal for a given thread.
   * @param {string} threadId
   * @param {string} title
   * @param {string|null} matterId
   */
  function openConversationActionsModal(threadId, title, matterId) {
    selectedConversationId = threadId;
    selectedConversationTitle = title;
    selectedConversationMatterId = matterId;
    selectedConversationIsProject = matterId !== null;

    // Decode HTML entities using Lex.Utils (no regex)
    var decodedTitle = Lex.Utils.decodeHtmlEntities(title);
    var titleEl = document.getElementById('modalConversationTitle');
    if (titleEl) titleEl.textContent = decodedTitle;

    var matterBtn = document.getElementById('viewMatterDetailsBtn');
    if (matterBtn) {
      if (matterId && matterId !== 'null') {
        matterBtn.classList.remove('hidden');
      } else {
        matterBtn.classList.add('hidden');
      }
    }

    var modal = document.getElementById('conversationActionsModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  /**
   * Close the conversation actions modal and reset its state.
   */
  function closeConversationActionsModal() {
    var modal = document.getElementById('conversationActionsModal');
    if (modal) {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
    }

    selectedConversationId = null;
    selectedConversationTitle = null;
    selectedConversationIsProject = false;
    selectedConversationMatterId = null;
  }

  /**
   * Transition from the conversation actions modal to the rename modal.
   */
  function editConversationFromModal() {
    if (!selectedConversationId || !selectedConversationTitle) {
      Lex.Toast.error('No conversation selected');
      closeConversationActionsModal();
      return;
    }

    var actionsModal = document.getElementById('conversationActionsModal');
    if (actionsModal) {
      actionsModal.classList.remove('flex');
      actionsModal.classList.add('hidden');
    }

    var renameModal = document.getElementById('renameConversationModal');
    var renameInput = document.getElementById('renameInput');

    // Decode HTML entities using Lex.Utils (no regex)
    var decodedTitle = Lex.Utils.decodeHtmlEntities(selectedConversationTitle);
    if (renameInput) renameInput.value = decodedTitle;

    if (renameModal) {
      renameModal.classList.remove('hidden');
      renameModal.classList.add('flex');
    }

    setTimeout(function () {
      if (renameInput) {
        renameInput.focus();
        renameInput.select();
      }
    }, 100);
  }

  /**
   * Close the rename conversation modal.
   */
  function closeRenameModal() {
    var modal = document.getElementById('renameConversationModal');
    if (modal) {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
    }
  }

  /**
   * Confirm and submit the renamed conversation title via API.
   */
  async function confirmRename() {
    if (!selectedConversationId) {
      Lex.Toast.error('No conversation selected');
      closeRenameModal();
      return;
    }

    var renameInput = document.getElementById('renameInput');
    var newTitle = renameInput ? renameInput.value.trim() : '';

    if (!newTitle) {
      Lex.Toast.error('Conversation name cannot be empty');
      return;
    }

    try {
      await api.put('/api/v1/chat/sessions/' + selectedConversationId, {
        title: newTitle
      });

      Lex.Toast.success('Conversation renamed');
      closeRenameModal();

      if (typeof ConversationMenu !== 'undefined') {
        await ConversationMenu.loadConversations(true);
      }
    } catch (error) {
      console.error('[Drive] Failed to rename conversation:', error);
      Lex.Toast.error('Failed to rename conversation');
    }
  }

  /**
   * Navigate to the matter details page for the selected conversation's matter.
   */
  function viewMatterDetailsFromModal() {
    if (!selectedConversationMatterId) {
      Lex.Toast.error('No matter associated with this conversation');
      return;
    }

    window.location.href = 'workspaces.html?matter_id=' + selectedConversationMatterId;
  }

  /**
   * Initiate conversation deletion from the conversation actions modal.
   * Shows a custom confirmation modal before executing.
   */
  function deleteConversationFromModal() {
    var confirmTitle = selectedConversationIsProject
      ? 'Delete Project Conversation?'
      : 'Delete Conversation?';

    var confirmMessage = selectedConversationIsProject
      ? 'This will only delete the chat messages. The matter/project itself will NOT be deleted and you can create new conversations for it later.'
      : 'This action cannot be undone. All messages in this conversation will be permanently deleted.';

    openDeleteConfirmModal(confirmTitle, confirmMessage);
  }

  /**
   * Open the custom delete confirmation modal with dynamic title and message.
   * @param {string} title
   * @param {string} message
   */
  function openDeleteConfirmModal(title, message) {
    var titleEl = document.getElementById('deleteConfirmTitle');
    var messageEl = document.getElementById('deleteConfirmMessage');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    var modal = document.getElementById('deleteConfirmModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
  }

  /**
   * Close the custom delete confirmation modal.
   */
  function closeDeleteConfirmModal() {
    var modal = document.getElementById('deleteConfirmModal');
    if (modal) {
      modal.classList.remove('flex');
      modal.classList.add('hidden');
    }
  }

  /**
   * Confirm and execute conversation deletion via API.
   */
  async function confirmDeleteConversation() {
    var conversationIdToDelete = selectedConversationId;
    if (!conversationIdToDelete) {
      Lex.Toast.error('No conversation selected');
      closeDeleteConfirmModal();
      closeConversationActionsModal();
      return;
    }

    try {
      closeDeleteConfirmModal();
      closeConversationActionsModal();

      await api.delete('/api/v1/chat/sessions/' + conversationIdToDelete);
      Lex.Toast.success('Conversation deleted');

      if (typeof ConversationMenu !== 'undefined') {
        await ConversationMenu.loadConversations(true);
      }
    } catch (error) {
      console.error('[Drive] Failed to delete conversation:', error);
      Lex.Toast.error('Failed to delete conversation');
    }
  }

  // ── Lifecycle hooks ──────────────────────────────────────────────────

  /**
   * Called by LexRouter when navigating to the drive page.
   * Initializes state, parses URL params, exposes globals, wires events,
   * and loads initial data.
   */
  function onEnter() {
    resetState();

    // Parse URL params
    var urlParams = new URLSearchParams(window.location.search);
    storageState.currentMatterId = urlParams.get('matter_id') || null;
    storageState.currentMatterName = urlParams.get('matter_name') || null;
    storageState.currentFolderId = urlParams.get('folder_id') || null;

    console.log('[Drive] onEnter - state:', {
      matterId: storageState.currentMatterId,
      matterName: storageState.currentMatterName,
      folderId: storageState.currentFolderId,
      isRootView: !storageState.currentMatterId
    });

    // Expose globals needed by inline onclick handlers in drive.html
    exposeGlobal('handleFolderClick', handleFolderClick);
    exposeGlobal('navigateToFolder', navigateToFolder);
    exposeGlobal('navigateToMatter', navigateToMatter);
    exposeGlobal('navigateToRoot', navigateToRoot);
    exposeGlobal('navigateToMatterBreadcrumb', navigateToMatterBreadcrumb);
    exposeGlobal('toggleFolder', toggleFolder);
    exposeGlobal('downloadFile', downloadFile);
    exposeGlobal('showFileMenu', showFileMenu);
    exposeGlobal('showFolderMenu', showFolderMenu);
    exposeGlobal('showMatterActionsModal', showMatterActionsModal);
    exposeGlobal('closeMatterActionsModal', closeMatterActionsModal);
    exposeGlobal('openMatterFromModal', openMatterFromModal);
    exposeGlobal('togglePinFromModal', togglePinFromModal);
    exposeGlobal('deleteMatterFromModal', deleteMatterFromModal);
    exposeGlobal('closeDeleteMatterConfirmModal', closeDeleteMatterConfirmModal);
    exposeGlobal('confirmDeleteMatter', confirmDeleteMatter);
    exposeGlobal('openConversationActionsModal', openConversationActionsModal);
    exposeGlobal('closeConversationActionsModal', closeConversationActionsModal);
    exposeGlobal('editConversationFromModal', editConversationFromModal);
    exposeGlobal('viewMatterDetailsFromModal', viewMatterDetailsFromModal);
    exposeGlobal('deleteConversationFromModal', deleteConversationFromModal);
    exposeGlobal('closeRenameModal', closeRenameModal);
    exposeGlobal('confirmRename', confirmRename);
    exposeGlobal('togglePin', togglePin);
    exposeGlobal('openRecentFile', openRecentFile);
    exposeGlobal('goToPreviousPage', goToPreviousPage);
    exposeGlobal('goToNextPage', goToNextPage);
    exposeGlobal('refreshPage', refreshPage);
    exposeGlobal('openDeleteConfirmModal', openDeleteConfirmModal);
    exposeGlobal('closeDeleteConfirmModal', closeDeleteConfirmModal);
    exposeGlobal('confirmDeleteConversation', confirmDeleteConversation);

    // Set up event listeners
    setupEventListeners();

    // Load initial data
    if (storageState.currentMatterId) {
      loadFolderContents();
      buildFolderPath();
    } else {
      loadFolderContents();
      Promise.all([loadRecentMatters(), loadPinnedMatters()]).catch(function (err) {
        console.error('[Drive] Failed to load recents/pinned:', err);
      });
    }

    updateViewButtons();
  }

  /**
   * Called by LexRouter when navigating away from the drive page.
   * Clears all intervals, timeouts, window globals, and document listeners.
   */
  function onLeave() {
    // Clear intervals and timeouts
    _intervals.forEach(clearInterval);
    _timeouts.forEach(clearTimeout);
    _intervals = [];
    _timeouts = [];

    // Remove window globals exposed by this module
    _globalFns.forEach(function (name) {
      delete window[name];
    });
    _globalFns = [];

    // Remove document-level listeners
    _documentListeners.forEach(function (entry) {
      document.removeEventListener(entry.event, entry.handler);
    });
    _documentListeners = [];

    // Reset module-level state
    pendingUploadFiles = null;
    selectedMatter = null;
    selectedConversationId = null;
    selectedConversationTitle = null;
    selectedConversationIsProject = false;
    selectedConversationMatterId = null;

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
  }

  // ── Register with router ─────────────────────────────────────────────
  if (window.LexRouter) {
    LexRouter.registerView({ onEnter: onEnter, onLeave: onLeave });
  }
  onEnter();

})();

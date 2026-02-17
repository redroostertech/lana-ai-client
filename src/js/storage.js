/**
 * LanaAI My Drivetorage Management
 *
 * Google Drive-like file and folder management with:
 * - Hierarchical folder tree navigation
 * - Grid and list view toggle
 * - Breadcrumb navigation
 * - Matter-scoped access (all operations include matter_id)
 */

// ============================================================
// STATE MANAGEMENT
// ============================================================
const storageState = {
  currentMatterId: null,
  currentMatterName: null,  // Store matter name for breadcrumbs
  currentFolderId: null,
  currentFolderPath: [],
  viewMode: 'grid', // 'grid' or 'list'
  folders: [],
  files: [],
  loadingFolders: false,
  loadingContent: false,
  // Search, sort, and filter state
  searchQuery: '',
  sortBy: 'name',
  sortOrder: 'asc',
  sourceFilter: 'all',
  totalResults: 0,
  currentPage: 1,
  totalPages: 0,
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Storage] Initializing My Drive');

  // Render the dynamic menu
  if (typeof renderMenu === 'function') {
    renderMenu('#mainNav');
  }

  // Get matter_id, matter_name, and folder_id from URL params (optional)
  console.log('[Storage] window.location.search:', window.location.search);
  console.log('[Storage] window.location.href:', window.location.href);

  const urlParams = new URLSearchParams(window.location.search);
  storageState.currentMatterId = urlParams.get('matter_id') || null;
  storageState.currentMatterName = urlParams.get('matter_name') || null;
  storageState.currentFolderId = urlParams.get('folder_id') || null;

  // If no matter_id, we're at ROOT level - show all matters as folders
  console.log('[Storage] Initialization:', {
    matterId: storageState.currentMatterId,
    matterName: storageState.currentMatterName,
    folderId: storageState.currentFolderId,
    isRootView: !storageState.currentMatterId
  });

  // Set up event listeners
  setupEventListeners();

  // Load initial data
  if (storageState.currentMatterId) {
    // Inside a matter: load folder contents
    // Note: loadFolderTree() removed as folder tree UI is not implemented in storage.html
    await loadFolderContents();
    // Initialize breadcrumbs for matter view
    buildFolderPath();
  } else {
    // Root view: load all matters
    await loadFolderContents();

    // Load recents and pinned matters ONLY at root level (in parallel, non-blocking)
    Promise.all([
      loadRecentMatters(),
      loadPinnedMatters()
    ]).catch(err => console.error('[Storage] Failed to load recents/pinned:', err));
  }

  // Update UI based on current view
  updateViewButtons();

  // Hide preloader and show content
  hidePreloader();
});


// ============================================================
// VIEW MANAGEMENT
// ============================================================

/**
 * Update button visibility based on current view (root vs matter)
 */
function updateViewButtons() {
  const uploadBtn = document.getElementById('uploadBtn');
  const newFolderBtn = document.getElementById('newFolderBtn');

  if (storageState.currentMatterId) {
    // Inside a matter: show ONLY upload button (no subfolders yet)
    uploadBtn?.classList.remove('hidden');
    newFolderBtn?.classList.add('hidden');
  } else {
    // Root view: show ONLY new folder button (creates matters)
    uploadBtn?.classList.add('hidden');
    newFolderBtn?.classList.remove('hidden');
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEventListeners() {
  // New Folder buttons
  document.getElementById('newFolderBtn')?.addEventListener('click', showNewFolderModal);
  document.getElementById('emptyStateNewFolderBtn')?.addEventListener('click', showNewFolderModal);
  document.getElementById('cancelNewFolderBtn')?.addEventListener('click', hideNewFolderModal);
  document.getElementById('newFolderForm')?.addEventListener('submit', handleCreateFolder);

  // Upload button - trigger file picker
  document.getElementById('uploadBtn')?.addEventListener('click', () => {
    document.getElementById('fileUploadInput')?.click();
  });
  // When files are selected, show hints modal instead of immediately uploading
  document.getElementById('fileUploadInput')?.addEventListener('change', handleFileSelection);

  // Single file upload modal handlers
  document.getElementById('cancelSingleUploadBtn')?.addEventListener('click', hideSingleUploadModal);
  document.getElementById('confirmSingleUploadBtn')?.addEventListener('click', handleSingleFileUploadWithHints);

  // Bulk upload modal handlers
  document.getElementById('cancelBulkUploadBtn')?.addEventListener('click', hideBulkUploadModal);
  document.getElementById('confirmBulkUploadBtn')?.addEventListener('click', handleBulkUploadWithHints);
  document.getElementById('applyToAllBtn')?.addEventListener('click', applyHintsToAll);

  // View toggle buttons
  document.getElementById('gridViewBtn')?.addEventListener('click', () => switchView('grid'));
  document.getElementById('listViewBtn')?.addEventListener('click', () => switchView('list'));

  // Search, sort, and filter controls
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const sortSelect = document.getElementById('sortSelect');
  const sortOrderBtn = document.getElementById('sortOrderBtn');
  const sourceFilter = document.getElementById('sourceFilter');

  // Search with debounce
  let searchTimeout;
  searchInput?.addEventListener('input', (e) => {
    const query = e.target.value;
    clearSearchBtn?.classList.toggle('hidden', !query);

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      storageState.searchQuery = query;
      storageState.currentPage = 1;
      loadFolderContents();
    }, 500); // 500ms debounce
  });

  // Clear search
  clearSearchBtn?.addEventListener('click', () => {
    searchInput.value = '';
    storageState.searchQuery = '';
    storageState.currentPage = 1;
    clearSearchBtn.classList.add('hidden');
    loadFolderContents();
  });

  // Sort by dropdown
  sortSelect?.addEventListener('change', (e) => {
    storageState.sortBy = e.target.value;
    storageState.currentPage = 1;
    loadFolderContents();
  });

  // Sort order toggle
  sortOrderBtn?.addEventListener('click', () => {
    const currentOrder = sortOrderBtn.dataset.order;
    const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
    sortOrderBtn.dataset.order = newOrder;
    storageState.sortOrder = newOrder;
    storageState.currentPage = 1;

    // Update icon
    const icon = document.getElementById('sortOrderIcon');
    if (newOrder === 'asc') {
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path>';
      sortOrderBtn.title = 'Sort ascending';
    } else {
      icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h6m3 0h9m-9 4h13m-5 8l-4 4m0 0l-4-4m4 4V8"></path>';
      sortOrderBtn.title = 'Sort descending';
    }

    loadFolderContents();
  });

  // Source filter
  sourceFilter?.addEventListener('change', (e) => {
    storageState.sourceFilter = e.target.value;
    storageState.currentPage = 1;
    loadFolderContents();
  });
}

// ============================================================
// FOLDER TREE NAVIGATION
// ============================================================
async function loadFolderTree() {
  console.log('[Storage] Loading folder tree for matter:', storageState.currentMatterId);
  storageState.loadingFolders = true;

  const loadingEl = document.getElementById('folderTreeLoading');
  const treeEl = document.getElementById('folderTree');
  const emptyEl = document.getElementById('folderTreeEmpty');

  loadingEl?.classList.remove('hidden');
  treeEl?.classList.add('hidden');
  emptyEl?.classList.add('hidden');

  try {
    // ROOT VIEW: Load all matters as top-level folders
    if (!storageState.currentMatterId) {
      const response = await api.get('/api/v1/matters?status=active&limit=100');

      if (response.matters) {
        // Convert matters to folder-like objects
        storageState.folders = response.matters.map(matter => ({
          id: matter.id,
          name: matter.name || matter.matter_id,
          matter_id: matter.matter_id,
          isMatter: true, // Flag to identify this is a matter, not a folder
          document_count: 0,
          child_folder_count: 0
        }));
        renderFolderTree();
      } else {
        throw new Error(response.error || 'Failed to load matters');
      }
    }
    // MATTER VIEW: Load folders for specific matter
    else {
      const response = await api.get(`/api/v1/storage/folders?matter_id=${storageState.currentMatterId}`);

      if (response.status === 'success' || response.data) {
        storageState.folders = response.data?.folders || response.folders || [];
        renderFolderTree();
      } else {
        throw new Error(response.error || 'Failed to load folders');
      }
    }
  } catch (error) {
    console.error('[Storage] Failed to load folder tree:', error);
    showErrorNotification('Failed to load folders. Please try again.');

    // Show empty state on error
    loadingEl?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
  } finally {
    storageState.loadingFolders = false;
  }
}

function renderFolderTree() {
  const treeEl = document.getElementById('folderTree');
  const loadingEl = document.getElementById('folderTreeLoading');
  const emptyEl = document.getElementById('folderTreeEmpty');

  loadingEl?.classList.add('hidden');

  if (!storageState.folders || storageState.folders.length === 0) {
    emptyEl?.classList.remove('hidden');
    treeEl?.classList.add('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');
  treeEl?.classList.remove('hidden');

  // Build hierarchical structure (root folders first)
  const rootFolders = storageState.folders.filter(f => !f.parent_folder_id);

  if (treeEl) {
    treeEl.innerHTML = rootFolders.map(folder => renderFolderTreeItem(folder, 0)).join('');
  }
}

function renderFolderTreeItem(folder, depth) {
  const isActive = folder.id === storageState.currentFolderId;
  const hasChildren = folder.child_folder_count > 0;
  const indent = depth * 16; // 16px per level

  const childFolders = storageState.folders.filter(f => f.parent_folder_id === folder.id);

  // Different onclick handler for matters vs folders
  const onclickHandler = folder.isMatter
    ? `navigateToMatter('${folder.matter_id}', '${escapeHtml(folder.name)}')`
    : `navigateToFolder('${folder.id}', '${escapeHtml(folder.name)}')`;

  return `
    <div class="folder-item-container">
      <div
        class="folder-item flex items-center py-2 px-3 rounded ${isActive ? 'active' : ''}"
        data-folder-id="${folder.id}"
        data-folder-name="${escapeHtml(folder.name)}"
        onclick="${onclickHandler}"
        style="padding-left: ${indent + 12}px"
      >
        ${hasChildren ? `
          <button
            class="folder-toggle mr-1 text-gray-400 hover:text-gray-600"
            onclick="event.stopPropagation(); toggleFolder('${folder.id}')"
          >
            <svg class="w-4 h-4 transform transition-transform" data-folder-id="${folder.id}-arrow">
              <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"></path>
            </svg>
          </button>
        ` : '<span class="w-5"></span>'}

        <svg class="w-4 h-4 mr-2 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>

        <span class="text-sm font-medium text-gray-700 truncate">${escapeHtml(folder.name)}</span>
        ${folder.document_count > 0 ? `<span class="ml-auto text-xs text-gray-500">${folder.document_count}</span>` : ''}
      </div>

      ${hasChildren ? `
        <div class="folder-children" data-folder-id="${folder.id}-children">
          ${childFolders.map(child => renderFolderTreeItem(child, depth + 1)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function toggleFolder(folderId) {
  const childrenEl = document.querySelector(`[data-folder-id="${folderId}-children"]`);
  const arrowEl = document.querySelector(`[data-folder-id="${folderId}-arrow"]`);

  if (childrenEl && arrowEl) {
    childrenEl.classList.toggle('expanded');
    arrowEl.classList.toggle('rotate-180');
  }
}

function navigateToFolder(folderId, folderName) {
  console.log('[Storage] Navigating to folder:', folderId, folderName);

  // Ensure we have a matter_id - folders can only exist within a matter
  if (!storageState.currentMatterId) {
    console.error('[Storage] Cannot navigate to folder without matter_id');
    showErrorNotification('Cannot navigate to folder. Please select a matter first.');
    return;
  }

  // Update URL params
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set('matter_id', storageState.currentMatterId);
  if (folderId && folderId !== 'root') {
    urlParams.set('folder_id', folderId);
  } else {
    urlParams.delete('folder_id');
  }
  window.history.pushState({}, '', `${window.location.pathname}?${urlParams}`);

  // Update state
  storageState.currentFolderId = folderId === 'root' ? null : folderId;

  // Build folder path for breadcrumbs (needs current folder state)
  buildFolderPath();

  // Reload content - this will also reload folders if needed
  loadFolderContents();
}

function navigateToMatter(matterId, matterName) {
  console.log('[Storage] Navigating to matter:', matterId, matterName);

  // Navigate to storage.html with matter_id and matter_name parameters
  const params = new URLSearchParams({
    matter_id: matterId,
    matter_name: matterName
  });
  console.log("[Storage] Would navigate to:", `/storage.html?${params.toString()}`);
  window.location.href = `/storage.html?${params.toString()}`;
}

function buildFolderPath() {
  storageState.currentFolderPath = [];

  // Build folder path if we're in a subfolder
  if (storageState.currentFolderId) {
    let currentId = storageState.currentFolderId;
    while (currentId) {
      const folder = storageState.folders.find(f => f.id === currentId);
      if (folder) {
        storageState.currentFolderPath.unshift({
          id: folder.id,
          name: folder.name,
        });
        currentId = folder.parent_folder_id;
      } else {
        break;
      }
    }
  }

  // Always render breadcrumbs (even at matter root)
  renderBreadcrumbs();
}

function renderBreadcrumbs() {
  const breadcrumbsEl = document.getElementById('breadcrumbs');
  if (!breadcrumbsEl) return;

  // Home link goes to root view (no matter selected)
  let html = `<a href="storage.html" class="hover:text-indigo-600 cursor-pointer">Home</a>`;

  // Add matter name if we're inside a matter
  if (storageState.currentMatterId) {
    // Use stored matter name from URL params or fallback to matter_id
    const matterName = storageState.currentMatterName || storageState.currentMatterId;

    html += `<span class="breadcrumb-separator">/</span>`;
    if (!storageState.currentFolderId) {
      // We're at matter root
      html += `<span class="text-gray-900 font-medium">${escapeHtml(matterName)}</span>`;
    } else {
      // We're in a subfolder - make matter name clickable
      const params = new URLSearchParams({
        matter_id: storageState.currentMatterId,
        matter_name: matterName
      });
      html += `<a href="storage.html?${params.toString()}" class="hover:text-indigo-600 cursor-pointer">${escapeHtml(matterName)}</a>`;
    }
  }

  // Add folder path
  storageState.currentFolderPath.forEach((folder, index) => {
    html += `<span class="breadcrumb-separator">/</span>`;
    if (index === storageState.currentFolderPath.length - 1) {
      // Last item (current folder) - not clickable
      html += `<span class="text-gray-900 font-medium">${escapeHtml(folder.name)}</span>`;
    } else {
      html += `<a href="#" class="hover:text-indigo-600" onclick="navigateToFolder('${folder.id}', '${escapeHtml(folder.name)}'); return false;">${escapeHtml(folder.name)}</a>`;
    }
  });

  breadcrumbsEl.innerHTML = html;
}

// ============================================================
// FOLDER CONTENTS (FILES + SUBFOLDERS)
// ============================================================

/**
 * Handle folder/matter card click using data attributes
 */
function handleFolderClick(element) {
  console.log('[Storage] handleFolderClick called', {
    dataset: element.dataset,
    isMatter: element.dataset.isMatter,
    matterId: element.dataset.matterId,
    folderId: element.dataset.folderId,
    name: element.dataset.name,
    currentMatterId: storageState.currentMatterId,
    currentFolderId: storageState.currentFolderId
  });

  const isMatter = element.dataset.isMatter === 'true';
  const name = element.dataset.name;

  if (isMatter) {
    const matterId = element.dataset.matterId;
    if (!matterId) {
      console.error('[Storage] No matter ID found in dataset');
      showErrorNotification('Cannot navigate: missing matter ID');
      return;
    }
    console.log('[Storage] Navigating to matter:', matterId, name);
    navigateToMatter(matterId, name);
  } else {
    const folderId = element.dataset.folderId;
    if (!folderId) {
      console.error('[Storage] No folder ID found in dataset');
      showErrorNotification('Cannot navigate: missing folder ID');
      return;
    }
    console.log('[Storage] Navigating to folder:', folderId, name);
    navigateToFolder(folderId, name);
  }
}

/**
 * Update the results count display
 */
function updateResultsCount() {
  const resultsCountEl = document.getElementById('resultsCount');
  if (!resultsCountEl) return;

  // ROOT VIEW: Show pagination results
  if (!storageState.currentMatterId) {
    const start = storageState.totalResults > 0 ? (storageState.currentPage - 1) * 100 + 1 : 0;
    const end = Math.min(storageState.currentPage * 100, storageState.totalResults);

    if (storageState.totalResults === 0) {
      resultsCountEl.textContent = 'No results found';
    } else if (storageState.searchQuery || storageState.sourceFilter !== 'all') {
      // Show filtered results message
      resultsCountEl.textContent = `Showing ${start}-${end} of ${storageState.totalResults} results`;
    } else {
      // Show total count
      resultsCountEl.textContent = `${storageState.totalResults} matter${storageState.totalResults !== 1 ? 's' : ''}`;
    }
  } else {
    // MATTER VIEW: Show folder and file counts
    const folderCount = storageState.folders.length;
    const fileCount = storageState.files.length;
    const total = folderCount + fileCount;

    if (total === 0) {
      resultsCountEl.textContent = 'Empty folder';
    } else {
      const parts = [];
      if (fileCount > 0) parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`);
      if (folderCount > 0) parts.push(`${folderCount} folder${folderCount !== 1 ? 's' : ''}`);
      resultsCountEl.textContent = parts.join(' • ');
    }
  }
}

async function loadFolderContents() {
  console.log('[Storage] Loading folder contents:', storageState.currentFolderId);
  storageState.loadingContent = true;

  const loadingEl = document.getElementById('contentLoading');
  const gridViewEl = document.getElementById('gridView');
  const listViewEl = document.getElementById('listView');
  const emptyEl = document.getElementById('contentEmpty');

  loadingEl?.classList.remove('hidden');
  gridViewEl?.classList.add('hidden');
  listViewEl?.classList.add('hidden');
  emptyEl?.classList.add('hidden');

  try {
    // ROOT VIEW: Load all matters as folders from /api/v1/storage/root
    if (!storageState.currentMatterId) {
      // Build query parameters from state
      const params = new URLSearchParams({
        page: storageState.currentPage,
        limit: 100,
        sort: storageState.sortBy,
        order: storageState.sortOrder
      });

      // Add optional search parameter
      if (storageState.searchQuery) {
        params.append('search', storageState.searchQuery);
      }

      // Add source filter (if not 'all')
      if (storageState.sourceFilter !== 'all') {
        params.append('source', storageState.sourceFilter);
      }

      const response = await api.get(`/api/v1/storage/root?${params.toString()}`);

      if (response.success && response.matters) {
        // Convert matters to folder-like objects
        storageState.folders = response.matters.map(matter => ({
          id: matter.id,
          name: matter.name || matter.matter_id,
          matter_id: matter.matter_id,
          isMatter: true, // Flag to identify this is a matter, not a folder
          is_pinned: matter.is_pinned || false,
          document_count: matter.document_count || 0,
          child_folder_count: matter.folder_count || 0,
          source: matter.source,  // 'client_matters' or 'connector'
          connector_id: matter.connector_id,  // null for client matters
          created_at: matter.created_at,
          updated_at: matter.updated_at
        }));
        storageState.files = [];

        // Update pagination state from response
        if (response.pagination) {
          storageState.totalResults = response.pagination.total;
          storageState.totalPages = response.pagination.total_pages;
        }

        // Update results count display
        updateResultsCount();

        renderFolderContents();
      } else {
        throw new Error(response.error || 'Failed to load matters');
      }
      return;
    }

    // MATTER VIEW: Fetch folders and files from API (matter-scoped)
    const foldersResponse = await api.get(`/api/v1/storage/folders?matter_id=${storageState.currentMatterId}`);

    if (foldersResponse.status === 'success' || foldersResponse.data || foldersResponse.folders) {
      storageState.folders = foldersResponse.data?.folders || foldersResponse.folders || [];
    } else {
      console.warn('[Storage] Failed to load folders:', foldersResponse.error);
      storageState.folders = [];
    }

    // Build query parameters for files API with search support
    const fileParams = new URLSearchParams({
      matter_id: storageState.currentMatterId
    });

    if (storageState.currentFolderId) {
      fileParams.append('folder_id', storageState.currentFolderId);
    }

    // Add search query if present
    if (storageState.searchQuery) {
      fileParams.append('search', storageState.searchQuery);
    }

    // Add source filter if not 'all'
    if (storageState.sourceFilter !== 'all') {
      fileParams.append('source', storageState.sourceFilter);
    }

    const filesResponse = await api.get(`/api/v1/storage/files?${fileParams.toString()}`);

    if (filesResponse.files || filesResponse.data || filesResponse.status === 'success') {
      storageState.files = filesResponse.data?.files || filesResponse.files || [];
      buildFolderPath();  // Build and render breadcrumbs
      updateResultsCount();
      renderFolderContents();

      // Track search if query is present
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
    console.error('[Storage] Failed to load folder contents:', error);
    showErrorNotification('Failed to load files. Please try again.');

    // Show empty state on error
    loadingEl?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
  } finally {
    storageState.loadingContent = false;
  }
}

function renderFolderContents() {
  const loadingEl = document.getElementById('contentLoading');
  const gridViewEl = document.getElementById('gridView');
  const listViewEl = document.getElementById('listView');
  const emptyEl = document.getElementById('contentEmpty');

  loadingEl?.classList.add('hidden');

  // Get folders at current level
  let foldersToShow = [];
  if (!storageState.currentMatterId) {
    // ROOT VIEW: Show all matters as folders
    foldersToShow = storageState.folders.filter(f => f.isMatter);
  } else {
    // MATTER VIEW: Show subfolders at current level
    foldersToShow = storageState.folders.filter(f => {
      if (!storageState.currentFolderId) {
        return !f.parent_folder_id; // Root level of matter
      }
      return f.parent_folder_id === storageState.currentFolderId;
    });
  }

  const totalItems = foldersToShow.length + storageState.files.length;

  if (totalItems === 0) {
    emptyEl?.classList.remove('hidden');
    gridViewEl?.classList.add('hidden');
    listViewEl?.classList.add('hidden');
    updatePaginationUI(); // Hide pagination when empty
    return;
  }

  emptyEl?.classList.add('hidden');

  // Sort: folders first (alphabetically), then files (by modified date)
  const sortedFolders = [...foldersToShow].sort((a, b) => a.name.localeCompare(b.name));
  const sortedFiles = [...storageState.files].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  if (storageState.viewMode === 'grid') {
    renderGridView(sortedFolders, sortedFiles);
    gridViewEl?.classList.remove('hidden');
    listViewEl?.classList.add('hidden');
  } else {
    renderListView(sortedFolders, sortedFiles);
    listViewEl?.classList.remove('hidden');
    gridViewEl?.classList.add('hidden');
  }

  // Update pagination UI
  updatePaginationUI();
}

function renderGridView(folders, files) {
  const gridViewEl = document.getElementById('gridView');
  if (!gridViewEl) return;

  const folderCards = folders.map(folder => {
    // For matters at root view, show both name and matter_id
    const displayHtml = folder.isMatter
      ? `
        <h3 class="text-sm font-medium text-gray-900 text-center truncate w-full">${escapeHtml(folder.name)}</h3>
        <p class="text-xs text-gray-600 font-mono text-center truncate w-full" title="${escapeHtml(folder.matter_id)}">${escapeHtml(folder.matter_id)}</p>
        <p class="text-xs text-gray-500 text-center mt-1">${folder.document_count || 0} files • ${folder.child_folder_count || 0} folders</p>
      `
      : `
        <h3 class="text-sm font-medium text-gray-900 text-center truncate w-full">${escapeHtml(folder.name)}</h3>
        <p class="text-xs text-gray-500 text-center mt-1">${folder.document_count || 0} files</p>
      `;

    // Use data attributes to avoid escaping issues
    const dataAttrs = folder.isMatter
      ? `data-is-matter="true" data-matter-id="${escapeHtml(folder.matter_id)}" data-name="${escapeHtml(folder.name)}"`
      : `data-is-matter="false" data-folder-id="${folder.id}" data-name="${escapeHtml(folder.name)}"`;

    // For matter cards, use the modal; for regular folders, use the old menu
    const menuButtonAttrs = folder.isMatter
      ? `data-matter-id="${escapeHtml(folder.matter_id)}" data-matter-name="${escapeHtml(folder.name)}" data-is-pinned="${folder.is_pinned || false}" data-source="${escapeHtml(folder.source || 'lana')}" onclick="event.stopPropagation(); showMatterActionsModal(event)"`
      : `onclick="event.stopPropagation(); showFolderMenu('${folder.id}', event)"`;

    return `
    <div
      class="grid-item bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow relative group"
      ${dataAttrs}
      onclick="handleFolderClick(this)"
    >
      <button
        class="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        ${menuButtonAttrs}
        style="opacity: 1"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
        </svg>
      </button>
      <div class="flex flex-col items-center">
        <svg class="w-16 h-16 text-indigo-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>
        ${displayHtml}
      </div>
    </div>
  `;
  }).join('');

  const fileCards = files.map(file => `
    <div
      class="grid-item bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow relative"
      onclick="openFileViewer('${file.id}')"
    >
      <button
        class="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        onclick="event.stopPropagation(); showFileMenu('${file.id}', event)"
        style="opacity: 1"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
        </svg>
      </button>
      <div class="flex flex-col items-center">
        ${getFileIcon(file.filename)}
        <h3 class="text-sm font-medium text-gray-900 text-center truncate w-full mt-2">${escapeHtml(file.filename)}</h3>
        <p class="text-xs text-gray-500 mt-1">${formatFileSize(file.file_size)}</p>
        <p class="text-xs text-gray-400">${formatDate(file.updated_at)}</p>
      </div>
    </div>
  `).join('');

  gridViewEl.innerHTML = folderCards + fileCards;
}

function renderListView(folders, files) {
  const listViewBodyEl = document.getElementById('listViewBody');
  if (!listViewBodyEl) return;

  const folderRows = folders.map(folder => {
    // Use data attributes to avoid escaping issues
    const dataAttrs = folder.isMatter
      ? `data-is-matter="true" data-matter-id="${escapeHtml(folder.matter_id)}" data-name="${escapeHtml(folder.name)}"`
      : `data-is-matter="false" data-folder-id="${folder.id}" data-name="${escapeHtml(folder.name)}"`;

    // For matters at root view, show both name and matter_id
    const displayHtml = folder.isMatter
      ? `
        <div class="flex items-center">
          <svg class="w-5 h-5 text-indigo-500 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-gray-900 truncate">${escapeHtml(folder.name)}</div>
            <div class="text-xs text-gray-600 font-mono truncate" title="${escapeHtml(folder.matter_id)}">${escapeHtml(folder.matter_id)}</div>
          </div>
        </div>
      `
      : `
        <div class="flex items-center">
          <svg class="w-5 h-5 text-indigo-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
          <span class="text-sm font-medium text-gray-900">${escapeHtml(folder.name)}</span>
        </div>
      `;

    // For matters, show file and folder counts
    const sizeDisplay = folder.isMatter
      ? `${folder.document_count || 0} files • ${folder.child_folder_count || 0} folders`
      : `${folder.document_count || 0} items`;

    // For matter rows, use the modal; for regular folders, use the old menu
    const menuButtonAttrs = folder.isMatter
      ? `data-matter-id="${escapeHtml(folder.matter_id)}" data-matter-name="${escapeHtml(folder.name)}" data-is-pinned="${folder.is_pinned || false}" data-source="${escapeHtml(folder.source || 'lana')}" onclick="event.stopPropagation(); showMatterActionsModal(event)"`
      : `onclick="event.stopPropagation(); showFolderMenu('${folder.id}', event)"`;

    return `
    <tr class="hover:bg-gray-50 cursor-pointer" ${dataAttrs} onclick="handleFolderClick(this)">
      <td class="px-6 py-4">
        <input type="checkbox" class="rounded text-indigo-600" onclick="event.stopPropagation()">
      </td>
      <td class="px-6 py-4">${displayHtml}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">—</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(folder.created_at)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${sizeDisplay}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        <button class="text-gray-400 hover:text-gray-600" ${menuButtonAttrs}>
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
          </svg>
        </button>
      </td>
    </tr>
  `;
  }).join('');

  const fileRows = files.map(file => `
    <tr class="hover:bg-gray-50 cursor-pointer" onclick="openFileViewer('${file.id}')">
      <td class="px-6 py-4">
        <input type="checkbox" class="rounded text-indigo-600" onclick="event.stopPropagation()">
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="flex items-center">
          ${getFileIconSmall(file.filename)}
          <span class="text-sm font-medium text-gray-900">${escapeHtml(file.filename)}</span>
        </div>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(file.created_by_username || 'Unknown')}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(file.created_at)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatFileSize(file.file_size)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        <button class="text-gray-400 hover:text-gray-600" onclick="event.stopPropagation(); showFileMenu('${file.id}', event)">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');

  listViewBodyEl.innerHTML = folderRows + fileRows;
}

// ============================================================
// VIEW TOGGLE
// ============================================================
function switchView(mode) {
  storageState.viewMode = mode;

  const gridBtn = document.getElementById('gridViewBtn');
  const listBtn = document.getElementById('listViewBtn');

  if (mode === 'grid') {
    gridBtn?.classList.add('text-indigo-600');
    gridBtn?.classList.remove('text-gray-400');
    listBtn?.classList.add('text-gray-400');
    listBtn?.classList.remove('text-indigo-600');
  } else {
    listBtn?.classList.add('text-indigo-600');
    listBtn?.classList.remove('text-gray-400');
    gridBtn?.classList.add('text-gray-400');
    gridBtn?.classList.remove('text-indigo-600');
  }

  renderFolderContents();
}

// ============================================================
// NEW FOLDER MODAL
// ============================================================
function showNewFolderModal() {
  const modal = document.getElementById('newFolderModal');
  modal?.classList.remove('hidden');
  document.getElementById('folderNameInput')?.focus();
}

function hideNewFolderModal() {
  const modal = document.getElementById('newFolderModal');
  modal?.classList.add('hidden');
  document.getElementById('folderNameInput').value = '';
}

async function handleCreateFolder(event) {
  event.preventDefault();

  const folderNameInput = document.getElementById('folderNameInput');
  const folderName = folderNameInput.value.trim();

  // BUG FIX #1: Validate folder name length
  if (!folderName) {
    showErrorNotification('Please enter a folder name');
    return;
  }

  if (folderName.length > 255) {
    showErrorNotification('Folder name must be 255 characters or less');
    return;
  }

  try {
    const response = await api.post('/api/v1/storage/folders', {
      name: folderName,
      matter_id: storageState.currentMatterId,
      parent_folder_id: storageState.currentFolderId || null,
    });

    if (response.status === 'success') {
      showSuccessNotification('Folder created successfully');
      hideNewFolderModal();

      // Reload folder contents (folder tree UI not implemented)
      await loadFolderContents();
    } else {
      console.error('[Storage] API returned error:', response);
      throw new Error(response.error || 'Failed to create folder');
    }
  } catch (error) {
    console.error('[Storage] Failed to create folder:', error);
    console.error('[Storage] Error details:', error.message, error.stack);
    showErrorNotification('Failed to create folder. Please try again.');
  }
}

// ============================================================
// FILE UPLOAD WITH HINTS
// ============================================================

// Store selected files temporarily for upload after hints are specified
let pendingUploadFiles = null;

/**
 * Handle file selection - show appropriate modal based on file count
 */
function handleFileSelection(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  pendingUploadFiles = Array.from(files);
  console.log('[Storage] Files selected:', pendingUploadFiles.length);

  if (pendingUploadFiles.length === 1) {
    // Single file: show single upload modal
    showSingleUploadModal(pendingUploadFiles[0]);
  } else {
    // Multiple files: show bulk upload grid modal
    showBulkUploadModal(pendingUploadFiles);
  }
}

/**
 * Show single file upload modal with hints
 */
function showSingleUploadModal(file) {
  const modal = document.getElementById('uploadSingleFileModal');
  const fileNameEl = document.getElementById('singleFileName');
  const fileSizeEl = document.getElementById('singleFileSize');
  const signaturesCheckbox = document.getElementById('singleHasSignatures');
  const formsCheckbox = document.getElementById('singleHasForms');

  if (fileNameEl) fileNameEl.textContent = file.name;
  if (fileSizeEl) fileSizeEl.textContent = formatFileSize(file.size);

  // Reset checkboxes to auto-detect (unchecked)
  if (signaturesCheckbox) signaturesCheckbox.checked = false;
  if (formsCheckbox) formsCheckbox.checked = false;

  modal?.classList.remove('hidden');
  modal?.classList.add('flex');
}

/**
 * Hide single file upload modal
 */
function hideSingleUploadModal() {
  const modal = document.getElementById('uploadSingleFileModal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');

  // Clear pending files and reset file input
  pendingUploadFiles = null;
  const fileInput = document.getElementById('fileUploadInput');
  if (fileInput) fileInput.value = '';
}

/**
 * Handle single file upload with hints
 */
async function handleSingleFileUploadWithHints() {
  if (!pendingUploadFiles || pendingUploadFiles.length !== 1) {
    showErrorNotification('No file selected');
    return;
  }

  const file = pendingUploadFiles[0];
  const signaturesCheckbox = document.getElementById('singleHasSignatures');
  const formsCheckbox = document.getElementById('singleHasForms');
  const hasSignatures = signaturesCheckbox ? signaturesCheckbox.checked : false;
  const hasForms = formsCheckbox ? formsCheckbox.checked : false;

  console.log('[Storage] Uploading file with hints:', {
    filename: file.name,
    hasSignatures,
    hasForms
  });

  hideSingleUploadModal();
  showNotification('Uploading file...', 'info');

  try {
    await api._readyPromise;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('matter_id', storageState.currentMatterId);
    if (storageState.currentFolderId) {
      formData.append('folder_id', storageState.currentFolderId);
    }

    // Add hints if specified
    if (hasSignatures || hasForms) {
      const hints = {};
      if (hasSignatures) hints.hasSignatures = true;
      if (hasForms) hints.hasForms = true;
      formData.append('hints', JSON.stringify(hints));
    }

    const response = await fetch(`${api.baseUrl}/api/v1/storage/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${api.token}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('[Storage] Upload successful:', result);

    showSuccessNotification('File uploaded successfully');

    // Track successful file upload
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
    console.error('[Storage] Failed to upload file:', error);
    showErrorNotification('Failed to upload file. Please try again.');
  }
}

/**
 * Show bulk upload grid modal
 */
function showBulkUploadModal(files) {
  const modal = document.getElementById('bulkUploadModal');
  const gridBodyEl = document.getElementById('bulkUploadGridBody');

  // Build grid rows
  const rows = files.map((file, index) => `
    <tr>
      <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(file.name)}</td>
      <td class="px-4 py-3 text-sm text-gray-500">${formatFileSize(file.size)}</td>
      <td class="px-4 py-3 text-sm text-gray-500 bulk-doc-type" data-index="${index}">${getFileType(file)}</td>
      <td class="px-4 py-3 text-center">
        <input type="checkbox" class="bulk-signatures-checkbox rounded text-indigo-600" data-index="${index}">
      </td>
      <td class="px-4 py-3 text-center">
        <input type="checkbox" class="bulk-forms-checkbox rounded text-indigo-600" data-index="${index}">
      </td>
    </tr>
  `).join('');

  if (gridBodyEl) gridBodyEl.innerHTML = rows;

  modal?.classList.remove('hidden');
  modal?.classList.add('flex');
}

/**
 * Hide bulk upload modal
 */
function hideBulkUploadModal() {
  const modal = document.getElementById('bulkUploadModal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');

  // Clear pending files and reset file input
  pendingUploadFiles = null;
  const fileInput = document.getElementById('fileUploadInput');
  if (fileInput) fileInput.value = '';
}

/**
 * Apply hints from first file to all files
 */
function applyHintsToAll() {
  const firstSignatures = document.querySelector('.bulk-signatures-checkbox[data-index="0"]')?.checked || false;
  const firstForms = document.querySelector('.bulk-forms-checkbox[data-index="0"]')?.checked || false;

  // Apply to all rows
  document.querySelectorAll('.bulk-signatures-checkbox').forEach(checkbox => {
    checkbox.checked = firstSignatures;
  });
  document.querySelectorAll('.bulk-forms-checkbox').forEach(checkbox => {
    checkbox.checked = firstForms;
  });

  showNotification('Hints applied to all files', 'success');
}

/**
 * Handle bulk upload with hints
 */
async function handleBulkUploadWithHints() {
  if (!pendingUploadFiles || pendingUploadFiles.length === 0) {
    showErrorNotification('No files selected');
    return;
  }

  // Collect hints for each file
  const filesWithHints = pendingUploadFiles.map((file, index) => {
    const hasSignatures = document.querySelector(`.bulk-signatures-checkbox[data-index="${index}"]`)?.checked || false;
    const hasForms = document.querySelector(`.bulk-forms-checkbox[data-index="${index}"]`)?.checked || false;

    const hints = {};
    if (hasSignatures) hints.hasSignatures = true;
    if (hasForms) hints.hasForms = true;

    return { file, hints: Object.keys(hints).length > 0 ? hints : null };
  });

  console.log('[Storage] Uploading', filesWithHints.length, 'files with hints');

  hideBulkUploadModal();
  showNotification(`Uploading ${filesWithHints.length} file(s)...`, 'info');

  try {
    await api._readyPromise;

    const uploadPromises = filesWithHints.map(async ({ file, hints }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('matter_id', storageState.currentMatterId);
      if (storageState.currentFolderId) {
        formData.append('folder_id', storageState.currentFolderId);
      }
      if (hints) {
        formData.append('hints', JSON.stringify(hints));
      }

      return fetch(`${api.baseUrl}/api/v1/storage/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${api.token}`
        },
        body: formData
      });
    });

    const responses = await Promise.all(uploadPromises);
    const failedUploads = responses.filter(r => !r.ok);

    if (failedUploads.length > 0) {
      throw new Error(`${failedUploads.length} file(s) failed to upload`);
    }

    const results = await Promise.all(responses.map(r => r.json()));
    console.log('[Storage] Bulk upload successful:', results);

    showSuccessNotification(`Successfully uploaded ${filesWithHints.length} file(s)`);

    // Track each successful bulk upload
    if (window.FeatureTracker) {
      for (const { file } of filesWithHints) {
        try {
          await window.FeatureTracker.trackFeature(window.Features.DOCUMENT_UPLOADED, {
            file_type: file.type || 'unknown',
            file_size: file.size,
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
    console.error('[Storage] Failed to upload files:', error);
    showErrorNotification('Failed to upload files. Please try again.');
  }
}

// ============================================================
// FILE OPERATIONS
// ============================================================
async function downloadFile(fileId) {
  console.log('[Storage] Downloading file:', fileId);

  try {
    // First, get file metadata to retrieve the filename
    const fileMetadata = await api.get(`/api/v1/storage/files/${fileId}`);
    if (!fileMetadata || !fileMetadata.filename) {
      throw new Error('Failed to retrieve file metadata');
    }

    const filename = fileMetadata.filename;

    // Download file using blob approach (prevents navigation/white screen)
    const response = await fetch(`${api.baseUrl}/api/v1/storage/files/${fileId}/download`, {
      headers: {
        'Authorization': `Bearer ${api.token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
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

    console.log('[Storage] Download started:', filename);
  } catch (error) {
    console.error('[Storage] Failed to download file:', error);
    showErrorNotification('Failed to download file. Please try again.');
  }
}

/**
 * Show context menu for file
 */
function showFileMenu(fileId, event) {
  console.log('[Storage] Show file menu:', fileId);
  event?.stopPropagation();

  const file = storageState.files.find(f => f.id === fileId);
  if (!file) return;

  const menuItems = [
    {
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>',
      label: 'Download',
      action: () => downloadFile(fileId)
    },
    {
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>',
      label: 'Preview',
      action: () => {
        hideContextMenu();
        showNotification('Preview feature coming soon!', 'info');
      }
    },
    {
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>',
      label: 'Rename',
      action: () => {
        hideContextMenu();
        showNotification('Rename feature coming soon!', 'info');
      }
    },
    {
      divider: true
    },
    {
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>',
      label: 'Delete',
      className: 'text-red-600 hover:bg-red-50',
      action: () => {
        hideContextMenu();
        showNotification('Delete feature coming soon!', 'info');
      }
    }
  ];

  showContextMenu(menuItems, event);
}

// Global state for matter actions modal
let selectedMatter = null;

/**
 * Show matter actions modal
 */
function showMatterActionsModal(event) {
  console.log('[Storage] Show matter actions modal');

  // Get data from the button element
  const button = event.currentTarget;
  const matterId = button.dataset.matterId;
  const matterName = button.dataset.matterName;
  const isPinned = button.dataset.isPinned === 'true';
  const source = button.dataset.source || 'lana';

  console.log('[Storage] Matter data:', { matterId, matterName, isPinned, source });

  // Store in global state
  selectedMatter = {
    matterId,
    matterName,
    isPinned,
    source
  };

  // Update modal content
  document.getElementById('modalMatterName').textContent = matterName;
  document.getElementById('modalMatterId').textContent = matterId;

  // Update pin button text
  const pinLabel = document.getElementById('pinBtnLabel');
  const pinDesc = document.getElementById('pinBtnDesc');
  if (isPinned) {
    pinLabel.textContent = 'Unpin Folder';
    pinDesc.textContent = 'Remove from pinned folders';
  } else {
    pinLabel.textContent = 'Pin Folder';
    pinDesc.textContent = 'Add to pinned folders';
  }

  // Show modal
  const modal = document.getElementById('matterActionsModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

/**
 * Close matter actions modal
 */
function closeMatterActionsModal() {
  const modal = document.getElementById('matterActionsModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  selectedMatter = null;
}

/**
 * Open matter from modal
 */
function openMatterFromModal() {
  if (!selectedMatter) return;
  
  // Save matter data before closing modal (which sets selectedMatter to null)
  const matterId = selectedMatter.matterId;
  const matterName = selectedMatter.matterName;
  
  closeMatterActionsModal();
  navigateToMatter(matterId, matterName);
}

/**
 * Toggle pin from modal
 */
async function togglePinFromModal() {
  if (!selectedMatter) return;
  
  // Save matter data before closing modal (which sets selectedMatter to null)
  const matterId = selectedMatter.matterId;
  const source = selectedMatter.source;
  const isPinned = selectedMatter.isPinned;
  
  closeMatterActionsModal();
  await togglePin(matterId, source, isPinned);
}

/**
 * Delete matter from modal - shows confirmation dialog
 */
function deleteMatterFromModal() {
  if (!selectedMatter) return;

  // Populate confirmation modal
  document.getElementById('deleteConfirmMatterName').textContent = selectedMatter.matterName;

  // Reset the confirm button state
  const btn = document.getElementById('confirmDeleteMatterBtn');
  btn.disabled = false;
  btn.textContent = 'Delete Folder';
  btn.classList.remove('opacity-50', 'cursor-not-allowed');

  // Close the options modal
  const optionsModal = document.getElementById('matterActionsModal');
  optionsModal.classList.add('hidden');
  optionsModal.classList.remove('flex');

  // Show confirmation modal
  const confirmModal = document.getElementById('deleteMatterConfirmModal');
  confirmModal.classList.remove('hidden');
  confirmModal.classList.add('flex');
}

/**
 * Close delete matter confirmation modal
 */
function closeDeleteMatterConfirmModal() {
  const modal = document.getElementById('deleteMatterConfirmModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  selectedMatter = null;
}

/**
 * Confirm and execute matter deletion
 */
async function confirmDeleteMatter() {
  if (!selectedMatter) return;

  const matterId = selectedMatter.matterId;
  const matterName = selectedMatter.matterName;

  // Disable button to prevent double-click
  const btn = document.getElementById('confirmDeleteMatterBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  btn.classList.add('opacity-50', 'cursor-not-allowed');

  try {
    await api.deleteMatter(matterId);
    closeDeleteMatterConfirmModal();
    showSuccessNotification(`Folder "${matterName}" deleted successfully`);

    // Reload all sections
    await Promise.all([
      loadPinnedMatters(),
      loadRecentMatters(),
      loadFolderContents()
    ]);
  } catch (error) {
    console.error('[Storage] Failed to delete matter:', error);
    showErrorNotification(error.message || 'Failed to delete folder');
    // Re-enable button on error
    btn.disabled = false;
    btn.textContent = originalText;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

// ============================================================
// PAGINATION FUNCTIONS
// ============================================================

/**
 * Update pagination UI elements based on current state
 */
function updatePaginationUI() {
  const paginationControls = document.getElementById('paginationControls');

  // Only show pagination in root view (when currentMatterId is null)
  if (!storageState.currentMatterId) {
    paginationControls?.classList.remove('hidden');

    // Calculate range
    const limit = 100; // Same as the limit in loadFolderContents
    const start = (storageState.currentPage - 1) * limit + 1;
    const end = Math.min(storageState.currentPage * limit, storageState.totalResults);

    // Update text elements
    document.getElementById('paginationStart').textContent = start;
    document.getElementById('paginationEnd').textContent = end;
    document.getElementById('paginationTotal').textContent = storageState.totalResults;
    document.getElementById('currentPageNum').textContent = storageState.currentPage;
    document.getElementById('totalPagesNum').textContent = storageState.totalPages || 1;

    // Enable/disable buttons
    const isFirstPage = storageState.currentPage === 1;
    const isLastPage = storageState.currentPage >= storageState.totalPages;

    // Desktop buttons
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
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

    // Mobile buttons
    const prevBtnMobile = document.getElementById('prevPageMobile');
    const nextBtnMobile = document.getElementById('nextPageMobile');
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
    // Hide pagination when inside a matter
    paginationControls?.classList.add('hidden');
  }
}

/**
 * Navigate to previous page
 */
async function goToPreviousPage() {
  if (storageState.currentPage > 1) {
    storageState.currentPage--;
    await loadFolderContents();
  }
}

/**
 * Navigate to next page
 */
async function goToNextPage() {
  if (storageState.currentPage < storageState.totalPages) {
    storageState.currentPage++;
    await loadFolderContents();
  }
}

/**
 * Refresh the page - reload all data
 */
async function refreshPage() {
  console.log('[Storage] Refreshing page...');

  // Show loading state
  const loadingEl = document.getElementById('contentLoading');
  if (loadingEl) {
    loadingEl.classList.remove('hidden');
  }

  // Reload all sections
  await Promise.all([
    loadPinnedMatters(),
    loadRecentMatters(),
    loadFolderContents()
  ]);

  console.log('[Storage] Page refreshed successfully');
}

/**
 * Show context menu for folder
 */
function showFolderMenu(event, folderOrId) {
  console.log('[Storage] Show folder menu:', folderOrId);
  if (event && event.stopPropagation) {
    event.stopPropagation();
  }

  // Handle both folder object and folder ID
  let folder;
  if (typeof folderOrId === 'object') {
    folder = folderOrId;
  } else {
    folder = storageState.folders.find(f => f.id === folderOrId);
  }

  if (!folder) return;

  const menuItems = [
    {
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
      label: 'Open',
      action: () => {
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
      action: () => {
        hideContextMenu();
        showNotification('Rename feature coming soon!', 'info');
      }
    }
  ];

  // Add pin/unpin option for matters (only at root level)
  console.log('[Storage] Pin check:', {
    isMatter: folder.isMatter,
    currentMatterId: storageState.currentMatterId,
    shouldShowPin: folder.isMatter && !storageState.currentMatterId,
    folder
  });

  if (folder.isMatter && !storageState.currentMatterId) {
    menuItems.push({
      icon: '<path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/>',
      label: folder.is_pinned ? 'Unpin' : 'Pin',
      action: async () => {
        hideContextMenu();
        await togglePin(folder.matter_id, folder.source || 'lana', folder.is_pinned || false);
      }
    });
  }

  menuItems.push(
    {
      divider: true
    },
    {
      icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>',
      label: 'Delete',
      className: 'text-red-600 hover:bg-red-50',
      action: () => {
        hideContextMenu();
        showNotification('Delete feature coming soon!', 'info');
      }
    }
  );

  showContextMenu(menuItems, event);
}

/**
 * Generic context menu display
 */
function showContextMenu(menuItems, event) {
  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  // Build menu HTML
  const menuHTML = menuItems.map(item => {
    if (item.divider) {
      return '<div class="border-t border-gray-200 my-1"></div>';
    }

    const className = item.className || 'text-gray-700 hover:bg-gray-100';
    return `
      <button
        class="w-full text-left px-4 py-2 text-sm ${className} flex items-center gap-3 transition-colors"
        onclick="window.contextMenuAction_${menuItems.indexOf(item)}()"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          ${item.icon}
        </svg>
        ${item.label}
      </button>
    `;
  }).join('');

  menu.innerHTML = menuHTML;

  // Store actions as global functions (temporary workaround for onclick)
  menuItems.forEach((item, index) => {
    if (!item.divider) {
      window[`contextMenuAction_${index}`] = item.action;
    }
  });

  // Make menu visible but invisible to calculate dimensions
  menu.style.visibility = 'hidden';
  menu.classList.remove('hidden');

  // Position menu near the click position
  const target = event?.currentTarget || event?.target;
  console.log('[Storage] Context menu - event:', event);
  console.log('[Storage] Context menu - currentTarget:', event?.currentTarget);
  console.log('[Storage] Context menu - target:', target);

  const rect = target?.getBoundingClientRect();
  console.log('[Storage] Context menu - rect:', rect);

  if (rect) {
    // Wait for next frame to get accurate dimensions
    requestAnimationFrame(() => {
      const menuWidth = menu.offsetWidth || 200;
      const menuHeight = menu.offsetHeight || 100;
      console.log('[Storage] Context menu - dimensions:', { menuWidth, menuHeight });

      // Calculate position (to the left of the button)
      let left = rect.left - menuWidth - 10;
      let top = rect.top;

      // Keep menu within viewport bounds
      if (left < 10) {
        // Not enough space on left, show on right instead
        left = rect.right + 10;
      }
      if (top + menuHeight > window.innerHeight - 10) {
        top = window.innerHeight - menuHeight - 10;
      }

      console.log('[Storage] Context menu - final position:', { left, top });
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.transform = 'none';

      // Make menu visible
      menu.style.visibility = 'visible';
    });
  } else {
    console.log('[Storage] Context menu - NO RECT, using center fallback');
    // Fallback to center
    menu.style.left = '50%';
    menu.style.top = '50%';
    menu.style.transform = 'translate(-50%, -50%)';
    menu.style.visibility = 'visible';
  }

  // Close menu when clicking outside
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu);
  }, 0);
}

/**
 * Hide context menu
 */
function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) {
    menu.classList.add('hidden');
  }
  document.removeEventListener('click', hideContextMenu);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get file type display name from file
 */
function getFileType(file) {
  // Try to get from MIME type first
  if (file.type) {
    const mimeMap = {
      'application/pdf': 'PDF',
      'application/msword': 'Word',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
      'application/vnd.ms-excel': 'Excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
      'application/vnd.ms-powerpoint': 'PowerPoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
      'text/plain': 'Text',
      'text/csv': 'CSV',
      'image/jpeg': 'Image',
      'image/jpg': 'Image',
      'image/png': 'Image',
      'image/gif': 'Image',
      'image/svg+xml': 'Image',
      'application/zip': 'ZIP',
      'application/x-zip-compressed': 'ZIP'
    };

    if (mimeMap[file.type]) {
      return mimeMap[file.type];
    }
  }

  // Fall back to file extension
  const ext = file.name.split('.').pop().toLowerCase();
  const extMap = {
    'pdf': 'PDF',
    'doc': 'Word',
    'docx': 'Word',
    'xls': 'Excel',
    'xlsx': 'Excel',
    'ppt': 'PowerPoint',
    'pptx': 'PowerPoint',
    'txt': 'Text',
    'csv': 'CSV',
    'jpg': 'Image',
    'jpeg': 'Image',
    'png': 'Image',
    'gif': 'Image',
    'svg': 'Image',
    'zip': 'ZIP'
  };

  return extMap[ext] || 'Unknown';
}

function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();

  const iconMap = {
    'pdf': 'text-red-500',
    'doc': 'text-blue-500',
    'docx': 'text-blue-500',
    'xls': 'text-green-500',
    'xlsx': 'text-green-500',
    'ppt': 'text-orange-500',
    'pptx': 'text-orange-500',
    'txt': 'text-gray-500',
    'jpg': 'text-purple-500',
    'jpeg': 'text-purple-500',
    'png': 'text-purple-500',
    'gif': 'text-purple-500',
  };

  const colorClass = iconMap[ext] || 'text-gray-400';

  return `
    <svg class="w-12 h-12 ${colorClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
    </svg>
  `;
}

function getFileIconSmall(filename) {
  const ext = filename.split('.').pop().toLowerCase();

  const iconMap = {
    'pdf': 'text-red-500',
    'doc': 'text-blue-500',
    'docx': 'text-blue-500',
    'xls': 'text-green-500',
    'xlsx': 'text-green-500',
    'ppt': 'text-orange-500',
    'pptx': 'text-orange-500',
    'txt': 'text-gray-500',
    'jpg': 'text-purple-500',
    'jpeg': 'text-purple-500',
    'png': 'text-purple-500',
    'gif': 'text-purple-500',
  };

  const colorClass = iconMap[ext] || 'text-gray-400';

  return `
    <svg class="w-5 h-5 ${colorClass} mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
    </svg>
  `;
}

/**
 * BUG FIX #3: Toast notification system (replaces alert())
 * Show toast notification with auto-dismiss and close button
 * @param {string} message - Notification message
 * @param {string} type - Notification type: 'success', 'error', 'warning', 'info'
 */
function showNotification(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) {
    // Fallback to console if container not found
    console.log(`[${type.toUpperCase()}] ${message}`);
    return;
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast-notification px-4 py-3 rounded-lg shadow-lg text-white transform transition-all duration-300 ease-in-out ${
    type === 'success' ? 'bg-green-600' :
    type === 'error' ? 'bg-red-600' :
    type === 'warning' ? 'bg-yellow-600' :
    'bg-blue-600'
  }`;

  toast.innerHTML = `
    <div class="flex items-center space-x-2">
      <span>${escapeHtml(message)}</span>
      <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-white hover:text-gray-200">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    </div>
  `;

  // Add to container
  container.appendChild(toast);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function showSuccessNotification(message) {
  console.log('[Storage] Success:', message);
  showNotification(message, 'success');
}

function showErrorNotification(message) {
  console.error('[Storage] Error:', message);
  showNotification(message, 'error');
}

function hidePreloader() {
  const preloader = document.getElementById('lana-preloader');
  const appContent = document.getElementById('app-content');

  if (preloader) {
    preloader.style.opacity = '0';
    setTimeout(() => {
      preloader.style.display = 'none';
      // Show app content
      if (appContent) {
        appContent.style.opacity = '1';
      }
    }, 300);
  }
}

// ============================================================================
// RECENTS AND PINNED MATTERS
// ============================================================================

async function loadRecentMatters() {
  try {
    // Get recently accessed files and matters in parallel
    const [filesResponse, mattersResponse] = await Promise.all([
      api.get('/api/v1/storage/recent?limit=8'),
      api.get('/api/v1/matters?limit=20&page=1')
    ]);

    const recentItems = [];

    // Add recent files from file_activity
    if (filesResponse && filesResponse.files && filesResponse.files.length > 0) {
      const recentFiles = filesResponse.files.map(file => ({
        type: 'file',
        data: file,
        timestamp: new Date(file.last_accessed_at || file.created_at)
      }));
      recentItems.push(...recentFiles);
    }

    // Add recent matters (sorted by updated_at)
    if (mattersResponse && mattersResponse.matters && mattersResponse.matters.length > 0) {
      const recentMatters = mattersResponse.matters
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 8)
        .map(matter => ({
          type: 'matter',
          data: matter,
          timestamp: new Date(matter.updated_at)
        }));
      recentItems.push(...recentMatters);
    }

    // Sort all items by timestamp and take top 8
    const sortedItems = recentItems
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 8);

    if (sortedItems.length > 0) {
      const recentsSection = document.getElementById('recentsSection');
      const recentFiles = document.getElementById('recentFiles');
      const recentsCount = document.getElementById('recentsCount');

      recentFiles.innerHTML = sortedItems.map(item => {
        if (item.type === 'matter') {
          return renderMatterCard(item.data, false);
        } else {
          return renderFileCardInRecents(item.data);
        }
      }).join('');

      recentsCount.textContent = `${sortedItems.length} ${sortedItems.length === 1 ? 'item' : 'items'}`;
      recentsSection.classList.remove('hidden');
    }
  } catch (error) {
    console.error('[Storage] Failed to load recent items:', error);
    // Silently fail - recents are not critical
  }
}

function renderFileCardInRecents(file) {
  const fileName = escapeHtml(file.filename || file.name);
  const fileSize = formatFileSize(file.file_size || 0);
  const fileIcon = getFileIconSVG(file.content_type);
  const lastAccessed = file.last_accessed_at ? new Date(file.last_accessed_at).toLocaleDateString() : '';

  return `
    <div class="file-card bg-white rounded-lg shadow-sm border border-gray-200 p-4 cursor-pointer relative group hover:shadow-md transition-shadow"
         onclick="openRecentFile('${file.id}', '${file.client_matter || ''}')">
      <div class="flex flex-col items-center text-center">
        <div class="w-12 h-12 mb-3 flex items-center justify-center">
          ${fileIcon}
        </div>
        <p class="text-sm font-medium text-gray-900 truncate w-full mb-1" title="${fileName}">
          ${fileName}
        </p>
        <p class="text-xs text-gray-500">${fileSize}</p>
        ${lastAccessed ? `<p class="text-xs text-gray-400 mt-1">${lastAccessed}</p>` : ''}
      </div>
    </div>
  `;
}

function openRecentFile(fileId, clientMatter) {
  // Open file viewer
  if (window.openFileViewer) {
    window.openFileViewer(fileId);
  } else {
    console.error('[Storage] openFileViewer not available');
  }
}

async function loadPinnedMatters() {
  try {
    console.log('[Storage] loadPinnedMatters() called');

    // Get all matters and filter pinned ones
    const response = await api.get('/api/v1/matters?limit=100&page=1');
    console.log('[Storage] Matters API response:', response);

    if (response && response.matters && response.matters.length > 0) {
      console.log('[Storage] Total matters:', response.matters.length);

      const pinnedMatters = response.matters.filter(m => m.is_pinned);
      console.log('[Storage] Pinned matters found:', pinnedMatters.length, pinnedMatters);

      if (pinnedMatters.length > 0) {
        // Sort by pinned_at (most recent first)
        pinnedMatters.sort((a, b) => {
          const aTime = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
          const bTime = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
          return bTime - aTime;
        });

        const pinnedSection = document.getElementById('pinnedSection');
        const pinnedFiles = document.getElementById('pinnedFiles');
        const pinnedCount = document.getElementById('pinnedCount');

        console.log('[Storage] Pinned section elements:', { pinnedSection, pinnedFiles, pinnedCount });

        if (pinnedSection && pinnedFiles && pinnedCount) {
          pinnedFiles.innerHTML = pinnedMatters.map(matter => renderMatterCard(matter, true)).join('');
          pinnedCount.textContent = `${pinnedMatters.length} ${pinnedMatters.length === 1 ? 'item' : 'items'}`;
          pinnedSection.classList.remove('hidden');
          console.log('[Storage] Pinned section displayed successfully');
        } else {
          console.error('[Storage] Pinned section DOM elements not found!');
        }
      } else {
        console.log('[Storage] No pinned matters to display');
      }
    } else {
      console.log('[Storage] No matters in response');
    }
  } catch (error) {
    console.error('[Storage] Failed to load pinned matters:', error);
    // Silently fail - pinned are not critical
  }
}

function renderMatterCard(matter, isPinned = false) {
  const matterName = escapeHtml(matter.name || matter.matter_id);
  const matterNumber = escapeHtml(matter.matter_id || '');
  const docCount = matter.document_count || 0;
  const folderCount = matter.folder_count || matter.child_folder_count || 0;
  const lastModified = matter.updated_at ? new Date(matter.updated_at).toLocaleDateString() : '';

  // Create a unique data object for the context menu
  const folderData = {
    matter_id: matter.matter_id,
    name: matter.name || matter.matter_id,
    isMatter: true,
    is_pinned: matter.is_pinned || isPinned,
    source: matter.source || 'lana',
    document_count: docCount,
    child_folder_count: folderCount
  };

  return `
    <div class="file-card bg-white rounded-lg shadow-sm border border-gray-200 p-4 cursor-pointer relative group hover:shadow-md transition-shadow"
         onclick="navigateToMatter('${matter.matter_id}', '${matterName.replace(/'/g, "\\'")}')">
      ${isPinned ? `
        <div class="absolute top-2 right-8 p-1 rounded-full bg-yellow-50 border border-yellow-200" title="Pinned">
          <svg class="w-3 h-3 text-yellow-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/>
          </svg>
        </div>
      ` : ''}
      <button class="matter-menu-btn absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
              data-matter-id="${matter.matter_id}"
              data-matter-name="${matterName.replace(/"/g, '&quot;')}"
              data-is-pinned="${matter.is_pinned || isPinned}"
              data-source="${matter.source || 'lana'}"
              onclick="event.stopPropagation(); showMatterActionsModal(event)"
              title="More options">
        <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>
        </svg>
      </button>
      <div class="flex flex-col items-center text-center">
        <div class="w-12 h-12 mb-3 flex items-center justify-center">
          <svg class="w-12 h-12 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
        </div>
        <p class="text-sm font-medium text-gray-900 text-center truncate w-full mb-1" title="${matterName}">
          ${matterName}
        </p>
        ${matterNumber ? `<p class="text-xs text-gray-500 font-mono text-center truncate w-full mb-1" title="${matterNumber}">${matterNumber}</p>` : ''}
        <div class="flex items-center gap-2 text-xs text-gray-500">
          <span>${docCount} ${docCount === 1 ? 'file' : 'files'}</span>
          <span>•</span>
          <span>${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}</span>
        </div>
        ${lastModified ? `<p class="text-xs text-gray-400 mt-1">${lastModified}</p>` : ''}
      </div>
    </div>
  `;
}

async function togglePin(matterId, matterSource, isPinned) {
  try {
    if (isPinned) {
      // Unpin the matter
      await api.unpinMatter(matterId, matterSource);
      showSuccessNotification('Matter unpinned');
    } else {
      // Pin the matter
      await api.pinMatter(matterId, matterSource);
      showSuccessNotification('Matter pinned');
    }

    // Reload both sections and main content
    await Promise.all([
      loadPinnedMatters(),
      loadRecentMatters(),
      loadFolderContents()
    ]);
  } catch (error) {
    console.error('[Storage] Failed to toggle pin:', error);
    showErrorNotification(error.message || 'Failed to update pin status');
  }
}

function getFileIconSVG(contentType) {
  if (!contentType) {
    return '<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
  }

  if (contentType.includes('pdf')) {
    return '<svg class="w-10 h-10 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8.5 13.5v3h1v-1h.5a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1.5zm1 1h.5v1h-.5v-1zm2.5-1v3h1.5a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H12zm1 1h.5v1H13v-1zm2.5-1v3h1v-1.5h.5v-1h-.5v-.5h1v-1h-2z"/></svg>';
  }
  if (contentType.includes('word') || contentType.includes('document')) {
    return '<svg class="w-10 h-10 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM9 13l1.5 6 1.5-4 1.5 4 1.5-6h-1l-.75 3-1.25-3.5h-.5L10.25 16 9.5 13H9z"/></svg>';
  }
  if (contentType.includes('csv') || contentType.includes('sheet') || contentType.includes('excel')) {
    return '<svg class="w-10 h-10 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 13h2v2H8v-2zm0 3h2v2H8v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2z"/></svg>';
  }
  if (contentType.includes('image')) {
    return '<svg class="w-10 h-10 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
  }
  if (contentType.includes('presentation') || contentType.includes('powerpoint')) {
    return '<svg class="w-10 h-10 text-orange-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM9 13v6h1.5v-2h1a1.5 1.5 0 0 0 1.5-1.5v-1a1.5 1.5 0 0 0-1.5-1.5H9zm1.5 1.5h1v1h-1v-1z"/></svg>';
  }
  if (contentType.includes('video')) {
    return '<svg class="w-10 h-10 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>';
  }
  if (contentType.includes('audio')) {
    return '<svg class="w-10 h-10 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>';
  }
  if (contentType.includes('zip') || contentType.includes('archive') || contentType.includes('compressed')) {
    return '<svg class="w-10 h-10 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"></path></svg>';
  }
  if (contentType.includes('text')) {
    return '<svg class="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>';
  }

  return '<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
}

// Export functions for global access
window.handleFolderClick = handleFolderClick;
window.navigateToFolder = navigateToMatter;
window.navigateToMatter = navigateToMatter;
window.toggleFolder = toggleFolder;
window.downloadFile = downloadFile;
window.showFileMenu = showFileMenu;
window.showFolderMenu = showFolderMenu;
window.togglePin = togglePin;
window.openRecentFile = openRecentFile;

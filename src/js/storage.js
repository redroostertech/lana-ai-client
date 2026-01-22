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
  const urlParams = new URLSearchParams(window.location.search);
  storageState.currentMatterId = urlParams.get('matter_id') || null;
  storageState.currentMatterName = urlParams.get('matter_name') || null;
  storageState.currentFolderId = urlParams.get('folder_id') || null;

  // If no matter_id, we're at ROOT level - show all matters as folders
  console.log('[Storage] Initialization:', {
    matterId: storageState.currentMatterId,
    folderId: storageState.currentFolderId,
    isRootView: !storageState.currentMatterId
  });

  // Set up event listeners
  setupEventListeners();

  // Load initial data
  if (storageState.currentMatterId) {
    // Inside a matter: load folder tree and contents
    await loadFolderTree();
    await loadFolderContents();
    // Initialize breadcrumbs for matter view
    buildFolderPath();
  } else {
    // Root view: just load all matters
    await loadFolderContents();
  }

  // Hide preloader and show content
  hidePreloader();
});

// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEventListeners() {
  // New Folder buttons
  document.getElementById('newFolderBtn')?.addEventListener('click', showNewFolderModal);
  document.getElementById('emptyStateNewFolderBtn')?.addEventListener('click', showNewFolderModal);
  document.getElementById('cancelNewFolderBtn')?.addEventListener('click', hideNewFolderModal);
  document.getElementById('newFolderForm')?.addEventListener('submit', handleCreateFolder);

  // Upload button
  document.getElementById('uploadBtn')?.addEventListener('click', () => {
    document.getElementById('fileUploadInput')?.click();
  });
  document.getElementById('fileUploadInput')?.addEventListener('change', handleFileUpload);

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

      if (response.success) {
        storageState.folders = response.folders || [];
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

  treeEl.innerHTML = rootFolders.map(folder => renderFolderTreeItem(folder, 0)).join('');
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

  // Build folder path for breadcrumbs
  buildFolderPath();

  // Reload content
  loadFolderContents();
}

function navigateToMatter(matterId, matterName) {
  console.log('[Storage] Navigating to matter:', matterId, matterName);

  // Navigate to storage.html with matter_id and matter_name parameters
  const params = new URLSearchParams({
    matter_id: matterId,
    matter_name: matterName
  });
  window.location.href = `/storage.html?${params.toString()}`;
}

function buildFolderPath() {
  storageState.currentFolderPath = [];

  if (!storageState.currentFolderId) {
    return; // At root
  }

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

  renderBreadcrumbs();
}

function renderBreadcrumbs() {
  const breadcrumbsEl = document.getElementById('breadcrumbs');
  if (!breadcrumbsEl) return;

  // Home link goes to root view (no matter selected)
  let html = `<a href="/storage.html" class="hover:text-indigo-600">Home</a>`;

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
      html += `<a href="/storage.html?${params.toString()}" class="hover:text-indigo-600">${escapeHtml(matterName)}</a>`;
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

    if (foldersResponse.success) {
      storageState.folders = foldersResponse.folders || [];
    } else {
      console.warn('[Storage] Failed to load folders:', foldersResponse.error);
      storageState.folders = [];
    }

    const folderParam = storageState.currentFolderId ? `&folder_id=${storageState.currentFolderId}` : '';
    const filesResponse = await api.get(`/api/v1/storage/files?matter_id=${storageState.currentMatterId}${folderParam}`);

    if (filesResponse.success) {
      storageState.files = filesResponse.files || [];
      buildFolderPath();  // Build and render breadcrumbs
      updateResultsCount();
      renderFolderContents();
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
}

function renderGridView(folders, files) {
  const gridViewEl = document.getElementById('gridView');
  if (!gridViewEl) return;

  const folderCards = folders.map(folder => {
    // Check if this is a matter (at root view) or a regular folder
    const clickHandler = folder.isMatter
      ? `navigateToMatter('${folder.matter_id}', '${escapeHtml(folder.name)}')`
      : `navigateToFolder('${folder.id}', '${escapeHtml(folder.name)}')`;

    // For matters at root view, show both name and matter_id
    const displayHtml = folder.isMatter
      ? `
        <h3 class="text-sm font-medium text-gray-900 text-center truncate w-full">${escapeHtml(folder.name)}</h3>
        <p class="text-xs text-gray-600 font-mono">${escapeHtml(folder.matter_id)}</p>
        <p class="text-xs text-gray-500 mt-1">${folder.document_count || 0} files • ${folder.child_folder_count || 0} folders</p>
      `
      : `
        <h3 class="text-sm font-medium text-gray-900 text-center truncate w-full">${escapeHtml(folder.name)}</h3>
        <p class="text-xs text-gray-500 mt-1">${folder.document_count || 0} files</p>
      `;

    return `
    <div
      class="grid-item bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow"
      onclick="${clickHandler}"
    >
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
      class="grid-item bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow"
      onclick="downloadFile('${file.id}')"
    >
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
    // Check if this is a matter (at root view) or a regular folder
    const clickHandler = folder.isMatter
      ? `navigateToMatter('${folder.matter_id}', '${escapeHtml(folder.name)}')`
      : `navigateToFolder('${folder.id}', '${escapeHtml(folder.name)}')`;

    // For matters at root view, show both name and matter_id
    const displayHtml = folder.isMatter
      ? `
        <div class="flex items-center">
          <svg class="w-5 h-5 text-indigo-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
          </svg>
          <div>
            <div class="text-sm font-medium text-gray-900">${escapeHtml(folder.name)}</div>
            <div class="text-xs text-gray-600 font-mono">${escapeHtml(folder.matter_id)}</div>
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

    return `
    <tr class="hover:bg-gray-50 cursor-pointer" onclick="${clickHandler}">
      <td class="px-6 py-4">
        <input type="checkbox" class="rounded text-indigo-600" onclick="event.stopPropagation()">
      </td>
      <td class="px-6 py-4">${displayHtml}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">—</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(folder.created_at)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${sizeDisplay}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        <button class="text-gray-400 hover:text-gray-600" onclick="event.stopPropagation(); showFolderMenu('${folder.id}')">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path>
          </svg>
        </button>
      </td>
    </tr>
  `;
  }).join('');

  const fileRows = files.map(file => `
    <tr class="hover:bg-gray-50 cursor-pointer" onclick="downloadFile('${file.id}')">
      <td class="px-6 py-4">
        <input type="checkbox" class="rounded text-indigo-600" onclick="event.stopPropagation()">
      </td>
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="flex items-center">
          ${getFileIconSmall(file.filename)}
          <span class="text-sm font-medium text-gray-900">${escapeHtml(file.filename)}</span>
        </div>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(file.uploaded_by_name || 'Unknown')}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(file.updated_at)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatFileSize(file.file_size)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        <button class="text-gray-400 hover:text-gray-600" onclick="event.stopPropagation(); showFileMenu('${file.id}')">
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

    if (response.success) {
      showSuccessNotification('Folder created successfully');
      hideNewFolderModal();

      // Reload folder tree and contents
      await loadFolderTree();
      await loadFolderContents();
    } else {
      throw new Error(response.error || 'Failed to create folder');
    }
  } catch (error) {
    console.error('[Storage] Failed to create folder:', error);
    showErrorNotification('Failed to create folder. Please try again.');
  }
}

// ============================================================
// FILE UPLOAD
// ============================================================
async function handleFileUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  console.log('[Storage] Uploading', files.length, 'file(s)');

  // BUG FIX #2: Show upload progress indicator
  showNotification(`Uploading ${files.length} file(s)...`, 'info');

  try {
    // Upload files using fetch (single file upload endpoint)
    await api._readyPromise;

    // Upload each file individually to /api/v1/storage/upload
    const uploadPromises = Array.from(files).map(async (file) => {
      const singleFileFormData = new FormData();
      singleFileFormData.append('file', file);
      singleFileFormData.append('matter_id', storageState.currentMatterId);
      if (storageState.currentFolderId) {
        singleFileFormData.append('folder_id', storageState.currentFolderId);
      }

      return fetch(`${api.baseUrl}/api/v1/storage/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${api.token}`
        },
        body: singleFileFormData
      });
    });

    const responses = await Promise.all(uploadPromises);
    const failedUploads = responses.filter(r => !r.ok);

    if (failedUploads.length > 0) {
      throw new Error(`${failedUploads.length} file(s) failed to upload`);
    }

    // Parse all responses
    const results = await Promise.all(responses.map(r => r.json()));
    console.log('[Storage] Upload successful:', results);

    // BUG FIX #2: Show success notification
    showSuccessNotification(`Successfully uploaded ${files.length} file(s)`);

    // Clear file input
    event.target.value = '';

    // Reload folder contents
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
    // Trigger download via API
    window.location.href = `/api/v1/storage/files/${fileId}/download?matter_id=${storageState.currentMatterId}`;
  } catch (error) {
    console.error('[Storage] Failed to download file:', error);
    showErrorNotification('Failed to download file. Please try again.');
  }
}

function showFileMenu(fileId) {
  console.log('[Storage] Show file menu:', fileId);
  // TODO: Implement context menu for file actions (rename, move, delete)
}

function showFolderMenu(folderId) {
  console.log('[Storage] Show folder menu:', folderId);
  // TODO: Implement context menu for folder actions (rename, move, delete)
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

// Export functions for global access
window.navigateToFolder = navigateToFolder;
window.navigateToMatter = navigateToMatter;
window.toggleFolder = toggleFolder;
window.downloadFile = downloadFile;
window.showFileMenu = showFileMenu;
window.showFolderMenu = showFolderMenu;

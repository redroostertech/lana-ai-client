/**
 * drive.js - My Drive page script (SPA lifecycle).
 * Root view only: matters list, pinned section, recents section, pagination.
 * Subfolder navigation, file uploads, and file operations live in folder.js.
 *
 * Dependencies (loaded via page descriptor before this file):
 *   - lex.utils.js   (escapeHtml, formatFileSize, formatRelativeDate, getFileType)
 *   - lex.icons.js   (getFileIcon, getFileIconSmall, getFileIconSVG)
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

  // Currently selected matter for the actions modal
  var selectedMatter = null;

  // Search debounce timer - module-level so onLeave can cancel it on SPA navigation
  var searchTimeout = null;

  // Brainchild scope controller (library/brainchild-scope.js). Created lazily the
  // first time the user switches the Source filter to "Knowledgebase".
  // It owns all bridge/status/promote logic; this page is presentation + wiring.
  var brainchildScope = null;

  // ── State reset ─────────────────────────────────────────────────────

  /**
   * Reset the storageState object to its default values.
   * Called on each onEnter to ensure a clean slate.
   */
  function resetState() {
    storageState = {
      viewMode: 'list',
      folders: [],
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
   * Update button state for drive.html root view.
   * Upload button does not exist on drive.html - only New Folder is enabled.
   */
  function updateViewButtons() {
    var newFolderBtn = document.getElementById('newFolderBtn');
    if (newFolderBtn) newFolderBtn.disabled = false;
  }

  /**
   * Fade-hide pinned and recents sections when searching, fade-show when cleared.
   * @param {string} query - current search input value
   */
  function toggleQuickSections(query) {
    var pinnedSection = document.getElementById('pinnedSection');
    var recentsSection = document.getElementById('recentsSection');
    var hasQuery = query.length > 0;

    [pinnedSection, recentsSection].forEach(function (el) {
      if (!el) return;
      if (hasQuery) {
        el.classList.add('drive-fade-out');
      } else {
        el.classList.remove('drive-fade-out');
      }
    });
  }

  // ── Event listeners ─────────────────────────────────────────────────

  /**
   * Wire up all DOM event listeners for the drive page.
   * Uses trackDocListener for document-level events so they are removed on onLeave.
   */
  function setupEventListeners() {
    // New Folder button
    var newFolderBtn = document.getElementById('newFolderBtn');
    newFolderBtn && newFolderBtn.addEventListener('click', showNewFolderModal);

    // Empty state new folder button - lex-empty fires 'action' event
    var contentEmptyWidget = document.getElementById('contentEmptyWidget');
    contentEmptyWidget && contentEmptyWidget.addEventListener('action', showNewFolderModal);

    var cancelNewFolderBtn = document.getElementById('cancelNewFolderBtn');
    cancelNewFolderBtn && cancelNewFolderBtn.addEventListener('click', hideNewFolderModal);

    var newFolderForm = document.getElementById('newFolderForm');
    newFolderForm && newFolderForm.addEventListener('submit', handleCreateFolder);

    // View toggle (plain buttons)
    var gridViewBtn = document.getElementById('gridViewBtn');
    gridViewBtn && gridViewBtn.addEventListener('click', function () { switchView('grid'); });

    var listViewBtn = document.getElementById('listViewBtn');
    listViewBtn && listViewBtn.addEventListener('click', function () { switchView('list'); });

    // Search with debounce - lex-input fires 'lex-input' and 'lex-change' events
    var searchLexInput = document.getElementById('searchInput');

    if (searchLexInput) {
      searchLexInput.addEventListener('lex-input', function (e) {
        var query = e.detail.value || '';
        toggleQuickSections(query);
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(function () {
          storageState.searchQuery = query;
          storageState.currentPage = 1;
          if (isBrainchildScope()) {
            runBrainchildSearch(query);
          } else {
            loadMatters({ silent: true });
          }
        }, 500);
      });

      // lex-change fires on clear / value commit
      searchLexInput.addEventListener('lex-change', function (e) {
        var query = e.detail.value || '';
        toggleQuickSections(query);
        storageState.searchQuery = query;
        storageState.currentPage = 1;
        if (isBrainchildScope()) {
          runBrainchildSearch(query);
        } else {
          loadMatters({ silent: true });
        }
      });
    }

    // Sort by dropdown - lex-select fires 'lex-change'
    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('lex-change', function (e) {
        storageState.sortBy = e.detail.value || 'name';
        storageState.currentPage = 1;
        if (isBrainchildScope()) return; // sort applies to matters/files only
        updateSortHeaderIndicators();
        loadMatters({ silent: true });
      });
    }

    // Sort order toggle (plain button)
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

        updateSortHeaderIndicators();
        if (isBrainchildScope()) return; // sort applies to matters/files only
        loadMatters({ silent: true });
      });
    }

    // Source filter - lex-select fires 'lex-change'
    var sourceFilter = document.getElementById('sourceFilter');
    if (sourceFilter) {
      sourceFilter.addEventListener('lex-change', function (e) {
        storageState.sourceFilter = e.detail.value || 'all';
        storageState.currentPage = 1;
        if (isBrainchildScope()) {
          // Clear any matters query and load the personal notes vault.
          storageState.searchQuery = '';
          var searchEl = document.getElementById('searchInput');
          if (searchEl) searchEl.value = '';
          loadBrainchildNotes();
        } else {
          hideBrainchildChrome();
          loadMatters({ silent: true });
        }
      });
    }

    // Pagination - lex-pagination fires 'page-change'
    var drivePagination = document.getElementById('drivePagination');
    if (drivePagination) {
      drivePagination.addEventListener('page-change', function (e) {
        storageState.currentPage = e.detail.page;
        if (isBrainchildScope()) return; // notes scope is single-page
        loadMatters();
      });
    }

    // Brainchild "Unlink" action on the connected banner.
    var bcUnlinkBtn = document.getElementById('bcUnlinkBtn');
    if (bcUnlinkBtn) {
      bcUnlinkBtn.addEventListener('click', function () {
        if (brainchildScope) brainchildScope.unlink();
      });
    }

    // Brainchild "Open Brainchild" action: deep-link into the Brainchild app at
    // the vault root via the frozen bridge. Guard for the bridge existing.
    var bcOpenAppBtn = document.getElementById('bcOpenAppBtn');
    if (bcOpenAppBtn) {
      bcOpenAppBtn.addEventListener('click', function () {
        if (window.electronAPI && window.electronAPI.brainchild &&
            typeof window.electronAPI.brainchild.openNote === 'function') {
          window.electronAPI.brainchild.openNote('');
        }
      });
    }

    // Matters list-view sortable column headers. Each clickable header drives the
    // same sortBy/sortOrder state the #sortSelect / #sortOrderBtn use, then
    // reloads matters so the server-side sort applies. Brainchild scope is unaffected.
    var sortHeaders = document.querySelectorAll('.drive-sort-th[data-sort-field]');
    Array.prototype.forEach.call(sortHeaders, function (header) {
      var activate = function () {
        if (isBrainchildScope()) return; // sort applies to matters/files only
        handleHeaderSort(header.getAttribute('data-sort-field'));
      };
      header.addEventListener('click', activate);
      header.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  /**
   * Sort the matters list by a column header field. Toggles asc/desc when the
   * same field is clicked again; defaults to asc when switching fields. Keeps
   * #sortSelect, #sortOrderBtn, and the active-column caret in sync, then reloads
   * matters so the server-side sort applies.
   * @param {string} field - storage sort field (name | created_at | document_count)
   */
  function handleHeaderSort(field) {
    if (!field) return;

    if (storageState.sortBy === field) {
      storageState.sortOrder = storageState.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      storageState.sortBy = field;
      storageState.sortOrder = 'asc';
    }
    storageState.currentPage = 1;

    syncSortControls();
    loadMatters({ silent: true });
  }

  /**
   * Reflect the active sortBy/sortOrder in the #sortSelect dropdown, the
   * #sortOrderBtn icon, and the list-view header carets.
   */
  function syncSortControls() {
    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect && sortSelect.value !== storageState.sortBy) {
      sortSelect.value = storageState.sortBy;
    }

    var sortOrderBtn = document.getElementById('sortOrderBtn');
    if (sortOrderBtn) {
      sortOrderBtn.dataset.order = storageState.sortOrder;
      var icon = document.getElementById('sortOrderIcon');
      if (icon) {
        if (storageState.sortOrder === 'asc') {
          icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"></path>';
          sortOrderBtn.title = 'Sort ascending';
        } else {
          icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h6m3 0h9m-9 4h13m-5 8l-4 4m0 0l-4-4m4 4V8"></path>';
          sortOrderBtn.title = 'Sort descending';
        }
      }
    }

    updateSortHeaderIndicators();
  }

  /**
   * Mark the active matters list-view column header and show its sort-direction
   * caret. Only one header carries the active state at a time.
   */
  function updateSortHeaderIndicators() {
    var headers = document.querySelectorAll('.drive-sort-th[data-sort-field]');
    Array.prototype.forEach.call(headers, function (header) {
      var field = header.getAttribute('data-sort-field');
      var active = field === storageState.sortBy;
      var asc = storageState.sortOrder === 'asc';
      header.classList.toggle('drive-sort-th--active', active);
      header.classList.toggle('drive-sort-th--asc', active && asc);
      header.classList.toggle('drive-sort-th--desc', active && !asc);
      header.setAttribute('aria-sort', active
        ? (asc ? 'ascending' : 'descending')
        : 'none');
    });
  }

  // ── Navigation ───────────────────────────────────────────────────────

  /**
   * Navigate into a matter by transitioning to folder.html via SPA nav.
   * @param {string} matterId
   * @param {string} matterName
   */
  function navigateToMatter(matterId, matterName) {
    var params = new URLSearchParams({
      matter_id: matterId,
      matter_name: matterName
    });
    Lex.Nav.go('folder.html?' + params.toString());
  }

  /**
   * Navigate back to root view - reloads the current page data.
   * We are already on drive.html so no URL change is needed.
   */
  function navigateToRoot() {
    storageState.searchQuery = '';
    storageState.currentPage = 1;
    loadMatters();
    Promise.all([loadRecentMatters(), loadPinnedMatters()]).catch(function (err) {
      console.error('[Drive] Failed to reload recents/pinned:', err);
    });
  }

  // ── Folder/matter click handler ──────────────────────────────────────

  /**
   * Handle a matter card click using data attributes.
   * On drive.html every clickable item is a matter, so we always navigate to matter.
   * @param {HTMLElement} element - The clicked element with data attributes
   */
  function handleFolderClick(element) {
    var matterId = element.dataset.matterId;
    var name = element.dataset.name;

    if (!matterId) {
      console.error('[Drive] No matter ID found in dataset');
      Lex.Toast.error('Cannot navigate: missing matter ID');
      return;
    }

    console.log('[Drive] Navigating to matter:', matterId, name);
    navigateToMatter(matterId, name);
  }

  // ── Matters load ─────────────────────────────────────────────────────

  /**
   * Load all matters for the root view from /api/v1/storage/root.
   * Supports pagination, search, sort, and source filter.
   * @param {Object} [opts]
   * @param {boolean} [opts.silent] - When true, skip the loading spinner
   */
  async function loadMatters(opts) {
    var silent = opts && opts.silent;
    console.log('[Drive] Loading matters' + (silent ? ' (silent)' : ''));

    var loadingEl = document.getElementById('contentLoading');
    var gridViewEl = document.getElementById('gridView');
    var listViewEl = document.getElementById('listView');
    var emptyEl = document.getElementById('contentEmpty');

    if (!silent) {
      loadingEl && loadingEl.classList.remove('hidden');
      gridViewEl && gridViewEl.classList.add('hidden');
      listViewEl && listViewEl.classList.add('hidden');
      emptyEl && emptyEl.classList.add('hidden');
    }

    try {
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

        if (response.pagination) {
          storageState.totalResults = response.pagination.total;
          storageState.totalPages = response.pagination.total_pages;
        }

        updateResultsCount();
        renderMatters();
      } else {
        throw new Error(response.error || 'Failed to load matters');
      }
    } catch (error) {
      console.error('[Drive] Failed to load matters:', error);
      Lex.Toast.error('Failed to load files. Please try again.');

      loadingEl && loadingEl.classList.add('hidden');
      emptyEl && emptyEl.classList.remove('hidden');
    }
  }

  // ── Results count ────────────────────────────────────────────────────

  /**
   * Update the results count text element based on current pagination state.
   */
  function updateResultsCount() {
    var resultsCountEl = document.getElementById('resultsCount');
    if (!resultsCountEl) return;

    var total = storageState.totalResults;
    var start = total > 0 ? (storageState.currentPage - 1) * 100 + 1 : 0;
    var end = Math.min(storageState.currentPage * 100, total);

    if (total === 0) {
      resultsCountEl.textContent = 'No results found';
    } else if (storageState.searchQuery || storageState.sourceFilter !== 'all') {
      resultsCountEl.textContent = 'Showing ' + start + '-' + end + ' of ' + total + ' results';
    } else {
      resultsCountEl.textContent = total + ' matter' + (total !== 1 ? 's' : '');
    }

    // Section header count
    var sectionCount = document.getElementById('driveSectionCount');
    if (sectionCount) {
      sectionCount.textContent = total + ' folder' + (total !== 1 ? 's' : '');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  /**
   * Render matter cards/rows into grid or list view based on storageState.viewMode.
   */
  function renderMatters() {
    var loadingEl = document.getElementById('contentLoading');
    var gridViewEl = document.getElementById('gridView');
    var listViewEl = document.getElementById('listView');
    var emptyEl = document.getElementById('contentEmpty');

    loadingEl && loadingEl.classList.add('hidden');

    var matters = storageState.folders.filter(function (f) { return f.isMatter; });

    if (matters.length === 0) {
      emptyEl && emptyEl.classList.remove('hidden');
      gridViewEl && gridViewEl.classList.add('hidden');
      listViewEl && listViewEl.classList.add('hidden');
      updatePaginationUI();
      return;
    }

    emptyEl && emptyEl.classList.add('hidden');

    var sorted = matters.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    if (storageState.viewMode === 'grid') {
      renderGridView(sorted);
      gridViewEl && gridViewEl.classList.remove('hidden');
      listViewEl && listViewEl.classList.add('hidden');
    } else {
      renderListView(sorted);
      listViewEl && listViewEl.classList.remove('hidden');
      gridViewEl && gridViewEl.classList.add('hidden');
    }

    updatePaginationUI();
  }

  /**
   * Render the grid view with matter cards only.
   * @param {Array} matters
   */
  function renderGridView(matters) {
    var gridViewEl = document.getElementById('gridView');
    if (!gridViewEl) return;

    var cards = matters.map(function (folder) {
      var displayHtml = [
        '<h3 class="text-sm font-medium text-center truncate w-full" style="color: var(--lex-text-primary)">' + escapeHtml(folder.name) + '</h3>',
        '<p class="text-xs font-mono text-center truncate w-full" style="color: var(--lex-text-secondary)" title="' + escapeHtml(folder.matter_id) + '">' + escapeHtml(folder.matter_id) + '</p>',
        '<p class="text-xs text-center mt-1" style="color: var(--lex-text-secondary)">' + (folder.document_count || 0) + ' files \u2022 ' + (folder.child_folder_count || 0) + ' folders</p>'
      ].join('');

      var dataAttrs = 'data-is-matter="true" data-matter-id="' + escapeHtml(folder.matter_id) + '" data-name="' + escapeHtml(folder.name) + '"';

      var menuButtonAttrs = 'data-matter-id="' + escapeHtml(folder.matter_id) + '" data-matter-name="' + escapeHtml(folder.name) + '" data-is-pinned="' + (folder.is_pinned || false) + '" data-source="' + escapeHtml(folder.source || 'lana') + '" onclick="event.stopPropagation(); showMatterActionsModal(event)"';

      return [
        '<div class="grid-item rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow relative group" style="background: var(--lex-bg-primary); border-color: var(--lex-border-default)" ' + dataAttrs + ' onclick="handleFolderClick(this)">',
        '  <button class="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--lex-text-tertiary); opacity: 1" ' + menuButtonAttrs + '>',
        '    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
        '  </button>',
        '  <div class="flex flex-col items-center">',
        '    <svg class="w-16 h-16 mb-2" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
        '    </svg>',
        '    ' + displayHtml,
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    gridViewEl.innerHTML = cards;
  }

  /**
   * Render the list/table view with matter rows only.
   * @param {Array} matters
   */
  function renderListView(matters) {
    var listViewBodyEl = document.getElementById('listViewBody');
    if (!listViewBodyEl) return;

    var rows = matters.map(function (folder) {
      var dataAttrs = 'data-is-matter="true" data-matter-id="' + escapeHtml(folder.matter_id) + '" data-name="' + escapeHtml(folder.name) + '"';

      var displayHtml = [
        '<div class="flex items-center">',
        '  <svg class="w-5 h-5 mr-3 flex-shrink-0" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
        '  </svg>',
        '  <div class="min-w-0 flex-1">',
        '    <div class="text-sm font-medium truncate" style="color: var(--lex-text-primary)">' + escapeHtml(folder.name) + '</div>',
        '    <div class="text-xs font-mono truncate" style="color: var(--lex-text-secondary)" title="' + escapeHtml(folder.matter_id) + '">' + escapeHtml(folder.matter_id) + '</div>',
        '  </div>',
        '</div>'
      ].join('');

      var sizeDisplay = (folder.document_count || 0) + ' files \u2022 ' + (folder.child_folder_count || 0) + ' folders';

      var menuButtonAttrs = 'data-matter-id="' + escapeHtml(folder.matter_id) + '" data-matter-name="' + escapeHtml(folder.name) + '" data-is-pinned="' + (folder.is_pinned || false) + '" data-source="' + escapeHtml(folder.source || 'lana') + '" onclick="event.stopPropagation(); showMatterActionsModal(event)"';

      return [
        '<tr class="cursor-pointer" style="background: transparent" onmouseover="this.style.background=\'var(--lex-bg-secondary)\'" onmouseout="this.style.background=\'transparent\'" ' + dataAttrs + ' onclick="handleFolderClick(this)">',
        '  <td class="px-6 py-4">' + displayHtml + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">\u2014</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">' + formatRelativeDate(folder.created_at) + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">' + sizeDisplay + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm">',
        '    <button style="color: var(--lex-text-tertiary)" ' + menuButtonAttrs + '>',
        '      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"></path></svg>',
        '    </button>',
        '  </td>',
        '</tr>'
      ].join('');
    }).join('');

    listViewBodyEl.innerHTML = rows;
  }

  // ── Brainchild scope (personal notes) ────────────────────────────────
  //
  // When the Source filter is set to "Knowledgebase" the list switches
  // from matters/files to the user's personal Brainchild vault notes. All
  // node/spawn/MCP logic lives in Electron main and is reached only through the
  // frozen window.electronAPI.brainchild bridge, wrapped by the already-built,
  // unit-tested LibraryBrainchildScope controller. This page only renders the
  // normalized rows through the existing grid/list renderers and shows the
  // status-driven connect / degraded chrome.

  /**
   * @returns {boolean} true when the active Source filter is the Brainchild scope.
   */
  function isBrainchildScope() {
    return storageState.sourceFilter === 'brainchild';
  }

  /**
   * Lazily construct the Brainchild scope controller. Returns null when the
   * controller module is unavailable (e.g. plain browser context).
   */
  function ensureBrainchildScope() {
    if (brainchildScope) return brainchildScope;
    if (!window.LibraryBrainchildScope || typeof window.LibraryBrainchildScope.create !== 'function') {
      return null;
    }
    brainchildScope = window.LibraryBrainchildScope.create({
      api: window.api,
      onToast: function (kind, message) {
        if (window.Lex && Lex.Toast && typeof Lex.Toast[kind] === 'function') {
          Lex.Toast[kind](message);
        }
      },
      onStatus: setBrainchildStatus,
      onChange: renderBrainchildScope
    });
    return brainchildScope;
  }

  /**
   * Show or clear the Brainchild status line (link / connect progress copy).
   * @param {string} message
   */
  function setBrainchildStatus(message) {
    var statusEl = document.getElementById('bcStatusLine');
    if (!statusEl) return;
    if (message) {
      statusEl.textContent = message;
      statusEl.classList.remove('library-bc-hidden');
    } else {
      statusEl.textContent = '';
      statusEl.classList.add('library-bc-hidden');
    }
  }

  /**
   * Hide all Brainchild-specific chrome (banner, degraded state, status line).
   * Called when leaving the Brainchild scope back to matters/files.
   */
  function hideBrainchildChrome() {
    var banner = document.getElementById('bcConnectedBanner');
    var degraded = document.getElementById('bcDegradedState');
    if (banner) banner.classList.add('library-bc-hidden');
    if (degraded) degraded.classList.add('library-bc-hidden');
    setBrainchildStatus('');
  }

  /**
   * Load the Brainchild vault notes and render the scope. Mounts the controller
   * on first use. In the normal auto-bound case status() returns linked and the
   * notes render with zero clicks.
   */
  async function loadBrainchildNotes() {
    var scope = ensureBrainchildScope();
    if (!scope) {
      // No controller (plain browser). Present the connect prompt copy.
      renderBrainchildDegraded({ status: 'degraded', reason: 'unavailable' });
      return;
    }

    var loadingEl = document.getElementById('contentLoading');
    loadingEl && loadingEl.classList.remove('hidden');
    hideBrainchildChrome();
    // Pinned and Recents are matters-only; hide them while the notes scope renders.
    var bcPinned = document.getElementById('pinnedSection');
    var bcRecents = document.getElementById('recentsSection');
    if (bcPinned) bcPinned.classList.add('hidden');
    if (bcRecents) bcRecents.classList.add('hidden');

    try {
      await scope.load();
    } catch (error) {
      console.error('[Drive] Failed to load Brainchild notes:', error);
    } finally {
      loadingEl && loadingEl.classList.add('hidden');
    }
    renderBrainchildScope();
  }

  /**
   * Run a vault search (or full list when query is empty) in the Brainchild scope.
   * @param {string} query
   */
  async function runBrainchildSearch(query) {
    var scope = ensureBrainchildScope();
    if (!scope) return;
    // Clearing the search returns to the folder view at the vault root.
    if (!(query || '').trim()) {
      scope.goToFolder('');
    }
    try {
      await scope.runSearch(query || '');
    } catch (error) {
      console.error('[Drive] Brainchild search failed:', error);
    }
    renderBrainchildScope();
  }

  /**
   * Render the current Brainchild scope state: connected (notes list + banner)
   * or degraded (hide list, show degraded copy + the contextual action).
   */
  function renderBrainchildScope() {
    if (!isBrainchildScope() || !brainchildScope) return;

    var status = brainchildScope.state.status || {};
    var loadingEl = document.getElementById('contentLoading');
    loadingEl && loadingEl.classList.add('hidden');

    if (brainchildScope.isConnected(status)) {
      renderBrainchildConnected(status);
    } else {
      renderBrainchildDegraded(status);
    }
  }

  /**
   * Connected render path: show the optional "Connected to Brainchild" banner
   * and render the normalized note rows through the shared grid/list renderers.
   * @param {Object} status
   */
  function renderBrainchildConnected(status) {
    var degraded = document.getElementById('bcDegradedState');
    var banner = document.getElementById('bcConnectedBanner');
    var sectionHeading = document.getElementById('driveSectionHeading');
    var sectionCount = document.getElementById('driveSectionCount');
    var resultsCountEl = document.getElementById('resultsCount');

    if (degraded) degraded.classList.add('library-bc-hidden');

    var allRows = Array.isArray(brainchildScope.state.rows) ? brainchildScope.state.rows : [];

    // When a search query is active, render flat results across the whole vault
    // (folders are ignored). Otherwise fold the rows into the current folder.
    var searching = !!(storageState.searchQuery && storageState.searchQuery.trim());
    var folders;
    var notes;
    if (searching) {
      folders = [];
      notes = allRows;
    } else {
      var view = brainchildScope.folderView();
      folders = view.folders || [];
      notes = view.notes || [];
    }

    if (banner) {
      banner.classList.remove('library-bc-hidden');
    }

    renderBrainchildBreadcrumb(searching ? '' : (brainchildScope.state.currentFolder || ''), searching);

    var itemCount = folders.length + notes.length;
    var countText = describeBrainchildCount(folders.length, notes.length);
    if (sectionHeading) sectionHeading.textContent = 'Knowledgebase';
    if (sectionCount) sectionCount.textContent = countText;
    if (resultsCountEl) resultsCountEl.textContent = countText;

    // Pagination is matters-only; hide its counts in this scope.
    var pager = document.getElementById('drivePagination');
    if (pager) {
      pager.page = 1;
      pager.totalPages = 1;
      pager.total = itemCount;
      pager.limit = itemCount || 1;
    }

    var emptyEl = document.getElementById('contentEmpty');
    var gridViewEl = document.getElementById('gridView');
    var listViewEl = document.getElementById('listView');

    if (itemCount === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (gridViewEl) gridViewEl.classList.add('hidden');
      if (listViewEl) listViewEl.classList.add('hidden');
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    if (storageState.viewMode === 'grid') {
      renderBrainchildGrid(folders, notes);
      if (gridViewEl) gridViewEl.classList.remove('hidden');
      if (listViewEl) listViewEl.classList.add('hidden');
    } else {
      renderBrainchildList(folders, notes);
      if (listViewEl) listViewEl.classList.remove('hidden');
      if (gridViewEl) gridViewEl.classList.add('hidden');
    }
  }

  /**
   * Build the count copy for the current folder view ("2 folders, 5 notes").
   * @param {number} folderCount
   * @param {number} noteCount
   * @returns {string}
   */
  function describeBrainchildCount(folderCount, noteCount) {
    var parts = [];
    if (folderCount > 0) {
      parts.push(folderCount + ' folder' + (folderCount !== 1 ? 's' : ''));
    }
    parts.push(noteCount + ' note' + (noteCount !== 1 ? 's' : ''));
    return parts.join(', ');
  }

  /**
   * Render the vault breadcrumb: "Knowledgebase" (root) then each path segment, all
   * clickable to jump there via the scope controller. Hidden while searching.
   * @param {string} folderPath - vault relative folder path ('' = root)
   * @param {boolean} searching - true when a search query is active
   */
  function renderBrainchildBreadcrumb(folderPath, searching) {
    var crumbEl = document.getElementById('bcBreadcrumb');
    if (!crumbEl) return;

    if (searching) {
      crumbEl.innerHTML = '';
      crumbEl.classList.add('library-bc-hidden');
      return;
    }

    crumbEl.classList.remove('library-bc-hidden');

    var segments = (folderPath || '').split('/').filter(function (s) { return !!s; });
    var rootActive = segments.length === 0;
    var crumbs = [
      '<button type="button" class="library-bc-crumb" data-bc-folder="" ' +
      (rootActive ? 'aria-current="page" ' : '') + '>Knowledgebase</button>'
    ];

    var accum = '';
    segments.forEach(function (segment, index) {
      accum = accum ? accum + '/' + segment : segment;
      var isLast = index === segments.length - 1;
      crumbs.push('<span class="library-bc-crumb-sep" aria-hidden="true">/</span>');
      crumbs.push(
        '<button type="button" class="library-bc-crumb" data-bc-folder="' + escapeHtml(accum) + '" ' +
        (isLast ? 'aria-current="page" ' : '') + '>' + escapeHtml(segment) + '</button>'
      );
    });

    crumbEl.innerHTML = crumbs.join('');

    var buttons = crumbEl.querySelectorAll('.library-bc-crumb');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        if (!brainchildScope) return;
        brainchildScope.goToFolder(button.getAttribute('data-bc-folder') || '');
      });
    });
  }

  /**
   * Degraded render path: hide the notes list and show the degraded copy plus
   * the contextual action (Choose folder / Reconnect / Connect).
   * @param {Object} status
   */
  function renderBrainchildDegraded(status) {
    var reason = (status && status.reason) || 'not_linked';
    var degraded = document.getElementById('bcDegradedState');
    var banner = document.getElementById('bcConnectedBanner');
    var copyEl = document.getElementById('bcDegradedCopy');
    var actionBtn = document.getElementById('bcDegradedAction');

    if (banner) banner.classList.add('library-bc-hidden');

    var gridViewEl = document.getElementById('gridView');
    var listViewEl = document.getElementById('listView');
    var emptyEl = document.getElementById('contentEmpty');
    if (gridViewEl) gridViewEl.classList.add('hidden');
    if (listViewEl) listViewEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    var sectionHeading = document.getElementById('driveSectionHeading');
    var sectionCount = document.getElementById('driveSectionCount');
    var resultsCountEl = document.getElementById('resultsCount');
    if (sectionHeading) sectionHeading.textContent = 'Knowledgebase';
    if (sectionCount) sectionCount.textContent = '';
    if (resultsCountEl) resultsCountEl.textContent = '';

    if (copyEl && brainchildScope) {
      copyEl.textContent = brainchildScope.degradedCopy(reason);
    }

    if (actionBtn) {
      // Choose the action label + handler by reason.
      var label = 'Connect Brainchild';
      var handler = function () { if (brainchildScope) brainchildScope.connect(); };
      if (reason === 'install_not_found' || reason === 'vault_not_found') {
        label = 'Choose folder';
        handler = function () { if (brainchildScope) brainchildScope.pickAndLink(); };
      } else if (reason === 'unlinked_by_user') {
        label = 'Reconnect Brainchild';
        handler = function () { if (brainchildScope) brainchildScope.reconnect(); };
      }
      actionBtn.textContent = label;
      actionBtn.onclick = handler;
    }

    if (degraded) degraded.classList.remove('library-bc-hidden');
  }

  /**
   * Render Brainchild folder cards (clickable to drill in) followed by note
   * cards, reusing the existing #gridView container. Each note card carries a
   * "Promote to Org" action when permitted.
   * @param {Array} folders - immediate child folders ({ name, path, count })
   * @param {Array} notes - normalized Brainchild row view models
   */
  function renderBrainchildGrid(folders, notes) {
    var gridViewEl = document.getElementById('gridView');
    if (!gridViewEl) return;

    var canPromote = brainchildScope && brainchildScope.canPromote();

    var folderCards = (folders || []).map(function (folder) {
      var folderName = escapeHtml(folder.name || '');
      var count = folder.count || 0;
      var countLabel = count + ' note' + (count !== 1 ? 's' : '');

      return [
        '<div class="grid-item rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow relative group library-bc-folder-card" style="background: var(--lex-bg-primary); border-color: var(--lex-border-default)" data-bc-folder-name="' + folderName + '">',
        '  <div class="flex flex-col items-center">',
        '    <svg class="w-16 h-16 mb-2" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
        '    </svg>',
        '    <h3 class="text-sm font-medium text-center truncate w-full" style="color: var(--lex-text-primary)" title="' + folderName + '">' + folderName + '</h3>',
        '    <p class="text-xs text-center mt-1" style="color: var(--lex-text-secondary)">' + countLabel + '</p>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    var noteCards = (notes || []).map(function (row, index) {
      var name = escapeHtml(row.filename || 'Untitled note');
      var vaultPath = escapeHtml(row._vaultPath || '');
      var promoteBtn = canPromote
        ? '<lex-btn class="library-bc-promote bc-promote-btn" variant="secondary" size="sm" data-bc-index="' + index + '" data-bc-path="' + vaultPath + '">Promote to Org</lex-btn>'
        : '';

      return [
        '<div class="grid-item rounded-lg border p-4 relative group library-bc-note-card" style="background: var(--lex-bg-primary); border-color: var(--lex-border-default)" data-bc-note-path="' + vaultPath + '">',
        '  <div class="flex flex-col items-center">',
        '    <svg class="w-16 h-16 mb-2" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>',
        '    </svg>',
        '    <h3 class="text-sm font-medium text-center truncate w-full" style="color: var(--lex-text-primary)" title="' + name + '">' + name + '</h3>',
        '    <p class="text-xs text-center mt-1" style="color: var(--lex-text-secondary)">Note</p>',
        '    ' + promoteBtn,
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    gridViewEl.innerHTML = folderCards + noteCards;
    wireBrainchildFolderCards(gridViewEl);
    wireBrainchildNoteCards(gridViewEl);
    wireBrainchildPromoteButtons(gridViewEl, notes);
  }

  /**
   * Render Brainchild folder rows (clickable to drill in) followed by note rows,
   * reusing the existing #listViewBody table body.
   * @param {Array} folders - immediate child folders ({ name, path, count })
   * @param {Array} notes - normalized Brainchild row view models
   */
  function renderBrainchildList(folders, notes) {
    var listViewBodyEl = document.getElementById('listViewBody');
    if (!listViewBodyEl) return;

    var canPromote = brainchildScope && brainchildScope.canPromote();

    var folderRows = (folders || []).map(function (folder) {
      var folderName = escapeHtml(folder.name || '');
      var count = folder.count || 0;
      var countLabel = count + ' note' + (count !== 1 ? 's' : '');

      return [
        '<tr class="cursor-pointer library-bc-folder-card" style="background: transparent" onmouseover="this.style.background=\'var(--lex-bg-secondary)\'" onmouseout="this.style.background=\'transparent\'" data-bc-folder-name="' + folderName + '">',
        '  <td class="px-6 py-4">',
        '    <div class="flex items-center">',
        '      <svg class="w-5 h-5 mr-3 flex-shrink-0" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
        '      </svg>',
        '      <div class="min-w-0 flex-1">',
        '        <div class="text-sm font-medium truncate" style="color: var(--lex-text-primary)" title="' + folderName + '">' + folderName + '</div>',
        '      </div>',
        '    </div>',
        '  </td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">You</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">-</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">' + countLabel + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm"></td>',
        '</tr>'
      ].join('');
    }).join('');

    var noteRows = (notes || []).map(function (row, index) {
      var name = escapeHtml(row.filename || 'Untitled note');
      var vaultPath = escapeHtml(row._vaultPath || '');
      var updated = row.updated_at ? formatRelativeDate(row.updated_at) : '-';
      var promoteCell = canPromote
        ? '<lex-btn class="bc-promote-btn" variant="secondary" size="sm" data-bc-index="' + index + '" data-bc-path="' + vaultPath + '">Promote to Org</lex-btn>'
        : '';

      return [
        '<tr class="cursor-pointer library-bc-note-card" style="background: transparent" onmouseover="this.style.background=\'var(--lex-bg-secondary)\'" onmouseout="this.style.background=\'transparent\'" data-bc-note-path="' + vaultPath + '">',
        '  <td class="px-6 py-4">',
        '    <div class="flex items-center">',
        '      <svg class="w-5 h-5 mr-3 flex-shrink-0" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>',
        '      </svg>',
        '      <div class="min-w-0 flex-1">',
        '        <div class="text-sm font-medium truncate" style="color: var(--lex-text-primary)" title="' + name + '">' + name + '</div>',
        '      </div>',
        '    </div>',
        '  </td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">You</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">' + updated + '</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">Note</td>',
        '  <td class="px-6 py-4 whitespace-nowrap text-sm">' + promoteCell + '</td>',
        '</tr>'
      ].join('');
    }).join('');

    listViewBodyEl.innerHTML = folderRows + noteRows;
    wireBrainchildFolderCards(listViewBodyEl);
    wireBrainchildNoteCards(listViewBodyEl);
    wireBrainchildPromoteButtons(listViewBodyEl, notes);
  }

  /**
   * Wire each rendered Brainchild folder card/row to drill into that folder via
   * the scope controller. The controller's onChange re-renders the view.
   * @param {HTMLElement} container
   */
  function wireBrainchildFolderCards(container) {
    if (!container || !brainchildScope) return;
    var cards = container.querySelectorAll('.library-bc-folder-card');
    Array.prototype.forEach.call(cards, function (card) {
      card.addEventListener('click', function () {
        var name = card.getAttribute('data-bc-folder-name') || '';
        if (!name) return;
        brainchildScope.enterFolder(name);
      });
    });
  }

  /**
   * Wire each rendered Brainchild note card/row to open that note inside the
   * Brainchild app via the frozen bridge (openNote(vaultPath)). Folder cards are
   * handled separately by wireBrainchildFolderCards and keep enterFolder behavior.
   * @param {HTMLElement} container
   */
  function wireBrainchildNoteCards(container) {
    if (!container) return;
    var cards = container.querySelectorAll('.library-bc-note-card');
    Array.prototype.forEach.call(cards, function (card) {
      card.addEventListener('click', function () {
        var path = card.getAttribute('data-bc-note-path') || '';
        if (!path) return;
        if (window.electronAPI && window.electronAPI.brainchild &&
            typeof window.electronAPI.brainchild.openNote === 'function') {
          window.electronAPI.brainchild.openNote(path);
        }
      });
    });
  }

  /**
   * Wire each rendered "Promote to Org" button to the controller's promote().
   * The controller fetches the note body, builds the payload, and POSTs it.
   * stopPropagation keeps a promote click from also opening the note in Brainchild.
   * @param {HTMLElement} container
   * @param {Array} rows
   */
  function wireBrainchildPromoteButtons(container, rows) {
    if (!container || !brainchildScope) return;
    var buttons = container.querySelectorAll('.bc-promote-btn');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function (event) {
        if (event && typeof event.stopPropagation === 'function') {
          event.stopPropagation();
        }
        var index = parseInt(button.getAttribute('data-bc-index'), 10);
        var row = rows[index];
        if (!row) return;
        brainchildScope.promote(row, null, button);
      });
    });
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

    // lex-btn: switch variant to indicate active view (primary = active, ghost = inactive)
    if (mode === 'grid') {
      gridBtn && (gridBtn.variant = 'primary');
      listBtn && (listBtn.variant = 'ghost');
    } else {
      listBtn && (listBtn.variant = 'primary');
      gridBtn && (gridBtn.variant = 'ghost');
    }

    if (isBrainchildScope()) {
      renderBrainchildScope();
    } else {
      renderMatters();
    }
  }

  // ── New folder modal ─────────────────────────────────────────────────

  /**
   * Show the new folder creation modal.
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
   * Handle new folder form submission. Creates a matter via API at root level.
   * Uses matter_id: null to signal root creation to the backend.
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
        matter_id: null,
        parent_folder_id: null
      });

      if (response.status === 'success') {
        Lex.Toast.success('Folder created successfully');
        hideNewFolderModal();
        await loadMatters();
      } else {
        console.error('[Drive] API returned error:', response);
        throw new Error(response.error || 'Failed to create folder');
      }
    } catch (error) {
      console.error('[Drive] Failed to create folder:', error);
      Lex.Toast.error('Failed to create folder. Please try again.');
    }
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
    if (modal) modal.open = true;
  }

  /**
   * Close the matter actions modal and clear selectedMatter.
   */
  function closeMatterActionsModal() {
    var modal = document.getElementById('matterActionsModal');
    if (modal) modal.open = false;
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
    if (optionsModal) optionsModal.open = false;

    var confirmModal = document.getElementById('deleteMatterConfirmModal');
    if (confirmModal) confirmModal.open = true;
  }

  // ── Delete matter confirmation ────────────────────────────────────────

  /**
   * Close the delete matter confirmation modal and clear selectedMatter.
   */
  function closeDeleteMatterConfirmModal() {
    var modal = document.getElementById('deleteMatterConfirmModal');
    if (modal) modal.open = false;
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
        loadMatters()
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
   * Update pagination UI via <lex-pagination> component.
   */
  function updatePaginationUI() {
    var pager = document.getElementById('drivePagination');
    if (!pager) return;

    pager.page = storageState.currentPage;
    pager.totalPages = storageState.totalPages || 1;
    pager.total = storageState.totalResults || 0;
    pager.limit = 100;
  }

  /**
   * Refresh all sections: pinned, recents, and main matters list.
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
      loadMatters()
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
   * Clicking navigates to folder.html with the file's matter context and an open_file param.
   * @param {Object} file
   * @returns {string} HTML string
   */
  function renderFileCardInRecents(file) {
    var fileName = escapeHtml(file.filename || file.name);
    var fileSize = formatFileSize(file.file_size || 0);
    var fileIcon = getFileIconSVG(file.content_type);
    var lastAccessed = file.last_accessed_at ? formatDate(file.last_accessed_at) : '';

    return [
      '<div class="file-card rounded-lg shadow-sm border p-4 cursor-pointer relative group hover:shadow-md transition-shadow" style="background: var(--lex-bg-primary); border-color: var(--lex-border-default)"',
      '     onclick="openRecentFile(' + escapeHtml(JSON.stringify(file.id)) + ', ' + escapeHtml(JSON.stringify(file.client_matter || '')) + ')">',
      '  <div class="flex flex-col items-center text-center">',
      '    <div class="w-12 h-12 mb-3 flex items-center justify-center">' + fileIcon + '</div>',
      '    <p class="text-sm font-medium truncate w-full mb-1" style="color: var(--lex-text-primary)" title="' + fileName + '">' + fileName + '</p>',
      '    <p class="text-xs" style="color: var(--lex-text-secondary)">' + fileSize + '</p>',
      lastAccessed ? '    <p class="text-xs mt-1" style="color: var(--lex-text-tertiary)">' + lastAccessed + '</p>' : '',
      '  </div>',
      '</div>'
    ].join('');
  }

  /**
   * Open a recently accessed file in the dedicated file viewer page.
   * @param {string} fileId
   * @param {string} clientMatter
   */
  function openRecentFile(fileId, clientMatter) {
    var referrer = 'drive.html';
    Lex.Nav.go('file-viewer.html', {
      params: { id: fileId },
      context: { referrer: referrer }
    });
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
    var lastModified = matter.updated_at ? formatDate(matter.updated_at) : '';

    return [
      '<div class="file-card rounded-lg shadow-sm border p-4 cursor-pointer relative group hover:shadow-md transition-shadow" style="background: var(--lex-bg-primary); border-color: var(--lex-border-default)"',
      '     onclick="navigateToMatter(' + escapeHtml(JSON.stringify(matter.matter_id)) + ', ' + escapeHtml(JSON.stringify(matter.name || matter.matter_id)) + ')">',
      isPinned
        ? '<div class="absolute top-2 right-8 p-1 rounded-full" style="background: var(--lex-status-warning-bg); border: 1px solid var(--lex-status-warning-border)" title="Pinned"><svg class="w-3 h-3" style="color: var(--lex-status-warning-text)" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg></div>'
        : '',
      '<button class="matter-menu-btn absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--lex-text-secondary)"',
      '        data-matter-id="' + matterNumber + '"',
      '        data-matter-name="' + matterName + '"',
      '        data-is-pinned="' + (matter.is_pinned || isPinned) + '"',
      '        data-source="' + escapeHtml(matter.source || 'lana') + '"',
      '        onclick="event.stopPropagation(); showMatterActionsModal(event)"',
      '        title="More options">',
      '  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
      '    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>',
      '  </svg>',
      '</button>',
      '<div class="flex flex-col items-center text-center">',
      '  <div class="w-12 h-12 mb-3 flex items-center justify-center">',
      '    <svg class="w-12 h-12" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
      '      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>',
      '    </svg>',
      '  </div>',
      '  <p class="text-sm font-medium text-center truncate w-full mb-1" style="color: var(--lex-text-primary)" title="' + matterName + '">' + matterName + '</p>',
      matterNumber ? '  <p class="text-xs font-mono text-center truncate w-full mb-1" style="color: var(--lex-text-secondary)" title="' + matterNumber + '">' + matterNumber + '</p>' : '',
      '  <div class="flex items-center gap-2 text-xs" style="color: var(--lex-text-secondary)">',
      '    <span>' + docCount + ' ' + (docCount === 1 ? 'file' : 'files') + '</span>',
      '    <span>\u2022</span>',
      '    <span>' + folderCount + ' ' + (folderCount === 1 ? 'folder' : 'folders') + '</span>',
      '  </div>',
      lastModified ? '  <p class="text-xs mt-1" style="color: var(--lex-text-tertiary)">' + lastModified + '</p>' : '',
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
        loadMatters()
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
      return '<svg class="w-10 h-10" style="color: var(--lex-text-tertiary)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
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
      return '<svg class="w-10 h-10" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path></svg>';
    }
    if (contentType.indexOf('zip') !== -1 || contentType.indexOf('archive') !== -1 || contentType.indexOf('compressed') !== -1) {
      return '<svg class="w-10 h-10 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"></path></svg>';
    }
    if (contentType.indexOf('text') !== -1) {
      return '<svg class="w-10 h-10" style="color: var(--lex-text-secondary)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>';
    }

    return '<svg class="w-10 h-10" style="color: var(--lex-text-tertiary)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
  }

  // ── Lifecycle hooks ──────────────────────────────────────────────────

  /**
   * Called by LexRouter when navigating to the drive page.
   * Initializes state, exposes globals, wires events, and loads initial data.
   * drive.html is always the root view - no URL params to parse.
   */
  function onEnter() {
    resetState();

    // Expose globals needed by inline onclick handlers in drive.html
    exposeGlobal('handleFolderClick', handleFolderClick);
    exposeGlobal('navigateToMatter', navigateToMatter);
    exposeGlobal('navigateToRoot', navigateToRoot);
    exposeGlobal('showMatterActionsModal', showMatterActionsModal);
    exposeGlobal('closeMatterActionsModal', closeMatterActionsModal);
    exposeGlobal('openMatterFromModal', openMatterFromModal);
    exposeGlobal('togglePinFromModal', togglePinFromModal);
    exposeGlobal('deleteMatterFromModal', deleteMatterFromModal);
    exposeGlobal('closeDeleteMatterConfirmModal', closeDeleteMatterConfirmModal);
    exposeGlobal('confirmDeleteMatter', confirmDeleteMatter);
    exposeGlobal('togglePin', togglePin);
    exposeGlobal('openRecentFile', openRecentFile);
    exposeGlobal('refreshPage', refreshPage);

    setupEventListeners();
    updateViewButtons();
    updateSortHeaderIndicators();
    loadMatters();
    Promise.all([loadRecentMatters(), loadPinnedMatters()]).catch(function (err) {
      console.error('[Drive] Failed to load recents/pinned:', err);
    });
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
      window[name] = undefined;
    });
    _globalFns = [];

    // Remove document-level listeners
    _documentListeners.forEach(function (entry) {
      document.removeEventListener(entry.event, entry.handler);
    });
    _documentListeners = [];

    // Cancel any pending search debounce timer
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }

    // Reset module-level state
    selectedMatter = null;
    brainchildScope = null;
    resetState();

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
    LexRouter.registerPageInit('drive.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      onEnter();
    });
  } else {
    onEnter();
  }

})();

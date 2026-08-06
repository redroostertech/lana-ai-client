/**
 * Management Boards - Main Page Logic
 * Handles tab switching, data loading, and user interactions
 *
 * @requires api.js - Base API client
 * @requires menu.js - Sidebar menu
 * @requires components.js - UI components
 * @requires management-board-service.js - API service
 * @requires management-board-components.js - UI components
 */

// Global state
let currentTab = 'boards';
let currentUser = null;
let allBoards = [];
let currentBoardId = null; // Track currently viewed board in detail modal

/**
 * Initialize page on DOM ready
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Check authentication
    checkAuth();

    // Load user profile
    await api.loadUserProfile();
    currentUser = api.user;

    // Render sidebar menu
    renderMenu('#mainNav', { menuType: 'portal' });

    // Initialize conversation search modal
    if (typeof ConversationSearchModal !== 'undefined') {
      ConversationSearchModal.init();
    }

    // Initialize notifications panel
    if (typeof NotificationPanel !== 'undefined') {
      NotificationPanel.init();
    }

    // Setup UI event listeners (must be after user profile loads)
    setupUIEventListeners();

    // Setup tab switching
    setupTabs();

    // Setup event listeners
    setupEventListeners();

    // Load initial data
    await loadBoards();

    // Note: Preloader is automatically hidden by tailwind-loader.js after MIN_LOADING_TIME (3s)
  } catch (error) {
    console.error('[ManagementBoards] Initialization error:', error);
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      window.location.href = getLoginPath();
    } else {
      showToast('Failed to load management boards', 'error');
    }
  }
});

/**
 * Setup tab switching functionality
 */
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs
      tabs.forEach(t => {
        t.classList.remove('active');
      });

      // Hide all content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
      });

      // Activate clicked tab
      tab.classList.add('active');

      // Show corresponding content
      const tabId = tab.id.replace('tab-', 'content-');
      const contentElement = document.getElementById(tabId);
      if (contentElement) {
        contentElement.classList.remove('hidden');
      }

      // Load data for tab
      const tabName = tab.id.replace('tab-', '');
      currentTab = tabName;
      loadTabData(tabName);
    });
  });

  // Activate first tab
  const firstTab = document.getElementById('tab-boards');
  if (firstTab) {
    firstTab.click();
  }
}

/**
 * Load data for current tab
 * @param {string} tabName - Tab name (boards, submissions)
 */
async function loadTabData(tabName) {
  try {
    switch (tabName) {
      case 'boards':
        await loadBoards();
        break;
      case 'submissions':
        await loadSubmissions();
        break;
    }
  } catch (error) {
    console.error(`[ManagementBoards] Error loading ${tabName}:`, error);
    showToast(`Failed to load ${tabName.replace('-', ' ')}`, 'error');
  }
}

/**
 * Load boards (unified view with filters)
 */
async function loadBoards() {
  try {
    const response = await ManagementBoardService.getAllBoards();
    allBoards = response.boards || [];

    const grid = document.getElementById('boardsGrid');
    if (!grid) return;

    if (allBoards.length === 0) {
      grid.innerHTML = ManagementBoardComponents.renderEmptyState('No boards yet');
      return;
    }

    // Apply filters
    const filtered = filterBoards(allBoards);

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full text-center py-12">
          <i class="fas fa-search text-6xl text-gray-300 mb-4"></i>
          <h3 class="text-lg font-medium text-gray-900 mb-2">No boards match your filters</h3>
          <p class="text-gray-500">Try adjusting your search or filters</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(board =>
      ManagementBoardComponents.renderBoardCard(board)
    ).join('');

  } catch (error) {
    console.error('[ManagementBoards] Failed to load boards:', error);
    const grid = document.getElementById('boardsGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="col-span-full text-center py-12">
          <i class="fas fa-exclamation-triangle text-6xl text-red-300 mb-4"></i>
          <h3 class="text-lg font-medium text-gray-900 mb-2">Failed to load boards</h3>
          <p class="text-gray-500 mb-4">${error.message}</p>
          <button onclick="loadBoards()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
            Try Again
          </button>
        </div>
      `;
    }
    throw error;
  }
}

/**
 * Filter boards based on current filter selections
 */
function filterBoards(boards) {
  const searchInput = document.getElementById('boardSearch');
  const typeFilter = document.getElementById('boardTypeFilter');
  const accessFilter = document.getElementById('boardAccessFilter');

  let filtered = boards;

  // Search filter
  if (searchInput && searchInput.value) {
    const search = searchInput.value.toLowerCase();
    filtered = filtered.filter(board =>
      board.name.toLowerCase().includes(search) ||
      (board.description && board.description.toLowerCase().includes(search))
    );
  }

  // Type filter
  if (typeFilter && typeFilter.value) {
    filtered = filtered.filter(board => board.board_type === typeFilter.value);
  }

  // Access filter
  if (accessFilter && accessFilter.value) {
    const filterValue = accessFilter.value;
    if (filterValue === 'my') {
      filtered = filtered.filter(board => board.user_access_level !== null);
    } else if (filterValue === 'public') {
      filtered = filtered.filter(board => board.is_public);
    }
  }

  return filtered;
}

/**
 * Load submissions (Tab 3)
 */
async function loadSubmissions() {
  try {
    // Load pending metrics for submission form
    await loadPendingMetrics();

    // Load recent submissions
    await loadRecentSubmissions();

  } catch (error) {
    console.error('[ManagementBoards] Failed to load submissions:', error);
    showToast('Failed to load submissions', 'error');
  }
}

/**
 * Load pending metrics for submission dropdown
 */
async function loadPendingMetrics() {
  try {
    const pending = await ManagementBoardService.getPendingMetrics();
    const metricSelect = document.getElementById('metricSelect');

    if (!metricSelect) return;

    metricSelect.innerHTML = '<option value="">Select metric...</option>' +
      pending.map(m => `
        <option value="${m.id}" data-board-id="${m.boardId}">
          ${ManagementBoardComponents.escapeHtml(m.metric_label)} (${ManagementBoardComponents.escapeHtml(m.boardName)})
        </option>
      `).join('');

  } catch (error) {
    console.error('[ManagementBoards] Failed to load pending metrics:', error);
  }
}

/**
 * Load recent submissions
 */
async function loadRecentSubmissions() {
  try {
    const submissions = await ManagementBoardService.getRecentSubmissions();
    const tabContainer = document.getElementById('content-submissions');
    const container = document.getElementById('recentSubmissions');

    if (!container || !tabContainer) return;

    if (submissions.length === 0) {
      // Show educational empty state for the entire submissions tab
      tabContainer.innerHTML = ManagementBoardComponents.renderSubmissionsEmptyState();
      return;
    }

    container.innerHTML = submissions.slice(0, 10).map(submission =>
      ManagementBoardComponents.renderSubmissionCard(submission)
    ).join('');

  } catch (error) {
    console.error('[ManagementBoards] Failed to load recent submissions:', error);
  }
}

/**
 * Setup UI event listeners (user menu, sidebar, etc.)
 */
function setupUIEventListeners() {
  // Load user info into header
  const user = api.user;
  if (user) {
    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
    const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '') || user.email[0].toUpperCase();
    const userNameEl = document.getElementById('userName');
    const userInitialsEl = document.getElementById('userInitials');
    if (userNameEl) userNameEl.textContent = name;
    if (userInitialsEl) userInitialsEl.textContent = initials;
  }

  // User menu toggle
  const userMenu = document.getElementById('userMenu');
  const userDropdown = document.getElementById('userDropdown');
  if (userMenu && userDropdown) {
    userMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!userMenu.contains(e.target)) userDropdown.classList.add('hidden');
    });
  }

  // Logout handler
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await api.logout();
      window.location.href = '../login.html';
    });
  }

  // Sidebar toggle for mobile
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const closeSidebar = document.getElementById('closeSidebar');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.remove('-translate-x-full');
    });
  }

  if (closeSidebar && sidebar) {
    closeSidebar.addEventListener('click', () => {
      sidebar.classList.add('-translate-x-full');
    });
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // New board button
  const newBoardBtn = document.getElementById('newBoardBtn');
  if (newBoardBtn) {
    newBoardBtn.addEventListener('click', openNewBoardModal);
  }

  // New board form
  const newBoardForm = document.getElementById('newBoardForm');
  if (newBoardForm) {
    newBoardForm.addEventListener('submit', handleCreateBoard);
  }

  // Submit metric form
  const submitMetricForm = document.getElementById('submitMetricForm');
  if (submitMetricForm) {
    submitMetricForm.addEventListener('submit', handleSubmitMetric);
  }

  // Board search filter
  const searchInput = document.getElementById('boardSearch');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      const grid = document.getElementById('boardsGrid');
      if (grid && allBoards.length > 0) {
        const filtered = filterBoards(allBoards);
        grid.innerHTML = filtered.map(board =>
          ManagementBoardComponents.renderBoardCard(board)
        ).join('');
      }
    }, 300));
  }

  // Board type filter
  const typeFilter = document.getElementById('boardTypeFilter');
  if (typeFilter) {
    typeFilter.addEventListener('change', () => {
      const grid = document.getElementById('boardsGrid');
      if (grid && allBoards.length > 0) {
        const filtered = filterBoards(allBoards);
        grid.innerHTML = filtered.map(board =>
          ManagementBoardComponents.renderBoardCard(board)
        ).join('');
      }
    });
  }

  // Board access filter
  const accessFilter = document.getElementById('boardAccessFilter');
  if (accessFilter) {
    accessFilter.addEventListener('change', () => {
      const grid = document.getElementById('boardsGrid');
      if (grid && allBoards.length > 0) {
        const filtered = filterBoards(allBoards);
        grid.innerHTML = filtered.map(board =>
          ManagementBoardComponents.renderBoardCard(board)
        ).join('');
      }
    });
  }

  // Board detail modal tab switching
  setupBoardDetailTabs();

  // Board detail modal - Add Metric button
  const addMetricBtn = document.getElementById('addMetricBtn');
  if (addMetricBtn) {
    addMetricBtn.addEventListener('click', () => {
      document.getElementById('addMetricForm').classList.remove('hidden');
    });
  }

  // Board detail modal - Cancel Metric button
  const cancelMetricBtn = document.getElementById('cancelMetricBtn');
  if (cancelMetricBtn) {
    cancelMetricBtn.addEventListener('click', () => {
      document.getElementById('addMetricForm').classList.add('hidden');
      document.getElementById('metricForm').reset();
    });
  }

  // Board detail modal - Add Team Member button
  const addTeamMemberBtn = document.getElementById('addTeamMemberBtn');
  if (addTeamMemberBtn) {
    addTeamMemberBtn.addEventListener('click', () => {
      document.getElementById('addTeamMemberForm').classList.remove('hidden');
      // Focus on search input when form opens
      setTimeout(() => {
        document.getElementById('teamUserSearch')?.focus();
      }, 100);
    });
  }

  // Board detail modal - Cancel Team Member button
  const cancelTeamMemberBtn = document.getElementById('cancelTeamMemberBtn');
  if (cancelTeamMemberBtn) {
    cancelTeamMemberBtn.addEventListener('click', () => {
      document.getElementById('addTeamMemberForm').classList.add('hidden');
      document.getElementById('teamAssignmentForm').reset();
      clearUserSearch();
    });
  }

  // Board detail modal - Team Assignment Form
  const teamAssignmentForm = document.getElementById('teamAssignmentForm');
  if (teamAssignmentForm) {
    teamAssignmentForm.addEventListener('submit', handleTeamAssignmentSubmit);
  }

  // Setup user autocomplete search
  setupUserAutocomplete();
}

/**
 * Setup user autocomplete search functionality
 */
let userSearchTimeout = null;
let allUsers = [];
let selectedUser = null;

function setupUserAutocomplete() {
  const searchInput = document.getElementById('teamUserSearch');
  const dropdown = document.getElementById('teamUserDropdown');
  const resultsContainer = document.getElementById('teamUserResults');
  const clearBtn = document.getElementById('clearSelectedUser');

  if (!searchInput || !dropdown || !resultsContainer) return;

  // Load all users on first focus (cache for autocomplete)
  searchInput.addEventListener('focus', async () => {
    if (allUsers.length === 0) {
      await loadOrganizationUsers();
    }
  });

  // Handle input changes with debounce
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();

    console.log('[UserAutocomplete] Search query:', query);
    console.log('[UserAutocomplete] Total users available:', allUsers.length);

    // Clear timeout
    if (userSearchTimeout) {
      clearTimeout(userSearchTimeout);
    }

    // Debounce search
    userSearchTimeout = setTimeout(() => {
      if (query.length === 0) {
        dropdown.classList.add('hidden');
        return;
      }

      // Filter users
      const filteredUsers = allUsers.filter(user => {
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
        const email = (user.email || '').toLowerCase();
        const searchQuery = query.toLowerCase();

        console.log('[UserAutocomplete] Checking user:', {
          fullName,
          email,
          searchQuery,
          matches: fullName.includes(searchQuery) || email.includes(searchQuery)
        });

        return fullName.includes(searchQuery) || email.includes(searchQuery);
      });

      console.log('[UserAutocomplete] Filtered results:', filteredUsers.length);

      // Display results
      displayUserResults(filteredUsers);
    }, 300); // 300ms debounce
  });

  // Handle clicks outside dropdown
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Clear selected user
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearUserSearch();
    });
  }
}

/**
 * Load all users in organization for autocomplete
 */
async function loadOrganizationUsers() {
  try {
    console.log('[UserAutocomplete] Fetching users from API...');
    const response = await api.get('/api/v1/admin/users?page=1&page_size=1000&status_filter=active');

    console.log('[UserAutocomplete] API Response:', response);

    allUsers = response.users || [];
    console.log('[UserAutocomplete] Loaded users:', allUsers.length);

    if (allUsers.length > 0) {
      console.log('[UserAutocomplete] Sample user:', allUsers[0]);
    }
  } catch (error) {
    console.error('[UserAutocomplete] Failed to load users:', error);
    showToast('Failed to load users', 'error');
  }
}

/**
 * Display user search results
 */
function displayUserResults(users) {
  const resultsContainer = document.getElementById('teamUserResults');
  const dropdown = document.getElementById('teamUserDropdown');

  if (!resultsContainer || !dropdown) return;

  // Clear previous results
  resultsContainer.innerHTML = '';

  if (users.length === 0) {
    resultsContainer.innerHTML = `
      <div class="px-3 py-2 text-sm text-gray-500 text-center">
        No users found
      </div>
    `;
    dropdown.classList.remove('hidden');
    return;
  }

  // Render user results
  users.forEach(user => {
    const userItem = document.createElement('div');
    userItem.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer flex items-center gap-3 transition';

    // Get initials
    const initials = getInitials(user.first_name, user.last_name);

    userItem.innerHTML = `
      <div class="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0">
        ${initials}
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm text-gray-900 truncate">
          ${escapeHtml(user.first_name || '')} ${escapeHtml(user.last_name || '')}
        </div>
        <div class="text-xs text-gray-600 truncate">
          ${escapeHtml(user.email || '')}
        </div>
      </div>
    `;

    // Handle selection
    userItem.addEventListener('click', () => {
      selectUser(user);
    });

    resultsContainer.appendChild(userItem);
  });

  // Show dropdown
  dropdown.classList.remove('hidden');
}

/**
 * Select a user from autocomplete
 */
function selectUser(user) {
  selectedUser = user;

  // Set hidden input value
  const hiddenInput = document.getElementById('teamUserSelect');
  if (hiddenInput) {
    hiddenInput.value = user.id;
  }

  // Clear and hide search input
  const searchInput = document.getElementById('teamUserSearch');
  if (searchInput) {
    searchInput.value = '';
  }

  const dropdown = document.getElementById('teamUserDropdown');
  if (dropdown) {
    dropdown.classList.add('hidden');
  }

  // Show selected user display
  const selectedDisplay = document.getElementById('selectedUserDisplay');
  const initialsEl = document.getElementById('selectedUserInitials');
  const nameEl = document.getElementById('selectedUserName');
  const emailEl = document.getElementById('selectedUserEmail');

  if (selectedDisplay && initialsEl && nameEl && emailEl) {
    initialsEl.textContent = getInitials(user.first_name, user.last_name);
    nameEl.textContent = `${user.first_name || ''} ${user.last_name || ''}`;
    emailEl.textContent = user.email || '';
    selectedDisplay.classList.remove('hidden');
  }

  // Hide search input
  if (searchInput) {
    searchInput.classList.add('hidden');
  }
}

/**
 * Clear user search and selection
 */
function clearUserSearch() {
  selectedUser = null;

  // Clear hidden input
  const hiddenInput = document.getElementById('teamUserSelect');
  if (hiddenInput) {
    hiddenInput.value = '';
  }

  // Clear and show search input
  const searchInput = document.getElementById('teamUserSearch');
  if (searchInput) {
    searchInput.value = '';
    searchInput.classList.remove('hidden');
  }

  // Hide dropdown
  const dropdown = document.getElementById('teamUserDropdown');
  if (dropdown) {
    dropdown.classList.add('hidden');
  }

  // Hide selected display
  const selectedDisplay = document.getElementById('selectedUserDisplay');
  if (selectedDisplay) {
    selectedDisplay.classList.add('hidden');
  }
}

/**
 * Get user initials
 */
function getInitials(firstName, lastName, email) {
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();

  if (first && last) {
    return (first[0] + last[0]).toUpperCase();
  } else if (first) {
    return first.substring(0, 2).toUpperCase();
  } else if (last) {
    return last.substring(0, 2).toUpperCase();
  } else if (email) {
    return email.substring(0, 2).toUpperCase();
  } else {
    return '?';
  }
}

/**
 * Format user's full name
 */
function formatUserName(firstName, lastName, email) {
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();

  if (first && last) {
    return `${first} ${last}`;
  } else if (first) {
    return first;
  } else if (last) {
    return last;
  } else {
    return email || 'Unknown User';
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Setup board detail modal tab switching
 */
function setupBoardDetailTabs() {
  const tabs = document.querySelectorAll('.board-detail-tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Get tab name from ID (e.g., "boardDetailTab-overview" -> "overview")
      const tabName = tab.id.split('-')[1];

      // Remove active class from all tabs
      tabs.forEach(t => {
        t.classList.remove('active', 'border-indigo-600', 'text-indigo-600');
        t.classList.add('border-transparent', 'text-gray-500');
      });

      // Add active class to clicked tab
      tab.classList.add('active', 'border-indigo-600', 'text-indigo-600');
      tab.classList.remove('border-transparent', 'text-gray-500');

      // Hide all tab content
      document.querySelectorAll('.board-detail-content').forEach(content => {
        content.classList.add('hidden');
      });

      // Show selected tab content
      const selectedContent = document.getElementById(`boardDetailContent-${tabName}`);
      if (selectedContent) {
        selectedContent.classList.remove('hidden');
      }
    });
  });
}

/**
 * Open new board modal
 */
function openNewBoardModal() {
  const modal = document.getElementById('newBoardModal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

/**
 * Close modal
 * @param {string} modalId - Modal element ID
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
  }
}

/**
 * Handle create board form submission
 * @param {Event} e - Form submit event
 */
async function handleCreateBoard(e) {
  e.preventDefault();

  const name = document.getElementById('boardName')?.value;
  const type = document.getElementById('boardType')?.value;
  const reviewFrequency = document.getElementById('reviewFrequency')?.value;
  const description = document.getElementById('boardDescription')?.value;

  if (!name || !type || !reviewFrequency) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  try {
    const boardData = {
      name,
      board_type: type,
      review_frequency: reviewFrequency,
      description: description || null
    };

    await ManagementBoardService.createBoard(boardData);

    showToast('Board created successfully', 'success');

    // Close modal
    closeModal('newBoardModal');

    // Reset form
    e.target.reset();

    // Reload boards
    await loadBoards();

  } catch (error) {
    console.error('[ManagementBoards] Failed to create board:', error);
    showToast('Failed to create board', 'error');
  }
}

/**
 * Handle submit metric form
 * @param {Event} e - Form submit event
 */
async function handleSubmitMetric(e) {
  e.preventDefault();

  const metricSelect = document.getElementById('metricSelect');
  const value = document.getElementById('metricValue')?.value;
  const notes = document.getElementById('metricNotes')?.value;

  const selectedOption = metricSelect?.options[metricSelect.selectedIndex];
  const metricId = metricSelect?.value;
  const boardId = selectedOption?.dataset.boardId;

  if (!metricId || !value || !boardId) {
    showToast('Please select a metric and enter a value', 'error');
    return;
  }

  try {
    const submissionData = {
      value: parseFloat(value),
      notes: notes || null,
      submission_date: LanaTime.formatUtcDateOnly(LanaTime.nowDate())
    };

    await ManagementBoardService.submitMetric(boardId, metricId, submissionData);

    showToast('Metric submitted successfully', 'success');

    // Track metric submission
    if (window.FeatureTracker) {
      try {
        await window.FeatureTracker.trackFeature(window.Features.METRIC_SUBMITTED, {
          board_id: boardId,
          metric_id: metricId
        });
      } catch (trackError) {
        console.error('[FeatureTracker] Failed to track metric submission:', trackError);
      }
    }

    // Reset form
    e.target.reset();

    // Reload submissions
    await loadSubmissions();

  } catch (error) {
    console.error('[ManagementBoards] Failed to submit metric:', error);
    showToast('Failed to submit metric', 'error');
  }
}

/**
 * Handle board search
 * @param {Event} e - Input event
 */
function handleBoardSearch(e) {
  const searchTerm = e.target.value.toLowerCase();
  const typeFilter = document.getElementById('boardTypeFilter')?.value;

  let filtered = allBoards;

  // Apply search filter
  if (searchTerm) {
    filtered = filtered.filter(board =>
      board.name.toLowerCase().includes(searchTerm) ||
      (board.description && board.description.toLowerCase().includes(searchTerm))
    );
  }

  // Apply type filter
  if (typeFilter) {
    filtered = filtered.filter(board => board.board_type === typeFilter);
  }

  renderAllBoardsTable(filtered);
}

/**
 * Handle board type filter
 */
function handleBoardFilter() {
  const searchInput = document.getElementById('boardSearch');
  if (searchInput) {
    handleBoardSearch({ target: searchInput });
  }
}

/**
 * View board detail
 * @param {string} boardId - Board UUID
 */
async function viewBoardDetail(boardId) {
  try {
    // Store current board ID globally
    currentBoardId = boardId;

    const board = await ManagementBoardService.getBoardDetail(boardId);

    const modal = document.getElementById('boardDetailModal');
    const title = document.getElementById('boardDetailTitle');

    if (title) {
      title.textContent = board.name;
    }

    // Populate Overview tab
    populateBoardOverview(board);

    // Load board metrics with calculated values
    await loadBoardMetrics(boardId, board);

    // Load team assignments (users loaded on-demand by autocomplete)
    await loadTeamAssignments(boardId);

    if (modal) {
      modal.classList.remove('hidden');
    }

    // Track board view
    if (window.FeatureTracker) {
      try {
        await window.FeatureTracker.trackFeature(window.Features.BOARD_VIEWED, {
          board_id: boardId,
          board_type: board.board_type
        });
      } catch (trackError) {
        console.error('[FeatureTracker] Failed to track board view:', trackError);
      }
    }

  } catch (error) {
    console.error('[ManagementBoards] Failed to load board detail:', error);
    showToast('Failed to load board details', 'error');
  }
}

/**
 * Populate Overview tab with board information
 * @param {Object} board - Board data
 */
function populateBoardOverview(board) {
  // Board Information
  const typeElement = document.getElementById('boardOverview-type');
  const frequencyElement = document.getElementById('boardOverview-frequency');
  const statusElement = document.getElementById('boardOverview-status');
  const descriptionElement = document.getElementById('boardOverview-description');

  if (typeElement) {
    typeElement.textContent = capitalizeFirst(board.board_type || '-');
  }

  if (frequencyElement) {
    frequencyElement.textContent = capitalizeFirst(board.review_frequency || '-');
  }

  if (statusElement) {
    const isActive = board.is_active !== false;
    statusElement.innerHTML = isActive
      ? '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"><i class="fas fa-check-circle mr-1"></i>Active</span>'
      : '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"><i class="fas fa-pause-circle mr-1"></i>Inactive</span>';
  }

  if (descriptionElement) {
    descriptionElement.textContent = board.description || 'No description provided';
  }

  // Statistics
  const metricsCountElement = document.getElementById('boardOverview-metricsCount');
  const teamCountElement = document.getElementById('boardOverview-teamCount');
  const lastReviewElement = document.getElementById('boardOverview-lastReview');

  if (metricsCountElement) {
    metricsCountElement.textContent = (board.metrics || []).length;
  }

  if (teamCountElement) {
    // This will be updated when team assignments load
    teamCountElement.textContent = '...';
  }

  if (lastReviewElement) {
    if (board.last_review_date) {
      lastReviewElement.textContent = formatRelativeTime(board.last_review_date);
    } else {
      lastReviewElement.textContent = 'No reviews yet';
    }
  }
}

/**
 * Load team assignments for a board
 * @param {string} boardId - Board UUID
 */
async function loadTeamAssignments(boardId) {
  const teamList = document.getElementById('teamList');
  if (!teamList) return;

  try {
    const assignments = await ManagementBoardService.getAssignments(boardId);

    // Update team count in Overview tab
    const teamCountElement = document.getElementById('boardOverview-teamCount');
    if (teamCountElement) {
      teamCountElement.textContent = (assignments || []).length;
    }

    if (!assignments || assignments.length === 0) {
      teamList.innerHTML = `
        <p class="text-gray-500 text-sm text-center py-8">
          No team members assigned yet. Click "Assign User" to get started.
        </p>
      `;
      return;
    }

    teamList.innerHTML = assignments.map(assignment => `
      <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-all duration-200">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <span class="text-sm font-semibold text-indigo-700">
                ${getInitials(assignment.first_name, assignment.last_name, assignment.email)}
              </span>
            </div>
            <div class="min-w-0">
              <div class="font-semibold text-gray-900 text-sm truncate">
                ${ManagementBoardComponents.escapeHtml(formatUserName(assignment.first_name, assignment.last_name, assignment.email))}
              </div>
              <div class="text-xs text-gray-500 truncate">${ManagementBoardComponents.escapeHtml(assignment.email)}</div>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="px-2 py-1 text-xs font-medium rounded ${getAccessLevelBadgeClass(assignment.access_level)}">
              ${capitalizeFirst(assignment.access_level)}
            </span>
            <button
              onclick="removeTeamMember('${boardId}', '${assignment.user_id}')"
              class="text-gray-400 hover:text-red-600 transition p-1"
              title="Remove user">
              <i class="fas fa-trash text-sm"></i>
            </button>
          </div>
        </div>
        <div class="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
          Assigned ${formatRelativeTime(assignment.assigned_at)}
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('[ManagementBoards] Failed to load team assignments:', error);
    teamList.innerHTML = `
      <p class="text-red-500 text-sm text-center py-8">
        Failed to load team assignments. Please try again.
      </p>
    `;
  }
}

/**
 * Load board metrics with calculated values for Overview tab
 * @param {string} boardId - Board UUID
 * @param {Object} boardData - Board data containing metrics
 */
async function loadBoardMetrics(boardId, boardData) {
  const metricsGrid = document.getElementById('boardMetricsGrid');
  if (!metricsGrid) return;

  try {
    // Get metrics from board data
    const metrics = boardData.metrics || [];

    if (!metrics || metrics.length === 0) {
      metricsGrid.innerHTML = `
        <div class="col-span-full text-center py-12">
          <i class="fas fa-chart-line text-6xl text-gray-300 mb-4"></i>
          <h3 class="text-lg font-medium text-gray-900 mb-2">No metrics configured yet</h3>
          <p class="text-gray-500 mb-4">Add metrics to this board to start tracking performance</p>
          <button onclick="switchBoardDetailTab('metrics')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
            <i class="fas fa-plus mr-2"></i>Add Metrics
          </button>
        </div>
      `;
      return;
    }

    // Render metric cards
    metricsGrid.innerHTML = metrics.map(metric => renderMetricCard(metric)).join('');

  } catch (error) {
    console.error('[ManagementBoards] Failed to load board metrics:', error);
    metricsGrid.innerHTML = `
      <div class="col-span-full text-center py-12">
        <i class="fas fa-exclamation-triangle text-6xl text-red-300 mb-4"></i>
        <h3 class="text-lg font-medium text-gray-900 mb-2">Failed to load metrics</h3>
        <p class="text-gray-500 mb-4">${error.message || 'Please try again'}</p>
        <button onclick="viewBoardDetail('${boardId}')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">
          Try Again
        </button>
      </div>
    `;
  }
}

/**
 * Render a single metric card with current value and trend
 * @param {Object} metric - Metric configuration object
 * @returns {string} HTML string for metric card
 */
function renderMetricCard(metric) {
  const value = metric.current_value !== null && metric.current_value !== undefined ? metric.current_value : null;
  const target = metric.target_value;
  const metricType = metric.metric_type || 'number';
  const description = metric.metric_description || metric.metric_label;

  // Format value based on metric type
  const formattedValue = value !== null ? formatMetricValue(value, metricType) : '-';
  const formattedTarget = target !== null && target !== undefined ? formatMetricValue(target, metricType) : null;

  // Determine if metric meets target (if applicable)
  let targetStatus = '';
  if (value !== null && target !== null && target !== undefined) {
    const meetsTarget = value >= target;
    targetStatus = meetsTarget
      ? '<span class="text-green-600 text-xs font-medium"><i class="fas fa-check-circle mr-1"></i>On Target</span>'
      : '<span class="text-amber-600 text-xs font-medium"><i class="fas fa-exclamation-circle mr-1"></i>Below Target</span>';
  }

  return `
    <div class="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <i class="fas fa-chart-bar text-2xl text-indigo-600"></i>
          </div>
          <div class="min-w-0">
            <h5 class="font-semibold text-gray-900 text-sm truncate">${ManagementBoardComponents.escapeHtml(metric.metric_label)}</h5>
            <p class="text-xs text-gray-500 truncate">${ManagementBoardComponents.escapeHtml(description)}</p>
          </div>
        </div>
      </div>

      <div class="flex items-end justify-between mb-3">
        <div>
          <div class="text-3xl font-bold text-gray-900">${formattedValue}</div>
          ${formattedTarget ? `<div class="text-xs text-gray-500 mt-1">Target: ${formattedTarget}</div>` : ''}
        </div>
        ${targetStatus}
      </div>

      <div class="mt-3 text-xs text-gray-500">
        <i class="fas fa-info-circle mr-1"></i>
        ${metric.is_required ? 'Required' : 'Optional'} metric
      </div>
    </div>
  `;
}

/**
 * Format metric value based on type
 * @param {number} value - Metric value
 * @param {string} type - Metric type (number, percentage, currency, text)
 * @returns {string} Formatted value
 */
function formatMetricValue(value, type) {
  if (value === null || value === undefined) {
    return '-';
  }

  switch (type) {
    case 'percentage':
      return `${Number(value).toFixed(1)}%`;
    case 'currency':
      return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'text':
      return String(value);
    case 'number':
    default:
      return Number(value).toLocaleString('en-US');
  }
}

/**
 * Switch to a specific board detail tab
 * @param {string} tabName - Tab name (overview, metrics, team, reviews)
 */
function switchBoardDetailTab(tabName) {
  const tabs = document.querySelectorAll('.board-detail-tab');
  const contents = document.querySelectorAll('.board-detail-content');

  tabs.forEach(tab => {
    const thisTabName = tab.id.replace('boardDetailTab-', '');
    if (thisTabName === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  contents.forEach(content => {
    const thisContentName = content.id.replace('boardDetailContent-', '');
    if (thisContentName === tabName) {
      content.classList.remove('hidden');
    } else {
      content.classList.add('hidden');
    }
  });
}

/**
 * Debounce helper
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type (success, error, info)
 */
function showToast(message, type = 'info') {
  // Use existing Toast component if available
  if (window.Toast) {
    window.Toast[type](message);
  } else {
    console.log(`[Toast ${type}]`, message);
  }
}

/**
 * Hide preloader
 */
function hidePreloader() {
  const preloader = document.getElementById('lana-preloader');
  if (preloader) {
    preloader.style.opacity = '0';
    setTimeout(() => {
      preloader.style.display = 'none';
    }, 300);
  }
}

/**
 * Handle team assignment form submission
 */
async function handleTeamAssignmentSubmit(e) {
  e.preventDefault();

  if (!currentBoardId) {
    showToast('No board selected', 'error');
    return;
  }

  const userId = document.getElementById('teamUserSelect').value;
  const accessLevel = document.getElementById('teamAccessLevel').value;

  if (!userId || !accessLevel) {
    showToast('Please select a user and access level', 'error');
    return;
  }

  try {
    await ManagementBoardService.assignUser(currentBoardId, {
      user_id: userId,
      access_level: accessLevel
    });

    showToast('User assigned successfully', 'success');

    // Reset form and hide it
    document.getElementById('teamAssignmentForm').reset();
    document.getElementById('addTeamMemberForm').classList.add('hidden');

    // Reload assignments (users already cached by autocomplete)
    await loadTeamAssignments(currentBoardId);

  } catch (error) {
    console.error('[ManagementBoards] Failed to assign user:', error);
    showToast(error.message || 'Failed to assign user', 'error');
  }
}

/**
 * Remove team member
 */
async function removeTeamMember(boardId, userId) {
  if (!confirm('Are you sure you want to remove this user from the board?')) {
    return;
  }

  try {
    await ManagementBoardService.removeAssignment(boardId, userId);
    showToast('User removed successfully', 'success');

    // Reload assignments (users already cached by autocomplete)
    await loadTeamAssignments(boardId);

  } catch (error) {
    console.error('[ManagementBoards] Failed to remove user:', error);
    showToast(error.message || 'Failed to remove user', 'error');
  }
}

// Helper functions (getInitials and formatUserName are defined above in autocomplete section)

function getAccessLevelBadgeClass(level) {
  const classes = {
    admin: 'bg-red-100 text-red-700',
    editor: 'bg-blue-100 text-blue-700',
    viewer: 'bg-gray-100 text-gray-700'
  };
  return classes[level] || classes.viewer;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatRelativeTime(dateString) {
  return LanaTime.timeAgo(dateString, { style: 'words' });
}

// Make functions globally available
window.viewBoardDetail = viewBoardDetail;
window.closeModal = closeModal;
window.openNewBoardModal = openNewBoardModal;
window.removeTeamMember = removeTeamMember;

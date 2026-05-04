/**
 * Lana AI Activity Panel
 * 
 * Reusable activity feed slide-out panel component.
 * Handles fetching, displaying, and managing activity items.
 * 
 * Usage:
 *   1. Include this script after api.js
 *   2. Add the activity HTML structure (or call ActivityPanel.injectHTML())
 *   3. Call ActivityPanel.init() after DOM is ready
 */

window.ActivityPanel = (function() {
  // State
  let state = {
    activities: [],
    offset: 0,
    limit: 20,
    hasMore: true,
    isLoading: false,
    isInitialized: false
  };

  // DOM Elements (cached after init)
  let elements = {};

  /**
   * Initialize the activity panel
   * @param {Object} options - Configuration options
   */
  function init(options = {}) {
    if (state.isInitialized) return;

    // Cache DOM elements
    elements = {
      panel: document.getElementById('activityPanel'),
      list: document.getElementById('activityList'),
      loading: document.getElementById('activityLoading'),
      viewAllBtn: document.getElementById('viewAllActivityBtn'),
      feedContainer: document.getElementById('activityFeed')
    };

    // Check required elements exist
    if (!elements.panel) {
      console.warn('ActivityPanel: Panel element not found. Call injectHTML() first or add elements manually.');
      return;
    }

    // Bind events
    bindEvents();

    state.isInitialized = true;
  }

  /**
   * Inject the activity panel HTML into the page
   */
  function injectHTML() {
    const html = `
    <!-- Activity Panel Overlay -->
    <div id="activityOverlay" class="fixed inset-0 bg-black bg-opacity-50 z-40 hidden transition-opacity"></div>

    <!-- Activity Slide-out Panel -->
    <div id="activityPanel" class="fixed inset-y-0 right-0 w-full sm:w-[28rem] bg-white shadow-2xl z-50 transform translate-x-full transition-transform duration-300 ease-in-out flex flex-col">
      <!-- Panel Header -->
      <div class="flex items-center justify-between h-16 px-6 border-b border-gray-200 flex-shrink-0">
        <h2 class="text-lg font-semibold text-gray-900">Activity</h2>
        <div class="flex items-center gap-3">
          <button id="refreshActivityBtn" class="text-gray-400 hover:text-gray-600 transition-colors" title="Refresh">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
          <button id="closeActivityPanel" class="text-gray-400 hover:text-gray-600">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Activity List -->
      <div id="activityList" class="flex-1 overflow-y-auto">
        <!-- Loading State -->
        <div id="activityLoading" class="p-8 text-center">
          <div class="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div>
          <p class="text-gray-500 mt-3 text-sm">Loading activity...</p>
        </div>
      </div>

      <!-- Loading More Indicator -->
      <div id="activityLoadingMore" class="hidden p-4 border-t border-gray-100 text-center">
        <div class="animate-spin w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div>
      </div>
    </div>
    `;

    // Inject at end of body
    document.body.insertAdjacentHTML('beforeend', html);
  }

  /**
   * Bind all event listeners
   */
  function bindEvents() {
    // lex-drawer handles close button, overlay click, and Escape key internally
    if (elements.panel) {
      elements.panel.addEventListener('lex-close', close);
    }

    // View all button (on dashboard)
    if (elements.viewAllBtn) {
      elements.viewAllBtn.addEventListener('click', open);
    }

    // Infinite scroll
    if (elements.list) {
      elements.list.addEventListener('scroll', handleScroll);
    }
  }

  /**
   * Handle scroll for infinite loading
   */
  function handleScroll() {
    if (!elements.list || state.isLoading || !state.hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = elements.list;
    
    // Load more when within 100px of bottom
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      loadActivities(false);
    }
  }

  /**
   * Check if panel is open
   */
  function isOpen() {
    return elements.panel && elements.panel.open;
  }

  /**
   * Open the activity panel
   */
  function open() {
    if (!elements.panel) return;
    elements.panel.open = true;
    loadActivities(true);
  }

  /**
   * Close the activity panel
   */
  function close() {
    if (!elements.panel) return;
    elements.panel.open = false;
  }

  /**
   * Load activities from API
   */
  async function loadActivities(reset = false) {
    if (state.isLoading) return;
    state.isLoading = true;

    if (reset) {
      state.offset = 0;
      state.activities = [];
      state.hasMore = true;
      if (elements.loading) {
        elements.loading.classList.remove('hidden');
      }
      if (elements.list) {
        elements.list.innerHTML = '';
        elements.list.appendChild(elements.loading);
      }
    } else {
      // Show loading more indicator
      const loadingMore = document.getElementById('activityLoadingMore');
      if (loadingMore) loadingMore.classList.remove('hidden');
    }

    try {
      // Pass both limit and offset for pagination
      const result = await api.getActivityFeed(state.limit, state.offset);
      let activities = result.activities || [];

      // Check if we have more items to load
      state.hasMore = activities.length >= state.limit;

      if (reset) {
        state.activities = activities;
      } else {
        // Avoid duplicates by checking IDs
        const existingIds = new Set(state.activities.map(a => a.id));
        const newActivities = activities.filter(a => !existingIds.has(a.id));
        state.activities = [...state.activities, ...newActivities];
        
        // If no new activities, we've reached the end
        if (newActivities.length === 0) {
          state.hasMore = false;
        }
      }

      // Update offset for next page
      state.offset = state.activities.length;
      render();
    } catch (error) {
      console.error('Failed to load activities:', error);
      if (elements.list && reset) {
        elements.list.innerHTML = `
          <div class="p-8 text-center">
            <svg class="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p class="text-gray-500">Failed to load activity</p>
            <button onclick="ActivityPanel.loadActivities(true)" class="mt-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium">Try again</button>
          </div>
        `;
      }
    } finally {
      state.isLoading = false;
      if (elements.loading) {
        elements.loading.classList.add('hidden');
      }
      const loadingMore = document.getElementById('activityLoadingMore');
      if (loadingMore) loadingMore.classList.add('hidden');
    }
  }

  /**
   * Render activity list in the panel
   */
  function render() {
    if (!elements.list) return;

    if (state.activities.length === 0) {
      elements.list.innerHTML = `
        <div class="p-8 text-center">
          <svg class="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-gray-500 font-medium">No activity yet</p>
          <p class="text-gray-400 text-sm mt-1">Activity will appear here as you work</p>
        </div>
      `;
      return;
    }

    elements.list.innerHTML = state.activities.map(activity => renderActivityItem(activity, false)).join('');

    // Add end of list indicator if no more items
    if (!state.hasMore) {
      elements.list.innerHTML += `
        <div class="p-4 text-center text-gray-400 text-sm">
          No more activity to show
        </div>
      `;
    }
  }

  /**
   * Render a single activity item
   * @param {Object} activity - Activity data
   * @param {boolean} compact - Whether to render in compact mode (for dashboard)
   */
  function renderActivityItem(activity, compact = false) {
    const icon = getActivityIcon(activity.event_type || activity.type);
    const bgColor = getActivityBgColor(activity.event_type || activity.type);
    const description = formatActivityDescription(activity);
    const timestamp = activity.created_at || activity.timestamp;
    const userName = activity.user?.first_name && activity.user?.last_name 
      ? `${activity.user.first_name} ${activity.user.last_name}`
      : activity.user?.email || activity.user || 'System';

    if (compact) {
      return `
        <div class="p-4 hover:bg-gray-50 transition-colors">
          <div class="flex items-start gap-3">
            <div class="w-9 h-9 ${bgColor} rounded-full flex items-center justify-center flex-shrink-0">
              ${icon}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-gray-900">${escapeHtml(description)}</p>
              <p class="text-xs text-gray-500 mt-1">${timeAgo(timestamp)}</p>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 ${bgColor} rounded-full flex items-center justify-center flex-shrink-0">
            ${icon}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900">${escapeHtml(userName)}</p>
            <p class="text-sm text-gray-600 mt-0.5">${escapeHtml(description)}</p>
            ${activity.resource_name ? `<p class="text-xs text-indigo-600 mt-1">${escapeHtml(activity.resource_name)}</p>` : ''}
            ${activity.matter ? `<p class="text-xs text-gray-400 mt-0.5">in ${escapeHtml(activity.matter)}</p>` : ''}
            <p class="text-xs text-gray-400 mt-1">${timeAgo(timestamp)}</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Format activity description from activity data
   */
  function formatActivityDescription(activity) {
    // If we have a description, use it
    if (activity.description) return activity.description;

    const eventType = activity.event_type || activity.type;
    const target = activity.target || activity.resource_name || '';
    const action = activity.action || '';

    // Build description from event type
    const descriptions = {
      'document_upload': `Uploaded ${target}`,
      'document_download': `Downloaded ${target}`,
      'document_view': `Viewed ${target}`,
      'document_delete': `Deleted ${target}`,
      'document_update': `Updated ${target}`,
      'matter_create': `Created matter ${target}`,
      'matter_update': `Updated matter ${target}`,
      'matter_delete': `Deleted matter ${target}`,
      'comment': `Commented on ${target}`,
      'comment_create': `Added a comment on ${target}`,
      'share': `Shared ${target}`,
      'ai_query': `Asked AI about ${target}`,
      'chat_stream': 'Started a chat conversation',
      'login': 'Signed in',
      'logout': 'Signed out',
      'user_create': `Created user ${target}`,
      'user_update': `Updated user ${target}`,
      'role_change': `Role changed to ${target}`,
      'export': `Exported ${target}`,
      'import': `Imported ${target}`
    };

    if (descriptions[eventType]) {
      return descriptions[eventType];
    }

    // Fallback: format event_type nicely
    if (action && target) {
      return `${action} ${target}`;
    }

    return eventType?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Activity';
  }

  /**
   * Get activity icon SVG based on type
   */
  function getActivityIcon(type) {
    const icons = {
      'document_upload': '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>',
      'document_download': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"></path></svg>',
      'document_view': '<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>',
      'document_delete': '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>',
      'document_update': '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>',
      'matter_create': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>',
      'matter_update': '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>',
      'matter_delete': '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>',
      'comment': '<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>',
      'comment_create': '<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>',
      'share': '<svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>',
      'ai_query': '<svg class="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>',
      'chat_stream': '<svg class="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>',
      'login': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>',
      'logout': '<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>',
      'user_create': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>',
      'user_update': '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>',
      'role_change': '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>',
      'export': '<svg class="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
      'import': '<svg class="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l3-3m-3 3l-3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"></path></svg>'
    };
    
    return icons[type] || '<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
  }

  /**
   * Get activity background color based on type
   */
  function getActivityBgColor(type) {
    const colors = {
      'document_upload': 'bg-blue-100',
      'document_download': 'bg-green-100',
      'document_view': 'bg-gray-100',
      'document_delete': 'bg-red-100',
      'document_update': 'bg-amber-100',
      'matter_create': 'bg-green-100',
      'matter_update': 'bg-blue-100',
      'matter_delete': 'bg-red-100',
      'comment': 'bg-indigo-100',
      'comment_create': 'bg-indigo-100',
      'share': 'bg-purple-100',
      'ai_query': 'bg-violet-100',
      'chat_stream': 'bg-violet-100',
      'login': 'bg-green-100',
      'logout': 'bg-gray-100',
      'user_create': 'bg-green-100',
      'user_update': 'bg-blue-100',
      'role_change': 'bg-amber-100',
      'export': 'bg-cyan-100',
      'import': 'bg-cyan-100'
    };
    return colors[type] || 'bg-gray-100';
  }

  /**
   * Load and render activity in the dashboard feed (compact view)
   * @param {number} limit - Number of items to show
   * @returns {Promise}
   */
  async function loadDashboardFeed(limit = 10) {
    const container = elements.feedContainer || document.getElementById('activityFeed');
    if (!container) return Promise.resolve();

    try {
      const result = await api.getActivityFeed(limit);
      const activities = result.activities || [];

      if (activities.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center">
            <svg class="w-12 h-12 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p class="text-gray-500">No recent activity</p>
          </div>
        `;
        return;
      }

      // Render items (compact view)
      container.innerHTML = activities.slice(0, limit).map(activity => renderActivityItem(activity, true)).join('');

    } catch (error) {
      console.error('Failed to load activity:', error);
      container.innerHTML = `
        <div class="p-6 text-center">
          <p class="text-gray-500">Failed to load activity</p>
          <button onclick="ActivityPanel.loadDashboardFeed(10)" class="mt-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium">Try again</button>
        </div>
      `;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Format time ago (uses global timeAgo if available)
   */
  function timeAgo(dateString) {
    if (window.timeAgo) {
      return window.timeAgo(dateString);
    }

    // Fallback implementation
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return formatDate(dateString);
  }

  // Public API
  return {
    init,
    injectHTML,
    open,
    close,
    isOpen,
    loadActivities,
    loadDashboardFeed,
    renderActivityItem,
    getState: () => ({ ...state })
  };
})();


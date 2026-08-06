/**
 * Lana AI Notification Panel
 * 
 * Reusable notification slide-out panel component.
 * Handles fetching, displaying, and managing notifications.
 * 
 * Usage:
 *   1. Include this script after api.js
 *   2. Add the notification HTML structure (or call NotificationPanel.injectHTML())
 *   3. Call NotificationPanel.init() after DOM is ready
 */

window.DesktopNotifications = window.DesktopNotifications || (function() {
  const ENABLED_KEY = 'lana.desktopNotifications.enabled';
  const SEEN_KEY = 'lana.desktopNotifications.seenIds';
  const MAX_NOTIFICATIONS_PER_POLL = 3;
  const PREFERENCES_CACHE_TTL_MS = (window.LanaTime && window.LanaTime.MS_PER_MINUTE) || 60000;

  let lastUnreadCount = null;
  let isFetching = false;
  let serverPreferences = null;
  let serverPreferencesLoadedAt = 0;

  function nowMs() {
    if (window.LanaTime && typeof window.LanaTime.nowMs === 'function') {
      return window.LanaTime.nowMs();
    }
    return Date.now();
  }

  function millisecondsSince(timestamp) {
    if (window.LanaTime && typeof window.LanaTime.millisecondsSince === 'function') {
      return window.LanaTime.millisecondsSince(timestamp);
    }
    return nowMs() - Number(timestamp || 0);
  }

  function isSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  function isEnabled() {
    return isSupported() && localStorage.getItem(ENABLED_KEY) !== 'false';
  }

  function getSeenIds() {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'));
    } catch (_error) {
      return new Set();
    }
  }

  function rememberSeenId(id) {
    if (!id) return;
    const ids = getSeenIds();
    ids.add(id);
    const trimmed = Array.from(ids).slice(-100);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  }

  function enableFromUserGesture() {
    if (!isSupported()) return Promise.resolve(false);

    localStorage.setItem(ENABLED_KEY, 'true');

    if (Notification.permission === 'granted') {
      return Promise.resolve(true);
    }

    if (Notification.permission === 'denied') {
      return Promise.resolve(false);
    }

    return Notification.requestPermission().then(function(permission) {
      if (permission === 'denied') {
        localStorage.setItem(ENABLED_KEY, 'false');
      }
      return permission === 'granted';
    }).catch(function() {
      return false;
    });
  }

  function getPlatformName() {
    if (window.electronAPI && window.electronAPI.platform) {
      if (window.electronAPI.platform === 'darwin') return 'Mac';
      if (window.electronAPI.platform === 'win32') return 'Windows';
    }

    const platform = (navigator.userAgentData && navigator.userAgentData.platform)
      || navigator.platform
      || '';
    if (/mac/i.test(platform)) return 'Mac';
    if (/win/i.test(platform)) return 'Windows';
    return 'this device';
  }

  function getBlockedPermissionMessage() {
    const platform = getPlatformName();
    if (platform === 'Mac') {
      return 'Notifications are blocked. Enable them in macOS System Settings > Notifications > LANA AI.';
    }
    if (platform === 'Windows') {
      return 'Notifications are blocked. Enable them in Windows Settings > System > Notifications for LANA AI.';
    }
    return 'Notifications are blocked. Enable them in your system or browser notification settings.';
  }

  function showTestNotification() {
    if (!isEnabled() || Notification.permission !== 'granted') return false;

    const platform = getPlatformName();
    const desktopNotification = new Notification('LANA AI notifications enabled', {
      body: 'Test notification delivered for ' + platform + '.',
      tag: 'lana-desktop-notification-test',
      renotify: false
    });

    desktopNotification.onclick = function() {
      desktopNotification.close();
      window.focus();
    };

    return true;
  }

  async function getServerPreferences() {
    if (!window.api || typeof window.api.getNotificationPreferences !== 'function') {
      return null;
    }

    if (serverPreferences && millisecondsSince(serverPreferencesLoadedAt) < PREFERENCES_CACHE_TTL_MS) {
      return serverPreferences;
    }

    const result = await window.api.getNotificationPreferences();
    serverPreferences = (result && result.preferences) || null;
    serverPreferencesLoadedAt = nowMs();
    return serverPreferences;
  }

  function allowsPush(preferences, notification) {
    if (!preferences) return true;
    if (preferences.push_enabled === false) return false;

    const type = notification && notification.type;
    const perType = preferences.notification_types || {};
    if (type && perType[type] && perType[type].push === false) return false;
    return true;
  }

  async function requestPermissionAndTest() {
    const granted = await enableFromUserGesture();
    if (granted) {
      showTestNotification();
    }
    return {
      supported: isSupported(),
      granted,
      permission: isSupported() ? Notification.permission : 'unsupported',
      platform: getPlatformName(),
      blockedMessage: granted ? '' : getBlockedPermissionMessage()
    };
  }

  function openNotificationTarget(notification) {
    const actionUrl = notification && notification.action_url;
    if (!actionUrl) return;
    window.focus();
    window.location.href = actionUrl;
  }

  function show(notification) {
    if (!isEnabled() || Notification.permission !== 'granted' || !notification) return false;

    const id = notification.id || '';
    if (id && getSeenIds().has(id)) return false;

    const title = notification.title || 'LANA AI notification';
    const body = notification.body || notification.message || '';
    const desktopNotification = new Notification(title, {
      body,
      tag: id || undefined,
      renotify: false,
      data: {
        id,
        action_url: notification.action_url || ''
      }
    });

    desktopNotification.onclick = function() {
      desktopNotification.close();
      openNotificationTarget(notification);
    };

    if (id) rememberSeenId(id);
    return true;
  }

  function showSummary(extraCount) {
    if (!isEnabled() || Notification.permission !== 'granted' || extraCount <= 0) return;

    const id = 'lana-notification-summary-' + nowMs();
    const desktopNotification = new Notification('LANA AI notifications', {
      body: extraCount === 1
        ? 'You have 1 more unread notification.'
        : 'You have ' + extraCount + ' more unread notifications.',
      tag: id,
      renotify: false
    });

    desktopNotification.onclick = function() {
      desktopNotification.close();
      window.focus();
      if (window.Lex && window.Lex.Nav) {
        window.Lex.Nav.go('notifications.html');
      } else {
        window.location.href = 'notifications.html';
      }
    };
  }

  async function notifyLatest(delta) {
    if (!isEnabled() || Notification.permission !== 'granted' || isFetching || !window.api) return;

    isFetching = true;
    try {
      const preferences = await getServerPreferences().catch(function() { return null; });
      if (preferences && preferences.push_enabled === false) return;

      const limit = Math.min(Math.max(delta || 1, 1), MAX_NOTIFICATIONS_PER_POLL);
      const result = await window.api.getNotifications(true, limit, 0);
      const notifications = result.notifications || [];

      notifications.forEach(function(notification) {
        if (allowsPush(preferences, notification)) show(notification);
      });

      const shownCount = notifications.filter(function(notification) {
        return allowsPush(preferences, notification);
      }).length;
      if (delta > shownCount) {
        showSummary(delta - shownCount);
      }
    } catch (error) {
      console.warn('[DesktopNotifications] Failed to show local notification:', error);
    } finally {
      isFetching = false;
    }
  }

  function handleUnreadCount(count) {
    const unreadCount = Number(count) || 0;

    if (lastUnreadCount === null) {
      lastUnreadCount = unreadCount;
      return;
    }

    const delta = unreadCount - lastUnreadCount;
    lastUnreadCount = unreadCount;

    if (delta > 0) {
      notifyLatest(delta);
    }
  }

  return {
    enableFromUserGesture,
    requestPermissionAndTest,
    handleUnreadCount,
    isEnabled,
    isSupported,
    showTestNotification
  };
})();

window.NotificationPanel = (function() {
  // State
  let state = {
    notifications: [],
    unreadCount: 0,
    offset: 0,
    limit: 20,
    hasMore: false,
    filter: 'all', // 'all' or 'unread'
    isLoading: false,
    isInitialized: false
  };

  // DOM Elements (cached after init)
  let elements = {};

  // Stored interval handle for badge polling — allows pause/resume (Finding 8)
  let _badgeInterval = null;

  /**
   * Initialize the notification panel
   * @param {Object} options - Configuration options
   * @param {boolean} options.autoLoadBadge - Load badge count on init (default: true)
   * @param {number} options.refreshInterval - Badge refresh interval in ms (default: 60000)
   */
  function init(options = {}) {
    if (state.isInitialized) return;

    const { autoLoadBadge = true, refreshInterval = 60000 } = options;

    // Cache DOM elements
    elements = {
      btn: document.getElementById('notificationBtn'),
      panel: document.getElementById('notificationPanel'),
      overlay: document.getElementById('notificationOverlay'),
      closeBtn: document.getElementById('closeNotificationPanel'),
      viewAllBtn: document.getElementById('viewAllNotificationsBtn'),
      list: document.getElementById('notificationList'),
      loading: document.getElementById('notificationLoading'),
      loadingMore: document.getElementById('notificationLoadingMore'),
      badge: document.getElementById('notificationBadge'),
      markAllReadBtn: document.getElementById('markAllReadBtn'),
      refreshBtn: document.getElementById('refreshNotificationsBtn'),
      filterAll: document.getElementById('filterAll'),
      filterUnread: document.getElementById('filterUnread')
    };

    // Check required elements exist
    if (!elements.btn || !elements.panel) {
      console.warn('NotificationPanel: Required elements not found. Call injectHTML() first or add elements manually.');
      return;
    }

    // Bind events
    bindEvents();

    // Load initial badge count
    if (autoLoadBadge) {
      loadBadgeCount();
      if (refreshInterval > 0) {
        _badgeInterval = setInterval(loadBadgeCount, refreshInterval);
      }
    }

    state.isInitialized = true;
  }

  /**
   * Inject the notification panel HTML into the page
   * @param {string} targetSelector - Selector for where to inject (default: after header)
   */
  function injectHTML(targetSelector) {
    const html = `
    <!-- Notification Panel Overlay -->
    <div id="notificationOverlay" class="fixed inset-0 bg-black bg-opacity-50 z-40 hidden transition-opacity"></div>

    <!-- Notification Slide-out Panel -->
    <div id="notificationPanel" class="fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-2xl z-50 transform translate-x-full transition-transform duration-300 ease-in-out flex flex-col">
      <!-- Panel Header -->
      <div class="flex items-center justify-between h-16 px-6 border-b border-gray-200 flex-shrink-0">
        <h2 class="text-lg font-semibold text-gray-900">Notifications</h2>
        <div class="flex items-center gap-3">
          <button id="viewAllNotificationsBtn" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium">View all</button>
          <button id="markAllReadBtn" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium hidden">Mark all read</button>
          <button id="refreshNotificationsBtn" class="text-gray-400 hover:text-gray-600 transition-colors" title="Refresh">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
          <button id="closeNotificationPanel" class="text-gray-400 hover:text-gray-600">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Filter Tabs -->
      <div class="flex border-b border-gray-200 px-6 flex-shrink-0">
        <button id="filterAll" class="px-4 py-3 text-sm font-medium text-indigo-600 border-b-2 border-indigo-600">All</button>
        <button id="filterUnread" class="px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-700">Unread</button>
      </div>

      <!-- Notifications List -->
      <div id="notificationList" class="flex-1 overflow-y-auto">
        <!-- Loading State -->
        <div id="notificationLoading" class="p-8 text-center">
          <div class="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div>
          <p class="text-gray-500 mt-3 text-sm">Loading notifications...</p>
        </div>
      </div>

      <!-- Loading More Indicator -->
      <div id="notificationLoadingMore" class="hidden p-4 border-t border-gray-100 text-center flex-shrink-0">
        <div class="animate-spin w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div>
      </div>
    </div>
    `;

    if (targetSelector) {
      const target = document.querySelector(targetSelector);
      if (target) {
        target.insertAdjacentHTML('afterend', html);
        return;
      }
    }

    // Default: inject at end of body
    document.body.insertAdjacentHTML('beforeend', html);
  }

  /**
   * Bind all event listeners
   */
  function bindEvents() {
    // Open panel
    elements.btn.addEventListener('click', () => {
      if (window.DesktopNotifications) {
        window.DesktopNotifications.enableFromUserGesture();
      }
      open();
    });

    // Close panel
    if (elements.closeBtn) {
      elements.closeBtn.addEventListener('click', close);
    }
    if (elements.overlay) {
      elements.overlay.addEventListener('click', close);
    }

    // Escape key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        close();
      }
    });

    // Filter tabs
    if (elements.filterAll) {
      elements.filterAll.addEventListener('click', () => setFilter('all'));
    }
    if (elements.filterUnread) {
      elements.filterUnread.addEventListener('click', () => setFilter('unread'));
    }

    // Mark all read
    if (elements.markAllReadBtn) {
      elements.markAllReadBtn.addEventListener('click', markAllAsRead);
    }

    // Refresh button
    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', () => {
        elements.refreshBtn.classList.add('animate-spin');
        loadNotifications(true).finally(() => {
          setTimeout(() => elements.refreshBtn.classList.remove('animate-spin'), 300);
        });
      });
    }

    if (elements.viewAllBtn) {
      elements.viewAllBtn.addEventListener('click', () => {
        close();
        if (window.Lex && window.Lex.Nav) {
          window.Lex.Nav.go('notifications.html');
        } else {
          window.location.href = 'notifications.html';
        }
      });
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
      loadNotifications(false);
    }
  }

  /**
   * Check if panel is open
   */
  function isOpen() {
    return elements.panel && !elements.panel.classList.contains('translate-x-full');
  }

  /**
   * Open the notification panel
   */
  function open() {
    if (!elements.panel) {
      console.warn('[NotificationPanel] Panel element not found');
      return;
    }
    
    // Ensure user is authenticated before loading notifications
    if (!api.isAuthenticated()) {
      console.warn('[NotificationPanel] User not authenticated, cannot load notifications');
      return;
    }
    
    elements.panel.classList.remove('translate-x-full');
    if (elements.overlay) {
      elements.overlay.classList.remove('hidden');
    }
    document.body.classList.add('overflow-hidden');
    loadNotifications(true);
  }

  /**
   * Close the notification panel
   */
  function close() {
    if (!elements.panel) return;
    
    elements.panel.classList.add('translate-x-full');
    if (elements.overlay) {
      elements.overlay.classList.add('hidden');
    }
    document.body.classList.remove('overflow-hidden');
  }

  /**
   * Set filter (all or unread)
   */
  function setFilter(filter) {
    state.filter = filter;
    
    if (filter === 'all') {
      elements.filterAll?.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600');
      elements.filterAll?.classList.remove('text-gray-500');
      elements.filterUnread?.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600');
      elements.filterUnread?.classList.add('text-gray-500');
    } else {
      elements.filterUnread?.classList.add('text-indigo-600', 'border-b-2', 'border-indigo-600');
      elements.filterUnread?.classList.remove('text-gray-500');
      elements.filterAll?.classList.remove('text-indigo-600', 'border-b-2', 'border-indigo-600');
      elements.filterAll?.classList.add('text-gray-500');
    }
    
    loadNotifications(true);
  }

  /**
   * Load notifications from API
   * @returns {Promise}
   */
  async function loadNotifications(reset = false) {
    if (state.isLoading) return Promise.resolve();
    
    // Ensure user is authenticated
    if (!api.isAuthenticated()) {
      console.warn('[NotificationPanel] User not authenticated, cannot load notifications');
      return Promise.resolve();
    }
    
    state.isLoading = true;

    if (reset) {
      state.offset = 0;
      state.notifications = [];
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
      if (elements.loadingMore) {
        elements.loadingMore.classList.remove('hidden');
      }
    }

    try {
      // Pass limit and offset for pagination
      const result = await api.getNotifications(state.filter === 'unread', state.limit, state.offset);
      const notifications = result.notifications || [];
      state.unreadCount = result.unread_count || 0;
      
      console.log(`[NotificationPanel] Loaded ${notifications.length} notification(s), ${state.unreadCount} unread`);

      // Update badge
      updateBadge(state.unreadCount);

      // Show/hide mark all read button
      if (elements.markAllReadBtn) {
        if (state.unreadCount > 0) {
          elements.markAllReadBtn.classList.remove('hidden');
        } else {
          elements.markAllReadBtn.classList.add('hidden');
        }
      }

      // Check if we have more items to load
      state.hasMore = notifications.length >= state.limit;

      if (reset) {
        state.notifications = notifications;
      } else {
        // Avoid duplicates by checking IDs
        const existingIds = new Set(state.notifications.map(n => n.id));
        const newNotifications = notifications.filter(n => !existingIds.has(n.id));
        state.notifications = [...state.notifications, ...newNotifications];
        
        // If no new notifications, we've reached the end
        if (newNotifications.length === 0) {
          state.hasMore = false;
        }
      }

      // Update offset for next page
      state.offset = state.notifications.length;

      render();
    } catch (error) {
      console.error('Failed to load notifications:', error);
      if (elements.list && reset) {
        elements.list.innerHTML = `
          <div class="p-8 text-center">
            <svg class="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p class="text-gray-500">Failed to load notifications</p>
            <button onclick="NotificationPanel.loadNotifications(true)" class="mt-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium">Try again</button>
          </div>
        `;
      }
    } finally {
      state.isLoading = false;
      if (elements.loading) {
        elements.loading.classList.add('hidden');
      }
      if (elements.loadingMore) {
        elements.loadingMore.classList.add('hidden');
      }
    }
  }

  /**
   * Render notifications list
   */
  function render() {
    if (!elements.list) return;

    if (state.notifications.length === 0) {
      elements.list.innerHTML = `
        <div class="p-8 text-center">
          <svg class="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
          </svg>
          <p class="text-gray-500 font-medium">No notifications</p>
          <p class="text-gray-400 text-sm mt-1">${state.filter === 'unread' ? 'You\'re all caught up!' : 'Check back later for updates'}</p>
        </div>
      `;
      if (elements.loadMoreContainer) {
        elements.loadMoreContainer.classList.add('hidden');
      }
      return;
    }

    let html = state.notifications.map(notification => {
      const isUnread = !notification.read && !notification.is_read;
      const iconHtml = getNotificationIcon(notification.type);
      
      return `
        <div class="notification-item p-4 border-b border-gray-100 ${isUnread ? 'bg-indigo-50/50' : ''}"
             data-id="${notification.id}"
             data-read="${!isUnread}">
          <div class="flex gap-3">
            <div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getNotificationBgColor(notification.type)}">
              ${iconHtml}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm font-medium text-gray-900 ${isUnread ? 'font-semibold' : ''}">${escapeHtml(notification.title)}</p>
                ${isUnread ? '<span class="w-2 h-2 bg-indigo-600 rounded-full flex-shrink-0 mt-1.5"></span>' : ''}
              </div>
              <p class="text-sm text-gray-600 mt-0.5">${escapeHtml(notification.body || notification.message || '')}</p>
              <p class="text-xs text-gray-400 mt-1" title="${escapeHtml(formatDateTime(notification.created_at))}">${timeAgo(notification.created_at)}</p>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add end of list indicator if no more items
    if (!state.hasMore && state.notifications.length > 0) {
      html += `
        <div class="p-4 text-center text-gray-400 text-sm">
          No more notifications
        </div>
      `;
    }

    elements.list.innerHTML = html;

    // TODO: Implement proper click handling for notifications
    // For now, click handlers are disabled to prevent navigation while we work on proper UX
    // The notification items will show full text without truncation

    // Add click handlers
    // document.querySelectorAll('.notification-item').forEach(item => {
    //   item.addEventListener('click', async () => {
    //     const notificationId = item.dataset.id;
    //     const notification = state.notifications.find(n => n.id === notificationId);
    //
    //     // Mark as read (even if already read, to ensure sync with server)
    //     await markAsRead(notificationId);
    //
    //     // Navigate to action URL if available
    //     if (notification && notification.action_url) {
    //       close();
    //       window.location.href = notification.action_url;
    //     }
    //   });
    // });
  }

  /**
   * Get notification icon SVG based on type
   */
  function getNotificationIcon(type) {
    const icons = {
      'success': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
      'info': '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      'warning': '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
      'error': '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
      'comment': '<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>',
      'comment_mention': '<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"></path></svg>',
      'comment_reply': '<svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>',
      'share': '<svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>',
      'document_shared': '<svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>',
      'matter_shared': '<svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>',
      'matter_assigned': '<svg class="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>',
      'document': '<svg class="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
      'document_processed': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      'processing_failed': '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      'role_changed': '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>',
      'system_alert': '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
      'storage_warning': '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"></path></svg>',
      'security': '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>',
      'password_reset_request': '<svg class="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>',
      'password_changed': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>',
      'login_new_device': '<svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>'
    };
    return icons[type] || icons['info'];
  }

  /**
   * Get notification background color based on type
   */
  function getNotificationBgColor(type) {
    const colors = {
      'success': 'bg-green-100',
      'info': 'bg-blue-100',
      'warning': 'bg-amber-100',
      'error': 'bg-red-100',
      'comment': 'bg-indigo-100',
      'comment_mention': 'bg-indigo-100',
      'comment_reply': 'bg-indigo-100',
      'share': 'bg-purple-100',
      'document_shared': 'bg-purple-100',
      'matter_shared': 'bg-purple-100',
      'matter_assigned': 'bg-teal-100',
      'document': 'bg-cyan-100',
      'document_processed': 'bg-green-100',
      'processing_failed': 'bg-red-100',
      'role_changed': 'bg-amber-100',
      'system_alert': 'bg-red-100',
      'storage_warning': 'bg-amber-100',
      'security': 'bg-red-100',
      'password_reset_request': 'bg-orange-100',
      'password_changed': 'bg-green-100',
      'login_new_device': 'bg-amber-100'
    };
    return colors[type] || 'bg-gray-100';
  }

  /**
   * Mark a notification as read
   */
  async function markAsRead(notificationId) {
    try {
      await api.markNotificationRead(notificationId);
      
      // Update local state
      const notification = state.notifications.find(n => n.id === notificationId);
      if (notification) {
        const wasUnread = !notification.read && !notification.is_read;
        notification.read = true;
        notification.is_read = true;
        
        // Only decrement count if it was previously unread
        if (wasUnread) {
          state.unreadCount = Math.max(0, state.unreadCount - 1);
          updateBadge(state.unreadCount);
        }
        
        // If filtering by unread, remove the notification from the list
        if (state.filter === 'unread') {
          state.notifications = state.notifications.filter(n => n.id !== notificationId);
          // Re-render to update the list
          render();
        } else {
          // Otherwise, just update the UI styling
          const item = document.querySelector(`.notification-item[data-id="${notificationId}"]`);
          if (item) {
            item.classList.remove('bg-indigo-50/50');
            item.dataset.read = 'true';
            const dot = item.querySelector('.bg-indigo-600.rounded-full');
            if (dot) dot.remove();
            const title = item.querySelector('.font-semibold');
            if (title) title.classList.remove('font-semibold');
          }
        }

        // Hide mark all read if no more unread
        if (state.unreadCount === 0 && elements.markAllReadBtn) {
          elements.markAllReadBtn.classList.add('hidden');
        }
      }
    } catch (error) {
      console.error('[NotificationPanel] Failed to mark notification as read:', error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async function markAllAsRead() {
    try {
      await api.markAllNotificationsRead();
      state.unreadCount = 0;
      state.notifications.forEach(n => {
        n.read = true;
        n.is_read = true;
      });
      updateBadge(0);
      if (elements.markAllReadBtn) {
        elements.markAllReadBtn.classList.add('hidden');
      }
      render();
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  }

  /**
   * Update the notification badge
   */
  function updateBadge(count) {
    if (!elements.badge) return;
    
    if (count > 0) {
      elements.badge.textContent = count > 99 ? '99+' : count;
      elements.badge.classList.remove('hidden');
    } else {
      elements.badge.classList.add('hidden');
    }
  }

  /**
   * Load just the badge count (without opening panel)
   */
  async function loadBadgeCount() {
    try {
      // Only load badge if user is authenticated
      if (!api.isAuthenticated()) {
        return;
      }
      
      const result = await api.getNotifications(false, 1, 0); // Just get count, limit to 1
      state.unreadCount = result.unread_count || 0;
      updateBadge(state.unreadCount);
      if (window.DesktopNotifications) {
        window.DesktopNotifications.handleUnreadCount(state.unreadCount);
      }
      
      // Log for debugging
      if (state.unreadCount > 0) {
        console.log(`[NotificationPanel] Found ${state.unreadCount} unread notification(s)`);
      }
    } catch (error) {
      console.error('[NotificationPanel] Failed to load notification count:', error);
      // Don't show error to user, just log it
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

  /**
   * Pause the badge polling interval (e.g. when page is hidden or user logs out).
   * Safe to call multiple times — no-op if already paused.
   */
  function pause() {
    if (_badgeInterval) {
      clearInterval(_badgeInterval);
      _badgeInterval = null;
    }
  }

  /**
   * Resume the badge polling interval.
   * Safe to call multiple times — no-op if already running.
   * @param {number} [interval] - Override polling interval in ms (default: 60000)
   */
  function resume(interval) {
    if (!_badgeInterval) {
      var ms = interval || 60000;
      _badgeInterval = setInterval(loadBadgeCount, ms);
    }
  }

  // Public API
  return {
    init,
    injectHTML,
    open,
    close,
    isOpen,
    pause,
    resume,
    loadNotifications,
    loadBadgeCount,
    markAsRead,
    markAllAsRead,
    updateBadge,
    getState: () => ({ ...state }),
    getUnreadCount: () => state.unreadCount
  };
})();

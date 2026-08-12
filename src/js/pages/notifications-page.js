(function () {
  'use strict';

  var state = {
    filter: 'all',
    notifications: [],
    unreadCount: 0,
    offset: 0,
    limit: 50,
    hasMore: true,
    loading: false,
    type: '',
    typeOptions: [{ value: '', label: 'All types' }]
  };

  var els = {};

  var ICONS = {
    success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>',
    info: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    warning: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>',
    error: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>',
    document: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
    comment: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>'
  };

  var TYPE_STYLES = {
    success: { bg: 'var(--lex-status-success-bg)', text: 'var(--lex-status-success-text)' },
    document_processed: { bg: 'var(--lex-status-success-bg)', text: 'var(--lex-status-success-text)' },
    password_changed: { bg: 'var(--lex-status-success-bg)', text: 'var(--lex-status-success-text)' },
    info: { bg: 'var(--lex-status-info-bg)', text: 'var(--lex-status-info-text)' },
    document: { bg: 'var(--lex-status-info-bg)', text: 'var(--lex-status-info-text)' },
    warning: { bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    role_changed: { bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    storage_warning: { bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    error: { bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    processing_failed: { bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    system_alert: { bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    security: { bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    comment: { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    comment_mention: { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    comment_reply: { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' }
  };

  function init() {
    var params = new URLSearchParams(window.location.search || '');
    var filter = params.get('filter');
    if (filter === 'unread') state.filter = 'unread';
    state.type = params.get('type') || '';

    els = {
      filter: document.getElementById('notificationsFilter'),
      type: document.getElementById('notificationsTypeFilter'),
      list: document.getElementById('notificationsList'),
      state: document.getElementById('notificationsState'),
      count: document.getElementById('notificationsCount'),
      unreadMeta: document.getElementById('notificationsUnreadMeta'),
      loadMore: document.getElementById('notificationsLoadMore'),
      refresh: document.getElementById('notificationsRefresh'),
      markAll: document.getElementById('notificationsMarkAll')
    };

    if (els.filter) els.filter.value = state.filter;
    if (state.type) addTypeOption(state.type, formatTypeLabel(state.type));
    if (els.type) els.type.value = state.type;

    bindEvents();
    loadTypeOptions().finally(function () {
      loadNotifications(true);
    });
  }

  function bindEvents() {
    if (els.filter) {
      els.filter.addEventListener('lex-change', function (e) {
        state.filter = e.detail && e.detail.value || 'all';
        syncUrl();
        loadNotifications(true);
      });
    }

    if (els.type) {
      els.type.addEventListener('lex-change', function (e) {
        state.type = e.detail && e.detail.value || '';
        syncUrl();
        loadNotifications(true);
      });
    }

    if (els.refresh) {
      els.refresh.addEventListener('click', function () {
        els.refresh.loading = true;
        loadNotifications(true).finally(function () {
          setTimeout(function () { els.refresh.loading = false; }, 250);
        });
      });
    }

    if (els.markAll) {
      els.markAll.addEventListener('click', markAllRead);
    }

    if (els.loadMore) {
      els.loadMore.addEventListener('click', function () {
        loadNotifications(false);
      });
    }
  }

  function loadTypeOptions() {
    if (!window.api || typeof api.getNotificationTypes !== 'function') {
      renderTypeOptions();
      return Promise.resolve();
    }

    return api.getNotificationTypes()
      .then(function (result) {
        var types = result && Array.isArray(result.types) ? result.types : [];
        types.forEach(function (item) {
          addTypeOption(item.type, item.display_type || formatTypeLabel(item.type), item.description);
        });
        renderTypeOptions();
      })
      .catch(function (error) {
        console.warn('[NotificationsPage] Failed to load notification types:', error);
        renderTypeOptions();
      });
  }

  function loadNotifications(reset) {
    if (state.loading) return Promise.resolve();
    if (!window.api || !api.isAuthenticated()) return Promise.resolve();

    state.loading = true;
    if (reset) {
      state.offset = 0;
      state.notifications = [];
      state.hasMore = true;
      renderLoading();
    } else if (els.loadMore) {
      els.loadMore.loading = true;
    }

    return api.getNotifications(state.filter === 'unread', state.limit, state.offset, state.type)
      .then(function (result) {
        var items = result.notifications || [];
        items.forEach(function (item) {
          if (item && item.type) addTypeOption(item.type, formatTypeLabel(item.type));
        });
        renderTypeOptions();
        state.unreadCount = result.unread_count || 0;
        state.hasMore = items.length >= state.limit;

        if (reset) {
          state.notifications = items;
        } else {
          var existing = {};
          state.notifications.forEach(function (item) { existing[item.id] = true; });
          items.forEach(function (item) {
            if (!existing[item.id]) state.notifications.push(item);
          });
        }

        state.offset = state.notifications.length;
        render();
        emitCount();
      })
      .catch(function (error) {
        console.error('[NotificationsPage] Failed to load notifications:', error);
        renderError();
      })
      .finally(function () {
        state.loading = false;
        if (els.loadMore) els.loadMore.loading = false;
      });
  }

  function markAllRead() {
    if (!window.api) return;

    api.markAllNotificationsRead()
      .then(function () {
        state.unreadCount = 0;
        state.notifications.forEach(function (item) {
          item.read = true;
          item.is_read = true;
        });
        render();
        emitCount();
      })
      .catch(function (error) {
        console.error('[NotificationsPage] Failed to mark all read:', error);
      });
  }

  function markRead(notification) {
    if (!notification || !notification.id || !window.api) return Promise.resolve();
    var wasUnread = !notification.read && !notification.is_read;

    return api.markNotificationRead(notification.id)
      .then(function () {
        notification.read = true;
        notification.is_read = true;
        if (wasUnread) {
          state.unreadCount = Math.max(0, state.unreadCount - 1);
          emitCount();
        }
      })
      .catch(function (error) {
        console.error('[NotificationsPage] Failed to mark read:', error);
      });
  }

  function openNotification(notification) {
    if (!notification) return;

    markRead(notification).then(function () {
      if (!notification.action_url) {
        render();
        return;
      }

      var href = resolveNotificationTarget(notification);
      if (!href) {
        render();
        return;
      }

      if (window.Lex && window.Lex.Nav) {
        window.Lex.Nav.go(href);
      } else {
        window.location.href = href;
      }
    });
  }

  function normalizeActionUrl(url) {
    if (!url) return '';
    if (url === '/alerts' || url === '/alerts/') return 'notifications.html';
    if (url.indexOf('/') === 0) return url.substring(1);
    return url;
  }

  function readPath(object, path) {
    var current = object;
    for (var i = 0; i < path.length; i++) {
      if (!current || typeof current !== 'object') return '';
      current = current[path[i]];
    }
    return current || '';
  }

  function firstValue(values) {
    for (var i = 0; i < values.length; i++) {
      if (values[i]) return values[i];
    }
    return '';
  }

  function idFromPath(url, prefix) {
    if (!url || url.indexOf(prefix) !== 0) return '';
    var rest = url.substring(prefix.length);
    return rest.split('?')[0].split('/')[0] || '';
  }

  function approvalIdFromNotification(notification) {
    return firstValue([
      notification.approval_id,
      notification.approvalId,
      readPath(notification, ['approval', 'id']),
      readPath(notification, ['data', 'approval_id']),
      readPath(notification, ['data', 'approvalId']),
      readPath(notification, ['data', 'approval', 'id']),
      readPath(notification, ['details', 'approval_id']),
      readPath(notification, ['details', 'approvalId']),
      readPath(notification, ['metadata', 'approval_id']),
      readPath(notification, ['metadata', 'approvalId'])
    ]);
  }

  function resolveNotificationTarget(notification) {
    if (!notification) return '';
    var url = notification.action_url || '';
    var approvalId = approvalIdFromNotification(notification)
      || idFromPath(url, '/api/v1/approvals/')
      || idFromPath(url, '/api/approvals/')
      || idFromPath(url, '/approvals/');

    if (!approvalId && (notification.resource_type === 'approval_request' || notification.resource_type === 'approval')) {
      approvalId = notification.resource_id || '';
    }

    if (approvalId) {
      return 'approval-detail.html?id=' + encodeURIComponent(approvalId);
    }

    return normalizeActionUrl(url);
  }

  function fallbackMachineIdentifierToLabel(value) {
    return String(value || '').trim();
  }

  function formatDisplayText(value) {
    if (window.LanaDisplay && typeof window.LanaDisplay.formatText === 'function') {
      return window.LanaDisplay.formatText(value);
    }

    var text = String(value || '');
    var quoteParts = text.split("'");
    if (quoteParts.length > 2) {
      for (var i = 1; i < quoteParts.length; i += 2) {
        if (quoteParts[i].indexOf('_') !== -1 || quoteParts[i].indexOf('-') !== -1 || quoteParts[i].indexOf('.') !== -1) {
          quoteParts[i] = fallbackMachineIdentifierToLabel(quoteParts[i]);
        }
      }
      return quoteParts.join("'");
    }
    return text;
  }

  function renderLoading() {
    if (els.state) {
      els.state.hidden = false;
      els.state.innerHTML = '<lex-spinner size="md" label="Loading notifications..."></lex-spinner>';
    }
    if (els.list) els.list.innerHTML = '';
    updateSummary();
  }

  function renderError() {
    if (!els.state) return;
    els.state.hidden = false;
    els.state.innerHTML = [
      '<lex-empty icon="alert-circle" message="Failed to load notifications" description="Refresh to try again."></lex-empty>'
    ].join('');
    if (els.loadMore) els.loadMore.hidden = true;
  }

  function render() {
    updateSummary();

    if (!els.list || !els.state) return;

    if (state.notifications.length === 0) {
      els.list.innerHTML = '';
      els.state.hidden = false;
      els.state.innerHTML = '<lex-empty icon="inbox" message="No notifications" description="' + escapeHtml(state.filter === 'unread' ? "You're all caught up." : 'Check back later for updates.') + '"></lex-empty>';
      if (els.loadMore) els.loadMore.hidden = true;
      return;
    }

    els.state.hidden = true;
    els.list.innerHTML = state.notifications.map(renderItem).join('');

    var buttons = els.list.querySelectorAll('[data-notification-id]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var id = this.getAttribute('data-notification-id');
        var notification = state.notifications.find(function (item) { return item.id === id; });
        openNotification(notification);
      });
    }

    if (els.loadMore) els.loadMore.hidden = !state.hasMore;
  }

  function renderItem(notification) {
    var unread = !notification.read && !notification.is_read;
    var type = notification.type || 'info';
    var style = TYPE_STYLES[type] || { bg: 'var(--lex-bg-tertiary)', text: 'var(--lex-text-secondary)' };
    var title = formatDisplayText(notification.display_title || notification.title || 'Notification');
    var message = formatDisplayText(notification.display_message || notification.body || notification.message || '');

    return [
      '<button type="button" class="notifications-item' + (unread ? ' notifications-item--unread' : '') + '" data-notification-id="' + escapeHtml(notification.id) + '">',
      '  <span class="notifications-item__icon" style="background:' + style.bg + ';color:' + style.text + ';">' + getIcon(type) + '</span>',
      '  <span class="notifications-item__body">',
      '    <span class="notifications-item__header">',
      '      <span class="notifications-item__title">' + escapeHtml(title) + '</span>',
      unread ? '      <span class="notifications-item__dot"></span>' : '',
      '    </span>',
      message ? '    <span class="notifications-item__message">' + escapeHtml(message) + '</span>' : '',
      '    <span class="notifications-item__time" title="' + escapeHtml(formatDateTime(notification.created_at)) + '">' + escapeHtml(timeAgo(notification.created_at)) + '</span>',
      '  </span>',
      '</button>'
    ].join('');
  }

  function updateSummary() {
    if (els.count) {
      els.count.textContent = state.notifications.length + (state.notifications.length === 1 ? ' notification shown' : ' notifications shown');
    }
    if (els.unreadMeta) {
      els.unreadMeta.textContent = state.unreadCount + (state.unreadCount === 1 ? ' unread notification' : ' unread notifications');
    }
    if (els.markAll) {
      els.markAll.hidden = state.unreadCount === 0;
    }
  }

  function addTypeOption(value, label, description) {
    if (!value) return;
    var exists = state.typeOptions.some(function (item) { return item.value === value; });
    if (exists) return;
    state.typeOptions.push({
      value: value,
      label: label || value,
      description: description || value
    });
    state.typeOptions.sort(function (a, b) {
      if (!a.value) return -1;
      if (!b.value) return 1;
      return a.label.localeCompare(b.label);
    });
  }

  function renderTypeOptions() {
    if (!els.type) return;
    els.type.options = state.typeOptions;
    els.type.value = state.type;
  }

  function formatTypeLabel(type) {
    if (!type) return 'All types';
    if (window.LanaDisplay && typeof window.LanaDisplay.machineIdentifierToLabel === 'function') {
      return window.LanaDisplay.machineIdentifierToLabel(type);
    }
    return String(type);
  }

  function syncUrl() {
    if (!window.history || !window.URLSearchParams) return;
    var params = new URLSearchParams(window.location.search || '');
    if (state.filter === 'unread') {
      params.set('filter', 'unread');
    } else {
      params.delete('filter');
    }
    if (state.type) {
      params.set('type', state.type);
    } else {
      params.delete('type');
    }
    var query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? '?' + query : ''));
  }

  function emitCount() {
    document.dispatchEvent(new CustomEvent('lex-notification-count', {
      detail: { count: state.unreadCount },
      bubbles: true
    }));
  }

  function getIcon(type) {
    var key = ICONS[type] ? type : (type && type.indexOf('comment') === 0 ? 'comment' : 'info');
    if (type && type.indexOf('document') === 0) key = 'document';
    if (type === 'system_alert' || type === 'storage_warning') key = 'warning';
    if (type === 'processing_failed' || type === 'security') key = 'error';
    return '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">' + (ICONS[key] || ICONS.info) + '</svg>';
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function timeAgo(dateString) {
    // Canonical relative time with an absolute date past a week (direct
    // LanaTime call; the window.timeAgo global uses words style unbounded).
    return LanaTime.timeAgo(Lex.Utils.parseApiUtcDate(dateString), { maxDays: 7 }) || formatDate(dateString);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

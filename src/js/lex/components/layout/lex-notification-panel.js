/* Lex UI — Notification Panel Component
   Slide-in notification panel for the SPA shell. Slides in from the right
   with overlay backdrop. Shows notifications with filter tabs, infinite
   scroll, mark-as-read, and real-time badge sync.

   Usage:
     <lex-notification-panel></lex-notification-panel>

   Public API:
     panel.open()     — open the panel and load notifications
     panel.close()    — close the panel
     panel.isOpen     — boolean, whether panel is currently open
     panel.refresh()  — reload notifications

   Events:
     lex-notification-count  — fires when badge count changes { count }
*/

(function () {
  'use strict';

  var Lex = window.Lex;
  var LexElement = Lex.LexElement;
  var defineLex = Lex.defineLex;
  var Icons = Lex.Icons;

  // ---------------------------------------------------------------------------
  // Style injection (once per document)
  // ---------------------------------------------------------------------------

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var style = document.createElement('style');
    style.id = 'lex-notification-panel-styles';
    style.textContent = [
      'lex-notification-panel { display: contents; }',

      /* Overlay */
      '.notif-overlay {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: var(--lex-z-modal, 40);',
      '  display: flex;',
      '  justify-content: flex-end;',
      '}',

      '.notif-backdrop {',
      '  position: fixed;',
      '  inset: 0;',
      '  background: var(--lex-modal-overlay, rgba(13, 8, 7, 0.5));',
      '  opacity: 0;',
      '  transition: opacity var(--lex-transition-slide);',
      '}',

      '.notif-overlay--open .notif-backdrop {',
      '  opacity: 1;',
      '}',

      /* Panel */
      '.notif-panel {',
      '  position: relative;',
      '  height: 100vh;',
      '  height: 100dvh;',
      '  width: 420px;',
      '  max-width: 100%;',
      '  display: flex;',
      '  flex-direction: column;',
      '  background: var(--lex-bg-primary);',
      '  box-shadow: var(--lex-shadow-xl, 0 20px 60px rgba(0,0,0,0.15));',
      '  border-left: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));',
      '  overflow: hidden;',
      '  will-change: transform;',
      '  transform: translateX(100%);',
      '  transition: transform var(--lex-transition-slide);',
      '}',

      '.notif-overlay--open .notif-panel {',
      '  transform: translateX(0);',
      '}',

      /* Header */
      '.notif-header {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  padding: 16px 20px;',
      '  border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));',
      '  flex-shrink: 0;',
      '}',

      '.notif-header-title {',
      '  font-size: var(--lex-h5-size, 1.125rem);',
      '  font-weight: var(--lex-weight-semibold, 600);',
      '  color: var(--lex-text-primary);',
      '  margin: 0;',
      '  flex: 1;',
      '}',

      '.notif-header-actions {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '}',

      '.notif-view-all {',
      '  margin-right: 4px;',
      '}',

      /* Filter bar */
      '.notif-filter-bar {',
      '  padding: 12px 20px;',
      '  border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));',
      '  flex-shrink: 0;',
      '}',

      /* List */
      '.notif-list {',
      '  flex: 1;',
      '  overflow-y: auto;',
      '}',

      /* Loading more footer */
      '.notif-load-more {',
      '  flex-shrink: 0;',
      '  padding: 12px;',
      '  border-top: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));',
      '  text-align: center;',
      '}',

      /* Notification item */
      '.notif-item {',
      '  display: flex;',
      '  gap: 12px;',
      '  padding: 14px 20px;',
      '  border-bottom: 1px solid var(--lex-border-subtle, rgba(0,0,0,0.06));',
      '  cursor: pointer;',
      '  transition: background var(--lex-transition-fast, 150ms ease);',
      '}',

      '.notif-item:hover {',
      '  background: var(--lex-bg-secondary);',
      '}',

      '.notif-item--unread {',
      '  background: var(--lex-bg-accent-soft);',
      '}',

      '.notif-item--unread:hover {',
      '  background: var(--lex-bg-accent-muted);',
      '}',

      /* Icon circle */
      '.notif-icon {',
      '  flex-shrink: 0;',
      '  width: 40px;',
      '  height: 40px;',
      '  border-radius: var(--lex-radius-full, 9999px);',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '}',

      '.notif-icon svg {',
      '  width: 20px;',
      '  height: 20px;',
      '}',

      /* Content */
      '.notif-content {',
      '  flex: 1;',
      '  min-width: 0;',
      '}',

      '.notif-content-header {',
      '  display: flex;',
      '  align-items: flex-start;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '}',

      '.notif-title {',
      '  font-size: var(--lex-body-sm-size, 0.875rem);',
      '  font-weight: var(--lex-weight-medium, 500);',
      '  color: var(--lex-text-primary);',
      '  margin: 0;',
      '  line-height: 1.4;',
      '}',

      '.notif-item--unread .notif-title {',
      '  font-weight: var(--lex-weight-semibold, 600);',
      '}',

      '.notif-dot {',
      '  flex-shrink: 0;',
      '  width: 8px;',
      '  height: 8px;',
      '  border-radius: var(--lex-radius-full, 9999px);',
      '  background: var(--lex-bg-accent, #595246);',
      '  margin-top: 4px;',
      '}',

      '.notif-body {',
      '  font-size: var(--lex-body-sm-size, 0.875rem);',
      '  color: var(--lex-text-secondary);',
      '  margin-top: 2px;',
      '  line-height: 1.4;',
      '}',

      '.notif-time {',
      '  font-size: var(--lex-form-help-size, 11px);',
      '  color: var(--lex-text-tertiary);',
      '  margin-top: 4px;',
      '}',

      /* End of list */
      '.notif-end {',
      '  padding: 16px;',
      '  text-align: center;',
      '  font-size: var(--lex-form-help-size, 11px);',
      '  color: var(--lex-text-tertiary);',
      '}',

      /* Error state */
      '.notif-error {',
      '  display: flex;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  justify-content: center;',
      '  padding: 3rem 1.5rem;',
      '  text-align: center;',
      '}',

      '.notif-error svg {',
      '  width: 48px;',
      '  height: 48px;',
      '  color: var(--lex-status-danger-text);',
      '  margin-bottom: 12px;',
      '}',

      '.notif-error p {',
      '  color: var(--lex-text-secondary);',
      '  font-size: var(--lex-body-sm-size, 0.875rem);',
      '  margin: 0;',
      '}',

      /* No keyframes needed — open/close driven by .notif-overlay--open class */
      ''
    ].join('\n');

    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // SVG Icons by notification type
  // ---------------------------------------------------------------------------

  var ICON_SVGS = {
    success:        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>',
    info:           '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    warning:        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>',
    error:          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>',
    comment:        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>',
    comment_mention:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"/>',
    comment_reply:  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>',
    share:          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>',
    document_shared:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>',
    matter_shared:  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>',
    matter_assigned:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>',
    document:       '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>',
    document_processed:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    processing_failed:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    role_changed:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
    system_alert:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>',
    storage_warning:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>',
    security:       '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>',
    password_reset_request:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>',
    password_changed:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>',
    login_new_device:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>',
    heartbeat_report:'<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>'
  };

  // Map notification type → { bg: CSS token, text: CSS token }
  var TYPE_STYLES = {
    success:         { bg: 'var(--lex-status-success-bg)', text: 'var(--lex-status-success-text)' },
    document_processed: { bg: 'var(--lex-status-success-bg)', text: 'var(--lex-status-success-text)' },
    password_changed:{ bg: 'var(--lex-status-success-bg)', text: 'var(--lex-status-success-text)' },
    info:            { bg: 'var(--lex-status-info-bg)', text: 'var(--lex-status-info-text)' },
    document:        { bg: 'var(--lex-status-info-bg)', text: 'var(--lex-status-info-text)' },
    warning:         { bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    role_changed:    { bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    storage_warning: { bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    login_new_device:{ bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    password_reset_request: { bg: 'var(--lex-status-warning-bg)', text: 'var(--lex-status-warning-text)' },
    error:           { bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    processing_failed:{ bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    system_alert:    { bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    security:        { bg: 'var(--lex-status-danger-bg)', text: 'var(--lex-status-danger-text)' },
    comment:         { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    comment_mention: { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    comment_reply:   { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    share:           { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    document_shared: { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    matter_shared:   { bg: 'var(--lex-bg-accent-muted)', text: 'var(--lex-text-accent)' },
    matter_assigned: { bg: 'var(--lex-status-success-bg)', text: 'var(--lex-status-success-text)' },
    heartbeat_report:{ bg: 'var(--lex-status-info-bg)', text: 'var(--lex-status-info-text)' }
  };

  var DEFAULT_STYLE = { bg: 'var(--lex-bg-tertiary)', text: 'var(--lex-text-secondary)' };

  // Refresh SVG (inline, not from icon registry)
  var REFRESH_SVG = '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
  var CLOSE_SVG = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
  var ERROR_SVG = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

  // ---------------------------------------------------------------------------
  // Helper: escapeHtml
  // ---------------------------------------------------------------------------

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Helper: timeAgo
  // ---------------------------------------------------------------------------

  function timeAgo(dateString) {
    var date = window.Lex && window.Lex.Utils
      ? window.Lex.Utils.parseApiUtcDate(dateString)
      : new Date(dateString);
    var rel = window.LanaTime ? LanaTime.timeAgo(date, { maxDays: 7 }) : '';
    if (rel) return rel;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '';
  }

  // ---------------------------------------------------------------------------
  // Helper: get icon SVG for a notification type
  // ---------------------------------------------------------------------------

  function getIconSvg(type) {
    var pathData = ICON_SVGS[type] || ICON_SVGS.info;
    return '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">' + pathData + '</svg>';
  }

  function getTypeStyle(type) {
    return TYPE_STYLES[type] || DEFAULT_STYLE;
  }

  // ---------------------------------------------------------------------------
  // LexNotificationPanel
  // ---------------------------------------------------------------------------

  class LexNotificationPanel extends LexElement {

    static get properties() {
      return {};
    }

    constructor() {
      super();
      this._isOpen = false;
      this._notifications = [];
      this._unreadCount = 0;
      this._offset = 0;
      this._limit = 20;
      this._hasMore = false;
      this._filter = 'all';
      this._isLoading = false;
      this._loadError = false;
      this._escHandler = null;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    get isOpen() {
      return this._isOpen;
    }

    open() {
      if (this._isOpen) return;

      // Ensure user is authenticated
      if (typeof api !== 'undefined' && api && typeof api.isAuthenticated === 'function' && !api.isAuthenticated()) {
        console.warn('[NotificationPanel] User not authenticated');
        return;
      }

      this._isOpen = true;
      this._renderPanel();

      // Trigger transition on next frame (DOM needs to be in place first)
      var overlay = this._overlay;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (overlay) overlay.classList.add('notif-overlay--open');
        });
      });

      this._loadNotifications(true);
    }

    close() {
      if (!this._isOpen) return;
      this._isOpen = false;
      this._animateClose();
    }

    refresh() {
      if (!this._isOpen) return;
      this._loadNotifications(true);
    }

    // -----------------------------------------------------------------------
    // Render — returns null, we manage the DOM imperatively
    // -----------------------------------------------------------------------

    render() {
      injectStyles();
      return null;
    }

    connected() {
      // Nothing to do on connect — panel opens on demand
    }

    disconnected() {
      this._teardownPanel();
    }

    // -----------------------------------------------------------------------
    // Internal — build/teardown the panel DOM
    // -----------------------------------------------------------------------

    _renderPanel() {
      // Lock body scroll
      document.body.style.overflow = 'hidden';

      // Build overlay
      var overlay = document.createElement('div');
      overlay.className = 'notif-overlay';

      var backdrop = document.createElement('div');
      backdrop.className = 'notif-backdrop';
      backdrop.dataset.action = 'backdrop';
      overlay.appendChild(backdrop);

      // Build panel
      var panel = document.createElement('div');
      panel.className = 'notif-panel';

      // Header
      panel.innerHTML = [
        '<div class="notif-header">',
        '  <h2 class="notif-header-title">Notifications</h2>',
        '  <div class="notif-header-actions">',
        '    <lex-btn class="notif-view-all" variant="ghost" size="sm" data-action="view-all">View all</lex-btn>',
        '    <lex-btn variant="ghost" size="sm" data-action="mark-all" hidden>Mark all read</lex-btn>',
        '    <lex-btn variant="ghost" size="sm" icon="true" data-action="refresh" title="Refresh">' + REFRESH_SVG + '</lex-btn>',
        '    <lex-btn variant="ghost" size="sm" icon="true" data-action="close" title="Close">' + CLOSE_SVG + '</lex-btn>',
        '  </div>',
        '</div>',
        '<div class="notif-filter-bar">',
        '  <lex-segmented name="notif-filter" value="all" size="sm"',
        '    options=\'[{"value":"all","label":"All"},{"value":"unread","label":"Unread"}]\'>',
        '  </lex-segmented>',
        '</div>',
        '<div class="notif-list" data-region="list"></div>',
        '<div class="notif-load-more" data-region="load-more" hidden>',
        '  <lex-spinner size="sm"></lex-spinner>',
        '</div>'
      ].join('\n');

      overlay.appendChild(panel);
      this.appendChild(overlay);

      // Cache references
      this._overlay = overlay;
      this._panel = panel;
      this._listEl = panel.querySelector('[data-region="list"]');
      this._loadMoreEl = panel.querySelector('[data-region="load-more"]');
      this._markAllBtn = panel.querySelector('[data-action="mark-all"]');

      // Bind events
      this._bindPanelEvents();
    }

    _animateClose() {
      if (!this._overlay) {
        this._teardownPanel();
        return;
      }

      var self = this;
      var overlay = this._overlay;
      var panel = this._panel;

      // Remove the open class to trigger the reverse transition
      overlay.classList.remove('notif-overlay--open');

      // Wait for the panel slide-out transition to finish, then remove DOM
      function onTransitionEnd(e) {
        // Only act on the panel's transform transition (not child transitions)
        if (e.target !== panel || e.propertyName !== 'transform') return;
        panel.removeEventListener('transitionend', onTransitionEnd);
        self._teardownPanel();
      }

      panel.addEventListener('transitionend', onTransitionEnd);

      // Safety fallback: remove after 750ms even if transitionend doesn't fire
      setTimeout(function () {
        panel.removeEventListener('transitionend', onTransitionEnd);
        self._teardownPanel();
      }, 750);
    }

    _teardownPanel() {
      document.body.style.overflow = '';

      if (this._escHandler) {
        document.removeEventListener('keydown', this._escHandler);
        this._escHandler = null;
      }

      if (this._overlay && this._overlay.parentNode) {
        this._overlay.remove();
      }

      this._overlay = null;
      this._panel = null;
      this._listEl = null;
      this._loadMoreEl = null;
      this._markAllBtn = null;
    }

    _bindPanelEvents() {
      var self = this;

      // Backdrop click → close
      var backdrop = this._overlay.querySelector('[data-action="backdrop"]');
      if (backdrop) {
        backdrop.addEventListener('click', function () { self.close(); });
      }

      // Close button
      var closeBtn = this._panel.querySelector('[data-action="close"]');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () { self.close(); });
      }

      // Refresh button
      var refreshBtn = this._panel.querySelector('[data-action="refresh"]');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
          refreshBtn.loading = true;
          self._loadNotifications(true).finally(function () {
            setTimeout(function () { refreshBtn.loading = false; }, 300);
          });
        });
      }

      var viewAllBtn = this._panel.querySelector('[data-action="view-all"]');
      if (viewAllBtn) {
        viewAllBtn.addEventListener('click', function () {
          self.close();
          if (window.Lex && window.Lex.Nav) {
            window.Lex.Nav.go('notifications.html');
          } else {
            window.location.href = 'notifications.html';
          }
        });
      }

      // Mark all read
      if (this._markAllBtn) {
        this._markAllBtn.addEventListener('click', function () {
          self._markAllAsRead();
        });
      }

      // Filter tabs
      var segmented = this._panel.querySelector('lex-segmented');
      if (segmented) {
        segmented.addEventListener('lex-change', function (e) {
          var newFilter = e.detail && e.detail.value;
          if (newFilter && newFilter !== self._filter) {
            self._filter = newFilter;
            self._loadNotifications(true);
          }
        });
      }

      // Infinite scroll
      if (this._listEl) {
        this._listEl.addEventListener('scroll', function () {
          if (self._isLoading || !self._hasMore) return;
          var el = self._listEl;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
            self._loadNotifications(false);
          }
        });
      }

      // ESC key
      this._escHandler = function (e) {
        if (e.key === 'Escape' && self._isOpen) {
          self.close();
        }
      };
      document.addEventListener('keydown', this._escHandler);
    }

    // -----------------------------------------------------------------------
    // Internal — load notifications from API
    // -----------------------------------------------------------------------

    _loadNotifications(reset) {
      if (this._isLoading) return Promise.resolve();

      var self = this;
      this._isLoading = true;
      this._loadError = false;

      if (reset) {
        this._offset = 0;
        this._notifications = [];
        this._hasMore = true;
        this._renderLoading();
      } else {
        if (this._loadMoreEl) this._loadMoreEl.hidden = false;
      }

      var isUnread = this._filter === 'unread';

      return api.getNotifications(isUnread, this._limit, this._offset)
        .then(function (result) {
          var items = result.notifications || [];
          self._unreadCount = result.unread_count || 0;

          // Update topbar badge
          self._emitCount(self._unreadCount);

          // Show/hide mark all read
          if (self._markAllBtn) {
            self._markAllBtn.hidden = self._unreadCount === 0;
          }

          // Check for more
          self._hasMore = items.length >= self._limit;

          if (reset) {
            self._notifications = items;
          } else {
            // Deduplicate
            var existingIds = {};
            for (var i = 0; i < self._notifications.length; i++) {
              existingIds[self._notifications[i].id] = true;
            }
            var newItems = [];
            for (var j = 0; j < items.length; j++) {
              if (!existingIds[items[j].id]) {
                newItems.push(items[j]);
              }
            }
            self._notifications = self._notifications.concat(newItems);
            if (newItems.length === 0) self._hasMore = false;
          }

          self._offset = self._notifications.length;
          self._renderList();
        })
        .catch(function (err) {
          console.error('[NotificationPanel] Failed to load:', err);
          self._loadError = true;
          if (reset) self._renderError();
        })
        .finally(function () {
          self._isLoading = false;
          if (self._loadMoreEl) self._loadMoreEl.hidden = true;
        });
    }

    // -----------------------------------------------------------------------
    // Internal — mark as read
    // -----------------------------------------------------------------------

    _markAsRead(notificationId) {
      var self = this;

      return api.markNotificationRead(notificationId)
        .then(function () {
          var notification = null;
          for (var i = 0; i < self._notifications.length; i++) {
            if (self._notifications[i].id === notificationId) {
              notification = self._notifications[i];
              break;
            }
          }

          if (notification) {
            var wasUnread = !notification.read && !notification.is_read;
            notification.read = true;
            notification.is_read = true;

            if (wasUnread) {
              self._unreadCount = Math.max(0, self._unreadCount - 1);
              self._emitCount(self._unreadCount);
            }

            if (self._filter === 'unread') {
              self._notifications = self._notifications.filter(function (n) {
                return n.id !== notificationId;
              });
              self._renderList();
            } else {
              // Update the item in-place
              var item = self._listEl.querySelector('[data-notif-id="' + notificationId + '"]');
              if (item) {
                item.classList.remove('notif-item--unread');
                var dot = item.querySelector('.notif-dot');
                if (dot) dot.remove();
                var title = item.querySelector('.notif-title');
                if (title) title.style.fontWeight = 'var(--lex-weight-medium, 500)';
              }
            }

            if (self._markAllBtn) {
              self._markAllBtn.hidden = self._unreadCount === 0;
            }
          }
        })
        .catch(function (err) {
          console.error('[NotificationPanel] Failed to mark as read:', err);
        });
    }

    _markAllAsRead() {
      var self = this;

      api.markAllNotificationsRead()
        .then(function () {
          self._unreadCount = 0;
          self._emitCount(0);

          for (var i = 0; i < self._notifications.length; i++) {
            self._notifications[i].read = true;
            self._notifications[i].is_read = true;
          }

          if (self._markAllBtn) self._markAllBtn.hidden = true;
          self._renderList();
        })
        .catch(function (err) {
          console.error('[NotificationPanel] Failed to mark all as read:', err);
        });
    }

    // -----------------------------------------------------------------------
    // Internal — emit badge count
    // -----------------------------------------------------------------------

    _emitCount(count) {
      this.emit('lex-notification-count', { count: count });
    }

    // -----------------------------------------------------------------------
    // Internal — render helpers
    // -----------------------------------------------------------------------

    _renderLoading() {
      if (!this._listEl) return;
      this._listEl.innerHTML = '<div style="padding:3rem 1.5rem;text-align:center;"><lex-spinner size="md" label="Loading notifications..."></lex-spinner></div>';
    }

    _renderError() {
      if (!this._listEl) return;
      this._listEl.innerHTML = [
        '<div class="notif-error">',
        '  ' + ERROR_SVG,
        '  <p>Failed to load notifications</p>',
        '  <div style="margin-top:12px;">',
        '    <lex-btn variant="ghost" size="sm" data-action="retry">Try again</lex-btn>',
        '  </div>',
        '</div>'
      ].join('');

      var self = this;
      var retryBtn = this._listEl.querySelector('[data-action="retry"]');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          self._loadNotifications(true);
        });
      }
    }

    _renderList() {
      if (!this._listEl) return;

      if (this._notifications.length === 0) {
        var desc = this._filter === 'unread'
          ? "You're all caught up!"
          : 'Check back later for updates';

        this._listEl.innerHTML = '<lex-empty icon="inbox" message="No notifications" description="' + escapeHtml(desc) + '"></lex-empty>';
        return;
      }

      var html = '';
      var self = this;

      for (var i = 0; i < this._notifications.length; i++) {
        var n = this._notifications[i];
        var isUnread = !n.read && !n.is_read;
        var style = getTypeStyle(n.type);
        var iconSvg = getIconSvg(n.type);
        var body = n.body || n.message || '';

        html += '<div class="notif-item' + (isUnread ? ' notif-item--unread' : '') + '" data-notif-id="' + escapeHtml(n.id) + '">';
        html += '  <div class="notif-icon" style="background:' + style.bg + ';color:' + style.text + ';">' + iconSvg + '</div>';
        html += '  <div class="notif-content">';
        html += '    <div class="notif-content-header">';
        html += '      <p class="notif-title">' + escapeHtml(n.title) + '</p>';
        if (isUnread) {
          html += '      <span class="notif-dot"></span>';
        }
        html += '    </div>';
        if (body) {
          html += '    <p class="notif-body">' + escapeHtml(body) + '</p>';
        }
        html += '    <p class="notif-time">' + timeAgo(n.created_at) + '</p>';
        html += '  </div>';
        html += '</div>';
      }

      if (!this._hasMore && this._notifications.length > 0) {
        html += '<div class="notif-end">No more notifications</div>';
      }

      this._listEl.innerHTML = html;

      // Bind click handlers: mark as read + navigate to the notification's
      // subject when it has a resolvable location
      var items = this._listEl.querySelectorAll('.notif-item');
      for (var j = 0; j < items.length; j++) {
        (function (item) {
          item.addEventListener('click', function () {
            var id = item.dataset.notifId;
            if (!id) return;
            var n = null;
            for (var k = 0; k < self._notifications.length; k++) {
              if (String(self._notifications[k].id) === String(id)) {
                n = self._notifications[k];
                break;
              }
            }
            self._markAsRead(id).finally(function () {
              if (n) self._openNotification(n);
            });
          });
        })(items[j]);
      }
    }

    /**
     * Map a notification to a client destination. Producers write action_url
     * in three shapes: a real client page ("dashboard.html",
     * "/agentic-task-detail.html?id=.."), an API-style resource path
     * ("/matters/{id}", "/matters/{id}/documents/{docId}", "/alerts",
     * "/tasks"), or nothing (fall back to resource_type/resource_id).
     * Returns an href string or null when there is nowhere to go.
     */
    _resolveNotificationTarget(n) {
      var url = n.action_url || '';
      var rtype = n.resource_type || '';
      var rid = n.resource_id || '';

      if (/^\s*javascript:/i.test(url)) return null;

      // Already a client page URL
      if (url.indexOf('.html') !== -1) {
        return url.charAt(0) === '/' ? url.substring(1) : url;
      }

      // "/matters/{matterId}[/documents/{docId}]"
      if (url.indexOf('/matters/') === 0) {
        var parts = url.substring(1).split('/');
        var matterId = parts[1] || '';
        if (!matterId) return null;
        if (parts[2] === 'documents' && parts[3]) {
          return 'workspace-details.html?id=' + encodeURIComponent(matterId) +
            '&tab=documents&open_file=' + encodeURIComponent(parts[3]);
        }
        if (rtype === 'task' && rid) {
          return 'workspace-details.html?id=' + encodeURIComponent(matterId) +
            '&task=' + encodeURIComponent(rid);
        }
        return 'workspace-details.html?id=' + encodeURIComponent(matterId);
      }

      if (url === '/alerts') return 'alerts.html';
      if (url === '/tasks') return 'my-tasks.html';

      // No usable action_url: fall back to the resource reference
      if (rtype === 'task' && rid) return 'my-tasks.html?task=' + encodeURIComponent(rid);
      if (rtype === 'alert_instance') return 'alerts.html';
      return null;
    }

    _openNotification(n) {
      var href = this._resolveNotificationTarget(n);
      if (!href) return;
      this.close();
      if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
        window.Lex.Nav.go(href);
      } else {
        window.location.href = href;
      }
    }
  }

  // =========================================================================
  // Register
  // =========================================================================

  defineLex('lex-notification-panel', LexNotificationPanel);

})();

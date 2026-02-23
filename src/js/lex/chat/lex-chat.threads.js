/* ==========================================================================
   Lex UI — Chat Threads
   Reusable thread list component for any page with conversation chat.
   Pairs with lex-chat to enable thread switching and creation.

   Usage:
     <lex-chat-threads
       page-scope="reporting"
       context-type="insights_chat"
     ></lex-chat-threads>

   Events emitted:
     lex-thread-select  { thread }   — User clicked a thread
     lex-thread-create  { threadType } — User clicked "New Thread"
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement } = global.Lex;
  if (!LexElement) { console.error('[lex-chat-threads] LexElement not loaded'); return; }

  class LexChatThreads extends LexElement {

    static get properties() {
      return {
        pageScope:   { type: String, default: '', attribute: 'page-scope' },
        contextType: { type: String, default: 'insights_chat', attribute: 'context-type' },
        matterId:    { type: String, default: null, attribute: 'matter-id' },
        activeThread:{ type: String, default: null, attribute: 'active-thread' },
        collapsed:   { type: Boolean, default: false, reflect: true }
      };
    }

    constructor() {
      super();
      this._threads = [];
      this._loading = false;
    }

    connected() {
      if (this.pageScope) {
        this.loadThreads();
      }
    }

    render() {
      var style = '<style>'
        + '.lct-root{display:flex;flex-direction:column;border-bottom:1px solid var(--lex-border-subtle, #e5e7eb);}'
        + '.lct-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;user-select:none;}'
        + '.lct-header:hover{background:var(--lex-bg-hover, #f9fafb);}'
        + '.lct-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--lex-text-secondary, #6b7280);}'
        + '.lct-chevron{width:14px;height:14px;color:var(--lex-text-tertiary, #9ca3af);transition:transform 0.15s ease;}'
        + '.lct-chevron.open{transform:rotate(180deg);}'
        + '.lct-actions{display:flex;align-items:center;gap:6px;}'
        + '.lct-new-btn{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:10.5px;font-weight:600;'
        + 'color:var(--lex-text-accent, #4f46e5);background:var(--lex-bg-accent-soft, #eef2ff);border:none;border-radius:4px;'
        + 'cursor:pointer;transition:background 0.15s;}'
        + '.lct-new-btn:hover{background:var(--lex-bg-accent-hover, #e0e7ff);}'
        + '.lct-list{max-height:200px;overflow-y:auto;padding:4px 8px 8px;}'
        + '.lct-list.collapsed{display:none;}'
        + '.lct-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;cursor:pointer;'
        + 'transition:background 0.12s;font-size:12.5px;color:var(--lex-text-primary, #111827);}'
        + '.lct-item:hover{background:var(--lex-bg-hover, #f3f4f6);}'
        + '.lct-item.active{background:var(--lex-bg-accent-soft, #eef2ff);color:var(--lex-text-accent, #4f46e5);}'
        + '.lct-item-icon{flex-shrink:0;width:14px;height:14px;color:var(--lex-text-tertiary, #9ca3af);}'
        + '.lct-item.active .lct-item-icon{color:var(--lex-text-accent, #4f46e5);}'
        + '.lct-item-title{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
        + '.lct-item-time{font-size:10px;color:var(--lex-text-tertiary, #9ca3af);white-space:nowrap;}'
        + '.lct-item.pinned{font-weight:600;}'
        + '.lct-empty{padding:12px 14px;font-size:11.5px;color:var(--lex-text-tertiary, #9ca3af);text-align:center;}'
        + '.lct-loading{padding:12px 14px;font-size:11.5px;color:var(--lex-text-tertiary, #9ca3af);text-align:center;}'
        + '</style>';

      var chevronSvg = '<svg class="lct-chevron' + (this.collapsed ? '' : ' open') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

      var headerHtml = '<div class="lct-header" data-toggle>'
        + '<span class="lct-title">Threads</span>'
        + '<div class="lct-actions">'
        + '<button class="lct-new-btn" data-new-thread>+ New</button>'
        + chevronSvg
        + '</div>'
        + '</div>';

      var listHtml = '';
      if (this._loading) {
        listHtml = '<div class="lct-loading">Loading threads...</div>';
      } else if (this._threads.length === 0) {
        listHtml = '<div class="lct-empty">No threads yet</div>';
      } else {
        listHtml = this._threads.map(function (t) {
          var isActive = this.activeThread === t.id;
          var isPinned = t.thread_type === 'page_general';
          var cls = 'lct-item' + (isActive ? ' active' : '') + (isPinned ? ' pinned' : '');
          var icon = this._getThreadIcon(t.thread_type);
          var title = this.escapeHtml(t.title || this._getDefaultTitle(t.thread_type));
          var time = this._relativeTime(t.last_activity || t.created_at);
          return '<div class="' + cls + '" data-thread-id="' + t.id + '">'
            + '<span class="lct-item-icon">' + icon + '</span>'
            + '<span class="lct-item-title">' + title + '</span>'
            + '<span class="lct-item-time">' + time + '</span>'
            + '</div>';
        }.bind(this)).join('');
      }

      var listWrapper = '<div class="lct-list' + (this.collapsed ? ' collapsed' : '') + '">' + listHtml + '</div>';

      return style + '<div class="lct-root">' + headerHtml + listWrapper + '</div>';
    }

    updated() {
      // Toggle collapse
      this.delegate('click', '[data-toggle]', function (e) {
        // Don't toggle if clicking the new-thread button
        if (e.target.closest('[data-new-thread]')) return;
        this.collapsed = !this.collapsed;
      });

      // New thread button
      this.delegate('click', '[data-new-thread]', function (e) {
        e.stopPropagation();
        this.emit('lex-thread-create', { threadType: 'ad_hoc' });
      });

      // Thread item click
      this.delegate('click', '[data-thread-id]', function (e, target) {
        var threadId = target.getAttribute('data-thread-id');
        var thread = null;
        for (var i = 0; i < this._threads.length; i++) {
          if (this._threads[i].id === threadId) {
            thread = this._threads[i];
            break;
          }
        }
        if (thread) {
          this.activeThread = thread.id;
          this.emit('lex-thread-select', { thread: thread });
        }
      });
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Load threads from the API.
     */
    async loadThreads() {
      if (!this.pageScope || typeof api === 'undefined') return;

      this._loading = true;
      this._scheduleUpdate();

      try {
        var params = 'page_scope=' + encodeURIComponent(this.pageScope) + '&limit=50&sort_by=last_activity&sort_order=desc';
        if (this.matterId) params += '&matter_id=' + encodeURIComponent(this.matterId);

        var result = await api.get('/api/v1/conversation-threads?' + params);
        this._threads = result.data || result.threads || [];
      } catch (err) {
        console.warn('[lex-chat-threads] Failed to load threads:', err);
        this._threads = [];
      } finally {
        this._loading = false;
        this._scheduleUpdate();
      }
    }

    /**
     * Refresh thread list from API.
     */
    async refresh() {
      await this.loadThreads();
    }

    /**
     * Set the active thread by ID and re-render.
     */
    setActiveThread(threadId) {
      this.activeThread = threadId;
    }

    /**
     * Add a thread to the internal list without a full API reload.
     */
    addThread(thread) {
      if (!thread) return;
      // Remove if already exists (dedupe)
      this._threads = this._threads.filter(function (t) { return t.id !== thread.id; });
      // Prepend (most recent first)
      this._threads.unshift(thread);
      this._scheduleUpdate();
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    _getThreadIcon(threadType) {
      if (threadType === 'page_general') {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
      }
      if (threadType === 'report_run') {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
      }
      // ad_hoc
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
    }

    _getDefaultTitle(threadType) {
      if (threadType === 'page_general') return 'General Insights';
      if (threadType === 'report_run') return 'Report Thread';
      return 'New Thread';
    }

    _relativeTime(dateStr) {
      if (!dateStr) return '';
      var now = Date.now();
      var then = new Date(dateStr).getTime();
      var diffMs = now - then;
      var diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'now';
      if (diffMin < 60) return diffMin + 'm';
      var diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return diffHr + 'h';
      var diffDay = Math.floor(diffHr / 24);
      if (diffDay < 30) return diffDay + 'd';
      var diffMonth = Math.floor(diffDay / 30);
      return diffMonth + 'mo';
    }
  }

  customElements.define('lex-chat-threads', LexChatThreads);

})(typeof window !== 'undefined' ? window : this);

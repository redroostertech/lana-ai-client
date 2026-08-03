/* ==========================================================================
   Lex UI — Chat Threads
   Reusable thread list component for any page with conversation chat.
   Pairs with lex-chat to enable thread switching and creation.

   Usage:
     <lex-chat-threads
       page-scope="dashboard"
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

  function listConversations(opts) {
    if (typeof api !== 'undefined' && typeof api.getConversations === 'function') {
      return api.getConversations(opts || {});
    }
    return Promise.reject(new Error('canonical conversation API not available'));
  }

  class LexChatThreads extends LexElement {

    static get properties() {
      return {
        pageScope:   { type: String, default: '', attribute: 'page-scope' },
        contextType: { type: String, default: 'insights_chat', attribute: 'context-type' },
        matterId:    { type: String, default: null, attribute: 'matter-id' },
        activeThread:{ type: String, default: null, attribute: 'active-thread' },
        collapsed:   { type: Boolean, default: false, reflect: true },
        heading:     { type: String, default: 'Threads' },
        // Recents mode: list the user's recent chat sessions app-wide
        // (same data as the sidebar Recents) instead of page-scoped threads.
        recents:     { type: Boolean, default: false }
      };
    }

    constructor() {
      super();
      this._threads = [];
      this._groups = null;
      this._loading = false;
      this._userToggledCollapsed = false;
    }

    connected() {
      if (this.pageScope || this.recents) {
        this.loadThreads();
      }
      // Recents mode: stay in sync with the shared conversation actions
      // modal (rename / pin / archive / delete).
      if (this.recents && !this._convEventsBound) {
        this._convEventsBound = true;
        this._onConvChanged = this.refresh.bind(this);
        var evts = ['conversation:renamed', 'conversation:pin-changed', 'conversation:archived', 'conversation:deleted'];
        for (var i = 0; i < evts.length; i++) window.addEventListener(evts[i], this._onConvChanged);
      }
    }

    disconnected() {
      if (this._convEventsBound && this._onConvChanged) {
        var evts = ['conversation:renamed', 'conversation:pin-changed', 'conversation:archived', 'conversation:deleted'];
        for (var i = 0; i < evts.length; i++) window.removeEventListener(evts[i], this._onConvChanged);
        this._convEventsBound = false;
      }
    }

    render() {
      var style = '<style>'
        + '.lct-root{display:flex;flex-direction:column;border-bottom:1px solid var(--lex-border-subtle, #e5e7eb);}'
        + '.lct-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;user-select:none;}'
        + '.lct-header:hover{background:var(--lex-bg-hover, #f9fafb);}'
        + '.lct-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--lex-text-secondary, #6b7280);}'
        /* Chevron matches the dynamic menu sections: points right when
           closed, rotates down when open. */
        + '.lct-chevron{width:14px;height:14px;color:var(--lex-text-tertiary, #9ca3af);'
        + 'transform:rotate(-90deg);transition:transform var(--lex-transition-fast, 0.15s ease);}'
        + '.lct-chevron.open{transform:rotate(0deg);}'
        + '.lct-actions{display:flex;align-items:center;gap:6px;}'
        + '.lct-new-btn{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:10.5px;font-weight:600;'
        + 'color:var(--lex-text-accent, #4f46e5);background:var(--lex-bg-accent-soft, #eef2ff);border:none;border-radius:4px;'
        + 'cursor:pointer;transition:background 0.15s;}'
        + '.lct-new-btn:hover{background:var(--lex-bg-accent-hover, #e0e7ff);}'
        /* Soft close (house drawer animation): height + fade, no jump. */
        + '.lct-list{max-height:200px;overflow-y:auto;padding:4px 8px 8px;opacity:1;'
        + 'transition:max-height var(--lex-transition-slide, 0.3s ease),opacity 0.25s ease,padding 0.25s ease;}'
        + '.lct-list.collapsed{max-height:0;opacity:0;padding-top:0;padding-bottom:0;overflow:hidden;}'
        + '.lct-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;cursor:pointer;'
        + 'transition:background 0.12s;font-size:12.5px;color:var(--lex-text-primary, #111827);position:relative;}'
        + '.lct-item:hover{background:var(--lex-bg-hover, #f3f4f6);}'
        + '.lct-item.active{background:var(--lex-bg-accent-soft, #eef2ff);color:var(--lex-text-accent, #4f46e5);}'
        + '.lct-item-icon{flex-shrink:0;width:14px;height:14px;color:var(--lex-text-tertiary, #9ca3af);}'
        + '.lct-item.active .lct-item-icon{color:var(--lex-text-accent, #4f46e5);}'
        + '.lct-item-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}'
        + '.lct-item-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
        + '.lct-item-sub{font-size:10.5px;color:var(--lex-text-tertiary, #9ca3af);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
        + '.lct-item-time{font-size:10px;color:var(--lex-text-tertiary, #9ca3af);white-space:nowrap;align-self:flex-start;margin-top:2px;}'
        + '.lct-item.pinned{font-weight:600;}'
        + '.lct-delete-btn{display:none;flex-shrink:0;width:20px;height:20px;padding:2px;border:none;background:none;'
        + 'color:var(--lex-text-tertiary, #9ca3af);cursor:pointer;border-radius:4px;transition:color 0.12s,background 0.12s;}'
        + '.lct-item:hover .lct-delete-btn{display:inline-flex;align-items:center;justify-content:center;}'
        + '.lct-delete-btn:hover{color:#ef4444;background:rgba(239,68,68,0.1);}'
        /* Hover-revealed kebab on recents items — more options, like the
           old dynamic-menu Recents. */
        + '.lct-more-btn{display:none;flex-shrink:0;width:20px;height:20px;padding:2px;border:none;background:none;'
        + 'color:var(--lex-text-tertiary, #9ca3af);cursor:pointer;border-radius:4px;transition:color 0.12s,background 0.12s;}'
        + '.lct-item:hover .lct-more-btn{display:inline-flex;align-items:center;justify-content:center;}'
        + '.lct-more-btn:hover{color:var(--lex-text-primary, #111827);background:var(--lex-bg-hover, #e5e7eb);}'
        + '.lct-empty{padding:12px 14px;font-size:11.5px;color:var(--lex-text-tertiary, #9ca3af);text-align:center;}'
        + '.lct-group-label{padding:8px 10px 3px;font-size:10px;font-weight:700;text-transform:uppercase;'
        + 'letter-spacing:0.5px;color:var(--lex-text-tertiary, #9ca3af);}'
        /* Recents mode: boxed + (new chat) button in the dropdown header,
           header sized up to fit it. */
        + '.lct-header.recents{min-height:44px;}'
        + '.lct-newchat-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;'
        + 'color:var(--lex-text-secondary, #6b7280);background:transparent;'
        + 'border:1px solid var(--lex-border-default, #e5e7eb);border-radius:6px;cursor:pointer;'
        + 'transition:background 0.15s,border-color 0.15s,color 0.15s;}'
        + '.lct-newchat-btn:hover{background:var(--lex-bg-hover, #f3f4f6);color:var(--lex-text-primary, #111827);}'
        + '.lct-loading{padding:12px 14px;font-size:11.5px;color:var(--lex-text-tertiary, #9ca3af);text-align:center;}'
        + '</style>';

      var chevronSvg = '<svg class="lct-chevron' + (this.collapsed ? '' : ' open') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

      var plusSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
      var newBtn = this.recents
        ? '<button class="lct-newchat-btn" data-new-thread title="New chat" aria-label="New chat">' + plusSvg + '</button>'
        : '<button class="lct-new-btn" data-new-thread>+ New</button>';
      var headerHtml = '<div class="lct-header' + (this.recents ? ' recents' : '') + '" data-toggle>'
        + '<span class="lct-title">' + this.escapeHtml(this.heading || 'Threads') + '</span>'
        + '<div class="lct-actions">'
        + newBtn
        + chevronSvg
        + '</div>'
        + '</div>';

      var renderItem = function (t) {
          var isActive = this.activeThread === t.id;
          var isPinned = this.recents ? t.is_pinned === true : t.thread_type === 'page_general';
          var cls = 'lct-item' + (isActive ? ' active' : '') + (isPinned ? ' pinned' : '');
          var icon = this._getThreadIcon(t.thread_type);
          var title = this.escapeHtml(t.title || this._getDefaultTitle(t.thread_type));
          var subtitle = t.subtitle ? '<span class="lct-item-sub">' + this.escapeHtml(t.subtitle) + '</span>' : '';
          var time = this._relativeTime(t.last_activity || t.created_at);
          var trashSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>';
          var kebabSvg = '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
          var canShowActions = this.recents && typeof window.openConversationActionsModal === 'function';
          var deleteBtn = this.recents
            ? (canShowActions
              ? '<button class="lct-more-btn" data-more-thread="' + t.id + '" title="More options" aria-label="More options">' + kebabSvg + '</button>'
              : '')
            : '<button class="lct-delete-btn" data-delete-thread="' + t.id + '" title="Delete thread">' + trashSvg + '</button>';
          return '<div class="' + cls + '" data-thread-id="' + t.id + '">'
            + '<span class="lct-item-icon">' + icon + '</span>'
            + '<span class="lct-item-text"><span class="lct-item-title">' + title + '</span>' + subtitle + '</span>'
            + '<span class="lct-item-time">' + time + '</span>'
            + deleteBtn
            + '</div>';
      }.bind(this);

      var listHtml = '';
      if (this._loading) {
        listHtml = '<div class="lct-loading">Loading...</div>';
      } else if (this._threads.length === 0) {
        listHtml = '<div class="lct-empty">' + (this.recents ? 'No recent chats' : 'No threads yet') + '</div>';
      } else if (this._groups && this._groups.length > 0) {
        // Grouped recents: workspace-scoped conversations first, then the
        // app-wide list — one dropdown, organized by scope.
        listHtml = this._groups.map(function (g) {
          var label = g.label ? '<div class="lct-group-label">' + this.escapeHtml(g.label) + '</div>' : '';
          return label + g.items.map(renderItem).join('');
        }.bind(this)).join('');
      } else {
        listHtml = this._threads.map(renderItem).join('');
      }

      var listWrapper = '<div class="lct-list' + (this.collapsed ? ' collapsed' : '') + '">' + listHtml + '</div>';

      return style + '<div class="lct-root">' + headerHtml + listWrapper + '</div>';
    }

    updated() {
      // Toggle collapse. Class changes are applied to the live DOM instead
      // of going through a re-render: a rebuilt list can't animate, and the
      // soft-close transition (max-height + fade) needs the same nodes.
      this.delegate('click', '[data-toggle]', function (e) {
        // Don't toggle if clicking the new-thread button
        if (e.target.closest('[data-new-thread]')) return;
        this._userToggledCollapsed = true;
        var next = !this.collapsed;
        this._props.collapsed = next;
        this._reflectToAttribute('collapsed', next);
        var list = this.querySelector('.lct-list');
        var chevron = this.querySelector('.lct-chevron');
        if (list) list.classList.toggle('collapsed', next);
        if (chevron) chevron.classList.toggle('open', !next);
      });

      // New thread button
      this.delegate('click', '[data-new-thread]', function (e) {
        e.stopPropagation();
        this.emit('lex-thread-create', { threadType: 'ad_hoc' });
      });

      // Delete thread button
      this.delegate('click', '[data-delete-thread]', function (e, target) {
        e.stopPropagation();
        var threadId = target.getAttribute('data-delete-thread');
        this._deleteThread(threadId);
      });

      // Kebab (recents): open the shared conversation actions modal —
      // rename / pin / delete, same surface the dynamic menu used.
      this.delegate('click', '[data-more-thread]', function (e, target) {
        e.stopPropagation();
        var id = target.getAttribute('data-more-thread');
        var t = null;
        for (var i = 0; i < this._threads.length; i++) {
          if (this._threads[i].id === id) { t = this._threads[i]; break; }
        }
        if (t && typeof window.openConversationActionsModal === 'function') {
          window.openConversationActionsModal(t.id, t.title, t.matter_id || null, t.is_pinned === true, {
            registryId: t.id,
            threadId: t.thread_id,
            source: 'conversation_threads'
          });
        }
      });

      // Thread item click
      this.delegate('click', '[data-thread-id]', function (e, target) {
        // Ignore clicks on the action buttons — delegate() attaches sibling
        // listeners on the same root, so stopPropagation() in their handlers
        // cannot suppress this one.
        if (e.target.closest('[data-delete-thread]')) return;
        if (e.target.closest('[data-more-thread]')) return;
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
      if ((!this.pageScope && !this.recents) || typeof api === 'undefined') return;

      this._loading = true;
      this._scheduleUpdate();

      var mapThread = function (t) {
        var matterName = (t.matter_name || (t.metadata && t.metadata.matter_name) || '').trim();
        if (matterName.toLowerCase() === 'unknown matter') matterName = '';
        return {
          id: t.id || t.registryId || t.registry_id || t.conversationId || t.conversation_id,
          thread_id: t.thread_id || t.conversationId || t.conversation_id,
          title: t.title || (t.metadata && t.metadata.title) || 'Untitled Chat',
          thread_type: t.thread_type || t.type || 'ad_hoc',
          subtitle: matterName,
          matter_id: t.matter_id || t.scope?.matterId || t.scope?.matter_id || null,
          is_pinned: t.is_pinned === true || t.isPinned === true,
          last_activity: t.last_activity || t.lastActivity || t.updated_at || t.updatedAt || t.created_at || t.createdAt
        };
      };

      try {
        if (this.recents) {
          // App-wide conversation registry rows. Recents is a conversation
          // control surface, so its source of truth is conversation_threads:
          // id drives rename/pin/archive/delete, thread_id drives stream load.
          var calls = [listConversations({ matterId: null })];
          var wantMatter = !!this.matterId;
          if (wantMatter) {
            calls.push(listConversations({ matterId: this.matterId }).catch(function () { return { data: [] }; }));
          }
          var settled = await Promise.all(calls);
          var allRows = settled[0].data || settled[0].threads || settled[0].conversations || (Array.isArray(settled[0]) ? settled[0] : []);
          var allItems = allRows.map(mapThread).filter(function (t) { return !!t.thread_id; });
          if (wantMatter) {
            var wsRows = settled[1].data || settled[1].threads || settled[1].conversations || (Array.isArray(settled[1]) ? settled[1] : []);
            var wsItems = wsRows.map(mapThread).filter(function (t) { return !!t.thread_id; });
            var wsIds = {};
            wsItems.forEach(function (t) { wsIds[t.id] = true; });
            var rest = allItems.filter(function (t) { return !wsIds[t.id]; });
            this._groups = [];
            if (wsItems.length > 0) this._groups.push({ label: 'This workspace', items: wsItems });
            this._groups.push({ label: wsItems.length > 0 ? 'All recents' : null, items: rest });
            this._threads = wsItems.concat(rest);
          } else {
            this._groups = null;
            this._threads = allItems;
          }
        } else {
          this._groups = null;
          var result = await listConversations({ pageScope: this.pageScope, matterId: this.matterId });
          var rows = result.data || result.threads || result.conversations || [];
          this._threads = rows.map(mapThread).filter(function (t) { return !!t.thread_id; });
        }
        if (this._threads.length === 0 && !this._userToggledCollapsed) {
          this.collapsed = true;
        }
      } catch (err) {
        console.warn('[lex-chat-threads] Failed to load threads:', err);
        this._threads = [];
      } finally {
        this._loading = false;
        this._scheduleUpdate();
        this.emit('lex-threads-loaded', { threads: this._threads });
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

    /**
     * Remove a thread from the internal list by ID and re-render.
     * If the deleted thread was active, emit lex-thread-delete so the parent can reset.
     */
    removeThread(threadId) {
      var wasActive = this.activeThread === threadId;
      this._threads = this._threads.filter(function (t) { return t.id !== threadId; });

      if (wasActive) {
        this.activeThread = null;
        this.emit('lex-thread-delete', { threadId: threadId });
      }

      this._scheduleUpdate();
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    _findThread(threadId) {
      for (var i = 0; i < this._threads.length; i++) {
        if (this._threads[i] && this._threads[i].id === threadId) return this._threads[i];
      }
      return null;
    }

    async _stopActiveGenerationForThread(threadId) {
      var thread = this._findThread(threadId);
      var conversationId = thread && thread.thread_id;
      if (!conversationId) {
        return;
      }

      try {
        if (typeof api.stopConversationGeneration === 'function') {
          await api.stopConversationGeneration(conversationId);
        }
      } catch (_) {
        // Best-effort only: deletion should still proceed when no generation is
        // active or an older backend lacks active-generation lookup.
      }
    }

    /**
     * Delete a thread via the API, then remove it from the list.
     * @private
     */
    async _deleteThread(threadId) {
      if (typeof api === 'undefined') return;

      try {
        await this._stopActiveGenerationForThread(threadId);

        if (typeof api.deleteConversation === 'function') {
          await api.deleteConversation(threadId);
        } else {
          throw new Error('canonical conversation delete API not available');
        }
        this.removeThread(threadId);
      } catch (err) {
        console.error('[lex-chat-threads] Failed to delete thread:', err);
      }
    }

    _getThreadIcon(threadType) {
      if (threadType === 'page_general' || threadType === 'chat_session') {
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

/* Search Conversations Page
   Full-page search experience for finding and navigating to conversations.
   Standalone page with <lex-app> shell.

   Uses: lex-input, lex-empty, lex-spinner, lex-card, Lex.Nav
*/

(function () {
  'use strict';

  // =========================================================================
  // State
  // =========================================================================

  var _searchTimeout = null;
  var _currentQuery = '';
  var _page = 1;
  var _hasMore = false;
  var _isLoadingMore = false;
  var _PAGE_SIZE = 20;

  var _scrollHandler = null;

  // =========================================================================
  // DOM references (resolved on init)
  // =========================================================================

  var _els = {
    input: null,
    loading: null,
    empty: null,
    emptyState: null,
    list: null,
    sectionHeader: null,
    sectionTitle: null,
    sectionSubtitle: null,
    items: null,
    loadMore: null,
    loadMoreSpinner: null
  };

  // =========================================================================
  // Init
  // =========================================================================

  function initSearchConversationsPage() {
    _els.input = document.getElementById('searchConversationsInput');
    _els.loading = document.getElementById('searchConvLoading');
    _els.empty = document.getElementById('searchConvEmpty');
    _els.emptyState = document.getElementById('searchConvEmptyState');
    _els.list = document.getElementById('searchConvList');
    _els.sectionHeader = document.getElementById('searchConvSectionHeader');
    _els.sectionTitle = document.getElementById('searchConvSectionTitle');
    _els.sectionSubtitle = document.getElementById('searchConvSectionSubtitle');
    _els.items = document.getElementById('searchConvItems');
    _els.loadMore = document.getElementById('searchConvLoadMore');
    _els.loadMoreSpinner = document.getElementById('searchConvLoadMoreSpinner');

    if (!_els.input) return;

    // Reset closure state on every page entry (script persists across navigations)
    _currentQuery = '';
    _page = 1;
    _hasMore = false;
    _isLoadingMore = false;
    clearTimeout(_searchTimeout);
    _els.input.value = '';

    // Listen for search input (lex-input emits 'lex-input' on keystroke)
    _els.input.addEventListener('lex-input', function (e) {
      var value = (e.detail && e.detail.value !== undefined) ? e.detail.value : '';
      handleSearchInput(value);
    });

    // Also listen for clear (lex-input emits 'lex-change' with empty value on clear)
    _els.input.addEventListener('lex-change', function (e) {
      var value = (e.detail && e.detail.value !== undefined) ? e.detail.value : '';
      if (!value) {
        handleSearchInput('');
      }
    });

    // Click delegation for result items
    if (_els.items) {
      _els.items.addEventListener('click', function (e) {
        // More actions button — open conversation actions modal
        var moreBtn = e.target.closest('[data-action="more"]');
        if (moreBtn) {
          e.stopPropagation();
          var row = moreBtn.closest('[data-thread-id]');
          if (row && typeof window.openConversationActionsModal === 'function') {
            var tid = row.getAttribute('data-thread-id');
            var title = row.getAttribute('data-conv-title') || 'Untitled Chat';
            var mid = row.getAttribute('data-matter-id') || null;
            window.openConversationActionsModal(tid, title, mid);
          }
          return;
        }

        // Row click — navigate to conversation
        var item = e.target.closest('[data-thread-id]');
        if (item) {
          var threadId = item.getAttribute('data-thread-id');
          var matterId = item.getAttribute('data-matter-id') || '';
          selectConversation(threadId, matterId);
        }
      });
    }

    // Register refresh callback so ConversationActionsModal refreshes data instead of full reload
    if (window.ConversationActionsModal) {
      window.ConversationActionsModal.onRefresh = refreshResults;
    }

    // Infinite scroll — load more when near bottom.
    var scrollContainer = document.getElementById('lex-main-content');
    if (scrollContainer) {
      _scrollHandler = function () {
        if (_isLoadingMore || !_hasMore) return;
        var threshold = 200;
        var distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
        if (distanceFromBottom < threshold) {
          loadMoreConversations();
        }
      };
      scrollContainer.addEventListener('scroll', _scrollHandler);
    }

    // Load recent conversations on page load
    loadRecentConversations();
  }

  // =========================================================================
  // Search input handler (debounced)
  // =========================================================================

  function handleSearchInput(value) {
    clearTimeout(_searchTimeout);
    var query = value.trim();
    _currentQuery = query;

    if (query.length === 0) {
      loadRecentConversations();
      return;
    }

    if (query.length < 2) {
      showEmpty('Type at least 2 characters to search...');
      return;
    }

    _searchTimeout = setTimeout(function () {
      performSearch(query);
    }, 300);
  }

  // =========================================================================
  // API calls
  // =========================================================================

  function loadRecentConversations() {
    _page = 1;
    _hasMore = false;
    showLoading();

    api.get('/api/v1/chat/sessions?page=1&limit=' + _PAGE_SIZE + '&sort=updated_at&order=desc')
      .then(function (response) {
        var conversations = (response && response.sessions) || [];
        var total = (response && response.pagination && response.pagination.total) || conversations.length;

        if (conversations.length === 0) {
          showEmpty('No recent conversations');
          return;
        }

        _hasMore = conversations.length >= _PAGE_SIZE && conversations.length < total;
        setSectionHeader('Recent Conversations', 'Your most recent chats');
        renderResults(conversations, '');
        showList();
        toggleLoadMore(_hasMore);
      })
      .catch(function (error) {
        console.error('Failed to load recent conversations:', error);
        showEmpty('Failed to load conversations');
      });
  }

  function performSearch(query) {
    _page = 1;
    _hasMore = false;
    showLoading();

    api.get('/api/v1/chat/sessions?page=1&limit=' + _PAGE_SIZE + '&search=' + encodeURIComponent(query))
      .then(function (response) {
        // Guard against stale responses
        if (query !== _currentQuery) return;

        var conversations = (response && response.sessions) || [];
        var total = (response && response.pagination && response.pagination.total) || conversations.length;

        if (conversations.length === 0) {
          showEmpty('No conversations found', 'Try a different search term');
          return;
        }

        _hasMore = conversations.length >= _PAGE_SIZE && conversations.length < total;
        var totalLabel = total > conversations.length ? total : conversations.length;
        setSectionHeader('Search Results', totalLabel + ' conversation' + (totalLabel === 1 ? '' : 's') + ' found');
        renderResults(conversations, query);
        showList();
        toggleLoadMore(_hasMore);
      })
      .catch(function (error) {
        console.error('Failed to search conversations:', error);
        showEmpty('Failed to search conversations');
      });
  }

  function loadMoreConversations() {
    if (_isLoadingMore || !_hasMore) return;
    _isLoadingMore = true;
    _page++;
    toggleLoadMore(true, true);

    var url = '/api/v1/chat/sessions?page=' + _page + '&limit=' + _PAGE_SIZE + '&sort=updated_at&order=desc';
    if (_currentQuery) {
      url += '&search=' + encodeURIComponent(_currentQuery);
    }

    api.get(url)
      .then(function (response) {
        var conversations = (response && response.sessions) || [];
        var total = (response && response.pagination && response.pagination.total) || 0;

        if (conversations.length === 0) {
          _hasMore = false;
          toggleLoadMore(false);
          _isLoadingMore = false;
          return;
        }

        _hasMore = conversations.length >= _PAGE_SIZE;
        appendResults(conversations, _currentQuery);
        toggleLoadMore(_hasMore);
        _isLoadingMore = false;
      })
      .catch(function (error) {
        console.error('Failed to load more conversations:', error);
        _page--;
        toggleLoadMore(true);
        _isLoadingMore = false;
      });
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  function renderResults(conversations, query) {
    if (!_els.items) return;

    var html = '';
    for (var i = 0; i < conversations.length; i++) {
      html += renderResultItem(conversations[i], query);
    }
    _els.items.innerHTML = html;

    // Clear redacted shimmer if active
    if (window.Lex && window.Lex.Redact) {
      window.Lex.Redact.off(_els.items);
    }
  }

  function appendResults(conversations, query) {
    if (!_els.items) return;

    var html = '';
    for (var i = 0; i < conversations.length; i++) {
      html += renderResultItem(conversations[i], query);
    }
    _els.items.insertAdjacentHTML('beforeend', html);
  }

  function renderResultItem(conv, query) {
    var threadId = conv.thread_id || conv.id || '';
    var matterId = conv.matter_id || '';
    var title = conv.title || (conv.metadata && conv.metadata.title) || 'Untitled Chat';
    var lastMessage = conv.last_message || conv.lastMessage || '';
    var matterName = conv.matter_name || (conv.metadata && conv.metadata.matter_name) || '';
    var timestamp = formatTimestamp(conv.updated_at || conv.created_at);

    if (!threadId) return '';

    // Truncate preview
    var preview = lastMessage.length > 120 ? lastMessage.substring(0, 120) + '...' : lastMessage;

    // Highlight search terms
    var displayTitle = query ? highlightText(escapeHtml(title), query) : escapeHtml(title);
    var displayPreview = query ? highlightText(escapeHtml(preview), query) : escapeHtml(preview);
    var displayMatter = matterName ? (query ? highlightText(escapeHtml(matterName), query) : escapeHtml(matterName)) : '';

    // Matter badge
    var matterBadge = displayMatter
      ? '<span class="inline-flex items-center gap-1 mt-1 text-xs lex-text-tertiary">'
        + '<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
        + '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>'
        + '</svg>'
        + '<span>' + displayMatter + '</span>'
        + '</span>'
      : '';

    // Preview line
    var previewLine = displayPreview
      ? '<p class="text-sm lex-text-secondary mt-1.5 line-clamp-2">' + displayPreview + '</p>'
      : '';

    return ''
      + '<div class="group flex items-start justify-between gap-3 p-4 rounded-xl border cursor-pointer transition-all'
      + ' hover:shadow-sm'
      + '"'
      + ' style="background:var(--lex-bg-primary);border-color:var(--lex-border-subtle);"'
      + ' onmouseenter="this.style.borderColor=\'var(--lex-border-default)\'"'
      + ' onmouseleave="this.style.borderColor=\'var(--lex-border-subtle)\'"'
      + ' data-thread-id="' + escapeAttr(threadId) + '"'
      + ' data-matter-id="' + escapeAttr(matterId) + '"'
      + ' data-conv-title="' + escapeAttr(title) + '"'
      + '>'
      + '  <div class="flex-1 min-w-0">'
      + '    <p class="text-sm font-medium lex-text-primary truncate">' + displayTitle + '</p>'
      + matterBadge
      + previewLine
      + '  </div>'
      + '  <div class="flex-shrink-0 flex items-center gap-2">'
      + '    <span class="text-xs lex-text-tertiary whitespace-nowrap">' + escapeHtml(timestamp) + '</span>'
      + '    <button data-action="more" class="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all'
      + ' hover:bg-black/5" title="More actions">'
      + '      <svg class="w-4 h-4 lex-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">'
      + '        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"'
      + '          d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>'
      + '      </svg>'
      + '    </button>'
      + '  </div>'
      + '</div>';
  }

  // =========================================================================
  // Navigation
  // =========================================================================

  function selectConversation(threadId, matterId) {
    if (!threadId) return;

    var params = { session: threadId };
    if (matterId) params.matter = matterId;

    if (window.Lex && window.Lex.Nav) {
      window.Lex.Nav.go('chat-v2.html', { params: params });
    } else if (window.NavigationHelpers) {
      window.NavigationHelpers.navigateToConversation(threadId, matterId);
    } else {
      var url = 'chat.html?session=' + encodeURIComponent(threadId);
      if (matterId) url += '&matter=' + encodeURIComponent(matterId);
      window.location.href = url;
    }
  }

  // =========================================================================
  // UI state helpers
  // =========================================================================

  function showLoading() {
    if (_els.loading) _els.loading.classList.remove('hidden');
    if (_els.empty) _els.empty.classList.add('hidden');
    if (_els.list) _els.list.classList.add('hidden');
  }

  function showEmpty(message, description) {
    if (_els.loading) _els.loading.classList.add('hidden');
    if (_els.list) _els.list.classList.add('hidden');
    if (_els.empty) _els.empty.classList.remove('hidden');
    if (_els.emptyState) {
      _els.emptyState.message = message || 'No conversations found';
      _els.emptyState.description = description || '';
    }
    // Clear redacted shimmer if active
    if (_els.items && window.Lex && window.Lex.Redact) {
      window.Lex.Redact.off(_els.items);
    }
  }

  function showList() {
    if (_els.loading) _els.loading.classList.add('hidden');
    if (_els.empty) _els.empty.classList.add('hidden');
    if (_els.list) _els.list.classList.remove('hidden');
  }

  function setSectionHeader(title, subtitle) {
    if (_els.sectionTitle) _els.sectionTitle.textContent = title;
    if (_els.sectionSubtitle) _els.sectionSubtitle.textContent = subtitle || '';
  }

  function toggleLoadMore(visible, spinning) {
    if (_els.loadMore) {
      if (visible) {
        _els.loadMore.classList.remove('hidden');
      } else {
        _els.loadMore.classList.add('hidden');
      }
    }
    if (_els.loadMoreSpinner) {
      _els.loadMoreSpinner.style.display = spinning ? '' : 'none';
    }
  }

  // =========================================================================
  // Refresh results after rename/delete (called by ConversationActionsModal)
  // =========================================================================

  function refreshResults() {
    // Show redacted shimmer on existing results while data reloads
    if (_els.items && window.Lex && window.Lex.Redact) {
      window.Lex.Redact.on(_els.items);
    }

    if (_currentQuery) {
      performSearch(_currentQuery);
    } else {
      loadRecentConversations();
    }
  }

  // Topbar refresh button
  document.addEventListener('lex-refresh', function (e) {
    e.preventDefault();
    refreshResults();
  });

  // =========================================================================
  // Utilities (NO regex — string methods only)
  // =========================================================================

  /**
   * Highlight occurrences of query in text using string methods.
   * Text must already be HTML-escaped. Query is matched case-insensitively.
   */
  function highlightText(escapedText, query) {
    if (!query || !escapedText) return escapedText;

    var lowerText = escapedText.toLowerCase();
    var lowerQuery = escapeHtml(query).toLowerCase();
    var queryLen = lowerQuery.length;
    var result = '';
    var lastIdx = 0;
    var idx = lowerText.indexOf(lowerQuery, lastIdx);

    while (idx !== -1) {
      // Append text before match
      result += escapedText.substring(lastIdx, idx);
      // Append highlighted match (preserve original casing)
      result += '<mark class="lex-bg-warning-subtle font-medium" style="background:var(--lex-color-warning-100, #fef3c7);border-radius:2px;padding:0 1px;">';
      result += escapedText.substring(idx, idx + queryLen);
      result += '</mark>';
      lastIdx = idx + queryLen;
      idx = lowerText.indexOf(lowerQuery, lastIdx);
    }

    // Append remaining text
    result += escapedText.substring(lastIdx);
    return result;
  }

  function formatTimestamp(dateString) {
    if (!dateString) return '';

    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now - date;
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return diffMins + 'm ago';
    if (diffHours < 24) return diffHours + 'h ago';
    if (diffDays < 7) return diffDays + 'd ago';

    return formatDateLong(dateString, { month: 'short' });
  }

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function escapeAttr(text) {
    if (!text) return '';
    return String(text)
      .split('&').join('&amp;')
      .split('"').join('&quot;')
      .split("'").join('&#39;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  // =========================================================================
  // Init — standalone page, called directly
  // =========================================================================

  initSearchConversationsPage();

})();

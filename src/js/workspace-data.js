/**
 * Workspace Data — Connected data visualization for a specific workspace/matter.
 *
 * Displays paginated connector data assigned to a workspace with
 * filtering, search, and an embedded Ask LANA chat panel.
 *
 * @requires api.js          - window.api
 * @requires lex.utils.js    - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-toast.js    - Lex.Toast.error
 * @requires lex-table.js    - table.setData()
 * @requires lex-chat.js     - lex-chat component
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // Lex aliases
  // ═══════════════════════════════════════════════════════════════

  var fmtDateTime = Lex.Utils.formatDateTime;

  // ═══════════════════════════════════════════════════════════════
  // Module-level state
  // ═══════════════════════════════════════════════════════════════

  var _gen         = 0;
  var _matterId    = '';
  var _matterName  = '';
  var _currentPage = 1;
  var _pageSize    = 50;
  var _searchTerm  = '';
  var _entityFilter = '';
  var _connectorFilter = '';
  var _sortBy      = 'synced_at';
  var _sortDir     = 'desc';
  var _chatEl      = null;
  var _threadsEl   = null;

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function el(id) { return document.getElementById(id); }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  // ═══════════════════════════════════════════════════════════════
  // Entry point
  // ═══════════════════════════════════════════════════════════════

  function init() {
    _matterId = getQueryParam('id');
    if (!_matterId) {
      if (typeof Lex !== 'undefined' && Lex.Toast) {
        Lex.Toast.error('No workspace ID provided');
      }
      return;
    }

    _fetchMatterDetails();
  }

  // ═══════════════════════════════════════════════════════════════
  // Fetch matter details for breadcrumb/title
  // ═══════════════════════════════════════════════════════════════

  function _fetchMatterDetails() {
    api.get('/api/v1/matters/' + encodeURIComponent(_matterId))
      .then(function (result) {
        var matter = (result && result.data) || result || {};
        _matterName = matter.matter_name || matter.name || _matterId;

        // Update breadcrumb
        var breadcrumb = el('wsDataBreadcrumb');
        if (breadcrumb) {
          breadcrumb.setAttribute('items', JSON.stringify([
            { label: 'Workspaces', href: 'workspaces.html' },
            { label: _matterName, href: 'workspace-details.html?id=' + encodeURIComponent(_matterId) },
            { label: 'Connected Data' }
          ]));
        }

        // Update banner subtitle
        var banner = el('wsDataBanner');
        if (banner) {
          banner.setAttribute('subtitle', 'Data connected to ' + _matterName);
        }

        // Wire everything and load data
        _wireSearch();
        _wireFilters();
        _wirePagination();
        _wireAskLana();
        _setupChat();
        _loadData();
      })
      .catch(function (err) {
        console.error('[WorkspaceData] Failed to fetch matter:', err);
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          Lex.Toast.error('Failed to load workspace details');
        }
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Search
  // ═══════════════════════════════════════════════════════════════

  function _wireSearch() {
    var input = el('wsDataSearch');
    if (!input || input._wired) return;
    input._wired = true;

    var debounce = null;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        _searchTerm = input.value.trim();
        _currentPage = 1;
        _loadData();
      }, 300);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Filters
  // ═══════════════════════════════════════════════════════════════

  function _wireFilters() {
    var entitySelect = el('wsDataEntityFilter');
    var connectorSelect = el('wsDataConnectorFilter');

    if (entitySelect && !entitySelect._wired) {
      entitySelect._wired = true;
      entitySelect.addEventListener('lex-change', function (e) {
        _entityFilter = (e.detail && e.detail.value) || '';
        _currentPage = 1;
        _loadData();
      });
    }

    if (connectorSelect && !connectorSelect._wired) {
      connectorSelect._wired = true;
      connectorSelect.addEventListener('lex-change', function (e) {
        _connectorFilter = (e.detail && e.detail.value) || '';
        _currentPage = 1;
        _loadData();
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Pagination
  // ═══════════════════════════════════════════════════════════════

  function _wirePagination() {
    var pager = el('wsDataPagination');
    if (!pager || pager._wired) return;
    pager._wired = true;
    pager.addEventListener('page-change', function (e) {
      var page = e.detail && e.detail.page;
      if (page && page !== _currentPage) {
        _currentPage = page;
        _loadData();
      }
    });
  }

  function _updatePagination(total) {
    var pager = el('wsDataPagination');
    if (!pager) return;
    var totalPages = Math.max(1, Math.ceil(total / _pageSize));
    pager.page       = _currentPage;
    pager.totalPages = totalPages;
    pager.total      = total;
    pager.limit      = _pageSize;
  }

  // ═══════════════════════════════════════════════════════════════
  // Ask LANA button
  // ═══════════════════════════════════════════════════════════════

  function _wireAskLana() {
    var btn = el('askLanaBtn');
    var closeBtn = el('closeChatBtn');
    var chatCol = el('wsDataChatColumn');
    if (!chatCol) return;

    function _openChat() {
      chatCol.style.display = 'flex';
      setTimeout(function () {
        if (!_chatEl) return;
        var composer = _chatEl.querySelector('lex-chat-composer');
        if (composer) {
          var input = composer.querySelector('textarea, input, [contenteditable]');
          if (input) input.focus();
        }
      }, 150);
    }

    function _closeChat() {
      chatCol.style.display = 'none';
    }

    if (btn) btn.addEventListener('click', _openChat);
    if (closeBtn) closeBtn.addEventListener('click', _closeChat);
  }

  // ═══════════════════════════════════════════════════════════════
  // Data loading
  // ═══════════════════════════════════════════════════════════════

  function _loadData() {
    var gen = ++_gen;
    var table = el('wsDataTable');
    if (!table) return;

    _rowDataMap = {};
    Lex.Redact.on(table);

    var url = '/api/v1/matters/' + encodeURIComponent(_matterId) + '/connected-data' +
      '?page=' + _currentPage +
      '&limit=' + _pageSize +
      '&sort_by=' + encodeURIComponent(_sortBy) +
      '&sort_dir=' + encodeURIComponent(_sortDir);

    if (_searchTerm) {
      url += '&search=' + encodeURIComponent(_searchTerm);
    }
    if (_entityFilter) {
      url += '&entity_type=' + encodeURIComponent(_entityFilter);
    }
    if (_connectorFilter) {
      url += '&connector_id=' + encodeURIComponent(_connectorFilter);
    }

    api.get(url)
      .then(function (result) {
        if (gen !== _gen) return;

        var rows = (result && result.data) || [];
        var pagination = (result && result.pagination) || {};
        var filters = (result && result.filters) || {};
        var total = pagination.total || rows.length;

        // Update stat cards
        _updateStatCards(total, filters);

        // Update filter dropdowns
        _updateFilterOptions(filters);

        // Format rows for display
        var formatted = rows.map(function (row) {
          return _formatRow(row);
        });

        Lex.Redact.off(table);
        table.setData(formatted);
        _updatePagination(total);
        _wireRowClick();
        _linkifyConnectorCells(table);
      })
      .catch(function (err) {
        if (gen !== _gen) return;
        Lex.Redact.off(table);
        console.error('[WorkspaceData] Load failed:', err);
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          Lex.Toast.error('Failed to load connected data');
        }
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Stat cards
  // ═══════════════════════════════════════════════════════════════

  function _formatEntityType(type) {
    if (!type) return '-';
    return type.split('_').map(function (w) {
      return w.charAt(0).toUpperCase() + w.substring(1);
    }).join(' ');
  }

  function _updateStatCards(total, filters) {
    var container = el('wsDataStatCards');
    if (!container) return;

    var entityTypes = (filters && filters.entity_types) || [];
    var connectors = (filters && filters.connectors) || [];

    var html =
      '<div style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;">' +
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Total Records</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);">' + total + '</p>' +
      '</div>' +
      '<div style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;">' +
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Entity Types</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);">' + entityTypes.length + '</p>' +
      '</div>' +
      '<div style="padding:0.5rem 0.75rem;border:1px solid var(--lex-border-default, #e5e7eb);border-radius:8px;min-width:100px;">' +
        '<p style="margin:0;font-size:11px;color:var(--lex-text-secondary, #6b7280);">Connectors</p>' +
        '<p style="margin:2px 0 0;font-size:18px;font-weight:600;color:var(--lex-text-primary, #111827);">' + connectors.length + '</p>' +
      '</div>';

    container.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════
  // Filter options
  // ═══════════════════════════════════════════════════════════════

  function _updateFilterOptions(filters) {
    var entitySelect = el('wsDataEntityFilter');
    var connectorSelect = el('wsDataConnectorFilter');

    if (entitySelect && filters.entity_types) {
      var entityOptions = [{ value: '', label: 'All Entity Types' }];
      for (var i = 0; i < filters.entity_types.length; i++) {
        var et = filters.entity_types[i];
        var label = _formatEntityType(et.entity_type) + ' (' + et.count + ')';
        entityOptions.push({ value: et.entity_type, label: label });
      }
      entitySelect.setAttribute('options', JSON.stringify(entityOptions));
      if (_entityFilter) {
        entitySelect.setAttribute('value', _entityFilter);
      }
    }

    if (connectorSelect && filters.connectors) {
      var connectorOptions = [{ value: '', label: 'All Connectors' }];
      for (var j = 0; j < filters.connectors.length; j++) {
        var c = filters.connectors[j];
        var cLabel = (c.connector_id || 'Unknown') + ' (' + c.count + ')';
        connectorOptions.push({ value: c.connector_id, label: cLabel });
      }
      connectorSelect.setAttribute('options', JSON.stringify(connectorOptions));
      if (_connectorFilter) {
        connectorSelect.setAttribute('value', _connectorFilter);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Row formatting
  // ═══════════════════════════════════════════════════════════════

  /** Keep full row data for detail view */
  var _rowDataMap = {};

  /**
   * Extract the user-facing row_data from the connector data JSONB.
   * Google Sheets stores actual values in data.row_data; other connectors
   * may store them flat in data directly.
   */
  function _getRowData(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.row_data && typeof data.row_data === 'object') return data.row_data;
    // Fallback: use non-internal fields from data itself
    var out = {};
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].charAt(0) !== '_') out[keys[i]] = data[keys[i]];
    }
    return out;
  }

  function _formatDataSummary(data) {
    var rowData = _getRowData(data);
    var keys = Object.keys(rowData);
    if (keys.length === 0) return '-';
    var parts = [];
    for (var i = 0; i < keys.length && parts.length < 3; i++) {
      var val = rowData[keys[i]];
      if (val == null || val === '') continue;
      var str = String(val);
      if (str.length > 40) str = str.substring(0, 37) + '...';
      parts.push(keys[i] + ': ' + str);
    }
    var result = parts.join('  |  ');
    if (result.length > 140) result = result.substring(0, 137) + '...';
    return result || '-';
  }

  function _formatRow(row) {
    if (row.id) _rowDataMap[row.id] = row;
    return {
      id:           row.id || '',
      external_id:  row.external_id ? '...' + row.external_id.substring(row.external_id.length - 6) : '-',
      entity_type:  _formatEntityType(row.entity_type),
      connector_id: row.connector_name || row.connector_id || 'LANA',
      raw_data:     _formatDataSummary(row.data)
    };
  }

  /**
   * Post-process rendered table to turn connector cells into hyperlinks
   * pointing directly to the connector viewer page.
   * Non-connector data shows "LANA" with no link.
   */
  function _linkifyConnectorCells(table) {
    if (!table) return;
    requestAnimationFrame(function () {
      var rows = table.querySelectorAll('tbody tr');
      for (var i = 0; i < rows.length; i++) {
        var rowId = rows[i].getAttribute('data-row-id');
        var fullRow = _rowDataMap[rowId];
        // connector_id is the 3rd visible column (index 2)
        var cells = rows[i].querySelectorAll('td');
        if (cells.length < 3) continue;
        var cell = cells[2];
        var text = (cell.textContent || '').trim();
        if (!text || text === 'LANA' || text === '-') continue;
        if (!fullRow || !fullRow.connector_ui_url) continue;

        // Build direct link to connector-viewer
        var params = new URLSearchParams({
          ui: fullRow.connector_ui_url,
          name: fullRow.connector_name || fullRow.connector_id || '',
          connectorId: fullRow.connector_id || ''
        });
        var href = 'integrations/connector-viewer.html?' + params.toString();

        var link = document.createElement('a');
        link.href = href;
        link.textContent = fullRow.connector_name || text;
        link.style.cssText = 'color:var(--lex-accent, #2563eb);text-decoration:none;';
        link.addEventListener('mouseenter', function () { this.style.textDecoration = 'underline'; });
        link.addEventListener('mouseleave', function () { this.style.textDecoration = 'none'; });
        link.addEventListener('click', function (e) { e.stopPropagation(); });
        cell.textContent = '';
        cell.appendChild(link);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Row click — show raw data modal
  // ═══════════════════════════════════════════════════════════════

  function _wireRowClick() {
    var table = el('wsDataTable');
    if (!table || table._rowClickWired) return;
    table._rowClickWired = true;
    table.addEventListener('row-click', function (e) {
      var detail = e.detail || {};
      var rowId = detail.id;
      var fullRow = _rowDataMap[rowId];
      if (fullRow && fullRow.data) {
        _showDataModal(fullRow);
      }
    });
  }

  function _showDataModal(row) {
    var existing = document.getElementById('wsDataRawModal');
    if (existing) existing.remove();

    var escHtml = Lex.Utils.escapeHtml;
    var data = row.data || {};
    var rowData = _getRowData(data);

    // Collect metadata (internal _ fields)
    var meta = {};
    var dataKeys = Object.keys(data);
    for (var i = 0; i < dataKeys.length; i++) {
      if (dataKeys[i].charAt(0) === '_') meta[dataKeys[i]] = data[dataKeys[i]];
    }

    // Build field grid HTML (matching connector UI pattern)
    var fieldsHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 2rem;">';
    var rdKeys = Object.keys(rowData);
    for (var j = 0; j < rdKeys.length; j++) {
      var key = rdKeys[j];
      var val = rowData[key];
      var valStr = (val !== null && val !== undefined) ? String(val) : '';
      fieldsHtml +=
        '<div style="padding:4px 0;">' +
          '<div style="font-size:11px;font-weight:500;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;">' + escHtml(key) + '</div>' +
          '<div style="font-size:13px;color:#111827;margin-top:2px;word-break:break-word;">' +
            (valStr.length > 0 ? escHtml(valStr) : '<span style="color:#d1d5db;font-style:italic;">empty</span>') +
          '</div>' +
        '</div>';
    }
    fieldsHtml += '</div>';

    // Build metadata section (collapsible)
    var metaHtml = '';
    var metaKeys = Object.keys(meta);
    if (metaKeys.length > 0) {
      metaHtml = '<details style="margin-top:1rem;">' +
        '<summary style="font-size:11px;color:#9ca3af;cursor:pointer;">Metadata</summary>' +
        '<div style="margin-top:0.5rem;background:#f9fafb;border-radius:6px;padding:0.75rem;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">';
      for (var m = 0; m < metaKeys.length; m++) {
        metaHtml += '<div style="padding:2px 0;"><span style="color:#9ca3af;">' + escHtml(metaKeys[m]) + ':</span> <span style="color:#4b5563;">' + escHtml(String(meta[metaKeys[m]])) + '</span></div>';
      }
      metaHtml += '</div></details>';
    }

    // Build raw JSON section (collapsible)
    var jsonHtml = '<details style="margin-top:0.75rem;">' +
      '<summary style="font-size:11px;color:#9ca3af;cursor:pointer;">Raw JSON</summary>' +
      '<pre style="margin-top:0.5rem;background:#f9fafb;border-radius:6px;padding:0.75rem;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:250px;overflow-y:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#374151;">' +
        escHtml(JSON.stringify(data, null, 2)) +
      '</pre></details>';

    // Assemble modal
    var overlay = document.createElement('div');
    overlay.id = 'wsDataRawModal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);';

    var panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:12px;width:640px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.15);';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'padding:1rem 1.25rem;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    header.innerHTML =
      '<div>' +
        '<p style="margin:0;font-weight:600;font-size:14px;color:#111827;">Record Detail</p>' +
        '<p style="margin:2px 0 0;font-size:12px;color:#6b7280;">' +
          escHtml(row.connector_id || '') + ' &middot; ' + escHtml(row.entity_type || '') +
          (row.synced_at ? ' &middot; ' + (fmtDateTime(row.synced_at) || '') : '') +
        '</p>' +
      '</div>' +
      '<button id="wsDataRawClose" style="background:none;border:none;cursor:pointer;padding:4px;color:#9ca3af;border-radius:4px;" title="Close">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
      '</button>';

    // Body
    var body = document.createElement('div');
    body.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:1rem 1.25rem;';
    body.innerHTML = fieldsHtml + metaHtml + jsonHtml;

    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Close handlers
    document.getElementById('wsDataRawClose').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Chat integration (insights_chat)
  // ═══════════════════════════════════════════════════════════════

  function _setupChat() {
    var container = el('chatContainer');
    if (!container) return;

    // Create threads list
    _threadsEl = document.createElement('lex-chat-threads');
    _threadsEl.setAttribute('page-scope', 'workspace_data_' + _matterId);
    _threadsEl.setAttribute('context-type', 'insights_chat');
    _threadsEl.style.flexShrink = '0';

    // Create chat
    _chatEl = document.createElement('lex-chat');
    _chatEl.setAttribute('context-type', 'insights_chat');
    _chatEl.setAttribute('source', 'sse');
    _chatEl.setAttribute('placeholder', 'Ask about this workspace data...');
    _chatEl.style.flex = '1';
    _chatEl.style.minHeight = '0';

    container.appendChild(_threadsEl);
    container.appendChild(_chatEl);

    // Re-acquire live references after potential cloning
    var liveChat = container.querySelector('lex-chat');
    var liveThreads = container.querySelector('lex-chat-threads');
    if (liveChat) _chatEl = liveChat;
    if (liveThreads) _threadsEl = liveThreads;

    _threadsEl.style.flexShrink = '0';
    _chatEl.style.flex = '1';
    _chatEl.style.minHeight = '0';
    _chatEl.style.overflow = 'hidden';

    // Wire thread selection
    container.addEventListener('lex-thread-select', function (e) {
      var thread = e.detail && e.detail.thread;
      if (!thread || !_chatEl) return;
      _chatEl.clearConversation();
      _chatEl.loadConversation(thread.thread_id);
    });

    // Auto-select page_general thread when threads finish loading
    container.addEventListener('lex-threads-loaded', function (e) {
      var threads = e.detail && e.detail.threads;
      if (!threads || !threads.length || !_chatEl) return;
      for (var i = 0; i < threads.length; i++) {
        if (threads[i].thread_type === 'page_general' && threads[i].thread_id) {
          _chatEl.loadConversation(threads[i].thread_id);
          if (_threadsEl) _threadsEl.setActiveThread(threads[i].id);
          break;
        }
      }
    });

    // Wire new thread creation
    container.addEventListener('lex-thread-create', function () {
      if (!_chatEl) return;
      _chatEl.clearConversation();
      if (_threadsEl) _threadsEl.setActiveThread(null);
    });

    // Register page_general thread on first conversation
    container.addEventListener('lex-chat-conversation-created', function (e) {
      var conversationId = e.detail && e.detail.conversationId;
      if (!conversationId || typeof api === 'undefined') return;

      if (window.ConversationMenu && typeof window.ConversationMenu.addConversation === 'function') {
        window.ConversationMenu.addConversation({
          thread_id: conversationId,
          title: 'Workspace Data - ' + _matterName,
          updated_at: new Date().toISOString()
        });
      }

      var threadsComp = _threadsEl;
      if (threadsComp && threadsComp._threads && threadsComp._threads.length > 0) {
        for (var i = 0; i < threadsComp._threads.length; i++) {
          if (threadsComp._threads[i].thread_type === 'page_general') {
            var existingThread = threadsComp._threads[i];
            existingThread.thread_id = conversationId;
            api.put('/api/v1/conversation-threads/' + existingThread.id, {
              thread_id: conversationId
            }).catch(function (err) {
              console.warn('[WorkspaceData] Failed to update page thread thread_id:', err);
            });
            return;
          }
        }
      }

      api.post('/api/v1/conversation-threads', {
        title: 'Workspace Data - ' + _matterName,
        thread_type: 'page_general',
        context_type: 'insights_chat',
        page_scope: 'workspace_data_' + _matterId,
        thread_id: conversationId
      }).then(function (resp) {
        var created = resp.data || resp;
        if (_threadsEl) {
          _threadsEl.addThread(created);
          _threadsEl.setActiveThread(created.id);
        }
      }).catch(function (err) {
        console.warn('[WorkspaceData] Failed to register page thread:', err);
      });
    });

    // Wrap chat send to inject workspace context as attachment
    var origSend = _chatEl.send;
    if (typeof origSend === 'function') {
      _chatEl.send = function (content, opts) {
        opts = opts || {};
        opts.attachments = opts.attachments || {};
        opts.attachments.workspace = {
          matter_id: _matterId,
          matter_name: _matterName,
          context: 'workspace_connected_data'
        };
        return origSend.call(this, content, opts);
      };
    }

    // Lock composer tools to insights_chat
    setTimeout(function () {
      if (!_chatEl) return;
      var composer = _chatEl.querySelector('lex-chat-composer');
      if (!composer) return;

      var plusBtn = composer.querySelector('[data-plus]');
      if (plusBtn && plusBtn.parentElement) {
        plusBtn.parentElement.style.display = 'none';
      }

      if (typeof composer.setActiveTools === 'function') {
        composer.setActiveTools(['insights_chat']);
      }
      if (typeof composer.setToolsLocked === 'function') {
        composer.setToolsLocked(true);
      }
    }, 150);
  }

  // ═══════════════════════════════════════════════════════════════
  // Start
  // ═══════════════════════════════════════════════════════════════

  init();

})();

/* Approvals — HITL Approval Inbox & Detail controller.
   Handles both approvals.html (inbox) and approval-detail.html (detail view).

   Rules:
     - NO regex anywhere — string methods only (includes, indexOf, split, etc.)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - All time/date formatting via Lex.Utils.timeAgo() / Lex.Utils.formatDate()
     - IIFE wrapper to keep scope clean

   @requires api.js          — window.api (api.get / api.post)
   @requires lex.utils.js    — Lex.Utils.escapeHtml, Lex.Utils.timeAgo, Lex.Utils.formatDateTime
   @requires lex-toast.js    — Lex.Toast.success / .error / .warning
   @requires lex-pagination  — <lex-pagination> component
*/

(function () {
  'use strict';

  // ===========================================================================
  // Lex aliases
  // ===========================================================================

  var escHtml     = Lex.Utils.escapeHtml;
  var timeAgo     = Lex.Utils.timeAgo;
  var fmtDateTime = Lex.Utils.formatDateTime;

  // ===========================================================================
  // Shared helpers
  // ===========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  // ===========================================================================
  // Badge renderers
  // ===========================================================================

  /**
   * Render a priority badge HTML string.
   * @param {string} priority — low | normal | high | urgent
   * @returns {string}
   */
  function priorityBadge(priority) {
    var p = String(priority || 'normal').toLowerCase();
    var cls = 'apr-priority apr-priority-' + p;
    var labels = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
    var label = labels[p] || p;
    return '<span class="' + escHtml(cls) + '">' + escHtml(label) + '</span>';
  }

  /**
   * Render a status badge HTML string.
   * @param {string} status — pending | approved | rejected | expired | cancelled
   * @returns {string}
   */
  function statusBadge(status) {
    var s = String(status || 'pending').toLowerCase();
    var cls = 'apr-status apr-status-' + s;
    var labels = {
      pending:   'Pending',
      approved:  'Approved',
      rejected:  'Rejected',
      expired:   'Expired',
      cancelled: 'Cancelled'
    };
    var label = labels[s] || s;
    return '<span class="' + escHtml(cls) + '">' + escHtml(label) + '</span>';
  }

  /**
   * Render a source type badge HTML string.
   * @param {string} sourceType — workflow | chat | skill | manual
   * @returns {string}
   */
  function sourceBadge(sourceType) {
    var s = String(sourceType || '').toLowerCase();
    var labels = {
      workflow: 'Workflow',
      chat:     'Chat',
      skill:    'Skill',
      manual:   'Manual'
    };
    var label = labels[s] || escHtml(s);
    return '<span class="apr-source">' + escHtml(label) + '</span>';
  }

  /**
   * Format a countdown from now until expiresAt.
   * Returns an object with { text, urgencyClass }.
   * @param {string|null} expiresAt
   * @param {string} status
   * @returns {{ text: string, urgencyClass: string }}
   */
  function formatTimeRemaining(expiresAt, status) {
    if (!expiresAt || status !== 'pending') {
      return { text: '', urgencyClass: '' };
    }

    var now   = LanaTime.nowMs();
    var expMs = new Date(expiresAt).getTime();
    var diffMs = expMs - now;

    if (isNaN(expMs)) {
      return { text: '', urgencyClass: '' };
    }

    if (diffMs <= 0) {
      return { text: 'Expired', urgencyClass: 'expired' };
    }

    var totalMinutes = Math.floor(diffMs / 60000);
    var hours        = Math.floor(totalMinutes / 60);
    var minutes      = totalMinutes % 60;
    var days         = Math.floor(hours / 24);

    var text = '';
    if (days > 0) {
      text = days + 'd ' + (hours % 24) + 'h remaining';
    } else if (hours > 0) {
      text = hours + 'h ' + minutes + 'm remaining';
    } else {
      text = minutes + 'm remaining';
    }

    var urgencyClass = 'ok';
    if (totalMinutes < 60) {
      urgencyClass = 'urgent';
    } else if (totalMinutes < 240) {
      urgencyClass = 'warning';
    }

    return { text: text, urgencyClass: urgencyClass };
  }

  /**
   * Format a date for display (e.g. "Apr 2, 2026 at 3:45 PM").
   * Falls back to timeAgo if the date is recent.
   * @param {string} dateStr
   * @returns {string}
   */
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      // Use timeAgo for dates within the last 7 days
      var daysDiff = Lex.Utils.millisecondsSince(d.getTime()) / Lex.Utils.MS_PER_DAY;
      if (daysDiff < 7) {
        return timeAgo(dateStr);
      }
      return fmtDateTime(dateStr);
    } catch (e) {
      return dateStr;
    }
  }

  // ===========================================================================
  // API functions
  // ===========================================================================

  /**
   * Load approval requests with optional filters.
   * @param {Object} filters — { status, priority, source_type, search, page, limit }
   * @returns {Promise}
   */
  function loadApprovals(filters) {
    var params = [];
    if (filters.status)      params.push('status='      + encodeURIComponent(filters.status));
    if (filters.priority)    params.push('priority='    + encodeURIComponent(filters.priority));
    if (filters.source_type) params.push('source_type=' + encodeURIComponent(filters.source_type));
    if (filters.search)      params.push('search='      + encodeURIComponent(filters.search));
    if (filters.page)        params.push('page='        + encodeURIComponent(filters.page));
    if (filters.limit)       params.push('limit='       + encodeURIComponent(filters.limit));

    var qs = params.length > 0 ? '?' + params.join('&') : '';
    return api.get('/api/v1/approvals' + qs);
  }

  /**
   * Load approvals assigned to the current user (inbox view).
   * @returns {Promise}
   */
  function loadInbox() {
    return api.get('/api/v1/approvals/inbox');
  }

  /**
   * Load pending inbox count for the current user.
   * @returns {Promise}
   */
  function loadInboxCount() {
    return api.get('/api/v1/approvals/inbox/count');
  }

  /**
   * Load a single approval by ID.
   * @param {string} id
   * @returns {Promise}
   */
  function loadApproval(id) {
    return api.get('/api/v1/approvals/' + encodeURIComponent(id));
  }

  /**
   * Load status history for an approval.
   * @param {string} id
   * @returns {Promise}
   */
  function loadHistory(id) {
    return api.get('/api/v1/approvals/' + encodeURIComponent(id) + '/history');
  }

  /**
   * Approve an approval request.
   * @param {string} id
   * @param {string} comments
   * @returns {Promise}
   */
  function approveRequest(id, comments) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/approve', { comments: comments });
  }

  /**
   * Reject an approval request.
   * @param {string} id
   * @param {string} comments
   * @returns {Promise}
   */
  function rejectRequest(id, comments) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/reject', { comments: comments });
  }

  /**
   * Cancel an approval request.
   * @param {string} id
   * @returns {Promise}
   */
  function cancelRequest(id) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/cancel', {});
  }

  /**
   * Reassign an approval request to another user.
   * @param {string} id
   * @param {{ assigned_to: string, comments: string }} data
   * @returns {Promise}
   */
  function reassignRequest(id, data) {
    return api.post('/api/v1/approvals/' + encodeURIComponent(id) + '/reassign', data);
  }

  /**
   * Load aggregate stats for the approvals page.
   * @returns {Promise}
   */
  function loadStats() {
    return api.get('/api/v1/approvals/stats');
  }

  // ===========================================================================
  // INBOX PAGE logic
  // ===========================================================================

  var _inbox = {
    currentPage:    1,
    pageSize:       20,
    statusFilter:   'pending',
    priorityFilter: '',
    sourceFilter:   '',
    searchTerm:     '',
    searchDebounce: null,
    totalItems:     0
  };

  function initInboxPage() {
    _fetchStats();
    _bindInboxEvents();
    _fetchApprovals();
  }

  function _bindInboxEvents() {
    // Status segmented control
    var statusFilter = el('aprStatusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('lex-change', function (e) {
        _inbox.statusFilter  = e.detail.value || '';
        _inbox.currentPage   = 1;
        _syncStatHighlight();
        _fetchApprovals();
      });
    }

    // Priority filter
    var priorityFilter = el('aprPriorityFilter');
    if (priorityFilter) {
      priorityFilter.addEventListener('lex-change', function (e) {
        _inbox.priorityFilter = e.detail.value || '';
        _inbox.currentPage    = 1;
        _fetchApprovals();
      });
    }

    // Source filter
    var sourceFilter = el('aprSourceFilter');
    if (sourceFilter) {
      sourceFilter.addEventListener('lex-change', function (e) {
        _inbox.sourceFilter = e.detail.value || '';
        _inbox.currentPage  = 1;
        _fetchApprovals();
      });
    }

    // Search input (debounced 350ms)
    var searchInput = el('aprSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(_inbox.searchDebounce);
        _inbox.searchDebounce = setTimeout(function () {
          _inbox.searchTerm  = searchInput.value.trim();
          _inbox.currentPage = 1;
          _fetchApprovals();
        }, 350);
      });

      searchInput.addEventListener('focus', function () {
        this.style.borderColor = 'var(--lex-input-border-focus)';
        this.style.boxShadow   = '0 0 0 3px color-mix(in srgb, var(--lex-input-border-focus) 20%, transparent)';
      });

      searchInput.addEventListener('blur', function () {
        this.style.borderColor = 'var(--lex-border-default)';
        this.style.boxShadow   = 'none';
      });
    }

    // Stats bar clicks — set status filter
    var statsBar = el('aprStats');
    if (statsBar) {
      statsBar.addEventListener('click', function (e) {
        var stat = e.target.closest('.apr-stat');
        if (!stat) return;

        var status = stat.dataset.status || '';
        _inbox.statusFilter  = status;
        _inbox.currentPage   = 1;

        // Update segmented control to match
        var seg = el('aprStatusFilter');
        if (seg) seg.value = status;

        _syncStatHighlight();
        _fetchApprovals();
      });
    }

    // Pagination
    var pag = el('aprPagination');
    if (pag) {
      pag.addEventListener('page-change', function (e) {
        _inbox.currentPage = e.detail.page;
        _fetchApprovals();
      });
    }
  }

  function _syncStatHighlight() {
    var stats = document.querySelectorAll('.apr-stat');
    for (var i = 0; i < stats.length; i++) {
      var stat   = stats[i];
      var status = stat.dataset.status || '';
      if (status === _inbox.statusFilter) {
        stat.classList.add('active');
      } else {
        stat.classList.remove('active');
      }
    }
  }

  function _fetchStats() {
    loadStats().then(function (res) {
      var data = (res && res.data) || res || {};
      var byStatus = data.by_status || data.byStatus || {};

      var total     = data.total     || 0;
      var pending   = byStatus.pending   || 0;
      var approved  = byStatus.approved  || 0;
      var rejected  = byStatus.rejected  || 0;
      var expired   = byStatus.expired   || 0;

      _setStatCount('aprCountAll',      total);
      _setStatCount('aprCountPending',  pending);
      _setStatCount('aprCountApproved', approved);
      _setStatCount('aprCountRejected', rejected);
      _setStatCount('aprCountExpired',  expired);
    }).catch(function () {
      // Stats are non-critical — fail silently
    });
  }

  function _setStatCount(id, count) {
    var elem = el(id);
    if (elem) elem.textContent = String(count);
  }

  function _fetchApprovals() {
    // Show loading, hide others
    show('aprLoading');
    hide('aprCard');
    hide('aprPagination');
    hide('aprEmpty');

    loadApprovals({
      status:      _inbox.statusFilter,
      priority:    _inbox.priorityFilter,
      source_type: _inbox.sourceFilter,
      search:      _inbox.searchTerm,
      page:        _inbox.currentPage,
      limit:       _inbox.pageSize
    }).then(function (res) {
      var items      = (res && res.data) || [];
      var pagination = (res && res.pagination) || {};
      var total      = pagination.total || items.length || 0;
      var totalPages = pagination.total_pages || pagination.totalPages || Math.ceil(total / _inbox.pageSize) || 1;

      _inbox.totalItems = total;

      hide('aprLoading');

      if (!items || items.length === 0) {
        show('aprEmpty');
        return;
      }

      _renderInboxList(items);

      // Update pagination
      var pag = el('aprPagination');
      if (pag) {
        pag.setAttribute('page',        String(_inbox.currentPage));
        pag.setAttribute('total-pages', String(totalPages));
        pag.setAttribute('total',       String(total));
        pag.setAttribute('limit',       String(_inbox.pageSize));
        show(pag);
      }

      show('aprCard');
    }).catch(function (err) {
      hide('aprLoading');
      Lex.Toast.error('Failed to load approvals: ' + (err && err.message ? err.message : 'Unknown error'));
      show('aprEmpty');
    });
  }

  function _renderInboxList(items) {
    var list = el('aprList');
    if (!list) return;

    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += _renderInboxItem(items[i]);
    }
    list.innerHTML = html;

    // Bind click handlers to each item
    var rows = list.querySelectorAll('.apr-item');
    for (var j = 0; j < rows.length; j++) {
      (function (row) {
        row.addEventListener('click', function () {
          var id = row.dataset.id;
          if (id) {
            window.location.href = 'approval-detail.html?id=' + encodeURIComponent(id);
          }
        });
      })(rows[j]);
    }
  }

  function _renderInboxItem(item) {
    var id          = escHtml(String(item.id || ''));
    var title       = escHtml(String(item.title || 'Untitled Approval'));
    var priority    = String(item.priority || 'normal').toLowerCase();
    var status      = String(item.status   || 'pending').toLowerCase();
    var sourceType  = String(item.source_type || item.sourceType || '').toLowerCase();
    var requester   = escHtml(String(item.requester_name || item.requesterName || 'Unknown'));
    var assignedTo  = escHtml(String(item.assigned_to_name || item.assignedToName || 'Unassigned'));
    var createdAt   = item.created_at || item.createdAt || '';
    var expiresAt   = item.expires_at || item.expiresAt || '';

    var timer       = formatTimeRemaining(expiresAt, status);

    var timerHtml = '';
    if (timer.text) {
      timerHtml = '<span class="apr-item-timer ' + escHtml(timer.urgencyClass) + '">' + escHtml(timer.text) + '</span>';
    }

    var metaHtml = [
      sourceBadge(sourceType),
      priorityBadge(priority),
      statusBadge(status),
      '<span>Requested by <strong>' + requester + '</strong></span>',
      '<span class="apr-item-meta-dot">&middot;</span>',
      '<span>Assigned to <strong>' + assignedTo + '</strong></span>',
      '<span class="apr-item-meta-dot">&middot;</span>',
      '<span>' + escHtml(formatDate(createdAt)) + '</span>'
    ].join('');

    return [
      '<div class="apr-item" data-id="' + id + '" data-priority="' + escHtml(priority) + '" role="button" tabindex="0">',
        '<div class="apr-item-body">',
          '<div class="apr-item-title">' + title + '</div>',
          '<div class="apr-item-meta">' + metaHtml + '</div>',
        '</div>',
        timerHtml,
        '<div class="apr-item-chevron">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
        '</div>',
      '</div>'
    ].join('');
  }

  // ===========================================================================
  // DETAIL PAGE logic
  // ===========================================================================

  var _detail = {
    approvalId:  '',
    approval:    null,
    actioning:   false,
    timerHandle: null
  };

  function initDetailPage() {
    _detail.approvalId = getQueryParam('id');

    if (!_detail.approvalId) {
      hide('apdLoading');
      show('apdError');
      return;
    }

    _fetchApproval();
  }

  function _fetchApproval() {
    show('apdLoading');
    hide('apdContent');
    hide('apdError');

    loadApproval(_detail.approvalId).then(function (res) {
      var approval = (res && res.approval)
        || (res && res.data && res.data.approval)
        || (res && res.data)
        || res;
      if (!approval || !approval.id) {
        hide('apdLoading');
        show('apdError');
        return;
      }

      _detail.approval = approval;
      _renderDetailHeader(approval);
      _renderInfoGrid(approval);
      _renderPayload(approval);
      _showActionPanel(approval);

      hide('apdLoading');
      show('apdContent');

      // Load history asynchronously
      _fetchHistory(_detail.approvalId);

      // If pending, start a live countdown
      if (approval.status === 'pending' && (approval.expires_at || approval.expiresAt)) {
        _startDetailTimer(approval.expires_at || approval.expiresAt);
      }
    }).catch(function () {
      hide('apdLoading');
      show('apdError');
    });
  }

  function _renderDetailHeader(approval) {
    var titleEl   = el('apdTitle');
    var descEl    = el('apdDesc');
    var statusEl  = el('apdStatusBadge');
    var priorityEl = el('apdPriorityBadge');
    var sourceEl  = el('apdSourceBadge');
    var timerEl   = el('apdTimer');

    if (titleEl)   titleEl.textContent = approval.title || 'Untitled Approval';
    if (descEl && approval.description) {
      descEl.textContent = approval.description;
      descEl.style.display = '';
    }

    if (statusEl)  statusEl.innerHTML  = statusBadge(approval.status);
    if (priorityEl) priorityEl.innerHTML = priorityBadge(approval.priority);
    if (sourceEl)  sourceEl.innerHTML  = sourceBadge(approval.source_type || approval.sourceType);

    if (timerEl) {
      var timer = formatTimeRemaining(approval.expires_at || approval.expiresAt, approval.status);
      timerEl.textContent = timer.text;
      timerEl.className   = timer.urgencyClass ? 'apr-item-timer ' + timer.urgencyClass : '';
    }
  }

  function _startDetailTimer(expiresAt) {
    if (_detail.timerHandle) clearInterval(_detail.timerHandle);

    _detail.timerHandle = setInterval(function () {
      var timerEl = el('apdTimer');
      if (!timerEl) {
        clearInterval(_detail.timerHandle);
        return;
      }
      var timer = formatTimeRemaining(expiresAt, 'pending');
      timerEl.textContent = timer.text;
      timerEl.className   = timer.urgencyClass ? 'apr-item-timer ' + timer.urgencyClass : '';

      if (timer.urgencyClass === 'expired') {
        clearInterval(_detail.timerHandle);
      }
    }, 60000);
  }

  function _renderInfoGrid(approval) {
    var grid = el('apdInfoGrid');
    if (!grid) return;

    var fields = [
      { label: 'Requester',    value: approval.requester_name  || approval.requesterName  || '—' },
      { label: 'Assigned To',  value: approval.assigned_to_name || approval.assignedToName || 'Unassigned' },
      { label: 'Source',       value: _formatSourceType(approval.source_type || approval.sourceType) },
      { label: 'Priority',     value: _capitalize(approval.priority || 'normal') },
      { label: 'Status',       value: _capitalize(approval.status || 'pending') },
      { label: 'Created',      value: formatDate(approval.created_at || approval.createdAt) },
      { label: 'Expires',      value: formatDate(approval.expires_at || approval.expiresAt) },
      { label: 'Source ID',    value: approval.source_id || approval.sourceId || '—' }
    ];

    var html = '';
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      html += [
        '<div class="apd-info-item">',
          '<div class="apd-info-label">' + escHtml(f.label) + '</div>',
          '<div class="apd-info-value">' + escHtml(String(f.value)) + '</div>',
        '</div>'
      ].join('');
    }

    grid.innerHTML = html;
  }

  function _capitalize(str) {
    if (!str) return '';
    return String(str).charAt(0).toUpperCase() + String(str).slice(1);
  }

  function _formatSourceType(sourceType) {
    if (!sourceType) return '—';
    var labels = { workflow: 'Workflow', chat: 'Chat', skill: 'Skill', manual: 'Manual' };
    return labels[String(sourceType).toLowerCase()] || _capitalize(sourceType);
  }

  function _renderPayload(approval) {
    var container = el('apdPayloadContent');
    var card      = el('apdPayloadCard');
    if (!container) return;

    var payload = approval.payload;

    // Hide payload card if there's nothing to show
    if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) {
      if (card) hide(card);
      return;
    }

    // Try to render as key-value pairs if it's a flat object
    if (typeof payload === 'object' && !Array.isArray(payload)) {
      var keys = Object.keys(payload);
      var isFlat = true;
      for (var i = 0; i < keys.length; i++) {
        var v = payload[keys[i]];
        if (typeof v === 'object' && v !== null) {
          isFlat = false;
          break;
        }
      }

      if (isFlat) {
        var html = '<div class="apd-payload-kv">';
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var val = payload[key] === null || payload[key] === undefined ? '—' : String(payload[key]);
          html += [
            '<div class="apd-kv-row">',
              '<div class="apd-kv-key">' + escHtml(key) + '</div>',
              '<div class="apd-kv-val">' + escHtml(val) + '</div>',
            '</div>'
          ].join('');
        }
        html += '</div>';
        container.innerHTML = html;
        return;
      }
    }

    // Fall back to pretty-printed JSON
    var jsonStr = '';
    try {
      jsonStr = JSON.stringify(payload, null, 2);
    } catch (e) {
      jsonStr = String(payload);
    }
    container.innerHTML = '<pre class="apd-payload">' + escHtml(jsonStr) + '</pre>';
  }

  function _fetchHistory(id) {
    var timeline = el('apdTimeline');
    if (!timeline) return;

    loadHistory(id).then(function (res) {
      var entries = (res && res.data) || [];
      _renderTimeline(entries);
    }).catch(function () {
      if (timeline) {
        timeline.innerHTML = '<div style="padding:16px;color:var(--lex-text-tertiary);font-size:0.8125rem;">Unable to load history.</div>';
      }
    });
  }

  function _renderTimeline(entries) {
    var timeline = el('apdTimeline');
    if (!timeline) return;

    if (!entries || entries.length === 0) {
      timeline.innerHTML = '<div style="padding:16px;color:var(--lex-text-tertiary);font-size:0.8125rem;">No history entries.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < entries.length; i++) {
      var entry  = entries[i];
      var action = String(entry.action || entry.status || 'created').toLowerCase();
      var actor  = escHtml(String(entry.actor_name  || entry.actorName  || entry.actor || 'System'));
      var ts     = escHtml(formatDate(entry.created_at || entry.createdAt || entry.timestamp));
      var comment = entry.comments || entry.comment || '';

      var dotClass = 'apd-timeline-dot ' + action;

      html += [
        '<div class="apd-timeline-item">',
          '<div class="' + escHtml(dotClass) + '"></div>',
          '<div class="apd-timeline-line"></div>',
          '<div class="apd-timeline-body">',
            '<div class="apd-timeline-action">' + escHtml(_capitalize(action)) + '</div>',
            '<div class="apd-timeline-actor">' + actor + ' &middot; ' + ts + '</div>',
            comment ? '<div class="apd-timeline-comment">' + escHtml(String(comment)) + '</div>' : '',
          '</div>',
        '</div>'
      ].join('');
    }

    timeline.innerHTML = html;
  }

  function _showActionPanel(approval) {
    var actionCard = el('apdActionCard');
    if (!actionCard) return;

    // Only show action panel for pending approvals
    if (approval.status !== 'pending') {
      hide(actionCard);
      return;
    }

    show(actionCard);
    _bindActionButtons(approval);
  }

  function _bindActionButtons(approval) {
    var approveBtn   = el('apdApproveBtn');
    var rejectBtn    = el('apdRejectBtn');
    var reassignBtn  = el('apdReassignBtn');
    var cancelBtn    = el('apdCancelBtn');
    var commentInput = el('apdComment');

    if (approveBtn) {
      approveBtn.addEventListener('click', function () {
        if (_detail.actioning) return;
        var comments = commentInput ? commentInput.value.trim() : '';
        _performAction('approve', comments);
      });
    }

    if (rejectBtn) {
      rejectBtn.addEventListener('click', function () {
        if (_detail.actioning) return;
        var comments = commentInput ? commentInput.value.trim() : '';
        _performAction('reject', comments);
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        if (_detail.actioning) return;
        Lex.Modal.confirm(
          'Cancel Approval Request',
          'Are you sure you want to cancel this approval request? This action cannot be undone.',
          function () {
            _performAction('cancel', '');
          }
        );
      });
    }

    if (reassignBtn) {
      reassignBtn.addEventListener('click', function () {
        _openReassignModal();
      });
    }
  }

  function _performAction(actionType, comments) {
    _detail.actioning = true;

    // Disable all action buttons during request
    _setActionButtonsLoading(true);

    var promise;
    if (actionType === 'approve') {
      promise = approveRequest(_detail.approvalId, comments);
    } else if (actionType === 'reject') {
      promise = rejectRequest(_detail.approvalId, comments);
    } else if (actionType === 'cancel') {
      promise = cancelRequest(_detail.approvalId);
    } else {
      _detail.actioning = false;
      _setActionButtonsLoading(false);
      return;
    }

    promise.then(function () {
      _detail.actioning = false;
      var label = actionType === 'approve' ? 'Approved' : (actionType === 'reject' ? 'Rejected' : 'Cancelled');
      Lex.Toast.success('Approval ' + label.toLowerCase() + ' successfully');

      // Hide action panel and refresh data
      hide('apdActionCard');
      _fetchApproval();

      // Clear timer
      if (_detail.timerHandle) {
        clearInterval(_detail.timerHandle);
        _detail.timerHandle = null;
      }
    }).catch(function (err) {
      _detail.actioning = false;
      _setActionButtonsLoading(false);
      Lex.Toast.error('Action failed: ' + (err && err.message ? err.message : 'Please try again'));
    });
  }

  function _setActionButtonsLoading(loading) {
    var btns = ['apdApproveBtn', 'apdRejectBtn', 'apdReassignBtn', 'apdCancelBtn'];
    for (var i = 0; i < btns.length; i++) {
      var btn = el(btns[i]);
      if (btn) {
        if (loading) {
          btn.setAttribute('loading', '');
          btn.setAttribute('disabled', '');
        } else {
          btn.removeAttribute('loading');
          btn.removeAttribute('disabled');
        }
      }
    }
  }

  function _openReassignModal() {
    var modal = el('apdReassignModal');
    if (!modal) return;

    // Load users into the reassign select
    _loadUsersForReassign();

    modal.setAttribute('open', '');

    var cancelBtn  = el('apdReassignCancelBtn');
    var confirmBtn = el('apdReassignConfirmBtn');

    if (cancelBtn) {
      cancelBtn.onclick = function () {
        modal.removeAttribute('open');
      };
    }

    if (confirmBtn) {
      confirmBtn.onclick = function () {
        var userSelect   = el('apdReassignUser');
        var commentInput = el('apdReassignComment');

        var userId   = userSelect  ? (userSelect.value  || '') : '';
        var comments = commentInput ? (commentInput.value || '').trim() : '';

        if (!userId) {
          Lex.Toast.warning('Please select a user to reassign to');
          return;
        }

        reassignRequest(_detail.approvalId, { assigned_to: userId, comments: comments })
          .then(function () {
            modal.removeAttribute('open');
            Lex.Toast.success('Approval reassigned successfully');
            _fetchApproval();
          })
          .catch(function (err) {
            Lex.Toast.error('Reassign failed: ' + (err && err.message ? err.message : 'Please try again'));
          });
      };
    }
  }

  function _loadUsersForReassign() {
    var userSelect = el('apdReassignUser');
    if (!userSelect) return;

    api.get('/api/v1/users?limit=100').then(function (res) {
      var users = (res && res.data) || [];
      var options = [];
      for (var i = 0; i < users.length; i++) {
        var u = users[i];
        options.push({
          value: String(u.id),
          label: escHtml(String(u.full_name || u.fullName || u.email || u.id))
        });
      }
      userSelect.options = options;
    }).catch(function () {
      // Non-critical — user can still type if select allows it
    });
  }

  // ===========================================================================
  // Page detection and init
  // ===========================================================================

  /**
   * Determine which page we're on and initialize the appropriate controller.
   * Called once the Lex page-init script has mounted the template content.
   */
  function init() {
    var path = window.location.pathname;

    // Check page by filename
    var isDetail = (
      path.indexOf('approval-detail') !== -1 ||
      (path.indexOf('approval') !== -1 && getQueryParam('id'))
    );

    if (isDetail) {
      initDetailPage();
    } else {
      initInboxPage();
    }
  }

  // lex-page-init.js runs synchronously before this script, so the template
  // content is already in the DOM. Call init directly.
  init();

  // Cleanup timer on page unload
  window.addEventListener('unload', function () {
    if (_detail.timerHandle) clearInterval(_detail.timerHandle);
  });

})();

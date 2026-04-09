/**
 * Workspace Billable Hours Tab
 * Renders summary metrics, time entry list with pagination, date filters,
 * bulk actions, and review/approve modal for a specific matter's billable hours.
 */

(function () {
  'use strict';

  var _matterId = null;
  var _entries = [];
  var _currentPage = 1;
  var _totalPages = 1;
  var _pageSize = 25;
  var _dateFrom = '';
  var _dateTo = '';
  var _selectedIds = {};

  /**
   * Render the billable hours tab for a matter.
   * Called by switchMatterTab('billableHours') in workspace-details.js.
   */
  window.renderBillableHoursTab = function (matter) {
    _matterId = matter.matter_id;
    _currentPage = 1;
    _selectedIds = {};

    // Set default date range to current month
    var now = new Date();
    _dateFrom = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    _dateTo = now.toISOString().substring(0, 10);

    _renderFilters();
    _loadSummary(matter);
    _loadEntries(matter);
    _wireGenerateButton(matter);
    _wireManualEntryButton(matter);
  };

  // ═══════════════════════════════════════════════════════════════
  // Filters Bar
  // ═══════════════════════════════════════════════════════════════

  function _renderFilters() {
    var container = document.getElementById('bhFiltersBar');
    if (!container) return;

    container.innerHTML = '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">' +
      '<label style="font-size:0.75rem;color:var(--lex-text-muted);font-weight:600;">From</label>' +
      '<input type="date" id="bhDateFrom" value="' + Lex.Utils.escapeHtml(_dateFrom) + '" style="padding:0.25rem 0.5rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.8125rem;">' +
      '<label style="font-size:0.75rem;color:var(--lex-text-muted);font-weight:600;">To</label>' +
      '<input type="date" id="bhDateTo" value="' + Lex.Utils.escapeHtml(_dateTo) + '" style="padding:0.25rem 0.5rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.8125rem;">' +
      '<lex-btn id="bhFilterApplyBtn" variant="outline" size="sm">Apply</lex-btn>' +
      '<div id="bhBulkActions" style="display:none;margin-left:auto;gap:0.5rem;">' +
        '<lex-btn id="bhBulkApproveBtn" variant="primary" size="sm">Approve Selected</lex-btn>' +
        '<lex-btn id="bhBulkRejectBtn" variant="danger" size="sm">Reject Selected</lex-btn>' +
      '</div>' +
    '</div>';

    // Wire date filter
    var applyBtn = document.getElementById('bhFilterApplyBtn');
    if (applyBtn && !applyBtn._bhWired) {
      applyBtn._bhWired = true;
      applyBtn.addEventListener('click', function () {
        var fromInput = document.getElementById('bhDateFrom');
        var toInput = document.getElementById('bhDateTo');
        _dateFrom = fromInput ? fromInput.value : '';
        _dateTo = toInput ? toInput.value : '';
        _currentPage = 1;
        _selectedIds = {};
        _loadEntries({ matter_id: _matterId });
        _loadSummary({ matter_id: _matterId });
      });
    }

    // Wire bulk actions
    _wireBulkActions();
    _updateBulkActionsVisibility();
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary Card
  // ═══════════════════════════════════════════════════════════════

  function _loadSummary(matter) {
    var container = document.getElementById('bhSummaryCard');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse" style="grid-column:1/-1;"><div class="cc-skeleton" style="height:3rem;width:100%;"></div></div>';

    var url = '/api/v1/billable-hours/summary?matter_id=' + encodeURIComponent(matter.matter_id);
    if (_dateFrom) url += '&date_from=' + encodeURIComponent(_dateFrom);
    if (_dateTo) url += '&date_to=' + encodeURIComponent(_dateTo);

    api.get(url)
      .then(function (result) {
        var data = (result && result.data) || {};
        container.innerHTML = _buildSummaryCards(data);
      })
      .catch(function () {
        container.innerHTML = '<div style="color:var(--lex-text-muted);font-size:0.8rem;grid-column:1/-1;">Unable to load summary</div>';
      });
  }

  function _buildSummaryCards(data) {
    var cards = [
      { label: 'Total Hours', value: (data.total_hours || 0).toFixed(1), suffix: 'h' },
      { label: 'Billable Hours', value: (data.billable_hours || 0).toFixed(1), suffix: 'h' },
      { label: 'Billable Amount', value: '$' + _formatMoney(data.billable_amount || 0), suffix: '' },
      { label: 'Entries', value: data.total_entries || 0, suffix: '' },
      { label: 'Drafts', value: (data.by_status && data.by_status.draft) || 0, suffix: '', highlight: true },
      { label: 'Approved', value: (data.by_status && data.by_status.approved) || 0, suffix: '' }
    ];

    var html = '';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var valueColor = c.highlight ? 'var(--lex-color-amber-600,#d97706)' : 'var(--lex-text-primary)';
      html += '<div style="background:var(--lex-bg-muted,#f9fafb);border-radius:0.5rem;padding:0.75rem 1rem;">';
      html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;letter-spacing:0.05em;">' + Lex.Utils.escapeHtml(c.label) + '</div>';
      html += '<div style="font-size:1.25rem;font-weight:700;color:' + valueColor + ';">' + Lex.Utils.escapeHtml(String(c.value)) + Lex.Utils.escapeHtml(c.suffix) + '</div>';
      html += '</div>';
    }
    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  // Time Entries List
  // ═══════════════════════════════════════════════════════════════

  function _loadEntries(matter) {
    var loadingEl = document.getElementById('bhEntriesLoading');
    var listEl = document.getElementById('bhEntriesList');
    var emptyEl = document.getElementById('bhEntriesEmpty');
    if (!listEl) return;

    if (loadingEl) loadingEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    var mid = matter.matter_id || _matterId;
    var url = '/api/v1/billable-hours/drafts?matter_id=' + encodeURIComponent(mid) +
      '&status=all&limit=' + _pageSize + '&page=' + _currentPage;
    if (_dateFrom) url += '&date_from=' + encodeURIComponent(_dateFrom);
    if (_dateTo) url += '&date_to=' + encodeURIComponent(_dateTo);

    api.get(url)
      .then(function (result) {
        _entries = (result && result.data) || [];
        var pagination = result && result.pagination;
        if (pagination) {
          _totalPages = pagination.totalPages || 1;
          _currentPage = pagination.page || 1;
        }

        if (loadingEl) loadingEl.classList.add('hidden');

        if (_entries.length === 0 && _currentPage === 1) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          _renderPagination(0);
          return;
        }

        listEl.classList.remove('hidden');
        listEl.innerHTML = _buildEntriesList(_entries);
        _wireEntryActions();
        _renderPagination(pagination ? pagination.total : _entries.length);
      })
      .catch(function () {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (emptyEl) {
          emptyEl.textContent = 'Failed to load time entries.';
          emptyEl.classList.remove('hidden');
        }
      });
  }

  function _buildEntriesList(entries) {
    var html = '';

    // Header row with select-all
    var hasDrafts = entries.some(function (e) { return e.status === 'draft'; });
    if (hasDrafts) {
      html += '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 1rem;background:var(--lex-bg-muted,#f9fafb);border-bottom:1px solid var(--lex-border-default,#e5e7eb);font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">';
      html += '<input type="checkbox" id="bhSelectAll" style="cursor:pointer;">';
      html += '<span>Select all drafts</span>';
      html += '</div>';
    }

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var hours = ((e.duration_minutes || 0) / 60).toFixed(1);
      var date = e.start_time ? Lex.Utils.formatDateTime(e.start_time, { dateOnly: true }) : '-';
      var statusColor = _getStatusColor(e.status);
      var description = e.description || 'No description';
      if (description.length > 120) description = description.substring(0, 117) + '...';

      var bgStyle = i % 2 === 1 ? 'background:var(--lex-bg-muted,#f9fafb);' : '';
      var isChecked = !!_selectedIds[e.id];

      html += '<div class="bh-entry-row" data-entry-id="' + Lex.Utils.escapeHtml(e.id) + '" style="' + bgStyle + 'display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background=\'var(--lex-bg-accent-subtle,#eff6ff)\'" onmouseout="this.style.background=\'' + (i % 2 === 1 ? 'var(--lex-bg-muted,#f9fafb)' : '') + '\'">';

      // Checkbox for drafts
      if (e.status === 'draft') {
        html += '<input type="checkbox" class="bh-entry-checkbox" data-id="' + Lex.Utils.escapeHtml(e.id) + '" ' + (isChecked ? 'checked' : '') + ' style="cursor:pointer;" onclick="event.stopPropagation();">';
      } else if (hasDrafts) {
        html += '<div style="width:1rem;"></div>';
      }

      // Hours badge
      html += '<div style="min-width:3.5rem;text-align:center;padding:0.25rem 0.5rem;background:var(--lex-bg-accent-subtle,#eff6ff);border-radius:0.375rem;font-size:0.875rem;font-weight:700;color:var(--lex-color-blue-700,#1d4ed8);">' + hours + 'h</div>';

      // Description + date
      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:0.8125rem;color:var(--lex-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Lex.Utils.escapeHtml(description) + '</div>';
      html += '<div style="font-size:0.7rem;color:var(--lex-text-muted);">' + Lex.Utils.escapeHtml(date) + ' - ' + Lex.Utils.escapeHtml(e.activity_type || 'general') + '</div>';
      html += '</div>';

      // Status badge
      html += '<div style="flex-shrink:0;padding:0.125rem 0.5rem;border-radius:9999px;font-size:0.7rem;font-weight:600;background:' + statusColor.bg + ';color:' + statusColor.text + ';">' + Lex.Utils.escapeHtml(e.status || 'draft') + '</div>';

      // Action buttons for drafts
      if (e.status === 'draft') {
        html += '<div style="display:flex;gap:0.25rem;flex-shrink:0;">';
        html += '<button class="bh-approve-btn" data-id="' + Lex.Utils.escapeHtml(e.id) + '" style="padding:0.25rem 0.5rem;font-size:0.7rem;font-weight:600;background:var(--lex-color-green-50,#f0fdf4);color:var(--lex-color-green-700,#15803d);border:1px solid var(--lex-color-green-200,#bbf7d0);border-radius:0.25rem;cursor:pointer;">Approve</button>';
        html += '<button class="bh-reject-btn" data-id="' + Lex.Utils.escapeHtml(e.id) + '" style="padding:0.25rem 0.5rem;font-size:0.7rem;font-weight:600;background:var(--lex-color-red-50,#fef2f2);color:var(--lex-color-red-700,#b91c1c);border:1px solid var(--lex-color-red-200,#fecaca);border-radius:0.25rem;cursor:pointer;">Reject</button>';
        html += '</div>';
      }

      html += '</div>';
    }
    return html;
  }

  function _getStatusColor(status) {
    var map = {
      draft: { bg: 'var(--lex-color-amber-50,#fffbeb)', text: 'var(--lex-color-amber-700,#b45309)' },
      submitted: { bg: 'var(--lex-color-blue-50,#eff6ff)', text: 'var(--lex-color-blue-700,#1d4ed8)' },
      approved: { bg: 'var(--lex-color-green-50,#f0fdf4)', text: 'var(--lex-color-green-700,#15803d)' },
      invoiced: { bg: 'var(--lex-color-purple-50,#faf5ff)', text: 'var(--lex-color-purple-700,#7e22ce)' }
    };
    return map[status] || map.draft;
  }

  // ═══════════════════════════════════════════════════════════════
  // Pagination
  // ═══════════════════════════════════════════════════════════════

  function _renderPagination(total) {
    var container = document.getElementById('bhPagination');
    if (!container) return;

    if (!total || _totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    var html = '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;font-size:0.8125rem;color:var(--lex-text-muted);">';
    html += '<span>Showing ' + ((_currentPage - 1) * _pageSize + 1) + '-' + Math.min(_currentPage * _pageSize, total) + ' of ' + total + '</span>';
    html += '<div style="display:flex;gap:0.25rem;">';

    if (_currentPage > 1) {
      html += '<button class="bh-page-btn" data-page="' + (_currentPage - 1) + '" style="padding:0.25rem 0.625rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;cursor:pointer;font-size:0.8125rem;background:white;">Prev</button>';
    }

    var startPage = Math.max(1, _currentPage - 2);
    var endPage = Math.min(_totalPages, _currentPage + 2);
    for (var p = startPage; p <= endPage; p++) {
      var active = p === _currentPage;
      html += '<button class="bh-page-btn" data-page="' + p + '" style="padding:0.25rem 0.625rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;cursor:pointer;font-size:0.8125rem;' + (active ? 'background:var(--lex-color-blue-600,#2563eb);color:white;border-color:var(--lex-color-blue-600,#2563eb);' : 'background:white;') + '">' + p + '</button>';
    }

    if (_currentPage < _totalPages) {
      html += '<button class="bh-page-btn" data-page="' + (_currentPage + 1) + '" style="padding:0.25rem 0.625rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;cursor:pointer;font-size:0.8125rem;background:white;">Next</button>';
    }

    html += '</div></div>';
    container.innerHTML = html;

    // Wire page buttons
    var btns = container.querySelectorAll('.bh-page-btn');
    for (var bi = 0; bi < btns.length; bi++) {
      btns[bi].addEventListener('click', function (e) {
        _currentPage = parseInt(e.target.getAttribute('data-page'));
        _loadEntries({ matter_id: _matterId });
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Entry Actions (approve, reject, click to edit, checkboxes)
  // ═══════════════════════════════════════════════════════════════

  function _wireEntryActions() {
    var listEl = document.getElementById('bhEntriesList');
    if (!listEl) return;

    // Remove old listeners by cloning
    var newList = listEl.cloneNode(true);
    listEl.parentNode.replaceChild(newList, listEl);

    newList.addEventListener('click', function (e) {
      var approveBtn = e.target.closest('.bh-approve-btn');
      if (approveBtn) {
        e.stopPropagation();
        _approveEntry(approveBtn.getAttribute('data-id'));
        return;
      }

      var rejectBtn = e.target.closest('.bh-reject-btn');
      if (rejectBtn) {
        e.stopPropagation();
        _confirmReject(rejectBtn.getAttribute('data-id'));
        return;
      }

      // Click on row → open detail modal
      var row = e.target.closest('.bh-entry-row');
      if (row) {
        var entryId = row.getAttribute('data-entry-id');
        var entry = _entries.find(function (en) { return en.id === entryId; });
        if (entry) _openEntryModal(entry);
      }
    });

    // Wire checkboxes
    newList.addEventListener('change', function (e) {
      if (e.target.classList.contains('bh-entry-checkbox')) {
        var id = e.target.getAttribute('data-id');
        if (e.target.checked) {
          _selectedIds[id] = true;
        } else {
          delete _selectedIds[id];
        }
        _updateBulkActionsVisibility();
      }

      if (e.target.id === 'bhSelectAll') {
        var checkboxes = newList.querySelectorAll('.bh-entry-checkbox');
        for (var ci = 0; ci < checkboxes.length; ci++) {
          checkboxes[ci].checked = e.target.checked;
          var cid = checkboxes[ci].getAttribute('data-id');
          if (e.target.checked) {
            _selectedIds[cid] = true;
          } else {
            delete _selectedIds[cid];
          }
        }
        _updateBulkActionsVisibility();
      }
    });
  }

  function _approveEntry(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/approve')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry approved');
        _refresh();
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to approve entry');
      });
  }

  function _confirmReject(entryId) {
    if (typeof Lex !== 'undefined' && Lex.Modal && Lex.Modal.confirm) {
      Lex.Modal.confirm({
        heading: 'Reject Entry',
        message: 'Are you sure you want to reject this time entry? This action cannot be undone.',
        confirmLabel: 'Reject',
        confirmVariant: 'danger'
      }).then(function (confirmed) {
        if (confirmed) _rejectEntry(entryId);
      });
    } else {
      _rejectEntry(entryId);
    }
  }

  function _rejectEntry(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/reject')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry rejected');
        delete _selectedIds[entryId];
        _refresh();
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to reject entry');
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Bulk Actions
  // ═══════════════════════════════════════════════════════════════

  function _wireBulkActions() {
    var bulkApproveBtn = document.getElementById('bhBulkApproveBtn');
    if (bulkApproveBtn && !bulkApproveBtn._bhWired) {
      bulkApproveBtn._bhWired = true;
      bulkApproveBtn.addEventListener('click', function () {
        _bulkAction('approve');
      });
    }

    var bulkRejectBtn = document.getElementById('bhBulkRejectBtn');
    if (bulkRejectBtn && !bulkRejectBtn._bhWired) {
      bulkRejectBtn._bhWired = true;
      bulkRejectBtn.addEventListener('click', function () {
        if (typeof Lex !== 'undefined' && Lex.Modal && Lex.Modal.confirm) {
          Lex.Modal.confirm({
            heading: 'Reject Selected Entries',
            message: 'Are you sure you want to reject ' + Object.keys(_selectedIds).length + ' entries? This cannot be undone.',
            confirmLabel: 'Reject All',
            confirmVariant: 'danger'
          }).then(function (confirmed) {
            if (confirmed) _bulkAction('reject');
          });
        } else {
          _bulkAction('reject');
        }
      });
    }
  }

  function _bulkAction(action) {
    var ids = Object.keys(_selectedIds);
    if (ids.length === 0) return;

    var completed = 0;
    var failed = 0;
    var total = ids.length;

    function processNext(idx) {
      if (idx >= ids.length) {
        _selectedIds = {};
        if (typeof Lex !== 'undefined' && Lex.Toast) {
          if (failed > 0) {
            Lex.Toast.warning(completed + ' ' + action + 'd, ' + failed + ' failed');
          } else {
            Lex.Toast.success(completed + ' entr' + (completed !== 1 ? 'ies' : 'y') + ' ' + action + 'd');
          }
        }
        _refresh();
        return;
      }

      var endpoint = action === 'approve'
        ? '/api/v1/billable-hours/drafts/' + ids[idx] + '/approve'
        : '/api/v1/billable-hours/drafts/' + ids[idx] + '/reject';

      api.post(endpoint)
        .then(function () { completed++; processNext(idx + 1); })
        .catch(function () { failed++; processNext(idx + 1); });
    }

    processNext(0);
  }

  function _updateBulkActionsVisibility() {
    var bulkEl = document.getElementById('bhBulkActions');
    if (!bulkEl) return;
    var count = Object.keys(_selectedIds).length;
    bulkEl.style.display = count > 0 ? 'flex' : 'none';
  }

  // ═══════════════════════════════════════════════════════════════
  // Entry Detail Modal (full-screen for editing)
  // ═══════════════════════════════════════════════════════════════

  function _openEntryModal(entry) {
    var hours = ((entry.duration_minutes || 0) / 60).toFixed(1);
    var date = entry.start_time ? Lex.Utils.formatDateTime(entry.start_time) : '-';
    var isDraft = entry.status === 'draft';

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';

    // Hours + Activity type
    html += '<div style="display:flex;gap:1rem;align-items:center;">';
    if (isDraft) {
      html += '<div><input type="number" id="bhEditHours" value="' + hours + '" step="0.1" min="0.1" max="24" style="width:5rem;font-size:1.5rem;font-weight:700;color:var(--lex-color-blue-700,#1d4ed8);text-align:center;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;padding:0.25rem;">h</div>';
    } else {
      html += '<div style="font-size:2rem;font-weight:700;color:var(--lex-color-blue-700,#1d4ed8);">' + hours + 'h</div>';
    }
    html += '<div>';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(entry.activity_type || 'general') + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">' + Lex.Utils.escapeHtml(date) + '</div>';
    html += '</div>';
    html += '</div>';

    // Description
    html += '<div>';
    html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Description</div>';
    if (isDraft) {
      html += '<textarea id="bhEditDescription" style="width:100%;min-height:4rem;padding:0.5rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.875rem;font-family:inherit;resize:vertical;">' + Lex.Utils.escapeHtml(entry.description || '') + '</textarea>';
      html += '<div style="display:flex;gap:0.5rem;margin-top:0.25rem;">';
      html += '<button id="bhRegenDescBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;">Regenerate description with AI</button>';
      html += '</div>';
    } else {
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);padding:0.5rem;background:var(--lex-bg-muted,#f9fafb);border-radius:0.375rem;">' + Lex.Utils.escapeHtml(entry.description || 'No description') + '</div>';
    }
    html += '</div>';

    // Details grid
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    var fields = [
      { label: 'Status', value: entry.status },
      { label: 'Billing Code', value: entry.billing_code || '-' },
      { label: 'Duration', value: entry.duration_minutes + ' minutes (' + hours + 'h)' },
      { label: 'Billable', value: entry.is_billable ? 'Yes' : 'No' },
      { label: 'Rate', value: entry.hourly_rate ? '$' + entry.hourly_rate + '/hr' : 'Not set' },
      { label: 'Source', value: entry.source || 'manual' }
    ];
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      html += '<div>';
      html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">' + Lex.Utils.escapeHtml(f.label) + '</div>';
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(f.value) + '</div>';
      html += '</div>';
    }
    html += '</div>';

    // Split + Merge buttons for drafts
    if (isDraft) {
      html += '<div style="padding-top:0.5rem;border-top:1px solid var(--lex-border-default,#e5e7eb);display:flex;gap:1rem;">';
      if (entry.duration_minutes > 6) {
        html += '<button id="bhSplitBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;">Split this entry into two</button>';
      }
      // Merge: show dropdown of other drafts for the same matter
      var mergeTargets = _entries.filter(function (e) {
        return e.id !== entry.id && e.status === 'draft' && e.matter_id === entry.matter_id;
      });
      if (mergeTargets.length > 0) {
        html += '<div style="display:flex;align-items:center;gap:0.25rem;">';
        html += '<span style="font-size:0.75rem;color:var(--lex-color-blue-600);">Merge with:</span>';
        html += '<select id="bhMergeTarget" style="font-size:0.75rem;padding:0.125rem 0.25rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;">';
        for (var mi = 0; mi < mergeTargets.length; mi++) {
          var mt = mergeTargets[mi];
          var mtHours = ((mt.duration_minutes || 0) / 60).toFixed(1);
          var mtLabel = mtHours + 'h — ' + (mt.activity_type || 'general');
          html += '<option value="' + mt.id + '">' + Lex.Utils.escapeHtml(mtLabel) + '</option>';
        }
        html += '</select>';
        html += '<button id="bhMergeBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;font-weight:600;">Merge</button>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Activity source data
    if (entry.source_segment_data && Array.isArray(entry.source_segment_data) && entry.source_segment_data.length > 0) {
      html += '<div>';
      html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Source Activities (' + entry.source_segment_data.length + ')</div>';
      html += '<div style="max-height:8rem;overflow-y:auto;font-size:0.75rem;background:var(--lex-bg-muted,#f9fafb);border-radius:0.375rem;padding:0.5rem;">';
      for (var si = 0; si < entry.source_segment_data.length && si < 15; si++) {
        var seg = entry.source_segment_data[si];
        html += '<div style="color:var(--lex-text-secondary);">' + Lex.Utils.escapeHtml((seg.type || 'event') + (seg.resourceName ? ': ' + seg.resourceName : '')) + '</div>';
      }
      if (entry.source_segment_data.length > 15) {
        html += '<div style="color:var(--lex-text-muted);font-style:italic;">+' + (entry.source_segment_data.length - 15) + ' more</div>';
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';

    // Build footer buttons
    var buttons = [];
    if (isDraft) {
      buttons.push({ label: 'Approve', variant: 'primary', id: 'bhModalApproveBtn' });
      buttons.push({ label: 'Reject', variant: 'danger', id: 'bhModalRejectBtn' });
    }

    Lex.Drawer.open({
      heading: 'Time Entry — ' + hours + 'h ' + Lex.Utils.escapeHtml(entry.activity_type || ''),
      content: html,
      width: 'lg',
      buttons: buttons
    });

    // Wire modal actions after drawer opens
    setTimeout(function () {
      var approveBtn = document.getElementById('bhModalApproveBtn');
      if (approveBtn) {
        approveBtn.addEventListener('click', function () {
          _saveAndApprove(entry);
        });
      }

      var rejectBtn = document.getElementById('bhModalRejectBtn');
      if (rejectBtn) {
        rejectBtn.addEventListener('click', function () {
          _confirmReject(entry.id);
        });
      }

      var regenBtn = document.getElementById('bhRegenDescBtn');
      if (regenBtn) {
        regenBtn.addEventListener('click', function () {
          regenBtn.textContent = 'Generating...';
          regenBtn.disabled = true;
          api.post('/api/v1/billable-hours/drafts/' + entry.id + '/regenerate')
            .then(function (result) {
              if (result && result.data && result.data.description) {
                var textarea = document.getElementById('bhEditDescription');
                if (textarea) textarea.value = result.data.description;
              }
              regenBtn.textContent = 'Regenerate description with AI';
              regenBtn.disabled = false;
            })
            .catch(function () {
              regenBtn.textContent = 'Failed — try again';
              regenBtn.disabled = false;
            });
        });
      }

      var splitBtn = document.getElementById('bhSplitBtn');
      if (splitBtn) {
        splitBtn.addEventListener('click', function () {
          var halfMinutes = Math.floor(entry.duration_minutes / 2);
          api.post('/api/v1/billable-hours/drafts/' + entry.id + '/split', { split_minutes: halfMinutes })
            .then(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry split into two');
              if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
              _refresh();
            })
            .catch(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to split entry');
            });
        });
      }

      var mergeBtn = document.getElementById('bhMergeBtn');
      if (mergeBtn) {
        mergeBtn.addEventListener('click', function () {
          var select = document.getElementById('bhMergeTarget');
          if (!select || !select.value) return;
          api.post('/api/v1/billable-hours/drafts/' + entry.id + '/merge', { merge_with_id: select.value })
            .then(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entries merged');
              if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
              _refresh();
            })
            .catch(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to merge entries');
            });
        });
      }
    }, 100);
  }

  function _saveAndApprove(entry) {
    var textarea = document.getElementById('bhEditDescription');
    var hoursInput = document.getElementById('bhEditHours');
    var updates = {};

    if (textarea && textarea.value !== entry.description) {
      updates.description = textarea.value;
    }
    if (hoursInput) {
      var newMinutes = Math.round(parseFloat(hoursInput.value) * 60);
      if (newMinutes > 0 && newMinutes !== entry.duration_minutes) {
        updates.duration_minutes = newMinutes;
      }
    }

    if (Object.keys(updates).length > 0) {
      api.patch('/api/v1/time-entries/' + entry.id, updates)
        .then(function () { _approveEntry(entry.id); })
        .catch(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to save edits — entry not approved');
        });
    } else {
      _approveEntry(entry.id);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Generate Button
  // ═══════════════════════════════════════════════════════════════

  function _wireGenerateButton(matter) {
    var btn = document.getElementById('bhGenerateBtn');
    if (!btn || btn._bhWired) return;
    btn._bhWired = true;

    btn.addEventListener('click', function () {
      btn.textContent = 'Generating...';
      btn.disabled = true;

      var today = new Date().toISOString().substring(0, 10);
      api.post('/api/v1/billable-hours/generate', { date: today })
        .then(function (result) {
          var data = result && result.data;
          var count = (data && data.generated) || 0;
          btn.textContent = 'Generate for Today';
          btn.disabled = false;
          if (count > 0) {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success(count + ' draft' + (count !== 1 ? 's' : '') + ' generated');
          } else {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.info('No new billable activity found');
          }
          _refresh();
        })
        .catch(function () {
          btn.textContent = 'Generate for Today';
          btn.disabled = false;
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Generation failed');
        });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Manual Entry
  // ═══════════════════════════════════════════════════════════════

  function _wireManualEntryButton(matter) {
    var btn = document.getElementById('bhAddManualBtn');
    if (!btn || btn._bhWired) return;
    btn._bhWired = true;

    btn.addEventListener('click', function () {
      _showManualEntryForm(matter);
    });
  }

  function _showManualEntryForm(matter) {
    var today = new Date().toISOString().substring(0, 10);
    var inputStyle = 'width:100%;padding:0.375rem 0.625rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.8125rem;';

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">';
    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Date</label>';
    html += '<input type="date" id="manualEntryDate" value="' + today + '" style="' + inputStyle + '"></div>';
    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Hours</label>';
    html += '<input type="number" id="manualEntryHours" value="0.5" step="0.1" min="0.1" max="24" style="' + inputStyle + '"></div>';
    html += '</div>';

    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Activity Type</label>';
    html += '<select id="manualEntryType" style="' + inputStyle + '">';
    html += '<option value="general">General</option>';
    html += '<option value="research">Research</option>';
    html += '<option value="review">Review</option>';
    html += '<option value="drafting">Drafting</option>';
    html += '<option value="communication">Communication</option>';
    html += '<option value="case_management">Case Management</option>';
    html += '</select></div>';

    html += '<div><label style="font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;">Description</label>';
    html += '<textarea id="manualEntryDesc" style="' + inputStyle + 'min-height:4rem;resize:vertical;" placeholder="Describe the work performed..."></textarea></div>';

    html += '<div style="display:flex;align-items:center;gap:0.5rem;">';
    html += '<input type="checkbox" id="manualEntryBillable" checked>';
    html += '<label for="manualEntryBillable" style="font-size:0.8125rem;color:var(--lex-text-secondary);">Billable</label>';
    html += '</div>';

    html += '</div>';

    Lex.Drawer.open({
      heading: 'Add Time Entry',
      content: html,
      width: 'md',
      buttons: [
        { label: 'Add Entry', variant: 'primary', id: 'manualEntrySaveBtn' }
      ]
    });

    setTimeout(function () {
      var saveBtn = document.getElementById('manualEntrySaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var dateVal = document.getElementById('manualEntryDate').value;
          var hoursVal = parseFloat(document.getElementById('manualEntryHours').value) || 0.5;
          var typeVal = document.getElementById('manualEntryType').value;
          var descVal = document.getElementById('manualEntryDesc').value.trim();
          var billableVal = document.getElementById('manualEntryBillable').checked;

          if (!descVal) {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Description is required');
            return;
          }

          var body = {
            matter_id: _matterId,
            staff_user_id: window._currentUserId || '',
            date: dateVal,
            duration_minutes: Math.round(hoursVal * 60),
            activity_type: typeVal,
            description: descVal,
            is_billable: billableVal,
            rate: 0
          };

          api.post('/api/v1/time-entries', body)
            .then(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Time entry added');
              if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
              _refresh();
            })
            .catch(function () {
              if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to add entry');
            });
        });
      }
    }, 100);
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function _refresh() {
    _loadEntries({ matter_id: _matterId });
    _loadSummary({ matter_id: _matterId });
  }

  function _formatMoney(amount) {
    if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

})();

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
  var ADMIN_BILLABLE_ROLES = ['system_admin', 'org_admin', 'organization_admin', 'admin'];

  /**
   * Render the billable hours tab for a matter.
   * Called by switchMatterTab('billableHours') in workspace-details.js.
   */
  window.renderBillableHoursTab = function (matter) {
    _matterId = matter.matter_id;
    _currentPage = 1;
    _selectedIds = {};

    // If the caller deep-linked with `bhFrom` / `bhTo` (e.g. the dashboard
    // widget's "Review" button on a draft), honour that window so the row
    // they came to review is actually visible. Falls back to "current month
    // → today (UTC)" when no override is provided.
    var navFrom = '';
    var navTo = '';
    if (window.Lex && Lex.Nav && typeof Lex.Nav.getParams === 'function') {
      var p = Lex.Nav.getParams();
      navFrom = (p && p.get('bhFrom')) || '';
      navTo = (p && p.get('bhTo')) || '';
    }

    if (navFrom && navTo) {
      _dateFrom = navFrom;
      _dateTo = navTo;
    } else {
      var now = new Date();
      _dateFrom = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
      _dateTo = now.toISOString().substring(0, 10);
    }

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
    url = _appendAdminScope(url);

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
    url = _appendAdminScope(url);

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

      // Source badge (Auto / Manual / Imported) — surfaces the row's
      // origin so users can tell auto-tracked time from manually entered
      // time at a glance.
      var sourceBadge = _getSourceBadge(e.source);
      if (sourceBadge) {
        html += '<div title="' + Lex.Utils.escapeHtml(sourceBadge.title) + '" style="flex-shrink:0;padding:0.125rem 0.5rem;border-radius:9999px;font-size:0.65rem;font-weight:600;background:' + sourceBadge.bg + ';color:' + sourceBadge.text + ';">' + Lex.Utils.escapeHtml(sourceBadge.label) + '</div>';
      }

      // Overlap warning — flagged when this entry overlaps another on the
      // same (user, matter, day). Clicking the badge expands an inline panel
      // beneath the row showing the conflicting entries with resolve actions
      // (see _toggleOverlapPanel / _renderOverlapPanel below).
      var overlaps = Array.isArray(e.has_overlap_with) ? e.has_overlap_with : [];
      if (overlaps.length > 0) {
        var overlapTitle = 'Overlaps ' + overlaps.length + ' other ' + (overlaps.length === 1 ? 'entry' : 'entries') + ' — click to resolve';
        html += '<button type="button" class="bh-overlap-badge" data-id="' + Lex.Utils.escapeHtml(e.id) + '" title="' + Lex.Utils.escapeHtml(overlapTitle) + '" style="flex-shrink:0;padding:0.125rem 0.5rem;border-radius:9999px;font-size:0.65rem;font-weight:600;background:var(--lex-color-amber-50,#fffbeb);color:var(--lex-color-amber-700,#b45309);border:1px solid var(--lex-color-amber-200,#fde68a);cursor:pointer;font-family:inherit;">⚠ Overlap</button>';
      }

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

      // Inline overlap-resolution panel — hidden until the user clicks the
      // ⚠ Overlap badge on this row. Rendered as a sibling of the row so
      // the row's hover/striping styles aren't disturbed.
      if (overlaps.length > 0) {
        html += '<div class="bh-overlap-panel" data-for-id="' + Lex.Utils.escapeHtml(e.id) + '" style="display:none;padding:0.75rem 1rem 0.875rem 3rem;background:var(--lex-color-amber-50,#fffbeb);border-bottom:1px solid var(--lex-color-amber-200,#fde68a);"></div>';
      }
    }
    return html;
  }

  function _appendAdminScope(url) {
    if (_isAdminBillableHoursUser()) {
      return url + '&all_users=true';
    }
    return url;
  }

  function _isAdminBillableHoursUser() {
    var user = null;
    if (typeof api !== 'undefined' && api && api.user) {
      user = api.user;
    }
    if (!user && typeof Lex !== 'undefined' && Lex.state && Lex.state.user) {
      user = Lex.state.user;
    }
    if (!user) {
      try {
        var stored = localStorage.getItem('user');
        user = stored ? JSON.parse(stored) : null;
      } catch (e) {
        user = null;
      }
    }
    if (!user) return false;

    if (_isAdminRole(user.role_name || user.role)) return true;

    var roles = user.roles || user.role_names || [];
    if (!Array.isArray(roles)) roles = [roles];
    for (var i = 0; i < roles.length; i++) {
      if (_isAdminRole(roles[i])) return true;
    }

    return false;
  }

  function _isAdminRole(role) {
    var roleName = '';
    if (typeof role === 'string') {
      roleName = role;
    } else if (role && typeof role === 'object') {
      roleName = role.name || role.role_name || role.role || '';
    }
    roleName = String(roleName).toLowerCase();
    return ADMIN_BILLABLE_ROLES.indexOf(roleName) !== -1;
  }

  // ─────────────────────────────────────────────────────────────
  // Overlap resolution
  // ─────────────────────────────────────────────────────────────
  // Build the inline panel content for a row. Resolves the UUIDs in
  // has_overlap_with against the already-loaded _entries array (no extra
  // fetches). For each overlap we show hours, truncated description, source
  // badge, a "Jump to" link and a Resolve dropdown.
  function _renderOverlapPanel(entry) {
    var ids = Array.isArray(entry.has_overlap_with) ? entry.has_overlap_with : [];
    var others = ids
      .map(function (id) { return _entries.find(function (en) { return en.id === id; }); })
      .filter(function (x) { return !!x; });

    var html = '';
    html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-color-amber-800,#92400e);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Overlapping entries (' + ids.length + ')</div>';

    if (others.length === 0) {
      // Backend listed UUIDs not present in the current page — likely a row
      // outside the current pagination/date filter. Tell the user rather
      // than silently rendering nothing.
      html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">';
      html += 'Overlapping entries are outside the current filter. Adjust the date range or pagination to see them.';
      html += '</div>';
      return html;
    }

    html += '<div style="display:flex;flex-direction:column;gap:0.5rem;">';
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      var oHours = ((o.duration_minutes || 0) / 60).toFixed(1);
      var oDesc = o.description || 'No description';
      if (oDesc.length > 100) oDesc = oDesc.substring(0, 97) + '...';
      var oSource = _getSourceBadge(o.source);
      var canMerge = entry.status === 'draft' && o.status === 'draft' && entry.matter_id === o.matter_id;

      html += '<div class="bh-overlap-item" data-id="' + Lex.Utils.escapeHtml(o.id) + '" style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.625rem;background:white;border:1px solid var(--lex-color-amber-200,#fde68a);border-radius:0.375rem;">';

      html += '<div style="min-width:2.75rem;text-align:center;padding:0.125rem 0.375rem;background:var(--lex-bg-accent-subtle,#eff6ff);border-radius:0.25rem;font-size:0.75rem;font-weight:700;color:var(--lex-color-blue-700,#1d4ed8);">' + oHours + 'h</div>';

      html += '<div style="flex:1;min-width:0;">';
      html += '<div style="font-size:0.75rem;color:var(--lex-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + Lex.Utils.escapeHtml(oDesc) + '</div>';
      html += '<div style="font-size:0.65rem;color:var(--lex-text-muted);">' + Lex.Utils.escapeHtml(o.activity_type || 'general') + ' • ' + Lex.Utils.escapeHtml(o.status || 'draft') + '</div>';
      html += '</div>';

      if (oSource) {
        html += '<div title="' + Lex.Utils.escapeHtml(oSource.title) + '" style="flex-shrink:0;padding:0.125rem 0.375rem;border-radius:9999px;font-size:0.6rem;font-weight:600;background:' + oSource.bg + ';color:' + oSource.text + ';">' + Lex.Utils.escapeHtml(oSource.label) + '</div>';
      }

      html += '<button type="button" class="bh-overlap-jump" data-id="' + Lex.Utils.escapeHtml(o.id) + '" style="flex-shrink:0;padding:0.125rem 0.375rem;font-size:0.65rem;font-weight:600;background:none;color:var(--lex-color-blue-600,#2563eb);border:1px solid var(--lex-color-blue-200,#bfdbfe);border-radius:0.25rem;cursor:pointer;">Jump to</button>';

      html += '<button type="button" class="bh-overlap-resolve" data-source-id="' + Lex.Utils.escapeHtml(entry.id) + '" data-other-id="' + Lex.Utils.escapeHtml(o.id) + '" data-can-merge="' + (canMerge ? '1' : '0') + '" style="flex-shrink:0;padding:0.125rem 0.5rem;font-size:0.65rem;font-weight:600;background:var(--lex-color-amber-100,#fef3c7);color:var(--lex-color-amber-800,#92400e);border:1px solid var(--lex-color-amber-300,#fcd34d);border-radius:0.25rem;cursor:pointer;">Resolve ▾</button>';

      html += '</div>'; // .bh-overlap-item
    }
    html += '</div>';

    return html;
  }

  // Open or close the inline overlap panel for the row whose badge was
  // clicked. Only one panel is open at a time per row, but multiple rows can
  // be expanded simultaneously.
  function _toggleOverlapPanel(entryId) {
    var listEl = document.getElementById('bhEntriesList');
    if (!listEl) return;
    var panel = listEl.querySelector('.bh-overlap-panel[data-for-id="' + cssEscape(entryId) + '"]');
    if (!panel) return;
    var entry = _entries.find(function (en) { return en.id === entryId; });
    if (!entry) return;

    if (panel.style.display === 'none' || panel.style.display === '') {
      panel.innerHTML = _renderOverlapPanel(entry);
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
      panel.innerHTML = '';
    }
  }

  // Smooth-scroll the list to the row identified by entry id and briefly
  // highlight it so the user can see where they landed.
  function _jumpToRow(entryId) {
    var listEl = document.getElementById('bhEntriesList');
    if (!listEl) return;
    var row = listEl.querySelector('.bh-entry-row[data-entry-id="' + cssEscape(entryId) + '"]');
    if (!row) return;
    if (typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    var prevBg = row.style.background;
    row.style.transition = 'background 0.4s';
    row.style.background = 'var(--lex-color-amber-100,#fef3c7)';
    setTimeout(function () {
      row.style.background = prevBg;
    }, 1200);
  }

  // Show a small chooser popover for the Resolve button. The popover offers
  // three actions:
  //   • Keep both       — close the chooser, no API call (informational)
  //   • Delete this overlap — POST .../drafts/<otherId>/reject
  //   • Merge into other  — POST .../drafts/<sourceId>/merge { merge_with_id: otherId }
  // "Merge" is only offered when both entries are drafts on the same matter.
  function _showResolveChooser(anchorEl, sourceId, otherId, canMerge) {
    // Tear down any existing open chooser first.
    var existing = document.getElementById('bhResolveChooser');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var rect = anchorEl.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.id = 'bhResolveChooser';
    pop.style.cssText = [
      'position:fixed',
      'top:' + (rect.bottom + 4) + 'px',
      'left:' + Math.max(8, rect.right - 200) + 'px',
      'min-width:200px',
      'background:white',
      'border:1px solid var(--lex-border-default,#e5e7eb)',
      'border-radius:0.5rem',
      'box-shadow:0 8px 24px rgba(0,0,0,0.12)',
      'z-index:10000',
      'padding:0.25rem',
      'font-size:0.8125rem'
    ].join(';');

    function makeItem(label, danger) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.cssText = [
        'display:block',
        'width:100%',
        'text-align:left',
        'padding:0.4rem 0.625rem',
        'background:none',
        'border:none',
        'border-radius:0.25rem',
        'cursor:pointer',
        'font-size:0.8125rem',
        'color:' + (danger ? 'var(--lex-color-red-700,#b91c1c)' : 'var(--lex-text-primary)')
      ].join(';');
      btn.addEventListener('mouseover', function () {
        btn.style.background = danger ? 'var(--lex-color-red-50,#fef2f2)' : 'var(--lex-bg-muted,#f9fafb)';
      });
      btn.addEventListener('mouseout', function () { btn.style.background = 'none'; });
      return btn;
    }

    var keepBtn = makeItem('Keep both', false);
    keepBtn.addEventListener('click', function () { closeChooser(); });
    pop.appendChild(keepBtn);

    var deleteBtn = makeItem('Delete this overlap', true);
    deleteBtn.addEventListener('click', function () {
      closeChooser();
      _resolveDelete(otherId);
    });
    pop.appendChild(deleteBtn);

    if (canMerge) {
      var mergeBtn = makeItem('Merge into the other', false);
      mergeBtn.addEventListener('click', function () {
        closeChooser();
        _resolveMerge(sourceId, otherId);
      });
      pop.appendChild(mergeBtn);
    }

    function closeChooser() {
      if (pop.parentNode) pop.parentNode.removeChild(pop);
      document.removeEventListener('click', outsideHandler, true);
    }
    function outsideHandler(ev) {
      if (!pop.contains(ev.target)) closeChooser();
    }
    // Defer attaching the outside-click handler until the current click event
    // has finished propagating, otherwise we'd close immediately.
    setTimeout(function () {
      document.addEventListener('click', outsideHandler, true);
    }, 0);

    document.body.appendChild(pop);
  }

  function _resolveDelete(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/reject')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Overlapping entry deleted');
        delete _selectedIds[entryId];
        _refresh();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Failed to delete overlap';
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  function _resolveMerge(sourceId, otherId) {
    api.post('/api/v1/billable-hours/drafts/' + sourceId + '/merge', { merge_with_id: otherId })
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entries merged');
        _refresh();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Failed to merge entries';
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  // Minimal CSS attribute-selector escaper. UUIDs don't need escaping but
  // we guard against unexpected characters to keep querySelector safe.
  function cssEscape(s) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\' + c; });
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

  // Source-of-row badge: 'activity' rows came from the incremental writer,
  // 'manual' rows from a user-created entry, 'imported' from a connector
  // ingest. Returns null for unknown values so the UI quietly degrades.
  function _getSourceBadge(source) {
    var map = {
      activity: { label: 'Auto',     title: 'Auto-tracked from activity',           bg: 'var(--lex-bg-muted,#f3f4f6)',          text: 'var(--lex-text-muted,#6b7280)' },
      manual:   { label: 'Manual',   title: 'Manually entered by user',             bg: 'var(--lex-color-blue-50,#eff6ff)',     text: 'var(--lex-color-blue-700,#1d4ed8)' },
      imported: { label: 'Imported', title: 'Imported from external system',        bg: 'var(--lex-color-purple-50,#faf5ff)',   text: 'var(--lex-color-purple-700,#7e22ce)' }
    };
    return map[source] || null;
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

      // Overlap badge → toggle inline panel beneath this row.
      var overlapBadge = e.target.closest('.bh-overlap-badge');
      if (overlapBadge) {
        e.stopPropagation();
        _toggleOverlapPanel(overlapBadge.getAttribute('data-id'));
        return;
      }

      // "Jump to" link inside an overlap panel → scroll/highlight the other row.
      var jumpBtn = e.target.closest('.bh-overlap-jump');
      if (jumpBtn) {
        e.stopPropagation();
        _jumpToRow(jumpBtn.getAttribute('data-id'));
        return;
      }

      // "Resolve ▾" → open the chooser popover for this overlap pair.
      var resolveBtn = e.target.closest('.bh-overlap-resolve');
      if (resolveBtn) {
        e.stopPropagation();
        _showResolveChooser(
          resolveBtn,
          resolveBtn.getAttribute('data-source-id'),
          resolveBtn.getAttribute('data-other-id'),
          resolveBtn.getAttribute('data-can-merge') === '1'
        );
        return;
      }

      // Clicks inside an open overlap panel shouldn't bubble up to "open
      // detail modal" — the panel is supposed to be a quiet inline UI.
      if (e.target.closest('.bh-overlap-panel')) {
        e.stopPropagation();
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
    // Owners can edit drafts AND submitted entries. Approved entries are
    // locked for owners; only admins can edit those (admin route).
    var isOwnerEditable = entry.status === 'draft' || entry.status === 'submitted';

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';

    // Hours + Activity type
    html += '<div style="display:flex;gap:1rem;align-items:center;">';
    if (isOwnerEditable) {
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
    if (isOwnerEditable) {
      html += '<textarea id="bhEditDescription" style="width:100%;min-height:4rem;padding:0.5rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.875rem;font-family:inherit;resize:vertical;">' + Lex.Utils.escapeHtml(entry.description || '') + '</textarea>';
      if (isDraft) {
        html += '<div style="display:flex;gap:0.5rem;margin-top:0.25rem;">';
        html += '<button id="bhRegenDescBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;">Regenerate description with AI</button>';
        html += '</div>';
      }
    } else {
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);padding:0.5rem;background:var(--lex-bg-muted,#f9fafb);border-radius:0.375rem;">' + Lex.Utils.escapeHtml(entry.description || 'No description') + '</div>';
    }
    html += '</div>';

    // Details grid — rate becomes editable when entry is owner-editable
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    var fields = [
      { label: 'Status', value: entry.status },
      { label: 'Billing Code', value: entry.billing_code || '-' },
      { label: 'Duration', value: entry.duration_minutes + ' minutes (' + hours + 'h)' },
      { label: 'Billable', value: entry.is_billable ? 'Yes' : 'No' },
      { label: 'Source', value: entry.source || 'manual' }
    ];
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      html += '<div>';
      html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">' + Lex.Utils.escapeHtml(f.label) + '</div>';
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(f.value) + '</div>';
      html += '</div>';
    }
    // Rate cell
    html += '<div>';
    html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">Rate</div>';
    if (isOwnerEditable) {
      var rateVal = entry.hourly_rate != null ? String(entry.hourly_rate) : '';
      html += '<div style="display:flex;align-items:center;gap:0.25rem;font-size:0.875rem;">';
      html += '$<input type="number" id="bhEditRate" value="' + Lex.Utils.escapeHtml(rateVal) + '" step="0.01" min="0" placeholder="0.00" style="width:6rem;padding:0.25rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;font-size:0.875rem;">/hr';
      html += '</div>';
    } else {
      html += '<div style="font-size:0.875rem;color:var(--lex-text-primary);">' + (entry.hourly_rate ? '$' + entry.hourly_rate + '/hr' : 'Not set') + '</div>';
    }
    html += '</div>';
    html += '</div>';

    // Audit-history link — every entry can have history once it has been
    // edited; we surface the link regardless and let the endpoint return [].
    html += '<div style="padding-top:0.25rem;">';
    html += '<button id="bhHistoryBtn" style="font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;text-decoration:underline;">View edit history</button>';
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
    } else if (isOwnerEditable) {
      // Submitted: owner can save edits without resubmitting; admin handles
      // the approval transition from /admin/approve/:id.
      buttons.push({ label: 'Save changes', variant: 'primary', id: 'bhModalSaveBtn' });
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

      var saveBtn = document.getElementById('bhModalSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          _saveOnly(entry);
        });
      }

      var historyBtn = document.getElementById('bhHistoryBtn');
      if (historyBtn) {
        historyBtn.addEventListener('click', function () {
          _openHistoryDrawer(entry.id);
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

  // Collect modal field values into a PATCH payload. Only changed fields
  // are included so the audit diff stays meaningful.
  function _collectModalUpdates(entry) {
    var textarea = document.getElementById('bhEditDescription');
    var hoursInput = document.getElementById('bhEditHours');
    var rateInput = document.getElementById('bhEditRate');
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
    if (rateInput) {
      var raw = rateInput.value;
      if (raw === '' || raw === null) {
        if (entry.hourly_rate != null) updates.hourly_rate = null;
      } else {
        var num = parseFloat(raw);
        if (!isNaN(num) && num >= 0 && num !== parseFloat(entry.hourly_rate)) {
          updates.hourly_rate = num;
        }
      }
    }
    return updates;
  }

  function _saveAndApprove(entry) {
    var updates = _collectModalUpdates(entry);

    if (Object.keys(updates).length > 0) {
      api.patch('/api/v1/billable-hours/drafts/' + entry.id, updates)
        .then(function () { _approveEntry(entry.id); })
        .catch(function () {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to save edits — entry not approved');
        });
    } else {
      _approveEntry(entry.id);
    }
  }

  function _saveOnly(entry) {
    var updates = _collectModalUpdates(entry);
    if (Object.keys(updates).length === 0) {
      if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.info('No changes to save');
      return;
    }
    api.patch('/api/v1/billable-hours/drafts/' + entry.id, updates)
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Changes saved');
        if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
        _refresh();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Failed to save changes';
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
      });
  }

  // Audit-history viewer. Renders a chronological list of edit events with
  // before/after diffs so owners can see what their admins changed (and
  // admins can see what they themselves changed).
  function _openHistoryDrawer(entryId) {
    api.get('/api/v1/billable-hours/entries/' + entryId + '/history')
      .then(function (resp) {
        var rows = (resp && resp.data) || [];
        var html = '<div style="display:flex;flex-direction:column;gap:0.75rem;">';
        if (rows.length === 0) {
          html += '<div style="font-size:0.875rem;color:var(--lex-text-muted);padding:1rem;text-align:center;">No edits recorded for this entry yet.</div>';
        } else {
          for (var i = 0; i < rows.length; i++) {
            html += _renderHistoryRow(rows[i]);
          }
        }
        html += '</div>';
        Lex.Drawer.open({
          heading: 'Edit history',
          content: html,
          width: 'md',
          buttons: []
        });
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to load edit history');
      });
  }

  function _renderHistoryRow(row) {
    var details = row.details || {};
    var diff = details.diff || {};
    var when = row.created_at ? Lex.Utils.formatDateTime(row.created_at) : '-';
    var actor = (row.first_name || row.last_name) ? ((row.first_name || '') + ' ' + (row.last_name || '')).trim() : (row.email || row.user_id || 'Unknown');
    var roleLabel = details.actor_role === 'admin' ? 'Admin' : 'Owner';
    var flag = details.post_approval_edit ? ' <span style="font-size:0.7rem;color:var(--lex-color-amber-700,#b45309);font-weight:600;">[post-approval]</span>' : '';

    var html = '<div style="border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;padding:0.75rem;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(actor) + ' <span style="font-size:0.7rem;color:var(--lex-text-muted);font-weight:400;">(' + roleLabel + ')</span>' + flag + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">' + Lex.Utils.escapeHtml(when) + '</div>';
    html += '</div>';

    var keys = Object.keys(diff);
    if (keys.length === 0) {
      html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">No field changes recorded.</div>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:0.25rem;font-size:0.75rem;">';
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var d = diff[key] || {};
        var before = d.before === null || d.before === undefined ? '—' : String(d.before);
        var after = d.after === null || d.after === undefined ? '—' : String(d.after);
        html += '<div>';
        html += '<span style="font-weight:600;color:var(--lex-text-primary);">' + Lex.Utils.escapeHtml(key) + ':</span> ';
        html += '<span style="color:var(--lex-text-muted);text-decoration:line-through;">' + Lex.Utils.escapeHtml(before) + '</span> ';
        html += '<span style="color:var(--lex-text-muted);">→</span> ';
        html += '<span style="color:var(--lex-color-blue-700,#1d4ed8);">' + Lex.Utils.escapeHtml(after) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
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

  // ─────────────────────────────────────────────────────────────
  // Manual entry form
  //
  // Backed by POST /api/v1/billable-hours/manual which creates a row with
  // source='manual'. Body accepts EITHER duration_minutes OR (start_time,
  // end_time) — we let the user pick which pair to fill via a tab toggle.
  // The form is rendered inside the standard Lex.Drawer; on success we
  // surface any overlap metadata in the toast so the user knows to triage.
  // ─────────────────────────────────────────────────────────────
  function _showManualEntryForm(matter) {
    var inputStyle = 'width:100%;padding:0.375rem 0.625rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.8125rem;font-family:inherit;';
    var labelStyle = 'font-size:0.75rem;font-weight:600;color:var(--lex-text-muted);display:block;margin-bottom:0.25rem;';

    // Default start/end to "now minus 30 min" → "now" so the inputs are pre-filled.
    var now = Lex.Utils.nowDate();
    var nowStr = _toDatetimeLocal(now);
    var halfHourAgoStr = _toDatetimeLocal(Lex.Utils.addMinutes(now, -30));

    var matterIdForForm = (matter && matter.matter_id) || _matterId || '';
    var hasPresetMatter = !!matterIdForForm;

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';

    // Matter (locked when in workspace context)
    html += '<div>';
    html += '<label style="' + labelStyle + '">Matter</label>';
    if (hasPresetMatter) {
      html += '<input type="text" id="manualEntryMatterId" value="' + Lex.Utils.escapeHtml(matterIdForForm) + '" readonly style="' + inputStyle + 'background:var(--lex-bg-muted,#f9fafb);color:var(--lex-text-muted);font-family:monospace;">';
      html += '<div style="font-size:0.7rem;color:var(--lex-text-muted);margin-top:0.25rem;">Using current matter context</div>';
    } else {
      // Fallback: free-text input. Workspace details page is always scoped to
      // a matter, so this branch is unlikely to be hit — but we keep it as a
      // safety net rather than silently failing.
      html += '<input type="text" id="manualEntryMatterId" placeholder="Matter ID (UUID)" style="' + inputStyle + '">';
    }
    html += '</div>';

    // Description
    html += '<div>';
    html += '<label style="' + labelStyle + '">Description <span style="color:var(--lex-color-red-600,#dc2626);">*</span></label>';
    html += '<textarea id="manualEntryDesc" style="' + inputStyle + 'min-height:4.5rem;resize:vertical;" placeholder="Describe the work performed..."></textarea>';
    html += '</div>';

    // Time mode toggle: duration vs start/end
    html += '<div>';
    html += '<label style="' + labelStyle + '">Time</label>';
    html += '<div role="tablist" style="display:flex;gap:0.25rem;margin-bottom:0.5rem;">';
    html += '<button type="button" id="manualEntryModeDuration" data-mode="duration" style="flex:1;padding:0.375rem;font-size:0.75rem;font-weight:600;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;background:var(--lex-color-blue-600,#2563eb);color:white;cursor:pointer;">Duration</button>';
    html += '<button type="button" id="manualEntryModeRange"    data-mode="range"    style="flex:1;padding:0.375rem;font-size:0.75rem;font-weight:600;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;background:white;color:var(--lex-text-secondary);cursor:pointer;">Start / End</button>';
    html += '</div>';

    // Duration pane
    html += '<div id="manualEntryDurationPane">';
    html += '<input type="number" id="manualEntryMinutes" value="30" step="1" min="1" max="1440" style="' + inputStyle + '" placeholder="Minutes">';
    html += '<div style="font-size:0.7rem;color:var(--lex-text-muted);margin-top:0.25rem;">Duration in minutes</div>';
    html += '</div>';

    // Range pane
    html += '<div id="manualEntryRangePane" style="display:none;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    html += '<div>';
    html += '<label style="' + labelStyle + '">Start</label>';
    html += '<input type="datetime-local" id="manualEntryStart" value="' + halfHourAgoStr + '" style="' + inputStyle + '">';
    html += '</div>';
    html += '<div>';
    html += '<label style="' + labelStyle + '">End</label>';
    html += '<input type="datetime-local" id="manualEntryEnd" value="' + nowStr + '" style="' + inputStyle + '">';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // Activity type
    html += '<div>';
    html += '<label style="' + labelStyle + '">Activity Type</label>';
    html += '<select id="manualEntryType" style="' + inputStyle + '">';
    html += '<option value="general">General</option>';
    html += '<option value="research">Research</option>';
    html += '<option value="review">Review</option>';
    html += '<option value="drafting">Drafting</option>';
    html += '<option value="communication">Communication</option>';
    html += '<option value="case_management">Case Management</option>';
    html += '</select>';
    html += '</div>';

    // Two-column row for billing code + rate
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    html += '<div>';
    html += '<label style="' + labelStyle + '">Billing Code</label>';
    html += '<input type="text" id="manualEntryBillingCode" style="' + inputStyle + '" placeholder="Optional">';
    html += '</div>';
    html += '<div>';
    html += '<label style="' + labelStyle + '">Hourly Rate</label>';
    html += '<input type="number" id="manualEntryRate" step="0.01" min="0" style="' + inputStyle + '" placeholder="Optional">';
    html += '</div>';
    html += '</div>';

    // Billable checkbox
    html += '<div style="display:flex;align-items:center;gap:0.5rem;">';
    html += '<input type="checkbox" id="manualEntryBillable" checked style="cursor:pointer;">';
    html += '<label for="manualEntryBillable" style="font-size:0.8125rem;color:var(--lex-text-secondary);cursor:pointer;">Billable</label>';
    html += '</div>';

    // Inline error region (populated from API validation failures)
    html += '<div id="manualEntryError" style="display:none;padding:0.5rem 0.75rem;background:var(--lex-color-red-50,#fef2f2);border:1px solid var(--lex-color-red-200,#fecaca);border-radius:0.375rem;color:var(--lex-color-red-700,#b91c1c);font-size:0.75rem;"></div>';

    html += '</div>';

    Lex.Drawer.open({
      heading: 'New Time Entry',
      content: html,
      width: 'md',
      buttons: [
        { label: 'Create', variant: 'primary', id: 'manualEntrySaveBtn' }
      ]
    });

    setTimeout(function () {
      // Mode toggle wiring
      var durBtn = document.getElementById('manualEntryModeDuration');
      var rangeBtn = document.getElementById('manualEntryModeRange');
      var durPane = document.getElementById('manualEntryDurationPane');
      var rangePane = document.getElementById('manualEntryRangePane');
      var currentMode = 'duration';

      function setMode(mode) {
        currentMode = mode;
        if (mode === 'duration') {
          durPane.style.display = '';
          rangePane.style.display = 'none';
          durBtn.style.background = 'var(--lex-color-blue-600,#2563eb)';
          durBtn.style.color = 'white';
          rangeBtn.style.background = 'white';
          rangeBtn.style.color = 'var(--lex-text-secondary)';
        } else {
          durPane.style.display = 'none';
          rangePane.style.display = 'grid';
          rangeBtn.style.background = 'var(--lex-color-blue-600,#2563eb)';
          rangeBtn.style.color = 'white';
          durBtn.style.background = 'white';
          durBtn.style.color = 'var(--lex-text-secondary)';
        }
      }

      if (durBtn) durBtn.addEventListener('click', function () { setMode('duration'); });
      if (rangeBtn) rangeBtn.addEventListener('click', function () { setMode('range'); });

      var saveBtn = document.getElementById('manualEntrySaveBtn');
      if (!saveBtn) return;

      saveBtn.addEventListener('click', function () {
        var matterIdEl = document.getElementById('manualEntryMatterId');
        var descEl = document.getElementById('manualEntryDesc');
        var typeEl = document.getElementById('manualEntryType');
        var billableEl = document.getElementById('manualEntryBillable');
        var billingCodeEl = document.getElementById('manualEntryBillingCode');
        var rateEl = document.getElementById('manualEntryRate');
        var errorEl = document.getElementById('manualEntryError');

        function showError(msg) {
          if (!errorEl) return;
          errorEl.textContent = msg;
          errorEl.style.display = 'block';
        }
        function clearError() {
          if (!errorEl) return;
          errorEl.textContent = '';
          errorEl.style.display = 'none';
        }
        clearError();

        var matterIdVal = matterIdEl ? (matterIdEl.value || '').trim() : '';
        var descVal = descEl ? descEl.value.trim() : '';
        var typeVal = typeEl ? typeEl.value : 'general';
        var billableVal = billableEl ? billableEl.checked : true;
        var billingCodeVal = billingCodeEl ? billingCodeEl.value.trim() : '';
        var rateRaw = rateEl ? rateEl.value : '';

        if (!matterIdVal) { showError('Matter is required'); return; }
        if (!descVal) { showError('Description is required'); return; }

        var body = {
          matter_id: matterIdVal,
          description: descVal,
          activity_type: typeVal,
          is_billable: billableVal
        };

        if (currentMode === 'duration') {
          var minutesEl = document.getElementById('manualEntryMinutes');
          var minutesVal = minutesEl ? parseInt(minutesEl.value, 10) : NaN;
          if (!minutesVal || minutesVal <= 0) {
            showError('Duration must be a positive number of minutes');
            return;
          }
          body.duration_minutes = minutesVal;
        } else {
          var startEl = document.getElementById('manualEntryStart');
          var endEl = document.getElementById('manualEntryEnd');
          var startVal = startEl ? startEl.value : '';
          var endVal = endEl ? endEl.value : '';
          if (!startVal || !endVal) {
            showError('Both start and end are required');
            return;
          }
          var startIso = new Date(startVal).toISOString();
          var endIso = new Date(endVal).toISOString();
          if (new Date(endIso) <= new Date(startIso)) {
            showError('End time must be after start time');
            return;
          }
          body.start_time = startIso;
          body.end_time = endIso;
        }

        if (billingCodeVal) body.billing_code = billingCodeVal;
        if (rateRaw !== '' && rateRaw !== null) {
          var rateNum = parseFloat(rateRaw);
          if (!isNaN(rateNum) && rateNum >= 0) body.hourly_rate = rateNum;
        }

        saveBtn.disabled = true;
        var originalLabel = saveBtn.textContent;
        saveBtn.textContent = 'Creating...';

        api.post('/api/v1/billable-hours/manual', body)
          .then(function (result) {
            var meta = (result && result.metadata) || {};
            var overlaps = Array.isArray(meta.overlapsWith) ? meta.overlapsWith : [];
            if (typeof Lex !== 'undefined' && Lex.Toast) {
              if (overlaps.length > 0) {
                Lex.Toast.success('Entry created — overlaps ' + overlaps.length + ' other entr' + (overlaps.length === 1 ? 'y' : 'ies') + ' on this matter');
              } else {
                Lex.Toast.success('Time entry created');
              }
            }
            if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
            _refresh();
          })
          .catch(function (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalLabel;
            // ApiError carries a message; surface server-side validation
            // detail directly in the form so the user can fix it inline.
            var msg = (err && err.message) || 'Failed to create entry';
            if (err && err.data) {
              var errDetail = err.data.error && err.data.error.message;
              if (errDetail) msg = errDetail;
              else if (err.data.detail) msg = err.data.detail;
            }
            showError(msg);
          });
      });
    }, 100);
  }

  // Convert a Date to the value format expected by <input type="datetime-local">
  // ("YYYY-MM-DDTHH:MM" in local time). Native toISOString returns UTC, so we
  // build the string component-wise to keep it in the user's locale.
  function _toDatetimeLocal(d) {
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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

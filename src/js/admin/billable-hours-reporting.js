/**
 * Admin Billable Hours Reporting
 * Firm-wide billable hours management with by-attorney, by-matter views
 * and an approval queue for submitted entries.
 */

(function () {
  'use strict';

  var _dateFrom = '';
  var _dateTo = '';
  var _activeTab = 'attorneys';
  var _approvalSelectedIds = {};
  var _approvalEntriesById = {};

  // ═══════════════════════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════════════════════

  function init() {
    // Default to this month
    var now = new Date();
    _dateFrom = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
    _dateTo = now.toISOString().substring(0, 10);

    var fromInput = document.getElementById('bhAdminDateFrom');
    var toInput = document.getElementById('bhAdminDateTo');
    if (fromInput) fromInput.value = _dateFrom;
    if (toInput) toInput.value = _dateTo;

    _wirePeriodPresets();
    _wireApplyDates();
    _wireTabSwitching();
    _loadAll();
  }

  // ═══════════════════════════════════════════════════════════════
  // Period Presets
  // ═══════════════════════════════════════════════════════════════

  function _wirePeriodPresets() {
    var container = document.getElementById('bhAdminPeriod');
    if (!container) return;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-preset]');
      if (!btn) return;

      var preset = btn.getAttribute('data-preset');
      var now = new Date();
      var from, to;

      if (preset === 'last7days') {
        to = now.toISOString().substring(0, 10);
        var d7 = new Date(now); d7.setDate(d7.getDate() - 7);
        from = d7.toISOString().substring(0, 10);
      } else if (preset === 'last30days') {
        to = now.toISOString().substring(0, 10);
        var d30 = new Date(now); d30.setDate(d30.getDate() - 30);
        from = d30.toISOString().substring(0, 10);
      } else if (preset === 'thisMonth') {
        from = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
        to = now.toISOString().substring(0, 10);
      } else if (preset === 'thisQuarter') {
        var qm = Math.floor(now.getMonth() / 3) * 3;
        from = now.getFullYear() + '-' + String(qm + 1).padStart(2, '0') + '-01';
        to = now.toISOString().substring(0, 10);
      }

      if (from && to) {
        _dateFrom = from;
        _dateTo = to;
        var fromInput = document.getElementById('bhAdminDateFrom');
        var toInput = document.getElementById('bhAdminDateTo');
        if (fromInput) fromInput.value = from;
        if (toInput) toInput.value = to;

        // Update active button styling
        var btns = container.querySelectorAll('[data-preset]');
        for (var i = 0; i < btns.length; i++) {
          btns[i].setAttribute('variant', btns[i] === btn ? 'primary' : 'secondary');
        }

        _loadAll();
      }
    });
  }

  function _wireApplyDates() {
    var applyBtn = document.getElementById('bhAdminApplyDates');
    if (!applyBtn) return;

    applyBtn.addEventListener('click', function () {
      var fromInput = document.getElementById('bhAdminDateFrom');
      var toInput = document.getElementById('bhAdminDateTo');
      _dateFrom = fromInput ? fromInput.value : '';
      _dateTo = toInput ? toInput.value : '';
      _loadAll();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Tabs
  // ═══════════════════════════════════════════════════════════════

  function _wireTabSwitching() {
    var tabBar = document.getElementById('bhAdminTabs');
    if (!tabBar) return;

    tabBar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;

      _activeTab = btn.getAttribute('data-tab');

      // Update tab styles
      var tabs = tabBar.querySelectorAll('[data-tab]');
      for (var i = 0; i < tabs.length; i++) {
        var isActive = tabs[i] === btn;
        tabs[i].style.borderBottomColor = isActive ? 'var(--lex-color-blue-600,#2563eb)' : 'transparent';
        tabs[i].style.color = isActive ? 'var(--lex-color-blue-600,#2563eb)' : 'var(--lex-text-muted)';
      }

      // Show/hide content
      var containers = { attorneys: 'bhAdminTabAttorneys', matters: 'bhAdminTabMatters', approvals: 'bhAdminTabApprovals' };
      var keys = Object.keys(containers);
      for (var ci = 0; ci < keys.length; ci++) {
        var el = document.getElementById(containers[keys[ci]]);
        if (el) el.classList.toggle('hidden', keys[ci] !== _activeTab);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // Load All
  // ═══════════════════════════════════════════════════════════════

  function _loadAll() {
    _loadSummary();
    _loadAttorneys();
    _loadMatters();
    _loadApprovalQueue();
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════

  function _loadSummary() {
    var container = document.getElementById('bhAdminSummary');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse" style="grid-column:1/-1;"><div class="cc-skeleton" style="height:3rem;width:100%;"></div></div>';

    var url = '/api/v1/billable-hours/admin/summary?';
    if (_dateFrom) url += 'date_from=' + encodeURIComponent(_dateFrom) + '&';
    if (_dateTo) url += 'date_to=' + encodeURIComponent(_dateTo);

    api.get(url)
      .then(function (result) {
        var d = (result && result.data) || {};
        var utilization = d.total_hours > 0 ? Math.round(d.billable_hours / d.total_hours * 100) : 0;

        var cards = [
          { label: 'Total Hours', value: (d.total_hours || 0).toFixed(1) + 'h', color: '' },
          { label: 'Billable Hours', value: (d.billable_hours || 0).toFixed(1) + 'h', color: '' },
          { label: 'Billable Amount', value: '$' + _formatMoney(d.billable_amount || 0), color: '' },
          { label: 'Utilization', value: utilization + '%', color: utilization >= 70 ? 'var(--lex-color-green-600,#16a34a)' : 'var(--lex-color-amber-600,#d97706)' },
          { label: 'Attorneys', value: d.users_active || 0, color: '' },
          { label: 'Matters Worked', value: d.matters_worked || 0, color: '' },
          { label: 'Pending Approval', value: (d.by_status && d.by_status.submitted) || 0, color: 'var(--lex-color-amber-600,#d97706)' },
          { label: 'Approved', value: (d.by_status && d.by_status.approved) || 0, color: 'var(--lex-color-green-600,#16a34a)' }
        ];

        var html = '';
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          html += '<div style="background:var(--lex-bg-muted,#f9fafb);border-radius:0.5rem;padding:0.75rem 1rem;">';
          html += '<div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;letter-spacing:0.05em;">' + _escapeHtml(c.label) + '</div>';
          html += '<div style="font-size:1.25rem;font-weight:700;' + (c.color ? 'color:' + c.color + ';' : '') + '">' + c.value + '</div>';
          html += '</div>';
        }
        container.innerHTML = html;
      })
      .catch(function () {
        container.innerHTML = '<div style="color:var(--lex-text-muted);font-size:0.8rem;grid-column:1/-1;">Unable to load summary</div>';
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // By Attorney
  // ═══════════════════════════════════════════════════════════════

  function _loadAttorneys() {
    var container = document.getElementById('bhAdminTabAttorneys');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse"><div class="cc-skeleton" style="height:12rem;width:100%;"></div></div>';

    var url = '/api/v1/billable-hours/admin/by-attorney?limit=50';
    if (_dateFrom) url += '&date_from=' + encodeURIComponent(_dateFrom);
    if (_dateTo) url += '&date_to=' + encodeURIComponent(_dateTo);

    api.get(url)
      .then(function (result) {
        var entries = (result && result.data) || [];
        if (entries.length === 0) {
          container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--lex-text-muted);font-size:0.875rem;">No billable hours data for this period.</div>';
          return;
        }

        var html = '<div style="border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.5rem;overflow:hidden;">';

        // Header
        html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:0.5rem;padding:0.625rem 1rem;background:var(--lex-bg-muted,#f9fafb);font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">';
        html += '<div>Attorney</div><div style="text-align:right;">Total Hours</div><div style="text-align:right;">Billable</div><div style="text-align:right;">Amount</div><div style="text-align:right;">Drafts</div><div style="text-align:right;">Approved</div>';
        html += '</div>';

        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          var bg = i % 2 === 1 ? 'background:var(--lex-bg-muted,#f9fafb);' : '';
          html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:0.5rem;padding:0.625rem 1rem;font-size:0.8125rem;' + bg + '">';
          html += '<div style="font-weight:600;color:var(--lex-text-primary);">' + _escapeHtml(e.name || e.email) + '</div>';
          html += '<div style="text-align:right;">' + e.total_hours.toFixed(1) + 'h</div>';
          html += '<div style="text-align:right;font-weight:600;color:var(--lex-color-blue-700,#1d4ed8);">' + e.billable_hours.toFixed(1) + 'h</div>';
          html += '<div style="text-align:right;">$' + _formatMoney(e.billable_amount) + '</div>';
          html += '<div style="text-align:right;">' + e.draft_count + '</div>';
          html += '<div style="text-align:right;color:var(--lex-color-green-600,#16a34a);">' + e.approved_count + '</div>';
          html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
      })
      .catch(function () {
        container.innerHTML = '<div style="color:var(--lex-text-muted);font-size:0.8rem;">Failed to load attorney data.</div>';
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // By Matter
  // ═══════════════════════════════════════════════════════════════

  function _loadMatters() {
    var container = document.getElementById('bhAdminTabMatters');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse"><div class="cc-skeleton" style="height:12rem;width:100%;"></div></div>';

    var url = '/api/v1/billable-hours/admin/by-matter?limit=50';
    if (_dateFrom) url += '&date_from=' + encodeURIComponent(_dateFrom);
    if (_dateTo) url += '&date_to=' + encodeURIComponent(_dateTo);

    api.get(url)
      .then(function (result) {
        var entries = (result && result.data) || [];
        if (entries.length === 0) {
          container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--lex-text-muted);font-size:0.875rem;">No billable hours data for this period.</div>';
          return;
        }

        var html = '<div style="border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.5rem;overflow:hidden;">';

        // Header
        html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:0.5rem;padding:0.625rem 1rem;background:var(--lex-bg-muted,#f9fafb);font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;">';
        html += '<div>Matter</div><div>Client</div><div style="text-align:right;">Attorneys</div><div style="text-align:right;">Hours</div><div style="text-align:right;">Billable</div><div style="text-align:right;">Amount</div>';
        html += '</div>';

        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          var bg = i % 2 === 1 ? 'background:var(--lex-bg-muted,#f9fafb);' : '';
          html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:0.5rem;padding:0.625rem 1rem;font-size:0.8125rem;' + bg + '">';
          html += '<div style="font-weight:600;color:var(--lex-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escapeHtml(e.matter_name) + '</div>';
          html += '<div style="color:var(--lex-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escapeHtml(e.client_name) + '</div>';
          html += '<div style="text-align:right;">' + e.attorneys + '</div>';
          html += '<div style="text-align:right;">' + e.total_hours.toFixed(1) + 'h</div>';
          html += '<div style="text-align:right;font-weight:600;color:var(--lex-color-blue-700,#1d4ed8);">' + e.billable_hours.toFixed(1) + 'h</div>';
          html += '<div style="text-align:right;">$' + _formatMoney(e.billable_amount) + '</div>';
          html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
      })
      .catch(function () {
        container.innerHTML = '<div style="color:var(--lex-text-muted);font-size:0.8rem;">Failed to load matter data.</div>';
      });
  }

  // ═══════════════════════════════════════════════════════════════
  // Approval Queue
  // ═══════════════════════════════════════════════════════════════

  function _loadApprovalQueue() {
    var container = document.getElementById('bhAdminTabApprovals');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse"><div class="cc-skeleton" style="height:12rem;width:100%;"></div></div>';

    var url = '/api/v1/billable-hours/admin/approval-queue?limit=50';
    if (_dateFrom) url += '&date_from=' + encodeURIComponent(_dateFrom);
    if (_dateTo) url += '&date_to=' + encodeURIComponent(_dateTo);

    api.get(url)
      .then(function (result) {
        var entries = (result && result.data) || [];
        if (entries.length === 0) {
          container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--lex-text-muted);font-size:0.875rem;">No entries pending approval.</div>';
          return;
        }

        _approvalSelectedIds = {};

        var html = '';

        // Bulk actions bar
        html += '<div id="bhApprovalBulkBar" style="display:none;margin-bottom:0.75rem;gap:0.5rem;align-items:center;">';
        html += '<lex-btn id="bhApprovalBulkApprove" variant="primary" size="sm">Approve Selected</lex-btn>';
        html += '<span id="bhApprovalSelectedCount" style="font-size:0.75rem;color:var(--lex-text-muted);"></span>';
        html += '</div>';

        html += '<div style="border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.5rem;overflow:hidden;">';

        // Header
        var GRID = '2rem 1.4fr 1.4fr 0.7fr 0.7fr 1.7fr 12rem';
        html += '<div style="display:grid;grid-template-columns:' + GRID + ';gap:0.5rem;padding:0.625rem 1rem;background:var(--lex-bg-muted,#f9fafb);font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;align-items:center;">';
        html += '<div><input type="checkbox" id="bhApprovalSelectAll" style="cursor:pointer;"></div>';
        html += '<div>Attorney</div><div>Matter</div><div style="text-align:right;">Hours</div><div>Type</div><div>Description</div><div></div>';
        html += '</div>';

        // Store entries by id for the edit drawer (needs full row data).
        _approvalEntriesById = {};

        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          _approvalEntriesById[e.id] = e;
          var hours = ((e.duration_minutes || 0) / 60).toFixed(1);
          var name = ((e.first_name || '') + ' ' + (e.last_name || '')).trim() || e.email || '';
          var bg = i % 2 === 1 ? 'background:var(--lex-bg-muted,#f9fafb);' : '';
          var desc = e.description || '';
          if (desc.length > 80) desc = desc.substring(0, 77) + '...';

          var safeId = _escapeHtml(e.id);
          html += '<div class="bh-approval-row" data-id="' + safeId + '" style="display:grid;grid-template-columns:' + GRID + ';gap:0.5rem;padding:0.625rem 1rem;font-size:0.8125rem;align-items:center;' + bg + '">';
          html += '<div><input type="checkbox" class="bh-approval-cb" data-id="' + safeId + '" style="cursor:pointer;"></div>';
          html += '<div style="font-weight:600;">' + _escapeHtml(name) + '</div>';
          html += '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escapeHtml(e.matter_name || e.matter_id) + '</div>';
          html += '<div style="text-align:right;font-weight:600;color:var(--lex-color-blue-700,#1d4ed8);">' + hours + 'h</div>';
          html += '<div style="color:var(--lex-text-muted);">' + _escapeHtml(e.activity_type || '-') + '</div>';
          html += '<div style="color:var(--lex-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _escapeHtml(desc) + '</div>';
          html += '<div style="display:flex;gap:0.25rem;justify-content:flex-end;">';
          html += '<button class="bh-approval-edit-btn" data-id="' + safeId + '" style="padding:0.25rem 0.5rem;font-size:0.75rem;font-weight:600;background:#fff;color:var(--lex-text-primary);border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;cursor:pointer;">Edit</button>';
          html += '<button class="bh-approval-history-btn" data-id="' + safeId + '" style="padding:0.25rem 0.5rem;font-size:0.75rem;font-weight:600;background:#fff;color:var(--lex-text-primary);border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;cursor:pointer;">History</button>';
          html += '<button class="bh-approval-approve-btn" data-id="' + safeId + '" style="padding:0.25rem 0.625rem;font-size:0.75rem;font-weight:600;background:var(--lex-color-green-50,#f0fdf4);color:var(--lex-color-green-700,#15803d);border:1px solid var(--lex-color-green-200,#bbf7d0);border-radius:0.25rem;cursor:pointer;">Approve</button>';
          html += '</div>';
          html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;

        _wireApprovalActions(container);
      })
      .catch(function () {
        container.innerHTML = '<div style="color:var(--lex-text-muted);font-size:0.8rem;">Failed to load approval queue.</div>';
      });
  }

  function _wireApprovalActions(container) {
    // Individual action buttons
    container.addEventListener('click', function (e) {
      var approveBtn = e.target.closest('.bh-approval-approve-btn');
      if (approveBtn) {
        var id = approveBtn.getAttribute('data-id');
        approveBtn.textContent = '...';
        approveBtn.disabled = true;
        api.post('/api/v1/billable-hours/admin/approve/' + id)
          .then(function () {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry approved');
            _loadApprovalQueue();
            _loadSummary();
          })
          .catch(function () {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to approve');
            approveBtn.textContent = 'Approve';
            approveBtn.disabled = false;
          });
        return;
      }

      var editBtn = e.target.closest('.bh-approval-edit-btn');
      if (editBtn) {
        var editId = editBtn.getAttribute('data-id');
        var entry = _approvalEntriesById[editId];
        if (entry) _openAdminEditDrawer(entry);
        return;
      }

      var historyBtn = e.target.closest('.bh-approval-history-btn');
      if (historyBtn) {
        var histId = historyBtn.getAttribute('data-id');
        _openAdminHistoryDrawer(histId);
        return;
      }
    });

    // Checkboxes
    container.addEventListener('change', function (e) {
      if (e.target.classList.contains('bh-approval-cb')) {
        var id = e.target.getAttribute('data-id');
        if (e.target.checked) {
          _approvalSelectedIds[id] = true;
        } else {
          delete _approvalSelectedIds[id];
        }
        _updateApprovalBulkBar();
      }

      if (e.target.id === 'bhApprovalSelectAll') {
        var cbs = container.querySelectorAll('.bh-approval-cb');
        for (var ci = 0; ci < cbs.length; ci++) {
          cbs[ci].checked = e.target.checked;
          var cid = cbs[ci].getAttribute('data-id');
          if (e.target.checked) {
            _approvalSelectedIds[cid] = true;
          } else {
            delete _approvalSelectedIds[cid];
          }
        }
        _updateApprovalBulkBar();
      }
    });

    // Bulk approve
    var bulkBtn = document.getElementById('bhApprovalBulkApprove');
    if (bulkBtn) {
      bulkBtn.addEventListener('click', function () {
        var ids = Object.keys(_approvalSelectedIds);
        if (ids.length === 0) return;

        bulkBtn.textContent = 'Approving...';
        bulkBtn.disabled = true;

        api.post('/api/v1/billable-hours/admin/bulk-approve', { ids: ids })
          .then(function (result) {
            var data = (result && result.data) || {};
            var approved = data.approved || 0;
            var failed = data.failed || 0;
            if (typeof Lex !== 'undefined' && Lex.Toast) {
              if (failed > 0) {
                Lex.Toast.warning(approved + ' approved, ' + failed + ' skipped (already processed or error)');
              } else {
                Lex.Toast.success(approved + ' entries approved');
              }
            }
            _approvalSelectedIds = {};
            _loadApprovalQueue();
            _loadSummary();
          })
          .catch(function () {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Bulk approve failed');
            bulkBtn.textContent = 'Approve Selected';
            bulkBtn.disabled = false;
          });
      });
    }
  }

  function _updateApprovalBulkBar() {
    var bar = document.getElementById('bhApprovalBulkBar');
    var countEl = document.getElementById('bhApprovalSelectedCount');
    var count = Object.keys(_approvalSelectedIds).length;

    if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = count + ' selected';
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  function _escapeHtml(text) {
    if (!text) return '';
    if (typeof Lex !== 'undefined' && Lex.Utils && Lex.Utils.escapeHtml) {
      return Lex.Utils.escapeHtml(text);
    }
    var str = String(text);
    var result = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '&') result += '&amp;';
      else if (ch === '<') result += '&lt;';
      else if (ch === '>') result += '&gt;';
      else if (ch === '"') result += '&quot;';
      else result += ch;
    }
    return result;
  }

  function _formatMoney(amount) {
    if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ═══════════════════════════════════════════════════════════════
  // Admin Edit & History Drawers
  // ═══════════════════════════════════════════════════════════════

  function _openAdminEditDrawer(entry) {
    var hours = ((entry.duration_minutes || 0) / 60).toFixed(2);
    var rate = entry.hourly_rate != null ? String(entry.hourly_rate) : '';
    var desc = entry.description || '';

    var html = '<div style="display:flex;flex-direction:column;gap:1rem;">';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">Editing <strong>' + _escapeHtml(((entry.first_name || '') + ' ' + (entry.last_name || '')).trim() || entry.email || entry.user_id) + '</strong>’s entry on <strong>' + _escapeHtml(entry.matter_name || entry.matter_id) + '</strong>. This action is audited.</div>';

    html += '<div><div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Description</div>';
    html += '<textarea id="bhAdminEditDescription" style="width:100%;min-height:4rem;padding:0.5rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;font-size:0.875rem;font-family:inherit;resize:vertical;">' + _escapeHtml(desc) + '</textarea></div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">';
    html += '<div><div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Hours</div>';
    html += '<input type="number" id="bhAdminEditHours" value="' + _escapeHtml(hours) + '" step="0.1" min="0.1" max="24" style="width:100%;padding:0.375rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;font-size:0.875rem;"></div>';
    html += '<div><div style="font-size:0.7rem;font-weight:600;color:var(--lex-text-muted);text-transform:uppercase;margin-bottom:0.25rem;">Rate ($/hr)</div>';
    html += '<input type="number" id="bhAdminEditRate" value="' + _escapeHtml(rate) + '" step="0.01" min="0" placeholder="0.00" style="width:100%;padding:0.375rem;border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.25rem;font-size:0.875rem;"></div>';
    html += '</div>';

    if (entry.status === 'approved') {
      html += '<div style="padding:0.5rem 0.75rem;background:var(--lex-color-amber-50,#fffbeb);color:var(--lex-color-amber-800,#92400e);border:1px solid var(--lex-color-amber-200,#fde68a);border-radius:0.375rem;font-size:0.75rem;">This entry is already approved. Changes will be logged as a post-approval correction for payroll and finance.</div>';
    }

    html += '</div>';

    Lex.Drawer.open({
      heading: 'Edit time entry',
      content: html,
      width: 'md',
      buttons: [{ label: 'Save changes', variant: 'primary', id: 'bhAdminEditSaveBtn' }]
    });

    setTimeout(function () {
      var saveBtn = document.getElementById('bhAdminEditSaveBtn');
      if (!saveBtn) return;
      saveBtn.addEventListener('click', function () {
        var updates = {};
        var descEl = document.getElementById('bhAdminEditDescription');
        var hoursEl = document.getElementById('bhAdminEditHours');
        var rateEl = document.getElementById('bhAdminEditRate');
        if (descEl && descEl.value !== (entry.description || '')) updates.description = descEl.value;
        if (hoursEl) {
          var newMinutes = Math.round(parseFloat(hoursEl.value) * 60);
          if (newMinutes > 0 && newMinutes !== entry.duration_minutes) {
            updates.duration_minutes = newMinutes;
          }
        }
        if (rateEl) {
          var raw = rateEl.value;
          if (raw === '' || raw === null) {
            if (entry.hourly_rate != null) updates.hourly_rate = null;
          } else {
            var num = parseFloat(raw);
            if (!isNaN(num) && num >= 0 && num !== parseFloat(entry.hourly_rate)) {
              updates.hourly_rate = num;
            }
          }
        }

        if (Object.keys(updates).length === 0) {
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.info('No changes to save');
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        api.patch('/api/v1/billable-hours/admin/entries/' + entry.id, updates)
          .then(function () {
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry updated');
            if (typeof Lex !== 'undefined' && Lex.Drawer) Lex.Drawer.close();
            _loadApprovalQueue();
            _loadSummary();
            _loadAttorneys();
            _loadMatters();
          })
          .catch(function (err) {
            var msg = (err && err.message) || 'Failed to update entry';
            if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error(msg);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save changes';
          });
      });
    }, 50);
  }

  function _openAdminHistoryDrawer(entryId) {
    api.get('/api/v1/billable-hours/entries/' + entryId + '/history')
      .then(function (resp) {
        var rows = (resp && resp.data) || [];
        var html = '<div style="display:flex;flex-direction:column;gap:0.75rem;">';
        if (rows.length === 0) {
          html += '<div style="font-size:0.875rem;color:var(--lex-text-muted);padding:1rem;text-align:center;">No edits recorded for this entry yet.</div>';
        } else {
          for (var i = 0; i < rows.length; i++) {
            html += _renderAdminHistoryRow(rows[i]);
          }
        }
        html += '</div>';
        Lex.Drawer.open({ heading: 'Edit history', content: html, width: 'md', buttons: [] });
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to load edit history');
      });
  }

  function _renderAdminHistoryRow(row) {
    var details = row.details || {};
    var diff = details.diff || {};
    var when = row.created_at ? (typeof Lex !== 'undefined' && Lex.Utils ? Lex.Utils.formatDateTime(row.created_at) : row.created_at) : '-';
    var actor = (row.first_name || row.last_name) ? ((row.first_name || '') + ' ' + (row.last_name || '')).trim() : (row.email || row.user_id || 'Unknown');
    var roleLabel = details.actor_role === 'admin' ? 'Admin' : 'Owner';
    var flag = details.post_approval_edit ? ' <span style="font-size:0.7rem;color:var(--lex-color-amber-700,#b45309);font-weight:600;">[post-approval]</span>' : '';

    var html = '<div style="border:1px solid var(--lex-border-default,#e5e7eb);border-radius:0.375rem;padding:0.75rem;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">';
    html += '<div style="font-size:0.875rem;font-weight:600;color:var(--lex-text-primary);">' + _escapeHtml(actor) + ' <span style="font-size:0.7rem;color:var(--lex-text-muted);font-weight:400;">(' + roleLabel + ')</span>' + flag + '</div>';
    html += '<div style="font-size:0.75rem;color:var(--lex-text-muted);">' + _escapeHtml(when) + '</div>';
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
        html += '<span style="font-weight:600;color:var(--lex-text-primary);">' + _escapeHtml(key) + ':</span> ';
        html += '<span style="color:var(--lex-text-muted);text-decoration:line-through;">' + _escapeHtml(before) + '</span> ';
        html += '<span style="color:var(--lex-text-muted);">→</span> ';
        html += '<span style="color:var(--lex-color-blue-700,#1d4ed8);">' + _escapeHtml(after) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════════
  // Boot
  // ═══════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

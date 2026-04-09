/**
 * Workspace Billable Hours Tab
 * Renders summary metrics, time entry list, and review/approve modal
 * for a specific matter's billable hours.
 */

(function () {
  'use strict';

  var _matterId = null;
  var _entries = [];

  /**
   * Render the billable hours tab for a matter.
   * Called by switchMatterTab('billableHours') in workspace-details.js.
   */
  window.renderBillableHoursTab = function (matter) {
    _matterId = matter.matter_id;
    _loadSummary(matter);
    _loadEntries(matter);
    _wireGenerateButton(matter);
  };

  // ═══════════════════════════════════════════════════════════════
  // Summary Card
  // ═══════════════════════════════════════════════════════════════

  function _loadSummary(matter) {
    var container = document.getElementById('bhSummaryCard');
    if (!container) return;

    container.innerHTML = '<div class="animate-pulse" style="grid-column:1/-1;"><div class="cc-skeleton" style="height:3rem;width:100%;"></div></div>';

    api.get('/api/v1/billable-hours/summary?matter_id=' + encodeURIComponent(matter.matter_id))
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
      { label: 'Billable Amount', value: '$' + (data.billable_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), suffix: '' },
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
      html += '<div style="font-size:1.25rem;font-weight:700;color:' + valueColor + ';">' + c.value + c.suffix + '</div>';
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

    api.get('/api/v1/billable-hours/drafts?matter_id=' + encodeURIComponent(matter.matter_id) + '&status=all&limit=50')
      .then(function (result) {
        _entries = (result && result.data) || [];
        if (loadingEl) loadingEl.classList.add('hidden');

        if (_entries.length === 0) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          return;
        }

        listEl.classList.remove('hidden');
        listEl.innerHTML = _buildEntriesList(_entries);
        _wireEntryActions();
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
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var hours = ((e.duration_minutes || 0) / 60).toFixed(1);
      var date = e.start_time ? Lex.Utils.formatDateTime(e.start_time, { dateOnly: true }) : '-';
      var statusColor = _getStatusColor(e.status);
      var description = e.description || 'No description';
      if (description.length > 120) description = description.substring(0, 117) + '...';

      var bgStyle = i % 2 === 1 ? 'background:var(--lex-bg-muted,#f9fafb);' : '';

      html += '<div class="bh-entry-row" data-entry-id="' + e.id + '" style="' + bgStyle + 'display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background=\'var(--lex-bg-accent-subtle,#eff6ff)\'" onmouseout="this.style.background=\'' + (i % 2 === 1 ? 'var(--lex-bg-muted,#f9fafb)' : '') + '\'">';

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
        html += '<button class="bh-approve-btn" data-id="' + e.id + '" style="padding:0.25rem 0.5rem;font-size:0.7rem;font-weight:600;background:var(--lex-color-green-50,#f0fdf4);color:var(--lex-color-green-700,#15803d);border:1px solid var(--lex-color-green-200,#bbf7d0);border-radius:0.25rem;cursor:pointer;">Approve</button>';
        html += '<button class="bh-reject-btn" data-id="' + e.id + '" style="padding:0.25rem 0.5rem;font-size:0.7rem;font-weight:600;background:var(--lex-color-red-50,#fef2f2);color:var(--lex-color-red-700,#b91c1c);border:1px solid var(--lex-color-red-200,#fecaca);border-radius:0.25rem;cursor:pointer;">Reject</button>';
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
  // Entry Actions (approve, reject, click to edit)
  // ═══════════════════════════════════════════════════════════════

  function _wireEntryActions() {
    var listEl = document.getElementById('bhEntriesList');
    if (!listEl) return;

    listEl.addEventListener('click', function (e) {
      var approveBtn = e.target.closest('.bh-approve-btn');
      if (approveBtn) {
        e.stopPropagation();
        _approveEntry(approveBtn.getAttribute('data-id'));
        return;
      }

      var rejectBtn = e.target.closest('.bh-reject-btn');
      if (rejectBtn) {
        e.stopPropagation();
        _rejectEntry(rejectBtn.getAttribute('data-id'));
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
  }

  function _approveEntry(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/approve')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry approved');
        _loadEntries({ matter_id: _matterId });
        _loadSummary({ matter_id: _matterId });
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to approve entry');
      });
  }

  function _rejectEntry(entryId) {
    api.post('/api/v1/billable-hours/drafts/' + entryId + '/reject')
      .then(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.success('Entry rejected');
        _loadEntries({ matter_id: _matterId });
        _loadSummary({ matter_id: _matterId });
      })
      .catch(function () {
        if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Failed to reject entry');
      });
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
    html += '<div style="font-size:2rem;font-weight:700;color:var(--lex-color-blue-700,#1d4ed8);">' + hours + 'h</div>';
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
      html += '<button id="bhRegenDescBtn" style="margin-top:0.25rem;font-size:0.75rem;color:var(--lex-color-blue-600);cursor:pointer;background:none;border:none;padding:0;">Regenerate description with AI</button>';
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
          // Save edited description first
          var textarea = document.getElementById('bhEditDescription');
          if (textarea && textarea.value !== entry.description) {
            api.put('/api/v1/time-entries/' + entry.id, { description: textarea.value })
              .then(function () { _approveEntry(entry.id); })
              .catch(function () { _approveEntry(entry.id); });
          } else {
            _approveEntry(entry.id);
          }
        });
      }

      var rejectBtn = document.getElementById('bhModalRejectBtn');
      if (rejectBtn) {
        rejectBtn.addEventListener('click', function () {
          _rejectEntry(entry.id);
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
    }, 100);
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
          _loadEntries(matter);
          _loadSummary(matter);
        })
        .catch(function () {
          btn.textContent = 'Generate for Today';
          btn.disabled = false;
          if (typeof Lex !== 'undefined' && Lex.Toast) Lex.Toast.error('Generation failed');
        });
    });
  }

})();

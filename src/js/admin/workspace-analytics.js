/* Workspace Analytics — Page controller for admin/workspace-analytics.html.
   Standalone page for per-matter workspace analytics. Extracted from the
   Workspace Analytics tab in reporting.js.

   Pattern: IIFE + direct init() call.
*/

(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    if (!str) return '';
    var s = String(str);
    return s
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  // ── State ──────────────────────────────────────────────────────────

  var matterPickerLoaded = false;
  var matterPickerListenerAttached = false;
  var currentMatterId = null;

  // ── Matter Picker ──────────────────────────────────────────────────

  function loadMatterPicker() {
    if (matterPickerLoaded) return;

    var picker = el('workspaceMatterPicker');
    if (!picker) return;

    // Attach the change listener exactly once.
    if (!matterPickerListenerAttached) {
      matterPickerListenerAttached = true;
      picker.addEventListener('change', function () {
        var matterId = this.value;
        currentMatterId = matterId;
        if (matterId) {
          loadWorkspaceAnalytics(matterId);
        } else {
          showEmpty();
        }
      });
    }

    matterPickerLoaded = true;

    api.get('/api/v1/matters?limit=100&sort=updated_at&order=desc')
      .then(function (response) {
        var matters = (response && response.data) || (response && response.matters) || [];
        matters.forEach(function (m) {
          var opt = document.createElement('option');
          opt.value = m.id || m.matter_id || '';
          opt.textContent = m.name || m.matter_number || String(opt.value);
          picker.appendChild(opt);
        });
        // Indicate truncation when the limit was reached
        if (matters.length >= 100) {
          var hint = el('matterPickerTruncationHint');
          if (!hint) {
            hint = document.createElement('p');
            hint.id = 'matterPickerTruncationHint';
            hint.style.cssText = 'font-size:0.7rem;color:#9ca3af;margin:0.25rem 0 0 0;';
            hint.textContent = 'Showing the 100 most recently updated matters.';
            picker.parentNode.appendChild(hint);
          }
        }
      })
      .catch(function (err) {
        console.error('[WorkspaceAnalytics] Failed to load matters:', err);
        // Reset so user can retry on next visit.
        matterPickerLoaded = false;
      });
  }

  // ── Analytics Loading ──────────────────────────────────────────────

  function loadWorkspaceAnalytics(matterId) {
    var cardsEl = el('workspaceAnalyticsCards');
    var emptyEl = el('workspaceAnalyticsEmpty');
    var errorEl = el('workspaceAnalyticsError');
    if (!cardsEl) return;

    if (emptyEl) emptyEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    cardsEl.style.display = 'grid';

    // Show skeleton placeholders while loading
    cardsEl.innerHTML = buildPlaceholders();

    api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/analytics')
      .then(function (response) {
        var data = (response && response.data) ? response.data : response;
        renderCards(data);
      })
      .catch(function (err) {
        console.error('[WorkspaceAnalytics] Failed to load analytics:', err);
        cardsEl.style.display = 'none';
        if (errorEl) errorEl.style.display = '';
      });
  }

  // ── Card Rendering ─────────────────────────────────────────────────

  function renderCards(data) {
    var cardsEl = el('workspaceAnalyticsCards');
    if (!cardsEl) return;

    var cards = [
      { label: 'Documents', value: String(data.documents_count || 0) },
      { label: 'Notes', value: String(data.notes_count || 0) },
      { label: 'Tasks', value: String(data.tasks_completed || 0) + ' / ' + String(data.tasks_total || 0), sublabel: 'completed' },
      { label: 'Overdue Tasks', value: String(data.tasks_overdue || 0), highlight: (data.tasks_overdue || 0) > 0 },
      { label: 'Hours Billed', value: parseFloat(data.time_total_hours || 0).toFixed(1) },
      { label: 'Contacts', value: String(data.contacts_count_org_level || 0), sublabel: 'org-wide' }
    ];

    var html = '';

    cards.forEach(function (card) {
      var borderStyle = card.highlight ? 'border-color:#ef4444;' : '';
      var valueColor = card.highlight ? 'color:#ef4444;' : 'color:#111827;';
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:0.5rem;padding:1rem;' + borderStyle + '">';
      html += '<p style="font-size:0.75rem;color:#6b7280;margin:0 0 0.25rem 0;">' + escapeHtml(card.label) + '</p>';
      html += '<p style="font-size:1.5rem;font-weight:600;margin:0;' + valueColor + '">' + escapeHtml(card.value) + '</p>';
      if (card.sublabel) {
        html += '<p style="font-size:0.675rem;color:#9ca3af;margin:0.125rem 0 0 0;">' + escapeHtml(card.sublabel) + '</p>';
      }
      html += '</div>';
    });

    // Last activity card
    if (data.last_activity_at) {
      var lastActivityLabel = Lex.Utils.formatRelativeDate(data.last_activity_at);
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:0.5rem;padding:1rem;">';
      html += '<p style="font-size:0.75rem;color:#6b7280;margin:0 0 0.25rem 0;">Last Activity</p>';
      html += '<p style="font-size:1.5rem;font-weight:600;margin:0;color:#111827;">' + escapeHtml(lastActivityLabel) + '</p>';
      html += '</div>';
    }

    cardsEl.innerHTML = html;
  }

  function buildPlaceholders() {
    var html = '';
    for (var i = 0; i < 7; i++) {
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:0.5rem;padding:1rem;">';
      html += '<div style="height:0.75rem;width:60%;background:#e5e7eb;border-radius:0.25rem;margin-bottom:0.5rem;"></div>';
      html += '<div style="height:1.5rem;width:40%;background:#e5e7eb;border-radius:0.25rem;"></div>';
      html += '</div>';
    }
    return html;
  }

  // ── View States ────────────────────────────────────────────────────

  function showEmpty() {
    var cardsEl = el('workspaceAnalyticsCards');
    var emptyEl = el('workspaceAnalyticsEmpty');
    var errorEl = el('workspaceAnalyticsError');
    if (cardsEl) cardsEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Gate: non-admins should not see workspace analytics.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    // Retry button
    var retryBtn = el('retryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        if (currentMatterId) {
          loadWorkspaceAnalytics(currentMatterId);
        }
      });
    }

    loadMatterPicker();
  }

  // ── Boot ───────────────────────────────────────────────────────────

  init();

})();

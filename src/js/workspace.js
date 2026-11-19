/* workspace.js — Workspaces page script (SPA lifecycle).
   The matters list: grid and list views, pins, create and edit.
   Uses LexRouter.registerView() for onEnter/onLeave lifecycle.

   Dependencies (loaded via page descriptor before this file):
     - feature-tracker, mammoth, conflict-detection, similar-matters-widget
     - analytics, metadata-formatter/service, marked, document-metadata-viewer
     - tiptap-bundle, matter-notes (api client + components)
*/
(function () {
  'use strict';

  // ── Lifecycle tracking ──────────────────────────────────────────────
  var _windowKeys = [];
  var _documentListeners = [];
  var _intervals = [];
  var _timeouts = [];

  // Track window globals for onLeave cleanup
  function _trackGlobal(name) {
    if (_windowKeys.indexOf(name) === -1) _windowKeys.push(name);
  }

  // Track a document-level listener so onLeave can remove it
  function trackDocListener(event, handler) {
    document.addEventListener(event, handler);
    _documentListeners.push({ event: event, handler: handler });
  }

  // Track a setInterval so onLeave can clear it
  function trackInterval(fn, ms) {
    var id = setInterval(fn, ms);
    _intervals.push(id);
    return id;
  }

  // Track a setTimeout so onLeave can clear it
  function trackTimeout(fn, ms) {
    var id = setTimeout(fn, ms);
    _timeouts.push(id);
    return id;
  }

  // ── Utility bridges (no regex) ──────────────────────────────────────

  // formatNumber: replaces the regex-based original with toLocaleString
  function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return Number(num).toLocaleString('en-US');
  }

  // isOrgAdmin: bridge to Lex.Auth singleton
  function isOrgAdmin() {
    return Lex.Auth.isAdmin();
  }

  // ── Page code ───────────────────────────────────────────────────────

    function initializePage() {

    // State
    let currentPage = 1; // The table's current page (pinned matters show on page 1)
    let selectedMatters = new Set(); // Track selected matter IDs
    let currentMatters = []; // Track currently displayed matters for "Select All"
    let matters = [];

    // Pinned matters pagination
    let pinnedPage = 1;
    const pinnedPageSize = 20;
    let allPinnedMatters = [];
    let totalPinnedCount = 0;
    let totalMattersCount = 0; // Grand total of matters for the toolbar count

    // Reflect the current matter total in the toolbar chip and section header.
    function updateMattersCount() {
      var label = formatNumber(totalMattersCount) +
        (totalMattersCount === 1 ? ' matter' : ' matters');
      var toolbarEl = document.getElementById('listSectionCount');
      if (toolbarEl) toolbarEl.textContent = label;
      var sectionEl = document.getElementById('mattersSectionCount');
      if (sectionEl) sectionEl.textContent = label;
    }

    // View mode: 'grid' or 'list', remembered per viewer.
    const VIEW_STORAGE_KEY = 'lana.matters.viewMode';
    let viewMode = 'list';
    try {
      if (window.localStorage.getItem(VIEW_STORAGE_KEY) === 'grid') viewMode = 'grid';
    } catch (e) { /* storage unavailable: list view */ }

    // Analytics: Track page view only once on initial load
    let hasTrackedPageView = false;

    // Security: HTML escaping to prevent XSS attacks
    // Uses string splitting and joining — no regex per project constraint.
    function escapeHtml(unsafe) {
      if (unsafe === null || unsafe === undefined) return '';
      return String(unsafe)
        .split('&').join('&amp;')
        .split('<').join('&lt;')
        .split('>').join('&gt;')
        .split('"').join('&quot;')
        .split("'").join('&#039;');
    }

    // Event attributes for markup built here (js/shared/dom-actions.js): the
    // action name plus its arguments as escaped JSON, never inline script.
    // Ids and names are passed as strings, as the old inline handlers did.
    function act(type, name, args, options) {
      return window.LanaDomActions.on(type, name, (args || []).map(function (value) {
        return typeof value === 'boolean' ? value : (value == null ? '' : String(value));
      }), options);
    }
    window.LanaDomActions.registerGlobals([
      'toggleMatterSelection', 'viewMatter', 'togglePin', 'loadMorePinnedMatters',
      'addUserToShare', 'removeUserFromShare', 'addWorkspaceUserToShare', 'removeWorkspaceUserFromShare'
    ]);
    window.LanaDomActions.register('clickCreateMatter', function () {
      var button = document.getElementById('createMatterBtn');
      if (button) button.click();
    });

    // Matter options menu (Edit / Archive or Unarchive / Delete) on grid
    // cards, list rows and pinned cards: a lex-dropdown-btn carrying the
    // matter id. The click stops at the host so the card does not open;
    // handleMatterOptionsSelect runs the item.
    function matterOptionsMenuHtml(matter, className) {
      var isArchived = matter.status === 'archived';
      var items = [
        { value: 'edit', label: 'Edit', icon: 'edit' },
        { value: isArchived ? 'unarchive' : 'archive', label: isArchived ? 'Unarchive' : 'Archive', icon: 'archive' },
        { divider: true },
        { value: 'delete', label: 'Delete', icon: 'trash-2', danger: true }
      ];
      return '<lex-dropdown-btn class="matter-options-menu' + (className ? ' ' + className : '') + '"' +
        ' data-matter-id="' + escapeHtml(matter.matter_id) + '" icon="more-vertical" icon-only variant="ghost" align="end" floating' +
        ' aria-label="More options" options="' + escapeHtml(JSON.stringify(items)) + '"' +
        act('click', null, [], { stop: true }) + '></lex-dropdown-btn>';
    }

    // Helper function to render a single matter card
    function renderMatterCard(matter) {
      // Escape all user-controlled data to prevent XSS
      const escapedMatterId = escapeHtml(matter.matter_id);
      const escapedMatterName = escapeHtml(matter.name || matter.matter_name || 'Untitled');
      const escapedClientName = escapeHtml(matter.client_name || '');
      const escapedDescription = escapeHtml(matter.description || 'No description');
      const escapedMatterNumber = escapeHtml(matter.matter_number || '');

      return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow relative matter-card ${selectedMatters.has(matter.matter_id) ? 'ring-2 lex-ring-focus' : ''}" data-matter-id="${escapedMatterId}">
          <!-- Selection Checkbox -->
          <div class="absolute top-4 left-4 z-10">
            <input type="checkbox"
                   class="matter-checkbox w-5 h-5 lex-text-accent border-gray-300 rounded lex-ring-focus"
                   data-matter-id="${escapedMatterId}"
                   ${selectedMatters.has(matter.matter_id) ? 'checked' : ''}
                   ${act('click', 'toggleMatterSelection', [matter.matter_id], { stop: true })}>
          </div>

          <div class="cursor-pointer pl-8"${act('click', 'viewMatter', [matter.matter_id])}>
            <div class="flex items-start justify-between mb-4">
              <div class="flex-1 min-w-0">
                <span class="text-xs text-gray-400 font-mono block truncate" title="${escapedMatterId}">${escapedMatterId}</span>
                <h3 class="text-lg font-semibold text-gray-900 mt-1">${escapedMatterName}</h3>
                <p class="text-sm text-gray-500">${escapedClientName}</p>
              </div>
              <div class="flex items-center gap-2">
                <!-- Pin Button -->
                <button
                  ${act('click', 'togglePin', [matter.matter_id, matter.source || 'lana', Boolean(matter.is_pinned)], { stop: true })}
                  class="pin-button ${matter.is_pinned ? 'text-yellow-500' : 'text-gray-400'} hover:text-yellow-600 transition-colors"
                  title="${matter.is_pinned ? 'Unpin matter' : 'Pin matter'}"
                  data-matter-id="${escapedMatterId}"
                  aria-label="${matter.is_pinned ? 'Unpin matter' : 'Pin matter'}">
                  ${matter.is_pinned ? `
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/>
                    </svg>
                  ` : `
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
                    </svg>
                  `}
                </button>
              </div>
            </div>
            <p class="text-sm text-gray-600 line-clamp-2 mb-4">${escapedDescription}</p>
            <!-- Matter Type and Status Badges -->
            <div class="flex items-center gap-2 mb-4">
              ${matter.matter_type === 'matter' ? `
                <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800" title="Client Matter - Included in analytics">
                  <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
                    <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/>
                  </svg>
                  Matter
                </span>
              ` : `
                <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800" title="Workspace - Excluded from analytics">
                  <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/>
                  </svg>
                  Workspace
                </span>
              `}
              ${statusBadge(matter.status || 'active')}
            </div>
            <div class="flex items-center justify-between text-xs text-gray-400">
              <span>Created ${formatDate(matter.created_at)}</span>
              ${matterOptionsMenuHtml(matter)}
            </div>
          </div>
        </div>
      `;
    }

    // Render a pinned matter as a compact horizontal card (for list view pinned section)
    function renderPinnedCard(matter) {
      var escapedMatterId = escapeHtml(matter.matter_id);
      var escapedMatterName = escapeHtml(matter.name || matter.matter_name || 'Untitled');
      var escapedClientName = escapeHtml(matter.client_name || '');

      var typeBadge = matter.matter_type === 'matter'
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Matter</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Workspace</span>';

      return [
        '<div class="flex-shrink-0 w-56 rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow relative group" style="background: var(--lex-bg-primary); border-color: var(--lex-border-default)"' + act('click', 'viewMatter', [matter.matter_id]) + '>',
        '  <button' + act('click', 'togglePin', [matter.matter_id, matter.source || 'lana', true], { stop: true }),
        '          class="pin-button absolute top-2 right-2 text-yellow-500 hover:text-yellow-600 transition-colors" data-matter-id="' + escapedMatterId + '" title="Unpin">',
        '    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg>',
        '  </button>',
        '  <div class="flex items-start justify-between gap-1">',
        '    <div class="pr-2 min-w-0">',
        '      <h3 class="text-sm font-medium truncate" style="color: var(--lex-text-primary)">' + escapedMatterName + '</h3>',
        '      <p class="text-xs truncate mt-1" style="color: var(--lex-text-secondary)">' + (escapedClientName || escapedMatterId) + '</p>',
        '      <div class="flex items-center gap-2 mt-2">' + typeBadge + ' ' + statusBadge(matter.status || 'active') + '</div>',
        '    </div>',
        '    ' + matterOptionsMenuHtml(matter, 'flex-shrink-0'),
        '  </div>',
        '</div>'
      ].join('');
    }

    // ── List table (lex-table #mattersListView) ─────────────────────────
    //
    // The table is server-paged (docs/TABLE-STANDARD.md): it owns the page,
    // sort and column filters and asks for data with lex-query-change. The
    // grid view shows the same page, with #mattersGridPagination as its pager.

    var MATTERS_TABLE_ID = 'mattersListView';
    var PIN_OUTLINE_ICON = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';
    var MATTER_STATUS_COLORS = { active: 'green', inactive: 'gray', closed: 'blue', archived: 'gray' };
    var MATTER_TYPE_LABELS = { matter: 'Client matter', workspace: 'Workspace' };
    var searchTerm = '';
    var loadSequence = 0;
    var lastLoadPromise = Promise.resolve();
    var lastPagination = { page: 1, limit: 20, total: 0, total_pages: 1 };
    var lastRows = [];

    function mattersTable() {
      return document.getElementById(MATTERS_TABLE_ID);
    }

    function muted(text) {
      return '<span class="matters-list-muted">' + escapeHtml(text || '—') + '</span>';
    }

    // Rows keep raw values; the renderers format them.
    function mapMatterForTable(matter) {
      return {
        matter_id: matter.matter_id,
        name: matter.name || matter.matter_name || 'Untitled',
        client_name: matter.client_name || '',
        status: matter.status || 'active',
        matter_type: matter.matter_type || 'workspace',
        created_at: matter.created_at || '',
        updated_at: matter.updated_at || '',
        source: matter.source || 'lana',
        _raw: matter
      };
    }

    function matterCellRenderers() {
      return {
        name: function (val, row) {
          // Unpinned rows only (pinned matters show as cards above the table).
          return '<span class="matters-list-name-cell">' +
              '<button type="button" class="pin-button matters-list-pin text-gray-400 hover:text-yellow-600 transition-colors"' +
                ' data-matter-id="' + escapeHtml(row.matter_id) + '" data-source="' + escapeHtml(row.source || 'lana') + '"' +
                ' title="Pin matter" aria-label="Pin matter">' + PIN_OUTLINE_ICON + '</button>' +
              '<span class="matters-list-name" title="' + escapeHtml(val) + '">' + escapeHtml(val) + '</span>' +
            '</span>';
        },
        client_name: function (val) {
          return val ? '<span class="matters-list-client" title="' + escapeHtml(val) + '">' + escapeHtml(val) + '</span>' : muted('');
        },
        matter_id: function (val) {
          return '<span class="matters-list-id" title="' + escapeHtml(val) + '">' + escapeHtml(val || '—') + '</span>';
        },
        status: function (val) {
          var raw = String(val || 'active').toLowerCase();
          return '<lex-badge label="' + escapeHtml(Lex.Utils.humanizeLabel(raw)) + '" color="' + (MATTER_STATUS_COLORS[raw] || 'gray') + '"></lex-badge>';
        },
        matter_type: function (val) {
          return muted(MATTER_TYPE_LABELS[val] || Lex.Utils.humanizeLabel(val || ''));
        },
        // The date shows; the full date and time is the tooltip.
        created_at: function (val) {
          var day = val ? Lex.Utils.formatDate(val) : '';
          var full = val ? Lex.Utils.formatDateTime(val) : '';
          return '<time class="matters-list-muted" datetime="' + escapeHtml(val) + '" title="' + escapeHtml(full) + '">' + escapeHtml(day || '—') + '</time>';
        },
        updated_at: function (val) {
          var full = val ? Lex.Utils.formatDateTime(val) : '';
          var ago = val ? Lex.Utils.timeAgo(val) : '';
          return '<time class="matters-list-muted" datetime="' + escapeHtml(val) + '" title="' + escapeHtml(full) + '">' + escapeHtml(ago && ago !== '-' ? ago : '—') + '</time>';
        },
        // Edit / Archive / Delete, the same menu as the cards.
        actions: function (val, row) {
          return matterOptionsMenuHtml(row._raw || row);
        }
      };
    }

    // Every column filters (the table standard). Status and Type take one
    // value each, because the API filters by a single value.
    function matterColumnFilterOptions() {
      var params = window.LanaListQueryParams;
      var ranges = window.LanaLibraryColumnFilters;
      var map = {
        name: { text: true, placeholder: 'Name contains...' },
        client_name: { text: true, placeholder: 'Client contains...' },
        matter_id: { text: true, placeholder: 'Matter ID contains...' }
      };
      if (params) {
        map.status = { single: true, options: params.MATTER_STATUS_OPTIONS };
        map.matter_type = { single: true, options: params.MATTER_TYPE_OPTIONS };
      }
      if (ranges) {
        map.created_at = { single: true, options: ranges.EDITED_RANGE_OPTIONS };
        map.updated_at = { single: true, options: ranges.EDITED_RANGE_OPTIONS };
      }
      return map;
    }

    // Empty copy follows the search and filters: a filtered-empty table
    // offers Clear filters instead of the create button.
    function syncMattersEmptyState(table, filters) {
      var filtered = Boolean(searchTerm || Object.keys(filters || {}).length);
      table.emptyText = filtered ? 'No matching workspaces. Try a different search or filter.' : 'No matters yet';
      table.emptyActionLabel = filtered ? '' : 'Create your first matter';
    }

    function syncGridPager() {
      var pager = document.getElementById('mattersGridPagination');
      if (!pager) return;
      pager.classList.toggle('hidden', viewMode !== 'grid' || (lastPagination.total_pages || 1) <= 1);
      pager.page = lastPagination.page || 1;
      pager.totalPages = lastPagination.total_pages || 1;
      pager.total = lastPagination.total || 0;
      pager.limit = lastPagination.limit || 20;
    }

    // Switch between grid and list view modes
    function switchView(mode) {
      viewMode = mode === 'grid' ? 'grid' : 'list';
      try { window.localStorage.setItem(VIEW_STORAGE_KEY, viewMode); } catch (e) { /* ignore */ }

      // Selections made in one view don't carry into the other.
      selectedMatters.clear();
      updateSelectionUI();
      var table = mattersTable();
      if (table && typeof table.deselectAll === 'function') table.deselectAll();

      var gridBtn = document.getElementById('gridViewBtn');
      var listBtn = document.getElementById('listViewBtn');

      if (mode === 'grid') {
        gridBtn && (gridBtn.variant = 'primary');
        listBtn && (listBtn.variant = 'ghost');
      } else {
        listBtn && (listBtn.variant = 'primary');
        gridBtn && (gridBtn.variant = 'ghost');
      }

      // Re-render with current data
      renderMattersView();
    }

    // Render matters into the active view (grid or list) using current data
    function renderMattersView() {
      var gridEl = document.getElementById('mattersGrid');
      var listEl = mattersTable();

      if (!gridEl || !listEl) return;

      // Hide pinned section in grid view (pinned is list-only)
      var pinnedSection = document.getElementById('listPinnedSection');

      // The list view selects through the table's own checkboxes.
      var gridControls = document.getElementById('gridSelectionControls');
      if (gridControls) gridControls.classList.toggle('hidden', viewMode !== 'grid');

      // One "All Workspaces" header per view: the grid draws its own.
      var listHeader = document.getElementById('mattersListHeader');
      if (listHeader) listHeader.classList.toggle('hidden', viewMode === 'grid');

      if (viewMode === 'grid') {
        gridEl.classList.remove('hidden');
        listEl.classList.add('hidden');
        if (pinnedSection) {
          pinnedSection.classList.add('hidden');
          pinnedSection.style.opacity = '0';
          pinnedSection.style.maxHeight = '0';
        }
      } else {
        listEl.classList.remove('hidden');
        gridEl.classList.add('hidden');

        // Pinned cards section (horizontal scroll above table)
        var pinnedCardsEl = document.getElementById('listPinnedCards');
        var pinnedCountEl = document.getElementById('listPinnedCount');

        if (pinnedSection && pinnedCardsEl) {
          if (allPinnedMatters.length > 0 && currentPage === 1) {
            pinnedSection.classList.remove('hidden');
            pinnedSection.style.opacity = '1';
            pinnedSection.style.maxHeight = '';
            pinnedCardsEl.innerHTML = allPinnedMatters.map(function (m) { return renderPinnedCard(m); }).join('');
            if (pinnedCountEl) pinnedCountEl.textContent = formatNumber(totalPinnedCount) + ' items';
          } else {
            pinnedSection.classList.add('hidden');
            pinnedSection.style.opacity = '0';
            pinnedSection.style.maxHeight = '0';
          }
        }
      }

      syncGridPager();
      updateMattersCount();
    }

    // Debounce utility function
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    // ── Summary metrics ──

    function formatEventType(eventType) {
      if (!eventType) return 'Activity';
      // Convert snake_case/dot-separated to readable text
      var parts = eventType.split('.');
      var last = parts[parts.length - 1] || eventType;
      // Split on underscores and capitalize each word
      var words = last.split('_');
      for (var i = 0; i < words.length; i++) {
        if (words[i].length > 0) {
          words[i] = words[i].charAt(0).toUpperCase() + words[i].substring(1);
        }
      }
      return words.join(' ');
    }

    function formatTimeAgoLocal(dateString) {
      if (!dateString) return '';
      // Prefer global timeAgo from Lex.Utils if available
      if (typeof timeAgo === 'function') return timeAgo(dateString);
      // Fallback: canonical relative time
      return LanaTime.timeAgo(dateString);
    }

    async function loadSummaryMetrics() {
      try {
        var data = await api.get('/api/v1/matters/summary?activity_limit=8');

        // Update metric tiles
        var metricActive = document.getElementById('metricActiveMatters');
        var metricTasks  = document.getElementById('metricOutstandingTasks');
        var metricEvents = document.getElementById('metricRecentActivity');

        if (metricActive) metricActive.setAttribute('value', String(data.active_matters_30d || 0));

        if (metricTasks) {
          metricTasks.setAttribute('value', String(data.outstanding_tasks || 0));
          if ((data.outstanding_tasks || 0) > 0) {
            metricTasks.setAttribute('status', 'red');
          }
        }

        var events = data.recent_events || [];
        if (metricEvents) metricEvents.setAttribute('value', String(events.length));

        // Populate the detail panel with recent events
        var panel = document.getElementById('recentActivityPanel');
        if (panel && events.length > 0) {
          var html = '<div class="divide-y divide-gray-100">';
          for (var i = 0; i < events.length; i++) {
            var evt = events[i];
            var matterName = escapeHtml(evt.matter_name || 'Unknown');
            var actorName = escapeHtml(evt.actor_name || 'System');
            var eventLabel = escapeHtml(formatEventType(evt.event_type));
            var content = escapeHtml(evt.content || '');
            if (content.length > 80) content = content.substring(0, 80) + '...';
            var ago = formatTimeAgoLocal(evt.created_at);
            html += '<div class="flex items-start gap-3 py-3 px-1 hover:bg-gray-50 rounded cursor-pointer"' + act('click', 'viewMatter', [evt.matter_id || '']) + '>';
            html += '  <div class="flex-shrink-0 w-8 h-8 rounded-full lex-bg-accent-muted flex items-center justify-center">';
            html += '    <span class="lex-text-accent text-xs font-semibold">' + actorName.charAt(0) + '</span>';
            html += '  </div>';
            html += '  <div class="flex-1 min-w-0">';
            html += '    <p class="text-sm text-gray-900 truncate"><span class="font-medium">' + actorName + '</span> &middot; ' + eventLabel + '</p>';
            if (content) {
              html += '    <p class="text-xs text-gray-500 truncate mt-0.5">' + content + '</p>';
            }
            html += '    <p class="text-xs text-gray-400 mt-0.5">' + escapeHtml(matterName) + ' &middot; ' + escapeHtml(ago) + '</p>';
            html += '  </div>';
            html += '</div>';
          }
          html += '</div>';
          panel.innerHTML = html;
        } else if (panel) {
          panel.innerHTML = '<p class="text-sm text-gray-500 py-4 text-center">No recent activity</p>';
        }

        // Show metrics content, hide loading skeleton
        var metricsLoading = document.getElementById('metricsLoading');
        var metricsContent = document.getElementById('metricsContent');
        if (metricsLoading) metricsLoading.classList.add('hidden');
        if (metricsContent) metricsContent.classList.remove('hidden');

      } catch (err) {
        // On error, just hide the loading skeleton
        var loading = document.getElementById('metricsLoading');
        if (loading) loading.classList.add('hidden');
        console.warn('[Workspaces] Could not load summary metrics:', err.message || err);
      }
    }

    function setupMetricInteractions() {
      // "Learn More" banner button → open the existing Matters Info modal.
      // Use delegation on the banner because lex-banner clones children into
      // <slot-content>, so direct getElementById returns the clone (no listener).
      var banner = document.getElementById('workspacesBanner');
      if (banner) {
        banner.addEventListener('click', function (e) {
          if (e.target.closest('#learnMoreBtn')) openMattersInfoModal();
        });
      }

      // Toggle detail panel when "Recent Events" metric is clicked
      var trigger = document.getElementById('recentActivityTrigger');
      var panel = document.getElementById('recentActivityPanel');
      if (trigger && panel) {
        trigger.addEventListener('click', function () {
          var isOpen = panel.hasAttribute('open');
          if (isOpen) {
            panel.removeAttribute('open');
          } else {
            panel.setAttribute('open', '');
          }
        });
      }
    }

    // Load matters: asks the table for its current query, which comes back as
    // lex-query-change and lands in fetchMattersPage. Pass { resetPage: true }
    // after the search or a filter changes. Resolves when that page arrives.
    function loadMatters(options) {
      var table = mattersTable();
      if (!table || typeof table.requestServerQuery !== 'function') return Promise.resolve();
      table.requestServerQuery({ resetPage: !!(options && options.resetPage) });
      return lastLoadPromise;
    }

    // Answers the table's lex-query-change with one page from /api/v1/matters,
    // plus the pinned matters on page 1. Stale answers are dropped.
    function fetchMattersPage(query) {
      lastLoadPromise = doFetchMattersPage(query || {});
      return lastLoadPromise;
    }

    async function doFetchMattersPage(query) {
      var sequence = ++loadSequence;
      const grid = document.getElementById('mattersGrid');
      const loading = document.getElementById('mattersLoading');
      var table = mattersTable();
      var filters = query.filters || {};
      var queryParams = window.LanaListQueryParams;
      currentPage = Number(query.page) || 1;

      // Track page view on initial load (use one-time flag to prevent race conditions)
      if (!hasTrackedPageView && window.analytics) {
        window.analytics.trackPageView('matters', null);
        hasTrackedPageView = true;
      }

      // The toolbar Status select mirrors the table's status filter.
      var statusSelect = document.getElementById('statusFilter');
      var statusValue = queryParams ? (queryParams.filterValues(filters.status)[0] || 'all') : 'all';
      if (statusSelect && statusSelect.value !== statusValue) statusSelect.value = statusValue;
      syncToolbarSort(query.sortBy, query.sortDir);

      try {
        if (!queryParams) throw new Error('List query helpers are unavailable.');
        // org_admin sees all matters, others see only their own.
        var includeAll = isOrgAdmin();
        var params = queryParams.mattersParams(query, { search: searchTerm, includeAll: includeAll });
        var typeValue = queryParams.filterValues(filters.matter_type)[0] || '';
        var sharedOnly = statusValue === queryParams.MATTER_SHARED_FILTER;
        var pinnedFilters = { search: searchTerm, include_all: includeAll && !sharedOnly };
        if (sharedOnly) pinnedFilters.shared_only = true;
        else if (statusValue !== 'all') pinnedFilters.status = statusValue;
        if (statusValue === 'archived') pinnedFilters.include_archived = true;
        if (typeValue) pinnedFilters.matter_type = typeValue;

        // Fetch pinned and unpinned matters separately in parallel
        const [pinnedResult, unpinnedResult] = await Promise.all([
          // Pinned matters show on page 1 only.
          currentPage === 1 ? api.getPinnedMatters(pinnedPage, pinnedPageSize, pinnedFilters) : Promise.resolve({ matters: allPinnedMatters, total: totalPinnedCount }),
          api.get('/api/v1/matters?' + params.toString())
        ]);
        if (sequence !== loadSequence) return;

        var pinnedMatters = pinnedResult.matters || [];
        const unpinnedMatters = unpinnedResult.matters || [];

        // The pinned endpoint may not filter by type or hide archived rows.
        pinnedMatters = pinnedMatters.filter(function (m) {
          if (!m) return false;
          if (typeValue && m.matter_type !== typeValue) return false;
          return statusValue === 'archived' || m.status !== 'archived';
        });

        // Store pinned matters info for "Show More" functionality
        if (currentPage === 1) {
          if (pinnedPage === 1) {
            allPinnedMatters = pinnedMatters;
          } else {
            allPinnedMatters = [...allPinnedMatters, ...pinnedMatters];
          }
          totalPinnedCount = typeValue
            ? allPinnedMatters.length
            : (pinnedResult.total || pinnedMatters.length);
        }

        // Combine for currentMatters (for select all functionality)
        matters = [...allPinnedMatters, ...unpinnedMatters];
        currentMatters = matters;

        // Hide loading
        loading.classList.add('hidden');

        const total = Number(unpinnedResult.total !== undefined ? unpinnedResult.total
          : (unpinnedResult.pagination && unpinnedResult.pagination.total)) || 0;
        var limit = Number(params.get('page_size')) || 20;
        lastPagination = {
          page: currentPage,
          limit: limit,
          total: total,
          total_pages: Math.max(1, Math.ceil(total / limit))
        };
        lastRows = unpinnedMatters;
        totalMattersCount = total;

        if (table) {
          syncMattersEmptyState(table, filters);
          table.setServerData(unpinnedMatters.map(mapMatterForTable), lastPagination);
        }

        // Check if there are NO matters at all (both pinned and unpinned)
        if (allPinnedMatters.length === 0 && unpinnedMatters.length === 0 && currentPage === 1) {
          var filtered = Boolean(searchTerm || Object.keys(filters).length);
          grid.innerHTML = filtered ? `
            <div class="col-span-full py-16">
              <div class="max-w-md mx-auto text-center">
                <h3 class="text-xl font-semibold text-gray-900 mb-2">No matching workspaces</h3>
                <p class="text-gray-500 mb-6">Try a different search or filter.</p>
              </div>
            </div>
          ` : `
            <div class="col-span-full py-16">
              <div class="max-w-md mx-auto text-center">
                <div class="w-24 h-24 bg-gradient-to-br from-stone-100 to-stone-200 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg class="w-12 h-12 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path>
                  </svg>
                </div>
                <h3 class="text-xl font-semibold text-gray-900 mb-2">No matters yet</h3>
                <p class="text-gray-500 mb-6">Get started by creating your first matter to organize your documents and collaborate with your team.</p>
                <button type="button"${act('click', 'clickCreateMatter', [])} class="inline-flex items-center gap-2 px-6 py-3 lex-bg-accent hover:lex-bg-accent text-white font-medium rounded-lg transition-colors shadow-lg shadow-stone-200">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                  </svg>
                  Create your first matter
                </button>
              </div>
            </div>
          `;
          // One empty state, matching the active view: the grid's above, or
          // the table's own (with Clear filters when filtered).
          renderMattersView();
          return;
        }

        // Sort pinned matters by pinned_at (most recent first)
        // Security: Handle null/undefined pinned_at to prevent crashes
        pinnedMatters.sort((a, b) => {
          const aTime = a.pinned_at ? new Date(a.pinned_at).getTime() : 0;
          const bTime = b.pinned_at ? new Date(b.pinned_at).getTime() : 0;
          return bTime - aTime; // Most recent first
        });

        // Render matters with grouping
        let html = '';

        // Pinned Matters Section (only show on page 1, hidden during search)
        if (allPinnedMatters.length > 0 && currentPage === 1) {
          // Dynamic heading based on filter
          let pinnedHeading = 'Pinned Matters';
          if (typeValue === 'matter') {
            pinnedHeading = 'Pinned Client Matters';
          } else if (typeValue === 'workspace') {
            pinnedHeading = 'Pinned Workspaces';
          }

          // Determine if search is active — hide pinned section during search
          var pinnedHidden = searchTerm.length > 0;

          html += `
            <div id="pinnedSection" class="col-span-full" style="transition: opacity var(--lex-transition-normal, 200ms) ease, max-height 300ms ease; overflow: hidden;${pinnedHidden ? ' opacity: 0; max-height: 0;' : ' opacity: 1;'}">
              <div class="flex items-center gap-2 mb-4">
                <svg class="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/>
                </svg>
                <h2 class="text-lg font-semibold text-gray-900">${pinnedHeading}</h2>
                <span class="text-sm text-gray-500">(${totalPinnedCount > allPinnedMatters.length ? `Showing ${formatNumber(allPinnedMatters.length)} of ${formatNumber(totalPinnedCount)}` : formatNumber(allPinnedMatters.length)})</span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                ${allPinnedMatters.map(matter => renderMatterCard(matter)).join('')}
              </div>
          `;

          // Show "Show More" button if there are more pinned matters to load
          if (allPinnedMatters.length < totalPinnedCount) {
            html += `
                <button
                  id="showMorePinnedBtn"
                  class="w-full py-3 px-4 mt-4 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center justify-center gap-2"
                  ${act('click', 'loadMorePinnedMatters', [])}
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                  Show More Pinned Matters
                </button>
            `;
          }

          html += `</div>`;
        }

        // All Workspaces section
        if (unpinnedMatters.length > 0) {
          // Dynamic heading based on filter
          let sectionHeading = 'All Workspaces';
          if (typeValue === 'matter') {
            sectionHeading = 'Client Matters';
          } else if (typeValue === 'workspace') {
            sectionHeading = 'Workspaces';
          }
          html += `
            <div class="col-span-full ${allPinnedMatters.length > 0 && currentPage === 1 ? 'mt-8' : ''}">
              <div class="flex items-center gap-2 mb-4">
                <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path>
                </svg>
                <h2 class="text-lg font-semibold text-gray-900">${sectionHeading}</h2>
                <span class="text-sm text-gray-500">(${formatNumber(total)})</span>
              </div>
            </div>
          `;
          html += unpinnedMatters.map(matter => renderMatterCard(matter)).join('');
        }

        grid.innerHTML = html;

        // Show the active view (grid or list)
        renderMattersView();
      } catch (error) {
        if (sequence !== loadSequence) return;
        console.error('[Matters] Failed to load matters:', error);
        loading.classList.add('hidden');
        totalMattersCount = 0;
        if (table) {
          table.setServerError('Workspaces could not be loaded. Check your connection and try again.');
        }
        grid.innerHTML = `
          <div class="col-span-full py-16">
            <div class="max-w-md mx-auto text-center">
              <div class="w-24 h-24 bg-gradient-to-br from-red-100 to-red-200 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg class="w-12 h-12 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 mb-2">Failed to load matters</h3>
              <p class="text-gray-500 mb-6">There was a problem loading your matters. Please try again.</p>
            </div>
          </div>
        `;
        renderMattersView();
      }
    }

    async function loadMorePinnedMatters() {
      try {
        const btn = document.getElementById('showMorePinnedBtn');
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `
            <svg class="animate-spin h-5 w-5 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Loading...
          `;
        }

        // Next batch of pinned matters, accumulated by fetchMattersPage.
        pinnedPage++;
        await loadMatters();

      } catch (error) {
        console.error('[Matters] Failed to load more pinned matters:', error);
        Lex.Toast.error('Failed to load more pinned matters');

        // Decrement page back if failed
        pinnedPage--;

        // Re-enable button
        const btn = document.getElementById('showMorePinnedBtn');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
            Show More Pinned Matters
          `;
        }
      }
    }
    window.loadMorePinnedMatters = loadMorePinnedMatters;
    _trackGlobal('loadMorePinnedMatters');

    // Grid view pager: moves the table's page, so both views stay on one page.
    var _gridPagerEl = document.getElementById('mattersGridPagination');
    if (_gridPagerEl) {
      _gridPagerEl.addEventListener('page-change', function (e) {
        var page = e.detail && e.detail.page;
        var table = mattersTable();
        if (page && table && table.dataSource) table.dataSource.goToPage(page);
      });
    }

    // Pinned cards reset to their first batch whenever the list query changes.
    function resetPinned() {
      pinnedPage = 1;
      allPinnedMatters = [];
      totalPinnedCount = 0;
    }

    function sortOrder() {
      var button = document.getElementById('mattersSortOrder');
      return button && button.dataset.order === 'asc' ? 'asc' : 'desc';
    }

    // Set the toolbar and the table's query from a link, without fetching.
    function applyLinkState(params) {
      var helpers = window.LanaListQueryParams;
      var table = mattersTable();
      if (!helpers || !table || typeof table.restoreQuery !== 'function') return;
      var state = helpers.mattersLinkState(params);
      if (!state.status && !state.sortBy && !state.sortDir) return;
      var sortBy = state.sortBy || table.sortBy || 'created_at';
      var sortDir = state.sortDir || table.sortDir || 'desc';
      table.restoreQuery({
        sortBy: sortBy,
        sortDir: sortDir,
        filters: state.status && state.status !== 'all' ? { status: { operator: 'in', value: [state.status] } } : {},
        limit: Number(table.limit) || 20
      });
      var statusSelect = document.getElementById('statusFilter');
      if (statusSelect && state.status) statusSelect.value = state.status;
      syncToolbarSort(sortBy, sortDir);
    }

    // Toolbar sort drives the table, which asks the server for page 1.
    function applySort(column, direction) {
      var table = mattersTable();
      if (!table || !table.dataSource) return;
      table.sortBy = column;
      table.sortDir = direction;
      table.dataSource.setSort(column, direction);
    }

    // A header click (or any query) sorted the table: mirror it in the toolbar.
    function syncToolbarSort(column, direction) {
      var select = document.getElementById('mattersSort');
      var button = document.getElementById('mattersSortOrder');
      if (select && column && select.value !== column) select.value = column;
      if (button) button.dataset.order = direction === 'asc' ? 'asc' : 'desc';
    }

    // Search and filter
    var _searchInput = document.getElementById('searchInput');
    var _searchDebounce = null;

    // Immediate pinned section fade on search input (no debounce)
    if (_searchInput) _searchInput.addEventListener('lex-input', function (e) {
      var val = (e.detail && e.detail.value !== undefined) ? e.detail.value : (e.detail || '');
      var query = String(val).trim();
      // Grid view pinned section
      var pinned = document.getElementById('pinnedSection');
      if (pinned) {
        if (query.length > 0) {
          pinned.style.opacity = '0';
          pinned.style.maxHeight = '0';
        } else {
          pinned.style.opacity = '1';
          pinned.style.maxHeight = '';
        }
      }
      // List view pinned section (only visible in list mode)
      var listPinned = document.getElementById('listPinnedSection');
      if (listPinned) {
        if (query.length > 0 || viewMode === 'grid') {
          listPinned.style.opacity = '0';
          listPinned.style.maxHeight = '0';
        } else {
          listPinned.style.opacity = '1';
          listPinned.style.maxHeight = '';
        }
      }
    });

    // Search: 350 ms after typing stops (or at once on clear), reload page 1.
    // lex-input emits lex-input while typing and lex-change on clear.
    ['lex-input', 'lex-change'].forEach(function (name) {
      if (!_searchInput) return;
      _searchInput.addEventListener(name, function (e) {
        var raw = (e.detail && e.detail.value !== undefined) ? e.detail.value : _searchInput.value;
        var value = String(raw || '').trim();
        clearTimeout(_searchDebounce);
        _searchDebounce = trackTimeout(function () {
          if (value === searchTerm) return;
          searchTerm = value;

          // Track matter searched event (truncate query to 200 chars for analytics)
          if (value && window.analytics) {
            window.analytics.trackEvent('matter.searched', 'matter', null, {
              matter_id: null, // Search is global, not matter-specific
              query: value.length > 200 ? value.substring(0, 200) : value,
              query_length: value.length,
              truncated: value.length > 200
            });
          }

          resetPinned();
          loadMatters({ resetPage: true });
        }, value ? 350 : 0);
      });
    });

    // Toolbar Status: held in the table's filter state (the Status column's
    // filter), so the table's Clear filters resets it too.
    var _statusFilter = document.getElementById('statusFilter');
    if (_statusFilter) _statusFilter.addEventListener('lex-change', (e) => {
      const filterValue = (e.detail && e.detail.value !== undefined) ? e.detail.value : _statusFilter.value;

      // Track matter filtered event
      if (window.analytics) {
        window.analytics.trackEvent('matter.filtered', 'matter', null, {
          matter_id: null, // Filter is global, not matter-specific
          filter_type: 'status',
          filter_value: filterValue
        });
      }

      var table = mattersTable();
      if (!table) return;
      resetPinned();
      if (filterValue && filterValue !== 'all') table.addFilter('status', 'in', [filterValue]);
      else table.removeFilter('status');
    });

    // Toolbar "Sort by" dropdown and order toggle drive the table's sort.
    var _mattersSort = document.getElementById('mattersSort');
    if (_mattersSort) _mattersSort.addEventListener('lex-change', function (e) {
      applySort((e.detail && e.detail.value) ? e.detail.value : 'created_at', sortOrder());
    });

    var _mattersSortOrder = document.getElementById('mattersSortOrder');
    if (_mattersSortOrder) _mattersSortOrder.addEventListener('click', function () {
      _mattersSortOrder.dataset.order = sortOrder() === 'asc' ? 'desc' : 'asc';
      applySort(_mattersSort ? _mattersSort.value : 'created_at', sortOrder());
    });

    // View toggle (grid / list)
    var _gridViewBtn = document.getElementById('gridViewBtn');
    var _listViewBtn = document.getElementById('listViewBtn');
    if (_gridViewBtn) _gridViewBtn.addEventListener('click', function () { switchView('grid'); });
    if (_listViewBtn) _listViewBtn.addEventListener('click', function () { switchView('list'); });
    if (_gridViewBtn) _gridViewBtn.variant = viewMode === 'grid' ? 'primary' : 'ghost';
    if (_listViewBtn) _listViewBtn.variant = viewMode === 'list' ? 'primary' : 'ghost';

    var _mattersTable = mattersTable();
    if (_mattersTable) {
      // Renderers and filter options before the first page lands.
      if (typeof _mattersTable.setCellRenderers === 'function') _mattersTable.setCellRenderers(matterCellRenderers());
      if (typeof _mattersTable.setColumnFilterOptions === 'function') _mattersTable.setColumnFilterOptions(matterColumnFilterOptions());

      // The table asks for a page (paging, sort, column filters).
      _mattersTable.addEventListener('lex-query-change', function (e) {
        if (e.target !== _mattersTable) return;
        fetchMattersPage(e.detail);
      });
      _mattersTable.addEventListener('lex-filter-change', function (e) {
        if (e.target === _mattersTable) resetPinned();
      });
      _mattersTable.addEventListener('sort-change', function (e) {
        if (e.target === _mattersTable && e.detail) syncToolbarSort(e.detail.sortBy, e.detail.sortDir);
      });

      // lex-table row click → navigate to matter
      _mattersTable.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.matter_id) {
          viewMatter(row.matter_id);
        }
      });

      // lex-table's row-click skips buttons: the pin button is delegated here.
      _mattersTable.addEventListener('click', function (e) {
        var pin = e.target && e.target.closest ? e.target.closest('.matters-list-pin') : null;
        if (!pin) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.togglePin === 'function') {
          window.togglePin(pin.getAttribute('data-matter-id'), pin.getAttribute('data-source') || 'lana', false);
        }
      });

      // Empty-state CTA: "Create your first matter" reuses the header create action.
      _mattersTable.addEventListener('empty-action', function () {
        var b = document.getElementById('createMatterBtn');
        if (b) b.click();
      });
      _mattersTable.addEventListener('bulk-action', function (e) {
        var action = e.detail && e.detail.action;
        if (action === 'delete' && e.detail.items) {
          var ids = e.detail.items.map(function (m) { return m.matter_id; }).filter(Boolean);
          confirmBulkDeleteMatters(ids, function () { _mattersTable.deselectAll(); });
        }
      });
    }

    // Modal
    const modal = document.getElementById('matterModal');
    const form = document.getElementById('matterForm');
    let allOrgUsers = [];
    let selectedUsers = [];
    let conflictDetection = null;
    // Expose globally for inline onclick handlers in conflict-detection.js templates
    Object.defineProperty(window, 'conflictDetection', {
      get() { return conflictDetection; },
      set(v) { conflictDetection = v; },
      configurable: true
    });

    // Workspace matter modal variables
    let workspaceSelectedUsers = [];
    let workspaceConflictDetection = null;
    Object.defineProperty(window, 'workspaceConflictDetection', {
      get() { return workspaceConflictDetection; },
      set(v) { workspaceConflictDetection = v; },
      configurable: true
    });

    // Load workspaces for linking
    let allWorkspaces = [];
    async function loadWorkspaces() {
      try {
        const result = await api.getMatters(1, 500, 'workspace'); // Get all workspaces
        allWorkspaces = result.matters || [];
        console.log('[loadWorkspaces] Loaded workspaces:', allWorkspaces.length);
      } catch (error) {
        console.error('Failed to load workspaces:', error);
        allWorkspaces = [];
      }
    }

    // Populate workspace selector dropdown (lex-select uses options array)
    function populateWorkspaceSelector() {
      const workspaceSelector = document.getElementById('workspaceSelector');
      if (!workspaceSelector) return;

      const options = [{ value: '', label: 'No workspace (standalone matter)' }];
      allWorkspaces.forEach(workspace => {
        options.push({
          value: workspace.matter_id,
          label: workspace.matter_name || workspace.matter_id
        });
      });

      workspaceSelector.options = options;
      console.log('[populateWorkspaceSelector] Added workspace options:', allWorkspaces.length);
    }

    // Show/hide workspace selector based on matter type
    function updateWorkspaceSelectorVisibility() {
      const matterType = document.getElementById('matterType').value;
      const workspaceSelectorSection = document.getElementById('workspaceSelectorSection');
      document.querySelectorAll('#matterTypeDiagram [data-matter-type]').forEach(panel => {
        const selected = panel.dataset.matterType === matterType;
        panel.classList.toggle('is-selected', selected);
        panel.setAttribute('aria-pressed', String(selected));
      });

      if (matterType === 'matter') {
        // Show workspace selector for Client Matters
        workspaceSelectorSection.classList.remove('hidden');
      } else {
        // Hide workspace selector for Workspaces
        workspaceSelectorSection.classList.add('hidden');
        // Reset selection
        document.getElementById('workspaceSelector').value = '';
      }
    }

    // Matter type is chosen by clicking a panel in the type diagram
    document.querySelectorAll('#matterTypeDiagram [data-matter-type]').forEach(panel => {
      panel.addEventListener('click', () => {
        document.getElementById('matterType').value = panel.dataset.matterType;
        updateWorkspaceSelectorVisibility();
      });
    });

    // Load org users for sharing
    async function loadOrgUsers() {
      try {
        const result = await api.getUsers(1, 200);
        allOrgUsers = (result.users || []).filter(u => u.id !== api.user?.id); // Exclude current user
      } catch (error) {
        console.error('Failed to load org users:', error);
      }
    }

    // Load both users and workspaces on page load
    Promise.all([loadOrgUsers(), loadWorkspaces()]).then(() => {
      populateWorkspaceSelector();
    });

    // User search functionality
    const userSearchInput = document.getElementById('userSearchInput');
    const userSearchResults = document.getElementById('userSearchResults');
    const selectedUsersList = document.getElementById('selectedUsersList');
    const noUsersSelected = document.getElementById('noUsersSelected');

    if (userSearchInput) userSearchInput.addEventListener('lex-input', debounce(() => {
      const query = userSearchInput.value.toLowerCase().trim();
      if (query.length < 2) {
        if (userSearchResults) userSearchResults.classList.add('hidden');
        return;
      }

      const filtered = allOrgUsers.filter(u =>
        !selectedUsers.some(s => s.id === u.id) && (
          (u.email || '').toLowerCase().includes(query) ||
          (u.first_name || '').toLowerCase().includes(query) ||
          (u.last_name || '').toLowerCase().includes(query)
        )
      ).slice(0, 8);

      if (filtered.length === 0) {
        if (userSearchResults) userSearchResults.innerHTML = '<div class="p-3 text-sm text-gray-500">No users found</div>';
      } else {
        if (userSearchResults) userSearchResults.innerHTML = filtered.map(u => `
          <div class="p-2 hover:bg-gray-50 cursor-pointer flex items-center gap-2"${act('click', 'addUserToShare', [u.id])}>
            <div class="w-8 h-8 lex-bg-accent-soft rounded-full flex items-center justify-center flex-shrink-0">
              <span class="text-xs font-medium lex-text-accent">${escapeHtml((u.first_name?.[0] || '') + (u.last_name?.[0] || '') || u.email?.[0]?.toUpperCase() || 'U')}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(u.first_name || '')} ${escapeHtml(u.last_name || '')}</p>
              <p class="text-xs text-gray-500 truncate">${escapeHtml(u.email)}</p>
            </div>
          </div>
        `).join('');
      }
      if (userSearchResults) userSearchResults.classList.remove('hidden');
    }, 200));

    // Hide search results when clicking outside
    trackDocListener('click', function (e) {
      if (userSearchInput && userSearchResults && !userSearchInput.contains(e.target) && !userSearchResults.contains(e.target)) {
        userSearchResults.classList.add('hidden');
      }
    });

    window.addUserToShare = function(userId) {
      const user = allOrgUsers.find(u => u.id === userId);
      if (!user || selectedUsers.some(u => u.id === userId)) return;

      selectedUsers.push(user);
      renderSelectedUsers();
      if (userSearchInput) userSearchInput.value = '';
      if (userSearchResults) userSearchResults.classList.add('hidden');
      
      // Auto-set visibility to private when users are selected
      document.getElementById('matterVisibility').value = 'private';
      updateShareSectionVisibility();
    }

    window.removeUserFromShare = function(userId) {
      selectedUsers = selectedUsers.filter(u => u.id !== userId);
      renderSelectedUsers();
    }

    // Handle visibility change (lex-select emits lex-change)
    const visibilitySelect = document.getElementById('matterVisibility');
    if (visibilitySelect) visibilitySelect.addEventListener('lex-change', () => {
      if (visibilitySelect.value === 'organization') {
        // Clear selected users when switching to organization visibility
        selectedUsers = [];
        renderSelectedUsers();
      }
      updateShareSectionVisibility();
    });

    // Show/hide share section based on visibility
    function updateShareSectionVisibility() {
      const shareSection = document.getElementById('shareWithSection');
      const visibility = document.getElementById('matterVisibility').value;
      const userSearchInput = document.getElementById('userSearchInput');
      const sectionLabel = shareSection.querySelector('label');

      if (visibility === 'organization') {
        shareSection.classList.add('opacity-50');
        if (userSearchInput) userSearchInput.disabled = true;
        if (sectionLabel) sectionLabel.innerHTML = 'Share with Team Members <span class="text-gray-400 text-xs font-normal">(Not needed for organization visibility)</span>';
      } else {
        shareSection.classList.remove('opacity-50');
        if (userSearchInput) userSearchInput.disabled = false;
        if (sectionLabel) sectionLabel.innerHTML = 'Share with Team Members';
      }
    }

    function renderSelectedUsers() {
      if (selectedUsers.length === 0) {
        selectedUsersList.innerHTML = '<p class="text-sm text-gray-500 italic" id="noUsersSelected">No users selected. Start typing to search and add team members.</p>';
        return;
      }

      selectedUsersList.innerHTML = selectedUsers.map(u => `
        <div class="flex items-center justify-between bg-gray-50 rounded-lg p-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 lex-bg-accent-soft rounded-full flex items-center justify-center flex-shrink-0">
              <span class="text-xs font-medium lex-text-accent">${escapeHtml((u.first_name?.[0] || '') + (u.last_name?.[0] || '') || u.email?.[0]?.toUpperCase() || 'U')}</span>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-900">${escapeHtml(u.first_name || '')} ${escapeHtml(u.last_name || '')}</p>
              <p class="text-xs text-gray-500">${escapeHtml(u.email)}</p>
            </div>
          </div>
          <button type="button"${act('click', 'removeUserFromShare', [u.id])} class="text-gray-400 hover:text-red-600 p-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      `).join('');
    }

    function resetShareForm() {
      selectedUsers = [];
      renderSelectedUsers();
      userSearchInput.value = '';
      userSearchResults.classList.add('hidden');
      document.getElementById('matterVisibility').value = 'private';
      updateShareSectionVisibility();
    }

    // ================== DOCUMENT UPLOAD HANDLING (Removed - use Documents tab in matter drawer) ==================

    var _createMatterBtn = document.getElementById('createMatterBtn');
    if (_createMatterBtn) _createMatterBtn.addEventListener('click', () => {
      document.getElementById('matterModal').heading = 'Create Workspace';
      document.getElementById('matterId').value = '';
      document.getElementById('matterIdDisplay').classList.add('hidden');
      document.getElementById('shareWithSection').classList.remove('hidden');
      document.getElementById('matterEditOnlyFields').classList.add('hidden');
      form.reset();
      // Reset Lex components (not affected by native form.reset())
      ['matterName', 'clientName', 'matterDescription'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const matterStatusEl = document.getElementById('matterStatus');
      if (matterStatusEl) matterStatusEl.value = 'active';
      resetShareForm();

      // Enable matter type selection and reset to workspace default
      document.getElementById('matterTypeSection').classList.remove('hidden');
      document.getElementById('matterType').value = 'workspace';

      // Update workspace selector visibility based on default selection (workspace)
      updateWorkspaceSelectorVisibility();

      // Initialize conflict detection
      conflictDetection = new ConflictDetection(api);
      conflictDetection.initialize('conflictDetectionContainer');

      modal.open = true;
    });

    var _matterModalEl = document.getElementById('matterModal');
    if (_matterModalEl) _matterModalEl.addEventListener('lex-close', () => {
      modal.open = false;
      if (conflictDetection) {
        conflictDetection.reset();
      }
    });
    var _cancelMatterBtn = document.getElementById('cancelMatterBtn');
    if (_cancelMatterBtn) _cancelMatterBtn.addEventListener('click', () => {
      modal.open = false;
      if (conflictDetection) {
        conflictDetection.reset();
      }
    });

    // Edit matter
    window.editMatter = async function(matterId) {
      // Remember if drawer was open for this matter when editing started
      // So we can re-open it after the update
      const wasDrawerOpen = currentMatterData?.matter?.matter_id === matterId;
      window._editingMatterFromDrawer = wasDrawerOpen ? matterId : null;

      try {
        const [matterResult, permResult] = await Promise.all([
          api.getMatter(matterId),
          api.getMatterPermissions(matterId).catch(() => ({ permissions: [] }))
        ]);
        const matter = matterResult.matter;
        const permissions = permResult.permissions || [];

        document.getElementById('matterModal').heading = 'Edit Matter';
        document.getElementById('matterId').value = matter.matter_id;
        document.getElementById('matterIdDisplay').classList.remove('hidden');
        const matterIdValueEl = document.getElementById('matterIdValue');
        matterIdValueEl.textContent = matter.matter_id;
        matterIdValueEl.title = matter.matter_id; // Show full ID on hover
        document.getElementById('clientName').value = matter.client_name || '';
        document.getElementById('matterName').value = matter.matter_name || '';
        document.getElementById('matterDescription').value = matter.description || '';
        document.getElementById('matterStatus').value = matter.status || 'active';
        document.getElementById('matterVisibility').value = matter.visibility || 'private';

        // Hide matter type section when editing (type is immutable)
        document.getElementById('matterTypeSection').classList.add('hidden');
        document.getElementById('matterEditOnlyFields').classList.remove('hidden');

        // Show workspace selector for editing if matter is a client matter
        if (matter.matter_type === 'matter') {
          document.getElementById('workspaceSelectorSection').classList.remove('hidden');

          // Load current workspace link if any
          try {
            const linksResponse = await fetch(`${api.baseUrl}/api/v1/entity-links/matter/${matterId}`, {
              headers: {
                'Authorization': `Bearer ${api.token}`
              }
            });

            if (linksResponse.ok) {
              const linksData = await linksResponse.json();
              const workspaceLink = linksData.links?.workspace_matters?.[0]; // Get first workspace link

              if (workspaceLink) {
                // Set the workspace selector to the linked workspace
                // For incoming links (matter linked to workspace), workspace ID is in linked_entity_id
                document.getElementById('workspaceSelector').value = workspaceLink.linked_entity_id;
                console.log('[Edit Matter] Loaded existing workspace link:', workspaceLink.linked_entity_id);
              }
            }
          } catch (error) {
            console.error('[Edit Matter] Failed to load workspace links:', error);
          }
        } else {
          // Hide workspace selector for workspaces
          document.getElementById('workspaceSelectorSection').classList.add('hidden');
        }

        // Load existing shared users
        selectedUsers = permissions.map(p => ({
          id: p.user_id,
          email: p.email,
          first_name: p.first_name,
          last_name: p.last_name
        }));
        renderSelectedUsers();

        // Show share section in edit mode and update visibility state
        document.getElementById('shareWithSection').classList.remove('hidden');
        updateShareSectionVisibility();

        modal.open = true;
      } catch (error) {
        Lex.Toast.error('Failed to load matter');
      }
    }

    // View matter
    // Store current matter data globally for tab switching
    let currentMatterData = null;

    window.viewMatter = async function(matterId, defaultTab = 'summary', options = {}) {
      // Navigate to the dedicated matter details page.
      // Pass matterId in BOTH params AND context — context survives even if
      // history.state params aren't available to the target page init.
      Lex.Nav.go('workspace-details.html', {
        params: { id: matterId, tab: defaultTab },
        context: { matterId: matterId, tab: defaultTab }
      });
    }

    /**
     * Open the create matter modal from within a workspace
     * After matter is created, it will be automatically linked to the workspace
     */
    window.openCreateMatterDrawer = function(workspaceId) {
      const modal = document.getElementById('workspaceMatterModal');
      const form = document.getElementById('workspaceMatterForm');

      // Store workspace ID
      document.getElementById('workspaceIdForMatter').value = workspaceId;

      // Reset form
      form.reset();
      // Reset Lex components (not affected by native form.reset())
      ['workspaceMatterName', 'workspaceClientName', 'workspaceMatterDescription'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const wsStatusEl = document.getElementById('workspaceMatterStatus');
      if (wsStatusEl) wsStatusEl.value = 'active';
      const wsVisEl = document.getElementById('workspaceMatterVisibility');
      if (wsVisEl) wsVisEl.value = 'private';
      workspaceSelectedUsers = [];
      document.getElementById('workspaceSelectedUsersList').innerHTML = '<p class="text-sm text-gray-500 italic" id="workspaceNoUsersSelected">No users selected. Start typing to search and add team members.</p>';

      // Initialize conflict detection for workspace matter
      if (workspaceConflictDetection) {
        workspaceConflictDetection.reset();
      }
      workspaceConflictDetection = new ConflictDetection(api);
      workspaceConflictDetection.initialize('workspaceConflictDetectionContainer');

      // Show modal
      modal.open = true;;
    }

    // Security: Prevent concurrent pin/unpin requests (race condition fix)
    const pinningInProgress = new Set();

    // Pin/Unpin matter
    window.togglePin = async function(matterId, source = 'lana', isPinned) {
      const button = document.querySelector(`.pin-button[data-matter-id="${matterId}"]`);
      if (!button) return;

      // Prevent concurrent requests for same matter (race condition fix)
      const key = `${matterId}-${source}`;
      if (pinningInProgress.has(key)) {
        console.warn('Pin operation already in progress for this matter');
        return;
      }

      // Mark operation as in progress
      pinningInProgress.add(key);

      // Store original state for rollback on error
      const originalHTML = button.innerHTML;
      const originalClass = button.className;
      const originalTitle = button.title;

      try {
        // Optimistic UI update
        if (isPinned) {
          button.innerHTML = `
            <svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          `;
          button.className = 'pin-button text-gray-400';
          button.title = 'Unpinning...';
        } else {
          button.innerHTML = `
            <svg class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          `;
          button.className = 'pin-button text-yellow-500';
          button.title = 'Pinning...';
        }

        // Call API
        if (isPinned) {
          await api.unpinMatter(matterId, source);

          // Track matter unpinned event
          if (window.analytics) {
            window.analytics.trackEvent('matter.unpinned', 'matter', matterId, { source });
          }

          Lex.Toast.success('Matter unpinned');
        } else {
          await api.pinMatter(matterId, source);

          // Track matter pinned event
          if (window.analytics) {
            window.analytics.trackEvent('matter.pinned', 'matter', matterId, { source });
          }

          Lex.Toast.success('Matter pinned');
        }

        // Clear pinned matters cache to force fresh load
        resetPinned();

        // Reload matters to reflect new order
        await loadMatters({ resetPage: true });
      } catch (error) {
        // Rollback on error
        button.innerHTML = originalHTML;
        button.className = originalClass;
        button.title = originalTitle;

        // Show error message
        if (error.message?.includes('404') || error.message?.includes('not found')) {
          Lex.Toast.error('Matter not found or you do not have access');
        } else if (error.message?.includes('429') || error.message?.includes('rate limit')) {
          Lex.Toast.error('Too many requests. Please wait a moment and try again.');
        } else {
          Lex.Toast.error(error.message || 'Failed to update pin status');
        }

        // Track error for analytics
        if (window.analytics) {
          window.analytics.trackError(error, {
            action: isPinned ? 'matter.unpin' : 'matter.pin',
            matter_id: matterId,
            source: source
          });
        }
      } finally {
        // Always remove from in-progress set (race condition fix)
        pinningInProgress.delete(key);
      }
    }

    // Delete matter
    // Archive / Unarchive a matter. Both are confirmable but lightweight —
    // no destructive copy because nothing is lost; the matter is just moved
    // out of the default list. The "Show archived" toggle in the workspaces
    // header brings them back into view.
    window.archiveMatter = async function(matterId) {
      try {
        await api.archiveMatter(matterId);
        if (window.Lex && Lex.Toast) Lex.Toast.success('Workspace archived');
        loadMatters();
      } catch (error) {
        console.error('[Matters] Archive failed:', error);
        if (window.Lex && Lex.Toast) Lex.Toast.error(error.message || 'Failed to archive');
      }
    };

    window.unarchiveMatter = async function(matterId) {
      try {
        await api.unarchiveMatter(matterId);
        if (window.Lex && Lex.Toast) Lex.Toast.success('Workspace unarchived');
        loadMatters();
      } catch (error) {
        console.error('[Matters] Unarchive failed:', error);
        if (window.Lex && Lex.Toast) Lex.Toast.error(error.message || 'Failed to unarchive');
      }
    };

    window.deleteMatter = async function(matterId) {
      Modal.confirm('Delete Matter', 'Are you sure you want to delete this matter? This action cannot be undone.', async () => {
        try {
          // Get matter details before deletion for tracking
          const matterData = currentMatterData?.matter || {};

          await api.deleteMatter(matterId);

          // Track matter deleted event (with defensive null checks)
          if (window.analytics) {
            window.analytics.trackEvent('matter.deleted', 'matter', matterId, {
              resource_name: matterData?.matter_name || 'Unknown',
              status: matterData?.status || 'unknown'
            });
          }

          Lex.Toast.success('Matter deleted');
          loadMatters();
        } catch (error) {
          if (window.analytics) {
            window.analytics.trackError(error, { action: 'matter.delete', matter_id: matterId });
          }
          Lex.Toast.error(error.message);
        }
      });
    }

    // ==============================================================================
    // Multi-Select and Bulk Delete Functions
    // ==============================================================================

    // Toggle individual matter selection
    window.toggleMatterSelection = function(matterId) {
      if (selectedMatters.has(matterId)) {
        selectedMatters.delete(matterId);
      } else {
        selectedMatters.add(matterId);
      }
      updateSelectionUI();
    }

    // Matter options menus (lex-dropdown-btn, see matterOptionsMenuHtml).
    function handleMatterOptionsSelect(event) {
      var host = event.target && event.target.closest ? event.target.closest('lex-dropdown-btn.matter-options-menu') : null;
      if (!host || !event.detail) return;
      var matterId = host.getAttribute('data-matter-id');
      var action = event.detail.value;
      if (action === 'edit') editMatter(matterId);
      else if (action === 'archive') archiveMatter(matterId);
      else if (action === 'unarchive') unarchiveMatter(matterId);
      else if (action === 'delete') deleteMatter(matterId);
    }
    trackDocListener('lex-select', handleMatterOptionsSelect);

    // Update selection UI (checkboxes, count, bulk actions visibility)
    function updateSelectionUI() {
      const selectedCount = selectedMatters.size;
      const selectAllCheckbox = document.getElementById('selectAllMatters');
      const bulkActions = document.getElementById('bulkActions');
      const selectedCountEl = document.getElementById('selectedCount');

      // Update selected count text
      if (selectedCountEl) selectedCountEl.textContent = selectedCount + ' selected';

      // Show/hide bulk actions
      if (bulkActions) {
        if (selectedCount > 0) {
          bulkActions.classList.remove('hidden');
        } else {
          bulkActions.classList.add('hidden');
        }
      }

      // Update header bar select-all checkbox state (lex-checkbox)
      if (selectAllCheckbox) {
        if (selectedCount === 0) {
          selectAllCheckbox.checked = false;
          selectAllCheckbox.indeterminate = false;
        } else if (selectedCount === currentMatters.length) {
          selectAllCheckbox.checked = true;
          selectAllCheckbox.indeterminate = false;
        } else {
          selectAllCheckbox.checked = false;
          selectAllCheckbox.indeterminate = true;
        }
      }

      // Update list view select-all checkbox (plain <input>)
      var listSelectAll = document.getElementById('listSelectAll');
      if (listSelectAll) {
        if (selectedCount === 0) {
          listSelectAll.checked = false;
          listSelectAll.indeterminate = false;
        } else if (selectedCount === currentMatters.length) {
          listSelectAll.checked = true;
          listSelectAll.indeterminate = false;
        } else {
          listSelectAll.checked = false;
          listSelectAll.indeterminate = true;
        }
      }

      // Update grid card highlighting and checkboxes
      document.querySelectorAll('.matter-card').forEach(card => {
        const matterId = card.dataset.matterId;
        const checkbox = card.querySelector('.matter-checkbox');
        if (selectedMatters.has(matterId)) {
          card.classList.add('ring-2', 'lex-ring-focus');
          if (checkbox) checkbox.checked = true;
        } else {
          card.classList.remove('ring-2', 'lex-ring-focus');
          if (checkbox) checkbox.checked = false;
        }
      });

      // Update list view row checkboxes
      document.querySelectorAll('.matter-row').forEach(function (row) {
        var matterId = row.dataset.matterId;
        var checkbox = row.querySelector('.matter-checkbox');
        if (checkbox) checkbox.checked = selectedMatters.has(matterId);
      });
    }

    // Select all matters on current page (from lex-checkbox in header bar)
    var _selectAll = document.getElementById('selectAllMatters');
    if (_selectAll) _selectAll.addEventListener('lex-change', (e) => {
      if (e.target.checked) {
        currentMatters.forEach(matter => selectedMatters.add(matter.matter_id));
      } else {
        selectedMatters.clear();
      }
      updateSelectionUI();
    });

    // Select all from list view table header checkbox (plain <input>)
    window.toggleSelectAllMatters = function(checked) {
      if (checked) {
        currentMatters.forEach(function (matter) { selectedMatters.add(matter.matter_id); });
      } else {
        selectedMatters.clear();
      }
      updateSelectionUI();
    };

    // Clear selection
    var _clearSelBtn = document.getElementById('clearSelectionBtn');
    if (_clearSelBtn) _clearSelBtn.addEventListener('click', () => {
      selectedMatters.clear();
      updateSelectionUI();
    });

    // Bulk delete: the grid's "Delete Selected" and the list table's bulk action.
    var _bulkDelBtn = document.getElementById('bulkDeleteBtn');
    if (_bulkDelBtn) _bulkDelBtn.addEventListener('click', function () {
      confirmBulkDeleteMatters(Array.from(selectedMatters));
    });

    function confirmBulkDeleteMatters(matterIds, afterDelete) {
      const count = matterIds.length;
      if (count === 0) return;

      Modal.confirm(
        'Delete Multiple Matters',
        `Are you sure you want to delete ${count} matter(s)? This action cannot be undone.`,
        async () => {
          try {
            const result = await api.bulkDeleteMatters(matterIds);

            // Track matter bulk deleted event
            if (window.analytics) {
              window.analytics.trackEvent('matter.bulk_deleted', 'matter', null, {
                matter_ids: matterIds,
                count: matterIds.length,
                soft_deleted: result.soft_deleted || 0,
                hard_deleted: result.hard_deleted || 0,
                failed: result.errors?.length || 0
              });
            }

            if (result.errors && result.errors.length > 0) {
              Lex.Toast.warning(`Deleted ${result.soft_deleted + result.hard_deleted} matters, ${result.errors.length} failed`);
            } else {
              Lex.Toast.success(`Successfully deleted ${result.soft_deleted + result.hard_deleted} matter(s)`);
            }

            // Clear selection and reload
            selectedMatters.clear();
            updateSelectionUI();
            if (typeof afterDelete === 'function') afterDelete();
            loadMatters();
          } catch (error) {
            if (window.analytics) {
              window.analytics.trackError(error, {
                action: 'matter.bulk_delete',
                matter_ids: matterIds,
                count: matterIds.length
              });
            }
            Lex.Toast.error(error.message || 'Failed to delete matters');
          }
        }
      );
    }


    // Form submission
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Check if conflicts are acknowledged
      if (conflictDetection && !conflictDetection.canProceed()) {
        Lex.Toast.error('Please acknowledge the conflicts before proceeding');
        return;
      }

      const matterId = document.getElementById('matterId').value;
      const data = {
        client_name: document.getElementById('clientName').value,
        name: document.getElementById('matterName').value,
        description: document.getElementById('matterDescription').value,
        status: document.getElementById('matterStatus').value,
        visibility: document.getElementById('matterVisibility').value,
        share_with: selectedUsers.map(u => u.id)
      };

      // Add matter_type only when creating (not when updating)
      if (!matterId) {
        data.matter_type = document.getElementById('matterType').value;
      }

      try {
        let createdMatterId;

        if (matterId) {
          await api.updateMatter(matterId, data);
          // Update sharing - sync the selected users
          const currentPerms = await api.getMatterPermissions(matterId).catch(() => ({ permissions: [] }));
          const currentUserIds = (currentPerms.permissions || []).map(p => p.user_id);
          const newUserIds = selectedUsers.map(u => u.id);

          // Remove users no longer selected
          for (const userId of currentUserIds) {
            if (!newUserIds.includes(userId)) {
              await api.removeMatterShare(matterId, userId).catch(() => {});
            }
          }

          // Add new users
          for (const userId of newUserIds) {
            if (!currentUserIds.includes(userId)) {
              await api.shareMatterWithUser(matterId, userId, ['read', 'write']).catch(() => {});
            }
          }

          createdMatterId = matterId;

          // Update workspace link if matter is a client matter
          const selectedWorkspaceId = document.getElementById('workspaceSelector')?.value;
          if (currentMatterData?.matter?.matter_type === 'matter') {
            try {
              // Get current workspace links
              const linksResponse = await fetch(`${api.baseUrl}/api/v1/entity-links/matter/${matterId}`, {
                headers: {
                  'Authorization': `Bearer ${api.token}`
                }
              });

              let currentWorkspaceLink = null;
              if (linksResponse.ok) {
                const linksData = await linksResponse.json();
                currentWorkspaceLink = linksData.links?.workspace_matters?.[0];
              }

              const currentWorkspaceId = currentWorkspaceLink?.linked_entity_id;

              // If workspace selection changed, update the link
              if (currentWorkspaceId !== selectedWorkspaceId) {
                // Delete old link if it exists
                if (currentWorkspaceLink) {
                  await fetch(`${api.baseUrl}/api/v1/entity-links/${currentWorkspaceLink.link_id}`, {
                    method: 'DELETE',
                    headers: {
                      'Authorization': `Bearer ${api.token}`
                    }
                  });
                  console.log('[Edit Matter] Removed old workspace link');
                }

                // Create new link if workspace is selected
                if (selectedWorkspaceId) {
                  const createLinkResponse = await fetch(`${api.baseUrl}/api/v1/entity-links`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${api.token}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      source_matter_id: selectedWorkspaceId,
                      target_matter_id: matterId,
                      link_type: 'workspace_matter'
                    })
                  });

                  if (createLinkResponse.ok) {
                    console.log('[Edit Matter] Created new workspace link:', selectedWorkspaceId);
                    Lex.Toast.success('Workspace link updated');
                  } else {
                    const errorData = await createLinkResponse.json().catch(() => ({}));
                    console.error('[Edit Matter] Failed to create workspace link:', errorData);
                    Lex.Toast.error(`Failed to update workspace link: ${errorData.error || 'Unknown error'}`);
                  }
                }
              }
            } catch (error) {
              console.error('[Edit Matter] Error updating workspace link:', error);
              Lex.Toast.error('Failed to update workspace link');
            }
          }

          // Track matter edited event - only track fields that actually changed
          if (window.analytics && currentMatterData?.matter) {
            const oldMatter = currentMatterData.matter;
            const changedFields = [];

            if (data.client_name !== oldMatter.client_name) changedFields.push('client_name');
            if (data.name !== oldMatter.matter_name) changedFields.push('name');
            if (data.description !== oldMatter.description) changedFields.push('description');
            if (data.status !== oldMatter.status) changedFields.push('status');
            if (data.visibility !== oldMatter.visibility) changedFields.push('visibility');

            window.analytics.trackEvent('matter.edited', 'matter', matterId, {
              resource_name: data.name,
              status: data.status,
              changed_fields: changedFields
            });
          }

          Lex.Toast.success('Matter updated');
        } else {
          const result = await api.createMatter(data);
          createdMatterId = result.matter?.id;

          // Track matter created event
          if (window.analytics) {
            window.analytics.trackEvent('matter.created', 'matter', result.matter?.matter_id, {
              resource_name: data.name,
              client_name: data.client_name,
              status: data.status
            });
          }

          Lex.Toast.success(`Matter created: ${result.matter?.matter_id || 'Success'}`);

          // Get selected workspace from dropdown
          const selectedWorkspaceId = document.getElementById('workspaceSelector')?.value;

          // Auto-link to the workspace picked in the dropdown.
          const workspaceToLinkTo = selectedWorkspaceId;

          if (workspaceToLinkTo && result.matter?.matter_id) {
            try {
              const linkResponse = await fetch(`${api.baseUrl}/api/v1/entity-links`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${api.token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  source_matter_id: workspaceToLinkTo,
                  target_matter_id: result.matter.matter_id,
                  link_type: 'workspace_matter'
                })
              });

              if (linkResponse.ok) {
                console.log('[Matter Creation] Auto-linked matter to workspace:', workspaceToLinkTo);
                Lex.Toast.success('Matter linked to workspace successfully');
              } else {
                const errorData = await linkResponse.json().catch(() => ({}));
                console.error('[Matter Creation] Failed to auto-link to workspace:', errorData);
                Lex.Toast.error(`Failed to link to workspace: ${errorData.error || 'Unknown error'}`);
              }
            } catch (error) {
              console.error('[Matter Creation] Error auto-linking to workspace:', error);
              Lex.Toast.error('Failed to link to workspace');
            }
          }
        }

        // Save parties if any were added
        if (conflictDetection && conflictDetection.getParties().length > 0) {
          try {
            const response = await fetch(`${api.baseURL}/api/v1/conflicts/parties`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${api.token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                matter_id: createdMatterId,
                parties: conflictDetection.getParties()
              })
            });

            if (!response.ok) {
              console.error('Failed to save parties');
            } else {
              const result = await response.json();
              console.log(`Saved ${result.data.count} parties to matter`);
            }
          } catch (error) {
            console.error('Error saving parties:', error);
          }
        }

        modal.open = false;
        resetShareForm();
        if (conflictDetection) {
          conflictDetection.reset();
        }
        loadMatters();
        loadWorkspaces();

        // If the drawer was open when editing started, re-open it with refreshed data
        // This ensures the drawer shows the updated matter name and refreshed conversation list
        if (matterId && window._editingMatterFromDrawer === matterId) {
          console.log('[Matter Edit] Re-opening drawer with updated matter data:', matterId);
          // Bust browser cache to force fresh data after update
          await viewMatter(matterId, getCurrentActiveTab(), { bustCache: true });
          window._editingMatterFromDrawer = null; // Clear the flag
        }
      } catch (error) {
        Lex.Toast.error(error.message);

        // Track error for analytics
        if (window.analytics) {
          window.analytics.trackError(error, {
            action: 'matter.create',
            client_name: data?.client_name,
            matter_type: data?.matter_type
          });
        }
      }
    });

    // =============================================================================
    // WORKSPACE MATTER MODAL HANDLERS
    // =============================================================================

    const workspaceMatterModal = document.getElementById('workspaceMatterModal');
    const workspaceMatterForm = document.getElementById('workspaceMatterForm');

    // Close modal handlers
    var _closeWsModal = document.getElementById('closeWorkspaceMatterModal');
    if (_closeWsModal) _closeWsModal.addEventListener('click', () => {
      if (workspaceMatterModal) workspaceMatterModal.open = false;
      if (workspaceConflictDetection) {
        workspaceConflictDetection.reset();
      }
    });

    var _cancelWsBtn = document.getElementById('cancelWorkspaceMatterBtn');
    if (_cancelWsBtn) _cancelWsBtn.addEventListener('click', () => {
      if (workspaceMatterModal) workspaceMatterModal.open = false;
      if (workspaceConflictDetection) {
        workspaceConflictDetection.reset();
      }
    });

    // User search for workspace matter (lex-input emits lex-input event)
    var _wsUserSearch = document.getElementById('workspaceUserSearchInput');
    if (_wsUserSearch) _wsUserSearch.addEventListener('lex-input', (e) => {
      var _wv = (e.detail && e.detail.value !== undefined) ? e.detail.value : document.getElementById('workspaceUserSearchInput').value;
      const query = String(_wv).toLowerCase().trim();
      const resultsDiv = document.getElementById('workspaceUserSearchResults');

      if (query.length < 2) {
        resultsDiv.classList.add('hidden');
        return;
      }

      const filtered = allOrgUsers.filter(u =>
        (u.first_name?.toLowerCase() + ' ' + u.last_name?.toLowerCase()).includes(query) ||
        u.email?.toLowerCase().includes(query)
      );

      if (filtered.length === 0) {
        resultsDiv.innerHTML = '<p class="p-3 text-sm text-gray-500">No users found</p>';
      } else {
        resultsDiv.innerHTML = filtered.map(u => `
          <button type="button"${act('click', 'addWorkspaceUserToShare', [u.id])}
            class="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors">
            <div class="font-medium text-sm">${escapeHtml(u.first_name || '')} ${escapeHtml(u.last_name || '')}</div>
            <div class="text-xs text-gray-500">${escapeHtml(u.email)}</div>
          </button>
        `).join('');
      }

      resultsDiv.classList.remove('hidden');
    });

    window.addWorkspaceUserToShare = function(userId) {
      const user = allOrgUsers.find(u => u.id === userId);
      if (!user || workspaceSelectedUsers.find(u => u.id === userId)) return;

      workspaceSelectedUsers.push(user);
      renderWorkspaceSelectedUsers();

      var _wsInput = document.getElementById('workspaceUserSearchInput');
      if (_wsInput) _wsInput.value = '';
      var _wsResults = document.getElementById('workspaceUserSearchResults');
      if (_wsResults) _wsResults.classList.add('hidden');
    };

    window.removeWorkspaceUserFromShare = function(userId) {
      workspaceSelectedUsers = workspaceSelectedUsers.filter(u => u.id !== userId);
      renderWorkspaceSelectedUsers();
    };

    function renderWorkspaceSelectedUsers() {
      const container = document.getElementById('workspaceSelectedUsersList');
      const noUsersMsg = document.getElementById('workspaceNoUsersSelected');

      if (workspaceSelectedUsers.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 italic" id="workspaceNoUsersSelected">No users selected. Start typing to search and add team members.</p>';
      } else {
        container.innerHTML = workspaceSelectedUsers.map(u => `
          <div class="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm">${escapeHtml(u.first_name || '')} ${escapeHtml(u.last_name || '')}</div>
              <div class="text-xs text-gray-500 truncate">${escapeHtml(u.email)}</div>
            </div>
            <button type="button"${act('click', 'removeWorkspaceUserFromShare', [u.id])}
              class="ml-2 text-red-600 hover:text-red-800 p-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        `).join('');
      }
    }

    // Form submission for workspace matter
    if (workspaceMatterForm) workspaceMatterForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Check if conflicts are acknowledged
      if (workspaceConflictDetection && !workspaceConflictDetection.canProceed()) {
        Lex.Toast.error('Please acknowledge the conflicts before proceeding');
        return;
      }

      const workspaceId = document.getElementById('workspaceIdForMatter').value;
      const data = {
        client_name: document.getElementById('workspaceClientName').value,
        name: document.getElementById('workspaceMatterName').value,
        description: document.getElementById('workspaceMatterDescription').value,
        status: document.getElementById('workspaceMatterStatus').value,
        visibility: document.getElementById('workspaceMatterVisibility').value,
        share_with: workspaceSelectedUsers.map(u => u.id),
        matter_type: 'matter' // Always create as matter, not workspace
      };

      try {
        const result = await api.createMatter(data);
        const createdMatterId = result.matter?.matter_id;

        Lex.Toast.success(`Matter created: ${createdMatterId || 'Success'}`);

        // Save parties if any
        if (workspaceConflictDetection && workspaceConflictDetection.getParties().length > 0) {
          try {
            const response = await fetch(`${api.baseURL}/api/v1/conflicts/parties`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${api.token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                matter_id: result.matter?.id,
                parties: workspaceConflictDetection.getParties()
              })
            });

            if (response.ok) {
              const partyResult = await response.json();
              console.log(`Saved ${partyResult.data.count} parties to matter`);
            }
          } catch (error) {
            console.error('Error saving parties:', error);
          }
        }

        // Auto-link to workspace
        if (workspaceId && createdMatterId) {
          try {
            const linkResponse = await fetch(`${api.baseUrl}/api/v1/entity-links`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${api.token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                source_matter_id: workspaceId,
                target_matter_id: createdMatterId,
                link_type: 'workspace_matter'
              })
            });

            if (linkResponse.ok) {
              console.log('[Workspace Matter Creation] Auto-linked to workspace:', workspaceId);
              Lex.Toast.success('Matter linked to workspace successfully');
            } else {
              console.error('[Workspace Matter Creation] Failed to auto-link');
            }
          } catch (error) {
            console.error('[Workspace Matter Creation] Error auto-linking:', error);
          }
        }

        workspaceMatterModal.open = false;
        workspaceSelectedUsers = [];
        if (workspaceConflictDetection) {
          workspaceConflictDetection.reset();
        }
        loadMatters();
        loadWorkspaces();

        // Refresh linked matters section if viewing the workspace
        // Linked matters are displayed in the Details tab, not as a separate tab
        if (currentMatterData && currentMatterData.matter &&
            currentMatterData.matter.matter_id === workspaceId &&
            document.getElementById('linkedMattersSection')) {
          renderLinkedMattersInDetails(currentMatterData.matter);
        }

      } catch (error) {
        Lex.Toast.error(error.message);
        if (window.analytics) {
          window.analytics.trackError(error, {
            action: 'workspace_matter.create',
            workspace_id: workspaceId
          });
        }
      }
    });

      // Initialize - use async IIFE to handle promise-based flow
      (async function init() {
        // Topbar refresh button
        document.addEventListener('lex-refresh', function (e) {
          e.preventDefault();
          loadMatters();
        });

        // A link may ask for a status and a sort (?status=, ?sort_by=,
        // ?sort_order=, also carried over from links to the old Matters page).
        // Only values the toolbar offers are used; the first load asks for them.
        applyLinkState(new URLSearchParams(window.location.search));

        // Summary metrics are intentionally hidden for now.
        await loadMatters();

        // Check for matter_id or open URL parameter and auto-open drawer
        const urlParams = new URLSearchParams(window.location.search);
        const matterId = urlParams.get('matter_id') || urlParams.get('open');
        const defaultTab = urlParams.get('tab') || 'summary';
        if (matterId) {
          // Matters are now loaded, open the drawer immediately
          viewMatter(matterId, defaultTab);
        }

        // Auto-open the create-matter modal when arrived via ?action=create
        // (e.g. from the "New Chat" picker's "Create Workspace" action).
        if (urlParams.get('action') === 'create') {
          const _createBtn = document.getElementById('createMatterBtn');
          if (_createBtn) _createBtn.click();
          // &type=matter (e.g. "Open a matter" in the onboarding tour) preselects Matter.
          if (urlParams.get('type') === 'matter') {
            const _matterPanel = document.querySelector('#matterTypeDiagram [data-matter-type="matter"]');
            if (_matterPanel) _matterPanel.click();
          }
        }
      })();
    }

    // Matters Info Modal Functions
    window.openMattersInfoModal = function() {
      // Use imperative API so modal appends to document.body,
      // escaping the lex-content overflow/stacking context.
      Lex.Modal.open({
        heading: 'Welcome to Workspaces',
        size: 'lg',
        closeOnOverlay: true,
        content: '<div class="p-6 space-y-8">'

          // Simple explanation
          + '<div>'
          + '<p class="text-gray-700 text-lg leading-relaxed">'
          + 'Think of a <strong>Matter</strong> like a folder for a client or case. Everything about that case &mdash; documents, conversations, notes, and AI help &mdash; lives inside its own matter. Nothing leaks between matters, so each client\'s information stays private and separate.'
          + '</p>'
          + '</div>'

          // What is it
          + '<div>'
          + '<h3 class="text-base font-semibold text-gray-900 mb-3">What is a Matter?</h3>'
          + '<div class="space-y-3">'
          + '<div class="flex items-start gap-3">'
          + '<div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style="background: var(--lex-bg-accent-muted)">'
          + '<svg class="w-4 h-4 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>'
          + '</div>'
          + '<p class="text-sm text-gray-600 leading-relaxed">A matter is a <strong>private space</strong> for one client, case, or project. It holds all the files, chats, and AI work related to that case.</p>'
          + '</div>'
          + '<div class="flex items-start gap-3">'
          + '<div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style="background: var(--lex-bg-accent-muted)">'
          + '<svg class="w-4 h-4 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>'
          + '</div>'
          + '<p class="text-sm text-gray-600 leading-relaxed">Information in one matter <strong>cannot be seen</strong> from another matter. This keeps every client\'s data safe and confidential.</p>'
          + '</div>'
          + '<div class="flex items-start gap-3">'
          + '<div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style="background: var(--lex-bg-accent-muted)">'
          + '<svg class="w-4 h-4 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>'
          + '</div>'
          + '<p class="text-sm text-gray-600 leading-relaxed">When you ask LANA AI a question inside a matter, it <strong>only looks at that matter\'s files</strong>. This means the answers are always about the right case.</p>'
          + '</div>'
          + '</div>'
          + '</div>'

          // How to use it
          + '<div>'
          + '<h3 class="text-base font-semibold text-gray-900 mb-3">How to Use It</h3>'
          + '<div class="space-y-4">'
          + '<div class="flex items-start gap-3"><div class="w-7 h-7 lex-bg-accent rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">1</div><div><h4 class="text-sm font-medium text-gray-900">Create a matter</h4><p class="text-sm text-gray-500">Click <strong>New Matter</strong>, give it a name (like the client or case name), and pick a type.</p></div></div>'
          + '<div class="flex items-start gap-3"><div class="w-7 h-7 lex-bg-accent rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">2</div><div><h4 class="text-sm font-medium text-gray-900">Add your files</h4><p class="text-sm text-gray-500">Upload contracts, emails, letters, or any documents related to the case. LANA reads and understands them for you.</p></div></div>'
          + '<div class="flex items-start gap-3"><div class="w-7 h-7 lex-bg-accent rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">3</div><div><h4 class="text-sm font-medium text-gray-900">Ask LANA questions</h4><p class="text-sm text-gray-500">Start a conversation and ask anything about the case. &quot;What are the key dates?&quot; or &quot;Summarize this contract.&quot; LANA uses your files to give accurate answers.</p></div></div>'
          + '<div class="flex items-start gap-3"><div class="w-7 h-7 lex-bg-accent rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">4</div><div><h4 class="text-sm font-medium text-gray-900">Share with your team</h4><p class="text-sm text-gray-500">Invite other team members so they can see the same files and conversations. Everyone stays on the same page.</p></div></div>'
          + '</div>'
          + '</div>'

          // Get the most out of it
          + '<div>'
          + '<h3 class="text-base font-semibold text-gray-900 mb-3">Get the Most Out of It</h3>'
          + '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">'
          + '<div class="p-3 rounded-lg border" style="border-color: var(--lex-border-default); background: var(--lex-bg-secondary)"><h4 class="text-sm font-medium text-gray-900 mb-1">Upload early</h4><p class="text-xs text-gray-500">The more files LANA has, the better its answers will be. Add documents as soon as you get them.</p></div>'
          + '<div class="p-3 rounded-lg border" style="border-color: var(--lex-border-default); background: var(--lex-bg-secondary)"><h4 class="text-sm font-medium text-gray-900 mb-1">One case, one matter</h4><p class="text-xs text-gray-500">Don\'t mix clients in the same matter. Create a new matter for each case to keep things clean and private.</p></div>'
          + '<div class="p-3 rounded-lg border" style="border-color: var(--lex-border-default); background: var(--lex-bg-secondary)"><h4 class="text-sm font-medium text-gray-900 mb-1">Pin your active cases</h4><p class="text-xs text-gray-500">Pin matters you use every day so they appear at the top. Unpin them when the case is done.</p></div>'
          + '<div class="p-3 rounded-lg border" style="border-color: var(--lex-border-default); background: var(--lex-bg-secondary)"><h4 class="text-sm font-medium text-gray-900 mb-1">Archive when finished</h4><p class="text-xs text-gray-500">When a case closes, change its status to Archived. It\'s still there if you need it, but out of the way.</p></div>'
          + '</div>'
          + '</div>'

          // Two types
          + '<div>'
          + '<h3 class="text-base font-semibold text-gray-900 mb-3">Two Types of Matters</h3>'
          + '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">'
          + '<div class="p-4 rounded-lg border-2" style="border-color: var(--lex-border-default)"><div class="flex items-center gap-2 mb-2"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Matter</span></div><p class="text-sm text-gray-600">For a <strong>real client case</strong>. Shows up in your billing, reports, and analytics. Use this for any work you\'d bill a client for.</p></div>'
          + '<div class="p-4 rounded-lg border-2" style="border-color: var(--lex-border-default)"><div class="flex items-center gap-2 mb-2"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">Workspace</span></div><p class="text-sm text-gray-600">For <strong>internal work</strong> like research, templates, or team planning. Does not show in client-facing reports.</p></div>'
          + '</div>'
          + '</div>'

          + '</div>'
      });
    }

    // Conversation actions are handled by the global ConversationActionsModal
    // from components.js — no page-specific overrides needed.

  // ── Lifecycle hooks ─────────────────────────────────────────────────

  var _preInitKeys = null;

  function onEnter() {
    // Snapshot window keys BEFORE init so onLeave can clean up new ones
    _preInitKeys = new Set(Object.keys(window));
    initializePage();
  }

  function onLeave() {
    // 1. Close any open lex-modals and lex-drawers in the page content
    try {
      document.querySelectorAll('#lex-main-content lex-modal[open], #lex-main-content lex-drawer[open]').forEach(function (el) {
        el.open = false;
      });
    } catch (e) { /* ignore */ }

    // 2. Restore body scroll (modals/drawers set overflow:hidden)
    document.body.style.overflow = '';

    // 3a. Remove tracked document-level listeners (catches listeners missed by snapshot approach)
    _documentListeners.forEach(function (entry) {
      document.removeEventListener(entry.event, entry.handler);
    });
    _documentListeners = [];

    // 3b. Clear tracked intervals (includes commentPollInterval)
    _intervals.forEach(clearInterval);
    _intervals = [];

    // 3c. Clear tracked timeouts
    _timeouts.forEach(clearTimeout);
    _timeouts = [];

    // 4. Delete window globals added by initializePage (window.fn = function...)
    if (_preInitKeys) {
      var currentKeys = Object.keys(window);
      for (var i = 0; i < currentKeys.length; i++) {
        if (!_preInitKeys.has(currentKeys[i])) {
          try { delete window[currentKeys[i]]; } catch (e) { /* non-configurable */ }
        }
      }
      _preInitKeys = null;
    }

    // 5. Also clean tracked second-block globals
    _windowKeys.forEach(function (name) { delete window[name]; });
    _windowKeys = [];

    // 6. Destroy external module instances
    if (typeof destroyMatterNotes === 'function') {
      try { destroyMatterNotes(); } catch (e) { /* ignore */ }
    }

    // 7. Clean up persistent window state set by the page
    try {
      delete window.currentViewedMatter;
      delete window.currentMatterData;
    } catch (e) { /* ignore */ }

    // 8. Clear active matter context — navigating to dashboard etc. should not keep matter scope
    if (window.Lex && window.Lex.state) {
      try { window.Lex.state.setActiveMatter(null); } catch (e) { /* ignore */ }
    }

    // 9. Clear selection, search, and filters so they don't persist on re-navigation
    try {
      if (typeof selectedMatters !== 'undefined' && selectedMatters) selectedMatters.clear();
    } catch (e) { /* selectedMatters is scoped inside initializePage */ }
    var searchEl = document.getElementById('searchInput');
    if (searchEl) searchEl.value = '';
    var statusFilter = document.getElementById('statusFilter');
    var matterTypeFilter = document.getElementById('matterTypeFilter');
    if (statusFilter) statusFilter.value = '';
    if (matterTypeFilter) matterTypeFilter.value = '';
  }

  // Standalone page — init directly (no SPA router)
  onEnter();

})();

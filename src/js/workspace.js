/* workspace.js — Workspaces page script (SPA lifecycle).
   Extracted from matters.html inline scripts.
   Uses LexRouter.registerView() for onEnter/onLeave lifecycle.

   Dependencies (loaded via page descriptor before this file):
     - feature-tracker, mammoth, conflict-detection, similar-matters-widget
     - analytics, metadata-formatter/service, marked, document-metadata-viewer
     - tiptap-bundle, matter-notes (api client + components), matter-skills
     - drawflow, workflow-builder
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
    let currentPage = 1;
    const pageSize = 12;
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

    // View mode: 'grid' or 'list'
    let viewMode = 'list';

    // Sort state
    let sortBy = 'created_at';
    let sortOrder = 'desc';

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

    // Helper function to render a single matter card
    function renderMatterCard(matter) {
      // Escape all user-controlled data to prevent XSS
      const escapedMatterId = escapeHtml(matter.matter_id);
      const escapedMatterName = escapeHtml(matter.name || matter.matter_name || 'Untitled');
      const escapedClientName = escapeHtml(matter.client_name || '');
      const escapedDescription = escapeHtml(matter.description || 'No description');
      const escapedMatterNumber = escapeHtml(matter.matter_number || '');
      const escapedSource = escapeHtml(matter.source || 'lana');  // Use 'source' not 'source_type' for pin API

      return `
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow relative matter-card ${selectedMatters.has(matter.matter_id) ? 'ring-2 lex-ring-focus' : ''}" data-matter-id="${escapedMatterId}">
          <!-- Selection Checkbox -->
          <div class="absolute top-4 left-4 z-10">
            <input type="checkbox"
                   class="matter-checkbox w-5 h-5 lex-text-accent border-gray-300 rounded lex-ring-focus"
                   data-matter-id="${escapedMatterId}"
                   ${selectedMatters.has(matter.matter_id) ? 'checked' : ''}
                   onclick="event.stopPropagation(); toggleMatterSelection('${escapedMatterId}')">
          </div>

          <div class="cursor-pointer pl-8" onclick="viewMatter('${escapedMatterId}')">
            <div class="flex items-start justify-between mb-4">
              <div class="flex-1 min-w-0">
                <span class="text-xs text-gray-400 font-mono block truncate" title="${escapedMatterId}">${escapedMatterId}</span>
                <h3 class="text-lg font-semibold text-gray-900 mt-1">${escapedMatterName}</h3>
                <p class="text-sm text-gray-500">${escapedClientName}</p>
              </div>
              <div class="flex items-center gap-2">
                <!-- Pin Button -->
                <button
                  onclick="event.stopPropagation(); togglePin('${escapedMatterId}', '${escapedSource}', ${matter.is_pinned || false})"
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
              <button onclick="event.stopPropagation(); showMatterOptions('${escapedMatterId}', this)" class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors" title="More options">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    // Helper function to render a single matter as a list/table row
    function renderMatterListRow(matter) {
      var escapedMatterId = escapeHtml(matter.matter_id);
      var escapedMatterName = escapeHtml(matter.name || matter.matter_name || 'Untitled');
      var escapedDescription = escapeHtml(matter.description || 'No description');
      var escapedSource = escapeHtml(matter.source || 'lana');

      var typeBadge = matter.matter_type === 'matter'
        ? '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Matter</span>'
        : '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Workspace</span>';

      var pinIcon = matter.is_pinned
        ? '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg>'
        : '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>';

      return [
        '<tr class="matter-row cursor-pointer group" data-matter-id="' + escapedMatterId + '" style="background: transparent" onmouseover="this.style.background=\'var(--lex-bg-secondary)\'" onmouseout="this.style.background=\'transparent\'" onclick="viewMatter(\'' + escapedMatterId + '\')">',
        '  <td class="px-4 py-3 w-10" onclick="event.stopPropagation()">',
        '    <input type="checkbox" class="matter-checkbox w-4 h-4 lex-text-accent border-gray-300 rounded lex-ring-focus"',
        '           data-matter-id="' + escapedMatterId + '"',
        '           ' + (selectedMatters.has(matter.matter_id) ? 'checked' : ''),
        '           onclick="toggleMatterSelection(\'' + escapedMatterId + '\')">',
        '  </td>',
        '  <td class="px-4 py-3 whitespace-nowrap">',
        '    <div class="flex items-center gap-2">',
        '      <button onclick="event.stopPropagation(); togglePin(\'' + escapedMatterId + '\', \'' + escapedSource + '\', ' + (matter.is_pinned || false) + ')"',
        '              class="pin-button flex-shrink-0 ' + (matter.is_pinned ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500') + ' transition-colors"',
        '              data-matter-id="' + escapedMatterId + '" title="' + (matter.is_pinned ? 'Unpin' : 'Pin') + '">',
        '        ' + pinIcon,
        '      </button>',
        '      <span class="text-xs font-mono" style="color: var(--lex-text-tertiary)" title="' + escapedMatterId + '">' + escapedMatterId + '</span>',
        '    </div>',
        '  </td>',
        '  <td class="px-4 py-3">',
        '    <span class="text-sm font-medium" style="color: var(--lex-text-primary)">' + escapedMatterName + '</span>',
        '  </td>',
        '  <td class="px-4 py-3" style="max-width: 300px;">',
        '    <p class="text-sm line-clamp-2" style="color: var(--lex-text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">' + escapedDescription + '</p>',
        '  </td>',
        '  <td class="px-4 py-3 whitespace-nowrap">' + statusBadge(matter.status || 'active') + '</td>',
        '  <td class="px-4 py-3 whitespace-nowrap">' + typeBadge + '</td>',
        '  <td class="px-4 py-3 whitespace-nowrap text-sm" style="color: var(--lex-text-secondary)">' + formatDate(matter.created_at) + '</td>',
        '  <td class="px-4 py-3 whitespace-nowrap text-sm" onclick="event.stopPropagation()">',
        '    <button onclick="event.stopPropagation(); showMatterOptions(\'' + escapedMatterId + '\', this)" class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors" title="More options">',
        '      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>',
        '      </svg>',
        '    </button>',
        '  </td>',
        '</tr>'
      ].join('');
    }

    // Render a pinned matter as a compact horizontal card (for list view pinned section)
    function renderPinnedCard(matter) {
      var escapedMatterId = escapeHtml(matter.matter_id);
      var escapedMatterName = escapeHtml(matter.name || matter.matter_name || 'Untitled');
      var escapedClientName = escapeHtml(matter.client_name || '');
      var escapedSource = escapeHtml(matter.source || 'lana');

      var typeBadge = matter.matter_type === 'matter'
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Matter</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Workspace</span>';

      return [
        '<div class="flex-shrink-0 w-56 rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow relative group" style="background: var(--lex-bg-primary); border-color: var(--lex-border-default)" onclick="viewMatter(\'' + escapedMatterId + '\')">',
        '  <button onclick="event.stopPropagation(); togglePin(\'' + escapedMatterId + '\', \'' + escapedSource + '\', true)"',
        '          class="pin-button absolute top-2 right-2 text-yellow-500 hover:text-yellow-600 transition-colors" data-matter-id="' + escapedMatterId + '" title="Unpin">',
        '    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 12V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v8l-2 2v2h5v6l1 1 1-1v-6h5v-2l-2-2z"/></svg>',
        '  </button>',
        '  <div class="flex items-start justify-between gap-1">',
        '    <div class="pr-2 min-w-0">',
        '      <h3 class="text-sm font-medium truncate" style="color: var(--lex-text-primary)">' + escapedMatterName + '</h3>',
        '      <p class="text-xs truncate mt-1" style="color: var(--lex-text-secondary)">' + (escapedClientName || escapedMatterId) + '</p>',
        '      <div class="flex items-center gap-2 mt-2">' + typeBadge + ' ' + statusBadge(matter.status || 'active') + '</div>',
        '    </div>',
        '    <button onclick="event.stopPropagation(); showMatterOptions(\'' + escapedMatterId + '\', this)" class="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors opacity-0 group-hover:opacity-100" title="More options">',
        '      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
        '        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>',
        '      </svg>',
        '    </button>',
        '  </div>',
        '</div>'
      ].join('');
    }

    // Switch between grid and list view modes
    function switchView(mode) {
      viewMode = mode;

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

    // Inject a leading pin column into the lex-table after each render.
    // lex-table HTML-escapes cell values via _formatCellValue, so a custom
    // cell can't go through the data column path. We attach a MutationObserver
    // once and re-inject on sort/page changes too.
    function ensureListPinColumn(listEl, rows) {
      var sources = {};
      for (var i = 0; i < rows.length; i++) {
        sources[rows[i].matter_id] = rows[i].source || 'lana';
      }
      listEl._pinRowSources = sources;

      injectListPinColumn(listEl);

      if (!listEl._pinColumnObserver) {
        var observer = new MutationObserver(function () {
          injectListPinColumn(listEl);
        });
        observer.observe(listEl, { childList: true, subtree: true });
        listEl._pinColumnObserver = observer;
      }
    }

    function injectListPinColumn(listEl) {
      var thead = listEl.querySelector('thead tr');
      var tbody = listEl.querySelector('tbody');
      if (!thead || !tbody) return;
      var sources = listEl._pinRowSources || {};

      // Header cell
      if (!thead.querySelector('th[data-pin-header]')) {
        var th = document.createElement('th');
        th.setAttribute('data-pin-header', '');
        th.className = 'px-2 py-2 w-10';
        var firstTh = thead.children[0];
        var firstThIsCheckbox = firstTh && firstTh.querySelector && firstTh.querySelector('input[type="checkbox"]');
        if (firstThIsCheckbox) {
          firstTh.parentNode.insertBefore(th, firstTh.nextSibling);
        } else {
          thead.insertBefore(th, thead.firstChild);
        }
      }

      // Body cells
      var trs = tbody.querySelectorAll('tr[data-row-id]');
      for (var i = 0; i < trs.length; i++) {
        var tr = trs[i];
        if (tr.querySelector('td[data-pin-cell]')) continue;
        var matterId = tr.getAttribute('data-row-id');
        var source = sources[matterId] || 'lana';
        var td = document.createElement('td');
        td.setAttribute('data-pin-cell', '');
        td.className = 'px-2 py-2 w-10';
        td.innerHTML = '<button type="button" class="pin-button text-gray-400 hover:text-yellow-600 transition-colors" data-matter-id="' + matterId + '" data-source="' + source + '" title="Pin matter" aria-label="Pin matter">' +
          '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>' +
          '</button>';
        var firstTd = tr.children[0];
        var firstTdIsCheckbox = firstTd && firstTd.querySelector && firstTd.querySelector('input[type="checkbox"]');
        if (firstTdIsCheckbox) {
          firstTd.parentNode.insertBefore(td, firstTd.nextSibling);
        } else {
          tr.insertBefore(td, tr.firstChild);
        }
        var btn = td.querySelector('button');
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var t = ev.currentTarget;
          var mid = t.getAttribute('data-matter-id');
          var src = t.getAttribute('data-source') || 'lana';
          if (typeof window.togglePin === 'function') {
            window.togglePin(mid, src, false);
          }
        });
      }
    }

    // Render matters into the active view (grid or list) using current data
    function renderMattersView() {
      var gridEl = document.getElementById('mattersGrid');
      var listEl = document.getElementById('mattersListView');

      if (!gridEl || !listEl) return;

      // Hide pinned section in grid view (pinned is list-only)
      var pinnedSection = document.getElementById('listPinnedSection');

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

        // Populate lex-table via setData() (unpinned matters only)
        var pinnedIds = new Set(allPinnedMatters.map(function (m) { return m.matter_id; }));
        var rows = currentMatters.filter(function (m) { return !pinnedIds.has(m.matter_id); });
        if (typeof listEl.setData === 'function') {
          listEl.setData(rows);
        }

        // lex-table doesn't expose a per-cell render hook (cells are
        // HTML-escaped via _formatCellValue), so we inject a leading
        // pin column post-render. A MutationObserver on the internal
        // tbody re-injects on sort/page changes too.
        ensureListPinColumn(listEl, rows);

        // Update the toolbar count chip with the grand total.
        updateMattersCount();
      }
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
      // Fallback: simple relative time
      var now = Date.now();
      var then = new Date(dateString).getTime();
      var diffMs = now - then;
      var diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return diffMin + 'm ago';
      var diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return diffHr + 'h ago';
      var diffDay = Math.floor(diffHr / 24);
      if (diffDay < 30) return diffDay + 'd ago';
      return Math.floor(diffDay / 30) + 'mo ago';
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
            var matterId = escapeHtml(evt.matter_id || '');

            html += '<div class="flex items-start gap-3 py-3 px-1 hover:bg-gray-50 rounded cursor-pointer" onclick="viewMatter(\'' + matterId + '\')">';
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

    // Load matters
    async function loadMatters(options) {
      var softRefresh = options && options.soft;
      const grid = document.getElementById('mattersGrid');
      const loading = document.getElementById('mattersLoading');
      const pagination = document.getElementById('pagination');

      // Track page view on initial load (use one-time flag to prevent race conditions)
      if (!hasTrackedPageView && window.analytics) {
        window.analytics.trackPageView('matters', null);
        hasTrackedPageView = true;
      }

      // Soft refresh: keep current view visible (sort, paginate).
      // Full refresh: show spinner and hide views (initial load, search, filter).
      if (!softRefresh) {
        loading.classList.remove('hidden');
        grid.classList.add('hidden');
        var _listViewLoading = document.getElementById('mattersListView');
        if (_listViewLoading) _listViewLoading.classList.add('hidden');
        if (pagination) { pagination.totalPages = 1; pagination.page = 1; }
      }
      
      try {
        var _searchEl = document.getElementById('searchInput');
        var _statusEl = document.getElementById('statusFilter');
        var _typeEl = document.getElementById('matterTypeFilter');
        const search = _searchEl ? _searchEl.value : '';
        const statusFilterValue = _statusEl ? _statusEl.value : '';
        const matterTypeFilterValue = _typeEl ? _typeEl.value : '';

        // Handle "shared" filter separately
        let filters = { search };
        if (statusFilterValue === 'shared') {
          filters.shared_only = true;
        } else if (statusFilterValue && statusFilterValue !== 'all') {
          filters.status = statusFilterValue;
        }

        // Add matter type filter if selected
        if (matterTypeFilterValue) {
          filters.matter_type = matterTypeFilterValue;
        }

        // org_admin sees all matters, others see only their own (unless filtering for shared)
        const includeAll = isOrgAdmin() && statusFilterValue !== 'shared';
        filters.include_all = includeAll;

        // Fetch pinned and unpinned matters separately in parallel
        const [pinnedResult, unpinnedResult] = await Promise.all([
          // Fetch pinned matters with pagination (only on page 1 of unpinned matters)
          currentPage === 1 ? api.getPinnedMatters(pinnedPage, pinnedPageSize, filters) : Promise.resolve({ matters: allPinnedMatters, total: totalPinnedCount }),
          // Fetch unpinned matters with pagination, sorting, and exclude_pinned flag
          api.getMatters(currentPage, pageSize, { ...filters, exclude_pinned: true, sort_by: sortBy, sort_order: sortOrder })
        ]);

        var pinnedMatters = pinnedResult.matters || [];
        const unpinnedMatters = unpinnedResult.matters || [];

        // Client-side filter: ensure pinned results respect matter_type filter
        // (backend may not support this filter on the pinned endpoint)
        if (matterTypeFilterValue) {
          pinnedMatters = pinnedMatters.filter(function (m) {
            return m.matter_type === matterTypeFilterValue;
          });
        }

        // Store pinned matters info for "Show More" functionality
        if (currentPage === 1) {
          if (pinnedPage === 1) {
            allPinnedMatters = pinnedMatters;
          } else {
            allPinnedMatters = [...allPinnedMatters, ...pinnedMatters];
          }
          totalPinnedCount = matterTypeFilterValue
            ? allPinnedMatters.length
            : (pinnedResult.total || pinnedMatters.length);
        }

        // Combine for currentMatters (for select all functionality)
        matters = [...allPinnedMatters, ...unpinnedMatters];

        // Archived matters are hidden unless the Status filter explicitly
        // selects "Archived". This is purely client-side; no extra request.
        if (statusFilterValue !== 'archived') {
          matters = matters.filter(function (m) { return m && m.status !== 'archived'; });
        }
        currentMatters = matters;

        console.log('[Matters] Pinned matters loaded:', pinnedMatters.length);
        console.log('[Matters] Total pinned matters:', totalPinnedCount);
        console.log('[Matters] Currently showing pinned:', allPinnedMatters.length);
        console.log('[Matters] Unpinned matters:', unpinnedMatters.length);
        console.log('[Matters] Total on page:', matters.length);

        // Hide loading
        loading.classList.add('hidden');

        // Check if there are NO matters at all (both pinned and unpinned)
        if (allPinnedMatters.length === 0 && unpinnedMatters.length === 0 && currentPage === 1) {
          grid.innerHTML = `
            <div class="col-span-full py-16">
              <div class="max-w-md mx-auto text-center">
                <div class="w-24 h-24 bg-gradient-to-br from-stone-100 to-stone-200 rounded-full flex items-center justify-center mx-auto mb-6">
                  <svg class="w-12 h-12 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path>
                  </svg>
                </div>
                <h3 class="text-xl font-semibold text-gray-900 mb-2">No matters yet</h3>
                <p class="text-gray-500 mb-6">Get started by creating your first matter to organize your documents and collaborate with your team.</p>
                <button onclick="document.getElementById('createMatterBtn').click()" class="inline-flex items-center gap-2 px-6 py-3 lex-bg-accent hover:lex-bg-accent text-white font-medium rounded-lg transition-colors shadow-lg shadow-stone-200">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                  </svg>
                  Create your first matter
                </button>
              </div>
            </div>
          `;
          // Show exactly ONE empty state, matching the active view (never both):
          // grid view -> the rich custom empty above; list view -> the lex-table's
          // own empty state (which now carries the same "Create your first matter" CTA).
          var _listViewEmpty = document.getElementById('mattersListView');
          if (viewMode === 'grid') {
            grid.classList.remove('hidden');
            if (_listViewEmpty) _listViewEmpty.classList.add('hidden');
          } else {
            grid.classList.add('hidden');
            if (_listViewEmpty) {
              _listViewEmpty.classList.remove('hidden');
              if (typeof _listViewEmpty.setData === 'function') _listViewEmpty.setData([]);
            }
          }
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
          console.log('[Matters] Rendering pinned matters section');
          // Dynamic heading based on filter
          let pinnedHeading = 'Pinned Matters';
          if (matterTypeFilterValue === 'matter') {
            pinnedHeading = 'Pinned Client Matters';
          } else if (matterTypeFilterValue === 'workspace') {
            pinnedHeading = 'Pinned Workspaces';
          }

          // Determine if search is active — hide pinned section during search
          var pinnedHidden = search && search.trim().length > 0;

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
                  onclick="loadMorePinnedMatters()"
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
          const totalUnpinned = unpinnedResult.total || 0;
          // Dynamic heading based on filter
          let sectionHeading = 'All Workspaces';
          if (matterTypeFilterValue === 'matter') {
            sectionHeading = 'Client Matters';
          } else if (matterTypeFilterValue === 'workspace') {
            sectionHeading = 'Workspaces';
          }
          html += `
            <div class="col-span-full ${allPinnedMatters.length > 0 && currentPage === 1 ? 'mt-8' : ''}">
              <div class="flex items-center gap-2 mb-4">
                <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path>
                </svg>
                <h2 class="text-lg font-semibold text-gray-900">${sectionHeading}</h2>
                <span class="text-sm text-gray-500">(${formatNumber(totalUnpinned)})</span>
              </div>
            </div>
          `;
          html += unpinnedMatters.map(matter => renderMatterCard(matter)).join('');
        }

        grid.innerHTML = html;

        // Show the active view (grid or list)
        renderMattersView();

        // Update pagination (based on unpinned matters only)
        const total = unpinnedResult.total || 0;
        totalMattersCount = total;
        updateMattersCount();
        const totalPages = Math.ceil(total / pageSize);
        updatePagination(totalPages, total);
      } catch (error) {
        // Hide loading, show grid with error state
        loading.classList.add('hidden');
        grid.classList.remove('hidden');
        var _listViewErr = document.getElementById('mattersListView');
        if (_listViewErr) _listViewErr.classList.add('hidden');
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
              <button onclick="loadMatters()" class="inline-flex items-center gap-2 px-6 py-3 lex-bg-accent hover:lex-bg-accent text-white font-medium rounded-lg transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
                Try Again
              </button>
            </div>
          </div>
        `;
        Lex.Toast.error('Failed to load matters');
      }
    }

    async function loadMorePinnedMatters() {
      console.log('[Matters] Loading more pinned matters');

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

        // Increment pinned page
        pinnedPage++;

        // Fetch next batch of pinned matters by re-rendering
        // loadMatters() will handle fetching the next page and accumulating
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

    function updatePagination(totalPages, totalItems) {
      var pager = document.getElementById('pagination');
      if (!pager) return;

      pager.page = currentPage;
      pager.totalPages = totalPages;
      pager.total = totalItems || 0;
      pager.limit = pageSize;
    }

    window.goToPage = function(page) {
      currentPage = page;
      loadMatters({ soft: true });
    }

    // Wire lex-pagination page-change event
    var _pagerEl = document.getElementById('pagination');
    if (_pagerEl) {
      _pagerEl.addEventListener('page-change', function (e) {
        var page = e.detail && e.detail.page;
        if (page) goToPage(page);
      });
    }

    // Sort matters by column (toggle direction if same column)
    window.sortMatters = function(column) {
      if (sortBy === column) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        sortBy = column;
        sortOrder = column === 'name' ? 'asc' : 'desc';
      }
      currentPage = 1;
      updateSortIndicators();
      loadMatters({ soft: true });
    }

    // Update sort arrow indicators on table headers
    function updateSortIndicators() {
      var headers = document.querySelectorAll('[data-sort-column]');
      for (var i = 0; i < headers.length; i++) {
        var th = headers[i];
        var col = th.getAttribute('data-sort-column');
        var arrow = th.querySelector('.sort-arrow');
        if (!arrow) continue;
        if (col === sortBy) {
          arrow.textContent = sortOrder === 'asc' ? ' \u2191' : ' \u2193';
          arrow.style.opacity = '1';
        } else {
          arrow.textContent = ' \u2195';
          arrow.style.opacity = '0.3';
        }
      }
    }

    // Search and filter
    var _searchInput = document.getElementById('searchInput');

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

    // Debounced search on typing (lex-input fires on every keystroke)
    if (_searchInput) _searchInput.addEventListener('lex-input', debounce((e) => {
      var rawDetail = (e.detail && e.detail.value !== undefined) ? e.detail.value : (e.detail || '');
      const searchQuery = String(rawDetail);

      // Track matter searched event (truncate query to 200 chars for analytics)
      if (searchQuery && window.analytics) {
        const truncatedQuery = searchQuery.length > 200 ? searchQuery.substring(0, 200) : searchQuery;
        window.analytics.trackEvent('matter.searched', 'matter', null, {
          matter_id: null, // Search is global, not matter-specific
          query: truncatedQuery,
          query_length: searchQuery.length,
          truncated: searchQuery.length > 200
        });
      }

      currentPage = 1;
      pinnedPage = 1;
      allPinnedMatters = [];
      totalPinnedCount = 0;
      loadMatters();
    }, 300));

    // Immediate reload when search is cleared (lex-change fires on clear button click)
    if (_searchInput) _searchInput.addEventListener('lex-change', function (e) {
      var val = (e.detail && e.detail.value !== undefined) ? e.detail.value : _searchInput.value;
      if (String(val).trim().length === 0) {
        // Search was cleared — reset pinned section visibility and reload
        var pinned = document.getElementById('pinnedSection');
        if (pinned) { pinned.style.opacity = '1'; pinned.style.maxHeight = ''; }
        var listPinned = document.getElementById('listPinnedSection');
        if (listPinned && viewMode !== 'grid') { listPinned.style.opacity = '1'; listPinned.style.maxHeight = ''; }
        currentPage = 1;
        pinnedPage = 1;
        allPinnedMatters = [];
        totalPinnedCount = 0;
        loadMatters();
      }
    });

    var _statusFilter = document.getElementById('statusFilter');
    if (_statusFilter) _statusFilter.addEventListener('lex-change', (e) => {
      const filterValue = (e.detail && e.detail.value !== undefined) ? e.detail.value : document.getElementById('statusFilter').value;

      // Track matter filtered event
      if (window.analytics) {
        window.analytics.trackEvent('matter.filtered', 'matter', null, {
          matter_id: null, // Filter is global, not matter-specific
          filter_type: 'status',
          filter_value: filterValue
        });
      }

      currentPage = 1;
      pinnedPage = 1;
      allPinnedMatters = [];
      totalPinnedCount = 0;
      loadMatters();
    });

    // Toolbar "Sort by" dropdown — sets the sort column and reloads.
    var _mattersSort = document.getElementById('mattersSort');
    if (_mattersSort) _mattersSort.addEventListener('lex-change', function (e) {
      sortBy = (e.detail && e.detail.value) ? e.detail.value : 'created_at';
      currentPage = 1;
      loadMatters({ soft: true });
    });

    // Toolbar sort-order toggle — flips asc/desc and reloads.
    var _mattersSortOrder = document.getElementById('mattersSortOrder');
    if (_mattersSortOrder) _mattersSortOrder.addEventListener('click', function () {
      sortOrder = _mattersSortOrder.dataset.order === 'asc' ? 'desc' : 'asc';
      _mattersSortOrder.dataset.order = sortOrder;
      currentPage = 1;
      loadMatters({ soft: true });
    });

    var _matterTypeFilter = document.getElementById('matterTypeFilter');
    if (_matterTypeFilter) _matterTypeFilter.addEventListener('lex-change', (e) => {
      const filterValue = (e.detail && e.detail.value !== undefined) ? e.detail.value : document.getElementById('matterTypeFilter').value;

      // Track matter type filtered event
      if (window.analytics) {
        window.analytics.trackEvent('matter.filtered', 'matter', null, {
          matter_id: null,
          filter_type: 'matter_type',
          filter_value: filterValue
        });
      }

      currentPage = 1;
      pinnedPage = 1;
      allPinnedMatters = [];
      totalPinnedCount = 0;
      loadMatters();
    });

    // View toggle (grid / list)
    var _gridViewBtn = document.getElementById('gridViewBtn');
    var _listViewBtn = document.getElementById('listViewBtn');
    if (_gridViewBtn) _gridViewBtn.addEventListener('click', function () { switchView('grid'); });
    if (_listViewBtn) _listViewBtn.addEventListener('click', function () { switchView('list'); });

    // lex-table row click → navigate to matter
    var _mattersTable = document.getElementById('mattersListView');
    if (_mattersTable) {
      _mattersTable.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.matter_id) {
          viewMatter(row.matter_id);
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
          var ids = e.detail.items.map(function (m) { return m.matter_id; });
          if (ids.length > 0 && confirm('Delete ' + ids.length + ' matter(s)? This cannot be undone.')) {
            Promise.all(ids.map(function (id) { return api.deleteMatter(id); })).then(function () {
              Lex.Toast.success(ids.length + ' matter(s) deleted');
              _mattersTable.deselectAll();
              loadMatters();
            });
          }
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
      const matterTypeRadio = document.querySelector('input[name="matterType"]:checked');
      const workspaceSelectorSection = document.getElementById('workspaceSelectorSection');

      if (matterTypeRadio && matterTypeRadio.value === 'matter') {
        // Show workspace selector for Client Matters
        workspaceSelectorSection.classList.remove('hidden');
      } else {
        // Hide workspace selector for Workspaces
        workspaceSelectorSection.classList.add('hidden');
        // Reset selection
        document.getElementById('workspaceSelector').value = '';
      }
    }

    // Add event listeners for matter type radio buttons
    document.querySelectorAll('input[name="matterType"]').forEach(radio => {
      radio.addEventListener('change', updateWorkspaceSelectorVisibility);
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
          <div class="p-2 hover:bg-gray-50 cursor-pointer flex items-center gap-2" onclick="addUserToShare('${u.id}')">
            <div class="w-8 h-8 lex-bg-accent-soft rounded-full flex items-center justify-center flex-shrink-0">
              <span class="text-xs font-medium lex-text-accent">${(u.first_name?.[0] || '') + (u.last_name?.[0] || '') || u.email?.[0]?.toUpperCase() || 'U'}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 truncate">${u.first_name || ''} ${u.last_name || ''}</p>
              <p class="text-xs text-gray-500 truncate">${u.email}</p>
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
              <span class="text-xs font-medium lex-text-accent">${(u.first_name?.[0] || '') + (u.last_name?.[0] || '') || u.email?.[0]?.toUpperCase() || 'U'}</span>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-900">${u.first_name || ''} ${u.last_name || ''}</p>
              <p class="text-xs text-gray-500">${u.email}</p>
            </div>
          </div>
          <button type="button" onclick="removeUserFromShare('${u.id}')" class="text-gray-400 hover:text-red-600 p-1">
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
      document.getElementById('matterModal').heading = 'Create Matter';
      document.getElementById('matterId').value = '';
      document.getElementById('matterIdDisplay').classList.add('hidden');
      document.getElementById('shareWithSection').classList.remove('hidden');
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
      document.querySelectorAll('input[name="matterType"]').forEach(radio => {
        radio.disabled = false;
        if (radio.value === 'workspace') {
          radio.checked = true;
        }
      });

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

    // Create conversation for a matter and navigate to chat
    function getConversationIdFromCreateResponse(response) {
      const seen = [];

      function fromObject(obj) {
        if (!obj || typeof obj !== 'object' || seen.indexOf(obj) !== -1) return '';
        seen.push(obj);

        const directId = obj.conversation_id || obj.conversationId || obj.thread_id || obj.threadId;
        if (directId) return directId;

        const nestedId = fromObject(obj.conversation) || fromObject(obj.session) || fromObject(obj.data);
        if (nestedId) return nestedId;

        return obj.id || '';
      }

      return fromObject(response);
    }

    window.createMatterConversation = async function(matterId, matterName) {
      console.log('[matters.html.createMatterConversation] Creating conversation for matter:', { matterId, matterName });

      // Find the button that triggered this action
      const buttons = document.querySelectorAll(`button[onclick*="createMatterConversation('${matterId}'"]`);

      // Disable all matching buttons and show loading state
      buttons.forEach(button => {
        button.disabled = true;
        button.classList.add('opacity-50', 'cursor-not-allowed');

        // Store original HTML
        if (!button.dataset.originalHtml) {
          button.dataset.originalHtml = button.innerHTML;
        }

        // Replace with loading spinner
        button.innerHTML = `
          <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Creating...</span>
        `;
      });

      try {
        console.log('[matters.html.createMatterConversation] Calling API to create conversation...');

        const response = await api.createConversation({
          matter_id: matterId,
          title: matterName || matterId,
          thread_type: 'ad_hoc',
          context_type: 'full_chat',
          page_scope: 'matter',
          metadata: {
            matter_name: matterName,
            matter_id: matterId
          },
          context: {
            matter_name: matterName,
            matter_id: matterId
          }
        });

        console.log('[matters.html.createMatterConversation] API response:', response);

        const threadId = getConversationIdFromCreateResponse(response);

        if (!threadId) {
          throw new Error('No thread ID returned from API');
        }

        console.log('[matters.html.createMatterConversation] ✅ Conversation created successfully!', {
          threadId,
          matterId,
          matterName
        });

        console.log('[matters.html.createMatterConversation] ========================================');
        console.log('[matters.html.createMatterConversation] READY TO NAVIGATE');
        console.log('[matters.html.createMatterConversation] ========================================');
        console.log('[matters.html.createMatterConversation] Thread ID:', threadId);
        console.log('[matters.html.createMatterConversation] Matter ID:', matterId);
        console.log('[matters.html.createMatterConversation] Matter Name:', matterName);
        console.log('[matters.html.createMatterConversation] Current window.location.href:', window.location.href);
        console.log('[matters.html.createMatterConversation] ========================================');
        console.log('[matters.html.createMatterConversation] WILL OPEN LANA DOCK');
        console.log('[matters.html.createMatterConversation] ========================================');

        console.log('[matters.html.createMatterConversation] Opening conversation in LANA dock');
        NavigationHelpers.navigateToConversation(threadId, matterId);

      } catch (error) {
        console.error('[matters.html.createMatterConversation] Failed to create conversation:', error);

        // Restore buttons on error
        buttons.forEach(button => {
          button.disabled = false;
          button.classList.remove('opacity-50', 'cursor-not-allowed');
          if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
          }
        });

        // Show user-friendly error message
        if (error.response?.data?.error?.code === 'MATTER_NOT_FOUND') {
          Lex.Toast.error(`Matter not found. Please refresh the page and try again.`);
        } else {
          Lex.Toast.error(`Failed to create conversation: ${error.message || 'Unknown error'}`);
        }
      }
    };

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
        currentPage = 1;
        pinnedPage = 1;
        allPinnedMatters = [];
        totalPinnedCount = 0;

        // Reload matters to reflect new order
        await loadMatters();
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
          closeDrawer();
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

    // Shared matter options dropdown (fixed-position, used by grid, list, and pinned cards)
    window.showMatterOptions = function(matterId, triggerEl) {
      var dropdown = document.getElementById('matterOptionsDropdown');
      if (!dropdown) return;

      var isAlreadyOpen = !dropdown.classList.contains('hidden') && dropdown._currentMatterId === matterId;
      // Close if already open for this matter
      if (isAlreadyOpen) {
        dropdown.classList.add('hidden');
        dropdown._currentMatterId = null;
        return;
      }

      // Position relative to the trigger button
      var rect = triggerEl.getBoundingClientRect();
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.left = (rect.right - 128) + 'px'; // 128 = w-32 (8rem)

      // Flip above if not enough room below
      var dropdownHeight = 80; // approximate height of 2 menu items
      if (rect.bottom + 4 + dropdownHeight > window.innerHeight) {
        dropdown.style.top = (rect.top - 4 - dropdownHeight) + 'px';
      }

      // Clamp left edge so it doesn't go offscreen
      var left = rect.right - 128;
      if (left < 8) left = 8;
      dropdown.style.left = left + 'px';

      // Find the matter object so the Archive button knows whether it's
      // currently archived (label flips to "Unarchive") and so we can call
      // the right API endpoint.
      var targetMatter = null;
      for (var i = 0; i < currentMatters.length; i++) {
        if (currentMatters[i].matter_id === matterId) { targetMatter = currentMatters[i]; break; }
      }
      var isArchived = !!(targetMatter && targetMatter.status === 'archived');

      // Wire up actions for this matter
      var editBtn = document.getElementById('matterOptionsEdit');
      var archiveBtn = document.getElementById('matterOptionsArchive');
      var deleteBtn = document.getElementById('matterOptionsDelete');
      if (editBtn) {
        editBtn.onclick = function() { dropdown.classList.add('hidden'); dropdown._currentMatterId = null; editMatter(matterId); };
      }
      if (archiveBtn) {
        archiveBtn.textContent = isArchived ? 'Unarchive' : 'Archive';
        archiveBtn.onclick = function() {
          dropdown.classList.add('hidden');
          dropdown._currentMatterId = null;
          if (isArchived) {
            unarchiveMatter(matterId);
          } else {
            archiveMatter(matterId);
          }
        };
      }
      if (deleteBtn) {
        deleteBtn.onclick = function() { dropdown.classList.add('hidden'); dropdown._currentMatterId = null; deleteMatter(matterId); };
      }

      dropdown._currentMatterId = matterId;
      dropdown.classList.remove('hidden');

      // Close on outside click
      setTimeout(function() {
        var closeOnClickOutside = function(ev) {
          if (!dropdown.contains(ev.target) && ev.target !== triggerEl && !triggerEl.contains(ev.target)) {
            dropdown.classList.add('hidden');
            dropdown._currentMatterId = null;
            document.removeEventListener('click', closeOnClickOutside);
          }
        };
        document.addEventListener('click', closeOnClickOutside);
      }, 0);
    };

    // Close shared dropdown on scroll (prevents stale position)
    window.addEventListener('scroll', function() {
      var dropdown = document.getElementById('matterOptionsDropdown');
      if (dropdown && !dropdown.classList.contains('hidden')) {
        dropdown.classList.add('hidden');
        dropdown._currentMatterId = null;
      }
    }, true);

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

    // Bulk delete
    var _bulkDelBtn = document.getElementById('bulkDeleteBtn');
    if (_bulkDelBtn) _bulkDelBtn.addEventListener('click', async () => {
      const count = selectedMatters.size;
      const matterIds = Array.from(selectedMatters);

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
            closeDrawer();
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
    });


    // Form submission
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Check if conflicts are acknowledged
      if (conflictDetection && !conflictDetection.canProceed()) {
        Lex.Toast.error('Please acknowledge the conflicts before proceeding');
        return;
      }

      const matterId = document.getElementById('matterId').value;
      const matterTypeRadio = document.querySelector('input[name="matterType"]:checked');
      const data = {
        client_name: document.getElementById('clientName').value,
        name: document.getElementById('matterName').value,
        description: document.getElementById('matterDescription').value,
        status: document.getElementById('matterStatus').value,
        visibility: document.getElementById('matterVisibility').value,
        share_with: selectedUsers.map(u => u.id)
      };

      // Add matter_type only when creating (not when updating)
      if (!matterId && matterTypeRadio) {
        data.matter_type = matterTypeRadio.value;
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

          // Auto-link to workspace if selected from dropdown OR if created from workspace modal.
          // createMatterForWorkspaceId is declared (with `let`) in matters.html only; on the
          // Workspaces page this code runs without that scope, so guard with typeof to avoid
          // a ReferenceError on the standalone-matter path (where selectedWorkspaceId is empty
          // and the || falls through to the right side).
          const fallbackWorkspaceId = (typeof createMatterForWorkspaceId !== 'undefined') ? createMatterForWorkspaceId : null;
          const workspaceToLinkTo = selectedWorkspaceId || fallbackWorkspaceId;

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
            } finally {
              // Clear the workspace ID — only if the matters.html scope owns it.
              if (typeof createMatterForWorkspaceId !== 'undefined') {
                createMatterForWorkspaceId = null;
              }
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
          <button type="button" onclick="addWorkspaceUserToShare('${u.id}')"
            class="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors">
            <div class="font-medium text-sm">${u.first_name} ${u.last_name}</div>
            <div class="text-xs text-gray-500">${u.email}</div>
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
              <div class="font-medium text-sm">${u.first_name} ${u.last_name}</div>
              <div class="text-xs text-gray-500 truncate">${u.email}</div>
            </div>
            <button type="button" onclick="removeWorkspaceUserFromShare('${u.id}')"
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

    // Global refresh page function (accessible from inline onclick handlers)
    function refreshPage() {
      console.log('[Matters] Refreshing page...');
      window.location.reload();
    }


  // ── Manual Connect + Custom Fields (from second script block) ──

    // Manual Connect Modal State
    let currentManualConnectMatter = null;
    let manualConnectSearchTimeout = null;

    // Show manual connect modal
    function showManualConnectModal(matterId) {
      currentManualConnectMatter = matterId;
      const modal = document.getElementById('manualConnectModal');
      modal.open = true;

      // Load available connectors for filter
      loadAvailableConnectors();

      // Set up search handlers
      const searchInput = document.getElementById('manualConnectSearch');
      const entityTypeSelect = document.getElementById('manualConnectEntityType');
      const connectorSelect = document.getElementById('manualConnectConnector');

      searchInput.addEventListener('lex-input', () => {
        clearTimeout(manualConnectSearchTimeout);
        manualConnectSearchTimeout = setTimeout(() => performManualConnectSearch(), 300);
      });

      entityTypeSelect.addEventListener('lex-change', performManualConnectSearch);
      connectorSelect.addEventListener('lex-change', performManualConnectSearch);

      // Clear previous search
      searchInput.value = '';
      entityTypeSelect.value = '';
      connectorSelect.value = '';
    }

    // Close manual connect modal
    function closeManualConnectModal() {
      const modal = document.getElementById('manualConnectModal');
      modal.open = false;
      
      currentManualConnectMatter = null;
    }

    // Load available connectors (lex-select uses options array)
    async function loadAvailableConnectors() {
      try {
        const response = await api.get('/api/v1/connectors/integration-sources?status=active');
        const connectors = response.sources || [];

        const select = document.getElementById('manualConnectConnector');
        const optionsList = [{ value: '', label: 'All Connectors' }];
        connectors.forEach(conn => {
          optionsList.push({ value: conn.connector_id, label: conn.connector_name || conn.connector_id });
        });
        select.options = optionsList;
      } catch (error) {
        console.error('[loadAvailableConnectors] Error:', error);
      }
    }

    // Perform search
    async function performManualConnectSearch() {
      const searchInput = document.getElementById('manualConnectSearch');
      const entityTypeSelect = document.getElementById('manualConnectEntityType');
      const connectorSelect = document.getElementById('manualConnectConnector');
      const resultsDiv = document.getElementById('manualConnectResults');

      const search = searchInput.value.trim();
      const entityType = entityTypeSelect.value;
      const connectorId = connectorSelect.value;

      // Show loading
      resultsDiv.innerHTML = `
        <div class="text-center py-8">
          <div class="animate-spin w-8 h-8 border-4 lex-border border-t-stone-600 rounded-full mx-auto mb-4"></div>
          <p class="text-gray-500">Searching...</p>
        </div>
      `;

      try {
        const response = await api.searchConnectorDataForLinking(currentManualConnectMatter, {
          search,
          entity_type: entityType,
          connector_id: connectorId,
          limit: 20
        });

        const results = response.results || [];

        if (results.length === 0) {
          resultsDiv.innerHTML = `
            <div class="text-center py-8 text-gray-500">
              <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <p class="mt-2">No results found</p>
            </div>
          `;
          return;
        }

        // Render results
        resultsDiv.innerHTML = `
          <div class="space-y-2">
            ${results.map(item => renderSearchResultCard(item)).join('')}
          </div>
        `;

      } catch (error) {
        console.error('[performManualConnectSearch] Error:', error);
        resultsDiv.innerHTML = `
          <div class="text-center py-8 text-red-600">
            <svg class="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <p class="mt-2">Error loading results</p>
            <p class="text-sm text-gray-500">${error.message}</p>
          </div>
        `;
      }
    }

    // Render search result card
    function renderSearchResultCard(item) {
      const data = item.data || {};
      const title = data.name || data.title || item.external_id;
      const subtitle = data.description || data.status || item.entity_type;

      return `
        <div class="border border-gray-200 rounded-lg p-4 hover:lex-border-accent hover:bg-gray-50 transition-colors">
          <div class="flex items-start justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                  ${item.entity_type.replace('_', ' ')}
                </span>
                ${item.connector_name ? `
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                    ${item.connector_name}
                  </span>
                ` : ''}
              </div>
              <h4 class="text-sm font-medium text-gray-900 truncate">${escapeHtml(title)}</h4>
              <p class="text-xs text-gray-500 mt-1">${escapeHtml(subtitle)}</p>
              <p class="text-xs text-gray-400 mt-1">ID: ${escapeHtml(item.external_id)}</p>
            </div>
            <button onclick="linkConnectorData('${item.id}')" class="ml-4 flex-shrink-0 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white lex-bg-accent hover:lex-bg-accent focus:outline-none focus:ring-2 focus:ring-offset-2 lex-ring-focus">
              <svg class="-ml-0.5 mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
              </svg>
              Link
            </button>
          </div>
        </div>
      `;
    }

    // Link connector data
    async function linkConnectorData(connectorDataId) {
      try {
        await api.linkConnectorDataToMatter(currentManualConnectMatter, connectorDataId);

        Lex.Toast.success('Data linked successfully!');
        closeManualConnectModal();

        // Reload the connected data tab
        const matter = window.currentViewedMatter;
        if (matter) {
          await renderConnectedDataTab(matter);
        }
      } catch (error) {
        console.error('[linkConnectorData] Error:', error);
        Lex.Toast.error(error.message || 'Failed to link data');
      }
    }

    // Helper: Escape HTML

    let currentEditFieldsMatter = null;
    let customFieldDefinitions = [];
    let customFieldValues = [];

    // Open edit custom fields modal
    async function openEditCustomFieldsModal(matterId) {
      // Validate matterId is provided
      if (!matterId || matterId === 'null' || matterId === 'undefined') {
        console.error('[openEditCustomFieldsModal] Invalid matter ID:', matterId);
        Lex.Toast.error('Cannot open custom fields: Invalid matter ID');
        return;
      }

      currentEditFieldsMatter = matterId;

      // Load current custom field definitions and values
      let matter = window.currentViewedMatter;

      // If matter is not loaded or doesn't match the requested matterId, fetch it
      if (!matter || matter.matter_id !== matterId) {
        try {
          const result = await api.getMatter(matterId, { bustCache: true });

          // Check for error response from backend: { error: { message: "...", code: "..." } }
          if (result && result.error) {
            console.error('[openEditCustomFieldsModal] API error:', result.error);
            Lex.Toast.error(result.error.message || 'Failed to load matter details');
            return;
          }

          // Backend returns { matter: {...} } on success
          if (result && result.matter) {
            matter = result.matter;
            window.currentViewedMatter = matter;
          } else {
            console.error('[openEditCustomFieldsModal] Invalid API response:', result);
            Lex.Toast.error('Failed to load matter details');
            return;
          }
        } catch (error) {
          console.error('[openEditCustomFieldsModal] Error loading matter:', error);
          Lex.Toast.error(error.message || 'Failed to load matter details');
          return;
        }
      }

      customFieldDefinitions = [];
      customFieldValues = [];

      if (matter && matter.metadata?.custom_field_definitions && Array.isArray(matter.metadata.custom_field_definitions)) {
        customFieldDefinitions = JSON.parse(JSON.stringify(matter.metadata.custom_field_definitions));
      }

      if (matter && matter.metadata?.custom_fields && Array.isArray(matter.metadata.custom_fields)) {
        customFieldValues = JSON.parse(JSON.stringify(matter.metadata.custom_fields));
      }

      // Initialize values for fields that don't have them yet
      customFieldDefinitions.forEach(def => {
        const hasValue = customFieldValues.some(v => v.key === def.key);
        if (!hasValue) {
          customFieldValues.push({ key: def.key, value: def.default_value || '' });
        }
      });

      renderCustomFieldsModal();

      const modal = document.getElementById('editCustomFieldsModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    // Close custom fields modal
    function closeEditCustomFieldsModal() {
      const modal = document.getElementById('editCustomFieldsModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      currentEditFieldsMatter = null;
      customFieldDefinitions = [];
      customFieldValues = [];
    }

    // Render custom fields modal content
    function renderCustomFieldsModal() {
      const container = document.getElementById('customFieldsContainer');

      if (customFieldDefinitions.length === 0) {
        container.innerHTML = `
          <div class="text-center py-8 text-gray-500">
            <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <p class="mt-2 text-sm">No custom fields yet. Click "Add Field" to create one.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="space-y-4">
          ${customFieldDefinitions.map((def, index) => {
            const valueObj = customFieldValues.find(v => v.key === def.key);
            const currentValue = valueObj ? valueObj.value : (def.default_value || '');

            return `
              <div class="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <!-- Field Definition Row -->
                <div class="grid grid-cols-12 gap-3 mb-3">
                  <!-- Key (identifier) -->
                  <div class="col-span-3">
                    <label class="block text-xs font-medium text-gray-700 mb-1">Field Key</label>
                    <input
                      type="text"
                      value="${escapeHtml(def.key || '')}"
                      onchange="updateFieldDefinition(${index}, 'key', this.value)"
                      placeholder="e.g., case_number"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
                    />
                  </div>

                  <!-- Display Name -->
                  <div class="col-span-4">
                    <label class="block text-xs font-medium text-gray-700 mb-1">Display Name</label>
                    <input
                      type="text"
                      value="${escapeHtml(def.display_name || '')}"
                      onchange="updateFieldDefinition(${index}, 'display_name', this.value)"
                      placeholder="e.g., Case Number"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
                    />
                  </div>

                  <!-- Type -->
                  <div class="col-span-2">
                    <label class="block text-xs font-medium text-gray-700 mb-1">Type</label>
                    <select
                      onchange="updateFieldDefinition(${index}, 'type', this.value)"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
                    >
                      <option value="text" ${def.type === 'text' ? 'selected' : ''}>Text</option>
                      <option value="textarea" ${def.type === 'textarea' ? 'selected' : ''}>Long Text</option>
                      <option value="number" ${def.type === 'number' ? 'selected' : ''}>Number</option>
                      <option value="currency" ${def.type === 'currency' ? 'selected' : ''}>Currency</option>
                      <option value="date" ${def.type === 'date' ? 'selected' : ''}>Date</option>
                      <option value="datetime" ${def.type === 'datetime' ? 'selected' : ''}>Date+Time</option>
                      <option value="boolean" ${def.type === 'boolean' ? 'selected' : ''}>Yes/No</option>
                      <option value="select" ${def.type === 'select' ? 'selected' : ''}>Dropdown</option>
                    </select>
                  </div>

                  <!-- Required -->
                  <div class="col-span-2">
                    <label class="block text-xs font-medium text-gray-700 mb-1">Required</label>
                    <label class="flex items-center px-3 py-2">
                      <input
                        type="checkbox"
                        ${def.required ? 'checked' : ''}
                        onchange="updateFieldDefinition(${index}, 'required', this.checked)"
                        class="rounded border-gray-300 lex-text-accent lex-ring-focus"
                      />
                      <span class="ml-2 text-sm text-gray-700">Yes</span>
                    </label>
                  </div>

                  <!-- Delete Button -->
                  <div class="col-span-1 flex items-end">
                    <button
                      onclick="removeCustomField(${index})"
                      class="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-md transition-colors"
                      title="Remove field"
                    >
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- Options for Select Type -->
                ${def.type === 'select' ? `
                  <div class="mb-3">
                    <label class="block text-xs font-medium text-gray-700 mb-1">Dropdown Options (comma-separated)</label>
                    <input
                      type="text"
                      value="${escapeHtml((def.options || []).join(', '))}"
                      onchange="updateFieldDefinition(${index}, 'options', this.value.split(',').map(s => s.trim()).filter(s => s))"
                      placeholder="e.g., Active, Pending, Closed"
                      class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
                    />
                  </div>
                ` : ''}

                <!-- Value Input -->
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1">Value</label>
                  ${renderValueInput(def, currentValue, index)}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Helper function to render the appropriate input based on field type
    function renderValueInput(def, currentValue, index) {
      const key = def.key;

      switch (def.type) {
        case 'textarea':
          return `
            <textarea
              onchange="updateFieldValue('${escapeHtml(key)}', this.value)"
              placeholder="Enter ${escapeHtml(def.display_name || def.key)}"
              rows="3"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
            >${escapeHtml(currentValue || '')}</textarea>
          `;

        case 'number':
          return `
            <input
              type="number"
              value="${escapeHtml(currentValue || '')}"
              onchange="updateFieldValue('${escapeHtml(key)}', this.value)"
              placeholder="Enter ${escapeHtml(def.display_name || def.key)}"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
            />
          `;

        case 'currency':
          return `
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span class="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                type="number"
                step="0.01"
                value="${escapeHtml(currentValue || '')}"
                onchange="updateFieldValue('${escapeHtml(key)}', this.value)"
                placeholder="0.00"
                class="w-full pl-7 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
              />
            </div>
          `;

        case 'date':
          return `
            <input
              type="date"
              value="${escapeHtml(currentValue || '')}"
              onchange="updateFieldValue('${escapeHtml(key)}', this.value)"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
            />
          `;

        case 'datetime':
          return `
            <input
              type="datetime-local"
              value="${escapeHtml(currentValue || '')}"
              onchange="updateFieldValue('${escapeHtml(key)}', this.value)"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
            />
          `;

        case 'boolean':
          return `
            <label class="flex items-center px-3 py-2">
              <input
                type="checkbox"
                ${currentValue === true || currentValue === 'true' ? 'checked' : ''}
                onchange="updateFieldValue('${escapeHtml(key)}', this.checked)"
                class="rounded border-gray-300 lex-text-accent lex-ring-focus"
              />
              <span class="ml-2 text-sm text-gray-700">${escapeHtml(def.display_name || def.key)}</span>
            </label>
          `;

        case 'select':
          return `
            <select
              onchange="updateFieldValue('${escapeHtml(key)}', this.value)"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
            >
              <option value="">-- Select ${escapeHtml(def.display_name || def.key)} --</option>
              ${(def.options || []).map(option => `
                <option value="${escapeHtml(option)}" ${currentValue === option ? 'selected' : ''}>
                  ${escapeHtml(option)}
                </option>
              `).join('')}
            </select>
          `;

        case 'text':
        default:
          return `
            <input
              type="text"
              value="${escapeHtml(currentValue || '')}"
              onchange="updateFieldValue('${escapeHtml(key)}', this.value)"
              placeholder="Enter ${escapeHtml(def.display_name || def.key)}"
              class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus"
            />
          `;
      }
    }

    // Add new custom field
    function addCustomField() {
      const newKey = `field_${Date.now()}`;
      customFieldDefinitions.push({
        key: newKey,
        display_name: '',
        type: 'text',
        required: false,
        options: [],
        default_value: ''
      });
      customFieldValues.push({
        key: newKey,
        value: ''
      });
      renderCustomFieldsModal();
    }

    // Update field definition (metadata)
    function updateFieldDefinition(index, property, value) {
      if (customFieldDefinitions[index]) {
        const oldKey = customFieldDefinitions[index].key;
        customFieldDefinitions[index][property] = value;

        // If key changed, update the corresponding value entry
        if (property === 'key' && oldKey !== value) {
          const valueIndex = customFieldValues.findIndex(v => v.key === oldKey);
          if (valueIndex !== -1) {
            customFieldValues[valueIndex].key = value;
          }
        }

        // Re-render if type changed (to show different input)
        if (property === 'type') {
          renderCustomFieldsModal();
        }
      }
    }

    // Update field value
    function updateFieldValue(key, value) {
      const existingIndex = customFieldValues.findIndex(v => v.key === key);
      if (existingIndex !== -1) {
        customFieldValues[existingIndex].value = value;
      } else {
        customFieldValues.push({ key, value });
      }
    }

    // Remove custom field (removes both definition and value)
    function removeCustomField(index) {
      if (customFieldDefinitions[index]) {
        const key = customFieldDefinitions[index].key;
        customFieldDefinitions.splice(index, 1);

        // Also remove the corresponding value
        const valueIndex = customFieldValues.findIndex(v => v.key === key);
        if (valueIndex !== -1) {
          customFieldValues.splice(valueIndex, 1);
        }

        renderCustomFieldsModal();
      }
    }

    // Save custom fields
    async function saveCustomFields() {
      try {
        // Validate definitions
        const validDefinitions = customFieldDefinitions.filter(def => {
          return def.key && def.key.trim() !== '' && def.display_name && def.display_name.trim() !== '';
        });

        if (validDefinitions.length === 0 && customFieldDefinitions.length > 0) {
          Lex.Toast.error('Please fill in Key and Display Name for all fields');
          return;
        }

        // Validate no duplicate keys
        const keys = validDefinitions.map(f => f.key.toLowerCase().trim());
        const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
        if (duplicates.length > 0) {
          Lex.Toast.error(`Duplicate field keys: ${duplicates.join(', ')}`);
          return;
        }

        // Filter values to only include those with corresponding definitions
        const definitionKeys = validDefinitions.map(d => d.key);
        const validValues = customFieldValues.filter(v => definitionKeys.includes(v.key));

        // Validate we have a matter ID
        if (!currentEditFieldsMatter) {
          Lex.Toast.error('Matter ID not found');
          return;
        }

        // Save the matter ID before closing modal (close sets currentEditFieldsMatter to null)
        const matterId = currentEditFieldsMatter;

        // Update via settings endpoint
        const response = await api.put(`/api/v1/matters/${matterId}/settings`, {
          custom_field_definitions: validDefinitions,
          custom_fields: validValues
        });

        Lex.Toast.success('Custom fields updated successfully!');
        closeEditCustomFieldsModal();

        // Reload matter details - backend returns { matter: {...} }
        const updatedMatter = await api.getMatter(matterId, { bustCache: true });
        if (updatedMatter && updatedMatter.matter) {
          window.currentViewedMatter = updatedMatter.matter;
          await window.renderCustomFieldsSection(updatedMatter.matter);

          // Also refresh the activity feed to show the changes
          const activityResult = await api.getMatterActivity(matterId, 20, 0);
          if (activityResult && activityResult.activities && window.currentMatterData) {
            window.currentMatterData.activities = activityResult.activities;
            window.currentMatterData.activityPagination = activityResult.pagination;
            renderActivityTab(window.currentMatterData.matter, activityResult.activities, activityResult.pagination);
          }
        }
      } catch (error) {
        console.error('[saveCustomFields] Error:', error);
        Lex.Toast.error(error.message || 'Failed to save custom fields');
      }
    }


  // ── Expose second-block functions for onclick handlers ──────────────
  window.showManualConnectModal = showManualConnectModal;
  window.closeManualConnectModal = closeManualConnectModal;
  window.openEditCustomFieldsModal = openEditCustomFieldsModal;
  window.closeEditCustomFieldsModal = closeEditCustomFieldsModal;
  window.addCustomField = addCustomField;
  window.saveCustomFields = saveCustomFields;
  window.renderCustomFieldsModal = renderCustomFieldsModal;
  ['showManualConnectModal','closeManualConnectModal','openEditCustomFieldsModal',
   'closeEditCustomFieldsModal','addCustomField','saveCustomFields','renderCustomFieldsModal'
  ].forEach(_trackGlobal);

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

    // 3. Close the shared matter options dropdown
    var matterDropdown = document.getElementById('matterOptionsDropdown');
    if (matterDropdown) { matterDropdown.classList.add('hidden'); matterDropdown._currentMatterId = null; }

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

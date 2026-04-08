(function () {
  'use strict';

  // =========================================================================
  // Lifecycle tracking (same pattern as workspace.js)
  // =========================================================================

  var _windowKeys = [];
  var _documentListeners = [];
  var _intervals = [];
  var _timeouts = [];
  var _preInitKeys = null;

  function _trackGlobal(name) { _windowKeys.push(name); }
  function trackDocListener(event, handler) {
    document.addEventListener(event, handler);
    _documentListeners.push({ event: event, handler: handler });
  }
  function trackInterval(id) { _intervals.push(id); return id; }
  function trackTimeout(id) { _timeouts.push(id); return id; }

  // =========================================================================
  // State
  // =========================================================================

  var api = null;
  var currentMatterData = null;
  var currentTaskMatterId = null;
  var currentEditingTask = null;
  var currentTasksList = [];
  var commentPollInterval = null;
  var currentCommentPage = 1;
  var linkSearchTimeout = null;
  var selectedLinkTargetMatter = null;
  var linkMattersCache = [];
  var currentManualConnectMatter = null;
  var manualConnectSearchTimeout = null;
  var currentEditFieldsMatter = null;
  var customFieldDefinitions = [];
  var customFieldValues = [];
  var _tabIndicatorInitialized = false;
  var _navContext = null;              // navigation context (source, conversationId, etc.)

  // Document tab pagination/search state
  var _docPage = 1;
  var _docPageSize = 12;
  var _docSearch = '';
  var _docSearchTimeout = null;

  // Document generation state
  var docGenState = {
    documentTypes: [],
    templateSets: [],
    contacts: [],
    isGenerating: false,
    isAnalyzing: false,
    generatedContent: '',
    currentArtifact: null,
    activeReader: null,
    customVarCount: 0
  };
  // =========================================================================
  // Utility functions (NO regex — string methods only)
  // =========================================================================

  function escapeHtml(text) {
    if (!text) return '';
    var str = String(text);
    var result = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '&') result += '&amp;';
      else if (ch === '<') result += '&lt;';
      else if (ch === '>') result += '&gt;';
      else if (ch === '"') result += '&quot;';
      else if (ch === "'") result += '&#39;';
      else result += ch;
    }
    return result;
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // NO-REGEX version of formatFieldName
  function formatFieldName(name) {
    if (!name) return '';
    var str = String(name);
    // Remove custom_ prefix
    if (str.indexOf('custom_') === 0) {
      str = str.substring(7);
    }
    // Replace underscores with spaces
    var parts = str.split('_');
    // Capitalize first letter of each word
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].length > 0) {
        parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].substring(1);
      }
    }
    return parts.join(' ');
  }

  function formatFieldValue(value) {
    if (value === null || value === undefined) return 'Not set';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function buildUserChip(person, index) {
    var firstName = person.first_name || 'User';
    var lastInitial = (person.last_name || '')[0] || '';
    var label = firstName + (lastInitial ? ' ' + lastInitial + '.' : '');
    var initial = (firstName[0] || 'U');
    return '<button onclick="showSharedUserInfo(' + index + ')" class="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all hover:shadow-sm lex-bg-accent-muted lex-text-accent">' +
      '<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white lex-bg-accent">' + initial + '</span>' +
      escapeHtml(label) +
    '</button>';
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var date = new Date(dateStr);
    var now = new Date();
    var seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'just now';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    if (days < 365) return Math.floor(days / 30) + 'mo ago';
    return Math.floor(days / 365) + 'y ago';
  }

  function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    if (typeof num !== 'number') num = parseInt(num, 10);
    if (isNaN(num)) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }

  function isOrgAdmin() {
    return api && api.user && (api.user.role === 'admin' || api.user.role === 'org_admin');
  }

  // =========================================================================
  // Redacted state — skeleton shimmer for all page sections
  // =========================================================================

  var _redactIds = [
    'bannerSection',
    'matterBreadcrumb',
    'tabContentActivity',
    'tabContentNotes',
    'tabContentTasks',
    'tabContentComments',
    'tabContentDocuments',
    'tabContentConversations',
    'dockPanelDetails',
    'dockPanelContext'
  ];

  function redactPage(on) {
    for (var i = 0; i < _redactIds.length; i++) {
      var el = document.getElementById(_redactIds[i]);
      if (!el) continue;
      if (on) {
        Lex.Redact.on(el);
      } else {
        Lex.Redact.off(el);
      }
    }
  }

  // Collapsible section helpers (localStorage-backed)
  function createCollapsibleSection(title, contentHtml, sectionId, options) {
    options = options || {};
    var defaultExpanded = options.defaultExpanded !== undefined ? options.defaultExpanded : true;
    var isExpanded = isSectionExpanded(sectionId, defaultExpanded);
    var badge = options.badge || '';
    var actions = options.actions || '';

    return '<div class="mb-4" id="section-' + sectionId + '">' +
      '<button onclick="toggleSection(\'' + sectionId + '\')" class="w-full flex items-center justify-between py-2 text-left group">' +
        '<div class="flex items-center gap-2">' +
          '<svg class="w-4 h-4 text-gray-400 transition-transform ' + (isExpanded ? 'rotate-90' : '') + '" id="chevron-' + sectionId + '" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>' +
          '</svg>' +
          '<h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">' + title + '</h4>' +
          badge +
        '</div>' +
        actions +
      '</button>' +
      '<div id="content-' + sectionId + '" class="' + (isExpanded ? '' : 'hidden') + ' mt-2">' +
        contentHtml +
      '</div>' +
    '</div>';
  }

  function toggleSection(sectionId) {
    var content = document.getElementById('content-' + sectionId);
    var chevron = document.getElementById('chevron-' + sectionId);
    if (!content) return;

    var isHidden = content.classList.contains('hidden');
    if (isHidden) {
      content.classList.remove('hidden');
      if (chevron) chevron.classList.add('rotate-90');
      try { localStorage.setItem('section-' + sectionId, 'expanded'); } catch (e) {}
    } else {
      content.classList.add('hidden');
      if (chevron) chevron.classList.remove('rotate-90');
      try { localStorage.setItem('section-' + sectionId, 'collapsed'); } catch (e) {}
    }
  }

  function isSectionExpanded(sectionId, defaultExpanded) {
    try {
      var state = localStorage.getItem('section-' + sectionId);
      if (state === 'expanded') return true;
      if (state === 'collapsed') return false;
    } catch (e) {}
    return defaultExpanded !== undefined ? defaultExpanded : true;
  }

  // =========================================================================
  // Data Loading (adapted from workspace.js viewMatter)
  // =========================================================================

  async function loadMatterDetails(matterId, options) {
    options = options || {};

    try {
      // Parallel API fetches
      var fetchOpts = {};
      if (options.bustCache) {
        fetchOpts.bustCache = true;
      }

      var results = await Promise.allSettled([
        api.getMatter(matterId, fetchOpts),
        api.getMatterPermissions(matterId).catch(function () { return { permissions: [] }; }),
        api.getMatterActivity(matterId, 20, 0).catch(function () { return { activities: [], pagination: {} }; }),
        api.getMatterConversations(matterId, 25, 0).catch(function () { return { sessions: [], pagination: {} }; }),
        api.getMatterFiles(matterId, { page: 1, pageSize: 500 }).catch(function () { return { files: [], pagination: { total_count: 0 } }; }),
        api.getOrphanedFiles(matterId).catch(function () { return { orphaned_files: [], total_count: 0 }; }),
        api.getMatterTasks(matterId).catch(function () { return { tasks: [], total_count: 0 }; }),
        api.getComments(matterId, { limit: 0 }).catch(function () { return { data: [], pagination: { total: 0 } }; })
      ]);

      // Extract results (match shapes returned by api.js methods)
      var matterResult = results[0].status === 'fulfilled' ? results[0].value : null;
      if (!matterResult || !matterResult.matter) {
        console.error('[loadMatterDetails] FAILED — matterResult:', matterResult);
        Lex.Toast.error('Failed to load matter details');
        Lex.Nav.go('workspaces.html');
        return;
      }

      var matter = matterResult.matter;
      var permissions = results[1].status === 'fulfilled' ? (results[1].value.permissions || []) : [];
      var activityData = results[2].status === 'fulfilled' ? results[2].value : { activities: [], pagination: {} };
      var chatsData = results[3].status === 'fulfilled' ? results[3].value : { sessions: [], pagination: {} };
      var docsData = results[4].status === 'fulfilled' ? results[4].value : { files: [], pagination: { total_count: 0 } };
      var orphanedData = results[5].status === 'fulfilled' ? results[5].value : { orphaned_files: [], total_count: 0 };
      var tasksData = results[6].status === 'fulfilled' ? results[6].value : { tasks: [], total_count: 0 };
      var commentsResult = results[7].status === 'fulfilled' ? results[7].value : { data: [], pagination: { total: 0 } };
      var commentCount = (commentsResult.pagination && commentsResult.pagination.total) || 0;

      // Extract contacts and notes from matter object (shadow tables)
      var contacts = matter.contacts || [];
      var notes = matter.notes || [];

      // Store in state
      currentMatterData = {
        matter: matter,
        matter_id: matter.matter_id,
        permissions: permissions,
        activities: activityData.activities || [],
        activityPagination: activityData.pagination || {},
        chats: chatsData.sessions || [],
        chatPagination: chatsData.pagination || {},
        documents: docsData.files || [],
        docPagination: docsData.pagination || { total_count: 0 },
        orphanedFiles: orphanedData.orphaned_files || [],
        tasks: tasksData.tasks || [],
        contacts: contacts,
        notes: notes,
        commentCount: commentCount
      };

      currentTaskMatterId = matter.matter_id;
      currentTasksList = currentMatterData.tasks;

      // Set globals for shared components
      window.currentViewedMatter = matter;
      window.currentMatterData = currentMatterData;

      // Set active matter context
      if (window.Lex && window.Lex.state) {
        window.Lex.state.setActiveMatter(matter.matter_id);
      }

    } catch (error) {
      console.error('[loadMatterDetails] Error:', error);
      Lex.Toast.error(error.message || 'Failed to load matter');
      Lex.Nav.go('workspaces.html');
    }
  }

  // =========================================================================
  // Banner Rendering (NEW — not in workspace.js)
  // =========================================================================

  function renderBanner(matter) {
    // Breadcrumb — adjust origin based on navigation source
    var name = matter.matter_name || matter.name || 'Untitled';
    var breadcrumb = document.getElementById('matterBreadcrumb');
    if (breadcrumb) {
      var origin;
      if (_navContext && _navContext.source === 'chat') {
        var chatLabel = _navContext.conversationTitle || 'Conversation';
        var chatHref = 'chat-v2.html';
        if (_navContext.conversationId) {
          chatHref += '?session=' + encodeURIComponent(_navContext.conversationId);
        }
        origin = { label: chatLabel, href: chatHref };
      } else {
        origin = { label: 'Workspaces & Matters', href: 'workspaces.html' };
      }
      breadcrumb.items = [origin, { label: name }];
    }

    // Banner heading
    var banner = document.getElementById('matterBanner');
    if (!banner) return;

    var name = matter.matter_name || matter.name || 'Untitled';
    banner.heading = name;

    // Setting heading triggers an async re-render (queueMicrotask) that rebuilds
    // the entire banner DOM. We must inject badges AFTER that re-render completes.
    requestAnimationFrame(function () {
      _injectBannerMeta(banner, matter);
    });
  }


  function _injectBannerMeta(banner, matter) {
    var textEl = banner.querySelector('.lex-banner-text');
    if (!textEl) return;

    // Remove empty subtitle <p> if lex-banner rendered one
    var subtitleP = textEl.querySelector('.lex-banner-subtitle');
    if (subtitleP && !subtitleP.textContent.trim()) subtitleP.remove();

    var metaRow = textEl.querySelector('.matter-meta-row');
    if (!metaRow) {
      metaRow = document.createElement('div');
      metaRow.className = 'matter-meta-row';
      metaRow.style.cssText = 'display:flex;align-items:center;gap:0.5rem;margin-top:4px;font-size:0.8125rem;color:var(--lex-text-secondary);flex-wrap:wrap;';
      textEl.appendChild(metaRow);
    }

    var matterType = matter.matter_type || 'matter';
    var typeLabel = matterType === 'workspace' ? 'Workspace' : 'Matter';
    var typeColor = matterType === 'workspace' ? 'bg-gray-100 text-gray-700' : 'bg-blue-100 text-blue-800';

    var status = matter.status || 'active';
    var statusColors = {
      active: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      closed: 'bg-gray-100 text-gray-800',
      archived: 'bg-purple-100 text-purple-800'
    };
    var statusColor = statusColors[status] || 'bg-gray-100 text-gray-800';
    var statusLabel = status.charAt(0).toUpperCase() + status.substring(1);

    var editDate = matter.updated_at || matter.created_at;
    var editText = editDate ? 'Last edited ' + timeAgo(editDate) : '';

    metaRow.innerHTML =
      '<span class="font-mono text-xs">' + escapeHtml(matter.matter_id || '') + '</span>' +
      '<span class="opacity-40">&middot;</span>' +
      '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + typeColor + '">' + escapeHtml(typeLabel) + '</span>' +
      '<span class="opacity-40">&middot;</span>' +
      '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + statusColor + '">' + escapeHtml(statusLabel) + '</span>' +
      (editText ? '<span class="opacity-40">&middot;</span><span class="text-xs">' + escapeHtml(editText) + '</span>' : '');
  }


  function renderDescription(matter) {
    var area = document.getElementById('descriptionArea');
    var text = document.getElementById('descriptionText');
    var toggle = document.getElementById('descriptionToggle');
    if (!area || !text) return;

    var desc = matter.description || '';
    if (!desc.trim()) {
      area.classList.add('hidden');
      return;
    }

    text.textContent = desc;
    area.classList.remove('hidden');

    // Show toggle if text is long enough to be clamped (roughly > 2 lines)
    // We check after render with a short delay so layout is computed
    setTimeout(function () {
      if (text.scrollHeight > text.clientHeight) {
        toggle.classList.remove('hidden');
      } else {
        toggle.classList.add('hidden');
      }
    }, 50);

    var expanded = false;
    toggle.onclick = function () {
      expanded = !expanded;
      if (expanded) {
        text.classList.remove('line-clamp-2');
        toggle.textContent = 'Show less';
      } else {
        text.classList.add('line-clamp-2');
        toggle.textContent = 'Show more';
      }
    };
  }

  function setupHeaderActions(matter) {
    var matterId = matter.matter_id;

    // Refresh via topbar (global refresh button in navbar)
    trackDocListener('lex-refresh', function (e) {
      e.preventDefault();
      refreshCurrentMatter();
    });

    // ── Banner action buttons (delegated on banner to survive re-renders) ──
    // lex-banner's _restoreContent() clones children on every re-render,
    // so direct onclick handlers get lost. Event delegation on the banner
    // element itself is immune to this.
    var banner = document.getElementById('matterBanner');
    if (banner) {
      banner.addEventListener('click', function (e) {
        var target = e.target.closest('[id]');
        if (!target) return;

        var id = target.id;

        // Ask Matter
        if (id === 'askMatterBtn') {
          Lex.Nav.go('chat-v2.html', { params: { matter: matterId } });
          return;
        }

        // More options toggle
        if (id === 'headerMenuBtn') {
          e.stopPropagation();
          var dd = banner.querySelector('#headerOptionsDropdown');
          if (dd) dd.classList.toggle('hidden');
          return;
        }

        // Dropdown actions
        var dropdown = banner.querySelector('#headerOptionsDropdown');

        if (id === 'headerOptionsEdit') {
          if (dropdown) dropdown.classList.add('hidden');
          openEditMatterModal(matter);
          return;
        }
        if (id === 'headerOptionsStatus') {
          if (dropdown) dropdown.classList.add('hidden');
          openStatusChangeModal(matter);
          return;
        }
        if (id === 'headerOptionsDelete') {
          if (dropdown) dropdown.classList.add('hidden');
          deleteMatter(matterId);
          return;
        }
      });

      // Close dropdown on click outside
      trackDocListener('click', function (e) {
        var dd = banner.querySelector('#headerOptionsDropdown');
        if (dd && !dd.classList.contains('hidden')) {
          var menuBtn = banner.querySelector('#headerMenuBtn');
          if (!dd.contains(e.target) && e.target !== menuBtn) {
            dd.classList.add('hidden');
          }
        }
      });
    }

    // Tab bar — event delegation (avoids inline onclick before script loads)
    var tabBar = document.getElementById('tabBar');
    if (tabBar) {
      tabBar.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tab]');
        if (btn) switchMatterTab(btn.dataset.tab);
      });
    }

    // Dock segmented control
    var dockToggle = document.getElementById('dockToggle');
    if (dockToggle) {
      dockToggle.addEventListener('lex-change', function (e) {
        var val = e.detail && e.detail.value;
        if (val) switchDockPanel(val);
      });
    }

    // Card action delegation — single listener handles ALL lex-card action buttons
    trackDocListener('card-action', function (e) {
      if (!e.detail || !e.target) return;
      var card = e.target.closest('lex-card');
      if (!card || !card.id) return;
      var action = e.detail.action;
      var mid = currentMatterData && currentMatterData.matter && currentMatterData.matter.matter_id;
      if (!mid) return;

      if (card.id === 'sharedWithCard' && (action === 'share' || action === 'edit')) {
        openManageShareModal(mid);
      } else if (card.id === 'customFieldsCard' && action === 'edit') {
        openEditCustomFieldsModal(mid);
      } else if (card.id === 'contactsCard' && action === 'plus') {
        openAddContactModal(mid);
      } else if (card.id === 'linkedMattersCard' && action === 'plus') {
        openCreateLinkModal(mid, true);
      } else if (card.id === 'connectedDataCard' && action === 'link') {
        showManualConnectModal(mid);
      } else if (card.id === 'matterProfileCard' && action === 'refresh') {
        generateMatterIntelligence(mid);
      }
    });
  }

  // =========================================================================
  // Tab System (from workspace.js)
  // =========================================================================

  function _positionTabIndicator(tabBtn, animate) {
    var indicator = document.getElementById('tabIndicator');
    var tabBar = document.getElementById('tabBar');
    if (!indicator || !tabBar || !tabBtn) return;

    var barRect = tabBar.getBoundingClientRect();
    var btnRect = tabBtn.getBoundingClientRect();
    var left = btnRect.left - barRect.left + tabBar.scrollLeft;

    if (!animate) {
      indicator.style.transition = 'none';
    }
    indicator.style.left = left + 'px';
    indicator.style.width = btnRect.width + 'px';

    if (!animate) {
      // Force reflow then restore transition
      indicator.offsetWidth;
      indicator.style.transition = 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    }
  }

  function switchMatterTab(tab) {
    var tabs = ['activity', 'notes', 'tasks', 'comments', 'documents', 'conversations', 'skills', 'docGeneration', 'analytics'];
    var activeBtn = null;

    tabs.forEach(function (t) {
      var tabBtn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.substring(1));
      var content = document.getElementById('tabContent' + t.charAt(0).toUpperCase() + t.substring(1));

      if (t === tab) {
        activeBtn = tabBtn;
        if (tabBtn) {
          tabBtn.style.color = 'var(--lex-text-accent)';
          tabBtn.classList.remove('text-gray-500');
        }
        if (content) content.classList.remove('hidden');
      } else {
        if (tabBtn) {
          tabBtn.style.color = '';
          tabBtn.classList.add('text-gray-500');
        }
        if (content) content.classList.add('hidden');
      }
    });

    // Slide the indicator to the active tab
    var shouldAnimate = !!_tabIndicatorInitialized;
    if (activeBtn) {
      _positionTabIndicator(activeBtn, shouldAnimate);
      _tabIndicatorInitialized = true;
    }

    // Render content for the selected tab
    if (!currentMatterData) return;

    var m = currentMatterData;
    switch (tab) {
      case 'activity':
        // Always re-fetch activity data to capture changes from other tabs (notes, tasks, etc.)
        renderActivityTab(m.matter, m.activities, m.activityPagination);
        refreshActivityData(m.matter.matter_id);
        break;
      case 'documents':
        renderDocumentsTab(m.matter, m.documents, m.docPagination, m.orphanedFiles);
        break;
      case 'conversations':
        renderConversationsTab(m.matter, m.chats, m.chatPagination);
        break;
      case 'comments':
        renderCommentsTab(m.matter, m.commentCount);
        break;
      case 'tasks':
        renderTasksTab(m.matter, m.tasks);
        break;
      case 'notes':
        renderNotesTab(m.matter);
        break;
      case 'skills':
        renderSkillsTab(m.matter);
        break;
      case 'docGeneration':
        renderDocGenerationTab(m.matter);
        break;
      case 'analytics':
        renderMatterAnalyticsTab(m.matter);
        break;
    }

    // Update URL param without navigation
    Lex.Nav.updateParams({ tab: tab });
  }

  function getCurrentActiveTab() {
    var tabs = ['activity', 'notes', 'tasks', 'comments', 'documents', 'conversations', 'skills', 'docGeneration', 'analytics'];
    for (var i = 0; i < tabs.length; i++) {
      var content = document.getElementById('tabContent' + tabs[i].charAt(0).toUpperCase() + tabs[i].substring(1));
      if (content && !content.classList.contains('hidden')) return tabs[i];
    }
    return 'activity';
  }

  // =========================================================================
  // Dock System (from workspace.js)
  // =========================================================================

  function switchDockPanel(panel) {
    var detailsPanel = document.getElementById('dockPanelDetails');
    var contextPanel = document.getElementById('dockPanelContext');
    var toggle = document.getElementById('dockToggle');

    if (panel === 'details') {
      if (detailsPanel) detailsPanel.classList.remove('hidden');
      if (contextPanel) contextPanel.classList.add('hidden');
    } else {
      if (detailsPanel) detailsPanel.classList.add('hidden');
      if (contextPanel) contextPanel.classList.remove('hidden');
    }

    // Sync the segmented control if called programmatically
    if (toggle && toggle.value !== panel) {
      toggle.value = panel;
    }
  }

  function renderDockDetailsPanel(matter, permissions) {
    var panel = document.getElementById('dockPanelDetails');
    if (!panel) return;

    var html = '<div class="flex flex-col gap-4">';

    // Information card (read-only — edit via header menu)
    html += '<lex-card id="infoCard" heading="Information" variant="flat" padding="compact">' +
      '<div class="space-y-2.5 text-sm">' +
        '<div class="flex justify-between"><span class="text-gray-500">Client</span><span class="text-gray-900 font-medium">' + escapeHtml(matter.client_name || 'N/A') + '</span></div>' +
        '<div class="flex justify-between"><span class="text-gray-500">Type</span><span class="text-gray-900">' + (matter.matter_type === 'workspace' ? 'Workspace' : 'Matter') + '</span></div>' +
        '<div class="flex justify-between"><span class="text-gray-500">Status</span><span class="text-gray-900">' + (matter.status ? matter.status.charAt(0).toUpperCase() + matter.status.substring(1) : 'Active') + '</span></div>' +
        '<div class="flex justify-between"><span class="text-gray-500">Created</span><span class="text-gray-900">' + formatDate(matter.created_at) + '</span></div>' +
        '<div class="flex justify-between"><span class="text-gray-500">Last Updated</span><span class="text-gray-900">' + formatDate(matter.updated_at) + '</span></div>' +
      '</div>' +
    '</lex-card>';

    // Shared With card
    var shareActions = JSON.stringify([{icon:'share',label:'Add'},{icon:'edit',label:'Manage'}]).split('"').join('&quot;');
    html += '<lex-card id="sharedWithCard" heading="Shared With" variant="flat" padding="compact" actions=\'' + shareActions + '\'>';
    if (matter.visibility === 'organization') {
      html += '<p class="text-sm text-gray-500">Visible to entire organization</p>';
    } else if (permissions && permissions.length > 0) {
      html += '<div class="flex items-center flex-wrap gap-2">';
      var showCount = Math.min(permissions.length, 3);
      for (var si = 0; si < showCount; si++) {
        html += buildUserChip(permissions[si], si);
      }
      if (permissions.length > 3) {
        html += '<button onclick="openSharedWithDrawer()" class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer lex-bg-neutral lex-text-neutral transition-all hover:shadow-sm">+' + (permissions.length - 3) + ' more</button>';
      }
      html += '</div>';
    } else {
      html += '<p class="text-sm text-gray-500">Private — only you have access</p>';
    }
    html += '</lex-card>';

    // Custom Fields section
    html += '<div id="customFieldsSection"></div>';

    html += '</div>'; // close space-y-4 wrapper

    panel.innerHTML = html;

    // Wire shared-with action directly
    var swCard = document.getElementById('sharedWithCard');
    if (swCard) {
      swCard.addEventListener('card-action', function (e) {
        var action = e.detail && e.detail.action;
        if ((action === 'share' || action === 'edit') && matter && matter.matter_id) {
          openManageShareModal(matter.matter_id);
        }
      });
    }

    // Render sub-sections
    renderCustomFieldsSection(matter);
  }

  function renderDockContextPanel(matter) {
    var panel = document.getElementById('dockPanelContext');
    if (!panel) return;

    var html = '<div class="flex flex-col gap-4">';

    // Matter Profile Intelligence section
    html += '<div id="matterProfileSection"></div>';

    // Linked Matters section
    html += '<div id="linkedMattersSection"></div>';

    // Unified Connected Data section (contacts + integrations)
    html += '<div id="connectedDataSection"></div>';

    html += '</div>';

    panel.innerHTML = html;

    // Render sub-sections
    renderMatterProfileSection(matter);
    renderLinkedMattersInDock(matter);
    renderUnifiedConnectedDataDock(matter);
  }

  async function renderUnifiedConnectedDataDock(matter) {
    var section = document.getElementById('connectedDataSection');
    if (!section) return;

    try {
      // Fetch contacts and connector data
      var contacts = (currentMatterData && currentMatterData.contacts) || matter.contacts || [];
      var response = await api.getMatterConnectorData(matter.matter_id);
      var dataGroups = response.data || {};

      // Flatten connector records
      var records = [];
      var groupKeys = Object.keys(dataGroups);
      for (var gi = 0; gi < groupKeys.length; gi++) {
        var groupRecords = dataGroups[groupKeys[gi]];
        if (Array.isArray(groupRecords)) {
          for (var ri = 0; ri < groupRecords.length; ri++) {
            records.push(groupRecords[ri]);
          }
        }
      }

      var totalCount = contacts.length + records.length;
      var cardActions = JSON.stringify([
        {icon:'plus', label:'Add'},
        {icon:'maximize-2', label:'View All'}
      ]).split('"').join('&quot;');

      var headingText = 'Connected Data' + (totalCount > 0 ? ' (' + totalCount + ')' : '');

      var html = '<lex-card id="connectedDataCard" heading="' + headingText + '" variant="flat" padding="compact" actions=\'' + cardActions + '\'>';

      if (totalCount === 0) {
        html += '<p class="text-sm text-gray-500">No connected data</p>';
      } else {
        html += '<div class="space-y-3">';

        // Contacts chips
        if (contacts.length > 0) {
          html += '<div>';
          html += '<p class="text-xs font-medium text-gray-500 mb-1.5">Contacts</p>';
          html += '<div class="flex items-center flex-wrap gap-2">';
          var showContacts = Math.min(contacts.length, 3);
          for (var ci = 0; ci < showContacts; ci++) {
            html += buildContactChip(contacts[ci], ci, matter.matter_id);
          }
          if (contacts.length > 3) {
            html += '<span class="text-xs text-gray-500">+' + (contacts.length - 3) + ' more</span>';
          }
          html += '</div></div>';
        }

        // Connector records
        if (records.length > 0) {
          if (contacts.length > 0) {
            html += '<div style="border-top:1px solid var(--lex-border-subtle);margin:4px 0;"></div>';
          }
          html += '<div>';
          html += '<p class="text-xs font-medium text-gray-500 mb-1.5">Integrations</p>';
          records.slice(0, 5).forEach(function (record) {
            var entityLabel = record.entity_type ? record.entity_type.split('_').join(' ') : 'Unknown';
            html += '<div class="p-2 rounded-lg border border-gray-200 text-xs">' +
              '<div class="flex items-center gap-2 mb-1">' +
                '<span class="px-1.5 py-0.5 rounded font-medium" style="background:var(--lex-bg-accent-soft);color:var(--lex-text-accent)">' + escapeHtml(record.connector_name || '') + '</span>' +
                '<span class="text-gray-500">' + entityLabel + '</span>' +
              '</div>' +
              '<p class="text-gray-700 truncate">' + escapeHtml(record.data?.name || record.data?.title || record.external_id || '') + '</p>' +
            '</div>';
          });
          if (records.length > 5) {
            html += '<a href="workspace-data.html?id=' + encodeURIComponent(matter.matter_id) + '" class="block text-xs text-blue-600 hover:text-blue-800 text-center cursor-pointer">+ ' + (records.length - 5) + ' more records</a>';
          }
          html += '</div>';
        }

        html += '</div>';
      }
      html += '</lex-card>';

      section.innerHTML = html;

      // Wire card actions
      var card = document.getElementById('connectedDataCard');
      if (card) {
        card.addEventListener('card-action', function (e) {
          if (!e.detail) return;
          if (e.detail.action === 'maximize-2') {
            // Navigate to full workspace data visualization page
            window.location.href = 'workspace-data.html?id=' + encodeURIComponent(matter.matter_id);
          } else if (e.detail.action === 'plus') {
            openConnectedDataModal(matter);
          }
        });
      }
    } catch (error) {
      console.error('[renderUnifiedConnectedDataDock] Error:', error);
      section.innerHTML = '';
    }
  }

  function buildContactChip(contact, index, matterId) {
    var firstName = contact.first_name || contact.display_name || 'Contact';
    var lastInitial = (contact.last_name || '')[0] || '';
    var label = firstName + (lastInitial ? ' ' + lastInitial + '.' : '');
    var initial = (firstName[0] || 'C');
    return '<button onclick="openContactDetail(\'' + contact.id + '\', \'' + matterId + '\')" class="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all hover:shadow-sm" style="background: var(--lex-color-blue-50, #eff6ff); color: var(--lex-color-blue-700, #1d4ed8)">' +
      '<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style="background: var(--lex-color-blue-600, #2563eb)">' + initial + '</span>' +
      escapeHtml(label) +
    '</button>';
  }

  // =========================================================================
  // Linked Matters — flat dock section
  // =========================================================================

  function navigateToMatter(matterId) {
    Lex.Nav.go('workspace-details.html', {
      params: { id: matterId, tab: 'activity' },
      context: { matterId: matterId, tab: 'activity' }
    });
  }

  function buildLinkedMatterChip(link) {
    var name = link.linked_name || 'Unknown';
    var linkedId = link.linked_entity_id || '';
    var initial = (name[0] || 'M');
    return '<button onclick="navigateToMatter(\'' + linkedId + '\')" class="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all hover:shadow-sm" style="background: var(--lex-color-green-50, #f0fdf4); color: var(--lex-color-green-700, #15803d)">' +
      '<span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style="background: var(--lex-color-green-600, #16a34a)">' + initial + '</span>' +
      escapeHtml(name) +
    '</button>';
  }

  async function renderLinkedMattersInDock(matter) {
    var section = document.getElementById('linkedMattersSection');
    if (!section) return;

    var isWorkspace = matter.matter_type === 'workspace';

    // Only show linked matters for workspaces
    if (!isWorkspace) {
      section.innerHTML = '';
      return;
    }

    try {
      var response = await fetch(api.baseUrl + '/api/v1/entity-links/matter/' + matter.matter_id, {
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Failed to load linked matters');
      var data = await response.json();

      // Flatten all link categories into a single array
      var allLinks = [];
      var links = data.links || {};
      var categories = ['workspace_matters', 'parent_matters', 'child_matters', 'shadow_records'];
      for (var ci = 0; ci < categories.length; ci++) {
        var cat = links[categories[ci]];
        if (cat && cat.length > 0) {
          for (var li = 0; li < cat.length; li++) {
            allLinks.push(cat[li]);
          }
        }
      }

      // Store for drawer use
      currentMatterData._allLinks = allLinks;

      var linkActions = isWorkspace ? JSON.stringify([{icon:'plus',label:'Add'}]).split('"').join('&quot;') : '';
      var html = '<lex-card id="linkedMattersCard" heading="Linked Matters" variant="flat" padding="compact"' + (linkActions ? ' actions=\'' + linkActions + '\'' : '') + '>';

      if (allLinks.length === 0) {
        html += '<p class="text-sm text-gray-500">No linked matters</p>';
      } else {
        html += '<div class="flex items-center flex-wrap gap-2">';
        var showCount = Math.min(allLinks.length, 3);
        for (var si = 0; si < showCount; si++) {
          html += buildLinkedMatterChip(allLinks[si]);
        }
        if (allLinks.length > 3) {
          html += '<button onclick="openLinkedMattersDrawer()" class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer lex-bg-neutral lex-text-neutral transition-all hover:shadow-sm">+' + (allLinks.length - 3) + ' more</button>';
        }
        html += '</div>';
      }
      html += '</lex-card>';

      section.innerHTML = html;

      // Wire add-link action directly (only for workspaces)
      if (isWorkspace) {
        var lmCard = document.getElementById('linkedMattersCard');
        if (lmCard) {
          lmCard.addEventListener('card-action', function (e) {
            if (e.detail && e.detail.action === 'plus' && matter && matter.matter_id) {
              openCreateLinkModal(matter.matter_id, true);
            }
          });
        }
      }
    } catch (error) {
      console.error('[renderLinkedMattersInDock] Error:', error);
      section.innerHTML = '';
    }
  }

  // =========================================================================
  // Contacts Drawer
  // =========================================================================

  function openContactsDrawer() {
    if (!currentMatterData) return;
    var contacts = currentMatterData.contacts || [];
    var matterId = currentMatterData.matter && currentMatterData.matter.matter_id;

    var modal = document.getElementById('contactsDrawer');
    if (!modal) return;

    var listEl = document.getElementById('contactsDrawerList');
    if (!listEl) return;

    var html = '';
    if (contacts.length === 0) {
      html = '<p class="text-sm text-gray-500 text-center py-4">No contacts yet.</p>';
    } else {
      html = '<div class="space-y-1">';
      for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i];
        var name = c.display_name || ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'Unknown';
        var initial = (c.first_name || name)[0] || 'C';
        html += '<button onclick="openContactDetail(\'' + c.id + '\', \'' + matterId + '\')" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors">' +
          '<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style="background: var(--lex-color-blue-600, #2563eb)">' + initial + '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="text-sm text-gray-900 truncate font-medium">' + escapeHtml(name) + '</p>' +
            (c.email ? '<p class="text-xs text-gray-500 truncate">' + escapeHtml(c.email) + '</p>' : '') +
          '</div>' +
        '</button>';
      }
      html += '</div>';
    }

    listEl.innerHTML = html;
    modal.open = true;
  }

  // =========================================================================
  // Linked Matters Drawer
  // =========================================================================

  function openLinkedMattersDrawer() {
    if (!currentMatterData) return;
    var allLinks = currentMatterData._allLinks || [];

    var modal = document.getElementById('linkedMattersDrawer');
    if (!modal) return;

    var listEl = document.getElementById('linkedMattersDrawerList');
    if (!listEl) return;

    var html = '';
    if (allLinks.length === 0) {
      html = '<p class="text-sm text-gray-500 text-center py-4">No linked matters.</p>';
    } else {
      html = '<div class="space-y-1">';
      for (var i = 0; i < allLinks.length; i++) {
        var link = allLinks[i];
        var name = link.linked_name || 'Unknown';
        var linkedId = link.linked_entity_id || '';
        var initial = (name[0] || 'M');
        var typeLabel = link.link_type ? link.link_type.split('_').join(' ') : '';
        html += '<button onclick="navigateToMatter(\'' + linkedId + '\')" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 text-left transition-colors">' +
          '<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style="background: var(--lex-color-green-600, #16a34a)">' + initial + '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="text-sm text-gray-900 truncate font-medium">' + escapeHtml(name) + '</p>' +
            '<div class="flex items-center gap-2">' +
              '<span class="text-xs text-gray-400 font-mono">' + escapeHtml(linkedId) + '</span>' +
              (typeLabel ? '<span class="text-xs text-gray-400">' + escapeHtml(typeLabel) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>' +
        '</button>';
      }
      html += '</div>';
    }

    listEl.innerHTML = html;
    modal.open = true;
  }

  // =========================================================================
  // Refresh
  // =========================================================================

  async function refreshCurrentMatter() {
    if (!currentMatterData || !currentMatterData.matter_id) return;
    var matterId = currentMatterData.matter_id;
    var activeTab = getCurrentActiveTab();

    // Reset analytics cache so refreshed data is fetched on next visit
    _analyticsLoaded = false;

    redactPage(true);
    await loadMatterDetails(matterId, { bustCache: true });

    if (currentMatterData) {
      renderBanner(currentMatterData.matter);
      renderDescription(currentMatterData.matter);
      renderDockDetailsPanel(currentMatterData.matter, currentMatterData.permissions);
      renderDockContextPanel(currentMatterData.matter);
      switchMatterTab(activeTab);
    }
    redactPage(false);
  }

  // =========================================================================
  // Delete Matter
  // =========================================================================

  function deleteMatter(matterId) {
    Lex.Modal.confirm(
      'Delete Matter',
      'Are you sure you want to delete this matter? This action cannot be undone.',
      async function () {
        try {
          await api.deleteMatter(matterId);
          Lex.Toast.success('Matter deleted');
          Lex.Nav.go('workspaces.html');
        } catch (error) {
          Lex.Toast.error(error.message || 'Failed to delete matter');
        }
      }
    );
  }

  // =========================================================================
  // PLACEHOLDER — Additional sections added by subsequent edits
  // Tab renderers, modal handlers, window globals, lifecycle
  // =========================================================================

  // =========================================================================
  // Activity Tab
  // =========================================================================

  function renderActivityTab(matter, activities, pagination) {
    var container = document.getElementById('tabContentActivity');

    if (!container) {
      console.warn('[renderActivityTab] Content element not found - tab may not be visible');
      return;
    }

    if (!activities || activities.length === 0) {
      container.innerHTML =
        '<div class="text-center py-12">' +
          '<div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">' +
            '<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
            '</svg>' +
          '</div>' +
          '<h4 class="text-lg font-semibold text-gray-900 mb-2">No activity yet</h4>' +
          '<p class="text-gray-500">Activity related to this matter will appear here</p>' +
        '</div>';
      return;
    }

    // Group activities by date
    var groupedActivities = {};
    for (var ai = 0; ai < activities.length; ai++) {
      var activity = activities[ai];
      var dateLabel = new Date(activity.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      if (!groupedActivities[dateLabel]) {
        groupedActivities[dateLabel] = [];
      }
      groupedActivities[dateLabel].push(activity);
    }

    var pag = pagination || {};
    var currentOffset = pag.offset || 0;
    var limit = pag.limit || 20;
    var total = pag.total || 0;
    var hasMore = (currentOffset + activities.length) < total;
    var currentPage = Math.floor(currentOffset / limit) + 1;
    var totalPages = Math.ceil(total / limit) || 1;

    var groupHtml = '';
    var dateKeys = Object.keys(groupedActivities);
    for (var di = 0; di < dateKeys.length; di++) {
      var dateKey = dateKeys[di];
      var dayActivities = groupedActivities[dateKey];
      var itemsHtml = '';
      for (var ii = 0; ii < dayActivities.length; ii++) {
        var act = dayActivities[ii];
        itemsHtml +=
          '<div class="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">' +
            '<div class="w-8 h-8 ' + getActivityBgColor(act) + ' rounded-full flex items-center justify-center flex-shrink-0">' +
              getActivityIcon(act) +
            '</div>' +
            '<div class="flex-1 min-w-0">' +
              '<p class="text-sm text-gray-900 leading-relaxed">' + getActivityDescription(act) + '</p>' +
              '<p class="text-xs text-gray-500 mt-1">' + timeAgo(act.created_at) + '</p>' +
            '</div>' +
          '</div>';
      }
      groupHtml +=
        '<lex-card heading="' + escapeHtml(dateKey) + '">' +
          '<div class="space-y-3">' + itemsHtml + '</div>' +
        '</lex-card>';
    }

    var paginationHtml = '';
    if (total > 0) {
      paginationHtml = '<lex-pagination id="activityPagination" class="mt-6 border-t pt-4" page="' + currentPage + '" total-pages="' + totalPages + '" total="' + total + '" limit="' + limit + '"></lex-pagination>';
    }

    container.innerHTML =
      '<div class="space-y-6">' +
        groupHtml +
        paginationHtml +
      '</div>';

    // Wire up pagination
    var actPag = document.getElementById('activityPagination');
    if (actPag) {
      actPag.addEventListener('page-change', function (e) {
        var newPage = e.detail && e.detail.page;
        if (newPage) loadActivityPage(matter.matter_id, (newPage - 1) * limit);
      });
    }
  }

  // Activity helper: icon SVG for activity type
  function getActivityIcon(activity) {
    var activityType = activity.action_type;

    if (activity.type === 'comment') {
      activityType = 'comment';
    } else if (activity.type === 'system_event') {
      activityType = activity.event_type;
    }

    var icons = {
      'comment': '<svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>',
      'document_uploaded': '<svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>',
      'document_viewed': '<svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>',
      'document_deleted': '<svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>',
      'matter_created': '<svg class="w-4 h-4 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>',
      'matter_updated': '<svg class="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>',
      'chat_message': '<svg class="w-4 h-4 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>',
      'conversation_created': '<svg class="w-4 h-4 lex-text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>',
      'task_created': '<svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>',
      'task_updated': '<svg class="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>',
      'user_shared': '<svg class="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>'
    };
    return icons[activityType] || '<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
  }

  // Activity helper: background color class for activity type
  function getActivityBgColor(activity) {
    var activityType = activity.action_type;

    if (activity.type === 'comment') {
      activityType = 'comment';
    } else if (activity.type === 'system_event') {
      activityType = activity.event_type;
    }

    var colors = {
      'comment': 'bg-blue-100',
      'document_uploaded': 'bg-blue-100',
      'document_viewed': 'bg-green-100',
      'document_deleted': 'bg-red-100',
      'matter_created': 'lex-bg-accent-soft',
      'matter_updated': 'bg-yellow-100',
      'chat_message': 'lex-bg-accent-soft',
      'conversation_created': 'lex-bg-accent-soft',
      'task_created': 'bg-green-100',
      'task_updated': 'bg-yellow-100',
      'user_shared': 'bg-teal-100'
    };
    return colors[activityType] || 'bg-gray-100';
  }

  // Activity helper: human-readable description for an activity
  function getActivityDescription(activity) {
    var userName = (activity.user)
      ? (activity.user.first_name + ' ' + activity.user.last_name)
      : 'Someone';

    // Use display_message if provided
    if (activity.display_message) {
      return '<strong>' + escapeHtml(userName) + '</strong> ' + escapeHtml(activity.display_message.toLowerCase());
    }

    // Handle comments (old format)
    if (activity.type === 'comment' && activity.content) {
      var actorName = (activity.actor && activity.actor.name) ? activity.actor.name : 'Someone';
      return '<strong>' + escapeHtml(actorName) + '</strong> commented: ' + escapeHtml(activity.content);
    }

    // Handle system events (old format — NO regex, use split/join)
    if (activity.type === 'system_event' && activity.event_type) {
      var sysActorName = (activity.actor && activity.actor.name) ? activity.actor.name : 'System';
      return '<strong>' + escapeHtml(sysActorName) + '</strong> ' + escapeHtml(activity.event_type.split('_').join(' '));
    }

    // Fallback for old action_type format
    if (activity.action_type) {
      var descriptions = {
        'document_uploaded': 'Document uploaded: ' + ((activity.metadata && activity.metadata.filename) ? activity.metadata.filename : 'file'),
        'document_viewed': 'Document viewed: ' + ((activity.metadata && activity.metadata.filename) ? activity.metadata.filename : 'file'),
        'matter_created': 'Matter was created',
        'matter_updated': 'Matter was updated' + ((activity.metadata && activity.metadata.field) ? ': ' + activity.metadata.field : ''),
        'chat_message': 'New chat message',
        'user_shared': 'Shared with ' + ((activity.metadata && activity.metadata.user_email) ? activity.metadata.user_email : 'user')
      };
      return escapeHtml(descriptions[activity.action_type] || activity.action_type.split('_').join(' '));
    }

    // Fallback to event_type — NO regex
    if (activity.event_type) {
      var evtLabel = activity.event_type.split('_').join(' ').split('.').join(' ');
      return '<strong>' + escapeHtml(userName) + '</strong> ' + escapeHtml(evtLabel);
    }

    return escapeHtml(activity.description || activity.content || 'Activity');
  }

  // Refresh activity data from API (background, non-blocking)
  async function refreshActivityData(matterId) {
    try {
      var result = await api.getMatterActivity(matterId, 20, 0);
      if (result && result.activities && currentMatterData) {
        currentMatterData.activities = result.activities;
        currentMatterData.activityPagination = result.pagination || {};
        renderActivityTab(currentMatterData.matter, result.activities, result.pagination);
      }
    } catch (error) {
      // Silently fail — cached data is already rendered as fallback
      console.warn('[refreshActivityData] Failed to refresh:', error.message);
    }
  }

  // Load a specific activity page (for pagination)
  async function loadActivityPage(matterId, offset) {
    try {
      var limit = 20;
      var result = await api.getMatterActivity(matterId, limit, offset);

      if (currentMatterData) {
        currentMatterData.activities = result.activities || [];
        currentMatterData.activityPagination = result.pagination || { total: 0, limit: limit, offset: offset };
        renderActivityTab(currentMatterData.matter, currentMatterData.activities, currentMatterData.activityPagination);
      }
    } catch (error) {
      console.error('[loadActivityPage] Failed to load activity page:', error);
      Lex.Toast.error('Failed to load activity');
    }
  }

  // =========================================================================
  // Documents Tab
  // =========================================================================

  // File type icon helper — NO regex, uses string includes
  function getFileIcon(contentType) {
    if (!contentType) {
      return '<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
    }
    if (contentType.indexOf('pdf') !== -1) {
      return '<svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8.5 13.5v3h1v-1h.5a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1.5zm1 1h.5v1h-.5v-1zm2.5-1v3h1.5a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H12zm1 1h.5v1H13v-1zm2.5-1v3h1v-1.5h.5v-1h-.5v-.5h1v-1h-2z"/></svg>';
    }
    if (contentType.indexOf('word') !== -1 || contentType.indexOf('document') !== -1) {
      return '<svg class="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM9 13l1.5 6 1.5-4 1.5 4 1.5-6h-1l-.75 3-1.25-3.5h-.5L10.25 16 9.5 13H9z"/></svg>';
    }
    if (contentType.indexOf('csv') !== -1 || contentType.indexOf('sheet') !== -1 || contentType.indexOf('excel') !== -1) {
      return '<svg class="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM8 13h2v2H8v-2zm0 3h2v2H8v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2zm3-3h2v2h-2v-2zm0 3h2v2h-2v-2z"/></svg>';
    }
    if (contentType.indexOf('image') !== -1) {
      return '<svg class="w-5 h-5 lex-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>';
    }
    return '<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
  }

  // Format byte size into human-readable string
  function formatSize(bytes) {
    if (!bytes) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Document processing status badge
  function docStatusBadge(status) {
    var badges = {
      'completed': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Ready</span>',
      'active': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">Ready</span>',
      'processing': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-700">Processing</span>',
      'queued': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Queued</span>',
      'pending': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">Pending</span>',
      'cancelled': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">Cancelled</span>',
      'failed': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">Failed</span>',
      'error': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">Error</span>',
      'deleted': '<span data-status-badge class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700">Deleted</span>'
    };
    return badges[status] || badges['pending'];
  }

  function renderDocumentsTab(matter, documents, pagination, orphanedFiles) {
    var container = document.getElementById('tabContentDocuments');
    if (!container) return;

    documents = documents || [];
    orphanedFiles = orphanedFiles || [];

    // Empty state
    if (documents.length === 0 && orphanedFiles.length === 0) {
      container.innerHTML =
        '<div class="py-6">' +
          '<div id="drawerEmptyDropZone" class="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:lex-border-accent transition-colors cursor-pointer mb-6">' +
            '<input type="file" id="drawerEmptyFileInput" multiple accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.pptx,.ppt" class="hidden">' +
            '<div class="text-center">' +
              '<svg class="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>' +
              '</svg>' +
              '<p class="mt-2 text-sm text-gray-600">' +
                '<span class="lex-text-accent hover:lex-text-accent font-medium">Click to upload</span> or drag and drop' +
              '</p>' +
              '<p class="mt-1 text-xs text-gray-500">PDF, Word, Excel, Images up to 50MB</p>' +
            '</div>' +
          '</div>' +
          '<div class="text-center">' +
            '<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>' +
            '</svg>' +
            '<h4 class="text-lg font-semibold text-gray-900 mb-2">No documents yet</h4>' +
            '<p class="text-gray-500">Upload documents to this matter to enable AI-powered search and analysis</p>' +
          '</div>' +
        '</div>';
      setupDrawerUpload(matter, 'drawerEmptyDropZone', 'drawerEmptyFileInput');
      return;
    }

    // Build document list HTML
    var docListHtml = '';
    if (documents.length > 0) {
      // Client-side search filter
      var allDocs = documents;
      var filteredDocs = allDocs;
      if (_docSearch) {
        var searchLower = _docSearch.toLowerCase();
        filteredDocs = allDocs.filter(function (d) {
          var name = (d.original_filename || d.filename || '').toLowerCase();
          return name.indexOf(searchLower) !== -1;
        });
      }

      // Count templates (from filtered set)
      var templateCount = 0;
      for (var tc = 0; tc < filteredDocs.length; tc++) { if (filteredDocs[tc].is_template) templateCount++; }
      var nonTemplateCount = filteredDocs.length - templateCount;

      // Client-side pagination
      var totalCount = filteredDocs.length;
      var currentPage = _docPage;
      var totalPages = Math.ceil(totalCount / _docPageSize) || 1;
      if (currentPage > totalPages) { currentPage = 1; _docPage = 1; }
      var startIdx = (currentPage - 1) * _docPageSize;
      var pageDocs = filteredDocs.slice(startIdx, startIdx + _docPageSize);

      var docItems = '';
      for (var di = 0; di < pageDocs.length; di++) {
        var doc = pageDocs[di];
        var docName = doc.original_filename || doc.filename || '';
        var sourceBadge = '';
        if (doc.source === 'workspace') {
          sourceBadge =
            '<span class="text-gray-300">|</span>' +
            '<span class="inline-flex items-center gap-1 px-2 py-0.5 lex-bg-accent-soft lex-text-accent text-xs font-medium rounded">' +
              '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>' +
              'From Workspace' +
            '</span>';
        } else if (doc.source === 'inherited') {
          sourceBadge =
            '<span class="text-gray-300">|</span>' +
            '<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">' +
              '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>' +
              'Shared' +
            '</span>';
        }

        var actionButtons = '';
        if (doc.status === 'active' || doc.status === 'completed') {
          actionButtons =
            '<button onclick="_navToFileViewer(\'' + doc.id + '\')" class="text-xs text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-1">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>' +
              'View' +
            '</button>' +
            '<button onclick="downloadDocument(\'' + doc.id + '\', \'' + matter.matter_id + '\', \'' + escapeHtml(doc.filename || '') + '\')" class="text-xs lex-text-accent hover:lex-text-accent font-medium flex items-center gap-1">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>' +
              'Download' +
            '</button>';
        } else if ((doc.status === 'pending' || doc.status === 'processing' || doc.status === 'queued') && doc.job_id) {
          actionButtons =
            '<span class="text-xs text-gray-500 italic flex items-center gap-1">' +
              '<svg class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">' +
                '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
                '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
              '</svg>' +
              'Processing...' +
            '</span>';
        } else if (doc.status === 'failed' || doc.status === 'error') {
          if (doc.error_message) {
            var errText = doc.error_message.substring(0, 50) + (doc.error_message.length > 50 ? '...' : '');
            actionButtons +=
              '<span class="text-xs text-red-600 italic flex items-center gap-1" title="' + escapeHtml(doc.error_message) + '">' +
                '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>' +
                escapeHtml(errText) +
              '</span>';
          }
          actionButtons +=
            '<button onclick="retryDocumentIngestion(\'' + doc.id + '\', \'' + matter.matter_id + '\', \'' + escapeHtml(docName) + '\')" class="text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>' +
              'Retry Ingestion' +
            '</button>';
        }

        // Template action buttons (DOCX + PDF)
        var isDocxFile = (doc.content_type || '').indexOf('wordprocessingml') !== -1 ||
                         (doc.filename || '').toLowerCase().endsWith('.docx') ||
                         (doc.original_filename || '').toLowerCase().endsWith('.docx');
        var isPdfFile = (doc.content_type || '') === 'application/pdf' ||
                        (doc.filename || '').toLowerCase().endsWith('.pdf') ||
                        (doc.original_filename || '').toLowerCase().endsWith('.pdf');
        var isTemplateable = isDocxFile || isPdfFile;

        if (isTemplateable && !doc.read_only && (doc.status === 'active' || doc.status === 'completed')) {
          if (doc.is_template) {
            actionButtons +=
              '<button onclick="openDocxTemplateModal(\'' + doc.id + '\', \'' + matter.matter_id + '\', \'' + escapeHtml(docName).split("'").join("\\'") + '\')" class="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1">' +
                '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' +
                'Generate' +
              '</button>' +
              '<button onclick="toggleDocxTemplate(\'' + doc.id + '\', \'' + matter.matter_id + '\', false)" class="text-xs text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1" title="Remove template flag">' +
                '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>' +
                'Unmark' +
              '</button>';
          } else {
            actionButtons +=
              '<button onclick="toggleDocxTemplate(\'' + doc.id + '\', \'' + matter.matter_id + '\', true)" class="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1" title="Mark as document template">' +
                '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>' +
                'Use as Template' +
              '</button>';
          }
        }

        if (!doc.read_only) {
          actionButtons +=
            '<button onclick="replaceDrawerDocument(\'' + doc.id + '\', \'' + matter.matter_id + '\')" class="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1" title="Replace file and re-index" style="display: none;">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>' +
              'Replace' +
            '</button>' +
            '<button onclick="deleteDrawerDocument(\'' + doc.id + '\', \'' + matter.matter_id + '\')" class="text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
              'Delete' +
            '</button>';
        } else {
          actionButtons +=
            '<span class="text-xs text-gray-400 italic flex items-center gap-1">' +
              '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>' +
              'Read-only' +
            '</span>';
        }

        var docType = doc.is_template ? 'template' : 'document';
        docItems +=
          '<div class="bg-white border border-gray-200 hover:lex-border-accent rounded-lg p-3 transition-all group" data-doc-id="' + doc.id + '" data-doc-type="' + docType + '">' +
            '<div class="flex items-start gap-3">' +
              '<input type="checkbox" class="doc-select-cb mt-2 rounded border-gray-300 text-purple-600 focus:ring-purple-500 flex-shrink-0" data-doc-id="' + doc.id + '" onclick="event.stopPropagation(); updateDocSelection()">' +
              '<div class="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">' +
                getFileIcon(doc.content_type) +
              '</div>' +
              '<div class="flex-1 min-w-0">' +
                '<div class="flex items-start justify-between gap-2">' +
                  '<div class="min-w-0">' +
                    '<h6 class="text-sm font-medium text-gray-900 truncate" title="' + escapeHtml(docName) + '">' + escapeHtml(docName) + '</h6>' +
                    '<p class="text-xs text-gray-500 flex items-center gap-2 mt-0.5">' +
                      '<span>' + formatSize(doc.file_size) + '</span>' +
                      '<span class="text-gray-300">|</span>' +
                      '<span>' + timeAgo(doc.created_at) + '</span>' +
                      sourceBadge +
                    '</p>' +
                  '</div>' +
                  '<div class="flex items-center gap-2 flex-shrink-0">' +
                    (doc.is_template ? '<span class="inline-flex items-center px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-medium rounded">Template</span>' : '') +
                    docStatusBadge(doc.status) +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 mt-2" data-doc-actions>' +
                  actionButtons +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      docListHtml =
        // Search bar
        '<div class="mb-3">' +
          '<div class="relative">' +
            '<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>' +
            '<input type="text" id="docSearchInput" placeholder="Search documents..." value="' + escapeHtml(_docSearch) + '" class="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent">' +
          '</div>' +
        '</div>' +
        // Filter tabs + batch actions bar
        '<div class="flex items-center justify-between mb-3">' +
          '<div class="flex items-center gap-1">' +
            '<button onclick="filterDocs(\'all\')" class="doc-filter-btn px-2.5 py-1 text-xs font-medium rounded-full bg-gray-900 text-white" data-filter="all">All ' + totalCount + '</button>' +
            (templateCount > 0 ? '<button onclick="filterDocs(\'template\')" class="doc-filter-btn px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200" data-filter="template">Templates ' + templateCount + '</button>' : '') +
            (nonTemplateCount > 0 ? '<button onclick="filterDocs(\'document\')" class="doc-filter-btn px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200" data-filter="document">Documents ' + nonTemplateCount + '</button>' : '') +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">' +
              '<input type="checkbox" id="docSelectAll" onchange="toggleDocSelectAll(this.checked)" class="rounded border-gray-300 text-purple-600 focus:ring-purple-500">' +
              'Select All' +
            '</label>' +
            '<button id="docBatchDeleteBtn" onclick="batchDeleteDocs()" class="hidden px-2 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors">' +
              'Delete Selected' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div id="docListContainer" class="space-y-2">' +
          (filteredDocs.length === 0
            ? '<div class="text-center py-8"><p class="text-sm text-gray-500">No documents matching "' + escapeHtml(_docSearch) + '"</p></div>'
            : docItems) +
        '</div>' +
        // Pagination
        (totalPages > 1 ? '<lex-pagination id="docPagination" class="mt-4 border-t pt-4" page="' + currentPage + '" total-pages="' + totalPages + '" total="' + totalCount + '" limit="' + _docPageSize + '"></lex-pagination>' : '');
    }

    // Build orphaned files HTML
    var orphanedHtml = '';
    if (orphanedFiles.length > 0) {
      var orphanItems = '';
      for (var oi = 0; oi < orphanedFiles.length; oi++) {
        var file = orphanedFiles[oi];
        var fileDisplayName = file.filename || '';
        var connectorBadge = file.connector_id
          ? '<span class="text-gray-300">|</span><span class="text-xs bg-gray-200 px-1.5 py-0.5 rounded">' + escapeHtml(file.connector_id) + '</span>'
          : '';

        // Build assign button — avoid single-quotes in onclick by escaping the filename
        var safeFilename = fileDisplayName.split("'").join("\\'");
        var safeContentType = (file.content_type || '').split("'").join("\\'");

        orphanItems +=
          '<div class="bg-yellow-50 border border-yellow-200 hover:border-yellow-300 rounded-lg p-3 transition-all" data-orphan-key="' + escapeHtml(file.storage_key) + '">' +
            '<div class="flex items-start gap-3">' +
              '<div class="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">' +
                getFileIcon(file.content_type) +
              '</div>' +
              '<div class="flex-1 min-w-0">' +
                '<div class="flex items-start justify-between gap-2">' +
                  '<div class="min-w-0">' +
                    '<h6 class="text-sm font-medium text-gray-900 truncate" title="' + escapeHtml(fileDisplayName) + '">' + escapeHtml(fileDisplayName) + '</h6>' +
                    '<p class="text-xs text-gray-500 flex items-center gap-2 mt-0.5">' +
                      '<span>' + formatSize(file.file_size) + '</span>' +
                      connectorBadge +
                    '</p>' +
                    '<p class="text-xs text-gray-400 mt-1 font-mono truncate" title="' + escapeHtml(file.storage_key) + '">' + escapeHtml(file.storage_key) + '</p>' +
                  '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 mt-2">' +
                  '<button onclick="assignOrphanedFile(\'' + escapeHtml(file.storage_key) + '\', \'' + matter.matter_id + '\', \'' + safeFilename + '\', \'' + safeContentType + '\', ' + (file.file_size || 0) + ', \'' + (file.id || '') + '\', \'' + (file.source || 'minio') + '\')" class="text-xs lex-text-accent hover:lex-text-accent font-medium flex items-center gap-1">' +
                    '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>' +
                    'Assign to Matter' +
                  '</button>' +
                  '<button onclick="deleteOrphanedFile(\'' + escapeHtml(file.storage_key) + '\', \'' + matter.matter_id + '\', \'' + safeFilename + '\')" class="text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1">' +
                    '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
                    'Delete' +
                  '</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      orphanedHtml =
        '<div class="mt-6">' +
          '<div class="flex items-center justify-between mb-3">' +
            '<h5 class="text-sm font-medium text-gray-700">Unassigned Documents</h5>' +
            '<span class="text-xs text-gray-500 bg-yellow-50 px-2 py-1 rounded">' + orphanedFiles.length + ' file' + (orphanedFiles.length !== 1 ? 's' : '') + ' found in storage</span>' +
          '</div>' +
          '<p class="text-xs text-gray-500 mb-3">These files exist in storage but are not tracked in the database. Click "Assign to Matter" to add them.</p>' +
          '<div class="space-y-2">' + orphanItems + '</div>' +
        '</div>';
    }

    container.innerHTML =
      '<div class="space-y-4">' +
        '<div id="drawerDocDropZone" class="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:lex-border-accent transition-colors cursor-pointer">' +
          '<input type="file" id="drawerDocFileInput" multiple accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.pptx,.ppt" class="hidden">' +
          '<div id="drawerDocDropContent" class="flex items-center justify-center gap-3">' +
            '<svg class="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>' +
            '</svg>' +
            '<span class="text-sm text-gray-600"><span class="lex-text-accent font-medium">Upload files</span> or drag and drop</span>' +
          '</div>' +
          '<div id="drawerDocUploadProgress" class="hidden flex items-center justify-center gap-3">' +
            '<div class="animate-spin w-5 h-5 border-2 lex-border border-t-stone-600 rounded-full"></div>' +
            '<span id="drawerDocUploadText" class="text-sm text-gray-600">Uploading...</span>' +
          '</div>' +
        '</div>' +
        docListHtml +
        orphanedHtml +
      '</div>';

    setupDrawerUpload(matter, 'drawerDocDropZone', 'drawerDocFileInput');

    // Wire up document search
    var searchInput = document.getElementById('docSearchInput');
    if (searchInput) {
      // Restore focus if user was actively searching
      if (_docSearch) {
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
      searchInput.addEventListener('input', function () {
        clearTimeout(_docSearchTimeout);
        _docSearchTimeout = setTimeout(function () {
          _docSearch = searchInput.value.trim();
          _docPage = 1;
          loadDocumentsPage(matter.matter_id);
        }, 300);
      });
    }

    // Wire up document pagination
    var docPag = document.getElementById('docPagination');
    if (docPag) {
      docPag.addEventListener('page-change', function (e) {
        var newPage = e.detail && e.detail.page;
        if (newPage) {
          _docPage = newPage;
          loadDocumentsPage(matter.matter_id);
        }
      });
    }
  }

  // Setup drag-and-drop / click-to-upload handlers for a drop zone
  function setupDrawerUpload(matter, dropZoneId, fileInputId) {
    var dropZone = document.getElementById(dropZoneId);
    var fileInput = document.getElementById(fileInputId);
    if (!dropZone || !fileInput) return;

    var matterId = typeof matter === 'string' ? matter : matter.matter_id;

    dropZone.addEventListener('click', function (e) {
      if (e.target.tagName !== 'INPUT') {
        fileInput.click();
      }
    });

    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('lex-border-accent', 'lex-bg-accent-muted');
    });

    dropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dropZone.classList.remove('lex-border-accent', 'lex-bg-accent-muted');
    });

    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('lex-border-accent', 'lex-bg-accent-muted');
      var files = e.dataTransfer.files;
      if (files.length > 0) {
        handleDrawerFileUpload(files, matterId);
      }
    });

    fileInput.addEventListener('change', function (e) {
      if (e.target.files.length > 0) {
        handleDrawerFileUpload(e.target.files, matterId);
      }
    });
  }

  // Handle file upload (multiple files batched in groups of 3)
  async function handleDrawerFileUpload(files, matterId) {
    var fileArray = Array.from(files);
    var CONCURRENT_UPLOADS = 3;

    var dropContent = document.getElementById('drawerDocDropContent');
    var uploadProgress = document.getElementById('drawerDocUploadProgress');
    var uploadText = document.getElementById('drawerDocUploadText');

    if (dropContent) dropContent.classList.add('hidden');
    if (uploadProgress) uploadProgress.classList.remove('hidden');

    var successCount = 0;

    for (var i = 0; i < fileArray.length; i += CONCURRENT_UPLOADS) {
      var batch = fileArray.slice(i, i + CONCURRENT_UPLOADS);
      var batchPromises = batch.map(function (file, idx) {
        var fileIndex = i + idx;
        if (uploadText) uploadText.textContent = 'Uploading ' + (fileIndex + 1) + '/' + fileArray.length + ': ' + file.name;
        return api.uploadDocument(file, matterId).then(function (result) {
          successCount++;
          return result;
        }).catch(function (error) {
          Lex.Toast.error('Failed to upload ' + file.name + ': ' + error.message);
        });
      });
      await Promise.all(batchPromises);
    }

    if (dropContent) dropContent.classList.remove('hidden');
    if (uploadProgress) uploadProgress.classList.add('hidden');

    // Reset file inputs
    var emptyInput = document.getElementById('drawerEmptyFileInput');
    var docInput = document.getElementById('drawerDocFileInput');
    if (emptyInput) emptyInput.value = '';
    if (docInput) docInput.value = '';

    if (successCount > 0) {
      Lex.Toast.success('Uploaded ' + successCount + ' document(s) - processing started');
      await refreshDrawerDocuments(matterId);
    }
  }

  // Re-render documents with current search/page state (no API call)
  function loadDocumentsPage(matterId) {
    if (currentMatterData && currentMatterData.matter) {
      renderDocumentsTab(currentMatterData.matter, currentMatterData.documents, currentMatterData.docPagination, currentMatterData.orphanedFiles);
    }
  }

  // Refresh the documents tab after an upload/delete operation (fetches from API)
  async function refreshDrawerDocuments(matterId) {
    try {
      var docsResult = await api.getMatterFiles(matterId, { page: 1, pageSize: 500 });
      var documents = docsResult.files || [];
      var pagination = docsResult.pagination || {};
      var orphanedResult = await api.getOrphanedFiles(matterId).catch(function () { return { orphaned_files: [] }; });
      var orphanedFiles = orphanedResult.orphaned_files || orphanedResult.files || [];

      if (currentMatterData) {
        currentMatterData.documents = documents;
        currentMatterData.docPagination = pagination;
        currentMatterData.orphanedFiles = orphanedFiles;
      }

      if (currentMatterData && currentMatterData.matter) {
        renderDocumentsTab(currentMatterData.matter, documents, pagination, orphanedFiles);
      }
    } catch (error) {
      console.error('[refreshDrawerDocuments] Failed to refresh documents:', error);
    }
  }

  // Delete a document from the current matter
  function deleteDrawerDocument(fileId, matterId) {
    Lex.Modal.confirm(
      'Delete Document',
      'Are you sure you want to delete this document? This action cannot be undone.',
      async function () {
        try {
          await api.deleteDocument(fileId);
          Lex.Toast.success('Document deleted successfully');
          await refreshDrawerDocuments(matterId);
        } catch (error) {
          Lex.Toast.error(error.message || 'Failed to delete document');
        }
      }
    );
  }

  // Retry document ingestion for a failed document
  async function retryDocumentIngestion(fileId, matterId, filename) {
    if (typeof Modal !== 'undefined' && Modal.confirm) {
      Modal.confirm(
        'Retry Document Processing',
        'Retry processing for "' + filename + '"? This will re-attempt to parse, chunk, and embed the document.',
        async function () {
          try {
            Lex.Toast.info('Retriggering document ingestion...');
            await api.post('/api/v1/storage/documents/' + fileId + '/retry-ingestion', {});
            Lex.Toast.success('Document processing started. This may take a few minutes.');
            trackTimeout(setTimeout(async function () {
              await refreshDrawerDocuments(matterId);
            }, 2000));
          } catch (error) {
            console.error('[retryDocumentIngestion] Failed:', error);
            Lex.Toast.error(error.message || 'Failed to retry document processing');
          }
        },
        'Retry',
        'primary'
      );
    }
  }

  // Replace a document file (triggers re-vectorization)
  async function replaceDrawerDocument(fileId, matterId) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.txt,.html,.rtf';

    input.onchange = async function (e) {
      var file = e.target.files[0];
      if (!file) return;

      if (typeof Modal !== 'undefined' && Modal.confirm) {
        Modal.confirm(
          'Replace Document',
          'Replace document with "' + file.name + '"? This will re-process the document and update all embeddings for search.',
          async function () {
            try {
              Lex.Toast.info('Replacing document...');
              await api.replaceDocument(fileId, file, function (progress) {
                console.log('Upload progress: ' + progress + '%');
              });
              Lex.Toast.success('Document replaced successfully. Re-processing for search...');
              await refreshDrawerDocuments(matterId);
            } catch (error) {
              Lex.Toast.error(error.message || 'Failed to replace document');
            }
          }
        );
      }
    };

    input.click();
  }

  // Assign an orphaned storage file to this matter
  async function assignOrphanedFile(storageKey, matterId, filename, contentType, fileSize, documentId, source) {
    var message = source === 'database'
      ? 'Link "' + filename + '" to this matter? The file is already in the database.'
      : 'Assign "' + filename + '" to this matter? This will create a database record and make it available for AI search.';

    if (typeof Modal !== 'undefined' && Modal.confirm) {
      Modal.confirm(
        'Assign File to Matter',
        message,
        async function () {
          try {
            Lex.Toast.info('Assigning file...');
            await api.assignOrphanedFile({
              storage_key: storageKey,
              matter_id: matterId,
              filename: filename,
              content_type: contentType,
              file_size: fileSize,
              document_id: documentId || null,
              source: source || 'minio'
            });
            Lex.Toast.success('Document assigned! Processing started - refresh page in a few moments to see the processed document', { duration: 8000 });
            await refreshDrawerDocuments(matterId);
          } catch (error) {
            Lex.Toast.error(error.message || 'Failed to assign file');
          }
        },
        'Assign',
        'primary'
      );
    }
  }

  // Delete an orphaned file from storage
  async function deleteOrphanedFile(storageKey, matterId, filename) {
    if (typeof Modal !== 'undefined' && Modal.confirm) {
      Modal.confirm(
        'Delete File',
        'Permanently delete "' + filename + '" from storage? This action cannot be undone.',
        async function () {
          try {
            Lex.Toast.info('Deleting file...');
            await api.delete('/api/v1/storage/orphaned?storage_key=' + encodeURIComponent(storageKey));
            Lex.Toast.success('File deleted successfully');
            await refreshDrawerDocuments(matterId);
          } catch (error) {
            Lex.Toast.error(error.message || 'Failed to delete file');
          }
        }
      );
    }
  }

  // =========================================================================
  // DOCX Template — uses shared DocxTemplateModal module
  // =========================================================================

  var _wsDocxModal = null;

  function _initWsDocxTemplateModal() {
    if (typeof DocxTemplateModal === 'undefined') return;
    _wsDocxModal = new DocxTemplateModal({
      prefix: 'docxTemplate',
      getContacts: function () {
        // Fetch fresh contacts from the API each time the modal opens
        var matterId = currentMatterData && currentMatterData.matter && currentMatterData.matter.matter_id;
        if (!matterId) return (currentMatterData && currentMatterData.contacts) || [];
        return api.get('/api/v1/matters/' + matterId + '?full_details=true').then(function (res) {
          var matterData = (res.data || res).matter || res.data || res;
          var freshContacts = matterData.contacts || [];
          if (currentMatterData) currentMatterData.contacts = freshContacts;
          return freshContacts;
        }).catch(function () {
          return (currentMatterData && currentMatterData.contacts) || [];
        });
      },
      getMatterData: function () {
        return currentMatterData || null;
      },
      onGenerated: function () {
        if (_wsDocxModal && _wsDocxModal.state.matterId) {
          refreshDrawerDocuments(_wsDocxModal.state.matterId);
        }
      },
      onError: function (msg) { Lex.Toast.error(msg); },
      onSuccess: function (msg) { Lex.Toast.success(msg, { duration: 8000 }); }
    });
  }

  async function toggleDocxTemplate(docId, matterId, isTemplate) {
    try {
      await DocxTemplateModal.toggleTemplate(docId, matterId, isTemplate, {
        onSuccess: function (msg) { Lex.Toast.success(msg); },
        onError: function (msg) { Lex.Toast.error(msg); }
      });
      await refreshDrawerDocuments(matterId);
    } catch (_) { /* handled by callbacks */ }
  }

  function openDocxTemplateModal(docId, matterId, docName) {
    if (!_wsDocxModal) _initWsDocxTemplateModal();
    if (_wsDocxModal) _wsDocxModal.open(docId, matterId, docName);
  }

  function viewDocxTemplate() {
    if (_wsDocxModal) _wsDocxModal.viewTemplate();
  }
  window.viewDocxTemplate = viewDocxTemplate;

  // =========================================================================
  // Window globals for onclick handlers in HTML
  // =========================================================================

  // Document filter, select, batch delete
  function filterDocs(type) {
    var cards = document.querySelectorAll('[data-doc-id][data-doc-type]');
    var btns = document.querySelectorAll('.doc-filter-btn');
    btns.forEach(function (b) {
      var isActive = b.getAttribute('data-filter') === type;
      b.className = 'doc-filter-btn px-2.5 py-1 text-xs font-medium rounded-full ' +
        (isActive ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200');
    });
    cards.forEach(function (c) {
      if (type === 'all' || c.getAttribute('data-doc-type') === type) {
        c.style.display = '';
      } else {
        c.style.display = 'none';
      }
    });
    // Uncheck all when filtering
    document.querySelectorAll('.doc-select-cb').forEach(function (cb) { cb.checked = false; });
    var selectAll = document.getElementById('docSelectAll');
    if (selectAll) selectAll.checked = false;
    updateDocSelection();
  }

  function toggleDocSelectAll(checked) {
    document.querySelectorAll('.doc-select-cb').forEach(function (cb) {
      if (cb.closest('[data-doc-id]').style.display !== 'none') {
        cb.checked = checked;
      }
    });
    updateDocSelection();
  }

  function updateDocSelection() {
    var selected = document.querySelectorAll('.doc-select-cb:checked');
    var batchBtn = document.getElementById('docBatchDeleteBtn');
    if (batchBtn) {
      if (selected.length > 0) {
        batchBtn.classList.remove('hidden');
        batchBtn.textContent = 'Delete ' + selected.length + ' Selected';
      } else {
        batchBtn.classList.add('hidden');
      }
    }
  }

  function batchDeleteDocs() {
    var selected = document.querySelectorAll('.doc-select-cb:checked');
    if (selected.length === 0) return;

    var count = selected.length;
    Lex.Modal.confirm(
      'Delete ' + count + ' Document' + (count !== 1 ? 's' : ''),
      'Are you sure you want to delete ' + count + ' document' + (count !== 1 ? 's' : '') + '? This action cannot be undone.',
      async function () {
        var matterId = currentMatterData && currentMatterData.matter && currentMatterData.matter.matter_id;
        var deleted = 0;
        var failed = 0;
        for (var i = 0; i < selected.length; i++) {
          var docId = selected[i].getAttribute('data-doc-id');
          try {
            await api.delete('/api/v1/storage/files/' + docId + '?matter_id=' + encodeURIComponent(matterId));
            deleted++;
          } catch (_) {
            failed++;
          }
        }
        if (deleted > 0) Lex.Toast.success(deleted + ' document' + (deleted !== 1 ? 's' : '') + ' deleted');
        if (failed > 0) Lex.Toast.error(failed + ' failed to delete');
        await refreshDrawerDocuments(matterId);
      }
    );
  }

  window.filterDocs = filterDocs;
  window.toggleDocSelectAll = toggleDocSelectAll;
  window.updateDocSelection = updateDocSelection;
  window.batchDeleteDocs = batchDeleteDocs;

  window.loadActivityPage = loadActivityPage;
  window.deleteDrawerDocument = deleteDrawerDocument;
  window.retryDocumentIngestion = retryDocumentIngestion;
  window.replaceDrawerDocument = replaceDrawerDocument;
  window.refreshDrawerDocuments = refreshDrawerDocuments;
  window.assignOrphanedFile = assignOrphanedFile;
  window.deleteOrphanedFile = deleteOrphanedFile;
  window.toggleDocxTemplate = toggleDocxTemplate;
  window.openDocxTemplateModal = openDocxTemplateModal;

  ['loadActivityPage', 'deleteDrawerDocument', 'retryDocumentIngestion',
   'replaceDrawerDocument', 'refreshDrawerDocuments', 'assignOrphanedFile',
   'deleteOrphanedFile', 'toggleDocxTemplate', 'openDocxTemplateModal'].forEach(_trackGlobal);

  // =========================================================================
  // Conversations Tab
  // =========================================================================

  function renderConversationsTab(matter, chats, pagination) {
    var content = document.getElementById('tabContentConversations');
    if (!content) return;

    if (!chats || chats.length === 0) {
      var matterNameSafe = escapeHtml(matter.matter_name || matter.name || '');
      content.innerHTML =
        '<div class="text-center py-12">' +
          '<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>' +
          '</svg>' +
          '<h4 class="text-lg font-semibold text-gray-900 mb-2">No conversations yet</h4>' +
          '<p class="text-gray-500 mb-6">Start a conversation in this matter to organize all related chats</p>' +
          '<button onclick="createMatterConversation(' + "'" + matter.matter_id + "'" + ', ' + "'" + matterNameSafe + "'" + ')" class="inline-flex items-center gap-2 px-4 py-2 lex-bg-accent hover:lex-bg-accent text-white rounded-lg font-medium">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>' +
            '</svg>' +
            'Start First Conversation' +
          '</button>' +
        '</div>';
      return;
    }

    var currentOffset = (pagination && pagination.offset) || 0;
    var limit = (pagination && pagination.limit) || 25;
    var total = (pagination && pagination.total) || 0;
    var hasMore = (currentOffset + chats.length) < total;
    var currentPage = Math.floor(currentOffset / limit) + 1;
    var totalPages = Math.ceil(total / limit);

    var chatRows = chats.map(function (chat) {
      var title = escapeHtml((chat.metadata && chat.metadata.title) || 'Untitled Conversation');
      var msgCount = chat.metadata && chat.metadata.messageCount
        ? '<span>&#8226; ' + chat.metadata.messageCount + ' messages</span>'
        : '';
      return '<div onclick="NavigationHelpers.navigateToConversation(\'' + chat.thread_id + '\', \'' + matter.matter_id + '\')" class="block bg-white border border-gray-200 hover:lex-border-accent hover:shadow-sm rounded-lg p-4 transition-all group cursor-pointer">' +
        '<div class="flex items-start gap-3">' +
          '<div class="w-10 h-10 bg-gradient-to-br lex-bg-accent rounded-lg flex items-center justify-center flex-shrink-0">' +
            '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>' +
            '</svg>' +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<h6 class="text-sm font-semibold text-gray-900 group-hover:lex-text-accent mb-1 truncate">' + title + '</h6>' +
            '<p class="text-xs text-gray-500 flex items-center gap-4">' +
              '<span>Started ' + timeAgo(chat.created_at) + '</span>' +
              msgCount +
            '</p>' +
          '</div>' +
          '<svg class="w-5 h-5 text-gray-400 group-hover:lex-text-accent flex-shrink-0 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>' +
          '</svg>' +
        '</div>' +
      '</div>';
    }).join('');

    var paginationHtml = '';
    if (total > 0) {
      paginationHtml = '<lex-pagination id="convoPagination" class="mt-6 border-t pt-4" page="' + currentPage + '" total-pages="' + totalPages + '" total="' + total + '" limit="' + limit + '"></lex-pagination>';
    }

    var matterNameSafe2 = escapeHtml(matter.matter_name || matter.name || '');
    content.innerHTML =
      '<div class="space-y-4">' +
        '<div class="flex items-center justify-between">' +
          '<p class="text-sm text-gray-500">' + total + ' conversation' + (total !== 1 ? 's' : '') + '</p>' +
          '<button onclick="createMatterConversation(\'' + matter.matter_id + '\', \'' + matterNameSafe2 + '\')" class="inline-flex items-center gap-2 px-3 py-1.5 lex-bg-accent hover:lex-bg-accent text-white text-sm rounded-lg font-medium">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>' +
            '</svg>' +
            'New Chat' +
          '</button>' +
        '</div>' +
        '<div class="space-y-2">' + chatRows + '</div>' +
        paginationHtml +
      '</div>';

    // Wire up pagination
    var convPag = document.getElementById('convoPagination');
    if (convPag) {
      convPag.addEventListener('page-change', function (e) {
        var newPage = e.detail && e.detail.page;
        if (newPage) loadConversationsPage(matter.matter_id, (newPage - 1) * limit);
      });
    }
  }

  async function loadConversationsPage(matterId, offset) {
    try {
      var limit = 25;
      var result = await api.getMatterConversations(matterId, limit, offset);

      if (currentMatterData) {
        currentMatterData.chats = result.conversations || [];
        currentMatterData.chatPagination = result.pagination || { total: 0, limit: limit, offset: offset };
        renderConversationsTab(currentMatterData.matter, currentMatterData.chats, currentMatterData.chatPagination);
      }
    } catch (error) {
      console.error('[loadConversationsPage] Failed:', error);
      Lex.Toast.error('Failed to load conversations');
    }
  }

  // =========================================================================
  // Comments Tab (Discussions)
  // =========================================================================

  // Additional comments-tab state (beyond commentPollInterval + currentCommentPage declared above)
  var _mentionableUsers = [];
  var _matterDocuments = [];
  var _currentMentionFilter = '';
  var _currentDocumentFilter = '';
  var _commentsPerPage = 25;
  var _totalComments = 0;
  var _commentsMatterId = null;

  async function renderCommentsTab(matter) {
    var content = document.getElementById('tabContentComments');
    if (!content) return;

    // Reset pagination state
    currentCommentPage = 1;
    _commentsMatterId = matter.matter_id;

    var userInitials = api.user
      ? ((api.user.firstName ? api.user.firstName[0] : '') + (api.user.lastName ? api.user.lastName[0] : '')).toUpperCase()
      : 'U';

    content.innerHTML =
      '<div class="space-y-4">' +
        '<div class="bg-white rounded-lg border border-gray-200 p-4">' +
          '<div class="flex items-start gap-3">' +
            '<div class="w-10 h-10 lex-bg-accent-soft lex-text-accent rounded-full flex items-center justify-center flex-shrink-0 font-semibold">' +
              userInitials +
            '</div>' +
            '<div class="flex-1 relative">' +
              '<div id="commentInput" contenteditable="true" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 lex-ring-focus lex-border-focus min-h-[76px] text-sm outline-none" data-placeholder="Add a comment... (type @ to mention teammates, # to reference documents)"></div>' +
              '<div id="mentionDropdown" class="hidden absolute z-50 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 max-h-48 overflow-y-auto">' +
                '<div id="mentionList" class="py-1"></div>' +
              '</div>' +
              '<div id="documentDropdown" class="hidden absolute z-50 mt-1 w-80 bg-white rounded-lg shadow-lg border border-gray-200 max-h-64 overflow-y-auto">' +
                '<div id="documentList" class="py-1"></div>' +
              '</div>' +
              '<div class="mt-3 flex justify-end gap-2">' +
                '<button id="cancelComment" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>' +
                '<button id="postComment" class="px-4 py-2 lex-bg-accent hover:lex-bg-accent text-white rounded-lg text-sm font-medium">Post Comment</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="commentsList" class="space-y-4">' +
          '<div class="text-center py-8">' +
            '<div class="inline-block animate-spin w-8 h-8 border-4 lex-border-accent border-t-transparent rounded-full"></div>' +
            '<p class="mt-2 text-sm text-gray-500">Loading comments...</p>' +
          '</div>' +
        '</div>' +
        '<lex-pagination id="commentsPagination" class="mt-4" style="display:none;" page="1" total-pages="1" total="0" limit="' + _commentsPerPage + '"></lex-pagination>' +
      '</div>';

    await loadComments(matter.matter_id, 1);
    await _loadMentionableUsers(matter.matter_id);
    await _loadMatterDocumentsForComments(matter.matter_id);
    _setupCommentComposer(matter.matter_id);

    // Start polling every 30 seconds
    if (commentPollInterval) {
      clearInterval(commentPollInterval);
      var oldIdx = _intervals.indexOf(commentPollInterval);
      if (oldIdx !== -1) _intervals.splice(oldIdx, 1);
    }
    commentPollInterval = trackInterval(setInterval(function () { loadComments(matter.matter_id); }, 30000));
  }

  async function _loadMentionableUsers(matterId) {
    try {
      var response = await api.getMentionableUsers(matterId);
      _mentionableUsers = response.data || [];
    } catch (error) {
      console.error('[Comments] Failed to load mentionable users:', error);
      _mentionableUsers = [];
    }
  }

  async function _loadMatterDocumentsForComments(matterId) {
    try {
      var response = await api.getMatterDocuments(matterId, 1, 100);
      _matterDocuments = response.documents || [];
    } catch (error) {
      console.error('[Comments] Failed to load matter documents:', error);
      _matterDocuments = [];
    }
  }

  async function loadComments(matterId, page) {
    page = page || 1;
    try {
      currentCommentPage = page;
      var offset = (page - 1) * _commentsPerPage;

      var response = await api.getComments(matterId, {
        limit: _commentsPerPage,
        offset: offset,
        sort: 'created_at:desc'
      });

      var comments = response.data || [];
      var pagination = response.pagination || {};
      _totalComments = pagination.total || 0;

      _renderCommentsList(comments, matterId);
      _updateCommentsPaginationUI();
    } catch (error) {
      console.error('[Comments] Failed to load comments:', error);
      var listEl = document.getElementById('commentsList');
      if (listEl) {
        listEl.innerHTML = '<div class="text-center py-8 text-gray-500"><p>Failed to load comments</p></div>';
      }
    }
  }

  function _updateCommentsPaginationUI() {
    var totalPages = Math.ceil(_totalComments / _commentsPerPage) || 1;
    var pag = document.getElementById('commentsPagination');
    if (!pag) return;

    if (_totalComments > 0) {
      pag.style.display = '';
      pag.page = currentCommentPage;
      pag.totalPages = totalPages;
      pag.total = _totalComments;
      pag.limit = _commentsPerPage;
    } else {
      pag.style.display = 'none';
    }

    _setupCommentsPaginationListeners();
  }

  function _setupCommentsPaginationListeners() {
    var pag = document.getElementById('commentsPagination');
    if (!pag || pag._commentsWired) return;
    pag._commentsWired = true;
    pag.addEventListener('page-change', function (e) {
      var newPage = e.detail && e.detail.page;
      if (newPage && _commentsMatterId) {
        loadComments(_commentsMatterId, newPage);
      }
    });
  }

  function _renderCommentsList(comments, matterId) {
    var container = document.getElementById('commentsList');
    if (!container) return;

    if (comments.length === 0) {
      container.innerHTML =
        '<div class="text-center py-12">' +
          '<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>' +
          '</svg>' +
          '<h4 class="text-lg font-semibold text-gray-900 mb-2">No comments yet</h4>' +
          '<p class="text-gray-500">Be the first to comment on this matter</p>' +
        '</div>';
      return;
    }

    var threads = _buildCommentThreads(comments);
    container.innerHTML = threads.map(function (thread) {
      return _renderCommentThread(thread, matterId);
    }).join('');

    _attachCommentActions(matterId);
  }

  function _buildCommentThreads(comments) {
    var processed = comments.map(function (c) {
      var replies = (c.replies || []).slice().sort(function (a, b) {
        return new Date(a.created_at) - new Date(b.created_at);
      });
      return Object.assign({}, c, { replies: replies });
    });

    var pinned = processed.filter(function (c) { return c.is_pinned; });
    var unpinned = processed.filter(function (c) { return !c.is_pinned; });

    pinned.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    unpinned.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });

    return pinned.concat(unpinned);
  }

  function _getAuthorInitials(name) {
    if (!name) return 'U';
    var parts = name.split(' ');
    return parts.map(function (p) { return p[0] || ''; }).join('').toUpperCase();
  }

  function _renderCommentThread(comment, matterId) {
    var isAuthor = comment.author_id === (api.user && api.user.id);
    var isPinned = comment.is_pinned;

    var pinnedBanner = isPinned
      ? '<div class="bg-yellow-50 px-4 py-2 border-b border-yellow-200 text-xs text-yellow-800 flex items-center gap-1">' +
          '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06l-1.06-1.06a.75.75 0 10-1.06 1.06l1.06 1.06z"></path></svg>' +
          'Pinned' +
        '</div>'
      : '';

    var editedBadge = comment.is_edited ? '<span class="text-xs text-gray-400">(edited)</span>' : '';

    var referencedDocs = '';
    if (comment.referenced_documents && comment.referenced_documents.length) {
      referencedDocs = '<div class="mt-2 flex flex-wrap gap-2">' +
        comment.referenced_documents.map(function (doc) {
          return '<a href="#" class="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-700">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' +
            escapeHtml(doc.file_name) +
          '</a>';
        }).join('') +
      '</div>';
    }

    var editBtn = isAuthor
      ? '<button class="edit-comment-btn text-xs text-gray-600 hover:lex-text-accent font-medium" data-comment-id="' + comment.id + '">Edit</button>'
      : '';
    var deleteBtn = isAuthor
      ? '<button class="delete-comment-btn text-xs text-red-600 hover:text-red-700 font-medium" data-comment-id="' + comment.id + '">Delete</button>'
      : '';
    var pinLabel = isPinned ? 'Unpin' : 'Pin';

    var repliesHtml = '';
    if (comment.replies && comment.replies.length) {
      repliesHtml = '<div class="border-t border-gray-100 bg-gray-50">' +
        comment.replies.map(function (reply) { return _renderCommentReply(reply); }).join('') +
      '</div>';
    }

    return '<div class="bg-white rounded-lg border border-gray-200 ' + (isPinned ? 'ring-2 ring-yellow-400' : '') + '" data-comment-id="' + comment.id + '">' +
      pinnedBanner +
      '<div class="p-4">' +
        '<div class="flex items-start gap-3">' +
          '<div class="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-gray-600">' +
            _getAuthorInitials(comment.author_name) +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-2 mb-1">' +
              '<span class="font-semibold text-gray-900">' + escapeHtml(comment.author_name || 'Unknown User') + '</span>' +
              '<span class="text-xs text-gray-500">' + timeAgo(comment.created_at) + '</span>' +
              editedBadge +
            '</div>' +
            '<div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">' + renderCommentContent(comment.content) + '</div>' +
            referencedDocs +
            '<div class="mt-2 flex items-center gap-3">' +
              '<button class="reply-btn text-xs text-gray-600 hover:lex-text-accent font-medium" data-comment-id="' + comment.id + '">Reply</button>' +
              editBtn +
              deleteBtn +
              '<button class="pin-comment-btn text-xs text-yellow-600 hover:text-yellow-700 font-medium" data-comment-id="' + comment.id + '">' + pinLabel + '</button>' +
            '</div>' +
            '<div class="reply-input-container hidden mt-3 pl-3 border-l-2 border-gray-200">' +
              '<textarea class="reply-textarea w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows="2" placeholder="Write a reply..."></textarea>' +
              '<div class="mt-2 flex justify-end gap-2">' +
                '<button class="cancel-reply-btn px-3 py-1 text-xs text-gray-600 hover:text-gray-800">Cancel</button>' +
                '<button class="post-reply-btn px-3 py-1 lex-bg-accent hover:lex-bg-accent text-white rounded text-xs font-medium">Reply</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      repliesHtml +
    '</div>';
  }

  function _renderCommentReply(reply) {
    var isAuthor = reply.author_id === (api.user && api.user.id);
    var editedBadge = reply.is_edited ? '<span class="text-xs text-gray-400">(edited)</span>' : '';
    var editBtn = isAuthor
      ? '<button class="edit-comment-btn text-xs text-gray-600 hover:lex-text-accent font-medium" data-comment-id="' + reply.id + '">Edit</button>'
      : '';
    var deleteBtn = isAuthor
      ? '<button class="delete-comment-btn text-xs text-red-600 hover:text-red-700 font-medium" data-comment-id="' + reply.id + '">Delete</button>'
      : '';

    return '<div class="p-4 pl-12" data-comment-id="' + reply.id + '">' +
      '<div class="flex items-start gap-3">' +
        '<div class="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold text-gray-600">' +
          _getAuthorInitials(reply.author_name) +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2 mb-1">' +
            '<span class="font-semibold text-sm text-gray-900">' + escapeHtml(reply.author_name || 'Unknown User') + '</span>' +
            '<span class="text-xs text-gray-500">' + timeAgo(reply.created_at) + '</span>' +
            editedBadge +
          '</div>' +
          '<div class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">' + renderCommentContent(reply.content) + '</div>' +
          '<div class="mt-2 flex items-center gap-3">' +
            editBtn +
            deleteBtn +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /**
   * Render comment content: convert @[Name](uuid) and #[DocName](uuid) to styled spans.
   * No regex — uses indexOf/substring loops.
   */
  function renderCommentContent(content) {
    if (!content) return '';
    var result = '';
    var i = 0;
    var len = content.length;

    while (i < len) {
      // Look for @ or # trigger
      var atIdx = content.indexOf('@[', i);
      var hashIdx = content.indexOf('#[', i);

      // Pick the nearest trigger
      var triggerIdx = -1;
      var triggerChar = '';
      if (atIdx !== -1 && (hashIdx === -1 || atIdx <= hashIdx)) {
        triggerIdx = atIdx;
        triggerChar = '@';
      } else if (hashIdx !== -1) {
        triggerIdx = hashIdx;
        triggerChar = '#';
      }

      if (triggerIdx === -1) {
        // No more triggers — append rest as text
        result += _commentTextToHtml(content.substring(i));
        break;
      }

      // Append text before trigger
      result += _commentTextToHtml(content.substring(i, triggerIdx));

      // Find closing bracket and paren
      var closeBracket = content.indexOf('](', triggerIdx);
      if (closeBracket === -1) {
        result += _commentTextToHtml(content.substring(triggerIdx));
        break;
      }
      var closeParen = content.indexOf(')', closeBracket + 2);
      if (closeParen === -1) {
        result += _commentTextToHtml(content.substring(triggerIdx));
        break;
      }

      var displayName = content.substring(triggerIdx + 2, closeBracket);
      // uuid is between closeBracket+2 and closeParen (not used in display)

      if (triggerChar === '@') {
        result += '<span class="inline-flex items-center px-1.5 py-0.5 rounded lex-bg-accent-soft lex-text-accent text-sm font-medium">@' + escapeHtml(displayName) + '</span>';
      } else {
        result += '<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-sm font-medium">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' +
          escapeHtml(displayName) +
        '</span>';
      }

      i = closeParen + 1;
    }

    return result;
  }

  /** Convert plain text segment to HTML (newlines to <br>, no other escaping needed here since escapeHtml is for dynamic data) */
  function _commentTextToHtml(text) {
    if (!text) return '';
    // Split on newlines and join with <br>
    return text.split('\n').map(function (line) { return escapeHtml(line); }).join('<br>');
  }

  function _setupCommentComposer(matterId) {
    var input = document.getElementById('commentInput');
    var mentionDropdown = document.getElementById('mentionDropdown');
    var documentDropdown = document.getElementById('documentDropdown');
    var postBtn = document.getElementById('postComment');
    var cancelBtn = document.getElementById('cancelComment');

    if (!input) return;

    function getTextBeforeCursor() {
      var selection = window.getSelection();
      if (!selection.rangeCount) return '';
      var range = selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(input);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      var tempDiv = document.createElement('div');
      tempDiv.appendChild(range.cloneContents());
      return tempDiv.textContent || '';
    }

    input.addEventListener('input', function () {
      var text = getTextBeforeCursor();

      // Check for @mention trigger (text ends with @ followed by word chars/spaces)
      var atIdx = text.lastIndexOf('@');
      var hashIdx = text.lastIndexOf('#');
      var hasAtTrigger = atIdx !== -1 && atIdx > hashIdx;
      var hasHashTrigger = hashIdx !== -1 && hashIdx >= atIdx;

      if (hasAtTrigger) {
        _currentMentionFilter = text.substring(atIdx + 1).toLowerCase();
        var filtered = _mentionableUsers.filter(function (u) {
          return u.name.toLowerCase().indexOf(_currentMentionFilter) !== -1 ||
                 u.email.toLowerCase().indexOf(_currentMentionFilter) !== -1;
        });
        _showMentionDropdown(filtered);
        if (documentDropdown) documentDropdown.classList.add('hidden');
      } else if (hasHashTrigger) {
        _currentDocumentFilter = text.substring(hashIdx + 1).toLowerCase();
        var filteredDocs = _matterDocuments.filter(function (doc) {
          return doc.filename && doc.filename.toLowerCase().indexOf(_currentDocumentFilter) !== -1;
        });
        _showDocumentDropdown(filteredDocs);
        if (mentionDropdown) mentionDropdown.classList.add('hidden');
      } else {
        if (mentionDropdown) mentionDropdown.classList.add('hidden');
        if (documentDropdown) documentDropdown.classList.add('hidden');
      }
    });

    if (postBtn) {
      postBtn.addEventListener('click', function () { _postComment(matterId); });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        input.innerHTML = '';
        if (mentionDropdown) mentionDropdown.classList.add('hidden');
        if (documentDropdown) documentDropdown.classList.add('hidden');
      });
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _postComment(matterId);
      }
    });
  }

  function _showMentionDropdown(users) {
    var dropdown = document.getElementById('mentionDropdown');
    var list = document.getElementById('mentionList');
    if (!dropdown || !list) return;

    if (users.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    list.innerHTML = users.slice(0, 5).map(function (user) {
      return '<button class="mention-item w-full px-3 py-2 hover:bg-gray-100 flex items-center gap-2 text-left" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">' +
        '<div class="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-semibold text-gray-600">' +
          _getAuthorInitials(user.name) +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="text-sm font-medium text-gray-900">' + escapeHtml(user.name) + '</div>' +
          '<div class="text-xs text-gray-500 truncate">' + escapeHtml(user.email) + '</div>' +
        '</div>' +
      '</button>';
    }).join('');

    dropdown.classList.remove('hidden');

    list.querySelectorAll('.mention-item').forEach(function (item) {
      item.addEventListener('click', function () {
        _insertMention(item.dataset.userId, item.dataset.userName);
      });
    });
  }

  function _insertMention(userId, userName) {
    var input = document.getElementById('commentInput');
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) { if (input) input.focus(); return; }

    var range = selection.getRangeAt(0);
    var node = range.startContainer;
    var offset = range.startOffset;

    if (node.nodeType === Node.TEXT_NODE) {
      var text = node.textContent.substring(0, offset);
      var atIndex = text.lastIndexOf('@');
      if (atIndex !== -1) {
        var deleteRange = document.createRange();
        deleteRange.setStart(node, atIndex);
        deleteRange.setEnd(node, offset);
        deleteRange.deleteContents();
      }
    }

    var mentionSpan = document.createElement('span');
    mentionSpan.contentEditable = 'false';
    mentionSpan.className = 'mention-tag inline-flex items-center px-1.5 py-0.5 rounded lex-bg-accent-soft lex-text-accent text-sm font-medium mx-0.5';
    mentionSpan.setAttribute('data-user-id', userId);
    mentionSpan.setAttribute('data-user-name', userName);
    mentionSpan.textContent = '@' + userName;

    var insertRange = selection.getRangeAt(0);
    insertRange.insertNode(mentionSpan);

    var space = document.createTextNode('\u00A0');
    mentionSpan.parentNode.insertBefore(space, mentionSpan.nextSibling);

    var newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    if (input) input.focus();
    var dropdown = document.getElementById('mentionDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }

  function _showDocumentDropdown(documents) {
    var dropdown = document.getElementById('documentDropdown');
    var list = document.getElementById('documentList');
    if (!dropdown || !list) return;

    if (documents.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    list.innerHTML = documents.slice(0, 10).map(function (doc) {
      var sizeText = doc.file_size ? _formatFileSize(doc.file_size) : '';
      return '<button class="document-item w-full px-3 py-2 hover:bg-gray-100 flex items-center gap-2 text-left" data-doc-id="' + doc.id + '" data-doc-name="' + escapeHtml(doc.filename) + '">' +
        '<svg class="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="text-sm font-medium text-gray-900 truncate">' + escapeHtml(doc.filename) + '</div>' +
          '<div class="text-xs text-gray-500">' + sizeText + '</div>' +
        '</div>' +
      '</button>';
    }).join('');

    dropdown.classList.remove('hidden');

    list.querySelectorAll('.document-item').forEach(function (item) {
      item.addEventListener('click', function () {
        _insertDocument(item.dataset.docId, item.dataset.docName);
      });
    });
  }

  function _insertDocument(docId, docName) {
    var input = document.getElementById('commentInput');
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount) { if (input) input.focus(); return; }

    var range = selection.getRangeAt(0);
    var node = range.startContainer;
    var offset = range.startOffset;

    if (node.nodeType === Node.TEXT_NODE) {
      var text = node.textContent.substring(0, offset);
      var hashIndex = text.lastIndexOf('#');
      if (hashIndex !== -1) {
        var deleteRange = document.createRange();
        deleteRange.setStart(node, hashIndex);
        deleteRange.setEnd(node, offset);
        deleteRange.deleteContents();
      }
    }

    var docSpan = document.createElement('span');
    docSpan.contentEditable = 'false';
    docSpan.className = 'doc-tag inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-sm font-medium mx-0.5';
    docSpan.setAttribute('data-doc-id', docId);
    docSpan.setAttribute('data-doc-name', docName);
    docSpan.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' + escapeHtml(docName);

    var insertRange = selection.getRangeAt(0);
    insertRange.insertNode(docSpan);

    var space = document.createTextNode('\u00A0');
    docSpan.parentNode.insertBefore(space, docSpan.nextSibling);

    var newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    if (input) input.focus();
    var dropdown = document.getElementById('documentDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }

  async function _postComment(matterId) {
    var input = document.getElementById('commentInput');
    var postBtn = document.getElementById('postComment');
    if (!input) return;

    var mentions = [];
    var documentIds = [];
    var clone = input.cloneNode(true);

    clone.querySelectorAll('.mention-tag').forEach(function (span) {
      var userId = span.getAttribute('data-user-id');
      var userName = span.getAttribute('data-user-name');
      if (userId && userName) {
        mentions.push(userId);
        span.replaceWith(document.createTextNode('@[' + userName + '](' + userId + ')'));
      }
    });

    clone.querySelectorAll('.doc-tag').forEach(function (span) {
      var docId = span.getAttribute('data-doc-id');
      var docName = span.getAttribute('data-doc-name');
      if (docId && docName) {
        documentIds.push(docId);
        span.replaceWith(document.createTextNode('#[' + docName + '](' + docId + ')'));
      }
    });

    // Convert HTML to plain text preserving line breaks (no regex)
    var rawHtml = clone.innerHTML;
    // Replace <br> tags with newlines
    var brParts = rawHtml.split('<br>');
    var divParts = [];
    brParts.forEach(function (part) {
      var subParts = part.split('<br/>');
      subParts.forEach(function (sp) { divParts.push(sp); });
    });
    var joined = divParts.join('\n');
    // Strip remaining HTML tags using a temp element
    var tempEl = document.createElement('div');
    tempEl.innerHTML = joined;
    var content = (tempEl.textContent || tempEl.innerText || '').trim();
    // Replace non-breaking spaces
    content = content.split('\u00A0').join(' ').trim();

    if (!content) {
      Lex.Toast.warning('Please enter a comment');
      return;
    }

    var originalHtml = '';
    if (postBtn) {
      originalHtml = postBtn.innerHTML;
      postBtn.disabled = true;
      postBtn.classList.add('opacity-50', 'cursor-not-allowed');
      postBtn.innerHTML = '<svg class="animate-spin h-4 w-4 inline-block mr-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Posting...';
    }

    try {
      await api.createComment(matterId, {
        content: content,
        mentioned_user_ids: mentions.length > 0 ? mentions : [],
        referenced_document_ids: documentIds.length > 0 ? documentIds : []
      });
      input.innerHTML = '';
      Lex.Toast.success('Comment posted');
      await loadComments(matterId);
      if (postBtn) {
        postBtn.disabled = false;
        postBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        postBtn.innerHTML = originalHtml;
      }
    } catch (error) {
      console.error('[Comments] Failed to post comment:', error);
      Lex.Toast.error('Failed to post comment');
      if (postBtn) {
        postBtn.disabled = false;
        postBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        postBtn.innerHTML = originalHtml;
      }
    }
  }

  function _attachCommentActions(matterId) {
    // Reply toggle
    document.querySelectorAll('.reply-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var commentId = e.target.dataset.commentId;
        var container = document.querySelector('[data-comment-id="' + commentId + '"] .reply-input-container');
        if (container) container.classList.toggle('hidden');
      });
    });

    // Cancel reply
    document.querySelectorAll('.cancel-reply-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        var container = e.target.closest('.reply-input-container');
        if (!container) return;
        container.classList.add('hidden');
        var ta = container.querySelector('.reply-textarea');
        if (ta) ta.value = '';
      });
    });

    // Post reply
    document.querySelectorAll('.post-reply-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        var container = e.target.closest('.reply-input-container');
        if (!container) return;
        var commentId = container.closest('[data-comment-id]').dataset.commentId;
        var textarea = container.querySelector('.reply-textarea');
        var content = textarea ? textarea.value.trim() : '';

        if (!content) {
          Lex.Toast.warning('Please enter a reply');
          return;
        }

        try {
          await api.replyToComment(commentId, { content: content });
          if (textarea) textarea.value = '';
          container.classList.add('hidden');
          Lex.Toast.success('Reply posted');
          await loadComments(matterId);
        } catch (error) {
          console.error('[Comments] Failed to post reply:', error);
          Lex.Toast.error('Failed to post reply');
        }
      });
    });

    // Edit comment
    document.querySelectorAll('.edit-comment-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        var commentId = e.target.dataset.commentId;
        var commentEl = document.querySelector('[data-comment-id="' + commentId + '"]');
        if (!commentEl) return;
        var contentEl = commentEl.querySelector('.text-sm.text-gray-700.leading-relaxed');
        if (!contentEl) return;

        var currentContent = contentEl.textContent.trim();
        var originalHTML = contentEl.innerHTML;

        contentEl.innerHTML =
          '<textarea class="edit-comment-textarea w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows="3">' + escapeHtml(currentContent) + '</textarea>' +
          '<div class="mt-2 flex justify-end gap-2">' +
            '<button class="cancel-edit-btn px-3 py-1 text-xs text-gray-600 hover:text-gray-800 border border-gray-300 rounded">Cancel</button>' +
            '<button class="save-edit-btn px-3 py-1 lex-bg-accent hover:lex-bg-accent text-white rounded text-xs font-medium">Save</button>' +
          '</div>';

        var textarea = contentEl.querySelector('.edit-comment-textarea');
        var saveBtn = contentEl.querySelector('.save-edit-btn');
        var cancelBtn = contentEl.querySelector('.cancel-edit-btn');

        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }

        if (cancelBtn) {
          cancelBtn.addEventListener('click', function () {
            contentEl.innerHTML = originalHTML;
          });
        }

        if (saveBtn) {
          saveBtn.addEventListener('click', async function () {
            var newContent = textarea ? textarea.value.trim() : '';
            if (!newContent) { Lex.Toast.warning('Comment cannot be empty'); return; }
            if (newContent === currentContent) { contentEl.innerHTML = originalHTML; return; }

            try {
              saveBtn.disabled = true;
              saveBtn.textContent = 'Saving...';
              await api.updateComment(commentId, { content: newContent });
              Lex.Toast.success('Comment updated');
              await loadComments(matterId);
            } catch (error) {
              console.error('[Comments] Failed to update comment:', error);
              Lex.Toast.error('Failed to update comment');
              contentEl.innerHTML = originalHTML;
            }
          });
        }
      });
    });

    // Delete comment
    document.querySelectorAll('.delete-comment-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        var commentId = e.target.dataset.commentId;
        Modal.confirm(
          'Delete Comment',
          'Are you sure you want to delete this comment? This action cannot be undone.',
          async function () {
            try {
              await api.deleteComment(commentId);
              Lex.Toast.success('Comment deleted');
              await loadComments(matterId);
            } catch (error) {
              console.error('[Comments] Failed to delete comment:', error);
              Lex.Toast.error('Failed to delete comment');
            }
          }
        );
      });
    });

    // Pin / Unpin comment
    document.querySelectorAll('.pin-comment-btn').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        var commentId = e.target.dataset.commentId;
        var isPinned = e.target.textContent.trim() === 'Unpin';
        try {
          if (isPinned) {
            await api.unpinComment(commentId);
            Lex.Toast.success('Comment unpinned');
          } else {
            await api.pinComment(commentId);
            Lex.Toast.success('Comment pinned');
          }
          await loadComments(matterId);
        } catch (error) {
          console.error('[Comments] Failed to pin/unpin comment:', error);
          Lex.Toast.error('Failed to update comment');
        }
      });
    });
  }

  function _formatFileSize(bytes) {
    if (!bytes) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // =========================================================================
  // Tasks Tab (with Kanban)
  // =========================================================================

  var _kanbanPagination = {
    pending:     { page: 1, perPage: 10 },
    in_progress: { page: 1, perPage: 10 },
    in_review:   { page: 1, perPage: 10 },
    complete:    { page: 1, perPage: 10 },
    cancelled:   { page: 1, perPage: 10 }
  };

  var _draggedTask = null;

  function getStatusBadge(status) {
    var statusMap = {
      'pending':     { cls: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
      'in_progress': { cls: 'bg-blue-100 text-blue-800',    label: 'In Progress' },
      'in_review':   { cls: 'lex-bg-accent-soft lex-text-accent', label: 'In Review' },
      'complete':    { cls: 'bg-green-100 text-green-800',  label: 'Complete' },
      'cancelled':   { cls: 'bg-gray-100 text-gray-800',    label: 'Cancelled' },
      'Pending':     { cls: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
      'In Progress': { cls: 'bg-blue-100 text-blue-800',    label: 'In Progress' },
      'In Review':   { cls: 'lex-bg-accent-soft lex-text-accent', label: 'In Review' },
      'Complete':    { cls: 'bg-green-100 text-green-800',  label: 'Complete' },
      'Cancelled':   { cls: 'bg-gray-100 text-gray-800',    label: 'Cancelled' }
    };
    var cfg = statusMap[status] || { cls: 'bg-gray-100 text-gray-800', label: status || '' };
    return '<span class="px-2 py-1 text-xs font-medium rounded-full ' + cfg.cls + '">' + escapeHtml(cfg.label) + '</span>';
  }

  function getPriorityBadge(priority) {
    var priorityMap = {
      'high':   { cls: 'bg-red-100 text-red-800',   label: 'High' },
      'normal': { cls: 'bg-gray-100 text-gray-800',  label: 'Normal' },
      'low':    { cls: 'bg-blue-100 text-blue-800',  label: 'Low' },
      'High':   { cls: 'bg-red-100 text-red-800',   label: 'High' },
      'Normal': { cls: 'bg-gray-100 text-gray-800',  label: 'Normal' },
      'Low':    { cls: 'bg-blue-100 text-blue-800',  label: 'Low' }
    };
    var cfg = priorityMap[priority] || { cls: 'bg-gray-100 text-gray-800', label: priority || 'Normal' };
    return '<span class="px-2 py-1 text-xs font-medium rounded-full ' + cfg.cls + '">' + escapeHtml(cfg.label) + '</span>';
  }

  function formatDueDate(dateString) {
    if (!dateString) return 'No due date';
    var date = new Date(dateString);
    var now = new Date();
    var diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return '<span class="text-red-600">Overdue (' + Math.abs(diffDays) + ' days)</span>';
    } else if (diffDays === 0) {
      return '<span class="text-orange-600">Due today</span>';
    } else if (diffDays <= 7) {
      return '<span class="text-yellow-600">Due in ' + diffDays + ' days</span>';
    } else {
      return date.toLocaleDateString();
    }
  }

  function renderTasksTab(matter, tasks) {
    var content = document.getElementById('tabContentTasks');
    if (!content) return;

    currentTasksList = tasks || [];
    currentTaskMatterId = matter.matter_id;

    if (currentTasksList.length === 0) {
      content.innerHTML =
        '<div class="text-center py-12">' +
          '<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>' +
          '</svg>' +
          '<h4 class="text-lg font-semibold text-gray-900 mb-2">No tasks yet</h4>' +
          '<p class="text-gray-500 mb-4">Create a task or connect ActionStep to import tasks</p>' +
          '<button onclick="openCreateTaskModal(\'' + matter.matter_id + '\')" class="inline-flex items-center gap-2 px-4 py-2 lex-bg-accent hover:lex-bg-accent text-white text-sm rounded-lg font-medium transition-colors">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>' +
            'Create Task' +
          '</button>' +
        '</div>';
      return;
    }

    renderKanbanBoard(matter.matter_id, currentTasksList);
  }

  function renderKanbanBoard(matterId, allTasks) {
    var content = document.getElementById('tabContentTasks');
    if (!content) return;

    var tasksByStatus = {
      pending:     allTasks.filter(function (t) { return t.status === 'pending'     || t.status === 'Pending'; }),
      in_progress: allTasks.filter(function (t) { return t.status === 'in_progress' || t.status === 'In Progress'; }),
      in_review:   allTasks.filter(function (t) { return t.status === 'in_review'   || t.status === 'In Review'; }),
      complete:    allTasks.filter(function (t) { return t.status === 'complete'    || t.status === 'Complete'; }),
      cancelled:   allTasks.filter(function (t) { return t.status === 'cancelled'   || t.status === 'Cancelled'; })
    };

    var lanaCount = allTasks.filter(function (t) { return t.source === 'lana'; }).length;
    var externalCount = allTasks.filter(function (t) { return t.source !== 'lana'; }).length;

    content.innerHTML =
      '<div class="space-y-4">' +
        '<div class="flex items-center justify-between mb-4">' +
          '<div>' +
            '<h3 class="text-lg font-semibold text-gray-900">Task Board</h3>' +
            '<p class="text-sm text-gray-500">' + lanaCount + ' LANA tasks, ' + externalCount + ' external tasks</p>' +
          '</div>' +
          '<button onclick="openCreateTaskModal(\'' + matterId + '\')" class="px-4 py-2 lex-bg-accent text-white rounded-lg hover:lex-bg-accent transition-colors text-sm font-medium flex items-center gap-2">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>' +
            'Create Task' +
          '</button>' +
        '</div>' +
        '<div class="overflow-x-auto -mx-6 px-6">' +
          '<div class="inline-flex gap-4 min-w-full pb-4">' +
            _renderKanbanColumn('pending',     'Pending',     tasksByStatus.pending,     'bg-yellow-50 border-yellow-200', 'text-yellow-800') +
            _renderKanbanColumn('in_progress', 'In Progress', tasksByStatus.in_progress, 'bg-blue-50 border-blue-200',    'text-blue-800') +
            _renderKanbanColumn('in_review',   'In Review',   tasksByStatus.in_review,   'lex-bg-accent-muted lex-border-accent', 'lex-text-accent') +
            _renderKanbanColumn('complete',    'Complete',    tasksByStatus.complete,    'bg-green-50 border-green-200',  'text-green-800') +
            _renderKanbanColumn('cancelled',   'Cancelled',   tasksByStatus.cancelled,   'bg-gray-50 border-gray-200',    'text-gray-800') +
          '</div>' +
        '</div>' +
      '</div>';

    _attachKanbanEventListeners();
  }

  function _renderKanbanColumn(status, label, tasks, bgClass, textClass) {
    var pagination = _kanbanPagination[status];
    var startIdx = (pagination.page - 1) * pagination.perPage;
    var endIdx = startIdx + pagination.perPage;
    var paginatedTasks = tasks.slice(startIdx, endIdx);
    var totalPages = Math.ceil(tasks.length / pagination.perPage);
    var hasMore = endIdx < tasks.length;
    var hasPrevious = pagination.page > 1;

    // Extract border class from bgClass (second token)
    var bgParts = bgClass.split(' ');
    var borderClass = bgParts.length > 1 ? bgParts[1] : '';

    var taskCardsHtml = paginatedTasks.length === 0
      ? '<div class="text-center py-8 text-gray-400">' +
          '<svg class="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>' +
          '<p class="text-sm">No tasks</p>' +
        '</div>'
      : paginatedTasks.map(function (task) { return _renderKanbanCard(task); }).join('');

    var paginationHtml = totalPages > 1
      ? '<div class="bg-white border-2 border-t-0 ' + borderClass + ' rounded-b-lg px-3 py-2 flex items-center justify-between text-xs">' +
          '<button onclick="changeKanbanPage(\'' + status + '\', ' + (pagination.page - 1) + ')" class="px-2 py-1 rounded ' + (hasPrevious ? 'lex-text-accent hover:bg-gray-50' : 'text-gray-300 cursor-not-allowed') + '" ' + (!hasPrevious ? 'disabled' : '') + '>' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>' +
          '</button>' +
          '<span class="text-gray-600">Page ' + formatNumber(pagination.page) + ' of ' + formatNumber(totalPages) + '</span>' +
          '<button onclick="changeKanbanPage(\'' + status + '\', ' + (pagination.page + 1) + ')" class="px-2 py-1 rounded ' + (hasMore ? 'lex-text-accent hover:bg-gray-50' : 'text-gray-300 cursor-not-allowed') + '" ' + (!hasMore ? 'disabled' : '') + '>' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>' +
          '</button>' +
        '</div>'
      : '';

    return '<div class="flex-shrink-0 w-80 flex flex-col" style="max-height: calc(100vh - 300px);">' +
      '<div class="' + bgClass + ' border-2 rounded-t-lg px-4 py-3 flex items-center justify-between">' +
        '<div class="flex items-center gap-2">' +
          '<h4 class="font-semibold ' + textClass + '">' + label + '</h4>' +
          '<span class="px-2 py-0.5 text-xs font-medium ' + textClass + ' bg-white rounded-full">' + tasks.length + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="flex-1 bg-gray-50 border-x-2 border-b-2 ' + borderClass + ' rounded-b-lg overflow-y-auto p-3 space-y-3" data-status="' + status + '" ondrop="handleKanbanDrop(event, \'' + status + '\')" ondragover="handleKanbanDragOver(event)" ondragleave="handleKanbanDragLeave(event)">' +
        taskCardsHtml +
      '</div>' +
      paginationHtml +
    '</div>';
  }

  function _renderKanbanCard(task) {
    var isLana = task.source === 'lana';
    var title = escapeHtml(task.title || task.task_name || '');

    var externalBadge = !isLana
      ? '<span class="text-xs lex-bg-accent-soft lex-text-accent px-2 py-0.5 rounded flex-shrink-0">External</span>'
      : '';

    var assigneeHtml = task.assigned_to
      ? '<div class="flex items-center gap-1 text-xs text-gray-600 mb-2">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>' +
          '<span class="truncate">' + escapeHtml(task.assigned_to) + '</span>' +
        '</div>'
      : '';

    var dueDateHtml = task.due_date
      ? '<div class="flex items-center gap-1 text-xs text-gray-500">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>' +
          formatDueDate(task.due_date) +
        '</div>'
      : '';

    var descHtml = (task.description && task.description !== 'null')
      ? '<p class="mt-2 text-xs text-gray-600 line-clamp-2">' + escapeHtml(task.description) + '</p>'
      : '';

    // Serialize task data for drag; avoid injecting raw JSON into HTML
    var taskDataAttr = 'data-task-id="' + task.id + '" data-task-status="' + escapeHtml(task.status) + '"';

    return '<div class="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md transition-all ' + (isLana ? 'cursor-move' : 'cursor-default') + '" draggable="' + isLana + '" ' + taskDataAttr + ' ondragstart="handleKanbanDragStart(event)" ondragend="handleKanbanDragEnd(event)" onclick="openTaskQuickView(\'' + task.id + '\')">' +
      '<div class="flex items-start gap-2 mb-2">' +
        '<h5 class="text-sm font-medium text-gray-900 flex-1 line-clamp-2">' + title + '</h5>' +
        externalBadge +
      '</div>' +
      '<div class="mb-2">' + getPriorityBadge(task.priority) + '</div>' +
      assigneeHtml +
      dueDateHtml +
      descHtml +
    '</div>';
  }

  function _attachKanbanEventListeners() {
    // Event delegation — inline onclick/ondrag handlers cover all interactions
  }

  // =========================================================================
  // Kanban Drag-and-Drop Handlers (window globals)
  // =========================================================================

  window.handleKanbanDragStart = function (event) {
    // Find the dragged card's task id and look it up
    var card = event.currentTarget;
    var taskId = card && card.dataset.taskId;
    _draggedTask = taskId ? currentTasksList.find(function (t) { return String(t.id) === String(taskId); }) : null;
    event.dataTransfer.effectAllowed = 'move';
    if (card) card.classList.add('opacity-50');
  };

  window.handleKanbanDragEnd = function (event) {
    if (event.currentTarget) event.currentTarget.classList.remove('opacity-50');
    _draggedTask = null;
  };

  window.handleKanbanDragOver = function (event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (event.currentTarget) event.currentTarget.classList.add('ring-2', 'lex-ring-focus');
  };

  window.handleKanbanDragLeave = function (event) {
    if (event.currentTarget) event.currentTarget.classList.remove('ring-2', 'lex-ring-focus');
  };

  window.handleKanbanDrop = async function (event, newStatus) {
    event.preventDefault();
    if (event.currentTarget) event.currentTarget.classList.remove('ring-2', 'lex-ring-focus');

    if (!_draggedTask) return;

    var task = _draggedTask;
    // Normalize: convert spaces to underscores
    var oldStatusNorm = task.status.split(' ').join('_').toLowerCase();
    var newStatusNorm = newStatus.split(' ').join('_').toLowerCase();

    if (oldStatusNorm === newStatusNorm) return;

    try {
      await _updateTaskStatus(task.id, newStatus);
      Lex.Toast.success('Task moved to ' + newStatus.split('_').join(' '));

      var matterId = (currentMatterData && currentMatterData.matter_id) ||
                     (currentMatterData && currentMatterData.matter && currentMatterData.matter.matter_id);

      if (matterId) {
        var response = await api.getMatterTasks(matterId);
        var updatedTasks = response.tasks || [];

        if (currentMatterData) {
          currentMatterData.tasks = updatedTasks;
          renderTasksTab(currentMatterData.matter, updatedTasks);
        } else {
          currentTasksList = updatedTasks;
          renderKanbanBoard(matterId, updatedTasks);
        }
      }
    } catch (error) {
      console.error('[Tasks] Failed to update task status:', error);
      Lex.Toast.error('Failed to move task');
    }
  };

  async function _updateTaskStatus(taskId, newStatus) {
    var task = currentTasksList.find(function (t) { return t.id === taskId; });
    if (!task) throw new Error('Task not found');

    await api.updateTask(taskId, {
      title: task.title,
      description: task.description,
      notes: task.notes,
      status: newStatus,
      priority: task.priority,
      due_date: task.due_date,
      assigned_to_user_id: task.assigned_to_user_id
    });
  }

  window.changeKanbanPage = function (status, newPage) {
    if (_kanbanPagination[status]) {
      _kanbanPagination[status].page = newPage;
    }
    if (currentMatterData && currentMatterData.matter) {
      renderKanbanBoard(currentMatterData.matter.matter_id, currentTasksList);
    }
  };

  window.openTaskQuickView = function (taskId) {
    var task = currentTasksList.find(function (t) { return String(t.id) === String(taskId); });
    if (!task) { Lex.Toast.error('Task not found'); return; }

    if (task.source === 'lana') {
      editTask(taskId);
    } else {
      _showTaskReadonlyModal(task);
    }
  };

  function _showTaskReadonlyModal(task) {
    var title = escapeHtml(task.title || task.task_name || '');
    var descHtml = (task.description && task.description !== 'null')
      ? '<div><h4 class="text-sm font-medium text-gray-700 mb-1">Description</h4><p class="text-sm text-gray-600">' + escapeHtml(task.description) + '</p></div>'
      : '';
    var assigneeHtml = task.assigned_to
      ? '<div><h4 class="text-sm font-medium text-gray-700 mb-1">Assigned To</h4><p class="text-sm text-gray-600">' + escapeHtml(task.assigned_to) + '</p></div>'
      : '';
    var dueDateHtml = task.due_date
      ? '<div><h4 class="text-sm font-medium text-gray-700 mb-1">Due Date</h4><p class="text-sm text-gray-600">' + formatDueDate(task.due_date) + '</p></div>'
      : '';
    var notesHtml = (task.notes && task.notes !== 'null')
      ? '<div><h4 class="text-sm font-medium text-gray-700 mb-1">Notes</h4><p class="text-sm text-gray-600 italic">' + escapeHtml(task.notes) + '</p></div>'
      : '';

    var modalHtml =
      '<div id="taskReadonlyModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">' +
        '<div class="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">' +
          '<div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">' +
            '<h3 class="text-lg font-semibold text-gray-900">' + title + '</h3>' +
            '<button onclick="closeTaskReadonlyModal()" class="text-gray-400 hover:text-gray-600">' +
              '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>' +
            '</button>' +
          '</div>' +
          '<div class="p-6 space-y-4">' +
            '<div class="flex items-center gap-2">' +
              '<span class="text-xs lex-bg-accent-soft lex-text-accent px-3 py-1 rounded">External Task (Read-only)</span>' +
              getStatusBadge(task.status) +
              getPriorityBadge(task.priority) +
            '</div>' +
            descHtml +
            assigneeHtml +
            dueDateHtml +
            notesHtml +
          '</div>' +
          '<div class="px-6 py-4 border-t border-gray-200 flex justify-end">' +
            '<button onclick="closeTaskReadonlyModal()" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors">Close</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  window.closeTaskReadonlyModal = function () {
    var modal = document.getElementById('taskReadonlyModal');
    if (modal) modal.remove();
  };

  // =========================================================================
  // Notes Tab
  // =========================================================================

  function renderNotesTab(matter) {
    var content = document.getElementById('tabContentNotes');

    if (!content) {
      console.error('[Notes] Tab content container not found');
      return;
    }

    try {
      content.innerHTML = '<div id="matterNotesContainer" class="w-full h-full"></div>';

      if (window.initializeMatterNotes && window.MatterNotesAPIClient) {
        window.initializeMatterNotes('matterNotesContainer', matter.matter_id);
        // Notes initialized
      } else {
        content.innerHTML =
          '<div class="text-center py-12">' +
            '<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>' +
            '</svg>' +
            '<h3 class="mt-2 text-sm font-medium text-gray-900">Notes feature not available</h3>' +
            '<p class="mt-1 text-sm text-gray-500">The notes feature is still loading. Please refresh the page.</p>' +
          '</div>';
        console.error('[Notes] Matter Notes components not loaded');
      }
    } catch (error) {
      console.error('[Notes] Failed to initialize Matter Notes:', error);
      content.innerHTML =
        '<div class="text-center py-12">' +
          '<svg class="mx-auto h-12 w-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>' +
          '</svg>' +
          '<h3 class="mt-2 text-sm font-medium text-gray-900">Failed to load notes</h3>' +
          '<p class="mt-1 text-sm text-gray-500">' + escapeHtml(error.message) + '</p>' +
        '</div>';
    }
  }

  // =========================================================================
  // Window globals for the above tab functions
  // =========================================================================

  window.loadConversationsPage = loadConversationsPage;
  window.loadComments = loadComments;
  window.renderCommentContent = renderCommentContent;
  window.handleKanbanDragStart = window.handleKanbanDragStart;
  window.handleKanbanDragEnd = window.handleKanbanDragEnd;
  window.handleKanbanDragOver = window.handleKanbanDragOver;
  window.handleKanbanDragLeave = window.handleKanbanDragLeave;
  window.handleKanbanDrop = window.handleKanbanDrop;
  window.changeKanbanPage = window.changeKanbanPage;
  window.openTaskQuickView = window.openTaskQuickView;
  window.closeTaskReadonlyModal = window.closeTaskReadonlyModal;

  ['loadConversationsPage', 'loadComments', 'renderCommentContent',
   'handleKanbanDragStart', 'handleKanbanDragEnd', 'handleKanbanDragOver',
   'handleKanbanDragLeave', 'handleKanbanDrop', 'changeKanbanPage',
   'openTaskQuickView', 'closeTaskReadonlyModal'].forEach(_trackGlobal);

  // =========================================================================
  // Contact Modal Handlers
  // =========================================================================

  function openAddContactModal(matterId) {
    var modal = document.getElementById('contactModal');
    if (!modal) return;
    var form = document.getElementById('contactForm');
    if (form) form.reset();
    var midEl = document.getElementById('contactMatterId');
    if (midEl) midEl.value = matterId;
    modal.open = true;
  }

  function closeContactModal() {
    var modal = document.getElementById('contactModal');
    if (modal) modal.open = false;
    var form = document.getElementById('contactForm');
    if (form) form.reset();
  }

  async function saveContact(event) {
    event.preventDefault();

    var matterId = document.getElementById('contactMatterId').value;
    var contactData = {
      first_name: document.getElementById('contactFirstName').value.trim(),
      last_name: document.getElementById('contactLastName').value.trim(),
      display_name: document.getElementById('contactDisplayName').value.trim() || null,
      company_name: document.getElementById('contactCompanyName').value.trim() || null,
      title: document.getElementById('contactTitle').value.trim() || null,
      email: document.getElementById('contactEmail').value.trim() || null,
      phone_mobile: document.getElementById('contactPhoneMobile').value.trim() || null,
      phone_work: document.getElementById('contactPhoneWork').value.trim() || null,
      contact_type: document.getElementById('contactType').value
    };

    var submitBtn = event.target.querySelector('button[type="submit"]');
    var originalButtonHtml = submitBtn ? submitBtn.innerHTML : '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      submitBtn.innerHTML =
        '<svg class="animate-spin h-4 w-4 inline-block mr-2" fill="none" viewBox="0 0 24 24">' +
          '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
          '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
        '</svg>Creating...';
    }

    try {
      await api.createContact(matterId, contactData);
      Lex.Toast.success('Contact created successfully');

      document.getElementById('contactModal').open = false;

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        submitBtn.innerHTML = originalButtonHtml;
      }

      await refreshCurrentMatter();
    } catch (error) {
      console.error('Save contact error:', error);
      Lex.Toast.error('Failed to create contact');

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        submitBtn.innerHTML = originalButtonHtml;
      }
    }
  }

  async function openContactDetail(contactId, matterId) {
    var modal = document.getElementById('contactDetailModal');
    var content = document.getElementById('contactDetailContent');
    if (!modal || !content) return;

    // Resolve matter ID: prefer explicit arg, fall back to currentMatterData
    var resolvedMatterId = matterId || (currentMatterData && currentMatterData.matter && currentMatterData.matter.matter_id);
    if (!resolvedMatterId) {
      Lex.Toast.error('Matter ID not found');
      return;
    }

    content.innerHTML =
      '<div class="flex items-center justify-center py-12">' +
        '<div class="animate-spin rounded-full h-8 w-8 border-b-2 lex-border-accent"></div>' +
      '</div>';
    modal.open = true;

    try {
      var response = await fetch(api.baseUrl + '/api/v1/matters/' + resolvedMatterId + '/contacts/' + contactId, {
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load contact details');
      }

      var data = await response.json();
      var contact = data.contact;

      var connectorNames = {
        'actionstep': 'ActionStep',
        'google_contacts': 'Google Contacts',
        'gohighlevel': 'GoHighLevel',
        'hubspot': 'HubSpot',
        'salesforce': 'Salesforce',
        'microsoft_contacts': 'Microsoft Contacts',
        'outlook': 'Outlook'
      };

      var isConnectorContact = contact.source && connectorNames[contact.source] !== undefined;
      var connectorDisplayName = isConnectorContact ? connectorNames[contact.source] : '';

      var internalSourceLabels = {
        'manual': 'Manual',
        'agentic': 'AI Created',
        'ai_extracted': 'AI Extracted',
        'imported': 'Imported'
      };

      var sourceLabel = internalSourceLabels[contact.source] ||
        (contact.source
          ? contact.source.charAt(0).toUpperCase() + contact.source.slice(1)
          : 'Manual');
      var isInternalNonManual = contact.source && !isConnectorContact && contact.source !== 'manual';

      var typeLabels = {
        'contact:participant': { label: 'Participant', cls: 'bg-blue-100 text-blue-800' },
        'contact:opportunity': { label: 'Opportunity', cls: 'bg-green-100 text-green-800' },
        'contact:lead': { label: 'Lead', cls: 'bg-yellow-100 text-yellow-800' },
        'contact:other': { label: 'Other', cls: 'bg-gray-100 text-gray-800' }
      };
      var contactTypeInfo = typeLabels[contact.contact_type] || typeLabels['contact:other'];
      var displayName = contact.display_name || ((contact.first_name || '') + ' ' + (contact.last_name || '')).trim();

      var sourceBadge = '';
      if (isConnectorContact) {
        sourceBadge =
          '<span class="inline-flex items-center text-sm lex-bg-accent-soft lex-text-accent px-2 py-1 rounded" title="Synced from ' + escapeHtml(connectorDisplayName) + '">' +
            '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>' +
            escapeHtml(connectorDisplayName) +
          '</span>';
      } else if (isInternalNonManual) {
        sourceBadge =
          '<span class="inline-flex items-center text-sm bg-sky-100 text-sky-700 px-2 py-1 rounded" title="' + escapeHtml(sourceLabel) + '">' +
            '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>' +
            escapeHtml(sourceLabel) +
          '</span>';
      } else {
        sourceBadge =
          '<span class="inline-flex items-center text-sm bg-gray-100 text-gray-600 px-2 py-1 rounded" title="Manually created">' +
            '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>' +
            'Manual' +
          '</span>';
      }

      var connectorNote = isConnectorContact
        ? '<div class="lex-bg-accent-muted border lex-border-accent rounded-lg p-4">' +
            '<p class="text-sm lex-text-accent"><strong>Note:</strong> This contact was originally synced from ' + escapeHtml(connectorDisplayName) + '. You can edit the local copy below.</p>' +
          '</div>'
        : '';

      var displayNameRow = contact.display_name
        ? '<div class="md:col-span-2"><label class="block text-sm font-medium text-gray-500 mb-1">Display Name</label><p class="text-gray-900">' + escapeHtml(contact.display_name) + '</p></div>'
        : '';
      var companyRow = contact.company_name
        ? '<div><label class="block text-sm font-medium text-gray-500 mb-1">Company</label><p class="text-gray-900">' + escapeHtml(contact.company_name) + '</p></div>'
        : '';
      var titleRow = contact.title
        ? '<div><label class="block text-sm font-medium text-gray-500 mb-1">Title/Position</label><p class="text-gray-900">' + escapeHtml(contact.title) + '</p></div>'
        : '';
      var emailRow = contact.email
        ? '<div class="md:col-span-2"><label class="block text-sm font-medium text-gray-500 mb-1">Email</label>' +
          '<a href="mailto:' + escapeHtml(contact.email) + '" class="lex-text-accent hover:lex-text-accent">' + escapeHtml(contact.email) + '</a></div>'
        : '';
      var mobileRow = contact.phone_mobile
        ? '<div><label class="block text-sm font-medium text-gray-500 mb-1">Mobile Phone</label>' +
          '<a href="tel:' + escapeHtml(contact.phone_mobile) + '" class="lex-text-accent hover:lex-text-accent">' + escapeHtml(contact.phone_mobile) + '</a></div>'
        : '';
      var workRow = contact.phone_work
        ? '<div><label class="block text-sm font-medium text-gray-500 mb-1">Work Phone</label>' +
          '<a href="tel:' + escapeHtml(contact.phone_work) + '" class="lex-text-accent hover:lex-text-accent">' + escapeHtml(contact.phone_work) + '</a></div>'
        : '';
      var titleCompanyLine = (contact.title || contact.company_name)
        ? '<p class="text-gray-600">' +
          (contact.title ? escapeHtml(contact.title) : '') +
          (contact.title && contact.company_name ? ' at ' : '') +
          (contact.company_name ? escapeHtml(contact.company_name) : '') +
          '</p>'
        : '';

      content.innerHTML =
        '<div class="space-y-6">' +
          '<div>' +
            '<div class="flex items-center gap-2 flex-wrap mb-2">' +
              '<h3 class="text-2xl font-semibold text-gray-900">' + escapeHtml(displayName) + '</h3>' +
              '<span class="text-sm ' + contactTypeInfo.cls + ' px-2 py-1 rounded">' + contactTypeInfo.label + '</span>' +
              sourceBadge +
            '</div>' +
            titleCompanyLine +
          '</div>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
            '<div><label class="block text-sm font-medium text-gray-500 mb-1">First Name</label><p class="text-gray-900">' + escapeHtml(contact.first_name || '—') + '</p></div>' +
            '<div><label class="block text-sm font-medium text-gray-500 mb-1">Last Name</label><p class="text-gray-900">' + escapeHtml(contact.last_name || '—') + '</p></div>' +
            displayNameRow +
            companyRow +
            titleRow +
            emailRow +
            mobileRow +
            workRow +
          '</div>' +
          connectorNote +
          '<div class="flex justify-end gap-3 pt-6 border-t border-gray-200">' +
            '<button onclick="confirmDeleteContact(\'' + escapeHtml(contact.id) + '\', \'' + escapeHtml(displayName) + '\')" class="px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-colors flex items-center gap-2">' +
              '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
              'Delete Contact' +
            '</button>' +
            '<button onclick="openEditContactModal(\'' + escapeHtml(contact.id) + '\')" class="px-4 py-2 lex-bg-accent hover:lex-bg-accent text-white rounded-lg font-medium transition-colors flex items-center gap-2">' +
              '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>' +
              'Edit Contact' +
            '</button>' +
          '</div>' +
        '</div>';

    } catch (error) {
      console.error('Error loading contact details:', error);
      content.innerHTML =
        '<div class="text-center py-12">' +
          '<div class="text-red-600 mb-4">' +
            '<svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' +
          '</div>' +
          '<h4 class="text-lg font-semibold text-gray-900 mb-2">Failed to load contact</h4>' +
          '<p class="text-gray-500">' + escapeHtml(error.message) + '</p>' +
        '</div>';
    }
  }

  function closeContactDetailModal() {
    var modal = document.getElementById('contactDetailModal');
    if (modal) modal.open = false;
  }

  async function openEditContactModal(contactId) {
    try {
      closeContactDetailModal();

      var matterId = currentMatterData && currentMatterData.matter && currentMatterData.matter.matter_id;
      if (!matterId) throw new Error('Matter ID not found');

      var response = await fetch(api.baseUrl + '/api/v1/matters/' + matterId + '/contacts/' + contactId, {
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error('Failed to load contact');

      var data = await response.json();
      var contact = data.contact;

      document.getElementById('editContactId').value = contact.id;
      document.getElementById('editContactMatterId').value = matterId;
      document.getElementById('editContactFirstName').value = contact.first_name || '';
      document.getElementById('editContactLastName').value = contact.last_name || '';
      document.getElementById('editContactDisplayName').value = contact.display_name || '';
      document.getElementById('editContactCompanyName').value = contact.company_name || '';
      document.getElementById('editContactTitle').value = contact.title || '';
      document.getElementById('editContactEmail').value = contact.email || '';
      document.getElementById('editContactPhoneMobile').value = contact.phone_mobile || '';
      document.getElementById('editContactPhoneWork').value = contact.phone_work || '';
      document.getElementById('editContactType').value = contact.contact_type || 'contact:other';

      document.getElementById('editContactModal').open = true;
    } catch (error) {
      console.error('Error loading contact for editing:', error);
      Lex.Toast.error('Failed to load contact');
    }
  }

  function closeEditContactModal() {
    var modal = document.getElementById('editContactModal');
    if (modal) modal.open = false;
    var fields = ['editContactFirstName', 'editContactLastName', 'editContactDisplayName',
      'editContactCompanyName', 'editContactTitle', 'editContactEmail',
      'editContactPhoneMobile', 'editContactPhoneWork'];
    fields.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var typeEl = document.getElementById('editContactType');
    if (typeEl) typeEl.value = 'contact:participant';
  }

  async function updateContact(event) {
    event.preventDefault();

    var contactId = document.getElementById('editContactId').value;
    var matterId = document.getElementById('editContactMatterId').value;
    var contactData = {
      first_name: document.getElementById('editContactFirstName').value.trim(),
      last_name: document.getElementById('editContactLastName').value.trim(),
      display_name: document.getElementById('editContactDisplayName').value.trim() || null,
      company_name: document.getElementById('editContactCompanyName').value.trim() || null,
      title: document.getElementById('editContactTitle').value.trim() || null,
      email: document.getElementById('editContactEmail').value.trim() || null,
      phone_mobile: document.getElementById('editContactPhoneMobile').value.trim() || null,
      phone_work: document.getElementById('editContactPhoneWork').value.trim() || null,
      contact_type: document.getElementById('editContactType').value
    };

    var submitBtn = event.target.querySelector('lex-btn[type="submit"]') || event.target.querySelector('button[type="submit"]');
    var originalButtonText = submitBtn ? submitBtn.textContent : '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating...';
    }

    try {
      var response = await fetch(api.baseUrl + '/api/v1/matters/' + matterId + '/contacts/' + contactId, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contactData)
      });

      if (!response.ok) throw new Error('Failed to update contact');

      Lex.Toast.success('Contact updated successfully');
      closeEditContactModal();

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalButtonText;
      }

      await refreshCurrentMatter();
    } catch (error) {
      console.error('Update contact error:', error);
      Lex.Toast.error('Failed to update contact');

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalButtonText;
      }
    }
  }

  function confirmDeleteContact(contactId, contactName) {
    Lex.Modal.confirm(
      'Delete Contact',
      'Are you sure you want to delete the contact "' + contactName + '"? This action cannot be undone.',
      function () { deleteContact(contactId); }
    );
  }

  async function deleteContact(contactId) {
    var matterId = currentMatterData && currentMatterData.matter && currentMatterData.matter.matter_id;
    if (!matterId) {
      Lex.Toast.error('Matter ID not found');
      return;
    }

    try {
      var response = await fetch(api.baseUrl + '/api/v1/matters/' + matterId + '/contacts/' + contactId, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        var errorData = await response.json().catch(function () { return {}; });
        throw new Error(errorData.message || 'Failed to delete contact');
      }

      Lex.Toast.success('Contact deleted successfully');
      closeContactDetailModal();

      await refreshCurrentMatter();
    } catch (error) {
      console.error('Delete contact error:', error);
      Lex.Toast.error('Failed to delete contact');
    }
  }

  // =========================================================================
  // Linked Matters — dock panel rendering
  // =========================================================================

  async function renderLinkedMattersInDetails(matter) {
    var content = document.getElementById('linkedMattersSection');
    if (!content) return;

    // Only show linked matters for workspaces
    if (matter.matter_type !== 'workspace') {
      content.innerHTML = '';
      return;
    }

    content.innerHTML =
      '<div class="flex items-center justify-center py-6">' +
        '<div class="animate-spin rounded-full h-6 w-6 border-b-2 lex-border-accent"></div>' +
      '</div>';

    try {
      var response = await fetch(api.baseUrl + '/api/v1/entity-links/matter/' + matter.matter_id, {
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error('Failed to load linked matters');

      var data = await response.json();
      renderLinkedMattersInlineContent(matter, data.links, data.total_links);

    } catch (error) {
      console.error('Error loading linked matters:', error);
      content.innerHTML =
        '<div class="text-center py-6">' +
          '<div class="text-red-600 mb-2">' +
            '<svg class="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' +
          '</div>' +
          '<h5 class="text-sm font-semibold text-gray-900 mb-1">Failed to load linked matters</h5>' +
          '<p class="text-xs text-gray-500">' + escapeHtml(error.message) + '</p>' +
        '</div>';
    }
  }

  function renderLinkedMattersInlineContent(matter, links, totalLinks) {
    var content = document.getElementById('linkedMattersSection');
    if (!content) return;

    var isWorkspace = matter.matter_type === 'workspace';

    // Build action buttons for the section header
    var linkedMattersActions = '';
    if (isWorkspace) {
      linkedMattersActions =
        '<div class="flex items-center gap-1">' +
          '<button onclick="openCreateLinkModal(\'' + matter.matter_id + '\', true)" class="inline-flex items-center justify-center w-6 h-6 text-white rounded lex-bg-accent hover:lex-bg-accent transition-colors" title="Link Existing Matter">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>' +
          '</button>' +
          '<button onclick="openCreateMatterDrawer(\'' + matter.matter_id + '\')" class="inline-flex items-center justify-center w-6 h-6 text-white rounded lex-bg-accent hover:lex-bg-accent transition-colors" title="Create New Matter">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>' +
          '</button>' +
        '</div>';
    }

    if (totalLinks === 0) {
      var emptyContent = '<p class="text-sm text-gray-500 text-center py-3">No linked matters</p>';
      if (isWorkspace) {
        emptyContent +=
          '<div class="flex items-center justify-center gap-2 pb-2">' +
            '<button onclick="openCreateLinkModal(\'' + matter.matter_id + '\', true)" class="px-3 py-1.5 lex-bg-accent hover:lex-bg-accent text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1">' +
              '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>' +
              'Link Matter' +
            '</button>' +
            '<button onclick="openCreateMatterDrawer(\'' + matter.matter_id + '\')" class="px-3 py-1.5 lex-bg-accent hover:lex-bg-accent text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1">' +
              '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>' +
              'New Matter' +
            '</button>' +
          '</div>';
      }
      content.innerHTML = createCollapsibleSection(
        'Linked Matters',
        emptyContent,
        'linked-matters',
        { defaultExpanded: true, actions: linkedMattersActions }
      );
      return;
    }

    // Build links content
    var linksContent = '<div class="space-y-3">';

    if (links.workspace_matters && links.workspace_matters.length > 0) {
      linksContent += renderLinkSection(
        isWorkspace ? 'Matters in this Workspace' : 'Part of Workspace',
        links.workspace_matters,
        matter.matter_id
      );
    }

    if (links.parent_matters && links.parent_matters.length > 0) {
      linksContent += renderLinkSection('Parent Matters', links.parent_matters, matter.matter_id);
    }

    if (links.child_matters && links.child_matters.length > 0) {
      linksContent += renderLinkSection('Child Matters', links.child_matters, matter.matter_id);
    }

    if (links.shadow_records && links.shadow_records.length > 0) {
      linksContent += renderLinkSection('ActionStep Connector', links.shadow_records, matter.matter_id, true);
    }

    linksContent += '</div>';

    content.innerHTML = createCollapsibleSection(
      'Linked Matters',
      linksContent,
      'linked-matters',
      { defaultExpanded: true, actions: linkedMattersActions }
    );
  }

  function renderLinkSection(title, linksList, currentMatterId, isReadOnly) {
    isReadOnly = isReadOnly || false;
    var cardsHtml = '';
    for (var i = 0; i < linksList.length; i++) {
      cardsHtml += renderLinkCard(linksList[i], currentMatterId, isReadOnly);
    }
    return '<div class="mb-3">' +
      '<h5 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">' + escapeHtml(title) + ' (' + linksList.length + ')</h5>' +
      '<div class="space-y-1">' + cardsHtml + '</div>' +
    '</div>';
  }

  function getLinkIcon(linkType) {
    if (linkType === 'workspace_matter') {
      return '<svg class="w-3 h-3 lex-text-accent inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>';
    }
    if (linkType === 'related_to') {
      return '<svg class="w-3 h-3 lex-text-accent inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>';
    }
    if (linkType === 'parent') {
      return '<svg class="w-3 h-3 text-green-600 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>';
    }
    if (linkType === 'child') {
      return '<svg class="w-3 h-3 text-blue-600 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>';
    }
    if (linkType === 'shadow_record') {
      return '<svg class="w-3 h-3 text-amber-600 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>';
    }
    return '<svg class="w-3 h-3 text-gray-500 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path></svg>';
  }

  function renderLinkCard(link, currentMatterId, isReadOnly) {
    var linkedName = link.linked_name || 'Unknown';
    var linkedId = link.linked_entity_id;
    var linkId = link.link_id;
    var createdAt = link.created_at ? new Date(link.created_at).toLocaleDateString() : '';
    var createdBy = link.created_by_name || link.created_by_email || '';
    var canDelete = !isReadOnly && linkId && linkId !== 'null' && linkId !== 'undefined';

    var metaLine = (createdAt || createdBy)
      ? '<div class="text-xs text-gray-400 mt-0.5">' +
          (createdAt ? 'Linked ' + createdAt : '') +
          (createdBy ? ' by ' + escapeHtml(createdBy) : '') +
        '</div>'
      : '';

    var actionBtn = canDelete
      ? '<button onclick="deleteLinkConfirm(\'' + escapeHtml(linkId) + '\', \'' + escapeHtml(linkedName) + '\')" class="flex-shrink-0 text-red-500 hover:text-red-700 p-1 rounded transition-colors" title="Remove link">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>' +
        '</button>'
      : '<span class="flex-shrink-0 text-gray-300 p-1" title="' + (isReadOnly ? 'System-generated link' : 'Link ID missing') + '">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>' +
        '</span>';

    return '<div class="bg-white border border-gray-200 hover:lex-border-accent rounded-lg p-2 flex items-center justify-between gap-2 transition-all">' +
      '<div class="flex-1 min-w-0">' +
        '<button onclick="refreshCurrentMatter()" class="text-xs font-medium lex-text-accent hover:lex-text-accent truncate block">' + escapeHtml(linkedName) + '</button>' +
        '<span class="text-xs text-gray-400 font-mono">' + escapeHtml(linkedId || '') + '</span>' +
        metaLine +
      '</div>' +
      actionBtn +
    '</div>';
  }

  // =========================================================================
  // Link Modal Handlers
  // =========================================================================

  function openCreateLinkModal(sourceMatterId, isWorkspace) {
    isWorkspace = isWorkspace === true || isWorkspace === 'true';

    var modal = document.getElementById('createLinkModal');
    if (!modal) return;

    var sourceInput = document.getElementById('linkSourceMatterId');
    var searchInput = document.getElementById('linkMatterSearch');
    var submitBtn = document.getElementById('createLinkBtn');
    var linkTypeContainer = document.getElementById('linkTypeContainer');
    var linkTypeSelect = document.getElementById('linkType');

    if (sourceInput) {
      sourceInput.value = sourceMatterId;
      sourceInput.dataset.isWorkspace = String(isWorkspace);
    }

    if (isWorkspace) {
      modal.heading = 'Add Matter to Workspace';
      modal.subtitle = 'Link an existing matter to this workspace';
      if (linkTypeContainer) linkTypeContainer.style.display = 'none';
      if (linkTypeSelect) linkTypeSelect.value = 'workspace_matter';
    } else {
      modal.heading = 'Link Related Matter';
      modal.subtitle = 'Connect this matter to another matter';
      if (linkTypeContainer) linkTypeContainer.style.display = 'block';
      if (linkTypeSelect) linkTypeSelect.value = 'related_to';
    }

    if (searchInput) searchInput.value = '';
    var resultsDiv = document.getElementById('linkMatterSearchResults');
    if (resultsDiv) resultsDiv.classList.add('hidden');
    var selectedDiv = document.getElementById('selectedLinkMatter');
    if (selectedDiv) selectedDiv.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = true;
    selectedLinkTargetMatter = null;

    modal.open = true;
    trackTimeout(setTimeout(function () {
      if (searchInput) {
        var inner = searchInput.querySelector('input');
        if (inner) { inner.focus(); } else { searchInput.focus(); }
      }
    }, 100));

    // Setup click-outside handler to close dropdown
    trackTimeout(setTimeout(function () {
      trackDocListener('click', handleLinkDropdownClickOutside);
    }, 100));

    // Wire lex-input event on search box (idempotent guard)
    if (searchInput && !searchInput._linkEventBound) {
      searchInput.addEventListener('lex-input', function (e) {
        var v = (e.detail && e.detail.value !== undefined) ? e.detail.value : searchInput.value;
        searchMattersForLink({ target: { value: v } });
      });
      var inner = searchInput.querySelector('input');
      if (inner) {
        inner.addEventListener('focus', function () { showLinkMatterDropdown(); });
      } else {
        searchInput.addEventListener('focus', function () { showLinkMatterDropdown(); });
      }
      searchInput._linkEventBound = true;
    }
  }

  function handleLinkDropdownClickOutside(event) {
    var searchInput = document.getElementById('linkMatterSearch');
    var resultsDiv = document.getElementById('linkMatterSearchResults');
    if (!searchInput || !resultsDiv) return;
    if (!searchInput.contains(event.target) && !resultsDiv.contains(event.target)) {
      resultsDiv.classList.add('hidden');
    }
  }

  function closeCreateLinkModal() {
    var modal = document.getElementById('createLinkModal');
    if (modal) modal.open = false;
    selectedLinkTargetMatter = null;

    if (linkSearchTimeout) {
      clearTimeout(linkSearchTimeout);
      linkSearchTimeout = null;
    }

    document.removeEventListener('click', handleLinkDropdownClickOutside);

    var resultsDiv = document.getElementById('linkMatterSearchResults');
    if (resultsDiv) resultsDiv.classList.add('hidden');
  }

  async function loadLinkMattersCache() {
    try {
      var response = await fetch(api.baseUrl + '/api/v1/matters?limit=100&status=active', {
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) throw new Error('Failed to load matters');

      var data = await response.json();
      linkMattersCache = data.matters || [];
    } catch (error) {
      console.error('Failed to load matters cache:', error);
      linkMattersCache = [];
    }
  }

  function showLinkDefaultView() {
    var resultsDiv = document.getElementById('linkMatterSearchResults');
    if (!resultsDiv) return;
    var sourceInput = document.getElementById('linkSourceMatterId');
    var sourceMatterId = sourceInput ? sourceInput.value : '';

    if (linkMattersCache.length === 0) {
      resultsDiv.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">No matters available</div>';
      resultsDiv.classList.remove('hidden');
      return;
    }

    var availableMatters = linkMattersCache.filter(function (m) {
      return m.matter_id !== sourceMatterId && m.matter_type === 'matter';
    });

    if (availableMatters.length === 0) {
      resultsDiv.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">No matters available to link</div>';
      resultsDiv.classList.remove('hidden');
      return;
    }

    var pinnedMatters = availableMatters.filter(function (m) { return m.is_pinned || m.pinned; });
    var unpinnedMatters = availableMatters.filter(function (m) { return !m.is_pinned && !m.pinned; });
    var recentMatters = unpinnedMatters
      .sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); })
      .slice(0, 10);

    var html = '';
    if (pinnedMatters.length > 0) {
      html +=
        '<div class="px-4 py-2 bg-gray-50 border-b border-gray-200">' +
          '<h4 class="text-xs font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">' +
            '<svg class="w-3 h-3 text-yellow-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>' +
            'Pinned Matters' +
          '</h4>' +
        '</div>';
      pinnedMatters.forEach(function (m) { html += renderLinkMatterItem(m, true); });
    }
    if (recentMatters.length > 0) {
      html +=
        '<div class="px-4 py-2 bg-gray-50 border-b border-gray-200">' +
          '<h4 class="text-xs font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-2">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' +
            'Recent Matters' +
          '</h4>' +
        '</div>';
      recentMatters.forEach(function (m) { html += renderLinkMatterItem(m, false); });
    }

    resultsDiv.innerHTML = html;
    resultsDiv.classList.remove('hidden');
  }

  async function showLinkMatterDropdown() {
    var searchInput = document.getElementById('linkMatterSearch');
    if (searchInput && searchInput.value.trim().length > 0) return;

    if (linkMattersCache.length === 0) {
      var resultsDiv = document.getElementById('linkMatterSearchResults');
      if (resultsDiv) {
        resultsDiv.innerHTML =
          '<div class="p-4 text-center text-gray-500">' +
            '<div class="animate-spin w-5 h-5 border-2 lex-border border-t-stone-600 rounded-full mx-auto mb-2"></div>' +
            'Loading matters...' +
          '</div>';
        resultsDiv.classList.remove('hidden');
      }
      await loadLinkMattersCache();
    }

    showLinkDefaultView();
  }

  function searchMattersForLink(event) {
    var query = event.target.value.trim();
    var resultsDiv = document.getElementById('linkMatterSearchResults');
    var sourceInput = document.getElementById('linkSourceMatterId');
    var sourceMatterId = sourceInput ? sourceInput.value : '';

    if (linkSearchTimeout) {
      clearTimeout(linkSearchTimeout);
    }

    if (query.length === 0) {
      showLinkDefaultView();
      return;
    }

    if (query.length < 2) {
      if (resultsDiv) resultsDiv.classList.add('hidden');
      return;
    }

    linkSearchTimeout = trackTimeout(setTimeout(async function () {
      try {
        if (resultsDiv) {
          resultsDiv.innerHTML =
            '<div class="p-4 text-center text-gray-500">' +
              '<div class="animate-spin w-5 h-5 border-2 lex-border border-t-stone-600 rounded-full mx-auto mb-2"></div>' +
              'Searching...' +
            '</div>';
          resultsDiv.classList.remove('hidden');
        }

        // Filter cache first for speed
        if (linkMattersCache.length > 0) {
          var lowerQuery = query.toLowerCase();
          var filtered = linkMattersCache.filter(function (m) {
            var matterName = (m.name || m.matter_name || '').toLowerCase();
            var clientName = (m.client_name || (m.client && m.client.name) || '').toLowerCase();
            var mid = (m.matter_id || '').toLowerCase();
            return m.matter_id !== sourceMatterId &&
              m.matter_type === 'matter' &&
              (matterName.indexOf(lowerQuery) !== -1 ||
               clientName.indexOf(lowerQuery) !== -1 ||
               mid.indexOf(lowerQuery) !== -1);
          });

          if (filtered.length > 0 && resultsDiv) {
            resultsDiv.innerHTML =
              '<div class="px-4 py-2 bg-gray-50 border-b border-gray-200">' +
                '<p class="text-xs text-gray-600">' + filtered.length + ' result' + (filtered.length !== 1 ? 's' : '') + ' found</p>' +
              '</div>';
            filtered.slice(0, 10).forEach(function (m) {
              resultsDiv.innerHTML += renderLinkMatterItem(m, false);
            });
            resultsDiv.classList.remove('hidden');
            return;
          }
        }

        // Fallback to API
        var response = await fetch(
          api.baseUrl + '/api/v1/matters?search=' + encodeURIComponent(query) + '&limit=10',
          {
            headers: {
              'Authorization': 'Bearer ' + api.token,
              'Content-Type': 'application/json'
            }
          }
        );

        if (!response.ok) throw new Error('Search failed');

        var data = await response.json();
        var filteredMatters = (data.matters || []).filter(function (m) {
          return m.matter_id !== sourceMatterId && m.matter_type === 'matter';
        });

        if (resultsDiv) {
          if (filteredMatters.length === 0) {
            resultsDiv.innerHTML =
              '<div class="p-4 text-center text-gray-500 text-sm">No matters found matching "' + escapeHtml(query) + '"</div>';
          } else {
            resultsDiv.innerHTML =
              '<div class="px-4 py-2 bg-gray-50 border-b border-gray-200">' +
                '<p class="text-xs text-gray-600">' + filteredMatters.length + ' result' + (filteredMatters.length !== 1 ? 's' : '') + ' found</p>' +
              '</div>';
            filteredMatters.forEach(function (m) {
              resultsDiv.innerHTML += renderLinkMatterItem(m, false);
            });
          }
          resultsDiv.classList.remove('hidden');
        }
      } catch (error) {
        console.error('Matter search error:', error);
        if (resultsDiv) {
          resultsDiv.innerHTML = '<div class="p-4 text-center text-red-600 text-sm">Search failed. Please try again.</div>';
        }
      }
    }, 300));
  }

  function selectLinkMatter(matterId, matterName, matterType) {
    selectedLinkTargetMatter = { matter_id: matterId, name: matterName, matter_type: matterType };

    var resultsDiv = document.getElementById('linkMatterSearchResults');
    if (resultsDiv) resultsDiv.classList.add('hidden');
    var searchInput = document.getElementById('linkMatterSearch');
    if (searchInput) searchInput.value = '';

    var nameEl = document.getElementById('selectedLinkMatterName');
    if (nameEl) nameEl.textContent = matterName;
    var idEl = document.getElementById('selectedLinkMatterId');
    if (idEl) idEl.textContent = matterId;
    var selectedDiv = document.getElementById('selectedLinkMatter');
    if (selectedDiv) selectedDiv.classList.remove('hidden');

    var submitBtn = document.getElementById('createLinkBtn');
    if (submitBtn) submitBtn.disabled = false;
  }

  function clearLinkMatterSelection() {
    selectedLinkTargetMatter = null;
    var selectedDiv = document.getElementById('selectedLinkMatter');
    if (selectedDiv) selectedDiv.classList.add('hidden');
    var searchInput = document.getElementById('linkMatterSearch');
    if (searchInput) searchInput.value = '';
    var submitBtn = document.getElementById('createLinkBtn');
    if (submitBtn) submitBtn.disabled = true;
  }

  async function createLink(event) {
    event.preventDefault();

    var sourceInput = document.getElementById('linkSourceMatterId');
    var sourceMatterId = sourceInput ? sourceInput.value : '';
    var isWorkspace = sourceInput && sourceInput.dataset.isWorkspace === 'true';

    var linkTypeSelect = document.getElementById('linkType');
    var linkType = linkTypeSelect ? linkTypeSelect.value : 'related_to';
    if (isWorkspace) linkType = 'workspace_matter';

    var submitBtn = document.getElementById('createLinkBtn');

    if (!selectedLinkTargetMatter) {
      Lex.Toast.error('Please select a matter to link');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
      }

      var response = await fetch(api.baseUrl + '/api/v1/entity-links', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source_matter_id: sourceMatterId,
          target_matter_id: selectedLinkTargetMatter.matter_id,
          link_type: linkType
        })
      });

      if (!response.ok) {
        var errData = await response.json();
        throw new Error((errData.error && errData.error.message) || 'Failed to create link');
      }

      Lex.Toast.success('Link created successfully');
      closeCreateLinkModal();

      if (currentMatterData && currentMatterData.matter && document.getElementById('linkedMattersSection')) {
        renderLinkedMattersInDock(currentMatterData.matter);
      }

    } catch (error) {
      console.error('Create link error:', error);
      Lex.Toast.error(error.message || 'Failed to create link');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Link';
      }
    }
  }

  function renderLinkMatterItem(matter, isPinned) {
    isPinned = isPinned || false;
    var clientName = matter.client_name || (matter.client && matter.client.name) || 'Unknown Client';
    var matterName = matter.name || matter.matter_name || 'Untitled Matter';
    var status = matter.status || 'Active';
    // Escape single quotes in name for onclick attribute: no regex — use split/join
    var safeName = matterName.split("'").join('&apos;');

    var pinIcon = isPinned
      ? '<svg class="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>'
      : '';

    var statusClass = status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700';

    return '<button type="button" onclick="selectLinkMatter(\'' + escapeHtml(matter.matter_id) + '\', \'' + safeName + '\', \'' + escapeHtml(matter.matter_type) + '\')" class="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors">' +
      '<div class="flex items-start gap-2">' +
        pinIcon +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2 mb-1">' +
            '<span class="font-medium text-gray-900 text-sm truncate">' + escapeHtml(matterName) + '</span>' +
            '<span class="px-2 py-0.5 text-xs rounded-full ' + statusClass + '">' + escapeHtml(status) + '</span>' +
          '</div>' +
          '<p class="text-xs text-gray-600 truncate">' + escapeHtml(clientName) + '</p>' +
          '<p class="text-xs text-gray-500 font-mono mt-0.5">' + escapeHtml(matter.matter_id) + '</p>' +
        '</div>' +
      '</div>' +
    '</button>';
  }

  function deleteLinkConfirm(linkId, linkedMatterName) {
    window.pendingUnlinkId = linkId;

    var nameEl = document.getElementById('unlinkMatterName');
    if (nameEl) nameEl.textContent = '"' + linkedMatterName + '"';

    var modal = document.getElementById('unlinkConfirmModal');
    if (!modal) return;

    if (!modal._confirmListenerAttached) {
      modal.addEventListener('lex-confirm', function () {
        var idToDelete = window.pendingUnlinkId;
        closeUnlinkConfirmModal();
        deleteLink(idToDelete);
      });
      modal.addEventListener('lex-cancel', function () { closeUnlinkConfirmModal(); });
      modal._confirmListenerAttached = true;
    }
    modal.open = true;
  }

  function closeUnlinkConfirmModal() {
    var modal = document.getElementById('unlinkConfirmModal');
    if (modal) modal.open = false;
    window.pendingUnlinkId = null;
  }

  async function deleteLink(linkId) {
    if (!linkId || linkId === 'null' || linkId === 'undefined') {
      console.error('Invalid link ID:', linkId);
      Lex.Toast.error('Cannot delete link: Invalid link ID');
      return;
    }

    try {
      var response = await fetch(api.baseUrl + '/api/v1/entity-links/' + linkId, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        var errData = await response.json();
        throw new Error((errData.error && errData.error.message) || 'Failed to delete link');
      }

      Lex.Toast.success('Link removed successfully');

      if (currentMatterData && currentMatterData.matter && document.getElementById('linkedMattersSection')) {
        renderLinkedMattersInDock(currentMatterData.matter);
      }

    } catch (error) {
      console.error('Delete link error:', error);
      Lex.Toast.error(error.message || 'Failed to delete link');
    }
  }

  // =========================================================================
  // Window globals for contact handlers
  // =========================================================================

  window.openAddContactModal = openAddContactModal;
  window.closeContactModal = closeContactModal;
  window.saveContact = saveContact;
  window.openContactDetail = openContactDetail;
  window.closeContactDetailModal = closeContactDetailModal;
  window.openEditContactModal = openEditContactModal;
  window.closeEditContactModal = closeEditContactModal;
  window.updateContact = updateContact;
  window.confirmDeleteContact = confirmDeleteContact;
  window.deleteContact = deleteContact;

  ['openAddContactModal', 'closeContactModal', 'saveContact', 'openContactDetail',
   'closeContactDetailModal', 'openEditContactModal', 'closeEditContactModal',
   'updateContact', 'confirmDeleteContact', 'deleteContact'].forEach(_trackGlobal);

  // =========================================================================
  // Window globals for linked matters handlers
  // =========================================================================

  window.renderLinkedMattersInDetails = renderLinkedMattersInDetails;
  window.renderLinkedMattersInlineContent = renderLinkedMattersInlineContent;
  window.renderLinkedMattersInDock = renderLinkedMattersInDock;
  window.renderLinkSection = renderLinkSection;
  window.getLinkIcon = getLinkIcon;
  window.renderLinkCard = renderLinkCard;

  ['renderLinkedMattersInDetails', 'renderLinkedMattersInlineContent',
   'renderLinkedMattersInDock',
   'renderLinkSection', 'getLinkIcon', 'renderLinkCard'].forEach(_trackGlobal);

  // =========================================================================
  // Window globals for link modal handlers
  // =========================================================================

  window.openCreateLinkModal = openCreateLinkModal;
  window.closeCreateLinkModal = closeCreateLinkModal;
  window.loadLinkMattersCache = loadLinkMattersCache;
  window.showLinkDefaultView = showLinkDefaultView;
  window.showLinkMatterDropdown = showLinkMatterDropdown;
  window.searchMattersForLink = searchMattersForLink;
  window.selectLinkMatter = selectLinkMatter;
  window.clearLinkMatterSelection = clearLinkMatterSelection;
  window.createLink = createLink;
  window.renderLinkMatterItem = renderLinkMatterItem;
  window.deleteLinkConfirm = deleteLinkConfirm;
  window.closeUnlinkConfirmModal = closeUnlinkConfirmModal;
  window.deleteLink = deleteLink;

  ['openCreateLinkModal', 'closeCreateLinkModal', 'loadLinkMattersCache',
   'showLinkDefaultView', 'showLinkMatterDropdown', 'searchMattersForLink',
   'selectLinkMatter', 'clearLinkMatterSelection', 'createLink',
   'renderLinkMatterItem', 'deleteLinkConfirm', 'closeUnlinkConfirmModal',
   'deleteLink'].forEach(_trackGlobal);

  // =========================================================================
  // Task Modal
  // =========================================================================

  // Populate assignee dropdown with organisation users
  async function populateTaskAssignees(selectedUserId) {
    selectedUserId = selectedUserId || null;
    try {
      var result = await api.getUsers(1, 200);
      var users = result.users || [];
      var dropdown = document.getElementById('taskAssignedTo');
      var currentUserId = api.user && api.user.id;

      var optionsList = [{ value: '', label: 'Unassigned' }];

      // Add "Me" option for current user first
      if (currentUserId) {
        var currentUser = null;
        for (var ci = 0; ci < users.length; ci++) {
          if (users[ci].id === currentUserId) { currentUser = users[ci]; break; }
        }
        if (currentUser) {
          optionsList.push({
            value: currentUserId,
            label: 'Me (' + (currentUser.first_name || currentUser.firstName || '') + ' ' + (currentUser.last_name || currentUser.lastName || '') + ')'
          });
        }
      }

      // Add remaining users
      for (var ui = 0; ui < users.length; ui++) {
        var u = users[ui];
        if (u.id === currentUserId) continue;
        optionsList.push({
          value: u.id,
          label: (u.first_name || u.firstName || '') + ' ' + (u.last_name || u.lastName || '')
        });
      }

      if (dropdown) {
        dropdown.options = optionsList;
        dropdown.value = selectedUserId || currentUserId || '';
      }
    } catch (err) {
      console.error('Failed to load users for task assignment:', err);
      Lex.Toast.error('Failed to load users');
    }
  }

  // Open Create Task Modal
  async function openCreateTaskModal(matterId) {
    currentTaskMatterId = matterId;
    currentEditingTask = null;

    var modal = document.getElementById('taskModal');
    if (!modal) return;

    modal.heading = 'Create Task';
    var form = document.getElementById('taskForm');
    if (form) form.reset();
    var taskIdEl = document.getElementById('taskId');
    if (taskIdEl) taskIdEl.value = '';

    // Hide delete button when creating
    var deleteBtn = document.getElementById('taskDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';

    // Clear lex field values
    var clearFields = ['taskTitle', 'taskDescription', 'taskNotes', 'taskDueDate'];
    for (var fi = 0; fi < clearFields.length; fi++) {
      var el = document.getElementById(clearFields[fi]);
      if (el) el.value = '';
    }

    var taskStatusEl = document.getElementById('taskStatus');
    if (taskStatusEl) taskStatusEl.value = 'pending';
    var taskPriorityEl = document.getElementById('taskPriority');
    if (taskPriorityEl) taskPriorityEl.value = 'normal';

    await populateTaskAssignees(null);

    modal.open = true;
  }

  // Edit Task — finds from cached list to avoid redundant requests
  async function editTask(taskId) {
    try {
      // Find task from cached list
      var task = null;
      for (var ti = 0; ti < currentTasksList.length; ti++) {
        if (currentTasksList[ti].id === taskId) { task = currentTasksList[ti]; break; }
      }

      if (!task) {
        Lex.Toast.error('Task not found');
        return;
      }

      currentEditingTask = task;
      var modal = document.getElementById('taskModal');
      if (!modal) return;

      modal.heading = 'Edit Task';
      modal.open = true;

      // Show delete button when editing
      var deleteBtn = document.getElementById('taskDeleteBtn');
      if (deleteBtn) deleteBtn.style.display = '';

      var taskIdEl = document.getElementById('taskId');
      if (taskIdEl) taskIdEl.value = task.id;

      var titleEl = document.getElementById('taskTitle');
      if (titleEl) titleEl.value = task.title || '';

      var descEl = document.getElementById('taskDescription');
      if (descEl) descEl.value = task.description || '';

      var notesEl = document.getElementById('taskNotes');
      if (notesEl) notesEl.value = task.notes || '';

      var statusEl = document.getElementById('taskStatus');
      if (statusEl) statusEl.value = task.status || 'pending';

      var priorityEl = document.getElementById('taskPriority');
      if (priorityEl) priorityEl.value = task.priority || 'normal';

      var dueDateEl = document.getElementById('taskDueDate');
      if (dueDateEl) {
        if (task.due_date) {
          var d = new Date(task.due_date);
          dueDateEl.value = d.toISOString().slice(0, 16);
        } else {
          dueDateEl.value = '';
        }
      }

      await populateTaskAssignees(task.assigned_to_user_id || null);

    } catch (err) {
      console.error('Edit task error:', err);
      Lex.Toast.error('Failed to load task details');
    }
  }

  // Quick Complete Task
  async function quickCompleteTask(taskId) {
    try {
      await api.completeTask(taskId);
      Lex.Toast.success('Task completed');
      await refreshCurrentMatter();
    } catch (err) {
      console.error('Complete task error:', err);
      Lex.Toast.error('Failed to complete task');
    }
  }

  // Inline delete confirmation
  function confirmDeleteTask() {
    var btn = document.getElementById('taskDeleteBtn');
    var confirm = document.getElementById('taskDeleteConfirm');
    if (btn) btn.classList.add('hidden');
    if (confirm) confirm.classList.remove('hidden');
  }

  function cancelDeleteTask() {
    var btn = document.getElementById('taskDeleteBtn');
    var confirm = document.getElementById('taskDeleteConfirm');
    if (btn) btn.classList.remove('hidden');
    if (confirm) confirm.classList.add('hidden');
  }
  window.confirmDeleteTask = confirmDeleteTask;
  window.cancelDeleteTask = cancelDeleteTask;

  // Delete Task
  async function deleteTask(taskId) {
    if (!taskId) return;

    try {
      closeTaskModal();
      await api.deleteTask(taskId);
      Lex.Toast.success('Task deleted successfully');
      await refreshCurrentMatter();
    } catch (err) {
      console.error('Delete task error:', err);
      Lex.Toast.error('Failed to delete task');
    }
  }

  // Save Task (Create or Update)
  async function saveTask(event) {
    event.preventDefault();

    var taskIdEl = document.getElementById('taskId');
    var taskId = taskIdEl ? taskIdEl.value : '';
    var isEdit = !!taskId;

    var taskData = {
      title: (document.getElementById('taskTitle') || {}).value || '',
      description: (document.getElementById('taskDescription') || {}).value || null,
      notes: (document.getElementById('taskNotes') || {}).value || null,
      status: (document.getElementById('taskStatus') || {}).value || 'pending',
      priority: (document.getElementById('taskPriority') || {}).value || 'normal',
      due_date: (document.getElementById('taskDueDate') || {}).value || null,
      assigned_to_user_id: (document.getElementById('taskAssignedTo') || {}).value || null
    };

    var form = event.target;
    var submitBtn = form.querySelector('button[type="submit"]');
    var originalHtml = submitBtn ? submitBtn.innerHTML : '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-50', 'cursor-not-allowed');
      submitBtn.innerHTML =
        '<svg class="animate-spin h-4 w-4 inline-block mr-2" fill="none" viewBox="0 0 24 24">' +
          '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
          '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
        '</svg>' +
        (isEdit ? 'Updating...' : 'Creating...');
    }

    try {
      if (isEdit) {
        await api.updateTask(taskId, taskData);
        Lex.Toast.success('Task updated successfully');
      } else {
        await api.createTask(currentTaskMatterId, taskData);
        Lex.Toast.success('Task created successfully');
      }

      var modal = document.getElementById('taskModal');
      if (modal) modal.open = false;

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        submitBtn.innerHTML = originalHtml;
      }

      await refreshCurrentMatter();

    } catch (err) {
      console.error('Save task error:', err);
      Lex.Toast.error(isEdit ? 'Failed to update task' : 'Failed to create task');

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        submitBtn.innerHTML = originalHtml;
      }
    }
  }

  // Close Task Modal
  function closeTaskModal() {
    var modal = document.getElementById('taskModal');
    if (modal) modal.open = false;
    var form = document.getElementById('taskForm');
    if (form) form.reset();
    currentTaskMatterId = null;
    currentEditingTask = null;
  }

  // =========================================================================
  // Window globals for task modal handlers
  // =========================================================================

  window.populateTaskAssignees = populateTaskAssignees;
  window.openCreateTaskModal = openCreateTaskModal;
  window.editTask = editTask;
  window.quickCompleteTask = quickCompleteTask;
  window.deleteTask = deleteTask;
  window.saveTask = saveTask;
  window.closeTaskModal = closeTaskModal;

  ['populateTaskAssignees', 'openCreateTaskModal', 'editTask',
   'quickCompleteTask', 'deleteTask', 'saveTask', 'closeTaskModal'].forEach(_trackGlobal);

  // =========================================================================
  // Share Modal
  // =========================================================================

  // Open Manage Share Modal
  function showSharedUserInfo(index) {
    if (!currentMatterData || !currentMatterData.permissions) return;
    var p = currentMatterData.permissions[index];
    if (!p) return;

    var modal = document.getElementById('sharedUserInfoModal');
    if (!modal) return;

    var initials = ((p.first_name || '')[0] || '') + ((p.last_name || '')[0] || '');
    var fullName = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Unknown User';

    var body = document.getElementById('sharedUserInfoBody');
    if (!body) return;

    body.innerHTML =
      '<div class="flex flex-col items-center text-center py-2">' +
        '<div class="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold mb-3" style="background: var(--lex-bg-accent-soft); color: var(--lex-text-accent)">' + (initials || 'U') + '</div>' +
        '<h3 class="text-lg font-semibold text-gray-900">' + escapeHtml(fullName) + '</h3>' +
        (p.email ? '<p class="text-sm text-gray-500 mt-0.5">' + escapeHtml(p.email) + '</p>' : '') +
        (p.permission_level ? '<span class="mt-2 inline-block text-xs px-2 py-0.5 rounded-full font-medium" style="background: var(--lex-bg-accent-soft); color: var(--lex-text-accent)">' + escapeHtml(p.permission_level) + '</span>' : '') +
      '</div>' +
      (p.role || p.department ? '<div class="mt-4 pt-4 border-t border-gray-100 space-y-2 text-sm">' +
        (p.role ? '<div class="flex justify-between"><span class="text-gray-500">Role</span><span class="text-gray-900">' + escapeHtml(p.role) + '</span></div>' : '') +
        (p.department ? '<div class="flex justify-between"><span class="text-gray-500">Department</span><span class="text-gray-900">' + escapeHtml(p.department) + '</span></div>' : '') +
      '</div>' : '');

    modal.open = true;
  }

  function openSharedWithDrawer() {
    if (!currentMatterData || !currentMatterData.permissions) return;
    var permissions = currentMatterData.permissions;
    var matterId = currentMatterData.matter && currentMatterData.matter.matter_id;

    var modal = document.getElementById('sharedWithDrawer');
    if (!modal) return;

    // Build the full list
    var listEl = document.getElementById('sharedWithDrawerList');
    if (!listEl) return;

    var html = '';
    if (permissions.length === 0) {
      html = '<p class="text-sm text-gray-500 text-center py-4">No one has been shared access yet.</p>';
    } else {
      html = '<div class="flex items-center flex-wrap gap-2">';
      for (var di = 0; di < permissions.length; di++) {
        html += buildUserChip(permissions[di], di);
      }
      html += '</div>';
    }

    listEl.innerHTML = html;
    modal.open = true;
  }

  async function openManageShareModal(matterId) {
    try {
      window.currentManageShareMatterId = matterId;

      // Fetch full matter details
      var matterResponse = await fetch(api.baseUrl + '/api/v1/matters/' + matterId + '?full_details=true', {
        headers: { 'Authorization': 'Bearer ' + api.token }
      });
      if (!matterResponse.ok) {
        throw new Error('Failed to load matter details');
      }
      var matter = await matterResponse.json();

      // Fetch permissions separately if needed
      var permissions = matter.permissions || [];
      if (permissions.length === 0) {
        try {
          var permResp = await fetch(api.baseUrl + '/api/v1/matters/' + matterId + '/permissions', {
            headers: { 'Authorization': 'Bearer ' + api.token }
          });
          if (permResp.ok) {
            var permData = await permResp.json();
            permissions = permData.permissions || permData || [];
          }
        } catch (permErr) {
          console.warn('[openManageShareModal] Could not fetch permissions:', permErr);
        }
      }

      // Fetch all organisation users
      var usersResp = await fetch(api.baseUrl + '/api/v1/users', {
        headers: { 'Authorization': 'Bearer ' + api.token }
      });
      if (!usersResp.ok) {
        throw new Error('Failed to load users');
      }
      var usersData = await usersResp.json();
      var users = Array.isArray(usersData) ? usersData : (usersData.users || []);

      // Set visibility
      var visEl = document.getElementById('modalMatterVisibility');
      if (visEl) visEl.value = matter.visibility || 'private';

      // Build list of already-shared user IDs from multiple possible shapes
      var sharedUserIds = [];
      if (matter.shared_with_users && Array.isArray(matter.shared_with_users)) {
        for (var si = 0; si < matter.shared_with_users.length; si++) {
          sharedUserIds.push(matter.shared_with_users[si].user_id || matter.shared_with_users[si].id);
        }
      } else if (permissions && permissions.length > 0) {
        for (var pi = 0; pi < permissions.length; pi++) {
          sharedUserIds.push(permissions[pi].user_id || permissions[pi].id);
        }
      } else if (matter.shared_with && Array.isArray(matter.shared_with)) {
        sharedUserIds = matter.shared_with.slice();
      }

      var currentUserId = api.user && api.user.id;

      // Filter out current user, sort shared first then alpha
      var filteredUsers = [];
      for (var fu = 0; fu < users.length; fu++) {
        if (users[fu].id !== currentUserId) filteredUsers.push(users[fu]);
      }

      filteredUsers.sort(function (a, b) {
        var aShared = sharedUserIds.indexOf(a.id) !== -1;
        var bShared = sharedUserIds.indexOf(b.id) !== -1;
        if (aShared && !bShared) return -1;
        if (!aShared && bShared) return 1;
        var aName = ((a.first_name || '') + ' ' + (a.last_name || '')).trim() || a.email || '';
        var bName = ((b.first_name || '') + ' ' + (b.last_name || '')).trim() || b.email || '';
        return aName.localeCompare(bName);
      });

      var shareWithContainer = document.getElementById('modalShareWith');
      if (!shareWithContainer) return;

      if (filteredUsers.length === 0) {
        shareWithContainer.innerHTML =
          '<div class="p-4 text-center text-gray-500 text-sm">No other users available to share with</div>';
      } else {
        var rows = '';
        for (var ri = 0; ri < filteredUsers.length; ri++) {
          var usr = filteredUsers[ri];
          var isChecked = sharedUserIds.indexOf(usr.id) !== -1;
          var fullName = ((usr.first_name || '') + ' ' + (usr.last_name || '')).trim();
          var displayName = fullName || usr.email || '';
          var initials = ((usr.first_name ? usr.first_name[0] : '') + (usr.last_name ? usr.last_name[0] : '')).toUpperCase() || (usr.email ? usr.email[0].toUpperCase() : 'U');

          // Divider between shared and unshared groups
          var prevUser = ri > 0 ? filteredUsers[ri - 1] : null;
          var showDivider = prevUser && (sharedUserIds.indexOf(prevUser.id) !== -1) && !isChecked;

          if (showDivider) {
            rows += '<div class="border-t-2 border-gray-200 my-1">' +
              '<div class="px-4 py-2 bg-gray-50">' +
                '<p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Other Team Members</p>' +
              '</div></div>';
          }

          rows +=
            '<label class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0">' +
              '<input type="checkbox" name="shareUser" value="' + escapeHtml(usr.id) + '"' + (isChecked ? ' checked' : '') +
                ' class="w-4 h-4 lex-text-accent border-gray-300 rounded lex-ring-focus focus:ring-2"/>' +
              '<div class="flex-1 min-w-0">' +
                '<div class="flex items-center gap-2">' +
                  '<div class="w-8 h-8 lex-bg-accent-soft rounded-full flex items-center justify-center flex-shrink-0">' +
                    '<span class="text-xs font-medium lex-text-accent">' + escapeHtml(initials) + '</span>' +
                  '</div>' +
                  '<div class="min-w-0 flex-1">' +
                    '<p class="text-sm font-medium text-gray-900 truncate">' + escapeHtml(displayName) + '</p>' +
                    '<p class="text-xs text-gray-500 truncate">' + escapeHtml(usr.email || '') + '</p>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</label>';
        }
        shareWithContainer.innerHTML = rows;
      }

      // Visibility change handler — disable user list when org-wide
      var visibilitySelect = document.getElementById('modalMatterVisibility');
      var shareSection = document.getElementById('modalShareSection');

      if (visibilitySelect && shareSection) {
        visibilitySelect.addEventListener('lex-change', function (e) {
          var val = (e.detail && e.detail.value !== undefined) ? e.detail.value : visibilitySelect.value;
          if (val === 'organization') {
            shareSection.style.opacity = '0.5';
            shareSection.style.pointerEvents = 'none';
            var cbs = document.querySelectorAll('input[name="shareUser"]');
            for (var ci = 0; ci < cbs.length; ci++) cbs[ci].checked = false;
          } else {
            shareSection.style.opacity = '1';
            shareSection.style.pointerEvents = 'auto';
          }
        });

        // Apply initial state
        if (matter.visibility === 'organization') {
          shareSection.style.opacity = '0.5';
          shareSection.style.pointerEvents = 'none';
        }
      }

      // Search within user list
      var searchInput = document.getElementById('modalShareSearch');
      if (searchInput && shareWithContainer) {
        searchInput.addEventListener('lex-input', function (e) {
          var sv = (e.detail && e.detail.value !== undefined) ? e.detail.value : searchInput.value;
          var term = String(sv).toLowerCase().trim();
          var labels = shareWithContainer.querySelectorAll('label');
          for (var li = 0; li < labels.length; li++) {
            var nameEl = labels[li].querySelector('.text-gray-900');
            var emailEl = labels[li].querySelector('.text-gray-500');
            var name = nameEl ? nameEl.textContent.toLowerCase() : '';
            var email = emailEl ? emailEl.textContent.toLowerCase() : '';
            if (term === '' || name.indexOf(term) !== -1 || email.indexOf(term) !== -1) {
              labels[li].style.display = 'flex';
            } else {
              labels[li].style.display = 'none';
            }
          }
          // "No results" message
          var visible = Array.prototype.filter.call(labels, function (l) { return l.style.display !== 'none'; });
          var noResultsMsg = shareWithContainer.querySelector('.no-results-message');
          if (visible.length === 0 && term !== '') {
            if (!noResultsMsg) {
              var noDiv = document.createElement('div');
              noDiv.className = 'no-results-message p-4 text-center text-gray-500 text-sm';
              noDiv.textContent = 'No users found matching your search';
              shareWithContainer.appendChild(noDiv);
            }
          } else if (noResultsMsg) {
            noResultsMsg.parentNode.removeChild(noResultsMsg);
          }
        });
      }

      // Open modal
      var modal = document.getElementById('manageShareModal');
      if (modal) modal.open = true;

    } catch (err) {
      console.error('Error opening share modal:', err);
      Lex.Toast.error(err.message || 'Failed to open share modal');
    }
  }

  // Close Manage Share Modal
  function closeManageShareModal() {
    var modal = document.getElementById('manageShareModal');
    if (modal) modal.open = false;
    window.currentManageShareMatterId = null;
    var searchInput = document.getElementById('modalShareSearch');
    if (searchInput) searchInput.value = '';
  }

  // Save Share Settings
  async function saveShareSettings() {
    try {
      var matterId = window.currentManageShareMatterId;
      if (!matterId) throw new Error('No matter selected');

      var saveButton = document.getElementById('saveShareButton');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.innerHTML =
          '<svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">' +
            '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
            '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
          '</svg> Saving...';
      }

      var visibilityEl = document.getElementById('modalMatterVisibility');
      var visibility = visibilityEl ? visibilityEl.value : 'private';

      var checkedBoxes = document.querySelectorAll('input[name="shareUser"]:checked');
      var selectedUsers = [];
      for (var ci = 0; ci < checkedBoxes.length; ci++) {
        selectedUsers.push(checkedBoxes[ci].value);
      }

      // Step 1: Update matter visibility
      var response = await fetch(api.baseUrl + '/api/v1/matters/' + matterId, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + api.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ visibility: visibility })
      });
      if (!response.ok) {
        var errData = await response.json();
        throw new Error((errData.error && errData.error.message) || 'Failed to update sharing settings');
      }

      // Step 2: Fetch current permissions
      var permResp = await fetch(api.baseUrl + '/api/v1/matters/' + matterId + '/permissions', {
        headers: { 'Authorization': 'Bearer ' + api.token }
      });
      if (!permResp.ok) throw new Error('Failed to fetch current permissions');
      var permData = await permResp.json();
      var currentUserIds = (permData.permissions || []).map(function (p) { return p.user_id; });

      // Step 3: Reconcile user sharing
      var newUserIds = visibility === 'organization' ? [] : selectedUsers;

      for (var ri = 0; ri < currentUserIds.length; ri++) {
        var uid = currentUserIds[ri];
        if (newUserIds.indexOf(uid) === -1) {
          await api.removeMatterShare(matterId, uid).catch(function (err) {
            console.warn('Failed to remove share for user', uid, err);
          });
        }
      }

      for (var ni = 0; ni < newUserIds.length; ni++) {
        var nuid = newUserIds[ni];
        if (currentUserIds.indexOf(nuid) === -1) {
          await api.shareMatterWithUser(matterId, nuid, ['read', 'write']).catch(function (err) {
            console.warn('Failed to share with user', nuid, err);
          });
        }
      }

      Lex.Toast.success('Sharing settings updated successfully');
      closeManageShareModal();
      await refreshCurrentMatter();

    } catch (err) {
      console.error('Error saving share settings:', err);
      Lex.Toast.error(err.message || 'Failed to save sharing settings');
    } finally {
      var saveButton = document.getElementById('saveShareButton');
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.innerHTML =
          '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>' +
          '</svg> Save Changes';
      }
    }
  }

  // Remove Share (quick remove from detail view)
  async function removeShare(matterId, userId) {
    try {
      await api.removeMatterShare(matterId, userId);
      Lex.Toast.success('Access removed');
      await refreshCurrentMatter();
    } catch (err) {
      Lex.Toast.error(err.message || 'Failed to remove access');
    }
  }

  // =========================================================================
  // Window globals for share modal handlers
  // =========================================================================

  window.openManageShareModal = openManageShareModal;
  window.openSharedWithDrawer = openSharedWithDrawer;
  window.showSharedUserInfo = showSharedUserInfo;
  window.openContactsDrawer = openContactsDrawer;
  window.openLinkedMattersDrawer = openLinkedMattersDrawer;
  window.navigateToMatter = navigateToMatter;
  window.closeManageShareModal = closeManageShareModal;
  window.saveShareSettings = saveShareSettings;
  window.removeShare = removeShare;

  ['openManageShareModal', 'closeManageShareModal', 'saveShareSettings', 'removeShare'].forEach(_trackGlobal);

  // =========================================================================
  // Manual Connect Modal
  // =========================================================================

  // Show manual connect modal
  function showManualConnectModal(matterId) {
    currentManualConnectMatter = matterId;
    var modal = document.getElementById('manualConnectModal');
    if (!modal) return;
    modal.open = true;

    loadAvailableConnectors();

    var searchInput = document.getElementById('manualConnectSearch');
    var entityTypeSelect = document.getElementById('manualConnectEntityType');
    var connectorSelect = document.getElementById('manualConnectConnector');

    if (searchInput) {
      searchInput.addEventListener('lex-input', function () {
        clearTimeout(manualConnectSearchTimeout);
        manualConnectSearchTimeout = setTimeout(performManualConnectSearch, 300);
      });
    }
    if (entityTypeSelect) entityTypeSelect.addEventListener('lex-change', performManualConnectSearch);
    if (connectorSelect) connectorSelect.addEventListener('lex-change', performManualConnectSearch);

    // Reset field values
    if (searchInput) searchInput.value = '';
    if (entityTypeSelect) entityTypeSelect.value = '';
    if (connectorSelect) connectorSelect.value = '';
  }

  // Close manual connect modal
  function closeManualConnectModal() {
    var modal = document.getElementById('manualConnectModal');
    if (modal) modal.open = false;
    currentManualConnectMatter = null;
  }

  // Load available connectors for the filter dropdown
  async function loadAvailableConnectors() {
    try {
      var response = await api.get('/api/v1/connectors/integration-sources?status=active');
      var connectors = response.sources || [];

      var select = document.getElementById('manualConnectConnector');
      if (!select) return;

      var optionsList = [{ value: '', label: 'All Connectors' }];
      for (var ci = 0; ci < connectors.length; ci++) {
        var conn = connectors[ci];
        optionsList.push({
          value: conn.connector_id,
          label: conn.connector_name || conn.connector_id
        });
      }
      select.options = optionsList;
    } catch (err) {
      console.error('[loadAvailableConnectors] Error:', err);
    }
  }

  // Perform connector data search
  async function performManualConnectSearch() {
    var searchInput = document.getElementById('manualConnectSearch');
    var entityTypeSelect = document.getElementById('manualConnectEntityType');
    var connectorSelect = document.getElementById('manualConnectConnector');
    var resultsDiv = document.getElementById('manualConnectResults');
    if (!resultsDiv) return;

    var search = searchInput ? searchInput.value.trim() : '';
    var entityType = entityTypeSelect ? entityTypeSelect.value : '';
    var connectorId = connectorSelect ? connectorSelect.value : '';

    // Show loading state
    resultsDiv.innerHTML =
      '<div class="text-center py-8">' +
        '<div class="animate-spin w-8 h-8 border-4 lex-border border-t-stone-600 rounded-full mx-auto mb-4"></div>' +
        '<p class="text-gray-500">Searching...</p>' +
      '</div>';

    try {
      var response = await api.searchConnectorDataForLinking(currentManualConnectMatter, {
        search: search,
        entity_type: entityType,
        connector_id: connectorId,
        limit: 20
      });

      var results = response.results || [];

      if (results.length === 0) {
        resultsDiv.innerHTML =
          '<div class="text-center py-8 text-gray-500">' +
            '<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
            '</svg>' +
            '<p class="mt-2">No results found</p>' +
          '</div>';
        return;
      }

      var cards = '';
      for (var ri = 0; ri < results.length; ri++) {
        cards += renderSearchResultCard(results[ri]);
      }
      resultsDiv.innerHTML = '<div class="space-y-2">' + cards + '</div>';

    } catch (err) {
      console.error('[performManualConnectSearch] Error:', err);
      resultsDiv.innerHTML =
        '<div class="text-center py-8 text-red-600">' +
          '<svg class="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
          '</svg>' +
          '<p class="mt-2">Error loading results</p>' +
          '<p class="text-sm text-gray-500">' + escapeHtml(err.message || '') + '</p>' +
        '</div>';
    }
  }

  // Render a single search result card — NO regex, use split/join
  function renderSearchResultCard(item) {
    var data = item.data || {};
    var title = data.name || data.title || item.external_id || '';
    var subtitle = data.description || data.status || item.entity_type || '';

    // entity_type badge: replace underscores with spaces using split/join (no regex)
    var entityLabel = item.entity_type ? item.entity_type.split('_').join(' ') : '';

    return '<div class="border border-gray-200 rounded-lg p-4 hover:lex-border-accent hover:bg-gray-50 transition-colors">' +
      '<div class="flex items-start justify-between">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2 mb-1">' +
            '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">' +
              escapeHtml(entityLabel) +
            '</span>' +
            (item.connector_name
              ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">' + escapeHtml(item.connector_name) + '</span>'
              : '') +
          '</div>' +
          '<h4 class="text-sm font-medium text-gray-900 truncate">' + escapeHtml(title) + '</h4>' +
          '<p class="text-xs text-gray-500 mt-1">' + escapeHtml(subtitle) + '</p>' +
          '<p class="text-xs text-gray-400 mt-1">ID: ' + escapeHtml(item.external_id || '') + '</p>' +
        '</div>' +
        '<button onclick="linkConnectorData(\'' + escapeHtml(item.id) + '\')" ' +
          'class="ml-4 flex-shrink-0 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white lex-bg-accent hover:lex-bg-accent focus:outline-none focus:ring-2 focus:ring-offset-2 lex-ring-focus">' +
          '<svg class="-ml-0.5 mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>' +
          '</svg>' +
          'Link' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  // Link connector data item to the current matter
  async function linkConnectorData(connectorDataId) {
    try {
      await api.linkConnectorDataToMatter(currentManualConnectMatter, connectorDataId);
      Lex.Toast.success('Data linked successfully!');
      closeManualConnectModal();
      await refreshCurrentMatter();
    } catch (err) {
      console.error('[linkConnectorData] Error:', err);
      Lex.Toast.error(err.message || 'Failed to link data');
    }
  }

  // =========================================================================
  // Window globals for manual connect modal handlers
  // =========================================================================

  window.showManualConnectModal = showManualConnectModal;
  window.closeManualConnectModal = closeManualConnectModal;
  window.loadAvailableConnectors = loadAvailableConnectors;
  window.performManualConnectSearch = performManualConnectSearch;
  window.renderSearchResultCard = renderSearchResultCard;
  window.linkConnectorData = linkConnectorData;

  ['showManualConnectModal', 'closeManualConnectModal', 'loadAvailableConnectors',
   'performManualConnectSearch', 'renderSearchResultCard', 'linkConnectorData'].forEach(_trackGlobal);

  // =========================================================================
  // Full-screen Connected Data Modal
  // =========================================================================

  // Connected Data modal state
  var _cdModalMatter = null;
  var _cdModalSearchTimeout = null;
  var _cdModalWired = false;

  function _cdModalBulkAction(action, items) {
    if (!_cdModalMatter || items.length === 0) return;
    var matterId = _cdModalMatter.matter_id;
    var promises = [];
    var skipped = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var id = item.id || '';

      if (action === 'link') {
        // Only link available connector data (skip contacts and already-linked)
        if (item.status === 'Linked' || item._linkType === 'contact' || id.indexOf('contact_') === 0) {
          skipped++;
          continue;
        }
        promises.push(api.linkConnectorDataToMatter(matterId, id));
      } else if (action === 'unlink') {
        // Only unlink linked connector data (skip contacts and available)
        if (item.status === 'Available' || item._linkType === 'contact' || id.indexOf('contact_') === 0) {
          skipped++;
          continue;
        }
        promises.push(api.unlinkConnectorDataFromMatter(matterId, id));
      }
    }

    if (promises.length === 0) {
      var msg = action === 'link'
        ? 'No available records selected to link.'
        : 'No linked records selected to unlink.';
      if (window.Lex && Lex.Toast) {
        Lex.Toast.warn(msg);
      }
      return;
    }

    Promise.all(promises).then(function () {
      var verb = action === 'link' ? 'linked' : 'unlinked';
      var successMsg = promises.length + ' record' + (promises.length > 1 ? 's' : '') + ' ' + verb + ' successfully.';
      if (skipped > 0) {
        successMsg += ' (' + skipped + ' skipped)';
      }
      if (window.Lex && Lex.Toast) {
        Lex.Toast.success(successMsg);
      }
      // Refresh the table and dock panel
      _cdModalSearch();
      if (_cdModalMatter) {
        renderUnifiedConnectedDataDock(_cdModalMatter);
      }
    }).catch(function (err) {
      console.error('[ConnectedDataModal] Bulk ' + action + ' error:', err);
      if (window.Lex && Lex.Toast) {
        Lex.Toast.error('Failed to ' + action + ' some records. Please try again.');
      }
      _cdModalSearch();
    });
  }

  function openConnectedDataModal(matter) {
    var modal = document.getElementById('connectedDataFullModal');
    if (!modal) return;
    _cdModalMatter = matter;
    modal.heading = 'Connected Data \u2014 ' + (matter.matter_name || matter.name || '');
    modal.open = true;

    // Defer DOM queries until modal content + lex-table are upgraded
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var table = document.getElementById('cdModalTable');
      var searchInput = document.getElementById('cdModalSearch');
      var entityTypeSelect = document.getElementById('cdModalEntityType');
      var connectorSelect = document.getElementById('cdModalConnector');

      // Reset filters
      if (searchInput) searchInput.value = '';
      if (entityTypeSelect) entityTypeSelect.value = '';
      if (connectorSelect) connectorSelect.value = '';

      // Set table columns and bulk actions
      if (table) {
        table.setAttribute('columns', 'source,type,name,detail,status');
        table.setAttribute('labels', 'Source,Type,Name,Detail,Status');
        table.setAttribute('empty-text', 'No data available. Connect an integration to sync data.');
        table.bulkActions = [
          { label: 'Link Selected', action: 'link', variant: 'primary', icon: 'link' },
          { label: 'Unlink Selected', action: 'unlink', variant: 'danger', icon: 'unlink' }
        ];
      }

      // Populate connector dropdown from all available connector data
      api.searchConnectorDataForLinking(_cdModalMatter.matter_id, { limit: 100 }).then(function (response) {
        var results = response.results || [];
        var cs = document.getElementById('cdModalConnector');
        if (cs && results.length > 0) {
          var seen = {};
          var connOpts = [{ value: '', label: 'All Connectors' }];
          for (var si = 0; si < results.length; si++) {
            var cid = results[si].connector_id;
            if (cid && !seen[cid]) {
              seen[cid] = true;
              connOpts.push({
                value: cid,
                label: results[si].connector_name || cid
              });
            }
          }
          cs.options = connOpts;
        }
      }).catch(function () {});

      // Wire events only once (modal DOM persists between opens)
      if (!_cdModalWired) {
        _cdModalWired = true;

        if (searchInput) {
          searchInput.addEventListener('lex-input', function () {
            clearTimeout(_cdModalSearchTimeout);
            _cdModalSearchTimeout = setTimeout(_cdModalSearch, 300);
          });
        }
        if (entityTypeSelect) {
          entityTypeSelect.addEventListener('lex-change', function () { _cdModalSearch(); });
        }
        if (connectorSelect) {
          connectorSelect.addEventListener('lex-change', function () { _cdModalSearch(); });
        }

        // Bulk link/unlink actions
        if (table) {
          table.addEventListener('bulk-action', function (e) {
            if (!e.detail || !_cdModalMatter) return;
            var action = e.detail.action;
            var items = e.detail.items || [];
            if (items.length === 0) return;
            _cdModalBulkAction(action, items);
          });
        }
      }

      // Load all available data on open
      _cdModalSearch();
    }); });
  }

  function _cdModalSearch() {
    var table = document.getElementById('cdModalTable');
    if (!table) return;
    if (typeof table.setData !== 'function') {
      setTimeout(_cdModalSearch, 100);
      return;
    }
    if (!_cdModalMatter) return;

    var searchInput = document.getElementById('cdModalSearch');
    var entityTypeSelect = document.getElementById('cdModalEntityType');
    var connectorSelect = document.getElementById('cdModalConnector');

    var search = searchInput ? (searchInput.value || '').trim() : '';
    var entityType = entityTypeSelect ? (entityTypeSelect.value || '') : '';
    var connectorId = connectorSelect ? (connectorSelect.value || '') : '';
    var searchLower = search.toLowerCase();

    // Fetch both linked and available data in parallel
    var linkedPromise = api.getMatterConnectorData(_cdModalMatter.matter_id).catch(function () { return { data: {} }; });
    var availablePromise = api.searchConnectorDataForLinking(_cdModalMatter.matter_id, {
      search: search, entity_type: entityType, connector_id: connectorId, limit: 100
    }).catch(function () { return { results: [] }; });

    Promise.all([linkedPromise, availablePromise]).then(function (responses) {
      var linkedResponse = responses[0];
      var availableResponse = responses[1];
      var rows = [];

      // 1) Add contacts (already linked to matter)
      var contacts = (currentMatterData && currentMatterData.contacts) || _cdModalMatter.contacts || [];
      if (!entityType || entityType === 'contact') {
        for (var ci = 0; ci < contacts.length; ci++) {
          var c = contacts[ci];
          var fullName = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || c.display_name || 'Unknown';
          if (searchLower) {
            var haystack = (fullName + ' ' + (c.email || '') + ' ' + (c.phone || '')).toLowerCase();
            if (haystack.indexOf(searchLower) === -1) continue;
          }
          rows.push({
            id: 'contact_' + (c.id || ci),
            source: 'LANA',
            type: 'Contact',
            name: fullName,
            detail: c.email || c.phone || '--',
            status: 'Linked',
            _linkType: 'contact'
          });
        }
      }

      // 2) Add linked connector data records
      var linkedGroups = linkedResponse.data || {};
      var linkedIds = {};
      var groupKeys = Object.keys(linkedGroups);
      for (var gi = 0; gi < groupKeys.length; gi++) {
        var records = linkedGroups[groupKeys[gi]];
        if (!Array.isArray(records)) continue;
        for (var li = 0; li < records.length; li++) {
          var lr = records[li];
          var lrEntityLabel = lr.entity_type ? lr.entity_type.split('_').join(' ') : 'Unknown';
          var lrData = lr.data || {};
          var lrName = lrData.name || lrData.title || lr.external_id || '';
          var lrDetail = lrData.description || lrData.email || lrData.status || lr.external_id || '';

          // Apply client-side filters for linked records
          if (entityType && lr.entity_type !== entityType) continue;
          if (connectorId && lr.connector_id !== connectorId) continue;
          if (searchLower) {
            var lrHaystack = (lrName + ' ' + lrDetail + ' ' + (lr.connector_name || '')).toLowerCase();
            if (lrHaystack.indexOf(searchLower) === -1) continue;
          }

          linkedIds[lr.id] = true;
          rows.push({
            id: lr.id || '',
            source: lr.connector_name || lr.connector_id || '',
            type: lrEntityLabel,
            name: lrName,
            detail: lrDetail,
            status: 'Linked',
            _linkType: 'connector'
          });
        }
      }

      // 3) Add available (unlinked) connector data records
      var availableResults = availableResponse.results || [];
      for (var ri = 0; ri < availableResults.length; ri++) {
        var r = availableResults[ri];
        if (linkedIds[r.id]) continue; // skip duplicates
        var entityLabel = r.entity_type ? r.entity_type.split('_').join(' ') : 'Unknown';
        var data = r.data || {};
        var recordName = data.name || data.title || r.external_id || '';
        var detail = data.description || data.email || data.status || r.external_id || '';

        rows.push({
          id: r.id || '',
          source: r.connector_name || r.connector_id || '',
          type: entityLabel,
          name: recordName,
          detail: detail,
          status: 'Available',
          _linkType: 'connector'
        });
      }

      table.setData(rows);
    }).catch(function (err) {
      console.error('[ConnectedDataModal] Search error:', err);
      table.setData([]);
    });
  }

  window.openConnectedDataModal = openConnectedDataModal;
  ['openConnectedDataModal'].forEach(_trackGlobal);

  // =========================================================================
  // Custom Fields Modal (adapted from workspace.js lines 9942-10385)
  // =========================================================================

  /**
   * Open the edit custom fields modal for a matter.
   * Loads matter data, populates state, renders modal.
   * @param {string} matterId - The matter ID
   */
  async function openEditCustomFieldsModal(matterId) {
    if (!matterId || matterId === 'null' || matterId === 'undefined') {
      console.error('[openEditCustomFieldsModal] Invalid matter ID:', matterId);
      Lex.Toast.error('Cannot open custom fields: Invalid matter ID');
      return;
    }

    currentEditFieldsMatter = matterId;

    var matter = window.currentViewedMatter;

    if (!matter || matter.matter_id !== matterId) {
      try {
        var result = await api.getMatter(matterId, { bustCache: true });

        if (result && result.error) {
          console.error('[openEditCustomFieldsModal] API error:', result.error);
          Lex.Toast.error(result.error.message || 'Failed to load matter details');
          return;
        }

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

    if (matter && matter.metadata && matter.metadata.custom_field_definitions && Array.isArray(matter.metadata.custom_field_definitions)) {
      customFieldDefinitions = JSON.parse(JSON.stringify(matter.metadata.custom_field_definitions));
    }

    if (matter && matter.metadata && matter.metadata.custom_fields && Array.isArray(matter.metadata.custom_fields)) {
      customFieldValues = JSON.parse(JSON.stringify(matter.metadata.custom_fields));
    }

    // Initialize values for fields that do not have them yet
    customFieldDefinitions.forEach(function (def) {
      var hasValue = customFieldValues.some(function (v) { return v.key === def.key; });
      if (!hasValue) {
        customFieldValues.push({ key: def.key, value: def.default_value || '' });
      }
    });

    renderCustomFieldsModal();

    var modal = document.getElementById('editCustomFieldsModal');
    if (modal) {
      modal.open = true;
    }
  }

  /**
   * Close the edit custom fields modal and reset state.
   */
  function closeEditCustomFieldsModal() {
    var modal = document.getElementById('editCustomFieldsModal');
    if (modal) {
      modal.open = false;
    }
    currentEditFieldsMatter = null;
    customFieldDefinitions = [];
    customFieldValues = [];
  }

  /**
   * Render the custom fields modal content.
   * Builds HTML for each field definition and its current value input.
   */
  function renderCustomFieldsModal() {
    var container = document.getElementById('customFieldsContainer');
    if (!container) return;

    if (customFieldDefinitions.length === 0) {
      container.innerHTML =
        '<div class="text-center py-8 text-gray-500">' +
          '<svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>' +
          '</svg>' +
          '<p class="mt-2 text-sm">No custom fields yet. Click "Add Field" to create one.</p>' +
        '</div>';
      return;
    }

    var html = '<div class="space-y-4">';

    for (var i = 0; i < customFieldDefinitions.length; i++) {
      var def = customFieldDefinitions[i];
      var valueObj = null;
      for (var j = 0; j < customFieldValues.length; j++) {
        if (customFieldValues[j].key === def.key) { valueObj = customFieldValues[j]; break; }
      }
      var currentValue = valueObj ? valueObj.value : (def.default_value || '');

      var selectTypeHtml =
        '<option value="text"' + (def.type === 'text' ? ' selected' : '') + '>Text</option>' +
        '<option value="textarea"' + (def.type === 'textarea' ? ' selected' : '') + '>Long Text</option>' +
        '<option value="number"' + (def.type === 'number' ? ' selected' : '') + '>Number</option>' +
        '<option value="currency"' + (def.type === 'currency' ? ' selected' : '') + '>Currency</option>' +
        '<option value="date"' + (def.type === 'date' ? ' selected' : '') + '>Date</option>' +
        '<option value="datetime"' + (def.type === 'datetime' ? ' selected' : '') + '>Date+Time</option>' +
        '<option value="boolean"' + (def.type === 'boolean' ? ' selected' : '') + '>Yes/No</option>' +
        '<option value="select"' + (def.type === 'select' ? ' selected' : '') + '>Dropdown</option>';

      var optionsRowHtml = '';
      if (def.type === 'select') {
        var optionsJoined = (def.options || []).join(', ');
        optionsRowHtml =
          '<div class="mb-3">' +
            '<label class="block text-xs font-medium text-gray-700 mb-1">Dropdown Options (comma-separated)</label>' +
            '<input type="text" value="' + escapeHtml(optionsJoined) + '"' +
              ' onchange="updateFieldDefinition(' + i + ', \'options\', this.value.split(\',\').map(function(s){return s.trim();}).filter(function(s){return s;}))"' +
              ' placeholder="e.g., Active, Pending, Closed"' +
              ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />' +
          '</div>';
      }

      html +=
        '<div class="p-4 bg-gray-50 rounded-lg border border-gray-200">' +
          '<div class="grid grid-cols-12 gap-3 mb-3">' +
            '<div class="col-span-3">' +
              '<label class="block text-xs font-medium text-gray-700 mb-1">Field Key</label>' +
              '<input type="text" value="' + escapeHtml(def.key || '') + '"' +
                ' onchange="updateFieldDefinition(' + i + ', \'key\', this.value)"' +
                ' placeholder="e.g., case_number"' +
                ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />' +
            '</div>' +
            '<div class="col-span-4">' +
              '<label class="block text-xs font-medium text-gray-700 mb-1">Display Name</label>' +
              '<input type="text" value="' + escapeHtml(def.display_name || '') + '"' +
                ' onchange="updateFieldDefinition(' + i + ', \'display_name\', this.value)"' +
                ' placeholder="e.g., Case Number"' +
                ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />' +
            '</div>' +
            '<div class="col-span-2">' +
              '<label class="block text-xs font-medium text-gray-700 mb-1">Type</label>' +
              '<select onchange="updateFieldDefinition(' + i + ', \'type\', this.value)"' +
                ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus">' +
                selectTypeHtml +
              '</select>' +
            '</div>' +
            '<div class="col-span-2">' +
              '<label class="block text-xs font-medium text-gray-700 mb-1">Required</label>' +
              '<label class="flex items-center px-3 py-2">' +
                '<input type="checkbox"' + (def.required ? ' checked' : '') +
                  ' onchange="updateFieldDefinition(' + i + ', \'required\', this.checked)"' +
                  ' class="rounded border-gray-300 lex-text-accent lex-ring-focus" />' +
                '<span class="ml-2 text-sm text-gray-700">Yes</span>' +
              '</label>' +
            '</div>' +
            '<div class="col-span-1 flex items-end">' +
              '<button onclick="removeCustomField(' + i + ')"' +
                ' class="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 rounded-md transition-colors" title="Remove field">' +
                '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          optionsRowHtml +
          '<div>' +
            '<label class="block text-xs font-medium text-gray-700 mb-1">Value</label>' +
            renderValueInput(def, currentValue, i) +
          '</div>' +
        '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  /**
   * Render the appropriate value input element for a custom field type.
   * @param {Object} def - Field definition
   * @param {*} currentValue - Current field value
   * @param {number} index - Field index (unused, kept for API parity)
   * @returns {string} HTML string for the input element
   */
  function renderValueInput(def, currentValue, index) {
    var key = escapeHtml(def.key || '');
    var displayName = escapeHtml(def.display_name || def.key || '');

    switch (def.type) {
      case 'textarea':
        return '<textarea onchange="updateFieldValue(\'' + key + '\', this.value)"' +
          ' placeholder="Enter ' + displayName + '" rows="3"' +
          ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus">' +
          escapeHtml(currentValue || '') + '</textarea>';

      case 'number':
        return '<input type="number" value="' + escapeHtml(currentValue || '') + '"' +
          ' onchange="updateFieldValue(\'' + key + '\', this.value)"' +
          ' placeholder="Enter ' + displayName + '"' +
          ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />';

      case 'currency':
        return '<div class="relative">' +
          '<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">' +
            '<span class="text-gray-500 sm:text-sm">$</span>' +
          '</div>' +
          '<input type="number" step="0.01" value="' + escapeHtml(currentValue || '') + '"' +
            ' onchange="updateFieldValue(\'' + key + '\', this.value)"' +
            ' placeholder="0.00"' +
            ' class="w-full pl-7 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />' +
        '</div>';

      case 'date':
        return '<input type="date" value="' + escapeHtml(currentValue || '') + '"' +
          ' onchange="updateFieldValue(\'' + key + '\', this.value)"' +
          ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />';

      case 'datetime':
        return '<input type="datetime-local" value="' + escapeHtml(currentValue || '') + '"' +
          ' onchange="updateFieldValue(\'' + key + '\', this.value)"' +
          ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />';

      case 'boolean':
        return '<label class="flex items-center px-3 py-2">' +
          '<input type="checkbox"' + (currentValue === true || currentValue === 'true' ? ' checked' : '') +
            ' onchange="updateFieldValue(\'' + key + '\', this.checked)"' +
            ' class="rounded border-gray-300 lex-text-accent lex-ring-focus" />' +
          '<span class="ml-2 text-sm text-gray-700">' + displayName + '</span>' +
        '</label>';

      case 'select':
        var optionsHtml = '<option value="">-- Select ' + displayName + ' --</option>';
        var opts = def.options || [];
        for (var o = 0; o < opts.length; o++) {
          var optVal = escapeHtml(opts[o]);
          optionsHtml += '<option value="' + optVal + '"' + (currentValue === opts[o] ? ' selected' : '') + '>' + optVal + '</option>';
        }
        return '<select onchange="updateFieldValue(\'' + key + '\', this.value)"' +
          ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus">' +
          optionsHtml + '</select>';

      case 'text':
      default:
        return '<input type="text" value="' + escapeHtml(currentValue || '') + '"' +
          ' onchange="updateFieldValue(\'' + key + '\', this.value)"' +
          ' placeholder="Enter ' + displayName + '"' +
          ' class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 lex-ring-focus lex-border-focus" />';
    }
  }

  /**
   * Add a new blank custom field definition.
   */
  function addCustomField() {
    var newKey = 'field_' + Date.now();
    customFieldDefinitions.push({
      key: newKey,
      display_name: '',
      type: 'text',
      required: false,
      options: [],
      default_value: ''
    });
    customFieldValues.push({ key: newKey, value: '' });
    renderCustomFieldsModal();
  }

  /**
   * Update a property on a specific field definition.
   * Re-renders the modal if the type changes.
   * @param {number} index - Definition index
   * @param {string} property - Property to update
   * @param {*} value - New value
   */
  function updateFieldDefinition(index, property, value) {
    if (customFieldDefinitions[index]) {
      var oldKey = customFieldDefinitions[index].key;
      customFieldDefinitions[index][property] = value;

      // If key changed, sync the corresponding value entry
      if (property === 'key' && oldKey !== value) {
        for (var i = 0; i < customFieldValues.length; i++) {
          if (customFieldValues[i].key === oldKey) {
            customFieldValues[i].key = value;
            break;
          }
        }
      }

      // Re-render when type changes so the value input updates
      if (property === 'type') {
        renderCustomFieldsModal();
      }
    }
  }

  /**
   * Update the value for a custom field by key.
   * @param {string} key - Field key
   * @param {*} value - New value
   */
  function updateFieldValue(key, value) {
    var found = false;
    for (var i = 0; i < customFieldValues.length; i++) {
      if (customFieldValues[i].key === key) {
        customFieldValues[i].value = value;
        found = true;
        break;
      }
    }
    if (!found) {
      customFieldValues.push({ key: key, value: value });
    }
  }

  /**
   * Remove a custom field definition and its associated value.
   * @param {number} index - Definition index to remove
   */
  function removeCustomField(index) {
    if (customFieldDefinitions[index]) {
      var key = customFieldDefinitions[index].key;
      customFieldDefinitions.splice(index, 1);

      for (var i = 0; i < customFieldValues.length; i++) {
        if (customFieldValues[i].key === key) {
          customFieldValues.splice(i, 1);
          break;
        }
      }

      renderCustomFieldsModal();
    }
  }

  /**
   * Save custom fields to the API, then refresh the dock custom fields section.
   */
  async function saveCustomFields() {
    try {
      var validDefinitions = customFieldDefinitions.filter(function (def) {
        return def.key && def.key.trim() !== '' && def.display_name && def.display_name.trim() !== '';
      });

      if (validDefinitions.length === 0 && customFieldDefinitions.length > 0) {
        Lex.Toast.error('Please fill in Key and Display Name for all fields');
        return;
      }

      // Check for duplicate keys — NO regex, use string compare
      var keys = validDefinitions.map(function (f) { return f.key.toLowerCase().trim(); });
      var duplicates = keys.filter(function (k, idx) { return keys.indexOf(k) !== idx; });
      if (duplicates.length > 0) {
        Lex.Toast.error('Duplicate field keys: ' + duplicates.join(', '));
        return;
      }

      var definitionKeys = validDefinitions.map(function (d) { return d.key; });
      var validValues = customFieldValues.filter(function (v) {
        return definitionKeys.indexOf(v.key) !== -1;
      });

      if (!currentEditFieldsMatter) {
        Lex.Toast.error('Matter ID not found');
        return;
      }

      var matterId = currentEditFieldsMatter;

      await api.put('/api/v1/matters/' + matterId + '/settings', {
        custom_field_definitions: validDefinitions,
        custom_fields: validValues
      });

      Lex.Toast.success('Custom fields updated successfully!');
      closeEditCustomFieldsModal();

      var updatedMatter = await api.getMatter(matterId, { bustCache: true });
      if (updatedMatter && updatedMatter.matter) {
        window.currentViewedMatter = updatedMatter.matter;
        renderCustomFieldsSection(updatedMatter.matter);

        // Refresh activity feed
        var activityResult = await api.getMatterActivity(matterId, 20, 0);
        if (activityResult && activityResult.activities && currentMatterData) {
          currentMatterData.activities = activityResult.activities;
          currentMatterData.activityPagination = activityResult.pagination;
          renderActivityTab(currentMatterData.matter, activityResult.activities, activityResult.pagination);
        }
      }
    } catch (error) {
      console.error('[saveCustomFields] Error:', error);
      Lex.Toast.error(error.message || 'Failed to save custom fields');
    }
  }

  // Window globals for custom fields modal
  window.openEditCustomFieldsModal = openEditCustomFieldsModal;
  window.closeEditCustomFieldsModal = closeEditCustomFieldsModal;
  window.renderCustomFieldsModal = renderCustomFieldsModal;
  window.addCustomField = addCustomField;
  window.updateFieldDefinition = updateFieldDefinition;
  window.updateFieldValue = updateFieldValue;
  window.removeCustomField = removeCustomField;
  window.saveCustomFields = saveCustomFields;

  ['openEditCustomFieldsModal', 'closeEditCustomFieldsModal', 'renderCustomFieldsModal',
   'addCustomField', 'updateFieldDefinition', 'updateFieldValue',
   'removeCustomField', 'saveCustomFields'].forEach(_trackGlobal);

  // =========================================================================
  // Custom Fields Section — dock panel rendering
  // (adapted from workspace.js lines 1667-1794)
  // =========================================================================

  /**
   * Render the custom fields section inside the dock details panel.
   * Reads definitions and values from matter.metadata and builds the
   * collapsible section with an edit button.
   * @param {Object} matter - The current matter object
   */
  async function renderCustomFieldsSection(matter) {
    var container = document.getElementById('customFieldsSection');
    if (!container) return;

    if (!matter || !matter.matter_id) {
      console.error('[renderCustomFieldsSection] Invalid matter object:', matter);
      container.innerHTML = '<div class="bg-yellow-50 rounded-lg p-4 mt-6"><p class="text-sm text-yellow-700">Cannot display custom fields: Invalid matter data</p></div>';
      return;
    }

    var customFieldDefs = (matter.metadata && matter.metadata.custom_field_definitions) || [];
    var customFieldVals = (matter.metadata && matter.metadata.custom_fields) || [];

    // Build lookup maps
    var defsMap = {};
    customFieldDefs.forEach(function (def) { defsMap[def.key] = def; });

    var valuesMap = {};
    customFieldVals.forEach(function (field) { valuesMap[field.key] = field.value; });

    function isValidValue(value) {
      if (value === null || value === undefined || value === '') return false;
      if (typeof value === 'object') {
        if (Array.isArray(value)) return value.length > 0;
        return Object.keys(value).length > 0;
      }
      return true;
    }

    var fieldsToDisplay = [];

    customFieldDefs.forEach(function (def) {
      var value = valuesMap[def.key];
      if (isValidValue(value)) {
        fieldsToDisplay.push({
          key: def.key,
          displayName: def.display_name || def.key,
          value: value,
          type: def.type
        });
      }
    });

    // Legacy shadow_table data
    if (matter.shadow_table && typeof matter.shadow_table === 'object') {
      Object.keys(matter.shadow_table).forEach(function (key) {
        if (isValidValue(matter.shadow_table[key]) && !valuesMap[key]) {
          fieldsToDisplay.push({
            key: key,
            displayName: defsMap[key] ? (defsMap[key].display_name || formatFieldName(key)) : formatFieldName(key),
            value: matter.shadow_table[key],
            type: defsMap[key] ? (defsMap[key].type || 'text') : 'text'
          });
        }
      });
    }

    // Store for drawer use
    currentMatterData._customFields = fieldsToDisplay;

    container.style.display = 'block';

    var cfActions = JSON.stringify([{icon:'edit',label:'Edit'}]).split('"').join('&quot;');
    var html = '<lex-card id="customFieldsCard" heading="Custom Fields" variant="flat" padding="compact" actions=\'' + cfActions + '\'>';

    if (fieldsToDisplay.length === 0) {
      html += '<p class="text-sm text-gray-500">No custom fields yet</p>';
    } else {
      html += '<dl class="space-y-2 text-sm">';
      var showCount = Math.min(fieldsToDisplay.length, 6);
      for (var fi = 0; fi < showCount; fi++) {
        html += buildCustomFieldRow(fieldsToDisplay[fi]);
      }
      html += '</dl>';
      if (fieldsToDisplay.length > 6) {
        html += '<button onclick="openCustomFieldsDrawer()" class="mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer lex-bg-neutral lex-text-neutral transition-all hover:shadow-sm">+' + (fieldsToDisplay.length - 6) + ' more</button>';
      }
    }
    html += '</lex-card>';

    container.innerHTML = html;

    // Wire edit action directly on the card
    var cfCard = document.getElementById('customFieldsCard');
    if (cfCard) {
      cfCard.addEventListener('card-action', function (e) {
        if (e.detail && e.detail.action === 'edit' && matter && matter.matter_id) {
          openEditCustomFieldsModal(matter.matter_id);
        }
      });
    }
  }

  function buildCustomFieldRow(field) {
    var displayValue;
    if (field.type === 'currency' && field.value !== null && field.value !== undefined && field.value !== '') {
      var numVal = parseFloat(field.value);
      if (!isNaN(numVal)) {
        displayValue = '$' + numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else {
        displayValue = formatFieldValue(field.value);
      }
    } else {
      displayValue = formatFieldValue(field.value);
    }
    return '<div class="flex justify-between">' +
      '<dt class="text-gray-500">' + escapeHtml(field.displayName) + '</dt>' +
      '<dd class="text-gray-900 text-right max-w-[180px] truncate" title="' + escapeHtml(String(field.value)) + '">' + displayValue + '</dd>' +
    '</div>';
  }

  function openCustomFieldsDrawer() {
    if (!currentMatterData) return;
    var fields = currentMatterData._customFields || [];

    var modal = document.getElementById('customFieldsDrawer');
    if (!modal) return;

    var listEl = document.getElementById('customFieldsDrawerList');
    if (!listEl) return;

    var html = '';
    if (fields.length === 0) {
      html = '<p class="text-sm text-gray-500 text-center py-4">No custom fields.</p>';
    } else {
      html = '<dl class="space-y-3 text-sm">';
      for (var i = 0; i < fields.length; i++) {
        html += buildCustomFieldRow(fields[i]);
      }
      html += '</dl>';
    }

    listEl.innerHTML = html;
    modal.open = true;
  }

  window.renderCustomFieldsSection = renderCustomFieldsSection;
  window.openCustomFieldsDrawer = openCustomFieldsDrawer;
  _trackGlobal('renderCustomFieldsSection');
  _trackGlobal('openCustomFieldsDrawer');

  // =========================================================================
  // Matter Profile Section — dock context panel rendering
  // (adapted from workspace.js lines 1797-2095)
  // =========================================================================

  /**
   * Render the matter profile / intelligence section in the dock context panel.
   * Fetches the profile from the API and displays themes, brand voice, etc.
   * Falls back gracefully if profile is unavailable.
   * @param {Object} matter - The current matter object
   */
  async function renderMatterProfileSection(matter) {
    var container = document.getElementById('matterProfileSection');
    var notificationContainer = document.getElementById('matterProfileNotification');
    if (!container) return;

    try {
      var profile = null;

      try {
        var response = await api.get('/api/v1/matters/' + matter.matter_id + '/profile');
        profile = response && response.profile ? response.profile : null;
      } catch (apiError) {
        // 404 = profile does not exist yet — trigger lazy initialization
        if (apiError.status === 404 || apiError.errorCode === 'NOT_FOUND') {
          // Profile not found — trigger lazy initialization

          try {
            await api.post('/api/v1/matters/' + matter.matter_id + '/profile/initialize');

            if (notificationContainer) {
              var userName = (window.currentUser && window.currentUser.name)
                ? window.currentUser.name.split(' ')[0]
                : 'there';
              notificationContainer.innerHTML =
                '<div class="bg-gradient-to-r lex-bg-accent-muted border lex-border rounded-lg p-5">' +
                  '<div class="flex items-start gap-4">' +
                    '<div class="flex-shrink-0">' +
                      '<div class="w-10 h-10 bg-gradient-to-br lex-bg-accent rounded-full flex items-center justify-center shadow-sm">' +
                        '<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>' +
                        '</svg>' +
                      '</div>' +
                    '</div>' +
                    '<div class="flex-1">' +
                      '<p class="text-sm font-medium lex-text-primary mb-1">Hey ' + escapeHtml(userName) + '!</p>' +
                      '<p class="text-sm lex-text-accent leading-relaxed">I\'m running an analysis on this matter to generate a profile. This helps me understand the context, key entities, and themes so I can assist you better. I\'ll be done soon!</p>' +
                    '</div>' +
                  '</div>' +
                '</div>';
            }

            container.innerHTML = '';
          } catch (initError) {
            console.error('[renderMatterProfileSection] Failed to initialize profile', initError);
            if (notificationContainer) notificationContainer.innerHTML = '';
            container.innerHTML = '';
          }
          return;
        }

        // Other errors — fall back to matter object
        // Profile API error — fall back to matter object
        profile = matter.profile || matter.matter_profile || null;
      }

      // Check for meaningful content
      var brandVoiceItems = (profile && profile.brand_voice && typeof profile.brand_voice === 'object')
        ? Object.entries(profile.brand_voice).slice(0, 3)
        : [];

      var themes = (profile && Array.isArray(profile.document_themes))
        ? profile.document_themes.slice(0, 5)
        : [];

      var hasContent = brandVoiceItems.length > 0 || themes.length > 0;

      // Build card body
      var cardBody = '';

      if (!profile) {
        // No profile yet
        cardBody =
          '<div class="flex items-center gap-3">' +
            '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background: var(--lex-bg-tertiary)">' +
              '<svg class="w-5 h-5" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>' +
              '</svg>' +
            '</div>' +
            '<div>' +
              '<p class="text-sm" style="color: var(--lex-text-secondary)">Analyze this matter\'s documents and data to generate insights, key entities, and themes.</p>' +
            '</div>' +
          '</div>' +
          '<div class="mt-3">' +
            '<lex-btn onclick="generateMatterIntelligence(\'' + matter.matter_id + '\')" variant="primary" size="sm" leading-icon="zap">Generate</lex-btn>' +
          '</div>';
      } else if (!hasContent) {
        // Profile exists but empty
        cardBody =
          '<div class="flex items-center gap-3">' +
            '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background: var(--lex-bg-tertiary)">' +
              '<svg class="w-5 h-5" style="color: var(--lex-text-accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>' +
              '</svg>' +
            '</div>' +
            '<div>' +
              '<p class="text-sm" style="color: var(--lex-text-secondary)">Not enough data to generate insights yet. Add documents or notes, then regenerate.</p>' +
            '</div>' +
          '</div>' +
          '<div class="mt-3">' +
            '<lex-btn onclick="generateMatterIntelligence(\'' + matter.matter_id + '\')" variant="primary" size="sm" leading-icon="refresh">Regenerate</lex-btn>' +
          '</div>';
      } else {
        // Has content — render brand voice + themes
        if (brandVoiceItems.length > 0) {
          cardBody +=
            '<div class="mb-4">' +
              '<h6 class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: var(--lex-text-tertiary)">Brand Voice</h6>' +
              '<div class="space-y-1.5">';
          brandVoiceItems.forEach(function (entry) {
            cardBody +=
              '<div class="flex items-start text-sm">' +
                '<span class="font-medium min-w-[80px]" style="color: var(--lex-text-secondary)">' + escapeHtml(formatFieldName(entry[0])) + ':</span>' +
                '<span class="ml-2" style="color: var(--lex-text-primary)">' + escapeHtml(String(entry[1])) + '</span>' +
              '</div>';
          });
          cardBody += '</div></div>';
        }

        if (themes.length > 0) {
          cardBody +=
            '<div>' +
              '<h6 class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: var(--lex-text-tertiary)">Document Themes</h6>' +
              '<div class="flex flex-wrap gap-2">';
          themes.forEach(function (theme) {
            cardBody +=
              '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style="background: var(--lex-bg-accent-muted); color: var(--lex-text-accent)">' +
                escapeHtml(String(theme)) +
              '</span>';
          });
          cardBody += '</div></div>';
        }
      }

      // Wrap everything in a single lex-card
      var refreshAction = hasContent
        ? JSON.stringify([{icon:'refresh',label:'Regenerate'}]).split('"').join('&quot;')
        : '';
      var actionsAttr = refreshAction ? ' actions=\'' + refreshAction + '\'' : '';

      container.innerHTML =
        '<lex-card id="matterProfileCard" heading="Matter Intelligence" variant="outlined" padding="compact"' + actionsAttr + '>' +
          cardBody +
        '</lex-card>';

      // Wire refresh action
      if (hasContent) {
        var mpCard = document.getElementById('matterProfileCard');
        if (mpCard) {
          mpCard.addEventListener('card-action', function (e) {
            if (e.detail && e.detail.action === 'refresh' && matter && matter.matter_id) {
              generateMatterIntelligence(matter.matter_id);
            }
          });
        }
      }

    } catch (error) {
      console.error('[renderMatterProfileSection] Error fetching profile:', error);
      container.innerHTML = '';
    }
  }

  /**
   * Trigger matter profile intelligence generation via the API.
   * Shows loading state, posts to initialize endpoint, then shows notification.
   * @param {string} matterId - The matter ID
   */
  async function generateMatterIntelligence(matterId) {
    var container = document.getElementById('matterProfileSection');
    var notificationContainer = document.getElementById('matterProfileNotification');

    try {
      if (container) {
        container.innerHTML =
          '<div class="bg-gradient-to-r lex-bg-accent-muted border lex-border rounded-lg p-5">' +
            '<div class="flex items-center gap-3">' +
              '<div class="animate-spin rounded-full h-8 w-8 border-3 lex-border border-t-stone-600 flex-shrink-0"></div>' +
              '<div>' +
                '<h5 class="text-sm font-semibold lex-text-primary">Generating Matter Intelligence...</h5>' +
                '<p class="text-xs lex-text-accent mt-0.5">Analyzing documents, notes, and matter data. This may take a moment.</p>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      await api.post('/api/v1/matters/' + matterId + '/profile/initialize');

      if (notificationContainer) {
        var userName = (window.currentUser && window.currentUser.name)
          ? window.currentUser.name.split(' ')[0]
          : 'there';
        notificationContainer.innerHTML =
          '<div class="bg-gradient-to-r lex-bg-accent-muted border lex-border rounded-lg p-5 mb-4">' +
            '<div class="flex items-start gap-4">' +
              '<div class="flex-shrink-0">' +
                '<div class="w-10 h-10 bg-gradient-to-br lex-bg-accent rounded-full flex items-center justify-center shadow-sm">' +
                  '<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>' +
                  '</svg>' +
                '</div>' +
              '</div>' +
              '<div class="flex-1">' +
                '<p class="text-sm font-medium lex-text-primary mb-1">Analysis Started</p>' +
                '<p class="text-sm lex-text-accent leading-relaxed">I\'m running an analysis on this matter to generate a profile. This helps me understand the context, key entities, and themes so I can assist you better. I\'ll be done soon!</p>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      if (container) container.innerHTML = '';

      Lex.Toast.success('Matter intelligence generation started');

    } catch (error) {
      console.error('[generateMatterIntelligence] Failed:', error);

      if (container) {
        container.innerHTML =
          '<div class="bg-gradient-to-r from-gray-50 to-red-50 border border-red-200 rounded-lg p-5">' +
            '<div class="flex items-center justify-between">' +
              '<div class="flex items-start gap-3">' +
                '<div class="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">' +
                  '<svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
                  '</svg>' +
                '</div>' +
                '<div>' +
                  '<h5 class="text-sm font-semibold text-gray-900">Generation Failed</h5>' +
                  '<p class="text-xs text-gray-500 mt-0.5">Could not generate matter intelligence. Please try again.</p>' +
                '</div>' +
              '</div>' +
              '<button onclick="generateMatterIntelligence(\'' + matterId + '\')"' +
                ' class="inline-flex items-center gap-1.5 px-4 py-2 lex-bg-accent hover:lex-bg-accent text-white text-sm rounded-lg font-medium transition-colors shadow-sm flex-shrink-0 ml-4">' +
                '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>' +
                '</svg>' +
                'Retry' +
              '</button>' +
            '</div>' +
          '</div>';
      }

      Lex.Toast.error('Failed to generate matter intelligence');
    }
  }

  window.renderMatterProfileSection = renderMatterProfileSection;
  window.generateMatterIntelligence = generateMatterIntelligence;
  ['renderMatterProfileSection', 'generateMatterIntelligence'].forEach(_trackGlobal);

  // =========================================================================
  // Document Viewer
  // (adapted from workspace.js lines 3594-3823)
  // =========================================================================

  /**
   * Download a stored document via authenticated fetch.
   * @param {string} fileId - Document record ID
   * @param {string} fileName - Download filename
   */
  async function downloadDocument(fileId, fileName) {
    var matterId = currentMatterData ? currentMatterData.matter_id : null;

    try {
      var response = await fetch(api.getFileDownloadUrl(fileId, matterId), {
        headers: { 'Authorization': 'Bearer ' + api.token }
      });

      if (!response.ok) {
        if (response.status === 401) {
          if (window.api && typeof window.api.showSessionExpiredModal === 'function') {
            window.api.showSessionExpiredModal();
          } else {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            Lex.Toast.error('Session expired. Redirecting to login...');
            trackTimeout(setTimeout(function () { window.location.href = 'login.html'; }, 1500));
          }
          throw new Error('Session expired');
        }
        throw new Error('Failed to download: ' + response.status);
      }

      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      Lex.Toast.success('Download started');
    } catch (error) {
      console.error('[downloadDocument] Download failed:', error);
      Lex.Toast.error(error.message || 'Failed to download file');
    }
  }

  /**
   * View an orphaned (untracked) document using its MinIO storage key.
   * @param {string} storageKey - MinIO storage key
   * @param {string} fileName - Display file name
   * @param {string} contentType - MIME type
   * @param {number} fileSize - File size in bytes
   */
  async function viewOrphanedDocument(storageKey, fileName, contentType, fileSize) {
    var matterId = currentMatterData ? currentMatterData.matter_id : null;

    var viewerModal = document.getElementById('documentViewerModal');
    var viewerLoading = document.getElementById('viewerLoading');
    var viewerError = document.getElementById('viewerError');
    var viewerIframe = document.getElementById('viewerIframe');
    var viewerText = document.getElementById('viewerText');
    var viewerTable = document.getElementById('viewerTable');
    var viewerImage = document.getElementById('viewerImage');
    var viewerDocx = document.getElementById('viewerDocx');

    if (!viewerModal) return;

    viewerModal.open = true;
    if (viewerLoading) viewerLoading.classList.remove('hidden');
    if (viewerError) viewerError.classList.add('hidden');
    if (viewerIframe) viewerIframe.classList.add('hidden');
    if (viewerText) viewerText.classList.add('hidden');
    if (viewerTable) viewerTable.classList.add('hidden');
    if (viewerImage) viewerImage.classList.add('hidden');
    if (viewerDocx) viewerDocx.classList.add('hidden');

    var fileNameEl = document.getElementById('viewerFileName');
    var fileInfoEl = document.getElementById('viewerFileInfo');
    var downloadBtn = document.getElementById('viewerDownloadBtn');
    var errorDownloadBtn = document.getElementById('viewerErrorDownload');

    if (fileNameEl) fileNameEl.textContent = fileName || '';
    if (fileInfoEl) fileInfoEl.textContent = (contentType || 'Unknown type') + ' - ' + formatSize(fileSize || 0);
    if (downloadBtn) downloadBtn.onclick = function () { downloadOrphanedDocument(storageKey, fileName); };
    if (errorDownloadBtn) errorDownloadBtn.onclick = function () { downloadOrphanedDocument(storageKey, fileName); };

    try {
      var url = api.baseUrl + '/api/v1/storage/download-by-key?storage_key=' + encodeURIComponent(storageKey) + '&matter_id=' + (matterId || '');
      var response = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + api.token }
      });

      if (!response.ok) {
        if (response.status === 401) {
          if (window.api && typeof window.api.showSessionExpiredModal === 'function') {
            window.api.showSessionExpiredModal();
          } else {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            Lex.Toast.error('Session expired. Redirecting to login...');
            trackTimeout(setTimeout(function () { window.location.href = 'login.html'; }, 1500));
          }
          throw new Error('Session expired');
        }
        throw new Error('Failed to load document: ' + response.status);
      }

      var blob = await response.blob();
      var objectUrl = URL.createObjectURL(blob);

      if (viewerLoading) viewerLoading.classList.add('hidden');

      var type = (contentType || '').toLowerCase();
      var lowerName = (fileName || '').toLowerCase();

      if (type.indexOf('image/') === 0) {
        if (viewerImage) { viewerImage.src = objectUrl; viewerImage.classList.remove('hidden'); }
      } else if (type === 'application/pdf') {
        if (viewerIframe) { viewerIframe.src = objectUrl; viewerIframe.classList.remove('hidden'); }
      } else if (type.indexOf('csv') !== -1 || lowerName.indexOf('.csv') !== -1) {
        var csvText = await blob.text();
        if (typeof renderCSVTable === 'function') renderCSVTable(csvText);
        if (viewerTable) viewerTable.classList.remove('hidden');
      } else if (
        type.indexOf('text/') === 0 ||
        type === 'application/json' ||
        type === 'application/xml' ||
        lowerName.indexOf('.txt') !== -1 ||
        lowerName.indexOf('.md') !== -1 ||
        lowerName.indexOf('.json') !== -1 ||
        lowerName.indexOf('.xml') !== -1 ||
        lowerName.indexOf('.log') !== -1
      ) {
        var textContent = await blob.text();
        if (viewerText) { viewerText.textContent = textContent; viewerText.classList.remove('hidden'); }
      } else if (lowerName.indexOf('.docx') !== -1 || type.indexOf('wordprocessingml') !== -1) {
        try {
          var arrayBuffer = await blob.arrayBuffer();
          if (typeof mammoth !== 'undefined') {
            var result = await mammoth.convertToHtml({
              arrayBuffer: arrayBuffer,
              convertImage: mammoth.images.imgElement(function (image) {
                return image.read('base64').then(function (imageBuffer) {
                  return { src: 'data:' + image.contentType + ';base64,' + imageBuffer };
                });
              }),
              styleMap: [
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Title'] => h1.document-title:fresh",
                "r[style-name='Strong'] => strong",
                "r[style-name='Emphasis'] => em",
                "table => table.docx-table"
              ]
            });
            if (viewerDocx) { viewerDocx.innerHTML = result.value; viewerDocx.classList.remove('hidden'); }
          } else {
            if (viewerError) viewerError.classList.remove('hidden');
            var errMsg = document.getElementById('viewerErrorMsg');
            if (errMsg) errMsg.textContent = 'Mammoth.js not available for .docx preview';
          }
        } catch (mammothError) {
          console.error('Failed to convert .docx:', mammothError);
          if (viewerError) viewerError.classList.remove('hidden');
          var errMsg = document.getElementById('viewerErrorMsg');
          if (errMsg) errMsg.textContent = 'Failed to preview .docx file';
        }
      } else {
        if (viewerError) viewerError.classList.remove('hidden');
        var errMsg = document.getElementById('viewerErrorMsg');
        if (errMsg) errMsg.textContent = 'Preview not available for ' + (contentType || 'this file type');
      }

    } catch (error) {
      console.error('[viewOrphanedDocument] Failed to load document:', error);
      if (viewerLoading) viewerLoading.classList.add('hidden');
      if (viewerError) viewerError.classList.remove('hidden');
      var errMsg = document.getElementById('viewerErrorMsg');
      if (errMsg) errMsg.textContent = error.message || 'Failed to load document';
    }
  }

  /**
   * Download an orphaned (untracked) file by its MinIO storage key.
   * @param {string} storageKey - MinIO storage key
   * @param {string} fileName - Download filename
   */
  async function downloadOrphanedDocument(storageKey, fileName) {
    var matterId = currentMatterData ? currentMatterData.matter_id : null;

    try {
      var url = api.baseUrl + '/api/v1/storage/download-by-key?storage_key=' + encodeURIComponent(storageKey) + '&matter_id=' + (matterId || '');
      var response = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + api.token }
      });

      if (!response.ok) {
        if (response.status === 401) {
          if (window.api && typeof window.api.showSessionExpiredModal === 'function') {
            window.api.showSessionExpiredModal();
          } else {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            Lex.Toast.error('Session expired. Redirecting to login...');
            trackTimeout(setTimeout(function () { window.location.href = 'login.html'; }, 1500));
          }
          throw new Error('Session expired');
        }
        throw new Error('Failed to download: ' + response.status);
      }

      var blob = await response.blob();
      var objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      Lex.Toast.success('Download started');
    } catch (error) {
      console.error('[downloadOrphanedDocument] Download failed:', error);
      Lex.Toast.error(error.message || 'Failed to download file');
    }
  }

  /**
   * Navigate to the dedicated file viewer page with referrer context.
   * @param {string} fileId
   */
  function _navToFileViewer(fileId) {
    var params = Lex.Nav.getParams();
    var matterId = params.get('id') || '';
    var referrer = 'workspace-details.html?id=' + encodeURIComponent(matterId);
    Lex.Nav.go('file-viewer.html', {
      params: { id: fileId },
      context: { referrer: referrer }
    });
  }

  window.downloadDocument = downloadDocument;
  window.viewOrphanedDocument = viewOrphanedDocument;
  window.downloadOrphanedDocument = downloadOrphanedDocument;
  window._navToFileViewer = _navToFileViewer;
  ['downloadDocument', 'viewOrphanedDocument', 'downloadOrphanedDocument', '_navToFileViewer'].forEach(_trackGlobal);

  // =========================================================================
  // Edit Matter Modal (NEW — specific to workspace_details.html)
  // Uses lex-modal#detailMatterModal and form#detailMatterForm
  // =========================================================================

  /**
   * Open the edit matter modal and pre-populate its fields with the
   * current matter data.
   * @param {Object} matter - The matter object to edit
   */
  function openEditMatterModal(matter) {
    var modal = document.getElementById('detailMatterModal');
    if (!modal) {
      console.error('[openEditMatterModal] Modal #detailMatterModal not found in DOM');
      return;
    }

    // Populate hidden id
    var idEl = document.getElementById('detailMatterId');
    if (idEl) idEl.value = matter.matter_id || '';

    // Populate lex-input / lex-select / lex-textarea components
    var nameEl = document.getElementById('detailMatterName');
    if (nameEl) nameEl.value = matter.matter_name || matter.name || '';

    var clientEl = document.getElementById('detailClientName');
    if (clientEl) clientEl.value = matter.client_name || '';

    var descEl = document.getElementById('detailMatterDescription');
    if (descEl) descEl.value = matter.description || '';

    var statusEl = document.getElementById('detailMatterStatus');
    if (statusEl) statusEl.value = matter.status || 'active';

    var practiceEl = document.getElementById('detailPracticeArea');
    if (practiceEl) practiceEl.value = matter.practice_area || '';

    // Check modal state before opening
    var overlay = modal.querySelector('.lex-modal-overlay');
    console.info('[openEditMatterModal] modal parent:', modal.parentNode && modal.parentNode.tagName, '| overlay:', overlay ? 'found' : 'MISSING', '| current open:', modal.open);

    modal.open = true;
  }

  /**
   * Handle the edit matter form submit.
   * Reads values from the detailMatterModal form, calls api.updateMatter,
   * then refreshes the current matter.
   * @param {Event} event - Submit event
   */
  async function saveEditMatter(event) {
    if (event) event.preventDefault();

    var matterId = '';
    var idEl = document.getElementById('detailMatterId');
    if (idEl) matterId = idEl.value;

    if (!matterId) {
      Lex.Toast.error('Matter ID missing');
      return;
    }

    var matterName = '';
    var nameEl = document.getElementById('detailMatterName');
    if (nameEl) matterName = nameEl.value || '';

    var clientName = '';
    var clientEl = document.getElementById('detailClientName');
    if (clientEl) clientName = clientEl.value || '';

    var description = '';
    var descEl = document.getElementById('detailMatterDescription');
    if (descEl) description = descEl.value || '';

    var status = 'active';
    var statusEl = document.getElementById('detailMatterStatus');
    if (statusEl) status = statusEl.value || 'active';

    var practiceArea = '';
    var practiceEl = document.getElementById('detailPracticeArea');
    if (practiceEl) practiceArea = practiceEl.value || '';

    try {
      await api.updateMatter(matterId, {
        matter_name: matterName,
        client_name: clientName,
        description: description,
        status: status,
        practice_area: practiceArea
      });

      Lex.Toast.success('Matter updated successfully');

      var modal = document.getElementById('detailMatterModal');
      if (modal) modal.open = false;

      await refreshCurrentMatter();
    } catch (error) {
      console.error('[saveEditMatter] Error:', error);
      Lex.Toast.error(error.message || 'Failed to update matter');
    }
  }

  // Wire up form submit and cancel button once DOM is ready
  (function wireEditMatterModal() {
    var form = document.getElementById('detailMatterForm');
    if (form) {
      form.addEventListener('submit', saveEditMatter);
    }
    var cancelBtn = document.getElementById('cancelDetailMatterBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        var modal = document.getElementById('detailMatterModal');
        if (modal) modal.open = false;
      });
    }
  }());

  window.openEditMatterModal = openEditMatterModal;
  window.saveEditMatter = saveEditMatter;
  ['openEditMatterModal', 'saveEditMatter'].forEach(_trackGlobal);

  // =========================================================================
  // Status Change Modal (NEW — specific to workspace_details.html)
  // Uses lex-modal#statusChangeModal and lex-select#statusChangeSelect
  // =========================================================================

  /**
   * Open the status change modal pre-set to the matter's current status.
   * @param {Object} matter - The current matter object
   */
  function openStatusChangeModal(matter) {
    var modal = document.getElementById('statusChangeModal');
    if (!modal) return;

    var selectEl = document.getElementById('statusChangeSelect');
    if (selectEl) selectEl.value = matter.status || 'active';

    modal.open = true;
  }

  /**
   * Read the selected status from statusChangeSelect, update the matter,
   * then close the modal and refresh.
   */
  async function confirmStatusChange() {
    if (!currentMatterData || !currentMatterData.matter_id) {
      Lex.Toast.error('No matter loaded');
      return;
    }

    var selectEl = document.getElementById('statusChangeSelect');
    var newStatus = selectEl ? (selectEl.value || 'active') : 'active';

    try {
      await api.updateMatter(currentMatterData.matter_id, { status: newStatus });

      Lex.Toast.success('Status updated to ' + newStatus.charAt(0).toUpperCase() + newStatus.substring(1));

      var modal = document.getElementById('statusChangeModal');
      if (modal) modal.open = false;

      await refreshCurrentMatter();
    } catch (error) {
      console.error('[confirmStatusChange] Error:', error);
      Lex.Toast.error(error.message || 'Failed to update status');
    }
  }

  /**
   * Close the status change modal.
   */
  function closeStatusChangeModal() {
    var modal = document.getElementById('statusChangeModal');
    if (modal) modal.open = false;
  }

  window.openStatusChangeModal = openStatusChangeModal;
  window.confirmStatusChange = confirmStatusChange;
  window.closeStatusChangeModal = closeStatusChangeModal;
  ['openStatusChangeModal', 'confirmStatusChange', 'closeStatusChangeModal'].forEach(_trackGlobal);

  // =========================================================================
  // Connected Data Tab — full tab view
  // (adapted from workspace.js lines 7058-7591)
  // =========================================================================

  /**
   * Render the connected data tab with entity groups and pending matches.
   * @param {Object} matter - The current matter object
   */
  async function renderConnectedDataTab(matter) {
    var content = document.getElementById('tabContentConnectedData');
    if (!content) return;

    content.innerHTML =
      '<div class="flex items-center justify-center py-12">' +
        '<div class="text-center">' +
          '<div class="animate-spin w-8 h-8 border-4 lex-border border-t-stone-600 rounded-full mx-auto mb-4"></div>' +
          '<p class="text-gray-500">Loading connected data...</p>' +
        '</div>' +
      '</div>';

    try {
      var results = await Promise.all([
        api.getMatterConnectorData(matter.matter_id),
        api.getMatterPendingMatches(matter.matter_id, { status: 'pending', limit: 50 })
      ]);

      var connectorResponse = results[0];
      var pendingResponse = results[1];

      var summary = connectorResponse.summary || { total_records: 0, connectors: [] };
      var data = connectorResponse.data || {};
      var pendingMatches = (pendingResponse && pendingResponse.pending_matches) || [];

      // Update badge count
      var badge = document.getElementById('connectedDataCount');
      if (badge && summary.total_records > 0) {
        badge.textContent = summary.total_records;
        badge.classList.remove('hidden');
      }

      if (summary.total_records === 0 && pendingMatches.length === 0) {
        content.innerHTML =
          '<div class="text-center py-12">' +
            '<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>' +
            '</svg>' +
            '<h4 class="text-lg font-semibold text-gray-900 mb-2">No connected data</h4>' +
            '<p class="text-gray-500">When data is synced from integrations, it will appear here.</p>' +
          '</div>';
        return;
      }

      var html = '<div class="space-y-6">';

      // Pending matches section
      if (pendingMatches.length > 0) {
        html +=
          '<div class="bg-amber-50 border-2 border-amber-200 rounded-lg p-4">' +
            '<div class="flex items-start gap-3">' +
              '<svg class="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>' +
              '</svg>' +
              '<div class="flex-1">' +
                '<h3 class="text-sm font-semibold text-amber-900">Pending Matches Require Review</h3>' +
                '<p class="text-xs text-amber-700 mt-1">' +
                  pendingMatches.length + ' potential match' + (pendingMatches.length !== 1 ? 'es' : '') + ' found. Review and approve or decline below.' +
                '</p>' +
              '</div>' +
            '</div>' +
            '<div class="mt-4 space-y-2">';

        pendingMatches.forEach(function (match) {
          html += renderPendingMatchCard(match, matter.matter_id);
        });

        html += '</div></div>';
      }

      // Summary section
      if (summary.total_records > 0) {
        var connectorBadges = '';
        (summary.connectors || []).forEach(function (conn) {
          connectorBadges += '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white border border-gray-200">' + escapeHtml(conn.name || '') + '</span>';
        });

        html +=
          '<div class="bg-gradient-to-r lex-bg-accent-muted rounded-lg p-4 border lex-border-subtle">' +
            '<div class="flex items-center justify-between">' +
              '<div class="flex-1">' +
                '<h3 class="text-sm font-medium text-gray-900">Connected Data Summary</h3>' +
                '<p class="text-xs text-gray-500 mt-1">' +
                  summary.total_records + ' record' + (summary.total_records !== 1 ? 's' : '') +
                  ' from ' + summary.connectors.length + ' connector' + (summary.connectors.length !== 1 ? 's' : '') +
                '</p>' +
              '</div>' +
              '<div class="flex items-center gap-3">' +
                '<div class="flex gap-2">' + connectorBadges + '</div>' +
                '<button onclick="showManualConnectModal(\'' + matter.matter_id + '\')"' +
                  ' class="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md lex-text-accent bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 lex-ring-focus">' +
                  '<svg class="-ml-0.5 mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>' +
                  '</svg>' +
                  'Link Data' +
                '</button>' +
              '</div>' +
            '</div>' +
          '</div>';
      }

      // Entity type groups
      Object.keys(data).forEach(function (entityType) {
        var records = data[entityType];
        // Build capitalized label from entityType — NO regex, use split
        var entityLabel = entityType.split('_').map(function (w) {
          return w.length > 0 ? w.charAt(0).toUpperCase() + w.substring(1) : w;
        }).join(' ');

        html +=
          '<div class="space-y-3">' +
            '<div class="flex items-center justify-between">' +
              '<h4 class="text-lg font-semibold text-gray-900">' + escapeHtml(entityLabel) + ' (' + records.length + ')</h4>' +
              '<button onclick="toggleEntityGroup(\'' + entityType + '\')" class="text-sm lex-text-accent hover:lex-text-accent">' +
                '<span id="toggle-' + entityType + '">Collapse All</span>' +
              '</button>' +
            '</div>' +
            '<div id="entity-group-' + entityType + '" class="space-y-2">';

        records.forEach(function (record, idx) {
          html += renderConnectorDataCard(record, entityType, idx);
        });

        html += '</div></div>';
      });

      html += '</div>';
      content.innerHTML = html;

    } catch (error) {
      console.error('[renderConnectedDataTab] Error:', error);
      content.innerHTML =
        '<div class="text-center py-12">' +
          '<svg class="mx-auto h-12 w-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
          '</svg>' +
          '<h3 class="mt-2 text-sm font-medium text-gray-900">Failed to load connected data</h3>' +
          '<p class="mt-1 text-sm text-gray-500">' + escapeHtml(error.message || 'An error occurred') + '</p>' +
        '</div>';
    }
  }

  /**
   * Render an individual connector data card.
   * @param {Object} record - Connector data record
   * @param {string} entityType - Entity type key
   * @param {number} index - Record index within the group
   * @returns {string} HTML string for the card
   */
  function renderConnectorDataCard(record, entityType, index) {
    var cardId = 'connector-card-' + entityType + '-' + index;
    var detailsId = 'connector-details-' + entityType + '-' + index;

    var preview = getConnectorDataPreview(record);

    var confidenceColor = 'gray';
    var conf = record.match_confidence || 0;
    if (conf >= 90) confidenceColor = 'green';
    else if (conf >= 70) confidenceColor = 'yellow';
    else if (conf >= 50) confidenceColor = 'orange';
    else confidenceColor = 'red';

    var verifiedBadge = '';
    if (record.user_confirmed === true) {
      verifiedBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Verified</span>';
    } else if (record.user_confirmed === false) {
      verifiedBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Rejected</span>';
    }

    // NO regex: use split for match_strategy display
    var strategyLabel = (record.match_strategy || '').split('_').join(' ');

    return '<div id="' + cardId + '" class="bg-white border border-gray-200 rounded-lg hover:lex-border-accent transition-all">' +
      '<div class="p-4">' +
        '<div class="flex items-start justify-between gap-4">' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-2 mb-2">' +
              '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium lex-bg-accent-soft lex-text-accent">' +
                escapeHtml(record.connector_name || '') +
              '</span>' +
              '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-' + confidenceColor + '-100 text-' + confidenceColor + '-800">' +
                Math.round(conf) + '% match' +
              '</span>' +
              verifiedBadge +
            '</div>' +
            preview +
            '<div class="mt-2 text-xs text-gray-500">' +
              '<span>ID: ' + escapeHtml(record.external_id || '') + '</span>' +
              '<span class="mx-2">•</span>' +
              '<span>Strategy: ' + escapeHtml(strategyLabel) + '</span>' +
              '<span class="mx-2">•</span>' +
              '<span>' + timeAgo(record.created_at) + '</span>' +
            '</div>' +
          '</div>' +
          '<button onclick="toggleConnectorDetails(\'' + detailsId + '\')" class="lex-text-accent hover:lex-text-accent p-1" title="Toggle details">' +
            '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div id="' + detailsId + '" class="hidden mt-4 pt-4 border-t border-gray-200">' +
          '<h5 class="text-sm font-medium text-gray-900 mb-2">Raw Data:</h5>' +
          '<pre class="bg-gray-50 rounded p-3 text-xs overflow-x-auto max-h-96 overflow-y-auto"><code>' +
            escapeHtml(JSON.stringify(record.data, null, 2)) +
          '</code></pre>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /**
   * Get a human-readable preview snippet for a connector data record.
   * @param {Object} record - Connector data record with entity_type and data fields
   * @returns {string} HTML preview string
   */
  function getConnectorDataPreview(record) {
    var entityType = record.entity_type || '';
    var data = record.data || {};

    if (entityType === 'contact' || entityType === 'participant') {
      var displayName = (data.name && data.name.display_name)
        ? data.name.display_name
        : ((data.first_name || '') + ' ' + (data.last_name || '')).trim() || 'Unknown Contact';
      var email = (data.contact && data.contact.email) ? data.contact.email : (data.email || 'No email');
      var phone = (data.contact && data.contact.phone_primary)
        ? '<p class="text-sm text-gray-600">' + escapeHtml(data.contact.phone_primary) + '</p>'
        : '';
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(displayName) + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(email) + '</p>' + phone;
    }

    if (entityType === 'opportunity' || entityType === 'deal') {
      var title = data.name || data.title || 'Untitled Opportunity';
      var statusLabel = data.status || data.pipeline_stage || 'No status';
      var valueStr = (data.monetaryValue || data.value)
        ? ' - $' + Number(data.monetaryValue || data.value).toLocaleString()
        : '';
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(title) + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(statusLabel) + escapeHtml(valueStr) + '</p>';
    }

    if (entityType === 'activity' || entityType === 'event' || entityType === 'calendar_event') {
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(data.title || data.name || data.subject || 'Activity') + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(data.description || data.notes || '') + '</p>';
    }

    if (entityType === 'note') {
      var noteText = data.content || data.text || data.description || '';
      var notePreview = noteText.length > 100 ? noteText.substring(0, 100) + '...' : noteText;
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(data.title || 'Note') + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(notePreview) + '</p>';
    }

    if (entityType === 'message') {
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(data.subject || 'Message') + '</h5>' +
        '<p class="text-sm text-gray-600">From: ' + escapeHtml(data.from || data.sender || 'Unknown') + '</p>';
    }

    return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(entityType) + '</h5>' +
      '<p class="text-sm text-gray-600">' + escapeHtml(data.name || data.title || 'View details below') + '</p>';
  }

  /**
   * Get preview HTML for a pending match card.
   * @param {Object} data - Connector data object
   * @param {string} entityType - Entity type key
   * @returns {string} HTML preview string
   */
  function getPendingMatchPreview(data, entityType) {
    if (!data) return '<p class="text-sm text-gray-500">No preview available</p>';

    if (entityType === 'contact' || entityType === 'participant') {
      var displayName = (data.name && data.name.display_name)
        ? data.name.display_name
        : ((data.first_name || '') + ' ' + (data.last_name || '')).trim() || 'Unknown Contact';
      var email = (data.contact && data.contact.email) ? data.contact.email : (data.email || 'No email');
      var phone = (data.contact && data.contact.phone_primary)
        ? '<p class="text-sm text-gray-600">' + escapeHtml(data.contact.phone_primary) + '</p>'
        : '';
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(displayName) + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(email) + '</p>' + phone;
    }

    if (entityType === 'opportunity' || entityType === 'deal') {
      var title = data.name || data.title || 'Untitled Opportunity';
      var statusStr = data.status || data.pipeline_stage || 'No status';
      var valStr = (data.monetaryValue || data.value)
        ? ' - $' + Number(data.monetaryValue || data.value).toLocaleString()
        : '';
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(title) + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(statusStr) + escapeHtml(valStr) + '</p>';
    }

    if (entityType === 'activity' || entityType === 'event' || entityType === 'calendar_event') {
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(data.title || data.name || data.subject || 'Activity') + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(data.description || data.notes || '') + '</p>';
    }

    if (entityType === 'note') {
      var noteText = data.content || data.text || data.description || '';
      var notePreview = noteText.length > 100 ? noteText.substring(0, 100) + '...' : noteText;
      return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(data.title || 'Note') + '</h5>' +
        '<p class="text-sm text-gray-600">' + escapeHtml(notePreview) + '</p>';
    }

    return '<h5 class="text-sm font-medium text-gray-900">' + escapeHtml(data.name || data.title || entityType) + '</h5>' +
      '<p class="text-sm text-gray-600">' + (JSON.stringify(data) || '').substring(0, 100) + '...</p>';
  }

  /**
   * Render a pending match card (used inside renderConnectedDataTab).
   * @param {Object} match - Pending match record
   * @param {string} matterId - Matter ID for approve/decline actions
   * @returns {string} HTML string for the card
   */
  function renderPendingMatchCard(match, matterId) {
    var id = match.id;
    var entityType = match.entity_type || '';
    var externalId = match.external_id || '';
    var connectorName = match.connector_name || 'Unknown Connector';
    var matchConfidence = match.match_confidence || 0;
    var matchStrategy = (match.match_strategy || '').split('_').join(' ');
    var matchDetails = match.match_details || {};
    var connectorData = match.connector_data || {};

    var confidenceColor = 'gray';
    if (matchConfidence >= 90) confidenceColor = 'green';
    else if (matchConfidence >= 70) confidenceColor = 'yellow';
    else if (matchConfidence >= 50) confidenceColor = 'orange';
    else confidenceColor = 'red';

    var preview = getPendingMatchPreview(connectorData, entityType);
    var matchReason = matchDetails.confidence_reason || 'Similar data detected';

    // NO regex for entity type label
    var entityLabel = entityType.split('_').join(' ');

    return '<div id="pending-match-' + id + '" class="bg-white border-2 border-amber-300 rounded-lg p-4 hover:border-amber-400 transition-colors">' +
      '<div class="flex items-start justify-between gap-4">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex flex-wrap items-center gap-2 mb-2">' +
            '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium lex-bg-accent-soft lex-text-accent">' + escapeHtml(connectorName) + '</span>' +
            '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">' + escapeHtml(entityLabel) + '</span>' +
            '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-' + confidenceColor + '-100 text-' + confidenceColor + '-800">' + Math.round(matchConfidence) + '% match</span>' +
          '</div>' +
          preview +
          '<div class="mt-2 flex items-start gap-2">' +
            '<svg class="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
            '</svg>' +
            '<p class="text-xs text-gray-600"><span class="font-medium">Why this matched:</span> ' + escapeHtml(matchReason) + '</p>' +
          '</div>' +
          '<div class="mt-2 text-xs text-gray-500">' +
            '<span>ID: ' + escapeHtml(externalId) + '</span>' +
            '<span class="mx-2">•</span>' +
            '<span>Strategy: ' + escapeHtml(matchStrategy) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="flex flex-col gap-2 flex-shrink-0">' +
          '<button onclick="showApprovePendingMatchModal(\'' + id + '\', \'' + matterId + '\')"' +
            ' class="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors" title="Approve this match">' +
            'Approve' +
          '</button>' +
          '<button onclick="showDeclinePendingMatchModal(\'' + id + '\', \'' + matterId + '\')"' +
            ' class="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded hover:bg-gray-300 transition-colors" title="Decline this match">' +
            'Decline' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /**
   * Show confirmation dialog then approve a pending match.
   * @param {string} matchId - Pending match ID
   * @param {string} matterId - Matter ID
   */
  function showApprovePendingMatchModal(matchId, matterId) {
    Lex.Modal.confirm(
      'Approve Match',
      'Approve this match? This will create a permanent link between this matter and the connector data.',
      async function () {
    try {
      Lex.Toast.info('Approving match...');
      await api.approvePendingMatch(matterId, matchId);

      var matchCard = document.getElementById('pending-match-' + matchId);
      if (matchCard) {
        matchCard.style.opacity = '0';
        trackTimeout(setTimeout(function () { matchCard.remove(); }, 300));
      }

      Lex.Toast.success('Match approved! The data will now appear in Connected Data.');

      trackTimeout(setTimeout(function () {
        if (currentMatterData && currentMatterData.matter) {
          renderConnectedDataTab(currentMatterData.matter);
        }
      }, 1500));
    } catch (error) {
      console.error('[showApprovePendingMatchModal] Error:', error);
      Lex.Toast.error(error.message || 'Failed to approve match');
    }
      }
    );
  }

  /**
   * Show the decline pending match modal with an optional reason textarea.
   * @param {string} matchId - Pending match ID
   * @param {string} matterId - Matter ID
   */
  function showDeclinePendingMatchModal(matchId, matterId) {
    var existing = document.getElementById('declineMatchModal');
    if (existing) existing.remove();

    var modalHtml =
      '<div id="declineMatchModal" class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">' +
        '<div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">' +
          '<div class="p-6">' +
            '<h3 class="text-lg font-semibold text-gray-900 mb-2">Decline Match</h3>' +
            '<p class="text-sm text-gray-600 mb-4">This match will be permanently declined and never suggested again. Optionally provide a reason to help improve future matching.</p>' +
            '<label class="block text-sm font-medium text-gray-700 mb-2">Reason (optional)</label>' +
            '<textarea id="declineReason" rows="3"' +
              ' class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 lex-ring-focus"' +
              ' placeholder="E.g., Wrong client, Different matter, Incorrect data..."></textarea>' +
            '<div class="mt-6 flex gap-3 justify-end">' +
              '<button onclick="closeDeclineMatchModal()" class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancel</button>' +
              '<button onclick="confirmDeclinePendingMatch(\'' + matchId + '\', \'' + matterId + '\')" class="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700">Decline Match</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  /**
   * Close the decline match modal.
   */
  function closeDeclineMatchModal() {
    var modal = document.getElementById('declineMatchModal');
    if (modal) modal.remove();
  }

  /**
   * Read the decline reason and submit the decline API call.
   * @param {string} matchId - Pending match ID
   * @param {string} matterId - Matter ID
   */
  async function confirmDeclinePendingMatch(matchId, matterId) {
    var reasonEl = document.getElementById('declineReason');
    var reason = reasonEl ? (reasonEl.value || null) : null;
    closeDeclineMatchModal();

    try {
      Lex.Toast.info('Declining match...');
      await api.declinePendingMatch(matterId, matchId, reason);

      var matchCard = document.getElementById('pending-match-' + matchId);
      if (matchCard) {
        matchCard.style.opacity = '0';
        trackTimeout(setTimeout(function () { matchCard.remove(); }, 300));
      }

      Lex.Toast.success('Match declined. This suggestion will not appear again.');
    } catch (error) {
      console.error('[confirmDeclinePendingMatch] Error:', error);
      Lex.Toast.error(error.message || 'Failed to decline match');
    }
  }

  /**
   * Toggle the expanded raw-data details section for a connector data card.
   * @param {string} detailsId - ID of the details element
   */
  function toggleConnectorDetails(detailsId) {
    var details = document.getElementById(detailsId);
    if (details) details.classList.toggle('hidden');
  }

  /**
   * Toggle all detail panels within an entity group (collapse / expand all).
   * @param {string} entityType - Entity type key used to derive element IDs
   */
  function toggleEntityGroup(entityType) {
    var group = document.getElementById('entity-group-' + entityType);
    var toggle = document.getElementById('toggle-' + entityType);
    if (!group || !toggle) return;

    var isExpanded = toggle.textContent === 'Collapse All';
    var cards = group.querySelectorAll('[id^="connector-details-"]');

    for (var i = 0; i < cards.length; i++) {
      if (isExpanded) {
        cards[i].classList.add('hidden');
      } else {
        cards[i].classList.remove('hidden');
      }
    }

    toggle.textContent = isExpanded ? 'Expand All' : 'Collapse All';
  }

  window.renderConnectedDataTab = renderConnectedDataTab;
  window.renderConnectorDataCard = renderConnectorDataCard;
  window.getConnectorDataPreview = getConnectorDataPreview;
  window.getPendingMatchPreview = getPendingMatchPreview;
  window.renderPendingMatchCard = renderPendingMatchCard;
  window.showApprovePendingMatchModal = showApprovePendingMatchModal;
  window.showDeclinePendingMatchModal = showDeclinePendingMatchModal;
  window.closeDeclineMatchModal = closeDeclineMatchModal;
  window.confirmDeclinePendingMatch = confirmDeclinePendingMatch;
  window.toggleConnectorDetails = toggleConnectorDetails;
  window.toggleEntityGroup = toggleEntityGroup;

  ['renderConnectedDataTab', 'renderConnectorDataCard', 'getConnectorDataPreview',
   'getPendingMatchPreview', 'renderPendingMatchCard',
   'showApprovePendingMatchModal', 'showDeclinePendingMatchModal',
   'closeDeclineMatchModal', 'confirmDeclinePendingMatch',
   'toggleConnectorDetails', 'toggleEntityGroup'].forEach(_trackGlobal);

  // =========================================================================
  // Document Generation Tab
  // =========================================================================

  async function renderDocGenerationTab(matter) {
    var container = document.getElementById('tabContentDocGeneration');
    if (!container) return;

    // Show shimmer placeholder
    container.innerHTML =
      '<div class="space-y-4">' +
        '<div class="h-4 bg-gray-100 rounded w-1/3 animate-pulse"></div>' +
        '<div class="h-20 bg-gray-100 rounded animate-pulse"></div>' +
        '<div class="h-4 bg-gray-100 rounded w-1/4 animate-pulse"></div>' +
        '<div class="h-32 bg-gray-100 rounded animate-pulse"></div>' +
      '</div>';

    // Parallel data fetch (refresh contacts from API to include newly added + connector contacts)
    var matterId = matter.matter_id;
    var results = await Promise.allSettled([
      api.get('/api/v1/matters/' + matterId + '/document-types'),
      api.get('/api/v1/generation-template-sets?matter_id=' + matterId),
      api.get('/api/v1/matters/' + matterId)
    ]);

    docGenState.documentTypes = (results[0].status === 'fulfilled' && results[0].value && results[0].value.data)
      ? results[0].value.data : [];
    docGenState.templateSets = (results[1].status === 'fulfilled' && results[1].value && results[1].value.data)
      ? results[1].value.data : [];
    // Use fresh contacts from re-fetched matter data, falling back to cached data
    var freshMatterData = (results[2].status === 'fulfilled' && results[2].value) ? results[2].value : null;
    docGenState.contacts = (freshMatterData && freshMatterData.contacts) ||
      (currentMatterData && currentMatterData.contacts) || [];

    var html = '';

    // Section 1: Learned Document Types
    var typesHtml = buildDocumentTypesContent(docGenState.documentTypes);
    var analyzeBtn = '<span onclick="event.stopPropagation(); analyzeDocumentStructure()" class="text-xs font-medium px-2 py-1 rounded cursor-pointer transition-colors" style="color: var(--lex-text-accent); background: var(--lex-bg-accent-muted)">Analyze Documents</span>';
    var typesBadge = docGenState.documentTypes.length > 0
      ? '<span class="ml-2 text-xs font-medium px-1.5 py-0.5 rounded-full" style="background: var(--lex-bg-accent-muted); color: var(--lex-text-accent)">' + docGenState.documentTypes.length + '</span>'
      : '';
    html += createCollapsibleSection('Learned Document Types', typesHtml, 'docgen-types', {
      badge: typesBadge,
      actions: analyzeBtn,
      defaultExpanded: true
    });

    // Section 2: Template Sets
    var setsHtml = buildTemplateSetsContent(docGenState.templateSets);
    var createSetBtn = '<span onclick="event.stopPropagation(); openTemplateSetModal()" class="text-xs font-medium px-2 py-1 rounded cursor-pointer transition-colors" style="color: var(--lex-text-accent); background: var(--lex-bg-accent-muted)">Create Set</span>';
    var setsBadge = docGenState.templateSets.length > 0
      ? '<span class="ml-2 text-xs font-medium px-1.5 py-0.5 rounded-full" style="background: var(--lex-bg-accent-muted); color: var(--lex-text-accent)">' + docGenState.templateSets.length + '</span>'
      : '';
    html += createCollapsibleSection('Template Sets', setsHtml, 'docgen-sets', {
      badge: setsBadge,
      actions: createSetBtn,
      defaultExpanded: false
    });

    // Section 3: Generate Document Form
    var formHtml = buildGenerateFormContent(matter);
    html += createCollapsibleSection('Generate Document', formHtml, 'docgen-form', {
      defaultExpanded: true
    });

    container.innerHTML = html;
  }

  function buildDocumentTypesContent(types) {
    if (!types || types.length === 0) {
      return '<div class="text-center py-8">' +
        '<svg class="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>' +
        '</svg>' +
        '<p class="text-sm text-gray-500">No document types learned yet</p>' +
        '<p class="text-xs text-gray-400 mt-1">Upload documents and click "Analyze Documents" to discover patterns</p>' +
      '</div>';
    }

    var html = '<div class="overflow-x-auto"><table class="w-full text-sm">' +
      '<thead><tr class="border-b border-gray-200">' +
        '<th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Type</th>' +
        '<th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Documents</th>' +
        '<th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Confidence</th>' +
        '<th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Structure</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      var conf = t.confidence_score ? Math.round(t.confidence_score * 100) : 0;
      var confColor = conf >= 70 ? 'text-green-600' : conf >= 40 ? 'text-amber-600' : 'text-red-500';
      var hasStructure = t.has_structure || t.structure_version;
      html += '<tr class="border-b border-gray-100 hover:bg-gray-50">' +
        '<td class="py-2 px-3 font-medium text-gray-900">' + escapeHtml(t.document_type_label || t.document_type || 'Unknown') + '</td>' +
        '<td class="py-2 px-3 text-gray-600">' + (t.document_count || 0) + '</td>' +
        '<td class="py-2 px-3 ' + confColor + ' font-medium">' + conf + '%</td>' +
        '<td class="py-2 px-3">' +
          (hasStructure
            ? '<span class="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Learned</span>'
            : '<span class="text-xs text-gray-400">Not analyzed</span>') +
        '</td>' +
      '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  function buildTemplateSetsContent(sets) {
    if (!sets || sets.length === 0) {
      return '<div class="text-center py-8">' +
        '<svg class="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>' +
        '</svg>' +
        '<p class="text-sm text-gray-500">No template sets created</p>' +
        '<p class="text-xs text-gray-400 mt-1">Group similar documents into sets for better generation results</p>' +
      '</div>';
    }

    var html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      var docCount = s.document_count || 0;
      var isAnalyzed = s.is_analyzed || s.analyzed_at;
      html += '<div class="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">' +
        '<div class="flex items-start justify-between mb-2">' +
          '<div>' +
            '<h5 class="text-sm font-semibold text-gray-900">' + escapeHtml(s.name) + '</h5>' +
            '<p class="text-xs text-gray-500 mt-0.5">' + escapeHtml(s.document_type_label || s.document_type || '') + '</p>' +
          '</div>' +
          (isAnalyzed ? '<span class="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Analyzed</span>' : '') +
        '</div>' +
        '<p class="text-xs text-gray-500 mb-3">' + docCount + ' document' + (docCount !== 1 ? 's' : '') + '</p>' +
        (s.description ? '<p class="text-xs text-gray-400 mb-3 line-clamp-2">' + escapeHtml(s.description) + '</p>' : '') +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<button onclick="manageSetDocuments(\'' + s.id + '\', \'' + escapeHtml(s.name) + '\')" class="text-xs font-medium px-2 py-1 rounded transition-colors text-blue-700 bg-blue-50 hover:bg-blue-100">Documents</button>' +
          '<button onclick="editTemplateSet(\'' + s.id + '\')" class="text-xs font-medium px-2 py-1 rounded transition-colors" style="color: var(--lex-text-accent); background: var(--lex-bg-accent-muted)">Edit</button>' +
          '<button onclick="analyzeTemplateSet(\'' + s.id + '\')" class="text-xs font-medium px-2 py-1 rounded transition-colors text-gray-600 bg-gray-100 hover:bg-gray-200">Analyze</button>' +
          '<button onclick="deleteTemplateSet(\'' + s.id + '\')" class="text-xs font-medium px-2 py-1 rounded transition-colors text-red-600 bg-red-50 hover:bg-red-100">Delete</button>' +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function buildGenerateFormContent(matter) {
    // Merge document types from learned + template sets for the select options
    var options = '<option value="">-- Select Document Type --</option>';

    if (docGenState.documentTypes.length > 0) {
      options += '<optgroup label="Learned Types">';
      for (var i = 0; i < docGenState.documentTypes.length; i++) {
        var dt = docGenState.documentTypes[i];
        options += '<option value="' + escapeHtml(dt.document_type) + '">' + escapeHtml(dt.document_type_label || dt.document_type) + '</option>';
      }
      options += '</optgroup>';
    }

    if (docGenState.templateSets.length > 0) {
      options += '<optgroup label="Template Sets">';
      for (var j = 0; j < docGenState.templateSets.length; j++) {
        var ts = docGenState.templateSets[j];
        options += '<option value="' + escapeHtml(ts.document_type) + '" data-set-id="' + escapeHtml(ts.id) + '">' + escapeHtml(ts.name) + '</option>';
      }
      options += '</optgroup>';
    }

    // Contact options
    var contactOptions = '<option value="">-- No Target Contact --</option>';
    for (var k = 0; k < docGenState.contacts.length; k++) {
      var c = docGenState.contacts[k];
      var cName = c.display_name || ((c.first_name || '') + ' ' + (c.last_name || '')).trim();
      if (cName) {
        contactOptions += '<option value="' + escapeHtml(cName) + '">' + escapeHtml(cName) + '</option>';
      }
    }

    return '<form id="docGenForm" onsubmit="submitDocGeneration(event)" class="space-y-4">' +
      '<div>' +
        '<label class="block text-sm font-medium text-gray-700 mb-1">Document Type</label>' +
        '<select id="dgDocType" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required>' +
          options +
        '</select>' +
      '</div>' +
      '<div>' +
        '<label class="block text-sm font-medium text-gray-700 mb-1">Instructions</label>' +
        '<textarea id="dgInstructions" rows="4" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" required placeholder="Describe what you want to generate. Be specific about tone, structure, and key details to include..."></textarea>' +
      '</div>' +
      '<div>' +
        '<label class="block text-sm font-medium text-gray-700 mb-1">Target Contact</label>' +
        '<select id="dgContact" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">' +
          contactOptions +
        '</select>' +
        '<p class="text-xs text-gray-400 mt-1">Participant data will be injected into the generated document</p>' +
      '</div>' +
      '<div>' +
        '<label class="block text-sm font-medium text-gray-700 mb-1">Custom Variables</label>' +
        '<div id="dgCustomVars" class="space-y-2"></div>' +
        '<button type="button" onclick="addDocGenCustomVar()" class="mt-2 text-xs font-medium px-2 py-1 rounded transition-colors" style="color: var(--lex-text-accent); background: var(--lex-bg-accent-muted)">+ Add Variable</button>' +
      '</div>' +
      '<div class="flex items-center gap-2">' +
        '<input type="checkbox" id="dgStream" checked class="rounded border-gray-300">' +
        '<label for="dgStream" class="text-sm text-gray-600">Stream output in real-time</label>' +
      '</div>' +
      '<div class="pt-3 border-t border-gray-200">' +
        '<lex-btn type="submit" variant="primary" id="dgSubmitBtn">Generate Document</lex-btn>' +
      '</div>' +
    '</form>';
  }

  function addDocGenCustomVar() {
    var container = document.getElementById('dgCustomVars');
    if (!container) return;
    docGenState.customVarCount++;
    var idx = docGenState.customVarCount;
    var row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.id = 'dgVar-' + idx;
    row.innerHTML =
      '<input type="text" placeholder="Variable name" class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" data-var-key="' + idx + '">' +
      '<input type="text" placeholder="Value" class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm" data-var-val="' + idx + '">' +
      '<button type="button" onclick="removeDocGenCustomVar(' + idx + ')" class="text-gray-400 hover:text-red-500 p-1">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>' +
      '</button>';
    container.appendChild(row);
  }

  function removeDocGenCustomVar(idx) {
    var row = document.getElementById('dgVar-' + idx);
    if (row) row.remove();
  }

  // =========================================================================
  // Document Generation - Analysis
  // =========================================================================

  async function analyzeDocumentStructure() {
    if (!currentMatterData || docGenState.isAnalyzing) return;
    var matter = currentMatterData.matter;
    docGenState.isAnalyzing = true;

    try {
      Lex.Toast.success('Starting document structure analysis...');
      await api.post('/api/v1/matters/' + matter.matter_id + '/analyze-document-structure', {});
      Lex.Toast.success('Analysis started. Types will appear when complete.');
      // Refresh the tab after a delay to allow analysis to run
      trackTimeout(setTimeout(function () {
        if (getCurrentActiveTab() === 'docGeneration') {
          renderDocGenerationTab(matter);
        }
      }, 5000));
    } catch (err) {
      Lex.Toast.error('Analysis failed: ' + (err.message || 'Unknown error'));
    } finally {
      docGenState.isAnalyzing = false;
    }
  }

  // =========================================================================
  // Document Generation - Template Set CRUD
  // =========================================================================

  function openTemplateSetModal(existingSet) {
    var modal = document.getElementById('templateSetModal');
    var heading = modal;
    var submitBtn = document.getElementById('tsSubmitBtn');
    var editId = document.getElementById('tsEditId');
    var nameEl = document.getElementById('tsName');
    var descEl = document.getElementById('tsDescription');
    var docTypeEl = document.getElementById('tsDocType');
    var docTypeLabelEl = document.getElementById('tsDocTypeLabel');

    if (existingSet) {
      if (heading) heading.heading = 'Edit Template Set';
      if (submitBtn) submitBtn.textContent = 'Save Changes';
      if (editId) editId.value = existingSet.id || '';
      if (nameEl) nameEl.value = existingSet.name || '';
      if (descEl) descEl.value = existingSet.description || '';
      if (docTypeEl) docTypeEl.value = existingSet.document_type || '';
      if (docTypeLabelEl) docTypeLabelEl.value = existingSet.document_type_label || '';
    } else {
      if (heading) heading.heading = 'Create Template Set';
      if (submitBtn) submitBtn.textContent = 'Create Set';
      if (editId) editId.value = '';
      if (nameEl) nameEl.value = '';
      if (descEl) descEl.value = '';
      if (docTypeEl) docTypeEl.value = '';
      if (docTypeLabelEl) docTypeLabelEl.value = '';
    }

    if (modal) modal.open = true;
  }

  function closeTemplateSetModal() {
    var modal = document.getElementById('templateSetModal');
    if (modal) modal.open = false;
  }

  async function saveTemplateSet(event) {
    event.preventDefault();
    if (!currentMatterData) return;

    var editId = (document.getElementById('tsEditId') || {}).value;
    var payload = {
      name: (document.getElementById('tsName') || {}).value || '',
      description: (document.getElementById('tsDescription') || {}).value || '',
      document_type: (document.getElementById('tsDocType') || {}).value || '',
      document_type_label: (document.getElementById('tsDocTypeLabel') || {}).value || '',
      matter_id: currentMatterData.matter.matter_id
    };

    try {
      if (editId) {
        await api.patch('/api/v1/generation-template-sets/' + editId, payload);
        Lex.Toast.success('Template set updated');
      } else {
        await api.post('/api/v1/generation-template-sets', payload);
        Lex.Toast.success('Template set created');
      }
      closeTemplateSetModal();
      renderDocGenerationTab(currentMatterData.matter);
    } catch (err) {
      Lex.Toast.error('Failed to save: ' + (err.message || 'Unknown error'));
    }
  }

  async function editTemplateSet(setId) {
    try {
      var resp = await api.get('/api/v1/generation-template-sets/' + setId);
      var set = resp && resp.data ? resp.data : resp;
      openTemplateSetModal(set);
    } catch (err) {
      Lex.Toast.error('Failed to load template set');
    }
  }

  function deleteTemplateSet(setId) {
    Lex.Modal.confirm(
      'Delete Template Set',
      'Are you sure you want to delete this template set? This action cannot be undone.',
      async function () {
        try {
          await api.delete('/api/v1/generation-template-sets/' + setId);
          Lex.Toast.success('Template set deleted');
          if (currentMatterData) renderDocGenerationTab(currentMatterData.matter);
        } catch (err) {
          Lex.Toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
        }
      }
    );
  }

  async function analyzeTemplateSet(setId) {
    try {
      Lex.Toast.success('Analyzing template set...');
      await api.post('/api/v1/generation-template-sets/' + setId + '/analyze', {});
      Lex.Toast.success('Analysis complete');
      if (currentMatterData) renderDocGenerationTab(currentMatterData.matter);
    } catch (err) {
      Lex.Toast.error('Analysis failed: ' + (err.message || 'Unknown error'));
    }
  }

  // =========================================================================
  // Document Generation - Template Set Document Management
  // =========================================================================

  /**
   * Open an inline panel showing documents in a template set, with the ability
   * to add from the matter's documents or remove existing ones.
   */
  async function manageSetDocuments(setId, setName) {
    try {
      // Fetch the set with its documents
      var resp = await api.get('/api/v1/generation-template-sets/' + setId);
      var set = resp && resp.data ? resp.data : resp;
      var docs = set.documents || [];

      // Build overlay
      var overlay = document.getElementById('tsDocOverlay');
      if (overlay) overlay.remove();

      overlay = document.createElement('div');
      overlay.id = 'tsDocOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';

      var panel = document.createElement('div');
      panel.style.cssText = 'background:white;border-radius:12px;width:90%;max-width:640px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);';

      // Header
      var header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;';
      header.innerHTML = '<div><h3 style="font-size:16px;font-weight:600;color:#111827;">Documents in ' + escapeHtml(setName) + '</h3>' +
        '<p style="font-size:12px;color:#6b7280;margin-top:2px;">' + docs.length + ' document' + (docs.length !== 1 ? 's' : '') + '</p></div>' +
        '<button id="tsDocCloseBtn" style="padding:4px;border-radius:6px;border:none;background:none;cursor:pointer;color:#6b7280;" title="Close">' +
          '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
        '</button>';
      panel.appendChild(header);

      // Document list
      var listContainer = document.createElement('div');
      listContainer.style.cssText = 'flex:1;overflow-y:auto;padding:12px 20px;';

      if (docs.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center;padding:24px;color:#9ca3af;font-size:14px;">No documents in this set yet</div>';
      } else {
        var listHtml = '';
        for (var i = 0; i < docs.length; i++) {
          var d = docs[i];
          var fname = d.filename || 'Unknown';
          listHtml += '<div class="flex items-center justify-between py-2 border-b border-gray-100" data-doc-id="' + escapeHtml(d.document_id) + '">' +
            '<div class="min-w-0 flex-1">' +
              '<p class="text-sm text-gray-800 truncate">' + escapeHtml(fname) + '</p>' +
              '<p class="text-xs text-gray-400">' + escapeHtml(d.content_type || '') + '</p>' +
            '</div>' +
            '<button onclick="removeDocFromSet(\'' + setId + '\', \'' + d.document_id + '\', this)" class="ml-2 text-xs font-medium px-2 py-1 rounded text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex-shrink-0">Remove</button>' +
          '</div>';
        }
        listContainer.innerHTML = listHtml;
      }
      panel.appendChild(listContainer);

      // Add document section
      var addSection = document.createElement('div');
      addSection.style.cssText = 'border-top:1px solid #e5e7eb;padding:12px 20px;';
      addSection.innerHTML = '<p style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">Add Document from Matter</p>' +
        '<div style="display:flex;gap:8px;">' +
          '<select id="tsDocSelect" style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">' +
            '<option value="">Loading documents...</option>' +
          '</select>' +
          '<button id="tsDocAddBtn" onclick="addDocToSet(\'' + setId + '\')" style="padding:6px 14px;border-radius:6px;border:none;background:#7c3aed;color:white;font-size:13px;font-weight:500;cursor:pointer;">Add</button>' +
        '</div>';
      panel.appendChild(addSection);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // Close handlers
      document.getElementById('tsDocCloseBtn').onclick = function () { overlay.remove(); };
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

      // Populate the document select with matter documents not already in the set
      var existingIds = {};
      for (var ei = 0; ei < docs.length; ei++) existingIds[docs[ei].document_id] = true;

      var matterId = currentMatterData && currentMatterData.matter ? currentMatterData.matter.matter_id : null;
      if (matterId) {
        var docsResp = await api.get('/api/v1/matters/' + matterId + '/documents?limit=200');
        var matterDocs = (docsResp && docsResp.data) ? docsResp.data : (Array.isArray(docsResp) ? docsResp : []);
        var select = document.getElementById('tsDocSelect');
        if (select) {
          var optHtml = '<option value="">-- Select a document --</option>';
          for (var di = 0; di < matterDocs.length; di++) {
            var md = matterDocs[di];
            if (existingIds[md.id]) continue; // Already in set
            optHtml += '<option value="' + escapeHtml(md.id) + '">' + escapeHtml(md.filename || 'Document') + '</option>';
          }
          select.innerHTML = optHtml;
        }
      }
    } catch (err) {
      Lex.Toast.error('Failed to load set documents: ' + (err.message || 'Unknown error'));
    }
  }

  /**
   * Add a document to a template set from the management overlay.
   */
  async function addDocToSet(setId) {
    var select = document.getElementById('tsDocSelect');
    if (!select || !select.value) {
      Lex.Toast.error('Please select a document');
      return;
    }
    var docId = select.value;
    var matterId = currentMatterData && currentMatterData.matter ? currentMatterData.matter.matter_id : null;

    try {
      await api.post('/api/v1/generation-template-sets/' + setId + '/documents', {
        document_id: docId,
        source_matter_id: matterId
      });
      Lex.Toast.success('Document added to set');
      // Refresh the overlay
      var overlay = document.getElementById('tsDocOverlay');
      if (overlay) overlay.remove();
      // Re-fetch set name from state
      var setName = '';
      for (var i = 0; i < docGenState.templateSets.length; i++) {
        if (docGenState.templateSets[i].id === setId) { setName = docGenState.templateSets[i].name; break; }
      }
      manageSetDocuments(setId, setName);
      // Refresh the tab to update document counts
      if (currentMatterData) renderDocGenerationTab(currentMatterData.matter);
    } catch (err) {
      Lex.Toast.error('Failed to add document: ' + (err.message || 'Unknown error'));
    }
  }

  /**
   * Remove a document from a template set.
   */
  async function removeDocFromSet(setId, docId, btnEl) {
    try {
      await api.delete('/api/v1/generation-template-sets/' + setId + '/documents/' + docId);
      // Remove the row from DOM
      var row = btnEl.closest('[data-doc-id]');
      if (row) row.remove();
      Lex.Toast.success('Document removed');
      // Refresh the tab to update document counts
      if (currentMatterData) renderDocGenerationTab(currentMatterData.matter);
    } catch (err) {
      Lex.Toast.error('Failed to remove document: ' + (err.message || 'Unknown error'));
    }
  }

  // =========================================================================
  // Document Generation - Generate & Stream
  // =========================================================================

  async function submitDocGeneration(event) {
    event.preventDefault();
    if (!currentMatterData || docGenState.isGenerating) return;

    var matter = currentMatterData.matter;
    var docType = (document.getElementById('dgDocType') || {}).value;
    var instructions = (document.getElementById('dgInstructions') || {}).value;
    var contactName = (document.getElementById('dgContact') || {}).value;
    var useStream = document.getElementById('dgStream') ? document.getElementById('dgStream').checked : true;

    if (!docType || !instructions) {
      Lex.Toast.error('Please select a document type and provide instructions');
      return;
    }

    // Collect custom variables
    var customVars = {};
    var varContainer = document.getElementById('dgCustomVars');
    if (varContainer) {
      var keyInputs = varContainer.querySelectorAll('[data-var-key]');
      var valInputs = varContainer.querySelectorAll('[data-var-val]');
      for (var i = 0; i < keyInputs.length; i++) {
        var k = keyInputs[i].value.trim();
        if (k && valInputs[i]) {
          customVars[k] = valInputs[i].value;
        }
      }
    }

    // Check if a template set was selected
    var templateSetId = null;
    var selectEl = document.getElementById('dgDocType');
    if (selectEl && selectEl.selectedIndex >= 0) {
      var opt = selectEl.options[selectEl.selectedIndex];
      if (opt && opt.getAttribute('data-set-id')) {
        templateSetId = opt.getAttribute('data-set-id');
      }
    }

    var payload = {
      document_type: docType,
      instructions: instructions,
      stream: useStream
    };
    if (contactName) payload.target_contact_name = contactName;
    if (templateSetId) payload.template_set_id = templateSetId;
    if (Object.keys(customVars).length > 0) payload.custom_variables = customVars;

    docGenState.isGenerating = true;
    docGenState.generatedContent = '';
    docGenState.currentArtifact = null;

    // Disable submit button
    var submitBtn = document.getElementById('dgSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;

    if (useStream) {
      await streamDocGeneration(matter.matter_id, payload);
    } else {
      await nonStreamDocGeneration(matter.matter_id, payload);
    }

    docGenState.isGenerating = false;
    if (submitBtn) submitBtn.disabled = false;
  }

  async function streamDocGeneration(matterId, payload) {
    // Open the output modal
    var modal = document.getElementById('docGenOutputModal');
    var progressArea = document.getElementById('docGenProgressArea');
    var progressText = document.getElementById('docGenProgressText');
    var progressBar = document.getElementById('docGenProgressBar');
    var outputContent = document.getElementById('docGenOutputContent');
    var artifactInfo = document.getElementById('docGenArtifactInfo');

    if (modal) modal.open = true;
    if (progressArea) progressArea.classList.remove('hidden');
    if (progressText) progressText.textContent = 'Generating...';
    if (progressBar) progressBar.style.width = '0%';
    if (outputContent) outputContent.innerHTML = '<p class="text-sm text-gray-400">Waiting for content...</p>';
    if (artifactInfo) artifactInfo.textContent = '';

    try {
      var token = (window.api && window.api.token) ? window.api.token : '';
      var baseUrl = (window.api && window.api.baseUrl) ? window.api.baseUrl : '';
      var response = await fetch(baseUrl + '/api/v1/matters/' + matterId + '/generate-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        var errText = '';
        try { errText = await response.text(); } catch (e) {}
        throw new Error('Generation failed: ' + response.status + ' ' + errText);
      }

      var reader = response.body.getReader();
      docGenState.activeReader = reader;
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var readResult = await reader.read();
        if (readResult.done) break;

        buffer += decoder.decode(readResult.value, { stream: true });

        // Parse SSE events from buffer (no regex — string methods only)
        var events = parseSSEBuffer(buffer);
        buffer = events.remainder;

        for (var i = 0; i < events.parsed.length; i++) {
          handleSSEEvent(events.parsed[i], outputContent, progressText, progressBar, progressArea, artifactInfo);
        }
      }

      docGenState.activeReader = null;
    } catch (err) {
      docGenState.activeReader = null;
      if (progressArea) progressArea.classList.add('hidden');
      if (outputContent) {
        outputContent.innerHTML = '<div class="text-red-600 text-sm p-4 bg-red-50 rounded-lg">' +
          '<p class="font-medium">Generation Error</p>' +
          '<p class="mt-1">' + escapeHtml(err.message || 'Unknown error') + '</p>' +
        '</div>';
      }
    }
  }

  function parseSSEBuffer(buffer) {
    var parsed = [];
    var currentEvent = null;
    var lines = buffer.split('\n');
    var remainder = '';

    // Check if buffer ends with a complete event (double newline)
    var endsComplete = buffer.indexOf('\n\n') !== -1;
    if (!endsComplete) {
      // Buffer doesn't contain a complete event yet
      return { parsed: [], remainder: buffer };
    }

    // Split on double newlines to get event blocks
    var blocks = [];
    var blockStart = 0;
    for (var i = 0; i < buffer.length - 1; i++) {
      if (buffer.charAt(i) === '\n' && buffer.charAt(i + 1) === '\n') {
        blocks.push(buffer.substring(blockStart, i));
        blockStart = i + 2;
      }
    }
    remainder = buffer.substring(blockStart);

    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b].trim();
      if (!block) continue;

      var eventType = 'message';
      var eventData = '';
      var blockLines = block.split('\n');

      for (var l = 0; l < blockLines.length; l++) {
        var line = blockLines[l];
        if (line.indexOf('event: ') === 0) {
          eventType = line.substring(7).trim();
        } else if (line.indexOf('data: ') === 0) {
          eventData = line.substring(6);
        }
      }

      if (eventData) {
        try {
          var dataObj = JSON.parse(eventData);
          parsed.push({ type: eventType, data: dataObj });
        } catch (e) {
          // Not valid JSON, treat as raw string
          parsed.push({ type: eventType, data: eventData });
        }
      }
    }

    return { parsed: parsed, remainder: remainder };
  }

  function handleSSEEvent(event, outputEl, progressText, progressBar, progressArea, artifactInfo) {
    switch (event.type) {
      case 'content':
        var chunk = typeof event.data === 'string' ? event.data : (event.data.content || event.data.chunk || '');
        docGenState.generatedContent += chunk;
        if (outputEl) {
          renderStreamedContent(outputEl, docGenState.generatedContent);
        }
        break;

      case 'progress':
        var pct = event.data.percent || event.data.progress || 0;
        var msg = event.data.message || event.data.stage || 'Generating...';
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressText) progressText.textContent = msg;
        break;

      case 'complete':
        if (progressArea) progressArea.classList.add('hidden');
        if (event.data && event.data.artifact) {
          docGenState.currentArtifact = event.data.artifact;
          if (artifactInfo) {
            artifactInfo.textContent = 'Saved as: ' + (event.data.artifact.artifact_name || 'Document') + ' (v' + (event.data.artifact.version || 1) + ')';
          }
        }
        // Final render
        if (outputEl) renderStreamedContent(outputEl, docGenState.generatedContent);
        break;

      case 'error':
        if (progressArea) progressArea.classList.add('hidden');
        var errMsg = typeof event.data === 'string' ? event.data : (event.data.message || 'Generation error');
        if (outputEl) {
          outputEl.innerHTML += '<div class="text-red-600 text-sm p-4 bg-red-50 rounded-lg mt-4">' +
            '<p class="font-medium">Error</p><p class="mt-1">' + escapeHtml(errMsg) + '</p></div>';
        }
        break;

      case 'done':
        // Stream completed
        break;
    }
  }

  function renderStreamedContent(el, fullText) {
    if (!el) return;
    // Use marked.parse if available (loaded for matter notes), else escape and use pre
    if (window.marked && window.marked.parse) {
      el.innerHTML = window.marked.parse(fullText);
    } else {
      el.innerHTML = '<pre class="whitespace-pre-wrap text-sm">' + escapeHtml(fullText) + '</pre>';
    }
  }

  async function nonStreamDocGeneration(matterId, payload) {
    try {
      var result = await api.post('/api/v1/matters/' + matterId + '/generate-document', payload);
      var data = result && result.data ? result.data : result;
      docGenState.generatedContent = data.content || '';
      docGenState.currentArtifact = data.artifact || null;

      // Open modal with content
      var modal = document.getElementById('docGenOutputModal');
      var outputContent = document.getElementById('docGenOutputContent');
      var artifactInfo = document.getElementById('docGenArtifactInfo');
      var progressArea = document.getElementById('docGenProgressArea');

      if (modal) modal.open = true;
      if (progressArea) progressArea.classList.add('hidden');
      if (outputContent) renderStreamedContent(outputContent, docGenState.generatedContent);
      if (artifactInfo && data.artifact) {
        artifactInfo.textContent = 'Saved as: ' + (data.artifact.artifact_name || 'Document') + ' (v' + (data.artifact.version || 1) + ')';
      }
    } catch (err) {
      Lex.Toast.error('Generation failed: ' + (err.message || 'Unknown error'));
    }
  }

  // =========================================================================
  // Document Generation - Output Modal Helpers
  // =========================================================================

  function copyGeneratedContent() {
    if (!docGenState.generatedContent) {
      Lex.Toast.error('No content to copy');
      return;
    }
    try {
      navigator.clipboard.writeText(docGenState.generatedContent);
      Lex.Toast.success('Copied to clipboard');
    } catch (e) {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = docGenState.generatedContent;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      Lex.Toast.success('Copied to clipboard');
    }
  }

  function closeDocGenOutputModal() {
    var modal = document.getElementById('docGenOutputModal');
    if (modal) modal.open = false;
    // Abort any active stream
    if (docGenState.activeReader) {
      try { docGenState.activeReader.cancel(); } catch (e) {}
      docGenState.activeReader = null;
    }
  }

  // =========================================================================
  // Document Generation - Window Globals
  // =========================================================================

  window.renderDocGenerationTab = renderDocGenerationTab;
  window.analyzeDocumentStructure = analyzeDocumentStructure;
  window.openTemplateSetModal = openTemplateSetModal;
  window.closeTemplateSetModal = closeTemplateSetModal;
  window.saveTemplateSet = saveTemplateSet;
  window.editTemplateSet = editTemplateSet;
  window.deleteTemplateSet = deleteTemplateSet;
  window.analyzeTemplateSet = analyzeTemplateSet;
  window.manageSetDocuments = manageSetDocuments;
  window.addDocToSet = addDocToSet;
  window.removeDocFromSet = removeDocFromSet;
  window.submitDocGeneration = submitDocGeneration;
  window.addDocGenCustomVar = addDocGenCustomVar;
  window.removeDocGenCustomVar = removeDocGenCustomVar;
  window.copyGeneratedContent = copyGeneratedContent;
  window.closeDocGenOutputModal = closeDocGenOutputModal;

  ['renderDocGenerationTab', 'analyzeDocumentStructure',
   'openTemplateSetModal', 'closeTemplateSetModal', 'saveTemplateSet',
   'editTemplateSet', 'deleteTemplateSet', 'analyzeTemplateSet',
   'manageSetDocuments', 'addDocToSet', 'removeDocFromSet',
   'submitDocGeneration', 'addDocGenCustomVar', 'removeDocGenCustomVar',
   'copyGeneratedContent', 'closeDocGenOutputModal'].forEach(_trackGlobal);

  // =========================================================================
  // Analytics Tab
  // =========================================================================

  var _analyticsLoaded = false;

  function _buildMatterAnalyticsPlaceholders() {
    var html = '';
    for (var i = 0; i < 7; i++) {
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:0.5rem;padding:1rem;">';
      html += '<div style="height:0.75rem;width:60%;background:#e5e7eb;border-radius:0.25rem;margin-bottom:0.5rem;"></div>';
      html += '<div style="height:1.5rem;width:40%;background:#e5e7eb;border-radius:0.25rem;"></div>';
      html += '</div>';
    }
    return html;
  }

  function _renderMatterAnalyticsCards(data) {
    var cardsEl = document.getElementById('matterAnalyticsCards');
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
      var lastDate = new Date(data.last_activity_at);
      var now = new Date();
      var daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
      var timeAgo = daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : String(daysSince) + ' days ago';
      html += '<div style="background:white;border:1px solid #e5e7eb;border-radius:0.5rem;padding:1rem;">';
      html += '<p style="font-size:0.75rem;color:#6b7280;margin:0 0 0.25rem 0;">Last Activity</p>';
      html += '<p style="font-size:1.5rem;font-weight:600;margin:0;color:#111827;">' + escapeHtml(timeAgo) + '</p>';
      html += '</div>';
    }

    cardsEl.innerHTML = html;
  }

  function renderMatterAnalyticsTab(matter) {
    var cardsEl = document.getElementById('matterAnalyticsCards');
    var emptyEl = document.getElementById('matterAnalyticsEmpty');
    var errorEl = document.getElementById('matterAnalyticsError');
    if (!cardsEl) return;

    // Only fetch once per page load; subsequent tab switches show cached content
    if (_analyticsLoaded) return;
    _analyticsLoaded = true;

    if (emptyEl) emptyEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    cardsEl.style.display = 'grid';

    // Show skeleton placeholders while loading
    cardsEl.innerHTML = _buildMatterAnalyticsPlaceholders();

    var matterId = matter && matter.matter_id;
    if (!matterId) {
      cardsEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = '';
      _analyticsLoaded = false;
      return;
    }

    api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/analytics')
      .then(function (response) {
        var data = (response && response.data) ? response.data : response;
        _renderMatterAnalyticsCards(data);
      })
      .catch(function (err) {
        console.error('[workspace-details] Failed to load matter analytics:', err);
        cardsEl.style.display = 'none';
        if (errorEl) errorEl.style.display = '';
        // Reset flag so user can retry by leaving and re-entering the tab
        _analyticsLoaded = false;
      });
  }

  // =========================================================================
  // Window Globals (for onclick handlers in HTML)
  // =========================================================================

  window.switchMatterTab = switchMatterTab;
  window.switchDockPanel = switchDockPanel;
  window.toggleSection = toggleSection;
  window.refreshCurrentMatter = refreshCurrentMatter;
  window.getCurrentActiveTab = getCurrentActiveTab;
  window.currentMatterData = currentMatterData;

  ['switchMatterTab', 'switchDockPanel', 'toggleSection', 'refreshCurrentMatter',
   'getCurrentActiveTab', 'currentMatterData'].forEach(_trackGlobal);

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async function onEnter() {
    _preInitKeys = new Set(Object.keys(window));

    // Use the global API client (set by api.js as window.api)
    api = window.api;

    // Read matter ID — try multiple sources:
    // 1. URL/history.state params (normal navigation)
    // 2. Lex.Nav context (fallback — survives history.state timing issues)
    // 3. sessionStorage (survives app restart)
    var params = Lex.Nav.getParams();
    var matterId = params.get('id');
    var defaultTab = params.get('tab') || 'activity';
    var openFileId = params.get('open_file') || null;

    // Consume context (one-shot read from Lex.Nav.go context param)
    var ctx = Lex.Nav.consume();
    _navContext = ctx;

    // Fallback: read matterId from context if params didn't have it
    if (!matterId && ctx && ctx.matterId) {
      matterId = ctx.matterId;
      defaultTab = ctx.tab || defaultTab;
    }

    // Fallback 2: check sessionStorage (persists across router timing gaps)
    if (!matterId) {
      try {
        var stored = sessionStorage.getItem('_lex_matter_detail_id');
        if (stored) {
          matterId = stored;
        }
      } catch (e) {}
    }

    if (!matterId) {
      console.warn('[workspace-details] No matterId found — redirecting to workspaces.html');
      Lex.Nav.go('workspaces.html');
      return;
    }

    // Persist matterId so it survives page refresh / router timing issues
    try { sessionStorage.setItem('_lex_matter_detail_id', matterId); } catch (e) {}

    // Apply redacted shimmer to all page sections
    redactPage(true);

    // Load all data
    await loadMatterDetails(matterId);

    if (!currentMatterData) {
      console.error('[workspace-details] Data load failed for:', matterId);
      redactPage(false);
      return;
    }

    // Render banner + header
    renderBanner(currentMatterData.matter);
    renderDescription(currentMatterData.matter);
    setupHeaderActions(currentMatterData.matter);

    // Render dock panels
    renderDockDetailsPanel(currentMatterData.matter, currentMatterData.permissions);
    renderDockContextPanel(currentMatterData.matter);
    switchDockPanel('details');

    // Render default tab
    switchMatterTab(defaultTab);

    // Remove redacted shimmer
    redactPage(false);

    // Auto-open file viewer if open_file param was passed (e.g. from dashboard)
    if (openFileId) {
      _timeouts.push(setTimeout(function () { _navToFileViewer(openFileId); }, 100));
    }
  }

  function onLeave() {
    // 1. Close any open lex-modals (check both in-page and hoisted)
    try {
      document.querySelectorAll('lex-modal[open]').forEach(function (el) {
        el.open = false;
      });
    } catch (e) {}

    // 2. Clear sessionStorage matter ID (prevent stale navigation on restart)
    try { sessionStorage.removeItem('_lex_matter_detail_id'); } catch (e) {}

    // 2b. Reset tab indicator
    _tabIndicatorInitialized = false;

    // 3. Restore body scroll
    document.body.style.overflow = '';

    // 3. Remove tracked document-level listeners
    _documentListeners.forEach(function (entry) {
      document.removeEventListener(entry.event, entry.handler);
    });
    _documentListeners = [];

    // 4. Clear tracked intervals
    _intervals.forEach(clearInterval);
    _intervals = [];

    // 5. Clear tracked timeouts
    _timeouts.forEach(clearTimeout);
    _timeouts = [];

    // 6. Delete window globals added during init
    if (_preInitKeys) {
      var currentKeys = Object.keys(window);
      for (var i = 0; i < currentKeys.length; i++) {
        if (!_preInitKeys.has(currentKeys[i])) {
          try { delete window[currentKeys[i]]; } catch (e) {}
        }
      }
      _preInitKeys = null;
    }

    // 7. Clean tracked globals
    _windowKeys.forEach(function (name) { delete window[name]; });
    _windowKeys = [];

    // 8. Destroy external module instances
    if (typeof destroyMatterNotes === 'function') {
      try { destroyMatterNotes(); } catch (e) {}
    }

    // 9. Clean up persistent window state
    try {
      delete window.currentViewedMatter;
      delete window.currentMatterData;
    } catch (e) {}

    // 10. Clear active matter context
    if (window.Lex && window.Lex.state) {
      try { window.Lex.state.setActiveMatter(null); } catch (e) {}
    }

    // 11. Abort any active document generation stream
    if (docGenState && docGenState.activeReader) {
      try { docGenState.activeReader.cancel(); } catch (e) {}
    }

    // 12. Clear state
    currentMatterData = null;
    currentTaskMatterId = null;
    currentEditingTask = null;
    currentTasksList = [];
    _docPage = 1;
    _docSearch = '';
    clearTimeout(_docSearchTimeout);
    _docSearchTimeout = null;
    docGenState = {
      documentTypes: [], templateSets: [], contacts: [],
      isGenerating: false, isAnalyzing: false, generatedContent: '',
      currentArtifact: null, activeReader: null, customVarCount: 0
    };
    api = null;
  }

  // ── Init — standalone page, called directly ────────────────────────
  onEnter();

})();

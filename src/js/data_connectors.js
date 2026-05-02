/**
 * data_connectors.js — Data Connectors page script.
 * Standalone page with <lex-app> shell.
 *
 * Dependencies (loaded before this file in data-connectors.html):
 *   - connectors.js  (Lex.Connectors, Lex.ConnectorRegistry, Lex.ConnectorsMockData)
 *
 * Available from shell scripts:
 *   - Lex.Toast      (toast notifications)
 *   - Lex.Utils      (timeAgo, escapeHtml, etc.)
 *   - api            (HTTP client, auth, baseUrl)
 */
(function () {
  'use strict';

  // ── Lifecycle tracking ──────────────────────────────────────────────
  var _intervals = [];
  var _timeouts = [];
  var _globalFns = [];
  var _documentListeners = [];

  /**
   * Register a window global and track it for cleanup on onLeave.
   */
  function exposeGlobal(name, fn) {
    window[name] = fn;
    _globalFns.push(name);
  }

  /**
   * Add a document-level event listener and track it for cleanup on onLeave.
   */
  function trackDocListener(event, handler) {
    document.addEventListener(event, handler);
    _documentListeners.push({ event: event, handler: handler });
  }

  // ── Page state ──────────────────────────────────────────────────────
  var allConnectors = [];
  var allAvailableConnectors = [];
  var currentInstalledConnectors = [];
  var selectedConnectorForActions = null;
  var _suppressActionsClose = false;
  var selectedConnectorFile = null;
  var parsedConnectorConfig = null;
  var importTargetConnectorId = null;
  var importTargetConnectorName = null;
  var searchTimeout = null;
  var pinnedConnectorsStorageKey = 'lana_automation_pinned_connectors';
  var pinnedConnectors = loadPinnedConnectors();
  var connectorsCurrentPage = 1;
  var connectorsPageSize = 12;
  var connectorsSortKey = 'status';
  var connectorsSortDirection = 'asc';
  var connectorsFilteredCount = 0;

  function resetState() {
    allConnectors = [];
    allAvailableConnectors = [];
    currentInstalledConnectors = [];
    selectedConnectorForActions = null;
    _suppressActionsClose = false;
    selectedConnectorFile = null;
    parsedConnectorConfig = null;
    importTargetConnectorId = null;
    importTargetConnectorName = null;
    pinnedConnectors = loadPinnedConnectors();
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    connectorsCurrentPage = 1;
    connectorsSortKey = 'status';
    connectorsSortDirection = 'asc';
    connectorsFilteredCount = 0;
  }

  // ── Static data ─────────────────────────────────────────────────────

  var STATIC_SYSTEM_CONNECTORS = [
    {
      id: 'case-actionstep',
      connector_type: 'case-actionstep',
      name: 'ActionStep Integration',
      description: 'Integrate with ActionStep legal practice management software to sync matters, contacts, documents, and billing information. Streamline your legal workflow with automated data synchronization.',
      category: 'case_management',
      vendor: 'ActionStep',
      auth_type: 'api_key',
      capabilities: ['matter_sync', 'contact_sync', 'document_sync', 'billing_integration', 'task_management'],
      tags: ['legal', 'practice management', 'case management', 'billing'],
      documentation_url: 'https://www.actionstep.com/api-documentation',
      status: 'disconnected',
      records: 0,
      lastSync: null
    },
    {
      id: 'crm-leadly',
      connector_type: 'crm-leadly',
      name: 'Leadly CRM',
      description: 'Connect with Leadly CRM to sync leads, contacts, and opportunities. Automate your sales pipeline and maintain up-to-date customer information across platforms.',
      category: 'crm',
      vendor: 'Leadly',
      auth_type: 'api_key',
      capabilities: ['lead_sync', 'contact_sync', 'opportunity_tracking', 'pipeline_management'],
      tags: ['crm', 'sales', 'lead management'],
      documentation_url: null,
      status: 'disconnected',
      records: 0,
      lastSync: null
    }
  ];

  var SYSTEM_INTEGRATION_DEFAULTS = {
    'case-actionstep': STATIC_SYSTEM_CONNECTORS[0],
    'crm-leadly': STATIC_SYSTEM_CONNECTORS[1]
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  function loadPinnedConnectors() {
    if (typeof localStorage === 'undefined') return [];
    try {
      var raw = JSON.parse(localStorage.getItem(pinnedConnectorsStorageKey) || '[]');
      return Array.isArray(raw) ? raw.filter(function (id) { return typeof id === 'string' && id; }) : [];
    } catch (error) {
      return [];
    }
  }

  function savePinnedConnectors() {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(pinnedConnectorsStorageKey, JSON.stringify(pinnedConnectors));
  }

  function findConnectorById(connectorId) {
    var target = String(connectorId || '');
    var normalizedTarget = target.toLowerCase().replace(/[\s_]+/g, '-').trim();
    return allConnectors.find(function (c) {
      var fields = [
        c.id,
        c.connector_id,
        c.connector_type,
        c.source_type,
        c.type
      ];
      if (fields.some(function (field) { return field != null && String(field) === target; })) return true;

      var name = c.name || c.connector_name || c.source_name || (c.metadata && c.metadata.name) || '';
      return name && String(name).toLowerCase().replace(/[\s_]+/g, '-').trim() === normalizedTarget;
    });
  }

  function getConnectorWithDefaults(connector) {
    var possibleIds = [
      connector.connector_type,
      connector.connector_id,
      connector.id,
      connector.name ? connector.name.toLowerCase().split(' ').join('-') : null
    ].filter(Boolean);

    var defaults = null;
    for (var i = 0; i < possibleIds.length; i++) {
      if (SYSTEM_INTEGRATION_DEFAULTS[possibleIds[i]]) {
        defaults = SYSTEM_INTEGRATION_DEFAULTS[possibleIds[i]];
        break;
      }
    }

    if (defaults) {
      return Object.assign({}, defaults, connector, {
        id: connector.id,
        connector_type: connector.connector_type || Object.keys(SYSTEM_INTEGRATION_DEFAULTS).find(function (k) {
          return SYSTEM_INTEGRATION_DEFAULTS[k] === defaults;
        }),
        description: connector.description || connector.connector_description || defaults.description,
        category: (connector.category && connector.category !== 'unknown') ? connector.category : defaults.category,
        vendor: connector.vendor || defaults.vendor,
        auth_type: (connector.auth_type && connector.auth_type !== 'unknown') ? connector.auth_type : defaults.auth_type,
        capabilities: (connector.capabilities && connector.capabilities.length > 0) ? connector.capabilities : defaults.capabilities,
        tags: (connector.tags && connector.tags.length > 0) ? connector.tags : defaults.tags,
        documentation_url: connector.documentation_url || defaults.documentation_url
      });
    }

    return connector;
  }

  function formatText(text) {
    if (!text) return '';
    return text
      .split('_').join(' ')
      .split(' ')
      .map(function (word) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    var k = 1024;
    var sizes = ['Bytes', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  function formatAuthType(authType) {
    var authTypeMap = {
      'oauth2': 'OAuth 2.0',
      'api_key': 'API Key',
      'basic': 'Basic Auth'
    };
    return authTypeMap[authType] || formatText(authType);
  }

  function connectorIdentity(connector) {
    connector = connector || {};
    return String(
      connector.connector_id ||
      connector.connector_type ||
      connector.id ||
      connector.name ||
      ''
    ).toLowerCase();
  }

  function getConnectorPinKey(connector) {
    var normalized = normalizeConnector(connector);
    return normalized.id || normalized.raw.connector_id || normalized.raw.connector_type || normalized.name || '';
  }

  function isConnectorPinned(connector) {
    var key = getConnectorPinKey(connector);
    return !!key && pinnedConnectors.indexOf(key) !== -1;
  }

  function toggleConnectorPin(connectorId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    var connector = findConnectorById(connectorId);
    if (!connector) return;

    var key = getConnectorPinKey(connector);
    var index = pinnedConnectors.indexOf(key);
    if (index === -1) {
      pinnedConnectors = pinnedConnectors.concat(key);
    } else {
      pinnedConnectors = pinnedConnectors.filter(function (id) { return id !== key; });
    }
    savePinnedConnectors();
    filterAvailableConnectors();
  }

  function normalizeConnector(connector) {
    connector = getConnectorWithDefaults(connector || {});

    var manifest = connector.manifest || {};
    var id = connector.id || connector.connector_id || connector.connector_type || 'unknown';

    return {
      raw: connector,
      id: id,
      identity: connectorIdentity(connector),
      name: manifest.name || connector.name || connector.connector_name || 'Unknown Connector',
      description: manifest.description || connector.description || connector.connector_description || '',
      status: String(connector.status || connector.auth_status || '').toLowerCase(),
      category: manifest.category || connector.category || connector.connector_category || 'unknown',
      vendor: manifest.vendor || connector.vendor || '',
      auth_type: connector.auth_type || connector.authType || 'unknown',
      version: connector.version || manifest.version || '1.0.0',
      logo_url: manifest.icon || connector.logo_url || connector.logo || connector.icon || null,
      tags: connector.tags || [],
      ui_entry_point: connector.ui_entry_point || null,
      ui_layout_id: connector.ui_layout_id || null,
      hasCustomUI: !!(connector.ui_entry_point && connector.manifest)
    };
  }

  function getConnectorStatusKey(connector, installedConnectors) {
    var normalized = normalizeConnector(connector);
    var rawStatus = normalized.status;

    if (rawStatus === 'connected' || rawStatus === 'active') return 'connected';
    if (rawStatus === 'syncing') return 'syncing';
    if (rawStatus === 'error') return 'error';
    if (rawStatus === 'coming_soon') return 'coming_soon';
    if (rawStatus === 'installed') return 'installed';

    var installed = installedConnectors || currentInstalledConnectors;
    if (ConnectorRegistry.isConnectorInstalled(normalized.id, installed) && rawStatus !== 'disconnected') {
      return 'installed';
    }

    return 'available';
  }

  function getConnectorStatusBadge(connector, installedConnectors) {
    var status = getConnectorStatusKey(connector, installedConnectors);
    var statusBadgeMap = {
      connected:   { color: 'green',  label: 'Connected' },
      installed:   { color: 'blue',   label: 'Installed' },
      available:   { color: 'gray',   label: 'Available' },
      syncing:     { color: 'blue',   label: 'Syncing' },
      error:       { color: 'red',    label: 'Error' },
      coming_soon: { color: 'yellow', label: 'Coming Soon' }
    };
    return statusBadgeMap[status] || statusBadgeMap.available;
  }

  function getConnectorSortValue(connector, key) {
    var normalized = normalizeConnector(connector);
    var statusRank = {
      connected: 0,
      installed: 1,
      available: 2,
      syncing: 3,
      error: 4,
      coming_soon: 5
    };

    if (key === 'status') {
      var statusKey = getConnectorStatusKey(connector, currentInstalledConnectors);
      return statusRank[statusKey] === undefined ? 99 : statusRank[statusKey];
    }
    if (key === 'category') return normalized.category || '';
    if (key === 'auth') return normalized.auth_type || '';
    if (key === 'version') return normalized.version || '';
    return normalized.name || '';
  }

  function sortConnectors(connectors) {
    return connectors.slice().sort(function (a, b) {
      var aVal = getConnectorSortValue(a, connectorsSortKey);
      var bVal = getConnectorSortValue(b, connectorsSortKey);
      var direction = connectorsSortDirection === 'desc' ? -1 : 1;
      var aPinned = isConnectorPinned(a);
      var bPinned = isConnectorPinned(b);

      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      if (aVal < bVal) return -1 * direction;
      if (aVal > bVal) return 1 * direction;

      var aName = normalizeConnector(a).name.toLowerCase();
      var bName = normalizeConnector(b).name.toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });
  }

  function updateSortIndicators() {
    var indicators = document.querySelectorAll('[data-sort-indicator]');
    indicators.forEach(function (indicator) {
      var key = indicator.getAttribute('data-sort-indicator');
      indicator.textContent = key === connectorsSortKey
        ? (connectorsSortDirection === 'asc' ? '↑' : '↓')
        : '';
    });
  }

  function buildCombinedConnectorList(installedConnectors, catalogConnectors) {
    var combined = [];
    var seen = new Set();

    function addConnector(connector) {
      if (!connector) return;
      var key = connectorIdentity(connector);
      if (!key || seen.has(key)) return;
      seen.add(key);
      combined.push(connector);
    }

    installedConnectors.forEach(addConnector);
    (catalogConnectors || []).forEach(addConnector);
    return combined;
  }

  function escapeHtml(value) {
    return Lex.Utils.escapeHtml(String(value == null ? '' : value));
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function getConnectorAction(connector, installedConnectors) {
    var status = getConnectorStatusKey(connector, installedConnectors);

    if (status === 'coming_soon') return 'details';
    if (status === 'available') return 'install';
    return 'open';
  }

  function handleConnectorRowSelection(connectorId) {
    var connector = findConnectorById(connectorId);
    if (!connector) return;

    if (getConnectorStatusKey(connector, currentInstalledConnectors) === 'coming_soon') {
      showConnectorDetails(connectorId, null);
      return;
    }

    openConnectorManage(connectorId);
  }

  function getConnectorUpdateSlug(connector) {
    var normalized = normalizeConnector(connector);
    return normalized.raw.connector_id || '';
  }

  function openConnectorUpdateModal(connectorId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    var connector = findConnectorById(connectorId);
    if (!connector) return;
    var normalized = normalizeConnector(connector);
    var slug = getConnectorUpdateSlug(connector);
    if (!slug) return;

    openImportConnectorModal({
      targetConnectorId: slug,
      targetConnectorName: normalized.name
    });
  }

  // ── Card rendering ──────────────────────────────────────────────────

  function renderConnectorCard(connector) {
    connector = getConnectorWithDefaults(connector);

    var hasCustomUI = !!(connector.ui_entry_point && connector.manifest);
    var manifest = connector.manifest || {};

    var normalizedConnector = {
      id: connector.id || connector.connector_id || 'unknown',
      name: manifest.name || connector.name || connector.connector_name || 'Unknown Connector',
      description: manifest.description || connector.description || connector.connector_description || 'No description available',
      status: connector.status || connector.auth_status || 'disconnected',
      category: manifest.category || connector.category || connector.connector_category || 'unknown',
      records: connector.records || connector.total_records || 0,
      lastSync: connector.lastSync || connector.last_sync || connector.last_sync_at || null,
      logo_url: manifest.icon || connector.logo_url || connector.logo || connector.icon || null,
      vendor: manifest.vendor || connector.vendor || null,
      auth_type: connector.auth_type || 'unknown',
      capabilities: connector.capabilities || [],
      tags: connector.tags || [],
      documentation_url: connector.documentation_url || null,
      ui_entry_point: connector.ui_entry_point || null,
      ui_layout_id: connector.ui_layout_id || null
    };

    /**
     * Map connector status values to lex-badge color and label.
     * Valid colors: gray | green | red | yellow | blue | indigo
     */
    var statusBadgeMap = {
      connected:    { color: 'green',  label: 'Connected' },
      active:       { color: 'green',  label: 'Active' },
      installed:    { color: 'blue',   label: 'Installed' },
      disconnected: { color: 'gray',   label: 'Disconnected' },
      error:        { color: 'red',    label: 'Error' },
      syncing:      { color: 'blue',   label: 'Syncing' },
      coming_soon:  { color: 'yellow', label: 'Coming Soon' }
    };

    var displayStatus = normalizedConnector.status;
    var badgeConfig = statusBadgeMap[displayStatus] || statusBadgeMap.disconnected;
    var isComingSoon = displayStatus === 'coming_soon';
    var isActive = displayStatus === 'connected' || displayStatus === 'active';
    var isInstalled = displayStatus === 'installed';

    var logoHtml = normalizedConnector.logo_url
      ? '<img src="' + normalizedConnector.logo_url + '" alt="' + normalizedConnector.name + '" class="w-10 h-10 object-contain" onerror="this.parentElement.innerHTML=\'<span class=\\\'text-lg font-bold\\\' style=\\\'color:var(--lex-text-disabled)\\\'>' + normalizedConnector.name.charAt(0) + '</span>\'">'
      : '<span class="text-lg font-bold" style="color:var(--lex-text-disabled)">' + normalizedConnector.name.charAt(0) + '</span>';

    var timeAgoStr = normalizedConnector.lastSync ? Lex.Utils.timeAgo(normalizedConnector.lastSync) : 'Never';

    var cardClick = '';
    if (!isComingSoon) {
      if (hasCustomUI) {
        cardClick = 'onclick="openCustomConnectorUI(\'' + normalizedConnector.ui_entry_point + '\', \'' + normalizedConnector.name + '\', \'' + normalizedConnector.id + '\', \'' + (normalizedConnector.connector_id || normalizedConnector.connector_type || '') + '\')"';
      } else {
        cardClick = 'onclick="openConnector(\'' + normalizedConnector.id + '\', \'' + normalizedConnector.category + '\')"';
      }
    }

    /** SVG icon used inside detail icon-only buttons. */
    var infoIconSvg = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';

    var buttonsHtml = '';
    if (isComingSoon) {
      buttonsHtml = '<lex-btn variant="ghost" size="sm" onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" style="width:100%">View Details</lex-btn>';
    } else if (isActive) {
      buttonsHtml = '<div class="flex gap-2">' +
        '<lex-btn variant="primary" size="sm" onclick="showConnectorActionsModal(\'' + normalizedConnector.id + '\'); event.stopPropagation();" style="flex:1">Manage</lex-btn>' +
        '<lex-btn variant="ghost" size="sm" icon="true" onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" aria-label="View details">' + infoIconSvg + '</lex-btn>' +
        '</div>';
    } else if (isInstalled) {
      buttonsHtml = '<div class="flex gap-2">' +
        '<lex-btn variant="primary" size="sm" onclick="showConnectorActionsModal(\'' + normalizedConnector.id + '\'); event.stopPropagation();" style="flex:1">Configure</lex-btn>' +
        '<lex-btn variant="ghost" size="sm" icon="true" onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" aria-label="View details">' + infoIconSvg + '</lex-btn>' +
        '</div>';
    } else {
      buttonsHtml = '<div class="flex gap-2">' +
        '<lex-btn variant="primary" size="sm" onclick="showConnectorActionsModal(\'' + normalizedConnector.id + '\'); event.stopPropagation();" style="flex:1">Connect</lex-btn>' +
        '<lex-btn variant="ghost" size="sm" icon="true" onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" aria-label="View details">' + infoIconSvg + '</lex-btn>' +
        '</div>';
    }

    var rowClick = isComingSoon ? '' : cardClick;

    return '<tr class="dc-row' + (isComingSoon ? ' opacity-60' : '') + '" tabindex="0" ' + rowClick + '>' +
      '<td>' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style="background:var(--lex-bg-tertiary)">' + logoHtml + '</div>' +
          '<div class="min-w-0">' +
            '<div class="font-semibold" style="color:var(--lex-text-primary)">' + normalizedConnector.name + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td>' + formatText(normalizedConnector.category) + '</td>' +
      '<td>' + formatAuthType(normalizedConnector.auth_type) + '</td>' +
      '<td><lex-badge color="' + badgeConfig.color + '" label="' + badgeConfig.label + '" size="sm"></lex-badge></td>' +
      '<td>' + ((isActive || isInstalled) ? timeAgoStr : 'Never') + '</td>' +
      '<td><div class="dc-row-actions">' + buttonsHtml + '</div></td>' +
    '</tr>';
  }

  function renderAvailableConnectorCard(connector, installedConnectors) {
    var normalized = normalizeConnector(connector);
    var statusKey = getConnectorStatusKey(connector, installedConnectors);
    var isComingSoon = statusKey === 'coming_soon';
    var action = getConnectorAction(connector, installedConnectors);
    var badgeConfig = getConnectorStatusBadge(connector, installedConnectors);
    var connectorId = normalized.id;
    var safeId = escapeAttribute(connectorId);
    var safeName = escapeAttribute(normalized.name);
    var pinKey = getConnectorPinKey(connector);
    var pinned = isConnectorPinned(connector);
    var pinLabel = pinned ? 'Unpin connector' : 'Pin connector to top';
    var pinIcon = pinned
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.39 6.96L22 9.27l-5.45 4.73L17.82 22 12 18.27 6.18 22l1.27-7.99L2 9.27l7.61-.31L12 2z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.39 6.96L22 9.27l-5.45 4.73L17.82 22 12 18.27 6.18 22l1.27-7.99L2 9.27l7.61-.31L12 2z"/></svg>';

    var logoHtml = normalized.logo_url
      ? '<img src="' + escapeAttribute(normalized.logo_url) + '" alt="' + safeName + '" class="w-10 h-10 object-contain" onerror="this.parentElement.innerHTML=\'<span class=\\\'text-lg font-bold\\\' style=\\\'color:var(--lex-text-accent)\\\'>' + escapeAttribute(normalized.name.charAt(0)) + '</span>\'">'
      : '<span class="text-lg font-bold" style="color:var(--lex-text-accent)">' + escapeHtml(normalized.name.charAt(0)) + '</span>';

    /** SVG icon used inside detail icon-only buttons. */
    var infoIconSvgAvail = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';

    var actionButton = '';
    if (action === 'install') {
      actionButton = '<div class="flex gap-2">' +
        '<lex-btn variant="primary" size="sm" onclick="installConnector(\'' + safeId + '\', event); event.stopPropagation();" style="flex:1">Set Up</lex-btn>' +
        '<lex-btn variant="ghost" size="sm" icon="true" onclick="showConnectorDetails(\'' + safeId + '\', event); event.stopPropagation();" aria-label="View details">' + infoIconSvgAvail + '</lex-btn>' +
        '</div>';
    } else if (action === 'details') {
      actionButton = '<lex-btn variant="ghost" size="sm" onclick="showConnectorDetails(\'' + safeId + '\', event); event.stopPropagation();" style="width:100%">View Details</lex-btn>';
    } else {
      actionButton = '<div class="flex gap-2">' +
        '<lex-btn variant="primary" size="sm" onclick="openConnectorManage(\'' + safeId + '\'); event.stopPropagation();" style="flex:1">Open</lex-btn>' +
        '<lex-btn variant="ghost" size="sm" icon="true" onclick="showConnectorDetails(\'' + safeId + '\', event); event.stopPropagation();" aria-label="View details">' + infoIconSvgAvail + '</lex-btn>' +
        '</div>';
    }

    var updateSlug = getConnectorUpdateSlug(connector);
    var updateIconSvg = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-3-6.7L21 8"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 3v5h-5"></path></svg>';
    var updateButton = updateSlug
      ? '<lex-btn variant="ghost" size="sm" icon="true" onclick="openConnectorUpdateModal(\'' + safeId + '\', event)" aria-label="Update ' + safeName + '" title="Update connector">' + updateIconSvg + '</lex-btn>'
      : '';

    return '<tr class="dc-row' + (isComingSoon ? ' opacity-75' : '') + '" data-connector-row="' + safeId + '" tabindex="0" role="button" aria-label="Open ' + safeName + '" onclick="handleConnectorRowSelection(\'' + safeId + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();handleConnectorRowSelection(\'' + safeId + '\')}">' +
      '<td class="dc-pin-cell">' +
        '<button type="button" class="dc-pin-btn' + (pinned ? ' is-pinned' : '') + '" onclick="toggleConnectorPin(\'' + escapeAttribute(pinKey) + '\', event)" aria-pressed="' + (pinned ? 'true' : 'false') + '" aria-label="' + escapeAttribute(pinLabel) + '" title="' + escapeAttribute(pinLabel) + '">' + pinIcon + '</button>' +
      '</td>' +
      '<td>' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style="background:var(--lex-bg-accent-muted)">' + logoHtml + '</div>' +
          '<div class="min-w-0">' +
            '<div class="font-semibold" style="color:var(--lex-text-primary)">' + escapeHtml(normalized.name) + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td>' + escapeHtml(formatText(normalized.category)) + '</td>' +
      '<td>' + escapeHtml(formatAuthType(normalized.auth_type)) + '</td>' +
      '<td><lex-badge color="' + badgeConfig.color + '" label="' + badgeConfig.label + '" size="sm"></lex-badge></td>' +
      '<td>' + escapeHtml(normalized.version ? 'v' + normalized.version : 'v1.0.0') + '</td>' +
      '<td><div class="dc-row-actions">' + actionButton + updateButton + '</div></td>' +
    '</tr>';
  }

  // ── Navigation ──────────────────────────────────────────────────────

  function buildConnectorManageUrl(connectorId) {
    var connector = findConnectorById(connectorId);
    // Prefer the catalog slug (connector_id) from integration_sources. Falls
    // back to the row id when the caller passed a slug directly.
    var connectorSlug = String(
      (connector && (connector.connector_id || connector.connector_type)) || connectorId || ''
    ).toLowerCase();

    var connectorName = String(connector && (connector.name || connector.connector_name || connector.source_name) || '').toLowerCase();
    var catalogConnectorId = connector
      ? (connector.connector_id || connector.connector_type || connector.source_type || connector.type || connectorId)
      : connectorId;

    if (connectorSlug === 'actionstep' || connectorSlug === 'case-actionstep' || connectorName.indexOf('actionstep') !== -1) {
      return 'integrations/actionstep.html?id=' + encodeURIComponent(connectorId) + '&chrome=embedded';
    }

    if (connectorSlug === 'leadly' || connectorSlug === 'crm-leadly' || connectorName.indexOf('leadly') !== -1) {
      return 'integrations/leadly.html?id=' + encodeURIComponent(connectorId) + '&chrome=embedded';
    }

    // Connector with custom UI — open in connector-viewer
    if (connector && connector.ui_entry_point) {
      return buildCustomConnectorUIUrl(
        connector.ui_entry_point,
        connector.name || 'Connector',
        connector.id || '',
        connector.connector_id || connector.connector_type || connector.id || ''
      );
    }

    return 'integrations/integration-config.html?id=' + encodeURIComponent(catalogConnectorId) + '&chrome=embedded';
  }

  function openConnectorManage(connectorId) {
    var connector = findConnectorById(connectorId);
    var url = buildConnectorManageUrl(connectorId);
    var connectorName = connector
      ? ((connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'Connector Dashboard')
      : 'Connector Dashboard';

    if (!url) return;
    openConnectorDashboardModal(url, connectorName);
  }

  function openConnector(connectorId, category) {
    openConnectorManage(connectorId);
  }

  function buildCustomConnectorUIUrl(uiEntryPoint, connectorName, sourceId, connectorType) {
    var params = new URLSearchParams({
      ui: uiEntryPoint,
      name: connectorName,
      connectorId: connectorType || sourceId || '',
      connectorType: connectorType || '',
      sourceId: sourceId || '',
      chrome: 'embedded'
    });

    return 'integrations/connector-viewer.html?' + params.toString();
  }

  function openCustomConnectorUI(uiEntryPoint, connectorName, sourceId, connectorType) {
    openConnectorDashboardModal(
      buildCustomConnectorUIUrl(uiEntryPoint, connectorName, sourceId, connectorType),
      connectorName || 'Connector Dashboard'
    );
  }

  function openConnectorDashboardModal(url, connectorName) {
    var modal = document.getElementById('connectorDashboardModal');
    var frame = document.getElementById('connectorDashboardFrame');
    var title = document.getElementById('connectorDashboardTitle');
    var urlEl = document.getElementById('connectorDashboardUrl');
    var openNewBtn = document.getElementById('connectorDashboardOpenNewBtn');

    if (!modal || !frame) return;

    if (title) title.textContent = connectorName || 'Connector Dashboard';
    if (urlEl) urlEl.textContent = url || '';
    if (openNewBtn) {
      openNewBtn.onclick = function () {
        window.open(url, '_blank', 'noopener,noreferrer');
      };
    }
    frame.src = url;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeConnectorDashboardModal() {
    var modal = document.getElementById('connectorDashboardModal');
    var frame = document.getElementById('connectorDashboardFrame');

    if (frame) frame.src = 'about:blank';
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ── Install connector ───────────────────────────────────────────────

  function installConnector(connectorId, evt) {
    var button = evt ? evt.target : null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Installing...';
    }

    ConnectorRegistry.installConnector(connectorId).then(function (result) {
      if (result.success) {
        Lex.Toast.success(connectorId + ' is ready to configure.');
        var tid = setTimeout(function () {
          openConnectorDashboardModal(
            'integrations/integration-config.html?id=' + encodeURIComponent(connectorId) + '&chrome=embedded',
            connectorId
          );
        }, 1000);
        _timeouts.push(tid);
      } else {
        Lex.Toast.error('Failed to install ' + connectorId);
      }
    }).catch(function (error) {
      console.error('Install error:', error);

      var errorMessage = error.message;
      if (errorMessage.includes('404')) {
        errorMessage = 'Connector catalog entry not found on the backend.';
      } else if (errorMessage.includes('fetch')) {
        errorMessage = 'Network error. Check your connection and try again.';
      }

      Lex.Toast.error('Setup failed: ' + errorMessage);

      if (button) {
        button.disabled = false;
        button.textContent = 'Set Up';
      }
    });
  }

  // ── Details modal ───────────────────────────────────────────────────

  function showConnectorDetails(connectorId, event) {
    if (event) event.stopPropagation();

    var connector = findConnectorById(connectorId);
    if (!connector) {
      console.error('Connector not found:', connectorId);
      return;
    }

    connector = getConnectorWithDefaults(connector);

    var nc = {
      id: connector.id || connector.connector_id || 'unknown',
      name: connector.name || connector.connector_name || 'Unknown Connector',
      description: connector.description || connector.connector_description || 'No description available',
      status: connector.status || connector.auth_status || 'disconnected',
      category: connector.category || connector.connector_category || 'unknown',
      logo_url: connector.logo_url || connector.logo || connector.icon || null,
      vendor: connector.vendor || null,
      auth_type: connector.auth_type || 'unknown',
      capabilities: connector.capabilities || [],
      tags: connector.tags || [],
      documentation_url: connector.documentation_url || null
    };

    document.getElementById('detailsName').textContent = nc.name;
    document.getElementById('detailsVendor').textContent = nc.vendor || '';

    var logoEl = document.getElementById('detailsLogo');
    if (nc.logo_url) {
      logoEl.innerHTML = '<img src="' + nc.logo_url + '" alt="' + nc.name + '" class="w-12 h-12 object-contain">';
    } else {
      logoEl.innerHTML = '<span class="text-2xl font-bold" style="color:var(--lex-text-disabled)">' + nc.name.charAt(0) + '</span>';
    }

    var contentParts = [];

    contentParts.push('<div><h4 class="font-semibold mb-2" style="color:var(--lex-text-primary)">Description</h4><p style="color:var(--lex-text-secondary)">' + nc.description + '</p></div>');
    contentParts.push('<div><h4 class="font-semibold mb-2" style="color:var(--lex-text-primary)">Category</h4><span class="inline-flex items-center px-3 py-1 rounded-full text-sm" style="background:var(--lex-status-neutral-bg);color:var(--lex-status-neutral-text)">' + formatText(nc.category) + '</span></div>');

    var authTypeLabel = nc.auth_type === 'oauth2' ? 'OAuth 2.0' :
                        nc.auth_type === 'api_key' ? 'API Key' :
                        formatText(nc.auth_type);
    var authStyle = nc.auth_type === 'oauth2'
      ? 'background:var(--lex-status-info-bg);color:var(--lex-status-info-text)'
      : nc.auth_type === 'api_key'
        ? 'background:var(--lex-bg-accent-muted);color:var(--lex-text-accent)'
        : 'background:var(--lex-status-neutral-bg);color:var(--lex-status-neutral-text)';
    contentParts.push('<div><h4 class="font-semibold mb-2" style="color:var(--lex-text-primary)">Authentication</h4><span class="inline-flex items-center px-3 py-1 rounded-full text-sm" style="' + authStyle + '">' + authTypeLabel + '</span></div>');

    if (nc.capabilities && nc.capabilities.length > 0) {
      contentParts.push('<div><h4 class="font-semibold mb-2" style="color:var(--lex-text-primary)">Capabilities</h4><div class="flex flex-wrap gap-2">' +
        nc.capabilities.map(function (cap) {
          return '<span class="inline-flex items-center px-2 py-1 rounded text-sm" style="background:var(--lex-bg-accent-muted);color:var(--lex-text-accent)">' + formatText(cap) + '</span>';
        }).join('') +
      '</div></div>');
    }

    if (nc.tags && nc.tags.length > 0) {
      contentParts.push('<div><h4 class="font-semibold mb-2" style="color:var(--lex-text-primary)">Tags</h4><div class="flex flex-wrap gap-2">' +
        nc.tags.map(function (tag) {
          return '<span class="inline-flex items-center px-2 py-1 rounded text-sm" style="background:var(--lex-status-neutral-bg);color:var(--lex-status-neutral-text)">' + tag + '</span>';
        }).join('') +
      '</div></div>');
    }

    document.getElementById('detailsContent').innerHTML = contentParts.join('');

    var actionBtn = document.getElementById('detailsActionBtn');
    if (nc.status === 'coming_soon') {
      actionBtn.style.display = 'none';
    } else {
      actionBtn.style.display = 'block';
      if (nc.status === 'connected' || nc.status === 'active') {
        actionBtn.textContent = 'Manage Connector';
      } else if (nc.status === 'installed') {
        actionBtn.textContent = 'Configure';
      } else {
        actionBtn.textContent = 'Connect';
      }
      actionBtn.onclick = function () {
        closeDetailsModal();
        openConnectorManage(nc.id);
      };
    }

    // Update the lex-modal heading to reflect the connector name, then open it.
    // lex-modal skips re-rendering after first render, so update the heading DOM directly.
    var detailsModal = document.getElementById('connectorDetailsModal');
    var detailsTitle = detailsModal ? detailsModal.querySelector('.lex-modal-title') : null;
    if (detailsTitle) {
      detailsTitle.textContent = nc.name;
    }
    if (detailsModal) {
      detailsModal.open = true;
    }
  }

  function closeDetailsModal() {
    var modal = document.getElementById('connectorDetailsModal');
    if (modal) modal.open = false;
  }

  // ── Actions modal ───────────────────────────────────────────────────

  function showConnectorActionsModal(connectorId) {
    var connector = findConnectorById(connectorId);
    if (!connector) {
      console.error('Connector not found:', connectorId);
      return;
    }

    selectedConnectorForActions = connector;

    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'Connector';
    document.getElementById('actionsConnectorName').textContent = connectorName;

    var modalIcon = document.getElementById('connectorActionsIcon');
    var logoUrl = (connector.manifest && connector.manifest.icon) || connector.logo_url || connector.logo || connector.icon;

    if (modalIcon) {
      if (logoUrl) {
        modalIcon.className = 'w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center p-3';
        modalIcon.style.background = 'var(--lex-card-bg)';
        modalIcon.style.border = '2px solid var(--lex-border-default)';
        modalIcon.innerHTML = '<img src="' + logoUrl + '" alt="' + connectorName + '" class="w-full h-full object-contain">';
      } else {
        modalIcon.className = 'w-20 h-20 mx-auto mb-4 rounded-2xl flex items-center justify-center';
        modalIcon.style.background = 'var(--lex-bg-accent)';
        modalIcon.innerHTML = '<span class="text-3xl font-bold" style="color:var(--lex-text-on-accent)">' + connectorName.charAt(0).toUpperCase() + '</span>';
      }
    }

    // Update the lex-modal heading to show the connector name.
    // lex-modal skips re-rendering after first render, so update the heading DOM directly.
    var modal = document.getElementById('connectorActionsModal');
    var modalTitle = modal ? modal.querySelector('.lex-modal-title') : null;
    if (modalTitle) {
      modalTitle.textContent = connectorName;
    }

    var systemConnectors = ['case-actionstep', 'crm-leadly'];
    var connectorType = connector.connector_type || connector.connector_id || connectorId;
    var isSystemConnector = systemConnectors.indexOf(connectorType) !== -1;

    var deleteButton = document.getElementById('actionDelete');
    deleteButton.style.display = isSystemConnector ? 'none' : 'flex';

    if (modal) {
      modal.open = true;
    }
  }

  function closeConnectorActionsModal(clearSelection) {
    if (clearSelection === undefined) clearSelection = true;
    // Suppress the lex-close handler when closing programmatically
    // without clearing selection (uninstall/delete flows need the connector).
    _suppressActionsClose = !clearSelection;
    var modal = document.getElementById('connectorActionsModal');
    if (modal) modal.open = false;
    if (clearSelection) {
      selectedConnectorForActions = null;
    }
  }

  function navigateToConnectorDashboard() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var hasCustomUI = !!(connector.ui_entry_point && connector.manifest);

    closeConnectorActionsModal();

    if (hasCustomUI) {
      openCustomConnectorUI(
        connector.ui_entry_point,
        (connector.manifest && connector.manifest.name) || connector.name,
        connector.id || '',
        connector.connector_id || connector.connector_type || connector.id || ''
      );
    } else {
      openConnectorManage(connector.id);
    }
  }

  // ── Uninstall flow ──────────────────────────────────────────────────

  function uninstallConnector() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'this connector';

    closeConnectorActionsModal(false);
    showUninstallConfirmModal(connectorName);
  }

  function showUninstallConfirmModal(connectorName) {
    var message = '<div class="space-y-3">' +
      '<p>Are you sure you want to uninstall <strong>' + Lex.Utils.escapeHtml(connectorName) + '</strong>?</p>' +
      '<div class="text-sm" style="background:var(--lex-status-warning-bg, #fefce8);border:1px solid var(--lex-status-warning, #ca8a04);border-radius:var(--lex-radius-md, 6px);padding:0.75rem;">' +
        '<p class="font-medium" style="color:var(--lex-status-warning-text, #713f12);">What will happen:</p>' +
        '<ul class="list-disc ml-4 mt-1" style="color:var(--lex-status-warning-text, #713f12);">' +
          '<li>The connector will stop syncing</li>' +
          '<li>OAuth tokens will be revoked</li>' +
          '<li>You can reinstall later</li>' +
        '</ul>' +
      '</div>' +
      '<label class="flex items-center gap-2 mt-3 cursor-pointer">' +
        '<input type="checkbox" id="purgeDataCheckbox" class="rounded border-gray-300">' +
        '<span class="text-sm text-gray-700">Also purge all synced data</span>' +
      '</label>' +
    '</div>';

    Lex.Modal.confirm('Uninstall Connector', message, function () {
      var purgeData = document.getElementById('purgeDataCheckbox') && document.getElementById('purgeDataCheckbox').checked;
      confirmUninstallConnector(purgeData);
    }, { variant: 'default', confirmText: 'Uninstall', cancelText: 'Cancel', size: 'sm' });
  }

  function confirmUninstallConnector(purgeData) {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'this connector';
    var connectorType = connector.connector_id || connector.source_type || connector.id;

    // If purge requested, delete data first, then uninstall
    var purgePromise = purgeData
      ? api.delete('/api/connectors/' + connectorType + '/data/purge')
      : Promise.resolve();

    purgePromise.then(function () {
      return api.delete('/api/v1/integrations/connectors/' + connector.id);
    }).then(function () {
      var msg = connectorName + ' has been uninstalled';
      if (purgeData) msg += ' and all synced data purged';
      Lex.Toast.success(msg);
      selectedConnectorForActions = null;
      loadConnectors();
    }).catch(function (error) {
      console.error('Uninstall error:', error);
      Lex.Toast.error('Failed to uninstall connector: ' + error.message);
      selectedConnectorForActions = null;
    });
  }

  // ── Delete flow ─────────────────────────────────────────────────────

  function deleteConnector() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'this connector';

    closeConnectorActionsModal(false);
    showDeleteConfirmModal(connectorName);
  }

  function showDeleteConfirmModal(connectorName) {
    var message = '<div class="space-y-3">' +
      '<p>Are you sure you want to permanently delete <strong>' + Lex.Utils.escapeHtml(connectorName) + '</strong>?</p>' +
      '<div class="text-sm" style="background:var(--lex-status-danger-bg, #fef2f2);border:1px solid var(--lex-status-danger, #dc2626);border-radius:var(--lex-radius-md, 6px);padding:0.75rem;">' +
        '<p class="font-medium" style="color:var(--lex-status-danger-text, #7f1d1d);">This will permanently remove:</p>' +
        '<ul class="list-disc ml-4 mt-1" style="color:var(--lex-status-danger-text, #7f1d1d);">' +
          '<li>All connector configuration</li>' +
          '<li>All synced data</li>' +
          '<li>All custom UI files</li>' +
          '<li>All integration history</li>' +
        '</ul>' +
      '</div>' +
    '</div>';

    Lex.Modal.confirm('Delete Connector', message, function () {
      confirmDeleteConnector();
    }, { variant: 'danger', confirmText: 'Delete Permanently', cancelText: 'Cancel', size: 'sm' });
  }

  function confirmDeleteConnector() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'this connector';

    // The Lex.Modal.confirm() dialog auto-closes on confirm — no explicit close needed.

    // permanent=true triggers a hard-delete on the backend: the integration_sources
    // row plus all associated connector_data, connector_sync_logs, and entity_links
    // rows are removed inside a transaction. This is irreversible.
    // confirmUninstallConnector() calls the same endpoint WITHOUT this parameter,
    // which performs a soft-delete (is_active = false) — keeping the record.
    api.delete('/api/v1/integrations/connectors/' + connector.id + '?permanent=true').then(function () {
      Lex.Toast.success(connectorName + ' has been permanently deleted');
      selectedConnectorForActions = null;
      loadConnectors();
    }).catch(function (error) {
      console.error('Delete error:', error);
      Lex.Toast.error('Failed to delete connector: ' + error.message);
      selectedConnectorForActions = null;
    });
  }

  // ── Search & filter ─────────────────────────────────────────────────

  function filterAvailableConnectors() {
    var searchInput = document.getElementById('connectorSearch');
    var statusFilterEl = document.getElementById('statusFilter');
    var categoryFilterEl = document.getElementById('categoryFilter');
    var authTypeFilterEl = document.getElementById('authTypeFilter');

    if (!searchInput || !statusFilterEl || !categoryFilterEl || !authTypeFilterEl) return;

    // lex-input and lex-select both expose .value on the element directly.
    var searchTerm = (searchInput.value || '').toLowerCase();
    var statusVal = statusFilterEl.value || '';
    var categoryVal = categoryFilterEl.value || '';
    var authTypeVal = authTypeFilterEl.value || '';

    var filtered = allAvailableConnectors.filter(function (connector) {
      var normalized = normalizeConnector(connector);

      if (searchTerm) {
        var matchesSearch =
          (normalized.name || '').toLowerCase().includes(searchTerm) ||
          (normalized.vendor || '').toLowerCase().includes(searchTerm) ||
          (normalized.description || '').toLowerCase().includes(searchTerm) ||
          (normalized.tags || []).some(function (tag) { return String(tag).toLowerCase().includes(searchTerm); });

        if (!matchesSearch) return false;
      }

      if (statusVal && getConnectorStatusKey(connector, currentInstalledConnectors) !== statusVal) return false;
      if (categoryVal) {
        var categoryMatches = normalized.category === categoryVal;
        if (categoryVal === 'case_management') {
          categoryMatches = categoryMatches || normalized.category === 'case';
        }
        if (!categoryMatches) return false;
      }
      if (authTypeVal && normalized.auth_type !== authTypeVal) return false;

      return true;
    });

    connectorsFilteredCount = filtered.length;
    renderAvailableConnectors(sortConnectors(filtered));
  }

  function renderAvailableConnectors(connectors) {
    var availableContainer = document.getElementById('availableConnectors');
    var noResultsMessage = document.getElementById('noResultsMessage');
    var summaryEl = document.getElementById('connectorsPaginationSummary');
    var pageLabelEl = document.getElementById('connectorsPageLabel');
    var prevBtn = document.getElementById('connectorsPrevPage');
    var nextBtn = document.getElementById('connectorsNextPage');
    if (!availableContainer || !noResultsMessage) return;

    var total = connectors.length;
    var totalPages = Math.max(1, Math.ceil(total / connectorsPageSize));
    if (connectorsCurrentPage > totalPages) connectorsCurrentPage = totalPages;
    if (connectorsCurrentPage < 1) connectorsCurrentPage = 1;

    if (total === 0) {
      availableContainer.innerHTML = '<tr><td colspan="7" class="dc-empty">No connectors match the current filters.</td></tr>';
      noResultsMessage.classList.add('hidden');
      if (summaryEl) summaryEl.textContent = 'Showing 0 connectors';
      if (pageLabelEl) pageLabelEl.textContent = 'Page 1 of 1';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      updateSortIndicators();
    } else {
      var start = (connectorsCurrentPage - 1) * connectorsPageSize;
      var end = Math.min(start + connectorsPageSize, total);
      var pageRows = connectors.slice(start, end);

      availableContainer.innerHTML = pageRows
        .map(function (c) { return renderAvailableConnectorCard(c, currentInstalledConnectors); })
        .join('');
      noResultsMessage.classList.add('hidden');
      if (summaryEl) summaryEl.textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + total + ' connectors';
      if (pageLabelEl) pageLabelEl.textContent = 'Page ' + connectorsCurrentPage + ' of ' + totalPages;
      if (prevBtn) prevBtn.disabled = connectorsCurrentPage <= 1;
      if (nextBtn) nextBtn.disabled = connectorsCurrentPage >= totalPages;
      updateSortIndicators();
    }
  }

  function setupSearchAndFilters() {
    var searchInput = document.getElementById('connectorSearch');
    var statusFilterEl = document.getElementById('statusFilter');
    var categoryFilterEl = document.getElementById('categoryFilter');
    var authTypeFilterEl = document.getElementById('authTypeFilter');
    var prevBtn = document.getElementById('connectorsPrevPage');
    var nextBtn = document.getElementById('connectorsNextPage');

    if (!searchInput || !statusFilterEl || !categoryFilterEl || !authTypeFilterEl) return;

    function resetPageAndFilter() {
      connectorsCurrentPage = 1;
      filterAvailableConnectors();
    }

    // lex-input fires 'lex-input' on each keystroke (equivalent to native 'input').
    searchInput.addEventListener('lex-input', function () {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(resetPageAndFilter, 300);
    });

    // lex-select fires 'lex-change' when a selection is made (equivalent to native 'change').
    statusFilterEl.addEventListener('lex-change', resetPageAndFilter);
    categoryFilterEl.addEventListener('lex-change', resetPageAndFilter);
    authTypeFilterEl.addEventListener('lex-change', resetPageAndFilter);

    document.querySelectorAll('[data-sort-key]').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-sort-key');
        if (!key) return;

        if (connectorsSortKey === key) {
          connectorsSortDirection = connectorsSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          connectorsSortKey = key;
          connectorsSortDirection = 'asc';
        }

        connectorsCurrentPage = 1;
        filterAvailableConnectors();
      });
    });

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (connectorsCurrentPage <= 1) return;
        connectorsCurrentPage -= 1;
        filterAvailableConnectors();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var totalPages = Math.max(1, Math.ceil(connectorsFilteredCount / connectorsPageSize));
        if (connectorsCurrentPage >= totalPages) return;
        connectorsCurrentPage += 1;
        filterAvailableConnectors();
      });
    }
  }

  // ── Page refresh ────────────────────────────────────────────────────

  function refreshConnectorsPage() {
    loadConnectors();
  }

  // Topbar refresh button
  document.addEventListener('lex-refresh', function (e) {
    e.preventDefault();
    refreshConnectorsPage();
  });

  // ── Main data loader ────────────────────────────────────────────────

  function loadConnectors() {
    var connectorsLoading = document.getElementById('connectorsLoading');
    var connectorsContent = document.getElementById('connectorsContent');

    if (!connectorsLoading || !connectorsContent) return;

    // Show loading, hide content
    connectorsLoading.classList.remove('hidden');
    connectorsContent.classList.add('hidden');

    Promise.allSettled([
      Connectors.getAll(),
      ConnectorRegistry.getCatalog()
    ]).then(function (results) {
      var installedData = results[0];
      var registryData = results[1];

      var installedConnectors = [];

      if (installedData.status === 'fulfilled') {
        var backendConnectors = installedData.value.connectors || [];

        var isSystemConnector = function (backendConnector, staticConnector) {
          if (backendConnector.connector_type === staticConnector.connector_type) return true;
          if (backendConnector.connector_id === staticConnector.id) return true;
          if (backendConnector.id === staticConnector.id) return true;

          var backendName = (backendConnector.name || '').toLowerCase().trim();
          var staticName = (staticConnector.name || '').toLowerCase().trim();

          if (backendName === staticName) return true;
          if (backendName.includes('actionstep') && staticName.includes('actionstep')) return true;
          if (backendName.includes('leadly') && staticName.includes('leadly')) return true;
          if (backendName.includes('gohighlevel') && staticName.includes('gohighlevel')) return true;

          return false;
        };

        var matchedBackendIds = new Set();
        installedConnectors = STATIC_SYSTEM_CONNECTORS.map(function (staticConnector) {
          var backendMatch = backendConnectors.find(function (bc) { return isSystemConnector(bc, staticConnector); });

          if (backendMatch) {
            matchedBackendIds.add(backendMatch.id);
            return Object.assign({}, staticConnector, {
              status: backendMatch.status || backendMatch.auth_status || staticConnector.status,
              records: backendMatch.records || backendMatch.total_records || staticConnector.records,
              lastSync: backendMatch.lastSync || backendMatch.last_sync || backendMatch.last_sync_at || staticConnector.lastSync,
              backend_id: backendMatch.id,
              id: staticConnector.id,
              connector_type: staticConnector.connector_type
            });
          }

          return staticConnector;
        });

        var additionalConnectors = backendConnectors.filter(function (bc) {
          if (matchedBackendIds.has(bc.id)) return false;
          return !STATIC_SYSTEM_CONNECTORS.some(function (sc) { return isSystemConnector(bc, sc); });
        });

        installedConnectors = installedConnectors.concat(additionalConnectors);
        allConnectors = installedConnectors.slice();
      } else {
        console.error('Failed to fetch installed connectors:', installedData.reason);
        Lex.Toast.warning('Could not load backend connectors. Showing system-level connectors only.');

        installedConnectors = STATIC_SYSTEM_CONNECTORS.slice();
        allConnectors = installedConnectors.slice();
      }

      // Process catalog connectors
      var availableSection = document.getElementById('availableConnectorsSection');
      if (registryData.status === 'fulfilled') {
        var availableConnectors = registryData.value.connectors || [];

        allAvailableConnectors = buildCombinedConnectorList(installedConnectors, availableConnectors);
        currentInstalledConnectors = installedConnectors;
        allConnectors = buildCombinedConnectorList(allConnectors, allAvailableConnectors);
        connectorsCurrentPage = 1;
        connectorsFilteredCount = allAvailableConnectors.length;
        filterAvailableConnectors();
        if (availableSection) availableSection.classList.remove('hidden');
      } else {
        console.warn('Connector catalog unavailable:', registryData.reason);

        allAvailableConnectors = installedConnectors.slice();
        currentInstalledConnectors = installedConnectors;
        connectorsCurrentPage = 1;
        connectorsFilteredCount = allAvailableConnectors.length;
        filterAvailableConnectors();
        if (availableSection) availableSection.classList.remove('hidden');
      }

      connectorsLoading.classList.add('hidden');
      connectorsContent.classList.remove('hidden');
    }).catch(function (error) {
      connectorsLoading.classList.add('hidden');
      connectorsContent.classList.remove('hidden');
      Lex.Toast.error('Failed to load connectors');
      console.error(error);
    });
  }

  // ── Import connector ────────────────────────────────────────────────

  function openImportConnectorModal(opts) {
    var modal = document.getElementById('importConnectorModal');
    if (!modal) return;
    opts = opts || {};
    importTargetConnectorId = opts.targetConnectorId || null;
    importTargetConnectorName = opts.targetConnectorName || null;
    clearConnectorFile();
    applyImportConnectorModalContext();
    modal.open = true;
  }

  function closeImportConnectorModal() {
    var modal = document.getElementById('importConnectorModal');
    if (!modal) return;
    modal.open = false;
    importTargetConnectorId = null;
    importTargetConnectorName = null;
    clearConnectorFile();
    applyImportConnectorModalContext();
  }

  function applyImportConnectorModalContext() {
    var modal = document.getElementById('importConnectorModal');
    var titleEl = document.getElementById('importConnectorContextTitle');
    var descriptionEl = document.getElementById('importConnectorContextDescription');
    var buttonLabelEl = document.getElementById('importConnectorBtnLabel');

    if (importTargetConnectorId && importTargetConnectorName) {
      if (modal) modal.setAttribute('heading', 'Update ' + importTargetConnectorName);
      if (titleEl) titleEl.textContent = 'Update ' + importTargetConnectorName;
      if (descriptionEl) {
        descriptionEl.innerHTML =
          'Upload a ZIP package to update <strong>' + escapeHtml(importTargetConnectorName) + '</strong>. ' +
          'The backend will validate that the manifest matches this connector before replacing the current package.';
      }
      if (buttonLabelEl) buttonLabelEl.textContent = 'Upload Update';
      return;
    }

    if (modal) modal.setAttribute('heading', 'Import Connector Configuration');
    if (titleEl) titleEl.textContent = 'Import Custom Connector';
    if (descriptionEl) {
      descriptionEl.textContent = 'Upload a ZIP package containing your connector configuration (manifest.json, connector.json) and UI files (HTML/CSS/JS). The package must follow the connector schema with metadata, authentication, API endpoints, and UI assets.';
    }
    if (buttonLabelEl) buttonLabelEl.textContent = 'Import Connector';
  }

  function handleConnectorFileSelect(event) {
    var file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/zip' &&
        file.type !== 'application/x-zip-compressed' &&
        !file.name.endsWith('.zip')) {
      Lex.Toast.error('Please select a valid ZIP file');
      return;
    }

    var maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      Lex.Toast.error('File size exceeds 20MB limit');
      return;
    }

    selectedConnectorFile = file;
    displayFileInfo(file);
    showValidationSuccess('ZIP file selected. Ready to upload to backend for validation.');

    var importBtn = document.getElementById('importConnectorBtn');
    if (importBtn) importBtn.disabled = false;
  }

  function displayFileInfo(file) {
    var filePreviewSection = document.getElementById('filePreviewSection');
    var fileNameEl = document.getElementById('fileName');
    var fileSizeEl = document.getElementById('fileSize');

    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) fileSizeEl.textContent = formatFileSize(file.size);
    if (filePreviewSection) filePreviewSection.classList.remove('hidden');
  }

  function validateConnectorConfig(config) {
    var importBtn = document.getElementById('importConnectorBtn');
    var errors = [];
    var warnings = [];

    if (!config.id) errors.push('Missing required field: id');
    if (!config.name) errors.push('Missing required field: name');
    if (!config.version) errors.push('Missing required field: version');
    if (!config.category) errors.push('Missing required field: category');

    if (!config.auth || !config.auth.type) {
      errors.push('Missing required field: auth.type');
    } else {
      if (config.auth.type === 'oauth2') {
        if (!config.auth.oauth2 || !config.auth.oauth2.authorization_url) errors.push('OAuth2 requires authorization_url');
        if (!config.auth.oauth2 || !config.auth.oauth2.token_url) errors.push('OAuth2 requires token_url');
        if (!config.auth.oauth2 || !config.auth.oauth2.scopes) warnings.push('OAuth2 scopes not specified');
      } else if (config.auth.type === 'api_key') {
        if (!config.auth.api_key || !config.auth.api_key.location) errors.push('API key requires location (header/query)');
        if (!config.auth.api_key || !config.auth.api_key.key_name) errors.push('API key requires key_name');
      }
    }

    if (!config.api || !config.api.base_url) errors.push('Missing required field: api.base_url');
    if (!config.api || !config.api.endpoints || Object.keys(config.api.endpoints).length === 0) warnings.push('No API endpoints defined');
    if (!config.transform) warnings.push('No data transformation mapping defined');
    if (!config.sync) warnings.push('No sync strategy defined');

    if (errors.length > 0) {
      showValidationError('Validation failed:\n' + errors.join('\n'));
      if (importBtn) importBtn.disabled = true;
    } else if (warnings.length > 0) {
      showValidationWarning('Validation passed with warnings:\n' + warnings.join('\n'));
      if (importBtn) importBtn.disabled = false;
    } else {
      showValidationSuccess('Configuration is valid and ready to import');
      if (importBtn) importBtn.disabled = false;
    }
  }

  function showValidationError(message) {
    var el = document.getElementById('validationStatus');
    if (!el) return;
    el.innerHTML = '<div class="rounded-lg p-4" style="background:var(--lex-status-danger-bg);border:1px solid var(--lex-status-danger)"><div class="flex gap-3"><svg class="w-5 h-5 flex-shrink-0 mt-0.5" style="color:var(--lex-icon-danger)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><div><h4 class="text-sm font-semibold mb-1" style="color:var(--lex-status-danger-text)">Validation Error</h4><p class="text-sm whitespace-pre-line" style="color:var(--lex-status-danger-text)">' + message + '</p></div></div></div>';
  }

  function showValidationWarning(message) {
    var el = document.getElementById('validationStatus');
    if (!el) return;
    el.innerHTML = '<div class="rounded-lg p-4" style="background:var(--lex-status-warning-bg);border:1px solid var(--lex-status-warning)"><div class="flex gap-3"><svg class="w-5 h-5 flex-shrink-0 mt-0.5" style="color:var(--lex-icon-warning)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg><div><h4 class="text-sm font-semibold mb-1" style="color:var(--lex-status-warning-text)">Validation Warning</h4><p class="text-sm whitespace-pre-line" style="color:var(--lex-status-warning-text)">' + message + '</p></div></div></div>';
  }

  function showValidationSuccess(message) {
    var el = document.getElementById('validationStatus');
    if (!el) return;
    el.innerHTML = '<div class="rounded-lg p-4" style="background:var(--lex-status-success-bg);border:1px solid var(--lex-status-success)"><div class="flex gap-3"><svg class="w-5 h-5 flex-shrink-0 mt-0.5" style="color:var(--lex-icon-success)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><div><h4 class="text-sm font-semibold mb-1" style="color:var(--lex-status-success-text)">Valid Configuration</h4><p class="text-sm" style="color:var(--lex-status-success-text)">' + message + '</p></div></div></div>';
  }

  function clearConnectorFile() {
    selectedConnectorFile = null;
    parsedConnectorConfig = null;

    var fileInput = document.getElementById('connectorFileInput');
    var filePreview = document.getElementById('filePreviewSection');
    var validationStatus = document.getElementById('validationStatus');
    var importBtn = document.getElementById('importConnectorBtn');

    if (fileInput) fileInput.value = '';
    if (filePreview) filePreview.classList.add('hidden');
    if (validationStatus) validationStatus.innerHTML = '';
    if (importBtn) importBtn.disabled = true;
  }

  function confirmImportConnector() {
    if (!selectedConnectorFile) {
      Lex.Toast.error('No connector ZIP file selected');
      return;
    }

    var importBtn = document.getElementById('importConnectorBtn');
    var originalBtnText = importBtn ? importBtn.innerHTML : '';

    if (importBtn) {
      importBtn.disabled = true;
      importBtn.innerHTML =
        '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>' +
        '</svg>' +
        '<span>Uploading...</span>';
    }

    var formData = new FormData();
    formData.append('connector_zip', selectedConnectorFile);
    if (importTargetConnectorId) {
      formData.append('target_connector_id', importTargetConnectorId);
    }

    api.post('/api/v1/generic-connectors/import', formData).then(function (result) {
      if (result && result.success) {
        var connectorName = importTargetConnectorName || result.connector_name || selectedConnectorFile.name;
        Lex.Toast.success(importTargetConnectorId
          ? 'Connector "' + connectorName + '" updated successfully!'
          : 'Connector "' + connectorName + '" imported successfully!');

        if (result.violations && result.violations.length > 0) {
          var tid = setTimeout(function () {
            Lex.Toast.warning('Security scan found ' + result.violations.length + ' warnings. Check logs for details.');
          }, 1500);
          _timeouts.push(tid);
        }

        closeImportConnectorModal();

        var tid2 = setTimeout(function () {
          loadConnectors();
        }, 2000);
        _timeouts.push(tid2);
      } else {
        throw new Error((result && (result.error || result.message)) || 'Failed to import connector');
      }
    }).catch(function (error) {
      console.error('Import error:', error);

      var errorMessage = error.message || '';
      if (errorMessage.includes('404')) {
        errorMessage = 'Import endpoint not available. Contact your administrator.';
      } else if (errorMessage.includes('401') || errorMessage.includes('403')) {
        errorMessage = 'You do not have permission to import connectors. Admin access required.';
      } else if (errorMessage.includes('413')) {
        errorMessage = 'File too large. Maximum size is 20MB.';
      } else if (errorMessage.includes('400')) {
        errorMessage = 'Invalid connector package. Please check the ZIP file structure.';
      } else if (errorMessage.includes('security')) {
        errorMessage = 'Security validation failed. ' + errorMessage;
      } else if (errorMessage.includes('fetch') || errorMessage.includes('network') || !errorMessage) {
        errorMessage = 'Network error. Check your connection and try again.';
      }

      Lex.Toast.error('Import failed: ' + errorMessage);

      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = originalBtnText;
      }
    });
  }

  // ── Connector accounts (GAP-10: set default for template engine) ───

  /**
   * Opens the Manage Accounts modal and loads sources for the currently
   * selected connector. The modal lists every integration_sources row
   * sharing the same connector_id slug, allowing the user to mark one
   * as the default for template-engine resolution.
   */
  function showConnectorAccountsModal() {
    if (!selectedConnectorForActions) return;

    // Close the actions modal first
    closeConnectorActionsModal(false);

    var modal = document.getElementById('connectorAccountsModal');
    if (!modal) return;

    // Reset to loading state
    var listEl = document.getElementById('connectorAccountsList');
    if (listEl) {
      listEl.innerHTML =
        '<div class="flex items-center justify-center py-8"><lex-spinner size="sm"></lex-spinner></div>';
    }

    modal.open = true;

    loadConnectorAccounts();
  }

  /**
   * Fetches all integration_sources rows for the connector slug of the
   * currently selected connector and renders them as account rows.
   * Each row has a "Set as default" button that calls setConnectorDefault().
   */
  function loadConnectorAccounts() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorSlug = String(
      connector.connector_id || connector.connector_type || connector.id || ''
    ).toLowerCase();

    var listEl = document.getElementById('connectorAccountsList');
    if (!listEl) return;

    api.get('/api/v1/integrations/sources?connector_id=' + encodeURIComponent(connectorSlug))
      .then(function (data) {
        var sources = (data && (data.sources || data.data || data)) || [];

        // Normalize: accept plain array or { sources: [] }
        if (!Array.isArray(sources)) {
          sources = [];
        }

        if (sources.length === 0) {
          listEl.innerHTML =
            '<p class="text-sm text-center py-6" style="color:var(--lex-text-tertiary)">No connected accounts found for this connector.</p>';
          return;
        }

        listEl.innerHTML = sources.map(function (source) {
          return renderAccountRow(source, connectorSlug);
        }).join('');
      })
      .catch(function (error) {
        console.error('Failed to load connector accounts:', error);
        listEl.innerHTML =
          '<p class="text-sm text-center py-6" style="color:var(--lex-status-danger-text)">Failed to load accounts. Please try again.</p>';
      });
  }

  /**
   * Renders a single integration_sources row inside the accounts modal.
   * @param {Object} source - integration_sources row
   * @param {string} connectorSlug - connector_id slug (for context only)
   * @returns {string} HTML string
   */
  function renderAccountRow(source, connectorSlug) {
    void connectorSlug; // available for future use

    var isDefault = source.is_default === true;
    var authStatus = source.auth_status || 'unknown';
    var sourceName = Lex.Utils.escapeHtml(source.source_name || source.connector_name || 'Unnamed account');
    var sourceId = source.id || '';

    var statusColorMap = {
      active: 'green',
      connected: 'green',
      error: 'red',
      expired: 'yellow',
      disconnected: 'gray'
    };
    var statusColor = statusColorMap[authStatus] || 'gray';
    var statusLabel = authStatus.charAt(0).toUpperCase() + authStatus.slice(1);

    var defaultBadge = isDefault
      ? '<lex-badge color="indigo" label="Default" size="sm"></lex-badge>'
      : '';

    var setDefaultBtn = isDefault
      ? '<span class="text-xs" style="color:var(--lex-text-tertiary)">Default account</span>'
      : '<lex-btn variant="ghost" size="sm" onclick="setConnectorDefault(\'' + sourceId + '\')">Set as default</lex-btn>';

    return '<div class="flex items-center gap-3 px-4 py-3 rounded-xl" style="background:var(--lex-card-bg);border:1px solid var(--lex-card-border)">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<span class="font-medium text-sm" style="color:var(--lex-text-primary)">' + sourceName + '</span>' +
          defaultBadge +
        '</div>' +
        '<div class="flex items-center gap-2 mt-1">' +
          '<lex-badge color="' + statusColor + '" label="' + statusLabel + '" size="sm"></lex-badge>' +
        '</div>' +
      '</div>' +
      '<div class="flex-shrink-0">' +
        setDefaultBtn +
      '</div>' +
    '</div>';
  }

  /**
   * Calls PATCH /api/v1/integrations/sources/:id/default to mark a
   * source as the default account for its connector slug.
   * @param {string} sourceId - UUID of the integration_sources row
   */
  function setConnectorDefault(sourceId) {
    if (!sourceId) return;

    api.patch('/api/v1/integrations/sources/' + encodeURIComponent(sourceId) + '/default', {
      is_default: true
    }).then(function (result) {
      // Backend returns { success: true, data: { source_name, ... } }
      var row = (result && result.data) || result || {};
      var name = row.source_name || row.connector_name || 'Account';
      Lex.Toast.success(Lex.Utils.escapeHtml(name) + ' set as the default account.');
      // Reload the list so the UI reflects the new default
      loadConnectorAccounts();
    }).catch(function (error) {
      console.error('Failed to set default account:', error);
      Lex.Toast.error('Failed to set default: ' + (error.message || 'Unknown error'));
    });
  }

  function closeConnectorAccountsModal() {
    var modal = document.getElementById('connectorAccountsModal');
    if (modal) modal.open = false;
  }

  // ── Update connector (reimport ZIP without deleting data) ──────────

  function updateConnector() {
    if (!selectedConnectorForActions) {
      Lex.Toast.error('No connector selected');
      return;
    }
    // Close the actions modal and trigger the hidden file input
    closeConnectorActionsModal(false);
    var fileInput = document.getElementById('updateConnectorFileInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  function handleUpdateConnectorFile(event) {
    var file = event.target.files[0];
    if (!file) {
      selectedConnectorForActions = null;
      return;
    }

    var connectorName = selectedConnectorForActions
      ? ((selectedConnectorForActions.manifest && selectedConnectorForActions.manifest.name) || selectedConnectorForActions.name || 'Connector')
      : 'Connector';
    var targetSlug = selectedConnectorForActions ? getConnectorUpdateSlug(selectedConnectorForActions) : null;

    Lex.Toast.info('Updating ' + connectorName + '...');

    var formData = new FormData();
    formData.append('connector_zip', file);
    if (targetSlug) {
      formData.append('target_connector_id', targetSlug);
    }

    api.post('/api/v1/generic-connectors/import', formData).then(function (result) {
      if (result && result.success) {
        Lex.Toast.success(connectorName + ' updated successfully!');
        selectedConnectorForActions = null;
        var tid = setTimeout(function () {
          loadConnectors();
        }, 1500);
        _timeouts.push(tid);
      } else {
        throw new Error((result && (result.error || result.message)) || 'Failed to update connector');
      }
    }).catch(function (error) {
      console.error('Update connector error:', error);
      var errorMessage = error.message || 'Unknown error';
      if (errorMessage.indexOf('400') !== -1) {
        errorMessage = 'Invalid connector package. Please check the ZIP file structure.';
      } else if (errorMessage.indexOf('401') !== -1 || errorMessage.indexOf('403') !== -1) {
        errorMessage = 'You do not have permission to update connectors. Admin access required.';
      } else if (errorMessage.indexOf('413') !== -1) {
        errorMessage = 'File too large. Maximum size is 20MB.';
      }
      Lex.Toast.error('Update failed: ' + errorMessage);
      selectedConnectorForActions = null;
    });
  }

  // ── Drag and drop ───────────────────────────────────────────────────

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function setupDragAndDrop() {
    var dropZone = document.getElementById('importDropZone');
    if (!dropZone) return;

    var dragEvents = ['dragenter', 'dragover', 'dragleave', 'drop'];
    dragEvents.forEach(function (eventName) {
      dropZone.addEventListener(eventName, preventDefaults, false);
    });

    var highlightEvents = ['dragenter', 'dragover'];
    highlightEvents.forEach(function (eventName) {
      dropZone.addEventListener(eventName, function () {
        dropZone.style.borderColor = 'var(--lex-border-accent)';
        dropZone.style.background = 'var(--lex-bg-accent-soft)';
      }, false);
    });

    var unhighlightEvents = ['dragleave', 'drop'];
    unhighlightEvents.forEach(function (eventName) {
      dropZone.addEventListener(eventName, function () {
        dropZone.style.borderColor = '';
        dropZone.style.background = '';
      }, false);
    });

    dropZone.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      var files = dt.files;

      if (files.length > 0) {
        handleConnectorFileSelect({ target: { files: [files[0]] } });
      }
    }, false);
  }

  // ── Event wiring ────────────────────────────────────────────────────

  function handleEscapeKey(e) {
    // lex-modal components handle Escape natively — no manual close needed here.
    // This handler is kept for any future non-lex-modal overlay logic.
    void e;
  }

  function setupEventListeners() {
    // Escape key tracking (lex-modal handles Escape natively; handler is a no-op but kept
    // for the trackDocListener cleanup pattern so no listeners leak on page leave).
    trackDocListener('keydown', handleEscapeKey);

    // All modal backdrop click handling is now delegated to lex-modal (close-on-overlay).
    // No manual click-on-backdrop wiring needed for the converted modals.

    // Actions modal — clear state when closed via overlay click or Escape.
    // lex-modal fires 'lex-close' on any close; _suppressActionsClose is set by
    // closeConnectorActionsModal(false) to prevent clearing during uninstall/delete
    // flows that need selectedConnectorForActions to remain alive.
    var actionsModal = document.getElementById('connectorActionsModal');
    if (actionsModal) {
      var actionsCloseHandler = function () {
        if (_suppressActionsClose) {
          _suppressActionsClose = false;
          return;
        }
        selectedConnectorForActions = null;
      };
      actionsModal.addEventListener('lex-close', actionsCloseHandler);
      _documentListeners.push({ event: 'lex-close', handler: actionsCloseHandler, target: actionsModal });
    }

    // Search and filters
    setupSearchAndFilters();

    // Drag and drop
    setupDragAndDrop();

    // Banner import button (lex-banner slot — element is already in the DOM
    // when setupEventListeners runs since the HTML fragment is static)
    var bannerImportBtn = document.getElementById('importConnectorBannerBtn');
    if (bannerImportBtn) {
      bannerImportBtn.addEventListener('click', openImportConnectorModal);
    }

    // Embedded iframe back-button → dismiss the host modal
    var embeddedBackHandler = function (event) {
      var data = event && event.data;
      if (!data || data.type !== 'lex-embedded-back') return;
      var frame = document.getElementById('connectorDashboardFrame');
      if (frame && event.source !== frame.contentWindow) return;
      closeConnectorDashboardModal();
    };
    window.addEventListener('message', embeddedBackHandler);
    _documentListeners.push({ event: 'message', handler: embeddedBackHandler, target: window });
  }

  // ── Lifecycle hooks ─────────────────────────────────────────────────

  function onEnter() {
    resetState();

    // Expose globals needed by inline onclick handlers in data-connectors.html
    exposeGlobal('openImportConnectorModal', openImportConnectorModal);
    exposeGlobal('closeImportConnectorModal', closeImportConnectorModal);
    exposeGlobal('handleConnectorFileSelect', handleConnectorFileSelect);
    exposeGlobal('clearConnectorFile', clearConnectorFile);
    exposeGlobal('confirmImportConnector', confirmImportConnector);
    exposeGlobal('showConnectorDetails', showConnectorDetails);
    exposeGlobal('closeDetailsModal', closeDetailsModal);
    exposeGlobal('closeConnectorDashboardModal', closeConnectorDashboardModal);
    exposeGlobal('showConnectorActionsModal', showConnectorActionsModal);
    exposeGlobal('closeConnectorActionsModal', closeConnectorActionsModal);
    exposeGlobal('navigateToConnectorDashboard', navigateToConnectorDashboard);
    exposeGlobal('handleConnectorRowSelection', handleConnectorRowSelection);
    exposeGlobal('toggleConnectorPin', toggleConnectorPin);
    exposeGlobal('openConnectorUpdateModal', openConnectorUpdateModal);
    exposeGlobal('showConnectorAccountsModal', showConnectorAccountsModal);
    exposeGlobal('closeConnectorAccountsModal', closeConnectorAccountsModal);
    exposeGlobal('setConnectorDefault', setConnectorDefault);
    exposeGlobal('updateConnector', updateConnector);
    exposeGlobal('handleUpdateConnectorFile', handleUpdateConnectorFile);
    exposeGlobal('uninstallConnector', uninstallConnector);
    exposeGlobal('confirmUninstallConnector', confirmUninstallConnector);
    exposeGlobal('deleteConnector', deleteConnector);
    exposeGlobal('confirmDeleteConnector', confirmDeleteConnector);
    exposeGlobal('installConnector', installConnector);
    exposeGlobal('openConnector', openConnector);
    exposeGlobal('openConnectorManage', openConnectorManage);
    exposeGlobal('openCustomConnectorUI', openCustomConnectorUI);
    exposeGlobal('refreshConnectorsPage', refreshConnectorsPage);
    exposeGlobal('filterAvailableConnectors', filterAvailableConnectors);

    // Setup event listeners
    setupEventListeners();

    // Load data
    loadConnectors();
  }

  function onLeave() {
    // Clear tracked intervals and timeouts
    _intervals.forEach(clearInterval);
    _timeouts.forEach(clearTimeout);
    _intervals = [];
    _timeouts = [];

    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }

    // Remove exposed window globals
    _globalFns.forEach(function (name) { delete window[name]; });
    _globalFns = [];

    // Remove tracked document listeners
    _documentListeners.forEach(function (entry) {
      var target = entry.target || document;
      target.removeEventListener(entry.event, entry.handler);
    });
    _documentListeners = [];

    // Reset page state
    allConnectors = [];
    allAvailableConnectors = [];
    currentInstalledConnectors = [];
    selectedConnectorForActions = null;
    selectedConnectorFile = null;
    parsedConnectorConfig = null;

    // Clear search input so it doesn't persist on re-navigation
    var searchEl = document.getElementById('connectorSearch');
    if (searchEl) searchEl.value = '';
  }

  // ── Init — standalone page, called directly ────────────────────────
  onEnter();

})();

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
  var pinnedConnectorsStorageKey = 'lana_automation_pinned_connectors';
  var pinnedConnectors = loadPinnedConnectors();
  // Connector table (js/shared/connector-table.js): the mounted controller and
  // its query, kept across reloads of the list.
  var connectorTable = null;
  var connectorTablePromise = null;
  var connectorTableStore = { query: null };

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
    connectorTable = null;
    connectorTablePromise = null;
    connectorTableStore = { query: null };
  }

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

  function normalizeConnectorScope(scope) {
    var value = String(scope || '').trim().toLowerCase();
    if (value === 'user' || value === 'personal') return 'user';
    if (value === 'organization' || value === 'org' || value === 'firm') return 'org';
    return 'org';
  }

  function formatConnectorScope(connector) {
    return normalizeConnectorScope(
      connector && (
        connector.connector_scope ||
        connector.scope ||
        (connector.manifest && connector.manifest.scope) ||
        (connector.metadata && connector.metadata.scope)
      )
    ) === 'user' ? 'Personal' : 'Firm';
  }

  function renderScopeBadge(connector) {
    var label = formatConnectorScope(connector);
    var color = label === 'Personal' ? 'blue' : 'gray';
    return '<lex-badge color="' + color + '" label="' + label + '" size="sm"></lex-badge>';
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

  var VISIBLE_CONNECTOR_TERMS = [
    'quickbooks',
    'actionstep',
    'leadly',
    'google',
    'gmail',
    'microsoft',
    'office',
    'outlook',
    'onedrive',
    'sharepoint',
    'teams',
    'excel'
  ];

  function isVisibleConnector(connector) {
    var normalized = normalizeConnector(connector);
    var raw = normalized.raw || {};
    var identity = normalized.identity || connectorIdentity(raw);
    var name = String(normalized.name || '').trim().toLowerCase();
    var normalizedIdentity = String(identity || '').replace(/[_\s]+/g, '-').toLowerCase();
    var normalizedName = name.replace(/[_\s]+/g, '-');

    if (normalizedIdentity === 'google-drive' || normalizedName === 'google-drive') {
      return true;
    }

    var haystack = [
      normalized.id,
      identity,
      normalized.name,
      normalized.vendor,
      normalized.category,
      raw.connector_id,
      raw.connector_type,
      raw.source_type,
      raw.type,
      raw.auth_type,
      raw.authType
    ].join(' ').toLowerCase();

    return VISIBLE_CONNECTOR_TERMS.some(function (term) {
      return haystack.indexOf(term) !== -1;
    });
  }

  function getConnectorPinKey(connector) {
    var normalized = normalizeConnector(connector);
    return normalized.id || normalized.raw.connector_id || normalized.raw.connector_type || normalized.name || '';
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
    renderConnectorTable();
  }

  function normalizeConnector(connector) {
    connector = connector || {};

    var manifest = connector.manifest || {};
    var metadata = connector.metadata || manifest.metadata || {};
    var auth = connector.auth || {};
    var id = connector.id || connector.connector_id || connector.connector_type || 'unknown';

    return {
      raw: connector,
      id: id,
      identity: connectorIdentity(connector),
      name: manifest.name || metadata.name || connector.name || connector.connector_name || 'Unknown Connector',
      description: manifest.description || metadata.description || connector.description || connector.connector_description || '',
      status: String(connector.status || connector.auth_status || '').toLowerCase(),
      category: manifest.category || metadata.category || connector.category || connector.connector_category || 'unknown',
      vendor: manifest.vendor || metadata.vendor || metadata.created_by || connector.vendor || '',
      auth_type: connector.auth_type || connector.authType || auth.type || 'unknown',
      connector_scope: normalizeConnectorScope(connector.connector_scope || connector.scope || manifest.scope || metadata.scope),
      version: connector.version || manifest.version || '1.0.0',
      logo_url: manifest.icon || connector.logo_url || connector.logo || connector.icon || null,
      tags: connector.tags || [],
      ui_entry_point: connector.ui_entry_point || null,
      ui_layout_id: connector.ui_layout_id || null,
      hasCustomUI: !!(connector.ui_entry_point && connector.manifest)
    };
  }

  function connectorHasMeaningfulConfig(connector) {
    var config = connector && connector.config && typeof connector.config === 'object'
      ? connector.config
      : {};
    var operationalKeys = {
      sync_frequency: true,
      scheduled_sync_time: true,
      sync_interval_minutes: true,
      last_sync: true,
      guided_connect_pending: true
    };

    return Object.keys(config).some(function (key) {
      if (!key || key.slice(-11) === '_configured' || operationalKeys[key]) {
        return false;
      }

      var value = config[key];
      if (value == null) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    });
  }

  function connectorRequiresSavedCredentialOrConfig(connector) {
    var normalized = normalizeConnector(connector);
    var authType = String(normalized.auth_type || '').toLowerCase();
    return authType === 'oauth2' || authType === 'oauth2_or_api_key' || authType === 'api_key';
  }

  function connectorHasConnectionEvidence(connector) {
    return Boolean(connectorHasMeaningfulConfig(connector));
  }

  function getConnectorStatusKey(connector, installedConnectors) {
    var normalized = normalizeConnector(connector);
    var rawStatus = normalized.status;

    if (rawStatus === 'coming_soon') return 'coming_soon';
    if (rawStatus === 'connected') return 'connected';
    if (rawStatus === 'disconnected') return 'disconnected';
    if (connectorHasConnectionEvidence(normalized.raw)) return 'connected';

    var installed = installedConnectors || currentInstalledConnectors;
    if (ConnectorRegistry.isConnectorInstalled(normalized.id, installed)) {
      return 'not_connected';
    }

    return 'not_connected';
  }

  function buildCombinedConnectorList(installedConnectors, catalogConnectors) {
    var combined = [];
    var seen = new Set();
    var catalogByKey = new Map();

    (catalogConnectors || []).forEach(function (connector) {
      var key = connectorIdentity(connector);
      if (key) {
        catalogByKey.set(key, connector);
      }
    });

    function isMissingDisplayValue(value) {
      if (value == null) return true;
      var normalized = String(value).trim().toLowerCase();
      return !normalized || normalized === 'unknown' || normalized === 'other';
    }

    function enrichInstalledConnector(connector) {
      var catalog = catalogByKey.get(connectorIdentity(connector));
      if (!catalog) return connector;

      var catalogNormalized = normalizeConnector(catalog);
      var connectorNormalized = normalizeConnector(connector);
      var mergedManifest = Object.assign(
        {},
        catalog.manifest || {},
        connector.manifest || {}
      );
      var mergedMetadata = Object.assign(
        {},
        catalog.metadata || (catalog.manifest && catalog.manifest.metadata) || {},
        connector.metadata || (connector.manifest && connector.manifest.metadata) || {}
      );

      return Object.assign({}, catalog, connector, {
        manifest: mergedManifest,
        metadata: mergedMetadata,
        category: isMissingDisplayValue(connectorNormalized.category)
          || connectorNormalized.category === connector.connector_type
          || connectorNormalized.category === connector.connector_id
          ? catalogNormalized.category
          : connectorNormalized.category,
        auth_type: isMissingDisplayValue(connectorNormalized.auth_type)
          ? catalogNormalized.auth_type
          : connectorNormalized.auth_type,
        authType: isMissingDisplayValue(connector.authType)
          ? catalogNormalized.auth_type
          : connector.authType,
        vendor: connectorNormalized.vendor || catalogNormalized.vendor,
        version: connector.version || catalog.version || catalogNormalized.version,
        description: connector.description || catalog.description || catalogNormalized.description,
        documentation_url: connector.documentation_url || catalog.documentation_url || catalogNormalized.raw.documentation_url,
        source: connector.source || 'installed'
      });
    }

    function addConnector(connector) {
      if (!connector) return;
      var key = connectorIdentity(connector);
      if (!key || seen.has(key)) return;
      seen.add(key);
      combined.push(enrichInstalledConnector(connector));
    }

    installedConnectors.forEach(addConnector);
    (catalogConnectors || []).forEach(addConnector);
    return combined.filter(isVisibleConnector);
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
    if (status === 'not_connected') return 'install';
    return 'open';
  }

  function isConnectWizardEnabled() {
    return !!(window.LanaConfig && window.LanaConfig.CONNECT_WIZARD_ENABLED === true &&
      window.Lex && window.Lex.ConnectWizard && typeof window.Lex.ConnectWizard.open === 'function');
  }

  /**
   * Where opening a connector goes: 'details' (coming soon), 'wizard' (Guided
   * Connect, flag on and status not_connected) or 'viewer' (the connector
   * viewer, as before). A disconnected row keeps its config, so it still
   * opens the viewer, where it is reconnected.
   */
  function connectorOpenRoute(connector, installedConnectors) {
    var status = getConnectorStatusKey(connector, installedConnectors);
    if (status === 'coming_soon') return 'details';
    if (status === 'not_connected' && isConnectWizardEnabled()) return 'wizard';
    return 'viewer';
  }

  function openConnectorEntry(connectorId) {
    var connector = findConnectorById(connectorId);
    if (!connector) return;

    var route = connectorOpenRoute(connector, currentInstalledConnectors);
    if (route === 'details') {
      showConnectorDetails(connectorId, null);
    } else if (route === 'wizard') {
      openConnectWizard(connectorId);
    } else {
      openConnectorManage(connectorId);
    }
  }

  function handleConnectorRowSelection(connectorId) {
    openConnectorEntry(connectorId);
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

  // ── Connector table ─────────────────────────────────────────────────

  /** Status vocabulary of this page, in filter order. */
  var CONNECTOR_STATUSES = {
    connected:     { label: 'Connected',     color: 'green' },
    not_connected: { label: 'Not connected', color: 'gray' },
    disconnected:  { label: 'Disconnected',  color: 'red' },
    coming_soon:   { label: 'Coming soon',   color: 'yellow' }
  };

  var INFO_ICON = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
  var UPDATE_ICON = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-3-6.7L21 8"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 3v5h-5"></path></svg>';

  /**
   * One table row of raw values for a connector (docs/TABLE-STANDARD.md §5).
   * @param {Object} connector
   * @param {Array} installedConnectors
   * @param {Array} pinned - pin keys
   */
  function mapConnectorRow(connector, installedConnectors, pinned) {
    var normalized = normalizeConnector(connector);
    var raw = normalized.raw || {};
    var pinKey = getConnectorPinKey(connector);
    var category = String(normalized.category || '').toLowerCase();
    return {
      id: String(normalized.id),
      pin_key: pinKey,
      pinned: pinKey && (pinned || []).indexOf(pinKey) !== -1 ? 'yes' : 'no',
      name: normalized.name,
      vendor: normalized.vendor || '',
      description: normalized.description || '',
      logo_url: normalized.logo_url || '',
      category: category === 'case' ? 'case_management' : category,
      auth_type: String(normalized.auth_type || '').toLowerCase(),
      scope: normalized.connector_scope,
      status: getConnectorStatusKey(connector, installedConnectors),
      version: String(normalized.version || '').replace(/^v/i, ''),
      created_at: raw.created_at || raw.installed_at || '',
      update_slug: getConnectorUpdateSlug(connector),
      _raw: raw
    };
  }

  /** Actions cell: Set up / Open / View details, plus Update for packages. */
  function connectorActionsCell(row) {
    var safeId = escapeAttribute(row.id);
    var safeName = escapeAttribute(row.name);
    var action = getConnectorAction(row._raw, currentInstalledConnectors);
    var details = '<lex-btn variant="ghost" size="sm" icon="true" onclick="showConnectorDetails(\'' + safeId + '\', event)" aria-label="View details of ' + safeName + '" title="View details">' + INFO_ICON + '</lex-btn>';
    var html;
    if (action === 'install') {
      html = '<lex-btn variant="primary" size="sm" onclick="installConnector(\'' + safeId + '\', event)">Set up</lex-btn>' + details;
    } else if (action === 'details') {
      html = '<lex-btn variant="ghost" size="sm" onclick="showConnectorDetails(\'' + safeId + '\', event)">View details</lex-btn>';
    } else {
      html = '<lex-btn variant="primary" size="sm" onclick="openConnectorManage(\'' + safeId + '\')">Open</lex-btn>' + details;
    }
    if (row.update_slug) {
      html += '<lex-btn variant="ghost" size="sm" icon="true" onclick="openConnectorUpdateModal(\'' + safeId + '\', event)" aria-label="Update ' + safeName + '" title="Update connector">' + UPDATE_ICON + '</lex-btn>';
    }
    return html;
  }

  function connectorRows() {
    return allAvailableConnectors.map(function (connector) {
      return mapConnectorRow(connector, currentInstalledConnectors, pinnedConnectors);
    });
  }

  /** Mounts the table once, then refreshes its rows (keeping search, sort, filters, page). */
  function renderConnectorTable() {
    var shared = window.LanaConnectorTable;
    var mountEl = document.getElementById('connectorTableMount');
    if (!shared || !mountEl) return;
    if (connectorTable) {
      connectorTable.setRows(connectorRows());
      return;
    }
    if (connectorTablePromise) {
      connectorTablePromise.then(function () { if (connectorTable) connectorTable.setRows(connectorRows()); });
      return;
    }
    mountEl.innerHTML = shared.sectionMarkup({
      prefix: 'connectors',
      tableId: 'connectorsTable',
      title: 'Available to Configure',
      subtitle: 'Connector packages available in the local platform catalog',
      query: connectorTableStore.query
    });
    connectorTablePromise = shared.mount({
      prefix: 'connectors',
      tableId: 'connectorsTable',
      rows: connectorRows(),
      statuses: CONNECTOR_STATUSES,
      store: connectorTableStore,
      actionsCell: connectorActionsCell,
      onPinClick: function (pinKey) { toggleConnectorPin(pinKey, null); },
      onRowClick: function (row) { handleConnectorRowSelection(row.id); }
    }).then(function (controller) {
      connectorTable = controller;
      return controller;
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ''));
  }

  function getCatalogConnectorSlug(connector, fallbackId) {
    if (!connector) return fallbackId || '';
    return connector.connector_id ||
      connector.connector_type ||
      connector.source_type ||
      connector.type ||
      connector.id ||
      fallbackId ||
      '';
  }

  function findInstalledSourceForSlug(slug) {
    if (!slug) return null;
    var normalizedSlug = String(slug).toLowerCase();
    return currentInstalledConnectors.find(function (connector) {
      if (!connector || !isUuid(connector.id)) return false;
      return [
        connector.connector_id,
        connector.connector_type,
        connector.source_type,
        connector.type
      ].some(function (value) {
        return value && String(value).toLowerCase() === normalizedSlug;
      });
    }) || null;
  }

  async function ensureConnectorIntegrationSource(connectorId) {
    var connector = findConnectorById(connectorId);
    if (!connector) {
      throw new Error('Connector not found');
    }

    var sourceId = isUuid(connector.id) ? connector.id : '';
    var catalogConnectorId = getCatalogConnectorSlug(connector, connectorId);
    var existingSource = findInstalledSourceForSlug(catalogConnectorId);

    if (!sourceId && existingSource) {
      sourceId = existingSource.id;
      connector = Object.assign({}, connector, existingSource, {
        connector_id: existingSource.connector_id || catalogConnectorId,
        connector_type: existingSource.connector_type || existingSource.connector_id || catalogConnectorId
      });
    }

    if (sourceId) {
      return {
        connector: connector,
        sourceId: sourceId,
        connectorType: catalogConnectorId || getCatalogConnectorSlug(connector, connectorId),
        connectorScope: normalizeConnectorScope(connector.connector_scope || connector.scope || (connector.manifest && connector.manifest.scope))
      };
    }

    var connectorName = (connector.manifest && connector.manifest.name) ||
      connector.name ||
      connector.connector_name ||
      formatText(catalogConnectorId);

    var result = await api.post('/api/v1/integrations/connectors/configure', {
      connector_type: catalogConnectorId,
      config: {}
    });

    sourceId = result && result.connector_id;
    if (!sourceId) {
      throw new Error('Connector source was not created');
    }

    var sourceConnector = Object.assign({}, connector, {
      id: sourceId,
      name: connectorName,
      connector_id: catalogConnectorId,
      connector_type: catalogConnectorId,
      connector_scope: normalizeConnectorScope(connector.connector_scope || connector.scope || (connector.manifest && connector.manifest.scope)),
      status: 'configured',
      auth_status: 'configured'
    });

    currentInstalledConnectors = currentInstalledConnectors.concat(sourceConnector);
    allConnectors = buildCombinedConnectorList(allConnectors.concat([sourceConnector]), allAvailableConnectors);

    return {
      connector: sourceConnector,
      sourceId: sourceId,
      connectorType: catalogConnectorId,
      connectorScope: normalizeConnectorScope(sourceConnector.connector_scope)
    };
  }

  function buildConnectorManageUrl(connectorId, resolvedContext) {
    var connector = findConnectorById(connectorId);
    var context = resolvedContext || null;
    var contextConnector = context && context.connector ? context.connector : connector;
    var catalogConnectorId = context
      ? context.connectorType
      : connector
        ? getCatalogConnectorSlug(connector, connectorId)
      : connectorId;
    var sourceId = context
      ? context.sourceId
      : connector && isUuid(connector.id)
        ? connector.id
        : '';
    var connectorScope = context
      ? context.connectorScope
      : connector
        ? normalizeConnectorScope(connector.connector_scope || connector.scope || (connector.manifest && connector.manifest.scope))
        : '';

    return buildCustomConnectorUIUrl(
      contextConnector && contextConnector.ui_entry_point ? contextConnector.ui_entry_point : '',
      contextConnector ? (contextConnector.name || contextConnector.connector_name || contextConnector.source_name || 'Connector') : 'Connector',
      sourceId,
      catalogConnectorId,
      connectorScope
    );
  }

  async function openConnectorManage(connectorId) {
    try {
      var context = await ensureConnectorIntegrationSource(connectorId);
      var connector = context.connector;
      var url = buildConnectorManageUrl(connectorId, context);
      var connectorName = connector
        ? ((connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'Connector Dashboard')
        : 'Connector Dashboard';

      if (!url) return;
      openConnectorDashboardModal(url, connectorName);
    } catch (error) {
      console.error('Failed to open connector dashboard:', error);
      Lex.Toast.error('Failed to open connector: ' + (error.message || 'Unknown error'));
    }
  }

  function openConnector(connectorId, category) {
    void category;
    openConnectorManage(connectorId);
  }

  // Open the viewer for a source the wizard created or already knows about.
  function openConnectorViewerForSource(connectorId, sourceId) {
    var connector = findConnectorById(connectorId);
    if (!connector || !sourceId) {
      openConnectorManage(connectorId);
      return;
    }
    var connectorType = getCatalogConnectorSlug(connector, connectorId);
    var context = {
      connector: connector,
      sourceId: sourceId,
      connectorType: connectorType,
      connectorScope: normalizeConnectorScope(connector.connector_scope || connector.scope || (connector.manifest && connector.manifest.scope))
    };
    var name = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'Connector Dashboard';
    openConnectorDashboardModal(buildConnectorManageUrl(connectorId, context), name);
  }

  // Guided Connect (CONNECT_WIZARD_ENABLED). The wizard creates the source
  // row itself, on manual sync, so ensureConnectorIntegrationSource's silent
  // configure is not used on this path.
  function openConnectWizard(connectorId) {
    var connector = findConnectorById(connectorId);
    if (!connector) return;
    var normalized = normalizeConnector(connector);
    var connectorType = getCatalogConnectorSlug(connector, connectorId);
    var source = isUuid(connector.id) ? connector : findInstalledSourceForSlug(connectorType);
    var openViewer = function (detail) {
      var sourceId = (detail && detail.sourceId) || (source && source.id) || '';
      if (sourceId) openConnectorViewerForSource(connectorId, sourceId);
      else openConnectorManage(connectorId);
    };

    try {
      window.Lex.ConnectWizard.open({
        connectorType: connectorType,
        connectorName: normalized.name,
        source: source,
        onDone: loadConnectors,
        onAdvanced: openViewer,
        onOpenConnector: openViewer
      });
    } catch (error) {
      console.error('Failed to open the connect wizard:', error && error.message);
      openConnectorManage(connectorId);
    }
  }

  function buildCustomConnectorUIUrl(uiEntryPoint, connectorName, sourceId, connectorType, connectorScope) {
    var params = new URLSearchParams({
      ui: uiEntryPoint,
      name: connectorName,
      connectorId: connectorType || sourceId || '',
      connectorType: connectorType || '',
      sourceId: sourceId || '',
      connectorScope: connectorScope || '',
      chrome: 'embedded'
    });

    return 'integrations/connector-viewer.html?' + params.toString();
  }

  function openCustomConnectorUI(uiEntryPoint, connectorName, sourceId, connectorType, connectorScope) {
    openConnectorDashboardModal(
      buildCustomConnectorUIUrl(uiEntryPoint, connectorName, sourceId, connectorType, connectorScope || ''),
      connectorName || 'Connector Dashboard'
    );
  }

  function openConnectorDashboardModal(url, connectorName) {
    var modal = document.getElementById('connectorDashboardModal');
    if (!modal) return;
    // lex-modal copies its children when it upgrades; look the frame up now.
    var frame = document.getElementById('connectorDashboardFrame');
    if (!frame) return;

    // No modal header: the embedded page has its own header and Back button.
    modal.setAttribute('aria-label', connectorName || 'Connector dashboard');
    frame.src = url;
    modal.open = true;
  }

  // Unload the dashboard (stops its timers and requests) and close the modal.
  function closeConnectorDashboardModal() {
    var modal = document.getElementById('connectorDashboardModal');
    var frame = document.getElementById('connectorDashboardFrame');

    if (frame) frame.src = 'about:blank';
    if (modal) modal.open = false;
  }

  // ── Install connector ───────────────────────────────────────────────

  function installConnector(connectorId, evt) {
    var target = findConnectorById(connectorId);
    if (target && connectorOpenRoute(target, currentInstalledConnectors) === 'wizard') {
      if (evt) evt.stopPropagation();
      openConnectWizard(connectorId);
      return;
    }

    var button = evt ? evt.target : null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Installing...';
    }

    ConnectorRegistry.installConnector(connectorId).then(function (result) {
      if (result.success) {
        Lex.Toast.success(connectorId + ' is ready to configure.');
        var tid = setTimeout(function () {
          openConnectorManage(connectorId);
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

    var nc = {
      id: connector.id || connector.connector_id || 'unknown',
      name: connector.name || connector.connector_name || 'Unknown Connector',
      description: connector.description || connector.connector_description || 'No description available',
      status: connector.status || connector.auth_status || 'disconnected',
      category: connector.category || connector.connector_category || 'unknown',
      logo_url: connector.logo_url || connector.logo || connector.icon || null,
      vendor: connector.vendor || null,
      auth_type: connector.auth_type || 'unknown',
      connector_scope: normalizeConnectorScope(connector.connector_scope || connector.scope || (connector.manifest && connector.manifest.scope)),
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
    contentParts.push('<div><h4 class="font-semibold mb-2" style="color:var(--lex-text-primary)">Scope</h4>' + renderScopeBadge(nc) + '</div>');

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
        openConnectorEntry(nc.id);
      };
    }

    // Show the connector name through the lex-modal heading property, then open it.
    var detailsModal = document.getElementById('connectorDetailsModal');
    if (detailsModal) {
      detailsModal.heading = nc.name || 'Connector Details';
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

    // Show the connector name through the lex-modal heading property.
    var modal = document.getElementById('connectorActionsModal');
    if (modal) modal.heading = connectorName;

    var deleteButton = document.getElementById('actionDelete');
    deleteButton.style.display = 'flex';

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
        connector.connector_id || connector.connector_type || connector.id || '',
        normalizeConnectorScope(connector.connector_scope || connector.scope || (connector.manifest && connector.manifest.scope))
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

    var confirmModal = Lex.Modal.confirm('Uninstall Connector', message, function () {
      // Scope the lookup to this dialog rather than querying the whole document.
      var purgeBox = confirmModal && confirmModal.querySelector('#purgeDataCheckbox');
      confirmUninstallConnector(Boolean(purgeBox && purgeBox.checked));
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
        installedConnectors = installedData.value.connectors || [];
        allConnectors = installedConnectors.slice();
      } else {
        console.error('Failed to fetch installed connectors:', installedData.reason);
        Lex.Toast.warning('Could not load installed connectors. Showing catalog connectors only.');
      }

      // Process catalog connectors
      var availableSection = document.getElementById('availableConnectorsSection');
      if (registryData.status === 'fulfilled') {
        var availableConnectors = registryData.value.connectors || [];

        allAvailableConnectors = buildCombinedConnectorList(installedConnectors, availableConnectors);
        currentInstalledConnectors = installedConnectors;
        allConnectors = buildCombinedConnectorList(allConnectors, allAvailableConnectors);
        renderConnectorTable();
        if (availableSection) availableSection.classList.remove('hidden');
      } else {
        console.warn('Connector catalog unavailable:', registryData.reason);

        allAvailableConnectors = installedConnectors.slice();
        currentInstalledConnectors = installedConnectors;
        renderConnectorTable();
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

    // Header close button or Escape closes the lex-modal; unload the frame too.
    var dashboardModal = document.getElementById('connectorDashboardModal');
    if (dashboardModal) {
      var dashboardCloseHandler = function (event) {
        if (event.target !== dashboardModal) return;
        var frame = document.getElementById('connectorDashboardFrame');
        if (frame) frame.src = 'about:blank';
      };
      dashboardModal.addEventListener('lex-close', dashboardCloseHandler);
      _documentListeners.push({ event: 'lex-close', handler: dashboardCloseHandler, target: dashboardModal });
    }

    var embeddedOpenExternalHandler = function (event) {
      var data = event && event.data;
      if (!data || data.type !== 'lex-open-external-url' || !data.url) return;
      // Only the connector frame we opened may ask us to open a URL.
      var frame = document.getElementById('connectorDashboardFrame');
      if (!frame || event.source !== frame.contentWindow) return;

      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        window.electronAPI.invoke('open-external-url', data.url).catch(function (error) {
          console.error('Failed to open external URL:', error);
        });
      } else {
        window.open(data.url, '_blank', 'noopener');
      }
    };
    window.addEventListener('message', embeddedOpenExternalHandler);
    _documentListeners.push({ event: 'message', handler: embeddedOpenExternalHandler, target: window });
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

    connectorTable = null;
    connectorTablePromise = null;
  }

  // Pure table logic, exposed for unit tests.
  window.DataConnectorsTable = {
    CONNECTOR_STATUSES: CONNECTOR_STATUSES,
    connectorOpenRoute: connectorOpenRoute,
    connectorHasMeaningfulConfig: connectorHasMeaningfulConfig,
    mapConnectorRow: mapConnectorRow,
    connectorActionsCell: connectorActionsCell,
    buildCombinedConnectorList: buildCombinedConnectorList
  };

  // ── Init — standalone page, called directly ────────────────────────
  onEnter();

})();

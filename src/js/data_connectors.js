/**
 * data_connectors.js — Data Connectors page script (SPA lifecycle).
 * Migrated from public_html/integrations/connectors.html inline script.
 * Uses LexRouter.registerView() for onEnter/onLeave lifecycle.
 *
 * Dependencies (loaded via page descriptor before this file):
 *   - connectors.js  (Lex.Connectors, Lex.ConnectorRegistry, Lex.ConnectorsMockData)
 *
 * Available from shell (loaded by app.html):
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
  var searchTimeout = null;

  function resetState() {
    allConnectors = [];
    allAvailableConnectors = [];
    currentInstalledConnectors = [];
    selectedConnectorForActions = null;
    _suppressActionsClose = false;
    selectedConnectorFile = null;
    parsedConnectorConfig = null;
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
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

  function findConnectorById(connectorId) {
    return allConnectors.find(function (c) {
      return (c.id === connectorId) || (c.connector_id === connectorId);
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
        cardClick = 'onclick="openCustomConnectorUI(\'' + normalizedConnector.ui_entry_point + '\', \'' + normalizedConnector.name + '\')"';
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

    var syncInfoHtml = (isActive || isInstalled)
      ? '<div class="text-xs mb-3" style="color:var(--lex-text-tertiary)"><span>Last sync: ' + timeAgoStr + '</span></div>'
      : '';

    return '<div class="p-5 ' +
      (isComingSoon ? 'opacity-60' : 'hover:shadow-md') + ' transition-shadow ' +
      (isComingSoon ? '' : 'cursor-pointer') + '" style="background:var(--lex-card-bg);border:1px solid var(--lex-card-border);border-radius:var(--lex-card-radius);box-shadow:var(--lex-card-shadow)" ' + cardClick + '>' +
      '<div class="flex items-start justify-between mb-4">' +
        '<div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background:var(--lex-bg-tertiary)">' + logoHtml + '</div>' +
        '<lex-badge color="' + badgeConfig.color + '" label="' + badgeConfig.label + '" size="sm"></lex-badge>' +
      '</div>' +
      '<h3 class="font-semibold mb-1" style="color:var(--lex-text-primary)">' + normalizedConnector.name + '</h3>' +
      (normalizedConnector.vendor ? '<p class="text-xs mb-2" style="color:var(--lex-text-tertiary)">' + normalizedConnector.vendor + '</p>' : '') +
      '<p class="text-sm mb-3 line-clamp-2" style="color:var(--lex-text-secondary)">' + normalizedConnector.description + '</p>' +
      syncInfoHtml +
      buttonsHtml +
    '</div>';
  }

  function renderAvailableConnectorCard(connector, installedConnectors) {
    var isInstalled = ConnectorRegistry.isConnectorInstalled(connector.id, installedConnectors);
    var isComingSoon = connector.status === 'coming_soon';

    var logoHtml = connector.logo_url
      ? '<img src="' + connector.logo_url + '" alt="' + connector.name + '" class="w-10 h-10 object-contain" onerror="this.parentElement.innerHTML=\'<span class=\\\'text-lg font-bold\\\' style=\\\'color:var(--lex-text-accent)\\\'>' + connector.name.charAt(0) + '</span>\'">'
      : '<span class="text-lg font-bold" style="color:var(--lex-text-accent)">' + connector.name.charAt(0) + '</span>';

    /**
     * Determine the lex-badge config for available connector cards.
     * Valid colors: gray | green | red | yellow | blue | indigo
     */
    var statusBadge = '';
    if (isInstalled) {
      statusBadge = '<lex-badge color="green" label="Installed" size="sm"></lex-badge>';
    } else if (isComingSoon) {
      statusBadge = '<lex-badge color="yellow" label="Coming Soon" size="sm"></lex-badge>';
    } else {
      statusBadge = '<lex-badge color="blue" label="Available" size="sm"></lex-badge>';
    }

    /** SVG icon used inside detail icon-only buttons. */
    var infoIconSvgAvail = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';

    var actionButton = '';
    if (isInstalled) {
      actionButton = '<lex-btn variant="secondary" size="sm" disabled style="width:100%">Already Installed</lex-btn>';
    } else if (isComingSoon) {
      actionButton = '<lex-btn variant="ghost" size="sm" onclick="showConnectorDetails(\'' + connector.id + '\', event)" style="width:100%">View Details</lex-btn>';
    } else {
      actionButton = '<div class="flex gap-2">' +
        '<lex-btn variant="primary" size="sm" onclick="installConnector(\'' + connector.id + '\', event)" style="flex:1">Install</lex-btn>' +
        '<lex-btn variant="ghost" size="sm" icon="true" onclick="showConnectorDetails(\'' + connector.id + '\', event)" aria-label="View details">' + infoIconSvgAvail + '</lex-btn>' +
        '</div>';
    }

    return '<div class="p-5 ' + (isComingSoon ? 'opacity-75' : 'hover:shadow-md') + ' transition-shadow" style="background:var(--lex-card-bg);border:1px solid var(--lex-card-border);border-radius:var(--lex-card-radius);box-shadow:var(--lex-card-shadow)">' +
      '<div class="flex items-start justify-between mb-4">' +
        '<div class="w-12 h-12 rounded-lg flex items-center justify-center" style="background:var(--lex-bg-accent-muted)">' + logoHtml + '</div>' +
        statusBadge +
      '</div>' +
      '<h3 class="font-semibold mb-1" style="color:var(--lex-text-primary)">' + connector.name + '</h3>' +
      (connector.vendor ? '<p class="text-xs mb-2" style="color:var(--lex-text-tertiary)">' + connector.vendor + '</p>' : '') +
      '<p class="text-sm mb-3 line-clamp-2" style="color:var(--lex-text-secondary)">' + connector.description + '</p>' +
      '<div class="flex items-center justify-between text-xs mb-3" style="color:var(--lex-text-tertiary)">' +
        '<span class="inline-flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path></svg>' + formatText(connector.category) + '</span>' +
        (connector.version ? '<span>v' + connector.version + '</span>' : '') +
      '</div>' +
      actionButton +
    '</div>';
  }

  // ── Navigation ──────────────────────────────────────────────────────

  function openConnectorManage(connectorId) {
    var connector = findConnectorById(connectorId);
    var connectorType = (connector && (connector.connector_type || connector.connector_id)) || connectorId;

    var specialPages = {
      'case-actionstep': 'integrations/actionstep.html',
      'crm-leadly': 'integrations/leadly.html',
      'crm-gohighlevel': 'integrations/gohighlevel.html'
    };

    if (specialPages[connectorType]) {
      if (window.LexRouter) {
        LexRouter.navigate(specialPages[connectorType] + '?id=' + connectorId);
      } else {
        window.location.href = specialPages[connectorType].split('/').pop() + '?id=' + connectorId;
      }
      return;
    }

    // Generic integration management page
    if (window.LexRouter) {
      LexRouter.navigate('integrations/integration-config.html?id=' + connectorId);
    } else {
      window.location.href = 'integration-config.html?id=' + connectorId;
    }
  }

  function openConnector(connectorId, category) {
    openConnectorManage(connectorId);
  }

  function openCustomConnectorUI(uiEntryPoint, connectorName) {
    var params = new URLSearchParams({
      ui: uiEntryPoint,
      name: connectorName
    });

    if (window.LexRouter) {
      LexRouter.navigate('integrations/connector-viewer.html?' + params.toString());
    } else {
      window.location.href = 'connector-viewer.html?' + params.toString();
    }
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
        Lex.Toast.success(connectorId + ' installed successfully!');
        var tid = setTimeout(function () {
          if (window.LexRouter) {
            LexRouter.navigate('integrations/integration-config.html?id=' + connectorId);
          } else {
            window.location.href = 'integration-config.html?id=' + connectorId;
          }
        }, 1000);
        _timeouts.push(tid);
      } else {
        Lex.Toast.error('Failed to install ' + connectorId);
      }
    }).catch(function (error) {
      console.error('Install error:', error);

      var errorMessage = error.message;
      if (errorMessage.includes('404')) {
        errorMessage = 'Backend installation endpoint not yet implemented. Contact your administrator.';
      } else if (errorMessage.includes('fetch')) {
        errorMessage = 'Network error. Check your connection and try again.';
      }

      Lex.Toast.error('Installation failed: ' + errorMessage);

      if (button) {
        button.disabled = false;
        button.textContent = 'Install Connector';
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

    var systemConnectors = ['case-actionstep', 'crm-leadly', 'crm-gohighlevel'];
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
      openCustomConnectorUI(connector.ui_entry_point, (connector.manifest && connector.manifest.name) || connector.name);
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
          '<li>All synced data will be preserved</li>' +
          '<li>The connector will stop syncing</li>' +
          '<li>OAuth tokens will be revoked</li>' +
          '<li>You can reinstall later</li>' +
        '</ul>' +
      '</div>' +
    '</div>';

    Lex.Modal.confirm('Uninstall Connector', message, function () {
      confirmUninstallConnector();
    }, { variant: 'default', confirmText: 'Uninstall', cancelText: 'Cancel', size: 'sm' });
  }

  function confirmUninstallConnector() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'this connector';

    // The Lex.Modal.confirm() dialog auto-closes on confirm — no explicit close needed.
    api.delete('/api/v1/integrations/connectors/' + connector.id).then(function () {
      Lex.Toast.success(connectorName + ' has been uninstalled successfully');
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
    var categoryFilterEl = document.getElementById('categoryFilter');
    var authTypeFilterEl = document.getElementById('authTypeFilter');

    if (!searchInput || !categoryFilterEl || !authTypeFilterEl) return;

    // lex-input and lex-select both expose .value on the element directly.
    var searchTerm = (searchInput.value || '').toLowerCase();
    var categoryVal = categoryFilterEl.value || '';
    var authTypeVal = authTypeFilterEl.value || '';

    var filtered = allAvailableConnectors.filter(function (connector) {
      if (searchTerm) {
        var matchesSearch =
          (connector.name || '').toLowerCase().includes(searchTerm) ||
          (connector.vendor || '').toLowerCase().includes(searchTerm) ||
          (connector.description || '').toLowerCase().includes(searchTerm) ||
          (connector.tags || []).some(function (tag) { return tag.toLowerCase().includes(searchTerm); });

        if (!matchesSearch) return false;
      }

      if (categoryVal && connector.category !== categoryVal) return false;
      if (authTypeVal && connector.auth_type !== authTypeVal) return false;

      return true;
    });

    renderAvailableConnectors(filtered);
  }

  function renderAvailableConnectors(connectors) {
    var availableContainer = document.getElementById('availableConnectors');
    var noResultsMessage = document.getElementById('noResultsMessage');
    if (!availableContainer || !noResultsMessage) return;

    if (connectors.length === 0) {
      availableContainer.innerHTML = '';
      noResultsMessage.classList.remove('hidden');
    } else {
      availableContainer.innerHTML = connectors
        .map(function (c) { return renderAvailableConnectorCard(c, currentInstalledConnectors); })
        .join('');
      noResultsMessage.classList.add('hidden');
    }
  }

  function setupSearchAndFilters() {
    var searchInput = document.getElementById('connectorSearch');
    var categoryFilterEl = document.getElementById('categoryFilter');
    var authTypeFilterEl = document.getElementById('authTypeFilter');

    if (!searchInput || !categoryFilterEl || !authTypeFilterEl) return;

    // lex-input fires 'lex-input' on each keystroke (equivalent to native 'input').
    searchInput.addEventListener('lex-input', function () {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(filterAvailableConnectors, 300);
    });

    // lex-select fires 'lex-change' when a selection is made (equivalent to native 'change').
    categoryFilterEl.addEventListener('lex-change', filterAvailableConnectors);
    authTypeFilterEl.addEventListener('lex-change', filterAvailableConnectors);
  }

  // ── Page refresh ────────────────────────────────────────────────────

  function refreshConnectorsPage() {
    loadConnectors();
  }

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

        var installedContainer = document.getElementById('installedConnectors');
        if (installedContainer) {
          installedContainer.innerHTML = installedConnectors.map(renderConnectorCard).join('');
        }
      } else {
        console.error('Failed to fetch installed connectors:', installedData.reason);
        Lex.Toast.warning('Could not load backend connectors. Showing system-level connectors only.');

        installedConnectors = STATIC_SYSTEM_CONNECTORS.slice();
        allConnectors = installedConnectors.slice();

        var installedContainer = document.getElementById('installedConnectors');
        if (installedContainer) {
          installedContainer.innerHTML = installedConnectors.map(renderConnectorCard).join('');
        }
      }

      // Process registry connectors
      if (registryData.status === 'fulfilled') {
        var availableConnectors = registryData.value.connectors;

        if (availableConnectors && availableConnectors.length > 0) {
          availableConnectors.forEach(function (ac) {
            if (!allConnectors.find(function (c) { return c.id === ac.id || c.connector_id === ac.id; })) {
              allConnectors.push(ac);
            }
          });

          var availableSection = document.getElementById('availableConnectorsSection');

          var notInstalledConnectors = availableConnectors.filter(function (ac) {
            return !ConnectorRegistry.isConnectorInstalled(ac.id, installedConnectors) && ac.status !== 'coming_soon';
          });

          allAvailableConnectors = notInstalledConnectors;
          currentInstalledConnectors = installedConnectors;

          if (notInstalledConnectors.length > 0) {
            renderAvailableConnectors(notInstalledConnectors);
            availableSection.classList.remove('hidden');
          } else {
            var availableContainer = document.getElementById('availableConnectors');
            if (availableContainer) {
              availableContainer.innerHTML = '<p class="text-sm text-center py-8 col-span-full" style="color:var(--lex-text-secondary)">All available connectors are already installed.</p>';
            }
            availableSection.classList.remove('hidden');
          }
        }
      } else {
        console.warn('Registry unavailable:', registryData.reason);

        var availableSection = document.getElementById('availableConnectorsSection');
        var availableContainer = document.getElementById('availableConnectors');

        if (availableContainer) {
          availableContainer.innerHTML =
            '<div class="col-span-full rounded-lg p-6 text-center" style="background:var(--lex-status-warning-bg);border:1px solid var(--lex-status-warning)">' +
              '<svg class="w-12 h-12 mx-auto mb-3" style="color:var(--lex-icon-warning)" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>' +
              '</svg>' +
              '<p class="text-sm font-medium mb-1" style="color:var(--lex-status-warning-text)">Connector registry unavailable</p>' +
              '<p class="text-xs" style="color:var(--lex-status-warning-text)">Cannot fetch available connectors from the registry. Check your network connection or contact support.</p>' +
            '</div>';
        }
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

  function openImportConnectorModal() {
    var modal = document.getElementById('importConnectorModal');
    if (!modal) return;
    clearConnectorFile();
    modal.open = true;
  }

  function closeImportConnectorModal() {
    var modal = document.getElementById('importConnectorModal');
    if (!modal) return;
    modal.open = false;
    clearConnectorFile();
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
    formData.append('file', selectedConnectorFile);

    api.post('/api/v1/generic-connectors/import', formData).then(function (result) {
      if (result && result.success) {
        var connectorName = result.connector_name || selectedConnectorFile.name;
        Lex.Toast.success('Connector "' + connectorName + '" imported successfully!');

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
  }

  // ── Lifecycle hooks ─────────────────────────────────────────────────

  function onEnter() {
    resetState();

    // Expose globals needed by inline onclick handlers in data_connectors.html
    exposeGlobal('openImportConnectorModal', openImportConnectorModal);
    exposeGlobal('closeImportConnectorModal', closeImportConnectorModal);
    exposeGlobal('handleConnectorFileSelect', handleConnectorFileSelect);
    exposeGlobal('clearConnectorFile', clearConnectorFile);
    exposeGlobal('confirmImportConnector', confirmImportConnector);
    exposeGlobal('showConnectorDetails', showConnectorDetails);
    exposeGlobal('closeDetailsModal', closeDetailsModal);
    exposeGlobal('showConnectorActionsModal', showConnectorActionsModal);
    exposeGlobal('closeConnectorActionsModal', closeConnectorActionsModal);
    exposeGlobal('navigateToConnectorDashboard', navigateToConnectorDashboard);
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
  }

  // ── Register with router ────────────────────────────────────────────
  // registerPageInit ensures onEnter() is called on every navigation
  // (first load + re-navigation from cached scripts).
  // registerView only carries onLeave for cleanup — onEnter is handled
  // by registerPageInit to avoid double-init.
  if (window.LexRouter) {
    LexRouter.registerPageInit('integrations/data_connectors.html', function () {
      LexRouter.registerView({ onLeave: onLeave });
      onEnter();
    });
  } else {
    onEnter();
  }

})();

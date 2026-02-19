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
  var selectedConnectorFile = null;
  var parsedConnectorConfig = null;
  var searchTimeout = null;

  function resetState() {
    allConnectors = [];
    allAvailableConnectors = [];
    currentInstalledConnectors = [];
    selectedConnectorForActions = null;
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

    var statusColors = {
      connected: 'bg-green-100 text-green-800',
      active: 'bg-green-100 text-green-800',
      installed: 'bg-blue-100 text-blue-800',
      disconnected: 'bg-gray-100 text-gray-600',
      error: 'bg-red-100 text-red-800',
      syncing: 'bg-blue-100 text-blue-800',
      coming_soon: 'bg-yellow-100 text-yellow-800'
    };

    var statusIcons = {
      connected: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
      active: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
      installed: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
      disconnected: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path></svg>',
      error: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
      syncing: '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>',
      coming_soon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };

    var displayStatus = normalizedConnector.status;
    var statusColor = statusColors[displayStatus] || statusColors.disconnected;
    var statusIcon = statusIcons[displayStatus] || statusIcons.disconnected;
    var statusLabel = displayStatus === 'coming_soon' ? 'Coming Soon' : displayStatus.split('_').join(' ');
    var isComingSoon = displayStatus === 'coming_soon';
    var isActive = displayStatus === 'connected' || displayStatus === 'active';
    var isInstalled = displayStatus === 'installed';

    var logoHtml = normalizedConnector.logo_url
      ? '<img src="' + normalizedConnector.logo_url + '" alt="' + normalizedConnector.name + '" class="w-10 h-10 object-contain" onerror="this.parentElement.innerHTML=\'<span class=\\\'text-lg font-bold text-gray-400\\\'>' + normalizedConnector.name.charAt(0) + '</span>\'">'
      : '<span class="text-lg font-bold text-gray-400">' + normalizedConnector.name.charAt(0) + '</span>';

    var timeAgoStr = normalizedConnector.lastSync ? Lex.Utils.timeAgo(normalizedConnector.lastSync) : 'Never';

    var cardClick = '';
    if (!isComingSoon) {
      if (hasCustomUI) {
        cardClick = 'onclick="openCustomConnectorUI(\'' + normalizedConnector.ui_entry_point + '\', \'' + normalizedConnector.name + '\')"';
      } else {
        cardClick = 'onclick="openConnector(\'' + normalizedConnector.id + '\', \'' + normalizedConnector.category + '\')"';
      }
    }

    var buttonsHtml = '';
    if (isComingSoon) {
      buttonsHtml = '<button onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" class="w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors">View Details</button>';
    } else if (isActive) {
      buttonsHtml = '<div class="flex gap-2">' +
        '<button onclick="showConnectorActionsModal(\'' + normalizedConnector.id + '\'); event.stopPropagation();" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">Manage</button>' +
        '<button onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>' +
        '</div>';
    } else if (isInstalled) {
      buttonsHtml = '<div class="flex gap-2">' +
        '<button onclick="showConnectorActionsModal(\'' + normalizedConnector.id + '\'); event.stopPropagation();" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">Configure</button>' +
        '<button onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>' +
        '</div>';
    } else {
      buttonsHtml = '<div class="flex gap-2">' +
        '<button onclick="showConnectorActionsModal(\'' + normalizedConnector.id + '\'); event.stopPropagation();" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">Connect</button>' +
        '<button onclick="showConnectorDetails(\'' + normalizedConnector.id + '\', event)" class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>' +
        '</div>';
    }

    var syncInfoHtml = (isActive || isInstalled)
      ? '<div class="text-xs text-gray-400 mb-3"><span>Last sync: ' + timeAgoStr + '</span></div>'
      : '';

    return '<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 ' +
      (isComingSoon ? 'opacity-60' : 'hover:shadow-md') + ' transition-shadow ' +
      (isComingSoon ? '' : 'cursor-pointer') + '" ' + cardClick + '>' +
      '<div class="flex items-start justify-between mb-4">' +
        '<div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">' + logoHtml + '</div>' +
        '<span class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ' + statusColor + '">' + statusIcon + ' ' + statusLabel + '</span>' +
      '</div>' +
      '<h3 class="font-semibold text-gray-900 mb-1">' + normalizedConnector.name + '</h3>' +
      (normalizedConnector.vendor ? '<p class="text-xs text-gray-400 mb-2">' + normalizedConnector.vendor + '</p>' : '') +
      '<p class="text-sm text-gray-500 mb-3 line-clamp-2">' + normalizedConnector.description + '</p>' +
      syncInfoHtml +
      buttonsHtml +
    '</div>';
  }

  function renderAvailableConnectorCard(connector, installedConnectors) {
    var isInstalled = ConnectorRegistry.isConnectorInstalled(connector.id, installedConnectors);
    var isComingSoon = connector.status === 'coming_soon';

    var logoHtml = connector.logo_url
      ? '<img src="' + connector.logo_url + '" alt="' + connector.name + '" class="w-10 h-10 object-contain" onerror="this.parentElement.innerHTML=\'<span class=\\\'text-lg font-bold text-indigo-600\\\'>' + connector.name.charAt(0) + '</span>\'">'
      : '<span class="text-lg font-bold text-indigo-600">' + connector.name.charAt(0) + '</span>';

    var statusBadge = '';
    if (isInstalled) {
      statusBadge = '<span class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>Installed</span>';
    } else if (isComingSoon) {
      statusBadge = '<span class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>Coming Soon</span>';
    } else {
      statusBadge = '<span class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-600">Available</span>';
    }

    var actionButton = '';
    if (isInstalled) {
      actionButton = '<button disabled class="w-full px-4 py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed">Already Installed</button>';
    } else if (isComingSoon) {
      actionButton = '<button onclick="showConnectorDetails(\'' + connector.id + '\', event)" class="w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors">View Details</button>';
    } else {
      actionButton = '<div class="flex gap-2">' +
        '<button onclick="installConnector(\'' + connector.id + '\')" class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">Install</button>' +
        '<button onclick="showConnectorDetails(\'' + connector.id + '\', event)" class="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>' +
        '</div>';
    }

    return '<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 ' + (isComingSoon ? 'opacity-75' : 'hover:shadow-md') + ' transition-shadow">' +
      '<div class="flex items-start justify-between mb-4">' +
        '<div class="w-12 h-12 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-lg flex items-center justify-center">' + logoHtml + '</div>' +
        statusBadge +
      '</div>' +
      '<h3 class="font-semibold text-gray-900 mb-1">' + connector.name + '</h3>' +
      (connector.vendor ? '<p class="text-xs text-gray-400 mb-2">' + connector.vendor + '</p>' : '') +
      '<p class="text-sm text-gray-500 mb-3 line-clamp-2">' + connector.description + '</p>' +
      '<div class="flex items-center justify-between text-xs text-gray-400 mb-3">' +
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

  function installConnector(connectorId) {
    var button = event ? event.target : null;
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
      logoEl.innerHTML = '<span class="text-2xl font-bold text-gray-400">' + nc.name.charAt(0) + '</span>';
    }

    var contentParts = [];

    contentParts.push('<div><h4 class="font-semibold text-gray-900 mb-2">Description</h4><p class="text-gray-600">' + nc.description + '</p></div>');
    contentParts.push('<div><h4 class="font-semibold text-gray-900 mb-2">Category</h4><span class="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-800">' + formatText(nc.category) + '</span></div>');

    var authTypeLabel = nc.auth_type === 'oauth2' ? 'OAuth 2.0' :
                        nc.auth_type === 'api_key' ? 'API Key' :
                        formatText(nc.auth_type);
    var authBgClass = nc.auth_type === 'oauth2' ? 'bg-blue-100 text-blue-800' :
                      nc.auth_type === 'api_key' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-800';
    contentParts.push('<div><h4 class="font-semibold text-gray-900 mb-2">Authentication</h4><span class="inline-flex items-center px-3 py-1 rounded-full text-sm ' + authBgClass + '">' + authTypeLabel + '</span></div>');

    if (nc.capabilities && nc.capabilities.length > 0) {
      contentParts.push('<div><h4 class="font-semibold text-gray-900 mb-2">Capabilities</h4><div class="flex flex-wrap gap-2">' +
        nc.capabilities.map(function (cap) {
          return '<span class="inline-flex items-center px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-sm">' + formatText(cap) + '</span>';
        }).join('') +
      '</div></div>');
    }

    if (nc.tags && nc.tags.length > 0) {
      contentParts.push('<div><h4 class="font-semibold text-gray-900 mb-2">Tags</h4><div class="flex flex-wrap gap-2">' +
        nc.tags.map(function (tag) {
          return '<span class="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-600 rounded text-sm">' + tag + '</span>';
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

    document.getElementById('connectorDetailsModal').classList.remove('hidden');
  }

  function closeDetailsModal() {
    document.getElementById('connectorDetailsModal').classList.add('hidden');
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

    var modalIcon = document.querySelector('#connectorActionsModal .w-20.h-20');
    var logoUrl = (connector.manifest && connector.manifest.icon) || connector.logo_url || connector.logo || connector.icon;

    if (logoUrl) {
      modalIcon.className = 'w-20 h-20 mx-auto mb-4 bg-white border-2 border-gray-200 rounded-2xl flex items-center justify-center p-3';
      modalIcon.innerHTML = '<img src="' + logoUrl + '" alt="' + connectorName + '" class="w-full h-full object-contain">';
    } else {
      modalIcon.className = 'w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center';
      modalIcon.innerHTML = '<span class="text-3xl font-bold text-white">' + connectorName.charAt(0).toUpperCase() + '</span>';
    }

    var systemConnectors = ['case-actionstep', 'crm-leadly', 'crm-gohighlevel'];
    var connectorType = connector.connector_type || connector.connector_id || connectorId;
    var isSystemConnector = systemConnectors.indexOf(connectorType) !== -1;

    var deleteButton = document.getElementById('actionDelete');
    deleteButton.style.display = isSystemConnector ? 'none' : 'flex';

    var modal = document.getElementById('connectorActionsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeConnectorActionsModal(clearSelection) {
    if (clearSelection === undefined) clearSelection = true;
    var modal = document.getElementById('connectorActionsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
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

    document.getElementById('uninstallConfirmMessage').innerHTML =
      'Are you sure you want to uninstall <strong>"' + connectorName + '"</strong>?';

    closeConnectorActionsModal(false);
    showUninstallConfirmModal();
  }

  function showUninstallConfirmModal() {
    var modal = document.getElementById('uninstallConfirmModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeUninstallConfirmModal() {
    var modal = document.getElementById('uninstallConfirmModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    selectedConnectorForActions = null;
  }

  function confirmUninstallConnector() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'this connector';

    closeUninstallConfirmModal();

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

    var messageEl = document.getElementById('deleteConfirmMessage');
    if (!messageEl) return;

    messageEl.innerHTML = 'Are you sure you want to permanently delete <strong>"' + connectorName + '"</strong>?';

    closeConnectorActionsModal(false);
    showDeleteConfirmModal();
  }

  function showDeleteConfirmModal() {
    var modal = document.getElementById('deleteConfirmModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeDeleteConfirmModal() {
    var modal = document.getElementById('deleteConfirmModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    selectedConnectorForActions = null;
  }

  function confirmDeleteConnector() {
    if (!selectedConnectorForActions) return;

    var connector = selectedConnectorForActions;
    var connectorName = (connector.manifest && connector.manifest.name) || connector.name || connector.connector_name || 'this connector';

    closeDeleteConfirmModal();

    api.delete('/api/v1/integrations/connectors/' + connector.id).then(function () {
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

    var searchTerm = searchInput.value.toLowerCase();
    var categoryVal = categoryFilterEl.value;
    var authTypeVal = authTypeFilterEl.value;

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

    searchInput.addEventListener('input', function () {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(filterAvailableConnectors, 300);
    });

    categoryFilterEl.addEventListener('change', filterAvailableConnectors);
    authTypeFilterEl.addEventListener('change', filterAvailableConnectors);
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
              availableContainer.innerHTML = '<p class="text-sm text-gray-500 text-center py-8 col-span-full">All available connectors are already installed.</p>';
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
            '<div class="col-span-full bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">' +
              '<svg class="w-12 h-12 text-yellow-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>' +
              '</svg>' +
              '<p class="text-sm text-yellow-800 font-medium mb-1">Connector registry unavailable</p>' +
              '<p class="text-xs text-yellow-700">Cannot fetch available connectors from the registry. Check your network connection or contact support.</p>' +
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
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    clearConnectorFile();
  }

  function closeImportConnectorModal() {
    var modal = document.getElementById('importConnectorModal');
    if (!modal) return;
    modal.classList.remove('flex');
    modal.classList.add('hidden');
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
    el.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-lg p-4"><div class="flex gap-3"><svg class="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><div><h4 class="text-sm font-semibold text-red-900 mb-1">Validation Error</h4><p class="text-sm text-red-800 whitespace-pre-line">' + message + '</p></div></div></div>';
  }

  function showValidationWarning(message) {
    var el = document.getElementById('validationStatus');
    if (!el) return;
    el.innerHTML = '<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4"><div class="flex gap-3"><svg class="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg><div><h4 class="text-sm font-semibold text-yellow-900 mb-1">Validation Warning</h4><p class="text-sm text-yellow-800 whitespace-pre-line">' + message + '</p></div></div></div>';
  }

  function showValidationSuccess(message) {
    var el = document.getElementById('validationStatus');
    if (!el) return;
    el.innerHTML = '<div class="bg-green-50 border border-green-200 rounded-lg p-4"><div class="flex gap-3"><svg class="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><div><h4 class="text-sm font-semibold text-green-900 mb-1">Valid Configuration</h4><p class="text-sm text-green-800">' + message + '</p></div></div></div>';
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

    var baseUrl = (window.lanaAPI && window.lanaAPI.baseUrl) || (window.LanaConfig && window.LanaConfig.API_BASE_URL) || '';

    if (!baseUrl) {
      Lex.Toast.error('API server not configured. Please set API_BASE_URL in config.js or connect to a server.');
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = originalBtnText;
      }
      return;
    }

    var uploadUrl = baseUrl + '/api/connectors/ui/import';

    fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + localStorage.getItem('token')
      },
      body: formData
    }).then(function (response) {
      return response.json().then(function (result) {
        if (response.ok && result.success) {
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
          throw new Error(result.error || result.message || 'Failed to import connector');
        }
      });
    }).catch(function (error) {
      console.error('Import error:', error);

      var errorMessage = error.message;
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
      } else if (errorMessage.includes('fetch')) {
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
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    var highlightEvents = ['dragenter', 'dragover'];
    highlightEvents.forEach(function (eventName) {
      dropZone.addEventListener(eventName, function () {
        dropZone.classList.add('border-indigo-400', 'bg-indigo-50');
      }, false);
    });

    var unhighlightEvents = ['dragleave', 'drop'];
    unhighlightEvents.forEach(function (eventName) {
      dropZone.addEventListener(eventName, function () {
        dropZone.classList.remove('border-indigo-400', 'bg-indigo-50');
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
    if (e.key === 'Escape') {
      closeDetailsModal();
      closeConnectorActionsModal();
      closeUninstallConfirmModal();
      closeDeleteConfirmModal();

      var importModal = document.getElementById('importConnectorModal');
      if (importModal && !importModal.classList.contains('hidden')) {
        closeImportConnectorModal();
      }
    }
  }

  function setupEventListeners() {
    trackDocListener('keydown', handleEscapeKey);

    // Modal background click handlers
    var detailsModal = document.getElementById('connectorDetailsModal');
    if (detailsModal) {
      detailsModal.addEventListener('click', function (e) {
        if (e.target.id === 'connectorDetailsModal') closeDetailsModal();
      });
    }

    var actionsModal = document.getElementById('connectorActionsModal');
    if (actionsModal) {
      actionsModal.addEventListener('click', function (e) {
        if (e.target.id === 'connectorActionsModal') closeConnectorActionsModal();
      });
    }

    var uninstallModal = document.getElementById('uninstallConfirmModal');
    if (uninstallModal) {
      uninstallModal.addEventListener('click', function (e) {
        if (e.target.id === 'uninstallConfirmModal') closeUninstallConfirmModal();
      });
    }

    var deleteModal = document.getElementById('deleteConfirmModal');
    if (deleteModal) {
      deleteModal.addEventListener('click', function (e) {
        if (e.target.id === 'deleteConfirmModal') closeDeleteConfirmModal();
      });
    }

    // Search and filters
    setupSearchAndFilters();

    // Drag and drop
    setupDragAndDrop();
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
    exposeGlobal('closeUninstallConfirmModal', closeUninstallConfirmModal);
    exposeGlobal('confirmUninstallConnector', confirmUninstallConnector);
    exposeGlobal('deleteConnector', deleteConnector);
    exposeGlobal('showDeleteConfirmModal', showDeleteConfirmModal);
    exposeGlobal('closeDeleteConfirmModal', closeDeleteConfirmModal);
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
      document.removeEventListener(entry.event, entry.handler);
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
  if (window.LexRouter) {
    LexRouter.registerView({ onEnter: onEnter, onLeave: onLeave });
  }
  onEnter();

})();

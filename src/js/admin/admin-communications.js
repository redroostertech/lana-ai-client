/* Communications Admin - safe setup and readiness controls. */

(function () {
  'use strict';

  var BASE_ENDPOINT = '/api/v1/communications';
  var READINESS_ENDPOINT = BASE_ENDPOINT + '/ready';
  var STATUS_ENDPOINT = BASE_ENDPOINT + '/status';
  var REGISTRY_ENDPOINT = BASE_ENDPOINT + '/provider-registry';
  var PROVIDERS_ENDPOINT = BASE_ENDPOINT + '/providers';
  var ROUTES_ENDPOINT = BASE_ENDPOINT + '/routes';
  var TEST_PREVIEW_ENDPOINT = BASE_ENDPOINT + '/test-send/preview';
  var REQUIRED_PROVIDER_KEYS = ['telnyx', 'gmail', 'microsoft365', 'mailgun'];

  var DEFAULT_PROVIDERS = {
    telnyx: {
      key: 'telnyx',
      provider_key: 'telnyx',
      display_name: 'Telnyx',
      channels: ['sms', 'voice'],
      status: 'metadata_only',
      auth: { mode: 'api_key', config_keys: ['TELNYX_API_KEY', 'TELNYX_MESSAGING_PROFILE_ID'] },
      capabilities: { outbound: ['sms', 'voice'], inbound: ['sms', 'voice'], delivery_events: true, webhooks: true },
      metadata: { provider_type: 'telephony', network_calls: false }
    },
    gmail: {
      key: 'gmail',
      provider_key: 'gmail',
      display_name: 'Gmail',
      channels: ['email'],
      status: 'metadata_only',
      auth: { mode: 'existing_connector', connector: 'gmail' },
      capabilities: { outbound: ['email'], inbound: ['email'], threads: true, attachments: true },
      metadata: { provider_type: 'email', auth_owner: 'connectors', network_calls: false }
    },
    microsoft365: {
      key: 'microsoft365',
      provider_key: 'microsoft365',
      display_name: 'Microsoft 365',
      channels: ['email'],
      status: 'metadata_only',
      auth: { mode: 'existing_connector', connector: 'microsoft-outlook' },
      capabilities: { outbound: ['email'], inbound: ['email'], threads: true, attachments: true },
      metadata: { provider_type: 'email', auth_owner: 'connectors', network_calls: false }
    },
    mailgun: {
      key: 'mailgun',
      provider_key: 'mailgun',
      display_name: 'Mailgun',
      channels: ['email'],
      status: 'metadata_only',
      auth: { mode: 'api_key', config_keys: ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_FROM'] },
      capabilities: { outbound: ['email'], inbound: ['email'], delivery_events: true, webhooks: true },
      metadata: { provider_type: 'email', network_calls: false }
    }
  };

  var CREDENTIAL_FIELDS = {
    mailgun: [
      { key: 'api_key', label: 'API key', type: 'password', placeholder: 'Mailgun API key' },
      { key: 'domain', label: 'Domain', type: 'text', placeholder: 'mg.example.com' },
      { key: 'from', label: 'From address', type: 'text', placeholder: 'noreply@example.com' }
    ],
    telnyx: [
      { key: 'api_key', label: 'API key', type: 'password', placeholder: 'Telnyx API key' },
      { key: 'from', label: 'From number', type: 'text', placeholder: '+15555550100' },
      { key: 'messaging_profile_id', label: 'Messaging profile', type: 'text', placeholder: 'Optional profile id' }
    ]
  };

  var state = {
    readiness: null,
    appStatus: null,
    registryProviders: [],
    providers: [],
    routes: [],
    endpoints: {
      readiness: 'loading',
      status: 'loading',
      registry: 'loading',
      providers: 'loading',
      routes: 'loading'
    }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    if (window.Lex && Lex.Utils && typeof Lex.Utils.escapeHtml === 'function') {
      return Lex.Utils.escapeHtml(value);
    }
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(type, message) {
    if (window.Lex && Lex.Toast && typeof Lex.Toast[type] === 'function') {
      Lex.Toast[type](message);
    }
  }

  function setStatus(id, message, isError) {
    var node = el(id);
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('text-red-600', !!isError);
    node.classList.toggle('lex-text-secondary', !isError);
  }

  function canViewCommunicationsAdmin() {
    return !!(window.Lex && Lex.Auth && (
      Lex.Auth.hasRole('system_admin') ||
      Lex.Auth.hasRole('org_admin') ||
      Lex.Auth.hasRole('organization_admin')
    ));
  }

  function setHidden(node, hidden) {
    if (node) node.classList.toggle('hidden', !!hidden);
  }

  function normalizeProviderKey(key) {
    var normalized = String(key || '').trim().toLowerCase();
    if (normalized === 'm365' || normalized === 'office365' || normalized === 'outlook' || normalized === 'microsoft-outlook') {
      return 'microsoft365';
    }
    return normalized;
  }

  function titleCase(value) {
    return String(value || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function readDataArray(response, key) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.data)) return response.data;
    if (response && Array.isArray(response[key])) return response[key];
    return [];
  }

  function readDataObject(response) {
    return response && response.data ? response.data : response;
  }

  function formatList(values) {
    if (!Array.isArray(values) || values.length === 0) return 'None listed';
    return values.map(function (value) { return titleCase(value); }).join(', ');
  }

  function formatDate(value) {
    if (window.Lex && Lex.Utils && typeof Lex.Utils.formatDate === 'function') return Lex.Utils.formatDate(value);
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
  }

  function statusColor(status) {
    var normalized = String(status || '').toLowerCase();
    if (normalized === 'active' || normalized === 'enabled' || normalized === 'ready' || normalized === 'ok' || normalized === 'true' || normalized === 'loaded') return 'green';
    if (normalized === 'metadata_only' || normalized === 'preview' || normalized === 'not_ready' || normalized === 'loading' || normalized === 'warning') return 'yellow';
    if (normalized === 'disabled' || normalized === 'inactive' || normalized === 'unavailable' || normalized === 'false') return 'gray';
    if (normalized === 'error' || normalized === 'failed') return 'red';
    return 'blue';
  }

  function appendBadge(container, label, color) {
    var badge = document.createElement('lex-badge');
    badge.setAttribute('label', label);
    badge.setAttribute('color', color || 'gray');
    container.appendChild(badge);
  }

  function providerLabel(provider) {
    return provider.display_name || provider.provider_display_name || titleCase(provider.provider_key || provider.key);
  }

  function providerChannels(provider) {
    if (Array.isArray(provider.channels)) return provider.channels;
    if (provider.channel) return [provider.channel];
    return [];
  }

  function registryProviderForKey(key) {
    key = normalizeProviderKey(key);
    for (var i = 0; i < state.registryProviders.length; i++) {
      if (normalizeProviderKey(state.registryProviders[i].key || state.registryProviders[i].provider_key) === key) {
        return state.registryProviders[i];
      }
    }
    return DEFAULT_PROVIDERS[key] || null;
  }

  function providerById(id) {
    return state.providers.find(function (provider) { return provider.id === id; }) || null;
  }

  function routeById(id) {
    return state.routes.find(function (route) { return route.id === id; }) || null;
  }

  function isConnectorOwned(providerOrRegistry) {
    var key = normalizeProviderKey(providerOrRegistry && (providerOrRegistry.provider_key || providerOrRegistry.key));
    var registry = providerOrRegistry && providerOrRegistry.auth ? providerOrRegistry : registryProviderForKey(key);
    return Boolean(registry && registry.auth && registry.auth.mode === 'existing_connector');
  }

  function mergeRequiredProviders(registryProviders) {
    var byKey = {};
    REQUIRED_PROVIDER_KEYS.forEach(function (key) {
      byKey[key] = Object.assign({}, DEFAULT_PROVIDERS[key]);
    });
    registryProviders.forEach(function (provider) {
      var key = normalizeProviderKey(provider.key || provider.provider_key);
      if (REQUIRED_PROVIDER_KEYS.indexOf(key) !== -1) {
        byKey[key] = Object.assign({}, DEFAULT_PROVIDERS[key], provider, { key: key, provider_key: key });
      }
    });
    return REQUIRED_PROVIDER_KEYS.map(function (key) { return byKey[key]; });
  }

  function endpointMissing(err) {
    return !!(err && (err.status === 404 || err.status === 501 || err.status === 503));
  }

  function endpointStatusLabel(status) {
    if (status === 'loaded') return 'Loaded';
    if (status === 'unavailable') return 'Unavailable';
    if (status === 'error') return 'Error';
    return 'Loading';
  }

  function renderEndpointBadge(container, name, status) {
    appendBadge(container, name + ': ' + endpointStatusLabel(status), statusColor(status));
  }

  function renderReadiness() {
    var badgeSlot = el('readinessBadgeSlot');
    var text = el('readinessStatusText');
    var readiness = state.readiness || {};
    var appStatus = state.appStatus || {};
    var ready = Boolean(readiness.ready || appStatus.ready);
    var status = readiness.status || (ready ? 'ready' : 'not_ready');

    if (badgeSlot) {
      badgeSlot.innerHTML = '';
      appendBadge(badgeSlot, titleCase(status), statusColor(status));
      appendBadge(badgeSlot, 'Admin gated', 'blue');
      appendBadge(badgeSlot, 'No destructive controls', 'green');
      renderEndpointBadge(badgeSlot, 'ready', state.endpoints.readiness);
      renderEndpointBadge(badgeSlot, 'status', state.endpoints.status);
    }

    if (text) {
      if (state.endpoints.readiness === 'unavailable' && state.endpoints.status === 'unavailable') {
        text.textContent = 'Communications endpoints are not available in this environment.';
      } else if (ready) {
        text.textContent = 'Communications storage is ready. Delivery still depends on provider and route readiness.';
      } else {
        text.textContent = readiness.error || 'Communications is not ready for production delivery.';
      }
    }

    setCount('providerCountText', appStatus.counts && appStatus.counts.providers, state.providers.length);
    setCount('routeCountText', appStatus.counts && appStatus.counts.routes, state.routes.length);
    renderReadinessChecks(readiness.checks || {});
    renderConfigStatus(appStatus.config || readiness.config || {});
  }

  function setCount(id, preferred, fallback) {
    var node = el(id);
    if (!node) return;
    var value = preferred;
    if (value === undefined || value === null) value = fallback;
    node.textContent = value === undefined || value === null ? '--' : String(value);
  }

  function renderReadinessChecks(checks) {
    var container = el('readinessChecks');
    if (!container) return;
    var keys = Object.keys(checks || {});
    if (!keys.length) {
      container.innerHTML = '<div class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm lex-text-secondary">No readiness checks reported yet.</div>';
      return;
    }
    container.innerHTML = keys.map(function (key) {
      var value = checks[key];
      var healthy = value === true || value === 'ok' || value === 'ready' || (value && value.ready === true);
      var label = value && typeof value === 'object' ? (value.status || value.message || JSON.stringify(value)) : String(value);
      return [
        '<div class="rounded-lg border border-gray-200 bg-white p-4">',
          '<div class="flex items-start justify-between gap-3">',
            '<div>',
              '<div class="text-sm font-semibold lex-text-primary">' + esc(titleCase(key)) + '</div>',
              '<div class="mt-1 text-xs lex-text-muted">' + esc(label) + '</div>',
            '</div>',
            '<lex-badge label="' + esc(healthy ? 'Ready' : 'Check') + '" color="' + esc(healthy ? 'green' : 'yellow') + '"></lex-badge>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderConfigStatus(config) {
    var container = el('configStatusGrid');
    if (!container) return;
    var items = [
      ['Provider network', config.provider_network_enabled === true ? 'Enabled' : 'Disabled', 'Live provider calls are gated server-side.', config.provider_network_enabled === true ? 'green' : 'yellow'],
      ['Dispatch mode', config.dispatch_mode || 'Unknown', config.dispatch_queue ? 'Queue: ' + config.dispatch_queue : 'Queue not reported.', config.dispatch_mode === 'queue' ? 'green' : 'gray'],
      ['Encrypted config', config.encrypted_provider_config_enabled === true ? 'Enabled' : 'Disabled', 'Provider config encryption availability.', config.encrypted_provider_config_enabled === true ? 'green' : 'yellow'],
      ['Env-only config', config.env_only_provider_config_supported === true ? 'Supported' : 'Unknown', 'Secrets can remain outside this client UI.', config.env_only_provider_config_supported === true ? 'green' : 'gray']
    ];
    container.innerHTML = items.map(function (item) {
      return [
        '<div class="rounded-lg border border-gray-200 bg-white p-4">',
          '<div class="flex items-start justify-between gap-3">',
            '<div>',
              '<div class="text-sm font-semibold lex-text-primary">' + esc(item[0]) + '</div>',
              '<div class="mt-1 text-lg font-semibold lex-text-primary">' + esc(titleCase(item[1])) + '</div>',
              '<div class="mt-1 text-xs lex-text-muted">' + esc(item[2]) + '</div>',
            '</div>',
            '<lex-badge label="' + esc(item[1]) + '" color="' + esc(item[3]) + '"></lex-badge>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function buildCapabilityRows(provider) {
    var capabilities = provider.capabilities || {};
    var featureFlags = [];
    if (capabilities.threads) featureFlags.push('Threads');
    if (capabilities.attachments) featureFlags.push('Attachments');
    if (capabilities.delivery_events) featureFlags.push('Delivery events');
    if (capabilities.webhooks) featureFlags.push('Webhooks');
    return [
      { label: 'Outbound', value: formatList(capabilities.outbound) },
      { label: 'Inbound', value: formatList(capabilities.inbound) },
      { label: 'Features', value: featureFlags.length ? featureFlags.join(', ') : 'None listed' }
    ];
  }

  function renderProviderCard(provider) {
    var card = document.createElement('lex-card');
    card.setAttribute('heading', provider.display_name || titleCase(provider.key));
    card.setAttribute('subtitle', titleCase((provider.metadata && provider.metadata.provider_type) || 'provider'));

    var body = document.createElement('div');
    body.className = 'space-y-4';

    var badgeRow = document.createElement('div');
    badgeRow.className = 'flex flex-wrap gap-2';
    appendBadge(badgeRow, 'Registry', 'blue');
    appendBadge(badgeRow, provider.status ? titleCase(provider.status) : 'Metadata', statusColor(provider.status));
    appendBadge(badgeRow, isConnectorOwned(provider) ? 'Connector auth' : 'Encrypted config', isConnectorOwned(provider) ? 'blue' : 'green');

    var channels = document.createElement('div');
    channels.className = 'flex flex-wrap gap-2';
    providerChannels(provider).forEach(function (channel) { appendBadge(channels, titleCase(channel), 'blue'); });
    if (!providerChannels(provider).length) appendBadge(channels, 'No channels', 'gray');

    var rows = document.createElement('dl');
    rows.className = 'space-y-3';
    buildCapabilityRows(provider).forEach(function (capability) {
      rows.innerHTML += [
        '<div class="rounded-lg border border-gray-200 bg-gray-50 p-3">',
          '<dt class="text-xs font-semibold uppercase tracking-wide lex-text-muted">' + esc(capability.label) + '</dt>',
          '<dd class="mt-1 text-sm lex-text-primary">' + esc(capability.value) + '</dd>',
        '</div>'
      ].join('');
    });

    var auth = document.createElement('p');
    auth.className = 'text-xs lex-text-muted';
    auth.textContent = 'Setup mode: ' + titleCase(provider.auth && provider.auth.mode ? provider.auth.mode : 'not available');

    body.appendChild(badgeRow);
    body.appendChild(channels);
    body.appendChild(rows);
    body.appendChild(auth);
    card.appendChild(body);
    return card;
  }

  function renderProviders() {
    var container = el('providerCards');
    if (!container) return;
    container.innerHTML = '';
    state.registryProviders.forEach(function (provider) {
      container.appendChild(renderProviderCard(provider));
    });
    populateProviderFormOptions();
  }

  function setRegistryStatus(label, message, color) {
    var textNode = el('registryStatusText');
    var badge = el('registryStatusBadge');
    if (textNode) textNode.textContent = message;
    if (badge) {
      badge.setAttribute('label', label);
      badge.setAttribute('color', color || 'gray');
    }
  }

  function renderEmpty(container, message) {
    if (!container) return;
    container.innerHTML = '<div class="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm lex-text-secondary">' + esc(message) + '</div>';
  }

  function readinessBadges(readiness) {
    if (!readiness) return '<lex-badge label="Readiness unknown" color="gray"></lex-badge>';
    var blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
    return [
      '<lex-badge label="' + esc(readiness.ready ? 'Ready' : 'Not ready') + '" color="' + esc(readiness.ready ? 'green' : 'yellow') + '"></lex-badge>',
      blockers.length ? '<lex-badge label="' + esc(blockers.length + ' blocker' + (blockers.length === 1 ? '' : 's')) + '" color="yellow"></lex-badge>' : ''
    ].join('');
  }

  function renderProviderInstances() {
    var status = el('providerInstancesStatus');
    var container = el('providerInstancesList');
    if (!container) return;

    if (state.endpoints.providers !== 'loaded') {
      if (status) status.textContent = 'Provider instance endpoint is unavailable. Existing account status cannot be listed here.';
      renderEmpty(container, 'No provider instances can be listed from this environment.');
      populateProviderFormOptions();
      return;
    }

    if (status) {
      status.textContent = state.providers.length
        ? state.providers.length + ' provider instance' + (state.providers.length === 1 ? '' : 's') + ' found.'
        : 'No provider instances have been created yet.';
    }
    if (!state.providers.length) {
      renderEmpty(container, 'No provider instances reported by the communications service.');
      populateProviderFormOptions();
      return;
    }

    container.innerHTML = state.providers.map(function (provider) {
      var readiness = provider.readiness || {};
      return [
        '<div class="rounded-lg border border-gray-200 bg-white p-4">',
          '<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">',
            '<div>',
              '<div class="text-sm font-semibold lex-text-primary">' + esc(providerLabel(provider)) + '</div>',
              '<div class="mt-1 text-xs lex-text-muted">' + esc(provider.provider_key || 'provider') + ' / ' + esc(provider.channel || 'channel') + '</div>',
            '</div>',
            '<div class="flex flex-wrap gap-2">',
              '<lex-badge label="' + esc(titleCase(provider.status || 'active')) + '" color="' + esc(statusColor(provider.status || 'active')) + '"></lex-badge>',
              readinessBadges(readiness),
            '</div>',
          '</div>',
          '<div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs lex-text-secondary">',
            '<div><span class="font-semibold lex-text-primary">ID:</span> ' + esc(provider.id || 'Unknown') + '</div>',
            '<div><span class="font-semibold lex-text-primary">Auth owner:</span> ' + esc(isConnectorOwned(provider) ? 'connectors' : 'communications') + '</div>',
            '<div><span class="font-semibold lex-text-primary">Created:</span> ' + esc(provider.created_at ? formatDate(provider.created_at) : 'Unknown') + '</div>',
          '</div>',
          '<div class="mt-3 flex flex-wrap gap-2">',
            '<button type="button" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium lex-text-primary" data-provider-edit="' + esc(provider.id) + '">Edit</button>',
            '<button type="button" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium lex-text-primary" data-provider-readiness="' + esc(provider.id) + '">Refresh readiness</button>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
    populateProviderFormOptions();
  }

  function renderRoutes() {
    var status = el('routesStatus');
    var container = el('routesList');
    if (!container) return;

    if (state.endpoints.routes !== 'loaded') {
      if (status) status.textContent = 'Route endpoint is unavailable. Route status cannot be listed here.';
      renderEmpty(container, 'No routes can be listed from this environment.');
      populateRouteControls();
      return;
    }

    if (status) {
      status.textContent = state.routes.length
        ? state.routes.length + ' route' + (state.routes.length === 1 ? '' : 's') + ' found.'
        : 'No routes have been created yet.';
    }
    if (!state.routes.length) {
      renderEmpty(container, 'No communications routes reported by the communications service.');
      populateRouteControls();
      return;
    }

    container.innerHTML = state.routes.map(function (route) {
      return [
        '<div class="rounded-lg border border-gray-200 bg-white p-4">',
          '<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">',
            '<div>',
              '<div class="text-sm font-semibold lex-text-primary">' + esc(route.display_name || route.route_key || 'Route') + '</div>',
              '<div class="mt-1 text-xs lex-text-muted">' + esc(route.route_key || 'route') + ' / ' + esc(route.provider_display_name || route.provider_key || 'provider') + '</div>',
            '</div>',
            '<div class="flex flex-wrap gap-2">',
              '<lex-badge label="' + esc(titleCase(route.channel || 'channel')) + '" color="blue"></lex-badge>',
              '<lex-badge label="' + esc(titleCase(route.direction || 'outbound')) + '" color="gray"></lex-badge>',
              '<lex-badge label="' + esc(route.is_enabled === false ? 'Disabled' : 'Enabled') + '" color="' + esc(route.is_enabled === false ? 'gray' : 'green') + '"></lex-badge>',
              readinessBadges(route.readiness),
            '</div>',
          '</div>',
          '<div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs lex-text-secondary">',
            '<div><span class="font-semibold lex-text-primary">Priority:</span> ' + esc(route.priority === undefined || route.priority === null ? 100 : route.priority) + '</div>',
            '<div><span class="font-semibold lex-text-primary">Identity:</span> ' + esc(route.identity_display_name || route.identity_key || 'None') + '</div>',
            '<div><span class="font-semibold lex-text-primary">Created:</span> ' + esc(route.created_at ? formatDate(route.created_at) : 'Unknown') + '</div>',
          '</div>',
          '<div class="mt-3 flex flex-wrap gap-2">',
            '<button type="button" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium lex-text-primary" data-route-edit="' + esc(route.id) + '">Edit</button>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
    populateRouteControls();
  }

  function setEndpoint(name, status) {
    state.endpoints[name] = status;
  }

  function populateProviderFormOptions() {
    var providerKeySelect = el('providerKeySelect');
    var providerEditSelect = el('providerEditSelect');
    if (providerKeySelect) {
      var selected = providerKeySelect.value;
      providerKeySelect.innerHTML = state.registryProviders.map(function (provider) {
        var key = normalizeProviderKey(provider.key || provider.provider_key);
        return '<option value="' + esc(key) + '">' + esc(provider.display_name || titleCase(key)) + '</option>';
      }).join('');
      if (selected) providerKeySelect.value = selected;
    }
    if (providerEditSelect) {
      var current = providerEditSelect.value;
      providerEditSelect.innerHTML = '<option value="">Create new provider</option>' + state.providers.map(function (provider) {
        return '<option value="' + esc(provider.id) + '">' + esc(providerLabel(provider)) + ' (' + esc(provider.channel || 'channel') + ')</option>';
      }).join('');
      if (current) providerEditSelect.value = current;
    }
    refreshProviderChannels();
    renderCredentialFields();
  }

  function refreshProviderChannels() {
    var keySelect = el('providerKeySelect');
    var channelSelect = el('providerChannelSelect');
    if (!keySelect || !channelSelect) return;
    var selectedChannel = channelSelect.value;
    var registry = registryProviderForKey(keySelect.value) || state.registryProviders[0];
    var channels = providerChannels(registry);
    channelSelect.innerHTML = channels.map(function (channel) {
      return '<option value="' + esc(channel) + '">' + esc(titleCase(channel)) + '</option>';
    }).join('');
    if (selectedChannel && channels.indexOf(selectedChannel) !== -1) channelSelect.value = selectedChannel;
  }

  function fillProviderForm(providerId) {
    var provider = providerById(providerId);
    var keySelect = el('providerKeySelect');
    var editSelect = el('providerEditSelect');
    var displayInput = el('providerDisplayNameInput');
    var statusSelect = el('providerStatusSelect');
    var channelSelect = el('providerChannelSelect');
    var readinessBtn = el('providerReadinessBtn');

    if (editSelect) editSelect.value = providerId || '';
    if (!provider) {
      if (keySelect) keySelect.disabled = false;
      if (channelSelect) channelSelect.disabled = false;
      if (displayInput) displayInput.value = '';
      if (statusSelect) statusSelect.value = 'active';
      if (readinessBtn) readinessBtn.setAttribute('disabled', 'disabled');
      refreshProviderChannels();
      renderCredentialFields();
      return;
    }

    if (keySelect) {
      keySelect.value = normalizeProviderKey(provider.provider_key);
      keySelect.disabled = true;
    }
    refreshProviderChannels();
    if (channelSelect) {
      channelSelect.value = provider.channel || channelSelect.value;
      channelSelect.disabled = true;
    }
    if (displayInput) displayInput.value = provider.display_name || '';
    if (statusSelect) statusSelect.value = provider.status || 'active';
    if (readinessBtn) readinessBtn.removeAttribute('disabled');
    renderCredentialFields();
  }

  function renderCredentialFields() {
    var container = el('credentialFields');
    var badge = el('credentialModeBadge');
    var saveButton = el('saveCredentialsBtn');
    var selectedProvider = providerById(el('providerEditSelect') && el('providerEditSelect').value);
    if (!container) return;

    container.innerHTML = '';
    if (!selectedProvider) {
      if (badge) {
        badge.setAttribute('label', 'Select provider');
        badge.setAttribute('color', 'gray');
      }
      if (saveButton) saveButton.setAttribute('disabled', 'disabled');
      renderEmpty(container, 'Choose an existing provider to update encrypted credentials.');
      return;
    }

    if (isConnectorOwned(selectedProvider)) {
      if (badge) {
        badge.setAttribute('label', 'Connector owned');
        badge.setAttribute('color', 'blue');
      }
      if (saveButton) saveButton.setAttribute('disabled', 'disabled');
      renderEmpty(container, 'Gmail and Microsoft 365 credentials stay in connector administration.');
      return;
    }

    var key = normalizeProviderKey(selectedProvider.provider_key);
    var fields = CREDENTIAL_FIELDS[key] || [];
    if (!fields.length) {
      if (badge) {
        badge.setAttribute('label', 'No credential fields');
        badge.setAttribute('color', 'gray');
      }
      if (saveButton) saveButton.setAttribute('disabled', 'disabled');
      renderEmpty(container, 'This provider does not expose client-side credential update fields.');
      return;
    }

    if (badge) {
      badge.setAttribute('label', 'Encrypted update');
      badge.setAttribute('color', 'green');
    }
    if (saveButton) saveButton.removeAttribute('disabled');
    container.innerHTML = fields.map(function (field) {
      return [
        '<label class="block">',
          '<span class="block text-sm font-medium lex-text-primary mb-2">' + esc(field.label) + '</span>',
          '<input data-credential-key="' + esc(field.key) + '" type="' + esc(field.type) + '" class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="' + esc(field.placeholder) + '">',
        '</label>'
      ].join('');
    }).join('');
  }

  function populateRouteControls() {
    var providerSelect = el('routeProviderSelect');
    var routeEditSelect = el('routeEditSelect');
    var testRouteSelect = el('testRouteSelect');

    if (providerSelect) {
      var selectedProvider = providerSelect.value;
      providerSelect.innerHTML = state.providers.length
        ? state.providers.map(function (provider) {
          return '<option value="' + esc(provider.id) + '">' + esc(providerLabel(provider)) + ' (' + esc(provider.channel || 'channel') + ')</option>';
        }).join('')
        : '<option value="">Create a provider first</option>';
      if (selectedProvider) providerSelect.value = selectedProvider;
    }
    if (routeEditSelect) {
      var selectedRoute = routeEditSelect.value;
      routeEditSelect.innerHTML = '<option value="">Create new route</option>' + state.routes.map(function (route) {
        return '<option value="' + esc(route.id) + '">' + esc(route.display_name || route.route_key || route.id) + '</option>';
      }).join('');
      if (selectedRoute) routeEditSelect.value = selectedRoute;
    }
    if (testRouteSelect) {
      var previewRoutes = state.routes.filter(function (route) {
        return route.channel === 'email' || route.channel === 'sms';
      });
      testRouteSelect.innerHTML = previewRoutes.length
        ? previewRoutes.map(function (route) {
          return '<option value="' + esc(route.id) + '">' + esc(route.display_name || route.route_key || route.id) + ' (' + esc(route.channel || 'channel') + ')</option>';
        }).join('')
        : '<option value="">Create an email or SMS route first</option>';
    }
    syncRouteChannelToProvider();
  }

  function syncRouteChannelToProvider() {
    var provider = providerById(el('routeProviderSelect') && el('routeProviderSelect').value);
    var channelSelect = el('routeChannelSelect');
    if (provider && channelSelect) channelSelect.value = provider.channel || channelSelect.value;
  }

  function fillRouteForm(routeId) {
    var route = routeById(routeId);
    var routeEditSelect = el('routeEditSelect');
    if (routeEditSelect) routeEditSelect.value = routeId || '';

    if (!route) {
      ['routeKeyInput', 'routeDisplayNameInput'].forEach(function (id) {
        var node = el(id);
        if (node) node.value = '';
      });
      if (el('routePriorityInput')) el('routePriorityInput').value = '100';
      if (el('routeEnabledInput')) el('routeEnabledInput').checked = true;
      syncRouteChannelToProvider();
      return;
    }

    if (el('routeProviderSelect')) el('routeProviderSelect').value = route.provider_id || '';
    if (el('routeChannelSelect')) el('routeChannelSelect').value = route.channel || 'email';
    if (el('routeDirectionSelect')) el('routeDirectionSelect').value = route.direction || 'outbound';
    if (el('routeKeyInput')) el('routeKeyInput').value = route.route_key || '';
    if (el('routeDisplayNameInput')) el('routeDisplayNameInput').value = route.display_name || '';
    if (el('routePriorityInput')) el('routePriorityInput').value = route.priority === undefined || route.priority === null ? 100 : route.priority;
    if (el('routeEnabledInput')) el('routeEnabledInput').checked = route.is_enabled !== false;
  }

  function providerPayload() {
    var key = el('providerKeySelect') && el('providerKeySelect').value;
    var registry = registryProviderForKey(key);
    return {
      provider_key: key,
      display_name: (el('providerDisplayNameInput') && el('providerDisplayNameInput').value.trim()) || (registry && registry.display_name) || titleCase(key),
      channel: el('providerChannelSelect') && el('providerChannelSelect').value,
      status: el('providerStatusSelect') && el('providerStatusSelect').value,
      capabilities: registry && registry.capabilities ? registry.capabilities : undefined,
      metadata: {
        configured_from: 'communications_admin',
        auth_owner: isConnectorOwned(registry) ? 'connectors' : 'communications'
      }
    };
  }

  function routePayload() {
    return {
      provider_id: el('routeProviderSelect') && el('routeProviderSelect').value,
      route_key: el('routeKeyInput') && el('routeKeyInput').value.trim(),
      display_name: el('routeDisplayNameInput') && el('routeDisplayNameInput').value.trim(),
      channel: el('routeChannelSelect') && el('routeChannelSelect').value,
      direction: el('routeDirectionSelect') && el('routeDirectionSelect').value,
      priority: Number(el('routePriorityInput') && el('routePriorityInput').value || 100),
      is_enabled: Boolean(el('routeEnabledInput') && el('routeEnabledInput').checked),
      metadata: { configured_from: 'communications_admin' }
    };
  }

  function loadReadiness() {
    return api.get(READINESS_ENDPOINT).then(function (response) {
      state.readiness = response || {};
      setEndpoint('readiness', 'loaded');
    }).catch(function (err) {
      console.error('[admin-communications] load readiness error:', err);
      if (err && err.status === 503 && err.data) {
        state.readiness = err.data;
        setEndpoint('readiness', 'loaded');
        return;
      }
      state.readiness = null;
      setEndpoint('readiness', endpointMissing(err) ? 'unavailable' : 'error');
    });
  }

  function loadStatus() {
    return api.get(STATUS_ENDPOINT).then(function (response) {
      state.appStatus = response || {};
      setEndpoint('status', 'loaded');
    }).catch(function (err) {
      console.error('[admin-communications] load status error:', err);
      state.appStatus = null;
      setEndpoint('status', endpointMissing(err) ? 'unavailable' : 'error');
    });
  }

  function loadProviderRegistry() {
    state.registryProviders = mergeRequiredProviders([]);
    renderProviders();
    return api.get(REGISTRY_ENDPOINT).then(function (response) {
      state.registryProviders = mergeRequiredProviders(readDataArray(response, 'providers'));
      setEndpoint('registry', 'loaded');
      setRegistryStatus('Loaded', 'Provider registry loaded from the communications service.', 'green');
    }).catch(function (err) {
      console.error('[admin-communications] load provider registry error:', err);
      state.registryProviders = mergeRequiredProviders([]);
      setEndpoint('registry', endpointMissing(err) ? 'unavailable' : 'error');
      setRegistryStatus('Fallback', 'Provider registry could not be loaded. Showing expected providers from local metadata.', 'yellow');
    }).finally(renderProviders);
  }

  function loadProviderInstances() {
    var status = el('providerInstancesStatus');
    if (status) status.textContent = 'Loading provider instances...';
    return api.get(PROVIDERS_ENDPOINT).then(function (response) {
      state.providers = readDataArray(response, 'providers');
      setEndpoint('providers', 'loaded');
    }).catch(function (err) {
      console.error('[admin-communications] load provider instances error:', err);
      state.providers = [];
      setEndpoint('providers', endpointMissing(err) ? 'unavailable' : 'error');
    }).finally(renderProviderInstances);
  }

  function loadRoutes() {
    var status = el('routesStatus');
    if (status) status.textContent = 'Loading routes...';
    return api.get(ROUTES_ENDPOINT).then(function (response) {
      state.routes = readDataArray(response, 'routes');
      setEndpoint('routes', 'loaded');
    }).catch(function (err) {
      console.error('[admin-communications] load routes error:', err);
      state.routes = [];
      setEndpoint('routes', endpointMissing(err) ? 'unavailable' : 'error');
    }).finally(renderRoutes);
  }

  function refreshAll() {
    return Promise.allSettled([
      loadReadiness(),
      loadStatus(),
      loadProviderRegistry(),
      loadProviderInstances(),
      loadRoutes()
    ]).then(function () {
      renderReadiness();
      populateProviderFormOptions();
      populateRouteControls();
    });
  }

  function saveProvider(event) {
    if (event) event.preventDefault();
    var selectedId = el('providerEditSelect') && el('providerEditSelect').value;
    var payload = providerPayload();
    if (!payload.provider_key || !payload.channel) {
      setStatus('providerActionStatus', 'Provider and channel are required.', true);
      return Promise.resolve();
    }

    setStatus('providerActionStatus', 'Saving provider...', false);
    var request = selectedId
      ? api.put(PROVIDERS_ENDPOINT + '/' + encodeURIComponent(selectedId), payload)
      : api.post(PROVIDERS_ENDPOINT, payload);

    return request.then(function () {
      toast('success', selectedId ? 'Provider updated' : 'Provider created');
      setStatus('providerActionStatus', selectedId ? 'Provider updated.' : 'Provider created.', false);
      return Promise.allSettled([loadProviderInstances(), loadStatus()]).then(renderReadiness);
    }).catch(function (err) {
      setStatus('providerActionStatus', err.message || 'Failed to save provider.', true);
      toast('error', err.message || 'Failed to save provider');
    });
  }

  function saveCredentials(event) {
    if (event) event.preventDefault();
    var selectedId = el('providerEditSelect') && el('providerEditSelect').value;
    var provider = providerById(selectedId);
    if (!provider || isConnectorOwned(provider)) {
      setStatus('providerActionStatus', 'Credential updates are only available for communications-owned API key providers.', true);
      return Promise.resolve();
    }
    var config = {};
    document.querySelectorAll('[data-credential-key]').forEach(function (input) {
      if (input.value.trim()) config[input.getAttribute('data-credential-key')] = input.value.trim();
    });
    if (!Object.keys(config).length) {
      setStatus('providerActionStatus', 'Enter at least one credential value to update.', true);
      return Promise.resolve();
    }

    setStatus('providerActionStatus', 'Updating encrypted provider credentials...', false);
    return api.patch(PROVIDERS_ENDPOINT + '/' + encodeURIComponent(selectedId) + '/credentials', { config: config })
      .then(function () {
        toast('success', 'Credentials updated');
        setStatus('providerActionStatus', 'Encrypted provider credentials updated.', false);
        document.querySelectorAll('[data-credential-key]').forEach(function (input) { input.value = ''; });
        return Promise.allSettled([loadProviderInstances(), refreshProviderReadiness(selectedId, true)]);
      })
      .catch(function (err) {
        setStatus('providerActionStatus', err.message || 'Failed to update credentials.', true);
        toast('error', err.message || 'Failed to update credentials');
      });
  }

  function refreshProviderReadiness(providerId, quiet) {
    if (!providerId) {
      setStatus('providerActionStatus', 'Select a provider before checking readiness.', true);
      return Promise.resolve();
    }
    if (!quiet) setStatus('providerActionStatus', 'Refreshing provider readiness...', false);
    return api.get(PROVIDERS_ENDPOINT + '/' + encodeURIComponent(providerId) + '/readiness')
      .then(function (response) {
        var data = readDataObject(response);
        var message = data && data.readiness && data.readiness.ready
          ? 'Provider readiness passed.'
          : 'Provider readiness has blockers: ' + ((data && data.readiness && data.readiness.blockers || []).join(', ') || 'unknown');
        setStatus('providerActionStatus', message, !(data && data.readiness && data.readiness.ready));
        if (!quiet) toast(data && data.readiness && data.readiness.ready ? 'success' : 'warning', message);
        return loadProviderInstances();
      })
      .catch(function (err) {
        setStatus('providerActionStatus', err.message || 'Failed to refresh provider readiness.', true);
        if (!quiet) toast('error', err.message || 'Failed to refresh provider readiness');
      });
  }

  function saveRoute(event) {
    if (event) event.preventDefault();
    var selectedId = el('routeEditSelect') && el('routeEditSelect').value;
    var payload = routePayload();
    if (!payload.provider_id || !payload.route_key || !payload.channel) {
      setStatus('routeActionStatus', 'Provider, route key, and channel are required.', true);
      return Promise.resolve();
    }

    setStatus('routeActionStatus', 'Saving route...', false);
    var request = selectedId
      ? api.put(ROUTES_ENDPOINT + '/' + encodeURIComponent(selectedId), payload)
      : api.post(ROUTES_ENDPOINT, payload);

    return request.then(function () {
      toast('success', selectedId ? 'Route updated' : 'Route created');
      setStatus('routeActionStatus', selectedId ? 'Route updated.' : 'Route created.', false);
      return Promise.allSettled([loadRoutes(), loadStatus()]).then(renderReadiness);
    }).catch(function (err) {
      setStatus('routeActionStatus', err.message || 'Failed to save route.', true);
      toast('error', err.message || 'Failed to save route');
    });
  }

  function previewTestSend(event) {
    if (event) event.preventDefault();
    var route = routeById(el('testRouteSelect') && el('testRouteSelect').value);
    var recipient = el('testRecipientInput') && el('testRecipientInput').value.trim();
    var body = el('testBodyInput') && el('testBodyInput').value.trim();
    var subject = el('testSubjectInput') && el('testSubjectInput').value.trim();
    var resultNode = el('testPreviewResult');

    if (!route || !recipient || !body) {
      renderEmpty(resultNode, 'Route, recipient, and body/message are required for preview.');
      return Promise.resolve();
    }

    var payload = {
      route_id: route.id,
      channel: route.channel,
      to: recipient
    };
    if (route.channel === 'email') {
      payload.subject = subject || 'Communications preview';
      payload.body = body;
    } else {
      payload.message = body;
    }

    renderEmpty(resultNode, 'Previewing test send...');
    return api.post(TEST_PREVIEW_ENDPOINT, payload).then(function (response) {
      var data = readDataObject(response) || {};
      var readiness = data.readiness || {};
      resultNode.innerHTML = [
        '<div class="rounded-lg border border-gray-200 bg-white p-4">',
          '<div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">',
            '<div>',
              '<div class="text-sm font-semibold lex-text-primary">Preview complete</div>',
              '<div class="mt-1 text-xs lex-text-muted">No event was recorded and no provider dispatch was performed.</div>',
            '</div>',
            '<div class="flex flex-wrap gap-2">',
              '<lex-badge label="' + esc(data.preview_only ? 'Preview only' : 'Unexpected mode') + '" color="' + esc(data.preview_only ? 'blue' : 'red') + '"></lex-badge>',
              '<lex-badge label="' + esc(readiness.ready ? 'Route ready' : 'Route not ready') + '" color="' + esc(readiness.ready ? 'green' : 'yellow') + '"></lex-badge>',
            '</div>',
          '</div>',
          '<div class="mt-3 text-xs lex-text-secondary">Warnings: ' + esc((data.warnings || []).join(', ') || 'None') + '</div>',
        '</div>'
      ].join('');
      toast(readiness.ready ? 'success' : 'warning', readiness.ready ? 'Preview passed' : 'Preview returned readiness blockers');
    }).catch(function (err) {
      renderEmpty(resultNode, err.message || 'Test-send preview failed.');
      toast('error', err.message || 'Test-send preview failed');
    });
  }

  function wireEvents() {
    var refreshBtn = el('refreshCommunicationsBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      refreshAll().then(function () { toast('success', 'Communications readiness refreshed'); });
    });

    var providerForm = el('providerForm');
    if (providerForm) providerForm.addEventListener('submit', saveProvider);
    var saveProviderBtn = el('saveProviderBtn');
    if (saveProviderBtn) saveProviderBtn.addEventListener('click', saveProvider);

    var credentialForm = el('providerCredentialForm');
    if (credentialForm) credentialForm.addEventListener('submit', saveCredentials);
    var saveCredentialsBtn = el('saveCredentialsBtn');
    if (saveCredentialsBtn) saveCredentialsBtn.addEventListener('click', saveCredentials);

    var providerReadinessBtn = el('providerReadinessBtn');
    if (providerReadinessBtn) providerReadinessBtn.addEventListener('click', function () {
      refreshProviderReadiness(el('providerEditSelect') && el('providerEditSelect').value);
    });

    var routeForm = el('routeForm');
    if (routeForm) routeForm.addEventListener('submit', saveRoute);
    var saveRouteBtn = el('saveRouteBtn');
    if (saveRouteBtn) saveRouteBtn.addEventListener('click', saveRoute);

    var previewForm = el('testSendPreviewForm');
    if (previewForm) previewForm.addEventListener('submit', previewTestSend);
    var previewBtn = el('previewTestSendBtn');
    if (previewBtn) previewBtn.addEventListener('click', previewTestSend);

    var providerKeySelect = el('providerKeySelect');
    if (providerKeySelect) providerKeySelect.addEventListener('change', function () {
      refreshProviderChannels();
      renderCredentialFields();
    });

    var providerEditSelect = el('providerEditSelect');
    if (providerEditSelect) providerEditSelect.addEventListener('change', function () {
      fillProviderForm(providerEditSelect.value);
    });

    var routeProviderSelect = el('routeProviderSelect');
    if (routeProviderSelect) routeProviderSelect.addEventListener('change', syncRouteChannelToProvider);

    var routeEditSelect = el('routeEditSelect');
    if (routeEditSelect) routeEditSelect.addEventListener('change', function () {
      fillRouteForm(routeEditSelect.value);
    });

    document.addEventListener('click', function (event) {
      var providerEdit = event.target.closest('[data-provider-edit]');
      if (providerEdit) {
        fillProviderForm(providerEdit.getAttribute('data-provider-edit'));
        return;
      }
      var providerReadiness = event.target.closest('[data-provider-readiness]');
      if (providerReadiness) {
        var providerId = providerReadiness.getAttribute('data-provider-readiness');
        fillProviderForm(providerId);
        refreshProviderReadiness(providerId);
        return;
      }
      var routeEdit = event.target.closest('[data-route-edit]');
      if (routeEdit) fillRouteForm(routeEdit.getAttribute('data-route-edit'));
    });

    document.addEventListener('lex-refresh', function (event) {
      event.preventDefault();
      refreshAll();
    });
  }

  function init() {
    var surface = el('communicationsAdminSurface');
    var denied = el('communicationsAccessDenied');

    if (!canViewCommunicationsAdmin()) {
      setHidden(surface, true);
      setHidden(denied, false);
      if (window.Lex && Lex.Nav) Lex.Nav.go('admin/index.html', { replace: true });
      return;
    }

    setHidden(surface, false);
    setHidden(denied, true);
    wireEvents();
    renderReadiness();
    refreshAll();
  }

  init();
})();

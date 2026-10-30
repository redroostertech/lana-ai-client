/*
 * ConnectWizardModel - pure step model for the Guided Connect wizard.
 *
 * Turns the backend connector package (GET /api/v1/integrations/connectors/
 * catalog/:connectorType -> { connector, metadata }), the source's current
 * row (an item of GET /api/v1/integrations/connectors, when one exists), the
 * redirect URI answer and the user's capability into an ordered list of
 * wizard steps:
 *
 *   before_you_start, [choose_method], setup guide steps..., secure_it,
 *   [details], connect, result, sync, done
 *
 * The backend stays the source of truth: this module only reads the package
 * and maps it to view steps. It holds no field values, never logs, and the
 * only place values pass through is buildConfigPayload (the request body).
 * sanitizeForLog is the one way to put wizard values into a log line.
 *
 * No DOM, no network. Loaded as a browser global (window.ConnectWizardModel)
 * and as a CommonJS module for Jest.
 */
(function (global) {
  'use strict';

  // The literal token package guides use for the OAuth redirect URI.
  var REDIRECT_TOKEN = '{{oauth_redirect_uri}}';

  // The redirect URI older guides hard-code. It is still the right value for
  // OAuth apps that go through the connector bridge, so it is replaced only
  // when the redirect-uri endpoint says the connector uses the standard route.
  var LEGACY_REDIRECT_URI = 'https://lanaai.io/lana-ai/oauth/callback';

  var REDIRECT_FALLBACK_TEXT = 'the LANA redirect URL (ask an admin for it)';

  var SECRET_PLACEHOLDER = '[redacted]';

  // Key fragments that mark a value as a secret even when the package did not
  // declare it (defense in depth for sanitizeForLog).
  var SECRET_KEY_HINTS = ['secret', 'password', 'token', 'api_key', 'apikey', 'private_key', 'credential'];

  var AUTHORIZED_STATUSES = ['connected', 'active'];

  // Backend availability statuses (GET /api/v1/me/connections `available`)
  // that mean the user cannot connect this personal connector yet.
  var USER_BLOCKING_STATUSES = {
    permission_denied: 'You do not have permission to connect this account. Ask an admin.',
    disabled_by_organization: 'Your firm has turned this connector off. Ask an admin.',
    awaiting_admin_configuration: 'An admin has to finish setting up {name} before you can connect your account.',
    not_user_connectable: 'This connector is set up by an admin for the whole firm. Ask an admin to connect it.'
  };

  var SYNC_FREQUENCIES = [
    { value: 'hourly', label: 'Every hour' },
    { value: 'daily', label: 'Every day' },
    { value: 'weekly', label: 'Every week' }
  ];

  var DEFAULT_SECURE_IT = {
    title: 'How LANA keeps it safe',
    body: 'Your credentials are encrypted on your firm\'s LANA server as soon as you save them.',
    points: [
      'They stay on your firm\'s server and are never shown to LANA\'s AI.',
      'After you save, LANA only ever shows them masked.',
      'You can replace or remove them at any time from the connector page.'
    ]
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function str(value) {
    return value == null ? '' : String(value);
  }

  function lower(value) {
    return str(value).trim().toLowerCase();
  }

  function replaceAll(text, search, replacement) {
    if (!search) return text;
    return text.split(search).join(replacement);
  }

  function titleCase(name) {
    return str(name).split('_').join(' ').split('-').join(' ').split(' ')
      .filter(function (word) { return word; })
      .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
      .join(' ');
  }

  function normalizeScope(scope) {
    var value = lower(scope);
    return value === 'user' || value === 'personal' ? 'user' : 'org';
  }

  // ---------------------------------------------------------------------------
  // Auth: branch and fields
  // ---------------------------------------------------------------------------

  /**
   * Which connect branch the package needs.
   * @param {Object} connector - connector package
   * @param {string} [method] - 'oauth2' | 'api_key' for oauth2_or_api_key
   * @returns {{authType: string, branch: string, methods: Array|null, method: string|null}}
   */
  function detectAuthBranch(connector, method) {
    var auth = (connector && connector.auth) || {};
    var authType = lower(auth.type) || 'none';

    if (authType === 'oauth2_or_api_key') {
      var methods = ['oauth2', 'api_key'];
      var chosen = methods.indexOf(method) !== -1
        ? method
        : (methods.indexOf(lower(auth.primary)) !== -1 ? lower(auth.primary) : 'oauth2');
      return {
        authType: authType,
        branch: chosen === 'oauth2' ? 'oauth' : 'credentials',
        methods: methods,
        method: chosen
      };
    }
    if (authType === 'oauth2') {
      return { authType: authType, branch: 'oauth', methods: null, method: null };
    }
    if (authType === 'none' || lower(auth.kind) === 'none') {
      return { authType: authType, branch: 'none', methods: null, method: null };
    }
    // api_key, basic, connection_params, and older types such as oauth1_legacy
    // whose package asks for a pasted token: all collected as credentials.
    return { authType: authType, branch: 'credentials', methods: null, method: null };
  }

  /** Field definitions by name, merged from configuration and auth blocks (labels, types). */
  function buildFieldCatalog(connector) {
    var catalog = {};
    var configuration = (connector && connector.configuration) || {};
    var auth = (connector && connector.auth) || {};

    function add(field, required) {
      if (!field || !field.name) return;
      var existing = catalog[field.name] || {};
      catalog[field.name] = Object.assign({}, field, existing, {
        name: field.name,
        configRequired: existing.configRequired || required === true
      });
    }

    (configuration.required_fields || []).forEach(function (f) { add(f, true); });
    (configuration.optional_fields || []).forEach(function (f) { add(f, false); });
    (Array.isArray(auth.fields) ? auth.fields : []).forEach(function (f) { add(f, false); });
    var apiKeyBlock = isObject(auth.api_key) ? auth.api_key : null;
    (apiKeyBlock && Array.isArray(apiKeyBlock.fields) ? apiKeyBlock.fields : []).forEach(function (f) { add(f, false); });
    if (isObject(auth.connection_fields)) {
      Object.keys(auth.connection_fields).forEach(function (name) {
        add(Object.assign({ name: name }, auth.connection_fields[name]), false);
      });
    }
    return catalog;
  }

  /**
   * Auth fields one connect mode collects, in order.
   * @returns {Array<{name: string, secret: boolean, required: boolean, label?: string}>}
   */
  function authFieldsForMode(connector, mode) {
    var auth = (connector && connector.auth) || {};
    var type = lower(auth.type);

    if (mode === 'api_key') {
      var block = type === 'oauth2_or_api_key' ? (auth.api_key || {}) : auth;
      var listed = Array.isArray(block.fields) && block.fields.length
        ? block.fields
        : (type !== 'oauth2_or_api_key' && Array.isArray(auth.fields) ? auth.fields : null);
      if (listed && listed.length) {
        return listed.filter(function (f) { return f && f.name; }).map(function (f) {
          return { name: f.name, secret: f.type === 'password', required: f.required !== false };
        });
      }
      return [{ name: block.api_key_field || 'api_key', secret: true, required: true, label: block.label || auth.label }];
    }

    if (mode === 'basic') {
      return [
        { name: auth.username_field || 'username', secret: false, required: true, label: auth.username_label },
        { name: auth.password_field || 'password', secret: true, required: true, label: auth.password_label }
      ];
    }

    if (mode === 'connection_params') {
      var fields = [];
      var connection = isObject(auth.connection_fields) ? auth.connection_fields : {};
      Object.keys(connection).forEach(function (name) {
        var def = connection[name] || {};
        if (def.required === false) return;
        fields.push({ name: name, secret: def.type === 'password', required: true });
      });
      if (auth.proxy_auth && auth.proxy_auth.api_key_field) {
        fields.push({ name: auth.proxy_auth.api_key_field, secret: true, required: true });
      }
      return fields;
    }

    if (mode === 'oauth2') {
      var oauth = type === 'oauth2_or_api_key' ? (auth.oauth2 || {}) : auth;
      return [
        { name: oauth.client_id_field || 'client_id', secret: true, required: true, label: 'Client ID' },
        { name: oauth.client_secret_field || 'client_secret', secret: true, required: true, label: 'Client secret' }
      ];
    }

    return [];
  }

  function modeForBranch(branchInfo) {
    if (branchInfo.authType === 'oauth2_or_api_key') return branchInfo.method;
    if (branchInfo.authType === 'oauth2') return 'oauth2';
    if (branchInfo.authType === 'basic') return 'basic';
    if (branchInfo.authType === 'connection_params') return 'connection_params';
    if (branchInfo.branch === 'credentials' && branchInfo.authType === 'api_key') return 'api_key';
    return null;
  }

  /** Every auth field name across every mode the package declares. */
  function allAuthFieldNames(connector) {
    var auth = (connector && connector.auth) || {};
    var type = lower(auth.type);
    var modes = type === 'oauth2_or_api_key'
      ? ['oauth2', 'api_key']
      : [type];
    var names = {};
    modes.forEach(function (mode) {
      authFieldsForMode(connector, mode).forEach(function (f) { names[f.name] = true; });
    });
    return names;
  }

  /** Secret field names: auth secret fields of every mode plus password config fields. */
  function secretFieldNames(connector) {
    var auth = (connector && connector.auth) || {};
    var type = lower(auth.type);
    var modes = type === 'oauth2_or_api_key' ? ['oauth2', 'api_key'] : [type];
    var names = {};
    modes.forEach(function (mode) {
      authFieldsForMode(connector, mode).forEach(function (f) { if (f.secret) names[f.name] = true; });
    });
    var catalog = buildFieldCatalog(connector);
    Object.keys(catalog).forEach(function (name) {
      if (catalog[name].type === 'password') names[name] = true;
    });
    return Object.keys(names);
  }

  function inputKind(type) {
    var value = lower(type);
    if (value === 'select' || value === 'enum') return 'select';
    if (value === 'boolean' || value === 'checkbox' || value === 'toggle') return 'toggle';
    if (value === 'number' || value === 'integer') return 'number';
    if (value === 'email') return 'email';
    if (value === 'url') return 'url';
    return 'text';
  }

  function normalizeOptions(options) {
    if (!Array.isArray(options)) return [];
    return options.map(function (option) {
      if (isObject(option)) return { value: str(option.value), label: str(option.label || option.value) };
      return { value: str(option), label: titleCase(option) };
    });
  }

  function viewField(name, catalog, secretNames, required, overrides) {
    var def = catalog[name] || {};
    var over = overrides || {};
    var secret = secretNames.indexOf(name) !== -1;
    return {
      name: name,
      label: str(def.label || over.label || titleCase(name)),
      input: secret ? 'password' : inputKind(def.type),
      secret: secret,
      required: !!required,
      placeholder: str(def.placeholder),
      help: str(def.help_text || def.description),
      options: normalizeOptions(def.options)
    };
  }

  // ---------------------------------------------------------------------------
  // Redirect URI in step text
  // ---------------------------------------------------------------------------

  function normalizeRedirect(redirect) {
    if (!redirect) return { status: 'none' };
    if (redirect.status === 'forbidden' || redirect.forbidden === true) return { status: 'forbidden' };
    if (redirect.status === 'error') return { status: 'error' };
    if (!redirect.redirect_uri) return { status: 'none' };
    return {
      status: 'ok',
      uri: str(redirect.redirect_uri),
      mode: lower(redirect.mode),
      provider: str(redirect.provider),
      flow: str(redirect.flow)
    };
  }

  /**
   * Put the real redirect URI into one piece of guide text.
   * The token is always replaced (with the URI, or a pointer to an admin when
   * the URI is not available). The legacy hard-coded URI is replaced only in
   * standard mode; in bridge mode it is the correct value and stays.
   * @returns {{text: string, used: boolean, unavailable: boolean}}
   */
  function applyRedirect(text, redirect) {
    if (typeof text !== 'string' || !text) return { text: text, used: false, unavailable: false };
    var info = redirect && redirect.status ? redirect : normalizeRedirect(redirect);
    var out = text;
    var used = false;
    var unavailable = false;

    if (out.indexOf(REDIRECT_TOKEN) !== -1) {
      if (info.status === 'ok') {
        out = replaceAll(out, REDIRECT_TOKEN, info.uri);
        used = true;
      } else {
        out = replaceAll(out, REDIRECT_TOKEN, REDIRECT_FALLBACK_TEXT);
        unavailable = true;
      }
    }
    if (info.status === 'ok' && info.mode === 'standard' && out.indexOf(LEGACY_REDIRECT_URI) !== -1) {
      out = replaceAll(out, LEGACY_REDIRECT_URI, info.uri);
      used = true;
    }
    return { text: out, used: used, unavailable: unavailable };
  }

  function containsRedirect(text) {
    return typeof text === 'string' && (text.indexOf(REDIRECT_TOKEN) !== -1 || text.indexOf(LEGACY_REDIRECT_URI) !== -1);
  }

  // ---------------------------------------------------------------------------
  // Guide steps
  // ---------------------------------------------------------------------------

  function normalizeLink(link) {
    if (!isObject(link) || !link.url) return null;
    var url = str(link.url);
    if (url.indexOf('https://') !== 0 && url.indexOf('http://') !== 0) return null;
    return { label: str(link.label || 'Open link'), url: url };
  }

  function normalizeImage(image) {
    var url = isObject(image) ? str(image.url || image.src) : str(image);
    if (url.indexOf('https://') !== 0) return null;
    return { url: url, alt: isObject(image) ? str(image.alt) : '' };
  }

  function stepAudience(step, scope) {
    var value = lower(step && step.audience);
    if (value === 'admin' || value === 'user') return value;
    return scope === 'user' ? 'user' : 'admin';
  }

  function buildGuideStep(raw, index, redirect) {
    var flags = { used: false, unavailable: false };
    function text(value) {
      var result = applyRedirect(value, redirect);
      if (result.used) flags.used = true;
      if (result.unavailable) flags.unavailable = true;
      return typeof result.text === 'string' ? result.text : '';
    }

    var code = null;
    if (isObject(raw.code) && raw.code.value) {
      var hadToken = str(raw.code.value).indexOf(REDIRECT_TOKEN) !== -1;
      var value = text(str(raw.code.value));
      // A code block that is only the redirect token has nothing to show
      // when the URI is not available.
      code = hadToken && redirect.status !== 'ok' && value === REDIRECT_FALLBACK_TEXT
        ? null
        : { label: text(str(raw.code.label)), value: value };
    }

    var action = lower(raw.action);
    var step = {
      id: 'guide_' + (index + 1),
      kind: 'guide',
      guideIndex: index,
      title: text(str(raw.title)) || ('Step ' + (index + 1)),
      body: text(str(raw.body)),
      instructions: (Array.isArray(raw.instructions) ? raw.instructions : []).map(function (line) { return text(str(line)); }),
      link: normalizeLink(raw.external_link || raw.link),
      tip: text(str(raw.tip)),
      warning: text(str(raw.warning)),
      code: code,
      image: normalizeImage(raw.image),
      action: action,
      fieldNames: Array.isArray(raw.fields) ? raw.fields.map(str).filter(Boolean) : [],
      fields: [],
      showRedirectUri: false,
      redirectUnavailable: false
    };

    var mentionsRedirect = action === 'copy_redirect_uri' || containsRedirect(raw.body) ||
      (isObject(raw.code) && containsRedirect(raw.code.value));
    if (action === 'copy_redirect_uri') {
      step.showRedirectUri = redirect.status === 'ok' && !(code && code.value === redirect.uri);
      if (redirect.status !== 'ok') flags.unavailable = true;
    }
    step.redirectUnavailable = mentionsRedirect && flags.unavailable;
    return step;
  }

  // ---------------------------------------------------------------------------
  // Wizard
  // ---------------------------------------------------------------------------

  function multiInstanceConfig(connector, source) {
    var candidates = [
      source && source.multi_instance,
      connector && connector.manifest && connector.manifest.multi_instance,
      connector && connector.multi_instance
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (isObject(candidates[i]) && candidates[i].enabled === true) return candidates[i];
    }
    return null;
  }

  function connectorDisplayName(connector, metadata, fallback) {
    var meta = (connector && connector.metadata) || {};
    return str(meta.name || (connector && connector.name) || (metadata && metadata.connectorType) || fallback || 'this connector');
  }

  /**
   * How the connect step saves.
   *  configure        POST /connectors/configure (creates or updates by type)
   *  patch_existing   PATCH the existing source by id (multi instance only)
   *  create_instance  POST /connectors/:slug/instances, then PATCH by id
   *  user_oauth       /api/v1/me/connections/* (personal connectors)
   */
  function resolveSaveMode(scope, multiInstance, source, options) {
    if (scope === 'user') return 'user_oauth';
    if (!multiInstance) return 'configure';
    if (!source || !source.id) return 'configure';
    if (options.newInstance === true || lower(source.status) === 'connected') return 'create_instance';
    return 'patch_existing';
  }

  /**
   * Build the wizard.
   * @param {Object} input
   * @param {{connector: Object, metadata: Object}} input.catalog - catalog response
   * @param {Object} [input.source] - list item of GET /connectors for this type, when a row exists
   * @param {{canManageCredentials: boolean, scope?: string}} input.capability
   * @param {Object} [input.redirect] - redirect-uri response, or {status:'forbidden'}
   * @param {Object} [input.oauthApp] - { lana_managed_available, credential_source }
   * @param {Object} [input.userConnection] - available row of GET /me/connections
   * @param {{method?: string, useOwnApp?: boolean, newInstance?: boolean}} [input.options]
   * @returns {Object} wizard model
   */
  function buildWizard(input) {
    input = input || {};
    var catalogResponse = input.catalog || {};
    var connector = catalogResponse.connector || {};
    var metadata = catalogResponse.metadata || {};
    var source = input.source && input.source.id ? input.source : null;
    var capability = input.capability || {};
    var options = input.options || {};
    var oauthApp = input.oauthApp || {};
    var redirect = normalizeRedirect(input.redirect);

    var scope = normalizeScope(capability.scope || connector.connector_scope || connector.scope ||
      (connector.metadata && connector.metadata.scope) || (source && source.connector_scope));
    var canManage = capability.canManageCredentials === true;
    var connectorType = str(metadata.connectorType || connector.id || (source && source.connector_id));
    var name = connectorDisplayName(connector, metadata, connectorType);
    var guide = (connector.documentation && connector.documentation.setup_guide) || {};
    var branchInfo = detectAuthBranch(connector, options.method);
    var multiInstance = multiInstanceConfig(connector, source);
    var saveMode = resolveSaveMode(scope, multiInstance, source, options);
    var secrets = secretFieldNames(connector);
    var catalog = buildFieldCatalog(connector);
    var authNames = allAuthFieldNames(connector);
    var test = connector.auth && isObject(connector.auth.test) ? connector.auth.test : null;
    var testKind = test && lower(test.kind) === 'none' ? 'none' : 'probe';

    var managedOAuth = branchInfo.branch === 'oauth' && (
      scope === 'user'
        ? true
        : oauthApp.lana_managed_available === true
    );
    var firmAppSaved = lower(oauthApp.credential_source) === 'firm';
    var useOwnApp = branchInfo.branch === 'oauth' && scope === 'org' && (!managedOAuth || options.useOwnApp === true);

    var model = {
      connectorType: connectorType,
      connectorName: name,
      scope: scope,
      authType: branchInfo.authType,
      branch: branchInfo.branch,
      methods: branchInfo.methods,
      method: branchInfo.method,
      saveMode: saveMode,
      sourceId: source ? str(source.id) : '',
      multiInstance: multiInstance,
      managedOAuth: managedOAuth,
      canUseOwnApp: branchInfo.branch === 'oauth' && scope === 'org' && managedOAuth,
      useOwnApp: useOwnApp,
      testKind: testKind,
      supportsSync: !(connector.features && connector.features.supports_sync === false),
      redirect: redirect,
      blocked: null,
      collapsedGuideCount: 0,
      secretFieldNames: secrets,
      fields: {},
      requiredFieldNames: [],
      steps: []
    };

    // ── Who can do this ────────────────────────────────────────────────
    if (scope === 'org' && !canManage) {
      model.blocked = { reason: 'Ask an admin to connect ' + name + '. Connecting it for the firm needs admin access.' };
    } else if (scope === 'user') {
      var availability = lower(input.userConnection && input.userConnection.status);
      if (USER_BLOCKING_STATUSES[availability]) {
        model.blocked = { reason: replaceAll(USER_BLOCKING_STATUSES[availability], '{name}', name) };
      } else if (branchInfo.branch !== 'oauth') {
        model.blocked = { reason: 'Set up ' + name + ' from Advanced setup.' };
      }
    }

    model.steps.push({
      id: 'before_you_start',
      kind: 'before_you_start',
      title: 'Before you start',
      intro: str(guide.intro),
      audienceNote: str(guide.audience_note),
      prerequisites: (Array.isArray(guide.prerequisites) ? guide.prerequisites : []).map(str),
      blocked: model.blocked
    });

    if (model.blocked) {
      return model;
    }

    if (branchInfo.methods) {
      model.steps.push({
        id: 'choose_method',
        kind: 'choose_method',
        title: 'Choose how to connect',
        options: [
          { value: 'oauth2', label: 'Sign in with ' + name, description: 'Authorize LANA in your browser.' },
          { value: 'api_key', label: 'Use an API key', description: 'Paste a key or token from ' + name + '.' }
        ],
        selected: branchInfo.method
      });
    }

    // ── Fields this branch needs ───────────────────────────────────────
    var mode = modeForBranch(branchInfo);
    var required = [];
    var authFields = mode ? authFieldsForMode(connector, mode) : [];
    var authOverrides = {};
    authFields.forEach(function (f) { authOverrides[f.name] = f; });

    if (scope === 'org') {
      ((connector.configuration && connector.configuration.required_fields) || []).forEach(function (f) {
        if (f && f.name && !authNames[f.name] && required.indexOf(f.name) === -1) required.push(f.name);
      });
      if (branchInfo.branch === 'credentials') {
        authFields.forEach(function (f) { if (f.required && required.indexOf(f.name) === -1) required.push(f.name); });
      } else if (branchInfo.branch === 'oauth' && useOwnApp && !firmAppSaved) {
        authFields.forEach(function (f) { if (required.indexOf(f.name) === -1) required.push(f.name); });
      }
    }

    // Fields a step may bind: required ones, the branch's own auth fields
    // (BYO OAuth client fields stay bindable when already saved), and
    // optional configuration fields.
    var bindable = {};
    required.forEach(function (n) { bindable[n] = true; });
    if (scope === 'org' && (branchInfo.branch === 'credentials' || useOwnApp)) {
      authFields.forEach(function (f) { bindable[f.name] = true; });
    }
    if (scope === 'org') {
      ((connector.configuration && connector.configuration.optional_fields) || []).forEach(function (f) {
        if (f && f.name && !authNames[f.name]) bindable[f.name] = true;
      });
    }

    function fieldFor(name) {
      var view = viewField(name, catalog, secrets, required.indexOf(name) !== -1, authOverrides[name]);
      model.fields[name] = view;
      return view;
    }

    // ── Guide steps ────────────────────────────────────────────────────
    var placed = {};
    var rawSteps = Array.isArray(guide.steps) ? guide.steps : [];
    var collapse = branchInfo.branch === 'oauth' && managedOAuth && !useOwnApp;

    rawSteps.forEach(function (raw, index) {
      if (!isObject(raw)) return;
      var audience = stepAudience(raw, scope);
      if (audience === 'admin' && !canManage) return;
      // Managed OAuth needs no app of the firm's own: the app setup steps sit
      // behind "Use your own app". A step written for the user stays.
      if (collapse && lower(raw.audience) !== 'user') {
        model.collapsedGuideCount += 1;
        return;
      }
      var step = buildGuideStep(raw, index, redirect);
      step.audience = audience;
      step.fields = step.fieldNames.filter(function (n) {
        return bindable[n] && !placed[n];
      }).map(function (n) {
        placed[n] = true;
        return fieldFor(n);
      });
      delete step.fieldNames;
      model.steps.push(step);
    });

    model.steps.push(Object.assign({
      id: 'secure_it',
      kind: 'secure_it'
    }, secureItCopy(guide, branchInfo.branch)));

    // ── Enter your details: required fields no step placed ─────────────
    var detailFields = [];
    if (saveMode === 'create_instance') {
      detailFields.push({
        name: 'instance_key',
        label: str(multiInstance.instance_label || 'Instance name'),
        input: 'text',
        secret: false,
        required: true,
        instance: true,
        placeholder: str(multiInstance.instance_placeholder),
        help: str(multiInstance.instance_helper_text || 'A short name for this connection, using letters, numbers and dashes.'),
        options: []
      });
      model.fields.instance_key = detailFields[0];
    }
    required.forEach(function (n) {
      if (!placed[n]) {
        placed[n] = true;
        detailFields.push(fieldFor(n));
      }
    });
    if (detailFields.length) {
      model.steps.push({
        id: 'details',
        kind: 'details',
        title: 'Enter your details',
        body: 'Fill in what ' + name + ' needs to connect.',
        fields: detailFields
      });
    }

    model.requiredFieldNames = Object.keys(model.fields).filter(function (n) { return model.fields[n].required; });

    model.steps.push({
      id: 'connect',
      kind: 'connect',
      title: 'Connect',
      branch: branchInfo.branch,
      buttonLabel: branchInfo.branch === 'oauth'
        ? 'Connect with ' + name
        : (branchInfo.branch === 'none' ? 'Save' : 'Save and test')
    });
    model.steps.push({ id: 'result', kind: 'result', title: 'Result' });
    if (model.supportsSync) {
      model.steps.push({ id: 'sync', kind: 'sync', title: 'Sync', frequencies: SYNC_FREQUENCIES.slice() });
    }
    model.steps.push({ id: 'done', kind: 'done', title: 'Done' });

    return model;
  }

  function secureItCopy(guide, branch) {
    var custom = isObject(guide.security) ? guide.security : null;
    if (custom) {
      return {
        title: str(custom.title || DEFAULT_SECURE_IT.title),
        body: str(custom.body),
        points: (Array.isArray(custom.points) ? custom.points : []).map(str)
      };
    }
    if (branch === 'oauth') {
      return {
        title: DEFAULT_SECURE_IT.title,
        body: 'LANA never sees your password. The sign in happens on the provider\'s own page, and LANA only keeps the access it is granted, encrypted on your firm\'s server.',
        points: DEFAULT_SECURE_IT.points.slice(0, 1).concat(['You can disconnect at any time from the connector page.'])
      };
    }
    return {
      title: DEFAULT_SECURE_IT.title,
      body: DEFAULT_SECURE_IT.body,
      points: DEFAULT_SECURE_IT.points.slice()
    };
  }

  // ---------------------------------------------------------------------------
  // Values, payloads and results
  // ---------------------------------------------------------------------------

  function isBlank(value) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  }

  /**
   * Required fields of the given steps (or of the whole wizard) that are empty.
   * UX only: the backend validates the save.
   * @returns {string[]} field names
   */
  function missingRequiredFields(model, values, stepIds) {
    var vals = values || {};
    var names = [];
    (model.steps || []).forEach(function (step) {
      if (stepIds && stepIds.indexOf(step.id) === -1) return;
      (step.fields || []).forEach(function (field) {
        if (field.required && isBlank(vals[field.name])) names.push(field.name);
      });
    });
    return names;
  }

  /** Index of the first step that shows any of these fields, or -1. */
  function stepIndexForField(model, fieldName) {
    var steps = model.steps || [];
    for (var i = 0; i < steps.length; i++) {
      var fields = steps[i].fields || [];
      for (var j = 0; j < fields.length; j++) {
        if (fields[j].name === fieldName) return i;
      }
    }
    return -1;
  }

  /** Index of the first step that collects any field, or -1. */
  function firstFieldStepIndex(model) {
    var steps = model.steps || [];
    for (var i = 0; i < steps.length; i++) {
      if ((steps[i].fields || []).length) return i;
    }
    return -1;
  }

  function stepIndex(model, id) {
    var steps = model.steps || [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].id === id) return i;
    }
    return -1;
  }

  /**
   * The config object the save sends. Only fields the wizard shows, only
   * filled ones (an empty secret would clear the stored one).
   * @returns {Object}
   */
  function buildConfigPayload(model, values) {
    var vals = values || {};
    var config = {};
    Object.keys(model.fields || {}).forEach(function (name) {
      var field = model.fields[name];
      if (field.instance) return;
      var value = vals[name];
      if (isBlank(value)) return;
      if (field.input === 'number' && typeof value === 'string') {
        var num = Number(value.trim());
        config[name] = isNaN(num) ? value.trim() : num;
        return;
      }
      if (typeof value === 'string' && !field.secret) {
        config[name] = value.trim();
        return;
      }
      config[name] = value;
    });
    if (model.methods && model.method) {
      config.auth_type = model.method;
    }
    // Rows saved by id do not go through the configure route's creation
    // defaults, so the wizard sets them: manual sync until the Sync step.
    if (model.saveMode === 'patch_existing' || model.saveMode === 'create_instance') {
      config.sync_frequency = 'manual';
      config.guided_connect_pending = true;
    }
    return config;
  }

  /** instance_key as the instances route accepts it: lower case, dashes for spaces. */
  function normalizeInstanceKey(value) {
    return str(value).trim().toLowerCase().split(' ').filter(Boolean).join('-');
  }

  function isValidInstanceKey(value) {
    var key = str(value);
    if (!key || key.length > 100 || key === 'default') return false;
    for (var i = 0; i < key.length; i++) {
      var c = key.charCodeAt(i);
      var alnum = (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
      if (!alnum && !(c === 45 && i > 0)) return false;
    }
    return true;
  }

  /**
   * Map the test-connection response to what the wizard shows.
   * @returns {{outcome: 'connected'|'unverified'|'failed', message: string, identity: Object|null}}
   */
  function interpretTestResult(result) {
    var res = result || {};
    var identity = isObject(res.identity) && res.identity.value ? { label: str(res.identity.label || 'Connected as'), value: str(res.identity.value) } : null;
    if (res.code === 'TEST_NOT_DEFINED') {
      return { outcome: 'unverified', message: 'Saved. LANA will verify on the first sync.', identity: null };
    }
    if (res.success === false) {
      return { outcome: 'failed', message: str(res.message || res.error || 'The connection test failed.'), identity: null };
    }
    if (res.verified === false) {
      return { outcome: 'unverified', message: 'Saved. LANA will verify on the first sync.', identity: identity };
    }
    return { outcome: 'connected', message: str(res.message || 'Connected.'), identity: identity };
  }

  function isAuthorized(statusResponse) {
    return AUTHORIZED_STATUSES.indexOf(lower(statusResponse && statusResponse.auth_status)) !== -1;
  }

  function looksSecretKey(key) {
    var value = lower(key);
    for (var i = 0; i < SECRET_KEY_HINTS.length; i++) {
      if (value.indexOf(SECRET_KEY_HINTS[i]) !== -1) return true;
    }
    return false;
  }

  /**
   * A copy that is safe to log: declared secret fields and secret looking
   * keys are replaced, at any depth.
   * @param {*} value
   * @param {string[]} [secretNames]
   */
  function sanitizeForLog(value, secretNames) {
    var names = Array.isArray(secretNames) ? secretNames : [];
    function walk(node, depth) {
      if (depth > 8) return SECRET_PLACEHOLDER;
      if (Array.isArray(node)) return node.map(function (item) { return walk(item, depth + 1); });
      if (!isObject(node)) return node;
      var out = {};
      Object.keys(node).forEach(function (key) {
        var secretKey = names.indexOf(key) !== -1 || looksSecretKey(key);
        if (secretKey && key.slice(-11) !== '_configured') {
          out[key] = node[key] == null || node[key] === '' ? node[key] : SECRET_PLACEHOLDER;
        } else {
          out[key] = walk(node[key], depth + 1);
        }
      });
      return out;
    }
    return walk(value, 0);
  }

  /**
   * Items for <lex-stepper>.
   * @param {Array} steps - model.steps
   * @param {number} currentIndex
   * @param {number} [errorIndex] - step showing an error, or -1
   * @param {number} [furthestIndex] - furthest step reached
   */
  function buildStepperItems(steps, currentIndex, errorIndex, furthestIndex) {
    var furthest = typeof furthestIndex === 'number' ? Math.max(furthestIndex, currentIndex) : currentIndex;
    return (steps || []).map(function (step, index) {
      var state = 'upcoming';
      if (index === errorIndex) state = 'error';
      else if (index === currentIndex) state = 'current';
      else if (index < furthest) state = 'done';
      return { id: step.id, label: step.title, state: state };
    });
  }

  var api = {
    REDIRECT_TOKEN: REDIRECT_TOKEN,
    LEGACY_REDIRECT_URI: LEGACY_REDIRECT_URI,
    SYNC_FREQUENCIES: SYNC_FREQUENCIES,
    normalizeScope: normalizeScope,
    detectAuthBranch: detectAuthBranch,
    authFieldsForMode: authFieldsForMode,
    secretFieldNames: secretFieldNames,
    normalizeRedirect: normalizeRedirect,
    applyRedirect: applyRedirect,
    buildWizard: buildWizard,
    missingRequiredFields: missingRequiredFields,
    stepIndexForField: stepIndexForField,
    firstFieldStepIndex: firstFieldStepIndex,
    stepIndex: stepIndex,
    buildConfigPayload: buildConfigPayload,
    normalizeInstanceKey: normalizeInstanceKey,
    isValidInstanceKey: isValidInstanceKey,
    interpretTestResult: interpretTestResult,
    isAuthorized: isAuthorized,
    sanitizeForLog: sanitizeForLog,
    buildStepperItems: buildStepperItems
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ConnectWizardModel = api;
  }
})(typeof window !== 'undefined' ? window : this);

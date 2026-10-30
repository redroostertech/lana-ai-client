'use strict';

// Guided Connect step model (src/js/connect-wizard.model.js): step order,
// field binding and placement, audience gating, the redirect URI token and
// the legacy URI, auth branches, secret marking, payloads and log safety.

const path = require('path');

const M = require(path.join(__dirname, '..', '..', 'src', 'js', 'connect-wizard.model.js'));

const LEGACY = 'https://lanaai.io/lana-ai/oauth/callback';
const STANDARD_URI = 'https://lanaai.io/oauth/callback/google-drive';

function guide(steps, extra) {
  return {
    setup_guide: Object.assign({
      intro: 'Connect it.',
      audience_note: 'You need access.',
      prerequisites: ['An account'],
      steps: steps
    }, extra || {})
  };
}

function stripe(steps) {
  return {
    connector: {
      id: 'stripe',
      metadata: { name: 'Stripe' },
      auth: { type: 'api_key', api_key_field: 'api_key', label: 'Stripe Secret Key' },
      configuration: {
        required_fields: [{ name: 'api_key', label: 'Stripe Secret Key', type: 'password', help_text: 'From the dashboard.' }],
        optional_fields: [{ name: 'date_range_days', label: 'Lookback', type: 'number' }]
      },
      documentation: guide(steps || [
        { title: 'Open the API keys page', body: 'Go there.', instructions: ['Click the link.'], external_link: { label: 'Open', url: 'https://dashboard.stripe.com/apikeys' } },
        { title: 'Copy your key', body: 'Reveal it.', instructions: ['Copy it.'], warning: 'Keep it secret.' }
      ])
    },
    metadata: { connectorType: 'stripe' }
  };
}

function googleDrive(steps, scope) {
  return {
    connector: {
      id: 'google-drive',
      metadata: { name: 'Google Drive' },
      connector_scope: scope || 'org',
      auth: { type: 'oauth2', client_id_field: 'client_id', client_secret_field: 'client_secret' },
      configuration: {
        required_fields: [
          { name: 'client_id', label: 'Client ID', type: 'string' },
          { name: 'client_secret', label: 'Client Secret', type: 'password' }
        ],
        optional_fields: [{ name: 'folder_id', label: 'Folder', type: 'string' }]
      },
      documentation: guide(steps || [
        { title: 'Create a project', body: 'In Google Cloud.', instructions: ['Create it.'] },
        {
          title: 'Create OAuth credentials',
          body: 'Paste the redirect URL {{oauth_redirect_uri}} into Google.',
          instructions: ['Add ' + LEGACY + ' as a redirect URI.'],
          code: { label: 'LANA Redirect URL', value: LEGACY }
        }
      ])
    },
    metadata: { connectorType: 'google-drive' }
  };
}

function postgres() {
  return {
    connector: {
      id: 'postgresql',
      metadata: { name: 'PostgreSQL' },
      auth: {
        type: 'connection_params',
        connection_fields: {
          host: { label: 'Host', type: 'string', required: true },
          port: { label: 'Port', type: 'number', required: true },
          database: { label: 'Database', type: 'string', required: true },
          username: { label: 'Username', type: 'string', required: true },
          password: { label: 'Password', type: 'password', required: true },
          ssl_mode: { label: 'SSL Mode', type: 'enum', required: false, options: ['disabled', 'required'] }
        },
        proxy_auth: { api_key_field: 'proxy_api_key' }
      },
      configuration: {
        required_fields: [
          { name: 'proxy_url', label: 'Proxy URL', type: 'string' },
          { name: 'proxy_api_key', label: 'Proxy API Key', type: 'password' }
        ],
        optional_fields: [
          { name: 'host', label: 'Host', type: 'string' },
          { name: 'port', label: 'Port', type: 'number' },
          { name: 'password', label: 'Password', type: 'password' }
        ]
      },
      documentation: guide([{ title: 'Create a role', body: 'Ask your DBA.', instructions: [], code: { label: 'SQL', value: 'CREATE ROLE lana_ro;' } }])
    },
    metadata: { connectorType: 'postgresql' }
  };
}

function monday() {
  return {
    connector: {
      id: 'monday-com',
      metadata: { name: 'Monday.com' },
      auth: {
        type: 'oauth2_or_api_key',
        primary: 'oauth2',
        oauth2: { client_id_field: 'client_id', client_secret_field: 'client_secret' },
        api_key: { api_key_field: 'api_token' }
      },
      configuration: { required_fields: [{ name: 'api_token', label: 'API Token', type: 'password' }] },
      documentation: guide([{ title: 'Get a token', body: 'Profile, Developers.', instructions: [] }])
    },
    metadata: { connectorType: 'monday-com' }
  };
}

function zendesk() {
  return {
    connector: {
      id: 'zendesk',
      metadata: { name: 'Zendesk' },
      auth: { type: 'basic', username_field: 'email', password_field: 'api_token' },
      configuration: {
        required_fields: [
          { name: 'subdomain', label: 'Subdomain', type: 'string' },
          { name: 'email', label: 'Email', type: 'string' },
          { name: 'api_token', label: 'API Token', type: 'password' }
        ]
      },
      documentation: guide([{ title: 'Create a token', body: 'In Admin Center.', instructions: [] }])
    },
    metadata: { connectorType: 'zendesk' }
  };
}

const admin = { canManageCredentials: true };
const member = { canManageCredentials: false };
const ids = (model) => model.steps.map((s) => s.id);

describe('step building', () => {
  test('API key connector: intro, guide, secure it, details, connect, result, sync, done', () => {
    const model = M.buildWizard({ catalog: stripe(), capability: admin });
    expect(ids(model)).toEqual([
      'before_you_start', 'guide_1', 'guide_2', 'secure_it', 'details', 'connect', 'result', 'sync', 'done'
    ]);
    expect(model.branch).toBe('credentials');
    expect(model.saveMode).toBe('configure');
    expect(model.connectorName).toBe('Stripe');

    const intro = model.steps[0];
    expect(intro).toMatchObject({ intro: 'Connect it.', audienceNote: 'You need access.', prerequisites: ['An account'], blocked: null });

    const first = model.steps[1];
    expect(first.link).toEqual({ label: 'Open', url: 'https://dashboard.stripe.com/apikeys' });
    expect(first.instructions).toEqual(['Click the link.']);
    expect(model.steps[2].warning).toBe('Keep it secret.');

    const connect = model.steps[ids(model).indexOf('connect')];
    expect(connect.buttonLabel).toBe('Save and test');
  });

  test('guide step parts: tip, warning, code, image (https only), link (http or https only)', () => {
    const model = M.buildWizard({
      catalog: stripe([{
        title: 'T', body: 'B', instructions: ['a', 'b'], tip: 'A tip', warning: 'A warning',
        code: { label: 'Code', value: 'x = 1' }, image: { url: 'https://cdn.example/x.png', alt: 'Screen' },
        external_link: { label: 'Bad', url: 'javascript:alert(1)' }
      }, { title: 'U', body: '', instructions: [], image: 'ui/assets/local.png' }]),
      capability: admin
    });
    const step = model.steps[1];
    expect(step).toMatchObject({ tip: 'A tip', warning: 'A warning', code: { label: 'Code', value: 'x = 1' }, image: { url: 'https://cdn.example/x.png', alt: 'Screen' } });
    expect(step.link).toBeNull();
    expect(model.steps[2].image).toBeNull();
  });

  test('a connector with no setup guide still gets the frame steps', () => {
    const catalog = stripe();
    delete catalog.connector.documentation;
    const model = M.buildWizard({ catalog, capability: admin });
    expect(ids(model)).toEqual(['before_you_start', 'secure_it', 'details', 'connect', 'result', 'sync', 'done']);
  });

  test('no sync step when the package says it does not sync', () => {
    const catalog = stripe();
    catalog.connector.features = { supports_sync: false };
    expect(ids(M.buildWizard({ catalog, capability: admin }))).not.toContain('sync');
  });

  test('package security copy replaces the default secure it text', () => {
    const catalog = stripe();
    catalog.connector.documentation.setup_guide.security = { title: 'Your key is safe', body: 'Encrypted.', points: ['Masked.'] };
    const step = M.buildWizard({ catalog, capability: admin }).steps.find((s) => s.id === 'secure_it');
    expect(step).toMatchObject({ title: 'Your key is safe', body: 'Encrypted.', points: ['Masked.'] });
  });
});

describe('field placement', () => {
  test('step.fields binds a field to its step, so no details step is needed', () => {
    const model = M.buildWizard({
      catalog: stripe([{ title: 'Paste the key', body: '', instructions: [], fields: ['api_key'], action: 'enter_fields' }]),
      capability: admin
    });
    expect(ids(model)).not.toContain('details');
    const step = model.steps[1];
    expect(step.action).toBe('enter_fields');
    expect(step.fields).toHaveLength(1);
    expect(step.fields[0]).toMatchObject({ name: 'api_key', label: 'Stripe Secret Key', input: 'password', secret: true, required: true, help: 'From the dashboard.' });
  });

  test('optional fields can be bound; unknown fields are ignored; a field is placed once', () => {
    const model = M.buildWizard({
      catalog: stripe([
        { title: 'A', body: '', instructions: [], fields: ['date_range_days', 'not_a_field', 'api_key'] },
        { title: 'B', body: '', instructions: [], fields: ['api_key'] }
      ]),
      capability: admin
    });
    expect(model.steps[1].fields.map((f) => f.name)).toEqual(['date_range_days', 'api_key']);
    expect(model.steps[1].fields[0]).toMatchObject({ required: false, input: 'number' });
    expect(model.steps[2].fields).toEqual([]);
  });

  test('required fields no step placed go to "Enter your details" right before connect', () => {
    const model = M.buildWizard({ catalog: zendesk(), capability: admin });
    const order = ids(model);
    expect(order.indexOf('details')).toBe(order.indexOf('connect') - 1);
    const details = model.steps[order.indexOf('details')];
    expect(details.title).toBe('Enter your details');
    expect(details.fields.map((f) => [f.name, f.secret, f.input])).toEqual([
      ['subdomain', false, 'text'],
      ['email', false, 'text'],
      ['api_token', true, 'password']
    ]);
    expect(model.requiredFieldNames.sort()).toEqual(['api_token', 'email', 'subdomain']);
  });

  test('connection parameters: auth connection fields plus the proxy fields', () => {
    const model = M.buildWizard({ catalog: postgres(), capability: admin });
    const details = model.steps.find((s) => s.id === 'details');
    expect(details.fields.map((f) => f.name)).toEqual(['proxy_url', 'host', 'port', 'database', 'username', 'password', 'proxy_api_key']);
    expect(model.fields.port.input).toBe('number');
    expect(model.fields.password.secret).toBe(true);
    expect(model.fields.proxy_api_key.secret).toBe(true);
    expect(model.fields.host.secret).toBe(false);
    expect(model.fields.ssl_mode).toBeUndefined();
  });

  test('missingRequiredFields and the step a field lives on', () => {
    const model = M.buildWizard({ catalog: zendesk(), capability: admin });
    expect(M.missingRequiredFields(model, { subdomain: 'acme', email: '  ' })).toEqual(['email', 'api_token']);
    expect(M.missingRequiredFields(model, { subdomain: 'acme' }, ['guide_1'])).toEqual([]);
    expect(M.stepIndexForField(model, 'email')).toBe(ids(model).indexOf('details'));
    expect(M.firstFieldStepIndex(model)).toBe(ids(model).indexOf('details'));
    expect(M.stepIndexForField(model, 'nope')).toBe(-1);
  });
});

describe('audience gating', () => {
  test('org scope without credential access stops at "Ask an admin"', () => {
    const model = M.buildWizard({ catalog: stripe(), capability: member });
    expect(ids(model)).toEqual(['before_you_start']);
    expect(model.blocked.reason).toBe('Ask an admin to connect Stripe. Connecting it for the firm needs admin access.');
    expect(model.steps[0].blocked).toBe(model.blocked);
  });

  test('org scope steps default to admin; user scope steps default to user', () => {
    const userCatalog = googleDrive([
      { title: 'Default', body: '', instructions: [] },
      { title: 'Admin only', body: '', instructions: [], audience: 'admin' },
      { title: 'For you', body: '', instructions: [], audience: 'user' }
    ], 'user');
    const asMember = M.buildWizard({ catalog: userCatalog, capability: member, userConnection: { status: 'available' } });
    // Personal OAuth: app setup is the firm's, so untagged steps collapse and
    // the step written for the user stays.
    expect(asMember.steps.filter((s) => s.kind === 'guide').map((s) => s.title)).toEqual(['For you']);
    expect(asMember.steps.find((s) => s.title === 'For you').audience).toBe('user');

    const orgCatalog = stripe([
      { title: 'Default', body: '', instructions: [] },
      { title: 'For you', body: '', instructions: [], audience: 'user' }
    ]);
    const asAdmin = M.buildWizard({ catalog: orgCatalog, capability: admin });
    expect(asAdmin.steps.filter((s) => s.kind === 'guide').map((s) => [s.title, s.audience])).toEqual([
      ['Default', 'admin'],
      ['For you', 'user']
    ]);
  });

  test('admin steps hidden from users drop out, and their fields fall to details', () => {
    const catalog = googleDrive([
      { title: 'Admin', body: '', instructions: [], audience: 'admin', fields: ['client_id'] },
      { title: 'User', body: '', instructions: [], audience: 'user' }
    ], 'user');
    const model = M.buildWizard({ catalog, capability: member, userConnection: { status: 'available' } });
    expect(model.steps.map((s) => s.title)).not.toContain('Admin');
    // Personal connectors go through /me/connections: no fields are collected.
    expect(ids(model)).not.toContain('details');
    expect(model.saveMode).toBe('user_oauth');
  });

  test('personal connector availability from the backend blocks the wizard', () => {
    const catalog = googleDrive(null, 'user');
    const waiting = M.buildWizard({ catalog, capability: member, userConnection: { status: 'awaiting_admin_configuration' } });
    expect(ids(waiting)).toEqual(['before_you_start']);
    expect(waiting.blocked.reason).toBe('An admin has to finish setting up Google Drive before you can connect your account.');
    expect(M.buildWizard({ catalog, capability: member, userConnection: { status: 'permission_denied' } }).blocked).not.toBeNull();
    expect(M.buildWizard({ catalog, capability: member, userConnection: { status: 'available' } }).blocked).toBeNull();
  });
});

describe('redirect URI', () => {
  const ok = { redirect_uri: STANDARD_URI, provider: 'google-drive', flow: 'electron', mode: 'standard' };

  test('the token is replaced with the URI from the redirect-uri endpoint', () => {
    const model = M.buildWizard({ catalog: googleDrive(), capability: admin, redirect: ok, oauthApp: { lana_managed_available: false } });
    const step = model.steps.find((s) => s.title === 'Create OAuth credentials');
    expect(step.body).toBe('Paste the redirect URL ' + STANDARD_URI + ' into Google.');
    expect(step.redirectUnavailable).toBe(false);
  });

  test('the legacy URI is replaced only in standard mode', () => {
    const standard = M.buildWizard({ catalog: googleDrive(), capability: admin, redirect: ok }).steps.find((s) => s.code);
    expect(standard.instructions[0]).toBe('Add ' + STANDARD_URI + ' as a redirect URI.');
    expect(standard.code.value).toBe(STANDARD_URI);

    const bridge = M.buildWizard({ catalog: googleDrive(), capability: admin, redirect: Object.assign({}, ok, { mode: 'bridge', redirect_uri: LEGACY }) })
      .steps.find((s) => s.code);
    expect(bridge.code.value).toBe(LEGACY);

    const unknownMode = M.buildWizard({ catalog: googleDrive(), capability: admin, redirect: Object.assign({}, ok, { mode: '' }) })
      .steps.find((s) => s.code);
    expect(unknownMode.code.value).toBe(LEGACY);

    const none = M.buildWizard({ catalog: googleDrive(), capability: admin }).steps.find((s) => s.code);
    expect(none.code.value).toBe(LEGACY);
    expect(none.instructions[0]).toContain(LEGACY);
  });

  test('a 403 hides the value and points to an admin', () => {
    const model = M.buildWizard({
      catalog: googleDrive([
        { title: 'Redirect', body: 'Use {{oauth_redirect_uri}}.', instructions: [], code: { label: 'Redirect', value: '{{oauth_redirect_uri}}' } }
      ]),
      capability: admin,
      redirect: { status: 'forbidden' }
    });
    const step = model.steps.find((s) => s.title === 'Redirect');
    expect(step.body).toBe('Use the LANA redirect URL (ask an admin for it).');
    expect(step.code).toBeNull();
    expect(step.redirectUnavailable).toBe(true);
    expect(JSON.stringify(model.steps)).not.toContain('{{oauth_redirect_uri}}');
  });

  test('copy_redirect_uri shows the URI with a copy button unless the code block already does', () => {
    const model = M.buildWizard({
      catalog: googleDrive([
        { title: 'Copy', body: '', instructions: [], action: 'copy_redirect_uri' },
        { title: 'Code', body: '', instructions: [], action: 'copy_redirect_uri', code: { label: 'URI', value: '{{oauth_redirect_uri}}' } }
      ]),
      capability: admin,
      redirect: ok
    });
    expect(model.steps.find((s) => s.title === 'Copy').showRedirectUri).toBe(true);
    expect(model.steps.find((s) => s.title === 'Code').showRedirectUri).toBe(false);
    expect(model.redirect.uri).toBe(STANDARD_URI);
  });

  test('applyRedirect leaves text without a redirect untouched', () => {
    expect(M.applyRedirect('plain', { redirect_uri: STANDARD_URI, mode: 'standard' })).toEqual({ text: 'plain', used: false, unavailable: false });
    expect(M.applyRedirect('', null).text).toBe('');
  });
});

describe('auth branches', () => {
  test('api_key, basic and connection_params collect credentials', () => {
    expect(M.detectAuthBranch(stripe().connector).branch).toBe('credentials');
    expect(M.detectAuthBranch(zendesk().connector).branch).toBe('credentials');
    expect(M.detectAuthBranch(postgres().connector).branch).toBe('credentials');
  });

  test('OAuth with your own app: guide shown, client fields required', () => {
    const model = M.buildWizard({ catalog: googleDrive(), capability: admin, oauthApp: { lana_managed_available: false } });
    expect(model.branch).toBe('oauth');
    expect(model.useOwnApp).toBe(true);
    expect(model.canUseOwnApp).toBe(false);
    expect(model.steps.filter((s) => s.kind === 'guide')).toHaveLength(2);
    expect(model.requiredFieldNames.sort()).toEqual(['client_id', 'client_secret']);
    expect(model.steps.find((s) => s.id === 'connect').buttonLabel).toBe('Connect with Google Drive');
  });

  test('LANA managed OAuth collapses the app setup steps behind "Use your own app"', () => {
    const managed = M.buildWizard({ catalog: googleDrive(), capability: admin, oauthApp: { lana_managed_available: true } });
    expect(managed.managedOAuth).toBe(true);
    expect(managed.canUseOwnApp).toBe(true);
    expect(managed.useOwnApp).toBe(false);
    expect(managed.collapsedGuideCount).toBe(2);
    expect(ids(managed)).toEqual(['before_you_start', 'secure_it', 'connect', 'result', 'sync', 'done']);

    const own = M.buildWizard({ catalog: googleDrive(), capability: admin, oauthApp: { lana_managed_available: true }, options: { useOwnApp: true } });
    expect(own.useOwnApp).toBe(true);
    expect(own.steps.filter((s) => s.kind === 'guide')).toHaveLength(2);
    expect(own.requiredFieldNames.sort()).toEqual(['client_id', 'client_secret']);
  });

  test('a firm app already saved makes the client fields optional', () => {
    const model = M.buildWizard({ catalog: googleDrive(), capability: admin, oauthApp: { lana_managed_available: false, credential_source: 'firm' } });
    expect(model.requiredFieldNames).toEqual([]);
  });

  test('oauth2_or_api_key asks for the method first', () => {
    const oauth = M.buildWizard({ catalog: monday(), capability: admin });
    expect(ids(oauth).slice(0, 2)).toEqual(['before_you_start', 'choose_method']);
    expect(oauth.method).toBe('oauth2');
    expect(oauth.branch).toBe('oauth');
    expect(oauth.requiredFieldNames.sort()).toEqual(['client_id', 'client_secret']);

    const key = M.buildWizard({ catalog: monday(), capability: admin, options: { method: 'api_key' } });
    expect(key.branch).toBe('credentials');
    expect(key.steps[1].selected).toBe('api_key');
    expect(key.requiredFieldNames).toEqual(['api_token']);
    expect(M.buildConfigPayload(key, { api_token: 'tok' })).toEqual({ api_token: 'tok', auth_type: 'api_key' });
  });

  test('auth none: no credentials, the connect button only saves', () => {
    const model = M.buildWizard({
      catalog: { connector: { id: 'actionstep', metadata: { name: 'Actionstep' }, auth: { type: 'none' }, configuration: { required_fields: [{ name: 'import_directory', label: 'Folder', type: 'string' }] } }, metadata: { connectorType: 'actionstep' } },
      capability: admin
    });
    expect(model.branch).toBe('none');
    expect(model.steps.find((s) => s.id === 'connect').buttonLabel).toBe('Save');
    expect(model.requiredFieldNames).toEqual(['import_directory']);
  });

  test('auth.test kind none skips the probe', () => {
    const catalog = stripe();
    catalog.connector.auth.test = { kind: 'none' };
    expect(M.buildWizard({ catalog, capability: admin }).testKind).toBe('none');
    expect(M.buildWizard({ catalog: stripe(), capability: admin }).testKind).toBe('probe');
  });

  test('a personal connector that is not OAuth goes to Advanced setup', () => {
    const catalog = stripe();
    catalog.connector.connector_scope = 'user';
    const model = M.buildWizard({ catalog, capability: admin });
    expect(model.blocked.reason).toBe('Set up Stripe from Advanced setup.');
  });
});

describe('secret marking', () => {
  test('auth secret fields of every mode and password config fields', () => {
    expect(M.secretFieldNames(stripe().connector)).toEqual(['api_key']);
    expect(M.secretFieldNames(zendesk().connector).sort()).toEqual(['api_token']);
    expect(M.secretFieldNames(monday().connector).sort()).toEqual(['api_token', 'client_id', 'client_secret']);
    expect(M.secretFieldNames(postgres().connector).sort()).toEqual(['password', 'proxy_api_key']);
  });

  test('the model carries no values', () => {
    const model = M.buildWizard({ catalog: stripe(), capability: admin });
    Object.values(model.fields).forEach((field) => expect(field).not.toHaveProperty('value'));
  });
});

describe('save modes and payloads', () => {
  const multi = { enabled: true, instance_label: 'Database name', instance_placeholder: 'prod' };
  const sourceId = '11111111-2222-4333-8444-555555555555';

  test('first instance: configure; unconfigured instance: patch by id; connected: create a new instance', () => {
    expect(M.buildWizard({ catalog: postgres(), capability: admin }).saveMode).toBe('configure');

    const catalog = postgres();
    catalog.connector.manifest = { multi_instance: multi };
    expect(M.buildWizard({ catalog, capability: admin }).saveMode).toBe('configure');

    const unconfigured = M.buildWizard({ catalog, capability: admin, source: { id: sourceId, status: 'not_connected' } });
    expect(unconfigured.saveMode).toBe('patch_existing');
    expect(unconfigured.sourceId).toBe(sourceId);

    const connected = M.buildWizard({ catalog: postgres(), capability: admin, source: { id: sourceId, status: 'connected', multi_instance: multi } });
    expect(connected.saveMode).toBe('create_instance');
    const details = connected.steps.find((s) => s.id === 'details');
    expect(details.fields[0]).toMatchObject({ name: 'instance_key', label: 'Database name', placeholder: 'prod', required: true, instance: true });

    const forced = M.buildWizard({ catalog, capability: admin, source: { id: sourceId, status: 'not_connected' }, options: { newInstance: true } });
    expect(forced.saveMode).toBe('create_instance');
  });

  test('a single instance connector always saves through configure', () => {
    expect(M.buildWizard({ catalog: stripe(), capability: admin, source: { id: sourceId, status: 'connected' } }).saveMode).toBe('configure');
  });

  test('payload: filled fields only, numbers parsed, plain text trimmed, secrets as typed', () => {
    const model = M.buildWizard({ catalog: postgres(), capability: admin });
    const config = M.buildConfigPayload(model, {
      proxy_url: '  https://proxy.local  ', host: 'db', port: '5432', database: 'main', username: 'lana', password: ' p ', proxy_api_key: '', extra: 'x'
    });
    expect(config).toEqual({ proxy_url: 'https://proxy.local', host: 'db', port: 5432, database: 'main', username: 'lana', password: ' p ' });
  });

  test('rows saved by id start on manual sync with the pending marker; the instance key is not config', () => {
    const catalog = postgres();
    const model = M.buildWizard({ catalog, capability: admin, source: { id: sourceId, status: 'connected', multi_instance: multi } });
    const config = M.buildConfigPayload(model, { instance_key: 'prod', host: 'db' });
    expect(config).toEqual({ host: 'db', sync_frequency: 'manual', guided_connect_pending: true });
    expect(M.buildConfigPayload(M.buildWizard({ catalog: stripe(), capability: admin }), { api_key: 'sk' })).toEqual({ api_key: 'sk' });
  });

  test('instance keys', () => {
    expect(M.normalizeInstanceKey('  Prod  Reporting ')).toBe('prod-reporting');
    expect(M.isValidInstanceKey('prod-2')).toBe(true);
    expect(M.isValidInstanceKey('-prod')).toBe(false);
    expect(M.isValidInstanceKey('prod_2')).toBe(false);
    expect(M.isValidInstanceKey('default')).toBe(false);
    expect(M.isValidInstanceKey('')).toBe(false);
  });
});

describe('results', () => {
  test('test-connection outcomes', () => {
    expect(M.interpretTestResult({ success: true, verified: true, identity: { label: 'Connected as', value: 'acct_1' } }))
      .toEqual({ outcome: 'connected', message: 'Connected.', identity: { label: 'Connected as', value: 'acct_1' } });
    expect(M.interpretTestResult({ success: true, code: 'TEST_NOT_DEFINED' }).message).toBe('Saved. LANA will verify on the first sync.');
    expect(M.interpretTestResult({ success: true, verified: false }).outcome).toBe('unverified');
    expect(M.interpretTestResult({ success: false, message: 'Invalid API key' })).toEqual({ outcome: 'failed', message: 'Invalid API key', identity: null });
    expect(M.interpretTestResult({ success: false, error: 'Unauthorized' }).message).toBe('Unauthorized');
    expect(M.interpretTestResult({ success: true, identity: null }).identity).toBeNull();
  });

  test('authorized statuses', () => {
    expect(M.isAuthorized({ auth_status: 'connected' })).toBe(true);
    expect(M.isAuthorized({ auth_status: 'ACTIVE' })).toBe(true);
    expect(M.isAuthorized({ auth_status: 'configured' })).toBe(false);
    expect(M.isAuthorized(null)).toBe(false);
  });

  test('stepper items follow the current, error and furthest steps', () => {
    const steps = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }];
    expect(M.buildStepperItems(steps, 1, -1, 1).map((i) => i.state)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(M.buildStepperItems(steps, 1, 1, 1).map((i) => i.state)).toEqual(['done', 'error', 'upcoming', 'upcoming']);
    expect(M.buildStepperItems(steps, 0, -1, 3).map((i) => i.state)).toEqual(['current', 'done', 'done', 'upcoming']);
    expect(M.buildStepperItems(steps, 0)[0]).toEqual({ id: 'a', label: 'A', state: 'current' });
  });
});

describe('sanitizeForLog', () => {
  test('declared secrets and secret looking keys are redacted at any depth', () => {
    const input = {
      api_key: 'sk_live_123',
      host: 'db.local',
      nested: { password: 'p', list: [{ client_secret: 'cs', name: 'ok' }] },
      custom_field: 'hidden',
      api_key_configured: true,
      empty_token: ''
    };
    const out = M.sanitizeForLog(input, ['custom_field']);
    expect(out).toEqual({
      api_key: '[redacted]',
      host: 'db.local',
      nested: { password: '[redacted]', list: [{ client_secret: '[redacted]', name: 'ok' }] },
      custom_field: '[redacted]',
      api_key_configured: true,
      empty_token: ''
    });
    expect(input.api_key).toBe('sk_live_123');
    expect(JSON.stringify(out)).not.toContain('sk_live_123');
  });

  test('non objects pass through', () => {
    expect(M.sanitizeForLog('text')).toBe('text');
    expect(M.sanitizeForLog(null)).toBeNull();
    expect(M.sanitizeForLog([{ token: 't' }])).toEqual([{ token: '[redacted]' }]);
  });
});

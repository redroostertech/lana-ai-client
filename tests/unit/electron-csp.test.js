'use strict';

// The app pages' Content Security Policy (electron-csp.js, docs/plans/harden-web.md).

const {
  SIGN_IN_PAGES,
  HELP_CENTER_PAGES,
  originOf,
  embedOriginsOf,
  cspOriginsFromConfig,
  buildContentSecurityPolicy
} = require('../../electron-csp');

function directives(policy) {
  const out = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

const SAVED = {
  url: 'https://chef.firm.test',
  chefUrl: 'https://chef.firm.test/',
  forgeUrl: 'https://forge-api.lanaai.io/v1',
  burstUrl: 'https://burst.lanaai.io',
  enabledApps: [
    'lana-notes',
    { id: 'partner', route: { type: 'embedded', url: 'https://partner.example/app?x=1' } },
    { id: 'partner2', route: 'embed.html?app=partner2', embed: { type: 'embedded', url: 'https://other.example/' } },
    { id: 'insecure', route: { type: 'embedded', url: 'http://plain.example/' } },
    { id: 'notembed', route: { type: 'native', url: 'https://ignored.example/' } }
  ]
};
const CONFIG = {
  savedServer: SAVED,
  engineUrl: 'http://127.0.0.1:47123',
  editorUrl: 'http://127.0.0.1:53117',
  helpOrigins: ['https://www.redroostertec.com/lana-ai/v1/help']
};

describe('cspOriginsFromConfig', () => {
  test('takes every origin from configuration, deduplicated, as bare origins', () => {
    const origins = cspOriginsFromConfig(CONFIG);
    expect(origins.api).toEqual([
      'https://chef.firm.test',
      'https://forge-api.lanaai.io',
      'https://burst.lanaai.io',
      'http://127.0.0.1:47123',
      'http://127.0.0.1:53117'
    ]);
    expect(origins.editor).toEqual(['http://127.0.0.1:53117']);
    // The help center is not an API origin: only the help pages get it (below).
    expect(origins.help).toEqual(['https://www.redroostertec.com']);
    expect(origins.embed).toEqual(['https://partner.example', 'https://other.example']);
  });

  test('nothing configured gives nothing', () => {
    expect(cspOriginsFromConfig()).toEqual({ api: [], editor: [], embed: [], help: [] });
  });

  test('refuses wildcards, other schemes, credentials and junk', () => {
    ['*', 'https://*.example.com', '*.example.com', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc', 'ws://x.test', 'https://u:p@x.test', '', null, 42, 'not a url']
      .forEach((value) => expect(originOf(value)).toBeNull());
    // Hosts the URL parser lets through but that could break out of a CSP source list.
    ["https://evil.test;script-src", "https://a'b.test", 'https://a,b.test', 'https://a"b.test', 'https://a!b.test', 'https://a$b.test:8443']
      .forEach((value) => expect(originOf(value)).toBeNull());
    expect(originOf('http://127.0.0.1:47011/x')).toBe('http://127.0.0.1:47011');
    expect(originOf('https://xn--bcher-kva.example')).toBe('https://xn--bcher-kva.example');
    expect(originOf('https://Chef.Example.test:8443')).toBe('https://chef.example.test:8443');
    const origins = cspOriginsFromConfig({ savedServer: { url: 'https://*.evil.test', forgeUrl: '*' }, engineUrl: 'file:///x' });
    expect(origins.api).toEqual([]);
    expect(embedOriginsOf([{ route: { type: 'embedded', url: 'https://*.x.test' } }])).toEqual([]);
  });
});

describe('buildContentSecurityPolicy', () => {
  const origins = cspOriginsFromConfig(CONFIG);
  const HASH = "'sha256-abcDEF123+/=='";

  test('an app page: self plus nonce and handler hashes, no unsafe-inline, no unsafe-eval', () => {
    const d = directives(buildContentSecurityPolicy({ page: 'dashboard.html', nonce: 'Tm9uY2U0', handlerHashes: [HASH], origins }));
    expect(d['script-src']).toEqual(["'self'", "'nonce-Tm9uY2U0'", "'unsafe-hashes'", HASH, 'http://127.0.0.1:53117']);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['connect-src']).toEqual(["'self'", ...origins.api]);
    expect(d['frame-src']).toEqual(["'self'", 'blob:', ...origins.api, 'https://partner.example', 'https://other.example']);
    expect(d['worker-src']).toEqual(["'self'", 'blob:']);
    const policy = buildContentSecurityPolicy({ page: 'dashboard.html', nonce: 'Tm9uY2U0', handlerHashes: [HASH], origins });
    expect(policy).not.toMatch(/unsafe-eval/);
    expect(d['script-src']).not.toContain("'unsafe-inline'");
  });

  test('no source anywhere is a wildcard or a bare web scheme on app pages', () => {
    const allowedSchemes = new Set(['data:', 'blob:', 'lana-audio:']);
    const policy = buildContentSecurityPolicy({ page: 'workspaces.html', nonce: 'Tm9uY2U0', handlerHashes: [HASH], origins });
    for (const [name, sources] of Object.entries(directives(policy))) {
      for (const source of sources) {
        expect(source).not.toContain('*');
        if (/^[a-z-]+:$/.test(source)) expect({ name, source, ok: allowedSchemes.has(source) }).toEqual({ name, source, ok: true });
      }
    }
  });

  test('only the pages that reach a firm not saved yet may connect to any server: sign-in and activation', () => {
    // login.html: the typed or found firm, and the custom server field; activate.html: the firm an
    // Organization ID resolves to, before it is saved. first-launch.html fetches nothing.
    expect(SIGN_IN_PAGES).toEqual(['login.html', 'activate.html']);
    for (const page of SIGN_IN_PAGES) {
      expect(directives(buildContentSecurityPolicy({ page, nonce: 'Tm9uY2U0', origins }))['connect-src']).toEqual(["'self'", ...origins.api, 'https:', 'http:']);
    }
    for (const page of ['first-launch.html', 'dashboard.html', 'accept-invite.html', 'admin/login.html', 'login.html.evil', null]) {
      expect(directives(buildContentSecurityPolicy({ page, nonce: 'Tm9uY2U0', origins }))['connect-src']).not.toContain('https:');
    }
  });

  test('malformed nonces and hashes are dropped, never written into the policy', () => {
    const d = directives(buildContentSecurityPolicy({ page: 'x.html', nonce: "x' 'unsafe-inline", handlerHashes: ["'unsafe-inline'", "'sha256-ok='", 'sha256-noquotes'], origins: {} }));
    expect(d['script-src']).toEqual(["'self'", "'unsafe-hashes'", "'sha256-ok='"]);
  });

  test('nothing configured still yields a working, closed policy', () => {
    const d = directives(buildContentSecurityPolicy({ page: 'dashboard.html', nonce: 'Tm9uY2U0' }));
    expect(d['connect-src']).toEqual(["'self'"]);
    expect(d['script-src']).toEqual(["'self'", "'nonce-Tm9uY2U0'"]);
  });
});

test('the pages that fetch a firm before it is saved are exactly the broad ones', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', rel), 'utf8');
  // Both resolve an Organization ID and then talk to that firm on the same page.
  expect(read('login.html')).toMatch(/OrgDiscovery\.resolveOrganization\(/);
  expect(read('js/pages/activate.js')).toMatch(/Discovery\.resolveOrganization\(/);
  // first-launch makes no request of its own (it talks to the main process only).
  const firstLaunchScripts = ['js/first-launch.js', 'js/first-launch.model.js', 'js/first-launch.pages.js', 'js/local-ai-fit.model.js'];
  for (const file of firstLaunchScripts) expect({ file, fetches: /\bfetch\(|XMLHttpRequest/.test(read(file)) }).toEqual({ file, fetches: false });
});

describe('the help center origin', () => {
  const origins = { api: ['https://chef.firm.test'], editor: [], embed: [], help: ['https://www.redroostertec.com'] };
  const connect = (page) => directives(buildContentSecurityPolicy({ page, nonce: 'Tm9uY2U0', origins }))['connect-src'];

  test('only the help pages (and the app shell that can host them) may fetch it, in connect-src only', () => {
    // help.html, faq.html and article.html load standalone or inside app.html (the router keeps
    // the shell's URL), so app.html needs it too.
    expect(HELP_CENTER_PAGES).toEqual(['help.html', 'faq.html', 'article.html', 'app.html']);
    for (const page of HELP_CENTER_PAGES) expect(connect(page)).toContain('https://www.redroostertec.com');
    for (const page of ['dashboard.html', 'login.html', 'settings-v2.html', 'admin/help.html', null]) {
      expect(connect(page)).not.toContain('https://www.redroostertec.com');
    }
    const d = directives(buildContentSecurityPolicy({ page: 'help.html', nonce: 'Tm9uY2U0', origins }));
    for (const name of ['img-src', 'frame-src', 'media-src', 'script-src']) expect(d[name]).not.toContain('https://www.redroostertec.com');
  });
});

describe('the editor service', () => {
  test('its fonts load wherever its scripts do (file viewer and editor)', () => {
    const origins = { api: [], editor: ['http://127.0.0.1:53117'], embed: [], help: [] };
    const d = directives(buildContentSecurityPolicy({ page: 'file-viewer.html', nonce: 'Tm9uY2U0', origins }));
    expect(d['script-src']).toContain('http://127.0.0.1:53117');
    expect(d['font-src']).toEqual(["'self'", 'data:', 'http://127.0.0.1:53117']);
  });
});

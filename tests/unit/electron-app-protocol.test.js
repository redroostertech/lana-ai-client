'use strict';

// The app protocol: lana-app://app/public_html/<page> (electron-app-protocol.js).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  APP_ORIGIN,
  SCHEME_PRIVILEGES,
  isAppUrl,
  appPageUrl,
  pageOf,
  resolveAppFile,
  appUrlForFileUrl,
  prepareHtml,
  createAppProtocolHandler
} = require('../../electron-app-protocol');

const sha = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

describe('origin and URLs', () => {
  test('a standard, secure scheme with fetch and CORS, never allowed to bypass the CSP', () => {
    expect(APP_ORIGIN).toBe('lana-app://app');
    expect(SCHEME_PRIVILEGES).toMatchObject({ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true });
    expect(SCHEME_PRIVILEGES.bypassCSP).toBeUndefined();
  });

  test('isAppUrl is the exact app origin only', () => {
    expect(isAppUrl('lana-app://app/public_html/dashboard.html')).toBe(true);
    expect(isAppUrl('lana-app://app/')).toBe(true);
    ['lana-app://evil/public_html/x.html', 'file:///public_html/x.html', 'https://app/public_html/x.html', 'lana-ai://reset-password?token=x', '', null, 'junk']
      .forEach((url) => expect(isAppUrl(url)).toBe(false));
  });

  test('page URLs keep /public_html/ (the renderer finds the app root by it) and their query', () => {
    expect(appPageUrl('dashboard.html')).toBe('lana-app://app/public_html/dashboard.html');
    expect(appPageUrl('/admin/users.html?tab=a#b')).toBe('lana-app://app/public_html/admin/users.html?tab=a#b');
    expect(pageOf('lana-app://app/public_html/admin/users.html?x=1')).toBe('admin/users.html');
    expect(pageOf('lana-app://app/dashboard.html')).toBeNull();
  });
});

describe('resolveAppFile', () => {
  let root;
  let outside;
  beforeAll(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-app-protocol-'));
    root = path.join(base, 'public_html');
    outside = path.join(base, 'secret.txt');
    fs.mkdirSync(path.join(root, 'admin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dashboard.html'), '<p>x</p>');
    fs.writeFileSync(path.join(root, 'admin', 'users.html'), '<p>x</p>');
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(root, 'link.txt'));
  });

  test('pages and assets under public_html resolve', () => {
    expect(resolveAppFile('lana-app://app/public_html/dashboard.html?x=1#y', root)).toBe(path.join(root, 'dashboard.html'));
    expect(resolveAppFile('lana-app://app/public_html/admin/users.html', root)).toBe(path.join(root, 'admin', 'users.html'));
    expect(resolveAppFile('lana-app://app/public_html/admin%20x/a.js', root)).toBe(path.join(root, 'admin x', 'a.js'));
  });

  test('traversal, encoded separators, other origins, other prefixes and symlink escapes are refused', () => {
    [
      'lana-app://app/public_html/../secret.txt',
      'lana-app://app/public_html/%2e%2e/secret.txt',
      'lana-app://app/public_html/admin/..%2f..%2fsecret.txt',
      'lana-app://app/public_html/admin%5c..%5c..%5csecret.txt',
      'lana-app://app/public_html/a%00.html',
      'lana-app://app/public_html/C:%2fx',
      'lana-app://app/public_html/',
      'lana-app://app/secret.txt',
      'lana-app://evil/public_html/dashboard.html',
      'file:///public_html/dashboard.html',
      'lana-app://app/public_html/link.txt'
    ].forEach((url) => expect({ url, file: resolveAppFile(url, root) }).toEqual({ url, file: null }));
    expect(resolveAppFile('lana-app://app/public_html/dashboard.html', '')).toBeNull();
  });

  test('an old file:// link to an app page maps to its app URL; anything else does not', () => {
    const { pathToFileURL } = require('url');
    expect(appUrlForFileUrl(pathToFileURL(path.join(root, 'admin', 'users.html')).href + '?a=1#h', root))
      .toBe('lana-app://app/public_html/admin/users.html?a=1#h');
    expect(appUrlForFileUrl(pathToFileURL(outside).href, root)).toBeNull();
    expect(appUrlForFileUrl('https://x.test/', root)).toBeNull();
  });
});

describe('prepareHtml', () => {
  test('puts the nonce on the page\'s own script tags only, never inside a script body', () => {
    const html = '<head><script src="a.js"></script><SCRIPT>var s = "<script>x<\\/script>";</SCRIPT>'
      + '<script nonce="keep">1</script><scripts></scripts></head>';
    const out = prepareHtml(html, 'N0nce').html;
    expect(out).toBe('<head><script nonce="N0nce" src="a.js"></script><script nonce="N0nce">var s = "<script>x<\\/script>";</SCRIPT>'
      + '<script nonce="keep">1</script><scripts></scripts></head>');
  });

  test('hashes every inline handler in the markup, decoded as the parser sees it, and none inside scripts', () => {
    const html = '<button onclick="go(\'a\')">x</button><a onMouseOver=\'hi("b")\'></a>'
      + '<input onchange="set(&quot;q&quot;, this.value &amp;&amp; 1)">'
      + '<script>el.innerHTML = \'<b onclick="nope()">\';</script>';
    const { handlerHashes } = prepareHtml(html, 'n');
    expect(handlerHashes.sort()).toEqual([sha("go('a')"), sha('hi("b")'), sha('set("q", this.value && 1)')].sort());
    expect(handlerHashes).not.toContain(sha('nope()'));
  });
});

describe('createAppProtocolHandler', () => {
  let root;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-app-handler-'));
    fs.writeFileSync(path.join(root, 'page.html'), '<script>1</script><button onclick="go()">x</button>');
    fs.writeFileSync(path.join(root, 'app.js'), 'x');
  });

  test('an HTML page is served with its CSP, nosniff and no-store; the policy sees the page, nonce and hashes', async () => {
    const seen = [];
    const handler = createAppProtocolHandler({
      appRoot: root,
      fetchFile: jest.fn(),
      makeNonce: () => 'TOKEN',
      buildPolicy: (input) => { seen.push(input); return "script-src 'self'"; }
    });
    const response = await handler({ url: 'lana-app://app/public_html/page.html?x=1', headers: new Map() });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe("script-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('<script nonce="TOKEN">1</script><button onclick="go()">x</button>');
    expect(seen).toEqual([{ page: 'page.html', nonce: 'TOKEN', handlerHashes: [sha('go()')] }]);
  });

  test('other files go to net.fetch as file:// (MIME types, ranges); refused paths are 404', async () => {
    const fetchFile = jest.fn(async () => new Response('x'));
    const handler = createAppProtocolHandler({ appRoot: root, fetchFile, buildPolicy: () => '' });
    const headers = { get: (name) => (name === 'range' ? 'bytes=0-1' : null) };
    await handler({ url: 'lana-app://app/public_html/app.js', headers });
    expect(fetchFile).toHaveBeenCalledWith(require('url').pathToFileURL(path.join(root, 'app.js')).href, { headers: { Range: 'bytes=0-1' } });
    expect((await handler({ url: 'lana-app://app/public_html/../x', headers })).status).toBe(404);
    expect((await handler({ url: 'lana-app://app/public_html/missing.html', headers })).status).toBe(404);
  });

  test('non-HTML files carry a CSP too: none for SVG scripts, workers on the app origin only, nothing for the rest', async () => {
    for (const name of ['icon.svg', 'worker.mjs', 'data.json', 'readme.txt', 'font.woff2']) fs.writeFileSync(path.join(root, name), 'x');
    const fetchFile = jest.fn(async () => new Response('x', { status: 200, headers: { 'content-type': 'application/octet-stream', 'x-kept': '1' } }));
    const handler = createAppProtocolHandler({ appRoot: root, fetchFile, buildPolicy: () => '' });
    const csp = async (name) => (await handler({ url: `lana-app://app/public_html/${name}`, headers: new Map() })).headers;
    const svg = await csp('icon.svg');
    expect(svg.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(svg.get('content-security-policy')).not.toMatch(/script-src/);
    expect(svg.get('x-content-type-options')).toBe('nosniff');
    expect(svg.get('x-kept')).toBe('1');
    const js = await csp('app.js');
    expect(js.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect((await csp('worker.mjs')).get('content-security-policy')).toBe(js.get('content-security-policy'));
    for (const name of ['data.json', 'readme.txt', 'font.woff2']) {
      expect((await csp(name)).get('content-security-policy')).toBe("default-src 'none'; sandbox");
    }
  });

  test('the SPA shell (app.html) also allows every page\'s inline handlers, since the router swaps their markup in', async () => {
    const spaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lana-app-spa-'));
    fs.mkdirSync(path.join(spaRoot, 'admin'));
    fs.writeFileSync(path.join(spaRoot, 'app.html'), '<button onclick="shell()">s</button>');
    fs.writeFileSync(path.join(spaRoot, 'a.html'), '<button onclick="pageA()">a</button>');
    fs.writeFileSync(path.join(spaRoot, 'admin', 'b.html'), '<i onmouseover="pageB()">b</i>');
    const seen = {};
    const handler = createAppProtocolHandler({ appRoot: spaRoot, fetchFile: jest.fn(), buildPolicy: ({ page, handlerHashes }) => { seen[page] = handlerHashes.slice().sort(); return 'x'; } });
    await handler({ url: 'lana-app://app/public_html/app.html', headers: new Map() });
    await handler({ url: 'lana-app://app/public_html/a.html', headers: new Map() });
    expect(seen['app.html']).toEqual([sha('shell()'), sha('pageA()'), sha('pageB()')].sort());
    expect(seen['a.html']).toEqual([sha('pageA()')]);
  });

  test('the storage migration page is empty and runs no script', async () => {
    const handler = createAppProtocolHandler({ appRoot: root, fetchFile: jest.fn(), buildPolicy: () => 'x' });
    const response = await handler({ url: 'lana-app://app/__storage-migration', headers: new Map() });
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(await response.text()).not.toMatch(/<script/i);
  });
});

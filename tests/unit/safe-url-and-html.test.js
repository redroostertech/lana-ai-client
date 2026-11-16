'use strict';

// One scheme allowlist for every backend or model supplied URL the renderer
// frames, opens or links (js/shared/safe-url.js), and one sanitizer for
// converted document HTML that goes into innerHTML (js/shared/safe-html.js).

const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.resolve(__dirname, '../../src');
const SafeUrl = require(path.join(SRC, 'js/shared/safe-url.js'));
const SafeHtml = require(path.join(SRC, 'js/shared/safe-html.js'));

describe('LanaSafeUrl.schemeOf', () => {
  test.each([
    ['https://a.example/x', 'https'],
    ['HTTP://a.example', 'http'],
    ['mailto:a@b.example', 'mailto'],
    ['javascript:alert(1)', 'javascript'],
    [' JaVa\tScRipt:alert(1)', 'javascript'],
    ['data:text/html,<b>x</b>', 'data'],
    ['blob:file:///abc', 'blob'],
    ['file:///etc/passwd', 'file'],
    ['/api/v1/x', 'relative'],
    ['//evil.example/x', 'relative'],
    ['doc-studio/index.html?id=1', 'relative'],
    ['', ''],
    [null, '']
  ])('%p is %p', (url, scheme) => {
    expect(SafeUrl.schemeOf(url)).toBe(scheme);
  });
});

describe('LanaSafeUrl allowlists', () => {
  // Inputs a browser resolves as RELATIVE (so file:// with traversal) even
  // though a loose scheme reader would see "https".
  const RELATIVE_LOOKALIKES = [
    'https :/../../e.html',
    'https\u0001:/../x.html',
    ' https :/../x',
    'ht tps://evil.example/x',
    'https\u0000://evil.example'
  ];

  test('isHttpUrl accepts only absolute http and https', () => {
    expect(SafeUrl.isHttpUrl('https://a.example')).toBe(true);
    expect(SafeUrl.isHttpUrl('http://localhost:3000/x')).toBe(true);
    ['javascript:alert(1)', 'data:text/html,x', 'blob:file:///a', 'file:///a', '/api/x', '//evil.example', 'mailto:a@b.example']
      .concat(RELATIVE_LOOKALIKES)
      .forEach((url) => expect(SafeUrl.isHttpUrl(url)).toBe(false));
  });

  test.each(RELATIVE_LOOKALIKES)('%p is not mistaken for https anywhere', (url) => {
    expect(SafeUrl.schemeOf(url)).toBe('relative');
    expect(SafeUrl.safeHttpUrl(url)).toBe('');
    expect(SafeUrl.safeHttpUrl(url, 'http://localhost:3000')).toBe('');
    expect(SafeUrl.safeLinkHref(url)).toBe('');
    expect(SafeUrl.safeDocStudioUrl(url, 'https://api.example')).toBe('');
  });

  test('safeHttpUrl returns the parsed href, never the raw string, with credentials stripped', () => {
    expect(SafeUrl.safeHttpUrl('https://minio.example/r.html')).toBe('https://minio.example/r.html');
    expect(SafeUrl.safeHttpUrl('  HTTPS://Minio.Example/a b')).toBe('https://minio.example/a%20b');
    expect(SafeUrl.safeHttpUrl('ht\ttps://a.example/x')).toBe('https://a.example/x');
    expect(SafeUrl.safeHttpUrl('https://user:pw@a.example/x')).toBe('https://a.example/x');
  });

  test('safeHttpUrl joins a root path to an http(s) base and keeps it on that origin', () => {
    expect(SafeUrl.safeHttpUrl('/api/v1/storage/files/1/download', 'http://localhost:3000')).toBe('http://localhost:3000/api/v1/storage/files/1/download');
    expect(SafeUrl.safeHttpUrl('/api/v1/x', 'https://api.example/base/')).toBe('https://api.example/api/v1/x');
    expect(SafeUrl.safeHttpUrl('/api/v1/x')).toBe('');
    expect(SafeUrl.safeHttpUrl('//evil.example/x', 'http://localhost:3000')).toBe('');
    expect(SafeUrl.safeHttpUrl('/\\evil.example/x', 'http://localhost:3000')).toBe('');
    expect(SafeUrl.safeHttpUrl('javascript:alert(1)', 'http://localhost:3000')).toBe('');
    expect(SafeUrl.safeHttpUrl('data:text/html,x')).toBe('');
    expect(SafeUrl.safeHttpUrl('/api/x', 'javascript:alert(1)//')).toBe('');
  });

  test('safeLinkHref keeps http(s) and mailto as parsed hrefs and nothing else', () => {
    expect(SafeUrl.safeLinkHref('mailto:a@b.example')).toBe('mailto:a@b.example');
    expect(SafeUrl.safeLinkHref('https://a.example')).toBe('https://a.example/');
    expect(SafeUrl.safeLinkHref('javascript:alert(1)')).toBe('');
    expect(SafeUrl.safeLinkHref('vbscript:x')).toBe('');
    expect(SafeUrl.isSafeLinkUrl('mailto:a@b.example')).toBe(true);
    expect(SafeUrl.isSafeLinkUrl('JAVA\nSCRIPT:alert(1)')).toBe(false);
  });

  test('safeDocStudioUrl accepts the app Doc Studio page or the API origin only', () => {
    const api = 'https://api.example';
    expect(SafeUrl.safeDocStudioUrl('doc-studio/index.html?id=1&view=doc&embed=1', api)).toBe('doc-studio/index.html?id=1&view=doc&embed=1');
    expect(SafeUrl.safeDocStudioUrl('doc-studio/index.html', api)).toBe('doc-studio/index.html');
    expect(SafeUrl.safeDocStudioUrl('https://api.example/doc-studio/p/1', api)).toBe('https://api.example/doc-studio/p/1');
    expect(SafeUrl.safeDocStudioUrl('http://localhost:3000/p/1', 'http://localhost:3000')).toBe('http://localhost:3000/p/1');
    [
      'https://studio.example/p/1',
      'https://api.example.evil.example/p',
      'http://api.example/p/1',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'blob:file:///abc',
      'file:///Users/x/doc-studio/index.html',
      '../doc-studio/index.html',
      'doc-studio/index.html/../../login.html',
      'doc-studio\\index.html',
      'login.html',
      '//evil.example/doc-studio/index.html',
      ''
    ].forEach((url) => expect(SafeUrl.safeDocStudioUrl(url, api)).toBe(''));
    expect(SafeUrl.safeDocStudioUrl('https://api.example/p/1')).toBe('');
  });
});

describe('LanaSafeUrl.safeAppOrLinkHref', () => {
  test('keeps http(s), mailto and plain relative app paths', () => {
    expect(SafeUrl.safeAppOrLinkHref('https://a.example/x')).toBe('https://a.example/x');
    expect(SafeUrl.safeAppOrLinkHref('mailto:a@b.example')).toBe('mailto:a@b.example');
    expect(SafeUrl.safeAppOrLinkHref('workspace-details.html?id=1#notes')).toBe('workspace-details.html?id=1#notes');
    expect(SafeUrl.safeAppOrLinkHref('agents/index.html#activity')).toBe('agents/index.html#activity');
    expect(SafeUrl.safeAppOrLinkHref('matters.html?q=a%20b%26c')).toBe('matters.html?q=a%20b%26c');
  });

  test.each([
    'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:file:///a',
    '//evil.example/x', '/\\evil.example', '../../../../Users/x/Downloads/evil.html', 'a/../../b.html',
    'https :/../x', 'pages\\x.html', 'x\u0001.html', '',
    '%2e%2e/%2e%2e/Users/x/evil.html', '..%2fx.html', 'a/%2E%2E/b.html', '%252e%252e/x.html',
    'javascript%3Aalert(1)', '%6a%61%76%61script:alert(1)', '%2f%2fevil.example/x', 'x%5c..%5cy.html',
    'a.html" onmouseover="x', "a.html'x", 'a.html<b>', 'a b.html', 'a.html`x'
  ])('refuses %p', (url) => {
    expect(SafeUrl.safeAppOrLinkHref(url)).toBe('');
  });
});

describe('LanaSafeHtml.sanitize', () => {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  const clean = (html) => {
    const out = document.createElement('div');
    out.innerHTML = SafeHtml.sanitize(html, document);
    return out;
  };

  test('a javascript: link loses its href but keeps its text', () => {
    const out = clean('<p><a href="javascript:top.lanaAuthToken.get()">Click</a></p>');
    const link = out.querySelector('a');
    expect(link.textContent).toBe('Click');
    expect(link.hasAttribute('href')).toBe(false);
  });

  test.each(['JAVASCRIPT:alert(1)', ' jav&#x61;script:alert(1)', 'vbscript:x', 'data:text/html,<script>1</script>', 'https :/../x', 'https&#1;:/../x.html', '../../etc/passwd'])(
    'an href of %p is removed',
    (href) => {
      expect(clean(`<a href="${href}">x</a>`).querySelector('a').hasAttribute('href')).toBe(false);
    }
  );

  test('an onerror image loses the handler and keeps a raster data image', () => {
    const out = clean('<img src="data:image/png;base64,iVBORw0KGgo=" onerror="top.lanaAuthToken.get()" alt="Seal">');
    const img = out.querySelector('img');
    expect(img.getAttribute('onerror')).toBeNull();
    expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(img.getAttribute('alt')).toBe('Seal');
  });

  test('an SVG data image and a bad src are dropped', () => {
    expect(clean('<img src="data:image/svg+xml;base64,PHN2Zz4=">').querySelector('img').hasAttribute('src')).toBe(false);
    expect(clean('<img src="x" onerror="alert(1)">').querySelector('img').hasAttribute('src')).toBe(false);
  });

  test('scripts, frames, forms, styles and inline SVG are removed', () => {
    const out = clean('<p>ok</p><script>alert(1)</script><iframe srcdoc="x"></iframe><form><button>b</button></form><style>*{}</style><svg onload="alert(1)"></svg><object data="x"></object>');
    expect(out.innerHTML).toBe('<p>ok</p>');
  });

  test('event handlers and inline style attributes are stripped from every element', () => {
    const out = clean('<p onclick="alert(1)" style="background:url(javascript:1)" class="x">t</p>');
    const p = out.querySelector('p');
    expect(p.getAttribute('onclick')).toBeNull();
    expect(p.getAttribute('style')).toBeNull();
    expect(p.getAttribute('class')).toBe('x');
  });

  test('normal document links and tables survive, with hrefs written back as parsed', () => {
    const html = '<h1>T</h1><p><a href=" https://a.example">w</a> <a href="mailto:a@b.example">m</a></p><table class="docx-table"><tr><td colspan="2">c</td></tr></table>';
    const out = clean(html);
    const hrefs = Array.from(out.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://a.example/', 'mailto:a@b.example']);
    expect(out.querySelector('td').getAttribute('colspan')).toBe('2');
  });

  test('document ids are prefixed so bookmarks cannot clobber app ids, and their anchors follow', () => {
    const out = clean('<p><a href="#footnote-1" id="footnote-ref-1">1</a></p><p id="viewerDocx" name="api">x</p><ol><li id="footnote-1">n</li></ol>');
    expect(out.querySelector('#footnote-ref-1')).toBeNull();
    expect(out.querySelector('#docx-footnote-ref-1')).not.toBeNull();
    expect(out.querySelector('a').getAttribute('href')).toBe('#docx-footnote-1');
    expect(out.querySelector('#docx-footnote-1')).not.toBeNull();
    expect(out.querySelector('#viewerDocx')).toBeNull();
    expect(out.querySelector('[name]')).toBeNull();
  });

  test('image src is written back as parsed http(s) or a raster data image', () => {
    expect(clean('<img src=" https://a.example/i.png">').querySelector('img').getAttribute('src')).toBe('https://a.example/i.png');
    expect(clean('<img src="https :/../x.png">').querySelector('img').hasAttribute('src')).toBe(false);
  });

  test('empty input returns empty output', () => {
    expect(SafeHtml.sanitize('', document)).toBe('');
    expect(SafeHtml.sanitize(null, document)).toBe('');
  });
});

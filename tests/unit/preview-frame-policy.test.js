'use strict';

// Untrusted previews (agent or model HTML, uploaded files, server URLs) must
// never run script with the app's file:// origin. The app windows run with
// webSecurity:false, so an unsandboxed srcdoc, blob: or data: frame can call
// top.lanaAuthToken.get() and read the login token. Verified in Electron
// 44.7.0 with the same webPreferences: srcdoc, blob and data frames without a
// sandbox read top globals; sandbox="allow-scripts" (no allow-same-origin)
// and sandbox="allow-same-origin" (no allow-scripts) do not. A sandboxed
// frame blanks Chromium's PDF viewer, so PDF blobs stay unsandboxed but are
// always typed application/pdf, which never parses as HTML.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');
const Policy = require(path.join(SRC, 'js/shared/preview-frame-policy.js'));

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

describe('sandboxFor', () => {
  test('inline model or agent HTML is inert: no scripts, no origin', () => {
    expect(Policy.sandboxFor({ source: 'inline-html', contentType: 'text/html' })).toBe('');
  });

  test('a frame the host must reach into gets its DOM but never script', () => {
    expect(Policy.sandboxFor({ source: 'inline-html', hostReadsDocument: true })).toBe('allow-same-origin');
  });

  test('every remote PDF is fetched into a blob; nothing is framed unsandboxed by URL', () => {
    const api = 'http://localhost:3000';
    expect(Policy.sandboxFor({ source: 'remote', url: 'http://localhost:3000/api/v1/x', filename: 'Redline.PDF', apiBase: api })).toBe('');
    expect(Policy.sandboxFor({ source: 'remote', url: 'https://minio.example/redline.pdf', apiBase: api })).toBe('');
    expect(Policy.remotePreviewPlan({ source: 'remote', url: 'http://localhost:3000/r.pdf', apiBase: api }))
      .toEqual({ src: '', sandbox: '', fetchPdf: 'http://localhost:3000/r.pdf' });
    expect(Policy.remotePreviewPlan({ source: 'remote', url: 'https://minio.example/r?id=1', contentType: 'application/pdf', apiBase: api }))
      .toEqual({ src: '', sandbox: '', fetchPdf: 'https://minio.example/r?id=1' });
    expect(Policy.remotePreviewPlan({ source: 'remote', url: 'https://minio.example/r.docx', allowDownloads: true, apiBase: api }))
      .toEqual({ src: 'https://minio.example/r.docx', sandbox: 'allow-downloads', fetchPdf: '' });
    expect(Policy.remotePreviewPlan({ source: 'remote', url: 'javascript:alert(1)', apiBase: api }))
      .toEqual({ src: '', sandbox: '', fetchPdf: '' });
  });

  test('remoteFrameAttrs writes a sandboxed fetch placeholder or a sandboxed frame, never an unsandboxed src', () => {
    const api = 'http://localhost:3000';
    expect(Policy.remoteFrameAttrs({ source: 'remote', url: 'https://minio.example/a.pdf?x=1&y="2"', apiBase: api }))
      .toBe(' sandbox="" data-lana-pdf-src="https://minio.example/a.pdf?x=1&amp;y=%222%22"');
    expect(Policy.remoteFrameAttrs({ source: 'remote', url: 'https://minio.example/a.html', contentType: 'text/html', apiBase: api }))
      .toBe(' sandbox="" src="https://minio.example/a.html"');
    expect(Policy.remoteFrameAttrs({ source: 'remote', url: 'http://localhost:3000/a.pdf', apiBase: api }))
      .toBe(' sandbox="" data-lana-pdf-src="http://localhost:3000/a.pdf"');
    expect(Policy.remoteFrameAttrs({ source: 'remote', url: 'file:///etc/hosts', apiBase: api })).toBe(' sandbox=""');
  });

  test.each([
    'http://127.0.0.1:53117/v1/redline', 'http://localhost/x.pdf', 'http://foo.localhost/x.pdf', 'http://0x7f.1/x.pdf',
    'http://[::1]/x.pdf', 'http://10.1.2.3/x.pdf', 'http://172.20.0.1/x.pdf', 'http://192.168.1.10/x.pdf',
    'http://169.254.169.254/latest/meta-data', 'http://[fd00::1]/x.pdf', 'http://[fe80::1]/x.pdf', 'http://0.0.0.0/x.pdf',
    'http://[::ffff:127.0.0.1]/x.pdf', 'http://100.64.0.1/x.pdf',
    'http://localhost./x.pdf', 'http://foo.localhost./x.pdf', 'http://127.0.0.1./x.pdf',
    'http://[::7f00:1]/x.pdf', 'http://[::a00:1]/x.pdf', 'http://[64:ff9b::7f00:1]/x.pdf', 'http://[64:ff9b::a9fe:a9fe]/x.pdf'
  ])('isFetchablePdfUrl refuses the private or local host %p (unless it is the API origin)', (url) => {
    expect(Policy.isFetchablePdfUrl(url, 'https://api.example')).toBe(false);
  });

  test('isFetchablePdfUrl allows public hosts and the API origin even when it is local', () => {
    expect(Policy.isFetchablePdfUrl('https://minio.example/a.pdf', 'http://localhost:3000')).toBe(true);
    expect(Policy.isFetchablePdfUrl('http://[64:ff9b::808:808]/a.pdf', 'http://localhost:3000')).toBe(true);
    expect(Policy.isFetchablePdfUrl('http://[2001:db8::1]/a.pdf', 'http://localhost:3000')).toBe(true);
    expect(Policy.isFetchablePdfUrl('http://localhost:3000/api/v1/f.pdf', 'http://localhost:3000')).toBe(true);
    expect(Policy.isFetchablePdfUrl('http://localhost:3001/f.pdf', 'http://localhost:3000')).toBe(false);
  });

  function hydrateEnv(html, opts = {}) {
    const { JSDOM } = require('jsdom');
    const { window } = new JSDOM(`<body>${html}</body>`);
    const created = [];
    const revoked = [];
    const urlApi = {
      createObjectURL: (blob) => { created.push(blob); return `blob:file:///pdf-${created.length}`; },
      revokeObjectURL: (u) => revoked.push(u)
    };
    const fetchImpl = jest.fn(opts.fetch || (async () => ({
      ok: true, headers: { get: () => null }, blob: async () => new Blob(['<script>top.t()</script>'], { type: 'text/html' })
    })));
    return { window, created, revoked, fetchImpl, deps: Object.assign({ fetch: fetchImpl, URL: urlApi }, opts.deps || {}) };
  }

  test('hydratePdfFrames shows a fetched PDF as a retyped application/pdf blob with no credentials', async () => {
    const env = hydrateEnv('<iframe sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>');
    await Policy.hydratePdfFrames(env.window.document, env.deps);
    const frame = env.window.document.querySelector('iframe');
    expect(env.fetchImpl).toHaveBeenCalledWith('https://minio.example/a.pdf', { credentials: 'omit', redirect: 'error', headers: { 'X-Lana-Untrusted-Fetch': '1' } });
    expect(env.created[0].type).toBe('application/pdf');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.getAttribute('src')).toBe('blob:file:///pdf-1');
  });

  test('an API-origin PDF is fetched with the API client token', async () => {
    const env = hydrateEnv('<iframe sandbox="" data-lana-pdf-src="http://localhost:3000/api/v1/files/1/download"></iframe>',
      { deps: { apiBase: 'http://localhost:3000', apiToken: 'chef-jwt' } });
    await Policy.hydratePdfFrames(env.window.document, env.deps);
    expect(env.fetchImpl).toHaveBeenCalledWith('http://localhost:3000/api/v1/files/1/download',
      { credentials: 'omit', headers: { 'X-Lana-Untrusted-Fetch': '1', Authorization: 'Bearer chef-jwt' } });
    expect(env.window.document.querySelector('iframe').hasAttribute('sandbox')).toBe(false);
  });

  test('the token is never sent to any other origin', async () => {
    const env = hydrateEnv('<iframe sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>',
      { deps: { apiBase: 'http://localhost:3000', apiToken: 'chef-jwt' } });
    await Policy.hydratePdfFrames(env.window.document, env.deps);
    expect(env.fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  test('private, loopback and non http(s) targets are never fetched and stay sandboxed', async () => {
    const env = hydrateEnv('<iframe id="a" sandbox="" data-lana-pdf-src="http://127.0.0.1:53117/v1/redline"></iframe><iframe id="b" sandbox="" data-lana-pdf-src="http://169.254.169.254/x"></iframe><iframe id="c" sandbox="" data-lana-pdf-src="file:///etc/hosts"></iframe>',
      { deps: { apiBase: 'https://api.example' } });
    await Policy.hydratePdfFrames(env.window.document, env.deps);
    expect(env.fetchImpl).not.toHaveBeenCalled();
    ['a', 'b', 'c'].forEach((id) => {
      const frame = env.window.document.getElementById(id);
      expect(frame.getAttribute('sandbox')).toBe('');
      expect(frame.hasAttribute('src')).toBe(false);
    });
  });

  test('a failed fetch or an oversized PDF leaves the frame sandboxed and empty', async () => {
    const big = hydrateEnv('<iframe id="big" sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>', {
      fetch: async () => ({ ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(200 * 1024 * 1024) : null) }, blob: async () => new Blob(['x']) })
    });
    await Policy.hydratePdfFrames(big.window.document, big.deps);
    const bad = hydrateEnv('<iframe id="bad" sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>', {
      fetch: async () => ({ ok: false, status: 404, headers: { get: () => null } })
    });
    await Policy.hydratePdfFrames(bad.window.document, bad.deps);
    const sized = hydrateEnv('<iframe id="sized" sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>', {
      fetch: async () => ({ ok: true, headers: { get: () => null }, blob: async () => ({ size: Policy.MAX_PDF_BYTES + 1 }) })
    });
    await Policy.hydratePdfFrames(sized.window.document, sized.deps);
    [[big, 'big'], [bad, 'bad'], [sized, 'sized']].forEach(([env, id]) => {
      const frame = env.window.document.getElementById(id);
      expect(frame.getAttribute('sandbox')).toBe('');
      expect(frame.hasAttribute('src')).toBe(false);
      expect(env.created.length).toBe(0);
    });
    expect(Policy.MAX_PDF_BYTES).toBe(100 * 1024 * 1024);
  });

  function streamOf(chunks, onCancel) {
    let i = 0;
    return { getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
      cancel: async () => { if (onCancel) onCancel(); }
    }) };
  }

  test('without content-length the body is streamed, counted and cut off past the cap', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const env = hydrateEnv('<iframe id="s" sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>', {
      fetch: async () => ({ ok: true, headers: { get: () => null }, body: streamOf(new Array(101).fill(chunk), () => { cancelled = true; }), blob: async () => { throw new Error('blob() must not be used'); } })
    });
    await Policy.hydratePdfFrames(env.window.document, env.deps);
    const frame = env.window.document.getElementById('s');
    expect(cancelled).toBe(true);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.hasAttribute('src')).toBe(false);
    expect(env.created.length).toBe(0);
  });

  test('a small streamed body is shown as an application/pdf blob', async () => {
    const env = hydrateEnv('<iframe sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>', {
      fetch: async () => ({ ok: true, headers: { get: () => null }, body: streamOf([new TextEncoder().encode('%PDF-1.4'), new TextEncoder().encode(' x')]) })
    });
    await Policy.hydratePdfFrames(env.window.document, env.deps);
    expect(env.created.length).toBe(1);
    expect(env.created[0].type).toBe('application/pdf');
    expect(env.created[0].size).toBe(10);
  });

  test('a frame removed before the fetch resolves gets no object URL', async () => {
    let release;
    const env = hydrateEnv('<iframe sandbox="" data-lana-pdf-src="https://minio.example/a.pdf"></iframe>', {
      fetch: () => new Promise((resolve) => { release = resolve; })
    });
    const done = Policy.hydratePdfFrames(env.window.document, env.deps);
    env.window.document.querySelector('iframe').remove();
    release({ ok: true, headers: { get: () => null }, blob: async () => new Blob(['%PDF']) });
    await done;
    expect(env.created.length).toBe(0);
  });

  test('a remote http(s) HTML redline is sandboxed with no script; downloads only when asked', () => {
    expect(Policy.sandboxFor({ source: 'remote', url: 'https://minio.example/redline.html', contentType: 'text/html' })).toBe('');
    expect(Policy.sandboxFor({ source: 'remote', url: 'https://minio.example/redline' })).toBe('');
    expect(Policy.sandboxFor({ source: 'remote', url: 'https://minio.example/redline.docx', allowDownloads: true })).toBe('allow-downloads');
    expect(Policy.sandboxFor({ source: 'remote', url: 'https://minio.example/redline.pdf', allowDownloads: true })).toBe('');
  });

  test.each(['https :/../../e.pdf', 'https\u0001:/../x.pdf', 'blob:https://minio.example/x.pdf', 'data:application/pdf;base64,JVBERi0='])(
    'a lookalike or non http(s) PDF URL %p stays fully sandboxed',
    (url) => {
      expect(Policy.sandboxFor({ source: 'remote', url, contentType: 'application/pdf', allowDownloads: true })).toBe('');
    }
  );

  test.each(['data:text/html,<script>1</script>', 'blob:file:///abc', 'file:///etc/hosts', 'javascript:alert(1)', '/api/v1/x', 'redline.html', '//evil.example/x', '', undefined])(
    'a remote preview at %p stays fully sandboxed',
    (url) => {
      expect(Policy.sandboxFor({ source: 'remote', url })).toBe('');
    }
  );

  test('a PDF blob is left unsandboxed so the built-in PDF viewer renders it', () => {
    expect(Policy.sandboxFor({ source: 'blob', contentType: 'application/pdf' })).toBeNull();
    expect(Policy.sandboxFor({ source: 'blob', contentType: 'Application/PDF; charset=binary' })).toBeNull();
  });

  test.each(['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', '', undefined])(
    'a %p blob is sandboxed with no script',
    (contentType) => {
      expect(Policy.sandboxFor({ source: 'blob', contentType })).toBe('');
    }
  );

  test('downloads can be kept for blobs that are saved rather than shown', () => {
    expect(Policy.sandboxFor({ source: 'blob', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', allowDownloads: true }))
      .toBe('allow-downloads');
  });

  test('an unknown source fails closed', () => {
    expect(Policy.sandboxFor({})).toBe('');
    expect(Policy.sandboxFor()).toBe('');
  });

  test('no policy ever grants script', () => {
    const cases = [
      { source: 'inline-html' }, { source: 'inline-html', hostReadsDocument: true },
      { source: 'remote' }, { source: 'remote', url: 'data:text/html,x' }, { source: 'blob', contentType: 'text/html', allowDownloads: true },
      { source: 'blob', contentType: 'image/svg+xml', hostReadsDocument: true }
    ];
    cases.forEach((opts) => {
      expect(String(Policy.sandboxFor(opts))).not.toMatch(/allow-scripts/);
    });
  });
});

describe('isPdf and pdfBlob', () => {
  test('isPdf matches the PDF type or a .pdf name', () => {
    expect(Policy.isPdf('application/pdf')).toBe(true);
    expect(Policy.isPdf('', 'Will.PDF')).toBe(true);
    expect(Policy.isPdf('text/html', 'page.html')).toBe(false);
    expect(Policy.isPdf()).toBe(false);
  });

  test('pdfBlob retypes any bytes as application/pdf so HTML cannot render as a page', async () => {
    const html = new Blob(['<script>top.lanaAuthToken.get()</script>'], { type: 'text/html' });
    const blob = Policy.pdfBlob(html);
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toContain('<script>');
    expect(Policy.pdfBlob(new Uint8Array([37, 80, 68, 70]).buffer).type).toBe('application/pdf');
  });
});

describe('call sites that render untrusted content', () => {
  test('automation run previews are sandboxed through the policy', () => {
    const runs = read('automation/js/views/runs.js');
    const frames = runs.match(/<iframe[\s\S]*?><\/iframe>/g) || [];
    expect(frames.length).toBeGreaterThanOrEqual(2);
    frames.forEach((frame) => expect(frame).toMatch(/\$\{(previewSandbox|remoteFrame)\(\{ source: '(inline-html|remote)'/));
    const remote = frames.find((frame) => frame.includes("source: 'remote'"));
    expect(remote).toMatch(/\$\{remoteFrame\(\{ source: 'remote', url: remoteUrl, filename: artifactName\(artifact\), allowDownloads: true \}\)\}/);
    expect(remote).not.toMatch(/\ssrc="/);
    expect(runs).toMatch(/const remoteUrl = safeArtifactUrl\(artifact\.download_url\)/);
    expect(runs).toMatch(/policy \? policy\.sandboxAttr\(opts\) : ' sandbox=""'/);
    expect(runs).not.toMatch(/allow-scripts/);
  });

  test('library detail artifact previews are sandboxed; the redline pane keeps DOM access only', () => {
    const detail = read('automation/js/views/library-detail.js');
    const frames = detail.match(/<iframe[\s\S]*?><\/iframe>/g) || [];
    expect(frames.length).toBeGreaterThanOrEqual(3);
    frames.forEach((frame) => expect(frame).toMatch(/\$\{(previewSandbox|remoteFrame)\(\{ source: '(inline-html|remote)'/));
    const remote = frames.find((frame) => frame.includes("source: 'remote'"));
    expect(remote).toMatch(/\$\{remoteFrame\(\{ source: 'remote', url: redlineUrl, contentType: 'text\/html' \}\)\}/);
    expect(remote).not.toMatch(/\ssrc="/);
    const redline = frames.find((frame) => frame.includes('data-ld-redline-frame'));
    expect(redline).toMatch(/hostReadsDocument:\s*true/);
    expect(detail).toMatch(/policy \? policy\.sandboxAttr\(opts\) : ' sandbox=""'/);
    expect(detail).not.toMatch(/allow-scripts/);
  });

  test('the automation page loads the policy before its views', () => {
    const html = read('automation/index.html');
    const policy = html.indexOf('../js/shared/preview-frame-policy.js');
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(html.indexOf('app.js'));
  });

  test('file viewer PDF fallback always types the blob as PDF, never the upload content_type', () => {
    const viewer = read('js/file-viewer-page.js');
    expect(viewer).not.toMatch(/new Blob\(\[arrayBuffer\],\s*\{\s*type:\s*file\.content_type/);
    const loadPdf = viewer.slice(viewer.indexOf('async function loadPDF('), viewer.indexOf('async function loadImage('));
    expect(loadPdf).toMatch(/LanaPreviewFrame\.pdfBlob\(/);
  });

  test('docx template previews use the policy for both frames', () => {
    const modal = read('js/services/docx-template-modal.js');
    const frames = modal.match(/<iframe[^>]*>/g) || [];
    expect(frames.length).toBe(0);
    expect(modal).toMatch(/LanaPreviewFrame\.pdfBlob\(/);
    expect(modal).toMatch(/Policy\.sandboxFor\(\{\s*source: 'blob'/);
  });

  test.each(['js/workspace-details.js'])('%s retypes PDF blobs before framing them', (rel) => {
    expect(read(rel)).toMatch(/LanaPreviewFrame\.pdfBlob\(/);
  });

  test.each(['file-viewer.html', 'workspace-details.html'])('%s loads the policy', (rel) => {
    expect(read(rel)).toMatch(/js\/shared\/preview-frame-policy\.js/);
  });

  test('embedded partner apps keep the spec sandbox and only ever frame https', () => {
    const host = read('js/embed-host.js');
    expect(host).toContain("frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups')");
    expect(host).toMatch(/target\.protocol !== 'https:' \|\| target\.origin !== approved\.origin/);
  });

  test.each(['automation/js/views/runs.js', 'automation/js/views/library-detail.js'])(
    '%s links download_url only through the shared http(s) allowlist',
    (rel) => {
      const source = read(rel);
      expect(source).not.toMatch(/href="\$\{escapeAttribute\([^)]*download_url\)\}"/);
      expect(source).toMatch(/import \{[^}]*safeArtifactUrl[^}]*\} from '\.\.\/shared\/api-base-url\.js'/);
    }
  );

  test('safeArtifactUrl resolves through LanaSafeUrl', () => {
    const shared = read('automation/js/shared/api-base-url.js');
    expect(shared).toMatch(/export function safeArtifactUrl\(/);
    expect(shared).toMatch(/window\.LanaSafeUrl/);
    expect(shared).toMatch(/safeUrl\.safeHttpUrl\(url, canonicalBaseUrl\(\)\)/);
  });

  test.each([
    ['js/workspace-details.js', 'openDocStudioDocumentViewer', 'openDocStudioDocumentInTab'],
    ['js/components/doc-studio-create-modal.js', 'openDocStudioDocumentViewer', 'openInTab']
  ])('%s frames and opens only the parsed Doc Studio URL that passed the allowlist', (rel, viewerFn, tabFn) => {
    const source = read(rel);
    expect(source).toMatch(/LanaSafeUrl\.safeDocStudioUrl\(url, api && api\.baseUrl\)/);
    expect(source).not.toMatch(/isAllowedDocStudioUrl/);
    const viewer = source.slice(source.indexOf(`function ${viewerFn}(`));
    const guard = viewer.indexOf('var safeUrl = safeDocStudioUrl(url);');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(viewer.indexOf('frame.src = safeUrl'));
    expect(viewer.slice(0, viewer.indexOf('\n  }\n'))).not.toMatch(/frame\.src = url/);
    const tab = source.slice(source.indexOf(`function ${tabFn}(`));
    expect(tab.indexOf('safeDocStudioUrl(')).toBeGreaterThan(-1);
    expect(tab.indexOf('safeDocStudioUrl(')).toBeLessThan(tab.indexOf("window.open(safeUrl, '_blank'"));
  });

  test.each(['js/workspace-details.js'])('%s revokes every viewer object URL and keeps none unused', (rel) => {
    const source = read(rel);
    const start = source.search(/async function viewOrphanedDocument\(|window\.viewOrphanedDocument = async function/);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('mammoth.convertToHtml', start));
    const created = body.match(/URL\.createObjectURL\(/g) || [];
    const tracked = body.match(/viewerObjectUrl = URL\.createObjectURL\(/g) || [];
    expect(created.length).toBeGreaterThan(0);
    expect(tracked.length).toBe(created.length);
    expect(body).toMatch(/URL\.revokeObjectURL\(viewerObjectUrl\)/);
  });

  // Consumers that never put mammoth HTML in the DOM: DOMParser documents
  // are inert, and the result is reduced to plain text.
  const TEXT_ONLY_CONSUMERS = {
    'js/admin/run-books.js': /return RunBookDraft\.htmlToRunBookText\(result && result\.value\);/
  };

  test('every mammoth convertToHtml result in src/ is sanitized before it reaches the DOM', () => {
    const consumers = [];
    walk(SRC, []).forEach((file) => {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (SKIP.test(rel)) return;
      const text = fs.readFileSync(file, 'utf8');
      if (!/convertToHtml\(/.test(text)) return;
      consumers.push(rel);
      if (TEXT_ONLY_CONSUMERS[rel]) {
        expect(text).toMatch(TEXT_ONLY_CONSUMERS[rel]);
        return;
      }
      const raw = text.match(/(innerHTML|outerHTML|insertAdjacentHTML\([^,]*,)\s*=?\s*result\.value\b/g) || [];
      expect({ rel, raw }).toEqual({ rel, raw: [] });
      const sinks = text.match(/result\.value/g) || [];
      const sanitized = text.match(/LanaSafeHtml\.sanitize\(result\.value\)/g) || [];
      expect({ rel, unsanitized: sinks.length - sanitized.length }).toEqual({ rel, unsanitized: 0 });
    });
    expect(consumers.sort()).toEqual(['js/admin/run-books.js', 'js/file-viewer-page.js', 'js/workspace-details.js']);
  });

  test.each([
    ['automation/index.html', ['safe-url.js', 'preview-frame-policy.js']],
    ['file-viewer.html', ['safe-url.js', 'safe-html.js', 'preview-frame-policy.js']],
    ['workspace-details.html', ['safe-url.js', 'safe-html.js', 'preview-frame-policy.js']],
    ['folder.html', ['safe-url.js']]
  ])('%s loads the shared safety scripts in dependency order', (rel, scripts) => {
    const html = read(rel);
    const positions = scripts.map((name) => html.indexOf('js/shared/' + name));
    positions.forEach((pos) => expect(pos).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  // ---------------------------------------------------------------------
  // Whole-tree scans. Every frame, frame src, embed, popup and URL-valued
  // link in src/ is either provably safe by construction or listed here
  // with the reason it is trusted, so a new one fails until reviewed.
  // ---------------------------------------------------------------------
  const SKIP = /(^|\/)vendor\/|\.min\.js$|tiptap-bundle|\.md$|\.backup$/;

  function walk(dir, out) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(js|html|mjs)$/.test(entry.name)) out.push(full);
    });
    return out;
  }

  function sources() {
    return walk(SRC, [])
      .map((file) => ({ rel: path.relative(SRC, file).split(path.sep).join('/'), file }))
      .filter(({ rel }) => !SKIP.test(rel))
      .map(({ rel, file }) => ({ rel, text: fs.readFileSync(file, 'utf8') }));
  }

  function lineOf(text, index) {
    return text.slice(0, index).split('\n').length;
  }

  // Frames that only ever show the app's own pages or a vetted PDF blob.
  const TRUSTED_FRAMES = {
    'data-connectors.html#connectorDashboardFrame': 'app page integrations/connector-viewer.html',
    'file-viewer.html#viewerIframe': 'PDF blobs built with LanaPreviewFrame.pdfBlob (plus a sandboxed demo srcdoc)',
    'workspace-details.html#viewerIframe': 'PDF blobs built with LanaPreviewFrame.pdfBlob',
    'workspace-details.html#docStudioDocumentViewerFrame': 'src is LanaSafeUrl.safeDocStudioUrl output',
    'js/components/doc-studio-create-modal.js#dscmViewerFrame': 'src is LanaSafeUrl.safeDocStudioUrl output',
    'js/lex/chat/lex-chat.js#lex-chat-source-viewer-frame': 'app page file-viewer.html in embedded mode'
  };

  // A real sandbox attribute: a literal sandbox="...", the automation
  // previewSandbox() call that emits one, or setAttribute('sandbox', ...).
  const REAL_SANDBOX = /\ssandbox="[^"]*"|\$\{previewSandbox\(\{|\$\{remoteFrame\(\{|\.setAttribute\(\s*'sandbox'\s*,/;

  function frameSites() {
    const sites = [];
    sources().forEach(({ rel, text }) => {
      if (rel === 'js/shared/preview-frame-policy.js') return;
      const re = /<iframe\b|createElement\(\s*['"]iframe['"]\s*\)|\.srcdoc\s*=|setAttribute\(\s*['"]srcdoc['"]/g;
      let m;
      while ((m = re.exec(text))) {
        let snippet;
        if (m[0].startsWith('<iframe')) snippet = text.slice(m.index, text.indexOf('>', m.index) + 1);
        else if (m[0].startsWith('createElement')) snippet = text.slice(m.index, m.index + 800);
        else snippet = text.slice(Math.max(0, m.index - 300), m.index);
        sites.push({ rel, line: lineOf(text, m.index), kind: m[0], snippet });
      }
    });
    return sites;
  }

  function trustedKey(site) {
    const id = site.snippet.match(/\bid="([^"]+)"/) || site.snippet.match(/className = '([^']+)'/);
    return id ? `${site.rel}#${id[1]}` : null;
  }

  test('every frame in src/ has a real sandbox attribute or is on the trusted app-page list', () => {
    const sites = frameSites();
    expect(sites.length).toBeGreaterThanOrEqual(12);
    const offenders = sites.filter((site) => {
      if (site.kind.startsWith('<iframe') || site.kind.startsWith('createElement')) {
        if (REAL_SANDBOX.test(site.snippet)) return false;
        const key = trustedKey(site);
        return !(key && TRUSTED_FRAMES[key]);
      }
      return false;
    }).map((site) => `${site.rel}:${site.line} ${site.kind}`);
    expect(offenders).toEqual([]);
  });

  test('the word "sandbox" alone does not count as a sandbox', () => {
    expect(REAL_SANDBOX.test('<iframe title="sandbox preview" data-x="no sandbox">')).toBe(false);
    expect(REAL_SANDBOX.test('<iframe sandbox="" src="x">')).toBe(true);
  });

  test('every trusted frame entry still exists (no stale allowlist)', () => {
    const keys = new Set(frameSites().map(trustedKey).filter(Boolean));
    const markupIds = new Set();
    sources().forEach(({ rel, text }) => {
      (text.match(/<iframe[^>]*\bid="[^"]+"/g) || []).forEach((tag) => markupIds.add(`${rel}#${tag.match(/id="([^"]+)"/)[1]}`));
    });
    Object.keys(TRUSTED_FRAMES).forEach((key) => {
      expect(keys.has(key) || markupIds.has(key)).toBe(true);
    });
  });

  test('srcdoc is only ever set on a sandboxed frame', () => {
    const assignments = frameSites().filter((site) => !site.kind.startsWith('<iframe') && !site.kind.startsWith('createElement'));
    expect(assignments.length).toBeGreaterThanOrEqual(1);
    assignments.forEach((site) => expect(site.snippet).toMatch(/setAttribute\('sandbox', ''\)/));
  });

  // Every `<frame>.src = value` assignment, by file and exact value.
  const FRAME_SRC_ALLOW = {
    'js/shared/auth-token-bridge.js': ["'about:blank'"],
    'js/components/doc-studio-create-modal.js': ['safeUrl', "'about:blank'"],
    'js/workspace-details.js': ['safeUrl', "'about:blank'", 'viewerObjectUrl'],
    'js/data_connectors.js': ['url', "'about:blank'"],
    'js/embed-host.js': ['session.embed_url'],
    'js/file-viewer-page.js': ["citedPage ? objectUrl + '#page=' + citedPage : objectUrl"],
    'js/lex/chat/lex-chat.js': ["Nav.href(nav.path, Object.assign({}, nav.params, { chrome: 'embedded' }))", "'about:blank'"],
    'js/services/docx-template-modal.js': ['src']
  };

  function frameSrcAssignments() {
    const found = [];
    sources().forEach(({ rel, text }) => {
      const re = /\b([A-Za-z_$][\w$]*)\.src\s*=\s*([^;\n]+);/g;
      let m;
      while ((m = re.exec(text))) {
        if (/frame/i.test(m[1])) found.push({ rel, line: lineOf(text, m.index), value: m[2].trim() });
      }
    });
    return found;
  }

  test('every frame .src assignment in src/ uses a reviewed value', () => {
    const offenders = frameSrcAssignments()
      .filter(({ rel, value }) => !(FRAME_SRC_ALLOW[rel] || []).includes(value))
      .map(({ rel, line, value }) => `${rel}:${line} = ${value}`);
    expect(offenders).toEqual([]);
  });

  test('the frame .src allowlist has no stale entries, and the vetted values are vetted where set', () => {
    const seen = new Set(frameSrcAssignments().map(({ rel, value }) => `${rel}|${value}`));
    Object.entries(FRAME_SRC_ALLOW).forEach(([rel, values]) => values.forEach((value) => expect(seen.has(`${rel}|${value}`)).toBe(true)));
    expect(read('js/file-viewer-page.js')).toMatch(/var blob = window\.LanaPreviewFrame\.pdfBlob\(arrayBuffer\);\n\s*var objectUrl = URL\.createObjectURL\(blob\);/);
    expect(read('js/embed-host.js')).toMatch(/target\.protocol !== 'https:' \|\| target\.origin !== approved\.origin/);
    expect(read('js/data_connectors.js')).toMatch(/return 'integrations\/connector-viewer\.html\?' \+ params\.toString\(\);/);
  });

  test('no <embed> or <object> anywhere in src/', () => {
    const offenders = [];
    sources().forEach(({ rel, text }) => {
      // (?<![\w$]) skips JSDoc types such as Array<object>.
      const re = /(?<![\w$])<(embed|object)\b|createElement\(\s*['"](embed|object)['"]\s*\)/g;
      let m;
      while ((m = re.exec(text))) offenders.push(`${rel}:${lineOf(text, m.index)}`);
    });
    expect(offenders).toEqual([]);
  });

  // Every window.open target, by file and exact first argument. http(s) goes
  // to the system browser and anything else is isolated or denied by
  // electron-window-open-policy.js; this list keeps new popups reviewed.
  const WINDOW_OPEN_ALLOW = {
    'admin/js/relevance-labeling.js': ['`/document-viewer.html?id=${docId}`'],
    'automation/app.js': ['getApiUrl(`/api/v1/automation/artifacts/${encodeURIComponent(artifactId)}/download`)'],
    'automation/js/views/library-detail.js': ['getApiUrl(`/api/v1/automation/artifacts/${encodeURIComponent(artifactId)}/download`)'],
    'doc-studio/app.js': ['url'],
    'integrations/connector-viewer.html': ['authUrl'],
    'js/calendar/calendar-page.js': ['safeUrl'],
    'js/components/doc-studio-create-modal.js': ['safeUrl'],
    'js/connect-wizard.js': ['url'],
    'js/data_connectors.js': ['data.url'],
    'js/lex/components/chat/lex-lana-panel.js': ['downloadUrl'],
    'js/mcp-connect.js': ['url'],
    'js/pages/settings-billing.js': ['url'],
    'js/pages/settings-general.js': ['url'],
    'js/settings-v2.js': ['url'],
    'js/workspace-details.js': ['safeUrl']
  };

  function firstArg(text, start) {
    let depth = 0;
    let i = start;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === ',' && depth === 0) break;
    }
    return text.slice(start, i).trim();
  }

  function windowOpenCalls() {
    const found = [];
    sources().forEach(({ rel, text }) => {
      const re = /\bwindow\.open\(/g;
      let m;
      while ((m = re.exec(text))) found.push({ rel, line: lineOf(text, m.index), arg: firstArg(text, m.index + m[0].length) });
    });
    return found;
  }

  test('every window.open in src/ opens a reviewed target', () => {
    const offenders = windowOpenCalls()
      .filter(({ rel, arg }) => !(WINDOW_OPEN_ALLOW[rel] || []).includes(arg))
      .map(({ rel, line, arg }) => `${rel}:${line} window.open(${arg})`);
    expect(offenders).toEqual([]);
    const seen = new Set(windowOpenCalls().map(({ rel, arg }) => `${rel}|${arg}`));
    Object.entries(WINDOW_OPEN_ALLOW).forEach(([rel, args]) => args.forEach((arg) => expect(seen.has(`${rel}|${arg}`)).toBe(true)));
  });

  // href sinks whose value is a URL from data (template `${...}` or string
  // concatenation). Each must go through the LanaSafeUrl allowlist.
  const SAFE_HREF = /safeArtifactUrl\(|safeExternalLink\(|^escapeAttribute\(redlineUrl\)$|^escapeHtml\(docsUrl\)$|^escapeHtml\(href\)$|^esc\(href\)$|^escHtml\(href\)$|^escapeAttr\(href\)$/;

  function hrefSinks() {
    const found = [];
    sources().forEach(({ rel, text }) => {
      const re = /href="\$\{([^}]*(?:\([^)]*\))?[^}]*)\}"|href="' \+ ([^+]+?) \+ '"/g;
      let m;
      while ((m = re.exec(text))) {
        const expr = (m[1] || m[2] || '').trim();
        // URL-valued data fields (download_url, link.url, docsUrl, ...).
        // App-built route variables named href are out of scope here.
        if (/url|Url|URL/.test(expr)) found.push({ rel, line: lineOf(text, m.index), expr });
      }
    });
    return found;
  }

  test('every URL-valued href sink in src/ goes through the shared allowlist', () => {
    const sinks = hrefSinks();
    expect(sinks.length).toBeGreaterThanOrEqual(10);
    const offenders = sinks.filter(({ expr }) => !SAFE_HREF.test(expr)).map(({ rel, line, expr }) => `${rel}:${line} href=${expr}`);
    expect(offenders).toEqual([]);
  });

  test.each([
    ['js/lex/chat/lex-chat.format.js', /const href = global\.LanaSafeUrl \? global\.LanaSafeUrl\.safeAppOrLinkHref\(url\) : '';/],
    ['js/lex/blocks/text.block.js', /var href = window\.LanaSafeUrl \? window\.LanaSafeUrl\.safeAppOrLinkHref\(url\) : '';/],
    ['js/components/task-detail-drawer.js', /window\.LanaSafeUrl\.safeAppOrLinkHref\(String\(doc\.url\)\)/],
    ['agents/js/views/activity-detail.js', /window\.LanaSafeUrl\.safeAppOrLinkHref\(String\(target\.url\)\)/],
    ['integrations/connector-viewer.html', /return safeExternalLink\(getRawDocumentationLink\(\)\);/]
  ])('%s builds its href from LanaSafeUrl', (rel, pattern) => {
    expect(read(rel)).toMatch(pattern);
  });

  test('every page that loads an href-sink script also loads safe-url.js', () => {
    const sinkScripts = ['lex-chat.format.js', 'task-detail-drawer.js', 'text.block.js', 'views/activity-detail.js', 'safeExternalLink('];
    const missing = sources()
      .filter(({ rel, text }) => rel.endsWith('.html') && sinkScripts.some((name) => text.includes(name)))
      .filter(({ text }) => !/<script src="[^"]*js\/shared\/safe-url\.js"><\/script>/.test(text))
      .map(({ rel }) => rel);
    expect(missing).toEqual([]);
  });

  test('SPA routes load the shared helpers their scripts need', () => {
    const router = read('js/lex/lex-router.pages.js');
    const blocks = router.split(/\n {4}'[^']+\.html': \{/).slice(1);
    blocks.forEach((block) => {
      const has = (name) => block.includes(`'js/shared/${name}'`);
      if (/lex-chat\.format\.js|task-detail-drawer\.js/.test(block)) expect(has('safe-url.js')).toBe(true);
      if (/lex-chat\.format\.js|admin\/reporting\.js|document-metadata-viewer\.js|lex\.markdown\.js|workspace-artifacts-view\.js|drilldown-renderer\.js/.test(block)) {
        expect(has('safe-url.js')).toBe(true);
        expect(has('safe-html.js')).toBe(true);
      }
      if (/docx-template-modal\.js|'js\/workspace-details\.js'/.test(block)) {
        expect(has('safe-html.js')).toBe(true);
        expect(has('preview-frame-policy.js')).toBe(true);
      }
    });
  });
  test.each(['automation/js/views/runs.js', 'automation/js/views/library-detail.js'])('%s remote frames go through remoteFrame with the API base, failing closed', (rel) => {
    const source = read(rel);
    expect(source).toMatch(/function remoteFrame\(opts\) \{[\s\S]*?policy \? policy\.remoteFrameAttrs\(Object\.assign\(\{ apiBase: window\.api && window\.api\.baseUrl \}, opts\)\) : ' sandbox=""'/);
  });

  test('the automation page starts the PDF frame hydrator', () => {
    expect(read('js/shared/preview-frame-policy.js')).toMatch(/watchPdfFrames\(global\.document\)/);
  });

  // marked output is model or backend text: it goes through LanaSafeHtml.
  test.each([
    ['js/workspace-details.js', /el\.innerHTML = window\.LanaSafeHtml \? window\.LanaSafeHtml\.renderMarkdown\(fullText\) : /],
    ['js/admin/reporting.js', /return window\.LanaSafeHtml \? window\.LanaSafeHtml\.renderMarkdown\(text, \{ inline: true, breaks: true \}\)/],
    ['js/admin/reporting.js', /return window\.LanaSafeHtml \? window\.LanaSafeHtml\.renderMarkdown\(text, \{ unwrapParagraph: true, breaks: true \}\)/],
    ['js/components/document-metadata-viewer.js', /return window\.LanaSafeHtml \? window\.LanaSafeHtml\.renderMarkdown\(text\) : this\.escapeHtml\(text\);/],
    ['js/lex/lex.markdown.js', /return window\.LanaSafeHtml \? window\.LanaSafeHtml\.renderMarkdown\(src\) : /],
    ['js/lex/lex.markdown.js', /return window\.LanaSafeHtml \? window\.LanaSafeHtml\.renderMarkdown\(src, \{ inline: true \}\) : /]
  ])('%s renders marked output through LanaSafeHtml', (rel, pattern) => {
    expect(read(rel)).toMatch(pattern);
  });

  test('no marked parser (parse, parseInline, new Marked, marked()) is used outside safe-html.js', () => {
    const offenders = [];
    sources().forEach(({ rel, text }) => {
      if (rel === 'js/shared/safe-html.js') return;
      const re = /marked\.parse(Inline)?\(|new\s+[\w$.]*Marked\(|\bmarked\(/g;
      let m;
      while ((m = re.exec(text))) offenders.push(`${rel}:${lineOf(text, m.index)}`);
    });
    expect(offenders).toEqual([]);
  });

  test('every page that loads a markdown or chat renderer also loads safe-url.js then safe-html.js', () => {
    const users = ['lex-chat.format.js', 'lex.markdown.js', 'document-metadata-viewer.js', 'admin/reporting.js', 'js/reporting.js', 'renderMarkdownBlock', 'workspace-artifacts-view.js', 'drilldown-renderer.js'];
    const bad = sources()
      .filter(({ rel, text }) => rel.endsWith('.html') && users.some((name) => text.includes(name)))
      .filter(({ text }) => {
        const url = text.search(/<script src="[^"]*js\/shared\/safe-url\.js"><\/script>/);
        const html = text.search(/<script src="[^"]*js\/shared\/safe-html\.js"><\/script>/);
        return url === -1 || html === -1 || url > html;
      })
      .map(({ rel }) => rel);
    expect(bad).toEqual([]);
  });

  test('embed-host fallback link uses the parsed https URL', () => {
    const host = read('js/embed-host.js');
    expect(host).not.toMatch(/link\.href = app\.embed\.url/);
    expect(host).toMatch(/var fallbackHref = global\.LanaSafeUrl \? global\.LanaSafeUrl\.safeHttpUrl\(app\.embed\.url\) : '';/);
    expect(read('embed.html')).toMatch(/<script src="js\/shared\/safe-url\.js"><\/script>/);
  });

  test('activity detail fallback escaper escapes quotes', () => {
    const source = read('agents/js/views/activity-detail.js');
    const fallback = source.slice(source.indexOf('var escHtml ='), source.indexOf('var timeAgo ='));
    expect(fallback).not.toMatch(/d\.innerHTML/);
    expect(fallback).toMatch(/&quot;/);
    expect(fallback).toMatch(/&#39;/);
  });
  test.each([
    ['js/components/workspace-artifacts-view.js', /global\.LanaSafeHtml\.renderMarkdown\(content\)/],
    ['js/drilldown-renderer.js', /window\.LanaSafeHtml\.renderMarkdown\(text, \{ inline: true, breaks: true \}\)/],
    ['js/drilldown-renderer.js', /window\.LanaSafeHtml\.renderMarkdown\(text, \{ unwrapParagraph: true, breaks: true \}\)/]
  ])('%s uses the one markdown sanitizer', (rel, pattern) => {
    const source = read(rel);
    expect(source).toMatch(pattern);
    expect(source).not.toMatch(/renderMarkdownSafe/);
  });

  test('no caller anywhere still uses Lex.Utils.renderMarkdownSafe', () => {
    const offenders = sources().filter(({ text }) => /renderMarkdownSafe/.test(text)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  test('the hydrator reads the API base and token from the page API client', () => {
    const policy = read('js/shared/preview-frame-policy.js');
    expect(policy).toMatch(/apiBase: api && api\.baseUrl/);
    expect(policy).toMatch(/apiToken: api && api\.token/);
  });
  test.each([
    ['js/admin/reporting.js', /renderMarkdown\(text, \{ inline: true, breaks: true \}\)/],
    ['js/admin/reporting.js', /renderMarkdown\(text, \{ unwrapParagraph: true, breaks: true \}\)/],
    ['js/drilldown-renderer.js', /renderMarkdown\(text, \{ inline: true, breaks: true \}\)/],
    ['js/drilldown-renderer.js', /renderMarkdown\(text, \{ unwrapParagraph: true, breaks: true \}\)/]
  ])('%s keeps the single-newline breaks it had (marked.use breaks on its page)', (rel, pattern) => {
    expect(read(rel)).toMatch(pattern);
  });
});

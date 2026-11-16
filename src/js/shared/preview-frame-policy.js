/**
 * preview-frame-policy.js
 * Picks the iframe sandbox for previews of content the app did not write:
 * agent or model HTML, uploaded files, and server-supplied preview URLs.
 *
 * The app windows run with webSecurity:false, which gives every same-process
 * document universal access. An unsandboxed srcdoc, blob: or data: frame can
 * therefore reach top.lanaAuthToken.get() and read the login token. Verified
 * in Electron 44.7.0 with the app's webPreferences: those frames read top
 * globals, while sandbox="allow-scripts" (no allow-same-origin) and
 * sandbox="allow-same-origin" (no allow-scripts) both block it.
 *
 * Rules:
 *  - Never grant allow-scripts. Previews are for reading.
 *  - A frame the host page must reach into (the redline pane scrolls to a
 *    change) gets allow-same-origin only: no script runs inside it, so the
 *    shared origin cannot be used against the app.
 *  - A PDF blob stays unsandboxed: a sandboxed frame blanks Chromium's PDF
 *    viewer. The blob is always retyped application/pdf (pdfBlob), so bytes
 *    that are really HTML or SVG show a PDF load error instead of running.
 *  - A remote preview is sandboxed. A remote PDF can only render outside a
 *    sandbox, and an unsandboxed http(s) document can still fetch file://
 *    under webSecurity:false, so no remote URL is ever framed unsandboxed.
 *    Every remote PDF is fetched and shown as a retyped application/pdf
 *    blob, which cannot run script (hydratePdfFrames, started on every page
 *    by watchPdfFrames). API-origin PDFs are fetched with the API client's
 *    token; nothing else gets credentials. Loopback, private and link-local
 *    hosts are never fetched (unless they are the API origin), the body is
 *    capped at MAX_PDF_BYTES, and every hydrator request carries
 *    X-Lana-Untrusted-Fetch so the main process never adds the local
 *    editor's token to it. HTML redlines get sandbox=""; allowDownloads adds
 *    allow-downloads so a DOCX can still be saved. Any non http(s) URL gets
 *    sandbox="" and no src.
 *
 * Classic script (window.LanaPreviewFrame) so Jest can require it and both
 * the ES-module automation views and the IIFE pages can read it.
 */
(function (global) {
  'use strict';

  var PDF_TYPE = 'application/pdf';
  var MAX_PDF_BYTES = 100 * 1024 * 1024;
  var UNTRUSTED_FETCH_HEADER = 'X-Lana-Untrusted-Fetch';
  var NODE_SAFE_URL = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./safe-url.js')
    : null;

  function safeUrl() {
    return NODE_SAFE_URL || (global && global.LanaSafeUrl) || null;
  }

  function escapeAttr(value) {
    return String(value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  function baseType(contentType) {
    return String(contentType || '').split(';')[0].trim().toLowerCase();
  }

  function isPdf(contentType, filename) {
    if (baseType(contentType) === PDF_TYPE) return true;
    return /\.pdf$/i.test(String(filename || ''));
  }

  /**
   * @param {Object} [opts]
   * @param {'inline-html'|'remote'|'blob'} [opts.source]
   * @param {string} [opts.contentType]
   * @param {string} [opts.url] - for 'remote': the URL that will be framed
   * @param {string} [opts.filename] - for 'remote': name used to spot a PDF
   * @param {string} [opts.apiBase] - for 'remote': configured API base URL
   * @param {boolean} [opts.hostReadsDocument] - host needs the frame's DOM
   * @param {boolean} [opts.allowDownloads] - frame may save a file it cannot show
   * @returns {string|null} sandbox attribute value, or null for no sandbox
   *   (a PDF blob, which the caller must build with pdfBlob, or a remote PDF
   *   on the API origin)
   */
  function sandboxFor(opts) {
    var o = opts || {};
    if (o.source === 'blob' && baseType(o.contentType) === PDF_TYPE) return null;
    if (o.source === 'remote') return remotePreviewPlan(o).sandbox;
    var flags = [];
    if (o.hostReadsDocument) flags.push('allow-same-origin');
    if (o.allowDownloads) flags.push('allow-downloads');
    return flags.join(' ');
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (_) {
      return '';
    }
  }

  /**
   * How to show a remote preview.
   * @returns {{ src: string, sandbox: string|null, fetchPdf: string }}
   *   src: frame it at this parsed href (sandbox null means no sandbox);
   *   fetchPdf: render a sandboxed placeholder and let hydratePdfFrames
   *   fetch this href and show it as a PDF blob. Both '' means no frame.
   */
  function remotePreviewPlan(opts) {
    var o = opts || {};
    var urls = safeUrl();
    var href = urls ? urls.safeHttpUrl(typeof o.url === 'string' ? o.url : '') : '';
    if (!href) return { src: '', sandbox: '', fetchPdf: '' };
    var pdf = isPdf(o.contentType, o.filename) || /\.pdf$/i.test(new URL(href).pathname);
    if (pdf) return { src: '', sandbox: '', fetchPdf: href };
    return { src: href, sandbox: o.allowDownloads ? 'allow-downloads' : '', fetchPdf: '' };
  }

  /** Attribute text for a remote preview frame (see remotePreviewPlan). */
  function remoteFrameAttrs(opts) {
    var plan = remotePreviewPlan(opts);
    var attrs = plan.sandbox === null ? '' : ' sandbox="' + plan.sandbox + '"';
    if (plan.fetchPdf) return attrs + ' data-lana-pdf-src="' + escapeAttr(plan.fetchPdf.replace(/"/g, '%22')) + '"';
    if (plan.src) return attrs + ' src="' + escapeAttr(plan.src) + '"';
    return attrs;
  }

  function ipv4Parts(host) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    return m ? m.slice(1).map(Number) : null;
  }

  function isPrivateIpv4(p) {
    return p[0] === 0 || p[0] === 10 || p[0] === 127 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168);
  }

  /** The 8 hextets of an IPv6 literal (already normalised by URL), or null. */
  function ipv6Hextets(host) {
    if (host.indexOf(':') === -1) return null;
    var value = host;
    var tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (tail) {
      var v4 = ipv4Parts(tail[1]);
      if (!v4) return null;
      value = value.slice(0, -tail[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
    }
    var halves = value.split('::');
    if (halves.length > 2) return null;
    var head = halves[0] ? halves[0].split(':') : [];
    var rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    var fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
    if (fill < 0) return null;
    var words = head.concat(new Array(fill).fill('0'), rest).map(function (w) { return parseInt(w || '0', 16); });
    return words.length === 8 && words.every(function (w) { return w >= 0 && w <= 0xffff; }) ? words : null;
  }

  /**
   * Loopback, private, CGNAT, link-local, unspecified or *.localhost (a
   * trailing dot is ignored), including IPv6 forms that embed a private IPv4:
   * IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64
   * (64:ff9b::a.b.c.d).
   */
  function isLocalHost(hostname) {
    var host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (!host || host === 'localhost' || /\.localhost$/.test(host)) return true;
    var v4 = ipv4Parts(host);
    if (v4) return isPrivateIpv4(v4);
    var w = ipv6Hextets(host);
    if (!w) return host.indexOf(':') !== -1;
    var embedded = [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255];
    var zeros5 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0;
    if (zeros5 && w[5] === 0) return true; // ::, ::1 and IPv4-compatible
    if (zeros5 && w[5] === 0xffff) return isPrivateIpv4(embedded);
    if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0) return isPrivateIpv4(embedded);
    return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80;
  }

  /**
   * True when the hydrator may fetch this URL: http(s), and either the API
   * origin or a host that is not local or private. (Names that resolve to a
   * private address cannot be checked from the renderer.)
   */
  function isFetchablePdfUrl(url, apiBase) {
    var urls = safeUrl();
    var href = urls ? urls.safeHttpUrl(typeof url === 'string' ? url : '') : '';
    if (!href) return false;
    var api = urls.safeHttpUrl(typeof apiBase === 'string' ? apiBase : '');
    if (api && originOf(api) === originOf(href)) return true;
    return !isLocalHost(new URL(href).hostname);
  }

  /**
   * The response body as a Blob, read as a stream with a running byte count
   * and cancelled as soon as it passes MAX_PDF_BYTES (a missing or false
   * Content-Length cannot make it buffer more). Falls back to blob() when
   * the response has no readable stream.
   */
  function readCappedBody(response) {
    var reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
    if (!reader) return response.blob();
    var chunks = [];
    var total = 0;
    function pump() {
      return reader.read().then(function (step) {
        if (step.done) return new Blob(chunks);
        total += step.value ? step.value.byteLength : 0;
        if (total > MAX_PDF_BYTES) {
          return Promise.resolve(typeof reader.cancel === 'function' ? reader.cancel() : null).then(function () {
            throw new Error('PDF too large');
          });
        }
        chunks.push(step.value);
        return pump();
      });
    }
    return pump();
  }

  function pageApi() {
    return (global && global.api) || null;
  }

  /**
   * Fetch every placeholder frame's PDF and show it as an application/pdf
   * blob (the bytes can never run as a page). On failure the frame stays
   * sandboxed and empty.
   * @param {Document|Element} root
   * @param {{ fetch?: Function, URL?: object, apiBase?: string, apiToken?: string }} [deps]
   *   defaults: window.fetch, window.URL and the page API client (window.api)
   */
  function hydratePdfFrames(root, deps) {
    var d = deps || {};
    var api = pageApi();
    var opts = Object.assign({ apiBase: api && api.baseUrl, apiToken: api && api.token }, d);
    var fetchImpl = opts.fetch || (global && global.fetch);
    var urlApi = opts.URL || (global && global.URL);
    if (!root || typeof root.querySelectorAll !== 'function' || !fetchImpl || !urlApi) return Promise.resolve();
    var frames = Array.prototype.slice.call(root.querySelectorAll('iframe[data-lana-pdf-src]'));
    return Promise.all(frames.map(function (frame) {
      var raw = frame.getAttribute('data-lana-pdf-src');
      frame.removeAttribute('data-lana-pdf-src');
      var urls = safeUrl();
      var href = urls ? urls.safeHttpUrl(raw || '') : '';
      if (!href || !isFetchablePdfUrl(href, opts.apiBase)) {
        frame.setAttribute('data-lana-pdf-error', 'true');
        return null;
      }
      var headers = {};
      headers[UNTRUSTED_FETCH_HEADER] = '1';
      var apiHref = urls.safeHttpUrl(typeof opts.apiBase === 'string' ? opts.apiBase : '');
      var onApi = Boolean(apiHref) && originOf(apiHref) === originOf(href);
      if (opts.apiToken && onApi) headers.Authorization = 'Bearer ' + opts.apiToken;
      var init = { credentials: 'omit', headers: headers };
      // A redirect could lead off the checked host (to loopback, say).
      if (!onApi) init.redirect = 'error';
      return Promise.resolve(fetchImpl(href, init))
        .then(function (response) {
          if (!response || !response.ok) throw new Error('PDF fetch failed');
          var length = response.headers && typeof response.headers.get === 'function'
            ? Number(response.headers.get('content-length')) : 0;
          if (length > MAX_PDF_BYTES) throw new Error('PDF too large');
          return readCappedBody(response);
        })
        .then(function (blob) {
          if (!blob || blob.size > MAX_PDF_BYTES) throw new Error('PDF too large');
          // The view may have re-rendered while the fetch ran.
          if (frame.isConnected === false) return;
          var objectUrl = urlApi.createObjectURL(pdfBlob(blob));
          frame.setAttribute('data-lana-pdf-object-url', objectUrl);
          frame.removeAttribute('sandbox');
          frame.setAttribute('src', objectUrl);
          if (frame.isConnected === false && typeof urlApi.revokeObjectURL === 'function') urlApi.revokeObjectURL(objectUrl);
        })
        .catch(function () {
          frame.setAttribute('data-lana-pdf-error', 'true');
        });
    }));
  }

  /** Hydrate placeholder frames as they appear; revoke blobs when they go. */
  function watchPdfFrames(doc) {
    if (!doc || !doc.documentElement || typeof global.MutationObserver !== 'function') return null;
    var observer = new global.MutationObserver(function (records) {
      var added = false;
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes || [], function (node) {
          if (node.nodeType === 1) added = true;
        });
        Array.prototype.forEach.call(record.removedNodes || [], function (node) {
          if (node.nodeType !== 1 || !global.URL || typeof global.URL.revokeObjectURL !== 'function') return;
          var gone = node.matches && node.matches('iframe[data-lana-pdf-object-url]') ? [node] : [];
          gone = gone.concat(Array.prototype.slice.call(node.querySelectorAll ? node.querySelectorAll('iframe[data-lana-pdf-object-url]') : []));
          gone.forEach(function (frame) { global.URL.revokeObjectURL(frame.getAttribute('data-lana-pdf-object-url')); });
        });
      });
      if (added) hydratePdfFrames(doc);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    hydratePdfFrames(doc);
    return observer;
  }

  /** Attribute text for template strings: ' sandbox="..."' or ''. */
  function sandboxAttr(opts) {
    var value = sandboxFor(opts);
    return value === null ? '' : ' sandbox="' + value + '"';
  }

  /** Retype any Blob or ArrayBuffer as a PDF so it never renders as a page. */
  function pdfBlob(data) {
    return new Blob([data], { type: PDF_TYPE });
  }

  var moduleApi = {
    sandboxFor: sandboxFor,
    sandboxAttr: sandboxAttr,
    remotePreviewPlan: remotePreviewPlan,
    remoteFrameAttrs: remoteFrameAttrs,
    hydratePdfFrames: hydratePdfFrames,
    isFetchablePdfUrl: isFetchablePdfUrl,
    MAX_PDF_BYTES: MAX_PDF_BYTES,
    watchPdfFrames: watchPdfFrames,
    isPdf: isPdf,
    pdfBlob: pdfBlob
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaPreviewFrame = moduleApi;
    // Every page that loads the policy hydrates remote PDF placeholders.
    if (global.document && typeof global.MutationObserver === 'function') {
      watchPdfFrames(global.document);
    }
  }
})(typeof window !== 'undefined' ? window : this);

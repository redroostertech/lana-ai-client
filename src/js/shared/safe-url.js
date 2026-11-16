/**
 * safe-url.js
 * One scheme allowlist for URLs the renderer frames, opens or links when the
 * URL came from the backend, a model, a document or a user (artifact links,
 * Doc Studio previews, chat and text-block markdown links, connector docs).
 *
 * The app windows run with webSecurity:false, so a javascript:, data:, blob:
 * or file: URL that reaches a frame, window.open or a link can run with the
 * app's file:// origin and read the login token. http(s) URLs are cross
 * origin to file:// and cannot reach window.top.
 *
 * Every check parses with the WHATWG URL parser (new URL, the same parser
 * the browser uses) and every helper hands back the PARSED href, never the
 * raw string. A loose reader that dropped spaces or control characters would
 * read "https :/../x" as https while the browser resolves it as a relative
 * file:// path with traversal.
 *
 * Classic script (window.LanaSafeUrl) so Jest can require it and both the
 * ES-module automation views and the IIFE pages can read it.
 */
(function (global) {
  'use strict';

  var DOC_STUDIO_PAGE = /^doc-studio\/index\.html(\?[^#\\]*)?(#[^\\]*)?$/;

  /** Absolute URL object, or null when the value does not parse alone. */
  function parseAbsolute(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      return new URL(value);
    } catch (_) {
      return null;
    }
  }

  function stripCredentials(parsed) {
    parsed.username = '';
    parsed.password = '';
    return parsed;
  }

  function isHttpProtocol(parsed) {
    return !!parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  }

  /**
   * Scheme as the browser reads it, lowercased ('https', 'javascript', ...),
   * 'relative' when the value has no valid scheme, '' when empty.
   */
  function schemeOf(url) {
    if (url === null || url === undefined || String(url).trim() === '') return '';
    var parsed = parseAbsolute(String(url));
    return parsed ? parsed.protocol.slice(0, -1) : 'relative';
  }

  /**
   * Parsed href of an absolute http(s) URL, credentials removed. A root path
   * ('/api/...') is resolved against an http(s) base and must stay on the
   * base's origin. Anything else returns ''.
   */
  function safeHttpUrl(url, base) {
    if (typeof url !== 'string') return '';
    var parsed = parseAbsolute(url);
    if (!parsed) {
      var value = url.trim();
      var baseUrl = parseAbsolute(typeof base === 'string' ? base : '');
      if (!isHttpProtocol(baseUrl) || value.charAt(0) !== '/' ||
          value.charAt(1) === '/' || value.charAt(1) === '\\') {
        return '';
      }
      try {
        parsed = new URL(value, baseUrl.origin);
      } catch (_) {
        return '';
      }
      if (parsed.origin !== baseUrl.origin) return '';
    }
    return isHttpProtocol(parsed) ? stripCredentials(parsed).href : '';
  }

  function isHttpUrl(url) {
    return safeHttpUrl(url) !== '';
  }

  /** Parsed href for a link: http(s) or mailto, else ''. */
  function safeLinkHref(url) {
    var http = safeHttpUrl(url);
    if (http) return http;
    var parsed = parseAbsolute(url);
    return parsed && parsed.protocol === 'mailto:' ? parsed.href : '';
  }

  function isSafeLinkUrl(url) {
    return safeLinkHref(url) !== '';
  }

  // A relative app path must not lead anywhere else once percent-decoded:
  // no scheme, no '//' or '/\\' start, no backslash, no '..' segment, no
  // control characters, and nothing that could leave an attribute value.
  var UNSAFE_RELATIVE = /^[\\/]{2}|\\|\.\.|[\u0000-\u001f\u007f]|^[a-z][a-z0-9+.-]*:/i;
  var UNSAFE_RAW_CHARS = /[\u0020"'<>`]/;

  function isPlainAppPath(value) {
    if (UNSAFE_RAW_CHARS.test(value)) return false;
    var layer = value;
    for (var i = 0; i < 4; i += 1) {
      if (UNSAFE_RELATIVE.test(layer)) return false;
      var next;
      try {
        next = decodeURIComponent(layer);
      } catch (_) {
        return false;
      }
      if (next === layer) return true;
      layer = next;
    }
    return false;
  }

  /**
   * A link that may also point at another app page: http(s) and mailto as
   * parsed hrefs, or a plain relative app path returned unchanged (see
   * isPlainAppPath, checked at every percent-decoding layer). Else ''.
   */
  function safeAppOrLinkHref(url) {
    var link = safeLinkHref(url);
    if (link) return link;
    if (typeof url !== 'string') return '';
    var value = url.trim();
    if (!value || schemeOf(value) !== 'relative') return '';
    return isPlainAppPath(value) ? value : '';
  }

  /**
   * Doc Studio preview link: the app's own doc-studio page (relative, no
   * traversal) returned unchanged, or a URL on the configured API origin
   * returned as its parsed href. Else ''.
   */
  function safeDocStudioUrl(url, apiBase) {
    if (typeof url !== 'string') return '';
    var value = url.trim();
    if (DOC_STUDIO_PAGE.test(value) && value.indexOf('..') === -1) return value;
    var api = parseAbsolute(typeof apiBase === 'string' ? apiBase : '');
    var parsed = parseAbsolute(value);
    if (!isHttpProtocol(api) || !isHttpProtocol(parsed) || parsed.origin !== api.origin) return '';
    return stripCredentials(parsed).href;
  }

  var moduleApi = {
    schemeOf: schemeOf,
    isHttpUrl: isHttpUrl,
    safeHttpUrl: safeHttpUrl,
    safeLinkHref: safeLinkHref,
    isSafeLinkUrl: isSafeLinkUrl,
    safeAppOrLinkHref: safeAppOrLinkHref,
    safeDocStudioUrl: safeDocStudioUrl
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaSafeUrl = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);

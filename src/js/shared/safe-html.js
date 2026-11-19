/**
 * safe-html.js
 * Sanitizes HTML that came from somewhere other than app code before it goes
 * into innerHTML: converted DOCX (mammoth), model markdown (marked), and the
 * chat formatter's output. With webSecurity:false a script, handler or
 * javascript: link in that HTML runs with the app's origin and can read the
 * login token.
 *
 * Allowlist based, one profile per use:
 *  - docx: plain document elements. Ids get a 'docx-' prefix (and '#' links
 *    follow) so DOCX bookmarks cannot clobber app element ids.
 *  - markdown: what the hardened marked instance below emits for model or
 *    backend text (renderMarkdown). Ids are dropped, no images.
 *  - chat: the chat formatter's own markup plus the bare formatting tags a
 *    model may use (the formatter strips their attributes first). Citation
 *    data-* attributes are kept only on links and buttons, which the model
 *    cannot create.
 * Links keep http(s), mailto and in-page '#' targets; images keep http(s) or
 * raster data: images. URLs are written back as LanaSafeUrl's parsed href,
 * never the raw attribute. Parsing happens in an inert <template>, so
 * nothing loads or runs while the markup is cleaned.
 *
 * Classic script (window.LanaSafeHtml). Reads window.LanaSafeUrl
 * (js/shared/safe-url.js) when it runs; without it every URL is dropped.
 */
(function (global) {
  'use strict';

  var NODE_SAFE_URL = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./safe-url.js')
    : null;

  function safeUrl() {
    return NODE_SAFE_URL || (global && global.LanaSafeUrl) || null;
  }

  function set(list) {
    var out = {};
    list.split(' ').forEach(function (name) { out[name] = 1; });
    return out;
  }

  var DOCUMENT_TAGS = 'A ABBR B BLOCKQUOTE BR CAPTION CODE COL COLGROUP DD DEL DIV DL DT EM FIGCAPTION FIGURE ' +
    'H1 H2 H3 H4 H5 H6 HR I IMG INS LI OL P PRE S SMALL SPAN STRONG SUB SUP TABLE TBODY TD TFOOT TH THEAD TR U UL';

  var PROFILES = {
    docx: {
      tags: set(DOCUMENT_TAGS),
      attrs: set('alt class colspan href id rowspan src title'),
      idPrefix: 'docx-'
    },
    markdown: {
      tags: set(DOCUMENT_TAGS.replace(' IMG ', ' ') + ' DETAILS SUMMARY KBD'),
      attrs: set('align class colspan href rel rowspan start target title'),
      idPrefix: null
    },
    chat: {
      tags: set('A B BLOCKQUOTE BR BUTTON CODE DETAILS DIV EM H1 H2 H3 H4 H5 H6 HR I KBD LI OL P PRE ' +
        'SPAN STRONG SUB SUMMARY SUP TABLE TBODY TD TH THEAD TR U UL'),
      attrs: set('class data-citation-num data-document-id data-filename data-page href rel target title'),
      // Only the formatter's citation links and buttons carry data-*.
      onlyOn: {
        'data-citation-num': set('A BUTTON'),
        'data-document-id': set('A BUTTON'),
        'data-filename': set('A BUTTON'),
        'data-page': set('A BUTTON')
      },
      idPrefix: null,
      appLinks: true
    }
  };

  var RASTER_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]*$/i;

  function prefixedId(value, prefix) {
    var v = String(value || '').trim();
    if (!v) return '';
    return v.indexOf(prefix) === 0 ? v : prefix + v;
  }

  /** Value to write back for href, or '' to drop it. */
  function safeHref(value, profile) {
    var v = String(value || '').trim();
    if (v.charAt(0) === '#' && profile.idPrefix) {
      return v.length === 1 ? '#' : '#' + prefixedId(v.slice(1), profile.idPrefix);
    }
    var urls = safeUrl();
    if (!urls) return '';
    // chat: also plain app paths and #anchors, the same rule as AI text
    // blocks; docx and markdown: http(s), mailto and #anchors only.
    if (profile.appLinks) return urls.safeAppOrLinkHref(v);
    if (v.charAt(0) === '#') return urls.safeAppOrLinkHref(v);
    return urls.safeLinkHref(v);
  }

  /** Value to write back for img src, or '' to drop it. */
  function safeSrc(value) {
    var v = String(value || '').trim().replace(/\s+/g, '');
    if (RASTER_DATA_IMAGE.test(v)) return v;
    var urls = safeUrl();
    return urls ? urls.safeHttpUrl(String(value || '')) : '';
  }

  /** Cleaned value for an allowed attribute, or '' to drop it. */
  function attributeValue(profile, tagName, name, value) {
    if (name === 'href') return safeHref(value, profile);
    if (name === 'src') return tagName === 'IMG' ? safeSrc(value) : '';
    if (name === 'id') return profile.idPrefix ? prefixedId(value, profile.idPrefix) : '';
    if (name === 'target') return value === '_blank' ? value : '';
    return value;
  }

  function cleanNode(node, profile) {
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function (child) {
      if (child.nodeType === 3) return; // text
      if (child.nodeType !== 1) { child.parentNode.removeChild(child); return; }
      var tagName = child.tagName.toUpperCase();
      if (!profile.tags[tagName]) {
        child.parentNode.removeChild(child);
        return;
      }
      Array.prototype.slice.call(child.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        var allowed = profile.attrs[name] && !(profile.onlyOn && profile.onlyOn[name] && !profile.onlyOn[name][tagName]);
        var value = allowed ? attributeValue(profile, tagName, name, attr.value) : '';
        if (value) child.setAttribute(attr.name, value);
        else child.removeAttribute(attr.name);
      });
      cleanNode(child, profile);
    });
  }

  /**
   * @param {string} html
   * @param {Document} [doc] - defaults to the page document
   * @param {'docx'|'markdown'|'chat'} [profileName] - defaults to 'docx'
   * @returns {string} sanitized HTML
   */
  function sanitize(html, doc, profileName) {
    if (!html) return '';
    var profile = PROFILES[profileName] || PROFILES.docx;
    var d = doc || global.document;
    var template = d.createElement('template');
    template.innerHTML = String(html);
    cleanNode(template.content, profile);
    var out = d.createElement('div');
    out.appendChild(template.content);
    return out.innerHTML;
  }

  function escapeText(text) {
    return String(text)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  // One hardened marked instance (it replaces the old copy in lex.utils.js):
  // raw HTML renders as escaped text (so "<Client Name>" stays visible),
  // links keep http(s) and mailto only, open in a new tab (target=_blank, so
  // the main process sends them to the system browser), and images render
  // as their alt text (no remote fetch, no tracking pixel).
  // breaks: true (single newlines as <br>) is a per-call option for the
  // callers whose pages turned it on for marked before (insights module
  // execution and reporting); everyone else keeps marked's default.
  var hardenedMarked = {};
  var hardenedFrom = null;

  function getHardenedMarked(breaks) {
    var lib = global && global.marked;
    if (!lib || typeof lib.Marked !== 'function') return null;
    if (hardenedFrom !== lib) {
      hardenedFrom = lib;
      hardenedMarked = {};
    }
    var key = breaks ? 'breaks' : 'plain';
    if (hardenedMarked[key]) return hardenedMarked[key];
    hardenedMarked[key] = new lib.Marked({
      breaks: Boolean(breaks),
      gfm: true,
      renderer: {
        html: function (token) {
          return escapeText(token && token.text ? token.text : '');
        },
        link: function (token) {
          var label = this.parser.parseInline((token && token.tokens) || []);
          var urls = safeUrl();
          var href = urls ? urls.safeLinkHref(String((token && token.href) || '')) : '';
          if (!href) return label;
          var title = token && token.title ? ' title="' + escapeText(token.title) + '"' : '';
          return '<a href="' + escapeText(href) + '"' + title + ' target="_blank" rel="noopener">' + label + '</a>';
        },
        image: function (token) {
          return escapeText((token && (token.text || token.title)) || '');
        }
      }
    });
    return hardenedMarked[key];
  }

  /**
   * THE markdown renderer for model or backend text: the hardened marked
   * instance, then the markdown allowlist. Without marked the text is
   * escaped (with line breaks for block rendering).
   *
   * @param {string} text
   * @param {{ inline?: boolean, unwrapParagraph?: boolean, breaks?: boolean, doc?: Document }} [opts]
   */
  function renderMarkdown(text, opts) {
    var o = opts || {};
    var src = text === null || text === undefined ? '' : String(text);
    if (!src) return '';
    var parser = getHardenedMarked(o.breaks);
    var html = null;
    if (parser) {
      try {
        html = String(o.inline ? parser.parseInline(src) : parser.parse(src));
      } catch (_) {
        html = null;
      }
    }
    if (html === null) {
      html = o.inline ? escapeText(src) : escapeText(src).split('\n').join('<br>');
    } else if (o.unwrapParagraph) {
      html = html.trim();
      if (html.indexOf('<p>') === 0 && html.lastIndexOf('</p>') === html.length - 4 && html.split('<p>').length === 2) {
        html = html.slice(3, -4);
      }
    }
    return sanitize(html, o.doc, 'markdown');
  }

  var moduleApi = { sanitize: sanitize, renderMarkdown: renderMarkdown, escapeText: escapeText };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaSafeHtml = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);

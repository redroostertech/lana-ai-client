/*
 * LANA File Editor - writer-tools.js
 *
 * Pure document helpers for Writer stats, outline, and export payloads.
 */
(function (global) {
  'use strict';

  function toText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function decodeEntity(entity) {
    var map = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
      ndash: '-',
      mdash: '-',
      lsquo: "'",
      rsquo: "'",
      ldquo: '"',
      rdquo: '"'
    };
    if (map[entity]) return map[entity];
    if (entity.charAt(0) === '#') {
      var isHex = entity.charAt(1).toLowerCase() === 'x';
      var raw = isHex ? entity.slice(2) : entity.slice(1);
      var code = parseInt(raw, isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 1114111) {
        if (String.fromCodePoint) return String.fromCodePoint(code);
        return String.fromCharCode(code);
      }
    }
    return '&' + entity + ';';
  }

  function decodeEntities(text) {
    var input = toText(text);
    var out = '';
    var entity = '';
    var inEntity = false;
    for (var i = 0; i < input.length; i += 1) {
      var ch = input.charAt(i);
      if (ch === '&') {
        inEntity = true;
        entity = '';
        continue;
      }
      if (inEntity) {
        if (ch === ';') {
          out += decodeEntity(entity);
          inEntity = false;
          entity = '';
        } else if (entity.length < 12) {
          entity += ch;
        } else {
          out += '&' + entity + ch;
          inEntity = false;
          entity = '';
        }
        continue;
      }
      out += ch;
    }
    if (inEntity) out += '&' + entity;
    return out;
  }

  function tagNameAt(input, index) {
    var i = index + 1;
    if (input.charAt(i) === '/') i += 1;
    var name = '';
    while (i < input.length) {
      var code = input.charCodeAt(i);
      var isNameChar = code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || input.charAt(i) === ':' || input.charAt(i) === '-';
      if (!isNameChar) break;
      name += input.charAt(i).toLowerCase();
      i += 1;
    }
    return name;
  }

  function appendBreak(out) {
    if (!out.length) return out;
    var last = out.charAt(out.length - 1);
    return last === '\n' ? out : out + '\n';
  }

  function appendSpace(out) {
    if (!out.length) return out;
    var last = out.charAt(out.length - 1);
    return last === ' ' || last === '\n' || last === '\t' ? out : out + ' ';
  }

  function isHeadingTag(name) {
    return name === 'h1' || name === 'h2' || name === 'h3' || name === 'h4' || name === 'h5' || name === 'h6';
  }

  function isBlockBreakTag(name) {
    return name === 'p' ||
      name === 'div' ||
      name === 'li' ||
      name === 'br' ||
      name === 'tr' ||
      name === 'blockquote' ||
      name === 'section' ||
      name === 'article' ||
      name === 'header' ||
      name === 'footer' ||
      name === 'pre' ||
      isHeadingTag(name);
  }

  function isCellBreakTag(name) {
    return name === 'td' || name === 'th';
  }

  function isVoidTag(name) {
    return name === 'br' || name === 'hr' || name === 'img' || name === 'input' || name === 'meta' || name === 'link';
  }

  function findTagEnd(input, index) {
    var quote = '';
    for (var i = index + 1; i < input.length; i += 1) {
      var ch = input.charAt(i);
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        return i;
      }
    }
    return -1;
  }

  function attributeValue(tagText, attrName) {
    var lower = tagText.toLowerCase();
    var needle = attrName.toLowerCase();
    var index = 0;
    while (index < lower.length) {
      var found = lower.indexOf(needle, index);
      if (found === -1) return '';
      var before = found === 0 ? ' ' : lower.charAt(found - 1);
      var after = lower.charAt(found + needle.length);
      if ((before === ' ' || before === '\t' || before === '\n' || before === '\r' || before === '<') &&
          (after === '=' || after === ' ' || after === '\t' || after === '\n' || after === '\r')) {
        var i = found + needle.length;
        while (i < tagText.length && /\s/.test(tagText.charAt(i))) i += 1;
        if (tagText.charAt(i) !== '=') return '';
        i += 1;
        while (i < tagText.length && /\s/.test(tagText.charAt(i))) i += 1;
        var quote = tagText.charAt(i);
        var value = '';
        if (quote === '"' || quote === "'") {
          i += 1;
          while (i < tagText.length && tagText.charAt(i) !== quote) {
            value += tagText.charAt(i);
            i += 1;
          }
        } else {
          while (i < tagText.length && !/\s|>/.test(tagText.charAt(i))) {
            value += tagText.charAt(i);
            i += 1;
          }
        }
        return decodeEntities(value);
      }
      index = found + needle.length;
    }
    return '';
  }

  function normalizePlainText(text) {
    return decodeEntities(text)
      .split('\n')
      .map(function (line) {
        return line.split('\r').join(' ').split('\t').join(' ').split(' ').filter(Boolean).join(' ');
      })
      .filter(function (line) { return line.trim() !== ''; })
      .join('\n');
  }

  function htmlToPlainText(html) {
    var input = toText(html);
    var out = '';
    var inTag = false;
    var skipping = '';

    for (var i = 0; i < input.length; i += 1) {
      if (input.slice(i, i + 4) === '<!--') {
        var commentEnd = input.indexOf('-->', i + 4);
        i = commentEnd === -1 ? input.length : commentEnd + 2;
        continue;
      }

      var ch = input.charAt(i);
      if (ch === '<') {
        var name = tagNameAt(input, i);
        var closing = input.charAt(i + 1) === '/';
        var tagEnd = findTagEnd(input, i);
        var tagText = tagEnd === -1 ? input.slice(i) : input.slice(i, tagEnd + 1);
        if (!closing && (name === 'script' || name === 'style')) skipping = name;
        if (closing && skipping === name) skipping = '';
        if (!skipping && isCellBreakTag(name)) {
          out = appendSpace(out);
        } else if (!skipping && (isBlockBreakTag(name) || name === 'hr') && (closing || !isVoidTag(name))) {
          out = appendBreak(out);
        } else if (!skipping && name === 'br') {
          out = appendBreak(out);
        }
        if (!skipping && !closing && name === 'img') {
          var alt = attributeValue(tagText, 'alt');
          if (alt) {
            out = appendSpace(out);
            out += alt;
            out = appendSpace(out);
          }
        }
        inTag = true;
        if (tagEnd !== -1) {
          i = tagEnd - 1;
          inTag = false;
        }
        continue;
      }
      if (ch === '>') {
        inTag = false;
        continue;
      }
      if (!inTag && !skipping) out += ch;
    }

    return normalizePlainText(out);
  }

  function isWhitespace(ch) {
    return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v';
  }

  function isWordChar(ch) {
    if (!ch) return false;
    var code = ch.charCodeAt(0);
    return code >= 65 && code <= 90 ||
      code >= 97 && code <= 122 ||
      code >= 48 && code <= 57 ||
      code > 127 && !isWhitespace(ch) && !(
        code >= 8192 && code <= 8303 ||
        code >= 12288 && code <= 12351 ||
        code === 183
      );
  }

  function wordsFromText(text) {
    var input = toText(text);
    var words = [];
    var current = '';

    for (var i = 0; i < input.length; i += 1) {
      var ch = input.charAt(i);
      if (isWordChar(ch)) {
        current += ch;
        continue;
      }
      if ((ch === "'" || ch === '-') && current && isWordChar(input.charAt(i + 1))) {
        current += ch;
        continue;
      }
      if (ch === '.' && /[0-9]/.test(current) && /[0-9]/.test(input.charAt(i + 1))) {
        current += ch;
        continue;
      }
      if (current) {
        words.push(current);
        current = '';
      }
    }

    if (current) words.push(current);
    return words;
  }

  function charactersNoSpaces(text) {
    var input = toText(text);
    var count = 0;
    for (var i = 0; i < input.length; i += 1) {
      var ch = input.charAt(i);
      if (ch !== ' ' && ch !== '\n' && ch !== '\t' && ch !== '\r') count += 1;
    }
    return count;
  }

  function estimateTokens(text) {
    var input = toText(text).trim();
    if (!input) return 0;
    return Math.max(1, Math.ceil(input.length / 4));
  }

  function getDocumentStats(html) {
    var plainText = htmlToPlainText(html);
    if (!plainText) {
      return {
        words: 0,
        characters: 0,
        charactersNoSpaces: 0,
        tokens: 0,
        paragraphs: 0,
        estimatedPages: 0,
        readingMinutes: 0,
        plainText: ''
      };
    }
    var paragraphs = plainText.split('\n').filter(function (line) { return line.trim() !== ''; }).length;
    var words = wordsFromText(plainText).length;
    return {
      words: words,
      characters: plainText.length,
      charactersNoSpaces: charactersNoSpaces(plainText),
      tokens: estimateTokens(plainText),
      paragraphs: paragraphs,
      estimatedPages: Math.max(1, Math.ceil(words / 500)),
      readingMinutes: Math.max(1, Math.ceil(words / 220)),
      plainText: plainText
    };
  }

  function slugify(text) {
    var input = htmlToPlainText(text).toLowerCase();
    var out = '';
    var lastDash = false;
    for (var i = 0; i < input.length; i += 1) {
      var code = input.charCodeAt(i);
      var isAlpha = code >= 97 && code <= 122;
      var isNum = code >= 48 && code <= 57;
      if (isAlpha || isNum) {
        out += input.charAt(i);
        lastDash = false;
      } else if (!lastDash && out) {
        out += '-';
        lastDash = true;
      }
    }
    if (out.charAt(out.length - 1) === '-') out = out.slice(0, -1);
    return out || 'section';
  }

  function uniqueSlug(base, used) {
    var slug = base;
    var n = 2;
    while (used[slug]) {
      slug = base + '-' + n;
      n += 1;
    }
    used[slug] = true;
    return slug;
  }

  function buildOutline(html) {
    var input = toText(html);
    var lower = input.toLowerCase();
    var outline = [];
    var used = {};
    var index = 0;

    while (index < lower.length) {
      var next = -1;
      var tag = '';
      var level = 0;
      for (var h = 1; h <= 6; h += 1) {
        var candidate = lower.indexOf('<h' + h, index);
        if (candidate !== -1 && (next === -1 || candidate < next)) {
          next = candidate;
          tag = 'h' + h;
          level = h;
        }
      }
      if (next === -1) break;
      var openEnd = lower.indexOf('>', next);
      var closeNeedle = '</' + tag + '>';
      var close = openEnd === -1 ? -1 : lower.indexOf(closeNeedle, openEnd);
      if (openEnd === -1 || close === -1) break;
      var title = htmlToPlainText(input.slice(openEnd + 1, close));
      if (title) {
        outline.push({
          id: uniqueSlug(slugify(title), used),
          level: level,
          title: title,
          sourceIndex: next
        });
      }
      index = close + closeNeedle.length;
    }
    return outline;
  }

  function safeFilename(title, extension) {
    var base = slugify(title || 'untitled-document');
    if (base.length > 80) base = base.slice(0, 80);
    return base + '.' + extension;
  }

  function buildExportPayload(file, options) {
    var doc = file || {};
    var opts = options || {};
    var format = opts.format === 'html' ? 'html' : 'txt';
    var html = toText(doc.content);
    var plainText = htmlToPlainText(html);
    return {
      id: toText(doc.id),
      kind: 'doc',
      title: toText(doc.title || 'Untitled Document'),
      filename: safeFilename(doc.title || 'Untitled Document', format),
      mimeType: format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8',
      content: format === 'html' ? html : plainText,
      plainText: plainText,
      stats: getDocumentStats(html),
      outline: buildOutline(html),
      exportedAt: opts.exportedAt || new Date().toISOString()
    };
  }

  var api = {
    htmlToPlainText: htmlToPlainText,
    getDocumentStats: getDocumentStats,
    buildOutline: buildOutline,
    safeFilename: safeFilename,
    buildExportPayload: buildExportPayload,
    // Backward-compatible aliases for any in-progress controller work.
    plainTextFromHtml: htmlToPlainText,
    extractOutline: buildOutline,
    metrics: getDocumentStats
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaFileEditorWriterTools = api;
})(typeof window !== 'undefined' ? window : globalThis);

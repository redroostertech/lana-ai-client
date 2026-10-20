/**
 * Run book draft helpers: pure view-state logic for the Run Books admin page.
 *
 * A RUN BOOK is an organization's own processes packaged so LANA can retrieve
 * them as evidence across every matter in the organization. It is not a file
 * share: the matter document store already holds "whatever the user uploaded".
 * A run book is org-wide, curated, and an assertion that THIS IS HOW WE OPERATE,
 * which is why the review screen shows everything, including what was dropped.
 *
 * The backend (lana-ai-chef `src/services/run-books/`) owns every decision here.
 * This module only shapes what the server said into something the page renders.
 * Nothing in it invents a title, hides a refusal, or softens a reason.
 *
 * No regex, per the Lex rulebook (section 11). String work uses indexOf/slice.
 */
(function (root, factory) {
  'use strict';

  var api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.RunBookDraft = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // ── Refusal sentences the server does NOT serve ─────────────────────
  //
  // GET /formats returns the refused-format reasons verbatim, and those are
  // used as-is. These four are produced inside classifyUpload() and never
  // reach the client until a file has already been uploaded, so they are
  // mirrored here to refuse before the upload rather than after it.
  // They must stay character-identical to
  // lana-ai-chef/src/services/run-books/run-book-format-policy.js.

  var NO_EXTENSION_REASON =
    'The file has no extension, so there is no way to tell what it is.';

  var SCANNED_PDF_REASON =
    'This PDF has no text layer, so it is a scan. We will not put text we guessed at into your run book. Provide the source document.';

  function unsupportedReason(extension, supportedExtensions) {
    return extension + ' is not a run book format. Supported: ' +
      supportedExtensions.join(', ') + '.';
  }

  function tooLargeReason(maxUploadBytes) {
    return 'The file is larger than ' + Math.round(maxUploadBytes / 1024 / 1024) +
      ' MB. A run book entry is a procedure, not an archive.';
  }

  // ── Small string helpers (no regex) ─────────────────────────────────

  function text(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function isSpace(character) {
    return character === ' ' || character === '\t' || character === '\n' ||
      character === '\r' || character === '\f' || character === '\u00a0';
  }

  /** Squash every run of whitespace to one space. Used on extracted text only. */
  function collapseSpaces(value) {
    var raw = text(value);
    var words = [];
    var current = '';

    for (var i = 0; i < raw.length; i += 1) {
      var character = raw.charAt(i);
      if (isSpace(character)) {
        if (current !== '') { words.push(current); current = ''; }
      } else {
        current += character;
      }
    }
    if (current !== '') { words.push(current); }

    return words.join(' ');
  }

  function repeatHash(count) {
    var out = '';
    for (var i = 0; i < count; i += 1) { out += '#'; }
    return out;
  }

  /**
   * The lowercased extension including its dot, or '' when there is none.
   * Mirrors extensionOf() in run-book-format-policy.js so the client and the
   * server disagree about nothing.
   */
  function extensionOf(filename) {
    var name = text(filename).trim().toLowerCase();
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  }

  // ── Format policy, built from GET /formats ───────────────────────────

  /**
   * Index the /formats response for lookups by extension.
   *
   * Every reason and note in the result is the server's own sentence. The page
   * shows them verbatim, because "unsupported file type" tells an administrator
   * nothing and they will try the same file again.
   *
   * @param {Object} formats `{ supported[], refused[], extensions[], limits{} }`
   */
  function buildFormatIndex(formats) {
    var source = formats || {};
    var supported = Array.isArray(source.supported) ? source.supported : [];
    var refused = Array.isArray(source.refused) ? source.refused : [];
    var extensions = Array.isArray(source.extensions) ? source.extensions : [];
    var limits = source.limits || {};

    var acceptedByExtension = {};
    for (var i = 0; i < supported.length; i += 1) {
      var spec = supported[i] || {};
      var specExtensions = Array.isArray(spec.extensions) ? spec.extensions : [];
      for (var j = 0; j < specExtensions.length; j += 1) {
        acceptedByExtension[specExtensions[j]] = spec;
      }
    }

    var refusalByExtension = {};
    for (var k = 0; k < refused.length; k += 1) {
      var group = refused[k] || {};
      var groupExtensions = Array.isArray(group.extensions) ? group.extensions : [];
      for (var m = 0; m < groupExtensions.length; m += 1) {
        refusalByExtension[groupExtensions[m]] = group.reason;
      }
    }

    return {
      supported: supported,
      refused: refused,
      extensions: extensions,
      limits: limits,
      acceptedByExtension: acceptedByExtension,
      refusalByExtension: refusalByExtension
    };
  }

  /**
   * Decide whether a chosen file may contribute to a run book.
   *
   * Returns a verdict rather than throwing, because an administrator picking
   * twelve files wants all twelve answers at once, not the first refusal.
   *
   * `hasTextLayer` is only known after extraction, so pass it on a second call:
   * left undefined, the scanned-PDF check is skipped.
   *
   * @param {Object} file  `{ filename, sizeBytes, hasTextLayer }`
   * @param {Object} index from buildFormatIndex()
   */
  function classifyFile(file, index) {
    var subject = file || {};
    var formatIndex = index || buildFormatIndex(null);
    var extension = extensionOf(subject.filename);

    if (extension === '') {
      return { accepted: false, reason: NO_EXTENSION_REASON };
    }

    var refusal = formatIndex.refusalByExtension[extension];
    if (refusal) {
      return { accepted: false, reason: refusal };
    }

    var spec = formatIndex.acceptedByExtension[extension];
    if (!spec) {
      return {
        accepted: false,
        reason: unsupportedReason(extension, formatIndex.extensions)
      };
    }

    var maxBytes = Number(formatIndex.limits.max_upload_bytes);
    var size = Number(subject.sizeBytes);
    if (Number.isFinite(maxBytes) && Number.isFinite(size) && size > maxBytes) {
      return { accepted: false, reason: tooLargeReason(maxBytes) };
    }

    // A scanned PDF is the one case where the extension is right and the file
    // is still wrong. We will not put text we guessed at into a run book.
    if (spec.kind === 'pdf' && subject.hasTextLayer === false) {
      return { accepted: false, reason: SCANNED_PDF_REASON };
    }

    return {
      accepted: true,
      kind: spec.kind,
      label: spec.label,
      structure: spec.structure,
      splitsIntoEntries: spec.splits_into_entries === true,
      note: spec.note
    };
  }

  /** Every extension a file picker should offer, as an `accept` attribute value. */
  function acceptAttribute(index) {
    var formatIndex = index || buildFormatIndex(null);
    return formatIndex.extensions.join(',');
  }

  // ── DOCX text, with the author's headings kept ───────────────────────

  var HEADING_LEVELS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
  var BLOCK_TAGS = {
    P: true, LI: true, BLOCKQUOTE: true, PRE: true, TD: true, TH: true, DD: true, DT: true
  };

  function collectBlocks(node, lines) {
    var children = node.childNodes || [];

    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (!child || child.nodeType !== 1) { continue; }

      var tag = String(child.tagName || '').toUpperCase();
      var level = HEADING_LEVELS[tag];

      if (level) {
        var heading = collapseSpaces(child.textContent);
        if (heading !== '') {
          lines.push('');
          lines.push(repeatHash(level) + ' ' + heading);
          lines.push('');
        }
        continue;
      }

      if (BLOCK_TAGS[tag]) {
        var body = collapseSpaces(child.textContent);
        if (body !== '') { lines.push(body); }
        continue;
      }

      collectBlocks(child, lines);
    }
  }

  /**
   * Turn mammoth's DOCX HTML into the text the backend segments.
   *
   * A .docx carries heading STYLES, and the backend splits a document at
   * markdown headings, so the styles have to survive extraction as `#` lines or
   * the whole file collapses into one entry. This reads the tags mammoth
   * produced from a format we control the parse of; it decides nothing about
   * what the author meant, which is why the backend still marks a docx split as
   * needing a closer look.
   *
   * @param {string} html      mammoth.convertToHtml output
   * @param {DOMParser} parser injected in tests; defaults to the browser's
   */
  function htmlToRunBookText(html, parser) {
    var markup = text(html);
    if (markup === '') { return ''; }

    var domParser = parser ||
      (typeof DOMParser !== 'undefined' ? new DOMParser() : null);
    if (!domParser) { return ''; }

    var parsed = domParser.parseFromString(markup, 'text/html');
    var body = parsed && parsed.body;
    if (!body) { return ''; }

    var lines = [];
    collectBlocks(body, lines);

    return lines.join('\n').trim();
  }

  // ── Draft payloads ───────────────────────────────────────────────────

  /** The body for POST /drafts/propose. */
  function buildProposePayload(documents, scope) {
    var list = Array.isArray(documents) ? documents : [];
    var shaped = [];

    for (var i = 0; i < list.length; i += 1) {
      var document = list[i] || {};
      shaped.push({
        filename: document.filename,
        text: text(document.text),
        size_bytes: document.size_bytes,
        has_text_layer: document.has_text_layer
      });
    }

    return { documents: shaped, scope: normalizeScope(scope) };
  }

  /** The body for POST /drafts/check. */
  function buildCheckPayload(entries, scope) {
    return {
      entries: Array.isArray(entries) ? entries : [],
      scope: normalizeScope(scope)
    };
  }

  function normalizeScope(scope) {
    var source = scope || {};
    return {
      type: text(source.type).trim(),
      values: Array.isArray(source.values) ? source.values : []
    };
  }

  /** Every proposed entry across every source file, in the order proposed. */
  function flattenEntries(proposals) {
    var list = Array.isArray(proposals) ? proposals : [];
    var entries = [];

    for (var i = 0; i < list.length; i += 1) {
      var proposalEntries = (list[i] && list[i].entries) || [];
      for (var j = 0; j < proposalEntries.length; j += 1) {
        entries.push(proposalEntries[j]);
      }
    }

    return entries;
  }

  // ── Editing an entry ─────────────────────────────────────────────────

  /**
   * What a title edit means.
   *
   * A title is never invented. When the backend could not read one it hands
   * back the filename and sets `needs_title`, and the entry stays a problem
   * until an administrator writes a real one. Typing a title that is not the
   * filename is that person saying so, which is what `title_confirmed` records
   * for /drafts/check.
   */
  function applyTitleEdit(entry, nextTitle) {
    var subject = entry || {};
    var trimmed = text(nextTitle).trim();
    var filename = text(subject.source_reference);

    return {
      title: trimmed,
      title_confirmed: trimmed !== '' && trimmed !== filename
    };
  }

  /**
   * Which declared scope values an entry may carry, as lex-select options.
   * Values the run book does not declare are not offered, because the backend
   * refuses them.
   */
  function scopeOptions(scope) {
    var values = normalizeScope(scope).values;
    var options = [];

    for (var i = 0; i < values.length; i += 1) {
      options.push({ value: values[i], label: values[i] });
    }

    return options;
  }

  /**
   * The per-entry markers the review screen shows next to a row.
   *
   * The server's /drafts/check list stays the authority and is rendered whole.
   * These are the same three rules read off the entry we already hold, so a row
   * can say what is wrong with it without waiting for a round trip.
   */
  function entryIssues(entry, scope) {
    var subject = entry || {};
    var declared = normalizeScope(scope).values;
    var issues = [];

    var title = text(subject.title).trim();
    if (title === '') {
      issues.push({
        code: 'missing_title',
        label: 'Needs a title',
        detail: 'An entry nobody named cannot be cited.'
      });
    } else if (subject.needs_title === true && subject.title_confirmed !== true) {
      issues.push({
        code: 'filename_title',
        label: 'Needs a title',
        detail: 'This is the filename. Give it one that says what this entry covers.'
      });
    }

    var values = Array.isArray(subject.scope_values) ? subject.scope_values : [];
    if (values.length === 0) {
      issues.push({
        code: 'unscoped',
        label: 'Not scoped',
        detail: 'Say which ' + (normalizeScope(scope).type || 'scope') + ' this applies to.'
      });
    } else {
      var unknown = [];
      for (var i = 0; i < values.length; i += 1) {
        if (declared.indexOf(values[i]) === -1) { unknown.push(values[i]); }
      }
      if (unknown.length > 0) {
        issues.push({
          code: 'undeclared_scope',
          label: 'Scope not declared',
          detail: 'This run book does not declare ' + unknown.join(', ') + '.'
        });
      }
    }

    return issues;
  }

  // ── Labels for what the backend reported ─────────────────────────────

  /** How much structure the format let the backend trust. */
  function structureLabel(structure) {
    if (structure === 'authored') { return 'Boundaries the author marked'; }
    if (structure === 'declared') { return 'Boundaries proposed from heading styles'; }
    if (structure === 'none') { return 'No boundaries to read'; }
    return 'Structure unknown';
  }

  /** Where one entry came from inside its source file. */
  function proposedFromLabel(proposedFrom) {
    var value = text(proposedFrom);
    if (value === 'whole_document') { return 'The whole file'; }

    var prefix = 'heading_depth_';
    if (value.indexOf(prefix) === 0) {
      return 'Heading level ' + value.slice(prefix.length);
    }

    return value === '' ? 'Source not recorded' : value;
  }

  /**
   * Why a section was dropped. The backend's own `detail` sentence is shown
   * underneath this label whenever it sent one; nothing is dropped silently.
   */
  function droppedReasonLabel(reason) {
    if (reason === 'empty') { return 'Nothing was under this heading'; }
    if (reason === 'too_short') { return 'Too short to stand on its own'; }
    if (reason === 'too_long') { return 'Too long to be one entry'; }
    return 'Not usable as an entry';
  }

  return {
    NO_EXTENSION_REASON: NO_EXTENSION_REASON,
    SCANNED_PDF_REASON: SCANNED_PDF_REASON,
    unsupportedReason: unsupportedReason,
    tooLargeReason: tooLargeReason,
    collapseSpaces: collapseSpaces,
    extensionOf: extensionOf,
    buildFormatIndex: buildFormatIndex,
    classifyFile: classifyFile,
    acceptAttribute: acceptAttribute,
    htmlToRunBookText: htmlToRunBookText,
    buildProposePayload: buildProposePayload,
    buildCheckPayload: buildCheckPayload,
    normalizeScope: normalizeScope,
    flattenEntries: flattenEntries,
    applyTitleEdit: applyTitleEdit,
    scopeOptions: scopeOptions,
    entryIssues: entryIssues,
    structureLabel: structureLabel,
    proposedFromLabel: proposedFromLabel,
    droppedReasonLabel: droppedReasonLabel
  };
});

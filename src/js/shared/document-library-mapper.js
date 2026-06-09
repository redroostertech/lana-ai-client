/*
 * document-library-mapper.js
 *
 * Pure, side-effect-free mappers for the consolidated document Library view-model.
 * This is the single source of truth for library row shaping. Both
 * src/doc-studio/app.js (libraryItems) and the Brainchild surface
 * (src/brainchild/app.js) consume normalizeLibraryItems() here, so identical
 * documents never drift between the two surfaces.
 *
 * Contract — every function here is pure: no fetch, no DOM, no localStorage.
 *   - fileExtension(filename)            -> uppercase extension or ''
 *   - humanFileType(item)               -> display label (e.g. 'PDF', 'Document')
 *   - titleToFilename(title, ext)       -> slug-based filename fallback
 *   - normalizeStorageRow(doc, scope)   -> row view-model (_kind: 'storage')
 *   - normalizePresentationRow(p, scope)-> row view-model (_kind: 'deck')
 *   - normalizeBrainchildRow(note,scope)-> row view-model (_kind: 'brainchild')
 *   - normalizeLibraryItems(payload, scope) -> merged + de-duplicated row list
 *
 * Escaping is intentionally NOT done here — Lex tables escape cell content at
 * render time, so escaping in the mapper would double-encode.
 */
(function (global) {
  'use strict';

  function fileExtension(filename) {
    var clean = String(filename || '').split('?')[0];
    var index = clean.lastIndexOf('.');
    return index > -1 && index < clean.length - 1
      ? clean.slice(index + 1).toUpperCase()
      : '';
  }

  function titleCase(value) {
    return String(value || '')
      .split('_')
      .join(' ')
      .split(' ')
      .map(function (word) {
        if (!word) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  function humanFileType(item) {
    var source = item || {};
    var raw = source.file_type || source.content_type || source.document_type || source.format || '';
    if (raw) {
      var value = String(raw);
      if (value.indexOf('/') !== -1) {
        if (value.indexOf('pdf') !== -1) return 'PDF';
        if (value.indexOf('wordprocessingml') !== -1 || value.indexOf('msword') !== -1) return 'DOCX';
        if (value.indexOf('presentation') !== -1) return 'PPTX';
        if (value.indexOf('html') !== -1) return 'HTML';
        return String(value.split('/').pop()).toUpperCase();
      }
      return titleCase(value);
    }
    return fileExtension(source.filename || source.title) || 'Document';
  }

  function titleToFilename(title, ext) {
    var base = String(title || '')
      .toLowerCase()
      .split('')
      .map(function (ch) {
        var code = ch.charCodeAt(0);
        var isLower = code >= 97 && code <= 122;
        var isDigit = code >= 48 && code <= 57;
        return (isLower || isDigit) ? ch : '-';
      })
      .join('');
    // collapse runs of '-' and trim edges without regex
    var parts = base.split('-').filter(function (p) { return p.length; });
    var slug = parts.join('-') || 'untitled';
    var extension = ext || 'txt';
    return slug + '.' + extension;
  }

  function normalizeStorageRow(document, scope) {
    var doc = document || {};
    return {
      id: 'storage:' + doc.id,
      filename: doc.filename || doc.original_filename || doc.name || 'Untitled document',
      file_type: humanFileType(doc),
      matter: doc.matter_name || doc.client_matter || doc.matter_id || 'Unassigned',
      is_template: doc.is_template ? 'Yes' : 'No',
      created_at: doc.created_at || '',
      updated_at: doc.updated_at || doc.created_at || '',
      _kind: 'storage',
      _scope: scope || 'org',
      _fileId: doc.id,
      _matterId: doc.client_matter || doc.matter_id || '',
      _source: doc
    };
  }

  function presentationFilename(presentation) {
    var p = presentation || {};
    var documentModel = p.deck && p.deck.document;
    if (p.filename) return p.filename;
    if (documentModel && documentModel.file_name) return documentModel.file_name;
    if (documentModel && documentModel.metadata && documentModel.metadata.filename) {
      return documentModel.metadata.filename;
    }
    return titleToFilename(p.title || 'Untitled file', documentModel ? 'pdf' : 'html');
  }

  function presentationFileId(presentation) {
    var p = presentation || {};
    var meta = p.deck && p.deck.document && p.deck.document.metadata;
    return (meta && meta.file_id) || p.file_id || '';
  }

  function normalizePresentationRow(presentation, scope) {
    var p = presentation || {};
    var documentModel = p.deck && p.deck.document;
    var meta = (documentModel && documentModel.metadata) || {};
    return {
      id: 'deck:' + p.id,
      filename: presentationFilename(p),
      file_type: documentModel ? 'Doc Studio Draft' : 'Presentation',
      matter: meta.matter_name || meta.matter_id || p.matter_name || p.matter_id || 'Doc Studio',
      is_template: (p.is_template || (documentModel && documentModel.is_template)) ? 'Yes' : 'No',
      created_at: p.created_at || '',
      updated_at: p.updated_at || p.created_at || '',
      _kind: 'deck',
      _scope: scope || 'org',
      _presentationId: p.id,
      _source: p
    };
  }

  function normalizeBrainchildRow(note, scope) {
    var n = note || {};
    var path = n.path || n.vault_path || n.relativePath || '';
    var title = n.title || n.name || path || 'Untitled note';
    return {
      id: 'brainchild:' + (path || title),
      filename: title,
      file_type: 'Note',
      matter: 'Personal',
      is_template: 'No',
      created_at: n.created_at || n.created || '',
      updated_at: n.updated_at || n.modified || n.created_at || '',
      _kind: 'brainchild',
      _scope: scope || 'my',
      _vaultPath: path,
      _source: n
    };
  }

  /*
   * normalizeLibraryItems(payload, scope)
   *
   * payload: {
   *   documents:     [storage DTO, ...],   // /api/v1/storage/documents
   *   presentations: [presentation DTO],   // /api/v1/deck-studio/presentations
   *   notes:         [brainchild note DTO]  // loopback vault (Phase B)
   * }
   * scope: 'org' | 'my' — stamped on every row for downstream filtering/UX.
   *
   * Org rows (storage + presentations) de-duplicate by numeric file id.
   * Brainchild notes de-duplicate by vault path and never collide with the
   * numeric storage id set (different key space — see library spec pitfall).
   */
  function normalizeLibraryItems(payload, scope) {
    var data = payload || {};
    var resolvedScope = scope || 'org';
    var documents = Array.isArray(data.documents) ? data.documents : [];
    var presentations = Array.isArray(data.presentations) ? data.presentations : [];
    var notes = Array.isArray(data.notes) ? data.notes : [];

    var storageRows = documents.map(function (doc) {
      return normalizeStorageRow(doc, resolvedScope);
    });

    var seenFileIds = {};
    storageRows.forEach(function (row) {
      seenFileIds[String(row._fileId)] = true;
    });

    var presentationRows = presentations
      .filter(function (presentation) {
        var fileId = presentationFileId(presentation);
        return !fileId || !seenFileIds[String(fileId)];
      })
      .map(function (presentation) {
        return normalizePresentationRow(presentation, resolvedScope);
      });

    var seenPaths = {};
    var noteRows = notes
      .filter(function (note) {
        var path = (note && (note.path || note.vault_path || note.relativePath)) || '';
        var key = String(path);
        if (key && seenPaths[key]) return false;
        if (key) seenPaths[key] = true;
        return true;
      })
      .map(function (note) {
        return normalizeBrainchildRow(note, resolvedScope);
      });

    return storageRows.concat(presentationRows).concat(noteRows);
  }

  var api = {
    fileExtension: fileExtension,
    humanFileType: humanFileType,
    titleToFilename: titleToFilename,
    normalizeStorageRow: normalizeStorageRow,
    normalizePresentationRow: normalizePresentationRow,
    normalizeBrainchildRow: normalizeBrainchildRow,
    normalizeLibraryItems: normalizeLibraryItems
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.DocumentLibraryMapper = api;
  }
})(typeof window !== 'undefined' ? window : this);

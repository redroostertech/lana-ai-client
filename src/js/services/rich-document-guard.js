/**
 * Rich document guard for the File Editor's fallback surface.
 *
 * The File Editor has two ways to show a document: the LANA Editor embed,
 * which keeps tables, lists, headings and page breaks, and a plain
 * contenteditable page (the "draft shell") that only knows paragraphs. The
 * shell is what appears when the embed cannot mount or is turned off. For a
 * document that came from a real Word file that page is a flattened preview,
 * and typing into it would save that flattened text over the user's layout.
 *
 * This module decides, from the file record alone, whether a document is
 * rich (its source is a Word document or a server document with a source
 * file) and, given the surface state, whether the fallback must stay
 * read-only. It has no DOM and no globals so it can be tested directly.
 */
(function (global) {
  'use strict';

  var RICH_CONTENT_TYPES = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.oasis.opendocument.text',
    'application/rtf',
    'text/rtf'
  ];
  var RICH_EXTENSIONS = ['.docx', '.doc', '.docm', '.dotx', '.odt', '.rtf'];

  function lower(value) {
    return String(value || '').trim().toLowerCase();
  }

  /**
   * True when the document's source is a layout-bearing file: a Word or
   * OpenDocument type by content type or extension, or any document that
   * carries a server source (sourceUrl / sourceDocumentId), which the shell
   * can only ever show as a text preview.
   */
  function isRichSourceDocument(file) {
    if (!file || typeof file !== 'object') return false;
    if (file.kind && file.kind !== 'doc') return false;
    if (file.sourceUrl || file.sourceDocumentId) return true;
    var contentType = lower(file.content_type || file.contentType || file.mime_type);
    if (RICH_CONTENT_TYPES.indexOf(contentType) !== -1) return true;
    var name = lower(file.storageFilename || file.filename || file.title);
    for (var i = 0; i < RICH_EXTENSIONS.length; i += 1) {
      if (name.slice(-RICH_EXTENSIONS[i].length) === RICH_EXTENSIONS[i]) return true;
    }
    return false;
  }

  /**
   * Why the fallback page must stay read-only for this file, or null when
   * editing there is fine (a plain text or markdown note, or the embed is
   * showing the document itself).
   *
   * @param {object} file
   * @param {{ embedMounted?: boolean, editorEnabled?: boolean }} surface
   * @returns {string|null}
   */
  function fallbackLockReason(file, surface) {
    var state = surface || {};
    if (!isRichSourceDocument(file)) return null;
    if (state.embedMounted === true) return null;
    if (state.editorEnabled === false) {
      return 'LANA Editor is turned off, and this document has layout (tables, lists, headings or page breaks) that the plain editor cannot keep. It stays read-only here.';
    }
    return 'LANA Editor could not load this document, and its layout (tables, lists, headings or page breaks) would be lost in the plain editor. It stays read-only until the editor is available.';
  }

  var service = {
    isRichSourceDocument: isRichSourceDocument,
    fallbackLockReason: fallbackLockReason,
    RICH_CONTENT_TYPES: RICH_CONTENT_TYPES.slice(),
    RICH_EXTENSIONS: RICH_EXTENSIONS.slice()
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  global.LanaRichDocumentGuard = service;
})(typeof window !== 'undefined' ? window : globalThis);

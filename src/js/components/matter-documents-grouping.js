/**
 * Document grouping for the matter documents list.
 *
 * A PDF and the editable DOCX copy converted from it are one document to the
 * user: the original is always the PDF, the editable is always the DOCX. The
 * server records the link on the copy (metadata.original_document_id with
 * source document_format_conversion); this module folds such copies under
 * their source so the list shows one row per document with its copy nested,
 * instead of a second file people ask about.
 *
 * Pure functions, no DOM, so they can be tested directly.
 */
(function (global) {
  'use strict';

  var CONVERSION_SOURCE = 'document_format_conversion';

  function metadataOf(file) {
    return file && file.metadata && typeof file.metadata === 'object' ? file.metadata : {};
  }

  /** The id of the document this file was derived from, or null. */
  function derivedParentId(file) {
    var metadata = metadataOf(file);
    if (metadata.source !== CONVERSION_SOURCE) return null;
    var parent = metadata.original_document_id;
    return parent ? String(parent) : null;
  }

  /** Short label for a derived file's role under its source. */
  function derivedRoleLabel(file) {
    return derivedParentId(file) ? 'Editable copy' : '';
  }

  /**
   * Folds derived files under their source, keeping the input order for the
   * sources. A derived file whose source is not in the list stays top-level,
   * because hiding it would lose a document.
   *
   * @param {Array<object>} files
   * @returns {{ groups: Array<{ file: object, children: Array<object> }>, derivedCount: number }}
   */
  function groupDerivedDocuments(files) {
    var list = Array.isArray(files) ? files : [];
    var byId = {};
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id !== undefined && list[i].id !== null) byId[String(list[i].id)] = list[i];
    }
    var childrenOf = {};
    var derivedCount = 0;
    for (var j = 0; j < list.length; j++) {
      var parentId = derivedParentId(list[j]);
      if (!parentId || !byId[parentId] || parentId === String(list[j].id)) continue;
      if (!childrenOf[parentId]) childrenOf[parentId] = [];
      childrenOf[parentId].push(list[j]);
      derivedCount += 1;
    }
    var groups = [];
    for (var k = 0; k < list.length; k++) {
      var file = list[k];
      var parent = derivedParentId(file);
      if (parent && byId[parent] && parent !== String(file.id)) continue; // shown under its source
      groups.push({ file: file, children: childrenOf[String(file.id)] || [] });
    }
    return { groups: groups, derivedCount: derivedCount };
  }

  var service = {
    derivedParentId: derivedParentId,
    derivedRoleLabel: derivedRoleLabel,
    groupDerivedDocuments: groupDerivedDocuments
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  global.LanaDocumentGrouping = service;
})(typeof window !== 'undefined' ? window : globalThis);

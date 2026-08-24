/*
 * LANA File Editor - collaboration-tools.js
 *
 * Pure helpers for signature staging and persisted review-comment anchors.
 */
(function (global) {
  'use strict';

  var ANCHOR_CONTEXT_LENGTH = 48;

  function toText(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function normalizeEmail(value) {
    return toText(value).trim().toLowerCase();
  }

  function hasDuplicateSigner(signers, email) {
    var candidate = normalizeEmail(email);
    if (!candidate) return false;
    return (Array.isArray(signers) ? signers : []).some(function (signer) {
      return normalizeEmail(signer && signer.email) === candidate;
    });
  }

  function validOffset(value) {
    var number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function buildCommentAnchor(documentText, start, end, selectedText) {
    var text = toText(documentText);
    var from = validOffset(start);
    var to = validOffset(end);
    var selection = toText(selectedText);
    if (from === null || to === null || to <= from || to > text.length) return null;
    if (!selection) selection = text.slice(from, to);
    if (!selection || text.slice(from, to) !== selection) return null;
    return {
      anchor_start: from,
      anchor_end: to,
      anchor_prefix: text.slice(Math.max(0, from - ANCHOR_CONTEXT_LENGTH), from),
      anchor_suffix: text.slice(to, Math.min(text.length, to + ANCHOR_CONTEXT_LENGTH))
    };
  }

  function candidateOffsets(documentText, needle) {
    var candidates = [];
    if (!needle) return candidates;
    var offset = documentText.indexOf(needle);
    while (offset !== -1) {
      candidates.push(offset);
      offset = documentText.indexOf(needle, offset + 1);
    }
    return candidates;
  }

  function contextScore(documentText, start, end, prefix, suffix) {
    var score = 0;
    if (prefix) {
      var before = documentText.slice(Math.max(0, start - prefix.length), start);
      if (before === prefix) score += 2;
      else if (before.endsWith(prefix.slice(-Math.min(16, prefix.length)))) score += 1;
    }
    if (suffix) {
      var after = documentText.slice(end, Math.min(documentText.length, end + suffix.length));
      if (after === suffix) score += 2;
      else if (after.startsWith(suffix.slice(0, Math.min(16, suffix.length)))) score += 1;
    }
    return score;
  }

  function resolveCommentAnchor(documentText, comment) {
    var text = toText(documentText);
    var thread = comment || {};
    var anchorText = toText(thread.anchor_text || thread.anchorText);
    if (!text || !anchorText) return null;

    var start = validOffset(thread.anchor_start !== undefined ? thread.anchor_start : thread.anchorStart);
    var end = validOffset(thread.anchor_end !== undefined ? thread.anchor_end : thread.anchorEnd);
    if (start !== null && end !== null && end > start && end <= text.length && text.slice(start, end) === anchorText) {
      return { start: start, end: end, strategy: 'persisted-range' };
    }

    var prefix = toText(thread.anchor_prefix || thread.anchorPrefix);
    var suffix = toText(thread.anchor_suffix || thread.anchorSuffix);
    var offsets = candidateOffsets(text, anchorText);
    if (!offsets.length) return null;
    var bestStart = offsets[0];
    var bestScore = -1;
    offsets.forEach(function (candidate) {
      var score = contextScore(text, candidate, candidate + anchorText.length, prefix, suffix);
      if (score > bestScore) {
        bestStart = candidate;
        bestScore = score;
      }
    });
    return {
      start: bestStart,
      end: bestStart + anchorText.length,
      strategy: prefix || suffix ? 'anchor-text-context' : 'anchor-text'
    };
  }

  var api = {
    normalizeEmail: normalizeEmail,
    hasDuplicateSigner: hasDuplicateSigner,
    buildCommentAnchor: buildCommentAnchor,
    resolveCommentAnchor: resolveCommentAnchor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaFileEditorCollaborationTools = api;
})(typeof window !== 'undefined' ? window : globalThis);

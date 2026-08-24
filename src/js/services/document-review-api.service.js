/**
 * Shared document review datasource for File Viewer and File Editor.
 *
 * Single source of truth for the review lineage contract:
 * - canonical source document resolution (drafts and releases hang off the
 *   source document, never a released artifact)
 * - tracked-change grouping and persistable serialization (both pages must
 *   read and write the same batch shapes)
 * - the matter-scoped edit-batch / release API calls
 *
 * The File Editor writes through this module; the File Viewer reads through
 * it. Neither page may keep a private copy of this logic.
 */
(function (global) {
  'use strict';

  // =========================================================================
  // Canonical ids and endpoints
  // =========================================================================

  function explicitSourceDocumentId(file) {
    if (!file) return '';
    var metadata = file.metadata && typeof file.metadata === 'object' ? file.metadata : {};
    return String(
      file.source_document_id ||
      file.sourceDocumentId ||
      file.original_document_id ||
      file.originalDocumentId ||
      file.parent_document_id ||
      file.parentDocumentId ||
      metadata.source_document_id ||
      metadata.sourceDocumentId ||
      metadata.original_document_id ||
      metadata.originalDocumentId ||
      ''
    );
  }

  function isReleasedArtifact(file) {
    var sourceId = explicitSourceDocumentId(file);
    var fileId = file && file.id ? String(file.id) : '';
    return Boolean(sourceId && fileId && sourceId !== fileId);
  }

  function matterEndpoint(matterId, path) {
    if (!matterId) throw new Error('This file is not associated with a workspace.');
    return '/api/v1/matters/' + encodeURIComponent(matterId) + path;
  }

  function responseData(response) {
    return response && response.data !== undefined && response.data !== null ? response.data : response;
  }

  // =========================================================================
  // Change readers
  // =========================================================================

  function reviewItemText(item) {
    if (!item) return '';
    return item.text || item.proposed_text || item.original_text || item.reviewer_notes || item.summary || '';
  }

  function reviewChangeOperation(change) {
    return String((change && change.operation) || (change && change.type) || '').toLowerCase();
  }

  function isDeletionChange(change) {
    var operation = reviewChangeOperation(change);
    return operation === 'delete' || operation === 'del' || operation === 'remove' || operation === 'removed';
  }

  function isInsertionChange(change) {
    var operation = reviewChangeOperation(change);
    return operation === 'insert' || operation === 'ins' || operation === 'add' || operation === 'added';
  }

  function isFormattingChange(change) {
    var operation = reviewChangeOperation(change);
    return operation === 'fmt' || operation === 'format' || operation === 'formatting';
  }

  var FORMAT_PROPERTY_LABELS = {
    font: 'Font',
    size: 'Size',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strike: 'Strikethrough',
    superscript: 'Superscript',
    subscript: 'Subscript',
    color: 'Text color',
    highlight: 'Highlight',
    alignment: 'Alignment',
    style: 'Style',
    list: 'List',
    indent: 'Indent',
    horizontalRule: 'Horizontal rule'
  };

  var FORMAT_PROPERTY_ORDER = [
    'font', 'size', 'bold', 'italic', 'underline', 'strike',
    'superscript', 'subscript', 'color', 'highlight', 'alignment',
    'style', 'list', 'indent', 'horizontalRule'
  ];

  function sameFormatValue(left, right) {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    try { return JSON.stringify(left) === JSON.stringify(right); } catch (_) { return false; }
  }

  function formatValueText(key, value) {
    if (value === null || value === undefined || value === '') return 'Default / inherited';
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (key === 'size') return String(value) + ' pt';
    if (key === 'indent') return String(value) + ' pt';
    if (key === 'alignment') {
      var alignment = String(value);
      if (alignment === 'both') return 'Justified';
      return alignment.charAt(0).toUpperCase() + alignment.slice(1);
    }
    if (key === 'list' && value && typeof value === 'object') {
      return value.numId
        ? 'List ' + value.numId + ', level ' + (Number(value.level || 0) + 1)
        : 'List, level ' + (Number(value.level || 0) + 1);
    }
    return String(value);
  }

  function formatSummary(snapshot, properties) {
    var source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return (Array.isArray(properties) ? properties : []).map(function (key) {
      return FORMAT_PROPERTY_LABELS[key] + ': ' + formatValueText(key, source[key]);
    }).join('; ');
  }

  function formatChangeDetailsFromRevision(revision) {
    if (!revision) return null;
    var before = revision.formatBefore || revision.format_before || null;
    var after = revision.formatAfter || revision.format_after || null;
    var kind = revision.formatKind || revision.format_kind || null;
    if ((!before || !after) && revision.metadata && revision.metadata.format_change) {
      var persisted = revision.metadata.format_change;
      before = before || persisted.before || null;
      after = after || persisted.after || null;
      kind = kind || persisted.kind || null;
    }
    if (!before || !after) return null;
    var properties = FORMAT_PROPERTY_ORDER.filter(function (key) {
      return !sameFormatValue(before[key], after[key]);
    });
    if (!properties.length) return null;
    return {
      kind: kind === 'paragraph' ? 'paragraph' : 'text',
      properties: properties,
      before: before,
      after: after,
      originalText: formatSummary(before, properties),
      proposedText: formatSummary(after, properties)
    };
  }

  function changeOriginalText(change) {
    if (!change) return '';
    if (isFormattingChange(change)) {
      var formatDetails = formatChangeDetailsFromRevision(change);
      if (formatDetails) return formatDetails.originalText;
    }
    return change.original_text || (isDeletionChange(change) ? reviewItemText(change) : '');
  }

  function changeProposedText(change) {
    if (!change) return '';
    if (isFormattingChange(change)) {
      var formatDetails = formatChangeDetailsFromRevision(change);
      if (formatDetails) return formatDetails.proposedText;
    }
    return change.proposed_text || (isInsertionChange(change) ? reviewItemText(change) : '');
  }

  function changeLabel(item) {
    if (item && item.operation === 'replace') return 'Replacement';
    if (isFormattingChange(item)) {
      var details = formatChangeDetailsFromRevision(item);
      return details && details.properties.length === 1
        ? FORMAT_PROPERTY_LABELS[details.properties[0]]
        : 'Formatting';
    }
    if (item && item.operation) {
      return String(item.operation).charAt(0).toUpperCase() + String(item.operation).slice(1);
    }
    if (item && item.type === 'replace') return 'Replacement';
    if (item && item.type === 'del') return 'Deletion';
    if (item && item.type === 'ins') return 'Insertion';
    return 'Change';
  }

  function changeStatus(item) {
    if (item && item.released_in && item.released_in.release_number) {
      return { label: 'Released', tone: 'released' };
    }
    var status = item && item.status ? String(item.status) : 'proposed';
    if (status === 'accepted') return { label: 'Accepted', tone: 'accepted' };
    if (status === 'rejected') return { label: 'Rejected', tone: 'rejected' };
    return { label: 'Pending', tone: 'pending' };
  }

  function sourceChangesForReviewChange(change) {
    if (!change) return [];
    if (Array.isArray(change.source_changes)) return change.source_changes.filter(Boolean);
    return [change];
  }

  function editScriptKeyForChange(change) {
    var script = change && (change.edit_script || change.editScript);
    var ops = script && Array.isArray(script.ops) ? script.ops : [];
    if (!ops.length) return null;
    try {
      return JSON.stringify(ops);
    } catch (_) {
      return null;
    }
  }

  function editScriptGroupIdForChange(change) {
    var script = change && (change.edit_script || change.editScript);
    if (!script || typeof script !== 'object') return '';
    return String(
      script.group_id ||
      script.groupId ||
      script.change_group_id ||
      script.changeGroupId ||
      ''
    );
  }

  function reviewChangeIdentityKey(change) {
    if (!change) return '';
    var metadata = change.metadata || {};
    var anchor = change.anchor || {};
    return String(
      editScriptGroupIdForChange(change) ||
      change.change_group_id ||
      change.changeGroupId ||
      change.group_id ||
      change.change_id ||
      metadata.change_group_id ||
      metadata.changeGroupId ||
      metadata.group_id ||
      metadata.change_id ||
      anchor.change_group_id ||
      anchor.group_id ||
      ''
    );
  }

  function sameReviewChangeMoment(a, b) {
    if (!a || !b) return false;
    var leftIdentity = reviewChangeIdentityKey(a);
    var rightIdentity = reviewChangeIdentityKey(b);
    if (leftIdentity && rightIdentity) return leftIdentity === rightIdentity;
    var leftScriptKey = editScriptKeyForChange(a);
    var rightScriptKey = editScriptKeyForChange(b);
    return !!(leftScriptKey && rightScriptKey && leftScriptKey === rightScriptKey);
  }

  function editScriptOpsForReviewChange(change) {
    var ops = [];
    var seen = {};
    sourceChangesForReviewChange(change).forEach(function (source) {
      var script = source && (source.edit_script || source.editScript);
      var scriptOps = Array.isArray(script) ? script : (script && Array.isArray(script.ops) ? script.ops : []);
      scriptOps.forEach(function (op) {
        if (!op) return;
        var key;
        try {
          key = JSON.stringify(op);
        } catch (_) {
          key = String(ops.length);
        }
        if (seen[key]) return;
        seen[key] = true;
        ops.push(op);
      });
    });
    return ops;
  }

  // =========================================================================
  // Display grouping (adjacent fragments of one moment render as one change)
  // =========================================================================

  function mergeReviewChangeRun(run, startIndex) {
    var sources = Array.isArray(run) ? run.filter(Boolean) : [];
    if (!sources.length) return null;
    var original = '';
    var proposed = '';
    var revisionIds = [];
    var hasRemoved = false;
    var hasAdded = false;
    sources.forEach(function (source) {
      var sourceOriginal = changeOriginalText(source);
      var sourceProposed = changeProposedText(source);
      if (sourceOriginal) {
        original += sourceOriginal;
        hasRemoved = true;
      }
      if (sourceProposed) {
        proposed += sourceProposed;
        hasAdded = true;
      }
      var revisionId = source && source.anchor && source.anchor.revision_id;
      if (!revisionId && source && source.id) revisionId = source.id;
      if (revisionId && revisionIds.indexOf(String(revisionId)) === -1) revisionIds.push(String(revisionId));
    });
    var first = sources[0];
    var last = sources[sources.length - 1];
    var formattingOnly = sources.every(isFormattingChange);
    if (formattingOnly) {
      var uniqueOriginal = [];
      var uniqueProposed = [];
      sources.forEach(function (source) {
        var sourceOriginal = changeOriginalText(source);
        var sourceProposed = changeProposedText(source);
        if (sourceOriginal && uniqueOriginal.indexOf(sourceOriginal) === -1) uniqueOriginal.push(sourceOriginal);
        if (sourceProposed && uniqueProposed.indexOf(sourceProposed) === -1) uniqueProposed.push(sourceProposed);
      });
      original = uniqueOriginal.join(' · ');
      proposed = uniqueProposed.join(' · ');
    }
    var operation = formattingOnly ? 'format' : (hasRemoved && hasAdded ? 'replace' : (hasRemoved ? 'delete' : 'insert'));
    var identityKey = reviewChangeIdentityKey(first) || reviewChangeIdentityKey(last);
    var mergedOps = editScriptOpsForReviewChange({ source_changes: sources });
    var firstScript = first && (first.edit_script || first.editScript);
    var lastScript = last && (last.edit_script || last.editScript);
    var scriptAuthor = (firstScript && firstScript.author) ||
      (lastScript && lastScript.author) ||
      (first.metadata && first.metadata.author) ||
      (last.metadata && last.metadata.author) ||
      'Reviewer';
    var scriptDate = (firstScript && firstScript.date) ||
      (lastScript && lastScript.date) ||
      (first.metadata && first.metadata.date) ||
      (last.metadata && last.metadata.date) ||
      new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    var mergedScript = mergedOps.length
      ? { version: '0', author: String(scriptAuthor), date: String(scriptDate), ops: mergedOps }
      : (first.edit_script || first.editScript || null);
    if (mergedScript && identityKey) mergedScript.group_id = identityKey;
    return {
      change_key: (first.change_key || first.id || startIndex) + ':' + operation + ':merged',
      status: first.status || last.status || 'proposed',
      operation: operation,
      type: operation,
      original_text: original || null,
      proposed_text: proposed || null,
      edit_script: mergedScript,
      anchor: Object.assign({}, first.anchor || { index: startIndex }, {
        index: first && first.anchor && Number.isFinite(Number(first.anchor.index)) ? Number(first.anchor.index) : startIndex,
        revision_ids: revisionIds
      }),
      source_changes: sources,
      metadata: Object.assign({}, last.metadata || {}, first.metadata || {}, identityKey ? { change_group_id: identityKey } : {}),
      released_in: first.released_in || last.released_in || null
    };
  }

  function fragmentRunHasProposedText(run) {
    return (Array.isArray(run) ? run : []).some(function (change) {
      return !!changeProposedText(change);
    });
  }

  function adjacentDeletionFragmentRun(items, startIndex) {
    var current = items[startIndex];
    if (!isDeletionChange(current)) return null;
    var run = [current];
    var cursor = startIndex + 1;
    while (cursor < items.length && isDeletionChange(items[cursor]) && sameReviewChangeMoment(current, items[cursor])) {
      run.push(items[cursor]);
      cursor += 1;
    }
    if (cursor < items.length
      && sameReviewChangeMoment(current, items[cursor])
      && (isInsertionChange(items[cursor]) || reviewChangeOperation(items[cursor]) === 'replace')) {
      run.push(items[cursor]);
      cursor += 1;
    }
    return run.length > 1 && fragmentRunHasProposedText(run)
      ? { run: run, nextIndex: cursor }
      : null;
  }

  function adjacentIdentityRun(items, startIndex) {
    var current = items[startIndex];
    var identity = reviewChangeIdentityKey(current);
    if (!identity) return null;
    var run = [current];
    var cursor = startIndex + 1;
    while (cursor < items.length && reviewChangeIdentityKey(items[cursor]) === identity) {
      run.push(items[cursor]);
      cursor += 1;
    }
    return run.length > 1
      ? { run: run, nextIndex: cursor }
      : null;
  }

  function displayReviewChanges(changes) {
    var items = Array.isArray(changes) ? changes : [];
    var grouped = [];
    for (var i = 0; i < items.length; i++) {
      var current = items[i];
      var identityRun = adjacentIdentityRun(items, i);
      if (identityRun) {
        grouped.push(mergeReviewChangeRun(identityRun.run, i));
        i = identityRun.nextIndex - 1;
        continue;
      }
      var adjacentRun = adjacentDeletionFragmentRun(items, i);
      if (adjacentRun) {
        grouped.push(mergeReviewChangeRun(adjacentRun.run, i));
        i = adjacentRun.nextIndex - 1;
        continue;
      }
      var next = items[i + 1];
      if (isDeletionChange(current) && isInsertionChange(next) && sameReviewChangeMoment(current, next)) {
        grouped.push(mergeReviewChangeRun([current, next], i));
        i += 1;
      } else {
        if (current && !current.source_changes) {
          grouped.push(Object.assign({}, current, { source_changes: [current] }));
        } else {
          grouped.push(current);
        }
      }
    }
    return grouped;
  }

  // =========================================================================
  // Revision targeting: revert and direct-edit of unreleased changes
  // =========================================================================

  function revisionIdsForReviewChange(change) {
    var ids = [];
    sourceChangesForReviewChange(change).forEach(function (source) {
      var revisionId = source && source.anchor && source.anchor.revision_id;
      if (!revisionId && source && source.id) revisionId = source.id;
      if (revisionId && ids.indexOf(String(revisionId)) === -1) ids.push(String(revisionId));
    });
    var anchorIds = change && change.anchor && Array.isArray(change.anchor.revision_ids) ? change.anchor.revision_ids : [];
    anchorIds.forEach(function (revisionId) {
      if (revisionId && ids.indexOf(String(revisionId)) === -1) ids.push(String(revisionId));
    });
    return ids;
  }

  function liveRevisionChangesForChange(change, reviewState) {
    var ids = revisionIdsForReviewChange(change);
    if (!ids.length) return [];
    var revisions = Array.isArray(reviewState && reviewState.revisions) ? reviewState.revisions : [];
    var byId = {};
    ids.forEach(function (id) { byId[String(id)] = true; });
    return revisions.filter(function (revision) {
      return revision && revision.id && byId[String(revision.id)] && (revision.editScript || revision.edit_script);
    }).map(function (revision, index) {
      var mapped = changesFromRevisions([revision])[0];
      if (!mapped) return null;
      mapped.change_key = 'live-revision:' + revision.id;
      mapped.anchor.index = index;
      return mapped;
    }).filter(Boolean);
  }

  function editableOpsForChange(change, reviewState) {
    var liveChanges = liveRevisionChangesForChange(change, reviewState);
    if (liveChanges.length) return editScriptOpsForReviewChange({ source_changes: liveChanges });
    return editScriptOpsForReviewChange(change);
  }

  function isReplacementReviewChange(change) {
    if (!change) return false;
    if (reviewChangeOperation(change) === 'replace') return true;
    return Boolean(changeOriginalText(change) && changeProposedText(change));
  }

  function firstEditableDraftOpForChange(change, nextText, reviewState) {
    var ops = editableOpsForChange(change, reviewState);
    if (!ops.length) return null;
    var text = String(nextText || '');
    var preferredOps = [];
    if (isInsertionChange(change) && !isReplacementReviewChange(change)) {
      preferredOps = ['insertText', 'insertBlocks'];
    } else if (isDeletionChange(change) && !text) {
      preferredOps = ['deleteText'];
    } else if (isDeletionChange(change)) {
      preferredOps = ['deleteText', 'replaceText'];
    } else {
      preferredOps = ['replaceText', 'deleteText', 'insertText', 'insertBlocks'];
    }
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i] || {};
      if (preferredOps.indexOf(op.op) === -1) continue;
      if (op.op === 'replaceText' && op.range) {
        return {
          op: 'replaceText',
          range: Object.assign({}, op.range),
          text: text
        };
      }
      if (op.op === 'insertText' && op.at) {
        return {
          op: 'insertText',
          at: Object.assign({}, op.at),
          text: text
        };
      }
      if (op.op === 'insertBlocks' && op.at) {
        return {
          op: 'insertText',
          at: Object.assign({}, op.at),
          text: text
        };
      }
      if (op.op === 'deleteText' && op.range && text) {
        return {
          op: 'replaceText',
          range: Object.assign({}, op.range),
          text: text
        };
      }
    }
    return null;
  }

  function canEditDraftReviewChange(change, reviewState) {
    if (!change) return false;
    if (change.released_in) return false;
    if (!revisionIdsForReviewChange(change).length) return false;
    return !!firstEditableDraftOpForChange(change, changeProposedText(change), reviewState);
  }

  function operationTextFromRuns(runs) {
    if (!Array.isArray(runs)) return '';
    return runs.map(function (run) { return run && run.text ? String(run.text) : ''; }).join('');
  }

  function insertedTextForOperation(op, fallback) {
    if (!op) return fallback || '';
    if (typeof op.text === 'string') return op.text;
    var runText = operationTextFromRuns(op.runs);
    return runText || fallback || '';
  }

  function inverseEditOpsForReleasedChange(change) {
    var sources = sourceChangesForReviewChange(change);
    var ops = editScriptOpsForReviewChange(change);
    if (!ops.length) return [];
    var inverse = [];
    for (var i = ops.length - 1; i >= 0; i--) {
      var op = ops[i];
      var source = sources[Math.min(i, sources.length - 1)] || change;
      if (!op || !op.op) continue;
      if (op.op === 'insertText') {
        var inserted = insertedTextForOperation(op, changeProposedText(source));
        var at = op.at || {};
        if (!inserted || !Number.isFinite(Number(at.paragraph)) || !Number.isFinite(Number(at.start))) return [];
        inverse.push({
          op: 'deleteText',
          range: {
            paragraph: Number(at.paragraph),
            start: Number(at.start),
            end: Number(at.start) + inserted.length
          }
        });
      } else if (op.op === 'deleteText') {
        var range = op.range || {};
        var original = changeOriginalText(source);
        if (!original || !Number.isFinite(Number(range.paragraph)) || !Number.isFinite(Number(range.start))) return [];
        inverse.push({
          op: 'insertText',
          at: {
            paragraph: Number(range.paragraph),
            start: Number(range.start)
          },
          text: original
        });
      } else if (op.op === 'replaceText') {
        var replaceRange = op.range || {};
        var proposed = insertedTextForOperation(op, changeProposedText(source));
        var replacementOriginal = changeOriginalText(source);
        if (!replacementOriginal || !Number.isFinite(Number(replaceRange.paragraph)) || !Number.isFinite(Number(replaceRange.start))) return [];
        inverse.push({
          op: 'replaceText',
          range: {
            paragraph: Number(replaceRange.paragraph),
            start: Number(replaceRange.start),
            end: Number(replaceRange.start) + proposed.length
          },
          text: replacementOriginal
        });
      } else {
        return [];
      }
    }
    return inverse;
  }

  // =========================================================================
  // Persisted batch edit-script replay helpers
  // =========================================================================

  function dedupeEditOps(ops) {
    var items = Array.isArray(ops) ? ops : [];
    var deduped = [];
    var seenOps = {};
    for (var i = 0; i < items.length; i++) {
      var op = items[i];
      if (!op) continue;
      var opKey;
      try {
        opKey = JSON.stringify(op);
      } catch (_) {
        opKey = null;
      }
      if (opKey && seenOps[opKey]) continue;
      if (opKey) seenOps[opKey] = true;
      deduped.push(op);
    }
    return deduped;
  }

  function editOpsFromBatch(batch) {
    var changes = replayOrderedBatchChanges(batch);
    var ops = [];
    var seenScripts = {};
    for (var i = 0; i < changes.length; i++) {
      var script = changes[i] && (changes[i].edit_script || changes[i].editScript);
      var scriptOps = dedupeEditOps(script && Array.isArray(script.ops) ? script.ops : []);
      if (!scriptOps.length) continue;
      var scriptKey;
      try {
        scriptKey = JSON.stringify(scriptOps);
      } catch (_) {
        scriptKey = null;
      }
      if (scriptKey && seenScripts[scriptKey]) continue;
      if (scriptKey) seenScripts[scriptKey] = true;
      for (var j = 0; j < scriptOps.length; j++) {
        if (scriptOps[j]) ops.push(scriptOps[j]);
      }
    }
    return ops;
  }

  function replayRevisionSequence(change) {
    var revisionId = change && change.anchor && (change.anchor.revision_id || change.anchor.revisionId);
    if (revisionId === undefined || revisionId === null || revisionId === '') {
      var keyMatch = String(change && (change.change_key || change.id) || '').match(/^revision:(\d+)$/);
      revisionId = keyMatch ? keyMatch[1] : '';
    }
    return /^\d+$/.test(String(revisionId || '')) ? Number(revisionId) : null;
  }

  function replayOrderedBatchChanges(batch) {
    var changes = Array.isArray(batch && batch.changes) ? batch.changes.slice() : [];
    var sequenced = changes.map(function (change, index) {
      return { change: change, index: index, sequence: replayRevisionSequence(change) };
    });
    // Numeric revision ids are assigned monotonically by the redline engine
    // and survive the draft API. Repository created_at/id order can differ
    // after Undo/Redo deletes and recreates rows, which makes structural ops
    // replay after later insertions and fail their original anchors. Only sort
    // when every row has the durable numeric sequence; otherwise preserve the
    // server order exactly.
    if (sequenced.length && sequenced.every(function (entry) { return entry.sequence !== null; })) {
      sequenced.sort(function (left, right) {
        return left.sequence - right.sequence || left.index - right.index;
      });
    }
    return sequenced.map(function (entry) { return entry.change; });
  }

  function editScriptsFromBatch(batch) {
    var changes = displayReviewChanges(replayOrderedBatchChanges(batch));
    var scripts = [];
    var seenScripts = {};
    for (var i = 0; i < changes.length; i++) {
      var script = changes[i] && (changes[i].edit_script || changes[i].editScript);
      var scriptOps = dedupeEditOps(script && Array.isArray(script.ops) ? script.ops : []);
      if (!scriptOps.length) continue;
      var groupId = script && (script.group_id || script.groupId);
      var author = script && script.author
        ? String(script.author)
        : (changes[i] && changes[i].metadata && changes[i].metadata.author ? String(changes[i].metadata.author) : 'Reviewer');
      var date = script && script.date
        ? String(script.date)
        : (changes[i] && changes[i].metadata && changes[i].metadata.date ? String(changes[i].metadata.date) : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
      var normalizedScript = {
        version: '0',
        author: author,
        date: date,
        ops: scriptOps
      };
      if (groupId) normalizedScript.group_id = String(groupId);
      var scriptKey;
      try {
        scriptKey = JSON.stringify(normalizedScript);
      } catch (_) {
        scriptKey = null;
      }
      if (scriptKey && seenScripts[scriptKey]) continue;
      if (scriptKey) seenScripts[scriptKey] = true;
      scripts.push(normalizedScript);
    }
    return scripts;
  }

  // =========================================================================
  // Review session: baseline tracking + persistable serialization
  // =========================================================================

  function reviewRevisionKey(revision) {
    if (!revision) return '';
    var revisionId = revision.id || revision.revision_id || revision.revisionId || '';
    var payload = {
      id: revisionId ? String(revisionId) : '',
      type: String((revision.type || revision.operation || revision.op || '')).toLowerCase(),
      text: revision.text !== undefined ? String(revision.text) : '',
      original_text: changeOriginalText(revision),
      proposed_text: changeProposedText(revision),
      format_kind: revision.formatKind || revision.format_kind || null,
      format_before: revision.formatBefore || revision.format_before || null,
      format_after: revision.formatAfter || revision.format_after || null
    };
    try {
      return JSON.stringify(payload);
    } catch (_) {
      return '';
    }
  }

  function rawReviewRevisions(reviewState) {
    var source = reviewState || {};
    return Array.isArray(source.revisions) ? source.revisions.filter(Boolean) : [];
  }

  /** Serialize editor revisions into persistable change rows. */
  function changesFromRevisions(revisions) {
    return (Array.isArray(revisions) ? revisions : []).filter(function (revision) {
      return Boolean(revision && (revision.editScript || revision.edit_script));
    }).map(function (revision, index) {
      var id = revision && revision.id ? String(revision.id) : String(index + 1);
      var type = revision && revision.type ? String(revision.type) : 'change';
      var text = revision && revision.text ? String(revision.text) : '';
      var editScript = revision && (revision.editScript || revision.edit_script) ? (revision.editScript || revision.edit_script) : null;
      var formatDetails = type === 'fmt' ? formatChangeDetailsFromRevision(revision) : null;
      var metadata = {
        author: revision && revision.author ? revision.author : null,
        date: revision && revision.date ? revision.date : null
      };
      if (formatDetails) {
        metadata.format_change = {
          kind: formatDetails.kind,
          properties: formatDetails.properties,
          before: formatDetails.before,
          after: formatDetails.after
        };
      }
      return {
        change_key: 'revision:' + id,
        status: 'proposed',
        operation: type === 'del' ? 'delete' : (type === 'ins' ? 'insert' : (type === 'fmt' ? 'format' : type)),
        original_text: type === 'del' ? text : (formatDetails ? formatDetails.originalText : null),
        proposed_text: type === 'ins' ? text : (formatDetails ? formatDetails.proposedText : null),
        edit_script: editScript,
        anchor: {
          type: 'editor_revision',
          revision_id: id,
          revision_type: type,
          index: index
        },
        metadata: metadata
      };
    });
  }

  function persistableReviewChange(change, index) {
    if (!change) return null;
    var script = change.edit_script || change.editScript || null;
    var ops = script && Array.isArray(script.ops) ? dedupeEditOps(script.ops) : [];
    var groupId = script && (script.group_id || script.groupId);
    var baseDocumentHash = script && script.baseDocumentHash;
    var editScript = ops.length
      ? {
          version: '0',
          author: String(script.author || (change.metadata && change.metadata.author) || 'Reviewer'),
          date: String(script.date || (change.metadata && change.metadata.date) || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')),
          ops: ops
        }
      : null;
    // Keep editor-issued provenance alongside the operations. In particular,
    // do not rebuild or translate the ops: Lana Editor's EditScript contract
    // includes formatting and paragraph-boundary operations in addition to
    // text edits, and the review batch must persist each wire shape exactly.
    if (editScript && groupId) editScript.group_id = String(groupId);
    if (editScript && baseDocumentHash) editScript.baseDocumentHash = String(baseDocumentHash);
    return {
      change_key: String(change.change_key || change.id || ('change:' + (index + 1))),
      status: change.status || 'proposed',
      operation: change.operation || change.type || null,
      original_text: change.original_text !== undefined ? change.original_text : null,
      proposed_text: change.proposed_text !== undefined ? change.proposed_text : null,
      edit_script: editScript,
      anchor: change.anchor || {},
      reviewer_notes: change.reviewer_notes || null,
      metadata: change.metadata || {}
    };
  }

  /**
   * Map a persisted batch change row (as returned by the edit-batches API)
   * back to the exact wire shape the API accepts. The change schema is
   * strict, so server-added fields (id, batch_id, timestamps, released_in,
   * decided_*) must be dropped; everything else passes through untouched so
   * the server's decision-material comparison sees an identical change and
   * decided rows stay decided.
   */
  function persistedDraftChangePayload(change) {
    if (!change || !change.change_key) return null;
    return {
      change_key: String(change.change_key),
      status: change.status || 'proposed',
      operation: change.operation || null,
      original_text: change.original_text !== undefined ? change.original_text : null,
      proposed_text: change.proposed_text !== undefined ? change.proposed_text : null,
      edit_script: change.edit_script || change.editScript || null,
      anchor: change.anchor || {},
      reviewer_notes: change.reviewer_notes || null,
      metadata: change.metadata || {}
    };
  }

  /**
   * Tracks which revisions were already in the document when it opened (the
   * baseline) so only new, unreleased work is serialized into the draft batch.
   */
  function createReviewSession() {
    var baselineKeyCounts = {};
    var baselineRevisionIds = [];

    function reset() {
      baselineKeyCounts = {};
      baselineRevisionIds = [];
    }

    function captureBaseline(reviewState) {
      var counts = {};
      var ids = [];
      rawReviewRevisions(reviewState).forEach(function (revision) {
        var key = reviewRevisionKey(revision);
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
        if (revision && revision.id) ids.push(String(revision.id));
      });
      baselineKeyCounts = counts;
      baselineRevisionIds = ids;
    }

    function unreleasedRevisions(reviewState) {
      var revisions = rawReviewRevisions(reviewState);
      var keys = Object.keys(baselineKeyCounts);
      if (!keys.length) return revisions;
      var remaining = Object.assign({}, baselineKeyCounts);
      return revisions.filter(function (revision) {
        var key = reviewRevisionKey(revision);
        if (key && remaining[key] > 0) {
          remaining[key] -= 1;
          return false;
        }
        return true;
      });
    }

    function normalizeChanges(reviewState) {
      return changesFromRevisions(unreleasedRevisions(reviewState));
    }

    function persistableChanges(reviewState) {
      return displayReviewChanges(normalizeChanges(reviewState)).map(persistableReviewChange).filter(Boolean);
    }

    return {
      reset: reset,
      captureBaseline: captureBaseline,
      unreleasedRevisions: unreleasedRevisions,
      normalizeChanges: normalizeChanges,
      persistableChanges: persistableChanges,
      baselineRevisionIds: function () { return baselineRevisionIds.slice(); },
      baselineKeyCounts: function () { return Object.assign({}, baselineKeyCounts); }
    };
  }

  // =========================================================================
  // Batch selection helpers
  // =========================================================================

  function isActiveDraftBatch(batch) {
    var status = batch && batch.status ? String(batch.status) : '';
    return status === 'draft' || status === 'proposed';
  }

  function activeDraftBatchFromList(list) {
    var batches = Array.isArray(list) ? list : [];
    for (var i = 0; i < batches.length; i++) {
      if (isActiveDraftBatch(batches[i])) {
        return batches[i];
      }
    }
    return null;
  }

  function activeDraftBatchForBaseVersion(list, baseFileVersionId, requireMatch) {
    if (!requireMatch) return activeDraftBatchFromList(list);
    var expected = String(baseFileVersionId || '');
    if (!expected) return null;
    var batches = Array.isArray(list) ? list : [];
    for (var i = 0; i < batches.length; i++) {
      if (isActiveDraftBatch(batches[i]) && String(batches[i].base_file_version_id || '') === expected) {
        return batches[i];
      }
    }
    return null;
  }

  function pendingReleaseBatchFromList(list) {
    var batches = Array.isArray(list) ? list : [];
    for (var i = 0; i < batches.length; i++) {
      if (batches[i] && batches[i].status === 'pending_release') {
        return batches[i];
      }
    }
    return null;
  }

  /**
   * Resolve the immutable document whose bytes a saved draft was authored
   * against. Batches created from a released artifact keep that release's
   * file-version id even though the batch itself is re-parented to the
   * canonical source document.
   */
  function draftBaseDocumentId(batch, releases, sourceDocumentId) {
    var fallback = sourceDocumentId ? String(sourceDocumentId) : '';
    var baseFileVersionId = batch && batch.base_file_version_id
      ? String(batch.base_file_version_id)
      : '';
    if (!baseFileVersionId) return fallback;
    var items = Array.isArray(releases) ? releases : [];
    for (var i = 0; i < items.length; i++) {
      var release = items[i];
      if (!release) continue;
      if (String(release.file_version_id || '') !== baseFileVersionId) continue;
      var releasedDocumentId = release.released_document_id || release.document_id;
      if (releasedDocumentId) return String(releasedDocumentId);
    }
    return fallback;
  }

  function previousReleaseDocumentId(release, releases, originalDocumentId) {
    var exactPreviousDocumentId = release && (
      release.previous_released_document_id ||
      release.previousReleasedDocumentId
    );
    if (exactPreviousDocumentId) return String(exactPreviousDocumentId);
    var releaseNumber = Number(release && release.release_number || 0);
    var items = Array.isArray(releases) ? releases : [];
    var previous = null;
    for (var i = 0; i < items.length; i++) {
      var candidate = items[i];
      var candidateNumber = Number(candidate && candidate.release_number || 0);
      var candidateDocumentId = candidate && (candidate.released_document_id || candidate.releasedDocumentId);
      if (!candidateDocumentId || (releaseNumber > 0 && candidateNumber >= releaseNumber)) continue;
      if (!previous || candidateNumber > Number(previous.release_number || 0)) previous = candidate;
    }
    return String(
      (previous && (previous.released_document_id || previous.releasedDocumentId)) ||
      originalDocumentId ||
      ''
    );
  }

  async function hydrateBatchDetail(options) {
    var api = options && options.api;
    var matterId = options && options.matterId;
    var batch = options && options.batch;
    if (!batch || !batch.id || Array.isArray(batch.changes)) {
      return { batch: batch || null, failed: false, error: null };
    }
    if (!api) throw new Error('hydrateBatchDetail requires an api client.');
    try {
      var response = await api.get(matterEndpoint(
        matterId,
        '/document-edit-batches/' + encodeURIComponent(batch.id)
      ));
      return {
        batch: responseData(response) || batch,
        failed: false,
        error: null
      };
    } catch (error) {
      return { batch: batch, failed: true, error: error };
    }
  }

  async function loadReleaseLineage(options) {
    var api = options && options.api;
    var matterId = options && options.matterId;
    var documentId = String(options && options.documentId || '');
    var pageSize = 20;
    if (!api) throw new Error('loadReleaseLineage requires an api client.');
    if (!documentId) throw new Error('loadReleaseLineage requires a documentId.');

    var releases = [];
    var seen = {};
    var metadata = {};
    var page = 1;
    while (page <= 250) {
      var suffix = '?limit=' + pageSize + (page > 1 ? '&page=' + page : '');
      var response = await api.get(matterEndpoint(
        matterId,
        '/documents/' + encodeURIComponent(documentId) + '/releases' + suffix
      ));
      var pageRows = Array.isArray(response && response.data) ? response.data : [];
      if (page === 1 && response && response.metadata) metadata = response.metadata;
      var added = 0;
      for (var i = 0; i < pageRows.length; i++) {
        var release = pageRows[i];
        var key = release && release.id ? String(release.id) : 'page:' + page + ':row:' + i;
        if (seen[key]) continue;
        seen[key] = true;
        releases.push(release);
        added += 1;
      }
      if (pageRows.length < pageSize || added === 0) break;
      page += 1;
    }
    return { data: releases, metadata: metadata };
  }

  // =========================================================================
  // API workflows (matter-scoped)
  // =========================================================================

  /**
   * Load the review lineage for a document: releases, batches, and the active
   * draft (with its changes). `documentId` may be a released artifact; the
   * canonical source id is resolved through the releases metadata.
   */
  async function loadWorkflow(options) {
    var api = options.api;
    var matterId = options.matterId;
    var documentId = String(options.documentId || '');
    var openedDocumentId = documentId;
    if (!api) throw new Error('loadWorkflow requires an api client.');
    if (!documentId) throw new Error('loadWorkflow requires a documentId.');

    var releasesResponse = await loadReleaseLineage({ api: api, matterId: matterId, documentId: documentId });
    var sourceDocumentId = documentId;
    var currentDocumentIsRelease = false;
    var metadataSourceDocumentId = releasesResponse && releasesResponse.metadata && releasesResponse.metadata.source_document_id
      ? String(releasesResponse.metadata.source_document_id)
      : '';
    if (releasesResponse && releasesResponse.metadata && releasesResponse.metadata.current_document_is_release) {
      currentDocumentIsRelease = true;
    }
    if (metadataSourceDocumentId && metadataSourceDocumentId !== sourceDocumentId) {
      sourceDocumentId = metadataSourceDocumentId;
      releasesResponse = await loadReleaseLineage({ api: api, matterId: matterId, documentId: sourceDocumentId });
    }

    var releases = Array.isArray(releasesResponse && releasesResponse.data) ? releasesResponse.data : [];
    var openedRelease = releases.find(function (release) {
      return release && String(release.released_document_id || '') === openedDocumentId;
    }) || null;
    var currentBaseFileVersionId = openedRelease && openedRelease.file_version_id
      ? String(openedRelease.file_version_id)
      : '';
    var query = '?document_id=' + encodeURIComponent(sourceDocumentId) + '&limit=20&sort_by=updated_at&sort_dir=desc';
    var batchesResponse = await api.get(matterEndpoint(matterId, '/document-edit-batches' + query));
    var batches = Array.isArray(batchesResponse && batchesResponse.data) ? batchesResponse.data : [];
    var currentDraftBatch = activeDraftBatchForBaseVersion(
      batches,
      currentBaseFileVersionId,
      currentDocumentIsRelease
    );
    var pendingReleaseBatch = pendingReleaseBatchFromList(batches);
    var draftDetailFailed = false;
    var pendingDetailFailed = false;

    if (currentDraftBatch && currentDraftBatch.id && options.loadDraftDetail !== false) {
      var draftDetail = await hydrateBatchDetail({ api: api, matterId: matterId, batch: currentDraftBatch });
      currentDraftBatch = draftDetail.batch;
      draftDetailFailed = draftDetail.failed;
    }

    if (pendingReleaseBatch && pendingReleaseBatch.id && options.loadDraftDetail !== false) {
      var pendingDetail = await hydrateBatchDetail({ api: api, matterId: matterId, batch: pendingReleaseBatch });
      pendingReleaseBatch = pendingDetail.batch;
      pendingDetailFailed = pendingDetail.failed;
    }

    return {
      sourceDocumentId: sourceDocumentId,
      currentDocumentIsRelease: currentDocumentIsRelease,
      currentBaseFileVersionId: currentBaseFileVersionId,
      releases: releases,
      batches: batches,
      currentDraftBatch: currentDraftBatch,
      pendingReleaseBatch: pendingReleaseBatch,
      draftDetailFailed: draftDetailFailed,
      pendingDetailFailed: pendingDetailFailed
    };
  }

  /** Load each release's persisted changes (grouped per release). */
  async function loadReleaseChangeGroups(options) {
    var api = options.api;
    var matterId = options.matterId;
    var releases = Array.isArray(options.releases) ? options.releases : [];
    var groups = new Array(releases.length);
    var cursor = 0;
    async function loadNextGroup() {
      while (cursor < releases.length) {
        var index = cursor;
        cursor += 1;
        var release = releases[index];
        if (!release || !release.edit_batch_id) {
          groups[index] = {
            release_id: release && release.id,
            release: release,
            changes: [],
            failed: Boolean(release && release.id)
          };
        } else {
          try {
            var batchResponse = await api.get(matterEndpoint(matterId, '/document-edit-batches/' + encodeURIComponent(release.edit_batch_id)));
            var batch = responseData(batchResponse);
            groups[index] = {
              release_id: release.id,
              release: release,
              changes: Array.isArray(batch && batch.changes) ? batch.changes : [],
              failed: false
            };
          } catch (error) {
            groups[index] = { release_id: release.id, release: release, changes: [], failed: true };
          }
        }
      }
    }
    var workerCount = Math.min(6, releases.length);
    var workers = [];
    for (var worker = 0; worker < workerCount; worker++) workers.push(loadNextGroup());
    await Promise.all(workers);
    return groups;
  }

  /**
   * Create or update the draft batch for a document. Creates against the
   * canonical source document; patches when an active draft batch id is given.
   */
  async function saveDraftBatch(options) {
    var api = options.api;
    var matterId = options.matterId;
    var payload = options.payload || {};
    var batch = options.batch || null;
    var response;
    if (batch && batch.id && isActiveDraftBatch(batch)) {
      response = await api.patch(
        matterEndpoint(matterId, '/document-edit-batches/' + encodeURIComponent(batch.id)),
        payload
      );
    } else {
      var documentId = String(options.documentId || '');
      if (!documentId) throw new Error('saveDraftBatch requires a documentId to create a draft.');
      response = await api.post(
        matterEndpoint(matterId, '/documents/' + encodeURIComponent(documentId) + '/edit-batches'),
        payload
      );
    }
    return responseData(response);
  }

  /** Request a release of the given batch with the edited document bytes. */
  async function releaseBatch(options) {
    var api = options.api;
    var matterId = options.matterId;
    var batchId = options.batchId;
    if (!batchId) throw new Error('releaseBatch requires a batchId.');
    var response = await api.post(
      matterEndpoint(matterId, '/document-edit-batches/' + encodeURIComponent(batchId) + '/release'),
      options.payload || {}
    );
    return responseData(response);
  }

  // =========================================================================
  // Release byte helpers
  // =========================================================================

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      var chunk = bytes.subarray(i, i + 0x8000);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function bytesToUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function hasDocxZipEnvelope(bytes) {
    if (!bytes || bytes.length < 22) return false;
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
    var min = Math.max(0, bytes.length - 65557);
    for (var i = bytes.length - 22; i >= min; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        return true;
      }
    }
    return false;
  }

  var DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function releaseFilenameFor(filename) {
    var name = filename || 'released-document.docx';
    if (/\.docx$/i.test(name)) return name.replace(/\.docx$/i, ' - released.docx');
    var match = /^(.+?)(\.[^.]+)$/.exec(name);
    if (match) return match[1] + ' - released' + match[2];
    return name + ' - released';
  }

  /**
   * Build the release payload for edited document bytes. DOCX bytes must be a
   * valid ZIP package; text-like content is sent as UTF-8 text.
   */
  function buildReleasePayload(options) {
    var contentType = options.contentType || DOCX_CONTENT_TYPE;
    var bytes = options.bytes;
    var releaseNotes = options.releaseNotes || 'Released from LANA review workflow.';
    if (contentType === DOCX_CONTENT_TYPE && !hasDocxZipEnvelope(bytes)) {
      throw new Error('The editor did not return a valid Word document package. Reload the document and try again.');
    }
    var payload = {
      approved: false,
      filename: options.releaseFilename || releaseFilenameFor(options.filename),
      content_type: contentType,
      release_notes: releaseNotes
    };
    if (contentType.indexOf('text/') === 0 || contentType === 'text/markdown') {
      payload.content_text = bytesToUtf8(bytes);
    } else {
      payload.content_base64 = bytesToBase64(bytes);
    }
    return payload;
  }

  /**
   * Ask the editor service for a copy of the DOCX with every tracked change
   * accepted, so the released artifact is clean. Non-DOCX bytes pass through.
   */
  async function acceptAllBytes(options) {
    var bytes = options.bytes;
    var contentType = options.contentType || DOCX_CONTENT_TYPE;
    if (contentType !== DOCX_CONTENT_TYPE) return bytes;
    if (!hasDocxZipEnvelope(bytes)) {
      throw new Error('The editor did not return a valid Word document package. Reload the document and try again.');
    }
    var response = await fetch(String(options.editorServiceBase || '').replace(/\/+$/, '') + '/v1/redline/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docxBase64: bytesToBase64(bytes),
        mode: 'accept_all'
      })
    });
    if (!response.ok) {
      throw new Error('Failed to prepare clean release document');
    }
    var buffer = await response.arrayBuffer();
    var acceptedBytes = new Uint8Array(buffer);
    if (!hasDocxZipEnvelope(acceptedBytes)) {
      throw new Error('The editor did not return a valid Word document package. Reload the document and try again.');
    }
    return acceptedBytes;
  }

  // =========================================================================
  // Dates
  // =========================================================================

  /**
   * The moment the document lineage last changed: the newest of the document
   * record's dates and the active draft batch's dates. Returns '' when none
   * parse.
   */
  function latestActivityIso(document, batch) {
    var candidates = [
      document && document.updated_at,
      document && document.created_at,
      batch && batch.updated_at,
      batch && batch.created_at
    ];
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      var time = Date.parse(candidates[i]);
      if (!Number.isFinite(time)) continue;
      if (best === null || time > best) best = time;
    }
    return best === null ? '' : new Date(best).toISOString();
  }

  var api = {
    explicitSourceDocumentId: explicitSourceDocumentId,
    isReleasedArtifact: isReleasedArtifact,
    matterEndpoint: matterEndpoint,
    reviewItemText: reviewItemText,
    reviewChangeOperation: reviewChangeOperation,
    isDeletionChange: isDeletionChange,
    isInsertionChange: isInsertionChange,
    isFormattingChange: isFormattingChange,
    formatValueText: formatValueText,
    formatSummary: formatSummary,
    formatChangeDetailsFromRevision: formatChangeDetailsFromRevision,
    changeOriginalText: changeOriginalText,
    changeProposedText: changeProposedText,
    changeLabel: changeLabel,
    changeStatus: changeStatus,
    sourceChangesForReviewChange: sourceChangesForReviewChange,
    editScriptKeyForChange: editScriptKeyForChange,
    editScriptGroupIdForChange: editScriptGroupIdForChange,
    reviewChangeIdentityKey: reviewChangeIdentityKey,
    sameReviewChangeMoment: sameReviewChangeMoment,
    editScriptOpsForReviewChange: editScriptOpsForReviewChange,
    mergeReviewChangeRun: mergeReviewChangeRun,
    adjacentDeletionFragmentRun: adjacentDeletionFragmentRun,
    adjacentIdentityRun: adjacentIdentityRun,
    displayReviewChanges: displayReviewChanges,
    revisionIdsForReviewChange: revisionIdsForReviewChange,
    liveRevisionChangesForChange: liveRevisionChangesForChange,
    editableOpsForChange: editableOpsForChange,
    isReplacementReviewChange: isReplacementReviewChange,
    firstEditableDraftOpForChange: firstEditableDraftOpForChange,
    canEditDraftReviewChange: canEditDraftReviewChange,
    inverseEditOpsForReleasedChange: inverseEditOpsForReleasedChange,
    dedupeEditOps: dedupeEditOps,
    editOpsFromBatch: editOpsFromBatch,
    replayOrderedBatchChanges: replayOrderedBatchChanges,
    editScriptsFromBatch: editScriptsFromBatch,
    reviewRevisionKey: reviewRevisionKey,
    rawReviewRevisions: rawReviewRevisions,
    changesFromRevisions: changesFromRevisions,
    persistableReviewChange: persistableReviewChange,
    persistedDraftChangePayload: persistedDraftChangePayload,
    createReviewSession: createReviewSession,
    isActiveDraftBatch: isActiveDraftBatch,
    activeDraftBatchFromList: activeDraftBatchFromList,
    activeDraftBatchForBaseVersion: activeDraftBatchForBaseVersion,
    pendingReleaseBatchFromList: pendingReleaseBatchFromList,
    draftBaseDocumentId: draftBaseDocumentId,
    previousReleaseDocumentId: previousReleaseDocumentId,
    hydrateBatchDetail: hydrateBatchDetail,
    loadReleaseLineage: loadReleaseLineage,
    loadWorkflow: loadWorkflow,
    loadReleaseChangeGroups: loadReleaseChangeGroups,
    saveDraftBatch: saveDraftBatch,
    releaseBatch: releaseBatch,
    bytesToBase64: bytesToBase64,
    bytesToUtf8: bytesToUtf8,
    hasDocxZipEnvelope: hasDocxZipEnvelope,
    releaseFilenameFor: releaseFilenameFor,
    buildReleasePayload: buildReleasePayload,
    acceptAllBytes: acceptAllBytes,
    latestActivityIso: latestActivityIso,
    DOCX_CONTENT_TYPE: DOCX_CONTENT_TYPE
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaDocumentReview = api;
})(typeof window !== 'undefined' ? window : globalThis);

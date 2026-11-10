/**
 * LANA redline review panel (File Viewer, "Redlines" tab).
 *
 * Shows the redlines the Document Reviewer agent proposed on a document, as
 * Chef reports them (/matters/:m/documents/:d/redline-batches): each change
 * with accept and reject, every redline that could not be placed in the
 * document (with the reason, so nothing is silently dropped), and releasing
 * the accepted version. Chef records every decision and builds every copy;
 * this module renders and calls it through LanaDocumentReview.
 *
 * The view-model functions are plain and tested directly
 * (tests/unit/redline-review-panel.test.js); createController wires them to a
 * container element.
 */
(function (global) {
  'use strict';

  var review = global.LanaDocumentReview ||
    (typeof require === 'function' ? require('./services/document-review-api.service.js') : null);

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // =========================================================================
  // View model
  // =========================================================================

  var UNPLACED_HEADING = 'Could not place in the document';

  var UNPLACED_REASONS = {
    not_found: 'The quoted text was not found in the document.',
    spans_paragraphs: 'The quoted text runs across more than one paragraph.',
    overlaps_another_redline: 'It overlaps another suggested change.',
    no_change: 'The suggested wording is the same as the current text.',
    missing_current_text: 'The suggestion did not quote the text it changes.',
    missing_proposed_text: 'The suggestion has no new wording.',
    document_has_pending_revisions: 'The document already has tracked changes. Accept or reject them, then run the review again.',
    no_target_document: 'The suggestion did not name a document.',
    matter_not_found: 'The workspace for this suggestion was not found.',
    document_not_found: 'The document for this suggestion was not found.',
    document_not_accessible: 'The person who ran the review cannot open this document.',
    document_not_docx: 'Only Word documents can take tracked changes.',
    document_unreadable: 'The document could not be read.',
    editor_unavailable: 'Redline review is not available on this server yet.',
    editor_rejected_document: 'The document editor could not read this document.',
    editor_rejected_script: 'The document editor could not apply this change.',
    proposal_failed: 'The change could not be saved for review.'
  };

  /** Why a redline could not be placed, as a sentence. */
  function unplacedReasonText(entry) {
    var reason = String(entry && entry.reason || '');
    if (reason === 'ambiguous') {
      var count = Array.isArray(entry.occurrences) ? entry.occurrences.length : 0;
      return count > 1
        ? 'The quoted text appears in ' + count + ' places, so LANA did not guess which one.'
        : 'The quoted text appears in more than one place, so LANA did not guess which one.';
    }
    return UNPLACED_REASONS[reason] || 'It could not be placed in the document.';
  }

  /** Every redline of a batch that has no place in the document, labelled. */
  function unplacedRedlines(batch) {
    var list = batch && Array.isArray(batch.unanchored_redlines) ? batch.unanchored_redlines : [];
    return list.filter(Boolean).map(function (entry, index) {
      return {
        key: String(entry.artifact_id || entry.key || 'unplaced-' + index),
        title: entry.clause_label || 'Suggested change',
        currentText: entry.current_text || entry.quote || '',
        proposedText: entry.proposed_text || '',
        rationale: entry.rationale || '',
        reason: String(entry.reason || ''),
        reasonText: unplacedReasonText(entry)
      };
    });
  }

  var BATCH_STATUS = {
    draft: { label: 'Open', tone: 'pending' },
    proposed: { label: 'Open', tone: 'pending' },
    pending_release: { label: 'Waiting for approval', tone: 'pending' },
    released: { label: 'Released', tone: 'released' },
    rejected: { label: 'Rejected', tone: 'rejected' },
    cancelled: { label: 'Cancelled', tone: 'rejected' }
  };

  var CHANGE_STATUS = {
    proposed: { label: 'Pending', tone: 'pending' },
    accepted: { label: 'Accepted', tone: 'accepted' },
    rejected: { label: 'Rejected', tone: 'rejected' }
  };

  function isOpenBatch(batch) {
    var status = String(batch && batch.status || '');
    return status === 'draft' || status === 'proposed';
  }

  function changeRows(batch) {
    var open = isOpenBatch(batch);
    var changes = batch && Array.isArray(batch.changes) ? batch.changes : [];
    return changes.filter(Boolean).map(function (change) {
      var status = String(change.status || 'proposed');
      return {
        id: String(change.id),
        title: change.clause_label || 'Suggested change',
        originalText: change.original_text || '',
        proposedText: change.proposed_text || '',
        rationale: change.rationale || '',
        severity: change.severity || '',
        status: status,
        statusLabel: (CHANGE_STATUS[status] || CHANGE_STATUS.proposed).label,
        tone: (CHANGE_STATUS[status] || CHANGE_STATUS.proposed).tone,
        decidedBy: change.decided_by_name || '',
        canDecide: open && status === 'proposed'
      };
    });
  }

  /** The release state of a batch: whether it can be released now, and if not, why. */
  function releaseState(batch) {
    var rows = changeRows(batch);
    var status = String(batch && batch.status || '');
    if (status === 'released') return { canRelease: false, hint: '' };
    if (status === 'pending_release') {
      return { canRelease: false, waiting: true, hint: 'A release of these changes is waiting for approval. The new version appears once it is approved.' };
    }
    if (!isOpenBatch(batch)) return { canRelease: false, hint: '' };
    var undecided = rows.filter(function (row) { return row.status === 'proposed'; }).length;
    if (undecided) {
      return { canRelease: false, hint: 'Accept or reject every change to release a new version (' + undecided + ' left).' };
    }
    if (!rows.some(function (row) { return row.status === 'accepted'; })) {
      return { canRelease: false, hint: 'No change was accepted, so there is no new version to release.' };
    }
    return { canRelease: true, hint: '' };
  }

  function batchSummary(batch) {
    var status = BATCH_STATUS[String(batch && batch.status || '')] || BATCH_STATUS.proposed;
    var rows = changeRows(batch);
    var decided = rows.filter(function (row) { return row.status !== 'proposed'; }).length;
    var unplaced = unplacedRedlines(batch).length;
    var counts = rows.length + (rows.length === 1 ? ' change' : ' changes') +
      (rows.length ? ', ' + decided + ' decided' : '') +
      (unplaced ? ', ' + unplaced + ' not placed' : '');
    return {
      id: String(batch && batch.id || ''),
      title: (batch && batch.title) || 'LANA redlines',
      summary: (batch && batch.summary) || '',
      statusLabel: status.label,
      tone: status.tone,
      counts: counts,
      releasedDocumentId: batch && batch.released_document_id ? String(batch.released_document_id) : ''
    };
  }

  /** Open batches first, then the rest, newest first within each. */
  function orderBatches(batches) {
    return (Array.isArray(batches) ? batches.slice() : []).filter(Boolean).sort(function (a, b) {
      var openA = isOpenBatch(a) || a.status === 'pending_release' ? 0 : 1;
      var openB = isOpenBatch(b) || b.status === 'pending_release' ? 0 : 1;
      if (openA !== openB) return openA - openB;
      return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
    });
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  function statusBadge(label, tone) {
    return '<span class="redline-review__status redline-review__status--' + escapeHtml(tone) + '">' + escapeHtml(label) + '</span>';
  }

  function renderDiff(original, proposed) {
    var lines = '';
    if (original) {
      lines += '<span class="redline-review__diff-line redline-review__diff-line--removed">' +
        '<span class="redline-review__diff-mark" aria-hidden="true">-</span><span>' + escapeHtml(original) + '</span></span>';
    }
    if (proposed) {
      lines += '<span class="redline-review__diff-line redline-review__diff-line--added">' +
        '<span class="redline-review__diff-mark" aria-hidden="true">+</span><span>' + escapeHtml(proposed) + '</span></span>';
    }
    return lines ? '<span class="redline-review__diff">' + lines + '</span>' : '';
  }

  function renderChange(row, busy) {
    var actions = row.canDecide
      ? '<div class="redline-review__change-actions">' +
          '<lex-btn size="sm" variant="secondary" data-redline-decide="reject" data-redline-change="' + escapeHtml(row.id) + '"' + (busy ? ' disabled' : '') + '>Reject</lex-btn>' +
          '<lex-btn size="sm" variant="success" data-redline-decide="accept" data-redline-change="' + escapeHtml(row.id) + '"' + (busy ? ' disabled' : '') + '>Accept</lex-btn>' +
        '</div>'
      : (row.decidedBy ? '<p class="redline-review__decided">' + escapeHtml(row.statusLabel + ' by ' + row.decidedBy) + '</p>' : '');
    return '<li class="redline-review__change" data-redline-change-row="' + escapeHtml(row.id) + '">' +
      '<div class="redline-review__change-head">' +
        '<span class="redline-review__change-title">' + escapeHtml(row.title) + '</span>' +
        statusBadge(row.statusLabel, row.tone) +
      '</div>' +
      renderDiff(row.originalText, row.proposedText) +
      (row.rationale ? '<p class="redline-review__rationale">' + escapeHtml(row.rationale) + '</p>' : '') +
      actions +
    '</li>';
  }

  function renderUnplaced(items) {
    if (!items.length) return '';
    return '<section class="redline-review__unplaced" aria-label="' + escapeHtml(UNPLACED_HEADING) + '">' +
      '<h6 class="redline-review__unplaced-heading">' + escapeHtml(UNPLACED_HEADING) + ' (' + items.length + ')</h6>' +
      '<ul class="redline-review__unplaced-list">' + items.map(function (item) {
        return '<li class="redline-review__unplaced-item" data-redline-unplaced="' + escapeHtml(item.key) + '">' +
          '<span class="redline-review__change-title">' + escapeHtml(item.title) + '</span>' +
          '<p class="redline-review__reason">' + escapeHtml(item.reasonText) + '</p>' +
          renderDiff(item.currentText, item.proposedText) +
          (item.rationale ? '<p class="redline-review__rationale">' + escapeHtml(item.rationale) + '</p>' : '') +
        '</li>';
      }).join('') + '</ul>' +
    '</section>';
  }

  function renderNotice(notice) {
    if (!notice || !notice.text) return '';
    return '<p class="redline-review__notice redline-review__notice--' + escapeHtml(notice.tone || 'info') + '" role="' +
      (notice.tone === 'error' ? 'alert' : 'status') + '">' + escapeHtml(notice.text) + '</p>';
  }

  function renderBatch(batch, ui) {
    ui = ui || {};
    var summary = batchSummary(batch);
    var rows = changeRows(batch);
    var release = releaseState(batch);
    var busy = Boolean(ui.busy);
    var footer = '';
    if (summary.releasedDocumentId) {
      footer = '<lex-btn size="sm" variant="secondary" data-redline-open-document="' + escapeHtml(summary.releasedDocumentId) + '">Open released version</lex-btn>';
    } else if (isOpenBatch(batch) || release.waiting) {
      footer = '<lex-btn size="sm" variant="primary" data-redline-release="' + escapeHtml(summary.id) + '"' +
        (release.canRelease && !busy ? '' : ' disabled') + '>Release accepted version</lex-btn>';
    }
    return '<article class="redline-review__batch" data-redline-batch="' + escapeHtml(summary.id) + '">' +
      '<header class="redline-review__batch-head">' +
        '<div class="redline-review__batch-title-row">' +
          '<h5 class="redline-review__batch-title">' + escapeHtml(summary.title) + '</h5>' +
          statusBadge(summary.statusLabel, summary.tone) +
        '</div>' +
        '<p class="redline-review__counts">' + escapeHtml(summary.counts) + '</p>' +
        (summary.summary ? '<p class="redline-review__summary">' + escapeHtml(summary.summary) + '</p>' : '') +
      '</header>' +
      renderNotice(ui.notice) +
      (rows.length ? '<ul class="redline-review__changes">' + rows.map(function (row) { return renderChange(row, busy); }).join('') + '</ul>' : '') +
      renderUnplaced(unplacedRedlines(batch)) +
      '<footer class="redline-review__batch-foot">' +
        (release.hint ? '<p class="redline-review__hint">' + escapeHtml(release.hint) + '</p>' : '') +
        '<div class="redline-review__batch-actions">' +
          '<lex-btn size="sm" variant="ghost" data-redline-download="' + escapeHtml(summary.id) + '"' + (busy ? ' disabled' : '') + '>Download redlined copy</lex-btn>' +
          footer +
        '</div>' +
      '</footer>' +
    '</article>';
  }

  /**
   * The whole panel.
   * @param {{loading?: boolean, error?: string, batches?: Array, ui?: Object}} model
   */
  function renderPanel(model) {
    model = model || {};
    if (model.loading) return '<p class="redline-review__empty">Loading LANA redlines...</p>';
    var parts = [];
    if (model.error) parts.push(renderNotice({ tone: 'error', text: model.error }));
    var batches = orderBatches(model.batches);
    if (!batches.length && !model.error) {
      parts.push('<div class="redline-review__empty"><h5>No redlines</h5>' +
        '<p>When the Document Reviewer agent suggests changes to this document, they appear here to accept or reject.</p></div>');
    }
    var ui = model.ui || {};
    batches.forEach(function (batch) { parts.push(renderBatch(batch, ui[String(batch.id)])); });
    return '<div class="redline-review">' + parts.join('') + '</div>';
  }

  // =========================================================================
  // Controller
  // =========================================================================

  /**
   * @param {Object} options
   * @param {HTMLElement} options.container
   * @param {Object} options.api - the authenticated API client (window.api)
   * @param {string} options.matterId
   * @param {string} options.documentId
   * @param {string} [options.filename]
   * @param {function(string, string)} [options.notify] - (message, type)
   * @param {function(string)} [options.openDocument] - open a released version by id
   * @param {function(Uint8Array, string)} [options.saveFile] - (bytes, filename)
   */
  function createController(options) {
    var state = { loading: false, error: '', batches: [], ui: {} };
    var container = options.container;
    var call = { api: options.api, matterId: options.matterId, documentId: options.documentId };

    function render() {
      if (container) container.innerHTML = renderPanel(state);
    }

    function uiFor(batchId) {
      var key = String(batchId);
      if (!state.ui[key]) state.ui[key] = {};
      return state.ui[key];
    }

    function replaceBatch(next) {
      if (!next || !next.id) return;
      var found = false;
      state.batches = state.batches.map(function (batch) {
        if (String(batch.id) !== String(next.id)) return batch;
        found = true;
        return next;
      });
      if (!found) state.batches.push(next);
    }

    async function load() {
      state.loading = true;
      state.error = '';
      render();
      try {
        var result = await review.listRedlineBatches(Object.assign({ limit: 20 }, call));
        state.batches = result.data;
      } catch (error) {
        state.batches = [];
        state.error = error.message;
      } finally {
        state.loading = false;
        render();
      }
      return state.batches;
    }

    async function refreshBatch(batchId) {
      try {
        replaceBatch(await review.getRedlineBatch(Object.assign({ batchId: batchId }, call)));
      } catch (_) {
        // The decision error already says what happened; keep what is shown.
      }
    }

    async function decide(batchId, changeId, action) {
      var ui = uiFor(batchId);
      ui.busy = true;
      ui.notice = null;
      render();
      try {
        var result = await review.decideRedlineChanges(Object.assign({
          batchId: batchId,
          decisions: [{ change_id: changeId, action: action }]
        }, call));
        replaceBatch(result.batch);
        if (result.unchanged.indexOf(String(changeId)) !== -1) {
          ui.notice = { tone: 'info', text: 'That decision was already recorded.' };
        }
        return result;
      } catch (error) {
        ui.notice = { tone: 'error', text: error.message };
        if (error.code === 'REDLINE_CHANGE_ALREADY_DECIDED' || error.code === 'REDLINE_CONFLICT') {
          await refreshBatch(batchId);
        }
        return null;
      } finally {
        ui.busy = false;
        render();
      }
    }

    async function release(batchId) {
      var ui = uiFor(batchId);
      var batch = state.batches.find(function (item) { return String(item.id) === String(batchId); });
      ui.busy = true;
      ui.notice = null;
      render();
      try {
        var result = await review.releaseRedlineBatch(Object.assign({
          batchId: batchId,
          retryApproval: Boolean(batch && batch.status === 'pending_release')
        }, call));
        if (result.outcome === 'approval_required') {
          if (result.batch) replaceBatch(result.batch);
          else if (batch) replaceBatch(Object.assign({}, batch, { status: 'pending_release' }));
          ui.notice = { tone: 'info', text: 'This release needs approval. It was sent for approval, and the new version appears once it is approved.' };
        } else {
          var documentId = result.document && result.document.id ? String(result.document.id) : '';
          if (batch) replaceBatch(Object.assign({}, batch, { status: 'released', released_document_id: documentId || batch.released_document_id }));
          ui.notice = { tone: 'success', text: 'Released as a new version.' };
          if (options.notify) options.notify('Released as a new version.', 'success');
        }
        return result;
      } catch (error) {
        ui.notice = { tone: 'error', text: error.message };
        return null;
      } finally {
        ui.busy = false;
        render();
      }
    }

    async function download(batchId) {
      var ui = uiFor(batchId);
      try {
        var copy = await review.fetchRedlineDocument(Object.assign({ batchId: batchId, view: 'redline' }, call));
        var name = String(options.filename || 'document.docx').replace(/\.docx$/i, '') + ' (redlined).docx';
        if (options.saveFile) options.saveFile(copy.bytes, name);
        return copy;
      } catch (error) {
        ui.notice = { tone: 'error', text: error.message };
        render();
        return null;
      }
    }

    function handleClick(event) {
      var target = event && event.target && typeof event.target.closest === 'function' ? event.target : null;
      if (!target) return;
      var decideEl = target.closest('[data-redline-decide]');
      var batchEl = target.closest('[data-redline-batch]');
      var batchId = batchEl ? batchEl.getAttribute('data-redline-batch') : '';
      if (decideEl && batchId && !decideEl.hasAttribute('disabled')) {
        decide(batchId, decideEl.getAttribute('data-redline-change'), decideEl.getAttribute('data-redline-decide'));
        return;
      }
      var releaseEl = target.closest('[data-redline-release]');
      if (releaseEl && !releaseEl.hasAttribute('disabled')) {
        release(releaseEl.getAttribute('data-redline-release'));
        return;
      }
      var downloadEl = target.closest('[data-redline-download]');
      if (downloadEl && !downloadEl.hasAttribute('disabled')) {
        download(downloadEl.getAttribute('data-redline-download'));
        return;
      }
      var openEl = target.closest('[data-redline-open-document]');
      if (openEl && options.openDocument) options.openDocument(openEl.getAttribute('data-redline-open-document'));
    }

    if (container && typeof container.addEventListener === 'function') {
      container.addEventListener('click', handleClick);
    }

    return {
      load: load,
      decide: decide,
      release: release,
      download: download,
      handleClick: handleClick,
      state: state,
      destroy: function () {
        if (container && typeof container.removeEventListener === 'function') {
          container.removeEventListener('click', handleClick);
        }
      }
    };
  }

  var panel = {
    UNPLACED_HEADING: UNPLACED_HEADING,
    unplacedReasonText: unplacedReasonText,
    unplacedRedlines: unplacedRedlines,
    changeRows: changeRows,
    releaseState: releaseState,
    batchSummary: batchSummary,
    orderBatches: orderBatches,
    renderPanel: renderPanel,
    createController: createController
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = panel;
  global.LanaRedlineReviewPanel = panel;
})(typeof window !== 'undefined' ? window : globalThis);

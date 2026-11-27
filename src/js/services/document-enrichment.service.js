/**
 * Document enrichment panel datasource for the File Viewer.
 *
 * Pure functions (view model, HTML) plus thin API wrappers, so the panel's
 * logic is testable in Node without the page. The server owns every decision
 * (what a document is, what it names, what to suggest); this module only
 * arranges the server's answer and sends a reviewer's accept or dismiss back.
 *
 * Endpoints (chef, mounted under /api/v1/matters):
 *   GET  /:matter_id/documents/:document_id/enrichment
 *   POST /:matter_id/documents/:document_id/enrichment/suggestions/:id/accept
 *   POST /:matter_id/documents/:document_id/enrichment/suggestions/:id/dismiss
 *   POST /:matter_id/documents/:document_id/enrichment/rerun
 */
(function (global) {
  'use strict';

  var TARGET_LABELS = { contact: 'Contact', party: 'Party', deadline: 'Deadline', fee: 'Fee', payment: 'Payment step', engagement_signed: 'Signed' };
  var TARGET_VERBS = { contact: 'Add contact', party: 'Add party', deadline: 'Add deadline', fee: 'Save fee', payment: 'Save payment step', engagement_signed: 'Mark signed' };

  // ── Signed engagement letter review (fee, payment, engagement_signed) ──
  // The server decides which documents get these; the reads of its fields
  // live here so a rename is one change.
  var REVIEW_GROUPS = { fee: 'Fees', payment: 'Payment steps', engagement_signed: 'Engagement signed' };
  var FEE_FIELD_LABELS = {
    total_fee: 'Total fee', co_counsel_fee: 'Co-counsel fee', maintenance_fee: 'Maintenance fee per year',
    initial_maintenance_year: 'First maintenance year', plan_type: 'Plan type'
  };
  var PAYMENT_LABELS = { deposit: 'Deposit', payment_2: 'Payment 2', payment_3: 'Payment 3', final: 'Final payment' };
  // source.kind: where the value came from. read_from_document shows the
  // quote and confidence instead.
  var SOURCE_NOTES = {
    matches_draft: 'Matches the draft letter',
    from_draft_not_read: 'From the draft; not found in the signed copy'
  };
  var SOURCE_WARNINGS = { from_draft_not_read: true };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOT = ' \u00b7 ';
  var ENTITY_LABELS = {
    person: 'People', organization: 'Organisations', date: 'Dates', amount: 'Amounts',
    place: 'Places', phone: 'Phone numbers', email: 'Emails'
  };
  var CALLOUT_LABELS = {
    deadline: 'Deadlines', obligation: 'Obligations', amount_due: 'Amounts due', party_role: 'Parties and roles', risk: 'Risks'
  };
  var STATUS_LABELS = {
    queued: 'Queued', running: 'Reading', completed: 'Complete', partial: 'Partly complete',
    failed: 'Failed', skipped: 'No text to read'
  };

  function escapeHtml(value) {
    // Delegate to the canonical Lex.Utils escaper when it is loaded (every
    // real page load); this module is also require()'d directly in tests
    // with no window/Lex set up, so it keeps this local fallback for that
    // path (a typeof guard, never a bare window reference, so it stays safe
    // to run in Node).
    if (typeof Lex !== 'undefined' && Lex.Utils && typeof Lex.Utils.escapeHtml === 'function') {
      return Lex.Utils.escapeHtml(value);
    }
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function humanize(value) {
    var text = String(value || '').replace(/_/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  /** Display bucket for a confidence between 0 and 1. Presentation only. */
  function confidenceLabel(confidence) {
    var value = Number(confidence);
    if (!Number.isFinite(value)) return '';
    if (value >= 0.8) return 'High confidence';
    if (value >= 0.5) return 'Medium confidence';
    return 'Low confidence';
  }

  function enrichmentEndpoint(matterId, documentId, suffix) {
    return '/api/v1/matters/' + encodeURIComponent(matterId || 'unassigned') +
      '/documents/' + encodeURIComponent(documentId) + '/enrichment' + (suffix || '');
  }

  function formatMoney(amount) {
    if (!amount || !Number.isFinite(Number(amount.value))) return '';
    var value = Number(amount.value);
    var currency = amount.currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(value);
    } catch (_) {
      return currency + ' ' + value.toFixed(2);
    }
  }

  /** One line describing what accepting a suggestion would create. */
  function suggestionTitle(suggestion) {
    var proposed = (suggestion && suggestion.proposed) || {};
    if (suggestion.target_kind === 'contact') {
      return proposed.displayName || proposed.companyName || [proposed.firstName, proposed.lastName].filter(Boolean).join(' ') || proposed.lastName || 'Contact';
    }
    if (suggestion.target_kind === 'party') {
      return proposed.party_name + (proposed.party_role ? ' (' + proposed.party_role + ')' : '');
    }
    if (suggestion.target_kind === 'deadline') {
      var day = String(proposed.start_time || '').slice(0, 10);
      return (proposed.title || 'Deadline') + (day ? ', ' + day : '');
    }
    return 'Suggestion';
  }

  function suggestionDetail(suggestion) {
    var proposed = (suggestion && suggestion.proposed) || {};
    if (suggestion.target_kind === 'contact') {
      return [proposed.title, proposed.email, proposed.phone].filter(Boolean).join(' · ');
    }
    if (suggestion.target_kind === 'party') {
      return [humanize(proposed.party_type), proposed.party_organization].filter(Boolean).join(' · ');
    }
    if (suggestion.target_kind === 'deadline') {
      return proposed.description || '';
    }
    return '';
  }

  // "2026-12-01" reads "Dec 1, 2026"; anything else as sent.
  function formatDay(value) {
    var text = String(value || '').slice(0, 10);
    var parts = text.split('-');
    if (parts.length !== 3) return String(value || '');
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31) || !Number.isFinite(Number(parts[0]))) return String(value || '');
    return MONTHS[month - 1] + ' ' + day + ', ' + parts[0];
  }

  function proposedOf(suggestion) {
    return (suggestion && suggestion.proposed) || suggestion || {};
  }

  function present(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function firmCurrency() {
    if (typeof Lex !== 'undefined' && Lex.Utils && typeof Lex.Utils.getFirmCurrency === 'function') {
      var code = Lex.Utils.getFirmCurrency();
      if (code) return String(code);
    }
    return 'USD';
  }

  // A fee or payment amount in the firm's currency: "$4,500", with cents
  // only when the amount has them ("$4,500.50").
  function reviewMoney(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    var digits = Math.round(n * 100) % 100 === 0 ? 0 : 2;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: firmCurrency(), minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
    } catch (_) {
      return firmCurrency() + ' ' + n.toFixed(digits);
    }
  }

  function valueText(value, format) {
    if (!present(value)) return '';
    if (format === 'currency') return reviewMoney(value);
    if (format === 'date') return formatDay(value);
    if (format === 'number' && Number.isFinite(Number(value))) return String(Number(value));
    return String(value);
  }

  function paymentText(amount, dueDate, basis, estimated) {
    var due = present(dueDate) ? 'Due ' + formatDay(dueDate) : (present(basis) ? 'Due ' + humanize(basis).toLowerCase() : '');
    return [valueText(amount, 'currency'), due, estimated ? 'Estimated' : ''].filter(Boolean).join(DOT);
  }

  function editorValue(value) {
    return present(value) ? String(value) : '';
  }

  /** Title, detail and inline editors for a fee, payment step or signing. */
  function reviewFields(suggestion) {
    var p = proposedOf(suggestion);
    var kind = suggestion.target_kind;
    if (kind === 'fee') {
      var format = p.format === 'currency' || p.format === 'number' ? p.format : 'text';
      var label = FEE_FIELD_LABELS[p.field] || humanize(p.field) || 'Fee';
      return { title: label, detail: valueText(p.value, format), editors: [{ name: 'value', label: label, format: format, value: editorValue(p.value) }] };
    }
    if (kind === 'payment') {
      return {
        title: PAYMENT_LABELS[p.payment_type] || humanize(p.payment_type) || 'Payment step',
        detail: paymentText(p.amount, p.due_date, p.due_date_basis, p.estimated === true),
        editors: [{ name: 'amount', label: 'Amount', format: 'currency', value: editorValue(p.amount) },
          { name: 'due_date', label: 'Due date', format: 'date', value: editorValue(p.due_date ? String(p.due_date).slice(0, 10) : '') }]
      };
    }
    if (kind === 'engagement_signed') {
      return { title: 'Engagement signed', detail: present(p.signed_on) ? 'Signed ' + formatDay(p.signed_on) : '',
        editors: [{ name: 'signed_on', label: 'Signed on', format: 'date', value: editorValue(p.signed_on ? String(p.signed_on).slice(0, 10) : '') }] };
    }
    return null;
  }

  function groupBy(items, key, labels) {
    var order = Object.keys(labels);
    var groups = {};
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var kind = item && item[key];
      if (!groups[kind]) groups[kind] = [];
      groups[kind].push(item);
    });
    return order.filter(function (kind) { return groups[kind]; }).map(function (kind) {
      return { kind: kind, label: labels[kind], items: groups[kind] };
    });
  }

  /**
   * The panel's view model from the server payload
   * ({ enabled, enrichment, suggestions }).
   */
  function viewModel(payload) {
    var data = payload || {};
    var enrichment = data.enrichment || null;
    var suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    if (!enrichment) {
      return { enabled: data.enabled !== false, available: false, status: null, suggestions: { open: [], decided: [] } };
    }
    var classification = enrichment.classification || null;
    var open = [];
    var decided = [];
    suggestions.forEach(function (suggestion) {
      var review = REVIEW_GROUPS[suggestion.target_kind] ? reviewFields(suggestion) : null;
      var sourceKind = suggestion.source && suggestion.source.kind ? String(suggestion.source.kind) : '';
      var row = {
        id: suggestion.id,
        targetKind: suggestion.target_kind,
        targetLabel: TARGET_LABELS[suggestion.target_kind] || humanize(suggestion.target_kind),
        verb: TARGET_VERBS[suggestion.target_kind] || 'Accept',
        status: suggestion.status,
        title: suggestionTitle(suggestion),
        detail: suggestionDetail(suggestion),
        evidence: suggestion.evidence && suggestion.evidence.quote ? suggestion.evidence.quote : '',
        confidence: confidenceLabel(suggestion.source && suggestion.source.confidence),
        dismissReason: suggestion.dismiss_reason || '',
        createdRecordType: suggestion.created_record_type || '',
        reviewGroup: review ? suggestion.target_kind : '',
        sourceNote: review ? (SOURCE_NOTES[sourceKind] || '') : '',
        sourceWarning: !!(review && SOURCE_WARNINGS[sourceKind]),
        editors: review ? review.editors : []
      };
      if (review) {
        row.title = review.title;
        row.detail = review.detail;
        // Only a value read from the signed copy shows its quote and confidence.
        if (row.sourceNote) { row.evidence = ''; row.confidence = ''; }
      }
      (suggestion.status === 'suggested' ? open : decided).push(row);
    });
    return {
      enabled: data.enabled !== false,
      available: true,
      id: enrichment.id,
      status: enrichment.status,
      statusLabel: STATUS_LABELS[enrichment.status] || humanize(enrichment.status),
      truncated: enrichment.text_truncated === true,
      completedAt: enrichment.completed_at || enrichment.updated_at || null,
      classification: classification ? {
        label: classification.abstained || classification.document_type === 'unknown' ? 'Type not determined' : humanize(classification.document_type),
        abstained: Boolean(classification.abstained || classification.document_type === 'unknown'),
        confidence: confidenceLabel(classification.confidence),
        purpose: classification.purpose || ''
      } : null,
      summary: enrichment.summary || '',
      callouts: groupBy(enrichment.callouts, 'kind', CALLOUT_LABELS).map(function (group) {
        group.items = group.items.map(function (callout) {
          return {
            title: callout.title,
            detail: callout.detail || '',
            when: callout.when || '',
            amount: formatMoney(callout.amount),
            party: callout.party ? callout.party.name + (callout.party.role ? ' (' + callout.party.role + ')' : '') : '',
            evidence: callout.evidence && callout.evidence.quote ? callout.evidence.quote : '',
            confidence: confidenceLabel(callout.confidence)
          };
        });
        return group;
      }),
      entities: groupBy(enrichment.entities, 'kind', ENTITY_LABELS).map(function (group) {
        group.items = group.items.map(function (entity) {
          return { text: entity.normalized || entity.text, role: entity.role || '', evidence: entity.evidence && entity.evidence.quote ? entity.evidence.quote : '' };
        });
        return group;
      }),
      dropped: Array.isArray(enrichment.dropped) ? enrichment.dropped.length : 0,
      sections: enrichment.sections || {},
      suggestions: { open: open, decided: decided }
    };
  }

  function renderEvidence(quote) {
    return quote ? '<blockquote class="file-viewer-insights__evidence">' + escapeHtml(quote) + '</blockquote>' : '';
  }

  var INPUT_TYPES = { currency: 'number', number: 'number', date: 'date', text: 'text' };

  function renderEditors(row) {
    if (!row.editors || !row.editors.length) return '';
    return '<div class="file-viewer-insights__editors">' + row.editors.map(function (editor) {
      return '<lex-input size="sm" label="' + escapeHtml(editor.label) + '" type="' + (INPUT_TYPES[editor.format] || 'text') + '"' +
        ' data-enrichment-override="' + escapeHtml(editor.name) + '" data-override-format="' + escapeHtml(editor.format) + '"' +
        ' value="' + escapeHtml(editor.value) + '"></lex-input>';
    }).join('') + '</div>';
  }

  function renderConflict(row, conflict) {
    return '<div class="file-viewer-insights__conflict" role="alert">' +
      '<p class="file-viewer-insights__conflict-lead">A different value was saved before.</p>' +
      '<p class="file-viewer-insights__conflict-value">Already saved: ' + escapeHtml(conflict.current) + '</p>' +
      '<p class="file-viewer-insights__conflict-value">This letter: ' + escapeHtml(conflict.proposed) + '</p>' +
      '<div class="file-viewer-insights__actions">' +
        '<lex-btn type="button" variant="primary" size="sm" data-enrichment-action="overwrite" data-suggestion-id="' + escapeHtml(row.id) + '">Replace with this</lex-btn>' +
        '<lex-btn type="button" variant="secondary" size="sm" data-enrichment-action="keep" data-suggestion-id="' + escapeHtml(row.id) + '">Keep the current value</lex-btn>' +
      '</div>' +
    '</div>';
  }

  // A fee, payment step or signing: the value, where it came from, inline
  // editors, and Save (or, after a 409, Replace or Keep).
  function renderReviewItem(row, conflict) {
    var source = row.sourceNote
      ? '<div class="file-viewer-insights__source' + (row.sourceWarning ? ' file-viewer-insights__source--warning" role="note">' : '">') + escapeHtml(row.sourceNote) + '</div>'
      : '';
    var actions = conflict ? renderConflict(row, conflict)
      : '<div class="file-viewer-insights__actions">' +
          '<lex-btn type="button" variant="primary" size="sm" data-enrichment-action="accept" data-suggestion-id="' + escapeHtml(row.id) + '">' + escapeHtml(row.verb) + '</lex-btn>' +
          '<lex-btn type="button" variant="secondary" size="sm" data-enrichment-action="dismiss" data-suggestion-id="' + escapeHtml(row.id) + '">Dismiss</lex-btn>' +
        '</div>';
    return '<li class="file-viewer-insights__item file-viewer-insights__item--review" data-suggestion-id="' + escapeHtml(row.id) + '" data-suggestion-status="' + escapeHtml(row.status) + '" data-target-kind="' + escapeHtml(row.targetKind) + '">' +
      '<div class="file-viewer-insights__item-head"><span class="file-viewer-insights__item-title">' + escapeHtml(row.title) + '</span></div>' +
      (row.detail ? '<div class="file-viewer-insights__item-detail">' + escapeHtml(row.detail) + '</div>' : '') +
      source +
      renderEvidence(row.evidence) +
      (row.confidence ? '<div class="file-viewer-insights__confidence">' + escapeHtml(row.confidence) + '</div>' : '') +
      (conflict ? '' : renderEditors(row)) +
      actions +
    '</li>';
  }

  function renderSuggestion(row, open) {
    var actions = open
      ? '<div class="file-viewer-insights__actions">' +
          '<lex-btn type="button" variant="primary" size="sm" data-enrichment-action="accept" data-suggestion-id="' + escapeHtml(row.id) + '">' + escapeHtml(row.verb) + '</lex-btn>' +
          '<lex-btn type="button" variant="secondary" size="sm" data-enrichment-action="dismiss" data-suggestion-id="' + escapeHtml(row.id) + '">Dismiss</lex-btn>' +
        '</div>'
      : '<span class="file-viewer-insights__decision">' + escapeHtml(humanize(row.status)) + (row.dismissReason ? ': ' + escapeHtml(row.dismissReason) : '') + '</span>';
    return '<li class="file-viewer-insights__item" data-suggestion-id="' + escapeHtml(row.id) + '" data-suggestion-status="' + escapeHtml(row.status) + '">' +
      '<div class="file-viewer-insights__item-head">' +
        '<lex-badge label="' + escapeHtml(row.targetLabel) + '" color="indigo" size="sm"></lex-badge>' +
        '<span class="file-viewer-insights__item-title">' + escapeHtml(row.title) + '</span>' +
      '</div>' +
      (row.detail ? '<div class="file-viewer-insights__item-detail">' + escapeHtml(row.detail) + '</div>' : '') +
      renderEvidence(row.evidence) +
      (row.confidence ? '<div class="file-viewer-insights__confidence">' + escapeHtml(row.confidence) + '</div>' : '') +
      actions +
    '</li>';
  }

  function renderSection(title, bodyHtml, extra) {
    return '<section class="file-viewer-insights__section">' +
      '<h5 class="file-viewer-insights__title">' + escapeHtml(title) + (extra ? ' <span class="file-viewer-insights__count">' + escapeHtml(extra) + '</span>' : '') + '</h5>' +
      bodyHtml +
    '</section>';
  }

  /** The panel as HTML. Every value is escaped; actions carry data attributes the page delegates on. */
  function renderPanelHtml(vm, extras) {
    var conflicts = (extras && extras.conflicts) || {};
    if (!vm || !vm.enabled) {
      return '<lex-empty size="compact" message="Insights are off" description="Document enrichment is turned off on this deployment."></lex-empty>';
    }
    if (!vm.available) {
      return '<lex-empty size="compact" message="No insights yet" description="This document has not been read for insights."></lex-empty>' +
        '<div class="file-viewer-insights__actions file-viewer-insights__actions--center"><lex-btn type="button" variant="secondary" size="sm" data-enrichment-action="rerun">Read this document</lex-btn></div>';
    }
    var parts = [];
    parts.push('<div class="file-viewer-insights__status file-viewer-insights__status--' + escapeHtml(vm.status) + '">' +
      '<span>' + escapeHtml(vm.statusLabel) + (vm.truncated ? ', first part of a long document' : '') + '</span>' +
      '<lex-btn type="button" variant="secondary" size="sm" class="file-viewer-insights__rerun" data-enrichment-action="rerun">Read again</lex-btn>' +
    '</div>');
    if (vm.classification) {
      parts.push(renderSection('Document type',
        '<div class="file-viewer-insights__classification' + (vm.classification.abstained ? ' file-viewer-insights__classification--abstained' : '') + '">' +
          '<span class="file-viewer-insights__type">' + escapeHtml(vm.classification.label) + '</span>' +
          (vm.classification.confidence ? '<span class="file-viewer-insights__confidence">' + escapeHtml(vm.classification.confidence) + '</span>' : '') +
        '</div>' +
        (vm.classification.purpose ? '<p class="file-viewer-insights__purpose">' + escapeHtml(vm.classification.purpose) + '</p>' : '')));
    }
    if (vm.summary) {
      parts.push(renderSection('Summary', '<p class="file-viewer-insights__summary">' + escapeHtml(vm.summary) + '</p>'));
    }
    // Fees, payment steps and signing, each in its own section.
    Object.keys(REVIEW_GROUPS).forEach(function (kind) {
      var rows = vm.suggestions.open.filter(function (row) { return row.reviewGroup === kind; });
      if (!rows.length) return;
      parts.push(renderSection(REVIEW_GROUPS[kind], '<ul class="file-viewer-insights__list">' + rows.map(function (row) { return renderReviewItem(row, conflicts[row.id] || null); }).join('') + '</ul>'));
    });
    var general = vm.suggestions.open.filter(function (row) { return !row.reviewGroup; });
    if (general.length) {
      parts.push(renderSection('Suggestions', '<ul class="file-viewer-insights__list">' + general.map(function (row) { return renderSuggestion(row, true); }).join('') + '</ul>', String(general.length)));
    }
    vm.callouts.forEach(function (group) {
      parts.push(renderSection(group.label, '<ul class="file-viewer-insights__list">' + group.items.map(function (item) {
        var meta = [item.when, item.amount, item.party].filter(Boolean).join(' · ');
        return '<li class="file-viewer-insights__item">' +
          '<div class="file-viewer-insights__item-title">' + escapeHtml(item.title) + '</div>' +
          (meta ? '<div class="file-viewer-insights__item-detail">' + escapeHtml(meta) + '</div>' : '') +
          (item.detail ? '<div class="file-viewer-insights__item-text">' + escapeHtml(item.detail) + '</div>' : '') +
          renderEvidence(item.evidence) +
        '</li>';
      }).join('') + '</ul>', String(group.items.length)));
    });
    if (vm.entities.length) {
      parts.push(renderSection('Entities', vm.entities.map(function (group) {
        return '<div class="file-viewer-insights__entity-group"><span class="file-viewer-insights__entity-kind">' + escapeHtml(group.label) + '</span>' +
          '<span class="file-viewer-insights__entity-values">' + group.items.map(function (item) {
            return '<span class="file-viewer-insights__chip" title="' + escapeHtml(item.evidence) + '">' + escapeHtml(item.text) + (item.role ? ' <em>' + escapeHtml(item.role) + '</em>' : '') + '</span>';
          }).join('') + '</span></div>';
      }).join('')));
    }
    if (vm.suggestions.decided.length) {
      parts.push(renderSection('Decided', '<ul class="file-viewer-insights__list file-viewer-insights__list--decided">' + vm.suggestions.decided.map(function (row) { return renderSuggestion(row, false); }).join('') + '</ul>', String(vm.suggestions.decided.length)));
    }
    if (parts.length === 1) {
      parts.push('<lex-empty size="compact" message="Nothing to report" description="The reader found no type, summary or entities in this document."></lex-empty>');
    }
    return '<div class="file-viewer-insights">' + parts.join('') + '</div>';
  }

  function unwrap(response) {
    return response && response.data !== undefined ? response.data : response;
  }

  function load(api, matterId, documentId) {
    return api.get(enrichmentEndpoint(matterId, documentId)).then(unwrap);
  }

  // Typed values from the inline editors: a number for money and numbers
  // (null when it is not one), a day or null for dates, trimmed text.
  function readOverrides(fields) {
    var out = {};
    (Array.isArray(fields) ? fields : []).forEach(function (field) {
      if (!field || !field.name) return;
      var raw = String(field.value === null || field.value === undefined ? '' : field.value).trim();
      if (field.format === 'currency' || field.format === 'number') {
        var plain = raw.split(',').join('').split('$').join('').split(' ').join('');
        out[field.name] = plain !== '' && Number.isFinite(Number(plain)) ? Number(plain) : null;
      } else if (field.format === 'date') {
        out[field.name] = raw ? raw.slice(0, 10) : null;
      } else {
        out[field.name] = raw;
      }
    });
    return out;
  }

  /** The overrides from one item's inline editors on the page. */
  function collectOverrides(item) {
    if (!item || typeof item.querySelectorAll !== 'function') return {};
    var fields = Array.prototype.map.call(item.querySelectorAll('[data-enrichment-override]'), function (input) {
      return { name: input.getAttribute('data-enrichment-override'), format: input.getAttribute('data-override-format'), value: input.value };
    });
    return readOverrides(fields);
  }

  function firstPresent(data, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      if (Object.prototype.hasOwnProperty.call(data, keys[i]) && data[keys[i]] !== undefined) return data[keys[i]];
    }
    return undefined;
  }

  function conflictValueText(value, row) {
    if (value && typeof value === 'object') {
      if (row.targetKind === 'payment') return paymentText(value.amount, value.due_date, value.due_date_basis, value.estimated === true);
      var inner = firstPresent(value, ['value', 'signed_on', 'amount']);
      return conflictValueText(inner, row);
    }
    var editor = row.editors && row.editors[0];
    return valueText(value, editor ? editor.format : 'text') || 'Nothing';
  }

  /**
   * A 409 on accept: what was saved before and what this letter says, in
   * plain words ({ current, proposed }); null for any other error.
   */
  function conflictOf(error, row) {
    if (!error || error.status !== 409) return null;
    var data = error.data && typeof error.data === 'object' ? error.data : {};
    var source = data.error && typeof data.error === 'object' ? Object.assign({}, data, data.error) : data;
    var current = firstPresent(source, ['current_value', 'existing_value', 'current', 'existing']);
    var proposed = firstPresent(source, ['proposed_value', 'incoming_value', 'proposed', 'incoming']);
    return { current: conflictValueText(current, row || {}), proposed: conflictValueText(proposed, row || {}) };
  }

  var CREATED_NOTES = { contact: 'Contact added.', matter_party: 'Party added to the matter.', calendar_event: 'Deadline added to the calendar.' };
  var KIND_NOTES = { fee: 'Fee saved.', payment: 'Payment step saved.', engagement_signed: 'Marked signed.' };

  /** The note after an accept: by the kind saved, else by the record created. */
  function acceptedNote(targetKind, createdRecordType) {
    return KIND_NOTES[targetKind] || CREATED_NOTES[createdRecordType] || 'Suggestion accepted.';
  }

  function accept(api, matterId, documentId, suggestionId, overrides, options) {
    var body = overrides && Object.keys(overrides).length ? { overrides: overrides } : {};
    if (options && options.overwrite) body.overwrite = true;
    return api.post(enrichmentEndpoint(matterId, documentId, '/suggestions/' + encodeURIComponent(suggestionId) + '/accept'), body).then(unwrap);
  }

  function dismiss(api, matterId, documentId, suggestionId, reason) {
    var body = reason ? { reason: String(reason).slice(0, 500) } : {};
    return api.post(enrichmentEndpoint(matterId, documentId, '/suggestions/' + encodeURIComponent(suggestionId) + '/dismiss'), body).then(unwrap);
  }

  function rerun(api, matterId, documentId) {
    return api.post(enrichmentEndpoint(matterId, documentId, '/rerun'), {}).then(unwrap);
  }

  var service = {
    TARGET_LABELS: TARGET_LABELS,
    ENTITY_LABELS: ENTITY_LABELS,
    CALLOUT_LABELS: CALLOUT_LABELS,
    STATUS_LABELS: STATUS_LABELS,
    escapeHtml: escapeHtml,
    humanize: humanize,
    confidenceLabel: confidenceLabel,
    enrichmentEndpoint: enrichmentEndpoint,
    suggestionTitle: suggestionTitle,
    suggestionDetail: suggestionDetail,
    viewModel: viewModel,
    REVIEW_GROUPS: REVIEW_GROUPS,
    readOverrides: readOverrides,
    collectOverrides: collectOverrides,
    conflictOf: conflictOf,
    acceptedNote: acceptedNote,
    renderPanelHtml: renderPanelHtml,
    load: load,
    accept: accept,
    dismiss: dismiss,
    rerun: rerun
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  global.LanaDocumentEnrichment = service;
})(typeof window !== 'undefined' ? window : globalThis);

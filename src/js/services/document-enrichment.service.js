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

  var TARGET_LABELS = { contact: 'Contact', party: 'Party', deadline: 'Deadline' };
  var TARGET_VERBS = { contact: 'Add contact', party: 'Add party', deadline: 'Add deadline' };
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
        createdRecordType: suggestion.created_record_type || ''
      };
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
  function renderPanelHtml(vm) {
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
    if (vm.suggestions.open.length) {
      parts.push(renderSection('Suggestions', '<ul class="file-viewer-insights__list">' + vm.suggestions.open.map(function (row) { return renderSuggestion(row, true); }).join('') + '</ul>', String(vm.suggestions.open.length)));
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

  function accept(api, matterId, documentId, suggestionId, overrides) {
    var body = overrides && Object.keys(overrides).length ? { overrides: overrides } : {};
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
    renderPanelHtml: renderPanelHtml,
    load: load,
    accept: accept,
    dismiss: dismiss,
    rerun: rerun
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  global.LanaDocumentEnrichment = service;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * note-labels.js
 * Fact labels on matter notes, and the view mapping the Notes tab needs.
 *
 * The label list has one source: PLATFORM_FACT_LABELS until the matter's
 * makeup view model ships, then its `fact_labels` (GET /matters/:id/makeup)
 * passed to factLabels(). Nothing else in the client names a label key.
 * The server validates labels and derives evidence_status; this module only
 * maps them for display and builds request parameters.
 *
 * Public API (window.LanaNoteLabels, or module.exports in Node):
 *   - PLATFORM_FACT_LABELS                  -> [{ key, label }]
 *   - factLabels(fromMakeup)                -> label list to use
 *   - labelText(key, labels)                -> display text for a label key
 *   - labelOptions(labels, currentKey)      -> lex-select options for the picker
 *   - labelFilterOptions(labels)            -> lex-select options for the filter
 *   - labelChange(selected, previous)       -> partial body for create/update
 *   - listFilterParams(filters)             -> { label?, unlinked? } list params
 *   - hasActiveFilters(filters)             -> boolean
 *   - evidenceFlag(note)                    -> null | { text, detail } (fact and evidence labels only)
 */

(function (global) {
  'use strict';

  var PLATFORM_FACT_LABELS = Object.freeze([
    Object.freeze({ key: 'fact', label: 'Fact' }),
    Object.freeze({ key: 'client_instruction', label: 'Client instruction' }),
    Object.freeze({ key: 'open_question', label: 'Open question' }),
    Object.freeze({ key: 'evidence', label: 'Evidence' })
  ]);

  var NO_LABEL_VALUE = '';

  function factLabels(fromMakeup) {
    if (!Array.isArray(fromMakeup) || fromMakeup.length === 0) return PLATFORM_FACT_LABELS;
    return fromMakeup.filter(function (item) {
      return item && typeof item.key === 'string' && item.key;
    }).map(function (item) {
      return { key: item.key, label: item.label || item.key };
    });
  }

  function humanizeKey(key) {
    var words = String(key).split('_').filter(Boolean);
    if (words.length === 0) return '';
    var text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.substring(1);
  }

  function labelText(key, labels) {
    if (!key) return '';
    var list = labels || PLATFORM_FACT_LABELS;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return list[i].label;
    }
    return humanizeKey(key);
  }

  function isKnown(key, labels) {
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].key === key) return true;
    }
    return false;
  }

  // A note keeps a label its matter's makeup no longer offers (design 3.4);
  // the picker lists it under "Other labels" so editing does not drop it.
  function labelOptions(labels, currentKey) {
    var list = labels || PLATFORM_FACT_LABELS;
    var options = [{ value: NO_LABEL_VALUE, label: 'No label' }].concat(list.map(function (item) {
      return { value: item.key, label: item.label };
    }));
    if (currentKey && !isKnown(currentKey, list)) {
      options.push({ value: currentKey, label: humanizeKey(currentKey), group: 'Other labels' });
    }
    return options;
  }

  function labelFilterOptions(labels) {
    var list = labels || PLATFORM_FACT_LABELS;
    return [{ value: NO_LABEL_VALUE, label: 'All labels' }].concat(list.map(function (item) {
      return { value: item.key, label: item.label };
    }));
  }

  // Create omits an empty label; update sends null only to clear one.
  function labelChange(selected, previous) {
    var next = selected || null;
    var prior = previous || null;
    if (next === prior) return {};
    return { label: next };
  }

  function listFilterParams(filters) {
    var params = {};
    if (!filters) return params;
    if (filters.label) params.label = filters.label;
    if (filters.unlinked === true) params.unlinked = 'true';
    return params;
  }

  function hasActiveFilters(filters) {
    return Object.keys(listFilterParams(filters)).length > 0;
  }

  var EVIDENCE_DETAIL = {
    linked: 'Linked, but it does not cite a retained document.',
    unlinked: 'Not linked to any record or document.'
  };

  // Only evidence-bearing labels claim support from a source; an open
  // question or a client instruction is not flagged.
  var EVIDENCE_LABELS = ['fact', 'evidence'];

  function evidenceFlag(note) {
    if (!note || EVIDENCE_LABELS.indexOf(note.label) === -1) return null;
    var status = note.evidence_status;
    if (!status || status === 'supported') return null;
    return {
      text: 'Not supported',
      detail: EVIDENCE_DETAIL[status] || 'Does not cite a retained document.'
    };
  }

  var moduleApi = {
    PLATFORM_FACT_LABELS: PLATFORM_FACT_LABELS,
    factLabels: factLabels,
    labelText: labelText,
    labelOptions: labelOptions,
    labelFilterOptions: labelFilterOptions,
    labelChange: labelChange,
    listFilterParams: listFilterParams,
    hasActiveFilters: hasActiveFilters,
    evidenceFlag: evidenceFlag
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaNoteLabels = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);

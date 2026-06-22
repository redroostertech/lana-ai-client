/* Unified Search: result type faceting helpers.
   Pure, DOM-free logic extracted from unified-search-modal.js so it can be
   unit-tested directly and reused. No side effects on load. */
(function (root) {
  'use strict';

  // The canonical type discriminator for a search result. Mirrors the modal's
  // entityTypeOf: prefer entity_type, fall back to source_type.
  function entityTypeOf(result) {
    return (result && (result.entity_type || result.source_type)) || '';
  }

  // Default label: underscores to spaces. Callers may pass a richer labelFn
  // (the modal passes its TYPE_LABELS-aware typeLabel).
  function defaultLabel(type) {
    return String(type || 'entity').replace(/_/g, ' ');
  }

  // Build ordered facets from a result set. Counts reflect the FULL set so the
  // chips always show how many of each type exist, regardless of the active
  // filter. Order: count desc, then label asc (deterministic, stable tiebreak).
  function computeTypeFacets(results, labelFn) {
    const label = typeof labelFn === 'function' ? labelFn : defaultLabel;
    const list = Array.isArray(results) ? results : [];
    const counts = new Map();
    for (let i = 0; i < list.length; i++) {
      const type = entityTypeOf(list[i]);
      if (!type) continue;
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    const facets = Array.from(counts.entries()).map(function (entry) {
      return { type: entry[0], label: String(label(entry[0])), count: entry[1] };
    });
    facets.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
    return { total: list.length, facets: facets };
  }

  // Filter a result set by type. A null/empty/'all' type returns every result
  // (the "All" chip). Never mutates the input.
  function filterResultsByType(results, type) {
    const list = Array.isArray(results) ? results : [];
    if (!type || type === 'all') return list.slice();
    return list.filter(function (result) {
      return entityTypeOf(result) === type;
    });
  }

  // Decide which row should be active after (re)rendering a list, and whether
  // the prior selection was preserved. On a fresh query (autoSelect) we always
  // land on the first row. On a filter toggle we keep the previously selected
  // result if it survived the filter (so the detail pane is not needlessly
  // reloaded); only when it was filtered out do we fall back to the first row.
  // keyOf maps a result to a stable identity string (the modal passes its
  // resultKey). Returns { index, preserved }.
  function resolveActiveSelection(results, selectedKey, keyOf, autoSelect) {
    const list = Array.isArray(results) ? results : [];
    if (!autoSelect && selectedKey && typeof keyOf === 'function') {
      for (let i = 0; i < list.length; i++) {
        if (keyOf(list[i]) === selectedKey) {
          return { index: i, preserved: true };
        }
      }
    }
    return { index: 0, preserved: false };
  }

  const api = {
    entityTypeOf: entityTypeOf,
    computeTypeFacets: computeTypeFacets,
    filterResultsByType: filterResultsByType,
    resolveActiveSelection: resolveActiveSelection
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.UnifiedSearchFilter = api;
  }
})(typeof window !== 'undefined' ? window : this);

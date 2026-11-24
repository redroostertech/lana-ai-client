/**
 * Settings > Mappings model (pure, no DOM).
 *
 * Maps a firm's source values (an ActionStep matter type, a Leadly
 * appointment type) to LANA's governed keys. This module owns the rules the
 * screen follows: picker options grouped by parent, unmapped rows first,
 * which edits become a save, "Accept all suggestions" (fills pickers only;
 * nothing is saved until Save), and the words for the saved message, the
 * setup banner and the dashboard card caveat. No regex (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SettingsMappingsModel = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var NOUNS = {
    matter_service: ['case type', 'case types'],
    meeting_type: ['appointment type', 'appointment types'],
  };

  function count(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function plural(n, words) {
    return count(n) + ' ' + (Number(n) === 1 ? words[0] : words[1]);
  }

  /** [{ value, label, group, indent? }]: parents in order, each followed by its children. */
  function pickerOptions(vocabulary) {
    var list = Array.isArray(vocabulary) ? vocabulary : [];
    var parents = list.filter(function (item) { return !item.parent; });
    var out = [];
    parents.forEach(function (parent) {
      out.push({ value: parent.key, label: parent.label, group: parent.label });
      list.filter(function (item) { return item.parent === parent.key; }).forEach(function (child) {
        out.push({ value: child.key, label: child.label, group: parent.label, indent: true });
      });
    });
    // Children whose parent is not in the list still get a place.
    list.filter(function (item) { return item.parent && !parents.some(function (p) { return p.key === item.parent; }); })
      .forEach(function (orphan) { out.push({ value: orphan.key, label: orphan.label, group: orphan.label }); });
    return out;
  }

  function isMapped(row) {
    return !!(row && row.mapped_key);
  }

  function byRecords(a, b) {
    return (Number(b.record_count) || 0) - (Number(a.record_count) || 0);
  }

  /** Unmapped first (most records first), then mapped; status: all | unmapped | mapped. */
  function visibleRows(rows, status) {
    var list = Array.isArray(rows) ? rows : [];
    var unmapped = list.filter(function (row) { return !isMapped(row); }).sort(byRecords);
    var mapped = list.filter(isMapped).sort(byRecords);
    if (status === 'unmapped') return unmapped;
    if (status === 'mapped') return mapped;
    return unmapped.concat(mapped);
  }

  function rowKey(row) {
    return String(row.connector || '') + '|' + String(row.source_value || '');
  }

  /**
   * The picker shows the person's pick, else the saved key, else the
   * suggestion (marked "Suggested"). Only picks are saved, so a suggestion
   * is never applied on its own.
   */
  function pickerValue(row, edits) {
    var key = rowKey(row);
    if (edits && Object.prototype.hasOwnProperty.call(edits, key)) return edits[key] || '';
    return row.mapped_key || row.suggested_key || '';
  }

  /** Edits that change a row become PUT items; an empty pick is not a save. */
  function pendingItems(rows, edits) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      var pick = edits ? edits[rowKey(row)] : undefined;
      return pick && pick !== row.mapped_key;
    }).map(function (row) {
      return { connector: row.connector, source_value: row.source_value, canonical_key: edits[rowKey(row)] };
    });
  }

  /** Fill the pickers of unmapped rows with their suggestions (never saves). */
  function acceptSuggestions(rows, edits) {
    var next = Object.assign({}, edits || {});
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var key = rowKey(row);
      if (!isMapped(row) && row.suggested_key && !Object.prototype.hasOwnProperty.call(next, key)) next[key] = row.suggested_key;
    });
    return next;
  }

  // The words after a save (records_to_update re-resolve in the background).
  function savedMessage(result) {
    var n = Number(result && result.records_to_update) || 0;
    if (!n) return 'Saved.';
    return 'Saved. Updating ' + plural(n, ['record', 'records']) + ' in the background.';
  }

  /** "Finish your setup: 3 case types and 2 appointment types aren't mapped yet (318 records)." or null. */
  function bannerText(summary) {
    if (!summary || typeof summary !== 'object') return null;
    var parts = [];
    var values = 0;
    var records = 0;
    Object.keys(NOUNS).forEach(function (vocabulary) {
      var entry = summary[vocabulary];
      if (!entry || !(Number(entry.unmapped_values) > 0)) return;
      parts.push(plural(entry.unmapped_values, NOUNS[vocabulary]));
      values += Number(entry.unmapped_values);
      records += Number(entry.unmapped_records) || 0;
    });
    if (!parts.length) return null;
    var verb = values === 1 ? "isn't" : "aren't";
    return 'Finish your setup: ' + parts.join(' and ') + ' ' + verb + ' mapped yet (' + plural(records, ['record', 'records']) + ').';
  }

  /** The card caveat from mapping_coverage, or null. */
  function coverageCaveat(coverage) {
    var n = coverage ? Number(coverage.not_mapped) || 0 : 0;
    if (!n) return null;
    return n === 1 ? '1 matter is not mapped to a service yet' : count(n) + ' matters are not mapped to a service yet';
  }

  return {
    pickerOptions: pickerOptions,
    visibleRows: visibleRows,
    rowKey: rowKey,
    pickerValue: pickerValue,
    pendingItems: pendingItems,
    acceptSuggestions: acceptSuggestions,
    savedMessage: savedMessage,
    bannerText: bannerText,
    coverageCaveat: coverageCaveat,
  };
});

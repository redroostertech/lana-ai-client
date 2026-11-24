/**
 * All dashboards table columns (pure, no DOM).
 *
 * "Who can see it" replaces Audience and Visibility (one maps to the other);
 * Area (category) and State show only when their values differ across rows;
 * Scope is never a column: a row that is not organization-wide gets a small
 * tag next to its name. No regex (per Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DashboardLibraryColumns = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var OPTIONAL = [
    { key: 'category', label: 'Area' },
    { key: 'state', label: 'State' },
  ];

  function words(value) {
    var text = String(value === null || value === undefined ? '' : value).split('_').join(' ').split('-').join(' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function whoCanSee(row) {
    if (!row) return '';
    return row.visibility ? String(row.visibility) : words(row.audience);
  }

  function scopeTag(row) {
    var scope = row && row.scope ? String(row.scope).trim() : '';
    return scope && scope.toLowerCase() !== 'organization-wide' ? scope : '';
  }

  function varies(rows, key) {
    var seen = {};
    (rows || []).forEach(function (row) {
      var value = row && row[key] !== undefined && row[key] !== null ? String(row[key]).toLowerCase() : '';
      seen[value] = true;
    });
    return Object.keys(seen).length > 1;
  }

  /** { columns, labels, sortable } for the table, from the rows it shows. */
  function tableColumns(rows) {
    var columns = ['pin', 'name', 'who'];
    var labels = [' ', 'Name', 'Who can see it'];
    OPTIONAL.forEach(function (col) {
      if (varies(rows, col.key)) { columns.push(col.key); labels.push(col.label); }
    });
    columns = columns.concat(['created_at', 'updated_at', 'actions']);
    labels = labels.concat(['Created', 'Last edited', 'Actions']);
    return {
      columns: columns,
      labels: labels,
      sortable: columns.filter(function (key) { return key !== 'pin' && key !== 'actions'; }),
    };
  }

  return { whoCanSee: whoCanSee, scopeTag: scopeTag, tableColumns: tableColumns };
});

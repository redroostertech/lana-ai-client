/*
 * OpenSourceLicensesModel - pure helpers for the Open-source licenses page.
 *
 * Reads the generated inventory (window.LanaOpenSourceNotices, from
 * js/pages/open-source-licenses.data.js, written by scripts/licenses/generate.js)
 * and shapes it for display: filtering by name or license, and looking up the
 * full license texts an item points at.
 *
 * No DOM, no network, no regex. Loaded as a browser global
 * (window.OpenSourceLicensesModel) and as a CommonJS module for Jest.
 */
(function (global) {
  'use strict';

  /** Items whose name or license contains the query, ignoring case; all items for an empty query. */
  function filterItems(items, query) {
    var needle = String(query == null ? '' : query).trim().toLowerCase();
    if (!needle) return items.slice();
    return items.filter(function (item) {
      return String(item.name).toLowerCase().indexOf(needle) !== -1 ||
        String(item.licenseName).toLowerCase().indexOf(needle) !== -1;
    });
  }

  /** Sections with their items filtered; sections left empty are dropped. */
  function filterSections(notices, query) {
    if (!notices || !Array.isArray(notices.sections)) return [];
    var out = [];
    notices.sections.forEach(function (section) {
      var items = filterItems(section.items || [], query);
      if (items.length) out.push({ id: section.id, title: section.title, detail: section.detail, items: items });
    });
    return out;
  }

  /** The license texts an item points at, in order, skipping missing ones. */
  function textsFor(notices, item) {
    var texts = (notices && notices.texts) || {};
    var out = [];
    (item.texts || []).forEach(function (key) {
      var text = texts[key];
      if (text) out.push({ key: key, title: text.title, body: text.body });
    });
    return out;
  }

  /** The card subtitle: version and license. */
  function subtitleFor(item) {
    return [item.version, item.licenseName].filter(Boolean).join(' · ');
  }

  function totalCount(sections) {
    return sections.reduce(function (sum, section) { return sum + section.items.length; }, 0);
  }

  var api = { filterItems: filterItems, filterSections: filterSections, textsFor: textsFor, subtitleFor: subtitleFor, totalCount: totalCount };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.OpenSourceLicensesModel = api;
  }
})(typeof window !== 'undefined' ? window : this);

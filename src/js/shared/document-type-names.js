// src/js/shared/document-type-names.js
// Readable names for documents.document_type values. The names are backend
// data (GET /api/v1/document-types, loaded once per page); the client keeps no
// list of its own. A value the list does not name, or any value before the list
// arrives, reads as its key in plain words.
(function (root) {
  'use strict';

  var ENDPOINT = '/api/v1/document-types';
  var labels = Object.create(null);
  // The server's types in its order, for pickers.
  var ordered = [];
  var loading = null;

  /**
   * A stored key as plain words: underscores and hyphens to spaces, sentence case.
   * @param {*} key
   * @returns {string|null} null when there are no words
   */
  function humanizeKey(key) {
    if (key === null || key === undefined) return null;
    var words = String(key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
  }

  function setLabels(list) {
    var next = Object.create(null);
    var order = [];
    (Array.isArray(list) ? list : []).forEach(function (entry) {
      if (!entry || typeof entry.key !== 'string' || typeof entry.label !== 'string') return;
      var key = entry.key.trim();
      var label = entry.label.trim();
      if (key && label && !next[key]) order.push(key);
      if (key && label) next[key] = label;
    });
    labels = next;
    ordered = order;
  }

  /**
   * Load the names once. Resolves true when the list arrived, false otherwise
   * (no client, or the request failed; a later call tries again).
   * @param {{get: Function}} [apiClient] defaults to window.api
   * @returns {Promise<boolean>}
   */
  function load(apiClient) {
    if (loading) return loading;
    var client = apiClient || (typeof window !== 'undefined' && window.api) || null;
    if (!client || typeof client.get !== 'function') return Promise.resolve(false);
    loading = Promise.resolve()
      .then(function () { return client.get(ENDPOINT); })
      .then(function (response) {
        setLabels(response && response.data);
        return true;
      })
      .catch(function () {
        loading = null;
        return false;
      });
    return loading;
  }

  /**
   * Readable name for a stored document_type value.
   * @param {string|null|undefined} type
   * @returns {string|null} null when there is no type
   */
  function documentTypeLabel(type) {
    if (type === null || type === undefined) return null;
    var key = String(type).trim();
    if (!key) return null;
    return labels[key] || humanizeKey(key);
  }

  /**
   * Options for a Document Type picker: Auto-detect, then every type the
   * server returned, plus the stored type when the list lacks it. null
   * before the list arrives (the page keeps its own options).
   * @param {string} [current]
   * @returns {Array<{value:string,label:string}>|null}
   */
  function pickerOptions(current) {
    if (!ordered.length) return null;
    var options = [{ value: '', label: 'Auto-detect' }].concat(ordered.map(function (key) { return { value: key, label: labels[key] }; }));
    var stored = current === null || current === undefined ? '' : String(current).trim();
    if (stored && !labels[stored]) options.push({ value: stored, label: humanizeKey(stored) });
    return options;
  }

  var api = { load: load, documentTypeLabel: documentTypeLabel, humanizeKey: humanizeKey, pickerOptions: pickerOptions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LanaDocumentTypeNames = api;
})(typeof window !== 'undefined' ? window : null);

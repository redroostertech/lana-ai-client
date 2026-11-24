/* Settings > Mappings: map a firm's source values (an ActionStep matter type,
   a Leadly appointment type) to LANA's governed keys.

   Rules live in js/settings-mappings.model.js. This script draws the
   section, keeps the person's picks until they press Save (one batch PUT),
   and clears a mapping with its own action. Admins edit; others read.
   The section and the "Finish your setup" banner stay hidden while the
   mappings API is not available (the summary endpoint answers 404). */

(function () {
  'use strict';

  var VOCABULARIES = {
    matter_service: { tab: 'Matter types', noun: ['matter', 'matters'] },
    meeting_type: { tab: 'Meeting types', noun: ['appointment', 'appointments'] },
  };

  var state = {
    vocabulary: 'matter_service',
    status: 'all',
    rows: {},
    options: {},
    edits: {},
    loaded: {},
    canEdit: false,
    busy: false,
  };

  function el(id) { return document.getElementById(id); }

  function model() { return window.SettingsMappingsModel; }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
      .split('"').join('&quot;').split("'").join('&#39;');
  }

  function unwrap(response) {
    return response && response.data !== undefined ? response.data : response;
  }

  function canEdit() {
    return !!(window.Lex && Lex.Auth && typeof Lex.Auth.isAdmin === 'function' && Lex.Auth.isAdmin());
  }

  function count(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function recordsText(row) {
    var noun = VOCABULARIES[state.vocabulary].noun;
    var n = Number(row.record_count) || 0;
    return count(n) + ' ' + (n === 1 ? noun[0] : noun[1]);
  }

  function setByText(row) {
    if (!row.mapped_key || !row.set_at) return '';
    var when = window.Lex && Lex.Utils && Lex.Utils.timeAgo ? Lex.Utils.timeAgo(row.set_at) : String(row.set_at).substring(0, 10);
    return 'Set' + (row.set_by ? ' by ' + row.set_by : '') + ' ' + when;
  }

  function rowHtml(row) {
    var key = model().rowKey(row);
    var value = model().pickerValue(row, state.edits);
    var suggested = !row.mapped_key && row.suggested_key && value === row.suggested_key
      && !Object.prototype.hasOwnProperty.call(state.edits, key);
    var picked = Object.prototype.hasOwnProperty.call(state.edits, key) && state.edits[key] !== row.mapped_key;
    return '<li class="sv2-map-row' + (row.mapped_key ? ' is-mapped' : ' is-unmapped') + (picked ? ' is-changed' : '') + '">'
      + '<div class="sv2-map-source">'
      + '<span class="sv2-map-value">' + escapeHtml(row.source_value) + '</span>'
      + '<span class="sv2-map-from">from ' + escapeHtml(row.connector_label || row.connector) + ' ' + escapeHtml(row.source_field_label || '') + '</span>'
      + '</div>'
      + '<span class="sv2-map-count">' + escapeHtml(recordsText(row)) + '</span>'
      + '<div class="sv2-map-pick">'
      + '<lex-select class="sv2-map-select" data-mapping-key="' + escapeHtml(key) + '" placeholder="Choose a type" searchable'
      + (state.canEdit ? '' : ' disabled') + ' aria-label="' + escapeHtml('Type for ' + row.source_value) + '"></lex-select>'
      + (suggested ? '<span class="sv2-map-suggested">Suggested</span>' : '')
      + '</div>'
      + '<div class="sv2-map-meta">'
      + (row.mapped_key ? '<span class="sv2-map-set">' + escapeHtml(setByText(row)) + '</span>' : '<span class="sv2-map-set sv2-map-set--open">Not mapped</span>')
      + (row.mapped_key && state.canEdit && row.id
        ? '<button type="button" class="sv2-map-clear" data-mapping-clear="' + escapeHtml(row.id) + '">Clear</button>' : '')
      + '</div>'
      + '</li>';
  }

  function render() {
    var list = el('sv2-mappings-list');
    if (!list) return;
    var rows = model().visibleRows(state.rows[state.vocabulary] || [], state.status);
    if (!state.loaded[state.vocabulary]) {
      list.innerHTML = '<li class="sv2-map-empty">Loading...</li>';
      return;
    }
    list.innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : '<li class="sv2-map-empty">' + (state.status === 'unmapped' ? 'Everything is mapped.' : 'Nothing to show here yet.') + '</li>';
    var options = state.options[state.vocabulary] || [];
    Array.prototype.forEach.call(list.querySelectorAll('[data-mapping-key]'), function (select) {
      var row = rows.filter(function (r) { return model().rowKey(r) === select.getAttribute('data-mapping-key'); })[0];
      select.options = options;
      select.value = row ? model().pickerValue(row, state.edits) : '';
    });
    syncActions();
  }

  function syncActions() {
    var pending = model().pendingItems(state.rows[state.vocabulary] || [], state.edits);
    var save = el('sv2-mappings-save');
    if (save) {
      save.disabled = !state.canEdit || !pending.length || state.busy;
      save.setAttribute('label', pending.length ? 'Save ' + pending.length + (pending.length === 1 ? ' change' : ' changes') : 'Save');
    }
    var accept = el('sv2-mappings-accept');
    if (accept) accept.hidden = !state.canEdit;
    var readonly = el('sv2-mappings-readonly');
    if (readonly) readonly.hidden = state.canEdit;
  }

  function setMessage(text) {
    var node = el('sv2-mappings-message');
    if (node) node.textContent = text || '';
  }

  async function loadVocabulary(vocabulary) {
    state.loaded[vocabulary] = false;
    render();
    try {
      var results = await Promise.all([api.getVocabulary(vocabulary), api.getMappings(vocabulary, 'all')]);
      state.options[vocabulary] = model().pickerOptions(unwrap(results[0]) || []);
      var rows = unwrap(results[1]);
      state.rows[vocabulary] = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.rows) ? rows.rows : []);
      state.loaded[vocabulary] = true;
    } catch (err) {
      state.rows[vocabulary] = [];
      state.loaded[vocabulary] = true;
      setMessage(model().featureOff(err) ? 'Mappings are not available yet.' : 'Could not load the mappings. Try again in a moment.');
    }
    render();
  }

  async function save() {
    var items = model().pendingItems(state.rows[state.vocabulary] || [], state.edits);
    if (!items.length || !state.canEdit) return;
    state.busy = true;
    syncActions();
    try {
      var result = unwrap(await api.saveMappings(state.vocabulary, items));
      setMessage(model().savedMessage(result));
      state.edits = {};
      await loadVocabulary(state.vocabulary);
      refreshBanner();
    } catch (err) {
      setMessage('Could not save. Your picks are still here; try again.');
    } finally {
      state.busy = false;
      syncActions();
    }
  }

  async function clearMapping(id) {
    if (!state.canEdit) return;
    try {
      await api.deleteMapping(state.vocabulary, id);
      setMessage('Mapping cleared.');
      await loadVocabulary(state.vocabulary);
      refreshBanner();
    } catch (err) {
      setMessage('Could not clear that mapping. Try again.');
    }
  }

  // ── The "Finish your setup" banner (Settings and dashboards) ───────
  async function refreshBanner() {
    if (window.LanaSetupBanner) window.LanaSetupBanner.refresh();
  }

  function bind() {
    var panel = el('sv2-panel-mappings');
    if (!panel) return;
    var tabs = el('sv2-mappings-tabs');
    if (tabs) {
      tabs.setAttribute('tabs', JSON.stringify(Object.keys(VOCABULARIES).map(function (id) { return { id: id, label: VOCABULARIES[id].tab }; })));
      tabs.addEventListener('tab-change', function (event) {
        var next = event.detail && event.detail.tab;
        if (!next || !VOCABULARIES[next] || next === state.vocabulary) return;
        state.vocabulary = next;
        state.edits = {};
        setMessage('');
        if (!state.loaded[next]) loadVocabulary(next); else render();
      });
    }
    var status = el('sv2-mappings-status');
    if (status) {
      status.options = [{ value: 'all', label: 'All' }, { value: 'unmapped', label: 'Not mapped' }, { value: 'mapped', label: 'Mapped' }];
      status.value = 'all';
      status.addEventListener('lex-change', function (event) {
        state.status = (event.detail && event.detail.value) || 'all';
        render();
      });
    }
    panel.addEventListener('lex-change', function (event) {
      var select = event.target && event.target.closest ? event.target.closest('[data-mapping-key]') : null;
      if (!select || !state.canEdit) return;
      state.edits[select.getAttribute('data-mapping-key')] = (event.detail && event.detail.value) || '';
      render();
    });
    panel.addEventListener('click', function (event) {
      if (!event.target || !event.target.closest) return;
      if (event.target.closest('#sv2-mappings-accept')) {
        // Fills the pickers only; nothing is saved until Save.
        state.edits = model().acceptSuggestions(state.rows[state.vocabulary] || [], state.edits);
        setMessage('Suggestions filled in. Review them, then Save.');
        render();
        return;
      }
      if (event.target.closest('#sv2-mappings-save')) { save(); return; }
      var clear = event.target.closest('[data-mapping-clear]');
      if (clear) clearMapping(clear.getAttribute('data-mapping-clear'));
    });
  }

  // Show the section only when the API answers; load it the first time.
  async function start() {
    if (!el('sv2-panel-mappings') || !window.api || typeof api.getMappingSummary !== 'function' || !window.LanaSetupBanner) return;
    state.canEdit = canEdit();
    // One shared summary request (setup-banner.js): feature off or failing
    // leaves the nav item and panel hidden, with no retry.
    var result = await window.LanaSetupBanner.summary();
    if (!result.available) return;
    ['sv2-tab-mappings', 'sv2-panel-mappings'].forEach(function (id) {
      var node = el(id);
      if (node && node.classList) node.classList.remove('sv2-hidden');
    });
    bind();
    loadVocabulary(state.vocabulary);
  }

  window.LanaSettingsMappings = { start: start, _state: state, _render: render };
  start();
  // The setup banner at the top of Settings.
  if (window.LanaSetupBanner) window.LanaSetupBanner.mount('lanaSetupBanner');
})();

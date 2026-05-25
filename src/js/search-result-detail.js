(function () {
  'use strict';

  var state = {
    result: null,
    graph: null
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function params() {
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.getParams === 'function') {
      return window.Lex.Nav.getParams();
    }
    return new URLSearchParams(window.location.search || '');
  }

  function formatLabel(key) {
    return String(key || '').split('_').filter(Boolean).map(function (part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ');
  }

  function formatType(type) {
    return String(type || 'record').replace(/_/g, ' ');
  }

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function valueText(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(', ');
    if (isPlainObject(value)) return JSON.stringify(value);
    return String(value);
  }

  function rowsHtml(rows) {
    return rows.filter(function (row) { return valueText(row[1]); }).map(function (row) {
      return '<div class="search-result-kv"><span class="search-result-key">' +
        escapeHtml(formatLabel(row[0])) + '</span><span class="search-result-value">' +
        escapeHtml(valueText(row[1])) + '</span></div>';
    }).join('');
  }

  function section(title, rows) {
    var body = rowsHtml(rows);
    if (!body) return '';
    return '<section class="search-result-card"><h2>' + escapeHtml(title) + '</h2>' + body + '</section>';
  }

  function tabPanel(id, body, active) {
    return '<div id="searchResultTabPanel-' + escapeHtml(id) + '" class="search-result-tab-panel' +
      (active ? '' : ' hidden') + '" data-search-result-tab-panel="' + escapeHtml(id) + '">' +
      body + '</div>';
  }

  function emptyPanel(message) {
    return '<div class="search-result-empty">' + escapeHtml(message) + '</div>';
  }

  function rawJsonForResult(result) {
    var metadata = isPlainObject(result && result.metadata) ? result.metadata : {};
    var data = isPlainObject(metadata.data) ? metadata.data : {};
    var raw = isPlainObject(data.raw) ? data.raw : null;
    return raw || (Object.keys(data).length ? data : result);
  }

  function editorJsonForResult(result) {
    var raw = rawJsonForResult(result);
    return isPlainObject(raw) ? raw : {};
  }

  function storedResult(routeParams) {
    var key = routeParams.get('result_key');
    if (!key) return null;
    try {
      var raw = sessionStorage.getItem('lana-search-result:' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  }

  function commonRows(source) {
    if (!isPlainObject(source)) return [];
    var keys = [
      'display_name', 'name', 'first_name', 'last_name', 'email', 'phone',
      'company_name', 'status', 'stage', 'priority', 'category', 'reference',
      'subject', 'from_address', 'to_address', 'sent_date', 'received_date',
      'amount', 'total', 'due_date', 'created_at', 'updated_at'
    ];
    return keys.map(function (key) { return [key, source[key]]; });
  }

  function renderRelated(root, result, graph) {
    var relationships = graph && graph.relationships ? graph.relationships : [];
    if (!relationships.length) {
      return emptyPanel('No related records found yet.');
    }
    return '<section class="search-result-card">' + relationships.map(function (relationship) {
      var node = relationship.linked_node || {};
      return '<div class="search-result-kv"><span class="search-result-key">' +
        escapeHtml(formatType(relationship.relationship_type)) + '</span><span class="search-result-value"><strong>' +
        escapeHtml(node.title || node.id || 'Related record') + '</strong><br>' +
        escapeHtml(formatType(node.type)) + (node.subtitle ? ' - ' + escapeHtml(node.subtitle) : '') +
        '</span></div>';
    }).join('') + '</section>';
  }

  function setActiveTab(tabId) {
    var panels = document.querySelectorAll('[data-search-result-tab-panel]');
    panels.forEach(function (panel) {
      panel.classList.toggle('hidden', panel.getAttribute('data-search-result-tab-panel') !== tabId);
    });
  }

  function bindTabs(root) {
    var tabs = root.querySelector('#searchResultTabs');
    if (!tabs) return;
    tabs.addEventListener('tab-change', function (event) {
      setActiveTab(event.detail && event.detail.tab ? event.detail.tab : 'overview');
    });
  }

  function render(result, graph) {
    state.result = result;
    state.graph = graph;
    var root = document.getElementById('searchResultDetailRoot');
    if (!root) return;
    if (!result) {
      root.className = 'search-result-empty';
      root.textContent = 'Result details are unavailable. Open this record from search again.';
      return;
    }

    var metadata = isPlainObject(result.metadata) ? result.metadata : {};
    var data = isPlainObject(metadata.data) ? metadata.data : {};
    var raw = isPlainObject(data.raw) ? data.raw : {};
    var title = result.title || result.name || result.external_id || 'Search result';
    var type = result.entity_type || result.source_type || 'record';

    var overview = [
      ['type', formatType(type)],
      ['source', result.source_system || result.source_table],
      ['entity_id', result.entity_id || result.id],
      ['external_id', result.external_id],
      ['matter_id', result.matter_id],
      ['indexed_at', result.indexed_at],
      ['updated_at', result.source_updated_at]
    ];

    root.className = '';
    var previewHtml = result.snippet
      ? '<section class="search-result-card"><div class="search-result-preview">' + escapeHtml(result.snippet) + '</div></section>'
      : emptyPanel('No preview available.');
    var overviewHtml = section('Overview', overview) || emptyPanel('No overview fields available.');
    var fieldsHtml = section('Fields', commonRows(data)) || emptyPanel('No normalized fields available.');
    var sourceFieldsHtml = section('Source Fields', commonRows(raw)) || emptyPanel('No source fields available.');
    var rawJsonHtml = '<section class="search-result-card"><pre class="search-result-json">' + escapeHtml(JSON.stringify(rawJsonForResult(result), null, 2)) + '</pre></section>';
    var relatedHtml = renderRelated(root, result, graph);

    root.innerHTML = '<lex-banner variant="light" corners heading="' + escapeHtml(title) +
      '" subtitle="' + escapeHtml(formatType(type) + (result.subtitle || result.source_system || result.source_table ? ' - ' + (result.subtitle || result.source_system || result.source_table) : '')) +
      '">' +
      '<button type="button" class="search-result-action" data-search-result-edit data-primary="true">Edit Object</button>' +
      '</lex-banner>' +
      '<section class="search-result-tabs-shell">' +
      '<lex-tabs id="searchResultTabs" active="overview" variant="underline" tabs="' + escapeHtml(JSON.stringify([
        { id: 'overview', label: 'Overview' },
        { id: 'fields', label: 'Fields' },
        { id: 'source', label: 'Source Fields' },
        { id: 'raw', label: 'Raw JSON' },
        { id: 'related', label: 'Related Data' }
      ].concat(result.snippet ? [{ id: 'preview', label: 'Preview' }] : []))) + '"></lex-tabs>' +
      '<div class="search-result-tab-content">' +
      tabPanel('overview', overviewHtml, true) +
      tabPanel('fields', fieldsHtml, false) +
      tabPanel('source', sourceFieldsHtml, false) +
      tabPanel('raw', rawJsonHtml, false) +
      tabPanel('related', relatedHtml, false) +
      (result.snippet ? tabPanel('preview', previewHtml, false) : '') +
      '</div>' +
      '</section>';

    var editButton = root.querySelector('[data-search-result-edit]');
    if (editButton) editButton.addEventListener('click', function () { openEditor(result); });
    bindTabs(root);
  }

  function setEditorStatus(message, isError) {
    var status = document.querySelector('[data-search-result-editor-status]');
    if (!status) return;
    status.textContent = message || '';
    status.dataset.error = isError ? 'true' : 'false';
  }

  function closeEditor() {
    var existing = document.getElementById('searchResultEditor');
    if (existing) existing.remove();
  }

  function openEditor(result) {
    closeEditor();
    var editable = editorJsonForResult(result);
    var html = '<div id="searchResultEditor" class="search-result-editor-backdrop" role="dialog" aria-modal="true" aria-label="Edit search result object">' +
      '<section class="search-result-editor">' +
      '<header class="search-result-editor-header"><h2 class="search-result-editor-title">Edit Object JSON</h2></header>' +
      '<div class="search-result-editor-body">' +
      '<textarea class="search-result-editor-textarea" spellcheck="false" data-search-result-editor-textarea>' + escapeHtml(JSON.stringify(editable, null, 2)) + '</textarea>' +
      '<div class="search-result-editor-status" data-search-result-editor-status></div>' +
      '</div>' +
      '<footer class="search-result-editor-footer">' +
      '<button type="button" class="search-result-action" data-search-result-editor-close>Cancel</button>' +
      '<button type="button" class="search-result-action" data-search-result-editor-save data-primary="true">Save Shadow Update</button>' +
      '</footer>' +
      '</section>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    document.querySelector('[data-search-result-editor-close]').addEventListener('click', closeEditor);
    document.getElementById('searchResultEditor').addEventListener('mousedown', function (event) {
      if (event.target.id === 'searchResultEditor') closeEditor();
    });
    document.querySelector('[data-search-result-editor-save]').addEventListener('click', function () {
      saveShadowUpdate(result);
    });
  }

  async function saveShadowUpdate(result) {
    var textarea = document.querySelector('[data-search-result-editor-textarea]');
    if (!textarea) return;

    var edited;
    try {
      edited = JSON.parse(textarea.value);
    } catch (error) {
      setEditorStatus('Invalid JSON: ' + error.message, true);
      return;
    }

    if (!isPlainObject(edited)) {
      setEditorStatus('The edited object must be a JSON object.', true);
      return;
    }

    if (!window.api || typeof window.api.post !== 'function') {
      setEditorStatus('The API client is not ready.', true);
      return;
    }

    setEditorStatus('Saving shadow update...', false);
    try {
      var response = await window.api.post('/api/v1/search/shadow-update', {
        entity_type: result.entity_type || result.source_type || 'record',
        entity_id: result.entity_id || result.id || '',
        external_id: result.external_id || '',
        source_table: result.source_table || '',
        edited_data: edited,
        original_data: editorJsonForResult(result)
      });

      result.shadow_update = response.shadow_update;
      if (!isPlainObject(result.metadata)) result.metadata = {};
      if (!isPlainObject(result.metadata.data)) result.metadata.data = {};
      result.metadata.data.raw = edited;
      try {
        var routeParams = params();
        var key = routeParams.get('result_key');
        if (key) sessionStorage.setItem('lana-search-result:' + key, JSON.stringify(result));
      } catch (_err) {}
      closeEditor();
      render(result, state.graph);
    } catch (error) {
      setEditorStatus(error.message || 'Failed to save shadow update.', true);
    }
  }

  async function loadRelated(result) {
    if (!result || !window.api || typeof window.api.get !== 'function') return null;
    var query = new URLSearchParams();
    query.set('entity_id', result.entity_id || result.id || '');
    if (result.external_id) query.set('external_id', result.external_id);
    if (result.matter_id) query.set('matter_id', result.matter_id);
    query.set('entity_type', result.entity_type || result.source_type || '');
    query.set('title', result.title || '');
    query.set('limit', '50');
    try {
      return await window.api.get('/api/v1/search/related?' + query.toString());
    } catch (_err) {
      return null;
    }
  }

  async function init() {
    var routeParams = params();
    if (!routeParams.get('entity_id') && !routeParams.get('id') && !routeParams.get('external_id') && !routeParams.get('result_key')) {
      if (window.UnifiedSearchModal && typeof window.UnifiedSearchModal.openPending === 'function') {
        window.UnifiedSearchModal.openPending({ openEmpty: true, force: true });
      }
      return;
    }

    var result = storedResult(routeParams) || {
      entity_id: routeParams.get('entity_id') || routeParams.get('id') || '',
      external_id: routeParams.get('external_id') || '',
      entity_type: routeParams.get('entity_type') || 'record',
      title: routeParams.get('title') || routeParams.get('external_id') || routeParams.get('entity_id') || 'Search result'
    };
    render(result, { loading: true });
    render(result, await loadRelated(result));
  }

  if (window.LexRouter && typeof window.LexRouter.registerPageInit === 'function') {
    window.LexRouter.registerPageInit('search-results.html', init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

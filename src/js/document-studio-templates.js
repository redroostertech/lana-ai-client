/* Document Studio Templates — unified template list/picker controller (C3).

   Renders the unified read model that lists templates across the three engines
   (fill / compose / render) from a single endpoint. Read-only for v1.

   Rules:
     - NO regex anywhere — string methods only (LEX-COMPONENT-RULES section 11)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - IIFE wrapper to keep scope clean
     - Thin: query building + DTO->view-model mapping live in the pure mapper
       module (document-studio-templates-mapper.js); backend rules stay server-side.

   @requires api.js                              — window.api
   @requires document-studio-api.js              — window.DocumentStudioAPI
   @requires document-studio-templates-mapper.js — window.DocumentStudioTemplatesMapper
   @requires lex.utils.js                        — Lex.Utils.escapeHtml / timeAgo
   @requires lex-toast.js                        — Lex.Toast
   @requires lex-pagination / lex-segmented / lex-drawer components
*/

(function () {
  'use strict';

  // ===========================================================================
  // Lex aliases
  // ===========================================================================

  var escHtml = Lex.Utils.escapeHtml;
  var timeAgo = Lex.Utils.timeAgo;

  var DocStudioAPI = window.DocumentStudioAPI;
  var mapper = window.DocumentStudioTemplatesMapper;

  // ===========================================================================
  // Shared helpers
  // ===========================================================================

  function el(id) {
    return document.getElementById(id);
  }

  function show(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.remove('hidden');
  }

  function hide(target) {
    var elem = typeof target === 'string' ? el(target) : target;
    if (elem) elem.classList.add('hidden');
  }

  function getQueryParam(name) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || '';
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    try {
      return timeAgo(value);
    } catch (e) {
      return String(value);
    }
  }

  // ===========================================================================
  // Renderers (string-built, escaped)
  // ===========================================================================

  /**
   * Kind badge HTML string.
   * @param {string} kind — fill | compose | render
   * @param {string} label
   * @returns {string}
   */
  function kindBadge(kind, label) {
    var k = String(kind || '').toLowerCase();
    return '<span class="dst-kind dst-kind-' + escHtml(k) + '">' + escHtml(label || k) + '</span>';
  }

  /**
   * Build one row of metadata pills (document type, scope, counts) for a row.
   * @param {Object} row — mapped view-model
   * @returns {string}
   */
  function rowMetaHtml(row) {
    var pills = [];

    var typeLabel = row.documentTypeLabel || row.documentType || row.category;
    if (typeLabel) {
      pills.push('<span class="dst-meta-pill">' + escHtml(typeLabel) + '</span>');
    }

    pills.push('<span class="dst-meta-pill dst-meta-scope">' + escHtml(row.scopeLabel) + '</span>');

    if (row.matterId) {
      pills.push('<span class="dst-meta-pill">Matter: ' + escHtml(row.matterId) + '</span>');
    }
    if (row.documentCount !== null) {
      pills.push('<span class="dst-meta-pill">' + escHtml(String(row.documentCount)) + ' docs</span>');
    }
    if (row.variableCount !== null) {
      pills.push('<span class="dst-meta-pill">' + escHtml(String(row.variableCount)) + ' variables</span>');
    }

    return pills.join('');
  }

  function renderRow(row) {
    var desc = row.description
      ? '<div class="dst-item-desc">' + escHtml(row.description) + '</div>'
      : '';

    return '' +
      '<div class="dst-item" data-kind="' + escHtml(row.kind) + '" data-id="' + escHtml(row.id) + '">' +
        '<div class="dst-item-main">' +
          '<div class="dst-item-head">' +
            kindBadge(row.kind, row.kindLabel) +
            '<span class="dst-item-name">' + escHtml(row.name) + '</span>' +
          '</div>' +
          desc +
          '<div class="dst-item-meta">' + rowMetaHtml(row) + '</div>' +
        '</div>' +
        '<div class="dst-item-aside">' +
          '<span class="dst-item-updated">Updated ' + escHtml(formatTimestamp(row.updatedAt)) + '</span>' +
        '</div>' +
      '</div>';
  }

  // ===========================================================================
  // Page state
  // ===========================================================================

  var _state = {
    currentPage: 1,
    pageSize: 25,
    kindFilter: '',
    includeOrgWide: true,
    matterId: '',
    searchTerm: '',
    searchDebounce: null,
    totalItems: 0,
    rowsByKey: {}
  };

  function _rowKey(kind, id) {
    return String(kind) + ':' + String(id);
  }

  // ===========================================================================
  // Data access (thin — delegates query building + mapping)
  // ===========================================================================

  function _currentFilters() {
    return {
      kind: _state.kindFilter,
      matterId: _state.matterId,
      q: _state.searchTerm,
      includeOrgWide: _state.includeOrgWide,
      limit: _state.pageSize,
      offset: (_state.currentPage - 1) * _state.pageSize
    };
  }

  function _fetchTemplates() {
    show('dstLoading');
    hide('dstCard');
    hide('dstPagination');
    hide('dstEmpty');

    DocStudioAPI.listTemplates(_currentFilters()).then(function (res) {
      var view = mapper.mapTemplates(res);

      _state.totalItems = view.total;
      _updateCounts(view.countsByKind);

      hide('dstLoading');

      // Index rows so the detail drawer can show list data immediately.
      _state.rowsByKey = {};
      for (var i = 0; i < view.rows.length; i++) {
        _state.rowsByKey[_rowKey(view.rows[i].kind, view.rows[i].id)] = view.rows[i];
      }

      if (!view.rows.length) {
        show('dstEmpty');
        return;
      }

      _renderList(view.rows);

      var totalPages = Math.max(1, Math.ceil(view.total / _state.pageSize));
      var pag = el('dstPagination');
      if (pag) {
        pag.setAttribute('page', String(_state.currentPage));
        pag.setAttribute('total-pages', String(totalPages));
        pag.setAttribute('total', String(view.total));
        pag.setAttribute('limit', String(_state.pageSize));
        show(pag);
      }

      show('dstCard');
    }).catch(function (err) {
      hide('dstLoading');
      Lex.Toast.error('Failed to load templates: ' + (err && err.message ? err.message : 'Unknown error'));
      show('dstEmpty');
    });
  }

  function _updateCounts(counts) {
    var fill = el('dstCountFill');
    var compose = el('dstCountCompose');
    var render = el('dstCountRender');
    if (fill) fill.textContent = String(counts.fill);
    if (compose) compose.textContent = String(counts.compose);
    if (render) render.textContent = String(counts.render);
  }

  // ===========================================================================
  // List rendering + selection
  // ===========================================================================

  function _renderList(rows) {
    var list = el('dstList');
    if (!list) return;

    var html = '';
    for (var i = 0; i < rows.length; i++) {
      html += renderRow(rows[i]);
    }
    list.innerHTML = html;

    var items = list.querySelectorAll('.dst-item');
    for (var j = 0; j < items.length; j++) {
      (function (item) {
        item.addEventListener('click', function () {
          _openDetail(item.dataset.kind, item.dataset.id);
        });
      })(items[j]);
    }
  }

  // ===========================================================================
  // Detail drawer (read-only v1)
  // ===========================================================================

  function _openDetail(kind, id) {
    var drawer = el('dstDetailDrawer');
    var body = el('dstDetailBody');
    if (!drawer || !body) return;

    var seed = _state.rowsByKey[_rowKey(kind, id)];
    drawer.setAttribute('heading', seed ? seed.name : 'Template');
    body.innerHTML = '<div class="dst-detail-loading"><lex-spinner></lex-spinner></div>';
    drawer.open = true;

    DocStudioAPI.getTemplate(kind, id).then(function (dto) {
      body.innerHTML = _renderDetail(dto);
    }).catch(function (err) {
      body.innerHTML = '<div class="dst-detail-error">Failed to load template: ' +
        escHtml(err && err.message ? err.message : 'Unknown error') + '</div>';
    });
  }

  function _detailRow(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return '<div class="dst-detail-row">' +
      '<span class="dst-detail-label">' + escHtml(label) + '</span>' +
      '<span class="dst-detail-value">' + escHtml(String(value)) + '</span>' +
      '</div>';
  }

  function _renderDetail(dto) {
    var row = mapper.mapTemplateRow(dto);

    var html = '<div class="dst-detail">';
    html += '<div class="dst-detail-head">' + kindBadge(row.kind, row.kindLabel) +
      '<span class="dst-detail-name">' + escHtml(row.name) + '</span></div>';

    if (row.description) {
      html += '<p class="dst-detail-desc">' + escHtml(row.description) + '</p>';
    }

    html += _detailRow('Type', row.documentTypeLabel || row.documentType || row.category);
    html += _detailRow('Scope', row.scopeLabel);
    html += _detailRow('Matter', row.matterId);
    html += _detailRow('Status', row.status);
    if (row.version !== null) html += _detailRow('Version', row.version);
    if (row.documentCount !== null) html += _detailRow('Documents', row.documentCount);
    if (row.variableCount !== null) html += _detailRow('Variables', row.variableCount);
    html += _detailRow('Created', formatTimestamp(row.createdAt));
    html += _detailRow('Updated', formatTimestamp(row.updatedAt));

    html += '</div>';
    return html;
  }

  // ===========================================================================
  // Event wiring
  // ===========================================================================

  function _bindEvents() {
    var kindFilter = el('dstKindFilter');
    if (kindFilter) {
      kindFilter.addEventListener('lex-change', function (e) {
        _state.kindFilter = (e.detail && e.detail.value) || '';
        _state.currentPage = 1;
        _fetchTemplates();
      });
    }

    var orgWide = el('dstOrgWideToggle');
    if (orgWide) {
      orgWide.addEventListener('change', function () {
        _state.includeOrgWide = !!orgWide.checked;
        _state.currentPage = 1;
        _fetchTemplates();
      });
    }

    var searchInput = el('dstSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(_state.searchDebounce);
        _state.searchDebounce = setTimeout(function () {
          _state.searchTerm = searchInput.value.trim();
          _state.currentPage = 1;
          _fetchTemplates();
        }, 350);
      });
    }

    var pag = el('dstPagination');
    if (pag) {
      pag.addEventListener('page-change', function (e) {
        _state.currentPage = (e.detail && e.detail.page) || 1;
        _fetchTemplates();
      });
    }
  }

  // ===========================================================================
  // Init
  // ===========================================================================

  function init() {
    // Optional matter scope from the URL (?matter_id=...) — "what can I use here".
    _state.matterId = getQueryParam('matter_id');
    _bindEvents();
    _fetchTemplates();
  }

  if (window.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('document-studio-templates.html', init);
  }
  init();
})();

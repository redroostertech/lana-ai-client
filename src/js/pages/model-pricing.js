/* model-pricing.js — Admin page for managing per-model token costs.

   Loads from GET /api/v1/admin/model-pricing, supports POST/PUT/DELETE.

   The form accepts costs as USD per 1M tokens (the most common vendor
   unit) and converts to microdollars per token on save:
     micro_per_token = (usd_per_million / 1_000_000) * 1_000_000 = usd_per_million
   In other words: 1 USD per 1M tokens == 1 microdollar per token. We
   spell that out in the help text and in the conversion helpers below.

   Rules (LEX-COMPONENT-RULES.md):
     - IIFE wrapper, no top-level const/class
     - Lex.Nav.go() for navigation (no window.location.href)
     - All HTML escaping via Lex.Utils.escapeHtml()
     - NO regex — string methods only
*/

(function () {
  'use strict';

  var escHtml = (window.Lex && Lex.Utils && Lex.Utils.escapeHtml)
    ? Lex.Utils.escapeHtml
    : function (s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };

  var formatDate = (window.Lex && Lex.Utils && Lex.Utils.formatDate)
    ? Lex.Utils.formatDate
    : function (s) { return s ? String(s) : ''; };

  // =========================================================================
  // State
  // =========================================================================

  var _rows         = [];
  // 'add' | 'edit' — drives modal heading and which API call we issue.
  var _formMode     = 'add';
  var _editingRow   = null;
  // Row being targeted by the delete confirm modal.
  var _deleteRow    = null;

  // =========================================================================
  // Helpers
  // =========================================================================

  function el(id) { return document.getElementById(id); }
  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

  function setVal(id, value) {
    var n = el(id);
    if (n) n.value = (value == null ? '' : value);
  }

  function trimStr(v) {
    if (v == null) return '';
    var s = String(v);
    if (typeof s.trim === 'function') return s.trim();
    return s;
  }

  // Convert a UI value (USD per 1M tokens) into the canonical microdollars
  // per token used by the backend. Returns null for empty/invalid input.
  // 1 USD per 1M tokens == 1 microdollar per token (1 USD == 1e6 micro,
  // and 1M tokens scales by 1e-6 — they cancel).
  function usdPerMillionToMicrodollars(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    if (isNaN(n)) return null;
    if (n < 0) return null;
    return Math.round(n);
  }

  // Inverse of the above — used when populating the edit form.
  function microdollarsToUsdPerMillion(micro) {
    if (micro == null || micro === '') return '';
    var n = Number(micro);
    if (isNaN(n)) return '';
    return String(n);
  }

  // Format microdollars-per-token for display in the table. Renders as
  // dollars per 1k tokens (a more intuitive granularity than per-token).
  // 1 micro/token == $0.001 per 1k tokens, so:
  //   $/1k = micro / 1000
  // Avoid regex per project rules — manual decimal formatting.
  function formatMicroAsPer1k(micro, currency) {
    if (micro == null || micro === '' || isNaN(Number(micro))) return '-';
    var n = Number(micro);
    var per1k = n / 1000;
    var sign = currency === 'EUR' ? '€'
             : currency === 'GBP' ? '£'
             : '$';
    // 7 decimal places lets us distinguish very-low-cost models without
    // showing trailing zeros for the common $/M case. Strip trailing zeros
    // manually (no regex).
    var fixed = per1k.toFixed(7);
    var s = stripTrailingZeros(fixed);
    return sign + s + ' / 1k tokens';
  }

  function stripTrailingZeros(s) {
    if (!s) return s;
    var dotIdx = s.indexOf('.');
    if (dotIdx === -1) return s;
    var end = s.length;
    while (end > dotIdx + 1 && s.charAt(end - 1) === '0') end--;
    if (s.charAt(end - 1) === '.') end--;
    return s.substring(0, end);
  }

  function truncate(s, max) {
    if (s == null) return '';
    var str = String(s);
    if (str.length <= max) return str;
    return str.substring(0, max - 1) + '…';
  }

  // Validate a numeric string entered into a form field. Returns:
  //   { ok: true, micro: <number> }
  //   { ok: false, error: <message> }
  function validateCostField(label, raw) {
    if (raw == null || trimStr(raw) === '') {
      return { ok: false, error: label + ' is required.' };
    }
    var n = Number(raw);
    if (isNaN(n)) return { ok: false, error: label + ' must be a number.' };
    if (n < 0) return { ok: false, error: label + ' must be zero or positive.' };
    return { ok: true, micro: usdPerMillionToMicrodollars(raw) };
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  function renderRows() {
    var tbody = el('modelPricingTbody');
    var tableCard = el('modelPricingTableCard');
    var emptyEl = el('modelPricingEmpty');
    var loadingEl = el('modelPricingLoading');

    hide(loadingEl);
    hide(el('modelPricingUnavailable'));
    hide(el('modelPricingForbidden'));

    if (!_rows || _rows.length === 0) {
      if (tbody) tbody.innerHTML = '';
      hide(tableCard);
      show(emptyEl);
      return;
    }

    if (!tbody) return;
    var html = '';
    for (var i = 0; i < _rows.length; i++) {
      html += renderRowHtml(_rows[i]);
    }
    tbody.innerHTML = html;
    hide(emptyEl);
    show(tableCard);
  }

  function renderRowHtml(row) {
    var id = escHtml(row && row.id != null ? row.id : '');
    var modelName = escHtml(row && row.model_name ? row.model_name : '');
    var provider = escHtml(row && row.provider ? row.provider : '');
    var currency = escHtml(row && row.currency ? row.currency : 'USD');
    var notesRaw = row && row.notes ? row.notes : '';
    var notes = escHtml(truncate(notesRaw, 80));
    var notesTitle = escHtml(notesRaw);
    var inputCost = escHtml(formatMicroAsPer1k(row && row.input_token_microdollars, row && row.currency));
    var outputCost = escHtml(formatMicroAsPer1k(row && row.output_token_microdollars, row && row.currency));
    var created = escHtml(row && row.created_at ? formatDate(row.created_at) : '');

    return ''
      + '<tr data-row-id="' + id + '">'
      +   '<td class="model-pricing-cell-model">' + (modelName || '<span class="model-pricing-empty-text">(unnamed)</span>') + '</td>'
      +   '<td class="model-pricing-cell-provider">' + (provider || '<span class="model-pricing-empty-text">-</span>') + '</td>'
      +   '<td class="model-pricing-cell-cost">' + inputCost + '</td>'
      +   '<td class="model-pricing-cell-cost">' + outputCost + '</td>'
      +   '<td class="model-pricing-cell-currency">' + currency + '</td>'
      +   '<td class="model-pricing-cell-notes" title="' + notesTitle + '">' + (notes || '<span class="model-pricing-empty-text">-</span>') + '</td>'
      +   '<td class="model-pricing-cell-created">' + created + '</td>'
      +   '<td class="model-pricing-cell-actions">'
      +     '<lex-btn variant="ghost" size="sm" data-action="edit" data-row-id="' + id + '">Edit</lex-btn>'
      +     '<lex-btn variant="ghost" size="sm" data-action="delete" data-row-id="' + id + '">Delete</lex-btn>'
      +   '</td>'
      + '</tr>';
  }

  // =========================================================================
  // Data — list
  // =========================================================================

  function loadRows() {
    var loadingEl = el('modelPricingLoading');
    show(loadingEl);
    hide(el('modelPricingTableCard'));
    hide(el('modelPricingEmpty'));
    hide(el('modelPricingUnavailable'));
    hide(el('modelPricingForbidden'));

    if (!window.api || typeof window.api.get !== 'function') {
      document.addEventListener('lex-ready', loadRows, { once: true });
      return;
    }

    window.api.get('/api/v1/admin/model-pricing')
      .then(function (resp) {
        var rows = [];
        if (Array.isArray(resp)) rows = resp;
        else if (resp && Array.isArray(resp.rows)) rows = resp.rows;
        else if (resp && Array.isArray(resp.data)) rows = resp.data;
        _rows = rows;
        renderRows();
      })
      .catch(function (err) {
        console.error('[model-pricing] Failed to load:', err);
        _rows = [];
        showLoadError(err);
      });
  }

  function showLoadError(err) {
    var loadingEl = el('modelPricingLoading');
    hide(loadingEl);
    hide(el('modelPricingTableCard'));
    hide(el('modelPricingEmpty'));

    var status = err && (err.status || (err.response && err.response.status));

    if (status === 401) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Your session expired. Please sign in again.');
      if (window.Lex && Lex.Nav) Lex.Nav.go('login.html');
      return;
    }
    if (status === 403) {
      show(el('modelPricingForbidden'));
      return;
    }
    if (status === 404 || status === 501) {
      show(el('modelPricingUnavailable'));
      return;
    }
    // Other errors — show unavailable card with a more general message and
    // toast the underlying problem.
    show(el('modelPricingUnavailable'));
    if (window.Lex && Lex.Toast) Lex.Toast.error('Unable to load model pricing.');
  }

  // =========================================================================
  // Add / Edit form
  // =========================================================================

  function openAddModal() {
    _formMode = 'add';
    _editingRow = null;
    populateForm(null);
    var modal = el('modelPricingFormModal');
    if (modal) {
      modal.heading = 'Add pricing';
      modal.confirmText = 'Save';
      modal.open = true;
    }
  }

  function openEditModal(row) {
    if (!row) return;
    _formMode = 'edit';
    _editingRow = row;
    populateForm(row);
    var modal = el('modelPricingFormModal');
    if (modal) {
      modal.heading = 'Edit pricing — ' + (row.model_name || '');
      modal.confirmText = 'Save';
      modal.open = true;
    }
  }

  function populateForm(row) {
    setVal('modelPricingFormName', row && row.model_name ? row.model_name : '');
    setVal('modelPricingFormProvider', row && row.provider ? row.provider : '');
    setVal('modelPricingFormInputCost',
      row && row.input_token_microdollars != null ? microdollarsToUsdPerMillion(row.input_token_microdollars) : '');
    setVal('modelPricingFormOutputCost',
      row && row.output_token_microdollars != null ? microdollarsToUsdPerMillion(row.output_token_microdollars) : '');
    setVal('modelPricingFormNotes', row && row.notes ? row.notes : '');

    var currencyEl = el('modelPricingFormCurrency');
    if (currencyEl) {
      currencyEl.value = (row && row.currency) ? row.currency : 'USD';
    }

    // model_name is read-only on edit per the API contract.
    var nameInput = el('modelPricingFormName');
    if (nameInput) {
      if (_formMode === 'edit') {
        nameInput.disabled = true;
        nameInput.setAttribute('readonly', 'readonly');
        nameInput.title = 'Model name cannot be changed after creation.';
      } else {
        nameInput.disabled = false;
        nameInput.removeAttribute('readonly');
        nameInput.title = '';
      }
    }
  }

  function readForm() {
    var name = trimStr(el('modelPricingFormName') && el('modelPricingFormName').value);
    var provider = trimStr(el('modelPricingFormProvider') && el('modelPricingFormProvider').value);
    var inputRaw = el('modelPricingFormInputCost') && el('modelPricingFormInputCost').value;
    var outputRaw = el('modelPricingFormOutputCost') && el('modelPricingFormOutputCost').value;
    var currency = (el('modelPricingFormCurrency') && el('modelPricingFormCurrency').value) || 'USD';
    var notes = trimStr(el('modelPricingFormNotes') && el('modelPricingFormNotes').value);

    return {
      name: name,
      provider: provider,
      inputRaw: inputRaw,
      outputRaw: outputRaw,
      currency: currency,
      notes: notes
    };
  }

  function submitForm() {
    var f = readForm();

    if (_formMode === 'add' && !f.name) {
      if (window.Lex && Lex.Toast) Lex.Toast.error('Model name is required.');
      return;
    }

    var inputCheck = validateCostField('Input cost', f.inputRaw);
    if (!inputCheck.ok) {
      if (window.Lex && Lex.Toast) Lex.Toast.error(inputCheck.error);
      return;
    }
    var outputCheck = validateCostField('Output cost', f.outputRaw);
    if (!outputCheck.ok) {
      if (window.Lex && Lex.Toast) Lex.Toast.error(outputCheck.error);
      return;
    }

    if (_formMode === 'add') {
      submitCreate(f, inputCheck.micro, outputCheck.micro);
    } else {
      submitUpdate(f, inputCheck.micro, outputCheck.micro);
    }
  }

  function submitCreate(f, inputMicro, outputMicro) {
    if (!window.api || typeof window.api.post !== 'function') return;

    var body = {
      model_name: f.name,
      input_token_microdollars: inputMicro,
      output_token_microdollars: outputMicro
    };
    if (f.provider) body.provider = f.provider;
    if (f.currency) body.currency = f.currency;
    if (f.notes) body.notes = f.notes;

    window.api.post('/api/v1/admin/model-pricing', body)
      .then(function () {
        var modal = el('modelPricingFormModal');
        if (modal) modal.open = false;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Pricing added');
        loadRows();
      })
      .catch(function (err) { handleWriteError('add', err); });
  }

  function submitUpdate(f, inputMicro, outputMicro) {
    if (!_editingRow || _editingRow.id == null) return;
    if (!window.api || typeof window.api.put !== 'function') return;

    // model_name is intentionally absent from the PUT body — it's read-only
    // on edit per the API contract.
    var body = {
      provider: f.provider,
      input_token_microdollars: inputMicro,
      output_token_microdollars: outputMicro,
      currency: f.currency,
      notes: f.notes
    };

    window.api.put('/api/v1/admin/model-pricing/' + encodeURIComponent(_editingRow.id), body)
      .then(function () {
        var modal = el('modelPricingFormModal');
        if (modal) modal.open = false;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Pricing updated');
        loadRows();
      })
      .catch(function (err) { handleWriteError('update', err); });
  }

  function handleWriteError(op, err) {
    console.error('[model-pricing] ' + op + ' failed:', err);
    var status = err && (err.status || (err.response && err.response.status));
    var msg = (op === 'add' ? 'Unable to add pricing'
            : op === 'update' ? 'Unable to update pricing'
            : 'Unable to delete pricing');
    if (status === 400) msg = 'Some fields look invalid. Check name and costs.';
    else if (status === 401) {
      msg = 'Your session expired. Please sign in again.';
      if (window.Lex && Lex.Nav) Lex.Nav.go('login.html');
    } else if (status === 403) msg = 'You do not have permission to manage pricing.';
    else if (status === 404) msg = 'That pricing row no longer exists.';
    else if (status === 409) msg = 'A pricing row for that model already exists.';
    else if (status === 501) msg = 'Model pricing API is not available on this server.';
    if (window.Lex && Lex.Toast) Lex.Toast.error(msg);
  }

  // =========================================================================
  // Delete confirm
  // =========================================================================

  function openDeleteModal(row) {
    if (!row) return;
    _deleteRow = row;
    var modal = el('modelPricingDeleteModal');
    var target = el('modelPricingDeleteTarget');
    if (target) target.textContent = row.model_name || ('row #' + row.id);
    if (modal) modal.open = true;
  }

  function performDelete() {
    if (!_deleteRow || _deleteRow.id == null) return;
    if (!window.api || typeof window.api.delete !== 'function') return;

    var rowId = _deleteRow.id;
    window.api.delete('/api/v1/admin/model-pricing/' + encodeURIComponent(rowId))
      .then(function () {
        var modal = el('modelPricingDeleteModal');
        if (modal) modal.open = false;
        _deleteRow = null;
        if (window.Lex && Lex.Toast) Lex.Toast.success('Pricing deleted');
        loadRows();
      })
      .catch(function (err) { handleWriteError('delete', err); });
  }

  // =========================================================================
  // Wiring
  // =========================================================================

  function findRowById(id) {
    if (id == null) return null;
    var key = String(id);
    for (var i = 0; i < _rows.length; i++) {
      if (_rows[i] && String(_rows[i].id) === key) return _rows[i];
    }
    return null;
  }

  function wireBanner() {
    var addBtn = el('modelPricingAddBtn');
    if (addBtn && !addBtn._modelPricingWired) {
      addBtn._modelPricingWired = true;
      addBtn.addEventListener('click', openAddModal);
    }
  }

  function wireTable() {
    var card = el('modelPricingTableCard');
    if (!card || card._modelPricingWired) return;
    card._modelPricingWired = true;

    card.addEventListener('click', function (evt) {
      var actionBtn = evt.target.closest('[data-action]');
      if (!actionBtn) return;
      var action = actionBtn.getAttribute('data-action');
      var rowId = actionBtn.getAttribute('data-row-id');
      var row = findRowById(rowId);
      if (!row) return;
      if (action === 'edit') openEditModal(row);
      else if (action === 'delete') openDeleteModal(row);
    });
  }

  function wireFormModal() {
    var modal = el('modelPricingFormModal');
    if (modal && !modal._modelPricingWired) {
      modal._modelPricingWired = true;
      modal.addEventListener('lex-confirm', submitForm);
    }

    var deleteModal = el('modelPricingDeleteModal');
    if (deleteModal && !deleteModal._modelPricingWired) {
      deleteModal._modelPricingWired = true;
      deleteModal.addEventListener('lex-confirm', performDelete);
    }
  }

  // =========================================================================
  // Init
  // =========================================================================

  function init() {
    wireBanner();
    wireTable();
    wireFormModal();
    loadRows();
  }

  if (window.LexRouter) {
    LexRouter.registerPageInit('model-pricing.html', init);
  }
  init();
})();

/**
 * docx-template-modal.js — Shared DOCX template generation modal logic.
 *
 * Reusable across any page that has:
 *   1. A lex-modal with the standard template modal HTML structure
 *   2. An api object (api.baseUrl, api.token)
 *
 * Usage:
 *   var modal = new DocxTemplateModal({
 *     prefix: 'fv',           // Element ID prefix (e.g., 'fv' for file-viewer, 'docxTemplate' for workspace-details)
 *     getContacts: function() { return [...]; },  // Return array of contact objects
 *     onGenerated: function(data) { ... },        // Called after successful generation
 *     onError: function(msg) { ... },             // Called on error
 *     onSuccess: function(msg) { ... }            // Called on success
 *   });
 *
 *   modal.open(docId, matterId, docName);
 *   modal.close();
 *   modal.generate();
 *
 * Exposed globally as window.DocxTemplateModal
 */
(function () {
  'use strict';

  // =========================================================================
  // Category icons (inline SVGs)
  // =========================================================================

  var CATEGORY_ICONS = {
    'check-square': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>',
    'credit-card': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>',
    'calendar': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>',
    'dollar-sign': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
    'user': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>',
    'map-pin': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>',
    'phone': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>',
    'edit': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>',
    'file-text': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
    'hash': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path></svg>',
    'more-horizontal': '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"></path></svg>'
  };

  // =========================================================================
  // Helpers
  // =========================================================================

  function _escapeHtml(text) {
    if (!text) return '';
    var str = String(text);
    var result = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === '&') result += '&amp;';
      else if (ch === '<') result += '&lt;';
      else if (ch === '>') result += '&gt;';
      else if (ch === '"') result += '&quot;';
      else if (ch === "'") result += '&#39;';
      else result += ch;
    }
    return result;
  }

  /**
   * Resolve a placeholder value for client-side preview.
   * Works for contact.*, matter.*, and date.* namespaces.
   */
  function _resolvePreview(placeholder, contact, matterData) {
    if (!contact) return '';

    // Contact namespace
    if (placeholder === 'contact.first_name') return contact.first_name || '';
    if (placeholder === 'contact.last_name') return contact.last_name || '';
    if (placeholder === 'contact.full_name') return ((contact.first_name || '') + ' ' + (contact.last_name || '')).trim();
    if (placeholder === 'contact.display_name') return contact.display_name || '';
    if (placeholder === 'contact.email') return contact.email || '';
    if (placeholder === 'contact.phone_mobile') return contact.phone_mobile || '';
    if (placeholder === 'contact.phone_work') return contact.phone_work || '';
    if (placeholder === 'contact.phone_home') return contact.phone_home || '';
    if (placeholder === 'contact.phone_fax') return contact.phone_fax || '';
    if (placeholder === 'contact.company_name') return contact.company_name || '';
    if (placeholder === 'contact.title') return contact.title || '';
    if (placeholder === 'contact.role') return contact.role || '';
    if (placeholder === 'contact.participant_type') return contact.participant_type || '';

    // Address fields
    if (placeholder.indexOf('contact.address') === 0 && contact.address) {
      var addr = typeof contact.address === 'string' ? JSON.parse(contact.address) : contact.address;
      if (placeholder === 'contact.address_street') return [addr.street, addr.street2].filter(Boolean).join(', ');
      if (placeholder === 'contact.address_city') return addr.city || '';
      if (placeholder === 'contact.address_state') return addr.state || '';
      if (placeholder === 'contact.address_zip') return addr.zip || '';
      if (placeholder === 'contact.address_country') return addr.country || '';
      if (placeholder === 'contact.address_full') {
        return [addr.street, addr.street2, [addr.city, addr.state, addr.zip].filter(Boolean).join(', '), addr.country].filter(Boolean).join(', ');
      }
    }

    // Date namespace
    if (placeholder === 'date.today') {
      var now = new Date();
      return String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + '/' + now.getFullYear();
    }
    if (placeholder === 'date.today_long') {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var d = new Date();
      return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
    if (placeholder === 'date.year') return String(new Date().getFullYear());
    if (placeholder === 'date.month') {
      var ms = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return ms[new Date().getMonth()];
    }
    if (placeholder === 'date.day') return String(new Date().getDate()).padStart(2, '0');

    // Matter namespace
    if (placeholder.indexOf('matter.') === 0 && matterData) {
      if (placeholder === 'matter.name') return matterData.name || matterData.matter_name || '';
      if (placeholder === 'matter.matter_number') return matterData.matter_number || matterData.matter_id || '';
      if (placeholder === 'matter.status') return matterData.status || '';
      if (placeholder === 'matter.client_name') return matterData.client_name || '';
      if (placeholder === 'matter.description') return matterData.description || '';
    }

    return '';
  }

  /**
   * Convert base64 string to Blob for download
   */
  function _base64ToBlob(base64, contentType) {
    var byteChars = atob(base64);
    var byteNumbers = new Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    var byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: contentType });
  }

  // =========================================================================
  // DocxTemplateModal constructor
  // =========================================================================

  /**
   * @param {Object} opts
   * @param {string} opts.prefix - Element ID prefix for all modal elements
   * @param {Function} opts.getContacts - Returns array of contact objects for the current matter
   * @param {Function} [opts.getMatterData] - Returns current matter data for preview resolution
   * @param {Function} [opts.onGenerated] - Called after successful generation with response data
   * @param {Function} [opts.onError] - Called with error message string
   * @param {Function} [opts.onSuccess] - Called with success message string
   */
  function DocxTemplateModal(opts) {
    this.prefix = opts.prefix;
    this.getContacts = opts.getContacts;
    this.getMatterData = opts.getMatterData || function () { return null; };
    this.onGenerated = opts.onGenerated || function () {};
    this.onError = opts.onError || function (msg) { console.error('[DocxTemplateModal]', msg); };
    this.onSuccess = opts.onSuccess || function () {};

    this.state = {
      docId: null,
      matterId: null,
      docName: '',
      placeholders: [],
      blanks: [],
      categories: [],
      contacts: [],
      selectedContact: null,
      variableNamespace: null
    };
  }

  // =========================================================================
  // Element accessors (prefix-aware)
  // =========================================================================

  DocxTemplateModal.prototype._el = function (suffix) {
    return document.getElementById(this.prefix + suffix);
  };

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Open the modal and load template data.
   */
  DocxTemplateModal.prototype.open = function (docId, matterId, docName) {
    var self = this;
    self.state.docId = docId;
    self.state.matterId = matterId;
    self.state.docName = docName;

    // Reset UI
    var titleEl = self._el('Title');
    var placeholdersEl = self._el('Placeholders');
    var contactSelect = self._el('ContactSelect');
    var previewDiv = self._el('Preview');
    var blanksDiv = self._el('Blanks');
    var customVarsDiv = self._el('CustomVars');
    var genBtn = self._el('GenerateBtn');

    if (titleEl) titleEl.textContent = docName || 'Template';
    if (placeholdersEl) placeholdersEl.textContent = 'Loading...';
    if (contactSelect) contactSelect.innerHTML = '<option value="">-- Choose a contact --</option>';
    if (previewDiv) previewDiv.classList.add('hidden');
    if (blanksDiv) blanksDiv.classList.add('hidden');
    if (customVarsDiv) customVarsDiv.classList.add('hidden');
    if (genBtn) genBtn.disabled = true;

    var modal = self._el('Modal');
    if (modal) modal.open = true;

    // Wire cancel and generate buttons
    var cancelBtn = self._el('CancelBtn');
    if (cancelBtn) cancelBtn.onclick = function () { self.close(); };
    var genBtn2 = self._el('GenerateBtn');
    if (genBtn2) genBtn2.onclick = function () { self.generate(); };

    self._loadData().catch(function (err) {
      self.onError('Failed to load template data: ' + err.message);
    });
  };

  /**
   * Close the modal.
   */
  DocxTemplateModal.prototype.close = function () {
    var modal = this._el('Modal');
    if (modal) modal.open = false;
  };

  /**
   * Generate document from the template.
   */
  DocxTemplateModal.prototype.generate = function () {
    return this._generate();
  };

  // =========================================================================
  // Internal: load template data
  // =========================================================================

  DocxTemplateModal.prototype._loadData = async function () {
    var self = this;
    var st = self.state;

    // Fetch template variables
    var varsResponse = await fetch(api.baseUrl + '/api/v1/matters/' + st.matterId + '/documents/' + st.docId + '/template-variables', {
      headers: { 'Authorization': 'Bearer ' + api.token }
    });
    var varsResult = await varsResponse.json();
    if (!varsResponse.ok) {
      throw new Error(varsResult.error || varsResult.message || 'Failed to fetch template variables');
    }

    var varsData = varsResult.data || varsResult;
    st.placeholders = varsData.placeholders || [];
    st.blanks = varsData.blanks || [];
    st.categories = varsData.categories || [];
    st.variableNamespace = varsData.variable_namespace || {};

    // Update count display
    var placeholdersEl = self._el('Placeholders');
    if (placeholdersEl) {
      var countParts = [];
      if (st.placeholders.length > 0) {
        countParts.push(st.placeholders.length + ' placeholder' + (st.placeholders.length !== 1 ? 's' : ''));
      }
      if (st.blanks.length > 0) {
        countParts.push(st.blanks.length + ' blank field' + (st.blanks.length !== 1 ? 's' : ''));
      }
      placeholdersEl.textContent = countParts.length > 0 ? 'Found: ' + countParts.join(', ') : 'No fields detected';
    }

    // Load contacts
    var contacts = self.getContacts();
    if (contacts && typeof contacts.then === 'function') {
      contacts = await contacts;
    }
    st.contacts = contacts || [];

    // Populate contact dropdown
    var contactSelect = self._el('ContactSelect');
    if (contactSelect) {
      for (var i = 0; i < st.contacts.length; i++) {
        var c = st.contacts[i];
        var name = c.display_name || ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || c.email || 'Contact';
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = name + (c.email ? ' (' + c.email + ')' : '') +
          (c.participant_type && c.participant_type !== 'other' ? ' - ' + c.participant_type : '');
        contactSelect.appendChild(opt);
      }

      contactSelect.onchange = function () {
        self._onContactChange(contactSelect.value);
      };
    }

    // Render custom vars for unmapped curly brace placeholders
    self._renderCustomVars();

    // Render blank field mapping
    self._renderBlankMappings();
  };

  // =========================================================================
  // Internal: contact change
  // =========================================================================

  DocxTemplateModal.prototype._onContactChange = function (contactId) {
    var self = this;
    var st = self.state;
    var genBtn = self._el('GenerateBtn');
    var previewDiv = self._el('Preview');
    var previewList = self._el('PreviewList');

    if (!contactId) {
      if (genBtn) genBtn.disabled = true;
      if (previewDiv) previewDiv.classList.add('hidden');
      st.selectedContact = null;
      return;
    }

    var contact = null;
    for (var i = 0; i < st.contacts.length; i++) {
      if (st.contacts[i].id === contactId) {
        contact = st.contacts[i];
        break;
      }
    }

    st.selectedContact = contact;
    if (genBtn) genBtn.disabled = false;

    // Build preview
    if (previewList && contact) {
      var matterData = self.getMatterData();
      var html = '';

      // Curly brace placeholders
      if (st.placeholders.length > 0) {
        html += '<div class="text-xs font-medium text-gray-500 mb-1">Placeholders</div>';
        for (var j = 0; j < st.placeholders.length; j++) {
          var ph = st.placeholders[j];
          var val = _resolvePreview(ph, contact, matterData);
          html += '<div class="flex items-center gap-2 text-xs">' +
            '<span class="font-mono text-gray-500 w-40 truncate" title="' + _escapeHtml(ph) + '">{' + _escapeHtml(ph) + '}</span>' +
            '<span class="text-gray-400">&rarr;</span>' +
            (val ? '<span class="text-gray-900">' + _escapeHtml(val) + '</span>'
                 : '<span class="text-amber-600">Not mapped</span>') +
            '</div>';
        }
      }

      // Blank fields preview
      if (st.blanks.length > 0) {
        html += '<div class="text-xs font-medium text-gray-500 mt-2 mb-1">Blank Fields</div>';
        for (var bi = 0; bi < st.blanks.length; bi++) {
          var blank = st.blanks[bi];
          var selectEl = document.getElementById(self.prefix + 'BlankMap_' + blank.id);
          var blankVal = '';
          if (selectEl && selectEl.value && selectEl.value !== '__custom__') {
            blankVal = _resolvePreview(selectEl.value, contact, matterData);
          } else if (selectEl && selectEl.value === '__custom__') {
            var customEl = document.getElementById(self.prefix + 'BlankCustom_' + blank.id);
            blankVal = customEl ? customEl.value : '';
          }
          var blankLabel = blank.label || 'Blank ' + (bi + 1);
          html += '<div class="flex items-center gap-2 text-xs">' +
            '<span class="text-gray-500 w-40 truncate">' + _escapeHtml(blankLabel) + '</span>' +
            '<span class="text-gray-400">&rarr;</span>' +
            (blankVal ? '<span class="text-gray-900">' + _escapeHtml(blankVal) + '</span>'
                      : '<span class="text-gray-400 italic">Not mapped</span>') +
            '</div>';
        }
      }

      previewList.innerHTML = html;
      if (previewDiv) previewDiv.classList.remove('hidden');
    }
  };

  // =========================================================================
  // Internal: render custom vars for unmapped curly brace placeholders
  // =========================================================================

  DocxTemplateModal.prototype._renderCustomVars = function () {
    var self = this;
    var st = self.state;
    var customVarsDiv = self._el('CustomVars');
    var customVarsList = self._el('CustomVarsList');
    if (!customVarsDiv || !customVarsList) return;

    var ns = st.variableNamespace || {};
    var unmapped = [];
    for (var i = 0; i < st.placeholders.length; i++) {
      if (!ns[st.placeholders[i]]) unmapped.push(st.placeholders[i]);
    }

    if (unmapped.length === 0) {
      customVarsDiv.classList.add('hidden');
      return;
    }

    var html = '';
    for (var j = 0; j < unmapped.length; j++) {
      var name = unmapped[j];
      var inputId = self.prefix + 'CustomVar_' + name.split('.').join('_');
      html += '<div class="flex items-center gap-2">' +
        '<label class="text-xs font-mono text-gray-500 w-36 truncate" title="' + _escapeHtml(name) + '">{' + _escapeHtml(name) + '}</label>' +
        '<input type="text" id="' + inputId + '" class="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Enter value...">' +
        '</div>';
    }

    customVarsList.innerHTML = html;
    customVarsDiv.classList.remove('hidden');
  };

  // =========================================================================
  // Internal: render blank mappings grouped by category
  // =========================================================================

  DocxTemplateModal.prototype._renderBlankMappings = function () {
    var self = this;
    var st = self.state;
    var blanksDiv = self._el('Blanks');
    var blanksList = self._el('BlanksList');
    if (!blanksDiv || !blanksList) return;

    if (st.blanks.length === 0) {
      blanksDiv.classList.add('hidden');
      return;
    }

    var ns = st.variableNamespace || {};
    var nsKeys = Object.keys(ns).sort();
    var prefix = self.prefix;

    var blanksById = {};
    for (var b = 0; b < st.blanks.length; b++) {
      blanksById[st.blanks[b].id] = st.blanks[b];
    }

    var html = '';
    var categories = st.categories || [];

    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      var icon = CATEGORY_ICONS[cat.icon] || CATEGORY_ICONS['more-horizontal'];
      var groupId = prefix + 'BlankGroup_' + cat.id;

      html += '<div class="border border-gray-200 rounded-lg overflow-hidden">' +
        '<button type="button" class="dtm-group-toggle w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors" data-group="' + cat.id + '" data-prefix="' + prefix + '">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-gray-500">' + icon + '</span>' +
            '<span class="text-sm font-medium text-gray-800">' + _escapeHtml(cat.label) + '</span>' +
            '<span class="inline-flex items-center px-1.5 py-0.5 bg-gray-200 text-gray-600 text-xs font-medium rounded">' + cat.count + '</span>' +
          '</div>' +
          '<svg class="dtm-chevron w-4 h-4 text-gray-400 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>' +
        '</button>';

      html += '<div id="' + groupId + '" class="hidden"><div class="p-2 space-y-2">';

      var blankIdsList = cat.blank_ids || [];
      for (var bi = 0; bi < blankIdsList.length; bi++) {
        var blank = blanksById[blankIdsList[bi]];
        if (!blank) continue;

        var label = _escapeHtml(blank.label || 'Blank ' + (blank.index + 1));
        var ctxBefore = blank.context_before || '';
        var ctxAfter = blank.context_after || '';
        var snippet = '';
        if (ctxBefore || ctxAfter) {
          var beforeSnip = ctxBefore.length > 30 ? '...' + ctxBefore.substring(ctxBefore.length - 30) : ctxBefore;
          var afterSnip = ctxAfter.length > 30 ? ctxAfter.substring(0, 30) + '...' : ctxAfter;
          snippet = beforeSnip + ' _____ ' + afterSnip;
        }

        html += '<div class="bg-white border border-gray-100 rounded p-2 space-y-1.5">' +
          '<span class="text-xs font-medium text-gray-700">' + label + '</span>';

        if (snippet) {
          html += '<p class="text-[10px] text-gray-400 font-mono truncate" title="' + _escapeHtml(snippet) + '">' + _escapeHtml(snippet) + '</p>';
        }

        html += '<div class="flex items-center gap-1.5">' +
          '<select id="' + prefix + 'BlankMap_' + blank.id + '" class="dtm-blank-select flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-purple-500" data-blank-id="' + blank.id + '" data-prefix="' + prefix + '">' +
            '<option value="">-- Not mapped --</option>' +
            '<option value="__custom__">Custom value...</option>';

        var lastPfx = '';
        for (var k = 0; k < nsKeys.length; k++) {
          var key = nsKeys[k];
          var entry = ns[key];
          var pfx = key.indexOf('.') !== -1 ? key.substring(0, key.indexOf('.')) : '';
          if (pfx !== lastPfx && pfx) {
            if (lastPfx) html += '</optgroup>';
            html += '<optgroup label="' + pfx.charAt(0).toUpperCase() + pfx.substring(1) + '">';
            lastPfx = pfx;
          }
          html += '<option value="' + _escapeHtml(key) + '">' + _escapeHtml(entry.label || key) + '</option>';
        }
        if (lastPfx) html += '</optgroup>';

        html += '</select>' +
          '<input type="text" id="' + prefix + 'BlankCustom_' + blank.id + '" class="hidden flex-1 px-2 py-1 border border-gray-300 rounded text-xs" placeholder="Type value...">' +
          '</div></div>';
      }

      html += '</div></div></div>';
    }

    blanksList.innerHTML = html;
    blanksDiv.classList.remove('hidden');

    // Event delegation for group toggles
    blanksList.addEventListener('click', function (e) {
      var btn = e.target.closest('.dtm-group-toggle');
      if (!btn) return;
      var catId = btn.getAttribute('data-group');
      var pfx = btn.getAttribute('data-prefix');
      var group = document.getElementById(pfx + 'BlankGroup_' + catId);
      var chevron = btn.querySelector('.dtm-chevron');
      if (group) {
        var isHidden = group.classList.contains('hidden');
        group.classList.toggle('hidden');
        if (chevron) chevron.classList.toggle('rotate-180', isHidden);
      }
    });

    // Event delegation for blank select changes
    blanksList.addEventListener('change', function (e) {
      var select = e.target.closest('.dtm-blank-select');
      if (!select) return;
      var blankId = select.getAttribute('data-blank-id');
      var pfx = select.getAttribute('data-prefix');
      var customInput = document.getElementById(pfx + 'BlankCustom_' + blankId);
      if (!customInput) return;
      if (select.value === '__custom__') {
        customInput.classList.remove('hidden');
        customInput.focus();
      } else {
        customInput.classList.add('hidden');
        customInput.value = '';
      }
    });
  };

  // =========================================================================
  // Internal: generate
  // =========================================================================

  DocxTemplateModal.prototype._generate = async function () {
    var self = this;
    var st = self.state;

    if (!st.docId || !st.matterId || !st.selectedContact) {
      self.onError('Please select a contact first');
      return;
    }

    var genBtn = self._el('GenerateBtn');
    if (genBtn) {
      genBtn.disabled = true;
      genBtn.textContent = 'Generating...';
    }

    // Collect custom variables for curly brace placeholders
    var customVars = {};
    var ns = st.variableNamespace || {};
    for (var i = 0; i < st.placeholders.length; i++) {
      var ph = st.placeholders[i];
      if (!ns[ph]) {
        var inputId = self.prefix + 'CustomVar_' + ph.split('.').join('_');
        var input = document.getElementById(inputId);
        if (input && input.value) {
          customVars[ph] = input.value;
        }
      }
    }

    // Collect blank mappings
    var blankMappings = {};
    for (var b = 0; b < st.blanks.length; b++) {
      var blankId = st.blanks[b].id;
      var selectEl = document.getElementById(self.prefix + 'BlankMap_' + blankId);
      if (!selectEl) continue;
      if (selectEl.value === '__custom__') {
        var customEl = document.getElementById(self.prefix + 'BlankCustom_' + blankId);
        if (customEl && customEl.value) {
          blankMappings[blankId] = 'custom:' + customEl.value;
        }
      } else if (selectEl.value) {
        blankMappings[blankId] = selectEl.value;
      }
    }

    var saveToMatter = true;
    var saveCheckbox = self._el('SaveToMatter');
    if (saveCheckbox) saveToMatter = saveCheckbox.checked;

    try {
      var response = await fetch(api.baseUrl + '/api/v1/matters/' + st.matterId + '/documents/' + st.docId + '/generate-from-template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + api.token
        },
        body: JSON.stringify({
          contact_id: st.selectedContact.id,
          output_format: 'docx',
          custom_variables: customVars,
          blank_mappings: blankMappings,
          save_to_matter: saveToMatter
        })
      });

      var result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || result.message || 'Generation failed');
      }

      var data = result.data || result;

      // Trigger download
      if (data.file_base64) {
        var blob = _base64ToBlob(data.file_base64, data.content_type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = data.filename || 'generated-document.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      var msg = 'Document generated: ' + (data.filename || 'document.docx');
      if (data.placeholders_missing && data.placeholders_missing.length > 0) {
        msg += ' (' + data.placeholders_missing.length + ' field(s) missing)';
      }
      self.onSuccess(msg);
      self.close();
      self.onGenerated(data);

    } catch (error) {
      self.onError('Generation failed: ' + error.message);
    } finally {
      if (genBtn) {
        genBtn.disabled = false;
        genBtn.textContent = 'Generate Document';
      }
    }
  };

  // =========================================================================
  // Static: toggle template flag (shared utility)
  // =========================================================================

  /**
   * Toggle a document's template flag.
   * @param {string} docId
   * @param {string} matterId
   * @param {boolean} isTemplate
   * @param {Object} callbacks - { onSuccess, onError }
   * @returns {Promise<Object>} API response data
   */
  DocxTemplateModal.toggleTemplate = async function (docId, matterId, isTemplate, callbacks) {
    callbacks = callbacks || {};
    var onSuccess = callbacks.onSuccess || function () {};
    var onError = callbacks.onError || function () {};

    try {
      var response = await fetch(api.baseUrl + '/api/v1/matters/' + matterId + '/documents/' + docId + '/template', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + api.token
        },
        body: JSON.stringify({ is_template: isTemplate })
      });

      var result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || result.message || 'Failed to update template flag');
      }

      var data = result.data || result;

      if (isTemplate) {
        var phCount = (data.placeholders || []).length;
        var blankCount = (data.blanks || []).length;
        var parts = [];
        if (phCount > 0) parts.push(phCount + ' placeholder' + (phCount !== 1 ? 's' : ''));
        if (blankCount > 0) parts.push(blankCount + ' blank field' + (blankCount !== 1 ? 's' : ''));
        var msg = parts.length > 0 ? 'Marked as template (' + parts.join(', ') + ' found)' : 'Marked as template (no fields detected)';
        onSuccess(msg);
      } else {
        onSuccess('Template flag removed');
      }

      return data;
    } catch (error) {
      onError('Template update failed: ' + error.message);
      throw error;
    }
  };

  // Expose globally
  window.DocxTemplateModal = DocxTemplateModal;

})();

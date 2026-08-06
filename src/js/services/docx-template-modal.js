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
  function _titleCase(str) {
    if (!str) return '';
    var result = '';
    var capitalizeNext = true;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '-' || ch === '_') {
        result += ch;
        capitalizeNext = true;
      } else if (capitalizeNext) {
        result += ch.toUpperCase();
        capitalizeNext = false;
      } else {
        result += ch;
      }
    }
    return result;
  }

  function _resolvePreview(placeholder, contact, matterData) {
    if (!contact) return '';

    // Derive names intelligently — handle cases where only full name or only first/last are provided
    var _firstName = contact.first_name || '';
    var _lastName = contact.last_name || '';
    var _displayName = contact.display_name || '';
    var _fullName = '';

    if (_firstName || _lastName) {
      _fullName = ((_firstName || '') + ' ' + (_lastName || '')).trim();
    } else if (_displayName) {
      _fullName = _displayName;
      var nameParts = _displayName.trim().split(' ').filter(function (p) { return p.length > 0; });
      _firstName = nameParts[0] || '';
      _lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    }

    // Contact namespace
    if (placeholder === 'contact.first_name') return _titleCase(_firstName);
    if (placeholder === 'contact.last_name') return _titleCase(_lastName);
    if (placeholder === 'contact.full_name') return _titleCase(_fullName);
    if (placeholder === 'contact.display_name') return _titleCase(_displayName || _fullName);
    if (placeholder === 'contact.email') return contact.email || '';
    if (placeholder === 'contact.phone_mobile') return contact.phone_mobile || '';
    if (placeholder === 'contact.phone_work') return contact.phone_work || '';
    if (placeholder === 'contact.phone_home') return contact.phone_home || '';
    if (placeholder === 'contact.phone_fax') return contact.phone_fax || '';
    if (placeholder === 'contact.company_name') return _titleCase(contact.company_name || '');
    if (placeholder === 'contact.title') return _titleCase(contact.title || '');
    if (placeholder === 'contact.role') return _titleCase(contact.role || '');
    if (placeholder === 'contact.participant_type') return _titleCase(contact.participant_type || '');

    // Address fields
    if (placeholder.indexOf('contact.address') === 0 && contact.address) {
      var addr = typeof contact.address === 'string' ? JSON.parse(contact.address) : contact.address;
      if (placeholder === 'contact.address_street') return _titleCase([addr.street, addr.street2].filter(Boolean).join(', '));
      if (placeholder === 'contact.address_city') return _titleCase(addr.city || '');
      if (placeholder === 'contact.address_state') return (addr.state || '').toUpperCase();
      if (placeholder === 'contact.address_zip') return addr.zip || '';
      if (placeholder === 'contact.address_country') return _titleCase(addr.country || '');
      if (placeholder === 'contact.address_full') {
        return _titleCase([addr.street, addr.street2, [addr.city, addr.state, addr.zip].filter(Boolean).join(', '), addr.country].filter(Boolean).join(', '));
      }
    }

    // Date namespace
    if (placeholder === 'date.today') {
      var now = LanaTime.nowDate();
      return String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + '/' + now.getFullYear();
    }
    if (placeholder === 'date.today_long') {
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      var d = LanaTime.nowDate();
      return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
    if (placeholder === 'date.year') return String(LanaTime.nowDate().getFullYear());
    if (placeholder === 'date.month') {
      var ms = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      return ms[LanaTime.nowDate().getMonth()];
    }
    if (placeholder === 'date.day') return String(LanaTime.nowDate().getDate()).padStart(2, '0');

    // Matter namespace
    if (placeholder.indexOf('matter.') === 0 && matterData) {
      if (placeholder === 'matter.name') return matterData.name || matterData.matter_name || '';
      if (placeholder === 'matter.matter_number') return matterData.matter_number || matterData.matter_id || '';
      if (placeholder === 'matter.status') return matterData.status || '';
      if (placeholder === 'matter.client_name') return matterData.client_name || '';
      if (placeholder === 'matter.description') return matterData.description || '';
    }

    // Organization namespace — pulls from matter's organization data or org settings
    if (placeholder.indexOf('org.') === 0 && matterData) {
      var org = matterData.organization || {};
      var orgSettings = org.settings || {};
      var orgField = placeholder.substring(4);
      return _titleCase(org[orgField] || orgSettings[orgField] || '');
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

    this._pollIntervalId = null;
    this._pageHeights = {}; // pageIndex → height at scale=1.0 (for coordinate conversion)
    this._pdfScale = 1.3;   // must match scale used in _loadPdfPreview

    this.state = {
      docId: null,
      matterId: null,
      docName: '',
      placeholders: [],
      blanks: [],
      categories: [],
      contacts: [],
      selectedContacts: [],
      variableNamespace: null,
      blankFilter: 'all'   // 'all' | 'mapped' | 'unmapped'
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
    var previewDiv = self._el('Preview');
    var blanksDiv = self._el('Blanks');
    var customVarsDiv = self._el('CustomVars');
    var genBtn = self._el('GenerateBtn');
    var contactItems = self._el('ContactItems');
    var selectAllCb = self._el('ContactSelectAll');

    if (titleEl) titleEl.textContent = docName || 'Template';
    if (placeholdersEl) placeholdersEl.textContent = 'Loading...';
    if (contactItems) contactItems.innerHTML = '';
    if (selectAllCb) { selectAllCb.checked = false; selectAllCb.indeterminate = false; }
    self.state.selectedContacts = [];
    self.state._autoMapped = false;
    if (previewDiv) previewDiv.classList.add('hidden');
    if (blanksDiv) blanksDiv.classList.add('hidden');
    if (customVarsDiv) customVarsDiv.classList.add('hidden');
    if (genBtn) { genBtn.disabled = true; genBtn.textContent = 'Generate Document'; }
    self.state.blankFilter = 'all';

    // Reset filter buttons to "All" active
    var filtersDiv = self._el('BlankFilters');
    if (filtersDiv) {
      var filterBtns = filtersDiv.querySelectorAll('.dtm-filter-btn');
      for (var fb = 0; fb < filterBtns.length; fb++) {
        var isAll = filterBtns[fb].getAttribute('data-filter') === 'all';
        filterBtns[fb].className = 'dtm-filter-btn px-2.5 py-1 text-xs font-medium rounded-full ' +
          (isAll ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200');
      }
    }

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
    // Clear any active batch polling interval
    if (this._pollIntervalId) {
      clearInterval(this._pollIntervalId);
      this._pollIntervalId = null;
    }
    var modal = this._el('Modal');
    if (modal) modal.open = false;
  };

  /**
   * Load the PDF into the preview pane using pdf.js with numbered overlay badges
   * positioned at each detected blank field's coordinates.
   */
  DocxTemplateModal.prototype._loadPdfPreview = function () {
    var self = this;
    var viewer = document.getElementById(self.prefix + 'PdfViewer');
    if (!viewer || !self.state.docId) return;

    var isPdf = (self.state.docName || '').toLowerCase().indexOf('.pdf') !== -1;
    if (!isPdf) {
      viewer.innerHTML = '<div class="flex items-center justify-center h-full text-sm text-gray-400">Preview not available for this file type</div>';
      return;
    }

    if (typeof pdfjsLib === 'undefined') {
      // Fallback: iframe if pdf.js not loaded
      viewer.innerHTML = '<div class="flex items-center justify-center h-full text-sm text-gray-400">Loading preview...</div>';
      fetch(api.baseUrl + '/api/v1/storage/files/' + encodeURIComponent(self.state.docId) + '/download', {
        headers: { 'Authorization': 'Bearer ' + api.token }
      }).then(function(r) { return r.blob(); }).then(function(blob) {
        viewer.innerHTML = '<iframe src="' + URL.createObjectURL(blob) + '#toolbar=0" style="width:100%;height:100%;border:none;"></iframe>';
      }).catch(function() {
        viewer.innerHTML = '<div class="flex items-center justify-center h-full text-sm text-red-400">Failed to load preview</div>';
      });
      return;
    }

    // Configure pdf.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';

    viewer.innerHTML = '<div class="flex items-center justify-center h-full text-sm text-gray-400">Rendering PDF...</div>';

    // Sort blanks by position for numbering
    var sorted = (self.state.blanks || []).slice().sort(function (a, b) { return a.position - b.position; });
    var blankLabels = {};
    for (var bi = 0; bi < sorted.length; bi++) {
      blankLabels[sorted[bi].id] = { num: bi + 1, label: sorted[bi].label || 'Blank', blank: sorted[bi] };
    }

    // Fetch PDF and render with pdf.js
    fetch(api.baseUrl + '/api/v1/storage/files/' + encodeURIComponent(self.state.docId) + '/download', {
      headers: { 'Authorization': 'Bearer ' + api.token }
    })
    .then(function (resp) { return resp.arrayBuffer(); })
    .then(function (arrayBuf) {
      return pdfjsLib.getDocument({ data: arrayBuf }).promise;
    })
    .then(function (pdfDoc) {
      viewer.innerHTML = '';
      var scale = 1.3;
      var allTextItems = []; // Collect text items across all pages with their coords

      var renderPage = function (pageNum) {
        return pdfDoc.getPage(pageNum).then(function (page) {
          var viewport = page.getViewport({ scale: scale });

          // Store actual page height at scale=1.0 for coordinate conversion
          self._pageHeights[pageNum - 1] = viewport.height / scale;

          // Container for this page
          var pageDiv = document.createElement('div');
          pageDiv.className = 'dtm-pdf-page';
          pageDiv.setAttribute('data-page-index', pageNum - 1);
          pageDiv.style.cssText = 'position:relative;margin:0 auto 16px auto;background:white;box-shadow:0 2px 8px rgba(0,0,0,0.12);width:' + viewport.width + 'px;height:' + viewport.height + 'px;';

          // Canvas
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          pageDiv.appendChild(canvas);

          var ctx = canvas.getContext('2d');
          var renderTask = page.render({ canvasContext: ctx, viewport: viewport });

          return renderTask.promise.then(function () {
            return page.getTextContent();
          }).then(function (textContent) {
            // Collect text items with their page coordinates for blank matching
            var items = textContent.items;
            for (var t = 0; t < items.length; t++) {
              var item = items[t];
              if (!item.str) continue;
              var tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
              allTextItems.push({
                str: item.str,
                x: tx[4],
                y: tx[5],
                width: item.width * scale,
                height: item.height * scale,
                pageDiv: pageDiv,
                pageNum: pageNum
              });
            }
            viewer.appendChild(pageDiv);
          });
        });
      };

      // Render all pages sequentially
      var chain = Promise.resolve();
      for (var p = 1; p <= pdfDoc.numPages; p++) {
        (function (pn) {
          chain = chain.then(function () { return renderPage(pn); });
        })(p);
      }

      return chain.then(function () {
        self._overlayBlankBadges(allTextItems, sorted, scale);
      });
    })
    .catch(function (err) {
      console.error('[DocxTemplateModal] PDF render failed:', err);
      viewer.innerHTML = '<div class="flex items-center justify-center h-full text-sm text-red-400">Failed to render PDF: ' + _escapeHtml(err.message) + '</div>';
    });
  };

  /**
   * Overlay numbered badges on the PDF at each blank field position.
   *
   * Finds the pdf.js text item containing each blank's label text,
   * then places the badge at the right edge of that text item (x + width).
   * Handles compound items (multiple labels in one item like "City: ___, State: ___, ZIP___"),
   * split items ("Address" + ":"), and underscore-only items as fallback.
   */
  DocxTemplateModal.prototype._overlayBlankBadges = function (textItems, sortedBlanks, scale) {
    var self = this;
    var falsePos = { 'follows': 1, 'with a copy to': 1, 'hereof': 1, 'thereof': 1,
      'herein': 1, 'nation': 1, 'company': 1, 'section': 1, 'article': 1 };

    var pageDivs = {};
    for (var ti = 0; ti < textItems.length; ti++) {
      if (textItems[ti].pageDiv) pageDivs[textItems[ti].pageNum] = textItems[ti].pageDiv;
    }

    var labelCands = [];
    var underscoreCands = [];

    for (var i = 0; i < textItems.length; i++) {
      var it = textItems[i];
      var s = it.str.trim();
      if (s.length < 2 && s !== ':') continue;
      var charW = (it.width || 0) / Math.max(s.length, 1);
      var sk = it.pageNum * 1e6 + Math.round(it.y) * 1000 + Math.round(it.x);

      if (s.indexOf('___') !== -1) {
        underscoreCands.push({ x: it.x, y: it.y, w: it.width, pageNum: it.pageNum, pageDiv: pageDivs[it.pageNum], sk: sk });
      }

      var segments = s.split(',');
      if (segments.length > 1) {
        var offset = 0;
        for (var si = 0; si < segments.length; si++) {
          var seg = segments[si];
          var t = seg.trim();
          var ci2 = t.indexOf(':');
          if (ci2 > 0) {
            var lbl = t.substring(0, ci2).trim().toLowerCase();
            if (lbl.length > 0 && lbl.length < 20 && !falsePos[lbl]) {
              var segStart = s.indexOf(seg, offset > 0 ? offset - 1 : 0);
              labelCands.push({ label: lbl, x: it.x + charW * segStart, y: it.y, w: charW * (ci2 + 1),
                pageNum: it.pageNum, pageDiv: pageDivs[it.pageNum], sk: sk + segStart });
            }
          } else {
            // Extract leading alpha text before the first underscore (no regex)
            var uIdx = t.indexOf('_');
            if (uIdx > 0) {
              var umText = t.substring(0, uIdx);
              // Verify it's only letters and spaces
              var umValid = true;
              for (var uc = 0; uc < umText.length; uc++) {
                var ucc = umText.charCodeAt(uc);
                if (!((ucc >= 65 && ucc <= 90) || (ucc >= 97 && ucc <= 122) || ucc === 32)) {
                  umValid = false; break;
                }
              }
              if (umValid) {
                var ulbl = umText.trim().toLowerCase();
                if (ulbl.length > 0 && ulbl.length < 20 && !falsePos[ulbl]) {
                  var segStart2 = s.indexOf(seg, offset > 0 ? offset - 1 : 0);
                  labelCands.push({ label: ulbl, x: it.x + charW * segStart2, y: it.y, w: charW * umText.length,
                    pageNum: it.pageNum, pageDiv: pageDivs[it.pageNum], sk: sk + segStart2 });
                }
              }
            }
          }
          offset += seg.length + 1;
        }
        continue;
      }

      var ci3 = s.indexOf(':');
      if (ci3 > 0) {
        var lbl2 = s.substring(0, ci3).trim().toLowerCase();
        if (lbl2.length > 0 && lbl2.length < 20 && !falsePos[lbl2]) {
          labelCands.push({ label: lbl2, x: it.x, y: it.y, w: charW * (ci3 + 1),
            pageNum: it.pageNum, pageDiv: pageDivs[it.pageNum], sk: sk });
        }
      }

      if (s.charAt(0) === ':' && s.length < 3 && i > 0) {
        // Check if next item on the same line is body text (not a field blank)
        // If so, this ":" is part of a sentence, not a field label
        var isFieldColon = true;
        if (i + 1 < textItems.length) {
          var nextIt = textItems[i + 1];
          if (nextIt.pageNum === it.pageNum && Math.abs(nextIt.y - it.y) < 3) {
            var nextStr = nextIt.str.trim();
            // If next item on same line has alphabetic text (not underscores/empty), it's body text
            if (nextStr.length > 0 && nextStr.split('_').join('').trim().length > 0 && nextStr.indexOf('___') === -1) {
              isFieldColon = false;
            }
          }
        }
        if (isFieldColon) {
          for (var back = 1; back <= Math.min(3, i); back++) {
            var prev = textItems[i - back];
            var ps = prev.str.trim().toLowerCase();
            if (ps.length > 0 && ps.length < 20 && !falsePos[ps] &&
                prev.pageNum === it.pageNum && Math.abs(prev.y - it.y) < 3 &&
                ps.indexOf(':') === -1) {
              labelCands.push({ label: ps, x: prev.x, y: prev.y, w: (prev.width || 0) + (it.width || 0),
                pageNum: prev.pageNum, pageDiv: pageDivs[prev.pageNum],
                sk: prev.pageNum * 1e6 + Math.round(prev.y) * 1000 + Math.round(prev.x) });
              break;
            }
          }
        }
      }
    }

    labelCands.sort(function (a, b) { return a.sk - b.sk; });
    underscoreCands.sort(function (a, b) { return a.sk - b.sk; });
    var uPtr = 0;

    for (var bi = 0; bi < sortedBlanks.length; bi++) {
      var blank = sortedBlanks[bi];
      var num = bi + 1;
      var blankLabel = (blank.label || '').trim().toLowerCase();
      if (!blankLabel) continue;
      var placed = false;

      for (var li = 0; li < labelCands.length; li++) {
        if (labelCands[li].label === blankLabel) {
          var m = labelCands[li];
          labelCands.splice(li, 1);
          self._placeBadge({ pageDiv: m.pageDiv, x: m.x + m.w, y: m.y, width: 0 }, num, blank);
          placed = true;
          break;
        }
      }

      if (!placed && blank.length > 0 && uPtr < underscoreCands.length) {
        var um2 = underscoreCands[uPtr];
        uPtr++;
        self._placeBadge({ pageDiv: um2.pageDiv, x: um2.x + um2.w, y: um2.y, width: 0 }, num, blank);
      }
    }
  };

  /**
   * Convert badge display position (CSS px at scale=1.3, top-left origin)
   * to PDF coordinates (scale=1.0, bottom-left origin).
   *
   * @param {number} displayX - badge left in px within the page div
   * @param {number} displayY - badge top in px within the page div
   * @param {number} pageIndex - 0-based page number
   * @returns {{ x: number, y: number, pageIndex: number }}
   */
  DocxTemplateModal.prototype._displayToPdfCoords = function (displayX, displayY, pageIndex) {
    var scale = this._pdfScale;
    var pdfX = displayX / scale;
    var pageHeightPdf = this._pageHeights[pageIndex] || 792; // fallback to Letter
    var pdfY = pageHeightPdf - (displayY / scale);
    return { x: pdfX, y: pdfY, pageIndex: pageIndex };
  };

  /**
   * Place a draggable numbered badge on a PDF page.
   * Stores initial PDF coordinates on the badge. User can drag to reposition.
   */
  DocxTemplateModal.prototype._placeBadge = function (textItem, num, blank) {
    var self = this;
    if (!textItem || !textItem.pageDiv) return;

    var initLeft = Math.round(textItem.x + 4);
    var initTop = Math.round(textItem.y - 4);
    var pageIndex = parseInt(textItem.pageDiv.getAttribute('data-page-index') || '0', 10);

    var badge = document.createElement('div');
    badge.className = 'dtm-overlay-badge';
    badge.setAttribute('data-blank-id', blank.id);
    badge.setAttribute('data-page-index', pageIndex);
    badge.style.cssText = 'position:absolute;' +
      'left:' + initLeft + 'px;' +
      'top:' + initTop + 'px;' +
      'min-width:18px;height:18px;padding:0 3px;border-radius:9px;' +
      'background:#7c3aed;color:white;font-size:9px;font-weight:700;' +
      'display:flex;align-items:center;justify-content:center;' +
      'cursor:grab;z-index:5;box-shadow:0 1px 3px rgba(0,0,0,0.3);' +
      'transition:background 0.2s,box-shadow 0.2s;font-family:system-ui,sans-serif;' +
      'user-select:none;';
    badge.textContent = num;
    badge.title = (blank.label || 'Blank ' + num) + ' — drag to reposition';

    // Store initial PDF-space coordinates
    var initCoords = self._displayToPdfCoords(initLeft, initTop, pageIndex);
    badge.dataset.pdfX = String(initCoords.x);
    badge.dataset.pdfY = String(initCoords.y);
    badge.dataset.adjusted = 'false';

    // Click handler — scroll to field mapping select (only fires if not dragging)
    var wasDragged = false;
    (function (blankId, prefix) {
      badge.addEventListener('click', function () {
        if (wasDragged) { wasDragged = false; return; }
        var select = document.getElementById(prefix + 'BlankMap_' + blankId);
        if (select) {
          select.scrollIntoView({ behavior: 'smooth', block: 'center' });
          select.focus();
          select.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.3)';
          setTimeout(function () { select.style.boxShadow = ''; }, 2000);
        }
      });
    })(blank.id, self.prefix);

    // Drag handlers — constrained within the page div
    var dragState = null;

    badge.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dragState = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startLeft: parseInt(badge.style.left, 10) || 0,
        startTop: parseInt(badge.style.top, 10) || 0
      };
      badge.style.cursor = 'grabbing';
      badge.style.zIndex = '10';
      badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      var dx = e.clientX - dragState.startMouseX;
      var dy = e.clientY - dragState.startMouseY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragged = true;

      var newLeft = dragState.startLeft + dx;
      var newTop = dragState.startTop + dy;

      // Constrain within page div bounds
      var pdw = textItem.pageDiv.clientWidth;
      var pdh = textItem.pageDiv.clientHeight;
      if (newLeft < 0) newLeft = 0;
      if (newTop < 0) newTop = 0;
      if (newLeft > pdw - 18) newLeft = pdw - 18;
      if (newTop > pdh - 18) newTop = pdh - 18;

      badge.style.left = newLeft + 'px';
      badge.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', function () {
      if (!dragState) return;
      dragState = null;
      badge.style.cursor = 'grab';
      badge.style.zIndex = '5';

      // Update stored PDF coordinates from new position
      var finalLeft = parseInt(badge.style.left, 10) || 0;
      var finalTop = parseInt(badge.style.top, 10) || 0;
      var coords = self._displayToPdfCoords(finalLeft, finalTop, pageIndex);
      badge.dataset.pdfX = String(coords.x);
      badge.dataset.pdfY = String(coords.y);

      if (wasDragged) {
        badge.dataset.adjusted = 'true';
        // Visual indicator: orange border for repositioned badges
        badge.style.background = '#ea580c';
        badge.style.boxShadow = '0 0 0 2px #fed7aa, 0 2px 6px rgba(0,0,0,0.3)';
        badge.title = (blank.label || 'Blank ' + num) + ' — repositioned by user';
      } else {
        badge.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
      }
    });

    textItem.pageDiv.appendChild(badge);
  };

  /**
   * Preview the template file in an overlay modal.
   */
  DocxTemplateModal.prototype.viewTemplate = function () {
    var self = this;
    var docId = self.state.docId;
    var docName = self.state.docName || 'Template';
    if (!docId) return;

    // Remove existing preview overlay if any
    var existing = document.getElementById('dtm-template-preview-overlay');
    if (existing) existing.remove();

    // Build overlay
    var overlay = document.createElement('div');
    overlay.id = 'dtm-template-preview-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML =
      '<div style="background:white;border-radius:12px;width:90%;max-width:900px;height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb;">' +
          '<span style="font-size:14px;font-weight:600;color:#111827;">' + _escapeHtml(docName) + '</span>' +
          '<button id="dtm-preview-close" style="padding:4px;border-radius:6px;border:none;background:none;cursor:pointer;color:#6b7280;" title="Close">' +
            '<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div id="dtm-preview-body" style="flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f9fafb;">' +
          '<div style="color:#9ca3af;font-size:14px;">Loading preview...</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Close handlers
    var closeBtn = document.getElementById('dtm-preview-close');
    if (closeBtn) closeBtn.onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    // Fetch the file and display in iframe
    var previewBody = document.getElementById('dtm-preview-body');
    fetch(api.baseUrl + '/api/v1/storage/files/' + encodeURIComponent(docId) + '/download', {
      headers: { 'Authorization': 'Bearer ' + api.token }
    })
    .then(function (resp) {
      if (!resp.ok) throw new Error('Failed to load file');
      return resp.blob();
    })
    .then(function (blob) {
      var blobUrl = URL.createObjectURL(blob);
      previewBody.innerHTML = '<iframe src="' + blobUrl + '" style="width:100%;height:100%;border:none;"></iframe>';
    })
    .catch(function (err) {
      previewBody.innerHTML = '<div style="color:#ef4444;font-size:14px;">Failed to load preview: ' + _escapeHtml(err.message) + '</div>';
    });
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
    st.suggestedMappings = varsData.suggested_mappings || {};
    st.dataSources = varsData.data_sources || {};

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

    // Populate contact checkbox list
    var contactItems = self._el('ContactItems');
    var contactCountEl = self._el('ContactCount');
    var selectAllCb = self._el('ContactSelectAll');

    if (contactItems) {
      var itemsHtml = '';
      for (var i = 0; i < st.contacts.length; i++) {
        var c = st.contacts[i];
        var name = c.display_name || ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || c.email || 'Contact';
        var detail = c.email || '';
        if (c.participant_type && c.participant_type !== 'other') {
          detail = detail ? detail + ' - ' + c.participant_type : c.participant_type;
        }
        var searchable = (name + ' ' + detail).toLowerCase();
        itemsHtml += '<label class="dtm-contact-row flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer" data-search="' + _escapeHtml(searchable) + '">' +
          '<input type="checkbox" class="dtm-contact-cb rounded border-gray-300 text-purple-600 focus:ring-purple-500" value="' + _escapeHtml(c.id) + '">' +
          '<div class="min-w-0">' +
            '<div class="text-sm text-gray-800 truncate">' + _escapeHtml(name) + '</div>' +
            (detail ? '<div class="text-xs text-gray-400 truncate">' + _escapeHtml(detail) + '</div>' : '') +
          '</div>' +
        '</label>';
      }
      contactItems.innerHTML = itemsHtml;
      if (contactCountEl) contactCountEl.textContent = st.contacts.length + ' contact' + (st.contacts.length !== 1 ? 's' : '');

      // Checkbox change handler (avoid stacking listeners on re-open)
      if (!contactItems._dtmBound) {
        contactItems.addEventListener('change', function () {
          self._onContactSelectionChange();
        });
        contactItems._dtmBound = true;
      }

      // Select All handler — only toggles visible (non-hidden) contacts
      if (selectAllCb) {
        selectAllCb.checked = false;
        selectAllCb.onchange = function () {
          var rows = contactItems.querySelectorAll('.dtm-contact-row:not(.hidden)');
          for (var j = 0; j < rows.length; j++) {
            var cb = rows[j].querySelector('.dtm-contact-cb');
            if (cb) cb.checked = selectAllCb.checked;
          }
          self._onContactSelectionChange();
        };
      }

      // Search handler
      var searchInput = self._el('ContactSearch');
      if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = function () {
          var query = searchInput.value.toLowerCase().trim();
          var rows = contactItems.querySelectorAll('.dtm-contact-row');
          for (var s = 0; s < rows.length; s++) {
            var haystack = rows[s].getAttribute('data-search') || '';
            rows[s].classList.toggle('hidden', query.length > 0 && haystack.indexOf(query) === -1);
          }
        };
      }
    }

    // Render custom vars for unmapped curly brace placeholders
    self._renderCustomVars();

    // Render blank field mapping
    self._renderBlankMappings();
  };

  // =========================================================================
  // Internal: contact selection change (multi-select)
  // =========================================================================

  DocxTemplateModal.prototype._onContactSelectionChange = function () {
    var self = this;
    var st = self.state;
    var genBtn = self._el('GenerateBtn');
    var previewDiv = self._el('Preview');
    var previewList = self._el('PreviewList');
    var contactItems = self._el('ContactItems');
    var contactCountEl = self._el('ContactCount');
    var selectAllCb = self._el('ContactSelectAll');

    // Gather selected contact IDs
    var selectedIds = {};
    if (contactItems) {
      var cbs = contactItems.querySelectorAll('.dtm-contact-cb:checked');
      for (var ci = 0; ci < cbs.length; ci++) selectedIds[cbs[ci].value] = true;
    }

    // Build selected contacts array
    st.selectedContacts = [];
    for (var i = 0; i < st.contacts.length; i++) {
      if (selectedIds[st.contacts[i].id]) {
        st.selectedContacts.push(st.contacts[i]);
      }
    }

    var count = st.selectedContacts.length;

    // Update select-all checkbox state
    if (selectAllCb) {
      selectAllCb.checked = count > 0 && count === st.contacts.length;
      selectAllCb.indeterminate = count > 0 && count < st.contacts.length;
    }

    // Update count display
    if (contactCountEl) {
      contactCountEl.textContent = count > 0
        ? count + ' of ' + st.contacts.length + ' selected'
        : st.contacts.length + ' contact' + (st.contacts.length !== 1 ? 's' : '');
    }

    // Update generate button
    if (genBtn) {
      genBtn.disabled = count === 0;
      if (count > 1) {
        genBtn.textContent = 'Generate ' + count + ' Documents';
      } else {
        genBtn.textContent = 'Generate Document';
      }
    }

    if (count === 0) {
      if (previewDiv) previewDiv.classList.add('hidden');
      return;
    }

    // Auto-map blank fields (only on first selection)
    if (count === 1 || (count > 0 && st._autoMapped !== true)) {
      self._autoMapBlanks();
      st._autoMapped = true;
    }

    // Build preview using first selected contact
    var contact = st.selectedContacts[0];
    if (previewList && contact) {
      var matterData = self.getMatterData();
      var html = '';

      // Multi-contact header
      if (count > 1) {
        html += '<div class="text-xs text-purple-600 font-medium mb-2">Previewing: ' +
          _escapeHtml(contact.display_name || ((contact.first_name || '') + ' ' + (contact.last_name || '')).trim() || contact.email || 'Contact') +
          ' (1 of ' + count + ')</div>';
      }

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
          var blankMapped = false;
          var blankVarName = '';
          if (selectEl && selectEl.value && selectEl.value !== '' && selectEl.value !== '__custom__') {
            blankMapped = true;
            blankVarName = selectEl.value;
            blankVal = _resolvePreview(selectEl.value, contact, matterData);
          } else if (selectEl && selectEl.value === '__custom__') {
            blankMapped = true;
            var customEl = document.getElementById(self.prefix + 'BlankCustom_' + blank.id);
            blankVal = customEl ? customEl.value : '';
          }
          var blankLabel = blank.label || 'Blank ' + (bi + 1);
          var valHtml;
          if (blankVal) {
            valHtml = '<span class="text-gray-900">' + _escapeHtml(blankVal) + '</span>';
          } else if (blankMapped) {
            // Mapped but contact has no data for this field
            var _ns = st.variableNamespace || {};
            var varLabel = (_ns[blankVarName] && _ns[blankVarName].label) || blankVarName;
            valHtml = '<span class="text-amber-500 italic">' + _escapeHtml(varLabel) + ' (empty)</span>';
          } else {
            valHtml = '<span class="text-gray-400 italic">Not mapped</span>';
          }
          html += '<div class="flex items-center gap-2 text-xs">' +
            '<span class="text-gray-500 w-40 truncate">' + _escapeHtml(blankLabel) + '</span>' +
            '<span class="text-gray-400">&rarr;</span>' + valHtml +
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

    // Sort blanks by position (document order)
    var sorted = st.blanks.slice().sort(function (a, b) { return a.position - b.position; });

    // Build the select options HTML once (reused for every blank)
    var optionsHtml = '<option value="">Select...</option>' +
      '<option value="__custom__">Custom value...</option>';
    var lastPfx = '';
    for (var k = 0; k < nsKeys.length; k++) {
      var key = nsKeys[k];
      var entry = ns[key];
      var pfx = key.indexOf('.') !== -1 ? key.substring(0, key.indexOf('.')) : '';
      if (pfx !== lastPfx && pfx) {
        if (lastPfx) optionsHtml += '</optgroup>';
        optionsHtml += '<optgroup label="' + pfx.charAt(0).toUpperCase() + pfx.substring(1) + '">';
        lastPfx = pfx;
      }
      optionsHtml += '<option value="' + _escapeHtml(key) + '">' + _escapeHtml(entry.label || key) + '</option>';
    }
    if (lastPfx) optionsHtml += '</optgroup>';

    // Render compact field list (shown in right panel next to PDF preview)
    var html = '';
    for (var i = 0; i < sorted.length; i++) {
      var blank = sorted[i];
      var label = _escapeHtml(blank.label || 'Blank ' + (blank.index + 1));
      var catMeta = (typeof CATEGORY_ICONS !== 'undefined') ? null : null; // icons defined at top

      html += '<div class="dtm-blank-card border-b border-gray-100 px-3 py-2" data-blank-card-id="' + blank.id + '">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<span class="flex-shrink-0 w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center">' + (i + 1) + '</span>' +
          '<span class="text-xs font-semibold text-gray-800 truncate flex-1">' + label + '</span>' +
          '<span class="text-[9px] text-gray-400 uppercase tracking-wide flex-shrink-0">' + _escapeHtml(blank.category || '') + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-1 pl-7">' +
          '<select id="' + prefix + 'BlankMap_' + blank.id + '" class="dtm-blank-select flex-1 px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white focus:ring-1 focus:ring-purple-500 focus:border-purple-500" data-blank-id="' + blank.id + '" data-prefix="' + prefix + '">' +
            optionsHtml +
          '</select>' +
          '<input type="text" id="' + prefix + 'BlankCustom_' + blank.id + '" class="hidden flex-1 px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white focus:ring-1 focus:ring-purple-500" placeholder="Type value...">' +
        '</div>' +
      '</div>';
    }

    blanksList.innerHTML = html;
    blanksDiv.classList.remove('hidden');

    // Load PDF preview into the viewer pane
    self._loadPdfPreview();

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
      // Visual feedback on the field row
      var card = select.closest('.dtm-blank-card');
      if (card) {
        var numBadge = card.querySelector('.bg-purple-100');
        if (select.value && select.value !== '') {
          card.style.background = '#f0fdf4';
          if (numBadge) { numBadge.className = numBadge.className.replace('bg-purple-100', 'bg-green-100').replace('text-purple-700', 'text-green-700'); }
        } else {
          card.style.background = '';
          if (numBadge) { numBadge.className = numBadge.className.replace('bg-green-100', 'bg-purple-100').replace('text-green-700', 'text-purple-700'); }
        }
      }
      self._updateBlankFilterCounts();
      self._applyBlankFilter();
    });

    // Event delegation for filter buttons
    var filtersDiv = self._el('BlankFilters');
    if (filtersDiv) {
      filtersDiv.addEventListener('click', function (e) {
        var btn = e.target.closest('.dtm-filter-btn');
        if (!btn) return;
        var filter = btn.getAttribute('data-filter');
        self.state.blankFilter = filter;

        // Update active button styles
        var allBtns = filtersDiv.querySelectorAll('.dtm-filter-btn');
        for (var fb = 0; fb < allBtns.length; fb++) {
          var isActive = allBtns[fb].getAttribute('data-filter') === filter;
          allBtns[fb].className = 'dtm-filter-btn px-2.5 py-1 text-xs font-medium rounded-full ' +
            (isActive ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200');
        }

        self._applyBlankFilter();
      });
    }

    // Initialize filter counts
    self._updateBlankFilterCounts();
  };

  // =========================================================================
  // Internal: blank field filtering
  // =========================================================================

  /**
   * Count mapped vs unmapped blanks and update filter button badges.
   */
  DocxTemplateModal.prototype._updateBlankFilterCounts = function () {
    var self = this;
    var st = self.state;
    var prefix = self.prefix;
    var mapped = 0;
    var unmapped = 0;

    for (var i = 0; i < st.blanks.length; i++) {
      var selectEl = document.getElementById(prefix + 'BlankMap_' + st.blanks[i].id);
      if (selectEl && selectEl.value && selectEl.value !== '') {
        mapped++;
      } else {
        unmapped++;
      }
    }

    var total = st.blanks.length;
    var filtersDiv = self._el('BlankFilters');
    if (!filtersDiv) return;

    var btns = filtersDiv.querySelectorAll('.dtm-filter-btn');
    for (var b = 0; b < btns.length; b++) {
      var filter = btns[b].getAttribute('data-filter');
      var countEl = btns[b].querySelector('.dtm-filter-count');
      if (!countEl) continue;
      if (filter === 'all') countEl.textContent = total;
      else if (filter === 'mapped') countEl.textContent = mapped;
      else if (filter === 'unmapped') countEl.textContent = unmapped;
    }
  };

  /**
   * Show/hide blank cards and category groups based on the active filter.
   */
  DocxTemplateModal.prototype._applyBlankFilter = function () {
    var self = this;
    var st = self.state;
    var prefix = self.prefix;
    var filter = st.blankFilter || 'all';
    var blanksList = self._el('BlanksList');
    if (!blanksList) return;

    var cards = blanksList.querySelectorAll('.dtm-blank-card');
    for (var i = 0; i < cards.length; i++) {
      var cardId = cards[i].getAttribute('data-blank-card-id');
      var selectEl = document.getElementById(prefix + 'BlankMap_' + cardId);
      var isMapped = selectEl && selectEl.value && selectEl.value !== '';

      if (filter === 'all') {
        cards[i].classList.remove('hidden');
      } else if (filter === 'mapped') {
        cards[i].classList.toggle('hidden', !isMapped);
      } else if (filter === 'unmapped') {
        cards[i].classList.toggle('hidden', isMapped);
      }
    }

    // Hide category groups that have zero visible cards
    var categories = st.categories || [];
    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      var groupWrapper = blanksList.querySelector('[data-group="' + cat.id + '"]');
      if (!groupWrapper) continue;
      var parentContainer = groupWrapper.closest('.border.border-gray-200');
      if (!parentContainer) continue;

      var groupDiv = document.getElementById(prefix + 'BlankGroup_' + cat.id);
      if (!groupDiv) continue;

      var visibleCards = groupDiv.querySelectorAll('.dtm-blank-card:not(.hidden)');
      var hasVisible = visibleCards.length > 0;
      parentContainer.classList.toggle('hidden', !hasVisible);

      // Auto-expand groups with visible cards when filtering; collapse empty
      if (filter !== 'all') {
        groupDiv.classList.toggle('hidden', !hasVisible);
        var chevron = groupWrapper.querySelector('.dtm-chevron');
        if (chevron) chevron.classList.toggle('rotate-180', hasVisible);
      }

      // Update category count badge to show visible/total
      var badge = groupWrapper.querySelector('.bg-gray-200');
      if (badge) {
        if (filter === 'all') {
          badge.textContent = cat.count;
        } else {
          badge.textContent = visibleCards.length + '/' + cat.count;
        }
      }
    }
  };

  // =========================================================================
  // Internal: ML-based auto-mapping (scoring, not keyword rules)
  // =========================================================================

  /**
   * Stop words to exclude from tokenization — common words that add noise.
   */
  var STOP_WORDS = {
    'the': 1, 'a': 1, 'an': 1, 'and': 1, 'or': 1, 'of': 1, 'to': 1, 'in': 1,
    'is': 1, 'it': 1, 'for': 1, 'on': 1, 'at': 1, 'by': 1, 'as': 1, 'be': 1,
    'if': 1, 'no': 1, 'not': 1, 'are': 1, 'was': 1, 'with': 1, 'that': 1,
    'this': 1, 'from': 1, 'will': 1, 'has': 1, 'have': 1, 'had': 1, 'been': 1,
    'shall': 1, 'may': 1, 'any': 1, 'all': 1, 'each': 1, 'every': 1,
    'such': 1, 'other': 1, 'which': 1, 'their': 1, 'its': 1, 'his': 1, 'her': 1,
    'option': 1, 'per': 1, 'also': 1, 'must': 1, 'than': 1, 'into': 1
  };

  /**
   * Category-to-domain affinity map. Scores how well a blank's category
   * aligns with a variable's domain (prefix). Higher = stronger match.
   */
  var CATEGORY_DOMAIN = {
    'name':      { 'contact': 0.4, 'matter': 0.2 },
    'address':   { 'contact': 0.5 },
    'contact':   { 'contact': 0.4 },
    'date':      { 'date': 0.6 },
    'signature': { 'contact': 0.3, 'date': 0.2 },
    'amount':    { 'matter': 0.1 },
    'number':    {},
    'checkbox':  {},
    'payment_method': {},
    'description': { 'matter': 0.1 }
  };

  /**
   * Synonym expansions — maps words that appear in blanks to words that
   * appear in variable labels, bridging vocabulary gaps.
   */
  var SYNONYMS = {
    'tel': 'phone', 'telephone': 'phone', 'cell': 'mobile', 'cellular': 'mobile',
    'e-mail': 'email', 'mail': 'email', 'mailing': 'address',
    'zip': 'zip', 'postal': 'zip', 'postcode': 'zip',
    'apt': 'street', 'suite': 'street', 'unit': 'street',
    'firm': 'company', 'business': 'company', 'entity': 'company', 'corporation': 'company',
    'surname': 'last', 'lastname': 'last', 'firstname': 'first',
    'signed': 'date', 'executed': 'date', 'dated': 'date',
    'printed': 'name', 'lessor': 'name', 'lessee': 'name', 'tenant': 'name', 'landlord': 'name',
    'landlady': 'name', 'occupant': 'name', 'resident': 'name',
    'agent': 'name', 'manager': 'name', 'owner': 'name',
    'fax': 'fax', 'facsimile': 'fax'
  };

  /**
   * Tokenize text into a normalized word set, applying stop word removal
   * and synonym expansion.
   *
   * @param {string} text - Raw text to tokenize
   * @returns {Object} Map of word → count (acts as a bag of words)
   */
  function _tokenize(text) {
    if (!text) return {};
    // Normalize: lowercase, replace non-alphanumeric with spaces, split on spaces
    var lower = text.toLowerCase();
    var normalized = '';
    for (var ci = 0; ci < lower.length; ci++) {
      var ch = lower.charCodeAt(ci);
      // Keep a-z (97-122) and 0-9 (48-57), replace everything else with space
      if ((ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57)) {
        normalized += lower[ci];
      } else {
        normalized += ' ';
      }
    }
    var words = normalized.split(' ').filter(function (w) { return w.length > 0; });
    var bag = {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w || w.length < 2 || STOP_WORDS[w]) continue;
      bag[w] = (bag[w] || 0) + 1;
      // Also add synonym if present
      var syn = SYNONYMS[w];
      if (syn) bag[syn] = (bag[syn] || 0) + 0.5;
    }
    return bag;
  }

  /**
   * Compute a similarity score between two word bags.
   * Uses weighted Jaccard: intersection / union, weighted by frequency.
   *
   * @param {Object} bagA - Word bag A
   * @param {Object} bagB - Word bag B
   * @returns {number} Score between 0.0 and 1.0
   */
  function _wordOverlap(bagA, bagB) {
    var keysA = Object.keys(bagA);
    var keysB = Object.keys(bagB);
    if (keysA.length === 0 || keysB.length === 0) return 0;

    var intersection = 0;
    var union = 0;

    // Combine all keys
    var allKeys = {};
    var i;
    for (i = 0; i < keysA.length; i++) allKeys[keysA[i]] = true;
    for (i = 0; i < keysB.length; i++) allKeys[keysB[i]] = true;

    var keys = Object.keys(allKeys);
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      var a = bagA[k] || 0;
      var b = bagB[k] || 0;
      intersection += Math.min(a, b);
      union += Math.max(a, b);
    }

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Score a single blank against a single variable. Returns a value 0.0–1.0.
   *
   * Scoring components:
   *   - Word overlap between blank text and variable label/key (0–1, weight 0.5)
   *   - Category-domain affinity bonus (0–0.6, based on CATEGORY_DOMAIN)
   *   - Exact sub-field match bonus (e.g., blank says "city", var is "address_city")
   *
   * @param {Object} blankBag - Tokenized blank text
   * @param {string} blankCategory - Blank's detected category
   * @param {Object} varBag - Tokenized variable label + key
   * @param {string} varKey - Variable key (e.g., 'contact.address_city')
   * @returns {number} Score 0.0–1.0
   */
  function _scoreMatch(blankBag, blankCategory, varBag, varKey) {
    // 1. Word overlap (primary signal)
    var overlap = _wordOverlap(blankBag, varBag);

    // 2. Category-domain affinity
    var domain = varKey.indexOf('.') !== -1 ? varKey.substring(0, varKey.indexOf('.')) : '';
    var affinities = CATEGORY_DOMAIN[blankCategory] || {};
    var domainBonus = affinities[domain] || 0;

    // 3. Sub-field exact match bonus — if the variable's field name appears in the blank text
    var fieldPart = varKey.indexOf('.') !== -1 ? varKey.substring(varKey.indexOf('.') + 1) : varKey;
    var fieldWords = fieldPart.split('_').join(' ').toLowerCase().split(' ').filter(function (w) { return w.length > 0; });
    var exactBonus = 0;
    for (var fw = 0; fw < fieldWords.length; fw++) {
      if (fieldWords[fw].length >= 3 && blankBag[fieldWords[fw]]) {
        exactBonus += 0.15;
      }
    }
    if (exactBonus > 0.3) exactBonus = 0.3;

    // Combined score, capped at 1.0
    var score = (overlap * 0.5) + domainBonus + exactBonus;
    return score > 1.0 ? 1.0 : score;
  }

  /**
   * Minimum confidence threshold. Below this score, we don't auto-map.
   * Prevents false positives like "Number of Parking Spaces" → Full Name.
   */
  var MIN_CONFIDENCE = 0.25;

  /**
   * Build variable token cache (called once per modal open, not per blank).
   */
  function _buildVarTokens(ns) {
    var cache = {};
    var keys = Object.keys(ns);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var entry = ns[key];
      // Tokenize label + key parts (e.g., "Full Name" + "contact full name")
      var text = (entry.label || '') + ' ' + key.split('.').join(' ').split('_').join(' ');
      cache[key] = _tokenize(text);
    }
    return cache;
  }

  // Label-to-variable mapping for contact fields (the external party)
  var LABEL_TO_CONTACT = {
    'name':          'contact.full_name',
    'full name':     'contact.full_name',
    'first name':    'contact.first_name',
    'last name':     'contact.last_name',
    'print name':    'contact.full_name',
    'printed name':  'contact.full_name',
    'company':       'contact.company_name',
    'company name':  'contact.company_name',
    'email':         'contact.email',
    'e-mail':        'contact.email',
    'phone':         'contact.phone_mobile',
    'telephone':     'contact.phone_mobile',
    'cell':          'contact.phone_mobile',
    'mobile':        'contact.phone_mobile',
    'fax':           'contact.phone_fax',
    'title':         'contact.title',
    'position':      'contact.title',
    'address':       'contact.address_street',
    'street':        'contact.address_street',
    'city':          'contact.address_city',
    'state':         'contact.address_state',
    'zip':           'contact.address_zip',
    'zip code':      'contact.address_zip',
    'postal code':   'contact.address_zip',
    'country':       'contact.address_country',
    'date':          'date.today'
  };

  // Label-to-variable mapping for organization fields (your company)
  var LABEL_TO_ORG = {
    'name':          'org.signer_name',
    'full name':     'org.signer_name',
    'print name':    'org.signer_name',
    'printed name':  'org.signer_name',
    'company':       'org.name',
    'company name':  'org.name',
    'email':         'org.email',
    'phone':         'org.phone',
    'telephone':     'org.phone',
    'fax':           'org.fax',
    'title':         'org.signer_title',
    'position':      'org.signer_title',
    'address':       'org.address',
    'city':          'org.city',
    'state':         'org.state',
    'zip':           'org.zip',
    'zip code':      'org.zip',
    'date':          'date.today'
  };

  DocxTemplateModal.prototype._autoMapBlanks = function () {
    var self = this;
    var st = self.state;
    var ns = st.variableNamespace || {};
    var prefix = self.prefix;
    if (Object.keys(ns).length === 0) return;

    var aiMappings = st.suggestedMappings || {};
    var hasAI = Object.keys(aiMappings).length > 0;

    // Sort blanks by position to process in document order
    var sorted = st.blanks.slice().sort(function (a, b) { return a.position - b.position; });

    // Track label occurrences for fallback (non-AI) mapping
    var labelCount = {};

    for (var i = 0; i < sorted.length; i++) {
      var blank = sorted[i];
      var selectEl = document.getElementById(prefix + 'BlankMap_' + blank.id);
      if (!selectEl) continue;
      if (selectEl.value && selectEl.value !== '') continue;

      var label = (blank.label || '').toLowerCase().trim();

      // Skip signature fields
      if (label === 'signed' || label === 'signature') continue;

      var varKey = null;

      // Priority 1: AI-suggested mapping
      if (hasAI && aiMappings[blank.id]) {
        varKey = aiMappings[blank.id];
        // Validate the suggested key exists in namespace (skip sheet.* for now)
        if (varKey.indexOf('sheet.') === 0) {
          // Sheet column — use as custom value
          // TODO: resolve sheet column to actual value when generating
          varKey = null; // Skip for now, will implement with sheet data resolution
        }
      }

      // Priority 2: Static label-to-variable mapping (fallback)
      if (!varKey) {
        labelCount[label] = (labelCount[label] || 0) + 1;
        var occurrence = labelCount[label];

        if (occurrence <= 1) {
          varKey = LABEL_TO_CONTACT[label];
        } else {
          varKey = LABEL_TO_ORG[label] || LABEL_TO_CONTACT[label];
        }
      }

      if (varKey && ns[varKey]) {
        selectEl.value = varKey;
      }
    }

    if (hasAI) {
      console.log('[DocxTemplateModal] AI mappings applied:', Object.keys(aiMappings).length, 'suggestions');
    }

    self._updateBlankFilterCounts();
    self._applyBlankFilter();
  };

  // =========================================================================
  // Internal: generate
  // =========================================================================

  DocxTemplateModal.prototype._generate = async function () {
    var self = this;
    var st = self.state;

    if (!st.docId || !st.matterId || st.selectedContacts.length === 0) {
      self.onError('Please select at least one contact');
      return;
    }

    var genBtn = self._el('GenerateBtn');
    var total = st.selectedContacts.length;

    if (genBtn) {
      genBtn.disabled = true;
      genBtn.textContent = total > 1 ? 'Generating 1 of ' + total + '...' : 'Generating...';
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

    // Collect blank mappings — for flat PDFs, include confirmed PDF coordinates
    var isFlatPdf = st.docName && (st.docName.toLowerCase().indexOf('.pdf') !== -1);
    var blankMappings = {};
    for (var b = 0; b < st.blanks.length; b++) {
      var blankId = st.blanks[b].id;
      var selectEl = document.getElementById(self.prefix + 'BlankMap_' + blankId);
      if (!selectEl) continue;

      var varValue = '';
      if (selectEl.value === '__custom__') {
        var customEl = document.getElementById(self.prefix + 'BlankCustom_' + blankId);
        if (customEl && customEl.value) varValue = 'custom:' + customEl.value;
      } else if (selectEl.value) {
        varValue = selectEl.value;
      }
      if (!varValue) continue;

      // For flat PDFs, enrich with badge coordinates so backend places text precisely
      if (isFlatPdf) {
        var badge = document.querySelector('.dtm-overlay-badge[data-blank-id="' + blankId + '"]');
        if (badge && badge.dataset.pdfX && badge.dataset.pdfY) {
          blankMappings[blankId] = {
            variable: varValue,
            x: parseFloat(badge.dataset.pdfX),
            y: parseFloat(badge.dataset.pdfY),
            pageIndex: parseInt(badge.dataset.pageIndex || '0', 10)
          };
        } else {
          blankMappings[blankId] = varValue; // fallback: string format
        }
      } else {
        blankMappings[blankId] = varValue; // DOCX / fillable PDF: string format
      }
    }

    var saveToMatter = true;
    var saveCheckbox = self._el('SaveToMatter');
    if (saveCheckbox) saveToMatter = saveCheckbox.checked;

    var succeeded = 0;
    var failed = 0;
    var lastData = null;

    // Use batch API for 5+ contacts (queued background processing)
    // Use direct sequential calls for 1-4 contacts (immediate download)
    var BATCH_THRESHOLD = 5;

    if (total >= BATCH_THRESHOLD) {
      // Batch mode: queue all contacts for background processing
      if (genBtn) genBtn.textContent = 'Queuing ' + total + ' documents...';

      try {
        var batchResponse = await fetch(api.baseUrl + '/api/v1/matters/' + st.matterId + '/documents/' + st.docId + '/generate-from-template/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.token },
          body: JSON.stringify({
            contact_ids: st.selectedContacts.map(function (c) { return c.id; }),
            output_format: 'docx',
            custom_variables: customVars,
            blank_mappings: blankMappings,
            save_to_matter: saveToMatter
          })
        });

        var batchResult = await batchResponse.json();
        if (!batchResponse.ok) {
          throw new Error(batchResult.error || batchResult.message || 'Batch queue failed');
        }

        var batchData = batchResult.data || batchResult;
        var batchId = batchData.batch_id;

        // Poll for completion
        if (genBtn) genBtn.textContent = 'Processing 0 of ' + total + '...';

        self._pollIntervalId = setInterval(async function () {
          try {
            var statusResp = await fetch(api.baseUrl + '/api/v1/matters/' + st.matterId + '/documents/' + st.docId + '/generate-from-template/batch/' + batchId, {
              headers: { 'Authorization': 'Bearer ' + api.token }
            });
            var statusData = (await statusResp.json()).data;
            var done = statusData.completed + statusData.failed;

            if (genBtn) genBtn.textContent = 'Processing ' + done + ' of ' + total + '...';

            if (statusData.status === 'completed' || statusData.status === 'completed_with_errors' || statusData.status === 'failed') {
              clearInterval(self._pollIntervalId);
              self._pollIntervalId = null;
              succeeded = statusData.completed;
              failed = statusData.failed;

              if (genBtn) {
                genBtn.disabled = false;
                genBtn.textContent = 'Generate Document';
              }

              if (failed > 0) {
                self.onError(failed + ' of ' + total + ' documents failed to generate');
              }
              if (succeeded > 0) {
                self.onSuccess(succeeded + ' document' + (succeeded !== 1 ? 's' : '') + ' generated and saved to matter');
                self.onGenerated();
              }
            }
          } catch (_) {}
        }, 2000);

        return; // Don't fall through to the summary code below
      } catch (error) {
        self.onError('Batch generation failed: ' + error.message);
        if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Generate Document'; }
        return;
      }
    }

    // Sequential mode for small batches (1-4 contacts)
    for (var ci = 0; ci < st.selectedContacts.length; ci++) {
      var contact = st.selectedContacts[ci];

      if (genBtn && total > 1) {
        genBtn.textContent = 'Generating ' + (ci + 1) + ' of ' + total + '...';
      }

      try {
        var response = await fetch(api.baseUrl + '/api/v1/matters/' + st.matterId + '/documents/' + st.docId + '/generate-from-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.token },
          body: JSON.stringify({
            contact_id: contact.id,
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
        lastData = data;

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

        succeeded++;
      } catch (error) {
        failed++;
        var contactName = contact.display_name || ((contact.first_name || '') + ' ' + (contact.last_name || '')).trim() || contact.email || 'Contact';
        self.onError('Failed for ' + contactName + ': ' + error.message);
      }
    }

    // Summary
    if (total === 1 && succeeded === 1 && lastData) {
      var msg = 'Document generated: ' + (lastData.filename || 'document.docx');
      if (lastData.placeholders_missing && lastData.placeholders_missing.length > 0) {
        msg += ' (' + lastData.placeholders_missing.length + ' field(s) missing)';
      }
      self.onSuccess(msg);
    } else if (succeeded > 0) {
      var summaryMsg = succeeded + ' of ' + total + ' document' + (total !== 1 ? 's' : '') + ' generated';
      if (failed > 0) summaryMsg += ' (' + failed + ' failed)';
      self.onSuccess(summaryMsg);
    }

    if (succeeded > 0) {
      self.close();
      self.onGenerated(lastData);
    }

    if (genBtn) {
      genBtn.disabled = false;
      genBtn.textContent = 'Generate Document';
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

/* Run Books admin page controller.
   Thin client: the backend owns the format policy, where one procedure ends and
   the next begins, and whether a draft is ready. This file declares the run
   book, extracts text from the chosen files, and renders what the server said,
   including everything it dropped.

   A RUN BOOK is the organization's own processes packaged so LANA can retrieve
   them as evidence in every matter. Entries set authority, so the review screen
   never hides a refusal, never invents a title, and shows every remaining
   problem at once rather than the first one.

   @requires api.js                    : window.api, base URL and bearer token
   @requires lex.auth.js               : Lex.Auth role helpers
   @requires lex.utils.js              : escapeHtml, debounce, formatFileSize
   @requires run-books-draft.js        : window.RunBookDraft, the pure half
   @requires vendor/mammoth.min.js     : DOCX text
   @requires vendor/pdf.min.js         : PDF text
*/

(function () {
  'use strict';

  // The run book routes mirror the domain pack routes, which mount at
  // /api/v1/admin/domain-packs. Kept in one place so a mount-path change is one
  // edit.
  var API_BASE = '/api/v1/admin/run-books';

  // var, not const: page scripts are cached and re-run on SPA re-navigation.
  var state = {
    step: 'declare',
    formatIndex: null,
    formatsLoaded: false,
    formatsLoading: false,
    runBook: { name: '', domain: '', scopeType: '', scopeValues: [] },
    files: [],
    proposals: [],
    serverRefused: [],
    entryOrder: [],
    entriesById: {},
    entryCount: 0,
    droppedCount: 0,
    readiness: { ready: false, problems: [] },
    checkGen: 0,
    fileSeq: 0
  };

  var scheduleReadinessCheck = null;

  // ── Small helpers ──────────────────────────────────────────────────

  function el(id) {
    return document.getElementById(id);
  }

  function show(target) {
    var node = typeof target === 'string' ? el(target) : target;
    if (node) { node.classList.remove('hidden'); }
  }

  function hide(target) {
    var node = typeof target === 'string' ? el(target) : target;
    if (node) { node.classList.add('hidden'); }
  }

  function esc(value) {
    return Lex.Utils.escapeHtml(value === null || value === undefined ? '' : String(value));
  }

  function clear(node) {
    while (node && node.firstChild) { node.removeChild(node.firstChild); }
  }

  function scopeDeclaration() {
    return { type: state.runBook.scopeType, values: state.runBook.scopeValues };
  }

  // ── Step strip ─────────────────────────────────────────────────────

  var STEP_ORDER = ['declare', 'upload', 'review'];

  function setStep(step) {
    state.step = step;

    hide('runBookDeclareStep');
    hide('runBookUploadStep');
    hide('runBookReviewStep');
    show('runBook' + step.charAt(0).toUpperCase() + step.slice(1) + 'Step');

    var current = STEP_ORDER.indexOf(step);
    var markers = document.querySelectorAll('[data-step]');
    for (var i = 0; i < markers.length; i += 1) {
      var marker = markers[i];
      var index = STEP_ORDER.indexOf(marker.getAttribute('data-step'));
      marker.classList.remove('is-current');
      marker.classList.remove('is-done');
      if (index === current) { marker.classList.add('is-current'); }
      if (index < current) { marker.classList.add('is-done'); }
    }
  }

  // ── Step 1: declare ────────────────────────────────────────────────

  function renderScopeValues() {
    var container = el('runBookScopeValues');
    if (!container) { return; }

    if (state.runBook.scopeValues.length === 0) {
      container.innerHTML = '<p class="run-books-field-help">No values yet. A run book with no scope values cannot scope its entries.</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < state.runBook.scopeValues.length; i += 1) {
      var value = state.runBook.scopeValues[i];
      html += '<span class="run-books-chip">' + esc(value) +
        '<button type="button" class="run-books-chip__remove" data-remove-scope-value="' + esc(value) +
        '" aria-label="Remove ' + esc(value) + '">&times;</button></span>';
    }
    container.innerHTML = html;
  }

  function addScopeValue() {
    var input = el('runBookScopeValueInput');
    if (!input) { return; }

    var value = String(input.value || '').trim();
    if (value === '') { return; }

    if (state.runBook.scopeValues.indexOf(value) === -1) {
      state.runBook.scopeValues.push(value);
      renderScopeValues();
    }

    input.value = '';
  }

  function removeScopeValue(value) {
    var index = state.runBook.scopeValues.indexOf(value);
    if (index === -1) { return; }

    state.runBook.scopeValues.splice(index, 1);
    renderScopeValues();
  }

  function readDeclaration() {
    state.runBook.name = String((el('runBookName') || {}).value || '').trim();
    state.runBook.domain = String((el('runBookDomain') || {}).value || '').trim().toLowerCase();
    state.runBook.scopeType = String((el('runBookScopeType') || {}).value || '').trim().toLowerCase();
  }

  function declarationProblems() {
    var problems = [];

    if (state.runBook.name === '') {
      problems.push('The run book needs a name.');
    }
    if (state.runBook.domain === '') {
      problems.push('The run book needs a domain, for example internal_process.');
    }
    if (state.runBook.scopeType === '') {
      problems.push('Say how you divide the organization, for example department.');
    }
    if (state.runBook.scopeValues.length === 0) {
      problems.push('Add at least one scope value. Every entry has to name one.');
    }

    return problems;
  }

  function onDeclareSubmit(event) {
    if (event && typeof event.preventDefault === 'function') { event.preventDefault(); }

    readDeclaration();
    var problems = declarationProblems();
    if (problems.length > 0) {
      Lex.Toast.error(problems.join(' '));
      return;
    }

    setStep('upload');
    loadFormats();
  }

  // ── Step 2: what may be uploaded ───────────────────────────────────

  function renderFormats(formats) {
    var container = el('runBookFormats');
    if (!container) { return; }

    var supported = (formats && formats.supported) || [];
    var refused = (formats && formats.refused) || [];

    var html = '<div><h3 class="run-books-subheading">These work</h3><ul class="run-books-format-list">';
    for (var i = 0; i < supported.length; i += 1) {
      var spec = supported[i] || {};
      var splits = spec.splits_into_entries === true
        ? 'Splits into separate entries.'
        : 'Becomes one entry.';
      html += '<li class="run-books-format"><div class="run-books-format__head">' +
        '<p class="run-books-format__label">' + esc(spec.label) + '</p>' +
        '<span class="run-books-format__extensions">' + esc((spec.extensions || []).join(' ')) + '</span>' +
        '</div>' +
        '<p class="run-books-format__note">' + esc(spec.note) + '</p>' +
        '<p class="run-books-format__note">' + esc(splits) + '</p></li>';
    }
    html += '</ul></div>';

    html += '<div><h3 class="run-books-subheading">These do not, and why</h3><ul class="run-books-format-list">';
    for (var j = 0; j < refused.length; j += 1) {
      var group = refused[j] || {};
      html += '<li class="run-books-format run-books-format--refused"><div class="run-books-format__head">' +
        '<span class="run-books-format__extensions">' + esc((group.extensions || []).join(' ')) + '</span>' +
        '</div><p class="run-books-format__note">' + esc(group.reason) + '</p></li>';
    }
    html += '</ul></div>';

    container.innerHTML = html;
  }

  function loadFormats() {
    if (state.formatsLoaded || state.formatsLoading) { return; }
    state.formatsLoading = true;

    var container = el('runBookFormats');
    if (container) { Lex.Redact.on(container); }

    api.get(API_BASE + '/formats')
      .then(function (formats) {
        state.formatsLoading = false;
        state.formatsLoaded = true;
        state.formatIndex = RunBookDraft.buildFormatIndex(formats);

        if (container) { Lex.Redact.off(container); }
        renderFormats(formats);

        var input = el('runBookFileInput');
        if (input) {
          input.setAttribute('accept', RunBookDraft.acceptAttribute(state.formatIndex));
        }
      })
      .catch(function (error) {
        state.formatsLoading = false;
        if (container) { Lex.Redact.off(container); }
        if (container) {
          container.innerHTML = '<p class="run-books-field-help">The list of accepted formats could not be loaded, so files cannot be checked before upload. Reload the page to try again.</p>';
        }
        Lex.Toast.error('Could not load the accepted run book formats');
        console.error('[run-books] loadFormats error:', error);
      });
  }

  // ── Step 2: reading the chosen files ───────────────────────────────

  function workerPathFor(vendorFile) {
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i += 1) {
      var source = scripts[i].getAttribute('src') || '';
      if (source.indexOf('vendor/pdf.min.js') !== -1) {
        return source.slice(0, source.lastIndexOf('/') + 1) + vendorFile;
      }
    }
    return vendorFile;
  }

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.readAsText(file);
    });
  }

  function readDocx(file) {
    if (typeof mammoth === 'undefined') {
      return Promise.reject(new Error('The Word document reader did not load, so this file cannot be read here.'));
    }

    return file.arrayBuffer()
      .then(function (buffer) { return mammoth.convertToHtml({ arrayBuffer: buffer }); })
      .then(function (result) {
        // Heading styles have to survive as markdown headings or the whole
        // document collapses into one entry. The backend still marks a docx
        // split as needing a closer look, because a style is not a decision.
        return RunBookDraft.htmlToRunBookText(result && result.value);
      });
  }

  function readPdf(file) {
    if (typeof pdfjsLib === 'undefined') {
      return Promise.reject(new Error('The PDF reader did not load, so this file cannot be read here.'));
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPathFor('pdf.worker.min.js');

    return file.arrayBuffer()
      .then(function (buffer) { return pdfjsLib.getDocument({ data: buffer, isEvalSupported: false }).promise; })
      .then(function (pdf) {
        var pages = [];

        function readPage(pageNumber) {
          if (pageNumber > pdf.numPages) { return Promise.resolve(pages.join('\n\n')); }

          return pdf.getPage(pageNumber)
            .then(function (page) { return page.getTextContent(); })
            .then(function (content) {
              var parts = [];
              var items = (content && content.items) || [];
              for (var i = 0; i < items.length; i += 1) {
                if (items[i] && items[i].str) { parts.push(items[i].str); }
              }
              pages.push(RunBookDraft.collapseSpaces(parts.join(' ')));
              return readPage(pageNumber + 1);
            });
        }

        return readPage(1);
      });
  }

  function extractText(file, kind) {
    if (kind === 'docx') { return readDocx(file); }
    if (kind === 'pdf') { return readPdf(file); }
    return readAsText(file);
  }

  function renderFiles() {
    var container = el('runBookFileList');
    if (!container) { return; }

    if (state.files.length === 0) {
      container.innerHTML = '';
      syncProposeButton();
      return;
    }

    var html = '';
    for (var i = 0; i < state.files.length; i += 1) {
      var entry = state.files[i];
      var refused = entry.status === 'refused' || entry.status === 'failed';

      html += '<div class="run-books-file' + (refused ? ' run-books-file--refused' : '') + '">';
      html += '<div><p class="run-books-file__name">' + esc(entry.filename) + '</p>';

      if (entry.status === 'reading') {
        html += '<p class="run-books-file__meta">Reading the text out of this file.</p>';
      } else if (entry.status === 'ready') {
        html += '<p class="run-books-file__meta">' + esc(Lex.Utils.formatFileSize(entry.sizeBytes)) +
          ' &middot; ' + esc(String(entry.text.length)) + ' characters of text &middot; ' +
          esc(entry.note) + '</p>';
      } else if (refused) {
        html += '<p class="run-books-file__reason">' + esc(entry.reason) + '</p>';
      }

      html += '</div>';
      html += '<button type="button" class="run-books-chip__remove" data-remove-file="' +
        esc(entry.id) + '" aria-label="Remove ' + esc(entry.filename) + '">&times;</button>';
      html += '</div>';
    }

    container.innerHTML = html;
    syncProposeButton();
  }

  function syncProposeButton() {
    var button = el('runBookProposeBtn');
    if (!button) { return; }

    var ready = 0;
    for (var i = 0; i < state.files.length; i += 1) {
      if (state.files[i].status === 'ready') { ready += 1; }
    }

    button.disabled = ready === 0;
  }

  function addFiles(fileList) {
    if (!state.formatIndex) {
      Lex.Toast.error('The accepted formats have not loaded yet. Wait a moment and try again.');
      return;
    }

    var files = fileList ? Array.prototype.slice.call(fileList) : [];

    for (var i = 0; i < files.length; i += 1) {
      addOneFile(files[i]);
    }

    renderFiles();
  }

  function isAlreadyListed(filename) {
    for (var i = 0; i < state.files.length; i += 1) {
      if (state.files[i].filename === filename) { return true; }
    }
    return false;
  }

  function addOneFile(file) {
    // Entry ids are derived from the filename, so two documents with the same
    // name would produce entries that collide and edits to one would land on
    // the other. Say so rather than quietly keeping one of them.
    if (isAlreadyListed(file.name)) {
      Lex.Toast.warning('A file named ' + file.name + ' is already on the list. Rename one of them, or remove the first.');
      return;
    }

    state.fileSeq += 1;

    var record = {
      id: 'rbf-' + state.fileSeq,
      filename: file.name,
      sizeBytes: file.size,
      status: 'reading',
      reason: '',
      note: '',
      kind: '',
      text: '',
      hasTextLayer: true
    };
    state.files.push(record);

    // First pass: extension, refuse list and size. Whether a PDF carries a text
    // layer is not knowable until it has been read, so that check waits.
    var verdict = RunBookDraft.classifyFile(
      { filename: record.filename, sizeBytes: record.sizeBytes },
      state.formatIndex
    );

    if (!verdict.accepted) {
      record.status = 'refused';
      record.reason = verdict.reason;
      return;
    }

    record.kind = verdict.kind;
    record.note = verdict.note;

    extractText(file, verdict.kind)
      .then(function (text) {
        record.text = String(text || '');
        record.hasTextLayer = record.text.trim().length > 0;

        // Second pass, now that the text layer question has an answer.
        var recheck = RunBookDraft.classifyFile(
          {
            filename: record.filename,
            sizeBytes: record.sizeBytes,
            hasTextLayer: record.hasTextLayer
          },
          state.formatIndex
        );

        if (!recheck.accepted) {
          record.status = 'refused';
          record.reason = recheck.reason;
        } else if (record.text.trim() === '') {
          record.status = 'refused';
          record.reason = 'No text came out of this file, so there is nothing to put in a run book.';
        } else {
          record.status = 'ready';
        }

        renderFiles();
      })
      .catch(function (error) {
        record.status = 'failed';
        record.reason = (error && error.message) ||
          'This file could not be read, so nothing from it was uploaded.';
        renderFiles();
        console.error('[run-books] extract error:', record.filename, error);
      });
  }

  function removeFile(id) {
    for (var i = 0; i < state.files.length; i += 1) {
      if (state.files[i].id === id) {
        state.files.splice(i, 1);
        renderFiles();
        return;
      }
    }
  }

  // ── Step 2 to 3: ask the backend for entries ───────────────────────

  function readyDocuments() {
    var documents = [];

    for (var i = 0; i < state.files.length; i += 1) {
      var record = state.files[i];
      if (record.status !== 'ready') { continue; }
      documents.push({
        filename: record.filename,
        text: record.text,
        size_bytes: record.sizeBytes,
        has_text_layer: record.hasTextLayer
      });
    }

    return documents;
  }

  function proposeEntries() {
    var documents = readyDocuments();
    if (documents.length === 0) {
      Lex.Toast.error('Nothing has been read yet, so there is nothing to propose.');
      return;
    }

    var button = el('runBookProposeBtn');
    if (button) { button.loading = true; }

    api.post(
      API_BASE + '/drafts/propose',
      RunBookDraft.buildProposePayload(documents, scopeDeclaration())
    )
      .then(function (result) {
        if (button) { button.loading = false; }

        state.proposals = (result && result.proposals) || [];
        state.serverRefused = (result && result.refused) || [];
        state.entryCount = (result && result.entry_count) || 0;
        state.droppedCount = (result && result.dropped_count) || 0;
        state.readiness = (result && result.readiness) || { ready: false, problems: [] };

        indexEntries();
        setStep('review');
        renderReview();
        renderReadiness();
      })
      .catch(function (error) {
        if (button) { button.loading = false; }
        Lex.Toast.error((error && error.message) || 'The entries could not be proposed');
        console.error('[run-books] propose error:', error);
      });
  }

  function indexEntries() {
    state.entryOrder = [];
    state.entriesById = {};

    var entries = RunBookDraft.flattenEntries(state.proposals);
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      state.entryOrder.push(entry.id);
      state.entriesById[entry.id] = entry;
    }
  }

  function editedEntries() {
    var entries = [];

    for (var i = 0; i < state.entryOrder.length; i += 1) {
      var entry = state.entriesById[state.entryOrder[i]];
      if (entry) { entries.push(entry); }
    }

    return entries;
  }

  // ── Step 3: the review screen ──────────────────────────────────────

  function buildTitleField(entry) {
    var input = document.createElement('lex-input');
    input.setAttribute('data-field', 'title');
    input.setAttribute('label', 'Title');
    input.setAttribute('placeholder', 'What this entry covers');
    input.setAttribute('value', entry.title || '');

    if (entry.needs_title === true) {
      // Never invent a title. The backend hands back the filename and says so.
      input.setAttribute(
        'help',
        'This is the filename. Nothing in the file said what this entry is, so give it a title that does.'
      );
    }

    return input;
  }

  function buildScopeField(entry) {
    var select = document.createElement('lex-select');
    select.setAttribute('data-field', 'scope');
    select.setAttribute('label', 'Applies to');
    select.setAttribute('multiple', 'true');
    select.setAttribute('placeholder', 'Choose one or more');
    select.options = RunBookDraft.scopeOptions(scopeDeclaration());
    // lex-select stores `value` as a String (withFormField), and reads a
    // multi-select's selection back out with JSON.parse. Handing it an array
    // directly would stringify to "a,b" and the selection would come back
    // empty.
    select.setAttribute('value', JSON.stringify(entry.scope_values || []));

    return select;
  }

  function renderEntryIssues(row, entry) {
    var list = row.querySelector('[data-entry-issues]');
    if (!list) { return; }

    var issues = RunBookDraft.entryIssues(entry, scopeDeclaration());
    var html = '';

    for (var i = 0; i < issues.length; i += 1) {
      html += '<li class="run-books-entry__issue">' + esc(issues[i].detail) + '</li>';
    }

    list.innerHTML = html;
    if (issues.length > 0) {
      row.classList.add('has-issues');
    } else {
      row.classList.remove('has-issues');
    }
  }

  function buildEntryRow(entry) {
    var row = document.createElement('div');
    row.className = 'run-books-entry';
    row.setAttribute('data-entry-id', entry.id);

    var fields = document.createElement('div');
    fields.className = 'run-books-entry__fields';
    fields.appendChild(buildTitleField(entry));
    fields.appendChild(buildScopeField(entry));
    row.appendChild(fields);

    var meta = document.createElement('div');
    meta.className = 'run-books-entry__meta';
    meta.innerHTML =
      '<span>' + esc(RunBookDraft.proposedFromLabel(entry.proposed_from)) + '</span>' +
      '<span>' + esc(String(entry.chars || 0)) + ' characters</span>' +
      '<span>From ' + esc(entry.source_reference) + '</span>';
    row.appendChild(meta);

    var excerpt = document.createElement('p');
    excerpt.className = 'run-books-entry__excerpt';
    excerpt.textContent = Lex.Utils.truncateText(String(entry.text || ''), 220);
    row.appendChild(excerpt);

    var issues = document.createElement('ul');
    issues.className = 'run-books-entry__issues';
    issues.setAttribute('data-entry-issues', 'true');
    row.appendChild(issues);

    renderEntryIssues(row, entry);

    return row;
  }

  function buildDroppedBlock(proposal) {
    var dropped = proposal.dropped || [];

    var block = document.createElement('div');
    block.className = 'run-books-dropped';

    var html = '<h4 class="run-books-subheading">Not included (' + dropped.length + ')</h4>';

    if (dropped.length === 0) {
      html += '<p class="run-books-dropped__reason">Every section of this file became an entry.</p>';
      block.innerHTML = html;
      return block;
    }

    html += '<p class="run-books-dropped__reason">These parts of the file are not in the run book. Nothing was dropped quietly, so you can decide whether any of it belongs somewhere else.</p>';
    html += '<ul class="run-books-dropped__list">';

    for (var i = 0; i < dropped.length; i += 1) {
      var section = dropped[i] || {};
      html += '<li class="run-books-dropped__item">' +
        '<p class="run-books-dropped__title">' + esc(section.title) + '</p>' +
        '<p class="run-books-dropped__reason">' +
        esc(RunBookDraft.droppedReasonLabel(section.reason)) +
        ' &middot; ' + esc(RunBookDraft.proposedFromLabel(section.proposed_from)) +
        ' &middot; ' + esc(String(section.chars || 0)) + ' characters</p>';

      if (section.detail) {
        html += '<p class="run-books-dropped__detail">' + esc(section.detail) + '</p>';
      }
      if (section.text) {
        html += '<p class="run-books-dropped__excerpt">' +
          esc(Lex.Utils.truncateText(String(section.text), 180)) + '</p>';
      }

      html += '</li>';
    }

    html += '</ul>';
    block.innerHTML = html;

    return block;
  }

  function buildSourceBlock(proposal) {
    var block = document.createElement('section');
    block.className = 'run-books-source';

    var head = document.createElement('div');
    head.className = 'run-books-source__head';
    head.innerHTML = '<h3 class="run-books-source__name">' + esc(proposal.filename) + '</h3>';

    var countBadge = document.createElement('lex-badge');
    countBadge.setAttribute('label', (proposal.entries || []).length + ' entries');
    countBadge.setAttribute('color', 'gray');
    head.appendChild(countBadge);

    if (proposal.requires_closer_review === true) {
      var reviewBadge = document.createElement('lex-badge');
      reviewBadge.setAttribute('label', 'Needs a closer look');
      reviewBadge.setAttribute('color', 'yellow');
      head.appendChild(reviewBadge);
    }

    block.appendChild(head);

    var structure = document.createElement('p');
    structure.className = 'run-books-source__structure';
    structure.textContent = RunBookDraft.structureLabel(proposal.structure);
    block.appendChild(structure);

    // The backend's own sentence. This is what explains why a PDF came back as
    // one entry and a markdown file came back as several.
    var note = document.createElement('p');
    note.className = 'run-books-source__note';
    note.textContent = proposal.note || '';
    block.appendChild(note);

    if (proposal.requires_closer_review === true) {
      var reviewNote = document.createElement('p');
      reviewNote.className = 'run-books-source__review-note';
      reviewNote.textContent = 'Boundaries here were read from heading styles, which authors apply inconsistently. Check that each entry is one whole procedure before relying on it.';
      block.appendChild(reviewNote);
    }

    var entries = document.createElement('div');
    entries.className = 'run-books-entries';

    var proposalEntries = proposal.entries || [];
    if (proposalEntries.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'run-books-dropped__reason';
      empty.textContent = 'Nothing in this file was long enough to stand on its own as an entry.';
      entries.appendChild(empty);
    }

    for (var i = 0; i < proposalEntries.length; i += 1) {
      entries.appendChild(buildEntryRow(state.entriesById[proposalEntries[i].id] || proposalEntries[i]));
    }

    block.appendChild(entries);
    block.appendChild(buildDroppedBlock(proposal));

    return block;
  }

  function renderRefusedFiles() {
    var container = el('runBookRefused');
    if (!container) { return; }

    var refused = [];
    var i;

    for (i = 0; i < state.files.length; i += 1) {
      if (state.files[i].status === 'refused' || state.files[i].status === 'failed') {
        refused.push({ filename: state.files[i].filename, reason: state.files[i].reason });
      }
    }
    for (i = 0; i < state.serverRefused.length; i += 1) {
      refused.push({
        filename: state.serverRefused[i].filename,
        reason: state.serverRefused[i].reason
      });
    }

    if (refused.length === 0) {
      container.innerHTML = '';
      hide(container);
      return;
    }

    var html = '<section class="run-books-source"><h3 class="run-books-source__name">Not uploaded (' +
      refused.length + ')</h3>' +
      '<p class="run-books-source__note">These files did not make it into the run book. Their reasons are listed so nothing disappears without an explanation.</p>' +
      '<div class="run-books-file-list">';

    for (i = 0; i < refused.length; i += 1) {
      html += '<div class="run-books-file run-books-file--refused"><div>' +
        '<p class="run-books-file__name">' + esc(refused[i].filename) + '</p>' +
        '<p class="run-books-file__reason">' + esc(refused[i].reason) + '</p>' +
        '</div></div>';
    }

    html += '</div></section>';
    container.innerHTML = html;
    show(container);
  }

  function renderReview() {
    var summary = el('runBookReviewSummary');
    if (summary) {
      summary.textContent = state.entryCount + ' entries proposed from ' +
        state.proposals.length + ' files. ' + state.droppedCount +
        ' sections were not included and are listed with their reasons.';
    }

    renderRefusedFiles();

    var container = el('runBookProposals');
    if (!container) { return; }

    clear(container);

    if (state.proposals.length === 0) {
      container.innerHTML = '<p class="run-books-field-help">No file produced any entries.</p>';
      return;
    }

    for (var i = 0; i < state.proposals.length; i += 1) {
      container.appendChild(buildSourceBlock(state.proposals[i]));
    }
  }

  function renderReadiness() {
    var container = el('runBookReadiness');
    if (!container) { return; }

    var problems = (state.readiness && state.readiness.problems) || [];

    if (state.readiness && state.readiness.ready === true) {
      container.innerHTML = '<p class="run-books-readiness-ok">Every entry has a title someone wrote and a scope. This draft is complete. Building and publishing a run book is not available from this screen yet.</p>';
      return;
    }

    // Every problem, not the first: an admin fixing twelve entries should see
    // twelve answers.
    var html = '<p class="run-books-readiness-count">' + problems.length +
      ' things still to fix.</p><ul class="run-books-readiness-list">';

    for (var i = 0; i < problems.length; i += 1) {
      html += '<li class="run-books-readiness-item">' + esc(problems[i]) + '</li>';
    }

    html += '</ul>';
    container.innerHTML = html;
  }

  function runReadinessCheck() {
    var generation = ++state.checkGen;

    api.post(API_BASE + '/drafts/check', RunBookDraft.buildCheckPayload(editedEntries(), scopeDeclaration()))
      .then(function (result) {
        if (generation !== state.checkGen) { return; }
        state.readiness = result || { ready: false, problems: [] };
        renderReadiness();
      })
      .catch(function (error) {
        if (generation !== state.checkGen) { return; }
        console.error('[run-books] check error:', error);
      });
  }

  function onEntryFieldChange(event) {
    var field = event.target && event.target.getAttribute
      ? event.target.getAttribute('data-field')
      : null;
    if (!field) { return; }

    var row = event.target.closest('[data-entry-id]');
    if (!row) { return; }

    var entry = state.entriesById[row.getAttribute('data-entry-id')];
    if (!entry) { return; }

    if (field === 'title') {
      var edit = RunBookDraft.applyTitleEdit(entry, event.detail && event.detail.value);
      entry.title = edit.title;
      entry.title_confirmed = edit.title_confirmed;
    } else if (field === 'scope') {
      var value = event.detail && event.detail.value;
      entry.scope_values = Array.isArray(value) ? value.slice() : [];
    }

    renderEntryIssues(row, entry);
    if (scheduleReadinessCheck) { scheduleReadinessCheck(); }
  }

  // ── Reset ──────────────────────────────────────────────────────────

  function startOver() {
    state.runBook = { name: '', domain: '', scopeType: '', scopeValues: [] };
    state.files = [];
    state.proposals = [];
    state.serverRefused = [];
    state.entryOrder = [];
    state.entriesById = {};
    state.entryCount = 0;
    state.droppedCount = 0;
    state.readiness = { ready: false, problems: [] };
    state.checkGen += 1;

    var ids = ['runBookName', 'runBookDomain', 'runBookScopeType', 'runBookScopeValueInput'];
    for (var i = 0; i < ids.length; i += 1) {
      var field = el(ids[i]);
      if (field) { field.value = ''; }
    }

    renderScopeValues();
    renderFiles();
    setStep('declare');
  }

  // ── Wiring ─────────────────────────────────────────────────────────

  function bindDeclareStep() {
    var form = el('runBookDeclareForm');
    if (form) {
      form.addEventListener('submit', onDeclareSubmit);
      form.addEventListener('lex-submit', onDeclareSubmit);
    }

    // The submit button is not wired separately: lex-form already delegates
    // clicks on lex-btn[type="submit"] into lex-submit, so a second listener
    // would run the step twice.

    var addBtn = el('runBookScopeValueAddBtn');
    if (addBtn) { addBtn.addEventListener('click', addScopeValue); }

    var valueInput = el('runBookScopeValueInput');
    if (valueInput) {
      valueInput.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') { return; }
        // lex-form turns Enter in any child lex-input into a submit. Stop the
        // key here or adding a scope value also advances to the upload step.
        event.preventDefault();
        event.stopPropagation();
        addScopeValue();
      });
    }

    var chips = el('runBookScopeValues');
    if (chips) {
      chips.addEventListener('click', function (event) {
        var button = event.target.closest('[data-remove-scope-value]');
        if (button) { removeScopeValue(button.getAttribute('data-remove-scope-value')); }
      });
    }
  }

  function bindUploadStep() {
    var chooseBtn = el('runBookChooseBtn');
    var input = el('runBookFileInput');

    if (chooseBtn && input) {
      chooseBtn.addEventListener('click', function () { input.click(); });
    }

    if (input) {
      input.addEventListener('change', function () {
        addFiles(input.files);
        input.value = '';
      });
    }

    var zone = el('runBookDropZone');
    if (zone) {
      zone.addEventListener('dragover', function (event) {
        event.preventDefault();
        zone.classList.add('is-dragging');
      });
      zone.addEventListener('dragleave', function () {
        zone.classList.remove('is-dragging');
      });
      zone.addEventListener('drop', function (event) {
        event.preventDefault();
        zone.classList.remove('is-dragging');
        addFiles(event.dataTransfer ? event.dataTransfer.files : null);
      });
    }

    var list = el('runBookFileList');
    if (list) {
      list.addEventListener('click', function (event) {
        var button = event.target.closest('[data-remove-file]');
        if (button) { removeFile(button.getAttribute('data-remove-file')); }
      });
    }

    var backBtn = el('runBookUploadBackBtn');
    if (backBtn) { backBtn.addEventListener('click', function () { setStep('declare'); }); }

    var proposeBtn = el('runBookProposeBtn');
    if (proposeBtn) { proposeBtn.addEventListener('click', proposeEntries); }
  }

  function bindReviewStep() {
    var container = el('runBookProposals');
    if (container) {
      container.addEventListener('lex-input', onEntryFieldChange);
      container.addEventListener('lex-change', onEntryFieldChange);
    }

    var backBtn = el('runBookReviewBackBtn');
    if (backBtn) { backBtn.addEventListener('click', function () { setStep('upload'); }); }
  }

  function bindEvents() {
    bindDeclareStep();
    bindUploadStep();
    bindReviewStep();

    var startOverBtn = el('runBookStartOverBtn');
    if (startOverBtn) { startOverBtn.addEventListener('click', startOver); }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  function init() {
    var content = el('lex-main-content');
    if (!content) { return; }

    // UI-level gate only. The backend requires admin:access, org:manage or
    // admin:manage_organization on every run book route and is the authority.
    var canOpenPage = window.Lex && Lex.Auth && Lex.Auth.canViewSystemStatus();
    if (!canOpenPage) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    scheduleReadinessCheck = Lex.Utils.debounce(runReadinessCheck, 400);

    bindEvents();
    renderScopeValues();
    setStep('declare');
  }

  if (window.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('admin/run-books.html', init);
  }

  init();

})();

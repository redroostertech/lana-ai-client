/* Firm Handbook - page controller for firm-handbook.html.
   Standalone page (not routed). Members read what is published to them;
   admins and org admins also create, edit, publish and share items.

   The role check here only decides what to show. The backend enforces
   knowledge:read / knowledge:manage on every call.

   Mapping and validation live in js/firm-handbook/firm-handbook.models.js and
   the API calls in js/services/firm-handbook-api.service.js; this file only
   wires them to the Lex components on the page.

   Pattern: IIFE + direct init() call.
*/

(function () {
  'use strict';

  var Models = window.LanaFirmHandbookModels;
  var Handbook = window.LanaFirmHandbookApi.create(window.api);

  var SEARCH_DEBOUNCE_MS = 350;

  var state = {
    canManage: false,
    searchTerm: '',
    loadSequence: 0,
    managed: [],
    current: null,          // managed item open in the manage drawer
    versions: [],
    recipients: null,       // Promise of { roles, groups, users } options
    createFile: null,       // File chosen for "Upload a file"
    busy: false
  };

  // ── Helpers ────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function esc(value) { return Lex.Utils.escapeHtml(value === undefined || value === null ? '' : String(value)); }

  function formatDate(value) { return value ? Lex.Utils.formatDate(value) : ''; }

  function formatDateTime(value) { return value ? Lex.Utils.formatDateTime(value) : ''; }

  var modelOptions = { formatDate: formatDate };

  function show(node, visible) {
    if (node) node.classList.toggle('hidden', !visible);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value || '';
  }

  function setError(id, message) {
    var node = el(id);
    if (!node) return;
    node.textContent = message || '';
    show(node, !!message);
  }

  function badge(chip) {
    return '<lex-badge label="' + esc(chip.label) + '" color="' + esc(chip.color) + '"></lex-badge>';
  }

  function muted(textValue) {
    return '<span class="fh-cell-muted">' + esc(textValue) + '</span>';
  }

  function countLabel(n) {
    return n + (n === 1 ? ' item' : ' items');
  }

  function setBusy(busy) {
    state.busy = busy;
    ['fhPublishBtn', 'fhUnpublishBtn', 'fhDeleteBtn', 'fhSaveDetailsBtn', 'fhSaveVisibilityBtn'].forEach(function (id) {
      var btn = el(id);
      if (btn) btn.disabled = busy;
    });
  }

  // ── Published list (server paged) ──────────────────────────────────

  function publishedRenderers() {
    return {
      title: function (val, row) {
        var summary = row._raw && row._raw.summary;
        return '<span class="fh-title-cell">' +
            '<span class="fh-title" title="' + esc(val) + '">' + esc(val) + '</span>' +
            (summary ? '<span class="fh-summary">' + esc(summary) + '</span>' : '') +
          '</span>';
      },
      version: function (val) {
        return val ? '<span class="fh-cell-nowrap">Version ' + esc(val) + '</span>' : muted('None');
      },
      published_at: function (val) {
        return val ? '<time class="fh-cell-nowrap" datetime="' + esc(val) + '">' + esc(formatDate(val)) + '</time>' : muted('None');
      },
      created_at: function (val) {
        return val ? '<time class="fh-cell-nowrap" datetime="' + esc(val) + '">' + esc(formatDateTime(val)) + '</time>' : muted('None');
      }
    };
  }

  async function loadPublished(query) {
    var table = el('fhPublishedTable');
    if (!table) return;
    var sequence = ++state.loadSequence;
    query = query || table.serverQuery || {};
    var limit = Number(query.limit) || 20;
    var page = Number(query.page) || 1;
    try {
      var payload = await Handbook.listPublished({ limit: limit, offset: (page - 1) * limit, search: state.searchTerm });
      if (sequence !== state.loadSequence) return;
      var result = Models.toMemberPage(payload, modelOptions);
      table.emptyText = state.searchTerm
        ? 'Nothing matches that search. Try different words.'
        : 'Nothing has been published to you yet';
      setText('fhPublishedCount', countLabel(result.total));
      table.setServerData(result.items.map(function (item) {
        return { id: item.id, title: item.title, version: item.versionNumber, published_at: item.publishedAt, created_at: item.createdAt, _raw: item };
      }), { page: page, limit: limit, total: result.total, total_pages: Math.max(1, Math.ceil(result.total / limit)) });
    } catch (error) {
      if (sequence !== state.loadSequence) return;
      setText('fhPublishedCount', '');
      table.setServerError(Models.describeError(error, 'The handbook could not be loaded. Check your connection and try again.'));
    }
  }

  function reloadPublished() {
    var table = el('fhPublishedTable');
    if (table && typeof table.requestServerQuery === 'function') table.requestServerQuery({ resetPage: true });
  }

  // ── Reader ─────────────────────────────────────────────────────────

  async function openReader(id) {
    var drawer = el('fhReaderDrawer');
    if (!drawer || !id) return;
    drawer.heading = 'Loading';
    setText('fhReaderMeta', '');
    setText('fhReaderSummary', '');
    setText('fhReaderContent', '');
    drawer.open = true;
    try {
      var view = Models.toReaderView(await Handbook.getPublished(id), modelOptions);
      drawer.heading = view.title || 'Firm Handbook';
      setText('fhReaderMeta', view.meta);
      setText('fhReaderSummary', view.summary);
      setText('fhReaderContent', view.content || 'This item has no text yet.');
    } catch (error) {
      drawer.heading = 'Firm Handbook';
      setText('fhReaderContent', Models.describeError(error, 'This item could not be opened. Try again.'));
    }
  }

  // ── Manage list (admins) ───────────────────────────────────────────

  function manageRenderers() {
    return {
      title: publishedRenderers().title,
      status: function (_val, row) {
        return '<span class="fh-chips">' + row._raw.chips.map(badge).join('') + '</span>';
      },
      visibility: function (_val, row) {
        return '<span class="fh-cell-nowrap">' + esc(row._raw.visibilityLabel) + '</span>';
      },
      version: publishedRenderers().version,
      published_at: publishedRenderers().published_at,
      created_at: publishedRenderers().created_at
    };
  }

  async function loadManaged() {
    var table = el('fhManageTable');
    if (!table || !state.canManage) return;
    try {
      state.managed = Models.toManageList(await Handbook.listManaged(), modelOptions);
      setText('fhManageCount', countLabel(state.managed.length));
      table.setData(state.managed.map(function (item) {
        return {
          id: item.id,
          title: item.title,
          summary: item.summary,
          status: item.statusLabel,
          visibility: item.visibilityLabel,
          version: item.versionNumber,
          published_at: item.publishedAt,
          created_at: item.createdAt,
          _raw: item
        };
      }));
      if (state.current) {
        var fresh = findManaged(state.current.id);
        if (fresh) { state.current = fresh; renderManageHeader(); }
      }
    } catch (error) {
      setText('fhManageCount', '');
      table.setError(error && error.status === 403
        ? Models.MESSAGES.manageForbidden
        : Models.describeError(error, 'Handbook items could not be loaded. Check your connection and try again.'));
    }
  }

  function findManaged(id) {
    for (var i = 0; i < state.managed.length; i++) {
      if (state.managed[i].id === id) return state.managed[i];
    }
    return null;
  }

  function refreshAll() {
    reloadPublished();
    return loadManaged();
  }

  // ── Visibility editor (create and edit drawers share the markup) ────

  function loadRecipients() {
    if (state.recipients) return state.recipients;
    state.recipients = Promise.allSettled([Handbook.listRoles(), Handbook.listGroups(), Handbook.listUsers()])
      .then(function (results) {
        var failed = results.some(function (r) { return r.status !== 'fulfilled'; });
        if (failed) Lex.Toast.warning('Some roles, groups or people could not be loaded.');
        return {
          roles: results[0].status === 'fulfilled' ? Models.roleOptions(results[0].value) : [],
          groups: results[1].status === 'fulfilled' ? Models.groupOptions(results[1].value) : [],
          users: results[2].status === 'fulfilled' ? Models.userOptions(results[2].value) : []
        };
      });
    return state.recipients;
  }

  function visibilityIds(prefix) {
    return {
      mode: el(prefix + 'Mode'),
      roles: el(prefix + 'Roles'),
      groups: el(prefix + 'Groups'),
      users: el(prefix + 'Users')
    };
  }

  function syncRecipientsVisible(prefix) {
    var nodes = visibilityIds(prefix);
    var box = nodes.mode && nodes.mode.closest('.fh-visibility');
    var restricted = nodes.mode && nodes.mode.value === Models.VISIBILITY_RESTRICTED;
    show(box && box.querySelector('[data-recipients]'), !!restricted);
  }

  // A multi-select's selection goes in as a JSON attribute: withFormField
  // types `value` as String, so an assigned array would stringify to "a,b".
  function setMulti(select, ids) {
    if (select) select.setAttribute('value', JSON.stringify(ids || []));
  }

  async function fillVisibility(prefix, visibility) {
    var nodes = visibilityIds(prefix);
    var v = visibility || { mode: Models.VISIBILITY_ORGANIZATION, roleIds: [], groupIds: [], userIds: [] };
    if (nodes.mode) nodes.mode.setAttribute('value', v.mode);
    syncRecipientsVisible(prefix);
    var options = await loadRecipients();
    if (nodes.roles) nodes.roles.options = options.roles;
    if (nodes.groups) nodes.groups.options = options.groups;
    if (nodes.users) nodes.users.options = options.users;
    setMulti(nodes.roles, v.roleIds);
    setMulti(nodes.groups, v.groupIds);
    setMulti(nodes.users, v.userIds);
  }

  function readVisibility(prefix) {
    var nodes = visibilityIds(prefix);
    return {
      mode: nodes.mode ? nodes.mode.value : Models.VISIBILITY_ORGANIZATION,
      roleIds: nodes.roles ? nodes.roles.value : [],
      groupIds: nodes.groups ? nodes.groups.value : [],
      userIds: nodes.users ? nodes.users.value : []
    };
  }

  // ── Create ─────────────────────────────────────────────────────────

  function openCreate() {
    var drawer = el('fhCreateDrawer');
    if (!drawer) return;
    el('fhCreateTitle').value = '';
    el('fhCreateSummary').value = '';
    el('fhCreateSource').setAttribute('value', Models.CREATE_BLANK);
    setCreateFile(null);
    syncCreateSource();
    setError('fhCreateError', '');
    fillVisibility('fhCreate', null);
    drawer.open = true;
  }

  function syncCreateSource() {
    var source = el('fhCreateSource');
    show(el('fhCreateUpload'), !!source && source.value === Models.CREATE_UPLOAD);
  }

  function setCreateFile(file) {
    state.createFile = file || null;
    setText('fhCreateFileName', file ? file.name : 'No file chosen');
    var input = el('fhCreateFileInput');
    if (!file && input) input.value = '';
  }

  async function submitCreate() {
    if (state.busy) return;
    var form = readVisibility('fhCreate');
    form.title = el('fhCreateTitle').value;
    form.summary = el('fhCreateSummary').value;
    form.source = el('fhCreateSource').value;
    form.file = state.createFile;
    var built = Models.buildCreatePayload(form);
    if (!built.valid) { setError('fhCreateError', built.message); return; }
    setError('fhCreateError', '');
    setBusy(true);
    try {
      var created = await Handbook.createItem(built.payload, built.file);
      el('fhCreateDrawer').open = false;
      Lex.Toast.success(built.file
        ? 'Item created from your file. LANA is reading it; publish it once that is done.'
        : 'Item created. Open it in the editor to write the content.');
      await loadManaged();
      var item = findManaged(created && created.id);
      if (item) {
        if (!item.editorMatterId && created.editor && created.editor.matter_id) item.editorMatterId = String(created.editor.matter_id);
        openManage(item);
      }
    } catch (error) {
      setError('fhCreateError', Models.describeError(error, 'The item could not be created. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  // ── Manage one item ────────────────────────────────────────────────

  function renderManageHeader() {
    var item = state.current;
    if (!item) return;
    var drawer = el('fhManageDrawer');
    drawer.heading = item.title || 'Handbook item';
    el('fhManageChips').innerHTML = item.chips.map(badge).join('');
    show(el('fhUnpublishBtn'), item.status === 'published');
    var openBtn = el('fhOpenEditorBtn');
    if (openBtn) openBtn.disabled = !Models.editorParams(item);
    if (item.status === 'published') {
      var reading = item.ingestionPending ? '. ' + Models.MESSAGES.ingestionPending + '.' : '';
      var failed = item.ingestionFailed ? '. ' + Models.MESSAGES.ingestionFailed + '. Publish again to retry.' : '';
      setText('fhPublishNote', item.publishedLine + reading + failed);
      show(el('fhPublishNote'), true);
    } else {
      show(el('fhPublishNote'), false);
    }
  }

  function showManagePanel(tab) {
    var panels = document.querySelectorAll('#fhManageDrawer [data-panel]');
    for (var i = 0; i < panels.length; i++) show(panels[i], panels[i].getAttribute('data-panel') === tab);
    if (tab === 'versions') loadVersions();
    if (tab === 'history') loadHistory();
  }

  function openManage(item) {
    if (!item) return;
    state.current = item;
    state.versions = [];
    el('fhEditTitle').value = item.title;
    el('fhEditSummary').value = item.summary;
    setError('fhEditError', '');
    setError('fhVisibilityError', '');
    fillVisibility('fhEdit', item.visibility);
    var tabs = el('fhManageTabs');
    if (tabs) tabs.active = 'details';
    showManagePanel('details');
    renderManageHeader();
    el('fhManageDrawer').open = true;
  }

  async function saveDetails() {
    var item = state.current;
    if (!item || state.busy) return;
    var built = Models.buildDetailsPayload({ title: el('fhEditTitle').value, summary: el('fhEditSummary').value });
    if (!built.valid) { setError('fhEditError', built.message); return; }
    setError('fhEditError', '');
    setBusy(true);
    try {
      await Handbook.updateItem(item.id, built.payload);
      Lex.Toast.success('Details saved.');
      await refreshAll();
    } catch (error) {
      setError('fhEditError', Models.describeError(error, 'The details could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveVisibility() {
    var item = state.current;
    if (!item || state.busy) return;
    var payload = Models.buildVisibilityPayload(readVisibility('fhEdit'));
    var check = Models.validateVisibility(payload);
    if (!check.valid) { setError('fhVisibilityError', check.message); return; }
    setError('fhVisibilityError', '');
    setBusy(true);
    try {
      await Handbook.updateItem(item.id, { visibility: payload });
      Lex.Toast.success('Visibility saved.');
      await refreshAll();
    } catch (error) {
      setError('fhVisibilityError', Models.describeError(error, 'Visibility could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  function openEditor() {
    var params = Models.editorParams(state.current);
    if (!params) { Lex.Toast.error('This item has no document to open yet.'); return; }
    Lex.Nav.go('file-editor.html', { params: params });
  }

  async function loadVersions() {
    var item = state.current;
    var list = el('fhVersionsList');
    if (!item || !list) return [];
    list.innerHTML = '<li class="fh-list-empty">Loading versions</li>';
    try {
      var rows = Models.toVersionRows(await Handbook.listVersions(item.id), modelOptions);
      if (state.current !== item) return rows;
      state.versions = rows;
      list.innerHTML = rows.length ? rows.map(function (row) {
        var chips = [];
        if (row.isCurrent) chips.push({ label: 'Current', color: 'blue' });
        if (row.isPublished) chips.push({ label: 'Published', color: 'green' });
        if (row.signed) chips.push({ label: 'Signed', color: 'indigo' });
        var meta = [row.createdLabel, row.createdBy ? 'by ' + row.createdBy : ''].filter(Boolean).join(' ');
        var restore = row.canRestore
          ? '<lex-btn variant="secondary" size="sm" data-restore-version="' + esc(row.versionNumber) + '">Restore</lex-btn>'
          : '';
        return '<li class="fh-list-item">' +
            '<span class="fh-list-main"><span class="fh-list-title">' + esc(row.label) + '</span>' +
            (meta ? '<span class="fh-list-meta">' + esc(meta) + '</span>' : '') + '</span>' +
            '<span class="fh-version-actions"><span class="fh-chips">' + chips.map(badge).join('') + '</span>' + restore + '</span>' +
          '</li>';
      }).join('') : '<li class="fh-list-empty">No saved versions yet. Open it in the editor and save.</li>';
      return rows;
    } catch (error) {
      list.innerHTML = '<li class="fh-list-empty">' + esc(Models.describeError(error, 'Versions could not be loaded.')) + '</li>';
      return [];
    }
  }

  async function loadHistory() {
    var item = state.current;
    var list = el('fhHistoryList');
    if (!item || !list) return;
    list.innerHTML = '<li class="fh-list-empty">Loading history</li>';
    try {
      var rows = Models.toPublicationRows(await Handbook.listPublications(item.id), modelOptions);
      if (state.current !== item) return;
      list.innerHTML = rows.length ? rows.map(function (row) {
        var color = row.state === 'Live' ? 'green' : 'gray';
        return '<li class="fh-list-item">' +
            '<span class="fh-list-main"><span class="fh-list-title">' + esc(row.line) + '</span>' +
            (row.title ? '<span class="fh-list-meta">' + esc(row.title) + '</span>' : '') +
            (row.endedLine ? '<span class="fh-list-meta">' + esc(row.endedLine) + '</span>' : '') + '</span>' +
            '<span class="fh-chips">' + badge({ label: row.state, color: color }) + '</span>' +
          '</li>';
      }).join('') : '<li class="fh-list-empty">Not published yet.</li>';
    } catch (error) {
      list.innerHTML = '<li class="fh-list-empty">' + esc(Models.describeError(error, 'History could not be loaded.')) + '</li>';
    }
  }

  async function restoreVersion(versionNumber) {
    var item = state.current;
    if (!item || state.busy || !versionNumber) return;
    var ok = await Lex.Modal.confirmAsync(
      'Restore version ' + versionNumber + '?',
      'It becomes the current version. LANA reads it again, and you can publish it once that is done. Newer versions stay in the list.',
      { confirmText: 'Restore' }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await Handbook.restoreVersion(item.sourceDocumentId, versionNumber, item.editorMatterId);
      Lex.Toast.success('Version ' + versionNumber + ' restored. LANA is reading it; publish it once that is done.');
      await loadVersions();
      await loadManaged();
    } catch (error) {
      Lex.Toast.error(Models.describeError(error, 'That version could not be restored. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function publishCurrent() {
    var item = state.current;
    if (!item || state.busy) return;
    var rows = await loadVersions();
    var current = Models.currentVersion(rows);
    if (!current || current.versionNumber === null) {
      Lex.Toast.error('There is no saved version yet. Open it in the editor and save first.');
      return;
    }
    if (current.isPublished && !item.hasUnpublishedChanges && item.status === 'published') {
      Lex.Toast.info(current.label + ' is already published.');
      return;
    }
    var audience = item.visibility.mode === Models.VISIBILITY_RESTRICTED ? 'The people it is shared with' : 'Everyone in the firm';
    var ok = await Lex.Modal.confirmAsync(
      'Publish ' + current.label.toLowerCase() + '?',
      audience + ' will see this version, and LANA will use it when it answers.',
      { confirmText: 'Publish' }
    );
    if (!ok) return;
    setBusy(true);
    try {
      var result = await Handbook.publish(item.id, current.versionNumber);
      var outcome = Models.publishResultMessage(result);
      if (outcome.level === 'warning') Lex.Toast.warning(outcome.message);
      else Lex.Toast.success(outcome.message);
      await refreshAll();
    } catch (error) {
      Lex.Toast.error(Models.describeError(error, 'The item could not be published. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    var item = state.current;
    if (!item || state.busy) return;
    var ok = await Lex.Modal.confirmAsync(
      'Unpublish this item?',
      'Members stop seeing it and LANA stops using it. Your versions stay, so you can publish again later.',
      { confirmText: 'Unpublish' }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await Handbook.unpublish(item.id);
      Lex.Toast.success('Unpublished.');
      await refreshAll();
    } catch (error) {
      Lex.Toast.error(Models.describeError(error, 'The item could not be unpublished. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem() {
    var item = state.current;
    if (!item || state.busy) return;
    var ok = await Lex.Modal.confirmAsync(
      'Delete this item?',
      'It comes out of the handbook, members stop seeing it and LANA stops using it. This cannot be undone.',
      { variant: 'danger', confirmText: 'Delete' }
    );
    if (!ok) return;
    setBusy(true);
    try {
      await Handbook.deleteItem(item.id);
      el('fhManageDrawer').open = false;
      state.current = null;
      Lex.Toast.success('Item deleted.');
      await refreshAll();
    } catch (error) {
      Lex.Toast.error(Models.describeError(error, 'The item could not be deleted. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  // ── Page tabs ──────────────────────────────────────────────────────

  function showPageTab(tab) {
    show(el('fhPublishedPanel'), tab !== 'manage');
    show(el('fhManagePanel'), tab === 'manage');
  }

  // ── Events ─────────────────────────────────────────────────────────

  function bindSearch(inputId, onSearch) {
    var timer = null;
    ['lex-input', 'lex-change'].forEach(function (name) {
      document.addEventListener(name, function (event) {
        if (!event.target || event.target.id !== inputId) return;
        var value = String((event.detail && event.detail.value) || '').trim();
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { onSearch(value); }, SEARCH_DEBOUNCE_MS);
      });
    });
  }

  function bindEvents(root) {
    root.addEventListener('lex-query-change', function (event) {
      if (event.target && event.target.id === 'fhPublishedTable') loadPublished(event.detail);
    });
    root.addEventListener('row-click', function (event) {
      var row = event.detail && event.detail.row;
      if (!row || !event.target) return;
      if (event.target.id === 'fhPublishedTable') openReader(row.id);
      if (event.target.id === 'fhManageTable') openManage(findManaged(row.id));
    });
    root.addEventListener('empty-action', function (event) {
      if (event.target && event.target.id === 'fhManageTable') openCreate();
    });

    bindSearch('fhSearch', function (value) {
      if (value === state.searchTerm) return;
      state.searchTerm = value;
      reloadPublished();
    });
    bindSearch('fhManageSearch', function (value) {
      var table = el('fhManageTable');
      if (table && typeof table.setSearch === 'function') table.setSearch(value);
    });

    // Segmented visibility mode: show recipients only when restricted.
    document.addEventListener('lex-change', function (event) {
      var id = event.target && event.target.id;
      if (id === 'fhCreateMode') syncRecipientsVisible('fhCreate');
      if (id === 'fhCreateSource') syncCreateSource();
      if (id === 'fhEditMode') syncRecipientsVisible('fhEdit');
    });

    document.addEventListener('tab-change', function (event) {
      var id = event.target && event.target.id;
      var tab = event.detail && event.detail.tab;
      if (id === 'fhTabs') showPageTab(tab);
      if (id === 'fhManageTabs') showManagePanel(tab);
    });

    var createDrawer = el('fhCreateDrawer');
    if (createDrawer) createDrawer.addEventListener('lex-confirm', submitCreate);

    var fileInput = el('fhCreateFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        setCreateFile(fileInput.files && fileInput.files[0] ? fileInput.files[0] : null);
      });
    }

    var versionsList = el('fhVersionsList');
    if (versionsList) {
      versionsList.addEventListener('click', function (event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-restore-version]') : null;
        if (btn) restoreVersion(Number(btn.getAttribute('data-restore-version')));
      });
    }

    var clicks = {
      fhNewBtn: openCreate,
      fhCreateChooseBtn: function () { var input = el('fhCreateFileInput'); if (input) input.click(); },
      fhOpenEditorBtn: openEditor,
      fhPublishBtn: publishCurrent,
      fhUnpublishBtn: unpublish,
      fhDeleteBtn: deleteItem,
      fhSaveDetailsBtn: saveDetails,
      fhSaveVisibilityBtn: saveVisibility
    };
    Object.keys(clicks).forEach(function (id) {
      var btn = el(id);
      if (btn) btn.addEventListener('click', clicks[id]);
    });

    // Topbar refresh: reload in place instead of the full-page fallback.
    document.addEventListener('lex-refresh', function (event) {
      event.preventDefault();
      refreshAll();
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  function init() {
    var root = el('firmHandbook');
    if (!root) return;

    state.canManage = !!(Lex.Auth && typeof Lex.Auth.isAdmin === 'function' && Lex.Auth.isAdmin());

    bindEvents(root);

    if (state.canManage) {
      show(el('fhNewBtn'), true);
      var tabs = el('fhTabs');
      if (tabs) {
        tabs.tabs = [{ id: 'manage', label: 'Manage' }, { id: 'published', label: 'Published' }];
        tabs.active = 'manage';
        show(tabs, true);
      }
      showPageTab('manage');
    }

    var manageTabs = el('fhManageTabs');
    if (manageTabs) {
      manageTabs.tabs = [
        { id: 'details', label: 'Details' },
        { id: 'visibility', label: 'Visibility' },
        { id: 'versions', label: 'Versions' },
        { id: 'history', label: 'History' }
      ];
    }

    var ready = window.customElements && typeof window.customElements.whenDefined === 'function'
      ? window.customElements.whenDefined('lex-table')
      : Promise.resolve();
    ready.then(function () {
      var published = el('fhPublishedTable');
      if (published) {
        // Renderers must be registered before the first page lands.
        published.setCellRenderers(publishedRenderers());
        published.requestServerQuery();
      }
      var manage = el('fhManageTable');
      if (manage && state.canManage) {
        manage.setCellRenderers(manageRenderers());
        loadManaged();
      }
      // firm-handbook.html?id=<item> opens that item in the reader.
      var params = Lex.Nav && typeof Lex.Nav.getParams === 'function' ? Lex.Nav.getParams() : null;
      var linkedId = params && params.get('id');
      if (linkedId) openReader(linkedId);
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────

  init();

})();

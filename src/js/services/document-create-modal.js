/**
 * New Document modal (shared creation flow).
 *
 * One flow for every entry point:
 * - Workspace documents section: the workspace is fixed to that matter.
 * - Global sidebar menu ("Document Studio"): the user picks the workspace.
 *
 * The user chooses document vs template and names the file. Templates can be
 * workspace-scoped or organization-scoped; organization templates live in the
 * auto-provisioned "Organization Templates" system workspace
 * (POST /api/v1/matters/organization-template-workspace).
 *
 * Creation goes through POST /api/v1/matters/{matterId}/documents/create-editable
 * and then opens the new file in the File Editor (LANA Editor embed).
 */
(function (global) {
  'use strict';

  var DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toast(message, type) {
    if (global.Lex && Lex.Toast && typeof Lex.Toast[type || 'info'] === 'function') {
      Lex.Toast[type || 'info'](message);
    }
  }

  function apiClient() {
    return global.api || null;
  }

  function responseData(response) {
    return response && response.data !== undefined && response.data !== null ? response.data : response;
  }

  function matterIdentity(matter) {
    if (!matter) return '';
    return String(matter.matter_id || matter.id || '');
  }

  function matterLabel(matter) {
    if (!matter) return '';
    return matter.name || matter.matter_name || matterIdentity(matter);
  }

  function renderContent(state) {
    // The workspace picker is always visible for documents and workspace
    // templates: pre-selected (and changeable) when launched from a
    // workspace, searchable when launched from the global menu. It hides only
    // for organization-scope templates, which live in the system workspace.
    var matterSection =
      '<div class="doc-create-field" data-doc-create-matter-section>' +
        '<label class="doc-create-label" for="docCreateMatterSearch">Workspace</label>' +
        '<input id="docCreateMatterSearch" type="text" autocomplete="off" placeholder="Search workspaces..." value="' + esc(state.selectedMatter ? matterLabel(state.selectedMatter) : '') + '">' +
        '<div id="docCreateMatterResults" class="doc-create-matter-results" hidden></div>' +
        '<p class="doc-create-hint">The document belongs to this workspace.</p>' +
      '</div>';

    // Preset entry points (e.g. the Template Library's "New Template") land
    // on the right radios; the user can still change any of them.
    var presetTemplate = state.presetType === 'template';
    var presetOrg = presetTemplate && state.presetScope === 'organization';

    return (
      '<div class="doc-create-form">' +
        '<div class="doc-create-field">' +
          '<span class="doc-create-label">Type</span>' +
          '<div class="doc-create-choice" role="radiogroup" aria-label="Document type">' +
            '<label><input type="radio" name="docCreateType" value="document"' + (presetTemplate ? '' : ' checked') + '><span>Document</span></label>' +
            '<label><input type="radio" name="docCreateType" value="template"' + (presetTemplate ? ' checked' : '') + '><span>Template</span></label>' +
          '</div>' +
        '</div>' +
        '<div class="doc-create-field">' +
          '<label class="doc-create-label" for="docCreateName">Name</label>' +
          '<input id="docCreateName" type="text" autocomplete="off" placeholder="' + (presetTemplate ? 'Untitled Template' : 'Untitled Document') + '" maxlength="200">' +
        '</div>' +
        matterSection +
        '<div class="doc-create-field doc-create-scope" data-doc-create-scope hidden>' +
          '<span class="doc-create-label">Template scope</span>' +
          '<div class="doc-create-choice" role="radiogroup" aria-label="Template scope">' +
            '<label><input type="radio" name="docCreateScope" value="matter"' + (presetOrg ? '' : ' checked') + '><span>Workspace template</span></label>' +
            '<label><input type="radio" name="docCreateScope" value="organization"' + (presetOrg ? ' checked' : '') + '><span>Organization template</span></label>' +
          '</div>' +
          '<p class="doc-create-hint" data-doc-create-scope-hint>Workspace templates stay with the selected workspace. Organization templates are reusable across the organization.</p>' +
        '</div>' +
        '<div class="doc-create-field" data-doc-create-access>' +
          '<span class="doc-create-label">Access</span>' +
          '<div class="doc-create-choice" role="radiogroup" aria-label="Document access">' +
            '<label><input type="radio" name="docCreateAccess" value="workspace" checked><span>Workspace</span></label>' +
            '<label><input type="radio" name="docCreateAccess" value="private"><span>Private</span></label>' +
            '<label><input type="radio" name="docCreateAccess" value="organization"><span>Organization</span></label>' +
          '</div>' +
          '<p class="doc-create-hint">Workspace inherits workspace access. Private is limited to you and people you share with. Organization is available to members with document access.</p>' +
        '</div>' +
      '</div>'
    );
  }

  function readForm(modal) {
    var typeInput = modal.querySelector('input[name="docCreateType"]:checked');
    var scopeInput = modal.querySelector('input[name="docCreateScope"]:checked');
    var accessInput = modal.querySelector('input[name="docCreateAccess"]:checked');
    var nameInput = modal.querySelector('#docCreateName');
    return {
      isTemplate: typeInput && typeInput.value === 'template',
      scope: scopeInput ? scopeInput.value : 'matter',
      accessScope: accessInput ? accessInput.value : 'workspace',
      name: nameInput && nameInput.value ? nameInput.value.trim() : ''
    };
  }

  function bindBehavior(modal, state) {
    var scopeSection = modal.querySelector('[data-doc-create-scope]');
    var matterSection = modal.querySelector('[data-doc-create-matter-section]');
    var accessSection = modal.querySelector('[data-doc-create-access]');

    function syncVisibility() {
      var form = readForm(modal);
      if (scopeSection) scopeSection.hidden = !form.isTemplate;
      // Organization templates live in the system workspace; the picker only
      // applies to workspace-scoped creation.
      if (matterSection) {
        matterSection.hidden = form.isTemplate && form.scope === 'organization';
      }
      // Organization templates have a fixed organization access scope.
      if (accessSection) {
        accessSection.hidden = form.isTemplate && form.scope === 'organization';
      }
    }

    modal.addEventListener('change', function (event) {
      if (event.target && (event.target.name === 'docCreateType' || event.target.name === 'docCreateScope')) {
        syncVisibility();
      }
    });
    syncVisibility();

    {
      var search = modal.querySelector('#docCreateMatterSearch');
      var results = modal.querySelector('#docCreateMatterResults');
      var searchTimer = null;

      function renderResults(matters) {
        if (!results) return;
        if (!matters.length) {
          results.innerHTML = '<div class="doc-create-matter-empty">No workspaces found</div>';
          results.hidden = false;
          return;
        }
        results.innerHTML = matters.slice(0, 10).map(function (matter) {
          return '<button type="button" class="doc-create-matter-option" data-matter-id="' + esc(matterIdentity(matter)) + '" data-matter-name="' + esc(matterLabel(matter)) + '">' +
            '<span>' + esc(matterLabel(matter)) + '</span>' +
            '<span class="doc-create-matter-id">' + esc(matterIdentity(matter)) + '</span>' +
          '</button>';
        }).join('');
        results.hidden = false;
      }

      async function loadMatters(query) {
        var client = apiClient();
        if (!client) return;
        try {
          var path = query
            ? '/api/v1/matters?search=' + encodeURIComponent(query) + '&limit=10'
            : '/api/v1/matters?limit=10';
          var response = await client.get(path);
          var data = responseData(response);
          renderResults((data && data.matters) || []);
        } catch (error) {
          renderResults([]);
        }
      }

      if (search) {
        search.addEventListener('focus', function () { loadMatters(search.value.trim()); });
        search.addEventListener('input', function () {
          state.selectedMatter = null;
          if (searchTimer) clearTimeout(searchTimer);
          searchTimer = setTimeout(function () { loadMatters(search.value.trim()); }, 200);
        });
      }
      if (results) {
        results.addEventListener('click', function (event) {
          var option = event.target && event.target.closest ? event.target.closest('.doc-create-matter-option') : null;
          if (!option) return;
          state.selectedMatter = {
            matter_id: option.getAttribute('data-matter-id'),
            name: option.getAttribute('data-matter-name')
          };
          if (search) search.value = matterLabel(state.selectedMatter);
          results.hidden = true;
        });
      }
    }

    var nameInput = modal.querySelector('#docCreateName');
    if (nameInput) setTimeout(function () { nameInput.focus(); }, 0);
  }

  function editorHandoffForDocument(doc, matterId, matterName) {
    var client = apiClient();
    var sourceUrl = client.baseUrl + '/api/v1/storage/files/' + encodeURIComponent(doc.id) + '/download' +
      (matterId ? '?matter_id=' + encodeURIComponent(matterId) : '');
    return {
      source: 'document_create',
      file: {
        id: 'file-editor-' + String(doc.id),
        documentId: String(doc.id),
        sourceDocumentId: String(doc.id),
        releasedDocumentId: '',
        matterId: matterId || '',
        matterName: matterName || '',
        kind: 'doc',
        title: doc.filename || 'Document',
        filename: doc.filename,
        contentType: doc.content_type || DOCX_CONTENT_TYPE,
        fileSize: doc.file_size,
        createdAt: doc.created_at,
        documentUpdatedAt: doc.updated_at || doc.created_at,
        updatedAt: doc.updated_at || doc.created_at,
        lastSavedAt: null,
        editorEngine: 'lana-editor',
        editorMode: 'review',
        content: '',
        sourceUrl: sourceUrl
      }
    };
  }

  async function createAndOpen(state, form) {
    var client = apiClient();
    if (!client) {
      toast('The API client is not available on this page.', 'error');
      return;
    }

    var matterId;
    var matterName;
    if (form.isTemplate && form.scope === 'organization') {
      var workspaceResponse = await client.post('/api/v1/matters/organization-template-workspace', {});
      var workspace = responseData(workspaceResponse);
      matterId = matterIdentity(workspace);
      matterName = matterLabel(workspace);
      if (!matterId) throw new Error('The organization template workspace could not be resolved.');
    } else {
      var matter = state.selectedMatter;
      if (!matter || !matterIdentity(matter)) {
        toast('Choose a workspace for the new document.', 'error');
        open(state.reopenOptions);
        return;
      }
      matterId = matterIdentity(matter);
      matterName = matterLabel(matter);
    }

    toast('Creating document...', 'info');
    var response = await client.post(
      '/api/v1/matters/' + encodeURIComponent(matterId) + '/documents/create-editable',
      {
        filename: form.name || (form.isTemplate ? 'Untitled Template' : 'Untitled Document'),
        is_template: form.isTemplate,
        template_scope: form.isTemplate ? form.scope : undefined,
        access_scope: form.isTemplate && form.scope === 'organization' ? 'organization' : form.accessScope
      }
    );
    var payload = responseData(response);
    var doc = payload && payload.document;
    if (!doc || !doc.id) throw new Error('The document was not created.');

    if (global.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go('file-editor.html', {
        params: { id: doc.id, matter_id: matterId },
        context: { fileEditor: editorHandoffForDocument(doc, matterId, matterName) }
      });
    } else {
      global.location.href = 'file-editor.html?' + new URLSearchParams({ id: doc.id, matter_id: matterId }).toString();
    }
  }

  function open(options) {
    options = options || {};
    if (!global.Lex || !Lex.Modal || typeof Lex.Modal.open !== 'function') {
      toast('Modal support is unavailable on this page.', 'error');
      return null;
    }
    var state = {
      // Launching from a workspace pre-selects it; the picker stays visible
      // and changeable either way.
      selectedMatter: options.matterId
        ? { matter_id: options.matterId, name: options.matterName || options.matterId }
        : null,
      presetType: options.presetType === 'template' ? 'template' : null,
      presetScope: options.presetScope === 'organization' ? 'organization' : null,
      source: options.source || 'unknown',
      reopenOptions: options
    };

    var modal = Lex.Modal.open({
      heading: state.presetType === 'template' ? 'New Template' : 'New Document',
      size: 'md',
      content: renderContent(state),
      confirmText: 'Create & Open',
      cancelText: 'Cancel',
      closeOnOverlay: false,
      onConfirm: function () {
        var form = readForm(modal);
        createAndOpen(state, form).catch(function (error) {
          console.error('[DocumentCreate] Creation failed:', error);
          toast((error && error.message) || 'Failed to create the document.', 'error');
        });
      }
    });
    bindBehavior(modal, state);
    return modal;
  }

  var service = { open: open };
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  global.LanaDocumentCreate = service;
})(typeof window !== 'undefined' ? window : globalThis);

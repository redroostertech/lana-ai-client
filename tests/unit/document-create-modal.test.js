'use strict';

const fs = require('fs');
const path = require('path');

const modal = require(path.join(__dirname, '../../src/js/services/document-create-modal.js'));

const modalJs = fs.readFileSync(path.join(__dirname, '../../src/js/services/document-create-modal.js'), 'utf8');
const lexModalJs = fs.readFileSync(path.join(__dirname, '../../src/js/lex/components/foundation/lex-modal.js'), 'utf8');
const lexAppJs = fs.readFileSync(path.join(__dirname, '../../src/js/lex/components/layout/lex-app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '../../src/js/workspace-details.js'), 'utf8');
const workspaceHtml = fs.readFileSync(path.join(__dirname, '../../src/workspace-details.html'), 'utf8');
const routerPagesJs = fs.readFileSync(path.join(__dirname, '../../src/js/lex/lex-router.pages.js'), 'utf8');

describe('New Document creation flow', () => {
  test('module exposes the open API', () => {
    expect(typeof modal.open).toBe('function');
  });

  test('creates through the matter-scoped create-editable endpoint and opens File Editor', () => {
    expect(modalJs).toContain("'/documents/create-editable'");
    expect(modalJs).toContain("Lex.Nav.go('file-editor.html'");
    expect(modalJs).toContain("source: 'document_create'");
    // The handoff must carry the matter so the editor treats the file as a
    // server-managed document (matterId + sourceDocumentId).
    expect(modalJs).toContain('sourceDocumentId: String(doc.id)');
    expect(modalJs).toContain('matterId: matterId');
  });

  test('organization templates go through the system workspace endpoint', () => {
    expect(modalJs).toContain("'/api/v1/matters/organization-template-workspace'");
    expect(modalJs).toContain("value=\"organization\"");
    expect(modalJs).toContain('template_scope');
  });

  test('documents and templates use the shared organization/workspace/private access hierarchy', () => {
    expect(modalJs).toContain('name="docCreateAccess" value="workspace"');
    expect(modalJs).toContain('name="docCreateAccess" value="private"');
    expect(modalJs).toContain('name="docCreateAccess" value="organization"');
    expect(modalJs).toContain('access_scope:');
    expect(modalJs).toContain("form.isTemplate && form.scope === 'organization' ? 'organization' : form.accessScope");
  });

  test('shared modal preserves selections while creation is pending or fails', () => {
    expect(modalJs).toContain('if (submitting) return;');
    expect(modalJs).toContain('confirm.loading = true;');
    expect(modalJs).toContain('function blockDismissWhileSubmitting(event)');
    expect(modalJs).toContain("event.type === 'keydown' && event.key === 'Escape'");
    expect(modalJs).toContain("event.target.closest('[data-action=\"close\"]')");
    expect(modalJs).toContain('event.stopImmediatePropagation();');
    expect(modalJs).toContain('cleanupDismissGuards');
    expect(modalJs).toContain('await createAndOpen(state, form);');
    expect(modalJs).toContain('showFormError(modal, message);');
    expect(modalJs).toContain('confirm.loading = false;');
    expect(modalJs).not.toContain('open(state.reopenOptions)');
  });

  test('shared Lex modal closes through focus restoration and exit animation before removal', () => {
    expect(lexModalJs).toContain('function removeAfterClose(modal)');
    expect(lexModalJs).toContain('modal.open = false;');
    expect(lexModalJs).toContain("panel.addEventListener('animationend', finish, { once: true })");
    expect(lexModalJs).toContain('modal.removeAfterClose = () => removeAfterClose(modal);');
    expect(lexModalJs).not.toContain("modal.addEventListener('lex-close', () => modal.remove())");
    expect(lexModalJs).not.toContain("modal.addEventListener('lex-cancel', () => modal.remove())");
  });

  test('Use Template creates a separate regular document and opens that new identity', async () => {
    jest.resetModules();
    let modalConfig;
    const handlers = {};
    const fields = {
      name: { value: 'Client Affidavit.docx', focus: jest.fn() },
      access: { value: 'workspace' },
      search: { value: '', addEventListener: jest.fn() },
      results: { addEventListener: jest.fn(), hidden: true },
      confirm: {
        addEventListener: jest.fn((name, handler) => { handlers.confirm = handler; }),
        disabled: false,
        textContent: ''
      },
      cancel: { addEventListener: jest.fn(), disabled: false },
      error: { hidden: true, textContent: '' }
    };
    const fakeModal = {
      addEventListener: jest.fn(),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      removeAfterClose: jest.fn(),
      remove: jest.fn(),
      querySelector: jest.fn((selector) => {
        if (selector === 'input[name="docCreateType"]:checked') return null;
        if (selector === 'input[name="docCreateScope"]:checked') return { value: 'matter' };
        if (selector === 'input[name="docCreateAccess"]:checked') return fields.access;
        if (selector === '#docCreateName') return fields.name;
        if (selector === '#docCreateMatterSearch') return fields.search;
        if (selector === '#docCreateMatterResults') return fields.results;
        if (selector === '[data-doc-create-confirm]') return fields.confirm;
        if (selector === '[data-doc-create-cancel]') return fields.cancel;
        if (selector === '[data-doc-create-error]') return fields.error;
        if (selector === '[data-doc-create-scope]' ||
            selector === '[data-doc-create-matter-section]' ||
            selector === '[data-doc-create-access]') return {};
        return null;
      })
    };
    const post = jest.fn().mockResolvedValue({
      data: {
        document: {
          id: 'document-copy-1',
          filename: 'Client_Affidavit.docx',
          original_filename: 'Client Affidavit.docx',
          display_filename: 'Client Affidavit.docx',
          content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      }
    });
    const go = jest.fn();
    global.api = { baseUrl: 'https://lana.test', get: jest.fn(), post };
    global.Lex = {
      Modal: { open: jest.fn((config) => { modalConfig = config; return fakeModal; }) },
      Nav: { go },
      Toast: { info: jest.fn(), error: jest.fn() }
    };

    const isolatedModal = require(path.join(__dirname, '../../src/js/services/document-create-modal.js'));
    isolatedModal.open({
      source: 'template_library_use',
      matterId: 'MATT-00040',
      matterName: 'Acme Workspace',
      sourceTemplate: {
        id: 'template-1',
        name: 'Affidavit Template.docx',
        sourceMatterId: 'ORG-TEMPLATES'
      }
    });

    expect(modalConfig.heading).toBe('Use Template');
    expect(modalConfig.content).toContain('Affidavit Template.docx');
    expect(modalConfig.content).toContain('The template will not be changed.');
    expect(modalConfig.content).toContain('original baseline');
    expect(modalConfig.content).not.toContain('aria-label="Document type"');
    expect(modalConfig.footerContent).toContain('data-doc-create-confirm');
    await handlers.confirm();

    expect(post).toHaveBeenCalledWith(
      '/api/v1/matters/MATT-00040/documents/create-editable',
      expect.objectContaining({
        filename: 'Client Affidavit.docx',
        is_template: false,
        access_scope: 'workspace',
        source_template_id: 'template-1'
      })
    );
    expect(go).toHaveBeenCalledWith('file-editor.html', expect.objectContaining({
      params: { id: 'document-copy-1', matter_id: 'MATT-00040' },
      context: {
        fileEditor: expect.objectContaining({
          file: expect.objectContaining({
            title: 'Client Affidavit.docx',
            filename: 'Client Affidavit.docx',
            storageFilename: 'Client_Affidavit.docx'
          })
        })
      }
    }));
    expect(fakeModal.removeAfterClose).toHaveBeenCalled();

    delete global.api;
    delete global.Lex;
  });

  test('Use Template copy does not promise a stale release and keeps the default filename within the API limit', () => {
    expect(modalJs).toContain('The latest released version available when you create the document will be used.');
    expect(modalJs).toContain("value.slice(0, 200 - resultSuffix.length).trim() + resultSuffix");
    expect(modalJs).not.toContain("'Released version ' + esc(state.sourceTemplate.version) + ' will be used.'");
  });

  test('sidebar Document Studio opens the shared creation modal', () => {
    expect(lexAppJs).toContain('LanaDocumentCreate');
    expect(lexAppJs).toContain("services/document-create-modal.js");
    expect(lexAppJs).not.toContain('DocStudioCreateModal.open({ api: window.api, pickMatter: true })');
  });

  test('workspace documents section offers New Document with the matter fixed', () => {
    expect(workspaceJs).toContain('function bindWorkspaceNewDocumentButton');
    expect(workspaceJs).toContain("source: 'workspace_documents'");
    expect(workspaceJs).toContain('id="workspaceNewDocumentBtn"');
    expect(workspaceHtml).toContain('js/services/document-create-modal.js');
    expect(workspaceHtml).toContain('css/document-create-modal.css');
    expect(routerPagesJs).toContain("'js/services/document-create-modal.js'");
  });
});

describe('Template Library', () => {
  const templatesPageJs = fs.readFileSync(path.join(__dirname, '../../src/js/document-library-templates.js'), 'utf8');
  const templatesPageHtml = fs.readFileSync(path.join(__dirname, '../../src/document-library-templates.html'), 'utf8');

  test('modal supports template presets and labels itself New Template', () => {
    expect(modalJs).toContain("presetType: !sourceTemplate && options.presetType === 'template' ? 'template' : null");
    expect(modalJs).toContain("presetScope: options.presetScope === 'organization' ? 'organization' : null");
    expect(modalJs).toContain("state.presetType === 'template' ? 'New Template' : 'New Document'");
    expect(modalJs).toContain("form.isTemplate ? 'Untitled Template' : 'Untitled Document'");
  });

  test('library page presents Template Library with a New Template CTA preset to organization scope', () => {
    expect(templatesPageHtml).toContain('<title>Template Library - LANA AI</title>');
    expect(templatesPageHtml).toContain('page-title="Template Library"');
    expect(templatesPageHtml).toContain('id="dstNewTemplate"');
    expect(templatesPageHtml).toContain('id="dstKindFilterLabel">Template type');
    expect(templatesPageHtml).toContain('"label":"Documents"');
    expect(templatesPageHtml).toContain('"label":"Document sets"');
    expect(templatesPageHtml).toContain('"label":"Layouts"');
    expect(templatesPageHtml).toContain('js/services/document-create-modal.js');
    expect(templatesPageHtml).toContain('js/app-catalog.js');
    expect(templatesPageHtml).toContain('css/document-create-modal.css');
    expect(templatesPageJs).toContain("source: 'template_library'");
    expect(templatesPageJs).toContain("presetType: 'template'");
    expect(templatesPageJs).toContain("presetScope: 'organization'");
    expect(templatesPageHtml).toContain('css/document-library-templates.css');
    expect(templatesPageHtml).toContain('js/document-library-templates.js');
    expect(templatesPageHtml).toContain('<lex-lana-dock page-scope="document-library-templates"');
    expect(templatesPageHtml).not.toContain('css/document-studio-templates.css');
    expect(templatesPageHtml).not.toContain('js/document-studio-templates.js');
  });

  test('Template Library is registered as a standard SPA page', () => {
    const descriptorsSource = fs.readFileSync(
      path.join(__dirname, '../../src/js/lex/lex-router.pages.js'),
      'utf8'
    );

    expect(descriptorsSource).toContain("'document-library-templates.html': {");
    expect(descriptorsSource).toContain("title: 'Template Library'");
    expect(descriptorsSource).toContain("activeNav: 'library-templates'");
    expect(descriptorsSource).toContain("'js/document-library-templates.js'");
    expect(descriptorsSource).toContain("'css/document-library-templates.css'");
  });

  test('editable DOCX templates open in the File Editor from the detail drawer', () => {
    expect(templatesPageJs).toContain('function _canOpenInFileEditor');
    expect(templatesPageJs).toContain("Lex.Nav.go('file-editor.html'");
    expect(templatesPageJs).toContain('Use Template');
    expect(templatesPageJs).toContain('Edit Template');
    expect(templatesPageJs).toContain("source: 'template_library_use'");
    expect(templatesPageJs).toContain('sourceTemplate: {');
  });

  test('inaccessible template details show the same access-denied treatment', () => {
    expect(templatesPageJs).toContain("err.status === 403 || err.status === 404");
    expect(templatesPageJs).toContain("Lex.Modal.alert('Access denied', message");
    expect(templatesPageJs).toContain('You do not have access to this template.');
  });

  test('the renamed template library files are the only page-specific assets', () => {
    expect(fs.existsSync(path.join(__dirname, '../../src/document-library-templates.html'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../../src/js/document-library-templates.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../../src/css/document-library-templates.css'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../../src/document-studio-templates.html'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '../../src/js/document-studio-templates.js'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '../../src/css/document-studio-templates.css'))).toBe(false);
  });

  test('sidebar Templates goes straight to the library page, not a workspace', () => {
    expect(lexAppJs).toContain("{ id: 'library-templates', label: 'Templates', href: 'document-library-templates.html' }");
    expect(lexAppJs).not.toContain('openOrganizationTemplatesFromMenu');
  });

  test('the system workspace matter page redirects to the Template Library', () => {
    expect(workspaceJs).toContain("system_type === 'organization_templates'");
    expect(workspaceJs).toContain("Lex.Nav.go('document-library-templates.html')");
  });
});

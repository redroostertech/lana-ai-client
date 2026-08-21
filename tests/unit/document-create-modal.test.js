'use strict';

const fs = require('fs');
const path = require('path');

const modal = require(path.join(__dirname, '../../src/js/services/document-create-modal.js'));

const modalJs = fs.readFileSync(path.join(__dirname, '../../src/js/services/document-create-modal.js'), 'utf8');
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
    expect(modalJs).toContain("presetType: options.presetType === 'template' ? 'template' : null");
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
    expect(templatesPageJs).toContain('Open in File Editor');
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

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const html = fs.readFileSync(path.join(SRC, 'file-editor.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'css/file-editor.css'), 'utf8');
const editor = fs.readFileSync(path.join(SRC, 'js/file-editor.js'), 'utf8');
const viewer = fs.readFileSync(path.join(SRC, 'js/file-viewer-page.js'), 'utf8');
const createModal = fs.readFileSync(path.join(SRC, 'js/services/document-create-modal.js'), 'utf8');

describe('File Editor live document boundary', () => {
  test('is a focused single-document surface, not another dashboard', () => {
    ['save', 'share', 'export', 'sign', 'show-review-details'].forEach((action) => {
      expect(html).toContain('data-action="' + action + '"');
    });
    expect(html).not.toContain('class="office-icon-btn file-editor-back"');
    [
      'office-summary',
      'office-library',
      'officeSearch',
      'officeFileList',
      'officeScopePanel',
      'data-panel="scope"'
    ].forEach((id) => {
      expect(html).not.toContain(id);
    });
    expect(html).toContain('id="officeFileTitle"');
    expect(html).toContain('id="officeEditorPanel"');
    expect(html).toContain('id="officeCollabPanel"');
    expect(html).toContain('id="officeSignaturePanel"');
    expect(html).toContain('id="officeReviewRailHost"');
    expect(html).toContain('id="officeContextToolbarHost"');
  });

  test('keeps the full document toolbar and ruler in the persistent header', () => {
    [
      'undo',
      'redo',
      'formatBlock',
      'fontName',
      'fontSize',
      'bold',
      'italic',
      'underline',
      'strikeThrough',
      'superscript',
      'subscript',
      'foreColor',
      'hiliteColor',
      'insertUnorderedList',
      'insertOrderedList',
      'outdent',
      'indent',
      'justifyLeft',
      'justifyCenter',
      'justifyRight',
      'justifyFull',
      'createLink',
      'unlink',
      'insertHorizontalRule',
      'removeFormat'
    ].forEach((command) => {
      expect(editor).toContain('data-command="' + command + '"');
    });
    expect(editor).toContain('data-action="insert-template-variable"');
    expect(editor).toContain('data-action="set-doc-margin"');
    expect(editor).toContain('data-margin="narrow"');
    expect(editor).toContain('data-margin="normal"');
    expect(editor).toContain('data-margin="wide"');
    expect(editor).toContain('data-action="toggle-show-changes"');
    expect(editor).toContain('data-action="add-selection-comment"');
    expect(editor).toContain('data-action="ask-lana-selection"');
    expect(editor).toContain("contextToolbar.innerHTML = '<div class=\"office-doc-toolbar\"");
    expect(editor).toContain("'<div class=\"office-doc-ruler office-doc-ruler-' + marginPreset");
    expect(editor).not.toContain("panel.innerHTML = '<div class=\"office-doc-canvas\">' +\n      '<div class=\"office-doc-toolbar\"");

    ['officeEditorStatusBar', 'officeSaveStatus', 'officePageCount', 'officeWordCount', 'officeCharacterCount', 'officeTokenCount', 'officeParagraphCount', 'officeReadingTime'].forEach((id) => {
      expect(html).toContain('id="' + id + '"');
    });
    expect(editor).toContain("['officePageCount', 'Pages '");
    expect(editor).toContain("['officeWordCount', 'Words '");
    expect(editor).toContain("['officeCharacterCount', 'Characters '");
    expect(editor).toContain("['officeTokenCount', 'Tokens '");
    expect(editor).toContain("['officeParagraphCount', 'Paragraphs '");
    expect(editor).toContain("['officeReadingTime', 'Reading time '");
  });

  test('has one shared persistent footer below both editor and review surfaces', () => {
    expect((html.match(/<footer\b/g) || []).length).toBe(1);
    expect(html.indexOf('id="officeEditorStatusBar"')).toBeGreaterThan(html.indexOf('id="officeReviewRailHost"'));
    expect(html).toContain('id="officeReviewFooterAction"');
    expect(html).toContain('id="officeReviewReleaseButton"');
    expect(editor).not.toContain('class="office-doc-inspector"');
    expect(editor).not.toContain('class="office-review-rail-footer"');
  });

  test('flattens the workspace and opens file info only from the header', () => {
    expect((html.match(/data-action="show-review-details"/g) || []).length).toBe(1);
    expect(editor).toContain('function openFileInfoDrawer(file)');
    expect(editor).toContain('var drawer = Lex.Drawer.open({');
    expect(editor).toContain("content: renderDocFileInfoRail(file, { drawer: true })");
    expect(editor).toContain("drawer.dataset.fileEditorInfo = 'true'");
    expect(editor).toContain('Release pending approval</strong>');
    expect(css).toContain('.file-editor-shell #officeEditorPanel');
    expect(css).toContain('.file-editor-shell .office-lana-editor-host');
    expect(css).toContain('box-shadow: none;');
  });

  test('uses durable URL identity and never hands off authorization headers', () => {
    expect(viewer).toContain("params: { id: file.id, matter_id: matterId || null }");
    expect(createModal).toContain('params: { id: doc.id, matter_id: matterId }');
    expect(viewer).not.toContain('sourceHeaders: getAuthHeaders()');
    expect(createModal).not.toContain("sourceHeaders: { Authorization:");
    expect(editor).toContain('async function loadFileEditorRouteContext()');
    expect(editor).toContain("localStorage.removeItem(STORAGE_KEY)");
    expect(editor).not.toContain('localStorage.setItem(STORAGE_KEY');
  });

  test('loads, saves, imports, and exports server-backed spreadsheet and deck models', () => {
    expect(html).toContain('<script src="js/services/file-editor-content-api.service.js"></script>');
    expect(html).toContain('id="officeCsvImport"');
    expect(editor).toContain('async function loadOfficeEditModel(file)');
    expect(editor).toContain('async function saveOfficeEditModel(file)');
    expect(editor).toContain('service.getEditModel(officeRealDocumentId(file))');
    expect(editor).toContain('service.saveEditModel(officeRealDocumentId(file), model)');
    expect(editor).toContain('service.exportDocument(officeRealDocumentId(file), officeFormat)');
    expect(editor).toContain('data-action="export-csv"');
    expect(editor).toContain('data-action="import-csv"');
    expect(editor).toContain('data-action="add-slide"');
    expect(editor).toContain('data-action="duplicate-slide"');
    expect(editor).toContain('data-action="delete-slide"');
    expect(editor).not.toContain('data-action="import-sample-csv"');
    expect(editor).toContain("if (action === 'save' && file)");
    expect(editor).toContain('saveOfficeEditModel(file).then(function ()');
    expect(editor).toContain("if (officeEdit.dirty) return 'Unsaved changes'");
    expect(editor).toContain("if (officeEdit.saving) return 'Saving...'");
    expect(editor).toContain("if (officeEdit.saveError) return 'Save failed'");
  });

  test('routes only capability-approved CSV, XLSX, and PPTX files from File Viewer', () => {
    const kindSource = viewer.slice(
      viewer.indexOf('function fileEditorKindForFile(file)'),
      viewer.indexOf('function plainTextToViewerHtml')
    );
    expect(viewer).toContain('function canOpenFileInEditor(file)');
    expect(viewer).toContain('officeCapabilitySupportsEditing(currentFormatCapabilities(file))');
    expect(viewer).toContain('if (!canOpenFileInEditor(file))');
    expect(viewer).toContain('officeEditingSupported: isOfficeEditFormat(file)');
    expect(kindSource).toContain("ext === 'xlsx'");
    expect(kindSource).toContain("ext === 'csv'");
    expect(kindSource).toContain("ext === 'pptx'");
    expect(kindSource).not.toContain("ext === 'xls'");
    expect(kindSource).not.toContain("ext === 'ppt'");
  });

  test('guards save, download, and release bytes by the mounted document identity', () => {
    expect(editor).toContain('function editorForFile(file)');
    expect(editor).toContain("throw new Error('The active editor does not match this document.')");
    expect(editor).toContain("throw new Error('The active document changed before download.')");
    expect(editor).toContain("throw new Error('The active document changed before release.')");
    expect(editor).toContain('content: currentBytes');
  });

  test('locks only for workflow restore failures and keeps a new draft editable during approval', () => {
    const editorModeSource = editor.slice(
      editor.indexOf('function officeEditorModeForFile(file)'),
      editor.indexOf('function editorForFile(file)')
    );
    const reviewRailSource = editor.slice(
      editor.indexOf('function renderDocReviewRail(file)'),
      editor.indexOf('function createFile(kind)')
    );
    const commentButtonAt = reviewRailSource.indexOf('data-action="dock-comment"');
    const commentButtonSource = reviewRailSource.slice(commentButtonAt - 100, commentButtonAt + 180);
    const saveButton = html.match(/<button[^>]*data-action="save"[^>]*>/)[0];

    expect(editor).toContain("mode: serverFile ? 'view'");
    expect(editorModeSource).toContain('review.loading || !review.loaded || review.loadFailed');
    expect(editorModeSource).toContain('review.draftDetailFailed || !review.restored');
    expect(editorModeSource).not.toContain('pendingReleaseBatch');
    expect(editorModeSource).toContain("return file.editorMode === 'view' ? 'view' : 'review'");
    const mountSource = editor.slice(
      editor.indexOf('async function mountLanaEditorForFile(file)'),
      editor.indexOf('function nowIso()')
    );
    const workflowLoadedAt = mountSource.indexOf('await loadServerReview(file)');
    const reviewModeAt = mountSource.indexOf("activeEditor.setMode('review')", workflowLoadedAt);
    const restoreAt = mountSource.indexOf('await restoreServerDraftWithRetry(file)', workflowLoadedAt);
    expect(workflowLoadedAt).toBeGreaterThan(-1);
    expect(reviewModeAt).toBeGreaterThan(workflowLoadedAt);
    expect(restoreAt).toBeGreaterThan(reviewModeAt);
    expect(editor).toContain('Release pending approval. Editing continues in a new draft; only another release request is unavailable until this approval is resolved.');
    expect(reviewRailSource).not.toContain('class="file-editor-pending-approval"');
    expect(reviewRailSource).not.toContain('data-action="show-review-details"');
    expect(reviewRailSource).toContain('!serverState.pendingReleaseBatch');
    expect(reviewRailSource).toContain("releaseButton.dataset.action = hasPendingApproval ? 'view-release-approval' : 'release-review-version'");
    expect(reviewRailSource).toContain('hasPendingApproval || canReleaseVersion');
    expect(reviewRailSource).toContain("? 'View Pending Approval'");
    expect(editor).toContain("Lex.Nav.go('approval-detail.html', { params: { id: approvalReview.pendingApprovalId } })");
    expect(editor).toContain("Lex.Nav.go('approvals.html', { params: { status: 'pending' } })");
    expect(commentButtonAt).toBeGreaterThan(-1);
    expect(commentButtonSource).not.toContain('pendingReleaseBatch');
    expect(commentButtonSource).not.toContain('disabled');
    expect(saveButton).not.toContain('disabled');
    expect(editor).toContain("if (action === 'save' && file)");
    expect(editor).toContain('await saveServerDraft(file, { silent: true })');
  });

  test('registers one SPA initializer with explicit leave cleanup', () => {
    expect(editor).toContain("LexRouter.registerPageInit('file-editor.html', init);");
    expect(editor).toContain('LexRouter.registerView({ onLeave: onLeave })');
    expect(editor).toContain('save.finally(function () { shutdownEditorInstance(departingEditor); })');
    expect(editor).toContain("} else {\n    init();\n  }");
  });
});

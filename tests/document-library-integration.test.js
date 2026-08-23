const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function loadCatalog() {
  const code = fs.readFileSync(path.join(SRC, 'js', 'app-catalog.js'), 'utf8');
  const sandbox = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', code)(sandbox.window);
  return sandbox.window.LanaClientApps;
}

function loadPageDescriptors() {
  const code = fs.readFileSync(path.join(SRC, 'js', 'lex', 'lex-router.pages.js'), 'utf8');
  const sandbox = {
    window: { Lex: {} },
    document: { addEventListener: () => {} }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', code)(sandbox.window, sandbox.document);
  return sandbox.window.Lex._pageDescriptors;
}

describe('Document Library integration', () => {
  test('prefers the original display filename over the storage-safe filename', () => {
    const controller = fs.readFileSync(path.join(SRC, 'js', 'document-library.js'), 'utf8');
    const displayIndex = controller.indexOf('file.display_filename');
    const originalIndex = controller.indexOf('file.original_filename');
    const storageIndex = controller.indexOf('file.filename', displayIndex);

    expect(displayIndex).toBeGreaterThan(-1);
    expect(originalIndex).toBeGreaterThan(displayIndex);
    expect(storageIndex).toBeGreaterThan(originalIndex);
  });

  test('app catalog routes Document Library and legacy aliases to the shipped page', () => {
    const Apps = loadCatalog();

    for (const alias of ['office-suite', 'office', 'lana-office', 'lana-office-suite']) {
      const app = Apps.normalizeApp(alias);
      expect(app).not.toBeNull();
      expect(app.id).toBe('document-library');
      expect(app.route).toBe('document-library.html');
      expect(fs.existsSync(path.join(SRC, app.route))).toBe(true);
    }

    expect(Apps.defaultApps().map((app) => app.id)).toContain('document-library');
  });

  test('SPA router descriptor loads the Document Library controller and assets', () => {
    const descriptors = loadPageDescriptors();
    const descriptor = descriptors['document-library.html'];

    expect(descriptor).toMatchObject({
      title: 'Document Library',
      activeNav: 'document-library'
    });
    expect(descriptor.scripts).toEqual(expect.arrayContaining([
      'js/time-utils.js',
      'js/app-catalog.js',
      'js/lex/components/foundation/lex-banner.js',
      'js/lex/components/foundation/lex-card.js',
      'js/lex/components/foundation/lex-modal.js',
      'js/lex/components/data/lex-pagination.js',
      'js/services/document-create-modal.js',
      'js/document-library.js',
      'js/lex/components/layout/lex-lana-dock.js'
    ]));
    expect(descriptor.stylesheets).toContain('css/document-library.css');
    expect(descriptor.stylesheets).toContain('css/document-create-modal.css');
    expect(descriptor.scripts).not.toContain('js/file-editor/writer-tools.js');
    expect(descriptor.scripts).not.toContain('js/services/document-review-api.service.js');

    for (const asset of descriptor.scripts.concat(descriptor.stylesheets)) {
      expect(fs.existsSync(path.join(SRC, asset))).toBe(true);
    }
  });

  test('standalone Document Library page uses the standard Lex page structure', () => {
    const html = fs.readFileSync(path.join(SRC, 'document-library.html'), 'utf8');

    expect(html).toContain('active-nav-id="document-library"');
    expect(html).toContain('page-title="Document Library"');
    expect(html).toContain('href="css/document-library.css"');
    expect(html).toContain('href="css/document-create-modal.css"');
    expect(html).toContain('id="documentLibrary"');
    expect(html).toContain('id="documentLibraryRecentFiles"');
    expect(html).toContain('Latest edited');
    expect(html).toContain('role="columnheader">File');
    expect(html).toContain('role="columnheader">Workspace');
    expect(html).toContain('role="columnheader">Last edited');
    expect(html).toContain('<lex-pagination id="documentLibraryPagination"');
    expect(html).toContain('<lex-banner');
    expect(html).toContain('data-action="new-document"');
    expect(html).toContain('src="js/time-utils.js"');
    expect(html).toContain('src="js/app-catalog.js"');
    expect(html).toContain('src="js/lex/components/foundation/lex-modal.js"');
    expect(html).toContain('src="js/services/document-create-modal.js"');
    expect(html).toContain('src="js/document-library.js"');
    expect(html).not.toContain('id="officeReviewRailHost"');
    expect(html).toContain('<lex-lana-dock page-scope="document-library"');
    expect(html).not.toContain('src="js/file-editor/writer-tools.js"');
    expect(html).not.toContain('src="js/conversation-menu.js"');
    expect(html.indexOf('src="js/time-utils.js"')).toBeLessThan(html.indexOf('src="js/api.js"'));
  });

  test('Document and Template Library pages use the full content width with standard gutters', () => {
    const css = fs.readFileSync(path.join(SRC, 'css', 'document-library.css'), 'utf8');

    expect(css).toMatch(/\.document-library\s*\{[^}]*max-width:\s*none;[^}]*padding:\s*2rem;/s);
    expect(css).not.toContain('max-width: 1180px');
    expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.document-library\s*\{[^}]*padding:\s*1rem;/);
    expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*?\.document-library\s*\{[^}]*padding:\s*0\.75rem;/);
  });

  test('the shared loader cannot intercept the page after it begins fading out', () => {
    const loader = fs.readFileSync(path.join(SRC, 'js', 'lex', 'components', 'foundation', 'lex-loader.js'), 'utf8');

    expect(loader).toMatch(/#lex-loader-overlay\s*\{[^}]*pointer-events:\s*none;/s);
    expect(loader).toMatch(/#lex-loader-overlay\.lex-loader-visible\s*\{[^}]*pointer-events:\s*auto;/s);
  });

  test('Document Library loads paginated latest-edited files and reuses shared document creation', () => {
    const controller = fs.readFileSync(path.join(SRC, 'js', 'document-library.js'), 'utf8');

    expect(controller).toContain("'/api/v1/storage/documents?page=' + currentPage + '&page_size='");
    expect(controller).toContain('&sort_by=updated_at&sort_order=desc');
    expect(controller).toContain('LanaDocumentCreate.open');
    expect(controller).toContain("source: 'document_library'");
    expect(controller).toContain("Lex.Nav.go('file-viewer.html'");
    expect(controller).toContain("'/api/v1/storage/files/' + encodeURIComponent(fileId)");
    expect(controller).toContain("Lex.Modal.alert('Access denied', 'You do not have access to this file.'");
    expect(controller).toContain('data-file-workspace-id=');
    expect(controller).toContain("return 'Organization';");
    expect(controller).toContain("Lex.Nav.go('workspace-details.html'");
    expect(controller).toContain('data-workspace-id=');
    expect(controller).toContain("workspaceName !== '—'");
    expect(controller).toContain("LexRouter.registerPageInit('document-library.html', init);");
    expect(controller).toContain("root.addEventListener('page-change'");
    expect(controller).not.toContain('officeEditorInstance');
  });

  test('Template Library instantiates editable templates through the shared creation flow', () => {
    const controller = fs.readFileSync(path.join(SRC, 'js', 'document-library-templates.js'), 'utf8');
    const modalController = fs.readFileSync(path.join(SRC, 'js', 'services', 'document-create-modal.js'), 'utf8');

    expect(controller).toContain('id="dstUseTemplate"');
    expect(controller).toContain('Use Template');
    expect(controller).toContain("source: 'template_library_use'");
    expect(controller).toContain('sourceTemplate: {');
    expect(controller).toContain('id: base.id');
    expect(controller).toContain('sourceMatterId: base.sourceMatterId');
    expect(modalController).toContain("heading: state.sourceTemplate ? 'Use Template'");
    expect(modalController).toContain('requestBody.source_template_id = state.sourceTemplate.id');
    expect(modalController).toContain('is_template: form.isTemplate');
    expect(modalController).toContain("Lex.Nav.go('file-editor.html'");
  });

  test('File Editor page is a focused editor route with its own assets', () => {
    const fileEditorHtml = fs.readFileSync(path.join(SRC, 'file-editor.html'), 'utf8');
    const descriptors = loadPageDescriptors();

    expect(fileEditorHtml).toContain('<title>File Editor - LANA AI</title>');
    expect(fileEditorHtml).toContain('page-title="File Editor"');
    expect(fileEditorHtml).toContain('class="office-shell file-editor-shell"');
    expect(fileEditorHtml).not.toContain('LANA File Editor');
    expect(fileEditorHtml).not.toContain('Edit, review, release, and discuss this document.');
    expect(fileEditorHtml).not.toContain('Work on documents, sheets, slides, and signatures in one place.');
    expect(fileEditorHtml).not.toContain('aria-label="Create a file"');

    expect(descriptors['file-editor.html']).toMatchObject({
      title: 'File Editor',
      activeNav: 'document-library'
    });
    // File Editor owns its own page assets and shares only the document route.
    expect(descriptors['file-editor.html'].scripts).toContain('js/file-editor.js');
    expect(descriptors['file-editor.html'].scripts).toContain('js/services/document-review-api.service.js');
    expect(descriptors['file-editor.html'].scripts).toContain('js/services/file-editor-content-api.service.js');
    expect(descriptors['file-editor.html'].scripts).toContain('js/file-editor/writer-tools.js');
    expect(descriptors['file-editor.html'].scripts).toContain('js/file-editor/sheet-engine.js');
    expect(descriptors['file-editor.html'].scripts).not.toContain('js/document-library.js');
    expect(descriptors['file-editor.html'].stylesheets).toContain('css/file-editor.css');
    expect(descriptors['file-editor.html'].stylesheets).toContain('css/lex-chat.css');
    expect(fileEditorHtml).toContain('src="js/file-editor.js"');
    expect(fileEditorHtml).toContain('src="js/services/document-review-api.service.js"');
    expect(fileEditorHtml).toContain('src="js/services/file-editor-content-api.service.js"');
    expect(fileEditorHtml).not.toContain('src="js/document-library.js"');
    expect(fileEditorHtml).toContain('href="css/file-editor.css"');
    expect(fileEditorHtml).toContain('href="css/lex-chat.css"');

    const editorController = fs.readFileSync(path.join(SRC, 'js', 'file-editor.js'), 'utf8');
    const libraryController = fs.readFileSync(path.join(SRC, 'js', 'document-library.js'), 'utf8');
    expect(editorController).toContain("LexRouter.registerPageInit('file-editor.html', init);");
    expect(editorController).not.toContain("LexRouter.registerPageInit('document-library.html', init);");
    expect(libraryController).toContain("LexRouter.registerPageInit('document-library.html', init);");
    expect(libraryController).not.toContain("LexRouter.registerPageInit('file-editor.html', init);");
    expect(editorController).toContain("var STORAGE_KEY = 'lana:file-editor:local';");
  });

  test('document review affordances use the editor rail without compare controls', () => {
    const controller = fs.readFileSync(path.join(SRC, 'js', 'file-editor.js'), 'utf8');
    const css = fs.readFileSync(path.join(SRC, 'css', 'file-editor.css'), 'utf8');

    expect(controller).toContain('function renderDocReviewRail');
    expect(controller).toContain('function renderDocFileInfoRail');
    expect(controller).toContain('function renderReviewDock');
    expect(controller).toContain('officeReviewRailHost');
    expect(controller).toContain('has-review-dock');
    expect(controller).toContain('Review / Redline active');
    expect(controller).toContain('File Metadata');
    expect(controller).toContain('AI Summary');
    expect(controller).toContain("rightRailMode = 'file-info'");
    expect(controller).toContain("if (action === 'save-file-info'");
    expect(controller).toContain('Change History');
    expect(controller).toContain('Release Version');
    expect(controller).toContain('Comments');
    expect(controller).toContain('data-action="set-review-tab"');
    expect(controller).toContain('function openLanaDockWithActiveFile');
    expect(controller).toContain("if (file.kind === 'doc') return 'document_chat';");
    // The dock is prefilled, never auto-sent: the user decides when to send.
    expect(controller).toContain("prefillPrompt: prompt || 'Help me work on this document.'");
    expect(controller).not.toContain('initialPrompt:');
    expect(controller).toContain("if (action === 'ai-assist')");
    expect(controller).toContain("if (action === 'ask-lana-selection')");
    // Change cards use the dock's declarative trigger contract (same pattern
    // as File Viewer): open + context + composer prefill, no page handler.
    expect(controller).toContain('data-lana-dock-trigger');
    expect(controller).toContain('data-lana-context-type="document_chat"');
    expect(controller).toContain('data-lana-prefill=');
    expect(controller).not.toContain("if (action === 'ask-lana-review-change')");
    expect(controller).toContain("source: 'file_editor_review_rail'");
    expect(controller).not.toContain('data-action="ask-lana-review-change"');
    expect(controller).not.toContain('office-lana-dock');
    expect(controller).not.toContain("if (action === 'ask-lana-document')");
    expect(controller).not.toContain("if (action === 'dock-versions')");
    expect(controller).toContain('function officeFileCardContext');
    expect(controller).toContain('function officeDataInsertionContext');
    expect(controller).toContain("type: 'office_file'");
    expect(controller).toContain("context_type: 'office_document'");
    expect(controller).toContain('document_id: sourceDocumentId || null');
    expect(controller).toContain('data_insertions: officeDataInsertionContext()');
    expect(controller).toContain("template_variable_syntax: '#{{entity:property_key}}'");
    expect(controller).toContain("date_variable_syntax: '#{{date:todays_date:format}}'");
    expect(controller).toContain("user_mention_syntax: '@{{user_id:property_key}}'");
    expect(controller).toContain('change_summaries: (managed ? reviewRows : (file.reviewChanges || [])).slice(0, 12)');
    expect(controller).toContain('documentId: documentId || null');
    expect(controller).toContain("type: 'office_selection'");
    expect(controller).toContain("context_type: 'editor_selection'");
    expect(controller).toContain('selection: {');
    expect(controller).toContain('cardContext: officeFileCardContext(file, focusedContext)');
    expect(controller).toContain('function captureSavedDocReviewChange');
    expect(controller).toContain('DOC_AUTOSAVE_DELAY_MS');
    expect(controller).toContain('function scheduleDocAutosave');
    expect(controller).toContain('function saveDocBatch');
    expect(controller).toContain('function savedStatusLabel');
    expect(controller).toContain('lastSavedAt');
    expect(controller).toContain('Autosaving...');
    expect(controller).toContain('Last saved ');
    expect(controller).toContain('function applyFileEditorContext');
    expect(controller).toContain('ctx.fileEditor');
    expect(controller).toContain('sourceDocumentId');
    expect(controller).toContain('sourceUrl');
    expect(controller).toContain('if (shouldUseDraftShell(file)) return false;');
    expect(controller).toContain('incoming.preferDraftShell');
    expect(controller).toContain('function normalizeLoadedState');
    expect(controller).toContain('function ensureEditableDocContent');
    expect(controller).toContain('function coalesceOfficeDraftChanges');
    expect(controller).toContain('function officeEditorModeForFile');
    expect(controller).toContain("mode: serverFile ? 'view' : officeEditorModeForFile(file)");
    expect(controller).toContain('activeEditor.setMode');
    expect(controller).toContain('function syncOfficeEditorReviewState');
    expect(controller).toContain("mountedEditor.on('change-applied'");
    expect(controller).toContain('officeEditorInstance.reviewState()');
    expect(controller).toContain('file.openedFromFileViewer');
    expect(controller).toContain('function renderDocContentWithReviewMarks');
    expect(controller).toContain('function stripOfficeReviewMarksFromHtml');
    expect(controller).toContain('function buildOfficeReviewInline');
    expect(controller).toContain('function upsertOfficeDraftBatchChange');
    expect(controller).toContain('function sortReviewChangesByNewest');
    expect(controller).toContain('function sortReviewItemsByOldest');
    expect(controller).toContain('function sortReviewItemsByNewest');
    expect(controller).toContain('reviewChangeTimestamp(b) - reviewChangeTimestamp(a)');
    expect(controller).toContain('reviewChangeTimestamp(a) - reviewChangeTimestamp(b)');
    expect(controller).toContain('function charChangeSummary');
    expect(controller).toContain('return sortReviewItemsByNewest(candidates).slice(0, 50);');
    expect(controller).toContain('function applyParagraphStyle');
    expect(controller).toContain('function replaceBlockTag');
    expect(controller).toContain('function pushDocUndoSnapshot');
    expect(controller).toContain('function applyDocHistoryCommand');
    expect(controller).toContain("if ((command === 'undo' || command === 'redo') && applyDocHistoryCommand(command))");
    expect(controller).toContain('function changeIsPending');
    expect(controller).toContain('function changeIsReleased');
    expect(controller).toContain('function normalizeReviewVersionTitle');
    expect(controller).toContain("replace(/^Verion\\b/i, 'Version')");
    expect(controller).toContain('function commitReleasedDocBody');
    expect(controller).toContain('function docHasUnsavedDraftChanges');
    expect(controller).toContain('function docHasActiveSavedDraft');
    expect(controller).toContain('function lineChangeSummary');
    expect(controller).toContain("if (type.indexOf('new paragraph') !== -1) return 'insert';");
    expect(controller).toContain('function revertReviewChangeAtIndex');
    expect(controller).toContain('function replaceFirstTextInHtml');
    expect(controller).toContain('data-action="revert-review-change"');
    expect(controller).toContain('function templateVariableEntities');
    expect(controller).toContain('function templateVariableTrigger');
    expect(controller).toContain('function insertTemplateVariableToken');
    expect(controller).toContain('function mentionUserProperties');
    expect(controller).toContain('function mentionUserTrigger');
    expect(controller).toContain('function requestMentionUsers');
    expect(controller).toContain('function insertMentionUserToken');
    expect(controller).toContain('data-action="insert-template-variable"');
    expect(controller).toContain('data-template-variable="true"');
    expect(controller).toContain('data-user-mention="true"');
    expect(controller).toContain('data-template-variable-search');
    expect(controller).toContain('data-template-variable-back');
    expect(controller).toContain('data-template-date-source');
    expect(controller).toContain('data-template-date-format');
    expect(controller).toContain('data-mention-user');
    expect(controller).toContain('data-mention-property');
    expect(controller).toContain("!event.target.closest('[data-template-variable-search]')");
    expect(controller).toContain('#{{entity:property_key}}');
    expect(controller).toContain('#{{date:todays_date:format}}');
    expect(controller).toContain('@{{user_id:property_key}}');
    expect(controller).toContain("key: 'contact'");
    expect(controller).toContain("key: 'date'");
    expect(controller).toContain("key: 'todays_date'");
    expect(controller).toContain("key: 'custom_date'");
    expect(controller).toContain("key: 'weekday_long'");
    expect(controller).toContain("key: 'participant'");
    expect(controller).toContain("key: 'matter'");
    expect(controller).toContain("key: 'document'");
    expect(controller).toContain("key: 'task'");
    expect(controller).toContain("key: 'opportunity'");
    expect(controller).toContain("key: 'deal'");
    expect(controller).toContain("key: 'calendar_event'");
    expect(controller).toContain("key: 'message'");
    expect(controller).not.toContain("key: 'court'");
    expect(controller).not.toContain("key: 'case'");
    expect(controller).not.toContain("key: 'signer'");
    expect(controller).not.toContain("key: 'attorney'");
    expect(controller).not.toContain("key: 'invoice'");
    expect(controller).not.toContain("key: 'opposing_party'");
    expect(controller).toContain('if (!changeIsPending(change)) return false;');
    expect(controller).toContain('Only server-managed documents can be released.');
    expect(controller).toContain('Subheading');
    expect(controller).toContain('Caption');
    expect(controller).toContain('Footnote');
    expect(controller).toContain('data-action="toggle-show-changes"');
    expect(controller).toContain("LexRouter.registerPageInit('file-editor.html', init);");
    expect(controller).toContain('reviewBaselineContent');
    expect(controller).toContain('change.before');
    expect(controller).toContain('Saved and added to Change History.');
    expect(controller).not.toContain('office-doc-outline-section');
    expect(controller).not.toContain('Compare versions');
    expect(controller).not.toContain('Versions & Changes');
    expect(controller).not.toContain('No backend calls');
    expect(controller).not.toContain("'/edit-batches'");
    expect(controller).not.toContain("'/release'");
    expect(controller).not.toContain("'/compare'");

    expect(css).toContain('.office-review-rail');
    expect(css).toContain('.office-review-dock');
    expect(css).toContain('.office-file-info-rail');
    expect(css).toContain('.office-file-info-card');
    expect(css).toContain('.office-file-info-summary-text');
    expect(css).toContain('.office-workspace.has-review-dock');
    expect(css).toContain('.office-review-tabs');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(css).toContain('.office-review-comments-panel');
    expect(css).toContain('.office-file-review-metadata');
    expect(css).toContain('.office-show-changes-toggle');
    expect(css).toContain('.office-show-changes-toggle:disabled');
    expect(css).toContain('.office-lana-editor-host--release-compare');
    expect(css).toContain('.office-review-insert');
    expect(css).toContain('.office-review-delete');
    expect(css).toContain('.office-review-change:hover::after');
    expect(css).toContain('.office-review-rail-footer button:disabled');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('.office-review-rail-footer .office-review-release-btn');
    expect(css).toContain('.office-btn:disabled');
    expect(css).toContain('.office-review-history-row-actions');
    expect(css).toContain('.office-review-history-row-lana');
    expect(css).toContain('.office-review-history-row-lana-button');
    expect(css).toContain('.office-review-history-row:hover::before');
    expect(css).toContain('.file-editor-workspace');
    expect(css).toContain('.file-editor-shell .file-editor-workspace.has-review-dock');
    expect(css).toContain('.office-template-variable');
    expect(css).toContain('.office-user-mention');
    expect(css).toContain('.office-template-variable-menu');
    expect(css).toContain('.office-template-variable-search');
    expect(css).toContain('.office-template-variable-back');
    expect(css).toContain('.office-template-variable-person');
    expect(css).toContain('background: #fff;');
    expect(css).toContain('width: min(300px, calc(100vw - 24px));');
    expect(css).toContain('.office-doc-page h3');
    expect(css).toContain('.office-doc-page h4');
    expect(css).toContain('.office-doc-subheading');
    expect(css).toContain('.office-doc-caption');
    expect(css).toContain('.office-doc-footnote');
    expect(css).not.toContain('.office-lana-dock');
    expect(css).not.toContain('.office-doc-outline-section');
  });

  test('document editor state machine separates unsaved edits, saved drafts, releases, and reverts', () => {
    const controller = fs.readFileSync(path.join(SRC, 'js', 'file-editor.js'), 'utf8');
    const css = fs.readFileSync(path.join(SRC, 'css', 'file-editor.css'), 'utf8');

    expect(controller).toContain('function ensureReviewBaseline');
    // The localStorage release bridge is retired: real matter documents save
    // drafts and release through the server via LanaDocumentReview.
    expect(controller).not.toContain('FILE_VIEWER_OFFICE_RELEASES_KEY');
    expect(controller).not.toContain('publishFileViewerOfficeRelease');
    expect(controller).not.toContain('local_office_release');
    expect(controller).toContain('function isServerReviewFile');
    expect(controller).toContain('function loadServerReview');
    expect(controller).toContain('function saveServerDraft');
    expect(controller).toContain('function releaseServerVersion');
    expect(controller).toContain('function completeApprovedRelease');
    expect(controller).toContain("pendingApprovalStatus === 'approved'");
    expect(controller).toContain("return 'complete-approved-release'");
    expect(controller).toContain("return 'Complete Release'");
    expect(controller).toContain('approval_id: review.pendingApprovalId');
    expect(controller).toContain('LanaDocumentReview');
    expect(controller).toContain('function sanitizeOfficeDocHtml');
    expect(controller).toContain('function sanitizeOfficeDocText');
    expect(controller).toContain('function cleanOfficeDocContent');
    expect(controller).toContain('DOC_UI_TEXT_ARTIFACT_PATTERN');
    expect(controller).toContain('function cleanOfficeDocContent');
    expect(controller).toContain('function docHasUnsavedDraftChanges');
    expect(controller).toContain('function docHasActiveSavedDraft');
    expect(controller).toContain('var cleanContent = cleanOfficeDocContent(file.content || \'\');');
    expect(controller).toContain('var baseline = cleanOfficeDocContent(file.reviewBaselineContent || \'\');');
    expect(controller).toContain('return pendingDocReviewChanges(file).length > 0;');

    expect(controller).toContain('function lineChangeSummary');
    expect(controller).toContain("type: removed.length && added.length ? 'Paragraph replacement' : added.length ? 'New paragraph' : 'Paragraph removed'");
    expect(controller).toContain("before: excerptLines(removed, 4) || 'no previous text'");
    expect(controller).toContain('function excerptChars');
    expect(controller).toContain('function charChangeSummary');
    expect(controller).toContain('var before = cleanOfficeDocContent(file.reviewBaselineContent || \'\');');
    expect(controller).toContain('file.officeDraftBatchBaselineContent = file.officeDraftBatchBaselineContent || before;');
    expect(controller).toContain('upsertOfficeDraftBatchChange(file, summary, file.officeDraftBatchBaselineContent, after);');
    expect(controller).toContain('file.reviewBaselineContent = afterContent || \'\';');

    expect(controller).toContain('file.reviewChanges[i].officeDraftBatch &&');
    expect(controller).toContain('function sanitizeOfficeReviewChange');
    expect(controller).toContain("type === 'paragraph replacement'");
    expect(controller).toContain("type === 'new paragraph'");
    expect(controller).toContain("type === 'paragraph break'");
    expect(controller).toContain('file.reviewChanges.unshift(payload);');
    expect(controller).toContain('index !== existingIndex');
    expect(controller).toContain('items: [itemPayload]');
    expect(controller).toContain('payload.items = existingItems.slice(-12);');
    expect(controller).toContain('var batchItems = sortReviewItemsByNewest(Array.isArray(change.items)');
    expect(controller).toContain("office-review-history-row--batch");
    expect(controller).toContain("esc((itemIndex + 1) + '. ' + (item.type || 'Edit'))");
    expect(css).toContain('.office-review-diff-item');
    expect(css).toContain('.office-review-diff-item + .office-review-diff-item');
    expect(css).toContain('.office-review-diff-label');
    expect(css).toContain('.office-review-history-row--batch');
    expect(css).toContain('max-height: 260px;');
    expect(css).toContain('max-height: 180px;');
    expect(css).toContain('overflow-y: auto;');

    expect(controller).toContain(': docHasActiveSavedDraft(file);');
    expect(controller).toContain("releaseButton.dataset.action = hasPendingApproval ? pendingApprovalAction : 'release-review-version'");
    expect(controller).toContain("? pendingReleaseButtonAction(serverReview(file)) : 'release-review-version'");
    expect(controller).not.toContain('data-action="save-review-snapshot"');
    expect(controller).not.toContain('Save draft');
    expect(controller).not.toContain('>Save Draft</button>');
    expect(controller).toContain("if (action === 'release-review-version' && file)");
    expect(controller).toContain("if (action === 'complete-approved-release' && file)");
    expect(controller).toContain('Only server-managed documents can be released.');
    expect(controller).not.toContain('No unreleased changes');

    expect(controller).toContain('function commitReleasedDocBody');
    expect(controller).toContain('file.reviewBaselineContent = file.content;');
    expect(controller).toContain('delete file.officeDraftBatchBaselineContent;');
    expect(controller).toContain('releaseServerVersion(file);');
    expect(controller).toContain('Only server-managed documents can be released.');

    expect(controller).toContain('function revertReviewChangeAtIndex');
    expect(controller).toContain("if ((change.officeDraftBatch || isOfficeDraftChange(change)) && typeof file.officeDraftBatchBaselineContent === 'string')");
    expect(controller).toContain("file.activities.unshift('Autosaved draft batch reverted.');");
    expect(controller).toContain("change.status = 'Reverted';");
    expect(controller).toContain('change.officeDraftBatch = false;');
    expect(controller).toContain('data-action="revert-review-change"');
    expect(controller).toContain('reviewChangeOperationForRender(change)');
    expect(css).toContain('.office-inline-actions--release-only .office-btn');
  });

  test('Lex app shell nests Documents under the Library sidebar section', () => {
    const appShell = fs.readFileSync(
      path.join(SRC, 'js', 'lex', 'components', 'layout', 'lex-app.js'),
      'utf8'
    );

    expect(appShell).toContain("{ id: 'library', label: 'Library'");
    expect(appShell).toContain("{ id: 'document-library', label: 'Documents'");
    expect(appShell).toContain("href: 'document-library.html'");
    expect(appShell).toContain("{ id: 'library-document-studio', label: 'Studio'");
    expect(appShell.indexOf("label: 'All Sources'")).toBeLessThan(appShell.indexOf("label: 'Documents'"));
    expect(appShell.indexOf("label: 'Documents'")).toBeLessThan(appShell.indexOf("label: 'Templates'"));
    expect(appShell.indexOf("label: 'Templates'")).toBeLessThan(appShell.indexOf("label: 'Studio'"));
    const sidebar = fs.readFileSync(
      path.join(SRC, 'js', 'lex', 'components', 'layout', 'lex-sidebar.js'),
      'utf8'
    );
    expect(sidebar).toContain('const hasActiveChild = item.children.some');
    expect(sidebar).toContain("if (activeChild) group.dataset.expanded = 'true';");
  });
});

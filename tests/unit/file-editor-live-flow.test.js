'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const html = fs.readFileSync(path.join(SRC, 'file-editor.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'css/file-editor.css'), 'utf8');
const editor = fs.readFileSync(path.join(SRC, 'js/file-editor.js'), 'utf8');
const viewer = fs.readFileSync(path.join(SRC, 'js/file-viewer-page.js'), 'utf8');
const createModal = fs.readFileSync(path.join(SRC, 'js/services/document-create-modal.js'), 'utf8');
const chatComposer = fs.readFileSync(path.join(SRC, 'js/lex/chat/lex-chat.composer.js'), 'utf8');

describe('File Editor live document boundary', () => {
  test('uses the original filename for visible editor titles while retaining the storage-safe name', () => {
    expect(editor).toContain('function documentDisplayFilename(file)');
    expect(editor).toContain('value.display_filename || value.original_filename');
    expect(editor).toContain('storageFilename: file.filename || displayFilename');
    expect(editor).toContain('title: displayFilename');
    expect(editor).toContain('filename: displayFilename');
  });

  test('mounts a document-scoped LANA dock for editor AI actions', () => {
    expect(html).toContain('<lex-lana-dock');
    expect(html).toContain('page-scope="file-editor"');
    expect(html).toContain('context-type="document_chat"');
    expect(html).toContain('default-tool="document_chat"');
    expect(editor).toContain('function officeConversationMatterId(file)');
    expect(editor).toContain('matterId: officeConversationMatterId(file) || null');
    expect(chatComposer).toContain("'tracked_change'");
    expect(chatComposer).toContain("moduleContext.type !== 'ui_card' && !documentContext");
  });

  test('enriches native editor AI context and stages document-edit suggestions for user approval', () => {
    const contextSource = editor.slice(
      editor.indexOf('function embedLanaFocusedContext(file, detail)'),
      editor.indexOf('async function mountLanaEditorForFile(file)')
    );

    expect(contextSource).toContain("? 'document_edit'");
    expect(contextSource).toContain("? 'editor_revision'");
    expect(contextSource).toContain("context.context_type = contextType");
    expect(contextSource).toContain('context.selection = {');
    expect(contextSource).toContain('text: String(context.text');
    expect(contextSource).toContain('context.edit_intent = Object.assign({}, detail.edit_intent)');
    expect(editor).toContain("['selection', 'revision', 'edit_intent', 'document_edit', 'editor_mode', 'document_mode']");
    expect(contextSource).toContain('return officeFileCardContext(file, context)');
    expect(contextSource).toContain('var blockPattern = /```(?:lana-document-edit|json)?');
    expect(contextSource).toContain('var toolCallPattern = /<tool_call>');
    expect(contextSource).toContain("parsed.name === 'document_edit_suggestion'");
    expect(contextSource).toContain("parsed.type !== 'document_edit_suggestion'");
    expect(contextSource).toContain('editor.stageSuggestedEdit({');
    expect(contextSource).toContain('strategy: pending.strategy || suggestion.strategy');
    expect(contextSource).toContain("detail.context.kind === 'selection'");
    expect(contextSource).toContain('cardContext: focusedContext');
    expect(editor).toContain("document.addEventListener('lex-lana-response-end'");
  });

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
    expect(editor).toContain('function officeHasUnreleasedChanges(file)');
    expect(editor).toContain('review.loadFailed || review.draftDetailFailed || review.restoreFailed');
    expect(editor).toContain("review.session.unreleasedRevisions(review.liveReviewState).length > 0");
    expect(editor).toContain('function officeHasReleaseComparison(file)');
    expect(editor).toContain("if (officeHasUnreleasedChanges(file)) return 'draft';");
    expect(editor).toContain("if (officeHasReleaseComparison(file)) return 'release';");
    expect(editor).toContain('Show or hide this release against the previous release');
    expect(editor).toContain("return 'Current release vs previous release'");
    expect(editor).toContain("return 'Unreleased vs last release'");
    expect(editor).toContain('id="officeChangesLegend"');
    expect(editor).toContain('data-action="locate-review-change"');
    expect(editor).toContain('function locateOfficeReviewChange(file, revisionIds)');
    expect(editor).toContain("mark.classList.toggle('lee-rev-review-focus', focused)");
    expect(editor).toContain("if (officeTrackedChangesMode(file) === 'none')");
    expect(editor).toContain('async function resolveOfficeConversationMatterContext(storageMatterId)');
    expect(editor).toContain('matterNumber: conversationMatter && conversationMatter.matterId');
    expect(editor).toContain('data-action="add-selection-comment"');
    expect(editor).toContain('data-action="ask-lana-selection"');
    expect(editor).toContain("contextToolbar.innerHTML = '<div class=\"office-doc-toolbar\"");
    expect(editor).toContain("'<div class=\"office-doc-ruler office-doc-ruler-' + marginPreset");
    expect(editor).not.toContain("panel.innerHTML = '<div class=\"office-doc-canvas\">' +\n      '<div class=\"office-doc-toolbar\"");
    expect(css).toContain('.office-lana-editor-host--final .le-page span.le-rev[data-rev-type="fmt"]');
    expect(css).toContain('.office-lana-editor-host--release-compare .le-page span.le-rev.lee-rev-baseline.lee-rev-release-delta[data-rev-type="fmt"]');
    expect(editor).toContain('function officeReleaseDeltaRevisionIds(file)');
    expect(editor).toContain("mark.classList.toggle('lee-rev-release-delta'");
    expect(css).toContain('.office-lana-editor-host--draft-compare .le-page .le-p:has(.le-rev:not(.lee-rev-baseline))');
    expect(css).toContain('.le-rev.lee-rev-review-focus[data-rev-type="fmt"]');
    expect(css).toContain('.office-changes-legend');

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

  test('renders semantic formatting revisions from the shared review datasource', () => {
    expect(editor).toContain('service.formatChangeDetailsFromRevision(item)');
    expect(editor).toContain('? service.changeLabel(item)');
    expect(editor).toContain('review.liveReviewState && (review.dirty || review.restored)');
  });

  test('binds undo and redo availability to the live Lana Editor history', () => {
    const historySource = editor.slice(
      editor.indexOf('function officeHistoryAvailability(file, editor)'),
      editor.indexOf('function renderDoc(file, panel)')
    );
    const mountSource = editor.slice(
      editor.indexOf('async function mountLanaEditorForFile(file)'),
      editor.indexOf('function nowIso()')
    );
    const actionSource = editor.slice(
      editor.indexOf('async function applyEmbedHistoryCommand(file, command)'),
      editor.indexOf('async function applyEmbedMarkCommand(file, mark, ranges)')
    );

    expect(editor).toContain('data-command="undo" data-format="undo" title="Undo" disabled aria-disabled="true"');
    expect(editor).toContain('data-command="redo" data-format="redo" title="Redo" disabled aria-disabled="true"');
    expect(historySource).toContain("undo: available('canUndo', 'undo')");
    expect(historySource).toContain("redo: available('canRedo', 'redo')");
    expect(historySource).toContain('button.disabled = !enabled');
    expect(historySource).toContain("button.setAttribute('aria-disabled', enabled ? 'false' : 'true')");
    expect(historySource).toContain("activeEditor.editorMode() === 'review'");
    expect(historySource).toContain('officeEditorHostEl !== currentHost');
    expect(historySource).not.toContain('prototype');
    expect(historySource).not.toContain('historyCount');

    ['document-loaded', 'change-applied', 'change-decision', 'review-state-changed'].forEach((event) => {
      expect(mountSource).toContain("mountedEditor.on('" + event + "'");
    });
    expect(mountSource).toContain('await activeEditor.open_file(input);');
    expect(mountSource).toContain('syncOfficeHistoryControls(file, activeEditor);');
    expect(mountSource).toContain("activeEditor.setMode('review');");
    expect(editor).toContain("if (typeof editor.clearHistory === 'function') editor.clearHistory();");
    expect(actionSource).toContain('var changed = await officeEditorInstance[command]();');
    expect(actionSource).toContain('finally {\n      syncOfficeHistoryControls(file, officeEditorInstance);');
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
    expect(editor).toContain('replayIndex < scripts.length');
    expect(editor).toContain('await editor.applyEditScripts([scripts[replayIndex]])');
    expect(editor).not.toContain('await editor.applyEditScripts(scripts)');
    expect(editor).toContain('Release pending approval. Editing continues in a new draft; only another release request is unavailable until this approval is resolved.');
    expect(reviewRailSource).not.toContain('class="file-editor-pending-approval"');
    expect(reviewRailSource).not.toContain('data-action="show-review-details"');
    expect(reviewRailSource).toContain('!serverState.pendingReleaseBatch');
    expect(reviewRailSource).toContain("releaseButton.dataset.action = hasPendingApproval ? pendingApprovalAction : 'release-review-version'");
    expect(reviewRailSource).toContain('hasPendingApproval || canReleaseVersion');
    expect(reviewRailSource).toContain('pendingApprovalLabel');
    expect(editor).toContain("return pendingReleaseNeedsApprovalRestart(review) ? 'retry-release-approval' : 'view-release-approval'");
    expect(editor).toContain("payload: { retry_approval: true }");
    expect(editor).toContain("toast('Release approval restarted.')");
    expect(editor).toContain("isDeletion: service.isDeletionChange(change)");
    expect(editor).toContain("isInsertion: service.isInsertionChange(change)");
    expect(reviewRailSource).toContain("change.isDeletion ? '' : '<span class=\"office-review-diff-add\"");
    expect(editor).toContain("Lex.Nav.go('approval-detail.html', { params: { id: approvalReview.pendingApprovalId } })");
    expect(editor).toContain("Lex.Nav.go('approvals.html', { params: { status: 'pending' } })");
    expect(commentButtonAt).toBeGreaterThan(-1);
    expect(commentButtonSource).not.toContain('pendingReleaseBatch');
    expect(commentButtonSource).not.toContain('disabled');
    expect(saveButton).not.toContain('disabled');
    expect(editor).toContain("if (action === 'save' && file)");
    expect(editor).toContain('await saveServerDraft(file, { silent: true })');
  });

  test('streams live review state into distinct new-draft and pending-approval history groups', () => {
    const mountSource = editor.slice(
      editor.indexOf('async function mountLanaEditorForFile(file)'),
      editor.indexOf('function nowIso()')
    );
    const applySource = editor.slice(
      editor.indexOf('function applyServerReviewToFile(file)'),
      editor.indexOf('function scheduleServerDraftSave(file)')
    );
    const railSource = editor.slice(
      editor.indexOf('function renderDocReviewRail(file)'),
      editor.indexOf('function createFile(kind)')
    );

    expect(mountSource).toContain("mountedEditor.on('review-state-changed', function (reviewState)");
    expect(mountSource).toContain('handleServerEmbedEvent(file, reviewState || null)');
    expect(mountSource).toContain('applyServerReviewToFile(file);\n        // Release lineage arrives after the first document render.');
    expect(mountSource).toContain('applyOfficeBaselineRevisionTags(file);\n        syncOfficeShowChangesControl(file);');
    expect(editor).toContain('function serverPendingApprovalDisplayChanges(file)');
    expect(applySource).toContain("{ section: 'unreleased' }");
    expect(applySource).toContain("{ section: 'pending-approval' }");
    expect(applySource).toContain("row.status = 'Pending'");
    expect(applySource).toContain("row.status = 'Pending approval'");
    expect(applySource).toContain("var editorBaselineReleaseId = String(file.editorBaselineReleaseId || '')");
    expect(applySource).toContain('group.release.id');
    expect(applySource).toContain('pendingRows.concat(pendingApprovalRows, releasedRows)');
    expect(railSource).toContain("change.serverSection === 'pending-approval'");
    expect(railSource).toContain("change.serverSection !== 'pending-approval'");
    expect(railSource).toContain("hasPendingApproval ? 'New draft' : 'Unreleased'");
    expect(railSource).toContain('<h5>Pending approval</h5>');
    expect(railSource).toContain('unreleasedHtml + pendingApprovalHtml + releasedChangesHistoryHtml + releasedHistoryHtml');
  });

  test('persists threaded review comments with reply and resolve lifecycle controls', () => {
    const commentSource = editor.slice(
      editor.indexOf('function serverReviewComments(file)'),
      editor.indexOf('function serverReviewRowAtIndex(file, index)')
    );
    const railSource = editor.slice(
      editor.indexOf('function renderDocReviewRail(file)'),
      editor.indexOf('function createFile(kind)')
    );
    const actionSource = editor.slice(
      editor.indexOf("if (action === 'dock-comment')"),
      editor.indexOf("if (action === 'release-review-version'", editor.indexOf("if (action === 'dock-comment')"))
    );

    expect(editor).toContain('function normalizeServerReviewThread(comment)');
    expect(editor).toContain('function normalizeServerReviewReply(reply, threadId)');
    expect(editor).toContain('function promptReplyServerReviewComment(file, commentId)');
    expect(editor).toContain('function setServerReviewCommentResolved(file, commentId, resolved)');
    expect(editor).toContain('function selectedServerReviewText()');
    expect(editor).toContain("scope: anchorText ? 'selection' : 'document'");
    expect(editor).toContain('anchor_text: anchorText');
    expect(editor).toContain("var packetActions = packet");
    expect(editor).toContain('data-action="new-signature-packet">Prepare another packet');
    expect(editor).toContain("var permissions = collaborator.permission");
    expect(editor).toContain("was granted ' + permission + ' access");
    expect(editor).toContain('comments: review.comments');
    expect(commentSource).toContain('review.comments.map(normalizeServerReviewThread)');
    expect(commentSource).toContain("scope: anchorText ? 'selection' : 'document'");
    expect(commentSource).toContain("status: 'open'");
    expect(commentSource).toContain('thread.replies.push(normalizeServerReviewReply');
    expect(commentSource).toContain("thread.status = resolved ? 'resolved' : 'open'");
    expect(commentSource).toContain('thread.resolved_at = resolved ? timestamp : null');
    expect(railSource).toContain('data-comment-thread-id=');
    expect(railSource).toContain('office-review-comment-meta');
    expect(railSource).toContain('office-review-comment-scope');
    expect(railSource).toContain('data-action="reply-review-comment"');
    expect(railSource).toContain("status === 'Resolved' ? 'reopen-review-comment' : 'resolve-review-comment'");
    expect(actionSource).toContain("action === 'reply-review-comment'");
    expect(actionSource).toContain("action === 'resolve-review-comment' || action === 'reopen-review-comment'");
    expect(css).toContain('.office-review-comment-replies');
    expect(css).toContain('.office-review-comment-actions');
  });

  test('shares with people or workspaces and confirms access removal', () => {
    const sharingSource = editor.slice(
      editor.indexOf('async function addCollaboratorFromQuery(file, query, permissions)'),
      editor.indexOf('async function sendSignaturePacket(file)')
    );

    expect(sharingSource).toContain('async function addWorkspaceCollaborator(file, workspaceId, permissions)');
    expect(sharingSource).toContain("target_type: 'workspace'");
    expect(sharingSource).toContain('workspace_id: id');
    expect(sharingSource).toContain('async function loadShareWorkspaceOptions(file)');
    expect(sharingSource).toContain('window.api.getMatters(1, 250');
    expect(sharingSource).toContain('id="officeShareTargetType"');
    expect(sharingSource).toContain('<option value="user">Person</option><option value="workspace">Workspace</option>');
    expect(sharingSource).toContain('id="officeShareWorkspace"');
    expect(sharingSource).toContain('function confirmRemoveCollaborator(file, collaboratorId)');
    expect(sharingSource).toContain("heading: 'Remove Document Access'");
    expect(sharingSource).toContain("confirmText: 'Remove access'");
    expect(sharingSource).toContain("cancelText: 'Keep access'");
    expect(editor).toContain('confirmRemoveCollaborator(file, actionTarget.dataset.collaboratorId)');
    expect(editor).toContain("collaborator.target_type === 'workspace' ? 'Workspace' : 'Person'");
  });

  test('registers one SPA initializer with explicit leave cleanup', () => {
    expect(editor).toContain("LexRouter.registerPageInit('file-editor.html', init);");
    expect(editor).toContain('LexRouter.registerView({ onLeave: onLeave })');
    expect(editor).toContain('save.finally(function () { shutdownEditorInstance(departingEditor); })');
    expect(editor).toContain("} else {\n    init();\n  }");
  });
});

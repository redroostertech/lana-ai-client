'use strict';

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '../../src/file-viewer.html'),
  'utf8'
);
const pageJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/file-viewer-page.js'),
  'utf8'
);
const serviceJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/services/document-review-api.service.js'),
  'utf8'
);
const drawerJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/lex/components/foundation/lex-drawer.js'),
  'utf8'
);
const fileViewerCss = fs.readFileSync(
  path.join(__dirname, '../../src/css/file-viewer.css'),
  'utf8'
);
const askLanaButtonJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/lex/components/chat/lex-ask-lana-btn.js'),
  'utf8'
);

describe('file-viewer review UX foundation', () => {
  test('uses the original filename for the banner, breadcrumb, page title, and editor handoff', () => {
    expect(pageJs).toContain('function documentDisplayFilename(file)');
    expect(pageJs).toContain('value.display_filename || value.original_filename');
    expect(pageJs).toContain("banner.setAttribute('heading', displayFilename)");
    expect(pageJs).toContain("document.title = displayFilename + ' - LANA AI'");
    expect(pageJs).toContain('label: documentDisplayFilename(file)');
    expect(pageJs).toContain('storageFilename: file && file.filename');
  });

  test('keeps file info behind explicit drawer actions', () => {
    expect(html).toContain('id="viewerFileInfoBtn"');
    expect(html).toContain('View File Info');
    expect(html).not.toContain('id="reviewRailInfoBtn"');
    expect(html).toContain('<lex-drawer id="fileInfoDrawer"');
    expect(html).toContain('id="metadataSidebar" class="file-viewer-file-info"');
    expect(pageJs).toContain('drawer.subtitle = documentDisplayFilename(state.currentFile);');
    expect(pageJs).toContain('downloadFile(state.currentFile.id, documentDisplayFilename(state.currentFile));');
  });

  test('routes the viewer header LANA button to its explicit document drawer before the shell dock', () => {
    expect(html).toContain('<lex-ask-lana-btn id="askLanaBtn" panel="fileViewerLana"');
    const explicitPanelBranch = askLanaButtonJs.indexOf("if (this.panel && this._panelEl && typeof this._panelEl.toggle === 'function')");
    const shellDockBranch = askLanaButtonJs.indexOf("var dock = document.querySelector('lex-lana-dock')");
    expect(explicitPanelBranch).toBeGreaterThan(-1);
    expect(shellDockBranch).toBeGreaterThan(explicitPanelBranch);
    expect(pageJs).toContain("var askLanaBtn = banner && banner.querySelector('#askLanaBtn');");
  });

  test('renders a review rail with change history and releases tabs', () => {
    expect(html).toContain('id="reviewRail"');
    expect(html).toContain('class="file-viewer-review-title"');
    expect(html).toContain('<lex-segmented');
    expect(html).toContain('id="reviewTabs"');
    expect(html).toContain('"value":"changes"');
    expect(html).toContain('"label":"Change History"');
    expect(html).toContain('"value":"releases"');
    expect(html).toContain('"label":"Versions"');
    expect(html).not.toContain('"label":"Releases"');
    expect(html).toContain('id="reviewPanelReleases"');
    expect(html).not.toContain('id="reviewPanelComments"');
    expect(fileViewerCss).toContain('.file-viewer-review-header');
    expect(fileViewerCss).toContain('border-radius: var(--lex-radius-md, 8px) var(--lex-radius-md, 8px) 0 0');
    expect(fileViewerCss).toContain('background: var(--lex-bg-primary)');
  });

  test('places metadata actions in the drawer footer slot', () => {
    expect(html).toContain('id="metaActionsFooter" data-slot="footer"');
    expect(html).toContain('id="metaCancelBtn"');
    expect(html).toContain('id="metaSaveBtn"');
    expect(pageJs).toContain("closest('.lex-drawer-footer')");
    expect(pageJs).toContain("footerShell.classList.add('hidden')");
    expect(drawerJs).toContain('.lex-drawer-footer.hidden');
  });

  test('lets AI Summary fill the file info drawer height', () => {
    expect(html).toContain('id="metaSummarySection" class="file-viewer-file-info__summary hidden"');
    expect(html).toContain('id="metaSummaryView" class="file-viewer-file-info__summary-text');
    expect(html).not.toContain('max-height: 20rem');
    expect(fileViewerCss).toContain('#fileInfoDrawer .lex-drawer-body');
    expect(fileViewerCss).toContain('.file-viewer-file-info__summary:not(.hidden)');
    expect(fileViewerCss).toContain('flex: 1 1 12rem');
    expect(fileViewerCss).toContain('.file-viewer-file-info__summary-text');
    expect(fileViewerCss).toContain('overflow-y: auto');
  });

  test('makes read-only canvas mode explicit without freeform edit language', () => {
    expect(html).toContain('View / Read-only');
    expect(html).toContain('Open in File Editor');
    expect(pageJs).toContain("reviewBadge.textContent = 'Open in File Editor';");
    expect(pageJs).toContain('setCanvasModeDisplay(canOpenFileInEditor(state.currentFile));');
    expect(html).not.toContain('Freeform Edit');
  });

  test('opens File Editor through delegated banner clicks because lex-banner clones slot content', () => {
    expect(pageJs).toContain("node.id === 'viewerReviewModeBadge'");
    expect(pageJs).toContain("case 'viewerReviewModeBadge':");
    expect(pageJs).toContain('function openCurrentFileInFileEditor');
    expect(pageJs).toContain("Lex.Nav.go('file-editor.html'");
    expect(pageJs).toContain('fileEditor: fileEditorHandoff(file)');
    expect(pageJs).toContain('async function openCurrentFileInFileEditor()');
    expect(pageJs).toContain('if (state.reviewWorkflowPromise)');
    expect(pageJs).toContain('await state.reviewWorkflowPromise;');
    expect(pageJs).toContain('function visibleViewerDocumentHtml');
    expect(pageJs).toContain('function fileEditorReviewChanges');
    expect(pageJs).toContain('reviewChanges: fileEditorReviewChanges()');
    expect(pageJs).toContain('versions: fileEditorVersions(file)');
    expect(pageJs).toContain("editorMode: fileEditorKindForFile(file) === 'doc' ? 'review' : 'edit'");
    expect(pageJs).not.toContain('preferDraftShell: true');
    expect(pageJs).toContain("matterId: getCurrentMatterId() || ''");
    expect(pageJs).toContain("matterNumber: getConversationMatterId(file) || ''");
    expect(pageJs).toContain('LanaDocumentReview.latestActivityIso(file, draftBatch)');
    expect(pageJs).not.toContain("reviewModeBtn.addEventListener('click'");
  });

  test('repositions the review segmented control after the hidden rail becomes visible', () => {
    expect(pageJs).toContain('tabs.value = state.reviewTab');
    expect(pageJs).toContain('tabs._positionIndicator()');
  });

  test('wires viewer releases to backend edit-batch endpoints without viewer-side draft editing', () => {
    expect(html).not.toContain('id="reviewSaveDraftBtn"');
    expect(html).not.toContain('Save Draft');
    expect(html).toContain('id="reviewReleaseBtn"');
    expect(html).toContain('id="reviewReleasesList"');
    expect(pageJs).toContain('async function saveReviewBatch');
    expect(pageJs).toContain('async function releaseReviewVersion');
    expect(pageJs).toContain('function nextReleaseNumber');
    expect(pageJs).toContain('function releaseConfirmationMessage');
    expect(pageJs).toContain('function releaseConfirmationDetails');
    expect(pageJs).toContain('function releaseConfirmationContent');
    expect(pageJs).toContain('file-viewer-release-confirm__grid');
    expect(pageJs).toContain("confirmText: 'Release Version'");
    expect(pageJs).toContain('async function selectReleaseForComparison');
    expect(pageJs).toContain('function clearReleaseComparison');
    expect(pageJs).toContain("status === 'draft' || status === 'proposed'");
    expect(pageJs).toContain('function restorePersistedDraftIntoEditor');
    expect(pageJs).toContain('function persistableReviewChange');
    expect(pageJs).toContain('function persistableReviewChanges');
    expect(pageJs).toContain('editOpsFromPersistedBatch');
    expect(pageJs).toContain('editScriptsFromPersistedBatch');
    expect(pageJs).toContain('function applyPersistedEditScriptsSequentially');
    expect(pageJs).toContain('state.editorInstance.applyEditScripts');
    expect(pageJs).toContain('await state.editorInstance.applyEditScripts(scripts)');
    expect(pageJs).toContain('state.currentReviewBatchRestoreFailed');
    expect(pageJs).toContain('Saved draft details could not be loaded.');
    expect(pageJs).toContain('function currentReviewBatchDisplayChanges');
    expect(pageJs).toContain('function activeDraftBatchForCurrentFile');
    expect(pageJs).toContain('String(batches[i].base_file_version_id || \'\') === baseFileVersionId');
    expect(pageJs).toContain('var reviewDocumentId = String(file.id);');
    expect(pageJs).toContain('var reviewDocumentId = String(state.currentFile.id);');
    expect(pageJs).toContain('reviewBaselineRevisionKeyCounts');
    expect(pageJs).toContain('function captureReviewBaselineRevisions');
    expect(pageJs).toContain('reviewBaselineRevisionIds');
    expect(pageJs).toContain('function acceptBaselineRevisionsForReviewMode');
    expect(pageJs).toContain('decisions: ids.map(function (id)');
    expect(pageJs).toContain('function unreleasedRawReviewRevisions');
    expect(pageJs).toContain('var revisions = unreleasedRawReviewRevisions(reviewState);');
    expect(pageJs).toContain('captureReviewBaselineRevisions(state.reviewState)');
    expect(pageJs).toContain('resetReviewBaselineRevisions()');
    expect(pageJs).toContain('function dedupeEditOps');
    expect(pageJs).toContain('LanaDocumentReview.editScriptsFromBatch(batch)');
    expect(pageJs).toContain('LanaDocumentReview.editOpsFromBatch(batch)');
    expect(pageJs).toContain('state.reviewRestoring = true');
    expect(pageJs).toContain("var nextMode = 'view';");
    expect(pageJs).not.toContain('Saved draft must be replayed into the document before release.');
    expect(pageJs).toContain('LanaDocumentReview.changesFromRevisions(unreleasedRawReviewRevisions(reviewState))');
    expect(pageJs).toContain('LanaDocumentReview.persistableReviewChange(change, index)');
    expect(pageJs).toContain("'/edit-batches'");
    expect(pageJs).toContain("'/release'");
    expect(pageJs).toContain('approved: false');
    expect(pageJs).toContain("'/compare'");
    expect(pageJs).toContain('content_base64');
    expect(pageJs).toContain('function hasDocxZipEnvelope');
    expect(pageJs).toContain('function assertReleaseBytesMatchFormat');
    expect(pageJs).toContain('function acceptedReleaseBytesForEditor');
    expect(pageJs).toContain("'/v1/redline/decisions'");
    expect(pageJs).toContain("mode: 'accept_all'");
    expect(pageJs).toContain('var releaseBytes = await acceptedReleaseBytesForEditor(state.currentFile, bytes);');
    expect(pageJs).toContain('The editor did not return a valid Word document package');
    expect(pageJs).toContain('loadReviewWorkflow(file)');
    expect(pageJs).toContain("tab === 'releases'");
    expect(pageJs).toContain('Released in Version');
    expect(pageJs).toContain('data-review-release-compare-index');
    expect(pageJs).toContain('data-review-release-original');
    expect(pageJs).toContain('function selectOriginalForComparison');
    expect(pageJs).toContain('function compareCurrentDocumentAgainst');
    expect(pageJs).toContain('function openVersionDocument');
    expect(pageJs).toContain("version_view: '1'");
    expect(pageJs).toContain('data-review-version-compare-toggle');
    expect(pageJs).toContain('Compare Versions');
    expect(pageJs).toContain('data-review-version-open-index');
    expect(pageJs).toContain('data-review-version-open-original');
    expect(pageJs).toContain('function selectVersionForCompare');
    expect(pageJs).toContain('function runVersionComparison');
    expect(pageJs).toContain('function versionCompareSelectionClass');
    expect(pageJs).toContain('file-viewer-review-release--base');
    expect(pageJs).toContain('file-viewer-review-release--comparison');
    expect(pageJs).toContain('function openLatestReleasedDocumentIfAvailable');
    expect(pageJs).toContain('function hasUnreleasedWorkingCopy');
    expect(pageJs).toContain('if (state.currentReviewBatchRestoreFailed) return false;');
    expect(pageJs).toContain('function shouldHonorExplicitVersionView');
    expect(pageJs).toContain('currentFileId === String(originalId)');
    expect(pageJs).toContain('function selectInitialReviewDisplay');
    expect(pageJs).toContain('function restorePersistedDraftIntoEditorWithRetry');
    expect(pageJs).toContain('function currentDraftBaseDocumentId');
    expect(pageJs).toContain('LanaDocumentReview.draftBaseDocumentId(');
    expect(pageJs).toContain('function hydrateCurrentReviewBatchDetail');
    expect(pageJs).toContain('await hydrateCurrentReviewBatchDetail();');
    expect(pageJs).toContain('function waitForReviewRestoreRetry');
    expect(pageJs).toContain('function restoredDraftHasVisibleRevisions');
    expect(pageJs).toContain('state.currentReviewBatchRestoreFailed = false;');
    expect(pageJs).toContain('var attempts = 4;');
    // File Viewer stays read-only, but Current draft must replay the persisted
    // edit scripts into its in-memory editor so the canvas matches the Review
    // rail. This does not save or mutate the source document.
    expect(pageJs).toContain('await restoreCurrentPersistedDraftIfNeeded()');
    expect(pageJs).toContain('state.currentReviewBatchRestoreFailed = true;');
    expect(pageJs).not.toContain('await restorePersistedDraftIntoEditorWithRetry(state.currentReviewBatch)');
    expect(pageJs).toContain("if (hasUnreleasedWorkingCopy())");
    expect(pageJs).toContain("selectReviewDisplayScope('current')");
    expect(pageJs).toContain('selectInitialReviewDisplay(file)');
    expect(pageJs).toContain('state.reviewSourceDocumentId');
    // The localStorage office-release bridge is retired: releases come only
    // from the server, and stale bridge data is purged so fabricated local
    // releases can never surface in the viewer.
    expect(pageJs).toContain("localStorage.removeItem('lana:file-viewer:office-releases')");
    expect(pageJs).not.toContain('loadOfficeEditorReleaseBridge');
    expect(pageJs).not.toContain('mergeOfficeEditorReleases');
    expect(pageJs).not.toContain('isLocalOfficeEditorRelease');
    expect(pageJs).not.toContain('local_office_release');
    expect(pageJs).not.toContain('renderLocalOfficeRelease');
    expect(html).toContain('id="viewerDocumentCard"');
    expect(html).toContain('id="viewerDisplayControls"');
    expect(html).toContain('id="viewerChangeDisplayToggle"');
    expect(html).toContain('id="viewerVersionSelect"');
    expect(html).toContain('visible-limit="11"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Show changes');
    expect(pageJs).toContain('showTrackedChanges');
    expect(pageJs).toContain('function applyTrackedChangesDisplay');
    expect(pageJs).toContain('function setTrackedChangesDisplay');
    expect(pageJs).toContain('function showSelectedReleaseChangesFromParent');
    expect(pageJs).toContain('function releaseVersionLabel');
    expect(pageJs).toContain('function parentVersionLabelForRelease');
    expect(pageJs).toContain("base: parentVersionLabelForRelease(release, baseDocumentId)");
    expect(pageJs).toContain("comparison: releaseVersionLabel(release)");
    expect(pageJs).toContain("context: documentDisplayFilename(state.currentFile)");
    expect(pageJs).toContain('setViewerDisplayControlsVisible(Boolean(state.editorInstance));');
    expect(pageJs).toContain('function fallbackReviewChangesForDiff');
    expect(pageJs).toContain('function proposedTextForBlankAddedDiffPart');
    expect(pageJs).toContain('function renderDiffComparisonBody');
    expect(pageJs).toContain('function formattingReviewChangesForDiff');
    expect(pageJs).toContain('function renderFormattingComparison');
    expect(pageJs).toContain("var original = String(changeOriginalText(change) || '');");
    expect(pageJs).toContain("var proposed = String(changeProposedText(change) || '');");
    expect(pageJs).toContain('LanaDocumentReview.changesFromRevisions(');
    expect(pageJs).toContain('return LanaDocumentReview.changeLabel(item);');
    expect(pageJs).toContain('No textual or formatting differences detected.');
    expect(fileViewerCss).toContain('.file-viewer-format-diff__change');
    expect(pageJs).toContain('var previousRemovedText');
    expect(pageJs).toContain("if (!normalizedDiffText(text) && kind !== 'unchanged') return '';");
    expect(pageJs).toContain('parentDocumentIdForRelease');
    expect(pageJs).toContain('LanaDocumentReview.previousReleaseDocumentId(');
    expect(pageJs).toContain('function isDirectForwardVersionComparison');
    expect(pageJs).toContain('Direct formatting comparison is unavailable for non-adjacent or reverse version selections.');
    expect(pageJs).toContain('Persisted formatting change details could not be loaded for this version.');
    expect(pageJs).toContain('Persisted change details are unavailable for this version.');
    expect(fileViewerCss).toContain('.file-viewer-diff-warning');
    expect(fileViewerCss).toContain('.file-viewer-diff-context');
    expect(pageJs).toContain('function reviewVersionSelectOptions');
    expect(pageJs).toContain('function currentReviewVersionSelectValue');
    expect(pageJs).toContain('function openReviewVersionFromSelect');
    expect(pageJs).toContain('function hasCurrentDraftReviewChanges');
    expect(pageJs).toContain("value: 'original'");
    expect(pageJs).toContain("value: 'current'");
    expect(pageJs).toContain("label: 'Current draft'");
    expect(pageJs).toContain("group: 'Document'");
    expect(pageJs).toContain("group: 'Working copy'");
    expect(pageJs).toContain("group: 'Versions'");
    expect(pageJs).toContain("description: hasCurrentDraftReviewChanges() ? 'Live unreleased edits' : 'Current document view'");
    expect(pageJs).toContain("if (state.reviewDisplayTarget === 'original') return 'original';");
    expect(pageJs).toContain("if (hasCurrentDraftReviewChanges()) return 'current';");
    expect(pageJs).toContain('function selectReviewDisplayScope');
    expect(pageJs).toContain("state.showTrackedChanges = false;");
    expect(pageJs).toContain("state.showTrackedChanges = true;");
    expect(pageJs).toContain("toggle.disabled = isOriginal;");
    expect(pageJs).toContain('Original has no tracked changes to display.');
    expect(pageJs).toContain("openReviewVersionFromSelect('original')");
    expect(pageJs).toContain("if (state.editorInstance)");
    expect(pageJs).toContain("host.classList.toggle('file-viewer-editor-host--original', isOriginalScope);");
    expect(pageJs).toContain('openReviewVersionFromSelect(reviewVersionSelectValueForRelease(versionRelease))');
    // The unreleased working copy is lineage-level and stays visible in every
    // version scope, so the change history must not gate it on 'current'.
    expect(pageJs).toContain('var unreleasedChanges = editorChanges.length ? editorChanges : draftBatchChanges;');
    expect(pageJs).not.toContain("var unreleasedChanges = reviewDisplayScope() === 'current'");
    expect(pageJs).toContain("if (value === 'current')");
    expect(pageJs).toContain("value.indexOf('release:')");
    expect(pageJs).toContain('Current view');
    expect(pageJs).toContain('selectedReviewReleaseId');
    expect(pageJs).toContain("setReviewTab('releases')");
    expect(pageJs).toContain('showLoading()');
    expect(pageJs).toContain('Unreleased');
    expect(pageJs).toContain("title: 'Version '");
    expect(pageJs).toContain('renderReviewChangeDiff');
    expect(pageJs).toContain('function displayReviewChanges');
    expect(pageJs).toContain('function reviewChangeLanaContext');
    expect(pageJs).toContain('function reviewChangeLanaSummary');
    expect(pageJs).toContain('function renderReviewChangeLanaButton');
    expect(pageJs).toContain("if (!change) return '';");
    expect(pageJs).not.toContain("if (!options.unreleased || !change) return '';");
    expect(pageJs).toContain("type: 'tracked_change'");
    expect(pageJs).toContain("context_type: 'tracked_change'");
    expect(pageJs).toContain('summary: summary');
    expect(pageJs).toContain('revision: {');
    expect(pageJs).toContain('details: {');
    expect(pageJs).toContain('change_summary: summary');
    expect(pageJs).toContain("source: 'file_viewer_review_rail'");
    expect(pageJs).toContain('data-lana-dock-trigger');
    expect(pageJs).toContain('data-lana-context-type="document_chat"');
    expect(pageJs).not.toContain('data-lana-initial-prompt');
    expect(pageJs).toContain('Review whether this tracked change is well-grounded');
    expect(pageJs).toContain('Talk about this.');
    expect(pageJs).toContain("event.target.closest ? event.target.closest('[data-lana-dock-trigger]')");
    // Grouping and identity are shared with File Editor through the
    // LanaDocumentReview module; the viewer only delegates.
    expect(pageJs).toContain('function reviewChangeIdentityKey');
    expect(pageJs).toContain('LanaDocumentReview.displayReviewChanges(changes)');
    expect(serviceJs).toContain('function adjacentDeletionFragmentRun');
    expect(serviceJs).toContain('function sameReviewChangeMoment');
    expect(serviceJs).toContain('function editScriptGroupIdForChange');
    expect(serviceJs).toContain('function adjacentIdentityRun');
    expect(serviceJs).toContain('function mergeReviewChangeRun');
    expect(serviceJs).toContain('mergedScript.group_id');
    expect(serviceJs).toContain('if (isDeletionChange(current) && isInsertionChange(next) && sameReviewChangeMoment(current, next))');
    expect(pageJs).not.toContain('var author = metadata.author || change.author');
    expect(pageJs).toContain('function revertReviewHistoryChange');
    expect(pageJs).toContain('function confirmReviewHistoryChangeRevert');
    expect(pageJs).toContain('function reviewRevertConfirmationContent');
    expect(pageJs).toContain('function revertUnreleasedReviewChange');
    expect(pageJs).toContain('function revertReleasedReviewChange');
    expect(pageJs).toContain('function firstEditableDraftOpForChange');
    expect(pageJs).toContain('function liveRevisionChangesForReviewChange');
    expect(pageJs).toContain('function editableOpsForReviewChange');
    expect(pageJs).toContain('function isReplacementReviewChange');
    expect(pageJs).toContain('function canEditDraftReviewChange');
    expect(pageJs).toContain('function ensureDraftReviewChangeCanBeEdited');
    expect(serviceJs).toContain("if (op.op === 'insertText' && op.at)");
    expect(serviceJs).toContain("preferredOps = ['insertText', 'insertBlocks']");
    expect(pageJs).not.toContain('Insertion-only changes cannot be edited in place yet.');
    expect(pageJs).not.toContain('if (!isReplacementReviewChange(change)) return false;');
    expect(pageJs).toContain('function confirmReviewHistoryChangeEdit');
    expect(pageJs).toContain('function editUnreleasedReviewChange');
    expect(pageJs).not.toContain('data-review-change-edit-index');
    expect(pageJs).toContain('Edit Draft Change');
    expect(pageJs).toContain('Update Change');
    expect(pageJs).toContain('Draft change updated');
    expect(pageJs).not.toContain('data-review-change-revert-index');
    expect(pageJs).not.toContain('var revertButton = options.unreleased');
    expect(pageJs).toContain("action: 'reject'");
    expect(pageJs).toContain('state.editorInstance.decide');
    expect(pageJs).toContain('state.editorInstance.applyEdits([op])');
    expect(pageJs).toContain('inverseEditOpsForReleasedChange');
    expect(pageJs).toContain('allowEmpty');
    expect(pageJs).toContain('var reviewState = currentReviewState();');
    expect(pageJs).toContain('if (revisions.length)');
    expect(pageJs).toContain('confirmReviewHistoryChangeRevert(');
    expect(pageJs).not.toContain('Release approval pending for ');
    expect(pageJs).toContain('data-review-history-filter="user"');
    expect(pageJs).toContain("label: 'Pending'");
    expect(html).toContain('id="viewerDiff"');
    expect(fileViewerCss).toContain('.file-viewer-review-item-version');
    expect(fileViewerCss).toContain('.file-viewer-review-status--pending');
    expect(fileViewerCss).toContain('.file-viewer-review-history-header::after');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__diff-line--added');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__diff-line--removed');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__action');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__edit');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__revert');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__lana');
    expect(fileViewerCss).toContain('max-height: 42px');
    expect(fileViewerCss).toContain('pointer-events: auto');
    expect(fileViewerCss).not.toContain('.file-viewer-review-history-row:hover .file-viewer-review-history-row__lana');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row::before');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row:first-child');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row:last-child');
    expect(fileViewerCss).toContain('linear-gradient(135deg, #1e1b4b 0%, #4338ca 40%, #7c3aed 70%, #c026d3 100%)');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__lana-button .lex-card-lana-icon');
    expect(fileViewerCss).toContain('border-radius: 9999px');
    expect(fileViewerCss).toContain('background-size: 200% 200%');
    expect(fileViewerCss).toContain('.file-viewer-edit-change-modal');
    expect(fileViewerCss).toContain('.file-viewer-edit-change-modal__textarea');
    expect(fileViewerCss).toContain('.file-viewer-review-workflow');
    expect(fileViewerCss).toContain('.file-viewer-review-release');
    expect(fileViewerCss).toContain('.file-viewer-review-release--selected');
    expect(fileViewerCss).toContain('.file-viewer-review-compare-toggle');
    expect(fileViewerCss).toContain('.file-viewer-review-compare-toggle__radio');
    expect(fileViewerCss).toContain('.file-viewer-review-release--base');
    expect(fileViewerCss).toContain('.file-viewer-review-release--comparison');
    expect(fileViewerCss).toContain('.file-viewer-review-release__role--base');
    expect(fileViewerCss).toContain('.file-viewer-review-release__role--comparison');
    expect(fileViewerCss).toContain('.file-viewer-display-controls');
    expect(fileViewerCss).toContain('.file-viewer-version-select');
    expect(fileViewerCss).toContain('.file-viewer-editor-host.file-viewer-editor-host--final .le-page del');
    expect(fileViewerCss).toContain('.file-viewer-editor-host.file-viewer-editor-host--final .le-page ins');
    expect(fileViewerCss).toContain('.file-viewer-editor-host.file-viewer-editor-host--original .le-page ins');
    expect(fileViewerCss).toContain('.file-viewer-editor-host.file-viewer-editor-host--original .le-page del');
    expect(fileViewerCss).toContain('.file-viewer-release-confirm__hero');
    expect(fileViewerCss).toContain('.file-viewer-release-confirm__note strong');
    expect(fileViewerCss).toContain('.file-viewer-revert-confirm');
    expect(fileViewerCss).toContain('.file-viewer-revert-confirm__preview');
    expect(fileViewerCss).toContain('button.file-viewer-review-release');
    expect(fileViewerCss).toContain('.file-viewer-diff-viewer');
    expect(fileViewerCss).toContain('box-decoration-break: clone');
    expect(fileViewerCss).toContain('margin: 0 2px');
  });

  test('exposes explicit format support paths for PDF, DOCX, TXT, and Markdown', () => {
    expect(html).toContain('id="viewerFormatNotice"');
    expect(pageJs).toContain('function detectViewerFormat');
    expect(pageJs).toContain('function loadFormatCapabilities');
    expect(pageJs).toContain("'/format-capabilities'");
    expect(pageJs).toContain('function canReviewFile');
    expect(pageJs).toContain('function releaseContentType');
    expect(pageJs).toContain("return 'text/markdown'");
    expect(pageJs).toContain("return 'text/plain'");
    expect(pageJs).toContain('PDF opens read-only');
    expect(pageJs).toContain('Convert this PDF to DOCX before making review edits');
    expect(pageJs).toContain('conversion.available !== true');
    expect(pageJs).toContain('DOCX conversion will appear when the server reports conversion support');
    expect(pageJs).toContain('function convertCurrentPdfToDocx');
    expect(pageJs).toContain("'/convert-format'");
    expect(pageJs).toContain("target_format: 'docx'");
    expect(pageJs).toContain('Convert it to DOCX before review edits');
    expect(fileViewerCss).toContain('.file-viewer-format-notice');
    expect(fileViewerCss).toContain('.file-viewer-format-notice__action');
  });

  test('keeps workspace data catalogs available without enabling viewer insertion edits', () => {
    expect(html).not.toContain('id="reviewInsertFieldBtn"');
    expect(html).not.toContain('Insert workspace data');
    expect(pageJs).toContain("'/merge-fields'");
    expect(pageJs).toContain("'/template-variables'");
    expect(pageJs).toContain('field_catalog');
    expect(pageJs).toContain('openWorkspaceFieldPicker');
    expect(pageJs).toContain('insertWorkspaceField');
    expect(pageJs).toContain('data-editor-field-mode');
    expect(pageJs).toContain('Current value');
    expect(pageJs).toContain('Template field');
    expect(pageJs).not.toContain('workspace-field-requested');
    expect(pageJs).toContain('edit_intent');
    expect(pageJs).toContain("'document_edit'");
    expect(pageJs).toContain('base.document_edit =');
    expect(pageJs).toContain('function parseDocumentEditSuggestion');
    expect(pageJs).toContain('(?:lana-document-edit|json)?');
    expect(pageJs).not.toContain('stageSuggestedEdit');
    expect(pageJs).toContain('Open this document in File Editor to apply LANA suggested edits.');
    expect(pageJs).toContain('lex-lana-response-end');
    expect(pageJs).toContain('lex-lana-module-context-remove');
    expect(pageJs).toContain('state.editorFocusedContext = null');
    expect(pageJs).toContain('panel.prefillPrompt(prompt)');
    expect(pageJs).not.toContain('panel.send(prompt, {');
    expect(pageJs).toContain('function getConversationMatterId');
    expect(pageJs).toContain('function isLikelyUuid');
    expect(pageJs).toContain('function getFileMatterDisplayName');
    expect(pageJs).toContain('function getMatterResponseRecord');
    expect(pageJs).toContain('function getMatterRecordDisplayName');
    expect(pageJs).toContain('function getMatterRecordIdentityValues');
    expect(pageJs).toContain('function getMatterRecordDetailId');
    expect(pageJs).toContain('function matterRowsFromResponse');
    expect(pageJs).toContain('function buildMatterLookupMap');
    expect(pageJs).toContain('conversationMatterId: conversationMatterId');
    expect(pageJs).toContain('function loadMatterLookupMap');
    expect(pageJs).toContain('function resolveMatterFromList');
    expect(pageJs).toContain('function isMatterIdentifierLabel');
    expect(pageJs).toContain('function setFileBreadcrumb');
    expect(pageJs).toContain('function hydrateFileBreadcrumbMatterLabel');
    expect(pageJs).toContain("label: matterLabel || getFileMatterDisplayName(file) || 'Workspace'");
    expect(pageJs).toContain("href: 'workspace-details.html?id=' + encodeURIComponent(hrefId)");
    expect(pageJs).toContain('var listMatter = await resolveMatterFromList(matterId);');
    expect(pageJs).toContain('var resolvedMatter = await resolveMatterFromList(storageMatterId);');
    expect(pageJs).toContain('resolvedMatter && resolvedMatter.conversationMatterId');
    expect(pageJs).toContain('setFileBreadcrumb(file, listMatter.name, listMatter.hrefId)');
    expect(pageJs).toContain('if (isLikelyUuid(matterId) || typeof api.getMatter !==');
    expect(pageJs).toContain('api.getMatter(matterId)');
    expect(pageJs).toContain('setFileBreadcrumb(file, name, getMatterRecordDetailId(matter))');
    expect(pageJs).toContain('setFileBreadcrumb(response)');
    expect(pageJs).toContain('hydrateFileBreadcrumbMatterLabel(response)');
    expect(pageJs).toContain('file.workspace_name');
    expect(pageJs).toContain('file.matter && file.matter.name');
    expect(pageJs).toContain('metadata.workspace_name');
    expect(pageJs).toContain('metadata.matter && metadata.matter.name');
    expect(pageJs).toContain('nested.workspace_name');
    expect(pageJs).toContain('nested.matter && nested.matter.name');
    expect(pageJs).toContain('function currentReviewerName');
    expect(pageJs).toContain('author: currentReviewerName()');
    expect(pageJs).toContain('storage_matter_id');
    expect(pageJs).toContain("lanaPanel.removeAttribute('matter-id')");
    expect(pageJs).toContain("askLanaBtn.removeAttribute('matter-id')");
    expect(pageJs).toContain('delete opts.matterId');
    expect(pageJs).not.toContain('reviewInsertFieldBtn');
    expect(fileViewerCss).not.toContain('.file-viewer-review-insert-btn');
  });

  test('forwards completed LANA responses so document-edit suggestions can be staged', () => {
    const chatJs = fs.readFileSync(
      path.join(__dirname, '../../src/js/lex/chat/lex-chat.js'),
      'utf8'
    );
    const panelJs = fs.readFileSync(
      path.join(__dirname, '../../src/js/lex/components/chat/lex-lana-panel.js'),
      'utf8'
    );
    expect(chatJs).toContain("content: this._streamingContent || ''");
    expect(panelJs).toContain('lex-chat-response-end');
    expect(panelJs).toContain('lex-lana-response-end');
  });

  test('file viewer back navigation skips self-referrer viewer routes', () => {
    expect(pageJs).toContain('function normalizeBackReferrer');
    expect(pageJs).toContain("return page === 'file-viewer.html';");
    expect(pageJs).toContain("return '';");
    expect(pageJs).toContain('function fileViewerNavContext');
    expect(pageJs).toContain('context: fileViewerNavContext');
    expect(pageJs).toContain("document.addEventListener('topbar-back-click', interceptShellBack, true);");
    expect(pageJs).toContain('var target = targetBackRoute();');
    expect(pageJs).toContain("Lex.Nav.go('dashboard.html');");
    expect(pageJs).not.toContain("return 'library.html';");
    expect(pageJs).not.toContain("referrer: 'file-viewer.html?id='");
  });

  test('shows a dedicated access-denied modal when the metadata API returns 403', () => {
    expect(pageJs).toContain('function isFileAccessDenied');
    expect(pageJs).toContain("Number(error.status) === 403");
    expect(pageJs).toContain("Lex.Modal.alert('Access denied', 'You do not have access to this file.'");
  });

  test('file viewer uses source document lineage for released artifacts', () => {
    expect(pageJs).toContain('function explicitFileSourceDocumentId');
    expect(pageJs).toContain('function canonicalReviewSourceDocumentId');
    expect(pageJs).toContain('function isReleasedArtifactFile');
    expect(pageJs).toContain('function releaseForCurrentFile');
    expect(pageJs).toContain('sourceDocumentId: canonicalReviewSourceDocumentId(file)');
    expect(pageJs).toContain('function fileEditorBaselineRelease(file)');
    expect(pageJs).toContain('var baselineDocumentId = releaseDocumentId(baselineRelease)');
    expect(pageJs).toContain('releasedDocumentId: baselineRelease && baselineDocumentId ? baselineDocumentId :');
    expect(pageJs).toContain('editorBaselineReleaseId: baselineRelease && baselineRelease.id');
    expect(pageJs).toContain('var reviewDocumentId = String(file.id);');
    expect(pageJs).toContain('LanaDocumentReview.loadReleaseLineage({');
    expect(pageJs).toContain("'?document_id=' + encodeURIComponent(reviewDocumentId)");
    expect(pageJs).toContain('state.reviewReleases = Array.isArray(releasesResponse && releasesResponse.data)');
    expect(pageJs).toContain('if (isReleasedArtifactFile(file) || releaseForCurrentFile(file)) return false;');
    expect(pageJs).toContain('var openedRelease = releaseForCurrentFile(file);');
    expect(pageJs).toContain("reviewEndpoint('/documents/' + encodeURIComponent(reviewDocumentId) + '/edit-batches')");
  });

  test('File Info exposes authoritative updated and release metadata after reload', () => {
    expect(html).toContain('id="metaUpdatedAt"');
    expect(html).toContain('id="metaCurrentVersion"');
    expect(html).toContain('id="metaReleaseCount"');
    expect(html).toContain('id="metaLatestReleasedAt"');
    expect(pageJs).toContain('state.reviewReleaseMetadata = releasesResponse && releasesResponse.metadata');
    expect(pageJs).toContain("'Version ' + currentReleaseNumber");
    expect(pageJs).toContain('releaseMetadata.release_count');
    expect(pageJs).toContain('releaseMetadata.latest_released_at');
    expect(pageJs).toContain("formatDate(file.updated_at || file.created_at)");
  });
});

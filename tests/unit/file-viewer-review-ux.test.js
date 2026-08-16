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
const drawerJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/lex/components/foundation/lex-drawer.js'),
  'utf8'
);
const fileViewerCss = fs.readFileSync(
  path.join(__dirname, '../../src/css/file-viewer.css'),
  'utf8'
);

describe('file-viewer review UX foundation', () => {
  test('keeps file info behind explicit drawer actions', () => {
    expect(html).toContain('id="viewerFileInfoBtn"');
    expect(html).toContain('View File Info');
    expect(html).toContain('id="reviewRailInfoBtn"');
    expect(html).toContain('<lex-drawer id="fileInfoDrawer"');
    expect(html).toContain('id="metadataSidebar" class="file-viewer-file-info"');
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

  test('makes read-only canvas mode explicit without freeform edit language', () => {
    expect(html).toContain('View / Read-only');
    expect(html).toContain('Enter Review Mode');
    expect(html).not.toContain('Freeform Edit');
  });

  test('handles review mode through delegated banner clicks because lex-banner clones slot content', () => {
    expect(pageJs).toContain("node.id === 'viewerReviewModeBadge'");
    expect(pageJs).toContain("case 'viewerReviewModeBadge':");
    expect(pageJs).not.toContain("reviewModeBtn.addEventListener('click'");
  });

  test('repositions the review segmented control after the hidden rail becomes visible', () => {
    expect(pageJs).toContain('tabs.value = state.reviewTab');
    expect(pageJs).toContain('tabs._positionIndicator()');
  });

  test('wires review drafts and releases to backend edit-batch endpoints', () => {
    expect(html).toContain('id="reviewSaveDraftBtn"');
    expect(html).toContain('id="reviewReleaseBtn"');
    expect(html).toContain('id="reviewReleasesList"');
    expect(pageJs).toContain('async function saveReviewBatch');
    expect(pageJs).toContain('async function releaseReviewVersion');
    expect(pageJs).toContain('async function selectReleaseForComparison');
    expect(pageJs).toContain('function clearReleaseComparison');
    expect(pageJs).toContain("'/edit-batches'");
    expect(pageJs).toContain("'/release'");
    expect(pageJs).toContain("'/compare'");
    expect(pageJs).toContain('content_base64');
    expect(pageJs).toContain('loadReviewWorkflow(file)');
    expect(pageJs).toContain("tab === 'releases'");
    expect(pageJs).toContain('Released in Version');
    expect(pageJs).toContain('data-review-release-compare-index');
    expect(pageJs).toContain('selectedReviewReleaseId');
    expect(pageJs).toContain("setReviewTab('releases')");
    expect(pageJs).toContain('showLoading()');
    expect(pageJs).toContain('Unreleased');
    expect(pageJs).toContain("title: 'Version '");
    expect(pageJs).toContain('renderReviewChangeDiff');
    expect(pageJs).toContain('data-review-history-filter="user"');
    expect(pageJs).toContain("label: 'Pending'");
    expect(html).toContain('id="viewerDiff"');
    expect(fileViewerCss).toContain('.file-viewer-review-item-version');
    expect(fileViewerCss).toContain('.file-viewer-review-status--pending');
    expect(fileViewerCss).toContain('.file-viewer-review-history-header::after');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__diff-line--added');
    expect(fileViewerCss).toContain('.file-viewer-review-history-row__diff-line--removed');
    expect(fileViewerCss).toContain('.file-viewer-review-workflow');
    expect(fileViewerCss).toContain('.file-viewer-review-release');
    expect(fileViewerCss).toContain('.file-viewer-review-release--selected');
    expect(fileViewerCss).toContain('button.file-viewer-review-release');
    expect(fileViewerCss).toContain('.file-viewer-diff-viewer');
  });
});

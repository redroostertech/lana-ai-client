/* File viewer: what the page itself does for the live processing panel
   (js/file-viewer-ingestion.js), kept apart from file-viewer-page.js so it
   can be tested on its own.

   - Lights the PDF's pages in LANA's PDF view as they become searchable
     (data-lana-ingest="waiting" | "ready" on each .le-pdf-page). The view
     builds its pages after the file loads and rebuilds them when it redraws,
     so the last state is kept and painted again whenever pages change.
   - Goes to a page when a tile in the panel is chosen: in LANA's PDF view by
     scrolling to it; in the plain PDF view by reopening the PDF at that page
     (a change to only the #page part of the address does not move it).
   - Opens another file of a set uploaded together.

   FileViewerIngestionPage.create(deps) -> { onPages, onGoToPage, onOpenUpload }
   FileViewerIngestionPage.uploadSetFrom(value) -> [{ id, name }] */

(function (global) {
  'use strict';

  var MAX_UPLOADS = 50;

  /** The files uploaded together, as navigation context carried them. */
  function uploadSetFrom(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (item) {
      return item && typeof item.id === 'string' && item.id;
    }).slice(0, MAX_UPLOADS).map(function (item) {
      return { id: item.id, name: typeof item.name === 'string' ? item.name : '' };
    });
  }

  /**
   * @param {Object} deps
   * @param {function(): Element} deps.host - LANA's PDF view container
   * @param {function(): boolean} deps.isEditorPdf - the file is open in LANA's PDF view
   * @param {function(number): void} deps.jumpToPage - scroll LANA's PDF view to a page
   * @param {function(): HTMLIFrameElement} deps.iframe - the plain PDF view
   * @param {function(): string} deps.pdfUrl - the plain PDF view's blob URL
   * @param {function(): Array} deps.uploads - the set uploaded together
   * @param {function(string): void} deps.navigate - open another file of the set
   */
  function create(deps) {
    var detail = null;
    var observer = null;

    function pages() {
      var host = deps.isEditorPdf() ? deps.host() : null;
      return host ? host.querySelectorAll('.le-pdf-page') : [];
    }

    function paint() {
      Array.prototype.forEach.call(pages(), function (page, index) {
        if (!detail) page.removeAttribute('data-lana-ingest');
        else page.setAttribute('data-lana-ingest', index < detail.ready ? 'ready' : 'waiting');
      });
    }

    // Pages added or rebuilt are painted again. Only child changes are
    // watched, so painting (attribute changes) does not wake it.
    function watch() {
      if (observer || typeof global.MutationObserver !== 'function') return;
      var host = deps.host();
      if (!host) return;
      observer = new global.MutationObserver(paint);
      observer.observe(host, { childList: true, subtree: true });
    }

    function unwatch() {
      if (observer) observer.disconnect();
      observer = null;
    }

    function onPages(event) {
      detail = (event && event.detail) || null;
      paint();
      if (detail) watch();
      else unwatch();
    }

    function onGoToPage(event) {
      var page = Number(event && event.detail && event.detail.page);
      if (!Number.isSafeInteger(page) || page < 1) return;
      if (pages().length) {
        deps.jumpToPage(page);
        return;
      }
      var iframe = deps.iframe();
      var url = deps.pdfUrl();
      if (!url || !iframe || iframe.classList.contains('hidden')) return;
      var target = url + '#page=' + page;
      iframe.addEventListener('load', function reopen() {
        iframe.removeEventListener('load', reopen);
        iframe.src = target;
      });
      iframe.src = 'about:blank';
    }

    function onOpenUpload(event) {
      var id = event && event.detail && event.detail.id;
      if (!id || !deps.uploads().some(function (u) { return u.id === id; })) return;
      deps.navigate(id);
    }

    return { onPages: onPages, onGoToPage: onGoToPage, onOpenUpload: onOpenUpload };
  }

  var api = { create: create, uploadSetFrom: uploadSetFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.FileViewerIngestionPage = api;
})(typeof window !== 'undefined' ? window : this);

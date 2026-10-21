/*
 * InsightsOverlays - the dialogs shared by insights/module-execution.html and
 * insights/dashboard.html, on lex-modal and lex-drawer (UI standard section 11).
 *
 * Both pages used to carry their own hand-built `fixed inset-0` copies of the
 * same overlays. They now call this module:
 *
 *   InsightsOverlays.drilldownContent()        the #drilldownContent element (mounts the modal)
 *   InsightsOverlays.openDrilldown(title)      opens the full-size drilldown lex-modal, returns its content element
 *   InsightsOverlays.closeDrilldown()
 *   InsightsOverlays.helpButton(helpText, id, { renderInline, renderBlock })
 *                                              HTML for a chart's help icon; clicking it opens a lex-modal
 *   InsightsOverlays.pageModal(id, opts)       a persistent lex-modal built from a <template id="<id>Template">
 *   InsightsOverlays.openModal(id, opts) / closeModal(id)
 *   InsightsOverlays.overridePanel(opts)       the shared DataOverridePanel (js/components/data-override-panel.js)
 *
 * The modals are created in JS rather than declared in page markup: a lex-modal
 * parsed after lex-modal.js is defined (dashboard.html loads it in <head>)
 * would upgrade before its children are parsed and lose them.
 */
(function (global) {
  'use strict';

  var DRILLDOWN_ID = 'drilldownModal';
  var helpRegistry = Object.create(null);
  var helpListenerInstalled = false;
  var overrideInstance = null;

  function doc() { return global.document; }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function closeButton(label) {
    return '<lex-btn data-slot="footer" variant="secondary" data-action="cancel">' + escapeHtml(label || 'Close') + '</lex-btn>';
  }

  /**
   * Find or create a persistent lex-modal with this id. Any legacy element
   * with the same id (old hand-built markup) is removed first.
   * opts: heading (give one: lex-modal renders no header without it), initialHeading,
 * size, width, flush, html (body + data-slot="footer" children),
   * template (id of a <template> whose content is the body; default `${id}Template`).
   */
  function pageModal(id, opts) {
    opts = opts || {};
    var d = doc();
    var existing = d.getElementById(id);
    if (existing && existing.tagName === 'LEX-MODAL') {
      if (opts.heading !== undefined) existing.heading = opts.heading;
      return existing;
    }
    if (existing) existing.remove();

    var modal = d.createElement('lex-modal');
    modal.id = id;
    modal.setAttribute('heading', opts.heading || opts.initialHeading || '');
    modal.setAttribute('size', opts.size || 'md');
    modal.setAttribute('hide-actions', '');
    if (opts.width) modal.setAttribute('width', opts.width);
    if (opts.flush) modal.setAttribute('flush', '');

    var html = opts.html;
    if (html === undefined) {
      var tpl = d.getElementById(opts.template || (id + 'Template'));
      html = tpl ? tpl.innerHTML : '';
    }
    modal.innerHTML = html;
    d.body.appendChild(modal);
    return modal;
  }

  function openModal(id, opts) {
    var modal = pageModal(id, opts);
    modal.open = true;
    return modal;
  }

  function closeModal(id) {
    var modal = doc().getElementById(id);
    if (modal && modal.tagName === 'LEX-MODAL') modal.open = false;
  }

  // ---------------------------------------------------------------------------
  // Drilldown (full-size modal shared by every metric drilldown on both pages)
  // ---------------------------------------------------------------------------

  function drilldownModal() {
    // lex-modal renders its header (title + close) only when it has a heading
    // at first render, so mount with a placeholder; openDrilldown sets it.
    return pageModal(DRILLDOWN_ID, {
      heading: undefined,
      initialHeading: 'Details',
      size: 'full',
      html: '<div id="drilldownContent"></div>' + closeButton('Close')
    });
  }

  function drilldownContent() {
    var modal = drilldownModal();
    return modal.querySelector('#drilldownContent');
  }

  function openDrilldown(title) {
    var modal = drilldownModal();
    modal.heading = title || 'Details';
    modal.open = true;
    return modal.querySelector('#drilldownContent');
  }

  function closeDrilldown() {
    closeModal(DRILLDOWN_ID);
  }

  // ---------------------------------------------------------------------------
  // Chart help (one lex-modal per click, removed on close)
  // ---------------------------------------------------------------------------

  function identity(text) { return text == null ? '' : String(text); }

  function helpSectionsHtml(helpText, renderInline, renderBlock) {
    return helpText.sections.map(function (section) {
      var contentHTML = '';
      if (section.content) {
        contentHTML = '<div class="text-sm text-gray-700 leading-relaxed">' + renderBlock(section.content) + '</div>';
      }
      if (section.bullets && section.bullets.length > 0) {
        contentHTML = '<ul class="list-disc pl-5 space-y-2">' + section.bullets.map(function (bullet) {
          return '<li class="text-sm text-gray-700 leading-relaxed">' + renderInline(bullet) + '</li>';
        }).join('') + '</ul>';
      }
      return '<div class="mb-6"><h4 class="text-md font-semibold text-gray-900 mb-3">' +
        renderInline(section.heading) + '</h4>' + contentHTML + '</div>';
    }).join('');
  }

  function openHelp(key) {
    var entry = helpRegistry[key];
    var Lex = global.Lex;
    if (!entry || !Lex || !Lex.Modal) return null;
    return Lex.Modal.open({
      heading: entry.title,
      size: 'lg',
      content: entry.html,
      footerContent: '<lex-btn variant="primary" data-action="cancel">Got it</lex-btn>'
    });
  }

  function installHelpListener() {
    if (helpListenerInstalled) return;
    helpListenerInstalled = true;
    doc().addEventListener('click', function (e) {
      var trigger = e.target && e.target.closest ? e.target.closest('[data-insights-help]') : null;
      if (!trigger) return;
      e.preventDefault();
      openHelp(trigger.getAttribute('data-insights-help'));
    });
  }

  /**
   * HTML for a chart's help icon button. Section text goes through the
   * page's markdown renderers when given (module-execution), else as-is.
   * Returns '' when there is no help text.
   */
  function helpButton(helpText, uniqueId, opts) {
    if (!helpText || !helpText.sections || helpText.sections.length === 0) return '';
    opts = opts || {};
    var renderInline = opts.renderInline || identity;
    var renderBlock = opts.renderBlock || identity;
    var key = 'help-modal-' + uniqueId;
    helpRegistry[key] = {
      title: helpText.title || 'Help',
      html: helpSectionsHtml(helpText, renderInline, renderBlock)
    };
    installHelpListener();
    return '<button type="button" data-insights-help="' + escapeHtml(key) + '"' +
      ' class="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"' +
      ' title="Click for help understanding this chart" aria-label="Help for this chart">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
      '</svg></button>';
  }

  // ---------------------------------------------------------------------------
  // Data override (lex-drawer, via the shared DataOverridePanel component)
  // ---------------------------------------------------------------------------

  /**
   * The one DataOverridePanel for the page, created on first use (the
   * component module sets window.DataOverridePanel). opts are its config
   * (apiClient, onSaveSuccess, onDeleteSuccess, onError, formatNumber,
   * formatDateRange). Returns null if the component is not loaded.
   */
  function overridePanel(opts) {
    if (overrideInstance) return overrideInstance;
    var Panel = global.DataOverridePanel;
    if (typeof Panel !== 'function') return null;
    overrideInstance = new Panel(opts || {});
    return overrideInstance;
  }

  var InsightsOverlays = {
    pageModal: pageModal,
    openModal: openModal,
    closeModal: closeModal,
    drilldownContent: drilldownContent,
    openDrilldown: openDrilldown,
    closeDrilldown: closeDrilldown,
    helpButton: helpButton,
    openHelp: openHelp,
    overridePanel: overridePanel,
    _reset: function () {
      overrideInstance = null;
      helpRegistry = Object.create(null);
    }
  };

  global.InsightsOverlays = InsightsOverlays;
  if (typeof module !== 'undefined' && module.exports) module.exports = InsightsOverlays;
})(typeof window !== 'undefined' ? window : globalThis);

/* Reports list page (admin/reports-list.html): the list of reports, its
   search, "show more", the about drawer with its footer run controls, and
   Import Report (plus New report, hidden for now). Picking a report or Run
   in the drawer opens the report page (admin/report.html); helpers both pages
   share live in reports-list.model.js (ReportsList). */

(function () {
  'use strict';

  // Shared with the other Reports page (reports-list.model.js).
  var ReportsList = window.ReportsList;

  var escapeHtml = ReportsList.escapeHtml;
  var allModules = [];
  var importedReports = [];
  var pendingImportFile = null;

  async function loadReports() {
    try {
      var catalog = await ReportsList.loadCatalog(api);
      allModules = catalog.modules;
      importedReports = catalog.saved;
    } catch (error) {
      console.error('[Reports] Failed to load reports:', error);
      if (window.Lex && Lex.Toast) Lex.Toast.error('Reports could not load. Please refresh the page.');
      return;
    }
    renderReportsList();
  }

  function findReportEntry(id) {
    return ReportsList.findEntry(allModules, importedReports, id);
  }

  // ==========================================================================
  // The list. Rows come from the report catalog and saved reports
  // (ReportsList); picking one opens its report page.
  // ==========================================================================

  function reportsListRenderers() {
    return {
      name: function (value, row) {
        return '<div class="reporting-list__name">' + escapeHtml(value)
          + (row.saved ? ' <lex-badge label="Saved copy" color="gray"></lex-badge>' : '') + '</div>';
      },
      purpose: function (_value, row) {
        return ReportsList.purposeCell(row, escapeHtml);
      },
      audience: function (value) {
        return value ? escapeHtml(value) : '<span class="reporting-list__muted">Anyone</span>';
      },
      last_run_at: function (value) {
        var text = value ? LanaTime.timeAgo(value, { style: 'words' }) : '';
        return text
          ? '<time datetime="' + escapeHtml(value) + '">' + escapeHtml(text) + '</time>'
          : '<span class="reporting-list__muted">Not run yet</span>';
      }
    };
  }

  function renderReportsList() {
    var table = document.getElementById('reportsListTable');
    if (!table || typeof table.setData !== 'function') return;
    // Each visit mounts a new table, so bind per element.
    if (!table.dataset.listBound) {
      table.dataset.listBound = 'true';
      table.setCellRenderers(reportsListRenderers());
      table._getSearchColumns = function () { return ['name', 'purpose', 'audience']; };
      table.addEventListener('row-click', function (event) {
        var row = event.detail && event.detail.row;
        if (row) Lex.Nav.go(ReportsList.reportHref(row));
      });
      // Show more opens the report's side panel. lex-table leaves clicks on
      // buttons to them, so this never opens the report itself.
      table.addEventListener('click', function (event) {
        var button = event.target.closest('[data-report-about]');
        if (button) openReportAbout(button.getAttribute('data-report-about'));
      });
      var search = document.getElementById('reportsListSearch');
      if (search) {
        var runSearch = function (event) {
          var value = event && event.detail && event.detail.value !== undefined ? event.detail.value : search.value;
          if (table.dataSource) table.dataSource.setSearch(String(value || '').trim());
        };
        search.addEventListener('lex-input', runSearch);
        search.addEventListener('lex-change', runSearch);
      }
    }
    var entries = ReportsList.buildReportEntries(allModules, importedReports);
    table.setData(entries);
    var count = document.getElementById('reportsListCount');
    if (count) count.textContent = entries.length + (entries.length === 1 ? ' report' : ' reports');
  }

  // Side panel: what the report is, what you see, how it is put together,
  // the data it uses, its goal, how to use it and what is good to know (the
  // report's declared about, from its detail; a saved report has none). The
  // run controls sit in the drawer footer (#reportRunFooter), for every
  // report.
  var reportAboutRequest = 0;
  var drawerPreset = 'thisWeek';

  function drawerIcon(name) {
    return window.Lex && Lex.Icons ? Lex.Icons.get({ name: name, size: 'small' }) : '';
  }

  async function openReportAbout(id) {
    var drawer = document.getElementById('reportAboutDrawer');
    var entry = id && findReportEntry(id);
    if (!drawer || !entry) return;
    bindDrawerRun(drawer);
    var request = ++reportAboutRequest;
    drawer.dataset.reportId = id;
    drawer.heading = entry.name;
    var footer = document.getElementById('reportRunFooter');
    if (footer) footer.innerHTML = ReportsList.runFooterHtml(drawerPreset, escapeHtml);
    drawer.contentRoot.innerHTML = '<div data-report-about-body>'
      + (entry.kind === 'report'
        ? '<p class="reporting-list__muted">Loading\u2026</p>'
        : ReportsList.aboutHtml(null, escapeHtml, drawerIcon)) + '</div>';
    drawer.open = true;
    if (entry.kind !== 'report') return;
    var body = drawer.contentRoot.querySelector('[data-report-about-body]');
    try {
      var detail = await api.get('/api/v1/modules/' + encodeURIComponent(entry.key));
      if (request !== reportAboutRequest) return;
      body.innerHTML = ReportsList.aboutHtml(detail && detail.about, escapeHtml, drawerIcon);
    } catch (error) {
      if (request !== reportAboutRequest) return;
      console.error('[Reporting] Failed to load report details:', error);
      body.innerHTML = '<p class="reporting-list__muted">The details could not load. Please try again.</p>';
    }
  }

  function bindDrawerRun(drawer) {
    if (drawer.dataset.runBound) return;
    drawer.dataset.runBound = 'true';
    drawer.addEventListener('lex-change', function (event) {
      var select = event.target.closest('[data-run-period]');
      if (select) pickDrawerPreset(drawer, select.value);
    });
    drawer.addEventListener('click', function (event) {
      if (event.target.closest('[data-run-report]')) runFromDrawer(drawer);
    });
  }

  function pickDrawerPreset(drawer, preset) {
    drawerPreset = preset;
    var custom = drawer.querySelector('[data-run-custom]');
    if (custom) custom.hidden = preset !== 'custom';
    showDrawerProblem(drawer, null);
  }

  function showDrawerProblem(drawer, message) {
    var problem = drawer.querySelector('[data-run-problem]');
    if (!problem) return;
    problem.textContent = message || '';
    problem.hidden = !message;
  }

  // Run picks the period, closes the panel and opens the report page with
  // the period in its URL; the report page runs it.
  function runFromDrawer(drawer) {
    var entry = findReportEntry(drawer.dataset.reportId);
    if (!entry) return;
    var period = { preset: drawerPreset };
    if (drawerPreset === 'custom') {
      var start = (drawer.querySelector('[data-run-start]') || {}).value || '';
      var end = (drawer.querySelector('[data-run-end]') || {}).value || '';
      var problem = ReportsList.customPeriodProblem(start, end);
      if (problem) {
        showDrawerProblem(drawer, problem);
        return;
      }
      period = { start: start, end: end };
    }
    drawer.open = false;
    Lex.Nav.go(ReportsList.reportHref(entry, period));
  }

  // ==========================================================================
  // New report: from the metric catalog, or build your own
  // ==========================================================================

  // Two paths. From the metric catalog: a catalog metric's value, or the rows
  // behind it (only metrics the catalog marks has_rows). Build your own: a
  // custom report definition, imported as before. The backend refuses any
  // key that is not in the catalog.
  var NEW_REPORT_PATHS = [
    { value: 'catalog', label: 'From the metric catalog' },
    { value: 'custom', label: 'Build your own' }
  ];
  function newReportShowOptions() {
    return [
      { value: window.ReportBuilder.KINDS.value, label: 'Its value' },
      { value: window.ReportBuilder.KINDS.rows, label: 'The rows behind it' }
    ];
  }

  function newReportContent() {
    return '<div class="reporting-new-report">'
      + '<lex-segmented id="newReportPath" name="newReportPath"></lex-segmented>'
      + '<div id="newReportCatalog" class="reporting-new-report__section">'
      + '<p class="reporting-new-report__text">Pick a metric from the metric catalog. The report shows its value for the period you run it for, or the rows behind that number.</p>'
      + '<lex-segmented id="newReportShow" name="newReportShow"></lex-segmented>'
      + '<lex-select id="newReportMetric" name="newReportMetric" label="Metric" searchable placeholder="Loading metrics..."></lex-select>'
      + '<lex-input id="newReportName" name="newReportName" label="Report name"></lex-input>'
      + '<p id="newReportError" class="reporting-new-report__error" role="alert" hidden></p>'
      + '</div>'
      + '<div id="newReportCustom" class="reporting-new-report__section" hidden>'
      + '<p class="reporting-new-report__text">Make your own report from your firm\'s tables. Write a report definition file (JSON, or a ZIP with report.json) and import it.</p>'
      + '</div>'
      + '</div>';
  }

  async function openNewReport() {
    var modal = Lex.Modal.open({ heading: 'New report', size: 'md', content: newReportContent() });
    modal.hideActions = false;
    modal.confirmText = 'Save report';
    modal.cancelText = 'Cancel';

    var root = modal.contentRoot || modal;
    var pathEl = root.querySelector('#newReportPath');
    var showEl = root.querySelector('#newReportShow');
    var metricEl = root.querySelector('#newReportMetric');
    var nameEl = root.querySelector('#newReportName');
    var errorEl = root.querySelector('#newReportError');
    var catalogEl = root.querySelector('#newReportCatalog');
    var customEl = root.querySelector('#newReportCustom');
    var catalogMetrics = [];
    var path = 'catalog';
    var kind = window.ReportBuilder.KINDS.value;

    function showError(message) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
    }
    function refreshMetricOptions() {
      var options = window.ReportBuilder.catalogMetricOptions(catalogMetrics, kind);
      var current = metricEl.value;
      metricEl.options = options;
      metricEl.placeholder = options.length ? 'Pick a metric' : 'No metrics to pick';
      if (!options.some(function (o) { return o.value === current; })) metricEl.value = '';
    }

    pathEl.options = NEW_REPORT_PATHS;
    pathEl.value = path;
    showEl.options = newReportShowOptions();
    showEl.value = kind;
    pathEl.addEventListener('lex-change', function (event) {
      path = event.detail.value;
      catalogEl.hidden = path !== 'catalog';
      customEl.hidden = path !== 'custom';
      modal.confirmText = path === 'custom' ? 'Import a definition' : 'Save report';
      showError('');
    });
    showEl.addEventListener('lex-change', function (event) {
      kind = event.detail.value;
      refreshMetricOptions();
    });
    metricEl.addEventListener('lex-change', function (event) {
      var picked = catalogMetrics.find(function (m) { return m.key === event.detail.value; });
      if (picked && !nameEl.value) nameEl.value = picked.display_name || picked.title || picked.name || picked.key;
    });

    modal.addEventListener('lex-confirm', function () {
      modal.keepOpen();
      if (path === 'custom') {
        modal.removeAfterClose();
        openImportModal();
        return;
      }
      var built = window.ReportBuilder.catalogReportDefinition({ kind: kind, metricKey: metricEl.value, name: nameEl.value });
      if (built.problem) { showError(built.problem); return; }
      showError('');
      saveCatalogReport(built.body).then(function (saved) {
        if (saved) modal.removeAfterClose();
      }).catch(function (error) {
        showError(error.message || 'The report could not be saved. Please try again.');
      });
    });

    try {
      var response = await api.getMetricCatalog({ limit: 1000 });
      catalogMetrics = (response && response.data) || [];
      refreshMetricOptions();
    } catch (error) {
      showError('The metric catalog could not load. Please try again.');
    }
  }

  async function saveCatalogReport(body) {
    var result = await api.post('/api/v1/reporting/reports', body);
    var report = result && (result.data || result);
    Lex.Toast.success('Report saved.');
    if (report && report.report_id) {
      Lex.Nav.go(ReportsList.reportHref({ kind: 'saved', key: report.report_id }, { preset: 'last7days' }));
    } else {
      await loadReports();
    }
    return true;
  }

  // Import modal
  function openImportModal() {
    pendingImportFile = null;
    var modal = document.getElementById('importReportModal');
    if (modal) modal.classList.remove('hidden');

    // Reset state
    var fileInput = document.getElementById('importFileInput');
    if (fileInput) fileInput.value = '';
    var fileInfo = document.getElementById('importFileInfo');
    if (fileInfo) fileInfo.classList.add('hidden');
    var submitBtn = document.getElementById('importSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Import'; }
    var errEl = document.getElementById('importError');
    if (errEl) errEl.classList.add('hidden');
    var successEl = document.getElementById('importSuccess');
    if (successEl) successEl.classList.add('hidden');
  }

  function closeImportModal() {
    var modal = document.getElementById('importReportModal');
    if (modal) modal.classList.add('hidden');
    pendingImportFile = null;
  }

  function handleImportFileSelect(file) {
    if (!file) return;

    var validTypes = ['application/json', 'text/json', 'application/zip', 'application/x-zip-compressed'];
    var validExtensions = ['.json', '.zip'];
    var fileName = file.name.toLowerCase();
    var hasValidExt = validExtensions.some(function (ext) { return fileName.endsWith(ext); });

    if (validTypes.indexOf(file.type) === -1 && !hasValidExt) {
      var errEl = document.getElementById('importError');
      var errText = document.getElementById('importErrorText');
      if (errText) errText.textContent = 'Invalid file type. Please upload a JSON or ZIP file.';
      if (errEl) errEl.classList.remove('hidden');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      var errEl2 = document.getElementById('importError');
      var errText2 = document.getElementById('importErrorText');
      if (errText2) errText2.textContent = 'File too large. Maximum size is 50 MB.';
      if (errEl2) errEl2.classList.remove('hidden');
      return;
    }

    pendingImportFile = file;

    // Show file info
    var fileInfo = document.getElementById('importFileInfo');
    if (fileInfo) fileInfo.classList.remove('hidden');
    var fileNameEl = document.getElementById('importFileName');
    if (fileNameEl) fileNameEl.textContent = file.name;
    var fileSizeEl = document.getElementById('importFileSize');
    if (fileSizeEl) {
      var sizeKB = (file.size / 1024).toFixed(1);
      fileSizeEl.textContent = sizeKB > 1024 ? (file.size / 1024 / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
    }

    // Enable submit
    var submitBtn = document.getElementById('importSubmitBtn');
    if (submitBtn) submitBtn.disabled = false;

    // Hide errors
    var errEl3 = document.getElementById('importError');
    if (errEl3) errEl3.classList.add('hidden');
    var successEl = document.getElementById('importSuccess');
    if (successEl) successEl.classList.add('hidden');
  }

  function clearImportFile() {
    pendingImportFile = null;
    var fileInput = document.getElementById('importFileInput');
    if (fileInput) fileInput.value = '';
    var fileInfo = document.getElementById('importFileInfo');
    if (fileInfo) fileInfo.classList.add('hidden');
    var submitBtn = document.getElementById('importSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;
  }

  async function submitImport() {
    if (!pendingImportFile) return;

    var submitBtn = document.getElementById('importSubmitBtn');
    var errEl = document.getElementById('importError');
    var errText = document.getElementById('importErrorText');
    var successEl = document.getElementById('importSuccess');
    var successText = document.getElementById('importSuccessText');

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Importing...'; }
    if (errEl) errEl.classList.add('hidden');
    if (successEl) successEl.classList.add('hidden');

    try {
      var formData = new FormData();
      formData.append('report_file', pendingImportFile);

      var result = await api.post('/api/v1/reporting/import', formData);

      var reportName = (result.data && result.data.name) || pendingImportFile.name;
      var isUpdate = result.metadata && result.metadata.is_update;

      if (successText) successText.textContent = (isUpdate ? 'Updated' : 'Imported') + ' report: ' + reportName;
      if (successEl) successEl.classList.remove('hidden');

      // Refresh the list so the imported report shows.
      await loadReports();

      // Reset file input after success
      pendingImportFile = null;
      var fileInput = document.getElementById('importFileInput');
      if (fileInput) fileInput.value = '';
      var fileInfo = document.getElementById('importFileInfo');
      if (fileInfo) fileInfo.classList.add('hidden');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Import'; }

    } catch (error) {
      console.error('[Reporting] Import failed:', error);
      if (errText) errText.textContent = error.message || 'Import failed. Please check the file format and try again.';
      if (errEl) errEl.classList.remove('hidden');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Import'; }
    }
  }

  // init runs twice on a first visit (the page, then the router); each
  // mount of the page binds its import controls once.
  function initImportControls() {
    var importBtn = document.getElementById('importReportBtn');
    if (!importBtn || importBtn.dataset.bound) return;
    importBtn.dataset.bound = 'true';
    importBtn.addEventListener('click', openImportModal);

    var newReportBtn = document.getElementById('newReportBtn');
    if (newReportBtn) {
      newReportBtn.addEventListener('click', openNewReport);
    }

    var dropZone = document.getElementById('importDropZone');
    var fileInput = document.getElementById('importFileInput');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', function () { fileInput.click(); });

      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          handleImportFileSelect(fileInput.files[0]);
        }
      });

      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--lex-border-accent, #6366f1)';
        dropZone.style.background = 'var(--lex-bg-accent-soft, #eef2ff)';
      });

      dropZone.addEventListener('dragleave', function () {
        dropZone.style.borderColor = '';
        dropZone.style.background = '';
      });

      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.style.borderColor = '';
        dropZone.style.background = '';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleImportFileSelect(e.dataTransfer.files[0]);
        }
      });
    }

    var clearBtn = document.getElementById('importFileClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearImportFile);
    }

    var submitBtn = document.getElementById('importSubmitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', submitImport);
    }
  }

  // Buttons in the import modal carry data-reporting-action; one document
  // listener runs them wherever Lex mounts the modal.
  var PAGE_ACTIONS = {
    'close-import': function () { closeImportModal(); }
  };

  function onPageAction(event) {
    var target = event.target;
    var el = target && target.closest ? target.closest('[data-reporting-action]') : null;
    if (!el) return;
    var run = PAGE_ACTIONS[el.getAttribute('data-reporting-action')];
    if (run) run(el);
  }

  // Scripts run once per app session (LexRouter); bind the listener once.
  var pageActionsBound = false;
  function initPageActions() {
    if (pageActionsBound) return;
    pageActionsBound = true;
    document.addEventListener('click', onPageAction);
  }

  function init() {
    initPageActions();
    initImportControls();
    loadReports();
  }

  if (typeof LexRouter !== 'undefined') {
    LexRouter.registerPageInit('admin/reports-list.html', init);
  }
  init();

})();

/* Report page (admin/report.html?report=<key> or ?saved=<id>): the report
   header, the date form (Quick Select Period, Start, End, Compare By), Run
   Report, results and drilldowns. A period in the URL (?period=, or ?start=
   and ?end=) runs the report at once. The list of reports is its own page
   (admin/reports-list.html); helpers both pages share live in
   reports-list.model.js (ReportsList).
*/

(function () {
  'use strict';

  // Shared with the other Reports page (reports-list.model.js).
  var ReportsList = window.ReportsList;

  // ==========================================================================
  // State
  // ==========================================================================

  // The one empty token for blank values (never N/A or a dash).
  var EMPTY = window.DataState.EMPTY_VALUE;

  var allModules = [];
  var selectedModuleKey = null;

  // Visualization state
  var currentDataSources = [];
  var currentMissingEntities = [];
  var currentModuleMetadata = null;
  var currentModuleConfig = null;
  // The plain days the report on screen ran for (null when it has none).
  // Drilldowns read these, not the date inputs, so a drilldown lists the
  // rows its tile counted even after the inputs change.
  var runPeriodDays = null;
  // What Export PDF and Export CSV export: the last run's metrics
  // ({ metrics }) or a saved report's rows ({ head, rows }); null until a
  // run produced data (setExportData).
  var exportData = null;
  var chartInstances = {};
  var drilldownRenderer = null;

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function showInfo(message) {
    var infoEl = document.getElementById('executionInfo');
    var infoTextEl = document.getElementById('executionInfoText');
    var errEl = document.getElementById('executionError');
    if (infoTextEl) infoTextEl.textContent = message;
    if (infoEl) infoEl.style.display = 'block';
    if (errEl) errEl.style.display = 'none';
  }

  function hideInfo() {
    var infoEl = document.getElementById('executionInfo');
    if (infoEl) infoEl.style.display = 'none';
  }

  function hideRunState() {
    var stateEl = document.getElementById('executionState');
    if (stateEl) { stateEl.hidden = true; stateEl.innerHTML = ''; }
  }

  function showError(message) {
    var errEl = document.getElementById('executionError');
    var errTextEl = document.getElementById('executionErrorText');
    var infoEl = document.getElementById('executionInfo');
    if (errTextEl) errTextEl.textContent = message;
    if (errEl) errEl.style.display = 'block';
    if (infoEl) infoEl.style.display = 'none';
    hideRunState();
  }

  function hideError() {
    var errEl = document.getElementById('executionError');
    if (errEl) errEl.style.display = 'none';
    hideRunState();
  }

  // A failed run: the backend's data state (DataState.fromApiError) as the
  // shared DataState block, else the error message.
  function showRunFailure(error) {
    var item = window.DataState.fromApiError(error);
    if (!item) {
      showError((error && error.message) || 'The report could not run. Please try again.');
      return;
    }
    hideError();
    hideInfo();
    var stateEl = document.getElementById('executionState');
    if (stateEl) {
      stateEl.innerHTML = window.DataState.render(item);
      stateEl.hidden = false;
    }
  }

  // Format currency
  function formatCurrency(value) {
    if (value === null || value === undefined) return EMPTY;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  // Format number
  function formatNumber(value, decimals) {
    if (decimals === undefined) decimals = 0;
    if (value === null || value === undefined) return EMPTY;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }

  // Format percentage
  function formatPercentage(value, decimals) {
    if (decimals === undefined) decimals = 1;
    if (value === null || value === undefined) return EMPTY;
    return formatNumber(value, decimals) + '%';
  }

  // Get status color based on target comparison
  function getStatusColor(current, target, inverseLogic) {
    if (current === null || current === undefined || target === null || target === undefined) {
      return 'gray';
    }
    var ratio = current / target;
    if (inverseLogic) {
      if (ratio <= 1.0) return 'green';
      if (ratio <= 1.2) return 'yellow';
      return 'red';
    } else {
      if (ratio >= 1.0) return 'green';
      if (ratio >= 0.8) return 'yellow';
      return 'red';
    }
  }

  // Get status colors for card background
  function getStatusColors(color) {
    var colors = {
      green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
      yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
      red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' },
      gray: { bg: 'bg-white', border: 'border-gray-100', text: 'text-gray-700' }
    };
    return colors[color] || colors.gray;
  }


  // ==========================================================================
  // Period Presets
  // ==========================================================================

  // Presets are the firm's days (the firm's zone, Lex.Utils.getFirmTimezone),
  // so everyone in the firm runs the same period; the backend bounds the
  // plain days in the same zone. A stored user without the firm's zone
  // refetches the profile first (api.ensureFirmTimezone).
  async function selectPeriodPreset(preset) {
    await api.ensureFirmTimezone();
    applyPeriodDays(LanaTime.reportPresetDays(preset, window.Lex.Utils.getFirmTimezone()), preset);
  }

  // Put plain days (inclusive end) in the period fields.
  function applyPeriodDays(days, preset) {
    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');
    if (periodStartEl) periodStartEl.value = days.start;
    if (periodEndEl) periodEndEl.value = days.end;

    updateCompareByOptions(dayStartDate(days.start), dayEndDate(days.end), preset);
    showInfo('Period set to: ' + days.start + ' to ' + days.end);
  }

  // A plain day as a Date for span math only (the whole day, end inclusive).
  function dayStartDate(day) { return new Date(day + 'T00:00:00Z'); }
  function dayEndDate(day) { return new Date(day + 'T23:59:59Z'); }

  // The days a run used as plain days (inclusive end): the days the
  // backend labels its period with, else the days the run sent. The backend
  // reads them as the firm's days.
  function runDaysFrom(period, sentStart, sentEnd) {
    var start = (period && period.startDate) || sentStart;
    var end = (period && period.endDate) || sentEnd;
    return start && end ? { periodStart: start, periodEnd: end } : null;
  }

  function updateCompareByOptions(startDate, endDate, preset) {
    var periodTypeEl = document.getElementById('periodType');
    if (!periodTypeEl) return;

    var currentValue = periodTypeEl.value;
    var durationMs = endDate - startDate;
    var durationDays = Math.ceil(durationMs / LanaTime.MS_PER_DAY);

    var labels = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
    var choice = ReportsList.compareByFor(durationDays, preset, currentValue);
    periodTypeEl.options = choice.options.map(function (value) { return { value: value, label: labels[value] }; });
    periodTypeEl.value = choice.value;
  }

  // Once per mount (init runs twice on a first visit, the page then the
  // router): the presets, the date fields and Run Report come together.
  function initPeriodControls() {
    var controls = document.getElementById('controlsCard');
    if (!controls || controls.dataset.bound) return;
    controls.dataset.bound = 'true';

    // Period preset buttons
    var presetsContainer = document.getElementById('periodPresets');
    if (presetsContainer) {
      presetsContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('lex-btn[data-preset]');
        if (!btn) return;
        selectPeriodPreset(btn.dataset.preset);
      });
    }

    // Date input change listeners
    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');

    if (periodStartEl) {
      periodStartEl.addEventListener('lex-change', function () {
        var startVal = periodStartEl.value;
        var endVal = periodEndEl ? periodEndEl.value : '';
        if (startVal && endVal) {
          updateCompareByOptions(dayStartDate(startVal), dayEndDate(endVal), null);
        }
      });
    }

    if (periodEndEl) {
      periodEndEl.addEventListener('lex-change', function () {
        var startVal = periodStartEl ? periodStartEl.value : '';
        var endVal = periodEndEl.value;
        if (startVal && endVal) {
          updateCompareByOptions(dayStartDate(startVal), dayEndDate(endVal), null);
        }
      });
    }

    // Execute button
    var executeBtn = document.getElementById('executeBtn');
    if (executeBtn) {
      executeBtn.addEventListener('click', function () {
        executeModule();
      });
    }

    // The period is set when the report loads (loadReport).
  }

  // ==========================================================================
  // Data Sources
  // ==========================================================================

  function updateDataSources(dataSources) {
    currentDataSources = dataSources || [];
    var count = currentDataSources.length;
    var countText = document.getElementById('dataSourcesCount');
    if (countText) {
      countText.textContent = count + ' Connector' + (count !== 1 ? 's' : '');
    }
  }

  function openDataSourcesModal() {
    var modal = document.getElementById('dataSourcesModal');
    var list = document.getElementById('dataSourcesList');
    if (!modal || !list) return;

    list.innerHTML = '';

    if (currentDataSources.length === 0) {
      list.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">No data sources found</p>';
    } else {
      // Each source leads with what it holds (its entities), then its name
      // and its last sync (ReportBuilder.dataSourceHtml).
      list.innerHTML = currentDataSources.map(function (source) { return window.ReportBuilder.dataSourceHtml(source); }).join('');
    }

    modal.classList.remove('hidden');
  }

  function closeDataSourcesModal() {
    var modal = document.getElementById('dataSourcesModal');
    if (modal) modal.classList.add('hidden');
  }

  // ==========================================================================
  // Missing Entities
  // ==========================================================================

  function updateMissingEntities(missingEntities) {
    currentMissingEntities = missingEntities || [];
    var count = currentMissingEntities.length;
    var missingBtn = document.getElementById('missingEntitiesBtn');
    var missingCountText = document.getElementById('missingEntitiesCount');

    if (missingBtn && missingCountText) {
      if (count > 0) {
        missingBtn.classList.remove('hidden');
        missingCountText.textContent = count + ' Missing';
      } else {
        missingBtn.classList.add('hidden');
      }
    }
  }

  function openMissingEntitiesModal() {
    var modal = document.getElementById('missingEntitiesModal');
    var list = document.getElementById('missingEntitiesList');
    if (!modal || !list) return;

    list.innerHTML = '';

    if (currentMissingEntities.length === 0) {
      list.innerHTML = '<tr><td colspan="3" class="px-4 py-8 text-center text-sm text-gray-500">No missing entities found. All required data is available.</td></tr>';
    } else {
      currentMissingEntities.forEach(function (entity) {
        var row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        row.innerHTML = '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-1 text-xs font-medium rounded bg-amber-100 text-amber-800">' + (entity.entity_type || '') + '</span></td>' +
          '<td class="px-4 py-3 text-sm text-gray-700">' + (entity.description || 'No description available') + '</td>' +
          '<td class="px-4 py-3"><span class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">Required</span></td>';
        list.appendChild(row);
      });
    }

    modal.classList.remove('hidden');
  }

  function closeMissingEntitiesModal() {
    var modal = document.getElementById('missingEntitiesModal');
    if (modal) modal.classList.add('hidden');
  }

  function updateMissingEntitiesForModule(moduleKey) {
    var module = null;
    for (var i = 0; i < allModules.length; i++) {
      if (allModules[i].moduleKey === moduleKey) {
        module = allModules[i];
        break;
      }
    }
    if (module && module.missingRequiredEntities) {
      updateMissingEntities(module.missingRequiredEntities);
    } else {
      updateMissingEntities([]);
    }
  }

  // ==========================================================================
  // Module Info Modal
  // ==========================================================================

  function showModuleInfo() {
    if (!currentModuleMetadata) {
      showError('Run a report first.');
      return;
    }
    var modal = document.getElementById('moduleInfoModal');
    if (!modal) return;

    document.getElementById('modalModuleName').textContent = currentModuleMetadata.moduleName;
    document.getElementById('modalModuleKey').textContent = currentModuleMetadata.moduleKey;
    document.getElementById('modalModuleDescription').textContent = currentModuleMetadata.description;
    document.getElementById('modalModuleVersion').textContent = currentModuleMetadata.version;
    document.getElementById('modalModuleMetrics').textContent = currentModuleMetadata.metricCount;
    document.getElementById('modalModuleCategory').textContent = currentModuleMetadata.category;

    var statusBadge = document.getElementById('modalModuleStatus');
    var status = currentModuleMetadata.status;
    statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    statusBadge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
    if (status === 'stable') {
      statusBadge.classList.add('bg-green-100', 'text-green-800');
    } else if (status === 'beta') {
      statusBadge.classList.add('bg-yellow-100', 'text-yellow-800');
    } else if (status === 'alpha') {
      statusBadge.classList.add('bg-orange-100', 'text-orange-800');
    } else if (status === 'deprecated') {
      statusBadge.classList.add('bg-red-100', 'text-red-800');
    } else {
      statusBadge.classList.add('bg-gray-100', 'text-gray-800');
    }

    modal.classList.remove('hidden');
  }

  function closeModuleInfo() {
    var modal = document.getElementById('moduleInfoModal');
    if (modal) modal.classList.add('hidden');
  }

  // ==========================================================================
  // Module Execution
  // ==========================================================================

  async function executeModule() {
    // If an imported report is selected, execute via V2 endpoint
    if (selectedImportedReportId) {
      await executeImportedReport();
      return;
    }

    if (!selectedModuleKey) {
      showError('Pick a report first.');
      return;
    }

    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');
    var periodTypeEl = document.getElementById('periodType');
    var executeBtn = document.getElementById('executeBtn');

    var startDate = periodStartEl ? periodStartEl.value : '';
    var endDate = periodEndEl ? periodEndEl.value : '';
    var periodType = (periodTypeEl && periodTypeEl.value) ? periodTypeEl.value : 'monthly';

    if (!startDate || !endDate) {
      showError('Please select a date range.');
      return;
    }

    // Validate date range
    var startDateObj = new Date(startDate);
    var endDateObj = new Date(endDate);
    if (startDateObj > endDateObj) {
      showError('Start date must be before end date');
      return;
    }

    // Loading state
    if (executeBtn) executeBtn.loading = true;
    hideError();
    showInfo('Running your report...');
    setExportData(null);

    // Hide previous results while loading
    var resultsEl = document.getElementById('moduleResults');
    if (resultsEl) resultsEl.style.display = 'none';

    try {
      // The edit-goal icon follows the backend's goal permission; have it
      // before the tiles render.
      if (window.Lex && Lex.Auth && typeof Lex.Auth.loadMetricGoalPermission === 'function') {
        await Lex.Auth.loadMetricGoalPermission();
      }

      var data = await api.post('/api/v1/modules/' + selectedModuleKey + '/execute', {
        periodType: periodType,
        // Plain days: the backend bounds them in the firm's zone.
        periodStart: startDate,
        periodEnd: endDate,
        compareBy: periodType,
        compareToPrevious: true,
        useCache: false
      });

      // Store module metadata for Learn More modal
      currentModuleMetadata = {
        moduleKey: selectedModuleKey,
        moduleName: data.moduleName || 'Module Results',
        description: data.moduleDescription || data.description || 'No description available',
        version: data.moduleVersion || data.version || '1.0.0',
        metricCount: data.metrics ? data.metrics.length : 0,
        category: data.moduleCategory || data.category || 'analytics',
        status: data.moduleStatus || data.status || 'stable'
      };

      // Store full module configuration
      currentModuleConfig = data;
      runPeriodDays = runDaysFrom(data.period, startDate, endDate);

      // Update module header
      var moduleTitleEl = document.getElementById('moduleTitle');
      if (moduleTitleEl) moduleTitleEl.textContent = data.moduleName || 'Report';

      // Update period info (ReportMetricCard.headerLabels: display label and UTC days)
      var header = window.ReportMetricCard.headerLabels(data);
      [['resultPeriodType', header.compareBy], ['resultCurrentPeriod', header.current], ['resultPriorPeriod', header.prior]]
        .forEach(function (pair) {
          var node = document.getElementById(pair[0]);
          if (node) node.textContent = pair[1];
        });

      // Update data sources
      updateDataSources(data.dataSources || []);

      // Render visualizations based on backend response (section-driven)
      renderVisualizations(data);
      setExportData(Array.isArray(data.metrics) && data.metrics.length ? { metrics: data.metrics } : null);

      // Hide placeholder, show results area
      var placeholder = document.getElementById('reportingPlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      if (resultsEl) resultsEl.style.display = 'flex';

      hideInfo();

    } catch (error) {
      console.error('[Reporting] Execution failed:', error);
      showRunFailure(error);
    } finally {
      if (executeBtn) executeBtn.loading = false;
    }
  }

  // ==========================================================================
  // Chart Rendering
  // ==========================================================================

  function renderMetricChart(metric, canvasId) {
    if (window.AcquisitionSourcePresentation && window.AcquisitionSourcePresentation.isAcquisitionSource(metric)) return;
    if (window.OpportunityIntakePresentation && window.OpportunityIntakePresentation.isOpportunityIntake(metric)) return;
    if (window.CurrentPipelinePresentation && window.CurrentPipelinePresentation.isCurrentPipeline(metric)) return;
    if (!Array.isArray(metric.current)) {
      renderEmptyState(canvasId, 'No distribution data available');
      return;
    }

    var ctx = document.getElementById(canvasId);
    if (!ctx) return;
    ctx = ctx.getContext('2d');

    if (window.metricCharts && window.metricCharts[canvasId]) {
      window.metricCharts[canvasId].destroy();
    }

    var sortedData = metric.current.slice().sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    var labels = sortedData.map(function (item) { return item.label || 'Unknown'; });
    // Gaps stay gaps (js/shared/chart-points.js): no bar, no made-up 0%.
    var counts = sortedData.map(function (item) { return window.ChartPoints.value(item.count); });
    var percentages = sortedData.map(function (item) { return window.ChartPoints.value(item.value); });

    var backgroundColors = labels.map(function (_, i) {
      var intensity = 1 - (i / labels.length) * 0.5;
      return 'rgba(99, 102, 241, ' + intensity + ')';
    });

    var maxCount = Math.max.apply(null, counts.map(function (n) { return n || 0; }));

    var chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Leads',
          data: counts,
          backgroundColor: backgroundColors,
          borderWidth: 0,
          barPercentage: 0.8,
          categoryPercentage: 0.9
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                var count = context.parsed.x || 0;
                var percentage = percentages[context.dataIndex];
                return count + ' leads' + (percentage === null ? '' : ' (' + percentage + '%)');
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: Math.ceil(maxCount * 1.1),
            ticks: { precision: 0 },
            grid: { display: true, color: '#f3f4f6' }
          },
          y: {
            grid: { display: false },
            ticks: {
              callback: function (value, index) {
                var label = labels[index];
                return label && label.length > 25 ? label.substring(0, 25) + '...' : label;
              }
            }
          }
        },
        onClick: function (event, elements) {
          if (elements.length > 0) {
            var index = elements[0].index;
            var source = labels[index];
            showLeadSourceDrilldown(metric.key, source);
          }
        }
      }
    });

    if (!window.metricCharts) window.metricCharts = {};
    window.metricCharts[canvasId] = chart;
  }

  function renderEmptyState(canvasId, message) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d1d5db';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
  }

  // ==========================================================================
  // Drilldown System
  // ==========================================================================

  // The drilldown lex-modal: set its heading and open it.
  function openDrilldownModal(heading) {
    var modal = document.getElementById('drilldownModal');
    var content = document.getElementById('drilldownContent');
    if (!modal || !content) return null;
    modal.heading = heading || 'Details';
    modal.open = true;
    return content;
  }

  async function showLeadSourceDrilldown(metricKey, source) {
    var content = openDrilldownModal('Leads from: ' + source);
    if (!content) return;
    content.innerHTML = '<div class="text-center py-8"><lex-spinner></lex-spinner><p class="text-gray-600 mt-4">Loading leads...</p></div>';

    try {
      // Connector rows are read by instant: the run's own window (the
      // backend's firm-zone bounds), so the list matches the tile.
      var period = (currentModuleConfig && currentModuleConfig.period) || {};
      var tables = window.ReportingTables;
      var result = await tables.loadAllLeads(function (url) { return api.get(url); }, source, period.start, period.end);

      tables.mountClientTable(content, {
        id: 'reportingLeadsTable',
        title: 'Leads',
        noun: ['lead', 'leads'],
        columns: tables.LEAD_TABLE.columns,
        labels: tables.LEAD_TABLE.labels,
        rows: result.rows,
        renderers: tables.leadRenderers(),
        filterOptions: tables.leadFilterOptions(),
        sortBy: 'created_at',
        sortDir: 'desc',
        idKey: 'id',
        emptyText: 'No leads found for this source in the period',
        ariaLabel: 'Leads from ' + source,
        search: true,
        note: result.truncated
          ? 'Showing the newest ' + result.rows.length.toLocaleString() + ' leads. Narrow the period to see older ones.'
          : ''
      });
    } catch (error) {
      console.error('Failed to load lead source drilldown:', error);
      content.innerHTML = '<div class="text-center py-8 text-red-600">Failed to load leads: ' + escapeHtml(error.message || 'Unknown error') + '</div>';
    }
  }

  // The module whose results are on screen: the execute response declares
  // it (moduleKey). Drilldowns never guess a report.
  function resultModuleKey() {
    return (currentModuleConfig && currentModuleConfig.moduleKey) || selectedModuleKey || null;
  }

  async function openGenericDrilldown(metricKey, metricName) {
    var moduleKey = resultModuleKey();
    var days = runPeriodDays;
    if (!moduleKey || !days) {
      Lex.Modal.alert('Details unavailable', 'Run a report first, then open its details.');
      return;
    }
    try {

      if (!drilldownRenderer) {
        drilldownRenderer = new DrilldownRenderer();
        window.drilldownRenderer = drilldownRenderer;
      }

      await drilldownRenderer.open(moduleKey, metricKey, {
        periodStart: days.periodStart,
        periodEnd: days.periodEnd
      });
    } catch (error) {
      console.error('Failed to open drilldown:', error);
      Lex.Modal.alert('Drilldown unavailable', escapeHtml('Failed to load drilldown: ' + (error.message || 'Unknown error')));
    }
  }

  function closeDrilldownModal() {
    var modal = document.getElementById('drilldownModal');
    if (modal) modal.open = false;
  }

  // metricKey: the metric the funnel visualization declares (viz.metrics).
  async function showFunnelStageDrilldown(stageInfo, metricKey) {
    var moduleKey = resultModuleKey();
    var days = runPeriodDays;
    if (!moduleKey || !metricKey || !days) return;
    try {
      var pipelineId = stageInfo.pipeline_id;
      var position = stageInfo.position !== undefined ? stageInfo.position : 0;
      if (!drilldownRenderer) {
        drilldownRenderer = new DrilldownRenderer();
        window.drilldownRenderer = drilldownRenderer;
      }

      await drilldownRenderer.open(moduleKey, metricKey, {
        periodStart: days.periodStart,
        periodEnd: days.periodEnd,
        drill_source: stageInfo.label || '',
        pipeline_id: pipelineId || '',
        position: position
      });
    } catch (error) {
      console.error('Failed to open funnel drilldown:', error);
      // Fallback to simple modal if DrilldownRenderer fails
      var content = openDrilldownModal((stageInfo.pipelineName ? stageInfo.pipelineName + ': ' : '') + (stageInfo.label || 'Stage'));
      if (content) {
        content.innerHTML = '<div class="text-center py-8 text-red-600">Failed to load drilldown: ' + escapeHtml(error.message || 'Unknown error') + '</div>';
      }
    }
  }


  async function tryGenericDrilldown(content, moduleKey, metricKey, periodStart, periodEnd) {
    try {
      if (!window.drilldownRenderer) {
        window.drilldownRenderer = drilldownRenderer || new DrilldownRenderer();
        drilldownRenderer = window.drilldownRenderer;
      }
      await window.drilldownRenderer.open(moduleKey, metricKey, {
        periodStart: periodStart,
        periodEnd: periodEnd,
        organizationId: api.user.organization_id
      });
      return true;
    } catch (error) {
      if ((error.response && error.response.status === 404) || error.status === 404) {
        console.log('[Drilldown] Generic drilldown not available for ' + metricKey + ', falling back to legacy');
        return false;
      }
      console.error('[Drilldown] Error loading generic drilldown:', error);
      return false;
    }
  }

  async function showMetricDrilldown(metricKey, metricName) {
    var content = document.getElementById('drilldownContent');
    if (!content) return;

    try {
      var days = runPeriodDays;
      var moduleKey = resultModuleKey();

      var hasGenericDrilldown = moduleKey && days
        ? await tryGenericDrilldown(content, moduleKey, metricKey, days.periodStart, days.periodEnd)
        : false;
      if (hasGenericDrilldown) return;

      // Default: drill-down not available for legacy metrics
      openDrilldownModal(metricName + ' - Details');
      content.innerHTML = '<div class="text-center py-8 text-gray-500">Drill-down not available for this metric.</div>';

    } catch (error) {
      console.error('Failed to load metric drilldown:', error);
      openDrilldownModal(metricName + ' - Details');
      content.innerHTML = '<div class="text-center py-8 text-red-600">Failed to load data: ' + escapeHtml(error.message || 'Unknown error') + '</div>';
    }
  }

  // ==========================================================================
  // Markdown Helpers
  // ==========================================================================

  function renderMarkdownInline(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);
    // Model text: marked plus the LanaSafeHtml markdown allowlist.
    return window.LanaSafeHtml ? window.LanaSafeHtml.renderMarkdown(text, { inline: true, breaks: true }) : escapeMarkdownFallback(text);
  }

  function escapeMarkdownFallback(text) {
    return String(text).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
      .split('"').join('&quot;').split("'").join('&#39;');
  }

  function renderMarkdownBlock(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);
    // Model text: marked plus the LanaSafeHtml markdown allowlist.
    return window.LanaSafeHtml ? window.LanaSafeHtml.renderMarkdown(text, { unwrapParagraph: true, breaks: true }) : escapeMarkdownFallback(text).split('\n').join('<br>');
  }

  function renderHelpTextModal(helpText, uniqueId) {
    if (!helpText || !helpText.sections || helpText.sections.length === 0) return '';

    var modalId = 'help-modal-' + uniqueId;

    var sectionsHTML = helpText.sections.map(function (section) {
      var contentHTML = '';
      if (section.content) {
        contentHTML = '<div class="text-sm text-gray-700 leading-relaxed">' + renderMarkdownBlock(section.content) + '</div>';
      }
      if (section.bullets && section.bullets.length > 0) {
        var bulletsHTML = section.bullets.map(function (bullet) {
          return '<li class="text-sm text-gray-700 leading-relaxed">' + renderMarkdownInline(bullet) + '</li>';
        }).join('');
        contentHTML = '<ul class="list-disc pl-5 space-y-2">' + bulletsHTML + '</ul>';
      }
      return '<div class="mb-6"><h4 class="text-md font-semibold text-gray-900 mb-3">' + renderMarkdownInline(section.heading) + '</h4>' + contentHTML + '</div>';
    }).join('');

    return '<button type="button" data-reporting-action="show-help" data-help-modal="' + modalId + '" class="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors" title="Click for help understanding this chart">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>' +
      '<div id="' + modalId + '" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">' +
      '<div class="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">' +
      '<div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">' +
      '<h3 class="text-xl font-bold text-gray-900">' + escapeHtml(helpText.title || 'Help') + '</h3>' +
      '<button type="button" data-reporting-action="hide-help" data-help-modal="' + modalId + '" class="text-gray-400 hover:text-gray-600 transition-colors">' +
      '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div>' +
      '<div class="px-6 py-6">' + sectionsHTML + '</div>' +
      '<div class="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4">' +
      '<button type="button" data-reporting-action="hide-help" data-help-modal="' + modalId + '" class="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium">Got it!</button></div></div></div>';
  }

  // ==========================================================================
  // Metric Card Rendering
  // ==========================================================================

  // Per-render registry of metrics so the info button handler can look
  // up description/helpText without round-tripping through DOM attributes.
  var _metricInfoRegistry = Object.create(null);

  var escapeHtml = ReportsList.escapeHtml;

  // Admin-only edit-goal icon: deep-links to the Metric Catalog goal editor.
  function editGoalButtonHTML(metric) {
    if (!isReportingGoalAdmin()) return '';
    return '<button type="button" aria-label="Edit goal" title="Edit goal" ' +
      'data-metric-edit-goal="' + escapeHtml(metric.key) + '" ' +
      'class="text-gray-400 hover:text-indigo-600 transition-colors">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>' +
      '</svg></button>';
  }

  function infoIconButtonHTML(metric) {
    if (!metric || !metric.key) return '';
    _metricInfoRegistry[metric.key] = {
      name: metric.name || metric.key,
      description: metric.description || '',
      helpText: metric.helpText || null
    };
    return '<button type="button" aria-label="About this metric" title="About this metric" ' +
      'data-metric-info="' + escapeHtml(metric.key) + '" ' +
      'class="text-gray-400 hover:text-indigo-600 transition-colors">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
      '</svg></button>';
  }

  // Renders the four-section info modal: Description, Help, Data Sources, How
  // It's Calculated. `entry` is the locally-cached basics (name + description +
  // helpText). `detail` is the optional fully-resolved catalog entry from
  // /api/v1/modules/metric-catalog/<key> with `entities`, `calculation`, and
  // `businessLogic`. When `detail` is null we render a loading skeleton in the
  // last two sections, then re-render once the fetch resolves.
  function renderMetricInfoBody(entry, detail) {
    var parts = [];

    // 1. Description.
    if (entry.description) {
      parts.push('<p class="reporting-info__lead">' +
        escapeHtml(entry.description) + '</p>');
    }

    // 2. Help text (structured).
    if (entry.helpText && Array.isArray(entry.helpText.paragraphs) && entry.helpText.paragraphs.length) {
      if (entry.helpText.title) {
        parts.push('<h4 class="reporting-info__heading reporting-info__heading--first">' +
          escapeHtml(entry.helpText.title) + '</h4>');
      }
      for (var i = 0; i < entry.helpText.paragraphs.length; i++) {
        parts.push('<p class="reporting-info__text">' +
          escapeHtml(entry.helpText.paragraphs[i]) + '</p>');
      }
    }

    // 3. Business logic prose (if present in the catalog entry).
    var bizLogic = detail && detail.businessLogic;
    if (bizLogic && String(bizLogic).trim().length > 0) {
      parts.push('<h4 class="reporting-info__heading">Business logic</h4>');
      parts.push('<p class="reporting-info__text">' +
        escapeHtml(bizLogic) + '</p>');
    }

    // 4. Data sources (entities + fields).
    parts.push('<h4 class="reporting-info__heading">Data sources</h4>');
    if (!detail) {
      parts.push('<p class="reporting-info__muted reporting-info__muted--loading">Loading…</p>');
    } else if (Array.isArray(detail.entities) && detail.entities.length > 0) {
      for (var j = 0; j < detail.entities.length; j++) {
        var ent = detail.entities[j];
        parts.push(
          '<div class="reporting-info__entity">' +
            '<div class="reporting-info__entity-name">' +
              escapeHtml(ent.entity_type || '(unknown entity)') +
            '</div>' +
            (ent.description ? '<div class="reporting-info__entity-desc">' + escapeHtml(ent.description) + '</div>' : '') +
            (Array.isArray(ent.fields) && ent.fields.length
              ? '<div class="reporting-info__entity-fields">' +
                ent.fields.map(escapeHtml).join(', ') +
                '</div>'
              : '') +
          '</div>'
        );
      }
    } else {
      parts.push('<p class="reporting-info__muted">No data sources declared.</p>');
    }

    // 5. How it's calculated (calculation shape).
    parts.push('<h4 class="reporting-info__heading">How it\'s calculated</h4>');
    if (!detail) {
      parts.push('<p class="reporting-info__muted reporting-info__muted--last reporting-info__muted--loading">Loading…</p>');
    } else {
      var calc = detail.calculation || {};
      if (typeof calc.ref === 'string' && calc.ref) {
        parts.push(
          '<p class="reporting-info__calc-intro">Resolves to the central registry executor:</p>' +
          '<code class="reporting-info__code">' +
            escapeHtml(calc.ref) +
          '</code>'
        );
      } else if (calc.spec && typeof calc.spec === 'object') {
        parts.push(
          '<p class="reporting-info__calc-intro">Computed from an inline spec:</p>' +
          '<pre class="reporting-info__pre">' +
            escapeHtml(JSON.stringify(calc.spec, null, 2)) +
          '</pre>'
        );
      } else if (typeof calc.query === 'string' && calc.query) {
        parts.push(
          '<p class="reporting-info__calc-intro">Inline SQL query (read-only):</p>' +
          '<pre class="reporting-info__pre reporting-info__pre--tall">' +
            escapeHtml(calc.query) +
          '</pre>'
        );
      } else {
        parts.push('<p class="reporting-info__muted reporting-info__muted--last">Calculation details not declared.</p>');
      }
    }

    return parts.join('');
  }

  function openMetricInfo(metricKey) {
    var entry = _metricInfoRegistry[metricKey];
    if (!entry) return;

    // lex-modal.js loads with the page; without it there is nowhere to show the info.
    if (!(window.Lex && window.Lex.Modal && typeof window.Lex.Modal.open === 'function')) return;

    // Open the modal immediately with the loading skeleton so the UI feels
    // responsive even if the catalog fetch takes a beat.
    var modal = window.Lex.Modal.open({
      heading: entry.name,
      content: '<div data-metric-info-root>' + renderMetricInfoBody(entry, null) + '</div>',
      size: 'md',
      hideActions: true
    });

    // Fetch full catalog entry to populate entities + calculation. Cached on
    // the registry entry so subsequent opens skip the network.
    var finalize = function (detail) {
      entry.detail = detail;
      var body = renderMetricInfoBody(entry, detail);
      // Update ONLY our own content root inside the modal. Setting
      // modal.innerHTML would wipe the lex-modal's chrome (the "flash" on
      // open), and the component's internal body class is not public API.
      var bodyEl = modal && typeof modal.querySelector === 'function' ? modal.querySelector('[data-metric-info-root]') : null;
      if (bodyEl) {
        bodyEl.innerHTML = body;
      }
    };

    if (entry.detail) {
      finalize(entry.detail);
      return;
    }

    if (window.api && typeof window.api.get === 'function') {
      window.api.get('/api/v1/modules/metric-catalog/' + encodeURIComponent(metricKey))
        .then(function (res) {
          var detail = (res && (res.data || res)) || null;
          finalize(detail || { entities: [], calculation: null, businessLogic: null });
        })
        .catch(function () {
          finalize({ entities: [], calculation: null, businessLogic: null });
        });
    } else {
      finalize({ entities: [], calculation: null, businessLogic: null });
    }
  }

  function createDistributionMetricCard(metric) {
    var canvasId = 'chart-' + metric.key;
    var statusColor = metric.status || 'gray';
    var totalCount = 0;
    if (Array.isArray(metric.current)) {
      totalCount = metric.current.reduce(function (sum, item) { return sum + (item.count || 0); }, 0);
    }
    var statusColors = getStatusColors(statusColor);

    return '<div class="' + statusColors.bg + ' rounded-xl shadow-sm border ' + statusColors.border + ' p-6 hover:shadow-md transition-shadow">' +
      '<div class="flex items-start justify-between mb-4"><div class="flex-1">' +
      '<h3 class="text-sm font-medium text-gray-500 uppercase tracking-wide">' + escapeHtml(metric.name) + '</h3>' +
      '<p class="text-xs text-indigo-600 mt-2 font-medium">Click any bar to see actual leads</p></div>' +
      '<div class="flex items-center gap-2">' + infoIconButtonHTML(metric) + '</div></div>' +
      '<div class="mb-4"><p class="text-xs text-gray-500 mb-1">Total Leads</p>' +
      '<p class="text-2xl font-bold text-gray-900">' + formatNumber(totalCount, 0) + '</p></div>' +
      '<div class="mb-4"><canvas id="' + canvasId + '" class="reporting-chart-canvas"></canvas></div></div>';
  }

  // Only people the backend lets set goals see the edit-goal icon
  // (Lex.Auth.canEditMetricGoals, loaded from the backend before tiles render).
  function isReportingGoalAdmin() {
    return !!(window.Lex && Lex.Auth && typeof Lex.Auth.canEditMetricGoals === 'function'
      && Lex.Auth.canEditMetricGoals());
  }

  // Admin-only: deep-link to the Metric Catalog with the goal editor open for
  // this metric. The module is passed so the catalog resolves the correct
  // metric when a bare key is shared across modules.
  function editMetricGoal(metricKey) {
    if (!metricKey) return;
    var qs = 'editGoal=' + encodeURIComponent(metricKey);
    if (selectedModuleKey) qs += '&module=' + encodeURIComponent(selectedModuleKey);
    var target = 'admin/metric-catalog.html?' + qs;
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
      Lex.Nav.go(target);
    } else {
      window.location.href = target;
    }
  }

  // A result tile that names a catalog key offers Add to dashboard in its
  // footer (DashboardTiles); the key comes from the backend, never the page.
  function createMetricCard(metric) {
    return renderMetricCardBody(metric);
  }

  function metricCardContext(metric) {
    return {
      goalPeriod: (document.getElementById('periodType') || {}).value || 'monthly',
      footerStart: infoIconButtonHTML(metric) + editGoalButtonHTML(metric),
      footerEnd: metric.catalogKey
        ? '<lex-btn variant="ghost" size="sm" data-add-to-dashboard="' + escapeHtml(metric.catalogKey)
          + '" data-metric-name="' + escapeHtml(metric.name || '') + '">Add to dashboard</lex-btn>'
        : ''
    };
  }

  function renderMetricCardBody(metric) {
    // Any tile whose result is not ok shows the shared state block.
    if (window.DataState.isProblem(metric)) return window.ReportMetricCard.render(metric, metricCardContext(metric));
    var intake = window.OpportunityIntakePresentation && window.OpportunityIntakePresentation.renderCard(metric);
    if (intake) return intake;
    var acquisition = window.AcquisitionSourcePresentation && window.AcquisitionSourcePresentation.renderCard(metric);
    if (acquisition) return acquisition;
    var pipeline = window.CurrentPipelinePresentation && window.CurrentPipelinePresentation.renderCard(metric);
    if (pipeline) return pipeline;
    if (Array.isArray(metric.current)) {
      return createDistributionMetricCard(metric);
    }

    return window.ReportMetricCard.render(metric, metricCardContext(metric));
  }

  // Generic shrink-to-fit: walks every element with `data-fit-text="MAX:MIN:LINES"`
  // and reduces its font-size 1px at a time until its scrollHeight fits within
  // LINES * line-height, OR it hits the MIN floor. When LINES === 1 we also
  // shrink as long as scrollWidth exceeds clientWidth (text was clipped by
  // overflow:hidden on a single line).
  function fitMetricCardText(card) {
    if (!card) return;
    var els = card.querySelectorAll('[data-fit-text]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var spec = (el.getAttribute('data-fit-text') || '').split(':');
      var max = parseInt(spec[0], 10) || 14;
      var min = parseInt(spec[1], 10) || 10;
      var lines = parseInt(spec[2], 10) || 1;
      el.style.fontSize = max + 'px';
      var lineHeight = parseFloat(getComputedStyle(el).lineHeight) || (max * 1.2);
      var targetHeight = Math.ceil(lineHeight * lines) + 1;
      var size = max;
      while (size > min) {
        var heightOk = el.scrollHeight <= targetHeight;
        var widthOk = (lines !== 1) || (el.scrollWidth <= el.clientWidth + 1);
        if (heightOk && widthOk) break;
        size -= 1;
        el.style.fontSize = size + 'px';
      }
    }
  }

  function fitAllMetricCardText(grid) {
    var cards = grid.querySelectorAll('[data-metric-card]');
    for (var i = 0; i < cards.length; i++) fitMetricCardText(cards[i]);
  }

  function renderMetrics(metrics) {
    var grid = document.getElementById('metricsGrid');
    if (!grid) return;
    grid.innerHTML = metrics.map(function (metric) { return createMetricCard(metric); }).join('');
    if (window.CurrentPipelinePresentation) window.CurrentPipelinePresentation.bindDetails(grid, openGenericDrilldown);
    if (window.AcquisitionSourcePresentation) window.AcquisitionSourcePresentation.bindDetails(grid, openGenericDrilldown);
    if (window.OpportunityIntakePresentation) window.OpportunityIntakePresentation.bindDetails(grid, openGenericDrilldown);

    requestAnimationFrame(function () { fitAllMetricCardText(grid); });

    setTimeout(function () {
      metrics.forEach(function (metric) {
        if (Array.isArray(metric.current)) {
          renderMetricChart(metric, 'chart-' + metric.key);
        }
      });
    }, 100);
  }

  // ==========================================================================
  // The report: which one (?report=<key> or ?saved=<id>) and the period to
  // run (?period=<preset>, or ?start= and ?end=) come from the page URL.
  // With a period, the page runs the report at once.
  // ==========================================================================

  // init() runs twice on a first visit (the script itself, then the router,
  // which by then has the route's params); only the latest load goes on.
  var loadRequest = 0;

  async function loadReport() {
    var request = ++loadRequest;
    var params = window.Lex && Lex.Nav ? Lex.Nav.getParams() : new URLSearchParams(window.location.search);
    var asked = ReportsList.reportRequest(params);
    var catalog;
    try {
      catalog = await ReportsList.loadCatalog(api);
    } catch (error) {
      if (request !== loadRequest) return;
      console.error('[Report] Failed to load reports:', error);
      showError('This report could not load. Please refresh the page.');
      return;
    }
    if (request !== loadRequest) return;
    allModules = catalog.modules;
    importedReports = catalog.saved;
    var entry = asked.id && findReportEntry(asked.id);
    if (!entry) {
      showError('This report could not be found. Pick one from All reports.');
      return;
    }
    openReport(entry);
    if (asked.period && asked.period.preset) await selectPeriodPreset(asked.period.preset);
    else if (asked.period) applyPeriodDays(asked.period, null);
    else await selectPeriodPreset('last7days');
    if (request !== loadRequest) return;
    if (asked.period) executeModule();
  }

  function findReportEntry(id) {
    return ReportsList.findEntry(allModules, importedReports, id);
  }

  function openReport(entry) {
    if (entry.kind === 'saved') selectImportedReport(entry.key);
    else selectModule(entry.key);

    // The banner and breadcrumb escape what they render.
    var banner = document.getElementById('reportBanner');
    var breadcrumb = document.getElementById('reportBreadcrumb');
    var savedBadge = document.getElementById('selectedReportSavedBadge');
    if (banner) {
      banner.heading = entry.name;
      banner.subtitle = entry.purpose || '';
    }
    if (breadcrumb) breadcrumb.items = [{ label: 'Reports', href: ReportsList.LIST_PAGE }, { label: entry.name }];
    if (savedBadge) savedBadge.hidden = !entry.saved;
    renderReportSwitcher(entry);
    setExportData(null);

    var results = document.getElementById('moduleResults');
    var placeholder = document.getElementById('reportingPlaceholder');
    if (results) results.style.display = 'none';
    if (placeholder) placeholder.style.display = '';
    hideInfo();
    hideError();
  }

  // The shell title switches to another shown report (as the dashboard
  // detail page switches dashboards).
  function renderReportSwitcher(current) {
    var entries = ReportsList.buildReportEntries(allModules, importedReports);
    window.TitleSwitcher.render({
      id: 'reportSwitcher',
      placeholder: 'Search reports...',
      value: current.id,
      options: entries.map(function (entry) {
        return { value: entry.id, label: entry.name, description: entry.purpose || '' };
      }),
      onPick: function (id) {
        var picked = findReportEntry(id);
        if (picked) Lex.Nav.go(ReportsList.reportHref(picked));
      }
    });
  }

  // The shell Back opens the list page.
  function goToList() {
    Lex.Nav.go(ReportsList.LIST_PAGE);
  }

  function onShellBack(event) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    goToList();
  }

  // While this page shows, the shell Back goes to the list; the listener is
  // removed when the router leaves the page.
  var shellBackBound = false;
  function bindShellBack() {
    if (shellBackBound) return;
    shellBackBound = true;
    document.addEventListener('topbar-back-click', onShellBack, true);
    if (typeof LexRouter !== 'undefined' && typeof LexRouter.registerView === 'function') {
      LexRouter.registerView({
        onLeave: function () {
          document.removeEventListener('topbar-back-click', onShellBack, true);
          shellBackBound = false;
        }
      });
    }
  }

  function selectModule(moduleKey) {
    selectedImportedReportId = null;
    selectedModuleKey = moduleKey;
    showCustomizeButton();
    updateMissingEntitiesForModule(moduleKey);
    syncDeleteReportButton();
  }

  // A firm's own saved report (not a template) can be deleted: the banner's
  // menu shows Delete report while one is open (a class on the banner host,
  // which keeps it when the banner re-renders its action copies).
  function selectedSavedReport() {
    return selectedImportedReportId && importedReports.find(function (r) {
      return r.report_id === selectedImportedReportId;
    });
  }

  function syncDeleteReportButton() {
    var banner = document.getElementById('reportBanner');
    var report = selectedSavedReport();
    if (banner) banner.classList.toggle('report-banner--deletable', !!report && !report.is_template);
  }

  function deleteSelectedReport() {
    var report = selectedSavedReport();
    if (report && !report.is_template) deleteImportedReport(report.report_id, report.name);
  }

  // ==========================================================================
  // Section-Based Visualization Rendering
  // ==========================================================================

  function renderVisualizations(data) {
    var container = document.getElementById('visualizationsContainer');
    if (!container) return;

    Object.keys(chartInstances).forEach(function (key) {
      var instance = chartInstances[key];
      if (instance && typeof instance.destroy === 'function') {
        instance.destroy();
      }
    });
    chartInstances = {};
    container.innerHTML = '';

    // Section order + titles come from the module's ui.sections[]. Falls back
    // to legacy hardcoded keys for older modules that don't declare sections
    // (primary/secondary/trends). Any visualization with an unknown section key
    // is dropped into 'trends' for back-compat.
    var declaredSections = (data.ui && Array.isArray(data.ui.sections))
      ? data.ui.sections
      : (data.config && data.config.ui && Array.isArray(data.config.ui.sections) ? data.config.ui.sections : []);

    var orderedSectionKeys = declaredSections.length
      ? declaredSections.map(function (s) { return s.key; })
      : ['primary', 'secondary', 'trends'];

    var sectionMeta = {};
    declaredSections.forEach(function (s) { sectionMeta[s.key] = s; });

    var visualizationsBySection = {};
    orderedSectionKeys.forEach(function (k) { visualizationsBySection[k] = []; });

    (data.visualizations || []).forEach(function (viz) {
      var section = viz.section || orderedSectionKeys[orderedSectionKeys.length - 1] || 'trends';
      if (!visualizationsBySection[section]) visualizationsBySection[section] = [];
      visualizationsBySection[section].push(viz);
    });

    orderedSectionKeys.forEach(function (sectionName) {
      var visualizations = visualizationsBySection[sectionName];
      if (visualizations && visualizations.length > 0) {
        renderSection(sectionName, visualizations, data, container, sectionMeta[sectionName]);
      }
    });
  }

  function renderSection(sectionName, visualizations, data, container, meta) {
    var sectionDiv = document.createElement('div');
    sectionDiv.className = 'mb-8';
    sectionDiv.id = 'section-' + sectionName;

    // Title block — pulled from ui.sections[].title/description when declared.
    // Falls back to a built-in "Trends & Comparisons" treatment for the legacy
    // 'trends' key so older modules that don't declare sections still look the
    // same. Other unnamed sections render with no title block.
    if (meta && (meta.title || meta.description)) {
      var titleDiv = document.createElement('div');
      titleDiv.className = 'mb-6';
      var titleHTML = '';
      if (meta.title) {
        titleHTML += '<h3 class="text-2xl font-bold text-gray-900">' + escapeHtml(meta.title) + '</h3>';
      }
      if (meta.description) {
        titleHTML += '<p class="mt-1 text-sm text-gray-600">' + escapeHtml(meta.description) + '</p>';
      }
      titleDiv.innerHTML = titleHTML;
      sectionDiv.appendChild(titleDiv);
    } else if (sectionName === 'trends') {
      var legacyDiv = document.createElement('div');
      legacyDiv.className = 'mb-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-6 border border-indigo-100';
      legacyDiv.innerHTML = '<h3 class="text-2xl font-bold text-gray-900 mb-3">Trends &amp; Comparisons</h3>' +
        '<div class="space-y-3 text-sm text-gray-700">' +
        '<p class="leading-relaxed"><strong>What you are looking at:</strong> These charts compare your current period performance to the previous period.</p>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">' +
        '<div class="bg-white rounded-lg p-4 shadow-sm"><div class="flex items-center gap-2 mb-2"><span class="w-4 h-4 rounded bg-blue-500"></span><strong class="text-blue-700">Blue bars = Current Period</strong></div><p class="text-xs text-gray-600">This is your performance RIGHT NOW.</p></div>' +
        '<div class="bg-white rounded-lg p-4 shadow-sm"><div class="flex items-center gap-2 mb-2"><span class="w-4 h-4 rounded bg-gray-400"></span><strong class="text-gray-700">Gray bars = Prior Period</strong></div><p class="text-xs text-gray-600">This is your performance BEFORE.</p></div>' +
        '</div></div>';
      sectionDiv.appendChild(legacyDiv);
    }

    visualizations.forEach(function (viz, index) {
      var vizElement = renderVisualization(viz, data, sectionName + '-' + index);
      if (vizElement) sectionDiv.appendChild(vizElement);
    });

    container.appendChild(sectionDiv);
  }

  function renderVisualization(viz, data, uniqueId) {
    var intake = window.OpportunityIntakePresentation && window.OpportunityIntakePresentation.visualization(viz, data,
      function (sibling) { return renderVisualization(sibling, data, uniqueId); }, openGenericDrilldown);
    if (intake) return intake;
    var acquisition = window.AcquisitionSourcePresentation && window.AcquisitionSourcePresentation.visualization(viz, data,
      function (sibling) { return renderVisualization(sibling, data, uniqueId); }, openGenericDrilldown);
    if (acquisition) return acquisition;
    var pipeline = window.CurrentPipelinePresentation && window.CurrentPipelinePresentation.visualization(viz, data,
      function (sibling) { return renderVisualization(sibling, data, uniqueId); }, openGenericDrilldown);
    if (pipeline) return pipeline;
    switch (viz.type) {
      case 'metric_grid': return renderMetricGrid(viz, uniqueId);
      case 'time_series':
      case 'trend_chart':
      case 'line_chart': return renderTrendChart(viz, data, uniqueId);
      case 'comparison_chart': return renderComparisonChart(viz, data, uniqueId);
      case 'pie_chart': return renderPieChart(viz, data, uniqueId);
      case 'funnel_chart': return renderFunnelChart(viz, data, uniqueId);
      case 'funnel_insight_panels': return renderFunnelInsightPanels(viz, data, uniqueId);
      case 'bubble_chart': return renderBubbleChart(viz, data, uniqueId);
      case 'grouped_bar_chart': return renderGroupedBarChart(viz, data, uniqueId);
      case 'bar_chart':
      case 'horizontal_bar_chart': return renderHorizontalBarChart(viz, data, uniqueId);
      case 'attribution_summary': return renderAttributionSummary(viz, data, uniqueId);
      case 'table': return renderTable(viz, data, uniqueId);
      default:
        console.warn('[Reporting] Unknown visualization type:', viz.type);
        return renderPlaceholderChart(viz, uniqueId);
    }
  }

  function renderMetricGrid(viz, uniqueId) {
    var div = document.createElement('div');
    div.className = 'mb-6';
    var grid = document.createElement('div');
    // Container-aware auto-fit: cards adapt to actual grid width, not viewport
    // width. Viewport breakpoints lied here because the left sidebar + the
    // Report Modules panel eat ~500-560px of horizontal space, so a "wide"
    // window still leaves a narrow content area.
    //
    // grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))
    //   - Each card is at least 260px wide and grows to fill the row
    //   - Browser packs as many as fit, then wraps. Effectively:
    //       ~830px+ container = 3 cols, ~525-829px = 2 cols, <525px = 1 col
    //   - 260px floor chosen so 3 cards fit comfortably even with both the
    //     LANA app sidebar (~280px) and Report Modules panel (~260px) open.
    grid.className = 'gap-6';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(260px, 1fr))';
    grid.id = 'grid-' + uniqueId;
    grid.innerHTML = viz.metrics.map(function (metric) { return createMetricCard(metric); }).join('');
    if (window.CurrentPipelinePresentation) window.CurrentPipelinePresentation.bindDetails(grid, openGenericDrilldown);
    if (window.AcquisitionSourcePresentation) window.AcquisitionSourcePresentation.bindDetails(grid, openGenericDrilldown);
    if (window.OpportunityIntakePresentation) window.OpportunityIntakePresentation.bindDetails(grid, openGenericDrilldown);
    div.appendChild(grid);

    requestAnimationFrame(function () { fitAllMetricCardText(grid); });

    setTimeout(function () {
      viz.metrics.forEach(function (metric) {
        if (Array.isArray(metric.current)) {
          renderMetricChart(metric, 'chart-' + metric.key);
        }
      });
    }, 100);

    return div;
  }

  function renderTrendChart(viz, data, uniqueId) {
    if (!data.timeSeries || data.timeSeries.length === 0) return null;

    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    var canvasId = 'chart-' + uniqueId;
    var helpTextHTML = renderHelpTextModal(viz.helpText, uniqueId);

    div.innerHTML = '<div class="flex items-center mb-2"><h3 class="text-lg font-semibold text-gray-900">' + escapeHtml(viz.title || 'Metrics Over Time') + '</h3>' + helpTextHTML + '</div>' +
      (viz.description ? '<p class="text-sm text-gray-600 mb-4">' + escapeHtml(viz.description) + '</p>' : '') +
      '<div class="h-96"><canvas id="' + canvasId + '"></canvas></div>';

    setTimeout(function () {
      renderTimeSeriesChartForVisualization(canvasId, data.timeSeries, viz.metrics);
    }, 100);

    return div;
  }

  function renderTimeSeriesChartForVisualization(canvasId, timeSeries, metricKeys) {
    var ctx = document.getElementById(canvasId);
    if (!ctx) return;
    var renderer = new TimeSeriesRenderer(canvasId, timeSeries, metricKeys, {
      fill: true, tension: 0.4, responsive: true, maintainAspectRatio: false
    });
    var chart = renderer.render();
    chartInstances[canvasId] = renderer;
    return chart;
  }

  function renderComparisonChart(viz, data, uniqueId) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    var canvasId = 'chart-' + uniqueId;
    var helpTextHTML = renderHelpTextModal(viz.helpText, uniqueId);
    var description = viz.description || 'Compare how your metrics changed from the previous period to now.';

    div.innerHTML = '<div class="mb-4"><div class="flex items-center justify-between mb-2"><div class="flex items-center">' +
      '<h3 class="text-lg font-semibold text-gray-900">' + escapeHtml(viz.title || 'Current vs Prior Period') + '</h3>' + helpTextHTML + '</div></div>' +
      '<p class="text-sm text-gray-600 leading-relaxed">' + description + '</p>' +
      '<div class="flex items-center gap-6 mt-3 text-xs">' +
      '<div class="flex items-center gap-2"><div class="w-3 h-3 rounded bg-blue-500"></div><span class="text-gray-600">Current Period (Now)</span></div>' +
      '<div class="flex items-center gap-2"><div class="w-3 h-3 rounded bg-gray-400"></div><span class="text-gray-600">Prior Period (Before)</span></div></div></div>' +
      '<div class="h-64"><canvas id="' + canvasId + '"></canvas></div>';

    setTimeout(function () {
      var ctx = document.getElementById(canvasId);
      if (!ctx) return;
      var metrics = data.metrics.filter(function (m) { return viz.metrics.indexOf(m.key) !== -1; });

      var chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: metrics.map(function (m) { return m.name; }),
          datasets: [
            // A null value draws no bar (js/shared/chart-points.js); a real 0 stays 0.
            { label: 'Current Period', data: metrics.map(function (m) { return window.ChartPoints.value(m.current); }), backgroundColor: '#3b82f6', borderColor: '#2563eb', borderWidth: 1 },
            { label: 'Prior Period', data: metrics.map(function (m) { return window.ChartPoints.value(m.prior); }), backgroundColor: '#9ca3af', borderColor: '#6b7280', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 15, font: { size: 12 } } },
            tooltip: {
              backgroundColor: 'rgba(0, 0, 0, 0.8)', padding: 12,
              callbacks: {
                label: function (context) {
                  var label = context.dataset.label || '';
                  var value = context.parsed.y;
                  var metric = metrics[context.dataIndex];
                  var unit = (metric && metric.unit) || '';
                  var formattedValue = value.toFixed(1);
                  if (unit === 'percent' || unit === 'percentage') formattedValue = value.toFixed(1) + '%';
                  else if (unit === 'days' || unit === 'hours') formattedValue = value.toFixed(1) + ' ' + unit;
                  else if (unit === 'score') formattedValue = value.toFixed(1) + '/100';
                  else if (unit === 'leads' || unit === 'consultations') formattedValue = Math.round(value) + ' ' + unit;
                  return label + ': ' + formattedValue;
                },
                footer: function (context) {
                  if (context.length === 2) {
                    var currentItem = null; var priorItem = null;
                    for (var i = 0; i < context.length; i++) {
                      if (context[i].dataset.label === 'Current Period') currentItem = context[i];
                      if (context[i].dataset.label === 'Prior Period') priorItem = context[i];
                    }
                    var current = currentItem ? currentItem.parsed.y : 0;
                    var prior = priorItem ? priorItem.parsed.y : 0;
                    var diff = current - prior;
                    var diffPercent = prior !== 0 ? ((diff / prior) * 100) : 0;
                    if (diff > 0) return 'Up ' + Math.abs(diffPercent).toFixed(1) + '% from before';
                    if (diff < 0) return 'Down ' + Math.abs(diffPercent).toFixed(1) + '% from before';
                    return 'No change';
                  }
                  return '';
                }
              }
            }
          },
          scales: {
            y: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: 'rgba(0, 0, 0, 0.05)' } },
            x: { ticks: { font: { size: 11 } }, grid: { display: false } }
          }
        }
      });
      chartInstances[canvasId] = chart;
    }, 100);

    return div;
  }

  function renderEmptyStateCard(title, description) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    div.innerHTML = '<h3 class="text-lg font-semibold text-gray-900 mb-2">' + (title || 'Chart') + '</h3>' +
      (description ? '<p class="text-sm text-gray-500 mb-4">' + description + '</p>' : '') +
      '<div class="h-48 flex items-center justify-center bg-gray-50 rounded-lg">' +
      '<div class="text-center"><svg class="mx-auto h-10 w-10 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>' +
      '<p class="text-sm text-gray-400">No data available for this period</p></div></div>';
    return div;
  }

  function renderPieChart(viz, data, uniqueId) {
    var metric = null;
    if (viz.metrics) {
      for (var i = 0; i < data.metrics.length; i++) {
        if (viz.metrics.indexOf(data.metrics[i].key) !== -1) { metric = data.metrics[i]; break; }
      }
    }
    if (!metric || !Array.isArray(metric.current)) return renderEmptyStateCard(viz.title, viz.description);

    var containerId = 'pie-chart-container-' + uniqueId;
    var containerDiv = document.createElement('div');
    containerDiv.id = containerId;
    containerDiv.className = 'mb-6';

    if (metric.current.length === 0) {
      containerDiv.innerHTML = '<div class="bg-white rounded-lg shadow p-6"><h3 class="text-lg font-semibold mb-2">' + escapeHtml(viz.title || 'Distribution') + '</h3>' +
        (viz.description ? '<p class="text-sm text-gray-600 mb-4">' + escapeHtml(viz.description) + '</p>' : '') +
        '<div class="text-center py-12 text-gray-500"><p class="mt-2 text-sm">No data available for this period</p></div></div>';
      return containerDiv;
    }

    var renderer = new PieChartRenderer(containerId, metric.current, {
      title: viz.title, description: viz.description, legendPosition: 'right',
      helpText: viz.helpText ? { content: viz.helpText } : null
    });
    chartInstances[containerId] = renderer;
    setTimeout(function () { renderer.render(); }, 0);
    return containerDiv;
  }

  function renderFunnelChart(viz, data, uniqueId) {
    var metric = null;
    if (viz.metrics) {
      for (var i = 0; i < data.metrics.length; i++) {
        if (viz.metrics.indexOf(data.metrics[i].key) !== -1) { metric = data.metrics[i]; break; }
      }
    }
    if (!metric || !metric.current) return renderEmptyStateCard(viz.title, viz.description);

    var containerId = 'funnel-chart-' + uniqueId;
    var containerDiv = document.createElement('div');
    containerDiv.id = containerId;
    containerDiv.className = 'mb-6';

    var renderer = new FunnelChartRenderer(containerId, metric.current, {
      title: viz.title || 'Funnel Chart', description: viz.description, helpText: viz.helpText,
      onStageClick: function (stageInfo) {
        showFunnelStageDrilldown(stageInfo, metric.key);
      },
      onTabSwitch: function (tabInfo) {
        var insightContainer = document.getElementById('funnel-insights-container');
        if (insightContainer && window._funnelInsightData) {
          renderInsightPanelsForPipeline(tabInfo.pipelineId, tabInfo.pipelineName, insightContainer);
        }
      }
    });
    chartInstances[containerId] = renderer;
    setTimeout(function () { renderer.render(); }, 0);
    return containerDiv;
  }

  /**
   * Render funnel insight panels — contextual drop-off diagnostics per pipeline
   */
  function renderFunnelInsightPanels(viz, data, uniqueId) {
    // Extract referenced metrics and group by pipeline_id
    var insightData = {};
    var metricKeys = viz.metrics || [];

    for (var m = 0; m < metricKeys.length; m++) {
      var metricKey = metricKeys[m];
      var metric = null;
      for (var i = 0; i < data.metrics.length; i++) {
        if (data.metrics[i].key === metricKey) { metric = data.metrics[i]; break; }
      }
      if (!metric || !Array.isArray(metric.current)) continue;

      var grouped = {};
      for (var r = 0; r < metric.current.length; r++) {
        var row = metric.current[r];
        var pid = row.pipeline_id || '_all';
        if (!grouped[pid]) grouped[pid] = [];
        grouped[pid].push(row);
      }
      insightData[metricKey] = { grouped: grouped, raw: metric.current };
    }

    // Store globally for onTabSwitch access
    window._funnelInsightData = insightData;

    var containerDiv = document.createElement('div');
    containerDiv.id = 'funnel-insights-container';
    containerDiv.className = 'mb-6';

    // Initial render will be triggered by FunnelChartRenderer's onTabSwitch on first render
    // If no tab switch fires (e.g. data issue), show a placeholder
    setTimeout(function () {
      if (containerDiv.children.length === 0) {
        // Find first pipeline_id from any metric
        var firstPipelineId = '';
        var firstPipelineName = '';
        for (var key in insightData) {
          for (var pid in insightData[key].grouped) {
            if (pid !== '_all') {
              firstPipelineId = pid;
              var rows = insightData[key].grouped[pid];
              if (rows.length > 0 && rows[0].pipeline_name) firstPipelineName = rows[0].pipeline_name;
              break;
            }
          }
          if (firstPipelineId) break;
        }
        if (firstPipelineId) {
          renderInsightPanelsForPipeline(firstPipelineId, firstPipelineName, containerDiv);
        }
      }
    }, 200);

    return containerDiv;
  }

  /**
   * Render insight panels for a specific pipeline
   */
  function renderInsightPanelsForPipeline(pipelineId, pipelineName, container) {
    var insightData = window._funnelInsightData;
    if (!insightData) return;

    container.innerHTML = '';

    // Outer card
    var card = document.createElement('div');
    card.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6';

    // Header
    var header = document.createElement('div');
    header.className = 'mb-5';
    header.innerHTML = '<h3 class="text-lg font-semibold text-gray-900">Pipeline Drop-Off Insights</h3>' +
      '<p class="text-sm text-gray-500 mt-1">Why contacts may be falling off in <span class="font-medium text-gray-700">' +
      escapeHtml(pipelineName || 'this pipeline') + '</span></p>';
    card.appendChild(header);

    var panelsContainer = document.createElement('div');
    panelsContainer.className = 'space-y-4';

    // 1. Stagnation Analysis
    var stagnationRows = getInsightRows(insightData, 'funnel_stagnation_analysis', pipelineId);
    panelsContainer.appendChild(buildStagnationPanel(stagnationRows));

    // 2. Assignment Gaps
    var assignmentRows = getInsightRows(insightData, 'funnel_assignment_gaps', pipelineId);
    panelsContainer.appendChild(buildAssignmentPanel(assignmentRows));

    // 3. Tag Engagement / Win Rate
    var tagRows = getInsightRows(insightData, 'funnel_tag_engagement', pipelineId);
    panelsContainer.appendChild(buildTagEngagementPanel(tagRows));

    card.appendChild(panelsContainer);

    // 5. Cross-pipeline tag insights (not filtered by pipeline)
    var crossTagRows = insightData['funnel_tag_win_correlation'] ? insightData['funnel_tag_win_correlation'].raw : [];
    if (crossTagRows.length > 0) {
      var divider = document.createElement('div');
      divider.className = 'border-t border-gray-100 mt-5 pt-5';
      // Check if all cross-pipeline rates are 0
      var allCrossZero = true;
      for (var ct = 0; ct < crossTagRows.length; ct++) {
        if (parseFloat(crossTagRows[ct].win_rate) > 0) { allCrossZero = false; break; }
      }
      divider.innerHTML = '<h4 class="text-sm font-semibold text-gray-700 mb-1">Cross-Pipeline Tag Insights</h4>' +
        '<p class="text-xs text-gray-500 mb-3">Tag conversion rates across all pipelines combined</p>' +
        (allCrossZero ? '<p class="text-xs text-amber-600 mb-3">All conversion rates are 0%. The contacts on your won leads don\'t have any of these tags in your CRM.</p>' : '');
      divider.appendChild(buildTagTable(crossTagRows, 'win_rate', 10));
      card.appendChild(divider);
    }

    container.appendChild(card);
  }

  function getInsightRows(insightData, metricKey, pipelineId) {
    if (!insightData[metricKey]) return [];
    return insightData[metricKey].grouped[pipelineId] || [];
  }

  function buildStagnationPanel(rows) {
    var panel = document.createElement('div');
    panel.className = 'rounded-lg border border-gray-100 p-4';

    var ruleDesc = '<p class="text-xs text-gray-400 mt-1">Flags open leads that haven\'t moved to a new stage in 30+ days (30 to 60, 60 to 90, or 90+ day buckets).</p>';

    if (rows.length === 0) {
      panel.innerHTML = '<div class="flex items-start gap-3">' +
        '<div class="flex-shrink-0 w-8 h-8 rounded-full bg-green-50 flex items-center justify-center"><svg class="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>' +
        '<div><h4 class="text-sm font-semibold text-gray-900">Stagnation Analysis</h4>' +
        '<p class="text-sm text-gray-500 mt-0.5">No stagnating opportunities detected</p>' + ruleDesc + '</div></div>';
      return panel;
    }

    // Find worst bucket
    var total = 0;
    var buckets = {};
    for (var i = 0; i < rows.length; i++) {
      buckets[rows[i].label] = { count: parseInt(rows[i].value) || 0, value: parseFloat(rows[i].total_value) || 0 };
      total += parseInt(rows[i].value) || 0;
    }

    var severe = buckets['90+ days'];
    var bannerClass = severe && severe.count > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200';
    var iconColor = severe && severe.count > 0 ? 'text-red-600 bg-red-100' : 'text-amber-600 bg-amber-100';

    panel.className = 'rounded-lg border p-4 ' + bannerClass;
    panel.innerHTML = '<div class="flex items-start gap-3">' +
      '<div class="flex-shrink-0 w-8 h-8 rounded-full ' + iconColor + ' flex items-center justify-center"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>' +
      '<div class="flex-1">' +
        '<h4 class="text-sm font-semibold text-gray-900">Stagnation Analysis</h4>' +
        '<p class="text-sm text-gray-600 mt-0.5">' + total + ' opportunities have been sitting without stage movement</p>' +
        '<div class="flex gap-4 mt-3">' +
          buildStatChip('90+ days', buckets['90+ days'], 'red') +
          buildStatChip('60-90 days', buckets['60-90 days'], 'amber') +
          buildStatChip('30-60 days', buckets['30-60 days'], 'yellow') +
        '</div>' + ruleDesc +
      '</div></div>';

    return panel;
  }

  function buildStatChip(label, bucket, color) {
    var count = bucket ? bucket.count : 0;
    if (count === 0) return '';
    var colorMap = { red: 'bg-red-100 text-red-700', amber: 'bg-amber-100 text-amber-700', yellow: 'bg-yellow-100 text-yellow-700' };
    var cls = colorMap[color] || 'bg-gray-100 text-gray-700';
    return '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ' + cls + '">' +
      label + ': ' + count.toLocaleString() + '</span>';
  }

  function buildAssignmentPanel(rows) {
    var panel = document.createElement('div');
    panel.className = 'rounded-lg border border-gray-100 p-4';

    if (rows.length === 0) {
      panel.innerHTML = '<div class="flex items-start gap-3">' +
        '<div class="flex-shrink-0 w-8 h-8 rounded-full bg-green-50 flex items-center justify-center"><svg class="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>' +
        '<div><h4 class="text-sm font-semibold text-gray-900">Assignment Gaps</h4>' +
        '<p class="text-sm text-gray-500 mt-0.5">All opportunities have team members assigned</p></div></div>';
      return panel;
    }

    var row = rows[0];
    var pct = parseFloat(row.percentage) || 0;
    var unassigned = parseInt(row.value) || 0;
    var total = parseInt(row.total_count) || 0;

    var bannerClass, iconColor;
    if (pct >= 75) {
      bannerClass = 'bg-red-50 border-red-200';
      iconColor = 'text-red-600 bg-red-100';
    } else if (pct >= 50) {
      bannerClass = 'bg-amber-50 border-amber-200';
      iconColor = 'text-amber-600 bg-amber-100';
    } else {
      bannerClass = 'bg-blue-50 border-blue-200';
      iconColor = 'text-blue-600 bg-blue-100';
    }

    panel.className = 'rounded-lg border p-4 ' + bannerClass;
    panel.innerHTML = '<div class="flex items-start gap-3">' +
      '<div class="flex-shrink-0 w-8 h-8 rounded-full ' + iconColor + ' flex items-center justify-center"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg></div>' +
      '<div class="flex-1">' +
        '<h4 class="text-sm font-semibold text-gray-900">Assignment Gaps</h4>' +
        '<p class="text-sm text-gray-600 mt-0.5">' + pct + '% of open opportunities (' + unassigned.toLocaleString() + ' of ' + total.toLocaleString() + ') have no team member assigned</p>' +
        (pct >= 50 ? '<p class="text-xs text-gray-500 mt-2">Unassigned leads are more likely to fall through the cracks. Consider assigning owners to improve follow-up rates.</p>' : '') +
      '</div></div>';

    return panel;
  }

  function buildTagEngagementPanel(rows) {
    var panel = document.createElement('div');
    panel.className = 'rounded-lg border border-gray-100 p-4';

    var headerHtml = '<div class="flex items-start gap-3">' +
      '<div class="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center"><svg class="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg></div>' +
      '<div class="flex-1"><h4 class="text-sm font-semibold text-gray-900">Engagement Tag Win Rates</h4>';

    if (rows.length === 0) {
      panel.innerHTML = headerHtml + '<p class="text-sm text-gray-500 mt-0.5">No engagement tag data available for this pipeline</p>' +
        '<p class="text-xs text-gray-400 mt-1">Shows CRM contact tags and how often tagged leads convert. Requires contacts to have tags assigned in your CRM.</p></div></div>';
      return panel;
    }

    // Check if all conversion rates are 0
    var allZero = true;
    for (var t = 0; t < rows.length; t++) {
      if (parseFloat(rows[t].win_rate) > 0) { allZero = false; break; }
    }

    panel.innerHTML = headerHtml +
      '<p class="text-sm text-gray-500 mt-0.5">Tags that correlate with winning deals</p>' +
      (allZero ? '<p class="text-xs text-amber-600 mt-1">All conversion rates are 0%. The contacts on your won leads don\'t have any of these tags in your CRM.</p>' : '') +
      '</div></div>';

    panel.appendChild(buildTagTable(rows, 'win_rate', 8));
    return panel;
  }

  function buildTagTable(rows, rateField, limit) {
    var table = document.createElement('div');
    table.className = 'mt-3 overflow-hidden rounded-lg border border-gray-200';

    var html = '<table class="w-full text-sm"><thead><tr class="bg-gray-50 border-b border-gray-200">' +
      '<th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Tag</th>' +
      '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Count</th>' +
      '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Conversion</th>' +
      '<th class="px-3 py-2 w-24"></th></tr></thead><tbody>';

    var shown = Math.min(rows.length, limit);
    for (var i = 0; i < shown; i++) {
      var row = rows[i];
      var winRate = parseFloat(row[rateField]) || 0;
      var barColor = winRate >= 40 ? 'bg-green-500' : (winRate >= 20 ? 'bg-amber-500' : 'bg-red-400');
      var textColor = winRate >= 40 ? 'text-green-700' : (winRate >= 20 ? 'text-amber-700' : 'text-red-600');
      var bgRow = i % 2 === 0 ? '' : 'bg-gray-50';

      html += '<tr class="border-b border-gray-100 ' + bgRow + '">' +
        '<td class="px-3 py-2 text-gray-900">' + escapeHtml(row.label || '') + '</td>' +
        '<td class="px-3 py-2 text-right text-gray-600">' + (parseInt(row.value) || 0).toLocaleString() + '</td>' +
        '<td class="px-3 py-2 text-right font-medium ' + textColor + '">' + winRate + '%</td>' +
        '<td class="px-3 py-2"><div class="w-full bg-gray-200 rounded-full h-2"><div class="' + barColor + ' h-2 rounded-full reporting-bar" style="--bar: ' + Math.min(winRate, 100) + '%"></div></div></td></tr>';
    }

    html += '</tbody></table>';
    table.innerHTML = html;
    return table;
  }

  function buildSourcePanel(rows) {
    var panel = document.createElement('div');
    panel.className = 'rounded-lg border border-gray-100 p-4';

    var headerHtml = '<div class="flex items-start gap-3">' +
      '<div class="flex-shrink-0 w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center"><svg class="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg></div>' +
      '<div class="flex-1"><h4 class="text-sm font-semibold text-gray-900">Lead Source Performance</h4>';

    if (rows.length === 0) {
      panel.innerHTML = headerHtml + '<p class="text-sm text-gray-500 mt-0.5">No source data available for this pipeline</p></div></div>';
      return panel;
    }

    panel.innerHTML = headerHtml +
      '<p class="text-sm text-gray-500 mt-0.5">Which lead sources convert best in this pipeline</p></div></div>';

    var barsDiv = document.createElement('div');
    barsDiv.className = 'mt-3 space-y-2';

    var shown = Math.min(rows.length, 8);
    for (var i = 0; i < shown; i++) {
      var row = rows[i];
      var winRate = parseFloat(row.win_rate) || 0;
      var wonCount = parseInt(row.won_count) || 0;
      var decidedCount = parseInt(row.decided_count) || 0;
      var barColor = winRate >= 40 ? 'bg-green-500' : (winRate >= 20 ? 'bg-amber-500' : 'bg-red-400');

      var barRow = document.createElement('div');
      barRow.className = 'flex items-center gap-3';
      barRow.innerHTML =
        '<div class="w-48 text-sm text-gray-700 truncate" title="' + escapeHtml(row.label || '') + '">' + escapeHtml(row.label || '') + '</div>' +
        '<div class="flex-1 bg-gray-200 rounded-full h-2.5"><div class="' + barColor + ' h-2.5 rounded-full reporting-bar" style="--bar: ' + Math.min(winRate, 100) + '%"></div></div>' +
        '<div class="w-24 text-right text-xs text-gray-500">' + winRate + '% (' + wonCount + '/' + decidedCount + ')</div>';
      barsDiv.appendChild(barRow);
    }

    panel.appendChild(barsDiv);
    return panel;
  }

  function renderHorizontalBarChart(viz, data, uniqueId) {
    var metricKey = viz.metrics && viz.metrics[0];
    if (!metricKey) return null;

    var metric = null;
    if (data.metrics) {
      for (var i = 0; i < data.metrics.length; i++) {
        if (data.metrics[i].key === metricKey) { metric = data.metrics[i]; break; }
      }
    }
    if (!metric) return renderEmptyStateCard(viz.title, viz.description);

    var chartData = Array.isArray(metric.current) ? metric.current : (Array.isArray(metric.result) ? metric.result : []);
    var containerId = 'bar-chart-container-' + uniqueId;
    var containerDiv = document.createElement('div');
    containerDiv.id = containerId;
    containerDiv.className = 'mb-6';

    if (chartData.length === 0) {
      containerDiv.innerHTML = '<div class="bg-white rounded-lg shadow p-6"><h3 class="text-lg font-semibold mb-2">' + escapeHtml(viz.title || 'Chart') + '</h3>' +
        (viz.description ? '<p class="text-sm text-gray-600 mb-4">' + escapeHtml(viz.description) + '</p>' : '') +
        '<div class="text-center py-12 text-gray-500"><p class="mt-2 text-sm">No data available for this period</p></div></div>';
      return containerDiv;
    }

    var renderer = new BarChartRenderer(containerDiv, {
      labels: chartData.map(function (d) { return d.label || 'Unknown'; }),
      values: chartData.map(function (d) { return d.value || 0; })
    }, {
      title: viz.title, description: viz.description, orientation: 'horizontal',
      metricName: metric.name, unit: metric.unit,
      isPercentage: (metric.format && metric.format.suffix === '%') || metric.unit === 'percent',
      colorRule: viz.colorRule, colors: viz.barColors,
      helpText: viz.helpText ? { content: viz.helpText } : null,
      onBarClick: function (index, label) {
        if (metric.drilldown && metric.drilldown.enabled && window.openDrilldown) {
          window.openDrilldown(metricKey, { drill_source: label });
        }
      }
    });
    chartInstances[containerId] = renderer;
    setTimeout(function () { renderer.render(); }, 0);
    return containerDiv;
  }

  // Attribution summary: the visualization declares its sections
  // (sections: [{ role, metric }]). The role picks the layout below; the
  // metric comes from the execute response by the declared key.
  function attributionSectionHTML(title, note, body) {
    return '<div class="mb-8">' +
      '<h4 class="text-base font-semibold text-gray-700 mb-1">' + escapeHtml(title) + '</h4>' +
      '<p class="text-xs text-gray-400 mb-3">' + escapeHtml(note) + '</p>' + body + '</div>';
  }

  function winRateBadgeColor(rate) {
    return rate >= 40 ? 'bg-green-100 text-green-800' : (rate >= 20 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800');
  }

  function renderMultiTouchBody(rows) {
    var total = 0;
    var multiLeads = 0;
    var multiConv = 0;
    var singleConv = 0;
    for (var i = 0; i < rows.length; i++) {
      var count = parseInt(rows[i].value) || 0;
      total += count;
      if (rows[i].label === 'Single Touch') {
        singleConv = parseFloat(rows[i].win_rate) || 0;
      } else {
        multiLeads += count;
        multiConv = parseFloat(rows[i].win_rate) || 0;
      }
    }
    if (total === 0) return '<p class="text-sm text-gray-400">No multi-touch data available.</p>';
    var multiPct = Math.round(100 * multiLeads / total);
    return '<div class="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">' +
      '<p class="text-sm text-blue-800">' +
      '<span class="font-semibold">' + multiPct + '%</span> of leads had 2+ marketing touchpoints. ' +
      'Multi-touch: <span class="font-semibold">' + multiConv + '%</span> conversion · ' +
      'Single-touch: <span class="font-semibold">' + singleConv + '%</span> conversion' +
      '</p></div>';
  }

  function renderJourneysBody(rows) {
    if (rows.length === 0) return '<p class="text-sm text-gray-400">No journey path data available.</p>';
    var html = '<div class="overflow-hidden rounded-lg border border-gray-200">' +
      '<table class="w-full text-sm"><thead><tr class="bg-gray-50 border-b border-gray-200">' +
      '<th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Journey (First → Last)</th>' +
      '<th class="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>' +
      '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Leads</th>' +
      '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Won</th>' +
      '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Conversion</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var conv = parseFloat(row.win_rate) || 0;
      var convColor = conv >= 40 ? 'text-green-700' : (conv >= 20 ? 'text-yellow-700' : 'text-red-600');
      var convBg = conv >= 40 ? 'bg-green-50 text-green-700' : (conv >= 20 ? 'bg-yellow-50 text-yellow-700' : '');
      var typeBadge = row.journey_type === 'single'
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Single</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Multi</span>';
      html += '<tr class="border-b border-gray-100 ' + (i % 2 === 0 ? '' : 'bg-gray-50') + '">' +
        '<td class="px-3 py-2 text-gray-900">' + escapeHtml(row.label || '') + '</td>' +
        '<td class="px-3 py-2 text-center">' + typeBadge + '</td>' +
        '<td class="px-3 py-2 text-right text-gray-600">' + (parseInt(row.value) || 0).toLocaleString() + '</td>' +
        '<td class="px-3 py-2 text-right text-gray-600">' + (parseInt(row.won_count) || 0) + '</td>' +
        '<td class="px-3 py-2 text-right font-medium ' + convColor + '">' +
        (convBg ? '<span class="px-2 py-0.5 rounded ' + convBg + '">' + conv + '%</span>' : conv + '%') +
        '</td></tr>';
    }
    return html + '</tbody></table></div>';
  }

  function touchColumnHTML(heading, rows, barClass) {
    var max = rows.length > 0 ? parseFloat(rows[0].value) || 1 : 1;
    var html = '<div><h5 class="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">' + heading + '</h5><div class="space-y-2">';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var pct = Math.round((parseFloat(row.value) / max) * 100);
      html += '<div class="flex items-center gap-3">' +
        '<div class="w-28 text-sm text-gray-700 truncate" title="' + escapeHtml(row.channel || '') + '">' + escapeHtml(row.channel || 'Unknown') + '</div>' +
        '<div class="flex-1 bg-gray-100 rounded-full h-5 relative">' +
        '<div class="' + barClass + ' h-5 rounded-full reporting-bar" style="--bar: ' + pct + '%"></div>' +
        '</div>' +
        '<div class="w-12 text-sm text-gray-600 text-right">' + escapeHtml(row.value || 0) + '</div>' +
        '<div class="w-14 text-xs text-gray-400 text-right">' + escapeHtml(row.win_rate || 0) + '%</div>' +
        '</div>';
    }
    return html + '</div></div>';
  }

  function renderFirstVsLastTouchBody(rows) {
    var firstTouches = rows.filter(function (row) { return row.touch_type === 'first_touch'; });
    var lastTouches = rows.filter(function (row) { return row.touch_type === 'last_touch'; });
    if (firstTouches.length === 0 && lastTouches.length === 0) {
      return '<p class="text-sm text-gray-400">No first/last touch data available.</p>';
    }
    return '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
      touchColumnHTML('First Touch (Discovery)', firstTouches, 'bg-blue-500') +
      touchColumnHTML('Last Touch (Conversion)', lastTouches, 'bg-purple-500') +
      '</div>';
  }

  function renderCampaignsBody(rows) {
    if (rows.length === 0) {
      return '<p class="text-sm text-gray-400">No UTM campaign data available. Campaigns require utmCampaign tags in your marketing URLs.</p>';
    }
    var html = '<table class="w-full text-sm">' +
      '<thead><tr class="text-left text-gray-500 border-b border-gray-200">' +
      '<th class="pb-2 font-medium">Campaign</th>' +
      '<th class="pb-2 font-medium">Channel</th>' +
      '<th class="pb-2 font-medium text-right">Leads</th>' +
      '<th class="pb-2 font-medium text-right">Won</th>' +
      '<th class="pb-2 font-medium text-right">Conversion</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rate = parseFloat(row.win_rate) || 0;
      html += '<tr class="border-b border-gray-100' + (i % 2 === 1 ? ' bg-gray-50' : '') + '">' +
        '<td class="py-2 text-gray-700">' + escapeHtml(row.label || 'Unknown') + '</td>' +
        '<td class="py-2 text-gray-500">' + escapeHtml(row.channel || EMPTY) + '</td>' +
        '<td class="py-2 text-right text-gray-700">' + escapeHtml(row.value || 0) + '</td>' +
        '<td class="py-2 text-right text-gray-700">' + escapeHtml(row.won_count || 0) + '</td>' +
        '<td class="py-2 text-right"><span class="inline-block px-2 py-0.5 rounded text-xs font-medium ' + winRateBadgeColor(rate) + '">' + rate + '%</span></td>' +
        '</tr>';
    }
    return html + '</tbody></table>';
  }

  function renderLandingPagesBody(rows) {
    if (rows.length === 0) return '<p class="text-sm text-gray-400">No landing page data available.</p>';
    var html = '<table class="w-full text-sm">' +
      '<thead><tr class="text-left text-gray-500 border-b border-gray-200">' +
      '<th class="pb-2 font-medium">Landing Page</th>' +
      '<th class="pb-2 font-medium text-right">Leads</th>' +
      '<th class="pb-2 font-medium text-right">Won</th>' +
      '<th class="pb-2 font-medium text-right">Conversion</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rate = parseFloat(row.win_rate) || 0;
      var displayUrl = row.label || 'Unknown';
      var fullUrl = row.full_url || displayUrl;
      if (displayUrl.length > 60) displayUrl = displayUrl.substring(0, 60) + '...';
      html += '<tr class="border-b border-gray-100' + (i % 2 === 1 ? ' bg-gray-50' : '') + '">' +
        '<td class="py-2 text-gray-700 max-w-xs truncate" title="' + escapeHtml(fullUrl) + '">' + escapeHtml(displayUrl) + '</td>' +
        '<td class="py-2 text-right text-gray-700">' + escapeHtml(row.value || 0) + '</td>' +
        '<td class="py-2 text-right text-gray-700">' + escapeHtml(row.won_count || 0) + '</td>' +
        '<td class="py-2 text-right"><span class="inline-block px-2 py-0.5 rounded text-xs font-medium ' + winRateBadgeColor(rate) + '">' + rate + '%</span></td>' +
        '</tr>';
    }
    return html + '</tbody></table>';
  }

  // Section roles (LANA-AI dashboard.schema.json visualization.sections.role).
  var ATTRIBUTION_SECTIONS = {
    multi_touch: { title: 'Multi-Touch Leads', note: 'Across all pipelines: leads with 2 or more marketing touchpoints', render: renderMultiTouchBody },
    journeys: { title: 'Lead Journey Paths', note: 'Across all pipelines: the first and last marketing channel for each lead', render: renderJourneysBody },
    first_vs_last_touch: { title: 'Discovery vs Conversion Channels', note: 'Across all pipelines, only leads with UTM attribution data', render: renderFirstVsLastTouchBody },
    campaigns: { title: 'Campaign Performance', note: 'Across all pipelines, only leads with UTM campaign tags', render: renderCampaignsBody },
    landing_pages: { title: 'Top Landing Pages', note: 'Across all pipelines: the last landing page before conversion', render: renderLandingPagesBody }
  };

  var MISSING_SECTION_METRIC = { data_state: 'engine_error', data_state_reason: 'The report did not send this part.' };
  var NO_ATTRIBUTION_SECTIONS = { data_state: 'not_configured', data_state_reason: 'This report does not say what to show here yet.' };

  function renderAttributionSummary(viz, data, uniqueId) {
    var metrics = (data && Array.isArray(data.metrics)) ? data.metrics : [];
    var sections = Array.isArray(viz.sections) ? viz.sections : [];

    var html = '<div class="mb-6">' +
      '<h3 class="text-lg font-semibold text-gray-900">' + escapeHtml(viz.title || 'Attribution Insights') + '</h3>' +
      (viz.description ? '<p class="text-sm text-gray-500 mt-1">' + escapeHtml(viz.description) + '</p>' : '') +
      '</div>';

    var rendered = 0;
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i] || {};
      var layout = Object.prototype.hasOwnProperty.call(ATTRIBUTION_SECTIONS, section.role) ? ATTRIBUTION_SECTIONS[section.role] : null;
      if (!layout) continue;
      rendered += 1;
      var metric = null;
      for (var j = 0; j < metrics.length; j++) {
        if (metrics[j] && metrics[j].key === section.metric) { metric = metrics[j]; break; }
      }
      var problem = !metric ? MISSING_SECTION_METRIC : (window.DataState.isProblem(metric) ? metric : null);
      var body = problem
        ? window.DataState.render(problem)
        : layout.render(Array.isArray(metric.current) ? metric.current : []);
      html += attributionSectionHTML(layout.title, layout.note, body);
    }
    // No section to show: the shared DataState block, not a bare heading.
    if (!rendered) html += window.DataState.render(NO_ATTRIBUTION_SECTIONS);

    var container = document.createElement('div');
    container.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    container.innerHTML = html;
    return container;
  }

  function renderBubbleChart(viz, data, uniqueId) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    var canvasId = 'chart-' + uniqueId;
    var helpTextHTML = renderHelpTextModal(viz.helpText, uniqueId);

    div.innerHTML = '<div class="flex items-center mb-4"><h3 class="text-lg font-semibold text-gray-900">' + escapeHtml(viz.title || 'Bubble Chart') + '</h3>' + helpTextHTML + '</div>' +
      (viz.description ? '<p class="text-sm text-gray-500 mb-4">' + escapeHtml(viz.description) + '</p>' : '') +
      '<div class="h-96"><canvas id="' + canvasId + '"></canvas></div>';

    setTimeout(function () {
      var ctx = document.getElementById(canvasId);
      if (!ctx) return;
      if (!viz.data || viz.data.length === 0) {
        ctx.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">No data available</div>';
        return;
      }
      var xField = (viz.xAxis && viz.xAxis.field) || 'avg_quality_score';
      var yField = (viz.yAxis && viz.yAxis.field) || 'booking_rate';
      var sizeField = (viz.bubbleSize && viz.bubbleSize.field) || 'lead_count';
      var labelField = (viz.bubbleLabel && viz.bubbleLabel.field) || 'source_name';

      var bubbleData = viz.data.map(function (row) {
        return {
          x: parseFloat(row[xField]) || 0,
          y: parseFloat(row[yField]) || 0,
          r: Math.sqrt(parseFloat(row[sizeField]) || 1) * 3,
          label: row[labelField] || 'Unknown'
        };
      });

      var chart = new Chart(ctx, {
        type: 'bubble',
        data: { datasets: [{ label: viz.title, data: bubbleData, backgroundColor: 'rgba(99, 102, 241, 0.6)', borderColor: 'rgba(99, 102, 241, 1)', borderWidth: 1 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (context) {
                  var point = context.raw;
                  return [point.label,
                    ((viz.xAxis && viz.xAxis.label) || 'Quality') + ': ' + point.x,
                    ((viz.yAxis && viz.yAxis.label) || 'Rate') + ': ' + point.y + '%',
                    ((viz.bubbleSize && viz.bubbleSize.label) || 'Count') + ': ' + Math.round(Math.pow(point.r / 3, 2))];
                }
              }
            }
          },
          scales: {
            x: { title: { display: true, text: (viz.xAxis && viz.xAxis.label) || 'X Axis' }, min: (viz.xAxis && viz.xAxis.min) || 0, max: (viz.xAxis && viz.xAxis.max) || 100 },
            y: { title: { display: true, text: (viz.yAxis && viz.yAxis.label) || 'Y Axis' }, min: (viz.yAxis && viz.yAxis.min) || 0, max: (viz.yAxis && viz.yAxis.max) || 100 }
          }
        }
      });
      chartInstances[canvasId] = chart;
    }, 100);

    return div;
  }

  function renderGroupedBarChart(viz, data, uniqueId) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    var canvasId = 'chart-' + uniqueId;
    var helpTextHTML = renderHelpTextModal(viz.helpText, uniqueId);

    div.innerHTML = '<div class="flex items-center mb-4"><h3 class="text-lg font-semibold text-gray-900">' + escapeHtml(viz.title || 'Grouped Bar Chart') + '</h3>' + helpTextHTML + '</div>' +
      (viz.description ? '<p class="text-sm text-gray-500 mb-4">' + escapeHtml(viz.description) + '</p>' : '') +
      '<div class="h-96"><canvas id="' + canvasId + '"></canvas></div>';

    setTimeout(function () {
      var ctx = document.getElementById(canvasId);
      if (!ctx) return;

      // Build chart rows. Three cases:
      //   1. viz.data pre-populated  -> use as-is
      //   2. single metric whose .current is an array  -> distribution metric;
      //      treat each array row as a bar so this renderer can display
      //      Agent D-style breakdowns (medium, utm, referrer, touch_type)
      //      without requiring per-viz series configs.
      //   3. multiple metrics with scalar current/prior -> classic
      //      current-vs-prior comparison (the original behavior)
      var rows = viz.data;
      var distributionMode = false;
      var distributionSeries = null;
      if ((!rows || rows.length === 0) && Array.isArray(viz.metrics) && Array.isArray(data.metrics)) {
        if (viz.metrics.length === 1) {
          var soleMetric = data.metrics.find(function (x) { return x.key === viz.metrics[0]; });
          if (soleMetric && Array.isArray(soleMetric.current) && soleMetric.current.length > 0) {
            distributionMode = true;
            rows = soleMetric.current;
            // Auto-pick the value series. If the distribution rows carry a
            // touch_type / status / category column we can build a grouped
            // axis off it; otherwise fall back to a single count series.
            var hasTouchType = rows.some(function (r) { return r && r.touch_type; });
            if (hasTouchType) {
              var groups = Array.from(new Set(rows.map(function (r) { return r.touch_type || 'other'; })));
              distributionSeries = groups.map(function (g, i) {
                return {
                  label: g,
                  data: rows.map(function (r) { return (r.touch_type === g) ? window.ChartPoints.firstValue(r.count, r.value) : null; }),
                  backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ef4444'][i % 4]
                };
              });
            } else {
              distributionSeries = [{
                label: soleMetric.unit || 'count',
                data: rows.map(function (r) { return window.ChartPoints.firstValue(r.count, r.value); }),
                backgroundColor: '#6366f1'
              }];
            }
          }
        }
        if (!distributionMode) {
          rows = viz.metrics.map(function (key) {
            var m = data.metrics.find(function (x) { return x.key === key; });
            if (!m) return null;
            return {
              source_name: m.name || m.key,
              current: m.current,
              prior: m.prior
            };
          }).filter(function (r) {
            if (!r) return false;
            var c = parseFloat(r.current); var p = parseFloat(r.prior);
            return (Number.isFinite(c) && c !== 0) || (Number.isFinite(p) && p !== 0);
          });
        }
      }

      if (!rows || rows.length === 0) {
        ctx.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">No data available</div>';
        return;
      }
      var xField = (viz.xAxis && viz.xAxis.field) || (distributionMode ? 'label' : 'source_name');
      var labels = rows.map(function (row) { return row[xField] || 'Unknown'; });
      var datasets = distributionMode
        ? distributionSeries
        : (viz.series || []).map(function (serie) {
            return {
              label: serie.label,
              // Null (for example CAC or ROMS with no spend) draws no bar.
              data: rows.map(function (row) { return window.ChartPoints.value(row[serie.field]); }),
              backgroundColor: serie.color, borderColor: serie.color, borderWidth: 1
            };
          });

      var chart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                afterLabel: function (context) {
                  if (viz.annotations && viz.annotations.field) {
                    var row = viz.data[context.dataIndex];
                    var value = row[viz.annotations.field];
                    return viz.annotations.label.split('{value}').join(value);
                  }
                  return '';
                }
              }
            }
          },
          scales: {
            x: { title: { display: true, text: (viz.xAxis && viz.xAxis.label) || 'Categories' } },
            y: { title: { display: true, text: (viz.yAxis && viz.yAxis.label) || 'Value' }, min: (viz.yAxis && viz.yAxis.min) || 0, max: (viz.yAxis && viz.yAxis.max) || 100, beginAtZero: true }
          }
        }
      });
      chartInstances[canvasId] = chart;
    }, 100);

    return div;
  }

  // "table" visualization: the metric's breakdown rows in a client-side
  // lex-table (the module returns every row in one response).
  function renderTable(viz, data, uniqueId) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';

    var metric = null;
    if (viz.metrics && data.metrics) {
      for (var i = 0; i < data.metrics.length; i++) {
        if (viz.metrics.indexOf(data.metrics[i].key) !== -1) { metric = data.metrics[i]; break; }
      }
    }

    if (!metric || !Array.isArray(metric.current)) {
      div.innerHTML = '<h3 class="text-lg font-semibold text-gray-900 mb-4">' + escapeHtml(viz.title || 'Table') + '</h3>' +
        '<div class="text-gray-500 text-center py-8">No data available</div>';
      return div;
    }

    var tables = window.ReportingTables;
    var columns = tables.breakdownColumns(viz, metric.current);
    var rows = metric.current.map(function (row, idx) { return tables.mapBreakdownRow(row, columns, idx); });
    var host = document.createElement('div');
    div.appendChild(host);
    tables.mountClientTable(host, {
      id: 'reportingTable-' + uniqueId,
      className: 'reporting-breakdown-table',
      title: viz.title || 'Table',
      noun: ['row', 'rows'],
      columns: columns.map(function (c) { return c.field; }),
      labels: columns.map(function (c) { return c.header; }),
      rows: rows,
      renderers: tables.breakdownRenderers(columns),
      filterOptions: tables.breakdownFilterOptions(columns, rows),
      emptyText: 'No data available for this period',
      search: true,
      note: viz.description || ''
    });
    return div;
  }

  function renderPlaceholderChart(viz, uniqueId) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    div.innerHTML = '<h3 class="text-lg font-semibold text-gray-900 mb-4">' + escapeHtml(viz.title || viz.type) + '</h3>' +
      '<div class="h-64 flex items-center justify-center bg-gray-50 rounded"><p class="text-gray-500">Chart type "' + viz.type + '" will be implemented soon</p></div>';
    return div;
  }

  // ==========================================================================
  // Export Functions
  // ==========================================================================

  // A cell value: the formatted text when there is one, else the raw value.
  // Only a missing value is blank; a real 0 stays 0.
  function exportCell(formatted, raw) {
    return window.ReportMetricCard.exportValue(formatted, raw);
  }

  // Rows for the CSV (with Change %) and PDF (without) exports.
  function buildExportRows(metrics, withChangePercent) {
    return metrics.map(function (m) {
      var hasPercent = m.changePercent !== null && m.changePercent !== undefined && m.changePercent !== '';
      var row = [
        m.name,
        exportCell(m.formattedCurrent, m.current),
        exportCell(m.formattedPrior, m.prior),
        exportCell(m.formattedTarget, m.target),
        exportCell(m.formattedChange, null)
      ];
      if (withChangePercent) row.push(hasPercent ? m.changePercent + '%' : EMPTY);
      row.push(m.status ? m.status.toUpperCase() : EMPTY);
      return row;
    });
  }

  // Keep the export data and turn the banner's Export PDF and Export CSV
  // items on only while there is something to export. They start disabled
  // in the page; the banner shows copies of them, so the rendered items are
  // the ones to change.
  function setExportData(data) {
    exportData = data;
    var banner = document.getElementById('reportBanner');
    if (!banner) return;
    Array.prototype.forEach.call(banner.querySelectorAll('[data-reporting-action^="export-"]'), function (item) {
      item.disabled = !data;
    });
  }

  // The export as a header row and body rows. A report's metrics come out as
  // Metric, Current, Prior, Target, Change (Change % on CSV only), Status; a
  // saved report's rows keep their own columns.
  function exportTable(withChangePercent) {
    if (exportData.metrics) {
      return {
        head: withChangePercent
          ? ['Metric', 'Current', 'Prior', 'Target', 'Change', 'Change %', 'Status']
          : ['Metric', 'Current', 'Prior', 'Target', 'Change', 'Status'],
        body: buildExportRows(exportData.metrics, withChangePercent)
      };
    }
    return { head: exportData.head, body: exportData.rows };
  }

  // The report on screen, for the export's heading and file name.
  function exportReportName() {
    var moduleTitleEl = document.getElementById('moduleTitle');
    return (moduleTitleEl && moduleTitleEl.textContent.trim()) || 'Report';
  }

  function exportToPDF() {
    if (!exportData) {
      Lex.Modal.alert('Nothing to export', 'Run the report first, then export its results.');
      return;
    }

    var jsPDFLib = window.jspdf;
    if (!jsPDFLib) { Lex.Modal.alert('Export unavailable', 'The PDF library did not load. Reload the page and try again.'); return; }
    var doc = new jsPDFLib.jsPDF();

    var reportName = exportReportName();
    doc.setFontSize(20);
    doc.text(reportName, 14, 20);

    doc.setFontSize(12);
    var resultPeriodTypeEl = document.getElementById('resultPeriodType');
    var resultCurrentPeriodEl = document.getElementById('resultCurrentPeriod');

    doc.text('Compare By: ' + (resultPeriodTypeEl ? resultPeriodTypeEl.textContent : ''), 14, 34);
    doc.text('Current Period: ' + (resultCurrentPeriodEl ? resultCurrentPeriodEl.textContent : ''), 14, 41);

    var table = exportTable(false);

    doc.autoTable({
      startY: 50,
      head: [table.head],
      body: table.body,
      theme: 'grid',
      headStyles: { fillColor: [99, 102, 241] },
      styles: { fontSize: 9 }
    });

    var fileName = window.ReportMetricCard.exportFileName(reportName, LanaTime.formatUtcDateOnly(), 'pdf');
    doc.save(fileName);
    showInfo('Report exported to ' + fileName);
  }

  function exportToCSV() {
    if (!exportData) {
      Lex.Modal.alert('Nothing to export', 'Run the report first, then export its results.');
      return;
    }

    var table = exportTable(true);
    var csvContent = '';
    [table.head].concat(table.body).forEach(function (row) {
      csvContent += row.map(function (cell) {
        var cellStr = String(cell);
        if (cellStr.indexOf(',') !== -1 || cellStr.indexOf('"') !== -1) {
          return '"' + cellStr.split('"').join('""') + '"';
        }
        return cellStr;
      }).join(',') + '\n';
    });

    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    var url = URL.createObjectURL(blob);
    var fileName = window.ReportMetricCard.exportFileName(exportReportName(), LanaTime.formatUtcDateOnly(), 'csv');

    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showInfo('Report exported to ' + fileName);
  }

  // ==========================================================================
  // Saved reports (V2): run and delete
  // ==========================================================================

  var importedReports = [];
  var selectedImportedReportId = null;

  function selectImportedReport(reportId) {
    selectedImportedReportId = reportId;
    selectedModuleKey = null;

    syncDeleteReportButton();
  }

  function deleteImportedReport(reportId, reportName) {
    Lex.Modal.confirm(
      'Delete imported report',
      'Delete imported report "' + escapeHtml(reportName) + '"? This cannot be undone.',
      function () { performDeleteImportedReport(reportId, reportName); },
      { variant: 'danger', confirmText: 'Delete' }
    );
  }

  async function performDeleteImportedReport(reportId, reportName) {
    try {
      await api.delete('/api/v1/reporting/reports/' + reportId);
      Lex.Toast.success('Report "' + reportName + '" deleted.');
      goToList();
    } catch (error) {
      console.error('[Reporting] Failed to delete report:', error);
      showError(error.message || 'Failed to delete report.');
    }
  }

  async function executeImportedReport() {
    if (!selectedImportedReportId) return;

    var executeBtn = document.getElementById('executeBtn');
    if (executeBtn) executeBtn.loading = true;
    hideError();

    var report = importedReports.find(function (r) { return r.report_id === selectedImportedReportId; });
    var reportName = report ? report.name : 'Imported Report';
    showInfo('Running your report...');
    setExportData(null);

    // Hide previous results
    var resultsEl = document.getElementById('moduleResults');
    if (resultsEl) resultsEl.style.display = 'none';

    try {

      var periodStartEl = document.getElementById('periodStart');
      var periodEndEl = document.getElementById('periodEnd');
      var result = await api.post('/api/v1/reporting/reports/' + selectedImportedReportId + '/execute',
        window.ReportBuilder.runReportBody(report, {
          start: periodStartEl ? periodStartEl.value : '',
          end: periodEndEl ? periodEndEl.value : ''
        }));

      // Store metadata for display
      currentModuleMetadata = {
        moduleKey: selectedImportedReportId,
        moduleName: result.report ? result.report.name : reportName,
        description: report ? (report.description || '') : '',
        version: '1.0.0',
        metricCount: result.row_count || 0,
        category: (result.report ? result.report.category : (report ? report.category : '')) || 'imported',
        status: 'stable'
      };
      currentModuleConfig = result;
      runPeriodDays = runDaysFrom(result.period, null, null);

      // Update header
      var moduleTitleEl = document.getElementById('moduleTitle');
      if (moduleTitleEl) moduleTitleEl.textContent = result.report ? result.report.name : reportName;

      // Update period info
      var resultPeriodTypeEl = document.getElementById('resultPeriodType');
      if (resultPeriodTypeEl) resultPeriodTypeEl.textContent = 'Query';

      var resultCurrentPeriodEl = document.getElementById('resultCurrentPeriod');
      if (resultCurrentPeriodEl) resultCurrentPeriodEl.textContent = result.cached ? 'Cached' : 'Live';

      var resultPriorPeriodEl = document.getElementById('resultPriorPeriod');
      if (resultPriorPeriodEl) resultPriorPeriodEl.textContent = window.DataState.EMPTY_VALUE;

      // Update data sources
      updateDataSources([]);

      // Show results container
      if (resultsEl) resultsEl.style.display = 'flex';

      // Render the results as a simple table in the visualizations container
      var vizContainer = document.getElementById('visualizationsContainer');
      if (vizContainer) {
        var rows = result.data || [];
        var rowCount = result.row_count || rows.length;

        if (window.DataState.isProblem(result)) {
          // The backend's failure model: one shared state block.
          vizContainer.innerHTML = '<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">'
            + window.DataState.render(result) + '</div>';
        } else if (!rows.length) {
          vizContainer.innerHTML = '<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">' +
            '<p class="text-gray-500">No data returned. Check your report configuration and data sources.</p></div>';
        } else {
          // Every returned row in a client-side lex-table.
          var tables = window.ReportingTables;
          // A metric-rows report names its columns (the module's headers).
          var declaredCols = window.ReportBuilder.declaredTableColumns(result);
          var resultCols = declaredCols ? tables.breakdownColumns({ columns: declaredCols }, rows) : tables.resultColumns(rows);
          var resultRows = rows.map(function (row, idx) { return tables.mapResultRow(row, resultCols, idx); });
          setExportData({
            head: resultCols.map(function (c) { return c.header; }),
            rows: rows.map(function (row) {
              return resultCols.map(function (c) { return exportCell(null, row[c.field]); });
            })
          });
          var card = document.createElement('div');
          card.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6';
          vizContainer.innerHTML = '';
          vizContainer.appendChild(card);
          var createdCol = resultCols.some(function (c) { return c.field === 'created_at'; });
          tables.mountClientTable(card, {
            id: 'reportingResultsTable',
            className: 'reporting-results-table',
            title: 'Results',
            noun: ['row', 'rows'],
            columns: resultCols.map(function (c) { return c.field; }),
            labels: resultCols.map(function (c) { return c.header; }),
            rows: resultRows,
            renderers: tables.resultRenderers(resultCols),
            filterOptions: tables.resultFilterOptions(resultCols, resultRows),
            sortBy: createdCol ? 'created_at' : '',
            sortDir: 'desc',
            emptyText: 'No data returned',
            search: true,
            note: rowCount > rows.length ? 'The report returned ' + rows.length.toLocaleString() + ' of ' + Number(rowCount).toLocaleString() + ' rows.' : ''
          });
        }
      }

      hideInfo();

    } catch (error) {
      console.error('[Reporting] V2 execution failed:', error);
      showRunFailure(error);
    } finally {
      if (executeBtn) executeBtn.loading = false;
    }
  }

  // ==========================================================================
  // Window Namespace Exposure
  // ==========================================================================

  // ==========================================================================
  // Module Customization Panel
  // ==========================================================================

  var customizationCatalog = null; // Cached analytics catalog

  function openCustomizePanel() {
    var panel = document.getElementById('customizePanel');
    if (panel) panel.open = true;
    loadExistingCustomizations();
    loadAnalyticsCatalog();
  }

  function closeCustomizePanel() {
    var panel = document.getElementById('customizePanel');
    if (panel) panel.open = false;
  }

  async function loadAnalyticsCatalog() {
    if (customizationCatalog) return;
    try {
      var result = await api.get('/api/v1/analytics/catalog');
      if (result && result.data) {
        customizationCatalog = result.data;
      }
    } catch (err) {
      console.warn('[Reporting] Failed to load analytics catalog:', err);
    }
  }

  async function loadExistingCustomizations() {
    var moduleKey = selectedModuleKey || '';
    if (!moduleKey) return;

    var container = document.getElementById('existingCustomizations');
    if (!container) return;

    try {
      var result = await api.get('/api/v1/module-customizations?module_key=' + encodeURIComponent(moduleKey));
      var items = (result && result.data) ? result.data : [];

      if (items.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500">No customizations saved for this module</p>';
        return;
      }

      var html = '';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var defaultBadge = item.is_default
          ? '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 ml-2">Default</span>'
          : '';
        html += '<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">'
          + '<div>'
          + '<p class="text-sm font-medium text-gray-900">' + escapeHtml(item.customization_name) + defaultBadge + '</p>'
          + (item.description ? '<p class="text-xs text-gray-500 mt-0.5">' + escapeHtml(item.description) + '</p>' : '')
          + '</div>'
          + '<div class="flex items-center gap-2">'
          + (item.is_default ? '' : '<button type="button" data-reporting-action="set-default-customization" data-customization-id="' + escapeHtml(item.id) + '" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Set Default</button>')
          + '<button type="button" data-reporting-action="delete-customization" data-customization-id="' + escapeHtml(item.id) + '" class="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>'
          + '</div>'
          + '</div>';
      }
      container.innerHTML = html;

      // Show active customization info
      var activeInfo = document.getElementById('activeCustomizationInfo');
      var defaultItem = items.find(function (it) { return it.is_default; });
      if (defaultItem && activeInfo) {
        activeInfo.classList.remove('hidden');
        var nameEl = document.getElementById('activeCustomizationName');
        var descEl = document.getElementById('activeCustomizationDesc');
        if (nameEl) nameEl.textContent = defaultItem.customization_name;
        if (descEl) descEl.textContent = defaultItem.description || 'Active default customization';
      } else if (activeInfo) {
        activeInfo.classList.add('hidden');
      }
    } catch (err) {
      container.innerHTML = '<p class="text-xs text-red-500">Failed to load customizations</p>';
      console.error('[Reporting] Failed to load customizations:', err);
    }
  }

  function addMetricRow() {
    var container = document.getElementById('custMetricsContainer');
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = '<input type="text" placeholder="e.g. count.id" class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm cust-metric-input" maxlength="100">'
      + '<button type="button" class="text-red-500 hover:text-red-700 text-xs" data-reporting-action="remove-row">Remove</button>';
    container.appendChild(row);
  }

  function addDimensionRow() {
    var container = document.getElementById('custDimensionsContainer');
    if (!container) return;

    var options = [{ value: '', label: 'Select column...' }];
    if (customizationCatalog && customizationCatalog.tables) {
      var allCols = {};
      customizationCatalog.tables.forEach(function (t) {
        t.columns.forEach(function (c) {
          if (c.capabilities.indexOf('group') !== -1) {
            allCols[c.key] = c.label + ' (' + t.label + ')';
          }
        });
      });
      var keys = Object.keys(allCols);
      for (var k = 0; k < keys.length; k++) {
        options.push({ value: keys[k], label: allCols[keys[k]] });
      }
    }

    var row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = '<lex-select class="flex-1 cust-dimension-input" value="" searchable options="' + escapeHtml(JSON.stringify(options)) + '"></lex-select>'
      + '<button type="button" class="text-red-500 hover:text-red-700 text-xs" data-reporting-action="remove-row">Remove</button>';
    container.appendChild(row);
  }

  var FILTER_OPERATOR_OPTIONS = [
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Not equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'in', label: 'In' },
    { value: 'gt', label: 'Greater than' },
    { value: 'lt', label: 'Less than' }
  ];

  function addFilterRow() {
    var container = document.getElementById('custFiltersContainer');
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = '<input type="text" placeholder="Column" class="w-28 border border-gray-300 rounded px-2 py-1 text-sm cust-filter-col" maxlength="100">'
      + '<lex-select class="w-32 cust-filter-op" value="equals" options="' + escapeHtml(JSON.stringify(FILTER_OPERATOR_OPTIONS)) + '"></lex-select>'
      + '<input type="text" placeholder="Value" class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm cust-filter-val" maxlength="255">'
      + '<button type="button" class="text-red-500 hover:text-red-700 text-xs" data-reporting-action="remove-row">Remove</button>';
    container.appendChild(row);
  }

  function collectCustomizationData() {
    var data = {
      module_key: selectedModuleKey || '',
      customization_name: (document.getElementById('custName') || {}).value || '',
      description: (document.getElementById('custDescription') || {}).value || undefined
    };

    // Metric overrides
    var metricMode = (document.getElementById('custMetricMode') || {}).value;
    if (metricMode) {
      var metricInputs = document.querySelectorAll('.cust-metric-input');
      var metrics = [];
      metricInputs.forEach(function (input) {
        var val = input.value.trim();
        if (val) metrics.push({ key: val });
      });
      data.metric_overrides = {
        mode: metricMode,
        metrics: metricMode !== 'remove' ? metrics : [],
        remove_keys: metricMode === 'remove' ? metrics.map(function (m) { return m.key; }) : []
      };
    }

    // Dimension overrides
    var dimMode = (document.getElementById('custDimensionMode') || {}).value;
    if (dimMode) {
      var dimInputs = document.querySelectorAll('.cust-dimension-input');
      var dimensions = [];
      dimInputs.forEach(function (input) {
        var val = String(input.value || '').trim();
        if (val) dimensions.push({ key: val });
      });
      data.dimension_overrides = {
        mode: dimMode,
        dimensions: dimMode !== 'remove' ? dimensions : [],
        remove_keys: dimMode === 'remove' ? dimensions.map(function (d) { return d.key; }) : []
      };
    }

    // Filter overrides
    var filterMode = (document.getElementById('custFilterMode') || {}).value;
    if (filterMode) {
      var filterRows = document.querySelectorAll('#custFiltersContainer > div');
      var filters = [];
      filterRows.forEach(function (row) {
        var col = row.querySelector('.cust-filter-col');
        var op = row.querySelector('.cust-filter-op');
        var val = row.querySelector('.cust-filter-val');
        if (col && col.value && op && val) {
          var f = { column: col.value.trim(), operator: op.value };
          if (op.value === 'in') {
            f.values = val.value.split(',').map(function (v) { return v.trim(); });
          } else {
            f.value = val.value.trim();
          }
          filters.push(f);
        }
      });
      data.filter_overrides = { mode: filterMode, filters: filters };
    }

    return data;
  }

  async function saveCustomization(setAsDefault) {
    var data = collectCustomizationData();
    if (!data.module_key || !data.customization_name) {
      showError('Pick a report and name your view.');
      return;
    }

    try {
      var result = await api.post('/api/v1/module-customizations', data);
      if (result && result.data && setAsDefault) {
        await api.post('/api/v1/module-customizations/' + result.data.id + '/set-default');
      }
      showInfo('Customization saved' + (setAsDefault ? ' and set as default' : ''));
      loadExistingCustomizations();
      updateCustomizationBadge();
      // Clear form
      if (document.getElementById('custName')) document.getElementById('custName').value = '';
      if (document.getElementById('custDescription')) document.getElementById('custDescription').value = '';
    } catch (err) {
      showError('Failed to save customization: ' + (err.message || err));
    }
  }

  async function setCustomizationDefault(id) {
    try {
      await api.post('/api/v1/module-customizations/' + id + '/set-default');
      showInfo('Customization set as default');
      loadExistingCustomizations();
      updateCustomizationBadge();
    } catch (err) {
      showError('Failed to set default: ' + (err.message || err));
    }
  }

  async function deleteCustomization(id) {
    var confirmed = await Lex.Modal.confirmAsync('Delete customization', 'Delete this saved customization? This cannot be undone.', {
      variant: 'danger',
      confirmText: 'Delete'
    });
    if (!confirmed) return;
    try {
      await api.delete('/api/v1/module-customizations/' + id);
      showInfo('Customization deleted');
      loadExistingCustomizations();
      updateCustomizationBadge();
    } catch (err) {
      showError('Failed to delete customization: ' + (err.message || err));
    }
  }

  async function removeCustomizationDefault() {
    // There is no "unset default" API — we'd need to delete + recreate.
    // For now, just delete the default and let the user know.
    try {
      var result = await api.get('/api/v1/module-customizations/modules/' + encodeURIComponent(selectedModuleKey) + '/effective');
      if (result && result.data && result.data.customization) {
        await api.delete('/api/v1/module-customizations/' + result.data.customization.id);
        showInfo('Default customization removed');
        loadExistingCustomizations();
        updateCustomizationBadge();
      }
    } catch (err) {
      showError('Failed to remove default: ' + (err.message || err));
    }
  }

  async function updateCustomizationBadge() {
    var badge = document.getElementById('customizationBadge');
    if (!badge || !selectedModuleKey) {
      if (badge) badge.style.display = 'none';
      return;
    }
    try {
      var result = await api.get('/api/v1/module-customizations/modules/' + encodeURIComponent(selectedModuleKey) + '/effective');
      if (result && result.data && result.data.has_customization) {
        badge.textContent = 'Customized';
        badge.style.display = 'inline';
      } else {
        badge.style.display = 'none';
      }
    } catch (err) {
      badge.style.display = 'none';
    }
  }

  // Once per mount (init runs twice on a first visit, the page then the
  // router); the panel's controls come with it.
  function initCustomizePanel() {
    var panel = document.getElementById('customizePanel');
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = 'true';

    var customizeBtn = document.getElementById('customizeBtn');
    if (customizeBtn) customizeBtn.addEventListener('click', openCustomizePanel);

    var saveBtn = document.getElementById('saveCustomizationBtn');
    if (saveBtn) saveBtn.addEventListener('click', function () { saveCustomization(false); });

    var saveDefaultBtn = document.getElementById('saveAndSetDefaultBtn');
    if (saveDefaultBtn) saveDefaultBtn.addEventListener('click', function () { saveCustomization(true); });

    var addMetricBtn = document.getElementById('addMetricBtn');
    if (addMetricBtn) addMetricBtn.addEventListener('click', addMetricRow);

    var addDimBtn = document.getElementById('addDimensionBtn');
    if (addDimBtn) addDimBtn.addEventListener('click', addDimensionRow);

    var addFilterBtn = document.getElementById('addFilterBtn');
    if (addFilterBtn) addFilterBtn.addEventListener('click', addFilterRow);

    var removeDefaultBtn = document.getElementById('removeDefaultBtn');
    if (removeDefaultBtn) removeDefaultBtn.addEventListener('click', removeCustomizationDefault);

    // Toggle sub-sections based on mode selectors
    ['custMetricMode', 'custDimensionMode', 'custFilterMode'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (sel) {
        sel.addEventListener('lex-change', function () {
          var listId = id.replace('Mode', 'sList');
          var listEl = document.getElementById(listId);
          if (listEl) listEl.classList.toggle('hidden', !sel.value);
        });
      }
    });
  }

  // Customize is hidden for now (report.html); its code stays. A selected
  // module still refreshes the customization badge.
  function showCustomizeButton() {
    updateCustomizationBadge();
  }

  window._reporting = {
    openMetricInfo: openMetricInfo,
    editMetricGoal: editMetricGoal,
    showModuleInfo: showModuleInfo,
    closeModuleInfo: closeModuleInfo,
    exportToPDF: exportToPDF,
    exportToCSV: exportToCSV,
    closeDrilldownModal: closeDrilldownModal,
    openGenericDrilldown: openGenericDrilldown,
    showMetricDrilldown: showMetricDrilldown,
    closeDataSourcesModal: closeDataSourcesModal,
    closeMissingEntitiesModal: closeMissingEntitiesModal,
    deleteImportedReport: deleteImportedReport,
    openCustomizePanel: openCustomizePanel,
    closeCustomizePanel: closeCustomizePanel,
    setCustomizationDefault: setCustomizationDefault,
    deleteCustomization: deleteCustomization
  };

  // Also expose individually for older callers
  window.showMetricDrilldown = showMetricDrilldown;
  window.openGenericDrilldown = openGenericDrilldown;
  window.closeDrilldownModal = closeDrilldownModal;
  window.closeDataSourcesModal = closeDataSourcesModal;
  window.closeMissingEntitiesModal = closeMissingEntitiesModal;
  window.closeModuleInfo = closeModuleInfo;
  window.showModuleInfo = showModuleInfo;

  // ==========================================================================
  // Init
  // ==========================================================================

  // "Add to dashboard": pick one of the firm's dashboards and add the tile.
  async function openAddToDashboard(metricKey, metricName) {
    var list;
    try {
      var response = await api.listBIDashboards({ limit: 100, offset: 0, sort: 'name', order: 'asc', writable: 'true' });
      list = response && Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      showError('Dashboards could not load. Please try again.');
      return;
    }
    if (!list.length) {
      Lex.Modal.alert('No dashboards you can change', 'Create a dashboard, or ask its owner to share it with you, then add this to it.');
      return;
    }
    var options = list.map(function (d) { return { value: d.id, label: d.name || 'Untitled dashboard' }; });
    var modal = Lex.Modal.open({
      heading: 'Add to dashboard',
      size: 'sm',
      content: '<p class="reporting-add-tile__text">Add ' + escapeHtml(metricName || 'this number')
        + ' to a dashboard. It will show there as a tile that opens this report.</p>'
        + '<lex-select id="addTileDashboardSelect" label="Dashboard" value="' + escapeHtml(options[0].value) + '"></lex-select>',
      confirmText: 'Add',
      onConfirm: async function () {
        var select = document.getElementById('addTileDashboardSelect');
        var dashboardId = select ? select.value : options[0].value;
        try {
          var result = await DashboardTiles.addTileToDashboard(api, dashboardId, metricKey);
          var where = result.name ? ' "' + result.name + '"' : '';
          Lex.Toast.success(result.added ? 'Added to' + where + '.' : 'Already on' + where + '.');
        } catch (error) {
          Lex.Toast.error(error.message || 'Could not add it. Please try again.');
        }
      }
    });
    var select = modal.querySelector('#addTileDashboardSelect');
    if (select) select.options = options;
  }

  // Tile buttons carry data attributes; this one listener runs them.
  function onTileClick(event) {
    var target = event.target;
    var add = target.closest('[data-add-to-dashboard]');
    if (add) return openAddToDashboard(add.getAttribute('data-add-to-dashboard'), add.getAttribute('data-metric-name'));
    var drill = target.closest('[data-metric-drilldown]');
    if (drill) {
      var key = drill.getAttribute('data-metric-key');
      var name = drill.getAttribute('data-metric-name');
      return drill.getAttribute('data-metric-drilldown') === 'generic' ? openGenericDrilldown(key, name) : showMetricDrilldown(key, name);
    }
    var info = target.closest('[data-metric-info]');
    if (info) return openMetricInfo(info.getAttribute('data-metric-info'));
    var goal = target.closest('[data-metric-edit-goal]');
    if (goal) return editMetricGoal(goal.getAttribute('data-metric-edit-goal'));
  }

  // Page buttons (help panels, modal close, customizations, Remove rows)
  // carry data-reporting-action; this one document listener runs them, so
  // buttons inside drawers and modals work wherever Lex mounts them.
  var PAGE_ACTIONS = {
    'export-pdf': function () { exportToPDF(); },
    'export-csv': function () { exportToCSV(); },
    'delete-report': function () { deleteSelectedReport(); },
    'show-module-info': function () { showModuleInfo(); },
    'close-module-info': function () { closeModuleInfo(); },
    'close-data-sources': function () { closeDataSourcesModal(); },
    'close-missing-entities': function () { closeMissingEntitiesModal(); },
    'show-help': function (el) {
      var panel = document.getElementById(el.getAttribute('data-help-modal'));
      if (panel) panel.classList.remove('hidden');
    },
    'hide-help': function (el) {
      var panel = document.getElementById(el.getAttribute('data-help-modal'));
      if (panel) panel.classList.add('hidden');
    },
    'set-default-customization': function (el) { setCustomizationDefault(el.getAttribute('data-customization-id')); },
    'delete-customization': function (el) { deleteCustomization(el.getAttribute('data-customization-id')); },
    'remove-row': function (el) { if (el.parentElement) el.parentElement.remove(); }
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

  function initTileActions() {
    var container = document.getElementById('reportingMainColumn');
    if (!container || container.dataset.tileActionsBound) return;
    container.dataset.tileActionsBound = 'true';
    container.addEventListener('click', onTileClick);
  }

  function init() {
    initPageActions();
    initTileActions();
    bindShellBack();
    initPeriodControls();
    initCustomizePanel();
    // Data sources and missing entities buttons (once per mount: init runs
    // twice on a first visit, the page then the router).
    var dataSourcesBtn = document.getElementById('dataSourcesBtn');
    if (dataSourcesBtn && !dataSourcesBtn.dataset.bound) {
      dataSourcesBtn.dataset.bound = 'true';
      dataSourcesBtn.addEventListener('click', openDataSourcesModal);
    }

    var missingEntitiesBtn = document.getElementById('missingEntitiesBtn');
    if (missingEntitiesBtn && !missingEntitiesBtn.dataset.bound) {
      missingEntitiesBtn.dataset.bound = 'true';
      missingEntitiesBtn.addEventListener('click', openMissingEntitiesModal);
    }
    loadReport();
  }

  if (typeof LexRouter !== 'undefined') {
    LexRouter.registerPageInit('admin/report.html', init);
  }
  init();

})();

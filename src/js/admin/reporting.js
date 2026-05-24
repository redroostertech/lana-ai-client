/* Lex UI — Admin Reporting Page Controller
   V2 page controller for admin/reporting.html.
   Module sidebar, period controls, and report execution shell.
*/

(function () {
  'use strict';

  // ==========================================================================
  // State
  // ==========================================================================

  var allModules = [];
  var moduleCategories = {};
  var selectedModuleKey = null;

  // Visualization state
  var currentDataSources = [];
  var currentMissingEntities = [];
  var currentModuleMetadata = null;
  var currentModuleConfig = null;
  var currentModuleData = null;
  var chartInstances = {};
  var drilldownRenderer = null;
  var currentOverrideMetric = null;
  var currentOverrideData = null;
  var trendsChart = null;
  var statusChart = null;
  var timeSeriesChart = null;
  var reportingModuleContextDismissed = false;

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function formatDate(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function showInfo(message) {
    var infoEl = document.getElementById('executionInfo');
    var infoTextEl = document.getElementById('executionInfoText');
    var errEl = document.getElementById('executionError');
    if (infoTextEl) infoTextEl.textContent = message;
    if (infoEl) infoEl.style.display = 'block';
    if (errEl) errEl.style.display = 'none';
  }

  function showError(message) {
    var errEl = document.getElementById('executionError');
    var errTextEl = document.getElementById('executionErrorText');
    var infoEl = document.getElementById('executionInfo');
    if (errTextEl) errTextEl.textContent = message;
    if (errEl) errEl.style.display = 'block';
    if (infoEl) infoEl.style.display = 'none';
  }

  function hideError() {
    var errEl = document.getElementById('executionError');
    if (errEl) errEl.style.display = 'none';
  }

  // Escape HTML to prevent XSS when inserting values into innerHTML
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Format currency
  function formatCurrency(value) {
    if (value === null || value === undefined) return 'N/A';
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
    if (value === null || value === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }

  // Format percentage
  function formatPercentage(value, decimals) {
    if (decimals === undefined) decimals = 1;
    if (value === null || value === undefined) return 'N/A';
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

  // Format date range using org timezone via canonical helper
  function formatDateRange(start, end) {
    return formatDateLong(start, { month: 'short' }) + ' - ' + formatDateLong(end, { month: 'short' });
  }

  // ==========================================================================
  // Period Presets
  // ==========================================================================

  function selectPeriodPreset(preset) {
    var today = new Date();
    var startDate, endDate;

    switch (preset) {
      case 'last7days':
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 6);
        break;
      case 'last30days':
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 29);
        break;
      case 'thisMonth':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(today);
        break;
      case 'lastMonth':
        startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        endDate = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'thisQuarter':
        var currentQuarter = Math.floor(today.getMonth() / 3);
        startDate = new Date(today.getFullYear(), currentQuarter * 3, 1);
        endDate = new Date(today);
        break;
      case 'thisYear':
        startDate = new Date(today.getFullYear(), 0, 1);
        endDate = new Date(today);
        break;
      case 'lastYear':
        startDate = new Date(today.getFullYear() - 1, 0, 1);
        endDate = new Date(today.getFullYear() - 1, 11, 31);
        break;
      default:
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 7);
    }

    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');
    if (periodStartEl) periodStartEl.value = formatDate(startDate);
    if (periodEndEl) periodEndEl.value = formatDate(endDate);

    updateCompareByOptions(startDate, endDate, preset);
    showInfo('Period set to: ' + formatDate(startDate) + ' to ' + formatDate(endDate));
  }

  function updateCompareByOptions(startDate, endDate, preset) {
    var periodTypeEl = document.getElementById('periodType');
    if (!periodTypeEl) return;

    var currentValue = periodTypeEl.value;
    var durationMs = endDate - startDate;
    var durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));

    var allOptions = [
      { value: 'daily',     label: 'Daily' },
      { value: 'weekly',    label: 'Weekly' },
      { value: 'monthly',   label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'yearly',    label: 'Yearly' }
    ];

    if (preset === 'lastYear' || (durationDays >= 365 && durationDays <= 366)) {
      periodTypeEl.options = [{ value: 'monthly', label: 'Monthly' }];
      periodTypeEl.value = 'monthly';
    } else {
      periodTypeEl.options = allOptions;
      if (['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].indexOf(currentValue) !== -1) {
        periodTypeEl.value = currentValue;
      } else {
        periodTypeEl.value = 'monthly';
      }
    }
  }

  function initPeriodControls() {
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
          updateCompareByOptions(new Date(startVal + 'T00:00:00'), new Date(endVal + 'T23:59:59'), null);
        }
      });
    }

    if (periodEndEl) {
      periodEndEl.addEventListener('lex-change', function () {
        var startVal = periodStartEl ? periodStartEl.value : '';
        var endVal = periodEndEl.value;
        if (startVal && endVal) {
          updateCompareByOptions(new Date(startVal + 'T00:00:00'), new Date(endVal + 'T23:59:59'), null);
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

    // Default: Last 7 days
    selectPeriodPreset('last7days');
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
      currentDataSources.forEach(function (connector) {
        var connectorCard = document.createElement('div');
        connectorCard.className = 'flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors';
        connectorCard.innerHTML = '<div class="flex-shrink-0">' +
          '<svg class="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"></path>' +
          '</svg></div>' +
          '<div class="flex-1 min-w-0">' +
          '<p class="text-sm font-medium text-gray-900 truncate">' + (connector.name || connector.connectorType) + '</p>' +
          '<p class="text-xs text-gray-500">' + (connector.connectorType || '') + '</p>' +
          '</div>' +
          '<div class="flex-shrink-0">' +
          '<span class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Active</span>' +
          '</div>';
        list.appendChild(connectorCard);
      });
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
      showError('No module data available. Please execute a module first.');
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
      showError('Please select a report module from the sidebar.');
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

    // Convert dates to ISO format
    var periodStartISO = new Date(startDate + 'T00:00:00Z').toISOString();
    var periodEndISO = new Date(endDate + 'T23:59:59Z').toISOString();

    // Loading state
    if (executeBtn) executeBtn.loading = true;
    hideError();
    showInfo('Executing ' + selectedModuleKey + ' from ' + startDate + ' to ' + endDate + '...');

    // Hide previous results and restore topbar LANA button while loading
    var resultsEl = document.getElementById('moduleResults');
    if (resultsEl) resultsEl.style.display = 'none';
    setTopbarLanaVisible(true);

    try {
      var startTime = Date.now();

      var data = await api.post('/api/v1/modules/' + selectedModuleKey + '/execute', {
        periodType: periodType,
        periodStart: periodStartISO,
        periodEnd: periodEndISO,
        compareBy: periodType,
        useCache: false
      });

      var endTime = Date.now();
      var executionTimeMs = endTime - startTime;

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
      reportingModuleContextDismissed = false;

      // Update module header
      var moduleTitleEl = document.getElementById('moduleTitle');
      var executionTimeEl = document.getElementById('executionTime');
      if (moduleTitleEl) moduleTitleEl.textContent = data.moduleName || 'Module Results';
      if (executionTimeEl) executionTimeEl.textContent = executionTimeMs + 'ms';

      // Update period info
      var resultPeriodTypeEl = document.getElementById('resultPeriodType');
      if (resultPeriodTypeEl) {
        resultPeriodTypeEl.textContent = data.period.type || (periodType.charAt(0).toUpperCase() + periodType.slice(1));
      }

      var resultCurrentPeriodEl = document.getElementById('resultCurrentPeriod');
      if (resultCurrentPeriodEl) {
        resultCurrentPeriodEl.textContent = formatDateRange(data.period.start, data.period.end);
      }

      var resultPriorPeriodEl = document.getElementById('resultPriorPeriod');
      if (resultPriorPeriodEl) {
        if (data.priorPeriod && data.priorPeriod.start && data.priorPeriod.end) {
          resultPriorPeriodEl.textContent = formatDateRange(data.priorPeriod.start, data.priorPeriod.end);
        } else {
          resultPriorPeriodEl.textContent = 'N/A';
        }
      }

      // Update data sources
      updateDataSources(data.dataSources || []);

      // Render visualizations based on backend response (section-driven)
      renderVisualizations(data);

      // Hide placeholder, show results area
      var placeholder = document.getElementById('reportingPlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      if (resultsEl) resultsEl.style.display = 'flex';

      // Hide topbar LANA button when in-card Ask LANA is visible
      setTopbarLanaVisible(false);

      showInfo('Module executed successfully in ' + executionTimeMs + 'ms. ' + (data.metrics ? data.metrics.length : 0) + ' metrics calculated.');
      attachCurrentModuleContextToComposer();

    } catch (error) {
      console.error('[Reporting] Execution failed:', error);
      showError(error.message || 'Failed to execute report. Please try again.');
    } finally {
      if (executeBtn) executeBtn.loading = false;
    }
  }

  // ==========================================================================
  // Chart Rendering
  // ==========================================================================

  function renderMetricChart(metric, canvasId) {
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
    var counts = sortedData.map(function (item) { return item.count || 0; });
    var percentages = sortedData.map(function (item) { return parseFloat(item.value) || 0; });

    var backgroundColors = labels.map(function (_, i) {
      var intensity = 1 - (i / labels.length) * 0.5;
      return 'rgba(99, 102, 241, ' + intensity + ')';
    });

    var maxCount = Math.max.apply(null, counts);

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
                var percentage = percentages[context.dataIndex] || 0;
                return count + ' leads (' + percentage + '%)';
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

  async function showLeadSourceDrilldown(metricKey, source) {
    var modal = document.getElementById('drilldownModal');
    var title = document.getElementById('drilldownTitle');
    var content = document.getElementById('drilldownContent');
    if (!modal || !title || !content) return;

    title.textContent = 'Leads from: ' + source;
    content.innerHTML = '<div class="text-center py-8"><div class="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto"></div><p class="text-gray-600 mt-4">Loading leads...</p></div>';
    modal.classList.remove('hidden');

    try {
      var periodStart = document.getElementById('periodStart').value + 'T00:00:00Z';
      var periodEnd = document.getElementById('periodEnd').value + 'T23:59:59Z';

      var response = await api.get('/api/v1/integrations/connector-data?entity_type=contact&source=' + encodeURIComponent(source) + '&start_date=' + periodStart + '&end_date=' + periodEnd);

      if (!response || !response.data || response.data.length === 0) {
        content.innerHTML = '<div class="text-center py-8 text-gray-500">No leads found for this source.</div>';
        return;
      }

      var rowsHTML = response.data.map(function (lead) {
        var name = (lead.data && lead.data.name) || ((lead.data && lead.data.firstName && lead.data.lastName) ? lead.data.firstName + ' ' + lead.data.lastName : 'N/A');
        var email = (lead.data && lead.data.email) || 'N/A';
        var phone = (lead.data && lead.data.phone) || 'N/A';
        var company = (lead.data && lead.data.company) || 'N/A';
        var created = formatDate(lead.source_created_at);
        return '<tr class="hover:bg-gray-50">' +
          '<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">' + name + '</td>' +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + email + '</td>' +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + phone + '</td>' +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + company + '</td>' +
          '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">' + created + '</td></tr>';
      }).join('');

      content.innerHTML = '<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">' +
        '<thead class="bg-gray-50"><tr>' +
        '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>' +
        '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>' +
        '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>' +
        '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>' +
        '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>' +
        '</tr></thead><tbody class="bg-white divide-y divide-gray-200">' + rowsHTML + '</tbody></table></div>' +
        '<div class="mt-4 text-sm text-gray-600 text-center">Showing ' + response.data.length + ' lead' + (response.data.length !== 1 ? 's' : '') +
        (response.data.length >= 100 ? ' (limited to 100)' : '') + '</div>';

    } catch (error) {
      console.error('Failed to load lead source drilldown:', error);
      content.innerHTML = '<div class="text-center py-8 text-red-600">Failed to load leads: ' + (error.message || 'Unknown error') + '</div>';
    }
  }

  async function openGenericDrilldown(metricKey, metricName) {
    try {
      var periodStart = document.getElementById('periodStart').value + 'T00:00:00Z';
      var periodEnd = document.getElementById('periodEnd').value + 'T23:59:59Z';
      var moduleKey = selectedModuleKey || 'growth-intake-performance';

      if (!drilldownRenderer) {
        drilldownRenderer = new DrilldownRenderer();
        window.drilldownRenderer = drilldownRenderer;
      }

      await drilldownRenderer.open(moduleKey, metricKey, {
        periodStart: periodStart,
        periodEnd: periodEnd
      });
    } catch (error) {
      console.error('Failed to open drilldown:', error);
      alert('Failed to load drilldown: ' + (error.message || 'Unknown error'));
    }
  }

  function closeDrilldownModal() {
    var modal = document.getElementById('drilldownModal');
    if (modal) modal.classList.add('hidden');
  }

  async function showFunnelStageDrilldown(stageInfo) {
    try {
      var pipelineId = stageInfo.pipeline_id;
      var position = stageInfo.position !== undefined ? stageInfo.position : 0;
      var periodStart = document.getElementById('periodStart') ? document.getElementById('periodStart').value + 'T00:00:00Z' : '';
      var periodEnd = document.getElementById('periodEnd') ? document.getElementById('periodEnd').value + 'T23:59:59Z' : '';
      var moduleKey = selectedModuleKey || 'funnel-analysis-attribution';

      if (!drilldownRenderer) {
        drilldownRenderer = new DrilldownRenderer();
        window.drilldownRenderer = drilldownRenderer;
      }

      await drilldownRenderer.open(moduleKey, 'funnel_stage_progression', {
        periodStart: periodStart,
        periodEnd: periodEnd,
        drill_source: stageInfo.label || '',
        pipeline_id: pipelineId || '',
        position: position
      });
    } catch (error) {
      console.error('Failed to open funnel drilldown:', error);
      // Fallback to simple modal if DrilldownRenderer fails
      var modal = document.getElementById('drilldownModal');
      var title = document.getElementById('drilldownTitle');
      var content = document.getElementById('drilldownContent');
      if (modal && title && content) {
        title.textContent = (stageInfo.pipelineName || '') + ' — ' + (stageInfo.label || 'Stage');
        content.innerHTML = '<div class="text-center py-8 text-red-600">Failed to load drilldown: ' + (error.message || 'Unknown error') + '</div>';
        modal.classList.remove('hidden');
      }
    }
  }


  function escapeHtml(text) {
    if (!text || text === 'N/A') return text || '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  function attachCellTooltipHandlers() {
    var existingTooltip = document.getElementById('cell-tooltip-popover');
    if (existingTooltip) existingTooltip.remove();

    document.querySelectorAll('.cell-tooltip-trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        showCellTooltip(trigger);
      });
    });

    document.addEventListener('click', function () {
      var tooltip = document.getElementById('cell-tooltip-popover');
      if (tooltip) tooltip.remove();
    });
  }

  function showCellTooltip(trigger) {
    var existingTooltip = document.getElementById('cell-tooltip-popover');
    if (existingTooltip) {
      existingTooltip.remove();
      return;
    }

    var tooltipText = trigger.getAttribute('data-tooltip');
    if (!tooltipText) return;

    var tooltip = document.createElement('div');
    tooltip.id = 'cell-tooltip-popover';
    tooltip.className = 'absolute z-50 bg-gray-900 text-white text-sm rounded-lg shadow-lg p-3 max-w-xs';
    tooltip.innerHTML = tooltipText;
    tooltip.style.pointerEvents = 'none';

    var rect = trigger.getBoundingClientRect();
    tooltip.style.left = (rect.left + window.scrollX) + 'px';
    tooltip.style.top = (rect.bottom + window.scrollY + 5) + 'px';
    document.body.appendChild(tooltip);

    setTimeout(function () {
      var tooltipRect = tooltip.getBoundingClientRect();
      if (tooltipRect.right > window.innerWidth) {
        tooltip.style.left = (window.innerWidth - tooltipRect.width - 10) + 'px';
      }
      if (tooltipRect.bottom > window.innerHeight) {
        tooltip.style.top = (rect.top + window.scrollY - tooltipRect.height - 5) + 'px';
      }
    }, 0);
  }

  function renderGenericDrilldown(content, config, rows, pagination, summary) {
    var columns = config.columns;

    function formatCellValue(value, type) {
      if (value === null || value === undefined) return '-';
      if (type === 'currency') {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
      }
      if (type === 'number') return new Intl.NumberFormat('en-US').format(value);
      if (type === 'percentage') return parseFloat(value).toFixed(1) + '%';
      if (type === 'date') {
        if (!value) return '-';
        return formatDateLong(value, { month: 'short' });
      }
      return value;
    }

    var summaryHTML = '';
    if (summary) {
      var summaryEntries = Object.entries(summary).map(function (entry) {
        var key = entry[0];
        var value = entry[1];
        var label = key.split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
        return '<div><p class="text-xs text-gray-500">' + label + '</p><p class="text-lg font-semibold text-gray-900">' + formatCellValue(value, 'currency') + '</p></div>';
      }).join('');
      summaryHTML = '<div class="bg-gray-50 rounded-lg p-4 mb-6"><h3 class="text-sm font-semibold text-gray-700 mb-2">Summary</h3><div class="grid grid-cols-2 gap-4">' + summaryEntries + '</div></div>';
    }

    var headerHTML = columns.map(function (col) {
      return '<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">' + col.header + '</th>';
    }).join('');

    var bodyHTML = '';
    if (rows.length > 0) {
      bodyHTML = rows.map(function (row) {
        var cellsHTML = columns.map(function (col) {
          var formattedValue = formatCellValue(row[col.field], col.type);
          var tooltipIcon = col.tooltip ? '<svg class="inline-block ml-1 h-4 w-4 text-gray-400 cursor-pointer hover:text-gray-600 cell-tooltip-trigger" fill="none" viewBox="0 0 24 24" stroke="currentColor" data-tooltip="' + col.tooltip + '"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>' : '';
          return '<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">' + formattedValue + tooltipIcon + '</td>';
        }).join('');
        return '<tr class="hover:bg-gray-50">' + cellsHTML + '</tr>';
      }).join('');
    } else {
      bodyHTML = '<tr><td colspan="' + columns.length + '" class="px-6 py-8 text-center text-gray-500">No data available for this period</td></tr>';
    }

    var paginationHTML = '';
    if (pagination && pagination.totalRecords > pagination.pageSize) {
      paginationHTML = '<div class="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">' +
        '<p class="text-sm text-gray-600">Showing ' + rows.length + ' of ' + pagination.totalRecords + ' records</p>' +
        '<p class="text-xs text-gray-500">(Pagination coming soon)</p></div>';
    }

    content.innerHTML = '<div class="p-6">' +
      (config.description ? '<p class="text-sm text-gray-600 mb-4">' + config.description + '</p>' : '') +
      summaryHTML +
      '<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">' +
      '<thead class="bg-gray-50"><tr>' + headerHTML + '</tr></thead>' +
      '<tbody class="bg-white divide-y divide-gray-200">' + bodyHTML + '</tbody></table></div>' +
      paginationHTML + '</div>';

    attachCellTooltipHandlers();
  }

  async function showMetricDrilldown(metricKey, metricName) {
    var modal = document.getElementById('drilldownModal');
    var title = document.getElementById('drilldownTitle');
    var content = document.getElementById('drilldownContent');
    if (!modal || !title || !content) return;

    try {
      var periodStart = document.getElementById('periodStart').value + 'T00:00:00Z';
      var periodEnd = document.getElementById('periodEnd').value + 'T23:59:59Z';
      var moduleKey = selectedModuleKey || 'growth-intake-performance';

      var hasGenericDrilldown = await tryGenericDrilldown(content, moduleKey, metricKey, periodStart, periodEnd);
      if (hasGenericDrilldown) return;

      title.textContent = metricName + ' - Details';
      content.innerHTML = '<div class="text-center py-8"><div class="animate-spin h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto"></div><p class="text-gray-600 mt-4">Loading data...</p></div>';
      modal.classList.remove('hidden');

      // Default: drill-down not available for legacy metrics
      content.innerHTML = '<div class="text-center py-8 text-gray-500">Drill-down not available for this metric.</div>';

    } catch (error) {
      console.error('Failed to load metric drilldown:', error);
      content.innerHTML = '<div class="text-center py-8 text-red-600">Failed to load data: ' + (error.message || 'Unknown error') + '</div>';
    }
  }

  // ==========================================================================
  // Markdown Helpers
  // ==========================================================================

  function renderMarkdownInline(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);
    if (typeof marked !== 'undefined' && marked && typeof marked.parseInline === 'function') {
      try { return marked.parseInline(text); } catch (e) { return text; }
    }
    return text;
  }

  function renderMarkdownBlock(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);
    if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
      try {
        var html = marked.parse(text).trim();
        if (html.indexOf('<p>') === 0 && html.lastIndexOf('</p>') === html.length - 4 && html.split('<p>').length === 2) {
          html = html.slice(3, -4);
        }
        return html;
      } catch (e) {
        return text.split('\n').join('<br>');
      }
    }
    return text.split('\n').join('<br>');
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

    return '<button onclick="document.getElementById(\'' + modalId + '\').classList.remove(\'hidden\')" class="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors" title="Click for help understanding this chart">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>' +
      '<div id="' + modalId + '" class="hidden fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">' +
      '<div class="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">' +
      '<div class="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">' +
      '<h3 class="text-xl font-bold text-gray-900">' + (helpText.title || 'Help') + '</h3>' +
      '<button onclick="document.getElementById(\'' + modalId + '\').classList.add(\'hidden\')" class="text-gray-400 hover:text-gray-600 transition-colors">' +
      '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div>' +
      '<div class="px-6 py-6">' + sectionsHTML + '</div>' +
      '<div class="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4">' +
      '<button onclick="document.getElementById(\'' + modalId + '\').classList.add(\'hidden\')" class="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium">Got it!</button></div></div></div>';
  }

  // ==========================================================================
  // Metric Card Rendering
  // ==========================================================================

  // Per-render registry of metrics so the inline onclick info handler can look
  // up description/helpText without round-tripping through DOM attributes.
  var _metricInfoRegistry = Object.create(null);

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function infoIconButtonHTML(metric) {
    if (!metric || !metric.key) return '';
    _metricInfoRegistry[metric.key] = {
      name: metric.name || metric.key,
      description: metric.description || '',
      helpText: metric.helpText || null
    };
    var key = String(metric.key).split("'").join("\\'");
    return '<button type="button" aria-label="About this metric" title="About this metric" ' +
      'onclick="window._reporting.openMetricInfo(\'' + key + '\')" ' +
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
      parts.push('<p style="margin:0 0 0.75rem 0;color:var(--lex-text-secondary,#475569);line-height:1.55;">' +
        escapeHtml(entry.description) + '</p>');
    }

    // 2. Help text (structured).
    if (entry.helpText && Array.isArray(entry.helpText.paragraphs) && entry.helpText.paragraphs.length) {
      if (entry.helpText.title) {
        parts.push('<h4 style="margin:0.75rem 0 0.4rem 0;font-size:0.95rem;font-weight:600;color:var(--lex-text-primary,#0f172a);">' +
          escapeHtml(entry.helpText.title) + '</h4>');
      }
      for (var i = 0; i < entry.helpText.paragraphs.length; i++) {
        parts.push('<p style="margin:0 0 0.6rem 0;color:var(--lex-text-secondary,#475569);line-height:1.55;">' +
          escapeHtml(entry.helpText.paragraphs[i]) + '</p>');
      }
    }

    // 3. Business logic prose (if present in the catalog entry).
    var bizLogic = detail && detail.businessLogic;
    if (bizLogic && String(bizLogic).trim().length > 0) {
      parts.push('<h4 style="margin:1rem 0 0.4rem 0;font-size:0.95rem;font-weight:600;color:var(--lex-text-primary,#0f172a);">Business logic</h4>');
      parts.push('<p style="margin:0 0 0.6rem 0;color:var(--lex-text-secondary,#475569);line-height:1.55;">' +
        escapeHtml(bizLogic) + '</p>');
    }

    // 4. Data sources (entities + fields).
    parts.push('<h4 style="margin:1rem 0 0.4rem 0;font-size:0.95rem;font-weight:600;color:var(--lex-text-primary,#0f172a);">Data sources</h4>');
    if (!detail) {
      parts.push('<p style="margin:0 0 0.6rem 0;color:var(--lex-text-muted,#94a3b8);font-style:italic;">Loading…</p>');
    } else if (Array.isArray(detail.entities) && detail.entities.length > 0) {
      for (var j = 0; j < detail.entities.length; j++) {
        var ent = detail.entities[j];
        parts.push(
          '<div style="margin:0 0 0.55rem 0;padding:0.5rem 0.75rem;background:var(--lex-bg-secondary,#f1f5f9);border-radius:6px;">' +
            '<div style="font-size:0.8rem;font-weight:600;color:var(--lex-text-primary,#0f172a);">' +
              escapeHtml(ent.entity_type || '(unknown entity)') +
            '</div>' +
            (ent.description ? '<div style="font-size:0.75rem;color:var(--lex-text-secondary,#475569);margin-top:0.15rem;">' + escapeHtml(ent.description) + '</div>' : '') +
            (Array.isArray(ent.fields) && ent.fields.length
              ? '<div style="font-size:0.7rem;color:var(--lex-text-muted,#64748b);margin-top:0.3rem;font-family:var(--lex-font-mono,monospace);">' +
                ent.fields.map(escapeHtml).join(', ') +
                '</div>'
              : '') +
          '</div>'
        );
      }
    } else {
      parts.push('<p style="margin:0 0 0.6rem 0;color:var(--lex-text-muted,#94a3b8);">No data sources declared.</p>');
    }

    // 5. How it's calculated (calculation shape).
    parts.push('<h4 style="margin:1rem 0 0.4rem 0;font-size:0.95rem;font-weight:600;color:var(--lex-text-primary,#0f172a);">How it\'s calculated</h4>');
    if (!detail) {
      parts.push('<p style="margin:0;color:var(--lex-text-muted,#94a3b8);font-style:italic;">Loading…</p>');
    } else {
      var calc = detail.calculation || {};
      if (typeof calc.ref === 'string' && calc.ref) {
        parts.push(
          '<p style="margin:0 0 0.4rem 0;color:var(--lex-text-secondary,#475569);">Resolves to the central registry executor:</p>' +
          '<code style="display:block;padding:0.5rem 0.75rem;background:var(--lex-bg-secondary,#f1f5f9);border-radius:6px;font-size:0.78rem;color:var(--lex-text-primary,#0f172a);">' +
            escapeHtml(calc.ref) +
          '</code>'
        );
      } else if (calc.spec && typeof calc.spec === 'object') {
        parts.push(
          '<p style="margin:0 0 0.4rem 0;color:var(--lex-text-secondary,#475569);">Computed from an inline spec:</p>' +
          '<pre style="margin:0;padding:0.5rem 0.75rem;background:var(--lex-bg-secondary,#f1f5f9);border-radius:6px;font-size:0.72rem;color:var(--lex-text-primary,#0f172a);white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;">' +
            escapeHtml(JSON.stringify(calc.spec, null, 2)) +
          '</pre>'
        );
      } else if (typeof calc.query === 'string' && calc.query) {
        parts.push(
          '<p style="margin:0 0 0.4rem 0;color:var(--lex-text-secondary,#475569);">Inline SQL query (read-only):</p>' +
          '<pre style="margin:0;padding:0.5rem 0.75rem;background:var(--lex-bg-secondary,#f1f5f9);border-radius:6px;font-size:0.72rem;color:var(--lex-text-primary,#0f172a);white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;">' +
            escapeHtml(calc.query) +
          '</pre>'
        );
      } else {
        parts.push('<p style="margin:0;color:var(--lex-text-muted,#94a3b8);">Calculation details not declared.</p>');
      }
    }

    return parts.join('');
  }

  function openMetricInfo(metricKey) {
    var entry = _metricInfoRegistry[metricKey];
    if (!entry) return;

    if (!(window.Lex && window.Lex.Modal && typeof window.Lex.Modal.open === 'function')) {
      window.alert(entry.name + '\n\n' + (entry.description || ''));
      return;
    }

    // Open the modal immediately with the loading skeleton so the UI feels
    // responsive even if the catalog fetch takes a beat.
    var modal = window.Lex.Modal.open({
      heading: entry.name,
      content: renderMetricInfoBody(entry, null),
      size: 'md',
      hideActions: true
    });

    // Fetch full catalog entry to populate entities + calculation. Cached on
    // the registry entry so subsequent opens skip the network.
    var finalize = function (detail) {
      entry.detail = detail;
      var body = renderMetricInfoBody(entry, detail);
      if (modal && modal.innerHTML !== undefined) {
        // lex-modal.open creates a real DOM element; replacing its slot innerHTML
        // works because we passed `content` as a string on open.
        modal.innerHTML = body;
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
    var statusColor = metric.status === 'error' ? 'gray' : (metric.status || 'gray');
    var totalCount = 0;
    if (Array.isArray(metric.current)) {
      totalCount = metric.current.reduce(function (sum, item) { return sum + (item.count || 0); }, 0);
    }
    var statusColors = getStatusColors(statusColor);

    return '<div class="' + statusColors.bg + ' rounded-xl shadow-sm border ' + statusColors.border + ' p-6 hover:shadow-md transition-shadow">' +
      '<div class="flex items-start justify-between mb-4"><div class="flex-1">' +
      '<h3 class="text-sm font-medium text-gray-500 uppercase tracking-wide">' + metric.name + '</h3>' +
      '<p class="text-xs text-indigo-600 mt-2 font-medium">Click any bar to see actual leads</p></div>' +
      '<div class="flex items-center gap-2">' + infoIconButtonHTML(metric) + '</div></div>' +
      '<div class="mb-4"><p class="text-xs text-gray-500 mb-1">Total Leads</p>' +
      '<p class="text-2xl font-bold text-gray-900">' + formatNumber(totalCount, 0) + '</p></div>' +
      '<div class="mb-4"><canvas id="' + canvasId + '" style="max-height: 250px;"></canvas></div></div>';
  }

  function createMetricCard(metric) {
    if (Array.isArray(metric.current)) {
      return createDistributionMetricCard(metric);
    }

    var isCurrency = metric.type === 'currency' || metric.unit === 'dollars';

    var fmtCurrency = function (value) {
      if (value === null || value === undefined || isNaN(value)) return 'N/A';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    };

    var currentValue, priorValue, targetValue;
    if (isCurrency) {
      currentValue = fmtCurrency(metric.current);
      priorValue = metric.prior !== null ? fmtCurrency(metric.prior) : 'N/A';
      targetValue = fmtCurrency(metric.target);
    } else {
      currentValue = metric.formattedCurrent || formatNumber(metric.current, 0);
      priorValue = metric.formattedPrior || (metric.prior !== null ? formatNumber(metric.prior, 0) : 'N/A');
      targetValue = metric.formattedTarget || formatNumber(metric.target, 0);
    }

    var statusColor = metric.status === 'error' ? 'gray' : (metric.status || 'gray');
    var change = (metric.change !== null && metric.change !== undefined) ? metric.change : null;
    var changeDirection = metric.changeDirection || 'flat';
    var upColor = metric.invertTrend ? 'text-red-600' : 'text-green-600';
    var downColor = metric.invertTrend ? 'text-green-600' : 'text-red-600';

    var changeArrow;
    if (changeDirection === 'up') {
      changeArrow = '<svg class="w-4 h-4 ' + upColor + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path></svg>';
    } else if (changeDirection === 'down') {
      changeArrow = '<svg class="w-4 h-4 ' + downColor + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path></svg>';
    } else {
      changeArrow = '<svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14"></path></svg>';
    }

    var changeText;
    if (isCurrency && change !== null) {
      changeText = fmtCurrency(Math.abs(change));
    } else {
      changeText = metric.formattedChange || (change !== null ? formatNumber(Math.abs(change), 1) : 'N/A');
    }

    var changeColor;
    if (metric.invertTrend) {
      changeColor = change > 0 ? 'text-red-600' : change < 0 ? 'text-green-600' : 'text-gray-600';
    } else {
      changeColor = change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-600';
    }
    var changeLabel = (change !== null && change !== 0) ? (change > 0 ? 'increase' : 'decrease') : 'no change';

    var statusColors = getStatusColors(statusColor);

    // Drilldown button
    var drilldownBtn = '';
    if (metric.hasDrilldown === true) {
      drilldownBtn = '<button onclick="window._reporting.openGenericDrilldown(\'' + metric.key + '\', \'' + metric.name + '\')" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 transition-colors whitespace-nowrap" title="View detailed data breakdown">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>Details</button>';
    } else if (metric.hasDrilldown !== false) {
      drilldownBtn = '<button onclick="window._reporting.showMetricDrilldown(\'' + metric.key + '\', \'' + metric.name + '\')" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 transition-colors whitespace-nowrap" title="View details">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>Details</button>';
    }

    // Comparison section
    var comparisonHTML = '';
    if (!currentModuleConfig || !currentModuleConfig.ui || currentModuleConfig.ui.showComparison !== false) {
      comparisonHTML = '<div class="flex items-center gap-2 mb-4 pb-4 border-b border-gray-100">' +
        changeArrow +
        '<span class="text-sm font-medium ' + changeColor + '">' + changeText + ' ' + changeLabel + '</span></div>';
    }

    // Override button
    var overrideBtn = '<button onclick="window._reporting.openDataOverridePanel(\'' + metric.key + '\', \'' + metric.name + '\', \'' + (metric.description || '').split("'").join("\\'") + '\', ' + metric.target + ', \'target\')" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1" title="Override target value">' +
      '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>Override</button>';

    return '<div data-metric-card class="' + statusColors.bg + ' rounded-xl shadow-sm border ' + statusColors.border + ' hover:shadow-md transition-shadow" style="position:relative;padding:24px 24px 56px 24px;">' +
      // Header: title (auto-fit, up to 2 lines, 14px -> 10px)
      '<div class="mb-4"><div class="flex items-start justify-between gap-2">' +
      '<h3 data-fit-text="14:10:2" class="font-medium text-gray-500 uppercase tracking-wide flex-1 min-w-0" style="font-size:14px;line-height:1.2;">' + metric.name + '</h3>' +
      '</div></div>' +
      // Current period value (auto-fit, 1 line, 30px -> 14px)
      '<div class="mb-4"><div class="flex items-center justify-between mb-1"><p class="text-xs text-gray-500">Current Period</p></div>' +
      '<p data-fit-text="30:14:1" class="font-bold text-gray-900" style="font-size:30px;line-height:1.1;white-space:nowrap;overflow:hidden;">' + currentValue + '</p></div>' +
      comparisonHTML +
      // Prior Period + Target side-by-side; Override sits next to the Target value.
      '<div class="grid grid-cols-2 gap-4 text-sm">' +
      '<div><p class="text-xs text-gray-500 mb-1">Prior Period</p>' +
      '<p data-fit-text="16:11:1" class="font-semibold text-gray-700" style="font-size:16px;line-height:1.2;white-space:nowrap;overflow:hidden;">' + priorValue + '</p></div>' +
      '<div><p class="text-xs text-gray-500 mb-1">Target</p>' +
      '<p data-fit-text="16:11:1" class="font-semibold text-gray-700" style="font-size:16px;line-height:1.2;white-space:nowrap;overflow:hidden;">' + targetValue + '</p>' +
      '<div class="mt-1">' + overrideBtn + '</div>' +
      '</div></div>' +
      // Footer: pinned to card bottom-left / bottom-right with 12px insets.
      '<div style="position:absolute;left:12px;right:12px;bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">' +
      '<div>' + infoIconButtonHTML(metric) + '</div>' +
      '<div>' + drilldownBtn + '</div></div></div>';
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
  // Module Loading
  // ==========================================================================

  async function loadModules() {
    var moduleMenu = document.getElementById('moduleMenu');

    try {
      var response = await api.get('/api/v1/modules');

      allModules = response.modules || [];

      if (response.categories && Array.isArray(response.categories)) {
        response.categories.forEach(function (cat) {
          moduleCategories[cat.key] = cat.name;
        });
      }

      if (!allModules.length) {
        if (moduleMenu) moduleMenu.innerHTML = '<div class="lex-body-sm lex-text-secondary" style="padding:0.75rem;text-align:center;">No modules available</div>';
        return;
      }

      // Group by category
      var modulesByCategory = {};
      allModules.forEach(function (module) {
        var cat = module.category || 'other';
        if (!modulesByCategory[cat]) modulesByCategory[cat] = [];
        modulesByCategory[cat].push(module);
      });

      // Build sidebar menu
      if (moduleMenu) moduleMenu.innerHTML = '';
      var categoryKeys = Object.keys(modulesByCategory).sort();

      categoryKeys.forEach(function (category, index) {
        var modules = modulesByCategory[category];
        var categorySection = document.createElement('div');
        categorySection.style.marginBottom = '0.25rem';
        categorySection.dataset.categorySection = category;

        if (index > 0) {
          categorySection.style.borderTop = '1px solid var(--lex-border-default)';
          categorySection.style.paddingTop = '0.75rem';
          categorySection.style.marginTop = '0.75rem';
        }

        // Category header (collapsible)
        var categoryHeader = document.createElement('button');
        categoryHeader.className = 'w-full';
        categoryHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.375rem 0.5rem;border-radius:var(--lex-radius-md);cursor:pointer;background:none;border:none;width:100%;';
        categoryHeader.dataset.category = category;

        var categoryName = document.createElement('span');
        categoryName.className = 'lex-overline lex-text-secondary';
        categoryName.textContent = moduleCategories[category] || category;
        categoryHeader.appendChild(categoryName);

        var chevron = document.createElement('svg');
        chevron.setAttribute('width', '14');
        chevron.setAttribute('height', '14');
        chevron.setAttribute('fill', 'none');
        chevron.setAttribute('stroke', 'currentColor');
        chevron.setAttribute('stroke-width', '2');
        chevron.setAttribute('viewBox', '0 0 24 24');
        chevron.style.transition = 'transform 0.2s ease';
        chevron.style.color = 'var(--lex-text-tertiary)';
        chevron.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>';
        categoryHeader.appendChild(chevron);
        categorySection.appendChild(categoryHeader);

        // Module items container
        var moduleContainer = document.createElement('div');
        moduleContainer.style.cssText = 'display:flex;flex-direction:column;gap:0.125rem;margin-top:0.25rem;';
        moduleContainer.dataset.categoryModules = category;

        modules.forEach(function (module) {
          var btn = document.createElement('button');
          btn.style.cssText = [
            'display:block;width:100%;text-align:left;padding:0.375rem 0.5rem;',
            'border-radius:var(--lex-radius-md);border:none;background:none;cursor:pointer;',
            'transition:var(--lex-transition-fast);'
          ].join('');
          btn.dataset.moduleKey = module.moduleKey;
          btn.dataset.category = category;
          btn.dataset.moduleName = module.name.toLowerCase();
          btn.dataset.moduleDescription = (module.description || '').toLowerCase();

          if (module.available) {
            btn.style.color = 'var(--lex-text-primary)';
          } else {
            btn.style.color = 'var(--lex-text-disabled)';
            btn.style.cursor = 'not-allowed';
            btn.disabled = true;
          }

          var nameEl = document.createElement('div');
          nameEl.className = 'lex-label-sm';
          nameEl.textContent = module.name;
          btn.appendChild(nameEl);

          if (!module.available) {
            var note = document.createElement('div');
            note.className = 'lex-body-xs lex-text-tertiary';
            note.style.marginTop = '0.125rem';
            note.textContent = 'Requires connectors';
            btn.appendChild(note);
          } else {
            btn.addEventListener('click', function () {
              // Deselect any imported report
              selectedImportedReportId = null;
              // Clear all selections (modules + imported reports)
              moduleMenu.querySelectorAll('button[data-module-key], button[data-report-id]').forEach(function (b) {
                b.style.background = 'none';
                b.style.color = 'var(--lex-text-primary)';
              });
              // Apply active state
              btn.style.background = 'var(--lex-bg-accent-soft)';
              btn.style.color = 'var(--lex-text-accent)';
              // Track selection
              selectedModuleKey = module.moduleKey;
              showCustomizeButton();
              // Update missing entities for this module
              updateMissingEntitiesForModule(module.moduleKey);
            });
          }

          moduleContainer.appendChild(btn);
        });

        categorySection.appendChild(moduleContainer);

        // Collapse / expand on header click
        categoryHeader.addEventListener('click', function () {
          var collapsed = moduleContainer.style.display === 'none';
          if (collapsed) {
            moduleContainer.style.display = 'flex';
            chevron.style.transform = 'rotate(0deg)';
          } else {
            moduleContainer.style.display = 'none';
            chevron.style.transform = 'rotate(-90deg)';
          }
        });

        if (moduleMenu) moduleMenu.appendChild(categorySection);
      });

      // Auto-select first available module
      var firstAvailable = allModules.find(function (m) { return m.available; });
      if (firstAvailable && moduleMenu) {
        selectedModuleKey = firstAvailable.moduleKey;
        showCustomizeButton();
        var firstBtn = moduleMenu.querySelector('button[data-module-key="' + firstAvailable.moduleKey + '"]');
        if (firstBtn) {
          firstBtn.style.background = 'var(--lex-bg-accent-soft)';
          firstBtn.style.color = 'var(--lex-text-accent)';
        }
        updateMissingEntitiesForModule(firstAvailable.moduleKey);
      }

    } catch (error) {
      console.error('[Reporting] Failed to load modules:', error);
      if (moduleMenu) {
        moduleMenu.innerHTML = '<div class="lex-body-sm" style="color:var(--lex-status-danger);padding:0.75rem;text-align:center;">Failed to load modules. Please refresh.</div>';
      }
    }
  }

  // ==========================================================================
  // Module Search
  // ==========================================================================

  function initModuleSearch() {
    var searchInput = document.getElementById('moduleSearchInput');
    var moduleMenu = document.getElementById('moduleMenu');
    var emptyEl = document.getElementById('moduleSearchEmpty');

    if (!searchInput) return;

    // lex-input fires 'lex-input' event
    searchInput.addEventListener('lex-input', function (e) {
      var query = (e.detail && e.detail.value !== undefined) ? e.detail.value.toLowerCase().trim() : '';
      filterModules(query, moduleMenu, emptyEl);
    });

    // Also catch native input from the inner input element
    searchInput.addEventListener('input', function (e) {
      var query = (e.target.value || '').toLowerCase().trim();
      filterModules(query, moduleMenu, emptyEl);
    });
  }

  function filterModules(searchQuery, moduleMenu, emptyEl) {
    if (!moduleMenu) return;

    var moduleItems = moduleMenu.querySelectorAll('button[data-module-key], button[data-report-id]');
    var categorySections = moduleMenu.querySelectorAll('[data-category-section]');

    if (!searchQuery) {
      moduleItems.forEach(function (item) { item.style.display = ''; });
      categorySections.forEach(function (s) { s.style.display = ''; });
      if (emptyEl) emptyEl.style.display = 'none';
      return;
    }

    var searchWords = searchQuery.split(/\s+/).filter(function (w) { return w.length > 0; });
    var visibleCount = 0;
    var visibleCategories = {};
    var hasNameMatches = false;
    var matchResults = [];

    moduleItems.forEach(function (item) {
      var moduleName = item.dataset.moduleName || '';
      var moduleDesc = item.dataset.moduleDescription || '';
      var category = item.dataset.category || '';

      var nameWords = moduleName.split(/[\s&-]+/).filter(function (w) { return w.length > 0; });
      var descWords = moduleDesc.split(/[\s&-]+/).filter(function (w) { return w.length > 0; });

      var nameContainsAll = searchWords.every(function (sw) {
        return nameWords.some(function (nw) { return nw.indexOf(sw) !== -1; });
      });
      var nameStartsWith = moduleName.indexOf(searchQuery) === 0;
      var descMatch = searchQuery.length >= 3 && searchWords.every(function (sw) {
        return descWords.some(function (dw) { return dw.indexOf(sw) !== -1; });
      });

      var nameMatch = nameContainsAll || nameStartsWith;
      if (nameMatch) hasNameMatches = true;

      matchResults.push({ item: item, category: category, nameMatch: nameMatch, descriptionMatch: descMatch });
    });

    matchResults.forEach(function (r) {
      var shouldShow = hasNameMatches ? r.nameMatch : (r.nameMatch || r.descriptionMatch);
      if (shouldShow) {
        r.item.style.display = '';
        visibleCategories[r.category] = true;
        visibleCount++;
      } else {
        r.item.style.display = 'none';
      }
    });

    categorySections.forEach(function (section) {
      var cat = section.dataset.categorySection;
      if (visibleCategories[cat]) {
        section.style.display = '';
        var container = section.querySelector('[data-category-modules]');
        if (container) container.style.display = 'flex';
      } else {
        section.style.display = 'none';
      }
    });

    if (emptyEl) emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
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

    div.innerHTML = '<div class="flex items-center mb-2"><h3 class="text-lg font-semibold text-gray-900">' + (viz.title || 'Metrics Over Time') + '</h3>' + helpTextHTML + '</div>' +
      (viz.description ? '<p class="text-sm text-gray-600 mb-4">' + viz.description + '</p>' : '') +
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
      '<h3 class="text-lg font-semibold text-gray-900">' + (viz.title || 'Current vs Prior Period') + '</h3>' + helpTextHTML + '</div></div>' +
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
            { label: 'Current Period', data: metrics.map(function (m) { return parseFloat(m.current) || 0; }), backgroundColor: '#3b82f6', borderColor: '#2563eb', borderWidth: 1 },
            { label: 'Prior Period', data: metrics.map(function (m) { return parseFloat(m.prior) || 0; }), backgroundColor: '#9ca3af', borderColor: '#6b7280', borderWidth: 1 }
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
      containerDiv.innerHTML = '<div class="bg-white rounded-lg shadow p-6"><h3 class="text-lg font-semibold mb-2">' + (viz.title || 'Distribution') + '</h3>' +
        (viz.description ? '<p class="text-sm text-gray-600 mb-4">' + viz.description + '</p>' : '') +
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
        showFunnelStageDrilldown(stageInfo);
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
        (allCrossZero ? '<p class="text-xs text-amber-600 mb-3">All conversion rates are 0% \u2014 the won leads\' contacts don\'t have any of these tags assigned in your CRM.</p>' : '');
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

    var ruleDesc = '<p class="text-xs text-gray-400 mt-1">Flags open leads that haven\'t moved to a new stage in 30+ days (30\u201360, 60\u201390, or 90+ day buckets).</p>';

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
      (allZero ? '<p class="text-xs text-amber-600 mt-1">All conversion rates are 0% \u2014 the won leads\' contacts don\'t have any of these tags assigned in your CRM.</p>' : '') +
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
        '<td class="px-3 py-2"><div class="w-full bg-gray-200 rounded-full h-2"><div class="' + barColor + ' h-2 rounded-full" style="width: ' + Math.min(winRate, 100) + '%"></div></div></td></tr>';
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
        '<div class="flex-1 bg-gray-200 rounded-full h-2.5"><div class="' + barColor + ' h-2.5 rounded-full" style="width: ' + Math.min(winRate, 100) + '%"></div></div>' +
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
      containerDiv.innerHTML = '<div class="bg-white rounded-lg shadow p-6"><h3 class="text-lg font-semibold mb-2">' + (viz.title || 'Chart') + '</h3>' +
        (viz.description ? '<p class="text-sm text-gray-600 mb-4">' + viz.description + '</p>' : '') +
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

  function renderAttributionSummary(viz, data, uniqueId) {
    var metricKeys = viz.metrics || [];
    var metricsMap = {};
    for (var i = 0; i < metricKeys.length; i++) {
      var key = metricKeys[i];
      for (var j = 0; j < data.metrics.length; j++) {
        if (data.metrics[j].key === key) {
          metricsMap[key] = Array.isArray(data.metrics[j].current) ? data.metrics[j].current : [];
          break;
        }
      }
      if (!metricsMap[key]) metricsMap[key] = [];
    }

    var container = document.createElement('div');
    container.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';

    var headerHTML = '<div class="mb-6">' +
      '<h3 class="text-lg font-semibold text-gray-900">' + (viz.title || 'Attribution Insights') + '</h3>' +
      (viz.description ? '<p class="text-sm text-gray-500 mt-1">' + viz.description + '</p>' : '') +
      '</div>';

    // Section 1: Lead Journey Paths
    var multiTouchData = metricsMap['attribution_multi_touch_analysis'] || [];
    var journeyData = metricsMap['attribution_lead_journeys'] || [];

    // Build insight sentence from multi-touch data
    var totalAttrLeads = 0;
    var multiLeads = 0;
    var multiConv = 0;
    var singleConv = 0;
    for (var mt = 0; mt < multiTouchData.length; mt++) {
      var mtRow = multiTouchData[mt];
      var mtCount = parseInt(mtRow.value) || 0;
      totalAttrLeads += mtCount;
      if (mtRow.label === 'Single Touch') {
        singleConv = parseFloat(mtRow.win_rate) || 0;
      } else {
        multiLeads += mtCount;
        multiConv = parseFloat(mtRow.win_rate) || 0;
      }
    }
    var multiPct = totalAttrLeads > 0 ? Math.round(100 * multiLeads / totalAttrLeads) : 0;

    var multiTouchHTML = '<div class="mb-8">' +
      '<h4 class="text-base font-semibold text-gray-700 mb-1">Lead Journey Paths</h4>' +
      '<p class="text-xs text-gray-400 mb-3">Across all pipelines \u2014 shows first \u2192 last marketing channel for each lead</p>';

    // Insight banner
    if (totalAttrLeads > 0) {
      multiTouchHTML += '<div class="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-4">' +
        '<p class="text-sm text-blue-800">' +
        '<span class="font-semibold">' + multiPct + '%</span> of leads had 2+ marketing touchpoints. ' +
        'Multi-touch: <span class="font-semibold">' + multiConv + '%</span> conversion · ' +
        'Single-touch: <span class="font-semibold">' + singleConv + '%</span> conversion' +
        '</p></div>';
    }

    // Journey paths table
    if (journeyData.length === 0) {
      multiTouchHTML += '<p class="text-sm text-gray-400">No journey path data available.</p>';
    } else {
      multiTouchHTML += '<div class="overflow-hidden rounded-lg border border-gray-200">' +
        '<table class="w-full text-sm"><thead><tr class="bg-gray-50 border-b border-gray-200">' +
        '<th class="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Journey (First \u2192 Last)</th>' +
        '<th class="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Type</th>' +
        '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Leads</th>' +
        '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Won</th>' +
        '<th class="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Conversion</th>' +
        '</tr></thead><tbody>';
      for (var jd = 0; jd < journeyData.length; jd++) {
        var jRow = journeyData[jd];
        var jConv = parseFloat(jRow.win_rate) || 0;
        var jConvColor = jConv >= 40 ? 'text-green-700' : (jConv >= 20 ? 'text-yellow-700' : 'text-red-600');
        var jConvBg = jConv >= 40 ? 'bg-green-50 text-green-700' : (jConv >= 20 ? 'bg-yellow-50 text-yellow-700' : '');
        var jType = jRow.journey_type === 'single' ? 'Single' : 'Multi';
        var jTypeBadge = jRow.journey_type === 'single'
          ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Single</span>'
          : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Multi</span>';
        var bgRow = jd % 2 === 0 ? '' : 'bg-gray-50';
        multiTouchHTML += '<tr class="border-b border-gray-100 ' + bgRow + '">' +
          '<td class="px-3 py-2 text-gray-900">' + escapeHtml(jRow.label || '') + '</td>' +
          '<td class="px-3 py-2 text-center">' + jTypeBadge + '</td>' +
          '<td class="px-3 py-2 text-right text-gray-600">' + (parseInt(jRow.value) || 0).toLocaleString() + '</td>' +
          '<td class="px-3 py-2 text-right text-gray-600">' + (parseInt(jRow.won_count) || 0) + '</td>' +
          '<td class="px-3 py-2 text-right font-medium ' + jConvColor + '">' +
          (jConvBg ? '<span class="px-2 py-0.5 rounded ' + jConvBg + '">' + jConv + '%</span>' : jConv + '%') +
          '</td></tr>';
      }
      multiTouchHTML += '</tbody></table></div>';
    }
    multiTouchHTML += '</div>';

    // Section 2: First Touch vs Last Touch
    var touchData = metricsMap['attribution_first_vs_last_touch'] || [];
    var firstTouches = [];
    var lastTouches = [];
    for (var td = 0; td < touchData.length; td++) {
      if (touchData[td].touch_type === 'first_touch') firstTouches.push(touchData[td]);
      else if (touchData[td].touch_type === 'last_touch') lastTouches.push(touchData[td]);
    }

    var touchHTML = '<div class="mb-8">' +
      '<h4 class="text-base font-semibold text-gray-700 mb-1">Discovery vs Conversion Channels</h4>' +
      '<p class="text-xs text-gray-400 mb-3">Across all pipelines — only leads with UTM attribution data</p>';
    if (firstTouches.length === 0 && lastTouches.length === 0) {
      touchHTML += '<p class="text-sm text-gray-400">No first/last touch data available.</p>';
    } else {
      touchHTML += '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">';

      // First touch column
      touchHTML += '<div><h5 class="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">First Touch (Discovery)</h5>';
      touchHTML += '<div class="space-y-2">';
      var ftMax = firstTouches.length > 0 ? parseFloat(firstTouches[0].value) || 1 : 1;
      for (var ft = 0; ft < firstTouches.length; ft++) {
        var ftRow = firstTouches[ft];
        var ftPct = Math.round((parseFloat(ftRow.value) / ftMax) * 100);
        touchHTML += '<div class="flex items-center gap-3">' +
          '<div class="w-28 text-sm text-gray-700 truncate" title="' + (ftRow.channel || '') + '">' + (ftRow.channel || 'Unknown') + '</div>' +
          '<div class="flex-1 bg-gray-100 rounded-full h-5 relative">' +
          '<div class="bg-blue-500 h-5 rounded-full" style="width:' + ftPct + '%"></div>' +
          '</div>' +
          '<div class="w-12 text-sm text-gray-600 text-right">' + (ftRow.value || 0) + '</div>' +
          '<div class="w-14 text-xs text-gray-400 text-right">' + (ftRow.win_rate || 0) + '%</div>' +
          '</div>';
      }
      touchHTML += '</div></div>';

      // Last touch column
      touchHTML += '<div><h5 class="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">Last Touch (Conversion)</h5>';
      touchHTML += '<div class="space-y-2">';
      var ltMax = lastTouches.length > 0 ? parseFloat(lastTouches[0].value) || 1 : 1;
      for (var lt = 0; lt < lastTouches.length; lt++) {
        var ltRow = lastTouches[lt];
        var ltPct = Math.round((parseFloat(ltRow.value) / ltMax) * 100);
        touchHTML += '<div class="flex items-center gap-3">' +
          '<div class="w-28 text-sm text-gray-700 truncate" title="' + (ltRow.channel || '') + '">' + (ltRow.channel || 'Unknown') + '</div>' +
          '<div class="flex-1 bg-gray-100 rounded-full h-5 relative">' +
          '<div class="bg-purple-500 h-5 rounded-full" style="width:' + ltPct + '%"></div>' +
          '</div>' +
          '<div class="w-12 text-sm text-gray-600 text-right">' + (ltRow.value || 0) + '</div>' +
          '<div class="w-14 text-xs text-gray-400 text-right">' + (ltRow.win_rate || 0) + '%</div>' +
          '</div>';
      }
      touchHTML += '</div></div>';
      touchHTML += '</div>';
    }
    touchHTML += '</div>';

    // Section 3: Campaign Performance
    var campaignData = metricsMap['attribution_campaign_performance'] || [];
    var campaignHTML = '<div class="mb-8">' +
      '<h4 class="text-base font-semibold text-gray-700 mb-1">Campaign Performance</h4>' +
      '<p class="text-xs text-gray-400 mb-3">Across all pipelines — only leads with UTM campaign tags</p>';
    if (campaignData.length === 0) {
      campaignHTML += '<p class="text-sm text-gray-400">No UTM campaign data available. Campaigns require utmCampaign tags in your marketing URLs.</p>';
    } else {
      campaignHTML += '<table class="w-full text-sm">' +
        '<thead><tr class="text-left text-gray-500 border-b border-gray-200">' +
        '<th class="pb-2 font-medium">Campaign</th>' +
        '<th class="pb-2 font-medium">Channel</th>' +
        '<th class="pb-2 font-medium text-right">Leads</th>' +
        '<th class="pb-2 font-medium text-right">Won</th>' +
        '<th class="pb-2 font-medium text-right">Conversion</th>' +
        '</tr></thead><tbody>';
      for (var cp = 0; cp < campaignData.length; cp++) {
        var cpRow = campaignData[cp];
        var cpWinRate = parseFloat(cpRow.win_rate) || 0;
        var cpColor = cpWinRate >= 40 ? 'bg-green-100 text-green-800' : (cpWinRate >= 20 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800');
        var cpBg = cp % 2 === 1 ? ' bg-gray-50' : '';
        campaignHTML += '<tr class="border-b border-gray-100' + cpBg + '">' +
          '<td class="py-2 text-gray-700">' + (cpRow.label || 'Unknown') + '</td>' +
          '<td class="py-2 text-gray-500">' + (cpRow.channel || '-') + '</td>' +
          '<td class="py-2 text-right text-gray-700">' + (cpRow.value || 0) + '</td>' +
          '<td class="py-2 text-right text-gray-700">' + (cpRow.won_count || 0) + '</td>' +
          '<td class="py-2 text-right"><span class="inline-block px-2 py-0.5 rounded text-xs font-medium ' + cpColor + '">' + cpWinRate + '%</span></td>' +
          '</tr>';
      }
      campaignHTML += '</tbody></table>';
    }
    campaignHTML += '</div>';

    // Section 4: Top Landing Pages
    var landingData = metricsMap['attribution_landing_pages'] || [];
    var landingHTML = '<div class="mb-2">' +
      '<h4 class="text-base font-semibold text-gray-700 mb-1">Top Landing Pages</h4>' +
      '<p class="text-xs text-gray-400 mb-3">Across all pipelines — last-touch landing page before conversion</p>';
    if (landingData.length === 0) {
      landingHTML += '<p class="text-sm text-gray-400">No landing page data available.</p>';
    } else {
      landingHTML += '<table class="w-full text-sm">' +
        '<thead><tr class="text-left text-gray-500 border-b border-gray-200">' +
        '<th class="pb-2 font-medium">Landing Page</th>' +
        '<th class="pb-2 font-medium text-right">Leads</th>' +
        '<th class="pb-2 font-medium text-right">Won</th>' +
        '<th class="pb-2 font-medium text-right">Conversion</th>' +
        '</tr></thead><tbody>';
      for (var lp = 0; lp < landingData.length; lp++) {
        var lpRow = landingData[lp];
        var lpWinRate = parseFloat(lpRow.win_rate) || 0;
        var lpColor = lpWinRate >= 40 ? 'bg-green-100 text-green-800' : (lpWinRate >= 20 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800');
        var lpBg = lp % 2 === 1 ? ' bg-gray-50' : '';
        var displayUrl = lpRow.label || 'Unknown';
        var fullUrl = lpRow.full_url || displayUrl;
        if (displayUrl.length > 60) displayUrl = displayUrl.substring(0, 60) + '...';
        landingHTML += '<tr class="border-b border-gray-100' + lpBg + '">' +
          '<td class="py-2 text-gray-700 max-w-xs truncate" title="' + fullUrl + '">' + displayUrl + '</td>' +
          '<td class="py-2 text-right text-gray-700">' + (lpRow.value || 0) + '</td>' +
          '<td class="py-2 text-right text-gray-700">' + (lpRow.won_count || 0) + '</td>' +
          '<td class="py-2 text-right"><span class="inline-block px-2 py-0.5 rounded text-xs font-medium ' + lpColor + '">' + lpWinRate + '%</span></td>' +
          '</tr>';
      }
      landingHTML += '</tbody></table>';
    }
    landingHTML += '</div>';

    container.innerHTML = headerHTML + multiTouchHTML + touchHTML + campaignHTML + landingHTML;
    return container;
  }

  function renderBubbleChart(viz, data, uniqueId) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    var canvasId = 'chart-' + uniqueId;
    var helpTextHTML = renderHelpTextModal(viz.helpText, uniqueId);

    div.innerHTML = '<div class="flex items-center mb-4"><h3 class="text-lg font-semibold text-gray-900">' + (viz.title || 'Bubble Chart') + '</h3>' + helpTextHTML + '</div>' +
      (viz.description ? '<p class="text-sm text-gray-500 mb-4">' + viz.description + '</p>' : '') +
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

    div.innerHTML = '<div class="flex items-center mb-4"><h3 class="text-lg font-semibold text-gray-900">' + (viz.title || 'Grouped Bar Chart') + '</h3>' + helpTextHTML + '</div>' +
      (viz.description ? '<p class="text-sm text-gray-500 mb-4">' + viz.description + '</p>' : '') +
      '<div class="h-96"><canvas id="' + canvasId + '"></canvas></div>';

    setTimeout(function () {
      var ctx = document.getElementById(canvasId);
      if (!ctx) return;
      if (!viz.data || viz.data.length === 0) {
        ctx.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">No data available</div>';
        return;
      }
      var xField = (viz.xAxis && viz.xAxis.field) || 'source_name';
      var labels = viz.data.map(function (row) { return row[xField] || 'Unknown'; });
      var datasets = (viz.series || []).map(function (serie) {
        return {
          label: serie.label,
          data: viz.data.map(function (row) { return parseFloat(row[serie.field]) || 0; }),
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
      div.innerHTML = '<h3 class="text-lg font-semibold text-gray-900 mb-4">' + (viz.title || 'Table') + '</h3>' +
        '<div class="text-gray-500 text-center py-8">No data available</div>';
      return div;
    }

    var tableData = metric.current;
    var columns = viz.columns || [
      { field: 'label', header: 'Label', align: 'left' },
      { field: 'count', header: 'Count', align: 'right' },
      { field: 'value', header: 'Value', align: 'right', format: 'percent' }
    ];

    var filteredData = tableData.slice();
    var currentPage = 1;
    var rowsPerPage = 10;
    var sortField = null;
    var sortDirection = 'asc';

    div.innerHTML = '<h3 class="text-lg font-semibold text-gray-900 mb-4">' + (viz.title || 'Table') + '</h3>' +
      (viz.description ? '<p class="text-sm text-gray-500 mb-4">' + viz.description + '</p>' : '') +
      '<div class="mb-4"><input type="text" id="search-' + uniqueId + '" placeholder="Search..." class="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>' +
      '<div class="overflow-x-auto mb-4"><table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr id="table-header-' + uniqueId + '"></tr></thead>' +
      '<tbody id="table-body-' + uniqueId + '" class="bg-white divide-y divide-gray-200"></tbody></table></div>' +
      '<div class="flex items-center justify-between"><div class="text-sm text-gray-700">Showing <span id="start-' + uniqueId + '">1</span> to <span id="end-' + uniqueId + '">10</span> of <span id="total-' + uniqueId + '">0</span> results</div>' +
      '<div class="flex gap-2"><button id="prev-' + uniqueId + '" class="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" disabled>Previous</button>' +
      '<button id="next-' + uniqueId + '" class="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">Next</button></div></div>';

    function formatValue(value, column) {
      if (column.format === 'percent' && typeof value === 'number') return value.toFixed(1) + '%';
      if (typeof value === 'number') return value.toLocaleString();
      return value;
    }

    function renderHeader() {
      var headerRow = div.querySelector('#table-header-' + uniqueId);
      if (!headerRow) return;
      headerRow.innerHTML = columns.map(function (col) {
        var isSorted = sortField === col.field;
        var sortIcon = isSorted ? (sortDirection === 'asc' ? ' \u25B2' : ' \u25BC') : ' \u21C5';
        return '<th class="px-4 py-3 text-' + (col.align || 'left') + ' text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none" data-field="' + col.field + '">' + col.header + sortIcon + '</th>';
      }).join('');

      headerRow.querySelectorAll('th').forEach(function (th) {
        th.addEventListener('click', function () {
          var field = th.dataset.field;
          if (sortField === field) { sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; }
          else { sortField = field; sortDirection = 'asc'; }
          currentPage = 1;
          render();
        });
      });
    }

    function renderBody() {
      var tbody = div.querySelector('#table-body-' + uniqueId);
      if (!tbody) return;
      var sortedData = filteredData.slice();
      if (sortField) {
        sortedData.sort(function (a, b) {
          var aVal = a[sortField]; var bVal = b[sortField];
          if (typeof aVal === 'number' && typeof bVal === 'number') return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
          aVal = String(aVal).toLowerCase(); bVal = String(bVal).toLowerCase();
          if (sortDirection === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          return bVal < aVal ? -1 : bVal > aVal ? 1 : 0;
        });
      }
      var startIdx = (currentPage - 1) * rowsPerPage;
      var endIdx = Math.min(startIdx + rowsPerPage, sortedData.length);
      var pageData = sortedData.slice(startIdx, endIdx);

      tbody.innerHTML = pageData.map(function (row, idx) {
        var cellsHTML = columns.map(function (col) {
          return '<td class="px-4 py-3 text-' + (col.align || 'left') + ' text-sm text-gray-900">' + formatValue(row[col.field], col) + '</td>';
        }).join('');
        return '<tr class="' + (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50') + '">' + cellsHTML + '</tr>';
      }).join('');

      var startEl = div.querySelector('#start-' + uniqueId);
      var endEl = div.querySelector('#end-' + uniqueId);
      var totalEl = div.querySelector('#total-' + uniqueId);
      if (startEl) startEl.textContent = sortedData.length > 0 ? startIdx + 1 : 0;
      if (endEl) endEl.textContent = endIdx;
      if (totalEl) totalEl.textContent = sortedData.length;

      var prevBtn = div.querySelector('#prev-' + uniqueId);
      var nextBtn = div.querySelector('#next-' + uniqueId);
      if (prevBtn) prevBtn.disabled = currentPage === 1;
      if (nextBtn) nextBtn.disabled = endIdx >= sortedData.length;
    }

    function handleSearch(searchTerm) {
      var term = searchTerm.toLowerCase().trim();
      if (!term) { filteredData = tableData.slice(); }
      else {
        filteredData = tableData.filter(function (row) {
          return columns.some(function (col) {
            return String(row[col.field]).toLowerCase().indexOf(term) !== -1;
          });
        });
      }
      currentPage = 1;
      render();
    }

    function render() { renderHeader(); renderBody(); }

    setTimeout(function () {
      var searchInput = div.querySelector('#search-' + uniqueId);
      if (searchInput) searchInput.addEventListener('input', function (e) { handleSearch(e.target.value); });
      var prevBtn = div.querySelector('#prev-' + uniqueId);
      if (prevBtn) prevBtn.addEventListener('click', function () { if (currentPage > 1) { currentPage--; render(); } });
      var nextBtn = div.querySelector('#next-' + uniqueId);
      if (nextBtn) nextBtn.addEventListener('click', function () { var maxPage = Math.ceil(filteredData.length / rowsPerPage); if (currentPage < maxPage) { currentPage++; render(); } });
      render();
    }, 0);

    return div;
  }

  function renderPlaceholderChart(viz, uniqueId) {
    var div = document.createElement('div');
    div.className = 'bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6';
    div.innerHTML = '<h3 class="text-lg font-semibold text-gray-900 mb-4">' + (viz.title || viz.type) + '</h3>' +
      '<div class="h-64 flex items-center justify-center bg-gray-50 rounded"><p class="text-gray-500">Chart type "' + viz.type + '" will be implemented soon</p></div>';
    return div;
  }

  // ==========================================================================
  // Legacy Charts (renderCharts / renderTimeSeriesChart)
  // ==========================================================================

  function renderCharts(metrics) {
    currentModuleData = metrics;
    if (trendsChart) trendsChart.destroy();
    if (statusChart) statusChart.destroy();

    var trendsCtx = document.getElementById('metricTrendsChart');
    if (trendsCtx) {
      trendsCtx = trendsCtx.getContext('2d');
      var metricNames = metrics.map(function (m) { return m.name; });
      var currentValues = metrics.map(function (m) { return parseFloat(m.current) || 0; });
      var priorValues = metrics.map(function (m) { return parseFloat(m.prior) || 0; });

      trendsChart = new Chart(trendsCtx, {
        type: 'bar',
        data: {
          labels: metricNames,
          datasets: [
            { label: 'Current Period', data: currentValues, backgroundColor: '#818cf8', borderColor: '#6366f1', borderWidth: 1 },
            { label: 'Prior Period', data: priorValues, backgroundColor: '#e5e7eb', borderColor: '#d1d5db', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 } } },
          scales: { y: { beginAtZero: true } }
        }
      });
    }

    var statusCtx = document.getElementById('statusDistributionChart');
    if (statusCtx) {
      statusCtx = statusCtx.getContext('2d');
      var statusCounts = {
        green: metrics.filter(function (m) { return m.status === 'green'; }).length,
        yellow: metrics.filter(function (m) { return m.status === 'yellow'; }).length,
        red: metrics.filter(function (m) { return m.status === 'red'; }).length,
        gray: metrics.filter(function (m) { return m.status === 'gray'; }).length
      };
      statusChart = new Chart(statusCtx, {
        type: 'doughnut',
        data: {
          labels: ['On Target (Green)', 'Warning (Yellow)', 'Critical (Red)', 'No Target (Gray)'],
          datasets: [{ data: [statusCounts.green, statusCounts.yellow, statusCounts.red, statusCounts.gray], backgroundColor: ['#22c55e', '#eab308', '#ef4444', '#9ca3af'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } } }
      });
    }
  }

  function renderTimeSeriesChart(timeSeries, metrics) {
    var section = document.getElementById('timeSeriesSection');
    if (section) section.classList.remove('hidden');
    if (timeSeriesChart) timeSeriesChart.destroy();

    var canvas = document.getElementById('timeSeriesChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    var labels = timeSeries.map(function (ts) {
      return new Date(ts.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: getOrganizationTimezone() });
    });

    var colorPalette = [
      { bg: 'rgba(99, 102, 241, 0.2)', border: '#6366f1' },
      { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981' },
      { bg: 'rgba(245, 158, 11, 0.2)', border: '#f59e0b' },
      { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444' },
      { bg: 'rgba(139, 92, 246, 0.2)', border: '#8b5cf6' }
    ];

    var datasets = metrics.map(function (metric, index) {
      var color = colorPalette[index % colorPalette.length];
      var dataPoints = timeSeries.map(function (ts) {
        var found = null;
        for (var j = 0; j < ts.metrics.length; j++) {
          if (ts.metrics[j].key === metric.key) { found = ts.metrics[j]; break; }
        }
        return found ? parseFloat(found.value) || 0 : 0;
      });
      return { label: metric.name, data: dataPoints, fill: true, backgroundColor: color.bg, borderColor: color.border, borderWidth: 2, tension: 0.4, pointRadius: 4, pointHoverRadius: 6 };
    });

    timeSeriesChart = new Chart(ctx, {
      type: 'line',
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 } } },
        scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 45, minRotation: 45 } } }
      }
    });
  }

  // ==========================================================================
  // Export Functions
  // ==========================================================================

  function exportToPDF() {
    if (!currentModuleData) {
      alert('No data to export. Please execute a module first.');
      return;
    }

    var jsPDFLib = window.jspdf;
    if (!jsPDFLib) { alert('PDF library not loaded.'); return; }
    var doc = new jsPDFLib.jsPDF();

    doc.setFontSize(20);
    doc.text('Module Execution Report', 14, 20);

    doc.setFontSize(12);
    var moduleTitleEl = document.getElementById('moduleTitle');
    var executionTimeEl = document.getElementById('executionTime');
    var resultPeriodTypeEl = document.getElementById('resultPeriodType');
    var resultCurrentPeriodEl = document.getElementById('resultCurrentPeriod');

    doc.text('Module: ' + (moduleTitleEl ? moduleTitleEl.textContent : ''), 14, 35);
    doc.text('Execution Time: ' + (executionTimeEl ? executionTimeEl.textContent : ''), 14, 42);
    doc.text('Period Type: ' + (resultPeriodTypeEl ? resultPeriodTypeEl.textContent : ''), 14, 49);
    doc.text('Current Period: ' + (resultCurrentPeriodEl ? resultCurrentPeriodEl.textContent : ''), 14, 56);

    var tableData = currentModuleData.map(function (m) {
      return [
        m.name,
        m.formattedCurrent || m.current,
        m.formattedPrior || m.prior || 'N/A',
        m.formattedTarget || m.target || 'N/A',
        m.formattedChange || 'N/A',
        m.status ? m.status.toUpperCase() : 'N/A'
      ];
    });

    doc.autoTable({
      startY: 65,
      head: [['Metric', 'Current', 'Prior', 'Target', 'Change', 'Status']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [99, 102, 241] },
      styles: { fontSize: 9 }
    });

    var fileName = 'module-report-' + new Date().toISOString().split('T')[0] + '.pdf';
    doc.save(fileName);
    showInfo('Report exported to ' + fileName);
  }

  function exportToCSV() {
    if (!currentModuleData) {
      alert('No data to export. Please execute a module first.');
      return;
    }

    var headers = ['Metric', 'Current', 'Prior', 'Target', 'Change', 'Change %', 'Status'];
    var rows = currentModuleData.map(function (m) {
      return [
        m.name,
        m.formattedCurrent || m.current,
        m.formattedPrior || m.prior || 'N/A',
        m.formattedTarget || m.target || 'N/A',
        m.formattedChange || 'N/A',
        m.changePercent ? m.changePercent + '%' : 'N/A',
        m.status ? m.status.toUpperCase() : 'N/A'
      ];
    });

    var csvContent = headers.join(',') + '\n';
    rows.forEach(function (row) {
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
    var fileName = 'module-report-' + new Date().toISOString().split('T')[0] + '.csv';

    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showInfo('Report exported to ' + fileName);
  }

  // ==========================================================================
  // Data Override Panel
  // ==========================================================================

  function openDataOverridePanel(metricKey, metricName, metricDescription, currentValue, overrideType) {
    if (!overrideType) overrideType = 'target';
    var moduleKey = selectedModuleKey;
    var periodTypeEl = document.getElementById('periodType');
    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');
    var periodType = (periodTypeEl && periodTypeEl.value) ? periodTypeEl.value : 'monthly';
    var periodStart = periodStartEl ? periodStartEl.value : '';
    var periodEnd = periodEndEl ? periodEndEl.value : '';

    if (!periodStart || !periodEnd) {
      showError('Please select a date range first');
      return;
    }

    currentOverrideMetric = {
      key: metricKey, name: metricName, description: metricDescription,
      currentValue: currentValue, overrideType: overrideType
    };

    var nameEl = document.getElementById('overrideMetricName');
    var descEl = document.getElementById('overrideMetricDescription');
    var rangeEl = document.getElementById('overridePeriodRange');
    var currentEl = document.getElementById('overrideCurrentValue');

    if (nameEl) nameEl.textContent = metricName;
    if (descEl) descEl.textContent = metricDescription || 'No description available';
    if (rangeEl) rangeEl.textContent = formatDateRange(new Date(periodStart + 'T00:00:00Z'), new Date(periodEnd + 'T23:59:59Z'));

    var valueLabel = overrideType === 'target' ? 'Current Target' : 'Current Value';
    if (currentEl) {
      var labelEl = currentEl.parentElement.querySelector('p.text-xs');
      if (labelEl) labelEl.textContent = valueLabel;
      currentEl.textContent = formatNumber(currentValue, 2);
    }

    var form = document.getElementById('overrideForm');
    if (form) form.reset();
    var overrideValueEl = document.getElementById('overrideValue');
    var overrideNotesEl = document.getElementById('overrideNotes');
    if (overrideValueEl) overrideValueEl.value = '';
    if (overrideNotesEl) overrideNotesEl.value = '';

    var overrideTypeEl = document.getElementById('overrideType');
    if (overrideTypeEl) overrideTypeEl.value = overrideType;

    var hPeriodStart = document.getElementById('overridePeriodStart');
    var hPeriodEnd = document.getElementById('overridePeriodEnd');
    var hPeriodType = document.getElementById('overridePeriodType');
    var hModuleKey = document.getElementById('overrideModuleKey');
    var hMetricKey = document.getElementById('overrideMetricKey');
    if (hPeriodStart) hPeriodStart.value = periodStart;
    if (hPeriodEnd) hPeriodEnd.value = periodEnd;
    if (hPeriodType) hPeriodType.value = periodType;
    if (hModuleKey) hModuleKey.value = moduleKey;
    if (hMetricKey) hMetricKey.value = metricKey;

    loadExistingOverrides(moduleKey, metricKey, periodStart, periodEnd);

    var overlay = document.getElementById('dataOverrideOverlay');
    var panel = document.getElementById('dataOverridePanel');
    if (overlay) overlay.classList.remove('hidden');
    if (panel) panel.classList.remove('translate-x-full');
    document.body.style.overflow = 'hidden';
  }

  function closeDataOverridePanel() {
    var overlay = document.getElementById('dataOverrideOverlay');
    var panel = document.getElementById('dataOverridePanel');
    if (panel) panel.classList.add('translate-x-full');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = '';
    currentOverrideMetric = null;
    currentOverrideData = null;
  }

  async function loadExistingOverrides(moduleKey, metricKey, periodStart, periodEnd) {
    try {
      var periodStartISO = new Date(periodStart + 'T00:00:00Z').toISOString();
      var periodEndISO = new Date(periodEnd + 'T23:59:59Z').toISOString();

      var data = await api.get('/api/v1/modules/' + moduleKey + '/data-overrides', {
        periodStart: periodStartISO, periodEnd: periodEndISO
      });

      var metricOverrides = data.filter(function (o) { return o.metric_key === metricKey; });
      var existingSection = document.getElementById('existingOverridesSection');
      var existingList = document.getElementById('existingOverridesList');

      if (metricOverrides.length > 0 && existingSection && existingList) {
        existingSection.classList.remove('hidden');
        existingList.innerHTML = metricOverrides.map(function (override) {
          return '<div class="p-3 bg-gray-50 rounded-lg border border-gray-200">' +
            '<div class="flex items-start justify-between mb-2"><div class="flex-1">' +
            '<p class="text-sm font-semibold text-gray-900">Override Value: ' + formatNumber(override.override_value, 2) + '</p>' +
            '<p class="text-xs text-gray-500 mt-1">Period: ' + formatDateRange(override.period_start, override.period_end) + '</p>' +
            (override.notes ? '<p class="text-xs text-gray-600 mt-1 italic">"' + override.notes + '"</p>' : '') +
            '</div>' +
            '<button onclick="window._reporting.deleteOverride(\'' + override.override_id + '\')" class="text-red-600 hover:text-red-800 ml-2" title="Delete override">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div>' +
            '<div class="text-xs text-gray-400">Created: ' + formatDate(override.created_at) + '</div></div>';
        }).join('');
      } else if (existingSection) {
        existingSection.classList.add('hidden');
      }
    } catch (error) {
      console.error('Failed to load existing overrides:', error);
      var section = document.getElementById('existingOverridesSection');
      if (section) section.classList.add('hidden');
    }
  }

  async function saveOverride(e) {
    if (e) e.preventDefault();
    if (!currentOverrideMetric) { showError('No metric selected for override'); return; }

    var moduleKey = document.getElementById('overrideModuleKey').value;
    var periodType = document.getElementById('overridePeriodType').value;
    var periodStart = document.getElementById('overridePeriodStart').value;
    var periodEnd = document.getElementById('overridePeriodEnd').value;
    var overrideValue = parseFloat(document.getElementById('overrideValue').value);
    var overrideNotes = (document.getElementById('overrideNotes').value || '').trim();
    var overrideType = document.getElementById('overrideType').value;

    if (!periodStart || !periodEnd) { showError('Period dates are missing. Please close and reopen the panel.'); return; }
    if (isNaN(overrideValue)) { showError('Please enter a valid numeric value'); return; }

    var periodStartISO = new Date(periodStart + 'T00:00:00Z').toISOString();
    var periodEndISO = new Date(periodEnd + 'T23:59:59Z').toISOString();

    var saveBtn = document.getElementById('saveOverrideBtn');
    var saveBtnText = document.getElementById('saveOverrideBtnText');
    if (saveBtn) saveBtn.disabled = true;
    if (saveBtnText) saveBtnText.textContent = 'Saving...';

    try {
      await api.post('/api/v1/modules/' + moduleKey + '/data-overrides', {
        metricKey: currentOverrideMetric.key,
        periodStart: periodStartISO, periodEnd: periodEndISO,
        periodType: periodType, overrideValue: overrideValue,
        overrideType: overrideType, notes: overrideNotes || null
      });
      showInfo('Override saved for ' + currentOverrideMetric.name + '. Re-execute module to see updated values.');
      closeDataOverridePanel();
    } catch (error) {
      console.error('Failed to save override:', error);
      showError(error.message || 'Failed to save override. Please try again.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (saveBtnText) saveBtnText.textContent = 'Save Override';
    }
  }

  async function deleteOverride(overrideId) {
    if (!confirm('Are you sure you want to delete this override?')) return;
    var moduleKey = selectedModuleKey;

    try {
      await api.delete('/api/v1/modules/' + moduleKey + '/data-overrides/' + overrideId);
      showInfo('Override deleted successfully. Re-execute module to see updated values.');
      var periodStart = document.getElementById('periodStart').value;
      var periodEnd = document.getElementById('periodEnd').value;
      if (currentOverrideMetric) {
        await loadExistingOverrides(moduleKey, currentOverrideMetric.key, periodStart, periodEnd);
      }
    } catch (error) {
      console.error('Failed to delete override:', error);
      showError(error.message || 'Failed to delete override. Please try again.');
    }
  }

  // ==========================================================================
  // Report Import & Management (V2)
  // ==========================================================================

  var importedReports = [];
  var selectedImportedReportId = null;
  var pendingImportFile = null;

  async function loadImportedReports() {
    var moduleMenu = document.getElementById('moduleMenu');
    if (!moduleMenu) return;

    // Remove any existing imported reports section
    var existing = moduleMenu.querySelector('[data-category-section="imported"]');
    if (existing) existing.remove();

    try {
      var response = await api.get('/api/v1/reporting/reports', {
        limit: 100,
        offset: 0,
        sort: 'name',
        order: 'asc',
        is_active: true
      });

      importedReports = (response.data || response.reports || []);

      if (!importedReports.length) return;

      // Group imported reports by category
      var reportsByCategory = {};
      importedReports.forEach(function (report) {
        var cat = report.category || 'other';
        if (!reportsByCategory[cat]) reportsByCategory[cat] = [];
        reportsByCategory[cat].push(report);
      });

      // Build a single "Imported" category section
      var categorySection = document.createElement('div');
      categorySection.style.marginBottom = '0.25rem';
      categorySection.dataset.categorySection = 'imported';
      categorySection.style.borderTop = '1px solid var(--lex-border-default)';
      categorySection.style.paddingTop = '0.75rem';
      categorySection.style.marginTop = '0.75rem';

      // Category header (collapsible)
      var categoryHeader = document.createElement('button');
      categoryHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0.375rem 0.5rem;border-radius:var(--lex-radius-md);cursor:pointer;background:none;border:none;width:100%;';

      var categoryName = document.createElement('span');
      categoryName.className = 'lex-overline lex-text-secondary';
      categoryName.textContent = 'Imported';
      categoryHeader.appendChild(categoryName);

      var chevron = document.createElement('svg');
      chevron.setAttribute('width', '14');
      chevron.setAttribute('height', '14');
      chevron.setAttribute('fill', 'none');
      chevron.setAttribute('stroke', 'currentColor');
      chevron.setAttribute('stroke-width', '2');
      chevron.setAttribute('viewBox', '0 0 24 24');
      chevron.style.transition = 'transform 0.2s ease';
      chevron.style.color = 'var(--lex-text-tertiary)';
      chevron.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>';
      categoryHeader.appendChild(chevron);
      categorySection.appendChild(categoryHeader);

      // Report items container
      var reportContainer = document.createElement('div');
      reportContainer.style.cssText = 'display:flex;flex-direction:column;gap:0.125rem;margin-top:0.25rem;';
      reportContainer.dataset.categoryModules = 'imported';

      // Sort categories, then render each report
      var catKeys = Object.keys(reportsByCategory).sort();
      catKeys.forEach(function (cat) {
        reportsByCategory[cat].forEach(function (report) {
          var btn = document.createElement('button');
          btn.style.cssText = [
            'display:flex;align-items:center;justify-content:space-between;width:100%;text-align:left;padding:0.375rem 0.5rem;',
            'border-radius:var(--lex-radius-md);border:none;background:none;cursor:pointer;',
            'transition:var(--lex-transition-fast);color:var(--lex-text-primary);'
          ].join('');
          btn.dataset.reportId = report.report_id;
          btn.dataset.category = 'imported';
          btn.dataset.moduleName = report.name.toLowerCase();
          btn.dataset.moduleDescription = (report.description || '').toLowerCase();

          var textWrap = document.createElement('div');
          textWrap.style.cssText = 'flex:1;min-width:0;';

          var nameEl = document.createElement('div');
          nameEl.className = 'lex-label-sm';
          nameEl.textContent = report.name;
          textWrap.appendChild(nameEl);

          btn.appendChild(textWrap);

          // Delete button (only for non-templates)
          if (!report.is_template) {
            var deleteBtn = document.createElement('button');
            deleteBtn.style.cssText = 'flex-shrink:0;background:none;border:none;cursor:pointer;padding:0.25rem;color:var(--lex-text-tertiary);display:none;';
            deleteBtn.title = 'Delete report';
            deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
            deleteBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              deleteImportedReport(report.report_id, report.name);
            });
            btn.appendChild(deleteBtn);

            // Show delete on hover
            btn.addEventListener('mouseenter', function () { deleteBtn.style.display = ''; });
            btn.addEventListener('mouseleave', function () { deleteBtn.style.display = 'none'; });
          }

          btn.addEventListener('click', function () {
            selectImportedReport(report.report_id);
          });

          reportContainer.appendChild(btn);
        });
      });

      categorySection.appendChild(reportContainer);

      // Collapse / expand
      categoryHeader.addEventListener('click', function () {
        var collapsed = reportContainer.style.display === 'none';
        if (collapsed) {
          reportContainer.style.display = 'flex';
          chevron.style.transform = 'rotate(0deg)';
        } else {
          reportContainer.style.display = 'none';
          chevron.style.transform = 'rotate(-90deg)';
        }
      });

      moduleMenu.appendChild(categorySection);

    } catch (error) {
      console.error('[Reporting] Failed to load imported reports:', error);
    }
  }

  function selectImportedReport(reportId) {
    selectedImportedReportId = reportId;
    selectedModuleKey = null;

    // Clear all selections in the sidebar (both modules and imported reports)
    var moduleMenu = document.getElementById('moduleMenu');
    if (moduleMenu) {
      moduleMenu.querySelectorAll('button[data-module-key], button[data-report-id]').forEach(function (b) {
        b.style.background = 'none';
        b.style.color = 'var(--lex-text-primary)';
      });

      // Highlight the selected imported report
      var selected = moduleMenu.querySelector('button[data-report-id="' + reportId + '"]');
      if (selected) {
        selected.style.background = 'var(--lex-bg-accent-soft)';
        selected.style.color = 'var(--lex-text-accent)';
      }
    }

    var report = importedReports.find(function (r) { return r.report_id === reportId; });
    if (report) {
      showInfo('Selected: ' + report.name + '. Click "Run Report" to execute.');
    }
  }

  async function deleteImportedReport(reportId, reportName) {
    if (!confirm('Delete imported report "' + reportName + '"? This cannot be undone.')) return;

    try {
      await api.delete('/api/v1/reporting/reports/' + reportId);
      showInfo('Report "' + reportName + '" deleted.');
      if (selectedImportedReportId === reportId) {
        selectedImportedReportId = null;
      }
      await loadImportedReports();
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
    showInfo('Executing ' + reportName + '...');

    // Hide previous results
    var resultsEl = document.getElementById('moduleResults');
    if (resultsEl) resultsEl.style.display = 'none';
    setTopbarLanaVisible(true);

    try {
      var startTime = Date.now();

      var result = await api.post('/api/v1/reporting/reports/' + selectedImportedReportId + '/execute', {
        filters: {},
        bypass_cache: false
      });

      var executionTimeMs = Date.now() - startTime;

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

      // Update header
      var moduleTitleEl = document.getElementById('moduleTitle');
      var executionTimeEl = document.getElementById('executionTime');
      if (moduleTitleEl) moduleTitleEl.textContent = result.report ? result.report.name : reportName;
      if (executionTimeEl) executionTimeEl.textContent = (result.execution_time_ms || executionTimeMs) + 'ms';

      // Update period info
      var resultPeriodTypeEl = document.getElementById('resultPeriodType');
      if (resultPeriodTypeEl) resultPeriodTypeEl.textContent = 'Query';

      var resultCurrentPeriodEl = document.getElementById('resultCurrentPeriod');
      if (resultCurrentPeriodEl) resultCurrentPeriodEl.textContent = result.cached ? 'Cached' : 'Live';

      var resultPriorPeriodEl = document.getElementById('resultPriorPeriod');
      if (resultPriorPeriodEl) resultPriorPeriodEl.textContent = 'N/A';

      // Update data sources
      updateDataSources([]);

      // Show results container
      if (resultsEl) resultsEl.style.display = 'flex';

      // Render the results as a simple table in the visualizations container
      var vizContainer = document.getElementById('visualizationsContainer');
      if (vizContainer) {
        var rows = result.data || [];
        var rowCount = result.row_count || rows.length;

        if (!rows.length) {
          vizContainer.innerHTML = '<div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">' +
            '<p class="text-gray-500">No data returned. Check your report configuration and data sources.</p></div>';
        } else {
          // Build a data table from the results
          var columns = Object.keys(rows[0]);
          var tableHtml = '<div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">' +
            '<div class="p-4 border-b border-gray-100 flex items-center justify-between">' +
            '<h3 class="text-sm font-semibold text-gray-900">Results (' + rowCount + ' rows)</h3>' +
            '</div>' +
            '<div class="overflow-x-auto"><table class="min-w-full divide-y divide-gray-200">' +
            '<thead class="bg-gray-50"><tr>';

          columns.forEach(function (col) {
            tableHtml += '<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">' + escapeHtml(col) + '</th>';
          });
          tableHtml += '</tr></thead><tbody class="bg-white divide-y divide-gray-200">';

          var maxDisplay = Math.min(rows.length, 100);
          for (var i = 0; i < maxDisplay; i++) {
            tableHtml += '<tr>';
            columns.forEach(function (col) {
              var val = rows[i][col];
              if (val === null || val === undefined) val = '';
              tableHtml += '<td class="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">' + escapeHtml(String(val)) + '</td>';
            });
            tableHtml += '</tr>';
          }

          if (rows.length > 100) {
            tableHtml += '<tr><td colspan="' + columns.length + '" class="px-4 py-3 text-sm text-gray-500 text-center">Showing first 100 of ' + rowCount + ' rows</td></tr>';
          }

          tableHtml += '</tbody></table></div></div>';
          vizContainer.innerHTML = tableHtml;
        }
      }

      // Hide topbar LANA since in-card button is visible
      setTopbarLanaVisible(false);

      showInfo('Report executed successfully. ' + (result.row_count || 0) + ' rows returned in ' + (result.execution_time_ms || executionTimeMs) + 'ms' + (result.cached ? ' (cached)' : '') + '.');

    } catch (error) {
      console.error('[Reporting] V2 execution failed:', error);
      showError(error.message || 'Failed to execute report.');
    } finally {
      if (executeBtn) executeBtn.loading = false;
    }
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

      // Refresh the imported reports list
      await loadImportedReports();

      // Auto-select the imported report
      if (result.data && result.data.report_id) {
        selectImportedReport(result.data.report_id);
      }

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

  function initImportControls() {
    var importBtn = document.getElementById('importReportBtn');
    if (importBtn) {
      importBtn.addEventListener('click', openImportModal);
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

  // ==========================================================================
  // Window Namespace Exposure
  // ==========================================================================

  // ==========================================================================
  // Module Customization Panel
  // ==========================================================================

  var customizationCatalog = null; // Cached analytics catalog

  function openCustomizePanel() {
    var panel = document.getElementById('customizePanel');
    var overlay = document.getElementById('customizeOverlay');
    if (panel) panel.style.transform = 'translateX(0)';
    if (overlay) overlay.classList.remove('hidden');
    loadExistingCustomizations();
    loadAnalyticsCatalog();
  }

  function closeCustomizePanel() {
    var panel = document.getElementById('customizePanel');
    var overlay = document.getElementById('customizeOverlay');
    if (panel) panel.style.transform = 'translateX(100%)';
    if (overlay) overlay.classList.add('hidden');
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
          + (item.is_default ? '' : '<button onclick="window._reporting.setCustomizationDefault(\'' + item.id + '\')" class="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Set Default</button>')
          + '<button onclick="window._reporting.deleteCustomization(\'' + item.id + '\')" class="text-xs text-red-600 hover:text-red-800 font-medium">Delete</button>'
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
      + '<button type="button" class="text-red-500 hover:text-red-700 text-xs" onclick="this.parentElement.remove()">Remove</button>';
    container.appendChild(row);
  }

  function addDimensionRow() {
    var container = document.getElementById('custDimensionsContainer');
    if (!container) return;

    var options = '';
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
        options += '<option value="' + keys[k] + '">' + escapeHtml(allCols[keys[k]]) + '</option>';
      }
    }

    var row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = '<select class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm cust-dimension-input">'
      + '<option value="">Select column...</option>'
      + options
      + '</select>'
      + '<button type="button" class="text-red-500 hover:text-red-700 text-xs" onclick="this.parentElement.remove()">Remove</button>';
    container.appendChild(row);
  }

  function addFilterRow() {
    var container = document.getElementById('custFiltersContainer');
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = '<input type="text" placeholder="Column" class="w-28 border border-gray-300 rounded px-2 py-1 text-sm cust-filter-col" maxlength="100">'
      + '<select class="w-24 border border-gray-300 rounded px-2 py-1 text-sm cust-filter-op">'
      + '<option value="equals">equals</option><option value="not_equals">not equals</option>'
      + '<option value="contains">contains</option><option value="in">in</option>'
      + '<option value="gt">greater than</option><option value="lt">less than</option>'
      + '</select>'
      + '<input type="text" placeholder="Value" class="flex-1 border border-gray-300 rounded px-2 py-1 text-sm cust-filter-val" maxlength="255">'
      + '<button type="button" class="text-red-500 hover:text-red-700 text-xs" onclick="this.parentElement.remove()">Remove</button>';
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
        var val = input.value.trim ? input.value.trim() : input.value;
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
      showError('Module and customization name are required');
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

  function initCustomizePanel() {
    var customizeBtn = document.getElementById('customizeBtn');
    if (customizeBtn) customizeBtn.addEventListener('click', openCustomizePanel);

    var closeBtn = document.getElementById('closeCustomizePanel');
    if (closeBtn) closeBtn.addEventListener('click', closeCustomizePanel);

    var overlayEl = document.getElementById('customizeOverlay');
    if (overlayEl) overlayEl.addEventListener('click', closeCustomizePanel);

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
        sel.addEventListener('change', function () {
          var listId = id.replace('Mode', 'sList');
          var listEl = document.getElementById(listId);
          if (listEl) listEl.classList.toggle('hidden', !sel.value);
        });
      }
    });
  }

  // Show the customize button when a module is selected.
  // Customize is hidden until the surface is ready to ship; keep the badge
  // sync so any pending customization state stays consistent.
  function showCustomizeButton() {
    var btn = document.getElementById('customizeBtn');
    if (btn) btn.style.display = 'none';
    updateCustomizationBadge();
  }

  window._reporting = {
    openMetricInfo: openMetricInfo,
    showModuleInfo: showModuleInfo,
    closeModuleInfo: closeModuleInfo,
    exportToPDF: exportToPDF,
    exportToCSV: exportToCSV,
    closeDrilldownModal: closeDrilldownModal,
    openGenericDrilldown: openGenericDrilldown,
    showMetricDrilldown: showMetricDrilldown,
    openDataOverridePanel: openDataOverridePanel,
    closeDataOverridePanel: closeDataOverridePanel,
    deleteOverride: deleteOverride,
    closeDataSourcesModal: closeDataSourcesModal,
    closeMissingEntitiesModal: closeMissingEntitiesModal,
    askLanaAboutReport: askLanaAboutReport,
    closeImportModal: closeImportModal,
    openImportModal: openImportModal,
    deleteImportedReport: deleteImportedReport,
    openCustomizePanel: openCustomizePanel,
    closeCustomizePanel: closeCustomizePanel,
    setCustomizationDefault: setCustomizationDefault,
    deleteCustomization: deleteCustomization
  };

  // Also expose individually for V1 compat onclick handlers
  window.showMetricDrilldown = showMetricDrilldown;
  window.openGenericDrilldown = openGenericDrilldown;
  window.closeDrilldownModal = closeDrilldownModal;
  window.closeDataSourcesModal = closeDataSourcesModal;
  window.closeMissingEntitiesModal = closeMissingEntitiesModal;
  window.closeModuleInfo = closeModuleInfo;
  window.showModuleInfo = showModuleInfo;
  window.openDataOverridePanel = openDataOverridePanel;
  window.closeDataOverridePanel = closeDataOverridePanel;
  window.deleteOverride = deleteOverride;

  // ==========================================================================
  // Init
  // ==========================================================================

  // ==========================================================================
  // LANA Insights Panel (via lex-lana-panel)
  // ==========================================================================

  // setTopbarLanaVisible — no-op, topbar button replaced by lex-ask-lana-btn
  function setTopbarLanaVisible() {}

  // injectLanaButton — no longer needed, button is in HTML
  function injectLanaButton() {}

  // openInsightsPanel — delegates to panel.show()
  function openInsightsPanel() {
    var panel = document.getElementById('reportingLana');
    if (panel) panel.show();
  }

  /**
   * Create a report-run thread and open the insights panel focused on it.
   * Called when user clicks the in-card "Ask LANA" button after execution.
   */
  async function askLanaAboutReport() {
    if (typeof api === 'undefined') return;
    if (!currentModuleData && !currentModuleConfig) return;

    var panel = document.getElementById('reportingLana');
    if (!panel) return;

    var snapshot = {
      moduleName: currentModuleMetadata ? currentModuleMetadata.moduleName : selectedModuleKey,
      moduleKey: selectedModuleKey,
      periodType: currentModuleConfig ? currentModuleConfig.period && currentModuleConfig.period.type : null,
      periodStart: currentModuleConfig ? currentModuleConfig.period && currentModuleConfig.period.start : null,
      periodEnd: currentModuleConfig ? currentModuleConfig.period && currentModuleConfig.period.end : null,
      metrics: currentModuleData ? currentModuleData.map(function (m) {
        return { name: m.name, key: m.key, current: m.current, prior: m.prior, target: m.target, status: m.status };
      }) : [],
      executedAt: new Date().toISOString()
    };

    panel.show();
    await new Promise(function (resolve) { setTimeout(resolve, 300); });

    try {
      var title = (snapshot.moduleName || 'Report') + ' — '
        + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: getOrganizationTimezone() });

      await panel.createThread({
        title: title,
        thread_type: 'report_run',
        context_type: 'insights_chat',
        page_scope: 'reporting',
        metadata: snapshot
      });
    } catch (err) {
      console.error('[Reporting] Failed to create report-run thread:', err);
    }
  }

  // ==========================================================================
  // Init
  // ==========================================================================

  function init() {
    loadModules();
    loadImportedReports();
    initModuleSearch();
    initPeriodControls();
    initImportControls();
    initCustomizePanel();
    // Data sources button
    var dataSourcesBtn = document.getElementById('dataSourcesBtn');
    if (dataSourcesBtn) {
      dataSourcesBtn.addEventListener('click', openDataSourcesModal);
    }

    // Missing entities button
    var missingEntitiesBtn = document.getElementById('missingEntitiesBtn');
    if (missingEntitiesBtn) {
      missingEntitiesBtn.addEventListener('click', openMissingEntitiesModal);
    }

    // Data override panel close handlers
    var overlayEl = document.getElementById('dataOverrideOverlay');
    if (overlayEl) overlayEl.addEventListener('click', closeDataOverridePanel);
    var closePanelBtn = document.getElementById('closeDataOverridePanel');
    if (closePanelBtn) closePanelBtn.addEventListener('click', closeDataOverridePanel);

    // Override form submit
    var overrideForm = document.getElementById('overrideForm');
    if (overrideForm) overrideForm.addEventListener('submit', saveOverride);

    // Wire the in-card "Ask LANA" button to askLanaAboutReport
    var reportingLanaBtn = document.getElementById('reportingLanaBtn');
    if (reportingLanaBtn) {
      reportingLanaBtn.addEventListener('lex-ask-lana-click', function () {
        askLanaAboutReport();
      });
    }

    // Wire report-context attachment onto every Lana send so Lana grounds
    // her answers on the currently-displayed report (Option A: single
    // unified thread, shifting context per-send). Mirrors the document
    // chat pattern in file-viewer-page.js (lex-lana-before-send hook).
    wireReportingLanaContext();
  }

  // ==========================================================================
  // LANA Insights — Per-Send Context Injection
  // ==========================================================================

  // Build a structured snapshot of the currently-displayed report. Returns
  // null if no module has been executed yet, so general firm-wide questions
  // still pass through unchanged.
  function buildModuleContextAttachment() {
    // Nothing has been run — let the send go through with no module_context.
    if (!selectedModuleKey && !currentModuleConfig && !currentModuleData) {
      return null;
    }

    var moduleTitleEl = document.getElementById('moduleTitle');
    var resultPeriodTypeEl = document.getElementById('resultPeriodType');
    var resultCurrentPeriodEl = document.getElementById('resultCurrentPeriod');
    var resultPriorPeriodEl = document.getElementById('resultPriorPeriod');
    var executionTimeEl = document.getElementById('executionTime');
    var periodStartEl = document.getElementById('periodStart');
    var periodEndEl = document.getElementById('periodEnd');

    // Period start/end: prefer state (ISO from backend), fall back to date inputs.
    var periodStart = null;
    var periodEnd = null;
    if (currentModuleConfig && currentModuleConfig.period) {
      periodStart = currentModuleConfig.period.start || null;
      periodEnd = currentModuleConfig.period.end || null;
    }
    if (!periodStart && periodStartEl) periodStart = periodStartEl.value || null;
    if (!periodEnd && periodEndEl) periodEnd = periodEndEl.value || null;

    // Parse "1234ms" → 1234. Falls back to null if not parseable.
    var executionTimeMs = null;
    if (executionTimeEl && executionTimeEl.textContent) {
      var match = executionTimeEl.textContent.match(/(\d+)/);
      if (match) executionTimeMs = parseInt(match[1], 10);
    }

    // Metric snapshots: keep raw numbers AND the user-visible formatted strings
    // so Lana can both reason numerically and reference exactly what the user
    // is looking at. We deliberately exclude underlying SQL row data.
    var metrics = [];
    if (Array.isArray(currentModuleData)) {
      metrics = currentModuleData.map(function (m) {
        return {
          key: m.key,
          label: m.name,
          current_value: m.current,
          prior_value: m.prior,
          target_value: m.target,
          unit: m.unit || null,
          type: m.type || null,
          status: m.status || null,
          change: (m.change !== undefined) ? m.change : null,
          change_direction: m.changeDirection || null,
          formatted_current: m.formattedCurrent || null,
          formatted_prior: m.formattedPrior || null
        };
      });
    }

    var moduleName = (currentModuleMetadata && currentModuleMetadata.moduleName)
      || (moduleTitleEl ? moduleTitleEl.textContent : '')
      || selectedModuleKey
      || '';

    return {
      module_key: selectedModuleKey || (currentModuleMetadata ? currentModuleMetadata.moduleKey : null),
      module_name: moduleName,
      period: {
        start: periodStart,
        end: periodEnd,
        label: resultCurrentPeriodEl ? resultCurrentPeriodEl.textContent : null,
        compare_by: resultPeriodTypeEl ? resultPeriodTypeEl.textContent : null,
        prior_label: resultPriorPeriodEl ? resultPriorPeriodEl.textContent : null
      },
      metrics: metrics,
      execution_time_ms: executionTimeMs
    };
  }

  function attachCurrentModuleContextToComposer() {
    if (reportingModuleContextDismissed) return;
    var panel = document.getElementById('reportingLana');
    if (!panel || typeof panel.attachModuleContext !== 'function') return;
    var ctx = buildModuleContextAttachment();
    if (ctx) panel.attachModuleContext(ctx);
  }

  // Guard against double-binding when init() runs twice (page-init may
  // both auto-call init() and re-fire it via LexRouter.registerPageInit).
  // Two listeners would each set module_context idempotently — harmless —
  // but we still avoid stacking them.
  var _reportingLanaContextWired = false;

  function wireReportingLanaContext() {
    if (_reportingLanaContextWired) return;
    var panel = document.getElementById('reportingLana');
    if (!panel) return;
    _reportingLanaContextWired = true;

    panel.addEventListener('lex-lana-module-context-remove', function () {
      reportingModuleContextDismissed = true;
    });

    panel.addEventListener('lex-lana-before-send', function (e) {
      // Defensive: any throw from this listener must NOT bubble up and break
      // the chat send pipeline. If anything goes wrong building the context,
      // fall back to sending without it.
      try {
        var opts = e.detail && e.detail.opts;
        if (!opts) return;

        if (reportingModuleContextDismissed) {
          opts.contextType = 'data_chat';
          if (opts.attachments) delete opts.attachments.module_context;
          return;
        }

        var ctx = buildModuleContextAttachment();
        if (!ctx) {
          opts.contextType = 'data_chat';
          return;
        }

        opts.attachments = opts.attachments || {};
        opts.attachments.module_context = ctx;
        opts.contextType = 'insights_chat';
        attachCurrentModuleContextToComposer();
      } catch (err) {
        console.warn('[Reporting] Failed to attach module_context to chat send:', err);
      }
    });
  }

  if (typeof LexRouter !== 'undefined') {
    LexRouter.registerPageInit('admin/reporting.html', init);
  }
  init();

})();

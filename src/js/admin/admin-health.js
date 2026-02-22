/**
 * System Health — Standalone Page Controller
 *
 * Responsible for all data loading, rendering, and interval management
 * for the admin/health.html page.
 *
 * All state is scoped inside the IIFE.
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Cache configuration (ms)
  // -------------------------------------------------------------------------

  var CACHE_DURATION = {
    summary:    30000,   // 30s — overall status changes frequently
    services:   30000,   // 30s
    metrics:    60000,   // 1 min
    storage:   300000,   // 5 min — changes slowly
    tokenUsage:300000,   // 5 min — historical data
    dlq:        60000    // 1 min
  };

  // -------------------------------------------------------------------------
  // Module-level state
  // -------------------------------------------------------------------------

  var healthCache = {
    summary:    null,
    services:   null,
    metrics:    null,
    storage:    null,
    tokenUsage: {},   // keyed by period string
    dlq:        null
  };

  var currentTokenPeriod  = '7days';
  var currentEnergyPeriod = '24hours';
  var _healthIntervalId   = null;
  var _energyIntervalId   = null;
  var _loadGen            = 0;  // generation counter for async renders

  // -------------------------------------------------------------------------
  // Cache helpers
  // -------------------------------------------------------------------------

  function isCacheValid(entry, duration) {
    if (!entry) return false;
    return (Date.now() - entry.timestamp) < duration;
  }

  function getCachedOrFetch(key, fetchFn, duration) {
    if (isCacheValid(healthCache[key], duration)) {
      return Promise.resolve(healthCache[key].data);
    }
    return fetchFn().then(function (data) {
      healthCache[key] = { data: data, timestamp: Date.now() };
      return data;
    });
  }

  function clearCache() {
    healthCache.summary    = null;
    healthCache.services   = null;
    healthCache.metrics    = null;
    healthCache.storage    = null;
    healthCache.tokenUsage = {};
    healthCache.dlq        = null;
  }

  // -------------------------------------------------------------------------
  // Format helpers
  // -------------------------------------------------------------------------

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k     = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i     = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatMilliseconds(ms) {
    if (!ms || ms === 0) return '0ms';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function formatUptime(seconds) {
    if (!seconds) return '-';
    var days    = Math.floor(seconds / 86400);
    var hours   = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var parts   = [];
    if (days    > 0) parts.push(days    + 'd');
    if (hours   > 0) parts.push(hours   + 'h');
    if (minutes > 0) parts.push(minutes + 'm');
    return parts.length ? parts.join(' ') : '< 1m';
  }

  function formatKwh(k) {
    if (k === null || k === undefined) return '--';
    if (k < 0.01 && k > 0) return k.toFixed(4);
    return k.toFixed(2);
  }

  function parseEnergyValue(val) {
    if (val == null) return null;
    var n = typeof val === 'string' ? parseFloat(val) : val;
    return Number.isFinite(n) ? n : null;
  }

  // -------------------------------------------------------------------------
  // Safe element text setter — avoids innerHTML, no XSS risk
  // -------------------------------------------------------------------------

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setKv(id, value) {
    var el = document.getElementById(id);
    if (el) el.setAttribute('value', String(value));
  }

  // -------------------------------------------------------------------------
  // Status badge helpers
  // -------------------------------------------------------------------------

  function statusColor(status) {
    var s = String(status || '').toLowerCase();
    if (s === 'healthy' || s === 'ok' || s === 'up') return 'green';
    if (s === 'degraded' || s === 'warning') return 'yellow';
    if (s === 'unhealthy' || s === 'error' || s === 'down') return 'red';
    return 'gray';
  }

  function injectBadge(containerId, label, color) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var badge = document.createElement('lex-badge');
    badge.setAttribute('label', label.toUpperCase());
    badge.setAttribute('color', color);
    badge.setAttribute('size', 'lg');
    el.innerHTML = '';
    el.appendChild(badge);
  }

  // -------------------------------------------------------------------------
  // Main health loader
  // -------------------------------------------------------------------------

  function loadHealth() {
    var gen = ++_loadGen;

    // Shimmer only the cards refreshed by loadHealth (not the energy card)
    var HEALTH_CARD_IDS = [
      'systemMetricsCard', 'processMetricsCard',
      'cpuInfoCard', 'databaseMetricsCard', 'storageInfoCard',
      'dlqCard', 'tokenUsageCard'
    ];
    var cards = HEALTH_CARD_IDS.map(function (id) {
      return document.getElementById(id);
    }).filter(Boolean);
    for (var i = 0; i < cards.length; i++) {
      Lex.Redact.on(cards[i]);
    }

    Promise.all([
      getCachedOrFetch('summary',  function () { return api.getHealthSummary(); },  CACHE_DURATION.summary),
      getCachedOrFetch('services', function () { return api.getHealthServices(); }, CACHE_DURATION.services),
      getCachedOrFetch('metrics',  function () { return api.getHealthMetrics(); },  CACHE_DURATION.metrics)
    ]).then(function (results) {
      if (gen !== _loadGen) return; // stale response — discard

      var summary  = results[0] || {};
      var services = results[1] || {};
      var metrics  = results[2] || {};

      // -- Overall status -------------------------------------------------------
      var status = String(summary.status || 'unknown').toLowerCase();

      var msg = 'All services are operational';
      if (status === 'degraded')   msg = 'Some services are experiencing issues';
      if (status === 'unhealthy')  msg = 'System is experiencing problems';
      var banner = document.getElementById('healthBanner');
      if (banner) banner.subtitle = msg;

      // Badge must be injected AFTER the banner re-render completes.
      // Setting subtitle triggers a microtask re-render that restores children
      // from the initial snapshot (cloneNode), wiping any dynamic content.
      // requestAnimationFrame runs after the microtask, so the badge persists.
      var badgeLabel = summary.status || 'Unknown';
      var badgeColor = statusColor(status);
      requestAnimationFrame(function () {
        injectBadge('overallStatusBadge', badgeLabel, badgeColor);
      });

      // -- Service cards --------------------------------------------------------
      renderServiceCards(services.services || []);

      // -- System metrics -------------------------------------------------------
      var sys = metrics.system || {};
      var mem = sys.memory || {};
      var memPct = Number(mem.usage_percent) || 0;

      var memBar = document.getElementById('memoryBar');
      if (memBar) memBar.setAttribute('value', String(memPct));
      setText('memoryPct', memPct + '%');
      setText('memoryDetail', (mem.used_mb || 0) + ' MB / ' + (mem.total_mb || 0) + ' MB');

      setKv('sysKvPlatform',  sys.platform || '-');
      setKv('sysKvArch',      sys.arch || '-');
      setKv('sysKvHostname',  sys.hostname || '-');
      setKv('sysKvUptime',    formatUptime(sys.uptime_seconds));

      // -- Process metrics -------------------------------------------------------
      var proc    = metrics.process || {};
      var procMem = proc.memory || {};
      setKv('procKvPid',        String(proc.pid || '-'));
      setKv('procKvUptime',     formatUptime(proc.uptime_seconds));
      setKv('procKvHeapUsed',   (procMem.heap_used_mb  || 0) + ' MB');
      setKv('procKvHeapTotal',  (procMem.heap_total_mb || 0) + ' MB');
      setKv('procKvRss',        (procMem.rss_mb        || 0) + ' MB');
      setKv('procKvExternal',   (procMem.external_mb   || 0) + ' MB');

      // -- Database metrics -------------------------------------------------------
      var db = metrics.database || {};
      setKv('dbKvActiveConn',   String(db.active_connections || 0));
      setKv('dbKvCacheHit',     String(db.cache_hit_ratio   || 'N/A'));
      setKv('dbKvTxCommitted',  (db.transactions_committed   || 0).toLocaleString());
      setKv('dbKvTxRolledBack', (db.transactions_rolled_back || 0).toLocaleString());

      // -- CPU info -------------------------------------------------------
      var cpu = sys.cpu || {};
      setKv('cpuKvModel',  cpu.model || '-');
      setKv('cpuKvCores',  String(cpu.cores || '-'));
      setKv('cpuKvLoad1',  String(cpu.load_avg_1min  || '-'));
      setKv('cpuKvLoad5',  String(cpu.load_avg_5min  || '-'));
      setKv('cpuKvLoad15', String(cpu.load_avg_15min || '-'));

      // -- Last updated -------------------------------------------------------
      setText('lastUpdatedText', 'Updated: ' + Lex.Utils.formatDateTime(new Date()));

      // -- Remove shimmers -------------------------------------------------------
      if (typeof Lex !== 'undefined' && Lex.Redact) {
        for (var j = 0; j < cards.length; j++) {
          Lex.Redact.off(cards[j]);
        }
      }

      // -- Load dependent sections -------------------------------------------------------
      return Promise.all([
        loadStorageInfo(),
        loadTokenUsage(currentTokenPeriod),
        loadDLQMetrics()
      ]);

    }).catch(function (err) {
      console.error('[HealthPage] loadHealth failed:', err);
      Lex.Toast.error('Failed to load health data');
    });
  }

  // -------------------------------------------------------------------------
  // Service cards renderer
  // -------------------------------------------------------------------------

  function renderServiceCards(servicesList) {
    var grid = document.getElementById('serviceCardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    servicesList.forEach(function (service) {
      var card = document.createElement('lex-card');
      card.setAttribute('variant', 'flat');

      var headerRow  = document.createElement('div');
      headerRow.className = 'flex items-center justify-between mb-3';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'font-medium text-sm lex-text-primary';
      nameSpan.textContent = String(service.name || 'Service');

      var badge = document.createElement('lex-badge');
      badge.setAttribute('label', String(service.status || 'unknown').toUpperCase());
      badge.setAttribute('color', statusColor(service.status));
      badge.setAttribute('size', 'sm');

      headerRow.appendChild(nameSpan);
      headerRow.appendChild(badge);
      card.appendChild(headerRow);

      var detail = document.createElement('div');
      detail.className = 'space-y-1';

      if (service.type) {
        var kv1 = document.createElement('lex-kv');
        kv1.setAttribute('label', 'Type');
        kv1.setAttribute('value', String(service.type));
        kv1.setAttribute('direction', 'horizontal');
        detail.appendChild(kv1);
      }

      if (service.latency_ms != null) {
        var kv2 = document.createElement('lex-kv');
        kv2.setAttribute('label', 'Latency');
        kv2.setAttribute('value', service.latency_ms + 'ms');
        kv2.setAttribute('direction', 'horizontal');
        detail.appendChild(kv2);
      }

      if (service.version) {
        var kv3 = document.createElement('lex-kv');
        kv3.setAttribute('label', 'Version');
        kv3.setAttribute('value', String(service.version));
        kv3.setAttribute('direction', 'horizontal');
        detail.appendChild(kv3);
      }

      if (service.error) {
        var errEl = document.createElement('p');
        errEl.className = 'text-xs mt-1';
        errEl.style.color = 'var(--lex-color-danger-600)';
        errEl.textContent = 'Error: ' + String(service.error);
        detail.appendChild(errEl);
      }

      card.appendChild(detail);
      grid.appendChild(card);
    });
  }

  // -------------------------------------------------------------------------
  // Storage info
  // -------------------------------------------------------------------------

  function loadStorageInfo() {
    return getCachedOrFetch(
      'storage',
      function () { return api.get('/api/v1/admin/health/storage'); },
      CACHE_DURATION.storage
    ).then(function (response) {
      var storage = (response && response.storage) || {};
      var pct = Number(storage.usage_percent) || 0;

      setKv('stgKvTotal',     formatBytes(storage.total_bytes     || 0));
      setKv('stgKvUsed',      formatBytes(storage.used_bytes      || 0));
      setKv('stgKvAvailable', formatBytes(storage.available_bytes || 0));
      setKv('stgKvPct',       pct + '%');

      var bar = document.getElementById('storageBar');
      if (bar) {
        // Color based on usage level
        var barColor = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'accent';
        bar.setAttribute('value', String(pct));
        bar.setAttribute('color', barColor);
      }
      setText('storageUsagePct', pct + '%');

    }).catch(function (err) {
      console.error('[HealthPage] loadStorageInfo failed:', err);
      setKv('stgKvTotal',     'N/A');
      setKv('stgKvUsed',      'N/A');
      setKv('stgKvAvailable', 'N/A');
      setKv('stgKvPct',       'N/A');
    });
  }

  // -------------------------------------------------------------------------
  // Token usage
  // -------------------------------------------------------------------------

  function loadTokenUsage(period) {
    currentTokenPeriod = period;

    // Per-period cache
    var cached = healthCache.tokenUsage[period];
    var fetchFn = function () {
      return api.get('/api/v1/admin/health/token-usage?period=' + period).then(function (data) {
        healthCache.tokenUsage[period] = { data: data, timestamp: Date.now() };
        return data;
      });
    };

    var p;
    if (isCacheValid(cached, CACHE_DURATION.tokenUsage)) {
      p = Promise.resolve(cached.data);
    } else {
      p = fetchFn();
    }

    return p.then(function (response) {
      var usage = (response && response.usage) || {};
      setKv('tkKvTotal',        (usage.total_tokens    || 0).toLocaleString());
      setKv('tkKvInput',        (usage.input_tokens    || 0).toLocaleString());
      setKv('tkKvOutput',       (usage.output_tokens   || 0).toLocaleString());
      setKv('tkKvRequests',     (usage.total_requests  || 0).toLocaleString());
      setKv('tkKvTtft',         formatMilliseconds(usage.avg_time_to_first_token_ms || 0));
      setKv('tkKvResponseTime', formatMilliseconds(usage.avg_response_time_ms       || 0));

    }).catch(function (err) {
      console.error('[HealthPage] loadTokenUsage failed:', err);
      setKv('tkKvTotal',        'N/A');
      setKv('tkKvInput',        'N/A');
      setKv('tkKvOutput',       'N/A');
      setKv('tkKvRequests',     'N/A');
      setKv('tkKvTtft',         'N/A');
      setKv('tkKvResponseTime', 'N/A');
    });
  }

  // -------------------------------------------------------------------------
  // DLQ metrics
  // -------------------------------------------------------------------------

  function loadDLQMetrics() {
    return getCachedOrFetch(
      'dlq',
      function () { return api.get('/api/v1/dlq/stats'); },
      CACHE_DURATION.dlq
    ).then(function (response) {
      var stats           = (response && response.stats) || {};
      var pending         = Number(stats.pending          || 0);
      var retrying        = Number(stats.retrying         || 0);
      var permanentFailed = Number(stats.permanently_failed || 0);
      var successRate     = Number(stats.retry_success_rate || 0);
      var total           = pending + retrying + permanentFailed;

      // Status badge
      var dlqColor = 'green';
      var dlqLabel = 'HEALTHY';
      if (permanentFailed > 50 || pending > 100) {
        dlqColor = 'red';    dlqLabel = 'CRITICAL';
      } else if (permanentFailed > 10 || pending > 50 || successRate < 80) {
        dlqColor = 'yellow'; dlqLabel = 'WARNING';
      }
      injectBadge('dlqStatusBadge', dlqLabel, dlqColor);

      // KV values
      setKv('dlqKvPending',     pending.toLocaleString());
      setKv('dlqKvRetrying',    retrying.toLocaleString());
      setKv('dlqKvFailed',      permanentFailed.toLocaleString());
      setKv('dlqKvSuccessRate', successRate.toFixed(1) + '%');

      // Queue health bar
      var queueLabel = total === 0 ? 'No Failed Records' : total.toLocaleString() + ' Total';
      setText('dlqQueueLabel', queueLabel);

      var bar = document.getElementById('dlqBar');
      if (bar && total > 0) {
        // Multi-segment: pending=warning, retrying=info, failed=danger
        var segs = [];
        if (pending > 0) {
          segs.push({ value: parseFloat((pending / total * 100).toFixed(1)), color: 'warning', label: 'Pending' });
        }
        if (retrying > 0) {
          segs.push({ value: parseFloat((retrying / total * 100).toFixed(1)), color: 'info', label: 'Retrying' });
        }
        if (permanentFailed > 0) {
          segs.push({ value: parseFloat((permanentFailed / total * 100).toFixed(1)), color: 'danger', label: 'Failed' });
        }
        bar.segments = segs;
      } else if (bar) {
        bar.segments = [];
        bar.setAttribute('value', '100');
        bar.setAttribute('color', 'success');
      }

      // Legend pills
      renderDlqLegend(pending, retrying, permanentFailed, total);

    }).catch(function (err) {
      console.error('[HealthPage] loadDLQMetrics failed:', err);
      injectBadge('dlqStatusBadge', 'N/A', 'gray');
      setKv('dlqKvPending',     'N/A');
      setKv('dlqKvRetrying',    'N/A');
      setKv('dlqKvFailed',      'N/A');
      setKv('dlqKvSuccessRate', 'N/A');
      setText('dlqQueueLabel', 'DLQ metrics unavailable');
    });
  }

  function renderDlqLegend(pending, retrying, permanentFailed, total) {
    var legend = document.getElementById('dlqLegend');
    if (!legend) return;
    legend.innerHTML = '';

    if (total === 0) return;

    var items = [];
    if (pending         > 0) items.push({ label: 'Pending',   color: 'yellow' });
    if (retrying        > 0) items.push({ label: 'Retrying',  color: 'blue'   });
    if (permanentFailed > 0) items.push({ label: 'Failed',    color: 'red'    });

    items.forEach(function (item) {
      var badge = document.createElement('lex-badge');
      badge.setAttribute('label', item.label);
      badge.setAttribute('color', item.color);
      badge.setAttribute('size', 'sm');
      legend.appendChild(badge);
    });
  }

  // -------------------------------------------------------------------------
  // Energy metrics
  // -------------------------------------------------------------------------

  function loadEnergyMetrics() {
    var period = currentEnergyPeriod;

    api.get('/api/v1/admin/health/energy?period=' + period + '&energy_unit=kwh').then(function (energyData) {

      // Current readings
      if (energyData.current) {
        var totalWatts = parseEnergyValue(energyData.current.total_power_watts);
        setText('currentPowerWatts', totalWatts != null ? totalWatts.toFixed(2) + ' W' : '-- W');

        var thermalLevel = energyData.current.thermal_level;
        setText('currentThermalLevel', thermalLevel != null ? thermalLevel + '%' : '--%');

        // Energy status badge
        var thermalState = String(energyData.current.thermal_state || '').toLowerCase();
        var badgeColor   = 'green';
        var badgeLabel   = 'NOMINAL';

        if (thermalState === 'critical' || (typeof thermalLevel === 'number' && thermalLevel > 75)) {
          badgeColor = 'red';    badgeLabel = 'CRITICAL';
        } else if (thermalState === 'elevated' || (typeof thermalLevel === 'number' && thermalLevel > 50)) {
          badgeColor = 'yellow'; badgeLabel = 'ELEVATED';
        } else if (thermalState === 'fair' || (typeof thermalLevel === 'number' && thermalLevel > 25)) {
          badgeColor = 'yellow'; badgeLabel = 'FAIR';
        } else if (thermalState && thermalState !== 'nominal') {
          badgeLabel = thermalState.toUpperCase();
        }

        injectBadge('energyStatusBadge', badgeLabel, badgeColor);
      }

      // Energy consumed (kWh)
      if (energyData.summary) {
        var energyUnit  = energyData.energy_unit || 'kwh';
        var totalEnergy = parseEnergyValue(energyData.summary.total_energy);
        var kWhConsumed;

        if (totalEnergy != null) {
          kWhConsumed = energyUnit === 'wh' ? totalEnergy / 1000 : totalEnergy;
        } else {
          var periodHours = { '1hour': 1, '6hours': 6, '24hours': 24, '7days': 168 };
          var hours   = periodHours[period] || 1;
          var avgWatts = parseEnergyValue(energyData.summary.avg_power_watts) || 0;
          kWhConsumed = (avgWatts * hours) / 1000;
        }

        setText('energyConsumedKwh', formatKwh(kWhConsumed));
      }

      // Power chart
      renderPowerChart(energyData.timeseries || []);

      // Process breakdown (best effort)
      api.get('/api/v1/admin/health/energy/processes').then(function (processData) {
        // Currently rendered in hidden section — no-op for display
        // Kept for future process-breakdown panel
      }).catch(function () {
        // Endpoint not available — no action needed
      });

    }).catch(function (err) {
      console.error('[HealthPage] loadEnergyMetrics failed:', err);
      injectBadge('energyStatusBadge', 'N/A', 'gray');
    });
  }

  // -------------------------------------------------------------------------
  // Power chart via lex-chart
  // -------------------------------------------------------------------------

  function renderPowerChart(timeseries) {
    var chartEl = document.getElementById('powerChart');
    if (!chartEl || typeof Chart === 'undefined') return;

    var labels      = timeseries.map(function (d) {
      return new Date(d.timestamp).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric'
      });
    });
    var powerData   = timeseries.map(function (d) { return parseEnergyValue(d.total_watts) || 0; });
    var thermalData = timeseries.map(function (d) { return d.thermal_level || 0; });
    var llmActivity = timeseries.map(function (d) { return d.llm_requests  || 0; });

    // Read colors from CSS custom properties so we follow design tokens
    var accentColor  = getComputedStyle(document.documentElement)
      .getPropertyValue('--lex-bg-accent').trim() || '#4f46e5';
    var warningColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--lex-color-warning-500').trim() || '#f97316';
    var successColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--lex-color-success-500').trim() || '#22c55e';

    var chartData = {
      labels: labels,
      datasets: [
        {
          label: 'Power (Watts)',
          data: powerData,
          borderColor: accentColor,
          backgroundColor: accentColor.indexOf('rgb') === 0
            ? accentColor.replace(')', ', 0.1)').replace('rgb(', 'rgba(')
            : accentColor + '1a',
          borderWidth: 2,
          tension: 0.3,
          yAxisID: 'y',
          fill: true
        },
        {
          label: 'Thermal Level (%)',
          data: thermalData,
          borderColor: warningColor,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3,
          yAxisID: 'y1',
          fill: false
        },
        {
          label: 'LLM Activity',
          data: llmActivity,
          borderColor: successColor,
          backgroundColor: successColor.indexOf('rgb') === 0
            ? successColor.replace(')', ', 0.3)').replace('rgb(', 'rgba(')
            : successColor + '4d',
          borderWidth: 0,
          type: 'bar',
          yAxisID: 'y2',
          barThickness: 4
        }
      ]
    };

    // Set chartData — lex-chart will create/update the Chart.js instance
    chartEl.chartData = chartData;

    // After lex-chart renders its canvas, apply the multi-axis options
    // We need to wait a microtask for lex-chart's updated() to run
    Promise.resolve().then(function () {
      if (chartEl._chart) {
        chartEl._chart.options = Object.assign({}, chartEl._chart.options, {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: true, position: 'top' },
            tooltip: {
              callbacks: {
                label: function (context) {
                  var label = context.dataset.label || '';
                  if (label) label += ': ';
                  if (context.parsed.y != null) {
                    if (context.dataset.label === 'Power (Watts)') {
                      label += context.parsed.y.toFixed(1) + ' W';
                    } else if (context.dataset.label === 'Thermal Level (%)') {
                      label += context.parsed.y.toFixed(0) + '%';
                    } else {
                      label += context.parsed.y;
                    }
                  }
                  return label;
                }
              }
            }
          },
          scales: {
            y: {
              type: 'linear', display: true, position: 'left',
              title: { display: true, text: 'Power (Watts)' },
              beginAtZero: true
            },
            y1: {
              type: 'linear', display: true, position: 'right',
              title: { display: true, text: 'Thermal (%)' },
              beginAtZero: true, max: 100,
              grid: { drawOnChartArea: false }
            },
            y2: {
              type: 'linear', display: false, position: 'right',
              beginAtZero: true, grid: { drawOnChartArea: false }
            }
          }
        });
        chartEl._chart.update();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Token period tabs setup
  // -------------------------------------------------------------------------

  function setupTokenTabs() {
    var tabsEl = document.getElementById('tokenPeriodTabs');
    if (!tabsEl) return;

    tabsEl.setAttribute('tabs', JSON.stringify([
      { id: '7days',    label: 'Last 7 Days'   },
      { id: '3months',  label: 'Last 3 Months' },
      { id: 'alltime',  label: 'All Time'       }
    ]));
    tabsEl.setAttribute('active', currentTokenPeriod);

    tabsEl.addEventListener('tab-change', function (e) {
      var period = (e.detail && e.detail.tab) || (e.detail && e.detail.id) || '7days';
      loadTokenUsage(period);
    });
  }

  // -------------------------------------------------------------------------
  // Energy period select setup
  // -------------------------------------------------------------------------

  function setupEnergySelect() {
    var selectEl = document.getElementById('energyPeriodSelect');
    if (!selectEl) return;

    selectEl.addEventListener('lex-change', function (e) {
      currentEnergyPeriod = e.detail.value || '24hours';
      loadEnergyMetrics();
    });
  }

  // -------------------------------------------------------------------------
  // Refresh button
  // -------------------------------------------------------------------------

  function setupRefreshButton() {
    var btn = document.getElementById('refreshBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      clearCache();
      loadHealth();
      loadEnergyMetrics();
    });
  }

  // -------------------------------------------------------------------------
  // Interval cleanup — clean up on page unload
  // -------------------------------------------------------------------------

  function stopIntervals() {
    if (_healthIntervalId) { clearInterval(_healthIntervalId); _healthIntervalId = null; }
    if (_energyIntervalId) { clearInterval(_energyIntervalId); _energyIntervalId = null; }
  }

  // -------------------------------------------------------------------------
  // Page init
  // -------------------------------------------------------------------------

  function init() {
    // Wire up interactive elements
    setupTokenTabs();
    setupEnergySelect();
    setupRefreshButton();

    // Initial data load
    loadHealth();
    loadEnergyMetrics();

    // Auto-refresh: 30s for health, 60s for energy
    _healthIntervalId = setInterval(loadHealth,       30000);
    _energyIntervalId = setInterval(loadEnergyMetrics, 60000);

    // Clean up intervals when navigating away from this page
    window.addEventListener('beforeunload', stopIntervals);
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  init();

})();

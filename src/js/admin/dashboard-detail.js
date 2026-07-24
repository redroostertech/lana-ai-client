/* Dashboard Detail - Role-aware LanaInsights dashboard views. */

(function () {
  'use strict';

  var VIEW_CONFIG = {
    owner: {
      title: 'Owner Performance',
      subtitle: 'Financial performance, cash flow, owner benefit, revenue goals, and compensation metrics',
      audience: 'owner',
      contextLabel: 'Executive financial view',
      contextDescription: 'Prioritizes top-line owner outcomes first, with supporting metric definitions available on each card.',
      fallbackQuery: 'owner revenue cash flow profit bonus goal',
    },
    department: {
      title: 'Department Dashboards',
      subtitle: 'Marketing, Sales & Intake, and Legal Department metrics for management visibility',
      audience: 'team',
      contextLabel: 'Management operating view',
      contextDescription: 'Groups populated metrics by department or domain so team performance reads as separate dashboard lanes.',
      fallbackQuery: 'marketing sales intake legal department cases',
    },
    attorney: {
      title: 'Attorney Performance',
      subtitle: 'Attorney-specific trust C&D meetings, owner-set targets, ACV, and bonus calculations',
      audience: 'attorney',
      contextLabel: 'Individual performance view',
      contextDescription: 'Surfaces attorney-specific outcomes, targets, and bonus indicators before the calculation notes.',
      fallbackQuery: 'attorney trust bonus target acv',
    },
    other: {
      title: 'Other Dashboards',
      subtitle: 'Additional dashboard views that can be added as the metric catalog expands',
      audience: '',
      contextLabel: 'Additional dashboard groups',
      contextDescription: 'Collects populated legal service, legacy, and configurable metrics outside the core dashboard views.',
      fallbackQuery: 'legacy maintenance funding guardianship probate medicaid',
    },
  };

  var metricInfoById = {};
  var allDashboardMetrics = [];
  var currentSummary = null;
  var currentDashboardType = 'owner';
  var activeTypeFilter = 'all';
  var activeSearchQuery = '';
  var lastSearchInputValue = '';
  var currentDashboardId = null;
  var currentDashboardName = '';
  var currentDashboardMetricKeys = null;
  var currentCardInstanceId = null;
  var currentPeriodPreset = 'last7days';
  var willDesignDrilldowns = {};
  var dashboardSwitcherItems = [];
  var dashboardSwitcherLoaded = false;
  var currentPeriod = {
    start: '',
    end: '',
    compareBy: 'monthly',
    label: 'Current period',
  };
  // Track whether the active period came from a week/month/quarter preset.
  // Presets compare against the previous calendar period; custom date ranges
  // compare against the previous equal-length window (METRIC_GOALS_DESIGN.md
  // section 11.2). Defaults true because the page boots on a preset.
  var currentPeriodIsPreset = true;

  function el(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  function getCurrentType() {
    var params = window.Lex && Lex.Nav && Lex.Nav.getParams ? Lex.Nav.getParams() : new URLSearchParams(window.location.search || '');
    var type = params.get('type') || 'owner';
    return VIEW_CONFIG[type] ? type : 'owner';
  }

  function getParams() {
    return window.Lex && Lex.Nav && Lex.Nav.getParams ? Lex.Nav.getParams() : new URLSearchParams(window.location.search || '');
  }

  function isWillDesignCardInstance(instanceId) {
    return String(instanceId || '').indexOf('will-design-meetings') !== -1;
  }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value == null ? '-' : String(value);
  }

  function formatDate(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function parseDateInput(value, endOfDay) {
    if (!value) return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;

    var text = String(value);
    var hasTime = /T|\s\d{1,2}:\d{2}/.test(text);
    var parsed = new Date(hasTime ? text : text + (endOfDay ? 'T23:59:59' : 'T00:00:00'));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function toPeriodISOString(value, endOfDay) {
    var date = parseDateInput(value, endOfDay);
    return date ? date.toISOString() : '';
  }

  function formatPeriodLabel(start, end) {
    if (!start || !end) return 'Current period';
    var startDate = parseDateInput(start, false);
    var endDate = parseDateInput(end, false);
    if (!startDate || !endDate) return 'Current period';
    return startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' - '
      + endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function updateCompareByOptions(start, end, preset) {
    var compare = el('dashboardPeriodType');
    if (!compare || !start || !end) return;

    var currentValue = compare.value || currentPeriod.compareBy || 'monthly';
    var startDate = parseDateInput(start, false);
    var endDate = parseDateInput(end, true);
    if (!startDate || !endDate) return;
    var durationDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    var allOptions = [
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'yearly', label: 'Yearly' },
    ];

    if (preset === 'lastYear' || (durationDays >= 365 && durationDays <= 366)) {
      compare.options = [{ value: 'monthly', label: 'Monthly' }];
      compare.value = 'monthly';
    } else {
      compare.options = allOptions;
      compare.value = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].indexOf(currentValue) !== -1 ? currentValue : 'monthly';
    }
  }

  function readPeriodControls() {
    var start = el('dashboardPeriodStart');
    var end = el('dashboardPeriodEnd');
    var compare = el('dashboardPeriodType');
    currentPeriod = {
      start: start ? start.value || '' : '',
      end: end ? end.value || '' : '',
      compareBy: compare && compare.value ? compare.value : 'monthly',
      label: formatPeriodLabel(start ? start.value : '', end ? end.value : ''),
    };
    return currentPeriod;
  }

  function getMetricCardRequestParams(type, limit) {
    var period = readPeriodControls();
    var params = { type: type, limit: limit };
    if (period.start) params.periodStart = toPeriodISOString(period.start, false);
    if (period.end) params.periodEnd = toPeriodISOString(period.end, true);
    if (period.compareBy) params.compareBy = period.compareBy;
    // Period-over-period comparison: ask the metric layer to attach a
    // `comparison` block. Preset periods use the calendar mode, custom ranges
    // use the contiguous equal-length mode.
    params.compareToPrevious = true;
    params.compareMode = (typeof MetricGoalComparison !== 'undefined')
      ? MetricGoalComparison.resolveCompareMode(currentPeriodIsPreset)
      : (currentPeriodIsPreset ? 'previous_calendar' : 'previous_period');
    // Goal visibility: the backend matches a goal's weekly/monthly target_period
    // exactly against periodType, which otherwise defaults to daily and never
    // matches. Forward the selected grain so monthly/weekly goals attach to the
    // dashboard cards (and the comparison uses the matching snapshot grain).
    params.periodType = (typeof MetricGoalComparison !== 'undefined')
      ? MetricGoalComparison.resolveGoalPeriodType(period.compareBy)
      : 'monthly';
    return params;
  }

  // Build the metric_detail href with the currently selected period serialized
  // into query params. Without this the detail page falls back to its default
  // period and shows numbers that don't match the modal the user just opened.
  function buildMetricDetailHref(metricKey) {
    var qs = 'metric_key=' + encodeURIComponent(metricKey || '');
    var startIso = currentPeriod.start ? toPeriodISOString(currentPeriod.start, false) : '';
    var endIso = currentPeriod.end ? toPeriodISOString(currentPeriod.end, true) : '';
    if (startIso) qs += '&periodStart=' + encodeURIComponent(startIso);
    if (endIso) qs += '&periodEnd=' + encodeURIComponent(endIso);
    if (currentPeriod.compareBy) qs += '&compareBy=' + encodeURIComponent(currentPeriod.compareBy);
    return 'admin/metric_detail.html?' + qs;
  }

  function selectDashboardPeriodPreset(preset, reload) {
    var today = new Date();
    var startDate;
    var endDate;

    switch (preset) {
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
      case 'last7days':
      default:
        endDate = new Date(today);
        startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 6);
        break;
    }

    var start = el('dashboardPeriodStart');
    var end = el('dashboardPeriodEnd');
    if (start) start.value = formatDate(startDate);
    if (end) end.value = formatDate(endDate);
    currentPeriodIsPreset = true;
    currentPeriodPreset = preset;
    updateCompareByOptions(formatDate(startDate), formatDate(endDate), preset);
    readPeriodControls();
    if (reload) reloadDashboardMetricsForCurrentPeriod();
  }

  // Monotonic token used to discard stale period-reload responses. Each
  // load* call captures the value at entry and refuses to commit results
  // if it is no longer the latest, so quick changes to start/end/compare
  // can't leave the dashboard rendering metrics for an older period.
  var dashboardLoadToken = 0;

  function reloadDashboardMetricsForCurrentPeriod() {
    if (currentDashboardId) {
      loadDashboardById(currentDashboardId);
    } else if (isWillDesignCardInstance(currentCardInstanceId)) {
      loadWillDesignCardInstance(currentCardInstanceId);
    } else {
      loadMetrics(currentDashboardType || getCurrentType());
    }
  }

  function firstValue() {
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (hasValue(value)) {
        return value;
      }
    }
    return '';
  }

  function hasValue(value) {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') {
      return Object.keys(value).length > 0;
    }
    return String(value).trim() !== '';
  }

  function displayText(value) {
    if (!hasValue(value)) return '';

    if (Array.isArray(value)) {
      return value.map(displayText).filter(Boolean).join(', ');
    }

    if (typeof value === 'object') {
      return displayText(
        value.label ||
        value.name ||
        value.title ||
        value.display_name ||
        value.displayName ||
        value.state ||
        value.status ||
        value.key ||
        value.id ||
        ''
      );
    }

    return String(value);
  }

  function formatMetricCardValue(metric) {
    if (hasValue(metric && metric.formatted_value)) return displayText(metric.formatted_value);
    var value = metric ? metric.value : null;
    var rawFormat = metric && metric.format;
    if (rawFormat && typeof rawFormat === 'object') rawFormat = rawFormat.type || rawFormat.style;
    var format = String(rawFormat || 'number').toLowerCase();
    var metadata = (metric && metric.metadata) || {};
    // Treat 0 and missing-value identically: a dashboard full of literal
    // zeros looks populated when it's actually empty. Render an em-dash so
    // "no signal yet" is unambiguous.
    if (value === 0) return '-';
    if (!hasValue(value)) return '-';

    if (Array.isArray(value)) {
      var metadataTotal = Number(metadata.total);
      if (Number.isFinite(metadataTotal)) {
        return formatMetricCardValue({ value: metadataTotal, format: format });
      }

      if (format === 'table') {
        return value.length.toLocaleString('en-US') + (value.length === 1 ? ' row' : ' rows');
      }

      var total = value.reduce(function (sum, item) {
        if (!item || typeof item !== 'object') return sum;
        var raw = item.value !== undefined ? item.value : (item.metric_value !== undefined ? item.metric_value : (item.total !== undefined ? item.total : item.count));
        var number = Number(raw);
        return Number.isFinite(number) ? sum + number : sum;
      }, 0);
      if (total !== 0 || value.some(function (item) {
        return item && typeof item === 'object' && (
          item.value !== undefined || item.metric_value !== undefined || item.total !== undefined || item.count !== undefined
        );
      })) {
        return formatMetricCardValue({ value: total, format: format });
      }
      return value.length.toLocaleString('en-US') + (value.length === 1 ? ' item' : ' items');
    }

    if (typeof value === 'object') {
      var candidate = value.value !== undefined ? value.value
        : (value.metric_value !== undefined ? value.metric_value
        : (value.total !== undefined ? value.total
        : (value.count !== undefined ? value.count
        : (value.amount !== undefined ? value.amount : null))));
      if (candidate !== null) return formatMetricCardValue({ value: candidate, format: format });
      return 'View details';
    }

    var numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      if (format === 'currency' || format === 'currency_breakdown') {
        return numericValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      }
      if (format === 'percentage' || format === 'percent') {
        return numericValue.toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
      }
      if (format === 'integer' || format === 'count') {
        return numericValue.toLocaleString('en-US', { maximumFractionDigits: 0 });
      }
      if (format === 'days') {
        return numericValue.toLocaleString('en-US', { maximumFractionDigits: 1 }) + (numericValue === 1 ? ' day' : ' days');
      }
    }

    return displayText(value);
  }

  function humanize(value) {
    return displayText(value)
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function getDefinition(metric) {
    return metric && metric.definition && typeof metric.definition === 'object' ? metric.definition : {};
  }

  function getMetricMeta(metric, field) {
    var definition = getDefinition(metric);
    var metadata = metric && metric.metadata && typeof metric.metadata === 'object' ? metric.metadata : {};
    return firstValue(
      metric && metric[field],
      metric && metric[field + '_name'],
      definition && definition[field],
      definition && definition[field + '_name'],
      metadata && metadata[field],
      metadata && metadata[field + '_name']
    );
  }

  function getGroupLabel(metric, type) {
    var definition = getDefinition(metric);
    var explicit = firstValue(
      metric.section,
      metric.dashboard_section,
      metric.dashboardSection,
      definition.section,
      definition.dashboard_section,
      definition.dashboardSection
    );
    if (explicit) return humanize(explicit);

    if (type === 'department') {
      var department = firstValue(getMetricMeta(metric, 'department'), getMetricMeta(metric, 'team'));
      if (department) return humanize(department);
    }

    var domain = firstValue(getMetricMeta(metric, 'domain'), getMetricMeta(metric, 'category'));
    if (domain) return humanize(domain);

    if (type === 'attorney') {
      var attorney = getMetricMeta(metric, 'attorney');
      if (attorney) return humanize(attorney);
    }

    var audienceFallback = firstValue(getMetricMeta(metric, 'audience'), getMetricMeta(metric, 'primary_audience'), getMetricMeta(metric, 'primaryAudience'));
    return audienceFallback ? humanize(audienceFallback) : 'Dashboard Metrics';
  }

  function getGroupKey(metric, type) {
    var definition = getDefinition(metric);
    var explicit = firstValue(
      metric.section && metric.section.key,
      metric.group && metric.group.key,
      metric.dashboard_section,
      metric.dashboardSection,
      definition.section,
      definition.dashboard_section,
      definition.dashboardSection
    );
    if (explicit) return displayText(explicit).toLowerCase();
    return getGroupLabel(metric, type).toLowerCase();
  }

  function groupMetrics(metrics, type) {
    var order = [];
    var groupsByKey = {};

    metrics.forEach(function (metric) {
      var label = getGroupLabel(metric, type);
      var key = getGroupKey(metric, type);
      if (!groupsByKey[key]) {
        groupsByKey[key] = { key: key, label: label, metrics: [] };
        order.push(key);
      }
      groupsByKey[key].metrics.push(metric);
    });

    return order.map(function (key) { return groupsByKey[key]; });
  }

  function setBanner(config) {
    var banner = el('dashboardDetailBanner');
    if (!banner) return;
    banner.setAttribute('heading', config.title);
    banner.setAttribute('subtitle', config.subtitle);
  }

  function setBannerForDashboard(dashboard) {
    var banner = el('dashboardDetailBanner');
    if (!banner || !dashboard) return;
    banner.setAttribute('heading', dashboard.name || 'Dashboard');
    banner.setAttribute('subtitle', dashboard.description || 'Metric cards backed by the report module metric catalog');
  }

  function renderDashboardSwitcher() {
    var wrapper = document.querySelector('lex-topbar .dash-dashboard-switcher');
    var heading = document.querySelector('lex-topbar .lex-topbar-heading');
    if ((!wrapper && !heading) || !dashboardSwitcherItems.length) return;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'dash-dashboard-switcher';
      heading.replaceWith(wrapper);
    }

    var selected = currentDashboardId || '';
    var options = [{ value: '', label: 'Dashboard' }].concat(dashboardSwitcherItems.map(function (dashboard) {
      return {
        value: dashboard.id,
        label: dashboard.name || 'Dashboard',
        description: dashboard.description || '',
      };
    }));

    wrapper.innerHTML = '<lex-select id="dashboardLibrarySwitcher" name="dashboardLibrarySwitcher" placeholder="Search dashboards..." searchable></lex-select>';
    var select = wrapper.querySelector('lex-select');
    if (select) {
      select.options = options;
      select.value = selected;
      select.addEventListener('lex-change', function (event) {
        var value = event.detail && event.detail.value;
        if (value && value !== currentDashboardId) {
          Lex.Nav.go('admin/dashboard-detail.html?id=' + encodeURIComponent(value));
        }
      });
    }
  }

  async function loadDashboardSwitcher() {
    if (dashboardSwitcherLoaded) {
      renderDashboardSwitcher();
      return;
    }
    dashboardSwitcherLoaded = true;

    try {
      var response = await api.listBIDashboards({ limit: 100, sort: 'name', order: 'asc' });
      var rows = response && Array.isArray(response.data) ? response.data : [];
      dashboardSwitcherItems = rows.filter(function (dashboard) {
        return dashboard && dashboard.id && dashboard.name;
      });
      renderDashboardSwitcher();
    } catch (err) {
      console.warn('[DashboardDetail] Could not load dashboard switcher:', err.message);
    }
  }

  function setActiveType(type) {
    var breadcrumb = el('dashboardDetailBreadcrumb');
    if (breadcrumb) {
      breadcrumb.items = [
        { label: 'Dashboard', href: 'admin/analytics.html' },
        { label: VIEW_CONFIG[type].title },
      ];
    }
  }

  function setActiveDashboardBreadcrumb(dashboard) {
    var breadcrumb = el('dashboardDetailBreadcrumb');
    if (breadcrumb) {
      breadcrumb.items = [
        { label: 'Dashboard', href: 'admin/analytics.html' },
        { label: 'Library', href: 'admin/dashboard-library.html' },
        { label: dashboard && dashboard.name ? dashboard.name : 'Dashboard' },
      ];
    }
  }

  function normalizeCardResponse(response) {
    var metrics = [];
    if (response) {
      if (Array.isArray(response.data)) metrics = response.data;
      else if (response.data && Array.isArray(response.data.metrics)) metrics = response.data.metrics;
      else if (Array.isArray(response.metrics)) metrics = response.metrics;
    }

    return {
      metrics: metrics,
      summary: response && response.summary ? response.summary : null,
    };
  }

  function renderSummary(metrics, summary, groups) {
    metrics.forEach(function (metric) {
      if (!metric.status && metric.executable === true) metric.status = 'active';
    });

    setText('dashboardMetricTotal', summary && summary.total !== undefined ? summary.total : metrics.length);
    setText('dashboardMetricExecutable', summary && summary.executable !== undefined ? summary.executable : metrics.filter(function (metric) { return metric.executable === true; }).length);
    setText('dashboardMetricPlanned', summary && summary.planned !== undefined ? summary.planned : metrics.filter(function (metric) { return metric.status === 'planned'; }).length);
    setText('dashboardMetricDomains', groups && groups.length ? groups.length : '-');
  }

  function renderViewContext(type, metrics, groups) {
    var context = el('dashboardViewContext');
    var config = VIEW_CONFIG[type];
    if (!context || !config) return;

    var groupLabel = groups.length === 1 ? '1 group' : groups.length + ' groups';
    var metricLabel = metrics.length === 1 ? '1 populated metric' : metrics.length + ' populated metrics';

    context.innerHTML = ''
      + '<div>'
      + '<div class="dash-view-context__eyebrow">' + escapeHtml(config.contextLabel) + '</div>'
      + '<div class="dash-view-context__title">' + escapeHtml(config.title) + '</div>'
      + '<div class="dash-view-context__text">' + escapeHtml(config.contextDescription) + '</div>'
      + '</div>'
      + '<div class="dash-view-context__meta">'
      + '<span>' + escapeHtml(metricLabel) + '</span>'
      + '<span>' + escapeHtml(groupLabel) + '</span>'
      + '</div>';
  }

  function metricMatchesSearch(metric, query) {
    if (!query) return true;
    var haystack = [
      metric.title,
      metric.name,
      metric.metric_key,
      metric.key,
      metric.domain,
      metric.category,
      getGroupLabel(metric, currentDashboardType),
      getMetricMeta(metric, 'audience'),
      getMetricMeta(metric, 'primary_audience'),
      getMetricMeta(metric, 'primaryAudience'),
    ].map(displayText).join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function getActiveSearchQuery() {
    var search = el('dashboardMetricSearch');
    return String((search && search.value) || activeSearchQuery || '').trim().toLowerCase();
  }

  function syncSearchFromInput(force) {
    var search = el('dashboardMetricSearch');
    var nextValue = search ? search.value || '' : activeSearchQuery || '';
    if (!force && nextValue === lastSearchInputValue && nextValue === activeSearchQuery) {
      return;
    }

    lastSearchInputValue = nextValue;
    activeSearchQuery = nextValue;
    renderMetrics(allDashboardMetrics, currentSummary, currentDashboardType);
  }

  function filterMetrics(metrics, type) {
    var query = getActiveSearchQuery();
    return metrics.filter(function (metric) {
      if (activeTypeFilter !== 'all' && getGroupKey(metric, type) !== activeTypeFilter) {
        return false;
      }
      return metricMatchesSearch(metric, query);
    });
  }

  function renderTypeFilters(groups) {
    var container = el('dashboardTypeFilters');
    if (!container) return;

    var total = allDashboardMetrics.length;
    var buttons = [
      '<button class="dash-browser__filter' + (activeTypeFilter === 'all' ? ' is-active' : '') + '" type="button" data-dashboard-type-filter="all">'
      + '<span>All Types</span><strong>' + escapeHtml(total) + '</strong></button>'
    ];

    groups.forEach(function (group) {
      buttons.push(
        '<button class="dash-browser__filter' + (activeTypeFilter === group.key ? ' is-active' : '') + '" type="button" data-dashboard-type-filter="' + escapeHtml(group.key) + '">'
        + '<span>' + escapeHtml(group.label) + '</span><strong>' + escapeHtml(group.metrics.length) + '</strong></button>'
      );
    });

    container.innerHTML = buttons.join('');
  }

  function detailRow(label, value) {
    return hasValue(value) ? '<div class="dash-metric-modal__detail"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(displayText(value)) + '</strong></div>' : '';
  }

  function detailBlock(label, value) {
    return hasValue(value) ? '<div class="dash-metric-modal__block"><span>' + escapeHtml(label) + '</span><p>' + escapeHtml(displayText(value)) + '</p></div>' : '';
  }

  function renderMetricCard(metric) {
    var title = metric.title || metric.name || humanize(metric.metric_key) || 'Metric';
    var value = formatMetricCardValue(metric);
    var cardId = metric.metric_key || metric.key || title;
    var typeLabel = getGroupLabel(metric, currentDashboardType);
    var periodLabel = metric.period || metric.period_label || currentPeriod.label || 'Current period';
    metricInfoById[cardId] = metric;

    var comparisonHtml = renderComparison(metric.comparison, metric.format);
    var goalHtml = renderGoal(metric.goal);

    return '<article class="dash-metric-card">'
      + '<div class="dash-metric-card__top">'
      + '<div>'
      + '<div class="dash-metric-card__eyebrow">' + escapeHtml(typeLabel) + '</div>'
      + '<div class="dash-metric-card__title">' + escapeHtml(title) + '</div>'
      + '</div>'
      + '<button class="dash-metric-card__info" type="button" aria-label="Metric details" data-metric-info="' + escapeHtml(cardId) + '">i</button>'
      + '</div>'
      + '<div class="dash-metric-card__result">'
      + '<div class="dash-metric-card__value">' + escapeHtml(value) + '</div>'
      + '<div class="dash-metric-card__period">' + escapeHtml(periodLabel) + '</div>'
      + '</div>'
      + comparisonHtml
      + goalHtml
      + '</article>';
  }

  // Period-over-period comparison row. The backend metric layer attaches a
  // `comparison` block (METRIC_GOALS_DESIGN.md section 11); null -> render
  // nothing so cards without snapshot history degrade gracefully.
  function renderComparison(comparison, format) {
    if (typeof MetricGoalComparison === 'undefined') return '';
    var view = MetricGoalComparison.buildComparisonView(comparison);
    if (!view) return '';

    var dirClass = 'dash-metric-card__delta--flat';
    var sign = '';
    if (view.direction === 'up') { dirClass = 'dash-metric-card__delta--up'; sign = '+'; }
    else if (view.direction === 'down') { dirClass = 'dash-metric-card__delta--down'; sign = '-'; }

    // A percent delta keeps its % label; an absolute delta is rendered in the
    // metric's own unit (currency/days/number) rather than a bare number.
    var deltaText = view.deltaLabel;
    if (comparison && (comparison.percent_change === null || comparison.percent_change === undefined)
        && typeof comparison.absolute_change === 'number' && isFinite(comparison.absolute_change)) {
      deltaText = formatMetricCardValue({ value: Math.abs(comparison.absolute_change), format: format });
    }

    var deltaHtml = deltaText
      ? '<span class="dash-metric-card__delta ' + dirClass + '">' + escapeHtml(sign + deltaText) + '</span>'
      : '';
    var priorHtml = view.hasPrevious
      ? '<span class="dash-metric-card__delta-prior">was ' + escapeHtml(formatMetricCardValue({ value: view.previousValue, format: format })) + '</span>'
      : '';

    return '<div class="dash-metric-card__comparison">'
      + deltaHtml
      + '<span class="dash-metric-card__delta-label">vs previous period</span>'
      + priorHtml
      + '</div>';
  }

  // Goal status band: status pill + attainment + optional pace indicator.
  // Null goal -> render nothing.
  function renderGoal(goal) {
    if (typeof MetricGoalComparison === 'undefined') return '';
    var view = MetricGoalComparison.buildGoalView(goal);
    if (!view) return '';

    var attainmentHtml = view.hasAttainment
      ? '<span class="dash-metric-card__goal-attainment">' + escapeHtml(view.attainmentLabel) + ' of goal</span>'
      : '';
    var paceHtml = view.pace
      ? '<span class="dash-metric-card__goal-pace">' + escapeHtml(view.pace.label) + '</span>'
      : '';

    return '<div class="dash-metric-card__goal">'
      + '<span class="dash-metric-card__goal-band dash-metric-card__goal-band--' + escapeHtml(view.band) + '">'
      + escapeHtml(view.statusLabel)
      + '</span>'
      + attainmentHtml
      + paceHtml
      + '</div>';
  }

  function renderModalDetails(metric) {
    var definition = getDefinition(metric);
    var status = metric.status || (metric.executable ? 'active' : 'planned');
    var value = formatMetricCardValue(metric);
    var audience = firstValue(getMetricMeta(metric, 'audience'), getMetricMeta(metric, 'primary_audience'), getMetricMeta(metric, 'primaryAudience'));
    var section = firstValue(metric.section, metric.group, metric.domain_group);
    var reportHref = metric.report_link && metric.report_link.href || metric.reportHref || 'admin/reporting.html';
    var metricHref = buildMetricDetailHref(metric.metric_key || metric.key || '');
    var message = metric.message || (metric.executable ? '' : 'Calculation is planned but not executable yet');
    var periodLabel = metric.period || metric.period_label || currentPeriod.label || 'Current period';

    // Humanize metadata fields. They arrive as snake_case identifiers from
    // the registry (e.g. `legal_operations`, `department_legal_estate_planning`),
    // and we never want raw keys in the UI. Metric Key is intentionally left
    // raw because that field's purpose is to show the canonical identifier.
    return ''
      + '<div class="dash-metric-modal__value">' + escapeHtml(value) + '</div>'
      + '<div class="dash-metric-modal__grid">'
      + detailRow('Status', humanize(status))
      + detailRow('Audience', humanize(audience))
      + detailRow('Section', humanize(section))
      + detailRow('Domain', humanize(metric.domain || metric.domain_group))
      + detailRow('Period', periodLabel)
      + detailRow('Metric Key', metric.metric_key)
      + '</div>'
      + detailBlock('Description', metric.description || 'Cataloged metric definition.')
      + detailBlock('Message', message)
      + detailBlock('Calculation', definition.calculation || 'Defined in metric catalog')
      + detailBlock('Business Logic', definition.businessLogic)
      + detailBlock('Entities', definition.entities)
      + detailBlock('Criteria', definition.criteria)
      + detailBlock('Dimensions', definition.dimensions)
      + '<div class="dash-metric-modal__footer">'
      + '<button class="dash-metric-card__link" type="button" data-metric-detail-link="' + escapeHtml(metricHref) + '">Open metric detail</button>'
      + '<button class="dash-metric-card__link" type="button" data-report-link="' + escapeHtml(reportHref) + '">View report</button>'
      + '</div>';
  }

  function openMetricModal(metricId) {
    var metric = metricInfoById[metricId];
    var modal = el('dashboardMetricModal');
    var eyebrow = el('dashboardMetricModalEyebrow');
    var title = el('dashboardMetricModalTitle');
    var body = el('dashboardMetricModalBody');
    if (!metric || !modal || !title || !body) return;

    var domain = firstValue(getMetricMeta(metric, 'domain'), getMetricMeta(metric, 'category'), 'Metric');
    if (eyebrow) eyebrow.textContent = humanize(domain);
    // Title fallback humanizes the raw key so the modal heading never shows
    // an identifier like `legal_firm.estate_planning.upcoming_poa_deed_design_meetings`.
    title.textContent = metric.title || metric.name || humanize(metric.metric_key) || 'Metric';
    body.innerHTML = renderModalDetails(metric);
    modal.hidden = false;
    document.body.classList.add('dash-metric-modal-open');
  }

  function closeMetricModal() {
    var modal = el('dashboardMetricModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('dash-metric-modal-open');
  }

  function renderGroup(group) {
    return '<section class="dash-metric-section">'
      + '<div class="dash-metric-section__header">'
      + '<div>'
      + '<h2 class="dash-metric-section__title">' + escapeHtml(group.label) + '</h2>'
      + '<div class="dash-metric-section__subtitle">' + escapeHtml(group.metrics.length + (group.metrics.length === 1 ? ' metric' : ' metrics')) + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="dash-card-grid">'
      + group.metrics.map(renderMetricCard).join('')
      + '</div>'
      + '</section>';
  }

  function unwrapWillDesignLane(response) {
    if (!response) return {};
    if (response.data && response.data.section) return response.data;
    if (response.data && response.data.data && response.data.data.section) return response.data.data;
    return response;
  }

  function willDesignFacadePeriodParams() {
    var presetMap = {
      thisMonth: 'this_month',
      lastMonth: 'last_month',
      thisQuarter: 'current_quarter',
      thisYear: 'ytd',
    };
    var params = {
      view: currentDashboardType === 'attorney' ? 'attorney' : 'owner',
      instance: currentDashboardType === 'attorney' ? 'attorney' : 'dashboard',
      card_instance: currentCardInstanceId || 'dashboard:estate-planning:will-design-meetings',
    };
    if (currentPeriodIsPreset && presetMap[currentPeriodPreset]) {
      params.period = presetMap[currentPeriodPreset];
      return params;
    }

    var period = readPeriodControls();
    params.period = 'custom';
    if (period.start) params.date_start = toPeriodISOString(period.start, false);
    if (period.end) params.date_end = toPeriodISOString(period.end, true);
    return params;
  }

  function willDesignPeriodMeta(lane) {
    var period = lane && lane.period ? lane.period : {};
    return period.label || currentPeriod.label || 'Selected period';
  }

  function willDesignSourceMeta(lane) {
    var source = lane && lane.source ? lane.source : {};
    var certification = lane && lane.certification ? lane.certification : {};
    var definition = certification.definition || {};
    var organization = certification.organization || {};
    var health = source.data_health_state || certification.data_health || 'unknown';
    var lastSync = source.last_successful_sync ? 'Synced ' + new Date(source.last_successful_sync).toLocaleString() : 'No sync timestamp';
    return [
      humanize(source.state || 'unknown'),
      humanize(health),
      lastSync,
      definition.label || humanize(definition.state || 'definition pending'),
      organization.label || humanize(organization.state || 'configuration required')
    ].filter(Boolean).join(' · ');
  }

  function willDesignMetricId(prefix, drilldown, period) {
    if (!drilldown || drilldown.available === false) return '';
    var id = prefix + ':' + Object.keys(willDesignDrilldowns).length;
    willDesignDrilldowns[id] = {
      module_key: drilldown.module_key,
      metric_key: drilldown.metric_key,
      period_start: drilldown.period_start || (period && period.start),
      period_end: drilldown.period_end || (period && period.end),
      filters: drilldown.filters || {}
    };
    return id;
  }

  function renderWillDesignStatusPill(label, value, tone) {
    return '<span class="dash-wdm-pill dash-wdm-pill--' + escapeHtml(tone || 'neutral') + '">'
      + escapeHtml(label) + ': ' + escapeHtml(value || '-')
      + '</span>';
  }

  function renderWillDesignSummaryCard(card, lane) {
    var drilldownId = willDesignMetricId(card.id || 'metric', card.drilldown, lane.period);
    var buttonAttrs = drilldownId ? ' data-wdm-detail-drilldown="' + escapeHtml(drilldownId) + '"' : ' disabled';
    return '<button type="button" class="dash-wdm-summary-card"' + buttonAttrs + '>'
      + '<span class="dash-wdm-summary-card__label">' + escapeHtml(card.title || 'Metric') + '</span>'
      + '<strong class="dash-wdm-summary-card__value">' + escapeHtml(formatMetricCardValue({ value: card.value, format: 'integer' })) + '</strong>'
      + '<span class="dash-wdm-summary-card__meta">' + escapeHtml(willDesignPeriodMeta(lane)) + '</span>'
      + '</button>';
  }

  function renderWillDesignComparisonDetail(lane) {
    var comparison = lane && lane.comparison ? lane.comparison : {};
    var current = comparison.current_period || {};
    var prior = comparison.comparison_period || {};
    var max = Math.max(Number(current.value) || 0, Number(prior.value) || 0, 1);
    var rows = [
      { label: current.label || 'Current period', value: Number(current.value) || 0, tone: 'current' },
      { label: prior.label || 'Previous period', value: Number(prior.value) || 0, tone: 'prior' },
    ];
    return '<section class="dash-wdm-panel">'
      + '<div class="dash-wdm-panel__header"><h2>This period vs prior period</h2><span>Completed meetings</span></div>'
      + '<div class="dash-wdm-bars">'
      + rows.map(function (row) {
        var width = Math.max(5, Math.round((row.value / max) * 100));
        return '<div class="dash-wdm-bars__row">'
          + '<span>' + escapeHtml(row.label) + '</span>'
          + '<progress class="dash-wdm-bars__bar dash-wdm-bars__bar--' + escapeHtml(row.tone) + '" max="100" value="' + escapeHtml(width) + '" aria-label="' + escapeHtml(row.label + ' completed meetings') + '"></progress>'
          + '<strong>' + escapeHtml(formatMetricCardValue({ value: row.value, format: 'integer' })) + '</strong>'
          + '</div>';
      }).join('')
      + '</div>'
      + '</section>';
  }

  function renderWillDesignTrendDetail(lane) {
    var rows = Array.isArray(lane && lane.ytd_trend) ? lane.ytd_trend : [];
    if (!rows.length) {
      return '<section class="dash-wdm-panel"><div class="dash-wdm-empty">No YTD completed meeting trend is available for this context.</div></section>';
    }
    var max = rows.reduce(function (acc, row) { return Math.max(acc, Number(row.value) || 0); }, 1);
    return '<section class="dash-wdm-panel">'
      + '<div class="dash-wdm-panel__header"><h2>YTD trend</h2><span>Click a month for records</span></div>'
      + '<div class="dash-wdm-trend">'
      + rows.map(function (row) {
        var id = willDesignMetricId('trend', row.drilldown, lane.period);
        var height = Math.max(7, Math.round(((Number(row.value) || 0) / max) * 100));
        var label = row.label || (row.month ? String(row.month).slice(5, 7) : '');
        return '<button type="button" class="dash-wdm-trend__item" data-wdm-detail-drilldown="' + escapeHtml(id) + '">'
          + '<progress class="dash-wdm-trend__bar" max="100" value="' + escapeHtml(height) + '" aria-label="' + escapeHtml(label + ' completed meetings') + '"></progress>'
          + '<span>' + escapeHtml(label) + '</span>'
          + '<strong>' + escapeHtml(formatMetricCardValue({ value: row.value, format: 'integer' })) + '</strong>'
          + '</button>';
      }).join('')
      + '</div>'
      + '</section>';
  }

  function renderWillDesignAttorneyDetail(lane) {
    var rows = Array.isArray(lane && lane.attorney_breakdown) ? lane.attorney_breakdown : [];
    if (!rows.length) {
      return '<section class="dash-wdm-panel"><div class="dash-wdm-empty">No attorney breakdown is available for this context.</div></section>';
    }
    var max = rows.reduce(function (acc, row) { return Math.max(acc, Number(row.total) || 0); }, 1);
    return '<section class="dash-wdm-panel">'
      + '<div class="dash-wdm-panel__header"><h2>Attorney breakdown</h2><span>Server-scoped to authorized attorneys</span></div>'
      + '<div class="dash-wdm-attorneys">'
      + rows.map(function (row) {
        var id = willDesignMetricId('attorney', row.drilldown, lane.period);
        var width = Math.max(5, Math.round(((Number(row.total) || 0) / max) * 100));
        return '<button type="button" class="dash-wdm-attorneys__row" data-wdm-detail-drilldown="' + escapeHtml(id) + '">'
          + '<span>' + escapeHtml(row.attorney_name || 'Unmapped Attorney') + '</span>'
          + '<progress class="dash-wdm-bars__bar" max="100" value="' + escapeHtml(width) + '" aria-label="' + escapeHtml((row.attorney_name || 'Unmapped Attorney') + ' completed meetings') + '"></progress>'
          + '<strong>' + escapeHtml(formatMetricCardValue({ value: row.total, format: 'integer' })) + '</strong>'
          + '</button>';
      }).join('')
      + '</div>'
      + '</section>';
  }

  function renderWillDesignWarnings(lane) {
    var warnings = lane && lane.source && Array.isArray(lane.source.warnings) ? lane.source.warnings.slice() : [];
    var mapping = lane && lane.mapping ? lane.mapping : {};
    var validation = mapping.validation || {};
    var unresolved = validation.unresolved || {};
    Object.keys(unresolved).forEach(function (key) {
      if (Array.isArray(unresolved[key]) && unresolved[key].length) {
        var sample = unresolved[key].slice(0, 3).map(displayText).filter(Boolean).join(', ');
        warnings.push(unresolved[key].length + ' unmapped ' + humanize(key).toLowerCase() + ' value' + (unresolved[key].length === 1 ? '' : 's') + (sample ? ': ' + sample : ''));
      }
    });
    if (!warnings.length) return '';
    return '<div class="dash-wdm-warning">' + warnings.slice(0, 3).map(function (warning) {
      return '<span>' + escapeHtml(warning) + '</span>';
    }).join('') + '</div>';
  }

  function renderWillDesignDetail(lane) {
    willDesignDrilldowns = {};
    var summary = Array.isArray(lane && lane.summary) ? lane.summary : [];
    var certification = lane && lane.certification ? lane.certification : {};
    var definition = certification.definition || {};
    var organization = certification.organization || {};
    var source = lane && lane.source ? lane.source : {};
    var cardsHtml = summary.length
      ? summary.map(function (card) { return renderWillDesignSummaryCard(card, lane); }).join('')
      : '<div class="dash-wdm-empty">No Will Design Meeting summary metrics are available for this context.</div>';

    return '<section class="dash-wdm-detail" aria-label="Will Design Meetings detail">'
      + '<div class="dash-wdm-hero">'
      + '<div><div class="dash-view-context__eyebrow">Reusable analytical card</div>'
      + '<h2>Will Design Meetings</h2>'
      + '<p>' + escapeHtml(willDesignSourceMeta(lane)) + '</p></div>'
      + '<div class="dash-wdm-pills">'
      + renderWillDesignStatusPill('Definition', definition.label || humanize(definition.state || 'unknown'), 'neutral')
      + renderWillDesignStatusPill('Organization', organization.label || humanize(organization.state || 'configuration required'), 'neutral')
      + renderWillDesignStatusPill('Source', humanize(source.state || 'unknown'), 'neutral')
      + '</div>'
      + '</div>'
      + renderWillDesignWarnings(lane)
      + '<div class="dash-wdm-summary">' + cardsHtml + '</div>'
      + '<div class="dash-wdm-grid">'
      + renderWillDesignComparisonDetail(lane)
      + renderWillDesignTrendDetail(lane)
      + renderWillDesignAttorneyDetail(lane)
      + '</div>'
      + '</section>';
  }

  function showWillDesignOnlyMode() {
    var rail = document.querySelector('.dash-browser__rail');
    var browser = document.querySelector('.dash-browser');
    var context = el('dashboardViewContext');
    if (rail) rail.hidden = true;
    if (browser) browser.classList.add('dash-browser--single');
    if (context) context.innerHTML = '';
  }

  async function loadWillDesignCardInstance(instanceId) {
    dashboardLoadToken += 1;
    var myToken = dashboardLoadToken;
    currentCardInstanceId = instanceId || 'dashboard:estate-planning:will-design-meetings';
    currentDashboardId = null;
    currentDashboardType = getCurrentType();
    allDashboardMetrics = [];
    currentSummary = null;
    metricInfoById = {};
    showWillDesignOnlyMode();
    setBanner({
      title: currentDashboardType === 'attorney' ? 'My Will Design Meetings' : 'Will Design Meetings Detail',
      subtitle: 'Reusable analytical definition with period comparison, trend, attorney breakdown, and record-level drilldown',
    });
    setActiveType(currentDashboardType);
    renderSummary([], { total: 1, executable: 1, planned: 0 }, [{ key: 'will-design-meetings', label: 'Will Design Meetings', metrics: [] }]);
    var grid = el('dashboardMetricGrid');
    var empty = el('dashboardMetricEmpty');
    if (empty) empty.hidden = true;
    if (grid) grid.innerHTML = '<section class="dash-wdm-panel"><div class="dash-wdm-empty">Loading Will Design Meetings...</div></section>';

    try {
      var response = await api.getCommandCenterWillDesignMeetings(willDesignFacadePeriodParams());
      if (myToken !== dashboardLoadToken) return;
      var lane = unwrapWillDesignLane(response);
      if (grid) grid.innerHTML = renderWillDesignDetail(lane);
      if (window.FeatureTracker && typeof window.FeatureTracker.trackFeature === 'function') {
        window.FeatureTracker.trackFeature('will_detail_dashboard_opened', {
          card_instance_id: currentCardInstanceId,
          period: lane && lane.period ? lane.period.key : (willDesignFacadePeriodParams().period || 'custom'),
          result_category: Array.isArray(lane.summary) && lane.summary.length ? 'loaded' : 'empty_or_unavailable'
        });
      }
    } catch (err) {
      if (myToken !== dashboardLoadToken) return;
      console.error('[DashboardDetail] Failed to load Will Design Meetings instance:', err);
      if (grid) grid.innerHTML = '<section class="dash-wdm-panel"><div class="dash-wdm-empty">Will Design Meetings could not be loaded for this card instance.</div></section>';
    }
  }

  function openWillDesignDetailDrilldown(id) {
    var payload = id ? willDesignDrilldowns[id] : null;
    if (!payload || !payload.module_key || !payload.metric_key || !payload.period_start || !payload.period_end) return;
    if (!window.drilldownRenderer || typeof window.drilldownRenderer.open !== 'function') {
      console.warn('[DashboardDetail] Drilldown renderer is not loaded');
      return;
    }
    window.drilldownRenderer.open(payload.module_key, payload.metric_key, {
      periodStart: payload.period_start,
      periodEnd: payload.period_end,
      filters: payload.filters || {}
    });
    if (window.FeatureTracker && typeof window.FeatureTracker.trackFeature === 'function') {
      window.FeatureTracker.trackFeature('will_drilldown_opened', {
        card_instance_id: currentCardInstanceId || 'dashboard',
        metric_key: payload.metric_key,
        filter_count: Object.keys(payload.filters || {}).length
      });
    }
  }

  function renderMetrics(metrics, summary, type) {
    var grid = el('dashboardMetricGrid');
    var empty = el('dashboardMetricEmpty');
    if (!grid) return;

    var dashboardType = type || getCurrentType();
    var allGroups = groupMetrics(allDashboardMetrics, dashboardType);
    var filteredMetrics = filterMetrics(metrics, dashboardType);
    var groups = groupMetrics(filteredMetrics, dashboardType);
    metricInfoById = {};
    renderSummary(allDashboardMetrics, summary, allGroups);
    renderViewContext(dashboardType, allDashboardMetrics, allGroups);
    renderTypeFilters(allGroups);

    if (!filteredMetrics.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = groups.map(renderGroup).join('');
  }

  async function loadMetrics(type) {
    dashboardLoadToken += 1;
    var myToken = dashboardLoadToken;
    var config = VIEW_CONFIG[type];
    var banner = el('dashboardDetailBanner');
    if (banner) banner.classList.add('dashboard-detail-banner--no-actions');
    currentDashboardId = null;
    currentDashboardName = '';
    currentDashboardMetricKeys = null;
    currentDashboardType = type;
    activeTypeFilter = 'all';
    activeSearchQuery = '';
    lastSearchInputValue = '';
    allDashboardMetrics = [];
    currentSummary = null;
    setBanner(config);
    loadDashboardSwitcher();
    setActiveType(type);
    var search = el('dashboardMetricSearch');
    if (search) search.value = '';
    renderMetrics([], null, type);

    try {
      var response = await api.getDashboardMetricCards(getMetricCardRequestParams(type, 250));
      if (myToken !== dashboardLoadToken) return;
      var normalized = normalizeCardResponse(response);
      allDashboardMetrics = normalized.metrics;
      currentSummary = normalized.summary;
      var params = getParams();
      var initialQuery = params.get('q');
      if (initialQuery && search) {
        search.value = initialQuery;
        activeSearchQuery = initialQuery;
        lastSearchInputValue = initialQuery;
      }
      renderMetrics(allDashboardMetrics, currentSummary, type);
    } catch (err) {
      if (myToken !== dashboardLoadToken) return;
      console.error('[DashboardDetail] Failed to load metrics:', err);
      allDashboardMetrics = [];
      currentSummary = null;
      renderMetrics([], null, type);
    }
  }

  async function loadDashboardById(id) {
    dashboardLoadToken += 1;
    var myToken = dashboardLoadToken;
    currentDashboardId = id;
    currentDashboardName = '';
    currentDashboardMetricKeys = null;
    activeTypeFilter = 'all';
    activeSearchQuery = '';
    lastSearchInputValue = '';
    allDashboardMetrics = [];
    currentSummary = null;

    try {
      var dashboardResponse = await api.getBIDashboard(id);
      if (myToken !== dashboardLoadToken) return;
      var dashboard = dashboardResponse && dashboardResponse.data ? dashboardResponse.data : dashboardResponse;
      currentDashboardName = dashboard && dashboard.name ? dashboard.name : '';
      loadDashboardSwitcher();
      var banner = el('dashboardDetailBanner');
      if (banner) banner.classList.remove('dashboard-detail-banner--no-actions');
      var layout = dashboard && dashboard.layout ? dashboard.layout : {};
      var type = VIEW_CONFIG[layout.dashboard_type] ? layout.dashboard_type : 'owner';
      var metricKeys = Array.isArray(layout.metric_keys) ? layout.metric_keys : [];
      currentDashboardMetricKeys = new Set(metricKeys);
      currentDashboardType = type;
      setBannerForDashboard(dashboard);
      setActiveDashboardBreadcrumb(dashboard);
      renderMetrics([], null, type);

      var metricResponse = await api.getDashboardMetricCards(getMetricCardRequestParams(type, 500));
      if (myToken !== dashboardLoadToken) return;
      var normalized = normalizeCardResponse(metricResponse);
      allDashboardMetrics = normalized.metrics.filter(function (metric) {
        if (currentDashboardMetricKeys.size === 0) return true;
        var key = metric.metric_key || metric.key;
        var shortKey = String(key || '').split('.').pop();
        return currentDashboardMetricKeys.has(key) || currentDashboardMetricKeys.has(shortKey);
      });
      currentSummary = null;
      renderMetrics(allDashboardMetrics, currentSummary, type);
    } catch (err) {
      if (myToken !== dashboardLoadToken) return;
      console.error('[DashboardDetail] Failed to load dashboard:', err);
      allDashboardMetrics = [];
      currentSummary = null;
      renderMetrics([], null, currentDashboardType);
    }
  }

  async function deleteCurrentDashboard() {
    if (!currentDashboardId) return;
    var confirmed = window.confirm('Delete "' + (currentDashboardName || 'this dashboard') + '"?');
    if (!confirmed) return;

    try {
      await api.deleteBIDashboard(currentDashboardId);
      if (window.Lex && Lex.Toast) Lex.Toast.success('Dashboard deleted');
      Lex.Nav.go('admin/dashboard-library.html');
    } catch (err) {
      if (window.Lex && Lex.Toast) Lex.Toast.error(err.message || 'Could not delete dashboard');
      else console.error(err);
    }
  }

  function initPeriodControls() {
    selectDashboardPeriodPreset('last7days', false);

    var presets = el('dashboardPeriodPresets');
    if (presets) {
      presets.addEventListener('click', function (event) {
        var btn = event.target.closest('lex-btn[data-dashboard-preset]');
        if (!btn) return;
        selectDashboardPeriodPreset(btn.getAttribute('data-dashboard-preset'), true);
      });
    }

    function handlePeriodChange() {
      var start = el('dashboardPeriodStart');
      var end = el('dashboardPeriodEnd');
      // A manual edit to the start/end inputs is a custom range, not a preset.
      currentPeriodIsPreset = false;
      if (start && end && start.value && end.value) {
        updateCompareByOptions(start.value, end.value, null);
      }
      readPeriodControls();
      reloadDashboardMetricsForCurrentPeriod();
    }

    var startInput = el('dashboardPeriodStart');
    var endInput = el('dashboardPeriodEnd');
    var compare = el('dashboardPeriodType');
    if (startInput) startInput.addEventListener('lex-change', handlePeriodChange);
    if (endInput) endInput.addEventListener('lex-change', handlePeriodChange);
    if (compare) compare.addEventListener('lex-change', handlePeriodChange);
  }

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Admin gate: dashboard detail loads firm-wide metrics, admin-only.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    initPeriodControls();

    content.addEventListener('click', function (event) {
      if (event.target.closest('#openReportingBtn')) {
        Lex.Nav.go('admin/reporting.html');
      }

      if (event.target.closest('#editDashboardBtn') && currentDashboardId) {
        Lex.Nav.go('admin/dashboard-builder.html?id=' + encodeURIComponent(currentDashboardId));
      }

      if (event.target.closest('#deleteDashboardBtn') && currentDashboardId) {
        deleteCurrentDashboard();
        return;
      }

      var reportBtn = event.target.closest('[data-report-link]');
      if (reportBtn) {
        Lex.Nav.go(reportBtn.getAttribute('data-report-link') || 'admin/reporting.html');
      }

      var metricDetailBtn = event.target.closest('[data-metric-detail-link]');
      if (metricDetailBtn) {
        Lex.Nav.go(metricDetailBtn.getAttribute('data-metric-detail-link'));
      }

      var infoBtn = event.target.closest('[data-metric-info]');
      if (infoBtn) {
        openMetricModal(infoBtn.getAttribute('data-metric-info'));
      }

      var willDrilldownBtn = event.target.closest('[data-wdm-detail-drilldown]');
      if (willDrilldownBtn) {
        openWillDesignDetailDrilldown(willDrilldownBtn.getAttribute('data-wdm-detail-drilldown'));
      }

      if (event.target.closest('[data-dashboard-modal-close]')) {
        closeMetricModal();
      }

      var filterBtn = event.target.closest('[data-dashboard-type-filter]');
      if (filterBtn) {
        activeTypeFilter = filterBtn.getAttribute('data-dashboard-type-filter') || 'all';
        renderMetrics(allDashboardMetrics, currentSummary, currentDashboardType);
      }
    });

    function handleSearchEvent(event) {
      if (event.target && event.target.id === 'dashboardMetricSearch') {
        syncSearchFromInput(true);
      }
    }

    content.addEventListener('input', handleSearchEvent);
    content.addEventListener('search', handleSearchEvent);
    document.addEventListener('input', handleSearchEvent, true);
    document.addEventListener('search', handleSearchEvent, true);
    document.addEventListener('keyup', handleSearchEvent, true);

    var search = el('dashboardMetricSearch');
    if (search) {
      search.addEventListener('keyup', handleSearchEvent);
    }

    window.setInterval(function () {
      var searchInput = el('dashboardMetricSearch');
      if (!searchInput) return;
      if ((searchInput.value || '') !== lastSearchInputValue) {
        syncSearchFromInput(true);
      }
    }, 150);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeMetricModal();
      }
    });

    var params = getParams();
    var id = params.get('id');
    var cardInstance = params.get('card_instance');
    if (id) loadDashboardById(id);
    else if (isWillDesignCardInstance(cardInstance)) {
      currentCardInstanceId = cardInstance;
      selectDashboardPeriodPreset('thisMonth', false);
      loadWillDesignCardInstance(cardInstance);
    }
    else loadMetrics(getCurrentType());
  }

  window.LanaAdmin = window.LanaAdmin || {};
  window.LanaAdmin.DashboardDetail = {
    __test: {
      isWillDesignCardInstance: isWillDesignCardInstance,
      unwrapWillDesignLane: unwrapWillDesignLane,
      renderWillDesignDetail: renderWillDesignDetail,
      renderWillDesignWarnings: renderWillDesignWarnings,
      willDesignFacadePeriodParams: willDesignFacadePeriodParams,
      setState: function (nextState) {
        nextState = nextState || {};
        if (Object.prototype.hasOwnProperty.call(nextState, 'currentCardInstanceId')) currentCardInstanceId = nextState.currentCardInstanceId;
        if (Object.prototype.hasOwnProperty.call(nextState, 'currentDashboardType')) currentDashboardType = nextState.currentDashboardType;
        if (Object.prototype.hasOwnProperty.call(nextState, 'currentPeriodPreset')) currentPeriodPreset = nextState.currentPeriodPreset;
        if (Object.prototype.hasOwnProperty.call(nextState, 'currentPeriodIsPreset')) currentPeriodIsPreset = nextState.currentPeriodIsPreset;
        if (Object.prototype.hasOwnProperty.call(nextState, 'currentPeriod')) currentPeriod = nextState.currentPeriod;
      },
      getDrilldowns: function () { return willDesignDrilldowns; }
    }
  };

  init();
})();

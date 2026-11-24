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

  function parseDateInput(value, endOfDay) {
    if (!value) return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;

    var text = String(value);
    var hasTime = /T|\s\d{1,2}:\d{2}/.test(text);
    // Date-only picker values anchor to the UTC day, matching the
    // reporting/insights period semantics (previously local-anchored).
    var anchored = hasTime ? text : (endOfDay ? LanaTime.utcDayEnd(text) : LanaTime.utcDayStart(text));
    if (!anchored) return null;
    var parsed = new Date(anchored);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function formatPeriodLabel(start, end) {
    // Picker values are the firm's plain days; name those days as written.
    return LanaTime.formatUtcDayRange(start, end) || 'Current period';
  }

  function updateCompareByOptions(start, end, preset) {
    var compare = el('dashboardPeriodType');
    if (!compare || !start || !end) return;

    var currentValue = compare.value || currentPeriod.compareBy || 'monthly';
    var startDate = parseDateInput(start, false);
    var endDate = parseDateInput(end, true);
    if (!startDate || !endDate) return;
    var durationDays = Math.ceil((endDate - startDate) / LanaTime.MS_PER_DAY);
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

  // The page's default range (the preset it boots on), in the firm's days.
  function defaultPeriodDays() {
    var zone = window.Lex && Lex.Utils && Lex.Utils.getFirmTimezone ? Lex.Utils.getFirmTimezone() : undefined;
    return LanaTime.reportPresetDays(window.DashboardPeriod.DEFAULT_PRESET, zone);
  }

  // Always a full range: when the inputs are empty, half filled or not real
  // days, the default range is used and written back into the inputs, so
  // every card and link uses the window the page shows.
  function readPeriodControls() {
    var start = el('dashboardPeriodStart');
    var end = el('dashboardPeriodEnd');
    var compare = el('dashboardPeriodType');
    var picked = { start: start ? start.value || '' : '', end: end ? end.value || '' : '' };
    var resolved = window.DashboardPeriod.resolveRequestPeriod(picked, defaultPeriodDays);
    if (resolved.usedDefault) {
      if (start && start.value !== resolved.periodStart) start.value = resolved.periodStart;
      if (end && end.value !== resolved.periodEnd) end.value = resolved.periodEnd;
    }
    currentPeriod = {
      start: resolved.periodStart,
      end: resolved.periodEnd,
      compareBy: compare && compare.value ? compare.value : 'monthly',
      label: formatPeriodLabel(resolved.periodStart, resolved.periodEnd),
    };
    syncPresetChips();
    return currentPeriod;
  }

  // The lit quick-select chip, and the date pill's words, always come from
  // the dates on screen.
  function syncPresetChips() {
    var container = el('dashboardPeriodPresets');
    var pill = el('dashboardPeriodLabel');
    if (pill) pill.textContent = currentPeriod.label;
    if (!container || !container.querySelectorAll) return;
    var chips = Array.prototype.slice.call(container.querySelectorAll('lex-btn[data-dashboard-preset]'));
    var zone = window.Lex && Lex.Utils && Lex.Utils.getFirmTimezone ? Lex.Utils.getFirmTimezone() : undefined;
    var presets = chips.map(function (chip) {
      var name = chip.getAttribute('data-dashboard-preset');
      return [name, LanaTime.reportPresetDays(name, zone)];
    });
    var active = window.DashboardPeriod.matchPreset(currentPeriod, presets);
    chips.forEach(function (chip) {
      var on = chip.getAttribute('data-dashboard-preset') === active;
      var variant = on ? 'primary' : 'secondary';
      if (chip.getAttribute('variant') !== variant) chip.setAttribute('variant', variant);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on && pill) pill.textContent = chip.textContent.trim() + ' \u00b7 ' + currentPeriod.label;
    });
  }

  // The date pill opens a small panel with the quick picks and the fields.
  function setPeriodPanelOpen(open) {
    var panel = el('dashboardPeriodPanel');
    var toggle = el('dashboardPeriodToggle');
    if (panel) panel.hidden = !open;
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function initPeriodPanel() {
    var toggle = el('dashboardPeriodToggle');
    var panel = el('dashboardPeriodPanel');
    if (!toggle || !panel) return;
    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setPeriodPanelOpen(panel.hidden);
    });
    document.addEventListener('click', function (event) {
      if (panel.hidden || panel.contains(event.target) || toggle.contains(event.target)) return;
      // Date pickers and dropdowns render outside the panel; leave those alone.
      if (event.target.closest && event.target.closest('.lex-select-dropdown, .lex-dropdown')) return;
      setPeriodPanelOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) {
        setPeriodPanelOpen(false);
        toggle.focus();
      }
    });
  }

  function setPeriodLoading(loading) {
    var mark = el('dashboardPeriodLoading');
    if (mark) mark.hidden = !loading;
    var grid = el('dashboardMetricGrid');
    if (grid && grid.classList) grid.classList.toggle('dash-card-grid--refreshing', !!loading);
  }

  function getMetricCardRequestParams(type, limit) {
    var period = readPeriodControls();
    var params = { type: type, limit: limit };
    // Plain days (inclusive end), always both: the backend bounds them in
    // the firm's zone.
    params.periodStart = period.start;
    params.periodEnd = period.end;
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
  function buildMetricDetailHref(metricKey, options) {
    // The days the person picked (firm days before the cards load, too), as
    // plain days: the metric detail endpoint bounds them in the firm's zone,
    // the same way the cards were bounded.
    var period = readPeriodControls();
    return window.DashboardPeriod.metricDetailHref(metricKey, {
      periodStart: period.start, periodEnd: period.end, compareBy: period.compareBy,
    }, options);
  }

  // Presets are the firm's days (the firm's zone, Lex.Utils.getFirmTimezone),
  // so everyone in the firm sees the same cards. A stored user without the
  // firm's zone refetches the profile first (api.ensureFirmTimezone).
  // Each pick of dates bumps this; a preset still waiting on the firm zone
  // gives up when a newer pick happened, so a slow first click can never
  // overwrite the dates of a later one.
  var periodPickToken = 0;

  async function selectDashboardPeriodPreset(preset, reload) {
    periodPickToken += 1;
    var myPick = periodPickToken;
    await api.ensureFirmTimezone();
    if (myPick !== periodPickToken) return;
    var days = LanaTime.reportPresetDays(preset, Lex.Utils.getFirmTimezone());

    var start = el('dashboardPeriodStart');
    var end = el('dashboardPeriodEnd');
    if (start) start.value = days.start;
    if (end) end.value = days.end;
    currentPeriodIsPreset = true;
    updateCompareByOptions(days.start, days.end, preset);
    readPeriodControls();
    if (reload) reloadDashboardMetricsForCurrentPeriod();
  }

  // Monotonic token used to discard stale period-reload responses. Each
  // load* call captures the value at entry and refuses to commit results
  // if it is no longer the latest, so quick changes to start/end/compare
  // can't leave the dashboard rendering metrics for an older period.
  // Card loads: idle/loading/loaded/empty/error, latest request wins
  // (js/shared/load-state.js). Replaces a bare counter so "No metrics" only
  // shows after a finished request returned nothing.
  var cardLoads = window.LoadState.createLoadTracker();
  // The saved dashboard's declared cards (layout.cards), or null.
  var currentDeclaredCards = null;
  // The variant in view per declared card id (breakdown toggles).
  var variantPicks = {};
  // The text each tile showed last, so new dates count from the old number.
  var previousValues = {};

  function reloadDashboardMetricsForCurrentPeriod() {
    if (currentDashboardId) {
      loadDashboardById(currentDashboardId);
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
    // A real 0 is a value; only a missing value shows the shared empty token.
    // No-data cases arrive as a data_state and render the state block.
    if (!hasValue(value)) return window.DataState.EMPTY_VALUE;

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

  // "Good morning, Ana" above the dashboard's title (hidden when there is no
  // first name, so the title is not said twice).
  function setGreeting(title) {
    var node = el('dashboardGreeting');
    if (!node) return;
    var user = (window.api && window.api.user) || (window.Lex && Lex.state && Lex.state.user) || null;
    var line = window.DashboardLayout.greeting(new Date(), user, title);
    node.textContent = line;
    node.hidden = line === title;
  }

  function setBanner(config) {
    var banner = el('dashboardDetailBanner');
    if (!banner) return;
    banner.setAttribute('heading', config.title);
    banner.setAttribute('subtitle', config.subtitle);
    setGreeting(config.title);
  }

  function setBannerForDashboard(dashboard) {
    var banner = el('dashboardDetailBanner');
    if (!banner || !dashboard) return;
    banner.setAttribute('heading', dashboard.name || 'Dashboard');
    banner.setAttribute('subtitle', dashboard.description || 'Metric cards backed by the report module metric catalog');
    setGreeting(dashboard.name || 'Dashboard');
  }

  function renderDashboardSwitcher() {
    if (!dashboardSwitcherItems.length) return;
    window.TitleSwitcher.render({
      id: 'dashboardLibrarySwitcher',
      placeholder: 'Search dashboards...',
      value: currentDashboardId || '',
      options: [{ value: '', label: 'Dashboard' }].concat(dashboardSwitcherItems.map(function (dashboard) {
        return { value: dashboard.id, label: dashboard.name || 'Dashboard', description: dashboard.description || '' };
      })),
      onPick: function (value) {
        Lex.Nav.go('admin/dashboard-detail.html?id=' + encodeURIComponent(value));
      }
    });
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
        { label: 'All dashboards', href: 'admin/dashboard-library.html' },
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

  // Small muted counts in the header: how many cards have data, in how many groups.
  function renderViewContext(type, metrics, groups) {
    var context = el('dashboardViewContext');
    if (!context) return;

    var groupLabel = groups.length === 1 ? '1 group' : groups.length + ' groups';
    // A tile with no data (a data_state that is not ok) is not populated.
    var populated = metrics.filter(function (metric) { return !window.DataState.isProblem(metric); }).length;
    var metricLabel = populated === 1 ? '1 metric with data' : populated + ' metrics with data';

    context.innerHTML = '<span>' + escapeHtml(metricLabel) + '</span>'
      + '<span>' + escapeHtml(groupLabel) + '</span>';
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

  // Pill tabs across the top: All, then one per group, with counts.
  function renderTypeFilters(groups) {
    var container = el('dashboardTypeFilters');
    if (!container) return;

    function tab(key, label, count) {
      var active = activeTypeFilter === key;
      return '<button class="dash-tab' + (active ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (active ? 'true' : 'false')
        + '" data-dashboard-type-filter="' + escapeHtml(key) + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(count) + '</strong></button>';
    }

    container.innerHTML = [tab('all', 'All', allDashboardMetrics.length)].concat(groups.map(function (group) {
      return tab(group.key, group.label, group.metrics.length);
    })).join('');
  }

  function detailRow(label, value) {
    return hasValue(value) ? '<div class="dash-metric-modal__detail"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(displayText(value)) + '</strong></div>' : '';
  }

  function detailBlock(label, value) {
    return hasValue(value) ? '<div class="dash-metric-modal__block"><span>' + escapeHtml(label) + '</span><p>' + escapeHtml(displayText(value)) + '</p></div>' : '';
  }

  // Tiles animate (entrance, count-up, bars) only when new data arrives,
  // not when a search or type filter redraws the same numbers.
  var animateNextRender = false;
  var tileIndex = 0;

  // Nothing to chart for a list card that came back empty.
  var EMPTY_LIST_STATE = {
    data_state: 'insufficient_data',
    data_state_reason: 'There is nothing to show for these dates yet.',
  };

  // item: { role, span } from DashboardLayout.buildLayout (absent when a
  // single card is drawn on its own).
  function cardClass(extra, item) {
    var classes = 'dash-metric-card' + (extra ? ' ' + extra : '');
    if (item && item.role) {
      classes += ' dash-bento__item dash-bento__item--' + item.role;
      if (item.role === 'hero') classes += ' dash-metric-card--hero';
    }
    if (animateNextRender) {
      tileIndex += 1;
      classes += ' lex-entrance' + (tileIndex <= 5 ? ' lex-entrance-step-' + tileIndex : ' lex-entrance-step-5');
    }
    return classes;
  }

  // One click to the records behind the number: the metric detail page,
  // opened on its source records with the same dates.
  function recordsHref(cardId) {
    return window.DashboardPeriod.metricDetailHref(cardId, {
      periodStart: currentPeriod.start, periodEnd: currentPeriod.end, compareBy: currentPeriod.compareBy,
    }, { tab: 'source' });
  }

  var RECORDS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M3 5h18M3 12h18M3 19h18"/></svg>';

  // Label (small, muted) on the left; the records link and the details
  // button at the top right. withRecords is false on waiting cards.
  function cardTop(metric, cardId, withRecords) {
    var records = withRecords
      ? '<button class="dash-metric-card__icon-btn" type="button" title="See the records" aria-label="See the records" data-metric-detail-link="'
        + escapeHtml(recordsHref(cardId)) + '">' + RECORDS_ICON + '</button>'
      : '';
    return '<div class="dash-metric-card__top"><div class="dash-metric-card__label">'
      + '<div class="dash-metric-card__eyebrow">' + escapeHtml(getGroupLabel(metric, currentDashboardType)) + '</div>'
      + '<div class="dash-metric-card__title">' + escapeHtml(metric.title || metric.name || humanize(metric.metric_key) || 'Metric') + '</div>'
      + '</div>'
      + '<div class="dash-metric-card__tools">' + records
      + '<button class="dash-metric-card__info" type="button" aria-label="Metric details" data-metric-info="' + escapeHtml(cardId) + '">i</button>'
      + '</div></div>';
  }

  // The change against the previous period: a chip with an arrow when the
  // server sent a percent, otherwise the older absolute row.
  function deltaHtml(metric) {
    var arrow = window.MetricCardView.comparisonArrow(metric.comparison);
    if (arrow) return window.MiniCharts.deltaChip(arrow, 'vs previous period');
    return renderComparison(metric.comparison, metric.format);
  }

  // "Right now" for point-in-time cards (the server's period_scope), so no
  // one expects them to follow the dates; otherwise the period itself.
  function periodLine(metric) {
    if (window.MetricCardView.isPointInTime(metric)) {
      return '<div class="dash-metric-card__period dash-metric-card__period--now" title="This number is as of today. It does not follow the dates above.">Right now</div>';
    }
    return '<div class="dash-metric-card__period">' + escapeHtml(metric.period || metric.period_label || currentPeriod.label || 'Current period') + '</div>';
  }

  function plainNumber(value) {
    return value === null || value === undefined ? window.DataState.EMPTY_VALUE
      : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function renderListCard(metric, cardId, item) {
    var bars = window.MetricCardView.listBars(metric.value, 12);
    if (bars.empty) {
      return '<article class="' + cardClass('dash-metric-card--waiting', item) + '">' + cardTop(metric, cardId, false)
        + window.DataState.render(EMPTY_LIST_STATE, { calm: true }) + periodLine(metric) + '</article>';
    }
    return '<article class="' + cardClass('dash-metric-card--list', item) + '">' + cardTop(metric, cardId, true)
      + listChartHtml(metric)
      + periodLine(metric)
      + '</article>';
  }

  // A list metric's chart (columns, or bars past 12 rows) and its notes.
  function listChartHtml(metric) {
    var bars = window.MetricCardView.listBars(metric.value, 12);
    if (bars.empty) return window.DataState.render(EMPTY_LIST_STATE, { calm: true });
    // The unit: the server's row_format, else the card format.
    var unit = window.MetricCardView.listValueFormat(metric);
    var formatBar = unit === 'number' ? plainNumber : function (n) {
      return n === null ? window.DataState.EMPTY_VALUE : formatMetricCardValue({ value: n, format: unit === 'percent' ? 'percentage' : unit });
    };
    // More than 12 rows read better as horizontal bars (8 shown, the rest counted).
    if (bars.hiddenCount > 0) bars = window.MetricCardView.listBars(metric.value, 8);
    var action = bars.neededPending ? window.DataState.goalAction(metric) : null;
    var pendingNote = bars.neededPending
      ? '<p class="dash-metric-card__list-note">Needed counts appear once a goal is set.'
        + (action ? ' <button type="button" class="lex-data-state__action" data-data-state-action="' + escapeHtml(action.href) + '">' + escapeHtml(action.label) + '</button>' : '')
        + '</p>'
      : '';
    return '<div class="dash-metric-card__chart">' + window.MiniCharts.breakdownHtml(bars, formatBar) + pendingNote + '</div>';
  }

  // ── Declared cards (layout.cards; js/shared/dashboard-cards.js) ──────
  // A metric the response did not include reads as waiting, like the rest.
  var MISSING_METRIC = {
    data_state: 'insufficient_data',
    data_state_reason: 'This number did not come back for these dates.',
  };
  var declaredIndex = null;

  function metricTitle(metric, key) {
    return (metric && (metric.title || metric.name)) || humanize(String(key || '').split('.').pop());
  }

  function declaredTop(def, key, metric, withRecords, title) {
    if (metric) metricInfoById[key] = metric;
    var shown = Object.assign({}, metric || { metric_key: key }, { title: title || def.title || metricTitle(metric, key) });
    return cardTop(shown, key, withRecords);
  }

  function waitingChip(metric) {
    var view = window.DataState.view(metric || MISSING_METRIC, { calm: true }) || { title: 'Waiting', reason: '' };
    return '<span class="dash-chip-waiting" title="' + escapeHtml(view.reason) + '">' + escapeHtml(view.title) + '</span>';
  }

  // One detail line: a label (a link to that metric's records when it is
  // a metric) and its value. valueHtml is already escaped.
  function detailLine(label, valueHtml, key) {
    var labelHtml = key
      ? '<button type="button" class="dash-lines__label" data-metric-detail-link="' + escapeHtml(recordsHref(key)) + '" title="See the records">' + escapeHtml(label) + '</button>'
      : '<span class="dash-lines__label">' + escapeHtml(label) + '</span>';
    return '<li class="dash-lines__item">' + labelHtml + '<span class="dash-lines__value">' + valueHtml + '</span></li>';
  }

  function valueBlock(metric) {
    return '<div class="dash-metric-card__result">'
      + '<div class="dash-metric-card__value">' + escapeHtml(formatMetricCardValue(metric)) + '</div>'
      + deltaHtml(metric) + periodLine(metric) + '</div>';
  }

  function renderDeclaredGoal(resolved, layoutItem) {
    var def = resolved.def;
    var first = resolved.metrics[0];
    var metric = first.metric;
    var goal = window.DashboardCards.goalFor(metric);
    var main;
    if (first.waiting) {
      main = window.DataState.render(metric || MISSING_METRIC, { calm: true });
    } else if (goal && goal.progress && goal.progress.available) {
      var progress = goal.progress;
      var target = progress.target !== null ? formatMetricCardValue({ value: progress.target, format: metric.format }) : '';
      main = '<div class="dash-metric-card__result dash-metric-card__result--goal">'
        + window.MiniCharts.ringHtml(progress, { value: formatMetricCardValue(metric), target: target })
        + (progress.met ? '<lex-brand-mark class="dash-metric-card__goal-met" animation="success" size="32" label="Goal met"></lex-brand-mark>' : '')
        + '</div>' + deltaHtml(metric);
    } else {
      main = valueBlock(metric) + (goal && goal.progress && !goal.progress.available
        ? '<p class="dash-metric-card__goal-note">' + escapeHtml(goal.progress.note) + '</p>' : '');
    }
    var lines = (goal ? goal.details : []).map(function (detail) {
      return detailLine(detail.label, escapeHtml(formatMetricCardValue({ value: detail.value, format: metric.format })), null);
    }).concat(resolved.metrics.slice(1).map(function (entry) {
      return detailLine(metricTitle(entry.metric, entry.key),
        entry.waiting ? waitingChip(entry.metric) : escapeHtml(formatMetricCardValue(entry.metric)), entry.key);
    }));
    return '<article class="' + cardClass('dash-metric-card--goal', layoutItem) + '">'
      + declaredTop(def, first.key, metric, !first.waiting)
      + main
      + (lines.length ? '<ul class="dash-lines">' + lines.join('') + '</ul>' : '')
      + '</article>';
  }

  function renderDeclaredBreakdown(resolved, layoutItem) {
    var def = resolved.def;
    var active = window.DashboardCards.activeVariant(def, variantPicks[def.id]);
    var metric = window.DashboardCards.metricFor(declaredIndex, active.key);
    var toggle = def.variants.length
      ? '<div class="dash-variants" role="group" aria-label="Range">' + def.variants.map(function (variant, i) {
        var on = i === active.index;
        return '<button type="button" class="dash-variants__btn' + (on ? ' is-active' : '') + '" aria-pressed="' + (on ? 'true' : 'false')
          + '" data-dashboard-variant="' + escapeHtml(def.id + '|' + i) + '">' + escapeHtml(variant.label) + '</button>';
      }).join('') + '</div>'
      : '';
    var body;
    if (window.DashboardCards.isWaiting(metric)) body = window.DataState.render(metric || MISSING_METRIC, { calm: true });
    else if (Array.isArray(metric.value)) body = listChartHtml(metric);
    else body = valueBlock(metric);
    return '<article class="' + cardClass('dash-metric-card--list', layoutItem) + '">'
      + declaredTop(def, active.key, metric, !!metric)
      + toggle + body + (metric && Array.isArray(metric.value) ? periodLine(metric) : '')
      + '</article>';
  }

  function renderDeclaredGroup(resolved, layoutItem) {
    var def = resolved.def;
    var rows = window.DashboardCards.groupRows(def, declaredIndex);
    var firstOk = resolved.metrics.filter(function (entry) { return !entry.waiting; })[0];
    var chart = window.MiniCharts.groupHtml(rows, {
      funnel: def.chart === 'funnel',
      format: function (row) { return formatMetricCardValue(row.metric); },
      href: recordsHref,
      waitingLabel: function (row) {
        var view = window.DataState.view(row.metric || MISSING_METRIC, { calm: true });
        return view ? view.title : 'Waiting';
      },
    });
    return '<article class="' + cardClass('dash-metric-card--group', layoutItem) + '">'
      + declaredTop(def, def.keys[0], resolved.metrics[0].metric, false, def.title || metricTitle(resolved.metrics[0].metric, def.keys[0]))
      + '<div class="dash-metric-card__chart">' + chart + '</div>'
      + (firstOk ? periodLine(firstOk.metric) : '')
      + '</article>';
  }

  function renderDeclaredPair(resolved, layoutItem) {
    var def = resolved.def;
    var halves = resolved.metrics.map(function (entry) {
      var value = entry.waiting ? waitingChip(entry.metric)
        : '<span class="dash-pair__value">' + escapeHtml(formatMetricCardValue(entry.metric)) + '</span>' + deltaHtml(entry.metric);
      return '<div class="dash-pair__half">'
        + '<button type="button" class="dash-pair__label" data-metric-detail-link="' + escapeHtml(recordsHref(entry.key)) + '" title="See the records">'
        + escapeHtml(metricTitle(entry.metric, entry.key)) + '</button>' + value + '</div>';
    }).join('');
    var title = def.title || resolved.metrics.map(function (entry) { return metricTitle(entry.metric, entry.key); }).join(' and ');
    var firstOk = resolved.metrics.filter(function (entry) { return !entry.waiting; })[0];
    return '<article class="' + cardClass('dash-metric-card--pair', layoutItem) + '">'
      + declaredTop(def, def.keys[0], resolved.metrics[0].metric, false, title)
      + '<div class="dash-pair">' + halves + '</div>'
      + (firstOk ? periodLine(firstOk.metric) : '')
      + '</article>';
  }

  function renderDeclaredWorklist(resolved, layoutItem) {
    var def = resolved.def;
    var entry = resolved.metrics[0];
    return '<article class="' + cardClass('dash-metric-card--worklist', layoutItem) + '">'
      + declaredTop(def, entry.key, entry.metric, true)
      + valueBlock(entry.metric)
      + '<div class="dash-worklist mini-spark-slot--loading" data-worklist-key="' + escapeHtml(entry.key) + '"></div>'
      + '<button type="button" class="dash-metric-card__link dash-worklist__all" data-metric-detail-link="' + escapeHtml(recordsHref(entry.key)) + '">View all</button>'
      + '</article>';
  }

  function renderDeclaredCard(item) {
    var resolved = item.resolved;
    var layoutItem = { role: item.role, span: item.span };
    switch (resolved.def.kind) {
      case 'goal': return renderDeclaredGoal(resolved, layoutItem);
      case 'breakdown': return renderDeclaredBreakdown(resolved, layoutItem);
      case 'group': return renderDeclaredGroup(resolved, layoutItem);
      case 'pair': return renderDeclaredPair(resolved, layoutItem);
      case 'worklist': return renderDeclaredWorklist(resolved, layoutItem);
      default: return renderMetricCard(resolved.metrics[0].metric, layoutItem);
    }
  }

  // A declared card whose metrics are all waiting: one calm card in the
  // strip, showing the goal prompt when one of them has it.
  function renderDeclaredWaitingCard(resolved) {
    var pick = resolved.metrics.filter(function (entry) { return entry.metric && entry.metric.goal_input; })[0] || resolved.metrics[0];
    return '<article class="dash-metric-card dash-metric-card--waiting">'
      + declaredTop(resolved.def, pick.key, pick.metric, false, resolved.def.title || metricTitle(pick.metric, pick.key))
      + window.DataState.render(pick.metric || MISSING_METRIC, { calm: true }) + '</article>';
  }

  // Waiting cards collect in one strip at the bottom that opens on click.
  function renderWaitingStrip(cardsHtml) {
    if (!cardsHtml.length) return '';
    var count = cardsHtml.length === 1 ? '1 card is waiting for setup' : cardsHtml.length + ' cards are waiting for setup';
    return '<details class="dash-waiting-strip">'
      + '<summary class="dash-waiting-strip__summary"><lex-brand-mark animation="idle" size="24"></lex-brand-mark>'
      + '<span class="dash-waiting-strip__count">' + escapeHtml(count) + '</span>'
      + '<span class="dash-waiting-strip__hint">Show</span></summary>'
      + '<div class="dash-waiting-strip__cards">' + cardsHtml.join('') + '</div></details>';
  }

  // ── Worklists: the first rows behind a snapshot number ─────────────
  var worklistCache = {};

  function worklistHtml(rows) {
    if (!rows.length) return '<p class="dash-worklist__empty">No records right now.</p>';
    var columns = window.DashboardCards.worklistColumns(rows);
    var head = '<tr>' + columns.map(function (col) { return '<th scope="col">' + escapeHtml(humanize(col)) + '</th>'; }).join('') + '</tr>';
    var body = rows.slice(0, 5).map(function (row) {
      return '<tr>' + columns.map(function (col) {
        var value = row[col];
        if (value === null || value === undefined || value === '') return '<td class="dash-worklist__muted">' + escapeHtml(window.DataState.EMPTY_VALUE) + '</td>';
        var text = window.DashboardCards.isDateColumn(col) && window.Lex && Lex.Utils && Lex.Utils.formatDate ? Lex.Utils.formatDate(value)
          : (typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(value));
        var dot = col === 'status' ? '<span class="dash-dot dash-dot--' + escapeHtml(String(value).toLowerCase()) + '" aria-hidden="true"></span>' : '';
        return '<td>' + dot + escapeHtml(text) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="dash-worklist__table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  function queueWorklists(grid) {
    if (!grid.querySelectorAll || !window.api || typeof api.getMetricDetail !== 'function') return;
    Array.prototype.forEach.call(grid.querySelectorAll('[data-worklist-key]'), function (slot) {
      var key = slot.getAttribute('data-worklist-key');
      var cacheKey = [key, currentPeriod.start, currentPeriod.end].join('|');
      if (!worklistCache[cacheKey]) {
        worklistCache[cacheKey] = api.getMetricDetail(key, {
          periodStart: currentPeriod.start, periodEnd: currentPeriod.end, compareBy: currentPeriod.compareBy, rawLimit: 5,
        }).then(function (response) {
          var payload = response && response.data ? response.data : response;
          var rows = payload && payload.raw_data && Array.isArray(payload.raw_data.rows) ? payload.raw_data.rows : [];
          return rows.slice(0, 5);
        }).catch(function () { return null; });
      }
      worklistCache[cacheKey].then(function (rows) {
        slot.classList.remove('mini-spark-slot--loading');
        slot.innerHTML = rows ? worklistHtml(rows) : '';
      });
    });
  }


  function renderGoalCard(metric, cardId, progress, value, item) {
    var target = formatMetricCardValue({ value: progress.target, format: metric.format });
    var met = progress.met
      ? '<lex-brand-mark class="dash-metric-card__goal-met" animation="success" size="32" label="Goal met"></lex-brand-mark>'
      : '';
    return '<article class="' + cardClass('dash-metric-card--goal', item) + '">' + cardTop(metric, cardId, true)
      + '<div class="dash-metric-card__result dash-metric-card__result--goal">'
      + window.MiniCharts.ringHtml(progress, { value: value, target: target }) + met
      + '</div>'
      + deltaHtml(metric)
      + periodLine(metric)
      + '</article>';
  }

  function renderMetricCard(metric, item) {
    // A tile whose result is not ok (the backend failure model) shows the
    // shared state block, whatever kind of metric it is: calm "waiting"
    // wording for setup and goals, never a $0.
    if (window.DataState && window.DataState.isProblem(metric)) {
      var stateId = metric.metric_key || metric.key || metric.title;
      metricInfoById[stateId] = metric;
      var stateView = window.DataState.view(metric, { calm: true });
      return '<article class="' + cardClass(stateView && stateView.waiting ? 'dash-metric-card--waiting' : 'dash-metric-card--problem', item) + '">'
        + cardTop(metric, stateId, false) + window.DataState.render(metric, { calm: true }) + '</article>';
    }
    var intake = window.OpportunityIntakePresentation && window.OpportunityIntakePresentation.opportunityIntakePresentation(metric);
    if (intake) {
      var intakeId = metric.metric_key || metric.key;
      metricInfoById[intakeId] = metric;
      return '<article class="dash-metric-card"><div class="dash-metric-card__top"><div class="dash-metric-card__title">'
        + escapeHtml(metric.title || metric.name || 'Opportunity intake') + '</div>'
        + '<button class="dash-metric-card__info" type="button" aria-label="Metric details" data-metric-info="'
        + escapeHtml(intakeId) + '">i</button></div>'
        + window.OpportunityIntakePresentation.renderOpportunityIntake(intake, metric) + '</article>';
    }
    var acquisition = window.AcquisitionSourcePresentation && window.AcquisitionSourcePresentation.acquisitionSourcePresentation(metric);
    if (acquisition) {
      var acquisitionId = metric.metric_key || metric.key;
      metricInfoById[acquisitionId] = metric;
      return '<article class="dash-metric-card"><div class="dash-metric-card__top"><div class="dash-metric-card__title">'
        + escapeHtml(metric.title || metric.name || 'Acquisition sources') + '</div>'
        + '<button class="dash-metric-card__info" type="button" aria-label="Metric details" data-metric-info="'
        + escapeHtml(acquisitionId) + '">i</button></div>'
        + window.AcquisitionSourcePresentation.renderAcquisitionSource(acquisition) + '</article>';
    }
    var pipeline = window.CurrentPipelinePresentation && window.CurrentPipelinePresentation.currentPipelinePresentation(metric);
    if (pipeline) {
      var pipelineId = metric.metric_key || metric.key;
      metricInfoById[pipelineId] = metric;
      return '<article class="dash-metric-card"><div class="dash-metric-card__top"><div class="dash-metric-card__title">'
        + escapeHtml(metric.title || metric.name || 'Current pipeline') + '</div>'
        + '<button class="dash-metric-card__info" type="button" aria-label="Metric details" data-metric-info="'
        + escapeHtml(pipelineId) + '">i</button></div>'
        + window.CurrentPipelinePresentation.renderCurrentPipeline(pipeline) + '</article>';
    }
    var title = metric.title || metric.name || humanize(metric.metric_key) || 'Metric';
    var cardId = metric.metric_key || metric.key || title;
    metricInfoById[cardId] = metric;

    // A list value (rows of label + number) draws as columns, never "4 rows".
    if (Array.isArray(metric.value)) return renderListCard(metric, cardId, item);

    var value = formatMetricCardValue(metric);
    var progress = window.MetricCardView.goalProgress(metric.goal);
    if (progress && progress.available) return renderGoalCard(metric, cardId, progress, value, item);

    var countUp = animateNextRender
      ? ' data-count-up="' + escapeHtml(value) + '"' + (previousValues[cardId] ? ' data-count-from="' + escapeHtml(previousValues[cardId]) + '"' : '')
      : '';
    previousValues[cardId] = value;
    return '<article class="' + cardClass('dash-metric-card--kpi', item) + '">'
      + cardTop(metric, cardId, true)
      + '<div class="dash-metric-card__result">'
      + '<div class="dash-metric-card__value"' + countUp + '>' + escapeHtml(value) + '</div>'
      + deltaHtml(metric)
      + periodLine(metric)
      + '</div>'
      + '<div class="mini-spark-slot" data-sparkline-key="' + escapeHtml(cardId) + '"></div>'
      + renderGoal(metric.goal, progress)
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

    var arrow = window.MetricCardView ? window.MetricCardView.comparisonArrow(comparison) : null;
    var arrowHtml = arrow && arrow.direction !== 'flat'
      ? '<svg class="dash-metric-card__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + (arrow.direction === 'up' ? '<path d="M12 19V5M5 12l7-7 7 7"/>' : '<path d="M12 5v14M5 12l7 7 7-7"/>') + '</svg>'
      : '';
    var deltaHtml = deltaText
      ? '<span class="dash-metric-card__delta ' + dirClass + '"' + (arrow ? ' title="' + escapeHtml(arrow.spoken) + '"' : '') + '>'
        + arrowHtml + escapeHtml(sign + deltaText) + '</span>'
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
  // Null goal -> render nothing. A goal the server could not measure shows
  // a quiet note under the value instead (no ring, no band).
  function renderGoal(goal, progress) {
    if (progress && !progress.available) {
      return '<p class="dash-metric-card__goal-note">' + escapeHtml(progress.note) + '</p>';
    }
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
    var value = formatMetricCardValue(metric);
    var audience = firstValue(getMetricMeta(metric, 'audience'), getMetricMeta(metric, 'primary_audience'), getMetricMeta(metric, 'primaryAudience'));
    var section = firstValue(metric.section, metric.group, metric.domain_group);
    // Only a tile that belongs to a report opens one (report_link from the backend).
    var reportLink = metric.report_link || null;
    var metricHref = buildMetricDetailHref(metric.metric_key || metric.key || '');
    var periodLabel = metric.period || metric.period_label || currentPeriod.label || 'Current period';

    // Humanize metadata fields. They arrive as snake_case identifiers from
    // the registry (e.g. `legal_operations`, `department_legal_family_law`),
    // and we never want raw keys in the UI. Metric Key is intentionally left
    // raw because that field's purpose is to show the canonical identifier.
    return ''
      + '<div class="dash-metric-modal__value">' + escapeHtml(value) + '</div>'
      + window.DataState.render(metric)
      + '<div class="dash-metric-modal__grid">'
      + detailRow('Audience', humanize(audience))
      + detailRow('Section', humanize(section))
      + detailRow('Domain', humanize(metric.domain || metric.domain_group))
      + detailRow('Period', periodLabel)
      + detailRow('Metric Key', metric.metric_key)
      + '</div>'
      + detailBlock('Description', metric.description || 'Cataloged metric definition.')
      + detailBlock('Calculation', definition.calculation || 'Defined in metric catalog')
      + detailBlock('Business Logic', definition.businessLogic)
      + detailBlock('Entities', definition.entities)
      + detailBlock('Criteria', definition.criteria)
      + detailBlock('Dimensions', definition.dimensions)
      + '<div class="dash-metric-modal__footer">'
      + '<button class="dash-metric-card__link" type="button" data-metric-detail-link="' + escapeHtml(metricHref) + '">Open metric detail</button>'
      + (reportLink ? '<button class="dash-metric-card__link" type="button" data-report-link="' + escapeHtml(reportLink.href) + '">' + escapeHtml(reportLink.label || 'Open full report') + '</button>' : '')
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
    // an identifier like `legal_firm.family_law.upcoming_custody_hearings`.
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

  function renderSkeleton() {
    function tile(role) {
      return '<div class="dash-metric-card dash-metric-card--skeleton dash-bento__item dash-bento__item--' + role + '" aria-hidden="true">'
        + '<span class="dash-skeleton dash-skeleton--eyebrow"></span>'
        + '<span class="dash-skeleton dash-skeleton--title"></span>'
        + '<span class="dash-skeleton dash-skeleton--value"></span>'
        + '<span class="dash-skeleton dash-skeleton--line"></span>'
        + '</div>';
    }
    return ['hero', 'kpi', 'kpi', 'kpi', 'kpi', 'chart', 'chart'].map(tile).join('')
      + '<span class="dash-sr-only" role="status">Loading your numbers</span>';
  }

  function renderMetrics(metrics, summary, type) {
    var grid = el('dashboardMetricGrid');
    var empty = el('dashboardMetricEmpty');
    if (!grid) return;

    var dashboardType = type || getCurrentType();
    setPeriodLoading(cardLoads.isLoading());
    if (cardLoads.isLoading()) {
      // Never "No metrics" while a request is out: keep the cards on screen
      // (dimmed by the refreshing class), or show skeleton tiles the first time.
      if (empty) empty.hidden = true;
      if (!grid.querySelector || !grid.querySelector('.dash-metric-card')) grid.innerHTML = renderSkeleton();
      return;
    }

    if (cardLoads.state === 'error') {
      if (empty) empty.hidden = true;
      grid.innerHTML = '<div class="dash-load-error">' + window.DataState.render({
        data_state: 'engine_error', data_state_reason: 'The numbers could not be loaded. Pick the dates again to retry.',
      }, { calm: true }) + '</div>';
      return;
    }

    var allGroups = groupMetrics(allDashboardMetrics, dashboardType);
    var filteredMetrics = filterMetrics(metrics, dashboardType);
    metricInfoById = {};
    renderViewContext(dashboardType, allDashboardMetrics, allGroups);
    renderTypeFilters(allGroups);

    if (!filteredMetrics.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    tileIndex = 0;
    var unfiltered = activeTypeFilter === 'all' && !getActiveSearchQuery();
    declaredIndex = window.DashboardCards.indexMetrics(allDashboardMetrics);
    if (currentDeclaredCards && unfiltered) {
      // The saved dashboard's own cards, in its order (dashboard-cards.js).
      var plan = window.DashboardCards.planDeclared(window.DashboardCards.resolveCards(currentDeclaredCards, declaredIndex));
      grid.innerHTML = plan.items.map(renderDeclaredCard).join('')
        + renderWaitingStrip(plan.waiting.map(renderDeclaredWaitingCard));
    } else {
      // Bento grid: hero band, wide charts, then supporting cards
      // (js/shared/dashboard-layout.js owns the order and sizes); waiting
      // cards collect in one strip at the bottom.
      var split = window.DashboardCards.splitWaiting(filteredMetrics);
      grid.innerHTML = window.DashboardLayout.buildLayout(split.shown).map(function (item) {
        return renderMetricCard(item.card, item);
      }).join('') + renderWaitingStrip(split.waiting.map(function (metric) { return renderMetricCard(metric); }));
    }
    if (animateNextRender && grid.querySelectorAll) {
      Array.prototype.forEach.call(grid.querySelectorAll('[data-count-up]'), function (node) {
        window.MiniCharts.countUp(node, node.getAttribute('data-count-up'), { from: node.getAttribute('data-count-from') });
      });
    }
    animateNextRender = false;
    queueSparklines(grid);
    queueWorklists(grid);
  }

  // ── Sparklines ───────────────────────────────────────────────
  // Drawn from the metric's stored history (metric detail snapshots), after
  // the tiles are on screen: at most three requests at a time, one result
  // kept per metric and dates, and a failed or short history just leaves
  // the space empty.
  var SPARKLINE_CONCURRENCY = 3;
  var sparklineCache = {};
  var sparklineQueue = [];
  var sparklineActive = 0;

  function sparklineCacheKey(metricKey) {
    return [metricKey, currentPeriod.start, currentPeriod.end, currentPeriod.compareBy].join('|');
  }

  function paintSparkline(slot, line) {
    slot.classList.remove('mini-spark-slot--loading');
    slot.innerHTML = window.MiniCharts.sparklineSvg(line);
  }

  var sparklineObserver = null;

  function enqueueSparkline(slot) {
    var metricKey = slot.getAttribute('data-sparkline-key');
    sparklineQueue.push({ slot: slot, metricKey: metricKey, cacheKey: sparklineCacheKey(metricKey) });
    pumpSparklines();
  }

  // Only tiles that scroll into view ask for their history.
  function queueSparklines(grid) {
    if (!grid.querySelectorAll || !window.api || typeof api.getMetricDetail !== 'function') return;
    sparklineQueue = [];
    if (sparklineObserver) sparklineObserver.disconnect();
    sparklineObserver = typeof window.IntersectionObserver === 'function'
      ? new window.IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          enqueueSparkline(entry.target);
        });
      }, { rootMargin: '200px 0px' })
      : null;
    Array.prototype.forEach.call(grid.querySelectorAll('[data-sparkline-key]'), function (slot) {
      var cached = sparklineCache[sparklineCacheKey(slot.getAttribute('data-sparkline-key'))];
      if (cached && cached.done) {
        paintSparkline(slot, cached.line);
        return;
      }
      slot.classList.add('mini-spark-slot--loading');
      if (sparklineObserver) sparklineObserver.observe(slot);
      else enqueueSparkline(slot);
    });
  }

  function pumpSparklines() {
    while (sparklineActive < SPARKLINE_CONCURRENCY && sparklineQueue.length) {
      runSparkline(sparklineQueue.shift());
    }
  }

  function fetchSparkline(job) {
    var cached = sparklineCache[job.cacheKey];
    if (cached) return cached.promise;
    var period = currentPeriod;
    var entry = { done: false, line: null };
    // History only: raw_limit=0 skips the source rows the sparkline never shows.
    entry.promise = api.getMetricDetail(job.metricKey, {
      periodStart: period.start, periodEnd: period.end, compareBy: period.compareBy, rawLimit: 0,
    }).then(function (response) {
      var payload = response && response.data ? response.data : response;
      entry.line = window.MetricCardView.sparkline(payload && payload.snapshots, 100, 24);
    }).catch(function () {
      entry.line = null;
    }).then(function () {
      entry.done = true;
      return entry.line;
    });
    sparklineCache[job.cacheKey] = entry;
    return entry.promise;
  }

  function runSparkline(job) {
    sparklineActive += 1;
    fetchSparkline(job).then(function (line) {
      sparklineActive -= 1;
      // A redraw may have replaced this slot; the new one reads the cache.
      if (job.slot.isConnected !== false) paintSparkline(job.slot, line);
      pumpSparklines();
    });
  }

  function setFallbackNote(show) {
    var note = el('dashboardFallbackNote');
    if (!note) return;
    note.innerHTML = show
      ? 'This saved dashboard could not be opened right now, so these are the standard cards for its type. Change the dates to try again.'
      : '';
    note.hidden = !show;
  }

  async function loadMetrics(type) {
    var myLoad = cardLoads.begin();
    currentDeclaredCards = null;
    var config = VIEW_CONFIG[type];
    var banner = el('dashboardDetailBanner');
    if (banner) banner.classList.add('detail-banner--no-actions');
    currentDashboardId = null;
    currentDashboardName = '';
    currentDashboardMetricKeys = null;
    currentDashboardType = type;
    activeTypeFilter = 'all';
    activeSearchQuery = '';
    lastSearchInputValue = '';
    setBanner(config);
    loadDashboardSwitcher();
    setActiveType(type);
    var search = el('dashboardMetricSearch');
    if (search) search.value = '';
    renderMetrics([], null, type);

    try {
      var response = await api.getDashboardMetricCards(getMetricCardRequestParams(type, 250));
      if (!cardLoads.isLatest(myLoad)) return;
      var normalized = normalizeCardResponse(response);
      cardLoads.finish(myLoad, normalized.metrics.length);
      animateNextRender = true;
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
      if (!cardLoads.fail(myLoad)) return;
      console.error('[DashboardDetail] Failed to load metrics:', err);
      allDashboardMetrics = [];
      currentSummary = null;
      renderMetrics([], null, type);
    }
  }

  async function loadDashboardById(id) {
    var myLoad = cardLoads.begin();
    currentDashboardId = id;
    currentDashboardName = '';
    currentDashboardMetricKeys = null;
    activeTypeFilter = 'all';
    activeSearchQuery = '';
    lastSearchInputValue = '';
    renderMetrics([], null, currentDashboardType);

    var dashboardResponse;
    try {
      dashboardResponse = await api.getBIDashboard(id);
    } catch (definitionErr) {
      if (!cardLoads.isLatest(myLoad)) return;
      // The saved dashboard could not be read (a permission check or a
      // server blip): show the standard cards for its type in the same bento,
      // say so, and try the saved dashboard again on the next date change.
      console.warn('[DashboardDetail] Could not read the saved dashboard:', definitionErr && definitionErr.message);
      setFallbackNote(true);
      await loadMetrics(currentDashboardType || 'owner');
      currentDashboardId = id;
      return;
    }
    setFallbackNote(false);

    try {
      if (!cardLoads.isLatest(myLoad)) return;
      var dashboard = dashboardResponse && dashboardResponse.data ? dashboardResponse.data : dashboardResponse;
      currentDashboardName = dashboard && dashboard.name ? dashboard.name : '';
      loadDashboardSwitcher();
      var banner = el('dashboardDetailBanner');
      if (banner) banner.classList.remove('detail-banner--no-actions');
      var layout = dashboard && dashboard.layout ? dashboard.layout : {};
      var type = VIEW_CONFIG[layout.dashboard_type] ? layout.dashboard_type : 'owner';
      // Declared cards (layout.cards) when the saved dashboard has them,
      // otherwise its metric_keys as before.
      var declared = window.DashboardCards.normalizeLayout(layout);
      currentDeclaredCards = declared.mode === 'cards' ? declared.cards : null;
      var metricKeys = window.DashboardCards.requestKeys(layout);
      currentDashboardMetricKeys = new Set(metricKeys.concat(metricKeys.map(function (key) { return key.split('.').pop(); })));
      currentDashboardType = type;
      setBannerForDashboard(dashboard);
      setActiveDashboardBreadcrumb(dashboard);
      renderMetrics([], null, type);

      // A dashboard with its own tiles reads exactly those catalog keys.
      var cardParams = getMetricCardRequestParams(type, 500);
      var tileKeys = DashboardTiles.cardRequestKeys(layout);
      if (tileKeys) cardParams.metric_keys = tileKeys;
      var metricResponse = await api.getDashboardMetricCards(cardParams);
      if (!cardLoads.isLatest(myLoad)) return;
      var normalized = normalizeCardResponse(metricResponse);
      allDashboardMetrics = normalized.metrics.filter(function (metric) {
        if (currentDashboardMetricKeys.size === 0) return true;
        var key = metric.metric_key || metric.key;
        var shortKey = String(key || '').split('.').pop();
        return currentDashboardMetricKeys.has(key) || currentDashboardMetricKeys.has(shortKey);
      });
      cardLoads.finish(myLoad, allDashboardMetrics.length);
      animateNextRender = true;
      currentSummary = null;
      renderMetrics(allDashboardMetrics, currentSummary, type);
    } catch (err) {
      if (!cardLoads.fail(myLoad)) return;
      console.error('[DashboardDetail] Failed to load dashboard:', err);
      allDashboardMetrics = [];
      currentSummary = null;
      renderMetrics([], null, currentDashboardType);
    }
  }

  async function deleteCurrentDashboard() {
    if (!currentDashboardId) return;
    var confirmed = await Lex.Modal.confirmAsync('Delete dashboard', 'Delete "' + (currentDashboardName || 'this dashboard') + '"?', {
      variant: 'danger',
      confirmText: 'Delete'
    });
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

  // Returns the default preset's promise: the first card load waits for it.
  function initPeriodControls() {
    var initialPeriod = selectDashboardPeriodPreset('last7days', false);

    var presets = el('dashboardPeriodPresets');
    if (presets) {
      presets.addEventListener('click', function (event) {
        var btn = event.target.closest('lex-btn[data-dashboard-preset]');
        if (!btn) return;
        setPeriodPanelOpen(false);
        selectDashboardPeriodPreset(btn.getAttribute('data-dashboard-preset'), true);
      });
    }

    function handlePeriodChange() {
      var start = el('dashboardPeriodStart');
      var end = el('dashboardPeriodEnd');
      // A manual edit to the start/end inputs is a custom range, not a preset.
      periodPickToken += 1;
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
    initPeriodPanel();
    return initialPeriod;
  }

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Admin gate: dashboard detail loads firm-wide metrics, admin-only.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    var initialPeriod = initPeriodControls();

    content.addEventListener('click', function (event) {
      if (event.target.closest('#openReportingBtn')) {
        Lex.Nav.go('admin/reports-list.html');
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
        Lex.Nav.go(reportBtn.getAttribute('data-report-link'));
      }

      var variantBtn = event.target.closest('[data-dashboard-variant]');
      if (variantBtn) {
        var pick = variantBtn.getAttribute('data-dashboard-variant').split('|');
        variantPicks[pick[0]] = Number(pick[1]);
        renderMetrics(allDashboardMetrics, currentSummary, currentDashboardType);
        return;
      }

      var stateAction = event.target.closest('[data-data-state-action]');
      if (stateAction) {
        Lex.Nav.go(stateAction.getAttribute('data-data-state-action'));
        return;
      }

      var metricDetailBtn = event.target.closest('[data-metric-detail-link]');
      if (metricDetailBtn) {
        Lex.Nav.go(metricDetailBtn.getAttribute('data-metric-detail-link'));
      }

      var infoBtn = event.target.closest('[data-metric-info]');
      if (infoBtn) {
        openMetricModal(infoBtn.getAttribute('data-metric-info'));
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

    var typeSelect = el('dashboardTypeSelect');
    if (typeSelect) {
      typeSelect.addEventListener('lex-change', function (event) {
        var value = (event.detail && event.detail.value) || 'all';
        if (value === activeTypeFilter) return;
        activeTypeFilter = value;
        renderMetrics(allDashboardMetrics, currentSummary, currentDashboardType);
      });
    }

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
    initialPeriod.then(function () {
      if (id) loadDashboardById(id);
      else loadMetrics(getCurrentType());
    });
  }

  init();
})();

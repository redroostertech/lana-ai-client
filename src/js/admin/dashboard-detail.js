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

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value == null ? '-' : String(value);
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
    var title = metric.title || metric.name || metric.metric_key || 'Metric';
    var value = metric.formatted_value || (metric.value === 0 ? '0' : null) || '--';
    var cardId = metric.metric_key || metric.key || title;
    var typeLabel = getGroupLabel(metric, currentDashboardType);
    metricInfoById[cardId] = metric;

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
      + '<div class="dash-metric-card__period">' + escapeHtml(metric.period || metric.period_label || 'Current period') + '</div>'
      + '</div>'
      + '</article>';
  }

  function renderModalDetails(metric) {
    var definition = getDefinition(metric);
    var status = metric.status || (metric.executable ? 'active' : 'planned');
    var value = metric.formatted_value || (metric.value === 0 ? '0' : null) || '--';
    var audience = firstValue(getMetricMeta(metric, 'audience'), getMetricMeta(metric, 'primary_audience'), getMetricMeta(metric, 'primaryAudience'));
    var section = firstValue(metric.section, metric.group, metric.domain_group);
    var reportHref = metric.report_link && metric.report_link.href || metric.reportHref || 'admin/reporting.html';
    var message = metric.message || (metric.executable ? '' : 'Calculation is planned but not executable yet');

    return ''
      + '<div class="dash-metric-modal__value">' + escapeHtml(value) + '</div>'
      + '<div class="dash-metric-modal__grid">'
      + detailRow('Status', status)
      + detailRow('Audience', audience)
      + detailRow('Section', section)
      + detailRow('Domain', metric.domain || metric.domain_group)
      + detailRow('Period', metric.period || metric.period_label || 'Current period')
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
    title.textContent = metric.title || metric.name || metric.metric_key || 'Metric';
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
    var config = VIEW_CONFIG[type];
    var actions = el('dashboardDetailActions');
    if (actions) actions.hidden = true;
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
    setActiveType(type);
    var search = el('dashboardMetricSearch');
    if (search) search.value = '';
    renderMetrics([], null, type);

    try {
      var response = await api.getDashboardMetricCards({ type: type, limit: 250 });
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
      console.error('[DashboardDetail] Failed to load metrics:', err);
      allDashboardMetrics = [];
      currentSummary = null;
      renderMetrics([], null, type);
    }
  }

  async function loadDashboardById(id) {
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
      var dashboard = dashboardResponse && dashboardResponse.data ? dashboardResponse.data : dashboardResponse;
      currentDashboardName = dashboard && dashboard.name ? dashboard.name : '';
      var actions = el('dashboardDetailActions');
      if (actions) actions.hidden = false;
      var layout = dashboard && dashboard.layout ? dashboard.layout : {};
      var type = VIEW_CONFIG[layout.dashboard_type] ? layout.dashboard_type : 'owner';
      var metricKeys = Array.isArray(layout.metric_keys) ? layout.metric_keys : [];
      currentDashboardMetricKeys = new Set(metricKeys);
      currentDashboardType = type;
      setBannerForDashboard(dashboard);
      setActiveDashboardBreadcrumb(dashboard);
      renderMetrics([], null, type);

      var metricResponse = await api.getDashboardMetricCards({ type: type, limit: 500 });
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
      console.error('[DashboardDetail] Failed to load dashboard:', err);
      allDashboardMetrics = [];
      currentSummary = null;
      renderMetrics([], null, currentDashboardType);
    }
  }

  function closeDashboardActions() {
    var panel = el('dashboardDetailActionsPanel');
    if (panel) panel.hidden = true;
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

  function init() {
    var content = el('lex-main-content');
    if (!content) return;

    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    content.addEventListener('click', function (event) {
      if (event.target.closest('#openReportingBtn')) {
        Lex.Nav.go('admin/reporting.html');
      }

      if (event.target.closest('#dashboardDetailActionsTrigger')) {
        var panel = el('dashboardDetailActionsPanel');
        if (panel) panel.hidden = !panel.hidden;
        return;
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
        closeDashboardActions();
      }
    });

    document.addEventListener('click', function (event) {
      if (!event.target.closest('#dashboardDetailActions')) closeDashboardActions();
    });

    var params = getParams();
    var id = params.get('id');
    if (id) loadDashboardById(id);
    else loadMetrics(getCurrentType());
  }

  init();
})();

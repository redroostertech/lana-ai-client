/* Dashboard Builder - create/edit dashboard definitions from metric catalog cards. */

(function () {
  'use strict';

  var metrics = [];
  var selected = new Set();
  var shares = [];
  var existingShares = [];
  var activeType = 'all';
  var dashboardId = null;
  var loadedDashboard = null;

  function el(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return value.label || value.name || value.title || value.key || value.id || '';
    return String(value);
  }

  function humanize(value) {
    return text(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function getParams() {
    return window.Lex && Lex.Nav && Lex.Nav.getParams ? Lex.Nav.getParams() : new URLSearchParams(window.location.search || '');
  }

  function metricGroup(metric) {
    return metric.section || metric.group || metric.domain || 'general';
  }

  function metricGroupKey(metric) {
    return text(metricGroup(metric)).toLowerCase();
  }

  function metricGroupLabel(metric) {
    return humanize(metricGroup(metric));
  }

  function normalizeMetricResponse(response) {
    if (response && Array.isArray(response.data)) return response.data;
    if (response && response.data && Array.isArray(response.data.metrics)) return response.data.metrics;
    if (response && Array.isArray(response.metrics)) return response.metrics;
    return [];
  }

  function groups() {
    var map = new Map();
    metrics.forEach(function (metric) {
      var key = metricGroupKey(metric);
      if (!map.has(key)) map.set(key, { key: key, label: metricGroupLabel(metric), count: 0 });
      map.get(key).count += 1;
    });
    return Array.from(map.values()).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  function searchQuery() {
    var input = el('dashboardBuilderMetricSearch');
    return String(input && input.value || '').trim().toLowerCase();
  }

  function metricMatches(metric, query) {
    if (!query) return true;
    var haystack = [
      metric.title,
      metric.name,
      metric.key,
      metric.metric_key,
      metric.description,
      metric.domain,
      metric.primaryAudience,
      metricGroupLabel(metric),
    ].map(text).join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function filteredMetrics() {
    var query = searchQuery();
    return metrics.filter(function (metric) {
      if (activeType !== 'all' && metricGroupKey(metric) !== activeType) return false;
      return metricMatches(metric, query);
    });
  }

  function renderFilters() {
    var container = el('dashboardBuilderTypeFilters');
    if (!container) return;
    var buttons = [
      '<button class="dash-browser__filter' + (activeType === 'all' ? ' is-active' : '') + '" type="button" data-builder-type="all"><span>All Types</span><strong>' + metrics.length + '</strong></button>'
    ];
    groups().forEach(function (group) {
      buttons.push(
        '<button class="dash-browser__filter' + (activeType === group.key ? ' is-active' : '') + '" type="button" data-builder-type="' + escapeHtml(group.key) + '"><span>' + escapeHtml(group.label) + '</span><strong>' + group.count + '</strong></button>'
      );
    });
    container.innerHTML = buttons.join('');
  }

  function renderSelectedCount() {
    var node = el('dashboardBuilderSelectedCount');
    if (node) node.textContent = selected.size + (selected.size === 1 ? ' selected' : ' selected');
    updateWizardState();
  }

  function renderMetrics() {
    var grid = el('dashboardBuilderMetricGrid');
    var empty = el('dashboardBuilderEmpty');
    if (!grid) return;
    var rows = filteredMetrics();
    renderFilters();
    renderSelectedCount();

    if (!rows.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    if (empty) empty.hidden = true;
    grid.innerHTML = rows.map(function (metric) {
      var key = metric.key || metric.metric_key;
      var checked = selected.has(key);
      return ''
        + '<article class="dash-builder-metric' + (checked ? ' is-selected' : '') + '" data-builder-metric="' + escapeHtml(key) + '">'
        + '<div class="dash-builder-metric__top">'
        + '<div class="dash-metric-card__eyebrow">' + escapeHtml(humanize(metric.domain || 'Metric')) + '</div>'
        + '<input type="checkbox" ' + (checked ? 'checked' : '') + ' aria-label="Select metric">'
        + '</div>'
        + '<div class="dash-metric-card__title">' + escapeHtml(metric.title || metric.name || key) + '</div>'
        + '<p class="dash-builder-metric__desc">' + escapeHtml(metric.description || '') + '</p>'
        + '<div class="dash-builder-metric__meta">' + escapeHtml(metricGroupLabel(metric)) + '</div>'
        + '</article>';
    }).join('');
  }

  function setFormFromDashboard(dashboard) {
    var layout = dashboard.layout || {};
    el('dashboardBuilderName').value = dashboard.name || '';
    el('dashboardBuilderDescription').value = dashboard.description || '';
    el('dashboardBuilderType').value = layout.dashboard_type || 'owner';
    selected = new Set(Array.isArray(layout.metric_keys) ? layout.metric_keys : []);
  }

  function normalizeShareRows(response) {
    if (response && Array.isArray(response.shares)) return response.shares;
    if (response && response.data && Array.isArray(response.data.shares)) return response.data.shares;
    if (response && Array.isArray(response.data)) return response.data;
    return [];
  }

  function shareLabel(row) {
    return row.shared_with_name ||
      row.shared_with_email ||
      row.shared_with_role_display_name ||
      row.shared_with_role_name ||
      row.shared_with_id;
  }

  function shareToken(type, id) {
    return String(type || '') + ':' + String(id || '');
  }

  function desiredSharesForVisibility(savedDashboardId) {
    var visibility = el('dashboardBuilderVisibility').value || 'private';
    var user = window.api && window.api.user || {};
    var organizationId = user.organization_id || user.organizationId;
    if (visibility === 'organization' && organizationId) {
      return [{
        resource_type: 'dashboard',
        resource_id: savedDashboardId,
        shared_with_type: 'organization',
        shared_with_id: organizationId,
        permissions: ['read'],
      }];
    }
    if (visibility === 'custom') {
      return shares.map(function (share) {
        return {
          resource_type: 'dashboard',
          resource_id: savedDashboardId,
          shared_with_type: share.type,
          shared_with_id: share.id,
          permissions: ['read'],
        };
      });
    }
    return [];
  }

  function selectedMetricKeys() {
    return Array.from(selected.values());
  }

  function detailsComplete() {
    var name = el('dashboardBuilderName');
    return Boolean(name && name.value.trim());
  }

  function visibilityComplete() {
    var visibility = el('dashboardBuilderVisibility');
    var value = visibility && visibility.value || 'private';
    return value !== 'custom' || shares.length > 0;
  }

  function setStepState(step, state, label) {
    var panel = document.querySelector('[data-builder-step="' + step + '"]');
    var indicator = document.querySelector('[data-builder-step-indicator="' + step + '"]');
    var stateNode = document.querySelector('[data-builder-step-state="' + step + '"]');
    var disabled = state === 'locked';

    if (panel) panel.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    if (indicator) {
      indicator.classList.toggle('is-active', state === 'active');
      indicator.classList.toggle('is-complete', state === 'complete');
    }
    if (stateNode) {
      stateNode.textContent = label;
      stateNode.classList.toggle('is-active', state === 'active');
      stateNode.classList.toggle('is-complete', state === 'complete');
    }
  }

  function updateWizardState() {
    var detailsReady = detailsComplete();
    var accessReady = detailsReady && visibilityComplete();
    var save = el('dashboardBuilderSave');

    setStepState('details', detailsReady ? 'complete' : 'active', detailsReady ? 'Complete' : 'Required');
    setStepState('visibility', !detailsReady ? 'locked' : accessReady ? 'complete' : 'active', !detailsReady ? 'Locked' : accessReady ? 'Complete' : 'Required');
    setStepState('metrics', !accessReady ? 'locked' : selected.size > 0 ? 'complete' : 'active', !accessReady ? 'Locked' : selected.size > 0 ? 'Complete' : 'Choose cards');

    if (save) save.disabled = !(detailsReady && accessReady && selected.size > 0);
  }

  function buildPayload() {
    var name = el('dashboardBuilderName').value.trim();
    var description = el('dashboardBuilderDescription').value.trim();
    var type = el('dashboardBuilderType').value || 'owner';
    if (!name) throw new Error('Dashboard name is required');
    if (selected.size === 0) throw new Error('Select at least one metric');

    return {
      name: name,
      description: description,
      layout: {
        dashboard_type: type,
        metric_keys: selectedMetricKeys(),
        source: 'metric_catalog',
      },
      filters: {},
      is_default: false,
    };
  }

  // Client-side mitigation for non-atomic share sync. Grants are issued
  // BEFORE revokes so a switch from organization → custom can't strand
  // recipients with no access if a grant fails. Partial failures are
  // surfaced to the user instead of silently committing a half-synced
  // state. The proper fix is a server-side atomic replace endpoint;
  // until then this narrows the window where users get locked out.
  async function syncVisibility(savedDashboardId) {
    var desired = desiredSharesForVisibility(savedDashboardId);
    var desiredTokens = new Set(desired.map(function (share) {
      return shareToken(share.shared_with_type, share.shared_with_id);
    }));
    var existingTokens = new Set(existingShares.map(function (share) {
      return shareToken(share.shared_with_type, share.shared_with_id);
    }));

    // 1. Grant first so incoming recipients are live before any revoke.
    var grantInputs = desired.filter(function (share) {
      return !existingTokens.has(shareToken(share.shared_with_type, share.shared_with_id));
    });
    var grantResults = await Promise.allSettled(grantInputs.map(function (share) {
      return api.grantResourceShare(share);
    }));

    var grantApplied = [];
    var grantFailed = [];
    grantResults.forEach(function (r, i) {
      var input = grantInputs[i];
      if (r.status === 'fulfilled') grantApplied.push(input);
      else grantFailed.push({ recipient: input, error: r.reason && r.reason.message });
    });

    // 2. Revoke only after grants resolved. If any grant failed, skip
    //    revokes that would shrink access and surface the partial state.
    var revokeInputs = [];
    var revokeResults = [];
    if (grantFailed.length === 0) {
      revokeInputs = existingShares.filter(function (existing) {
        return !desiredTokens.has(shareToken(existing.shared_with_type, existing.shared_with_id));
      });
      revokeResults = await Promise.allSettled(revokeInputs.map(function (existing) {
        return api.revokeResourceShare({
          resource_type: 'dashboard',
          resource_id: savedDashboardId,
          shared_with_type: existing.shared_with_type,
          shared_with_id: existing.shared_with_id,
        });
      }));
    }

    var revokeApplied = [];
    var revokeFailed = [];
    revokeResults.forEach(function (r, i) {
      var input = revokeInputs[i];
      if (r.status === 'fulfilled') revokeApplied.push(input);
      else revokeFailed.push({ recipient: input, error: r.reason && r.reason.message });
    });

    function labelFor(share) {
      return share && (share.shared_with_label || share.shared_with_email || share.shared_with_name || share.shared_with_id) || 'unknown recipient';
    }

    if (grantFailed.length > 0 || revokeFailed.length > 0) {
      var lines = ['Dashboard saved, but share sync partially failed:'];
      if (grantApplied.length > 0) {
        lines.push('Granted: ' + grantApplied.map(labelFor).join(', '));
      }
      if (grantFailed.length > 0) {
        lines.push('Grant failed: ' + grantFailed.map(function (f) { return labelFor(f.recipient); }).join(', '));
        lines.push('Old access was preserved to avoid locking anyone out.');
      }
      if (revokeApplied.length > 0) {
        lines.push('Revoked: ' + revokeApplied.map(labelFor).join(', '));
      }
      if (revokeFailed.length > 0) {
        lines.push('Revoke failed: ' + revokeFailed.map(function (f) { return labelFor(f.recipient); }).join(', '));
      }
      var error = new Error(lines.join(' '));
      error.partialShareSync = true;
      error.shareSyncDetail = { grantApplied: grantApplied, grantFailed: grantFailed, revokeApplied: revokeApplied, revokeFailed: revokeFailed };
      throw error;
    }

    existingShares = desired.map(function (share) {
      return {
        shared_with_type: share.shared_with_type,
        shared_with_id: share.shared_with_id,
        permissions: share.permissions,
      };
    });
  }

  async function saveDashboard() {
    try {
      var payload = buildPayload();
      var response = dashboardId
        ? await api.updateBIDashboard(dashboardId, payload)
        : await api.createBIDashboard(payload);
      var dashboard = response && response.data ? response.data : response;
      dashboardId = dashboard.id || dashboardId;
      await syncVisibility(dashboardId);
      if (window.Lex && Lex.Toast) Lex.Toast.success('Dashboard saved');
      Lex.Nav.go('admin/dashboard-detail.html?id=' + encodeURIComponent(dashboardId));
    } catch (err) {
      if (window.Lex && Lex.Toast) Lex.Toast.error(err.message || 'Could not save dashboard');
      else console.error(err);
    }
  }

  function renderShareList() {
    var list = el('dashboardBuilderShareList');
    if (!list) return;
    if (!shares.length) {
      list.innerHTML = '<div class="dash-builder__muted">No custom recipients selected.</div>';
      return;
    }
    list.innerHTML = shares.map(function (share) {
      return '<button class="dash-builder__share-chip" type="button" data-remove-share="' + escapeHtml(share.type + ':' + share.id) + '">' + escapeHtml(share.label) + '<span>&times;</span></button>';
    }).join('');
  }

  function updateVisibilityMode() {
    var wrap = el('dashboardBuilderShareSearchWrap');
    if (wrap) wrap.hidden = el('dashboardBuilderVisibility').value !== 'custom';
    renderShareList();
  }

  async function searchShareRecipients() {
    var input = el('dashboardBuilderShareSearch');
    var results = el('dashboardBuilderShareResults');
    if (!input || !results) return;
    var query = input.value.trim();
    if (!query) {
      results.innerHTML = '';
      return;
    }
    try {
      var response = await api.searchMentions({ q: query, limit: 12 });
      var matches = response && Array.isArray(response.matches) ? response.matches : [];
      var groupRows = response && Array.isArray(response.groups) ? response.groups.map(function (group) {
        return { kind: 'group', id: group.id, label: group.name || group.label || 'Group' };
      }) : [];
      results.innerHTML = matches.concat(groupRows).map(function (item) {
        var type = item.kind === 'group' ? 'group' : 'user';
        return '<button type="button" data-add-share-type="' + escapeHtml(type) + '" data-add-share-id="' + escapeHtml(item.id) + '" data-add-share-label="' + escapeHtml(item.label || item.email || item.id) + '">' + escapeHtml(item.label || item.email || item.id) + '</button>';
      }).join('');
    } catch (err) {
      results.innerHTML = '<div class="dash-builder__muted">Unable to search recipients.</div>';
    }
  }

  async function loadDashboard(id) {
    if (!id) return;
    var response = await api.getBIDashboard(id);
    loadedDashboard = response && response.data ? response.data : response;
    setFormFromDashboard(loadedDashboard);
    var sharesResponse = await api.listResourceShares('dashboard', id, { limit: 100 });
    existingShares = normalizeShareRows(sharesResponse);
    var orgShare = existingShares.find(function (share) { return share.shared_with_type === 'organization'; });
    var customShares = existingShares.filter(function (share) { return share.shared_with_type !== 'organization'; });
    if (orgShare) {
      el('dashboardBuilderVisibility').value = 'organization';
      shares = [];
    } else if (customShares.length) {
      el('dashboardBuilderVisibility').value = 'custom';
      shares = customShares.map(function (share) {
        return {
          type: share.shared_with_type,
          id: share.shared_with_id,
          label: shareLabel(share),
        };
      });
    } else {
      el('dashboardBuilderVisibility').value = 'private';
      shares = [];
    }
  }

  async function loadMetrics() {
    var type = el('dashboardBuilderType') && el('dashboardBuilderType').value || 'owner';
    var response = await api.getDashboardMetricCards({ type: type, limit: 500 });
    metrics = normalizeMetricResponse(response);
    renderMetrics();
  }

  async function init() {
    var content = el('lex-main-content');
    if (!content) return;

    // Admin gate: dashboard builder creates/updates/deletes shared dashboards
    // and is admin-only. Backend should also reject, but defense-in-depth on
    // the renderer matches the rest of the admin pages.
    if (Lex.Auth && !Lex.Auth.isAdmin()) {
      Lex.Nav.go('dashboard.html', { replace: true });
      return;
    }

    var params = getParams();
    dashboardId = params.get('id');
    var breadcrumb = el('dashboardBuilderBreadcrumb');
    if (breadcrumb) {
      breadcrumb.items = [
        { label: 'Dashboard', href: 'admin/analytics.html' },
        { label: 'Library', href: 'admin/dashboard-library.html' },
        { label: dashboardId ? 'Edit Dashboard' : 'Create Dashboard' },
      ];
    }

    content.addEventListener('click', function (event) {
      var metricCard = event.target.closest('[data-builder-metric]');
      if (metricCard) {
        var key = metricCard.getAttribute('data-builder-metric');
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        renderMetrics();
      }

      var filter = event.target.closest('[data-builder-type]');
      if (filter) {
        activeType = filter.getAttribute('data-builder-type') || 'all';
        renderMetrics();
      }

      var addShare = event.target.closest('[data-add-share-id]');
      if (addShare) {
        var share = {
          type: addShare.getAttribute('data-add-share-type'),
          id: addShare.getAttribute('data-add-share-id'),
          label: addShare.getAttribute('data-add-share-label'),
        };
        if (!shares.some(function (item) { return item.type === share.type && item.id === share.id; })) {
          shares.push(share);
        }
        renderShareList();
        updateWizardState();
      }

      var removeShare = event.target.closest('[data-remove-share]');
      if (removeShare) {
        var token = removeShare.getAttribute('data-remove-share');
        shares = shares.filter(function (item) { return item.type + ':' + item.id !== token; });
        renderShareList();
        updateWizardState();
      }

      if (event.target.closest('#dashboardBuilderClear')) {
        selected = new Set();
        renderMetrics();
      }

      if (event.target.closest('#dashboardBuilderSave')) {
        saveDashboard();
      }
    });

    el('dashboardBuilderMetricSearch').addEventListener('input', renderMetrics);
    el('dashboardBuilderName').addEventListener('input', updateWizardState);
    el('dashboardBuilderDescription').addEventListener('input', updateWizardState);
    el('dashboardBuilderType').addEventListener('change', function () {
      activeType = 'all';
      loadMetrics();
      updateWizardState();
    });
    el('dashboardBuilderVisibility').addEventListener('change', function () {
      updateVisibilityMode();
      updateWizardState();
    });
    el('dashboardBuilderShareSearch').addEventListener('input', searchShareRecipients);

    if (dashboardId) await loadDashboard(dashboardId);
    updateVisibilityMode();
    updateWizardState();
    await loadMetrics();
  }

  init();
})();

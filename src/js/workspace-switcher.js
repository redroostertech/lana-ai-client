/* Workspace switcher — replaces the static "Matter Details" topbar heading on
   workspace-details.html with a searchable lex-select listing workspaces and
   matters (Pinned / Recent groups), so users can jump between workspaces.
   Modeled on js/admin/admin-switcher.js and the data-driven variant in
   js/admin/dashboard-detail.js (renderDashboardSwitcher).

   Because workspace-details is an SPA route inside the persistent lex-app
   shell (unlike the standalone admin pages), the page must call
   WorkspaceSwitcher.restore() on leave to put the <h1> heading back. */
(function () {
  'use strict';

  var CACHE_TTL_MS = 60000;
  var _cache = null;
  var _cacheAt = 0;
  var _attempts = 0;

  function matterName(m) {
    return m.matter_name || m.name || m.title || m.matter_id;
  }

  function matterDescription(m) {
    if (m.client_name) return m.client_name;
    return m.matter_type === 'workspace' ? 'Workspace' : 'Matter';
  }

  function toOption(m, group) {
    return {
      value: m.matter_id,
      label: matterName(m),
      description: matterDescription(m),
      group: group
    };
  }

  async function loadOptions() {
    var now = LanaTime.nowMs();
    if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;

    var api = window.api;
    if (!api) return _cache || [];

    try {
      var results = await Promise.allSettled([
        api.getPinnedMatters(1, 100, { status: 'active' }),
        api.getMatters(1, 100, { status: 'active', sort_by: 'updated_at', sort_order: 'desc' })
      ]);
      var pinned = results[0].status === 'fulfilled' ? (results[0].value.matters || []) : [];
      var recent = results[1].status === 'fulfilled' ? (results[1].value.matters || []) : [];

      var seen = {};
      var options = [];
      pinned.forEach(function (m) {
        if (!m || !m.matter_id || seen[m.matter_id]) return;
        seen[m.matter_id] = true;
        options.push(toOption(m, 'Pinned'));
      });
      recent.forEach(function (m) {
        if (!m || !m.matter_id || seen[m.matter_id]) return;
        seen[m.matter_id] = true;
        options.push(toOption(m, 'Recent'));
      });

      if (options.length) {
        _cache = options;
        _cacheAt = now;
      }
      return options;
    } catch (error) {
      console.warn('[workspace-switcher] Failed to load matters:', error);
      return _cache || [];
    }
  }

  function mount() {
    var topbar = document.querySelector('lex-topbar');
    if (!topbar) return null;

    var existing = topbar.querySelector('#workspaceSwitcher');
    if (existing) return existing;

    var heading = topbar.querySelector('.lex-topbar-heading');
    if (!heading) return null;

    var wrapper = document.createElement('div');
    wrapper.className = 'workspace-switcher';
    wrapper.innerHTML = '<lex-select id="workspaceSwitcher" name="workspaceSwitcher" placeholder="Search workspaces..." searchable></lex-select>';
    heading.replaceWith(wrapper);
    return wrapper.querySelector('#workspaceSwitcher');
  }

  async function render(currentId) {
    if (!window.customElements || !customElements.get('lex-select')) return;

    var select = mount();
    if (!select) {
      // lex-app / lex-topbar upgrade asynchronously on first paint
      if (_attempts++ < 30) setTimeout(function () { render(currentId); }, 50);
      return;
    }
    _attempts = 0;

    var options = await loadOptions();

    // Ensure the current matter is selectable even when it falls outside the
    // first page of results.
    var current = window.currentMatterData && window.currentMatterData.matter;
    if (currentId && current && current.matter_id === currentId &&
        !options.some(function (o) { return o.value === currentId; })) {
      options = [toOption(current, 'Current')].concat(options);
    }

    select.options = options;
    if (currentId) select.value = currentId;

    if (!select._wsSwitcherBound) {
      select.addEventListener('lex-change', function (e) {
        var id = e.detail && e.detail.value;
        if (!id) return;
        var cur = window.currentMatterData && window.currentMatterData.matter;
        if (cur && cur.matter_id === id) return;
        if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
          window.Lex.Nav.go('workspace-details.html', {
            params: { id: id, tab: 'summary' },
            context: { matterId: id, tab: 'summary' }
          });
        } else {
          window.location.href = 'workspace-details.html?id=' + encodeURIComponent(id) + '&tab=summary';
        }
      });
      select._wsSwitcherBound = true;
    }
  }

  // Put the plain <h1> heading back so other SPA pages sharing the lex-app
  // shell keep their normal topbar title.
  function restore() {
    var topbar = document.querySelector('lex-topbar');
    if (!topbar) return;
    var wrapper = topbar.querySelector('.workspace-switcher');
    if (!wrapper) return;
    var h1 = document.createElement('h1');
    h1.className = 'lex-topbar-heading';
    h1.textContent = topbar.heading || '';
    wrapper.replaceWith(h1);
  }

  window.WorkspaceSwitcher = { render: render, restore: restore };
})();

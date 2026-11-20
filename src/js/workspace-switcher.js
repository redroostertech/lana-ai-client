/* Workspace switcher: the matter page's header title becomes a searchable
   list of workspaces and matters (Pinned / Recent groups), so users can jump
   between them. Drawn by the shared TitleSwitcher (js/shared/title-switcher.js,
   css/title-switcher.css), which also puts the plain title back when the app
   moves to another page. */
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

  function openMatter(id) {
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
      window.Lex.Nav.go('workspace-details.html', {
        params: { id: id, tab: 'summary' },
        context: { matterId: id, tab: 'summary' }
      });
    } else {
      window.location.href = 'workspace-details.html?id=' + encodeURIComponent(id) + '&tab=summary';
    }
  }

  async function render(currentId) {
    var ready = window.TitleSwitcher && window.customElements && customElements.get('lex-select') &&
      document.querySelector('lex-topbar .lex-topbar-heading, lex-topbar .title-switcher');
    if (!ready) {
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

    window.TitleSwitcher.render({
      id: 'workspaceSwitcher',
      placeholder: 'Search workspaces...',
      options: options,
      value: currentId || '',
      onPick: openMatter
    });
  }

  window.WorkspaceSwitcher = { render: render };
})();

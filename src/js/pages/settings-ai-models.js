/**
 * Settings > Capabilities > AI: the groups below the local AI engine.
 *
 *   Pip on this computer, Models on this computer   window.electronAPI.getAiTopology(), and the
 *                                                   server's own Pip when the server runs here
 *   Organization server, Forge, Prompt routing      GET /api/v1/system/ai (the server's own report
 *                                                   of its Pip, relay and routing), GET
 *                                                   /api/v1/system/version, the engine status
 *
 * The local AI engine's own rows stay in settings-local-engine.js. Wording comes from
 * settings-ai-models.model.js (window.LanaAiModels).
 */
(function () {
  'use strict';

  var M = window.LanaAiModels;
  var topology = null;
  var engine = null;
  var version = null;
  var serverAi = null;

  function el(id) {
    return document.getElementById(id);
  }

  function badgeRow(row) {
    var item = document.createElement('div');
    item.className = 'sv2-ai-row';
    item.setAttribute('role', 'listitem');
    var copy = document.createElement('div');
    copy.className = 'sv2-ai-row-copy';
    var name = document.createElement('span');
    name.className = 'sv2-ai-row-name';
    name.textContent = row.name;
    var detail = document.createElement('span');
    detail.className = 'sv2-ai-row-detail';
    detail.textContent = row.detail;
    copy.appendChild(name);
    copy.appendChild(detail);
    var badge = document.createElement('lex-badge');
    badge.setAttribute('label', row.badge);
    badge.setAttribute('color', row.tone);
    badge.setAttribute('size', 'sm');
    item.appendChild(copy);
    item.appendChild(badge);
    return item;
  }

  function fill(id, nodes) {
    var box = el(id);
    if (!box) return;
    box.innerHTML = '';
    nodes.forEach(function (node) { box.appendChild(node); });
  }

  function kvRows(rows) {
    return rows.map(function (row) {
      var kv = document.createElement('lex-kv');
      kv.setAttribute('label', row.label);
      kv.setAttribute('value', row.value);
      kv.setAttribute('direction', 'horizontal');
      return kv;
    });
  }

  function show(id, visible) {
    var node = el(id);
    if (node) node.hidden = !visible;
  }

  function render() {
    if (!topology) return;
    el('sv2-ai-pip-pinned').textContent = M.pinnedLine(topology);
    fill('sv2-ai-pip-rows', M.pipRows(topology, serverAi).map(badgeRow));
    var models = M.modelRows(topology);
    fill('sv2-ai-models-rows', models.map(badgeRow));
    fill('sv2-ai-server-rows', kvRows(M.serverRows(topology, version, serverAi)));
    fill('sv2-ai-forge-rows', kvRows(M.forgeRows(topology, serverAi)));
    fill('sv2-ai-routing-lines', M.routing(engine, topology, serverAi).map(function (line) {
      var p = document.createElement('p');
      p.className = 'sv2-local-engine-option-description';
      p.textContent = line;
      return p;
    }));
    show('sv2-ai-pip', true);
    show('sv2-ai-models', models.length > 0);
    show('sv2-ai-server', true);
    show('sv2-ai-forge', true);
    show('sv2-ai-routing', true);
  }

  function loadTopology() {
    return window.electronAPI.getAiTopology().then(function (result) {
      if (result && result.success) topology = result.topology;
      render();
    }).catch(function () { /* The groups stay hidden. */ });
  }

  function loadServer() {
    var api = window.api;
    if (!api || typeof api.get !== 'function') return;
    api.get('/api/v1/system/version').then(function (result) {
      version = result || null;
      render();
    }).catch(function () { version = null; render(); });
    // An older server has no /system/ai; the card then says the server does not report it.
    api.get('/api/v1/system/ai', { quietStatuses: [404] }).then(function (result) {
      serverAi = result && result.routing ? result : null;
      render();
    }).catch(function () { serverAi = null; render(); });
  }

  function boot() {
    var electron = window.electronAPI;
    if (!M || !el('sv2-ai-pip') || !electron || typeof electron.getAiTopology !== 'function') return;
    var engineApi = electron.engine;
    if (engineApi && typeof engineApi.getStatus === 'function') {
      engineApi.getStatus().then(function (result) {
        if (result && result.success) { engine = result.status; render(); }
      }).catch(function () {});
      if (typeof engineApi.onState === 'function') {
        engineApi.onState(function (status) { engine = status; loadTopology(); });
      }
    }
    loadTopology();
    loadServer();
    document.addEventListener('lex-refresh', function () { loadTopology(); loadServer(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

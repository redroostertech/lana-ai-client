/**
 * Settings > Capabilities > AI: the Local and Cloud groups below the local AI engine.
 *
 *   Local (On this computer)   Chat and Embedding here (window.electronAPI.getAiTopology(), and the
 *                              server's own model servers when it runs on this computer, from
 *                              GET /api/v1/system/ai); Speech and Voice are rendered by
 *                              settings-briefs.js with window.LanaAiRow
 *   Cloud                      the same topology and server report
 *
 * window.LanaAiRow.create(row, extras) builds one expandable row: a button with the name, a
 * one-line summary and a badge; opening it shows the row's facts and any extra controls.
 * Wording comes from settings-ai-models.model.js (window.LanaAiModels).
 */
(function () {
  'use strict';

  var M = window.LanaAiModels;
  var topology = null;
  var serverAi = null;
  var openRows = Object.create(null);

  function el(id) {
    return document.getElementById(id);
  }

  function text(tag, className, value) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function iconMarkup(name) {
    try { return window.Lex && window.Lex.Icons ? window.Lex.Icons.get({ name: name, size: 'small' }) : ''; } catch (_) { return ''; }
  }

  /**
   * One expandable row.
   * @param {{id, name, summary, badge?, tone?, facts}} row
   * @param {{badge?: Element, actions?: Element}} [extras] - a badge or controls supplied by the caller
   */
  function createRow(row, extras) {
    extras = extras || {};
    var item = document.createElement('div');
    item.className = 'sv2-ai-item';
    item.setAttribute('role', 'listitem');

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'sv2-ai-item-head';
    var copy = document.createElement('span');
    copy.className = 'sv2-ai-item-copy';
    copy.appendChild(text('span', 'sv2-ai-item-name', row.name));
    if (row.summary) copy.appendChild(text('span', 'sv2-ai-item-summary', row.summary));
    head.appendChild(copy);
    var side = document.createElement('span');
    side.className = 'sv2-ai-item-side';
    if (extras.badge) side.appendChild(extras.badge);
    else if (row.badge) {
      var badge = document.createElement('lex-badge');
      badge.setAttribute('label', row.badge);
      badge.setAttribute('color', row.tone || 'gray');
      badge.setAttribute('size', 'sm');
      side.appendChild(badge);
    }
    var chevron = document.createElement('span');
    chevron.className = 'sv2-ai-item-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = iconMarkup('chevron-down');
    side.appendChild(chevron);
    head.appendChild(side);

    var body = document.createElement('div');
    body.className = 'sv2-ai-item-body';
    body.id = 'sv2-ai-item-' + row.id;
    var facts = document.createElement('dl');
    facts.className = 'sv2-ai-item-facts';
    (row.facts || []).forEach(function (fact) {
      facts.appendChild(text('dt', '', fact.label));
      facts.appendChild(text('dd', '', fact.value));
    });
    body.appendChild(facts);
    if (extras.actions) body.appendChild(extras.actions);

    var open = openRows[row.id] === true;
    body.hidden = !open;
    item.classList.toggle('is-open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    head.setAttribute('aria-controls', body.id);
    head.addEventListener('click', function () {
      var next = body.hidden;
      body.hidden = !next;
      openRows[row.id] = next;
      item.classList.toggle('is-open', next);
      head.setAttribute('aria-expanded', next ? 'true' : 'false');
    });

    item.appendChild(head);
    item.appendChild(body);
    return item;
  }

  window.LanaAiRow = { create: createRow };

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
    fill('sv2-ai-local-rows', M.localRows(topology, serverAi).map(function (row) { return createRow(row); }));
    fill('sv2-ai-cloud-rows', kvRows(M.cloudRows(topology, serverAi)));
    show('sv2-ai-local', true);
    show('sv2-ai-cloud', true);
    window.dispatchEvent(new CustomEvent('lana-ai-topology', { detail: topology }));
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
    // An older server has no /system/ai; its model servers then do not count as this computer's.
    api.get('/api/v1/system/ai', { quietStatuses: [404] }).then(function (result) {
      serverAi = result && result.routing ? result : null;
      render();
    }).catch(function () { serverAi = null; render(); });
  }

  function boot() {
    var electron = window.electronAPI;
    if (!M || !el('sv2-ai-local') || !electron || typeof electron.getAiTopology !== 'function') return;
    if (electron.engine && typeof electron.engine.onState === 'function') {
      electron.engine.onState(function () { loadTopology(); });
    }
    loadTopology();
    loadServer();
    document.addEventListener('lex-refresh', function () { loadTopology(); loadServer(); });
  }

  /** The latest topology, for settings-briefs.js (Speech and Voice model names). */
  window.LanaAiRow.topology = function () { return topology; };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

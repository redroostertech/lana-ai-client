/**
 * Settings > Capabilities > AI models: wording for where LANA's AI runs. Pure, no DOM.
 *
 *   topology    window.electronAPI.getAiTopology() (electron-ai-topology.js)
 *   engine      window.electronAPI.engine.getStatus().status
 *   version     GET /api/v1/system/version from the organization's server, or null
 *
 * window.LanaAiModels (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  var PIP_STATES = {
    running: { label: 'Running', tone: 'green' },
    not_running: { label: 'Not running', tone: 'yellow' },
    not_set: { label: 'Not set up', tone: 'gray' }
  };
  var ROLE_LABELS = { chat: 'Chat', embedding: 'Search embeddings', draft: 'Draft (speeds up chat)' };

  /** True when a URL points at this computer. */
  function isLocal(url) {
    if (typeof url !== 'string') return false;
    var rest = url.replace(/^https?:\/\//i, '').toLowerCase();
    return rest.indexOf('127.0.0.1') === 0 || rest.indexOf('localhost') === 0 || rest.indexOf('[::1]') === 0;
  }

  function size(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '';
    var gb = bytes / 1e9;
    if (gb >= 1) return (Math.round(gb * 10) / 10) + ' GB';
    return Math.round(bytes / 1e6) + ' MB';
  }

  function joinParts(parts) {
    return parts.filter(Boolean).join(' · ');
  }

  /** The Pip build LANA expects: "LANA expects Pip 3.0.0 (build ddedf87af419)." */
  function pinnedLine(topology) {
    var pinned = topology && topology.pip && topology.pip.pinned;
    if (!pinned) return '';
    return 'LANA expects Pip ' + pinned.version + (pinned.build ? ' (build ' + pinned.build + ')' : '') + '.';
  }

  /** The two Pip endpoints, each a row with a badge and its address, model and build. */
  function pipRows(topology) {
    var pip = (topology && topology.pip) || {};
    return [['chat', 'Chat model server'], ['embedding', 'Embedding model server']].map(function (pair) {
      var endpoint = pip[pair[0]] || { state: 'not_set' };
      var state = PIP_STATES[endpoint.state] || PIP_STATES.not_set;
      return {
        name: pair[1],
        badge: state.label,
        tone: state.tone,
        detail: endpoint.url
          ? joinParts([endpoint.url, endpoint.model, endpoint.build ? 'Build ' + endpoint.build : ''])
          : 'No address given to LANA on this computer.'
      };
    });
  }

  /** The catalog models LANA runs locally, and whether each is on this computer. */
  function modelRows(topology) {
    var models = (topology && topology.pip && topology.pip.models) || [];
    return models.map(function (model) {
      return {
        name: model.name,
        detail: joinParts([ROLE_LABELS[model.role] || model.role, size(model.sizeBytes)]),
        badge: model.downloaded ? 'Downloaded' : 'Not downloaded',
        tone: model.downloaded ? 'green' : 'gray'
      };
    });
  }

  /** The organization's server: address, version, and its AI (always Forge). */
  function serverRows(topology, version) {
    var url = topology && topology.server && topology.server.url;
    var versionText = version && version.version
      ? version.version + (version.environment && version.environment !== 'production' ? ' (' + version.environment + ')' : '')
      : 'Unknown';
    return [
      { label: 'Address', value: url ? url + (isLocal(url) ? ' (this computer)' : '') : 'Not connected' },
      { label: 'Version', value: versionText },
      { label: 'AI', value: 'Forge' }
    ];
  }

  /** Forge, LANA's cloud AI. */
  function forgeRows(topology) {
    var forge = (topology && topology.forge) || {};
    var reach = forge.reachable === true ? 'Reachable' : forge.reachable === false ? 'Not reachable' : 'Unknown';
    return [
      { label: 'Address', value: forge.url || 'Not set for your organization' },
      { label: 'Status', value: forge.url ? reach : 'Unknown' },
      { label: 'Sovereign mode', value: forge.sovereign ? 'On' : 'Off' }
    ];
  }

  /** Where prompts go now, and the hybrid routing still to come. */
  function routing(engine, topology) {
    var serverUrl = topology && topology.server && topology.server.url;
    var current;
    if (engine && engine.inUse) {
      current = 'Prompts go to the local AI engine on this computer.';
    } else if (isLocal(serverUrl)) {
      current = 'Prompts go to the LANA server on this computer, which answers with Forge.';
    } else {
      current = 'Prompts go to your organization\'s server, which answers with Forge.';
    }
    return {
      current: current,
      hybrid: 'Hybrid routing, which sends each prompt to this computer or to Forge, is not available yet.'
    };
  }

  var api = { isLocal: isLocal, size: size, pinnedLine: pinnedLine, pipRows: pipRows, modelRows: modelRows, serverRows: serverRows, forgeRows: forgeRows, routing: routing };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LanaAiModels = api;
})(typeof window !== 'undefined' ? window : this);

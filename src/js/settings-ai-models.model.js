/**
 * Settings > Capabilities > AI models: wording for where LANA's AI runs. Pure, no DOM.
 *
 *   topology    window.electronAPI.getAiTopology() (electron-ai-topology.js): the Pip addresses this
 *               client was given, the catalog models downloaded here, the server address, Forge
 *   serverAi    GET /api/v1/system/ai from the organization's server: its own Pip model servers,
 *               the Forge relay, and how it routes prompts (local_only, hybrid, relay_only); null
 *               when the server does not say
 *   engine      window.electronAPI.engine.getStatus().status
 *   version     GET /api/v1/system/version, or null
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

  function serverUrl(topology) {
    return (topology && topology.server && topology.server.url) || null;
  }

  /** The server runs on this computer, so its same-host Pip does too. */
  function serverIsHere(topology) {
    return isLocal(serverUrl(topology));
  }

  /**
   * The Pip on this computer, per role: the address this client was given, else the
   * server's own Pip when the server itself runs on this computer.
   */
  function localPip(topology, serverAi, role) {
    var own = topology && topology.pip && topology.pip[role];
    if (own && own.state !== 'not_set') return own;
    var fromServer = serverAi && serverAi[role];
    if (fromServer && fromServer.same_host && serverIsHere(topology)) return fromServer;
    return own || { state: 'not_set' };
  }

  /** The Pip build LANA expects: "LANA expects Pip 3.0.0 (build ddedf87af419)." */
  function pinnedLine(topology) {
    var pinned = topology && topology.pip && topology.pip.pinned;
    if (!pinned) return '';
    return 'LANA expects Pip ' + pinned.version + (pinned.build ? ' (build ' + pinned.build + ')' : '') + '.';
  }

  function endpointDetail(endpoint) {
    return joinParts([
      endpoint.url,
      endpoint.model,
      endpoint.version ? 'Pip ' + endpoint.version : '',
      endpoint.build ? 'build ' + endpoint.build : ''
    ]);
  }

  /** The Pip model servers on this computer, each a row with a badge and its address, model, version and build. */
  function pipRows(topology, serverAi) {
    return [['chat', 'Chat model server'], ['embedding', 'Embedding model server']].map(function (pair) {
      var endpoint = localPip(topology, serverAi, pair[0]);
      var state = PIP_STATES[endpoint.state] || PIP_STATES.not_set;
      return {
        name: pair[1],
        badge: state.label,
        tone: state.tone,
        detail: endpoint.url ? endpointDetail(endpoint) : 'Not running on this computer.'
      };
    });
  }

  /** The catalog models the LANA app downloads for its own local AI engine. */
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

  /** "Pip, Qwen3.8-9B-Q4_K_M, on this computer" for the server's chat model. */
  function serverPipText(topology, serverAi) {
    var chat = serverAi && serverAi.chat;
    if (!chat || !chat.url) return 'Pip';
    var where = chat.same_host ? (serverIsHere(topology) ? 'on this computer' : 'on the server\'s computer') : 'at ' + chat.url;
    return joinParts(['Pip', chat.model]) + ', ' + where;
  }

  /** What the server answers with, from its own report. */
  function serverAiText(topology, serverAi) {
    if (!serverAi) return 'Unknown (this server does not report it)';
    if (serverAi.routing === 'relay_only') return 'Forge';
    if (serverAi.routing === 'hybrid') return serverPipText(topology, serverAi) + ', or Forge when a prompt needs it';
    return serverPipText(topology, serverAi);
  }

  /** The organization's server: address, version, and the AI it answers with. */
  function serverRows(topology, version, serverAi) {
    var url = serverUrl(topology);
    var versionText = version && version.version
      ? version.version + (version.environment && version.environment !== 'production' ? ' (' + version.environment + ')' : '')
      : 'Unknown';
    return [
      { label: 'Address', value: url ? url + (isLocal(url) ? ' (this computer)' : '') : 'Not connected' },
      { label: 'Version', value: versionText },
      { label: 'AI', value: serverAiText(topology, serverAi) }
    ];
  }

  /** Forge, LANA's cloud AI: its address, whether it answers, and whether the server sends prompts to it. */
  function forgeRows(topology, serverAi) {
    var forge = (topology && topology.forge) || {};
    var reach = forge.reachable === true ? 'Reachable' : forge.reachable === false ? 'Not reachable' : 'Unknown';
    var used = !serverAi ? 'Unknown' : serverAi.relay && serverAi.relay.enabled ? 'Yes' : 'No, turned off on your server';
    return [
      { label: 'Address', value: forge.url || 'Not set for your organization' },
      { label: 'Status', value: forge.url ? reach : 'Unknown' },
      { label: 'Used by your server', value: used },
      { label: 'Sovereign mode', value: forge.sovereign ? 'On' : 'Off' }
    ];
  }

  /** Where prompts go now, from the engine's state and the server's own routing. */
  function routing(engine, topology, serverAi) {
    var lines = [];
    if (engine && engine.inUse) lines.push('Prompts go to the local AI engine on this computer first.');
    var server = serverIsHere(topology) ? 'The LANA server on this computer' : 'Your organization\'s server';
    if (!serverAi) {
      lines.push(server + ' answers prompts. It does not report how it routes them.');
    } else if (serverAi.routing === 'relay_only') {
      lines.push(server + ' sends every prompt to Forge.');
    } else if (serverAi.routing === 'hybrid') {
      lines.push(server + ' routes each prompt: it keeps a prompt on Pip when Pip can handle it, and sends the rest to Forge with private details removed first.');
    } else {
      lines.push(server + ' answers every prompt with Pip. Forge is turned off on it, so no prompt leaves it.');
    }
    return lines;
  }

  var api = {
    isLocal: isLocal, size: size, localPip: localPip, pinnedLine: pinnedLine, pipRows: pipRows,
    modelRows: modelRows, serverRows: serverRows, forgeRows: forgeRows, routing: routing
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LanaAiModels = api;
})(typeof window !== 'undefined' ? window : this);

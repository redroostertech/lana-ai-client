/**
 * Settings > Capabilities > AI: wording for the Local and Cloud groups. Pure, no DOM.
 *
 *   topology    window.electronAPI.getAiTopology() (electron-ai-topology.js): the local model
 *               servers this client was given, the app's model catalog (downloaded or not), the
 *               speech model names, the server address, Forge
 *   serverAi    GET /api/v1/system/ai from the organization's server: its own model servers and
 *               whether it uses the cloud; null when the server does not say
 *   briefs      window.lanaBriefs.models.status() for Speech and Voice (state, size), or null
 *
 * Local has four rows (Chat, Embedding, Speech, Voice). Each opens to show the model, what it is
 * good for, how LANA uses it and the space it takes. The runtime's own name is never shown.
 *
 * window.LanaAiModels (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  var STATES = {
    running: { label: 'Running', tone: 'green' },
    not_running: { label: 'Not running', tone: 'yellow' },
    not_set: { label: 'Not set up', tone: 'gray' }
  };

  // What each kind of model is for and how LANA uses it.
  var ABOUT = {
    chat: {
      goodFor: 'Answering questions, drafting and summarizing, and running tools in chat.',
      howUsed: 'Chat prompts answered on this computer go to it. A small draft model runs beside it so answers start sooner.'
    },
    embedding: {
      goodFor: 'Finding the right passages in your documents, for search and for grounded answers.',
      howUsed: 'Turns document text and your questions into numbers LANA can compare. Documents are indexed with it when they are added.'
    },
    speech: {
      goodFor: 'Turning meeting audio into text and telling the speakers apart.',
      howUsed: 'LANA Briefs transcribes meetings you record on this computer. Nothing leaves it.'
    },
    voice: {
      goodFor: 'Speaking LANA\'s answers aloud in a natural voice.',
      howUsed: 'Talk with LANA speaks with it, on this computer. Talk is not in this app yet, so the voice is not downloaded here.'
    }
  };

  // Speech packages by row (electron-local-models.js SPEECH_CATALOG ids).
  var SPEECH_PACKAGES = { speech: ['parakeet', 'vad', 'segmentation', 'embedding'], voice: ['kokoro'] };
  // Briefs model status ids by row.
  var BRIEFS_IDS = { speech: 'transcription', voice: 'voice' };

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

  function serverIsHere(topology) {
    return isLocal(topology && topology.server && topology.server.url);
  }

  /**
   * The model server on this computer for a role: the address this client was given, else the
   * server's own when the server itself runs on this computer.
   */
  function localServer(topology, serverAi, role) {
    var own = topology && topology.pip && topology.pip[role];
    if (own && own.state !== 'not_set') return { endpoint: own, viaServer: false };
    var fromServer = serverAi && serverAi[role];
    if (fromServer && fromServer.same_host && serverIsHere(topology)) return { endpoint: fromServer, viaServer: true };
    return { endpoint: own || { state: 'not_set' }, viaServer: false };
  }

  function catalogFor(topology, role) {
    return ((topology && topology.models) || []).filter(function (model) { return model.role === role; });
  }

  /** "5.6 GB, downloaded" for the app's own copies of a role's models. */
  function catalogSpace(models) {
    if (!models.length) return 'Not reported';
    var total = models.reduce(function (sum, model) { return sum + (model.sizeBytes || 0); }, 0);
    var downloaded = models.every(function (model) { return model.downloaded; });
    return size(total) + (downloaded ? ', downloaded' : ', not downloaded yet');
  }

  /** Chat or Embedding: status from the running model server, facts from the app's catalog. */
  function serverRow(topology, serverAi, role) {
    var found = localServer(topology, serverAi, role);
    var endpoint = found.endpoint;
    var state = STATES[endpoint.state] || STATES.not_set;
    var models = catalogFor(topology, role).concat(role === 'chat' ? catalogFor(topology, 'draft') : []);
    var facts = [
      { label: 'Model', value: models.length ? models.map(function (m) { return m.name; }).join(', with ') : 'Not reported' },
      { label: 'Good for', value: ABOUT[role].goodFor },
      { label: 'How it is used', value: ABOUT[role].howUsed },
      { label: 'Space on this computer', value: catalogSpace(models) }
    ];
    if (endpoint.state === 'running') {
      facts.push({
        label: 'Running now',
        value: (endpoint.model ? endpoint.model + ', ' : '') + (found.viaServer ? 'served by the LANA server on this computer' : 'at ' + endpoint.url)
      });
    }
    return {
      id: role,
      name: role === 'chat' ? 'Chat' : 'Embedding',
      // A line under the name only when something is not available; the badge says the rest.
      summary: endpoint.state === 'running' ? '' : endpoint.state === 'not_running' ? 'Set up, but not answering' : 'Not running on this computer',
      badge: state.label,
      tone: state.tone,
      facts: facts
    };
  }

  /** The Chat and Embedding rows. */
  function localRows(topology, serverAi) {
    return [serverRow(topology, serverAi, 'chat'), serverRow(topology, serverAi, 'embedding')];
  }

  /** Speech or Voice: facts from the speech catalog and the Briefs status (state, size). */
  function speechRow(kind, topology, briefsStatus) {
    var names = ((topology && topology.speech) || []).filter(function (model) {
      return SPEECH_PACKAGES[kind].indexOf(model.id) !== -1;
    }).map(function (model) { return model.name; });
    var status = briefsStatus || {};
    var kindOfState = status.state && status.state.kind;
    var ready = kindOfState === 'ready';
    return {
      id: kind,
      briefsId: BRIEFS_IDS[kind],
      name: kind === 'speech' ? 'Speech' : 'Voice',
      summary: ready ? '' : kindOfState === 'downloading' ? 'Downloading'
        : kind === 'voice' ? 'Not used in this app yet' : 'Not downloaded',
      facts: [
        { label: 'Models', value: names.length ? names.join('; ') : 'Not reported' },
        { label: 'Good for', value: ABOUT[kind].goodFor },
        { label: 'How it is used', value: ABOUT[kind].howUsed },
        { label: 'Space on this computer', value: status.sizeText ? 'About ' + status.sizeText + (ready ? '' : ' when downloaded') : 'Not reported' }
      ]
    };
  }

  /** The cloud: whether it answers, and whether the server sends prompts to it. */
  function cloudRows(topology, serverAi) {
    var forge = (topology && topology.forge) || {};
    var reach = forge.reachable === true ? 'Reachable' : forge.reachable === false ? 'Not reachable' : 'Unknown';
    var used = !serverAi ? 'Unknown' : serverAi.relay && serverAi.relay.enabled ? 'Yes' : 'No, turned off on your server';
    return [
      { label: 'Status', value: forge.url ? reach : 'Not set for your organization' },
      { label: 'Used by your server', value: used },
      { label: 'Sovereign mode', value: forge.sovereign ? 'On' : 'Off' }
    ];
  }

  var api = { isLocal: isLocal, size: size, localServer: localServer, localRows: localRows, speechRow: speechRow, cloudRows: cloudRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LanaAiModels = api;
})(typeof window !== 'undefined' ? window : this);

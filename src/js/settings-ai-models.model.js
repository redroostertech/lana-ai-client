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
    running: { label: 'Ready', tone: 'green' },
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
      howUsed: 'Talk with LANA will speak with it, on this computer. Talk is not in this app yet.'
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

  // Every model row has the same details, in this order: Model, Runs in, Good for, How it is
  // used, Space on this computer.
  function facts(model, runsIn, role, howUsed, space) {
    return [
      { label: 'Model', value: model },
      { label: 'Runs in', value: runsIn },
      { label: 'Good for', value: ABOUT[role].goodFor },
      { label: 'How it is used', value: howUsed },
      { label: 'Space on this computer', value: space }
    ];
  }

  /**
   * Chat or Embedding served by the LANA server on this computer (the local AI engine is not
   * set up): the server's own model, not the app's catalog, which only the engine uses.
   */
  function viaServerRow(endpoint, role) {
    return {
      id: role,
      name: role === 'chat' ? 'Chat' : 'Embedding',
      summary: '',
      badge: STATES.running.label,
      tone: STATES.running.tone,
      facts: facts(
        endpoint.model || 'Not reported',
        'The LANA server on this computer, not the local AI engine',
        role,
        role === 'chat'
          ? 'Your chat prompts go to the LANA server on this computer, which answers with this model.'
          : 'The LANA server on this computer indexes your documents and questions with this model.',
        // Pip does not report its model file size yet.
        'Not reported by Pip'
      )
    };
  }

  /** Chat or Embedding: status from the running model server, facts from the app's catalog. */
  function serverRow(topology, serverAi, role) {
    var found = localServer(topology, serverAi, role);
    var endpoint = found.endpoint;
    if (found.viaServer && endpoint.state === 'running') return viaServerRow(endpoint, role);
    var state = STATES[endpoint.state] || STATES.not_set;
    var models = catalogFor(topology, role).concat(role === 'chat' ? catalogFor(topology, 'draft') : []);
    var runsIn = endpoint.state === 'running' ? 'The local AI engine on this computer, at ' + endpoint.url
      : endpoint.state === 'not_running' ? 'The local AI engine on this computer, which is not answering'
        : 'Nothing on this computer runs it yet. The local AI engine will.';
    return {
      id: role,
      name: role === 'chat' ? 'Chat' : 'Embedding',
      // A line under the name only when something is not available; the badge says the rest.
      summary: endpoint.state === 'running' ? '' : endpoint.state === 'not_running' ? 'Set up, but not answering' : 'Not running on this computer',
      badge: state.label,
      tone: state.tone,
      // Running: what that Pip server reports it loaded. Otherwise: the app's catalog copy, which
      // the engine will use once it is downloaded.
      facts: endpoint.state === 'running'
        ? facts(endpoint.model || 'Not reported', runsIn, role, ABOUT[role].howUsed, 'Not reported by Pip')
        : facts(
          models.length ? models.map(function (m) { return m.name; }).join(', with ') : 'Not reported',
          runsIn,
          role,
          ABOUT[role].howUsed,
          catalogSpace(models)
        )
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
      facts: facts(
        names.length ? names.join('; ') : 'Not reported',
        'This app, on this computer',
        kind,
        ABOUT[kind].howUsed,
        status.sizeText ? 'About ' + status.sizeText + (ready ? '' : ' when downloaded') : 'Not reported'
      )
    };
  }

  /** Forge, LANA's own cloud: whether it answers, and whether the server sends prompts to it. */
  function cloudRows(topology, serverAi) {
    var forge = (topology && topology.forge) || {};
    var reach = forge.reachable === true ? 'Reachable' : forge.reachable === false ? 'Not reachable' : 'Unknown';
    var used = !serverAi ? 'Unknown' : serverAi.relay && serverAi.relay.enabled ? 'Yes' : 'No, turned off on your server';
    return [
      { label: 'Forge', value: forge.url ? reach : 'Not set for your organization' },
      // No sovereign mode row: Forge always runs in sovereign mode, so it would never say anything.
      { label: 'Used by your server', value: used }
    ];
  }

  var api = { isLocal: isLocal, size: size, localServer: localServer, localRows: localRows, speechRow: speechRow, cloudRows: cloudRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LanaAiModels = api;
})(typeof window !== 'undefined' ? window : this);

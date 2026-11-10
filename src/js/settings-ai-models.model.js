/**
 * Settings > Capabilities > AI: wording for the Speech and Voice rows and the Cloud group. Pure,
 * no DOM. Chat, search, image reading, document reading and the privacy filter come from the
 * first-launch plan instead (settings-capabilities.model.js).
 *
 *   topology    window.electronAPI.getAiTopology() (electron-ai-topology.js): the local model
 *               servers this client was given, the app's model catalog (downloaded or not), the
 *               speech model names, the server address, Forge
 *   serverAi    GET /api/v1/system/ai from the organization's server: its own model servers and
 *               whether it uses the cloud; null when the server does not say
 *   briefs      window.lanaBriefs.models.status() for Speech and Voice (state, size), or null
 *   planned     the first-launch plan's word on Speech or Voice ({ install, reason }), or null
 *
 * Speech and Voice each open to show the model, what it is good for, how LANA uses it and the
 * space it takes. The runtime's own name is never shown.
 *
 * window.LanaAiModels (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  // What each kind of model is for and how LANA uses it.
  var ABOUT = {
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

  /** Speech or Voice: facts from the speech catalog and the Briefs status (state, size). */
  function speechRow(kind, topology, briefsStatus, planned) {
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
      // Not ready because the plan left it out: say why (too little memory or space).
      summary: ready ? '' : kindOfState === 'downloading' ? 'Downloading'
        : planned && planned.install === false && planned.reason ? planned.reason
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

  var api = { isLocal: isLocal, size: size, speechRow: speechRow, cloudRows: cloudRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LanaAiModels = api;
})(typeof window !== 'undefined' ? window : this);

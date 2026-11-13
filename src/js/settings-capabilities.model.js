/**
 * Settings > Capabilities: what this computer runs on its own, and changing the chat model
 * (docs/plans/first-launch-local-ai-plan.md, section 7, phase E). Pure, no DOM.
 *
 * The main process hands over the same plan view the first-launch screen gets
 * (electron-first-launch.js plan(): no file addresses), the download status, and the state of
 * each local server (electron-first-launch-ipc.js localServerStates: ready, starting,
 * not_running, not_installed). This module turns them into words; the sizing itself stays in
 * local-ai-fit.model.js.
 *
 *   buildCapabilitiesView({ planView, servers, status, serverAi, includeSpeech })
 *       serverAi        GET /api/v1/system/ai from the organization's server (relay.enabled: it
 *                       uses the cloud; chat.state: its own chat model), or null when unknown.
 *                       Where chat runs before local setup finishes is said only from these facts.
 *       computerFacts   memory, chip, graphics memory, free space, and where chat runs
 *       chat            the chat model in use: name, fit and pages remembered, server state
 *       rows            search, image reading, document reading, the privacy filter, and speech
 *                       and voice when Briefs does not show its own rows
 *       choices         the same chat choices as first launch, too big ones disabled
 *       progress        the downloads while setup runs (also after a switch), else null
 *       setup           { label } when Continue was never pressed and files are needed: the
 *                       setup offer in Settings (the same first-launch Continue), else null
 *   createCapabilitiesController({ api, render })  loading, polling, the chooser and the switch
 *
 * The person chooses only the chat model (plan section 1, D4). LANA chooses the rest, so those
 * rows show facts and never a control.
 *
 * Copy rules: words a 6th grader can follow, "computer" and never a brand of device, no ids.
 *
 * window.LanaCapabilities (browser) / module.exports (tests).
 */
(function (root) {
  'use strict';

  var node = typeof module !== 'undefined' && module.exports;
  var fit = node ? require('./local-ai-fit.model') : root.LanaLocalAiFit;
  var firstLaunch = node ? require('./first-launch.model') : root.LanaFirstLaunch;
  var formatBytes = firstLaunch.formatBytes;

  var BADGES = {
    ready: { label: 'Ready', tone: 'green' },
    starting: { label: 'Starting', tone: 'blue' },
    not_running: { label: 'Not running', tone: 'yellow' },
    not_installed: { label: 'Not installed', tone: 'gray' },
    downloading: { label: 'Downloading', tone: 'blue' },
    off: { label: 'Off', tone: 'gray' }
  };

  // The local files settings-capabilities downloads (electron-first-launch.js LOCAL_KINDS).
  var LOCAL_KINDS = { embedding: true, chat: true, vision: true, docling: true };

  var WHAT = {
    search: 'Finds the right parts of your files for search and for answers.',
    images: 'Reads pictures and scanned pages you add to chat.',
    documents: 'Reads your documents on this computer.',
    privacy: 'Keeps names and private details out of cloud requests.',
    speech: 'Turns speech into text, on this computer.',
    voice: 'Reads answers out loud, on this computer.'
  };

  function badge(key) {
    return BADGES[key] || BADGES.not_running;
  }

  /** One row of the "Set up by LANA" list (window.LanaAiRow shape). */
  function row(id, name, on, stateKey, summary, where) {
    var b = on ? badge(stateKey) : BADGES.off;
    var facts = [{ label: 'What it does', value: WHAT[id] }];
    if (on && where) {facts.push({ label: 'Where it runs', value: where });}
    return { id: id, name: name, summary: summary || '', badge: b.label, tone: b.tone, facts: facts };
  }

  /** A line under a server's name only when it is not ready; the badge says the rest. */
  function serverSummary(stateKey) {
    if (stateKey === 'starting') {return 'Getting ready. This can take a minute.';}
    if (stateKey === 'not_running') {return 'Set up, but not answering. LANA keeps trying.';}
    return '';
  }

  function settingUp(status) {
    var phase = status && status.phase;
    return phase === 'downloading' || phase === 'checking' || phase === 'paused' || phase === 'failed';
  }

  /** The files still to fetch now are on their way (not stopped by a failure). */
  function fetching(status) {
    var phase = status && status.phase;
    return phase === 'downloading' || phase === 'checking' || phase === 'paused';
  }

  /** The local files the plan still has to fetch (download.files lists only files not in place). */
  function localFiles(view) {
    var files = (view.download && view.download.files) || [];
    return files.filter(function (f) { return LOCAL_KINDS[f.kind]; });
  }

  function needsFile(view, id) {
    return Boolean(id) && localFiles(view).some(function (f) { return f.id === id; });
  }

  /**
   * Where chat runs while it is not on this computer, said only when the server's own facts
   * show it: the cloud only when the server has it on, the server's model only when it runs.
   * Empty when the server has not said.
   */
  function meanwhile(serverAi, started) {
    if (!serverAi) {return '';}
    if (serverAi.relay && serverAi.relay.enabled === true) {return 'Uses the cloud for now.';}
    if (serverAi.chat && serverAi.chat.state === 'running') {return 'Uses your server\'s model for now.';}
    return started ? 'Chat has nowhere to run until setup finishes.' : 'Chat has nowhere to run until local AI is set up.';
  }

  function sentence(first, second) {
    return second ? first + ' ' + second : first;
  }

  /** "Getting ready: ..." with the download's progress. */
  function gettingReady(status) {
    var phase = status && status.phase;
    var p = firstLaunch.buildProgressView(status);
    if (phase === 'downloading') {
      var what = status.current && status.current.kind === 'chat' ? 'the chat model' : 'the AI files';
      return 'Getting ready: downloading ' + what + ' (' + p.percent + '%).';
    }
    if (phase === 'checking') {return 'Getting ready: checking the files.';}
    if (phase === 'paused') {return 'Getting ready: paused at ' + p.percent + '%.';}
    if (phase === 'failed') {return 'Getting ready: the download stopped.';}
    return 'Getting ready.';
  }

  /**
   * Where chat runs, and why, from the plan, the chat server, the setup and the server's facts.
   * @returns {{ runs: string, note: string }}
   */
  function chatPlace(plan, servers, view, status, serverAi) {
    if (!plan.chat || plan.chat.where !== 'local') {
      // Too small for a chat model here: the organization's server answers, by its own facts.
      if (!serverAi) {return { runs: 'On your organization\'s server', note: '' };}
      if (serverAi.relay && serverAi.relay.enabled === true) {return { runs: 'In the cloud', note: '' };}
      if (serverAi.chat && serverAi.chat.state === 'running') {return { runs: 'On your server', note: '' };}
      return { runs: 'Nowhere yet. This computer is too small for a chat model, and your server has none running.', note: '' };
    }
    var started = Boolean(view.acceptedAt) || settingUp(status);
    if (servers && servers.pipInstalled === false) {
      var why = 'LANA\'s AI server is not on this computer yet.';
      return { runs: sentence('Not on this computer yet.', meanwhile(serverAi, started)), note: sentence(why, meanwhile(serverAi, started)) };
    }
    if (!view.completedAt) {
      // A switch leaves the running chat server alone until the new files are in place.
      if (servers && servers.chat === 'ready') {
        return { runs: 'On this computer', note: 'Until this model is ready, chat keeps using the one it has now.' };
      }
      var head = settingUp(status) ? gettingReady(status)
        : view.acceptedAt ? 'Getting ready.' : 'Not set up on this computer yet.';
      return { runs: sentence(head, meanwhile(serverAi, started)), note: '' };
    }
    return { runs: 'On this computer', note: '' };
  }

  /**
   * A search or image row whose model file is not in place yet: Downloading while setup fetches
   * it, else Needs its model. Null when the file is in place (the server's state then speaks).
   */
  function missingModel(view, ids, stateKey, status) {
    if (stateKey === 'ready' || !ids.some(function (id) { return needsFile(view, id); })) {return null;}
    if (fetching(status)) {return { stateKey: 'downloading', summary: 'LANA is downloading its model.' };}
    return { stateKey: 'not_installed', summary: view.acceptedAt ? 'Needs its model. LANA downloads it when setup runs again.' : 'Needs its model. Set up local AI above to download it.' };
  }

  /** A server's line when its file is in place: not answering only when the AI server is here. */
  function placedSummary(stateKey, servers) {
    if (stateKey === 'not_running' && servers && servers.pipInstalled === false) {return 'LANA\'s AI server is not on this computer yet.';}
    return serverSummary(stateKey);
  }

  /** The setup offer: Continue was never pressed and this computer still needs local files. */
  function setupView(view, status) {
    if (view.acceptedAt || settingUp(status)) {return null;}
    var files = localFiles(view);
    if (!files.length) {return null;}
    var needed = (view.download && view.download.neededBytes) || files.reduce(function (sum, f) { return sum + (f.bytes || 0); }, 0);
    return {
      label: 'Set up local AI: about ' + formatBytes(needed),
      text: 'LANA downloads the AI models this computer runs on its own, in the background. You can follow the progress here.'
    };
  }

  function chatView(view, servers, place) {
    var plan = view.plan || {};
    var choices = view.chatChoices || [];
    var selected = plan.chat && plan.chat.where === 'local'
      ? choices.find(function (c) { return c.id === plan.chat.id; }) || null
      : null;
    if (!selected) {
      return {
        cloud: true,
        name: 'None on this computer',
        detail: 'This computer does not have enough memory for a chat model.',
        badge: null,
        tone: null,
        note: '',
        canChange: false
      };
    }
    var stateKey = servers && servers.pipInstalled !== false && view.completedAt ? servers.chat : null;
    var b = stateKey ? badge(stateKey) : null;
    return {
      cloud: false,
      name: selected.name,
      detail: fit.fitLabel(selected.fit) + '. ' + fit.remembersLabel(selected.contextTokens) + '.',
      badge: b ? b.label : null,
      tone: b ? b.tone : null,
      note: place.note || (selected.slow ? selected.reason : '') || serverSummary(stateKey),
      canChange: choices.some(function (c) { return c.fit !== 'wont_fit' && c.id !== selected.id; })
    };
  }

  function choiceDescription(choice) {
    if (choice.fit === 'wont_fit') {return choice.reason || fit.fitLabel(choice.fit);}
    var parts = [fit.fitLabel(choice.fit) + '.', fit.remembersLabel(choice.contextTokens) + '.', formatBytes(choice.sizeBytes) + ' file.'];
    if (choice.slow && choice.reason) {parts.push(choice.reason);}
    return parts.join(' ');
  }

  function choicesView(view) {
    var plan = view.plan || {};
    if (!plan.chat || plan.chat.where !== 'local') {return [];}
    return (view.chatChoices || []).map(function (c) {
      return {
        value: c.id,
        label: c.name + (c.id === view.defaultChatId ? ' (recommended)' : ''),
        description: choiceDescription(c),
        disabled: c.fit === 'wont_fit'
      };
    });
  }

  function rowsView(view, servers, status, includeSpeech, serverAi) {
    var plan = view.plan || {};
    var s = servers || {};
    var rows = [];

    var searchOn = plan.embedding && plan.embedding.where === 'local';
    var searchMissing = searchOn ? missingModel(view, [plan.embedding.id], s.embedding, status) : null;
    var searchState = searchMissing ? searchMissing.stateKey : s.embedding;
    rows.push(row('search', 'Search', searchOn, searchState,
      searchOn ? (searchMissing ? searchMissing.summary : placedSummary(s.embedding, s)) : plan.embedding && plan.embedding.reason, 'On this computer'));

    var imagesOn = Boolean(plan.vision && plan.vision.id);
    // With chat in the cloud the plan's reason starts with the row's own name, so it is said shorter.
    // "Cloud" only when the server has it on.
    var relayOn = Boolean(serverAi && serverAi.relay && serverAi.relay.enabled === true);
    var imagesOff = plan.chat && plan.chat.where === 'cloud' ? (relayOn ? 'Uses the cloud, with chat.' : 'Goes with chat, off this computer.') : plan.vision && plan.vision.reason;
    // Image reading runs inside the chat model, so it needs both files.
    var imagesMissing = imagesOn ? missingModel(view, [plan.vision.id, plan.chat && plan.chat.id], s.chat, status) : null;
    var imagesState = imagesMissing ? imagesMissing.stateKey : s.chat;
    rows.push(row('images', 'Image reading', imagesOn, imagesState,
      imagesOn ? (imagesMissing ? imagesMissing.summary : placedSummary(s.chat, s)) : imagesOff, 'On this computer, inside the chat model'));

    var docling = plan.docling;
    if (docling && (docling.install || docling.reason)) {
      var failed = status && status.docling && status.docling.installed === false;
      var docSummary = !docling.install ? docling.reason
        : s.docling === 'not_installed' ? (failed ? 'It could not be installed. LANA tries again the next time it opens.'
          : view.acceptedAt ? 'LANA installs it with the other files.' : 'Set up local AI above to install it.')
          : serverSummary(s.docling);
      rows.push(row('documents', 'Document reading', docling.install, s.docling, docSummary, 'On this computer'));
    }

    var privacyOn = s.redactor !== 'not_installed';
    rows.push(row('privacy', 'Privacy filter', privacyOn, s.redactor,
      privacyOn ? serverSummary(s.redactor) : 'Not on this computer yet. Until it is, LANA does not send chats to the cloud.',
      'On this computer'));

    if (includeSpeech) {
      // Briefs fetches these only after Continue (electron-first-launch.js speechModels).
      var addedLater = view.acceptedAt ? { key: 'ready', text: 'LANA adds it when you use LANA Briefs.' } : { key: 'not_installed', text: 'Set up local AI above to add it.' };
      var speechOn = Boolean(plan.speech && plan.speech.install);
      rows.push(row('speech', 'Speech', speechOn, addedLater.key, speechOn ? addedLater.text : plan.speech && plan.speech.reason, 'On this computer'));
      var voiceOn = Boolean(plan.voice && plan.voice.install);
      rows.push(row('voice', 'Voice', voiceOn, addedLater.key, voiceOn ? addedLater.text : plan.voice && plan.voice.reason, 'On this computer'));
    }
    return rows;
  }

  /** The downloads while setup runs, with the first-launch words; null when nothing runs. */
  function progressView(status) {
    if (!settingUp(status)) {return null;}
    var p = firstLaunch.buildProgressView(status);
    // The chat model's name is already above the progress, so it is not said twice.
    var chatFile = status.phase === 'downloading' && status.current && status.current.kind === 'chat';
    return {
      phase: p.phase,
      heading: p.heading,
      current: chatFile ? 'Now getting the chat model.' : p.current,
      bytes: p.bytes,
      percent: p.percent,
      error: p.error,
      canPause: p.canPause,
      canResume: p.canResume,
      canRetry: p.canRetry,
      tone: p.tone
    };
  }

  /**
   * @param {Object} input
   * @param {Object} input.planView - electron-first-launch.js plan()
   * @param {Object} [input.servers] - localServerStates()
   * @param {Object} [input.status] - the download status
   * @param {Object} [input.serverAi] - GET /api/v1/system/ai, or null when the server has not said
   * @param {boolean} [input.includeSpeech] - Briefs does not show its own Speech and Voice rows
   */
  function buildCapabilitiesView(input) {
    var view = input.planView || {};
    var servers = input.servers || null;
    var status = input.status || view.status || null;
    var plan = view.plan || {};
    var place = chatPlace(plan, servers, view, status, input.serverAi || null);
    var computerFacts = firstLaunch.buildChoiceView(view).computerFacts.concat([{ label: 'Chat runs', value: place.runs }]);
    return {
      computerFacts: computerFacts,
      chat: chatView(view, servers, place),
      rows: rowsView(view, servers, status, Boolean(input.includeSpeech), input.serverAi || null),
      choices: choicesView(view),
      currentChatId: plan.chat && plan.chat.where === 'local' ? plan.chat.id : null,
      progress: progressView(status),
      setup: setupView(view, status)
    };
  }

  /**
   * The section's steps. api is window.electronAPI.firstLaunch (electron-preload.js); render gets
   * { loading, error, notice, view, chooserOpen, selectedId, canSwitch, busy }.
   * @param {Object} options
   * @param {Object} options.api
   * @param {Function} options.render
   * @param {() => boolean} [options.includeSpeech]
   */
  function createCapabilitiesController(options) {
    var api = options.api;
    var render = options.render;
    var includeSpeech = options.includeSpeech || function () { return false; };
    var state = { planView: null, servers: null, status: null, serverAi: null, error: null, notice: null, chooserOpen: false, selectedId: null, busy: false, switchingTo: null };

    function current() {
      return state.planView ? buildCapabilitiesView({ planView: state.planView, servers: state.servers, status: state.status, serverAi: state.serverAi, includeSpeech: includeSpeech() }) : null;
    }

    function draw() {
      var view = current();
      render({
        loading: !view && !state.error,
        error: state.error,
        notice: state.notice,
        view: view,
        chooserOpen: state.chooserOpen && Boolean(view && view.choices.length),
        selectedId: state.selectedId,
        canSwitch: Boolean(view && state.selectedId && state.selectedId !== view.currentChatId && !state.busy),
        busy: state.busy
      });
    }

    function unwrap(result) {
      if (!result || result.success === false) {throw new Error((result && result.error) || 'LANA could not read this computer.');}
      return result;
    }

    function fail(error) {
      state.busy = false;
      state.switchingTo = null;
      state.error = error.message;
      draw();
    }

    function load() {
      draw();
      return api.getCapabilities().then(unwrap).then(function (result) {
        state.planView = result.plan;
        state.servers = result.servers || null;
        state.status = result.plan.status || state.status;
        state.error = null;
        draw();
      }).catch(fail);
    }

    function refreshServers() {
      return api.getServers().then(unwrap).then(function (result) {
        state.servers = result.servers || null;
        draw();
      }).catch(function () { /* the last known states stay */ });
    }

    function nameOf(chatId) {
      var choice = ((state.planView && state.planView.chatChoices) || []).find(function (c) { return c.id === chatId; });
      return choice ? choice.name : null;
    }

    /** A status push from the main process. When setup finishes, the plan is read again. */
    function onStatus(status) {
      var was = state.status && state.status.phase;
      state.status = status;
      if (status && status.phase === 'ready' && was !== 'ready') {
        if (state.switchingTo) {
          state.notice = 'Now using ' + state.switchingTo + '.';
          state.switchingTo = null;
        }
        return load();
      }
      draw();
      return Promise.resolve();
    }

    function openChooser() {
      var view = current();
      if (!view || !view.choices.length) {return;}
      state.chooserOpen = true;
      state.selectedId = view.currentChatId;
      state.notice = null;
      draw();
    }

    function closeChooser() {
      state.chooserOpen = false;
      state.selectedId = null;
      draw();
    }

    function select(chatId) {
      state.selectedId = chatId;
      draw();
    }

    /** Switch to the selected model. LANA's own default is saved as "no choice", as on first launch. */
    function confirm() {
      var view = current();
      if (!view || state.busy || !state.selectedId || state.selectedId === view.currentChatId) {return Promise.resolve();}
      var chatId = state.selectedId;
      state.busy = true;
      state.error = null;
      state.notice = null;
      draw();
      var saved = chatId === state.planView.defaultChatId ? null : chatId;
      // Set before the call: with every file already here, setup can finish (and its status
      // arrive) before the call itself answers.
      state.switchingTo = nameOf(chatId);
      return api.switchChat(saved).then(unwrap).then(function (result) {
        if (state.switchingTo) {
          state.planView = result.plan;
          if (result.status) {state.status = result.status;}
        }
        state.busy = false;
        state.chooserOpen = false;
        state.selectedId = null;
        draw();
      }).catch(fail);
    }

    function simple(call) {
      return function () {
        return call().then(unwrap).then(function (result) {
          if (result.status) {state.status = result.status;}
          draw();
        }).catch(fail);
      };
    }

    /** The server's own AI facts (settings-ai-models.js fetches them once for the page). */
    function setServerAi(serverAi) {
      state.serverAi = serverAi || null;
      draw();
    }

    /** The setup offer: the first-launch Continue, so later launches pick setup up again. */
    function setUp() {
      if (state.busy) {return Promise.resolve();}
      state.busy = true;
      state.error = null;
      state.notice = null;
      draw();
      return api.continue({ useExisting: false }).then(unwrap).then(function (result) {
        if (result.status) {state.status = result.status;}
        state.busy = false;
        draw();
      }).catch(fail);
    }

    return {
      load: load,
      setServerAi: setServerAi,
      setUp: setUp,
      refreshServers: refreshServers,
      onStatus: onStatus,
      openChooser: openChooser,
      closeChooser: closeChooser,
      select: select,
      confirm: confirm,
      pause: simple(function () { return api.pause(); }),
      resume: simple(function () { return api.resume(); }),
      redraw: draw,
      state: function () { return state; }
    };
  }

  var api = {
    buildCapabilitiesView: buildCapabilitiesView,
    createCapabilitiesController: createCapabilitiesController,
    BADGES: BADGES
  };
  if (node) {module.exports = api;}
  else {root.LanaCapabilities = api;}
})(typeof window !== 'undefined' ? window : this);

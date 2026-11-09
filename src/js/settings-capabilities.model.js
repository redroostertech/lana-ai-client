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
 *   buildCapabilitiesView({ planView, servers, status, includeSpeech })
 *       computerFacts   memory, chip, graphics memory, free space, and where chat runs
 *       chat            the chat model in use: name, fit and pages remembered, server state
 *       rows            search, image reading, document reading, the privacy filter, and speech
 *                       and voice when Briefs does not show its own rows
 *       choices         the same chat choices as first launch, too big ones disabled
 *       progress        the downloads while setup runs (also after a switch), else null
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
    on: { label: 'On', tone: 'green' },
    off: { label: 'Off', tone: 'gray' }
  };

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

  /**
   * Where chat runs, and why, from the plan and the chat server.
   * @returns {{ runs: string, note: string }}
   */
  function chatPlace(plan, servers, view) {
    if (!plan.chat || plan.chat.where !== 'local') {return { runs: 'In the cloud', note: '' };}
    if (servers && servers.pipInstalled === false) {
      return { runs: 'In the cloud for now', note: 'LANA\'s AI server is not on this computer yet, so chat uses the cloud.' };
    }
    if (!view.completedAt) {
      // A switch leaves the running chat server alone until the new files are in place.
      if (servers && servers.chat === 'ready') {
        return { runs: 'On this computer', note: 'Until this model is ready, chat keeps using the one it has now.' };
      }
      return { runs: 'In the cloud until setup finishes', note: '' };
    }
    return { runs: 'On this computer', note: '' };
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

  function rowsView(view, servers, status, includeSpeech) {
    var plan = view.plan || {};
    var s = servers || {};
    var rows = [];

    var searchOn = plan.embedding && plan.embedding.where === 'local';
    rows.push(row('search', 'Search', searchOn, s.embedding, searchOn ? serverSummary(s.embedding) : plan.embedding && plan.embedding.reason, 'On this computer'));

    var imagesOn = Boolean(plan.vision && plan.vision.id);
    // With chat in the cloud the plan's reason starts with the row's own name, so it is said shorter.
    var imagesOff = plan.chat && plan.chat.where === 'cloud' ? 'Uses the cloud, with chat.' : plan.vision && plan.vision.reason;
    rows.push(row('images', 'Image reading', imagesOn, s.chat, imagesOn ? serverSummary(s.chat) : imagesOff, 'On this computer, inside the chat model'));

    var docling = plan.docling;
    if (docling && (docling.install || docling.reason)) {
      var failed = status && status.docling && status.docling.installed === false;
      var docSummary = !docling.install ? docling.reason
        : s.docling === 'not_installed' ? (failed ? 'It could not be installed. LANA tries again the next time it opens.' : 'LANA installs it with the other files.')
          : serverSummary(s.docling);
      rows.push(row('documents', 'Document reading', docling.install, s.docling, docSummary, 'On this computer'));
    }

    var privacyOn = s.redactor !== 'not_installed';
    rows.push(row('privacy', 'Privacy filter', privacyOn, s.redactor,
      privacyOn ? serverSummary(s.redactor) : 'Not on this computer yet. Until it is, LANA does not send chats to the cloud.',
      'On this computer'));

    if (includeSpeech) {
      var speechOn = Boolean(plan.speech && plan.speech.install);
      rows.push(row('speech', 'Speech', speechOn, 'on', speechOn ? 'LANA adds it when you use LANA Briefs.' : plan.speech && plan.speech.reason, 'On this computer'));
      var voiceOn = Boolean(plan.voice && plan.voice.install);
      rows.push(row('voice', 'Voice', voiceOn, 'on', voiceOn ? 'LANA adds it when you use LANA Briefs.' : plan.voice && plan.voice.reason, 'On this computer'));
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
   * @param {boolean} [input.includeSpeech] - Briefs does not show its own Speech and Voice rows
   */
  function buildCapabilitiesView(input) {
    var view = input.planView || {};
    var servers = input.servers || null;
    var status = input.status || view.status || null;
    var plan = view.plan || {};
    var place = chatPlace(plan, servers, view);
    var computerFacts = firstLaunch.buildChoiceView(view).computerFacts.concat([{ label: 'Chat runs', value: place.runs }]);
    return {
      computerFacts: computerFacts,
      chat: chatView(view, servers, place),
      rows: rowsView(view, servers, status, Boolean(input.includeSpeech)),
      choices: choicesView(view),
      currentChatId: plan.chat && plan.chat.where === 'local' ? plan.chat.id : null,
      progress: progressView(status)
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
    var state = { planView: null, servers: null, status: null, error: null, notice: null, chooserOpen: false, selectedId: null, busy: false, switchingTo: null };

    function current() {
      return state.planView ? buildCapabilitiesView({ planView: state.planView, servers: state.servers, status: state.status, includeSpeech: includeSpeech() }) : null;
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

    return {
      load: load,
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

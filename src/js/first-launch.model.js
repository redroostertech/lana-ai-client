/**
 * The first-launch screen's words and state (docs/plans/first-launch-local-ai-plan.md,
 * section 5, phase D). Pure: the page (first-launch.js) hands it the plan view from the main
 * process (electron-first-launch.js plan(), no file addresses) and the download status, and
 * draws what comes back. The sizing itself stays in local-ai-fit.model.js.
 *
 *   buildChoiceView(planView)   this computer, the chat model, the other choices, what LANA
 *                               adds by itself, and the space needed
 *   buildProgressView(status)   the downloads after Continue: file, bytes, pause, failed
 *   formatBytes(n)              "5.6 GB", "274 MB"
 *   createFirstLaunchController({ api, render })  the screen's steps, with the IPC calls passed in
 *
 * Copy rules: words a 6th grader can follow, "computer" and never a brand of device.
 */
(function (root) {
  'use strict';

  var fit = (typeof module !== 'undefined' && module.exports)
    ? require('./local-ai-fit.model')
    : root.LanaLocalAiFit;

  var KB = 1024;
  var MB = KB * 1024;
  var GB = MB * 1024;

  /** Plain size words, with the same 1024 steps the sizing uses (24 GB of memory reads "24 GB"). */
  function formatBytes(bytes) {
    var n = Number(bytes);
    if (!isFinite(n) || n <= 0) {return '0 MB';}
    if (n >= GB) {
      var gb = n / GB;
      return (gb >= 10 ? String(Math.round(gb)) : String(Math.round(gb * 10) / 10)) + ' GB';
    }
    if (n >= MB) {return String(Math.round(n / MB)) + ' MB';}
    return String(Math.max(1, Math.round(n / KB))) + ' KB';
  }

  /** "24 GB memory, Apple M4 Pro, 60 GB free" */
  function computerLine(computer) {
    if (!computer) {return '';}
    var parts = [];
    if (computer.memoryBytes) {parts.push(formatBytes(computer.memoryBytes) + ' memory');}
    if (computer.chip) {parts.push(computer.chip);}
    if (computer.graphicsMemoryBytes) {parts.push(formatBytes(computer.graphicsMemoryBytes) + ' graphics memory');}
    if (computer.freeDiskBytes != null) {parts.push(formatBytes(computer.freeDiskBytes) + ' free');}
    return parts.join(', ');
  }

  function choiceDescription(choice) {
    if (choice.fit === 'wont_fit') {return choice.reason || fit.fitLabel(choice.fit);}
    var parts = [fit.fitLabel(choice.fit) + '.', fit.remembersLabel(choice.contextTokens) + '.', formatBytes(choice.sizeBytes) + ' download.'];
    if (choice.slow && choice.reason) {parts.push(choice.reason);}
    return parts.join(' ');
  }

  /** One short line for each thing LANA sets up by itself. */
  function extrasLines(plan) {
    var lines = [];
    lines.push(plan.embedding && plan.embedding.where === 'local'
      ? { id: 'search', title: 'Search', text: 'Finds things in your files, on this computer.', included: true }
      : { id: 'search', title: 'Search', text: 'Uses the cloud.', included: false });
    lines.push(plan.vision && plan.vision.id
      ? { id: 'images', title: 'Image reading', text: 'Reads pictures and scanned pages.', included: true }
      : { id: 'images', title: 'Image reading', text: plan.chat && plan.chat.where === 'cloud' ? 'Uses the cloud, with chat.' : ((plan.vision && plan.vision.reason) || 'Not on this computer.'), included: false });
    lines.push(plan.speech && plan.speech.install
      ? { id: 'speech', title: 'Listening', text: 'Turns speech into text. Added after you sign in.', included: true }
      : { id: 'speech', title: 'Listening', text: (plan.speech && plan.speech.reason) || 'Not on this computer.', included: false });
    lines.push(plan.voice && plan.voice.install
      ? { id: 'voice', title: 'Speaking', text: 'Reads answers out loud. Added after you sign in.', included: true }
      : { id: 'voice', title: 'Speaking', text: (plan.voice && plan.voice.reason) || 'Not on this computer.', included: false });
    return lines;
  }

  function diskLine(download) {
    var needed = (download && download.neededBytes) || 0;
    if (!needed) {return 'Nothing to download. Everything LANA needs is already on this computer.';}
    var line = 'Needs ' + formatBytes(needed) + '.';
    if (download.freeBytes != null) {line += ' This computer has ' + formatBytes(download.freeBytes) + ' free.';}
    return line;
  }

  /**
   * What the choice screen shows.
   * @param {Object} view - electron-first-launch.js plan() result
   */
  function buildChoiceView(view) {
    var plan = view.plan || {};
    var cloud = !plan.chat || plan.chat.where === 'cloud';
    var choices = view.chatChoices || [];
    var selectedId = cloud ? null : plan.chat.id;
    var selected = choices.find(function (c) { return c.id === selectedId; }) || null;

    var chat;
    if (cloud || !selected) {
      chat = {
        cloud: true,
        heading: 'Chat uses the cloud',
        text: 'This computer is too small to run LANA\'s chat. You do not need to do anything.'
      };
    } else {
      chat = {
        cloud: false,
        id: selected.id,
        name: selected.name,
        size: formatBytes(selected.sizeBytes),
        fitText: fit.fitLabel(selected.fit),
        fitTone: selected.fit === 'comfortable' ? 'good' : 'tight',
        remembers: fit.remembersLabel(selected.contextTokens),
        where: 'Runs on this computer',
        recommended: selected.id === view.defaultChatId,
        note: selected.slow ? selected.reason : null
      };
    }

    var c = view.computer || {};
    var facts = [];
    if (c.memoryBytes) {facts.push({ label: 'Memory', value: formatBytes(c.memoryBytes) });}
    if (c.chip) {facts.push({ label: 'Chip', value: c.chip });}
    if (c.graphicsMemoryBytes) {facts.push({ label: 'Graphics memory', value: formatBytes(c.graphicsMemoryBytes) });}
    if (c.freeDiskBytes != null) {facts.push({ label: 'Free space', value: formatBytes(c.freeDiskBytes) });}

    return {
      computer: computerLine(view.computer),
      computerFacts: facts,
      chat: chat,
      // Nothing to choose when chat runs in the cloud.
      canChoose: !cloud && choices.some(function (c) { return c.fit !== 'wont_fit' && c.id !== selectedId; }),
      choices: cloud ? [] : choices.map(function (c) {
        return {
          value: c.id,
          label: c.name + (c.id === view.defaultChatId ? ' (recommended)' : ''),
          description: choiceDescription(c),
          disabled: c.fit === 'wont_fit'
        };
      }),
      selectedId: selectedId,
      extras: extrasLines(plan),
      disk: diskLine(view.download),
      continueLabel: 'Continue'
    };
  }

  var KIND_WORDS = { embedding: 'the search model', chat: 'the chat model', vision: 'the image reading file' };
  // The downloader's own messages are already plain; anything else gets a plain sentence.
  var PLAIN_CODES = { no_space: true, http: true, mismatch: true, too_big: true, stalled: true, not_allowed: true };

  function failedMessage(error) {
    if (error && PLAIN_CODES[error.code] && error.message) {return error.message;}
    return 'LANA could not save the files on this computer. Check that there is free space, then try again.';
  }

  /**
   * What the progress part shows after Continue.
   * @param {Object} status - electron-first-launch.js status(): phase, current, receivedBytes, totalBytes, error
   */
  function buildProgressView(status) {
    var s = status || {};
    var total = s.totalBytes || 0;
    var received = Math.min(s.receivedBytes || 0, total || Infinity);
    var percent = total ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : 0;
    var bytes = total ? formatBytes(received) + ' of ' + formatBytes(total) : '';
    var current = s.current ? 'Now getting ' + (KIND_WORDS[s.current.kind] || 'a file') + (s.current.name ? ', ' + s.current.name : '') + '.' : '';
    // mark: the LANA brand animation for the state (lex-brand-mark). note: what signing in now
    // means, true for that state only (a stopped download does not "keep going").
    // header: the page's eyebrow, headline and line above the card, which follow the state so a
    // finished setup does not still say it is getting ready.
    var SETTING_UP = { eyebrow: 'Setting up', title: 'Getting LANA ', accent: 'ready', detail: 'This happens once.' };
    var base = { phase: s.phase || 'idle', percent: percent, bytes: bytes, current: '', error: null, canPause: false, canResume: false, canRetry: false, tone: 'normal', mark: 'spinner', note: '', header: SETTING_UP };
    var KEEPS_GOING = 'The download keeps going in the background after you sign in.';

    switch (s.phase) {
      case 'downloading':
        return Object.assign(base, { heading: 'Downloading', current: current || 'Getting the files ready.', canPause: true, note: KEEPS_GOING });
      case 'checking':
        return Object.assign(base, { heading: 'Checking the files', current: 'Making sure every file is complete.', percent: total ? percent : 100, note: KEEPS_GOING });
      case 'paused':
        return Object.assign(base, { heading: 'Paused', current: 'What has downloaded so far is saved.', canResume: true, mark: 'idle', note: 'If you sign in now, LANA picks up again next time it opens.' });
      case 'failed':
        return Object.assign(base, { heading: 'The download stopped', error: failedMessage(s.error), canRetry: true, tone: 'danger', mark: 'idle', note: 'If you sign in now, LANA tries again next time it opens.' });
      case 'ready':
        return Object.assign(base, { heading: 'Every file is in place and checked', percent: 100, current: '', tone: 'good', mark: 'success', note: '', header: { eyebrow: 'All set', title: 'LANA is ', accent: 'ready', detail: '' } });
      default:
        return Object.assign(base, { heading: 'Getting ready', current: 'Starting the downloads.', note: KEEPS_GOING });
    }
  }

  /**
   * The "already on this computer" choice. found: electron-first-launch.js findExisting()
   * ({ id, kind, name, bytes, source }). Null when nothing usable was found.
   */
  function buildFoundView(found) {
    var list = Array.isArray(found) ? found : [];
    if (!list.length) {return null;}
    var names = list.map(function (f) { return f.kind === 'chat' ? f.name : (KIND_WORDS[f.kind] || f.name); });
    var joined = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    var saves = formatBytes(list.reduce(function (sum, f) { return sum + (f.bytes || 0); }, 0));
    var one = list.length === 1;
    return {
      text: 'Found ' + joined + ' already on this computer. Use ' + (one ? 'it' : 'them') + '? Saves ' + saves + '.',
      saves: saves,
      options: [
        { value: 'use', label: 'Use ' + (one ? 'it' : 'them'), description: 'LANA leaves the original ' + (one ? 'file' : 'files') + ' where ' + (one ? 'it is' : 'they are') + '.' },
        { value: 'download', label: 'Download ' + (one ? 'a new copy' : 'new copies'), description: 'Takes longer and uses ' + saves + ' more space.' }
      ]
    };
  }

  /**
   * The screen's steps. api is window.electronAPI.firstLaunch (electron-preload.js); render
   * gets { mode: 'loading'|'choose'|'progress', choice, progress, error }.
   */
  function createFirstLaunchController(options) {
    var api = options.api;
    var render = options.render;
    // found: null while LANA is still looking (findExisting), then a list (maybe empty).
    var state = { mode: 'loading', planView: null, status: null, error: null, busy: false, found: null, useExisting: true };
    var finding = null;

    function draw() {
      render({
        mode: state.mode,
        busy: state.busy,
        error: state.error,
        choice: state.planView ? buildChoiceView(state.planView) : null,
        progress: buildProgressView(state.status),
        looking: state.found === null,
        found: state.found ? buildFoundView(state.found) : null,
        useExisting: state.useExisting
      });
    }

    function unwrap(result) {
      if (!result || result.success === false) {throw new Error((result && result.error) || 'LANA could not read this computer.');}
      return result;
    }

    /** Look for model files already on this computer; resolves with the list (empty on error). */
    function findExisting() {
      if (!finding) {
        finding = (api.findExisting ? api.findExisting().then(unwrap).then(function (r) { return r.found || []; }) : Promise.resolve([]))
          .catch(function () { return []; })
          .then(function (found) { state.found = found; draw(); return found; });
      }
      return finding;
    }

    function setUseExisting(use) {
      state.useExisting = Boolean(use);
      draw();
    }

    function load() {
      draw();
      return api.getPlan().then(unwrap).then(function (result) {
        state.planView = result.plan;
        state.status = result.plan.status;
        state.mode = result.plan.acceptedAt ? 'progress' : 'choose';
        state.error = null;
        draw();
        if (state.mode === 'choose') {findExisting();}
      }).catch(function (error) {
        state.error = error.message;
        draw();
      });
    }

    /** The person picked a chat model. LANA's own default is saved as "no choice". */
    function pick(chatId) {
      if (!state.planView || state.busy) {return Promise.resolve();}
      var current = state.planView.plan.chat && state.planView.plan.chat.id;
      if (chatId === current) {return Promise.resolve();}
      state.busy = true;
      draw();
      var saved = chatId === state.planView.defaultChatId ? null : chatId;
      return api.choose(saved).then(unwrap).then(function (result) {
        state.planView = result.plan;
        state.busy = false;
        draw();
      }).catch(function (error) {
        state.busy = false;
        state.error = error.message;
        draw();
      });
    }

    function onStatus(status) {
      state.status = status;
      if (state.mode === 'progress') {draw();}
    }

    function proceed() {
      if (state.busy) {return Promise.resolve();}
      state.busy = true;
      draw();
      var useExisting = Boolean(state.found && state.found.length && state.useExisting);
      return api.continue({ useExisting: useExisting }).then(unwrap).then(function (result) {
        state.status = result.status || state.status;
        state.mode = 'progress';
        state.busy = false;
        draw();
      }).catch(function (error) {
        state.busy = false;
        state.error = error.message;
        draw();
      });
    }

    function simple(call) {
      return function () {
        return call().then(unwrap).then(function (result) {
          if (result.status) {state.status = result.status;}
          draw();
        }).catch(function (error) {
          state.error = error.message;
          draw();
        });
      };
    }

    return {
      load: load,
      findExisting: findExisting,
      setUseExisting: setUseExisting,
      pick: pick,
      proceed: proceed,
      pause: simple(function () { return api.pause(); }),
      resume: simple(function () { return api.resume(); }),
      onStatus: onStatus,
      redraw: draw,
      state: function () { return state; }
    };
  }

  var api = {
    formatBytes: formatBytes,
    computerLine: computerLine,
    buildChoiceView: buildChoiceView,
    buildProgressView: buildProgressView,
    buildFoundView: buildFoundView,
    createFirstLaunchController: createFirstLaunchController
  };
  if (typeof module !== 'undefined' && module.exports) {module.exports = api;}
  else {root.LanaFirstLaunch = api;}
})(typeof window !== 'undefined' ? window : this);

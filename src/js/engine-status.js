/**
 * Local AI engine status for the renderer (local-ai-engine plan, phase 6).
 *
 * Pure mapping from the engine's state (pushed by the main process) and from
 * the engine's problem+json refusals to what the person sees, plus a small
 * banner controller. The backend owns the wording of refusals: a problem's
 * `detail` is shown as written.
 *
 * States:
 * - direct: no local engine; nothing to show.
 * - ok: engine healthy and connected to the organization's server.
 * - restarting: engine process down or not answering; the supervisor restarts it.
 * - chef_unavailable: engine up, organization's server not reachable; the engine retries.
 * - version_refused: data API versions out of range; never retried.
 *
 * Loaded as a classic script (window.LanaEngineStatus) and under Jest (module.exports).
 */
(function (global) {
  'use strict';

  if (global.LanaEngineStatus) {
    if (typeof module !== 'undefined' && module.exports) module.exports = global.LanaEngineStatus;
    return;
  }

  var CODES = {
    VERSION_UNSUPPORTED: 'DATA_API_VERSION_UNSUPPORTED',
    CHEF_UNAVAILABLE: 'CHEF_UNAVAILABLE',
    CHEF_UNREACHABLE: 'CHEF_UNREACHABLE',
    CHEF_TIMEOUT: 'CHEF_TIMEOUT'
  };

  var MESSAGES = {
    restarting: 'Restarting LANA\'s AI service',
    chef_unavailable: 'Can\'t reach your organization\'s server, retrying',
    // Fallback only: the engine's own detail is preferred.
    version_refused: 'This copy of LANA is older than your organization\'s server supports. Update LANA to keep working.'
  };

  // A refusal seen on a request stays on screen at least this long, so a
  // health push that races it does not flash the banner away.
  var PROBLEM_HOLD_MS = 3000;

  /**
   * @param {number} httpStatus
   * @param {Object|null} body - parsed response body
   * @returns {{ state: string, code: string, message: string, retry: boolean }|null}
   */
  function classifyProblem(httpStatus, body) {
    var code = body && typeof body.code === 'string' ? body.code : '';
    var detail = body && typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim() : '';
    if (httpStatus === 426 && code === CODES.VERSION_UNSUPPORTED) {
      return { state: 'version_refused', code: code, message: detail || MESSAGES.version_refused, retry: false };
    }
    if (httpStatus === 503 && code === CODES.CHEF_UNAVAILABLE) {
      return { state: 'chef_unavailable', code: code, message: MESSAGES.chef_unavailable, detail: detail, retry: true };
    }
    if ((httpStatus === 502 && code === CODES.CHEF_UNREACHABLE) || (httpStatus === 504 && code === CODES.CHEF_TIMEOUT)) {
      return { state: 'chef_unavailable', code: code, message: MESSAGES.chef_unavailable, detail: detail, retry: true };
    }
    return null;
  }

  /**
   * @param {Object|null} status - main-process engine status (electron-local-engine statusView)
   * @returns {{ state: string, message: string }}
   */
  function describeEngineStatus(status) {
    if (!status || !status.inUse) return { state: 'direct', message: '' };
    var health = status.health;
    if (status.process !== 'running' || !status.healthy || !health) {
      return { state: 'restarting', message: MESSAGES.restarting };
    }
    if (health.version && health.version.status === 'unsupported') {
      return { state: 'version_refused', message: health.version.detail || MESSAGES.version_refused };
    }
    // reachable_now (phase 10): the engine's link stays ready after its first
    // handshake, so a server that went away later shows here.
    if (!health.chef || health.chef.status !== 'ready' || health.chef.reachable_now === false) {
      return { state: 'chef_unavailable', message: MESSAGES.chef_unavailable };
    }
    return { state: 'ok', message: '' };
  }

  function isQuiet(state) {
    return state === 'ok' || state === 'direct';
  }

  /**
   * Rows for the Settings "Local AI service" card.
   * @param {Object|null} status
   */
  function settingsView(status) {
    var described = describeEngineStatus(status);
    if (!status || !status.configured) {
      return {
        available: false,
        statusLabel: 'Not installed',
        tone: 'gray',
        rows: [],
        note: 'The local AI engine is not installed on this computer, so LANA\'s AI runs on your organization\'s server.',
        showToggle: false,
        showBackgroundJobs: false,
        showRestart: false
      };
    }
    if (!status.inUse) {
      var offLabel = status.reason === 'engine_not_found' ? 'Engine files not found'
        : status.reason === 'no_server' ? 'Waiting for your organization' : 'Off';
      return {
        available: true,
        statusLabel: offLabel,
        tone: 'gray',
        rows: [],
        note: status.reason === 'engine_not_found'
          ? 'The local AI engine is not installed where LANA expects it, so LANA\'s AI runs on your organization\'s server.'
          : 'LANA\'s AI runs on your organization\'s server, and so do your background jobs.',
        showToggle: true,
        showBackgroundJobs: false,
        showRestart: false
      };
    }
    var labels = {
      ok: 'Running',
      restarting: 'Restarting',
      chef_unavailable: 'Running, server not reachable',
      version_refused: 'Version not supported'
    };
    var tones = { ok: 'green', restarting: 'blue', chef_unavailable: 'yellow', version_refused: 'red' };
    var health = status.health || {};
    var chef = health.chef || null;
    var dataApi = health.data_api || null;
    var range = '';
    if (dataApi) {
      range = 'Speaks ' + dataApi.version + ', needs server ' + dataApi.min_server + ' or later';
      // A refused handshake reports Chef's versions on the verdict instead.
      var version = health.version || {};
      var chefApi = (chef && chef.api) || version.chef;
      var chefMin = (chef && chef.min_client) || version.chef_min_client;
      if (chefApi) range += '; server speaks ' + chefApi + ', accepts ' + chefMin + ' or later';
    }
    return {
      available: true,
      statusLabel: labels[described.state] || 'Unknown',
      tone: tones[described.state] || 'gray',
      message: isQuiet(described.state) ? '' : described.message,
      rows: [
        { label: 'Port', value: status.port ? String(status.port) : 'Not assigned' },
        { label: 'Organization server', value: chef && described.state !== 'restarting' ? (chef.reachable ? 'Reachable' : 'Not reachable') : 'Unknown' },
        { label: 'Data API versions', value: range || 'Unknown' }
      ],
      note: '',
      showToggle: true,
      showBackgroundJobs: true,
      showRestart: true
    };
  }

  /**
   * Banner controller. One instance per page (window.LanaEngineStatus.mount).
   * @param {Object} options
   * @param {Function} options.render - ({ state, message, visible }) => void
   * @param {Function} [options.now]
   */
  function createController(options) {
    var render = options.render;
    var now = options.now || function () { return Date.now(); };
    var fromStatus = { state: 'direct', message: '' };
    var problem = null; // { state, message, at }

    function current() {
      if (problem) return { state: problem.state, message: problem.message };
      return fromStatus;
    }

    function draw() {
      var shown = current();
      render({ state: shown.state, message: shown.message, visible: !isQuiet(shown.state) });
    }

    return {
      /** Engine state pushed by the main process. */
      update: function (status) {
        fromStatus = describeEngineStatus(status);
        // A request refusal is dropped when health explains the state itself,
        // when the engine is no longer in use, or when health has said ok
        // again after the hold time.
        if (problem && (!isQuiet(fromStatus.state) || fromStatus.state === 'direct' || now() - problem.at >= PROBLEM_HOLD_MS)) {
          problem = null;
        }
        draw();
      },
      /** A refusal seen on a request. Returns the classification (or null). */
      reportProblem: function (httpStatus, body) {
        var classified = classifyProblem(httpStatus, body);
        if (!classified) return null;
        problem = { state: classified.state, message: classified.message, at: now() };
        draw();
        return classified;
      },
      current: current
    };
  }

  // ── DOM banner ──────────────────────────────────────────────────────────

  var controller = null;

  function renderBanner(doc, view) {
    var banner = doc.getElementById('lana-engine-banner');
    if (!banner) {
      banner = doc.createElement('div');
      banner.id = 'lana-engine-banner';
      banner.className = 'lana-engine-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');
      var dot = doc.createElement('span');
      dot.className = 'lana-engine-banner__indicator';
      dot.setAttribute('aria-hidden', 'true');
      var text = doc.createElement('span');
      text.className = 'lana-engine-banner__text';
      banner.appendChild(dot);
      banner.appendChild(text);
      doc.body.appendChild(banner);
    }
    banner.setAttribute('data-state', view.state);
    banner.querySelector('.lana-engine-banner__text').textContent = view.message;
    banner.classList.toggle('lana-engine-banner--visible', view.visible);
    // lex-app hides its generic "unable to reach the server" banner while
    // this one explains the state.
    if (view.visible) doc.documentElement.setAttribute('data-lana-engine-banner', view.state);
    else doc.documentElement.removeAttribute('data-lana-engine-banner');
  }

  /**
   * Mount the banner on this page and follow the main process's engine state.
   * @param {Object} engineApi - window.electronAPI.engine
   */
  /**
   * Phase 10: while the organization's server cannot be reached, say that
   * LANA answers from this computer's offline copy (and as of when), from the
   * engine's GET /api/engine/v1/offline/status. Without a copy the banner
   * keeps its own words.
   */
  var OFFLINE_STATUS_PATH = '/api/engine/v1/offline/status';
  var OFFLINE_REFRESH_MS = 30000;
  var offlineFetchedAt = 0;

  function withOfflineCopy(view) {
    var offline = global.LanaOfflineCopy;
    if (view.state !== 'chef_unavailable' || !offline) return view;
    var sentence = offline.bannerMessage(offline.lastStatus);
    return sentence ? { state: 'offline_copy', message: sentence, visible: true } : view;
  }

  function refreshOfflineCopy(done) {
    var offline = global.LanaOfflineCopy;
    var client = global.api;
    if (!offline || !client || typeof client.get !== 'function') return;
    if (Date.now() - offlineFetchedAt < OFFLINE_REFRESH_MS) return;
    offlineFetchedAt = Date.now();
    client.get(OFFLINE_STATUS_PATH).then(function (status) {
      offline.lastStatus = status;
      done();
    }).catch(function () {});
  }

  function mount(engineApi) {
    if (controller || !engineApi || typeof document === 'undefined') return controller;
    var doc = document;
    controller = createController({
      render: function (view) {
        if (!doc.body) return;
        renderBanner(doc, withOfflineCopy(view));
        if (view.state === 'chef_unavailable') {
          refreshOfflineCopy(function () { renderBanner(doc, withOfflineCopy(view)); });
        }
      }
    });
    api.reportProblem = controller.reportProblem;
    if (typeof engineApi.onState === 'function') engineApi.onState(controller.update);
    if (typeof engineApi.getStatus === 'function') {
      engineApi.getStatus().then(function (result) {
        if (result && result.success) controller.update(result.status);
      }).catch(function () {});
    }
    return controller;
  }

  var api = {
    CODES: CODES,
    MESSAGES: MESSAGES,
    PROBLEM_HOLD_MS: PROBLEM_HOLD_MS,
    classifyProblem: classifyProblem,
    describeEngineStatus: describeEngineStatus,
    settingsView: settingsView,
    createController: createController,
    withOfflineCopy: withOfflineCopy,
    mount: mount,
    // Before mount (or outside Electron): classify only, nothing drawn.
    reportProblem: classifyProblem
  };

  global.LanaEngineStatus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

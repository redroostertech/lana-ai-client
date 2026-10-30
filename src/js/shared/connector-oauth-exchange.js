/*
 * ConnectorOAuth - the Electron OAuth deep link callback for org connectors.
 *
 * The main process forwards lana-ai://oauth/callback to the renderer through
 * electronAPI.onOAuthCallback. The connector viewer and the Guided Connect
 * wizard both finish an org connector's authorization the same way: POST the
 * code and state to /api/v1/integrations/oauth/exchange. That call lives here
 * so there is one copy.
 *
 * The preload's onOAuthCallback adds an IPC listener and offers no way to
 * remove it, so subscribe() registers one listener per window and fans the
 * callback out to whoever is subscribed at that moment.
 *
 * Loaded as a browser global (window.ConnectorOAuth) and as CommonJS for Jest.
 */
(function (global) {
  'use strict';

  var DEFAULT_REDIRECT_URI = 'lana-ai://oauth/callback';

  // The preload does not run inside iframes, so an embedded page reaches the
  // parent's bridge (same origin under file://).
  function resolveElectronAPI(win) {
    var w = win || global;
    if (!w) return null;
    if (w.electronAPI) return w.electronAPI;
    try {
      if (w.parent && w.parent !== w && w.parent.electronAPI) return w.parent.electronAPI;
    } catch (_error) {
      return null;
    }
    return null;
  }

  function isCallbackPayload(data) {
    return !!data && typeof data === 'object' && !!(data.code || data.error);
  }

  /**
   * Exchange the callback code for tokens (org connectors).
   * @param {Object} api - window.api
   * @param {Object} params
   * @param {Object} params.data - the callback payload ({ code, state, realmId })
   * @param {string} params.connectorType
   * @param {string} [params.redirectUri] - the redirect_uri the authorize call used
   * @returns {Promise<Object>} the exchange response
   */
  function exchangeCode(api, params) {
    var data = params.data || {};
    return api.post('/api/v1/integrations/oauth/exchange', {
      code: data.code,
      state: data.state,
      provider: params.connectorType,
      connectorId: params.connectorType,
      redirectUri: params.redirectUri || DEFAULT_REDIRECT_URI,
      realmId: data.realmId || data.realm_id
    });
  }

  /** The state parameter of an authorization URL, or ''. */
  function stateFromAuthorizationUrl(url) {
    try {
      return new URL(String(url || '')).searchParams.get('state') || '';
    } catch (_error) {
      return '';
    }
  }

  var subscribers = [];
  var registered = false;

  function dispatch(data) {
    subscribers.slice().forEach(function (handler) {
      try {
        handler(data);
      } catch (error) {
        if (global && global.console) global.console.error('[ConnectorOAuth] Callback handler failed:', error && error.message);
      }
    });
  }

  /**
   * Receive OAuth callbacks. Returns an unsubscribe function, or null when the
   * Electron bridge is not available (web build).
   */
  function subscribe(handler, win) {
    var electronAPI = resolveElectronAPI(win);
    if (!electronAPI || typeof electronAPI.onOAuthCallback !== 'function' || typeof handler !== 'function') {
      return null;
    }
    if (!registered) {
      electronAPI.onOAuthCallback(dispatch);
      registered = true;
    }
    subscribers.push(handler);
    return function unsubscribe() {
      var index = subscribers.indexOf(handler);
      if (index !== -1) subscribers.splice(index, 1);
    };
  }

  function nowMs() {
    var time = global && global.LanaTime;
    return time && typeof time.nowMs === 'function' ? time.nowMs() : Date.now();
  }

  /**
   * Wait for a sign in started in the browser: listen for the deep link
   * callback (matched on state) and poll the backend until it says the sign
   * in finished, up to a time limit. Opens the URL. Used by the connect
   * wizard and the MCP server screens, so the waiting logic has one copy.
   *
   * @param {Object} opts
   * @param {string} opts.url - the authorization URL to open
   * @param {string} [opts.expectedState] - callbacks with another state are ignored
   * @param {Function} [opts.subscribe] - (handler) => unsubscribe | null
   * @param {Function} opts.openExternal - (url) opens the browser
   * @param {Function} opts.onCallback - (data) => Promise<result>, for a matching
   *   callback; a truthy result finishes
   * @param {Function} opts.poll - () => Promise<result>; a truthy result finishes
   * @param {Function} opts.onFinished - (result) after a truthy callback or poll
   * @param {Function} opts.onError - (error) for a callback error or failure
   * @param {Function} opts.onTimeout - () after limitMs without a result
   * @param {number} [opts.intervalMs=2000]
   * @param {number} [opts.limitMs=120000]
   * @returns {{stop: Function, isActive: Function, reopen: Function}}
   */
  function waitForSignIn(opts) {
    var interval = opts.intervalMs || 2000;
    var limit = opts.limitMs || 120000;
    var startedAt = nowMs();
    var active = true;
    var timer = null;
    var unsubscribe = null;

    function stop() {
      if (!active) return;
      active = false;
      if (timer) clearTimeout(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
    }

    if (typeof opts.subscribe === 'function') {
      unsubscribe = opts.subscribe(function (data) {
        if (!active || !isCallbackPayload(data)) return;
        if (opts.expectedState && data.state && data.state !== opts.expectedState) return;
        if (data.error) {
          stop();
          opts.onError(new Error(String(data.error_description || data.error)));
          return;
        }
        Promise.resolve().then(function () { return opts.onCallback(data); }).then(function (result) {
          if (!active || !result) return;
          stop();
          opts.onFinished(result);
        }, function (error) {
          if (!active) return;
          stop();
          opts.onError(error);
        });
      });
    }

    function schedule() {
      if (active) timer = setTimeout(tick, interval);
    }

    function tick() {
      if (!active) return;
      if (nowMs() - startedAt > limit) {
        stop();
        opts.onTimeout();
        return;
      }
      Promise.resolve().then(opts.poll).then(function (result) {
        if (!active) return;
        if (result) {
          stop();
          opts.onFinished(result);
        } else {
          schedule();
        }
      }).catch(schedule);
    }

    schedule();
    opts.openExternal(opts.url);

    return {
      stop: stop,
      isActive: function () { return active; },
      reopen: function () { if (active) opts.openExternal(opts.url); }
    };
  }

  var api = {
    DEFAULT_REDIRECT_URI: DEFAULT_REDIRECT_URI,
    resolveElectronAPI: resolveElectronAPI,
    isCallbackPayload: isCallbackPayload,
    exchangeCode: exchangeCode,
    stateFromAuthorizationUrl: stateFromAuthorizationUrl,
    subscribe: subscribe,
    waitForSignIn: waitForSignIn
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ConnectorOAuth = api;
  }
})(typeof window !== 'undefined' ? window : this);

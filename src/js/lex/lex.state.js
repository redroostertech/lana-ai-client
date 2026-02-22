/* ==========================================================================
   Lex UI — App State
   Centralized state for auth, connection, and active context.
   Extends EventTarget for reactive change notifications.

   Three state slices:
     1. Auth        — token, user, isAuthenticated, isTokenExpired
     2. Connection   — baseUrl, serverInfo, isReachable
     3. Context      — activeMatterId, activeConversationId

   Usage:
     Lex.state.on('auth:changed', (e) => console.log(e.detail))
     Lex.state.isAuthenticated  // true/false
     Lex.state.setActiveMatter('abc-123')
   ========================================================================== */

(function (global) {
  'use strict';

  // =========================================================================
  // LexState — Reactive state container
  // =========================================================================

  class LexState extends EventTarget {

    constructor() {
      super();

      // -- Auth slice --
      this._token = null;
      this._user = null;

      // -- Connection slice --
      this._baseUrl = '';
      this._serverInfo = null;
      this._isReachable = true;
      this._lastHealthCheck = null;

      // -- Context slice --
      this._activeMatterId = null;
      this._activeConversationId = null;

      // Saved property descriptors for cleanup
      this._interceptedProps = new Map();

      // Hydrate from api + localStorage
      this._hydrate();

      // Intercept api.js property writes for instant change detection (no polling)
      this._interceptApiProperties();
    }

    // -----------------------------------------------------------------------
    // Auth getters
    // -----------------------------------------------------------------------

    get token() { return this._token; }
    get user() { return this._user; }

    get isAuthenticated() {
      return !!this._token;
    }

    get isTokenExpired() {
      if (typeof window.api !== 'undefined' && window.api && typeof window.api.isTokenExpired === 'function') {
        return window.api.isTokenExpired();
      }
      return false;
    }

    // -----------------------------------------------------------------------
    // Connection getters
    // -----------------------------------------------------------------------

    get baseUrl() { return this._baseUrl; }
    get serverInfo() { return this._serverInfo; }
    get isReachable() { return this._isReachable; }
    get lastHealthCheck() { return this._lastHealthCheck; }

    // -----------------------------------------------------------------------
    // Context getters
    // -----------------------------------------------------------------------

    get activeMatterId() { return this._activeMatterId; }
    get activeConversationId() { return this._activeConversationId; }

    // -----------------------------------------------------------------------
    // Auth setters
    // -----------------------------------------------------------------------

    setAuth(token, user) {
      var changed = this._token !== token;
      this._token = token;
      this._user = user;

      // Sync back to api and localStorage. The interceptor will see
      // the same value we already set on _token/_user, so the
      // !== check in the interceptor callback prevents double-firing.
      if (typeof window.api !== 'undefined' && window.api) {
        window.api.token = token;
        window.api.user = user;
      }
      if (token) {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
      }

      if (changed) {
        this._emit('auth:changed', { token: token, user: user, isAuthenticated: !!token });
      }
    }

    clearAuth() {
      var had = !!this._token;
      this._token = null;
      this._user = null;

      // Interceptor won't double-fire: _token is already null before
      // api.token is set, so the !== check in the callback is a no-op.
      if (typeof window.api !== 'undefined' && window.api) {
        window.api.token = null;
        window.api.user = null;
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      if (had) {
        this._emit('auth:changed', { token: null, user: null, isAuthenticated: false });
      }
    }

    // -----------------------------------------------------------------------
    // Connection setters
    // -----------------------------------------------------------------------

    setReachability(reachable) {
      var was = this._isReachable;
      this._isReachable = reachable;
      this._lastHealthCheck = Date.now();

      if (was !== reachable) {
        this._emit('connection:changed', {
          isReachable: reachable,
          baseUrl: this._baseUrl,
          lastHealthCheck: this._lastHealthCheck
        });
      }
    }

    setServerInfo(info) {
      this._serverInfo = info;
      if (info && info.url) {
        this._baseUrl = info.url;
      }
      this._emit('connection:changed', {
        isReachable: this._isReachable,
        baseUrl: this._baseUrl,
        serverInfo: info
      });
    }

    // -----------------------------------------------------------------------
    // Context setters
    // -----------------------------------------------------------------------

    setActiveMatter(matterId) {
      if (this._activeMatterId === matterId) return;
      this._activeMatterId = matterId;
      this._emit('context:changed', { property: 'activeMatterId', value: matterId });
    }

    setActiveConversation(conversationId) {
      if (this._activeConversationId === conversationId) return;
      this._activeConversationId = conversationId;
      this._emit('context:changed', { property: 'activeConversationId', value: conversationId });
    }

    // -----------------------------------------------------------------------
    // Event convenience methods
    // -----------------------------------------------------------------------

    on(eventName, handler) {
      this.addEventListener(eventName, handler);
    }

    off(eventName, handler) {
      this.removeEventListener(eventName, handler);
    }

    // -----------------------------------------------------------------------
    // Internal: hydrate from localStorage + api
    // -----------------------------------------------------------------------

    _hydrate() {
      // Auth — read from api first, fallback to localStorage
      if (typeof window.api !== 'undefined' && window.api) {
        this._token = window.api.token || null;
        this._user = window.api.user || null;
        this._baseUrl = window.api.baseUrl || '';
      } else {
        this._token = localStorage.getItem('token') || null;
        try {
          this._user = JSON.parse(localStorage.getItem('user') || 'null');
        } catch (e) {
          this._user = null;
        }
      }

      // Connection — server info
      try {
        var savedServer = localStorage.getItem('lana_saved_server');
        if (savedServer) {
          this._serverInfo = JSON.parse(savedServer);
          if (this._serverInfo && this._serverInfo.url && !this._baseUrl) {
            this._baseUrl = this._serverInfo.url;
          }
        }
      } catch (e) {
        this._serverInfo = null;
      }
    }

    // -----------------------------------------------------------------------
    // Internal: intercept api.js property writes (zero-cost, instant)
    // -----------------------------------------------------------------------

    /**
     * Uses Object.defineProperty on the api instance to intercept writes
     * to token, user, and baseUrl. This fires events the instant a value
     * changes — no polling timers needed.
     */
    _interceptApiProperties() {
      if (typeof window.api === 'undefined' || !window.api) return;

      var self = this;

      this._interceptProperty(window.api, 'token', function (newVal) {
        var val = newVal || null;
        if (val !== self._token) {
          self._token = val;
          self._user = window.api.user || null;
          self._emit('auth:changed', {
            token: self._token,
            user: self._user,
            isAuthenticated: !!self._token
          });
        }
      });

      this._interceptProperty(window.api, 'user', function (newVal) {
        var val = newVal || null;
        if (val !== self._user) {
          self._user = val;
          self._emit('auth:changed', {
            token: self._token,
            user: self._user,
            isAuthenticated: !!self._token
          });
        }
      });

      this._interceptProperty(window.api, 'baseUrl', function (newVal) {
        var val = newVal || '';
        if (val !== self._baseUrl) {
          self._baseUrl = val;
          self._emit('connection:changed', {
            isReachable: self._isReachable,
            baseUrl: self._baseUrl
          });
        }
      });
    }

    /**
     * Redefine a plain instance property as a getter/setter pair.
     * The setter calls onChange(newValue) before storing the value.
     */
    _interceptProperty(obj, prop, onChange) {
      var currentValue = obj[prop];

      // Save original descriptor for restoration in destroy()
      var originalDescriptor = Object.getOwnPropertyDescriptor(obj, prop);
      this._interceptedProps.set(prop, { obj: obj, descriptor: originalDescriptor, value: currentValue });

      Object.defineProperty(obj, prop, {
        get: function () { return currentValue; },
        set: function (val) {
          currentValue = val;
          onChange(val);
        },
        configurable: true,
        enumerable: true
      });
    }

    // -----------------------------------------------------------------------
    // Internal: emit custom event
    // -----------------------------------------------------------------------

    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    destroy() {
      // Restore intercepted api properties to their original descriptors
      this._interceptedProps.forEach(function (entry, prop) {
        if (entry.descriptor) {
          Object.defineProperty(entry.obj, prop, entry.descriptor);
        } else {
          // Property was a simple value (no prior descriptor)
          entry.obj[prop] = entry.value;
        }
      });
      this._interceptedProps.clear();
    }
  }

  // =========================================================================
  // Export as singleton
  // =========================================================================

  global.Lex = global.Lex || {};
  global.Lex.state = new LexState();

})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================================
   Lex UI — App State
   Centralized state management for the LANA AI SPA shell.
   Extends EventTarget for reactive change notifications.

   Four state slices:
     1. Auth        — token, user, isAuthenticated, isTokenExpired
     2. Connection   — baseUrl, serverInfo, isReachable
     3. UI           — activeMatterId, activeConversationId, sidebar, theme
     4. Chat/Agentic — chatMode, persona, streaming, agentic progress

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

      // -- UI slice --
      this._activeMatterId = null;
      this._activeConversationId = null;
      this._sidebarCollapsed = false;
      this._theme = 'light';

      // -- Chat/Agentic slice --
      this._chatMode = 'general';
      this._agentPersona = 'default';
      this._isStreaming = false;
      this._isAgenticActive = false;
      this._agenticPhase = null;
      this._agenticProgress = null;
      this._activeDocuments = [];
      this._forceAgentic = false;

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
      if (typeof api !== 'undefined' && api && typeof api.isTokenExpired === 'function') {
        return api.isTokenExpired();
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
    // UI getters
    // -----------------------------------------------------------------------

    get activeMatterId() { return this._activeMatterId; }
    get activeConversationId() { return this._activeConversationId; }
    get sidebarCollapsed() { return this._sidebarCollapsed; }
    get theme() { return this._theme; }

    // -----------------------------------------------------------------------
    // Chat/Agentic getters
    // -----------------------------------------------------------------------

    get chatMode() { return this._chatMode; }
    get agentPersona() { return this._agentPersona; }
    get isStreaming() { return this._isStreaming; }
    get isAgenticActive() { return this._isAgenticActive; }
    get agenticPhase() { return this._agenticPhase; }
    get agenticProgress() { return this._agenticProgress; }
    get activeDocuments() { return this._activeDocuments; }
    get forceAgentic() { return this._forceAgentic; }

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
      if (typeof api !== 'undefined' && api) {
        api.token = token;
        api.user = user;
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
      if (typeof api !== 'undefined' && api) {
        api.token = null;
        api.user = null;
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
    // UI setters
    // -----------------------------------------------------------------------

    setActiveMatter(matterId) {
      if (this._activeMatterId === matterId) return;
      this._activeMatterId = matterId;
      // Not persisted to localStorage — transient UI state, not a user preference.
      // Resets on page navigation and refresh by design.
      this._emit('ui:changed', { property: 'activeMatterId', value: matterId });
    }

    setActiveConversation(conversationId) {
      if (this._activeConversationId === conversationId) return;
      this._activeConversationId = conversationId;
      // Not persisted to localStorage — transient UI state, not a user preference.
      this._emit('ui:changed', { property: 'activeConversationId', value: conversationId });
    }

    setSidebarCollapsed(collapsed) {
      if (this._sidebarCollapsed === collapsed) return;
      this._sidebarCollapsed = collapsed;
      localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
      this._emit('ui:changed', { property: 'sidebarCollapsed', value: collapsed });
    }

    setTheme(theme) {
      if (this._theme === theme) return;
      this._theme = theme;
      localStorage.setItem('theme', theme);
      this._emit('ui:changed', { property: 'theme', value: theme });
    }

    // -----------------------------------------------------------------------
    // Chat/Agentic setters
    // -----------------------------------------------------------------------

    setChatMode(mode) {
      if (this._chatMode === mode) return;
      this._chatMode = mode;
      localStorage.setItem('chatMode', mode);
      this._emit('chat:changed', { property: 'chatMode', chatMode: mode });
    }

    setAgentPersona(persona) {
      if (this._agentPersona === persona) return;
      this._agentPersona = persona;
      this._emit('chat:changed', { property: 'agentPersona', agentPersona: persona });
    }

    setStreaming(active) {
      if (this._isStreaming === active) return;
      this._isStreaming = active;
      this._emit('chat:streaming', { isStreaming: active });
    }

    setAgenticPhase(phase, progress) {
      this._agenticPhase = phase;
      this._agenticProgress = progress || null;
      this._isAgenticActive = !!phase && phase !== 'complete';
      this._emit('chat:agentic', {
        phase: phase,
        progress: this._agenticProgress,
        isAgenticActive: this._isAgenticActive
      });
    }

    setActiveDocuments(docs) {
      this._activeDocuments = Array.isArray(docs) ? docs : [];
      this._emit('chat:changed', { property: 'activeDocuments', activeDocuments: this._activeDocuments });
    }

    setForceAgentic(enabled) {
      if (this._forceAgentic === enabled) return;
      this._forceAgentic = enabled;
      this._emit('chat:changed', { property: 'forceAgentic', forceAgentic: enabled });
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
      if (typeof api !== 'undefined' && api) {
        this._token = api.token || null;
        this._user = api.user || null;
        this._baseUrl = api.baseUrl || '';
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

      // UI preferences — activeMatterId and activeConversationId are transient
      // (not persisted to localStorage). They reset on page load by design.
      this._sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      this._theme = localStorage.getItem('theme') || 'light';

      // Chat/Agentic
      this._chatMode = localStorage.getItem('chatMode') || 'general';
    }

    // -----------------------------------------------------------------------
    // Internal: intercept api.js property writes (zero-cost, instant)
    // -----------------------------------------------------------------------

    /**
     * Uses Object.defineProperty on the api instance to intercept writes
     * to token, user, baseUrl, and _streamingActive. This fires events
     * the instant a value changes — no polling timers needed.
     *
     * Does NOT modify api.js source. Works because api.token etc. are
     * plain instance properties (not prototype getters), so we can
     * redefine them on the instance with a getter/setter pair.
     */
    _interceptApiProperties() {
      if (typeof api === 'undefined' || !api) return;

      var self = this;

      this._interceptProperty(api, 'token', function (newVal) {
        var val = newVal || null;
        if (val !== self._token) {
          self._token = val;
          self._user = api.user || null;
          self._emit('auth:changed', {
            token: self._token,
            user: self._user,
            isAuthenticated: !!self._token
          });
        }
      });

      this._interceptProperty(api, 'user', function (newVal) {
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

      this._interceptProperty(api, 'baseUrl', function (newVal) {
        var val = newVal || '';
        if (val !== self._baseUrl) {
          self._baseUrl = val;
          self._emit('connection:changed', {
            isReachable: self._isReachable,
            baseUrl: self._baseUrl
          });
        }
      });

      this._interceptProperty(api, '_streamingActive', function (newVal) {
        var val = !!newVal;
        if (val !== self._isStreaming) {
          self._isStreaming = val;
          self._emit('chat:streaming', { isStreaming: self._isStreaming });
        }
      });
    }

    /**
     * Redefine a plain instance property as a getter/setter pair.
     * The setter calls onChange(newValue) before storing the value.
     */
    _interceptProperty(obj, prop, onChange) {
      var currentValue = obj[prop];

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
      // No timers to clean up — interception is passive
    }
  }

  // =========================================================================
  // Export as singleton
  // =========================================================================

  global.Lex = global.Lex || {};
  global.Lex.state = new LexState();

})(typeof window !== 'undefined' ? window : globalThis);

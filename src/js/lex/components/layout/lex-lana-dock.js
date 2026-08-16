/* ==========================================================================
   Lex UI — <lex-lana-dock>
   IDE-style docked LANA chat panel (Cursor-like), shared across screens.

   A fixed right-side dock that hosts the unified Ask LANA panel
   (lex-lana-panel, column mode). Two states:
     expanded  — full chat panel (width --lex-lana-dock-width, default 420px)
     minimized — slim icon rail showing ONLY the toggle icon
   The state animates with the same slide mechanics as lex-sidebar
   (--lex-transition-slide) and persists across pages via localStorage, so
   the dock feels like part of the app shell, not a per-page drawer.

   Page content reflows: the dock maintains --lex-lana-dock-current-width on
   <html>, and lex-body picks it up as margin-right (mirror of the sidebar's
   --lex-sidebar-current-width / margin-left contract in lex-app.js).

   Usage (place before </body>, after the lex component scripts):
     <lex-lana-dock
       page-scope="dashboard"
       context-type="full_chat"
       placeholder="Ask LANA anything..."
       thread-title="LANA Chat"
     ></lex-lana-dock>

   Pages with richer context set attributes at runtime, e.g.:
     document.querySelector('lex-lana-dock').setAttribute('matter-id', id);

   Events (bubble + compose):
     lex-lana-dock-toggle — { collapsed } after every state change

   Public API:
     expand() / minimize() / toggleDock()
     openWith(opts)
     openConversation(threadId, matterId?, opts?)
     newChat()
     panel() → the inner lex-lana-panel (built lazily on first expand)
   Also registered as Lex.LanaDock ({ get, toggle, expand, minimize,
   openWith, openConversation, newChat }).
   ========================================================================== */

(function () {
  'use strict';

  var Lex = window.Lex;
  if (!Lex || !Lex.LexElement) { console.error('[lex-lana-dock] LexElement not loaded'); return; }

  var LexElement = Lex.LexElement;
  var defineLex = Lex.defineLex;

  var COLLAPSED_KEY = 'lana:lanaDock:collapsed';
  var WIDTH_KEY = 'lana:lanaDock:width';
  /* Dragging this many px narrower than the minimum width dismisses the
     dock instead of resizing it (the minimum IS the default width). */
  var DISMISS_SLACK_PX = 48;

  function persistConversationMatter(conversationId, matterId) {
    if (typeof api === 'undefined') return Promise.reject(new Error('api not available'));
    if (typeof api.setConversationMatter === 'function') {
      return api.setConversationMatter(conversationId, matterId || null);
    }
    if (typeof api.setConversationScope === 'function') {
      return api.setConversationScope(conversationId, { matter_id: matterId || null });
    }
    return Promise.reject(new Error('conversation scope API not available'));
  }

  function parseCardContext(raw) {
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  /* Minimize chevrons (slide the dock away to the right edge). */
  var CHEVRONS_RIGHT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg>';
  /* Expand chevrons — the collapsed rail's "open LANA" affordance
     (points into the screen, mirroring the dynamic menu's toggle). */
  var CHEVRONS_LEFT_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg>';
  /* Chat bubble — the rail footer's "start a chat" affordance. */
  var CHAT_BUBBLE_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var style = document.createElement('style');
    style.id = 'lex-lana-dock-styles';
    style.textContent = ''
      + 'lex-lana-dock {'
      + '  position: fixed;'
      + '  top: 0;'
      + '  right: 0;'
      + '  bottom: 0;'
      + '  width: var(--lex-lana-dock-width, 420px);'
      + '  display: flex;'
      + '  flex-direction: column;'
      + '  background: var(--lex-surface-primary, #fff);'
      + '  border-left: 1px solid var(--lex-border-default, #e5e7eb);'
      + '  z-index: var(--lex-z-overlay, 30);'
      /* NOTE: must match the sidebar slide (lex-sidebar.js) exactly */
      + '  transition: width var(--lex-transition-slide);'
      + '  overflow: hidden;'
      + '}'
      + 'lex-lana-dock[data-collapsed="true"] {'
      + '  width: var(--lex-lana-dock-collapsed-width, 48px);'
      + '}'

      /* ── Resize handle: grab strip on the left edge. Hover (or an active
            drag) lights a 2px accent line so the affordance is visible. ── */
      + 'lex-lana-dock .lld-resize {'
      + '  position: absolute;'
      + '  top: 0; left: 0; bottom: 0;'
      + '  width: 6px;'
      + '  cursor: ew-resize;'
      + '  z-index: 5;'
      + '  touch-action: none;'
      + '}'
      + 'lex-lana-dock .lld-resize::before {'
      + '  content: "";'
      + '  position: absolute;'
      + '  top: 0; left: 0; bottom: 0;'
      + '  width: 2px;'
      + '  background: transparent;'
      + '  transition: background var(--lex-transition-fast, 0.15s);'
      + '}'
      + 'lex-lana-dock .lld-resize:hover::before,'
      + 'lex-lana-dock[data-resizing="true"] .lld-resize::before {'
      + '  background: var(--lex-chat-accent, #4f46e5);'
      + '}'
      + 'lex-lana-dock[data-collapsed="true"] .lld-resize { display: none; }'
      /* Live drag: kill the slide transitions so dock + page track the
         pointer 1:1, and keep the resize cursor / no text selection even
         when the pointer momentarily leaves the strip. */
      + 'lex-lana-dock[data-resizing="true"] { transition: none; }'
      + 'html[data-lana-dock-resizing] lex-body { transition: none; }'
      + 'html[data-lana-dock-resizing], html[data-lana-dock-resizing] body {'
      + '  cursor: ew-resize !important;'
      + '  user-select: none !important;'
      + '  -webkit-user-select: none !important;'
      + '}'

      /* ── Expanded header — same height + border as lex-topbar so the
            dock header border continues the topbar border as one line ── */
      + 'lex-lana-dock .lld-header {'
      + '  display: flex;'
      + '  align-items: center;'
      + '  justify-content: space-between;'
      + '  gap: 8px;'
      + '  height: var(--lex-topbar-height, 57px);'
      + '  box-sizing: border-box;'
      + '  padding: 0 1rem;'
      + '  border-bottom: 1px solid var(--lex-topbar-border, var(--lex-border-default, #e5e7eb));'
      + '  flex-shrink: 0;'
      + '  white-space: nowrap;'
      + '}'
      + 'lex-lana-dock .lld-title {'
      + '  font-size: 13px;'
      + '  font-weight: 600;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  margin: 0;'
      + '  overflow: hidden;'
      + '  text-overflow: ellipsis;'
      + '}'
      + 'lex-lana-dock .lld-toggle {'
      + '  background: none;'
      + '  border: none;'
      + '  cursor: pointer;'
      + '  padding: 6px;'
      + '  color: var(--lex-text-tertiary, #9ca3af);'
      + '  border-radius: var(--lex-radius-md, 6px);'
      + '  transition: color 0.15s, background 0.15s;'
      + '  line-height: 0;'
      + '  flex-shrink: 0;'
      + '}'
      + 'lex-lana-dock .lld-toggle:hover {'
      + '  color: var(--lex-text-primary, #111827);'
      + '  background: var(--lex-surface-secondary, #f3f4f6);'
      + '}'

      /* ── Conversation header: title + workspace chip, above the chat
            stream (mirror of chat-v2's conversation header) ── */
      + 'lex-lana-dock .lld-convo {'
      + '  display: none;'
      + '  flex-direction: column;'
      + '  gap: 2px;'
      + '  padding: 10px 16px;'
      + '  border-bottom: 1px solid var(--lex-border-subtle, #e5e7eb);'
      + '  flex-shrink: 0;'
      + '  min-width: 0;'
      + '}'
      + 'lex-lana-dock .lld-convo[data-visible="true"] { display: flex; }'
      + 'lex-lana-dock .lld-convo-title {'
      + '  font-size: 13px;'
      + '  font-weight: 600;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  white-space: nowrap;'
      + '  overflow: hidden;'
      + '  text-overflow: ellipsis;'
      + '}'
      + 'lex-lana-dock .lld-convo-ws {'
      + '  display: none;'
      + '  align-items: center;'
      + '  gap: 5px;'
      + '  font-size: 11px;'
      + '  color: var(--lex-text-secondary, #6b7280);'
      + '  white-space: nowrap;'
      + '  overflow: hidden;'
      + '  text-overflow: ellipsis;'
      + '}'
      + 'lex-lana-dock .lld-convo-ws[data-visible="true"] { display: inline-flex; }'
      + 'lex-lana-dock .lld-convo-ws svg { flex-shrink: 0; }'
      /* The workspace chip is the conversation's SCOPE control — clickable,
         with a picker. Scope belongs to the conversation, not the page. */
      + 'lex-lana-dock .lld-convo-ws {'
      + '  cursor: pointer;'
      + '  border: 1px solid transparent;'
      + '  border-radius: 6px;'
      + '  padding: 2px 6px;'
      + '  margin-left: -6px;'
      + '  max-width: 100%;'
      + '  transition: background 0.15s, border-color 0.15s;'
      + '}'
      + 'lex-lana-dock .lld-convo-ws:hover {'
      + '  background: var(--lex-bg-hover, #f3f4f6);'
      + '  border-color: var(--lex-border-default, #e5e7eb);'
      + '}'
      + 'lex-lana-dock .lld-convo { position: relative; }'
      + 'lex-lana-dock .lld-scope-menu {'
      + '  position: absolute;'
      + '  top: 100%;'
      + '  left: 12px;'
      + '  z-index: 50;'
      + '  width: 280px;'
      + '  max-height: 300px;'
      + '  overflow: hidden;'
      + '  display: none;'
      + '  flex-direction: column;'
      + '  background: var(--lex-surface-primary, #fff);'
      + '  border: 1px solid var(--lex-border-default, #e5e7eb);'
      + '  border-radius: 10px;'
      + '  box-shadow: 0 8px 24px rgba(0,0,0,0.12);'
      + '}'
      + 'lex-lana-dock .lld-scope-menu[data-open="true"] { display: flex; }'
      + 'lex-lana-dock .lld-scope-search {'
      + '  margin: 8px;'
      + '  padding: 7px 10px;'
      + '  font-size: 12px;'
      + '  border: 1px solid var(--lex-border-default, #e5e7eb);'
      + '  border-radius: 6px;'
      + '  outline: none;'
      + '}'
      + 'lex-lana-dock .lld-scope-list { overflow-y: auto; padding: 0 6px 6px; }'
      + 'lex-lana-dock .lld-scope-item {'
      + '  display: block;'
      + '  width: 100%;'
      + '  text-align: left;'
      + '  padding: 7px 10px;'
      + '  font-size: 12.5px;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  background: none;'
      + '  border: none;'
      + '  border-radius: 6px;'
      + '  cursor: pointer;'
      + '  white-space: nowrap;'
      + '  overflow: hidden;'
      + '  text-overflow: ellipsis;'
      + '}'
      + 'lex-lana-dock .lld-scope-item:hover { background: var(--lex-bg-hover, #f3f4f6); }'
      + 'lex-lana-dock .lld-scope-item.muted { color: var(--lex-text-secondary, #6b7280); }'
      /* Unscoped conversations show the chip as a ghost add affordance. */
      + 'lex-lana-dock .lld-convo-ws-empty { color: var(--lex-text-tertiary, #9ca3af); font-style: italic; }'

      /* Page-context suggestion bubble in the welcome area: an OFFER of
         scope, never an imposition. Dismissible. */
      + 'lex-lana-dock .lld-suggest {'
      + '  display: inline-flex;'
      + '  align-items: center;'
      + '  gap: 8px;'
      + '  margin-top: 18px;'
      + '  padding: 8px 8px 8px 14px;'
      + '  font-size: 12.5px;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  background: var(--lex-surface-primary, #fff);'
      + '  border: 1px solid var(--lex-border-default, #e5e7eb);'
      + '  border-radius: 9999px;'
      + '  box-shadow: 0 2px 8px rgba(0,0,0,0.06);'
      + '  cursor: pointer;'
      + '  transition: border-color 0.15s, box-shadow 0.15s;'
      + '}'
      + 'lex-lana-dock .lld-suggest:hover {'
      + '  border-color: #7c3aed;'
      + '  box-shadow: 0 2px 12px rgba(124,58,237,0.18);'
      + '}'
      + 'lex-lana-dock .lld-suggest-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }'
      + 'lex-lana-dock .lld-suggest-dismiss {'
      + '  display: inline-flex;'
      + '  align-items: center;'
      + '  justify-content: center;'
      + '  width: 18px; height: 18px;'
      + '  border: none;'
      + '  background: none;'
      + '  border-radius: 50%;'
      + '  color: var(--lex-text-tertiary, #9ca3af);'
      + '  cursor: pointer;'
      + '}'
      + 'lex-lana-dock .lld-suggest-dismiss:hover { color: var(--lex-text-primary, #111827); background: var(--lex-bg-hover, #f3f4f6); }'

      /* ── Body hosts the lana panel ── */
      + 'lex-lana-dock .lld-body {'
      + '  flex: 1;'
      + '  display: flex;'
      + '  flex-direction: column;'
      + '  min-height: 0;'
      + '  min-width: calc(var(--lex-lana-dock-width, 420px) - 1px);'
      + '}'
      + 'lex-lana-dock lex-lana-panel[mode="column"] {'
      + '  width: 100% !important;'
      + '  height: 100%;'
      + '  border-left: none;'
      + '}'
      /* The dock provides its own header; hide the panel column header. */
      + 'lex-lana-dock .llp-col-header { display: none; }'

      /* Welcome message sits dead-center of the thread area: stretch the
         thread container to the scroller's full height so the welcome's
         flex centering has room to work. */
      + 'lex-lana-dock .lex-chat-thread-container { min-height: 100%; box-sizing: border-box; }'
      + 'lex-lana-dock .lex-chat-welcome { justify-content: center; padding-bottom: 24px; }'

      /* ── Minimized icon rail (mirror of the collapsed dynamic menu):
            toggle centered in a topbar-height band so it aligns with the
            sidebar's toggle and the topbar border continues across; the
            + sits in a bordered footer band aligned with the sidebar's
            user (MW) footer. ── */
      + 'lex-lana-dock .lld-rail {'
      + '  display: none;'
      + '  flex-direction: column;'
      + '  align-items: stretch;'
      + '  flex: 1;'
      + '  min-height: 0;'
      + '}'
      + 'lex-lana-dock .lld-rail-top {'
      + '  height: var(--lex-topbar-height, 57px);'
      + '  box-sizing: border-box;'
      + '  border-bottom: 1px solid var(--lex-topbar-border, var(--lex-border-default, #e5e7eb));'
      + '  display: flex;'
      + '  align-items: center;'
      + '  justify-content: center;'
      + '  flex-shrink: 0;'
      + '}'
      + 'lex-lana-dock .lld-rail-footer {'
      + '  margin-top: auto;'
      /* No divider above the bubble — it floats clean in the footer. */
      + '  padding: 0.5rem;'
      + '  display: flex;'
      + '  align-items: center;'
      + '  justify-content: center;'
      + '  flex-shrink: 0;'
      + '}'
      /* The rail bubble wears the LANA gradient (same as the pill and the
         composer send button) — it IS the brand affordance for "talk to
         LANA". White glyph on the gradient circle. */
      + 'lex-lana-dock .lld-rail-new {'
      + '  width: 32px;'
      + '  height: 32px;'
      + '  border-radius: 50%;'
      + '  display: inline-flex;'
      + '  align-items: center;'
      + '  justify-content: center;'
      + '  color: #fff;'
      + '  background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 40%, #7c3aed 70%, #c026d3 100%);'
      + '  background-size: 200% 200%;'
      + '  box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(99,102,241,0.25), inset 0 1px 0 rgba(255,255,255,0.15);'
      + '  transition: background-position 0.4s ease, transform 0.2s ease;'
      + '}'
      + 'lex-lana-dock .lld-rail-new:hover {'
      + '  color: #fff;'
      + '  background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 40%, #7c3aed 70%, #c026d3 100%);'
      + '  background-size: 200% 200%;'
      + '  background-position: 100% 100%;'
      + '  transform: translateY(-1px);'
      + '}'
      + 'lex-lana-dock[data-collapsed="true"] .lld-rail { display: flex; }'
      + 'lex-lana-dock[data-collapsed="true"] .lld-header,'
      + 'lex-lana-dock[data-collapsed="true"] .lld-body { display: none; }'

      /* ── Shell reflow: content yields to the dock (mirror of the sidebar
            margin-left contract; transition must list BOTH margins so the
            lex-app.js rule does not drop the right-side slide). ── */
      + 'lex-body {'
      + '  margin-right: var(--lex-lana-dock-current-width, 0px);'
      + '  transition: margin-left var(--lex-transition-slide), margin-right var(--lex-transition-slide);'
      + '}'
      + '@media (max-width: 1023px) {'
      + '  lex-lana-dock { display: none; }'
      + '  lex-body { margin-right: 0; transition: none; }'
      + '}'

      /* ── Ask LANA triggers: visible only while the dock is minimized.
            Their sole job is opening the dock with context. Desktop only:
            below 1024px the dock itself is hidden, so the triggers must
            stay available (they fall back to their legacy behavior). ── */
      + '@media (min-width: 1024px) {'
      + '  html[data-lana-dock="expanded"] lex-ask-lana-btn,'
      + '  html[data-lana-dock="expanded"] [data-lana-dock-trigger]:not(.lex-card-lana-talk) {'
      + '    display: none !important;'
      + '  }'
      + '}'
      + '[data-lana-dock-trigger].lana-dock-trigger {'
      + '  display: inline-flex;'
      + '  align-items: center;'
      + '  justify-content: center;'
      + '  gap: 6px;'
      + '  min-height: 30px;'
      + '  padding: 6px 12px;'
      + '  border: 0;'
      + '  border-radius: var(--lex-radius-full, 9999px);'
      + '  background: linear-gradient(135deg, #4f46e5 0%, #6d28d9 100%);'
      + '  color: #fff;'
      + '  box-shadow: 0 6px 16px rgba(79, 70, 229, 0.28);'
      + '  cursor: pointer;'
      + '  font-family: var(--lex-font-sans, inherit);'
      + '  font-size: 10.5px;'
      + '  font-weight: 800;'
      + '  letter-spacing: 0;'
      + '  line-height: 1;'
      + '  text-transform: uppercase;'
      + '  white-space: nowrap;'
      + '  transition: transform var(--lex-transition-fast), box-shadow var(--lex-transition-fast), filter var(--lex-transition-fast);'
      + '}'
      + '[data-lana-dock-trigger].lana-dock-trigger:hover {'
      + '  filter: brightness(1.04);'
      + '  box-shadow: 0 8px 20px rgba(79, 70, 229, 0.34);'
      + '  transform: translateY(-1px);'
      + '}'
      + '[data-lana-dock-trigger].lana-dock-trigger:active { transform: translateY(0) scale(0.98); }'
      + '[data-lana-dock-trigger].lana-dock-trigger:focus-visible {'
      + '  outline: none;'
      + '  box-shadow: 0 0 0 2px var(--lex-bg-primary, #fff), 0 0 0 4px rgba(79, 70, 229, 0.45);'
      + '}'
      + '[data-lana-dock-trigger].lana-dock-trigger .lana-dock-trigger-icon {'
      + '  position: relative;'
      + '  display: inline-flex;'
      + '  width: 16px;'
      + '  height: 16px;'
      + '  flex: 0 0 16px;'
      + '}'
      + '[data-lana-dock-trigger].lana-dock-trigger .lana-dock-trigger-icon svg {'
      + '  position: absolute;'
      + '  width: 8px;'
      + '  height: 8px;'
      + '  fill: none;'
      + '  stroke: currentColor;'
      + '  stroke-width: 1.5;'
      + '}'
      + '[data-lana-dock-trigger].lana-dock-trigger .lana-dock-trigger-icon svg:first-child { top: 0; left: 0; }'
      + '[data-lana-dock-trigger].lana-dock-trigger .lana-dock-trigger-icon svg:last-child { right: 0; bottom: 0; }';

    document.head.appendChild(style);
  }

  class LexLanaDock extends LexElement {

    static get properties() {
      return {
        pageScope:     { type: String, default: '', attribute: 'page-scope' },
        contextType:   { type: String, default: 'full_chat', attribute: 'context-type' },
        matterId:      { type: String, default: '', attribute: 'matter-id' },
        placeholder:   { type: String, default: 'Ask LANA...' },
        composerTools: { type: Array, default: [], attribute: 'composer-tools' },
        defaultTool:   { type: String, default: '', attribute: 'default-tool' },
        threadTitle:   { type: String, default: 'LANA Chat', attribute: 'thread-title' },
        heading:       { type: String, default: 'Ask LANA', attribute: 'heading' }
      };
    }

    constructor() {
      super();
      this._panelEl = null;
      this._collapsed = true;
      this._convoEl = null;
      this._workspaceName = '';
      this._scopeMatterId = '';       // the conversation's applied scope
      this._pageContext = null;       // where the user is standing (suggestion source)
      this._suggestDismissed = false; // per-page-load dismissal
      this._scopeMenuEl = null;
      this._mattersCache = null;
      this._injectedDocId = null;
      this._boundTriggerClick = this._handleDockTriggerClick.bind(this);
      this._resizeState = null;   // live pointer-drag bookkeeping
      this._baseWidthPx = 0;      // resolved default width = resize minimum
    }

    connected() {
      injectStyles();
      this._collapsed = this._readStoredCollapsed();
      this._initResizeWidth();
      this._build();
      this._applyState({ initial: true });
      Lex.LanaDock = Lex.LanaDock || {};
      Lex.LanaDock.get = function () { return document.querySelector('lex-lana-dock'); };
      Lex.LanaDock.toggle = function () { var d = Lex.LanaDock.get(); if (d) d.toggleDock(); };
      Lex.LanaDock.expand = function () { var d = Lex.LanaDock.get(); if (d) d.expand(); };
      Lex.LanaDock.minimize = function () { var d = Lex.LanaDock.get(); if (d) d.minimize(); };
      Lex.LanaDock.openWith = function (opts) { var d = Lex.LanaDock.get(); if (d) return d.openWith(opts); };
      Lex.LanaDock.openConversation = function (threadId, matterId, opts) {
        var d = Lex.LanaDock.get();
        if (d) return d.openConversation(threadId, matterId, opts);
      };
      Lex.LanaDock.newChat = function () { var d = Lex.LanaDock.get(); if (d) return d.newChat(); };

      document.addEventListener('click', this._boundTriggerClick);
      this._consumePendingAction();
    }

    disconnected() {
      // Leave the CSS variable untouched: page teardown during navigation
      // should not cause a visible content reflow before unload.
      document.removeEventListener('click', this._boundTriggerClick);
    }

    render() { return null; }

    // =====================================================================
    //  Public API
    // =====================================================================

    expand() {
      if (!this._collapsed) return;
      this._collapsed = false;
      this._applyState();
      // Each time the dock opens from its minimized state, the RECENTS
      // dropdown starts closed — the chat itself is the point of opening.
      this._collapseRecentsDropdown();
      this._maybeShowSuggestion();
    }

    _collapseRecentsDropdown() {
      var self = this;
      setTimeout(function () {
        var t = self._panelEl && self._panelEl._threadsEl;
        if (!t) return;
        t._props.collapsed = true;
        if (typeof t._reflectToAttribute === 'function') t._reflectToAttribute('collapsed', true);
        var list = t.querySelector('.lct-list');
        var chevron = t.querySelector('.lct-chevron');
        if (list) list.classList.add('collapsed');
        if (chevron) chevron.classList.remove('open');
      }, 150);
    }

    minimize() {
      if (this._collapsed) return;
      this._collapsed = true;
      this._applyState();
    }

    toggleDock() {
      this._collapsed = !this._collapsed;
      this._applyState();
    }

    panel() { return this._panelEl; }

    // =====================================================================
    //  Internals
    // =====================================================================

    _build() {
      this.setAttribute('data-collapsed', String(this._collapsed));

      var header = document.createElement('div');
      header.className = 'lld-header';
      var title = document.createElement('h2');
      title.className = 'lld-title';
      title.textContent = this.heading || 'Ask LANA';
      var collapseBtn = document.createElement('button');
      collapseBtn.className = 'lld-toggle';
      collapseBtn.type = 'button';
      collapseBtn.setAttribute('aria-label', 'Minimize LANA panel');
      collapseBtn.innerHTML = CHEVRONS_RIGHT_SVG;
      header.appendChild(title);
      header.appendChild(collapseBtn);

      var body = document.createElement('div');
      body.className = 'lld-body';

      var rail = document.createElement('div');
      rail.className = 'lld-rail';
      var expandBtn = document.createElement('button');
      expandBtn.className = 'lld-toggle';
      expandBtn.type = 'button';
      expandBtn.setAttribute('aria-label', 'Open LANA panel');
      expandBtn.innerHTML = CHEVRONS_LEFT_SVG;
      var railNewBtn = document.createElement('button');
      railNewBtn.className = 'lld-toggle lld-rail-new';
      railNewBtn.type = 'button';
      railNewBtn.setAttribute('aria-label', 'New chat');
      railNewBtn.innerHTML = CHAT_BUBBLE_SVG;
      var railTop = document.createElement('div');
      railTop.className = 'lld-rail-top';
      railTop.appendChild(expandBtn);
      var railFooter = document.createElement('div');
      railFooter.className = 'lld-rail-footer';
      railFooter.appendChild(railNewBtn);
      rail.appendChild(railTop);
      rail.appendChild(railFooter);

      this.appendChild(header);
      this.appendChild(body);
      this.appendChild(rail);

      var self = this;
      collapseBtn.addEventListener('click', function () { self.minimize(); });
      expandBtn.addEventListener('click', function () { self.expand(); });
      railNewBtn.addEventListener('click', function () { self.newChat(); });

      var resizeHandle = document.createElement('div');
      resizeHandle.className = 'lld-resize';
      resizeHandle.setAttribute('role', 'separator');
      resizeHandle.setAttribute('aria-orientation', 'vertical');
      resizeHandle.setAttribute('aria-label', 'Resize LANA panel');
      resizeHandle.title = 'Drag to resize · double-click to reset';
      this.appendChild(resizeHandle);
      this._bindResize(resizeHandle);
    }

    // =====================================================================
    //  Edge resize
    //
    //  The default width is the MINIMUM; the dock can grow up to 2x that.
    //  Dragging DISMISS_SLACK_PX narrower than the minimum dismisses the
    //  dock (minimize) and resets the width for the next open. All widths
    //  flow through the --lex-lana-dock-width override on <html>, so the
    //  existing --lex-lana-dock-current-width page-reflow contract keeps
    //  working untouched.
    // =====================================================================

    _initResizeWidth() {
      var raw = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--lex-lana-dock-width')
      );
      // Read the stylesheet default BEFORE applying any stored override —
      // it is the source of truth for min (1x) and max (2x).
      this._baseWidthPx = (isFinite(raw) && raw > 0) ? raw : 420;
      var stored = NaN;
      try { stored = parseFloat(localStorage.getItem(WIDTH_KEY)); } catch (_) { /* restricted context */ }
      if (isFinite(stored) && stored > 0) {
        this._setDockWidth(this._clampWidth(stored), false);
      }
    }

    _clampWidth(px) {
      return Math.min(Math.max(px, this._baseWidthPx), this._baseWidthPx * 2);
    }

    _setDockWidth(px, persist) {
      var rounded = Math.round(px);
      document.documentElement.style.setProperty('--lex-lana-dock-width', rounded + 'px');
      if (persist) {
        try { localStorage.setItem(WIDTH_KEY, String(rounded)); } catch (_) { /* restricted context */ }
      }
    }

    _bindResize(handle) {
      var self = this;

      handle.addEventListener('pointerdown', function (e) {
        if (self._collapsed || self._resizeState) return;
        e.preventDefault();
        try { handle.setPointerCapture(e.pointerId); } catch (_) { /* capture is best-effort */ }
        self._resizeState = {
          startX: e.clientX,
          startWidth: self.getBoundingClientRect().width
        };
        self.setAttribute('data-resizing', 'true');
        document.documentElement.setAttribute('data-lana-dock-resizing', '');
      });

      handle.addEventListener('pointermove', function (e) {
        var st = self._resizeState;
        if (!st) return;
        // Dock is right-anchored: moving the pointer LEFT grows it.
        var requested = st.startWidth + (st.startX - e.clientX);
        if (requested < self._baseWidthPx - DISMISS_SLACK_PX) {
          // Dragged well inside the minimum — the gesture means "get rid
          // of it". Reset to the default width so the next open starts
          // clean, then minimize to the icon rail.
          self._endResize(handle, e.pointerId);
          self._setDockWidth(self._baseWidthPx, true);
          self.minimize();
          return;
        }
        self._setDockWidth(self._clampWidth(requested), false);
      });

      var finish = function (e) {
        if (!self._resizeState) return;
        self._endResize(handle, e.pointerId);
        self._setDockWidth(self._clampWidth(self.getBoundingClientRect().width), true);
      };
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);

      handle.addEventListener('dblclick', function () {
        self._setDockWidth(self._baseWidthPx, true);
      });
    }

    _endResize(handle, pointerId) {
      this._resizeState = null;
      try { handle.releasePointerCapture(pointerId); } catch (_) { /* already released */ }
      this.removeAttribute('data-resizing');
      document.documentElement.removeAttribute('data-lana-dock-resizing');
    }

    /**
     * Expand the dock with page context injected — the contract for the
     * app's Ask LANA buttons. The buttons do nothing except call this with
     * whatever context their surface owns (matter, document, context type),
     * exactly like the file-viewer drawer used to inject its document.
     * @param {Object} [opts] - { matterId, documentId, documentName, contextType, initialPrompt }
     */
    openWith(opts) {
      opts = opts || {};
      this.expand();
      var self = this;
      setTimeout(function () {
        var p = self._panelEl;
        if (!p) return;
        if (opts.contextType && typeof p.setContextType === 'function') {
          p.setContextType(opts.contextType);
        }
        if (opts.matterId) {
          // Full scope application: local state + chip + persistence when a
          // conversation is already live (same single path the chip uses).
          self._applyScope(opts.matterId, opts.matterName || opts.matterId);
        }
        if (opts.documentId) {
          self._injectedDocId = opts.documentId;
          if (typeof p.attachFile === 'function') {
            p.attachFile(opts.documentId, opts.documentName || 'Document');
          }
          if (typeof p.addDocument === 'function') {
            p.addDocument(opts.documentId, opts.documentName || 'Document', opts.matterId || self._scopeMatterId || null)
              .catch(function () { /* pending-attach path handles new threads */ });
          }
        }
        if (opts.cardContext && typeof p.attachModuleContext === 'function') {
          p.attachModuleContext(opts.cardContext);
        }
        if (opts.prefillPrompt && p._chatEl) {
          var composer = typeof p._chatEl.querySelector === 'function'
            ? p._chatEl.querySelector('lex-chat-composer')
            : null;
          if (composer && typeof composer.getValue === 'function' && typeof composer.setValue === 'function' && !composer.getValue()) {
            composer.setValue(opts.prefillPrompt);
          }
        }
        if (opts.initialPrompt && p._chatEl && typeof p._chatEl.send === 'function') {
          p._chatEl.send(opts.initialPrompt);
        }
        if (typeof p._focusComposer === 'function') p._focusComposer();
      }, 300);
    }

    /**
     * Expand the global dock and open an existing canonical conversation.
     * This is the dock-first replacement for standalone chat page links.
     * @param {string} threadId - Durable canonical conversation id.
     * @param {string} [matterId] - Optional workspace scope carried by caller.
     * @param {Object} [opts] - Optional { title, matterName } display hints.
     * @returns {Promise<Object|null>} The opened thread row when available.
     */
    openConversation(threadId, matterId, opts) {
      opts = opts || {};
      if (!threadId) return Promise.reject(new Error('threadId is required'));
      this.expand();
      var self = this;

      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          var p = self._panelEl;
          if (!p || typeof p.openConversation !== 'function') {
            reject(new Error('lana dock panel not ready'));
            return;
          }
          if (opts.contextType && typeof p.setContextType === 'function') {
            p.setContextType(opts.contextType);
          }
          if (matterId) {
            self._syncScopeLocal(matterId, opts.matterName || '');
          }
          p.openConversation(threadId, matterId, opts).then(function (thread) {
            self._setConvo(thread && thread.title ? thread.title : 'LANA Chat', (thread && thread.subtitle) || opts.matterName || '');
            if (typeof p._focusComposer === 'function') p._focusComposer();
            resolve(thread);
          }).catch(reject);
        }, 300);
      });
    }

    /**
     * Consume one-shot chat navigation intents from pages that cannot host the
     * dock directly. NavigationHelpers writes this before sending the user to
     * dashboard.html.
     */
    _consumePendingAction() {
      var raw = null;
      try {
        if (!window.sessionStorage) return;
        raw = window.sessionStorage.getItem('lana_dock_pending_action');
        if (!raw) return;
        window.sessionStorage.removeItem('lana_dock_pending_action');
      } catch (e) {
        return;
      }

      var action = null;
      try {
        action = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (!action || !action.type) return;

      var self = this;
      setTimeout(function () {
        if (action.type === 'conversation' && action.threadId) {
          self.openConversation(action.threadId, action.matterId || null);
          return;
        }
        if (action.type === 'matter_chat' && action.matterId) {
          if (typeof self.newChat === 'function') self.newChat();
          self.openWith({
            matterId: action.matterId,
            contextType: 'full_chat',
            initialPrompt: action.initialPrompt || null
          });
          return;
        }
        if (action.type === 'new_chat') {
          self.newChat();
        }
      }, 300);
    }

    _handleDockTriggerClick(event) {
      var trigger = event.target && event.target.closest && event.target.closest('[data-lana-dock-trigger]');
      if (!trigger || !document.contains(trigger)) return;
      if (trigger.closest('lex-lana-dock')) return;
      if (trigger.closest('lex-banner')) return;
      event.preventDefault();
      this.openWith({
        contextType: trigger.getAttribute('data-lana-context-type') || trigger.getAttribute('context-type') || null,
        matterId: trigger.getAttribute('data-lana-matter-id') || trigger.getAttribute('matter-id') || null,
        matterName: trigger.getAttribute('data-lana-matter-name') || trigger.getAttribute('matter-name') || null,
        documentId: trigger.getAttribute('data-lana-document-id') || trigger.getAttribute('document-id') || null,
        documentName: trigger.getAttribute('data-lana-document-name') || trigger.getAttribute('document-name') || null,
        prefillPrompt: trigger.getAttribute('data-lana-prefill') || null,
        cardContext: parseCardContext(trigger.getAttribute('data-lana-card-context') || '')
      });
    }

    /** Expand the dock and start a fresh conversation. */
    newChat() {
      this.expand();
      this._clearConvo();
      this._maybeShowSuggestion();
      var self = this;
      setTimeout(function () {
        var panel = self._panelEl;
        if (!panel) return;
        // A fresh conversation starts UNSCOPED — the previous conversation's
        // workspace must never silently carry over. Scope is adopted via the
        // suggestion bubble, the chip, or an explicit Ask-LANA button.
        self._syncScopeLocal(null, '');
        if (panel._chatEl && typeof panel._chatEl.clearConversation === 'function') {
          panel._chatEl.clearConversation();
        }
        if (panel._threadsEl && typeof panel._threadsEl.setActiveThread === 'function') {
          panel._threadsEl.setActiveThread(null);
        }
        if (typeof panel._focusComposer === 'function') panel._focusComposer();
      }, 250);
    }

    _buildPanel() {
      if (this._panelEl) return;
      var panel = document.createElement('lex-lana-panel');
      panel.setAttribute('mode', 'column');
      panel.setAttribute('column-heading', '');
      // The dock's thread list is the app-wide Recents (moved here from the
      // sidebar's dynamic menu).
      panel.setAttribute('threads-heading', 'Recents');
      panel.setAttribute('threads-recents', 'true');
      if (this.pageScope) panel.setAttribute('page-scope', this.pageScope);
      if (this.contextType) panel.setAttribute('context-type', this.contextType);
      if (this.matterId) panel.setAttribute('matter-id', this.matterId);
      if (this.placeholder) panel.setAttribute('placeholder', this.placeholder);
      if (this.defaultTool) panel.setAttribute('default-tool', this.defaultTool);
      if (this.threadTitle) panel.setAttribute('thread-title', this.threadTitle);
      if (this.composerTools && this.composerTools.length > 0) {
        panel.setAttribute('composer-tools', JSON.stringify(this.composerTools));
      }
      this._bindPageContextSend(panel);
      this.querySelector('.lld-body').appendChild(panel);
      this._panelEl = panel;
      // Column-mode panels display only when [open]; the dock controls
      // visibility at the dock level, so the panel itself is always open.
      panel.show();
      this._mountConvoHeader();
      // Page context declared before the panel existed (page load happens
      // while the dock is minimized) still has to reach the RECENTS
      // grouping.
      if (this._pageContext && this._pageContext.matterId) {
        this.setPageContext(this._pageContext);
      }
    }

    _bindPageContextSend(panel) {
      var self = this;
      panel.addEventListener('lex-lana-before-send', function (event) {
        var ctx = self._pageContext;
        if (!ctx || !ctx.documentId) return;

        var detail = event.detail || {};
        var opts = detail.opts || {};
        detail.opts = opts;
        opts.attachments = opts.attachments || {};
        opts.attachments.files = opts.attachments.files || [];

        var exists = opts.attachments.files.some(function (file) {
          return file && String(file.file_id || file.id || '') === String(ctx.documentId);
        });
        if (!exists) {
          opts.attachments.files.push({
            file_id: ctx.documentId,
            name: ctx.documentName || 'Document'
          });
        }
        if (ctx.matterId && !opts.matterId) {
          opts.matterId = ctx.matterId;
        }
        if (!opts.contextType || opts.contextType === 'full_chat') {
          opts.contextType = 'document_chat';
        }
      });
    }

    /**
     * Conversation header (title + workspace chip) between the RECENTS
     * dropdown and the chat stream — the same orientation chat-v2 gives.
     */
    _mountConvoHeader() {
      if (this._convoEl || !this._panelEl) return;
      var chatEl = this._panelEl._chatEl;
      if (!chatEl || !chatEl.parentNode) return;

      var briefcaseSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';
      var convo = document.createElement('div');
      convo.className = 'lld-convo';
      var title = document.createElement('div');
      title.className = 'lld-convo-title';
      var ws = document.createElement('button');
      ws.type = 'button';
      ws.className = 'lld-convo-ws';
      ws.setAttribute('aria-label', 'Conversation workspace scope');
      ws.innerHTML = briefcaseSvg + '<span class="lld-convo-ws-name"></span>';
      convo.appendChild(title);
      convo.appendChild(ws);
      chatEl.parentNode.insertBefore(convo, chatEl);
      this._convoEl = convo;

      var self = this;
      ws.addEventListener('click', function (e) {
        e.stopPropagation();
        self._toggleScopeMenu();
      });
      document.addEventListener('click', function (e) {
        if (self._scopeMenuEl && !self._scopeMenuEl.contains(e.target)) {
          self._scopeMenuEl.setAttribute('data-open', 'false');
        }
      });
      // Selecting a recent adopts THAT conversation's scope — its stored
      // matter is the truth, including "no matter" for general chats. The
      // header reflects exactly what the item carries (no page fallback).
      this.addEventListener('lex-lana-thread-selected', function (e) {
        var t = e.detail && e.detail.thread;
        if (!t) return;
        self._syncScopeLocal(t.matter_id || null, t.subtitle || '');
        self._setConvo(t.title || 'Untitled Chat', t.subtitle || '');
      });
      // A fresh conversation registers on first response — show it, then
      // pick up the generated title once the backend has named it.
      this.addEventListener('lex-chat-conversation-created', function (e) {
        if (!self._convoEl.dataset.visible || self._convoEl.dataset.visible !== 'true') {
          self._setConvo('New Chat', self._workspaceName || '');
        }
        var convId = e.detail && e.detail.conversationId;
        if (convId && self._panelEl && self._panelEl._threadsEl) {
          setTimeout(function () {
            // Guard against the user having switched conversations while
            // the generated title was pending — only update the header if
            // the created conversation is still the one on screen.
            var chatEl = self._panelEl && self._panelEl._chatEl;
            if (!chatEl || chatEl.conversationId !== convId) return;
            var threads = self._panelEl._threadsEl;
            if (typeof threads.refresh !== 'function') return;
            threads.refresh().then(function () {
              if (!chatEl || chatEl.conversationId !== convId) return;
              var list = threads._threads || [];
              for (var i = 0; i < list.length; i++) {
                if (list[i].thread_id === convId || list[i].id === convId) {
                  self._setConvo(list[i].title || 'New Chat', list[i].subtitle || self._workspaceName || '');
                  break;
                }
              }
            }).catch(function () {});
          }, 4000);
        }
      });
    }

    _setConvo(title, workspaceName) {
      if (!this._convoEl) return;
      this._convoEl.querySelector('.lld-convo-title').textContent = title || 'New Chat';
      var ws = this._convoEl.querySelector('.lld-convo-ws');
      var wsName = this._convoEl.querySelector('.lld-convo-ws-name');
      // The chip is always visible while a conversation is shown — it's the
      // scope control. Without a workspace it reads as the add affordance.
      wsName.textContent = workspaceName || 'Add to workspace';
      ws.classList.toggle('lld-convo-ws-empty', !workspaceName);
      ws.setAttribute('data-visible', 'true');
      this._convoEl.setAttribute('data-visible', 'true');
    }

    _clearConvo() {
      if (!this._convoEl) return;
      this._convoEl.setAttribute('data-visible', 'false');
      if (this._scopeMenuEl) this._scopeMenuEl.setAttribute('data-open', 'false');
    }

    /**
     * Where the user is standing. Never binds the conversation — it feeds
     * the RECENTS "This workspace" group and the suggestion bubble.
     * @param {Object} ctx - { matterId, matterName, documentId, documentName }
     */
    setPageContext(ctx) {
      this._pageContext = ctx || null;
      var p = this._panelEl;
      if (p && p._threadsEl && ctx && ctx.matterId) {
        p._threadsEl.setAttribute('matter-id', ctx.matterId);
        if (typeof p._threadsEl.refresh === 'function') p._threadsEl.refresh();
      }
      // Context can arrive while the dock is already expanded (page data
      // loads after navigation) — the welcome-screen offer still applies.
      if (!this._collapsed) this._maybeShowSuggestion();
    }

    /**
     * Bind the CONVERSATION's workspace scope (or clear it with null).
     * Applies to subsequent turns and persists on the session when one
     * already exists.
     */
    /**
     * Sync the dock's LOCAL scope state (attributes, fields) without
     * persisting. Used when the truth comes from elsewhere: selecting a
     * conversation from RECENTS (its stored matter IS the scope) and
     * starting a fresh chat (unscoped).
     */
    _syncScopeLocal(matterId, matterName) {
      this._scopeMatterId = matterId || '';
      this._workspaceName = matterName || '';
      if (matterId) this.setAttribute('matter-id', matterId);
      else this.removeAttribute('matter-id');

      var p = this._panelEl;
      if (p) {
        if (matterId) p.setAttribute('matter-id', matterId);
        else p.removeAttribute('matter-id');
        if (p._chatEl) {
          if (matterId) p._chatEl.setAttribute('matter-id', matterId);
          else p._chatEl.removeAttribute('matter-id');
          // Reflect the scope in the composer placeholder — on the welcome
          // screen this is the only place the applied scope is visible
          // (the convo-header workspace chip needs a conversation first).
          var composerEl = typeof p._chatEl.querySelector === 'function'
            ? p._chatEl.querySelector('lex-chat-composer')
            : null;
          if (composerEl && typeof composerEl.setPlaceholder === 'function') {
            composerEl.setPlaceholder(
              matterId && matterName ? 'Ask anything about ' + matterName + '...' : null
            );
          }
        }
      }
    }

    _applyScope(matterId, matterName) {
      this._syncScopeLocal(matterId, matterName);
      var p = this._panelEl;

      // Persist on the live conversation when one exists.
      var convId = p && p._chatEl ? p._chatEl.conversationId : null;
      if (convId) {
        persistConversationMatter(convId, matterId || null).then(function () {
          if (p._threadsEl && typeof p._threadsEl.refresh === 'function') p._threadsEl.refresh();
        }).catch(function (err) {
          console.warn('[lex-lana-dock] Failed to persist conversation scope:', err);
        });
      }

      // Reflect in the header if a conversation is showing.
      if (this._convoEl && this._convoEl.getAttribute('data-visible') === 'true') {
        var t = this._convoEl.querySelector('.lld-convo-title').textContent;
        this._setConvo(t, matterName || '');
      }
      if (this._scopeMenuEl) this._scopeMenuEl.setAttribute('data-open', 'false');
    }

    _toggleScopeMenu() {
      if (!this._convoEl) return;
      if (!this._scopeMenuEl) {
        var menu = document.createElement('div');
        menu.className = 'lld-scope-menu';
        menu.innerHTML = '<input type="text" class="lld-scope-search" placeholder="Search workspaces...">'
          + '<div class="lld-scope-list"></div>';
        this._convoEl.appendChild(menu);
        this._scopeMenuEl = menu;
        var self = this;
        menu.querySelector('.lld-scope-search').addEventListener('input', function (e) {
          self._renderScopeList(e.target.value);
        });
        menu.addEventListener('click', function (e) { e.stopPropagation(); });
      }
      var open = this._scopeMenuEl.getAttribute('data-open') === 'true';
      this._scopeMenuEl.setAttribute('data-open', open ? 'false' : 'true');
      if (!open) {
        this._loadMatters();
        var search = this._scopeMenuEl.querySelector('.lld-scope-search');
        search.value = '';
        setTimeout(function () { search.focus(); }, 50);
      }
    }

    _loadMatters() {
      var self = this;
      if (this._mattersCache) { this._renderScopeList(''); return; }
      this._renderScopeList('', true);
      if (typeof api === 'undefined' || typeof api.getMatters !== 'function') return;
      api.getMatters(1, 100, { status: 'active', sort_by: 'updated_at', sort_order: 'desc' }).then(function (res) {
        var rows = res.matters || res.data || res.items || [];
        self._mattersCache = rows.map(function (m) {
          return {
            id: m.matter_id || m.id,
            name: m.matter_name || m.name || m.title || m.matter_id || 'Untitled'
          };
        });
        self._renderScopeList('');
      }).catch(function () {
        self._mattersCache = [];
        self._renderScopeList('');
      });
    }

    _renderScopeList(query, loading) {
      if (!this._scopeMenuEl) return;
      var list = this._scopeMenuEl.querySelector('.lld-scope-list');
      if (loading) { list.innerHTML = '<div class="lld-scope-item muted">Loading workspaces...</div>'; return; }
      var q = (query || '').toLowerCase();
      var rows = (this._mattersCache || []).filter(function (m) {
        return !q || (m.name + ' ' + m.id).toLowerCase().indexOf(q) !== -1;
      });
      var self = this;
      list.innerHTML = '';
      if (this._scopeMatterId) {
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'lld-scope-item muted';
        clear.textContent = 'No workspace (general chat)';
        clear.addEventListener('click', function () { self._applyScope(null, ''); });
        list.appendChild(clear);
      }
      if (rows.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'lld-scope-item muted';
        empty.textContent = 'No workspaces found';
        list.appendChild(empty);
        return;
      }
      rows.slice(0, 50).forEach(function (m) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lld-scope-item';
        btn.textContent = m.name;
        btn.title = m.name + ' (' + m.id + ')';
        btn.addEventListener('click', function () { self._applyScope(m.id, m.name); });
        list.appendChild(btn);
      });
    }

    /**
     * Page-context suggestion bubble: offered in the welcome area when the
     * page has context the conversation hasn't adopted. Click = adopt scope;
     * dismiss = stay general for the rest of this page visit.
     */
    _maybeShowSuggestion() {
      var self = this;
      setTimeout(function () {
        if (self._collapsed || self._suggestDismissed || !self._pageContext) return;
        var p = self._panelEl;
        if (!p || !p._chatEl) return;
        var welcome = p._chatEl.querySelector('.lex-chat-welcome');
        if (!welcome || welcome.querySelector('.lld-suggest')) return;

        var ctx = self._pageContext;
        if (ctx.documentId && ctx.documentId === self._injectedDocId) {
          // This document was already injected via an explicit Ask-LANA
          // click — suggesting it again is noise.
          return;
        }
        var isDocument = !!ctx.documentId;
        if (!isDocument && (!ctx.matterId || ctx.matterId === self._scopeMatterId)) return;

        var chip = document.createElement('div');
        chip.className = 'lld-suggest';
        chip.innerHTML = '<span class="lld-suggest-label"></span>'
          + '<button type="button" class="lld-suggest-dismiss" aria-label="Dismiss suggestion">'
          + '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
          + '</button>';
        var labelEl = chip.querySelector('.lld-suggest-label');
        var dismissBtn = chip.querySelector('.lld-suggest-dismiss');

        var scopeName = ctx.matterName || ctx.matterId;
        labelEl.textContent = isDocument
          ? 'Ask about ' + (ctx.documentName || 'this document')
          : 'Ask about ' + scopeName;

        // Click = adopt the context. Feedback lives in the composer: the
        // document variant attaches a visible file badge via openWith(),
        // the workspace variant swaps the composer placeholder to
        // "Ask anything about <workspace>..." (via _syncScopeLocal).
        chip.addEventListener('click', function (e) {
          if (e.target.closest('.lld-suggest-dismiss')) return;
          chip.remove();
          if (isDocument) {
            self.openWith({
              matterId: ctx.matterId || null,
              matterName: ctx.matterName || null,
              documentId: ctx.documentId,
              documentName: ctx.documentName,
              contextType: 'document_chat'
            });
            return;
          }
          self._applyScope(ctx.matterId, scopeName);
          if (typeof p._focusComposer === 'function') p._focusComposer();
        });

        dismissBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          self._suggestDismissed = true;
          chip.remove();
        });

        welcome.appendChild(chip);
      }, 450);
    }

    _applyState(opts) {
      var initial = opts && opts.initial === true;
      this.setAttribute('data-collapsed', String(this._collapsed));

      if (!this._collapsed) this._buildPanel();

      document.documentElement.style.setProperty(
        '--lex-lana-dock-current-width',
        this._collapsed
          ? 'var(--lex-lana-dock-collapsed-width, 48px)'
          : 'var(--lex-lana-dock-width, 420px)'
      );
      // Ask LANA trigger buttons hide themselves while the dock is expanded
      // (they only exist to open it) — see the CSS hooks in injectStyles.
      document.documentElement.setAttribute('data-lana-dock', this._collapsed ? 'collapsed' : 'expanded');

      try {
        localStorage.setItem(COLLAPSED_KEY, String(this._collapsed));
      } catch (_) { /* localStorage can be unavailable in restricted contexts */ }

      if (!initial) {
        this.emit('lex-lana-dock-toggle', { collapsed: this._collapsed });
        if (!this._collapsed) {
          var self = this;
          setTimeout(function () {
            if (self._panelEl && typeof self._panelEl._focusComposer === 'function') {
              self._panelEl._focusComposer();
            }
          }, 300);
        }
      }
    }

    _readStoredCollapsed() {
      try {
        var stored = localStorage.getItem(COLLAPSED_KEY);
        if (stored === null) return true; // first run: minimized icon rail
        return stored === 'true';
      } catch (_) {
        return true;
      }
    }
  }

  defineLex('lex-lana-dock', LexLanaDock);
})();

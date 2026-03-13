/* ==========================================================================
   Lex UI — Ask LANA Button
   Self-contained gradient pill button that auto-connects to a lex-lana-panel.

   Usage:
     <!-- Auto-connected to a panel -->
     <lex-ask-lana-btn panel="myPanel" size="sm"></lex-ask-lana-btn>

     <!-- Standalone (listen for lex-ask-lana-click) -->
     <lex-ask-lana-btn></lex-ask-lana-btn>

   Properties:
     panel    - ID of the lex-lana-panel to toggle on click
     size     - 'sm' (compact) or 'md' (default)
     label    - Button text (default: 'LANA')
     disabled - Grays out and disables click
     active   - Visual pressed state (auto-synced when panel is wired)

   Events:
     lex-ask-lana-click - Fired on every click
   ========================================================================== */

(function () {
  'use strict';

  var Lex = window.Lex;
  if (!Lex || !Lex.LexElement) { console.error('[lex-ask-lana-btn] LexElement not loaded'); return; }

  var LexElement = Lex.LexElement;
  var defineLex = Lex.defineLex;

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var style = document.createElement('style');
    style.id = 'lex-ask-lana-btn-styles';
    style.textContent = ''
      + 'lex-ask-lana-btn { display: inline-flex; }'

      /* ── Base pill ─────────────────────────────────── */
      + ' .lab-btn {'
      + '   position: relative;'
      + '   display: inline-flex;'
      + '   align-items: center;'
      + '   justify-content: center;'
      + '   gap: 6px;'
      + '   font-weight: 700;'
      + '   letter-spacing: 0.8px;'
      + '   color: #fff;'
      + '   background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 40%, #7c3aed 70%, #c026d3 100%);'
      + '   background-size: 200% 200%;'
      + '   border: none;'
      + '   border-radius: 9999px;'
      + '   cursor: pointer;'
      + '   transition: transform 0.2s ease, box-shadow 0.3s ease, background-position 0.4s ease;'
      + '   box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(99,102,241,0.25), inset 0 1px 0 rgba(255,255,255,0.15);'
      + '   line-height: 1;'
      + '   overflow: hidden;'
      + ' }'

      /* ── Glass overlay ─────────────────────────────── */
      + ' .lab-btn::before {'
      + '   content: "";'
      + '   position: absolute;'
      + '   inset: 0;'
      + '   border-radius: 9999px;'
      + '   background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 50%, rgba(255,255,255,0.06) 100%);'
      + '   pointer-events: none;'
      + ' }'

      /* ── Hover ─────────────────────────────────────── */
      + ' .lab-btn:hover:not([disabled]) {'
      + '   transform: translateY(-1px);'
      + '   background-position: 100% 100%;'
      + '   box-shadow: 0 2px 6px rgba(0,0,0,0.15), 0 8px 24px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.2);'
      + ' }'

      /* ── Active / Pressed ──────────────────────────── */
      + ' .lab-btn:active:not([disabled]), .lab-btn[aria-pressed="true"] {'
      + '   transform: translateY(0) scale(0.97);'
      + '   box-shadow: 0 1px 2px rgba(0,0,0,0.1), 0 2px 8px rgba(124,58,237,0.2);'
      + ' }'

      /* ── Disabled ──────────────────────────────────── */
      + ' .lab-btn[disabled] {'
      + '   opacity: 0.45;'
      + '   cursor: not-allowed;'
      + '   pointer-events: none;'
      + ' }'

      /* ── Size: sm ──────────────────────────────────── */
      + ' .lab-btn--sm { padding: 6px 12px; font-size: 10.5px; }'

      /* ── Size: md ──────────────────────────────────── */
      + ' .lab-btn--md { padding: 8px 16px; font-size: 11.5px; }'

      /* ── Inner spans ───────────────────────────────── */
      + ' .lab-btn span { position: relative; }'

      /* ── Corner bracket icon ────────────────────────── */
      + ' .lab-icon { position: relative; width: 14px; height: 14px; flex-shrink: 0; }'
      + ' .lab-tl { position: absolute; top: 0; left: 0; }'
      + ' .lab-br { position: absolute; bottom: 0; right: 0; }';

    document.head.appendChild(style);
  }

  // ─── SVG constants ──────────────────────────────────────────────────────
  var SVG_TL = '<svg class="lab-tl" width="8" height="8" viewBox="0 0 8 8" fill="none">'
    + '<path d="M0 0L8 0M0 0L0 8" stroke="currentColor" stroke-width="1.5"/></svg>';
  var SVG_BR = '<svg class="lab-br" width="8" height="8" viewBox="0 0 8 8" fill="none">'
    + '<path d="M8 8L0 8M8 8L8 0" stroke="currentColor" stroke-width="1.5"/></svg>';

  // ─── Component ──────────────────────────────────────────────────────────

  class LexAskLanaBtn extends LexElement {

    static get properties() {
      return {
        panel:    { type: String, default: null },
        size:     { type: String, default: 'md' },
        label:    { type: String, default: 'LANA' },
        disabled: { type: Boolean, default: false, reflect: true },
        active:   { type: Boolean, default: false, reflect: true }
      };
    }

    constructor() {
      super();
      this._panelEl = null;
      this._onPanelOpened = this._onPanelOpened.bind(this);
      this._onPanelClosed = this._onPanelClosed.bind(this);
    }

    connected() {
      injectStyles();
      this._wirePanel();
    }

    disconnected() {
      this._unwirePanel();
    }

    render() {
      var sz = this.size === 'sm' ? 'lab-btn--sm' : 'lab-btn--md';
      var dis = this.disabled ? ' disabled' : '';
      var pressed = this.active ? 'true' : 'false';
      var lbl = this.escapeHtml(this.label);

      return '<button class="lab-btn ' + sz + '" type="button"'
        + ' aria-label="Ask LANA"'
        + ' aria-pressed="' + pressed + '"'
        + dis + '>'
        + '<span class="lab-icon" aria-hidden="true">' + SVG_TL + SVG_BR + '</span>'
        + '<span class="lab-label">' + lbl + '</span>'
        + '</button>';
    }

    updated() {
      var btn = this.querySelector('.lab-btn');
      if (!btn) return;
      this.listen(btn, 'click', this._onClick.bind(this));
    }

    _onClick(e) {
      if (this.disabled) return;
      this.emit('lex-ask-lana-click', {});

      // Auto-toggle connected panel
      if (this._panelEl && typeof this._panelEl.toggle === 'function') {
        this._panelEl.toggle();
      }
    }

    _wirePanel() {
      this._unwirePanel();
      if (!this.panel) return;

      // Defer lookup to allow panel to register
      var self = this;
      requestAnimationFrame(function () {
        self._panelEl = document.getElementById(self.panel);
        if (!self._panelEl) return;
        self._panelEl.addEventListener('lex-lana-opened', self._onPanelOpened);
        self._panelEl.addEventListener('lex-lana-closed', self._onPanelClosed);
        // Sync initial state
        self.active = self._panelEl.open || false;
      });
    }

    _unwirePanel() {
      if (!this._panelEl) return;
      this._panelEl.removeEventListener('lex-lana-opened', this._onPanelOpened);
      this._panelEl.removeEventListener('lex-lana-closed', this._onPanelClosed);
      this._panelEl = null;
    }

    _onPanelOpened() { this.active = true; }
    _onPanelClosed() { this.active = false; }
  }

  defineLex('lex-ask-lana-btn', LexAskLanaBtn);
})();

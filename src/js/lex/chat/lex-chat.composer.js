/* ==========================================================================
   Lex UI — <lex-chat-composer>
   Streamlined chat input with pill-shaped container, tools dropdown,
   document management, and active mode chips.

   Layout:
     ┌──────────────────────────────────────────┐
     │  textarea                                 │
     │                                           │
     │  [+] [Tools ▾] [DocChat ✕]    [▲ send]  │
     └──────────────────────────────────────────┘
       Press Enter to send, Shift+Enter for new line

   Returns null from render() — manages DOM imperatively.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, ChatFormat } = global.Lex;
  if (!LexElement) { console.error('[lex-chat-composer] LexElement not loaded'); return; }
  const CHAT_MESSAGE_MAX_CODE_UNITS = 2000;

  // Escape helper (safe even if ChatFormat not loaded yet)
  function esc(s) { return ChatFormat ? ChatFormat.escapeHtml(String(s)) : String(s); }

  // ---------------------------------------------------------------------------
  // Style injection
  // ---------------------------------------------------------------------------

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-composer-styles';
    style.textContent = `
      lex-chat-composer {
        display: block;
        padding: 0 16px 12px;
      }

      /* ── Pill container ─────────────────────────────────────── */
      .lex-cmp-pill {
        border: 1px solid var(--lex-chat-border);
        border-radius: 24px;
        background: var(--lex-chat-bg-surface);
        transition: border-color var(--lex-transition-fast, 0.15s),
                    box-shadow var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-pill:focus-within {
        border-color: var(--lex-chat-accent);
        box-shadow: 0 0 0 3px var(--lex-chat-accent-soft);
      }

      /* ── Textarea ───────────────────────────────────────────── */
      .lex-cmp-textarea {
        display: block;
        width: 100%;
        min-height: 40px;
        max-height: var(--_cmp-max-h, 128px);
        padding: 14px 18px 2px;
        border: none;
        background: transparent;
        color: var(--lex-chat-text);
        font-family: var(--lex-font-sans);
        font-size: var(--lex-body-sm-size, 14px);
        line-height: 1.5;
        resize: none;
        outline: none;
        box-sizing: border-box;
      }
      .lex-cmp-textarea:focus { outline: none !important; box-shadow: none !important; }
      .lex-cmp-textarea:disabled { opacity: 0.5; cursor: not-allowed; }
      .lex-cmp-textarea::placeholder { color: var(--lex-chat-text-dim); }

      /* ── Toolbar (inside pill, below textarea) ──────────────── */
      .lex-cmp-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px 10px;
      }

      /* ── + button ───────────────────────────────────────────── */
      .lex-cmp-plus {
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%;
        border: 1px solid var(--lex-chat-border);
        background: transparent;
        color: var(--lex-chat-text-muted);
        cursor: pointer;
        flex-shrink: 0;
        transition: all var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-plus:hover {
        background: var(--lex-chat-bg-elevated);
        color: var(--lex-chat-text);
        border-color: var(--lex-chat-text-dim);
      }
      .lex-cmp-plus svg { width: 14px; height: 14px; }

      /* ── Tools chip ─────────────────────────────────────────── */
      .lex-cmp-tools-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 11px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 500;
        border: 1px solid var(--lex-chat-border);
        background: transparent;
        color: var(--lex-chat-text-muted);
        cursor: pointer;
        transition: all var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-tools-chip:hover {
        background: var(--lex-chat-bg-elevated);
        color: var(--lex-chat-text);
        border-color: var(--lex-chat-text-dim);
      }
      .lex-cmp-tools-chip svg { width: 12px; height: 12px; }
      .lex-cmp-tools-chip[disabled] {
        opacity: 0.45;
        cursor: default;
        pointer-events: none;
      }

      /* ── Active mode chip ───────────────────────────────────── */
      .lex-cmp-active-chips {
        display: contents;
      }
      .lex-cmp-active-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 6px 5px 10px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 500;
        background: var(--lex-chat-accent);
        color: var(--lex-chat-accent-text);
        white-space: nowrap;
        animation: lex-chat-fade-in 0.2s ease both;
      }
      .lex-cmp-active-chip > svg {
        width: 12px; height: 12px;
        flex-shrink: 0;
      }
      .lex-cmp-chip-x {
        width: 16px; height: 16px;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 50%;
        background: rgba(255,255,255,0.2);
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-chip-x:hover { background: rgba(255,255,255,0.35); }
      .lex-cmp-chip-x svg { width: 10px; height: 10px; }

      /* ── Document badges area (above textarea) ─────────────── */
      .lex-cmp-doc-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 12px 0;
      }
      .lex-cmp-doc-badges:empty { display: none; }
      .lex-cmp-doc-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 6px 4px 8px;
        border-radius: var(--lex-radius-md, 8px);
        font-size: 12px;
        font-weight: 500;
        background: var(--lex-chat-bg-elevated, #f0ede7);
        color: var(--lex-chat-text, #1a1a1a);
        white-space: nowrap;
        max-width: 220px;
        overflow: hidden;
        animation: lex-chat-fade-in 0.2s ease both;
      }
      .lex-cmp-doc-badge > svg {
        width: 12px; height: 12px;
        flex-shrink: 0;
        opacity: 0.6;
      }
      .lex-cmp-doc-badge > span {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lex-cmp-doc-badge-x {
        width: 16px; height: 16px;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 50%;
        background: rgba(0,0,0,0.08);
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-doc-badge-x:hover { background: rgba(0,0,0,0.16); }
      .lex-cmp-doc-badge-x svg { width: 10px; height: 10px; }

      /* ── Spacer ─────────────────────────────────────────────── */
      .lex-cmp-spacer { flex: 1; }

      /* ── Send button (arrow-up in dark circle) ──────────────── */
      .lex-cmp-send {
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        /* Brand gradient — same as the Ask LANA pill (lex-ask-lana-btn) */
        background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 40%, #7c3aed 70%, #c026d3 100%);
        background-size: 200% 200%;
        color: #fff;
        flex-shrink: 0;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(99,102,241,0.25), inset 0 1px 0 rgba(255,255,255,0.15);
        transition: opacity var(--lex-transition-fast, 0.15s), transform 0.1s, background-position 0.4s ease;
      }
      .lex-cmp-send:hover { background-position: 100% 100%; }
      .lex-cmp-send:active { transform: scale(0.92); }
      .lex-cmp-send:disabled { opacity: 0.25; cursor: default; transform: none; }
      .lex-cmp-send svg { width: 14px; height: 14px; }

      /* ── Stop button ────────────────────────────────────────── */
      .lex-cmp-stop {
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        background: var(--lex-color-danger-500, #ef4444);
        color: #fff;
        flex-shrink: 0;
        transition: opacity var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-stop:hover { opacity: 0.85; }
      .lex-cmp-stop svg { width: 12px; height: 12px; }

      /* ── Popover (shared) ───────────────────────────────────── */
      .lex-cmp-anchor {
        position: relative;
        display: inline-flex;
      }
      .lex-cmp-popover {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 0;
        min-width: 250px;
        border-radius: var(--lex-radius-lg, 8px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.16);
        z-index: 50;
        padding: 6px;
        opacity: 0;
        transform: translateY(4px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .lex-cmp-popover--open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }

      /* Plus popover — light */
      .lex-cmp-popover--plus {
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
      }

      /* Tools popover — dark */
      .lex-cmp-popover--tools {
        background: #111118;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .lex-cmp-popover--tools .lex-cmp-pop-item { color: #c9cdd5; }
      .lex-cmp-popover--tools .lex-cmp-pop-item:hover { background: #1a1a24; color: #fff; }
      .lex-cmp-popover--tools .lex-cmp-pop-desc { color: #6B6B80; }
      .lex-cmp-popover--tools .lex-cmp-pop-check { color: var(--lex-chat-accent); }

      /* Popover item */
      .lex-cmp-pop-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border-radius: var(--lex-radius-md, 6px);
        cursor: pointer;
        color: var(--lex-chat-text);
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-pop-item:hover { background: var(--lex-chat-bg-elevated); }
      .lex-cmp-pop-item > svg {
        width: 16px; height: 16px;
        flex-shrink: 0;
        margin-top: 1px;
        opacity: 0.7;
      }
      .lex-cmp-pop-label { font-size: 13px; font-weight: 500; }
      .lex-cmp-pop-desc {
        font-size: 11px;
        color: var(--lex-chat-text-dim);
        margin-top: 2px;
        line-height: 1.4;
      }
      .lex-cmp-pop-check {
        margin-left: auto;
        align-self: center;
        font-size: 14px;
        font-weight: 600;
      }

      /* ── Suggestions ────────────────────────────────────────── */
      .lex-cmp-suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .lex-cmp-suggestion {
        padding: 5px 12px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid var(--lex-chat-border);
        background: var(--lex-chat-bg-surface);
        color: var(--lex-chat-text-muted);
        cursor: pointer;
        transition: background var(--lex-transition-fast, 0.15s), color var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-suggestion:hover {
        background: var(--lex-chat-bg-elevated);
        color: var(--lex-chat-text);
      }

      /* ── Hint ───────────────────────────────────────────────── */
      .lex-cmp-hint {
        font-size: 10px;
        color: var(--lex-chat-text-dim);
        text-align: center;
        padding-top: 6px;
      }

      /* ── Document picker popover ────────────────────────────── */
      .lex-cmp-docpicker {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 0;
        right: 0;
        max-width: 400px;
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        border-radius: var(--lex-radius-lg, 8px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.16);
        z-index: 60;
        opacity: 0;
        transform: translateY(4px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .lex-cmp-docpicker--open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .lex-cmp-docpicker-search {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--lex-chat-border-soft);
      }
      .lex-cmp-docpicker-search svg {
        width: 16px; height: 16px;
        color: var(--lex-chat-text-dim);
        flex-shrink: 0;
      }
      .lex-cmp-docpicker-search input {
        flex: 1;
        border: none;
        background: transparent;
        color: var(--lex-chat-text);
        font-family: var(--lex-font-sans);
        font-size: 13px;
        outline: none;
      }
      .lex-cmp-docpicker-search input::placeholder { color: var(--lex-chat-text-dim); }
      .lex-cmp-docpicker-list {
        max-height: 220px;
        overflow-y: auto;
        padding: 6px;
      }
      .lex-cmp-docpicker-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 24px 16px;
        color: var(--lex-chat-text-dim);
        font-size: 13px;
      }
      .lex-cmp-docpicker-empty svg {
        width: 32px; height: 32px;
        opacity: 0.4;
      }
      .lex-cmp-docpicker-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: var(--lex-radius-md, 6px);
        cursor: pointer;
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-docpicker-item:hover {
        background: var(--lex-chat-bg-elevated);
      }
      .lex-cmp-docpicker-item svg {
        width: 16px; height: 16px;
        color: var(--lex-chat-accent);
        flex-shrink: 0;
      }
      .lex-cmp-docpicker-item-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--lex-chat-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lex-cmp-docpicker-item-meta {
        font-size: 11px;
        color: var(--lex-chat-text-dim);
        margin-left: auto;
        flex-shrink: 0;
      }

      /* ── @-mention popover (mirrors docpicker layout) ───────── */
      .lex-cmp-mentionpicker {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 0;
        right: 0;
        max-width: 400px;
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        border-radius: var(--lex-radius-lg, 8px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.16);
        z-index: 60;
        opacity: 0;
        transform: translateY(4px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .lex-cmp-mentionpicker--open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .lex-cmp-mentionpicker-list {
        max-height: 240px;
        overflow-y: auto;
        padding: 6px;
      }
      .lex-cmp-mentionpicker-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px 16px;
        color: var(--lex-chat-text-dim);
        font-size: 13px;
      }
      .lex-cmp-mentionpicker-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: var(--lex-radius-md, 6px);
        cursor: pointer;
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-mentionpicker-item:hover,
      .lex-cmp-mentionpicker-item--active {
        background: var(--lex-chat-bg-elevated);
      }
      .lex-cmp-mentionpicker-item-kind {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 2px 6px;
        border-radius: 9999px;
        flex-shrink: 0;
      }
      .lex-cmp-mentionpicker-item-kind--user {
        background: var(--lex-chat-bg-elevated, #eef);
        color: var(--lex-chat-text-muted, #555);
      }
      .lex-cmp-mentionpicker-item-kind--agent {
        background: var(--lex-chat-accent, #4f46e5);
        color: var(--lex-chat-accent-text, #fff);
      }
      .lex-cmp-mentionpicker-item-kind--contact {
        background: var(--lex-chat-success-soft, #dcfce7);
        color: var(--lex-chat-success-text, #166534);
      }
      .lex-cmp-mentionpicker-section-header {
        padding: 6px 10px 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--lex-chat-text-muted, #6b7280);
        background: var(--lex-chat-bg-subtle, #f9fafb);
        border-top: 1px solid var(--lex-chat-border-soft, #e5e7eb);
      }
      .lex-cmp-mentionpicker-section-header:first-child {
        border-top: none;
      }
      .lex-cmp-mentionpicker-item-note {
        margin-left: 6px;
        padding: 1px 6px;
        font-size: 10px;
        font-weight: 500;
        color: var(--lex-chat-text-muted, #6b7280);
        background: var(--lex-chat-bg-elevated, #f3f4f6);
        border-radius: 4px;
      }
      .lex-cmp-mentionpicker-item-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--lex-chat-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }
      .lex-cmp-mentionpicker-item-sub {
        font-size: 11px;
        color: var(--lex-chat-text-dim);
        margin-left: auto;
        flex-shrink: 0;
        max-width: 50%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ── /slash-command popover (mirrors mentionpicker layout) ── */
      .lex-cmp-slashpicker {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 0;
        right: 0;
        max-width: 400px;
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        border-radius: var(--lex-radius-lg, 8px);
        box-shadow: 0 8px 24px rgba(0,0,0,0.16);
        z-index: 60;
        opacity: 0;
        transform: translateY(4px);
        pointer-events: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .lex-cmp-slashpicker--open {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .lex-cmp-slashpicker-list {
        max-height: 240px;
        overflow-y: auto;
        padding: 6px;
      }
      .lex-cmp-slashpicker-item {
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 8px 10px;
        border-radius: var(--lex-radius-md, 6px);
        cursor: pointer;
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-cmp-slashpicker-item:hover,
      .lex-cmp-slashpicker-item--active {
        background: var(--lex-chat-bg-elevated);
      }
      .lex-cmp-slashpicker-item-cmd {
        font-family: var(--lex-font-mono, monospace);
        font-size: 13px;
        font-weight: 600;
        color: var(--lex-chat-text);
        flex-shrink: 0;
      }
      .lex-cmp-slashpicker-item-desc {
        font-size: 12px;
        color: var(--lex-chat-text-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Icons (Lucide-style inline SVGs)
  // ---------------------------------------------------------------------------

  const ICON_PLUS     = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`;
  const ICON_ARROW_UP = `<svg fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
  const ICON_STOP     = `<svg fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  const ICON_CLOSE    = `<svg fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  const ICON_WRENCH   = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>`;
  const ICON_FILE     = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const ICON_ZAP      = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  const ICON_EYE      = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const ICON_FOLDER   = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`;
  const ICON_SEARCH   = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`;
  const ICON_FILE_TEXT = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

  // ---------------------------------------------------------------------------
  // Default tool definitions
  // ---------------------------------------------------------------------------

  const DEFAULT_TOOLS = [
    { id: 'document_chat',  label: 'Document Context', icon: ICON_FILE, description: 'Focus answers on selected documents' },
    { id: 'agentic',        label: 'Agentic Mode',     icon: ICON_ZAP,  description: 'AI performs multi-step research and analysis' },
    { id: 'insights_chat',  label: 'Insights Chat',    icon: ICON_EYE,  description: 'Ask about forecasts, trends, and insights' }
  ];

  // ---------------------------------------------------------------------------
  // Component
  // ---------------------------------------------------------------------------

  class LexChatComposer extends LexElement {

    static get properties() {
      return {
        placeholder:  { type: String, default: 'Ask anything...' },
        disabled:     { type: Boolean, default: false, reflect: true },
        generating:   { type: Boolean, default: false, reflect: true },
        maxHeight:    { type: Number, default: 128, attribute: 'max-height' },
        suggestions:  { type: Array, default: [] },
        tools:        { type: Array, default: null },
        activeTools:  { type: Array, default: [] },
        // Optional matter scope. When set, the @-mention typeahead also
        // searches contacts attached to this matter (in addition to org
        // users + discoverable agents). Forwarded to /api/v1/mentions/search
        // as the `matter_id` query param.
        matterId:     { type: String, default: null, attribute: 'matter-id' }
      };
    }

    constructor() {
      super();
      this._textarea = null;
      this._plusOpen = false;
      this._toolsOpen = false;
      this._toolsLocked = false;
      this._docPickerOpen = false;
      this._docPickerQuery = '';
      this._docResults = [];
      this._hashTriggerPos = -1; // caret position of the # character
      this._attachedDocs = []; // { id, filename } — documents attached via # picker
      this._moduleContext = null; // selected reporting module attachment
      this._boundOutsideClick = null;

      // ── @-mention picker state (independent from doc picker) ──
      // The dropdown state machine + helpers live in
      // lex-chat.composer-mentions.js so the logic is unit-testable
      // without the DOM. Resolve them once, gracefully degrade if absent
      // (the composer still works as before — @ is just plain text).
      const helpers = (typeof window !== 'undefined'
                       && window.Lex
                       && window.Lex.Chat
                       && window.Lex.Chat.MentionHelpers) || null;
      this._mentionHelpers = helpers;
      this._mentionState = helpers ? helpers.initialState() : null;
      this._mentionDebounced = helpers
        ? helpers.debounce((prefix) => this._fetchMentions(prefix), 300)
        : null;
      this._mentionAbortCtrl = null;
      this._mentionFetchSeq = 0;
      this._selectedMentions = [];

      // ── /slash-command picker state (independent from the other pickers) ──
      // Trigger detection + dropdown reducer live in
      // lex-chat.composer-slash.js; the command registry lives in
      // js/services/slash-commands.service.js. Both degrade gracefully when
      // absent — `/` stays plain text.
      const slashHelpers = (typeof window !== 'undefined'
                            && window.Lex
                            && window.Lex.Chat
                            && window.Lex.Chat.SlashHelpers) || null;
      this._slashHelpers = slashHelpers;
      this._slashState = slashHelpers ? slashHelpers.initialState() : null;
    }

    connected() {
      injectStyles();
      this._buildDOM();
      this._bindEvents();
      this._boundOutsideClick = (e) => this._onOutsideClick(e);
      document.addEventListener('click', this._boundOutsideClick, true);
    }

    // Imperative DOM — don't re-render after initial build
    render() { return null; }

    disconnected() {
      if (this._boundOutsideClick) {
        document.removeEventListener('click', this._boundOutsideClick, true);
        this._boundOutsideClick = null;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DOM construction
    // ─────────────────────────────────────────────────────────────────────────

    _buildDOM() {
      this.innerHTML = `
        <div class="lex-cmp-suggestions" data-suggestions style="display:none"></div>
        <div class="lex-cmp-pill" style="position:relative">
          <div class="lex-cmp-docpicker" data-docpicker>
            <div class="lex-cmp-docpicker-search">
              ${ICON_SEARCH}
              <input type="text" placeholder="# Search documents..." data-docpicker-input />
            </div>
            <div class="lex-cmp-docpicker-list" data-docpicker-list>
              <div class="lex-cmp-docpicker-empty">
                ${ICON_FILE_TEXT}
                <span>No documents found</span>
              </div>
            </div>
          </div>
          <div class="lex-cmp-mentionpicker" data-mentionpicker>
            <div class="lex-cmp-mentionpicker-list" data-mentionpicker-list>
              <div class="lex-cmp-mentionpicker-empty">No matches</div>
            </div>
          </div>
          <div class="lex-cmp-slashpicker" data-slashpicker>
            <div class="lex-cmp-slashpicker-list" data-slashpicker-list></div>
          </div>
          <div class="lex-cmp-doc-badges" data-doc-badges></div>
          <textarea
            class="lex-cmp-textarea"
            placeholder="${esc(this.placeholder)}"
            rows="1"
            maxlength="${CHAT_MESSAGE_MAX_CODE_UNITS}"
            ${this.disabled ? 'disabled' : ''}
            data-input
          ></textarea>
          <div class="lex-cmp-toolbar">
            <div class="lex-cmp-anchor">
              <button type="button" class="lex-cmp-plus" data-plus title="More options">${ICON_PLUS}</button>
              <div class="lex-cmp-popover lex-cmp-popover--plus" data-pop-plus>
                <div class="lex-cmp-pop-item" data-action="manage-documents">
                  ${ICON_FOLDER}
                  <div>
                    <div class="lex-cmp-pop-label">Manage chat documents</div>
                    <div class="lex-cmp-pop-desc">Add or remove documents for document chat mode</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="lex-cmp-anchor">
              <button type="button" class="lex-cmp-tools-chip" data-tools-btn ${this._toolsLocked ? 'disabled' : ''}>${ICON_WRENCH}<span>Tools</span></button>
              <div class="lex-cmp-popover lex-cmp-popover--tools" data-pop-tools></div>
            </div>
            <span class="lex-cmp-active-chips" data-active-chips></span>
            <div class="lex-cmp-spacer"></div>
            <button type="button" class="lex-cmp-send" data-send ${this.disabled ? 'disabled' : ''} title="Send">${ICON_ARROW_UP}</button>
            <button type="button" class="lex-cmp-stop" data-stop style="display:none" title="Stop">${ICON_STOP}</button>
          </div>
        </div>
        <div class="lex-cmp-hint">Press Enter to send, Shift+Enter for new line</div>`;

      this._textarea = this.querySelector('[data-input]');
      this.style.setProperty('--_cmp-max-h', this.maxHeight + 'px');
      this._refreshToolsPopover();
      this._refreshActiveChips();

      if (this.suggestions?.length > 0) {
        this._renderSuggestions(this.suggestions);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event bindings
    // ─────────────────────────────────────────────────────────────────────────

    _bindEvents() {
      const ta = this._textarea;
      if (!ta) return;

      // Auto-resize on input + # trigger detection + @ trigger detection.
      // The @-trigger is additive: it never blocks the existing # path or
      // suppresses normal typing.
      ta.addEventListener('input', () => {
        this._autoResize();
        this._checkHashTrigger();
        this._checkAtTrigger();
        this._checkSlashTrigger();
      });

      // Enter → send, Shift+Enter → newline, Escape → close picker
      ta.addEventListener('keydown', (e) => {
        // ── /slash-command picker priorities (only when open) ──
        // Never open at the same time as the other pickers: `/` only
        // triggers at position 0, `@`/`#` only after whitespace.
        if (this._isSlashOpen()) {
          if (e.key === 'Escape') {
            e.preventDefault();
            this._slashDispatch({ type: 'DISMISSED' });
            this._refreshSlashPopover();
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._slashDispatch({ type: 'MOVE_DOWN' });
            this._refreshSlashPopover();
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._slashDispatch({ type: 'MOVE_UP' });
            this._refreshSlashPopover();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            // Enter completes the active suggestion — unless the typed
            // token already IS that command, in which case fall through
            // to the normal send path so `/help` + Enter executes.
            const st = this._slashState;
            const active = st && st.results && st.results[st.activeIndex];
            if (active && st.prefix.toLowerCase() !== active.command) {
              e.preventDefault();
              this._selectSlashCommand(active);
              return;
            }
          }
          if (e.key === 'Tab') {
            const st = this._slashState;
            const active = st && st.results && st.results[st.activeIndex];
            if (active) {
              e.preventDefault();
              this._selectSlashCommand(active);
              return;
            }
          }
        }

        // ── @-mention picker priorities (only when open) ──
        if (this._isMentionOpen()) {
          if (e.key === 'Escape') {
            e.preventDefault();
            this._mentionDispatch({ type: 'DISMISSED' });
            this._refreshMentionPopover();
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._mentionDispatch({ type: 'MOVE_DOWN' });
            this._refreshMentionPopover();
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._mentionDispatch({ type: 'MOVE_UP' });
            this._refreshMentionPopover();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            // Insert the active match if there is one; otherwise fall
            // through to the normal send path (covers "no matches" UX).
            const st = this._mentionState;
            if (st && st.results && st.results.length > 0) {
              e.preventDefault();
              this._selectMention(st.results[st.activeIndex]);
              return;
            }
          }
          if (e.key === 'Tab') {
            // Tab also accepts the active match — common keyboard pattern
            // for typeaheads. Falls through silently when no results.
            const st = this._mentionState;
            if (st && st.results && st.results.length > 0) {
              e.preventDefault();
              this._selectMention(st.results[st.activeIndex]);
              return;
            }
          }
        }

        if (e.key === 'Escape' && this._docPickerOpen) {
          this._closeDocPicker();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          if (this._docPickerOpen) {
            e.preventDefault();
            // Select first result if available
            const first = this.querySelector('[data-doc-select]');
            if (first) first.click();
            return;
          }
          e.preventDefault();
          this._handleSend();
        }
      });

      // Document picker search input
      const docInput = this.querySelector('[data-docpicker-input]');
      if (docInput) {
        docInput.addEventListener('input', () => {
          this._docPickerQuery = docInput.value.replace(/^#\s*/, '');
          this.emit('lex-composer-document-search', { query: this._docPickerQuery });
        });
        docInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            this._closeDocPicker();
            this._textarea?.focus();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = this.querySelector('[data-doc-select]');
            if (first) first.click();
          }
        });
      }

      // Send / Stop buttons
      this.querySelector('[data-send]')?.addEventListener('click', () => this._handleSend());
      this.querySelector('[data-stop]')?.addEventListener('click', () => this.emit('lex-composer-stop'));

      // Plus button
      this.querySelector('[data-plus]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._togglePlus();
      });

      // Tools chip
      this.querySelector('[data-tools-btn]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleTools();
      });

      // Delegated clicks for dynamic content (popovers, chips, suggestions)
      this.addEventListener('click', (e) => {
        // Plus popover action
        const actionEl = e.target.closest('[data-action]');
        if (actionEl) {
          this._closePopovers();
          if (actionEl.dataset.action === 'manage-documents') {
            this.emit('lex-composer-manage-documents');
          }
          return;
        }

        // Tool selection from popover
        const toolEl = e.target.closest('[data-tool-id]');
        if (toolEl) {
          this._toggleTool(toolEl.dataset.toolId);
          this._closePopovers();
          return;
        }

        // Active chip dismiss
        const dismissEl = e.target.closest('[data-dismiss-tool]');
        if (dismissEl) {
          this._removeTool(dismissEl.dataset.dismissTool);
          return;
        }

        // Document badge dismiss
        const dismissDocEl = e.target.closest('[data-dismiss-doc]');
        if (dismissDocEl) {
          const docId = dismissDocEl.dataset.dismissDoc;
          this._attachedDocs = this._attachedDocs.filter(d => d.id !== docId);
          this._renderDocBadges();
          this.emit('lex-composer-document-remove', { documentId: docId });
          return;
        }

        // Reporting module badge dismiss
        const dismissModuleEl = e.target.closest('[data-dismiss-module-context]');
        if (dismissModuleEl) {
          const previous = this._moduleContext;
          this._moduleContext = null;
          this._renderDocBadges();
          this.emit('lex-composer-module-context-remove', { moduleContext: previous });
          if (!previous || previous.type !== 'ui_card') {
            this.emit('lex-composer-tool-dismiss', { toolId: 'insights_chat' });
          }
          return;
        }

        // Document picker selection
        const docEl = e.target.closest('[data-doc-select]');
        if (docEl) {
          this._selectDocument(docEl.dataset.docSelect, docEl.dataset.docName);
          return;
        }

        // @-mention picker selection
        const mentionEl = e.target.closest('[data-mention-select]');
        if (mentionEl) {
          const idx = Number(mentionEl.dataset.mentionSelect);
          const st = this._mentionState;
          if (st && Array.isArray(st.results) && st.results[idx]) {
            this._selectMention(st.results[idx]);
          }
          return;
        }

        // /slash-command picker selection
        const slashEl = e.target.closest('[data-slash-select]');
        if (slashEl) {
          const idx = Number(slashEl.dataset.slashSelect);
          const st = this._slashState;
          if (st && Array.isArray(st.results) && st.results[idx]) {
            this._selectSlashCommand(st.results[idx]);
          }
          return;
        }

        // Suggestion
        const suggEl = e.target.closest('[data-suggestion]');
        if (suggEl) {
          this.emit('lex-composer-suggestion', { value: suggEl.dataset.suggestion });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Popovers
    // ─────────────────────────────────────────────────────────────────────────

    _togglePlus() {
      this._plusOpen = !this._plusOpen;
      this._toolsOpen = false;
      this._syncPopovers();
    }

    _toggleTools() {
      if (this._toolsLocked) return;
      this._toolsOpen = !this._toolsOpen;
      this._plusOpen = false;
      this._syncPopovers();
    }

    _closePopovers() {
      this._plusOpen = false;
      this._toolsOpen = false;
      this._syncPopovers();
    }

    _syncPopovers() {
      this.querySelector('[data-pop-plus]')?.classList.toggle('lex-cmp-popover--open', this._plusOpen);
      this.querySelector('[data-pop-tools]')?.classList.toggle('lex-cmp-popover--open', this._toolsOpen);
    }

    _onOutsideClick(e) {
      if ((this._plusOpen || this._toolsOpen) && !this.contains(e.target)) {
        this._closePopovers();
      }
      if (this._docPickerOpen && !this.contains(e.target)) {
        this._closeDocPicker();
      }
      if (this._isMentionOpen() && !this.contains(e.target)) {
        this._mentionDispatch({ type: 'DISMISSED' });
        this._refreshMentionPopover();
      }
      if (this._isSlashOpen() && !this.contains(e.target)) {
        this._slashDispatch({ type: 'DISMISSED' });
        this._refreshSlashPopover();
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tool management
    // ─────────────────────────────────────────────────────────────────────────

    _getTools() { return this.tools || DEFAULT_TOOLS; }

    _toggleTool(id) {
      if (this._toolsLocked) return;
      const active = [...(this.activeTools || [])];
      const idx = active.indexOf(id);
      if (idx >= 0) {
        active.splice(idx, 1);
        this._props.activeTools = active;
        // Deselecting Document Context clears all attached files
        if (id === 'document_chat' && this._attachedDocs.length > 0) {
          const removed = this._attachedDocs.slice();
          this._attachedDocs = [];
          this._renderDocBadges();
          for (const doc of removed) {
            this.emit('lex-composer-document-remove', { documentId: doc.id });
          }
        }
        this.emit('lex-composer-tool-dismiss', { toolId: id });
      } else {
        active.push(id);
        this._props.activeTools = active;
        this.emit('lex-composer-tool-select', { toolId: id });
      }
      this._refreshToolsPopover();
      this._refreshActiveChips();
    }

    _removeTool(id) {
      if (this._toolsLocked) return;
      const active = [...(this.activeTools || [])];
      const idx = active.indexOf(id);
      if (idx < 0) return;
      active.splice(idx, 1);
      this._props.activeTools = active;
      this._refreshToolsPopover();
      this._refreshActiveChips();
      // Dismissing Document Context clears all attached files
      if (id === 'document_chat' && this._attachedDocs.length > 0) {
        const removed = this._attachedDocs.slice();
        this._attachedDocs = [];
        this._renderDocBadges();
        for (const doc of removed) {
          this.emit('lex-composer-document-remove', { documentId: doc.id });
        }
      }
      this.emit('lex-composer-tool-dismiss', { toolId: id });
    }

    _refreshToolsPopover() {
      const container = this.querySelector('[data-pop-tools]');
      if (!container) return;
      const tools = this._getTools();
      const active = this.activeTools || [];

      container.innerHTML = tools.map(t => {
        const isActive = active.includes(t.id);
        return `
          <div class="lex-cmp-pop-item" data-tool-id="${t.id}">
            ${t.icon || ''}
            <div>
              <div class="lex-cmp-pop-label">${esc(t.label)}</div>
              ${t.description ? `<div class="lex-cmp-pop-desc">${esc(t.description)}</div>` : ''}
            </div>
            ${isActive ? '<span class="lex-cmp-pop-check">&#10003;</span>' : ''}
          </div>`;
      }).join('');
    }

    _refreshActiveChips() {
      const container = this.querySelector('[data-active-chips]');
      if (!container) return;
      const tools = this._getTools();
      const active = this.activeTools || [];
      const locked = this._toolsLocked;

      container.innerHTML = active.map(id => {
        const t = tools.find(x => x.id === id);
        if (!t) return '';
        return `
          <div class="lex-cmp-active-chip">
            ${t.icon || ''}
            <span>${esc(t.label)}</span>
            ${locked ? '' : `<button class="lex-cmp-chip-x" data-dismiss-tool="${id}" title="Remove ${esc(t.label)}">${ICON_CLOSE}</button>`}
          </div>`;
      }).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Document badges (attached via # picker)
    // ─────────────────────────────────────────────────────────────────────────

    _renderDocBadges() {
      const container = this.querySelector('[data-doc-badges]');
      if (!container) return;
      if (this._attachedDocs.length === 0 && !this._moduleContext) {
        container.innerHTML = '';
        return;
      }
      const moduleLabel = this._moduleContext
        ? (this._moduleContext.ui_label
          || this._moduleContext.card_title
          || this._moduleContext.module_name
          || this._moduleContext.module_key
          || 'Report')
        : '';
      const moduleBadges = this._moduleContext ? [`
        <div class="lex-cmp-doc-badge lex-cmp-doc-badge--module">
          ${ICON_EYE}
          <span>${esc(moduleLabel)}</span>
          <button class="lex-cmp-doc-badge-x" data-dismiss-module-context title="Remove attached context">${ICON_CLOSE}</button>
        </div>`] : [];
      const docBadges = this._attachedDocs.map(doc => {
        return `
          <div class="lex-cmp-doc-badge">
            ${ICON_FILE}
            <span>${esc(doc.filename)}</span>
            <button class="lex-cmp-doc-badge-x" data-dismiss-doc="${esc(doc.id)}" title="Remove ${esc(doc.filename)}">${ICON_CLOSE}</button>
          </div>`;
      });
      container.innerHTML = moduleBadges.concat(docBadges).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Document picker (#-trigger)
    // ─────────────────────────────────────────────────────────────────────────

    _checkHashTrigger() {
      const ta = this._textarea;
      if (!ta) return;
      const val = ta.value;
      const pos = ta.selectionStart;

      // Detect # at start of input or after whitespace
      if (pos > 0 && val[pos - 1] === '#') {
        const charBefore = pos > 1 ? val[pos - 2] : ' ';
        if (charBefore === ' ' || charBefore === '\n' || pos === 1) {
          this._hashTriggerPos = pos - 1;
          this._openDocPicker();
          return;
        }
      }

      // If picker is open, update search query from text after #
      if (this._docPickerOpen && this._hashTriggerPos >= 0) {
        const afterHash = val.substring(this._hashTriggerPos + 1, pos);
        // Close if user deleted the # or moved away
        if (this._hashTriggerPos >= val.length || val[this._hashTriggerPos] !== '#') {
          this._closeDocPicker();
          return;
        }
        // Close if user typed a space-then-non-search-char pattern (sent the message)
        if (afterHash.includes('\n')) {
          this._closeDocPicker();
          return;
        }
        this._docPickerQuery = afterHash.trim();
        const searchInput = this.querySelector('[data-docpicker-input]');
        if (searchInput) searchInput.value = '# ' + this._docPickerQuery;
        this.emit('lex-composer-document-search', { query: this._docPickerQuery });
      }
    }

    _openDocPicker() {
      this._docPickerOpen = true;
      this._docPickerQuery = '';
      this._closePopovers(); // close other popovers
      const picker = this.querySelector('[data-docpicker]');
      if (picker) picker.classList.add('lex-cmp-docpicker--open');
      const searchInput = this.querySelector('[data-docpicker-input]');
      if (searchInput) {
        searchInput.value = '# ';
        // Focus the search input after a tick so the user can type there
        requestAnimationFrame(() => searchInput.focus());
      }
      // Fire initial search with empty query
      this.emit('lex-composer-document-search', { query: '' });
    }

    _closeDocPicker() {
      this._docPickerOpen = false;
      this._hashTriggerPos = -1;
      const picker = this.querySelector('[data-docpicker]');
      if (picker) picker.classList.remove('lex-cmp-docpicker--open');
    }

    _selectDocument(docId, docName) {
      const hashPos = this._hashTriggerPos; // save before close resets it
      this._closeDocPicker();
      const name = docName || 'document';

      // Enforce max 3 documents
      const alreadyAttached = this._attachedDocs.some(d => d.id === docId);
      if (!alreadyAttached && this._attachedDocs.length >= 3) {
        // Remove #query text, nothing to add
        if (this._textarea && hashPos >= 0) {
          const val = this._textarea.value;
          const pos = this._textarea.selectionStart;
          this._textarea.value = val.substring(0, hashPos) + val.substring(pos);
          this._textarea.selectionStart = this._textarea.selectionEnd = hashPos;
          this._autoResize();
        }
        this._textarea?.focus();
        return;
      }

      // Replace #query with inline reference #filename
      if (this._textarea && hashPos >= 0) {
        const val = this._textarea.value;
        const pos = this._textarea.selectionStart;
        const before = val.substring(0, hashPos);
        const after = val.substring(pos);
        const ref = '#' + name + ' ';
        this._textarea.value = before + ref + after;
        this._textarea.selectionStart = this._textarea.selectionEnd = before.length + ref.length;
        this._autoResize();
      }

      // Track attached document and render badge
      if (!alreadyAttached) {
        this._attachedDocs.push({ id: docId, filename: name });
        this._renderDocBadges();
        // Auto-activate Document Context tool
        const active = this.activeTools || [];
        if (!active.includes('document_chat')) {
          this._props.activeTools = [...active, 'document_chat'];
          this._refreshToolsPopover();
          this._refreshActiveChips();
          this.emit('lex-composer-tool-select', { toolId: 'document_chat' });
        }
      }
      this._textarea?.focus();
      this.emit('lex-composer-document-select', { documentId: docId, filename: docName });
    }

    _refreshDocPickerResults() {
      const list = this.querySelector('[data-docpicker-list]');
      if (!list) return;
      const results = this._docResults || [];

      if (results.length === 0) {
        list.innerHTML = `
          <div class="lex-cmp-docpicker-empty">
            ${ICON_FILE_TEXT}
            <span>No documents found</span>
          </div>`;
        return;
      }

      list.innerHTML = results.map(doc => {
        const name = esc(doc.filename || doc.name || 'Document');
        const id = esc(doc.id || '');
        const meta = doc.pages ? `${doc.pages} pg` : '';
        return `
          <div class="lex-cmp-docpicker-item" data-doc-select="${id}" data-doc-name="${name}">
            ${ICON_FILE}
            <span class="lex-cmp-docpicker-item-name" title="${name}">${name}</span>
            ${meta ? `<span class="lex-cmp-docpicker-item-meta">${meta}</span>` : ''}
          </div>`;
      }).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // @-mention picker
    //
    // Layered above the existing #/document picker. The dropdown state
    // machine + token parser live in lex-chat.composer-mentions.js so the
    // logic can be unit-tested without the DOM. Resolved at construction
    // and gracefully degraded if the helpers script is missing.
    // ─────────────────────────────────────────────────────────────────────────

    _isMentionOpen() {
      return !!(this._mentionState && this._mentionState.open);
    }

    _mentionDispatch(action) {
      if (!this._mentionHelpers) return;
      this._mentionState = this._mentionHelpers.reduce(this._mentionState, action);
    }

    _checkAtTrigger() {
      if (!this._mentionHelpers || !this._textarea) return;
      const val = this._textarea.value;
      const pos = this._textarea.selectionStart;
      const trigger = this._mentionHelpers.detectMentionTrigger(val, pos);

      if (!trigger) {
        // The caret is no longer inside an @-token. Close if open.
        if (this._isMentionOpen()) {
          this._mentionDispatch({ type: 'DISMISSED' });
          this._refreshMentionPopover();
        }
        return;
      }

      if (!this._isMentionOpen()) {
        this._mentionDispatch({
          type: 'TRIGGER_OPENED',
          atIndex: trigger.atIndex,
          prefix: trigger.prefix,
        });
        // Close other popovers so they don't fight for screen space.
        this._closePopovers();
        this._refreshMentionPopover();
        if (this._mentionDebounced) this._mentionDebounced(trigger.prefix);
        return;
      }

      // Already open — update prefix only if it changed (avoids redundant fetches).
      if (trigger.prefix !== this._mentionState.prefix) {
        this._mentionDispatch({ type: 'PREFIX_CHANGED', prefix: trigger.prefix });
        this._refreshMentionPopover();
        if (this._mentionDebounced) this._mentionDebounced(trigger.prefix);
      }
    }

    async _fetchMentions(prefix) {
      // Token + base URL come from the global api client used elsewhere
      // in the chat surface (see lex-chat.js _openCitationDocument). If
      // it's not configured, silently bail — the autocomplete simply
      // shows "No matches".
      const apiClient = (typeof window !== 'undefined') ? window.api : null;
      const baseUrl = apiClient && apiClient.baseUrl ? apiClient.baseUrl : '';
      const token = (apiClient && apiClient.token) || (typeof localStorage !== 'undefined'
                                                       ? localStorage.getItem('token')
                                                       : '') || '';
      const seq = ++this._mentionFetchSeq;
      try {
        // When the chat is matter-scoped, forward the matter id so the
        // backend can also search the matter's attached contacts.
        const matterParam = this.matterId
          ? '&matter_id=' + encodeURIComponent(this.matterId)
          : '';
        const url = baseUrl + '/api/v1/mentions/search?q='
                  + encodeURIComponent(prefix || '')
                  + '&limit=20'
                  + matterParam;
        const resp = await fetch(url, {
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
        });
        if (!resp.ok) {
          // Drop quietly; show empty results so the UI stays responsive.
          if (seq !== this._mentionFetchSeq) return;
          this._mentionDispatch({ type: 'RESULTS_RECEIVED', prefix: prefix, results: [] });
          this._refreshMentionPopover();
          return;
        }
        const body = await resp.json();
        if (seq !== this._mentionFetchSeq) return; // a newer fetch superseded
        const results = Array.isArray(body && body.matches) ? body.matches : [];
        const groups = Array.isArray(body && body.groups) ? body.groups : [];
        this._mentionDispatch({ type: 'RESULTS_RECEIVED', prefix: prefix, results, groups });
        this._refreshMentionPopover();
      } catch (err) {
        if (seq !== this._mentionFetchSeq) return;
        this._mentionDispatch({ type: 'RESULTS_RECEIVED', prefix: prefix, results: [] });
        this._refreshMentionPopover();
      }
    }

    _selectMention(match) {
      if (!match || !this._mentionHelpers || !this._textarea) return;
      const st = this._mentionState;
      if (!st || !st.open) return;
      const value = this._textarea.value;
      const caret = this._textarea.selectionStart;
      const patched = this._mentionHelpers.applyMentionToValue(
        value, st.atIndex, caret, match
      );
      this._textarea.value = patched.value;
      this._textarea.selectionStart = this._textarea.selectionEnd = patched.caret;
      const token = this._mentionHelpers.buildMentionToken(match);
      if (token) {
        const mention = {
          id: match.id || null,
          kind: match.kind || 'user',
          label: match.label || '',
          username: match.username || '',
          email: match.email || '',
          token: token,
          share_eligible: match.share_eligible !== false
        };
        this._selectedMentions = this._selectedMentions.filter(function (m) {
          return !(m && m.token === mention.token && m.id === mention.id);
        });
        this._selectedMentions.push(mention);
      }
      this._autoResize();
      this._mentionDispatch({ type: 'CLOSED' });
      this._refreshMentionPopover();
      this._textarea.focus();
      this.emit('lex-composer-mention-select', { match });
    }

    _refreshMentionPopover() {
      const picker = this.querySelector('[data-mentionpicker]');
      const list = this.querySelector('[data-mentionpicker-list]');
      if (!picker || !list) return;

      const st = this._mentionState;
      if (!st || !st.open) {
        picker.classList.remove('lex-cmp-mentionpicker--open');
        return;
      }
      picker.classList.add('lex-cmp-mentionpicker--open');

      const results = Array.isArray(st.results) ? st.results : [];
      if (results.length === 0) {
        const hint = st.status === 'pending' ? 'Searching…' : 'No matches';
        list.innerHTML = `<div class="lex-cmp-mentionpicker-empty">${esc(hint)}</div>`;
        return;
      }

      // Renders one row in the popover. The flatIndex is the index into
      // st.results (the same array keyboard nav walks), so clicking and
      // arrow-key navigation both resolve back to the same selection.
      const renderRow = (m, flatIndex) => {
        const isActive = flatIndex === st.activeIndex;
        let kindClass;
        let kindLabel;
        let sub;
        if (m.kind === 'agent') {
          kindClass = 'lex-cmp-mentionpicker-item-kind--agent';
          kindLabel = 'Agent';
          sub = m.description || (m.slug ? '@' + m.slug : '');
        } else if (m.kind === 'contact') {
          kindClass = 'lex-cmp-mentionpicker-item-kind--contact';
          kindLabel = 'Contact';
          // Prefer email; fall back to company so the row stays informative
          // even when an email isn't on file.
          sub = m.email || m.company || '';
        } else {
          kindClass = 'lex-cmp-mentionpicker-item-kind--user';
          kindLabel = 'User';
          sub = m.username ? '@' + m.username : (m.email || '');
        }
        // Show a small hint when a user can't be shared with directly
        // (agents and external contacts) so the user knows the @-mention
        // is reference-only, not a sharing target. For share-eligible
        // rows the badge stays clean.
        const eligibilityNote = (m.share_eligible === false && m.kind !== 'agent')
          ? '<span class="lex-cmp-mentionpicker-item-note" title="Reference only — cannot be granted matter access">reference</span>'
          : '';
        return `
          <div class="lex-cmp-mentionpicker-item${isActive ? ' lex-cmp-mentionpicker-item--active' : ''}"
               data-mention-select="${flatIndex}">
            <span class="lex-cmp-mentionpicker-item-kind ${kindClass}">${esc(kindLabel)}</span>
            <span class="lex-cmp-mentionpicker-item-label" title="${esc(m.label || '')}">${esc(m.label || '')}</span>
            ${sub ? `<span class="lex-cmp-mentionpicker-item-sub">${esc(sub)}</span>` : ''}
            ${eligibilityNote}
          </div>`;
      };

      // Sectioned render when the API returned groups; otherwise flat.
      // The flat-index counter keeps click/keyboard nav addressing the
      // same st.results array regardless of section.
      const groups = Array.isArray(st.groups) ? st.groups : [];
      if (groups.length > 0) {
        let flatIndex = 0;
        const html = groups.map((g) => {
          const matches = Array.isArray(g.matches) ? g.matches : [];
          if (matches.length === 0) return '';
          const header = `<div class="lex-cmp-mentionpicker-section-header">${esc(g.label || '')}</div>`;
          const rows = matches.map((m) => renderRow(m, flatIndex++)).join('');
          return header + rows;
        }).join('');
        list.innerHTML = html;
      } else {
        list.innerHTML = results.map((m, idx) => renderRow(m, idx)).join('');
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /slash-command picker
    //
    // Trigger detection + dropdown reducer live in
    // lex-chat.composer-slash.js; the command registry (and send-time
    // execution) lives in js/services/slash-commands.service.js. Both are
    // resolved lazily and degrade gracefully when absent.
    // ─────────────────────────────────────────────────────────────────────────

    _isSlashOpen() {
      return !!(this._slashState && this._slashState.open);
    }

    _slashDispatch(action) {
      if (!this._slashHelpers) return;
      this._slashState = this._slashHelpers.reduce(this._slashState, action);
    }

    _getSlashService() {
      return (typeof window !== 'undefined' && window.SlashCommandsService) || null;
    }

    _checkSlashTrigger() {
      const service = this._getSlashService();
      if (!this._slashHelpers || !service || !this._textarea) return;
      const trigger = this._slashHelpers.detectSlashTrigger(
        this._textarea.value, this._textarea.selectionStart
      );

      if (!trigger) {
        if (this._isSlashOpen()) {
          this._slashDispatch({ type: 'DISMISSED' });
          this._refreshSlashPopover();
        }
        return;
      }

      // Registry filtering is local + synchronous, so open and update
      // carry their results directly (no pending state, no debounce).
      const results = service.getMatchingCommands(trigger.prefix.toLowerCase());
      if (!this._isSlashOpen()) {
        if (results.length === 0) return; // nothing to suggest — stay closed
        this._slashDispatch({ type: 'OPENED', prefix: trigger.prefix, results });
        this._closePopovers();
      } else {
        this._slashDispatch({ type: 'PREFIX_CHANGED', prefix: trigger.prefix, results });
      }
      this._refreshSlashPopover();
    }

    _selectSlashCommand(entry) {
      if (!entry || !this._slashHelpers || !this._textarea) return;
      const patched = this._slashHelpers.applyCommandToValue(
        this._textarea.value, this._textarea.selectionStart, entry.command
      );
      this._textarea.value = patched.value;
      this._textarea.selectionStart = this._textarea.selectionEnd = patched.caret;
      this._autoResize();
      this._slashDispatch({ type: 'CLOSED' });
      this._refreshSlashPopover();
      this._textarea.focus();
    }

    _refreshSlashPopover() {
      const picker = this.querySelector('[data-slashpicker]');
      const list = this.querySelector('[data-slashpicker-list]');
      if (!picker || !list) return;

      const st = this._slashState;
      if (!st || !st.open || st.results.length === 0) {
        picker.classList.remove('lex-cmp-slashpicker--open');
        return;
      }
      picker.classList.add('lex-cmp-slashpicker--open');

      list.innerHTML = st.results.map((entry, idx) => {
        const isActive = idx === st.activeIndex;
        return `
          <div class="lex-cmp-slashpicker-item${isActive ? ' lex-cmp-slashpicker-item--active' : ''}"
               data-slash-select="${idx}">
            <span class="lex-cmp-slashpicker-item-cmd">${esc(entry.command)}</span>
            <span class="lex-cmp-slashpicker-item-desc" title="${esc(entry.usage || '')}">${esc(entry.description || '')}</span>
          </div>`;
      }).join('');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Textarea helpers
    // ─────────────────────────────────────────────────────────────────────────

    _autoResize() {
      if (!this._textarea) return;
      this._textarea.style.height = 'auto';
      this._textarea.style.height = Math.min(this._textarea.scrollHeight, this.maxHeight) + 'px';
    }

    _handleSend() {
      const value = this.getValue();
      if (!value) return;
      if (value.length > CHAT_MESSAGE_MAX_CODE_UNITS) {
        this.emit('lex-composer-validation-error', {
          code: 'VALIDATION_ERROR',
          field: 'message',
          message: `Message must be ${CHAT_MESSAGE_MAX_CODE_UNITS} characters or fewer.`
        });
        return;
      }
      const docs = this.getAttachedDocuments();
      const detail = { content: value };
      if (docs.length > 0) {
        detail.attachments = { files: docs.map(d => ({ file_id: d.id, name: d.filename })) };
      }
      const people = (this._selectedMentions || [])
        .filter(function (m) { return m && m.token && value.indexOf(m.token) !== -1; })
        .map(function (m) {
          return {
            user_id: m.kind === 'user' ? m.id : null,
            id: m.id,
            kind: m.kind,
            label: m.label,
            username: m.username,
            email: m.email,
            token: m.token,
            share_eligible: m.share_eligible !== false
          };
        });
      if (people.length > 0) {
        detail.attachments = detail.attachments || {};
        detail.attachments.people = people;
      }
      if (this._moduleContext) {
        detail.attachments = detail.attachments || {};
        detail.attachments.module_context = this._moduleContext;
      }
      this.emit('lex-composer-send', detail);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    focus() { this._textarea?.focus(); }

    clear() {
      if (this._textarea) {
        this._textarea.value = '';
        this._textarea.style.height = 'auto';
      }
      this._attachedDocs = [];
      this._selectedMentions = [];
      this._renderDocBadges();
    }

    getValue() {
      return this._textarea ? this._textarea.value.trim() : '';
    }

    setValue(text) {
      if (this._textarea) {
        this._textarea.value = text;
        this._autoResize();
      }
    }

    /**
     * Override the visible placeholder without touching the `placeholder`
     * prop (which stays the canonical default). Pass a falsy value to
     * restore the default — used by hosts to reflect transient context,
     * e.g. the dock's workspace scope.
     */
    setPlaceholder(text) {
      if (!this._textarea) return;
      this._textarea.placeholder = text || this.placeholder || 'Ask anything...';
    }

    /**
     * Toggle generating state without re-render.
     */
    setGenerating(val) {
      this._props.generating = val;
      const send = this.querySelector('[data-send]');
      const stop = this.querySelector('[data-stop]');
      if (send) send.style.display = val ? 'none' : '';
      if (stop) stop.style.display = val ? '' : 'none';
    }

    /**
     * Hide suggestion chips.
     */
    hideSuggestions() {
      const el = this.querySelector('[data-suggestions]');
      if (el) el.style.display = 'none';
    }

    /**
     * Render suggestion buttons.
     */
    _renderSuggestions(items) {
      const el = this.querySelector('[data-suggestions]');
      if (!el || !items?.length) return;
      el.style.display = '';
      el.innerHTML = items.map(s => {
        const label = typeof s === 'string' ? s : s.label;
        const value = typeof s === 'string' ? s : (s.value || s.label);
        return `<button type="button" class="lex-cmp-suggestion" data-suggestion="${esc(value)}">${esc(label)}</button>`;
      }).join('');
    }

    /**
     * Set active tools programmatically.
     */
    setActiveTools(ids) {
      this._props.activeTools = ids || [];
      this._refreshToolsPopover();
      this._refreshActiveChips();
    }

    /**
     * Lock or unlock tools. When locked, the tools button is disabled and
     * active tool chips cannot be dismissed.
     */
    setToolsLocked(locked) {
      this._toolsLocked = !!locked;
      const btn = this.querySelector('[data-tools-btn]');
      if (btn) {
        if (this._toolsLocked) btn.setAttribute('disabled', '');
        else btn.removeAttribute('disabled');
      }
      this._refreshActiveChips();
    }

    /**
     * Set document search results (called by parent in response to lex-composer-document-search).
     * @param {Array} results - [{ id, filename, name, pages }]
     */
    setDocumentResults(results) {
      this._docResults = results || [];
      this._refreshDocPickerResults();
    }

    /**
     * Programmatically attach a document badge (no textarea text mutation).
     * Use this to pre-populate the composer with a file context.
     * @param {string} docId
     * @param {string} filename
     */
    attachDocument(docId, filename) {
      if (!docId) return;
      const alreadyAttached = this._attachedDocs.some(d => d.id === docId);
      if (alreadyAttached) return;
      if (this._attachedDocs.length >= 3) return;
      this._attachedDocs.push({ id: docId, filename: filename || 'Document' });
      this._renderDocBadges();
    }

    /**
     * Remove a document badge by id.
     */
    removeDocument(docId) {
      this._attachedDocs = this._attachedDocs.filter(d => d.id !== docId);
      this._renderDocBadges();
    }

    /**
     * Get currently attached documents.
     * @returns {Array<{id: string, filename: string}>}
     */
    getAttachedDocuments() {
      return this._attachedDocs.slice();
    }

    attachModuleContext(moduleContext) {
      if (!moduleContext) return;
      this._moduleContext = { ...moduleContext };
      this._renderDocBadges();
      const contextType = String(moduleContext.context_type || moduleContext.type || '').toLowerCase();
      const documentContext = new Set([
        'document_chat',
        'document_edit',
        'editor_selection',
        'editor_revision',
        'office_document',
        'office_selection',
        'tracked_change'
      ]).has(contextType);
      if (moduleContext.type !== 'ui_card' && !documentContext) {
        const active = new Set(this.activeTools || []);
        active.add('insights_chat');
        this.setActiveTools(Array.from(active));
      }
    }

    clearModuleContext() {
      const previous = this._moduleContext;
      this._moduleContext = null;
      this._renderDocBadges();
      return previous;
    }

    getModuleContext() {
      return this._moduleContext ? { ...this._moduleContext } : null;
    }
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChatComposer = LexChatComposer;

})(typeof window !== 'undefined' ? window : globalThis);

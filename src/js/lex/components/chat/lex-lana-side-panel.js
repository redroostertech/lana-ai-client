/* ==========================================================================
   Lex UI — <lex-lana-side-panel>
   Conversation details column beside the chat stream in the Ask LANA dock's
   full screen mode. Loaded on demand by lex-lana-dock (not listed on pages)
   and shown only while the dock is full screen; it scrolls on its own.

   Cards (each collapsible, collapsed state remembered per viewer; each
   with its own loading, empty and error state, so one failed request never
   breaks the panel):
     Scope:     the conversation's workspace (name wraps to two lines).
                "Change" asks the dock to open its workspace picker in the
                card; "View details" opens the workspace page.
     Context:   how full the model's context window was on the latest
                answer: percent bar, tokens used of the window, the usable
                window, the breakdown (system, history, sources, tools) and
                when it was taken. "Not recorded" when the backend has no
                numbers for that answer, never zero.
     Sources:   every document, legal authority and record cited across the
                whole conversation (GET .../sources), plus the citations of
                turns the server has not returned yet, merged by the same
                keys as Lex.Chat.SourcesAggregate. Without a saved
                conversation, or when the request fails, it falls back to
                the loaded messages. Clicking one goes through lex-chat's
                own citation / record open handlers.
     Outputs:   records LANA created or changed, drafts, documents saved
                from drafts and approvals, with a status badge and a link
                (through Lex.Nav) when the backend sends a view_url the
                client has a page for.
     Activity:  tool calls (start paired with end by call id: label,
                duration, success, summary) and agent runs with their steps,
                and a running line while a response is in progress.

   Data, per conversation (re-fetched when the dock switches conversation
   and after every turn; one debounced request set at a time, only while
   the panel is shown):
     GET /api/v1/conversations/:id/context, /sources, /outputs and
     /activity/history?limit=200, through Lex.Chat.ConversationsApiClient.
   Live, from the lex-chat element during a turn:
     lex-chat-context-usage (the last one wins), lex-chat-entity-change,
     lex-chat-tool-start / lex-chat-tool-end, lex-chat-response-start,
     lex-chat-response-end (the turn's sources), lex-chat-turn-end,
     lex-chat-generation-active (a response running elsewhere) and
     lex-chat-conversation-created.
   Live rows stay until a request made after their turn ended comes back,
   since the server holds them from then on. Mapping and merging live in
   lex-lana-side-panel.data.js (Lex.Chat.SidePanelData), loaded first.

   Usage (by lex-lana-dock):
     var side = document.createElement('lex-lana-side-panel');
     body.appendChild(side);
     side.attachChat(chatEl);
     side.setScope({ workspaceName, matterId, documentName });

   Events (bubble + compose):
     lex-lana-side-panel-scope-change — { anchor } the Change button was
       pressed; the dock opens its scope picker inside `anchor`.

   Also exports Lex.Chat.SourcesAggregate.aggregate(messages), the pure
   merge of the loaded messages' citations used by the Sources card.
   ========================================================================== */

(function (global) {
  'use strict';

  var Lex = global.Lex;
  if (!Lex || !Lex.LexElement) { console.error('[lex-lana-side-panel] LexElement not loaded'); return; }

  var COLLAPSED_KEY = 'lana:lanaDock:sideCards';
  var SOURCES_PREVIEW = 6;
  var OUTPUTS_PREVIEW = 6;
  var ACTIVITY_PREVIEW = 8;
  var REFRESH_DEBOUNCE_MS = 200;
  var FETCH_DEBOUNCE_MS = 250;
  var ACTIVITY_LIMIT = 200;
  var CARDS = [['scope', 'Scope'], ['context', 'Context'], ['sources', 'Sources'], ['outputs', 'Outputs'], ['activity', 'Activity']];
  var REMOTE_CARDS = ['context', 'sources', 'outputs', 'activity'];

  // ---------------------------------------------------------------------------
  // Sources aggregation (pure)
  // ---------------------------------------------------------------------------

  function evidence() {
    return (Lex.Chat && Lex.Chat.Evidence) || null;
  }

  function str(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function citationDocumentId(c) {
    var type = String(c.sourceType || c.source_type || '').toLowerCase();
    return str(c.document_id) || str(c.documentId) || str(c.doc_id)
      || ((type === 'document' || type === 'chunk') ? str(c.sourceRef) : '');
  }

  function citationLabel(c) {
    var display = Lex.Chat && typeof Lex.Chat.documentCitationDisplayName === 'function'
      ? Lex.Chat.documentCitationDisplayName(c)
      : null;
    return display || str(c.label) || str(c.filename) || str(c.citation) || str(c.title) || str(c.name) || 'Unknown source';
  }

  /**
   * Merge the evidence of every message into one list per kind.
   * @param {Array<{citations?: Array, references?: Array}>} messages
   * @returns {{ groups: Array<{key, label, items}>, total: number, citationCount: number }}
   *   Each item: { key, kind, label, citeCount, pages (documents only),
   *   entityType (records only), citation | reference (first occurrence) }.
   */
  function aggregate(messages) {
    var ev = evidence();
    var kindOf = ev ? ev.citationKind : function () { return 'other'; };
    var pageOf = ev ? ev.citationPage : function () { return null; };
    var buckets = { document: new Map(), authority: new Map(), other: new Map(), record: new Map() };
    var order = 0;
    var citationCount = 0;

    function bump(map, key, create) {
      var entry = map.get(key);
      if (!entry) {
        entry = create();
        entry.citeCount = 0;
        entry.firstSeen = order++;
        map.set(key, entry);
      }
      entry.citeCount += 1;
      return entry;
    }

    (Array.isArray(messages) ? messages : []).forEach(function (msg) {
      if (!msg) return;
      (Array.isArray(msg.citations) ? msg.citations : []).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        citationCount += 1;
        var kind = kindOf(c);
        var label = citationLabel(c);
        if (kind === 'document') {
          var docId = citationDocumentId(c);
          var entry = bump(buckets.document, docId || ('label:' + label.toLowerCase()), function () {
            return { kind: 'document', label: label, documentId: docId, pages: [], citation: c };
          });
          var page = pageOf(c);
          if (page && entry.pages.indexOf(page) === -1) entry.pages.push(page);
        } else if (kind === 'authority') {
          var authId = str(c.authority_id) || str(c.authorityId);
          bump(buckets.authority, authId || ('label:' + label.toLowerCase()), function () {
            return { kind: 'authority', label: label, citation: c };
          });
        } else {
          bump(buckets.other, 'label:' + label.toLowerCase(), function () {
            return { kind: 'other', label: label, citation: c };
          });
        }
      });
      (Array.isArray(msg.references) ? msg.references : []).forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        var label = str(r.label) || str(r.title) || str(r.name) || str(r.id) || 'Record';
        var type = str(r.type) || str(r.entity_type) || 'record';
        var id = str(r.entity_id) || str(r.id);
        bump(buckets.record, type + ':' + (id || label.toLowerCase()), function () {
          return { kind: 'record', label: label, entityType: type, reference: r };
        });
      });
    });

    function finish(map) {
      var items = Array.from(map.entries()).map(function (pair) {
        var item = pair[1];
        item.key = pair[0];
        if (item.pages) item.pages.sort(function (a, b) { return a - b; });
        return item;
      });
      // Most cited first; ties keep the order LANA first cited them.
      items.sort(function (a, b) { return (b.citeCount - a.citeCount) || (a.firstSeen - b.firstSeen); });
      items.forEach(function (item) { delete item.firstSeen; });
      return items;
    }

    var groups = [
      { key: 'documents', label: 'Documents', items: finish(buckets.document) },
      { key: 'authority', label: 'Legal authority', items: finish(buckets.authority) },
      { key: 'records', label: 'Records', items: finish(buckets.record) },
      { key: 'other', label: 'Other sources', items: finish(buckets.other) }
    ].filter(function (g) { return g.items.length > 0; });

    return {
      groups: groups,
      total: groups.reduce(function (sum, g) { return sum + g.items.length; }, 0),
      citationCount: citationCount
    };
  }

  Lex.Chat = Lex.Chat || {};
  Lex.Chat.SourcesAggregate = { aggregate: aggregate };

  // ---------------------------------------------------------------------------
  // Component
  // ---------------------------------------------------------------------------

  var CARET_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 9l6 6 6-6z"/></svg>';
  var BRIEFCASE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';
  var FILE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  var SCALE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 7a4 4 0 0 0 6 0z"/><path d="M19 7l-3 7a4 4 0 0 0 6 0z"/><path d="M8 21h8"/></svg>';
  var RECORD_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10"/><path d="M7 13h10"/><path d="M7 17h6"/></svg>';
  var TOOL_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>';
  var RUN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/></svg>';
  var APPROVAL_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>';
  var KIND_ICON = { document: FILE_SVG, authority: SCALE_SVG, record: RECORD_SVG, other: FILE_SVG };
  var OUTPUT_ICON = { entity_change: RECORD_SVG, draft: FILE_SVG, document: FILE_SVG, approval: APPROVAL_SVG };

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.id = 'lex-lana-side-panel-styles';
    style.textContent = ''
      + 'lex-lana-side-panel {'
      + '  display: flex;'
      + '  flex-direction: column;'
      + '  gap: 12px;'
      + '  width: 320px;'
      + '  flex-shrink: 0;'
      + '  box-sizing: border-box;'
      + '  padding: 16px;'
      + '  overflow-y: auto;'
      + '  border-left: 1px solid var(--lex-border-subtle, #e5e7eb);'
      + '  background: var(--lex-surface-primary, #fff);'
      + '}'
      + 'lex-lana-side-panel .llsp-card {'
      + '  border: 1px solid var(--lex-border-subtle, #e5e7eb);'
      + '  border-radius: var(--lex-radius-lg, 12px);'
      + '  background: var(--lex-bg-card, var(--lex-surface-primary, #fff));'
      + '  flex-shrink: 0;'
      + '}'
      + 'lex-lana-side-panel .llsp-card-head {'
      + '  display: flex;'
      + '  align-items: center;'
      + '  gap: 6px;'
      + '  width: 100%;'
      + '  padding: 12px 14px;'
      + '  background: none;'
      + '  border: none;'
      + '  cursor: pointer;'
      + '  font: inherit;'
      + '  font-size: 13px;'
      + '  font-weight: 600;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  text-align: left;'
      + '  border-radius: var(--lex-radius-lg, 12px);'
      + '}'
      + 'lex-lana-side-panel .llsp-card-head:focus-visible { outline: 2px solid var(--lex-chat-accent, #4f46e5); outline-offset: -2px; }'
      + 'lex-lana-side-panel .llsp-caret { color: var(--lex-text-tertiary, #9ca3af); line-height: 0; transition: transform 0.15s; }'
      + 'lex-lana-side-panel .llsp-card[data-collapsed="true"] .llsp-caret { transform: rotate(-90deg); }'
      + 'lex-lana-side-panel .llsp-count {'
      + '  margin-left: auto;'
      + '  font-size: 12px;'
      + '  font-weight: 500;'
      + '  color: var(--lex-text-tertiary, #9ca3af);'
      + '  font-variant-numeric: tabular-nums;'
      + '}'
      + 'lex-lana-side-panel .llsp-card-body { padding: 0 14px 14px; }'
      + 'lex-lana-side-panel .llsp-card[data-collapsed="true"] .llsp-card-body { display: none; }'
      + 'lex-lana-side-panel .llsp-scope-row { position: relative; min-width: 0; }'
      + 'lex-lana-side-panel .llsp-scope-main,'
      + 'lex-lana-side-panel .llsp-scope-doc {'
      + '  display: flex;'
      + '  align-items: flex-start;'
      + '  gap: 8px;'
      + '  min-width: 0;'
      + '}'
      + 'lex-lana-side-panel .llsp-scope-main .llsp-icon,'
      + 'lex-lana-side-panel .llsp-scope-doc .llsp-icon { margin-top: 2px; }'
      + 'lex-lana-side-panel .llsp-scope-doc { margin-top: 10px; }'
      /* Actions line up under the name, past the icon. */
      + 'lex-lana-side-panel .llsp-scope-actions {'
      + '  display: flex;'
      + '  flex-wrap: wrap;'
      + '  gap: 6px;'
      + '  margin: 10px 0 0 23px;'
      + '}'
      + 'lex-lana-side-panel .llsp-icon { flex-shrink: 0; line-height: 0; color: var(--lex-text-secondary, #6b7280); }'
      + 'lex-lana-side-panel .llsp-scope-name {'
      + '  flex: 1;'
      + '  min-width: 0;'
      + '  font-size: 13px;'
      + '  line-height: 1.4;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  overflow: hidden;'
      + '  overflow-wrap: anywhere;'
      + '  display: -webkit-box;'
      + '  -webkit-box-orient: vertical;'
      + '  -webkit-line-clamp: 2;'
      + '}'
      + 'lex-lana-side-panel .llsp-scope-name.is-empty { color: var(--lex-text-tertiary, #9ca3af); }'
      + 'lex-lana-side-panel .llsp-link {'
      + '  flex-shrink: 0;'
      + '  background: none;'
      + '  border: none;'
      + '  padding: 2px 4px;'
      + '  font: inherit;'
      + '  font-size: 12px;'
      + '  color: var(--lex-chat-accent, #4f46e5);'
      + '  cursor: pointer;'
      + '  border-radius: 4px;'
      + '}'
      + 'lex-lana-side-panel .llsp-link:hover { text-decoration: underline; }'
      /* The dock's scope picker opens inside the Scope row. */
      + 'lex-lana-side-panel .lld-scope-menu { left: 0; right: 0; width: auto; }'
      + 'lex-lana-side-panel .llsp-group + .llsp-group { margin-top: 12px; }'
      + 'lex-lana-side-panel .llsp-group-label {'
      + '  font-size: 11px;'
      + '  font-weight: 600;'
      + '  letter-spacing: 0.04em;'
      + '  text-transform: uppercase;'
      + '  color: var(--lex-text-tertiary, #9ca3af);'
      + '  margin-bottom: 4px;'
      + '}'
      + 'lex-lana-side-panel .llsp-source {'
      + '  display: flex;'
      + '  align-items: flex-start;'
      + '  gap: 8px;'
      + '  width: 100%;'
      + '  padding: 6px;'
      + '  margin: 0 -6px;'
      + '  box-sizing: content-box;'
      + '  background: none;'
      + '  border: none;'
      + '  border-radius: var(--lex-radius-md, 6px);'
      + '  font: inherit;'
      + '  text-align: left;'
      + '  cursor: pointer;'
      + '}'
      + 'lex-lana-side-panel .llsp-source:hover { background: var(--lex-bg-hover, #f3f4f6); }'
      + 'lex-lana-side-panel .llsp-source .llsp-icon { margin-top: 1px; }'
      + 'lex-lana-side-panel .llsp-source-text { flex: 1; min-width: 0; }'
      + 'lex-lana-side-panel .llsp-source-label {'
      + '  display: block;'
      + '  font-size: 13px;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  overflow: hidden;'
      + '  text-overflow: ellipsis;'
      + '  white-space: nowrap;'
      + '}'
      + 'lex-lana-side-panel .llsp-source-meta {'
      + '  display: block;'
      + '  font-size: 11px;'
      + '  color: var(--lex-text-tertiary, #9ca3af);'
      + '  margin-top: 1px;'
      + '}'
      + 'lex-lana-side-panel .llsp-empty {'
      + '  font-size: 12px;'
      + '  line-height: 1.5;'
      + '  color: var(--lex-text-tertiary, #9ca3af);'
      + '  margin: 0;'
      + '}'
      + 'lex-lana-side-panel .llsp-more { margin-top: 8px; padding-left: 0; }'
      /* Totals and "as of" lines above and below a card's rows. */
      + 'lex-lana-side-panel .llsp-totals,'
      + 'lex-lana-side-panel .llsp-meta-line {'
      + '  font-size: 11px;'
      + '  line-height: 1.5;'
      + '  color: var(--lex-text-tertiary, #9ca3af);'
      + '  margin: 0 0 8px;'
      + '}'
      + 'lex-lana-side-panel .llsp-meta-line { margin: 10px 0 0; }'
      + 'lex-lana-side-panel .llsp-note { margin-top: 10px; }'
      + 'lex-lana-side-panel .llsp-retry { padding-left: 0; margin-top: 4px; }'
      + 'lex-lana-side-panel .llsp-loading { display: block; padding: 2px 0; }'
      + 'lex-lana-side-panel .llsp-loading > div { justify-content: flex-start; }'
      + 'lex-lana-side-panel .llsp-context-head {'
      + '  display: flex;'
      + '  align-items: center;'
      + '  gap: 8px;'
      + '  margin-bottom: 6px;'
      + '  font-size: 13px;'
      + '  font-weight: 600;'
      + '  color: var(--lex-text-primary, #111827);'
      + '  font-variant-numeric: tabular-nums;'
      + '}'
      + 'lex-lana-side-panel .llsp-stats { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }'
      + 'lex-lana-side-panel .llsp-stats + .llsp-group { margin-top: 12px; }'
      /* Rows that open nothing keep the row layout without the hover. */
      + 'lex-lana-side-panel .llsp-source.is-static { cursor: default; }'
      + 'lex-lana-side-panel .llsp-source.is-static:hover { background: none; }'
      + 'lex-lana-side-panel .llsp-row-badge { flex-shrink: 0; line-height: 0; margin-top: 1px; }'
      + 'lex-lana-side-panel .llsp-source-summary {'
      + '  display: -webkit-box;'
      + '  -webkit-box-orient: vertical;'
      + '  -webkit-line-clamp: 2;'
      + '  overflow: hidden;'
      + '  font-size: 12px;'
      + '  line-height: 1.4;'
      + '  color: var(--lex-text-secondary, #6b7280);'
      + '  margin-top: 2px;'
      + '}'
      + 'lex-lana-side-panel .llsp-running {'
      + '  display: flex;'
      + '  align-items: center;'
      + '  gap: 8px;'
      + '  font-size: 12px;'
      + '  color: var(--lex-text-secondary, #6b7280);'
      + '  margin-bottom: 10px;'
      + '}'
      + 'lex-lana-side-panel .llsp-running lex-spinner { flex-shrink: 0; }';
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function pagesText(pages) {
    if (!pages || !pages.length) return '';
    var shown = pages.slice(0, 4).join(', ');
    return (pages.length === 1 ? 'p. ' : 'pp. ') + shown + (pages.length > 4 ? ', ...' : '');
  }

  function readCollapsed() {
    try {
      var parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }

  function writeCollapsed(state) {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state)); } catch (_) { /* restricted context */ }
  }

  function data() {
    return (Lex.Chat && Lex.Chat.SidePanelData) || null;
  }

  /** "2:36 PM" today, "10/29/2026 2:36 PM" before that. */
  function timeText(iso) {
    var Utils = Lex.Utils;
    if (!iso || !Utils) return '';
    var date = typeof Utils.parseApiUtcDate === 'function' ? Utils.parseApiUtcDate(iso) : new Date(iso);
    if (!date || isNaN(date.getTime())) return '';
    var today = new Date();
    var sameDay = date.toDateString() === today.toDateString();
    if (sameDay && typeof Utils.formatTime === 'function') return Utils.formatTime(iso);
    return typeof Utils.formatDateTime === 'function' ? Utils.formatDateTime(iso) : '';
  }

  // What the endpoints returned for the conversation on screen, per card.
  // status: idle (no saved conversation) | loading | ready | error.
  function freshRemote() {
    var remote = {};
    REMOTE_CARDS.forEach(function (key) { remote[key] = { status: 'idle', value: null }; });
    return remote;
  }

  // What the turns of this session added that the server may not hold yet.
  // Each row carries the `turn` it arrived in.
  function freshLive() {
    return { context: null, contextSeq: 0, outputs: [], calls: [], turnMessages: [] };
  }

  var LOADING_HTML = '<lex-spinner class="llsp-loading" size="sm" label="Loading..."></lex-spinner>';

  function errorHtml(what) {
    return '<p class="llsp-empty">Could not load ' + escapeHtml(what) + '.</p>'
      + '<button type="button" class="llsp-link llsp-retry">Try again</button>';
  }

  function badgeHtml(badge) {
    if (!badge) return '';
    return '<span class="llsp-row-badge"><lex-badge label="' + escapeHtml(badge.label) + '" color="'
      + escapeHtml(badge.color) + '" size="sm"></lex-badge></span>';
  }

  function kvHtml(label, value) {
    return '<lex-kv direction="horizontal" label="' + escapeHtml(label) + '" value="' + escapeHtml(value) + '"></lex-kv>';
  }

  class LexLanaSidePanel extends Lex.LexElement {
    constructor() {
      super();
      this._chatEl = null;
      this._observer = null;
      this._refreshTimer = null;
      this._active = false;
      this._scope = { workspaceName: '', matterId: '', documentName: '' };
      this._sources = { groups: [], total: 0, citationCount: 0 };
      this._outputs = { items: [], totals: null };
      this._activity = { running: false, activeResponse: null, runs: [], calls: [] };
      this._expanded = { sources: false, outputs: false, activity: false };
      this._collapsed = readCollapsed();
      this._built = false;
      this._boundRefresh = this._scheduleRefresh.bind(this);

      // The conversation on screen and what is known about it.
      this._convId = null;
      this._remote = freshRemote();
      this._live = freshLive();
      // Turns of this session: `_turn` counts them, `_settledTurn` is the
      // last one that ended (the server holds it from then on).
      this._turn = 0;
      this._settledTurn = 0;
      this._turnActive = false;
      this._turnStartedAt = null;
      // A response running elsewhere (another window), from lex-chat.
      this._activeElsewhere = null;
      this._fetchTimer = null;
      this._fetchSeq = 0;
      this._inflight = 0;
      this._fetchQueued = false;
      this._stale = false;
      this._apiClient = null;

      var self = this;
      this._chatHandlers = {
        'lex-chat-response-end': function (e) { self._onResponseEnd(e.detail || {}); },
        'lex-chat-response-start': function (e) { self._onTurnStart(e.detail || {}); },
        'lex-chat-turn-end': function (e) { self._onTurnEnd(e.detail || {}); },
        'lex-chat-conversation-created': function () { self._syncConversation(); },
        'lex-chat-context-usage': function (e) { self._onContextUsage(e.detail || {}); },
        'lex-chat-entity-change': function (e) { self._onEntityChange(e.detail || {}); },
        'lex-chat-tool-start': function (e) { self._onToolEvent('start', e.detail || {}); },
        'lex-chat-tool-end': function (e) { self._onToolEvent('end', e.detail || {}); },
        'lex-chat-generation-active': function (e) { self._onGenerationActive(e.detail || {}); }
      };
    }

    connected() {
      injectStyles();
      if (!this._built) this._build();
    }

    disconnected() {
      this._detachChat();
    }

    render() { return null; }

    /** Follow a lex-chat element: its messages and live events feed the cards. */
    attachChat(chatEl) {
      if (chatEl === this._chatEl) return;
      this._detachChat();
      this._chatEl = chatEl || null;
      if (!this._chatEl) return;
      // Messages are added, re-rendered (sources arrive on done) and removed
      // (conversation switch) as DOM changes, so one observer covers all.
      if (typeof MutationObserver === 'function') {
        this._observer = new MutationObserver(this._boundRefresh);
        this._observer.observe(this._chatEl, { childList: true, subtree: true });
      }
      this._chatEl.addEventListener('lex-chat-response-end', this._boundRefresh);
      var handlers = this._chatHandlers;
      var chat = this._chatEl;
      Object.keys(handlers).forEach(function (name) { chat.addEventListener(name, handlers[name]); });
      this.refresh();
    }

    /** Only recompute and fetch while visible; catch up when shown again. */
    setActive(active) {
      this._active = active === true;
      if (!this._active) return;
      this.refresh();
      if (this._stale) this._requestFetch();
    }

    /** @param {{ workspaceName?: string, matterId?: string, documentName?: string }} scope */
    setScope(scope) {
      var s = scope || {};
      this._scope = {
        workspaceName: str(s.workspaceName),
        matterId: str(s.matterId),
        documentName: str(s.documentName)
      };
      this._renderScope();
    }

    refresh() {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
      if (!this._built) return;
      this._syncConversation();
      var messages = [];
      if (this._chatEl) {
        var nodes = this._chatEl.querySelectorAll('lex-chat-message');
        for (var i = 0; i < nodes.length; i++) {
          messages.push({ citations: nodes[i].citations, references: nodes[i].references, messageId: nodes[i].messageId || null });
        }
      }
      var remote = this._remote.sources;
      var D = data();
      if (remote.status === 'ready' && D) {
        // The server has every stored turn; add only the turns it has not
        // returned yet, so nothing is counted twice.
        var liveIds = new Set(this._live.turnMessages.map(function (t) { return t.messageId; }));
        var live = messages.filter(function (m) { return m.messageId && liveIds.has(m.messageId); });
        this._sources = D.mergeSources(remote.value, aggregate(live));
      } else {
        this._sources = aggregate(messages);
      }
      this._renderSources();
    }

    // -------------------------------------------------------------------------

    _scheduleRefresh(mutations) {
      // Ignore our own card renders and anything while hidden.
      if (!this._active) return;
      if (Array.isArray(mutations) && mutations.every(function (m) {
        return m.target && m.target.closest && m.target.closest('lex-lana-side-panel');
      })) return;
      clearTimeout(this._refreshTimer);
      var self = this;
      this._refreshTimer = setTimeout(function () { self.refresh(); }, REFRESH_DEBOUNCE_MS);
    }

    _detachChat() {
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._chatEl) {
        var chat = this._chatEl;
        var handlers = this._chatHandlers;
        chat.removeEventListener('lex-chat-response-end', this._boundRefresh);
        Object.keys(handlers).forEach(function (name) { chat.removeEventListener(name, handlers[name]); });
      }
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
      clearTimeout(this._fetchTimer);
      this._fetchTimer = null;
    }

    // -------------------------------------------------------------------------
    // Conversation and fetching
    // -------------------------------------------------------------------------

    /** Start over when the chat shows a different conversation. */
    _syncConversation() {
      var id = (this._chatEl && this._chatEl.conversationId) || null;
      if (id === this._convId) return;
      this._convId = id;
      this._remote = freshRemote();
      this._live = freshLive();
      this._settledTurn = this._turn;
      this._turnActive = false;
      this._turnStartedAt = null;
      this._activeElsewhere = null;
      this._expanded = { sources: false, outputs: false, activity: false };
      // Answers still on their way belong to the previous conversation.
      this._fetchSeq += 1;
      this._inflight = 0;
      this._fetchQueued = false;
      clearTimeout(this._fetchTimer);
      this._fetchTimer = null;
      if (id) {
        var remote = this._remote;
        REMOTE_CARDS.forEach(function (key) { remote[key].status = 'loading'; });
        this._requestFetch();
      }
      this._renderRemoteCards();
    }

    /** this conversation's events only (a turn left running elsewhere is ignored). */
    _isCurrent(detail) {
      return !detail.conversationId || !this._convId || detail.conversationId === this._convId;
    }

    _api() {
      var Client = Lex.Chat && Lex.Chat.ConversationsApiClient;
      if (!this._apiClient && Client && global.api) this._apiClient = new Client(global.api);
      return this._apiClient;
    }

    /** Debounced: switches and turn ends in quick succession make one request set. */
    _requestFetch() {
      if (!this._convId) return;
      if (!this._active) { this._stale = true; return; }
      clearTimeout(this._fetchTimer);
      var self = this;
      this._fetchTimer = setTimeout(function () { self._fetchTimer = null; self._fetch(); }, FETCH_DEBOUNCE_MS);
    }

    _fetch() {
      var id = this._convId;
      var D = data();
      if (!id || !D) return;
      if (this._inflight) { this._fetchQueued = true; return; }
      this._stale = false;
      var api = this._api();
      var seq = ++this._fetchSeq;
      this._inflight = seq;
      // Turns that ended before this request are in its answer.
      var settled = this._settledTurn;
      var contextSeq = this._live.contextSeq;
      var remote = this._remote;
      REMOTE_CARDS.forEach(function (key) { if (remote[key].value === null) remote[key].status = 'loading'; });
      this._renderRemoteCards();

      var jobs = [
        ['context', function () { return api.getContextUsage(id); }, function (p) { return D.contextView(D.unwrap(p).context_usage); }],
        ['sources', function () { return api.getSources(id); }, D.sourcesFromServer],
        ['outputs', function () { return api.getOutputs(id); }, D.outputsFromServer],
        ['activity', function () { return api.getActivityHistory(id, { limit: ACTIVITY_LIMIT }); }, D.activityView]
      ];
      var self = this;
      Promise.all(jobs.map(function (job) {
        return Promise.resolve()
          .then(function () {
            if (!api) throw new Error('Conversation API not available');
            return job[1]();
          })
          .then(function (payload) { return { key: job[0], ok: true, value: job[2](payload) }; })
          .catch(function (err) { return { key: job[0], ok: false, error: err }; });
      })).then(function (results) {
        if (self._inflight === seq) self._inflight = 0;
        if (seq !== self._fetchSeq || id !== self._convId) return;
        self._applyFetched(results, settled, contextSeq);
        if (self._fetchQueued) {
          self._fetchQueued = false;
          self._requestFetch();
        }
      });
    }

    _applyFetched(results, settled, contextSeq) {
      var self = this;
      var live = this._live;
      var keep = function (row) { return row.turn > settled; };
      results.forEach(function (r) {
        var slot = self._remote[r.key];
        if (!r.ok) {
          console.warn('[lex-lana-side-panel] ' + r.key + ' could not be loaded:', r.error && r.error.message ? r.error.message : r.error);
          // A failed refresh keeps what the card already shows.
          slot.status = slot.value !== null ? 'ready' : 'error';
          return;
        }
        slot.status = 'ready';
        slot.value = r.value;
        if (r.key === 'context' && live.contextSeq === contextSeq) live.context = null;
        if (r.key === 'sources') live.turnMessages = live.turnMessages.filter(keep);
        if (r.key === 'outputs') live.outputs = live.outputs.filter(keep);
        if (r.key === 'activity') {
          live.calls = live.calls.filter(keep);
          self._activeElsewhere = null;
        }
      });
      this.refresh();
      this._renderRemoteCards();
    }

    // -------------------------------------------------------------------------
    // Live events
    // -------------------------------------------------------------------------

    _onTurnStart(detail) {
      if (!this._isCurrent(detail)) return;
      this._syncConversation();
      if (!this._turnActive) {
        this._turn += 1;
        this._turnActive = true;
        this._turnStartedAt = new Date().toISOString();
      }
      this._renderActivity();
    }

    _onResponseEnd(detail) {
      if (!this._isCurrent(detail) || !detail.messageId) return;
      this._live.turnMessages.push({ messageId: detail.messageId, turn: this._turn });
    }

    _onTurnEnd(detail) {
      if (!this._isCurrent(detail)) return;
      this._turnActive = false;
      this._turnStartedAt = null;
      this._settledTurn = this._turn;
      // A call that never reported its end stopped with the turn.
      var turn = this._turn;
      this._live.calls = this._live.calls.map(function (c) {
        return c.turn === turn && c.status === 'running' ? Object.assign({}, c, { status: 'stopped' }) : c;
      });
      this._renderActivity();
      this._requestFetch();
    }

    _onContextUsage(detail) {
      var D = data();
      if (!D || !this._isCurrent(detail) || !detail.usage) return;
      var view = D.contextView(detail.usage);
      if (!view) return;
      this._live.context = view;
      this._live.contextSeq += 1;
      this._renderContext();
    }

    _onEntityChange(detail) {
      var D = data();
      if (!D || !this._isCurrent(detail)) return;
      var item = D.outputFromEntityChange(detail, new Date().toISOString());
      item.turn = this._turn;
      item.key += ':' + this._live.outputs.length;
      this._live.outputs.push(item);
      this._renderOutputs();
    }

    _onToolEvent(phase, detail) {
      var D = data();
      if (!D || !this._isCurrent(detail)) return;
      var turn = this._turn;
      var calls = D.applyToolEvent(this._live.calls, Object.assign({ phase: phase }, detail));
      this._live.calls = calls.map(function (c, i) {
        return c.turn ? c : Object.assign({}, c, { turn: turn, key: c.key + ':' + turn + ':' + i });
      });
      this._renderActivity();
    }

    _onGenerationActive(detail) {
      if (!this._isCurrent(detail)) return;
      this._activeElsewhere = detail.active === true
        ? { startedAt: detail.startedAt || null }
        : false;
      this._renderActivity();
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    _build() {
      this._built = true;
      this.setAttribute('role', 'complementary');
      this.setAttribute('aria-label', 'Conversation details');
      var self = this;
      CARDS.forEach(function (pair) { self.appendChild(self._card(pair[0], pair[1])); });

      this.addEventListener('click', function (e) {
        var head = e.target.closest('.llsp-card-head');
        if (head && self.contains(head)) { self._toggleCard(head.parentNode); return; }
        if (e.target.closest('.llsp-scope-change')) {
          e.stopPropagation();
          var anchor = self.querySelector('.llsp-scope-row');
          self.emit('lex-lana-side-panel-scope-change', { anchor: anchor });
          return;
        }
        if (e.target.closest('.llsp-scope-view')) {
          self._openWorkspace();
          return;
        }
        if (e.target.closest('.llsp-retry')) {
          self._fetch();
          return;
        }
        var more = e.target.closest('.llsp-more');
        if (more) {
          var which = more.getAttribute('data-more') || 'sources';
          self._expanded[which] = !self._expanded[which];
          self._renderCard(which);
          return;
        }
        var output = e.target.closest('.llsp-output[data-key]');
        if (output) { self._openOutput(output.getAttribute('data-key')); return; }
        var source = e.target.closest('.llsp-source[data-key]');
        if (source) self._openSource(source.getAttribute('data-key'));
      });

      this._renderScope();
      this._renderSources();
      this._renderRemoteCards();
    }

    _card(key, title) {
      var card = document.createElement('section');
      card.className = 'llsp-card';
      card.setAttribute('data-card', key);
      card.setAttribute('data-collapsed', String(this._collapsed[key] === true));
      var bodyId = 'llsp-body-' + key;
      card.innerHTML = '<button type="button" class="llsp-card-head" aria-controls="' + bodyId + '" aria-expanded="'
        + String(this._collapsed[key] !== true) + '">'
        + '<span class="llsp-card-title">' + escapeHtml(title) + '</span>'
        + '<span class="llsp-caret">' + CARET_SVG + '</span>'
        + '<span class="llsp-count" hidden></span>'
        + '</button>'
        + '<div class="llsp-card-body" id="' + bodyId + '"></div>';
      return card;
    }

    _toggleCard(card) {
      var key = card.getAttribute('data-card');
      var collapsed = card.getAttribute('data-collapsed') !== 'true';
      card.setAttribute('data-collapsed', String(collapsed));
      card.querySelector('.llsp-card-head').setAttribute('aria-expanded', String(!collapsed));
      this._collapsed[key] = collapsed;
      writeCollapsed(this._collapsed);
    }

    _renderCard(key) {
      if (key === 'sources') this._renderSources();
      else if (key === 'outputs') this._renderOutputs();
      else if (key === 'activity') this._renderActivity();
      else if (key === 'context') this._renderContext();
    }

    _renderRemoteCards() {
      this._renderContext();
      this._renderOutputs();
      this._renderActivity();
    }

    /** The card's body and its count chip (hidden for an empty text). */
    _cardParts(key, countText) {
      var card = this.querySelector('[data-card="' + key + '"]');
      if (!card) return null;
      var count = card.querySelector('.llsp-count');
      count.hidden = !countText;
      count.textContent = countText || '';
      return card.querySelector('.llsp-card-body');
    }

    _moreHtml(key, total, preview) {
      if (total <= preview) return '';
      return '<button type="button" class="llsp-link llsp-more" data-more="' + key + '">'
        + (this._expanded[key] ? 'Show less' : 'Show ' + (total - preview) + ' more') + '</button>';
    }

    _renderScope() {
      var body = this.querySelector('[data-card="scope"] .llsp-card-body');
      if (!body) return;
      var s = this._scope;
      var scoped = !!(s.workspaceName && s.matterId);
      var html = '<div class="llsp-scope-row">'
        + '<div class="llsp-scope-main">'
        + '<span class="llsp-icon">' + BRIEFCASE_SVG + '</span>'
        + '<span class="llsp-scope-name' + (s.workspaceName ? '' : ' is-empty') + '" title="'
        + escapeHtml(s.workspaceName) + '">' + escapeHtml(s.workspaceName || 'No workspace') + '</span>'
        + '</div>'
        + '<div class="llsp-scope-actions">'
        + '<lex-btn class="llsp-scope-change" variant="secondary" size="sm">' + (s.workspaceName ? 'Change' : 'Add to workspace') + '</lex-btn>'
        + (scoped ? '<lex-btn class="llsp-scope-view" variant="ghost" size="sm">View details</lex-btn>' : '')
        + '</div>'
        + '</div>';
      if (s.documentName) {
        html += '<div class="llsp-scope-doc">'
          + '<span class="llsp-icon">' + FILE_SVG + '</span>'
          + '<span class="llsp-scope-name">' + escapeHtml(s.documentName) + '</span>'
          + '</div>';
      }
      // Keep the dock's open picker (it lives in the first row) across renders.
      var menu = body.querySelector('.lld-scope-menu');
      body.innerHTML = html;
      if (menu) body.querySelector('.llsp-scope-row').appendChild(menu);
    }

    _renderContext() {
      var D = data();
      var remote = this._remote.context;
      var live = this._live.context;
      var view = live || remote.value;
      var body = this._cardParts('context', view && view.recorded && D ? D.formatPercent(view.percentUsed) : '');
      if (!body) return;
      if (!view || !D) {
        if (remote.status === 'loading') body.innerHTML = LOADING_HTML;
        else if (remote.status === 'error') body.innerHTML = errorHtml('context usage');
        else body.innerHTML = '<p class="llsp-empty">How full LANA\'s context window is shows here after her first answer in this conversation.</p>';
        return;
      }

      var html = '';
      var stats = [];
      if (view.recorded) {
        html += '<div class="llsp-context-head"><span>' + escapeHtml(D.formatPercent(view.percentUsed)) + ' used</span>'
          + (view.estimated ? '<lex-badge label="Estimate" color="gray" size="sm"></lex-badge>' : '')
          + '</div>'
          + '<lex-progress-bar value="' + escapeHtml(String(view.percentUsed)) + '" color="' + escapeHtml(view.level) + '" size="sm"></lex-progress-bar>';
        if (view.tokensUsed !== null) {
          stats.push(['Tokens used', D.formatTokens(view.tokensUsed) + (view.tokensAvailable !== null ? ' of ' + D.formatTokens(view.tokensAvailable) : '')]);
        }
        if (view.usableTokens !== null) stats.push(['Usable window', D.formatTokens(view.usableTokens)]);
        // LANA does not compact history: this is the room left before the
        // prompt fills the usable window.
        if (view.headroomPercent !== null) stats.push(['Room left', D.formatPercent(view.headroomPercent)]);
      } else {
        html += '<p class="llsp-empty">Usage was not recorded for the latest answer.</p>';
        if (view.tokensAvailable !== null) stats.push(['Window', D.formatTokens(view.tokensAvailable) + ' tokens']);
        if (view.usableTokens !== null) stats.push(['Usable window', D.formatTokens(view.usableTokens) + ' tokens']);
      }
      if (stats.length) {
        html += '<div class="llsp-stats">' + stats.map(function (s) { return kvHtml(s[0], s[1]); }).join('') + '</div>';
      }
      if (view.breakdown.length) {
        html += '<div class="llsp-group"><div class="llsp-group-label">Breakdown</div><div class="llsp-stats">'
          + view.breakdown.map(function (b) { return kvHtml(b.label, D.formatTokens(b.tokens)); }).join('')
          + '</div></div>';
      }
      var when = live ? 'Updated live from this answer' : (view.asOf && timeText(view.asOf) ? 'As of ' + timeText(view.asOf) : '');
      if (when) html += '<p class="llsp-meta-line">' + escapeHtml(when) + '</p>';
      body.innerHTML = html;
    }

    _renderSources() {
      var data = this._sources;
      var remote = this._remote.sources;
      var body = this._cardParts('sources', data.total ? String(data.total) : '');
      if (!body) return;

      if (data.total === 0) {
        if (remote.status === 'loading') body.innerHTML = LOADING_HTML;
        else if (remote.status === 'error') body.innerHTML = errorHtml('the sources');
        else body.innerHTML = '<p class="llsp-empty">Documents, legal authority and records LANA cites in this conversation will show here.</p>';
        return;
      }

      var html = '<p class="llsp-totals">' + escapeHtml(plural(data.total, 'source', 'sources') + ' from '
        + plural(data.citationCount, 'citation', 'citations')) + '</p>';
      var budget = this._expanded.sources ? Infinity : SOURCES_PREVIEW;
      data.groups.forEach(function (group) {
        if (budget <= 0) return;
        var items = group.items.slice(0, budget);
        budget -= items.length;
        html += '<div class="llsp-group"><div class="llsp-group-label">' + escapeHtml(group.label) + '</div>';
        items.forEach(function (item) {
          var meta = [];
          if (item.kind === 'record') meta.push(item.entityType.replace(/_/g, ' '));
          if (item.pages && item.pages.length) meta.push(pagesText(item.pages));
          meta.push('cited ' + plural(item.citeCount, 'time', 'times'));
          html += '<button type="button" class="llsp-source" data-key="' + escapeHtml(group.key + '|' + item.key) + '">'
            + '<span class="llsp-icon">' + (KIND_ICON[item.kind] || FILE_SVG) + '</span>'
            + '<span class="llsp-source-text">'
            + '<span class="llsp-source-label" title="' + escapeHtml(item.label) + '">' + escapeHtml(item.label) + '</span>'
            + '<span class="llsp-source-meta">' + escapeHtml(meta.join(' · ')) + '</span>'
            + '</span></button>';
        });
        html += '</div>';
      });
      html += this._moreHtml('sources', data.total, SOURCES_PREVIEW);
      // The full history failed to load: say the list is the loaded messages.
      if (remote.status === 'error') {
        html += '<div class="llsp-note"><p class="llsp-empty">Earlier sources could not be loaded. These are from the messages shown.</p>'
          + '<button type="button" class="llsp-link llsp-retry">Try again</button></div>';
      }
      body.innerHTML = html;
    }

    _renderOutputs() {
      var D = data();
      var remote = this._remote.outputs;
      this._outputs = D ? D.mergeOutputs(remote.value || [], this._live.outputs) : { items: [], totals: null };
      var items = this._outputs.items;
      var body = this._cardParts('outputs', items.length ? String(items.length) : '');
      if (!body) return;
      if (!items.length) {
        if (remote.status === 'loading') body.innerHTML = LOADING_HTML;
        else if (remote.status === 'error') body.innerHTML = errorHtml('the outputs');
        else body.innerHTML = '<p class="llsp-empty">Records LANA creates or changes, drafts and approvals from this conversation will show here.</p>';
        return;
      }

      var t = this._outputs.totals;
      var totals = [];
      if (t.entityChanges) totals.push(plural(t.entityChanges, 'record change', 'record changes'));
      if (t.drafts) totals.push(plural(t.drafts, 'draft', 'drafts'));
      if (t.documents) totals.push(plural(t.documents, 'document', 'documents'));
      if (t.approvals) totals.push(plural(t.approvals, 'approval', 'approvals'));
      var html = '<p class="llsp-totals">' + escapeHtml(totals.join(' · ')) + '</p>';
      var shown = this._expanded.outputs ? items : items.slice(0, OUTPUTS_PREVIEW);
      shown.forEach(function (item) {
        var linked = !!D.viewUrlTarget(item.viewUrl);
        var meta = [item.kindLabel];
        var when = timeText(item.createdAt);
        if (when) meta.push(when);
        var inner = '<span class="llsp-icon">' + (OUTPUT_ICON[item.kind] || RECORD_SVG) + '</span>'
          + '<span class="llsp-source-text">'
          + '<span class="llsp-source-label" title="' + escapeHtml(item.label) + '">' + escapeHtml(item.label) + '</span>'
          + '<span class="llsp-source-meta">' + escapeHtml(meta.join(' · ')) + '</span>'
          + '</span>'
          + badgeHtml(item.badge);
        html += linked
          ? '<button type="button" class="llsp-source llsp-output" data-key="' + escapeHtml(item.key) + '">' + inner + '</button>'
          : '<div class="llsp-source llsp-output is-static">' + inner + '</div>';
      });
      html += this._moreHtml('outputs', items.length, OUTPUTS_PREVIEW);
      body.innerHTML = html;
    }

    _renderActivity() {
      var D = data();
      var remote = this._remote.activity;
      var elsewhere = this._activeElsewhere;
      var server = remote.value;
      if (server && elsewhere !== null) {
        // lex-chat knows more recently than the last request whether a
        // response is running.
        server = Object.assign({}, server, {
          active: !!elsewhere,
          activeResponse: elsewhere ? (server.activeResponse || { startedAt: elsewhere.startedAt }) : null
        });
      } else if (!server && elsewhere) {
        server = { active: true, activeResponse: { startedAt: elsewhere.startedAt }, runs: [], calls: [] };
      }
      this._activity = D ? D.mergeActivity(server, this._live.calls, this._turnActive) : this._activity;
      var a = this._activity;
      var rows = a.runs.length + a.calls.length;
      var body = this._cardParts('activity', rows ? String(rows) : '');
      if (!body) return;

      var html = '';
      if (a.running) {
        var since = this._turnActive ? this._turnStartedAt : (a.activeResponse && a.activeResponse.startedAt);
        var sinceText = timeText(since);
        html += '<div class="llsp-running" role="status"><lex-spinner size="sm"></lex-spinner><span>'
          + escapeHtml('LANA is working' + (sinceText ? ', started ' + sinceText : '')
            + (!this._turnActive && a.activeResponse && a.activeResponse.clientDisconnected ? ' in a window that has since closed' : ''))
          + '</span></div>';
      }
      if (!rows) {
        if (remote.status === 'loading' && !a.running) html += LOADING_HTML;
        else if (remote.status === 'error') html += errorHtml('the activity');
        else if (!a.running) html += '<p class="llsp-empty">Tools LANA runs and agent runs in this conversation will show here. Answers that only read usually run none.</p>';
        body.innerHTML = html;
        return;
      }

      var budget = this._expanded.activity ? Infinity : ACTIVITY_PREVIEW;
      if (a.runs.length) {
        var runs = a.runs.slice(0, budget);
        budget -= runs.length;
        html += '<div class="llsp-group"><div class="llsp-group-label">Agent runs</div>';
        runs.forEach(function (run) {
          var meta = [];
          if (run.totalSteps !== null) meta.push((run.stepsCompleted || 0) + ' of ' + plural(run.totalSteps, 'step', 'steps'));
          var when = timeText(run.startedAt);
          if (when) meta.push(when);
          html += '<div class="llsp-source is-static">'
            + '<span class="llsp-icon">' + RUN_SVG + '</span>'
            + '<span class="llsp-source-text">'
            + '<span class="llsp-source-label" title="' + escapeHtml(run.title) + '">' + escapeHtml(run.title) + '</span>'
            + (meta.length ? '<span class="llsp-source-meta">' + escapeHtml(meta.join(' · ')) + '</span>' : '')
            + '</span>'
            + badgeHtml(run.badge)
            + '</div>';
        });
        html += '</div>';
      }
      if (a.calls.length && budget > 0) {
        html += '<div class="llsp-group"><div class="llsp-group-label">Tool calls</div>';
        a.calls.slice(0, budget).forEach(function (call) {
          var meta = [];
          if (call.durationMs !== null) meta.push(D.formatDuration(call.durationMs));
          if (call.iteration !== null) meta.push('round ' + call.iteration);
          var when = timeText(call.startedAt);
          if (when) meta.push(when);
          var badge = call.status === 'running' ? { label: 'Running', color: 'blue' }
            : call.status === 'failed' ? { label: 'Failed', color: 'red' }
              : call.status === 'stopped' ? { label: 'Stopped', color: 'gray' } : { label: 'Done', color: 'green' };
          html += '<div class="llsp-source is-static" data-call="' + escapeHtml(call.callId || '') + '">'
            + '<span class="llsp-icon">' + TOOL_SVG + '</span>'
            + '<span class="llsp-source-text">'
            + '<span class="llsp-source-label" title="' + escapeHtml(call.name || call.label) + '">' + escapeHtml(call.label) + '</span>'
            + (meta.length ? '<span class="llsp-source-meta">' + escapeHtml(meta.join(' · ')) + '</span>' : '')
            + (call.summary ? '<span class="llsp-source-summary">' + escapeHtml(call.summary) + '</span>' : '')
            + '</span>'
            + badgeHtml(badge)
            + '</div>';
        });
        html += '</div>';
      }
      html += this._moreHtml('activity', rows, ACTIVITY_PREVIEW);
      body.innerHTML = html;
    }

    /** The workspace page; navigating also takes the dock out of full screen. */
    _openWorkspace() {
      var id = this._scope.matterId;
      if (!id) return;
      if (Lex.Nav && typeof Lex.Nav.go === 'function') {
        Lex.Nav.go('workspace-details.html', { params: { id: id }, context: { matterId: id } });
      } else {
        global.location.href = 'workspace-details.html?id=' + encodeURIComponent(id);
      }
    }

    /** An output's record, document or approval page, through Lex.Nav. */
    _openOutput(key) {
      var D = data();
      var item = this._outputs.items.find(function (i) { return i.key === key; });
      var target = item && D ? D.viewUrlTarget(item.viewUrl) : null;
      if (!target || !Lex.Nav || typeof Lex.Nav.go !== 'function') return;
      Lex.Nav.go(target.page, target.context ? { params: target.params, context: target.context } : { params: target.params });
    }

    _findItem(compositeKey) {
      var split = String(compositeKey || '').indexOf('|');
      if (split === -1) return null;
      var groupKey = compositeKey.slice(0, split);
      var itemKey = compositeKey.slice(split + 1);
      var group = this._sources.groups.find(function (g) { return g.key === groupKey; });
      return group ? group.items.find(function (i) { return i.key === itemKey; }) || null : null;
    }

    /** Hand off to lex-chat's own open handlers (viewer, record links). */
    _openSource(compositeKey) {
      var item = this._findItem(compositeKey);
      var chat = this._chatEl;
      if (!item || !chat) return;
      if (item.reference) {
        chat.dispatchEvent(new CustomEvent('lex-reference-click', { detail: { reference: item.reference } }));
        return;
      }
      chat.dispatchEvent(new CustomEvent('lex-citation-click', {
        detail: {
          documentId: item.documentId || null,
          filename: item.label,
          page: (item.pages && item.pages[0]) || 1,
          citationNum: null,
          citationIndex: null,
          citation: item.citation
        }
      }));
    }
  }

  Lex.defineLex('lex-lana-side-panel', LexLanaSidePanel);
})(typeof window !== 'undefined' ? window : globalThis);

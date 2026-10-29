/* ==========================================================================
   Lex UI — <lex-lana-side-panel>
   Conversation details column beside the chat stream in the Ask LANA dock's
   full screen mode. Loaded on demand by lex-lana-dock (not listed on pages)
   and shown only while the dock is full screen; it scrolls on its own.

   Cards (each collapsible, collapsed state remembered per viewer):
     Scope    — the conversation's workspace (name wraps to two lines).
                "Change" asks the dock to open its workspace picker in the
                card; "View details" opens the workspace page.
     Sources  — every document, legal authority and record cited across the
                loaded messages, merged and de-duplicated. Clicking one goes
                through lex-chat's own citation / record open handlers.

   Context, Outputs and Activity cards follow once the backend persists that
   data per conversation (see the dock full screen side panel scope).

   Usage (by lex-lana-dock):
     var side = document.createElement('lex-lana-side-panel');
     body.appendChild(side);
     side.attachChat(chatEl);
     side.setScope({ workspaceName, matterId, documentName });

   Events (bubble + compose):
     lex-lana-side-panel-scope-change — { anchor } the Change button was
       pressed; the dock opens its scope picker inside `anchor`.

   Also exports Lex.Chat.SourcesAggregate.aggregate(messages), the pure
   merge used by the Sources card.
   ========================================================================== */

(function (global) {
  'use strict';

  var Lex = global.Lex;
  if (!Lex || !Lex.LexElement) { console.error('[lex-lana-side-panel] LexElement not loaded'); return; }

  var COLLAPSED_KEY = 'lana:lanaDock:sideCards';
  var SOURCES_PREVIEW = 6;
  var REFRESH_DEBOUNCE_MS = 200;

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
  var KIND_ICON = { document: FILE_SVG, authority: SCALE_SVG, record: RECORD_SVG, other: FILE_SVG };

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
      + 'lex-lana-side-panel .llsp-more { margin-top: 8px; padding-left: 0; }';
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

  class LexLanaSidePanel extends Lex.LexElement {
    constructor() {
      super();
      this._chatEl = null;
      this._observer = null;
      this._refreshTimer = null;
      this._active = false;
      this._scope = { workspaceName: '', matterId: '', documentName: '' };
      this._sources = { groups: [], total: 0, citationCount: 0 };
      this._sourcesExpanded = false;
      this._collapsed = readCollapsed();
      this._built = false;
      this._boundRefresh = this._scheduleRefresh.bind(this);
    }

    connected() {
      injectStyles();
      if (!this._built) this._build();
    }

    disconnected() {
      this._detachChat();
    }

    render() { return null; }

    /** Follow a lex-chat element: its messages feed the Sources card. */
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
      this.refresh();
    }

    /** Only recompute while visible; catch up when shown again. */
    setActive(active) {
      this._active = active === true;
      if (this._active) this.refresh();
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
      var messages = [];
      if (this._chatEl) {
        var nodes = this._chatEl.querySelectorAll('lex-chat-message');
        for (var i = 0; i < nodes.length; i++) {
          messages.push({ citations: nodes[i].citations, references: nodes[i].references });
        }
      }
      this._sources = aggregate(messages);
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
      if (this._chatEl) this._chatEl.removeEventListener('lex-chat-response-end', this._boundRefresh);
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }

    _build() {
      this._built = true;
      this.setAttribute('role', 'complementary');
      this.setAttribute('aria-label', 'Conversation details');
      this.appendChild(this._card('scope', 'Scope'));
      this.appendChild(this._card('sources', 'Sources'));

      var self = this;
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
        if (e.target.closest('.llsp-more')) {
          self._sourcesExpanded = !self._sourcesExpanded;
          self._renderSources();
          return;
        }
        var source = e.target.closest('.llsp-source');
        if (source) self._openSource(source.getAttribute('data-key'));
      });

      this._renderScope();
      this._renderSources();
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

    _renderSources() {
      var card = this.querySelector('[data-card="sources"]');
      if (!card) return;
      var body = card.querySelector('.llsp-card-body');
      var count = card.querySelector('.llsp-count');
      var data = this._sources;
      count.hidden = data.total === 0;
      count.textContent = String(data.total);

      if (data.total === 0) {
        body.innerHTML = '<p class="llsp-empty">Documents, legal authority and records LANA cites in this conversation will show here.</p>';
        return;
      }

      var budget = this._sourcesExpanded ? Infinity : SOURCES_PREVIEW;
      var html = '';
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
      if (data.total > SOURCES_PREVIEW) {
        html += '<button type="button" class="llsp-link llsp-more">'
          + (this._sourcesExpanded ? 'Show less' : 'Show ' + (data.total - SOURCES_PREVIEW) + ' more') + '</button>';
      }
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

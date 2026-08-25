/* ==========================================================================
   Lex UI — <lex-chat-message>
   Renders a single chat message (user, assistant, or system).
   Supports streaming content via appendContent() and finalize().
   Uses lex-chat.css tokens for styling.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, defineLex, ChatFormat } = global.Lex;
  if (!LexElement) { console.error('[lex-chat-message] LexElement not loaded'); return; }

  function getArtifactPromotion() {
    return global.Lex && global.Lex.Chat && global.Lex.Chat.ArtifactPromotion;
  }

  function getContextPromotion() {
    return global.Lex && global.Lex.Chat && global.Lex.Chat.ContextPromotion;
  }

  // ---------------------------------------------------------------------------
  // Timestamp formatting — smart relative dates
  // ---------------------------------------------------------------------------

  function parseTimestampAsUtc(iso) {
    if (global.Lex && global.Lex.Utils && typeof global.Lex.Utils.parseApiUtcDate === 'function') {
      return global.Lex.Utils.parseApiUtcDate(iso);
    }
    if (iso instanceof Date) return iso;
    if (typeof iso === 'string' && iso.indexOf('T') !== -1) {
      const timePart = iso.substring(iso.indexOf('T') + 1);
      const last = timePart.charAt(timePart.length - 1);
      const hasExplicitZone = last === 'Z' || last === 'z' || timePart.indexOf('+') !== -1 || timePart.indexOf('-') !== -1;
      return new Date(hasExplicitZone ? iso : iso + 'Z');
    }
    return new Date(iso);
  }

  function formatTimestamp(iso) {
    if (!iso) return '';
    const date = parseTimestampAsUtc(iso);
    if (!date || isNaN(date.getTime())) return '';

    const today = Lex.Utils.startOfLocalDay();
    const yesterday = Lex.Utils.addDays(today, -1);
    const msgDay = Lex.Utils.startOfLocalDay(date);

    // Format UTC timestamps in the client's local timezone.
    const timeStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);

    if (msgDay.getTime() === today.getTime()) {
      return `Today ${timeStr}`;
    }
    if (msgDay.getTime() === yesterday.getTime()) {
      return `Yesterday ${timeStr}`;
    }

    // Older: "Feb 12, 2025 3:30 AM"
    const dateStr = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
    return `${dateStr} ${timeStr}`;
  }

  // Style injection guard
  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-message-styles';
    style.textContent = `
      lex-chat-message {
        display: block;
        animation: lex-chat-fade-in var(--lex-transition-slow, 0.3s) ease both;
      }

      /* Timestamp line */
      .lex-chat-msg-timestamp {
        font-family: var(--lex-font-mono);
        font-size: 10px;
        font-weight: 500;
        color: var(--lex-chat-text-dim);
        letter-spacing: 0.04em;
        margin-bottom: 4px;
        white-space: nowrap;
      }

      /* Citations section appended after assistant message body */
      .lex-chat-citations-section {
        margin-top: 8px;
        border-top: 1px solid var(--lex-chat-border-soft);
        padding-top: 8px;
      }
      .lex-chat-evidence-tabs {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-bottom: 6px;
        border: 1px solid var(--lex-chat-border-soft);
        border-radius: 6px;
        padding: 2px;
        background: var(--lex-chat-bg-surface);
      }
      .lex-chat-evidence-tab {
        border: none;
        background: transparent;
        color: var(--lex-chat-text-dim);
        border-radius: 4px;
        padding: 3px 7px;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .lex-chat-evidence-tab[aria-selected="true"] {
        color: var(--lex-chat-text);
        background: var(--lex-chat-bg-elevated);
      }
      .lex-chat-citations-section .lex-chat-citation-item {
        display: flex;
        align-items: flex-start;
        gap: 4px;
        font-size: 10px;
        color: var(--lex-chat-text-dim);
        padding: 4px 0 4px 8px;
        border-left: 2px solid var(--lex-chat-border-soft);
        transition: border-color var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-citations-section .lex-chat-citation-item:hover {
        border-left-color: var(--lex-chat-accent);
      }
      .lex-chat-reference-empty {
        padding: 6px 8px;
        font-size: 10.5px;
        color: var(--lex-chat-text-dim);
      }
      .lex-chat-validation-section {
        margin-top: 10px;
        border: 1px solid var(--lex-chat-border-soft);
        border-left: 3px solid #b7791f;
        border-radius: 6px;
        padding: 8px 10px;
        background: rgba(183, 121, 31, 0.07);
      }
      .lex-chat-validation-title {
        font-size: 11px;
        font-weight: 700;
        color: var(--lex-chat-text);
        margin-bottom: 5px;
      }
      .lex-chat-validation-item {
        font-size: 11px;
        line-height: 1.4;
        color: var(--lex-chat-text-dim);
      }
      .lex-chat-validation-item + .lex-chat-validation-item {
        margin-top: 4px;
      }
      .lex-chat-citation-item button {
        text-align: left;
        font-weight: 500;
        cursor: pointer;
        color: inherit;
        background: none;
        border: none;
        padding: 0;
        transition: color var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-citation-item button:hover {
        color: var(--lex-chat-accent);
        text-decoration: underline;
      }
      .lex-chat-citations-more {
        margin: 4px 0 0 8px;
        padding: 0;
        border: none;
        background: none;
        color: var(--lex-chat-text-dim);
        font-size: 10px;
        font-weight: 500;
        cursor: pointer;
      }
      .lex-chat-citations-more:hover {
        color: var(--lex-chat-accent);
        text-decoration: underline;
      }

      /* Artifacts section */
      .lex-chat-artifacts-section {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .lex-chat-artifact-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: var(--lex-radius-md, 6px);
        font-size: 12px;
        font-weight: 500;
        border: 1px solid var(--lex-chat-artifact-border);
        background: var(--lex-chat-artifact-bg);
        color: var(--lex-chat-artifact-text);
        cursor: pointer;
        transition: background var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-artifact-btn:hover {
        background: var(--lex-chat-artifact-hover);
      }
      .lex-chat-context-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--lex-chat-border-soft);
        border-radius: var(--lex-radius-md, 6px);
        background: var(--lex-chat-bg-surface);
      }
      .lex-chat-context-card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .lex-chat-context-card-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--lex-chat-text);
      }
      .lex-chat-context-card-status {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 52%;
        font-size: 10px;
        font-weight: 700;
        color: var(--lex-chat-text-dim);
        line-height: 1.35;
      }
      .lex-chat-context-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--lex-chat-text-dim);
      }
      .lex-chat-context-card[data-tone="success"] .lex-chat-context-status-dot { background: #16a34a; }
      .lex-chat-context-card[data-tone="error"] .lex-chat-context-status-dot { background: #dc2626; }
      .lex-chat-context-card[data-tone="pending"] .lex-chat-context-status-dot { background: #d97706; }
      .lex-chat-context-insight {
        font-size: 12px;
        line-height: 1.45;
        color: var(--lex-chat-text);
      }
      .lex-chat-context-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 10.5px;
        color: var(--lex-chat-text-dim);
      }
      .lex-chat-context-meta span {
        padding: 2px 6px;
        border: 1px solid var(--lex-chat-border-soft);
        border-radius: 4px;
      }
      .lex-chat-context-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      /* Attachments inside user message */
      .lex-chat-msg-attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
        border-top: 1px solid var(--lex-chat-border-soft);
        padding-top: 8px;
      }
      .lex-chat-msg-attachment {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: var(--lex-radius-md, 6px);
        font-size: 11px;
        font-weight: 500;
        background: var(--lex-chat-bg-elevated);
        color: var(--lex-chat-text-muted);
        border: 1px solid var(--lex-chat-border-soft);
      }
      .lex-chat-msg-attachment svg {
        width: 14px; height: 14px;
        color: var(--lex-chat-accent);
        flex-shrink: 0;
      }
      .lex-chat-msg-attachment--context {
        align-items: flex-start;
        max-width: 260px;
      }
      .lex-chat-msg-attachment-name {
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lex-chat-msg-attachment-copy {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .lex-chat-msg-attachment-summary {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--lex-chat-text-muted);
        opacity: 0.82;
        font-weight: 400;
      }

      /* System message */
      .lex-chat-msg-system {
        display: flex;
        justify-content: center;
      }
      .lex-chat-msg-system-bubble {
        padding: 6px 16px;
        border-radius: var(--lex-radius-lg, 8px);
        font-size: 12px;
        text-align: center;
        max-width: 400px;
        background: var(--lex-chat-bg-surface);
        color: var(--lex-chat-text-muted);
        border: 1px solid var(--lex-chat-border-soft);
      }
      .lex-chat-msg-system-copy {
        display: block;
      }
      .lex-chat-msg-recovery-actions {
        display: flex;
        justify-content: center;
        margin-top: 7px;
      }
      .lex-chat-msg-retry[disabled] {
        cursor: default;
        opacity: 0.65;
      }

      /* Grounding refusal — subtle amber left border */
      .lex-chat-grounding-refusal {
        border-left: 3px solid #f59e0b;
        padding-left: 12px;
        opacity: 0.9;
      }
    `;
    document.head.appendChild(style);
  }

  // -- Attachment file icon --
  const ATTACH_FILE_ICON = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  const ATTACH_CONTEXT_ICON = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>`;

  // -- Breathing logo SVG --
  const BREATHING_LOGO = `
    <div class="lex-chat-indicator">
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--tl" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M0 0L8 0M0 0L0 8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--br" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M8 8L0 8M8 8L8 0" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </div>`;

  const BREATHING_LOGO_STATIC = `
    <div class="lex-chat-indicator lex-chat-indicator--static">
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--tl" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M0 0L8 0M0 0L0 8" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <svg class="lex-chat-indicator-corner lex-chat-indicator-corner--br" width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M8 8L0 8M8 8L8 0" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </div>`;

  class LexChatMessage extends LexElement {

    static get properties() {
      return {
        role:       { type: String, default: 'assistant' },
        content:    { type: String, default: '' },
        messageId:  { type: String, default: null, attribute: 'message-id' },
        timestamp:  { type: String, default: null },
        duration:   { type: Number, default: null },
        tokenCount: { type: Number, default: null, attribute: 'token-count' },
        streaming:  { type: Boolean, default: false, reflect: true },
        citations:  { type: Array, default: [] },
        references: { type: Array, default: [] },
        artifacts:  { type: Array, default: [] },
        attachments: { type: Array, default: [] },
        grounding:   { type: Object, default: null },
        recovery:    { type: Object, default: null }
      };
    }

    constructor() {
      super();
      this._rawContent = ''; // Accumulated raw content for streaming
      this._contentEl = null;
      this._expandedCitations = false;
      this._activeEvidenceTab = 'sources';
    }

    connected() {
      injectStyles();
    }

    _renderTimestamp() {
      // Auto-stamp on first render if no timestamp was provided
      if (!this.timestamp) {
        this._props.timestamp = LanaTime.nowIso();
      }
      const ts = formatTimestamp(this.timestamp);
      if (!ts) return '';
      const meta = this._formatMeta();
      return `<div class="lex-chat-msg-timestamp">${ChatFormat ? ChatFormat.escapeHtml(ts) : ts}${meta}</div>`;
    }

    _formatMeta() {
      let parts = [];
      // Duration
      const ms = this.duration;
      if (ms || ms === 0) {
        if (ms < 1000) parts.push(ms + 'ms');
        else if (ms / 1000 < 60) parts.push((ms / 1000).toFixed(1) + 's');
        else {
          const min = Math.floor(ms / 60000);
          const remSec = Math.round((ms % 60000) / 1000);
          parts.push(min + 'm ' + remSec + 's');
        }
      }
      // Tokens — compact above 999: 1k, 1.2k, 12k
      const tc = this.tokenCount;
      if (tc) {
        let label;
        if (tc < 1000) {
          label = String(tc);
        } else if (tc < 10000) {
          const k = Math.round(tc / 100) / 10;
          label = (k % 1 === 0 ? String(Math.round(k)) : k.toFixed(1)) + 'k';
        } else {
          label = Math.round(tc / 1000) + 'k';
        }
        parts.push(label + ' tokens');
      }
      return parts.length > 0 ? ' · ' + parts.join(' · ') : '';
    }

    render() {
      const role = this.role;
      const tsHtml = this._renderTimestamp();

      if (role === 'system') {
        const recovery = this.recovery && this.recovery.recoveryId ? this.recovery : null;
        const recoveryAction = recovery
          ? `<div class="lex-chat-msg-recovery-actions">
              <lex-btn class="lex-chat-msg-retry" data-chat-retry data-recovery-id="${ChatFormat ? ChatFormat.escapeHtml(recovery.recoveryId) : recovery.recoveryId}" variant="secondary" size="sm"${recovery.disabled ? ' disabled' : ''}>${ChatFormat ? ChatFormat.escapeHtml(recovery.label || 'Retry') : (recovery.label || 'Retry')}</lex-btn>
            </div>`
          : '';
        return `
          <div class="lex-chat-msg-system">
            <div class="lex-chat-msg-system-bubble">
              <span class="lex-chat-msg-system-copy">${ChatFormat ? ChatFormat.escapeHtml(this.content) : this.content}</span>
              ${recoveryAction}
            </div>
          </div>`;
      }

      if (role === 'user') {
        const attachments = this.attachments || [];
        const attachHtml = attachments.length > 0
          ? `<div class="lex-chat-msg-attachments">${attachments.map(a => this._renderAttachment(a)).join('')}</div>`
          : '';

        return `
          <div class="lex-chat-msg-user">
            ${tsHtml}
            <div class="lex-chat-msg-user-bubble">
              ${ChatFormat ? ChatFormat.escapeHtml(this.content) : this.content}
              ${attachHtml}
            </div>
          </div>`;
      }

      // assistant — the breathing logo only exists while streaming; a
      // completed reply carries no icon.
      const streamCls = this.streaming ? ' lex-chat-narrative--streaming' : '';
      const logo = this.streaming ? BREATHING_LOGO : '';
      const formatted = ChatFormat ? ChatFormat.format(this.content, this.citations) : this.content;

      return `
        <div class="lex-chat-msg-agent">
          ${logo}
          <div class="lex-chat-msg-agent-body">
            ${tsHtml}
            <div class="lex-chat-narrative${streamCls}" data-content-body>${formatted}</div>
          </div>
        </div>`;
    }

    updated() {
      this._contentEl = this.querySelector('[data-content-body]');

      this.delegate('click', '[data-chat-retry]', (e, target) => {
        e.preventDefault();
        if (target.hasAttribute('disabled')) return;
        this.emit('lex-chat-retry', {
          recoveryId: target.dataset.recoveryId || ''
        });
      });

      // Bind citation clicks via delegation
      this.delegate('click', '.lex-chat-citation-link', (e, target) => {
        e.preventDefault();
        const index = parseInt(target.dataset.citationIndex, 10);
        const citation = Number.isFinite(index) && Array.isArray(this.citations)
          ? (this.citations[index] || null)
          : null;
        this.emit('lex-citation-click', {
          documentId: target.dataset.documentId,
          filename: target.dataset.filename,
          page: parseInt(target.dataset.page, 10) || 1,
          citationNum: target.dataset.citationNum ? parseInt(target.dataset.citationNum, 10) : null,
          citationIndex: Number.isFinite(index) ? index : null,
          citation
        });
      });

      this.delegate('click', '.lex-chat-citations-more', (e) => {
        e.preventDefault();
        this._expandedCitations = !this._expandedCitations;
        const existing = this.querySelector('.lex-chat-citations-section');
        if (existing) existing.remove();
        this._renderCitationsSection(this.citations || []);
      });

      this.delegate('click', '.lex-chat-evidence-tab', (e, target) => {
        e.preventDefault();
        this._activeEvidenceTab = target.dataset.evidenceTab || 'sources';
        const existing = this.querySelector('.lex-chat-citations-section');
        if (existing) existing.remove();
        this._renderCitationsSection(this.citations || []);
      });

      this.delegate('click', '.lex-chat-reference-link', (e, target) => {
        e.preventDefault();
        const index = parseInt(target.dataset.referenceIndex, 10);
        const reference = Number.isFinite(index) && Array.isArray(this.references)
          ? (this.references[index] || null)
          : null;
        this.emit('lex-reference-click', {
          referenceIndex: Number.isFinite(index) ? index : null,
          reference
        });
      });

      // Bind copy buttons (skip mermaid copy — handled separately below)
      this.delegate('click', '.lex-chat-copy-btn', (e, target) => {
        if (target.dataset.mermaidCopy) return;
        const uid = target.dataset.copyId;
        const codeEl = this.querySelector(`code[data-raw]`);
        if (codeEl) {
          const text = codeEl.getAttribute('data-raw') || codeEl.textContent;
          navigator.clipboard.writeText(text).catch(() => {});
        }
      });

      // Bind artifact clicks
      this.delegate('click', '.lex-chat-artifact-btn', (e, target) => {
        this.emit('lex-artifact-click', {
          artifactType: target.dataset.artifactType,
          entityId: target.dataset.entityId,
          entityType: target.dataset.entityType
        });
      });

      this.delegate('click', '.lex-chat-artifact-promote', (e, target) => {
        var artifactId = target.dataset.artifactId || '';
        var artifact = this._findArtifact(artifactId);
        var ArtifactPromotion = getArtifactPromotion();
        var action = ArtifactPromotion && ArtifactPromotion.getSaveToDocumentsAction(artifact);
        if (!artifact || !action) return;

        this.emit('lex-artifact-promote', {
          artifact: artifact,
          artifactId: artifactId,
          action: action,
          messageElement: this
        });
      });

      this.delegate('click', '.lex-chat-artifact-open-document', (e, target) => {
        this.emit('lex-artifact-click', {
          artifactType: 'download',
          entityId: target.dataset.documentId || '',
          entityType: 'document',
          matterId: target.dataset.matterId || ''
        });
      });

      this.delegate('click', '.lex-chat-context-action', (e, target) => {
        var promotionId = target.dataset.promotionId || '';
        var kind = target.dataset.contextAction || '';
        var promotion = this._findContextPromotion(promotionId);
        var ContextPromotion = getContextPromotion();
        var ArtifactPromotion = getArtifactPromotion();
        var helper = ContextPromotion || ArtifactPromotion;
        var action = null;
        if (kind === 'approve') {
          action = helper && helper.getApproveContextPromotionAction(promotion);
        } else if (kind === 'dismiss') {
          action = helper && helper.getDismissContextPromotionAction(promotion);
        }
        if (!promotion || !action) return;

        this.emit('lex-context-promotion-action', {
          promotion: promotion,
          promotionId: promotionId,
          actionKind: kind,
          action: action,
          messageElement: this
        });
      });

      // History messages arrive already finalized, so their artifact cards
      // are rendered during updated() rather than via finalize().
      if (!this.streaming && this.artifacts && this.artifacts.length > 0) {
        this._renderArtifactsSection(this.artifacts);
      }

      // The grounding badge lives on the timestamp line but isn't part of the
      // render template, so any re-render after finalize() rebuilds the line
      // without it. Re-apply from props (idempotent — _renderGroundingIndicator
      // guards against double render).
      if (!this.streaming && this.grounding) {
        this._renderGroundingIndicator(this.grounding);
        this._renderValidationFindingsSection(this.grounding);
      }

      // Same wipe applies to the citations (Sources) section — re-apply it
      // for finalized messages (idempotent — guarded inside the renderer).
      if (!this.streaming && ((this.citations && this.citations.length > 0) || (this.references && this.references.length > 0))) {
        this._renderCitationsSection(this.citations);
      }

      // Bind mermaid copy buttons
      this.delegate('click', '[data-mermaid-copy]', (e, target) => {
        const wrapper = target.closest('.lex-mermaid-wrapper');
        if (!wrapper) return;
        const mermaidEl = wrapper.querySelector('.mermaid');
        const source = mermaidEl ? (mermaidEl.dataset.mermaidSource || mermaidEl.textContent) : '';
        navigator.clipboard.writeText(source).catch(() => {});
      });

      // Render mermaid diagrams for non-streaming messages
      if (!this.streaming && ChatFormat && typeof ChatFormat.renderMermaidDiagrams === 'function') {
        ChatFormat.renderMermaidDiagrams(this);
      }
    }

    setRecoveryState(next) {
      if (!this.recovery) return;
      this.recovery = Object.assign({}, this.recovery, next || {});
    }

    _renderAttachment(attachment) {
      const item = attachment || {};
      const esc = (value) => ChatFormat ? ChatFormat.escapeHtml(value) : String(value || '');
      if (item.type === 'module_context') {
        const name = esc(item.name || 'Attached context');
        const summaryRaw = String(item.summary || '').replace(/\s+/g, ' ').trim();
        const summary = summaryRaw
          ? `<span class="lex-chat-msg-attachment-summary" title="${esc(summaryRaw)}">${esc(summaryRaw)}</span>`
          : '';
        return `<div class="lex-chat-msg-attachment lex-chat-msg-attachment--context">${ATTACH_CONTEXT_ICON}<span class="lex-chat-msg-attachment-copy"><span class="lex-chat-msg-attachment-name" title="${name}">${name}</span>${summary}</span></div>`;
      }
      const name = esc(item.filename || item.name || 'Document');
      return `<div class="lex-chat-msg-attachment">${ATTACH_FILE_ICON}<span class="lex-chat-msg-attachment-name" title="${name}">${name}</span></div>`;
    }

    /**
     * Append streaming content chunk.
     * @param {string} chunk - New text to add
     */
    appendContent(chunk) {
      this._rawContent += chunk;
      this._props.content = this._rawContent;
      this.streaming = true;

      // Direct DOM update (no re-render)
      if (this._contentEl) {
        const formatted = ChatFormat ? ChatFormat.format(this._rawContent, this.citations) : this._rawContent;
        this._contentEl.innerHTML = formatted;
        if (!this._contentEl.classList.contains('lex-chat-narrative--streaming')) {
          this._contentEl.classList.add('lex-chat-narrative--streaming');
        }

        // Inject cursor into the last text-bearing element so it appears inline
        const lastBlock = this._contentEl.querySelector('p:last-of-type, li:last-of-type, h1:last-of-type, h2:last-of-type, h3:last-of-type, h4:last-of-type, blockquote:last-of-type');
        if (lastBlock) {
          lastBlock.insertAdjacentHTML('beforeend', '<span class="lex-chat-cursor"></span>');
        } else {
          // Fallback: append to content root
          this._contentEl.insertAdjacentHTML('beforeend', '<span class="lex-chat-cursor"></span>');
        }
      }
    }

    /**
     * Finalize the message after streaming completes.
     * @param {Object} metadata - { messageId, citations, artifacts, timestamp }
     */
    finalize(metadata = {}) {
      this.streaming = false;
      if (metadata.messageId) this._props.messageId = metadata.messageId;
      if (metadata.timestamp) this._props.timestamp = metadata.timestamp;
      if (metadata.citations) this._props.citations = metadata.citations;
      if (metadata.references) this._props.references = metadata.references;
      if (metadata.artifacts) this._props.artifacts = metadata.artifacts;
      if (metadata.duration != null) this._props.duration = metadata.duration;
      if (metadata.tokenCount != null) this._props.tokenCount = metadata.tokenCount;

      // Update displayed timestamp (with duration + token count if available)
      const tsEl = this.querySelector('.lex-chat-msg-timestamp');
      if (tsEl) {
        tsEl.textContent = formatTimestamp(this.timestamp) + this._formatMeta();
      }

      // Remove streaming cursor
      if (this._contentEl) {
        this._contentEl.classList.remove('lex-chat-narrative--streaming');

        // Remove cursor span explicitly (stays in DOM when there are no citations)
        var cursorEl = this._contentEl.querySelector('.lex-chat-cursor');
        if (cursorEl) cursorEl.remove();

        // Re-format with final citations
        if (this._rawContent && metadata.citations?.length > 0) {
          this._contentEl.innerHTML = ChatFormat.format(this._rawContent, metadata.citations);
        }

        // Append citations section
        if (metadata.citations?.length > 0) {
          this._renderCitationsSection(metadata.citations);
        }

        // Append artifacts section
        if (metadata.artifacts?.length > 0) {
          this._renderArtifactsSection(metadata.artifacts);
        }

        // Capture grounding data and render badge + refusal styling
        if (metadata.grounding) {
          this._props.grounding = metadata.grounding;
          this._renderGroundingIndicator(metadata.grounding);

          var contentBody = this.querySelector('[data-content-body]');
          if (contentBody) {
            var g = metadata.grounding;
            var isRefusal = (g.validatorFailures && g.validatorFailures.length > 0) ||
                            g.fallbackUsed ||
                            (g.groundingStatus === 'none' && g.evidenceMode !== 'grounded_tool' && g.evidenceMode !== 'ungrounded_fallback');
            if (isRefusal) {
              contentBody.classList.add('lex-chat-grounding-refusal');
            }
          }
        }
      }

      // Switch logo to static after streaming completes
      // The reply is back from the service — the indicator's job is done.
      const logo = this.querySelector('.lex-chat-indicator');
      if (logo) {
        logo.remove();
      }

      // Render mermaid diagrams (must be after content is in DOM)
      if (ChatFormat && typeof ChatFormat.renderMermaidDiagrams === 'function') {
        ChatFormat.renderMermaidDiagrams(this);
      }
    }

    /**
     * Render a subtle grounding badge inline with the message timestamp.
     * @param {Object} grounding - Grounding context from the backend debug_context event
     */
    _renderGroundingIndicator(grounding) {
      var wrapper = this.querySelector('.lex-chat-msg-timestamp');
      if (!wrapper) return;

      // Guard against double-render
      if (wrapper.querySelector('lex-badge')) return;

      var status = grounding.groundingStatus;
      var evidenceMode = grounding.evidenceMode;
      var findings = Array.isArray(grounding.validationFindings) ? grounding.validationFindings : [];
      var disposition = grounding.validationDisposition || null;

      // Who checked the answer is a separate question from how well it is
      // grounded, and the two must not be collapsed. A second-pass reviewer
      // that is a DIFFERENT model from the one that drafted the answer is a
      // genuine independent check and earns the stronger word. The same model
      // re-reading its own draft against the sources is worth doing — it
      // catches unsupported figures and broken citations — but calling that
      // "Verified" would claim an independence the system does not have.
      //
      // Self-review therefore never upgrades the badge. It only annotates it,
      // so the label a user reads is never stronger than what actually
      // happened.
      var verification = grounding.verification || null;
      var independentlyVerified = !!(verification
        && verification.verified === true
        && verification.independent === true);
      var selfReviewed = !!(verification
        && verification.attempted === true
        && verification.independent === false);

      var label, color;
      if (disposition === 'flag_and_deliver' || findings.length > 0) {
        label = 'Needs review';
        color = 'yellow';
      } else if (independentlyVerified) {
        label = 'Verified';
        color = 'green';
      } else if (status === 'strong') {
        label = 'Grounded';
        color = 'green';
      } else if (status === 'partial' || status === 'weak') {
        // No "Partially grounded" badge — same reasoning as the suppressed
        // "Ungrounded" badge below. The backend labels general-knowledge
        // answers that lean on conversation history as partial/weak, so the
        // yellow tag showed up on ordinary answers and read as a warning.
        // Validator findings still surface via "Needs review", and the full
        // grounding telemetry still flows in debug_context for QA.
        return;
      } else if (status === 'none') {
        if (evidenceMode === 'grounded_tool') {
          label = 'Tool-verified';
          color = 'blue';
        } else {
          // No evidence backing this response — show nothing rather than an
          // "Ungrounded" badge. A negative label on every general-knowledge
          // answer reads as a warning and erodes trust; the response text
          // already carries the "general legal principles" caveat, and the
          // grounding telemetry still flows in debug_context for QA.
          return;
        }
      } else {
        // Unknown status — don't show
        return;
      }

      var badge = document.createElement('lex-badge');
      badge.label = label;
      badge.color = color;
      badge.size = 'sm';
      badge.style.marginLeft = '8px';
      // Say plainly what was and was not done. The tooltip is where the
      // distinction lives for anyone who wants it; the label stays short.
      var titleLines = [];
      if (findings.length > 0) {
        titleLines = findings.map((finding) => finding.message || finding.code).filter(Boolean);
      }
      if (independentlyVerified) {
        titleLines.push('Checked against its sources by a separate model.');
      } else if (selfReviewed) {
        titleLines.push('Re-checked against its sources by the same model that wrote it, then validated by automated source checks.');
      }
      if (titleLines.length > 0) {
        badge.title = titleLines.join('\n');
      }
      wrapper.appendChild(badge);
    }

    _renderValidationFindingsSection(grounding) {
      const body = this.querySelector('.lex-chat-msg-agent-body');
      if (!body || body.querySelector('.lex-chat-validation-section')) return;
      const findings = Array.isArray(grounding && grounding.validationFindings)
        ? grounding.validationFindings
        : [];
      if (findings.length === 0 && grounding && grounding.validationDisposition !== 'flag_and_deliver') return;

      const items = findings.length > 0
        ? findings.map((finding) => {
          const message = finding.message || finding.code || 'This answer has a validator warning.';
          const code = finding.code ? ` (${finding.code})` : '';
          return `<div class="lex-chat-validation-item">${ChatFormat.escapeHtml(String(message + code))}</div>`;
        }).join('')
        : '<div class="lex-chat-validation-item">This answer was delivered with validator warnings.</div>';

      body.insertAdjacentHTML('beforeend', `
        <div class="lex-chat-validation-section">
          <div class="lex-chat-validation-title">Review Notes</div>
          ${items}
        </div>`);
    }

    _renderCitationsSection(citations) {
      const body = this.querySelector('.lex-chat-msg-agent-body');
      if (!body || body.querySelector('.lex-chat-citations-section')) return;

      citations = Array.isArray(citations) ? citations : [];
      const references = Array.isArray(this.references) ? this.references : [];
      const sourceCount = citations.length;
      const referenceCount = references.length;
      if (sourceCount === 0 && referenceCount === 0) return;
      const activeTab = this._activeEvidenceTab === 'references' ? 'references' : 'sources';

      const max = 5;
      const visibleCitations = this._expandedCitations ? citations : citations.slice(0, max);
      const items = visibleCitations.map((c, i) => {
        const absoluteIndex = this._expandedCitations ? i : i;
        const label = c.label || c.filename || c.citation || c.title || c.name || 'Unknown';
        const fn = ChatFormat.escapeHtml(label);
        const pg = c.page_number || c.page || (c.locator && c.locator.page) || '?';
        const docId = ChatFormat.escapeHtml(c.document_id || c.documentId || c.doc_id || c.sourceRef || '');
        const excerpt = c.chunk_text || c.excerpt || c.snippet || c.content || c.text || '';
        const rel = c.relevance_score || c.relevance || 0;
        const pct = Math.round(rel * 100);
        const sourceType = ChatFormat.escapeHtml(c.sourceType || c.source_type || '');
        const source = ChatFormat.escapeHtml(c.source || '');
        const sourceKind = this._getCitationSourceKind(c);
        const relation = c.used_for || c.relevance_note || c.claim || '';

        return `
          <div class="lex-chat-citation-item">
            <span>${absoluteIndex + 1}.</span>
            <div>
              <button class="lex-chat-citation-link" data-citation-index="${absoluteIndex}" data-document-id="${docId}" data-filename="${fn}" data-page="${ChatFormat.escapeHtml(String(pg))}" data-source-type="${sourceType}" data-source="${source}">${fn}</button>
              <div>${sourceKind}</div>
              ${relation ? `<div style="opacity:0.8">${ChatFormat.escapeHtml(String(relation))}</div>` : ''}
              ${pg !== '?' ? `<div>page ${pg}</div>` : ''}
              ${pct > 0 ? `<div>Relevance: ${pct}%</div>` : ''}
              ${excerpt ? `<div style="opacity:0.7;font-style:italic">${ChatFormat.escapeHtml(excerpt.substring(0, 100))}${excerpt.length > 100 ? '...' : ''}</div>` : ''}
            </div>
          </div>`;
      }).join('');

      const more = !this._expandedCitations && citations.length > max
        ? `<button class="lex-chat-citations-more" type="button">+ ${citations.length - max} more</button>`
        : this._expandedCitations && citations.length > max
          ? '<button class="lex-chat-citations-more" type="button">Show less</button>'
        : '';
      const referencesHtml = referenceCount > 0
        ? references.map((ref, i) => this._renderReferenceItem(ref, i)).join('')
        : '<div class="lex-chat-reference-empty">No structured references for this response.</div>';
      const sourcesHtml = sourceCount > 0
        ? items + more
        : '<div class="lex-chat-reference-empty">No sources for this response.</div>';
      const panelHtml = activeTab === 'references'
        ? referencesHtml
        : sourcesHtml;

      body.insertAdjacentHTML('beforeend', `
        <div class="lex-chat-citations-section">
          <div class="lex-chat-evidence-tabs" role="tablist" aria-label="Response evidence">
            <button class="lex-chat-evidence-tab" type="button" role="tab" aria-selected="${activeTab === 'sources'}" data-evidence-tab="sources">Sources (${sourceCount})</button>
            <button class="lex-chat-evidence-tab" type="button" role="tab" aria-selected="${activeTab === 'references'}" data-evidence-tab="references">References (${referenceCount})</button>
          </div>
          ${panelHtml}
        </div>`);
    }

    _renderReferenceItem(ref, i) {
      const label = ChatFormat.escapeHtml(ref.label || ref.title || ref.name || ref.id || 'Reference');
      const type = ChatFormat.escapeHtml(ref.type || ref.entity_type || 'reference');
      const description = ref.preview && typeof ref.preview === 'object'
        ? Object.keys(ref.preview).slice(0, 3).map((key) => `${key}: ${ref.preview[key]}`).join(' - ')
        : (ref.description || ref.subtitle || '');
      return `
        <div class="lex-chat-citation-item">
          <span>${i + 1}.</span>
          <div>
            <button class="lex-chat-reference-link" data-reference-index="${i}">${label}</button>
            <div>${type}</div>
            ${description ? `<div style="opacity:0.7">${ChatFormat.escapeHtml(String(description))}</div>` : ''}
          </div>
        </div>`;
    }

    _getCitationSourceKind(citation) {
      const source = String(citation && citation.source || '').toLowerCase();
      const sourceType = String(citation && (citation.sourceType || citation.source_type) || '').toLowerCase();
      if (source === 'domain_pack' || sourceType === 'domain_pack') return 'Legal authority';
      if (sourceType === 'document' || sourceType === 'chunk' || citation.document_id || citation.documentId || citation.doc_id) return 'Workspace document';
      return 'Source';
    }

    _renderArtifactsSection(artifacts) {
      const body = this.querySelector('.lex-chat-msg-agent-body');
      if (!body || body.querySelector('.lex-chat-artifacts-section')) return;
      const ContextPromotion = getContextPromotion();
      const ArtifactPromotion = getArtifactPromotion();

      const items = artifacts.map(a => {
        const contextPromotion = (ContextPromotion || ArtifactPromotion) &&
          (ContextPromotion || ArtifactPromotion).getContextPromotionView &&
          (ContextPromotion || ArtifactPromotion).getContextPromotionView(a);
        if (contextPromotion) {
          return this._renderContextPromotionCard(a, contextPromotion);
        }

        const persistence = ArtifactPromotion && ArtifactPromotion.getPersistenceView(a);
        const promotionAction = ArtifactPromotion && ArtifactPromotion.getSaveToDocumentsAction(a);
        if (persistence || promotionAction) {
          return this._renderPersistedArtifactCard(a, persistence, promotionAction);
        }

        const type = a.entity_type || a.artifact_type || a.type || 'item';
        const label = a.label || a.name || a.title || type;
        return `<button class="lex-chat-artifact-btn" data-artifact-type="${ChatFormat.escapeHtml(type)}" data-entity-id="${ChatFormat.escapeHtml(a.entity_id || a.id || '')}" data-entity-type="${ChatFormat.escapeHtml(type)}">${ChatFormat.escapeHtml(label)}</button>`;
      }).join('');

      body.insertAdjacentHTML('beforeend', `<div class="lex-chat-artifacts-section">${items}</div>`);
    }

    _renderPersistedArtifactCard(artifact, persistence, action) {
      const ArtifactPromotion = getArtifactPromotion();
      const artifactId = ArtifactPromotion ? ArtifactPromotion.getArtifactId(artifact) : '';
      const type = artifact.artifact_type || artifact.type || 'document';
      const label = artifact.artifact_name || artifact.label || artifact.name || artifact.title || 'Generated document';
      const status = persistence || {
        status: 'unknown',
        tone: 'neutral',
        message: 'The server did not report whether this draft was saved.'
      };
      const canonicalDocument = artifact.document || artifact.canonical_document || null;
      const canonicalMatterId = canonicalDocument &&
        (canonicalDocument.matter_id || canonicalDocument.client_matter) ||
        artifact.matter_id || artifact.matterId || '';
      const canPromote = status.status === 'saved_as_draft' && action && artifactId;
      let actionButton = canPromote
        ? `<lex-btn class="lex-chat-artifact-promote" data-artifact-id="${ChatFormat.escapeHtml(artifactId)}" variant="secondary" size="sm">Save to Documents</lex-btn>`
        : '';
      if (!actionButton && status.status === 'promoted' && canonicalDocument && canonicalDocument.id) {
        actionButton = `<lex-btn class="lex-chat-artifact-open-document" data-document-id="${ChatFormat.escapeHtml(canonicalDocument.id)}" data-matter-id="${ChatFormat.escapeHtml(canonicalMatterId)}" variant="secondary" size="sm">Open Document</lex-btn>`;
      }

      return `
        <div class="lex-chat-artifact-card" data-artifact-id="${ChatFormat.escapeHtml(artifactId)}">
          <div class="lex-chat-artifact-card-main">
            <div class="lex-chat-artifact-card-title">${ChatFormat.escapeHtml(label)}</div>
            <div class="lex-chat-artifact-persistence lex-chat-artifact-persistence--${ChatFormat.escapeHtml(status.tone)}" data-artifact-persistence role="status" aria-live="polite">
              <span class="lex-chat-artifact-status-dot" aria-hidden="true"></span>
              <span data-artifact-status-message>${ChatFormat.escapeHtml(status.message)}</span>
            </div>
            ${this._renderArtifactRecallMeta(artifact)}
          </div>
          <div class="lex-chat-artifact-card-actions" data-artifact-actions>
            ${actionButton}
          </div>
          <span class="lex-chat-artifact-type">${ChatFormat.escapeHtml(type)}</span>
        </div>`;
    }

    _renderArtifactRecallMeta(artifact) {
      const meta = [];
      const approvals = artifact && artifact.approvals && typeof artifact.approvals === 'object' ? artifact.approvals : {};
      const created = approvals.created && typeof approvals.created === 'object' ? approvals.created : null;
      const promoted = approvals.promoted && typeof approvals.promoted === 'object' ? approvals.promoted : null;
      const inclusions = Array.isArray(artifact && artifact.inclusions) ? artifact.inclusions : [];

      if (created) {
        meta.push('Created by ' + (created.user_name || created.user_id || 'LANA'));
      }
      if (promoted) {
        meta.push('Approved by ' + (promoted.user_name || promoted.user_id || 'reviewer'));
      }
      if (inclusions.length > 0) {
        meta.push('Includes ' + inclusions.length + ' source' + (inclusions.length === 1 ? '' : 's'));
      }

      if (meta.length === 0) return '';
      return '<div class="lex-chat-artifact-recall">' + meta.map(function (item) {
        return '<span>' + ChatFormat.escapeHtml(item) + '</span>';
      }).join('') + '</div>';
    }

    _renderContextPromotionCard(artifact, view) {
      const ContextPromotion = getContextPromotion();
      const ArtifactPromotion = getArtifactPromotion();
      const helper = ContextPromotion || ArtifactPromotion;
      const promotionId = helper && helper.getContextPromotionId ? helper.getContextPromotionId(artifact) : (view.id || '');
      const approveAction = helper && helper.getApproveContextPromotionAction ? helper.getApproveContextPromotionAction(artifact) : null;
      const dismissAction = helper && helper.getDismissContextPromotionAction ? helper.getDismissContextPromotionAction(artifact) : null;
      const canAct = view.status === 'pending' && promotionId;
      const target = view.matterName || view.matterId || 'Matter';
      const meta = [
        view.sourceLabel,
        view.sensitivity,
        target ? 'Target: ' + target : ''
      ].filter(Boolean).map(function (item) {
        return '<span>' + ChatFormat.escapeHtml(String(item)) + '</span>';
      }).join('');

      const actions = canAct ? [
        approveAction ? '<lex-btn class="lex-chat-context-action" data-context-action="approve" data-promotion-id="' + ChatFormat.escapeHtml(promotionId) + '" variant="secondary" size="sm">Approve</lex-btn>' : '',
        dismissAction ? '<lex-btn class="lex-chat-context-action" data-context-action="dismiss" data-promotion-id="' + ChatFormat.escapeHtml(promotionId) + '" variant="ghost" size="sm">Dismiss</lex-btn>' : ''
      ].join('') : '';

      return `
        <div class="lex-chat-context-card" data-context-promotion-id="${ChatFormat.escapeHtml(promotionId)}" data-tone="${ChatFormat.escapeHtml(view.tone)}">
          <div class="lex-chat-context-card-head">
            <div>
              <div class="lex-chat-context-card-title">${ChatFormat.escapeHtml(view.title)}</div>
              ${view.reason ? '<div class="lex-chat-context-meta" style="margin-top:4px;"><span>' + ChatFormat.escapeHtml(view.reason) + '</span></div>' : ''}
            </div>
            <div class="lex-chat-context-card-status" data-context-promotion-status role="status" aria-live="polite">
              <span class="lex-chat-context-status-dot" aria-hidden="true"></span>
              <span data-context-status-message>${ChatFormat.escapeHtml(view.message)}</span>
            </div>
          </div>
          ${view.insight ? '<div class="lex-chat-context-insight">' + ChatFormat.escapeHtml(view.insight) + '</div>' : ''}
          ${meta ? '<div class="lex-chat-context-meta">' + meta + '</div>' : ''}
          ${actions ? '<div class="lex-chat-context-actions" data-context-actions>' + actions + '</div>' : ''}
        </div>`;
    }

    _findArtifact(artifactId) {
      var artifacts = this.artifacts || [];
      var ArtifactPromotion = getArtifactPromotion();
      for (var i = 0; i < artifacts.length; i += 1) {
        var currentId = ArtifactPromotion
          ? ArtifactPromotion.getArtifactId(artifacts[i])
          : (artifacts[i].artifact_id || artifacts[i].id || '');
        if (String(currentId) === String(artifactId)) return artifacts[i];
      }
      return null;
    }

    _findArtifactCard(artifactId) {
      var cards = this.querySelectorAll('.lex-chat-artifact-card');
      for (var i = 0; i < cards.length; i += 1) {
        if (String(cards[i].dataset.artifactId || '') === String(artifactId || '')) return cards[i];
      }
      return null;
    }

    _findContextPromotion(promotionId) {
      var artifacts = this.artifacts || [];
      var ContextPromotion = getContextPromotion();
      var ArtifactPromotion = getArtifactPromotion();
      var helper = ContextPromotion || ArtifactPromotion;
      for (var i = 0; i < artifacts.length; i += 1) {
        var currentId = helper && helper.getContextPromotionId
          ? helper.getContextPromotionId(artifacts[i])
          : (artifacts[i].promotion_id || artifacts[i].id || '');
        if (String(currentId) === String(promotionId)) return artifacts[i];
      }
      return null;
    }

    _findContextPromotionCard(promotionId) {
      var cards = this.querySelectorAll('.lex-chat-context-card');
      for (var i = 0; i < cards.length; i += 1) {
        if (String(cards[i].dataset.contextPromotionId || '') === String(promotionId || '')) return cards[i];
      }
      return null;
    }

    updateContextPromotion(promotionId, update) {
      var card = this._findContextPromotionCard(promotionId);
      if (!card || !update) return;

      var statusEl = card.querySelector('[data-context-promotion-status]');
      var messageEl = card.querySelector('[data-context-status-message]');
      var actionsEl = card.querySelector('[data-context-actions]');
      var buttons = card.querySelectorAll('.lex-chat-context-action');

      if (messageEl) messageEl.textContent = update.message || '';
      card.dataset.tone = update.tone || 'pending';
      if (statusEl) statusEl.setAttribute('aria-busy', update.tone === 'pending' ? 'true' : 'false');

      for (var i = 0; i < buttons.length; i += 1) {
        buttons[i].loading = update.tone === 'pending';
        buttons[i].disabled = update.tone === 'pending';
      }

      if ((update.tone === 'success' || update.tone === 'neutral') && actionsEl) {
        actionsEl.innerHTML = '';
        var artifact = this._findContextPromotion(promotionId);
        if (artifact) {
          var promotion = artifact.context_promotion || artifact.contextPromotion || artifact;
          promotion.status = update.status || (update.tone === 'success' ? 'promoted' : 'dismissed');
          promotion.message = update.message || '';
        }
      }
    }

    updateArtifactPromotion(artifactId, update) {
      var card = this._findArtifactCard(artifactId);
      if (!card || !update) return;

      var statusEl = card.querySelector('[data-artifact-persistence]');
      var messageEl = card.querySelector('[data-artifact-status-message]');
      var promoteButton = card.querySelector('.lex-chat-artifact-promote');
      var actionsEl = card.querySelector('[data-artifact-actions]');

      if (messageEl) messageEl.textContent = update.message || '';
      if (statusEl) {
        statusEl.classList.remove(
          'lex-chat-artifact-persistence--draft',
          'lex-chat-artifact-persistence--success',
          'lex-chat-artifact-persistence--error',
          'lex-chat-artifact-persistence--neutral',
          'lex-chat-artifact-persistence--pending'
        );
        statusEl.classList.add('lex-chat-artifact-persistence--' + (update.tone || 'neutral'));
      }

      if (promoteButton) {
        promoteButton.loading = update.tone === 'pending';
        promoteButton.disabled = update.tone === 'pending';
      }

      if (update.tone === 'success' && actionsEl) {
        var artifact = this._findArtifact(artifactId);
        if (artifact) {
          artifact.persistence = {
            status: 'promoted',
            message: update.message || 'Saved to Documents.'
          };
          artifact.document = update.document || null;
          if (update.matterId) artifact.matter_id = update.matterId;
          artifact.actions = (artifact.actions || []).filter(function (action) {
            return !action || action.id !== 'save_to_documents';
          });
        }

        actionsEl.innerHTML = '';
        if (update.document && update.document.id) {
          var openButton = document.createElement('lex-btn');
          openButton.className = 'lex-chat-artifact-open-document';
          openButton.dataset.documentId = update.document.id;
          openButton.dataset.matterId = update.matterId || '';
          openButton.variant = 'secondary';
          openButton.size = 'sm';
          openButton.textContent = 'Open Document';
          actionsEl.appendChild(openButton);
        }
      }

      if (update.tone === 'error' && promoteButton) {
        promoteButton.loading = false;
        promoteButton.disabled = false;
      }
    }

    /**
     * Get the raw accumulated content (useful for saving to history).
     */
    getRawContent() {
      return this._rawContent || this.content;
    }
  }

  // Export (registration deferred to barrel file)
  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChatMessage = LexChatMessage;
  global.Lex.Chat.formatTimestamp = formatTimestamp;

})(typeof window !== 'undefined' ? window : globalThis);

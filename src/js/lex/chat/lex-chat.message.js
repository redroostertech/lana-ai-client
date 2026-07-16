/* ==========================================================================
   Lex UI — <lex-chat-message>
   Renders a single chat message (user, assistant, or system).
   Supports streaming content via appendContent() and finalize().
   Uses lex-chat.css tokens for styling.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, defineLex, ChatFormat } = global.Lex;
  const ArtifactPromotion = global.Lex.Chat && global.Lex.Chat.ArtifactPromotion;
  if (!LexElement) { console.error('[lex-chat-message] LexElement not loaded'); return; }

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

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

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
      .lex-chat-msg-attachment-name {
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        artifacts:  { type: Array, default: [] },
        attachments: { type: Array, default: [] },
        grounding:   { type: Object, default: null }
      };
    }

    constructor() {
      super();
      this._rawContent = ''; // Accumulated raw content for streaming
      this._contentEl = null;
    }

    connected() {
      injectStyles();
    }

    _renderTimestamp() {
      // Auto-stamp on first render if no timestamp was provided
      if (!this.timestamp) {
        this._props.timestamp = new Date().toISOString();
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
      // Tokens
      const tc = this.tokenCount;
      if (tc) {
        parts.push(tc.toLocaleString() + ' tokens');
      }
      return parts.length > 0 ? ' · ' + parts.join(' · ') : '';
    }

    render() {
      const role = this.role;
      const tsHtml = this._renderTimestamp();

      if (role === 'system') {
        return `
          <div class="lex-chat-msg-system">
            <div class="lex-chat-msg-system-bubble">${ChatFormat ? ChatFormat.escapeHtml(this.content) : this.content}</div>
          </div>`;
      }

      if (role === 'user') {
        const attachments = this.attachments || [];
        const attachHtml = attachments.length > 0
          ? `<div class="lex-chat-msg-attachments">${attachments.map(a => {
              const name = ChatFormat ? ChatFormat.escapeHtml(a.filename || a.name || 'Document') : (a.filename || a.name || 'Document');
              return `<div class="lex-chat-msg-attachment">${ATTACH_FILE_ICON}<span class="lex-chat-msg-attachment-name" title="${name}">${name}</span></div>`;
            }).join('')}</div>`
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

      // assistant
      const streamCls = this.streaming ? ' lex-chat-narrative--streaming' : '';
      const logo = this.streaming ? BREATHING_LOGO : BREATHING_LOGO_STATIC;
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

      // Bind citation clicks via delegation
      this.delegate('click', '.lex-chat-citation-link', (e, target) => {
        e.preventDefault();
        this.emit('lex-citation-click', {
          documentId: target.dataset.documentId,
          filename: target.dataset.filename,
          page: parseInt(target.dataset.page, 10) || 1,
          citationNum: target.dataset.citationNum ? parseInt(target.dataset.citationNum, 10) : null
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
          entityType: 'document'
        });
      });

      // History messages arrive already finalized, so their artifact cards
      // are rendered during updated() rather than via finalize().
      if (!this.streaming && this.artifacts && this.artifacts.length > 0) {
        this._renderArtifactsSection(this.artifacts);
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

    /**
     * Append streaming content chunk.
     * @param {string} chunk - New text to add
     */
    appendContent(chunk) {
      this._rawContent += chunk;
      this._props.content = this._rawContent;
      this._props.streaming = true;

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
      this._props.streaming = false;
      if (metadata.messageId) this._props.messageId = metadata.messageId;
      if (metadata.timestamp) this._props.timestamp = metadata.timestamp;
      if (metadata.citations) this._props.citations = metadata.citations;
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
      const logo = this.querySelector('.lex-chat-indicator');
      if (logo) {
        logo.classList.add('lex-chat-indicator--static');
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

      var label, color;
      if (status === 'strong') {
        label = 'Grounded';
        color = 'green';
      } else if (status === 'partial' || status === 'weak') {
        label = 'Partially grounded';
        color = 'yellow';
      } else if (status === 'none') {
        if (evidenceMode === 'grounded_tool') {
          label = 'Tool-verified';
          color = 'blue';
        } else if (evidenceMode === 'ungrounded_fallback') {
          // General chat / greetings — no badge needed
          return;
        } else {
          label = 'Ungrounded';
          color = 'gray';
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
      wrapper.appendChild(badge);
    }

    _renderCitationsSection(citations) {
      const body = this.querySelector('.lex-chat-msg-agent-body');
      if (!body || body.querySelector('.lex-chat-citations-section')) return;

      const max = 5;
      const items = citations.slice(0, max).map((c, i) => {
        const fn = ChatFormat.escapeHtml(c.filename || 'Unknown');
        const pg = c.page_number || c.page || '?';
        const docId = ChatFormat.escapeHtml(c.document_id || '');
        const excerpt = c.chunk_text || c.excerpt || '';
        const rel = c.relevance_score || c.relevance || 0;
        const pct = Math.round(rel * 100);

        return `
          <div class="lex-chat-citation-item">
            <span>${i + 1}.</span>
            <div>
              <button class="lex-chat-citation-link" data-document-id="${docId}" data-filename="${fn}" data-page="${pg}">${fn}</button>
              ${pg !== '?' ? `<div>page ${pg}</div>` : ''}
              ${pct > 0 ? `<div>Relevance: ${pct}%</div>` : ''}
              ${excerpt ? `<div style="opacity:0.7;font-style:italic">${ChatFormat.escapeHtml(excerpt.substring(0, 100))}${excerpt.length > 100 ? '...' : ''}</div>` : ''}
            </div>
          </div>`;
      }).join('');

      const more = citations.length > max ? `<div style="font-size:10px;opacity:0.6;padding-left:8px">+ ${citations.length - max} more</div>` : '';

      body.insertAdjacentHTML('beforeend', `
        <div class="lex-chat-citations-section">
          <div style="font-size:11px;font-weight:600;color:var(--lex-chat-text-dim);margin-bottom:4px">Sources (${citations.length})</div>
          ${items}
          ${more}
        </div>`);
    }

    _renderArtifactsSection(artifacts) {
      const body = this.querySelector('.lex-chat-msg-agent-body');
      if (!body || body.querySelector('.lex-chat-artifacts-section')) return;

      const items = artifacts.map(a => {
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
      const artifactId = ArtifactPromotion ? ArtifactPromotion.getArtifactId(artifact) : '';
      const type = artifact.artifact_type || artifact.type || 'document';
      const label = artifact.artifact_name || artifact.label || artifact.name || artifact.title || 'Generated document';
      const status = persistence || {
        status: 'unknown',
        tone: 'neutral',
        message: 'The server did not report whether this draft was saved.'
      };
      const canonicalDocument = artifact.document || artifact.canonical_document || null;
      const canPromote = status.status === 'saved_as_draft' && action && artifactId;
      let actionButton = canPromote
        ? `<lex-btn class="lex-chat-artifact-promote" data-artifact-id="${ChatFormat.escapeHtml(artifactId)}" variant="secondary" size="sm">Save to Documents</lex-btn>`
        : '';
      if (!actionButton && status.status === 'promoted' && canonicalDocument && canonicalDocument.id) {
        actionButton = `<lex-btn class="lex-chat-artifact-open-document" data-document-id="${ChatFormat.escapeHtml(canonicalDocument.id)}" variant="secondary" size="sm">Open Document</lex-btn>`;
      }

      return `
        <div class="lex-chat-artifact-card" data-artifact-id="${ChatFormat.escapeHtml(artifactId)}">
          <div class="lex-chat-artifact-card-main">
            <div class="lex-chat-artifact-card-title">${ChatFormat.escapeHtml(label)}</div>
            <div class="lex-chat-artifact-persistence lex-chat-artifact-persistence--${ChatFormat.escapeHtml(status.tone)}" data-artifact-persistence role="status" aria-live="polite">
              <span class="lex-chat-artifact-status-dot" aria-hidden="true"></span>
              <span data-artifact-status-message>${ChatFormat.escapeHtml(status.message)}</span>
            </div>
          </div>
          <div class="lex-chat-artifact-card-actions" data-artifact-actions>
            ${actionButton}
          </div>
          <span class="lex-chat-artifact-type">${ChatFormat.escapeHtml(type)}</span>
        </div>`;
    }

    _findArtifact(artifactId) {
      var artifacts = this.artifacts || [];
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
          artifact.actions = (artifact.actions || []).filter(function (action) {
            return !action || action.id !== 'save_to_documents';
          });
        }

        actionsEl.innerHTML = '';
        if (update.document && update.document.id) {
          var openButton = document.createElement('lex-btn');
          openButton.className = 'lex-chat-artifact-open-document';
          openButton.dataset.documentId = update.document.id;
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

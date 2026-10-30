/* ==========================================================================
   Lex UI — <lex-chat>
   Main orchestrator that wires all chat subcomponents together.
   Routes ChatSource events to child components.
   Returns null from render() after initial DOM setup.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, ChatFormat } = global.Lex;
  const Chat = global.Lex.Chat || {};
  if (!LexElement) { console.error('[lex-chat] LexElement not loaded'); return; }

  // A saved interaction is offered again only when the live read returns the
  // same interaction for the same task, still pending.
  function pendingInteractionMatches(saved, live) {
    return Boolean(saved && live && live.status === 'pending'
      && live.id === saved.id && live.task_id === saved.task_id && live.kind === saved.kind);
  }

  // An approval for a tool on a third-party MCP server (connector_live_action
  // through an MCP server). The runtime's approval payload names the server,
  // the tool and a bounded summary of what will be sent; the fields are read
  // from approval.external (or approval.mcp), then approval.action,
  // approval.action.arguments, approval and the interaction itself:
  //   server_name, tool_title (or tool_name), arguments_summary
  //   (a string, or a list of strings or { label | name, value }).
  // An approval counts as external when it says so (external: true, an
  // external or mcp block, provider or connector_id 'mcp-server'), or when a
  // connector_live_action names a server. Every value is remote or derived
  // from remote text: it is bounded here and rendered with textContent only.
  // Returns null for any other approval.
  const EXTERNAL_TEXT_LIMIT = 300;
  const EXTERNAL_SUMMARY_LIMIT = 2000;
  const EXTERNAL_SUMMARY_LINES = 20;
  // The backend refuses MCP arguments larger than 16 KB, so the full view of
  // what will be sent always fits; anything longer is shown as not viewable.
  const EXTERNAL_FULL_LIMIT = 32768;

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function boundedText(value, max) {
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  function summaryLines(value) {
    if (typeof value === 'string') {
      const text = boundedText(value, EXTERNAL_SUMMARY_LIMIT);
      return text ? [text] : [];
    }
    if (!Array.isArray(value)) return [];
    const lines = [];
    for (const item of value.slice(0, EXTERNAL_SUMMARY_LINES)) {
      if (typeof item === 'string' || typeof item === 'number') {
        const text = boundedText(item, EXTERNAL_TEXT_LIMIT);
        if (text) lines.push(text);
        continue;
      }
      const entry = plainObject(item);
      const label = boundedText(entry.label || entry.name, EXTERNAL_TEXT_LIMIT);
      let raw = entry.value;
      if (raw !== null && typeof raw === 'object') {
        try { raw = JSON.stringify(raw); } catch (_error) { raw = ''; }
      }
      const shown = boundedText(raw, EXTERNAL_TEXT_LIMIT);
      if (label || shown) lines.push(label && shown ? label + ': ' + shown : (label || shown));
    }
    return lines;
  }

  function externalApprovalView(interaction) {
    const i = plainObject(interaction);
    if (i.kind !== 'approval') return null;
    const approval = plainObject(i.approval);
    const action = plainObject(approval.action);
    const args = plainObject(action.arguments);
    const block = Object.keys(plainObject(approval.external)).length ? plainObject(approval.external) : plainObject(approval.mcp);
    const sources = [block, action, args, approval, i];
    const pick = (key, max) => {
      for (const source of sources) {
        const text = boundedText(source[key], max);
        if (text) return text;
      }
      return '';
    };
    const pickSummary = () => {
      for (const source of sources) {
        const lines = summaryLines(source.arguments_summary);
        if (lines.length) return lines;
      }
      return [];
    };
    const serverName = pick('server_name', EXTERNAL_TEXT_LIMIT);
    const marked = approval.external === true || action.external === true || i.external === true
      || Object.keys(block).length > 0
      || pick('provider', 64) === 'mcp-server' || pick('connector_id', 64) === 'mcp-server';
    const external = marked || (action.capability === 'connector_live_action' && Boolean(serverName));
    if (!external) return null;
    // The complete arguments, sent when the summary had to shorten anything,
    // so the user can always read exactly what will leave the firm.
    const full = typeof block.arguments_full === 'string' ? block.arguments_full : '';
    return {
      serverName: serverName || 'an external server',
      toolTitle: pick('tool_title', EXTERNAL_TEXT_LIMIT) || pick('tool_name', EXTERNAL_TEXT_LIMIT)
        || boundedText(action.label, EXTERNAL_TEXT_LIMIT) || 'A tool',
      argumentsSummary: pickSummary(),
      truncated: block.truncated === true,
      argumentsFull: full.length <= EXTERNAL_FULL_LIMIT ? full : '',
      argumentsFullTooLong: full.length > EXTERNAL_FULL_LIMIT
    };
  }

  // The header above an external approval's Approve and Decline choices.
  function externalApprovalHeader(view) {
    const header = document.createElement('div');
    header.className = 'lex-chat-external-approval';
    const top = document.createElement('div');
    top.className = 'lex-chat-external-approval-top';
    const badge = document.createElement('lex-badge');
    badge.setAttribute('label', 'External');
    badge.setAttribute('color', 'blue');
    badge.setAttribute('size', 'sm');
    const title = document.createElement('p');
    title.className = 'lex-chat-external-approval-title';
    title.textContent = view.toolTitle;
    top.appendChild(badge);
    top.appendChild(title);
    header.appendChild(top);
    const from = document.createElement('p');
    from.className = 'lex-chat-external-approval-from';
    from.textContent = 'Provided by ' + view.serverName;
    header.appendChild(from);
    if (view.argumentsSummary.length) {
      const label = document.createElement('p');
      label.className = 'lex-chat-external-approval-label';
      label.textContent = 'What LANA will send';
      const list = document.createElement('ul');
      list.className = 'lex-chat-external-approval-args';
      for (const line of view.argumentsSummary) {
        const item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      }
      header.appendChild(label);
      header.appendChild(list);
    }
    if (view.argumentsFull) {
      const details = document.createElement('details');
      details.className = 'lex-chat-external-approval-full';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'Everything LANA will send';
      const pre = document.createElement('pre');
      pre.textContent = view.argumentsFull;
      details.appendChild(summary);
      details.appendChild(pre);
      header.appendChild(details);
    } else if (view.truncated || view.argumentsFullTooLong) {
      const warning = document.createElement('p');
      warning.className = 'lex-chat-external-approval-warning';
      warning.textContent = 'Part of this request is not shown here. Decline unless you can check it another way.';
      header.appendChild(warning);
    }
    const note = document.createElement('p');
    note.className = 'lex-chat-external-approval-note';
    note.textContent = 'This tool runs on a server outside LANA. Approve only if you expect this request.';
    header.appendChild(note);
    return header;
  }

  // Server-authored "what I checked" line saved with a message, if any.
  function persistedCoverageSummary(message) {
    const m = message || {};
    const meta = m.metadata && typeof m.metadata === 'object' ? m.metadata : {};
    const value = m.coverage_summary || m.coverageSummary || meta.coverage_summary || meta.coverageSummary;
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  // The page the user is on, as a file-viewer back referrer
  // (e.g. 'workspace-details.html?id=...'). The SPA shell keeps the real
  // route in history.state.path; standalone pages use the location.
  function currentRouteForReferrer() {
    const state = global.history && global.history.state;
    if (state && typeof state.path === 'string' && state.path) {
      return state.path.charAt(0) === '/' ? state.path.substring(1) : state.path;
    }
    const loc = global.location || {};
    const pathname = String(loc.pathname || '');
    const markers = ['/public_html/', '/src/'];
    let route = '';
    for (let i = 0; i < markers.length && !route; i++) {
      const idx = pathname.lastIndexOf(markers[i]);
      if (idx !== -1) route = pathname.substring(idx + markers[i].length);
    }
    if (!route) route = pathname.substring(pathname.lastIndexOf('/') + 1);
    return route ? route + String(loc.search || '') : '';
  }

  // ---------------------------------------------------------------------------
  // Tool-name humanizer
  // ---------------------------------------------------------------------------
  // Maps backend tool identifiers (and, where useful, params) to short
  // human-friendly phrases that appear above "Working..." on the activity
  // bar while a tool runs. Keep these phrases short (they replace the small
  // primary line in <lex-chat-activity>); the trailing ellipsis matches the
  // server-supplied tool_progress messages so the bar reads consistently.
  //
  // To extend: add a new entry below; for tools whose phrasing depends on a
  // param (e.g. get_matter_data + data_type), branch inside the function.
  // ---------------------------------------------------------------------------

  // Matches chef's ChatStateService MAX_ACTIVE_DOCUMENTS.
  const MAX_CHAT_DOCUMENTS = 3;

  // Conversation candidates and library files share one result shape.
  function toDocumentResult(row) {
    const id = row.file_id || row.document_id || row.id;
    const filename = row.filename || row.original_filename || row.name || 'Document';
    const workspace = row.workspace_name || row.matter_name || row.client_matter_name || '';
    return { id, filename, name: filename, meta: workspace };
  }

  function humanizeSnakeCase(name) {
    const cleaned = String(name || '').replace(/_/g, ' ').trim();
    if (!cleaned) return '';
    return `Running ${cleaned}…`;
  }

  function humanizeToolStart(toolName, params) {
    const name = String(toolName || '').trim();
    if (!name) return '';
    const p = params || {};

    switch (name) {
      case 'get_matter_data': {
        // Sub-shape varies by data_type; pick a friendly phrase per kind.
        const kind = String(p.data_type || '').toLowerCase();
        switch (kind) {
          case 'documents': return 'Looking up matter documents…';
          case 'tasks':     return 'Looking up matter tasks…';
          case 'contacts':  return 'Looking up matter contacts…';
          case 'notes':     return 'Looking up matter notes…';
          case 'comments':  return 'Looking up matter comments…';
          case 'activity':  return 'Looking up matter activity…';
          case 'access':    return 'Checking matter access…';
          default:          return 'Looking up matter data…';
        }
      }
      case 'get_matter_documents': return 'Looking up matter documents…';
      case 'get_matter_tasks':     return 'Looking up matter tasks…';
      case 'get_matter_contacts':  return 'Looking up matter contacts…';
      case 'get_matter_notes':     return 'Looking up matter notes…';
      case 'get_matter_calendar':  return 'Looking up matter calendar…';
      case 'get_automation_details': return 'Looking up automation details…';

      case 'find_organization_users': return 'Finding organization users…';
      case 'share_matter':            return 'Sharing matter…';

      case 'entity_search': return 'Searching records…';
      case 'entity_list':   return 'Listing records…';
      case 'entity_read':   return 'Reading record…';
      case 'entity_create': return 'Creating record…';
      case 'entity_update': return 'Updating record…';
      case 'entity_delete': return 'Deleting record…';

      case 'query_platform_knowledge': return 'Looking up platform knowledge…';
      case 'query_analytics_data':     return 'Querying analytics…';
      case 'generate_forecast':        return 'Generating forecast…';
      case 'request_additional_tools': return 'Loading more tools…';

      default:
        return humanizeSnakeCase(name);
    }
  }

  function pluralize(count, singular, plural) {
    return count === 1 ? singular : (plural || `${singular}s`);
  }

  function artifactIdentity(artifact) {
    if (!artifact || typeof artifact !== 'object') return '';
    const artifactId = artifact.artifact_id || artifact.id;
    if (artifactId) return `artifact:${artifactId}`;
    if (artifact.entity_type && artifact.entity_id) {
      return `entity:${artifact.entity_type}:${artifact.entity_id}`;
    }
    return '';
  }

  function mergeArtifactEvents(existing, incoming) {
    const artifacts = [];
    if (Array.isArray(existing)) artifacts.push(...existing);
    if (Array.isArray(incoming)) artifacts.push(...incoming);

    const merged = [];
    artifacts.forEach((artifact) => {
      const identity = artifactIdentity(artifact);
      const index = identity
        ? merged.findIndex((candidate) => artifactIdentity(candidate) === identity)
        : -1;
      if (index === -1) merged.push(artifact);
      else merged[index] = Object.assign({}, merged[index], artifact);
    });
    return merged;
  }

  function formatRagComplete(event) {
    const chunks = Number(event.chunksFound);
    const docs = Number(event.documentsSearched);
    if (Number.isFinite(chunks) && chunks > 0 && Number.isFinite(docs) && docs > 0) {
      return `Found ${chunks} relevant ${pluralize(chunks, 'excerpt')} across ${docs} ${pluralize(docs, 'document')}.`;
    }
    if (Number.isFinite(chunks) && chunks > 0) {
      return `Found ${chunks} relevant ${pluralize(chunks, 'excerpt')}.`;
    }
    return 'Document retrieval complete.';
  }

  function formatToolProgress(event) {
    const toolName = String(event.toolName || event.tool || '').trim();
    const phase = String(event.phase || '').toLowerCase();
    const scanType = String(event.scanType || '').toLowerCase();
    const status = String(event.status || '').toLowerCase();

    if (toolName === 'document_retrieval' || toolName === 'attachment_rag') {
      if (event.completed === true || status === 'completed' || status === 'complete') {
        return 'Attached document retrieval complete.';
      }
      if (scanType === 'embedding' || phase === 'embedding_search' || phase === 'searching') {
        return 'Searching attached document embeddings...';
      }
      if (scanType === 'direct' || scanType === 'direct_content' || phase === 'scanning') {
        return 'Scanning attached document content...';
      }
      if (event.filename) {
        return 'Analyzing attached document...';
      }
      return 'Retrieving attached document content...';
    }

    if (status === 'completed' || status === 'complete') {
      return 'Tool finished.';
    }
    return humanizeToolStart(toolName, {}) || 'Running tool...';
  }

  function formatConversationCompaction(event) {
    const status = String(event.status || 'applied').toLowerCase();
    if (status === 'skipped') {
      return 'Context compaction was not needed.';
    }
    if (status !== 'applied') {
      return 'Context compaction status updated.';
    }
    return 'Context compacted to keep this conversation within budget.';
  }

  function formatConversationCompactionDetails(event) {
    const parts = [formatConversationCompaction(event)];
    if (Number.isFinite(Number(event.beforeTokens)) && Number.isFinite(Number(event.afterTokens))) {
      parts.push(`${event.beforeTokens} to ${event.afterTokens} tokens`);
    }
    if (Number.isFinite(Number(event.droppedMessageCount)) && Number(event.droppedMessageCount) > 0) {
      parts.push(`${event.droppedMessageCount} older ${pluralize(Number(event.droppedMessageCount), 'message')} summarized or trimmed`);
    }
    return parts.join(' ');
  }

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-styles';
    style.textContent = `
      lex-chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--lex-chat-bg);
        color: var(--lex-chat-text);
        font-family: var(--lex-font-sans);
        overflow: hidden;
      }
      .lex-chat-context-meter {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 16px;
        font-size: 11px;
        color: var(--lex-text-muted, #6b7280);
      }
      .lex-chat-context-meter-bar {
        flex: 0 0 80px;
        height: 4px;
        border-radius: 2px;
        background: var(--lex-border, #e5e7eb);
        overflow: hidden;
      }
      .lex-chat-context-meter-fill {
        height: 100%;
        border-radius: 2px;
        background: #22c55e;
        transition: width .3s ease, background .3s ease;
        width: 0%;
      }
      .lex-chat-context-meter-fill[data-warn] { background: #f59e0b; }
      .lex-chat-context-meter-fill[data-danger] { background: #ef4444; }
    `;
    document.head.appendChild(style);
  }

  class LexChat extends LexElement {

    static get properties() {
      return {
        source:         { type: String, default: 'sse' },
        endpoint:       { type: String, default: '' },
        conversationId: { type: String, default: null, attribute: 'conversation-id' },
        matterId:       { type: String, default: null, attribute: 'matter-id' },
        maxHistory:     { type: Number, default: 50, attribute: 'max-history' },
        chatMode:       { type: String, default: 'general', attribute: 'chat-mode' },
        contextType:    { type: String, default: null, attribute: 'context-type' },
        showComposer:   { type: Boolean, default: true, attribute: 'show-composer' },
        placeholder:    { type: String, default: 'Message Lana AI...' },
        theme:          { type: String, default: null }
      };
    }

    constructor() {
      super();
      this._source = null;
      this._documents = [];
      this._citations = [];
      this._references = [];
      this._artifacts = [];
      this._streamingContent = '';
      this._initialized = false;
      this._contextWarningShown = false;
      this._contextMeterEl = null;
      this._activeTurnId = null;
      this._loadConversationSeq = 0;
      this._failedAttempt = null;
      this._recoveryMessageEl = null;
      this._recoverySequence = 0;
      this._activeRetryReceipt = null;
      this._retryReceiptPollTimer = null;
      this._retryAvailabilityTimer = null;
      this._retryReceiptPollDelayMs = 2000;

      // Sub-component references
      this._documentsEl = null;
      this._threadEl = null;
      this._activityEl = null;
      this._composerEl = null;
    }

    connected() {
      injectStyles();

      // Apply theme
      if (this.theme) {
        this.setAttribute('data-lex-theme', this.theme);
      }

      // Clear stale global chatMode from localStorage (legacy). Chat mode is now
      // per-component state and should not persist across conversations/pages.
      try { localStorage.removeItem('chatMode'); } catch (_) {}

      this._buildDOM();
      this._bindChildEvents();
      this._initSource();

      // Auto-load conversation if provided
      if (this.conversationId) {
        this.loadConversation(this.conversationId);
      }
    }

    // Imperative DOM after initial build
    render() { return null; }

    _buildDOM() {
      this.innerHTML = `
        <lex-chat-documents></lex-chat-documents>
        <lex-chat-thread></lex-chat-thread>
        <lex-chat-activity hidden></lex-chat-activity>
        <div class="lex-chat-context-meter" style="display:none">
          <div class="lex-chat-context-meter-bar"><div class="lex-chat-context-meter-fill"></div></div>
          <span class="lex-chat-context-meter-text"></span>
        </div>
        ${this.showComposer ? '<lex-chat-composer></lex-chat-composer>' : ''}
      `;

      this._documentsEl = this.querySelector('lex-chat-documents');
      this._threadEl = this.querySelector('lex-chat-thread');
      this._activityEl = this.querySelector('lex-chat-activity');
      this._composerEl = this.querySelector('lex-chat-composer');
      this._contextMeterEl = this.querySelector('.lex-chat-context-meter');

      // Apply initial props
      if (this._composerEl) {
        this._composerEl.placeholder = this.placeholder;
        // Forward matter scope so the composer's @-mention typeahead can
        // include matter contacts in addition to org users + agents.
        if (this.matterId) this._composerEl.matterId = this.matterId;
      }
      // Show welcome
      if (this._threadEl && !this.conversationId) {
        this._threadEl.showWelcome();
      }
    }

    _bindChildEvents() {
      // ── Action Bridge — bidirectional block↔AI communication ──
      if (global.Lex.ActionBridge) {
        this._bridge = new global.Lex.ActionBridge();
        this._bridge.attach(this, {
          feedbackEndpoint: '/api/v1/feedback/',
          getToken: () => localStorage.getItem('token') || '',
          getBaseUrl: () => {
            const api = global.api;
            return api?.baseUrl || '';
          }
        });
      }

      // Composer send. Messages whose first token is a registered slash
      // command (/help, /summary, ...) use the command fast path; backend-backed
      // commands still go to Chef, but skip the LLM stream.
      this.addEventListener('lex-composer-send', (e) => {
        if (this._maybeRunSlashCommand(e.detail.content, { attachments: e.detail.attachments })) return;
        const opts = {};
        if (e.detail.attachments) opts.attachments = e.detail.attachments;
        this.send(e.detail.content, opts);
      });

      this.addEventListener('lex-composer-validation-error', (e) => {
        const message = e.detail?.message || 'Message could not be sent.';
        this._showSystemMessage(message);
        this.emit('lex-chat-error', {
          error: message,
          type: 'validation',
          status: 400,
          field: e.detail?.field || null
        });
      });

      // Composer stop
      this.addEventListener('lex-composer-stop', () => {
        this.stop();
      });

      this.addEventListener('lex-chat-retry', (e) => {
        this.retryLastFailed(e.detail || {});
      });

      // Composer suggestion (fallback if bridge isn't loaded)
      this.addEventListener('lex-composer-suggestion', (e) => {
        if (!this._bridge) this.send(e.detail.value);
      });

      // Banner chip remove / Clear / Manage
      this.addEventListener('lex-document-remove', (e) => {
        this.removeDocument(e.detail.documentId);
      });

      this.addEventListener('lex-document-exit', () => {
        this.clearDocuments();
      });

      this.addEventListener('lex-document-manage', () => {
        this.openDocumentsManager();
      });

      // Citation click — emit cancelable event, then open document as default.
      // Pages can call e.preventDefault() on lex-chat-citation-click to override.
      this.addEventListener('lex-citation-click', (e) => {
        const evt = new CustomEvent('lex-chat-citation-click', {
          detail: e.detail, bubbles: true, composed: true, cancelable: true
        });
        this.dispatchEvent(evt);
        if (!evt.defaultPrevented) {
          this._openCitationSource(e.detail);
        }
      });

      this.addEventListener('lex-reference-click', (e) => {
        const evt = new CustomEvent('lex-chat-reference-click', {
          detail: e.detail, bubbles: true, composed: true, cancelable: true
        });
        this.dispatchEvent(evt);
        if (!evt.defaultPrevented) {
          this._openReference(e.detail && e.detail.reference);
        }
      });

      // Artifact click (bubble up from message)
      this.addEventListener('lex-artifact-click', (e) => {
        this.emit('lex-chat-artifact-click', e.detail);
      });

      // Promotion is executed by the page controller so the message remains a
      // presentation-only component and the page can use the shared API client.
      this.addEventListener('lex-artifact-promote', (e) => {
        this.emit('lex-chat-artifact-promote', e.detail);
      });

      this.addEventListener('lex-context-promotion-action', (e) => {
        this.emit('lex-chat-context-promotion-action', e.detail);
      });

      // Thread scroll-top for pagination
      this.addEventListener('lex-thread-scroll-top', () => {
        this._loadMoreHistory();
      });

      // Composer tool selection — set component state, not global localStorage.
      // Tools are modes: the composer keeps one active at a time. Documents are
      // not a mode; attaching one is the signal (see addDocument).
      this.addEventListener('lex-composer-tool-select', (e) => {
        const { toolId } = e.detail;
        if (toolId === 'agentic') {
          this._props.chatMode = 'agentic';
        } else if (toolId === 'insights_chat') {
          this._props.chatMode = 'insights';
        }
        this.emit('lex-chat-tool-select', { toolId });
      });

      // Composer tool dismiss
      this.addEventListener('lex-composer-tool-dismiss', (e) => {
        const { toolId } = e.detail;
        if (toolId === 'agentic') {
          this._props.chatMode = 'general';
        } else if (toolId === 'insights_chat') {
          this._props.chatMode = 'general';
        }
        this.emit('lex-chat-tool-dismiss', { toolId });
      });

      // Composer "Manage chat documents". Hosts may cancel lex-chat-manage-documents
      // to show their own UI; otherwise the chat opens its documents drawer.
      this.addEventListener('lex-composer-manage-documents', () => {
        const evt = new CustomEvent('lex-chat-manage-documents', {
          bubbles: true, composed: true, cancelable: true
        });
        this.dispatchEvent(evt);
        if (!evt.defaultPrevented) this.openDocumentsManager();
      });

      // Composer # picker search
      this.addEventListener('lex-composer-document-search', (e) => {
        const composer = this._composerEl;
        if (!composer || typeof composer.setDocumentResults !== 'function') return;
        const seq = (this._docSearchSeq = (this._docSearchSeq || 0) + 1);
        this.searchDocuments((e.detail && e.detail.query) || '', { limit: 10 })
          .then((docs) => { if (seq === this._docSearchSeq) composer.setDocumentResults(docs); })
          .catch(() => { if (seq === this._docSearchSeq) composer.setDocumentResults([]); });
      });

      // Composer document selection from # picker — add document to chat context
      // and trigger JIT processing if the document isn't vectorized yet.
      this.addEventListener('lex-composer-document-select', async (e) => {
        const { documentId, filename } = e.detail || {};
        if (documentId) {
          try {
            await this.addDocument(documentId, filename);
            this._ensureDocumentProcessed(documentId, filename);
          } catch (err) {
            this._showSystemMessage('Failed to add document: ' + err.message);
            // Remove badge from composer on failure
            const composer = this.querySelector('lex-chat-composer');
            if (composer) composer.removeDocument(documentId);
          }
        }
      });

      // Composer document badge dismissed — remove from chat context
      this.addEventListener('lex-composer-document-remove', async (e) => {
        const { documentId } = e.detail || {};
        if (documentId) {
          await this.removeDocument(documentId);
        }
      });
    }

    // ---------------------------------------------------------------------------
    // Source management
    // ---------------------------------------------------------------------------

    _initSource() {
      const sourceName = this.source;

      // Check if a programmatic source was set
      if (this._source) return;

      // Create from registry
      try {
        this._source = Chat.createSource(sourceName, {
          endpoint: this.endpoint,
          api: global.api
        });
      } catch (err) {
        console.warn(`[lex-chat] Source "${sourceName}" not found, falling back to SSE`);
        if (Chat.SSEChatSource) {
          this._source = new Chat.SSEChatSource({ endpoint: this.endpoint, api: global.api });
        }
      }
    }

    /**
     * Get the current ChatSource instance.
     */
    getSource() { return this._source; }

    /**
     * Set a programmatic source instance.
     */
    set sourceInstance(src) {
      if (this._source) this._source.disconnect();
      this._source = src;
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Send a message through the chat source.
     */
    async send(content, opts = {}) {
      return this._sendAttempt(content, opts, { retry: false, optionsBuilt: false });
    }

    /**
     * Replay the most recent retryable failed turn. The stored options are the
     * fully resolved request snapshot (workspace, attachments, chat mode), so
     * Retry cannot silently change scope when the user changes pages or tools.
     */
    async retryLastFailed(detail = {}) {
      const attempt = this._failedAttempt;
      if (!attempt) return false;
      if (detail.recoveryId && detail.recoveryId !== attempt.recoveryId) return false;
      if (this._activeTurnId) {
        this.emit('lex-chat-error', {
          error: 'A response is already in progress.',
          type: 'concurrent_retry'
        });
        return false;
      }

      this._failedAttempt = null;
      this._clearRetryAvailabilityTimer();
      this._setRecoveryState({ disabled: true, label: 'Retrying…', status: 'retrying' });
      return this._sendAttempt(
        attempt.content,
        this._cloneRetryOptions(attempt.options),
        { retry: true, optionsBuilt: true }
      );
    }

    async _sendAttempt(content, opts = {}, internal = {}) {
      if (!content || !this._source) return;
      if (this._activeRetryReceipt) {
        this._showSystemMessage('The retried response is still in progress.');
        this.emit('lex-chat-error', {
          error: 'A retried response is already in progress.',
          type: 'concurrent_retry_receipt'
        });
        return false;
      }
      if (this._activeTurnId) {
        this._showSystemMessage('A response is already in progress.');
        this.emit('lex-chat-error', {
          error: 'A response is already in progress.',
          type: 'concurrent_send'
        });
        return false;
      }

      if (!internal.retry && this._failedAttempt) {
        this._failedAttempt = null;
        this._setRecoveryState({ disabled: true, label: 'Retry unavailable', status: 'superseded' });
      }

      const turnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this._activeTurnId = turnId;

      // Reset per-message state
      this._citations = [];
      this._references = [];
      this._artifacts = [];
      this._streamingContent = '';
      this._groundingContext = null;
      this._sendStartTime = Date.now();
      this._planReadyReceived = false;
      this._recoveryNoticeShownForConversation = null;

      const sendOpts = internal.optionsBuilt
        ? this._cloneRetryOptions(opts)
        : this._buildInitialSendOptions(opts);
      const messageAttachments = this._messageAttachmentsFromSendOptions(sendOpts);

      // The original user bubble remains in place for a safe pre-admission
      // retry. Adding it again would create a visible duplicate even when the
      // backend correctly reuses the original turn.
      if (this._threadEl && !internal.retry) {
        this._threadEl.addMessage('user', content, {
          attachments: messageAttachments.length ? messageAttachments : undefined
        });
      }

      // Hide suggestions after first message
      if (this._composerEl) {
        this._composerEl.clear();
        this._composerEl.hideSuggestions();
        this._composerEl.setGenerating(true);
      }

      // Show activity indicator
      if (this._activityEl) {
        this._activityEl.clearReasoning();
        this._activityEl.show('Working...');
      }

      // Emit send event
      this.emit('lex-chat-send', {
        content,
        conversationId: this.conversationId,
        retry: internal.retry === true
      });

      // Fire-and-forget JIT processing for any #filename mentions
      this._processMessageMentions(content);

      let responseStarted = false;
      let terminalReceived = false;
      let failure = null;
      let requestStarted = false;
      let generationAdmitted = false;
      let admittedGenerationId = null;
      let activeRetryReceipt = null;
      this._agenticBlockedReceived = false;

      try {
        // Connection failures are retryable turns too. Keep the connect inside
        // the same guarded lifecycle so composer/activity state always clears.
        if (!this._source.connected) {
          await this._source.connect(this.conversationId);
        }
        requestStarted = true;
        // Iterate async generator
        for await (const event of this._source.send(content, sendOpts)) {
          if (this._activeTurnId !== turnId) {
            break;
          }
          this._handleEvent(event, responseStarted);

          if (event.type === 'connected') {
            // The server emits connected only after admitGenerationWithUserMessage
            // has committed the user row.
            generationAdmitted = true;
            admittedGenerationId = event.generationId || admittedGenerationId;
          }
          if (event.type === 'content' && !responseStarted) {
            responseStarted = true;
          }
          if (event.type === 'done' || event.type === 'stopped' || event.type === 'error' ||
              event.type === 'agentic_error' || event.type === 'retry_receipt') {
            terminalReceived = true;
          }
          if (event.type === 'error' || event.type === 'agentic_error') {
            failure = this._failureFromEvent(event);
            failure.generationAdmitted = generationAdmitted;
            failure.retryGenerationId = event.generationId || admittedGenerationId || null;
            failure.safeFreshRetry = generationAdmitted !== true &&
              (failure.code === 'PERSISTENCE_UNAVAILABLE' || event.safeFreshRetry === true);
          }
          if (event.type === 'retry_receipt' && ['failed', 'timed_out', 'disconnected'].includes(event.generationStatus)) {
            failure = {
              message: 'The prior retry did not complete.',
              status: null,
              details: { retryable: true },
              code: 'RETRY_TERMINAL_FAILURE',
              type: 'retry_receipt',
              generationAdmitted: true,
              retryGenerationId: event.generationId || null,
              safeFreshRetry: false
            };
          }
          if (event.type === 'retry_receipt' && ['active', 'terminalizing'].includes(event.generationStatus)) {
            activeRetryReceipt = event;
          }
        }
      } catch (err) {
        console.error('[lex-chat] Send error:', err);
        terminalReceived = true;
        failure = {
          message: err && err.message ? err.message : 'The request could not be sent.',
          status: err && err.status ? Number(err.status) : null,
          details: err && err.details ? err.details : null,
          type: 'send',
          generationAdmitted,
          // A failure while binding/creating the conversation precedes the
          // streaming admission call. Once send iteration starts, a network
          // failure is ambiguous and must not be replayed as a fresh turn.
          safeFreshRetry: requestStarted !== true
        };
        this.emit('lex-chat-error', { error: err.message, type: 'send', status: err.status || null });
      }

      // A stream that ends without a terminal event is an interrupted
      // generation, even if it delivered partial text. Offer the same safe
      // recovery instead of leaving a forever-streaming message behind.
      if (!failure && !terminalReceived && !this._planReadyReceived && !this._agenticBlockedReceived) {
        failure = {
          message: responseStarted
            ? 'The response was interrupted before it completed.'
            : 'No response was received.',
          status: null,
          details: { retryable: true },
          type: responseStarted ? 'interrupted_stream' : 'empty_stream',
          generationAdmitted,
          retryGenerationId: admittedGenerationId,
          safeFreshRetry: false
        };
      }

      if (failure && responseStarted && this._threadEl) {
        this._threadEl.finalizeLastMessage();
      }

      // Finalize
      if (this._activeTurnId === turnId) {
        if (this._activityEl) this._activityEl.hide();
        if (this._composerEl) this._composerEl.setGenerating(false);
        this._activeTurnId = null;
        // Every way a turn ends (done, error, stop, a dropped stream), for
        // hosts that track the turn in progress (the dock's side panel).
        this.emit('lex-chat-turn-end', { conversationId: this.conversationId, failed: !!failure });
      }

      if (failure) {
        if (internal.retry) {
          this._setRecoveryState({ disabled: true, label: 'Retry failed', status: 'failed' });
        }
        if (failure.status !== 401) {
          if (this._isRetryableFailure(failure) &&
              (failure.safeFreshRetry === true || failure.retryGenerationId)) {
            this._offerRetry(content, sendOpts, failure);
          } else {
            const persistenceNote = failure.generationAdmitted === true
              ? ' Your message was saved; reload this conversation to check for a completed response.'
              : '';
            this._showSystemMessage('Error: ' + failure.message + persistenceNote);
          }
        }
      } else if (internal.retry && activeRetryReceipt) {
        this._setRecoveryState({
          disabled: true,
          label: 'Retry in progress…',
          status: activeRetryReceipt.generationStatus
        });
        if (this._composerEl) this._composerEl.setGenerating(true);
        if (this._activityEl) this._activityEl.show('Retry in progress…', 'thinking');
        this._watchActiveRetryReceipt(activeRetryReceipt);
      } else if (internal.retry) {
        this._setRecoveryState({ disabled: true, label: 'Retried', status: 'completed' });
        this._recoveryMessageEl = null;
      }

      if (this._composerEl) this._composerEl.focus();
      return !failure;
    }

    _buildInitialSendOptions(opts = {}) {
      const sendOpts = this._buildSendOptions(opts);
      return sendOpts;
    }

    _buildSendOptions(opts = {}) {
      const sendOpts = { ...opts };
      // Map chat mode to backend context_type enum
      // Use component state only — no global localStorage that persists across conversations
      if (this.chatMode === 'agentic') {
        sendOpts.contextType = 'agentic_mode';
      } else if (this.chatMode === 'insights') {
        sendOpts.contextType = sendOpts.attachments && sendOpts.attachments.module_context
          ? 'insights_chat'
          : 'data_chat';
      }
      // Documents added before the thread existed are not saved on the server
      // yet, so this turn carries them. Saved ones the server loads itself.
      const unsaved = this._pendingDocumentAdds || [];
      if (unsaved.length > 0) {
        const attachments = sendOpts.attachments && !Array.isArray(sendOpts.attachments)
          ? { ...sendOpts.attachments }
          : {};
        const files = Array.isArray(attachments.files) ? attachments.files.slice() : [];
        for (const doc of unsaved) {
          if (!files.some(f => String(f.file_id) === String(doc.id))) {
            files.push({ file_id: doc.id, name: doc.name });
          }
        }
        attachments.files = files;
        if (!Array.isArray(sendOpts.attachments)) sendOpts.attachments = attachments;
      }
      // Explicit contextType prop takes precedence
      if (this.contextType && !sendOpts.contextType) sendOpts.contextType = this.contextType;
      if (this.matterId) sendOpts.matterId = this.matterId;
      return sendOpts;
    }

    _failureFromEvent(event) {
      const value = event || {};
      const raw = value.error && typeof value.error === 'object'
        ? (value.error.message || value.error.code)
        : value.error;
      return {
        message: String(raw || value.message || 'The generation failed.'),
        status: value.status == null ? null : Number(value.status),
        details: value.details || null,
        retryAfterSeconds: Number.isInteger(Number(value.details && value.details.retryAfterSeconds))
          ? Math.max(0, Math.min(Number(value.details.retryAfterSeconds), 86400))
          : 0,
        code: value.code || null,
        type: value.type || 'stream'
      };
    }

    _isRetryableFailure(failure) {
      const details = failure && failure.details;
      if (details && details.retryable === true) return true;
      if (details && details.retryable === false) return false;
      const status = failure && failure.status;
      if (status == null || !Number.isFinite(Number(status))) return true;
      const numeric = Number(status);
      return numeric === 408 || numeric === 409 || numeric === 425 ||
        numeric === 429 || numeric >= 500;
    }

    _cloneRetryOptions(options) {
      let cloned;
      if (global.structuredClone && typeof global.structuredClone === 'function') {
        try { cloned = global.structuredClone(options || {}); } catch (_) { cloned = null; }
      }
      if (!cloned) {
        const cloneValue = function (value) {
          if (Array.isArray(value)) return value.map(cloneValue);
          if (!value || typeof value !== 'object') return value;
          const prototype = Object.getPrototypeOf(value);
          if (prototype && prototype !== Object.prototype) return value;
          const copy = {};
          Object.keys(value).forEach(function (key) { copy[key] = cloneValue(value[key]); });
          return copy;
        };
        cloned = cloneValue(options || {});
      }
      // Preserve an explicit client_request_id. If admission state is ever
      // misclassified, backend idempotency must win over creating a duplicate
      // durable user message.
      return cloned;
    }

    _offerRetry(content, options, failure) {
      this._clearRetryAvailabilityTimer();
      const recoveryId = `chat-retry-${Date.now()}-${++this._recoverySequence}`;
      const retryOptions = this._cloneRetryOptions(options);
      if (failure && failure.retryGenerationId) {
        retryOptions.retryGenerationId = failure.retryGenerationId;
        // A retry generation is a distinct admission and requires its own
        // idempotency key; the server reuses the original user_message_id.
        delete retryOptions.clientRequestId;
      }
      this._failedAttempt = {
        recoveryId,
        content,
        options: retryOptions
      };
      const retryAfterSeconds = failure && Number.isInteger(failure.retryAfterSeconds)
        ? Math.max(0, failure.retryAfterSeconds)
        : 0;
      const message = 'Error: ' + String(failure && failure.message || 'The request failed.') +
        (retryAfterSeconds > 0
          ? ` Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`
          : ' You can retry the same request.');
      if (this._threadEl) {
        this._recoveryMessageEl = this._threadEl.addSystemMessage(message, {
          recovery: {
            recoveryId,
            label: retryAfterSeconds > 0 ? `Retry in ${retryAfterSeconds}s` : 'Retry',
            disabled: retryAfterSeconds > 0,
            status: retryAfterSeconds > 0 ? 'waiting' : 'available'
          }
        });
      }
      if (retryAfterSeconds > 0) {
        this._retryAvailabilityTimer = global.setTimeout(() => {
          this._retryAvailabilityTimer = null;
          if (!this._failedAttempt || this._failedAttempt.recoveryId !== recoveryId) return;
          this._setRecoveryState({ disabled: false, label: 'Retry', status: 'available' });
          this.emit('lex-chat-retry-available', {
            recoveryId,
            error: failure && failure.message || 'The request failed.'
          });
        }, retryAfterSeconds * 1000);
      }
      this.emit('lex-chat-retry-available', {
        recoveryId,
        error: failure && failure.message || 'The request failed.',
        availableAfterSeconds: retryAfterSeconds
      });
    }

    _setRecoveryState(next) {
      const message = this._recoveryMessageEl;
      if (!message) return;
      if (typeof message.setRecoveryState === 'function') {
        message.setRecoveryState(next);
        return;
      }
      const button = typeof message.querySelector === 'function'
        ? message.querySelector('[data-chat-retry]')
        : null;
      if (!button) return;
      button.textContent = next && next.label ? next.label : button.textContent;
      if (next && next.disabled) button.setAttribute('disabled', '');
      else button.removeAttribute('disabled');
    }

    _clearActiveRetryReceipt() {
      if (this._retryReceiptPollTimer) {
        global.clearTimeout(this._retryReceiptPollTimer);
        this._retryReceiptPollTimer = null;
      }
      this._activeRetryReceipt = null;
    }

    _clearRetryAvailabilityTimer() {
      if (this._retryAvailabilityTimer) {
        global.clearTimeout(this._retryAvailabilityTimer);
        this._retryAvailabilityTimer = null;
      }
    }

    _watchActiveRetryReceipt(receipt) {
      this._clearActiveRetryReceipt();
      const conversationId = this.conversationId;
      const generationId = receipt && receipt.generationId || null;
      this._activeRetryReceipt = { conversationId, generationId };

      const poll = async () => {
        this._retryReceiptPollTimer = null;
        const activeReceipt = this._activeRetryReceipt;
        if (!activeReceipt || activeReceipt.conversationId !== this.conversationId) return;

        let status;
        try {
          status = await this._source.checkActiveGeneration(conversationId);
        } catch (_) {
          status = null;
        }
        if (!this._activeRetryReceipt || conversationId !== this.conversationId) return;

        const sameGenerationActive = status && status.active === true &&
          (!status.generationId || !generationId || status.generationId === generationId);
        if ((sameGenerationActive && !receipt?.statusUnknown) || !status) {
          this._retryReceiptPollTimer = global.setTimeout(poll, this._retryReceiptPollDelayMs);
          return;
        }

        this._activeRetryReceipt = null;
        if (this._composerEl) this._composerEl.setGenerating(false);
        if (this._activityEl) this._activityEl.hide();
        this._setRecoveryState({ disabled: true, label: 'Refreshing…', status: 'refreshing' });
        try {
          await this.loadConversation(conversationId);
          this._recoveryMessageEl = null;
        } catch (_) {
          this._setRecoveryState({
            disabled: true,
            label: 'Status unknown — reload',
            status: 'unknown'
          });
        }
      };

      this._retryReceiptPollTimer = global.setTimeout(poll, this._retryReceiptPollDelayMs);
    }

    _messageAttachmentsFromSendOptions(sendOpts = {}) {
      const attachments = sendOpts.attachments || {};
      const items = [];
      if (Array.isArray(attachments)) {
        for (const attachment of attachments) {
          if (!attachment) continue;
          if (attachment.type === 'module_context' || attachment.context_type || attachment.module_context || attachment.moduleContext) {
            const moduleContext = attachment.module_context || attachment.moduleContext || attachment;
            items.push({
              type: 'module_context',
              name: moduleContext.name || moduleContext.ui_label || moduleContext.card_title || moduleContext.module_name || moduleContext.module_key || 'Attached context',
              context_type: moduleContext.context_type || moduleContext.type || '',
              summary: moduleContext.summary
                || (moduleContext.selection && moduleContext.selection.text)
                || (moduleContext.revision && moduleContext.revision.text)
                || (moduleContext.details && moduleContext.details.change_summary)
                || ''
            });
          } else {
            items.push({
              type: 'file',
              file_id: attachment.file_id || attachment.id || null,
              name: attachment.filename || attachment.name || 'Document'
            });
          }
        }
        return items;
      }
      const files = Array.isArray(attachments.files) ? attachments.files : [];
      for (const file of files) {
        if (!file) continue;
        items.push({
          type: 'file',
          file_id: file.file_id || file.id || null,
          name: file.filename || file.name || 'Document'
        });
      }
      const moduleContext = attachments.module_context || attachments.moduleContext || null;
      if (moduleContext) {
        items.push({
          type: 'module_context',
          name: moduleContext.ui_label || moduleContext.card_title || moduleContext.module_name || moduleContext.module_key || 'Attached context',
          context_type: moduleContext.type || '',
          summary: moduleContext.summary
            || (moduleContext.selection && moduleContext.selection.text)
            || (moduleContext.revision && moduleContext.revision.text)
            || (moduleContext.details && moduleContext.details.change_summary)
            || ''
        });
      }
      return items;
    }

    /**
     * Fast-path registered slash commands. Backend-backed commands are
     * dispatched through the command registry endpoint instead of the LLM
     * stream; unmatched slash text still flows through normal chat.
     */
    _maybeRunSlashCommand(content, opts = {}) {
      const service = (typeof window !== 'undefined' && window.SlashCommandsService) || null;
      const helpers = global.Lex.Chat && global.Lex.Chat.SlashHelpers;
      if (!service || !helpers || typeof service.execute !== 'function') return false;
      // Hidden until a later release: typed /commands go to normal chat.
      if (!helpers.slashCommandsEnabled()) return false;
      if (!helpers.isExactCommand(content, Object.keys(service.commands || {}))) return false;
      this._runSlashCommand(content, service, this._buildSendOptions(opts));
      return true;
    }

    async _runSlashCommand(content, service, sendOpts = {}) {
      const messageAttachments = this._messageAttachmentsFromSendOptions(sendOpts);
      if (this._threadEl) this._threadEl.addMessage('user', content, {
        attachments: messageAttachments.length ? messageAttachments : undefined
      });
      if (this._composerEl) {
        this._composerEl.clear();
        this._composerEl.hideSuggestions();
        this._composerEl.setGenerating(true);
      }
      if (this._activityEl) {
        this._activityEl.clearReasoning();
        this._activityEl.show('Running command...');
      }
      try {
        const parsed = service.parseCommand(content);
        let conversationId = this.conversationId;
        if (service.requiresBackend(parsed.command)) {
          if (!this._source.connected) await this._source.connect(this.conversationId);
          if (!conversationId && this._source && typeof this._source.ensureConversation === 'function') {
            conversationId = await this._source.ensureConversation(sendOpts);
            if (conversationId) {
              this._props.conversationId = conversationId;
              this.emit('lex-chat-conversation-created', { conversationId });
            }
          }
        }
        const result = await service.execute(content, {
          api: global.api,
          conversationId
        });
        const message = (result && result.message) || 'Command produced no output.';
        if (this._threadEl) this._threadEl.addMessage('assistant', message);
      } catch (err) {
        if (this._threadEl) this._threadEl.addMessage('assistant', 'Error executing command: ' + err.message);
      } finally {
        if (this._composerEl) this._composerEl.setGenerating(false);
        if (this._activityEl) this._activityEl.hide();
      }
      if (this._composerEl) this._composerEl.focus();
    }

    /**
     * Stop active generation.
     */
    async stop() {
      if (this._source) {
        const result = await this._source.stop();
        if (result && result.success === false && result.active !== false) {
          this._showSystemMessage('Could not confirm the response stopped. Please try Stop again.');
          return;
        }
        this._clearActiveRetryReceipt();
        if (this._composerEl) this._composerEl.setGenerating(false);
        if (this._activityEl) this._activityEl.hide();
        this.dispatchEvent(new CustomEvent('lex-chat-generation-active', {
          bubbles: true, composed: true, detail: { conversationId: this.conversationId, active: false }
        }));
      }
    }

    /**
     * Load a conversation by ID.
     */
    async loadConversation(id) {
      if (this.conversationId && this.conversationId !== id) {
        this._clearActiveRetryReceipt();
        // Documents waiting on another thread's first message stay with it.
        this._pendingDocumentAdds = [];
        this._conversationRegistered = false;
      }
      const loadSeq = ++this._loadConversationSeq;
      this._props.conversationId = id;
      this._resetContextMeter();
      this._recoveryNoticeShownForConversation = null;

      const isCurrentLoad = () => this._loadConversationSeq === loadSeq && this.conversationId === id;

      if (this._source) {
        await this._source.connect(id);
        if (!isCurrentLoad() || this._activeTurnId) return;

        // Load the thread's documents without exposing raw chat state.
        const state = await this._source.loadState();
        if (!isCurrentLoad() || this._activeTurnId) return;
        // The server answered for this id, so the thread is saved.
        this._conversationRegistered = true;
        this._updateDocumentState(state || { activeDocuments: [] });

        // Load history
        const result = await this._source.loadHistory(1, this.maxHistory);
        if (!isCurrentLoad() || this._activeTurnId) return;
        let lastPersistedMessage = null;
        if (result && result.messages) {
          if (this._threadEl) {
            this._threadEl.clear();
            for (const m of result.messages) {
              lastPersistedMessage = m;
              const messageAttachments = this._messageAttachmentsFromSendOptions({ attachments: m.attachments || [] });
              this._threadEl.addMessage(m.role, m.content, {
                messageId: m.id || m.message_id,
                timestamp: m.timestamp || m.created_at,
                citations: m.citations && m.citations.length > 0 ? m.citations : undefined,
                references: m.references && m.references.length > 0 ? m.references : undefined,
                coverageSummary: persistedCoverageSummary(m),
                artifacts: m.artifacts && m.artifacts.length > 0 ? m.artifacts : undefined,
                attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
                duration: m.duration || null,
                tokenCount: m.tokenCount || null
              });

              // Re-hydrate dynamic cards from persisted message metadata.
              // LexDynamicCardRenderer is loaded before lex-chat.js in every
              // HTML page so it is guaranteed to be present here.
              if (m.metadata && Array.isArray(m.metadata.dynamic_cards) &&
                  this._threadEl._container &&
                  global.LexDynamicCardRenderer) {
                for (var _ci = 0; _ci < m.metadata.dynamic_cards.length; _ci++) {
                  global.LexDynamicCardRenderer.renderCard(
                    m.metadata.dynamic_cards[_ci],
                    this._threadEl._container
                  );
                }
              }
            }

            // Only the latest saved runtime turn may offer a pending action.
            // Older approval messages are historical, even if their saved
            // interaction still says pending.
            const latestRuntimeMessage = result.messages.slice().reverse().find(m => m.metadata?.intelligence_runtime);
            const saved = latestRuntimeMessage?.metadata?.intelligence_runtime?.interaction;
            if (saved?.status === 'pending') this._restoreRuntimeInteraction(id, saved, isCurrentLoad);

            // Batch-refresh card states after all messages are rendered so
            // cards reflect their real current state (e.g. approved) rather
            // than the state that was saved when the message was persisted.
            if (global.LexDynamicCardRenderer) {
              var _allDescriptors = [];
              for (var _mi = 0; _mi < result.messages.length; _mi++) {
                var _msg = result.messages[_mi];
                if (_msg.metadata && Array.isArray(_msg.metadata.dynamic_cards)) {
                  for (var _di = 0; _di < _msg.metadata.dynamic_cards.length; _di++) {
                    _allDescriptors.push(_msg.metadata.dynamic_cards[_di]);
                  }
                }
              }

              if (_allDescriptors.length > 0) {
                global.LexDynamicCardRenderer.refreshCardStates(_allDescriptors)
                  .then(function (states) {
                    // Apply refreshed states to already-rendered card elements
                    var stateKeys = Object.keys(states);
                    for (var _ki = 0; _ki < stateKeys.length; _ki++) {
                      var _cardId = stateKeys[_ki];
                      var _cardEl = document.querySelector('[card-id="' + _cardId + '"]');
                      if (_cardEl && states[_cardId]) {
                        _cardEl.setAttribute('status', states[_cardId]);
                      }
                    }
                  })
                  .catch(function (err) {
                    console.warn('[lex-chat] Dynamic card state refresh failed:', err && err.message);
                  });
              }
            }

            this._threadEl.scrollToBottom(true);
          }
          if (this._threadEl) {
            this._threadEl.hasMore = result.hasMore || false;
          }
        }

        // Detect a generation already in flight for this conversation
        // (e.g. started in another tab/device). Host pages can listen for
        // `lex-chat-generation-active` and render their own banner.
        try {
          const status = await this._source.checkActiveGeneration(id);
          if (!isCurrentLoad() || this._activeTurnId) return;
          if (status && status.active) {
            this._showPendingGenerationRecovery(lastPersistedMessage, { activeGeneration: true });
            this._watchActiveRetryReceipt({ generationId: status.generationId });
            this.dispatchEvent(new CustomEvent('lex-chat-generation-active', {
              bubbles: true,
              composed: true,
              detail: { conversationId: id, ...status }
            }));
          } else if (status) {
            this.dispatchEvent(new CustomEvent('lex-chat-generation-active', {
              bubbles: true, composed: true, detail: { conversationId: id, active: false }
            }));
            this._showPendingGenerationRecovery(lastPersistedMessage, { activeGeneration: false });
          } else {
            // A temporary connection failure is not evidence of completion.
            this._watchActiveRetryReceipt({ statusUnknown: true });
          }
        } catch (_) { /* best-effort */ }
      }
    }

    /**
     * Check whether a generation is already running on the current
     * conversation. Returns the status payload from the backend.
     */
    async checkActiveGeneration(conversationId) {
      if (!this._source) return { active: false };
      return await this._source.checkActiveGeneration(
        conversationId || this.conversationId
      );
    }

    /**
     * Clear the conversation.
     */
    clearConversation() {
      this._clearActiveRetryReceipt();
      this._clearRetryAvailabilityTimer();
      this._loadConversationSeq += 1;
      this._props.conversationId = null;
      this._conversationRegistered = false;
      this._resolvedMatterId = null;
      this._pendingDocumentAdds = [];
      if (this._source && typeof this._source.resetConversation === 'function') {
        this._source.resetConversation();
      }
      this._citations = [];
      this._references = [];
      this._artifacts = [];
      this._failedAttempt = null;
      this._recoveryMessageEl = null;
      this._resetContextMeter();
      if (this._threadEl) {
        this._threadEl.clear();
        this._threadEl.showWelcome();
      }
      this._setDocuments([]);
    }

    // ---------------------------------------------------------------------------
    // Chat documents — the documents LANA answers this chat from (max 3)
    // ---------------------------------------------------------------------------

    get maxDocuments() { return MAX_CHAT_DOCUMENTS; }

    // A new thread can hold an id before its first message, but the server
    // does not know it until that message is saved.
    _isThreadSaved() {
      return !!this.conversationId && this._conversationRegistered === true;
    }

    getDocuments() {
      return (this._documents || []).map(doc => ({
        id: doc.id,
        filename: doc.filename || doc.name || 'Document'
      }));
    }

    openDocumentsManager() {
      const open = global.Lex.Chat && global.Lex.Chat.openDocumentsManager;
      return typeof open === 'function' ? open(this) : null;
    }

    /**
     * Search documents the user can add, scoped like the chat:
     * - saved workspace thread: the server's candidates for it (that
     *   workspace plus what it inherits, access-checked);
     * - new workspace thread: library files in that workspace (its matter, or
     *   the one the host will create it in, see _newThreadWorkspace);
     * - no workspace: the whole library. Chef's candidates for an unscoped
     *   thread are only files uploaded into it, which the composer cannot do.
     * Resolves to [{ id, filename, name, meta }].
     */
    async searchDocuments(query, opts = {}) {
      const api = global.api;
      if (!api) return [];
      const limit = opts.limit || 10;
      const text = String(query || '').trim();
      if (this._isThreadSaved()) {
        const data = await new Chat.ConversationsApiClient(api)
          .getDocumentCandidates(this.conversationId, { search: text, limit });
        if (data && (data.matter_id || data.matterId)) {
          const rows = data.document_candidates || data.files || data.candidates || [];
          return rows.map(toDocumentResult);
        }
        return this._searchLibrary(text, limit, null);
      }
      return this._searchLibrary(text, limit, this._newThreadWorkspace());
    }

    // The workspace a new thread will be created in: its own matter, else
    // whatever a host answers on lex-chat-document-scope (the dock fills in
    // the workspace page the user is on, the same matter it adds on create).
    _newThreadWorkspace() {
      if (this.matterId) return this.matterId;
      const detail = { matterId: null };
      this.dispatchEvent(new CustomEvent('lex-chat-document-scope', { detail, bubbles: true, composed: true }));
      return detail.matterId || null;
    }

    async _searchLibrary(text, limit, workspaceId) {
      const params = new URLSearchParams({ page: '1', page_size: String(limit), sort_by: 'updated_at', sort_order: 'desc' });
      if (text) params.set('search', text);
      // Accepts the workspace's code or UUID.
      if (workspaceId) params.set('workspaces', workspaceId);
      const data = await global.api.get('/api/v1/storage/library/files?' + params.toString());
      const rows = (data && (data.files || data.documents || (data.data && (data.data.files || data.data.documents)))) || [];
      return rows.map(toDocumentResult);
    }

    _setDocuments(docs) {
      this._documents = docs;
      if (this._documentsEl) this._documentsEl.documents = docs;
      this.emit('lex-chat-documents-change', { documents: this.getDocuments() });
    }

    async clearDocuments() {
      this._pendingDocumentAdds = [];
      if (!this._isThreadSaved() || !this._source) {
        this._setDocuments([]);
        return;
      }
      try {
        const state = await this._source.clearDocuments();
        if (state) this._updateDocumentState(state);
      } catch (err) {
        this._showSystemMessage('Failed to clear documents: ' + err.message);
      }
    }

    /**
     * Add a document to this chat.
     */
    async addDocument(id, name) {
      if (!this._source) return;
      if (this._documents.some(doc => String(doc.id) === String(id))) return;
      // An unsaved thread cannot save documents yet: keep them here, send
      // them with the first message and save them once it lands.
      if (!this._isThreadSaved()) {
        if (this._documents.length >= MAX_CHAT_DOCUMENTS) {
          const message = `Maximum of ${MAX_CHAT_DOCUMENTS} documents allowed. Remove a document first.`;
          this._showSystemMessage(message);
          throw new Error(message);
        }
        this._queuePendingDocument(id, name);
        return;
      }
      // Capture new-thread state before awaiting. The streaming connection can
      // register the conversation while this request is in flight; checking
      // only inside catch would then turn the expected race into a false error.
      const shouldDeferUntilFirstResponse = this._conversationRegistered !== true;
      try {
        const state = await this._source.addDocument(id, name, this.matterId);
        if (state) this._updateDocumentState(state);
      } catch (err) {
        // Expected on a brand-new thread: the backend refuses to persist
        // conversation state before the first message exists. The first
        // turn already carries the document context in its payload, so
        // queue the attach and retry silently after the first response.
        if (shouldDeferUntilFirstResponse ||
            String(err.message || '').toLowerCase().indexOf('persisted before its first message') !== -1) {
          this._queuePendingDocument(id, name);
          return;
        }
        this._showSystemMessage('Failed to add document: ' + err.message);
        throw err;
      }
    }

    _queuePendingDocument(id, name) {
      this._pendingDocumentAdds = this._pendingDocumentAdds || [];
      if (!this._pendingDocumentAdds.some((document) => String(document.id) === String(id))) {
        this._pendingDocumentAdds.push({ id, name });
      }
      if (!this._documents.some(doc => String(doc.id) === String(id))) {
        this._setDocuments(this._documents.concat([{ id, filename: name || 'Document' }]));
      }
    }

    /**
     * Remove a document from this chat.
     */
    async removeDocument(id) {
      if (!this._source) return;
      const pending = this._pendingDocumentAdds || [];
      if (pending.some(doc => String(doc.id) === String(id))) {
        this._pendingDocumentAdds = pending.filter(doc => String(doc.id) !== String(id));
        this._setDocuments(this._documents.filter(doc => String(doc.id) !== String(id)));
        if (this._composerEl) this._composerEl.removeDocument(id);
        return;
      }
      if (this._composerEl) this._composerEl.removeDocument(id);
      try {
        const state = await this._source.removeDocument(id);
        if (state) this._updateDocumentState(state);
      } catch (err) {
        this._showSystemMessage('Failed to remove document: ' + err.message);
      }
    }

    // ---------------------------------------------------------------------------
    // Event dispatch loop — routes ChatEvents to child components
    // ---------------------------------------------------------------------------

    _handleEvent(event, responseStarted) {
      switch (event.type) {

        case 'connected':
          if (event.threadId) {
            var isNew = !this.conversationId || this.conversationId !== event.threadId || !this._conversationRegistered;
            this._props.conversationId = event.threadId;
            if (isNew) {
              this._conversationRegistered = true;
              this.emit('lex-chat-conversation-created', { conversationId: event.threadId });
            }
          }
          // Keep a backend-resolved matter available for composer searches,
          // but do not promote it to this.matterId. An ad-hoc conversation
          // created without a matter remains unscoped; sending the inferred
          // attachment matter on its next turn violates that immutable scope.
          if (event.matterId && !this.matterId) {
            this._resolvedMatterId = event.matterId;
            // Propagate to the composer so subsequent @-mention searches
            // include matter contacts. (The initial render forwarded
            // whatever matter id was set at mount time; this catches the
            // case where the matter is resolved by the backend mid-turn.)
            if (this._composerEl) this._composerEl.matterId = event.matterId;
          }
          this.emit('lex-chat-response-start', { conversationId: this.conversationId });
          break;

        case 'thinking':
          if (this._activityEl) {
            this._activityEl.update(event.message, event.phase);
          }
          break;

        case 'reasoning':
          if (this._activityEl) {
            this._activityEl.addReasoningEntry(event);
          }
          break;

        case 'progress':
          if (this._activityEl) {
            this._activityEl.update(event.message || 'Processing...', event.category || 'progress');
            this._activityEl.addReasoningEntry(event);
          }
          break;

        case 'tool_thinking':
          if (this._activityEl) {
            this._activityEl.update(event.content || 'Analyzing...', 'tool');
            this._activityEl.addReasoningEntry({ message: event.content });
          }
          break;

        case 'tool_start':
        case 'tool_call_starting':
          // Show the humanized tool phrase on the small primary line ABOVE
          // the main "Working..." label. The main label intentionally never
          // changes mid-turn — only the primary moves — so the bar stays
          // calm while multiple tools chain.
          if (this._activityEl) {
            const toolName = event.toolName || event.tool || '';
            const primary = humanizeToolStart(toolName, event.params);
            this._activityEl.show({
              primary: primary || (toolName ? `Running ${toolName}…` : ''),
              message: 'Working...',
              phase: ''
            });
          }
          this.emit('lex-chat-tool-start', {
            conversationId: this.conversationId,
            callId: event.callId || null,
            toolName: event.toolName || event.tool || '',
            label: event.label || null,
            iteration: event.iteration ?? null,
            startedAt: event.startedAt || null
          });
          break;

        case 'tool_progress':
          // Render allowlisted progress copy from structured fields instead
          // of trusting arbitrary backend message text.
          if (this._activityEl) {
            const progressMsg = formatToolProgress(event);
            if (progressMsg) {
              this._activityEl.update({
                primary: progressMsg,
                message: 'Working...',
                phase: ''
              });
              this._activityEl.addReasoningEntry({
                type: event.type,
                tool: event.tool || '',
                toolName: event.toolName || event.tool || '',
                message: progressMsg,
                phase: event.phase || event.scanType || 'tool',
                status: event.status || null,
                heartbeat: event.heartbeat === true
              });
            }
          }
          break;

        case 'rag_complete': {
          const ragMessage = formatRagComplete(event);
          if (this._activityEl) {
            this._activityEl.update({
              primary: ragMessage,
              message: 'Working...',
              phase: ''
            });
            this._activityEl.addReasoningEntry({
              type: event.type,
              message: ragMessage,
              phase: 'retrieval',
              status: 'completed'
            });
          }
          this.emit('lex-chat-rag-complete', {
            chunksFound: event.chunksFound,
            documentsSearched: event.documentsSearched,
            ragTimeMs: event.ragTimeMs,
            source: event.source || null
          });
          break;
        }

        case 'tool_end':
        case 'tool_call_complete':
          // Tool finished: clear the primary line and keep the main
          // "Working..." label so the next tool's start can take over.
          // We deliberately don't surface the result summary here — the
          // model writes its own summary through the `content` stream.
          if (this._activityEl) {
            this._activityEl.update({
              primary: '',
              message: 'Working...',
              phase: ''
            });
          }
          this.emit('lex-chat-tool-end', {
            conversationId: this.conversationId,
            callId: event.callId || null,
            toolName: event.toolName || event.tool || '',
            label: event.label || null,
            iteration: event.iteration ?? null,
            startedAt: event.startedAt || null,
            success: event.type === 'tool_call_complete' ? event.ok !== false : event.success !== false,
            durationMs: event.durationMs ?? null,
            summary: event.summary || ''
          });
          break;

        case 'content': {
          // First content chunk — hide activity, start streaming message
          if (!responseStarted && this._streamingContent === '') {
            if (this._activityEl) this._activityEl.hide();
            if (this._threadEl) {
              const lastAssistant = this._threadEl.getLastAssistantMessage && this._threadEl.getLastAssistantMessage();
              if (!lastAssistant || !lastAssistant.streaming) {
                this._threadEl.startAssistantMessage();
              }
            }
          }

          this._streamingContent += event.text;

          if (this._threadEl) {
            this._threadEl.updateLastAssistantMessage(event.text);
          }
          break;
        }

        case 'citations':
          this._citations = event.citations || [];
          break;

        case 'references':
          this._references = event.references || [];
          break;

        case 'context_usage':
          // A snapshot with basis "unavailable" carries no numbers: leave
          // the meter as it was rather than show an empty window as free.
          if (typeof event.percentUsed === 'number' && Number.isFinite(event.percentUsed)) {
            this._updateContextMeter(event.percentUsed, event.percentUntilCompact);
          }
          this.emit('lex-chat-context-usage', {
            conversationId: this.conversationId,
            percentUsed: event.percentUsed,
            tokensUsed: event.tokensUsed,
            percentUntilCompact: event.percentUntilCompact,
            usage: event.usage || null
          });
          break;

        case 'entity_change':
          this.emit('lex-chat-entity-change', {
            conversationId: this.conversationId,
            operation: event.operation,
            entityType: event.entityType,
            entityId: event.entityId,
            label: event.label,
            viewUrl: event.viewUrl,
            matterId: event.matterId
          });
          break;

        case 'agentic_progress':
          if (this._activityEl) {
            this._activityEl.update(event.message || 'Processing...', event.phase || 'agentic');
            this._activityEl.addReasoningEntry(event);
          }
          break;

        // LANA has gone as far as she honestly can and is asking.
        //
        // Rendered as a DECISION so answering is one tap. The user still has the
        // composer, and `allow_custom` is always on, because a question that
        // cannot be walked away from is the failure mode that makes people stop
        // using a tool. The backend treats an off-topic reply as `abstained`
        // and simply runs a normal turn.
        case 'uncertainty':
          if (this._activityEl) this._activityEl.hide();
          this._insertUncertaintyBlock(event);
          break;

        case 'interaction_required':
          this._planReadyReceived = true;
          if (this._activityEl) this._activityEl.hide();
          this._insertRuntimeInteraction(event.interaction);
          break;

        // A card attached to the answer (the connector setup card). The
        // backend releases it after the answer, so it lands under it.
        case 'dynamic_card':
          if (this._threadEl && this._threadEl._container && global.LexDynamicCardRenderer) {
            global.LexDynamicCardRenderer.renderCard(event.card, this._threadEl._container);
            if (this._threadEl.scrollToBottom) this._threadEl.scrollToBottom();
          }
          break;

        case 'plan_ready':
          // Backend generated a plan that requires user approval before execution.
          // Hide the activity indicator and insert a plan card into the thread.
          // Mark flag so the "No response received" fallback is suppressed.
          this._planReadyReceived = true;
          if (this._activityEl) this._activityEl.hide();
          this._insertPlanCard(event);
          break;

        case 'agentic_complete':
          if (event.artifacts) {
            this._artifacts = this._mergeArtifacts(event.artifacts);
            this._ensureAssistantMessageForArtifacts();
          }
          this.emit('lex-chat-artifacts', { artifacts: event.artifacts || [] });
          break;

        case 'agentic_error':
          if (this._activityEl) this._activityEl.hide();
          this.emit('lex-chat-error', { error: event.error, type: 'agentic' });
          break;

        case 'agentic_blocked':
          this._agenticBlockedReceived = true;
          if (this._activityEl) this._activityEl.hide();
          this.emit('lex-chat-agentic-blocked', {
            error: event.error,
            message: event.message,
            status: event.status,
            failureClass: event.failureClass,
            failureReason: event.failureReason,
            suggestedFollowups: event.suggestedFollowups || []
          });
          if (event.suggestedFollowups && event.suggestedFollowups.length > 0) {
            this.emit('lex-chat-agentic-followup', {
              followups: event.suggestedFollowups,
              message: 'Here are suggested follow-up actions you may want me to take next:',
              matterId: null,
              options: []
            });
          }
          break;

        case 'agentic_followup':
          this.emit('lex-chat-agentic-followup', {
            followups: event.followups,
            message: event.message,
            matterId: event.matterId,
            options: event.options
          });
          break;

        case 'agentic_artifacts':
          if (event.artifacts) {
            this._artifacts = this._mergeArtifacts(event.artifacts);
            this._ensureAssistantMessageForArtifacts();
          }
          this.emit('lex-chat-artifacts', { artifacts: event.artifacts || [] });
          break;

        case 'iteration_summary':
          if (this._activityEl) {
            this._activityEl.addReasoningEntry({
              message: `Iteration ${event.iteration}/${event.maxIterations}: ${event.message}`
            });
          }
          break;

        case 'title':
          this.emit('lex-chat-title-generated', {
            title: event.generatedTitle,
            conversationId: this.conversationId
          });
          break;

        case 'auto_compact_start':
          if (this._activityEl) {
            this._activityEl.update('Auto-compacting conversation...', 'compacting');
          }
          this.emit('lex-chat-auto-compact-start', {
            messagesToSummarize: event.messagesToSummarize || null
          });
          break;

        case 'auto_compact_complete':
          this.emit('lex-chat-auto-compact-complete', {
            newPercentUsed: event.newPercentUsed,
            tokensSaved: event.tokensSaved || null,
            durationMs: event.durationMs || null
          });
          this.emit('lex-chat-context-usage', {
            percentUsed: event.newPercentUsed,
            tokensUsed: null,
            percentUntilCompact: null
          });
          break;

        case 'conversation_compaction': {
          const compactionMessage = formatConversationCompaction(event);
          if (this._activityEl) {
            this._activityEl.update({
              primary: compactionMessage,
              message: 'Working...',
              phase: ''
            });
            this._activityEl.addReasoningEntry({
              type: event.type,
              message: formatConversationCompactionDetails(event),
              phase: 'context',
              status: event.status || 'applied'
            });
          }
          this.emit('lex-chat-conversation-compaction', {
            status: event.status || 'applied',
            reason: event.reason || null,
            beforeTokens: event.beforeTokens,
            afterTokens: event.afterTokens,
            budgetTokens: event.budgetTokens,
            beforeMessageCount: event.beforeMessageCount,
            afterMessageCount: event.afterMessageCount,
            droppedMessageCount: event.droppedMessageCount,
            hasRollingSummary: event.hasRollingSummary === true,
            hasStructuredState: event.hasStructuredState === true,
            historyStrategy: event.historyStrategy || null
          });
          break;
        }

        case 'done':
          // Finalize the streaming message
          if (this._threadEl) {
            const duration = event.processingTimeMs || (this._sendStartTime ? Lex.Utils.millisecondsSince(this._sendStartTime) : null);
            if (Array.isArray(event.references) && event.references.length > 0) {
              this._references = event.references;
            }
            this._threadEl.finalizeLastMessage({
              messageId: event.messageId,
              duration,
              tokenCount: event.tokenCount || null,
              citations: this._citations.length > 0 ? this._citations : undefined,
              references: this._references.length > 0 ? this._references : undefined,
              artifacts: this._artifacts.length > 0 ? this._artifacts : undefined,
              grounding: this._groundingContext || undefined
            });
          }

          // Capture conversation ID from done event (fallback)
          if (event.threadId && !this.conversationId) {
            this._props.conversationId = event.threadId;
            this.emit('lex-chat-conversation-created', { conversationId: event.threadId });
          }

          // The thread now has its first persisted message — flush document
          // attaches that were queued because state could not be persisted
          // on a brand-new thread (see addDocument).
          if (this._pendingDocumentAdds && this._pendingDocumentAdds.length > 0) {
            const pending = this._pendingDocumentAdds;
            this._pendingDocumentAdds = [];
            (async () => {
              for (const d of pending) {
                try {
                  const state = await this._source.addDocument(d.id, d.name, this.matterId);
                  if (state) this._updateDocumentState(state);
                } catch (e) { /* silent — context already active this session */ }
              }
            })();
          }

          // Preserve the resolved matter for composer lookups only. The
          // conversation's explicit scope is authoritative for later sends.
          if (event.matterId && !this.matterId) {
            this._resolvedMatterId = event.matterId;
            if (this._composerEl) this._composerEl.matterId = event.matterId;
          }

          this.emit('lex-chat-response-end', {
            conversationId: this.conversationId,
            messageId: event.messageId,
            content: this._streamingContent || ''
          });
          break;

        case 'stopped':
          if (this._threadEl) {
            this._threadEl.finalizeLastMessage({
              citations: this._citations.length > 0 ? this._citations : undefined,
              references: this._references.length > 0 ? this._references : undefined
            });
          }
          this._showSystemMessage('Generation stopped');
          break;

        case 'grounding_context':
          // Keep the latest (post-tool) grounding context; backend emits multiple per response
          this._groundingContext = event;
          break;

        case 'block_hints':
          // Store intent hints for schema selection on next turn
          if (global.Lex.Orchestrator) {
            global.Lex.Orchestrator.setIntentHints(event.intent, event.blocks);
          }
          this.emit('lex-chat-block-hints', { intent: event.intent, blocks: event.blocks });
          break;

        case 'error':
          if (this._activityEl) this._activityEl.hide();
          if (event.status === 401) {
            this._showSystemMessage('Session expired. Please log in again.');
          }
          // Non-auth failures are rendered once by _sendAttempt after it has
          // classified the failure and decided whether to expose Retry.
          this.emit('lex-chat-error', {
            error: event.error,
            type: 'stream',
            status: event.status || null
          });
          break;

        case 'retry_receipt':
          this.emit('lex-chat-retry-receipt', {
            generationId: event.generationId || null,
            userMessageId: event.userMessageId || null,
            messageId: event.messageId || null,
            status: event.generationStatus || null,
            contentPersisted: event.contentPersisted === true
          });
          if (event.contentPersisted === true && this.conversationId) {
            this.loadConversation(this.conversationId);
          }
          break;

        case 'protocol_warning':
          this.emit('lex-chat-protocol-warning', {
            event: event.event || null,
            reason: event.reason || 'unknown'
          });
          break;
      }
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    _mergeArtifacts(incoming) {
      if (Chat.ArtifactPromotion && typeof Chat.ArtifactPromotion.mergeArtifacts === 'function') {
        return Chat.ArtifactPromotion.mergeArtifacts(this._artifacts, incoming);
      }
      // Artifact identity is a data-integrity concern, not a presentation
      // concern. Keep the SSE paths safe even on a page that omitted the
      // promotion-card helper.
      return mergeArtifactEvents(this._artifacts, incoming);
    }

    _ensureAssistantMessageForArtifacts() {
      if (!this._threadEl || !this._artifacts || this._artifacts.length === 0) return;
      const lastAssistant = this._threadEl.getLastAssistantMessage && this._threadEl.getLastAssistantMessage();
      if (lastAssistant && lastAssistant.streaming) return;
      if (this._activityEl) this._activityEl.hide();
      this._threadEl.startAssistantMessage();
    }

    _updateDocumentState(state) {
      // The server's saved list, plus any still waiting to be saved.
      const saved = state.activeDocuments || [];
      const waiting = (this._pendingDocumentAdds || [])
        .filter(doc => !saved.some(s => String(s.id) === String(doc.id)))
        .map(doc => ({ id: doc.id, filename: doc.name || 'Document' }));
      this._setDocuments(saved.concat(waiting));
    }

    /**
     * Insert a lex-agentic-plan-card into the thread container.
     * Called when the backend emits a `plan_ready` SSE event.
     * The card handles its own Approve / Cancel API calls.
     *
     * @param {Object} event - { approval_id, plan, message }
     */
    /**
     * Insert any web component into the chat stream.
     * Generic mechanism for injecting dynamic UI (plan cards, artifact
     * previews, approval prompts, progress trackers, etc.) without
     * hardcoding per-feature insertion logic.
     *
     * @param {string} tagName - Custom element tag (e.g. 'lex-agentic-plan-card')
     * @param {Object} [attributes] - String attributes to set via setAttribute
     * @param {Object} [properties] - JS properties to assign directly (for complex objects)
     * @param {string} [eventName] - Optional event to emit after insertion
     * @param {Object} [eventDetail] - Optional event detail payload
     * @returns {HTMLElement|null} The inserted element, or null if container not available
     */
    insertComponent(tagName, attributes, properties, eventName, eventDetail) {
      if (!this._threadEl || !this._threadEl._container) return null;

      // Hide welcome screen if present (mirrors addMessage behaviour)
      const welcome = this._threadEl._container.querySelector('.lex-chat-welcome');
      if (welcome) welcome.remove();

      const el = document.createElement(tagName);

      // Set string attributes
      if (attributes) {
        var attrKeys = Object.keys(attributes);
        for (var i = 0; i < attrKeys.length; i++) {
          if (attributes[attrKeys[i]] != null) {
            el.setAttribute(attrKeys[i], String(attributes[attrKeys[i]]));
          }
        }
      }

      // Set JS properties (for complex objects like plan data)
      if (properties) {
        var propKeys = Object.keys(properties);
        for (var j = 0; j < propKeys.length; j++) {
          el[propKeys[j]] = properties[propKeys[j]];
        }
      }

      this._threadEl._container.appendChild(el);

      // Scroll into view
      if (this._threadEl._isNearBottom && this._threadEl._isNearBottom()) {
        this._threadEl.scrollToBottom();
      }

      // Emit event if specified
      if (eventName) {
        this.emit(eventName, eventDetail || {});
      }

      return el;
    }

    /**
     * Render an open question as a decision block.
     *
     * Reuses the existing `decision` block rather than adding a component: it
     * already renders selectable cards, already allows a custom reply, and
     * already routes the answer back through ActionBridge as a follow-up
     * message, which is exactly the round trip the backend contract expects.
     *
     * The LABEL is what gets sent, never the id. The backend classifies the
     * reply against the candidates it offered and matches on the label; sending
     * an opaque id would put a string the user never saw into their own
     * transcript.
     */
    _insertRuntimeInteraction(interaction) {
      const container = this._threadEl?._container;
      if (!container || !global.Lex?.BlockRenderer || !interaction?.id || !interaction.task_id) return;
      if (!['approval', 'question', 'wizard'].includes(interaction.kind) || interaction.status !== 'pending') return;
      if (Array.from(container.querySelectorAll('[data-runtime-interaction]')).some(el => el.dataset.runtimeInteraction === interaction.id)) return;
      const host = document.createElement('div');
      host.className = 'lex-chat-uncertainty';
      host.dataset.runtimeInteraction = interaction.id;
      const conversationId = this.conversationId;
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      const controls = document.createElement('div');
      host.appendChild(controls);
      host.appendChild(status);
      container.appendChild(host);
      let submitted = false;
      const submit = async (label, value) => {
        if (submitted || this._activeTurnId || this._activeRetryReceipt || this.conversationId !== conversationId) return;
        submitted = true;
        controls.hidden = true;
        status.textContent = 'Sending your response...';
        let ok = false;
        try {
          ok = await this.send(label, { runtimeTaskId: interaction.task_id,
            runtimeReply: { interaction_id: interaction.id, value } });
        } catch (_error) {
          ok = false;
        } finally {
          status.textContent = ok ? 'Response submitted.' : 'Response not confirmed. Check the conversation before trying again.';
          if (!ok) { submitted = false; controls.hidden = false; }
        }
      };
      if (interaction.kind === 'wizard') {
        Lex.BlockRenderer.render(controls, [{ type: 'form_collect', title: interaction.title || interaction.prompt,
          fields: interaction.fields || [], submit_label: 'Continue' }]);
        controls.addEventListener('lex-form-submit', event => {
          event.stopPropagation();
          const values = {};
          for (const field of interaction.fields || []) {
            const value = event.detail.values?.[field.name];
            if (!field.required && (value === '' || value === null || value === undefined)) continue;
            values[field.name] = value;
          }
          submit('Use these details', { action: 'submit', values });
        });
        const cancel = document.createElement('lex-btn');
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => submit('Cancel', { action: 'cancel' }));
        controls.appendChild(cancel);
      } else {
        const approval = interaction.kind === 'approval';
        const external = approval ? externalApprovalView(interaction) : null;
        if (external) host.insertBefore(externalApprovalHeader(external), controls);
        const options = approval ? [{ label: 'Approve', value: 'approve' }, { label: 'Decline', value: 'reject' }]
          : (interaction.choices || []).map(choice => ({ label: choice.label, value: choice.id, description: choice.description }));
        Lex.BlockRenderer.render(controls, [{ type: 'decision', prompt: interaction.prompt, options, allow_custom: false }]);
        controls.addEventListener('lex-decision', event => {
          event.stopPropagation();
          const chosen = options.find(option => option.value === event.detail.value);
          if (!chosen) return;
          submit(chosen.label, approval ? { decision: chosen.value } : { choice_id: chosen.value });
        });
      }
      if (this._threadEl.scrollToBottom) this._threadEl.scrollToBottom();
    }

    /**
     * Offer a saved runtime interaction again after a reload, but only when
     * the run record says it is still the pending one. The saved message
     * holds a minimal projection (no prefilled values); the live read
     * supplies the current interaction, so an approval decided in another
     * tab or in Approvals is not offered twice.
     */
    async _restoreRuntimeInteraction(conversationId, saved, isCurrentLoad) {
      const live = this._source && typeof this._source.loadPendingInteraction === 'function'
        ? await this._source.loadPendingInteraction(conversationId) : null;
      if (!isCurrentLoad() || this._activeTurnId) return;
      if (!pendingInteractionMatches(saved, live)) return;
      this._insertRuntimeInteraction(live);
    }

    _insertUncertaintyBlock(event) {
      if (!this._threadEl || !this._threadEl._container) return;
      if (!global.Lex || !global.Lex.BlockRenderer) return;

      var welcome = this._threadEl._container.querySelector('.lex-chat-welcome');
      if (welcome) welcome.remove();

      var candidates = Array.isArray(event.candidates) ? event.candidates : [];
      var options = candidates.map(function (candidate) {
        var label = String((candidate && candidate.label) || '').trim();
        if (!label) return null;
        return { label: label, value: label };
      }).filter(Boolean);

      // A confirmation is still a choice, and it needs its "no". Without an
      // explicit decline the only way to say no is to ignore the question,
      // which reads as the product having stalled.
      if (options.length === 1 && event.resolvesBy === 'confirmation') {
        options = [
          { label: 'Yes, ' + options[0].label, value: 'Yes, ' + options[0].label },
          { label: 'No, not that one', value: 'No, not that one' }
        ];
      }
      if (options.length === 0) return;

      var host = document.createElement('div');
      host.className = 'lex-chat-uncertainty';
      this._threadEl._container.appendChild(host);

      global.Lex.BlockRenderer.render(host, [{
        type: 'decision',
        prompt: event.prompt || 'Which did you mean?',
        options: options,
        // ALWAYS true. The escape hatch is the anti-trap rule, not a nicety.
        allow_custom: true,
        custom_placeholder: 'Something else...'
      }]);

      if (this._threadEl.scrollToBottom) this._threadEl.scrollToBottom();
      this.emit('lex-chat-uncertainty', {
        uncertaintyKind: event.uncertaintyKind,
        resolvesBy: event.resolvesBy,
        candidates: candidates.length
      });
    }

    _insertPlanCard(event) {
      if (!this._threadEl || !this._threadEl._container) return;

      // Remove the welcome placeholder if it is still visible
      var welcome = this._threadEl._container.querySelector('.lex-chat-welcome');
      if (welcome) welcome.remove();

      if (event.card && global.LexDynamicCardRenderer) {
        // Preferred path: backend sent a full card descriptor in the SSE event.
        // The renderer handles element creation, props, data, and actions.
        global.LexDynamicCardRenderer.renderCard(event.card, this._threadEl._container);
      } else {
        // Backward-compat fallback: build a minimal descriptor from the legacy
        // event fields so old-format SSE events still render a card.
        var fallbackDescriptor = {
          type: 'lex-agentic-plan-card',
          card_id: 'plan_' + event.approval_id,
          state: 'pending',
          props: { 'approval-id': event.approval_id, status: 'pending' },
          data: { plan: event.plan },
          actions: []
        };

        if (global.LexDynamicCardRenderer) {
          global.LexDynamicCardRenderer.renderCard(fallbackDescriptor, this._threadEl._container);
        } else {
          // Last resort: original insertComponent path
          this.insertComponent(
            'lex-agentic-plan-card',
            { 'approval-id': event.approval_id, status: 'pending' },
            { plan: event.plan },
            null,
            null
          );
        }
      }

      if (this._threadEl._isNearBottom && this._threadEl._isNearBottom()) {
        this._threadEl.scrollToBottom();
      }

      this.emit('lex-chat-plan-ready', {
        approvalId: event.approval_id,
        plan: event.plan,
        message: event.message
      });
    }

    _showSystemMessage(msg) {
      if (this._threadEl) {
        this._threadEl.addSystemMessage(msg);
      }
    }

    _showPendingGenerationRecovery(lastMessage, options = {}) {
      const { activeGeneration = false } = options;
      if (!this._threadEl || !lastMessage || lastMessage.role !== 'user') return;
      if (this._recoveryNoticeShownForConversation === this.conversationId) return;

      this._recoveryNoticeShownForConversation = this.conversationId;

      if (activeGeneration) {
        if (this._activityEl) {
          this._activityEl.clearReasoning();
          this._activityEl.show('LANA is generating a response…', 'thinking');
        }
        if (this._composerEl) {
          this._composerEl.setGenerating(true);
        }
        this._showSystemMessage('LANA is still working. You can leave this page; the answer will be saved here when it is ready.');
        return;
      }

      const retryGenerationId = lastMessage.metadata &&
        (lastMessage.metadata.generation_id || lastMessage.metadata.session_id);
      if (!retryGenerationId) {
        this._showSystemMessage('The last user message does not have a saved assistant response yet. Reload this conversation to check its status.');
        return;
      }
      this._offerRetry(lastMessage.content, {}, {
        message: 'The previous generation may have been interrupted by a refresh.',
        status: null,
        details: { retryable: true },
        type: 'pending_generation',
        generationAdmitted: true,
        retryGenerationId,
        safeFreshRetry: false
      });
    }

    // ---------------------------------------------------------------------------
    // JIT document processing
    // ---------------------------------------------------------------------------

    _jitCallbacks() {
      return {
        onReady: (filename) => this._showSystemMessage(`Document "${filename}" is ready for use`),
        onError: (filename, err) => {
          const reason = err && err.message ? ': ' + err.message : '';
          this._showSystemMessage(`Failed to prepare "${filename}"${reason}`);
        }
      };
    }

    _ensureDocumentProcessed(documentId, filename) {
      const svc = global.DocumentProcessingService;
      if (!svc) return;
      svc.ensureReadyBackground(documentId, filename, this._jitCallbacks());
    }

    _processMessageMentions(content) {
      const svc = global.DocumentProcessingService;
      if (!svc) return;
      const docs = this._documents || [];
      if (docs.length === 0) return;
      svc.processMessageMentions(content, docs, this._jitCallbacks());
    }

    // ---------------------------------------------------------------------------
    // Default citation click — open document at cited page
    // ---------------------------------------------------------------------------

    async _openCitationSource(detail) {
      const citation = detail && detail.citation ? detail.citation : {};
      const sourceType = String((citation && (citation.sourceType || citation.source_type)) || '').toLowerCase();
      const source = String((citation && citation.source) || '').toLowerCase();
      const explicitDocId = detail && (detail.documentId || citation.document_id || citation.documentId || citation.doc_id);
      const docId = explicitDocId || (sourceType === 'document' || sourceType === 'chunk' ? citation.sourceRef : null);

      if (!docId || sourceType === 'domain_pack' || source === 'domain_pack') {
        await this._showCitationSourceDetails(detail);
        return;
      }

      await this._openCitationDocument({ ...detail, documentId: docId });
    }

    async _openCitationDocument(detail) {
      const docId = detail && detail.documentId;
      if (!docId) {
        await this._showCitationSourceDetails(detail);
        return;
      }

      // Documents open in a modal over the current page, hosting the file
      // viewer in its embedded mode at the cited page with the quoted passage
      // highlighted. The page underneath and the chat dock stay as they are.
      // Never a new window: a blob child window cannot render PDFs, and the
      // system browser is never used for workspace documents.
      const Nav = global.Lex && global.Lex.Nav;
      const Modal = global.Lex && global.Lex.Modal;
      const Evidence = Chat.Evidence;
      if (!Nav || typeof Nav.href !== 'function' || !Modal || typeof Modal.open !== 'function' || !Evidence) {
        this._showSystemMessage('Could not open document. Please try again.');
        return;
      }
      const nav = Evidence.buildCitationViewerNavigation({
        documentId: docId,
        citation: detail.citation || null,
        page: detail.page,
        referrer: currentRouteForReferrer()
      });
      const citation = detail.citation || {};
      const label = (typeof Chat.documentCitationDisplayName === 'function' && Chat.documentCitationDisplayName(citation))
        || citation.label || citation.filename || detail.filename || 'Document';
      this._openCitationViewerModal(nav, label);
    }

    /**
     * The citation viewer modal: lex-modal (X, Escape, backdrop close, focus
     * trap, focus returned to the clicked source) around an iframe of
     * file-viewer.html?chrome=embedded. "Open full view" goes to the page.
     */
    _openCitationViewerModal(nav, label) {
      const Nav = global.Lex.Nav;
      const doc = global.document;
      const trigger = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;

      const frame = doc.createElement('iframe');
      frame.className = 'lex-chat-source-viewer-frame';
      frame.title = 'Document viewer: ' + label;
      // Part of the modal's focus trap cycle.
      frame.setAttribute('tabindex', '0');
      frame.src = Nav.href(nav.path, Object.assign({}, nav.params, { chrome: 'embedded' }));

      const escapeAttr = (value) => (ChatFormat && ChatFormat.escapeHtml ? ChatFormat.escapeHtml(String(value)) : String(value));
      const modal = global.Lex.Modal.open({
        heading: label,
        content: frame,
        size: 'xl',
        width: 'calc(100vw - 64px)',
        flush: true,
        closeOnOverlay: true,
        headerActions: '<lex-btn variant="secondary" size="sm" data-citation-open-full aria-label="Open ' + escapeAttr(label) + ' in the full file viewer">Open full view</lex-btn>'
      });
      if (modal && modal.classList) modal.classList.add('lex-chat-source-modal');
      // lex-modal copies its content when it upgrades: use the live frame.
      const liveFrame = (modal && typeof modal.querySelector === 'function'
        && modal.querySelector('iframe.lex-chat-source-viewer-frame')) || frame;

      let closed = false;
      const onMessage = (event) => {
        const data = event && event.data;
        if (!data || event.source !== liveFrame.contentWindow) return;
        if (data.type === 'lex-embedded-back' || data.type === 'lex-embedded-close') close();
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        global.removeEventListener('message', onMessage);
        liveFrame.src = 'about:blank';
        if (trigger && trigger.isConnected !== false && typeof trigger.focus === 'function') {
          setTimeout(() => trigger.focus(), 0);
        }
      };
      const close = () => {
        cleanup();
        if (modal && typeof modal.removeAfterClose === 'function') modal.removeAfterClose();
      };
      global.addEventListener('message', onMessage);
      if (modal && typeof modal.addEventListener === 'function') {
        // X, Escape and backdrop clicks all emit lex-close.
        modal.addEventListener('lex-close', cleanup);
        modal.addEventListener('click', (event) => {
          const target = event.target && event.target.closest ? event.target.closest('[data-citation-open-full]') : null;
          if (!target) return;
          event.preventDefault();
          close();
          this._handOffConversationToDock();
          Nav.go(nav.path, { params: nav.params, context: nav.context });
        });
      }
      return modal;
    }

    /**
     * "Open full view" is a full page load. Queue this conversation for the
     * viewer's LANA dock (the same one-shot hand-off NavigationHelpers uses)
     * so the chat the user clicked from is open beside the document.
     */
    _handOffConversationToDock() {
      const threadId = this.conversationId;
      if (!threadId) return;
      const action = { type: 'conversation', threadId, matterId: this.matterId || null };
      const helpers = global.NavigationHelpers;
      if (helpers && typeof helpers.queueLanaDockAction === 'function') {
        helpers.queueLanaDockAction(action);
        return;
      }
      try {
        if (global.sessionStorage) {
          global.sessionStorage.setItem('lana_dock_pending_action', JSON.stringify(Object.assign({ createdAt: Date.now() }, action)));
        }
      } catch (_) { /* storage unavailable: the dock still restores its active conversation */ }
    }

    _openReference(reference) {
      if (!reference || typeof reference !== 'object') {
        this._showSystemMessage('Reference details are not available.');
        return;
      }

      const target = reference.navigation_target || reference.navigationTarget || null;
      if (target && target.page && global.Lex && global.Lex.Nav && typeof global.Lex.Nav.go === 'function') {
        global.Lex.Nav.go(target.page, {
          params: target.params || {},
          context: target.context || {}
        });
        return;
      }

      this._showReferenceDetails(reference);
    }

    _showReferenceDetails(reference) {
      const h = (value) => ChatFormat && ChatFormat.escapeHtml
        ? ChatFormat.escapeHtml(String(value == null ? '' : value))
        : String(value == null ? '' : value);
      const label = reference.label || reference.title || reference.name || reference.id || 'Reference';
      const rows = [
        ['Type', reference.type || reference.entity_type || 'reference'],
        ['ID', reference.id || reference.entity_id || ''],
        ['Source', reference.source || ''],
        ['Workspace', reference.workspace_id || reference.workspaceId || ''],
        ['Matter', reference.matter_id || reference.matterId || '']
      ].filter((row) => row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '');
      const preview = reference.preview && typeof reference.preview === 'object'
        ? reference.preview
        : null;

      const rowHtml = rows.map((row) => `
        <div style="display:grid;grid-template-columns:110px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid var(--lex-border-subtle,#eee)">
          <div style="font-size:11px;font-weight:600;color:var(--lex-chat-text-dim,#777)">${h(row[0])}</div>
          <div style="font-size:12px;color:var(--lex-chat-text,#222)">${h(row[1])}</div>
        </div>
      `).join('');
      const previewHtml = preview
        ? `
          <div style="margin-top:14px">
            <div style="font-size:11px;font-weight:700;color:var(--lex-chat-text-dim,#777);margin-bottom:6px">Preview</div>
            ${Object.keys(preview).map((key) => `
              <div style="display:grid;grid-template-columns:110px 1fr;gap:10px;padding:4px 0">
                <div style="font-size:11px;font-weight:600;color:var(--lex-chat-text-dim,#777)">${h(key)}</div>
                <div style="font-size:12px;color:var(--lex-chat-text,#222)">${h(preview[key])}</div>
              </div>
            `).join('')}
          </div>
        `
        : '';

      const content = `
        <div style="display:flex;flex-direction:column;gap:4px">
          <div style="font-size:13px;font-weight:700;color:var(--lex-chat-text,#222)">${h(label)}</div>
          ${rowHtml}
          ${previewHtml}
        </div>
      `;

      if (global.Lex && global.Lex.Modal && typeof global.Lex.Modal.open === 'function') {
        global.Lex.Modal.open({
          heading: 'Reference Details',
          content,
          size: 'lg',
          hideActions: true
        });
      } else {
        this._showSystemMessage(`${label}: ${reference.description || reference.subtitle || 'No reference detail available.'}`);
      }
    }

    _getCitationSourceKind(citation) {
      const source = String(citation && citation.source || '').toLowerCase();
      const sourceType = String(citation && (citation.sourceType || citation.source_type) || '').toLowerCase();
      if (source === 'domain_pack' || sourceType === 'domain_pack') {
        return {
          label: 'Legal authority',
          description: 'External legal authority from the active domain pack. Use it for legal background or law-supported claims; it is not a workspace document, task, contact, or matter record.'
        };
      }
      if (sourceType === 'document' || sourceType === 'chunk' || citation.document_id || citation.documentId || citation.doc_id) {
        return {
          label: 'Workspace document',
          description: 'Matter/workspace document evidence used to support document-derived facts in the response.'
        };
      }
      return {
        label: 'Source',
        description: 'Supporting material attached to this response.'
      };
    }

    async _showCitationSourceDetails(detail) {
      let citation = detail && detail.citation ? detail.citation : {};
      citation = await this._hydrateDomainPackCitation(citation);
      const displayName = typeof Chat.documentCitationDisplayName === 'function'
        ? Chat.documentCitationDisplayName(citation) : null;
      const label = displayName || citation.label || citation.filename || citation.citation || detail.filename || 'Source';
      const sourceKind = this._getCitationSourceKind(citation);
      const sourceType = sourceKind.label;
      const authorityId = citation.authority_id || citation.authorityId || citation.sourceRef || citation.id || '';
      const citationText = citation.citation || displayName || citation.label || citation.filename || '';
      const excerpt = citation.excerpt || citation.snippet || citation.chunk_text || citation.content || citation.text || '';
      const pack = citation.domain_pack || citation.domainPack || null;
      const locator = citation.locator || {};
      const locatorText = citation.locator_text || citation.citation_locator || locator.pageRange || locator.page || '';
      const claimMapping = citation.claim_mapping || citation.claimMapping || {};
      const relationText = citation.used_for || citation.relevance_note || citation.claim || claimMapping.claim || '';
      const h = (value) => ChatFormat && ChatFormat.escapeHtml
        ? ChatFormat.escapeHtml(String(value == null ? '' : value))
        : String(value == null ? '' : value);

      const rows = [
        ['Type', sourceType],
        ['Authority ID', authorityId],
        ['Citation', citationText],
        ['Locator', locatorText],
        ['Source', citation.external_source || citation.source || ''],
        ['Jurisdiction', citation.jurisdiction || ''],
        ['Court', citation.court || ''],
        ['Authority Level', citation.authority_level || citation.doc_type || ''],
        ['Mapping Status', claimMapping.status || citation.claim_mapping_status || ''],
        ['Claim', citation.claim || claimMapping.claim || ''],
        ['URL', citation.url || ''],
        ['Date Published', citation.date_published || '']
      ].filter((row) => row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '');

      const rowHtml = rows.map((row) => `
        <div style="display:grid;grid-template-columns:110px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid var(--lex-border-subtle,#eee)">
          <div style="font-size:11px;font-weight:600;color:var(--lex-chat-text-dim,#777)">${h(row[0])}</div>
          <div style="font-size:12px;color:var(--lex-chat-text,#222)">${h(row[1])}</div>
        </div>
      `).join('');

      const usageHtml = `
        <div style="margin-top:12px;border:1px solid var(--lex-border-subtle,#eee);border-radius:6px;padding:10px;background:var(--lex-surface-muted,#fafafa)">
          <div style="font-size:11px;font-weight:700;color:var(--lex-chat-text-dim,#777);margin-bottom:5px">How this relates</div>
          <div style="font-size:12px;line-height:1.5;color:var(--lex-chat-text,#222)">${h(sourceKind.description)}</div>
          ${relationText ? `<div style="font-size:12px;line-height:1.5;color:var(--lex-chat-text,#222);margin-top:6px">${h(relationText)}</div>` : ''}
        </div>
      `;

      const packHtml = pack && typeof pack === 'object'
        ? `
          <div style="margin-top:14px">
            <div style="font-size:11px;font-weight:700;color:var(--lex-chat-text-dim,#777);margin-bottom:6px">Domain Pack</div>
            ${[
              ['Name', pack.name],
              ['Version', pack.version],
              ['Channel', pack.release_channel],
              ['Corpus Cutoff', pack.corpus_cutoff_timestamp],
              ['Verified At', pack.verified_at]
            ].filter((row) => row[1]).map((row) => `
              <div style="display:grid;grid-template-columns:110px 1fr;gap:10px;padding:4px 0">
                <div style="font-size:11px;font-weight:600;color:var(--lex-chat-text-dim,#777)">${h(row[0])}</div>
                <div style="font-size:12px;color:var(--lex-chat-text,#222)">${h(row[1])}</div>
              </div>
            `).join('')}
          </div>
        `
        : '';

      const excerptHtml = excerpt
        ? `
          <div style="margin-top:14px">
            <div style="font-size:11px;font-weight:700;color:var(--lex-chat-text-dim,#777);margin-bottom:6px">Excerpt</div>
            <div style="font-size:12px;line-height:1.5;white-space:pre-wrap;border:1px solid var(--lex-border-subtle,#eee);border-radius:6px;padding:10px;background:var(--lex-surface-muted,#fafafa)">${h(excerpt)}</div>
          </div>
        `
        : '<div style="margin-top:14px;font-size:12px;color:var(--lex-chat-text-dim,#777)">No excerpt was included with this source.</div>';

      const content = `
        <div style="display:flex;flex-direction:column;gap:4px">
          <div style="font-size:13px;font-weight:700;color:var(--lex-chat-text,#222)">${h(label)}</div>
          ${rowHtml}
          ${usageHtml}
          ${packHtml}
          ${excerptHtml}
        </div>
      `;

      if (global.Lex && global.Lex.Modal && typeof global.Lex.Modal.open === 'function') {
        global.Lex.Modal.open({
          heading: 'Source Details',
          content,
          size: 'lg',
          hideActions: true
        });
      } else {
        this._showSystemMessage(`${label}: ${excerpt || citationText || 'No source detail available.'}`);
      }
    }

    async _hydrateDomainPackCitation(citation) {
      if (!citation || typeof citation !== 'object') return citation || {};
      const source = String(citation.source || '').toLowerCase();
      const sourceType = String(citation.sourceType || citation.source_type || '').toLowerCase();
      if (source !== 'domain_pack' && sourceType !== 'domain_pack') return citation;
      if (citation.excerpt || citation.snippet || citation.text || citation.content) return citation;

      const authorityId = citation.authority_id || citation.authorityId || citation.sourceRef || citation.id || '';
      if (!authorityId) return citation;

      try {
        const apiClient = global.api;
        if (!apiClient || typeof apiClient.get !== 'function') return citation;
        const resp = await apiClient.get('/api/v1/domain-packs/authority/' + encodeURIComponent(authorityId));
        const data = resp && (resp.data || resp);
        const evidence = data && data.evidence;
        if (!evidence || typeof evidence !== 'object') return citation;
        return {
          ...citation,
          ...evidence,
          label: citation.label || evidence.citation || evidence.title || citation.filename,
          filename: citation.filename || evidence.citation || evidence.title,
          citation: citation.citation || evidence.citation,
          source: 'domain_pack',
          domain_pack: citation.domain_pack || data.pack || null
        };
      } catch (err) {
        console.warn('[lex-chat] Domain-pack source hydration failed:', err && err.message ? err.message : err);
        return citation;
      }
    }

    // ---------------------------------------------------------------------------
    // Context meter — shows token usage above the composer
    // ---------------------------------------------------------------------------

    _updateContextMeter(percentUsed, percentUntilCompact) {
      if (!this._contextMeterEl) return;
      const available = Math.max(0, 100 - (percentUsed || 0));
      const fill = this._contextMeterEl.querySelector('.lex-chat-context-meter-fill');
      const text = this._contextMeterEl.querySelector('.lex-chat-context-meter-text');

      if (fill) {
        fill.style.width = (percentUsed || 0) + '%';
        fill.removeAttribute('data-warn');
        fill.removeAttribute('data-danger');
        if (percentUsed >= 90) fill.setAttribute('data-danger', '');
        else if (percentUsed >= 75) fill.setAttribute('data-warn', '');
      }
      if (text) {
        text.textContent = percentUntilCompact != null
          ? `Context available: ${available}% (${percentUntilCompact}% until auto-compact)`
          : `Context available: ${available}%`;
      }
      this._contextMeterEl.style.display = '';

      // Warning fires when the bar turns red (90%) — aligned with the visual danger state.
      if (percentUsed >= 90 && !this._contextWarningShown) {
        this._contextWarningShown = true;
        this._showSystemMessage('Conversation getting long. Consider starting a new chat for best results.');
      }
    }

    _resetContextMeter() {
      if (!this._contextMeterEl) return;
      this._contextMeterEl.style.display = 'none';
      this._contextWarningShown = false;
      const fill = this._contextMeterEl.querySelector('.lex-chat-context-meter-fill');
      if (fill) {
        fill.style.width = '0%';
        fill.removeAttribute('data-warn');
        fill.removeAttribute('data-danger');
      }
      const text = this._contextMeterEl.querySelector('.lex-chat-context-meter-text');
      if (text) text.textContent = '';
    }

    async _loadMoreHistory() {
      if (!this._source || !this.conversationId) return;
      if (!this._threadEl || !this._threadEl.hasMore) return;
      if (this._loadingMore) return;

      this._loadingMore = true;
      this._currentPage = (this._currentPage || 1) + 1;

      try {
        const result = await this._source.loadHistory(this._currentPage, this.maxHistory);

        if (result && result.messages && result.messages.length > 0) {
          // Format messages for prependMessages — expects [{ role, content, messageId, timestamp }]
          const formatted = result.messages.map(function (m) {
            return {
              role: m.role,
              content: m.content,
              messageId: m.id,
              timestamp: m.timestamp,
              citations: m.citations,
              references: m.references,
              coverageSummary: persistedCoverageSummary(m),
              artifacts: m.artifacts,
              duration: m.duration || null,
              tokenCount: m.tokenCount || null
            };
          });
          this._threadEl.prependMessages(formatted);
          this._threadEl.hasMore = result.hasMore || false;
        } else {
          this._threadEl.hasMore = false;
        }
      } catch (err) {
        console.error('[lex-chat] Failed to load more history:', err);
      } finally {
        this._loadingMore = false;
      }
    }

    disconnected() {
      this._clearActiveRetryReceipt();
      if (this._bridge) {
        this._bridge.detach();
        this._bridge = null;
      }
      if (this._source) {
        this._source.disconnect();
      }
    }
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChat = LexChat;
  global.Lex.Chat.externalApprovalView = externalApprovalView;

})(typeof window !== 'undefined' ? window : globalThis);

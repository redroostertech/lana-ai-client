/**
 * Admin Chat Traces — standalone page controller.
 *
 * Handles trace listing, filtering by conversation/status/mode/date,
 * trace detail view with timeline, LLM calls, RAG retrievals, SSE events.
 *
 * @requires api.js       - window.api — getTraceById, getConversationTraces
 * @requires lex.utils.js - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-toast.js - Lex.Toast.error
 * @requires lex-table.js - table.setData()
 */

(function () {
  'use strict';

  // =========================================================================
  // Lex aliases
  // =========================================================================

  var escHtml     = Lex.Utils.escapeHtml;
  var fmtDateTime = Lex.Utils.formatDateTime;

  // =========================================================================
  // State
  // =========================================================================

  var state = {
    traces: [],
    currentTrace: null,
    filters: {
      conversationId: '',
      status: '',
      mode: '',
      date: ''
    },
    pagination: {
      limit: 50,
      offset: 0,
      total: 0,
      hasMore: false
    }
  };

  // =========================================================================
  // DOM references (resolved after DOMContentLoaded)
  // =========================================================================

  var els = {};

  // =========================================================================
  // Init
  // =========================================================================

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    els.listView            = document.getElementById('traceListView');
    els.detailView          = document.getElementById('traceDetailView');
    els.tracesTable         = document.getElementById('tracesTable');
    els.filterConversation  = document.getElementById('filterConversation');
    els.filterStatus        = document.getElementById('filterStatus');
    els.filterMode          = document.getElementById('filterMode');
    els.filterDate          = document.getElementById('filterDate');
    els.applyBtn            = document.getElementById('applyFiltersBtn');
    els.clearBtn            = document.getElementById('clearFiltersBtn');
    els.prevBtn             = document.getElementById('prevPageBtn');
    els.nextBtn             = document.getElementById('nextPageBtn');
    els.paginationInfo      = document.getElementById('paginationInfo');
    els.backBtn             = document.getElementById('backToListBtn');

    // Detail view elements
    els.traceId             = document.getElementById('traceIdDisplay');
    els.statusBadge         = document.getElementById('detailStatusBadge');
    els.duration            = document.getElementById('detailDuration');
    els.llmCount            = document.getElementById('detailLlmCount');
    els.ragCount            = document.getElementById('detailRagCount');
    els.chatMode            = document.getElementById('detailChatMode');
    els.userMessage         = document.getElementById('detailUserMessage');
    els.responseSection     = document.getElementById('detailResponseSection');
    els.responseText        = document.getElementById('detailResponseText');
    els.classificationSection = document.getElementById('detailClassificationSection');
    els.classificationData  = document.getElementById('detailClassificationData');
    els.enrichmentSection   = document.getElementById('detailEnrichmentSection');
    els.enrichmentData      = document.getElementById('detailEnrichmentData');
    els.timeline            = document.getElementById('timelineContainer');
    els.llmCalls            = document.getElementById('llmCallsContainer');
    els.ragRetrievals       = document.getElementById('ragRetrievalsContainer');
    els.sseEvents           = document.getElementById('sseEventsContainer');

    // Bind events
    if (els.applyBtn) els.applyBtn.addEventListener('click', applyFilters);
    if (els.clearBtn) els.clearBtn.addEventListener('click', clearFilters);
    if (els.prevBtn)  els.prevBtn.addEventListener('click', previousPage);
    if (els.nextBtn)  els.nextBtn.addEventListener('click', nextPage);
    if (els.backBtn)  els.backBtn.addEventListener('click', showListView);

    // Show empty state
    showEmptyState();
  }

  // =========================================================================
  // Filters
  // =========================================================================

  function applyFilters() {
    state.filters.conversationId = getValue(els.filterConversation);
    state.filters.status         = getValue(els.filterStatus);
    state.filters.mode           = getValue(els.filterMode);
    state.filters.date           = getValue(els.filterDate);
    state.pagination.offset      = 0;

    if (!state.filters.conversationId) {
      Lex.Toast.error('Please enter a Conversation ID to search traces');
      return;
    }

    loadConversationTraces(state.filters.conversationId);
  }

  function clearFilters() {
    setValue(els.filterConversation, '');
    setValue(els.filterStatus, '');
    setValue(els.filterMode, '');
    setValue(els.filterDate, '');

    state.filters = { conversationId: '', status: '', mode: '', date: '' };
    state.pagination.offset = 0;

    showEmptyState();
  }

  // =========================================================================
  // Data Loading
  // =========================================================================

  async function loadConversationTraces(conversationId) {
    try {
      setTableLoading(true);

      var resp = await window.api.getConversationTraces(
        conversationId,
        state.pagination.limit,
        state.pagination.offset
      );

      var data = resp.data || resp;
      state.traces = data.traces || [];
      state.pagination.total   = data.total || 0;
      state.pagination.hasMore = (state.pagination.offset + state.pagination.limit) < state.pagination.total;

      // Client-side sub-filters
      var filtered = state.traces;

      if (state.filters.status) {
        filtered = filtered.filter(function (t) { return t.status === state.filters.status; });
      }
      if (state.filters.mode) {
        filtered = filtered.filter(function (t) { return t.chat_mode === state.filters.mode; });
      }
      if (state.filters.date) {
        var filterDate = new Date(state.filters.date).toDateString();
        filtered = filtered.filter(function (t) {
          return new Date(t.request_timestamp).toDateString() === filterDate;
        });
      }

      renderTraceList(filtered);
      setTableLoading(false);
      updatePagination();

    } catch (err) {
      console.error('[Traces] Failed to load traces:', err);
      Lex.Toast.error('Failed to load traces: ' + (err.message || err));
      setTableLoading(false);
    }
  }

  // =========================================================================
  // List Rendering
  // =========================================================================

  function showEmptyState() {
    if (els.tracesTable && els.tracesTable.setData) {
      els.tracesTable.setData([]);
    }
    if (els.paginationInfo) els.paginationInfo.textContent = '';
    setPageBtn(els.prevBtn, true);
    setPageBtn(els.nextBtn, true);
  }

  function setTableLoading(loading) {
    if (!els.tracesTable) return;
    if (loading) { Lex.Redact.on(els.tracesTable); }
    else { Lex.Redact.off(els.tracesTable); }
  }

  function renderTraceList(traces) {
    if (!els.tracesTable) return;

    // Pass plain text data — HTML rendering happens in MutationObserver
    var rows = traces.map(function (t) {
      return {
        _traceId: t.trace_id,
        _status: t.status,
        _chatMode: t.chat_mode,
        timestamp: fmtDateTime ? fmtDateTime(t.request_timestamp) : new Date(t.request_timestamp).toLocaleString(),
        user_message: truncate(t.user_message || 'N/A', 80),
        chat_mode: t.chat_mode || 'N/A',
        status: (t.status || 'unknown').toUpperCase(),
        duration: formatDuration(t.total_duration_ms),
        llm_calls: String(t.llm_call_count || 0)
      };
    });

    _ensureTableObserver(els.tracesTable);

    if (els.tracesTable.setData) {
      els.tracesTable.setData(rows);
    }
  }

  /**
   * Attach MutationObserver + row-click to lex-table (once).
   * Mirrors the proven pattern from admin-audit.js.
   */
  function _ensureTableObserver(table) {
    if (table._tracesRendererAttached) return;
    table._tracesRendererAttached = true;

    // Row-click event for drill-down (no timing issues)
    table.addEventListener('row-click', function (e) {
      var row = e.detail && e.detail.row;
      if (row && row._traceId) {
        viewTraceDetail(row._traceId);
      }
    });

    // MutationObserver to post-process cells with HTML badges
    new MutationObserver(function () {
      requestAnimationFrame(function () { _applyTableRenderers(table); });
    }).observe(table, { childList: true });
  }

  /**
   * Post-render: inject badge HTML into status + chat_mode cells.
   * Column order: timestamp(0), user_message(1), chat_mode(2), status(3), duration(4), llm_calls(5)
   */
  function _applyTableRenderers(table) {
    var rows = (table.dataSource && table.dataSource.data) || [];
    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    var trs = tbody.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr  = trs[i];
      var row = rows[i];
      if (!row) continue;

      var tds = tr.querySelectorAll('td');
      if (tds.length < 6) continue;

      // chat_mode cell (index 2): info badge
      if (tds[2]) {
        tds[2].innerHTML = '<lex-badge variant="info">' + escHtml(row._chatMode || row.chat_mode || 'N/A') + '</lex-badge>';
      }

      // status cell (index 3): colored badge
      if (tds[3]) {
        var statusVariants = { completed: 'success', failed: 'danger', pending: 'warning', aborted: 'neutral' };
        var variant = statusVariants[row._status] || 'neutral';
        tds[3].innerHTML = '<lex-badge variant="' + variant + '">' + escHtml((row._status || 'unknown').toUpperCase()) + '</lex-badge>';
      }

      // Make rows look clickable
      tr.style.cursor = 'pointer';
    }
  }

  // =========================================================================
  // Detail View
  // =========================================================================

  async function viewTraceDetail(traceId) {
    try {
      var resp = await window.api.getTraceById(traceId);
      var data = resp.data || resp;
      state.currentTrace = data;

      renderTraceDetail(data);
      showDetailView();

    } catch (err) {
      console.error('[Traces] Failed to load trace detail:', err);
      Lex.Toast.error('Failed to load trace: ' + (err.message || err));
    }
  }

  function renderTraceDetail(traceData) {
    var trace         = traceData.trace || traceData;
    var llmCalls      = traceData.llmCalls || [];
    var ragRetrievals = traceData.ragRetrievals || [];
    var sseEvents     = traceData.sseEvents || [];

    // Overview
    els.traceId.textContent    = 'Trace ID: ' + trace.trace_id;
    els.duration.textContent   = formatDuration(trace.total_duration_ms);
    els.llmCount.textContent   = String(trace.llm_call_count || 0);
    els.ragCount.textContent   = String(trace.rag_retrieval_count || 0);
    els.chatMode.textContent   = trace.chat_mode || 'N/A';
    els.userMessage.textContent = trace.user_message || 'N/A';

    // Status badge
    var badgeVariant = { completed: 'success', failed: 'danger', pending: 'warning', aborted: 'neutral' };
    if (els.statusBadge) {
      els.statusBadge.setAttribute('variant', badgeVariant[trace.status] || 'neutral');
      els.statusBadge.textContent = (trace.status || 'unknown').toUpperCase();
    }

    // Response text
    toggleSection(els.responseSection, trace.response_text, function () {
      els.responseText.textContent = trace.response_text;
    });

    // Classification data
    toggleSection(els.classificationSection, trace.classification_data, function () {
      try {
        var d = typeof trace.classification_data === 'string' ? JSON.parse(trace.classification_data) : trace.classification_data;
        els.classificationData.textContent = JSON.stringify(d, null, 2);
      } catch (e) {
        els.classificationData.textContent = String(trace.classification_data);
      }
    });

    // Enrichment data
    toggleSection(els.enrichmentSection, trace.enrichment_data, function () {
      try {
        var d = typeof trace.enrichment_data === 'string' ? JSON.parse(trace.enrichment_data) : trace.enrichment_data;
        els.enrichmentData.textContent = JSON.stringify(d, null, 2);
      } catch (e) {
        els.enrichmentData.textContent = String(trace.enrichment_data);
      }
    });

    // Sub-sections
    renderTimeline(trace, llmCalls, ragRetrievals, sseEvents);
    renderLLMCalls(llmCalls);
    renderRAGRetrievals(ragRetrievals);
    renderSSEEvents(sseEvents);
  }

  // =========================================================================
  // Timeline
  // =========================================================================

  function renderTimeline(trace, llmCalls, ragRetrievals, sseEvents) {
    var events = [];

    events.push({ time: 0, label: 'Trace Started', color: 'var(--lex-color-info-500, #3B82F6)' });

    if (trace.chat_mode) {
      events.push({ time: 50, label: 'Classification: ' + trace.chat_mode, color: 'var(--lex-color-primary-500, #8B5CF6)' });
    }

    if (ragRetrievals && ragRetrievals.length > 0) {
      ragRetrievals.forEach(function (rag, idx) {
        events.push({
          time: rag.time_since_request_ms || (100 + idx * 50),
          label: 'RAG: ' + (rag.search_type || 'search') + ' (' + (rag.documents_retrieved || 0) + ' docs)',
          color: 'var(--lex-color-success-500, #22C55E)'
        });
      });
    }

    if (llmCalls && llmCalls.length > 0) {
      llmCalls.forEach(function (llm, idx) {
        events.push({
          time: llm.time_since_request_ms || (200 + idx * 100),
          label: 'LLM: ' + (llm.model_name || 'unknown'),
          color: 'var(--lex-color-warning-500, #EAB308)'
        });
        if (llm.time_to_first_token_ms) {
          events.push({
            time: (llm.time_since_request_ms || 0) + llm.time_to_first_token_ms,
            label: 'First Token',
            color: 'var(--lex-color-warning-600, #CA8A04)'
          });
        }
      });
    }

    if (sseEvents && sseEvents.length > 0) {
      sseEvents.forEach(function (evt) {
        events.push({
          time: evt.time_since_request_ms || 0,
          label: 'SSE: ' + (evt.event_type || 'event'),
          color: 'var(--lex-color-primary-400, #A78BFA)'
        });
      });
    }

    events.push({
      time: trace.total_duration_ms || 0,
      label: 'Trace Completed',
      color: trace.status === 'completed' ? 'var(--lex-color-success-600, #16A34A)' : 'var(--lex-color-danger-600, #DC2626)'
    });

    events.sort(function (a, b) { return a.time - b.time; });

    els.timeline.innerHTML = events.map(function (evt) {
      return '<div class="timeline-item">' +
        '<div class="timeline-dot" style="background:' + evt.color + ';"></div>' +
        '<div class="flex items-start justify-between">' +
          '<div>' +
            '<p class="text-sm font-medium lex-text-primary">' + escHtml(evt.label) + '</p>' +
            '<p class="text-xs lex-text-tertiary mt-1">+' + formatDuration(evt.time) + ' from start</p>' +
          '</div>' +
          '<span class="text-xs lex-text-tertiary font-mono">' + evt.time + 'ms</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // =========================================================================
  // LLM Calls
  // =========================================================================

  function renderLLMCalls(llmCalls) {
    if (!llmCalls || llmCalls.length === 0) {
      els.llmCalls.innerHTML = '<p class="text-sm lex-text-tertiary">No LLM calls recorded</p>';
      return;
    }

    els.llmCalls.innerHTML = llmCalls.map(function (llm, idx) {
      var statusColor = llm.status === 'completed'
        ? 'var(--lex-color-success-600)'
        : 'var(--lex-color-danger-600)';

      var html = '<div style="border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);padding:1rem;">';

      // Header
      html += '<div class="flex items-start justify-between mb-3">';
      html += '<div>';
      html += '<h4 class="font-medium lex-text-primary">LLM Call #' + (idx + 1) + ' &mdash; ' + escHtml(llm.function_name || 'Unknown') + '</h4>';
      html += '<p class="text-xs lex-text-tertiary mt-1">Model: <span class="font-mono">' + escHtml(llm.model_name || 'N/A') + '</span>';
      if (llm.use_case) html += ' | Use Case: ' + escHtml(llm.use_case);
      html += '</p></div>';
      html += '<lex-badge variant="' + (llm.status === 'completed' ? 'success' : 'danger') + '">' + escHtml(llm.status || 'unknown') + '</lex-badge>';
      html += '</div>';

      // Stats grid
      html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">';
      html += statCell('Prompt Tokens', formatNumber(llm.prompt_tokens));
      html += statCell('Output Tokens', formatNumber(llm.output_tokens));
      html += statCell('Total Tokens', formatNumber(llm.total_tokens));
      html += statCell('Duration', formatDuration(llm.total_duration_ms));
      html += '</div>';

      // Timing details
      var timingParts = [];
      if (llm.time_to_first_token_ms) timingParts.push(statCell('Time to First Token', formatDuration(llm.time_to_first_token_ms)));
      if (llm.queue_wait_ms) timingParts.push(statCell('Queue Wait', formatDuration(llm.queue_wait_ms)));
      if (llm.temperature !== null && llm.temperature !== undefined) timingParts.push(statCell('Temperature', String(llm.temperature)));
      if (llm.context_window) timingParts.push(statCell('Context Window', formatNumber(llm.context_window)));
      if (llm.system_prompt_length) timingParts.push(statCell('System Prompt', formatNumber(llm.system_prompt_length) + ' chars'));
      if (llm.has_tools) timingParts.push(statCell('Tools', (llm.tool_count || 0) + ' available'));

      if (timingParts.length) {
        html += '<div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mt-3 pt-3" style="border-top:1px solid var(--lex-border-default);">';
        html += timingParts.join('');
        html += '</div>';
      }

      // Error
      if (llm.error_message) {
        html += '<div class="mt-3 p-2 text-sm" style="background:var(--lex-color-danger-50);border:1px solid var(--lex-color-danger-200);border-radius:var(--lex-radius-md,6px);color:var(--lex-color-danger-700);">';
        html += '<span class="font-medium">Error:</span> ' + escHtml(llm.error_message);
        html += '</div>';
      }

      // Tool calls
      if (llm.tool_calls_json) {
        var toolStr;
        try {
          var toolData = typeof llm.tool_calls_json === 'string' ? JSON.parse(llm.tool_calls_json) : llm.tool_calls_json;
          toolStr = JSON.stringify(toolData, null, 2);
        } catch (e) {
          toolStr = String(llm.tool_calls_json);
        }
        html += '<div class="mt-3 pt-3" style="border-top:1px solid var(--lex-border-default);">';
        html += '<details><summary class="cursor-pointer text-sm font-medium" style="color:var(--lex-color-primary-600);">Tool Calls</summary>';
        html += '<pre class="mt-2 text-xs" style="background:var(--lex-bg-secondary);border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);padding:0.75rem 1rem;overflow-x:auto;max-height:16rem;overflow-y:auto;">' + escHtml(toolStr) + '</pre>';
        html += '</details></div>';
      }

      html += '</div>';
      return html;
    }).join('');
  }

  // =========================================================================
  // RAG Retrievals
  // =========================================================================

  function renderRAGRetrievals(ragRetrievals) {
    if (!ragRetrievals || ragRetrievals.length === 0) {
      els.ragRetrievals.innerHTML = '<p class="text-sm lex-text-tertiary">No RAG retrievals recorded</p>';
      return;
    }

    els.ragRetrievals.innerHTML = ragRetrievals.map(function (rag, idx) {
      var html = '<div style="border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);padding:1rem;">';

      // Header
      html += '<div class="flex items-start justify-between mb-3">';
      html += '<div>';
      html += '<h4 class="font-medium lex-text-primary">RAG Retrieval #' + (idx + 1) + '</h4>';
      html += '<p class="text-xs lex-text-tertiary mt-1">Search Type: ' + escHtml(rag.search_type || 'N/A');
      if (rag.top_k) html += ' | Top K: ' + rag.top_k;
      if (rag.similarity_threshold) html += ' | Threshold: ' + rag.similarity_threshold;
      html += '</p></div>';
      html += '<lex-badge variant="info">' + (rag.documents_retrieved || 0) + ' docs</lex-badge>';
      html += '</div>';

      // Query text
      if (rag.query_text) {
        html += '<div class="mb-3" style="background:var(--lex-bg-secondary);border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);padding:0.75rem 1rem;">';
        html += '<p class="text-xs lex-text-tertiary mb-1">Query:</p>';
        html += '<p class="text-sm lex-text-primary">' + escHtml(rag.query_text) + '</p>';
        html += '</div>';
      }

      // Stats grid
      html += '<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">';
      html += statCell('Documents', String(rag.documents_retrieved || 0));
      html += statCell('Top Score', rag.top_score ? (Number(rag.top_score) * 100).toFixed(1) + '%' : 'N/A');
      html += statCell('Avg Score', rag.avg_score ? (Number(rag.avg_score) * 100).toFixed(1) + '%' : 'N/A');
      html += statCell('Duration', formatDuration(rag.total_duration_ms));
      html += '</div>';

      // Timing breakdown
      var timingParts = [];
      if (rag.embedding_duration_ms != null) timingParts.push(statCell('Embedding Time', formatDuration(rag.embedding_duration_ms)));
      if (rag.search_duration_ms != null) timingParts.push(statCell('Search Time', formatDuration(rag.search_duration_ms)));
      if (rag.query_embedding_dims) timingParts.push(statCell('Embedding Dims', String(rag.query_embedding_dims)));

      if (timingParts.length) {
        html += '<div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mt-3 pt-3" style="border-top:1px solid var(--lex-border-default);">';
        html += timingParts.join('');
        html += '</div>';
      }

      // Document IDs
      if (rag.document_ids_json) {
        var docIdStr;
        try {
          var docIds = typeof rag.document_ids_json === 'string' ? JSON.parse(rag.document_ids_json) : rag.document_ids_json;
          docIdStr = JSON.stringify(docIds, null, 2);
        } catch (e) {
          docIdStr = String(rag.document_ids_json);
        }
        html += '<div class="mt-3 pt-3" style="border-top:1px solid var(--lex-border-default);">';
        html += '<details><summary class="cursor-pointer text-sm font-medium" style="color:var(--lex-color-primary-600);">Document IDs</summary>';
        html += '<pre class="mt-2 text-xs" style="background:var(--lex-bg-secondary);border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);padding:0.75rem 1rem;overflow-x:auto;">' + escHtml(docIdStr) + '</pre>';
        html += '</details></div>';
      }

      html += '</div>';
      return html;
    }).join('');
  }

  // =========================================================================
  // SSE Events
  // =========================================================================

  function renderSSEEvents(sseEvents) {
    if (!sseEvents || sseEvents.length === 0) {
      els.sseEvents.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-sm lex-text-tertiary text-center">No SSE events recorded</td></tr>';
      return;
    }

    els.sseEvents.innerHTML = sseEvents.map(function (evt) {
      var dataStr = '';
      var prettyStr = '';
      if (evt.event_data) {
        if (typeof evt.event_data === 'string') {
          try {
            var parsed = JSON.parse(evt.event_data);
            dataStr = JSON.stringify(parsed);
            prettyStr = JSON.stringify(parsed, null, 2);
          } catch (e) {
            dataStr = evt.event_data;
            prettyStr = evt.event_data;
          }
        } else {
          dataStr = JSON.stringify(evt.event_data);
          prettyStr = JSON.stringify(evt.event_data, null, 2);
        }
      }

      return '<tr style="border-bottom:1px solid var(--lex-border-default);">' +
        '<td class="px-4 py-3 text-sm"><lex-badge variant="neutral">' + escHtml(evt.event_type || 'N/A') + '</lex-badge></td>' +
        '<td class="px-4 py-3 text-sm lex-text-tertiary">+' + formatDuration(evt.time_since_request_ms) + '</td>' +
        '<td class="px-4 py-3 text-sm lex-text-secondary font-mono">' +
          (dataStr
            ? '<details><summary class="cursor-pointer" style="color:var(--lex-color-primary-600);">' + escHtml(dataStr.substring(0, 80)) + (dataStr.length > 80 ? '...' : '') + '</summary>' +
              '<pre class="mt-1 text-xs" style="background:var(--lex-bg-secondary);border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);padding:0.5rem;overflow-x:auto;max-height:12rem;overflow-y:auto;">' + escHtml(prettyStr) + '</pre></details>'
            : 'N/A') +
        '</td></tr>';
    }).join('');
  }

  // =========================================================================
  // Pagination
  // =========================================================================

  function updatePagination() {
    var from = state.pagination.total > 0 ? state.pagination.offset + 1 : 0;
    var to   = Math.min(state.pagination.offset + state.pagination.limit, state.pagination.total);

    if (els.paginationInfo) {
      els.paginationInfo.textContent = 'Showing ' + from + ' to ' + to + ' of ' + state.pagination.total + ' traces';
    }

    setPageBtn(els.prevBtn, state.pagination.offset === 0);
    setPageBtn(els.nextBtn, !state.pagination.hasMore);
  }

  function previousPage() {
    if (state.pagination.offset > 0) {
      state.pagination.offset -= state.pagination.limit;
      if (state.filters.conversationId) loadConversationTraces(state.filters.conversationId);
    }
  }

  function nextPage() {
    state.pagination.offset += state.pagination.limit;
    if (state.filters.conversationId) loadConversationTraces(state.filters.conversationId);
  }

  // =========================================================================
  // View switching
  // =========================================================================

  function showListView() {
    els.listView.classList.remove('hidden');
    els.detailView.classList.add('hidden');
  }

  function showDetailView() {
    els.listView.classList.add('hidden');
    els.detailView.classList.remove('hidden');
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  function formatDuration(ms) {
    if (!ms && ms !== 0) return 'N/A';
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(2) + 's';
    var minutes = Math.floor(ms / 60000);
    var seconds = ((ms % 60000) / 1000).toFixed(0);
    return minutes + 'm ' + seconds + 's';
  }

  function formatNumber(n) {
    if (n == null) return '0';
    return Number(n).toLocaleString();
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length <= max ? str : str.substring(0, max) + '...';
  }

  function statCell(label, value) {
    return '<div>' +
      '<p class="lex-text-tertiary" style="font-size:var(--lex-body-xs-size,0.75rem);">' + escHtml(label) + '</p>' +
      '<p class="font-semibold lex-text-primary">' + escHtml(value) + '</p>' +
    '</div>';
  }

  function toggleSection(sectionEl, data, renderFn) {
    if (!sectionEl) return;
    if (data) {
      renderFn();
      sectionEl.classList.remove('hidden');
    } else {
      sectionEl.classList.add('hidden');
    }
  }

  function setPageBtn(btn, disabled) {
    if (!btn) return;
    btn.disabled = disabled;
    if (disabled) {
      btn.setAttribute('disabled', '');
    } else {
      btn.removeAttribute('disabled');
    }
  }

  function getValue(el) {
    if (!el) return '';
    var v = el.value;
    return (v != null ? String(v) : '').trim();
  }

  function setValue(el, val) {
    if (!el) return;
    el.value = val;
  }

})();

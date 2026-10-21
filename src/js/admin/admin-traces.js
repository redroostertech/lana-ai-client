/**
 * Admin Chat Traces — standalone page controller.
 *
 * One server-paged lex-table of traces (docs/TABLE-STANDARD.md): toolbar
 * search (text, or a conversation/session/trace id), Sort by, a Status
 * filter and header filters on every column; plus the trace detail view with timeline, LLM calls, RAG retrievals, SSE events.
 *
 * @requires api.js       - window.api — getTraceById, getTraces
 * @requires lex.utils.js - Lex.Utils.escapeHtml, Lex.Utils.formatDateTime
 * @requires lex-toast.js - Lex.Toast.error
 * @requires lex-table.js - server paging (setServerData)
 * @requires admin-table-kit.js - AdminTableKit toolbar + cell helpers
 * @requires library-column-filters.js - date-range filter bounds
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
    currentTrace: null,
    search: ''
  };

  var TABLE_ID = 'tracesTable';
  var _gen = 0;
  var _toolbar = null;

  // Table column -> traces API sortBy.
  var SORT_BY_COLUMN = { created_at: 'created_at', status: 'status', chat_mode: 'chat_mode', duration: 'total_duration_ms' };

  var TRACE_STATUSES = ['completed', 'failed', 'pending', 'aborted'];
  var STATUS_COLORS = { completed: 'green', failed: 'red', pending: 'yellow', aborted: 'gray' };
  var ROUTES = ['unified', 'workspace', 'document', 'agentic', 'rag', 'general', 'data', 'insights', 'automations', 'text_transform', 'pending_detection'];

  // Duration column filter: milliseconds, min inclusive, max exclusive.
  var DURATION_RANGES = {
    under_5s:  { label: 'Under 5 s',   min: null,   max: 5000 },
    '5s_30s':  { label: '5 s – 30 s',  min: 5000,   max: 30000 },
    '30s_2m':  { label: '30 s – 2 min', min: 30000, max: 120000 },
    over_2m:   { label: 'Over 2 min',  min: 120000, max: null }
  };

  // LLM calls column filter: counts, min inclusive, max exclusive.
  var LLM_CALL_RANGES = {
    none:     { label: 'None',    min: null, max: 1 },
    '1_3':    { label: '1 – 3',   min: 1,    max: 4 },
    '4_10':   { label: '4 – 10',  min: 4,    max: 11 },
    over_10:  { label: 'Over 10', min: 11,   max: null }
  };

  var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    els.breadcrumb          = document.getElementById('traceBreadcrumb');
    els.tracesTable         = document.getElementById(TABLE_ID);

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
    els.sseTable            = document.getElementById('sseEventsTable');

    initTable();
  }

  // =========================================================================
  // Query mapping (pure; exposed for unit tests)
  // =========================================================================

  function rangeOf(map, filters, col) {
    var kit = window.AdminTableKit;
    return map[kit.firstFilterValue(filters, col)] || null;
  }

  /**
   * The traces API options for a lex-table server query. The search box
   * takes free text or a conversation/session/trace id (a UUID). Filters the
   * API does not read yet go under the names listed in the report.
   * @param {Object} query - { page, limit, sortBy, sortDir, filters }
   * @param {string} search
   * @param {Date} [now]
   * @returns {Object} options for api.getTraces
   */
  function toApiOptions(query, search, now) {
    var kit = window.AdminTableKit;
    var q = query || {};
    var filters = q.filters || {};
    var paging = kit.pageOffset(q);
    var options = {
      limit: paging.limit,
      offset: paging.offset,
      sortBy: SORT_BY_COLUMN[q.sortBy] || 'created_at',
      sortOrder: q.sortDir === 'asc' ? 'asc' : 'desc'
    };
    var term = String(search || '').trim();
    if (term && UUID_PATTERN.test(term)) options.conversationId = term;
    else if (term) options.search = term;
    var message = kit.firstFilterValue(filters, 'user_message');
    if (message) options.message = message;
    var statuses = kit.filterValues(filters.status);
    if (statuses.length) options.status = statuses.join(',');
    var routes = kit.filterValues(filters.chat_mode);
    if (routes.length) options.chatMode = routes.join(',');
    var duration = rangeOf(DURATION_RANGES, filters, 'duration');
    if (duration && duration.min !== null) options.minDurationMs = duration.min;
    if (duration && duration.max !== null) options.maxDurationMs = duration.max;
    var calls = rangeOf(LLM_CALL_RANGES, filters, 'llm_calls');
    if (calls && calls.min !== null) options.minLlmCalls = calls.min;
    if (calls && calls.max !== null) options.maxLlmCalls = calls.max;
    var created = kit.setRange(null, filters, 'created_at', '', '', now);
    if (created.after) options.createdAfter = created.after;
    if (created.before) options.createdBefore = created.before;
    return options;
  }

  function mapTrace(t) {
    return {
      id:           String(t.trace_id || ''),
      user_message: String(t.user_message || ''),
      chat_mode:    String(t.chat_mode || ''),
      status:       String(t.status || ''),
      duration:     t.total_duration_ms == null ? null : Number(t.total_duration_ms),
      llm_calls:    Number(t.llm_call_count || 0),
      created_at:   t.created_at || t.request_timestamp || '',
      _raw:         t
    };
  }

  function cellRenderers() {
    var kit = window.AdminTableKit;
    return {
      user_message: function (val) {
        if (!val) return kit.muted('No message');
        return '<span class="admin-table-name" title="' + kit.esc(val) + '">' + kit.esc(truncate(val, 160)) + '</span>';
      },
      chat_mode: function (val) { return val ? kit.badge(formatTraceRoute(val), 'blue') : kit.muted(''); },
      status: function (val) {
        var key = String(val || '').toLowerCase();
        return kit.badge(Lex.Utils.humanizeLabel(key || 'unknown'), STATUS_COLORS[key] || 'gray');
      },
      duration: function (val) {
        return val === null || val === undefined ? kit.muted('') : '<span class="admin-table-text">' + kit.esc(formatDuration(val)) + '</span>';
      },
      llm_calls: function (val) { return '<span class="admin-table-text">' + kit.esc(String(val || 0)) + '</span>'; },
      created_at: function (val) { return kit.timeCell(val); }
    };
  }

  function rangeOptions(map) {
    return Object.keys(map).map(function (key) { return { value: key, label: map[key].label }; });
  }

  function filterOptions() {
    var kit = window.AdminTableKit;
    var routeLabels = {};
    ROUTES.forEach(function (r) { routeLabels[r] = formatTraceRoute(r); });
    return {
      user_message: { text: true, placeholder: 'Message contains...' },
      chat_mode:    { options: kit.labelOptions(ROUTES, routeLabels) },
      status:       { options: kit.labelOptions(TRACE_STATUSES) },
      duration:     { single: true, options: rangeOptions(DURATION_RANGES) },
      llm_calls:    { single: true, options: rangeOptions(LLM_CALL_RANGES) },
      created_at:   kit.dateRangeFilter()
    };
  }

  // =========================================================================
  // Table
  // =========================================================================

  function initTable() {
    var table = els.tracesTable;
    if (!table) return;
    window.AdminTableKit.whenTableReady().then(function () {
      table.setCellRenderers(cellRenderers());
      table.setColumnFilterOptions(filterOptions());
      _toolbar = window.AdminTableKit.bindToolbar({
        table: table,
        searchId: 'tracesSearch',
        sortId: 'tracesSort',
        orderId: 'tracesSortOrder',
        filterId: 'tracesStatusFilter',
        filterKey: 'status',
        countIds: ['tracesCount', 'tracesSectionCount'],
        noun: ['trace', 'traces'],
        onSearch: function (term) {
          state.search = term;
          table.requestServerQuery({ resetPage: true });
        }
      });
      table.addEventListener('lex-query-change', function (e) {
        if (e.target === table) loadTraces(e.detail);
      });
      table.addEventListener('row-click', function (e) {
        var row = e.detail && e.detail.row;
        if (row && row.id) viewTraceDetail(row.id);
      });
      document.addEventListener('lex-refresh', function (e) {
        e.preventDefault();
        table.requestServerQuery();
      });
      table.requestServerQuery({ resetPage: true });
    });
  }

  async function loadTraces(query) {
    var gen = ++_gen;
    var table = els.tracesTable;
    if (!table) return;
    query = query || table.serverQuery;
    var filters = query.filters || {};
    var filtered = Boolean(state.search || Object.keys(filters).length);
    if (_toolbar) _toolbar.syncFilter(filters);
    try {
      var resp = await window.api.getTraces(toApiOptions(query, state.search));
      if (gen !== _gen) return;
      var data = (resp && resp.data) || resp || {};
      var traces = data.traces || [];
      table.emptyText = window.AdminTableKit.emptyText(filtered, 'traces');
      table.setServerData(traces.map(mapTrace), {
        page: query.page,
        limit: query.limit,
        total: Number(data.total) || 0
      });
    } catch (err) {
      if (gen !== _gen) return;
      console.error('[Traces] Failed to load traces:', err);
      if (_toolbar) _toolbar.setCount(null);
      table.setServerError('Traces could not be loaded. Check your connection and try again.');
    }
  }

  function formatTraceRoute(route) {
    var value = String(route || '').trim();
    if (!value) return 'N/A';

    var labels = {
      unified: 'Unified',
      workspace: 'Workspace',
      document: 'Document',
      data: 'Data',
      insights: 'Insights',
      automations: 'Automations',
      text_transform: 'Text transform',
      pending_detection: 'Pending route',
      workspace_chat: 'Workspace chat',
      matter_chat: 'Matter chat',
      document_chat: 'Document chat',
      full_chat: 'Full chat',
      agentic_mode: 'Agentic mode',
      unified_chat: 'Unified chat',
      unified_handler: 'Unified handler',
      rag: 'RAG',
      agentic: 'Agentic',
      general: 'General'
    };

    return labels[value] || Lex.Utils.humanizeLabel(value);
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
    els.chatMode.textContent   = formatTraceRoute(trace.chat_mode);
    els.userMessage.textContent = trace.user_message || 'N/A';

    // Status badge
    if (els.statusBadge) {
      els.statusBadge.setAttribute('color', STATUS_COLORS[trace.status] || 'gray');
      els.statusBadge.setAttribute('label', Lex.Utils.humanizeLabel(trace.status || 'unknown'));
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
      events.push({ time: 50, label: 'Classification: ' + formatTraceRoute(trace.chat_mode), color: 'var(--lex-color-primary-500, #8B5CF6)' });
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

  // The trace's SSE events arrive in one response: a client-side lex-table
  // (docs/TABLE-STANDARD.md); a row opens the event's full data in a drawer.

  var SSE_OFFSET_RANGES = [
    { value: 'lt1s', label: 'Under 1 s', max: 1000 },
    { value: '1-10s', label: '1–10 s', min: 1000, max: 10000 },
    { value: 'gte10s', label: '10 s or more', min: 10000 }
  ];

  function parseEventData(value) {
    if (value === null || value === undefined || value === '') return { compact: '', pretty: '' };
    if (typeof value !== 'string') return { compact: JSON.stringify(value), pretty: JSON.stringify(value, null, 2) };
    try {
      var parsed = JSON.parse(value);
      return { compact: JSON.stringify(parsed), pretty: JSON.stringify(parsed, null, 2) };
    } catch (e) {
      return { compact: value, pretty: value };
    }
  }

  function mapSseEvent(evt, index) {
    var e = evt || {};
    var offset = Number(e.time_since_request_ms);
    return {
      _key: String(e.event_id || e.event_sequence || 'sse-' + index),
      event_type: e.event_type || '',
      event_data: parseEventData(e.event_data).compact,
      time_since_request_ms: e.time_since_request_ms === null || e.time_since_request_ms === undefined || !Number.isFinite(offset) ? null : offset,
      created_at: e.event_timestamp || e.created_at || '',
      _raw: e
    };
  }

  function sseRenderers() {
    var kit = window.AdminTableKit;
    return {
      event_type: function (val) { return val ? kit.badge(Lex.Utils.humanizeLabel(val), 'gray') : kit.muted(''); },
      event_data: function (val) {
        if (!val) return kit.muted('');
        return '<span class="admin-table-text" style="font-family:var(--lex-font-mono,monospace)" title="' + kit.esc(val.length > 500 ? val.slice(0, 500) + '…' : val) + '">' + kit.esc(val.length > 160 ? val.slice(0, 160) + '…' : val) + '</span>';
      },
      time_since_request_ms: function (val) {
        return val === null ? kit.muted('') : '<span class="admin-table-text">+' + kit.esc(formatDuration(val)) + '</span>';
      },
      created_at: function (val) { return kit.timeCell(val); }
    };
  }

  function sseFilterOptions(rows) {
    var client = window.AdminClientTables;
    return {
      event_type: { options: client.valueOptions(rows, 'event_type') },
      event_data: { text: true, placeholder: 'Data contains...' },
      time_since_request_ms: client.rangeFilter(SSE_OFFSET_RANGES),
      created_at: client.dateFilter()
    };
  }

  var _sseCount = null;

  function renderSSEEvents(sseEvents) {
    var table = els.sseTable;
    if (!table) return;
    window.AdminTableKit.whenTableReady().then(function () {
      if (!_sseCount) {
        table.setCellRenderers(sseRenderers());
        _sseCount = window.AdminClientTables.bindCount(table, ['sseEventsCount'], ['event', 'events']);
        table.addEventListener('row-click', function (e) {
          var row = e.detail && e.detail.row;
          if (!row || !row._raw || !Lex.Drawer) return;
          Lex.Drawer.open({
            heading: Lex.Utils.humanizeLabel(row.event_type || 'SSE event'),
            subtitle: row.time_since_request_ms === null ? '' : '+' + formatDuration(row.time_since_request_ms),
            content: '<pre class="text-xs" style="background:var(--lex-bg-secondary);border:1px solid var(--lex-border-default);border-radius:var(--lex-radius-md,6px);padding:0.75rem;white-space:pre-wrap;word-break:break-word;">' +
              escHtml(parseEventData(row._raw.event_data).pretty || 'No data') + '</pre>',
            width: 'md'
          });
        });
      }
      var rows = (sseEvents || []).map(mapSseEvent);
      table.resetQuery();
      table.setColumnFilterOptions(sseFilterOptions(rows));
      table.setData(rows);
      _sseCount.update();
    });
  }

  // =========================================================================
  // View switching
  // =========================================================================

  function showListView() {
    els.listView.classList.remove('hidden');
    els.detailView.classList.add('hidden');
    setBreadcrumbItems([
      { label: 'Administration', href: 'admin/index.html' },
      { label: 'Chat Traces' }
    ]);
  }

  function showDetailView() {
    els.listView.classList.add('hidden');
    els.detailView.classList.remove('hidden');
    setBreadcrumbItems([
      { label: 'Administration', href: 'admin/index.html' },
      { label: 'Chat Traces', href: 'admin/traces.html' },
      { label: 'Trace Details' }
    ]);
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

  function setBreadcrumbItems(items) {
    if (!els.breadcrumb) return;
    els.breadcrumb.items = items;
  }

  // Pure table logic, exposed for unit tests.
  window.AdminTracesTable = {
    toApiOptions: toApiOptions,
    mapTrace: mapTrace,
    cellRenderers: cellRenderers,
    filterOptions: filterOptions,
    formatTraceRoute: formatTraceRoute,
    SORT_BY_COLUMN: SORT_BY_COLUMN,
    mapSseEvent: mapSseEvent,
    sseRenderers: sseRenderers,
    sseFilterOptions: sseFilterOptions
  };

})();

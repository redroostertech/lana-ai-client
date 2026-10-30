/* ==========================================================================
   Lex UI: Ask LANA side panel data (pure)
   Shapes what the full screen side panel's Context, Sources, Outputs and
   Activity cards render, from two inputs: the per-conversation endpoints
   (on reopen and conversation switch) and the live lex-chat events of the
   turn in progress. No DOM and no network: lex-lana-side-panel fetches and
   listens, this module maps and merges.

   Endpoints (GET /api/v1/conversations/:id/..., through
   Lex.Chat.ConversationsApiClient):
     context           { context_usage }                    -> contextView
     sources           { documents, authorities, records,
                         totals }                           -> sourcesFromServer,
                                                               mergeSources
     outputs           { items, totals }                    -> outputItem,
                                                               mergeOutputs
     activity/history  { active, active_response, runs,
                         tool_calls }                       -> activityView,
                                                               mergeActivity

   Live (lex-chat events from the SSE stream):
     lex-chat-context-usage { usage }       -> contextView(usage)
     lex-chat-entity-change                 -> outputFromEntityChange
     lex-chat-tool-start / lex-chat-tool-end -> applyToolEvent (paired by
                                               call id)

   Also: viewUrlTarget(view_url) turns a backend deep link into a client
   page for Lex.Nav.go, and the token / duration formatters the cards use.

   Exports Lex.Chat.SidePanelData.
   ========================================================================== */

(function (global) {
  'use strict';

  var Lex = global.Lex = global.Lex || {};

  function str(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return typeof value === 'string' ? value.trim() : '';
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function count(value) {
    var n = num(value);
    return n !== null && n > 0 ? Math.floor(n) : 0;
  }

  function list(value) {
    return Array.isArray(value) ? value.filter(function (v) { return v && typeof v === 'object'; }) : [];
  }

  function humanize(value) {
    var Utils = Lex.Utils;
    if (Utils && typeof Utils.humanizeLabel === 'function') return Utils.humanizeLabel(value);
    var text = str(value).split('_').join(' ').split('-').join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function timeOf(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : null;
  }

  /** Newest first; rows without a time keep their place after the dated ones. */
  function newestFirst(items, field) {
    return items
      .map(function (item, index) { return { item: item, index: index, t: timeOf(item[field]) }; })
      .sort(function (a, b) {
        if (a.t === null && b.t === null) return a.index - b.index;
        if (a.t === null) return 1;
        if (b.t === null) return -1;
        return (b.t - a.t) || (a.index - b.index);
      })
      .map(function (entry) { return entry.item; });
  }

  /** Some routes wrap their payload in { data }; the panel endpoints do not. */
  function unwrap(payload) {
    if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
      && !Array.isArray(payload.data)) return payload.data;
    return payload && typeof payload === 'object' ? payload : {};
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  function formatTokens(n) {
    var value = num(n);
    if (value === null) return '';
    return Math.round(value).toLocaleString('en-US');
  }

  function formatPercent(n) {
    var value = num(n);
    if (value === null) return '';
    var rounded = Math.round(value * 10) / 10;
    return (rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1)) + '%';
  }

  function formatDuration(ms) {
    var value = num(ms);
    if (value === null || value < 0) return '';
    if (value < 1000) return Math.round(value) + ' ms';
    var seconds = value / 1000;
    if (seconds < 60) {
      var s = Math.round(seconds * 10) / 10;
      return (s % 1 === 0 ? String(s) : s.toFixed(1)) + ' s';
    }
    var minutes = Math.floor(seconds / 60);
    var rest = Math.round(seconds - minutes * 60);
    return minutes + ' min' + (rest ? ' ' + rest + ' s' : '');
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  // `rag` is the retrieved evidence: the card calls it Sources.
  var BREAKDOWN = [['system', 'System'], ['history', 'History'], ['rag', 'Sources'], ['tools', 'Tools']];

  /**
   * One context usage snapshot (GET /context's context_usage, or a live
   * context_usage event) as the Context card shows it; null without one.
   * basis "unavailable" means the numbers were not recorded: `recorded` is
   * false and the usage fields are null, never zero.
   */
  function contextView(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var basis = str(raw.basis);
    var percent = num(raw.percent_used);
    var recorded = basis !== 'unavailable' && percent !== null;
    var breakdown = recorded && raw.breakdown && typeof raw.breakdown === 'object'
      ? BREAKDOWN.map(function (pair) {
        var tokens = num(raw.breakdown[pair[0]]);
        return tokens === null ? null : { key: pair[0], label: pair[1], tokens: tokens };
      }).filter(Boolean)
      : [];
    return {
      recorded: recorded,
      basis: basis || null,
      estimated: basis === 'estimate',
      percentUsed: recorded ? Math.max(0, Math.min(100, percent)) : null,
      tokensUsed: recorded ? num(raw.tokens_used) : null,
      tokensAvailable: num(raw.tokens_available),
      usableTokens: num(raw.usable_tokens),
      headroomPercent: recorded ? num(raw.percent_until_compact) : null,
      breakdown: breakdown,
      level: !recorded ? 'accent' : percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'accent',
      asOf: str(raw.as_of) || null,
      asOfMessageId: str(raw.as_of_message_id) || null
    };
  }

  // ---------------------------------------------------------------------------
  // Sources
  // ---------------------------------------------------------------------------

  // Same group keys, labels and order as Lex.Chat.SourcesAggregate.
  var SOURCE_GROUPS = [
    ['documents', 'Documents'],
    ['authority', 'Legal authority'],
    ['records', 'Records'],
    ['other', 'Other sources']
  ];

  function positivePages(pages) {
    var seen = [];
    (Array.isArray(pages) ? pages : []).forEach(function (p) {
      var n = num(p);
      if (n !== null && n >= 1 && n % 1 === 0 && seen.indexOf(n) === -1) seen.push(n);
    });
    return seen.sort(function (a, b) { return a - b; });
  }

  /**
   * GET /sources as source groups keyed the way SourcesAggregate keys the
   * live citations, so the two merge by the same identity. Each item keeps a
   * citation / reference object for lex-chat's own open handlers.
   */
  function sourcesFromServer(payload) {
    var p = unwrap(payload);
    var documents = list(p.documents).map(function (d) {
      var id = str(d.document_id);
      var label = str(d.filename) || 'Document';
      var pages = positivePages(d.pages);
      return {
        key: id || 'label:' + label.toLowerCase(),
        kind: 'document',
        label: label,
        documentId: id,
        pages: pages,
        citeCount: count(d.cite_count),
        citation: {
          document_id: id || null,
          filename: label,
          source_type: 'document',
          matter_id: str(d.matter_id) || null,
          page_number: pages[0] || null
        }
      };
    });
    var authority = list(p.authorities).map(function (a) {
      var id = str(a.authority_id);
      var label = str(a.label) || str(a.citation) || 'Legal authority';
      return {
        key: id || 'label:' + label.toLowerCase(),
        kind: 'authority',
        label: label,
        citeCount: count(a.cite_count),
        citation: {
          source: 'domain_pack',
          authority_id: id || null,
          label: label,
          citation: str(a.citation) || null,
          url: str(a.url) || null,
          jurisdiction: str(a.jurisdiction) || null,
          court: str(a.court) || null,
          domain_pack: str(a.domain_pack) || null
        }
      };
    });
    var records = list(p.records).map(function (r) {
      var type = str(r.entity_type) || 'record';
      var id = str(r.entity_id);
      var label = str(r.label) || 'Record';
      return {
        key: type + ':' + (id || label.toLowerCase()),
        kind: 'record',
        label: label,
        entityType: type,
        citeCount: count(r.cite_count),
        reference: { type: type, entity_type: type, id: id || null, entity_id: id || null, label: label, matter_id: str(r.matter_id) || null }
      };
    });
    var totals = p.totals && typeof p.totals === 'object' ? p.totals : {};
    return {
      groups: { documents: documents, authority: authority, records: records, other: [] },
      citationCount: num(totals.citations) !== null
        ? count(totals.citations)
        : documents.concat(authority, records).reduce(function (sum, i) { return sum + i.citeCount; }, 0)
    };
  }

  /**
   * The full history from the server plus the citations of turns it has not
   * stored yet (a SourcesAggregate result). Same keys merge: counts add up
   * and pages join. Returns the SourcesAggregate shape.
   * @param {ReturnType<typeof sourcesFromServer>} server
   * @param {{ groups: Array, citationCount: number }} [live]
   */
  function mergeSources(server, live) {
    var base = server && server.groups ? server.groups : {};
    var liveGroups = live && Array.isArray(live.groups) ? live.groups : [];
    var groups = SOURCE_GROUPS.map(function (pair) {
      var byKey = new Map();
      var order = 0;
      (base[pair[0]] || []).forEach(function (item) {
        var copy = Object.assign({}, item, { pages: item.pages ? item.pages.slice() : item.pages, firstSeen: order++ });
        byKey.set(copy.key, copy);
      });
      var liveGroup = liveGroups.find(function (g) { return g.key === pair[0]; });
      (liveGroup ? liveGroup.items : []).forEach(function (item) {
        var existing = byKey.get(item.key);
        if (!existing) {
          byKey.set(item.key, Object.assign({}, item, { pages: item.pages ? item.pages.slice() : item.pages, firstSeen: order++ }));
          return;
        }
        existing.citeCount += item.citeCount || 0;
        if (item.pages && existing.pages) {
          item.pages.forEach(function (page) { if (existing.pages.indexOf(page) === -1) existing.pages.push(page); });
          existing.pages.sort(function (a, b) { return a - b; });
        }
      });
      var items = Array.from(byKey.values());
      // Most cited first; ties keep the server's order, then the live order.
      items.sort(function (a, b) { return (b.citeCount - a.citeCount) || (a.firstSeen - b.firstSeen); });
      items.forEach(function (item) { delete item.firstSeen; });
      return { key: pair[0], label: pair[1], items: items };
    }).filter(function (g) { return g.items.length > 0; });

    return {
      groups: groups,
      total: groups.reduce(function (sum, g) { return sum + g.items.length; }, 0),
      citationCount: ((server && server.citationCount) || 0) + ((live && live.citationCount) || 0)
    };
  }

  // ---------------------------------------------------------------------------
  // Outputs
  // ---------------------------------------------------------------------------

  // Badge text and lex-badge color per operation or status.
  var STATUS_BADGES = {
    created: ['Created', 'green'],
    updated: ['Updated', 'blue'],
    completed: ['Completed', 'green'],
    deleted: ['Deleted', 'red'],
    applied: ['Applied', 'green'],
    saved: ['Saved', 'green'],
    saved_as_draft: ['Draft', 'gray'],
    draft: ['Draft', 'gray'],
    pending: ['Pending', 'yellow'],
    approved: ['Approved', 'green'],
    rejected: ['Rejected', 'red'],
    denied: ['Denied', 'red'],
    failed: ['Failed', 'red'],
    cancelled: ['Cancelled', 'gray'],
    canceled: ['Cancelled', 'gray'],
    expired: ['Expired', 'gray']
  };

  function statusBadge(status) {
    var key = str(status).toLowerCase();
    if (!key) return null;
    var known = STATUS_BADGES[key];
    return known ? { label: known[0], color: known[1] } : { label: humanize(key), color: 'gray' };
  }

  var KIND_LABELS = { draft: 'Draft', document: 'Document', approval: 'Approval' };

  /**
   * One row of GET /outputs (an entity change, a draft, a document saved
   * from a draft, or an approval) as the Outputs card renders it.
   */
  function outputItem(raw, live) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var kind = str(r.kind) || 'entity_change';
    var entityType = str(r.entity_type);
    var entityId = str(r.entity_id);
    var operation = str(r.operation);
    var canonical = r.canonical_document && typeof r.canonical_document === 'object' ? r.canonical_document : null;
    var status = str(r.status) || (canonical ? str(canonical.status) : '');
    var label = str(r.label) || (canonical ? str(canonical.filename) : '') || humanize(entityType) || 'Output';
    // An entity change says what happened to the record; the others say
    // where they stand.
    var badge = kind === 'entity_change' ? statusBadge(operation || status) : statusBadge(status);
    var matchKey = kind === 'entity_change'
      ? ['entity', entityType, entityId, operation].join(':')
      : kind + ':' + (str(r.id) || entityId || label.toLowerCase());
    return {
      key: (live ? 'live:' : '') + (str(r.id) || matchKey),
      matchKey: matchKey,
      kind: kind,
      kindLabel: kind === 'entity_change' ? (humanize(entityType) || 'Record') : (KIND_LABELS[kind] || humanize(kind)),
      label: label,
      entityType: entityType || null,
      operation: operation || null,
      status: status || null,
      badge: badge,
      viewUrl: str(r.view_url) || null,
      createdAt: str(r.created_at) || null,
      live: live === true
    };
  }

  /** A live entity_change (lex-chat-entity-change detail) as an Outputs row. */
  function outputFromEntityChange(detail, receivedAt) {
    var d = detail || {};
    return outputItem({
      kind: 'entity_change',
      label: d.label,
      entity_type: d.entityType || d.entity_type,
      entity_id: d.entityId || d.entity_id,
      operation: d.operation,
      status: 'applied',
      matter_id: d.matterId || d.matter_id,
      view_url: d.viewUrl || d.view_url,
      created_at: receivedAt || null
    }, true);
  }

  /**
   * Server rows plus live rows the server does not hold yet, newest first.
   * @returns {{ items: Array, totals: { items, entityChanges, drafts, documents, approvals } }}
   */
  function mergeOutputs(serverItems, liveItems) {
    var server = (Array.isArray(serverItems) ? serverItems : []);
    var held = new Set(server.map(function (i) { return i.matchKey; }));
    var live = (Array.isArray(liveItems) ? liveItems : []).filter(function (i) { return !held.has(i.matchKey); });
    var items = newestFirst(live.concat(server), 'createdAt');
    var totals = { items: items.length, entityChanges: 0, drafts: 0, documents: 0, approvals: 0 };
    items.forEach(function (i) {
      if (i.kind === 'entity_change') totals.entityChanges += 1;
      else if (i.kind === 'draft') totals.drafts += 1;
      else if (i.kind === 'document') totals.documents += 1;
      else if (i.kind === 'approval') totals.approvals += 1;
    });
    return { items: items, totals: totals };
  }

  function outputsFromServer(payload) {
    return list(unwrap(payload).items).map(function (raw) { return outputItem(raw, false); });
  }

  // ---------------------------------------------------------------------------
  // Activity
  // ---------------------------------------------------------------------------

  var RUN_COLORS = {
    completed: 'green', succeeded: 'green', running: 'blue', in_progress: 'blue', executing: 'blue',
    pending: 'yellow', awaiting_approval: 'yellow', paused: 'yellow', failed: 'red', error: 'red',
    cancelled: 'gray', canceled: 'gray'
  };

  function toolCall(raw, live) {
    var r = raw || {};
    var name = str(r.name) || str(r.toolName) || str(r.tool_name);
    var success = r.success === true ? true : r.success === false ? false : null;
    return {
      key: (live ? 'live:' : '') + [str(r.message_id) || str(r.messageId), str(r.call_id) || str(r.callId), str(r.started_at) || str(r.startedAt), name].join('|'),
      callId: str(r.call_id) || str(r.callId) || null,
      name: name,
      label: str(r.label) || humanize(name) || 'Tool',
      iteration: num(r.iteration),
      status: success === true ? 'done' : success === false ? 'failed' : 'running',
      durationMs: num(r.duration_ms !== undefined ? r.duration_ms : r.durationMs),
      summary: str(r.summary) || null,
      startedAt: str(r.started_at) || str(r.startedAt) || null,
      live: live === true
    };
  }

  /** GET /activity/history as the Activity card renders it. */
  function activityView(payload) {
    var p = unwrap(payload);
    var ar = p.active_response && typeof p.active_response === 'object' ? p.active_response : null;
    var runs = list(p.runs).map(function (run) {
      var status = str(run.status).toLowerCase();
      return {
        key: 'run:' + (str(run.id) || str(run.started_at)),
        id: str(run.id) || null,
        title: str(run.title) || 'Agent run',
        status: status || null,
        badge: status ? { label: humanize(status), color: RUN_COLORS[status] || 'gray' } : null,
        stepsCompleted: num(run.steps_completed),
        totalSteps: num(run.total_steps),
        startedAt: str(run.started_at) || null,
        completedAt: str(run.completed_at) || null
      };
    });
    return {
      active: p.active === true,
      activeResponse: ar ? {
        startedAt: str(ar.started_at) || null,
        durationSeconds: num(ar.duration_seconds),
        clientDisconnected: ar.client_disconnected === true
      } : null,
      runs: newestFirst(runs, 'startedAt'),
      calls: newestFirst(list(p.tool_calls).map(function (c) { return toolCall(c, false); }), 'startedAt')
    };
  }

  /**
   * Pair a live tool event with the calls so far (returns a new array, in
   * arrival order). An end pairs with the running call of the same call id;
   * without a call id (older streams) it pairs with the latest running call
   * of the same tool.
   * @param {Array} calls
   * @param {{ phase: 'start'|'end', callId?, toolName?, label?, iteration?,
   *   startedAt?, success?, durationMs?, summary? }} event
   */
  function applyToolEvent(calls, event) {
    var next = Array.isArray(calls) ? calls.slice() : [];
    var e = event || {};
    var callId = str(e.callId);
    var name = str(e.toolName);
    if (e.phase === 'start') {
      next.push(toolCall({ callId: callId, toolName: name, label: e.label, iteration: e.iteration, startedAt: e.startedAt }, true));
      return next;
    }
    for (var i = next.length - 1; i >= 0; i--) {
      var c = next[i];
      if (c.status !== 'running') continue;
      if (callId ? c.callId === callId : (!c.callId && c.name === name)) {
        next[i] = Object.assign({}, c, {
          status: e.success === false ? 'failed' : 'done',
          durationMs: num(e.durationMs),
          summary: str(e.summary) || null,
          label: str(e.label) || c.label,
          iteration: num(e.iteration) !== null ? num(e.iteration) : c.iteration
        });
        return next;
      }
    }
    next.push(toolCall({
      callId: callId, toolName: name, label: e.label, iteration: e.iteration, startedAt: e.startedAt,
      success: e.success !== false, durationMs: e.durationMs, summary: e.summary
    }, true));
    return next;
  }

  /**
   * Stored history plus the live calls of the turn in progress, newest
   * first. A live call the server already holds (same call id and start
   * time) is dropped.
   */
  function mergeActivity(server, liveCalls, liveRunning) {
    var view = server || { active: false, activeResponse: null, runs: [], calls: [] };
    var held = new Set(view.calls.filter(function (c) { return c.callId && c.startedAt; })
      .map(function (c) { return c.callId + '|' + c.startedAt; }));
    var live = (Array.isArray(liveCalls) ? liveCalls : []).filter(function (c) {
      return !(c.callId && c.startedAt && held.has(c.callId + '|' + c.startedAt));
    });
    return {
      running: liveRunning === true || view.active === true,
      activeResponse: view.activeResponse,
      runs: view.runs,
      calls: live.slice().reverse().concat(view.calls)
    };
  }

  // ---------------------------------------------------------------------------
  // Deep links
  // ---------------------------------------------------------------------------

  function decodePart(part) {
    try { return decodeURIComponent(part); } catch (_) { return part; }
  }

  /**
   * A backend view_url ("/matters/<m>/tasks/<id>", "/approvals/<id>", ...)
   * as a client page for Lex.Nav.go, or null when the client has no page
   * for it (a contact or calendar event outside a workspace, a note
   * outside a workspace).
   * @returns {{ page: string, params: Object, context?: Object }|null}
   */
  function viewUrlTarget(viewUrl) {
    var url = str(viewUrl);
    if (!url || url.charAt(0) !== '/' || url.charAt(1) === '/') return null;
    var path = url.split('#')[0].split('?')[0];
    var parts = path.substring(1).split('/').filter(Boolean).map(decodePart);
    var id = parts[1] || '';
    if (!id) return null;
    switch (parts[0]) {
      case 'approvals':
        return { page: 'approval-detail.html', params: { id: id } };
      case 'tasks':
        return { page: 'my-tasks.html', params: { task: id } };
      case 'documents':
        return { page: 'file-viewer.html', params: { id: id } };
      case 'matters': {
        var sub = parts[2] || '';
        var subId = parts[3] || '';
        var context = { matterId: id };
        if (sub === 'documents' && subId) return { page: 'file-viewer.html', params: { id: subId, matter_id: id }, context: context };
        if (sub === 'tasks' && subId) return { page: 'workspace-details.html', params: { id: id, task: subId }, context: context };
        if (sub === 'notes' || sub === 'comments') return { page: 'workspace-details.html', params: { id: id, tab: sub }, context: context };
        return { page: 'workspace-details.html', params: { id: id }, context: context };
      }
      default:
        return null;
    }
  }

  Lex.Chat = Lex.Chat || {};
  Lex.Chat.SidePanelData = {
    unwrap: unwrap,
    contextView: contextView,
    sourcesFromServer: sourcesFromServer,
    mergeSources: mergeSources,
    outputItem: outputItem,
    outputsFromServer: outputsFromServer,
    outputFromEntityChange: outputFromEntityChange,
    mergeOutputs: mergeOutputs,
    activityView: activityView,
    applyToolEvent: applyToolEvent,
    mergeActivity: mergeActivity,
    viewUrlTarget: viewUrlTarget,
    formatTokens: formatTokens,
    formatPercent: formatPercent,
    formatDuration: formatDuration
  };
})(typeof window !== 'undefined' ? window : globalThis);

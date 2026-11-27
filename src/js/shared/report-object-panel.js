/* The record side panel: any data object on a dashboard or report (a deal,
   a person, a contact, an appointment...) opens here, on the side, and can
   expand to full view (lex-drawer's own expand). People and deals link to
   each other inside the panel with Back; Esc closes (lex-drawer).

   Data: GET /api/v1/report-objects/:object/:id with the page's dates
   (api.getReportObject), read through js/shared/report-objects.js, which
   allowlists what shows and never renders anything that looks like a
   secret. When the record cannot load, a calm message and the row's own
   fields stand in.

   Usage:
     LanaRecordPanel.open(ref, { period: { start, end }, row })
     LanaRecordPanel.bindRows(container, getPeriod)  // [data-record-ref] rows
*/
(function (global) {
  'use strict';

  var state = { drawer: null, stack: [], options: {} };

  function model() { return global.ReportObjects; }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
      .split('"').join('&quot;').split("'").join('&#39;');
  }

  function refButton(ref, label, cls) {
    var attr = ref ? model().refAttr(ref) : '';
    if (!attr) return '<span class="' + (cls || '') + '">' + escapeHtml(label) + '</span>';
    return '<button type="button" class="rp-link ' + (cls || '') + '" data-record-ref="' + escapeHtml(attr) + '">' + escapeHtml(label) + '</button>';
  }

  function factsHtml(facts) {
    if (!facts.length) return '';
    return '<dl class="rp-facts">' + facts.map(function (f) {
      var value = f.href ? '<a href="' + escapeHtml(f.href) + '">' + escapeHtml(f.text) + '</a>' : escapeHtml(f.text);
      return '<div class="rp-fact"><dt>' + escapeHtml(f.label) + '</dt><dd>' + value + '</dd></div>';
    }).join('') + '</dl>';
  }

  function section(title, body, cls) {
    return body ? '<section class="rp-section ' + (cls || '') + '"><h3 class="rp-section__title">' + escapeHtml(title) + '</h3>' + body + '</section>' : '';
  }

  function viewHtml(m) {
    var parts = [];
    parts.push(factsHtml(m.facts));
    if (m.account) {
      parts.push(section('LANA account', '<p class="rp-state">' + escapeHtml(m.account.state) + '</p>'
        + factsHtml(m.account.rows.map(function (r) { return { label: r[0], text: r[1] }; })), 'rp-account'));
    }
    if (m.linked.length) {
      parts.push(section('Linked accounts', '<ul class="rp-list">' + m.linked.map(function (a) {
        return '<li>' + (a.connection ? '<strong>' + escapeHtml(a.connection) + '</strong> ' : '') + escapeHtml(a.name)
          + (a.email ? ' <span class="rp-muted">' + escapeHtml(a.email) + '</span>' : '')
          + (a.matchedBy ? ' <span class="rp-muted">' + escapeHtml(a.matchedBy) + '</span>' : '') + '</li>';
      }).join('') + '</ul>'));
    }
    if (m.activity.length) {
      parts.push(section(m.activityTitle, factsHtml(m.activity.map(function (a) { return { label: a.label, text: a.text }; }))
        + (m.activityNote ? '<p class="rp-muted rp-note">' + escapeHtml(m.activityNote) + '</p>' : '')));
    }
    if (m.timeline.length) {
      parts.push(section('Timeline', timelineHtml(m)));
    }
    if (m.contributors.length) {
      parts.push(section('Who worked on it', '<ul class="rp-list rp-contributors">' + m.contributors.map(function (c) {
        return '<li>' + refButton(c.ref, c.label) + (c.owner ? ' <span class="rp-owner">Owner</span>' : '')
          + (c.follower ? ' <span class="rp-owner rp-follower">Follower</span>' : '')
          + c.did.map(function (d) { return ' <span class="rp-pill">' + escapeHtml(d) + '</span>'; }).join('') + '</li>';
      }).join('') + '</ul>'));
    }
    if (m.links.length) {
      parts.push(section('Related', '<ul class="rp-list">' + m.links.map(function (l) {
        return '<li>' + refButton(l.ref, l.label) + ' <span class="rp-muted">' + escapeHtml(l.kind) + '</span></li>';
      }).join('') + '</ul>'));
    }
    // Fix data in LANA: when the row behind this record carries fix hints
    // and the person may use them (js/shared/data-fixes.js).
    var entry = current();
    var fix = entry && entry.row && global.DataFixes ? global.DataFixes.controlsHtml(entry.row, state.options.permissions || null) : '';
    if (fix) parts.push(section('Fix in LANA', '<p class="rp-muted">Your fix stays in LANA. Your connected system keeps its own value, and syncs never undo the fix.</p>' + fix, 'rp-fix'));
    return parts.join('');
  }

  // Newest first: the latest 10, then "Show all N"; more pages load with
  // timeline_offset when the server has more than it sent.
  var TIMELINE_FIRST = 10;
  var TIMELINE_PAGE = 50;

  function timelineHtml(m) {
    var entry = current() || {};
    var shown = entry.showAll ? m.timeline : m.timeline.slice(0, TIMELINE_FIRST);
    var dividerDone = false;
    var items = shown.map(function (e) {
      var divider = '';
      if (e.beforeDeal && !dividerDone) {
        dividerDone = true;
        divider = '<li class="rp-divider">Before this deal was created</li>';
      }
      var people = e.others.map(function (o) { return refButton(o.ref, o.label); }).join(', ');
      var extra = e.refs.map(function (r) { return refButton(r.ref, r.label); }).join(', ');
      var label = e.main ? refButton(e.main, e.text, 'rp-event') : '<span class="rp-event">' + escapeHtml(e.text) + '</span>';
      return divider + '<li class="rp-event-row"><span class="rp-when">' + escapeHtml(e.when) + '</span> ' + label
        + (e.actor ? ' <span class="rp-muted">by</span> ' + refButton(e.actor.ref, e.actor.label) : '')
        + (e.byOwner ? ' <span class="rp-owner">Owner</span>' : '')
        + (people ? ' <span class="rp-muted">with</span> ' + people : '')
        + (e.detail ? '<span class="rp-muted rp-detail">' + escapeHtml(e.detail) + '</span>' : '')
        + (extra ? '<span class="rp-muted rp-detail">Open: ' + extra + '</span>' : '') + '</li>';
    }).join('');
    var total = Math.max(m.timelineTotal || 0, m.timeline.length);
    var more = '';
    if (!entry.showAll && total > TIMELINE_FIRST) more = '<button type="button" class="rp-back" data-rp-more>Show all ' + total + '</button>';
    else if (entry.showAll && m.timeline.length < total) more = '<button type="button" class="rp-back" data-rp-more>Show ' + Math.min(TIMELINE_PAGE, total - m.timeline.length) + ' more</button>';
    return (m.timelineNote ? '<p class="rp-muted rp-note">' + escapeHtml(m.timelineNote) + '</p>' : '')
      + '<ol class="rp-timeline">' + items + '</ol>' + more;
  }

  // Show every loaded event and fetch the next page when the server has more.
  function showMore() {
    var entry = current();
    if (!entry || !entry.data) return;
    entry.showAll = true;
    var loaded = Array.isArray(entry.data.timeline) ? entry.data.timeline.length : 0;
    var total = Number(entry.data.timeline_total) || loaded;
    redraw();
    if (loaded >= total || entry.loadingMore) return;
    entry.loadingMore = true;
    global.api.getReportObject(entry.ref.object, entry.ref.id, state.options.period || null, { timeline_offset: loaded, timeline_limit: TIMELINE_PAGE })
      .then(function (response) {
        var data = response && response.data !== undefined ? response.data : response;
        if (current() !== entry || !data) return;
        entry.data.timeline = (entry.data.timeline || []).concat(Array.isArray(data.timeline) ? data.timeline : []);
        if (data.timeline_total !== undefined) entry.data.timeline_total = data.timeline_total;
        redraw();
      }, function () { /* the button stays to try again */ })
      .then(function () { entry.loadingMore = false; });
  }

  function modelFor(entry) {
    return model().panelModel(entry.data, { requestedEnd: state.options.period && state.options.period.end });
  }

  function redraw() {
    var entry = current();
    if (!entry || !entry.data) return;
    entry.model = modelFor(entry);
    draw('<p class="rp-kind">' + escapeHtml(entry.model.kind) + '</p>' + viewHtml(entry.model), entry.model.title);
  }

  function current() {
    return state.stack[state.stack.length - 1] || null;
  }

  function backHtml() {
    return state.stack.length > 1 ? '<button type="button" class="rp-back" data-rp-back>Back</button>' : '';
  }

  function draw(html, heading) {
    if (!state.drawer) return;
    if (heading !== undefined) state.drawer.heading = heading;
    state.drawer.contentRoot.innerHTML = '<div class="rp">' + backHtml() + html + '</div>';
  }

  function load() {
    var entry = current();
    if (!entry) return Promise.resolve();
    var kind = model().OBJECT_LABELS[entry.ref.object] || 'Record';
    draw('<p class="rp-loading" role="status">Loading...</p>', kind);
    var api = global.api;
    var request = api && typeof api.getReportObject === 'function'
      ? api.getReportObject(entry.ref.object, entry.ref.id, state.options.period || null)
      : Promise.reject(new Error('No API'));
    return request.then(function (response) {
      if (current() !== entry) return;
      entry.data = response && response.data !== undefined ? response.data : response;
      redraw();
    }, function (err) {
      if (current() !== entry) return;
      var fallback = model().rowModel(entry.row);
      draw('<p class="rp-error" role="status">' + escapeHtml(model().errorText(err)) + '</p>' + factsHtml(fallback.facts), kind);
    });
  }

  function bindDrawer(drawer) {
    drawer.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      if (target.closest('[data-rp-more]')) {
        showMore();
        return;
      }
      if (target.closest('[data-rp-back]')) {
        state.stack.pop();
        load();
        return;
      }
      var link = target.closest('[data-record-ref]');
      if (link) {
        var ref = model().parseRef(link.getAttribute('data-record-ref'));
        if (ref) { state.stack.push({ ref: ref, row: null }); load(); }
      }
    });
    if (global.DataFixes) {
      global.DataFixes.bind(drawer, { onSaved: function (info) {
        var entry = current();
        if (entry && entry.row && info.record) global.DataFixes.applyRecord(entry.row, info.record);
        if (typeof state.options.onSaved === 'function') state.options.onSaved(info);
        if (info.delayMs !== null && info.delayMs !== undefined) setTimeout(function () { if (current() === entry) load(); }, info.delayMs);
      } });
    }
    drawer.addEventListener('lex-close', function () {
      state.drawer = null;
      state.stack = [];
    });
  }

  /** Open a record in the panel (a new panel, or on top of the open one). */
  function open(ref, options) {
    var clean = model() && model().parseRef(model().refAttr(ref));
    if (!clean) return null;
    var opts = options || {};
    if (!state.drawer || !state.drawer.isConnected) {
      state.stack = [];
      state.options = opts;
      // A heading from the start: lex-drawer only draws its header (with
      // close and expand) when it opens with one.
      state.drawer = global.Lex.Drawer.open({ heading: model().OBJECT_LABELS[clean.object] || 'Record', width: 'lg', expandable: true });
      bindDrawer(state.drawer);
    } else {
      if (opts.period) state.options.period = opts.period;
      if (opts.permissions) state.options.permissions = opts.permissions;
    }
    state.stack.push({ ref: clean, row: opts.row || null });
    load();
    return state.drawer;
  }

  /**
   * Rows marked data-record-ref (worklists, bars, tables) open the panel on
   * click or Enter. getPeriod() gives the page's dates; getRow(el) can give
   * the row's own fields for the fallback.
   */
  function bindRows(container, getPeriod, getRow, getPermissions) {
    if (!container || container._recordRowsBound) return;
    container._recordRowsBound = true;
    var handle = function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      // Links and buttons inside a row keep their own behaviour.
      if (target.closest('a, button:not([data-record-ref]), input, select, lex-btn, lex-input, lex-select')) return;
      var el = target.closest('[data-record-ref]');
      if (!el || !container.contains(el)) return;
      var ref = model().parseRef(el.getAttribute('data-record-ref'));
      if (!ref) return;
      event.preventDefault();
      open(ref, {
        period: typeof getPeriod === 'function' ? getPeriod() : null,
        row: typeof getRow === 'function' ? getRow(el) : null,
        permissions: typeof getPermissions === 'function' ? getPermissions(el) : null,
      });
    };
    container.addEventListener('click', handle);
    container.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') handle(event);
    });
  }

  global.LanaRecordPanel = {
    open: open,
    bindRows: bindRows,
    refresh: function () { return load(); },
    _state: state,
  };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * matter-generic-tabs.js
 * Generic tab kinds a makeup can declare (design 7.1): `rulebook` (grouped
 * rows with badges and citations), `records` (a lex-table of server rows)
 * and `ledger` (an append-only list of recorded entries). Each loads
 * GET /api/v1/matters/:matter_id/tabs/:tab_id (shape documented in
 * api/matter-makeup-api.client.js) and opens a server form for a row or tab
 * action. All wording, badges and columns come from the server.
 *
 * An answer with available false shows the server's reason; one with
 * built_in true hands the tab to its built-in renderer (ctx.renderBuiltIn).
 *
 * A row may offer downloads ({ id, label }): the file comes from the tab's
 * download route (client.downloadTabFile, an authenticated fetch) and is
 * saved under the name the server gives it. A refusal reads on the row: 403
 * the tab is not available to this person, 404 the file is not there.
 *
 * Later pages (next_cursor) append rows and groups. A later group whose id is
 * an earlier group's id followed by ':after:<cursor>' continues that group:
 * its rows join it where it sits and its subtitle replaces the earlier one.
 *
 * Registers itself with window.LanaMatterTabRegistry. Renderer context:
 *   { tab, panel, matterId, client: MatterMakeupAPIClient, openForm(action, onRecorded), renderBuiltIn() }
 *
 * Pure helpers (module.exports in Node): TONE_COLORS, badgeColor, safeLinkUrl,
 * mergePage, recordTable, actionAt, downloadAt, downloadName, downloadMessage, DOWNLOAD_MESSAGES.
 * Styles: css/matter-generic-tabs.css.
 */

(function (global) {
  'use strict';

  var TONE_COLORS = { success: 'green', warning: 'yellow', danger: 'red', info: 'blue', neutral: 'gray' };

  function badgeColor(tone) { return TONE_COLORS[tone] || 'gray'; }

  function safeLinkUrl(url) {
    try {
      var parsed = new URL(String(url || ''));
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
    } catch (error) {
      return null;
    }
  }

  function list(value) { return Array.isArray(value) ? value : []; }

  var inNode = typeof module !== 'undefined' && module.exports;
  function tabPage(response) {
    var client = global.MatterMakeupAPIClient || (inNode && require('../api/matter-makeup-api.client.js'));
    return client.tabPage(response);
  }

  // The earlier group a later page's group continues, if any.
  function continuedGroup(groups, group) {
    var id = String((group && group.id) || '');
    return groups.find(function (earlier) {
      var base = String((earlier && earlier.id) || '');
      return base && (id === base || id.indexOf(base + ':after:') === 0);
    }) || null;
  }

  // Appends a later page to what is shown; the server owns the order.
  function mergePage(previous, page) {
    var next = page || {};
    if (!previous) return Object.assign({}, next, { rows: list(next.rows), groups: list(next.groups) });
    var groups = list(previous.groups).map(function (group) { return Object.assign({}, group, { rows: list(group.rows) }); });
    list(next.groups).forEach(function (group) {
      var earlier = continuedGroup(groups, group);
      if (!earlier) { groups.push(Object.assign({}, group, { rows: list(group.rows) })); return; }
      earlier.rows = earlier.rows.concat(list(group.rows));
      if (group.subtitle) earlier.subtitle = group.subtitle; else delete earlier.subtitle;
    });
    return Object.assign({}, previous, {
      rows: list(previous.rows).concat(list(next.rows)),
      groups: groups,
      next_cursor: next.next_cursor || null
    });
  }

  // lex-table columns, labels and flat rows for a `records` tab.
  function recordTable(content) {
    var columns = list(content && content.columns).filter(function (column) { return column && column.key && column.key !== 'actions'; });
    var rows = list(content && content.rows);
    var hasActions = rows.some(function (row) { return list(row.actions).length > 0; });
    var keys = columns.map(function (column) { return column.key; });
    var labels = columns.map(function (column) { return column.label || column.key; });
    if (hasActions) { keys.push('actions'); labels.push('Actions'); }
    return {
      columns: keys,
      labels: labels,
      rows: rows.map(function (row, index) {
        var flat = { id: row.id !== undefined ? String(row.id) : String(index), _index: index };
        columns.forEach(function (column) {
          var cell = row.cells ? row.cells[column.key] : undefined;
          flat[column.key] = cell === undefined || cell === null ? '' : cell;
        });
        if (hasActions) flat.actions = '';
        return flat;
      })
    };
  }

  // Resolves a clicked button back to its action, rows or tab level.
  function actionAt(content, rowIndex, actionIndex, groupIndex) {
    var source;
    if (rowIndex === null || rowIndex === undefined || rowIndex === '') {
      source = list(content && content.actions);
    } else if (groupIndex !== null && groupIndex !== undefined && groupIndex !== '') {
      var group = list(content && content.groups)[Number(groupIndex)];
      var row = group && list(group.rows)[Number(rowIndex)];
      source = row ? list(row.actions) : [];
    } else {
      var flatRow = list(content && content.rows)[Number(rowIndex)];
      source = flatRow ? list(flatRow.actions) : [];
    }
    var action = source[Number(actionIndex)];
    return action && action.form ? action : null;
  }

  function rowAt(content, rowIndex, groupIndex) {
    if (groupIndex !== null && groupIndex !== undefined && groupIndex !== '') {
      var group = list(content && content.groups)[Number(groupIndex)];
      return group ? list(group.rows)[Number(rowIndex)] : null;
    }
    return list(content && content.rows)[Number(rowIndex)] || null;
  }

  // Resolves a clicked download button to { row, download }.
  function downloadAt(content, rowIndex, downloadIndex, groupIndex) {
    var row = rowAt(content, rowIndex, groupIndex);
    var item = row ? list(row.downloads)[Number(downloadIndex)] : null;
    return item && item.id !== undefined && item.id !== null && item.id !== '' ? { row: row, download: item } : null;
  }

  // The saved file name: the server's, else one from the tab and the
  // download id; safe on every platform either way.
  function downloadName(tabId, item, serverName) {
    var safe = function (value) { return String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-'); };
    if (serverName && safe(serverName)) return safe(serverName);
    return (safe([tabId, item && item.id].filter(Boolean).join('-')) || 'download') + '.json';
  }

  var DOWNLOAD_MESSAGES = {
    forbidden: 'This file is not available to you on this matter.',
    notFound: 'This file is no longer here. Reload the tab to see what can be downloaded.',
    failed: 'The download did not finish. Try again.'
  };

  // A refusal the server words (an unavailable tab, a closeout not yet
  // accepted) shows its message; any other 404 means the file is gone.
  function downloadMessage(error) {
    var status = error && error.status;
    if (status === 403) return (error.code === 'TAB_UNAVAILABLE' && error.message) || DOWNLOAD_MESSAGES.forbidden;
    if (status === 404) return (error.code === 'CLOSEOUT_NOT_ACCEPTED' && error.message) || DOWNLOAD_MESSAGES.notFound;
    return DOWNLOAD_MESSAGES.failed;
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  function el(doc, tag, className, text) {
    var element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function badge(doc, item) {
    var element = doc.createElement('lex-badge');
    element.setAttribute('label', item.label || '');
    element.setAttribute('color', badgeColor(item.tone));
    element.setAttribute('size', 'sm');
    return element;
  }

  function actionButtons(doc, actions, position) {
    var wrap = el(doc, 'div', 'matter-generic-tab__actions');
    list(actions).forEach(function (action, index) {
      if (!action || !action.form) return;
      var button = doc.createElement('lex-btn');
      button.setAttribute('variant', position.row === null ? 'primary' : 'secondary');
      button.setAttribute('size', 'sm');
      button.setAttribute('data-tab-action', String(index));
      if (position.row !== null) button.setAttribute('data-tab-row', String(position.row));
      if (position.group !== null) button.setAttribute('data-tab-group', String(position.group));
      button.textContent = action.label || 'Open';
      wrap.appendChild(button);
    });
    return wrap.childNodes.length ? wrap : null;
  }

  function openExternal(url) {
    if (global.electronAPI && typeof global.electronAPI.openExternal === 'function') global.electronAPI.openExternal(url);
    else global.open(url, '_blank', 'noopener,noreferrer');
  }

  function citations(doc, items) {
    var wrap = el(doc, 'div', 'matter-generic-tab__citations');
    list(items).forEach(function (citation) {
      var url = safeLinkUrl(citation.url);
      if (!url) { wrap.appendChild(el(doc, 'p', 'matter-generic-tab__citation', citation.label)); return; }
      var link = el(doc, 'a', 'matter-generic-tab__citation matter-generic-tab__citation--link', citation.label || url);
      link.href = url;
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', function (event) { event.preventDefault(); openExternal(url); });
      wrap.appendChild(link);
    });
    return wrap.childNodes.length ? wrap : null;
  }

  function formatWhen(value) {
    var utils = global.Lex && global.Lex.Utils;
    return utils && utils.formatDateTime ? utils.formatDateTime(value) : String(value);
  }

  // One row as a card-like article: rulebook rules and ledger entries.
  function rowArticle(doc, row, position) {
    var article = el(doc, 'article', 'matter-generic-tab__row');
    var head = el(doc, 'div', 'matter-generic-tab__row-head');
    head.appendChild(el(doc, 'strong', 'matter-generic-tab__row-title', row.title || row.id || ''));
    var badges = list(row.badges).concat(row.status ? [row.status] : []);
    if (badges.length) {
      var badgeWrap = el(doc, 'div', 'matter-generic-tab__badges');
      badges.forEach(function (item) { badgeWrap.appendChild(badge(doc, item)); });
      head.appendChild(badgeWrap);
    }
    article.appendChild(head);
    var meta = [row.recorded_at ? formatWhen(row.recorded_at) : '', row.recorded_by || ''].filter(Boolean).join(' · ');
    if (meta) article.appendChild(el(doc, 'p', 'matter-generic-tab__meta', meta));
    if (row.summary) article.appendChild(el(doc, 'p', 'matter-generic-tab__summary', row.summary));
    list(row.details).forEach(function (detail) { article.appendChild(el(doc, 'p', 'matter-generic-tab__detail', detail)); });
    var refs = list(row.references);
    if (refs.length) {
      var refWrap = el(doc, 'div', 'matter-generic-tab__refs');
      refs.forEach(function (ref) { refWrap.appendChild(el(doc, 'span', 'matter-generic-tab__ref', ref.label)); });
      article.appendChild(refWrap);
    }
    var cites = citations(doc, row.citations);
    if (cites) article.appendChild(cites);
    var buttons = actionButtons(doc, row.actions, position);
    var downloads = downloadButtons(doc, row.downloads, position);
    if (downloads) {
      buttons = buttons || el(doc, 'div', 'matter-generic-tab__actions');
      buttons.appendChild(downloads);
    }
    if (buttons) article.appendChild(buttons);
    return article;
  }

  function downloadButtons(doc, downloads, position) {
    var items = list(downloads).filter(function (item) { return item && item.id !== undefined && item.id !== null && item.id !== ''; });
    if (!items.length) return null;
    var frag = doc.createDocumentFragment();
    list(downloads).forEach(function (item, index) {
      if (items.indexOf(item) === -1) return;
      var button = doc.createElement('lex-btn');
      button.setAttribute('variant', 'ghost');
      button.setAttribute('size', 'sm');
      button.setAttribute('leading-icon', 'download');
      button.setAttribute('data-tab-download', String(index));
      button.setAttribute('data-tab-row', String(position.row));
      if (position.group !== null) button.setAttribute('data-tab-group', String(position.group));
      button.textContent = item.label || 'Download';
      frag.appendChild(button);
    });
    return frag;
  }

  function saveBlob(doc, name, blob) {
    var view = doc.defaultView;
    var url = view.URL.createObjectURL(blob);
    var anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    view.setTimeout(function () { view.URL.revokeObjectURL(url); }, 1000);
  }

  // The row's download message, under its buttons.
  function downloadNotice(button, message) {
    var article = button.closest('.matter-generic-tab__row');
    if (!article) return;
    var note = article.querySelector('[data-tab-download-notice]');
    if (!note) {
      note = el(article.ownerDocument, 'p', 'matter-generic-tab__meta matter-generic-tab__download-notice');
      note.setAttribute('data-tab-download-notice', '');
      article.appendChild(note);
    }
    note.textContent = message;
  }

  function clearDownloadNotice(button) {
    var article = button.closest('.matter-generic-tab__row');
    var note = article && article.querySelector('[data-tab-download-notice]');
    if (note) note.remove();
  }

  function header(doc, content) {
    var wrap = el(doc, 'div', 'matter-generic-tab__header');
    if (content.description) wrap.appendChild(el(doc, 'p', 'matter-generic-tab__description', content.description));
    if (content.notice) wrap.appendChild(el(doc, 'p', 'matter-generic-tab__notice', content.notice));
    var buttons = actionButtons(doc, content.actions, { row: null, group: null });
    if (buttons) wrap.appendChild(buttons);
    return wrap.childNodes.length ? wrap : null;
  }

  function emptyState(doc, message, description) {
    var empty = doc.createElement('lex-empty');
    empty.setAttribute('message', message);
    if (description) empty.setAttribute('description', description);
    return empty;
  }

  function escapeHtml(value) {
    var utils = global.Lex && global.Lex.Utils;
    if (utils && utils.escapeHtml) return utils.escapeHtml(String(value));
    return String(value).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;').split("'").join('&#39;');
  }

  var BODIES = {
    records: function (doc, content, host) {
      var model = recordTable(content);
      if (!model.rows.length) { host.appendChild(emptyState(doc, 'Nothing here yet', '')); return; }
      var table = doc.createElement('lex-table');
      table.setAttribute('columns', model.columns.join(','));
      table.setAttribute('labels', model.labels.join(','));
      table.setAttribute('compact', '');
      host.appendChild(table);
      if (typeof table.setCellRenderers === 'function' && model.columns.indexOf('actions') !== -1) {
        table.setCellRenderers({
          actions: function (value, row) {
            var actions = list(list(content.rows)[row._index] && list(content.rows)[row._index].actions);
            return '<div class="matter-generic-tab__actions">' + actions.map(function (action, index) {
              return '<lex-btn variant="secondary" size="sm" data-tab-row="' + row._index + '" data-tab-action="' + index + '">' + escapeHtml(action.label || 'Open') + '</lex-btn>';
            }).join('') + '</div>';
          }
        });
      }
      if (typeof table.setData === 'function') table.setData(model.rows);
    },
    rulebook: function (doc, content, host) {
      var groups = list(content.groups);
      if (!groups.length) { host.appendChild(emptyState(doc, 'Nothing here yet', '')); return; }
      groups.forEach(function (group, groupIndex) {
        var section = el(doc, 'section', 'matter-generic-tab__group');
        section.appendChild(el(doc, 'h3', 'matter-generic-tab__group-title', group.title || group.id || ''));
        if (group.subtitle) section.appendChild(el(doc, 'p', 'matter-generic-tab__meta', group.subtitle));
        list(group.rows).forEach(function (row, rowIndex) {
          section.appendChild(rowArticle(doc, row, { row: rowIndex, group: groupIndex }));
        });
        host.appendChild(section);
      });
    },
    ledger: function (doc, content, host) {
      var rows = list(content.rows);
      if (!rows.length) { host.appendChild(emptyState(doc, 'Nothing recorded yet', '')); return; }
      var feed = el(doc, 'div', 'matter-generic-tab__ledger');
      rows.forEach(function (row, rowIndex) { feed.appendChild(rowArticle(doc, row, { row: rowIndex, group: null })); });
      host.appendChild(feed);
    }
  };

  function renderer(kind) {
    return function (ctx) {
      var panel = ctx.panel;
      if (!panel) return;
      var doc = panel.ownerDocument;
      var generation = (Number(panel.getAttribute('data-generation')) || 0) + 1;
      panel.setAttribute('data-generation', String(generation));
      var content = null;

      function current() { return Number(panel.getAttribute('data-generation')) === generation; }

      function draw() {
        var root = el(doc, 'div', 'matter-generic-tab matter-generic-tab--' + kind);
        var top = header(doc, content);
        if (top) root.appendChild(top);
        var body = el(doc, 'div', 'matter-generic-tab__body');
        BODIES[kind](doc, content, body);
        root.appendChild(body);
        if (content.next_cursor) {
          var more = doc.createElement('lex-btn');
          more.setAttribute('variant', 'secondary');
          more.setAttribute('data-tab-more', '');
          more.textContent = 'Load more';
          root.appendChild(more);
        }
        panel.replaceChildren(root);
      }

      async function load(cursor) {
        try {
          var page = tabPage(await ctx.client.getTab(ctx.matterId, ctx.tab.id, cursor));
          if (!current()) return;
          if (page.state === 'unavailable') {
            content = null;
            panel.replaceChildren(emptyState(doc, 'This section is not available', page.reason));
            return;
          }
          if (page.state === 'built_in') { content = null; ctx.renderBuiltIn(); return; }
          content = mergePage(cursor ? content : null, page.content);
          draw();
        } catch (error) {
          if (!current()) return;
          panel.replaceChildren(emptyState(doc, 'This section could not be loaded', (error && error.message) || ''));
        }
      }

      async function download(button) {
        var found = downloadAt(content, button.getAttribute('data-tab-row'), button.getAttribute('data-tab-download'), button.getAttribute('data-tab-group'));
        if (!found || button.disabled) return;
        button.disabled = true;
        try {
          var file = await ctx.client.downloadTabFile(ctx.matterId, ctx.tab.id, found.download.id);
          saveBlob(doc, downloadName(ctx.tab.id, found.download, file.filename), file.blob);
          clearDownloadNotice(button);
        } catch (error) {
          downloadNotice(button, downloadMessage(error));
        } finally {
          button.disabled = false;
        }
      }

      panel.onclick = function (event) {
        var target = event.target && event.target.closest && event.target.closest('[data-tab-action],[data-tab-more],[data-tab-download]');
        if (!target || !content) return;
        if (target.hasAttribute('data-tab-more')) { load(content.next_cursor); return; }
        if (target.hasAttribute('data-tab-download')) { download(target); return; }
        var action = actionAt(content, target.getAttribute('data-tab-row'), target.getAttribute('data-tab-action'), target.getAttribute('data-tab-group'));
        if (action) ctx.openForm(action, function () { if (current()) load(null); });
      };

      panel.replaceChildren(doc.createElement('lex-spinner'));
      return load(null);
    };
  }

  var moduleApi = {
    TONE_COLORS: TONE_COLORS,
    badgeColor: badgeColor,
    safeLinkUrl: safeLinkUrl,
    mergePage: mergePage,
    recordTable: recordTable,
    actionAt: actionAt,
    downloadAt: downloadAt,
    downloadName: downloadName,
    downloadMessage: downloadMessage,
    DOWNLOAD_MESSAGES: DOWNLOAD_MESSAGES,
    renderer: renderer
  };

  if (global && global.LanaMatterTabRegistry) {
    ['rulebook', 'records', 'ledger'].forEach(function (kind) { global.LanaMatterTabRegistry.register(kind, renderer(kind)); });
  }
  if (inNode) module.exports = moduleApi;
  if (global) global.LanaMatterGenericTabs = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * matter-runnables-panel.js
 * The matter's "Agents and skills" drawer (design 4.1 runnables, 6.3
 * readiness, 14 run history) and the "Why did this run?" dialog.
 *
 * Thin DOM over the pure modules: shared/matter-runnables.js (runnable and
 * readiness views), shared/run-history.js (outcomes and chains). Transport
 * is api/matter-makeup-api.client.js. Styles: css/matter-runnables.css.
 *
 * Public API (window.LanaMatterRunnablesPanel):
 *   - open(deps)                         -> lex-drawer
 *   - openCausation(deps, runKind, runId, row?) -> lex-modal; a refused start
 *     has no run id, so its row is shown as it came in the history list
 *     deps: { client, matterId (code), matterRef (uuid or code), makeup,
 *             tabs, goToTab(tabId), openForm(action, onRecorded),
 *             onChanged(), onMakeup(makeup), notify(kind, text) }
 *     The drawer reads the makeup view again (client.getMakeup) when it opens
 *     and after a start, and hands it to onMakeup.
 */

(function (global) {
  'use strict';

  function runnables() { return global.LanaMatterRunnables; }
  function history() { return global.LanaRunHistory; }

  function el(doc, tag, className, textValue) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (textValue !== undefined && textValue !== null) node.textContent = String(textValue);
    return node;
  }

  function badge(doc, label, tone) {
    var node = doc.createElement('lex-badge');
    node.setAttribute('label', label);
    node.setAttribute('color', tone || 'gray');
    node.setAttribute('size', 'sm');
    return node;
  }

  function button(doc, label, variant, attrs) {
    var node = doc.createElement('lex-btn');
    node.setAttribute('size', 'sm');
    node.setAttribute('variant', variant || 'secondary');
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    node.textContent = label;
    return node;
  }

  function when(value) {
    var utils = global.Lex && global.Lex.Utils;
    if (!value) return '';
    return utils && utils.formatDateTime ? utils.formatDateTime(value) : String(value);
  }

  function notify(deps, kind, message) {
    if (deps.notify) { deps.notify(kind, message); return; }
    var toast = global.Lex && global.Lex.Toast;
    if (toast && toast[kind]) toast[kind](message);
  }

  // -------------------------------------------------------------------------
  // Agents and skills
  // -------------------------------------------------------------------------

  function icon(doc, name, className) {
    var node = el(doc, 'span', className);
    node.setAttribute('aria-hidden', 'true');
    var icons = global.Lex && global.Lex.Icons;
    if (icons && typeof icons.get === 'function') node.innerHTML = String(icons.get({ name: name, size: 'small' }));
    return node;
  }

  // A quiet show/hide line: a ghost button whose chevron turns when open
  // (css: .matter-runnables__disclosure[aria-expanded="true"]).
  function disclosure(doc, label, attrs) {
    var node = button(doc, label, 'ghost', Object.assign({ 'trailing-icon': 'chevron-right', 'aria-expanded': 'false' }, attrs || {}));
    node.classList.add('matter-runnables__disclosure');
    return node;
  }

  function setExpanded(node, open) {
    node.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function fixButton(doc, fix, deps, host, closeDrawer) {
    var btn = fix.iconOnly
      ? button(doc, '', 'ghost', { 'data-fix': fix.type, icon: '', 'leading-icon': 'arrow-up-right', 'aria-label': fix.label, title: fix.label })
      : button(doc, fix.label, 'ghost', fix.title ? { 'data-fix': fix.type, title: fix.title } : { 'data-fix': fix.type });
    btn.addEventListener('click', function () {
      if (fix.type === 'tab') {
        closeDrawer();
        if (deps.goToTab) deps.goToTab(fix.tab);
        return;
      }
      if (deps.openForm) deps.openForm({ form: fix.form, subject: fix.subject }, function () { if (host._reload) host._reload(); });
    });
    return btn;
  }

  // One line per check: icon, label (and why it was not checked), count, fix.
  // Not checked comes last, muted.
  function renderReadiness(doc, host, model, deps, closeDrawer) {
    host.replaceChildren();
    if (!model.checks.length) {
      host.appendChild(el(doc, 'p', 'matter-runnables__note', model.reason || 'Nothing to check for this agent.'));
      return;
    }
    var head = el(doc, 'div', 'matter-runnables__readiness-head');
    head.appendChild(el(doc, 'span', 'matter-runnables__progress-label', model.progressLabel));
    var bar = doc.createElement('lex-progress-bar');
    bar.setAttribute('value', String(model.progress));
    bar.setAttribute('color', model.status === 'ready' ? 'success' : 'warning');
    bar.setAttribute('size', 'xs');
    bar.className = 'matter-runnables__progress';
    head.appendChild(bar);
    host.appendChild(head);
    var list = el(doc, 'ul', 'matter-runnables__checks');
    model.checks.forEach(function (check) {
      var item = el(doc, 'li', 'matter-runnables__check matter-runnables__check--' + check.status);
      item.setAttribute('data-check', check.code);
      var mark = icon(doc, check.icon, 'matter-runnables__check-icon');
      mark.setAttribute('title', check.statusLabel);
      item.appendChild(mark);
      var label = el(doc, 'span', 'matter-runnables__check-label');
      label.appendChild(el(doc, 'span', 'matter-runnables__check-text', check.text));
      if (check.reason) label.appendChild(el(doc, 'span', 'matter-runnables__check-reason', check.reason));
      item.appendChild(label);
      item.appendChild(el(doc, 'span', 'matter-runnables__check-count', check.counts));
      var fixes = el(doc, 'span', 'matter-runnables__fixes');
      check.fixes.forEach(function (fix) { fixes.appendChild(fixButton(doc, fix, deps, host, closeDrawer)); });
      item.appendChild(fixes);
      list.appendChild(item);
    });
    host.appendChild(list);
    if (model.note) host.appendChild(el(doc, 'p', 'matter-runnables__note', model.note));
  }

  function loadReadiness(doc, host, view, deps, closeDrawer) {
    host._reload = function () { loadReadiness(doc, host, view, deps, closeDrawer); };
    host.replaceChildren(doc.createElement('lex-spinner'));
    return deps.client.getReadiness(deps.matterId, view.ref).then(function (result) {
      renderReadiness(doc, host, runnables().readinessModel(result, deps.tabs), deps, closeDrawer);
    }).catch(function () {
      host.replaceChildren(el(doc, 'p', 'matter-runnables__note', 'The checks could not be loaded. You can still start the agent.'));
    });
  }

  // The start's answer is the card's one status, beside Start, with a link
  // to the run already going when the server names it.
  function showStartStatus(doc, host, result, deps) {
    host.replaceChildren();
    host.hidden = false;
    host.setAttribute('title', result.text);
    host.appendChild(badge(doc, result.label, result.tone));
    if (result.activeRunId) {
      var see = button(doc, 'View run', 'ghost', { 'data-active-run': result.activeRunId });
      see.addEventListener('click', function () { openCausation(deps, 'agent_run', result.activeRunId); });
      host.appendChild(see);
    }
  }

  // Start turned off while the agent's run goes, with that run beside it.
  function setRunning(doc, btn, statusHost, deps, result) {
    statusHost._running = true;
    btn.disabled = true;
    btn.setAttribute('title', result.text);
    showStartStatus(doc, statusHost, result, deps);
  }

  function clearRunning(btn, statusHost) {
    statusHost._running = false;
    btn.disabled = false;
    btn.removeAttribute('title');
    statusHost.replaceChildren();
    statusHost.hidden = true;
  }

  // The makeup view again from the server: each agent card's Start follows
  // its can_start and active_run (the server knows whether a run goes, and
  // when it ended). The page keeps the new view (deps.onMakeup). Only the
  // newest read applies: an older answer arriving late (the open-time read
  // after a start) must not turn Start back on.
  function refreshRunnables(deps) {
    if (!deps.client.getMakeup) return Promise.resolve();
    var gen = ++deps.refreshGen;
    return deps.client.getMakeup(deps.matterId).then(function (makeup) {
      if (gen !== deps.refreshGen || !makeup) return;
      deps.makeup = makeup;
      if (deps.onMakeup) deps.onMakeup(makeup);
      runnables().runnableViews(makeup).forEach(function (view) {
        var apply = deps.startControls && deps.startControls[view.ref];
        if (apply) apply(view);
      });
    }).catch(function () {});
  }

  function startAgent(doc, view, btn, statusHost, deps) {
    btn.loading = true;
    // A read already on its way predates this start.
    deps.refreshGen += 1;
    var settle = function (result, refused) {
      btn.loading = false;
      if (result.running) setRunning(doc, btn, statusHost, deps, result);
      else showStartStatus(doc, statusHost, result, deps);
      if (result.toast) notify(deps, result.kind, result.text);
      if (deps.onRunsChanged && (!refused || result.kind !== 'error')) deps.onRunsChanged();
      return refreshRunnables(deps);
    };
    return deps.client.startAgent(view.key, deps.matterRef, { title: view.name, definitionId: view.definitionId }).then(function (response) {
      return settle(runnables().startResultView(response, view.name), false);
    }, function (error) {
      return settle(runnables().startErrorView(error), true);
    });
  }

  // Start, as the server offers it: shown when can_start, shown turned off
  // while the agent's run goes (view.running), absent otherwise. Returns the
  // function a refreshed view is applied with.
  function startControls(doc, view, controls, statusHost, deps) {
    var current = view;
    var btn = null;
    function apply(next) {
      current = next;
      if (!next.startable && !next.running) {
        if (btn) { btn.remove(); btn = null; }
        if (statusHost._running) { statusHost._running = false; statusHost.replaceChildren(); statusHost.hidden = true; }
        return;
      }
      if (!btn) {
        btn = button(doc, 'Start', 'primary', { 'data-runnable-start': next.key });
        btn.addEventListener('click', function () { if (!btn.disabled) startAgent(doc, current, btn, statusHost, deps); });
        controls.appendChild(btn);
      }
      if (next.running) setRunning(doc, btn, statusHost, deps, next.running);
      else if (statusHost._running) clearRunning(btn, statusHost);
    }
    apply(view);
    return apply;
  }

  function setSkill(view, toggle, enabled, deps) {
    toggle.disabled = true;
    return deps.client.setSkillEnabled(deps.matterId, view.automationId, enabled).then(function () {
      toggle.disabled = false;
      view.enabled = enabled;
      notify(deps, 'success', view.name + (enabled ? ' turned on' : ' turned off'));
      if (deps.onChanged) deps.onChanged();
    }).catch(function (error) {
      toggle.disabled = false;
      toggle.checked = !enabled;
      notify(deps, 'error', runnables().toggleErrorMessage(error));
    });
  }

  // Name and a one-line description on the left; the full text on hover,
  // and in full while the row is open.
  function rowText(doc, view, extra) {
    var box = el(doc, 'div', 'matter-runnables__item-text');
    box.appendChild(el(doc, 'span', 'matter-runnables__name', view.name));
    if (view.triggerSummary) box.appendChild(el(doc, 'span', 'matter-runnables__trigger', view.triggerSummary));
    var line = extra || view.description;
    if (line) {
      var desc = el(doc, 'p', 'matter-runnables__desc', line);
      desc.setAttribute('title', line);
      box.appendChild(desc);
    }
    return box;
  }

  function agentRow(doc, view, deps, closeDrawer) {
    var row = el(doc, 'div', 'matter-runnables__item');
    row.setAttribute('data-runnable', view.ref);
    var head = el(doc, 'div', 'matter-runnables__item-head');
    head.appendChild(rowText(doc, view));
    var controls = el(doc, 'div', 'matter-runnables__controls');
    var statusHost = el(doc, 'div', 'matter-runnables__start-status');
    statusHost.setAttribute('data-start-status', view.key);
    statusHost.hidden = true;
    controls.appendChild(statusHost);
    var apply = startControls(doc, view, controls, statusHost, deps);
    if (deps.startControls) deps.startControls[view.ref] = apply;
    head.appendChild(controls);
    row.appendChild(head);

    if (view.hasReadiness) {
      var details = el(doc, 'div', 'matter-runnables__readiness');
      details.hidden = true;
      var more = disclosure(doc, view.readiness.label, { 'data-readiness-toggle': view.key });
      more.classList.add('matter-runnables__disclosure--' + view.readiness.tone);
      more.addEventListener('click', function () {
        var opening = details.hidden;
        details.hidden = !opening;
        setExpanded(more, opening);
        row.classList.toggle('matter-runnables__item--open', opening);
        if (opening && !details._loaded) { details._loaded = true; loadReadiness(doc, details, view, deps, closeDrawer); }
      });
      row.appendChild(more);
      row.appendChild(details);
    }
    return row;
  }

  function skillRow(doc, view, deps) {
    var row = el(doc, 'div', 'matter-runnables__item');
    row.setAttribute('data-runnable', view.ref);
    var head = el(doc, 'div', 'matter-runnables__item-head');
    head.appendChild(rowText(doc, view, view.toggleable ? '' : (view.description ? '' : 'This skill cannot be changed from here yet.')));
    var controls = el(doc, 'div', 'matter-runnables__controls');
    var toggle = doc.createElement('lex-toggle');
    toggle.setAttribute('data-runnable-toggle', view.key);
    toggle.setAttribute('aria-label', (view.enabled ? 'Turn off ' : 'Turn on ') + view.name);
    toggle.checked = view.enabled;
    if (!view.toggleable) {
      toggle.disabled = true;
      toggle.setAttribute('title', 'This skill cannot be changed from here yet.');
    }
    toggle.addEventListener('lex-change', function (event) {
      var on = Boolean(event.detail && event.detail.value);
      if (on !== view.enabled) setSkill(view, toggle, on, deps);
    });
    controls.appendChild(toggle);
    head.appendChild(controls);
    row.appendChild(head);
    return row;
  }

  // What the organization cannot run: collapsed at the end, the reason on open.
  function unavailableGroup(doc, views) {
    var box = el(doc, 'div', 'matter-runnables__unavailable');
    var list = el(doc, 'div', 'matter-runnables__unavailable-list');
    list.hidden = true;
    var more = disclosure(doc, 'Not available (' + views.length + ')', { 'data-unavailable-toggle': '' });
    more.addEventListener('click', function () {
      list.hidden = !list.hidden;
      setExpanded(more, !list.hidden);
    });
    views.forEach(function (view) {
      var row = el(doc, 'div', 'matter-runnables__item matter-runnables__item--unavailable');
      row.setAttribute('data-runnable', view.ref);
      row.appendChild(rowText(doc, view, view.unavailableText));
      list.appendChild(row);
    });
    box.appendChild(more);
    box.appendChild(list);
    return box;
  }

  function groupHead(doc, title, count) {
    var head = el(doc, 'div', 'matter-runnables__group-head');
    head.appendChild(el(doc, 'h4', 'matter-runnables__group-title', title));
    head.appendChild(el(doc, 'span', 'matter-runnables__group-count', count));
    return head;
  }

  function renderRunnables(doc, pane, deps, closeDrawer) {
    pane.replaceChildren();
    var groups = runnables().runnableGroups(runnables().runnableViews(deps.makeup));
    if (!groups.length) {
      var empty = doc.createElement('lex-empty');
      empty.setAttribute('message', 'No agents or skills');
      empty.setAttribute('description', 'This matter\'s makeup does not turn on any agents or skills.');
      pane.appendChild(empty);
      return;
    }
    groups.forEach(function (group) {
      var section = el(doc, 'section', 'matter-runnables__group');
      section.setAttribute('data-runnables-group', group.kind);
      section.appendChild(groupHead(doc, group.title, group.views.length));
      var list = el(doc, 'div', 'matter-runnables__list');
      group.views.forEach(function (view) {
        list.appendChild(view.kind === 'agent' ? agentRow(doc, view, deps, closeDrawer) : skillRow(doc, view, deps));
      });
      if (group.unavailable.length) list.appendChild(unavailableGroup(doc, group.unavailable));
      section.appendChild(list);
      pane.appendChild(section);
    });
  }

  // -------------------------------------------------------------------------
  // Run history
  // -------------------------------------------------------------------------

  // The run's own trace on the Traces page, for a viewer who can open it
  // (deps.openTrace is set only then; the server still decides).
  function traceButton(doc, traceId, deps) {
    if (!traceId || typeof deps.openTrace !== 'function') return null;
    var node = button(doc, 'Trace', 'ghost', { 'data-run-trace': traceId, 'trailing-icon': 'external-link', 'aria-label': 'Open this run\'s trace' });
    node.addEventListener('click', function () { deps.openTrace(traceId); });
    return node;
  }

  // One status per row: where a started run is now (its state, the owner's
  // status as detail), else the start outcome; where it came from, when it
  // started and finished, muted; the rest (who, the chain) behind Details.
  function runEntry(doc, row, deps) {
    var item = el(doc, 'li', 'matter-runnables__item matter-runnables__run');
    var head = el(doc, 'div', 'matter-runnables__item-head');
    var text = el(doc, 'div', 'matter-runnables__item-text');
    text.appendChild(el(doc, 'span', 'matter-runnables__name', row.title));
    var finished = row.finishedAt ? 'finished ' + when(row.finishedAt) : '';
    text.appendChild(el(doc, 'p', 'matter-runnables__desc', [row.origin, when(row.when), finished].filter(Boolean).join(', ')));
    head.appendChild(text);
    var controls = el(doc, 'div', 'matter-runnables__controls');
    var shown = row.state || row.outcome;
    var status = badge(doc, shown.label, shown.tone);
    status.setAttribute('title', shown.detail);
    status.setAttribute('data-run-status', row.state ? row.state.key : row.outcome.key);
    controls.appendChild(status);
    var trace = traceButton(doc, row.executionTraceId, deps);
    if (trace) controls.appendChild(trace);
    if (row.explainable) {
      var why = button(doc, 'Details', 'ghost', {
        'data-run-why': row.runId ? row.runKind + ':' + row.runId : row.key,
        'aria-label': row.runId ? 'Why did this run?' : 'Why not started?'
      });
      why.addEventListener('click', function () { openCausation(deps, row.runKind, row.runId, row.source); });
      controls.appendChild(why);
    }
    head.appendChild(controls);
    item.appendChild(head);
    return item;
  }

  function loadRuns(doc, pane, deps, cursor) {
    var names = runnables().runnableNames(deps.makeup);
    var list = pane.querySelector('.matter-runnables__runs');
    if (!cursor) {
      pane.replaceChildren(doc.createElement('lex-spinner'));
      list = null;
    }
    return deps.client.getRuns(deps.matterId, cursor).then(function (response) {
      var page = history().runRows(response, names);
      if (!list) {
        pane.replaceChildren();
        if (!page.rows.length) {
          var empty = doc.createElement('lex-empty');
          empty.setAttribute('message', 'No runs yet');
          empty.setAttribute('description', 'Agent and skill runs on this matter, and starts that were refused, show here.');
          pane.appendChild(empty);
          return;
        }
        list = el(doc, 'ul', 'matter-runnables__list matter-runnables__runs');
        pane.appendChild(list);
      }
      page.rows.forEach(function (row) { list.appendChild(runEntry(doc, row, deps)); });
      var old = pane.querySelector('[data-runs-more]');
      if (old) old.remove();
      if (page.nextCursor) {
        var more = button(doc, 'Load more', 'secondary', { 'data-runs-more': '' });
        more.addEventListener('click', function () { more.loading = true; loadRuns(doc, pane, deps, page.nextCursor); });
        pane.appendChild(more);
      }
    }).catch(function () {
      if (!list) pane.replaceChildren(el(doc, 'p', 'matter-runnables__note', 'Run history could not be loaded.'));
      else notify(deps, 'error', 'More runs could not be loaded.');
    });
  }

  // -------------------------------------------------------------------------
  // Drawer
  // -------------------------------------------------------------------------

  function open(deps) {
    var Lex = global.Lex;
    var drawer = Lex.Drawer.open({
      heading: 'Agents and skills',
      width: 'lg',
      content: '<div class="matter-runnables">' +
        '<lex-tabs class="matter-runnables__tabs" variant="underline"></lex-tabs>' +
        '<section class="matter-runnables__pane" data-runnables-pane="runnables"></section>' +
        '<section class="matter-runnables__pane" data-runnables-pane="history" hidden></section>' +
        '</div>'
    });
    var doc = drawer.ownerDocument;
    var root = drawer.contentRoot || drawer;
    var tabs = root.querySelector('.matter-runnables__tabs');
    var runPane = root.querySelector('[data-runnables-pane="runnables"]');
    var historyPane = root.querySelector('[data-runnables-pane="history"]');
    var closeDrawer = function () { drawer.dispatchEvent(new CustomEvent('lex-close', { bubbles: true })); };
    var historyLoaded = false;
    var paneDeps = Object.assign({}, deps, {
      startControls: {},
      refreshGen: 0,
      onRunsChanged: function () { historyLoaded = false; if (!historyPane.hidden) { historyLoaded = true; loadRuns(doc, historyPane, paneDeps); } }
    });

    if (tabs) {
      tabs.tabs = [{ id: 'runnables', label: 'Agents and skills' }, { id: 'history', label: 'Run history' }];
      tabs.active = deps.initialTab === 'history' ? 'history' : 'runnables';
      tabs.addEventListener('tab-change', function (event) { show(event.detail && event.detail.tab); });
    }
    function show(tab) {
      var isHistory = tab === 'history';
      runPane.hidden = isHistory;
      historyPane.hidden = !isHistory;
      if (isHistory && !historyLoaded) { historyLoaded = true; loadRuns(doc, historyPane, paneDeps); }
    }

    renderRunnables(doc, runPane, paneDeps, closeDrawer);
    show(deps.initialTab === 'history' ? 'history' : 'runnables');
    // The page's view may be older than a run that started or ended since.
    refreshRunnables(paneDeps);
    return drawer;
  }

  // -------------------------------------------------------------------------
  // Why did this run?
  // -------------------------------------------------------------------------

  function renderChain(doc, body, model, deps) {
    body.replaceChildren();
    var summary = el(doc, 'div', 'matter-runnables__chain-summary');
    summary.appendChild(badge(doc, model.outcome.label, model.outcome.tone));
    summary.appendChild(el(doc, 'p', 'matter-runnables__note', model.outcome.detail));
    body.appendChild(summary);
    var facts = el(doc, 'dl', 'matter-runnables__facts');
    var now = model.state ? model.state.label + '. ' + model.state.detail : '';
    [['Started from', model.origin], ['Who', model.actor], ['When', when(model.when)], ['Now', now],
      ['Finished', when(model.finishedAt)], ['Trace id', model.traceId]].forEach(function (pair) {
      if (!pair[1]) return;
      facts.appendChild(el(doc, 'dt', 'matter-runnables__fact-label', pair[0]));
      facts.appendChild(el(doc, 'dd', 'matter-runnables__fact-value', pair[1]));
    });
    body.appendChild(facts);
    var trace = traceButton(doc, model.executionTraceId, deps || {});
    if (trace) { trace.textContent = 'Open the run trace'; body.appendChild(trace); }
    body.appendChild(el(doc, 'h4', 'matter-runnables__chain-title', 'Chain, from the first cause to this run'));
    var list = el(doc, 'ol', 'matter-runnables__chain');
    model.steps.forEach(function (step) {
      var item = el(doc, 'li', 'matter-runnables__step' + (step.isLeaf ? ' matter-runnables__step--leaf' : ''));
      item.appendChild(el(doc, 'span', 'matter-runnables__name', step.label));
      item.appendChild(el(doc, 'span', 'matter-runnables__meta', step.kindLabel + (step.isLeaf ? ' · this run' : step.isRoot ? ' · first run' : '')));
      list.appendChild(item);
    });
    body.appendChild(list);
    if (!model.related.length) return;
    body.appendChild(el(doc, 'h4', 'matter-runnables__chain-title', 'Also from the same first cause'));
    var related = el(doc, 'ul', 'matter-runnables__chain');
    model.related.forEach(function (row) {
      var item = el(doc, 'li', 'matter-runnables__step');
      item.appendChild(el(doc, 'span', 'matter-runnables__name', row.title));
      item.appendChild(badge(doc, row.outcome.label, row.outcome.tone));
      item.appendChild(el(doc, 'span', 'matter-runnables__meta', row.kindLabel));
      related.appendChild(item);
    });
    body.appendChild(related);
  }

  function openCausation(deps, runKind, runId, row) {
    var Lex = global.Lex;
    var modal = Lex.Modal.open({
      heading: runId ? 'Why did this run?' : 'Why was this not started?',
      size: 'md',
      content: '<div class="matter-runnables__causation" data-causation-body><lex-spinner label="Loading"></lex-spinner></div>' +
        '<lex-btn data-slot="footer" variant="secondary" data-causation-close>Close</lex-btn>'
    });
    var doc = modal.ownerDocument;
    modal.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('[data-causation-close]')) modal.removeAfterClose();
    });
    var names = runnables().runnableNames(deps.makeup);
    if (!runId && row) {
      var body = modal.querySelector('[data-causation-body]');
      if (body) renderChain(doc, body, history().chainModel(row, names), deps);
      return modal;
    }
    deps.client.getCausation(runKind, runId).then(function (result) {
      var body = modal.querySelector('[data-causation-body]');
      if (body) renderChain(doc, body, history().chainModel(result, names), deps);
    }).catch(function (error) {
      var body = modal.querySelector('[data-causation-body]');
      if (!body) return;
      var message = error && error.status === 404
        ? 'No record of how this run started. Runs from before run history was kept have none.'
        : 'The run record could not be loaded.';
      body.replaceChildren(el(doc, 'p', 'matter-runnables__note', message));
    });
    return modal;
  }

  global.LanaMatterRunnablesPanel = { open: open, openCausation: openCausation };
})(typeof window !== 'undefined' ? window : globalThis);

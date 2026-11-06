/**
 * LANA Briefs: review one proposed action (a task or a note LANA drafted from a meeting),
 * pick the LANA matter it belongs to, and confirm it. Nothing reaches LANA until the
 * person presses the run button; Undo is offered after. Ported from the standalone app's
 * ActionPage. Used by the Dashboard's Needs your attention and by the meeting page.
 *
 *   BriefsActionUI.attach(container);           // once per page, inside the page content
 *   BriefsActionUI.open(actionID, onChanged);   // onChanged() after it saves, runs or undoes
 *
 * The host does the rules (runBlockReason, runTitle, idempotency); this file renders.
 */
(function (global) {
  'use strict';

  const SEARCH_DELAY_MS = 250;

  function bridge() {
    return global.lanaBriefs || null;
  }

  function escape(text) {
    return global.Lex.Utils.escapeHtml(String(text == null ? '' : text));
  }

  function icon(name) {
    const Icons = global.Lex && global.Lex.Icons;
    return Icons && Icons.has(name) ? String(Icons[name].small) : '';
  }

  function clock(seconds) {
    return global.BriefsMeeting ? global.BriefsMeeting.clock(seconds) : '';
  }

  const view = { detail: null, fields: null, query: '', hits: [], searching: false, busy: false, error: null, onChanged: null };
  let modal = null;
  let body = null;
  let searchTimer = null;
  let searchToken = 0;

  async function open(actionID, onChanged) {
    if (!modal) return;
    view.onChanged = onChanged || null;
    view.error = null;
    view.hits = [];
    view.busy = false;
    const result = await call(() => bridge().actions.get(actionID));
    if (!result) return;
    take(result);
    view.query = view.fields.matter ? '' : (view.detail.spokenMatter || '');
    modal.setAttribute('heading', view.detail.typeTitle || 'Proposed action');
    modal.open = true;
    render();
    bridge().actions.markRead(actionID).catch(() => {});
    if (view.query.trim().length >= 2) search(view.query);
  }

  function take(detail) {
    view.detail = detail;
    view.fields = Object.assign({}, detail.fields);
  }

  async function call(work) {
    try {
      const result = await work();
      if (result && result.ok) {
        view.error = null;
        return result.value;
      }
      view.error = (result && result.error && result.error.message) || 'That did not work. Try again.';
    } catch (_) {
      view.error = 'That did not work. Try again.';
    }
    if (modal && modal.open) render();
    return null;
  }

  // ── Matter search ─────────────────────────────────────

  function search(query) {
    if (searchTimer) clearTimeout(searchTimer);
    const text = query.trim();
    if (text.length < 2) {
      view.hits = [];
      view.searching = false;
      renderHits();
      return;
    }
    view.searching = true;
    renderHits();
    searchTimer = setTimeout(async () => {
      const token = ++searchToken;
      let result = null;
      try {
        result = await bridge().matters.search(text);
      } catch (_) {
        result = null;
      }
      if (token !== searchToken) return;
      view.searching = false;
      view.hits = result && result.ok ? result.value : [];
      if (!result || !result.ok) view.error = (result && result.error && result.error.message) || 'LANA could not search matters.';
      renderHits();
    }, SEARCH_DELAY_MS);
  }

  function renderHits() {
    const list = body && body.querySelector('[data-action-hits]');
    if (!list) return;
    if (view.searching) {
      list.innerHTML = '<li class="briefs-act-hit-note"><lex-spinner size="sm"></lex-spinner>Searching LANA</li>';
      return;
    }
    if (view.query.trim().length >= 2 && view.hits.length === 0) {
      list.innerHTML = '<li class="briefs-act-hit-note">No matter matches. Try the client name or the matter number.</li>';
      return;
    }
    list.innerHTML = view.hits.map((hit) => `<li><button type="button" class="briefs-act-hit" data-action-pick="${escape(hit.id)}">
        <span class="briefs-act-hit-label">${escape(hit.label)}</span>
        ${hit.detail ? `<span class="briefs-act-hit-detail">${escape(hit.detail)}</span>` : ''}
      </button></li>`).join('');
  }

  // ── Render ────────────────────────────────────────────

  function phaseHtml(detail) {
    const phase = detail.phase || { kind: 'review' };
    if (phase.kind === 'executed') {
      return `<div class="briefs-act-done lex-rise" role="status">
          <lex-brand-mark animation="success" size="48" label="Done"></lex-brand-mark>
          <div class="briefs-act-done-text">
            <p class="briefs-act-done-title">${detail.kind === 'note' ? 'The note is on the matter in LANA.' : 'The task is on the matter in LANA.'}</p>
            <p class="briefs-act-note">${escape(detail.fields.matter ? detail.fields.matter.label : '')}</p>
          </div>
          <div class="briefs-act-buttons">
            ${detail.lanaURL ? '<lex-btn variant="secondary" size="sm" trailing-icon="chevron-right" data-action-do="lana">Open in LANA</lex-btn>' : ''}
            ${detail.canUndo ? '<lex-btn variant="ghost" size="sm" data-action-do="undo">Undo</lex-btn>' : ''}
          </div>
        </div>`;
    }
    if (phase.kind === 'failed') return `<p class="briefs-meeting-error" role="alert">${escape(phase.reason)}</p>`;
    if (phase.kind === 'undone') return '<p class="briefs-act-note" role="status">Undone. Nothing of it is left in LANA.</p>';
    return '';
  }

  function render() {
    if (!body || !view.detail) return;
    const detail = view.detail;
    const fields = view.fields;
    const editable = detail.isEditable;
    const matter = fields.matter;
    const evidence = (detail.evidence || []).slice(0, 4);
    const isTask = detail.kind === 'task';
    const executed = detail.phase && detail.phase.kind === 'executed';
    body.innerHTML = `
      <p class="briefs-act-origin">${icon('file-text')}<span>${escape(detail.originLabel || '')}</span></p>
      ${evidence.length ? `<section class="briefs-act-evidence" aria-label="What was said">
          <p class="briefs-overline">What was said</p>
          ${evidence.map((item) => `<blockquote class="briefs-act-quote"><span class="briefs-act-quote-who">${escape(item.speaker)} ${escape(clock(item.start))}</span>${escape(item.quote)}</blockquote>`).join('')}
        </section>` : ''}
      <label class="briefs-act-field"><span class="briefs-overline">${escape(detail.titleLabel || 'Title')}</span>
        <input class="briefs-act-input" type="text" data-action-field="title" value="${escape(fields.title)}" ${editable ? '' : 'disabled'} maxlength="300"></label>
      <label class="briefs-act-field"><span class="briefs-overline">${escape(detail.bodyLabel || 'Details')}</span>
        <textarea class="briefs-act-input" rows="4" data-action-field="body" ${editable ? '' : 'disabled'}>${escape(fields.body)}</textarea></label>
      ${isTask ? `<label class="briefs-act-field briefs-act-due"><span class="briefs-overline">Due date</span>
        <input class="briefs-act-input" type="date" data-action-field="dueDate" value="${escape(fields.dueDate || '')}" ${editable ? '' : 'disabled'}></label>` : ''}
      <section class="briefs-act-matter" aria-label="Matter">
        <p class="briefs-overline">Matter in LANA</p>
        ${matter
          ? `<div class="briefs-act-chosen">${icon('folder')}<span class="briefs-act-hit-label">${escape(matter.label)}</span>${editable ? '<lex-btn variant="ghost" size="sm" data-action-do="change">Change</lex-btn>' : ''}</div>`
          : `${detail.spokenMatter ? `<p class="briefs-act-note">The meeting mentioned: ${escape(detail.spokenMatter)}</p>` : ''}
             <input class="briefs-act-input" type="search" data-action-search placeholder="Search LANA matters by client or number" value="${escape(view.query)}" ${editable ? '' : 'disabled'}>
             <ul class="briefs-act-hits" data-action-hits></ul>`}
      </section>
      ${phaseHtml(detail)}
      ${view.error ? `<p class="briefs-meeting-error" role="alert">${escape(view.error)}</p>` : ''}
      ${executed ? '' : `<div class="briefs-act-footer">
          ${detail.runBlockReason && matter ? `<p class="briefs-act-note">${escape(detail.runBlockReason)}</p>` : ''}
          <span class="briefs-act-spacer"></span>
          <lex-btn variant="primary" leading-icon="check" data-action-do="run" ${detail.canRun || (matter && editable) ? '' : 'disabled'} ${view.busy ? 'loading="true"' : ''}>${escape(matter ? (detail.runTitle || 'Confirm') : 'Pick a matter to confirm')}</lex-btn>
        </div>`}`;
    renderHits();
  }

  // ── Actions ───────────────────────────────────────────

  function readFields() {
    const value = (name) => {
      const field = body.querySelector(`[data-action-field="${name}"]`);
      return field ? field.value : null;
    };
    view.fields.title = value('title') != null ? value('title') : view.fields.title;
    view.fields.body = value('body') != null ? value('body') : view.fields.body;
    if (view.detail.kind === 'task') view.fields.dueDate = value('dueDate') || null;
  }

  async function save() {
    readFields();
    const saved = await call(() => bridge().actions.save(view.detail.id, view.fields));
    if (saved) take(saved);
    return saved;
  }

  async function pick(id) {
    const hit = view.hits.find((item) => item.id === id);
    if (!hit) return;
    readFields();
    view.fields.matter = hit;
    view.hits = [];
    const saved = await save();
    if (saved && view.onChanged) view.onChanged();
    render();
  }

  async function run() {
    if (view.busy) return;
    view.busy = true;
    render();
    const saved = view.detail.isEditable ? await save() : view.detail;
    const ran = saved ? await call(() => bridge().actions.run(view.detail.id)) : null;
    view.busy = false;
    if (ran) take(ran);
    render();
    if (view.onChanged) view.onChanged();
  }

  async function undo() {
    const undone = await call(() => bridge().actions.undo(view.detail.id));
    if (undone) take(undone);
    render();
    if (view.onChanged) view.onChanged();
  }

  function openInLana(url) {
    if (!url) return;
    const route = url.replace(/^.*?([a-z-]+\.html.*)$/i, '$1');
    if (global.Lex && global.Lex.Nav && typeof global.Lex.Nav.go === 'function') {
      modal.open = false;
      global.Lex.Nav.go(route);
    }
  }

  function onClick(event) {
    const target = event.target;
    const pickButton = target.closest('[data-action-pick]');
    if (pickButton) return pick(pickButton.dataset.actionPick);
    const button = target.closest('[data-action-do]');
    if (!button || button.hasAttribute('disabled')) return;
    const what = button.dataset.actionDo;
    if (what === 'run') run();
    else if (what === 'undo') undo();
    else if (what === 'lana') openInLana(view.detail.lanaURL);
    else if (what === 'change') {
      readFields();
      view.fields.matter = null;
      view.query = view.detail.spokenMatter || '';
      render();
      const input = body.querySelector('[data-action-search]');
      if (input) input.focus();
      if (view.query.trim().length >= 2) search(view.query);
    }
  }

  function attach(container) {
    modal = document.createElement('lex-modal');
    modal.id = 'briefs-action';
    modal.setAttribute('heading', 'Proposed action');
    modal.setAttribute('size', 'lg');
    modal.setAttribute('hide-actions', '');
    body = document.createElement('div');
    body.className = 'briefs-act';
    modal.appendChild(body);
    container.appendChild(modal);
    body = modal.querySelector('.briefs-act') || body;
    modal.addEventListener('click', (event) => {
      if (body.contains(event.target)) onClick(event);
    });
    modal.addEventListener('input', (event) => {
      if (event.target.matches('[data-action-search]')) {
        view.query = event.target.value;
        search(view.query);
      }
    });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.matches('[data-action-search]') && view.hits.length > 0) {
        event.preventDefault();
        pick(view.hits[0].id);
      }
    });
  }

  global.BriefsActionUI = { attach, open };
})(typeof window !== 'undefined' ? window : globalThis);

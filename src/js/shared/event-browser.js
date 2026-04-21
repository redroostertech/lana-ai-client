(function () {
  'use strict';

  const STYLE_ID = 'lana-event-browser-styles';
  const ROOT_ID = 'lana-event-browser-root';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 90;
        display: none;
      }

      #${ROOT_ID}.open {
        display: block;
      }

      #${ROOT_ID} .event-browser-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(6px);
      }

      #${ROOT_ID} .event-browser-panel {
        position: absolute;
        inset: 18px;
        background: var(--lex-bg-primary, #fff);
        border-radius: 24px;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      #${ROOT_ID} .event-browser-header {
        padding: 20px 24px;
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      #${ROOT_ID} .event-browser-header h2 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 700;
        color: #0f172a;
      }

      #${ROOT_ID} .event-browser-header p {
        margin: 4px 0 0;
        font-size: 0.875rem;
        color: #64748b;
      }

      #${ROOT_ID} .event-browser-close {
        width: 40px;
        height: 40px;
        border: 0;
        border-radius: 999px;
        background: #f1f5f9;
        color: #0f172a;
        font-size: 1.25rem;
        cursor: pointer;
      }

      #${ROOT_ID} .event-browser-search {
        padding: 0 24px 16px;
      }

      #${ROOT_ID} .event-browser-search input {
        width: 100%;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 16px;
        padding: 12px 14px;
        font-size: 0.95rem;
        background: #fff;
        color: #0f172a;
      }

      #${ROOT_ID} .event-browser-body {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: 260px minmax(0, 1fr) 340px;
      }

      #${ROOT_ID} .event-browser-sidebar,
      #${ROOT_ID} .event-browser-list,
      #${ROOT_ID} .event-browser-detail {
        min-height: 0;
        overflow: auto;
      }

      #${ROOT_ID} .event-browser-sidebar {
        padding: 20px 16px;
        border-right: 1px solid rgba(15, 23, 42, 0.08);
        background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
      }

      #${ROOT_ID} .event-browser-sidebar h3,
      #${ROOT_ID} .event-browser-detail h3 {
        margin: 0 0 12px;
        font-size: 0.8rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #64748b;
      }

      #${ROOT_ID} .category-chip {
        display: block;
        width: 100%;
        text-align: left;
        border: 1px solid transparent;
        border-radius: 16px;
        padding: 12px 14px;
        margin-bottom: 8px;
        background: #fff;
        cursor: pointer;
      }

      #${ROOT_ID} .category-chip.active {
        border-color: #c4b5fd;
        background: #f5f3ff;
      }

      #${ROOT_ID} .category-chip strong {
        display: block;
        font-size: 0.93rem;
        color: #0f172a;
        margin-bottom: 4px;
      }

      #${ROOT_ID} .category-chip span {
        display: block;
        font-size: 0.78rem;
        color: #64748b;
        line-height: 1.4;
      }

      #${ROOT_ID} .event-browser-list {
        padding: 20px;
      }

      #${ROOT_ID} .event-group {
        margin-bottom: 24px;
      }

      #${ROOT_ID} .event-group h4 {
        margin: 0 0 12px;
        font-size: 1rem;
        color: #0f172a;
      }

      #${ROOT_ID} .event-card {
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 18px;
        padding: 14px 16px;
        margin-bottom: 10px;
        background: #fff;
        cursor: pointer;
        transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
      }

      #${ROOT_ID} .event-card:hover {
        border-color: #a78bfa;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.07);
        transform: translateY(-1px);
      }

      #${ROOT_ID} .event-card.active {
        border-color: #8b5cf6;
        box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.08);
      }

      #${ROOT_ID} .event-card .event-name {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
      }

      #${ROOT_ID} .event-card strong {
        font-size: 0.95rem;
        color: #0f172a;
      }

      #${ROOT_ID} .event-card code,
      #${ROOT_ID} .event-meta code {
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace;
        font-size: 0.75rem;
        color: #7c3aed;
        background: #f3e8ff;
        border-radius: 999px;
        padding: 3px 8px;
      }

      #${ROOT_ID} .event-card p {
        margin: 0;
        font-size: 0.82rem;
        line-height: 1.5;
        color: #64748b;
      }

      #${ROOT_ID} .event-browser-detail {
        padding: 24px;
        border-left: 1px solid rgba(15, 23, 42, 0.08);
        background: linear-gradient(180deg, #ffffff 0%, #fafafa 100%);
      }

      #${ROOT_ID} .event-meta {
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 20px;
        padding: 18px;
        background: #fff;
      }

      #${ROOT_ID} .event-meta .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 14px;
      }

      #${ROOT_ID} .event-meta .badge {
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 0.72rem;
        background: #f1f5f9;
        color: #334155;
      }

      #${ROOT_ID} .event-meta h4 {
        margin: 0 0 6px;
        font-size: 1.2rem;
        color: #0f172a;
      }

      #${ROOT_ID} .event-meta p {
        margin: 0 0 14px;
        color: #475569;
        font-size: 0.92rem;
        line-height: 1.55;
      }

      #${ROOT_ID} .detail-section {
        margin-top: 16px;
      }

      #${ROOT_ID} .detail-section h5 {
        margin: 0 0 8px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #64748b;
      }

      #${ROOT_ID} ul.detail-list {
        margin: 0;
        padding-left: 18px;
        color: #334155;
        line-height: 1.55;
      }

      #${ROOT_ID} .event-browser-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 20px;
      }

      #${ROOT_ID} .event-browser-actions button {
        border: 0;
        border-radius: 14px;
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 600;
      }

      #${ROOT_ID} .event-browser-actions .secondary {
        background: #e2e8f0;
        color: #0f172a;
      }

      #${ROOT_ID} .event-browser-actions .primary {
        background: #7c3aed;
        color: #fff;
      }

      @media (max-width: 1100px) {
        #${ROOT_ID} .event-browser-body {
          grid-template-columns: 1fr;
        }

        #${ROOT_ID} .event-browser-sidebar,
        #${ROOT_ID} .event-browser-detail {
          border: 0;
          border-top: 1px solid rgba(15, 23, 42, 0.08);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="event-browser-backdrop" data-event-browser-close="true"></div>
      <div class="event-browser-panel" role="dialog" aria-modal="true" aria-labelledby="lana-event-browser-title">
        <div class="event-browser-header">
          <div>
            <h2 id="lana-event-browser-title">Browse Events</h2>
            <p>Search by name, key, category, or use case. Pick the event that matches the workflow stage.</p>
          </div>
          <button type="button" class="event-browser-close" data-event-browser-close="true" aria-label="Close event browser">&times;</button>
        </div>
        <div class="event-browser-search">
          <input type="search" data-event-browser-search placeholder="Search events, categories, or examples...">
        </div>
        <div class="event-browser-body">
          <aside class="event-browser-sidebar">
            <h3>Categories</h3>
            <div data-event-browser-categories></div>
          </aside>
          <section class="event-browser-list">
            <div data-event-browser-results></div>
          </section>
          <aside class="event-browser-detail">
            <h3>Event details</h3>
            <div data-event-browser-detail></div>
          </aside>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  function bindRootEvents(root) {
    if (root._lanaEventBrowserBound) return;
    root._lanaEventBrowserBound = true;

    root.addEventListener('click', (evt) => {
      const closeTarget = evt.target.closest('[data-event-browser-close="true"]');
      if (closeTarget && root._lanaEventBrowserState?.close) {
        root._lanaEventBrowserState.close();
      }
    });

    const searchInput = root.querySelector('[data-event-browser-search]');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const browserState = root._lanaEventBrowserState;
        if (!browserState) return;
        browserState.state.query = searchInput.value;
        const groupsForQuery = browserState.catalog.getGroupedEvents(browserState.state.query);
        if (!groupsForQuery.some((group) => group.key === browserState.state.activeCategory)) {
          browserState.state.activeCategory = groupsForQuery[0]?.key || '';
        }
        browserState.sync();
      });
    }
  }

  function renderListHtml(groups, selectedEventType, onSelect) {
    return groups.map((group) => {
      const cards = group.events.map((event) => {
        const isActive = selectedEventType && selectedEventType === event.event_type ? 'active' : '';
        const useCase = event.common_use_cases[0] || '';
        return `
          <article class="event-card ${isActive}" data-event-key="${escapeHtml(event.event_type)}" tabindex="0">
            <div class="event-name">
              <strong>${escapeHtml(event.friendly_name)}</strong>
              <code>${escapeHtml(event.event_type)}</code>
            </div>
            <p>${escapeHtml(event.description)}</p>
            <p style="margin-top:6px;color:#334155;"><strong>Use case:</strong> ${escapeHtml(useCase)}</p>
          </article>
        `;
      }).join('');

      return `
        <div class="event-group">
          <h4>${escapeHtml(group.label)}</h4>
          ${cards}
        </div>
      `;
    }).join('');
  }

  function renderCategoryChips(groups, activeCategory, onCategoryChange) {
    return groups.map((group) => {
      const active = group.key === activeCategory ? 'active' : '';
      return `
        <button type="button" class="category-chip ${active}" data-event-browser-category="${escapeHtml(group.key)}">
          <strong>${escapeHtml(group.label)}</strong>
          <span>${escapeHtml(group.description)}</span>
        </button>
      `;
    }).join('');
  }

  function renderDetailHtml(meta) {
    if (!meta) {
      return '<p class="muted">Select an event to see details.</p>';
    }

    const renderList = (items) => `<ul class="detail-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    return `
      <div class="event-meta">
        <div class="badge-row">
          <span class="badge">${escapeHtml(meta.category_label)}</span>
          <span class="badge">${escapeHtml(meta.event_type)}</span>
        </div>
        <h4>${escapeHtml(meta.friendly_name)}</h4>
        <p>${escapeHtml(meta.description)}</p>

        <div class="detail-section">
          <h5>When it fires</h5>
          <p>${escapeHtml(meta.when)}</p>
        </div>

        <div class="detail-section">
          <h5>What data is available</h5>
          ${renderList(meta.data_available)}
        </div>

        <div class="detail-section">
          <h5>Common use cases</h5>
          ${renderList(meta.common_use_cases)}
        </div>

        <div class="detail-section">
          <h5>Example workflows</h5>
          ${renderList(meta.example_workflows)}
        </div>

        <div class="event-browser-actions">
          <button type="button" class="secondary" data-event-browser-close="true">Close</button>
          <button type="button" class="primary" data-event-browser-use="true">Use Event</button>
        </div>
      </div>
    `;
  }

  function renderSummaryHtml(eventType) {
    const meta = window.LanaEventCatalog?.getEventMeta(eventType);
    if (!meta) return '<p class="text-sm text-gray-500">Select an event to see details.</p>';
    const list = (items) => `<ul class="mt-1 ml-4 list-disc text-xs text-gray-600">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    return `
      <div class="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap gap-2">
          <span class="px-2 py-1 rounded-full text-xs font-medium bg-violet-100 text-violet-700">${escapeHtml(meta.category_label)}</span>
          <code class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">${escapeHtml(meta.event_type)}</code>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-gray-900">${escapeHtml(meta.friendly_name)}</h4>
          <p class="text-sm text-gray-600 mt-1">${escapeHtml(meta.description)}</p>
        </div>
        <div class="text-xs text-gray-500">
          <p><strong>When it fires:</strong> ${escapeHtml(meta.when)}</p>
          <p class="mt-1"><strong>Common use:</strong> ${escapeHtml(meta.common_use_cases[0] || '')}</p>
          <p class="mt-1"><strong>Data available:</strong></p>
          ${list((meta.data_available || []).slice(0, 4))}
        </div>
      </div>
    `;
  }

  function open(options = {}) {
    ensureStyles();
    const root = ensureRoot();
    const catalog = window.LanaEventCatalog;
    if (!catalog) {
      console.warn('[LanaEventBrowser] Missing LanaEventCatalog');
      return;
    }

    const state = {
      query: options.query || '',
      activeCategory: options.activeCategory || '',
      currentValue: options.currentValue || '',
      onSelect: typeof options.onSelect === 'function' ? options.onSelect : null
    };

    const groups = catalog.getGroupedEvents(state.query);
    state.activeCategory = state.activeCategory || groups[0]?.key || '';
    let selectedMeta = catalog.getEventMeta(state.currentValue) || groups.flatMap((group) => group.events)[0] || null;

    function filteredGroups() {
      const queried = catalog.getGroupedEvents(state.query);
      return state.activeCategory ? queried.filter((group) => group.key === state.activeCategory) : queried;
    }

    function sync() {
      const allGroups = catalog.getGroupedEvents(state.query);
      const currentGroups = state.activeCategory ? allGroups.filter((group) => group.key === state.activeCategory) : allGroups;
      const categoriesEl = root.querySelector('[data-event-browser-categories]');
      const resultsEl = root.querySelector('[data-event-browser-results]');
      const detailEl = root.querySelector('[data-event-browser-detail]');

      if (categoriesEl) {
        categoriesEl.innerHTML = renderCategoryChips(allGroups, state.activeCategory);
      }
      if (resultsEl) {
        resultsEl.innerHTML = renderListHtml(currentGroups, selectedMeta?.event_type || state.currentValue, state.onSelect);
        resultsEl.querySelectorAll('[data-event-key]').forEach((card) => {
          card.addEventListener('click', () => {
            const eventType = card.getAttribute('data-event-key');
            selectedMeta = catalog.getEventMeta(eventType);
            sync();
          });
          card.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
              evt.preventDefault();
              const eventType = card.getAttribute('data-event-key');
              selectedMeta = catalog.getEventMeta(eventType);
              sync();
            }
          });
        });
      }
      if (detailEl) {
        detailEl.innerHTML = renderDetailHtml(selectedMeta);
        const useBtn = detailEl.querySelector('[data-event-browser-use="true"]');
        if (useBtn) {
          useBtn.addEventListener('click', () => {
            if (state.onSelect && selectedMeta) {
              state.onSelect(selectedMeta.event_type, selectedMeta);
            }
            close();
          });
        }
      }

      root.querySelectorAll('[data-event-browser-category]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.activeCategory = btn.getAttribute('data-event-browser-category');
          sync();
        });
      });
    }

    bindRootEvents(root);
    root._lanaEventBrowserState = { state, catalog, sync, close };
    const searchInput = root.querySelector('[data-event-browser-search]');
    if (searchInput) {
      searchInput.value = state.query;
    }

    sync();
    root.classList.add('open');

    const firstButton = root.querySelector('[data-event-browser-search]');
    if (firstButton) firstButton.focus();

    function close() {
      root.classList.remove('open');
    }

    root._closeEventBrowser = close;
  }

  function close() {
    const root = document.getElementById(ROOT_ID);
    if (root && typeof root._closeEventBrowser === 'function') {
      root._closeEventBrowser();
    }
  }

  window.LanaEventBrowser = {
    open,
    close,
    renderSummaryHtml
  };
})();

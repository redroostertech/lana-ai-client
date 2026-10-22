/* ==========================================================================
   Lex UI — <lex-chat-documents>
   Banner listing the documents attached to this chat (removable chips,
   Manage, Clear), plus Lex.Chat.openDocumentsManager(chat): the drawer the
   composer's "Manage chat documents" item opens.
   ========================================================================== */

(function (global) {
  'use strict';

  const { LexElement, ChatFormat } = global.Lex;
  if (!LexElement) { console.error('[lex-chat-documents] LexElement not loaded'); return; }

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-chat-documents-styles';
    style.textContent = `
      lex-chat-documents {
        display: block;
      }
      lex-chat-documents[hidden] {
        display: none !important;
      }

      .lex-chat-docs-banner {
        border-bottom: 1px solid var(--lex-chat-accent-soft);
        background: var(--lex-chat-accent-soft);
        padding: 12px 16px;
      }

      .lex-chat-docs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .lex-chat-docs-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .lex-chat-docs-title-icon {
        width: 16px; height: 16px;
        color: var(--lex-chat-accent);
      }

      .lex-chat-docs-title-text {
        font-size: 13px;
        font-weight: 600;
        color: var(--lex-chat-text);
      }

      .lex-chat-docs-count {
        font-size: 11px;
        color: var(--lex-chat-text-muted);
        margin-left: 4px;
      }

      .lex-chat-docs-exit {
        font-size: 11px;
        font-weight: 500;
        color: var(--lex-chat-text-muted);
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: var(--lex-radius-md, 6px);
        transition: background var(--lex-transition-fast, 0.15s), color var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-docs-exit:hover {
        background: var(--lex-chat-bg-elevated);
        color: var(--lex-chat-text);
      }

      .lex-chat-docs-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }

      .lex-chat-doc-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 11px;
        background: var(--lex-chat-bg-surface);
        border: 1px solid var(--lex-chat-border);
        color: var(--lex-chat-text);
      }

      .lex-chat-doc-chip-icon {
        width: 12px; height: 12px;
        color: var(--lex-chat-accent);
        flex-shrink: 0;
      }

      .lex-chat-doc-chip-name {
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .lex-chat-doc-chip-remove {
        margin-left: 2px;
        width: 12px; height: 12px;
        color: var(--lex-chat-text-dim);
        cursor: pointer;
        background: none; border: none; padding: 0;
        flex-shrink: 0;
        transition: color var(--lex-transition-fast, 0.15s);
      }
      .lex-chat-doc-chip-remove:hover {
        color: var(--lex-color-danger-500, #ef4444);
      }

      .lex-chat-docs-actions {
        display: flex;
        gap: 2px;
      }

      .lex-chat-docmgr {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .lex-chat-docmgr-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .lex-chat-docmgr-heading {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--lex-text-primary);
      }
      .lex-chat-docmgr-count {
        font-weight: 400;
        color: var(--lex-text-tertiary);
      }
      .lex-chat-docmgr-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
      .lex-chat-docmgr-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid var(--lex-border-subtle);
      }
      .lex-chat-docmgr-row .lex-chat-doc-chip-icon {
        width: 16px; height: 16px;
        color: var(--lex-text-secondary);
      }
      .lex-chat-docmgr-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .lex-chat-docmgr-meta {
        margin-left: 6px;
        font-size: 11px;
        color: var(--lex-text-tertiary);
      }
      .lex-chat-docmgr-added {
        font-size: 12px;
        color: var(--lex-text-tertiary);
        padding: 0 8px;
      }
      .lex-chat-docmgr-empty {
        padding: 12px 0;
        font-size: 13px;
        color: var(--lex-text-tertiary);
      }

      .lex-chat-docs-hint {
        font-size: 10px;
        color: var(--lex-chat-text-dim);
        margin-top: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    if (ChatFormat && ChatFormat.escapeHtml) return ChatFormat.escapeHtml(value == null ? '' : String(value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const DOC_ICON = `<svg class="lex-chat-docs-title-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`;
  const CHIP_DOC_ICON = `<svg class="lex-chat-doc-chip-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`;
  const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;

  class LexChatDocuments extends LexElement {

    static get properties() {
      return {
        documents:    { type: Array, default: [] },
        maxDocuments: { type: Number, default: 3, attribute: 'max-documents' }
      };
    }

    connected() {
      injectStyles();
    }

    render() {
      const docs = this.documents || [];
      // Attached documents are the whole signal: there is no separate mode.
      if (docs.length === 0) {
        this.setAttribute('hidden', '');
        return '';
      }

      this.removeAttribute('hidden');

      const chips = docs.map(doc => {
        const name = escapeHtml(doc.filename || doc.name || 'Document');
        const id = escapeHtml(doc.id);
        return `
          <div class="lex-chat-doc-chip">
            ${CHIP_DOC_ICON}
            <span class="lex-chat-doc-chip-name" title="${name}">${name}</span>
            <button class="lex-chat-doc-chip-remove" data-doc-id="${id}" title="Remove ${name}">${CLOSE_ICON}</button>
          </div>`;
      }).join('');

      return `
        <div class="lex-chat-docs-banner">
          <div class="lex-chat-docs-header">
            <div class="lex-chat-docs-title">
              ${DOC_ICON}
              <span class="lex-chat-docs-title-text">Chat documents</span>
              <span class="lex-chat-docs-count">(${docs.length} of ${this.maxDocuments})</span>
            </div>
            <div class="lex-chat-docs-actions">
              <button class="lex-chat-docs-exit" data-manage>Manage</button>
              <button class="lex-chat-docs-exit" data-exit>Clear</button>
            </div>
          </div>
          <div class="lex-chat-docs-chips">${chips}</div>
          <div class="lex-chat-docs-hint">LANA answers using these documents</div>
        </div>`;
    }

    updated() {
      this.delegate('click', '.lex-chat-doc-chip-remove', (e, target) => {
        e.preventDefault();
        this.emit('lex-document-remove', { documentId: target.dataset.docId });
      });

      this.delegate('click', '[data-manage]', (e) => {
        e.preventDefault();
        this.emit('lex-document-manage');
      });

      this.delegate('click', '[data-exit]', (e) => {
        e.preventDefault();
        this.emit('lex-document-exit');
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Manage chat documents drawer
  // ---------------------------------------------------------------------------

  // Opens a drawer over the page for one <lex-chat>. The chat owns the state:
  // getDocuments(), addDocument(), removeDocument(), searchDocuments() and
  // the lex-chat-documents-change event. The drawer only renders it.
  function openDocumentsManager(chat) {
    if (!chat || !global.Lex.Drawer) return null;
    injectStyles();

    const max = chat.maxDocuments || 3;
    const drawer = global.Lex.Drawer.open({
      heading: 'Chat documents',
      subtitle: 'LANA answers this chat using the documents you add here.',
      width: 'md',
      content: `
        <div class="lex-chat-docmgr">
          <section class="lex-chat-docmgr-section">
            <h3 class="lex-chat-docmgr-heading">In this chat <span class="lex-chat-docmgr-count" data-count></span></h3>
            <ul class="lex-chat-docmgr-list" data-current></ul>
          </section>
          <section class="lex-chat-docmgr-section">
            <h3 class="lex-chat-docmgr-heading">Add documents</h3>
            <lex-input type="search" clearable="true" leading-icon="search" placeholder="Search documents" aria-label="Search documents" data-search></lex-input>
            <ul class="lex-chat-docmgr-list" data-results></ul>
          </section>
        </div>`
    });
    const root = drawer.contentRoot || drawer;

    let results = [];
    let resultState = 'loading';
    let searchSeq = 0;
    let searchTimer = null;
    const busy = new Set();

    function attachedIds() {
      return new Set(chat.getDocuments().map(doc => String(doc.id)));
    }

    function row(doc, action) {
      const name = escapeHtml(doc.filename || doc.name || 'Document');
      const id = escapeHtml(doc.id);
      const meta = doc.meta ? `<span class="lex-chat-docmgr-meta">${escapeHtml(doc.meta)}</span>` : '';
      return `
        <li class="lex-chat-docmgr-row">
          ${CHIP_DOC_ICON}
          <span class="lex-chat-docmgr-name" title="${name}">${name}${meta}</span>
          ${action.replace('__ID__', id)}
        </li>`;
    }

    function renderCurrent() {
      const docs = chat.getDocuments();
      const count = root.querySelector('[data-count]');
      if (count) count.textContent = `(${docs.length} of ${max})`;
      const list = root.querySelector('[data-current]');
      if (!list) return;
      list.innerHTML = docs.length
        ? docs.map(doc => row(doc,
            `<lex-btn variant="ghost" size="sm" data-remove="__ID__"${busy.has(String(doc.id)) ? ' disabled' : ''}>Remove</lex-btn>`)).join('')
        : `<li class="lex-chat-docmgr-empty">No documents yet. Add up to ${max} below.</li>`;
    }

    function renderResults() {
      const list = root.querySelector('[data-results]');
      if (!list) return;
      if (resultState === 'loading') {
        list.innerHTML = '<li class="lex-chat-docmgr-empty">Searching…</li>';
        return;
      }
      if (resultState === 'error') {
        list.innerHTML = '<li class="lex-chat-docmgr-empty">Documents could not be loaded. Try again.</li>';
        return;
      }
      if (!results.length) {
        list.innerHTML = '<li class="lex-chat-docmgr-empty">No matching documents.</li>';
        return;
      }
      const attached = attachedIds();
      const full = attached.size >= max;
      list.innerHTML = results.map(doc => {
        const id = String(doc.id);
        if (attached.has(id)) {
          return row(doc, '<span class="lex-chat-docmgr-added">Added</span>');
        }
        const disabled = full || busy.has(id) ? ' disabled' : '';
        const title = full ? ` title="Remove a document first (max ${max})"` : '';
        return row(doc, `<lex-btn variant="secondary" size="sm" data-add="__ID__"${disabled}${title}>Add</lex-btn>`);
      }).join('');
    }

    function render() {
      renderCurrent();
      renderResults();
    }

    async function runSearch(query) {
      const seq = ++searchSeq;
      resultState = 'loading';
      renderResults();
      try {
        const found = await chat.searchDocuments(query, { limit: 20 });
        if (seq !== searchSeq) return;
        results = found;
        resultState = 'ready';
      } catch (_) {
        if (seq !== searchSeq) return;
        results = [];
        resultState = 'error';
      }
      renderResults();
    }

    root.addEventListener('lex-input', (e) => {
      if (!e.target.closest('[data-search]')) return;
      const value = (e.detail && e.detail.value != null) ? e.detail.value : (e.target.value || '');
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(String(value).trim()), 250);
    });

    root.addEventListener('click', async (e) => {
      const add = e.target.closest('[data-add]');
      const remove = e.target.closest('[data-remove]');
      const target = add || remove;
      if (!target || target.hasAttribute('disabled')) return;
      const id = add ? add.dataset.add : remove.dataset.remove;
      busy.add(id);
      render();
      try {
        if (add) {
          const doc = results.find(item => String(item.id) === id);
          if (doc) await chat.addDocument(doc.id, doc.filename || doc.name);
        } else {
          await chat.removeDocument(id);
        }
      } catch (_) {
        // The chat already reported the failure in the thread.
      } finally {
        busy.delete(id);
        render();
      }
    });

    const onChange = () => render();
    chat.addEventListener('lex-chat-documents-change', onChange);
    drawer.addEventListener('lex-close', () => {
      clearTimeout(searchTimer);
      chat.removeEventListener('lex-chat-documents-change', onChange);
    });

    render();
    runSearch('');
    return drawer;
  }

  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.LexChatDocuments = LexChatDocuments;
  global.Lex.Chat.openDocumentsManager = openDocumentsManager;

})(typeof window !== 'undefined' ? window : globalThis);

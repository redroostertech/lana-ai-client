/* Lex UI — Rich Text Editor Component
   Notion-like rich text editor with toolbar, keyboard shortcuts, zero dependencies.
   Uses contenteditable + execCommand / queryCommandState.

   Usage:
     <lex-editor label="Content" placeholder="Start typing..."
       toolbar='["bold","italic","heading","bulletList","orderedList","code","blockquote","link"]'>
     </lex-editor>

   Toolbar options: bold, italic, heading, bulletList, orderedList, code, blockquote, link
   Events: lex-input, lex-change { name, value (HTML) }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-editor-styles';
    style.textContent = `
      lex-editor {
        display: block;
      }

      .lex-editor-container {
        border: none;
        border-radius: var(--lex-input-radius);
        overflow: hidden;
        transition: background 0.2s ease, box-shadow 0.2s ease;
        background: var(--lex-color-gray-50);
      }

      .lex-editor-container:focus-within {
        background: var(--lex-color-gray-50);
        box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500));
      }

      .lex-editor-container--error {
        box-shadow: 0 0 0 2px var(--lex-input-border-error, var(--lex-color-danger-500));
      }

      /* ── Toolbar ───────────────────────────────────────── */

      .lex-editor-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 2px;
        padding: 6px 8px;
        border-bottom: none;
        background: transparent;
      }

      .lex-editor-toolbar-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: var(--lex-radius-sm);
        color: var(--lex-text-secondary, var(--lex-color-brand-500));
        transition: background 0.1s ease, color 0.1s ease;
      }

      .lex-editor-toolbar-btn:hover {
        background: var(--lex-bg-tertiary);
        color: var(--lex-text-primary);
      }

      .lex-editor-toolbar-btn--active {
        background: var(--lex-bg-accent-soft);
        color: var(--lex-text-accent);
      }

      .lex-editor-toolbar-btn svg {
        width: 16px;
        height: 16px;
      }

      .lex-editor-toolbar-sep {
        width: 1px;
        height: 20px;
        background: var(--lex-border-subtle, rgba(0,0,0,0.08));
        margin: 0 4px;
        flex-shrink: 0;
      }

      /* ── Content area ──────────────────────────────────── */

      .lex-editor-content {
        padding: 12px 14px;
        font-size: var(--lex-form-font-size-lg, 0.875rem);
        line-height: 1.65;
        color: var(--lex-input-text, var(--lex-text-primary));
        outline: none;
        overflow-y: auto;
      }

      .lex-editor-content:empty::before {
        content: attr(data-placeholder);
        color: var(--lex-input-placeholder, var(--lex-text-tertiary));
        font-weight: var(--lex-weight-light, 300);
        pointer-events: none;
      }

      /* Rich text formatting */
      .lex-editor-content h1 { font-size: 1.8em; font-weight: var(--lex-weight-bold, 700); margin: 0.5em 0 0.3em; line-height: 1.2; }
      .lex-editor-content h2 { font-size: 1.4em; font-weight: var(--lex-weight-semibold, 600); margin: 0.5em 0 0.3em; line-height: 1.3; }
      .lex-editor-content h3 { font-size: 1.15em; font-weight: var(--lex-weight-semibold, 600); margin: 0.4em 0 0.2em; line-height: 1.3; }
      .lex-editor-content p { margin: 0.4em 0; }
      .lex-editor-content ul, .lex-editor-content ol { padding-left: 1.5em; margin: 0.3em 0; }
      .lex-editor-content li { margin: 0.15em 0; }
      .lex-editor-content blockquote {
        border-left: 3px solid var(--lex-border-strong, var(--lex-color-gray-300));
        padding-left: 12px;
        margin: 0.5em 0;
        color: var(--lex-text-secondary, var(--lex-color-brand-500));
        font-style: italic;
      }
      .lex-editor-content code {
        font-family: var(--lex-font-mono, monospace);
        background: var(--lex-bg-tertiary);
        padding: 2px 5px;
        border-radius: var(--lex-radius-sm);
        font-size: 0.9em;
      }
      .lex-editor-content pre {
        background: var(--lex-bg-tertiary);
        padding: 10px 14px;
        border-radius: var(--lex-radius-md);
        overflow-x: auto;
        font-family: var(--lex-font-mono, monospace);
        font-size: 0.9em;
        margin: 0.5em 0;
      }
      .lex-editor-content a {
        color: var(--lex-text-link, var(--lex-color-brand-600));
        text-decoration: underline;
      }

      /* ── Link dialog ───────────────────────────────────── */

      .lex-editor-link-dialog {
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px;
        background: var(--lex-bg-primary, var(--lex-color-white));
        border: none;
        border-radius: var(--lex-input-radius);
        box-shadow: var(--lex-shadow-lg);
        z-index: var(--lex-z-dropdown, 10);
        display: none;
        gap: 6px;
      }

      .lex-editor-link-dialog--open {
        display: flex;
      }

      .lex-editor-link-dialog input {
        padding: 4px 8px;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        border: none;
        border-radius: var(--lex-radius-sm);
        outline: none;
        width: 200px;
        font-family: inherit;
        background: var(--lex-color-gray-50);
      }

      .lex-editor-link-dialog input:focus {
        background: var(--lex-bg-primary, var(--lex-color-white));
        box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500));
      }

      .lex-editor-link-dialog button {
        padding: 4px 10px;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        border: none;
        background: var(--lex-bg-accent, var(--lex-text-accent));
        color: var(--lex-text-on-accent, var(--lex-color-white));
        border-radius: var(--lex-radius-sm);
        cursor: pointer;
        font-family: inherit;
      }
    `;
    document.head.appendChild(style);
  }

  // Toolbar icons (inline SVGs)
  const ICONS = {
    bold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg>',
    italic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    heading: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/></svg>',
    bulletList: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    orderedList: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    blockquote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
  };

  const DEFAULT_TOOLBAR = ['bold', 'italic', '|', 'heading', '|', 'bulletList', 'orderedList', '|', 'code', 'blockquote', '|', 'link'];

  class LexEditor extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        placeholder: { type: String, default: 'Start typing...' },
        toolbar:     { type: Array, default: null },
        minHeight:   { type: String, default: '120px' },
        maxHeight:   { type: String, default: '400px' },
        format:      { type: String, default: 'html' }
      };
    }

    constructor() {
      super();
      this._firstRender = true;
      this._headingCycle = 0; // 0=p, 1=h1, 2=h2, 3=h3
    }

    render() {
      injectStyles();

      if (!this._firstRender) return null;
      this._firstRender = false;

      const toolbarItems = this.toolbar || DEFAULT_TOOLBAR;
      const errorCls = this.error ? ' lex-editor-container--error' : '';

      let toolbarHtml = '<div class="lex-editor-toolbar">';
      toolbarItems.forEach(item => {
        if (item === '|') {
          toolbarHtml += '<div class="lex-editor-toolbar-sep"></div>';
          return;
        }
        const icon = ICONS[item] || '';
        toolbarHtml += `<button type="button" class="lex-editor-toolbar-btn" data-cmd="${item}" title="${item}">${icon}</button>`;
      });
      toolbarHtml += '</div>';

      const html = `
        <div class="lex-editor-container${errorCls}" style="position:relative;">
          ${toolbarHtml}
          <div class="lex-editor-content" contenteditable="true"
            data-placeholder="${this.escapeHtml(this.placeholder)}"
            style="min-height:${this.minHeight};max-height:${this.maxHeight};"
          >${this.value || ''}</div>
          <div class="lex-editor-link-dialog">
            <input type="text" placeholder="Enter URL..." />
            <button type="button" data-action="insert-link">Add</button>
          </div>
        </div>
      `;

      return this._renderFieldWrapper(html);
    }

    updated() {
      const content = this.querySelector('.lex-editor-content');
      if (!content) return;

      // Toolbar button clicks
      this.delegate('click', '.lex-editor-toolbar-btn', (e, target) => {
        e.preventDefault();
        const cmd = target.dataset.cmd;
        content.focus();
        this._execCommand(cmd, content);
        this._updateToolbarState();
      });

      // Keyboard shortcuts
      this.listen(content, 'keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key === 'b') { e.preventDefault(); this._execCommand('bold', content); }
        else if (mod && e.key === 'i') { e.preventDefault(); this._execCommand('italic', content); }
        else if (mod && e.key === 'k') { e.preventDefault(); this._execCommand('link', content); }
        this._updateToolbarState();
      });

      // Input tracking
      this.listen(content, 'input', () => {
        this._props.value = content.innerHTML;
        this._emitInput(this._getValue(content));
        this._updateToolbarState();
      });

      // Blur
      this.listen(content, 'blur', () => {
        this._emitChange(this._getValue(content));
      });

      // Selection change for toolbar state
      this.listen(content, 'mouseup', () => {
        this._updateToolbarState();
      });

      // Link dialog
      this.delegate('click', '[data-action="insert-link"]', () => {
        const input = this.querySelector('.lex-editor-link-dialog input');
        const dialog = this.querySelector('.lex-editor-link-dialog');
        if (input && input.value) {
          document.execCommand('createLink', false, input.value);
          input.value = '';
          dialog.classList.remove('lex-editor-link-dialog--open');
          content.focus();
        }
      });
    }

    _execCommand(cmd, content) {
      switch (cmd) {
        case 'bold':
          document.execCommand('bold');
          break;
        case 'italic':
          document.execCommand('italic');
          break;
        case 'heading':
          this._headingCycle = (this._headingCycle + 1) % 4;
          const tags = ['P', 'H1', 'H2', 'H3'];
          document.execCommand('formatBlock', false, `<${tags[this._headingCycle]}>`);
          break;
        case 'bulletList':
          document.execCommand('insertUnorderedList');
          break;
        case 'orderedList':
          document.execCommand('insertOrderedList');
          break;
        case 'code':
          // Wrap selection in <code>
          const sel = window.getSelection();
          if (sel.rangeCount && !sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            const code = document.createElement('code');
            range.surroundContents(code);
          }
          break;
        case 'blockquote':
          document.execCommand('formatBlock', false, '<BLOCKQUOTE>');
          break;
        case 'link': {
          const dialog = this.querySelector('.lex-editor-link-dialog');
          if (dialog) {
            dialog.classList.toggle('lex-editor-link-dialog--open');
            const input = dialog.querySelector('input');
            if (input) {
              setTimeout(() => input.focus(), 50);
            }
          }
          break;
        }
      }
    }

    _updateToolbarState() {
      const buttons = this.querySelectorAll('.lex-editor-toolbar-btn');
      buttons.forEach(btn => {
        const cmd = btn.dataset.cmd;
        let active = false;

        switch (cmd) {
          case 'bold':
            active = document.queryCommandState('bold');
            break;
          case 'italic':
            active = document.queryCommandState('italic');
            break;
          case 'bulletList':
            active = document.queryCommandState('insertUnorderedList');
            break;
          case 'orderedList':
            active = document.queryCommandState('insertOrderedList');
            break;
          case 'heading': {
            const block = document.queryCommandValue('formatBlock');
            active = /^h[1-3]$/i.test(block);
            break;
          }
        }

        btn.classList.toggle('lex-editor-toolbar-btn--active', active);
      });
    }

    _getValue(content) {
      if (this.format === 'markdown') {
        return this._htmlToMarkdown(content.innerHTML);
      }
      return content.innerHTML;
    }

    /** Lightweight HTML to Markdown conversion */
    _htmlToMarkdown(html) {
      let md = html;
      md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
      md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
      md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');
      md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
      md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
      md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
      md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
      md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
      md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
      md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n');
      md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
      md = md.replace(/<br\s*\/?>/gi, '\n');
      md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
      md = md.replace(/<[^>]+>/g, '');
      md = md.replace(/&nbsp;/g, ' ');
      md = md.replace(/&amp;/g, '&');
      md = md.replace(/&lt;/g, '<');
      md = md.replace(/&gt;/g, '>');
      return md.trim();
    }

    /** Set HTML content programmatically */
    setContent(html) {
      const content = this.querySelector('.lex-editor-content');
      if (content) {
        content.innerHTML = html;
        this._props.value = html;
      }
    }

    /** Get content as HTML */
    getHTML() {
      const content = this.querySelector('.lex-editor-content');
      return content ? content.innerHTML : '';
    }

    /** Get content as Markdown */
    getMarkdown() {
      return this._htmlToMarkdown(this.getHTML());
    }
  }

  defineLex('lex-editor', LexEditor);
})();

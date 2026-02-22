/* Lex UI — Mention Input Component
   Rich text input with # trigger for mention/document picker.
   Uses contenteditable for inline rich content (pills).

   Usage:
     <lex-mention-input label="Message" placeholder="Type # to mention..."
       items='[{"id":"doc-1","label":"Contract A"},{"id":"doc-2","label":"Amendment B"}]'>
     </lex-mention-input>

   Trigger: # (configurable)
   Events: lex-input, lex-change, lex-mention { id, label }
*/

(function () {
  'use strict';

  const { LexElement, defineLex, withFormField } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-mention-input-styles';
    style.textContent = `
      lex-mention-input {
        display: block;
      }

      .lex-mention-editor {
        min-height: 40px;
        padding: 8px 12px;
        font-size: var(--lex-form-font-size, 0.8125rem);
        line-height: 1.6;
        color: var(--lex-input-text, var(--lex-text-primary));
        background: var(--lex-color-gray-50);
        border: none;
        border-radius: var(--lex-input-radius);
        outline: none;
        transition: background 0.2s ease, box-shadow 0.2s ease;
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }

      .lex-mention-editor:empty::before {
        content: attr(data-placeholder);
        color: var(--lex-input-placeholder, var(--lex-text-tertiary));
        font-weight: var(--lex-weight-light, 300);
        pointer-events: none;
      }

      .lex-mention-editor:hover:not(:focus) {
        background: var(--lex-bg-tertiary);
      }

      .lex-mention-editor:focus {
        background: var(--lex-color-gray-50);
        box-shadow: 0 0 0 2px var(--lex-input-border-focus, var(--lex-color-brand-500));
      }

      .lex-mention-editor--error {
        box-shadow: 0 0 0 2px var(--lex-input-border-error, var(--lex-color-danger-500));
      }

      /* ── Mention pill ──────────────────────────────────── */

      .lex-mention-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 8px;
        margin: 0 2px;
        background: var(--lex-bg-accent-soft);
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-radius-full);
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        font-weight: var(--lex-weight-medium, 500);
        color: var(--lex-text-accent);
        cursor: default;
        user-select: none;
        vertical-align: baseline;
        line-height: 1.6;
      }

      .lex-mention-pill-icon {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
      }

      .lex-mention-pill-x {
        cursor: pointer;
        color: var(--lex-text-tertiary);
        font-size: var(--lex-form-counter-size, 0.625rem);
        line-height: 1;
        margin-left: 2px;
      }

      .lex-mention-pill-x:hover {
        color: var(--lex-color-danger-500);
      }

      /* ── Picker dropdown ───────────────────────────────── */

      .lex-mention-picker {
        position: absolute;
        min-width: 200px;
        max-width: 300px;
        max-height: 200px;
        overflow-y: auto;
        background: var(--lex-bg-primary, var(--lex-color-white));
        border: 1px solid var(--lex-border-default);
        border-radius: var(--lex-input-radius);
        box-shadow: var(--lex-shadow-lg);
        z-index: var(--lex-z-dropdown, 10);
        display: none;
      }

      .lex-mention-picker--open {
        display: block;
      }

      .lex-mention-picker-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: var(--lex-form-font-size, 0.8125rem);
        color: var(--lex-text-primary);
        transition: background 0.1s ease;
      }

      .lex-mention-picker-item:hover,
      .lex-mention-picker-item--focused {
        background: var(--lex-select-option-hover, var(--lex-bg-secondary));
      }

      .lex-mention-picker-item-icon {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        color: var(--lex-text-tertiary);
      }

      .lex-mention-picker-empty {
        padding: 12px;
        text-align: center;
        font-size: var(--lex-form-font-size-sm, 0.75rem);
        color: var(--lex-text-tertiary);
      }
    `;
    document.head.appendChild(style);
  }

  const DOC_ICON = '<svg class="lex-mention-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

  class LexMentionInput extends withFormField(LexElement) {
    static get properties() {
      return {
        ...super.properties,
        placeholder: { type: String, default: 'Type # to mention...' },
        trigger:     { type: String, default: '#' },
        items:       { type: Array, default: [] },
        endpoint:    { type: String, default: '' }
      };
    }

    constructor() {
      super();
      this._pickerOpen = false;
      this._pickerQuery = '';
      this._focusedIdx = -1;
      this._pickerPos = { top: 0, left: 0 };
      this._mentions = [];
      this._firstRender = true;
      // Unique IDs for aria-controls / aria-activedescendant linking.
      this._pickerId = 'lex-mention-picker-' + Math.random().toString(36).slice(2, 8);
    }

    render() {
      injectStyles();

      // Only render the structure on first render; after that return null
      // to preserve contenteditable state/caret
      if (!this._firstRender) return null;
      this._firstRender = false;

      const errorCls = this.error ? ' lex-mention-editor--error' : '';

      // aria-autocomplete="list" indicates suggestions are shown in a listbox popup.
      // aria-controls links the editor to the picker listbox.
      let html = `<div class="lex-mention-editor${errorCls}" contenteditable="true" data-placeholder="${this.escapeHtml(this.placeholder)}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${this._pickerId}" aria-multiline="true"></div>`;
      html += `<div id="${this._pickerId}" class="lex-mention-picker" role="listbox" style="position:absolute;"></div>`;

      return this._renderFieldWrapper(`<div style="position:relative;">${html}</div>`);
    }

    updated() {
      const editor = this.querySelector('.lex-mention-editor');
      const picker = this.querySelector('.lex-mention-picker');
      if (!editor) return;

      // Input monitoring
      this.listen(editor, 'input', () => {
        this._checkForTrigger(editor);
        this._emitInput(this.getTextContent());
      });

      // Key handling for picker
      this.listen(editor, 'keydown', (e) => {
        if (this._pickerOpen) {
          const filtered = this._getFilteredItems();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._focusedIdx = Math.min(this._focusedIdx + 1, filtered.length - 1);
            this._renderPicker(picker, filtered);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._focusedIdx = Math.max(this._focusedIdx - 1, 0);
            this._renderPicker(picker, filtered);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = filtered[this._focusedIdx] || filtered[0];
            if (item) this._insertMention(editor, item);
          } else if (e.key === 'Escape') {
            this._closePicker(picker);
          }
        }

        // Handle backspace to delete mention pills
        if (e.key === 'Backspace') {
          const sel = window.getSelection();
          if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            if (range.collapsed && range.startOffset > 0) {
              const node = range.startContainer;
              const prev = node.nodeType === 3 ? node.previousSibling : null;
              if (prev && prev.classList && prev.classList.contains('lex-mention-pill')) {
                e.preventDefault();
                prev.remove();
                this._syncMentions(editor);
              }
            }
          }
        }
      });

      // Blur
      this.listen(editor, 'blur', () => {
        // Delay to allow picker click
        setTimeout(() => {
          if (!this.contains(document.activeElement)) {
            this._closePicker(picker);
            this._emitChange(this.getTextContent());
          }
        }, 150);
      });

      // Pill remove buttons
      this.delegate('click', '.lex-mention-pill-x', (e, target) => {
        const pill = target.closest('.lex-mention-pill');
        if (pill) {
          pill.remove();
          this._syncMentions(editor);
        }
      });

      // Picker item click
      if (picker) {
        this.listen(picker, 'mousedown', (e) => {
          e.preventDefault(); // Prevent blur
          const item = e.target.closest('.lex-mention-picker-item');
          if (item) {
            const id = item.dataset.id;
            const items = this.items || [];
            const found = items.find(i => i.id === id);
            if (found) this._insertMention(editor, found);
          }
        });
      }
    }

    _checkForTrigger(editor) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;

      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3) {
        this._closePicker(this.querySelector('.lex-mention-picker'));
        return;
      }

      const text = node.textContent;
      const offset = range.startOffset;

      // Find the trigger character before cursor
      const beforeCursor = text.slice(0, offset);
      const triggerIdx = beforeCursor.lastIndexOf(this.trigger);

      if (triggerIdx >= 0) {
        // Check if trigger is at word boundary (start of text or preceded by space)
        if (triggerIdx === 0 || beforeCursor[triggerIdx - 1] === ' ' || beforeCursor[triggerIdx - 1] === '\u00A0') {
          this._pickerQuery = beforeCursor.slice(triggerIdx + 1);
          this._pickerOpen = true;
          this._focusedIdx = 0;

          // Position picker near cursor
          const editorRect = editor.getBoundingClientRect();
          const rangeRect = range.getBoundingClientRect();
          const picker = this.querySelector('.lex-mention-picker');
          if (picker) {
            picker.style.top = (rangeRect.bottom - editorRect.top + 4) + 'px';
            picker.style.left = (rangeRect.left - editorRect.left) + 'px';
            this._renderPicker(picker, this._getFilteredItems());
          }
          return;
        }
      }

      this._closePicker(this.querySelector('.lex-mention-picker'));
    }

    _getFilteredItems() {
      const items = this.items || [];
      if (!this._pickerQuery) return items;
      const q = this._pickerQuery.toLowerCase();
      return items.filter(i => i.label.toLowerCase().includes(q));
    }

    _renderPicker(picker, filtered) {
      if (!picker) return;

      const editor = this.querySelector('.lex-mention-editor');

      let html = '';
      if (filtered.length === 0) {
        html = '<div class="lex-mention-picker-empty">No matches</div>';
      } else {
        filtered.forEach((item, idx) => {
          const focusedCls = idx === this._focusedIdx ? ' lex-mention-picker-item--focused' : '';
          const isFocused = idx === this._focusedIdx;
          // Each item gets a stable id for aria-activedescendant on the editor.
          const optId = this._pickerId + '-opt-' + idx;
          const iconHtml = item.icon ? `<span class="lex-mention-picker-item-icon" aria-hidden="true">${item.icon}</span>` : `<span class="lex-mention-picker-item-icon" aria-hidden="true">${DOC_ICON}</span>`;
          html += `<div id="${optId}" class="lex-mention-picker-item${focusedCls}" data-id="${this.escapeHtml(item.id)}" role="option" aria-selected="${isFocused ? 'true' : 'false'}">${iconHtml}<span>${this.escapeHtml(item.label)}</span></div>`;
        });
      }

      picker.innerHTML = html;
      picker.classList.add('lex-mention-picker--open');

      // Update aria-expanded and aria-activedescendant on the editor element.
      if (editor) {
        editor.setAttribute('aria-expanded', 'true');
        if (this._focusedIdx >= 0) {
          editor.setAttribute('aria-activedescendant', this._pickerId + '-opt-' + this._focusedIdx);
        } else {
          editor.removeAttribute('aria-activedescendant');
        }
      }
    }

    _closePicker(picker) {
      this._pickerOpen = false;
      this._pickerQuery = '';
      this._focusedIdx = -1;
      if (picker) {
        picker.classList.remove('lex-mention-picker--open');
      }
      // Reset aria state on the editor when picker closes.
      const editor = this.querySelector('.lex-mention-editor');
      if (editor) {
        editor.setAttribute('aria-expanded', 'false');
        editor.removeAttribute('aria-activedescendant');
      }
    }

    _insertMention(editor, item) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;

      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== 3) return;

      const text = node.textContent;
      const offset = range.startOffset;
      const beforeCursor = text.slice(0, offset);
      const triggerIdx = beforeCursor.lastIndexOf(this.trigger);

      if (triggerIdx < 0) return;

      // Remove trigger + query text
      const before = text.slice(0, triggerIdx);
      const after = text.slice(offset);

      // Create pill element
      const pill = document.createElement('span');
      pill.className = 'lex-mention-pill';
      pill.contentEditable = 'false';
      pill.dataset.mentionId = item.id;
      pill.innerHTML = `${item.icon || DOC_ICON}<span>${this.escapeHtml(item.label)}</span><span class="lex-mention-pill-x">&times;</span>`;

      // Replace text node
      const parent = node.parentNode;
      const beforeNode = document.createTextNode(before);
      const afterNode = document.createTextNode('\u00A0' + after);

      parent.insertBefore(beforeNode, node);
      parent.insertBefore(pill, node);
      parent.insertBefore(afterNode, node);
      parent.removeChild(node);

      // Place cursor after pill
      const newRange = document.createRange();
      newRange.setStart(afterNode, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      this._closePicker(this.querySelector('.lex-mention-picker'));
      this._syncMentions(editor);

      this.emit('lex-mention', { id: item.id, label: item.label });
    }

    _syncMentions(editor) {
      const pills = editor.querySelectorAll('.lex-mention-pill');
      this._mentions = Array.from(pills).map(p => ({
        id: p.dataset.mentionId,
        label: p.textContent.replace('×', '').trim()
      }));
    }

    /** Get all current mention IDs */
    getMentions() {
      return this._mentions.map(m => m.id);
    }

    /** Get plain text content (without pill HTML) */
    getTextContent() {
      const editor = this.querySelector('.lex-mention-editor');
      return editor ? editor.textContent : '';
    }
  }

  defineLex('lex-mention-input', LexMentionInput);
})();

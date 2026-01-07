/**
 * DocumentActionHandler - Week 2 Implementation
 * Handles document actions with position-aware replacement
 */

class DocumentActionHandler {
  constructor(editor, onDocumentChange = null) {
    this.editor = editor;
    this.onDocumentChange = onDocumentChange;

    if (!this.editor) {
      console.warn('[DocumentActionHandler] No editor instance provided');
    }
  }

  /**
   * Apply content to the entire document (replace all)
   * @param {string} content - HTML content
   */
  applyToDocument(content) {
    if (!this.editor) {
      console.error('[DocumentActionHandler] No editor instance');
      return;
    }

    try {
      this.editor.commands.setContent(content);
      console.log('[DocumentActionHandler] Content applied to document');

      if (this.onDocumentChange) {
        this.onDocumentChange();
      }
    } catch (error) {
      console.error('[DocumentActionHandler] Failed to apply content:', error);
      throw error;
    }
  }

  /**
   * Insert content at current cursor position
   * @param {string} content - HTML content
   */
  insertAtCursor(content) {
    if (!this.editor) {
      console.error('[DocumentActionHandler] No editor instance');
      return;
    }

    try {
      this.editor.chain().focus().insertContent(content).run();
      console.log('[DocumentActionHandler] Content inserted at cursor');

      if (this.onDocumentChange) {
        this.onDocumentChange();
      }
    } catch (error) {
      console.error('[DocumentActionHandler] Failed to insert content:', error);
      throw error;
    }
  }

  /**
   * Replace current selection with content
   * @param {string} content - HTML content
   */
  replaceSelection(content) {
    if (!this.editor) {
      console.error('[DocumentActionHandler] No editor instance');
      return;
    }

    try {
      const { from, to } = this.editor.state.selection;

      this.editor.chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, content)
        .run();

      console.log('[DocumentActionHandler] Selection replaced', { from, to });

      if (this.onDocumentChange) {
        this.onDocumentChange();
      }
    } catch (error) {
      console.error('[DocumentActionHandler] Failed to replace selection:', error);
      throw error;
    }
  }

  /**
   * Week 2: Replace content at specific position range
   * @param {string} content - HTML content
   * @param {Object} range - { from, to, action }
   */
  replaceAtPosition(content, range) {
    if (!this.editor) {
      console.error('[DocumentActionHandler] No editor instance');
      return;
    }

    const { from, to, action } = range;

    try {
      if (action === 'replace') {
        // Replace content between from and to
        this.editor.chain()
          .focus()
          .setTextSelection({ from, to })
          .deleteSelection()
          .insertContentAt(from, content)
          .run();

        console.log('[DocumentActionHandler] Content replaced', { from, to, length: content.length });

      } else if (action === 'insert_before') {
        // Insert before position
        this.editor.chain()
          .focus()
          .insertContentAt(from, content)
          .run();

        console.log('[DocumentActionHandler] Content inserted before', { from });

      } else if (action === 'insert_after') {
        // Insert after position
        this.editor.chain()
          .focus()
          .insertContentAt(to, content)
          .run();

        console.log('[DocumentActionHandler] Content inserted after', { to });
      }

      if (this.onDocumentChange) {
        this.onDocumentChange();
      }

    } catch (error) {
      console.error('[DocumentActionHandler] Replace failed', error);
      throw error;
    }
  }

  /**
   * Copy content to clipboard
   * @param {string} content - Content to copy
   */
  async copyToClipboard(content) {
    try {
      // Strip HTML tags for plain text clipboard
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;
      const plainText = tempDiv.textContent || tempDiv.innerText || '';

      await navigator.clipboard.writeText(plainText);
      console.log('[DocumentActionHandler] Content copied to clipboard');

    } catch (error) {
      console.error('[DocumentActionHandler] Clipboard copy failed', error);
      throw error;
    }
  }
}

// Export for module or global use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DocumentActionHandler;
} else {
  window.DocumentActionHandler = DocumentActionHandler;
}

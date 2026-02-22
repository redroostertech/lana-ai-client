/* Lex UI — Text Block
   Renders markdown-formatted text from AI responses.
   Uses string-method parsing only — no regex allowed.
*/

(function () {
  'use strict';

  const { SchemaRegistry } = window.Lex;

  // ---------------------------------------------------------------------------
  // String-method markdown helpers (no regex)
  // ---------------------------------------------------------------------------

  /**
   * Process fenced code blocks: ```lang\ncode``` → <pre><code>...</code></pre>
   * Scans for triple-backtick delimiters using indexOf and substring.
   * @param {string} text
   * @returns {string}
   */
  function processFencedCodeBlocks(text) {
    var FENCE = '```';
    var result = '';
    var remaining = text;

    while (true) {
      var openIdx = remaining.indexOf(FENCE);
      if (openIdx === -1) {
        result += remaining;
        break;
      }

      // Append everything before the opening fence
      result += remaining.substring(0, openIdx);

      // Skip past the opening fence
      var afterOpen = remaining.substring(openIdx + FENCE.length);

      // Optional language hint: everything up to the first newline
      var newlineIdx = afterOpen.indexOf('\n');
      var lang = '';
      var codeStart = afterOpen;
      if (newlineIdx !== -1) {
        lang = afterOpen.substring(0, newlineIdx).trim();
        codeStart = afterOpen.substring(newlineIdx + 1);
      }

      // Find the closing fence
      var closeIdx = codeStart.indexOf(FENCE);
      if (closeIdx === -1) {
        // No closing fence found — emit the fence marker literally and stop processing
        result += FENCE + afterOpen;
        break;
      }

      var code = codeStart.substring(0, closeIdx);
      result += '<pre class="lex-bg-secondary rounded-lg p-3 text-xs font-mono overflow-x-auto my-2"><code>' + escapeHtmlContent(code) + '</code></pre>';

      // Continue with the remainder after the closing fence
      remaining = codeStart.substring(closeIdx + FENCE.length);
    }

    return result;
  }

  /**
   * Process inline code spans: `code` → <code>...</code>
   * Scans for single-backtick pairs using indexOf and substring.
   * @param {string} text
   * @returns {string}
   */
  function processInlineCode(text) {
    var result = '';
    var remaining = text;

    while (true) {
      var openIdx = remaining.indexOf('`');
      if (openIdx === -1) {
        result += remaining;
        break;
      }
      result += remaining.substring(0, openIdx);
      var afterOpen = remaining.substring(openIdx + 1);
      var closeIdx = afterOpen.indexOf('`');
      if (closeIdx === -1) {
        // No closing backtick — emit the backtick literally
        result += '`' + afterOpen;
        break;
      }
      var code = afterOpen.substring(0, closeIdx);
      result += '<code class="lex-bg-tertiary px-1.5 py-0.5 rounded text-xs font-mono">' + escapeHtmlContent(code) + '</code>';
      remaining = afterOpen.substring(closeIdx + 1);
    }

    return result;
  }

  /**
   * Process bold spans: **text** → <strong>text</strong>
   * Scans for '**' delimiter pairs using indexOf and substring.
   * @param {string} text
   * @returns {string}
   */
  function processBold(text) {
    var DELIM = '**';
    var result = '';
    var remaining = text;

    while (true) {
      var openIdx = remaining.indexOf(DELIM);
      if (openIdx === -1) {
        result += remaining;
        break;
      }
      result += remaining.substring(0, openIdx);
      var afterOpen = remaining.substring(openIdx + DELIM.length);
      var closeIdx = afterOpen.indexOf(DELIM);
      if (closeIdx === -1) {
        result += DELIM + afterOpen;
        break;
      }
      var inner = afterOpen.substring(0, closeIdx);
      result += '<strong>' + inner + '</strong>';
      remaining = afterOpen.substring(closeIdx + DELIM.length);
    }

    return result;
  }

  /**
   * Process italic spans: *text* → <em>text</em>
   * Only matches single '*' delimiters (not '**' which bold already consumed).
   * @param {string} text
   * @returns {string}
   */
  function processItalic(text) {
    var result = '';
    var i = 0;

    while (i < text.length) {
      if (text.charAt(i) === '*') {
        // Make sure this is not a '**' double-asterisk (bold already consumed those,
        // but guard defensively)
        if (i + 1 < text.length && text.charAt(i + 1) === '*') {
          // Pass through the double-asterisk untouched
          result += '**';
          i += 2;
          continue;
        }
        // Look for the closing single '*'
        var closeIdx = text.indexOf('*', i + 1);
        // Skip over any '**' sequences when searching for the close
        while (closeIdx !== -1 && closeIdx + 1 < text.length && text.charAt(closeIdx + 1) === '*') {
          closeIdx = text.indexOf('*', closeIdx + 2);
        }
        if (closeIdx === -1) {
          result += text.charAt(i);
          i++;
          continue;
        }
        var inner = text.substring(i + 1, closeIdx);
        result += '<em>' + inner + '</em>';
        i = closeIdx + 1;
      } else {
        result += text.charAt(i);
        i++;
      }
    }

    return result;
  }

  /**
   * Process markdown links: [text](url) → <a href="url">text</a>
   * Scans for the '[' + '](' + ')' structure using indexOf and substring.
   * @param {string} text
   * @returns {string}
   */
  function processLinks(text) {
    var result = '';
    var remaining = text;

    while (true) {
      var openBracket = remaining.indexOf('[');
      if (openBracket === -1) {
        result += remaining;
        break;
      }
      var closeBracket = remaining.indexOf(']', openBracket + 1);
      if (closeBracket === -1) {
        result += remaining;
        break;
      }
      // Check for '(' immediately after ']'
      if (remaining.charAt(closeBracket + 1) !== '(') {
        // Not a link — emit up to and including ']' and continue
        result += remaining.substring(0, closeBracket + 1);
        remaining = remaining.substring(closeBracket + 1);
        continue;
      }
      var openParen = closeBracket + 1;
      var closeParen = remaining.indexOf(')', openParen + 1);
      if (closeParen === -1) {
        result += remaining;
        break;
      }
      var linkText = remaining.substring(openBracket + 1, closeBracket);
      var url = remaining.substring(openParen + 1, closeParen);
      result += remaining.substring(0, openBracket);
      result += '<a href="' + escapeAttr(url) + '" class="lex-text-link underline" target="_blank">' + linkText + '</a>';
      remaining = remaining.substring(closeParen + 1);
    }

    return result;
  }

  /**
   * Replace newline characters with <br> tags.
   * Uses split/join — no regex.
   * @param {string} text
   * @returns {string}
   */
  function processNewlines(text) {
    return text.split('\n').join('<br>');
  }

  /**
   * Escape HTML special characters in text content.
   * Uses split/join — no regex.
   * @param {string} text
   * @returns {string}
   */
  function escapeHtmlContent(text) {
    return (text || '')
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  /**
   * Escape a URL for use in an HTML attribute.
   * Replaces characters that would break the attribute string.
   * Uses split/join — no regex.
   * @param {string} url
   * @returns {string}
   */
  function escapeAttr(url) {
    return (url || '')
      .split('&').join('&amp;')
      .split('"').join('&quot;')
      .split("'").join('&#39;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  SchemaRegistry.register('text', {
    description: 'Plain or markdown-formatted text content',
    fields: {
      type:    { type: 'string', required: true, description: 'Must be "text"' },
      content: { type: 'string', required: true, description: 'Text content, optionally with markdown formatting' }
    },
    example: {
      type: 'text',
      content: 'Here is a summary of the findings from the **Smith v. Jones** matter.'
    }
  }, function renderText(container, block) {
    var html = block.content || '';

    // Basic markdown processing — all steps use string methods, no regex.
    // Order matters: fenced code blocks and inline code are extracted first so
    // that their contents are not transformed by subsequent passes.
    html = processFencedCodeBlocks(html);
    html = processInlineCode(html);
    html = processBold(html);
    html = processItalic(html);
    html = processLinks(html);
    html = processNewlines(html);

    container.innerHTML = '<div class="text-sm lex-text-primary leading-relaxed">' + html + '</div>';
  });
})();

/* ==========================================================================
   Lex UI — Chat Content Formatter
   Pure utility for converting markdown-like AI response text into HTML.
   No component — just a formatting pipeline on Lex.ChatFormat.

   Pipeline:
     1. Extract code blocks (protect from paragraph wrapping)
     2. Inline code
     3. Bold / Italic
     4. Citation [file.pdf:page] references
     5. Markdown links [text](url)
     6. (extracts N, M) citation patterns
     7. Block-level: headers, ordered/unordered lists, paragraphs
     8. Restore code block placeholders
   ========================================================================== */

(function (global) {
  'use strict';

  const Lex = global.Lex;
  if (!Lex) { console.error('[Lex ChatFormat] Lex core not loaded'); return; }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function escapeCode(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeJsString(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  // ---------------------------------------------------------------------------
  // JSON rendering helpers
  // ---------------------------------------------------------------------------

  function isCompleteJSON(str) {
    if (!str || str.trim().length === 0) return false;
    const t = str.trim();
    const open = t[0];
    const close = t[t.length - 1];
    if ((open === '{' && close === '}') || (open === '[' && close === ']')) {
      let depth = 0;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === open) depth++;
        else if (t[i] === close) depth--;
        if (depth < 0) return false;
      }
      return depth === 0;
    }
    return false;
  }

  function syntaxHighlight(json) {
    if (typeof json !== 'string') json = JSON.stringify(json, undefined, 2);
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match) {
        let cls = 'number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'key' : 'string';
        } else if (/true|false/.test(match)) {
          cls = 'boolean';
        } else if (/null/.test(match)) {
          cls = 'null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Mermaid diagram rendering
  // ---------------------------------------------------------------------------

  let _mermaidInitialized = false;

  function renderMermaidBlock(trimmedCode) {
    const uid = 'mermaid-' + Math.random().toString(36).substr(2, 9);
    const escapedContent = escapeCode(trimmedCode);
    return `
      <div class="lex-mermaid-wrapper rounded-md overflow-hidden my-4 border border-white/10 shadow-sm" style="background:#0d0d0d">
        <div class="flex items-center justify-between px-4 py-2 text-gray-300 text-[11px] font-sans uppercase tracking-tight" style="background:#2f2f2f">
          <span>diagram</span>
          <button class="lex-chat-copy-btn flex items-center gap-1.5 hover:text-white transition-colors" data-mermaid-copy="${uid}">
            <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" xmlns="http://www.w3.org/2000/svg"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
            Copy
          </button>
        </div>
        <div class="p-4 overflow-x-auto flex justify-center" style="background:#fff">
          <pre class="mermaid" id="${uid}" style="margin:0;background:transparent">${escapedContent}</pre>
        </div>
      </div>`;
  }

  /**
   * Render any unprocessed mermaid diagrams in the given container.
   * Must be called AFTER HTML is inserted into the live DOM.
   * @param {HTMLElement} [container=document] - Scope to search within
   */
  function renderMermaidDiagrams(container) {
    if (typeof mermaid === 'undefined') return;

    var target = container || document;
    var nodes = target.querySelectorAll('.mermaid:not([data-mermaid-processed])');
    if (nodes.length === 0) return;

    // Lazy-init mermaid on first use
    if (!_mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'strict',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      });
      _mermaidInitialized = true;
    }

    var nodeArray = Array.from(nodes);

    // Store source text BEFORE mermaid replaces it
    nodeArray.forEach(function (node) {
      if (!node.dataset.mermaidSource) {
        node.dataset.mermaidSource = node.textContent;
      }
    });

    try {
      mermaid.run({ nodes: nodeArray, suppressErrors: true })
        .then(function () {
          nodeArray.forEach(function (node) {
            node.setAttribute('data-mermaid-processed', 'true');
            // Rendered SVG gets white background — ensure container looks clean
            node.style.background = 'transparent';
          });
        })
        .catch(function (err) {
          console.warn('[Lex ChatFormat] Mermaid render failed:', err);
          // Fallback: show raw source as monospace
          nodeArray.forEach(function (node) {
            if (!node.querySelector('svg')) {
              var source = node.dataset.mermaidSource || node.textContent;
              node.textContent = source;
              node.style.fontFamily = 'monospace';
              node.style.fontSize = '13px';
              node.style.whiteSpace = 'pre-wrap';
              node.style.color = '#ef4444';
              node.style.padding = '1rem';
              node.setAttribute('data-mermaid-processed', 'error');
            }
          });
        });
    } catch (err) {
      console.warn('[Lex ChatFormat] Mermaid init error:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // JSON rendering
  // ---------------------------------------------------------------------------

  function renderJsonBlock(trimmedCode) {
    if (!isCompleteJSON(trimmedCode)) return null;
    try {
      const data = JSON.parse(trimmedCode);
      const highlighted = syntaxHighlight(trimmedCode);
      const uid = 'copy-' + Math.random().toString(36).substr(2, 9);
      const raw = escapeCode(JSON.stringify(data, null, 2));
      return `
        <div class="rounded-md overflow-hidden bg-[#0d0d0d] my-4 border border-white/10 shadow-sm">
          <div class="flex items-center justify-between px-4 py-2 bg-[#2f2f2f] text-gray-300 text-[11px] font-sans uppercase tracking-tight">
            <span>json</span>
            <button data-copy-id="${uid}" class="lex-chat-copy-btn flex items-center gap-1.5 hover:text-white transition-colors">
              <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" xmlns="http://www.w3.org/2000/svg"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
              Copy code
            </button>
          </div>
          <div class="p-4 overflow-x-auto bg-[#0d0d0d] no-scrollbar">
            <pre class="font-mono text-[13px] leading-6 text-[#d1d5db]"><code data-raw="${raw}">${highlighted}</code></pre>
          </div>
        </div>`;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Block-level processing (headers, lists, paragraphs)
  // ---------------------------------------------------------------------------

  /**
   * Check if a line is a markdown table separator (e.g. |---|---|)
   * Contains only |, -, :, and whitespace.
   */
  function isTableSeparator(line) {
    if (line.indexOf('|') === -1 || line.indexOf('-') === -1) return false;
    for (var ci = 0; ci < line.length; ci++) {
      var ch = line.charAt(ci);
      if (ch !== '|' && ch !== '-' && ch !== ':' && ch !== ' ' && ch !== '\t') return false;
    }
    return true;
  }

  /**
   * Parse a markdown table row into cell strings.
   * "|a|b|c|" → ["a","b","c"]
   */
  function parseTableRow(line) {
    var trimmed = line.trim();
    // Strip leading/trailing pipes
    if (trimmed.charAt(0) === '|') trimmed = trimmed.substring(1);
    if (trimmed.charAt(trimmed.length - 1) === '|') trimmed = trimmed.substring(0, trimmed.length - 1);
    return trimmed.split('|').map(function (c) { return c.trim(); });
  }

  /**
   * Render buffered markdown table lines into an HTML table.
   */
  function renderTable(tableLines) {
    if (tableLines.length < 2) return tableLines.join('\n'); // Not enough for header+separator

    var headerLine = tableLines[0];
    var separatorIdx = -1;

    // Find the separator line (|---|---|)
    for (var si = 1; si < tableLines.length && si <= 2; si++) {
      if (isTableSeparator(tableLines[si])) {
        separatorIdx = si;
        break;
      }
    }

    var html = '<div class="my-3 overflow-x-auto"><table class="min-w-full text-sm border border-gray-200 rounded">';

    if (separatorIdx > 0) {
      // Has header
      var headerCells = parseTableRow(headerLine);
      html += '<thead class="bg-gray-50"><tr>';
      for (var hi = 0; hi < headerCells.length; hi++) {
        html += '<th class="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200">' + headerCells[hi] + '</th>';
      }
      html += '</tr></thead>';

      // Body rows (after separator)
      html += '<tbody>';
      for (var ri = separatorIdx + 1; ri < tableLines.length; ri++) {
        if (!tableLines[ri].trim()) continue;
        var cells = parseTableRow(tableLines[ri]);
        html += '<tr class="border-b border-gray-100 hover:bg-gray-50">';
        for (var ci = 0; ci < cells.length; ci++) {
          html += '<td class="px-3 py-1.5 text-gray-800">' + cells[ci] + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody>';
    } else {
      // No separator — treat all rows as body
      html += '<tbody>';
      for (var bi = 0; bi < tableLines.length; bi++) {
        if (!tableLines[bi].trim()) continue;
        var bodyCells = parseTableRow(tableLines[bi]);
        html += '<tr class="border-b border-gray-100 hover:bg-gray-50">';
        for (var bci = 0; bci < bodyCells.length; bci++) {
          html += '<td class="px-3 py-1.5 text-gray-800">' + bodyCells[bci] + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody>';
    }

    html += '</table></div>';
    return html;
  }

  function processBlocks(text) {
    const lines = text.split('\n');
    const out = [];
    let inOL = false;
    let inUL = false;
    let tableBuffer = [];

    function closeLists() {
      if (inOL) { out.push('</ol>'); inOL = false; }
      if (inUL) { out.push('</ul>'); inUL = false; }
    }

    function flushTable() {
      if (tableBuffer.length > 0) {
        out.push(renderTable(tableBuffer));
        tableBuffer = [];
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Table row detection: line starts with | and contains at least 2 pipes
      var pipeCount = 0;
      for (var pi = 0; pi < line.length; pi++) {
        if (line.charAt(pi) === '|') pipeCount++;
      }
      var isTableLine = line.charAt(0) === '|' && pipeCount >= 2;

      if (isTableLine) {
        closeLists();
        tableBuffer.push(line);
        continue;
      }

      // Not a table line — flush any buffered table
      flushTable();

      // Skip empty lines inside lists
      if (!line && (inOL || inUL)) continue;

      // Headers (check most specific first: h6 → h1)
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        closeLists();
        const level = headerMatch[1].length;
        const content = headerMatch[2];
        const sizes = {
          1: 'text-xl font-bold',
          2: 'text-lg font-semibold',
          3: 'text-base font-semibold',
          4: 'text-sm font-semibold',
          5: 'text-xs font-semibold uppercase tracking-wide',
          6: 'text-xs font-medium uppercase tracking-wide'
        };
        out.push(`<h${level} class="${sizes[level]} mt-4 mb-2 text-gray-900">${content}</h${level}>`);
      }
      // Horizontal rule
      else if (/^(?:---+|\*\*\*+|___+)$/.test(line)) {
        closeLists();
        out.push('<hr class="my-4 border-t border-gray-200">');
      }
      // Blockquote
      else if (/^>\s*(.*)$/.test(line)) {
        closeLists();
        const quoteContent = line.replace(/^>\s*/, '');
        out.push(`<blockquote class="border-l-3 border-gray-300 pl-4 my-3 text-gray-600 italic">${quoteContent}</blockquote>`);
      }
      // Ordered list
      else if (/^\d+\.\s+(.+)$/.test(line)) {
        if (inUL) { out.push('</ul>'); inUL = false; }
        if (!inOL) { out.push('<ol class="list-decimal list-inside space-y-1 my-3 ml-4">'); inOL = true; }
        out.push(line.replace(/^\d+\.\s+(.+)$/, '<li class="text-gray-800 leading-relaxed">$1</li>'));
      }
      // Unordered list
      else if (/^[-*]\s+(.+)$/.test(line)) {
        if (inOL) { out.push('</ol>'); inOL = false; }
        if (!inUL) { out.push('<ul class="list-disc list-inside space-y-1 my-3 ml-4">'); inUL = true; }
        out.push(line.replace(/^[-*]\s+(.+)$/, '<li class="text-gray-800 leading-relaxed">$1</li>'));
      }
      // Regular text / empty
      else {
        closeLists();
        if (line) {
          out.push(`<p class="mb-3 text-gray-800 leading-relaxed">${line}</p>`);
        } else {
          out.push('<div class="mb-2"></div>');
        }
      }
    }

    flushTable();
    if (inOL) out.push('</ol>');
    if (inUL) out.push('</ul>');
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Main format pipeline
  // ---------------------------------------------------------------------------

  /**
   * Format AI response content into rich HTML.
   *
   * @param {string} content   - Raw markdown-like AI text
   * @param {Array}  citations - Optional citation objects from a `citations` SSE event
   *                             [{document_id, filename, page_number, chunk_text, relevance_score}]
   * @returns {string} HTML string
   */
  function format(content, citations) {
    if (!content) return '';
    citations = citations || [];

    // 1. Extract fenced code blocks into placeholders
    const codeBlocks = {};
    let codeIdx = 0;

    let formatted = content
      // Fenced code blocks
      .replace(/```(\w+)?\n?([\s\S]*?)```/g, (_match, lang, code) => {
        const trimmed = code.trim();
        let html = '';

        // Mermaid diagram blocks
        if (lang === 'mermaid') {
          html = renderMermaidBlock(trimmed);
        }

        // JSON blocks
        if (!html) {
          const isJSON = lang === 'json' || lang === 'JSON' ||
            (trimmed.startsWith('{') || trimmed.startsWith('['));

          if (isJSON && isCompleteJSON(trimmed)) {
            const jsonHtml = renderJsonBlock(trimmed);
            if (jsonHtml) html = jsonHtml;
          }
        }

        if (!html) {
          const escaped = escapeCode(trimmed);
          const label = lang
            ? `<div class="text-xs text-gray-400 mb-2 uppercase tracking-wide">${escapeHtml(lang)}</div>`
            : '';
          html = `<div class="code-block-wrapper my-3">${label}<pre class="bg-gray-800 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono whitespace-pre-wrap"><code class="whitespace-pre-wrap">${escaped}</code></pre></div>`;
        }

        const ph = `__CODE_BLOCK_${codeIdx++}__`;
        codeBlocks[ph] = html;
        return ph;
      })

      // 2. Inline code
      .replace(/`([^`]+)`/g, (_m, code) => {
        return `<code class="bg-gray-200 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800">${escapeCode(code)}</code>`;
      })

      // 3. Bold & Italic
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>')

      // 4. Fact-extracted badges
      .replace(
        /\b(Fact extracted|Quote)\s+(\d+(?:-\d+)?)\b/gi,
        '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">$1 $2</span>'
      )

      // 5. Inline document references [filename.pdf:page]
      .replace(/\[([^\]]+\.pdf)(?::(\d+)(?::(\d+))?)?\]/gi, (_match, filename, page) => {
        const pageNum = page || 1;
        let documentId = '';
        if (citations.length > 0) {
          const c = citations.find(
            ct => ct.filename === filename || ct.filename.includes(filename) || filename.includes(ct.filename)
          );
          if (c) documentId = c.document_id || '';
        }
        const ef = escapeHtml(filename);
        const dp = page || '?';
        return `<button class="lex-chat-citation-link inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer transition-colors" data-document-id="${escapeHtml(documentId)}" data-filename="${ef}" data-page="${pageNum}" title="Click to open ${ef} at page ${dp}">${ef}${page ? `, page ${dp}` : ''}</button>`;
      })

      // 6. Markdown links [text](url) — PDF citation or regular
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
        const pdfMatch = text.match(/^(.+\.pdf)[,\s]*page\s+(\d+)/i);
        if (pdfMatch) {
          const fn = pdfMatch[1].trim();
          const pg = parseInt(pdfMatch[2], 10);
          const docIdMatch = url.match(/\/storage\/download\/([^/\\?&#]+)/);
          const docId = docIdMatch ? docIdMatch[1] : '';
          return `<button class="lex-chat-citation-link text-indigo-600 hover:text-indigo-800 hover:underline font-medium cursor-pointer" data-document-id="${escapeHtml(docId)}" data-filename="${escapeHtml(fn)}" data-page="${pg}" title="Click to open ${escapeHtml(fn)} at page ${pg}">${escapeHtml(text)}</button>`;
        }
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:text-indigo-800 hover:underline font-medium">${escapeHtml(text)}</a>`;
      });

    // 7. Block-level processing
    formatted = processBlocks(formatted);

    // 8. Restore code block placeholders
    for (const [ph, html] of Object.entries(codeBlocks)) {
      formatted = formatted.split(ph).join(html);
    }

    // 9. Process (extracts N, M) citation patterns
    if (citations.length > 0) {
      formatted = processCitationPatterns(formatted, citations);
    }

    return formatted;
  }

  /**
   * Format a single streaming chunk — lightweight version without block processing.
   * Used for progressive rendering while content is still arriving.
   */
  function formatBlock(content, citations) {
    return format(content, citations);
  }

  // ---------------------------------------------------------------------------
  // Citation pattern processing
  // ---------------------------------------------------------------------------

  function processCitationPatterns(text, citations) {
    const citationMap = {};
    citations.forEach((c, i) => { citationMap[i + 1] = c; });

    return text.replace(/\(extracts?\s+(\d+(?:,\s*\d+)*)\)/gi, (_match, numbers) => {
      const nums = numbers.split(',').map(n => parseInt(n.trim(), 10));
      const links = nums.map(num => {
        const c = citationMap[num];
        if (!c) return escapeHtml(String(num));
        const en = escapeHtml(String(num));
        const ed = escapeHtml(c.document_id || '');
        const ep = escapeHtml(String(c.page_number || 1));
        const ef = escapeHtml(c.filename || '');
        const title = escapeHtml(`View ${c.filename}${c.page_number ? ', page ' + c.page_number : ''}`);
        return `<a href="#" class="lex-chat-citation-link text-blue-600 hover:text-blue-800 underline font-medium" data-citation-num="${en}" data-document-id="${ed}" data-page="${ep}" data-filename="${ef}" title="${title}" onclick="event.preventDefault();">${en}</a>`;
      }).join(', ');
      return `(extracts ${links})`;
    });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  Lex.ChatFormat = {
    format,
    formatBlock,
    escapeHtml,
    escapeJsString,
    escapeCode,
    renderMermaidDiagrams
  };

})(typeof window !== 'undefined' ? window : globalThis);

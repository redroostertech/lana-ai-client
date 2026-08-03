(function (root) {
  'use strict';

  var state = {
    selectedDocument: null,
    selectedCrawlId: null,
    selectedSessionId: null,
    pendingApproval: null
  };

  function esc(value) {
    var input = String(value == null ? '' : value);
    var out = '';
    for (var i = 0; i < input.length; i += 1) {
      var ch = input.charAt(i);
      if (ch === '&') out += '&amp;';
      else if (ch === '<') out += '&lt;';
      else if (ch === '>') out += '&gt;';
      else if (ch === '"') out += '&quot;';
      else if (ch === "'") out += '&#39;';
      else out += ch;
    }
    return out;
  }

  function unwrap(response) {
    if (!response) return null;
    return response.data || response;
  }

  function renderHealth(data) {
    var body = unwrap(data) || {};
    var providers = body.providers || {};
    var capabilities = body.capabilities || {};
    var keys = ['search', 'fetch', 'normalization', 'crawl', 'browser', 'browserAgent', 'extraction'];
    return keys.map(function (key) {
      var item = providers[key] || {};
      var status = item.status || (capabilities[key] === false ? 'disabled' : 'unknown');
      return '<div class="owned-web-status"><strong>' + esc(key) + '</strong><span>' + esc(status) + '</span></div>';
    }).join('');
  }

  function renderSearchResults(results) {
    if (!results || !results.length) return '<div class="owned-web-muted">No results</div>';
    return results.map(function (result) {
      return '<div class="owned-web-item" data-result-url="' + esc(result.url) + '">' +
        '<strong>' + esc(result.title || result.url) + '</strong>' +
        '<span class="owned-web-muted">' + esc(result.domain || result.url) + '</span>' +
        '<p>' + esc(result.snippet || '') + '</p>' +
        '<button type="button" class="owned-web-button" data-owned-web-read="' + esc(result.url) + '">Read</button>' +
      '</div>';
    }).join('');
  }

  function renderProvenance(document) {
    var source = document && document.source ? document.source : {};
    var rows = [
      ['Original URL', source.originalUrl],
      ['Final URL', source.finalUrl],
      ['Mode', source.retrievalMode],
      ['Retrieved', source.retrievalTimestamp],
      ['Provider', source.retrievalProvider],
      ['Hash', source.contentHash],
      ['Crawl', source.crawlJobId],
      ['Ingestion', document && document.ingestionStatus]
    ];
    return rows.map(function (row) {
      return '<div><strong>' + esc(row[0]) + '</strong><br><span>' + esc(row[1] || '--') + '</span></div>';
    }).join('');
  }

  function renderCrawl(crawl) {
    if (!crawl) return '<div class="owned-web-muted">No crawl selected</div>';
    return '<div class="owned-web-item">' +
      '<strong>' + esc(crawl.id) + '</strong>' +
      '<span>Status: ' + esc(crawl.status) + '</span>' +
      '<span>Discovered: ' + esc(crawl.pagesDiscovered || 0) + ' | Processed: ' + esc(crawl.pagesProcessed || 0) + '</span>' +
      '<span>Failures: ' + esc((crawl.failures || []).length) + '</span>' +
    '</div>';
  }

  function renderCrawlResults(results) {
    var rows = (results && results.results) || [];
    if (!rows.length) return '<div class="owned-web-muted">No crawl results</div>';
    return rows.map(function (row) {
      return '<div class="owned-web-item">' +
        '<strong>' + esc(row.url || row.canonicalUrl) + '</strong>' +
        '<span class="owned-web-muted">Document: ' + esc(row.documentId || '--') + '</span>' +
        '<span>Changed: ' + esc(row.changed === false ? 'no' : 'yes') + '</span>' +
        (row.documentId ? '<button type="button" class="owned-web-button" data-owned-web-ingest="' + esc(row.documentId) + '">Add to LANA</button>' : '') +
      '</div>';
    }).join('');
  }

  function renderApproval(approval) {
    if (!approval || !approval.approvalRequired) return '<div class="owned-web-muted">No approval waiting</div>';
    return '<div class="owned-web-approval">' +
      '<h3>Browser approval</h3>' +
      '<div class="owned-web-provenance">' +
        '<div><strong>Approval</strong><br><span>' + esc(approval.approvalId) + '</span></div>' +
        '<div><strong>Risk</strong><br><span>' + esc(approval.risk) + '</span></div>' +
        '<div><strong>Action</strong><br><span>' + esc(approval.action && approval.action.type) + '</span></div>' +
        '<div><strong>Expires</strong><br><span>' + esc(approval.expiresAt) + '</span></div>' +
      '</div>' +
      '<div class="owned-web-row">' +
        '<button type="button" class="owned-web-button primary" data-owned-web-approve>Approve</button>' +
        '<button type="button" class="owned-web-button danger" data-owned-web-deny>Deny</button>' +
      '</div>' +
    '</div>';
  }

  function api() {
    return root.electronAPI && root.electronAPI.ownedWeb;
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setHtml(id, value) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }

  async function refreshHealth() {
    if (!api()) return;
    var health = await api().health();
    setHtml('owned-web-health-grid', renderHealth(health));
    var body = unwrap(health) || {};
    setText('owned-web-mode', body.mode || 'unknown');
    setText('owned-web-master', body.status || 'unknown');
  }

  async function submitSearch(event) {
    event.preventDefault();
    var query = document.getElementById('owned-web-query').value;
    var response = await api().search({ query: query, limit: 10 });
    var data = unwrap(response) || {};
    setHtml('owned-web-results', renderSearchResults(data.results || []));
  }

  async function readUrl(url) {
    var response = await api().read({ url: url });
    var data = unwrap(response) || {};
    state.selectedDocument = data.document || null;
    setText('owned-web-document-title', state.selectedDocument ? (state.selectedDocument.title || 'Untitled') : 'No document');
    setText('owned-web-markdown', state.selectedDocument ? (state.selectedDocument.markdown || state.selectedDocument.plainText || '') : '');
    setHtml('owned-web-provenance', renderProvenance(state.selectedDocument));
  }

  async function startCrawl(event) {
    event.preventDefault();
    var seed = document.getElementById('owned-web-crawl-seed').value;
    var response = await api().startCrawl({
      seedUrls: [seed],
      maxDepth: Number(document.getElementById('owned-web-crawl-depth').value || 1),
      maxPages: Number(document.getElementById('owned-web-crawl-pages').value || 25)
    });
    var crawl = unwrap(response);
    state.selectedCrawlId = crawl && crawl.id;
    setHtml('owned-web-crawl-status', renderCrawl(crawl));
  }

  async function refreshCrawl() {
    if (!state.selectedCrawlId) return;
    var crawl = unwrap(await api().getCrawl(state.selectedCrawlId));
    setHtml('owned-web-crawl-status', renderCrawl(crawl));
    var results = unwrap(await api().getCrawlResults(state.selectedCrawlId, { limit: 100, includeFailures: true }));
    setHtml('owned-web-crawl-results', renderCrawlResults(results));
  }

  async function openBrowser() {
    var target = document.getElementById('owned-web-browser-url').value;
    var session = unwrap(await api().openBrowserSession({
      executionTarget: document.getElementById('owned-web-browser-target').value,
      allowedOrigins: target ? [target] : []
    }));
    state.selectedSessionId = session && session.id;
    setText('owned-web-session', state.selectedSessionId || 'No session');
    if (target && state.selectedSessionId) {
      await api().executeBrowserAction(state.selectedSessionId, { type: 'navigate', url: target });
      await snapshotBrowser();
    }
  }

  async function snapshotBrowser() {
    if (!state.selectedSessionId) return;
    var result = unwrap(await api().snapshotBrowserSession(state.selectedSessionId));
    setText('owned-web-browser-snapshot', JSON.stringify(result.result || result, null, 2));
  }

  async function previewSubmit() {
    if (!state.selectedSessionId) return;
    state.pendingApproval = unwrap(await api().previewBrowserAction(state.selectedSessionId, {
      type: 'requestSubmission',
      selector: document.getElementById('owned-web-submit-selector').value || 'form button[type="submit"]'
    }));
    setHtml('owned-web-approval', renderApproval(state.pendingApproval));
  }

  async function decidePending(decision) {
    if (!state.pendingApproval || !state.pendingApproval.approvalId) return;
    await api().decideApproval(state.pendingApproval.approvalId, decision);
    if (decision === 'approved') {
      await api().executeBrowserAction(state.selectedSessionId, {
        type: 'requestSubmission',
        selector: state.pendingApproval.action.selector,
        approvalId: state.pendingApproval.approvalId
      });
      await snapshotBrowser();
    }
    state.pendingApproval = null;
    setHtml('owned-web-approval', renderApproval(null));
  }

  async function ingest(documentId) {
    await api().ingestDocument({ documentId: documentId || (state.selectedDocument && state.selectedDocument.id) });
    setText('owned-web-ingest-status', 'pending_review');
  }

  function bind() {
    if (!api()) return;
    document.getElementById('owned-web-search-form')?.addEventListener('submit', submitSearch);
    document.getElementById('owned-web-crawl-form')?.addEventListener('submit', startCrawl);
    document.getElementById('owned-web-health-refresh')?.addEventListener('click', refreshHealth);
    document.getElementById('owned-web-crawl-refresh')?.addEventListener('click', refreshCrawl);
    document.getElementById('owned-web-browser-open')?.addEventListener('click', openBrowser);
    document.getElementById('owned-web-browser-snapshot-btn')?.addEventListener('click', snapshotBrowser);
    document.getElementById('owned-web-preview-submit')?.addEventListener('click', previewSubmit);
    document.getElementById('owned-web-ingest-current')?.addEventListener('click', function () { ingest(); });
    document.addEventListener('click', function (event) {
      var read = event.target.closest('[data-owned-web-read]');
      if (read) readUrl(read.getAttribute('data-owned-web-read'));
      var ingestBtn = event.target.closest('[data-owned-web-ingest]');
      if (ingestBtn) ingest(ingestBtn.getAttribute('data-owned-web-ingest'));
      if (event.target.closest('[data-owned-web-approve]')) decidePending('approved');
      if (event.target.closest('[data-owned-web-deny]')) decidePending('denied');
    });
    refreshHealth();
  }

  root.LanaOwnedWebUI = {
    renderHealth: renderHealth,
    renderSearchResults: renderSearchResults,
    renderProvenance: renderProvenance,
    renderCrawl: renderCrawl,
    renderCrawlResults: renderCrawlResults,
    renderApproval: renderApproval,
    esc: esc
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', bind);
  }

  if (typeof module !== 'undefined') {
    module.exports = root.LanaOwnedWebUI;
  }
})(typeof window !== 'undefined' ? window : globalThis);

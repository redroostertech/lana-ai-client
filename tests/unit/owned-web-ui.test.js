const ui = require('../../public_html/js/owned-web');

describe('owned-web renderer helpers', () => {
  test('escapes untrusted web content before rendering', () => {
    expect(ui.esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('renders provider health without exposing provider configuration', () => {
    const html = ui.renderHealth({
      data: {
        status: 'degraded',
        mode: 'owned',
        providers: {
          search: { status: 'ok', secret: 'do-not-render' },
          browser: { status: 'degraded' }
        }
      }
    });

    expect(html).toContain('search');
    expect(html).toContain('ok');
    expect(html).toContain('browser');
    expect(html).not.toContain('do-not-render');
  });

  test('renders provenance and explicit ingestion controls safely', () => {
    const html = ui.renderProvenance({
      ingestionStatus: 'not_ingested',
      source: {
        originalUrl: 'https://example.com/a',
        finalUrl: 'https://example.com/a',
        retrievalMode: 'static_http',
        contentHash: '<hash>'
      }
    });

    expect(html).toContain('Original URL');
    expect(html).toContain('not_ingested');
    expect(html).toContain('&lt;hash&gt;');
  });

  test('renders exact browser approval action details', () => {
    const html = ui.renderApproval({
      approvalRequired: true,
      approvalId: 'approval-1',
      risk: 'legally_consequential_action',
      action: { type: 'requestSubmission', selector: '#submit' },
      expiresAt: '2026-08-02T00:05:00.000Z'
    });

    expect(html).toContain('approval-1');
    expect(html).toContain('legally_consequential_action');
    expect(html).toContain('requestSubmission');
    expect(html).toContain('data-owned-web-approve');
    expect(html).toContain('data-owned-web-deny');
  });

  test('renders crawl results with explicit Add to LANA controls', () => {
    const html = ui.renderCrawlResults({
      results: [{ url: 'https://example.com', documentId: 'webdoc_1', changed: true }]
    });

    expect(html).toContain('webdoc_1');
    expect(html).toContain('data-owned-web-ingest');
  });
});

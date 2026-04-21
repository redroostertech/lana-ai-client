const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('documentLifecycle utility', () => {
  function loadScript(filePath, context) {
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(code, context);
  }

  function createContext() {
    const context = {
      console: {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn()
      },
      setTimeout,
      clearTimeout
    };
    context.window = context;
    return vm.createContext(context);
  }

  test('derives lifecycle and summary states from document fields', () => {
    const context = createContext();
    loadScript(path.join(__dirname, '../../src/js/utils/document-lifecycle.js'), context);

    const util = context.window.documentLifecycle;

    expect(util.getDocumentLifecycle({
      status: 'processing',
      metadata: { parser_provenance: 'docling' }
    })).toBe('parsed');

    expect(util.getDocumentLifecycle({
      status: 'completed',
      chunk_count: 3,
      vector_count: 3,
      metadata: { ingestion_stage: 'indexed' }
    })).toBe('ready');

    expect(util.getDocumentSummaryState({
      status: 'completed',
      chunk_count: 3,
      vector_count: 3,
      summary_method: 'queued'
    })).toBe('pending');

    const summarized = util.getDocumentLifecycleDisplay({
      status: 'completed',
      chunk_count: 3,
      vector_count: 3,
      summary: 'Short summary',
      summary_generated_at: '2026-04-20T10:00:00Z'
    });

    expect(summarized.state).toBe('summarized');
    expect(summarized.isReady).toBe(true);
    expect(summarized.isActionableInChat).toBe(true);
  });

  test('metadata formatter exposes lifecycle helpers when utility is loaded', () => {
    const context = createContext();
    loadScript(path.join(__dirname, '../../src/js/utils/document-lifecycle.js'), context);
    loadScript(path.join(__dirname, '../../src/js/utils/metadata-formatter.js'), context);

    const formatter = context.window.metadataFormatter;
    const lifecycle = formatter.formatDocumentLifecycle({
      status: 'completed',
      chunk_count: 2,
      vector_count: 2,
      summary_method: 'queued'
    });

    const summary = formatter.formatSummaryState({
      status: 'completed',
      chunk_count: 2,
      vector_count: 2,
      summary_method: 'queued'
    });

    expect(lifecycle.label).toBe('Ready');
    expect(lifecycle.progressLabel).toContain('summary pending');
    expect(summary.state).toBe('pending');
    expect(summary.text).toBe('Summary pending');
  });
});

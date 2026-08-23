'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadApi() {
  class TestFormData {
    constructor() { this.values = []; }
    append(name, value) { this.values.push([name, value]); }
  }
  const context = {
    console,
    URLSearchParams,
    AbortController,
    FormData: TestFormData,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: jest.fn(),
    localStorage: {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn()
    },
    document: {
      addEventListener: jest.fn(),
      body: {},
      getElementById: jest.fn(() => null)
    },
    location: {
      protocol: 'http:',
      origin: 'http://client.test',
      pathname: '/app.html'
    },
    LanaConfig: {},
    LanaTime: {
      nowMs: jest.fn(() => 1000),
      nowIso: jest.fn(() => '2026-08-23T00:00:00.000Z'),
      millisecondsSince: jest.fn((start) => 1000 - start),
      MS_PER_MINUTE: 60000,
      MS_PER_HOUR: 3600000,
      formatUtcDateOnly: jest.fn(() => '2026-08-23')
    }
  };
  context.window = context;
  context.globalThis = context;
  const apiPath = path.join(__dirname, '../../src/js/api.js');
  vm.runInNewContext(fs.readFileSync(apiPath, 'utf8'), context, { filename: apiPath });
  return { api: context.window.api, fetch: context.fetch };
}

describe('ApiClient document upload contract', () => {
  test('returns an explicit successful duplicate result when storage skips identical content', async () => {
    const { api, fetch } = loadApi();
    api.baseUrl = 'http://api.test';
    api.token = 'token';
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'completed',
        stats: { scanned: 0, new: 0, skipped: 1, uploaded: 0, queued: 0, failed: 0 },
        results: []
      })
    });

    const result = await api.uploadDocument({ name: 'control-deck.pptx', size: 32 }, 'matter-uuid');

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      duplicate: true,
      matter_id: 'matter-uuid',
      filename: 'control-deck.pptx',
      status: 'skipped'
    });
    expect(result.file_id).toBeNull();
    expect(fetch).toHaveBeenCalledWith('http://api.test/api/v1/storage/files/upload', expect.objectContaining({
      method: 'POST'
    }));
  });

  test('rejects a nominal success response that neither creates nor skips a file', async () => {
    const { api, fetch } = loadApi();
    api.baseUrl = 'http://api.test';
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'completed', stats: { skipped: 0 }, results: [] })
    });

    await expect(api.uploadDocument({ name: 'missing.docx', size: 1 }, 'matter-uuid'))
      .rejects.toThrow('Upload completed without a document result');
  });
});

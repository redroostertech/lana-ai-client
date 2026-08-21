'use strict';

const service = require('../../src/js/services/file-editor-content-api.service.js');

function response(options) {
  const settings = options || {};
  return {
    ok: settings.ok !== false,
    headers: {
      get: jest.fn((name) => ({
        'Content-Disposition': settings.disposition || '',
        'Content-Type': settings.contentType || 'application/octet-stream'
      })[name] || null)
    },
    text: jest.fn().mockResolvedValue(settings.text || ''),
    blob: jest.fn().mockResolvedValue(settings.blob || { bytes: true })
  };
}

describe('File Editor content API', () => {
  test('loads and saves edit models through the authenticated JSON client', async () => {
    const api = {
      get: jest.fn().mockResolvedValue({ data: { model: { kind: 'sheet', cells: [['A']] }, document: { id: 'doc-1' } } }),
      put: jest.fn().mockResolvedValue({ model: { kind: 'sheet', cells: [['B']] }, document: { id: 'doc-1' } })
    };
    const client = service.create({ api });

    await expect(client.getEditModel('doc/1')).resolves.toEqual({
      model: { kind: 'sheet', cells: [['A']] },
      document: { id: 'doc-1' }
    });
    await expect(client.saveEditModel('doc/1', { kind: 'sheet', cells: [['B']] })).resolves.toEqual({
      model: { kind: 'sheet', cells: [['B']] },
      document: { id: 'doc-1' }
    });
    expect(api.get).toHaveBeenCalledWith('/api/v1/file-editor/documents/doc%2F1/edit-model');
    expect(api.put).toHaveBeenCalledWith('/api/v1/file-editor/documents/doc%2F1/edit-model', {
      model: { kind: 'sheet', cells: [['B']] }
    });
  });

  test('downloads raw export bytes with auth and honors Content-Disposition', async () => {
    const fetch = jest.fn().mockResolvedValue(response({
      disposition: 'attachment; filename="matter-deck.pptx"',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      blob: { pptx: true }
    }));
    const api = {
      baseUrl: 'https://lana.example/',
      _readyPromise: Promise.resolve(),
      get: jest.fn(),
      put: jest.fn(),
      getHeaders: jest.fn(() => ({ Authorization: 'Bearer token', 'Content-Type': 'application/json' }))
    };
    const client = service.create({ api, fetch });

    await expect(client.exportDocument('deck-1', 'pptx')).resolves.toEqual({
      blob: { pptx: true },
      filename: 'matter-deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://lana.example/api/v1/file-editor/documents/deck-1/export',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: JSON.stringify({ format: 'pptx' })
      })
    );
  });

  test('rejects unsupported exports and surfaces structured byte errors', async () => {
    const fetch = jest.fn().mockResolvedValue(response({
      ok: false,
      text: JSON.stringify({ error: { message: 'PPTX export is unavailable.' } })
    }));
    const api = { baseUrl: '', get: jest.fn(), put: jest.fn(), getHeaders: jest.fn(() => ({})) };
    const client = service.create({ api, fetch });

    await expect(client.exportDocument('doc-1', 'pdf')).rejects.toThrow('Export format must be csv, xlsx, or pptx.');
    await expect(client.exportDocument('doc-1', 'pptx')).rejects.toThrow('PPTX export is unavailable.');
  });
});

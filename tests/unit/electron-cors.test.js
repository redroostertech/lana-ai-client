const { addMissingCorsHeaders } = require('../../electron-cors');

describe('Electron CORS response fallback', () => {
  test('preserves an upstream origin header regardless of its casing', () => {
    const headers = addMissingCorsHeaders({
      'access-control-allow-origin': ['*'],
      'content-type': ['font/woff2']
    });

    expect(headers['access-control-allow-origin']).toEqual(['*']);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(Object.keys(headers).filter((key) => (
      key.toLowerCase() === 'access-control-allow-origin'
    ))).toHaveLength(1);
  });

  test('adds fallback headers when the backend did not provide them', () => {
    const headers = addMissingCorsHeaders({ 'content-type': ['application/json'] });
    expect(headers['Access-Control-Allow-Origin']).toEqual(['*']);
    expect(headers['Access-Control-Allow-Methods']).toEqual(['GET, POST, PUT, DELETE, OPTIONS']);
    expect(headers['Access-Control-Allow-Headers']).toEqual(['Content-Type, Authorization']);
  });

  test('does not mutate the Electron response header object', () => {
    const original = { 'content-type': ['application/json'] };
    addMissingCorsHeaders(original);
    expect(original).toEqual({ 'content-type': ['application/json'] });
  });
});

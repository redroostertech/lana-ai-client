'use strict';

// CORS for the app origin, answered in the main process (electron-cors.js,
// docs/plans/harden-web.md): only for responses from the configured origins,
// only with the exact app origin, never '*'.

const { corsResponseFor } = require('../../electron-cors');

const APP = 'lana-app://app';
const ALLOWED = ['https://chef.firm.test', 'http://127.0.0.1:53117'];
const options = { appOrigin: APP, allowedOrigins: ALLOWED };

describe('corsResponseFor', () => {
  test('a configured origin answers with the exact app origin, replacing any spelling the server sent', () => {
    const out = corsResponseFor({
      url: 'https://chef.firm.test/api/v1/me',
      method: 'GET',
      statusCode: 200,
      responseHeaders: { 'content-type': ['application/json'], 'access-control-allow-origin': ['https://web.firm.test'], 'Access-Control-Allow-Credentials': ['true'] }
    }, options);
    const names = Object.keys(out.responseHeaders).map((n) => n.toLowerCase());
    expect(names.filter((n) => n === 'access-control-allow-origin')).toHaveLength(1);
    expect(names).not.toContain('access-control-allow-credentials');
    expect(out.responseHeaders['Access-Control-Allow-Origin']).toEqual([APP]);
    expect(out.responseHeaders['Access-Control-Allow-Headers']).toEqual(['*, Authorization']);
    expect(out.responseHeaders['Access-Control-Expose-Headers']).toEqual(['*']);
    expect(out.responseHeaders['content-type']).toEqual(['application/json']);
    expect(out.statusLine).toBeUndefined();
  });

  test('a preflight the server did not answer becomes 204; an answered one keeps its status', () => {
    const base = { url: 'https://chef.firm.test/api/v1/matters', method: 'OPTIONS', responseHeaders: {} };
    expect(corsResponseFor({ ...base, statusCode: 404 }, options).statusLine).toBe('HTTP/1.1 204 No Content');
    expect(corsResponseFor({ ...base, statusCode: 401 }, options).statusLine).toBe('HTTP/1.1 204 No Content');
    expect(corsResponseFor({ ...base, statusCode: 204 }, options).statusLine).toBeUndefined();
    // Only OPTIONS: a failed GET keeps its real status.
    expect(corsResponseFor({ ...base, method: 'GET', statusCode: 404 }, options).statusLine).toBeUndefined();
  });

  test('any other site is left exactly as it answered (embedded partner pages, fonts, remote documents)', () => {
    expect(corsResponseFor({ url: 'https://fonts.gstatic.com/x.woff2', method: 'GET', statusCode: 200, responseHeaders: { 'access-control-allow-origin': ['*'] } }, options)).toEqual({});
    expect(corsResponseFor({ url: 'https://chef.firm.test.evil.example/api', method: 'OPTIONS', statusCode: 404 }, options)).toEqual({});
    // Same host, other port or scheme: not configured.
    expect(corsResponseFor({ url: 'http://chef.firm.test/api', method: 'GET', statusCode: 200 }, options)).toEqual({});
    expect(corsResponseFor({ url: 'http://127.0.0.1:53118/v1/x', method: 'GET', statusCode: 200 }, options)).toEqual({});
    expect(corsResponseFor({ url: 'lana-app://app/public_html/x.js', method: 'GET', statusCode: 200 }, options)).toEqual({});
  });

  test('never answers with a wildcard origin, and fails closed without configuration', () => {
    const out = corsResponseFor({ url: 'http://127.0.0.1:53117/v1/redline', method: 'POST', statusCode: 200, responseHeaders: {} }, options);
    expect(out.responseHeaders['Access-Control-Allow-Origin']).not.toContain('*');
    expect(corsResponseFor({ url: 'https://chef.firm.test/api', method: 'GET' }, { appOrigin: APP, allowedOrigins: [] })).toEqual({});
    expect(corsResponseFor({ url: 'https://chef.firm.test/api', method: 'GET' }, { appOrigin: '', allowedOrigins: ALLOWED })).toEqual({});
  });

  test('does not mutate the response header object Electron passed in', () => {
    const responseHeaders = Object.freeze({ 'content-type': ['application/json'] });
    expect(() => corsResponseFor({ url: 'https://chef.firm.test/api', method: 'GET', statusCode: 200, responseHeaders }, options)).not.toThrow();
  });
});

/**
 * Regression: document metadata went to http://localhost:8080 because it asked
 * window.electronAPI.config for the server address, which the preload never
 * defines. It now goes through the app's API client (window.api), which knows
 * the organization's server like every other page.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/js/services/metadata-service.js'), 'utf8');

function load(api) {
  const fetchCalls = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url) => { fetchCalls.push(url); throw new Error('no network in tests'); },
    Date,
    Map,
    Promise,
  };
  sandbox.window = sandbox;
  sandbox.window.api = api;
  sandbox.window.electronAPI = {};
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { service: sandbox.metadataService, fetchCalls };
}

function fakeApi(responses) {
  const calls = [];
  const handler = (method) => async (endpoint, body) => {
    calls.push({ method, endpoint, body });
    const r = responses[`${method} ${endpoint}`];
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, get: handler('GET'), put: handler('PUT'), post: handler('POST') };
}

test('metadata is read, updated and reindexed through window.api, never localhost', async () => {
  const api = fakeApi({
    'GET /api/v1/documents/d1': { document: { id: 'd1', title: 'Lease' } },
    'PUT /api/v1/documents/d1/metadata': { document: { id: 'd1', title: 'Lease v2' } },
    'POST /api/v1/documents/d1/reindex': { job_id: 'j1' },
  });
  const { service, fetchCalls } = load(api);

  await expect(service.fetchFromAPI('d1')).resolves.toEqual({ id: 'd1', title: 'Lease' });
  await expect(service.updateMetadata('d1', { title: 'Lease v2' })).resolves.toEqual({ id: 'd1', title: 'Lease v2' });
  await expect(service.reindexDocument('d1')).resolves.toEqual({ job_id: 'j1' });

  expect(api.calls.map((c) => `${c.method} ${c.endpoint}`)).toEqual([
    'GET /api/v1/documents/d1',
    'PUT /api/v1/documents/d1/metadata',
    'POST /api/v1/documents/d1/reindex',
  ]);
  expect(api.calls[1].body).toEqual({ title: 'Lease v2' });
  expect(fetchCalls).toEqual([]);
  expect(SOURCE).not.toContain('localhost:8080');
});

test('server refusals keep their plain messages', async () => {
  const notFound = Object.assign(new Error('Not found'), { status: 404 });
  const { service } = load(fakeApi({ 'GET /api/v1/documents/x': notFound }));
  await expect(service.fetchFromAPI('x')).rejects.toThrow('Document not found');
});

test('without the API client it says to sign in instead of calling a made-up address', async () => {
  const { service, fetchCalls } = load(undefined);
  await expect(service.fetchFromAPI('d1')).rejects.toThrow(/Sign in and try again/);
  expect(fetchCalls).toEqual([]);
});

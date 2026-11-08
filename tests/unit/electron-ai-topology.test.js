'use strict';

/** Settings > Capabilities > AI models: where LANA's AI can run (electron-ai-topology.js). */
const { aiTopology, pipEndpoint, catalogModels } = require('../../electron-ai-topology');

function response(status, body) {
  return { status, ok: status < 400, json: async () => body };
}

function fakeFetch(routes) {
  return async (url) => {
    if (!(url in routes)) throw new Error('ECONNREFUSED');
    const [status, body] = routes[url];
    return response(status, body);
  };
}

describe('pipEndpoint', () => {
  test('not set, not running, running with its model and build', async () => {
    expect(await pipEndpoint(undefined, fakeFetch({}))).toEqual({ url: null, state: 'not_set', version: null, model: null, build: null });
    expect(await pipEndpoint('http://127.0.0.1:8081/', fakeFetch({}))).toEqual({ url: 'http://127.0.0.1:8081', state: 'not_running', version: null, model: null, build: null });
    const running = await pipEndpoint('http://127.0.0.1:8081', fakeFetch({
      'http://127.0.0.1:8081/health': [200, { status: 'ok' }],
      'http://127.0.0.1:8081/props': [200, { model_path: '/models/Qwen3.5-9B-Q4_K_M.gguf', build_info: 'b3.0.0-ddedf87af419' }],
    }));
    expect(running).toEqual({ url: 'http://127.0.0.1:8081', state: 'running', version: null, model: 'Qwen3.5-9B-Q4_K_M.gguf', build: 'b3.0.0-ddedf87af419' });
  });

  test('Pip says its version, build and model on /health', async () => {
    const pip = await pipEndpoint('http://127.0.0.1:8081', fakeFetch({
      'http://127.0.0.1:8081/health': [200, { status: 'ok', version: '3.0.0', build: 'ddedf87af419', model: 'Qwen3.8-9B-Q4_K_M' }],
    }));
    expect(pip).toEqual({ url: 'http://127.0.0.1:8081', state: 'running', version: '3.0.0', model: 'Qwen3.8-9B-Q4_K_M', build: 'ddedf87af419' });
  });

  test('a server error is not running', async () => {
    expect((await pipEndpoint('http://x', fakeFetch({ 'http://x/health': [503, {}] }))).state).toBe('not_running');
  });
});

describe('catalogModels', () => {
  test('downloaded when the file is in place at its catalog size', () => {
    const catalog = [{ id: 'a', name: 'A', role: 'chat', filename: 'a.gguf', sizeBytes: 100 }, { id: 'b', name: 'B', role: 'embedding', filename: 'b.gguf', sizeBytes: 50 }];
    const sizes = { '/m/a.gguf': 100, '/m/b.gguf': 12 };
    const stat = (file) => { if (!(file in sizes)) throw new Error('ENOENT'); return { size: sizes[file] }; };
    expect(catalogModels(catalog, '/m', stat).map((m) => [m.id, m.downloaded])).toEqual([['a', true], ['b', false]]);
    expect(catalogModels(catalog, null, stat).every((m) => !m.downloaded)).toBe(true);
  });
});

describe('aiTopology', () => {
  test('local model servers, the server and Forge', async () => {
    const topology = await aiTopology({
      env: { LANA_ENGINE_CHAT_URL: 'http://127.0.0.1:8081' },
      savedServer: { url: 'http://127.0.0.1:47011', chefUrl: 'http://127.0.0.1:8080', forgeUrl: 'https://forge-api.lanaai.io', forgeSovereign: null },
      fetchImpl: fakeFetch({ 'https://forge-api.lanaai.io/health': [200, { status: 'ok' }] }),
    });
    expect(topology.pip.chat.state).toBe('not_running');
    expect(topology.pip.embedding.state).toBe('not_set');
    expect(topology.server).toEqual({ url: 'http://127.0.0.1:8080' });
    expect(topology.forge).toEqual({ url: 'https://forge-api.lanaai.io', reachable: true, sovereign: false });
  });

  test('no Forge address: nothing to reach', async () => {
    const topology = await aiTopology({ env: {}, savedServer: null, fetchImpl: fakeFetch({}) });
    expect(topology.forge).toEqual({ url: null, reachable: null, sovereign: false });
    expect(topology.server.url).toBeNull();
  });
});

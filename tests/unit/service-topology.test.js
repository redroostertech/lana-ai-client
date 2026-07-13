'use strict';

const { buildServiceSpecs, gpuLayersFor } = require('../../supervisor/service-topology');

// Fake probes: return a tagged sentinel so we can assert wiring without I/O.
const fakeProbes = {
  httpProbe: (o) => Object.assign(() => Promise.resolve(true), { __http: o.url }),
  tcpProbe: (o) => Object.assign(() => Promise.resolve(true), { __tcp: o.port }),
};

const secrets = {
  POSTGRES_PASSWORD: 'pgpass', MINIO_ACCESS_KEY: 'lanaAK', MINIO_SECRET_KEY: 'minioSK',
  JWT_SECRET: 'jwt', MFA_ENCRYPTION_KEY: 'mfa', WEBHOOK_SECRET_ENCRYPTION_KEY: 'wh',
};

function baseCfg(extra = {}) {
  return {
    paths: {
      postgres: '/pg/bin/postgres', minio: '/bin/minio', llamaServer: '/llama/llama-server',
      embedModel: '/models/nomic.gguf', node: 'node', backendCwd: '/lana-one',
      ...(extra.paths || {}),
    },
    dataDirs: { pg: '/data/pg', minio: '/data/minio' },
    secrets, tier: 'edge', desktopKey: 'dk-123',
    ...extra,
  };
}

describe('buildServiceSpecs', () => {
  it('emits the minimal stack in order with correct backend deps', () => {
    const specs = buildServiceSpecs(baseCfg(), fakeProbes);
    expect(specs.map((s) => s.name)).toEqual(['postgres', 'minio', 'llama-embed', 'backend']);
    const backend = specs.find((s) => s.name === 'backend');
    expect(backend.dependsOn).toEqual(['postgres', 'minio', 'llama-embed']);
    expect(backend.critical).toBe(true);
  });

  it('wires postgres args + first-run hooks', () => {
    const prepare = () => {};
    const onReady = () => {};
    const specs = buildServiceSpecs(baseCfg({ hooks: { postgresPrepare: prepare, postgresOnReady: onReady } }), fakeProbes);
    const pg = specs.find((s) => s.name === 'postgres');
    expect(pg.command).toBe('/pg/bin/postgres');
    expect(pg.args).toEqual(['-D', '/data/pg', '-p', '5432', '-c', 'listen_addresses=127.0.0.1']);
    expect(pg.prepare).toBe(prepare);
    expect(pg.onReady).toBe(onReady);
    expect(pg.readiness.__tcp).toBe(5432);
  });

  it('passes minio credentials from secrets', () => {
    const minio = buildServiceSpecs(baseCfg(), fakeProbes).find((s) => s.name === 'minio');
    expect(minio.env.MINIO_ROOT_USER).toBe('lanaAK');
    expect(minio.env.MINIO_ROOT_PASSWORD).toBe('minioSK');
    expect(minio.args).toContain('server');
    expect(minio.args).toContain('--address');
  });

  it('builds a complete backend env and never sets "undefined"', () => {
    const backend = buildServiceSpecs(baseCfg(), fakeProbes).find((s) => s.name === 'backend');
    const e = backend.env;
    expect(e.IS_LANA_ONE).toBe('true');
    expect(e.PORT).toBe('8090');
    expect(e.LANA_TIER).toBe('edge');
    expect(e.LANA_DESKTOP_KEY).toBe('dk-123');
    expect(e.DATABASE_URL).toBe('postgresql://postgres:pgpass@127.0.0.1:5432/lana_chef');
    expect(e.MINIO_ACCESS_KEY).toBe('lanaAK');
    expect(e.MINIO_DOCUMENTS_BUCKET).toBe('lana-documents');
    expect(e.LLAMACPP_EMBEDDING_URL).toBe('http://127.0.0.1:8082');
    expect(e.JWT_SECRET).toBe('jwt');
    // no local chat model -> LLAMACPP_MAIN_URL must be absent (routes to relay)
    expect(e.LLAMACPP_MAIN_URL).toBeUndefined();
    expect(Object.values(e)).not.toContain('undefined');
  });

  it('adds optional local chat + doc parsers when their paths are provided', () => {
    const specs = buildServiceSpecs(baseCfg({
      paths: {
        chatModel: '/models/qwen.gguf',
        doclingCmd: '/bin/docling-server',
        unstructuredUvicorn: '/venv/bin/uvicorn', unstructuredCwd: '/venv/src',
      },
    }), fakeProbes);
    const names = specs.map((s) => s.name);
    expect(names).toContain('llama-chat');
    expect(names).toContain('docling');
    expect(names).toContain('unstructured');
    // optional services are non-critical (backend degrades)
    expect(specs.find((s) => s.name === 'llama-chat').critical).toBe(false);
    expect(specs.find((s) => s.name === 'docling').critical).toBe(false);
    const e = specs.find((s) => s.name === 'backend').env;
    expect(e.LLAMACPP_MAIN_URL).toBe('http://127.0.0.1:8081');
    expect(e.DOCLING_API_URL).toBe('http://127.0.0.1:8085');
    expect(e.UNSTRUCTURED_API_URL).toBe('http://127.0.0.1:8000');
  });
});

describe('gpuLayersFor (pure fn of the detected backend)', () => {
  it('full-offloads on Metal', () => {
    expect(gpuLayersFor({ backend: 'metal' })).toBe('99');
  });
  it('full-offloads on ample-VRAM CUDA, partial on a small card', () => {
    expect(gpuLayersFor({ backend: 'cuda', vramGB: 24 })).toBe('99');
    expect(gpuLayersFor({ backend: 'cuda', vramGB: 6 })).toBe('20');
  });
  it('offloads nothing on CPU', () => {
    expect(gpuLayersFor({ backend: 'cpu' })).toBe('0');
  });
  it('defaults to full offload when accel is absent (Apple-Silicon builds shipping today)', () => {
    expect(gpuLayersFor(undefined)).toBe('99');
  });
});

describe('--n-gpu-layers wiring from cfg.accel', () => {
  const nGpuOf = (spec) => {
    const i = spec.args.indexOf('--n-gpu-layers');
    return i >= 0 ? spec.args[i + 1] : undefined;
  };
  const buildWith = (accel) => buildServiceSpecs(baseCfg({
    accel,
    paths: { chatModel: '/models/qwen.gguf' },
  }), fakeProbes);

  it('propagates the backend-chosen value to embed + chat llama servers (CUDA)', () => {
    const specs = buildWith({ backend: 'cuda', vramGB: 24 });
    expect(nGpuOf(specs.find((s) => s.name === 'llama-embed'))).toBe('99');
    expect(nGpuOf(specs.find((s) => s.name === 'llama-chat'))).toBe('99');
  });

  it('uses 0 GPU layers on the CPU backend', () => {
    const specs = buildWith({ backend: 'cpu' });
    expect(nGpuOf(specs.find((s) => s.name === 'llama-embed'))).toBe('0');
    expect(nGpuOf(specs.find((s) => s.name === 'llama-chat'))).toBe('0');
  });

  it('uses a partial offload on a small CUDA card', () => {
    const specs = buildWith({ backend: 'cuda', vramGB: 6 });
    expect(nGpuOf(specs.find((s) => s.name === 'llama-chat'))).toBe('20');
  });
});

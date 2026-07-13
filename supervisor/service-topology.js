/**
 * service-topology.js
 *
 * Builds the ordered set of ProcessSupervisor specs for the LANA One sovereign
 * stack, from the LANA-AI PM2 start commands (recon-mapped). Every binary path,
 * data dir, port and secret is parameterized so the SAME topology drives the dev
 * stack (Homebrew/source binaries) today and the bundled binaries after Phase B —
 * only the `paths` change.
 *
 * Dependency order: postgres, minio, llama-embed come up first (no deps); the
 * optional local chat model + doc parsers are non-critical (backend degrades to
 * the relay / native parser); the Node backend depends on postgres+minio+embed.
 *
 * First-run Postgres init (initdb / createdb / extensions / migrate) is NOT here —
 * it attaches as the postgres spec's prepare()/onReady() hooks from postgres-init,
 * keeping this module a pure spec builder.
 */
'use strict';

const defaultProbes = require('./probes');

// Drop undefined values so we never set an env var to the string "undefined".
function cleanEnv(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = String(v);
  return out;
}

/**
 * @param {object} cfg
 * @param {object} cfg.paths - { postgres, initdb, psql, createdb, minio, llamaServer, embedModel,
 *                               chatModel?, doclingCmd?, unstructuredUvicorn?, unstructuredCwd?,
 *                               node, backendCwd }
 * @param {object} cfg.dataDirs - { pg, minio }
 * @param {object} [cfg.ports] - overrides for { pg, minio, minioConsole, llamaEmbed, llamaChat, docling, unstructured, backend }
 * @param {object} cfg.secrets - from SecretManager.ensureSecrets()
 * @param {string} [cfg.tier='demo']
 * @param {string} cfg.desktopKey - per-launch LANA_DESKTOP_KEY
 * @param {object} [cfg.extraEnv]
 * @param {object} [cfg.hooks] - { postgresPrepare, postgresOnReady } from postgres-init
 * @param {object} [probes] - injected { httpProbe, tcpProbe } (defaults to real)
 * @returns {Array} supervisor specs
 */
function buildServiceSpecs(cfg, probes = defaultProbes) {
  const p = cfg.paths || {};
  const s = cfg.secrets || {};
  const tier = cfg.tier || 'demo';
  const ports = {
    pg: 5432, minio: 9000, minioConsole: 9001, llamaEmbed: 8082, llamaChat: 8081,
    docling: 8085, unstructured: 8000, backend: 8090, ...(cfg.ports || {}),
  };
  const specs = [];

  // 1. Postgres (first-run init via injected hooks)
  specs.push({
    name: 'postgres',
    command: p.postgres,
    args: ['-D', cfg.dataDirs.pg, '-p', String(ports.pg), '-c', 'listen_addresses=127.0.0.1'],
    env: { LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' },
    readiness: probes.tcpProbe({ host: '127.0.0.1', port: ports.pg }),
    prepare: cfg.hooks && cfg.hooks.postgresPrepare,
    onReady: cfg.hooks && cfg.hooks.postgresOnReady,
    critical: true,
  });

  // 2. MinIO
  specs.push({
    name: 'minio',
    command: p.minio,
    args: ['server', cfg.dataDirs.minio, '--address', `:${ports.minio}`, '--console-address', `:${ports.minioConsole}`],
    env: { MINIO_ROOT_USER: s.MINIO_ACCESS_KEY, MINIO_ROOT_PASSWORD: s.MINIO_SECRET_KEY },
    readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.minio}/minio/health/live` }),
    critical: true,
  });

  // 3. llama-server embeddings (always; required, runs on any Mac)
  specs.push({
    name: 'llama-embed',
    command: p.llamaServer,
    args: [
      '--model', p.embedModel, '--port', String(ports.llamaEmbed), '--host', '127.0.0.1',
      '--embedding', '--n-gpu-layers', '16', '--threads', '-1', '--ctx-size', '2048',
      '--batch-size', '2048', '--ubatch-size', '2048', '--flash-attn', 'on', '--cont-batching',
    ],
    readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.llamaEmbed}/health` }),
    critical: true,
  });

  // 4. llama-server chat (hardware-gated; only when a chat model was selected/downloaded)
  if (p.chatModel) {
    specs.push({
      name: 'llama-chat',
      command: p.llamaServer,
      args: [
        '--model', p.chatModel, '--port', String(ports.llamaChat), '--host', '127.0.0.1',
        '--n-gpu-layers', '16', '--threads', '-1', '--ctx-size', String(cfg.chatContext || 8192),
        '--batch-size', '128', '--ubatch-size', '256', '--parallel', '1',
        '--flash-attn', 'on', '--cont-batching',
      ],
      readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.llamaChat}/health` }),
      critical: false, // chat falls back to the Forge relay
    });
  }

  // 5. Doc parsers (optional; backend degrades to the native parser)
  if (p.doclingCmd) {
    specs.push({
      name: 'docling',
      command: p.doclingCmd,
      env: { DOCLING_PORT: String(ports.docling) },
      readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.docling}/health` }),
      critical: false,
    });
  }
  if (p.unstructuredUvicorn) {
    specs.push({
      name: 'unstructured',
      command: p.unstructuredUvicorn,
      args: ['prepline_general.api.general:app', '--host', '127.0.0.1', '--port', String(ports.unstructured), '--workers', '1'],
      cwd: p.unstructuredCwd,
      readiness: probes.tcpProbe({ host: '127.0.0.1', port: ports.unstructured }),
      critical: false,
    });
  }

  // 6. Node backend (depends on the required infra)
  const backendEnv = cleanEnv({
    ...(cfg.extraEnv || {}),
    NODE_ENV: (cfg.extraEnv && cfg.extraEnv.NODE_ENV) || 'production',
    IS_LANA_ONE: 'true',
    PORT: ports.backend,
    HOST: '127.0.0.1',
    LANA_TIER: tier,
    LANA_DESKTOP_KEY: cfg.desktopKey,
    DATABASE_URL: `postgresql://postgres:${s.POSTGRES_PASSWORD}@127.0.0.1:${ports.pg}/lana_chef`,
    POSTGRES_PASSWORD: s.POSTGRES_PASSWORD,
    MINIO_ENDPOINT: '127.0.0.1',
    MINIO_PORT: ports.minio,
    MINIO_ACCESS_KEY: s.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: s.MINIO_SECRET_KEY,
    MINIO_DOCUMENTS_BUCKET: 'lana-documents',
    LLAMACPP_EMBEDDING_URL: `http://127.0.0.1:${ports.llamaEmbed}`,
    // Only point chat at a local server when one exists; otherwise unset -> relay.
    LLAMACPP_MAIN_URL: p.chatModel ? `http://127.0.0.1:${ports.llamaChat}` : undefined,
    DOCLING_API_URL: p.doclingCmd ? `http://127.0.0.1:${ports.docling}` : undefined,
    UNSTRUCTURED_API_URL: p.unstructuredUvicorn ? `http://127.0.0.1:${ports.unstructured}` : undefined,
    JWT_SECRET: s.JWT_SECRET,
    MFA_ENCRYPTION_KEY: s.MFA_ENCRYPTION_KEY,
    WEBHOOK_SECRET_ENCRYPTION_KEY: s.WEBHOOK_SECRET_ENCRYPTION_KEY,
  });
  specs.push({
    name: 'backend',
    command: p.node || 'node',
    args: ['--max-old-space-size=2048', 'src/index.js'],
    cwd: p.backendCwd,
    env: backendEnv,
    dependsOn: ['postgres', 'minio', 'llama-embed'],
    readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.backend}/api/health/discovery` }),
    readinessTimeoutMs: 90000, // backend mounts routes ~30s in
    critical: true,
  });

  return specs;
}

module.exports = { buildServiceSpecs };

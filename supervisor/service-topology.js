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

// VRAM (GB) at/above which a CUDA GPU gets FULL offload; below it, a conservative
// partial offload so llama-server doesn't OOM the card (the rest runs on CPU).
const CUDA_FULL_OFFLOAD_MIN_VRAM_GB = 12;
const CUDA_PARTIAL_OFFLOAD_LAYERS = '20';

/**
 * Choose --n-gpu-layers as a PURE function of the detected acceleration backend,
 * replacing the old hardcoded '16' (which under-offloaded on Metal and blindly
 * assumed a GPU on every host). llama.cpp treats 99 as "offload every layer".
 *   metal -> '99' (full offload; Apple-Silicon unified memory)
 *   cuda  -> '99' when VRAM is ample, else a conservative partial offload
 *   cpu   -> '0'  (no GPU layers)
 * When accel is absent (older callers / tests) we default to full offload, matching
 * the Apple-Silicon Metal builds that ship today.
 *
 * @param {object} [accel] - { backend:'metal'|'cuda'|'cpu', vramGB?:number }
 * @returns {string} the --n-gpu-layers value
 */
function gpuLayersFor(accel) {
  const backend = accel && accel.backend;
  if (backend === 'cpu') return '0';
  if (backend === 'cuda') {
    const vram = (accel && accel.vramGB) || 0;
    return vram >= CUDA_FULL_OFFLOAD_MIN_VRAM_GB ? '99' : CUDA_PARTIAL_OFFLOAD_LAYERS;
  }
  // 'metal' or unknown/absent -> full offload.
  return '99';
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
 * @param {object} [cfg.accel] - detected acceleration capability
 *   ({ backend:'metal'|'cuda'|'cpu', vramGB? }) from hardware-accel/model-selector;
 *   drives --n-gpu-layers for every llama-server spec (see gpuLayersFor).
 * @param {object} [cfg.localModelsStatus] - boot-time local-model capability snapshot
 *   (hardware, selected tier/model, localChat availability, tier ladder, routing),
 *   serialized into the backend env as LANA_LOCAL_MODELS_STATUS for
 *   GET /api/v1/system/local-models
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
    docling: 8085, unstructured: 8000, backend: 8090,
    // Aux sovereign sidecars (all 127.0.0.1, all non-critical). NOTE: timesfm is
    // 8092, NOT 8090 -- the Node backend owns 8090.
    vision: 8083, legal: 8084, redactor: 8091, timesfm: 8092, hermes: 8094,
    ...(cfg.ports || {}),
  };
  const specs = [];

  // --n-gpu-layers for every llama-server sidecar, chosen once from the detected
  // acceleration backend (Metal/CUDA/CPU) instead of the old hardcoded '16'.
  const nGpuLayers = gpuLayersFor(cfg.accel);

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
    // Loopback-only: a bare `:port` binds 0.0.0.0 and exposes the object store
    // (and its console) to the LAN. The backend reaches it via MINIO_ENDPOINT
    // 127.0.0.1, so nothing needs the wildcard bind.
    args: ['server', cfg.dataDirs.minio, '--address', `127.0.0.1:${ports.minio}`, '--console-address', `127.0.0.1:${ports.minioConsole}`],
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
      '--embedding', '--n-gpu-layers', nGpuLayers, '--threads', '-1', '--ctx-size', '2048',
      '--batch-size', '2048', '--ubatch-size', '2048', '--flash-attn', 'on', '--cont-batching',
    ],
    readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.llamaEmbed}/health` }),
    critical: true,
  });

  // 4. llama-server chat (hardware-gated; only when a chat model was selected/downloaded)
  if (p.chatModel) {
    specs.push(buildChatSpec({
      llamaServer: p.llamaServer,
      chatModel: p.chatModel,
      port: ports.llamaChat,
      nGpuLayers,
      chatContext: cfg.chatContext,
    }, probes));
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

  // 5b. Aux inference sidecars (all optional, all critical:false so a missing
  // asset degrades instead of blocking boot -- exactly like llama-chat/docling).
  // Each is gated on its resolved asset path (set by bootstrap ONLY when the file
  // is actually present on disk; bootstrap never fetches them). The backend does
  // NOT hard-depend on any of these -- when a sidecar is absent its URL env is
  // left unset and the backend's hybrid/redaction logic degrades to the relay.

  // SaulLM legal verifier (reuses the llama-server chat launch pattern).
  if (p.legalModel) {
    specs.push({
      name: 'llama-legal',
      command: p.llamaServer,
      args: [
        '--model', p.legalModel, '--port', String(ports.legal), '--host', '127.0.0.1',
        '--n-gpu-layers', nGpuLayers, '--threads', '-1', '--ctx-size', String(cfg.chatContext || 8192),
        '--batch-size', '128', '--ubatch-size', '256', '--parallel', '1',
        '--flash-attn', 'on', '--cont-batching',
      ],
      readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.legal}/health` }),
      critical: false, // legal grounding falls back to LLAMACPP_LEGAL_URL default / relay
    });
  }

  // Vision model server (+ mmproj projector when the vision setup staged one).
  if (p.visionModel) {
    specs.push({
      name: 'llama-vision',
      command: p.llamaServer,
      args: [
        '--model', p.visionModel, '--port', String(ports.vision), '--host', '127.0.0.1',
        ...(p.visionMmproj ? ['--mmproj', p.visionMmproj] : []),
        '--n-gpu-layers', nGpuLayers, '--threads', '-1', '--ctx-size', String(cfg.chatContext || 8192),
        '--batch-size', '128', '--ubatch-size', '256', '--parallel', '1',
        '--flash-attn', 'on', '--cont-batching',
      ],
      readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.vision}/health` }),
      critical: false, // vision falls back to LLAMACPP_VISION_URL inheritance / relay
    });
  }

  // Redactor privacy moat (Presidio/spaCy FastAPI sidecar; run.sh staged by the
  // model/resource lane). REDACTOR_PORT is the only launch knob (per its wrapper).
  if (p.redactorRunSh) {
    specs.push({
      name: 'redactor',
      command: p.redactorRunSh,
      // The redactor enforces INTERNAL_SERVICE_SECRET on /redact; the backend
      // presents the SAME value (below), so the loopback hop is authenticated.
      env: {
        REDACTOR_PORT: String(ports.redactor),
        INTERNAL_SERVICE_SECRET: s.INTERNAL_SERVICE_SECRET,
        // Bundled (staged) venv -> run.sh skips provisioning and serves instantly.
        ...(p.redactorVenv ? { REDACTOR_VENV: p.redactorVenv } : {}),
      },
      readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.redactor}/healthz` }),
      // First run self-provisions the Presidio/spaCy venv (~hundreds of MB), which
      // can take several minutes; give it a long readiness window so a fresh box
      // does not time out. Already-provisioned boots skip straight to serving.
      readinessTimeoutMs: 15 * 60 * 1000,
      // NON-critical so a failed/offline provision does not tear down the stack.
      // But the moat is now CORE: REDACTION_ENABLED is set whenever run.sh ships,
      // so until the redactor is healthy the egress gate fails CLOSED (relay chat
      // is blocked, never leaked) rather than inert.
      critical: false,
    });
  }

  // TimesFM forecasting sidecar (uvicorn wrapper; reads TIMESFM_HOST/TIMESFM_PORT).
  if (p.timesfmRunSh) {
    specs.push({
      name: 'timesfm',
      command: p.timesfmRunSh,
      env: { TIMESFM_HOST: '127.0.0.1', TIMESFM_PORT: String(ports.timesfm) },
      readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.timesfm}/health` }),
      critical: false,
    });
  }

  // Hermes agentic executor sidecar (ESM node server; reads HERMES_SIDECAR_HOST/PORT).
  if (p.hermesServer) {
    specs.push({
      name: 'hermes',
      command: p.node || 'node',
      args: [p.hermesServer],
      env: { HERMES_SIDECAR_HOST: '127.0.0.1', HERMES_SIDECAR_PORT: String(ports.hermes) },
      readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.hermes}/health` }),
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
    // The hybrid router's LOCAL probe/target. MUST be the ISOLATED chat port
    // (ports.llamaChat may be reassigned off 8081 by bootstrap's port isolation);
    // the backend default of 127.0.0.1:8081 is wrong on any box where 8081 was
    // busy at boot, so pin it here explicitly whenever a local chat server exists.
    LLAMACPP_LOCAL_URL: p.chatModel ? `http://127.0.0.1:${ports.llamaChat}` : undefined,
    // Per-request local<->relay routing: DESKTOP edition only, and only when a
    // local chat server exists (otherwise byte-identical relay-default). The stock
    // lana-ai server env (infra/.../env-generator.js) never sets this, so hybrid
    // routing stays OFF there. cleanEnv drops the undefined on no-local machines.
    HYBRID_ROUTING_ENABLED: p.chatModel ? 'true' : undefined,
    // The local model's context window (same value llama-chat is launched with,
    // --ctx-size), so the router can send a prompt that would overflow the local
    // window to the relay instead of truncating injected RAG/statute context.
    LLAMACPP_LOCAL_CTX: p.chatModel ? String(cfg.chatContext || 8192) : undefined,
    // Boot-time local-model capability snapshot (the plan model-selector chose +
    // download outcome), surfaced by the backend at GET /api/v1/system/local-models
    // so the frontend can read this machine's local-model capability + routing.
    LANA_LOCAL_MODELS_STATUS: cfg.localModelsStatus ? JSON.stringify(cfg.localModelsStatus) : undefined,
    DOCLING_API_URL: p.doclingCmd ? `http://127.0.0.1:${ports.docling}` : undefined,
    UNSTRUCTURED_API_URL: p.unstructuredUvicorn ? `http://127.0.0.1:${ports.unstructured}` : undefined,
    JWT_SECRET: s.JWT_SECRET,
    MFA_ENCRYPTION_KEY: s.MFA_ENCRYPTION_KEY,
    WEBHOOK_SECRET_ENCRYPTION_KEY: s.WEBHOOK_SECRET_ENCRYPTION_KEY,
    // At-rest encryption keys (document envelope + connector OAuth tokens).
    FILE_ENCRYPTION_KEY: s.FILE_ENCRYPTION_KEY,
    CONNECTOR_ENCRYPTION_KEY: s.CONNECTOR_ENCRYPTION_KEY,
    // Aux sidecar URLs -- each set ONLY when that sidecar actually started (its
    // asset was present), so the backend's hybrid/redaction logic degrades to
    // the relay/native path exactly like LLAMACPP_MAIN_URL does today.
    REDACTION_ENABLED: p.redactorRunSh ? 'true' : undefined,
    REDACTOR_URL: p.redactorRunSh ? `http://127.0.0.1:${ports.redactor}` : undefined,
    // Same shared secret the redactor sidecar enforces; only sent when the
    // redactor is actually running, so an absent moat leaves the hop unset.
    INTERNAL_SERVICE_SECRET: p.redactorRunSh ? s.INTERNAL_SERVICE_SECRET : undefined,
    LLAMACPP_LEGAL_URL: p.legalModel ? `http://127.0.0.1:${ports.legal}` : undefined,
    LLAMACPP_VISION_URL: p.visionModel ? `http://127.0.0.1:${ports.vision}` : undefined,
    TIMESFM_API_URL: p.timesfmRunSh ? `http://127.0.0.1:${ports.timesfm}` : undefined,
    HERMES_SIDECAR_URL: p.hermesServer ? `http://127.0.0.1:${ports.hermes}` : undefined,
  });
  specs.push({
    name: 'backend',
    command: p.node || 'node',
    args: ['--max-old-space-size=2048', 'src/index.js'],
    cwd: p.backendCwd,
    env: backendEnv,
    dependsOn: ['postgres', 'minio', 'llama-embed'],
    // The discovery health endpoint does network checks and can take ~2-3s to
    // answer, so the per-request probe timeout must exceed that (default 2s would
    // kill the request before the backend's 2xx arrives — a false negative).
    readiness: probes.httpProbe({ url: `http://127.0.0.1:${ports.backend}/api/health/discovery`, timeoutMs: 8000 }),
    readinessTimeoutMs: 120000, // backend mounts routes ~30s in; slow health check
    readinessIntervalMs: 1500,
    critical: true,
  });

  return specs;
}

/**
 * The llama-server CHAT spec. Extracted so BOOT (buildServiceSpecs) and post-boot
 * ACTIVATION (bootstrap.activateLocalChat -> supervisor.replaceService) produce a
 * byte-identical spec (same args, ctx-size, gpu layers, port, readiness).
 */
function buildChatSpec({ llamaServer, chatModel, port, nGpuLayers, chatContext }, probes = defaultProbes) {
  return {
    name: 'llama-chat',
    command: llamaServer,
    args: [
      '--model', chatModel, '--port', String(port), '--host', '127.0.0.1',
      '--n-gpu-layers', nGpuLayers, '--threads', '-1', '--ctx-size', String(chatContext || 8192),
      '--batch-size', '128', '--ubatch-size', '256', '--parallel', '1',
      '--flash-attn', 'on', '--cont-batching',
    ],
    readiness: probes.httpProbe({ url: `http://127.0.0.1:${port}/health` }),
    critical: false, // chat falls back to the Forge relay
    // No auto-restart loop: a bad/crashing model degrades to the relay (the
    // availability probe routes around it) instead of flapping a llama-server.
    restart: false,
  };
}

module.exports = { buildServiceSpecs, buildChatSpec, gpuLayersFor };

'use strict';

const DESKTOP_SECURITY_GENERATION = 1;
const RELAY_VERSION = '1.0';
const CATALOG_VERSION = '1.0';

function loadMcpRelayConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return Object.freeze({
    environment: production ? 'production' : 'development',
    trustNamespace: production ? 'lana-mcp-production-v1' : 'lana-mcp-development-v1',
    enabled: env.LANA_DESKTOP_MCP_ENABLED === 'true',
    productDataReads: env.LANA_DESKTOP_MCP_PRODUCT_READS === 'true',
    sensitiveDocumentSearch: env.LANA_DESKTOP_MCP_SENSITIVE_SEARCH === 'true',
    localEmergencyDisabled: env.LANA_DESKTOP_MCP_LOCAL_KILL === 'true',
    internalDogfood: !production && env.LANA_DESKTOP_MCP_INTERNAL_DOGFOOD === 'true',
    desktopSecurityGeneration: DESKTOP_SECURITY_GENERATION,
    minimumDesktopSecurityGeneration: positiveInteger(env.LANA_DESKTOP_MCP_MIN_DESKTOP_GENERATION, 1),
    minimumAdapterSecurityGeneration: positiveInteger(env.LANA_DESKTOP_MCP_MIN_ADAPTER_GENERATION, 1),
    relayVersion: RELAY_VERSION,
    catalogVersion: CATALOG_VERSION
  });
}

function isProductDataLocallyAllowed(config) {
  return Boolean(config.enabled && config.productDataReads && !config.localEmergencyDisabled &&
    config.desktopSecurityGeneration >= config.minimumDesktopSecurityGeneration &&
    (config.environment !== 'production' || false));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = { loadMcpRelayConfig, isProductDataLocallyAllowed, DESKTOP_SECURITY_GENERATION, RELAY_VERSION, CATALOG_VERSION };

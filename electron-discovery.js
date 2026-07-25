/**
 * Electron Discovery Module (Simplified)
 *
 * With hosted discovery at lanaai.io, we no longer need Bonjour/mDNS.
 * This module handles hosted metadata refresh and server verification.
 *
 * Login performs the initial hosted discovery. This module repeats a bounded,
 * fail-open metadata refresh during later desktop launches so users with a
 * persisted authenticated session receive current enabled_apps, tier, and
 * service configuration without signing out. `verifyServer()` separately
 * re-verifies the resolved server health endpoint.
 */

const axios = require('axios');
const { logInfo, logError } = require('./electron-logger');

const HOSTED_DISCOVERY_URL = 'https://www.redroostertec.com/lana-ai/v1/discovery';

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * Merge fresh control-plane metadata without replacing the already verified
 * network route. This is the main-process equivalent of login.html's
 * background refresh and lets persisted authenticated sessions receive app
 * entitlement changes on every desktop launch.
 */
function mergeHostedDiscovery(savedServer, data) {
  if (!savedServer || !data || data.status !== 'healthy' || !data.server) return null;
  const discovery = data.discovery && typeof data.discovery === 'object' ? data.discovery : {};
  return {
    ...savedServer,
    orgId: data.server.org_id || savedServer.orgId,
    orgName: data.server.org_name || savedServer.orgName,
    version: data.server.version || savedServer.version,
    apiVersion: data.server.api_version || savedServer.apiVersion,
    domain: data.domain || savedServer.domain,
    vpn: hasOwn(discovery, 'vpn') ? discovery.vpn : savedServer.vpn,
    tier: data.tier || savedServer.tier || 'standard',
    rateLimit: hasOwn(data, 'rate_limit') ? data.rate_limit : (savedServer.rateLimit || 100),
    burstApiKey: hasOwn(data, 'burst_api_key') ? data.burst_api_key : savedServer.burstApiKey,
    burstUrl: hasOwn(data, 'burst_url') ? data.burst_url : savedServer.burstUrl,
    forgeApiKey: hasOwn(data, 'forge_api_key') ? data.forge_api_key : savedServer.forgeApiKey,
    forgeUrl: hasOwn(data, 'forge_url') ? data.forge_url : savedServer.forgeUrl,
    forgeSovereign: hasOwn(data, 'forge_sovereign') ? data.forge_sovereign : savedServer.forgeSovereign,
    enabledApps: Array.isArray(data.enabled_apps) ? data.enabled_apps : (savedServer.enabledApps || [])
  };
}

async function refreshHostedDiscovery(savedServer, options = {}) {
  if (!savedServer?.orgId || !savedServer?.domain) return null;
  const http = options.http || axios;
  const endpoint = options.endpoint || HOSTED_DISCOVERY_URL;
  try {
    logInfo(`[Discovery] Refreshing organization metadata for ${savedServer.orgId}`);
    const response = await http.post(endpoint, {
      org_id: savedServer.orgId,
      domain: savedServer.domain
    }, {
      timeout: options.timeout || 5000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LanaAI-Client/1.0'
      }
    });
    if (response.status !== 200) return null;
    const refreshed = mergeHostedDiscovery(savedServer, response.data);
    if (refreshed) logInfo('[Discovery] Organization metadata refreshed');
    return refreshed;
  } catch (error) {
    // Startup remains available from its last verified connection when the
    // public control plane is temporarily unreachable.
    logError('[Discovery] Background metadata refresh failed', error);
    return null;
  }
}

/**
 * Verify server is reachable and return updated info with retry
 * @param {string} serverUrl - Full server URL (e.g., 'http://192.168.1.100:8080')
 * @param {number} retries - Number of retry attempts (default: 2)
 * @returns {Promise<Object|null>} Server info or null if unreachable
 */
async function verifyServer(serverUrl, retries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      logInfo(`Verifying server at ${serverUrl}... (attempt ${attempt + 1}/${retries + 1})`);

      const response = await axios.get(`${serverUrl}/api/health/discovery`, {
        timeout: 5000,
        headers: {
          'User-Agent': 'LanaAI-Client/1.0'
        }
      });

      if (response.status !== 200) {
        logError(`Server verification failed: ${response.status}`);
        return null;
      }

      const data = response.data;

      if (data.server && data.server.org_id) {
        logInfo(`Server verified: ${data.server.org_name}`);
        return {
          url: serverUrl,
          orgId: data.server.org_id,
          orgName: data.server.org_name,
          version: data.server.version,
          apiVersion: data.server.api_version
        };
      }

      return null;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        logInfo(`Retry after ${(attempt + 1) * 1000}ms...`);
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        continue;
      }
      logError(`Failed to verify server at ${serverUrl} after ${retries + 1} attempts`, error);
      return null;
    }
  }

  return null;
}

module.exports = {
  HOSTED_DISCOVERY_URL,
  mergeHostedDiscovery,
  refreshHostedDiscovery,
  verifyServer
};

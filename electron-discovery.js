/**
 * Electron Discovery Module (Simplified)
 *
 * With hosted discovery at lanaai.io, we no longer need Bonjour/mDNS.
 * This module now only contains server verification functionality.
 */

const axios = require('axios');
const { logInfo, logError } = require('./electron-logger');

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
  verifyServer
};

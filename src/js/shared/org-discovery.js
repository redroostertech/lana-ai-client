/*
 * OrgDiscovery - find an organization's server from its Organization ID.
 *
 * Sign-in and account activation both start here: the hosted discovery service
 * answers an org ID with the address of that organization's LANA server. This
 * module shapes the request, reads the answer into the server info the rest of
 * the app saves (lana_saved_server), and turns a failure into words a person can
 * act on. When discovery fails the person has nowhere else to go, so the failure
 * always says what to check, offers a retry and names the support address.
 *
 * Plain module: no DOM. fetch is passed in so tests can fake it.
 */
(function (global) {
  'use strict';

  var DISCOVERY_URL = 'https://www.redroostertec.com/lana-ai/v1/discovery';
  var SUPPORT_EMAIL = 'support@redroostertec.com';

  /** Error with a kind the screen can branch on. */
  function DiscoveryError(kind, message) {
    var err = new Error(message);
    err.name = 'DiscoveryError';
    err.kind = kind;
    return err;
  }

  function generateServerUrl(orgId) {
    if (!orgId) return '';
    return String(orgId).trim().toLowerCase() + '.lanaai.io';
  }

  /** Host only: no protocol, port or path. */
  function extractDomain(url) {
    var domain = String(url || '').trim();
    domain = domain.replace(/^https?:\/\//, '');
    domain = domain.split(':')[0];
    domain = domain.split('/')[0];
    return domain;
  }

  function buildDiscoveryRequest(orgId, serverUrl) {
    return {
      url: DISCOVERY_URL,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, domain: extractDomain(serverUrl) })
      }
    };
  }

  /**
   * Read a discovery answer into server info, or throw a DiscoveryError.
   * Uses static_ip, port and is_secure_ssl to build the API address; the
   * domain in the answer is for reference only.
   */
  function parseDiscoveryResponse(status, data, normalizeEnabledApps) {
    var body = data || {};
    if (status === 400) {
      var details = Array.isArray(body.details) ? body.details.join(', ') : body.error;
      throw DiscoveryError('invalid', 'Invalid request: ' + (details || 'check the Organization ID'));
    }
    if (status === 404) {
      throw DiscoveryError('not_found', body.error || 'Organization not found or inactive');
    }
    if (status >= 500) {
      throw DiscoveryError('service', 'Discovery service error. Please try again later.');
    }
    if (status < 200 || status >= 300 || body.status !== 'healthy' || !body.discovery || !body.server) {
      throw DiscoveryError('unavailable', body.error || 'Organization not available');
    }

    var normalize = typeof normalizeEnabledApps === 'function'
      ? normalizeEnabledApps
      : function (apps) { return Array.isArray(apps) ? apps : []; };
    var isSecure = body.discovery.is_secure_ssl === true;
    var protocol = isSecure ? 'https' : 'http';

    return {
      url: protocol + '://' + body.discovery.static_ip + ':' + body.discovery.port,
      orgId: body.server.org_id,
      orgName: body.server.org_name,
      version: body.server.version,
      apiVersion: body.server.api_version,
      domain: body.domain,
      staticIp: body.discovery.static_ip,
      port: body.discovery.port,
      isSecure: isSecure,
      vpn: body.discovery.vpn || null,
      burstApiKey: body.burst_api_key || null,
      burstUrl: body.burst_url || null,
      forgeApiKey: body.forge_api_key || null,
      forgeUrl: body.forge_url || null,
      forgeSovereign: body.forge_sovereign || null,
      tier: body.tier || 'standard',
      rateLimit: body.rate_limit || 100,
      enabledApps: normalize(body.enabled_apps)
    };
  }

  /**
   * Ask hosted discovery for an organization.
   * @param {string} orgId
   * @param {string} serverUrl - the org's server name (orgid.lanaai.io or a custom one)
   * @param {{ fetch: Function, normalizeEnabledApps?: Function }} deps
   */
  async function resolveOrganization(orgId, serverUrl, deps) {
    var doFetch = deps && deps.fetch;
    var request = buildDiscoveryRequest(orgId, serverUrl);
    var response;
    try {
      response = await doFetch(request.url, request.init);
    } catch (error) {
      throw DiscoveryError('offline', 'Unable to reach discovery service. Please check your internet connection.');
    }
    var data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
    if (data === null && response.ok) {
      throw DiscoveryError('service', 'Discovery service error. Please try again later.');
    }
    return parseDiscoveryResponse(response.status, data, deps && deps.normalizeEnabledApps);
  }

  /**
   * What to show when connecting failed: a title, a sentence saying what to
   * check, and the support line. Every failure can be retried.
   * @param {Error} error - a DiscoveryError, or any error (for example the
   *   message ServerReachability builds when the server does not answer)
   * @param {string} [orgId]
   */
  function describeFailure(error, orgId) {
    var kind = (error && error.kind) || 'unreachable';
    var title;
    var detail;
    if (kind === 'not_found' || kind === 'invalid') {
      title = 'We could not find that organization';
      detail = 'Check the Organization ID' + (orgId ? ' (you typed "' + orgId + '")' : '') +
        ' against your LANA welcome email or what your administrator gave you, then try again.' +
        ' It is a short name, not a web address.';
    } else if (kind === 'offline') {
      title = 'LANA could not reach the sign-in service';
      detail = 'Check that this computer is connected to the internet, then try again.';
    } else if (kind === 'service' || kind === 'unavailable') {
      title = 'Your organization is not available right now';
      detail = 'The sign-in service did not give an address for it. Wait a minute and try again.';
    } else {
      title = 'LANA could not connect to your organization';
      detail = (error && error.message) || 'Wait a minute and try again.';
    }
    return {
      kind: kind,
      title: title,
      detail: detail,
      supportEmail: SUPPORT_EMAIL,
      support: 'Still stuck? Email ' + SUPPORT_EMAIL + ' with your Organization ID.'
    };
  }

  var api = {
    DISCOVERY_URL: DISCOVERY_URL,
    SUPPORT_EMAIL: SUPPORT_EMAIL,
    DiscoveryError: DiscoveryError,
    generateServerUrl: generateServerUrl,
    extractDomain: extractDomain,
    buildDiscoveryRequest: buildDiscoveryRequest,
    parseDiscoveryResponse: parseDiscoveryResponse,
    resolveOrganization: resolveOrganization,
    describeFailure: describeFailure
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.LanaOrgDiscovery = api;
  }
})(typeof window !== 'undefined' ? window : this);

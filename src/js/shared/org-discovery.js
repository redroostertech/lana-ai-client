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
 * The request itself is made by the main process (window.electronAPI.discovery.resolve,
 * electron-main.js discovery:resolve), so the answer's firm service keys never reach the
 * page. Plain module: no DOM. discover is passed in so tests can fake it.
 */
(function (global) {
  'use strict';

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

  /**
   * The control plane's pin of a box Chef's certificate: chef_cert_sha256 at
   * the root or under discovery, 64 hex characters (colons and case ignored).
   * The box's own certSha256 is never read: that answer is unauthenticated.
   */
  function chefCertPin(body) {
    var discovery = (body && body.discovery) || {};
    var candidates = [body && body.chef_cert_sha256, discovery.chef_cert_sha256];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] !== 'string') continue;
      var hex = candidates[i].replace(/:/g, '').trim().toLowerCase();
      if (/^[0-9a-f]{64}$/.test(hex)) return hex;
    }
    return null;
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
    // A hardware box's Chef serves HTTPS with its own certificate; the control
    // plane's chef_cert_sha256 is the only pin the app trusts for it
    // (electron-chef-pin.js). With a pin the address is https.
    var chefCertSha256 = chefCertPin(body);
    var isSecure = body.discovery.is_secure_ssl === true || Boolean(chefCertSha256);
    var protocol = isSecure ? 'https' : 'http';

    return {
      url: protocol + '://' + body.discovery.static_ip + ':' + body.discovery.port,
      chefCertSha256: chefCertSha256,
      orgId: body.server.org_id,
      orgName: body.server.org_name,
      version: body.server.version,
      apiVersion: body.server.api_version,
      domain: body.domain,
      staticIp: body.discovery.static_ip,
      port: body.discovery.port,
      isSecure: isSecure,
      vpn: body.discovery.vpn || null,
      // The firm's service keys (burst_api_key, forge_api_key) are not kept here: the main
      // process fetches and holds them (electron-api-base.js FIRM_SECRET_FIELDS).
      burstUrl: body.burst_url || null,
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
   * @param {{ discover: Function, normalizeEnabledApps?: Function }} deps
   *   discover(orgId, domain) -> { invalid } | { reached: false } | { reached: true, status, body }
   *   (window.electronAPI.discovery.resolve)
   */
  async function resolveOrganization(orgId, serverUrl, deps) {
    var discover = deps && deps.discover;
    var answer;
    try {
      answer = await discover(orgId, extractDomain(serverUrl));
    } catch (error) {
      answer = { reached: false };
    }
    if (answer && answer.invalid) {
      throw DiscoveryError('invalid', 'Invalid request: check the Organization ID');
    }
    if (!answer || !answer.reached) {
      throw DiscoveryError('offline', 'Unable to reach discovery service. Please check your internet connection.');
    }
    var data = answer.body || null;
    if (data === null && answer.status >= 200 && answer.status < 300) {
      throw DiscoveryError('service', 'Discovery service error. Please try again later.');
    }
    return parseDiscoveryResponse(answer.status, data, deps && deps.normalizeEnabledApps);
  }

  /** The main process's discovery request (electron-preload.js), for deps.discover. */
  function electronDiscover(orgId, domain) {
    return global.electronAPI.discovery.resolve(orgId, domain);
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
    SUPPORT_EMAIL: SUPPORT_EMAIL,
    DiscoveryError: DiscoveryError,
    generateServerUrl: generateServerUrl,
    extractDomain: extractDomain,
    parseDiscoveryResponse: parseDiscoveryResponse,
    chefCertPin: chefCertPin,
    resolveOrganization: resolveOrganization,
    electronDiscover: electronDiscover,
    describeFailure: describeFailure
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.LanaOrgDiscovery = api;
  }
})(typeof window !== 'undefined' ? window : this);

/*
 * ServerReachability - message builder for a resolved-but-unreachable org server.
 *
 * Discovery can resolve an organization successfully and still hand back an
 * address the client cannot reach: sovereign orgs put their LANA server on a
 * private network (Tailscale MagicDNS, WireGuard subnet) and advertise it via
 * the `vpn` block. Previously login redirected those users to a `vpn-setup.html`
 * page that does not exist in this repo, which navigated the window to a dead
 * URL and left a blank frame. The discovery `vpn` payload carries no endpoint,
 * key, or PSK to configure anyway, so we explain the situation in place instead.
 */
(function (global) {
  'use strict';

  var DEFAULT_VPN_LABEL = 'VPN';

  function orgLabel(serverInfo) {
    if (!serverInfo) return 'This organization';
    return serverInfo.orgName || serverInfo.orgId || 'This organization';
  }

  function hostLabel(serverInfo) {
    if (!serverInfo) return '';
    var host = serverInfo.staticIp || '';
    var port = serverInfo.port;
    if (!host) return serverInfo.url || '';
    // Port is optional and may arrive as a number from discovery.
    if (port === undefined || port === null || port === '') return host;
    return host + ':' + port;
  }

  function vpnLabel(serverInfo) {
    var vpn = serverInfo && serverInfo.vpn;
    if (!vpn || !vpn.type) return DEFAULT_VPN_LABEL;
    // Discovery reports lowercase slugs ("tailscale", "wireguard"); title-case
    // the first letter so the sentence reads naturally.
    return vpn.type.charAt(0).toUpperCase() + vpn.type.slice(1) + ' ' + DEFAULT_VPN_LABEL;
  }

  function requiresVpn(serverInfo) {
    var vpn = serverInfo && serverInfo.vpn;
    return !!(vpn && vpn.enabled);
  }

  /**
   * Build the user-facing error for a server that resolved but did not respond.
   * @param {object} serverInfo resolved discovery payload
   * @returns {string} actionable message, never a redirect
   */
  function buildUnreachableMessage(serverInfo) {
    var target = hostLabel(serverInfo);
    var where = target ? ' at ' + target : '';

    if (requiresVpn(serverInfo)) {
      return orgLabel(serverInfo) + ' is only reachable over the ' + vpnLabel(serverInfo) +
        '. Could not reach the server' + where +
        '. Connect to the VPN, then try again.';
    }

    return 'Unable to reach server' + where +
      '. Please check your network connection or contact your administrator.';
  }

  var api = {
    buildUnreachableMessage: buildUnreachableMessage,
    requiresVpn: requiresVpn
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.ServerReachability = api;
  }
})(typeof window !== 'undefined' ? window : this);

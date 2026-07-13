/**
 * probes.js
 *
 * Readiness-probe factories for the supervisor. Each returns an async () => boolean
 * that resolves true when the service is accepting work. Kept tiny and dependency-
 * free (node http/net only) so they can run inside the Electron main process, and
 * injected into service-topology so specs can be tested with fakes.
 */
'use strict';

const http = require('http');
const net = require('net');

/** HTTP GET probe: true when the endpoint answers with an acceptable status. */
function httpProbe({ url, timeoutMs = 2000, okStatus = (s) => s >= 200 && s < 500 } = {}) {
  return () => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = http.get(url, (res) => {
        res.resume(); // drain
        finish(okStatus(res.statusCode));
      });
    } catch (_e) {
      finish(false);
      return;
    }
    req.on('error', () => finish(false));
    req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch (_e) {} finish(false); });
  });
}

/** TCP connect probe: true when something is listening on host:port. */
function tcpProbe({ host = '127.0.0.1', port, timeoutMs = 2000 } = {}) {
  return () => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const sock = net.connect({ host, port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => { finish(true); sock.destroy(); });
    sock.once('timeout', () => { finish(false); sock.destroy(); });
    sock.once('error', () => finish(false));
  });
}

module.exports = { httpProbe, tcpProbe };

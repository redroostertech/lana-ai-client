(function (root) {
  'use strict';

  var PREFIX = 'lana_vpn_setup_handoff:';

  function randomRef() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      root.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      var hex = Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
      ].join('-');
    }
    return String(Date.now()) + '-' + String(Math.random()).slice(2);
  }

  function storage() {
    if (!root.sessionStorage) {
      throw new Error('Session storage is not available');
    }
    return root.sessionStorage;
  }

  function create(serverInfo) {
    var ref = randomRef();
    storage().setItem(PREFIX + ref, JSON.stringify(serverInfo || {}));
    return ref;
  }

  function read(ref) {
    if (!ref) return null;
    var raw = storage().getItem(PREFIX + ref);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function consume(ref) {
    var value = read(ref);
    if (ref) {
      storage().removeItem(PREFIX + ref);
    }
    return value;
  }

  root.LanaVpnSetupHandoff = {
    create: create,
    read: read,
    consume: consume
  };
})(window);

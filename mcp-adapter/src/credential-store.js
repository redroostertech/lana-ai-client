'use strict';

const SERVICE = 'com.redroostertech.lana.mcp-adapter';

class AdapterCredentialStore {
  constructor({ keytar, namespace }) { this.keytar = keytar; this.namespace = namespace; }
  account(registrationId) { return `${this.namespace}:${registrationId}`; }
  async save(registrationId, secret) {
    if (!this.keytar || typeof this.keytar.setPassword !== 'function') throw secureStoreError();
    await this.keytar.setPassword(SERVICE, this.account(registrationId), secret);
  }
  async load(registrationId) {
    if (!this.keytar || typeof this.keytar.getPassword !== 'function') throw secureStoreError();
    return this.keytar.getPassword(SERVICE, this.account(registrationId));
  }
  async remove(registrationId) {
    if (!this.keytar || typeof this.keytar.deletePassword !== 'function') throw secureStoreError();
    return this.keytar.deletePassword(SERVICE, this.account(registrationId));
  }
}
function secureStoreError() { const error = new Error('OS credential store unavailable'); error.code = 'SECURE_STORAGE_UNAVAILABLE'; return error; }
module.exports = { AdapterCredentialStore, SERVICE };

'use strict';

const crypto = require('crypto');
const { canonicalJson } = require('../mcp-relay/canonical-json');
const { CapabilityError } = require('../capabilities/errors');

class ConfirmationService {
  constructor({ presenter, clock = () => Date.now(), ttlMs = 60000 }) { this.presenter = presenter; this.clock = clock; this.ttlMs = Math.min(ttlMs, 60000); this.pending = new Map(); }
  digest(operation) { return crypto.createHash('sha256').update(canonicalJson(operation)).digest('hex'); }
  async confirm(operation) {
    const digest = this.digest(operation); const nonce = crypto.randomBytes(16).toString('base64url');
    const record = { digest, nonce, expiresAt: this.clock() + this.ttlMs, consumed: false };
    this.pending.set(nonce, record);
    const allowed = await this.presenter({ digest, display: operation.display, expiresAt: record.expiresAt });
    if (!allowed) { this.pending.delete(nonce); throw new CapabilityError('USER_DENIED'); }
    return { nonce, digest };
  }
  consume(approval, operation) {
    const record = approval && this.pending.get(approval.nonce); this.pending.delete(approval && approval.nonce);
    if (!record || record.consumed || record.expiresAt < this.clock() || record.digest !== this.digest(operation) || approval.digest !== record.digest) throw new CapabilityError('CONFIRMATION_EXPIRED');
    record.consumed = true; return true;
  }
  clear() { this.pending.clear(); }
}
module.exports = { ConfirmationService };

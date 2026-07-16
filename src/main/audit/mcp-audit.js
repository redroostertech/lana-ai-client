'use strict';

const ALLOWED_FIELDS = new Set(['timestamp', 'eventCode', 'registrationId', 'capability', 'capabilityVersion', 'userId', 'accountId', 'tenantId', 'workspaceId', 'contextEpochHash', 'confirmationOutcome', 'correlationId', 'errorCategory', 'policyVersion', 'latencyBucket', 'sizeBucket', 'outcome']);

class McpAudit {
  constructor({ sink, clock = () => Date.now() }) { this.sink = sink; this.clock = clock; }
  async record(eventCode, fields = {}) {
    const event = { timestamp: this.clock(), eventCode };
    for (const [key, value] of Object.entries(fields)) if (ALLOWED_FIELDS.has(key) && value !== undefined) event[key] = value;
    await this.sink(event);
    return event;
  }
}
module.exports = { McpAudit, ALLOWED_FIELDS };

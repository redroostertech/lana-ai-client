'use strict';

const DENIAL = Object.freeze({
  REMOTE_KILL: 'REMOTE_KILL', ENTERPRISE_POLICY: 'ENTERPRISE_POLICY_BLOCKED',
  TENANT_POLICY: 'FEATURE_DISABLED', LOCAL_POLICY: 'FEATURE_DISABLED',
  REGISTRATION_SCOPE: 'INSUFFICIENT_PERMISSION', STALE_POLICY: 'FEATURE_DISABLED'
});

class McpPolicyEngine {
  constructor({ clock = () => Date.now() } = {}) { this.clock = clock; }

  evaluate({ capability, registration, local, remote, enterprise, tenant }) {
    if (!remote || !Number.isFinite(remote.expiresAt) || remote.expiresAt <= this.clock()) return deny(DENIAL.STALE_POLICY);
    if (remote.emergencyDisabled) return deny(DENIAL.REMOTE_KILL);
    if (!local || !local.enabled || local.localEmergencyDisabled) return deny(DENIAL.LOCAL_POLICY);
    if (!remote.enabled || !remote.productDataReads) return deny(DENIAL.TENANT_POLICY);
    if (enterprise && enterprise.enabled === false) return deny(DENIAL.ENTERPRISE_POLICY);
    if (tenant && tenant.enabled === false) return deny(DENIAL.TENANT_POLICY);
    if (!registration || registration.revokedAt || registration.disabled) return deny(DENIAL.REGISTRATION_SCOPE);
    if (!registration.scopes || !registration.scopes.includes(capability.requiredScope)) return deny(DENIAL.REGISTRATION_SCOPE);
    if (capability.sensitive && (!local.sensitiveDocumentSearch || !remote.sensitiveDocumentSearch ||
        (enterprise && enterprise.sensitiveReads === false) || (tenant && tenant.sensitiveReads === false))) {
      return deny(DENIAL.ENTERPRISE_POLICY);
    }
    return Object.freeze({ allowed: true, confirmationRequired: Boolean(capability.sensitive && remote.confirmSensitiveReads), policyHash: remote.hash });
  }
}

function deny(code) { return Object.freeze({ allowed: false, code }); }
module.exports = { McpPolicyEngine, DENIAL };

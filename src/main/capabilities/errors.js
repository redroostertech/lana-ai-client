'use strict';

const CODES = new Set([
  'INVALID_REQUEST', 'UNREGISTERED_CLIENT', 'CLIENT_REVOKED', 'SESSION_EXPIRED', 'REPLAY_DETECTED',
  'APP_NOT_RUNNING', 'APP_LOCKED', 'SIGN_IN_REQUIRED', 'CONTEXT_CHANGED', 'INSUFFICIENT_PERMISSION',
  'FEATURE_DISABLED', 'ENTERPRISE_POLICY_BLOCKED', 'USER_DENIED', 'CONFIRMATION_EXPIRED',
  'VERSION_MISMATCH', 'CAPABILITY_UNAVAILABLE', 'RATE_LIMITED', 'DEADLINE_EXCEEDED', 'CANCELLED',
  'BACKEND_UNAVAILABLE', 'CONFLICT', 'DUPLICATE', 'INTERNAL_ERROR'
]);

class CapabilityError extends Error {
  constructor(code, safeDetails = undefined) {
    super(CODES.has(code) ? code : 'INTERNAL_ERROR');
    this.name = 'CapabilityError'; this.code = CODES.has(code) ? code : 'INTERNAL_ERROR';
    if (safeDetails) this.safeDetails = safeDetails;
  }
}

function asCapabilityError(error) {
  if (error instanceof CapabilityError) return error;
  if (error && CODES.has(error.code)) return new CapabilityError(error.code);
  return new CapabilityError('INTERNAL_ERROR');
}
module.exports = { CapabilityError, asCapabilityError, CODES };

'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

class ApplicationSecurityContext extends EventEmitter {
  constructor() {
    super();
    this.generation = 0;
    this.epochSecret = crypto.randomBytes(16).toString('base64url');
    this.state = frozenState();
    this.admissionFrozen = false;
  }

  snapshot() {
    return Object.freeze({ ...this.state, epoch: this.epoch(), admissionFrozen: this.admissionFrozen });
  }

  epoch() { return `${this.generation}-${this.epochSecret}`; }
  epochMatches(value) { return typeof value === 'string' && value === this.epoch(); }

  transition(reason, patch = {}) {
    if (!ALLOWED_REASONS.has(reason)) throw new TypeError('Unsupported security-context transition');
    this.admissionFrozen = true;
    const previousEpoch = this.epoch();
    this.generation += 1;
    this.epochSecret = crypto.randomBytes(16).toString('base64url');
    this.state = frozenState({ ...this.state, ...sanitizePatch(patch) });
    this.emit('invalidated', { reason, previousEpoch, epoch: this.epoch() });
    this.admissionFrozen = false;
    this.emit('changed', this.snapshot());
    return this.snapshot();
  }

  signIn(context) { return this.transition('sign-in', { ...context, signedIn: true, locked: false }); }
  signOut() { return this.transition('sign-out', emptyAuthority()); }
  lock() { return this.transition('lock', { locked: true }); }
  unlock() { return this.transition('unlock', { locked: false }); }
  switchAccount(context) { return this.transition('account-switch', context); }
  policyChanged(policyVersion) { return this.transition('policy-change', { policyVersion }); }
  clientRevoked() { return this.transition('client-revocation'); }
  globalDisable() { return this.transition('global-disable'); }
}

const ALLOWED_REASONS = new Set([
  'sign-in', 'sign-out', 'lock', 'unlock', 'account-switch', 'tenant-switch',
  'workspace-switch', 'permission-change', 'feature-change', 'policy-change',
  'client-revocation', 'global-disable', 'app-restart'
]);

function emptyAuthority() {
  return { signedIn: false, locked: false, userId: null, accountId: null, tenantId: null,
    workspaceId: null, permissions: [], entitlements: [], featureFlags: {}, policyVersion: null,
    accountDisplayName: null, organizationDisplayName: null, workspaceDisplayName: null };
}

function frozenState(value = {}) {
  const clean = { ...emptyAuthority(), ...sanitizePatch(value) };
  clean.permissions = Object.freeze([...clean.permissions]);
  clean.entitlements = Object.freeze([...clean.entitlements]);
  clean.featureFlags = Object.freeze({ ...clean.featureFlags });
  return Object.freeze(clean);
}

function sanitizePatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Context patch must be an object');
  const allowed = new Set(Object.keys(emptyAuthority()));
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`Unknown security-context field: ${key}`);
  const result = { ...value };
  if (result.permissions !== undefined) result.permissions = uniqueStrings(result.permissions);
  if (result.entitlements !== undefined) result.entitlements = uniqueStrings(result.entitlements);
  if (result.featureFlags !== undefined && (!result.featureFlags || typeof result.featureFlags !== 'object' || Array.isArray(result.featureFlags))) {
    throw new TypeError('featureFlags must be an object');
  }
  return result;
}

function uniqueStrings(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new TypeError('Expected string array');
  return [...new Set(value)];
}

module.exports = { ApplicationSecurityContext, ALLOWED_REASONS };

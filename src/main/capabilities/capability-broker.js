'use strict';

const crypto = require('crypto');
const { tools, catalogHash } = require('../../shared/mcp-contracts/catalog');
const { CatalogValidator } = require('./catalog-validator');
const { CapabilityError, asCapabilityError } = require('./errors');

class CapabilityBroker {
  constructor({ securityContext, policyEngine, admissionController, confirmationService, audit, registrationStore, productFacade, localPolicy, remotePolicyProvider, clock = () => Date.now() }) {
    Object.assign(this, { securityContext, policyEngine, admissionController, confirmationService, audit, registrationStore, productFacade, localPolicy, remotePolicyProvider, clock });
    this.validator = new CatalogValidator();
    this.dispatch = Object.freeze({
      'lana.status.get': (args, context, options) => productFacade.getStatus(args, context, options),
      'lana.context.current': (args, context, options) => productFacade.getCurrentContext(args, context, options),
      'lana.matter.list': (args, context, options) => productFacade.listMatters(args, context, options),
      'lana.matter.get': (args, context, options) => productFacade.getMatter(args, context, options),
      'lana.document.list': (args, context, options) => productFacade.listDocuments(args, context, options),
      'lana.document.search': (args, context, options) => productFacade.searchDocuments(args, context, options),
      'lana.task.list': (args, context, options) => productFacade.listTasks(args, context, options)
    });
  }

  listCapabilities() { return { catalogVersion: '1.0', catalogHash, capabilities: Object.entries(tools).map(([name, tool]) => ({ name, version: tool.version, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, sideEffects: 'none' })) }; }

  async invoke(request, { registrationId, signal } = {}) {
    const started = this.clock(); const correlationId = crypto.randomUUID(); const capability = request && request.capability;
    let release = null;
    try {
      if (!request || typeof request !== 'object' || request.version !== '1.0' || !tools[capability] || !this.dispatch[capability]) throw new CapabilityError('CAPABILITY_UNAVAILABLE');
      if (!registrationId) throw new CapabilityError('UNREGISTERED_CLIENT');
      const registration = this.registrationStore.getWithSecret(registrationId);
      if (!registration) throw new CapabilityError('UNREGISTERED_CLIENT');
      if (registration.revokedAt || registration.disabled) throw new CapabilityError('CLIENT_REVOKED');
      const args = this.validator.validateInput(capability, request.arguments || {});
      const context = this.securityContext.snapshot(); const epoch = context.epoch;
      if (context.admissionFrozen) throw new CapabilityError('CONTEXT_CHANGED');
      if (capability !== 'lana.status.get' && !context.signedIn) throw new CapabilityError('SIGN_IN_REQUIRED');
      if (capability !== 'lana.status.get' && context.locked) throw new CapabilityError('APP_LOCKED');
      const remote = await this.remotePolicyProvider.getPolicy();
      const decision = this.policyEngine.evaluate({ capability: { requiredScope: tools[capability].requiredScope, sensitive: tools[capability].sensitive }, registration, local: this.localPolicy(), remote, enterprise: remote.enterprise, tenant: remote.tenant });
      if (!decision.allowed) throw new CapabilityError(decision.code);
      release = this.admissionController.enter({ registrationId, capability, ratePerMinute: tools[capability].ratePerMinute });
      if (signal && signal.aborted) throw new CapabilityError('CANCELLED');
      let approval = null; let operation = null;
      if (decision.confirmationRequired) {
        operation = approvalOperation({ registrationId, request, args, context, decision, correlationId });
        approval = await this.confirmationService.confirm(operation);
      }
      if (!this.securityContext.epochMatches(epoch)) throw new CapabilityError('CONTEXT_CHANGED');
      if (approval) this.confirmationService.consume(approval, operation);
      const result = await withDeadline(this.dispatch[capability](args, context, { signal, correlationId }), tools[capability].timeoutMs, signal);
      if (!this.securityContext.epochMatches(epoch)) throw new CapabilityError('CONTEXT_CHANGED');
      const validated = this.validator.validateOutput(capability, result);
      const bytes = Buffer.byteLength(JSON.stringify(validated));
      if (bytes > tools[capability].maxResponseBytes) throw new CapabilityError('INTERNAL_ERROR');
      this.admissionController.chargeBudget({ tenantId: context.tenantId || 'status', itemCount: Array.isArray(validated.items) ? validated.items.length : 1, characterCount: countCharacters(validated) });
      await this.audit.record('mcp.invocation.completed', safeAudit({ registrationId, capability, context, correlationId, outcome: 'success', started, now: this.clock() }));
      return { correlationId, result: validated };
    } catch (error) {
      const safe = asCapabilityError(error);
      await this.audit.record('mcp.invocation.denied', { registrationId, capability, correlationId, errorCategory: safe.code, outcome: 'denied' });
      throw safe;
    } finally { if (release) release(); }
  }
}

function approvalOperation({ registrationId, request, args, context, decision, correlationId }) {
  const operation = { registrationId, contextEpoch: context.epoch, accountId: context.accountId, tenantId: context.tenantId, workspaceId: context.workspaceId, capability: request.capability, version: request.version, normalizedArguments: args, resolvedTargets: request.resolvedTargets || [], resolvedTargetCount: (request.resolvedTargets || []).length, externalEffects: [], policyHash: decision.policyHash, correlationId, display: { capability: request.capability, targetCount: (request.resolvedTargets || []).length } };
  if (request.relaySessionId !== undefined) operation.relaySessionId = request.relaySessionId;
  if (request.deadline !== undefined) operation.deadline = request.deadline;
  return operation;
}
function withDeadline(promise, milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CapabilityError('DEADLINE_EXCEEDED')), milliseconds);
    Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(new CapabilityError('CANCELLED')); }, { once: true });
  });
}
function countCharacters(value) { let total = 0; (function visit(v) { if (typeof v === 'string') total += v.length; else if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') Object.values(v).forEach(visit); })(value); return total; }
function safeAudit({ registrationId, capability, context, correlationId, outcome, started, now }) { return { registrationId, capability, capabilityVersion: '1.0', userId: context.userId, accountId: context.accountId, tenantId: context.tenantId, workspaceId: context.workspaceId, contextEpochHash: crypto.createHash('sha256').update(context.epoch).digest('hex'), correlationId, outcome, latencyBucket: now - started < 100 ? 'lt100ms' : 'gte100ms' }; }
module.exports = { CapabilityBroker, approvalOperation, withDeadline, countCharacters };

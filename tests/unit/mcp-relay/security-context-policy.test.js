const { ApplicationSecurityContext } = require('../../../src/main/security-context/application-security-context');
const { McpPolicyEngine } = require('../../../src/main/policy/mcp-policy-engine');
const { loadMcpRelayConfig, isProductDataLocallyAllowed } = require('../../../src/main/mcp-relay/config');

describe('desktop MCP security context and policy', () => {
  it('changes epoch and removes authority on sign-out', () => {
    const context = new ApplicationSecurityContext();
    const signedIn = context.signIn({ userId: 'u1', accountId: 'a1', tenantId: 't1', permissions: ['matter:read'] });
    const signedOut = context.signOut();
    expect(signedOut.epoch).not.toBe(signedIn.epoch);
    expect(signedOut).toMatchObject({ signedIn: false, userId: null, accountId: null, tenantId: null });
    expect(context.epochMatches(signedIn.epoch)).toBe(false);
  });

  it('invalidates on lock, policy change, and revocation', () => {
    const context = new ApplicationSecurityContext();
    const epochs = [context.epoch()];
    epochs.push(context.lock().epoch, context.policyChanged('2').epoch, context.clientRevoked().epoch);
    expect(new Set(epochs).size).toBe(4);
  });

  it('defaults all desktop data controls off, including development', () => {
    const config = loadMcpRelayConfig({ NODE_ENV: 'development' });
    expect(config).toMatchObject({ enabled: false, productDataReads: false, sensitiveDocumentSearch: false });
    expect(isProductDataLocallyAllowed(config)).toBe(false);
  });

  it('keeps production product data disabled even if local environment toggles are set', () => {
    const config = loadMcpRelayConfig({ NODE_ENV: 'production', LANA_DESKTOP_MCP_ENABLED: 'true', LANA_DESKTOP_MCP_PRODUCT_READS: 'true' });
    expect(isProductDataLocallyAllowed(config)).toBe(false);
  });

  it('applies policy in fail-closed precedence and requires sensitive scope', () => {
    const engine = new McpPolicyEngine({ clock: () => 100 });
    const base = {
      capability: { requiredScope: 'read:sensitive', sensitive: true },
      registration: { scopes: ['read:sensitive'] },
      local: { enabled: true, sensitiveDocumentSearch: true },
      remote: { enabled: true, productDataReads: true, sensitiveDocumentSearch: true, expiresAt: 200, hash: 'p1' },
      enterprise: { enabled: true, sensitiveReads: true }, tenant: { enabled: true, sensitiveReads: true }
    };
    expect(engine.evaluate(base)).toMatchObject({ allowed: true, policyHash: 'p1' });
    expect(engine.evaluate({ ...base, remote: { ...base.remote, emergencyDisabled: true } })).toEqual({ allowed: false, code: 'REMOTE_KILL' });
    expect(engine.evaluate({ ...base, registration: { scopes: [] } })).toEqual({ allowed: false, code: 'INSUFFICIENT_PERMISSION' });
    expect(engine.evaluate({ ...base, enterprise: { enabled: true, sensitiveReads: false } })).toEqual({ allowed: false, code: 'ENTERPRISE_POLICY_BLOCKED' });
  });
});

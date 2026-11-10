/**
 * Account activation when the firm is typed by hand (js/shared/activate-flow.js):
 * when the Organization ID field shows, and the order of the calls on submit
 * (discovery, then activate, then save the firm). Discovery, activate and save
 * are fakes; nothing reaches a network.
 */
'use strict';

const path = require('path');
const flow = require(path.join(__dirname, '../../src/js/shared/activate-flow.js'));
const discovery = require(path.join(__dirname, '../../src/js/shared/org-discovery.js'));

const SAVED = { url: 'https://10.0.0.5:8080', orgId: 'smithlaw', orgName: 'Smith Law' };
const FOUND = { url: 'https://10.0.0.9:8080', orgId: 'nortonlaw', orgName: 'Norton Law' };

function fakes({ resolveError = null, activateError = null } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      resolveOrganization: async (orgId) => {
        calls.push(['resolve', orgId]);
        if (resolveError) throw resolveError;
        return FOUND;
      },
      activate: async (server, body) => {
        calls.push(['activate', server, body]);
        if (activateError) throw activateError;
        return {};
      },
      saveServer: async (server) => { calls.push(['save', server]); }
    }
  };
}

describe('needsOrgField', () => {
  test('shows the field when the link named no firm and none is saved', () => {
    expect(flow.needsOrgField({ savedServer: null })).toBe(true);
    expect(flow.needsOrgField({})).toBe(true);
    expect(flow.needsOrgField()).toBe(true);
  });

  test('a saved firm without an address does not count as saved', () => {
    expect(flow.needsOrgField({ savedServer: { orgId: 'smithlaw' } })).toBe(true);
  });

  test('hides the field when a firm is saved on this computer', () => {
    expect(flow.needsOrgField({ savedServer: SAVED })).toBe(false);
  });

  test('hides the field when the link carried the org', () => {
    expect(flow.needsOrgField({ linkOrg: 'nortonlaw', savedServer: null })).toBe(false);
  });

  test('hides the field when the link carried the domain', () => {
    expect(flow.needsOrgField({ linkDomain: 'nortonlaw.lanaai.io', savedServer: null })).toBe(false);
  });
});

describe('submitActivation', () => {
  test('a typed Organization ID: discovery first, then activate at the firm found, then save it', async () => {
    const { calls, deps } = fakes();
    const result = await flow.submitActivation(
      { orgId: '  NortonLaw ', savedServer: null, code: 'LANA-AAAA-BBBB-CCCC', password: 'longenough' },
      deps
    );
    expect(result).toEqual({ ok: true, server: FOUND });
    expect(calls).toEqual([
      ['resolve', 'nortonlaw'],
      ['activate', FOUND, { activation_code: 'LANA-AAAA-BBBB-CCCC', password: 'longenough' }],
      ['save', FOUND]
    ]);
  });

  test('a typed Organization ID wins over the saved firm ("Different organization?")', async () => {
    const { calls, deps } = fakes();
    await flow.submitActivation({ orgId: 'nortonlaw', savedServer: SAVED, code: 'c0de', password: 'longenough' }, deps);
    expect(calls.map((c) => c[0])).toEqual(['resolve', 'activate', 'save']);
    expect(calls[1][1]).toBe(FOUND);
  });

  test('discovery failure stops before activate and saves nothing', async () => {
    const notFound = discovery.DiscoveryError('not_found', 'Organization not found or inactive');
    const { calls, deps } = fakes({ resolveError: notFound });
    const result = await flow.submitActivation({ orgId: 'nope', savedServer: null, code: 'c0de', password: 'longenough' }, deps);
    expect(result).toEqual({ ok: false, stage: 'discovery', error: notFound });
    expect(calls).toEqual([['resolve', 'nope']]);
  });

  test('the discovery failure reads as the sign-in screen words, with support', async () => {
    const offline = discovery.DiscoveryError('offline', 'Unable to reach discovery service.');
    const { deps } = fakes({ resolveError: offline });
    const result = await flow.submitActivation({ orgId: 'smithlaw', code: 'c0de', password: 'longenough' }, deps);
    const words = discovery.describeFailure(result.error, 'smithlaw');
    expect(words.title).toBe('LANA could not reach the sign-in service');
    expect(words.support).toContain('support@redroostertec.com');
  });

  test('no Organization ID: activates at the saved firm with no discovery and no save (today\'s flow)', async () => {
    const { calls, deps } = fakes();
    const result = await flow.submitActivation({ orgId: '', savedServer: SAVED, code: 'c0de', password: 'longenough' }, deps);
    expect(result).toEqual({ ok: true, server: SAVED });
    expect(calls).toEqual([['activate', SAVED, { activation_code: 'c0de', password: 'longenough' }]]);
  });

  test('a refused code after discovery reports the activate stage and does not save the firm', async () => {
    const refused = { status: 400, data: { error: 'Invalid activation code' } };
    const { calls, deps } = fakes({ activateError: refused });
    const result = await flow.submitActivation({ orgId: 'nortonlaw', code: 'bad1', password: 'longenough' }, deps);
    expect(result).toEqual({ ok: false, stage: 'activate', error: refused });
    expect(calls.map((c) => c[0])).toEqual(['resolve', 'activate']);
  });

  test('a firm that fails to save still counts as activated', async () => {
    const { deps } = fakes();
    deps.saveServer = async () => { throw new Error('disk full'); };
    const result = await flow.submitActivation({ orgId: 'nortonlaw', code: 'c0de', password: 'longenough' }, deps);
    expect(result.ok).toBe(true);
  });
});

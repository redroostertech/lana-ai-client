'use strict';

/** Settings > AI > Cloud: your own AI provider (src/js/settings-cloud-endpoint.model.js). */
const M = require('../../src/js/settings-cloud-endpoint.model');

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', default_base_url: 'https://api.openai.com/v1', url_required: false, key_required: true },
  { id: 'azure_openai', label: 'Azure OpenAI', default_base_url: null, url_required: true, key_required: true },
  { id: 'custom', label: 'Custom (any OpenAI-compatible server)', default_base_url: null, url_required: true, key_required: false, can_be_firm_hosted: true },
];

const SAVED = {
  provider: 'openai', provider_label: 'OpenAI', base_url: null, effective_base_url: 'https://api.openai.com/v1',
  hosted_by: 'third_party', model: 'gpt-5', api_key_set: true, api_key_masked: '****7788',
  redaction_enabled: true, enabled: true, updated_by_name: 'Pat Admin', updated_at: '2026-11-09T03:52:59.314Z',
};

const fact = (row, label) => (row.facts.find((f) => f.label === label) || {}).value;

describe('row', () => {
  test.each([
    [{ reachable: true, used: true }, 'Connected', 'green', 'Yes'],
    [{ reachable: false, used: true }, 'Not reachable', 'yellow', 'Yes'],
    [{ reachable: true, used: false }, 'Off on your server', 'gray', 'No, turned off on your server'],
    [{ reachable: null, used: null }, 'Default', 'gray', 'Unknown'],
  ])('no provider of your own: Forge is the row (%o)', (forge, badge, tone, used) => {
    const row = M.row(null, forge);
    expect(row).toMatchObject({ name: 'Forge', badge, tone });
    expect(fact(row, 'Used by your server')).toBe(used);
    expect(fact(row, 'Your data')).toMatch(/^Sovereign mode, always/);
  });

  test.each([
    [true, 'On', 'green', 'gpt-5'],
    [false, 'Off', 'gray', 'gpt-5. Turned off, so cloud requests go to Forge'],
  ])('your own provider, enabled=%s', (enabled, badge, tone, summary) => {
    const row = M.row({ ...SAVED, enabled }, { reachable: true, used: true });
    expect(row).toMatchObject({ name: 'OpenAI', badge, tone, summary });
    expect(fact(row, 'API key')).toMatch(/\*\*\*\*7788/);
    expect(fact(row, 'Run by')).toBe('An outside AI company');
    expect(fact(row, 'Last changed')).toMatch(/^Pat Admin, /);
  });

  test('redaction off is said plainly', () => {
    expect(fact(M.row({ ...SAVED, redaction_enabled: false }), 'Private details')).toBe('Sent as written');
  });

  test('Forge is the first choice and the default; choosing it shows no provider fields', () => {
    expect(M.providerOptions(PROVIDERS)[0].value).toBe('forge');
    expect(M.formDefaults(null).provider).toBe('forge');
    expect(M.fieldHelp({ provider: 'forge' }, SAVED, PROVIDERS).showFields).toBe(false);
    expect(M.fieldHelp({ provider: 'openai' }, SAVED, PROVIDERS).showFields).toBe(true);
  });
});

describe('saved key', () => {
  test.each([
    ['same provider, default address', { provider: 'openai', base_url: '' }, true],
    ['same provider, its default typed out', { provider: 'openai', base_url: ' https://api.openai.com/v1 ' }, true],
    ['same provider, another address', { provider: 'openai', base_url: 'https://proxy.example.com/v1' }, false],
    ['another provider', { provider: 'custom', base_url: 'https://api.openai.com/v1' }, false],
  ])('%s: kept=%s', (_label, form, kept) => {
    expect(M.keepsSavedKey(form, SAVED, PROVIDERS)).toBe(kept);
    const help = M.fieldHelp(form, SAVED, PROVIDERS).api_key;
    expect(help).toMatch(kept ? /Leave this empty to keep it/ : /Enter the key again/);
  });

  test('no saved key: required or optional by provider', () => {
    expect(M.fieldHelp({ provider: 'openai' }, null, PROVIDERS).api_key).toMatch(/^Required/);
    expect(M.fieldHelp({ provider: 'custom' }, null, PROVIDERS).api_key).toMatch(/^Optional/);
  });
});

describe('request bodies', () => {
  const form = { ...M.formDefaults(SAVED) };

  test('an empty key field leaves api_key out, so the server keeps the saved key', () => {
    const body = M.saveBody(form, SAVED, PROVIDERS);
    expect(body).not.toHaveProperty('api_key');
    expect(body).toMatchObject({ provider: 'openai', base_url: null, model: 'gpt-5', expected_updated_at: SAVED.updated_at });
  });

  test('a typed key is sent trimmed; a first save sends expected_updated_at null', () => {
    const body = M.saveBody({ ...M.formDefaults(null), provider: 'openai', model: ' gpt-5 ', api_key: ' sk-new ' }, null, PROVIDERS);
    expect(body).toMatchObject({ api_key: 'sk-new', model: 'gpt-5', expected_updated_at: null });
  });

  test('"Our firm" is only sent for Custom; any other provider is an outside company', () => {
    expect(M.saveBody({ ...form, hosted_by: 'firm' }, SAVED, PROVIDERS).hosted_by).toBe('third_party');
    expect(M.saveBody({ ...form, provider: 'custom', base_url: 'http://10.0.0.5/v1', hosted_by: 'firm' }, SAVED, PROVIDERS).hosted_by).toBe('firm');
    expect(M.fieldHelp({ provider: 'custom' }, null, PROVIDERS).showHostedBy).toBe(true);
    expect(M.fieldHelp({ provider: 'openai' }, null, PROVIDERS).showHostedBy).toBe(false);
  });

  test('the test body has no expected_updated_at (it writes nothing)', () => {
    expect(M.testBody(form, PROVIDERS)).not.toHaveProperty('expected_updated_at');
  });
});

describe('results and errors', () => {
  test.each([
    [{ ok: true, outcome: 'ok', message: 'Connected.', latency_ms: 19 }, 'success', 'Connected. (19 ms)'],
    [{ ok: false, outcome: 'unauthorized', message: 'Refused.', detail: 'HTTP 401: bad key' }, 'error', 'Refused. HTTP 401: bad key'],
    [{ ok: false, outcome: 'proxy_unavailable', message: 'Gateway off.' }, 'warning', 'Gateway off.'],
  ])('test result %#', (result, tone, text) => {
    expect(M.testView(result)).toEqual({ tone, text });
  });

  test('a validation error lands on its field; 409 asks to reload; 403 names the admin rule', () => {
    expect(M.errorView({ status: 400, data: { error: { message: 'Enter the API key again.', field: 'api_key' } } }))
      .toEqual({ stale: false, field: 'api_key', text: 'Enter the API key again.' });
    expect(M.errorView({ status: 409, data: { error: { message: 'Changed.' } } })).toMatchObject({ stale: true, field: null });
    expect(M.errorView({ status: 403, data: {} }).text).toMatch(/organization admin/);
  });
});

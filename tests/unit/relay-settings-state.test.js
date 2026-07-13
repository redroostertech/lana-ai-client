/**
 * Unit tests for the Cloud relay settings pure state logic
 * (client/src/js/relay/relay-settings-state.js).
 *
 * Covers: view derivation from the masked backend state (including the
 * cloud_signin source that the automated minting follow-up will use),
 * save-input validation / payload building, test payload building, and
 * test-connection outcome mapping.
 */

const path = require('path');

const relayState = require(path.join(
  __dirname,
  '../../src/js/relay/relay-settings-state.js'
));

describe('LanaRelayState.deriveView', () => {
  test('null settings -> loading view with manual entry disabled', () => {
    const view = relayState.deriveView(null);
    expect(view.statusLabel).toBe('Loading');
    expect(view.manualDisabled).toBe(true);
    expect(view.baseUrl).toBe('https://one.lanaai.io/api/v1/relay');
  });

  test('unconfigured -> Not configured, default base URL, no disconnect', () => {
    const view = relayState.deriveView({
      configured: false,
      token_set: false,
      base_url: 'https://one.lanaai.io/api/v1/relay',
      env_pinned: false,
    });
    expect(view.statusLabel).toBe('Not configured');
    expect(view.statusColor).toBe('gray');
    expect(view.canDisconnect).toBe(false);
  });

  test('configured manually -> Configured with last4 detail and disconnect enabled', () => {
    const view = relayState.deriveView({
      configured: true,
      token_set: true,
      token_last4: 'z9k4',
      base_url: 'https://one.lanaai.io/api/v1/relay',
      source: 'manual',
      env_pinned: false,
    });
    expect(view.statusLabel).toBe('Configured');
    expect(view.statusColor).toBe('green');
    expect(view.statusDetail).toContain('z9k4');
    expect(view.canDisconnect).toBe(true);
    expect(view.tokenPlaceholder).toContain('....z9k4');
  });

  test('configured via cloud sign-in -> Connected via sign-in (follow-up seam)', () => {
    const view = relayState.deriveView({
      configured: true,
      token_set: true,
      token_last4: 'ab12',
      source: 'cloud_signin',
      env_pinned: false,
    });
    expect(view.statusLabel).toBe('Connected via sign-in');
    expect(view.statusColor).toBe('green');
  });

  test('env pinned -> Managed by environment', () => {
    const view = relayState.deriveView({
      configured: false,
      env_pinned: true,
      base_url: 'https://one.lanaai.io/api/v1/relay',
    });
    expect(view.statusLabel).toBe('Managed by environment');
    expect(view.statusColor).toBe('blue');
  });
});

describe('LanaRelayState.validateSaveInput', () => {
  test('valid token + URL -> payload with both', () => {
    const result = relayState.validateSaveInput({
      baseUrl: 'https://one.lanaai.io/api/v1/relay/',
      token: ' tok_abcd1234 ',
      tokenSet: false,
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      base_url: 'https://one.lanaai.io/api/v1/relay',
      token: 'tok_abcd1234',
    });
  });

  test('first save without a token is rejected', () => {
    const result = relayState.validateSaveInput({
      baseUrl: 'https://one.lanaai.io/api/v1/relay',
      token: '',
      tokenSet: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('token');
  });

  test('URL-only save is allowed once a token is stored', () => {
    const result = relayState.validateSaveInput({
      baseUrl: 'https://other.example.com/relay',
      token: '',
      tokenSet: true,
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ base_url: 'https://other.example.com/relay' });
  });

  test('nothing to save when token stored and no fields entered', () => {
    const result = relayState.validateSaveInput({ baseUrl: '', token: '', tokenSet: true });
    expect(result.ok).toBe(false);
  });

  test('invalid URL is rejected', () => {
    const result = relayState.validateSaveInput({
      baseUrl: 'not a url',
      token: 'tok_x',
      tokenSet: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('URL');
  });

  test('non-http(s) URL is rejected', () => {
    const result = relayState.validateSaveInput({
      baseUrl: 'ftp://x.example.com',
      token: 'tok_x',
      tokenSet: false,
    });
    expect(result.ok).toBe(false);
  });

  test('token with inner whitespace is rejected', () => {
    const result = relayState.validateSaveInput({
      baseUrl: '',
      token: 'tok with space',
      tokenSet: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('spaces');
  });
});

describe('LanaRelayState.buildTestPayload', () => {
  test('includes only non-blank fields (backend falls back to stored values)', () => {
    expect(relayState.buildTestPayload({ baseUrl: '', token: '' })).toEqual({});
    expect(relayState.buildTestPayload({ baseUrl: 'https://a.example.com/', token: '' }))
      .toEqual({ base_url: 'https://a.example.com' });
    expect(relayState.buildTestPayload({ baseUrl: '', token: ' tok_1 ' }))
      .toEqual({ token: 'tok_1' });
  });
});

describe('LanaRelayState.mapTestResult', () => {
  test('ok with models count', () => {
    const out = relayState.mapTestResult({ ok: true, status: 200, models_count: 3 });
    expect(out).toMatchObject({ ok: true, label: 'Connected', color: 'green' });
    expect(out.detail).toContain('3');
  });

  test('ok with a single model uses singular copy', () => {
    const out = relayState.mapTestResult({ ok: true, status: 200, models_count: 1 });
    expect(out.detail).toContain('1 available model.');
  });

  test('unauthorized -> red with token guidance', () => {
    const out = relayState.mapTestResult({ ok: false, reason: 'unauthorized', status: 401 });
    expect(out).toMatchObject({ ok: false, label: 'Unauthorized', color: 'red' });
  });

  test('unreachable -> yellow with network guidance', () => {
    const out = relayState.mapTestResult({ ok: false, reason: 'unreachable' });
    expect(out).toMatchObject({ ok: false, label: 'Unreachable', color: 'yellow' });
  });

  test('no_token -> gray prompt to paste a token', () => {
    const out = relayState.mapTestResult({ ok: false, reason: 'no_token' });
    expect(out).toMatchObject({ ok: false, label: 'No token', color: 'gray' });
  });

  test('bad_status -> red with the status number', () => {
    const out = relayState.mapTestResult({ ok: false, reason: 'bad_status', status: 502 });
    expect(out.color).toBe('red');
    expect(out.detail).toContain('502');
  });

  test('malformed/empty result -> generic error', () => {
    const out = relayState.mapTestResult(null);
    expect(out.ok).toBe(false);
    expect(out.label).toBe('Error');
  });
});

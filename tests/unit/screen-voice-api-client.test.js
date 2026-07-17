const { VoiceApiClient } = require('../../src/screen-voice/voice-api-client');

function clientWithResponse(status, payload) {
  return new VoiceApiClient({
    fetch: jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn(async () => payload)
    })),
    getServerUrl: async () => 'http://lana.test',
    getToken: async () => 'test-token'
  });
}

describe('VoiceApiClient error classification', () => {
  test('transcription endpoint failures are reported as transcription failures', async () => {
    const client = clientWithResponse(500, { error: { message: 'runtime unavailable' } });
    await expect(client.transcribe({ audioBase64: 'AAAA', mimeType: 'audio/webm', language: 'en' }))
      .rejects.toMatchObject({ code: 'TRANSCRIPTION_FAILED', status: 500 });
  });

  test('agent decision endpoint failures remain provider failures', async () => {
    const client = clientWithResponse(503, { error: { message: 'model unavailable' } });
    await expect(client.decide({ instruction: 'Summarize this' }))
      .rejects.toMatchObject({ code: 'PROVIDER_ERROR', status: 503 });
  });

  test('builds an authenticated realtime websocket URL from a one-time token', async () => {
    const client = clientWithResponse(201, { data: {
      token: 'once', realtime_path: '/api/v1/voice/realtime',
      desktop_realtime_hermes_enabled: true,
      desktop_protocol_version: 'desktop-voice.v1'
    } });
    const config = await client.realtimeConfig();
    expect(config.websocket_url).toBe('ws://lana.test/api/v1/voice/realtime?voice_token=once');
    expect(config.desktop_realtime_hermes_enabled).toBe(true);
  });

  test('rejects a realtime endpoint on a foreign origin', async () => {
    const client = clientWithResponse(201, { data: {
      token: 'once', realtime_path: 'https://attacker.invalid/api/v1/voice/realtime'
    } });
    await expect(client.realtimeConfig()).rejects.toMatchObject({ code: 'REALTIME_UNAVAILABLE' });
  });

  test('rejects malformed one-time realtime tokens', async () => {
    const client = clientWithResponse(201, { data: {
      token: 'x'.repeat(513), realtime_path: '/api/v1/voice/realtime'
    } });
    await expect(client.realtimeConfig()).rejects.toMatchObject({ code: 'REALTIME_UNAVAILABLE' });
  });

  test('rejects invalid or credential-bearing configured server URLs', async () => {
    const invalid = clientWithResponse(201, { data: { token: 'once' } });
    invalid.getServerUrl = async () => 'not a url';
    await expect(invalid.realtimeConfig()).rejects.toMatchObject({ code: 'REALTIME_UNAVAILABLE' });

    const credentialed = clientWithResponse(201, { data: { token: 'once' } });
    credentialed.getServerUrl = async () => 'https://user:password@lana.test';
    await expect(credentialed.realtimeConfig()).rejects.toMatchObject({ code: 'REALTIME_UNAVAILABLE' });
  });
});

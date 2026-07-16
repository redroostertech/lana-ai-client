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
});

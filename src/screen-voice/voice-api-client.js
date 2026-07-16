'use strict';

class VoiceApiError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'VoiceApiError';
    this.code = code;
    this.status = status;
  }
}

class VoiceApiClient {
  constructor(options = {}) {
    this.fetch = options.fetch || global.fetch;
    this.getServerUrl = options.getServerUrl;
    this.getToken = options.getToken;
    this.timeoutMs = options.timeoutMs || 60000;
  }

  async post(pathname, body, signal, failureCode = 'PROVIDER_ERROR') {
    const serverUrl = await this.getServerUrl();
    const token = await this.getToken();
    if (!serverUrl) throw new VoiceApiError('SERVER_UNAVAILABLE', 'LANA server connection is unavailable.');
    if (!token) throw new VoiceApiError('AUTH_REQUIRED', 'Sign in to use voice features.');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await this.fetch(new URL(pathname, serverUrl), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: combined
      });
    } catch (error) {
      if (combined.aborted) throw new VoiceApiError('REQUEST_CANCELED', 'The voice request was canceled.');
      throw new VoiceApiError('NETWORK_UNAVAILABLE', 'The voice service is unavailable.');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || payload?.error || payload?.message || 'Voice request failed.';
      throw new VoiceApiError(failureCode, String(message), response.status);
    }
    return payload.data ?? payload;
  }

  transcribe({ audioBase64, mimeType, language }, signal) {
    return this.post('/api/v1/voice/transcribe', {
      audio_base64: audioBase64, mime_type: mimeType, language
    }, signal, 'TRANSCRIPTION_FAILED');
  }

  decide(input, signal) { return this.post('/api/v1/voice/screen-agent/decide', input, signal); }

  synthesize(text, signal) {
    return this.post('/api/v1/voice/preview', { text: String(text).slice(0, 1000), format: 'wav' }, signal);
  }
}

module.exports = { VoiceApiError, VoiceApiClient };

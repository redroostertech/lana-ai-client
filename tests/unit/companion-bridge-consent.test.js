const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../../src/js/companion-bridge-consent.js'),
  'utf8'
);

function loadConsentHarness({ alwaysAllow = false } = {}) {
  let callback = null;
  let latestModalOptions = null;
  const responses = [];
  const modalListeners = {};
  const modal = {
    querySelector: jest.fn((selector) => {
      if (selector === '#lanaBridgeConsentAlwaysAllow') return { checked: alwaysAllow };
      return null;
    }),
    addEventListener: jest.fn((event, handler) => {
      modalListeners[event] = handler;
    }),
  };
  const win = {
    electronAPI: {
      onCompanionBridgeRequestConsent: jest.fn((handler) => {
        callback = handler;
        return jest.fn();
      }),
      respondCompanionBridgeConsent: jest.fn((payload) => {
        responses.push(payload);
        return Promise.resolve({ ok: true });
      }),
      logError: jest.fn(),
      logInfo: jest.fn(),
    },
    Lex: {
      Modal: {
        open: jest.fn((options) => {
          latestModalOptions = options;
          return modal;
        }),
      },
    },
    addEventListener: jest.fn(),
  };

  const runner = new Function('window', 'console', source);
  runner(win, console);

  return {
    callback: (payload) => callback(payload),
    get latestModalOptions() { return latestModalOptions; },
    responses,
    modalListeners,
  };
}

describe('companion bridge consent renderer', () => {
  test('names lana-extension as the LANA Chrome extension', () => {
    const h = loadConsentHarness();
    h.callback({ requestId: 'req1', app: 'lana-extension' });

    expect(h.latestModalOptions.heading).toBe('LANA Chrome extension is requesting access');
    expect(h.latestModalOptions.content).toContain('LANA Chrome extension');
    expect(h.latestModalOptions.content).not.toContain('<strong>PAC</strong>');
  });

  test('keeps lana-companion displayed as PAC', () => {
    const h = loadConsentHarness();
    h.callback({ requestId: 'req1', app: 'lana-companion' });

    expect(h.latestModalOptions.heading).toBe('PAC is requesting access');
    expect(h.latestModalOptions.content).toContain('<strong>PAC</strong>');
  });

  test('does not render unexpected app ids as HTML', () => {
    const h = loadConsentHarness();
    const raw = '<img src=x onerror=alert(1)>';
    h.callback({ requestId: 'req1', app: raw });

    expect(h.latestModalOptions.heading).toBe('this companion application is requesting access');
    expect(h.latestModalOptions.content).toContain('this companion application');
    expect(h.latestModalOptions.heading).not.toContain(raw);
    expect(h.latestModalOptions.content).not.toContain(raw);
  });

  test('preserves allow and always-allow IPC response semantics', () => {
    const h = loadConsentHarness({ alwaysAllow: true });
    h.callback({ requestId: 'req1', app: 'lana-extension' });

    h.latestModalOptions.onConfirm();

    expect(h.responses).toEqual([{ requestId: 'req1', allow: true, alwaysAllow: true }]);
  });

  test('preserves deny semantics for modal cancellation', () => {
    const h = loadConsentHarness();
    h.callback({ requestId: 'req1', app: 'lana-extension' });

    h.modalListeners['lex-cancel']();

    expect(h.responses).toEqual([{ requestId: 'req1', allow: false, alwaysAllow: false }]);
  });
});

/**
 * Lana Companion Bridge — renderer-side consent handler.
 *
 * Listens for `companion-bridge:request-consent` from the main process and
 * shows an in-app Lex modal asking the user to approve or deny a token
 * request from the sibling Lana Companion app. The decision is sent back
 * over IPC via `respondCompanionBridgeConsent`.
 *
 * Pairing files:
 *   - electron-main.js                 forwards bridge → renderer requests
 *   - electron-preload.js              exposes the IPC API on window.electronAPI
 *   - electron-bridge.js               the loopback HTTP server that prompts
 *   - src/css/companion-bridge-consent.css   tiny stylesheet for layout polish
 *
 * Per LEX-COMPONENT-RULES.md the modal is built with `Lex.Modal.open(...)`
 * (foundation tier) so it inherits Lex tokens, focus trap, scroll lock,
 * and Esc-to-close. We treat dismissal (Esc / overlay click / Deny) as a
 * denial. The native dialog stays in electron-bridge.js as the fallback
 * path when there is no usable BrowserWindow.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  // Guard against accidental double-load (e.g., script tag included twice).
  if (window.__lanaCompanionBridgeConsentLoaded) return;
  window.__lanaCompanionBridgeConsentLoaded = true;

  const electronAPI = window.electronAPI;
  if (!electronAPI || typeof electronAPI.onCompanionBridgeRequestConsent !== 'function') {
    // Not running inside Electron, or preload didn't expose the API.
    // Nothing to wire up; the bridge will fall back to the native dialog.
    return;
  }

  // Track whether a modal is already open. Coalesce concurrent prompts
  // (the bridge also coalesces, but we add a renderer-side guard so a
  // burst of stale events can't stack modals).
  let activeRequestId = null;
  let activeModal = null;

  function logError(message, error) {
    try {
      if (electronAPI && typeof electronAPI.logError === 'function') {
        electronAPI.logError(message, error ? { message: error.message, stack: error.stack } : null);
      }
    } catch (_) { /* noop */ }
    try { console.error(message, error); } catch (_) { /* noop */ }
  }

  function logInfo(message) {
    try {
      if (electronAPI && typeof electronAPI.logInfo === 'function') {
        electronAPI.logInfo(message);
      }
    } catch (_) { /* noop */ }
  }

  function safeAnswer(requestId, decision) {
    try {
      const payload = {
        requestId: requestId,
        allow: Boolean(decision && decision.allow),
        alwaysAllow: Boolean(decision && decision.alwaysAllow)
      };
      if (electronAPI && typeof electronAPI.respondCompanionBridgeConsent === 'function') {
        const result = electronAPI.respondCompanionBridgeConsent(payload);
        if (result && typeof result.catch === 'function') {
          result.catch((error) => logError('[companion-bridge-consent] respond failed', error));
        }
      }
    } catch (error) {
      logError('[companion-bridge-consent] safeAnswer threw', error);
    }
  }

  function clearActive() {
    activeRequestId = null;
    activeModal = null;
  }

  /**
   * Build the modal body HTML. All user-visible strings live here so they
   * stay in sync with the native dialog copy in electron-bridge.js.
   *
   * NOTE: The `app` value originates from a localhost POST body. We don't
   * render it as raw text here; instead we use the constant copy plus a
   * checkbox controlled by static markup. There is no untrusted HTML.
   */
  function buildBodyHTML() {
    return [
      '<div class="lana-bridge-consent">',
      '  <p class="lana-bridge-consent__lede">',
      '    Allow <strong>Lana Companion</strong> to use your current Lana session for this device?',
      '  </p>',
      '  <p class="lana-bridge-consent__detail">',
      '    Companion will receive a short-lived token tied to your signed-in user. ',
      '    You can revoke access from Settings later.',
      '  </p>',
      '  <label class="lana-bridge-consent__checkbox">',
      '    <input type="checkbox" id="lanaBridgeConsentAlwaysAllow" />',
      '    <span>Always allow on this device</span>',
      '  </label>',
      '</div>'
    ].join('\n');
  }

  function readAlwaysAllow(modal) {
    if (!modal) return false;
    try {
      const input = modal.querySelector('#lanaBridgeConsentAlwaysAllow');
      return Boolean(input && input.checked);
    } catch (_) {
      return false;
    }
  }

  function showLexModal(requestId) {
    if (!window.Lex || !window.Lex.Modal || typeof window.Lex.Modal.open !== 'function') {
      logError('[companion-bridge-consent] Lex.Modal is not available; denying consent');
      safeAnswer(requestId, { allow: false, alwaysAllow: false });
      clearActive();
      return;
    }

    let answered = false;
    const answer = (decision) => {
      if (answered) return;
      answered = true;
      safeAnswer(requestId, decision);
      clearActive();
    };

    const modal = window.Lex.Modal.open({
      heading: 'Lana Companion is requesting access',
      content: buildBodyHTML(),
      size: 'sm',
      confirmText: 'Allow',
      cancelText: 'Deny',
      closeOnOverlay: true,
      onConfirm: () => {
        answer({ allow: true, alwaysAllow: readAlwaysAllow(modal) });
      }
    });

    if (!modal) {
      logError('[companion-bridge-consent] Lex.Modal.open returned no element; denying consent');
      safeAnswer(requestId, { allow: false, alwaysAllow: false });
      clearActive();
      return;
    }

    activeModal = modal;

    // Treat Deny + Esc + backdrop click as denials. Lex.Modal already
    // calls modal.remove() in its own listeners on lex-cancel/lex-close,
    // so we only need to send the IPC answer.
    modal.addEventListener('lex-cancel', () => {
      answer({ allow: false, alwaysAllow: false });
    });
    modal.addEventListener('lex-close', () => {
      answer({ allow: false, alwaysAllow: false });
    });
  }

  function handleConsentRequest(payload) {
    const requestId =
      payload && typeof payload.requestId === 'string' ? payload.requestId : null;
    if (!requestId) {
      logError('[companion-bridge-consent] Received consent request with no requestId');
      return;
    }

    // If a prompt is already showing for the same id, do nothing.
    if (activeRequestId === requestId) return;

    // If a different prompt is already showing, deny the new one to avoid
    // stacking modals. The bridge coalesces by app name, so this is rare.
    if (activeRequestId) {
      logInfo('[companion-bridge-consent] Another consent prompt is already open; denying new request');
      safeAnswer(requestId, { allow: false, alwaysAllow: false });
      return;
    }

    activeRequestId = requestId;
    showLexModal(requestId);
  }

  let unsubscribe = null;
  try {
    unsubscribe = electronAPI.onCompanionBridgeRequestConsent(handleConsentRequest);
  } catch (error) {
    logError('[companion-bridge-consent] Failed to subscribe to consent requests', error);
    return;
  }

  // Detach the IPC listener on page unload so SPA navigations / window
  // reloads don't leak handlers across page lifetimes.
  window.addEventListener('beforeunload', () => {
    try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (_) { /* noop */ }
    // If a modal is still open when the page is going away, treat as deny.
    if (activeRequestId) {
      const requestId = activeRequestId;
      activeRequestId = null;
      activeModal = null;
      safeAnswer(requestId, { allow: false, alwaysAllow: false });
    }
  });
})();

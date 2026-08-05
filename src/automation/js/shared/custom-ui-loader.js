import { resolveAutomationApiBaseUrl } from './api-base-url.js';

/**
 * Loads a custom connector UI inside an iframe, matching the behavior of
 * `lana-client/src/integrations/connector-viewer.html`.
 *
 * The pipeline:
 *   1. Cache-busted fetch of `uiEntryPoint`.
 *   2. Rewrite relative asset paths to absolute URLs anchored at the UI base.
 *   3. Strip broken legacy stylesheet links.
 *   4. Inject a `<script>` block that seeds `window.LanaConfig`,
 *      `window.LanaConnectorId`, `window.api.token`, and monkey-patches
 *      `fetch` so that custom UIs with relative `/api/...` calls resolve
 *      against the configured API base URL (blob:// origins otherwise cannot).
 *   5. Inject Tailwind CDN and tab CSS (matches lana-client).
 *   6. Create a Blob URL and load it as the iframe source.
 *   7. Set up a postMessage bridge for `lana-open-external` (OAuth popups)
 *      and, when running under Electron, `lana-oauth-callback`.
 *
 * Usage:
 *   const { cleanup } = await loadCustomConnectorUi({
 *     iframe: iframeElement,
 *     uiEntryPoint: 'http://minio/.../ui/index.html',
 *     connectorId: 'abc-123',
 *     token: 'jwt...',
 *     lanaConfig: { API_BASE_URL: '...' }
 *   });
 *
 * Call `cleanup()` when the iframe is being unmounted.
 */

const LOAD_TIMEOUT_MS = 30000;

export async function loadCustomConnectorUi({
  iframe,
  uiEntryPoint,
  connectorId,
  connectorType = '',
  sourceId = '',
  connectorScope = '',
  connectorName = '',
  token = '',
  lanaConfig = {}
}) {
  if (!iframe) {
    throw new Error('loadCustomConnectorUi: iframe element is required');
  }
  if (!uiEntryPoint) {
    throw new Error('loadCustomConnectorUi: uiEntryPoint is required');
  }
  if (!isSupportedUrl(uiEntryPoint)) {
    throw new Error(
      `Invalid connector URL format. The connector UI entry point is "${uiEntryPoint}" ` +
      'but must start with file://, http://, or https://. ' +
      'This usually means the connector needs to be re-imported.'
    );
  }

  const cacheBustUrl = appendCacheBust(uiEntryPoint);
  const response = await fetch(cacheBustUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch connector UI (${response.status} ${response.statusText})`);
  }
  const rawHtml = await response.text();
  const rewritten = rewriteConnectorHtml(rawHtml, {
    uiEntryPoint,
    connectorId,
    connectorType,
    sourceId,
    connectorScope,
    connectorName,
    token,
    lanaConfig
  });

  const blob = new Blob([rewritten], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);

  const loadedPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Loading timeout. The connector UI took too long to load.'));
    }, LOAD_TIMEOUT_MS);

    iframe.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    iframe.onerror = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Iframe failed to load the connector UI.'));
    };
  });

  iframe.src = blobUrl;

  const { removeBridge } = installPostMessageBridge(iframe);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeBridge();
    try {
      URL.revokeObjectURL(blobUrl);
    } catch (_error) {
      // Ignore — revoked or never allocated.
    }
    if (iframe) {
      iframe.onload = null;
      iframe.onerror = null;
    }
  };

  try {
    await loadedPromise;
  } catch (error) {
    cleanup();
    throw error;
  }

  return { cleanup };
}

function isSupportedUrl(url) {
  if (typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

function appendCacheBust(url) {
  const separator = url.indexOf('?') === -1 ? '?' : '&';
  return `${url}${separator}_cb=${Date.now()}`;
}

function rewriteConnectorHtml(html, {
  uiEntryPoint,
  connectorId,
  connectorType,
  sourceId,
  connectorScope,
  connectorName,
  token,
  lanaConfig
}) {
  let output = html;

  // Remove the legacy Tailwind reference that connector ZIPs often ship with.
  output = output.replace(/<link[^>]*href=["']\/css\/tailwind\.css["'][^>]*>/gi, '');

  // Relative asset paths need to be anchored at the UI's base URL, because
  // the page will ultimately run from a blob:// origin.
  const baseUrl = uiEntryPoint.substring(0, uiEntryPoint.lastIndexOf('/') + 1);
  output = output.replace(/src=["']assets\//gi, `src="${baseUrl}assets/`);
  output = output.replace(/href=["']assets\//gi, `href="${baseUrl}assets/`);
  output = output.replace(/src=["']js\//gi, `src="${baseUrl}js/`);

  const configScript = buildConfigScript({
    connectorId,
    connectorType,
    sourceId,
    connectorScope,
    connectorName,
    token,
    lanaConfig
  });
  const tailwindScript = '<script src="https://cdn.tailwindcss.com"></script>';
  const tabStyles = `
    <style>
      .tab-button { background: none; border: none; cursor: pointer; position: relative; }
      .tab-button.active { border-bottom: 2px solid #2563eb !important; }
    </style>
  `;

  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, `<head$1>${configScript}${tailwindScript}${tabStyles}`);
  } else {
    output = `<head>${configScript}${tailwindScript}${tabStyles}</head>${output}`;
  }

  return output;
}

function buildConfigScript({
  connectorId,
  connectorType,
  sourceId,
  connectorScope,
  connectorName,
  token,
  lanaConfig
}) {
  const resolvedApiBase = resolveAutomationApiBaseUrl((lanaConfig && lanaConfig.API_BASE_URL) || '');
  const effectiveToken = String(
    token
    || localStorage.getItem('token')
    || localStorage.getItem('authToken')
    || localStorage.getItem('lana_token')
    || localStorage.getItem('lana_automation_token')
    || ''
  );
  const injectedConfig = { ...(lanaConfig || {}) };
  if (resolvedApiBase) injectedConfig.API_BASE_URL = resolvedApiBase;

  const safeConfig = JSON.stringify(injectedConfig);
  const safeToken = JSON.stringify(effectiveToken);
  const safeConnectorId = JSON.stringify(String(connectorId || ''));
  const safeConnectorType = JSON.stringify(String(connectorType || ''));
  const safeSourceId = JSON.stringify(String(sourceId || connectorId || ''));
  const safeConnectorScope = JSON.stringify(String(connectorScope || ''));
  const safeConnectorName = JSON.stringify(String(connectorName || ''));
  const safeApiBase = JSON.stringify(String(resolvedApiBase || ''));

  // NOTE: the closing </script> is split to avoid prematurely terminating the
  // outer <script> when this HTML is injected into the blob document.
  return `
    <script>
      window.LanaConfig = ${safeConfig};
      window.LanaConnectorId = ${safeConnectorId};
      window.LanaConnectorName = ${safeConnectorName};
      window.LanaConnector = {
        id: ${safeConnectorId},
        sourceId: ${safeSourceId},
        connectorType: ${safeConnectorType},
        scope: ${safeConnectorScope},
        name: ${safeConnectorName}
      };
      window.lanaAuth = {
        token: ${safeToken},
        apiBaseUrl: ${safeApiBase},
        connectorId: ${safeConnectorId},
        sourceId: ${safeSourceId},
        connectorType: ${safeConnectorType},
        connectorScope: ${safeConnectorScope},
        source: 'blob-injection'
      };
      window.api = { token: ${safeToken}, baseUrl: ${safeApiBase} };
      try { localStorage.setItem('lana_token', ${safeToken}); } catch (_e) {}
      try { localStorage.setItem('token', ${safeToken}); } catch (_e) {}
      try { localStorage.setItem('authToken', ${safeToken}); } catch (_e) {}
      try { localStorage.setItem('lana_automation_token', ${safeToken}); } catch (_e) {}
      (function () {
        var originalFetch = window.fetch;
        window.fetch = function (input, init) {
          var apiBase = window.lanaAuth && window.lanaAuth.apiBaseUrl;
          if (typeof input === 'string' && input.startsWith('/') && apiBase) {
            input = apiBase + input;
          }
          return originalFetch.call(this, input, init);
        };
      })();
      (function () {
        window.addEventListener('message', function (event) {
          var data = event && event.data;
          if (!data || data.type !== 'lana-auth') return;
          if (event.source !== window.parent) return;
          window.lanaAuth = Object.assign({}, window.lanaAuth, {
            token: data.token || window.lanaAuth.token,
            apiBaseUrl: data.apiBaseUrl || window.lanaAuth.apiBaseUrl,
            user: data.user || null,
            connectorId: data.connectorId || window.lanaAuth.connectorId,
            sourceId: data.sourceId || window.lanaAuth.sourceId,
            connectorType: data.connectorType || window.lanaAuth.connectorType,
            connectorScope: data.connectorScope || window.lanaAuth.connectorScope,
            source: 'postmessage'
          });
          try {
            if (window.lanaAuth.apiBaseUrl) {
              window.LanaConfig = Object.assign({}, window.LanaConfig || {}, {
                API_BASE_URL: window.lanaAuth.apiBaseUrl
              });
            }
            if (data.token) {
              window.api = {
                token: data.token,
                baseUrl: (window.lanaAuth && window.lanaAuth.apiBaseUrl) || ''
              };
              localStorage.setItem('lana_token', data.token);
              localStorage.setItem('token', data.token);
              localStorage.setItem('authToken', data.token);
              localStorage.setItem('lana_automation_token', data.token);
            }
          } catch (_e) {}
          try {
            window.dispatchEvent(new CustomEvent('lana-auth', { detail: window.lanaAuth }));
          } catch (_e) {}
        });

        try {
            window.parent.postMessage({
              type: 'lana-ready',
              connectorId: ${safeConnectorId},
              sourceId: ${safeSourceId},
              connectorType: ${safeConnectorType},
              connectorScope: ${safeConnectorScope}
            }, '*');
        } catch (_e) {}
      })();
    <\/script>
  `;
}

function installPostMessageBridge(iframe) {
  const onMessage = (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'lana-open-external' && event.data.url) {
      if (!iframe || event.source !== iframe.contentWindow) return;
      if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
        window.electronAPI.openExternal(event.data.url);
      } else {
        window.open(event.data.url, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    if (event.data.type === 'lana-ready') {
      if (!iframe || event.source !== iframe.contentWindow) return;

      const freshToken = String(
        localStorage.getItem('token')
        || localStorage.getItem('authToken')
        || localStorage.getItem('lana_token')
        || localStorage.getItem('lana_automation_token')
        || ''
      );
      let freshUser = null;
      try {
        freshUser = JSON.parse(localStorage.getItem('user') || localStorage.getItem('lana_automation_user') || 'null');
      } catch (_e) {}
      const freshApiBaseUrl = resolveAutomationApiBaseUrl((window.LanaConfig && window.LanaConfig.API_BASE_URL) || '');

      iframe.contentWindow.postMessage({
        type: 'lana-auth',
        token: freshToken,
        user: freshUser,
        apiBaseUrl: freshApiBaseUrl,
        connectorId: event.data.connectorId || null
      }, '*');
    }
  };
  window.addEventListener('message', onMessage);

  let offOAuthCallback = null;
  if (window.electronAPI && typeof window.electronAPI.onOAuthCallback === 'function') {
    const handler = (callbackData) => {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'lana-oauth-callback', data: callbackData }, '*');
      }
    };
    const unsubscribe = window.electronAPI.onOAuthCallback(handler);
    offOAuthCallback = typeof unsubscribe === 'function' ? unsubscribe : null;
  }

  return {
    removeBridge: () => {
      window.removeEventListener('message', onMessage);
      if (typeof offOAuthCallback === 'function') {
        try { offOAuthCallback(); } catch (_e) {}
      }
    }
  };
}

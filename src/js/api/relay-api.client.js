/* ==========================================================================
   LANA One - Cloud relay settings API client (thin wrapper over window.api)

   Real backend endpoints (src/services/processor/settings/relay-settings.routes.js):
     GET    /api/v1/settings/relay       -> masked configuration state
     PUT    /api/v1/settings/relay       -> save base URL and/or token
     POST   /api/v1/settings/relay/test  -> server-side probe of <base>/v1/models
     DELETE /api/v1/settings/relay       -> clear the stored configuration

   The relay token is write-only through this API: it is sent on save/test
   and never returned by the backend (responses carry token_last4 only).
   ========================================================================== */

(function () {
  'use strict';

  function api() {
    return window.api;
  }

  var RelayApi = {

    // Masked configuration state ({ configured, base_url, token_last4, ... }).
    getSettings: function () {
      return api().get('/api/v1/settings/relay');
    },

    // Save base URL and/or token. payload: { base_url?, token? }
    saveSettings: function (payload) {
      return api().put('/api/v1/settings/relay', payload);
    },

    // Server-side connection probe. payload: { base_url?, token? } (blank
    // fields fall back to stored/env values on the backend).
    testConnection: function (payload) {
      return api().post('/api/v1/settings/relay/test', payload || {});
    },

    // Clear the stored relay configuration on this device.
    disconnect: function () {
      return api().delete('/api/v1/settings/relay');
    }
  };

  window.LanaRelayApi = RelayApi;

})();

/**
 * Lana AI demo fixture loader.
 *
 * Demo mode keeps the API contract intact while sourcing data from local JSON
 * files instead of a live backend.
 */

(function () {
  'use strict';

  var currentScript = document.currentScript;
  var scriptUrl = currentScript ? new URL(currentScript.getAttribute('src'), window.location.href) : new URL('js/mock-data.js', window.location.href);
  var scriptDir = new URL('./', scriptUrl);
  var defaultManifestPath = '../mock-data/demo/manifest.json';

  var MockData = {
    _cache: null,
    _loadPromise: null,
    _manifest: null,
    _scriptDir: scriptDir,

    resolveUrl: function (path, baseUrl) {
      return new URL(path, baseUrl || this._scriptDir).toString();
    },

    getManifestUrl: function () {
      var configuredPath = (window.LanaConfig && window.LanaConfig.DEMO_DATA_MANIFEST) || defaultManifestPath;
      return this.resolveUrl(configuredPath, this._scriptDir);
    },

    load: function () {
      if (this._cache) return Promise.resolve(this._cache);
      if (this._loadPromise) return this._loadPromise;

      var self = this;
      this._loadPromise = this.fetchJson(this.getManifestUrl())
        .then(function (manifest) {
          self._manifest = manifest || {};
          var files = self._manifest.files || {};
          var entries = Object.keys(files);

          return Promise.all(entries.map(function (key) {
            var fileUrl = self.resolveUrl(files[key], self.getManifestUrl());
            return self.fetchJson(fileUrl).then(function (payload) {
              return { key: key, payload: payload || {} };
            });
          }));
        })
        .then(function (datasets) {
          var merged = {};
          datasets.forEach(function (dataset) {
            Object.assign(merged, dataset.payload);
          });

          self._cache = merged;
          return merged;
        })
        .catch(function (error) {
          console.error('[MockData] Failed to load demo fixtures:', error);
          self._loadPromise = null;
          throw error;
        });

      return this._loadPromise;
    },

    fetchJson: function (url) {
      return fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }).then(function (response) {
        if (!response.ok) {
          throw new Error('Failed to load demo fixture: ' + url + ' (' + response.status + ')');
        }
        return response.json();
      });
    },

    getRandomItem: function (array) {
      if (!Array.isArray(array) || array.length === 0) return null;
      return array[Math.floor(Math.random() * array.length)];
    },

    delay: function (ms) {
      var delayMs = typeof ms === 'number' ? ms : 500;
      return new Promise(function (resolve) {
        setTimeout(resolve, delayMs + Math.random() * 300);
      });
    },

    generateId: function (prefix) {
      var key = prefix || 'id';
      return key + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
    }
  };

  window.MockData = MockData;

  if (window.LanaConfig && window.LanaConfig.DEMO_MODE) {
    MockData.load().catch(function () {
      // Let api.js surface a clearer error if a page actually needs fixtures.
    });
  }
})();

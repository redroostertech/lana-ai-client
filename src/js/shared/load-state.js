/**
 * Load state (pure, no DOM): idle, loading, loaded, empty, error, with the
 * latest request winning. Each load calls begin() and gets an id; finish()
 * and fail() for any id but the latest return null and change nothing, so a
 * slow answer for older dates never replaces a newer one. "empty" only comes
 * from a finished request that returned no cards.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LoadState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function createLoadTracker() {
    var latest = 0;
    var tracker = {
      state: 'idle',
      hasLoaded: false,
      begin: function () {
        latest += 1;
        tracker.state = 'loading';
        return latest;
      },
      isLatest: function (id) {
        return id === latest;
      },
      isLoading: function () {
        return tracker.state === 'loading';
      },
      finish: function (id, count) {
        if (id !== latest) return null;
        tracker.state = count > 0 ? 'loaded' : 'empty';
        tracker.hasLoaded = true;
        return tracker.state;
      },
      fail: function (id) {
        if (id !== latest) return null;
        tracker.state = 'error';
        return tracker.state;
      },
    };
    return tracker;
  }

  return { createLoadTracker: createLoadTracker };
});

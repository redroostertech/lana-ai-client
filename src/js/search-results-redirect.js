(function () {
  'use strict';

  function readQuery() {
    var query = '';
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.getParams === 'function') {
      var navParams = window.Lex.Nav.getParams();
      query = navParams.get('q') || navParams.get('query') || '';
    }
    if (!query) {
      var params = new URLSearchParams(window.location.search || '');
      query = params.get('q') || params.get('query') || '';
    }
    return query;
  }

  function redirect() {
    var query = readQuery();
    try {
      sessionStorage.setItem('lana-open-global-search', '1');
      if (query) {
        sessionStorage.setItem('lana-pending-global-search', query);
      }
    } catch (_err) {
      window.name = query
        ? 'lana-pending-global-search:' + query
        : 'lana-open-global-search';
    }

    if (window.UnifiedSearchModal && typeof window.UnifiedSearchModal.openPending === 'function') {
      window.UnifiedSearchModal.openPending({ openEmpty: true, force: true });
      return;
    }

    window.location.href = 'app.html';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', redirect);
  } else {
    redirect();
  }
})();

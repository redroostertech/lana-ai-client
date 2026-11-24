/**
 * Dashboard layout (pure, no DOM).
 *
 * The one place that decides the bento grid: the order of the cards (the
 * server's section order and sort order), what shape each card is (a single
 * number, a goal, a chart of rows, or a waiting state), which card is the
 * hero, and how wide each one is. Never keyed by metric_key.
 *
 * Bands, in order:
 *   hero     the first ok single number (span 2, accent card)
 *   kpi      the next ok numbers or goals, up to KPI_BAND (span 1)
 *   chart    cards whose value is a list with rows (span 2)
 *   support  every other number or goal (span 1), then waiting cards (span 1)
 *
 * Also the greeting line for the page header. No regex (per Lex rules).
 */
(function (root, factory) {
  var view = (root && root.MetricCardView)
    || (typeof require === 'function' ? require('./metric-card-view.js') : null);
  var api = factory(view);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DashboardLayout = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (MetricCardView) {
  'use strict';

  var KPI_BAND = 4;
  var SPANS = { hero: 2, kpi: 1, chart: 2, support: 1 };

  function isOk(card) {
    return !!card && (!card.data_state || card.data_state === 'ok');
  }

  /** 'chart' | 'goal' | 'kpi' | 'state' */
  function cardShape(card) {
    if (!isOk(card)) return 'state';
    if (Array.isArray(card.value)) return card.value.length ? 'chart' : 'state';
    var progress = MetricCardView.goalProgress(card.goal);
    return progress && progress.available ? 'goal' : 'kpi';
  }

  function orderNumber(value) {
    var n = Number(value);
    return value === null || value === undefined || value === '' || !isFinite(n) ? Infinity : n;
  }

  function sectionOrder(card) {
    var section = card && card.section;
    return orderNumber(section && typeof section === 'object' ? section.order : undefined);
  }

  function orderCards(cards) {
    if (!Array.isArray(cards)) return [];
    return cards.map(function (card, index) { return { card: card, index: index }; })
      .sort(function (a, b) {
        var bySection = sectionOrder(a.card) - sectionOrder(b.card);
        if (bySection) return bySection;
        var bySort = orderNumber(a.card && a.card.sort_order) - orderNumber(b.card && b.card.sort_order);
        if (bySort) return bySort;
        return a.index - b.index;
      })
      .map(function (entry) { return entry.card; });
  }

  function pickHero(cards) {
    if (!Array.isArray(cards)) return null;
    for (var i = 0; i < cards.length; i += 1) {
      if (cardShape(cards[i]) === 'kpi') return cards[i];
    }
    return null;
  }

  /**
   * @param {Array} cards - dashboard cards, any order
   * @returns {Array<{card, role, shape, span}>} in display order
   */
  function buildLayout(cards) {
    var ordered = orderCards(cards);
    var hero = pickHero(ordered);
    var kpis = [];
    var charts = [];
    var support = [];
    var states = [];
    ordered.forEach(function (card) {
      if (card === hero) return;
      var shape = cardShape(card);
      if (shape === 'chart') charts.push(card);
      else if (shape === 'state') states.push(card);
      else if (kpis.length < KPI_BAND) kpis.push(card);
      else support.push(card);
    });
    function items(list, role) {
      return list.map(function (card) { return { card: card, role: role, shape: cardShape(card), span: SPANS[role] }; });
    }
    return (hero ? items([hero], 'hero') : [])
      .concat(items(kpis, 'kpi'), items(charts, 'chart'), items(support, 'support'), items(states, 'support'));
  }

  function partOfDay(now) {
    var hour = now.getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  // A system or service account (a first name of "System", or a flag on the
  // user) is not a person to greet.
  var SERVICE_TYPES = { system: true, service: true };

  function isServiceAccount(user, first) {
    if (first.toLowerCase() === 'system') return true;
    if (user.is_system || user.isSystem || user.is_service_account || user.isServiceAccount) return true;
    var type = String(user.account_type || user.accountType || user.user_type || '').toLowerCase();
    return !!SERVICE_TYPES[type];
  }

  // "Good morning, Ana" from the signed-in user, or the dashboard title.
  function greeting(now, user, fallback) {
    var first = user ? String(user.first_name || user.firstName || '').trim() : '';
    if (first && isServiceAccount(user, first)) first = '';
    if (!first) return fallback || 'Dashboard';
    return 'Good ' + partOfDay(now) + ', ' + first;
  }

  return {
    KPI_BAND: KPI_BAND,
    cardShape: cardShape,
    orderCards: orderCards,
    pickHero: pickHero,
    buildLayout: buildLayout,
    greeting: greeting,
  };
});

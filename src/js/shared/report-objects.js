/**
 * Report objects (pure, no DOM, no network).
 *
 * Every data object on a dashboard or report (a deal, a contact, a person,
 * an appointment, a message, a form or survey fill) can open in a side
 * panel. Rows point at objects with refs: [{ object, id }] (a person ref
 * also carries user_id). The panel reads
 * GET /api/v1/report-objects/:object/:id, one shape for every object:
 *   { object, id, title, facts: [{ label, value, format }], timeline?,
 *     links: [{ object, id, label }] }
 * where a person adds lana_account, linked accounts and activity, and a
 * deal adds timeline and contributors.
 *
 * Only allowlisted fields render, and anything that looks like a secret
 * (password, token, secret, key, hash) never does. No regex (Lex rules).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReportObjects = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var OBJECT_LABELS = {
    person: 'Person', deal: 'Deal', contact: 'Contact', appointment: 'Appointment',
    message: 'Message', form_fill: 'Form', survey_fill: 'Survey',
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SECRET_WORDS = ['password', 'passwd', 'token', 'secret', 'key', 'hash', 'salt', 'credential', 'apikey'];

  function host() {
    return typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  }

  function firmCurrency() {
    var utils = host().Lex && host().Lex.Utils;
    return utils && typeof utils.getFirmCurrency === 'function' ? utils.getFirmCurrency() : 'USD';
  }

  function firmZone() {
    var utils = host().Lex && host().Lex.Utils;
    return utils && typeof utils.getFirmTimezone === 'function' ? utils.getFirmTimezone() : 'UTC';
  }

  function str(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function words(key) {
    var text = str(key).split('_').join(' ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // Splits "apiKey", "reset_token", "Password hash" into lower-case words.
  function wordsOf(key) {
    var text = str(key);
    var out = [];
    var current = '';
    for (var i = 0; i < text.length; i += 1) {
      var ch = text.charAt(i);
      var lower = ch.toLowerCase();
      var isUpper = ch !== lower;
      var isLetterOrDigit = (lower >= 'a' && lower <= 'z') || (ch >= '0' && ch <= '9');
      if (!isLetterOrDigit) { if (current) out.push(current); current = ''; continue; }
      if (isUpper && current) { out.push(current); current = ''; }
      current += lower;
    }
    if (current) out.push(current);
    return out;
  }

  /** True for anything that looks like a secret: never shown. */
  function isSecretKey(key) {
    var parts = wordsOf(key);
    var joined = parts.join('');
    for (var i = 0; i < SECRET_WORDS.length; i += 1) {
      if (parts.indexOf(SECRET_WORDS[i]) !== -1) return true;
    }
    return joined.indexOf('password') !== -1 || joined.indexOf('apikey') !== -1;
  }

  // ── Refs ────────────────────────────────────────────────────────────
  function cleanRef(ref) {
    if (!ref || typeof ref !== 'object' || !ref.object || ref.id === null || ref.id === undefined || ref.id === '') return null;
    var out = { object: String(ref.object), id: String(ref.id) };
    if (ref.user_id !== null && ref.user_id !== undefined && ref.user_id !== '') out.user_id = String(ref.user_id);
    return out;
  }

  function refsOf(row) {
    var list = row && Array.isArray(row.refs) ? row.refs : [];
    return list.map(cleanRef).filter(Boolean);
  }

  function primaryRef(row) {
    var refs = refsOf(row);
    return refs.length ? refs[0] : null;
  }

  // A ref as one attribute value ("object|id|user_id") and back.
  function refAttr(ref) {
    var r = cleanRef(ref);
    if (!r) return '';
    return [r.object, r.id, r.user_id || ''].map(encodeURIComponent).join('|');
  }

  function parseRef(text) {
    var parts = str(text).split('|');
    if (parts.length !== 3) return null;
    try {
      return cleanRef({ object: decodeURIComponent(parts[0]), id: decodeURIComponent(parts[1]), user_id: decodeURIComponent(parts[2]) });
    } catch (_error) {
      return null;
    }
  }

  // ── Formats ─────────────────────────────────────────────────────────
  function dayText(value) {
    var text = str(value);
    if (text.length < 10 || text.charAt(4) !== '-' || text.charAt(7) !== '-') return text;
    var month = Number(text.substring(5, 7));
    var day = Number(text.substring(8, 10));
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return text;
    return MONTHS[month - 1] + ' ' + day + ', ' + text.substring(0, 4);
  }

  function dateTimeText(value) {
    var date = new Date(str(value));
    if (!isFinite(date.getTime())) return dayText(value);
    try {
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: firmZone() });
    } catch (_error) {
      return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    }
  }

  function formatFact(value, format) {
    if (value === null || value === undefined || value === '') return '';
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    var n = Number(value);
    switch (format) {
      case 'number': return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : str(value);
      case 'currency': return isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: firmCurrency(), maximumFractionDigits: 0 }) : str(value);
      case 'percent': return isFinite(n) ? (Math.round(n * 10) / 10) + '%' : str(value);
      case 'date': return dayText(value);
      case 'datetime': return dateTimeText(value);
      case 'status': return words(value);
      default: return typeof value === 'object' ? '' : str(value);
    }
  }

  function hrefFor(value, format) {
    var text = str(value);
    if (!text) return null;
    if (format === 'email' && text.indexOf('@') > 0) return 'mailto:' + text;
    if (format === 'phone') {
      var digits = text.split('').filter(function (ch) { return (ch >= '0' && ch <= '9') || ch === '+'; }).join('');
      return digits ? 'tel:' + digits : null;
    }
    return null;
  }

  function factList(list) {
    return (Array.isArray(list) ? list : []).filter(function (f) {
      return f && typeof f === 'object' && str(f.label) && !isSecretKey(f.label);
    }).map(function (f) {
      var fact = { label: str(f.label), text: formatFact(f.value, f.format), raw: f.value };
      var href = hrefFor(f.value, f.format);
      if (href) fact.href = href;
      return fact;
    }).filter(function (f) { return f.text !== ''; });
  }

  // ── The panel model ─────────────────────────────────────────────────
  var ACCOUNT_ROWS = [
    ['role', 'Role', 'text'], ['title', 'Title', 'text'], ['invited_at', 'Invited', 'datetime'],
    ['account_created_at', 'Account created', 'datetime'], ['activated_at', 'Activated', 'datetime'], ['last_signed_in_at', 'Last signed in', 'datetime'],
  ];
  var NOT_YET = { activated_at: 'Not yet', last_signed_in_at: 'Not yet' };

  function accountModel(account) {
    if (!account || typeof account !== 'object') return null;
    var rows = [];
    ACCOUNT_ROWS.forEach(function (spec) {
      var has = Object.prototype.hasOwnProperty.call(account, spec[0]);
      if (!has) return;
      var text = formatFact(account[spec[0]], spec[2]) || NOT_YET[spec[0]] || '';
      if (text) rows.push([spec[1], text]);
    });
    return { state: str(account.state) || 'No LANA account', rows: rows, hasUser: !!account.user_id };
  }

  // linked_accounts [{ connection_name, display_name, email, matched_by, ... }]
  function linkedModel(list) {
    return (Array.isArray(list) ? list : []).filter(function (a) { return a && typeof a === 'object'; }).map(function (a) {
      return {
        connection: str(a.connection_name),
        name: str(a.display_name) || str(a.external_user_id),
        email: str(a.email),
        matchedBy: str(a.matched_by) ? 'Matched by ' + str(a.matched_by).split('_').join(' ') : '',
      };
    });
  }

  // activity [{ label, value, format }]: a null value (for example messages
  // before message history syncs) is "Not available yet", never 0.
  function activityModel(activity) {
    return (Array.isArray(activity) ? activity : []).filter(function (a) { return a && str(a.label) && !isSecretKey(a.label); }).map(function (a) {
      var text = a.value === null || a.value === undefined ? '' : formatFact(a.value, a.format || 'number');
      return { label: str(a.label), text: text || 'Not available yet' };
    });
  }

  function addDay(day, n) {
    var t = Date.parse(day + 'T00:00:00Z');
    return isFinite(t) ? new Date(t + n * 86400000).toISOString().substring(0, 10) : '';
  }

  // "Activity for <dates>". An end exactly one day after the requested end
  // is an exclusive end: show the requested end.
  function activityTitle(period, requestedEnd) {
    if (!period || typeof period !== 'object' || !period.period_start || !period.period_end) return 'Activity for these dates';
    var end = str(period.period_end).substring(0, 10);
    var asked = str(requestedEnd).substring(0, 10);
    if (asked && end === addDay(asked, 1)) end = asked;
    return 'Activity for ' + dayText(str(period.period_start).substring(0, 10)) + ' to ' + dayText(end);
  }

  // The timeline actor: actor { object, id, user_id, label } (clickable),
  // else actor_label; actor_kind 'not_recorded' says so.
  function actorModel(event) {
    if (event.actor && typeof event.actor === 'object') return { label: str(event.actor.label) || 'Someone', ref: cleanRef(event.actor) };
    if (event.actor_kind === 'not_recorded') return { label: 'Not recorded', ref: null };
    var name = str(event.actor_label);
    return name ? { label: name, ref: null } : null;
  }

  function refLinks(list) {
    return (Array.isArray(list) ? list : []).map(function (r) {
      var ref = cleanRef(r);
      return ref ? { label: str(r.label) || OBJECT_LABELS[ref.object] || words(ref.object), ref: ref } : null;
    }).filter(Boolean);
  }

  function eventTime(event) {
    return str(event.occurred_at);
  }

  function sameRef(a, b) {
    return !!(a && b && a.object === b.object && a.id === b.id);
  }

  /**
   * Newest first. The event label links to its main ref; refs that point at
   * the panel's own record or repeat the actor are dropped; the rest stay
   * as a short "Open:" list. before_deal events are marked.
   */
  function timelineModel(list, self) {
    return (Array.isArray(list) ? list : []).filter(function (e) { return e && typeof e === 'object'; })
      .slice().sort(function (a, b) {
        var ta = Date.parse(eventTime(a));
        var tb = Date.parse(eventTime(b));
        return (isFinite(tb) ? tb : 0) - (isFinite(ta) ? ta : 0);
      })
      .map(function (e) {
        var at = eventTime(e);
        var actor = actorModel(e);
        var refs = refLinks(e.refs).filter(function (r) { return !sameRef(r.ref, self) && !(actor && sameRef(r.ref, actor.ref)); });
        return {
          when: at ? dayText(at.substring(0, 10)) : '',
          text: str(e.label),
          main: refs.length ? refs[0].ref : null,
          actor: actor,
          byOwner: e.by_owner === true,
          detail: str(e.detail),
          others: refLinks(e.other_people),
          refs: refs.slice(1),
          beforeDeal: e.before_deal === true,
          kind: str(e.event_kind),
        };
      })
      .filter(function (e) { return e.text; });
  }

  // Facts that repeat the LANA account (same value as an account field)
  // are left out when the account section shows.
  function withoutAccountRepeats(facts, account) {
    if (!account || typeof account !== 'object') return facts;
    var values = Object.keys(account).filter(function (k) { return !isSecretKey(k) && account[k] !== null && typeof account[k] !== 'object'; })
      .map(function (k) { return str(account[k]); }).filter(Boolean);
    return facts.filter(function (f) {
      var raw = str(f.raw);
      return !raw || values.indexOf(raw) === -1;
    });
  }

  // contributors [{ person: { object, id, user_id, label }, did: [{ label, count }], is_owner, is_follower }]
  function contributorsModel(list) {
    return (Array.isArray(list) ? list : []).filter(function (c) { return c && typeof c === 'object' && c.person && typeof c.person === 'object'; }).map(function (c) {
      return {
        label: str(c.person.label) || 'Someone',
        ref: cleanRef(c.person),
        did: (Array.isArray(c.did) ? c.did : []).filter(function (d) { return d && str(d.label); }).map(function (d) {
          return d.count === null || d.count === undefined ? str(d.label) : str(d.label) + ': ' + Number(d.count).toLocaleString('en-US');
        }),
        owner: c.is_owner === true,
        follower: c.is_follower === true,
      };
    });
  }

  function linksModel(list) {
    return (Array.isArray(list) ? list : []).map(function (l) {
      var ref = cleanRef(l);
      return ref ? { label: str(l && l.label) || OBJECT_LABELS[ref.object] || words(ref.object), ref: ref, kind: OBJECT_LABELS[ref.object] || words(ref.object) } : null;
    }).filter(Boolean);
  }

  /**
   * The panel's view of a report object (any kind), allowlisted.
   * options.requestedEnd: the end day the panel asked for.
   */
  function panelModel(data, options) {
    var d = data && typeof data === 'object' ? data : {};
    var o = options || {};
    var object = str(d.object);
    var account = object === 'person' ? accountModel(d.lana_account || {}) : null;
    var facts = factList(d.facts);
    if (object === 'person' && d.lana_account) facts = withoutAccountRepeats(facts, d.lana_account);
    return {
      object: object,
      id: str(d.id),
      kind: OBJECT_LABELS[object] || words(object) || 'Record',
      title: str(d.title) || OBJECT_LABELS[object] || 'Record',
      facts: facts.map(function (f) { var out = { label: f.label, text: f.text }; if (f.href) out.href = f.href; return out; }),
      account: account,
      linked: linkedModel(d.linked_accounts),
      activity: activityModel(d.activity),
      activityTitle: activityTitle(d.activity_period, o.requestedEnd),
      activityNote: str(d.activity_note),
      timeline: timelineModel(d.timeline, cleanRef({ object: object, id: d.id })),
      timelineNote: str(d.timeline_note),
      timelineTotal: isFinite(Number(d.timeline_total)) && d.timeline_total !== null ? Number(d.timeline_total) : (Array.isArray(d.timeline) ? d.timeline.length : 0),
      contributors: contributorsModel(d.contributors),
      links: linksModel(d.links),
    };
  }

  // ── When the record cannot load ─────────────────────────────────────
  function errorText(err) {
    var status = err && (err.status || (err.response && err.response.status));
    if (status === 404) return 'Not found, or you don\'t have access to this record.';
    if (status === 403) return 'You don\'t have access to this record.';
    if (status === 400) return 'This kind of record can\'t be shown here.';
    return 'This record could not load. Try again in a moment.';
  }

  var ROW_LABELS = { client_name: 'Client', matter_name: 'Matter', owner_name: 'Owner', attorney_name: 'Attorney', due_date: 'Due' };

  function isInternalKey(key) {
    var k = str(key);
    if (!k || k.charAt(0) === '_' || k === 'id' || k === 'uuid' || k === 'refs' || k === 'record_id') return true;
    var tails = ['_id', '_key', '_ref', '_uuid'];
    for (var i = 0; i < tails.length; i += 1) {
      if (k.length > tails[i].length && k.slice(-tails[i].length) === tails[i]) return true;
    }
    return isSecretKey(k);
  }

  /** The row's own fields, for when the record cannot load. */
  function rowModel(row) {
    var r = row && typeof row === 'object' ? row : {};
    var facts = Object.keys(r).filter(function (k) {
      return !isInternalKey(k) && r[k] !== null && r[k] !== undefined && r[k] !== '' && typeof r[k] !== 'object';
    }).map(function (k) {
      return { label: ROW_LABELS[k] || words(k), text: formatFact(r[k], 'text') };
    });
    return { facts: facts };
  }

  return {
    OBJECT_LABELS: OBJECT_LABELS,
    isSecretKey: isSecretKey,
    refsOf: refsOf,
    primaryRef: primaryRef,
    refAttr: refAttr,
    parseRef: parseRef,
    formatFact: formatFact,
    panelModel: panelModel,
    errorText: errorText,
    rowModel: rowModel,
  };
});

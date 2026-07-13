/*
 * chat-verify-panels.js
 *
 * ADDITIVE, framework-agnostic renderers for the two brand-critical SSE events
 * emitted by the LANA One chat backend during a turn:
 *
 *   1. sovereignty_receipt  -> the honest "what left this device" data-path receipt
 *   2. citation_verification -> the citation authority gate result
 *
 * Design rules (do not relax):
 *   - HONESTY IS THE PRODUCT. Render the receipt verbatim/faithfully. Never
 *     upgrade "detected and removed" to "protected". When degraded is true, the
 *     caveat is shown LOUDLY. When contentLeftDevice is true, we never imply
 *     nothing left the device.
 *   - Citations that are not-found or unverified must look clearly NOT
 *     authoritative. We never render a verified/authoritative treatment for them.
 *   - Icons only, never emoji. Inline SVG, currentColor, viewBox 0 0 24 24 to
 *     match the existing chat.js icon convention.
 *   - No em dashes anywhere in copy.
 *
 * The module exposes pure DOM-builder functions so both chat surfaces can reuse
 * it: js/chat.js (the chat.html client) and the lex-chat component system
 * (chat-v2.html). Each builder returns an HTMLElement or null; it never throws
 * and never mutates its input.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- helpers ---------------------------------------------------------------

  function esc(s) {
    if (s == null) { return ''; }
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Inline SVG icon factory. `paths` is an array of <path d="..."> strings.
  function icon(paths, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'lana-vp-icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('viewBox', '0 0 24 24');
    (paths || []).forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  // A small named-icon table (icons, not emoji).
  var ICONS = {
    // shield with a check
    shieldCheck: ['M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z', 'M9.2 12l2 2 3.6-4'],
    // shield with an exclamation (degraded / reduced accuracy)
    shieldAlert: ['M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z', 'M12 8v4', 'M12 15.5v.5'],
    // arrow leaving a boundary (egress)
    egress: ['M14 5l7 7-7 7', 'M21 12H8', 'M6 4v16'],
    // a device / lock-on-device (content stayed local)
    device: ['M9 17H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2', 'M9 21h6', 'M12 17v4'],
    check: ['M5 13l4 4L19 7'],
    x: ['M6 6l12 12', 'M18 6L6 18'],
    question: ['M9.1 9a3 3 0 1 1 4.5 2.6c-.9.5-1.6 1.2-1.6 2.4', 'M12 17.5v.5'],
    scale: ['M12 3v18', 'M5 7h14', 'M5 7l-2.5 6a3 3 0 0 0 5 0L5 7z', 'M19 7l-2.5 6a3 3 0 0 0 5 0L19 7z']
  };

  function tag(name, cls, text) {
    var el = document.createElement(name);
    if (cls) { el.className = cls; }
    if (text != null) { el.textContent = String(text); }
    return el;
  }

  // ---- sovereignty receipt ---------------------------------------------------

  /**
   * Pure honesty view-model for a receipt. Encapsulates every brand-critical
   * decision (verbatim headline, loud degraded caveat, egress phrasing) so it
   * can be asserted without a DOM. Returns null when there is no receipt.
   */
  function receiptView(payload) {
    var receipt = payload && payload.receipt;
    if (!receipt) { return null; }

    var degraded = receipt.degraded === true;
    var leftDevice = receipt.contentLeftDevice === true;
    var egress = Array.isArray(receipt.egress) ? receipt.egress : [];
    var byType = Array.isArray(receipt.byType) ? receipt.byType : [];
    var n = (typeof receipt.detectedCount === 'number') ? receipt.detectedCount : null;

    var egressText;
    if (leftDevice) {
      egressText = egress.length > 0
        ? 'Left this device via ' + egress.map(function (e) { return (e && (e.label || e.klass)) || 'a relay'; }).join(', ')
        : 'Left this device';
    } else {
      egressText = 'Stayed on this device';
    }

    return {
      // headline is passed through verbatim; never rewritten.
      headline: receipt.headline || 'Data path receipt',
      sentence: receipt.sentence || '',
      caveat: receipt.caveat || '',
      degraded: degraded,
      // the loud caveat is shown ONLY when degraded and a caveat exists.
      loudCaveat: degraded && !!receipt.caveat,
      contentLeftDevice: leftDevice,
      egressText: egressText,
      detectedCount: n,
      detectedLabel: n != null ? ('Detected ' + n + ' identifier' + (n === 1 ? '' : 's')) : 'Detected identifiers',
      byType: byType,
      headIcon: degraded ? 'shieldAlert' : 'shieldCheck'
    };
  }

  /**
   * Build the sovereignty-receipt panel element.
   * @param {Object} payload - { type, receipt, redaction }
   * @returns {HTMLElement|null} - null when there is no receipt (turn emitted none)
   */
  function buildSovereigntyReceipt(payload) {
    var receipt = payload && payload.receipt;
    if (!receipt) { return null; }

    var degraded = receipt.degraded === true;
    var leftDevice = receipt.contentLeftDevice === true;

    var panel = tag('div', 'lana-vp lana-vp-receipt' + (degraded ? ' lana-vp-receipt--degraded' : ''));
    panel.setAttribute('role', 'note');
    panel.setAttribute('aria-label', 'Data path receipt');

    // Header: icon + headline (verbatim). When degraded we swap to the alert
    // shield so the visual never over-promises accuracy.
    var header = tag('div', 'lana-vp-header');
    header.appendChild(icon(degraded ? ICONS.shieldAlert : ICONS.shieldCheck, 'lana-vp-icon--head'));
    // headline is rendered verbatim; we NEVER rewrite "detected and removed".
    header.appendChild(tag('span', 'lana-vp-headline', receipt.headline || 'Data path receipt'));
    panel.appendChild(header);

    // Degraded caveat: LOUD, right under the headline, before anything else.
    if (degraded && receipt.caveat) {
      var loud = tag('div', 'lana-vp-caveat lana-vp-caveat--loud');
      loud.appendChild(icon(ICONS.shieldAlert, 'lana-vp-icon--inline'));
      loud.appendChild(tag('span', null, receipt.caveat));
      panel.appendChild(loud);
    }

    // The honest data-path sentence, verbatim.
    if (receipt.sentence) {
      panel.appendChild(tag('p', 'lana-vp-sentence', receipt.sentence));
    }

    // Non-degraded caveat still shown, just not in the loud style.
    if (!degraded && receipt.caveat) {
      var cav = tag('div', 'lana-vp-caveat');
      panel.appendChild(cav);
      cav.appendChild(tag('span', null, receipt.caveat));
    }

    // Per-type detected list (compact chips). detectedCount is the source of truth.
    var byType = Array.isArray(receipt.byType) ? receipt.byType : [];
    if (byType.length > 0) {
      var detWrap = tag('div', 'lana-vp-detected');
      var n = (typeof receipt.detectedCount === 'number') ? receipt.detectedCount : null;
      detWrap.appendChild(tag('span', 'lana-vp-detected-label',
        n != null ? ('Detected ' + n + ' identifier' + (n === 1 ? '' : 's')) : 'Detected identifiers'));
      var chips = tag('div', 'lana-vp-chips');
      byType.forEach(function (bt) {
        if (!bt) { return; }
        var chip = tag('span', 'lana-vp-chip');
        var label = (bt.type != null ? bt.type : '') + '';
        var count = (typeof bt.count === 'number') ? bt.count : null;
        chip.textContent = count != null ? (label + ' x' + count) : label;
        chips.appendChild(chip);
      });
      detWrap.appendChild(chips);
      panel.appendChild(detWrap);
    }

    // Egress line: what channel(s) content or redacted content crossed. When
    // contentLeftDevice is true we state it plainly with the egress icon; we
    // never imply nothing left the device.
    var egress = Array.isArray(receipt.egress) ? receipt.egress : [];
    var egressRow = tag('div', 'lana-vp-egress');
    if (leftDevice) {
      egressRow.appendChild(icon(ICONS.egress, 'lana-vp-icon--inline lana-vp-icon--egress'));
      var eLabel = tag('span', 'lana-vp-egress-text');
      if (egress.length > 0) {
        eLabel.textContent = 'Left this device via ' +
          egress.map(function (e) { return (e && (e.label || e.klass)) || 'a relay'; }).join(', ');
      } else {
        eLabel.textContent = 'Left this device';
      }
      egressRow.appendChild(eLabel);
      panel.appendChild(egressRow);
    } else {
      // Content stayed local. State that honestly with the on-device icon.
      egressRow.appendChild(icon(ICONS.device, 'lana-vp-icon--inline lana-vp-icon--local'));
      egressRow.appendChild(tag('span', 'lana-vp-egress-text', 'Stayed on this device'));
      panel.appendChild(egressRow);
    }

    return panel;
  }

  // ---- citation verification -------------------------------------------------

  var VERDICT_META = {
    'verified': { cls: 'verified', label: 'Verified', icon: ICONS.check },
    'not-found': { cls: 'notfound', label: 'Not found', icon: ICONS.x },
    'unverified': { cls: 'unverified', label: 'Unverified', icon: ICONS.question }
  };

  function verdictMeta(v) {
    return VERDICT_META[v] || VERDICT_META['unverified'];
  }

  /**
   * Pure view-model for one citation. A citation is treated as authoritative
   * ONLY when the backend says authoritative === true AND the verdict is
   * 'verified'. Anything else is explicitly non-authoritative so it can never
   * be styled as an authority.
   */
  function citationRowView(c) {
    var m = verdictMeta(c && c.verdict);
    var authoritative = !!(c && c.authoritative === true && c.verdict === 'verified');
    return {
      verdict: (c && c.verdict) || 'unverified',
      verdictClass: m.cls,
      verdictLabel: m.label,
      authoritative: authoritative,
      display: (c && (c.display || c.raw || c.citationKey)) || 'Citation',
      // reason surfaced for anything not verified, for transparency.
      showReason: !!(c && c.reason && c.verdict !== 'verified')
    };
  }

  /**
   * Build the citation-verification panel element.
   * @param {Object} payload - { type, citations:[...], summary:{...} }
   * @returns {HTMLElement|null} - null when there is nothing to show
   */
  function buildCitationVerification(payload) {
    var citations = payload && Array.isArray(payload.citations) ? payload.citations : [];
    var summary = (payload && payload.summary) || null;
    if (citations.length === 0) { return null; }

    var panel = tag('div', 'lana-vp lana-vp-cite');
    panel.setAttribute('role', 'note');
    panel.setAttribute('aria-label', 'Citation verification');

    // Header + summary.
    var header = tag('div', 'lana-vp-header');
    header.appendChild(icon(ICONS.scale, 'lana-vp-icon--head'));
    header.appendChild(tag('span', 'lana-vp-headline', 'Citation check'));
    panel.appendChild(header);

    if (summary) {
      var total = typeof summary.total === 'number' ? summary.total : citations.length;
      var verified = typeof summary.verified === 'number' ? summary.verified : 0;
      var sumRow = tag('div', 'lana-vp-cite-summary');
      // Faithful summary. If not everything verified, say so plainly; if there
      // are unauthoritative citations, flag it, do not gloss over it.
      var parts = [];
      parts.push(verified + ' of ' + total + ' verified against authority');
      if (summary.allVerified !== true) {
        var remaining = total - verified;
        if (remaining > 0) {
          parts.push(remaining + ' not confirmed');
        }
      }
      sumRow.appendChild(tag('span', 'lana-vp-cite-summary-text', parts.join('. ') + '.'));
      if (summary.hasUnauthoritative === true) {
        var warn = tag('span', 'lana-vp-cite-warn');
        warn.appendChild(icon(ICONS.question, 'lana-vp-icon--inline'));
        warn.appendChild(tag('span', null, 'Some cited items are not authoritative. Do not rely on them without checking the source.'));
        sumRow.appendChild(warn);
      }
      panel.appendChild(sumRow);
    }

    // Per-citation rows.
    var list = tag('div', 'lana-vp-cite-list');
    citations.forEach(function (c) {
      if (!c) { return; }
      var vm = citationRowView(c);
      var m = verdictMeta(c.verdict);

      var row = tag('div', 'lana-vp-cite-row lana-vp-cite-row--' + vm.verdictClass +
        (vm.authoritative ? ' lana-vp-cite-row--authoritative' : ' lana-vp-cite-row--nonauthoritative'));

      var chip = tag('span', 'lana-vp-verdict lana-vp-verdict--' + vm.verdictClass);
      chip.appendChild(icon(m.icon, 'lana-vp-icon--inline'));
      chip.appendChild(tag('span', null, vm.verdictLabel));
      row.appendChild(chip);

      var body = tag('div', 'lana-vp-cite-body');
      body.appendChild(tag('span', 'lana-vp-cite-display', vm.display));

      var metaBits = [];
      if (c.jurisdiction) { metaBits.push(c.jurisdiction); }
      if (c.authorityType) { metaBits.push(c.authorityType); }
      if (metaBits.length > 0) {
        body.appendChild(tag('span', 'lana-vp-cite-meta', metaBits.join(' - ')));
      }
      // Reason is shown for anything not verified so the "why" is transparent.
      if (vm.showReason) {
        body.appendChild(tag('span', 'lana-vp-cite-reason', c.reason));
      }
      row.appendChild(body);
      list.appendChild(row);
    });
    panel.appendChild(list);

    return panel;
  }

  var api = {
    buildSovereigntyReceipt: buildSovereigntyReceipt,
    buildCitationVerification: buildCitationVerification,
    // pure view-models (DOM-free) exposed for tests + reuse
    receiptView: receiptView,
    citationRowView: citationRowView,
    _esc: esc,
    _verdictMeta: verdictMeta
  };

  global.LanaVerifyPanels = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

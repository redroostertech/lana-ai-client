/**
 * Unit tests - src/js/chat-verify-panels.js
 *
 * These cover the DOM-free view-model + helper layer, which carries every
 * brand-critical honesty decision for the two additive SSE panels:
 *   - sovereignty receipt  (receiptView)
 *   - citation verification (citationRowView / _verdictMeta)
 *
 * The DOM builders (buildSovereigntyReceipt / buildCitationVerification) require
 * a browser DOM and are exercised live in the chat client; jsdom is not
 * installed in this repo's jest setup, so we assert the pure logic here. No em
 * dashes and no emoji are asserted directly by scanning the module source.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VP = require('../../src/js/chat-verify-panels');

// ---------------------------------------------------------------------------
// receiptView - honesty rules
// ---------------------------------------------------------------------------

describe('receiptView', () => {
  test('returns null when there is no receipt (local / passthrough turn)', () => {
    expect(VP.receiptView(null)).toBeNull();
    expect(VP.receiptView({})).toBeNull();
    expect(VP.receiptView({ receipt: null })).toBeNull();
  });

  test('passes the headline through verbatim, never upgrading the wording', () => {
    const v = VP.receiptView({
      receipt: { headline: 'Detected and removed: 2 identifiers', contentLeftDevice: true }
    });
    expect(v.headline).toBe('Detected and removed: 2 identifiers');
    // Never silently reword to a stronger claim.
    expect(v.headline).not.toMatch(/protected/i);
  });

  test('degraded receipt surfaces a LOUD caveat and the alert head icon', () => {
    const v = VP.receiptView({
      receipt: {
        headline: 'Detected and removed (reduced accuracy): 1 identifier',
        caveat: 'On-device detection ran with reduced accuracy.',
        degraded: true,
        contentLeftDevice: true
      }
    });
    expect(v.degraded).toBe(true);
    expect(v.loudCaveat).toBe(true);
    expect(v.headIcon).toBe('shieldAlert');
  });

  test('non-degraded receipt does not use the loud caveat style', () => {
    const v = VP.receiptView({
      receipt: { headline: 'x', caveat: 'note', degraded: false, contentLeftDevice: true }
    });
    expect(v.loudCaveat).toBe(false);
    expect(v.headIcon).toBe('shieldCheck');
  });

  test('when content left the device, the egress line says so (never implies nothing left)', () => {
    const v = VP.receiptView({
      receipt: {
        headline: 'x',
        contentLeftDevice: true,
        egress: [{ klass: 'cloud', label: 'a multi-tenant relay' }]
      }
    });
    expect(v.contentLeftDevice).toBe(true);
    expect(v.egressText).toBe('Left this device via a multi-tenant relay');
    expect(v.egressText).not.toMatch(/stayed on this device/i);
  });

  test('content-left-device with no egress detail still states it left', () => {
    const v = VP.receiptView({ receipt: { headline: 'x', contentLeftDevice: true } });
    expect(v.egressText).toBe('Left this device');
  });

  test('when content stayed local, the egress line reflects that honestly', () => {
    const v = VP.receiptView({ receipt: { headline: 'x', contentLeftDevice: false } });
    expect(v.egressText).toBe('Stayed on this device');
  });

  test('detected label pluralizes off detectedCount', () => {
    expect(VP.receiptView({ receipt: { headline: 'x', detectedCount: 1, byType: [] } }).detectedLabel)
      .toBe('Detected 1 identifier');
    expect(VP.receiptView({ receipt: { headline: 'x', detectedCount: 2, byType: [] } }).detectedLabel)
      .toBe('Detected 2 identifiers');
  });
});

// ---------------------------------------------------------------------------
// citationRowView - authority is only ever granted to verified
// ---------------------------------------------------------------------------

describe('citationRowView', () => {
  test('verified + authoritative renders as authoritative', () => {
    const vm = VP.citationRowView({ verdict: 'verified', authoritative: true, display: 'X v Y' });
    expect(vm.authoritative).toBe(true);
    expect(vm.verdictClass).toBe('verified');
    expect(vm.verdictLabel).toBe('Verified');
  });

  test('not-found is never authoritative, even if the flag is set', () => {
    const vm = VP.citationRowView({ verdict: 'not-found', authoritative: true, reason: 'no match' });
    expect(vm.authoritative).toBe(false);
    expect(vm.verdictClass).toBe('notfound');
    expect(vm.showReason).toBe(true);
  });

  test('unverified is never authoritative and shows its reason', () => {
    const vm = VP.citationRowView({ verdict: 'unverified', authoritative: false, reason: 'no verifier' });
    expect(vm.authoritative).toBe(false);
    expect(vm.verdictClass).toBe('unverified');
    expect(vm.showReason).toBe(true);
  });

  test('verified rows hide the reason (nothing to explain away)', () => {
    const vm = VP.citationRowView({ verdict: 'verified', authoritative: true, reason: 'ignored' });
    expect(vm.showReason).toBe(false);
  });

  test('unknown / missing verdict falls back to unverified (fail-safe, not authoritative)', () => {
    const vm = VP.citationRowView({ display: 'X' });
    expect(vm.verdict).toBe('unverified');
    expect(vm.authoritative).toBe(false);
  });

  test('display prefers display, then raw, then citationKey', () => {
    expect(VP.citationRowView({ display: 'D', raw: 'R', citationKey: 'K' }).display).toBe('D');
    expect(VP.citationRowView({ raw: 'R', citationKey: 'K' }).display).toBe('R');
    expect(VP.citationRowView({ citationKey: 'K' }).display).toBe('K');
    expect(VP.citationRowView({}).display).toBe('Citation');
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

describe('_verdictMeta / _esc', () => {
  test('verdict meta maps the three verdicts, defaulting to unverified', () => {
    expect(VP._verdictMeta('verified').cls).toBe('verified');
    expect(VP._verdictMeta('not-found').cls).toBe('notfound');
    expect(VP._verdictMeta('unverified').cls).toBe('unverified');
    expect(VP._verdictMeta('garbage').cls).toBe('unverified');
  });

  test('_esc neutralizes HTML control characters', () => {
    expect(VP._esc('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;');
    expect(VP._esc(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// style-guard: the module source must contain no em dashes and no emoji
// ---------------------------------------------------------------------------

describe('style guard', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/js/chat-verify-panels.js'), 'utf8');

  test('no em dashes in the module', () => {
    expect(src.includes('—')).toBe(false);
  });

  test('no emoji / pictographic glyphs in the module', () => {
    // Scan for common emoji / symbol blocks. Icons are inline SVG, not glyphs.
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    expect(emoji.test(src)).toBe(false);
  });
});

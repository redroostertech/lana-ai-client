/**
 * LANA Briefs: the top bar's phone status icon and its hover card, from what the Briefs
 * host reports (devices.gatewayStatus, preferences.get, devices.list). Plain functions; no
 * DOM. The page (src/briefs/app.js) hands the result to lex-topbar;
 * tests/unit/briefs/briefs-status.test.js covers it.
 */
(function (global) {
  'use strict';

  const pairedDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  /** The heading and the line under it, per listener state. */
  function describe(listener, error) {
    switch (listener && listener.kind) {
      case 'listening':
        return { tone: 'good', label: 'Listening for your phone', summary: 'This computer is ready to receive meetings from your phone. Keep LANA open, with both devices on the same network.' };
      case 'waitingForPairing':
        return { tone: 'warning', label: 'No phone paired', summary: 'Pair a phone to send meetings to this computer. Until then this computer does not listen on your network.' };
      case 'starting':
        return { tone: 'warning', label: 'Starting', summary: 'LANA Briefs is starting on this computer. Meetings from your phone can be received in a moment.' };
      case 'signedOut':
        return { tone: 'warning', label: 'Signed out', summary: 'Sign in to LANA to receive meetings from your phone.' };
      case 'failed':
        return { tone: 'warning', label: 'Stopped', summary: `${error || 'LANA Briefs stopped listening for your phone.'} Restart LANA to try again.` };
      default:
        return { tone: 'warning', label: 'Not listening', summary: 'This computer is not receiving meetings from your phone right now.' };
    }
  }

  function phonesValue(phones) {
    if (!Array.isArray(phones) || phones.length === 0) return 'None paired';
    return phones.map((phone) => {
      const name = String(phone.displayName || '').trim() || 'Phone';
      const when = phone.pairedAt ? Date.parse(phone.pairedAt) : Number.NaN;
      return Number.isNaN(when) ? name : `${name}, paired ${pairedDate.format(new Date(when))}`;
    }).join('\n');
  }

  function backgroundValue(background) {
    if (!background || !background.enabled) return 'Off';
    const hours = Number(background.leaseHours) || 0;
    return hours > 0 ? `On, for ${hours} ${hours === 1 ? 'hour' : 'hours'} after each sync` : 'On';
  }

  /**
   * The icon and hover card: { icon, tone, label, summary, rows } where rows are
   * { label, value } pairs. Null inputs (the host has not answered) still give a card.
   */
  function statusCard(gateway, preferences, phones) {
    const listener = gateway ? gateway.listener : null;
    const text = describe(listener, preferences && preferences.listenerError);
    const rows = [];
    if (gateway && gateway.receiving) rows.push({ label: 'Right now', value: 'Receiving a meeting from your phone' });
    rows.push({ label: 'Paired phones', value: phonesValue(phones) });
    if (preferences && preferences.bluetooth && preferences.bluetooth.text) rows.push({ label: 'Bluetooth wake', value: preferences.bluetooth.text });
    if (preferences) rows.push({ label: 'Background updates', value: backgroundValue(preferences.backgroundUpdates) });
    const hasPhones = Array.isArray(phones) && phones.length > 0;
    const signedOut = listener !== null && listener !== undefined && listener.kind === 'signedOut';
    return {
      // No phone paired: struck through, whatever the listener says.
      icon: text.tone === 'good' && hasPhones ? 'wifi' : 'wifi-off',
      tone: hasPhones ? text.tone : 'warning',
      label: text.label,
      summary: text.summary,
      rows,
      action: signedOut ? '' : hasPhones ? 'Manage phones' : 'Pair a phone',
    };
  }

  // ── Pairing ───────────────────────────────────────────

  /** A pairing under way: the dialog shows it and Escape cancels it. */
  function pairingActive(state) {
    const kind = state && state.kind;
    return kind === 'starting' || kind === 'showingCode' || kind === 'confirming' || kind === 'saving';
  }

  /** "4:59": time left on the pairing code. */
  function countdown(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  /**
   * What the dialog shows next. Stopping the listener after an expired or failed code
   * (nothing paired) sends idle right after; the person still needs to see why.
   */
  function pairingShown(next, previous) {
    const kind = next && next.kind;
    const before = previous && previous.kind;
    if (kind === 'idle' && (before === 'expired' || before === 'failed')) return previous;
    return next || { kind: 'idle' };
  }

  const api = { statusCard, pairingActive, countdown, pairingShown };
  global.BriefsStatus = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

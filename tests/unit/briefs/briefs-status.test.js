'use strict';

/** The top bar's phone status card and the pairing rules (src/js/briefs/briefs-status.js). */
const B = require('../../../src/js/briefs/briefs-status');

const listening = { listener: { kind: 'listening' }, receiving: false };
const phone = { id: 'dev_1', displayName: 'iPhone', pairedAt: '2026-11-01T16:00:00.000Z' };
const preferences = { listenerError: null, bluetooth: { text: 'On', tone: 'neutral' }, backgroundUpdates: { enabled: true, leaseHours: 8 } };

describe('status card', () => {
  test('listening with a paired phone: wifi, the details and Manage phones', () => {
    const card = B.statusCard(listening, preferences, [phone]);
    expect(card).toMatchObject({ icon: 'wifi', tone: 'good', label: 'Listening for your devices', action: 'Manage devices' });
    const paired = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(phone.pairedAt));
    expect(card.rows).toEqual([
      { label: 'Paired devices', value: `iPhone, paired ${paired}` },
      { label: 'Bluetooth wake', value: 'On' },
      { label: 'Background updates', value: 'On, for 8 hours after each sync' },
    ]);
  });

  test('no phone paired: struck through, not listening, and Pair a phone', () => {
    const card = B.statusCard({ listener: { kind: 'waitingForPairing' }, receiving: false }, preferences, []);
    expect(card).toMatchObject({ icon: 'wifi-off', tone: 'warning', label: 'No device paired', action: 'Pair a device' });
    expect(card.summary).toContain('does not listen');
    expect(card.rows[0]).toEqual({ label: 'Paired devices', value: 'None paired' });
  });

  test('a meeting arriving shows first; a failure gives the reason', () => {
    expect(B.statusCard({ listener: { kind: 'listening' }, receiving: true }, preferences, [phone]).rows[0]).toEqual({ label: 'Right now', value: 'Receiving a meeting from a device' });
    const failed = B.statusCard({ listener: { kind: 'failed', message: 'x' }, receiving: false }, Object.assign({}, preferences, { listenerError: 'The port is in use.' }), [phone]);
    expect(failed).toMatchObject({ icon: 'wifi-off', tone: 'warning', label: 'Stopped' });
    expect(failed.summary).toBe('The port is in use. Restart LANA to try again.');
  });

  test('signed out offers nothing to press; unanswered host still gives a card', () => {
    expect(B.statusCard({ listener: { kind: 'signedOut' }, receiving: false }, null, []).action).toBe('');
    const unknown = B.statusCard(null, null, null);
    expect(unknown).toMatchObject({ icon: 'wifi-off', label: 'Not listening', action: 'Pair a device' });
    expect(unknown.rows).toEqual([{ label: 'Paired devices', value: 'None paired' }]);
  });

  test('background updates read Off, or On for one hour', () => {
    expect(B.statusCard(listening, Object.assign({}, preferences, { backgroundUpdates: { enabled: false, leaseHours: 8 } }), [phone]).rows[2].value).toBe('Off');
    expect(B.statusCard(listening, Object.assign({}, preferences, { backgroundUpdates: { enabled: true, leaseHours: 1 } }), [phone]).rows[2].value).toBe('On, for 1 hour after each sync');
  });
});

describe('pairing', () => {
  test('active while preparing, showing the code, confirming or saving', () => {
    ['starting', 'showingCode', 'confirming', 'saving'].forEach((kind) => expect(B.pairingActive({ kind })).toBe(true));
    ['idle', 'paired', 'expired', 'failed'].forEach((kind) => expect(B.pairingActive({ kind })).toBe(false));
    expect(B.pairingActive(null)).toBe(false);
  });

  test('countdown', () => {
    expect(B.countdown(299.2)).toBe('5:00');
    expect(B.countdown(61)).toBe('1:01');
    expect(B.countdown(-4)).toBe('0:00');
  });

  test('an expired or failed code stays shown when the listener stops behind it', () => {
    const expired = { kind: 'expired' };
    expect(B.pairingShown({ kind: 'idle' }, expired)).toBe(expired);
    expect(B.pairingShown({ kind: 'idle' }, { kind: 'paired', phoneName: 'iPhone' })).toEqual({ kind: 'idle' });
    expect(B.pairingShown({ kind: 'showingCode' }, expired)).toEqual({ kind: 'showingCode' });
  });
});

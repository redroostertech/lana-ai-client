'use strict';

/** Send to phone and Needs review rules (src/js/briefs/briefs-share.js), ported from the standalone Briefs app. */
const B = require('../../../src/js/briefs/briefs-share');

const phone = (fields) => Object.assign({ id: 'dev_1', name: "Mike's iPhone", shared: false, queued: false, declinedAt: null, snoozedAt: null }, fields);

describe('Send to phone state line', () => {
  test('says waiting, declined or Not now, whichever is current', () => {
    expect(B.sendHint(phone({ queued: true }))).toContain('the next time Briefs syncs');
    expect(B.sendHint(phone({}))).toBeNull();
    expect(B.sendHint(phone({ declinedAt: '2026-11-01T16:00:00.000Z' }))).toBe("Declined on Mike's iPhone");
    expect(B.sendHint(phone({ snoozedAt: '2026-11-01T16:00:00.000Z' }))).toBe("Not now on Mike's iPhone");
    expect(B.sendHint(phone({ declinedAt: '2026-11-01T16:00:00.000Z', snoozedAt: '2026-11-01T17:00:00.000Z' }))).toBe("Not now on Mike's iPhone");
    expect(B.sendHint(phone({ declinedAt: '2026-11-01T18:00:00.000Z', snoozedAt: '2026-11-01T17:00:00.000Z' }))).toBe("Declined on Mike's iPhone");
  });

  test('treats Cancel send after the phone already answered as quiet, never an error', () => {
    expect(B.cancelSendNotice('not_queued', phone({ declinedAt: '2026-11-01T16:00:00.000Z' }))).toBeNull();
    expect(B.cancelSendNotice('not_queued', phone({ snoozedAt: '2026-11-01T16:00:00.000Z' }))).toBeNull();
    expect(B.cancelSendNotice('not_queued', phone({}))).toEqual({ text: "No longer waiting for Mike's iPhone.", tone: 'quiet' });
    expect(B.cancelSendNotice('delivering', phone({ queued: true })).tone).toBe('warning');
    expect(B.cancelSendNotice('cancelled', phone({}))).toBeNull();
  });

  test('the footnote follows the first waiting phone', () => {
    expect(B.shareFootnote([phone({}), phone({ id: 'dev_2', name: 'Work phone', queued: true })])).toContain('Work phone');
    expect(B.shareFootnote([phone({})])).toBeNull();
    expect(B.shareFootnote(undefined)).toBeNull();
  });
});

describe('Share popover phone rows', () => {
  test('offers Cancel send while waiting, whatever the phone said before', () => {
    expect(B.phoneRow(phone({ queued: true, declinedAt: '2026-11-01T16:00:00.000Z' }))).toEqual({ title: "Mike's iPhone", status: 'Waiting to deliver', action: 'cancel' });
    expect(B.phoneRow(phone({ queued: true, shared: true })).action).toBe('cancel');
  });

  test("shows the phone's latest answer and offers Send again", () => {
    expect(B.phoneRow(phone({ declinedAt: '2026-11-01T16:00:00.000Z' }))).toEqual({ title: "Mike's iPhone", status: 'Declined', action: 'send' });
    expect(B.phoneRow(phone({ snoozedAt: '2026-11-01T16:00:00.000Z' }))).toEqual({ title: "Mike's iPhone", status: 'Not now', action: 'send' });
  });

  test('marks a phone holding the meeting as Sent, with when it last synced', () => {
    const at = '2026-11-02T15:30:00.000Z';
    const expected = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(at));
    expect(B.phoneRow(phone({ shared: true, lastSyncedAt: at }))).toEqual({ title: "Mike's iPhone", status: `Last synced ${expected}`, action: 'sent' });
    expect(B.phoneRow(phone({ shared: true }))).toEqual({ title: "Mike's iPhone", status: 'Shared', action: 'sent' });
    expect(B.phoneRow(phone({ shared: true, lastSyncedAt: 'not a date' })).status).toBe('Shared');
  });

  test('offers Send to a phone that never had it, and names an unnamed phone', () => {
    expect(B.phoneRow(phone({}))).toEqual({ title: "Mike's iPhone", status: 'Not sent yet', action: 'send' });
    expect(B.phoneRow(phone({ name: '  ' })).title).toBe('Your phone');
    expect(B.phoneRow(phone({ name: 'iPhone' })).title).toBe('iPhone');
  });
});

describe('Needs review', () => {
  test('the lead counts the conflicts', () => {
    expect(B.reviewLead(1, 'computer')).toBe('Your phone and this computer both changed one thing. Pick the version to keep. Your choice syncs to your phone.');
    expect(B.reviewLead(3, 'computer')).toContain('both changed 3 things');
  });

  test('versions read Deleted, No text or the text', () => {
    expect(B.versionText(null)).toBe('Deleted');
    expect(B.versionText('')).toBe('No text');
    expect(B.versionText('Intake call')).toBe('Intake call');
  });

  test("a merged edit starts from this computer's version, else the phone's", () => {
    expect(B.mergeStart({ desktop: 'Mine', phone: 'Theirs' })).toBe('Mine');
    expect(B.mergeStart({ desktop: null, phone: 'Theirs' })).toBe('Theirs');
    expect(B.mergeStart({ desktop: null, phone: null })).toBe('');
  });
});

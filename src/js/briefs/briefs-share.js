/**
 * LANA Briefs: Send to phone and Needs review rules for the meeting page, ported from the
 * standalone app's renderer (lib/sendState, SharedRecordPanel). Plain functions over the
 * SharedRecordView the Briefs bridge returns (records.state); no DOM. The page
 * (src/briefs/app.js) renders with them; tests/unit/briefs/briefs-share.test.js covers them.
 */
(function (global) {
  'use strict';

  const monthDayTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function parsed(iso) {
    return iso ? Date.parse(iso) : Number.NaN;
  }

  /** The paired phone's own name, or "your phone" when it reported none. */
  function phoneLabel(phone) {
    return String((phone && phone.name) || '').trim() || 'your phone';
  }

  /** The phone's latest answer to a send: declined or "Not now", whichever came last. */
  function latestAnswer(phone) {
    const declined = parsed(phone.declinedAt);
    const snoozed = parsed(phone.snoozedAt);
    if (Number.isNaN(declined) && Number.isNaN(snoozed)) return null;
    return Number.isNaN(snoozed) || declined >= snoozed ? 'declined' : 'snoozed';
  }

  /**
   * One phone's row in the Share popover: { title, status, action } where action is
   * send, cancel (while queued) or sent. Waiting beats everything (it can still be
   * cancelled); then the phone's latest answer; then whether it holds the meeting.
   */
  function phoneRow(phone) {
    // The phone's own name as it reported it ("iPhone" stays "iPhone").
    const name = String((phone && phone.name) || '').trim();
    const title = name || 'Your phone';
    if (phone.queued) return { title, status: 'Waiting to deliver', action: 'cancel' };
    const answer = latestAnswer(phone);
    if (answer !== null) return { title, status: answer === 'declined' ? 'Declined' : 'Not now', action: 'send' };
    const synced = parsed(phone.lastSyncedAt);
    const status = Number.isNaN(synced) ? (phone.shared ? 'Shared' : 'Not sent yet') : `Last synced ${monthDayTime.format(new Date(synced))}`;
    return { title, status, action: phone.shared ? 'sent' : 'send' };
  }

  /** The line under a waiting send, or why it is no longer waiting. Null when there is nothing to say. */
  function sendHint(phone) {
    if (phone.queued) return `It goes to ${phoneLabel(phone)} the next time LANA Briefs syncs. Open LANA Briefs on your phone to sync now.`;
    const answer = latestAnswer(phone);
    if (answer === null) return null;
    return answer === 'declined' ? `Declined on ${phoneLabel(phone)}` : `Not now on ${phoneLabel(phone)}`;
  }

  /**
   * What Cancel send says. not_queued is not an error: the phone answered first, and the
   * refreshed hint already says which; otherwise a quiet line.
   */
  function cancelSendNotice(status, phone) {
    switch (status) {
      case 'delivering':
        return { text: `It is already being delivered to ${phoneLabel(phone)}, so it cannot be cancelled now.`, tone: 'warning' };
      case 'not_queued':
        return sendHint(phone) === null ? { text: `No longer waiting for ${phoneLabel(phone)}.`, tone: 'quiet' } : null;
      default:
        return null;
    }
  }

  /** The footnote under the phones: what the first waiting send is doing. */
  function shareFootnote(phones) {
    const waiting = (phones || []).find((phone) => phone.queued);
    return waiting ? sendHint(waiting) : null;
  }

  /** The lead line of Needs review. */
  function reviewLead(count, deviceNoun) {
    const things = count === 1 ? 'one thing' : `${count} things`;
    return `Your phone and this ${deviceNoun} both changed ${things}. Pick the version to keep. Your choice syncs to your phone.`;
  }

  /** How one side's version reads: deleted, empty, or the text. */
  function versionText(value) {
    if (value === null || value === undefined) return 'Deleted';
    return value === '' ? 'No text' : value;
  }

  /** The text a merged edit starts from: this computer's version, else the phone's. */
  function mergeStart(conflict) {
    if (conflict.desktop !== null && conflict.desktop !== undefined) return conflict.desktop;
    return conflict.phone == null ? '' : conflict.phone;
  }

  const api = { phoneLabel, phoneRow, sendHint, cancelSendNotice, shareFootnote, reviewLead, versionText, mergeStart };
  global.BriefsShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
